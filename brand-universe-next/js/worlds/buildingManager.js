/**
 * buildingManager.js — Renders brand buildings on slots.
 *
 * Building system:
 *   - Each building is defined by a config (type, floors, style)
 *   - Free basic building on slot purchase (1 floor, generic box)
 *   - Larger/animated buildings cost more coins
 *   - Buildings are pooled via InstancedMesh per building-type
 *   - Each building occupies 1..N slots depending on size
 *
 * Building types (extensible via BUILDING_CATALOG):
 *   basic    – 1 slot, 1–2 floors, free
 *   tower    – 1 slot, 3–10 floors, 500₿/floor
 *   plaza    – 4 slots, 4 floors, 2000₿ flat
 *   skyscraper – 1 slot, 11–25 floors, 1200₿/floor
 *   landmark – 9 slots, up to 100 floors, negotiated
 */
import { getScene } from '../core/renderer.js';
import { getSlot, setSlotColor, GRID_SIZE, SLOT_SIZE } from './slotGrid.js';
import { addTickFn, getPerfRef } from '../core/animationLoop.js';

/* ── Building Catalog ──────────────────────────────── */
export const BUILDING_CATALOG = {
    basic: {
        id: 'basic', label: 'Basic Building',
        slotsRequired: 1, maxFloors: 2,
        costPerFloor: 0, baseCost: 0,     // free on slot purchase
        width: SLOT_SIZE * 0.7, depth: SLOT_SIZE * 0.7,
        color: 0xAAAAAA,
        animated: false,
    },
    tower: {
        id: 'tower', label: 'Tower',
        slotsRequired: 1, maxFloors: 10,
        costPerFloor: 500, baseCost: 200,
        width: SLOT_SIZE * 0.6, depth: SLOT_SIZE * 0.6,
        color: 0x4488CC,
        animated: false,
    },
    plaza: {
        id: 'plaza', label: 'Corporate Plaza',
        slotsRequired: 4, maxFloors: 4,
        costPerFloor: 800, baseCost: 2000,
        width: SLOT_SIZE * 1.8, depth: SLOT_SIZE * 1.8,
        color: 0x88CCFF,
        animated: false,
    },
    skyscraper: {
        id: 'skyscraper', label: 'Skyscraper',
        slotsRequired: 1, maxFloors: 25,
        costPerFloor: 1200, baseCost: 5000,
        width: SLOT_SIZE * 0.55, depth: SLOT_SIZE * 0.55,
        color: 0x00EEFF,
        animated: true,
    },
    landmark: {
        id: 'landmark', label: 'Landmark Tower',
        slotsRequired: 9, maxFloors: 100,
        costPerFloor: 3000, baseCost: 50000,
        width: SLOT_SIZE * 2.8, depth: SLOT_SIZE * 2.8,
        color: 0xFFD700,
        animated: true,
    },
};

/* ── Internal State ────────────────────────────────── */
/** @type {Map<string, THREE.Mesh>}  buildingId → mesh */
const _buildingMeshes = new Map();

/** @type {Map<string, BuildingData>} buildingId → config */
const _buildings = new Map();

/** For animated buildings — tracks their phase */
const _animated  = [];

/* ── Helpers ───────────────────────────────────────── */
function floorHeight(floors) { return floors * 3; } // 3 world-units per floor

function buildingCost(catalogId, floors) {
    const cat = BUILDING_CATALOG[catalogId];
    if (!cat) return 0;
    return cat.baseCost + cat.costPerFloor * Math.max(0, floors - 1);
}

/* ── Public API ────────────────────────────────────── */

/**
 * Place a building on the map.
 * @param {string}  buildingId   unique ID (from backend)
 * @param {number}  slotIndex    primary slot index
 * @param {string}  catalogId    BUILDING_CATALOG key
 * @param {number}  floors
 * @param {object}  brandData    { name, color, logoUrl? }
 */
export function placeBuilding(buildingId, slotIndex, catalogId, floors, brandData) {
    const catalog = BUILDING_CATALOG[catalogId] || BUILDING_CATALOG.basic;
    const slot    = getSlot(slotIndex);
    if (!slot) return null;

    const h = floorHeight(floors);
    const w = catalog.width;
    const d = catalog.depth;

    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
        color:     new THREE.Color(brandData.color ?? catalog.color),
        emissive:  new THREE.Color(brandData.color ?? catalog.color).multiplyScalar(0.15),
        roughness: 0.4,
        metalness: 0.6,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(slot.worldPos);
    mesh.position.y = slot.heightY + h / 2;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.name = `building_${buildingId}`;
    mesh.userData = { buildingId, slotIndex, catalogId, floors, brandData };

    getScene().add(mesh);
    _buildingMeshes.set(buildingId, mesh);

    /** @type {BuildingData} */
    const data = { buildingId, slotIndex, catalogId, floors, brandData, mesh, phase: Math.random() * Math.PI * 2 };
    _buildings.set(buildingId, data);

    if (catalog.animated && getPerfRef().animatedBuildings) {
        _animated.push(data);
    }

    // Update slot tile color → owned
    setSlotColor(slotIndex, brandData.color ?? 0x44FF88);

    return mesh;
}

/**
 * Upgrade a building's floor count.
 */
export function upgradeBuilding(buildingId, newFloors) {
    const data = _buildings.get(buildingId);
    if (!data) return;
    const slot   = getSlot(data.slotIndex);
    const newH   = floorHeight(newFloors);
    const catalog = BUILDING_CATALOG[data.catalogId];

    // Remove old mesh
    getScene().remove(data.mesh);
    data.mesh.geometry.dispose();

    // Rebuild
    const geo  = new THREE.BoxGeometry(catalog.width, newH, catalog.depth);
    data.mesh  = new THREE.Mesh(geo, data.mesh.material);
    data.mesh.position.copy(slot.worldPos);
    data.mesh.position.y = slot.heightY + newH / 2;
    data.mesh.castShadow = true;
    data.floors = newFloors;
    getScene().add(data.mesh);
    _buildingMeshes.set(buildingId, data.mesh);
}

/**
 * Remove a building (e.g. demolition or slot transfer).
 */
export function removeBuilding(buildingId) {
    const data = _buildings.get(buildingId);
    if (!data) return;
    getScene().remove(data.mesh);
    data.mesh.geometry.dispose();
    data.mesh.material.dispose();
    _buildingMeshes.delete(buildingId);
    _buildings.delete(buildingId);
    const idx = _animated.indexOf(data);
    if (idx !== -1) _animated.splice(idx, 1);
}

/**
 * Bulk-load buildings from backend snapshot.
 * @param {Array<{buildingId, slotIndex, catalogId, floors, brandData}>} list
 */
export function loadBuildings(list) {
    list.forEach(b => placeBuilding(b.buildingId, b.slotIndex, b.catalogId, b.floors, b.brandData));
}

/**
 * Get building cost for display in UI.
 */
export function getBuildingCost(catalogId, floors) { return buildingCost(catalogId, floors); }

/**
 * Animate buildings (registered in animation loop).
 */
addTickFn('buildingManager', (dt, time) => {
    if (!_animated.length) return;
    _animated.forEach(data => {
        if (!data.mesh) return;
        // Subtle hover bob for animated buildings
        data.phase += dt * 0.8;
        data.mesh.position.y += Math.sin(data.phase) * 0.003;
        // Pulse emissive
        const e = 0.1 + Math.abs(Math.sin(data.phase * 0.5)) * 0.2;
        data.mesh.material.emissiveIntensity = e;
    });
});

export function getBuilding(id)  { return _buildings.get(id); }
export function getAllBuildings() { return _buildings; }
