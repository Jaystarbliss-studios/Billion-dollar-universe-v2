# 🌍 Billion Dollar Webpage – Complete Workspace Guide

> **A virtual universe where brands compete for visibility, users earn rewards, and admins maintain the ecosystem.**
> Built with vanilla JavaScript, Three.js, Firebase, and Paystack.

---

## 📑 Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Repository Structure](#repository-structure)
4. [Authentication & Roles](#authentication--roles)
5. [Core Workflows](#core-workflows)
6. [Data Models](#data-models)
7. [Key Pages Reference](#key-pages-reference)
8. [Cloud Functions API](#cloud-functions-api)
9. [Security Rules Summary](#security-rules-summary)
10. [Admin Dashboard Guide](#admin-dashboard-guide)
11. [Brand Universe Mechanics](#brand-universe-mechanics)
12. [Setup & Deployment](#setup--deployment)
13. [Development Guidelines](#development-guidelines)
14. [Troubleshooting](#troubleshooting)
15. [Future Roadmap](#future-roadmap)

---

## 1. Overview

The **Billion Dollar Webpage** is a 3D interactive platform where:

- **Brands** (businesses, creators, organizations) can purchase virtual real‑estate on industry‑specific planets, construct buildings, and gain visibility.
- **Users** (regular visitors) can support brands, earn credit rewards, and explore the universe.
- **Admins** manage the ecosystem: verify brand identities, oversee slots, review activity, and maintain platform health.

The universe is rendered as a rotating globe using **Three.js**, with each industry (Technology, Fashion, Finance, etc.) represented as a separate planet. Slots are color‑coded zones that brands can own and develop.

---

## 2. System Architecture

### High-Level Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   index.html    │────▶│  Firebase Auth   │────▶│ Firestore Database  │
│ (Landing Page)  │     │  (Google OAuth)  │     │  (users, brands,    │
└─────────────────┘     └──────────────────┘     │   worlds, etc.)     │        │                      └─────────────────────┘        │
        │                                              │
        ▼                                              ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Onboarding/     │     │   Cloud Functions│◀────│   Admin Panel       │
│ Dashboards      │     │  (Slot purchase, │     │ (admin-dashboard    │
│ (brand/user)    │────▶│   building, etc.)│     │  + subpages)       │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
        │
        ▼
┌─────────────────┐
│ brand-universe  │
│   (3D Globe)    │
└─────────────────┘
```

### Core Modules

- **Auth**: Firebase Authentication with Google.
- **Database**: Firestore collections with RBAC security rules.
- **Serverless**: Cloud Functions for atomic transactions (slot purchase, building upgrade, auction settlement, monthly grants, leaderboard recalculation).
- **Payments**: Paystack for NGN activation and verification fees.
- **3D Engine**: Three.js (CSS3DRenderer + WebGLRenderer) for the universe.

---

## 3. Repository Structure

```
/ (project root)
├── index.html                 # Landing page (hero, login buttons)
├── brand-onboarding.html      # Brand registration wizard
├── user-onboarding.html       # User profile creation
├── brand-dashboard.html       # Brand stats, activation, verification
├── user-dashboard.html        # User stats, brand support grid
├── brand-universe.html        # 3D interactive globe (main app)
├── admin.html                 # Legacy admin (simple brand verification)
├── admin.css                  # Shared admin stylesheet (dark theme)
├── admin-common.js            # Shared admin JS (auth, profile, nav)
├── admin-dashboard.html       # Admin hub with stats & logs
├── admin-users.html           # User list & role editor
├── admin-brands.html          # Brand management (approve, activate)
├── admin-slots.html           # Browse all slots by world
├── admin-analytics.html       # Placeholder for future analytics
├── admin-leaderboard.html     # Global leaderboard viewer
├── admin-ads.html             # Placeholder for ad review
├── admin-reports.html         # Placeholder for user reports
├── brand-universe-next/       # Modular rewrite (unused)
│   ├── config/
│   └── js/
├── scripts/
│   └── firebase-config.js     # Firebase SDK config
├── functions/
│   ├── index.js               # Cloud Functions source
│   └── package.json
├── firebase.json              # Firebase project settings
├── firestore.rules            # Security rules (version 2)
├── assets/
│   ├── images/
│   ├── videos/
│   └── textures/              # Globe textures (earth, bump, specular)
├── node_modules/              # (if Functions installed)
└── README.md                  # This file
```

---

## 4. Authentication & Roles

### Login Flow

1. User clicks **"Login as Brand"** or **"Login as User"** on `index.html`.
2. Google OAuth popup opens via `firebase.auth().signInWithPopup()`.
3. After success, `routeUser()` checks document existence in Firestore:
   - **Brand**: `brands/{uid}` → if exists → `brand-dashboard.html`, else `brand-onboarding.html`.
   - **User**: `users/{uid}` → if exists → `user-dashboard.html`, else `user-onboarding.html`.
4. Onboarding pages create the appropriate document.

### Role System

Three roles: `user`, `brand`, `admin`.

#### How Roles Are Determined

**Client‑side** (`brand-universe.html` `detectRole()`):

- Reads `users/{uid}.role` from Firestore.
- If that role is `brand`, loads associated `brands/{brandId}` data.
- Overrides to `admin` if email equals `johnrufai242@gmail.com`.
- Returns: `{ uid, role, brandId, displayName, photoURL, handle, activationStatus }`.

**Server‑side** (Firestore rules):

- Uses JWT custom claim: `request.auth.token.get('role', 'user')`.
- Also checks `request.auth.token.email` for the hardcoded admin fallback.

#### Permission Enforcement

- **Firestore Rules**: Primary security boundary (must be respected by all clients).
- **Client UI**: Hides/show components based on `CAPABILITIES` that map actions to allowed roles.

#### Capabilities Matrix

```javascript
CAPABILITIES = {
  EXPLORE_UNIVERSE:       ['user','brand','admin'],
  BUY_SLOT:               ['user','brand','admin'],
  TRADE_SLOT:             ['user','brand','admin'],
  EARN_CREDITS:           ['user','admin'],
  WATCH_ADS:              ['user','admin'],
  SPEND_CREDITS:          ['user','brand','admin'],
  UPLOAD_AD:              ['brand','admin'],
  SCHEDULE_AD:            ['brand','admin'],
  VIEW_OWN_ANALYTICS:     ['brand','admin'],
  MANAGE_BRAND_PROFILE:   ['brand','admin'],
  BUY_BOOST:              ['brand','admin'],
  VIEW_ALL_ANALYTICS:     ['admin'],
  OVERRIDE_OWNERSHIP:     ['admin'],
  MANAGE_USERS:           ['admin'],
  WRITE_LEADERBOARD:      ['admin']
}
```

---

## 5. Core Workflows

### 5.1 User Registration & Onboarding

1. On `index.html`, click **"Join as User"** → OAuth.
2. Post‑auth, `routeUser('signup-user')` checks for `users/{uid}`.
3. If missing, redirects to `user-onboarding.html`.
4. Form collects: full name, username (unique), country, interests.
5. Submits to create document in `users` collection (note: current onboarding does **not** set `role` field – you should add `role: 'user'`).
6. Redirects to `user-dashboard.html`.

### 5.2 Brand Registration & Activation

1. On `index.html`, click **"Join as Brand"** → OAuth.
2. `routeUser('signup-brand')` checks for `brands/{uid}`.
3. If missing → `brand-onboarding.html`.
4. Form collects: brand name, username, category, industry, location, social links, description, etc.
5. Submits to create document in `brands` collection (requires `brand` role in token; see gap note below).
6. Redirects to `brand-dashboard.html`.
7. **Activation**: Click "Activate Now" → Paystack payment (₦1,000). On success, `activationStatus` set to `active`, `publicVisibility: true`.
8. **Verification**: After activation, click "Apply for Verification" → Paystack payment (₦5,000). Status becomes `under_review`.
9. Admin must approve → `verificationStatus: verified`, `verifiedBadge: true`.

**⚠️ Known Gap**: The security rules require `isBrandRole()` to create a brand document, but onboarding does not set the user's role to `brand` nor set custom claims. You must either:
- Set the `role` field in the `users` document to `'brand'` **before** brand onboarding, or
- Adjust Firestore rules to allow brand creation for authenticated users, or
- Use a Cloud Function to set the custom claim immediately after signup.

### 5.3 Universe Exploration

From any dashboard, click **"Explore Universe"** → loads `brand-universe.html`.

- **Planets**: Each industry (from brand categories) is a textured sphere positioned around the globe.
- **Slot Purchase**: Users/brands click an empty slot → modal shows price → Paystack payment → `onSlotPurchase` function creates slot record and a building of type "standard".
- **Building Upgrade**: Building can be upgraded with in‑game coins; `onBuildingUpgrade` increases floors and height.
- **Sidebar**: Dynamic based on role; admin sees additional admin navigation links.

### 5.4 Admin Operations

- **Login**: Use `johnrufai242@gmail.com` (or any email you configure as admin).
- **Direct Access**: After login, you can modify `index.html` `routeUser` to redirect admin to `admin-dashboard.html`; otherwise click **"Admin Panel"** from the universe sidebar.
- **Dashboard**: Shows real‑time counts (users, brands, slots, active brands), recent transactions, pending verifications, activity log.
- **Manage Users**: List all user documents; change role via dropdown (`user`, `brand`, `admin`). Saves directly to `users/{uid}.role`.
- **Manage Brands**: Filter by verification/activation; Approve/Reject verification; Activate/Deactivate brands.
- **All Slots**: Browse occupied slots per world or across all worlds (limited to first 100 per world for performance).
- **Leaderboard**: Views combined leaderboard entries from all world subcollections.

All admin actions are logged to `adminLog/{entry}` automatically.

---

## 6. Data Models

Detailed JSON schemas are provided in the Cloud Functions (`functions/index.js`) comments and in the earlier exploration. Here’s a quick reference:

### Collections

| Collection | Document ID | Purpose |
|-----------|-------------|---------|
| `users` | Firebase UID | Regular user profiles |
| `brands` | Brand’s Firebase UID | Brand profiles (extensive fields) |
| `worlds` | `<industry>_0` (e.g., `technology_0`) | Industry planet metadata |
| `worlds/{worldKey}/slots` | Slot index (0‑9999) | Slot ownership, building, type |
| `worlds/{worldKey}/buildings` | Auto‑ID | Building details (floors, color, logo) |
| `worlds/{worldKey}/leaderboard` | Brand ID | Ranked scores for that world |
| `transactions` | Auto‑ID | Coin/fiat transactions |
| `creditTransactions` | Auto‑ID | User credit redemptions |
| `auctions` | Auction ID | Slot auction listings |
| `adminLog` | Auto‑ID | Audit trail of admin actions |

---

## 7. Key Pages Reference

| Page | Purpose | Key Functions |
|------|---------|---------------|
| `index.html` | Landing & auth | `startAuth(flow)`, `routeUser(flow)` |
| `brand-onboarding.html` | Brand setup | Form validation, doc creation, username uniqueness check |
| `user-onboarding.html` | User setup | Form validation, doc creation |
| `brand-dashboard.html` | Brand home | `showTab()`, Paystack popups, world navigation |
| `user-dashboard.html` | User home | Brand grid, support button |
| `brand-universe.html` | 3D universe | 1500+ lines of Three.js logic, `detectRole()`, `buildSidebar()`, slot/building interactions |
| `admin-dashboard.html` | Admin home | Stat loading, verification approve/reject, activity log |
| `admin-users.html` | User management | Role editing, save with audit log |
| `admin-brands.html` | Brand management | Filters, actions (approve, reject, toggle activation) |
| `admin-slots.html` | Slot browser | World selector, slot data table |
| `admin-leaderboard.html` | Leaderboard viewer | Collection‑group query across worlds |

---

## 8. Cloud Functions API

All functions are **callable** via `firebase.functions().httpsCallable('functionName')`.

### `onSlotPurchase(data)`

Purchases a slot and creates a building.

**Args**:
```javascript
{
  worldKey: string,
  slotIndex: number,
  type: 'standard' | 'premium',
  premiumMult: number,      // price multiplier relative to standard
  // ... other fields
}
```

**Logic**:
- Checks user auth and brand role.
- Starts transaction: ensure slot free, deduct coins (cost = base price × premiumMult), create slot record, create building, update world’s `occupiedCount`.
- Creates `transactions` record with `txId`, `type: 'slot_purchase'`, amount.
- On failure, throws HttpsError.

### `onBuildingUpgrade(data)`

Upgrades an existing building (adds floors).

**Args**:
```javascript
{
  worldKey: string,
  buildingId: string,
  floorsToAdd: number,
  costCoins: number
}
```

**Logic**:
- Deduct brand coins, increase floors, update `buildingHeightTotal`, set `upgradedAt`.

### `onAuctionSettle(data)`

Closes an auction and awards slot to highest bidder.

**Args**:
```javascript
{
  auctionId: string
}
```

**Logic**:
- Determines winner, transfers slot ownership, refunds losing bids.
- Creates settlement record.

### `onMonthlyGrant(context)`

Scheduled function (`every 30 days`). Grants coins to brands based on tier.

### `recalcLeaderboard(data)`

Recalculates a brand’s score in a specific world.

**Args**:
```javascript
{
  worldKey: string,
  brandId: string
}
```

---

## 9. Security Rules Summary

**Version**: `'2'`

**Principle**: Use JWT custom claims for role checks; fallback to document fields for client‑side convenience.

**Key Functions**:
```javascript
function isLoggedIn() = request.auth != null
function claimRole() = request.auth.token.get('role', 'user')
function isAdmin() = isLoggedIn() && (claimRole() == 'admin' || request.auth.token.email == 'johnrufai242@gmail.com')
function isBrandRole() = claimRole() == 'brand'
function isOwner(uid) = request.auth.uid == uid
function isBrandOwner(brandId) = request.auth.uid == brandId
```

**Collection Permissions**:
- `/users`: Self‑create with `role: 'user'`; self‑update except server fields; admin full access.
- `/brands`: Public read; create requires `isBrandRole() && isBrandOwner`; update by owner (limited) or admin.
- `/worlds/{worldKey}/slots`: Public read; any authenticated user can create (purchase); update by owner only.
- `/adminLog`: Admin only.

---

## 10. Admin Dashboard Guide

### Access

- Login with admin email (`johnrufai242@gmail.com`).
- After login, modify `index.html` `routeUser()` to auto‑redirect to `admin-dashboard.html` (recommended) or click **"Admin Panel"** from `brand-universe.html` sidebar.

### Files

| File | Description |
|------|-------------|
| `admin.css` | Dark theme shared by all admin pages |
| `admin-common.js` | Auth check, profile load, active nav, logout |
| `admin-dashboard.html` | Hub: stats, recent tx, pending verifications, activity log |
| `admin-users.html` | List users, change role (`user`/`brand`/`admin`) |
| `admin-brands.html` | List brands with filters, approve/reject verification, toggle activation |
| `admin-slots.html` | Browse all slots (optionally filter by world) |
| `admin-leaderboard.html` | Global leaderboard across worlds |
| `admin-analytics.html` | Placeholder – future aggregated metrics |
| `admin-ads.html` | Placeholder – ad moderation |
| `admin-reports.html` | Placeholder – user reports |

### Common Features

- All pages load Firebase SDKs and `firebase-config.js`.
- `admin-common.js` runs on load; redirects non‑admin.
- Profile picture and username pulled from `users/{uid}` (or Firebase user data).
- All actions log to `adminLog` via `logAdminAction()`.

---

## 11. Brand Universe Mechanics

### 3D Scene

- **Renderer**: Combination of `CSS3DRenderer` (for HTML labels) and `WebGLRenderer` (for textured planets, slot circles).
- **Planets**: Created per industry from `PLANETS_DATA` (config/planets.js). Each planet has a material and position on a sphere.
- **Slot Grid**: Each world generates a geodesic grid of slots (points on the planet). Slot state (owner, building) determines color.

### Data Flow

1. On load, `init()` fetches `users/{uid}` to detect role.
2. If brand, fetches `brands/{brandId}`.
3. `WorldCache.load(worldKey)` populates slot/building data.
4. Scene builds planets and slot circles (green = free, blue = owned by user, brand colors otherwise).
5. Sidebar rendered based on role; actions (buy slot, upgrade building) call Cloud Functions.

### Interactions

- **Raycaster** detects mouse over slot/hub → tooltip shows info.
- **Click slot** → if free and sufficient coins, opens purchase modal.
- **Click building** → opens building details with upgrade button.
- **Search bar** → filter worlds by industry/category.

---

## 12. Setup & Deployment

### Prerequisites

- Node.js ≥ 18
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project with **Authentication**, **Firestore**, **Functions** enabled.
- Paystack account (public key).

### Configuration Steps

1. **Firebase Config**: Edit `scripts/firebase-config.js` with your project credentials.
2. **Paystack Key**: Update `PAYSTACK_KEY` in `brand-dashboard.html` and `brand-onboarding.html`.
3. **Admin Email**: Update `ADMIN_EMAIL` in `admin-common.js` (and optionally `index.html` routeUser logic).
4. **Firestore Rules**: Deploy `firestore.rules` (`firebase deploy --only firestore:rules`).
5. **Cloud Functions**: `cd functions && npm install && cd ..` then `firebase deploy --only functions`.
6. **Hosting**: `firebase deploy --only hosting`.

For detailed setup (including creating the Firebase project, enabling Google auth, etc.), see the original `README.md` sections in this file.

---

## 13. Development Guidelines

### Adding New Admin Pages

- Copy the structure from `admin-dashboard.html` or any existing admin page.
- Include `<script src="admin-common.js"></script>` and your custom script after it.
- Use `adminLog` for any write actions.
- Follow the dark theme (`admin.css`) variables.

### Modifying brand-universe

- The file is monolithic; consider moving new code to the `brand-universe-next/` modular architecture when possible.
- When adding new data fields, ensure they are added to Firestore rules and client validation.

### Role Checks

- Do not rely solely on client‑side role hiding; Firestore rules are the source of truth.
- If you need to support multiple admins, implement a Cloud Function to set custom claims and modify `admin-common.js` to check `claimRole() === 'admin'` instead of hardcoded email.

---

## 14. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Brand onboarding fails with "permission‑denied" | User lacks `brand` role | Create user doc with `role: 'brand'` manually or implement role‑setting function |
| Admin page redirects to index | Not logged in as admin email | Check `admin-common.js` `ADMIN_EMAIL` matches your account |
| Slots not showing in admin‑slots | Worlds collection empty or slots not created | Ensure brands have purchased slots first |
| Paystack modal doesn't open | Missing/invalid `PAYSTACK_KEY` | Verify key starts with `pk_test_` or `pk_live_` |
| 3D globe is black or missing textures | `assets/textures/` missing or path wrong | Verify texture files (earth.jpg, earth bump, specular) exist |
| Functions deploy fails | Missing dependencies or Node version | Run `npm install` in `functions/`, ensure Node ≥ 18 |
| Users can see private brands | Firestore rules too permissive | Rules should restrict `brands` read to `activationStatus == 'active'` for public |

---

## 15. Future Roadmap

- [ ] **Modular Universe**: Complete migration to `brand-universe-next/` architecture.
- [ ] **Server‑Side Role Engine**: Cloud Function to set custom claims based on user type.
- [ ] **Ads System**: Upload, schedule, and display ad creatives.
- [ ] **Analytics Module**: Global metrics, heatmaps, retention charts.
- [ ] **Real‑Time Updates**: Firestore listeners for live slot changes.
- [ ] **Multi‑Admin Support**: UI to manage admin accounts.
- [ ] **Slot Transfer Market**: Secondary market for buying/selling slots.
- [ ] **User Achievements & Badges**: Gamification.
- [ ] **Mobile Optimization**: Responsive layouts for dashboards.
- [ ] **Public Brand Profiles**: SEO‑friendly pages for each brand.
- [ ] **Email Notifications**: Transactional emails via SendGrid/Mailgun.

---

## 📞 Support & Contact

For questions, bug reports, or contributions, please contact the project maintainer.

**Created by**: Jaystarbliss Studios
**© 2026 Billion Dollar Webpage. All rights reserved.**

---

*Last updated: 2025‑02‑19*