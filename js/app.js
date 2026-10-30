import { Chess } from '../vendor/chess.js';
import { Engine } from './engine.js';
import { parseGame, gameId, gameSource, looksLikePgn, findGameUrl } from './pgn.js';
import { analyzeGame, summarize, CLASSES, CLASS_ORDER, REPORT_VERSION, winPercent, lineToWhite } from './analysis.js';
import { describeError, fmtLine, moveLabel, CATEGORY_TEXT, LESSONS, themeLabel, playLine } from './explain.js';
import { lineMotifs, describeMotif, MOTIF_TEXT, PIECE_NAME } from './motifs.js';
import { gameTips, trends, indexEntry, filterEntries, openingReport, weekProgress, userRating } from './insights.js';
import { games, gameIndex, puzzles, meta, evalCache, exportAll, importAll, wipeAll, loadSettings, saveSettings } from './store.js';
import { recentGames, findByUrl } from './chesscom.js';
import { recentLichessGames, lichessGamePgn, findLichessUrl } from './lichess.js';
import { loadPieces, createBoard, renderEvalBar } from './board.js';
import { renderGraph, renderTrendChart } from './graph.js';
import { loadOpenings } from './openings.js';
import { extractPuzzles, puzzleFromPly, recordAttempt, buildQueue, themeQueue, themeStats, streak, dayKey } from './training.js';
import { createSolver } from './solver.js';
import { startGuided, guidedMoments } from './guided.js';
import { exportPgn } from './pgnexport.js';
import { createQueue, createWakeLock } from './sync.js';

const APP_VERSION = '2.0';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const RESULT_SHORT = { win: 'W', loss: 'L', draw: 'D', unknown: '–' };
const KEEP_HEADERS = ['Event', 'Site', 'Date', 'UTCDate', 'UTCTime', 'White', 'Black', 'WhiteElo', 'BlackElo', 'Result', 'TimeControl', 'ECO', 'ECOUrl', 'Opening', 'Link', 'Termination'];

const state = {
  settings: loadSettings(),
  engine: new Engine(),
  view: 'home',
  record: null,
  game: null,
  cur: 0,
  pane: 'report',
  job: null,
  recent: null,
  analyzedIds: new Set(),
  board: null,
  builtList: null,
  lineView: null,
  showThreat: false,
  explore: null,
  retry: null,
  coachDone: null,
  session: null,
  insFilter: { tc: 'all', days: 0 },
  lastSync: 0,
};
state.engine.cache = evalCache;
const wake = createWakeLock();

/* ---------- formatting ---------- */

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
function showError(msg) { const e = $('#home-error'); e.textContent = msg; e.hidden = false; }
function hideError() { $('#home-error').hidden = true; }
function fmtAcc(a) { return a == null ? '–' : a.toFixed(1); }
function fmtEval(e) {
  if (!e) return '–';
  if (e.type === 'mate') {
    if (e.score === 0) return e.winner === 'w' ? '1-0' : '0-1';
    return (e.score > 0 ? 'M' : '−M') + Math.abs(e.score);
  }
  const v = e.score / 100;
  if (Math.abs(v) < 0.05) return '0.0';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1);
}
function shortEval(e) {
  if (!e) return '';
  if (e.type === 'mate') return e.score === 0 ? '#' : 'M' + Math.abs(e.score);
  const v = Math.abs(e.score / 100);
  return v >= 10 ? Math.round(v) + '' : v.toFixed(1);
}
function fmtClock(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60), sec = s - m * 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(sec)).padStart(2, '0')}`
    : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
}
function fmtSpent(s) {
  if (s == null) return '–';
  return s < 10 ? s.toFixed(1) + 's' : s < 60 ? Math.round(s) + 's' : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
function badge(cls, small = false) {
  const c = CLASSES[cls];
  return c ? `<span class="badge${small ? ' sm' : ''}" style="--c: var(--c-${cls})" aria-hidden="true">${c.glyph}</span>` : '';
}
function plyLabel(p) { return moveLabel(p.moveNo, p.color, p.san); }
function playedAt(h) {
  const d = (h.UTCDate || h.Date || '').replace(/\./g, '-');
  const ts = Date.parse(`${d}T${h.UTCTime || '00:00:00'}Z`);
  return Number.isFinite(ts) ? ts : Date.now();
}
function dateLabel(ts) {
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}
function detectColor(h) {
  const names = [state.settings.username, state.settings.lichessUsername].map((u) => (u || '').trim().toLowerCase()).filter(Boolean);
  if (names.includes((h.White || '').toLowerCase())) return 'w';
  if (names.includes((h.Black || '').toLowerCase())) return 'b';
  return null;
}
function pickHeaders(h) {
  const out = {};
  for (const k of KEEP_HEADERS) if (h[k] != null) out[k] = h[k];
  return out;
}

/* ---------- sound ---------- */

let audio = null;
function moveSound(m) {
  if (!state.settings.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'triangle';
    o.frequency.value = m && m.captured ? 330 : 520;
    g.gain.setValueAtTime(0.18, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.09);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.1);
  } catch { /* audio unavailable */ }
}

/* ---------- navigation ---------- */

function show(view) {
  if (state.view === 'review' && view !== 'review') leaveExplore();
  state.view = view;
  for (const v of ['home', 'review', 'train', 'insights', 'settings']) $('#view-' + v).hidden = v !== view;
  const tab = view === 'review' ? 'home' : view;
  $$('.tabbar button').forEach((b) => (b.dataset.view === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
  if (view === 'train') renderTrain();
  if (view === 'insights') renderInsights();
  if (view === 'settings') renderSettings();
}

/* ---------- analysis pipeline (shared by manual and background) ---------- */

async function analyzeAndSave(game, hints, { signal, onProgress }) {
  const id = gameId(game);
  const existing = await games.get(id).catch(() => null);
  const userColor = hints.color || detectColor(game.headers) || (existing && existing.userColor) || 'w';
  const preset = state.settings.preset;
  const rec = {
    id,
    pgn: game.pgn,
    headers: pickHeaders(game.headers),
    opening: game.opening,
    source: gameSource(game.headers),
    tcLabel: game.timeControl ? game.timeControl.label : '',
    tcKind: game.timeControl ? game.timeControl.kind || (game.timeControl.daily ? 'Daily' : '') : '',
    playedAt: playedAt(game.headers),
    analyzedAt: null,
    userColor,
    notes: (existing && existing.notes) || {},
    report: null,
    evals: null,
    extra: null,
    partial: existing && existing.partial && existing.partial.preset === preset ? existing.partial : null,
  };
  const openings = await loadOpenings();
  const out = await analyzeGame(game, state.engine, {
    preset, userColor, signal, onProgress, openings,
    cache: evalCache,
    resume: rec.partial ? rec.partial.evals : null,
    onCheckpoint: async (evals) => { rec.partial = { preset, evals }; await games.put(rec).catch(() => {}); },
  });
  rec.report = out.report;
  rec.evals = out.evals;
  rec.extra = out.extra;
  rec.partial = null;
  rec.analyzedAt = Date.now();
  rec.tips = gameTips(out.report, out.report.opening.name || rec.opening, { rating: userRating(rec.headers, userColor) });
  await games.put(rec);
  await gameIndex.put(indexEntry(rec)).catch(() => {});
  await savePuzzlesFor(rec);
  state.analyzedIds.add(id);
  requestPersist();
  updateBadges();
  return rec;
}

async function savePuzzlesFor(rec) {
  const fresh = extractPuzzles(rec, { includeInaccuracies: state.settings.puzzleInaccuracies });
  const old = await puzzles.byIndex('gameId', rec.id).catch(() => []);
  const oldById = new Map(old.map((p) => [p.id, p]));
  const merged = fresh.map((p) => (oldById.has(p.id) ? { ...p, srs: oldById.get(p.id).srs, attempts: oldById.get(p.id).attempts, createdAt: oldById.get(p.id).createdAt } : p));
  await puzzles.putMany(merged).catch(() => {});
}

let persistAsked = false;
function requestPersist() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}

const queue = createQueue({
  analyze: async (item, signal, onProgress) => {
    wake.set(true);
    try {
      const game = parseGame(item.pgn);
      await analyzeAndSave(game, { color: item.color }, { signal, onProgress });
    } finally {
      wake.set(!!state.job || queue.pending() > 1);
    }
  },
  onChange: () => {
    renderQueueCard();
    updateBadges();
    if (state.view === 'home') renderHistoryThrottled();
  },
});

function progressText(pr, total) {
  if (!pr) return 'Starting the engine…';
  if (pr.phase === 'scan') return `Analyzing move ${Math.min(pr.done, pr.total - 1)} of ${pr.total - 1}`;
  if (pr.phase === 'deep') return `Double-checking key moves (${pr.done}/${pr.total})`;
  return `Finding threats (${pr.done}/${pr.total})`;
}

function setProgress(pr) {
  const weights = { scan: [0, 0.8], deep: [0.8, 0.15], threats: [0.95, 0.05] };
  const [base, span] = pr ? weights[pr.phase] : [0, 0];
  const frac = pr ? base + span * (pr.done / Math.max(1, pr.total)) : 0;
  $('#pg-bar').style.width = Math.round(frac * 100) + '%';
  $('#pg-label').textContent = progressText(pr);
  if (pr && pr.phase === 'scan' && pr.done > 2) {
    const left = Math.max(0, ((pr.elapsed / pr.done) * (pr.total - pr.done)) / 1000) * 1.2;
    $('#pg-eta').textContent = left < 5 ? 'almost done' : `about ${left < 60 ? Math.round(left) + ' s' : Math.round(left / 60) + ' min'} left`;
  } else if (!pr) {
    $('#pg-eta').textContent = '';
  }
}

async function startAnalysis(pgnText, hints = {}) {
  hideError();
  let game;
  try { game = parseGame(pgnText); } catch (e) { return showError(e.message); }
  const id = gameId(game);
  const existing = await games.get(id).catch(() => null);
  if (existing && existing.report && !hints.force && existing.report.version >= REPORT_VERSION) {
    toast('Opened your saved review of this game.');
    return openRecord(id);
  }
  state.record = { id, headers: pickHeaders(game.headers), opening: game.opening, tcLabel: game.timeControl ? game.timeControl.label : '', playedAt: playedAt(game.headers), userColor: hints.color || detectColor(game.headers) || 'w' };
  state.game = game;
  resetReviewState();
  show('review');
  renderReviewHeader();
  $('#rv-body').hidden = true;
  $('#rv-error').hidden = true;
  $('#rv-upgrade').hidden = true;
  $('#rv-progress').hidden = false;
  setProgress(null);

  if (state.job) { state.job.controller.abort(); state.engine.stop(); }
  queue.pause();
  const controller = new AbortController();
  const job = { controller, id };
  state.job = job;
  wake.set(true);
  try {
    const rec = await analyzeAndSave(game, hints, { signal: controller.signal, onProgress: (pr) => { if (state.job === job) setProgress(pr); } });
    if (state.record && state.record.id === id) {
      state.record = rec;
      $('#rv-progress').hidden = true;
      state.pane = guidedMoments(rec.report).length ? 'coach' : 'report';
      renderReview();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    $('#rv-progress').hidden = true;
    const er = $('#rv-error');
    er.textContent = e.message || 'Analysis failed. Try again.';
    er.hidden = false;
  } finally {
    if (state.job === job) state.job = null;
    wake.set(queue.pending() > 0);
    queue.resume();
  }
}

/* ---------- home ---------- */

function renderHome() {
  renderQueueCard();
  renderHistory();
  renderRecent();
  maybeAutoSync();
}

function renderQueueCard() {
  const el = $('#queue-card');
  const items = queue.state.items;
  const active = items.filter((i) => i.status === 'queued' || i.status === 'running');
  if (!active.length) {
    const done = items.filter((i) => i.status === 'done').length;
    if (done && state.view === 'home') {
      el.hidden = false;
      el.innerHTML = `<div class="q-head"><b>${plural(done, 'new game')} analyzed</b><button class="link" type="button" data-act="dismiss">Dismiss</button></div>`;
      el.querySelector('[data-act="dismiss"]').onclick = () => { queue.clearDone(); el.hidden = true; };
    } else el.hidden = true;
    return;
  }
  const run = queue.state.running && queue.state.running.item;
  const pr = run && run.progress;
  const pct = pr ? Math.round(((pr.phase === 'scan' ? 0.8 * pr.done / Math.max(1, pr.total) : 0.9)) * 100) : 0;
  el.hidden = false;
  el.innerHTML = `<div class="q-head"><b>Analyzing new games · ${items.filter((i) => i.status === 'done').length + 1} of ${items.filter((i) => i.status !== 'error').length}</b>
      <span class="muted small">${queue.state.paused ? 'paused' : run ? esc(run.label) : ''}</span></div>
    <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    <p class="muted small">Keep the app open; results appear below as each game finishes.</p>`;
}

let histTimer = null;
function renderHistoryThrottled() {
  clearTimeout(histTimer);
  histTimer = setTimeout(renderHistory, 400);
}

async function renderHistory(limit = 40) {
  const el = $('#history');
  let list;
  try { list = await gameIndex.all(); } catch { el.innerHTML = '<div class="empty">Saved games are unavailable in this browser mode.</div>'; return; }
  list.sort((a, b) => (b.analyzedAt || 0) - (a.analyzedAt || 0));
  state.analyzedIds = new Set(list.map((r) => r.id));
  if (!list.length) { el.innerHTML = '<div class="empty">Games you analyze will appear here.</div>'; return; }
  el.innerHTML = list.slice(0, limit).map((e) => `<button class="item" data-open="${esc(e.id)}" type="button">
      <span class="result-dot ${e.result}" aria-label="${e.result}">${RESULT_SHORT[e.result] || '–'}</span>
      <span><span class="title">vs ${esc(e.opponent || 'Opponent')}</span>
        <span class="sub">${esc(dateLabel(e.playedAt))}${e.tcKind ? ' · ' + esc(e.tcKind) : ''} · ${plural(e.counts.blunder, 'blunder')}, ${plural(e.counts.mistake, 'mistake')}</span></span>
      <span class="right"><b>${fmtAcc(e.accuracy)}</b>accuracy</span></button>`).join('')
    + (list.length > limit ? `<button class="link" type="button" data-more="1">Show ${Math.min(40, list.length - limit)} more</button>` : '');
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openRecord(b.dataset.open)));
  const more = el.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => renderHistory(limit + 40));
}

async function fetchRecent() {
  const tasks = [];
  if (state.settings.username.trim()) tasks.push(recentGames(state.settings.username, 20));
  if (state.settings.lichessUsername.trim()) tasks.push(recentLichessGames(state.settings.lichessUsername, 20));
  const results = await Promise.allSettled(tasks);
  const list = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value).sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason && r.reason.message);
  return { list, errors };
}

async function renderRecent(force = false) {
  const el = $('#recent');
  const key = `${state.settings.username}|${state.settings.lichessUsername}`;
  if (!state.settings.username.trim() && !state.settings.lichessUsername.trim()) {
    el.innerHTML = '<div class="empty">Add your Chess.com or Lichess username in <button class="link" type="button" data-goto="settings">Settings</button> to see your latest games here.</div>';
    el.querySelector('[data-goto]').addEventListener('click', () => show('settings'));
    return;
  }
  const draw = ({ list, errors }) => {
    if (!list.length) { el.innerHTML = `<div class="empty">${esc(errors[0] || 'No recent games found.')}</div>`; return; }
    el.innerHTML = list.slice(0, 25).map((g, k) => `<button class="item" type="button" data-k="${k}">
      <span class="result-dot ${g.result}">${RESULT_SHORT[g.result]}</span>
      <span><span class="title">vs ${esc(g.opponent)} <span class="muted">(${esc(g.opponentRating)})</span></span>
        <span class="sub">${g.source === 'lichess' ? 'Lichess' : 'Chess.com'} · ${esc(g.timeClass || '')} · ${g.endTime ? esc(dateLabel(g.endTime)) : ''}</span></span>
      <span class="right">${state.analyzedIds.has(g.url) ? '<b>✓</b>reviewed' : '<b>›</b>analyze'}</span></button>`).join('')
      + (errors.length ? `<p class="muted small">${esc(errors.join(' '))}</p>` : '');
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const g = list[+b.dataset.k];
      startAnalysis(g.pgn, { color: g.color });
    }));
  };
  if (state.recent && state.recent.key === key && !force) return draw(state.recent.data);
  el.innerHTML = '<div class="empty">Loading your games…</div>';
  const data = await fetchRecent();
  state.recent = { key, data, at: Date.now() };
  draw(data);
}

async function maybeAutoSync(force = false) {
  const mode = state.settings.autoSync;
  if (mode === 'off' || (!force && Date.now() - state.lastSync < 10 * 60 * 1000)) return;
  if (!state.settings.username.trim() && !state.settings.lichessUsername.trim()) return;
  state.lastSync = Date.now();
  const { list } = state.recent && Date.now() - state.recent.at < 60000 ? state.recent.data : await fetchRecent();
  const ids = new Set((await gameIndex.all().catch(() => [])).map((e) => e.id));
  const pool = mode === 'last3' ? list.slice(0, 3) : list.slice(0, 25);
  const fresh = pool.filter((g) => !ids.has(g.url)).slice(0, mode === 'last3' ? 3 : 10);
  if (fresh.length) {
    queue.add(fresh.map((g) => ({ key: g.url, pgn: g.pgn, color: g.color, label: `vs ${g.opponent}` })));
    toast(`Analyzing ${plural(fresh.length, 'new game')} in the background.`);
  }
}

async function handleText(text, hints = {}) {
  hideError();
  const t = String(text || '').trim();
  if (!t) return showError('The clipboard is empty. In Chess.com or Lichess, tap Share → copy the PGN first.');
  if (looksLikePgn(t)) return startAnalysis(t, hints);
  const li = findLichessUrl(t);
  if (li) {
    toast('Loading the game from Lichess…');
    try { return startAnalysis(await lichessGamePgn(li.id), hints); } catch (e) { return showError(e.message); }
  }
  const link = findGameUrl(t);
  if (link) {
    if (!state.settings.username.trim()) return showError('To analyze a Chess.com link, add your Chess.com username in Settings so the app can look it up. Or copy the PGN instead.');
    toast('Looking up the game on Chess.com…');
    try {
      const g = await findByUrl(state.settings.username, link.id);
      if (!g) return showError("Couldn't find that game in your last three months of games. Copy the PGN instead.");
      return startAnalysis(g.pgn, { color: g.color });
    } catch (e) { return showError(e.message); }
  }
  showError("That doesn't look like a chess game. Copy the PGN or a game link, then try again.");
}

/* ---------- review ---------- */

function resetReviewState() {
  state.cur = 0;
  state.pane = 'report';
  state.builtList = null;
  state.lineView = null;
  state.showThreat = false;
  state.retry = null;
  state.coachDone = null;
  leaveExplore();
  if (state.board) state.board.setFlipped(state.record.userColor === 'b');
}

async function openRecord(id, pane = 'report', ply = null) {
  const rec = await games.get(id).catch(() => null);
  if (!rec || !rec.report) return toast('That game is no longer saved.');
  state.record = rec;
  state.game = parseGame(rec.pgn);
  resetReviewState();
  state.pane = pane;
  if (ply != null) state.cur = ply + 1;
  show('review');
  $('#rv-progress').hidden = true;
  $('#rv-error').hidden = true;
  renderReview();
}

function isUpgradable(rec) {
  return !rec.report || rec.report.version < REPORT_VERSION || !rec.evals;
}

function renderReviewHeader() {
  const rec = state.record;
  const h = rec.headers;
  const me = rec.userColor;
  const name = (c) => h[c === 'w' ? 'White' : 'Black'] || (c === 'w' ? 'White' : 'Black');
  $('#rv-title').textContent = `${name(me)} vs ${name(me === 'w' ? 'b' : 'w')}`;
  const op = rec.report && rec.report.opening && rec.report.opening.name ? rec.report.opening.name : rec.opening;
  const bits = [];
  if (h.Result) bits.push(h.Result.replace('1/2-1/2', '½-½'));
  if (op) bits.push(op);
  if (rec.tcLabel) bits.push(rec.tcLabel);
  bits.push(dateLabel(rec.playedAt));
  $('#rv-meta').textContent = bits.join(' · ');
}

function renderReview() {
  renderReviewHeader();
  $('#rv-upgrade').hidden = !isUpgradable(state.record);
  $('#rv-body').hidden = false;
  setPane(state.pane);
}

function setPane(pane) {
  if (pane !== 'moves') leaveExplore();
  state.pane = pane;
  $$('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === pane)));
  $('#pane-coach').hidden = pane !== 'coach';
  $('#pane-report').hidden = pane !== 'report';
  $('#pane-moves').hidden = pane !== 'moves';
  if (pane === 'coach') renderCoach();
  else if (pane === 'report') renderReport();
  else renderMoves();
}

function goToPly(i) {
  state.cur = i + 1;
  state.lineView = null;
  state.retry = null;
  setPane('moves');
  window.scrollTo(0, 0);
}

async function saveRecord() {
  try { await games.put(state.record); } catch { /* keep in memory */ }
}

/* ----- coach pane ----- */

function renderCoach() {
  const host = $('#coach-host');
  const rec = state.record;
  if (isUpgradable(rec)) {
    host.innerHTML = '<div class="card"><h3>Guided review</h3><p class="muted">Re-analyze this game (button above) to unlock the guided review.</p></div>';
    return;
  }
  if (state.coachDone) return renderCoachSummary(state.coachDone);
  const moments = guidedMoments(rec.report, { rating: userRating(rec.headers, rec.report.userColor) });
  host.innerHTML = `<div class="card coach-intro">
      <h3>Guided review</h3>
      ${moments.length
        ? `<p>${plural(moments.length, 'key moment')} from this game. For each one you'll get the position first: find the move, then see what happened and why.</p>
           <button type="button" class="btn primary big" data-act="start">Start review</button>`
        : '<p class="muted">No key moments: the engine found no mistakes worth reviewing. Nicely played. Check the Report for details.</p>'}
    </div>`;
  const btn = host.querySelector('[data-act="start"]');
  if (btn) btn.addEventListener('click', () => {
    startGuided(host, {
      record: rec,
      report: rec.report,
      engine: state.engine,
      notes: rec.notes || {},
      sound: moveSound,
      keepPuzzle: async (pz, keep) => {
        if (!pz) return;
        if (keep) { const old = await puzzles.get(pz.id).catch(() => null); if (!old) await puzzles.put(pz).catch(() => {}); }
        else await puzzles.remove(pz.id).catch(() => {});
        updateBadges();
      },
      saveNote: (ply, text) => { rec.notes = rec.notes || {}; if (text) rec.notes[ply] = text; else delete rec.notes[ply]; saveRecord(); },
      onOpenMove: (ply) => goToPly(ply),
      onFinish: (stats) => { state.coachDone = stats; renderCoachSummary(stats); window.scrollTo(0, 0); },
    });
  });
}

function renderCoachSummary(stats) {
  const rec = state.record;
  const tips = (rec.tips || gameTips(rec.report, rec.report.opening.name, { rating: userRating(rec.headers, rec.report.userColor) })).slice(0, 3);
  $('#coach-host').innerHTML = `<div class="card coach-summary">
      <h3>Review complete</h3>
      <div><span class="big-num">${stats.found}/${stats.total}</span> <span class="muted">found on the first try, without hints</span></div>
      <div class="tips">${tips.map((t) => `<div class="tip"><b>${esc(t.title)}</b><p>${esc(t.body)}</p></div>`).join('')}</div>
      <button type="button" class="btn primary big" data-act="train">Train these positions now</button>
      <div class="row-btns"><button type="button" class="btn ghost" data-act="report">See full report</button><button type="button" class="btn ghost" data-act="again">Review again</button></div>
    </div>`;
  const host = $('#coach-host');
  host.querySelector('[data-act="train"]').onclick = () => startGameSession(rec.id);
  host.querySelector('[data-act="report"]').onclick = () => setPane('report');
  host.querySelector('[data-act="again"]').onclick = () => { state.coachDone = null; renderCoach(); };
}

/* ----- report pane ----- */

function renderReport() {
  const rec = state.record, r = rec.report;
  const me = r.userColor, opp = me === 'w' ? 'b' : 'w';
  const P = r.summary.players;
  const h = rec.headers;
  const nm = (c) => esc(h[c === 'w' ? 'White' : 'Black'] || (c === 'w' ? 'White' : 'Black'));
  const elo = (c) => { const e = h[c === 'w' ? 'WhiteElo' : 'BlackElo']; return e ? ` (${esc(e)})` : ''; };

  $('#rv-accuracy').innerHTML = `
    <div class="acc me"><span class="who">You · ${nm(me)}${elo(me)}</span><span class="val">${fmtAcc(P[me].accuracy)}<small>%</small></span><span class="muted small">accuracy</span></div>
    <div class="acc"><span class="who">${nm(opp)}${elo(opp)}</span><span class="val">${fmtAcc(P[opp].accuracy)}<small>%</small></span><span class="muted small">accuracy</span></div>`;

  const rows = CLASS_ORDER.filter((c) => c !== 'book' || P[me].counts.book || P[opp].counts.book).map((c) => {
    const a = P[me].counts[c] || 0, b = P[opp].counts[c] || 0;
    const hl = ['blunder', 'mistake', 'miss'].includes(c) && a > 0;
    return `<tr class="${hl ? 'hl' : ''}" style="--c: var(--c-${c})"><td>${badge(c)}${CLASSES[c].label}</td><td class="${a ? '' : 'zero'}">${a}</td><td class="${b ? '' : 'zero'}">${b}</td></tr>`;
  }).join('');
  $('#rv-counts').innerHTML = `<table class="counts"><thead><tr><th>Moves</th><th>You</th><th>Opponent</th></tr></thead><tbody>${rows}</tbody></table>`;

  const op = r.opening;
  if (op && op.name) {
    const firstOut = r.plies[op.bookPlies];
    $('#rv-opening-card').hidden = false;
    $('#rv-opening').innerHTML = `<div class="card-head"><h3>Opening</h3><span class="muted small">${esc(op.eco)}</span></div>
      <p><b>${esc(op.name)}</b></p>
      <p class="muted small">${op.bookPlies ? `Both sides followed known theory for ${plural(Math.ceil(op.bookPlies / 2), 'move')}.` : ''}
      ${firstOut ? ` ${firstOut.color === me ? 'You' : 'Your opponent'} left theory with ${esc(plyLabel(firstOut))}.` : ''}</p>`;
  } else $('#rv-opening-card').hidden = true;

  renderGraph($('#rv-graph'), { positions: r.positions, plies: r.plies, cur: state.cur, userColor: me, onSelect: (k) => { state.cur = k; setPane('moves'); } });

  if (!rec.tips) rec.tips = gameTips(r, op && op.name, { rating: userRating(h, me) });
  $('#rv-tips').innerHTML = rec.tips.map((t) => `<div class="tip"><b>${esc(t.title)}</b><p>${esc(t.body)}</p>${t.plies.length ? `<div class="chips">${t.plies.slice(0, 5).map((i) => `<button class="chip" type="button" data-ply="${i}">${esc(plyLabel(r.plies[i]))}</button>`).join('')}</div>` : ''}</div>`).join('');
  puzzles.byIndex('gameId', rec.id).then((list) => {
    const b = $('#btn-practice');
    b.hidden = !list.length;
    b.textContent = `Practice ${plural(list.length, 'position')} from this game`;
    b.onclick = () => startGameSession(rec.id);
  }).catch(() => {});

  let moments = r.plies.filter((p) => p.color === me && ['blunder', 'mistake', 'miss'].includes(p.cls)).sort((a, b) => b.loss - a.loss).slice(0, 8);
  if (!moments.length) moments = r.plies.filter((p) => p.color === me && p.cls === 'inaccuracy').sort((a, b) => b.loss - a.loss).slice(0, 3);
  const greats = r.plies.filter((p) => p.color === me && p.cls === 'great').slice(0, 3);
  const row = (p) => {
    const d = p.why ? describeError(p) : null;
    return `<button class="moment" type="button" data-ply="${p.i}">${badge(p.cls)}
      <span><span class="mv">${esc(plyLabel(p))}</span> <span class="muted small">${CLASSES[p.cls].label}</span><br>
        <span class="why">${d ? esc(d.headline) + ' · ' : ''}${p.best && p.cls !== 'great' ? 'best was ' + esc(p.best.san) : 'only good move'}</span></span>
      <span class="delta">${fmtEval(r.positions[p.i].eval)} → ${fmtEval(r.positions[p.i + 1].eval)}</span></button>`;
  };
  $('#rv-moments').innerHTML = moments.length || greats.length ? moments.map(row).join('') + greats.map(row).join('') : '<p class="muted small">No inaccuracies, mistakes or blunders. Nicely played.</p>';

  const legend = '<div class="legend"><span><i style="background:var(--accent)"></i>You</span><span><i style="background:var(--graph-mid)"></i>Opponent</span></div>';
  const names = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };
  const bar = (v, cls) => (v ? `<div class="hbar ${cls}"><div class="track"><div class="fill" style="width:${Math.max(2, v.acc)}%"></div></div><span>${v.acc.toFixed(0)}%</span></div>`
    : `<div class="hbar ${cls}"><div class="track"></div><span class="muted">–</span></div>`);
  $('#rv-phases').innerHTML = legend + Object.keys(names).filter((ph) => P[me].phases[ph] || P[opp].phases[ph]).map((ph) =>
    `<div class="phase-row"><span class="small">${names[ph]}</span><div class="bars">${bar(P[me].phases[ph], 'me')}${bar(P[opp].phases[ph], 'opp')}</div></div>`).join('');

  const mine = r.plies.filter((p) => p.color === me && p.spent != null);
  if (mine.length) {
    $('#rv-time-card').hidden = false;
    const lastMine = [...r.plies].reverse().find((p) => p.color === me && p.clock != null);
    $('#rv-time').innerHTML = `<div class="stat-grid">
      <div class="stat"><div class="k">Your avg per move</div><div class="v">${fmtSpent(P[me].avgSpent)}</div></div>
      <div class="stat"><div class="k">On critical moves</div><div class="v">${fmtSpent(P[me].criticalSpent)}</div></div>
      <div class="stat"><div class="k">Errors in under 3 s</div><div class="v">${P[me].rushedErrors}</div></div>
      <div class="stat"><div class="k">Errors low on time</div><div class="v">${P[me].lowClockErrors}</div></div>
    </div>${lastMine ? `<p class="muted small" style="margin-top:8px">Opponent averaged ${fmtSpent(P[opp].avgSpent)} per move. Your clock at the end: ${fmtClock(lastMine.clock)}.</p>` : ''}`;
  } else $('#rv-time-card').hidden = true;

  $$('.seg-mini button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === me)));
  $$('#pane-report [data-ply]').forEach((b) => b.addEventListener('click', () => goToPly(+b.dataset.ply)));
}

async function changeColor(color) {
  const rec = state.record;
  if (!rec || !rec.report || rec.userColor === color) return;
  rec.userColor = color;
  rec.report.userColor = color;
  rec.report.summary = summarize(state.game, rec.report.plies, rec.report.positions, color);
  rec.tips = gameTips(rec.report, rec.report.opening && rec.report.opening.name, { rating: userRating(rec.headers, color) });
  state.coachDone = null;
  if (state.board) state.board.setFlipped(color === 'b');
  await saveRecord();
  if (!isUpgradable(rec)) {
    await gameIndex.put(indexEntry(rec)).catch(() => {});
    const stale = await puzzles.byIndex('gameId', rec.id).catch(() => []);
    for (const p of stale) await puzzles.remove(p.id).catch(() => {});
    await savePuzzlesFor(rec);
  }
  renderReviewHeader();
  renderReport();
}

/* ----- moves pane ----- */

function buildMoveList() {
  const r = state.record.report;
  let html = '', open = false;
  const btn = (p) => {
    const show = ['great', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(p.cls);
    return `<button class="mv" type="button" data-k="${p.i + 1}" style="--c: var(--c-${p.cls})">${esc(p.san)}${show ? `<span class="glyph">${CLASSES[p.cls].glyph}</span>` : ''}</button>`;
  };
  for (const p of r.plies) {
    if (p.color === 'w') { if (open) html += '<span></span>'; html += `<span class="no">${p.moveNo}.</span>${btn(p)}`; open = true; }
    else { if (!open) html += `<span class="no">${p.moveNo}.</span><span></span>`; html += btn(p); open = false; }
  }
  if (open) html += '<span></span>';
  const el = $('#movelist');
  el.innerHTML = html;
  el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => setCur(+b.dataset.k)));
  state.builtList = state.record.id;
}

function setCur(k) {
  const n = state.record.report.plies.length;
  const next = Math.max(0, Math.min(n, k));
  const step = next === state.cur + 1;
  state.cur = next;
  state.lineView = null;
  state.retry = null;
  renderMoves({ animate: step });
}

function currentPly() {
  return state.cur > 0 ? state.record.report.plies[state.cur - 1] : null;
}

function renderMoves({ animate = false } = {}) {
  const r = state.record.report;
  if (state.builtList !== state.record.id) buildMoveList();
  const retryHost = $('#retry-host');
  if (state.retry != null) return renderRetry();
  if (retryHost) retryHost.remove();
  $('.board-wrap').hidden = false;
  $('.nav-row').hidden = false;
  if (state.explore) return renderExplore();

  const k = state.cur;
  const p = currentPly();
  const board = state.board;
  board.setInteractive(false);

  if (state.lineView) {
    const lv = state.lineView;
    const fen = lv.fens[lv.idx];
    const last = lv.idx > 0 ? lv.moves[lv.idx - 1] : null;
    const next = lv.moves[lv.idx];
    board.setPosition(fen, {
      lastMove: last ? { from: last.from, to: last.to } : null,
      arrows: next ? [{ from: next.from, to: next.to, color: 'var(--arrow-best)', opacity: 0.6 }] : [],
      animate: !!lv.animate,
    });
    lv.animate = false;
  } else {
    const fen = p ? p.fenAfter : state.game.startFen;
    const arrows = [];
    const showBest = p && p.best && p.best.uci !== p.uci && !['best', 'great', 'forced', 'excellent', 'book'].includes(p.cls);
    if (showBest) arrows.push({ from: p.best.uci.slice(0, 2), to: p.best.uci.slice(2, 4), color: 'var(--arrow-best)' });
    if (state.showThreat && p && p.why && p.why.threat) arrows.push({ from: p.why.threat.uci.slice(0, 2), to: p.why.threat.uci.slice(2, 4), color: 'var(--arrow-threat)' });
    board.setPosition(fen, { lastMove: p ? { from: p.from, to: p.to } : null, cls: p ? p.cls : null, arrows, animate });
    if (animate) moveSound(p && { captured: p.captured });
  }
  const pos = r.positions[k];
  renderEvalBar($('#evalbar'), { winWhite: pos.winWhite, label: shortEval(pos.eval), flipped: board.flipped });

  renderTools(p);
  renderMoveInfo(p, k);
  renderGraph($('#mv-graph'), { positions: r.positions, plies: r.plies, cur: k, userColor: r.userColor, onSelect: setCur, height: 64 });
  highlightMoveList(k);
}

function highlightMoveList(k) {
  const list = $('#movelist');
  let current = null;
  list.querySelectorAll('.mv').forEach((b) => {
    const on = +b.dataset.k === k;
    b.setAttribute('aria-current', String(on));
    if (on) current = b;
  });
  // Scroll only inside the move list so the page (and board) stays put.
  if (!current) list.scrollTop = 0;
  else {
    const top = current.offsetTop, bottom = top + current.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 8);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
  }
}

function renderTools(p) {
  const el = $('#move-tools');
  const tools = [];
  if (p && p.best && !['best', 'great', 'forced', 'book'].includes(p.cls)) tools.push(`<button type="button" class="tool primary" data-tool="retry">Find a better move</button>`);
  if (p && p.bestPv && p.bestPv.length > 1) tools.push(`<button type="button" class="tool" data-tool="line" aria-pressed="${!!state.lineView}">Best line</button>`);
  if (p && p.why && p.why.threat) tools.push(`<button type="button" class="tool" data-tool="threat" aria-pressed="${state.showThreat}">Threat</button>`);
  tools.push(`<button type="button" class="tool" data-tool="explore">Explore</button>`);
  el.innerHTML = tools.join('');
  el.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'retry') { state.retry = p.i; renderMoves(); }
    else if (t === 'line') toggleLine(p);
    else if (t === 'threat') { state.showThreat = !state.showThreat; renderMoves(); }
    else if (t === 'explore') enterExplore();
  }));
}

function toggleLine(p) {
  if (state.lineView) { state.lineView = null; return renderMoves(); }
  const line = playLine(p.fenBefore, p.bestPv, 8);
  state.lineView = { fens: line.fens, moves: line.moves, sans: line.sans, idx: 0, start: p.fenBefore };
  renderMoves();
}

function renderMoveInfo(p, k) {
  const r = state.record.report;
  const info = $('#move-info');
  const pos = r.positions[k];
  if (state.lineView) {
    const lv = state.lineView;
    const fen0 = lv.start;
    let no = +fen0.split(' ')[5], color = fen0.split(' ')[1];
    const parts = lv.sans.map((s, j) => {
      const label = color === 'w' ? `${no}. ${s}` : j === 0 ? `${no}... ${s}` : s;
      if (color === 'b') no++;
      color = color === 'w' ? 'b' : 'w';
      return j === lv.idx - 1 ? `<b>${esc(label)}</b>` : esc(label);
    });
    info.innerHTML = `<div class="headline">Best line from move ${p.moveNo}</div>
      <div class="stepper">
        <button type="button" class="tool" data-ls="prev" aria-label="Previous line move">‹</button>
        <button type="button" class="tool" data-ls="next" aria-label="Next line move">›</button>
        <span class="line-moves">${parts.join(' ')}</span>
        <button type="button" class="tool" data-ls="close">Back to game</button>
      </div>`;
    info.querySelectorAll('[data-ls]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.ls;
      if (a === 'close') { state.lineView = null; return renderMoves(); }
      const lvNow = state.lineView;
      const n = lvNow.idx + (a === 'next' ? 1 : -1);
      if (n < 0 || n > lvNow.moves.length) return;
      lvNow.animate = a === 'next';
      lvNow.idx = n;
      renderMoves();
    }));
    return;
  }
  if (!p) {
    info.innerHTML = `<div class="headline">Starting position</div><div class="evals">Eval ${fmtEval(pos.eval)}</div><div class="explain">Step through the game with the arrows, swipe on the board, or tap any move below.</div>`;
    return;
  }
  const c = CLASSES[p.cls];
  const isMine = p.color === r.userColor;
  const what = p.cls === 'best' ? 'the best move' : p.cls === 'forced' ? 'the only legal move' : p.cls === 'book' ? 'a book move' : `${/^[aeiou]/i.test(c.label) ? 'an' : 'a'} ${c.label.toLowerCase()}`;
  const timeBits = [];
  if (p.spent != null) timeBits.push(`thought ${fmtSpent(p.spent)}`);
  if (p.clock != null) timeBits.push(`clock ${fmtClock(p.clock)}`);
  const d = p.why ? describeError(p, { mine: isMine }) : null;
  const alts = p.alts || [];
  const note = (state.record.notes || {})[p.i] || '';
  const threatBy = isMine ? 'Your opponent' : p.color === 'w' ? 'Black' : 'White';
  const threat = p.why && p.why.threat && !p.why.threat.ignored && state.showThreat
    ? `<div class="threat-line">${threatBy} was threatening ${esc(p.why.threat.san)}${p.why.threat.motif ? ` (${esc(MOTIF_TEXT[p.why.threat.motif].toLowerCase())})` : ''}.</div>` : '';
  info.innerHTML = `
    <div class="headline">${badge(p.cls)}${esc(plyLabel(p))} is ${what}</div>
    <div class="evals">${isMine ? 'Your move' : "Opponent's move"} · eval ${fmtEval(r.positions[k - 1].eval)} → ${fmtEval(pos.eval)}${timeBits.length ? ' · ' + timeBits.join(', ') : ''}</div>
    ${d ? `<div class="explain"><b>${esc(d.headline)}.</b> ${esc(d.detail)}</div>` : ''}
    ${threat}
    ${p.best && p.best.uci !== p.uci && p.cls !== 'book' ? `<div class="line"><b>Best: ${esc(p.best.san)}</b>${p.bestLine.length > 1 ? ' · ' + esc(fmtLine(p.bestLine.slice(0, 6), p.fenBefore)) : ''}</div>` : ''}
    ${alts.length > 1 ? `<div class="alts" aria-label="Top engine moves">${alts.map((a) => `<span class="alt"><b>${esc(a.san)}</b>${fmtEval(a.eval)}</span>`).join('')}</div>` : ''}
    ${isMine ? `<div class="note-box"><label class="note-label" for="move-note">Your note</label><textarea id="move-note" rows="1" placeholder="What were you thinking here?">${esc(note)}</textarea></div>` : ''}`;
  const ta = info.querySelector('#move-note');
  if (ta) ta.addEventListener('change', () => {
    const rec = state.record;
    rec.notes = rec.notes || {};
    if (ta.value.trim()) rec.notes[p.i] = ta.value.trim(); else delete rec.notes[p.i];
    saveRecord();
    toast('Note saved.');
  });
}

function renderRetry() {
  const p = state.record.report.plies[state.retry];
  let host = $('#retry-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'retry-host';
    $('#pane-moves').prepend(host);
  }
  $('.board-wrap').hidden = true;
  $('.nav-row').hidden = true;
  $('#move-tools').innerHTML = '';
  $('#move-info').innerHTML = '';
  const pz = puzzleFromPly(state.record, p) || { fen: p.fenBefore, solution: [p.best.uci], color: p.color, winBefore: p.winBefore, hint: 'Look for checks, captures and threats first.', themes: ['positional'] };
  host.innerHTML = '<div class="card"><div class="retry-solver"></div><div class="retry-after" hidden></div></div>';
  createSolver(host.querySelector('.retry-solver'), pz, {
    engine: state.engine,
    prompt: `Find a better move than ${p.san}`,
    sub: `${p.color === 'w' ? 'White' : 'Black'} to move, move ${p.moveNo}.`,
    onMoveSound: moveSound,
    onResult: async (res) => {
      const after = host.querySelector('.retry-after');
      const d = p.why ? describeError(p, { mine: p.color === state.record.report.userColor }) : null;
      const theme = pz.themes && pz.themes[0];
      after.hidden = false;
      after.innerHTML = `${d ? `<p class="reveal-why"><b>${esc(d.headline)}.</b> ${esc(d.detail)}</p>` : ''}
        ${theme && LESSONS[theme] ? `<p class="lesson"><span class="chip">${esc(themeLabel(theme))}</span> ${esc(LESSONS[theme])}</p>` : ''}
        <button type="button" class="btn primary wide" data-act="back">Back to the game</button>`;
      after.querySelector('[data-act="back"]').onclick = () => { state.retry = null; renderMoves(); };
      const stored = await puzzles.get(pz.id).catch(() => null);
      if (stored) { await puzzles.put(recordAttempt(stored, res)).catch(() => {}); updateBadges(); }
    },
  });
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'link';
  back.textContent = 'Cancel and return to the game';
  back.onclick = () => { state.retry = null; renderMoves(); };
  host.querySelector('.card').appendChild(back);
}

/* ----- explore mode ----- */

function enterExplore() {
  const p = currentPly();
  const fen = p ? p.fenAfter : state.game.startFen;
  state.lineView = null;
  state.explore = { start: fen, fen, moves: [], eval: null, best: null, line: [], token: 0, depth: 0 };
  queue.pause();
  renderMoves();
  exploreAnalyse();
}

function leaveExplore() {
  if (!state.explore) return;
  state.explore = null;
  state.engine.stop();
  if (state.board) state.board.setInteractive(false);
  if (!state.job) queue.resume();
}

async function exploreAnalyse() {
  const ex = state.explore;
  if (!ex) return;
  const token = ++ex.token;
  state.engine.stop();
  const c = new Chess(ex.fen);
  if (c.isGameOver()) { ex.eval = null; ex.best = null; ex.line = []; return renderExplore(); }
  const stm = c.turn();
  const res = await state.engine.analyse(ex.fen, {
    depth: 20, multipv: 1, infinite: true,
    onInfo: (lines, depth) => {
      if (!state.explore || state.explore.token !== token || !lines[0]) return;
      ex.eval = lineToWhite(lines[0], stm);
      ex.winWhite = stm === 'w' ? winPercent(lines[0]) : 100 - winPercent(lines[0]);
      ex.best = lines[0].pv[0];
      ex.line = lines[0].pv.slice(0, 8);
      ex.depth = depth;
      renderExploreInfo();
    },
  }).catch(() => null);
  if (res && state.explore && state.explore.token === token) renderExploreInfo();
}

function renderExplore() {
  const ex = state.explore;
  const board = state.board;
  const last = ex.moves[ex.moves.length - 1];
  board.setPosition(ex.fen, { lastMove: last ? { from: last.from, to: last.to } : null, animate: !!ex.animate, arrows: ex.best ? [{ from: ex.best.slice(0, 2), to: ex.best.slice(2, 4), color: 'var(--arrow-best)', opacity: 0.55 }] : [] });
  ex.animate = false;
  board.setInteractive('both');
  board.onMove((mv) => {
    if (!state.explore) return;
    const c = new Chess(state.explore.fen);
    let m;
    try { m = c.move(mv); } catch { return; }
    moveSound(m);
    state.explore.moves.push(m);
    state.explore.fen = c.fen();
    state.explore.best = null;
    state.explore.animate = false;
    renderExplore();
    exploreAnalyse();
  });
  $('#move-tools').innerHTML = '<button type="button" class="tool" data-x="undo">Undo</button><button type="button" class="tool" data-x="reset">Reset</button><button type="button" class="tool primary" data-x="exit">Back to game</button>';
  $('#move-tools').querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.x;
    const e = state.explore;
    if (a === 'exit') { leaveExplore(); return renderMoves(); }
    if (a === 'undo' && e.moves.length) { e.moves.pop(); }
    if (a === 'reset') e.moves = [];
    const c = new Chess(e.start);
    for (const m of e.moves) c.move(m.san);
    e.fen = c.fen();
    e.best = null;
    renderExplore();
    exploreAnalyse();
  }));
  renderExploreInfo();
}

function renderExploreInfo() {
  const ex = state.explore;
  if (!ex) return;
  const pv = ex.line.length ? fmtLine(playLine(ex.fen, ex.line, 8).sans, ex.fen) : '';
  const moves = ex.moves.length ? fmtLine(ex.moves.map((m) => m.san), ex.start) : 'Move any piece to explore. The engine follows along.';
  $('#move-info').innerHTML = `<div class="explore-bar">
      <div class="headline">Explore</div>
      <div><span class="explore-eval">${ex.eval ? fmtEval(ex.eval) : '…'}</span> <span class="muted small">${ex.depth ? 'depth ' + ex.depth : 'thinking'}</span></div>
      ${pv ? `<div class="line"><b>Engine:</b> ${esc(pv)}</div>` : ''}
      <div class="muted small">${esc(moves)}</div></div>`;
  if (ex.winWhite != null) renderEvalBar($('#evalbar'), { winWhite: ex.winWhite, label: shortEval(ex.eval), flipped: state.board.flipped });
  if (ex.best) state.board.setArrows([{ from: ex.best.slice(0, 2), to: ex.best.slice(2, 4), color: 'var(--arrow-best)', opacity: 0.55 }]);
}

/* ---------- train ---------- */

async function trainInfo() {
  const all = await puzzles.all().catch(() => []);
  const seen = await meta.get('newSeen', { day: '', count: 0 });
  const newSeenToday = seen.day === dayKey() ? seen.count : 0;
  const days = await meta.get('trainDays', []);
  return { all, newSeenToday, days, queue: buildQueue(all, { newPerDay: +state.settings.newPerDay, newSeenToday }) };
}

async function updateBadges() {
  const pending = queue.pending();
  const hb = $('#badge-home');
  hb.hidden = !pending;
  hb.textContent = pending;
  try {
    const { queue: q } = await trainInfo();
    const tb = $('#badge-train');
    tb.hidden = !q.length;
    tb.textContent = q.length > 99 ? '99+' : q.length;
  } catch { /* ignore */ }
}

async function renderTrain() {
  if (state.session) return renderSession();
  const host = $('#train-host');
  const { all, queue: q, days } = await trainInfo();
  const st = streak(days);
  $('#train-sub').textContent = st ? `Streak: ${plural(st, 'day')}` : 'Puzzles from your own mistakes';
  if (!all.length) {
    host.innerHTML = '<div class="card train-hero"><h3>No puzzles yet</h3><p class="muted">Analyze a game: every mistake you make becomes a puzzle here, and comes back until you know it.</p><button type="button" class="btn primary" data-go="home">Analyze a game</button></div>';
    host.querySelector('[data-go]').onclick = () => show('home');
    return;
  }
  const stats = themeStats(all);
  const lastGame = [...all].sort((a, b) => b.createdAt - a.createdAt)[0];
  host.innerHTML = `
    <div class="card train-hero">
      <span class="big-num">${q.length}</span>
      <span class="muted">${q.length === 1 ? 'puzzle' : 'puzzles'} ready today</span>
      <button type="button" class="btn primary big" data-act="daily" ${q.length ? '' : 'disabled'}>${q.length ? 'Start training' : 'All done for today'}</button>
      <span class="muted small">${plural(all.length, 'position')} in your deck. Reviews come back on a schedule: sooner if you miss them, later once you know them.</span>
    </div>
    ${lastGame ? `<button type="button" class="item" data-act="last"><span class="result-dot unknown">↺</span><span><span class="title">Mistakes from your latest game</span><span class="sub">vs ${esc(lastGame.opponent || 'opponent')}</span></span><span class="right"><b>›</b></span></button>` : ''}
    <div class="block-head"><h2>Train by theme</h2></div>
    <div class="theme-list">${stats.map((s) => `<button type="button" class="theme-row" data-theme="${esc(s.theme)}">
        <span class="t-name">${esc(themeLabel(s.theme))}</span><span class="t-meta">${plural(s.puzzles, 'puzzle')}${s.rate != null ? ` · ${Math.round(s.rate * 100)}% clean` : ''}</span>
        <span class="t-bar"><i style="width:${s.rate != null ? Math.max(3, s.rate * 100) : 0}%"></i></span></button>`).join('')}</div>`;
  const d = host.querySelector('[data-act="daily"]');
  if (d) d.onclick = () => startSession({ kind: 'daily', title: "Today's training", list: q });
  const l = host.querySelector('[data-act="last"]');
  if (l) l.onclick = () => startGameSession(lastGame.gameId);
  host.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    startSession({ kind: 'theme', title: themeLabel(b.dataset.theme), list: themeQueue(all, b.dataset.theme) });
  }));
}

async function startGameSession(gameIdValue) {
  const list = (await puzzles.byIndex('gameId', gameIdValue).catch(() => [])).sort((a, b) => a.ply - b.ply);
  if (!list.length) return toast('No saved positions from this game.');
  startSession({ kind: 'game', title: 'Positions from this game', list });
}

function startSession({ kind, title, list }) {
  state.session = { kind, title, list, idx: 0, results: [] };
  show('train');
}

function renderSession() {
  const s = state.session;
  const host = $('#train-host');
  if (s.idx >= s.list.length) return renderSessionEnd();
  const pz = s.list[s.idx];
  host.innerHTML = `<div class="session-head"><b>${esc(s.title)}</b><span class="muted small">${s.idx + 1} / ${s.list.length}</span><button type="button" class="link" data-act="end">End</button></div>
    <div class="card"><div class="session-solver"></div><div class="session-foot" hidden></div></div>`;
  host.querySelector('[data-act="end"]').onclick = () => { s.list = s.list.slice(0, s.idx); renderSessionEnd(); };
  createSolver(host.querySelector('.session-solver'), pz, {
    engine: state.engine,
    prompt: `${pz.color === 'w' ? 'White' : 'Black'} to move`,
    sub: `From your game vs ${pz.opponent || 'opponent'}, move ${pz.moveNo}. You played ${pz.playedSan}.`,
    onMoveSound: moveSound,
    onResult: async (res) => {
      s.results.push(res);
      const updated = recordAttempt(pz, res);
      await puzzles.put(updated).catch(() => {});
      await markTrained(pz);
      const foot = host.querySelector('.session-foot');
      foot.hidden = false;
      const theme = pz.themes[0];
      foot.innerHTML = `${theme && LESSONS[theme] ? `<p class="lesson"><span class="chip">${esc(themeLabel(theme))}</span> ${esc(LESSONS[theme])}</p>` : ''}
        <p class="from-game">Next review: ${esc(nextReviewLabel(updated.srs.due))}</p>
        <div class="row-btns"><button type="button" class="btn ghost" data-act="game">Open game</button><button type="button" class="btn primary" data-act="next">${s.idx + 1 < s.list.length ? 'Next puzzle' : 'Finish'}</button></div>`;
      foot.querySelector('[data-act="next"]').onclick = () => { s.idx++; renderSession(); window.scrollTo(0, 0); };
      foot.querySelector('[data-act="game"]').onclick = () => { state.session = null; openRecord(pz.gameId, 'moves', pz.ply); };
      updateBadges();
    },
  });
}

function nextReviewLabel(due) {
  const days = Math.round((due - Date.now()) / 86400000);
  if (days <= 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  return `in about ${Math.round(days / 30)} month${days >= 45 ? 's' : ''}`;
}

async function markTrained(pz) {
  const today = dayKey();
  const days = await meta.get('trainDays', []);
  if (!days.includes(today)) await meta.set('trainDays', [...days.slice(-400), today]);
  if (pz.attempts && pz.attempts.length === 0) {
    const seen = await meta.get('newSeen', { day: today, count: 0 });
    await meta.set('newSeen', { day: today, count: (seen.day === today ? seen.count : 0) + 1 });
  }
}

function renderSessionEnd() {
  const s = state.session;
  const host = $('#train-host');
  const res = s.results;
  const clean = res.filter((r) => r.solved && r.firstTry && !r.hints).length;
  const helped = res.filter((r) => r.solved && !(r.firstTry && !r.hints)).length;
  const missed = res.filter((r) => !r.solved).length;
  host.innerHTML = `<div class="card train-hero">
      <h3>${res.length ? 'Session complete' : 'Session ended'}</h3>
      <span class="big-num">${clean}/${res.length}</span>
      <span class="muted">solved cleanly${helped ? ` · ${helped} with help` : ''}${missed ? ` · ${missed} to review again` : ''}</span>
      <button type="button" class="btn primary" data-act="done">Back to Train</button>
    </div>`;
  host.querySelector('[data-act="done"]').onclick = () => { state.session = null; renderTrain(); };
  state.session = { ...s, idx: s.list.length };
}

/* ---------- insights ---------- */

const TC_FILTERS = [['all', 'All'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['daily', 'Daily']];
const DAY_FILTERS = [[30, '30 days'], [90, '90 days'], [0, 'All time']];

function barRows(items, labelFn, max) {
  const top = max || Math.max(1, ...items.map((x) => x[1]));
  return `<div class="bars">${items.map(([k, v]) => `<div class="bar-row"><span>${esc(labelFn(k))}</span><span class="track"><i style="width:${v ? Math.max(3, (v / top) * 100) : 0}%"></i></span><span class="n">${v}</span></div>`).join('')}</div>`;
}

async function renderInsights() {
  const f = state.insFilter;
  $('#ins-filters').innerHTML = TC_FILTERS.map(([k, l]) => `<button type="button" data-tc="${k}" aria-pressed="${f.tc === k}">${l}</button>`).join('')
    + '<span class="sep"></span>' + DAY_FILTERS.map(([k, l]) => `<button type="button" data-days="${k}" aria-pressed="${f.days === k}">${l}</button>`).join('');
  $$('#ins-filters [data-tc]').forEach((b) => b.addEventListener('click', () => { state.insFilter.tc = b.dataset.tc; renderInsights(); }));
  $$('#ins-filters [data-days]').forEach((b) => b.addEventListener('click', () => { state.insFilter.days = +b.dataset.days; renderInsights(); }));

  const el = $('#insights');
  const all = await gameIndex.all().catch(() => []);
  const entries = filterEntries(all, f);
  const t = trends(entries);
  if (!t) {
    el.innerHTML = `<div class="empty">${all.length ? 'No games match these filters.' : 'Analyze a few games and your patterns will show up here.'}</div>`;
    return;
  }
  const goal = weekProgress(all, +state.settings.blunderGoal);
  const pzStats = themeStats(await puzzles.all().catch(() => [])).filter((s) => s.rate != null);
  const openings = openingReport(entries).slice(0, 8);
  const pieceLabel = (k) => (PIECE_NAME[k] ? PIECE_NAME[k][0].toUpperCase() + PIECE_NAME[k].slice(1) : k);
  const phaseNames = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="k">Games</div><div class="v">${t.games}</div><div class="k">${t.record.win}W · ${t.record.loss}L · ${t.record.draw}D</div></div>
      <div class="stat"><div class="k">Average accuracy</div><div class="v">${fmtAcc(t.accuracy)}%</div></div>
      <div class="stat"><div class="k">Blunders per game</div><div class="v">${t.blunders.toFixed(1)}</div></div>
      <div class="stat"><div class="k">Mistakes per game</div><div class="v">${t.mistakes.toFixed(1)}</div></div>
    </div>
    <div class="card goal"><div class="card-head"><h3>This week's goal</h3><span class="muted small">≤ ${goal.goal} blunders per game</span></div>
      ${goal.games ? `<div class="bar"><div class="bar-fill" style="width:${Math.min(100, (goal.goal / Math.max(goal.avg, 0.01)) * 100)}%; background: var(${goal.met ? '--good' : '--warn'})"></div></div>
        <p class="small">${goal.met ? 'On track' : 'Not yet'}: ${goal.avg.toFixed(1)} blunders per game across ${plural(goal.games, 'game')} this week.</p>` : '<p class="muted small">No games analyzed this week yet.</p>'}</div>
    <div class="card"><h3>Accuracy per game</h3><div id="trend-chart" class="graph"></div></div>
    <div class="card"><h3>Fix these first</h3>${t.issues.length ? t.issues.map((it) => `<div class="issue"><b>${esc(it.title)}</b><span class="freq">In ${it.gamesWith} of ${plural(t.games, 'game')} · ${plural(it.total, 'time')}</span><p>${esc(it.body)}</p></div>`).join('') : '<p class="muted small">No recurring problems yet.</p>'}</div>
    ${t.motifs.length ? `<div class="card"><h3>Tactics behind your mistakes</h3>${barRows(t.motifs.slice(0, 8), (k) => MOTIF_TEXT[k] || k)}</div>` : ''}
    ${pzStats.length ? `<div class="card"><h3>Puzzle solve rate by theme</h3><div class="bars">${pzStats.slice(0, 8).map((s) => `<div class="bar-row"><span>${esc(themeLabel(s.theme))}</span><span class="track"><i style="width:${Math.max(3, s.rate * 100)}%"></i></span><span class="n">${Math.round(s.rate * 100)}%</span></div>`).join('')}</div></div>` : ''}
    ${t.lostPieces.length ? `<div class="card"><h3>Pieces you lose most</h3>${barRows(t.lostPieces, pieceLabel)}</div>` : ''}
    <div class="card"><h3>When your mistakes happen</h3>${barRows(t.errorTiming.map((b) => [`Moves ${b.label}`, b.count]), (k) => k)}</div>
    <div class="card"><h3>Converting and saving</h3><div class="stat-grid">
      <div class="stat"><div class="k">Winning positions won</div><div class="v">${t.conversion ? Math.round((t.conversion.won / t.conversion.games) * 100) + '%' : '–'}</div><div class="k">${t.conversion ? `${t.conversion.won} of ${t.conversion.games}` : 'no winning positions yet'}</div></div>
      <div class="stat"><div class="k">Lost positions saved</div><div class="v">${t.saves ? Math.round((t.saves.saved / t.saves.games) * 100) + '%' : '–'}</div><div class="k">${t.saves ? `${t.saves.saved} of ${t.saves.games}` : 'no lost positions yet'}</div></div>
      ${t.criticalTime ? `<div class="stat"><div class="k">Time on critical moves</div><div class="v">${fmtSpent(t.criticalTime.critical)}</div><div class="k">vs ${fmtSpent(t.criticalTime.overall)} on average</div></div>` : ''}
    </div></div>
    ${openings.length ? `<div class="card"><h3>Your openings</h3>${openings.map((o) => `<button type="button" class="open-row" data-open="${esc(o.ids[o.ids.length - 1])}" style="background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;width:100%">
        <span class="o-name">${esc(o.family)} <span class="muted small">as ${o.color === 'w' ? 'White' : 'Black'}</span></span><span class="small">${Math.round(o.score * 100)}%</span>
        <span class="o-meta">${plural(o.games, 'game')} · accuracy ${fmtAcc(o.accuracy)}%${o.openingAccuracy != null ? ` · opening ${o.openingAccuracy.toFixed(0)}%` : ''}${o.firstErrorMove ? ` · first mistake around move ${o.firstErrorMove}` : ''}</span></button>`).join('')}</div>` : ''}
    <div class="card"><h3>Average accuracy by phase</h3>${Object.keys(phaseNames).map((ph) => (t.phaseAvg[ph] == null ? '' : `<div class="phase-row"><span class="small">${phaseNames[ph]}</span><div class="hbar"><div class="track"><div class="fill" style="width:${Math.max(2, t.phaseAvg[ph])}%"></div></div><span>${t.phaseAvg[ph].toFixed(0)}%</span></div></div>`)).join('')}</div>`;
  renderTrendChart($('#trend-chart'), t.series);
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openRecord(b.dataset.open)));
}

/* ---------- settings ---------- */

async function renderSettings() {
  const s = state.settings;
  $('#set-username').value = s.username;
  $('#set-lichess').value = s.lichessUsername;
  $$('input[name="preset"]').forEach((r) => { r.checked = r.value === s.preset; });
  $$('input[name="autosync"]').forEach((r) => { r.checked = r.value === s.autoSync; });
  $('#set-inacc').checked = !!s.puzzleInaccuracies;
  $('#set-newperday').value = String(s.newPerDay);
  $('#set-goal').value = String(s.blunderGoal);
  $('#set-theme').value = s.boardTheme;
  $('#set-sound').checked = !!s.sound;
  const [g, p] = await Promise.all([games.count().catch(() => 0), puzzles.count().catch(() => 0)]);
  $('#storage-info').textContent = `${plural(g, 'game')} and ${plural(p, 'puzzle')} stored only on this device.`;
  $('#app-version').textContent = `Version ${APP_VERSION}`;
  const btn = $('#btn-clear');
  btn.textContent = 'Delete all data';
  btn.dataset.armed = '';
}

function applyBoardTheme() {
  document.documentElement.dataset.board = state.settings.boardTheme || 'slate';
}

function setSetting(key, value) {
  state.settings[key] = value;
  saveSettings(state.settings);
}

async function backup() {
  const data = await exportAll();
  const json = JSON.stringify(data);
  const name = `blundercheck-backup-${dayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Blundercheck backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    const res = await importAll(data);
    state.settings = loadSettings();
    applyBoardTheme();
    await rebuildIndex(true);
    toast(`Restored ${plural(res.games, 'game')} and ${plural(res.puzzles, 'puzzle')}.`);
    renderSettings();
    updateBadges();
  } catch (e) {
    toast(e.message || "Couldn't read that backup file.");
  }
}

/* ---------- onboarding ---------- */

const SLIDES = [
  { art: '♞', title: 'Your games, coached', body: 'Blundercheck runs Stockfish on your phone to grade every move, explain your mistakes in plain words and show the better idea.' },
  { art: '⇩', title: 'Getting games in', body: 'Add your Chess.com or Lichess username in Settings to list your latest games, or copy a game\'s PGN or link and tap Paste.' },
  { art: '♜', title: 'Try first, then learn why', body: 'The guided review puts you back in the key positions. Find the move yourself, then see what the engine and the tactic were.' },
  { art: '↻', title: 'Mistakes become training', body: 'Every mistake becomes a puzzle in the Train tab and comes back on a schedule until you know it. Nothing leaves your device.' },
];

function showOnboarding() {
  let k = 0;
  const ov = $('#onboarding');
  const draw = () => {
    const s = SLIDES[k];
    $('#ob-body').innerHTML = `<div class="ob-art" aria-hidden="true">${s.art}</div><h2 id="ob-title">${esc(s.title)}</h2><p>${esc(s.body)}</p>`;
    $('#ob-dots').innerHTML = SLIDES.map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('');
    $('#ob-next').textContent = k + 1 < SLIDES.length ? 'Next' : 'Get started';
  };
  const close = () => { ov.hidden = true; setSetting('onboarded', true); };
  $('#ob-next').onclick = () => { if (++k >= SLIDES.length) close(); else draw(); };
  $('#ob-skip').onclick = close;
  draw();
  ov.hidden = false;
}

/* ---------- wiring ---------- */

function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'train' && state.view === 'train' && state.session) { state.session = null; }
    show(b.dataset.view);
  }));

  $('#btn-paste').addEventListener('click', async () => {
    hideError();
    try {
      handleText(await navigator.clipboard.readText());
    } catch {
      $('#manual').hidden = false;
      $('#pgn-input').focus();
      showError('Clipboard access was blocked. Paste the game into the box below instead.');
    }
  });
  $('#btn-manual').addEventListener('click', () => { $('#manual').hidden = !$('#manual').hidden; if (!$('#manual').hidden) $('#pgn-input').focus(); });
  $('#btn-analyze-text').addEventListener('click', () => handleText($('#pgn-input').value));
  $('#file-pgn').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleText(await f.text());
    e.target.value = '';
  });
  $('#btn-refresh').addEventListener('click', () => { renderRecent(true); maybeAutoSync(true); });

  $('#btn-back').addEventListener('click', () => show('home'));
  $('#btn-cancel').addEventListener('click', () => {
    if (state.job) { state.job.controller.abort(); state.engine.stop(); state.job = null; }
    wake.set(queue.pending() > 0);
    queue.resume();
    show('home');
  });
  $('#btn-upgrade').addEventListener('click', () => startAnalysis(state.record.pgn, { color: state.record.userColor, force: true }));
  $('#btn-reanalyze').addEventListener('click', () => startAnalysis(state.record.pgn, { color: state.record.userColor, force: true }));
  $('#btn-export').addEventListener('click', async () => {
    const pgn = exportPgn(state.record);
    if (navigator.share) {
      try { await navigator.share({ title: 'Annotated game', text: pgn }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(pgn); toast('Annotated PGN copied.'); } catch { toast("Couldn't copy the PGN."); }
  });
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => setPane(b.dataset.pane)));
  $$('.seg-mini button').forEach((b) => b.addEventListener('click', () => changeColor(b.dataset.color)));

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    if (state.explore) return;
    const n = state.record.report.plies.length;
    const a = b.dataset.nav;
    if (a === 'first') setCur(0);
    else if (a === 'prev') setCur(state.cur - 1);
    else if (a === 'next') setCur(state.cur + 1);
    else if (a === 'last') setCur(n);
    else if (a === 'flip') { state.board.setFlipped(!state.board.flipped); renderMoves(); }
  }));
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'review' || state.pane !== 'moves' || !state.record || !state.record.report || state.explore || state.retry != null) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') { setCur(state.cur - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setCur(state.cur + 1); e.preventDefault(); }
  });
  let touchX = null;
  $('#board').addEventListener('touchstart', (e) => { touchX = state.explore ? null : e.touches[0].clientX; }, { passive: true });
  $('#board').addEventListener('touchend', (e) => {
    if (touchX == null || state.explore) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) setCur(state.cur + (dx < 0 ? 1 : -1));
  });

  $('#set-username').addEventListener('change', (e) => { setSetting('username', e.target.value.trim()); state.recent = null; toast('Saved.'); });
  $('#set-lichess').addEventListener('change', (e) => { setSetting('lichessUsername', e.target.value.trim()); state.recent = null; toast('Saved.'); });
  $$('input[name="preset"]').forEach((r) => r.addEventListener('change', () => setSetting('preset', r.value)));
  $$('input[name="autosync"]').forEach((r) => r.addEventListener('change', () => { setSetting('autoSync', r.value); state.lastSync = 0; }));
  $('#set-inacc').addEventListener('change', (e) => setSetting('puzzleInaccuracies', e.target.checked));
  $('#set-newperday').addEventListener('change', (e) => { setSetting('newPerDay', +e.target.value); updateBadges(); });
  $('#set-goal').addEventListener('change', (e) => setSetting('blunderGoal', +e.target.value));
  $('#set-theme').addEventListener('change', (e) => { setSetting('boardTheme', e.target.value); applyBoardTheme(); });
  $('#set-sound').addEventListener('change', (e) => { setSetting('sound', e.target.checked); if (e.target.checked) moveSound({}); });
  $('#btn-tour').addEventListener('click', showOnboarding);
  $('#btn-backup').addEventListener('click', backup);
  $('#file-restore').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) restore(f); e.target.value = ''; });
  $('#btn-clear').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to delete everything'; return; }
    await wipeAll().catch(() => {});
    state.analyzedIds = new Set();
    toast('All data deleted.');
    renderSettings();
    updateBadges();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'review' && state.record && state.record.report && state.pane !== 'coach') setPane(state.pane);
      if (state.view === 'insights') renderInsights();
    }, 150);
  });
}

function handleLaunchHash() {
  const m = /^#(pgn|text)=(.+)$/s.exec(location.hash);
  if (!m) return;
  let text = '';
  try { text = decodeURIComponent(m[2]); } catch { text = m[2]; }
  history.replaceState(null, '', location.pathname + location.search);
  handleText(text);
}

// Builds the per-game summary index (fast insights) for games saved before it existed.
async function rebuildIndex(force = false) {
  const [all, idx] = await Promise.all([games.all().catch(() => []), gameIndex.all().catch(() => [])]);
  const have = new Set(idx.map((e) => e.id));
  const todo = all.filter((r) => r.report && (force || !have.has(r.id)));
  for (const r of todo) await gameIndex.put(indexEntry(r)).catch(() => {});
  // Resume games whose analysis was interrupted.
  const partial = all.filter((r) => !r.report && r.partial && r.pgn);
  if (partial.length) queue.add(partial.map((r) => ({ key: r.id, pgn: r.pgn, color: r.userColor, label: `vs ${r.userColor === 'w' ? r.headers.Black : r.headers.White}` })));
}

function watchForUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    $('#update-banner').hidden = false;
  });
  $('#btn-update').addEventListener('click', () => location.reload());
}

async function init() {
  applyBoardTheme();
  bind();
  try { await loadPieces(); } catch { toast('Could not load the chess pieces.'); }
  state.board = createBoard($('#board'), {});
  show('home');
  handleLaunchHash();
  window.addEventListener('hashchange', handleLaunchHash);
  watchForUpdates();
  if (!state.settings.onboarded) showOnboarding();
  loadOpenings();
  await rebuildIndex().catch(() => {});
  updateBadges();
  evalCache.prune().catch(() => {});
}

init();
