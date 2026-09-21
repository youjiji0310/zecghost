// Proof-of-Work mint gate.
// Before a mint (or manual claim) is accepted, the browser must find a
// nonce such that sha256(address + ':' + nonce) starts with DIFFICULTY
// leading hex zero characters. This is real CPU work — spread across
// every core the browser will give us via a pool of Web Workers — and
// the resulting nonce is embedded in the mint memo so anyone can
// re-hash and verify it independently. No blockchain contract needed;
// it's an off-chain fairness gate the same way the rest of this
// inscription-style mint already works.

export const DIFFICULTY = 7; // leading hex zero chars required (~268M expected attempts) — deliberately steep, only strong multi-core machines mint quickly

export function startPow(address, { onProgress, onFound, onError } = {}) {
  const workerCount = Math.min(navigator.hardwareConcurrency || 4, 8);
  const workers = [];
  const perWorkerHashes = new Array(workerCount).fill(0);
  const startTime = performance.now();
  let stopped = false;

  function totals() {
    const hashes = perWorkerHashes.reduce((a, b) => a + b, 0);
    const elapsed = (performance.now() - startTime) / 1000;
    return { hashes, elapsed, hashRate: elapsed > 0 ? hashes / elapsed : 0 };
  }

  function stopAll() {
    if (stopped) return;
    stopped = true;
    workers.forEach((w) => {
      try { w.postMessage({ type: 'stop' }); } catch (e) {}
      w.terminate();
    });
  }

  for (let i = 0; i < workerCount; i++) {
    const w = new Worker(new URL('./pow-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        perWorkerHashes[i] = msg.hashes;
        if (onProgress) onProgress({ ...totals(), workers: workerCount });
      } else if (msg.type === 'found') {
        if (stopped) return;
        perWorkerHashes[i] = msg.hashes;
        const t = totals();
        stopAll();
        if (onFound) onFound({ nonce: msg.nonce, hash: msg.hash, ...t, workers: workerCount });
      }
    };
    w.onerror = (err) => {
      if (stopped) return;
      stopAll();
      if (onError) onError('Mining worker failed to start (network or browser issue). Try again.');
      if (err && err.preventDefault) err.preventDefault();
    };
    w.postMessage({ type: 'start', address, difficulty: DIFFICULTY, startNonce: i, stride: workerCount });
    workers.push(w);
  }

  return { cancel: stopAll, workerCount };
}
