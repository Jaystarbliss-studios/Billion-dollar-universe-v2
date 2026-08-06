/**
 * auctions.js — Auction engine for mountain and central premium slots.
 *
 * Auction lifecycle:
 *   PENDING  → not yet started (scheduled)
 *   ACTIVE   → accepting bids (countdown timer)
 *   CLOSED   → winner determined, awaiting transaction
 *   SETTLED  → ownership transferred
 *   CANCELLED → no bids or cancelled by admin
 *
 * All auction state is authoritative on the backend (Firestore).
 * This module provides client-side logic and UI helpers.
 */

export const AUCTION_STATES = {
    PENDING:   'pending',
    ACTIVE:    'active',
    CLOSED:    'closed',
    SETTLED:   'settled',
    CANCELLED: 'cancelled',
};

/**
 * Validate a bid before sending to backend.
 * @param {object} bid
 * @param {object} auction  current auction state from backend
 * @param {number} brandCoins   bidder's current coin balance
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateBid(bid, auction, brandCoins) {
    if (auction.state !== AUCTION_STATES.ACTIVE) {
        return { valid: false, error: 'Auction is not active.' };
    }
    if (Date.now() > auction.endsAt) {
        return { valid: false, error: 'Auction has ended.' };
    }
    const minBid = (auction.currentBid ?? auction.startPrice) + auction.minIncrement;
    if (bid.amount < minBid) {
        return { valid: false, error: `Minimum bid is ${minBid} ₿` };
    }
    if (bid.amount > brandCoins) {
        return { valid: false, error: 'Insufficient coins.' };
    }
    return { valid: true };
}

/**
 * Create a new auction object (sent to backend).
 * @param {object} opts
 * @param {number} opts.slotIndex
 * @param {string} opts.industry
 * @param {number} opts.planetIndex
 * @param {number} opts.startPrice
 * @param {number} opts.minIncrement
 * @param {number} opts.durationMs     e.g. 24 * 3600 * 1000 = 24 hours
 * @param {string} opts.createdBy      admin uid
 */
export function buildAuctionPayload(opts) {
    const now = Date.now();
    return {
        slotIndex:    opts.slotIndex,
        industry:     opts.industry,
        planetIndex:  opts.planetIndex,
        startPrice:   opts.startPrice,
        minIncrement: opts.minIncrement,
        currentBid:   null,
        currentBidder: null,
        bids:         [],
        state:        AUCTION_STATES.PENDING,
        createdAt:    now,
        startsAt:     opts.startsAt ?? now + 3600_000,  // default: starts in 1h
        endsAt:       (opts.startsAt ?? now + 3600_000) + opts.durationMs,
        createdBy:    opts.createdBy,
    };
}

/**
 * Format remaining time as MM:SS or HH:MM:SS.
 * @param {number} endsAt   unix ms
 */
export function formatCountdown(endsAt) {
    const remaining = Math.max(0, endsAt - Date.now());
    const s = Math.floor(remaining / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

/**
 * Render the auction UI panel into a container element.
 * @param {HTMLElement} container
 * @param {object}      auction    current auction state
 * @param {Function}    onBid      called with (amount) when user places bid
 */
export function renderAuctionPanel(container, auction, onBid) {
    const minBid = (auction.currentBid ?? auction.startPrice) + (auction.minIncrement ?? 100);
    container.innerHTML = `
        <div style="
            font-family:'Orbitron',monospace; color:#fff;
            background:rgba(4,10,24,0.95); border:1px solid rgba(198,168,94,0.4);
            border-radius:8px; padding:18px 22px;
        ">
            <div style="font-size:8px;letter-spacing:2.5px;color:rgba(198,168,94,0.6);margin-bottom:8px">
                // LIVE AUCTION
            </div>
            <div style="font-size:13px;font-weight:700;margin-bottom:14px">Slot #${auction.slotIndex}</div>

            <div style="display:flex;gap:24px;margin-bottom:14px">
                <div>
                    <div style="font-size:7px;color:rgba(255,255,255,0.3);margin-bottom:3px">CURRENT BID</div>
                    <div style="font-size:18px;color:#FFD700;font-weight:700">
                        ${auction.currentBid ? auction.currentBid.toLocaleString() + ' ₿' : 'No bids'}
                    </div>
                </div>
                <div>
                    <div style="font-size:7px;color:rgba(255,255,255,0.3);margin-bottom:3px">ENDS IN</div>
                    <div style="font-size:18px;color:#FF4060;font-weight:700" id="auction-countdown">
                        ${formatCountdown(auction.endsAt)}
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:10px;align-items:center">
                <input id="bid-input" type="number" min="${minBid}" placeholder="${minBid}"
                    style="
                        flex:1;padding:9px 14px;background:rgba(255,255,255,0.08);
                        border:1px solid rgba(198,168,94,0.3);border-radius:6px;
                        color:#fff;font-family:'Orbitron',monospace;font-size:13px;outline:none;
                    ">
                <button id="bid-btn" style="
                    padding:9px 18px;background:linear-gradient(135deg,#C6A85E,#a88840);
                    border:none;border-radius:6px;color:#000;font-family:'Orbitron',monospace;
                    font-size:10px;font-weight:700;letter-spacing:1.5px;cursor:pointer;
                ">BID NOW</button>
            </div>
            <div style="font-size:9px;color:rgba(255,255,255,0.25);margin-top:8px">
                Min increment: ${auction.minIncrement} ₿ · Min bid: ${minBid.toLocaleString()} ₿
            </div>
        </div>
    `;

    document.getElementById('bid-btn')?.addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('bid-input')?.value);
        if (!isNaN(amount)) onBid(amount);
    });

    // Live countdown tick
    const interval = setInterval(() => {
        const el = document.getElementById('auction-countdown');
        if (el) el.textContent = formatCountdown(auction.endsAt);
        if (Date.now() > auction.endsAt) clearInterval(interval);
    }, 1000);
}
