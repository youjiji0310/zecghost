// Vercel serverless function — the real anti-bot gate.
//
// Two mint paths call this endpoint:
//   - "mining" (default): the browser does real proof-of-work (that
//     part stays honest and independently verifiable by anyone), and
//     this endpoint recomputes the hash itself before trusting it.
//   - "easy": no proof-of-work at all — the visitor pays the flat
//     EASY_MINT_PRICE instead of mining for the (cheaper, epoch-tied)
//     mining price. Since there's no PoW to prove effort, the captcha
//     + rate-limit + one-claim-per-address checks below are the ONLY
//     anti-bot layer for this path — they still apply in full.
//
// Nothing on the page unlocks the mint/claim button until THIS
// endpoint confirms, server-side, where a bot can't fake them:
//
//   1. a Cloudflare Turnstile challenge was genuinely solved by a
//      real browser for this request
//   2. (mining path only) the submitted nonce genuinely satisfies the
//      proof-of-work rule (we recompute the hash ourselves — never
//      trust the client)
//   3. this address hasn't already claimed, and this IP hasn't
//      hammered the endpoint faster than a human plausibly would
//
// Requires two Vercel project env vars (Project Settings → Environment
// Variables — see README.md for the full setup):
//   TURNSTILE_SECRET_KEY   — from the Cloudflare Turnstile dashboard
//   KV_REST_API_URL        — added automatically when you attach a
//   KV_REST_API_TOKEN        Vercel KV (Upstash Redis) store to this project

import { createHash } from 'node:crypto';
import { DIFFICULTY } from '../src/config.js';
import { kv, getClientIp } from './_kv.js';

const IP_LIMIT_PER_HOUR = 5; // captcha-verify attempts per IP per rolling hour

function sha256Hex(str) {
  return createHash('sha256').update(str).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { address, nonce, turnstileToken, mode } = body;
    const isEasy = mode === 'easy';

    if (!address || !turnstileToken || (!isEasy && (nonce === undefined || nonce === null))) {
      res.status(400).json({ ok: false, error: 'missing fields' });
      return;
    }

    const ip = getClientIp(req);

    // 1) rate-limit this IP first — before touching Turnstile or hashing
    const ipCount = await kv(['incr', `ghst:ip:${ip}:count`]);
    if (ipCount === 1) await kv(['expire', `ghst:ip:${ip}:count`, '3600']);
    if (ipCount > IP_LIMIT_PER_HOUR) {
      res.status(429).json({ ok: false, error: 'too many attempts from this network, try again later' });
      return;
    }

    // 2) verify the Turnstile token really was solved, with Cloudflare
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: ip
      })
    });
    const tsData = await tsRes.json();
    if (!tsData.success) {
      res.status(403).json({ ok: false, error: 'captcha check failed, please retry it' });
      return;
    }

    // 3) verify the proof-of-work is real — recompute it ourselves
    //    (skipped entirely on the "easy" path — that path trades the
    //    mining discount for the captcha + rate-limit above being the
    //    only anti-bot layer, which is the deal it's offering)
    var hash = null;
    if (!isEasy) {
      const prefix = '0'.repeat(DIFFICULTY);
      hash = sha256Hex(`${address}:${nonce}`);
      if (hash.slice(0, DIFFICULTY) !== prefix) {
        res.status(400).json({ ok: false, error: 'invalid proof-of-work' });
        return;
      }
    }

    // 4) one claim per address, ever (shared between both paths — an
    // address can't mine AND easy-mint, or easy-mint twice)
    const already = await kv(['get', `ghst:claim:${address}`]);
    if (already) {
      res.status(409).json({ ok: false, error: 'this address already has a verified claim' });
      return;
    }
    await kv(['set', `ghst:claim:${address}`, String(Date.now())]);

    res.status(200).json({ ok: true, hash: hash });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || 'server error' });
  }
}
