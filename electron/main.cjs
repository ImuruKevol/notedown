const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.NOTEDOWN_DEV_URL;
const DIST_DIR = path.resolve(__dirname, '..', 'bundle', 'www');
const APP_NAME = 'Notedown';
const APP_ID = 'com.notedown.app';
const APP_ICON_PATH = path.resolve(__dirname, '..', 'build-resources', 'icon.png');
const TRAY_ICON_PATH = path.resolve(__dirname, '..', 'build-resources', 'tray-icon.png');
const APP_PREFERENCES_FILE = 'app-preferences.json';
let protocolRegistered = false;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let appPreferences = {
    keepInBackgroundOnClose: true
};

const METADATA_FILE = 'metadata.json';
const SYNC_STATE_FILE = '.notedown-sync.json';
const DEFAULT_SYNC_SERVER_URL = 'http://172.16.0.143:5500';
const SYNC_REQUEST_TIMEOUT_MS = 15000;
const IMPORTED_WORKSPACE_ID = '_imported';
const UNFILED_WORKSPACE_ID = 'unfiled';

function expandHome(filePath) {
    if (!filePath) return '';
    if (filePath === '~') return app.getPath('home');
    if (filePath.startsWith('~/')) return path.join(app.getPath('home'), filePath.slice(2));
    return filePath;
}

function normalizeAppPreferences(preferences = {}) {
    return {
        keepInBackgroundOnClose: preferences.keepInBackgroundOnClose !== false
    };
}

function appPreferencesPath() {
    return path.join(app.getPath('userData'), APP_PREFERENCES_FILE);
}

async function readAppPreferences() {
    try {
        const stored = JSON.parse(await fs.readFile(appPreferencesPath(), 'utf8'));
        appPreferences = normalizeAppPreferences(stored);
    } catch (error) {
        appPreferences = normalizeAppPreferences(appPreferences);
    }
    return appPreferences;
}

async function writeAppPreferences(preferences = {}) {
    appPreferences = normalizeAppPreferences({ ...appPreferences, ...preferences });
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(appPreferencesPath(), `${JSON.stringify(appPreferences, null, 2)}\n`, 'utf8');
    syncTrayState();
    return appPreferences;
}

function defaultStoragePath() {
    return path.join(app.getPath('documents'), 'Notedown Notes');
}

function legacyDefaultStoragePath() {
    return path.join(app.getPath('documents'), 'Notedown');
}

function samePath(left, right) {
    return path.resolve(expandHome(left)).toLowerCase() === path.resolve(expandHome(right)).toLowerCase();
}

function normalizeStoragePath(filePath) {
    const expanded = expandHome(filePath || defaultStoragePath());
    return samePath(expanded, legacyDefaultStoragePath()) ? defaultStoragePath() : expanded;
}

function safeWorkspaceId(name) {
    const normalized = String(name || '')
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || UNFILED_WORKSPACE_ID;
}

function safeFileName(name, fallback = 'note') {
    const base = String(name || fallback)
        .replace(/\.md$/i, '')
        .replace(/[/:\\?%*"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || fallback;
    return `${base}.md`;
}

function safeExportFileName(name, extension) {
    const base = String(name || 'note')
        .replace(/\.[a-z0-9]{1,8}$/i, '')
        .replace(/[/:\\?%*"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'note';
    return `${base}.${extension}`;
}

function toPosixPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

function normalizeRelativePath(relativePath) {
    const normalized = toPosixPath(relativePath).replace(/^\/+/g, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('파일 경로가 비어 있습니다.');
    if (parts.some(part => part === '.' || part === '..')) throw new Error('허용되지 않는 파일 경로입니다.');
    if (parts[0] === METADATA_FILE || parts[0] === SYNC_STATE_FILE) throw new Error('동기화할 수 없는 시스템 파일입니다.');
    return parts.join('/');
}

function resolveStorageFile(storagePath, relativePath) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    const root = path.resolve(storagePath);
    const absolutePath = path.resolve(root, ...safeRelativePath.split('/'));
    const relativeFromRoot = path.relative(root, absolutePath);
    if (!relativeFromRoot || relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
        throw new Error('저장소 밖의 파일은 동기화할 수 없습니다.');
    }
    return { relativePath: safeRelativePath, absolutePath };
}

function noteWorkspaceId(note = {}) {
    return note.folder || note.workspace || UNFILED_WORKSPACE_ID;
}

function noteWorkspaceName(note = {}, workspaceId = noteWorkspaceId(note)) {
    return note.workspaceName || note.workspaceLabel || workspaceId;
}

function noteFileName(note = {}) {
    return note.fileName || safeFileName(note.id || note.title, 'note');
}

function relativePathForNote(note = {}) {
    const workspaceId = noteWorkspaceId(note);
    const fileName = noteFileName(note);
    if (note.relativePath) return normalizeRelativePath(note.relativePath);
    return normalizeRelativePath(
        workspaceId === UNFILED_WORKSPACE_ID
            ? fileName
            : path.posix.join(workspaceId, fileName)
    );
}

function noteIdFromRelativePath(relativePath) {
    return `note-${crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 16)}`;
}

function titleFromMarkdown(markdown, fileName) {
    const heading = markdown.split(/\r?\n/).map(line => /^#\s+(.+)$/.exec(line)?.[1]?.trim()).find(Boolean);
    return heading || path.basename(fileName, path.extname(fileName)) || '제목 없음';
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        return false;
    }
}

async function listMarkdownFiles(dirPath, depth = 1, rootPath = dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === METADATA_FILE) continue;
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (depth > 0) {
                files.push(...await listMarkdownFiles(entryPath, depth - 1, rootPath));
            }
            continue;
        }
        if (entry.isFile() && /\.md$/i.test(entry.name)) {
            files.push(path.relative(rootPath, entryPath));
        }
    }

    return files;
}

async function readMarkdownNote(storagePath, metadataNote) {
    const absolutePath = path.join(storagePath, metadataNote.relativePath);
    let body = '';
    try {
        body = await fs.readFile(absolutePath, 'utf8');
    } catch (error) {
        body = '';
    }

    return {
        ...metadataNote,
        body,
        folder: metadataNote.workspace || metadataNote.folder || UNFILED_WORKSPACE_ID
    };
}

async function writeMetadata(storagePath, metadata) {
    await fs.mkdir(storagePath, { recursive: true });
    await fs.writeFile(path.join(storagePath, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function readMetadata(storagePath) {
    const metadataPath = path.join(storagePath, METADATA_FILE);
    if (!await exists(metadataPath)) return null;
    return JSON.parse(await fs.readFile(metadataPath, 'utf8'));
}

async function ensureMetadata(storagePath) {
    const metadata = await readMetadata(storagePath);
    if (metadata) return metadata;
    const generated = await generateMetadata(storagePath, { importDeepMarkdown: false });
    return generated.metadata;
}

function isInsidePath(parentPath, childPath) {
    const relativePath = path.relative(parentPath, childPath);
    return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function syncStatePath(storagePath) {
    return path.join(storagePath, SYNC_STATE_FILE);
}

async function readSyncState(storagePath) {
    try {
        return JSON.parse(await fs.readFile(syncStatePath(storagePath), 'utf8'));
    } catch (error) {
        return {
            serverRevision: 0,
            metadataRevision: 0,
            metadataHash: null,
            files: {}
        };
    }
}

async function writeSyncState(storagePath, state) {
    await fs.mkdir(storagePath, { recursive: true });
    await fs.writeFile(syncStatePath(storagePath), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function writeSyncStateFromManifest(storagePath, manifest, previousState = {}) {
    if (!manifest) return previousState;

    const files = {};
    for (const file of manifest.files || []) {
        if (!file?.relativePath) continue;
        const relativePath = normalizeRelativePath(file.relativePath);
        files[relativePath] = {
            lastKnownRevision: Number(file.revision) || 0,
            contentHash: file.contentHash || null,
            updatedAtMs: Number(file.clientUpdatedAtMs) || null,
            deleted: Boolean(file.deleted)
        };
    }

    const nextState = {
        ...previousState,
        serverRevision: Number(manifest.serverRevision) || 0,
        metadataRevision: Number(manifest.metadata?.revision) || 0,
        metadataHash: manifest.metadata?.contentHash || null,
        files,
        updatedAt: new Date().toISOString()
    };
    await writeSyncState(storagePath, nextState);
    return nextState;
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function removeEmptyParents(dirPath, stopPath) {
    let current = dirPath;
    while (isInsidePath(stopPath, current)) {
        let entries = [];
        try {
            entries = await fs.readdir(current);
        } catch (error) {
            return;
        }
        if (entries.length > 0) return;
        await fs.rmdir(current);
        current = path.dirname(current);
    }
}

async function removeMetadataOrphans(storagePath, previousMetadata, writtenRelativePaths) {
    const root = path.resolve(storagePath);
    const previousNotes = Array.isArray(previousMetadata?.notes) ? previousMetadata.notes : [];

    for (const note of previousNotes) {
        if (!note?.relativePath || writtenRelativePaths.has(note.relativePath)) continue;
        const absolutePath = path.resolve(storagePath, note.relativePath);
        if (!isInsidePath(root, absolutePath) || path.basename(absolutePath) === METADATA_FILE) continue;
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), root);
    }
}

function makeMetadataNote(storagePath, relativePath, workspaceId, workspaceName, body, stat) {
    const fileName = path.basename(relativePath);
    const updatedAtMs = stat?.mtimeMs ? Math.round(stat.mtimeMs) : Date.now();
    const createdAtMs = stat?.birthtimeMs ? Math.round(stat.birthtimeMs) : updatedAtMs;
    return {
        id: noteIdFromRelativePath(relativePath),
        icon: 'N',
        title: titleFromMarkdown(body, fileName),
        tags: [],
        status: 'active',
        workspace: workspaceId,
        workspaceName,
        folder: workspaceId,
        fileName,
        relativePath,
        createdAt: labelForDate(createdAtMs),
        createdAtMs,
        updatedAt: labelForDate(updatedAtMs),
        updatedAtMs
    };
}

function labelForDate(ms) {
    return new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date(ms));
}

async function generateMetadata(storagePath, options = {}) {
    await fs.mkdir(storagePath, { recursive: true });
    const entries = await fs.readdir(storagePath, { withFileTypes: true });
    const workspaces = [{ id: UNFILED_WORKSPACE_ID, name: '미지정 워크스페이스' }];
    const notes = [];
    const knownRelativePaths = new Set();
    let rootMarkdownCount = 0;
    let deepMarkdownCount = 0;
    let copiedDeepCount = 0;

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === METADATA_FILE) continue;
        const entryPath = path.join(storagePath, entry.name);

        if (entry.isFile() && /\.md$/i.test(entry.name)) {
            const relativePath = entry.name;
            const body = await fs.readFile(entryPath, 'utf8');
            const stat = await fs.stat(entryPath);
            notes.push(makeMetadataNote(storagePath, relativePath, UNFILED_WORKSPACE_ID, '미지정 워크스페이스', body, stat));
            knownRelativePaths.add(relativePath);
            rootMarkdownCount++;
            continue;
        }

        if (!entry.isDirectory()) continue;
        const workspaceId = safeWorkspaceId(entry.name);
        workspaces.push({ id: workspaceId, name: entry.name });

        const directFiles = await fs.readdir(entryPath, { withFileTypes: true });
        for (const fileEntry of directFiles) {
            if (!fileEntry.isFile() || !/\.md$/i.test(fileEntry.name)) continue;
            const relativePath = path.join(entry.name, fileEntry.name);
            const body = await fs.readFile(path.join(storagePath, relativePath), 'utf8');
            const stat = await fs.stat(path.join(storagePath, relativePath));
            notes.push(makeMetadataNote(storagePath, relativePath, workspaceId, entry.name, body, stat));
            knownRelativePaths.add(relativePath);
        }
    }

    const allMarkdownFiles = await listMarkdownFiles(storagePath, 20, storagePath);
    const nestedFiles = allMarkdownFiles.filter(relativePath => {
        if (knownRelativePaths.has(relativePath)) return false;
        const parts = relativePath.split(path.sep);
        return parts.length > 2;
    });
    deepMarkdownCount = nestedFiles.length;

    if (options.importDeepMarkdown) {
        const importDir = path.join(storagePath, IMPORTED_WORKSPACE_ID);
        await fs.mkdir(importDir, { recursive: true });
        if (!workspaces.some(workspace => workspace.id === IMPORTED_WORKSPACE_ID)) {
            workspaces.push({ id: IMPORTED_WORKSPACE_ID, name: '가져온 문서' });
        }

        for (const relativePath of nestedFiles) {
            const sourcePath = path.join(storagePath, relativePath);
            const flattenedName = safeFileName(relativePath.split(path.sep).join('_'));
            let targetName = flattenedName;
            let suffix = 2;
            while (await exists(path.join(importDir, targetName))) {
                targetName = safeFileName(`${path.basename(flattenedName, '.md')}_${suffix}`);
                suffix++;
            }

            const targetRelativePath = path.join(IMPORTED_WORKSPACE_ID, targetName);
            await fs.copyFile(sourcePath, path.join(storagePath, targetRelativePath));
            const body = await fs.readFile(path.join(storagePath, targetRelativePath), 'utf8');
            const stat = await fs.stat(path.join(storagePath, targetRelativePath));
            notes.push(makeMetadataNote(storagePath, targetRelativePath, IMPORTED_WORKSPACE_ID, '가져온 문서', body, stat));
            copiedDeepCount++;
        }
    }

    const metadata = {
        version: 1,
        generatedAt: new Date().toISOString(),
        workspaces,
        notes
    };
    await writeMetadata(storagePath, metadata);

    return {
        ok: true,
        storagePath,
        metadataPath: path.join(storagePath, METADATA_FILE),
        notes: notes.length,
        workspaces: workspaces.length,
        rootMarkdownCount,
        deepMarkdownCount,
        copiedDeepCount,
        metadata
    };
}

async function saveNotesToStorage(storagePath, notes) {
    await fs.mkdir(storagePath, { recursive: true });
    const previousMetadata = await readMetadata(storagePath);
    const workspaces = new Map();
    workspaces.set(UNFILED_WORKSPACE_ID, { id: UNFILED_WORKSPACE_ID, name: '미지정 워크스페이스' });
    const metadataNotes = [];
    const writtenRelativePaths = new Set();

    for (const note of notes || []) {
        const workspaceId = noteWorkspaceId(note);
        const workspaceName = noteWorkspaceName(note, workspaceId);
        const fileName = noteFileName(note);
        const relativePath = relativePathForNote(note);
        const { absolutePath } = resolveStorageFile(storagePath, relativePath);

        workspaces.set(workspaceId, { id: workspaceId, name: workspaceName });
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, note.body || '', 'utf8');
        writtenRelativePaths.add(relativePath);

        metadataNotes.push({
            id: note.id,
            icon: note.icon || 'N',
            title: note.title || titleFromMarkdown(note.body || '', fileName),
            tags: Array.isArray(note.tags) ? note.tags : [],
            status: note.status || 'active',
            workspace: workspaceId,
            workspaceName,
            folder: workspaceId,
            fileName,
            relativePath,
            createdAt: note.createdAt || labelForDate(note.createdAtMs || Date.now()),
            createdAtMs: note.createdAtMs || Date.now(),
            updatedAt: note.updatedAt || labelForDate(Date.now()),
            updatedAtMs: note.updatedAtMs || Date.now()
        });
    }

    await writeMetadata(storagePath, {
        version: 1,
        generatedAt: new Date().toISOString(),
        workspaces: Array.from(workspaces.values()),
        notes: metadataNotes
    });
    await removeMetadataOrphans(storagePath, previousMetadata, writtenRelativePaths);

    return { ok: true, notes: metadataNotes.length, workspaces: workspaces.size };
}

function normalizeServerUrl(serverUrl) {
    const rawUrl = String(serverUrl || DEFAULT_SYNC_SERVER_URL).trim();
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP 또는 HTTPS 동기화 서버만 사용할 수 있습니다.');
    return parsed.toString().replace(/\/+$/g, '');
}

function syncConfig(args = {}, requireToken = true) {
    const storagePath = normalizeStoragePath(args.storagePath);
    const serverUrl = normalizeServerUrl(args.serverUrl);
    const token = String(args.token || '').trim();
    const clientId = String(args.clientId || 'notedown-electron').trim() || 'notedown-electron';
    if (requireToken && !token) throw new Error('동기화 서버 로그인이 필요합니다.');
    return { storagePath, serverUrl, token, clientId };
}

async function syncRequest(serverUrl, endpoint, options = {}) {
    const url = new URL(endpoint, `${normalizeServerUrl(serverUrl)}/`).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || SYNC_REQUEST_TIMEOUT_MS);
    const headers = {
        Accept: 'application/json',
        ...(options.headers || {})
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const requestOptions = {
        method: options.method || (options.body == null ? 'GET' : 'POST'),
        headers,
        signal: controller.signal
    };
    if (options.body != null) {
        requestOptions.headers = { ...headers, 'Content-Type': 'application/json' };
        requestOptions.body = JSON.stringify(options.body);
    }

    let response;
    let text = '';
    try {
        response = await net.fetch(url, requestOptions);
        text = await response.text();
    } finally {
        clearTimeout(timeout);
    }
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = { message: text };
        }
    }

    if (!response.ok) {
        const message = data?.message || data?.error || response.statusText || '동기화 서버 요청에 실패했습니다.';
        const err = new Error(message);
        err.status = response.status;
        err.data = data;
        throw err;
    }

    return data;
}

function syncError(error, fallback = '동기화 작업 중 오류가 발생했습니다.') {
    return {
        ok: false,
        error: error instanceof Error && error.message ? error.message : fallback,
        statusCode: error?.status,
        data: error?.data
    };
}

function summarizePlan(plan = {}) {
    return {
        uploadFiles: plan.uploadFiles?.length || 0,
        downloadFiles: plan.downloadFiles?.length || 0,
        deleteServerFiles: plan.deleteServerFiles?.length || 0,
        deleteLocalFiles: plan.deleteLocalFiles?.length || 0,
        conflicts: plan.conflicts?.length || 0
    };
}

function clonePlan(plan = {}) {
    return {
        uploadFiles: [...(plan.uploadFiles || [])],
        downloadFiles: [...(plan.downloadFiles || [])],
        deleteServerFiles: [...(plan.deleteServerFiles || [])],
        deleteLocalFiles: [...(plan.deleteLocalFiles || [])],
        conflicts: [...(plan.conflicts || [])]
    };
}

function planIncludesPath(plan, relativePath) {
    const groups = ['uploadFiles', 'downloadFiles', 'deleteServerFiles', 'deleteLocalFiles', 'conflicts'];
    return groups.some(group => (plan[group] || []).some(item => {
        if (!item?.relativePath) return false;
        return normalizeRelativePath(item.relativePath) === relativePath;
    }));
}

function mapManifestFiles(manifest = {}) {
    const files = new Map();
    for (const file of manifest.files || []) {
        if (!file?.relativePath) continue;
        files.set(normalizeRelativePath(file.relativePath), file);
    }
    return files;
}

function mapMetadataNotes(metadata = {}) {
    const notes = new Map();
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        notes.set(normalizeRelativePath(note.relativePath), note);
    }
    return notes;
}

function mapMetadataWorkspaces(metadata = {}) {
    const workspaces = new Map();
    for (const workspace of metadata.workspaces || []) {
        if (!workspace?.id) continue;
        workspaces.set(workspace.id, workspace);
    }
    return workspaces;
}

function comparableMetadataNote(note) {
    if (!note) return null;
    return {
        id: note.id || '',
        title: note.title || '',
        tags: Array.isArray(note.tags) ? note.tags : [],
        status: note.status || '',
        workspace: note.workspace || note.folder || UNFILED_WORKSPACE_ID,
        workspaceName: note.workspaceName || '',
        fileName: note.fileName || '',
        relativePath: note.relativePath ? normalizeRelativePath(note.relativePath) : '',
        updatedAtMs: Number(note.updatedAtMs) || 0
    };
}

function metadataNoteChanged(left, right) {
    return JSON.stringify(comparableMetadataNote(left)) !== JSON.stringify(comparableMetadataNote(right));
}

async function localFileSyncInfo(storagePath, syncState, relativePath) {
    const state = syncState.files?.[relativePath] || {};
    try {
        const { absolutePath } = resolveStorageFile(storagePath, relativePath);
        const content = await fs.readFile(absolutePath);
        const stat = await fs.stat(absolutePath);
        return {
            exists: true,
            contentHash: sha256(content),
            updatedAtMs: Math.round(stat.mtimeMs),
            state
        };
    } catch (error) {
        return {
            exists: false,
            contentHash: null,
            updatedAtMs: null,
            state
        };
    }
}

function isLocalDirty(localInfo) {
    const knownHash = localInfo.state?.contentHash;
    return Boolean(localInfo.exists && knownHash && localInfo.contentHash && localInfo.contentHash !== knownHash);
}

async function reconcilePlanWithServerMetadata(storagePath, localMetadata, syncState, response) {
    const serverMetadata = response.metadata?.serverMetadata;
    const metadataStatus = response.metadata?.status;
    const plan = clonePlan(response.plan);
    if (!serverMetadata || metadataStatus === 'same' || metadataStatus === 'server_empty') return plan;

    const serverFiles = mapManifestFiles(response.manifest);
    const serverNotes = mapMetadataNotes(serverMetadata);
    const serverWorkspaces = mapMetadataWorkspaces(serverMetadata);
    const localNotes = mapMetadataNotes(localMetadata);

    for (const [relativePath, serverNote] of serverNotes.entries()) {
        if (planIncludesPath(plan, relativePath)) continue;

        const serverFile = serverFiles.get(relativePath);
        if (!serverFile || serverFile.deleted) continue;

        const localInfo = await localFileSyncInfo(storagePath, syncState, relativePath);
        const localNote = localNotes.get(relativePath);
        const serverRevision = Number(serverFile.revision) || 0;
        const knownRevision = Number(localInfo.state?.lastKnownRevision) || 0;
        const hasSyncHistory = knownRevision > 0 || Boolean(localInfo.state?.contentHash);
        const serverHash = serverFile.contentHash || null;
        const fileChanged = !localInfo.exists || Boolean(serverHash && localInfo.contentHash && serverHash !== localInfo.contentHash);
        const metadataChanged = metadataNoteChanged(localNote, serverNote);
        if (!fileChanged && !metadataChanged) continue;

        if (localInfo.exists && !hasSyncHistory) {
            plan.conflicts.push({
                relativePath,
                reason: 'server_metadata_changed_without_sync_history',
                type: 'metadata',
                serverFile,
                serverNote,
                clientNote: localNote || null
            });
            continue;
        }

        if (isLocalDirty(localInfo) && (serverRevision > knownRevision || metadataChanged || fileChanged)) {
            plan.conflicts.push({
                relativePath,
                reason: 'server_metadata_changed_after_local_edit',
                type: 'metadata',
                serverFile,
                serverNote,
                clientNote: localNote || null
            });
            continue;
        }

        plan.downloadFiles.push({
            relativePath,
            reason: fileChanged ? 'server_file_changed' : 'server_metadata_changed',
            serverFile,
            note: serverNote,
            workspace: serverWorkspaces.get(serverNote.workspace || serverNote.folder) || null
        });
    }

    for (const [relativePath, localNote] of localNotes.entries()) {
        if (planIncludesPath(plan, relativePath) || serverNotes.has(relativePath)) continue;

        const localInfo = await localFileSyncInfo(storagePath, syncState, relativePath);
        const knownRevision = Number(localInfo.state?.lastKnownRevision) || 0;
        if (knownRevision <= 0) continue;

        if (isLocalDirty(localInfo)) {
            plan.conflicts.push({
                relativePath,
                reason: 'server_metadata_removed_after_local_edit',
                type: 'metadata',
                serverFile: serverFiles.get(relativePath) || null,
                clientNote: localNote
            });
            continue;
        }

        plan.deleteLocalFiles.push({
            relativePath,
            reason: 'server_metadata_removed',
            note: localNote,
            serverFile: serverFiles.get(relativePath) || null
        });
    }

    return plan;
}

function findMetadataNote(metadata, relativePath, payloadNote) {
    const notes = Array.isArray(metadata?.notes) ? metadata.notes : [];
    const safeRelativePath = relativePath ? normalizeRelativePath(relativePath) : '';
    if (safeRelativePath) {
        const byPath = notes.find(note => note?.relativePath && normalizeRelativePath(note.relativePath) === safeRelativePath);
        if (byPath) return byPath;
    }
    if (payloadNote?.id) {
        const byId = notes.find(note => note?.id === payloadNote.id);
        if (byId) return byId;
    }
    if (!payloadNote) return null;
    return {
        ...payloadNote,
        folder: noteWorkspaceId(payloadNote),
        workspace: noteWorkspaceId(payloadNote),
        workspaceName: noteWorkspaceName(payloadNote),
        fileName: noteFileName(payloadNote),
        relativePath: safeRelativePath || relativePathForNote(payloadNote)
    };
}

function notePayload(note, relativePath) {
    if (!note) return null;
    const workspaceId = noteWorkspaceId(note);
    const { body: _body, ...metadataNote } = note;
    return {
        ...metadataNote,
        workspace: workspaceId,
        folder: workspaceId,
        workspaceName: noteWorkspaceName(note, workspaceId),
        fileName: path.posix.basename(relativePath),
        relativePath
    };
}

function workspacePayload(metadata, note) {
    if (!note) return null;
    const workspaceId = noteWorkspaceId(note);
    const existing = Array.isArray(metadata?.workspaces)
        ? metadata.workspaces.find(workspace => workspace?.id === workspaceId)
        : null;
    return existing || { id: workspaceId, name: noteWorkspaceName(note, workspaceId) };
}

function upsertMetadataWorkspace(metadata, workspace) {
    if (!workspace?.id) return;
    if (!Array.isArray(metadata.workspaces)) metadata.workspaces = [];
    const index = metadata.workspaces.findIndex(item => item?.id === workspace.id);
    if (index >= 0) {
        metadata.workspaces[index] = { ...metadata.workspaces[index], ...workspace };
    } else {
        metadata.workspaces.push(workspace);
    }
}

function upsertMetadataNote(metadata, note) {
    if (!note?.relativePath) return;
    if (!Array.isArray(metadata.notes)) metadata.notes = [];
    const relativePath = normalizeRelativePath(note.relativePath);
    const nextNote = {
        ...note,
        folder: note.folder || note.workspace || UNFILED_WORKSPACE_ID,
        workspace: note.workspace || note.folder || UNFILED_WORKSPACE_ID,
        relativePath
    };
    const index = metadata.notes.findIndex(item => item?.relativePath && normalizeRelativePath(item.relativePath) === relativePath);
    if (index >= 0) {
        metadata.notes[index] = { ...metadata.notes[index], ...nextNote };
    } else {
        metadata.notes.push(nextNote);
    }
}

function removeMetadataNote(metadata, relativePath) {
    if (!Array.isArray(metadata.notes)) return;
    const safeRelativePath = normalizeRelativePath(relativePath);
    metadata.notes = metadata.notes.filter(note => !note?.relativePath || normalizeRelativePath(note.relativePath) !== safeRelativePath);
}

async function buildKnownFiles(storagePath, metadata, syncState) {
    const files = [];
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        const relativePath = normalizeRelativePath(note.relativePath);
        try {
            const { absolutePath } = resolveStorageFile(storagePath, relativePath);
            const content = await fs.readFile(absolutePath);
            const stat = await fs.stat(absolutePath);
            const state = syncState.files?.[relativePath] || {};
            files.push({
                relativePath,
                contentHash: sha256(content),
                lastKnownRevision: Number(state.lastKnownRevision) || 0,
                updatedAtMs: Number(note.updatedAtMs) || Math.round(stat.mtimeMs)
            });
        } catch (error) {
            // Missing local files are represented by metadata differences in the plan response.
        }
    }
    return files;
}

async function createSyncPlan(args = {}) {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
    const metadata = await ensureMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const knownFiles = await buildKnownFiles(storagePath, metadata, syncState);

    const response = await syncRequest(serverUrl, '/api/sync/plan', {
        token,
        body: {
            clientId,
            baseRevision: Number(syncState.serverRevision) || 0,
            knownFiles,
            metadata: {
                body: metadata,
                lastKnownRevision: Number(syncState.metadataRevision) || 0
            }
        }
    });
    response.plan = await reconcilePlanWithServerMetadata(storagePath, metadata, syncState, response);

    return {
        ok: true,
        ...response,
        summary: summarizePlan(response.plan)
    };
}

async function uploadLocalFile(args = {}, relativePathOverride = '') {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
    const metadata = await ensureMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const payloadNote = args.note || null;
    const note = findMetadataNote(metadata, relativePathOverride || args.relativePath, payloadNote);
    const relativePath = normalizeRelativePath(relativePathOverride || args.relativePath || note?.relativePath || relativePathForNote(payloadNote));
    const fileState = syncState.files?.[relativePath] || {};
    const deleted = Boolean(args.deleted);
    const body = {
        clientId,
        baseRevision: Number(syncState.serverRevision) || 0,
        relativePath,
        deleted,
        lastKnownRevision: Number(args.lastKnownRevision) || Number(fileState.lastKnownRevision) || 0
    };

    if (note) {
        body.note = notePayload(note, relativePath);
        body.workspace = workspacePayload(metadata, note);
    }

    if (!deleted) {
        const { absolutePath } = resolveStorageFile(storagePath, relativePath);
        const content = await fs.readFile(absolutePath);
        const stat = await fs.stat(absolutePath);
        body.content = content.toString('base64');
        body.contentEncoding = 'base64';
        body.contentHash = sha256(content);
        body.updatedAtMs = Number(note?.updatedAtMs) || Math.round(stat.mtimeMs);
    }

    const response = await syncRequest(serverUrl, '/api/sync/file', { token, body });
    if (response.manifest) {
        await writeSyncStateFromManifest(storagePath, response.manifest, syncState);
    }

    return {
        ok: response.status === 'ok',
        ...response
    };
}

function encodeRelativePathForUrl(relativePath) {
    return normalizeRelativePath(relativePath).split('/').map(encodeURIComponent).join('/');
}

function decodeFilePayloadContent(payload = {}) {
    if (payload.deleted) return '';
    if (payload.contentEncoding === 'base64') return Buffer.from(payload.content || '', 'base64').toString('utf8');
    return String(payload.content || '');
}

async function downloadServerFile(args = {}, item, metadata) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = await syncRequest(serverUrl, `/api/files/${encodeRelativePathForUrl(relativePath)}`, { token });
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);

    if (payload.deleted) {
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
        removeMetadataNote(metadata, relativePath);
        return { relativePath, deleted: true };
    }

    const content = payload.contentEncoding === 'base64'
        ? Buffer.from(payload.content || '', 'base64')
        : Buffer.from(String(payload.content || ''), 'utf8');
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);

    const note = item.note || {
        id: noteIdFromRelativePath(relativePath),
        icon: 'N',
        title: titleFromMarkdown(content.toString('utf8'), path.posix.basename(relativePath)),
        tags: [],
        status: 'active',
        workspace: item.workspace?.id || UNFILED_WORKSPACE_ID,
        workspaceName: item.workspace?.name,
        fileName: path.posix.basename(relativePath),
        relativePath,
        updatedAtMs: payload.clientUpdatedAtMs || Date.now()
    };
    upsertMetadataWorkspace(metadata, item.workspace || workspacePayload(metadata, note));
    upsertMetadataNote(metadata, notePayload(note, relativePath));
    return { relativePath, deleted: false };
}

async function deleteLocalFile(storagePath, item, metadata) {
    const relativePath = normalizeRelativePath(item.relativePath);
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);
    await fs.rm(absolutePath, { force: true });
    await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
    removeMetadataNote(metadata, relativePath);
    return { relativePath };
}

async function readSyncConflictFile(args = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(args.relativePath);
    const metadata = await ensureMetadata(storagePath);
    const localNote = findMetadataNote(metadata, relativePath, null);
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);
    const result = {
        ok: true,
        relativePath,
        localExists: false,
        localContent: '',
        localNote,
        serverFile: null,
        serverContent: '',
        serverError: '',
        localError: ''
    };

    try {
        result.localContent = await fs.readFile(absolutePath, 'utf8');
        result.localExists = true;
    } catch (error) {
        result.localError = error instanceof Error ? error.message : '로컬 파일을 읽지 못했습니다.';
    }

    try {
        const serverFile = await syncRequest(serverUrl, `/api/files/${encodeRelativePathForUrl(relativePath)}`, { token });
        result.serverFile = serverFile;
        result.serverContent = decodeFilePayloadContent(serverFile);
    } catch (error) {
        result.serverError = error instanceof Error ? error.message : '서버 파일을 읽지 못했습니다.';
    }

    return result;
}

async function resolveSyncConflict(args = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(args.relativePath);
    const resolution = String(args.resolution || '').trim();
    if (!['server', 'local'].includes(resolution)) {
        throw new Error('적용할 충돌 버전을 선택하세요.');
    }

    if (resolution === 'server') {
        const metadata = await ensureMetadata(storagePath);
        const previousState = await readSyncState(storagePath);
        const file = await downloadServerFile(args, {
            relativePath,
            serverFile: args.serverFile || null,
            note: args.serverNote || null,
            workspace: args.serverWorkspace || null
        }, metadata);
        metadata.generatedAt = new Date().toISOString();
        await writeMetadata(storagePath, metadata);

        const manifest = await syncRequest(serverUrl, '/api/manifest', { token });
        await writeSyncStateFromManifest(storagePath, manifest, previousState);
        const planResponse = await createSyncPlan(args);
        return {
            ok: true,
            didApply: true,
            resolution,
            resolvedPath: relativePath,
            file,
            ...planResponse,
            summary: summarizePlan(planResponse.plan || {})
        };
    }

    let lastKnownRevision = Number(args.serverRevision) || Number(args.serverFile?.revision) || 0;
    if (!lastKnownRevision) {
        const serverFile = await syncRequest(serverUrl, `/api/files/${encodeRelativePathForUrl(relativePath)}`, { token });
        lastKnownRevision = Number(serverFile.revision) || 0;
    }

    const uploadResult = await uploadLocalFile({ ...args, lastKnownRevision }, relativePath);
    if (uploadResult.status === 'conflict') {
        return {
            ok: false,
            status: 'conflict',
            didApply: false,
            resolution,
            resolvedPath: relativePath,
            conflicts: [uploadResult.file].filter(Boolean),
            summary: { uploadFiles: 0, downloadFiles: 0, deleteServerFiles: 0, deleteLocalFiles: 0, conflicts: 1 },
            ...uploadResult
        };
    }

    const planResponse = await createSyncPlan(args);
    return {
        ok: true,
        didApply: true,
        resolution,
        resolvedPath: relativePath,
        file: uploadResult.file,
        upload: uploadResult,
        ...planResponse,
        summary: summarizePlan(planResponse.plan || {})
    };
}

async function runFullSync(args = {}) {
    const { storagePath } = syncConfig(args);
    const planResponse = await createSyncPlan(args);
    const plan = planResponse.plan || {};

    if ((plan.conflicts || []).length > 0) {
        return {
            ok: false,
            status: 'conflict',
            didApply: false,
            ...planResponse
        };
    }

    const operations = {
        uploaded: [],
        downloaded: [],
        deletedServer: [],
        deletedLocal: [],
        conflicts: []
    };
    const metadata = await ensureMetadata(storagePath);
    let metadataChanged = false;
    let latestManifest = planResponse.manifest;

    for (const item of plan.downloadFiles || []) {
        operations.downloaded.push(await downloadServerFile(args, item, metadata));
        metadataChanged = true;
    }

    for (const item of plan.deleteLocalFiles || []) {
        operations.deletedLocal.push(await deleteLocalFile(storagePath, item, metadata));
        metadataChanged = true;
    }

    if (metadataChanged) {
        metadata.generatedAt = new Date().toISOString();
        await writeMetadata(storagePath, metadata);
    }

    for (const item of plan.uploadFiles || []) {
        const result = await uploadLocalFile(args, item.relativePath);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.file);
        } else {
            operations.uploaded.push(result.file);
        }
    }

    for (const item of plan.deleteServerFiles || []) {
        const result = await uploadLocalFile({ ...args, deleted: true }, item.relativePath);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.file);
        } else {
            operations.deletedServer.push(result.file);
        }
    }

    if (operations.conflicts.length === 0 && latestManifest) {
        const previousState = await readSyncState(storagePath);
        await writeSyncStateFromManifest(storagePath, latestManifest, previousState);
    }

    return {
        ok: operations.conflicts.length === 0,
        status: operations.conflicts.length > 0 ? 'conflict' : 'ok',
        didApply: true,
        ...planResponse,
        manifest: latestManifest || planResponse.manifest,
        operations
    };
}

function registerStorageHandlers() {
    ipcMain.handle('notedown:storage:default-path', async () => ({ ok: true, storagePath: defaultStoragePath() }));

    ipcMain.handle('notedown:storage:choose-directory', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Notedown 저장소 선택',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
        return { ok: true, storagePath: result.filePaths[0] };
    });

    ipcMain.handle('notedown:storage:info', async (_event, args = {}) => {
        const storagePath = normalizeStoragePath(args.storagePath);
        await fs.mkdir(storagePath, { recursive: true });
        const metadata = await readMetadata(storagePath);
        const shallowMarkdownFiles = await listMarkdownFiles(storagePath, 1, storagePath);
        const allMarkdownFiles = await listMarkdownFiles(storagePath, 20, storagePath);
        const deepMarkdownCount = allMarkdownFiles.filter(relativePath => relativePath.split(path.sep).length > 2).length;

        return {
            ok: true,
            storagePath,
            metadataPath: path.join(storagePath, METADATA_FILE),
            metadataExists: Boolean(metadata),
            notes: metadata?.notes?.length || 0,
            workspaces: metadata?.workspaces?.length || 0,
            shallowMarkdownCount: shallowMarkdownFiles.length,
            deepMarkdownCount
        };
    });

    ipcMain.handle('notedown:storage:initialize', async (_event, args = {}) => {
        const storagePath = normalizeStoragePath(args.storagePath);
        return generateMetadata(storagePath, { importDeepMarkdown: Boolean(args.importDeepMarkdown) });
    });

    ipcMain.handle('notedown:storage:load-notes', async (_event, args = {}) => {
        const storagePath = normalizeStoragePath(args.storagePath);
        let metadata = await readMetadata(storagePath);
        if (!metadata) {
            const generated = await generateMetadata(storagePath, { importDeepMarkdown: false });
            metadata = generated.metadata;
        }
        const notes = await Promise.all((metadata.notes || []).map(note => readMarkdownNote(storagePath, note)));
        return { ok: true, notes, metadata };
    });

    ipcMain.handle('notedown:storage:save-notes', async (_event, args = {}) => {
        const storagePath = normalizeStoragePath(args.storagePath);
        return saveNotesToStorage(storagePath, args.notes || []);
    });
}

function registerSyncHandlers() {
    ipcMain.handle('notedown:sync:health', async (_event, args = {}) => {
        try {
            return { ok: true, ...(await syncRequest(args.serverUrl || DEFAULT_SYNC_SERVER_URL, '/api/health')) };
        } catch (error) {
            return syncError(error, '동기화 서버에 연결하지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:setup-status', async (_event, args = {}) => {
        try {
            return { ok: true, ...(await syncRequest(args.serverUrl || DEFAULT_SYNC_SERVER_URL, '/api/setup/status')) };
        } catch (error) {
            return syncError(error, '동기화 서버 설정 상태를 확인하지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:setup', async (_event, args = {}) => {
        try {
            const data = await syncRequest(args.serverUrl || DEFAULT_SYNC_SERVER_URL, '/api/setup', {
                body: {
                    username: args.username,
                    password: args.password
                }
            });
            return { ok: true, ...data };
        } catch (error) {
            return syncError(error, '동기화 서버 초기 설정에 실패했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:login', async (_event, args = {}) => {
        try {
            const data = await syncRequest(args.serverUrl || DEFAULT_SYNC_SERVER_URL, '/api/login', {
                body: {
                    username: args.username,
                    password: args.password
                }
            });
            return { ok: true, ...data };
        } catch (error) {
            return syncError(error, '동기화 서버 로그인에 실패했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:plan', async (_event, args = {}) => {
        try {
            return await createSyncPlan(args);
        } catch (error) {
            return syncError(error, '동기화 계획을 만들지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:run-full', async (_event, args = {}) => {
        try {
            return await runFullSync(args);
        } catch (error) {
            return syncError(error, '전체 동기화에 실패했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:upload-note', async (_event, args = {}) => {
        try {
            return await uploadLocalFile(args);
        } catch (error) {
            return syncError(error, '문서 동기화에 실패했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:read-file', async (_event, args = {}) => {
        try {
            return await readSyncConflictFile(args);
        } catch (error) {
            return syncError(error, '충돌 파일을 읽지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:resolve-conflict', async (_event, args = {}) => {
        try {
            return await resolveSyncConflict(args);
        } catch (error) {
            return syncError(error, '충돌을 적용하지 못했습니다.');
        }
    });
}

async function saveNotePdf(args = {}) {
    const title = String(args.title || '제목 없음');
    const html = String(args.html || '');
    const parent = BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showSaveDialog(parent, {
        title: 'PDF로 저장',
        defaultPath: path.join(app.getPath('documents'), safeExportFileName(title, 'pdf')),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const targetPath = result.filePath.toLowerCase().endsWith('.pdf')
        ? result.filePath
        : `${result.filePath}.pdf`;
    const pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    try {
        await pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
        const pdfBuffer = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            preferCSSPageSize: true,
            margins: { marginType: 'none' }
        });
        await fs.writeFile(targetPath, pdfBuffer);
        return { ok: true, filePath: targetPath };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'PDF 저장에 실패했습니다.'
        };
    } finally {
        if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    }
}

function registerPdfHandlers() {
    ipcMain.handle('notedown:pdf:save-note', async (_event, args = {}) => saveNotePdf(args));
}

function trayIcon() {
    const imagePath = process.platform === 'darwin' ? TRAY_ICON_PATH : APP_ICON_PATH;
    let image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) image = nativeImage.createFromPath(APP_ICON_PATH);
    const size = process.platform === 'darwin' ? 18 : 16;
    const icon = image.isEmpty() ? image : image.resize({ width: size, height: size });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    return icon;
}

function trayMenu() {
    return Menu.buildFromTemplate([
        { label: 'Notedown 열기', click: () => { void showMainWindow(); } },
        { type: 'separator' },
        { label: '종료', click: quitApplication }
    ]);
}

function ensureTray() {
    if (tray) return tray;

    tray = new Tray(trayIcon());
    tray.setToolTip(APP_NAME);
    tray.on('right-click', () => tray?.popUpContextMenu(trayMenu()));
    if (process.platform === 'darwin') {
        tray.on('click', () => { void showMainWindow(); });
    } else {
        tray.on('double-click', () => { void showMainWindow(); });
    }
    return tray;
}

function syncTrayState() {
    if (appPreferences.keepInBackgroundOnClose) {
        ensureTray();
        return;
    }

    if (tray) tray.destroy();
    tray = null;
}

function quitApplication() {
    isQuitting = true;
    app.quit();
}

function hideMainWindow(win) {
    win.hide();
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
}

async function showMainWindow() {
    if (process.platform === 'darwin' && app.dock) app.dock.show();

    const win = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : await createWindow();

    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
}

function registerAppHandlers() {
    ipcMain.handle('notedown:app:preferences', async () => ({ ok: true, ...appPreferences }));
    ipcMain.handle('notedown:app:set-preferences', async (_event, args = {}) => {
        const nextPreferences = await writeAppPreferences(args);
        return { ok: true, ...nextPreferences };
    });
    ipcMain.handle('notedown:app:show-window', async () => {
        await showMainWindow();
        return { ok: true };
    });
}

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'notedown',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true
        }
    }
]);

function resolveBundlePath(requestUrl) {
    const url = new URL(requestUrl);
    const pathname = decodeURIComponent(url.pathname || '/index.html');
    const normalizedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(DIST_DIR, `.${normalizedPath}`);

    if (!filePath.startsWith(DIST_DIR)) {
        return path.join(DIST_DIR, 'index.html');
    }

    return filePath;
}

async function registerLocalProtocol() {
    if (protocolRegistered) return;

    protocol.handle('notedown', async (request) => {
        let filePath = resolveBundlePath(request.url);

        try {
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
        } catch (error) {
            filePath = path.join(DIST_DIR, 'index.html');
        }

        return net.fetch(pathToFileURL(filePath).toString());
    });

    protocolRegistered = true;
}

async function createWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    if (!DEV_URL) await registerLocalProtocol();

    const win = new BrowserWindow({
        width: 1400,
        height: 920,
        minWidth: 1024,
        minHeight: 720,
        backgroundColor: '#fbfbfa',
        title: APP_NAME,
        icon: APP_ICON_PATH,
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    mainWindow = win;

    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    win.on('close', (event) => {
        if (isQuitting || !appPreferences.keepInBackgroundOnClose) return;
        event.preventDefault();
        hideMainWindow(win);
    });

    win.on('closed', () => {
        if (mainWindow === win) mainWindow = null;
    });

    if (DEV_URL) {
        await win.loadURL(DEV_URL);
    } else {
        await win.loadURL('notedown://app/index.html');
    }

    return win;
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

app.whenReady().then(async () => {
    await readAppPreferences();
    syncTrayState();
    registerAppHandlers();
    registerStorageHandlers();
    registerSyncHandlers();
    registerPdfHandlers();
    await createWindow();

    app.on('activate', async () => {
        await showMainWindow();
    });
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (!appPreferences.keepInBackgroundOnClose) app.quit();
});
