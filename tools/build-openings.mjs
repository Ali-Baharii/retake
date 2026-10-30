// Builds data/openings.json from lichess-org/chess-openings (CC0 public domain).
// Usage: node tools/build-openings.mjs   (downloads the TSV files if they're not in tools/openings-src/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../vendor/chess.js';
import { hashKey, epd } from '../js/openings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, 'openings-src');
const outFile = path.join(here, '..', 'data', 'openings.json');
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';

fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const names = {};
const book = new Set();
let lines = 0;

for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const file = path.join(srcDir, letter + '.tsv');
  if (!fs.existsSync(file)) {
    const res = await fetch(BASE + letter + '.tsv');
    if (!res.ok) throw new Error(`download failed for ${letter}.tsv: ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  const rows = fs.readFileSync(file, 'utf8').split('\n').slice(1).filter(Boolean);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    if (!pgn) continue;
    const c = new Chess();
    c.loadPgn(pgn);
    const replay = new Chess();
    for (const m of c.history()) {
      replay.move(m);
      book.add(hashKey(epd(replay.fen())));
    }
    names[hashKey(epd(replay.fen()))] = [eco, name];
    lines++;
  }
}

fs.writeFileSync(outFile, JSON.stringify({
  source: 'lichess-org/chess-openings (CC0)',
  names,
  book: [...book].join(','),
}));
console.log(`${lines} opening lines, ${Object.keys(names).length} named positions, ${book.size} book positions → ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
