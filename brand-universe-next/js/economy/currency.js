/**
 * currency.js — Coin balance management, transaction history, and cost estimates.
 *
 * Coins (₿) are the in-universe currency.
 * All transactions are recorded to the backend; this module is the client-side layer.
 */

/** Transaction types */
export const TX_TYPE = {
    SLOT_PURCHASE:    'slot_purchase',
    BUILDING_UPGRADE: 'building_upgrade',
    AUCTION_BID:      'auction_bid',
    AUCTION_WIN:      'auction_win',
    AUCTION_REFUND:   'auction_refund',
    SLOT_RESALE:      'slot_resale',
    SLOT_RESALE_FEE:  'slot_resale_fee',
    COIN_PURCHASE:    'coin_purchase',    // IRL money → coins
    MONTHLY_GRANT:    'monthly_grant',    // tier-based monthly coins
    BOOST_SPEND:      'boost_spend',
};

/** In-memory balance cache (authoritative value from backend) */
let _balance = 0;

/** Pending transaction (optimistic UI) */
let _pendingDebit = 0;

export function getBalance()         { return _balance; }
export function getAvailableBalance() { return Math.max(0, _balance - _pendingDebit); }

/**
 * Sync balance from backend data.
 * @param {number} coins
 */
export function setBalance(coins) { _balance = coins; _emitChange(); }

/**
 * Optimistically debit coins while awaiting backend confirmation.
 * If transaction fails, call `rollbackDebit(amount)`.
 * @param {number} amount
 */
export function optimisticDebit(amount) {
    _pendingDebit += amount;
    _emitChange();
}

export function confirmDebit(amount) {
    _pendingDebit = Math.max(0, _pendingDebit - amount);
    _balance      = Math.max(0, _balance - amount);
    _emitChange();
}

export function rollbackDebit(amount) {
    _pendingDebit = Math.max(0, _pendingDebit - amount);
    _emitChange();
}

/* ── Transaction Builder ────────────────────────────── */
/**
 * Build a transaction payload for the backend.
 * @param {string}  type       TX_TYPE value
 * @param {number}  amount     coins (positive = debit from brand)
 * @param {string}  brandId
 * @param {object}  meta       { slotIndex?, buildingId?, industry?, planetIndex? }
 * @returns {TransactionPayload}
 */
export function buildTransaction(type, amount, brandId, meta = {}) {
    return {
        id:        crypto.randomUUID(),
        type,
        amount,
        brandId,
        meta,
        status:    'pending',
        createdAt: Date.now(),
    };
}

/* ── Balance HUD ──────────────────────────────────────── */
/**
 * Inject and update the coin balance display.
 * @param {HTMLElement} container  parent element for the balance pill
 */
export function renderBalanceHUD(container) {
    let el = document.getElementById('coin-balance-hud');
    if (!el) {
        el = document.createElement('div');
        el.id = 'coin-balance-hud';
        el.style.cssText = `
            position:fixed; bottom:28px; right:20px; z-index:700;
            background:rgba(4,10,24,0.88); backdrop-filter:blur(16px);
            border:1px solid rgba(198,168,94,0.35); border-radius:8px;
            padding:10px 16px; font-family:'Orbitron',monospace;
            display:flex; align-items:center; gap:10px;
        `;
        container.appendChild(el);
    }
    _updateBalanceHUD(el);
    window.addEventListener('bdu:coinChange', () => _updateBalanceHUD(el));
}

function _updateBalanceHUD(el) {
    const avail = getAvailableBalance();
    el.innerHTML = `
        <div style="width:8px;height:8px;border-radius:50%;background:#FFD700;box-shadow:0 0 8px #FFD700"></div>
        <div>
            <div style="font-size:7px;letter-spacing:2px;color:rgba(198,168,94,0.6)">BALANCE</div>
            <div style="font-size:14px;font-weight:700;color:#FFD700">${formatCoins(avail)}</div>
        </div>
    `;
}

function _emitChange() {
    window.dispatchEvent(new CustomEvent('bdu:coinChange', { detail: { balance: _balance, available: getAvailableBalance() } }));
}

function formatCoins(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M ₿';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K ₿';
    return n + ' ₿';
}
