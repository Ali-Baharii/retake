// Opening names and "book" positions from lichess-org/chess-openings (CC0).
// data/openings.json is built by tools/build-openings.mjs:
//   { names: { <hash>: [eco, name] }, book: "<hash>,<hash>,..." }

let dataPromise = null;

// cyrb53: fast 53-bit string hash; keys are base-36 hashes of the position (EPD).
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function epd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function loadOpenings(loader) {
  if (!dataPromise) {
    const load = loader || (() => fetch('./data/openings.json').then((r) => {
      if (!r.ok) throw new Error('openings data missing');
      return r.json();
    }));
    dataPromise = Promise.resolve().then(load).then((d) => ({ names: d.names, book: new Set(d.book.split(',')) })).catch(() => null);
  }
  return dataPromise;
}

// fens: positions after each ply (index 0 = after the first move).
// Returns { eco, name, bookPlies } where bookPlies counts the leading moves that are theory.
export function identifyOpening(data, fens) {
  if (!data) return { eco: '', name: '', bookPlies: 0 };
  let eco = '', name = '', bookPlies = 0, inBook = true;
  for (let i = 0; i < fens.length && i < 40; i++) {
    const k = hashKey(epd(fens[i]));
    if (inBook && data.book.has(k)) bookPlies = i + 1; else inBook = false;
    const n = data.names[k];
    if (n) { eco = n[0]; name = n[1]; }
    if (!inBook && i > bookPlies + 6) break;
  }
  return { eco, name, bookPlies };
}

// "Sicilian Defense: Najdorf Variation" → "Sicilian Defense"
export function openingFamily(name) {
  return (name || '').split(':')[0].trim();
}
