// Motif recognition on hand-built positions. No engine needed.
import { lineMotifs, nullMoveFen, newlyHanging, describeMotif } from '../js/motifs.js';

const cases = [
  { name: 'knight fork', fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', pv: ['b5c7'], expect: 'fork' },
  { name: 'absolute pin', fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', pv: ['f1b5'], expect: 'pin' },
  { name: 'skewer', fen: '6q1/8/4k3/8/8/8/8/4KB2 w - - 0 1', pv: ['f1c4'], expect: 'skewer' },
  { name: 'discovered check', fen: 'r3k3/8/8/8/4B3/8/8/4RK2 w - - 0 1', pv: ['e4b7'], expect: 'discovered-check' },
  { name: 'back-rank mate', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', pv: ['a1a8'], expect: 'back-rank' },
  { name: 'smothered mate', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', pv: ['g5f7'], expect: 'smothered' },
  { name: 'hanging queen', fen: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', pv: ['d1d5'], expect: 'hanging' },
  { name: 'removing the defender', fen: '4k3/6p1/5n2/3r2B1/8/8/8/3RK3 w - - 0 1', pv: ['g5f6', 'g7f6', 'd1d5'], expect: 'removing-defender' },
];

export function run(assert) {
  for (const t of cases) {
    const m = lineMotifs(t.fen, t.pv);
    assert(m[0] && m[0].type === t.expect, `${t.name}: expected ${t.expect}, got ${m.map((x) => x.type).join(',') || 'none'}${m[0] ? ' (' + describeMotif(m[0]) + ')' : ''}`);
  }
  const nm = nullMoveFen('4k3/8/8/8/8/8/8/4K3 w - - 0 10');
  assert(nm && nm.split(' ')[1] === 'b', 'null move flips side to move');
  assert(nullMoveFen('4k3/8/8/8/8/8/8/4K2r w - - 0 1') === null, 'null move refused when in check');
  const hung = newlyHanging('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', '4k3/8/8/2p5/3N4/8/8/4K3 w - - 0 1', 'w');
  assert(hung.length === 1 && hung[0].square === 'd4', 'pawn attack makes the knight hang');
}
