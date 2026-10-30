// Thin UCI wrapper around the Stockfish web worker.

const ENGINE_URL = './vendor/stockfish/stockfish-19-lite-single.js';

export class Engine {
  constructor(url = ENGINE_URL) {
    this.url = url;
    this.worker = null;
    this.handlers = new Set();
    this.starting = null;
    this.queue = Promise.resolve();
  }

  // Engine commands run one at a time so a cancelled game can't mix with the next one.
  _enqueue(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  stop() {
    if (this.worker) this.send('stop');
  }

  start() {
    if (!this.starting) this.starting = this._start().catch((err) => { this.terminate(); throw err; });
    return this.starting;
  }

  async _start() {
    let fail;
    const failed = new Promise((_, reject) => { fail = reject; });
    this.worker = this.createWorker(
      (line) => { for (const h of [...this.handlers]) h(line); },
      (msg) => fail(new Error('The chess engine could not load: ' + msg)),
    );
    // The engine drops commands that arrive before its WebAssembly has loaded, so keep asking.
    const ok = this.waitFor((l) => l === 'uciok', 45000);
    this.send('uci');
    const retry = setInterval(() => this.send('uci'), 1000);
    try {
      await Promise.race([ok, failed]);
    } finally {
      clearInterval(retry);
    }
    this.send('setoption name Hash value 32');
    this.send('setoption name MultiPV value 2');
    await this.ready();
  }

  createWorker(onLine, onError) {
    const w = new Worker(this.url);
    w.onmessage = (e) => onLine(typeof e.data === 'string' ? e.data : String(e.data));
    w.onerror = (e) => onError(e.message || 'unknown error');
    return w;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(test, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const h = (line) => {
        if (!test(line)) return;
        clearTimeout(timer);
        this.handlers.delete(h);
        resolve(line);
      };
      const timer = setTimeout(() => {
        this.handlers.delete(h);
        reject(new Error('The chess engine stopped responding.'));
      }, timeout);
      this.handlers.add(h);
    });
  }

  async ready() {
    const ok = this.waitFor((l) => l === 'readyok', 30000);
    this.send('isready');
    await ok;
  }

  newGame() {
    return this._enqueue(async () => {
      this.send('ucinewgame');
      await this.ready();
    });
  }

  // Resolves with { bestmove, lines: [{ multipv, depth, type: 'cp'|'mate', score, pv: [uci] }] }.
  // Scores are from the side to move's point of view.
  analyse(fen, opts) {
    return this._enqueue(() => this._analyse(fen, opts));
  }

  _analyse(fen, { depth = 14, movetime = 3000 } = {}) {
    return new Promise((resolve) => {
      const lines = {};
      const h = (line) => {
        if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
          if (line.includes(' lowerbound') || line.includes(' upperbound')) return;
          const info = parseInfo(line);
          if (info) lines[info.multipv] = info;
        } else if (line.startsWith('bestmove')) {
          clearTimeout(guard);
          this.handlers.delete(h);
          const best = line.split(' ')[1];
          resolve({
            bestmove: best && best !== '(none)' ? best : null,
            lines: Object.keys(lines).sort((a, b) => a - b).map((k) => lines[k]),
          });
        }
      };
      // Safety net in case the engine ignores the time limit.
      const guard = setTimeout(() => this.send('stop'), movetime + 5000);
      this.handlers.add(h);
      this.send('position fen ' + fen);
      this.send(`go depth ${depth} movetime ${movetime}`);
    });
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.starting = null;
    this.handlers.clear();
  }
}

function parseInfo(line) {
  const t = line.trim().split(/\s+/);
  const out = { multipv: 1, depth: 0, type: 'cp', score: 0, pv: [] };
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') out.depth = +t[++i];
    else if (k === 'multipv') out.multipv = +t[++i];
    else if (k === 'score') { out.type = t[++i]; out.score = +t[++i]; }
    else if (k === 'pv') { out.pv = t.slice(i + 1); break; }
  }
  return out.pv.length ? out : null;
}
