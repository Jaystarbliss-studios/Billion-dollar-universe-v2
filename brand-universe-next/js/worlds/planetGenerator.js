/**
 * planetGenerator.js — Generates a themed 3D world for an industry.
 *
 * Each industry gets a distinct terrain style, sky, fog, lighting.
 * Worlds can expand to sequential planets when the first fills up.
 *
 * Themes map to texture keys; actual texture files are in /assets/textures/
 */
import { getScene } from '../core/renderer.js';
import { buildSlotGrid, renderSlotGrid } from './slotGrid.js';
import { getPlanetConfig } from '../../config/planets.js';
import { addTickFn } from '../core/animationLoop.js';

/** Map industry name → planet theme index (rotate through as planets expand) */
const INDUSTRY_SEEDS = {
    'Technology':        1001,
    'Finance':           2002,
    'Healthcare':        3003,
    'Agriculture':       4004,
    'Education':         5005,
    'Fashion':           6006,
    'Energy':            7007,
    'Media':             8008,
    'Gaming':            9009,
    'Real Estate':       1010,
    'Transportation':    1111,
    'Science':           1212,
    'Government':        1313,
    'Entertainment':     1414,
    'Artificial Intelligence': 1515,
    'Manufacturing':     1616,
    'Food & Beverage':   1717,
    'Culture & Arts':    1818,
    'Space':             1919,
    'Cybersecurity':     2020,
};

/** Industry → preferred planet theme index */
const INDUSTRY_THEME = {
    'Technology':        1,
    'Finance':           4,
    'Healthcare':        3,
    'Agriculture':       3,
    'Education':         0,
    'Fashion':           7,
    'Energy':            1,
    'Media':             7,
    'Gaming':            5,
    'Real Estate':       0,
    'Transportation':    2,
    'Science':           2,
    'Government':        0,
    'Entertainment':     7,
    'Artificial Intelligence': 5,
    'Manufacturing':     6,
    'Food & Beverage':   3,
    'Culture & Arts':    7,
    'Space':             6,
    'Cybersecurity':     5,
};

let _currentWorld = null;    // { industry, planetIndex, config, objects[] }
let _skyDome      = null;
let _ambient      = null;
let _sunLight     = null;
let _groundRing   = null;

/**
 * Load an industry world (planet 0 = first planet).
 * Clears previous world first.
 *
 * @param {string}  industry     e.g. 'Technology'
 * @param {number}  planetIndex  0-based sequential planet for this industry
 * @param {Map}     occupancy    slot occupancy from backend
 * @param {object}  perf         performance config
 * @returns {Promise<WorldResult>}
 */
export async function loadWorld(industry, planetIndex, occupancy, perf) {
    unloadWorld();

    const themeIdx = (INDUSTRY_THEME[industry] ?? 0) + planetIndex;
    const config   = getPlanetConfig(themeIdx);
    const seed     = (INDUSTRY_SEEDS[industry] ?? 1337) + planetIndex * 997;
    const scene    = getScene();

    // ── Sky ────────────────────────────────────────────────
    scene.background = new THREE.Color(config.skyColor);
    scene.fog        = new THREE.FogExp2(config.fogColor, 0.004);

    const skyGeo  = new THREE.SphereGeometry(2000, 16, 16);
    const skyMat  = new THREE.MeshBasicMaterial({ color: config.skyColor, side: THREE.BackSide });
    _skyDome      = new THREE.Mesh(skyGeo, skyMat);
    _skyDome.name = 'skyDome';
    scene.add(_skyDome);

    // ── Lighting ───────────────────────────────────────────
    _ambient = new THREE.AmbientLight(0x334466, 0.4);
    scene.add(_ambient);

    _sunLight = new THREE.DirectionalLight(0xFFF5E0, 1.6);
    _sunLight.position.set(200, 300, 100);
    if (perf.shadowsEnabled) {
        _sunLight.castShadow = true;
        _sunLight.shadow.mapSize.set(2048, 2048);
        _sunLight.shadow.camera.near   = 10;
        _sunLight.shadow.camera.far    = 800;
        _sunLight.shadow.camera.left   = -250;
        _sunLight.shadow.camera.right  = 250;
        _sunLight.shadow.camera.top    = 250;
        _sunLight.shadow.camera.bottom = -250;
    }
    scene.add(_sunLight);

    const fill = new THREE.DirectionalLight(new THREE.Color(config.accentColor), 0.3);
    fill.position.set(-100, 50, -200);
    scene.add(fill);

    // ── Terrain & Slots ────────────────────────────────────
    const slots = buildSlotGrid(seed, occupancy);

    // Load terrain texture (lazy; fallback to color if missing)
    let terrainTex = null;
    try {
        terrainTex = await new Promise((res, rej) => {
            new THREE.TextureLoader().load(
                `assets/textures/terrain_${config.terrainKey}.jpg`,
                res, undefined, rej
            );
        });
        terrainTex.wrapS = terrainTex.wrapT = THREE.RepeatWrapping;
        terrainTex.repeat.set(20, 20);
    } catch (_) { /* use color fallback */ }

    const { terrainMesh, slotMesh } = renderSlotGrid(terrainTex, perf);

    // ── Ground decorative ring ─────────────────────────────
    const ringGeo = new THREE.RingGeometry(198, 202, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(config.accentColor), side: THREE.DoubleSide,
        transparent: true, opacity: 0.18, depthWrite: false,
    });
    _groundRing = new THREE.Mesh(ringGeo, ringMat);
    _groundRing.rotation.x = -Math.PI / 2;
    _groundRing.position.y = -1;
    scene.add(_groundRing);

    _currentWorld = {
        industry, planetIndex, config, seed,
        objects: [terrainMesh, slotMesh, _skyDome, _groundRing],
    };

    // Animate ring pulse
    addTickFn('planetRing', (dt, time) => {
        if (_groundRing) {
            _groundRing.material.opacity = 0.12 + Math.sin(time * 0.8) * 0.06;
            _groundRing.rotation.z += 0.0005;
        }
    });

    return { slots, config };
}

/**
 * Unload and dispose the current world to free memory.
 */
export function unloadWorld() {
    if (!_currentWorld) return;
    const scene = getScene();
    _currentWorld.objects.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        }
    });
    if (_ambient)   scene.remove(_ambient);
    if (_sunLight)  scene.remove(_sunLight);
    _currentWorld = null;
}

export function getCurrentWorld() { return _currentWorld; }
