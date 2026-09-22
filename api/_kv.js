// Shared Vercel KV (Upstash Redis REST API) helper used by every
// function under api/ — one place so the public mint gate and the
// team mint gate can't drift apart on how they talk to storage.

export async function kv(cmd) {
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

export function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}
