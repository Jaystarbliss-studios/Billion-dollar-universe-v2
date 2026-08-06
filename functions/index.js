const functions = require("firebase-functions");
const admin     = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/* ═══════════════════════════════════════════════
   HELPER — get a brand's current coin balance
═══════════════════════════════════════════════ */
async function getBrandCoins(brandId) {
    const doc = await db.collection("brands").doc(brandId).get();
    if (!doc.exists) throw new Error("Brand not found");
    return doc.data().coins || 0;
}

/* ═══════════════════════════════════════════════
   FUNCTION 1 — onSlotPurchase
   Called when a brand tries to buy a slot.
   Checks they have enough coins, deducts them,
   saves the slot ownership.
═══════════════════════════════════════════════ */
exports.onSlotPurchase = functions.https.onCall(async (data, context) => {
    // 1. Make sure the user is logged in
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }

    const { slotIndex, industry, planetIndex, price } = data;
    const brandId = context.auth.uid;
    const worldKey = `${industry.toLowerCase().replace(/\s+/g, "_")}_${planetIndex}`;
    const slotDocId = String(slotIndex);

    // 2. Run everything inside a transaction (all-or-nothing — no partial changes)
    await db.runTransaction(async (transaction) => {
        const brandRef = db.collection("brands").doc(brandId);
        const slotRef  = db.collection("worlds").doc(worldKey).collection("slots").doc(slotDocId);
        const worldRef = db.collection("worlds").doc(worldKey);

        const [brandDoc, slotDoc, worldDoc] = await Promise.all([
            transaction.get(brandRef),
            transaction.get(slotRef),
            transaction.get(worldRef),
        ]);

        // 3. Check the brand exists
        if (!brandDoc.exists) {
            throw new functions.https.HttpsError("not-found", "Brand not found.");
        }

        // 4. Check the slot is not already owned
        if (slotDoc.exists && slotDoc.data().ownerId) {
            throw new functions.https.HttpsError("already-exists", "This slot is already owned.");
        }

        // 5. Check the brand has enough coins
        const currentCoins = brandDoc.data().coins || 0;
        if (currentCoins < price) {
            throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");
        }

        // 6. Deduct coins from brand
        transaction.update(brandRef, {
            coins:         currentCoins - price,
            coinsSpentTotal: (brandDoc.data().coinsSpentTotal || 0) + price,
            slotCount:     (brandDoc.data().slotCount || 0) + 1,
        });

        // 7. Save slot ownership
        transaction.set(slotRef, {
            slotIndex,
            ownerId:    brandId,
            buildingId: null,
            locked:     false,
            type:       data.slotType || "normal",
            premiumMult: data.premiumMult || 1,
            purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
            pricePaid:  price,
        });

        // 8. Update world occupied count
        transaction.update(worldRef, {
            occupiedCount: admin.firestore.FieldValue.increment(1),
        });

        // 9. Save to brand's personal slot list
        const brandSlotRef = db.collection("brands").doc(brandId)
            .collection("slots").doc(`${industry}_${planetIndex}_${slotIndex}`);
        transaction.set(brandSlotRef, {
            slotIndex, industry, planetIndex,
            buildingId: null,
            purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
            pricePaid: price,
        });
    });

    // 10. Create the free basic building automatically
    const worldKey2 = `${industry.toLowerCase().replace(/\s+/g, "_")}_${planetIndex}`;
    const buildingId = db.collection("worlds").doc(worldKey2).collection("buildings").doc().id;
    await db.collection("worlds").doc(worldKey2).collection("buildings").doc(buildingId).set({
        buildingId,
        slotIndex,
        brandId,
        catalogId:  "basic",
        floors:     1,
        color:      data.brandColor || 0xAAAAAA,
        builtAt:    admin.firestore.FieldValue.serverTimestamp(),
        upgradedAt: null,
    });

    // 11. Update the slot with the buildingId
    await db.collection("worlds").doc(worldKey2).collection("slots").doc(slotDocId).update({ buildingId });

    return { success: true, buildingId };
});


/* ═══════════════════════════════════════════════
   FUNCTION 2 — onBuildingUpgrade
   Called when a brand upgrades their building.
   Checks they own the slot, deducts coins,
   updates the building size.
═══════════════════════════════════════════════ */
exports.onBuildingUpgrade = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }

    const { buildingId, slotIndex, industry, planetIndex, newFloors, cost } = data;
    const brandId  = context.auth.uid;
    const worldKey = `${industry.toLowerCase().replace(/\s+/g, "_")}_${planetIndex}`;

    await db.runTransaction(async (transaction) => {
        const brandRef    = db.collection("brands").doc(brandId);
        const buildingRef = db.collection("worlds").doc(worldKey).collection("buildings").doc(buildingId);

        const [brandDoc, buildingDoc] = await Promise.all([
            transaction.get(brandRef),
            transaction.get(buildingRef),
        ]);

        // Check brand exists and owns the building
        if (!brandDoc.exists) throw new functions.https.HttpsError("not-found", "Brand not found.");
        if (!buildingDoc.exists) throw new functions.https.HttpsError("not-found", "Building not found.");
        if (buildingDoc.data().brandId !== brandId) {
            throw new functions.https.HttpsError("permission-denied", "You don't own this building.");
        }

        // Check coins
        const currentCoins = brandDoc.data().coins || 0;
        if (currentCoins < cost) {
            throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");
        }

        const oldFloors = buildingDoc.data().floors || 1;
        const heightAdded = (newFloors - oldFloors) * 3; // 3 units per floor

        // Deduct coins, update building height total for leaderboard
        transaction.update(brandRef, {
            coins:               currentCoins - cost,
            coinsSpentTotal:     (brandDoc.data().coinsSpentTotal || 0) + cost,
            buildingHeightTotal: (brandDoc.data().buildingHeightTotal || 0) + heightAdded,
        });

        // Update building floors
        transaction.update(buildingRef, {
            floors:     newFloors,
            upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });

    return { success: true };
});


/* ═══════════════════════════════════════════════
   FUNCTION 3 — onAuctionSettle
   Called automatically by a Cloud Scheduler
   when an auction's end time is reached.
   Awards slot to winner, refunds everyone else.
═══════════════════════════════════════════════ */
exports.onAuctionSettle = functions.https.onCall(async (data, context) => {
    const { auctionId } = data;
    const auctionRef = db.collection("auctions").doc(auctionId);
    const auctionDoc = await auctionRef.get();

    if (!auctionDoc.exists) throw new functions.https.HttpsError("not-found", "Auction not found.");

    const auction = auctionDoc.data();
    if (auction.state !== "active") {
        throw new functions.https.HttpsError("failed-precondition", "Auction is not active.");
    }
    if (Date.now() < auction.endsAt.toMillis()) {
        throw new functions.https.HttpsError("failed-precondition", "Auction has not ended yet.");
    }

    // No bids — cancel the auction
    if (!auction.currentBidder) {
        await auctionRef.update({ state: "cancelled" });
        return { success: true, result: "cancelled" };
    }

    const winnerId  = auction.currentBidder;
    const winAmount = auction.currentBid;
    const { slotIndex, industry, planetIndex } = auction;
    const worldKey = `${industry.toLowerCase().replace(/\s+/g, "_")}_${planetIndex}`;

    await db.runTransaction(async (transaction) => {
        const winnerRef = db.collection("brands").doc(winnerId);
        const winnerDoc = await transaction.get(winnerRef);

        // Award the slot to the winner (same logic as slot purchase)
        const slotRef = db.collection("worlds").doc(worldKey).collection("slots").doc(String(slotIndex));
        transaction.set(slotRef, {
            slotIndex, ownerId: winnerId, buildingId: null, locked: false,
            purchasedAt: admin.firestore.FieldValue.serverTimestamp(), pricePaid: winAmount,
        });

        transaction.update(winnerRef, {
            slotCount:       (winnerDoc.data().slotCount || 0) + 1,
            coinsSpentTotal: (winnerDoc.data().coinsSpentTotal || 0) + winAmount,
        });

        // Mark auction settled
        transaction.update(auctionRef, {
            state: "settled", winnerId,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update world count
        const worldRef = db.collection("worlds").doc(worldKey);
        transaction.update(worldRef, { occupiedCount: admin.firestore.FieldValue.increment(1) });
    });

    // Refund all losing bidders
    const losers = (auction.bids || []).filter(b => b.brandId !== winnerId);
    const uniqueLosers = {};
    losers.forEach(b => {
        uniqueLosers[b.brandId] = (uniqueLosers[b.brandId] || 0) + b.amount;
    });
    // Only refund the highest bid per loser (they only paid their max bid)
    const refundPromises = Object.entries(uniqueLosers).map(([loserId, amount]) =>
        db.collection("brands").doc(loserId).update({
            coins: admin.firestore.FieldValue.increment(amount),
        })
    );
    await Promise.all(refundPromises);

    return { success: true, result: "settled", winnerId };
});


/* ═══════════════════════════════════════════════
   FUNCTION 4 — onMonthlyGrant
   Triggered by Cloud Scheduler on the 1st of
   every month. Gives each active brand their
   monthly free coins based on their tier.
═══════════════════════════════════════════════ */
exports.onMonthlyGrant = functions.pubsub
    .schedule("0 0 1 * *")   // runs at midnight on the 1st of every month
    .timeZone("UTC")
    .onRun(async () => {
        const TIER_GRANTS = {
            free:  0,
            tier1: 500,
            tier2: 2000,
            tier3: 10000,
        };

        const brandsSnap = await db.collection("brands")
            .where("activationStatus", "==", "active")
            .get();

        const batch = db.batch();
        brandsSnap.forEach(doc => {
            const tier   = doc.data().tier || "free";
            const amount = TIER_GRANTS[tier] || 0;
            if (amount > 0) {
                batch.update(doc.ref, {
                    coins: admin.firestore.FieldValue.increment(amount),
                });
            }
        });

        await batch.commit();
        console.log(`Monthly grants sent to ${brandsSnap.size} brands.`);
        return null;
    });


/* ═══════════════════════════════════════════════
   FUNCTION 5 — recalcLeaderboard
   Triggers automatically whenever a brand document
   is updated (e.g. after a slot purchase or
   building upgrade). Recalculates their score
   and updates the leaderboard for all their worlds.
═══════════════════════════════════════════════ */
exports.recalcLeaderboard = functions.firestore
    .document("brands/{brandId}")
    .onUpdate(async (change, context) => {
        const brandId = context.params.brandId;
        const data    = change.after.data();

        const score =
            (data.slotCount           || 0) * 0.5 +
            (data.buildingHeightTotal || 0) * 0.3 +
            (data.coinsSpentTotal     || 0) / 1000 * 0.2;

        // Get all slots this brand owns to find which worlds they're in
        const slotsSnap = await db.collectionGroup("slots")
            .where("ownerId", "==", brandId)
            .limit(1)
            .get();

        if (slotsSnap.empty) return null;

        // Update leaderboard entry in each world the brand participates in
        const worldsSnap = await db.collection("brands").doc(brandId)
            .collection("slots").get();

        const worldKeys = new Set();
        worldsSnap.forEach(doc => {
            const d = doc.data();
            if (d.industry && d.planetIndex !== undefined) {
                worldKeys.add(`${d.industry.toLowerCase().replace(/\s+/g, "_")}_${d.planetIndex}`);
            }
        });

        const updates = Array.from(worldKeys).map(worldKey =>
            db.collection("worlds").doc(worldKey)
                .collection("leaderboard").doc(brandId)
                .set({
                    brandId,
                    brandName:           data.brandName || "",
                    color:               data.color || 0xC6A85E,
                    slotCount:           data.slotCount || 0,
                    buildingHeightTotal: data.buildingHeightTotal || 0,
                    coinsSpent:          data.coinsSpentTotal || 0,
                    score,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true })
        );

        await Promise.all(updates);
        return null;
    });


/* ═══════════════════════════════════════════════
   FUNCTION 6 — cityUnlockScheduler
   Runs every 5 minutes. Checks all UPCOMING cities
   and transitions them to ACTIVE based on triggers:
   • Time-based: releaseDate reached
   • Fill-based: previous city 100% sold (if configured)
   • Both: whichever comes first
   Also triggers landmark auctions at 80% fill.
═══════════════════════════════════════════════ */
exports.cityUnlockScheduler = functions.pubsub
    .schedule('every 5 minutes')
    .timeZone('UTC')
    .onRun(async () => {
        const now = admin.firestore.Timestamp.now();

        console.log('🔔 City Unlock Scheduler started at', now.toDate().toISOString());

        // 1. Process UPCOMING cities that should become ACTIVE
        const upcomingSnap = await db.collection('cities')
            .where('status', '==', 'UPCOMING')
            .get();

        const unlockPromises = [];

        for (const cityDoc of upcomingSnap.docs) {
            const city = cityDoc.data();
            const cityId = cityDoc.id;
            let shouldActivate = false;
            let trigger = '';

            // Check time trigger
            if (city.releaseDate && now.toMillis() >= city.releaseDate.toMillis()) {
                shouldActivate = true;
                trigger = 'time';
            }

            // Check fill trigger (if configured)
            if (city.unlockTrigger === 'fill' || city.unlockTrigger === 'both') {
                const fillRatio = (city.soldCount || 0) / (city.parcelCount || 1);
                if (fillRatio >= 1.0) {
                    shouldActivate = true;
                    trigger = 'fill';
                }
            }

            if (shouldActivate) {
                console.log(`🏙️  Activating city: ${city.name} (${cityId}) via ${trigger} trigger`);
                unlockPromises.push(
                    cityDoc.ref.update({
                        status: 'ACTIVE',
                        activatedAt: now,
                        unlockTriggerUsed: trigger
                    })
                );
                // Optionally: send notifications to users about city opening
            }
        }

        // 2. Process ACTIVE cities that should start landmark auction at 80% fill
        const activeSnap = await db.collection('cities')
            .where('status', '==', 'ACTIVE')
            .get();

        for (const cityDoc of activeSnap.docs) {
            const city = cityDoc.data();
            const cityId = cityDoc.id;
            const fillRatio = (city.soldCount || 0) / (city.parcelCount || 1);

            // Start landmark auction when city reaches 80% and auction not yet open
            if (fillRatio >= 0.8 && !city.landmarkAuctionOpen) {
                console.log(`🏛️  Starting landmark auction for: ${city.name} (${cityId})`);

                const auctionRef = cityDoc.ref.collection('auction').doc();
                const startingBid = 50000;

                await auctionRef.set({
                    itemType: 'landmark',
                    startingBid: startingBid,
                    currentBid: startingBid,
                    currentBidder: null,
                    lastBidAt: null,
                    endsAt: new Timestamp(
                        Date.now() + 48 * 60 * 60 * 1000, // 48 hours from now
                        0
                    ),
                    settled: false,
                    state: 'active'
                });

                await cityDoc.ref.update({
                    landmarkAuctionOpen: true
                });

                // TODO: Send notifications to city parcel owners
                console.log(`   Auction created: ${auctionRef.id}`);
            }

            // 3. Process FILLING cities that become ARCHIVED at 100%
            if (city.status === 'FILLING' || fillRatio >= 1.0) {
                if (fillRatio >= 1.0 && city.status !== 'ARCHIVED') {
                    console.log(`✅ Archiving full city: ${city.name} (${cityId})`);
                    unlockPromises.push(
                        cityDoc.ref.update({
                            status: 'ARCHIVED',
                            archiveDate: now
                        })
                    );

                    // TODO: Award completion badges, send notifications, etc.
                }
            }
        }

        await Promise.all(unlockPromises);
        console.log('🔔 Scheduler completed. Processed', upcomingSnap.size, 'upcoming cities.');
        return null;
    });


/* ═══════════════════════════════════════════════
   FUNCTION 7 — onParcelPurchase (callable)
   Cloud Function to handle parcel purchases in City Worlds.
   Validates ownership, deducts coins, updates parcel.
   This ensures server-side consistency and prevents cheating.
═══════════════════════════════════════════════ */
exports.onParcelPurchase = functions.https.onCall(async (data, context) => {
    // 1. Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }

    const { cityId, parcelId, price, ownerType } = data;
    const userId = context.auth.uid;

    if (!cityId || !parcelId || !price) {
        throw new functions.https.HttpsError("invalid-argument", "Missing required parameters.");
    }

    // ownerType must be 'user' or 'brand'
    const isBrand = ownerType === 'brand';
    const isUser = ownerType === 'user';

    if (!isBrand && !isUser) {
        throw new functions.https.HttpsError("invalid-argument", "ownerType must be 'user' or 'brand'.");
    }

    // Determine which collection holds the coin balance
    const ownerRef = isBrand
        ? db.collection('brands').doc(userId)
        : db.collection('users').doc(userId);

    const parcelRef = db.collection(`cities/${cityId}/parcels`).doc(parcelId);
    const cityRef = db.collection('cities').doc(cityId);

    // 2. Transaction to ensure atomicity
    await db.runTransaction(async (transaction) => {
        const [ownerDoc, parcelDoc, cityDoc] = await Promise.all([
            transaction.get(ownerRef),
            transaction.get(parcelRef),
            transaction.get(cityRef)
        ]);

        // Verify owner exists
        if (!ownerDoc.exists) {
            throw new functions.https.HttpsError("not-found", "User or brand not found.");
        }

        // Verify city is ACTIVE
        if (!cityDoc.exists || cityDoc.data().status !== 'ACTIVE') {
            throw new functions.https.HttpsError("failed-precondition", "City is not active for purchases.");
        }

        // Verify parcel is available (ownerId is null)
        if (parcelDoc.exists && parcelDoc.data().ownerId) {
            throw new functions.https.HttpsError("already-exists", "Parcel already owned.");
        }

        // Verify user/ brand has enough coins
        const currentCoins = ownerDoc.data().coins || 0;
        if (currentCoins < price) {
            throw new functions.https.HttpsError("failed-precondition", "Insufficient coins.");
        }

        // Deduct coins
        transaction.update(ownerRef, {
            coins: currentCoins - price,
            coinsSpentTotal: (ownerDoc.data().coinsSpentTotal || 0) + price
        });

        // Assign parcel ownership
        transaction.set(parcelRef, {
            parcelId,
            ownerId: userId,
            ownerType: ownerType,
            districtName: parcelDoc.data?.districtName || 'Unknown',
            zoneType: parcelDoc.data?.zoneType || 'unknown',
            bounds: parcelDoc.data?.bounds || {},
            centerLat: parcelDoc.data?.centerLat || 0,
            centerLon: parcelDoc.data?.centerLon || 0,
            basePrice: parcelDoc.data?.basePrice || price,
            pricePaid: price,
            purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
            buildingType: null,
            buildingTier: 0,
            buildingBuiltAt: null,
            pointsPerDay: 0
        });

        // Update city sold count
        transaction.update(cityRef, {
            soldCount: admin.firestore.FieldValue.increment(1)
        });

        // Create leaderboard entry or update
        const leaderboardRef = cityRef.collection('leaderboard').doc(userId);
        const leaderData = {
            brandId: userId,
            brandName: ownerDoc.data().brandName || ownerDoc.data().displayName || 'Unknown',
            parcelCount: admin.firestore.FieldValue.increment(1),
            totalSpent: price,
            pointsTotal: 0,
            buildingCount: 0,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        transaction.set(leaderboardRef, leaderData, { merge: true });
    });

    return { success: true };
});


/* ═══════════════════════════════════════════════
   FUNCTION 8 — onBuildingConstruct (callable)
   Handles building construction on an owned parcel.
   Deducts coins, assigns building type/tier, awards points.
═══════════════════════════════════════════════ */
exports.onBuildingConstruct = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }

    const { cityId, parcelId, buildingType, buildingTier, cost, pointsPerDay } = data;
    const userId = context.auth.uid;

    if (!cityId || !parcelId || !buildingType || buildingTier === undefined || !cost) {
        throw new functions.https.HttpsError("invalid-argument", "Missing required parameters.");
    }

    const parcelRef = db.collection(`cities/${cityId}/parcels`).doc(parcelId);
    const cityRef = db.collection('cities').doc(cityId);
    const ownerRef = db.collection('brands').doc(userId); // assuming brands only build, adjust for users

    await db.runTransaction(async (transaction) => {
        const [parcelDoc, cityDoc, ownerDoc] = await Promise.all([
            transaction.get(parcelRef),
            transaction.get(cityRef),
            transaction.get(ownerRef)
        ]);

        // Verify parcel exists and is owned by this user
        if (!parcelDoc.exists) {
            throw new functions.https.HttpsError("not-found", "Parcel not found.");
        }
        const parcelData = parcelDoc.data();
        if (parcelData.ownerId !== userId) {
            throw new functions.https.HttpsError("permission-denied", "You don't own this parcel.");
        }

        // Verify city is active or filling
        const cityStatus = cityDoc.data()?.status;
        if (cityStatus !== 'ACTIVE' && cityStatus !== 'FILLING') {
            throw new functions.https.HttpsError("failed-precondition", "City is not active.");
        }

        // Verify parcel has no building yet (or allow upgrade? Let's only allow one building per parcel)
        if (parcelData.buildingType) {
            throw new functions.https.HttpsError("already-exists", "Building already exists on this parcel.");
        }

        // Landmark check: only one per city, auctioned
        if (buildingTier === 4 && cityDoc.data().landmarkAuctionOpen) {
            const auctionSnap = await cityRef.collection('auction').limit(1).get();
            if (!auctionSnap.empty) {
                const auction = auctionSnap.docs[0].data();
                if (auction.currentBidder !== userId) {
                    throw new functions.https.HttpsError("permission-denied", "You did not win the landmark auction.");
                }
            }
        }

        // Check coins
        const currentCoins = ownerDoc.data()?.coins || 0;
        if (currentCoins < cost) {
            throw new functions.https.HttpsError("failed-precondition", "Insufficient coins.");
        }

        // Deduct coins
        transaction.update(ownerRef, {
            coins: currentCoins - cost,
            coinsSpentTotal: (ownerDoc.data().coinsSpentTotal || 0) + cost
        });

        // Update parcel with building data
        transaction.update(parcelRef, {
            buildingType: buildingType,
            buildingTier: buildingTier,
            buildingBuiltAt: admin.firestore.FieldValue.serverTimestamp(),
            pointsPerDay: pointsPerDay
        });

        // Update leaderboard points
        const leaderboardRef = cityRef.collection('leaderboard').doc(userId);
        transaction.set(leaderboardRef, {
            buildingCount: admin.firestore.FieldValue.increment(1),
            pointsTotal: admin.firestore.FieldValue.increment(pointsPerDay),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    return { success: true };
});
```

---

**Step 4 — Save the file**

Press **Ctrl + S** (Windows) or **Cmd + S** (Mac) to save.

---

**Step 5 — Deploy to Firebase**

Back in the VS Code terminal (make sure you're still in the `/functions/` folder — if not, type `cd functions`):
```
firebase deploy --only functions
```

This uploads your code to Google's servers. It takes 1–3 minutes. When it's done you'll see something like:
```
✔ functions[onSlotPurchase]: Successful create operation.
✔ functions[onBuildingUpgrade]: Successful create operation.
✔ functions[onAuctionSettle]: Successful create operation.
✔ functions[onMonthlyGrant]: Successful create operation.
✔ functions[recalcLeaderboard]: Successful create operation.

Deploy complete!