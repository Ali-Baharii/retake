import { Chess } from '../vendor/chess.js';
import { exportPgn } from '../js/pgnexport.js';

// A tiny hand-made report: two plies, one blunder with an explanation.
const report = {
  userColor: 'b',
  opening: { eco: 'C20', name: "King's Pawn Game", bookPlies: 0 },
  positions: [
    { eval: { type: 'cp', score: 30 } }, { eval: { type: 'cp', score: 25 } }, { eval: { type: 'cp', score: 30 } },
  ],
  plies: [
    { i: 0, color: 'w', moveNo: 1, san: 'e4', uci: 'e2e4', cls: 'best', fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', clock: 179.5, bestLine: ['e4'], best: { uci: 'e2e4', san: 'e4' } },
    {
      i: 1, color: 'b', moveNo: 1, san: 'f6', uci: 'f7f6', cls: 'mistake', loss: 12,
      fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      fenAfter: 'rnbqkbnr/ppppp1pp/5p2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      best: { uci: 'e7e5', san: 'e5' }, bestLine: ['e5', 'Nf3', 'Nc6'],
      why: { cat: 'positional', motifs: [], line: ['e5', 'Nf3'], lineFrom: 'before', reply: [] },
    },
  ],
};

export function run(assert) {
  const pgn = exportPgn({ headers: { White: 'A', Black: 'B {x}', Result: '*' }, report, notes: { 1: 'I wanted {f5}' } });
  assert(pgn.includes('[%eval 0.25]'), 'eval tags written');
  assert(pgn.includes('$2'), 'mistake NAG written');
  assert(pgn.includes('(1... e5 2. Nf3 Nc6)'), 'best line as a variation');
  assert(pgn.includes('Note: I wanted f5'), 'notes included, braces stripped');
  const c = new Chess();
  let ok = true;
  try { c.loadPgn(pgn); } catch (e) { ok = false; console.log(pgn, e.message); }
  assert(ok && c.history().join(' ') === 'e4 f6', 'exported PGN loads back with the same moves');
}
