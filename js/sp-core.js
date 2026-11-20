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

  // ---------- students ----------
  function loadState() {
    const st = read(STATE_KEY, null) || {};
    return { students: Array.isArray(st.students) ? st.students : [], log: Array.isArray(st.log) ? st.log : [], rev: st.rev || 0 };
  }
  function saveState(st) { st.rev = (st.rev || 0) + 1; write(STATE_KEY, st); }

  function newStudent(o) {
    return {
      id: String(o.id), name: String(o.name || ''), display: String(o.display || o.id),
      xr: o.xr || 0,       // extra reading minutes
      xw: o.xw || 0,       // extra writing minutes
      rest: o.rest || 0,   // rest-break minutes allowed (0 = none set)
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
    const readEnd = extend(sMs + (cfg.read + st.xr) * MIN, st.breaks, now, sMs);
    const finish = extend(sMs + (cfg.read + st.xr + cfg.write + st.xw + st.adj) * MIN, st.breaks, now, sMs);
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
      leftMs: finish - now, restUsed: used, restAllowed: st.rest * MIN,
      restOver: st.rest > 0 && used > st.rest * MIN,
      breakSince: onBreak(st) ? new Date(st.breaks[st.breaks.length - 1].start) : null
    };
  }

  // ---------- CSV import (with validation) ----------
  // Accepted headers (case and spaces ignored). Only id is required.
  const ALIASES = {
    id: ['id', 'studentid', 'candidate', 'candidatenumber', 'number'],
    name: ['name', 'fullname', 'student', 'studentname'],
    display: ['display', 'label', 'initials', 'projector'],
    xr: ['extrareading', 'extrareadingminutes', 'xr', 'reading'],
    xw: ['extrawriting', 'extrawritingminutes', 'extratime', 'extra', 'xw', 'writing'],
    rest: ['rest', 'restminutes', 'restbreaks', 'restbreakminutes']
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
    const num = (v, line, field) => {
      if (v == null || String(v).trim() === '') return 0;
      const n = Number(String(v).trim());
      if (!Number.isInteger(n) || n < 0 || n > 600) { errors.push(`Line ${line}: ${field} "${v}" must be a whole number of minutes from 0 to 600.`); return null; }
      return n;
    };
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const get = k => col[k] >= 0 ? (r[col[k]] ?? '').trim() : '';
      const id = get('id');
      if (!id) { errors.push(`Line ${line}: missing id, row skipped.`); return; }
      if (id.length > 40) { errors.push(`Line ${line}: id is longer than 40 characters, row skipped.`); return; }
      if (seen.has(id)) { errors.push(`Line ${line}: duplicate id "${id}", row skipped.`); return; }
      const xr = num(get('xr'), line, 'extra reading'), xw = num(get('xw'), line, 'extra writing'), rest = num(get('rest'), line, 'rest');
      if (xr == null || xw == null || rest == null) return;
      seen.add(id);
      students.push(newStudent({ id, name: get('name').slice(0, 80), display: (get('display') || id).slice(0, 20), xr, xw, rest }));
    });
    return { students, errors };
  }

  const TEMPLATE = 'id,name,display,extra_reading,extra_writing,rest\n' +
    '1001,Example Student,ES,5,20,10\n' +
    '1002,Another Student,AS,0,10,0\n';

  window.SP = {
    MIN, loadCfg, saveCfg, defaultCfg, baseTimes, loadState, saveState, newStudent,
    onBreak, compute, importCSV, TEMPLATE, hm, hms, mmss, nextFive
  };
})();
