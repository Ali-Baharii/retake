// Builds data/sample-game.json: a pre-analyzed demo game for the "Try a sample game" button.
// Usage: npm install && node tools/build-sample.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Engine } from '../js/engine.js';
import { parseGame, gameId } from '../js/pgn.js';
import { analyzeGame } from '../js/analysis.js';
import { loadOpenings } from '../js/openings.js';
import { gameTips, userRating } from '../js/insights.js';

const require = createRequire(import.meta.url);
class NodeEngine extends Engine {
  createWorker(onLine) {
    const sf = require('stockfish')('lite-single', onLine);
    return { postMessage: (c) => sf.processCommand(c), terminate: () => sf.terminate() };
  }
}

// The Blackburne Shilling Gambit trap (a classic, public domain): White falls for it.
const PGN = `[Event "Sample game"]
[Site "Retake"]
[White "You"]
[Black "Opponent"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;

const engine = new NodeEngine();
const openings = await loadOpenings(() => JSON.parse(fs.readFileSync(new URL('../data/openings.json', import.meta.url))));
const game = parseGame(PGN);
const userColor = 'w';
const out = await analyzeGame(game, engine, { preset: 'balanced', userColor, openings });
const headers = { Event: 'Sample game', White: 'You', Black: 'Opponent', Result: '0-1' };
const record = {
  id: 'sample:blackburne',
  sample: true,
  pgn: game.pgn,
  headers,
  opening: out.report.opening.name,
  source: 'pgn',
  tcLabel: '',
  tcKind: '',
  playedAt: Date.UTC(2026, 9, 30),
  analyzedAt: 0,
  userColor,
  notes: {},
  report: out.report,
  evals: out.evals,
  extra: out.extra,
  partial: null,
};
record.tips = gameTips(out.report, out.report.opening.name, { rating: userRating(headers, userColor) });
fs.writeFileSync(new URL('../data/sample-game.json', import.meta.url), JSON.stringify(record));
const errs = out.report.plies.filter((p) => p.why).map((p) => `${p.moveNo}.${p.san} ${p.cls} ${p.why.cat}/${p.why.motifs[0] ? p.why.motifs[0].type : ''}`);
console.log(`sample built (${gameId(game)}): ${errs.join(' | ')}`);
engine.terminate();
process.exit(0);
