/**
 * ═══════════════════════════════════════════════════════════════════
 *  BRAND UNIVERSE — ROLE ENGINE
 *  role-engine.js
 *
 *  Single source of truth for role detection, capability checks,
 *  and dynamic sidebar rendering.
 *
 *  SECURITY MODEL:
 *  ─ All server-enforced checks live in firestore.rules
 *  ─ This file provides UI-layer guards only (UX, not security)
 *  ─ Role is read from Firestore — NOT from localStorage/cookies
 *  ─ Claims-based checks (request.auth.token.role) are enforced
 *    server-side via a Cloud Function that sets custom claims on
 *    signup/role-change (see cloud-functions/setRoleClaim.js)
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─── ROLE CONSTANTS ───────────────────────────────────────────── */
const ROLES = Object.freeze({
  USER:  'user',
  BRAND: 'brand',
  ADMIN: 'admin',
});

/* ─── CAPABILITY MAP ────────────────────────────────────────────
   Each capability key maps to the minimum roles that may perform it.
   Order: most-permissive first so hasCapability() is a simple .includes().
─────────────────────────────────────────────────────────────────── */
const CAPABILITIES = Object.freeze({
  // Exploration
  EXPLORE_UNIVERSE:     [ROLES.USER, ROLES.BRAND, ROLES.ADMIN],
  VIEW_LEADERBOARD:     [ROLES.USER, ROLES.BRAND, ROLES.ADMIN],

  // Slots
  BUY_SLOT:             [ROLES.USER, ROLES.BRAND, ROLES.ADMIN],
  TRADE_SLOT:           [ROLES.USER, ROLES.BRAND, ROLES.ADMIN],
  SELL_SLOT:            [ROLES.USER, ROLES.BRAND, ROLES.ADMIN],

  // Credits / rewards
  EARN_CREDITS:         [ROLES.USER,                ROLES.ADMIN],
  WATCH_ADS:            [ROLES.USER,                ROLES.ADMIN],
  SPEND_CREDITS:        [ROLES.USER, ROLES.BRAND,   ROLES.ADMIN],

  // Ads
  UPLOAD_AD:            [              ROLES.BRAND, ROLES.ADMIN],
  SCHEDULE_AD:          [              ROLES.BRAND, ROLES.ADMIN],
  VIEW_OWN_ANALYTICS:   [              ROLES.BRAND, ROLES.ADMIN],

  // Brand management
  MANAGE_BRAND_PROFILE: [              ROLES.BRAND, ROLES.ADMIN],
  BUY_BOOST:            [              ROLES.BRAND, ROLES.ADMIN],

  // Admin only
  VIEW_ALL_ANALYTICS:   [                           ROLES.ADMIN],
  OVERRIDE_OWNERSHIP:   [                           ROLES.ADMIN],
  MANAGE_USERS:         [                           ROLES.ADMIN],
  WRITE_LEADERBOARD:    [                           ROLES.ADMIN],
  IMPERSONATE:          [                           ROLES.ADMIN],
});

/* ─── SESSION STATE ─────────────────────────────────────────────
   Populated once by detectRole(). Never written from outside.
─────────────────────────────────────────────────────────────────── */
let _session = null;

/**
 * detectRole()
 * ─────────────────────────────────────────────────────────────────
 * Reads role from Firestore (users/{uid}.role).
 * Falls back to 'user' if the field is missing or the document
 * doesn't exist. Never trusts client-supplied values.
 *
 * Must be awaited before any capability check or sidebar render.
 *
 * @param {firebase.User} firebaseUser  — from onAuthStateChanged
 * @param {firebase.firestore.Firestore} db
 * @returns {Promise<Session>}
 */
async function detectRole(firebaseUser, db) {
  if (!firebaseUser) throw new Error('detectRole: no authenticated user');

  const uid = firebaseUser.uid;
  let role   = ROLES.USER;      // safe default
  let brandId = null;
  let displayName = '';
  let photoURL    = '';
  let handle      = '';
  let activationStatus = 'inactive';

  try {
    // ── 1. Read from users/{uid} ──────────────────────────────
    const userSnap = await db.collection('users').doc(uid).get();

    if (userSnap.exists) {
      const d = userSnap.data();
      // Validate role against known enum — reject garbage values
      if (Object.values(ROLES).includes(d.role)) {
        role = d.role;
      }
      brandId     = d.brandId  || null;
      displayName = d.username || d.displayName || '';
      photoURL    = d.photoURL || '';
      handle      = '@' + (d.username || '');
    }

    // ── 2. If role is 'brand', fetch brand document too ───────
    if (role === ROLES.BRAND && brandId) {
      const brandSnap = await db.collection('brands').doc(brandId).get();
      if (brandSnap.exists) {
        const bd = brandSnap.data();
        displayName      = bd.brandName || displayName;
        photoURL         = bd.photoURL  || photoURL;
        activationStatus = bd.activationStatus || 'inactive';
      }
    }

    // ── 3. Admin shortcut: email match (belt-and-suspenders) ──
    //    Primary enforcement is the custom claim in Firestore rules.
    //    This is purely for fast UI routing.
    const ADMIN_EMAIL = 'johnrufai242@gmail.com'; // same as rules
    if (firebaseUser.email === ADMIN_EMAIL) {
      role = ROLES.ADMIN;
    }

  } catch (err) {
    console.error('[RoleEngine] detectRole error — defaulting to user:', err);
    role = ROLES.USER;
  }

  _session = {
    uid,
    role,
    brandId,
    displayName,
    photoURL,
    handle,
    activationStatus,
    email: firebaseUser.email || '',
  };

  console.log(`[RoleEngine] Resolved role: ${role} for uid: ${uid}`);
  return _session;
}

/**
 * getSession() — returns the cached session after detectRole() completes.
 * Throws if called before detectRole().
 */
function getSession() {
  if (!_session) throw new Error('getSession() called before detectRole()');
  return _session;
}

/**
 * hasCapability(cap) — UI-layer guard. NOT a security boundary.
 * @param {string} cap — key from CAPABILITIES
 */
function hasCapability(cap) {
  if (!_session) return false;
  const allowed = CAPABILITIES[cap];
  if (!allowed) { console.warn(`[RoleEngine] Unknown capability: ${cap}`); return false; }
  return allowed.includes(_session.role);
}

/**
 * requireRole(roles) — throws if current role is not in the list.
 * Use for page-level guard before rendering sensitive content.
 * @param {string[]} roles
 */
function requireRole(roles) {
  if (!_session || !roles.includes(_session.role)) {
    window.location.href = 'index.html';
    throw new Error('Access denied');
  }
}

/* ─── SIDEBAR TEMPLATE DEFINITIONS ─────────────────────────────
   Each item: { id, icon, label, badge, cap, action }
   cap (optional) — capability required; item hidden if user lacks it
   action — 'nav:<url>' | 'fn:<functionName>' | 'modal:<id>'
─────────────────────────────────────────────────────────────────── */
const SIDEBAR_SECTIONS = {

  /* ── USER SIDEBAR ─────────────────────────────────────────── */
  [ROLES.USER]: [
    {
      label: '// Navigate',
      items: [
        { id: 'nav-universe',   icon: '◎', label: 'Universe',       badge: { text: 'LIVE', cls: 'badge-cyan' }, action: 'nav:brand-universe.html' },
        { id: 'nav-explorer',   icon: '⊞', label: 'Brand Explorer',                                              action: 'nav:user-dashboard.html' },
        { id: 'nav-slots',      icon: '▦', label: 'My Slots',                                                    action: 'nav:user-slots.html',    cap: 'BUY_SLOT' },
        { id: 'nav-marketplace',icon: '◈', label: 'Marketplace',                                                 action: 'nav:marketplace.html',   cap: 'TRADE_SLOT' },
      ]
    },
    {
      label: '// Rewards',
      items: [
        { id: 'nav-credits',  icon: '⚡', label: 'My Credits',  badge: { text: 'EARN', cls: 'badge-new' },  action: 'nav:user-credits.html', cap: 'EARN_CREDITS' },
        { id: 'nav-watch',    icon: '▶', label: 'Watch & Earn',                                             action: 'nav:watch-ads.html',    cap: 'WATCH_ADS' },
      ]
    },
    {
      label: '// Account',
      items: [
        { id: 'sb-edit-profile', icon: '✎', label: 'Edit Profile',                                              action: 'fn:editProfile' },
        { id: 'sb-upgrade',      icon: '⬆', label: 'Upgrade to Brand', badge: { text: 'PRO', cls: 'badge-gold' }, action: 'fn:upgradeToBrand' },
      ]
    },
  ],

  /* ── BRAND SIDEBAR ────────────────────────────────────────── */
  [ROLES.BRAND]: [
    {
      label: '// Navigate',
      items: [
        { id: 'nav-universe',    icon: '◎', label: 'Universe',         badge: { text: 'LIVE', cls: 'badge-cyan' }, action: 'nav:brand-universe.html' },
        { id: 'nav-dashboard',   icon: '⌂', label: 'Dashboard',                                                    action: 'nav:brand-dashboard.html' },
        { id: 'nav-explorer',    icon: '⊞', label: 'Brand Explorer',                                               action: 'nav:user-dashboard.html' },
      ]
    },
    {
      label: '// My Assets',
      items: [
        { id: 'nav-slots',      icon: '▦', label: 'My Slots',                                                    action: 'nav:brand-slots.html',      cap: 'BUY_SLOT' },
        { id: 'nav-marketplace',icon: '◈', label: 'Marketplace',                                                  action: 'nav:marketplace.html',      cap: 'TRADE_SLOT' },
        { id: 'nav-boost',      icon: '🚀', label: 'Boost Visibility',  badge: { text: 'NEW', cls: 'badge-new' }, action: 'fn:buyBoost',               cap: 'BUY_BOOST' },
      ]
    },
    {
      label: '// Creator Tools',
      items: [
        { id: 'nav-ads',       icon: '▶', label: 'Upload Ad',        action: 'nav:brand-ads.html',       cap: 'UPLOAD_AD' },
        { id: 'nav-schedule',  icon: '📅', label: 'Schedule Ads',    action: 'nav:brand-schedule.html',  cap: 'SCHEDULE_AD' },
        { id: 'nav-analytics', icon: '📊', label: 'Analytics',       action: 'nav:brand-analytics.html', cap: 'VIEW_OWN_ANALYTICS' },
      ]
    },
    {
      label: '// Account',
      items: [
        { id: 'sb-edit-profile',  icon: '✎', label: 'Edit Profile',                                                  action: 'fn:editProfile' },
        { id: 'sb-pic',           icon: '⬡', label: 'Change Picture',                                                action: 'fn:changePicture' },
        { id: 'sb-verify',        icon: '◈', label: 'Verification',    badge: { text: '₦5K', cls: 'badge-gold' },    action: 'fn:applyVerify',  cap: 'MANAGE_BRAND_PROFILE' },
      ]
    },
  ],

  /* ── ADMIN SIDEBAR ────────────────────────────────────────── */
  [ROLES.ADMIN]: [
    {
      label: '// Navigate',
      items: [
        { id: 'nav-universe',  icon: '◎', label: 'Universe',        badge: { text: 'LIVE', cls: 'badge-cyan' }, action: 'nav:brand-universe.html' },
        { id: 'nav-dashboard', icon: '⌂', label: 'Admin Panel',                                                  action: 'nav:admin-dashboard.html' },
        { id: 'nav-explorer',  icon: '⊞', label: 'Brand Explorer',                                               action: 'nav:user-dashboard.html' },
      ]
    },
    {
      label: '// Administration',
      items: [
        { id: 'admin-users',     icon: '👥', label: 'Manage Users',    action: 'nav:admin-users.html',       cap: 'MANAGE_USERS' },
        { id: 'admin-brands',    icon: '🏷', label: 'Manage Brands',   action: 'nav:admin-brands.html',      cap: 'OVERRIDE_OWNERSHIP' },
        { id: 'admin-slots',     icon: '▦', label: 'All Slots',       action: 'nav:admin-slots.html',       cap: 'OVERRIDE_OWNERSHIP' },
        { id: 'admin-analytics', icon: '📊', label: 'All Analytics',   action: 'nav:admin-analytics.html',   cap: 'VIEW_ALL_ANALYTICS' },
        { id: 'admin-leaderboard',icon:'⬡', label: 'Leaderboard Mgr', action: 'nav:admin-leaderboard.html', cap: 'WRITE_LEADERBOARD' },
      ]
    },
    {
      label: '// Moderation',
      items: [
        { id: 'admin-ads',     icon: '▶', label: 'Review Ads',      action: 'nav:admin-ads.html' },
        { id: 'admin-reports', icon: '⚑', label: 'Reports',         action: 'nav:admin-reports.html' },
      ]
    },
    {
      label: '// Account',
      items: [
        { id: 'sb-edit-profile', icon: '✎', label: 'Edit Profile',  action: 'fn:editProfile' },
      ]
    },
  ],
};

/* ─── SIDEBAR RENDERER ──────────────────────────────────────────
   Injects HTML into .sidebar-inner, sets up event listeners.
   Safe against XSS — all dynamic values are text-only.
─────────────────────────────────────────────────────────────────── */

/**
 * renderSidebar(containerEl, actionHandlers)
 *
 * @param {HTMLElement} containerEl   — the .sidebar-inner element
 * @param {Object}      actionHandlers — map of fn:<name> → handler()
 */
function renderSidebar(containerEl, actionHandlers = {}) {
  if (!_session) throw new Error('renderSidebar: detectRole() must be called first');

  const { role, displayName, handle, photoURL, activationStatus } = _session;
  const sections = SIDEBAR_SECTIONS[role];
  if (!sections) { console.error('[RoleEngine] No sidebar config for role:', role); return; }

  /* ── Header ──────────────────────────────────────────────── */
  const header = document.createElement('div');
  header.className = 'sb-header';
  header.innerHTML = `
    <div class="sb-profile">
      <img src="${_esc(photoURL || '')}" alt="Avatar" class="sb-avatar" id="sbAvatar"
           onerror="this.src='assets/images/avatar-placeholder.png'">
      <div>
        <div class="sb-name" id="sbName">${_esc(displayName || 'USER')}</div>
        <div class="sb-handle" id="sbHandle">${_esc(handle || '')}</div>
        <div class="sb-role-chip sb-role-${_esc(role)}">${_esc(role.toUpperCase())}</div>
      </div>
    </div>
    <span class="sb-status ${activationStatus === 'active' ? 'active' : 'inactive'}" id="sbStatus">
      <span class="sb-status-dot"></span>
      ${activationStatus === 'active' ? 'ACTIVE' : 'INACTIVE'}
    </span>`;

  /* ── Sections ────────────────────────────────────────────── */
  const sectionsEl = document.createElement('div');
  sectionsEl.className = 'sb-sections';

  sections.forEach(section => {
    const visibleItems = section.items.filter(item =>
      !item.cap || hasCapability(item.cap)
    );
    if (!visibleItems.length) return;

    const sec = document.createElement('div');
    sec.className = 'sb-section';
    sec.innerHTML = `<div class="sb-section-label">${_esc(section.label)}</div>`;

    visibleItems.forEach(item => {
      const el = document.createElement('div');
      el.className = 'sb-item';
      el.id = item.id;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');

      const badge = item.badge
        ? `<span class="sb-item-badge ${_esc(item.badge.cls)}">${_esc(item.badge.text)}</span>`
        : '';

      el.innerHTML = `
        <span class="sb-item-icon">${_esc(item.icon)}</span>
        <span class="sb-item-label">${_esc(item.label)}</span>
        ${badge}`;

      /* ── Action binding ──────────────────────────────────── */
      const [actionType, actionValue] = item.action.split(':');

      if (actionType === 'nav') {
        el.addEventListener('click', () => { window.location.href = actionValue; });
      } else if (actionType === 'fn') {
        el.addEventListener('click', () => {
          const handler = actionHandlers[actionValue];
          if (typeof handler === 'function') handler(_session);
          else console.warn(`[RoleEngine] No handler registered for fn:${actionValue}`);
        });
      } else if (actionType === 'modal') {
        el.addEventListener('click', () => {
          const modal = document.getElementById(actionValue);
          if (modal) modal.classList.add('open');
        });
      }

      /* Keyboard accessibility */
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });

      sec.appendChild(el);
    });

    const div = document.createElement('div');
    div.className = 'sb-divider';
    sectionsEl.appendChild(sec);
    sectionsEl.appendChild(div);
  });

  /* ── Logout button ───────────────────────────────────────── */
  const logoutEl = document.createElement('div');
  logoutEl.className = 'sb-logout';
  logoutEl.id = 'sbLogout';
  logoutEl.innerHTML = `<span class="sb-logout-icon">⏻</span>LOGOUT`;
  logoutEl.addEventListener('click', async () => {
    if (typeof firebase !== 'undefined') await firebase.auth().signOut();
    window.location.href = 'index.html';
  });

  /* ── Assemble ────────────────────────────────────────────── */
  containerEl.innerHTML = '';
  containerEl.appendChild(header);
  containerEl.appendChild(sectionsEl);
  containerEl.appendChild(logoutEl);
}

/* ─── PRIVATE HELPERS ────────────────────────────────────────── */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/* ─── PUBLIC API ─────────────────────────────────────────────── */
window.RoleEngine = {
  ROLES,
  CAPABILITIES,
  detectRole,
  getSession,
  hasCapability,
  requireRole,
  renderSidebar,
};
