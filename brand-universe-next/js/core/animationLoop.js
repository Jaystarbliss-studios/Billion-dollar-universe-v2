/**
 * animationLoop.js — Central requestAnimationFrame loop.
 * Manages frame skipping, FPS tracking, and per-frame callbacks.
 */
import { getPerf, PERFORMANCE_TIERS } from '../../config/performance.js';
import { renderFrame } from './renderer.js';
import { tickCamera, getCamera } from './camera.js';

/* ── State ─────────────────────────────────────────── */
const _tickFns    = new Map();   // id → fn(dt, time, frame)
let   _running    = false;
let   _frame      = 0;
let   _lastTs     = 0;
let   _time       = 0;          // accumulated seconds
let   _perf       = getPerf();

/* ── FPS Monitoring ──────────────────────────────── */
const FPS_WINDOW  = 60;         // rolling sample count
const _fpsSamples = [];
let   _fpsAvg     = 60;
let   _lastFpsCheck = 0;
const FPS_CHECK_INTERVAL = 5000; // ms between tier evaluations
let   _tierLocked = false;

export function getFPS()    { return _fpsAvg; }
export function getTime()   { return _time;   }
export function getFrame()  { return _frame;  }
export function getPerfRef() { return _perf;  }

/**
 * Register a per-frame callback.
 * @param {string} id   unique key (allows removal)
 * @param {Function} fn fn(dt: seconds, time: seconds, frame: number)
 */
export function addTickFn(id, fn)    { _tickFns.set(id, fn); }
export function removeTickFn(id)     { _tickFns.delete(id);  }

/** Start the loop */
export function startLoop() {
    if (_running) return;
    _running = true;
    _lastTs  = performance.now();
    requestAnimationFrame(_tick);
}

/** Stop the loop */
export function stopLoop() { _running = false; }

/* ── Internal loop ───────────────────────────────── */
function _tick(ts) {
    if (!_running) return;

    const dt  = Math.min((ts - _lastTs) / 1000, 0.05);
    _lastTs   = ts;
    _time    += dt;
    _frame++;

    // FPS tracking
    _fpsSamples.push(1 / dt);
    if (_fpsSamples.length > FPS_WINDOW) _fpsSamples.shift();
    _fpsAvg = _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;

    // Adaptive tier downgrade (mobile only, one-way)
    if (!_tierLocked && ts - _lastFpsCheck > FPS_CHECK_INTERVAL && _time > 10) {
        _lastFpsCheck = ts;
        _checkPerf();
    }

    // Frame skip for low-end devices
    const skip = _perf.frameSkip || 1;
    if (_frame % skip === 0) {
        tickCamera(dt * skip);

        _tickFns.forEach(fn => {
            try { fn(dt * skip, _time, _frame); }
            catch (e) { console.warn('[Loop] tick error:', e); }
        });

        renderFrame(getCamera());
    }

    requestAnimationFrame(_tick);
}

/* ── Adaptive Performance ────────────────────────── */
const TIER_ORDER = ['ultra','high','medium','low','potato'];

function _checkPerf() {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (!isMobile) { _tierLocked = true; return; }

    const current = _perf.label.toLowerCase();
    const idx     = TIER_ORDER.indexOf(current);

    if (_fpsAvg < 28 && idx < TIER_ORDER.length - 1) {
        const nextTier = TIER_ORDER[idx + 1];
        console.warn(`[Loop] FPS=${_fpsAvg.toFixed(1)} → downgrading to ${nextTier}`);
        _perf = PERFORMANCE_TIERS[nextTier];
        window.dispatchEvent(new CustomEvent('bdu:tierChange', { detail: { tier: nextTier } }));
    } else if (_fpsAvg >= 50) {
        _tierLocked = true; // performing fine — lock it
    }
}
