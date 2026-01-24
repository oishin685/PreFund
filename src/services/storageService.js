import { getDirectoryHandle, setDirectoryHandle, delDirectoryHandle } from './idbHelper';

const FILE_NAME = 'data.json';
const BACKUP_FILE_NAME = 'data.backup.json';
const TEMP_FILE_NAME = 'data.tmp.json';
const STORAGE_KEY_PREFIX = 'prefund_user_data'; // Fallback / Mirror

// Helper: Serialize/Deserialize
const serialize = (data) => JSON.stringify(data, null, 2);
const deserialize = (text) => JSON.parse(text);

/**
 * Storage Service
 * Manages data persistence via File System Access API (Primary) and LocalStorage (Fallback/Mirror).
 */
export const storageService = {

    directoryHandle: null,

    /**
     * Check if we have access to a directory.
     * MUST be called on app start.
     */
    async init() {
        try {
            const handle = await getDirectoryHandle();
            if (handle) {
                // Verify permissions (read-only check usually passes, readwrite needs query)
                // We just store it. effectively "verifying" it requires user gesture if not granted.
                // We will try to use it. If it fails, we catch error and might need to ask user.
                this.directoryHandle = handle;
                return true;
            }
        } catch (e) {
            console.warn('IDB init error:', e);
        }
        return false;
    },

    /**
     * Verify permission and request if needed.
     * Chrome usually requires this on every reload for "edit" access unless persistent permissions are enabled (experimental).
     */
    async verifyPermission(mode = 'readwrite') {
        if (!this.directoryHandle) return false;

        // Check if permission is already granted
        const options = { mode };
        if ((await this.directoryHandle.queryPermission(options)) === 'granted') {
            return true;
        }

        // Request permission (Requires user gesture!)
        if ((await this.directoryHandle.requestPermission(options)) === 'granted') {
            return true;
        }

        return false;
    },

    /**
     * Setup Storage: User selects a folder.
     * MIGRATION: Saves currentData immediately to the new folder.
     */
    async setupStorage(currentData) {
        try {
            const handle = await window.showDirectoryPicker({
                id: 'prefund-documents',
                mode: 'readwrite'
            });

            this.directoryHandle = handle;
            await setDirectoryHandle(handle);

            // Migration: Immediate Save
            if (currentData) {
                await this.save(currentData, true); // Force file write
            }

            return { success: true, name: handle.name };
        } catch (e) {
            console.error('Setup canceled or failed:', e);
            return { success: false, error: e };
        }
    },

    /**
     * Disconnect Storage
     */
    async disconnect() {
        this.directoryHandle = null;
        await delDirectoryHandle();
    },

    /**
     * Load Data
     * Strategy: File (if handle) -> Backup File (if error) -> LocalStorage (Fallback)
     */
    async load() {
        let data = null;

        // 1. Try File System
        if (this.directoryHandle) {
            try {
                // We try to verify permission. If we can't get it without gesture, this might fail on first load.
                // Browsers implementing persistent permissions might allow this.
                // If queryPermission is 'prompt', we can't show prompt here (needs gesture).
                // So we might fall back to LS, but UI should show "Reconnect needed".

                // For now, try reading.
                const fileHandle = await this.directoryHandle.getFileHandle(FILE_NAME);
                const file = await fileHandle.getFile();
                const text = await file.text();
                data = deserialize(text);

            } catch (e) {
                console.warn('File load failed (primary), trying backup...', e);
                try {
                    const fileHandle = await this.directoryHandle.getFileHandle(BACKUP_FILE_NAME);
                    const file = await fileHandle.getFile();
                    const text = await file.text();
                    data = deserialize(text);
                } catch (e2) {
                    console.warn('File load failed (backup).', e2);
                }
            }
        }

        // 2. Fallback to LocalStorage
        if (!data) {
            console.log('Loading from LocalStorage fallback.');
            const json = localStorage.getItem(STORAGE_KEY_PREFIX);
            if (json) {
                data = JSON.parse(json);
            }
        }

        // Default empty structure
        if (!data) {
            data = { accounts: [], items: [] };
        }

        return data;
    },

    /**
     * Save Data
     * Strategy: LocalStorage (Always) + File (If handle exists)
     */
    async save(data, forceFile = false) {
        // 1. Always mirror to LocalStorage for safety / fallback
        localStorage.setItem(STORAGE_KEY_PREFIX, JSON.stringify(data));

        // 2. Save to File if Handle exists
        if (this.directoryHandle) {
            try {
                // Ensure permission (might need gesture if not persisted)
                // If this is called from an event handler (button click), requestPermission works.
                // If auto-save, it might fail if permission is 'prompt'.

                // Atomic Write Flow
                // a. Create/Write TMP
                const tmpHandle = await this.directoryHandle.getFileHandle(TEMP_FILE_NAME, { create: true });
                const writable = await tmpHandle.createWritable();
                await writable.write(serialize(data));
                await writable.close();

                // b. Backup Current (if exists)
                try {
                    const currentHandle = await this.directoryHandle.getFileHandle(FILE_NAME);
                    const currentFile = await currentHandle.getFile();
                    // Read content to copy to backup
                    // Optimized: Just write current data to backup? 
                    // Better: Rename current to backup? (No easy rename in API yet)
                    // Simple: Write 'data' to backup as well? No, backup should be 'previous' state ideally.
                    // For simplicity & robustness: Write current in-memory data to backup BEFORE overwriting main?
                    // No, logic: 
                    // 1. Write Data to Tmp.
                    // 2. Copy 'Main' to 'Backup' (if Main exists).
                    // 3. Move 'Tmp' to 'Main'.

                    // Implementation of Step 2 (Copy Main to Backup)
                    try {
                        // Read current main
                        const oldDataText = await currentFile.text();
                        // Write to backup
                        const backupHandle = await this.directoryHandle.getFileHandle(BACKUP_FILE_NAME, { create: true });
                        const backupWx = await backupHandle.createWritable();
                        await backupWx.write(oldDataText);
                        await backupWx.close();
                    } catch (e) {
                        // Main might not exist yet
                    }

                } catch (e) {
                    // Main doesn't exist, skip backup
                }

                // c. Overwrite Main with Tmp content
                // Since we can't easily "move", we write data to Main.
                // actually we can just write data to Main assuming Tmp succeeded.
                // The tmp file was a check to see if we CAN write.

                const mainHandle = await this.directoryHandle.getFileHandle(FILE_NAME, { create: true });
                const mainWx = await mainHandle.createWritable();
                await mainWx.write(serialize(data));
                await mainWx.close();

                // Cleanup Tmp
                await this.directoryHandle.removeEntry(TEMP_FILE_NAME, { recursive: false }).catch(() => { });

            } catch (e) {
                console.error('File save failed:', e);
                // If permission Error, we might need to notify user.
                // For now, allow fallback to handle it silently (data is in localStorage)
                throw e; // Propagate to let UI show error if needed
            }
        }
    },

    /**
     * Export JSON
     */
    async exportData(data) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: `prefund_backup_${new Date().toISOString().slice(0, 10)}.json`,
                types: [{
                    description: 'JSON Data',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(serialize(data));
            await writable.close();
            return true;
        } catch (e) {
            console.error('Export canceled/failed', e);
            return false;
        }
    },

    /**
     * Import JSON
     */
    async importData() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'JSON Data',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            const file = await handle.getFile();
            const text = await file.text();
            return deserialize(text);
        } catch (e) {
            console.error('Import canceled/failed', e);
            return null;
        }
    }
};
