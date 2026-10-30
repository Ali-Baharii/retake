// Guided review: walks through the key moments of a game. You try first, then see why.

import { createSolver } from './solver.js';
import { puzzleFromPly, hintFor } from './training.js';
import { describeError, moveLabel, LESSONS, themeLabel, fmtLine } from './explain.js';
import { CLASSES } from './analysis.js';
import { ratingBand } from './insights.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function guidedMoments(report, { rating = null } = {}) {
  const me = report.userColor;
  const plies = report.plies;
  const band = ratingBand(rating);
  const errors = plies.filter((p) => p.color === me && ['mistake', 'blunder', 'miss'].includes(p.cls));
  const picked = new Map();
  for (const p of errors.sort((a, b) => b.loss - a.loss).slice(0, 7)) picked.set(p.i, { kind: 'error', p });
  // Fill with inaccuracies when the game was clean (skip quiet positional ones for newer players).
  if (picked.size < 3) {
    const inacc = plies.filter((p) => p.color === me && p.cls === 'inaccuracy' && (band > 0 || (p.why && p.why.cat !== 'positional')));
    for (const p of inacc.sort((a, b) => b.loss - a.loss).slice(0, 3 - picked.size)) picked.set(p.i, { kind: 'error', p });
  }
  for (const p of plies.filter((x) => x.color === me && x.cls === 'great').slice(0, 2)) picked.set(p.i, { kind: 'great', p });
  for (const opp of plies.filter((x) => x.color !== me && x.cls === 'blunder')) {
    const nx = plies[opp.i + 1];
    if (nx && nx.color === me && ['best', 'great', 'excellent'].includes(nx.cls) && !picked.has(nx.i) && picked.size < 10) picked.set(nx.i, { kind: 'punished', p: nx });
  }
  return [...picked.values()].sort((a, b) => a.p.i - b.p.i).slice(0, 10);
}

function promptFor(m, plies) {
  const p = m.p;
  const prev = plies[p.i - 1];
  const side = p.color === 'w' ? 'White' : 'Black';
  const time = p.spent != null ? ` You spent ${p.spent < 10 ? p.spent.toFixed(1) : Math.round(p.spent)}s here.` : '';
  if (m.kind === 'great') return { prompt: `${side} to move: only one move works here`, sub: `You found it in the game. Can you find it again?${time}` };
  if (m.kind === 'punished') return { prompt: `${side} to move: your opponent just blundered`, sub: `You punished it in the game. Find the move again.${time}` };
  if (prev && ['mistake', 'blunder'].includes(prev.cls)) return { prompt: `${side} to move: your opponent just made a mistake`, sub: `How do you punish it?${time}` };
  if (p.critical) return { prompt: `${side} to move: a critical moment`, sub: `Only one move keeps the balance.${time}` };
  return { prompt: `${side} to move: find the best move`, sub: time.trim() };
}

// host: element to render into. ctx: { record, report, engine, keepPuzzle(puzzle, keep), saveNote(ply, text), notes, onFinish(stats), onOpenMove(ply), sound }
export function startGuided(host, ctx) {
  const { report } = ctx;
  const rating = +(report.userColor === 'w' ? ctx.record.headers.WhiteElo : ctx.record.headers.BlackElo) || null;
  const moments = guidedMoments(report, { rating });
  let idx = 0;
  const stats = { found: 0, total: moments.length };

  if (!moments.length) {
    host.innerHTML = `<div class="card coach-empty"><h3>No key moments to review</h3><p class="muted">You didn't make any mistakes the engine could single out. Check the Report for inaccuracies, or try Train.</p></div>`;
    return;
  }

  function step() {
    const m = moments[idx];
    const p = m.p;
    const puzzle = puzzleFromPly(ctx.record, p) || {
      fen: p.fenBefore, solution: [p.best ? p.best.uci : p.uci], color: p.color, winBefore: p.winBefore,
      hint: hintFor(['positional']), bestSan: p.best ? p.best.san : p.san, themes: ['positional'],
    };
    const { prompt, sub } = promptFor(m, report.plies);
    host.innerHTML = `
      <div class="coach-head"><span class="muted small">Moment ${idx + 1} of ${moments.length} · move ${p.moveNo}</span>
        <div class="coach-dots">${moments.map((_, k) => `<i class="${k < idx ? 'done' : k === idx ? 'now' : ''}"></i>`).join('')}</div></div>
      <div class="coach-solver"></div>
      <div class="coach-reveal" hidden></div>`;
    createSolver(host.querySelector('.coach-solver'), puzzle, {
      engine: ctx.engine, prompt, sub,
      onMoveSound: ctx.sound,
      onResult: (r) => {
        if (r.solved && r.firstTry && !r.hints) stats.found++;
        showReveal(m, puzzle, r);
      },
    });
  }

  function showReveal(m, puzzle, result) {
    const p = m.p;
    const box = host.querySelector('.coach-reveal');
    const cls = CLASSES[p.cls];
    const d = p.why ? describeError(p) : null;
    const theme = puzzle.themes ? puzzle.themes[0] : null;
    const verdict = result.solved && result.firstTry && !result.hints ? 'You found it.' : result.solved ? 'Solved with some help.' : 'Here\'s the answer.';
    let body;
    if (m.kind === 'error') {
      body = `<p class="reveal-played"><span class="badge" style="--c: var(--c-${p.cls})">${cls.glyph}</span>In the game you played <b>${esc(moveLabel(p.moveNo, p.color, p.san))}</b>, ${cls.label.toLowerCase()}.</p>
        ${d ? `<p class="reveal-why"><b>${esc(d.headline)}.</b> ${esc(d.detail)}</p>` : ''}
        <p class="line"><b>Best: ${esc(p.best ? p.best.san : '')}</b>${p.bestLine.length > 1 ? ' · ' + esc(fmtLine(p.bestLine, p.fenBefore)) : ''}</p>`;
    } else {
      body = `<p class="reveal-played"><span class="badge" style="--c: var(--c-${p.cls})">${cls.glyph}</span>You played <b>${esc(moveLabel(p.moveNo, p.color, p.san))}</b> in the game. ${m.kind === 'great' ? 'It was the only move that kept your position.' : 'Exactly the right punishment.'}</p>
        <p class="line">Engine line: ${esc(fmtLine(p.bestLine, p.fenBefore))}</p>`;
    }
    const lesson = theme && LESSONS[theme] ? `<p class="lesson"><span class="chip">${esc(themeLabel(theme))}</span> ${esc(LESSONS[theme])}</p>` : '';
    const note = (ctx.notes && ctx.notes[p.i]) || '';
    box.innerHTML = `
      <div class="card reveal-card">
        <div class="reveal-verdict ${result.solved ? 'good' : ''}">${verdict}</div>
        ${body}
        ${lesson}
        <div class="reveal-tools">
          <button type="button" class="btn ghost" data-act="line">Play best line</button>
          <button type="button" class="btn ghost" data-act="board">Open in game</button>
        </div>
        ${m.kind === 'error' ? `<label class="toggle"><input type="checkbox" data-act="keep" checked> Keep this position in my training</label>` : ''}
        <label class="note-label" for="coach-note">What were you thinking? (optional)</label>
        <textarea id="coach-note" rows="2" placeholder="e.g. I thought the knight was protected">${esc(note)}</textarea>
        <button type="button" class="btn primary" data-act="next">${idx + 1 < moments.length ? 'Next moment' : 'Finish review'}</button>
      </div>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const solverHost = host.querySelector('.coach-solver');
    box.querySelector('[data-act="line"]').addEventListener('click', async () => {
      const s = solverHost.__line || null;
      if (s) return;
      solverHost.__line = true;
      const solver = createSolver(solverHost, puzzle, { engine: ctx.engine, prompt: 'Best line', onMoveSound: ctx.sound });
      solverHost.querySelector('.solver-actions').hidden = true;
      solver.board.setInteractive(false);
      await solver.showLine(p.bestPv.slice(0, 8), p.fenBefore);
      solverHost.__line = false;
    });
    box.querySelector('[data-act="board"]').addEventListener('click', () => ctx.onOpenMove(p.i));
    const keep = box.querySelector('[data-act="keep"]');
    if (keep) keep.addEventListener('change', () => ctx.keepPuzzle(puzzleFromPly(ctx.record, p), keep.checked));
    const ta = box.querySelector('#coach-note');
    ta.addEventListener('change', () => ctx.saveNote(p.i, ta.value.trim()));
    box.querySelector('[data-act="next"]').addEventListener('click', () => {
      if (ta.value.trim() !== note) ctx.saveNote(p.i, ta.value.trim());
      idx++;
      if (idx < moments.length) { step(); host.scrollIntoView({ block: 'start' }); } else finish();
    });
  }

  function finish() {
    ctx.onFinish(stats);
  }

  step();
}
