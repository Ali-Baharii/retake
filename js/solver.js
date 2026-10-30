// "Find the move": interactive puzzle solving shared by retries, training and the guided review.

import { Chess } from '../vendor/chess.js';
import { createBoard } from './board.js';
import { winPercent } from './analysis.js';
import { lineMotifs, describeMotif } from './motifs.js';
import { playLine, fmtLine } from './explain.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// puzzle: { fen, solution: [uci…], winBefore, hint, bestSan, color }
// options: { engine, prompt, sub, onResult(result), onMoveSound() }
export function createSolver(container, puzzle, { engine, prompt, sub, onResult, onMoveSound } = {}) {
  container.innerHTML = `
    <div class="solver">
      <div class="solver-prompt"><b>${esc(prompt || `Find the best move for ${puzzle.color === 'w' ? 'White' : 'Black'}`)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      <div class="board solver-board"></div>
      <div class="solver-status" aria-live="polite"></div>
      <div class="solver-actions">
        <button type="button" class="btn ghost" data-act="hint">Hint</button>
        <button type="button" class="btn ghost" data-act="reveal">Show answer</button>
      </div>
    </div>`;
  const $ = (sel) => container.querySelector(sel);
  const board = createBoard($('.solver-board'), { fen: puzzle.fen, flipped: puzzle.color === 'b', interactive: puzzle.color });
  const st = { fen: puzzle.fen, step: 0, mistakes: 0, hints: 0, revealed: false, partial: false, alt: false, done: false, busy: false, t0: Date.now() };

  const status = (html, kind = '') => {
    const el = $('.solver-status');
    el.className = 'solver-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
  };
  const sanOf = (fen, uci) => playLine(fen, [uci], 1).sans[0] || uci;

  function finish(solved) {
    st.done = true;
    board.setInteractive(false);
    $('.solver-actions').hidden = true;
    const result = { solved, firstTry: st.mistakes === 0, hints: st.hints, revealed: st.revealed, partial: st.partial, alt: st.alt, ms: Date.now() - st.t0 };
    if (onResult) onResult(result);
  }

  async function play(uci, { animate = true } = {}) {
    const c = new Chess(st.fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    st.fen = c.fen();
    board.setPosition(st.fen, { lastMove: { from: m.from, to: m.to }, animate });
    if (onMoveSound) onMoveSound(m);
    return m;
  }

  async function advance() {
    st.step++;
    if (st.step >= puzzle.solution.length) return finish(!st.revealed);
    board.setInteractive(false);
    await wait(450);
    await play(puzzle.solution[st.step]);
    st.step++;
    board.setInteractive(puzzle.color);
    status('Good. Keep going: find the next move.', 'good');
  }

  board.onMove(async (mv) => {
    if (st.done || st.busy) return;
    const uci = mv.from + mv.to + (mv.promotion || '');
    const expected = puzzle.solution[st.step];
    const test = new Chess(st.fen);
    let made;
    try { made = test.move(mv); } catch { return; }

    if (uci === expected || (expected && expected.length === 5 && uci === expected) || test.isCheckmate()) {
      await play(uci);
      status(st.step + 1 >= puzzle.solution.length ? '<b>Correct!</b>' : 'Correct.', 'good');
      return advance();
    }

    // Not the engine move. On the first move, ask the engine whether it's just as good.
    st.busy = true;
    board.setInteractive(false);
    await play(uci);
    status('Checking your move…');
    let res = null;
    try { res = await engine.quickEval(test.fen(), 12); } catch { res = null; }
    st.busy = false;
    const reply = res && res.lines[0];
    const winAfter = reply ? 100 - winPercent(reply) : 0;
    const loss = (st.step === 0 ? puzzle.winBefore : 100) - winAfter;
    const bestSan = sanOf(puzzle.fen, puzzle.solution[0]);

    if (st.step === 0 && reply && loss <= 3) {
      st.alt = true;
      status(`<b>That works too!</b> The engine's first choice was ${esc(bestSan)}.`, 'good');
      return finish(true);
    }
    if (st.step === 0 && reply && loss <= 6) {
      st.partial = true;
      status(`<b>Good, but ${esc(bestSan)} is stronger.</b>`, 'warn');
      await wait(900);
      await reset();
      await play(puzzle.solution[0]);
      st.step = 0;
      st.revealed = false;
      return advance();
    }

    st.mistakes++;
    let msg = 'Not quite.';
    if (reply && reply.pv[0]) {
      const ref = sanOf(test.fen(), reply.pv[0]);
      const motif = lineMotifs(test.fen(), reply.pv)[0];
      board.setArrows([{ from: reply.pv[0].slice(0, 2), to: reply.pv[0].slice(2, 4), color: 'var(--arrow-threat)' }]);
      msg = `Not quite. ${esc(made.san)} allows <b>${esc(ref)}</b>${motif ? `, which ${esc(describeMotif(motif))}` : ''}.`;
    } else if (st.step > 0) {
      msg = 'That\'s not the strongest continuation.';
    }
    status(`${msg} Try again.`, 'bad');
    await wait(1700);
    if (!st.done) await reset();
  });

  async function reset() {
    // Back to the position before the current user move.
    const c = new Chess(puzzle.fen);
    for (let k = 0; k < st.step; k++) {
      const u = puzzle.solution[k];
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    }
    st.fen = c.fen();
    board.setPosition(st.fen);
    board.setInteractive(puzzle.color);
  }

  async function reveal() {
    if (st.done) return;
    st.revealed = true;
    board.setInteractive(false);
    $('.solver-actions').hidden = true;
    await reset();
    board.setInteractive(false);
    const rest = puzzle.solution.slice(st.step);
    status(`Answer: <b>${esc(fmtLine(playLine(st.fen, rest, rest.length).sans, st.fen))}</b>`);
    for (const u of rest) { await wait(650); await play(u); }
    finish(false);
  }

  container.querySelector('[data-act="hint"]').addEventListener('click', () => {
    if (st.done) return;
    const expected = puzzle.solution[st.step];
    st.hints++;
    if (st.hints === 1) status(esc(puzzle.hint || 'Look for checks, captures and threats first.'));
    else if (st.hints === 2) { board.setMarks([{ square: expected.slice(0, 2), color: 'var(--hint)', opacity: 0.6 }]); status('This piece moves.'); }
    else if (st.hints === 3) { board.setArrows([{ from: expected.slice(0, 2), to: expected.slice(2, 4), color: 'var(--arrow-best)', dashed: true }]); status('Play the arrow move.'); }
    else reveal();
  });
  container.querySelector('[data-act="reveal"]').addEventListener('click', reveal);

  return {
    board,
    get done() { return st.done; },
    // Plays a line on the solver board (used after solving to show the engine line).
    async showLine(uciLine, fromFen = puzzle.fen) {
      st.fen = fromFen;
      board.setPosition(fromFen);
      for (const u of uciLine) { await wait(650); await play(u); }
    },
  };
}
