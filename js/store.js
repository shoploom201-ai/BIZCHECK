/* IndexedDB 저장소 — 모든 데이터는 이 PC의 브라우저 안에만 저장됩니다 (서버 전송 없음) */
(function (root) {
  'use strict';
  const DB = 'geuntae', STORE = 'kv';
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }
  async function get(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  }
  async function set(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  root.Store = { get, set };
})(window);
