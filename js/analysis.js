// Turns engine evaluations into a move-by-move review: grades, accuracy, phases, clock use,
// opening book, opponent threats and an explanation for every error.
// Raw engine output (evals) is stored with each game so reports can be rebuilt without the engine.

import { Chess, DEFAULT_POSITION } from '../vendor/chess.js';
import { explainError, playLine } from './explain.js';
import { nullMoveFen } from './motifs.js';
import { identifyOpening, epd } from './openings.js';

export const REPORT_VERSION = 2;

export const CLASSES = {
  book:       { label: 'Book',       glyph: '≡' },
  great:      { label: 'Great',      glyph: '!' },
  best:       { label: 'Best',       glyph: '★' },
  excellent:  { label: 'Excellent',  glyph: '✓' },
  good:       { label: 'Good',       glyph: '✓' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!' },
  mistake:    { label: 'Mistake',    glyph: '?' },
  miss:       { label: 'Miss',       glyph: '×' },
  blunder:    { label: 'Blunder',    glyph: '??' },
  forced:     { label: 'Forced',     glyph: '→' },
};
export const CLASS_ORDER = ['book', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

export const PRESETS = {
  fast:     { depth: 11, movetime: 1200, label: 'Fast' },
  balanced: { depth: 14, movetime: 2500, label: 'Balanced' },
  deep:     { depth: 18, movetime: 6000, label: 'Deep' },
};

// Win probability (0–100) for the side to move, Lichess formula.
export function winPercent(line) {
  if (!line) return 50;
  if (line.type === 'mate') return line.score > 0 ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, line.score));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

const sideToMove = (fen) => fen.split(' ')[1];

// Converts a line's score (side-to-move view) to White's view.
export function lineToWhite(line, stm) {
  const sign = stm === 'w' ? 1 : -1;
  if (line.type === 'mate') {
    if (line.score === 0) return { type: 'mate', score: 0, winner: stm === 'w' ? 'b' : 'w' };
    return { type: 'mate', score: sign * line.score };
  }
  return { type: 'cp', score: sign * line.score };
}

function pieceCount(fen) {
  let n = 0;
  for (const ch of fen.split(' ')[0]) if ('nbrqNBRQ'.includes(ch)) n++;
  return n;
}

function phaseOf(fen) {
  const pieces = pieceCount(fen);
  const fullmove = +fen.split(' ')[5] || 1;
  if (pieces <= 6) return 'endgame';
  if (fullmove <= 12 && pieces > 10) return 'opening';
  return 'middlegame';
}

export async function evaluatePosition(engine, fen, { depth, movetime, multipv = 3, cache = null } = {}) {
  const c = new Chess(fen);
  const legal = c.moves().length;
  if (c.isCheckmate()) return { terminal: 'mate', legal: 0, lines: [{ type: 'mate', score: 0, pv: [] }] };
  if (legal === 0 || c.isStalemate() || c.isInsufficientMaterial()) {
    return { terminal: 'draw', legal, lines: [{ type: 'cp', score: 0, pv: [] }] };
  }
  const key = `${epd(fen)}|d${depth}|m${multipv}`;
  if (cache) {
    const hit = await cache.get(key);
    if (hit) return { ...hit, legal };
  }
  const res = await engine.analyse(fen, { depth, movetime, multipv });
  const lines = res.lines.map((l) => ({ type: l.type, score: l.score, pv: l.pv.slice(0, 12) }));
  const out = { legal, depth: res.depth, lines: lines.length ? lines : [{ type: 'cp', score: 0, pv: res.bestmove ? [res.bestmove] : [] }] };
  if (cache && lines.length) cache.set(key, { depth: out.depth, lines: out.lines });
  return out;
}

function classify(game, evals) {
  return game.moves.map((m, i) => {
    const before = evals[i], after = evals[i + 1];
    const winBefore = winPercent(before.lines[0]);
    const winAfter = 100 - winPercent(after.lines[0]);
    const loss = Math.max(0, winBefore - winAfter);
    const bestUci = before.lines[0] && before.lines[0].pv[0];
    const gap = before.lines[1] ? winBefore - winPercent(before.lines[1]) : 0;
    return { winBefore, winAfter, loss, bestUci, isBest: bestUci === m.uci, gap };
  });
}

// opts: { preset, userColor, onProgress, signal, cache, resume, onCheckpoint, openings }
export async function analyzeGame(game, engine, opts = {}) {
  const { preset = 'balanced', userColor = 'w', onProgress, signal, cache, resume, onCheckpoint, openings } = opts;
  const P = PRESETS[preset] || PRESETS.balanced;
  const check = () => { if (signal && signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError'); };
  const fens = [game.startFen, ...game.moves.map((m) => m.after)];
  const evals = resume && resume.length === fens.length ? resume.slice() : new Array(fens.length).fill(null);
  const t0 = performance.now();
  const progress = (phase, done, total) => onProgress && onProgress({ phase, done, total, elapsed: performance.now() - t0 });

  await engine.newGame();
  let done = evals.filter(Boolean).length;
  for (let i = 0; i < fens.length; i++) {
    if (evals[i]) continue;
    check();
    evals[i] = await evaluatePosition(engine, fens[i], { depth: P.depth, movetime: P.movetime, cache });
    done++;
    progress('scan', done, fens.length);
    if (onCheckpoint && done % 10 === 0) await onCheckpoint(evals);
  }

  const book = openings && epd(game.startFen) === epd(DEFAULT_POSITION)
    ? identifyOpening(openings, game.moves.map((m) => m.after))
    : { eco: '', name: '', bookPlies: 0 };

  // Second pass: re-check suspected errors and "only move" candidates deeper.
  const first = classify(game, evals);
  const deepen = new Set();
  first.forEach((x, i) => {
    if (i < book.bookPlies) return;
    if (x.loss >= 5) { deepen.add(i); deepen.add(i + 1); } else if (x.isBest && x.gap >= 15) deepen.add(i);
  });
  const recheck = [...deepen].filter((k) => !evals[k].terminal && !evals[k].deep);
  for (let n = 0; n < recheck.length; n++) {
    check();
    const k = recheck[n];
    evals[k] = { ...(await evaluatePosition(engine, fens[k], { depth: P.depth + 4, movetime: P.movetime * 2, cache })), deep: true };
    progress('deep', n + 1, recheck.length);
  }

  // Opponent threats before each error (null-move search).
  const threats = {};
  const second = classify(game, evals);
  const errors = second.map((x, i) => (x.loss >= 5 && i >= book.bookPlies ? i : -1)).filter((i) => i >= 0);
  for (let n = 0; n < errors.length; n++) {
    check();
    const i = errors[n];
    const nf = nullMoveFen(fens[i]);
    if (nf) {
      const r = await evaluatePosition(engine, nf, { depth: 12, movetime: 1500, multipv: 1, cache });
      if (r.lines[0] && r.lines[0].pv.length) threats[i] = r.lines[0];
    }
    progress('threats', n + 1, errors.length);
  }

  const extra = { book, threats };
  return { report: buildReport(game, evals, userColor, preset, extra), evals, extra };
}

export function buildReport(game, evals, userColor, preset, extra = {}) {
  const tc = game.timeControl;
  const base = tc && !tc.daily ? tc.base : null;
  const inc = (tc && tc.inc) || 0;
  const lastClock = { w: base, b: base };
  const book = extra.book || { eco: '', name: '', bookPlies: 0 };
  const threats = extra.threats || {};
  const cls0 = classify(game, evals);
  const plies = [];

  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    const before = evals[i];
    const { winBefore, winAfter, loss, bestUci, isBest, gap } = cls0[i];

    let cls;
    if (i < book.bookPlies) cls = 'book';
    else if (before.legal === 1) cls = 'forced';
    else if (isBest) cls = 'best';
    else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';

    // Allowing a short forced mate is always worth flagging, even in a lost position.
    const afterLine = evals[i + 1].lines[0];
    const allowsMate = afterLine && afterLine.type === 'mate' && afterLine.score > 0 && afterLine.score <= 3;
    const alreadyMated = before.lines[0] && before.lines[0].type === 'mate' && before.lines[0].score < 0;
    if (allowsMate && !alreadyMated && ['excellent', 'good', 'inaccuracy'].includes(cls)) cls = winBefore >= 20 ? 'blunder' : 'mistake';

    if (cls === 'best' && before.lines[1]) {
      const prev = game.moves[i - 1];
      const recapture = prev && prev.captured && prev.to === m.to && m.captured;
      if (gap >= 20 && winBefore >= 30 && winBefore <= 97 && !recapture) cls = 'great';
    }

    let spent = null;
    const clock = m.clock;
    if (clock != null && lastClock[m.color] != null) {
      spent = Math.max(0, lastClock[m.color] + inc - clock);
      lastClock[m.color] = clock;
    }

    const stm = m.color;
    const alts = before.lines.slice(0, 3).map((l) => {
      const pl = playLine(m.before, l.pv, 1);
      return pl.sans[0] ? { uci: l.pv[0], san: pl.sans[0], eval: lineToWhite(l, stm) } : null;
    }).filter(Boolean);
    const bestLine = playLine(m.before, before.lines[0] ? before.lines[0].pv : [], 8);

    plies.push({
      i,
      color: m.color,
      moveNo: +m.before.split(' ')[5] || Math.floor(i / 2) + 1,
      san: m.san, uci: m.uci, from: m.from, to: m.to, captured: m.captured,
      fenBefore: m.before, fenAfter: m.after,
      winBefore, winAfter, loss, gap,
      acc: moveAccuracy(loss),
      cls,
      best: bestUci ? { uci: bestUci, san: bestLine.sans[0] || bestUci } : null,
      bestLine: bestLine.sans,
      bestPv: before.lines[0] ? before.lines[0].pv.slice(0, 8) : [],
      alts,
      phase: phaseOf(m.before),
      critical: gap >= 20 && cls !== 'book',
      clock, spent,
    });
  }

  for (let k = 1; k < plies.length; k++) {
    const p = plies[k], prev = plies[k - 1];
    if ((p.cls === 'inaccuracy' || p.cls === 'mistake') && prev.loss >= 10 && prev.cls !== 'book' && p.winBefore >= 50) p.cls = 'miss';
  }

  for (const p of plies) {
    if (ERROR_CLASSES.has(p.cls)) p.why = explainError(p, evals[p.i], evals[p.i + 1], threats[p.i]);
    if (p.clock != null && base) p.lowClock = p.clock < Math.max(10, base * 0.1);
  }

  const positions = evals.map((ev, i) => {
    const fen = i === 0 ? game.startFen : game.moves[i - 1].after;
    const stm = sideToMove(fen);
    const w = winPercent(ev.lines[0]);
    return { eval: lineToWhite(ev.lines[0], stm), winWhite: stm === 'w' ? w : 100 - w };
  });

  return {
    version: REPORT_VERSION,
    preset,
    userColor,
    opening: book,
    plies,
    positions,
    summary: summarize(game, plies, positions, userColor),
  };
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function gameAccuracy(accs) {
  if (!accs.length) return null;
  const m = mean(accs);
  const h = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return (m + h) / 2;
}

export function summarize(game, plies, positions, userColor) {
  const out = { players: {} };
  for (const color of ['w', 'b']) {
    const mine = plies.filter((p) => p.color === color);
    const counted = mine.filter((p) => p.cls !== 'forced' && p.cls !== 'book');
    const counts = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));
    for (const p of mine) if (counts[p.cls] != null) counts[p.cls]++;
    const phases = {};
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const xs = counted.filter((p) => p.phase === ph).map((p) => p.acc);
      phases[ph] = xs.length ? { acc: gameAccuracy(xs), moves: xs.length } : null;
    }
    const cats = {}, themes = {}, motifs = {}, lostPieces = {};
    const serious = mine.filter((p) => ['mistake', 'blunder', 'miss'].includes(p.cls));
    for (const p of mine) {
      if (!p.why) continue;
      cats[p.why.cat] = (cats[p.why.cat] || 0) + 1;
      if (p.cls === 'inaccuracy') continue;
      themes[p.why.theme] = (themes[p.why.theme] || 0) + 1;
      const mt = p.why.motifs && p.why.motifs[0] && p.why.motifs[0].type;
      if (mt) motifs[mt] = (motifs[mt] || 0) + 1;
      if (p.why.lostPiece) lostPieces[p.why.lostPiece] = (lostPieces[p.why.lostPiece] || 0) + 1;
    }
    const critical = mine.filter((p) => (p.critical || serious.includes(p)) && p.spent != null);
    out.players[color] = {
      accuracy: gameAccuracy(counted.map((p) => p.acc)),
      counts,
      phases,
      categories: cats,
      themes,
      motifs,
      lostPieces,
      errorMoves: serious.map((p) => p.moveNo),
      rushedErrors: serious.filter((p) => p.spent != null && p.spent < 3).length,
      lowClockErrors: serious.filter((p) => p.lowClock).length,
      avgSpent: mean(mine.filter((p) => p.spent != null).map((p) => p.spent)),
      criticalSpent: mean(critical.map((p) => p.spent)),
      moves: mine.length,
    };
  }

  const res = game.headers.Result;
  const userWon = (res === '1-0' && userColor === 'w') || (res === '0-1' && userColor === 'b');
  const userLost = (res === '1-0' && userColor === 'b') || (res === '0-1' && userColor === 'w');
  out.result = userWon ? 'win' : userLost ? 'loss' : res === '1/2-1/2' ? 'draw' : 'unknown';

  const userWins = positions.map((p) => (userColor === 'w' ? p.winWhite : 100 - p.winWhite));
  let peak = { win: 0, ply: 0 }, trough = { win: 100, ply: 0 };
  userWins.forEach((w, k) => {
    if (w > peak.win) peak = { win: w, ply: k };
    if (k > 0 && w < trough.win) trough = { win: w, ply: k };
  });
  out.peak = peak;
  out.trough = trough;
  out.blewWin = peak.win >= 85 && out.result !== 'win' && out.result !== 'unknown';
  out.savedLoss = trough.win <= 15 && (out.result === 'win' || out.result === 'draw');
  return out;
}
