import { getDirectoryHandle, setDirectoryHandle, delDirectoryHandle } from './idbHelper.js';

const FILE_NAME = 'data.json';
const BACKUP_FILE_NAME = 'data.backup.json';
const STORAGE_KEY = 'prefund_user_data';
const serialize = (data) => JSON.stringify(data, null, 2);
const emptyData = () => ({ accounts: [], items: [], categoryBalances: {} });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const error = (message) => new Error(message);

export function validateData(data) {
    if (!isRecord(data) || !Array.isArray(data.accounts) || !Array.isArray(data.items)) {
        throw error('PreFund形式のデータではありません。口座・項目の配列が必要です。');
    }
    const ids = new Set();
    for (const account of data.accounts) {
        if (!isRecord(account) || typeof account.id !== 'string' || !account.id || ids.has(account.id) || typeof account.name !== 'string') {
            throw error('口座の形式またはIDに問題があります。');
        }
        ids.add(account.id);
    }
    const itemIds = new Set();
    for (const item of data.items) {
        if (!isRecord(item) || typeof item.id !== 'string' || !item.id || itemIds.has(item.id) || !ids.has(item.accountId) || typeof item.name !== 'string') {
            throw error('項目の形式または口座との対応に問題があります。');
        }
        itemIds.add(item.id);
    }
    if (data.categoryBalances !== undefined) {
        if (!isRecord(data.categoryBalances)) throw error('月別残高の形式に問題があります。');
        for (const [id, months] of Object.entries(data.categoryBalances)) {
            if (!ids.has(id) || !isRecord(months)) throw error('月別残高の口座との対応に問題があります。');
            for (const [month, amount] of Object.entries(months)) {
                if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || typeof amount !== 'number' || !Number.isFinite(amount)) {
                    throw error('月別残高の月または金額に問題があります。');
                }
            }
        }
    }
    return { ...data, categoryBalances: data.categoryBalances || {} };
}

export const hasData = (data) => data.accounts.length > 0 || data.items.length > 0;
const parse = (text) => validateData(JSON.parse(text));
const backupName = (name) => name === BACKUP_FILE_NAME || /^data\.(backup[.-]|before-|recovery-source-|snapshot-).*\.json$/.test(name) || /^prefund_backup_.*\.json$/.test(name);

async function readFile(handle, name) {
    try {
        const file = await (await handle.getFileHandle(name)).getFile();
        return { name, text: await file.text(), modified: file.lastModified };
    } catch (e) {
        if (e.name === 'NotFoundError') return null;
        throw e; // Permission and I/O failures must never be interpreted as an empty folder.
    }
}

async function backups(handle) {
    const found = [];
    for await (const [name, entry] of handle.entries()) {
        if (entry.kind !== 'file' || !backupName(name)) continue;
        const file = await readFile(handle, name);
        if (!file) continue;
        try {
            const data = parse(file.text);
            if (hasData(data)) found.push({ ...file, data });
        } catch { /* A damaged backup is skipped; it is never overwritten or deleted. */ }
    }
    return found.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

async function inspectFolder(handle) {
    const primary = await readFile(handle, FILE_NAME);
    if (primary) {
        try {
            const data = parse(primary.text);
            if (hasData(data) || data.emptyConfirmed === true) return { data, source: FILE_NAME, recovered: false };
        } catch { /* Search intact backups before offering recovery. */ }
    }
    const candidates = await backups(handle);
    if (candidates.length) return { data: candidates[0].data, source: candidates[0].name, recovered: true };
    // Existing empty/corrupt JSON requires explicit recovery, never migration into that folder.
    let hasExisting = Boolean(primary);
    for await (const [name, entry] of handle.entries()) {
        if (entry.kind === 'file' && backupName(name)) hasExisting = true;
    }
    if (hasExisting) throw error('保存データが空または破損していて、正常なバックアップが見つかりません。別のバックアップを選んで復元してください。');
    return { data: null, source: null, recovered: false };
}

async function writeFile(handle, name, text, create = true) {
    const file = await handle.getFileHandle(name, { create });
    const writable = await file.createWritable();
    try {
        await writable.write(text);
        await writable.close();
    } catch (e) {
        await writable.abort().catch(() => {});
        throw e;
    }
    const saved = await (await file.getFile()).text();
    if (saved !== text) throw error('保存後の内容が一致しません。操作を中止しました。');
}

// Operations are serialized so an older save cannot finish after a restore or reconnect.
export function createStorageService() {
    let queue = Promise.resolve();
    const exclusive = (operation) => {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
    };
    let sequence = 0;
    const snapshot = async (handle, text) => {
        // Check for collisions across reloads/tabs. Never intentionally reuse a snapshot name.
        let name;
        do {
            name = `data.snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-${sequence++}.json`;
        } while (await readFile(handle, name));
        await writeFile(handle, name, text);
        return name;
    };
    const service = {
        directoryHandle: null,
        ready: false,
        lastLoad: { source: null, recovered: false },
        lastWarning: null,
        mirror(text) {
            try { localStorage.setItem(STORAGE_KEY, text); }
            catch { this.lastWarning = 'フォルダへの保存・読み込みは完了しましたが、ブラウザ内の控えを更新できませんでした。'; }
        },
        async init() {
            this.ready = false;
            try { this.directoryHandle = await getDirectoryHandle(); }
            catch { this.directoryHandle = null; }
            return Boolean(this.directoryHandle);
        },
        async isConnected() {
            return this.ready && Boolean(this.directoryHandle) && await this.directoryHandle.queryPermission({ mode: 'readwrite' }) === 'granted';
        },
        async setupStorage(currentData) {
            // Picker must run in the original user gesture, before any async queue work.
            let handle;
            try { handle = await window.showDirectoryPicker({ id: 'prefund-documents', mode: 'readwrite' }); }
            catch (e) { return { success: false, canceled: e.name === 'AbortError', error: e }; }
            return exclusive(async () => {
                try {
                    this.lastWarning = null;
                    const result = await inspectFolder(handle);
                    const data = result.data || validateData(currentData);
                    // Preserve nonempty on-screen data when switching to a different existing dataset.
                    // This backup is local to this browser and is never uploaded.
                    if (hasData(validateData(currentData)) && serialize(validateData(currentData)) !== serialize(data)) {
                        localStorage.setItem('prefund_before_reconnect', serialize(validateData(currentData)));
                    }
                    await setDirectoryHandle(handle);
                    this.directoryHandle = handle;
                    this.ready = true;
                    this.lastLoad = result;
                    this.mirror(serialize(data));
                    return { success: true, name: handle.name, ...result, data };
                } catch (e) { return { success: false, error: e }; }
            });
        },
        async disconnect() {
            return exclusive(async () => { this.ready = false; this.directoryHandle = null; await delDirectoryHandle(); });
        },
        async load() {
            return exclusive(async () => {
                this.ready = false;
                this.lastWarning = null;
                this.lastLoad = { source: 'local', recovered: false };
                if (this.directoryHandle) {
                    // No permission prompt during startup. Reconnect is an explicit button action.
                    if (await this.directoryHandle.queryPermission({ mode: 'read' }) === 'granted') {
                        const result = await inspectFolder(this.directoryHandle);
                        this.ready = await this.directoryHandle.queryPermission({ mode: 'readwrite' }) === 'granted';
                        this.lastLoad = result;
                        if (result.data) {
                            this.mirror(serialize(result.data));
                            return result.data;
                        }
                    }
                }
                const text = localStorage.getItem(STORAGE_KEY);
                return text ? parse(text) : emptyData();
            });
        },
        async save(input, { confirmedClear = false } = {}) {
            const data = validateData(input);
            if (!hasData(data) && !confirmedClear) throw error('空データの保存を停止しました。バックアップから復元してください。');
            if (!hasData(data) && confirmedClear) data.emptyConfirmed = true;
            else delete data.emptyConfirmed;
            const text = serialize(data); // Freeze payload before entering the queue.
            return exclusive(async () => {
                this.lastWarning = null;
                if (this.directoryHandle) {
                    if (!await this.isConnected()) throw error('フォルダを再連携して、保存済みデータを読み込んでください。');
                    const old = await readFile(this.directoryHandle, FILE_NAME);
                    if (old && old.text !== text) {
                        await snapshot(this.directoryHandle, old.text);
                        let previous = null;
                        try { previous = parse(old.text); } catch { /* Keep corrupt original in its snapshot only. */ }
                        if (previous && hasData(previous)) await writeFile(this.directoryHandle, BACKUP_FILE_NAME, old.text);
                    }
                    if (!old || old.text !== text) await writeFile(this.directoryHandle, FILE_NAME, text);
                }
                if (this.directoryHandle) this.mirror(text);
                else localStorage.setItem(STORAGE_KEY, text);
                return { warning: this.lastWarning, destination: this.directoryHandle ? 'folder' : 'local' };
            });
        },
        async listBackups() {
            return exclusive(async () => {
                if (!this.directoryHandle) return [];
                const candidates = await backups(this.directoryHandle);
                return candidates.map(({ name, modified, data }) => ({ name, modified, data }));
            });
        },
        async restoreData(input) {
            const data = validateData(input);
            if (!hasData(data)) throw error('空のバックアップからは復元できません。');
            const text = serialize(data);
            return exclusive(async () => {
                this.lastWarning = null;
                // Preserve browser data before touching it. For folder recovery the disk snapshots
                // remain authoritative even if browser storage is unavailable.
                try {
                    const previous = localStorage.getItem(STORAGE_KEY);
                    if (previous) localStorage.setItem('prefund_before_restore', previous);
                } catch (e) {
                    if (!this.directoryHandle) throw e;
                    this.lastWarning = 'ブラウザ内の控えを保管できませんでした。復元前のファイルはフォルダ内に保管します。';
                }
                if (this.directoryHandle) {
                    // Called from the user's restore confirmation; permission may have expired.
                    if (await this.directoryHandle.queryPermission({ mode: 'readwrite' }) !== 'granted' && await this.directoryHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                        throw error('復元には保存先フォルダへの書き込み許可が必要です。');
                    }
                    const old = await readFile(this.directoryHandle, FILE_NAME);
                    if (old) await snapshot(this.directoryHandle, old.text);
                    await snapshot(this.directoryHandle, text); // Keep the recovery source independently.
                    await writeFile(this.directoryHandle, FILE_NAME, text);
                    this.ready = true;
                }
                if (this.directoryHandle) this.mirror(text);
                else localStorage.setItem(STORAGE_KEY, text);
                return data;
            });
        },
        async exportData(data) {
            try {
                const valid = validateData(data);
                const handle = await window.showSaveFilePicker({ suggestedName: `prefund_backup_${new Date().toISOString().slice(0, 10)}.json`, types: [{ description: 'JSON Data', accept: { 'application/json': ['.json'] } }] });
                const writable = await handle.createWritable();
                await writable.write(serialize(valid));
                await writable.close();
                return true;
            } catch (e) { if (e.name !== 'AbortError') throw e; return false; }
        },
        async importData() {
            try {
                const [handle] = await window.showOpenFilePicker({ types: [{ description: 'PreFund バックアップ', accept: { 'application/json': ['.json'] } }] });
                return parse(await (await handle.getFile()).text());
            } catch (e) { if (e.name !== 'AbortError') throw e; return null; }
        }
    };
    return service;
}

export const storageService = createStorageService();
