// ============================================
// FIREBASE CONFIGURATION FILE
// ============================================

/*
SETUP INSTRUCTIONS:

1. Go to https://console.firebase.google.com/
2. Create a new project called "billion-dollar-universe"
3. Enable Google Analytics (optional)
4. Click on the Web icon (</>) to add Firebase to your web app
5. Register your app with a nickname like "Billion Dollar Universe Web"
6. Copy the configuration object below and replace the placeholder values

7. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable "Google" provider
   - Add your domain to authorized domains

8. Create Firestore Database:
   - Go to Firestore Database
   - Create database in production mode
   - Choose your region (closest to your users)
   
9. Set up Firestore Security Rules (see bottom of this file)

10. Enable Storage (for brand logos later):
    - Go to Storage
    - Get started
    - Use default security rules for now
*/



// Firebase configuration
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_FIREBASE_API_KEY",
  authDomain: "billion-dollar-universe.firebaseapp.com",
  projectId: "billion-dollar-universe",
  storageBucket: "billion-dollar-universe.firebasestorage.app",
  messagingSenderId: "1027919840734",
  appId: "1:1027919840734:web:259327b4488d54c643c94f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Export for use in other files
window.auth = auth;
window.db = db;

//firebase.firestore().useEmulator('localhost', 8080);
// firebase.functions().useEmulator('localhost', 5001); // Commented out - Functions SDK not loaded
/*
rules_version = '2';

// ═══════════════════════════════════════════════════════════════════
//  BRAND UNIVERSE — FIRESTORE SECURITY RULES
//  Version: 2.1 (RBAC Edition — cityQueue + parcel purchase fix)
// ═══════════════════════════════════════════════════════════════════

service cloud.firestore {
  match /databases/{database}/documents {

    // ── HELPER FUNCTIONS ──────────────────────────────────────────

    function isLoggedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    function claimRole() {
      return request.auth != null
        ? (request.auth.token.get('role', 'user'))
        : 'user';
    }

    function isUserRole()  { return isLoggedIn() && claimRole() == 'user';  }
    function isBrandRole() { return isLoggedIn() && claimRole() == 'brand'; }
    function isAdminRole() { return isLoggedIn() && claimRole() == 'admin'; }

    function isAdmin() {
      return isLoggedIn() && (
        claimRole() == 'admin' ||
        request.auth.token.email == 'johnrufai242@gmail.com'
      );
    }

    function claimBrandId() {
      return request.auth != null
        ? request.auth.token.get('brandId', null)
        : null;
    }

    function isBrandOwner(brandId) {
      return isBrandRole() && (
        claimBrandId() == brandId ||
        request.auth.uid == brandId
      );
    }

    function slotIsAvailable(worldKey, slotId) {
      return !exists(/databases/$(database)/documents/worlds/$(worldKey)/slots/$(slotId))
        || get(/databases/$(database)/documents/worlds/$(worldKey)/slots/$(slotId)).data.ownerId == null;
    }

    function doesNotTouch(fields) {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(fields);
    }

    function onlyContains(allowedKeys) {
      return request.resource.data.keys().hasOnly(allowedKeys);
    }

    function isValidVideoUrl(url) {
      return url.matches('https://(www\\.)?(youtube\\.com|youtu\\.be|vimeo\\.com)/.+');
    }


    // ══════════════════════════════════════════════════════════════
    //  USERS   /users/{uid}
    // ══════════════════════════════════════════════════════════════
    match /users/{uid} {

      allow read: if isLoggedIn();

      // Self-create on first sign-in (also allows auto-create from boot sequence)
      allow create: if isOwner(uid)
        && request.resource.data.keys().hasAll(['role', 'createdAt'])
        && request.resource.data.role == 'user'
        && (!('credits' in request.resource.data) || request.resource.data.credits == 0);

      // Users update own profile — never credits/role/totalClicks directly
      allow update: if isOwner(uid)
        && doesNotTouch(['credits', 'role', 'totalClicks', 'engagementScore', 'brandId'])
        && (!('uid' in request.resource.data) || request.resource.data.uid == uid);

      allow update: if isAdmin();
      allow delete: if false;
    }


    // ══════════════════════════════════════════════════════════════
    //  BRANDS   /brands/{brandId}
    // ══════════════════════════════════════════════════════════════
    match /brands/{brandId} {

      allow read: if true;

      allow create: if (isBrandRole() && isOwner(brandId)) || isAdmin();

      allow update: if isBrandOwner(brandId)
        && doesNotTouch(['boostCredits', 'coins', 'ownerUid', 'tier', 'slotCount', 'coinsSpentTotal']);

      allow update: if isAdmin();
      allow delete: if false;

      match /slots/{slotDoc} {
        allow read:   if isLoggedIn();
        allow create: if isBrandOwner(brandId)
          && request.resource.data.slotIndex is int
          && request.resource.data.industry   is string;
        allow update: if isBrandOwner(brandId);
        allow delete: if false;
      }

      match /analytics/{docId} {
        allow read:  if isBrandOwner(brandId) || isAdmin();
        allow write: if isAdmin();
      }
    }


    // ══════════════════════════════════════════════════════════════
    //  WORLDS / SLOTS / BUILDINGS   /worlds/{worldKey}/...
    // ══════════════════════════════════════════════════════════════
    match /worlds/{worldKey} {

      allow read: if isLoggedIn();
      allow write: if isAdmin();

      match /slots/{slotId} {
        allow read: if isLoggedIn();

        allow create: if isLoggedIn()
          && request.resource.data.ownerId == request.auth.uid
          && slotIsAvailable(worldKey, slotId)
          && (
            (isUserRole()  && request.resource.data.ownerType == 'user')  ||
            (isBrandRole() && request.resource.data.ownerType == 'brand') ||
            isAdmin()
          )
          && request.resource.data.keys().hasAll(['slotIndex', 'ownerId', 'ownerType', 'buildingFloors'])
          && request.resource.data.buildingFloors == 1;

        allow update: if isLoggedIn()
          && resource.data.ownerId == request.auth.uid
          && doesNotTouch(['ownerId', 'ownerType', 'slotIndex', 'pricePaid', 'purchasedAt']);

        allow update: if isAdmin();
        allow delete: if false;
      }

      match /buildings/{buildingId} {
        allow read: if isLoggedIn();
        allow create: if isLoggedIn()
          && request.resource.data.brandId == request.auth.uid;
        allow update: if isLoggedIn()
          && resource.data.brandId == request.auth.uid;
        allow delete: if false;
      }

      match /leaderboard/{entry} {
        allow read:  if isLoggedIn();
        allow write: if isAdmin();
      }
    }


    // ══════════════════════════════════════════════════════════════
    //  ADS   /ads/{adId}
    // ══════════════════════════════════════════════════════════════
    match /ads/{adId} {

      allow read: if isLoggedIn();

      allow create: if isBrandRole()
        && request.resource.data.brandId == claimBrandId()
        && isValidVideoUrl(request.resource.data.videoUrl)
        && request.resource.data.keys().hasAll(['brandId', 'videoUrl', 'title', 'createdAt'])
        && request.resource.data.get('impressions', 0) == 0
        && request.resource.data.get('status', 'pending') == 'pending';

      allow update: if isBrandRole()
        && resource.data.brandId == claimBrandId()
        && doesNotTouch(['impressions', 'status', 'brandId', 'createdAt'])
        && (
          !('videoUrl' in request.resource.data) ||
          isValidVideoUrl(request.resource.data.videoUrl)
        );

      allow update: if isAdmin();
      allow delete: if isAdmin();
    }


    // ══════════════════════════════════════════════════════════════
    //  AD SCHEDULES   /adSchedules/{scheduleId}
    // ══════════════════════════════════════════════════════════════
    match /adSchedules/{scheduleId} {
      allow read: if isLoggedIn()
        && (resource.data.brandId == claimBrandId() || isAdmin());
      allow create: if isBrandRole()
        && request.resource.data.brandId == claimBrandId()
        && request.resource.data.keys().hasAll(['brandId', 'adId', 'startTime', 'endTime']);
      allow update: if isBrandRole()
        && resource.data.brandId == claimBrandId()
        && doesNotTouch(['brandId', 'adId']);
      allow delete: if isBrandRole()
        && resource.data.brandId == claimBrandId();
    }


    // ══════════════════════════════════════════════════════════════
    //  CREDIT TRANSACTIONS   /creditTransactions/{txId}
    // ══════════════════════════════════════════════════════════════
    match /creditTransactions/{txId} {

      allow read: if isLoggedIn()
        && resource.data.uid == request.auth.uid;

      allow create: if isUserRole()
        && request.resource.data.uid     == request.auth.uid
        && request.resource.data.status  == 'pending'
        && request.resource.data.amount  is int
        && request.resource.data.amount  > 0
        && request.resource.data.amount  <= 100
        && request.resource.data.source  in ['ad_watch', 'referral', 'engagement']
        && doesNotTouch(['processedAt', 'approved']);

      allow update: if false;
      allow delete: if false;
      allow read:   if isAdmin();
    }


    // ══════════════════════════════════════════════════════════════
    //  SLOT PURCHASE TRANSACTIONS   /transactions/{txId}
    // ══════════════════════════════════════════════════════════════
    match /transactions/{txId} {
      allow read: if isLoggedIn()
        && resource.data.brandId == request.auth.uid;
      allow create: if isLoggedIn()
        && request.resource.data.brandId == request.auth.uid
        && request.resource.data.status == 'pending';
      allow update: if false;
      allow delete: if false;
    }


    // ══════════════════════════════════════════════════════════════
    //  AUCTIONS   /auctions/{auctionId}
    // ══════════════════════════════════════════════════════════════
    match /auctions/{auctionId} {
      allow read: if isLoggedIn();
      allow create: if isAdmin();
      allow update: if isLoggedIn()
        && resource.data.state == 'active'
        && request.resource.data.state == 'active'
        && request.resource.data.currentBidder == request.auth.uid
        && request.resource.data.currentBid    >  resource.data.currentBid
        && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['currentBid', 'currentBidder', 'lastBidAt']);
      allow delete: if false;
    }


    // ══════════════════════════════════════════════════════════════
    //  ADMIN AUDIT LOG   /adminLog/{entry}
    // ══════════════════════════════════════════════════════════════
    match /adminLog/{entry} {
      allow read:  if isAdmin();
      allow write: if isAdmin();
    }


    // ══════════════════════════════════════════════════════════════
    //  CITY WORLDS   /cities/{cityId}
    // ══════════════════════════════════════════════════════════════
    match /cities/{cityId} {

      allow read: if isLoggedIn();
      allow create, update: if isAdmin();
      allow delete: if false;

      match /parcels/{parcelId} {
        allow read: if isLoggedIn();

        allow create: if isLoggedIn()
          && request.auth.uid != null
          && request.resource.data.ownerId == request.auth.uid
          && request.resource.data.ownerType in ['user', 'brand']
          && request.resource.data.parcelId == parcelId
          && request.resource.data.pricePaid is int
          && request.resource.data.pricePaid > 0
          && request.resource.data.keys().hasAll([
            'parcelId', 'ownerId', 'ownerType', 'districtName',
            'zoneType', 'bounds', 'centerLat', 'centerLon',
            'basePrice', 'pricePaid', 'purchasedAt'
          ])
          && doesNotTouch([
            'buildingType', 'buildingTier', 'buildingBuiltAt', 'pointsPerDay'
          ]);

        allow update: if isLoggedIn()
          && resource.data.ownerId == request.auth.uid
          && doesNotTouch([
            'ownerId', 'ownerType', 'parcelId', 'basePrice',
            'pricePaid', 'purchasedAt', 'districtName', 'zoneType',
            'bounds', 'centerLat', 'centerLon'
          ])
          && request.resource.data.keys().hasOnly([
            'buildingType', 'buildingTier', 'buildingBuiltAt', 'pointsPerDay'
          ]);

        allow delete: if false;
      }

      match /leaderboard/{entry} {
        allow read:  if isLoggedIn();
        allow write: if isAdmin();
      }

      match /auction/{auctionId} {
        allow read: if isLoggedIn();
        allow create: if isAdmin();
        allow update: if isLoggedIn()
          && resource.data.state == 'active'
          && request.resource.data.state == 'active'
          && request.resource.data.currentBid > resource.data.currentBid
          && request.resource.data.currentBidder == request.auth.uid
          && request.resource.data.diff(resource.data).affectedKeys()
                .hasOnly(['currentBid', 'currentBidder', 'lastBidAt']);
        allow delete: if false;
      }
    }


    // ══════════════════════════════════════════════════════════════
    //  CITY QUEUE   /cityQueue/{docId}
    //  ✅ FIX: Must match /{docId} not just /cityQueue
    // ══════════════════════════════════════════════════════════════
    match /cityQueue/{docId} {
      allow read:  if isLoggedIn();
      allow write: if isAdmin();
    }


    // ══════════════════════════════════════════════════════════════
    //  CATCH-ALL — deny everything not explicitly permitted
    // ══════════════════════════════════════════════════════════════
    match /{document=**} {
      allow read, write: if false;
    }

  }
}
*/
