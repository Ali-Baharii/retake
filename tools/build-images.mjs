// Writes HTML sources for the social preview image (1200×630) and the app icon.
// Render them with a headless browser, e.g.:
//   msedge --headless=new --window-size=1200,630 --screenshot=og-image.png tools/og.html
import fs from 'node:fs';
import { Chess } from '../vendor/chess.js';

const sprite = fs.readFileSync(new URL('../vendor/pieces.svg', import.meta.url), 'utf8');
const pieceDefs = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'].map((id) => {
  const start = sprite.indexOf(`<g id="${id}"`);
  let depth = 0, i = start;
  for (;;) {
    const o = sprite.indexOf('<g', i), c = sprite.indexOf('</g>', i);
    if (o !== -1 && o < c) { depth++; i = o + 2; } else { depth--; i = c + 4; if (!depth) break; }
  }
  return sprite.slice(start, i);
}).join('\n');

// Badge with a "retry" arrow, drawn as paths so it doesn't depend on fonts.
function retryBadge(cx, cy, r) {
  // A 300° clockwise arc (gap at the top right) with an arrowhead at its end.
  const a0 = (-50 * Math.PI) / 180, a1 = (250 * Math.PI) / 180, rr = r * 0.5;
  const p = (a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const head = r * 0.42;
  const tx = -Math.sin(a1), ty = Math.cos(a1);   // direction of travel at the end
  const nx = Math.cos(a1), ny = Math.sin(a1);
  const pt = (x, y) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const tip = pt(x1 + tx * head * 0.8, y1 + ty * head * 0.8);
  const b1 = pt(x1 + nx * head * 0.55 - tx * head * 0.2, y1 + ny * head * 0.55 - ty * head * 0.2);
  const b2 = pt(x1 - nx * head * 0.55 - tx * head * 0.2, y1 - ny * head * 0.55 - ty * head * 0.2);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#d23c3c" stroke="#fff" stroke-width="${r * 0.17}"/>
    <path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${rr} ${rr} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="#fff" stroke-width="${r * 0.2}" stroke-linecap="round"/>
    <polygon points="${tip} ${b1} ${b2}" fill="#fff"/>`;
}

// App icon: knight on teal with the retry badge.
const knight = pieceDefs.slice(pieceDefs.indexOf('<g id="wn"'), pieceDefs.indexOf('<g id="wp"')).replace('id="wn"', '');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14929d"/><stop offset="1" stop-color="#0b5f67"/></linearGradient></defs>
<rect width="40" height="40" fill="url(#bg)"/>
<g transform="translate(20 20.6) scale(0.86) translate(-20 -20)">${knight}</g>
${retryBadge(30.2, 9.8, 5.3)}
</svg>`;
fs.writeFileSync(new URL('../icons/icon.svg', import.meta.url), icon);
fs.writeFileSync(new URL('./icon.html', import.meta.url), `<!doctype html><html><head><style>html,body{margin:0;background:#0b5f67}svg{display:block;width:100vw;height:100vh}</style></head><body>${icon}</body></html>`);

// Social preview: the sample game's fork (after 4.Nxe5 Qg5) with the explanation.
const c = new Chess();
for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5']) c.move(m);
const SQ = 40, FILES = 'abcdefgh';
const xy = (sq) => ({ x: FILES.indexOf(sq[0]) * SQ, y: (8 - +sq[1]) * SQ });
let board = '';
for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) board += `<rect x="${f * SQ}" y="${r * SQ}" width="40" height="40" fill="${(r + f) % 2 ? '#8ca2ad' : '#dee3e6'}"/>`;
for (const sq of ['d8', 'g5']) { const { x, y } = xy(sq); board += `<rect x="${x}" y="${y}" width="40" height="40" fill="#e27624" opacity="0.45"/>`; }
for (const row of c.board()) for (const p of row) if (p) { const { x, y } = xy(p.square); board += `<use href="#${p.color}${p.type}" x="${x}" y="${y}"/>`; }
const arrow = (from, to, color) => {
  const a = xy(from), b = xy(to);
  const x1 = a.x + 20, y1 = a.y + 20, x2 = b.x + 20, y2 = b.y + 20;
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const ex = x2 - ux * 13, ey = y2 - uy * 13;
  return `<line x1="${x1 + ux * 8}" y1="${y1 + uy * 8}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="7" stroke-linecap="round" opacity="0.85"/>
    <polygon points="${x2},${y2} ${ex - uy * 10},${ey + ux * 10} ${ex + uy * 10},${ey - ux * 10}" fill="${color}" opacity="0.85"/>`;
};
board += arrow('g5', 'e5', '#d23c3c') + arrow('g5', 'g2', '#d23c3c');

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
  body{background:linear-gradient(135deg,#0e7c86,#0a4f56);color:#fff;display:grid;grid-template-columns:1fr 470px;gap:44px;align-items:center;padding:0 60px;box-sizing:border-box}
  h1{font-size:96px;margin:0;letter-spacing:-3px;line-height:1}
  .tag{font-size:36px;margin:14px 0 30px;font-weight:600;line-height:1.2;opacity:.96}
  ul{list-style:none;padding:0;margin:0;display:grid;gap:12px;font-size:25px}
  li::before{content:"";display:inline-block;width:12px;height:12px;border-radius:3px;background:#f2d45c;margin-right:14px;vertical-align:2px}
  .foot{margin-top:34px;font-size:21px;opacity:.85}
  .right{display:grid;gap:14px}
  .board{border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35)}
  .note{background:#fff;color:#111;border-radius:12px;padding:14px 16px;font-size:20px;line-height:1.35;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .note b{color:#d23c3c}
</style></head><body>
<div>
  <h1>Retake</h1>
  <div class="tag">Replay your chess mistakes<br>until they stick</div>
  <ul><li>Guided coach: try first, then learn why</li><li>Tactics named in plain words</li><li>Your mistakes as spaced-repetition puzzles</li></ul>
  <div class="foot">Free · open source · Chess.com + Lichess · runs on your phone</div>
</div>
<div class="right">
  <svg class="board" viewBox="0 0 320 320" width="470" height="470" xmlns="http://www.w3.org/2000/svg"><defs>${pieceDefs}</defs>${board}</svg>
  <div class="note"><b>Walked into a fork.</b> After Nxe5, Qg5 forks the knight on e5 and the pawn on g2.</div>
</div>
</body></html>`;
fs.writeFileSync(new URL('./og.html', import.meta.url), og);
console.log('wrote tools/og.html, tools/icon.html, icons/icon.svg');
