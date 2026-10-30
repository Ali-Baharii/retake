// Recognizes the tactical pattern behind an engine line: forks, pins, skewers,
// discovered attacks, mates, removing the defender and more. Pure functions on chess.js.

import { Chess } from '../vendor/chess.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const MOTIF_TEXT = {
  'back-rank': 'Back-rank mate',
  smothered: 'Smothered mate',
  mate: 'Checkmate',
  fork: 'Fork',
  'double-check': 'Double check',
  'discovered-check': 'Discovered check',
  discovered: 'Discovered attack',
  pin: 'Pin',
  skewer: 'Skewer',
  'removing-defender': 'Removing the defender',
  overloaded: 'Overloaded defender',
  trapped: 'Trapped piece',
  hanging: 'Hanging piece',
  'bad-trade': 'Losing trade',
  promotion: 'Promotion',
  defense: 'Defending against a threat',
  positional: 'Positional play',
  endgame: 'Endgame technique',
};

const DIRS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
DIRS.q = [...DIRS.b, ...DIRS.r];

const FILES = 'abcdefgh';
const sqName = (f, r) => FILES[f] + (r + 1);
const sqXY = (sq) => [FILES.indexOf(sq[0]), +sq[1] - 1];
const other = (c) => (c === 'w' ? 'b' : 'w');

export function pieceLabel(p, sq) {
  return `${PIECE_NAME[p.type]} on ${sq}`;
}

function pieceList(c, color) {
  const out = [];
  for (const row of c.board()) for (const p of row) if (p && (!color || p.color === color)) out.push(p);
  return out;
}

function minValue(c, squares) {
  let m = Infinity;
  for (const s of squares) { const p = c.get(s); if (p) m = Math.min(m, VALUE[p.type]); }
  return m;
}

// A piece is hanging if it is attacked and either undefended or attacked by something cheaper.
export function isHanging(c, sq) {
  const p = c.get(sq);
  if (!p || p.type === 'k') return false;
  const att = c.attackers(sq, other(p.color));
  if (!att.length) return false;
  const def = c.attackers(sq, p.color);
  return !def.length || minValue(c, att) < VALUE[p.type];
}

export function hangingPieces(fen, color) {
  const c = new Chess(fen);
  return pieceList(c, color).filter((p) => p.type !== 'p' && isHanging(c, p.square)).map((p) => ({ square: p.square, type: p.type }));
}

// Pieces of `color` that hang after a move but didn't hang before it.
export function newlyHanging(fenBefore, fenAfter, color, movedTo) {
  const before = new Set(hangingPieces(fenBefore, color).map((p) => p.square));
  return hangingPieces(fenAfter, color).filter((p) => !before.has(p.square) || p.square === movedTo);
}

// Position with the same side to move flipped, to ask "what does the opponent threaten?"
export function nullMoveFen(fen) {
  const parts = fen.split(' ');
  const c = new Chess(fen);
  if (c.inCheck()) return null;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  if (parts[1] === 'w') parts[5] = String(+parts[5] + 1);
  try {
    const n = new Chess(parts.join(' '));
    return n.fen();
  } catch {
    return null;
  }
}

function tryMove(c, uci) {
  try {
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

function rays(c, from, type) {
  const out = [];
  const [f0, r0] = sqXY(from);
  for (const [df, dr] of DIRS[type] || []) {
    const seen = [];
    let f = f0 + df, r = r0 + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const s = sqName(f, r);
      const p = c.get(s);
      if (p) {
        seen.push({ ...p, square: s });
        if (seen.length === 2) break;
      }
      f += df; r += dr;
    }
    out.push(seen);
  }
  return out;
}

function mateShape(c, matedColor, mover) {
  const king = pieceList(c, matedColor).find((p) => p.type === 'k');
  if (!king) return 'mate';
  const [kf, kr] = sqXY(king.square);
  const checkers = c.attackers(king.square, mover).map((s) => ({ square: s, ...c.get(s) }));
  let ownBlocked = 0, around = 0;
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (!df && !dr) continue;
    const f = kf + df, r = kr + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    around++;
    const p = c.get(sqName(f, r));
    if (p && p.color === matedColor) ownBlocked++;
  }
  if (checkers.length === 1 && checkers[0].type === 'n' && ownBlocked === around) return 'smothered';
  const backRank = matedColor === 'w' ? 0 : 7;
  if (kr === backRank && checkers.some((p) => (p.type === 'r' || p.type === 'q') && +p.square[1] - 1 === backRank)) {
    const forward = matedColor === 'w' ? 1 : -1;
    let walled = true;
    for (let df = -1; df <= 1; df++) {
      const f = kf + df;
      if (f < 0 || f > 7) continue;
      const p = c.get(sqName(f, kr + forward));
      if (!p || p.color !== matedColor) walled = false;
    }
    if (walled) return 'back-rank';
  }
  return 'mate';
}

// Main entry: what pattern does the line starting with `pv[0]` (played by the side to move) use?
// Returns motifs ordered from most to least specific: [{ type, squares, targets?, piece? }].
export function lineMotifs(fen, pv) {
  if (!pv || !pv.length) return [];
  const c0 = new Chess(fen);
  const attacker = c0.turn();
  const victim = other(attacker);
  const c1 = new Chess(fen);
  const m1 = tryMove(c1, pv[0]);
  if (!m1) return [];
  const found = [];
  const add = (type, extra = {}) => { if (!found.some((f) => f.type === type)) found.push({ type, ...extra }); };

  // Mates along the line.
  const full = new Chess(fen);
  const played = [];
  for (const u of pv.slice(0, 12)) { const m = tryMove(full, u); if (!m) break; played.push(m); }
  if (full.isCheckmate() && full.turn() === victim) add(mateShape(full, victim, attacker), { squares: [played[played.length - 1].to] });

  const T = m1.to;
  const mover = m1.piece;

  // Double check / discovered check.
  if (c1.inCheck()) {
    const king = pieceList(c1, victim).find((p) => p.type === 'k');
    const checkers = king ? c1.attackers(king.square, attacker) : [];
    if (checkers.length >= 2) add('double-check', { squares: checkers });
    else if (checkers.length === 1 && checkers[0] !== T) add('discovered-check', { squares: [checkers[0], king.square] });
  }

  // Fork (double attack): the moved piece attacks two or more targets worth winning.
  // Undefended pawns count only alongside a bigger target.
  const targets = [];
  for (const p of pieceList(c1, victim)) {
    if (!c1.attackers(p.square, attacker).includes(T)) continue;
    const undefended = !c1.attackers(p.square, victim).length;
    if (p.type === 'p') { if (undefended) targets.push(p); continue; }
    if (p.type === 'k' || VALUE[p.type] > VALUE[mover] || undefended) targets.push(p);
  }
  if (targets.length >= 2 && targets.some((t) => t.type !== 'p')) add('fork',{ squares: [T, ...targets.map((t) => t.square)], targets: targets.map((t) => ({ square: t.square, type: t.type })), piece: mover });

  // Discovered attack: another piece's line opened onto a valuable target.
  for (const p of pieceList(c1, victim)) {
    if (p.type === 'p' || p.type === 'k') continue;
    const now = c1.attackers(p.square, attacker).filter((s) => s !== T);
    const before = new Set(c0.attackers(p.square, attacker));
    const fresh = now.filter((s) => !before.has(s));
    if (fresh.length && (VALUE[p.type] > minValue(c1, fresh) || !c1.attackers(p.square, victim).length)) {
      add('discovered', { squares: [fresh[0], p.square], targets: [{ square: p.square, type: p.type }] });
    }
  }

  // Pin or skewer created by a sliding piece.
  if (DIRS[mover]) {
    for (const seen of rays(c1, T, mover)) {
      if (seen.length < 2 || seen[0].color !== victim || seen[1].color !== victim) continue;
      const [front, back] = seen;
      if (front.type === 'k' || (VALUE[front.type] > VALUE[back.type] && VALUE[back.type] >= 3)) {
        add('skewer', { squares: [T, front.square, back.square], targets: [front, back].map((p) => ({ square: p.square, type: p.type })) });
      } else if (back.type === 'k' || VALUE[back.type] > VALUE[front.type]) {
        add('pin', { squares: [T, front.square, back.square], targets: [front, back].map((p) => ({ square: p.square, type: p.type })), absolute: back.type === 'k' });
      }
    }
  }

  // Removing the defender / overloaded defender (needs the next two moves of the line).
  if (m1.captured && played.length >= 3) {
    const reply = played[1], follow = played[2];
    if (follow.captured && follow.color === attacker) {
      const defendedBefore = c0.attackers(follow.to, victim).includes(m1.to);
      if (defendedBefore && reply.to !== follow.to) add('removing-defender', { squares: [m1.to, follow.to] });
      else if (reply.captured && reply.to === m1.to && c0.attackers(follow.to, victim).includes(reply.from)) {
        const defenders = c0.attackers(follow.to, victim);
        if (defenders.length === 1) add('overloaded', { squares: [reply.from, m1.to, follow.to] });
      }
    }
  }

  // Trapped piece: attacked, and every escape square is covered; the line then wins it.
  for (const p of pieceList(c1, victim)) {
    if (VALUE[p.type] < 3 || p.type === 'k') continue;
    const att = c1.attackers(p.square, attacker);
    if (!att.length || minValue(c1, att) >= VALUE[p.type]) continue;
    if (c1.turn() !== victim) continue;
    const escapes = c1.moves({ square: p.square, verbose: true });
    const safe = escapes.some((mv) => {
      const t = new Chess(c1.fen());
      tryMove(t, mv.from + mv.to + (mv.promotion || ''));
      return !t.isAttacked(mv.to, attacker) || mv.captured;
    });
    const wonLater = played.slice(1, 6).some((m) => m.color === attacker && m.captured === p.type);
    if (!safe && wonLater) add('trapped', { squares: [p.square], targets: [{ square: p.square, type: p.type }] });
  }

  // Free capture.
  if (m1.captured && m1.captured !== 'p') {
    const defended = c0.attackers(m1.to, victim).length > 0;
    if (!defended || VALUE[m1.captured] > VALUE[mover]) add('hanging', { squares: [m1.from, m1.to], targets: [{ square: m1.to, type: m1.captured }], defended });
  }

  if (played.slice(0, 5).some((m) => m.color === attacker && m.promotion)) add('promotion', { squares: [played.find((m) => m.promotion).to] });

  const order = ['back-rank', 'smothered', 'mate', 'double-check', 'fork', 'discovered-check', 'skewer', 'pin', 'removing-defender', 'overloaded', 'discovered', 'trapped', 'hanging', 'promotion'];
  return found.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

// Describes a motif in a short clause, e.g. "forks the king on e8 and the rook on a8".
export function describeMotif(m) {
  const t = (m.targets || []).map((x) => `${PIECE_NAME[x.type]} on ${x.square}`);
  switch (m.type) {
    case 'fork': return `forks the ${t.join(' and the ')}`;
    case 'pin': return m.absolute ? `pins the ${t[0]} to the king` : `pins the ${t[0]} to the ${t[1]}`;
    case 'skewer': return `skewers the ${t[0]}, winning the ${t[1]} behind it`;
    case 'discovered': return `uncovers an attack on the ${t[0]}`;
    case 'discovered-check': return 'gives a discovered check';
    case 'double-check': return 'gives double check';
    case 'removing-defender': return 'removes the defender';
    case 'overloaded': return 'exploits an overloaded defender';
    case 'trapped': return `traps the ${t[0]}`;
    case 'hanging': return m.defended ? `wins the ${t[0]} for a cheaper piece` : `wins the undefended ${t[0]}`;
    case 'back-rank': return 'mates on the back rank';
    case 'smothered': return 'delivers a smothered mate';
    case 'mate': return 'leads to checkmate';
    case 'promotion': return 'promotes a pawn';
    default: return '';
  }
}
