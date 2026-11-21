// Special provisions room: shared state and timing rules.
// Used by provisions.html (projector) and hud.html (control screen) on the SAME laptop.
// Everything is kept in this browser's localStorage. No student data is sent anywhere.
(function () {
  const CFG_KEY = 'spcfg';
  const STATE_KEY = 'spstate';
  const MIN = 60000;

  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const pad = n => String(n).padStart(2, '0');
  const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const hms = d => hm(d) + ':' + pad(d.getSeconds());
  const mmss = ms => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ':' + pad(t % 60); };

  function nextFive() {
    const d = new Date(Date.now() + 5 * MIN);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return hm(d);
  }

  // ---------- settings (the room's standard times) ----------
  function defaultCfg() {
    return { title: 'Special Provisions', start: nextFive(), read: 15, write: 90, warn: 10, light: false };
  }
  const loadCfg = () => read(CFG_KEY, null);
  const saveCfg = c => write(CFG_KEY, c);

  function startOf(cfg) {
    const [h, m] = (cfg.start || '00:00').split(':').map(Number);
    const s = new Date(); s.setHours(h, m, 0, 0);
    return s;
  }
  function baseTimes(cfg) {
    const s = startOf(cfg);
    const w = new Date(s.getTime() + cfg.read * MIN);
    const e = new Date(w.getTime() + cfg.write * MIN);
    return { s, w, e };
  }

  // ---------- allowances ----------
  // Extra time and rest breaks are each 10 minutes per 60-minute block of
  // standard writing time. A part block counts as a whole block (round up):
  // 90 min writing -> 2 blocks -> 20 min.
  const PER_BLOCK = 10, BLOCK = 60;
  const blocks = cfg => Math.ceil(Math.max(0, cfg.write) / BLOCK);
  const allowance = cfg => blocks(cfg) * PER_BLOCK;

  // ---------- students ----------
  function loadState() {
    const st = read(STATE_KEY, null) || {};
    const students = Array.isArray(st.students) ? st.students : [];
    // Lists saved by the earlier minutes-based version: treat any minutes as "yes".
    for (const s of students) {
      if (typeof s.et !== 'boolean') s.et = (s.xw || 0) > 0;
      if (typeof s.rb !== 'boolean') s.rb = (s.rest || 0) > 0;
    }
    return { students, log: Array.isArray(st.log) ? st.log : [], rev: st.rev || 0 };
  }
  function saveState(st) { st.rev = (st.rev || 0) + 1; write(STATE_KEY, st); }

  function newStudent(o) {
    return {
      id: String(o.id), name: String(o.name || ''), display: String(o.display || o.id),
      et: !!o.et,          // extra time: yes/no (10 min per 60-min block of writing)
      rb: !!o.rb,          // rest breaks: yes/no (10 min per 60-min block of writing)
      adj: 0,              // manual adjustment in minutes (+/-), e.g. late start or time lost
      breaks: [],          // [{ start: ms, end: ms|null }]
      finishedAt: null     // ms when marked finished early
    };
  }

  const onBreak = st => st.breaks.length > 0 && st.breaks[st.breaks.length - 1].end == null;

  function restUsedMs(st, now) {
    return st.breaks.reduce((t, b) => t + Math.max(0, (b.end ?? now) - b.start), 0);
  }

  // A rest break pauses the student's clock: every break that starts before a
  // deadline pushes that deadline back by the break's length (an ongoing break
  // keeps pushing it back until it ends).
  function extend(baseMs, breaks, now, sMs) {
    let t = baseMs;
    const sorted = [...breaks].sort((a, b) => a.start - b.start);
    for (const b of sorted) {
      const from = Math.max(b.start, sMs);
      if (from < t) t += Math.max(0, (b.end ?? now) - from);
    }
    return t;
  }

  // Everything the screens need to know about one student at time `now` (ms).
  function compute(cfg, st, now) {
    const sMs = startOf(cfg).getTime();
    const extra = st.et ? allowance(cfg) : 0;
    const restMin = st.rb ? allowance(cfg) : 0;
    const readEnd = extend(sMs + cfg.read * MIN, st.breaks, now, sMs);
    const finish = extend(sMs + (cfg.read + cfg.write + extra + st.adj) * MIN, st.breaks, now, sMs);
    let phase;
    if (st.finishedAt) phase = 'done';
    else if (onBreak(st)) phase = 'rest';
    else if (now < sMs) phase = 'pending';
    else if (now < readEnd) phase = 'reading';
    else if (now < finish) phase = (finish - now) <= (cfg.warn ?? 10) * MIN && (cfg.warn ?? 10) > 0 ? 'warning' : 'writing';
    else phase = 'done';
    const used = restUsedMs(st, now);
    return {
      phase, readEnd: new Date(readEnd), finish: new Date(st.finishedAt || finish),
      leftMs: finish - now, extra, restMin, restUsed: used, restAllowed: restMin * MIN,
      restOver: used > restMin * MIN,
      breakSince: onBreak(st) ? new Date(st.breaks[st.breaks.length - 1].start) : null
    };
  }

  // ---------- CSV import (with validation) ----------
  // Accepted headers (case and spaces ignored). Only id is required.
  const ALIASES = {
    id: ['id', 'studentid', 'candidate', 'candidatenumber', 'number'],
    name: ['name', 'fullname', 'student', 'studentname'],
    display: ['display', 'label', 'initials', 'projector'],
    et: ['extratime', 'extendedtime', 'extra', 'et'],
    rb: ['restbreaks', 'restbreak', 'rest', 'rb']
  };

  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }

  function importCSV(text) {
    const errors = [], students = [];
    const rows = parseCSV(String(text || '').replace(/^﻿/, ''));
    if (!rows.length) return { students, errors: ['The file is empty.'] };
    const head = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    const col = {};
    for (const key in ALIASES) col[key] = head.findIndex(h => ALIASES[key].includes(h));
    if (col.id < 0) return { students, errors: ['No "id" column found. The first row must be headings, e.g. id,name,display,extra_reading,extra_writing,rest'] };

    const seen = new Set();
    // Yes/no columns: blank counts as no.
    const YES = ['yes', 'y', 'true', '1', 'x'], NO = ['no', 'n', 'false', '0', ''];
    const bool = (v, line, field) => {
      const t = String(v ?? '').trim().toLowerCase();
      if (YES.includes(t)) return true;
      if (NO.includes(t)) return false;
      errors.push(`Line ${line}: ${field} "${v}" must be yes or no.`); return null;
    };
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const get = k => col[k] >= 0 ? (r[col[k]] ?? '').trim() : '';
      const id = get('id');
      if (!id) { errors.push(`Line ${line}: missing id, row skipped.`); return; }
      if (id.length > 40) { errors.push(`Line ${line}: id is longer than 40 characters, row skipped.`); return; }
      if (seen.has(id)) { errors.push(`Line ${line}: duplicate id "${id}", row skipped.`); return; }
      const et = bool(get('et'), line, 'extra time'), rb = bool(get('rb'), line, 'rest breaks');
      if (et == null || rb == null) return;
      seen.add(id);
      students.push(newStudent({ id, name: get('name').slice(0, 80), display: (get('display') || id).slice(0, 20), et, rb }));
    });
    return { students, errors };
  }

  const TEMPLATE = 'id,name,display,extra_time,rest_breaks\n' +
    '1001,Example Student,ES,yes,yes\n' +
    '1002,Another Student,AS,yes,no\n' +
    '1003,Third Student,TS,no,yes\n';

  window.SP = {
    MIN, PER_BLOCK, BLOCK, blocks, allowance, loadCfg, saveCfg, defaultCfg, baseTimes, loadState, saveState, newStudent,
    onBreak, compute, importCSV, TEMPLATE, hm, hms, mmss, nextFive
  };
})();
