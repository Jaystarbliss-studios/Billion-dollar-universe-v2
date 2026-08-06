/**
 * slotInteractions.js — Hover, click, buy, and detail panel for industry world slots.
 * Raycasts against the instanced slot tile mesh.
 */
import { getCamera } from '../core/camera.js';
import { flyToSlot } from '../core/camera.js';
import { raycastSlots, getSlot } from '../worlds/slotGrid.js';
import { computeSlotPrice, formatPrice } from '../economy/slotPricing.js';
import { getState, buySlot, isSlotOwned } from '../backend/stateManager.js';
import { getBuildingCost, BUILDING_CATALOG } from '../worlds/buildingManager.js';
import { renderAuctionPanel } from '../economy/auctions.js';

let _raycaster     = null;
let _mouse         = new THREE.Vector2();
let _hoveredSlot   = null;
let _selectedSlot  = null;
let _industry      = '';
let _planetIndex   = 0;
let _occupiedCount = 0;
let _totalSlots    = 10000;
let _planetMult    = 1;

/**
 * Initialise slot interactions for the active world.
 * @param {string}  industry
 * @param {number}  planetIndex
 * @param {number}  occupiedCount
 * @param {number}  planetMult
 */
export function initSlotInteractions(industry, planetIndex, occupiedCount, planetMult = 1) {
    _industry      = industry;
    _planetIndex   = planetIndex;
    _occupiedCount = occupiedCount;
    _planetMult    = planetMult;
    _raycaster     = new THREE.Raycaster();

    window.addEventListener('mousemove', _onMouseMove);
    window.addEventListener('click',     _onClickEvt);
    window.addEventListener('touchend',  _onTouchEnd, { passive: true });
}

export function disposeSlotInteractions() {
    window.removeEventListener('mousemove', _onMouseMove);
    window.removeEventListener('click',     _onClickEvt);
    window.removeEventListener('touchend',  _onTouchEnd);
    _hideSlotTooltip();
    _hideSlotPanel();
}

/* ── Pointer ────────────────────────────────────── */
function _pickSlot(clientX, clientY) {
    _mouse.x = (clientX / window.innerWidth)  * 2 - 1;
    _mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_mouse, getCamera());
    return raycastSlots(_raycaster);
}

function _onMouseMove(e) {
    const slot = _pickSlot(e.clientX, e.clientY);
    if (slot !== _hoveredSlot) {
        _hoveredSlot = slot;
        if (slot) { _showSlotTooltip(slot, e.clientX, e.clientY); document.body.style.cursor = 'pointer'; }
        else      { _hideSlotTooltip(); document.body.style.cursor = 'default'; }
    }
    if (slot) _updateTooltipPos(e.clientX, e.clientY);
}

function _onClickEvt(e)  { const s = _pickSlot(e.clientX, e.clientY); if (s) _selectSlot(s); }
function _onTouchEnd(e) {
    if (!e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const s = _pickSlot(t.clientX, t.clientY);
    if (s) _selectSlot(s);
}

/* ── Select & Panel ─────────────────────────────── */
function _selectSlot(slot) {
    _selectedSlot = slot;
    flyToSlot(slot.worldPos);
    _showSlotPanel(slot);
}

/* ── Slot Hover Tooltip ─────────────────────────── */
function _showSlotTooltip(slot, x, y) {
    let tip = document.getElementById('slot-hover-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'slot-hover-tip';
        tip.style.cssText = `
            position:fixed; pointer-events:none; z-index:1001;
            transform:translate(-50%,-100%); white-space:nowrap;
            font-family:'Rajdhani',sans-serif;
        `;
        document.body.appendChild(tip);
    }
    const state = getState();
    const price = computeSlotPrice({ occupiedCount: _occupiedCount, totalSlots: _totalSlots, premiumMultiplier: slot.premiumMultiplier, planetMultiplier: _planetMult });
    const owned = slot.ownerId ? (slot.ownerId === state.brand?.id ? 'YOURS' : slot.ownerId.slice(0,8)) : 'AVAILABLE';
    const typeLabel = slot.type.toUpperCase();
    const typeDot   = slot.type === 'mountain' ? '⬡' : slot.type === 'central' ? '◎' : '□';

    tip.innerHTML = `
        <div style="background:rgba(4,10,24,0.95);backdrop-filter:blur(14px);
                    border:1px solid rgba(78,202,255,0.25);border-radius:5px;padding:8px 13px">
            <div style="font-size:8px;color:rgba(78,202,255,0.5);letter-spacing:2px;font-family:'Orbitron',monospace">
                ${typeDot} SLOT #${slot.index} · ${typeLabel}
            </div>
            <div style="font-size:14px;color:#fff;font-weight:700;margin:3px 0">${owned}</div>
            <div style="font-size:11px;color:rgba(198,168,94,0.9)">${formatPrice(price)}</div>
        </div>`;

    _updateTooltipPos(x, y);
}

function _updateTooltipPos(x, y) {
    const tip = document.getElementById('slot-hover-tip');
    if (tip) { tip.style.left = x + 'px'; tip.style.top = (y - 14) + 'px'; }
}

function _hideSlotTooltip() {
    const tip = document.getElementById('slot-hover-tip');
    if (tip) tip.remove();
}

/* ── Slot Detail Panel ──────────────────────────── */
function _showSlotPanel(slot) {
    _hideSlotPanel();
    const state   = getState();
    const price   = computeSlotPrice({ occupiedCount: _occupiedCount, totalSlots: _totalSlots, premiumMultiplier: slot.premiumMultiplier, planetMultiplier: _planetMult });
    const ownedByMe = slot.ownerId === state.brand?.id;
    const ownedByOther = slot.ownerId && !ownedByMe;

    const panel = document.createElement('div');
    panel.id = 'slot-detail-panel';
    panel.style.cssText = `
        position:fixed; left:20px; bottom:80px; z-index:800;
        background:linear-gradient(135deg,rgba(4,10,24,0.97),rgba(6,14,32,0.95));
        backdrop-filter:blur(20px); border:1px solid rgba(198,168,94,0.35);
        border-radius:10px; padding:20px 24px; width:300px; max-width:90vw;
        font-family:'Orbitron',monospace; color:#fff;
        box-shadow:0 8px 40px rgba(0,0,0,0.6),0 0 30px rgba(198,168,94,0.08);
        animation: panelIn 0.22s ease;
    `;

    const buildingRows = Object.values(BUILDING_CATALOG)
        .filter(b => ownedByMe)
        .map(b => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <span style="font-size:10px;color:rgba(220,235,255,0.7)">${b.label}</span>
            <span style="font-size:10px;color:rgba(198,168,94,0.8)">${b.baseCost === 0 ? 'FREE' : formatPrice(b.baseCost)}</span>
        </div>`).join('');

    panel.innerHTML = `
        <div style="font-size:7px;letter-spacing:2.5px;color:rgba(198,168,94,0.6);margin-bottom:10px">
            // SLOT DETAILS
        </div>
        <div style="display:flex;gap:16px;margin-bottom:16px">
            <div>
                <div style="font-size:7px;color:rgba(255,255,255,0.3)">INDEX</div>
                <div style="font-size:16px;font-weight:700">#${slot.index}</div>
            </div>
            <div>
                <div style="font-size:7px;color:rgba(255,255,255,0.3)">TYPE</div>
                <div style="font-size:16px;color:${slot.type==='mountain'?'#FFD700':slot.type==='central'?'#4ECAFF':'#fff'}">${slot.type.toUpperCase()}</div>
            </div>
            <div>
                <div style="font-size:7px;color:rgba(255,255,255,0.3)">PRICE</div>
                <div style="font-size:16px;color:#FFD700;font-weight:700">${formatPrice(price)}</div>
            </div>
        </div>

        ${ownedByMe ? `
            <div style="font-size:9px;color:#00F5A0;margin-bottom:10px;letter-spacing:1px">✓ YOU OWN THIS SLOT</div>
            <div style="font-size:8px;color:rgba(255,255,255,0.3);margin-bottom:6px">UPGRADE BUILDING:</div>
            ${buildingRows}
        ` : ownedByOther ? `
            <div style="font-size:9px;color:rgba(255,255,255,0.4);margin-bottom:12px">OWNED BY ${slot.ownerId.slice(0,8)}…</div>
        ` : `
            <button id="slot-buy-btn" style="
                width:100%;padding:12px;
                background:linear-gradient(135deg,#C6A85E,#a88840);
                border:none;border-radius:6px;color:#000;
                font-family:'Orbitron',monospace;font-size:11px;
                font-weight:700;letter-spacing:1.5px;cursor:pointer;
                margin-bottom:10px;
            ">⬡ PURCHASE SLOT · ${formatPrice(price)}</button>
        `}

        <button id="slot-panel-close" style="
            position:absolute;top:14px;right:14px;background:none;border:none;
            color:rgba(255,255,255,0.3);cursor:pointer;font-size:16px;
        ">✕</button>
    `;

    document.body.appendChild(panel);

    // Style injection for animation
    if (!document.getElementById('slot-panel-anim')) {
        const s = document.createElement('style');
        s.id = 'slot-panel-anim';
        s.textContent = `@keyframes panelIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`;
        document.head.appendChild(s);
    }

    document.getElementById('slot-panel-close')?.addEventListener('click', _hideSlotPanel);

    document.getElementById('slot-buy-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('slot-buy-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'PROCESSING…'; }
        try {
            await buySlot(slot.index, slot, _industry, _planetIndex);
            _occupiedCount++;
            _hideSlotPanel();
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = `⬡ PURCHASE SLOT · ${formatPrice(price)}`; }
            alert('Purchase failed: ' + err.message);
        }
    });
}

function _hideSlotPanel() {
    const p = document.getElementById('slot-detail-panel');
    if (p) p.remove();
}
