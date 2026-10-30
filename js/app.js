import { Engine } from './engine.js';
import { parseGame, gameId, looksLikePgn, findGameUrl } from './pgn.js';
import { analyzeGame, summarize, CLASSES, CLASS_ORDER, CATEGORY_TEXT } from './analysis.js';
import { gameTips, trends } from './insights.js';
import { games, loadSettings, saveSettings } from './store.js';
import { recentGames, findByUrl } from './chesscom.js';
import { loadPieces, renderBoard, renderEvalBar } from './board.js';
import { renderGraph, renderTrendChart } from './graph.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RESULT_SHORT = { win: 'W', loss: 'L', draw: 'D', unknown: '–' };
const KEEP_HEADERS = ['Event', 'Site', 'Date', 'UTCDate', 'UTCTime', 'White', 'Black', 'WhiteElo', 'BlackElo', 'Result', 'TimeControl', 'ECO', 'ECOUrl', 'Link', 'Termination'];

const state = {
  settings: loadSettings(),
  engine: new Engine(),
  view: 'home',
  record: null,
  game: null,
  cur: 0,
  pane: 'report',
  flipped: false,
  job: null,
  recent: null,
  builtList: null,
};

/* ---------- small helpers ---------- */

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function showError(msg) {
  const e = $('#home-error');
  e.textContent = msg;
  e.hidden = false;
}
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
    : `${m}:${sec < 10 ? '0' : ''}${sec < 10 ? sec.toFixed(0) : Math.floor(sec)}`;
}

function fmtSpent(s) {
  if (s == null) return '';
  return s < 10 ? s.toFixed(1) + 's' : s < 60 ? Math.round(s) + 's' : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function moveLabel(p) { return `${p.moveNo}${p.color === 'w' ? '.' : '...'} ${p.san}`; }

function fmtLine(sans, fen) {
  if (!sans || !sans.length) return '';
  let no = +fen.split(' ')[5] || 1;
  let color = fen.split(' ')[1];
  const out = [];
  sans.forEach((s, k) => {
    if (color === 'w') out.push(`${no}. ${s}`);
    else out.push(k === 0 ? `${no}... ${s}` : s);
    if (color === 'b') no++;
    color = color === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}

function points(n) {
  if (n <= 1) return 'a pawn';
  if (n >= 8) return `${n} points of material (about a queen)`;
  if (n >= 5) return `${n} points of material (about a rook)`;
  if (n >= 3) return `${n} points of material (about a piece)`;
  return `${n} points of material`;
}

function badge(cls, small = false) {
  const c = CLASSES[cls];
  return `<span class="badge${small ? ' sm' : ''}" style="--c: var(--c-${cls})" aria-hidden="true">${c.glyph}</span>`;
}

function playedAt(h) {
  const d = (h.UTCDate || h.Date || '').replace(/\./g, '-');
  const t = h.UTCTime || '00:00:00';
  const ts = Date.parse(`${d}T${t}Z`);
  return Number.isFinite(ts) ? ts : Date.now();
}

function dateLabel(ts) {
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function detectColor(h) {
  const u = (state.settings.username || '').trim().toLowerCase();
  if (!u) return null;
  if ((h.White || '').toLowerCase() === u) return 'w';
  if ((h.Black || '').toLowerCase() === u) return 'b';
  return null;
}

function pickHeaders(h) {
  const out = {};
  for (const k of KEEP_HEADERS) if (h[k] != null) out[k] = h[k];
  return out;
}

/* ---------- navigation ---------- */

function show(view) {
  state.view = view;
  for (const v of ['home', 'review', 'insights', 'settings']) $('#view-' + v).hidden = v !== view;
  const tab = view === 'review' ? 'home' : view;
  $$('.tabbar button').forEach((b) => {
    if (b.dataset.view === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
  if (view === 'insights') renderInsights();
  if (view === 'settings') renderSettings();
}

/* ---------- home ---------- */

function renderHome() {
  renderHistory();
  renderRecent();
}

async function renderHistory() {
  const el = $('#history');
  let list;
  try {
    list = await games.all();
  } catch {
    el.innerHTML = '<div class="empty">Saved games are unavailable in this browser mode.</div>';
    return;
  }
  list = list.filter((r) => r.report).sort((a, b) => (b.analyzedAt || 0) - (a.analyzedAt || 0));
  state.analyzedIds = new Set(list.map((r) => r.id));
  if (!list.length) {
    el.innerHTML = '<div class="empty">Games you analyze will appear here.</div>';
    return;
  }
  el.innerHTML = list.slice(0, 60).map(historyItem).join('');
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openRecord(b.dataset.open)));
}

function historyItem(r) {
  const me = r.report.userColor;
  const s = r.report.summary.players[me];
  const res = r.report.summary.result;
  const opp = me === 'w' ? r.headers.Black : r.headers.White;
  const c = s.counts;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `<button class="item" data-open="${esc(r.id)}" type="button">
    <span class="result-dot ${res}" aria-label="${res}">${RESULT_SHORT[res]}</span>
    <span><span class="title">vs ${esc(opp || 'Opponent')}</span>
      <span class="sub">${esc(dateLabel(r.playedAt))}${r.tcLabel ? ' · ' + esc(r.tcLabel) : ''} · ${plural(c.blunder, 'blunder')}, ${plural(c.mistake, 'mistake')}</span></span>
    <span class="right"><b>${fmtAcc(s.accuracy)}</b>accuracy</span>
  </button>`;
}

async function renderRecent(force = false) {
  const el = $('#recent');
  const u = state.settings.username.trim();
  if (!u) {
    el.innerHTML = '<div class="empty">Add your Chess.com username in <button class="link" type="button" data-goto="settings">Settings</button> to see your latest games here.</div>';
    el.querySelector('[data-goto]').addEventListener('click', () => show('settings'));
    return;
  }
  const draw = (list) => {
    if (!list.length) { el.innerHTML = '<div class="empty">No recent games found for this username.</div>'; return; }
    el.innerHTML = list.map((g, k) => `<button class="item" type="button" data-k="${k}">
      <span class="result-dot ${g.result}">${RESULT_SHORT[g.result]}</span>
      <span><span class="title">vs ${esc(g.opponent)} <span class="muted">(${esc(g.opponentRating)})</span></span>
        <span class="sub">${esc(g.timeClass || '')} · ${g.endTime ? esc(dateLabel(g.endTime)) : ''} · you played ${g.color === 'w' ? 'White' : 'Black'}</span></span>
      <span class="right">${state.analyzedIds && state.analyzedIds.has(g.url) ? '<b>✓</b>reviewed' : '<b>›</b>analyze'}</span>
    </button>`).join('');
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const g = list[+b.dataset.k];
      startAnalysis(g.pgn, { color: g.color });
    }));
  };
  if (state.recent && state.recent.user === u && !force) return draw(state.recent.list);
  el.innerHTML = '<div class="empty">Loading your games…</div>';
  try {
    const list = await recentGames(u, 20);
    state.recent = { user: u, list };
    draw(list);
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc(e.message || 'Could not load games.')}</div>`;
  }
}

async function handleText(text, hints = {}) {
  hideError();
  const t = String(text || '').trim();
  if (!t) return showError('The clipboard is empty. In the Chess.com app, tap Share → Copy PGN first.');
  if (looksLikePgn(t)) return startAnalysis(t, hints);
  const link = findGameUrl(t);
  if (link) {
    if (!state.settings.username.trim()) {
      return showError('To analyze a game link, add your Chess.com username in Settings so the app can look it up. Or copy the PGN instead.');
    }
    toast('Looking up the game on Chess.com…');
    try {
      const g = await findByUrl(state.settings.username, link.id);
      if (!g) return showError("Couldn't find that game in your last three months of games. Copy the PGN instead.");
      return startAnalysis(g.pgn, { color: g.color });
    } catch (e) {
      return showError(e.message);
    }
  }
  showError("That doesn't look like a chess game. In the Chess.com app, tap Share → Copy PGN, then try again.");
}

/* ---------- analysis ---------- */

function setProgress(done, total, elapsed, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#pg-bar').style.width = pct + '%';
  $('#pg-label').textContent = label || `Analyzing move ${Math.min(done, total - 1)} of ${total - 1}`;
  if (done > 2 && elapsed) {
    const left = Math.max(0, (elapsed / done) * (total - done) / 1000);
    $('#pg-eta').textContent = left < 5 ? 'almost done' : `about ${left < 60 ? Math.round(left) + ' s' : Math.round(left / 60) + ' min'} left`;
  } else {
    $('#pg-eta').textContent = '';
  }
}

async function startAnalysis(pgnText, hints = {}) {
  hideError();
  let game;
  try {
    game = parseGame(pgnText);
  } catch (e) {
    return showError(e.message);
  }
  const id = gameId(game);
  const existing = await games.get(id).catch(() => null);
  if (existing && existing.report && !hints.force) {
    toast('Opened your saved review of this game.');
    return openRecord(id);
  }
  const userColor = hints.color || detectColor(game.headers) || (existing && existing.userColor) || 'w';
  const record = {
    id,
    pgn: game.pgn,
    headers: pickHeaders(game.headers),
    opening: game.opening,
    tcLabel: game.timeControl ? game.timeControl.label : '',
    tcKind: game.timeControl ? game.timeControl.kind || '' : '',
    playedAt: playedAt(game.headers),
    analyzedAt: null,
    userColor,
    report: null,
    tips: null,
  };
  state.record = record;
  state.game = game;
  state.cur = 0;
  state.pane = 'report';
  state.flipped = userColor === 'b';
  state.builtList = null;

  show('review');
  renderReviewHeader();
  $('#rv-body').hidden = true;
  $('#rv-error').hidden = true;
  $('#rv-progress').hidden = false;
  setProgress(0, game.moves.length + 1, 0, 'Starting the engine…');

  if (state.job) { state.job.controller.abort(); state.engine.stop(); }
  const controller = new AbortController();
  const job = { controller, id };
  state.job = job;
  try {
    const report = await analyzeGame(game, state.engine, {
      preset: state.settings.preset,
      userColor,
      signal: controller.signal,
      onProgress: ({ done, total, elapsed }) => { if (state.job === job) setProgress(done, total, elapsed); },
    });
    record.report = report;
    record.analyzedAt = Date.now();
    record.tips = gameTips(report, game.opening);
    try { await games.put(record); } catch { toast('Could not save this analysis on the device.'); }
    if (state.record && state.record.id === id) {
      $('#rv-progress').hidden = true;
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
  }
}

async function openRecord(id) {
  const rec = await games.get(id).catch(() => null);
  if (!rec || !rec.report) return toast('That game is no longer saved.');
  state.record = rec;
  state.game = parseGame(rec.pgn);
  state.cur = 0;
  state.pane = 'report';
  state.flipped = rec.userColor === 'b';
  state.builtList = null;
  show('review');
  $('#rv-progress').hidden = true;
  $('#rv-error').hidden = true;
  renderReview();
}

/* ---------- review ---------- */

function renderReviewHeader() {
  const h = state.record.headers;
  const me = state.record.userColor;
  const name = (c) => `${h[c === 'w' ? 'White' : 'Black'] || (c === 'w' ? 'White' : 'Black')}`;
  $('#rv-title').textContent = `${name(me)} vs ${name(me === 'w' ? 'b' : 'w')}`;
  const bits = [];
  if (h.Result) bits.push(h.Result.replace('1/2-1/2', '½-½'));
  if (state.record.opening) bits.push(state.record.opening);
  if (state.record.tcLabel) bits.push(state.record.tcLabel);
  bits.push(dateLabel(state.record.playedAt));
  $('#rv-meta').textContent = bits.join(' · ');
}

function renderReview() {
  renderReviewHeader();
  $('#rv-body').hidden = false;
  setPane(state.pane);
}

function setPane(pane) {
  state.pane = pane;
  $$('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === pane)));
  $('#pane-report').hidden = pane !== 'report';
  $('#pane-moves').hidden = pane !== 'moves';
  if (pane === 'report') renderReport(); else renderMoves();
}

function goToPly(i) {
  state.cur = i + 1;
  setPane('moves');
  window.scrollTo(0, 0);
}

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

  const rows = CLASS_ORDER.map((c) => {
    const a = P[me].counts[c], b = P[opp].counts[c];
    const hl = ['blunder', 'mistake', 'miss'].includes(c) && a > 0;
    return `<tr class="${hl ? 'hl' : ''}" style="--c: var(--c-${c})"><td>${badge(c)}${CLASSES[c].label}</td><td class="${a ? '' : 'zero'}">${a}</td><td class="${b ? '' : 'zero'}">${b}</td></tr>`;
  }).join('');
  $('#rv-counts').innerHTML = `<table class="counts"><thead><tr><th>Moves</th><th>You</th><th>Opponent</th></tr></thead><tbody>${rows}</tbody></table>`;

  renderGraph($('#rv-graph'), {
    positions: r.positions, plies: r.plies, cur: state.cur, userColor: me,
    onSelect: (k) => { state.cur = k; setPane('moves'); },
  });

  if (!rec.tips) rec.tips = gameTips(r, rec.opening);
  $('#rv-tips').innerHTML = rec.tips.map((t) => `<div class="tip"><b>${esc(t.title)}</b><p>${esc(t.body)}</p>${t.plies.length ? `<div class="chips">${t.plies.slice(0, 5).map((i) => `<button class="chip" type="button" data-ply="${i}">${esc(moveLabel(r.plies[i]))}</button>`).join('')}</div>` : ''}</div>`).join('');

  let moments = r.plies.filter((p) => p.color === me && ['blunder', 'mistake', 'miss'].includes(p.cls)).sort((a, b) => b.loss - a.loss).slice(0, 8);
  if (!moments.length) moments = r.plies.filter((p) => p.color === me && p.cls === 'inaccuracy').sort((a, b) => b.loss - a.loss).slice(0, 3);
  const greats = r.plies.filter((p) => p.color === me && p.cls === 'great').slice(0, 3);
  const momentRow = (p) => `<button class="moment" type="button" data-ply="${p.i}">
      ${badge(p.cls)}
      <span><span class="mv">${esc(moveLabel(p))}</span> <span class="muted small">${CLASSES[p.cls].label}</span><br>
        <span class="why">${p.why ? esc(p.cls === 'miss' && (p.why.cat === 'positional' || p.why.cat === 'endgame') ? "Didn't punish the mistake" : CATEGORY_TEXT[p.why.cat]) + ' · ' : ''}${p.best && p.cls !== 'great' ? 'best was ' + esc(p.best.san) : 'only good move'}</span></span>
      <span class="delta">${fmtEval(r.positions[p.i].eval)} → ${fmtEval(r.positions[p.i + 1].eval)}</span>
    </button>`;
  $('#rv-moments').innerHTML = (moments.length || greats.length)
    ? moments.map(momentRow).join('') + greats.map(momentRow).join('')
    : '<p class="muted small">No inaccuracies, mistakes or blunders. Nicely played.</p>';

  const legend = `<div class="legend"><span><i style="background:var(--accent)"></i>You</span><span><i style="background:var(--graph-mid)"></i>Opponent</span></div>`;
  const phaseNames = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };
  const bar = (v, cls) => v ? `<div class="hbar ${cls}"><div class="track"><div class="fill" style="width:${Math.max(2, v.acc)}%"></div></div><span>${v.acc.toFixed(0)}%</span></div>`
    : `<div class="hbar ${cls}"><div class="track"></div><span class="muted">–</span></div>`;
  const phaseRows = Object.keys(phaseNames).filter((ph) => P[me].phases[ph] || P[opp].phases[ph]).map((ph) =>
    `<div class="phase-row"><span class="small">${phaseNames[ph]}</span><div class="bars">${bar(P[me].phases[ph], 'me')}${bar(P[opp].phases[ph], 'opp')}</div></div>`).join('');
  $('#rv-phases').innerHTML = legend + phaseRows;

  const mine = r.plies.filter((p) => p.color === me && p.spent != null);
  if (mine.length) {
    $('#rv-time-card').hidden = false;
    const oppAvg = P[opp].avgSpent;
    const lastMine = [...r.plies].reverse().find((p) => p.color === me && p.clock != null);
    $('#rv-time').innerHTML = `<div class="stat-grid">
      <div class="stat"><div class="k">Your avg per move</div><div class="v">${fmtSpent(P[me].avgSpent)}</div></div>
      <div class="stat"><div class="k">Opponent avg</div><div class="v">${fmtSpent(oppAvg)}</div></div>
      <div class="stat"><div class="k">Errors in under 3 s</div><div class="v">${P[me].rushedErrors}</div></div>
      <div class="stat"><div class="k">Errors low on time</div><div class="v">${P[me].lowClockErrors}</div></div>
    </div>${lastMine ? `<p class="muted small" style="margin-top:8px">Your clock at the end: ${fmtClock(lastMine.clock)}</p>` : ''}`;
  } else {
    $('#rv-time-card').hidden = true;
  }

  $$('.seg-mini button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === me)));
  $$('#pane-report [data-ply]').forEach((b) => b.addEventListener('click', () => goToPly(+b.dataset.ply)));
}

function explain(p) {
  const w = p.why;
  if (!w) return '';
  const line = w.line && w.line.length ? fmtLine(w.line, w.lineFrom === 'after' ? p.fenAfter : p.fenBefore) : '';
  const lead = p.cls === 'miss' ? 'Your opponent had just made a mistake. ' : '';
  const best = p.best ? p.best.san : 'the engine move';
  switch (w.cat) {
    case 'hung': return `${lead}${p.san} leaves material hanging: ${line} wins ${points(w.amount)}.`;
    case 'tactic': return `${lead}${p.san} walks into a tactic: ${line} wins ${points(w.amount)}.`;
    case 'missed_tactic': return `${lead}${best} would have won ${points(w.amount)}: ${line}.`;
    case 'missed_mate': return `${lead}${best} starts a forced checkmate in ${w.mateIn}: ${line}.`;
    case 'allowed_mate': return `${p.san} allows checkmate in ${w.mateIn}: ${line}.`;
    default:
      if (p.cls === 'miss') return `Your opponent had just made a mistake, and ${best} would have punished it. ${p.san} gives away ${Math.round(p.loss)}% winning chances.`;
      if (w.cat === 'endgame') return `No material is lost right away, but ${p.san} gives away ${Math.round(p.loss)}% winning chances in this endgame. ${best} keeps more.`;
      return `No material is lost right away, but ${p.san} gives away ${Math.round(p.loss)}% winning chances. The engine prefers ${best}.`;
  }
}

function buildMoveList() {
  const r = state.record.report;
  let html = '', open = false;
  const btn = (p) => {
    const showGlyph = ['great', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(p.cls);
    return `<button class="mv" type="button" data-k="${p.i + 1}" style="--c: var(--c-${p.cls})">${esc(p.san)}${showGlyph ? `<span class="glyph">${CLASSES[p.cls].glyph}</span>` : ''}</button>`;
  };
  for (const p of r.plies) {
    if (p.color === 'w') {
      if (open) html += '<span></span>';
      html += `<span class="no">${p.moveNo}.</span>${btn(p)}`;
      open = true;
    } else {
      if (!open) html += `<span class="no">${p.moveNo}.</span><span></span>`;
      html += btn(p);
      open = false;
    }
  }
  if (open) html += '<span></span>';
  const el = $('#movelist');
  el.innerHTML = html;
  el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => setCur(+b.dataset.k)));
  state.builtList = state.record.id;
}

function setCur(k) {
  const n = state.record.report.plies.length;
  state.cur = Math.max(0, Math.min(n, k));
  renderMoves();
}

function renderMoves() {
  const r = state.record.report;
  if (state.builtList !== state.record.id) buildMoveList();
  const k = state.cur;
  const p = k > 0 ? r.plies[k - 1] : null;
  const fen = p ? p.fenAfter : state.game.startFen;
  const showBest = p && p.best && p.best.uci !== p.uci && !['best', 'great', 'forced', 'excellent'].includes(p.cls);
  renderBoard($('#board'), {
    fen, flipped: state.flipped,
    lastMove: p ? { from: p.from, to: p.to } : null,
    cls: p ? p.cls : null,
    bestMove: showBest ? p.best.uci : null,
  });
  const pos = r.positions[k];
  renderEvalBar($('#evalbar'), { winWhite: pos.winWhite, label: shortEval(pos.eval), flipped: state.flipped });

  const info = $('#move-info');
  if (!p) {
    info.innerHTML = `<div class="headline">Starting position</div><div class="evals">Eval ${fmtEval(pos.eval)}</div><div class="explain">Step through the game with the arrows, swipe on the board, or tap any move below.</div>`;
  } else {
    const c = CLASSES[p.cls];
    const isMine = p.color === r.userColor;
    const what = p.cls === 'best' ? 'the best move' : p.cls === 'forced' ? 'the only legal move'
      : `${/^[aeiou]/i.test(c.label) ? 'an' : 'a'} ${c.label.toLowerCase()}`;
    const timeBits = [];
    if (p.spent != null) timeBits.push(`thought ${fmtSpent(p.spent)}`);
    if (p.clock != null) timeBits.push(`clock ${fmtClock(p.clock)}`);
    const lineFen = p.fenBefore;
    info.innerHTML = `
      <div class="headline">${badge(p.cls)}${esc(moveLabel(p))} is ${what}</div>
      <div class="evals">${isMine ? 'Your move' : "Opponent's move"} · eval ${fmtEval(r.positions[k - 1].eval)} → ${fmtEval(pos.eval)}${timeBits.length ? ' · ' + timeBits.join(', ') : ''}</div>
      ${p.why ? `<div class="explain">${esc(explain(p))}</div>` : ''}
      ${p.best && p.best.uci !== p.uci ? `<div class="line"><b>Best: ${esc(p.best.san)}</b>${p.bestLine.length > 1 ? ' · ' + esc(fmtLine(p.bestLine, lineFen)) : ''}</div>`
        : p.bestLine.length > 1 ? `<div class="line">Engine line: ${esc(fmtLine(p.bestLine, lineFen))}</div>` : ''}`;
  }

  renderGraph($('#mv-graph'), { positions: r.positions, plies: r.plies, cur: k, userColor: r.userColor, onSelect: setCur, height: 64 });

  $$('#movelist .mv').forEach((b) => {
    const on = +b.dataset.k === k;
    b.setAttribute('aria-current', String(on));
    if (on && state.view === 'review') b.scrollIntoView({ block: 'nearest' });
  });
}

async function changeColor(color) {
  const rec = state.record;
  if (!rec || !rec.report || rec.userColor === color) return;
  rec.userColor = color;
  rec.report.userColor = color;
  rec.report.summary = summarize(state.game, rec.report.plies, rec.report.positions, color);
  rec.tips = gameTips(rec.report, rec.opening);
  state.flipped = color === 'b';
  try { await games.put(rec); } catch { /* keep the change for this session */ }
  renderReviewHeader();
  renderReport();
}

/* ---------- insights ---------- */

async function renderInsights() {
  const el = $('#insights');
  const list = await games.all().catch(() => []);
  const t = trends(list);
  if (!t) {
    el.innerHTML = '<div class="empty">Analyze a few games and your recurring patterns will show up here.</div>';
    return;
  }
  const phaseNames = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };
  const issues = t.issues.length
    ? t.issues.map((it) => `<div class="issue"><b>${esc(it.title)}</b><span class="freq">In ${it.gamesWith} of ${t.games} game${t.games === 1 ? '' : 's'} · ${it.total} time${it.total === 1 ? '' : 's'}</span><p>${esc(it.body)}</p></div>`).join('')
    : '<p class="muted small">No recurring problems yet.</p>';
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="k">Games analyzed</div><div class="v">${t.games}</div><div class="k">${t.record.win}W · ${t.record.loss}L · ${t.record.draw}D</div></div>
      <div class="stat"><div class="k">Average accuracy</div><div class="v">${fmtAcc(t.accuracy)}%</div></div>
      <div class="stat"><div class="k">Blunders per game</div><div class="v">${t.blunders.toFixed(1)}</div></div>
      <div class="stat"><div class="k">Mistakes per game</div><div class="v">${t.mistakes.toFixed(1)}</div></div>
    </div>
    <div class="card"><h3>Accuracy per game</h3><div id="trend-chart" class="graph"></div></div>
    <div class="card"><h3>Fix these first</h3>${issues}</div>
    <div class="card"><h3>Average accuracy by phase</h3>${Object.keys(phaseNames).map((ph) => t.phaseAvg[ph] == null ? '' :
      `<div class="phase-row"><span class="small">${phaseNames[ph]}</span><div class="hbar"><div class="track"><div class="fill" style="width:${Math.max(2, t.phaseAvg[ph])}%"></div></div><span>${t.phaseAvg[ph].toFixed(0)}%</span></div></div>`).join('')}</div>`;
  renderTrendChart($('#trend-chart'), t.series);
}

/* ---------- settings ---------- */

async function renderSettings() {
  $('#set-username').value = state.settings.username;
  const radio = $(`#preset-${state.settings.preset}`);
  if (radio) radio.checked = true;
  const list = await games.all().catch(() => []);
  $('#storage-info').textContent = `${list.length} analyzed game${list.length === 1 ? '' : 's'} stored on this device only.`;
  const btn = $('#btn-clear');
  btn.textContent = 'Delete all analyzed games';
  btn.dataset.armed = '';
}

/* ---------- wiring ---------- */

function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  $('#btn-paste').addEventListener('click', async () => {
    hideError();
    try {
      const text = await navigator.clipboard.readText();
      handleText(text);
    } catch {
      $('#manual').hidden = false;
      $('#pgn-input').focus();
      showError('Clipboard access was blocked. Paste the game into the box below instead.');
    }
  });
  $('#btn-manual').addEventListener('click', () => {
    $('#manual').hidden = !$('#manual').hidden;
    if (!$('#manual').hidden) $('#pgn-input').focus();
  });
  $('#btn-analyze-text').addEventListener('click', () => handleText($('#pgn-input').value));
  $('#file-pgn').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    handleText(await f.text());
    e.target.value = '';
  });
  $('#btn-refresh').addEventListener('click', () => renderRecent(true));

  $('#btn-back').addEventListener('click', () => show('home'));
  $('#btn-cancel').addEventListener('click', () => {
    if (state.job) { state.job.controller.abort(); state.engine.stop(); state.job = null; }
    show('home');
  });
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => setPane(b.dataset.pane)));
  $$('.seg-mini button').forEach((b) => b.addEventListener('click', () => changeColor(b.dataset.color)));

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const n = state.record.report.plies.length;
    const a = b.dataset.nav;
    if (a === 'first') setCur(0);
    else if (a === 'prev') setCur(state.cur - 1);
    else if (a === 'next') setCur(state.cur + 1);
    else if (a === 'last') setCur(n);
    else if (a === 'flip') { state.flipped = !state.flipped; renderMoves(); }
  }));
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'review' || state.pane !== 'moves' || !state.record || !state.record.report) return;
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') { setCur(state.cur - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setCur(state.cur + 1); e.preventDefault(); }
  });
  let touchX = null;
  $('#board').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#board').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) setCur(state.cur + (dx < 0 ? 1 : -1));
  });

  $('#set-username').addEventListener('change', (e) => {
    state.settings.username = e.target.value.trim();
    saveSettings(state.settings);
    state.recent = null;
    toast(state.settings.username ? 'Username saved.' : 'Username cleared.');
  });
  $$('input[name="preset"]').forEach((r) => r.addEventListener('change', () => {
    state.settings.preset = r.value;
    saveSettings(state.settings);
  }));
  $('#btn-clear').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to delete everything';
      return;
    }
    await games.clear().catch(() => {});
    toast('All analyzed games deleted.');
    renderSettings();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'review' && state.record && state.record.report) setPane(state.pane);
      if (state.view === 'insights') renderInsights();
    }, 150);
  });
}

// Shortcut / link support: …/#pgn=<url-encoded PGN> or …/#text=<shared text>
function handleLaunchHash() {
  const h = location.hash;
  const m = /^#(pgn|text)=(.+)$/s.exec(h);
  if (!m) return;
  let text = '';
  try { text = decodeURIComponent(m[2]); } catch { text = m[2]; }
  history.replaceState(null, '', location.pathname + location.search);
  handleText(text);
}

async function init() {
  bind();
  try { await loadPieces(); } catch { toast('Could not load the chess pieces.'); }
  show('home');
  handleLaunchHash();
  window.addEventListener('hashchange', handleLaunchHash);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
