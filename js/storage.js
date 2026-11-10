// 월드 저장소 (IndexedDB). 사용할 수 없는 환경이면 메모리에만 저장
const DB = 'mineclone', STORE = 'worlds';
let dbPromise = null;
const memory = new Map();

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}
function tx(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode); const st = t.objectStore(STORE); const r = fn(st);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : true);
      t.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function listWorlds() {
  const db = await openDB();
  let all = db ? await tx(db, 'readonly', (s) => s.getAll()) : null;
  if (!all) all = [...memory.values()];
  return all.map(({ id, name, seed, seedText, mode, created, lastPlayed }) => ({ id, name, seed, seedText, mode, created, lastPlayed }))
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
}
export async function loadWorld(id) {
  const db = await openDB();
  const w = db ? await tx(db, 'readonly', (s) => s.get(id)) : null;
  return w || memory.get(id) || null;
}
export async function saveWorld(data) {
  memory.set(data.id, data);
  const db = await openDB();
  if (db) await tx(db, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(data))));
}
export async function deleteWorld(id) {
  memory.delete(id);
  const db = await openDB();
  if (db) await tx(db, 'readwrite', (s) => s.delete(id));
}

const SETTINGS_KEY = 'mineclone.settings';
export const DEFAULT_SETTINGS = { fov: 70, renderDistance: 4, sensitivity: 100, viewBobbing: true, sound: 70, clouds: true };
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ } }
