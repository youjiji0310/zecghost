// Shared config — the ONE place the team edits by hand as claims get
// processed. Everything else (the supply counter, the marketplace
// lock, the mint-spec panel, and the actual proof-of-work difficulty)
// reads from this single source, so the displayed stats and the real
// difficulty can never drift apart the way a hardcoded duplicate could.

export const TOTAL_SUPPLY = 999;
export const MINTED_TOTAL = 0; // TODO: update as mints are processed
export const MINT_PRICE = '0.025'; // ZEC, phase 2 public price

// Phase 1 — team allocation (invite-only, gated by a secret code the
// team shares privately, not by payment). Zcash still needs a nonzero
// send to attach a memo, so TEAM_PRICE is symbolic dust, not a real price.
export const TEAM_SUPPLY = 33;
export const TEAM_PRICE = '0.0001'; // ZEC

// Difficulty climbs as supply sells — the mint gets HARDER the closer
// it gets to sold out, not easier.
const BASE_DIFFICULTY = 8;      // leading hex zeros at 0 minted (~4.3B expected attempts)
const DIFFICULTY_STEP = 300;    // +1 hex zero every N mints
const MAX_DIFFICULTY_BONUS = 2; // caps at BASE + 2 = 10 hex zeros (~1.1T expected attempts)

export const DIFFICULTY = BASE_DIFFICULTY + Math.min(
  Math.floor(MINTED_TOTAL / DIFFICULTY_STEP),
  MAX_DIFFICULTY_BONUS
);
