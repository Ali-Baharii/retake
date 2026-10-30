// Parsing for PGN text exported from Chess.com (or anywhere else).

import { Chess, DEFAULT_POSITION } from '../vendor/chess.js';

const GAME_URL = /https?:\/\/(?:www\.)?chess\.com\/(?:game\/)?(?:live|daily)(?:\/game)?\/(\d+)/i;

export function findGameUrl(text) {
  const m = String(text || '').match(GAME_URL);
  return m ? { url: m[0], id: m[1] } : null;
}

export function gameSource(headers) {
  const site = (headers.Site || '') + (headers.Link || '');
  if (/lichess/i.test(site)) return 'lichess';
  if (/chess\.com/i.test(site)) return 'chess.com';
  return 'pgn';
}

export function looksLikePgn(text) {
  const t = String(text || '');
  return /\[\s*\w+\s+"/.test(t) || /(^|\s)1\.\s*[a-hNBRQKO]/.test(t);
}

function normalize(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  // Keep only the first game if several were pasted.
  const parts = t.split(/\n\s*\n(?=\[Event )/);
  return parts[0];
}

function parseClock(comment) {
  const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(comment || '');
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

export function parseTimeControl(tc) {
  if (!tc || tc === '-' || tc === '?') return null;
  if (tc.includes('/')) return { daily: true, base: null, inc: 0, label: 'Daily' };
  const [base, inc] = tc.split('+').map(Number);
  if (!Number.isFinite(base)) return null;
  const mins = base / 60;
  const label = `${mins >= 1 ? +mins.toFixed(1) : base + 's'}${inc ? ' | ' + inc : ''} min`;
  const total = base + 40 * (inc || 0);
  const kind = total < 180 ? 'Bullet' : total < 600 ? 'Blitz' : total < 3600 ? 'Rapid' : 'Classical';
  return { daily: false, base, inc: inc || 0, label, kind };
}

export function openingName(headers) {
  if (headers.Opening && headers.Opening !== '?') return headers.Opening;
  const url = headers.ECOUrl || '';
  const slug = url.split('/openings/')[1];
  if (!slug) return headers.ECO && headers.ECO !== '?' ? headers.ECO : '';
  const words = [];
  for (const w of decodeURIComponent(slug).split('-')) {
    if (/^\d/.test(w)) break;
    words.push(w);
  }
  return words.join(' ').replace(/\bKings\b/g, "King's").replace(/\bQueens\b/g, "Queen's");
}

// Returns { headers, startFen, moves: [{ san, uci, from, to, color, piece, captured, before, after, clock }], ... }
export function parseGame(text) {
  const pgn = normalize(text);
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (err) {
    throw new Error("That doesn't look like a chess game. Copy the PGN from Chess.com and try again.");
  }
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('This game has no moves to analyze.');

  const clocks = new Map();
  for (const c of chess.getComments()) {
    const s = parseClock(c.comment);
    if (s != null) clocks.set(c.fen, s);
  }

  const timeControl = parseTimeControl(headers.TimeControl);
  const useClocks = !(timeControl && timeControl.daily);
  const moves = history.map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion || ''),
    from: m.from,
    to: m.to,
    color: m.color,
    piece: m.piece,
    captured: m.captured || null,
    before: m.before,
    after: m.after,
    clock: useClocks && clocks.has(m.after) ? clocks.get(m.after) : null,
  }));

  return {
    headers,
    startFen: headers.FEN || history[0].before || DEFAULT_POSITION,
    moves,
    timeControl,
    opening: openingName(headers),
    pgn,
  };
}

export function gameId(game) {
  const h = game.headers;
  if (h.Link) return h.Link;
  if (/lichess\.org\/[a-zA-Z0-9]{8}/.test(h.Site || '')) return h.Site.replace('http://', 'https://').slice(0, 28);
  const key = [h.Site, h.Date, h.White, h.Black, h.Result, game.moves.map((m) => m.uci).join('')].join('|');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'g' + (hash >>> 0).toString(36) + game.moves.length;
}
