/**
 * planets.js — Planet parameters, slot caps, unlock conditions
 * Each industry can expand across multiple sequential planets
 * when the previous fills beyond a threshold.
 */

/** Slot count per planet */
export const SLOTS_PER_PLANET = 10_000;

/** At what % full does a new planet unlock? */
export const EXPANSION_THRESHOLD = 0.95;

/** Base price multiplier per planet (compound) */
export const PLANET_PRICE_MULTIPLIER = 1.4;

/**
 * Planet visual themes — each planet in a sequence gets a distinct look.
 * These map to terrain/texture keys loaded in planetGenerator.js
 */
export const PLANET_THEMES = [
    { id: 'origin',    label: 'Origin',    skyColor: 0x0a1a2e, fogColor: 0x0d2040, terrainKey: 'rocky',    accentColor: 0xC6A85E },
    { id: 'volcanic',  label: 'Volcanic',  skyColor: 0x1a0a00, fogColor: 0x2a1000, terrainKey: 'lava',     accentColor: 0xFF4420 },
    { id: 'crystal',   label: 'Crystal',   skyColor: 0x00101a, fogColor: 0x002233, terrainKey: 'ice',      accentColor: 0x88EEFF },
    { id: 'jungle',    label: 'Verdant',   skyColor: 0x001a08, fogColor: 0x003310, terrainKey: 'forest',   accentColor: 0x44FF88 },
    { id: 'desert',    label: 'Dunes',     skyColor: 0x1a1200, fogColor: 0x332200, terrainKey: 'sand',     accentColor: 0xFFCC44 },
    { id: 'void',      label: 'The Void',  skyColor: 0x000000, fogColor: 0x060012, terrainKey: 'dark',     accentColor: 0xCC44FF },
    { id: 'aqua',      label: 'Aqua',      skyColor: 0x001833, fogColor: 0x002244, terrainKey: 'ocean',    accentColor: 0x00CCFF },
    { id: 'nebula',    label: 'Nebula',    skyColor: 0x0a001a, fogColor: 0x180033, terrainKey: 'cosmic',   accentColor: 0xFF88CC },
];

/**
 * Get planet config for a given planet index (0-based).
 * Cycles through PLANET_THEMES after the list is exhausted.
 * @param {number} index
 * @returns {object}
 */
export function getPlanetConfig(index) {
    const theme = PLANET_THEMES[index % PLANET_THEMES.length];
    const priceMultiplier = Math.pow(PLANET_PRICE_MULTIPLIER, index);
    return {
        ...theme,
        index,
        label: index === 0 ? theme.label : `${theme.label} ${Math.floor(index / PLANET_THEMES.length) + 2}`,
        priceMultiplier,
        maxSlots: SLOTS_PER_PLANET,
        unlocked: false,   // set to true via backend when previous fills
    };
}

/**
 * Mountain slot rules per planet
 * Mountains occupy the top ~2% of height-sorted slots
 * and are flagged as PREMIUM in slotGrid.js
 */
export const MOUNTAIN_SLOT_PERCENT = 0.02;   // top 2%
export const MOUNTAIN_PRICE_MULTIPLIER = 5;  // 5× base price
export const CENTRAL_PRICE_MULTIPLIER  = 3;  // centre slots 3× base
