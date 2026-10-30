import fs from 'node:fs';
import { Chess } from '../vendor/chess.js';
import { loadOpenings, identifyOpening, openingFamily } from '../js/openings.js';

function fensOf(moves) {
  const c = new Chess();
  return moves.split(' ').map((m) => { c.move(m); return c.fen(); });
}

export async function run(assert) {
  const data = await loadOpenings(() => JSON.parse(fs.readFileSync(new URL('../data/openings.json', import.meta.url))));
  assert(data && data.book.size > 5000, 'openings data loads');
  const najdorf = identifyOpening(data, fensOf('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Qd3 Qc7'));
  assert(/Najdorf/.test(najdorf.name) && najdorf.eco === 'B90', `Najdorf named, got ${najdorf.eco} ${najdorf.name}`);
  assert(najdorf.bookPlies >= 10, `Najdorf book depth ${najdorf.bookPlies}`);
  assert(openingFamily(najdorf.name) === 'Sicilian Defense', 'family of Najdorf');
  const offbeat = identifyOpening(data, fensOf('e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7'));
  assert(offbeat.bookPlies <= 6, `Wayward queen leaves book early (${offbeat.bookPlies}, ${offbeat.name})`);
}
