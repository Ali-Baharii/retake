// SVG chessboard: display, arrows, highlights, move animation, and tap/drag input with
// legal-move dots and a promotion picker. Pieces come from vendor/pieces.svg (40×40 units each).

import { Chess } from '../vendor/chess.js';
import { CLASSES } from './analysis.js';

const NS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';
const SQ = 40;
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function loadPieces() {
  if (document.getElementById('piece-defs')) return;
  const text = await fetch('./vendor/pieces.svg').then((r) => r.text());
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const holder = document.createElementNS(NS, 'svg');
  holder.setAttribute('id', 'piece-defs');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const defs = document.createElementNS(NS, 'defs');
  for (const id of ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']) {
    const g = doc.getElementById(id);
    if (g) defs.appendChild(document.importNode(g, true));
  }
  holder.appendChild(defs);
  document.body.prepend(holder);
}

function xy(sq, flipped) {
  const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
  return flipped ? { x: (7 - f) * SQ, y: r * SQ } : { x: f * SQ, y: (7 - r) * SQ };
}

function arrowSvg(a, flipped) {
  const p = xy(a.from, flipped), q = xy(a.to, flipped);
  const x1 = p.x + SQ / 2, y1 = p.y + SQ / 2, x2 = q.x + SQ / 2, y2 = q.y + SQ / 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const w = a.width || 7, head = 14;
  const ex = x2 - ux * head, ey = y2 - uy * head, px = -uy, py = ux;
  return `<g opacity="${a.opacity || 0.82}" pointer-events="none">
    <line x1="${x1 + ux * 8}" y1="${y1 + uy * 8}" x2="${ex}" y2="${ey}" stroke="${a.color}" stroke-width="${w}" stroke-linecap="round"${a.dashed ? ' stroke-dasharray="2 9"' : ''}/>
    <polygon points="${x2},${y2} ${ex + px * 11},${ey + py * 11} ${ex - px * 11},${ey - py * 11}" fill="${a.color}"/></g>`;
}

export function createBoard(el, opts = {}) {
  const s = {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    flipped: false,
    interactive: false,      // false | 'w' | 'b' | 'both'
    lastMove: null,          // { from, to }
    cls: null,               // grade badge on lastMove.to
    arrows: [],
    marks: [],               // [{ square, color }]
    onMove: null,            // ({from,to,promotion}) => void
    ...opts,
    selected: null,
    targets: [],
    promo: null,
  };
  let chess = new Chess(s.fen);
  let drag = null;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${8 * SQ} ${8 * SQ}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Chess board');
  svg.classList.add('board-svg');
  el.innerHTML = '';
  el.appendChild(svg);

  function canMove(color) {
    if (!s.interactive) return false;
    return chess.turn() === color && (s.interactive === 'both' || s.interactive === color);
  }

  function render() {
    const rows = s.fen.split(' ')[0].split('/');
    let h = '';
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const { x, y } = xy(FILES[f] + (8 - r), s.flipped);
      h += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="var(${(r + f) % 2 === 0 ? '--sq-light' : '--sq-dark'})"/>`;
    }
    if (s.lastMove) for (const sq of [s.lastMove.from, s.lastMove.to]) {
      const { x, y } = xy(sq, s.flipped);
      h += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="var(--c-${s.cls || 'last'})" opacity="0.42"/>`;
    }
    for (const m of s.marks) {
      const { x, y } = xy(m.square, s.flipped);
      h += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${m.color}" opacity="${m.opacity || 0.5}"/>`;
    }
    if (s.selected) {
      const { x, y } = xy(s.selected, s.flipped);
      h += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="var(--sel)" opacity="0.55"/>`;
    }
    for (let k = 0; k < 8; k++) {
      const file = s.flipped ? FILES[7 - k] : FILES[k];
      const rank = s.flipped ? k + 1 : 8 - k;
      h += `<text x="${k * SQ + SQ - 2.5}" y="${8 * SQ - 2.5}" text-anchor="end" class="coord" fill="var(${(k + 7) % 2 === 0 ? '--sq-dark' : '--sq-light'})">${file}</text>`;
      h += `<text x="2.5" y="${k * SQ + 9}" class="coord" fill="var(${k % 2 === 0 ? '--sq-dark' : '--sq-light'})">${rank}</text>`;
    }
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const sq = FILES[f] + (8 - r);
        const { x, y } = xy(sq, s.flipped);
        h += `<use href="#${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toLowerCase()}" x="${x}" y="${y}" data-sq="${sq}"/>`;
        f++;
      }
    });
    for (const t of s.targets) {
      const { x, y } = xy(t.to, s.flipped);
      h += t.captured
        ? `<circle cx="${x + SQ / 2}" cy="${y + SQ / 2}" r="17" fill="none" stroke="var(--dot)" stroke-width="3.5" pointer-events="none"/>`
        : `<circle cx="${x + SQ / 2}" cy="${y + SQ / 2}" r="6" fill="var(--dot)" pointer-events="none"/>`;
    }
    for (const a of s.arrows) h += arrowSvg(a, s.flipped);
    if (s.lastMove && s.cls && CLASSES[s.cls]) {
      const { x, y } = xy(s.lastMove.to, s.flipped);
      h += `<g pointer-events="none"><circle cx="${x + SQ - 6}" cy="${y + 6}" r="8.5" fill="var(--c-${s.cls})" stroke="var(--surface)" stroke-width="1.5"/>
        <text x="${x + SQ - 6}" y="${y + 9.4}" text-anchor="middle" class="badge-glyph">${CLASSES[s.cls].glyph}</text></g>`;
    }
    if (s.promo) {
      const color = chess.turn();
      const { x } = xy(s.promo.to, s.flipped);
      const top = (s.promo.to[1] === '8') !== s.flipped;
      h += `<rect x="0" y="0" width="${8 * SQ}" height="${8 * SQ}" fill="rgb(0 0 0 / 0.45)" data-promo-cancel="1"/>`;
      ['q', 'r', 'b', 'n'].forEach((p, k) => {
        const y = top ? k * SQ : (7 - k) * SQ;
        h += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="var(--surface)" stroke="var(--hair)" data-promo="${p}"/>
          <use href="#${color}${p}" x="${x}" y="${y}" data-promo="${p}"/>`;
      });
    }
    svg.innerHTML = h;
  }

  function animate(from, to) {
    if (reduceMotion || !from || !to) return;
    const node = svg.querySelector(`use[data-sq="${to}"]`);
    if (!node) return;
    const a = xy(from, s.flipped), b = xy(to, s.flipped);
    node.style.transition = 'none';
    node.style.transform = `translate(${a.x - b.x}px, ${a.y - b.y}px)`;
    node.getBoundingClientRect();
    requestAnimationFrame(() => {
      node.style.transition = 'transform 160ms ease-out';
      node.style.transform = 'translate(0px, 0px)';
    });
  }

  function squareAt(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * 8, py = ((ev.clientY - r.top) / r.height) * 8;
    if (px < 0 || py < 0 || px >= 8 || py >= 8) return null;
    const f = Math.floor(px), rank = Math.floor(py);
    return s.flipped ? FILES[7 - f] + (rank + 1) : FILES[f] + (8 - rank);
  }

  function select(sq) {
    s.selected = sq;
    s.targets = sq ? chess.moves({ square: sq, verbose: true }) : [];
  }

  function attempt(from, to) {
    const options = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return false;
    if (options.some((m) => m.promotion)) {
      s.promo = { from, to };
      s.targets = [];
      render();
      return true;
    }
    finish({ from, to });
    return true;
  }

  function finish(move) {
    s.selected = null;
    s.targets = [];
    s.promo = null;
    render();
    if (s.onMove) s.onMove(move);
  }

  svg.addEventListener('pointerdown', (ev) => {
    if (!s.interactive) return;
    const t = ev.target;
    if (s.promo) {
      if (t.dataset && t.dataset.promo) finish({ from: s.promo.from, to: s.promo.to, promotion: t.dataset.promo });
      else { s.promo = null; render(); }
      return;
    }
    const sq = squareAt(ev);
    if (!sq) return;
    if (s.selected && s.targets.some((m) => m.to === sq)) { attempt(s.selected, sq); return; }
    const p = chess.get(sq);
    if (p && canMove(p.color)) {
      select(sq);
      render();
      const node = svg.querySelector(`use[data-sq="${sq}"]`);
      drag = { from: sq, node, x0: ev.clientX, y0: ev.clientY, moved: false, id: ev.pointerId };
      try { svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      ev.preventDefault();
    } else if (s.selected) {
      select(null);
      render();
    }
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id || !drag.node) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return;
    drag.moved = true;
    const r = svg.getBoundingClientRect();
    const k = (8 * SQ) / r.width;
    const base = xy(drag.from, s.flipped);
    const px = (ev.clientX - r.left) * k - SQ / 2, py = (ev.clientY - r.top) * k - SQ / 2;
    drag.node.style.transform = `translate(${px - base.x}px, ${py - base.y}px) scale(1.08)`;
    drag.node.parentNode.appendChild(drag.node);
  });

  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    const sq = squareAt(ev);
    if (!sq || sq === d.from || !attempt(d.from, sq)) { if (sq !== d.from) select(null); render(); }
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', () => { drag = null; render(); });

  render();

  return {
    get fen() { return s.fen; },
    setPosition(fen, o = {}) {
      s.fen = fen;
      chess = new Chess(fen);
      s.lastMove = o.lastMove || null;
      s.cls = o.cls || null;
      s.arrows = o.arrows || [];
      s.marks = o.marks || [];
      s.selected = null;
      s.targets = [];
      s.promo = null;
      render();
      if (o.animate && s.lastMove) animate(s.lastMove.from, s.lastMove.to);
    },
    setArrows(arrows) { s.arrows = arrows || []; render(); },
    setMarks(marks) { s.marks = marks || []; render(); },
    setInteractive(mode) { s.interactive = mode; select(null); render(); },
    setFlipped(f) { s.flipped = !!f; render(); },
    get flipped() { return s.flipped; },
    onMove(fn) { s.onMove = fn; },
  };
}

export function renderEvalBar(el, { winWhite, label, flipped }) {
  const white = Math.max(2, Math.min(98, winWhite));
  el.innerHTML = `<div class="evalbar-fill" style="height:${white}%"></div><span class="evalbar-label ${winWhite >= 50 ? 'on-white' : 'on-black'}">${label}</span>`;
  el.classList.toggle('flipped', !!flipped);
}
