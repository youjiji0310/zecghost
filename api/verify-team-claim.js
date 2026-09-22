// Vercel serverless function — server-side gate for the Phase 1 team
// allocation (33 mints, invite-only). The real team code never ships
// to the browser: whatever a visitor types just gets POSTed here, and
// this endpoint is the only place that knows the real value (an env
// var) and checks it with a timing-safe comparison — so a wrong guess
// can't be used to brute-force the code by timing the response.
//
// Requires one extra Vercel env var beyond the public mint's:
//   TEAM_MINT_CODE — pick any string, share it privately with your
//   33 team members, never commit it to the repo

import { timingSafeEqual, createHash } from 'node:crypto';
import { TEAM_SUPPLY } from '../src/config.js';
import { kv, getClientIp } from './_kv.js';

const IP_LIMIT_PER_HOUR = 10; // team-code attempts per IP per rolling hour

function safeEqual(a, b) {
  var ah = createHash('sha256').update(String(a)).digest();
  var bh = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ah, bh);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { address, teamCode } = body;

    if (!address || !teamCode) {
      res.status(400).json({ ok: false, error: 'missing fields' });
      return;
    }

    const ip = getClientIp(req);

    // 1) rate-limit this IP first — a wrong code shouldn't be free to retry forever
    const ipCount = await kv(['incr', `ghst:teamip:${ip}:count`]);
    if (ipCount === 1) await kv(['expire', `ghst:teamip:${ip}:count`, '3600']);
    if (ipCount > IP_LIMIT_PER_HOUR) {
      res.status(429).json({ ok: false, error: 'too many attempts from this network, try again later' });
      return;
    }

    // 2) check the team code — never trust the client, never leak it in the bundle
    const expected = process.env.TEAM_MINT_CODE;
    if (!expected || !safeEqual(teamCode, expected)) {
      res.status(403).json({ ok: false, error: 'invalid team code' });
      return;
    }

    // 3) one claim per address, ever
    const already = await kv(['get', `ghst:teamclaim:${address}`]);
    if (already) {
      res.status(409).json({ ok: false, error: 'this address already has a verified team claim' });
      return;
    }

    // 4) hard-cap the team allocation at TEAM_SUPPLY total
    const countRaw = await kv(['get', 'ghst:teamcount']);
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    if (count >= TEAM_SUPPLY) {
      res.status(409).json({ ok: false, error: 'team allocation (' + TEAM_SUPPLY + ') is fully claimed' });
      return;
    }

    await kv(['set', `ghst:teamclaim:${address}`, String(Date.now())]);
    await kv(['incr', 'ghst:teamcount']);

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || 'server error' });
  }
}
