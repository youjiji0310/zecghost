import { getNoirWallet } from '@noir-wallet/sdk';
import { startPow, DIFFICULTY } from './pow.js';
import { TOTAL_SUPPLY, MINTED_TOTAL, MINT_PRICE, TEAM_PRICE } from './config.js';

function $(id){ return document.getElementById(id); }

/* keep every displayed number in sync with the same config the
   difficulty above was computed from — no separate hardcoded copies
   to drift out of sync (this is the same class of bug as the old
   fake mint stats, just for price/difficulty instead). */
function syncConfigDisplay(){
  var nEls = document.querySelectorAll('.supply-row .n');
  if(nEls[0]) nEls[0].textContent = MINTED_TOTAL;
  if(nEls[1]) nEls[1].textContent = TOTAL_SUPPLY - MINTED_TOTAL;

  var phase2Price = $('phase2Price');
  if(phase2Price) phase2Price.textContent = MINT_PRICE + ' ZEC';

  var mintAmount = $('mintAmount');
  if(mintAmount) mintAmount.textContent = MINT_PRICE + ' ZEC';
  var mintAmountCopy = $('mintAmountCopy');
  if(mintAmountCopy) mintAmountCopy.dataset.copy = MINT_PRICE;

  var teamAmount = $('teamAmount');
  if(teamAmount) teamAmount.textContent = TEAM_PRICE + ' ZEC';
  var teamAmountCopy = $('teamAmountCopy');
  if(teamAmountCopy) teamAmountCopy.dataset.copy = TEAM_PRICE;

  var marketTag = $('marketTag');
  if(marketTag){
    if(MINTED_TOTAL >= TOTAL_SUPPLY){
      marketTag.textContent = 'SOLD OUT · marketplace opening soon';
      marketTag.classList.add('solved');
    } else {
      marketTag.textContent = 'LOCKED · ' + MINTED_TOTAL + '/' + TOTAL_SUPPLY + ' minted · opens at sold out';
    }
  }

  var specDifficulty = $('specDifficulty');
  if(specDifficulty) specDifficulty.textContent = DIFFICULTY;
  var specZeros = $('specZeros');
  if(specZeros) specZeros.textContent = '0'.repeat(DIFFICULTY);
  var specMintedNow = $('specMintedNow');
  if(specMintedNow) specMintedNow.textContent = MINTED_TOTAL;
}
syncConfigDisplay();

// The real ZRC-20-style mint inscription — matches the spec panel on the
// page exactly, so any indexer built against that spec recognizes it.
function buildMemo(address, handle, nonce){
  var memoObj = { p: 'zrc-20', op: 'mint', tick: 'ghst', amt: '1', to: address, pow: String(nonce) };
  if(handle) memoObj.x = handle;
  return JSON.stringify(memoObj);
}

/* ---------- copy-to-clipboard buttons ---------- */

function flashCopied(btn){
  var old = btn.textContent;
  btn.textContent = 'Copied';
  btn.classList.add('copied');
  setTimeout(function(){ btn.textContent = old; btn.classList.remove('copied'); }, 1400);
}

document.querySelectorAll('.copy-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var text = btn.dataset.copy;
    if (!text && btn.dataset.copyTarget) text = $(btn.dataset.copyTarget).textContent.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(function(){ flashCopied(btn); }).catch(function(){});
  });
});

/* ---------- anti-bot: Cloudflare Turnstile + server verification ----------
   Solving the proof-of-work in the browser is real work, but a bot can
   do that work too — sha256 is exactly the kind of thing bots are
   good at. So a valid nonce alone no longer unlocks anything: the
   page also has to pass a Turnstile challenge, and BOTH the captcha
   token and the nonce get checked by /api/verify-claim (a Vercel
   serverless function) before the mint/claim button unlocks. That
   endpoint re-hashes the nonce itself (never trusts the client), and
   rate-limits by IP + caps one verified claim per address — see
   api/verify-claim.js for the full explanation. */

var TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

function mountTurnstile(containerId, onToken){
  var widgetId = null;
  (function poll(){
    var el = document.getElementById(containerId);
    if(window.turnstile && el){
      if(!TURNSTILE_SITE_KEY){
        el.innerHTML = '<p class="priv-note" style="color:var(--red);margin:0;">Captcha not configured yet (missing VITE_TURNSTILE_SITE_KEY) — mint stays locked until it is.</p>';
        return;
      }
      widgetId = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: onToken,
        'expired-callback': function(){ onToken(null); },
        'error-callback': function(){ onToken(null); }
      });
    } else {
      setTimeout(poll, 150);
    }
  })();
  return {
    reset: function(){ if(window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); }
  };
}

async function verifyClaim(address, nonce, turnstileToken){
  var res = await fetch('/api/verify-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: address, nonce: nonce, turnstileToken: turnstileToken })
  });
  var data;
  try{ data = await res.json(); }catch(e){ data = { ok:false, error:'bad server response' }; }
  if(!res.ok || !data.ok){
    throw new Error(data.error || ('server rejected the claim (' + res.status + ')'));
  }
  return data;
}

/* ---------- shared proof-of-work gate ----------
   Wires a "start mining" button + progress bar to startPow(), and
   calls onSolved(result) once a valid nonce is found AND the server
   has verified it (captcha + re-hashed nonce + rate limit). Re-running
   with a different address invalidates any previous result
   automatically (each gate instance tracks its own solved state). */

function wirePowGate(opts){
  var startBtn = $(opts.startBtnId);
  var progressBox = $(opts.progressId);
  var barFill = $(opts.barFillId);
  var statsEl = $(opts.statsId);
  var doneEl = $(opts.doneId);
  var tagEl = $(opts.tagId);
  var unlockBtn = $(opts.unlockBtnId);
  var unlockLabel = opts.unlockLabel;
  var startLabel = startBtn.textContent;
  var memoRow = opts.memoRowId ? $(opts.memoRowId) : null;
  var memoEl = opts.memoTextId ? $(opts.memoTextId) : null;
  var memoHint = opts.memoHintId ? $(opts.memoHintId) : null;

  var expectedAttempts = Math.pow(16, DIFFICULTY);
  var solved = null; // { nonce, hash, address }
  var job = null;
  var turnstileToken = null;
  var verifying = false;
  var turnstileHandle = opts.turnstileContainerId
    ? mountTurnstile(opts.turnstileContainerId, function(token){
        turnstileToken = token;
        if(token) attemptVerify();
      })
    : null;

  function reset(){
    solved = null;
    turnstileToken = null;
    verifying = false;
    if(turnstileHandle) turnstileHandle.reset();
    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Solve proof-of-work first';
    doneEl.hidden = true;
    doneEl.classList.remove('pow-error');
    tagEl.classList.remove('solved');
    tagEl.textContent = 'Proof-of-work required';
    if(memoRow){ memoRow.hidden = true; }
    if(memoHint){ memoHint.hidden = false; }
  }

  function attemptVerify(){
    if(!solved || !turnstileToken || verifying) return;
    verifying = true;
    doneEl.hidden = false;
    doneEl.classList.remove('pow-error');
    doneEl.innerHTML = '⏳ Verifying with server (captcha + proof-of-work)…';
    verifyClaim(solved.address, solved.nonce, turnstileToken).then(function(){
      verifying = false;
      doneEl.classList.remove('pow-error');
      doneEl.innerHTML = '✓ Verified — nonce <strong>' + solved.nonce + '</strong> confirmed server-side';
      tagEl.classList.add('solved');
      tagEl.textContent = 'Solved & verified';
      unlockBtn.disabled = false;
      unlockBtn.textContent = unlockLabel;
      if(memoEl && opts.getHandle){
        memoEl.textContent = buildMemo(solved.address, opts.getHandle(), solved.nonce);
        memoRow.hidden = false;
        if(memoHint) memoHint.hidden = true;
      }
    }).catch(function(err){
      verifying = false;
      doneEl.classList.add('pow-error');
      doneEl.textContent = '✕ ' + err.message;
      if(turnstileHandle) turnstileHandle.reset();
      turnstileToken = null;
    });
  }

  startBtn.addEventListener('click', function(){
    var address = opts.getAddress();
    if(!address){
      if(opts.onMissingAddress) opts.onMissingAddress();
      return;
    }
    if(job) job.cancel();
    reset();
    startBtn.disabled = true;
    startBtn.textContent = 'Mining…';
    progressBox.hidden = false;
    barFill.style.width = '0%';
    statsEl.textContent = 'Starting workers…';

    job = startPow(address, {
      onProgress: function(p){
        var pct = Math.min(99, (p.hashes / expectedAttempts) * 100);
        barFill.style.width = pct.toFixed(1) + '%';
        statsEl.textContent =
          p.hashes.toLocaleString() + ' hashes · ' +
          Math.round(p.hashRate).toLocaleString() + ' H/s · ' +
          p.workers + ' worker' + (p.workers === 1 ? '' : 's') + ' · ' +
          p.elapsed.toFixed(1) + 's';
      },
      onFound: function(r){
        solved = { nonce: r.nonce, hash: r.hash, address: address };
        barFill.style.width = '100%';
        startBtn.disabled = false;
        startBtn.textContent = 'Re-mine (start over)';
        progressBox.hidden = true;
        doneEl.hidden = false;
        doneEl.classList.remove('pow-error');
        doneEl.innerHTML = '✓ Proof found — nonce <strong>' + r.nonce + '</strong>, ' +
          r.hashes.toLocaleString() + ' hashes in ' + r.elapsed.toFixed(1) + 's. ' +
          (turnstileToken ? '' : 'Now solve the captcha below to unlock.');
        tagEl.textContent = 'Proof found — verifying…';
        attemptVerify();
      },
      onError: function(msg){
        startBtn.disabled = false;
        startBtn.textContent = startLabel;
        progressBox.hidden = true;
        doneEl.hidden = false;
        doneEl.classList.add('pow-error');
        doneEl.textContent = '✕ ' + msg;
      }
    });
  });

  return {
    getSolved: function(){ return solved; },
    invalidate: reset,
    refreshMemo: function(){
      if(solved && memoEl && opts.getHandle){
        memoEl.textContent = buildMemo(solved.address, opts.getHandle(), solved.nonce);
      }
    }
  };
}

/* ---------- manual claim form (fallback path) ---------- */

var manualGate = wirePowGate({
  startBtnId: 'powStartBtnM',
  progressId: 'powProgressM',
  barFillId: 'powBarFillM',
  statsId: 'powStatsM',
  doneId: 'powDoneM',
  tagId: 'powTagM',
  unlockBtnId: 'claimBtn',
  unlockLabel: 'Prepare claim record',
  turnstileContainerId: 'turnstileM',
  memoRowId: 'memoRow',
  memoTextId: 'mintMemo',
  memoHintId: 'memoHint',
  getAddress: function(){ return $('fAddr').value.trim(); },
  getHandle: function(){ return $('fHandle').value.trim(); },
  onMissingAddress: function(){ $('fAddr').style.borderColor = 'var(--red)'; }
});

// re-solving is required if the receive address changes after a proof was found
$('fAddr').addEventListener('input', function(){
  $('fAddr').style.borderColor = '';
  manualGate.invalidate();
});

// handle doesn't affect the proof-of-work itself, just the memo text — refresh it live
$('fHandle').addEventListener('input', function(){
  manualGate.refreshMemo();
});

$('claimBtn').addEventListener('click', function(){
  var txid = $('fTxid').value.trim();
  var addr = $('fAddr').value.trim();
  var handle = $('fHandle').value.trim();
  var solved = manualGate.getSolved();
  if(!txid || !addr || !solved || solved.address !== addr){
    $('fTxid').style.borderColor = txid ? '' : 'var(--red)';
    $('fAddr').style.borderColor = addr ? '' : 'var(--red)';
    return;
  }
  var block =
    'GHST CLAIM\n' +
    'txid: ' + txid + '\n' +
    'receive_address: ' + addr + '\n' +
    'handle: ' + (handle || '(none)') + '\n' +
    'inscription (memo): ' + buildMemo(addr, handle, solved.nonce) + '\n' +
    'pow_hash: ' + solved.hash + '\n' +
    'amount: ' + MINT_PRICE + ' ZEC\n' +
    'note: if the memo above was already attached to your payment on-chain, this record is just a backup for the team.';
  var r = $('receipt');
  r.textContent = block;
  r.classList.add('show');
  $('receiptNote').hidden = false;
});

/* ---------- team mint (Phase 1, invite-only) ----------
   No proof-of-work here — the gate is a secret code the team shares
   privately, checked server-side (never shipped in this bundle), plus
   a one-claim-per-address cap and a hard 33 limit, both enforced by
   /api/verify-team-claim. Manual-pay only (no Noir Wallet auto-send
   for this rarely-used path) — team members copy the memo + tiny dust
   amount and submit the txid, same honor-system pattern as the rest
   of the page. */

var PAY_ADDRESS_TEAM = $('payAddr').textContent.trim();

async function verifyTeamClaim(address, teamCode){
  var res = await fetch('/api/verify-team-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: address, teamCode: teamCode })
  });
  var data;
  try{ data = await res.json(); }catch(e){ data = { ok:false, error:'bad server response' }; }
  if(!res.ok || !data.ok){
    throw new Error(data.error || ('server rejected the claim (' + res.status + ')'));
  }
  return data;
}

var teamLocked = $('teamLocked');
var teamUnlocked = $('teamUnlocked');
var teamUnlockBtn = $('teamUnlockBtn');
var teamCodeValue = null; // held only in memory; the real check happens server-side on every verify call

teamUnlockBtn.addEventListener('click', function(){
  var code = $('fTeamCode').value.trim();
  if(!code){
    $('fTeamCode').style.borderColor = 'var(--red)';
    return;
  }
  $('fTeamCode').style.borderColor = '';
  teamCodeValue = code;
  teamLocked.hidden = true;
  teamUnlocked.hidden = false;
});

var teamPaySection = $('teamPaySection');
var teamVerifyBtn = $('teamVerifyBtn');
var teamVerifyMsg = $('teamVerifyMsg');
var teamClaim = null; // { address }

teamVerifyBtn.addEventListener('click', async function(){
  var address = $('fTeamAddr').value.trim();
  if(!address){
    $('fTeamAddr').style.borderColor = 'var(--red)';
    return;
  }
  $('fTeamAddr').style.borderColor = '';
  teamVerifyBtn.disabled = true;
  teamVerifyBtn.textContent = 'Verifying…';
  teamVerifyMsg.hidden = false;
  teamVerifyMsg.classList.remove('pow-error');
  teamVerifyMsg.textContent = '⏳ Checking team code with server…';
  try{
    await verifyTeamClaim(address, teamCodeValue);
    var handle = $('fTeamHandle').value.trim();
    teamClaim = { address: address };
    var memoObj = { p: 'zrc-20', op: 'mint', tick: 'ghst', amt: '1', to: address, team: '1' };
    if(handle) memoObj.x = handle;
    $('teamMemo').textContent = JSON.stringify(memoObj);
    $('teamPayAddr').textContent = PAY_ADDRESS_TEAM;
    teamVerifyMsg.textContent = '✓ Team code accepted — allocation reserved for this address.';
    teamPaySection.hidden = false;
    teamVerifyBtn.textContent = 'Verified';
  }catch(e){
    teamVerifyMsg.classList.add('pow-error');
    teamVerifyMsg.textContent = '✕ ' + e.message;
    teamVerifyBtn.disabled = false;
    teamVerifyBtn.textContent = 'Verify & generate claim';
  }
});

$('teamClaimBtn').addEventListener('click', function(){
  var txid = $('fTeamTxid').value.trim();
  var addr = $('fTeamAddr').value.trim();
  var handle = $('fTeamHandle').value.trim();
  if(!txid || !teamClaim || teamClaim.address !== addr){
    $('fTeamTxid').style.borderColor = txid ? '' : 'var(--red)';
    return;
  }
  var block =
    'GHST TEAM CLAIM\n' +
    'txid: ' + txid + '\n' +
    'receive_address: ' + addr + '\n' +
    'handle: ' + (handle || '(none)') + '\n' +
    'inscription (memo): ' + $('teamMemo').textContent + '\n' +
    'amount: ' + TEAM_PRICE + ' ZEC (symbolic — team allocation is free, not sold)\n' +
    'note: server already confirmed the team code, one-claim-per-address, and the 33 cap before this memo was generated.';
  var r = $('teamReceipt');
  r.textContent = block;
  r.classList.add('show');
});

/* ---------- Noir Wallet connect + mint flow ---------- */

var PAY_ADDRESS = $('payAddr').textContent.trim();
var AMOUNT = MINT_PRICE;

var elIdle = $('walletIdle');
var elConnected = $('walletConnected');
var elSuccess = $('walletSuccess');
var noWalletNote = $('noWalletNote');
var connectBtn = $('connectBtn');
var connAddr = $('connAddr');
var mintBtn = $('mintBtn');
var walletStatus = $('walletStatus');
var successReceipt = $('successReceipt');
var fHandleW = $('fHandleW');

var wallet = null;

var walletGate = wirePowGate({
  startBtnId: 'powStartBtnW',
  progressId: 'powProgressW',
  barFillId: 'powBarFillW',
  statsId: 'powStatsW',
  doneId: 'powDoneW',
  tagId: 'powTagW',
  unlockBtnId: 'mintBtn',
  unlockLabel: 'Mint — send ' + AMOUNT + ' ZEC',
  turnstileContainerId: 'turnstileW',
  getAddress: function(){ return connAddr.textContent.trim(); }
});

function pickAddress(res){
  if(!res) return null;
  return res.shielded || res.transparent || (res.accounts && res.accounts[0]) || null;
}

function showConnected(address){
  connAddr.textContent = address;
  elIdle.hidden = true;
  elConnected.hidden = false;
  elSuccess.hidden = true;
  walletGate.invalidate();
}

function setStatus(msg, isError){
  walletStatus.textContent = msg || '';
  walletStatus.style.color = isError ? 'var(--red)' : 'var(--ink-dim)';
}

async function init(){
  try{
    wallet = (typeof getNoirWallet === 'function') ? getNoirWallet() : null;
  }catch(e){
    wallet = null;
  }

  if(!wallet){
    noWalletNote.hidden = false;
    connectBtn.disabled = true;
    connectBtn.textContent = 'Wallet not found';
    return;
  }

  // Silent check — does NOT prompt the user, just restores an existing connection.
  try{
    var accounts = await wallet.zcash.getAccounts();
    var addr = pickAddress(accounts);
    if(addr) showConnected(addr);
  }catch(e){ /* no existing connection — stay on the idle/connect state */ }
}

connectBtn.addEventListener('click', async function(){
  if(!wallet) return;
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  setStatus('');
  try{
    var res = await wallet.zcash.connect();
    var addr = pickAddress(res);
    if(!addr) throw new Error('No address returned by wallet');
    showConnected(addr);
  }catch(e){
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Noir Wallet';
    setStatus('Connection was cancelled or failed. Try again, or pay manually below.', true);
  }
});

mintBtn.addEventListener('click', async function(){
  if(!wallet) return;
  var fromAddr = connAddr.textContent.trim();
  var solved = walletGate.getSolved();
  if(!solved || solved.address !== fromAddr){
    setStatus('Solve the proof-of-work challenge above first.', true);
    return;
  }
  mintBtn.disabled = true;
  mintBtn.textContent = 'Confirm in wallet…';
  setStatus('');
  var handle = fHandleW.value.trim();
  var memo = buildMemo(fromAddr, handle, solved.nonce);
  try{
    var txid = await wallet.zcash.sendTransaction({
      to: PAY_ADDRESS,
      amount: AMOUNT,
      memo: memo,
      fundingSource: 'shielded'
    });
    successReceipt.textContent =
      'GHST MINT — PAYMENT SENT\n' +
      'txid: ' + txid + '\n' +
      'from: ' + fromAddr + '\n' +
      'inscription (memo): ' + memo + '\n' +
      'pow_hash: ' + solved.hash + '\n' +
      'amount: ' + AMOUNT + ' ZEC';
    elConnected.hidden = true;
    elSuccess.hidden = false;
  }catch(e){
    mintBtn.disabled = false;
    mintBtn.textContent = 'Mint — send ' + AMOUNT + ' ZEC';
    var msg = (e && e.message) ? e.message : 'Transaction was cancelled or failed.';
    setStatus(msg, true);
  }
});

init();
