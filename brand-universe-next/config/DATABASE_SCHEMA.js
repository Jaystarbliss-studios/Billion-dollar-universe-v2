/**
 * DATABASE_SCHEMA.js — Firestore collection/document structure.
 *
 * This file is documentation only (not imported at runtime).
 * Use it as the authoritative reference when writing Cloud Functions,
 * admin scripts, or backend API routes.
 *
 * ═══════════════════════════════════════════════════════════
 * COLLECTIONS
 * ═══════════════════════════════════════════════════════════
 *
 * ── brands/{brandId} ────────────────────────────────────────
 * {
 *   id:               string,            // Firebase Auth UID
 *   brandName:        string,
 *   username:         string,            // unique handle
 *   email:            string,
 *   photoURL:         string,
 *   color:            number,            // hex int, e.g. 0xC6A85E
 *   tier:             'free'|'tier1'|'tier2'|'tier3',
 *   activationStatus: 'active'|'inactive',
 *   coins:            number,            // current coin balance
 *   coinsSpentTotal:  number,            // for leaderboard scoring
 *   slotCount:        number,            // total across all industries
 *   buildingHeightTotal: number,         // for leaderboard scoring
 *   createdAt:        Timestamp,
 *   lastSeen:         Timestamp,
 *   verified:         boolean,
 * }
 *
 * ── brands/{brandId}/slots (subcollection) ──────────────────
 * Document ID: `${industry}_${planetIndex}_${slotIndex}`
 * {
 *   slotIndex:    number,
 *   industry:     string,
 *   planetIndex:  number,
 *   buildingId:   string|null,
 *   purchasedAt:  Timestamp,
 *   pricePaid:    number,
 * }
 *
 * ── worlds/{worldKey} ───────────────────────────────────────
 * worldKey = `${industryEncoded}_${planetIndex}`, e.g. "technology_0"
 * {
 *   industry:         string,
 *   planetIndex:      number,
 *   occupiedCount:    number,
 *   totalSlots:       number,       // always 10000
 *   planetMultiplier: number,       // price scale
 *   unlocked:         boolean,
 *   unlockedAt:       Timestamp|null,
 *   themeId:          string,       // from PLANET_THEMES
 *   createdAt:        Timestamp,
 * }
 *
 * ── worlds/{worldKey}/slots (subcollection) ─────────────────
 * Document ID: slotIndex as string, e.g. "4521"
 * {
 *   slotIndex:    number,
 *   ownerId:      string|null,       // brandId
 *   buildingId:   string|null,
 *   locked:       boolean,           // true during active auction
 *   type:         'normal'|'mountain'|'central',
 *   premiumMult:  number,
 *   heightY:      number,            // terrain elevation
 * }
 *
 * ── worlds/{worldKey}/buildings (subcollection) ─────────────
 * Document ID: buildingId (UUID)
 * {
 *   buildingId:   string,
 *   slotIndex:    number,
 *   brandId:      string,
 *   catalogId:    string,            // BUILDING_CATALOG key
 *   floors:       number,
 *   color:        number,            // brand's color
 *   logoUrl:      string|null,
 *   builtAt:      Timestamp,
 *   upgradedAt:   Timestamp|null,
 * }
 *
 * ── worlds/{worldKey}/leaderboard (subcollection) ───────────
 * Document ID: brandId
 * {
 *   brandId:            string,
 *   brandName:          string,
 *   color:              number,
 *   slotCount:          number,
 *   buildingHeightTotal: number,
 *   coinsSpent:         number,
 *   score:              number,       // precomputed on write
 *   updatedAt:          Timestamp,
 * }
 *
 * ── auctions/{auctionId} ────────────────────────────────────
 * {
 *   auctionId:     string,
 *   slotIndex:     number,
 *   industry:      string,
 *   planetIndex:   number,
 *   startPrice:    number,
 *   minIncrement:  number,
 *   currentBid:    number|null,
 *   currentBidder: string|null,       // brandId
 *   bids: [                           // array, max 200 entries
 *     { brandId, amount, placedAt: Timestamp }
 *   ],
 *   state:         'pending'|'active'|'closed'|'settled'|'cancelled',
 *   createdBy:     string,
 *   createdAt:     Timestamp,
 *   startsAt:      Timestamp,
 *   endsAt:        Timestamp,
 *   settledAt:     Timestamp|null,
 *   winnerId:      string|null,
 * }
 *
 * ── transactions/{txId} ─────────────────────────────────────
 * {
 *   id:          string,
 *   type:        TX_TYPE value,
 *   amount:      number,
 *   brandId:     string,
 *   meta: {
 *     slotIndex?:   number,
 *     buildingId?:  string,
 *     industry?:    string,
 *     planetIndex?: number,
 *     auctionId?:   string,
 *   },
 *   status:      'pending'|'confirmed'|'failed'|'rolled_back',
 *   createdAt:   Timestamp,
 *   confirmedAt: Timestamp|null,
 * }
 *
 * ═══════════════════════════════════════════════════════════
 * FIRESTORE INDEXES (create in Firebase Console)
 * ═══════════════════════════════════════════════════════════
 *
 * Collection: auctions
 *   Fields: industry ASC, planetIndex ASC, state ASC, endsAt DESC
 *
 * Collection: worlds/{worldKey}/leaderboard
 *   Fields: score DESC
 *
 * Collection: brands/{brandId}/slots
 *   Fields: industry ASC, purchasedAt DESC
 *
 * Collection: transactions
 *   Fields: brandId ASC, createdAt DESC
 *
 * ═══════════════════════════════════════════════════════════
 * CLOUD FUNCTIONS (recommended)
 * ═══════════════════════════════════════════════════════════
 *
 * onSlotPurchase:
 *   - Verify coin balance
 *   - Deduct coins atomically (transaction)
 *   - Write slot occupancy
 *   - Create basic building doc
 *   - Update world occupiedCount
 *   - Update leaderboard score
 *   - Check expansion threshold → unlock next planet if needed
 *
 * onBuildingUpgrade:
 *   - Verify brand owns the slot
 *   - Verify coin balance
 *   - Deduct coins
 *   - Update building floors
 *   - Update brand.buildingHeightTotal
 *   - Recalculate leaderboard score
 *
 * onAuctionSettle:
 *   - Called by Cloud Scheduler at auction.endsAt
 *   - Identify winner (highest bid)
 *   - Transfer slot ownership
 *   - Deduct winning bid
 *   - Refund all losing bids
 *   - Update auction.state = 'settled'
 *
 * onMonthlyGrantCron:
 *   - Called 1st of each month
 *   - For each active brand, add tier.monthlyCoins to balance
 *   - Create transaction record
 *
 * ═══════════════════════════════════════════════════════════
 * SHARDING STRATEGY (for scale)
 * ═══════════════════════════════════════════════════════════
 *
 * When industries grow beyond a single Firestore database:
 *   - Each industry gets its own Firestore "named database" (GA feature)
 *   - Route API requests to the correct database by industry
 *   - worlds/{worldKey} → industry-scoped database
 *   - brands/{brandId} → shared global database
 *
 * Slot write throughput:
 *   - Use distributed counters for occupiedCount (avoid hotspot)
 *   - Shard leaderboard writes: each brand writes to its own doc only
 *   - Aggregate leaderboard via Cloud Function on a 30s schedule
 */

export {};  // module marker only
