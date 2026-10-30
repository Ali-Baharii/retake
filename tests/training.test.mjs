import { schedule, newSrs, gradeResult, buildQueue, streak, dayKey } from '../js/training.js';

const DAY = 86400000;

export function run(assert) {
  const t0 = new Date(2026, 9, 1, 12).getTime();
  const dayOf = (s) => Math.round((s.due - new Date(2026, 9, 1).getTime()) / DAY);
  let s = schedule(newSrs(), 'good', t0);
  assert(dayOf(s) === 1 && s.reps === 1, `first good → tomorrow (got ${dayOf(s)})`);
  s = schedule(s, 'good', t0);
  assert(s.interval === 3, `second good → 3 days (got ${s.interval})`);
  s = schedule(s, 'good', t0);
  assert(s.interval >= 7 && s.interval <= 8, `third good → ~7 days (got ${s.interval})`);
  const lapsed = schedule(s, 'again', t0);
  assert(lapsed.interval === 1 && lapsed.lapses === 1 && lapsed.ease < s.ease, 'again resets to tomorrow and lowers ease');
  assert(gradeResult({ solved: true, firstTry: true, hints: 0, ms: 4000 }) === 'easy', 'fast clean solve is easy');
  assert(gradeResult({ solved: true, firstTry: true, hints: 1, ms: 4000 }) === 'hard', 'hint makes it hard');
  assert(gradeResult({ solved: false }) === 'again', 'unsolved is again');

  const mk = (id, due, seen, createdAt = 0) => ({ id, themes: ['fork'], createdAt, srs: { ...newSrs(), due, seen } });
  const pool = [mk('a', t0 - 1, true), mk('b', t0 + DAY, true), mk('n1', 0, false, 3), mk('n2', 0, false, 2), mk('n3', 0, false, 1)];
  const q = buildQueue(pool, { now: t0, newPerDay: 2, newSeenToday: 0 });
  assert(q.map((p) => p.id).join() === 'a,n1,n2', `queue = due + capped new (got ${q.map((p) => p.id).join()})`);

  const today = dayKey();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const y2 = new Date(); y2.setDate(y2.getDate() - 2);
  assert(streak([today, dayKey(y.getTime()), dayKey(y2.getTime())]) === 3, 'streak counts consecutive days');
  assert(streak([dayKey(y.getTime())]) === 1, 'streak survives until today is done');
}
