/**
 * api.js — Client-side API layer.
 * Fetches brand, slot, and building data from Firebase/backend.
 * All methods return Promises. Errors are caught and re-thrown with context.
 */

const BASE_URL = window.__BDU_API_URL__ ?? '';  // set via window config or env

/* ── Auth header helper ──────────────────────────── */
async function authHeaders() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

async function apiFetch(path, options = {}) {
    const headers = await authHeaders();
    const res = await fetch(BASE_URL + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${options.method || 'GET'} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
}

/* ══════════════════════════════════════════════════
   BRAND
══════════════════════════════════════════════════ */
/**
 * Fetch brand profile.
 * @param {string} brandId
 */
export async function getBrand(brandId) {
    return apiFetch(`/brands/${brandId}`);
}

/**
 * Get all slots owned by a brand (across all industries & planets).
 */
export async function getBrandSlots(brandId) {
    return apiFetch(`/brands/${brandId}/slots`);
}

/* ══════════════════════════════════════════════════
   INDUSTRY / WORLD
══════════════════════════════════════════════════ */
/**
 * Fetch world metadata: planet count, occupancy, top brands.
 * @param {string} industry
 * @param {number} planetIndex
 */
export async function getWorldMeta(industry, planetIndex = 0) {
    return apiFetch(`/worlds/${encodeURIComponent(industry)}/${planetIndex}`);
}

/**
 * Fetch slot occupancy map for a planet.
 * Returns Map<slotIndex, { ownerId, buildingId, locked }>
 */
export async function getSlotOccupancy(industry, planetIndex = 0) {
    const data = await apiFetch(`/worlds/${encodeURIComponent(industry)}/${planetIndex}/slots`);
    const map = new Map();
    data.forEach(s => map.set(s.slotIndex, s));
    return map;
}

/**
 * Fetch leaderboard for an industry world.
 */
export async function getLeaderboard(industry, planetIndex = 0) {
    return apiFetch(`/worlds/${encodeURIComponent(industry)}/${planetIndex}/leaderboard`);
}

/* ══════════════════════════════════════════════════
   SLOT PURCHASE / TRANSFER
══════════════════════════════════════════════════ */
/**
 * Purchase a slot.
 * @param {{ slotIndex, industry, planetIndex, brandId, transactionId }}
 */
export async function purchaseSlot(payload) {
    return apiFetch('/transactions/slot-purchase', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * Transfer a slot to another brand.
 */
export async function transferSlot(payload) {
    return apiFetch('/transactions/slot-transfer', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/* ══════════════════════════════════════════════════
   BUILDINGS
══════════════════════════════════════════════════ */
/**
 * Fetch all buildings for a world.
 */
export async function getBuildingsForWorld(industry, planetIndex = 0) {
    return apiFetch(`/worlds/${encodeURIComponent(industry)}/${planetIndex}/buildings`);
}

/**
 * Upgrade a building.
 */
export async function upgradeBuilding(payload) {
    return apiFetch('/transactions/building-upgrade', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/* ══════════════════════════════════════════════════
   AUCTIONS
══════════════════════════════════════════════════ */
export async function getActiveAuctions(industry, planetIndex = 0) {
    return apiFetch(`/auctions?industry=${encodeURIComponent(industry)}&planet=${planetIndex}`);
}

export async function placeBid(payload) {
    return apiFetch('/auctions/bid', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
