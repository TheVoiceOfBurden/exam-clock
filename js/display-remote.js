// Display side of the phone remote. Loaded by index.html after the main clock script.
import { configured, connect, newRoomId } from './firebase.js';

const $ = id => document.getElementById(id);
const KEY = 'examRemoteRoom';
const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} }
};
const EC = window.ExamClock;

let fb = null;
let roomId = null;
let unsub = null;
const pending = {};

function roomDoc() {
  const c = EC.cfg();
  const { e } = EC.times();
  return {
    title: String(c.title || 'Examination').slice(0, 120),
    endAt: e.getTime(),
    closeAt: e.getTime() - EC.CLOSE_MIN * 60000
  };
}
const roomRef = (path = '') => fb.ref(fb.db, `rooms/${roomId}${path}`);

function remoteUrl() {
  return new URL('remote.html?r=' + roomId, location.href).href;
}

function render(status) {
  const on = !!roomId;
  $('remoteStatus').textContent = status || (on
    ? 'Phone remote is ON. Staff scan this code (keep it off the projector).'
    : 'Phone remote is off.');
  $('btnRemoteStart').style.display = fb && !on ? '' : 'none';
  $('btnRemoteCopy').style.display = on ? '' : 'none';
  $('btnRemoteEnd').style.display = on ? '' : 'none';
  const qr = $('remoteQR');
  qr.innerHTML = '';
  qr.style.display = on ? 'block' : 'none';
  $('remoteLink').textContent = on ? remoteUrl() : '';
  if (on && window.qrcode) {
    const q = window.qrcode(0, 'M');
    q.addData(remoteUrl());
    q.make();
    qr.innerHTML = q.createSvgTag(5, 2);
  }
  $('roomBadge').textContent = on ? '📱 Phone remote on · ' : '';
}

function subscribe() {
  if (unsub) unsub();
  unsub = fb.onValue(roomRef(), snap => {
    const v = snap.val();
    if (!v) { stop('The remote session ended.'); return; }
    for (const k of ['M', 'F']) {
      EC.remoteState(k, !!v[k], pending[k] ? 'key' : 'phone');
      pending[k] = false;
    }
  }, err => {
    console.warn(err);
    stop('Could not reopen the previous remote session — start a new one.');
  });
}

function stop(msg) {
  if (unsub) { unsub(); unsub = null; }
  roomId = null;
  store.set(null);
  render(msg);
}

window.Remote = {
  active: () => !!(fb && roomId),
  set(k, v) {
    pending[k] = true;
    fb.set(roomRef('/' + k), v).catch(err => { pending[k] = false; console.warn(err); });
  },
  onClosedChange() { /* closing is enforced by the database rules using closeAt */ },
  onSettings() { if (fb && roomId) fb.update(roomRef(), roomDoc()).catch(console.warn); }
};

async function start() {
  roomId = newRoomId();
  const s = EC.state();
  try {
    await fb.set(roomRef(), { owner: fb.uid, created: Date.now(), M: s.M, F: s.F, ...roomDoc() });
  } catch (err) {
    console.warn(err);
    roomId = null;
    render('Could not start the remote — check the database rules are published.');
    return;
  }
  store.set(roomId);
  subscribe();
  render();
}

async function end() {
  if (!roomId) return;
  try { await fb.remove(roomRef()); } catch (err) { console.warn(err); }
  stop();
}

$('btnRemoteStart').onclick = start;
$('btnRemoteEnd').onclick = end;
$('btnRemoteCopy').onclick = () => {
  try { navigator.clipboard.writeText(remoteUrl()); $('btnRemoteCopy').textContent = 'Copied'; setTimeout(() => $('btnRemoteCopy').textContent = 'Copy link', 1500); } catch {}
};

(async () => {
  if (!configured) { render('Not configured yet — paste your Firebase config into js/firebase-config.js (see README).'); return; }
  render('Connecting…');
  try { fb = await connect(); }
  catch (err) { console.warn(err); render('Could not reach Firebase from this network. Keyboard and clicker still work.'); return; }
  const saved = store.get();
  if (saved) { roomId = saved; subscribe(); Remote.onSettings(); }
  render();
})();
