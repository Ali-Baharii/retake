// Everything is stored on the device. IndexedDB holds games, puzzles, a per-game summary
// index (for fast insights), an engine-result cache and small meta values.

const DB_NAME = 'blundercheck';
const DB_VERSION = 2;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('index')) db.createObjectStore('index', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('puzzles')) {
          const p = db.createObjectStore('puzzles', { keyPath: 'id' });
          p.createIndex('gameId', 'gameId');
        }
        if (!db.objectStoreNames.contains('evalcache')) {
          const c = db.createObjectStore('evalcache', { keyPath: 'k' });
          c.createIndex('t', 't');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Close other Retake tabs and try again.'));
    });
  }
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function makeStore(name) {
  return {
    put: (record) => run(name, 'readwrite', (s) => s.put(record)),
    putMany: (records) => run(name, 'readwrite', (s) => { for (const r of records) s.put(r); }),
    get: (id) => run(name, 'readonly', (s) => s.get(id)),
    all: () => run(name, 'readonly', (s) => s.getAll()),
    remove: (id) => run(name, 'readwrite', (s) => s.delete(id)),
    clear: () => run(name, 'readwrite', (s) => s.clear()),
    count: () => run(name, 'readonly', (s) => s.count()),
    byIndex: (index, value) => run(name, 'readonly', (s) => s.index(index).getAll(value)),
  };
}

export const games = makeStore('games');
export const gameIndex = makeStore('index');
export const puzzles = makeStore('puzzles');
const cacheStore = makeStore('evalcache');
const metaStore = makeStore('meta');

export const meta = {
  get: async (key, fallback = null) => {
    const r = await metaStore.get(key).catch(() => null);
    return r ? r.value : fallback;
  },
  set: (key, value) => metaStore.put({ key, value }).catch(() => {}),
};

// Engine results keyed by position + depth. Opening positions repeat across games.
const CACHE_LIMIT = 40000;
export const evalCache = {
  async get(key) {
    const r = await cacheStore.get(key).catch(() => null);
    return r ? r.v : null;
  },
  set(key, value) {
    return cacheStore.put({ k: key, v: value, t: Date.now() }).catch(() => {});
  },
  async prune() {
    const n = await cacheStore.count().catch(() => 0);
    if (n <= CACHE_LIMIT) return;
    const toDelete = n - Math.floor(CACHE_LIMIT * 0.75);
    await openDb().then((db) => new Promise((resolve) => {
      const t = db.transaction('evalcache', 'readwrite');
      let left = toDelete;
      t.objectStore('evalcache').index('t').openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur || left-- <= 0) return;
        cur.delete();
        cur.continue();
      };
      t.oncomplete = resolve;
      t.onerror = resolve;
    }));
  },
  clear: () => cacheStore.clear(),
};

export async function exportAll() {
  const [g, p, m] = await Promise.all([games.all(), puzzles.all(), metaStore.all()]);
  return { app: 'retake', version: 2, exportedAt: new Date().toISOString(), settings: loadSettings(), games: g, puzzles: p, meta: m };
}

export async function importAll(data) {
  if (!data || !['retake', 'blundercheck'].includes(data.app)) throw new Error("This file isn't a Retake backup.");
  if (Array.isArray(data.games)) await games.putMany(data.games);
  if (Array.isArray(data.puzzles)) await puzzles.putMany(data.puzzles);
  if (Array.isArray(data.meta)) await metaStore.putMany(data.meta);
  if (data.settings) saveSettings({ ...loadSettings(), ...data.settings });
  return { games: (data.games || []).length, puzzles: (data.puzzles || []).length };
}

export async function wipeAll() {
  await Promise.all([games.clear(), gameIndex.clear(), puzzles.clear(), cacheStore.clear(), metaStore.clear()]);
}

const SETTINGS_KEY = 'blundercheck.settings';
const DEFAULTS = {
  username: '',
  lichessUsername: '',
  preset: 'balanced',
  autoSync: 'off',          // 'off' | 'last3' | 'all'
  puzzleInaccuracies: false,
  newPerDay: 15,
  boardTheme: 'slate',
  sound: false,
  blunderGoal: 1,
  onboarded: false,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
