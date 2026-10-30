// Coaching advice: per-game tips and patterns across all analyzed games.

const ADVICE = {
  allowed_mate: {
    title: 'Allowed checkmate',
    body: 'Before every move, check what your opponent can do with checks. If your king has few escape squares, make room (a pawn move or a defender) before going on the attack.',
    weight: 5,
  },
  missed_mate: {
    title: 'Missed checkmate',
    body: 'When the opponent king is exposed, look at every check first, even ones that sacrifice material. Mate-in-2 puzzles train this pattern quickly.',
    weight: 4,
  },
  hung: {
    title: 'Left material hanging',
    body: 'Before letting go of a piece, ask: "What can my opponent capture now?" Check every undefended piece, especially the one you just moved and the one it used to protect.',
    weight: 4,
  },
  tactic: {
    title: 'Walked into tactics',
    body: 'After choosing a move, picture your opponent\'s checks, captures and threats in that position. Forks, pins and skewers usually start with a check or a capture.',
    weight: 3,
  },
  missed_tactic: {
    title: 'Missed winning tactics',
    body: 'Start each move by scanning your own checks, captures and attacks before thinking about plans. 10–15 tactics puzzles a day trains exactly this.',
    weight: 3,
  },
  miss: {
    title: "Didn't punish mistakes",
    body: 'When your opponent plays something surprising, stop and ask what it left undefended or which squares it gave up. Their errors are your best chances.',
    weight: 2,
  },
  blewWin: {
    title: 'Let a winning position slip',
    body: 'When ahead: trade pieces (not pawns), take away your opponent\'s counterplay first, and keep checking their threats. Winning "slowly" is fine.',
    weight: 4,
  },
  rushed: {
    title: 'Rushed critical moves',
    body: 'Most of these errors came after spending under 3 seconds. Slow down whenever a move captures, gives check, or changes the pawn structure.',
    weight: 2,
  },
  lowClock: {
    title: 'Time trouble',
    body: 'Errors piled up with little time left. Play the opening faster and aim to still have half your clock by move 20.',
    weight: 2,
  },
  positional: {
    title: 'Positional errors',
    body: 'When nothing tactical is happening, find your worst-placed piece and improve it, and avoid pawn moves that leave holes in front of your king.',
    weight: 1,
  },
  endgame: {
    title: 'Endgame technique',
    body: 'In endgames: bring your king to the center, push passed pawns, and put rooks behind passed pawns. Practice basic king-and-pawn and rook endgames.',
    weight: 2,
  },
};

const PHASE_ADVICE = {
  opening: (acc, opening) => `Your opening accuracy was ${acc}%. ${opening ? `Review the ${opening}: ` : ''}learn the main ideas behind the first 6–8 moves (center, development, castling) rather than memorizing lines.`,
  middlegame: (acc) => `Your middlegame accuracy was ${acc}%. Before moving, compare two or three candidate moves and check your opponent's best reply to each.`,
  endgame: (acc) => `Your endgame accuracy was ${acc}%. Activate your king early, create passed pawns, and keep rooks active rather than defending passively.`,
};

function moveLabel(p) {
  return `${p.moveNo}${p.color === 'w' ? '.' : '...'} ${p.san}`;
}

export function gameTips(report, opening) {
  const me = report.userColor;
  const mine = report.plies.filter((p) => p.color === me);
  const sum = report.summary.players[me];
  const tips = [];
  const add = (key, plies, extra) => {
    const a = ADVICE[key];
    tips.push({
      key,
      title: a.title,
      body: extra || a.body,
      plies: plies.map((p) => p.i),
      where: plies.slice(0, 4).map(moveLabel),
      score: a.weight * Math.max(1, plies.length),
    });
  };

  for (const cat of ['allowed_mate', 'missed_mate', 'hung', 'tactic', 'missed_tactic']) {
    const ps = mine.filter((p) => p.why && p.why.cat === cat && p.cls !== 'inaccuracy');
    if (ps.length) add(cat, ps);
  }
  const misses = mine.filter((p) => p.cls === 'miss');
  if (misses.length) add('miss', misses);
  if (report.summary.blewWin) {
    const peak = report.summary.peak;
    const p = report.plies[Math.max(0, peak.ply - 1)];
    add('blewWin', p ? [p] : []);
  }
  const rushed = mine.filter((p) => ['mistake', 'blunder', 'miss'].includes(p.cls) && p.spent != null && p.spent < 3);
  if (rushed.length >= 2) add('rushed', rushed);
  const low = mine.filter((p) => ['mistake', 'blunder', 'miss'].includes(p.cls) && p.lowClock);
  if (low.length >= 2) add('lowClock', low);

  const phases = Object.entries(sum.phases).filter(([, v]) => v && v.moves >= 4);
  if (phases.length >= 2) {
    phases.sort((a, b) => a[1].acc - b[1].acc);
    const [worst, data] = phases[0];
    const bestAcc = phases[phases.length - 1][1].acc;
    if (bestAcc - data.acc >= 8 && data.acc < 85) {
      tips.push({
        key: 'phase-' + worst,
        title: `Weakest phase: ${worst}`,
        body: PHASE_ADVICE[worst](Math.round(data.acc), opening),
        plies: [], where: [], score: 3,
      });
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

// Aggregate patterns across every analyzed game (records from the store).
export function trends(records) {
  const games = records.filter((r) => r.report && r.report.summary).sort((a, b) => a.playedAt - b.playedAt);
  if (!games.length) return null;
  const per = games.map((r) => {
    const me = r.report.userColor;
    const s = r.report.summary.players[me];
    return { r, me, s, sum: r.report.summary };
  });
  const n = per.length;
  const avg = (f) => per.reduce((a, x) => a + (f(x) || 0), 0) / n;

  const catKeys = ['allowed_mate', 'missed_mate', 'hung', 'tactic', 'missed_tactic', 'positional', 'endgame'];
  const issues = [];
  for (const key of catKeys) {
    const total = per.reduce((a, x) => a + (x.s.categories[key] || 0), 0);
    const gamesWith = per.filter((x) => x.s.categories[key]).length;
    if (total) issues.push({ key, total, gamesWith });
  }
  const missTotal = per.reduce((a, x) => a + x.s.counts.miss, 0);
  if (missTotal) issues.push({ key: 'miss', total: missTotal, gamesWith: per.filter((x) => x.s.counts.miss).length });
  const blew = per.filter((x) => x.sum.blewWin).length;
  if (blew) issues.push({ key: 'blewWin', total: blew, gamesWith: blew });
  const rushed = per.reduce((a, x) => a + x.s.rushedErrors, 0);
  if (rushed) issues.push({ key: 'rushed', total: rushed, gamesWith: per.filter((x) => x.s.rushedErrors).length });
  const low = per.reduce((a, x) => a + x.s.lowClockErrors, 0);
  if (low) issues.push({ key: 'lowClock', total: low, gamesWith: per.filter((x) => x.s.lowClockErrors).length });
  for (const it of issues) {
    it.title = ADVICE[it.key].title;
    it.body = ADVICE[it.key].body;
    it.score = ADVICE[it.key].weight * (it.gamesWith / n) * 10 + it.total / n;
  }
  issues.sort((a, b) => b.score - a.score);

  const phaseAvg = {};
  for (const ph of ['opening', 'middlegame', 'endgame']) {
    const xs = per.map((x) => x.s.phases[ph]).filter(Boolean).map((v) => v.acc);
    phaseAvg[ph] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  return {
    games: n,
    record: {
      win: per.filter((x) => x.sum.result === 'win').length,
      loss: per.filter((x) => x.sum.result === 'loss').length,
      draw: per.filter((x) => x.sum.result === 'draw').length,
    },
    accuracy: avg((x) => x.s.accuracy),
    blunders: avg((x) => x.s.counts.blunder),
    mistakes: avg((x) => x.s.counts.mistake),
    inaccuracies: avg((x) => x.s.counts.inaccuracy),
    best: avg((x) => x.s.counts.best + x.s.counts.great),
    phaseAvg,
    issues: issues.slice(0, 5),
    series: per.map((x) => ({ id: x.r.id, at: x.r.playedAt, acc: x.s.accuracy, blunders: x.s.counts.blunder, result: x.sum.result })),
  };
}
