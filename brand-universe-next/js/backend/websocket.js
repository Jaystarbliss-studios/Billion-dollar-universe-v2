/**
 * websocket.js — Realtime updates via Firestore listeners.
 * Handles live slot ownership, leaderboard, and auction updates.
 *
 * Attach all listeners via subscribeWorld(); call unsubscribeAll() on world exit.
 */
import { updateSlot, setSlotColor } from '../worlds/slotGrid.js';
import { updateLeaderboard, sortLeaderboard } from '../worlds/leaderboard.js';
import { setBalance } from '../economy/currency.js';

const _subs = [];   // Firestore unsubscribe functions

/**
 * Subscribe to all realtime updates for an industry world.
 * @param {string}   industry
 * @param {number}   planetIndex
 * @param {string}   brandId      current user's brand
 * @param {Callbacks} callbacks   { onSlotUpdate, onLeaderboardUpdate, onAuctionUpdate }
 */
export function subscribeWorld(industry, planetIndex, brandId, callbacks = {}) {
    const db = firebase.firestore();
    const worldPath = `worlds/${encodeIndustry(industry)}_${planetIndex}`;

    // ── Slot updates ───────────────────────────────────
    const slotUnsub = db.collection(`${worldPath}/slots`)
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'modified' || change.type === 'added') {
                    const data = change.doc.data();
                    const idx  = parseInt(change.doc.id, 10);
                    updateSlot(idx, {
                        ownerId:    data.ownerId    ?? null,
                        buildingId: data.buildingId ?? null,
                        locked:     data.locked     ?? false,
                    });
                    // Update tile colour
                    const color = data.ownerId ? 0x44FF88 : 0x334455;
                    setSlotColor(idx, color);
                    callbacks.onSlotUpdate?.({ index: idx, ...data });
                }
            });
        });
    _subs.push(slotUnsub);

    // ── Leaderboard ────────────────────────────────────
    const lbUnsub = db.collection(`${worldPath}/leaderboard`)
        .orderBy('score', 'desc')
        .limit(10)
        .onSnapshot(snapshot => {
            const entries = snapshot.docs.map((doc, i) => ({ ...doc.data(), rank: i + 1 }));
            updateLeaderboard(entries);
            callbacks.onLeaderboardUpdate?.(entries);
        });
    _subs.push(lbUnsub);

    // ── Active Auctions ────────────────────────────────
    const auctUnsub = db.collection('auctions')
        .where('industry', '==', industry)
        .where('planetIndex', '==', planetIndex)
        .where('state', '==', 'active')
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                callbacks.onAuctionUpdate?.({ type: change.type, ...change.doc.data() });
            });
        });
    _subs.push(auctUnsub);

    // ── Coin Balance ───────────────────────────────────
    if (brandId) {
        const coinUnsub = db.collection('brands').doc(brandId)
            .onSnapshot(doc => {
                if (doc.exists) {
                    const coins = doc.data()?.coins ?? 0;
                    setBalance(coins);
                }
            });
        _subs.push(coinUnsub);
    }
}

/**
 * Unsubscribe all active Firestore listeners.
 * Call when navigating away from a world.
 */
export function unsubscribeAll() {
    _subs.forEach(fn => fn());
    _subs.length = 0;
}

function encodeIndustry(name) {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}
