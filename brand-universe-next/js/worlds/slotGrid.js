/**
 * slotGrid.js — Generates and manages the 10,000-slot grid for an industry world.
 *
 * Grid layout: 100 × 100 slots
 * Each slot has:
 *   - index, row, col
 *   - worldPos (THREE.Vector3)
 *   - heightY (terrain elevation)
 *   - type: 'normal' | 'mountain' | 'central'
 *   - premiumMultiplier
 *   - ownerId (null if empty)
 *   - buildingId (null if no building)
 *   - mesh (instanced mesh reference)
 *
 * Mountains: top 2% by elevation → premium × 5
 * Central:   inner 10×10 grid    → premium × 3
 */
import { seededRandom, indexToGrid, slotToWorldPos } from '../core/utils.js';
import { getScene } from '../core/renderer.js';
import { MOUNTAIN_SLOT_PERCENT, MOUNTAIN_PRICE_MULTIPLIER, CENTRAL_PRICE_MULTIPLIER } from '../../config/planets.js';

export const GRID_SIZE  = 100;   // 100×100 = 10,000 slots
export const SLOT_SIZE  = 4;     // world units per slot
const HALF = (GRID_SIZE * SLOT_SIZE) / 2;

/** @type {Map<number, SlotData>} index → slot */
let _slots = new Map();

/** @type {THREE.InstancedMesh} — one draw call for all slot tiles */
let _slotInstancedMesh = null;

/** Noise-based height function (simple sin-based, replace with real noise if desired) */
function terrainHeight(row, col, seed) {
    const rng   = seededRandom(seed + row * 997 + col * 31);
    const base  = rng() * 4;
    const ridge = Math.sin(row / 14) * Math.cos(col / 14) * 8;
    const peaks = Math.pow(Math.max(0, Math.sin(row / 8) * Math.sin(col / 8)), 2) * 20;
    return base + ridge + peaks;
}

/**
 * Build the slot grid.
 * @param {number} planetSeed  deterministic seed from planet/industry ID
 * @param {Map}    occupancy   Map<slotIndex, { ownerId, buildingId }>  from backend
 * @returns {Map<number, SlotData>}
 */
export function buildSlotGrid(planetSeed, occupancy = new Map()) {
    _slots.clear();

    // 1. Compute heights
    const heights = [];
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        const { row, col } = indexToGrid(i, GRID_SIZE);
        heights.push({ i, h: terrainHeight(row, col, planetSeed) });
    }

    // 2. Tag mountain slots (top 2%)
    const sorted   = [...heights].sort((a, b) => b.h - a.h);
    const mountCnt = Math.floor(GRID_SIZE * GRID_SIZE * MOUNTAIN_SLOT_PERCENT);
    const mountainSet = new Set(sorted.slice(0, mountCnt).map(x => x.i));

    // 3. Tag central slots (inner 10×10)
    const centralMin = Math.floor(GRID_SIZE / 2) - 5;
    const centralMax = Math.floor(GRID_SIZE / 2) + 5;

    // 4. Build slot objects
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        const { row, col } = indexToGrid(i, GRID_SIZE);
        const heightY      = heights[i].h;
        const isMountain   = mountainSet.has(i);
        const isCentral    = (row >= centralMin && row < centralMax && col >= centralMin && col < centralMax);

        let type = 'normal';
        let premiumMult = 1;
        if (isMountain) { type = 'mountain'; premiumMult = MOUNTAIN_PRICE_MULTIPLIER; }
        else if (isCentral) { type = 'central'; premiumMult = CENTRAL_PRICE_MULTIPLIER; }

        const worldPos = slotToWorldPos(row, col, SLOT_SIZE, heightY, GRID_SIZE);
        const occ      = occupancy.get(i) || {};

        /** @type {SlotData} */
        const slot = {
            index:            i,
            row, col,
            worldPos,
            heightY,
            type,
            premiumMultiplier: premiumMult,
            ownerId:   occ.ownerId   ?? null,
            buildingId: occ.buildingId ?? null,
            locked:    occ.locked    ?? false,   // e.g. reserved / auctioning
            _meshIdx:  i,                         // index into InstancedMesh
        };
        _slots.set(i, slot);
    }

    return _slots;
}

export function getSlots() { return _slots; }
export function getSlot(index) { return _slots.get(index); }

/**
 * Update a single slot's occupancy (called after purchase/transfer confirmed).
 */
export function updateSlot(index, patch) {
    const slot = _slots.get(index);
    if (!slot) return;
    Object.assign(slot, patch);
}

/**
 * Create the base terrain plane + instanced slot tile markers.
 * Mountain slots rendered as slightly elevated colored tiles.
 * @param {THREE.Texture} terrainTexture
 * @param {object}        perf   performance config
 */
export function renderSlotGrid(terrainTexture, perf) {
    const scene = getScene();

    // ── Terrain ground plane ──────────────────────────────────
    const terrainGeo = new THREE.PlaneGeometry(
        GRID_SIZE * SLOT_SIZE,
        GRID_SIZE * SLOT_SIZE,
        perf.terrainSegments,
        perf.terrainSegments
    );
    terrainGeo.rotateX(-Math.PI / 2);

    // Displace vertices by slot heights
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x   = pos.getX(i);
        const z   = pos.getZ(i);
        const col = Math.round((x + HALF) / SLOT_SIZE);
        const row = Math.round((z + HALF) / SLOT_SIZE);
        const idx = Math.max(0, Math.min(GRID_SIZE * GRID_SIZE - 1, row * GRID_SIZE + col));
        const slot = _slots.get(idx);
        if (slot) pos.setY(i, slot.heightY);
    }
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
        map:          terrainTexture || null,
        color:        terrainTexture ? 0xffffff : 0x2a3a2a,
        roughness:    0.9,
        metalness:    0.05,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.name = 'terrain';
    scene.add(terrainMesh);

    // ── Slot tile markers (InstancedMesh, 1 draw call) ────────
    const tileGeo = new THREE.PlaneGeometry(SLOT_SIZE * 0.92, SLOT_SIZE * 0.92);
    tileGeo.rotateX(-Math.PI / 2);
    const tileMat = new THREE.MeshStandardMaterial({
        color:      0x334455,
        transparent: true,
        opacity:     0.45,
        roughness:   0.6,
        metalness:   0.2,
        depthWrite:  false,
    });
    _slotInstancedMesh = new THREE.InstancedMesh(tileGeo, tileMat, _slots.size);
    _slotInstancedMesh.name = 'slotTiles';

    const dummy = new THREE.Object3D();
    _slots.forEach((slot, i) => {
        dummy.position.copy(slot.worldPos).setY(slot.heightY + 0.05);
        dummy.updateMatrix();
        _slotInstancedMesh.setMatrixAt(i, dummy.matrix);

        // Color by type
        const col = slot.type === 'mountain' ? new THREE.Color(0xFFCC44) :
                    slot.type === 'central'  ? new THREE.Color(0x4ECAFF) :
                    slot.ownerId             ? new THREE.Color(0x44FF88) :
                                               new THREE.Color(0x334455);
        _slotInstancedMesh.setColorAt(i, col);
    });
    _slotInstancedMesh.instanceMatrix.needsUpdate = true;
    if (_slotInstancedMesh.instanceColor) _slotInstancedMesh.instanceColor.needsUpdate = true;

    scene.add(_slotInstancedMesh);
    return { terrainMesh, slotMesh: _slotInstancedMesh };
}

/**
 * Update the colour of a single slot tile (e.g. after purchase).
 */
export function setSlotColor(index, hexColor) {
    if (!_slotInstancedMesh) return;
    _slotInstancedMesh.setColorAt(index, new THREE.Color(hexColor));
    _slotInstancedMesh.instanceColor.needsUpdate = true;
}

/**
 * Raycast against slot tiles and return the hit slot, or null.
 * @param {THREE.Raycaster} raycaster
 */
export function raycastSlots(raycaster) {
    if (!_slotInstancedMesh) return null;
    const hits = raycaster.intersectObject(_slotInstancedMesh);
    if (!hits.length) return null;
    const idx = hits[0].instanceId;
    return _slots.get(idx) ?? null;
}

/** How many slots are occupied */
export function getOccupancyCount() {
    let n = 0;
    _slots.forEach(s => { if (s.ownerId) n++; });
    return n;
}
