/**
 * Raw IndexedDB Wrapper to avoid 'idb' dependency
 */

const DB_NAME = 'PreFundDB';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const KEY_NAME = 'directoryHandle';

const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
};

export const setDirectoryHandle = async (handle) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(handle, KEY_NAME);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
};

export const getDirectoryHandle = async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(KEY_NAME);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
};

export const delDirectoryHandle = async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(KEY_NAME);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
};
