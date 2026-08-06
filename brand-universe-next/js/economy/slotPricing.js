/**
 * slotPricing.js — Dynamic slot pricing based on scarcity, type, and planet.
 *
 * Price Formula:
 *   basePrice × scarcityMultiplier × premiumMultiplier × planetMultiplier
 *
 * Scarcity:
 *   As occupancy % rises, price increases exponentially:
 *   0-50%  → 1.0×
 *   50-75% → 1.5×
 *   75-90% → 2.5×
 *   90-95% → 4.0×
 *   95%+   → 8.0× (near-capacity premium)
 */
import { SLOTS_PER_PLANET } from '../../config/planets.js';

/** Base slot price in coins */
export const BASE_SLOT_PRICE = 1000;

/** Platform commission on resales (%) */
export const RESALE_COMMISSION_PCT = 0.08;

/**
 * Compute slot price.
 * @param {object} options
 * @param {number} options.occupiedCount     current occupied slot count
 * @param {number} options.totalSlots        total slots on this planet (default 10000)
 * @param {number} options.premiumMultiplier slot.premiumMultiplier (1, 3, or 5)
 * @param {number} options.planetMultiplier  from getPlanetConfig().priceMultiplier
 * @returns {number}  price in coins (rounded)
 */
export function computeSlotPrice({
    occupiedCount,
    totalSlots        = SLOTS_PER_PLANET,
    premiumMultiplier = 1,
    planetMultiplier  = 1,
}) {
    const pct = occupiedCount / totalSlots;
    const scarcity = scarcityMultiplier(pct);
    const price = BASE_SLOT_PRICE * scarcity * premiumMultiplier * planetMultiplier;
    return Math.round(price);
}

/**
 * Scarcity curve.
 * @param {number} pct  0-1 occupancy fraction
 */
export function scarcityMultiplier(pct) {
    if (pct < 0.50) return 1.0;
    if (pct < 0.75) return 1.0 + (pct - 0.50) / 0.25 * 0.5;   // 1.0 → 1.5
    if (pct < 0.90) return 1.5 + (pct - 0.75) / 0.15 * 1.0;   // 1.5 → 2.5
    if (pct < 0.95) return 2.5 + (pct - 0.90) / 0.05 * 1.5;   // 2.5 → 4.0
    return 4.0 + (pct - 0.95) / 0.05 * 4.0;                    // 4.0 → 8.0
}

/**
 * Compute a slot resale price.
 * Seller receives: resalePrice × (1 - RESALE_COMMISSION_PCT)
 *
 * @param {number} originalPrice
 * @param {number} currentMarketPrice
 */
export function computeResalePrice(originalPrice, currentMarketPrice) {
    // Resale floored at 80% of original; capped at 200% of market
    const floor = originalPrice * 0.80;
    const ceil  = currentMarketPrice * 2.0;
    return Math.min(Math.max(originalPrice, floor), ceil);
}

export function sellerReceives(resalePrice) {
    return Math.round(resalePrice * (1 - RESALE_COMMISSION_PCT));
}

/**
 * Projected price at a given future occupancy.
 * Useful for UI "price trend" display.
 * @param {number} currentOccupied
 * @param {number} totalSlots
 * @param {number} projectedOccupied
 * @param {number} premiumMultiplier
 * @param {number} planetMultiplier
 */
export function projectedPrice(currentOccupied, totalSlots, projectedOccupied, premiumMultiplier, planetMultiplier) {
    return computeSlotPrice({
        occupiedCount:    projectedOccupied,
        totalSlots,
        premiumMultiplier,
        planetMultiplier,
    });
}

/**
 * Format price for display.
 */
export function formatPrice(coins) {
    if (coins >= 1_000_000) return (coins / 1_000_000).toFixed(2) + 'M ₿';
    if (coins >= 1_000)     return (coins / 1_000).toFixed(1) + 'K ₿';
    return coins + ' ₿';
}
