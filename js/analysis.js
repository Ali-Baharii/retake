// Turns engine evaluations into a move-by-move review: classifications, accuracy,
// game phases, clock usage and a short explanation for every error.

import { Chess } from '../vendor/chess.js';

export const CLASSES = {
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
export const CLASS_ORDER = ['great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

export const PRESETS = {
  fast:     { depth: 11, movetime: 1200, label: 'Fast' },
  balanced: { depth: 14, movetime: 2500, label: 'Balanced' },
  deep:     { depth: 18, movetime: 6000, label: 'Deep' },
};

export const CATEGORY_TEXT = {
  hung:          'Left material hanging',
  tactic:        'Walked into a tactic',
  missed_tactic: 'Missed a winning tactic',
  missed_mate:   'Missed a checkmate',
  allowed_mate:  'Allowed a checkmate',
  positional:    'Positional error',
  endgame:       'Endgame technique',
};

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

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

function sideToMove(fen) {
  return fen.split(' ')[1];
}

// Evaluation from White's point of view, for display and the graph.
function whiteEval(ev, fen) {
  const stm = sideToMove(fen);
  const line = ev.lines[0];
  const sign = stm === 'w' ? 1 : -1;
  if (line.type === 'mate') {
    if (line.score === 0) return { type: 'mate', score: 0, winner: stm === 'w' ? 'b' : 'w' };
    return { type: 'mate', score: sign * line.score };
  }
  return { type: 'cp', score: sign * line.score };
}

function material(fen) {
  let w = 0, b = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = VALUE[ch.toLowerCase()];
    if (!v) continue;
    if (ch === ch.toUpperCase()) w += v; else b += v;
  }
  return { w, b };
}

function balance(fen, color) {
  const m = material(fen);
  return color === 'w' ? m.w - m.b : m.b - m.w;
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

// Plays up to n engine moves (UCI) from a position; returns positions, SAN and the moves.
export function playLine(fen, pv, n = 6) {
  const c = new Chess(fen);
  const fens = [fen], sans = [], moves = [];
  for (const u of (pv || []).slice(0, n)) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      fens.push(c.fen()); sans.push(m.san); moves.push(m);
    } catch {
      break;
    }
  }
  return { fens, sans, moves };
}

function settled(fens, color) {
  const k = fens.length - 1;
  return balance(fens[k - (k % 2)], color);
}

export async function evaluatePosition(engine, fen, opts) {
  const c = new Chess(fen);
  const legal = c.moves().length;
  if (c.isCheckmate()) return { terminal: 'mate', legal: 0, lines: [{ type: 'mate', score: 0, pv: [] }] };
  if (legal === 0 || c.isStalemate() || c.isInsufficientMaterial()) {
    return { terminal: 'draw', legal, lines: [{ type: 'cp', score: 0, pv: [] }] };
  }
  const res = await engine.analyse(fen, opts);
  const lines = res.lines.length ? res.lines : [{ type: 'cp', score: 0, pv: res.bestmove ? [res.bestmove] : [] }];
  return { legal, lines };
}

export async function analyzeGame(game, engine, { preset = 'balanced', userColor = 'w', onProgress, signal } = {}) {
  const opts = PRESETS[preset] || PRESETS.balanced;
  await engine.start();
  await engine.newGame();
  const fens = [game.startFen, ...game.moves.map((m) => m.after)];
  const evals = [];
  const t0 = performance.now();
  for (let i = 0; i < fens.length; i++) {
    if (signal && signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    evals.push(await evaluatePosition(engine, fens[i], opts));
    if (onProgress) onProgress({ done: i + 1, total: fens.length, elapsed: performance.now() - t0 });
  }
  return buildReport(game, evals, userColor, preset);
}

function explainError(p, before, after, mover) {
  const l0 = before.lines[0];
  const a0 = after.lines[0];
  const fenBefore = p.fenBefore, fenAfter = p.fenAfter;

  if (a0 && a0.type === 'mate' && a0.score > 0 && !(l0.type === 'mate' && l0.score < 0)) {
    return { cat: 'allowed_mate', mateIn: a0.score, line: playLine(fenAfter, a0.pv, 6).sans, lineFrom: 'after' };
  }
  if (l0 && l0.type === 'mate' && l0.score > 0 && !(a0 && a0.type === 'mate' && a0.score < 0)) {
    return { cat: 'missed_mate', mateIn: l0.score, line: playLine(fenBefore, l0.pv, 6).sans, lineFrom: 'before' };
  }
  const start = balance(fenBefore, mover);
  const reply = playLine(fenAfter, a0 ? a0.pv : [], 4);
  const afterBal = settled(reply.fens, mover);
  const drop = start - afterBal;
  if (drop >= 2) {
    const first = reply.moves[0];
    return { cat: first && first.captured ? 'hung' : 'tactic', amount: drop, line: reply.sans, lineFrom: 'after' };
  }
  const bestLine = playLine(fenBefore, l0 ? l0.pv : [], 4);
  const gain = settled(bestLine.fens, mover) - start;
  if (gain >= 2 && gain - (afterBal - start) >= 2) {
    return { cat: 'missed_tactic', amount: gain, line: bestLine.sans, lineFrom: 'before' };
  }
  return { cat: p.phase === 'endgame' ? 'endgame' : 'positional', line: playLine(fenBefore, l0 ? l0.pv : [], 6).sans, lineFrom: 'before' };
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

export function buildReport(game, evals, userColor, preset) {
  const tc = game.timeControl;
  const base = tc && !tc.daily ? tc.base : null;
  const inc = (tc && tc.inc) || 0;
  const lastClock = { w: base, b: base };
  const plies = [];

  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    const before = evals[i], after = evals[i + 1];
    const mover = m.color;
    const winBefore = winPercent(before.lines[0]);
    const winAfter = 100 - winPercent(after.lines[0]);
    const loss = Math.max(0, winBefore - winAfter);
    const bestUci = before.lines[0] && before.lines[0].pv[0];
    const second = before.lines[1];

    let cls;
    if (before.legal === 1) cls = 'forced';
    else if (bestUci === m.uci) cls = 'best';
    else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';

    if (cls === 'best' && second) {
      const gap = winBefore - winPercent(second);
      const prev = game.moves[i - 1];
      const recapture = prev && prev.captured && prev.to === m.to && m.captured;
      if (gap >= 20 && winBefore >= 30 && winBefore <= 97 && !recapture) cls = 'great';
    }

    let spent = null, clock = m.clock;
    if (clock != null && lastClock[mover] != null) {
      spent = Math.max(0, lastClock[mover] + inc - clock);
      lastClock[mover] = clock;
    }

    const bestLine = playLine(m.before, before.lines[0] ? before.lines[0].pv : [], 6);
    plies.push({
      i,
      color: mover,
      moveNo: +m.before.split(' ')[5] || Math.floor(i / 2) + 1,
      san: m.san, uci: m.uci, from: m.from, to: m.to,
      fenBefore: m.before, fenAfter: m.after,
      winBefore, winAfter, loss,
      acc: moveAccuracy(loss),
      cls,
      best: bestUci ? { uci: bestUci, san: bestLine.sans[0] || bestUci } : null,
      bestLine: bestLine.sans,
      phase: phaseOf(m.before),
      clock, spent,
    });
  }

  // A "miss" is failing to punish the opponent's mistake.
  for (let k = 1; k < plies.length; k++) {
    const p = plies[k], prev = plies[k - 1];
    if ((p.cls === 'inaccuracy' || p.cls === 'mistake') && prev.loss >= 10 && p.winBefore >= 50) p.cls = 'miss';
  }

  for (const p of plies) {
    if (ERROR_CLASSES.has(p.cls)) p.why = explainError(p, evals[p.i], evals[p.i + 1], p.color);
    if (p.clock != null && base) p.lowClock = p.clock < Math.max(10, base * 0.1);
  }

  const positions = evals.map((ev, i) => {
    const fen = i === 0 ? game.startFen : game.moves[i - 1].after;
    const stm = sideToMove(fen);
    const w = winPercent(ev.lines[0]);
    return { eval: whiteEval(ev, fen), winWhite: stm === 'w' ? w : 100 - w };
  });

  const report = {
    version: 1,
    preset,
    userColor,
    plies,
    positions,
    summary: summarize(game, plies, positions, userColor),
  };
  return report;
}

export function summarize(game, plies, positions, userColor) {
  const out = { players: {} };
  for (const color of ['w', 'b']) {
    const mine = plies.filter((p) => p.color === color);
    const counted = mine.filter((p) => p.cls !== 'forced');
    const counts = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));
    for (const p of mine) if (counts[p.cls] != null) counts[p.cls]++;
    const phases = {};
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const xs = counted.filter((p) => p.phase === ph).map((p) => p.acc);
      phases[ph] = xs.length ? { acc: gameAccuracy(xs), moves: xs.length } : null;
    }
    const cats = {};
    for (const p of mine) if (p.why) cats[p.why.cat] = (cats[p.why.cat] || 0) + 1;
    const spentErrors = mine.filter((p) => ['mistake', 'blunder', 'miss'].includes(p.cls));
    out.players[color] = {
      accuracy: gameAccuracy(counted.map((p) => p.acc)),
      counts,
      phases,
      categories: cats,
      rushedErrors: spentErrors.filter((p) => p.spent != null && p.spent < 3).length,
      lowClockErrors: spentErrors.filter((p) => p.lowClock).length,
      avgSpent: mean(mine.filter((p) => p.spent != null).map((p) => p.spent)),
      moves: mine.length,
    };
  }

  const res = game.headers.Result;
  const userWon = (res === '1-0' && userColor === 'w') || (res === '0-1' && userColor === 'b');
  const userLost = (res === '1-0' && userColor === 'b') || (res === '0-1' && userColor === 'w');
  out.result = userWon ? 'win' : userLost ? 'loss' : res === '1/2-1/2' ? 'draw' : 'unknown';

  const userWins = positions.map((p) => (userColor === 'w' ? p.winWhite : 100 - p.winWhite));
  let peak = { win: 0, ply: 0 };
  userWins.forEach((w, k) => { if (w > peak.win) peak = { win: w, ply: k }; });
  out.peak = peak;
  out.blewWin = peak.win >= 85 && out.result !== 'win' && out.result !== 'unknown';
  return out;
}
