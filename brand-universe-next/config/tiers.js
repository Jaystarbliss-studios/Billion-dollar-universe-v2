/**
 * tiers.js — Brand tier definitions: slot limits, perks, pricing
 */

export const BRAND_TIERS = {
    free: {
        id: 'free',
        label: 'Starter',
        maxSlots: 1,
        maxIndustries: 1,
        buildingHeightMax: 2,    // floors
        canAuction: false,
        canTransfer: false,
        monthlyCoins: 0,
        color: 0x888888,
    },
    tier1: {
        id: 'tier1',
        label: 'Pioneer',
        maxSlots: 500,
        maxIndustries: 3,
        buildingHeightMax: 10,
        canAuction: false,
        canTransfer: true,
        transferMaxPercent: 0.9,  // can transfer up to 90% of holdings
        minRetainSlots: 1,
        monthlyCoins: 500,
        color: 0xC6A85E,
    },
    tier2: {
        id: 'tier2',
        label: 'Dominator',
        maxSlots: 2000,
        maxIndustries: 8,
        buildingHeightMax: 25,
        canAuction: true,
        canTransfer: true,
        transferMaxPercent: 0.9,
        minRetainSlots: 5,
        monthlyCoins: 2000,
        color: 0x4ECAFF,
    },
    tier3: {
        id: 'tier3',
        label: 'Empire',
        maxSlots: 5000,
        maxIndustries: 20,
        buildingHeightMax: 100,
        canAuction: true,
        canTransfer: true,
        transferMaxPercent: 0.9,
        minRetainSlots: 5,
        monthlyCoins: 10000,
        color: 0xFF6AFF,
        exclusive: true,  // requires manual approval
    }
};

/**
 * Return the max transferable slots for a brand based on their tier and holdings.
 * @param {string} tierId
 * @param {number} currentSlots
 */
export function getMaxTransferable(tierId, currentSlots) {
    const tier = BRAND_TIERS[tierId];
    if (!tier || !tier.canTransfer) return 0;
    const transferable = Math.floor(currentSlots * tier.transferMaxPercent);
    return Math.max(0, transferable - (tier.minRetainSlots || 1));
}
