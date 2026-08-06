/**
 * camera.js — Camera setup, animation helpers, LOD distance tracking
 */

let _camera   = null;
let _controls = null;
let _animQueue = [];  // { startPos, endPos, startTarget, endTarget, duration, t, onDone }

/**
 * Create and return a perspective camera.
 * @param {number} fov
 * @param {THREE.WebGLRenderer} renderer
 */
export function initCamera(fov = 45, renderer) {
    _camera = new THREE.PerspectiveCamera(
        fov,
        window.innerWidth / window.innerHeight,
        0.1,
        5000
    );
    _camera.position.set(0, 80, 200);
    _camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => {
        _camera.aspect = window.innerWidth / window.innerHeight;
        _camera.updateProjectionMatrix();
    });

    return _camera;
}

export function getCamera() { return _camera; }

/**
 * Attach OrbitControls.
 * @param {HTMLElement} domElement
 * @param {object} options
 */
export function initControls(domElement, options = {}) {
    _controls = new THREE.OrbitControls(_camera, domElement);
    _controls.enableDamping   = true;
    _controls.dampingFactor   = 0.06;
    _controls.enablePan       = options.enablePan ?? true;
    _controls.enableZoom      = true;
    _controls.minDistance     = options.minDistance ?? 10;
    _controls.maxDistance     = options.maxDistance ?? 800;
    _controls.maxPolarAngle   = options.maxPolarAngle ?? Math.PI * 0.78;
    _controls.autoRotate      = options.autoRotate ?? false;
    _controls.autoRotateSpeed = 0.3;
    return _controls;
}

export function getControls() { return _controls; }

/**
 * Animate camera smoothly to a new position/target.
 * @param {THREE.Vector3} endPos
 * @param {THREE.Vector3} endTarget
 * @param {number} duration  ms
 * @param {Function} onDone
 */
export function animateCameraTo(endPos, endTarget, duration = 1200, onDone = null) {
    if (!_camera || !_controls) return;
    _animQueue.push({
        startPos:    _camera.position.clone(),
        endPos:      endPos.clone(),
        startTarget: _controls.target.clone(),
        endTarget:   endTarget.clone(),
        duration,
        t: 0,
        onDone,
    });
}

/**
 * Ease function: smooth cubic in-out
 */
function easeInOut(t) {
    return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
}

/**
 * Tick camera animations. Call every frame from animationLoop.
 * @param {number} dt  seconds
 */
export function tickCamera(dt) {
    if (_controls) _controls.update();
    if (!_animQueue.length) return;

    const anim = _animQueue[0];
    anim.t = Math.min(anim.t + dt * 1000 / anim.duration, 1);
    const e = easeInOut(anim.t);

    _camera.position.lerpVectors(anim.startPos, anim.endPos, e);
    _controls.target.lerpVectors(anim.startTarget, anim.endTarget, e);

    if (anim.t >= 1) {
        _animQueue.shift();
        if (anim.onDone) anim.onDone();
    }
}

/** True if any camera animation is playing */
export function isCameraAnimating() { return _animQueue.length > 0; }

/**
 * Fly camera to orbit a slot position at a good viewing height.
 * @param {THREE.Vector3} slotWorldPos
 */
export function flyToSlot(slotWorldPos) {
    const offset = new THREE.Vector3(0, 40, 60);
    animateCameraTo(
        slotWorldPos.clone().add(offset),
        slotWorldPos.clone(),
        900
    );
}

/**
 * Return distance from camera to a world-space point.
 * Used by LODManager.
 */
export function distanceTo(worldPos) {
    return _camera ? _camera.position.distanceTo(worldPos) : Infinity;
}
