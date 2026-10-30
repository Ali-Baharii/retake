// SVG chessboard. Pieces come from vendor/pieces.svg (40×40 units each), inlined once.

import { CLASSES } from './analysis.js';

const FILES = 'abcdefgh';
const SQ = 40;
const PIECE_ID = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

export async function loadPieces() {
  if (document.getElementById('piece-defs')) return;
  const text = await fetch('./vendor/pieces.svg').then((r) => r.text());
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  holder.setAttribute('id', 'piece-defs');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  for (const id of ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']) {
    const g = doc.getElementById(id);
    if (g) defs.appendChild(document.importNode(g, true));
  }
  holder.appendChild(defs);
  document.body.prepend(holder);
}

function squareXY(sq, flipped) {
  const f = FILES.indexOf(sq[0]);
  const r = +sq[1] - 1;
  return flipped ? { x: (7 - f) * SQ, y: r * SQ } : { x: f * SQ, y: (7 - r) * SQ };
}

function arrow(from, to, color, flipped, width = 7) {
  const a = squareXY(from, flipped), b = squareXY(to, flipped);
  const x1 = a.x + SQ / 2, y1 = a.y + SQ / 2, x2 = b.x + SQ / 2, y2 = b.y + SQ / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = 14;
  const ex = x2 - ux * head, ey = y2 - uy * head;
  const px = -uy, py = ux;
  return `<g opacity="0.82" pointer-events="none">
    <line x1="${x1 + ux * 8}" y1="${y1 + uy * 8}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
    <polygon points="${x2},${y2} ${ex + px * 11},${ey + py * 11} ${ex - px * 11},${ey - py * 11}" fill="${color}"/>
  </g>`;
}

export function renderBoard(el, { fen, flipped = false, lastMove = null, cls = null, bestMove = null }) {
  const rows = fen.split(' ')[0].split('/');
  let squares = '', pieces = '', labels = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = FILES[f] + (8 - r);
      const { x, y } = squareXY(sq, flipped);
      const light = (r + f) % 2 === 0;
      squares += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="var(${light ? '--sq-light' : '--sq-dark'})"/>`;
    }
  }
  if (lastMove) {
    for (const sq of [lastMove.from, lastMove.to]) {
      const { x, y } = squareXY(sq, flipped);
      squares += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="var(--c-${cls || 'last'})" opacity="0.42"/>`;
    }
  }
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const sq = FILES[f] + (8 - r);
      const { x, y } = squareXY(sq, flipped);
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      pieces += `<use href="#${color}${PIECE_ID[ch.toLowerCase()]}" x="${x}" y="${y}"/>`;
      f++;
    }
  });
  for (let k = 0; k < 8; k++) {
    const file = flipped ? FILES[7 - k] : FILES[k];
    const rank = flipped ? k + 1 : 8 - k;
    const fileLight = (k + 7) % 2 === 0;
    const rankLight = k % 2 === 0;
    labels += `<text x="${k * SQ + SQ - 2.5}" y="${8 * SQ - 2.5}" text-anchor="end" class="coord" fill="var(${fileLight ? '--sq-dark' : '--sq-light'})">${file}</text>`;
    labels += `<text x="2.5" y="${k * SQ + 9}" class="coord" fill="var(${rankLight ? '--sq-dark' : '--sq-light'})">${rank}</text>`;
  }
  let overlay = '';
  if (bestMove) overlay += arrow(bestMove.slice(0, 2), bestMove.slice(2, 4), 'var(--arrow-best)', flipped);
  if (lastMove && cls && CLASSES[cls]) {
    const { x, y } = squareXY(lastMove.to, flipped);
    const glyph = CLASSES[cls].glyph;
    overlay += `<g pointer-events="none"><circle cx="${x + SQ - 6}" cy="${y + 6}" r="8.5" fill="var(--c-${cls})" stroke="var(--surface)" stroke-width="1.5"/>
      <text x="${x + SQ - 6}" y="${y + 9.4}" text-anchor="middle" class="badge-glyph">${glyph}</text></g>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${8 * SQ} ${8 * SQ}" role="img" aria-label="Chess board">${squares}${labels}${pieces}${overlay}</svg>`;
}

export function renderEvalBar(el, { winWhite, label, flipped }) {
  const white = Math.max(2, Math.min(98, winWhite));
  el.innerHTML = `<div class="evalbar-fill" style="height:${white}%"></div><span class="evalbar-label ${winWhite >= 50 ? 'on-white' : 'on-black'}">${label}</span>`;
  el.classList.toggle('flipped', !!flipped);
}
