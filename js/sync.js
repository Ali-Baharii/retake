// Background analysis queue (new games from Chess.com/Lichess) and screen wake lock.

export function createQueue({ analyze, onChange }) {
  const q = { items: [], running: null, paused: false };
  const changed = () => { try { onChange(q); } catch { /* UI errors shouldn't stop the queue */ } };

  async function pump() {
    if (q.running || q.paused) return;
    const next = q.items.find((i) => i.status === 'queued');
    if (!next) { changed(); return; }
    next.status = 'running';
    next.progress = null;
    const ctrl = new AbortController();
    q.running = { item: next, ctrl };
    changed();
    try {
      await analyze(next, ctrl.signal, (pr) => { next.progress = pr; changed(); });
      next.status = 'done';
    } catch (e) {
      next.status = e && e.name === 'AbortError' ? 'queued' : 'error';
      next.error = e && e.message;
    }
    q.running = null;
    changed();
    if (!q.paused) setTimeout(pump, 50);
  }

  return {
    state: q,
    add(items) {
      let added = 0;
      for (const it of items) {
        if (q.items.some((x) => x.key === it.key && x.status !== 'error')) continue;
        q.items.push({ ...it, status: 'queued' });
        added++;
      }
      changed();
      pump();
      return added;
    },
    // Manual analysis takes priority: pause the queue (the current game resumes later).
    pause() {
      q.paused = true;
      if (q.running) q.running.ctrl.abort();
    },
    resume() {
      q.paused = false;
      pump();
    },
    pending() { return q.items.filter((i) => i.status === 'queued' || i.status === 'running').length; },
    clearDone() { q.items = q.items.filter((i) => i.status === 'queued' || i.status === 'running'); changed(); },
  };
}

// Keeps the screen on while the engine works (iPhone pauses web apps when the screen sleeps).
export function createWakeLock() {
  let lock = null;
  let wanted = false;
  async function acquire() {
    if (!wanted || lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch {
      lock = null;
    }
  }
  document.addEventListener('visibilitychange', acquire);
  return {
    set(on) {
      wanted = on;
      if (on) acquire();
      else if (lock) { lock.release().catch(() => {}); lock = null; }
    },
  };
}
