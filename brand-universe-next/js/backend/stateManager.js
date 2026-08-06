/**
 * stateManager.js — Centralized client state for brands, slots, and buildings.
 *
 * Acts as a single source of truth on the client.
 * Backend is always authoritative; this is a local cache with optimistic updates.
 *
 * Prevents race conditions by:
 *   1. Queueing concurrent mutations
 *   2. Using transaction IDs for deduplication
 *   3. Rolling back optimistic changes on failure
 */
import { setBalance, optimisticDebit, confirmDebit, rollbackDebit } from '../economy/currency.js';
import { updateSlot, setSlotColor } from '../worlds/slotGrid.js';
import { getBrand, purchaseSlot, upgradeBuilding } from './api.js';
import { computeSlotPrice } from '../economy/slotPricing.js';

/* ── State ─────────────────────────────────────────── */
const state = {
    brand:         null,    // current brand profile
    ownedSlots:    new Set(),  // slot indices owned by current brand
    worldOccupied: 0,       // total occupied slots in active world
    worldTotal:    10000,
    planetMultiplier: 1,
    pendingTxIds:  new Set(), // dedup in-flight transactions
};

export function getState()             { return state; }
export function getOwnedSlots()        { return state.ownedSlots; }
export function isSlotOwned(idx)       { return state.ownedSlots.has(idx); }

/**
 * Load brand and world context on world entry.
 * @param {string}  brandId
 * @param {object}  worldMeta   { occupiedCount, totalSlots, planetMultiplier }
 */
export async function initState(brandId, worldMeta) {
    const brandData = await getBrand(brandId);
    state.brand            = brandData;
    state.worldOccupied    = worldMeta.occupiedCount;
    state.worldTotal       = worldMeta.totalSlots;
    state.planetMultiplier = worldMeta.planetMultiplier;
    setBalance(brandData.coins ?? 0);

    // Mark owned slots
    state.ownedSlots = new Set((brandData.slots ?? []).map(s => s.slotIndex));
    return brandData;
}

/* ── Slot Purchase ─────────────────────────────────── */
/**
 * Purchase a slot with optimistic UI update.
 * Rolls back on failure.
 * @param {number}  slotIndex
 * @param {object}  slotData   from slotGrid (type, premiumMultiplier)
 * @param {string}  industry
 * @param {number}  planetIndex
 */
export async function buySlot(slotIndex, slotData, industry, planetIndex) {
    const price = computeSlotPrice({
        occupiedCount:    state.worldOccupied,
        totalSlots:       state.worldTotal,
        premiumMultiplier: slotData.premiumMultiplier,
        planetMultiplier:  state.planetMultiplier,
    });

    const txId = crypto.randomUUID();
    if (state.pendingTxIds.has(slotIndex + '_purchase')) {
        throw new Error('Purchase already in progress for this slot.');
    }
    state.pendingTxIds.add(slotIndex + '_purchase');

    // Optimistic update
    optimisticDebit(price);
    setSlotColor(slotIndex, state.brand.color ?? 0x44FF88);
    state.ownedSlots.add(slotIndex);
    updateSlot(slotIndex, { ownerId: state.brand.id, locked: true });
    state.worldOccupied++;

    try {
        await purchaseSlot({
            slotIndex,
            industry,
            planetIndex,
            brandId:       state.brand.id,
            transactionId: txId,
            price,
        });
        confirmDebit(price);
        updateSlot(slotIndex, { locked: false });
        window.dispatchEvent(new CustomEvent('bdu:slotPurchased', { detail: { slotIndex, price } }));
    } catch (err) {
        // Rollback
        rollbackDebit(price);
        setSlotColor(slotIndex, 0x334455);
        state.ownedSlots.delete(slotIndex);
        updateSlot(slotIndex, { ownerId: null, locked: false });
        state.worldOccupied--;
        throw err;
    } finally {
        state.pendingTxIds.delete(slotIndex + '_purchase');
    }
}

/* ── Building Upgrade ──────────────────────────────── */
export async function requestBuildingUpgrade(buildingId, slotIndex, catalogId, newFloors, upgradeCost) {
    const key = buildingId + '_upgrade';
    if (state.pendingTxIds.has(key)) throw new Error('Upgrade already in progress.');
    state.pendingTxIds.add(key);
    optimisticDebit(upgradeCost);

    try {
        await upgradeBuilding({ buildingId, slotIndex, catalogId, newFloors, brandId: state.brand.id, cost: upgradeCost });
        confirmDebit(upgradeCost);
    } catch (err) {
        rollbackDebit(upgradeCost);
        throw err;
    } finally {
        state.pendingTxIds.delete(key);
    }
}
