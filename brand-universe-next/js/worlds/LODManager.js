/**
 * LODManager.js — Level of Detail manager for buildings and slots.
 *
 * Strategy:
 *   NEAR  (< lodNear)  → full geometry, shadows on
 *   MID   (< lodMid)   → simplified geometry, shadows off
 *   FAR   (< lodFar)   → billboard sprite only
 *   CULL  (>= lodFar)  → object.visible = false
 *
 * Runs every N frames based on performance tier.
 */
import { distanceTo } from '../core/camera.js';
import { addTickFn, getPerfRef } from '../core/animationLoop.js';
import { getAllBuildings } from './buildingManager.js';

let _lodDistances = [30, 80, 160]; // overridden from perf config
let _frameInterval = 4;            // check LOD every 4 frames
let _frameCounter  = 0;

/**
 * Initialise with performance config distances.
 * @param {number[]} lodDistances [near, mid, far]
 * @param {number}   frameInterval
 */
export function initLOD(lodDistances, frameInterval = 4) {
    _lodDistances = lodDistances;
    _frameInterval = frameInterval;
}

/**
 * Apply LOD to all tracked meshes.
 * Called automatically via addTickFn.
 */
addTickFn('LODManager', (_dt, _time, frame) => {
    if (frame % _frameInterval !== 0) return;

    const [near, mid, far] = _lodDistances;
    const perf = getPerfRef();

    getAllBuildings().forEach((data) => {
        const mesh = data.mesh;
        if (!mesh) return;

        const dist = distanceTo(mesh.position);

        if (dist > far) {
            mesh.visible = false;
            return;
        }

        mesh.visible = true;

        // Shadow toggling (expensive — only toggle on tier change)
        const wantShadow = dist < near && perf.shadowsEnabled;
        if (mesh.castShadow !== wantShadow) {
            mesh.castShadow    = wantShadow;
            mesh.receiveShadow = wantShadow;
        }

        // Geometry simplification — toggle between LOD groups if available
        if (mesh.userData.lodHigh && mesh.userData.lodLow) {
            const useLow = dist > mid;
            mesh.userData.lodHigh.visible = !useLow;
            mesh.userData.lodLow.visible  = useLow;
        }

        // Billboard sprite fallback for far range
        if (mesh.userData.billboard) {
            mesh.userData.billboard.visible = dist > mid && dist < far;
            if (dist <= mid) {
                mesh.visible = true;
                mesh.userData.billboard.visible = false;
            }
        }
    });
});

/**
 * Create a simple billboard sprite for a building (shown at far distance).
 * @param {THREE.Vector3} position
 * @param {number}        color   hex
 * @param {number}        height  building height
 * @returns {THREE.Sprite}
 */
export function createBillboard(position, color, height) {
    const canvas  = document.createElement('canvas');
    canvas.width  = 32;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(6, 4, 20, 56);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(position);
    spr.position.y += height / 2;
    spr.scale.set(4, 8, 1);
    return spr;
}
