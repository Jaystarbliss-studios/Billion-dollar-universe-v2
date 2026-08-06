/**
 * renderer.js — Three.js WebGL renderer initialisation
 * Shared singleton; import getRenderer() / getScene() anywhere.
 */
import { getPerf } from '../../config/performance.js';

let _renderer = null;
let _scene    = null;

/**
 * Initialise and return the renderer, attaching it to `container`.
 * Safe to call multiple times — returns existing instance.
 * @param {HTMLElement} container
 */
export function initRenderer(container) {
    if (_renderer) return _renderer;

    const perf = getPerf();

    _scene = new THREE.Scene();
    _scene.fog = new THREE.FogExp2(0x0a1a2e, 0.0035);

    _renderer = new THREE.WebGLRenderer({
        antialias:       perf.antialias,
        alpha:           true,
        powerPreference: 'high-performance',
    });

    _renderer.setSize(window.innerWidth, window.innerHeight);
    _renderer.setPixelRatio(perf.pixelRatio);

    if (perf.shadowsEnabled) {
        _renderer.shadowMap.enabled = true;
        _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    _renderer.toneMapping = THREE.ACESFilmicToneMapping;
    _renderer.toneMappingExposure = 1.1;
    _renderer.outputEncoding = THREE.sRGBEncoding;

    container.appendChild(_renderer.domElement);

    window.addEventListener('resize', () => {
        _renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return _renderer;
}

export function getRenderer() { return _renderer; }
export function getScene()    { return _scene;    }

/**
 * Render a single frame.
 * Call from the animation loop.
 * @param {THREE.Camera} camera
 */
export function renderFrame(camera) {
    if (_renderer && _scene && camera) {
        _renderer.render(_scene, camera);
    }
}

/**
 * Dispose all objects in scene to free GPU memory
 * (called when switching worlds / planets).
 */
export function clearScene(keepList = []) {
    if (!_scene) return;
    const toRemove = [];
    _scene.traverse(obj => {
        if (keepList.includes(obj)) return;
        toRemove.push(obj);
    });
    toRemove.forEach(obj => {
        _scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => {
                if (m.map) m.map.dispose();
                m.dispose();
            });
        }
    });
}
