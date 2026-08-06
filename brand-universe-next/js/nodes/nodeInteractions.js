/**
 * nodeInteractions.js — Hover, click, and tooltip logic for industry nodes
 * on the main universe globe. Clicking opens the industry world.
 */
import { getCamera } from '../core/camera.js';
import { toScreen } from '../core/utils.js';

let _raycaster = null;
let _mouse     = new THREE.Vector2();
let _nodes     = [];
let _hovered   = null;
let _onSelect  = null;   // callback(industry)

/**
 * Initialise interaction manager.
 * @param {THREE.Mesh[]} nodes
 * @param {Function}     onSelect   called with industry name on click
 */
export function initNodeInteractions(nodes, onSelect) {
    _nodes    = nodes;
    _onSelect = onSelect;
    _raycaster = new THREE.Raycaster();

    window.addEventListener('mousemove', _onMouseMove);
    window.addEventListener('click',     _onClickEvt);
    window.addEventListener('touchend',  _onTouchEnd);
}

export function disposeNodeInteractions() {
    window.removeEventListener('mousemove', _onMouseMove);
    window.removeEventListener('click',     _onClickEvt);
    window.removeEventListener('touchend',  _onTouchEnd);
}

/* ── Hover ───────────────────────────────────────── */
function _onMouseMove(e) {
    _mouse.x = (e.clientX / window.innerWidth)  * 2 - 1;
    _mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_mouse, getCamera());

    const hits = _raycaster.intersectObjects(_nodes);
    const hit  = hits[0]?.object ?? null;

    if (_hovered && _hovered !== hit) {
        _unhover(_hovered);
    }
    if (hit && hit !== _hovered) {
        _hover(hit);
    }
    if (!hit) _hideTooltip();
}

function _hover(node) {
    _hovered = node;
    node.material.emissiveIntensity = 3.5;
    node.material.color.setHex(0xFFD97A);
    node.material.emissive.setHex(0xFFD97A);
    if (node.userData.light) node.userData.light.intensity = 4;
    document.body.style.cursor = 'pointer';
    _showTooltip(node);
}

function _unhover(node) {
    node.material.emissiveIntensity = 1.0;
    const orig = node.userData.originalColor ?? 0xC6A85E;
    node.material.color.setHex(orig);
    node.material.emissive.setHex(orig);
    if (node.userData.light) node.userData.light.intensity = 1.5;
    document.body.style.cursor = 'default';
    _hovered = null;
}

/* ── Click ───────────────────────────────────────── */
function _onClickEvt(e) {
    _mouse.x = (e.clientX / window.innerWidth)  * 2 - 1;
    _mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_mouse, getCamera());
    const hits = _raycaster.intersectObjects(_nodes);
    if (hits.length) _select(hits[0].object);
}

function _onTouchEnd(e) {
    if (!e.changedTouches.length) return;
    const t = e.changedTouches[0];
    _mouse.x = (t.clientX / window.innerWidth)  * 2 - 1;
    _mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_mouse, getCamera());
    const hits = _raycaster.intersectObjects(_nodes);
    if (hits.length) _select(hits[0].object);
}

function _select(node) {
    const industry = node.userData.industry;
    if (!industry) return;
    _hideTooltip();
    _onSelect?.(industry);
}

/* ── Tooltip ─────────────────────────────────────── */
function _showTooltip(node) {
    let tip = document.getElementById('node-hover-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'node-hover-tooltip';
        tip.style.cssText = `
            position:fixed; pointer-events:none; z-index:1001;
            transform:translate(-50%,-100%); white-space:nowrap;
            transition:opacity 0.18s;
        `;
        document.body.appendChild(tip);
    }
    tip.innerHTML = `
        <div style="
            background:linear-gradient(135deg,rgba(4,12,28,0.96),rgba(8,20,42,0.92));
            backdrop-filter:blur(16px); border:1px solid rgba(100,185,255,0.3);
            border-radius:6px; padding:9px 16px 10px;
            font-family:'Rajdhani',sans-serif; color:#dff0ff;
        ">
            <div style="font-family:'Orbitron',monospace;font-size:7px;letter-spacing:2.5px;
                        color:rgba(100,210,255,0.55);margin-bottom:4px">// INDUSTRY NODE</div>
            <div style="font-size:15px;font-weight:700">${node.userData.industry}</div>
            <div style="font-size:9px;color:rgba(180,210,230,0.5);margin-top:3px;letter-spacing:1px">
                CLICK TO ENTER WORLD
            </div>
        </div>
        <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;
                    border-top:8px solid rgba(100,185,255,0.3);margin:0 auto"></div>
    `;

    const screen = toScreen(node.position, getCamera());
    tip.style.left    = screen.x + 'px';
    tip.style.top     = (screen.y - 14) + 'px';
    tip.style.opacity = '1';
}

function _hideTooltip() {
    const tip = document.getElementById('node-hover-tooltip');
    if (tip) tip.style.opacity = '0';
}

/**
 * Update tooltip position each frame (for selected node that stays visible).
 * Call from animation loop.
 */
export function tickNodeTooltip() {
    if (!_hovered) return;
    const screen = toScreen(_hovered.position, getCamera());
    const tip    = document.getElementById('node-hover-tooltip');
    if (tip && tip.style.opacity !== '0') {
        tip.style.left = screen.x + 'px';
        tip.style.top  = (screen.y - 14) + 'px';
    }
}
