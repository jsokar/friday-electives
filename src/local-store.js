// Local test mode: the whole database lives in this browser (IndexedDB) on this computer.
// The Supabase store (supabase-store.js) replaces this once the cloud project exists.
const DB_NAME = 'friday-electives';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export const localStore = {
  mode: 'local',
  async load() {
    return tx('readonly', (s) => s.get('db'));
  },
  async save(data) {
    await tx('readwrite', (s) => s.put(data, 'db'));
  },
  async reset() {
    await tx('readwrite', (s) => s.delete('db'));
  },
  async loadRoster() {
    const res = await fetch('../seed/roster.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Roster not found. Run: npm run import');
    return res.json();
  },
  photoBase: '../seed/',
};
