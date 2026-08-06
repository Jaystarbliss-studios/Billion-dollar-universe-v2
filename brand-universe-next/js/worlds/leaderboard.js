/**
 * leaderboard.js — Live top-10 brand leaderboard per industry world.
 *
 * Displayed on a central raised platform in the 3D world.
 * Updated in real-time via Firestore subscription or WebSocket.
 *
 * Ranking factors:
 *   - Total slots owned (weight: 0.5)
 *   - Building height sum (weight: 0.3)
 *   - Coin spent total (weight: 0.2)
 */
import { getScene } from '../core/renderer.js';
import { addTickFn } from '../core/animationLoop.js';

/** Scoring formula — change weights here */
function computeScore({ slotCount, buildingHeightTotal, coinsSpent }) {
    return (slotCount * 0.5) + (buildingHeightTotal * 0.3) + (coinsSpent / 1000 * 0.2);
}

/* ── 3D Platform ───────────────────────────────────── */
let _platform  = null;
let _nameMeshes = [];
let _phase     = 0;

/**
 * Create the central leaderboard platform in the 3D world.
 * Call after slot grid is loaded.
 */
export function createLeaderboardPlatform() {
    const scene = getScene();

    // Base platform
    const baseGeo = new THREE.CylinderGeometry(18, 20, 3, 24);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0xC6A85E, emissive: 0xC6A85E, emissiveIntensity: 0.25,
        roughness: 0.3, metalness: 0.8,
    });
    _platform = new THREE.Mesh(baseGeo, baseMat);
    _platform.position.set(0, 1.5, 0);
    _platform.castShadow = true;
    _platform.name = 'leaderboardPlatform';
    scene.add(_platform);

    // Glowing ring on top
    const ringGeo = new THREE.TorusGeometry(18, 0.4, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xFFD700 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.5;
    _platform.add(ring);

    // Vertical light beacon
    const beaconGeo = new THREE.CylinderGeometry(0.3, 0.3, 60, 8);
    const beaconMat = new THREE.MeshBasicMaterial({
        color: 0xFFD700, transparent: true, opacity: 0.15, depthWrite: false,
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.y = 30;
    _platform.add(beacon);

    // Point light
    const light = new THREE.PointLight(0xFFD700, 2, 60);
    light.position.set(0, 6, 0);
    _platform.add(light);

    addTickFn('leaderboardPlatform', (_dt, time) => {
        _phase = time;
        if (_platform) {
            _platform.rotation.y += 0.001;
            if (light) light.intensity = 1.8 + Math.sin(time * 2) * 0.4;
        }
    });

    return _platform;
}

/**
 * Update the leaderboard display.
 * @param {Array<LeaderboardEntry>} entries   sorted desc by score, max 10
 * LeaderboardEntry: { rank, brandId, brandName, slotCount, buildingHeightTotal, coinsSpent, color }
 */
export function updateLeaderboard(entries) {
    // Update HUD (DOM side)
    renderLeaderboardHUD(entries);

    // Remove old 3D name meshes
    if (_platform) {
        _nameMeshes.forEach(m => _platform.remove(m));
        _nameMeshes = [];
    }
    // (In production, use a font loader + TextGeometry or sprite labels)
    // Here we use small boxes as brand markers arranged in a circle
    entries.slice(0, 10).forEach((entry, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const r     = 12;
        const col   = new THREE.Color(entry.color ?? 0xC6A85E);
        const geo   = new THREE.BoxGeometry(2, 0.5 + entry.rank * 0.4, 2);
        const mat   = new THREE.MeshStandardMaterial({
            color: col, emissive: col, emissiveIntensity: 0.5,
            roughness: 0.3, metalness: 0.7,
        });
        const bar = new THREE.Mesh(geo, mat);
        bar.position.set(
            Math.cos(angle) * r,
            1.5 + entry.rank * 0.2,
            Math.sin(angle) * r
        );
        bar.userData = { brandName: entry.brandName, rank: entry.rank };
        if (_platform) { _platform.add(bar); _nameMeshes.push(bar); }
    });
}

/* ── DOM Leaderboard HUD ──────────────────────────── */
function renderLeaderboardHUD(entries) {
    let el = document.getElementById('leaderboard-hud');
    if (!el) {
        el = document.createElement('div');
        el.id = 'leaderboard-hud';
        el.style.cssText = `
            position:fixed; right:20px; top:70px; z-index:700;
            background:rgba(4,10,24,0.88); backdrop-filter:blur(16px);
            border:1px solid rgba(198,168,94,0.3); border-radius:8px;
            padding:14px 18px; min-width:220px;
            font-family:'Orbitron',monospace; color:#fff;
        `;
        document.body.appendChild(el);
    }

    const rows = entries.slice(0, 10).map(e => `
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <span style="color:${rankColor(e.rank)};font-size:10px;width:20px">#${e.rank}</span>
            <span style="flex:1;font-size:10px;letter-spacing:1px;color:rgba(220,235,255,0.85);
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.brandName}</span>
            <span style="font-size:9px;color:rgba(198,168,94,0.8)">${e.slotCount}⬡</span>
        </div>
    `).join('');

    el.innerHTML = `
        <div style="font-size:8px;letter-spacing:2.5px;color:rgba(198,168,94,0.6);margin-bottom:10px">
            // TOP BRANDS
        </div>
        ${rows}
    `;
}

function rankColor(rank) {
    if (rank === 1) return '#FFD700';
    if (rank === 2) return '#C0C0C0';
    if (rank === 3) return '#CD7F32';
    return 'rgba(255,255,255,0.4)';
}

export function hideLeaderboardHUD() {
    const el = document.getElementById('leaderboard-hud');
    if (el) el.style.display = 'none';
}

export function showLeaderboardHUD() {
    const el = document.getElementById('leaderboard-hud');
    if (el) el.style.display = '';
}

/** Sort and limit to top-10 from a raw brand list */
export function sortLeaderboard(brands) {
    return brands
        .map((b, i) => ({ ...b, score: computeScore(b), rank: 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((b, i) => ({ ...b, rank: i + 1 }));
}
