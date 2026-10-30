// Explains why a move was an error, in plain words with piece and square names.

import { Chess } from '../vendor/chess.js';
import { lineMotifs, describeMotif, newlyHanging, MOTIF_TEXT, PIECE_NAME, VALUE } from './motifs.js';

const MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const CATEGORY_TEXT = {
  hung: 'Left material hanging',
  tactic: 'Walked into a tactic',
  missed_tactic: 'Missed a winning tactic',
  missed_mate: 'Missed a checkmate',
  allowed_mate: 'Allowed a checkmate',
  positional: 'Positional error',
  endgame: 'Endgame technique',
};

// One-line lessons shown with puzzles and the guided review.
export const LESSONS = {
  fork: 'Look for squares where one piece can attack two targets, especially with checks. Knights and queens fork most often.',
  pin: 'A pinned piece can\'t move without exposing something bigger behind it. Attack it again, or avoid lining up your pieces.',
  skewer: 'When a valuable piece stands in front of another on a line, a skewer wins the one behind.',
  'discovered-check': 'Moving a piece out of the way can open a check from behind. The moving piece gets a free move.',
  'double-check': 'With a double check, only a king move helps. It\'s one of the strongest tactics there is.',
  discovered: 'Moving one piece can unmask an attack by another. Check which lines open when a piece moves.',
  'removing-defender': 'If a piece is guarded by just one defender, capture or chase the defender first.',
  overloaded: 'A piece that defends two things at once can only do one job. Attack both.',
  trapped: 'Pieces with no safe squares can be won. Check escape squares before going deep into enemy territory.',
  hanging: 'Before every move, ask: what can my opponent capture now, and what can I capture?',
  'bad-trade': 'Count the trade before capturing: what you take, what you give back.',
  'back-rank': 'A king boxed in by its own pawns can be mated on the back rank. Make an escape square (luft) in time.',
  smothered: 'A king surrounded by its own pieces is vulnerable to a knight check.',
  mate: 'When the enemy king is exposed, look at every check first, even sacrifices.',
  promotion: 'Advanced passed pawns are worth a lot. Look for ways to push and promote, or stop them early.',
  defense: 'Before choosing your move, find your opponent\'s threat. A good move often both defends and improves.',
  positional: 'With no tactics on the board, improve your worst-placed piece and avoid creating weaknesses.',
  endgame: 'In endgames, activate your king, create passed pawns and keep your rooks active.',
};

export function fmtLine(sans, fen) {
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

export function moveLabel(moveNo, color, san) {
  return `${moveNo}${color === 'w' ? '.' : '...'} ${san}`;
}

function balance(fen, color) {
  let w = 0, b = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = MATERIAL[ch.toLowerCase()];
    if (!v) continue;
    if (ch === ch.toUpperCase()) w += v; else b += v;
  }
  return color === 'w' ? w - b : b - w;
}

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

function points(n) {
  if (n <= 1) return 'a pawn';
  if (n >= 8) return `${n} points of material (about a queen)`;
  if (n >= 5) return `${n} points of material (about a rook)`;
  if (n >= 3) return `${n} points of material (about a piece)`;
  return `${n} points of material`;
}

// The most valuable piece the opponent wins in the line (ignoring pieces won back right away).
function biggestLoss(moves, byColor) {
  let best = null;
  for (const m of moves) {
    if (m.color !== byColor || !m.captured) continue;
    if (!best || MATERIAL[m.captured] > MATERIAL[best.type]) best = { type: m.captured, square: m.to };
  }
  return best;
}

// p: ply record (san, uci, from, to, fenBefore, fenAfter, color, phase, cls)
// before/after: engine evaluations of the positions before and after the move.
// threat: engine line from the null-move position (the opponent's threat), if any.
export function explainError(p, before, after, threat) {
  const mover = p.color, opp = mover === 'w' ? 'b' : 'w';
  const l0 = before.lines[0];
  const a0 = after.lines[0];
  const why = { cat: 'positional', theme: p.phase === 'endgame' ? 'endgame' : 'positional', motifs: [] };

  // What did the opponent threaten before this move, and did the move ignore it?
  if (threat && threat.pv && threat.pv.length) {
    const tLine = playLine(nullFen(p.fenBefore), threat.pv, 6);
    const tGain = tLine.fens.length > 1 ? settled(tLine.fens, opp) - balance(p.fenBefore, opp) : 0;
    const isMate = threat.type === 'mate' && threat.score > 0;
    if ((tGain >= 2 || isMate) && tLine.sans[0]) {
      const ignored = a0 && a0.pv[0] === threat.pv[0];
      const motifs = lineMotifs(nullFen(p.fenBefore), threat.pv);
      why.threat = { uci: threat.pv[0], san: tLine.sans[0], gain: tGain, mate: isMate, motif: motifs[0] ? motifs[0].type : null, ignored };
    }
  }

  // Pieces this move left undefended (often because the moved piece was their defender).
  const hangs = newlyHanging(p.fenBefore, p.fenAfter, mover, p.to);
  const cb = new Chess(p.fenBefore);
  why.undefended = hangs.map((h) => ({ ...h, wasDefendedByMover: h.square !== p.to && cb.attackers(h.square, mover).includes(p.from), movedPiece: h.square === p.to }));

  if (a0 && a0.type === 'mate' && a0.score > 0 && !(l0.type === 'mate' && l0.score < 0)) {
    const reply = playLine(p.fenAfter, a0.pv, 10);
    const motifs = lineMotifs(p.fenAfter, a0.pv);
    return { ...why, cat: 'allowed_mate', mateIn: a0.score, line: reply.sans, lineFrom: 'after', motifs, theme: 'defense' };
  }
  if (l0 && l0.type === 'mate' && l0.score > 0 && !(a0 && a0.type === 'mate' && a0.score < 0)) {
    const best = playLine(p.fenBefore, l0.pv, 10);
    const motifs = lineMotifs(p.fenBefore, l0.pv);
    return { ...why, cat: 'missed_mate', mateIn: l0.score, line: best.sans, lineFrom: 'before', motifs, theme: motifs[0] ? motifs[0].type : 'mate' };
  }

  const start = balance(p.fenBefore, mover);
  const reply = playLine(p.fenAfter, a0 ? a0.pv : [], 4);
  const afterBal = settled(reply.fens, mover);
  const drop = start - afterBal;
  if (drop >= 2) {
    const motifs = lineMotifs(p.fenAfter, a0.pv);
    const first = reply.moves[0];
    const lost = biggestLoss(reply.moves, opp);
    why.lost = lost;
    const badTrade = !!(p.captured || /x/.test(p.san)) && first && first.to === p.to && first.captured;
    const cat = first && first.captured ? 'hung' : 'tactic';
    if (badTrade && !motifs.length) motifs.push({ type: 'bad-trade', squares: [p.to] });
    if (cat === 'hung' && !motifs.length) motifs.push({ type: 'hanging', squares: [first.from, first.to], targets: [{ square: first.to, type: first.captured }] });
    return { ...why, cat, amount: drop, line: reply.sans, lineFrom: 'after', motifs, lostPiece: lost ? lost.type : null, theme: 'defense' };
  }
  const bestLine = playLine(p.fenBefore, l0 ? l0.pv : [], 4);
  const gain = settled(bestLine.fens, mover) - start;
  if (gain >= 2 && gain - (afterBal - start) >= 2) {
    const motifs = lineMotifs(p.fenBefore, l0.pv);
    return { ...why, cat: 'missed_tactic', amount: gain, line: bestLine.sans, lineFrom: 'before', motifs, theme: motifs[0] ? motifs[0].type : 'hanging' };
  }
  const line = playLine(p.fenBefore, l0 ? l0.pv : [], 6).sans;
  // No material changes hands within a few moves, but the opponent's reply may still be a tactic.
  const replyLine = playLine(p.fenAfter, a0 ? a0.pv : [], 6);
  const replyMotifs = a0 ? lineMotifs(p.fenAfter, a0.pv).filter((m) => TACTICAL.has(m.type)) : [];
  why.reply = replyLine.sans;
  if (replyMotifs.length && p.loss >= 8) {
    return { ...why, cat: 'tactic', motifs: replyMotifs, line: replyLine.sans, lineFrom: 'after', theme: 'defense' };
  }
  if (why.threat && why.threat.ignored) why.theme = 'defense';
  return { ...why, cat: p.phase === 'endgame' ? 'endgame' : 'positional', line, lineFrom: 'before' };
}

const TACTICAL = new Set(['fork', 'pin', 'skewer', 'discovered', 'discovered-check', 'double-check', 'trapped', 'removing-defender', 'overloaded']);

function nullFen(fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  if (parts[1] === 'w') parts[5] = String(+parts[5] + 1);
  return parts.join(' ');
}

const motifName = (m) => (MOTIF_TEXT[m.type] || m.type).toLowerCase();

// Turns the analysis into sentences: { headline, detail, line }.
// mine: true when the move is the user's ("your knight"); otherwise sides are named ("White's knight").
export function describeError(p, { mine = true } = {}) {
  const w = p.why;
  if (!w) return null;
  const lineText = w.line && w.line.length ? fmtLine(w.line, w.lineFrom === 'after' ? p.fenAfter : p.fenBefore) : '';
  const best = p.best ? p.best.san : 'the engine move';
  const m = w.motifs && w.motifs[0];
  const parts = [];
  const side = p.color === 'w' ? 'White' : 'Black';
  const oppName = mine ? 'your opponent' : (p.color === 'w' ? 'Black' : 'White');
  const Opp = oppName[0].toUpperCase() + oppName.slice(1);
  const your = mine ? 'your' : `${side}'s`;

  if (w.threat && w.threat.ignored && !['allowed_mate', 'missed_mate'].includes(w.cat)) {
    parts.push(`${Opp} was threatening ${w.threat.san}${w.threat.motif ? ` (${(MOTIF_TEXT[w.threat.motif] || '').toLowerCase()})` : ''}, and ${p.san} didn't deal with it.`);
  } else if (p.cls === 'miss') {
    parts.push(`${Opp} had just made a mistake.`);
  }

  let headline = CATEGORY_TEXT[w.cat] || 'Inaccuracy';
  switch (w.cat) {
    case 'allowed_mate':
      headline = m && m.type !== 'mate' ? `Allowed a ${motifName(m)}` : 'Allowed checkmate';
      parts.push(`${p.san} allows checkmate in ${w.mateIn}: ${lineText}.`);
      break;
    case 'missed_mate':
      headline = m && m.type !== 'mate' ? `Missed a ${motifName(m)}` : 'Missed checkmate';
      parts.push(`${best} forces checkmate in ${w.mateIn}: ${lineText}.`);
      break;
    case 'hung': {
      const lostDef = (w.undefended || []).find((u) => u.wasDefendedByMover);
      const movedInto = (w.undefended || []).find((u) => u.movedPiece);
      const lost = w.lost ? `${your} ${PIECE_NAME[w.lost.type]} on ${w.lost.square}` : points(w.amount);
      if (m && m.type === 'bad-trade') {
        headline = 'Losing trade';
        parts.push(`${p.san} starts a trade that loses ${points(w.amount)}: ${lineText}.`);
      } else if (w.threat && w.threat.ignored) {
        parts.push(`${lineText} wins ${lost}.`);
      } else if (lostDef) {
        parts.push(`${p.san} stops defending ${your} ${PIECE_NAME[lostDef.type]} on ${lostDef.square}. ${lineText} wins ${points(w.amount)}.`);
      } else if (movedInto) {
        headline = 'Moved into an attack';
        parts.push(`${p.san} puts ${your} ${PIECE_NAME[movedInto.type]} where it can be taken. ${lineText} wins ${points(w.amount)}.`);
      } else if (m && m.type === 'hanging' && m.targets) {
        parts.push(`After ${p.san}, ${lineText} wins ${lost}.`);
      } else if (m) {
        headline = `Walked into a ${motifName(m)}`;
        parts.push(`After ${p.san}, ${w.line[0]} ${describeMotif(m)}. ${lineText} wins ${points(w.amount)}.`);
      } else {
        parts.push(`${p.san} leaves material hanging: ${lineText} wins ${points(w.amount)}.`);
      }
      break;
    }
    case 'tactic':
      if (m) headline = `Walked into a ${motifName(m)}`;
      parts.push(w.amount
        ? `After ${p.san}, ${w.line[0]}${m ? ' ' + describeMotif(m) : ' starts a tactic'}. ${lineText} wins ${points(w.amount)}.`
        : `After ${p.san}, ${w.line[0]}${m ? ' ' + describeMotif(m) : ' is strong'}: ${lineText}. Better was ${best}.`);
      break;
    case 'missed_tactic':
      if (m && m.type !== 'hanging') headline = `Missed a ${motifName(m)}`;
      parts.push(`${best}${m ? ' ' + describeMotif(m) : ''} and wins ${points(w.amount)}: ${lineText}.`);
      break;
    case 'endgame':
      parts.push(p.cls === 'miss'
        ? `${best} would have punished it. ${p.san} gives away ${Math.round(p.loss)}% winning chances.`
        : `No material is lost right away, but ${p.san} gives away ${Math.round(p.loss)}% winning chances in this endgame. ${best} keeps more.`);
      break;
    default: {
      const reply = w.reply && w.reply.length ? fmtLine(w.reply.slice(0, 4), p.fenAfter) : '';
      if (p.cls === 'miss') parts.push(`${best} would have punished it. ${p.san} gives away ${Math.round(p.loss)}% winning chances.`);
      else if (p.loss >= 15 && reply) parts.push(`${p.san} gives away ${Math.round(p.loss)}% winning chances. ${Opp}'s best answer is ${reply}. Better was ${best}.`);
      else parts.push(`No material is lost right away, but ${p.san} gives away ${Math.round(p.loss)}% winning chances. The engine prefers ${best}.`);
    }
  }
  return { headline, detail: parts.join(' '), line: lineText };
}

export function themeLabel(theme) {
  return MOTIF_TEXT[theme] || theme;
}

export { VALUE };
