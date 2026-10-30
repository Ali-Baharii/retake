// Full analysis with Stockfish in Node (npm install first). Uses public-domain games.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { Engine } from '../js/engine.js';
import { parseGame } from '../js/pgn.js';
import { analyzeGame, buildReport } from '../js/analysis.js';
import { describeError } from '../js/explain.js';
import { loadOpenings } from '../js/openings.js';
import { gameTips } from '../js/insights.js';
import { extractPuzzles } from '../js/training.js';

const require = createRequire(import.meta.url);
class NodeEngine extends Engine {
  createWorker(onLine) {
    const sf = require('stockfish')('lite-single', onLine);
    return { postMessage: (c) => sf.processCommand(c), terminate: () => sf.terminate() };
  }
}

const GAMES = {
  opera: `[White "Morphy"]\n[Black "Duke Karl / Count Isouard"]\n[Result "1-0"]\n\n1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`,
  blackburne: `[White "Victim"]\n[Black "Trapper"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`,
  scholar: `[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`,
};

export async function run(assert) {
  const engine = new NodeEngine();
  const openings = await loadOpenings(() => JSON.parse(fs.readFileSync(new URL('../data/openings.json', import.meta.url))));
  const results = {};
  for (const [name, pgn] of Object.entries(GAMES)) {
    const game = parseGame(pgn);
    const userColor = name === 'opera' ? 'b' : name === 'blackburne' ? 'w' : 'b';
    const t0 = Date.now();
    const out = await analyzeGame(game, engine, { preset: 'fast', userColor, openings });
    results[name] = out;
    const r = out.report;
    console.log(`  ${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s, opening "${r.opening.name}" (book ${r.opening.bookPlies})`);
    for (const p of r.plies.filter((x) => x.why && x.cls !== 'inaccuracy')) {
      const d = describeError(p);
      console.log(`    ${p.moveNo}${p.color === 'w' ? '.' : '...'}${p.san} ${p.cls} [${p.why.cat}/${p.why.theme}${p.why.motifs[0] ? '/' + p.why.motifs[0].type : ''}${p.why.threat ? ' threat ' + p.why.threat.san + (p.why.threat.ignored ? ' ignored' : '') : ''}] ${d.headline}: ${d.detail}`);
    }
    assert(r.version === 2 && out.evals.length === game.moves.length + 1, `${name}: v2 report with raw evals`);
    const rebuilt = buildReport(game, out.evals, userColor, 'fast', out.extra);
    assert(rebuilt.plies.map((p) => p.cls).join() === r.plies.map((p) => p.cls).join(), `${name}: report rebuilds identically from stored evals`);
  }

  const sch = results.scholar.report.plies.find((p) => p.san === 'Nf6');
  assert(sch && sch.cls === 'blunder' && sch.why.cat === 'allowed_mate', 'scholar: 3...Nf6 allows mate');
  const bb = results.blackburne.report;
  assert(bb.plies.some((p) => p.color === 'w' && p.why && p.why.cat === 'allowed_mate'), 'blackburne: white allowed a mate');
  assert(bb.plies.some((p) => p.why && p.why.motifs.some((m) => m.type === 'smothered')), 'blackburne: smothered mate recognized');
  assert(bb.plies.slice(0, 4).every((p) => p.cls === 'book'), `blackburne: first moves are book (${bb.plies.slice(0, 6).map((p) => p.cls).join(',')})`);
  const opera = results.opera.report;
  assert(opera.plies.find((p) => p.san === 'Nxb8').cls === 'forced', 'opera: 16...Nxb8 is forced');
  assert(opera.summary.players.b.accuracy < opera.summary.players.w.accuracy, 'opera: Morphy played more accurately than his opponents');
  const nxf7 = bb.plies.find((p) => p.san === 'Nxf7');
  assert(nxf7 && ['mistake', 'blunder'].includes(nxf7.cls), 'blackburne: 5.Nxf7 is a serious error');

  const tips = gameTips(bb, bb.opening.name, { rating: 900 });
  assert(tips.length > 0, 'tips generated');
  const puzzles = extractPuzzles({ id: 'bb', report: bb, headers: {} });
  assert(puzzles.length >= 1 && puzzles.every((z) => z.solution.length >= 1), `puzzles extracted (${puzzles.length})`);
  console.log('  puzzles:', puzzles.map((z) => `${z.ply}:${z.solution.join(' ')} [${z.themes.join(',')}]`).join(' | '));
  engine.terminate();
}
