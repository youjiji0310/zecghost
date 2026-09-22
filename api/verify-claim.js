// Vercel serverless function — the real anti-bot gate.
//
// The browser still does the actual proof-of-work mining (that part
// stays honest and independently verifiable by anyone). But nothing
// on the page unlocks the mint/claim button until THIS endpoint
// confirms three things, server-side, where a bot can't fake them:
//
//   1. a Cloudflare Turnstile challenge was genuinely solved by a
//      real browser for this request
//   2. the submitted nonce genuinely satisfies the proof-of-work rule
//      (we recompute the hash ourselves — never trust the client)
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

const IP_LIMIT_PER_HOUR = 5; // captcha-verify attempts per IP per rolling hour

function sha256Hex(str) {
  return createHash('sha256').update(str).digest('hex');
}

async function kv(cmd) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured (missing Vercel KV env vars)');
  const path = cmd.map(encodeURIComponent).join('/');
  const res = await fetch(`${url}/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('KV request failed: ' + res.status);
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { address, nonce, turnstileToken } = body;

    if (!address || nonce === undefined || nonce === null || !turnstileToken) {
      res.status(400).json({ ok: false, error: 'missing fields' });
      return;
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress
      || 'unknown';

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
    const prefix = '0'.repeat(DIFFICULTY);
    const hash = sha256Hex(`${address}:${nonce}`);
    if (hash.slice(0, DIFFICULTY) !== prefix) {
      res.status(400).json({ ok: false, error: 'invalid proof-of-work' });
      return;
    }

    // 4) one claim per address, ever
    const already = await kv(['get', `ghst:claim:${address}`]);
    if (already) {
      res.status(409).json({ ok: false, error: 'this address already has a verified claim' });
      return;
    }
    await kv(['set', `ghst:claim:${address}`, String(Date.now())]);

    res.status(200).json({ ok: true, hash });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || 'server error' });
  }
}
