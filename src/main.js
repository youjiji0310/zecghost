import { getNoirWallet } from '@noir-wallet/sdk';
import { startPow, DIFFICULTY } from './pow.js';

function $(id){ return document.getElementById(id); }

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

/* ---------- shared proof-of-work gate ----------
   Wires a "start mining" button + progress bar to startPow(), and
   calls onSolved(result) once a valid nonce is found. Re-running with
   a different address invalidates any previous result automatically
   (each gate instance tracks its own solved state). */

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

  function reset(){
    solved = null;
    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Solve proof-of-work first';
    doneEl.hidden = true;
    tagEl.classList.remove('solved');
    tagEl.textContent = 'Proof-of-work required';
    if(memoRow){ memoRow.hidden = true; }
    if(memoHint){ memoHint.hidden = false; }
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
          r.hashes.toLocaleString() + ' hashes in ' + r.elapsed.toFixed(1) + 's';
        tagEl.classList.add('solved');
        tagEl.textContent = 'Solved';
        unlockBtn.disabled = false;
        unlockBtn.textContent = unlockLabel;
        if(memoEl && opts.getHandle){
          memoEl.textContent = buildMemo(address, opts.getHandle(), r.nonce);
          memoRow.hidden = false;
          if(memoHint) memoHint.hidden = true;
        }
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
    'amount: 0.001 ZEC\n' +
    'note: if the memo above was already attached to your payment on-chain, this record is just a backup for the team.';
  var r = $('receipt');
  r.textContent = block;
  r.classList.add('show');
  $('receiptNote').hidden = false;
});

/* ---------- Noir Wallet connect + mint flow ---------- */

var PAY_ADDRESS = $('payAddr').textContent.trim();
var AMOUNT = '0.001';

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
  unlockLabel: 'Mint — send 0.001 ZEC',
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
    mintBtn.textContent = 'Mint — send 0.001 ZEC';
    var msg = (e && e.message) ? e.message : 'Transaction was cancelled or failed.';
    setStatus(msg, true);
  }
});

init();
