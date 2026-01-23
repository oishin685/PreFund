/**
 * Data Service
 * Handles data persistence (currently localStorage) and Google Drive sync.
 */

const STORAGE_PREFIX = 'prefund_';
const CLIENT_ID = '588212021918-rkul7ifd75km8ea31m7lho8t6eb6h2mm.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
const FILE_NAME = 'prefund_app_data.json';

// Global variables for API state
let tokenClient;
let gapiInited = false;
let gisInited = false;

// --- Helper: Dynamic Script Loading ---
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
};

// --- Local Storage Functions ---

/**
 * Loads application data (accounts and items) from local storage.
 * @param {string} key - The user/sync key to identify the dataset.
 * @returns {object} { accounts, items }
 */
export const loadAppData = (key) => {
    if (!key) return { accounts: [], items: [] };

    try {
        const savedAcc = localStorage.getItem(`${STORAGE_PREFIX}${key}_accounts`);
        const savedItems = localStorage.getItem(`${STORAGE_PREFIX}${key}_items`);

        return {
            accounts: savedAcc ? JSON.parse(savedAcc) : [],
            items: savedItems ? JSON.parse(savedItems) : []
        };
    } catch (e) {
        console.error("Failed to load data:", e);
        return { accounts: [], items: [] };
    }
};

/**
 * Saves application data to local storage.
 * @param {string} key - The user/sync key.
 * @param {object} data - { accounts, items } to save.
 */
export const saveAppData = (key, { accounts, items }) => {
    if (!key) return;

    if (accounts !== undefined) {
        localStorage.setItem(`${STORAGE_PREFIX}${key}_accounts`, JSON.stringify(accounts));
    }
    if (items !== undefined) {
        localStorage.setItem(`${STORAGE_PREFIX}${key}_items`, JSON.stringify(items));
    }
};

// --- Google Drive API Functions ---

/**
 * Initializes the Google Drive API (GAPI and GIS).
 */
export const initGoogleDrive = async () => {
    try {
        await Promise.all([
            loadScript("https://apis.google.com/js/api.js"),
            loadScript("https://accounts.google.com/gsi/client")
        ]);

        // Initialize GAPI Client
        await new Promise((resolve) => {
            window.gapi.load('client', async () => {
                await window.gapi.client.init({
                    discoveryDocs: DISCOVERY_DOCS,
                });
                gapiInited = true;
                resolve();
            });
        });

        // Initialize GIS Token Client
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // defined at request time
        });
        gisInited = true;

        console.log("Google Drive API initialized successfully.");
        return true;
    } catch (error) {
        console.error("Error initializing Google Drive API:", error);
        return false;
    }
};

/**
 * Requests an access token from the user.
 */
const requestAccessToken = () => {
    return new Promise((resolve, reject) => {
        tokenClient.callback = (resp) => {
            if (resp.error) {
                reject(resp);
            }
            resolve(resp);
        };
        tokenClient.requestAccessToken({ prompt: 'consent' });
    });
};

/**
 * Searches for the data file in Google Drive.
 */
const findFile = async () => {
    const response = await window.gapi.client.drive.files.list({
        q: `name = '${FILE_NAME}' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    const files = response.result.files;
    return files && files.length > 0 ? files[0] : null;
};

/**
 * Downloads file content from Google Drive.
 */
const downloadFile = async (fileId) => {
    const response = await window.gapi.client.drive.files.get({
        fileId: fileId,
        alt: 'media',
    });
    return response.result; // JSON object
};

/**
 * Uploads (create or update) the file to Google Drive.
 */
const uploadFile = async (content, fileId = null) => {
    const fileContent = JSON.stringify(content);
    const file = new Blob([fileContent], { type: 'application/json' });
    const metadata = {
        name: FILE_NAME,
        mimeType: 'application/json',
    };

    const accessToken = window.gapi.auth.getToken().access_token;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = 'PATCH';
    }

    const response = await fetch(url, {
        method: method,
        headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
        body: form,
    });

    return await response.json();
};

/**
 * Syncs data with Google Drive.
 * Strategy: Merge based on unique IDs (Union).
 * Remote acts as the base, local changes are merged in.
 */
export const syncWithGoogleDrive = async (key, localData) => {
    if (!gapiInited || !gisInited) {
        const success = await initGoogleDrive();
        if (!success) {
            alert("Google APIの初期化に失敗しました。");
            return false;
        }
    }

    try {
        // 1. Authenticate
        await requestAccessToken();

        // 2. Find Remote File
        const remoteFile = await findFile();
        let mergedData = { ...localData };

        if (remoteFile) {
            console.log("Remote file found:", remoteFile.id);
            // 3. Download
            const remoteContent = await downloadFile(remoteFile.id);
            const remoteData = remoteContent[key] || { accounts: [], items: [] };

            // 4. Merge (Simple Union by ID)
            // Note: This simple merge prefers local changes if ID exists in both, 
            // but strictly speaking we should check timestamps. 
            // For now, we fuse lists and deduplicate by ID.

            const mergeLists = (localList, remoteList) => {
                const map = new Map();
                remoteList.forEach(item => map.set(item.id, item));
                localList.forEach(item => map.set(item.id, item)); // Local overwrites remote if same ID
                return Array.from(map.values());
            };

            mergedData = {
                accounts: mergeLists(localData.accounts, remoteData.accounts || []),
                items: mergeLists(localData.items, remoteData.items || [])
            };

            console.log("Merged data:", mergedData);
        } else {
            console.log("No remote file found. Creating new one.");
        }

        // Prepare full JSON to save (supporting multiple users in one file conceptually, though simplified here)
        // We download the whole file content to preserve other users' data if we were supporting that.
        // Since we downloaded `remoteContent` above, we should re-use it.

        // Re-download or use what we have? 
        // To be safe against race conditions in a real app, we'd use versioning, but here:
        // We assume this user owns the file or we just update their key.

        let fullContent = {};
        if (remoteFile) {
            const raw = await downloadFile(remoteFile.id);
            fullContent = raw;
        }

        fullContent[key] = mergedData;

        // 5. Upload
        await uploadFile(fullContent, remoteFile ? remoteFile.id : null);

        // 6. Save Merged Data Locally
        saveAppData(key, mergedData);

        alert("Google Driveとの同期が完了しました！");

        return mergedData; // Return to update UI State

    } catch (error) {
        console.error("Sync failed:", error);
        alert(`同期に失敗しました: ${error.message || error.toString()}`);
        return false;
    }
};
