import { sha256 } from 'js-sha256';

let running = false;

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.type === 'start') {
    running = true;
    const address = msg.address;
    const difficulty = msg.difficulty;
    const prefix = '0'.repeat(difficulty);
    let nonce = msg.startNonce;
    const stride = msg.stride;
    let hashes = 0;
    const BATCH = 4000;

    const tick = () => {
      if (!running) return;
      for (let i = 0; i < BATCH; i++) {
        const hash = sha256(address + ':' + nonce);
        hashes++;
        if (hash.slice(0, difficulty) === prefix) {
          self.postMessage({ type: 'found', nonce, hash, hashes });
          running = false;
          return;
        }
        nonce += stride;
      }
      self.postMessage({ type: 'progress', hashes });
      // yield back to the event loop so a 'stop' message can interrupt us
      setTimeout(tick, 0);
    };

    tick();
  } else if (msg.type === 'stop') {
    running = false;
  }
};
