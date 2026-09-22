// Shared config — the ONE place the team edits by hand as claims get
// processed. Everything else (the supply counter, the marketplace
// lock, the mint-spec panel, the mining price, the easy-mint price,
// and the actual proof-of-work difficulty) reads from this single
// source, so the displayed stats and the real mechanics can never
// drift apart the way a hardcoded duplicate could.

export const TOTAL_SUPPLY = 999;
export const MINTED_TOTAL = 0; // TODO: update as mints are processed

// Phase 1 — team allocation (invite-only, gated by a secret code the
// team shares privately, not by payment). Zcash still needs a nonzero
// send to attach a memo, so TEAM_PRICE is symbolic dust, not a real price.
export const TEAM_SUPPLY = 33;
export const TEAM_PRICE = '0.0001'; // ZEC

// Both the proof-of-work difficulty AND the mining-path price climb
// together in the same 3 bands as supply sells (epoch 0 / 1 / 2 =
// 0-299 / 300-599 / 600+ minted) — the mint gets harder AND pricier
// the closer it gets to sold out, not easier.
const EPOCH_STEP = 300;
const MAX_EPOCH = 2;
export const EPOCH = Math.min(Math.floor(MINTED_TOTAL / EPOCH_STEP), MAX_EPOCH);

const BASE_DIFFICULTY = 8; // leading hex zeros at epoch 0 (~4.3B expected attempts)
export const DIFFICULTY = BASE_DIFFICULTY + EPOCH; // caps at 10 (~1.1T expected attempts)

// Mining path: solve the proof-of-work above, pay the tier price for
// the current epoch — cheapest early, pricier as supply sells, same
// idea as the difficulty ladder, just expressed in ZEC instead of hex
// zeros. Index matches EPOCH (0, 1, 2).
const MINING_PRICE_TIERS = ['0.005', '0.01', '0.02']; // ZEC
export const MINT_PRICE = MINING_PRICE_TIERS[EPOCH]; // current mining price

// Easy path: skip the proof-of-work entirely — still gated server-side
// by captcha + rate-limit + one-claim-per-address, just no mining
// required. Flat price regardless of epoch, so mining stops being a
// discount once its tier price catches up to this at the top epoch.
export const EASY_MINT_PRICE = '0.02'; // ZEC
