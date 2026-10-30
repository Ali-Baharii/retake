// Annotated PGN: engine evals ([%eval]), move grades as NAGs, explanations, best lines and notes.
// Loads in Lichess Studies, Chess.com analysis and most chess apps.

import { describeError, fmtLine } from './explain.js';

const NAG = { great: '$1', inaccuracy: '$6', mistake: '$2', miss: '$2', blunder: '$4' };
const HEADER_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'TimeControl', 'ECO', 'Opening', 'Termination', 'Link'];

function evalTag(e) {
  if (!e) return '';
  if (e.type === 'mate') return e.score === 0 ? '' : `[%eval #${e.score}]`;
  return `[%eval ${(e.score / 100).toFixed(2)}]`;
}

function clean(text) {
  return String(text || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

export function exportPgn(record) {
  const r = record.report;
  const h = { ...(record.headers || {}) };
  if (r.opening && r.opening.name) { h.Opening = r.opening.name; if (r.opening.eco) h.ECO = r.opening.eco; }
  h.Annotator = 'Blundercheck (Stockfish 19)';
  const keys = [...HEADER_ORDER.filter((k) => h[k] != null), ...Object.keys(h).filter((k) => !HEADER_ORDER.includes(k))];
  const head = keys.map((k) => `[${k} "${String(h[k]).replace(/"/g, "'")}"]`).join('\n');

  const notes = record.notes || {};
  const out = [];
  r.plies.forEach((p, idx) => {
    if (p.color === 'w') out.push(`${p.moveNo}.`);
    else if (idx === 0 || out.length === 0 || /}\s*$|\)\s*$/.test(out[out.length - 1])) out.push(`${p.moveNo}...`);
    out.push(p.san + (NAG[p.cls] ? ' ' + NAG[p.cls] : ''));
    const bits = [];
    const ev = evalTag(r.positions[p.i + 1] && r.positions[p.i + 1].eval);
    if (ev) bits.push(ev);
    if (p.clock != null) {
      const s = p.clock, hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = (s % 60).toFixed(1);
      bits.push(`[%clk ${hh}:${String(mm).padStart(2, '0')}:${ss.padStart(4, '0')}]`);
    }
    if (p.why) {
      const d = describeError(p, { mine: p.color === r.userColor });
      if (d) bits.push(clean(`${d.headline}. ${d.detail}`));
    }
    if (notes[p.i]) bits.push(clean(`Note: ${notes[p.i]}`));
    if (bits.length) out.push(`{ ${bits.join(' ')} }`);
    if (p.why && p.best && p.best.uci !== p.uci && p.bestLine.length) {
      out.push(`(${fmtLine(p.bestLine.slice(0, 6), p.fenBefore)})`);
    }
  });
  out.push(h.Result || '*');

  // Wrap long lines for readability.
  const lines = [];
  let cur = '';
  for (const tok of out) {
    if ((cur + ' ' + tok).length > 90 && cur) { lines.push(cur); cur = tok; } else cur = cur ? cur + ' ' + tok : tok;
  }
  if (cur) lines.push(cur);
  return `${head}\n\n${lines.join('\n')}\n`;
}
