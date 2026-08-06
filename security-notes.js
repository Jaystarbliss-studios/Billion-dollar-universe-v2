/**
 * ═══════════════════════════════════════════════════════════════════
 *  BRAND UNIVERSE — SECURITY ARCHITECTURE NOTES
 *  security-notes.md (rendered as JS comment for colocation)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  HOW THE LAYERS FIT TOGETHER
 *  ─────────────────────────────────────────────────────────────────
 *
 *  Layer 1: Firebase Auth Custom Claims  (primary role gate)
 *  ──────────────────────────────────────────────────────────
 *  When a user signs up, onUserCreated() Cloud Function fires and
 *  calls auth.setCustomUserClaims(uid, { role: 'user', brandId: null }).
 *
 *  Custom claims live IN the JWT token. Every Firestore request carries
 *  the token, so rules can check request.auth.token.role with ZERO
 *  extra document reads. This is the fastest and most reliable gate.
 *
 *  Claims are NOT user-writable. Only Cloud Functions (with admin SDK)
 *  can write them. So a malicious user cannot promote themselves by
 *  editing a Firestore document — the claim is the truth.
 *
 *  Layer 2: Firestore Security Rules  (server enforcement)
 *  ────────────────────────────────────────────────────────
 *  All rules in firestore.rules use claimRole() to read from the JWT.
 *  Document-read-based checks (e.g. slotIsAvailable) are kept minimal
 *  because they cost a read operation per rule evaluation.
 *
 *  Critical protections:
 *    ✓ credits / coins — no client write path exists at all
 *    ✓ role field — only admin can update via rules; claims by CF
 *    ✓ ownerId — cannot be changed after slot purchase
 *    ✓ impressions — only server (admin SDK) can increment
 *    ✓ ad URLs — regex-validated to YouTube/Vimeo only
 *    ✓ leaderboard — write-only via Cloud Function (scheduled)
 *    ✓ analytics — brand reads own only; admin reads all
 *    ✓ catch-all deny — any uncovered path is denied by default
 *
 *  Layer 3: role-engine.js  (UI / UX layer only)
 *  ─────────────────────────────────────────────
 *  detectRole() reads users/{uid}.role from Firestore for UI routing.
 *  This is NOT a security boundary — it only controls what HTML the
 *  user sees. A determined attacker who bypasses the UI would still
 *  be blocked by Layer 2.
 *
 *  hasCapability() gates sidebar items and page elements.
 *  requireRole() redirects unauthorised page visits.
 *
 *  These are belt-and-suspenders for UX, never for security.
 *
 *  Layer 4: Cloud Functions  (trusted compute)
 *  ────────────────────────────────────────────
 *  All operations that modify financial state run in Cloud Functions:
 *    - Credit award (processCreditTransaction)
 *    - Role promotion (promoteToBrand, assignRole)
 *    - Leaderboard aggregation (updateLeaderboard)
 *
 *  Cloud Functions use the admin SDK which bypasses Firestore rules.
 *  They are the only place where privileged writes can happen.
 *
 *  ─────────────────────────────────────────────────────────────────
 *  ATTACK SURFACE ANALYSIS
 *  ─────────────────────────────────────────────────────────────────
 *
 *  Attack: User edits their Firestore users/{uid}.role to 'admin'
 *  Defense: rules.update() blocks changes to the role field for
 *           non-admin callers. The JWT claim is still 'user'.
 *           Firestore rule checks claimRole() (JWT), not the document.
 *
 *  Attack: User sets credits to 99999 via direct Firestore write
 *  Defense: rules block ANY write to credits/coins fields.
 *           The only write path is Cloud Function → admin SDK.
 *
 *  Attack: User claims a slot that's already owned
 *  Defense: slotIsAvailable() exists() check in rules prevents create
 *           if the document already has an ownerId.
 *
 *  Attack: Brand reads another brand's analytics
 *  Defense: brands/{brandId}/analytics requires isBrandOwner(brandId),
 *           which checks the JWT brandId claim matches the document path.
 *
 *  Attack: User uploads a direct video file URL (bypassing CDN)
 *  Defense: isValidVideoUrl() regex in rules rejects anything that
 *           isn't youtube.com, youtu.be, or vimeo.com.
 *
 *  Attack: User bids on an auction and also changes the state
 *  Defense: auction update rule restricts affectedKeys() to only
 *           [currentBid, currentBidder, lastBidAt].
 *
 *  Attack: Client sends more than 100 credits in one transaction
 *  Defense: creditTransactions create rule checks amount <= 100.
 *           The Cloud Function also enforces a daily cap of 200.
 *
 *  ─────────────────────────────────────────────────────────────────
 *  CUSTOM CLAIMS FRESHNESS
 *  ─────────────────────────────────────────────────────────────────
 *  Firebase ID tokens expire every 1 hour. Custom claims only take
 *  effect on the NEXT token refresh. For immediate role changes
 *  (e.g. an admin banning a brand), the Cloud Function should also:
 *    1. Set the claim (takes effect after next refresh, ≤1hr)
 *    2. Write a 'revoked' flag to users/{uid} checked in rules
 *       as a belt-and-suspenders for the 1hr window.
 *
 *  For the leaderboard write-block, this window is acceptable because
 *  the damage window is at most 1 hour and the operation is low-value.
 *
 *  ─────────────────────────────────────────────────────────────────
 *  DEPLOYMENT CHECKLIST
 *  ─────────────────────────────────────────────────────────────────
 *  [ ] firebase deploy --only firestore:rules
 *  [ ] firebase deploy --only functions
 *  [ ] Verify custom claims are being set: firebase auth:export --format=json
 *  [ ] Test rules with Firebase Emulator: firebase emulators:start
 *  [ ] Run rules unit tests: firebase emulators:exec "npm test"
 *  [ ] Set ADMIN_EMAIL env var in functions config:
 *        firebase functions:config:set admin.email="johnrufai242@gmail.com"
 *  [ ] Add index for creditTransactions daily cap query:
 *        Collection: creditTransactions
 *        Fields: uid ASC, status ASC, processedAt ASC
 */
