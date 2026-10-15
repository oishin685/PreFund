import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../src/services/storageService.js', import.meta.url), 'utf8')).replace(/^import .*idbHelper\.js';/m, `const getDirectoryHandle = async () => globalThis.savedHandle; const setDirectoryHandle = async h => { globalThis.savedHandle = h; }; const delDirectoryHandle = async () => { globalThis.savedHandle = null; };`);
const { createStorageService, validateData } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const dataset = (name = '合成口座') => ({ accounts: [{ id: 'a', name, initialBalance: 0, startMonth: '2026-01' }], items: [{ id: 'i', accountId: 'a', name: '合成項目', targetAmount: 100, startMonth: '2026-01', useMonth: '2026-12' }], categoryBalances: { a: { '2026-09': 123 } } });
const empty = { accounts: [], items: [] };
function fail(name) { return Object.assign(new Error(name), { name }); }
class Directory {
    constructor(files = {}) { this.name = 'synthetic'; this.files = new Map(Object.entries(files).map(([name, value], i) => [name, { text: typeof value === 'string' ? value : JSON.stringify(value), modified: i + 1 }])); this.writes = []; this.permission = 'granted'; this.failName = null; }
    async queryPermission() { return this.permission; }
    async requestPermission() { return this.permission; }
    async *entries() { for (const name of this.files.keys()) yield [name, { kind: 'file' }]; }
    async getFileHandle(name, options = {}) {
        if (this.permission !== 'granted') throw fail('NotAllowedError');
        if (!this.files.has(name)) { if (!options.create) throw fail('NotFoundError'); this.files.set(name, { text: '', modified: 0 }); }
        return {
            getFile: async () => ({ text: async () => this.files.get(name).text, lastModified: this.files.get(name).modified }),
            createWritable: async () => {
                if (name === this.failName) throw fail('QuotaExceededError');
                let pending;
                return { write: async text => { pending = text; }, close: async () => { this.files.set(name, { text: pending, modified: Date.now() }); this.writes.push(name); }, abort: async () => {} };
            }
        };
    }
    data(name = 'data.json') { return JSON.parse(this.files.get(name).text); }
}
beforeEach(() => { const map = new Map(); globalThis.localStorage = { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }; globalThis.savedHandle = null; globalThis.window = {}; });
async function connect(dir, current = empty) { const svc = createStorageService(); window.showDirectoryPicker = async () => dir; const result = await svc.setupStorage(current); return { svc, result }; }
test('Reconnect reads existing file, retains monthly balances, and writes nothing', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc, result } = await connect(dir);
    assert.equal(result.success, true); assert.deepEqual(result.data, dataset()); assert.deepEqual(dir.writes, []); assert.equal(await svc.isConnected(), true);
});
test('An empty primary loads an intact backup without changing either file', async () => {
    const dir = new Directory({ 'data.json': empty, 'data.backup.json': dataset() }); const { result } = await connect(dir);
    assert.equal(result.recovered, true); assert.deepEqual(result.data, dataset()); assert.deepEqual(dir.data(), empty); assert.deepEqual(dir.writes, []);
});
test('Corrupt primary/backup falls back to a valid dated backup', async () => {
    const dir = new Directory({ 'data.json': '{', 'data.backup.json': '{', 'prefund_backup_2026-09-01.json': dataset() }); const { result } = await connect(dir);
    assert.equal(result.success, true); assert.equal(result.source, 'prefund_backup_2026-09-01.json'); assert.deepEqual(dir.writes, []);
});
test('Newest empty backup cannot hide an older valid backup', async () => {
    const dir = new Directory({ 'data.json': empty, 'prefund_backup_2026-08-01.json': dataset(), 'data.backup.json': empty }); const { result } = await connect(dir);
    assert.equal(result.source, 'prefund_backup_2026-08-01.json');
});
test('Empty/corrupt folder without recovery data cannot be adopted for migration', async () => {
    const dir = new Directory({ 'data.json': empty }); const { svc, result } = await connect(dir, dataset());
    assert.equal(result.success, false); assert.equal(svc.directoryHandle, null); assert.deepEqual(dir.writes, []);
});
test('A truly new folder is connected without writing; first edit creates primary', async () => {
    const dir = new Directory(); const { svc, result } = await connect(dir, dataset());
    assert.equal(result.success, true); assert.deepEqual(dir.writes, []); await svc.save(dataset()); assert.deepEqual(dir.data(), dataset());
});
test('Startup from backup is read-only and preserves source in metadata', async () => {
    const dir = new Directory({ 'data.json': empty, 'data.backup.json': dataset() }); savedHandle = dir; const svc = createStorageService(); await svc.init();
    assert.deepEqual(await svc.load(), dataset()); assert.equal(svc.lastLoad.recovered, true); assert.deepEqual(dir.writes, []);
});
test('Expired permission loads mirror but blocks file save without prompting', async () => {
    const dir = new Directory({ 'data.json': dataset() }); dir.permission = 'prompt'; savedHandle = dir; localStorage.setItem('prefund_user_data', JSON.stringify(dataset('鏡')));
    const svc = createStorageService(); await svc.init(); assert.equal((await svc.load()).accounts[0].name, '鏡'); assert.equal(await svc.isConnected(), false);
    await assert.rejects(svc.save(dataset()), /再連携/); assert.deepEqual(dir.writes, []);
});
test('Empty save is blocked for disk and mirror', async () => {
    const dir = new Directory({ 'data.json': dataset(), 'data.backup.json': dataset('以前') }); const { svc } = await connect(dir);
    await assert.rejects(svc.save(empty), /空データ/); assert.deepEqual(dir.data(), dataset()); assert.deepEqual(dir.data('data.backup.json'), dataset('以前')); assert.deepEqual(dir.writes, []);
});
test('Saving after automatic recovery never replaces a good backup with empty primary', async () => {
    const dir = new Directory({ 'data.json': empty, 'data.backup.json': dataset() }); const { svc } = await connect(dir);
    await svc.save(dataset('編集')); assert.deepEqual(dir.data('data.backup.json'), dataset()); assert.equal(dir.data().accounts[0].name, '編集'); assert.ok(dir.writes.some(n => n.startsWith('data.snapshot-')));
});
test('Restore preserves the pre-restore file and source, leaving rotating backup unchanged', async () => {
    const dir = new Directory({ 'data.json': dataset('現在'), 'data.backup.json': dataset('戻す') }); const { svc } = await connect(dir);
    await svc.restoreData(dataset('戻す')); const names = dir.writes.filter(n => n.startsWith('data.snapshot-'));
    assert.equal(names.length, 2); assert.deepEqual(dir.data(names[0]), dataset('現在')); assert.deepEqual(dir.data(names[1]), dataset('戻す')); assert.deepEqual(dir.data(), dataset('戻す')); assert.deepEqual(dir.data('data.backup.json'), dataset('戻す'));
});
test('Backup write failure aborts save before primary or mirror changes', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc } = await connect(dir); dir.failName = 'data.backup.json';
    await assert.rejects(svc.save(dataset('編集')), /QuotaExceededError/); assert.deepEqual(dir.data(), dataset()); assert.deepEqual(JSON.parse(localStorage.getItem('prefund_user_data')), dataset());
});
test('Failed restore does not claim success or update browser mirror', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc } = await connect(dir); dir.failName = 'data.json';
    await assert.rejects(svc.restoreData(dataset('復元')), /QuotaExceededError/); assert.deepEqual(dir.data(), dataset()); assert.deepEqual(JSON.parse(localStorage.getItem('prefund_user_data')), dataset());
});
test('Concurrent save then restore finish in requested order', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc } = await connect(dir);
    await Promise.all([svc.save(dataset('編集')), svc.restoreData(dataset('復元'))]); assert.equal(dir.data().accounts[0].name, '復元');
});
test('Invalid shapes, duplicate IDs, orphan items and invalid monthly balances are rejected', () => {
    for (const value of [null, {}, { accounts: {}, items: [] }, { ...dataset(), accounts: [...dataset().accounts, ...dataset().accounts] }, { ...dataset(), items: [{ id: 'i', name: '孤立', accountId: 'missing' }] }, { ...dataset(), categoryBalances: { a: { '2026-13': 1 } } }, { ...dataset(), categoryBalances: { a: { '2026-09': '123' } } }]) assert.throws(() => validateData(value));
});
test('Picker cancel keeps the original folder and data intact', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc } = await connect(dir); window.showDirectoryPicker = async () => { throw fail('AbortError'); };
    const result = await svc.setupStorage(empty); assert.equal(result.canceled, true); assert.equal(svc.directoryHandle, dir); assert.deepEqual(dir.writes, []);
});
test('Empty restore is rejected', async () => { const svc = createStorageService(); await assert.rejects(svc.restoreData(empty), /空/); });
test('Mirror quota failure never discards data loaded from a connected folder', async () => {
    const dir = new Directory({ 'data.json': dataset() }); localStorage.setItem = () => { throw fail('QuotaExceededError'); };
    const { svc, result } = await connect(dir); assert.equal(result.success, true); assert.deepEqual(result.data, dataset()); assert.ok(svc.lastWarning); assert.deepEqual(dir.writes, []);
    savedHandle = dir; await svc.init(); assert.deepEqual(await svc.load(), dataset()); assert.ok(svc.lastWarning);
});
test('Disk save and restore report success with warning even if mirror storage is full', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc } = await connect(dir); localStorage.setItem = () => { throw fail('QuotaExceededError'); };
    const result = await svc.save(dataset('編集')); assert.equal(result.destination, 'folder'); assert.ok(result.warning); assert.deepEqual(dir.data(), dataset('編集'));
    assert.deepEqual(await svc.restoreData(dataset('復元')), dataset('復元')); assert.ok(svc.lastWarning); assert.deepEqual(dir.data(), dataset('復元'));
});
test('Explicit final-account deletion keeps recovery backup and reloads intentional empty state', async () => {
    const dir = new Directory({ 'data.json': dataset() }); const { svc } = await connect(dir);
    await svc.save(empty, { confirmedClear: true }); assert.equal(dir.data().emptyConfirmed, true); assert.deepEqual(dir.data('data.backup.json'), dataset());
    assert.equal((await svc.load()).accounts.length, 0); assert.equal(svc.lastLoad.recovered, false);
    const choices = await svc.listBackups(); assert.ok(choices.some(x => x.name === 'data.backup.json'));
});
