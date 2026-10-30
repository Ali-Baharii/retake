// Thin UCI wrapper around the Stockfish web worker.

const ENGINE_URL = './vendor/stockfish/stockfish-19-lite-single.js';

export class Engine {
  constructor(url = ENGINE_URL) {
    this.url = url;
    this.worker = null;
    this.handlers = new Set();
    this.starting = null;
    this.queue = Promise.resolve();
    this.multipv = 1;
    this.cache = null;   // optional { get(key), set(key, value) }
  }

  // Engine commands run one at a time so separate callers can't mix their output.
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
    this.multipv = 1;
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
      await this.start();
      this.send('ucinewgame');
      await this.ready();
    });
  }

  // Resolves with { bestmove, depth, lines: [{ multipv, depth, type: 'cp'|'mate', score, pv: [uci] }] }.
  // Scores are from the side to move's point of view. onInfo(lines, depth) streams progress.
  analyse(fen, opts = {}) {
    return this._enqueue(async () => {
      await this.start();
      return this._analyse(fen, opts);
    });
  }

  // Cached single-line evaluation, used to check puzzle answers.
  async quickEval(fen, depth = 12) {
    const key = `${fen.split(' ').slice(0, 4).join(' ')}|q${depth}`;
    if (this.cache) {
      const hit = await this.cache.get(key);
      if (hit) return hit;
    }
    const res = await this.analyse(fen, { depth, movetime: 2500, multipv: 1 });
    if (this.cache && res.lines.length) this.cache.set(key, res);
    return res;
  }

  _analyse(fen, { depth = 14, movetime = 3000, multipv = 3, infinite = false, onInfo = null } = {}) {
    return new Promise((resolve) => {
      if (multipv !== this.multipv) {
        this.send(`setoption name MultiPV value ${multipv}`);
        this.multipv = multipv;
      }
      const lines = {};
      let lastDepth = 0;
      const h = (line) => {
        if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
          if (line.includes(' lowerbound') || line.includes(' upperbound')) return;
          const info = parseInfo(line);
          if (!info) return;
          if (info.multipv === 1 && info.depth > lastDepth) {
            // A new depth started: drop lines from older depths so they don't mix.
            for (const k of Object.keys(lines)) if (lines[k].depth < info.depth - 1) delete lines[k];
            lastDepth = info.depth;
          }
          lines[info.multipv] = info;
          if (onInfo && info.multipv === Object.keys(lines).length) onInfo(sorted(lines), lastDepth);
        } else if (line.startsWith('bestmove')) {
          clearTimeout(guard);
          this.handlers.delete(h);
          const best = line.split(' ')[1];
          resolve({ bestmove: best && best !== '(none)' ? best : null, depth: lastDepth, lines: sorted(lines) });
        }
      };
      // Safety net in case the engine ignores the time limit.
      const guard = infinite ? null : setTimeout(() => this.send('stop'), movetime + 5000);
      this.handlers.add(h);
      this.send('position fen ' + fen);
      this.send(infinite ? `go depth ${depth}` : `go depth ${depth} movetime ${movetime}`);
    });
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.starting = null;
    this.handlers.clear();
  }
}

function sorted(lines) {
  return Object.keys(lines).sort((a, b) => a - b).map((k) => lines[k]);
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
