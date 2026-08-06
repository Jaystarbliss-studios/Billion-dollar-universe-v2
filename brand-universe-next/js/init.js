/**
 * init.js — Master initializer.
 * Bootstraps the universe, handles navigation between globe and worlds.
 *
 * Flow:
 *  1. Firebase auth check
 *  2. Render universe globe (brand-universe.html logic)
 *  3. On industry node click → load industry world
 *  4. Back button → unload world, return to globe
 */
import { initRenderer, getRenderer, getScene, clearScene } from './core/renderer.js';
import { initCamera, getCamera, initControls, animateCameraTo } from './core/camera.js';
import { startLoop, addTickFn, stopLoop } from './core/animationLoop.js';
import { detectTier, getPerf } from '../config/performance.js';
import { loadWorld, unloadWorld } from './worlds/planetGenerator.js';
import { loadBuildings } from './worlds/buildingManager.js';
import { createLeaderboardPlatform, updateLeaderboard, sortLeaderboard } from './worlds/leaderboard.js';
import { initSlotInteractions, disposeSlotInteractions } from './nodes/slotInteractions.js';
import { initNodeInteractions, disposeNodeInteractions, tickNodeTooltip } from './nodes/nodeInteractions.js';
import { subscribeWorld, unsubscribeAll } from './backend/websocket.js';
import { getWorldMeta, getSlotOccupancy, getBuildingsForWorld, getLeaderboard } from './backend/api.js';
import { initState } from './backend/stateManager.js';
import { renderBalanceHUD } from './economy/currency.js';
import { initLOD } from './worlds/LODManager.js';
import { addTickFn as tick } from './core/animationLoop.js';

/* ── State ─────────────────────────────────────── */
let _mode          = 'globe';   // 'globe' | 'world'
let _industryNodes = [];
let _currentBrandId = null;

/* ── Entry ─────────────────────────────────────── */
export async function bootstrap(container, brandId) {
    _currentBrandId = brandId;

    // Renderer
    const renderer = initRenderer(container);
    const camera   = initCamera(45, renderer);
    const controls = initControls(renderer.domElement, { minDistance: 12, maxDistance: 60 });

    // HUD
    renderBalanceHUD(document.body);

    // Start loop
    startLoop();

    // Show globe
    await _enterGlobeMode();
}

/* ═══════════════════════════════════════════════
   GLOBE MODE
═══════════════════════════════════════════════ */
async function _enterGlobeMode() {
    _mode = 'globe';
    _hideBackButton();

    // Globe is managed by existing brand-universe.html logic.
    // When the node click fires, we intercept it here.
    // Wire up node interactions (replaces inline onclick in brand-universe.html)
    // _industryNodes populated by industryNodes.js (not shown here, same as original)

    addTickFn('globeTooltip', () => tickNodeTooltip());

    window.addEventListener('bdu:industrySelected', async (e) => {
        await _enterWorldMode(e.detail.industry);
    });
}

/* ═══════════════════════════════════════════════
   WORLD MODE
═══════════════════════════════════════════════ */
async function _enterWorldMode(industry, planetIndex = 0) {
    _mode = 'world';
    _showLoadingOverlay(`Loading ${industry} World…`);
    disposeNodeInteractions();

    const perf = getPerf();

    // 1. Fetch world data
    const [meta, occupancy, buildingList, lbData] = await Promise.all([
        getWorldMeta(industry, planetIndex),
        getSlotOccupancy(industry, planetIndex),
        getBuildingsForWorld(industry, planetIndex),
        getLeaderboard(industry, planetIndex),
    ]);

    // 2. Init brand state
    await initState(_currentBrandId, meta);

    // 3. Generate world (terrain + slots)
    clearScene();
    const { config } = await loadWorld(industry, planetIndex, occupancy, perf);

    // 4. Buildings
    loadBuildings(buildingList);

    // 5. Leaderboard platform
    createLeaderboardPlatform();
    updateLeaderboard(sortLeaderboard(lbData));

    // 6. LOD
    initLOD(perf.lodDistances, 4);

    // 7. Slot interactions
    initSlotInteractions(industry, planetIndex, meta.occupiedCount, meta.planetMultiplier);

    // 8. Realtime
    subscribeWorld(industry, planetIndex, _currentBrandId, {
        onLeaderboardUpdate: entries => updateLeaderboard(entries),
    });

    // 9. Camera reset to world view
    animateCameraTo(
        new THREE.Vector3(0, 120, 250),
        new THREE.Vector3(0, 0, 0),
        1400
    );

    _hideLoadingOverlay();
    _showBackButton(() => _exitWorldMode());
    _showWorldBreadcrumb(industry, planetIndex, config);
}

async function _exitWorldMode() {
    disposeSlotInteractions();
    unsubscribeAll();
    unloadWorld();
    _hideBackButton();
    _hideWorldBreadcrumb();
    _enterGlobeMode();
}

/* ── UI Helpers ─────────────────────────────── */
function _showLoadingOverlay(text) {
    let el = document.getElementById('world-loading');
    if (!el) {
        el = document.createElement('div');
        el.id = 'world-loading';
        el.style.cssText = `
            position:fixed;inset:0;background:rgba(0,0,0,0.7);
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            z-index:3000;font-family:'Orbitron',monospace;color:#C6A85E;gap:16px;
        `;
        document.body.appendChild(el);
    }
    el.innerHTML = `
        <div style="width:36px;height:36px;border-radius:50%;border:2px solid rgba(198,168,94,0.2);
                    border-top-color:#C6A85E;animation:spin .9s linear infinite"></div>
        <div style="font-size:11px;letter-spacing:3px">${text.toUpperCase()}</div>
    `;
}

function _hideLoadingOverlay() {
    document.getElementById('world-loading')?.remove();
}

function _showBackButton(onClick) {
    let btn = document.getElementById('world-back-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'world-back-btn';
        btn.style.cssText = `
            position:fixed;top:68px;left:20px;z-index:700;
            background:rgba(4,10,24,0.88);backdrop-filter:blur(12px);
            border:1px solid rgba(198,168,94,0.3);border-radius:6px;
            color:#C6A85E;font-family:'Orbitron',monospace;font-size:9px;
            letter-spacing:2px;padding:9px 14px;cursor:pointer;
            display:flex;align-items:center;gap:8px;
            transition:all 0.2s;
        `;
        btn.innerHTML = '← UNIVERSE';
        document.body.appendChild(btn);
    }
    btn.onclick = onClick;
}

function _hideBackButton() { document.getElementById('world-back-btn')?.remove(); }

function _showWorldBreadcrumb(industry, planetIndex, config) {
    let el = document.getElementById('world-breadcrumb');
    if (!el) {
        el = document.createElement('div');
        el.id = 'world-breadcrumb';
        el.style.cssText = `
            position:fixed;top:68px;left:50%;transform:translateX(-50%);
            z-index:600;font-family:'Orbitron',monospace;font-size:9px;
            letter-spacing:2.5px;color:rgba(198,168,94,0.7);
            background:rgba(4,10,24,0.7);backdrop-filter:blur(10px);
            border:1px solid rgba(198,168,94,0.15);border-radius:4px;padding:6px 14px;
            white-space:nowrap;
        `;
        document.body.appendChild(el);
    }
    el.textContent = `${industry.toUpperCase()} · PLANET ${planetIndex + 1} · ${config.label.toUpperCase()}`;
}

function _hideWorldBreadcrumb() { document.getElementById('world-breadcrumb')?.remove(); }
