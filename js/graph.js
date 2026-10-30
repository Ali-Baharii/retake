// Win-chance graph (White's perspective) with tap/drag scrubbing.

const ERR = new Set(['mistake', 'miss', 'blunder']);

export function renderGraph(el, { positions, plies, cur, userColor, onSelect, height = 120 }) {
  const width = Math.max(240, Math.round(el.clientWidth || 320));
  const n = positions.length - 1;
  const pad = 4;
  const x = (k) => pad + (n ? (k / n) * (width - pad * 2) : 0);
  const y = (w) => pad + (1 - w / 100) * (height - pad * 2);

  const pts = positions.map((p, k) => `${x(k).toFixed(1)},${y(p.winWhite).toFixed(1)}`);
  const area = `M${x(0)},${y(0)} L${pts.join(' L')} L${x(n)},${y(0)} Z`;
  const line = `M${pts.join(' L')}`;

  let marks = '';
  for (const p of plies) {
    if (p.color !== userColor || !ERR.has(p.cls)) continue;
    const k = p.i + 1;
    marks += `<circle cx="${x(k)}" cy="${y(positions[k].winWhite)}" r="4" fill="var(--c-${p.cls})" stroke="var(--surface)" stroke-width="2"/>`;
  }
  const cx = x(cur);
  el.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Win chances over the game">
    <rect x="0" y="0" width="${width}" height="${height}" fill="var(--graph-black)" rx="6"/>
    <path d="${area}" fill="var(--graph-white)"/>
    <line x1="${pad}" x2="${width - pad}" y1="${y(50)}" y2="${y(50)}" stroke="var(--graph-mid)" stroke-width="1"/>
    <path d="${line}" fill="none" stroke="var(--graph-line)" stroke-width="1.5" stroke-linejoin="round"/>
    ${marks}
    <line x1="${cx}" x2="${cx}" y1="0" y2="${height}" stroke="var(--accent)" stroke-width="2"/>
  </svg>`;

  const svg = el.firstElementChild;
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const k = Math.round(((px - pad) / (r.width - pad * 2)) * n);
    onSelect(Math.max(0, Math.min(n, k)));
  };
  svg.addEventListener('pointerdown', (ev) => {
    svg.setPointerCapture(ev.pointerId);
    pick(ev);
    const move = (e) => pick(e);
    const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });
}

export function renderTrendChart(el, series) {
  const width = Math.max(260, Math.round(el.clientWidth || 320));
  const height = 140, padL = 30, padR = 10, padT = 10, padB = 18;
  const pts = series.filter((s) => s.acc != null).slice(-30);
  if (pts.length < 2) {
    el.innerHTML = '<p class="muted small">Analyze at least two games to see your trend.</p>';
    return;
  }
  const x = (k) => padL + (k / (pts.length - 1)) * (width - padL - padR);
  const y = (v) => padT + (1 - v / 100) * (height - padT - padB);
  let grid = '';
  for (const v of [0, 50, 100]) {
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--hair)"/>`;
    grid += `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${v}</text>`;
  }
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(p.acc).toFixed(1)}`).join(' ');
  const dots = pts.map((p, k) => `<circle cx="${x(k)}" cy="${y(p.acc)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"><title>${Math.round(p.acc)}% accuracy</title></circle>`).join('');
  const last = pts[pts.length - 1];
  el.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Accuracy per game">
    ${grid}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}
    <text x="${x(pts.length - 1)}" y="${y(last.acc) - 9}" text-anchor="end" class="tick strong">${Math.round(last.acc)}%</text>
    <text x="${padL}" y="${height - 3}" class="tick">oldest</text><text x="${width - padR}" y="${height - 3}" text-anchor="end" class="tick">latest</text>
  </svg>`;
}
