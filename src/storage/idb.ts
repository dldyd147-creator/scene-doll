/** 아주 작은 IndexedDB 래퍼 */

export function openDb(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  return request<T | undefined>(tx.objectStore(store).get(key));
}

export async function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await request(key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key));
}

export async function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await request(tx.objectStore(store).delete(key));
}

export async function idbKeys(db: IDBDatabase, store: string, range?: IDBKeyRange): Promise<IDBValidKey[]> {
  const tx = db.transaction(store, 'readonly');
  return request(tx.objectStore(store).getAllKeys(range));
}
