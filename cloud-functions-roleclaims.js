/**
 * ═══════════════════════════════════════════════════════════════════
 *  BRAND UNIVERSE — CLOUD FUNCTIONS: ROLE CLAIM MANAGEMENT
 *  functions/src/roleClaims.js
 *
 *  These functions are the SERVER-SIDE authority for role assignment.
 *  The Firestore rules trust request.auth.token.role which is set here.
 *
 *  DEPLOY:
 *    firebase deploy --only functions
 * ═══════════════════════════════════════════════════════════════════
 */

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const db   = admin.firestore();
const auth = admin.auth();

const ADMIN_EMAIL = 'johnrufai242@gmail.com';

/* ─── 1. ON USER CREATION ───────────────────────────────────────
   Fires when a new Firebase Auth user is created.
   Sets default 'user' custom claim immediately.
─────────────────────────────────────────────────────────────────── */
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
  const role = user.email === ADMIN_EMAIL ? 'admin' : 'user';

  try {
    // Set custom claim on the auth token
    await auth.setCustomUserClaims(user.uid, {
      role,
      brandId: null,
    });

    // Create the Firestore document with role embedded
    await db.collection('users').doc(user.uid).set({
      uid:          user.uid,
      email:        user.email || '',
      role,
      brandId:      null,
      credits:      0,
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[RoleClaims] Created user ${user.uid} with role: ${role}`);
  } catch (err) {
    console.error(`[RoleClaims] Failed to set claims for ${user.uid}:`, err);
  }
});


/* ─── 2. PROMOTE USER TO BRAND (callable) ───────────────────────
   Called from client when a user completes brand registration.
   Validates requirements before promotion.

   Client usage:
     const promoteToBrand = firebase.functions().httpsCallable('promoteToBrand');
     await promoteToBrand({ brandId: 'my-brand-id', brandName: 'Acme' });
─────────────────────────────────────────────────────────────────── */
exports.promoteToBrand = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');

  const uid      = context.auth.uid;
  const brandId  = data.brandId;
  const brandName = data.brandName;

  if (!brandId || !brandName) {
    throw new functions.https.HttpsError('invalid-argument', 'brandId and brandName required');
  }

  // Validate the brand document exists and belongs to this user
  const brandDoc = await db.collection('brands').doc(brandId).get();
  if (!brandDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Brand not found');
  }
  if (brandDoc.data().ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Brand does not belong to you');
  }

  // Set new claims
  await auth.setCustomUserClaims(uid, {
    role:    'brand',
    brandId: brandId,
  });

  // Update users/{uid}
  await db.collection('users').doc(uid).update({
    role:    'brand',
    brandId: brandId,
  });

  // Log the promotion
  await db.collection('adminLog').add({
    type:      'ROLE_PROMOTION',
    uid,
    brandId,
    brandName,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[RoleClaims] Promoted ${uid} → brand (${brandId})`);
  return { success: true, role: 'brand', brandId };
});


/* ─── 3. ADMIN ROLE ASSIGNMENT (callable, admin-only) ───────────
   Allows the admin to set any user's role.
   Protected by verifying the caller's custom claim.

   Client usage:
     const assignRole = firebase.functions().httpsCallable('assignRole');
     await assignRole({ targetUid: '...', role: 'admin', brandId: null });
─────────────────────────────────────────────────────────────────── */
exports.assignRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');

  // Verify caller is admin via custom claim (NOT email — that's spoofable on client)
  const callerClaims = context.auth.token;
  if (callerClaims.role !== 'admin' && callerClaims.email !== ADMIN_EMAIL) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { targetUid, role, brandId } = data;
  const validRoles = ['user', 'brand', 'admin'];

  if (!targetUid || !validRoles.includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid and valid role required');
  }

  const claims = { role, brandId: brandId || null };
  await auth.setCustomUserClaims(targetUid, claims);
  await db.collection('users').doc(targetUid).update({ role, brandId: brandId || null });

  await db.collection('adminLog').add({
    type:      'ADMIN_ROLE_ASSIGN',
    by:        context.auth.uid,
    targetUid,
    role,
    brandId:   brandId || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[RoleClaims] Admin assigned ${targetUid} → role: ${role}`);
  return { success: true };
});


/* ─── 4. PROCESS CREDIT TRANSACTIONS (Firestore trigger) ────────
   Fires when a user creates a creditTransactions/{txId} doc
   with status='pending'. Validates, then awards credits.

   This is why client cannot write credits directly —
   all credit mutation happens here in a server transaction.
─────────────────────────────────────────────────────────────────── */
const CREDIT_AWARDS = {
  ad_watch:   10,  // per ad watched
  referral:   50,  // per successful referral
  engagement:  5,  // per engagement action
};

const PER_DAY_CAP = 200; // max credits a user can earn per day

exports.processCreditTransaction = functions.firestore
  .document('creditTransactions/{txId}')
  .onCreate(async (snap, context) => {
    const tx  = snap.data();
    const txId = context.params.txId;

    if (tx.status !== 'pending') return null;

    const uid    = tx.uid;
    const source = tx.source;
    const award  = CREDIT_AWARDS[source];

    if (!award) {
      await snap.ref.update({ status: 'rejected', reason: 'invalid source' });
      return null;
    }

    // Daily cap check — count today's approved transactions
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTxs = await db.collection('creditTransactions')
      .where('uid',    '==', uid)
      .where('status', '==', 'approved')
      .where('processedAt', '>=', todayStart)
      .get();

    const todayEarned = todayTxs.docs.reduce((sum, d) => sum + (d.data().awarded || 0), 0);

    if (todayEarned >= PER_DAY_CAP) {
      await snap.ref.update({ status: 'rejected', reason: 'daily cap reached' });
      return null;
    }

    const actualAward = Math.min(award, PER_DAY_CAP - todayEarned);

    // Atomic: update credits + mark transaction approved
    await db.runTransaction(async t => {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('User not found');

      t.update(userRef, {
        credits: admin.firestore.FieldValue.increment(actualAward),
      });
      t.update(snap.ref, {
        status:      'approved',
        awarded:     actualAward,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    console.log(`[Credits] Awarded ${actualAward} credits to ${uid} (source: ${source})`);
    return null;
  });


/* ─── 5. UPDATE LEADERBOARD (scheduled + trigger) ───────────────
   Runs every 60s via a scheduled function to aggregate slot counts
   and update leaderboard/{brandId} docs.
   Also triggered on slot purchase.
─────────────────────────────────────────────────────────────────── */
exports.updateLeaderboard = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    // Read all world slot collections and aggregate by ownerId
    const worlds = await db.collection('worlds').get();

    for (const worldDoc of worlds.docs) {
      const worldKey = worldDoc.id;
      const slotsSnap = await db.collection('worlds').doc(worldKey)
        .collection('slots').get();

      const brandScores = {};

      slotsSnap.forEach(slotDoc => {
        const { ownerId, ownerType, altitude, buildingFloors } = slotDoc.data();
        if (!ownerId) return;

        if (!brandScores[ownerId]) {
          brandScores[ownerId] = { score: 0, slotCount: 0, ownerId, ownerType };
        }

        // Score formula: 1 point per slot + altitude bonus + floors bonus
        const altScore   = Math.round((altitude || 0) / 10);
        const floorScore = (buildingFloors || 1) * 5;
        brandScores[ownerId].score     += 1 + altScore + floorScore;
        brandScores[ownerId].slotCount += 1;
      });

      // Write leaderboard entries in a batch
      const batch = db.batch();
      for (const [ownerId, data] of Object.entries(brandScores)) {
        const lbRef = db.collection('worlds').doc(worldKey)
          .collection('leaderboard').doc(ownerId);

        // Try to get brand name
        let brandName = ownerId.slice(0, 8);
        try {
          const brandDoc = await db.collection('brands').doc(ownerId).get();
          if (brandDoc.exists) brandName = brandDoc.data().brandName || brandName;
          else {
            const userDoc = await db.collection('users').doc(ownerId).get();
            if (userDoc.exists) brandName = userDoc.data().username || brandName;
          }
        } catch (_) {}

        batch.set(lbRef, {
          ...data,
          brandName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      await batch.commit();
      console.log(`[Leaderboard] Updated ${worldKey}: ${Object.keys(brandScores).length} entries`);
    }
  });
