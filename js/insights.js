// Coaching advice: per-game tips (adapted to the player's rating) and patterns across games.

import { openingFamily } from './openings.js';
import { MOTIF_TEXT } from './motifs.js';
import { LESSONS } from './explain.js';

const ADVICE = {
  allowed_mate: { title: 'Allowed checkmate', body: 'Before every move, check what your opponent can do with checks. If your king has few escape squares, make room (a pawn move or a defender) before going on the attack.', weight: 5, band: [5, 4, 4] },
  missed_mate: { title: 'Missed checkmate', body: 'When the enemy king is exposed, look at every check first, even ones that sacrifice material. Mate-in-2 puzzles train this pattern quickly.', weight: 4, band: [4, 4, 4] },
  hung: { title: 'Left material hanging', body: 'Before letting go of a piece, ask: "What can my opponent capture now?" Check every undefended piece, especially the one you just moved and the one it used to protect.', weight: 4, band: [6, 4, 3] },
  tactic: { title: 'Walked into tactics', body: 'After choosing a move, picture your opponent\'s checks, captures and threats in that position. Forks, pins and skewers usually start with a check or a capture.', weight: 3, band: [3, 4, 3] },
  missed_tactic: { title: 'Missed winning tactics', body: 'Start each move by scanning your own checks, captures and attacks before thinking about plans. 10–15 tactics puzzles a day trains exactly this.', weight: 3, band: [3, 4, 3] },
  threat: { title: 'Ignored your opponent\'s threats', body: 'After every opponent move, ask "what does it threaten?" before thinking about your own plans. Most blunders come from skipping this question.', weight: 4, band: [5, 4, 3] },
  miss: { title: "Didn't punish mistakes", body: 'When your opponent plays something surprising, stop and ask what it left undefended or which squares it gave up. Their errors are your best chances.', weight: 2, band: [2, 3, 3] },
  blewWin: { title: 'Let a winning position slip', body: 'When ahead: trade pieces (not pawns), take away your opponent\'s counterplay first, and keep checking their threats. Winning "slowly" is fine.', weight: 4, band: [3, 4, 4] },
  rushed: { title: 'Rushed critical moves', body: 'Most of these errors came after spending under 3 seconds. Slow down whenever a move captures, gives check, or changes the pawn structure.', weight: 2, band: [2, 2, 3] },
  lowClock: { title: 'Time trouble', body: 'Errors piled up with little time left. Play the opening faster and aim to still have half your clock by move 20.', weight: 2, band: [1, 2, 3] },
  positional: { title: 'Positional errors', body: 'When nothing tactical is happening, find your worst-placed piece and improve it, and avoid pawn moves that leave holes in front of your king.', weight: 1, band: [1, 1, 3] },
  endgame: { title: 'Endgame technique', body: 'In endgames: bring your king to the center, push passed pawns, and put rooks behind passed pawns. Practice basic king-and-pawn and rook endgames.', weight: 2, band: [1, 2, 3] },
  criticalTime: { title: 'Spend time where it matters', body: 'You moved about as fast in critical positions (where only one move works) as in easy ones. When captures and checks are in the air, take a real look.', weight: 2, band: [1, 2, 3] },
};

const PHASE_ADVICE = {
  opening: (acc, opening) => `Your opening accuracy was ${acc}%. ${opening ? `Review the ${opening}: ` : ''}learn the main ideas behind the first 6–8 moves (center, development, castling) rather than memorizing lines.`,
  middlegame: (acc) => `Your middlegame accuracy was ${acc}%. Before moving, compare two or three candidate moves and check your opponent's best reply to each.`,
  endgame: (acc) => `Your endgame accuracy was ${acc}%. Activate your king early, create passed pawns, and keep rooks active rather than defending passively.`,
};

// 0: under 1200, 1: 1200–1800, 2: above 1800 (unknown ratings count as the middle band).
export function ratingBand(rating) {
  if (!rating) return 1;
  return rating < 1200 ? 0 : rating < 1800 ? 1 : 2;
}

function moveLabel(p) {
  return `${p.moveNo}${p.color === 'w' ? '.' : '...'} ${p.san}`;
}

export function userRating(headers, color) {
  return +(color === 'w' ? headers.WhiteElo : headers.BlackElo) || null;
}

export function gameTips(report, opening, { rating = null } = {}) {
  const me = report.userColor;
  const band = ratingBand(rating);
  const mine = report.plies.filter((p) => p.color === me);
  const sum = report.summary.players[me];
  const tips = [];
  const add = (key, plies, extra = {}) => {
    const a = ADVICE[key];
    tips.push({
      key,
      title: extra.title || a.title,
      body: extra.body || a.body,
      plies: plies.map((p) => p.i),
      where: plies.slice(0, 4).map(moveLabel),
      score: (a.band ? a.band[band] : a.weight) * Math.max(1, plies.length),
    });
  };
  const serious = (p) => ['mistake', 'blunder', 'miss'].includes(p.cls);

  for (const cat of ['allowed_mate', 'missed_mate', 'hung', 'tactic', 'missed_tactic']) {
    const ps = mine.filter((p) => p.why && p.why.cat === cat && p.cls !== 'inaccuracy');
    if (!ps.length) continue;
    // Name the pattern when one dominates: "Missed forks" reads better than "Missed winning tactics".
    const motif = ps[0].why.motifs && ps[0].why.motifs[0] && ps[0].why.motifs[0].type;
    const same = motif && ps.every((p) => p.why.motifs[0] && p.why.motifs[0].type === motif);
    if (same && cat === 'missed_tactic' && LESSONS[motif]) add(cat, ps, { title: `Missed: ${MOTIF_TEXT[motif].toLowerCase()}`, body: LESSONS[motif] });
    else if (same && cat === 'tactic' && LESSONS[motif]) add(cat, ps, { title: `Walked into: ${MOTIF_TEXT[motif].toLowerCase()}`, body: LESSONS[motif] });
    else add(cat, ps);
  }
  const ignored = mine.filter((p) => p.why && p.why.threat && p.why.threat.ignored && serious(p));
  if (ignored.length) add('threat', ignored);
  const misses = mine.filter((p) => p.cls === 'miss');
  if (misses.length) add('miss', misses);
  if (report.summary.blewWin) {
    const p = report.plies[Math.max(0, report.summary.peak.ply - 1)];
    add('blewWin', p ? [p] : []);
  }
  const rushed = mine.filter((p) => serious(p) && p.spent != null && p.spent < 3);
  if (rushed.length >= 2) add('rushed', rushed);
  const low = mine.filter((p) => serious(p) && p.lowClock);
  if (low.length >= 2) add('lowClock', low);
  if (sum.criticalSpent != null && sum.avgSpent != null && sum.avgSpent > 2 && sum.criticalSpent < sum.avgSpent * 1.1 && rushed.length) {
    add('criticalTime', mine.filter((p) => p.critical).slice(0, 3));
  }

  const phases = Object.entries(sum.phases).filter(([, v]) => v && v.moves >= 4);
  if (phases.length >= 2) {
    phases.sort((a, b) => a[1].acc - b[1].acc);
    const [worst, data] = phases[0];
    const bestAcc = phases[phases.length - 1][1].acc;
    if (bestAcc - data.acc >= 8 && data.acc < 85) {
      tips.push({ key: 'phase-' + worst, title: `Weakest phase: ${worst}`, body: PHASE_ADVICE[worst](Math.round(data.acc), opening), plies: [], where: [], score: 3 });
    }
  }

  const positional = mine.filter((p) => p.why && (p.why.cat === 'positional' || p.why.cat === 'endgame') && ['mistake', 'blunder'].includes(p.cls));
  if (positional.length) add(positional[0].why.cat, positional);

  if (!tips.length) {
    const c = sum.counts;
    tips.push({
      key: 'clean',
      title: c.blunder + c.mistake === 0 ? 'Clean game' : 'Solid game',
      body: 'No major tactical errors. To improve further, review the moves marked Inaccuracy and compare them with the engine\'s choice: most are about piece activity.',
      plies: [], where: [], score: 0,
    });
  }
  return tips.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Lightweight per-game summary kept in its own store so insights stay fast.
export function indexEntry(record) {
  const r = record.report;
  const me = r.userColor, opp = me === 'w' ? 'b' : 'w';
  const s = r.summary.players[me];
  const h = record.headers || {};
  const firstErr = r.plies.find((p) => p.color === me && ['mistake', 'blunder', 'miss'].includes(p.cls));
  return {
    id: record.id,
    playedAt: record.playedAt,
    analyzedAt: record.analyzedAt,
    source: record.source || 'chess.com',
    tcKind: record.tcKind || '',
    result: r.summary.result,
    userColor: me,
    rating: userRating(h, me),
    oppRating: userRating(h, opp),
    opponent: me === 'w' ? h.Black : h.White,
    opening: r.opening && r.opening.name ? r.opening.name : record.opening || '',
    family: openingFamily(r.opening && r.opening.name ? r.opening.name : record.opening || ''),
    bookPlies: r.opening ? r.opening.bookPlies : 0,
    accuracy: s.accuracy,
    oppAccuracy: r.summary.players[opp].accuracy,
    counts: s.counts,
    categories: s.categories,
    themes: s.themes || {},
    motifs: s.motifs || {},
    lostPieces: s.lostPieces || {},
    phases: Object.fromEntries(Object.entries(s.phases).map(([k, v]) => [k, v ? v.acc : null])),
    errorMoves: s.errorMoves || [],
    firstErrorMove: firstErr ? firstErr.moveNo : null,
    rushed: s.rushedErrors,
    lowClock: s.lowClockErrors,
    avgSpent: s.avgSpent,
    criticalSpent: s.criticalSpent,
    blewWin: r.summary.blewWin,
    savedLoss: !!r.summary.savedLoss,
    peak: r.summary.peak ? r.summary.peak.win : null,
    trough: r.summary.trough ? r.summary.trough.win : null,
    ignoredThreats: r.plies.filter((p) => p.color === me && p.why && p.why.threat && p.why.threat.ignored && p.cls !== 'inaccuracy').length,
  };
}

const sumBy = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);

export function filterEntries(entries, { tc = 'all', days = 0 } = {}) {
  const since = days ? Date.now() - days * 86400000 : 0;
  return entries.filter((e) => (tc === 'all' || (e.tcKind || '').toLowerCase() === tc) && (!since || e.playedAt >= since));
}

export function trends(entries) {
  const per = [...entries].sort((a, b) => a.playedAt - b.playedAt);
  const n = per.length;
  if (!n) return null;
  const avg = (f) => sumBy(per, f) / n;

  const issueKeys = ['allowed_mate', 'missed_mate', 'hung', 'tactic', 'missed_tactic', 'positional', 'endgame'];
  const issues = [];
  for (const key of issueKeys) {
    const total = sumBy(per, (e) => e.categories[key]);
    if (total) issues.push({ key, total, gamesWith: per.filter((e) => e.categories[key]).length });
  }
  const extra = [
    ['miss', (e) => e.counts.miss],
    ['threat', (e) => e.ignoredThreats],
    ['blewWin', (e) => (e.blewWin ? 1 : 0)],
    ['rushed', (e) => e.rushed],
    ['lowClock', (e) => e.lowClock],
  ];
  for (const [key, f] of extra) {
    const total = sumBy(per, f);
    if (total) issues.push({ key, total, gamesWith: per.filter((e) => f(e)).length });
  }
  for (const it of issues) {
    it.title = ADVICE[it.key].title;
    it.body = ADVICE[it.key].body;
    it.score = ADVICE[it.key].weight * (it.gamesWith / n) * 10 + it.total / n;
  }
  issues.sort((a, b) => b.score - a.score);

  const phaseAvg = {};
  for (const ph of ['opening', 'middlegame', 'endgame']) {
    const xs = per.map((e) => e.phases[ph]).filter((v) => v != null);
    phaseAvg[ph] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  const motifs = {};
  for (const e of per) for (const [k, v] of Object.entries(e.motifs || {})) motifs[k] = (motifs[k] || 0) + v;
  const lostPieces = {};
  for (const e of per) for (const [k, v] of Object.entries(e.lostPieces || {})) lostPieces[k] = (lostPieces[k] || 0) + v;

  const buckets = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 999]].map(([a, b]) => ({ label: b > 100 ? `${a}+` : `${a}–${b}`, count: 0 }));
  for (const e of per) for (const mv of e.errorMoves) {
    const k = mv <= 10 ? 0 : mv <= 20 ? 1 : mv <= 30 ? 2 : mv <= 40 ? 3 : 4;
    buckets[k].count++;
  }

  const winning = per.filter((e) => e.peak != null && e.peak >= 85);
  const losing = per.filter((e) => e.trough != null && e.trough <= 15);
  const crit = per.filter((e) => e.criticalSpent != null && e.avgSpent != null);

  return {
    games: n,
    record: { win: per.filter((e) => e.result === 'win').length, loss: per.filter((e) => e.result === 'loss').length, draw: per.filter((e) => e.result === 'draw').length },
    accuracy: avg((e) => e.accuracy),
    blunders: avg((e) => e.counts.blunder),
    mistakes: avg((e) => e.counts.mistake),
    inaccuracies: avg((e) => e.counts.inaccuracy),
    best: avg((e) => e.counts.best + e.counts.great),
    phaseAvg,
    issues: issues.slice(0, 5),
    motifs: Object.entries(motifs).sort((a, b) => b[1] - a[1]),
    lostPieces: Object.entries(lostPieces).sort((a, b) => b[1] - a[1]),
    errorTiming: buckets,
    conversion: winning.length ? { games: winning.length, won: winning.filter((e) => e.result === 'win').length } : null,
    saves: losing.length ? { games: losing.length, saved: losing.filter((e) => e.result !== 'loss').length } : null,
    criticalTime: crit.length ? { critical: sumBy(crit, (e) => e.criticalSpent) / crit.length, overall: sumBy(crit, (e) => e.avgSpent) / crit.length } : null,
    series: per.map((e) => ({ id: e.id, at: e.playedAt, acc: e.accuracy, blunders: e.counts.blunder, result: e.result })),
  };
}

export function openingReport(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!e.family) continue;
    const key = `${e.family}|${e.userColor}`;
    if (!groups.has(key)) groups.set(key, { family: e.family, color: e.userColor, games: [] });
    groups.get(key).games.push(e);
  }
  return [...groups.values()].map((g) => {
    const n = g.games.length;
    const score = g.games.reduce((a, e) => a + (e.result === 'win' ? 1 : e.result === 'draw' ? 0.5 : 0), 0);
    const accs = g.games.map((e) => e.accuracy).filter((v) => v != null);
    const openAcc = g.games.map((e) => e.phases.opening).filter((v) => v != null);
    const firsts = g.games.map((e) => e.firstErrorMove).filter(Boolean).sort((a, b) => a - b);
    return {
      family: g.family,
      color: g.color,
      games: n,
      score: score / n,
      accuracy: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
      openingAccuracy: openAcc.length ? openAcc.reduce((a, b) => a + b, 0) / openAcc.length : null,
      firstErrorMove: firsts.length ? firsts[Math.floor(firsts.length / 2)] : null,
      ids: g.games.map((e) => e.id),
    };
  }).sort((a, b) => b.games - a.games);
}

// Weekly goal progress: average blunders per game since Monday.
export function weekProgress(entries, goal) {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  const week = entries.filter((e) => e.playedAt >= d.getTime());
  const avg = week.length ? sumBy(week, (e) => e.counts.blunder) / week.length : null;
  return { games: week.length, avg, goal, met: avg != null && avg <= goal };
}
