// Phone remote: remote.html?r=<room id>
import { configured, connect, ROOM_RE } from './firebase.js';

const $ = id => document.getElementById(id);
const roomId = new URLSearchParams(location.search).get('r') || '';

let fb = null, room = null, offset = 0, live = false;
const pending = {};

const serverNow = () => Date.now() + offset;

function render(msgOverride) {
  let msg = '';
  const closed = room && serverNow() >= room.closeAt;
  const finished = room && serverNow() >= room.endAt;
  $('rTitle').textContent = room ? String(room.title || '') : '';
  if (!room) msg = 'Waiting for the exam display…';
  else if (finished) msg = 'Exam finished.';
  else if (closed) msg = 'Toilets closed for the final 15 minutes.';
  $('rMsg').textContent = msgOverride || msg;

  for (const k of ['M', 'F']) {
    const b = $('rb' + k);
    const lbl = b.querySelector('.st'), hint = b.querySelector('.hint');
    b.classList.remove('vacant', 'occ', 'closed', 'wait');
    if (!room || !live) { b.classList.add('wait'); b.disabled = true; lbl.textContent = room ? (room[k] ? 'OCCUPIED' : 'VACANT') : '—'; hint.textContent = ''; continue; }
    const occ = !!room[k];
    if (closed) {
      b.classList.add('closed'); lbl.textContent = 'CLOSED';
      b.disabled = !occ;
      hint.textContent = occ ? 'Student still out — tap when back' : '';
    } else {
      b.classList.add(occ ? 'occ' : 'vacant'); lbl.textContent = occ ? 'OCCUPIED' : 'VACANT';
      b.disabled = false;
      hint.textContent = occ ? 'Tap when student returns' : 'Tap when student goes in';
    }
    if (pending[k]) { b.classList.add('wait'); hint.textContent = 'Sending…'; }
  }
}

function tap(k) {
  if (!room || !live) return;
  const want = !room[k];
  pending[k] = true; render();
  fb.set(fb.ref(fb.db, `rooms/${roomId}/${k}`), want)
    .then(() => { pending[k] = false; render(); })
    .catch(() => { pending[k] = false; render(want ? 'Toilets are closed — that tap was refused.' : 'That tap did not go through — try again.'); });
}

function setConn(ok, text) {
  $('rDot').className = 'dot ' + (ok ? 'ok' : 'bad');
  $('rConn').textContent = text;
}

(async () => {
  if (!ROOM_RE.test(roomId)) { setConn(false, 'No session'); render('Scan the QR code from the exam display’s setup screen.'); return; }
  if (!configured) { setConn(false, 'Not set up'); render('This site has not been connected to Firebase yet.'); return; }
  try { fb = await connect(); }
  catch (err) { console.warn(err); setConn(false, 'Offline'); render('Could not reach the server from this network.'); return; }

  fb.onValue(fb.ref(fb.db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  fb.onValue(fb.ref(fb.db, '.info/connected'), s => {
    live = !!s.val();
    setConn(live, live ? 'Live' : 'Reconnecting…');
    render();
  });
  fb.onValue(fb.ref(fb.db, `rooms/${roomId}`), s => {
    room = s.val();
    if (!room) { render('This remote session has ended. Scan the new code on the display.'); return; }
    render();
  }, err => { console.warn(err); setConn(false, 'No access'); render('Access refused by the database (' + (err && (err.code || err.message) || 'unknown') + '). Check the Realtime Database rules are published. Room: ' + roomId); });

  $('rbM').onclick = () => tap('M');
  $('rbF').onclick = () => tap('F');
  setInterval(() => render(), 1000);   // flips to CLOSED on time even with no database change
})();
