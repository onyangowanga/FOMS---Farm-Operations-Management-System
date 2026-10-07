const DB_NAME = "foms-offline";
const DB_VERSION = 1;
let database;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("cache");
      db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function storeTransaction(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const offlineStore = {
  get: (key) => storeTransaction("cache", "readonly", (store) => store.get(key)),
  put: (key, value) => storeTransaction("cache", "readwrite", (store) => store.put(value, key)),
  enqueue: (operation) => storeTransaction("outbox", "readwrite", (store) => store.add({ ...operation, queuedAt: new Date().toISOString() })),
  async pending() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  remove: (id) => storeTransaction("outbox", "readwrite", (store) => store.delete(id))
};
