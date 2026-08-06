/**
 * performance.js — Device tier settings for rendering quality
 * Automatically detected; can be overridden by user preference.
 */

export const PERFORMANCE_TIERS = {
    ultra: {
        label: 'ULTRA',
        slotRenderRadius: 200,       // render slots within this world-unit radius of camera
        maxVisibleBuildings: 3000,
        shadowsEnabled: true,
        antialias: true,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        lodDistances: [30, 80, 160],  // near, mid, far LOD switch distances
        terrainSegments: 256,
        starCount: 6000,
        frameSkip: 1,               // render every frame
        animatedBuildings: true,
        particleCount: 500,
        reflections: true,
    },
    high: {
        label: 'HIGH',
        slotRenderRadius: 150,
        maxVisibleBuildings: 1500,
        shadowsEnabled: true,
        antialias: true,
        pixelRatio: Math.min(window.devicePixelRatio, 1.5),
        lodDistances: [25, 60, 120],
        terrainSegments: 128,
        starCount: 3000,
        frameSkip: 1,
        animatedBuildings: true,
        particleCount: 200,
        reflections: false,
    },
    medium: {
        label: 'MEDIUM',
        slotRenderRadius: 100,
        maxVisibleBuildings: 800,
        shadowsEnabled: false,
        antialias: false,
        pixelRatio: 1,
        lodDistances: [20, 50, 100],
        terrainSegments: 64,
        starCount: 1500,
        frameSkip: 1,
        animatedBuildings: false,
        particleCount: 80,
        reflections: false,
    },
    low: {
        label: 'LOW',
        slotRenderRadius: 60,
        maxVisibleBuildings: 300,
        shadowsEnabled: false,
        antialias: false,
        pixelRatio: Math.min(window.devicePixelRatio * 0.6, 0.85),
        lodDistances: [15, 35, 70],
        terrainSegments: 32,
        starCount: 500,
        frameSkip: 2,               // render every 2nd frame
        animatedBuildings: false,
        particleCount: 0,
        reflections: false,
    },
    potato: {
        label: 'POTATO',
        slotRenderRadius: 35,
        maxVisibleBuildings: 80,
        shadowsEnabled: false,
        antialias: false,
        pixelRatio: 0.6,
        lodDistances: [10, 25, 50],
        terrainSegments: 16,
        starCount: 0,
        frameSkip: 3,
        animatedBuildings: false,
        particleCount: 0,
        reflections: false,
    }
};

/**
 * Detect optimal tier from hardware concurrency and pixel ratio.
 * Can be overridden by localStorage 'bdu_perf_tier'.
 */
export function detectTier() {
    const saved = localStorage.getItem('bdu_perf_tier');
    if (saved && PERFORMANCE_TIERS[saved]) return saved;

    const cores = navigator.hardwareConcurrency || 2;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const dpr    = window.devicePixelRatio || 1;

    if (mobile && dpr < 2) return 'low';
    if (mobile) return 'medium';
    if (cores >= 8) return 'ultra';
    if (cores >= 4) return 'high';
    if (cores >= 2) return 'medium';
    return 'low';
}

export function getPerf() {
    return PERFORMANCE_TIERS[detectTier()];
}
