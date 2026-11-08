// IndexedDB 存储：每条记录（含照片 Blob）存在 entries 仓库里
const DB_NAME = 'parfait-diary';
const STORE = 'entries';
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('datetime', 'datetime');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export const db = {
  all: () => run('readonly', (s) => s.getAll()),
  get: (id) => run('readonly', (s) => s.get(id)),
  put: (entry) => run('readwrite', (s) => { s.put(entry); }),
  remove: (id) => run('readwrite', (s) => { s.delete(id); }),
  putMany: (list) => run('readwrite', (s) => { list.forEach((e) => s.put(e)); }),
};
