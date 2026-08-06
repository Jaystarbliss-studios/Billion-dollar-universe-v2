/**
 * utils.js — Shared math helpers and utility functions.
 */

/**
 * Spherical linear interpolation between two positions on a sphere of given radius.
 * Used to draw arc connections between nodes/slots on a globe surface.
 * @param {THREE.Vector3} pos1
 * @param {THREE.Vector3} pos2
 * @param {number} t       0-1
 * @param {number} radius
 * @returns {THREE.Vector3}
 */
export function slerp(pos1, pos2, t, radius) {
    const v1  = pos1.clone().normalize();
    const v2  = pos2.clone().normalize();
    const dot  = Math.max(-1, Math.min(1, v1.dot(v2)));
    const theta = Math.acos(dot);
    if (Math.abs(theta) < 0.0001) return v1.clone().multiplyScalar(radius);
    const s  = Math.sin(theta);
    const w1 = Math.sin((1 - t) * theta) / s;
    const w2 = Math.sin(t * theta) / s;
    return new THREE.Vector3(
        w1 * v1.x + w2 * v2.x,
        w1 * v1.y + w2 * v2.y,
        w1 * v1.z + w2 * v2.z
    ).normalize().multiplyScalar(radius);
}

/**
 * Cubic ease in-out
 */
export function easeInOut(t) {
    return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Map value from one range to another.
 */
export function mapRange(val, inMin, inMax, outMin, outMax) {
    return outMin + (outMax - outMin) * ((val - inMin) / (inMax - inMin));
}

/**
 * Clamp a number between min and max.
 */
export function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/**
 * Generate a seeded pseudo-random number (simple LCG).
 * Useful for deterministic slot/terrain placement from an ID.
 * @param {number} seed
 * @returns {() => number}  function returning 0-1
 */
export function seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
        s = s * 16807 % 2147483647;
        return (s - 1) / 2147483646;
    };
}

/**
 * Convert a 1D slot index to a 2D (row, col) on a sqrt(N)×sqrt(N) grid.
 * @param {number} index
 * @param {number} gridSize  e.g. 100 for a 100×100 grid
 */
export function indexToGrid(index, gridSize) {
    return { row: Math.floor(index / gridSize), col: index % gridSize };
}

/**
 * World-space XZ position for a slot, given grid coords, slot size, and terrain height.
 * @param {number} row
 * @param {number} col
 * @param {number} slotSize   world units per slot (e.g. 2)
 * @param {number} heightY    terrain Y at this position
 * @param {number} gridSize   100 for 100×100
 */
export function slotToWorldPos(row, col, slotSize, heightY, gridSize) {
    const halfGrid = (gridSize * slotSize) / 2;
    return new THREE.Vector3(
        col * slotSize - halfGrid + slotSize / 2,
        heightY,
        row * slotSize - halfGrid + slotSize / 2
    );
}

/**
 * Screen-space position of a 3D point.
 * @param {THREE.Vector3} worldPos
 * @param {THREE.Camera}  camera
 * @returns {{ x, y }}  pixel coords
 */
export function toScreen(worldPos, camera) {
    const v = worldPos.clone().project(camera);
    return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (v.y * -0.5 + 0.5) * window.innerHeight,
    };
}

/**
 * Format a coin amount with K/M suffix.
 */
export function formatCoins(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M ₿';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K ₿';
    return n + ' ₿';
}

/**
 * Debounce a function.
 */
export function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
