// Personal puzzles from your own games, scheduled with spaced repetition (simplified SM-2).

import { Chess } from '../vendor/chess.js';
import { ERROR_CLASSES } from './analysis.js';
import { LESSONS } from './explain.js';
import { MOTIF_TEXT } from './motifs.js';

const DAY = 86400000;

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newSrs() {
  return { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: null, seen: false };
}

// result: { solved, firstTry, hints, revealed, partial, ms }
export function gradeResult(r) {
  if (!r.solved || r.revealed) return 'again';
  if (!r.firstTry || r.hints > 0 || r.partial) return 'hard';
  if (r.ms != null && r.ms < 8000) return 'easy';
  return 'good';
}

export function schedule(srs, grade, now = Date.now()) {
  const s = { ...newSrs(), ...srs, seen: true, last: now };
  if (grade === 'again') {
    s.lapses++;
    s.reps = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.interval = 1;
  } else if (grade === 'hard') {
    s.reps++;
    s.ease = Math.max(1.3, s.ease - 0.15);
    s.interval = Math.max(1, Math.round((s.interval || 1) * 1.2));
  } else {
    const base = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(s.interval * s.ease);
    s.reps++;
    if (grade === 'easy') {
      s.ease += 0.15;
      s.interval = Math.max(2, Math.round(base * 1.3));
    } else {
      s.interval = Math.max(1, base);
    }
  }
  s.due = startOfDay(now) + s.interval * DAY;
  return s;
}

function isCheckOrCapture(c, uci) {
  const moves = c.moves({ verbose: true });
  const m = moves.find((x) => x.from === uci.slice(0, 2) && x.to === uci.slice(2, 4));
  return !!m && (!!m.captured || m.san.includes('+') || m.san.includes('#'));
}

// Solution moves: user, reply, user, ... (always ends on a user move).
function solutionFor(p) {
  const pv = p.bestPv || [];
  if (!pv.length) return [];
  const cat = p.why && p.why.cat;
  if (cat === 'missed_mate' && p.why.mateIn && p.why.mateIn <= 4) {
    const n = Math.min(pv.length, p.why.mateIn * 2 - 1);
    const c = new Chess(p.fenBefore);
    for (let k = 0; k < n; k++) c.move({ from: pv[k].slice(0, 2), to: pv[k].slice(2, 4), promotion: pv[k][4] });
    if (c.isCheckmate()) return pv.slice(0, n);
  }
  const sol = [pv[0]];
  if (cat === 'missed_tactic') {
    const c = new Chess(p.fenBefore);
    try {
      c.move({ from: pv[0].slice(0, 2), to: pv[0].slice(2, 4), promotion: pv[0][4] });
      for (let k = 1; k + 1 < pv.length && sol.length < 5; k += 2) {
        c.move({ from: pv[k].slice(0, 2), to: pv[k].slice(2, 4), promotion: pv[k][4] });
        if (!isCheckOrCapture(c, pv[k + 1])) break;
        c.move({ from: pv[k + 1].slice(0, 2), to: pv[k + 1].slice(2, 4), promotion: pv[k + 1][4] });
        sol.push(pv[k], pv[k + 1]);
      }
    } catch {
      return [pv[0]];
    }
  }
  return sol;
}

function themesFor(p) {
  const w = p.why;
  if (!w) return ['positional'];
  const out = [w.theme || 'positional'];
  const m = w.motifs && w.motifs[0] && w.motifs[0].type;
  if (w.theme === 'defense' && m && !out.includes(m)) out.push(m);
  return out;
}

export function hintFor(themes, cat) {
  const t = themes[0];
  if (t === 'defense') {
    const m = themes[1];
    return m ? `Your opponent has a ${(MOTIF_TEXT[m] || 'tactic').toLowerCase()} coming. Find the move that stops it.` : 'Your opponent has a threat. Find the move that deals with it.';
  }
  if (t === 'positional' || t === 'endgame') return cat === undefined ? 'Find the best move.' : 'No tactics here. Find the move that improves your position most.';
  return `Look for a ${(MOTIF_TEXT[t] || 'tactic').toLowerCase()}.`;
}

export function puzzleFromPly(record, p) {
  if (!p || !p.best || !p.bestPv || !p.bestPv.length) return null;
  const plies = record.report.plies;
  const prev = plies[p.i - 1];
  const sol = solutionFor(p);
  if (!sol.length) return null;
  const recapture = prev && prev.captured && sol.length === 1 && sol[0].slice(2, 4) === prev.to;
  if (recapture && !(p.why && /mate/.test(p.why.cat))) return null;
  const themes = themesFor(p);
  const h = record.headers || {};
  const me = p.color;
  return {
    id: `${record.id}#${p.i}`,
    gameId: record.id,
    ply: p.i,
    moveNo: p.moveNo,
    color: me,
    fen: p.fenBefore,
    solution: sol,
    bestSan: p.best.san,
    played: p.uci,
    playedSan: p.san,
    cls: p.cls,
    cat: p.why ? p.why.cat : null,
    winBefore: p.winBefore,
    altOk: p.gap <= 3,
    themes,
    hint: hintFor(themes, p.why && p.why.cat),
    lesson: LESSONS[themes[0]] || LESSONS.positional,
    opponent: me === 'w' ? h.Black : h.White,
    rating: +(me === 'w' ? h.WhiteElo : h.BlackElo) || null,
    createdAt: Date.now(),
    srs: newSrs(),
    attempts: [],
  };
}

export function extractPuzzles(record, { includeInaccuracies = false } = {}) {
  const r = record.report;
  if (!r) return [];
  const want = new Set(['mistake', 'blunder', 'miss']);
  if (includeInaccuracies) want.add('inaccuracy');
  return r.plies
    .filter((p) => p.color === r.userColor && want.has(p.cls) && ERROR_CLASSES.has(p.cls))
    .map((p) => puzzleFromPly(record, p))
    .filter(Boolean);
}

export function recordAttempt(puzzle, result, now = Date.now()) {
  const grade = gradeResult(result);
  const attempts = [...(puzzle.attempts || []), { t: now, solved: !!result.solved, firstTry: !!result.firstTry, hints: result.hints || 0, revealed: !!result.revealed, ms: result.ms || null, grade }].slice(-20);
  return { ...puzzle, attempts, srs: schedule(puzzle.srs, grade, now) };
}

// Today's session: due reviews first, then a capped number of new puzzles.
export function buildQueue(all, { now = Date.now(), newPerDay = 15, newSeenToday = 0, limit = 20 } = {}) {
  const due = all.filter((p) => p.srs && p.srs.seen && p.srs.due <= now).sort((a, b) => a.srs.due - b.srs.due);
  const fresh = all.filter((p) => !p.srs || !p.srs.seen).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(0, newPerDay - newSeenToday));
  return [...due, ...fresh].slice(0, limit);
}

export function themeQueue(all, theme, limit = 15) {
  return all.filter((p) => p.themes.includes(theme)).sort((a, b) => solveRate(a) - solveRate(b) || (a.srs.due || 0) - (b.srs.due || 0)).slice(0, limit);
}

function solveRate(p) {
  const a = p.attempts || [];
  return a.length ? a.filter((x) => x.firstTry && x.solved && !x.hints).length / a.length : 0;
}

export function themeStats(all) {
  const out = {};
  for (const p of all) {
    for (const t of p.themes.slice(0, 1)) {
      const s = (out[t] = out[t] || { theme: t, puzzles: 0, attempts: 0, clean: 0, due: 0 });
      s.puzzles++;
      if (p.srs && p.srs.seen && p.srs.due <= Date.now()) s.due++;
      for (const a of p.attempts || []) {
        s.attempts++;
        if (a.solved && a.firstTry && !a.hints) s.clean++;
      }
    }
  }
  return Object.values(out).map((s) => ({ ...s, rate: s.attempts ? s.clean / s.attempts : null })).sort((a, b) => b.puzzles - a.puzzles);
}

export function streak(days, today = dayKey()) {
  const set = new Set(days || []);
  let n = 0;
  const d = new Date();
  if (!set.has(today)) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
