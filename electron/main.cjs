const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, shell, Tray } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const {
    METADATA_DB_FILE,
    metadataPath: metadataDbPath,
    readMetadata,
    writeMetadata
} = require('./metadata-store.cjs');
const { createKeyedQueue } = require('./keyed-queue.cjs');
const {
    runSyncConflictBatch,
    serverResolutionStillCurrent
} = require('./sync-conflict-batch.cjs');
const {
    acknowledgedSyncUploadEntry,
    clearAcknowledgedSyncMutations,
    isLocalDeleteConflict,
    isLocalStorageChangedResult,
    isPendingSyncDeleteIntent,
    isPendingSyncDeleteState,
    markLocalDeleteConflict,
    shouldPreserveLocalSyncEntry,
    syncLocalMetadataFingerprint,
    syncManifestEntryChanged,
    syncStateFromManifest,
    updateSyncEntryLocalMetadataHash
} = require('./sync-state.cjs');
const {
    applyLocalIdentityDetailsToRebasedState,
    consolidateDuplicateMetadataStoragePaths,
    findPendingDeleteIdentity,
    matchSyncIdentityEntries,
    rebaseMetadataRelativePaths,
    shouldRebaseServerRevision
} = require('./sync-rebase.cjs');
const {
    identityMatches,
    indexPreviousAttachmentIdentities,
    indexPreviousNoteIdentities,
    prepareNoteStorageIdentities,
    selectMissingPreviousNotes
} = require('./storage-identity.cjs');
const {
    isTransientSyncNetworkError,
    recoverMutationFromManifest,
    shouldProbeMutationResult,
    shouldRetrySyncNetworkError,
    syncNetworkErrorKind,
    syncNetworkUserMessage,
    syncRequestTimeoutMs
} = require('./sync-network.cjs');
const {
    shouldStartHiddenLoginItem,
    windowsLoginItemEnabled,
    windowsLoginItemOptions,
    windowsLoginItemQuery
} = require('./startup-settings.cjs');
const {
    createUpdater,
    DEFAULT_UPDATE_SHARE_URL,
    supportedArtifact
} = require('./updater.cjs');

const DEV_URL = process.env.NOTEDOWN_DEV_URL;
const DIST_DIR = path.resolve(__dirname, '..', 'bundle', 'www');
const APP_NAME = 'Notedown';
const APP_ID = 'com.notedown.app';
const APP_ICON_PATH = path.resolve(__dirname, '..', 'build-resources', 'icon.png');
const TRAY_ICON_PATH = path.resolve(__dirname, '..', 'build-resources', 'tray-icon.png');
const APP_PREFERENCES_FILE = 'app-preferences.json';
const INSTALLER_SETTINGS_FILE = 'installer-settings.ini';
const START_HIDDEN_ARG = '--notedown-start-hidden';
const QUIT_ARG = '--notedown-quit';
let protocolRegistered = false;
let attachmentProtocolRegistered = false;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let currentWorkspaceRevealTimer = null;
const activeStorageRoots = new Set();
const storageOperationQueue = createKeyedQueue();
const syncOperationQueue = createKeyedQueue();
const storageMutationGenerations = new Map();
const deflateRaw = promisify(zlib.deflateRaw);
const execFileAsync = promisify(execFile);
let updateOperation = null;
let appPreferences = {
    keepInBackgroundOnClose: defaultKeepInBackgroundOnClose(),
    launchAtStartup: false
};

const LEGACY_METADATA_FILE = 'metadata.json';
const SYNC_STATE_FILE = '.notedown-sync.json';
const RETRYABLE_SYNC_ENDPOINTS = new Set(['/api/sync/plan']);
const IMPORTED_WORKSPACE_ID = '_imported';
const UNFILED_WORKSPACE_ID = 'unfiled';

function isDeletedFlag(value) {
    return value === true || value === 'true';
}

function expandHome(filePath) {
    if (!filePath) return '';
    if (filePath === '~') return app.getPath('home');
    if (filePath.startsWith('~/')) return path.join(app.getPath('home'), filePath.slice(2));
    return filePath;
}

function defaultKeepInBackgroundOnClose() {
    return process.platform !== 'win32';
}

function normalizeAppPreferences(preferences = {}) {
    return {
        keepInBackgroundOnClose: typeof preferences.keepInBackgroundOnClose === 'boolean'
            ? preferences.keepInBackgroundOnClose
            : defaultKeepInBackgroundOnClose(),
        launchAtStartup: preferences.launchAtStartup === true
    };
}

function shouldQuitFromArgs(argv = process.argv) {
    return argv.some(arg => {
        const normalized = String(arg || '').toLowerCase();
        return normalized === QUIT_ARG
            || normalized === '--squirrel-uninstall'
            || normalized === '--squirrel-obsolete';
    });
}

function supportsLaunchAtStartup() {
    return process.platform === 'darwin' || process.platform === 'win32';
}

function loginItemSettingsOptions() {
    if (process.platform !== 'win32') return {};
    return windowsLoginItemQuery(process.execPath, START_HIDDEN_ARG);
}

function loginItemOptions(openAtLogin) {
    const options = { openAtLogin: Boolean(openAtLogin) };
    if (process.platform === 'darwin') {
        options.openAsHidden = true;
    } else if (process.platform === 'win32') {
        return windowsLoginItemOptions(
            process.execPath,
            APP_NAME,
            START_HIDDEN_ARG,
            openAtLogin
        );
    }
    return options;
}

function launchAtStartupState() {
    if (!supportsLaunchAtStartup()) {
        return { launchAtStartupSupported: false, launchAtStartup: false };
    }

    try {
        const settings = app.getLoginItemSettings(loginItemSettingsOptions());
        return {
            launchAtStartupSupported: true,
            launchAtStartup: process.platform === 'win32'
                ? windowsLoginItemEnabled(settings, loginItemSettingsOptions())
                : Boolean(settings.openAtLogin)
        };
    } catch (error) {
        return {
            launchAtStartupSupported: false,
            launchAtStartup: false,
            error: error instanceof Error ? error.message : '시작 프로그램 상태를 확인하지 못했습니다.'
        };
    }
}

function applyLaunchAtStartup(openAtLogin) {
    if (!supportsLaunchAtStartup()) return launchAtStartupState();

    try {
        app.setLoginItemSettings(loginItemOptions(openAtLogin));
        return launchAtStartupState();
    } catch (error) {
        return {
            launchAtStartupSupported: false,
            launchAtStartup: false,
            error: error instanceof Error ? error.message : '시작 프로그램 설정을 변경하지 못했습니다.'
        };
    }
}

function launchedAsHiddenLoginItem() {
    if (process.argv.includes(START_HIDDEN_ARG)) return true;
    if (process.platform !== 'darwin') return false;

    try {
        const settings = app.getLoginItemSettings();
        return Boolean(settings.wasOpenedAsHidden || settings.wasOpenedAtLogin);
    } catch (error) {
        return false;
    }
}

function appPreferencesPath() {
    return path.join(app.getPath('userData'), APP_PREFERENCES_FILE);
}

function installerSettingsPath() {
    return path.join(app.getPath('userData'), INSTALLER_SETTINGS_FILE);
}

async function readAppPreferences() {
    try {
        const stored = JSON.parse(await fs.readFile(appPreferencesPath(), 'utf8'));
        appPreferences = normalizeAppPreferences(stored);
    } catch (error) {
        appPreferences = normalizeAppPreferences(appPreferences);
    }
    appPreferences.launchAtStartup = launchAtStartupState().launchAtStartup;
    return appPreferences;
}

async function writeAppPreferences(preferences = {}) {
    appPreferences = normalizeAppPreferences({ ...appPreferences, ...preferences });
    const launchState = typeof preferences.launchAtStartup === 'boolean'
        ? applyLaunchAtStartup(preferences.launchAtStartup)
        : launchAtStartupState();
    appPreferences.launchAtStartup = launchState.launchAtStartup;
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(appPreferencesPath(), `${JSON.stringify(appPreferences, null, 2)}\n`, 'utf8');
    syncTrayState();
    return { ...appPreferences, ...launchState };
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

function parseInstallerSettingsIni(content) {
    const settings = {};
    let section = '';
    for (const rawLine of String(content || '').split(/\r?\n/g)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const sectionMatch = line.match(/^\[([^\]]+)]$/);
        if (sectionMatch) {
            section = sectionMatch[1].trim().toLowerCase();
            continue;
        }
        if (section !== 'settings') continue;
        const separatorIndex = line.indexOf('=');
        if (separatorIndex < 0) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (key) settings[key] = value;
    }
    return settings;
}

function normalizeInstallerBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function normalizeInstallerTheme(value) {
    return ['light', 'dark', 'system'].includes(value) ? value : 'light';
}

function normalizeInstallerEditorMode(value) {
    return ['markdown', 'split', 'preview'].includes(value) ? value : 'split';
}

function normalizeInstallerTabSize(value) {
    const tabSize = Number(value);
    if (!Number.isFinite(tabSize)) return 2;
    return Math.min(8, Math.max(2, Math.round(tabSize)));
}

function normalizeInstallerServerUrl(value) {
    const rawUrl = String(value || '').trim();
    if (!rawUrl) return '';
    try {
        return normalizeServerUrl(rawUrl);
    } catch (error) {
        return '';
    }
}

function normalizeInstallerSettings(settings = {}) {
    const keepInBackgroundOnClose = normalizeInstallerBoolean(settings.keepInBackgroundOnClose, defaultKeepInBackgroundOnClose());
    const launchAtStartup = normalizeInstallerBoolean(settings.launchAtStartup, false);
    return {
        workspaceName: String(settings.workspaceName || 'Notedown').trim() || 'Notedown',
        storagePath: normalizeStoragePath(settings.storagePath),
        theme: normalizeInstallerTheme(settings.theme),
        editorMode: normalizeInstallerEditorMode(settings.editorMode),
        keepInBackgroundOnClose,
        launchAtStartup,
        tabSize: normalizeInstallerTabSize(settings.tabSize),
        syncServerUrl: normalizeInstallerServerUrl(settings.syncServerUrl),
        syncUsername: String(settings.syncUsername || '').trim(),
        syncToken: '',
        syncTokenType: '',
        syncClientId: String(settings.syncClientId || `notedown-electron-${crypto.randomUUID()}`).trim(),
        setupCompleted: true,
        setupCompletedAt: String(settings.setupCompletedAt || new Date().toISOString())
    };
}

async function readInstallerSettings() {
    try {
        const content = await fs.readFile(installerSettingsPath(), 'utf8');
        const parsed = parseInstallerSettingsIni(content);
        if (Object.keys(parsed).length === 0) return null;
        return normalizeInstallerSettings(parsed);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function rememberStoragePath(filePath) {
    const storagePath = normalizeStoragePath(filePath);
    activeStorageRoots.add(path.resolve(storagePath));
    return storagePath;
}

function storageOperationKey(storagePath) {
    return path.resolve(rememberStoragePath(storagePath));
}

function runStorageOperation(storagePath, task) {
    return storageOperationQueue.run(storageOperationKey(storagePath), task);
}

function storageMutationGeneration(storagePath) {
    return storageMutationGenerations.get(storageOperationKey(storagePath)) || 0;
}

function bumpStorageMutationGeneration(storagePath) {
    const key = storageOperationKey(storagePath);
    const generation = (storageMutationGenerations.get(key) || 0) + 1;
    storageMutationGenerations.set(key, generation);
    return generation;
}

function runStorageMutation(storagePath, task) {
    const key = storageOperationKey(storagePath);
    return storageOperationQueue.run(key, () => {
        bumpStorageMutationGeneration(storagePath);
        return task();
    });
}

function runSyncOperation(args, task, useStorageQueue = false) {
    const config = syncConfig(args);
    const syncKey = path.resolve(config.storagePath);
    return syncOperationQueue.run(syncKey, () => {
        if (!useStorageQueue) return task();
        return runStorageOperation(config.storagePath, task);
    });
}

async function retryStorageChangedSync(task, maxAttempts = 2) {
    let result;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        result = await task();
        if (!isLocalStorageChangedResult(result) || result?.didApply === true) return result;
        if (attempt + 1 < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    return result;
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

function safeAttachmentFileName(name, fallback = 'attachment') {
    const parsed = path.parse(String(name || fallback));
    const stem = String(parsed.name || fallback)
        .replace(/[/:\\?%*"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || fallback;
    const ext = String(parsed.ext || '')
        .replace(/[/:\\?%*"<>|\s]+/g, '')
        .slice(0, 24);
    return `${stem}${ext || ''}`;
}

function safePathSegment(name, fallback = 'item') {
    return String(name || fallback)
        .replace(/\.[a-z0-9]{1,12}$/i, '')
        .replace(/[/:\\?%*"<>|.]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || fallback;
}

function safeStorageSegment(value, fallback = 'folder') {
    let text = String(value || '').trim();
    if (!text) text = fallback;
    text = text
        .normalize('NFC')
        .replace(/[\\/]+/g, ' ')
        .replace(/[\x00-\x1f\x7f]+/g, ' ')
        .replace(/[<>:"|?*]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[. ]+|[. ]+$/g, '');
    if (!text || text === '.' || text === '..') text = fallback;
    if (text.length > 120) text = text.slice(0, 120).replace(/[. ]+$/g, '');
    return text || fallback;
}

function safeStorageFileName(name, fallback = 'note', defaultSuffix = '.md') {
    const source = String(name || '').trim();
    const suffix = defaultSuffix || '.md';
    const stem = source.toLowerCase().endsWith(suffix.toLowerCase())
        ? source.slice(0, -suffix.length)
        : source;
    const safeStem = safeStorageSegment(stem || fallback, fallback);
    let safeSuffix = safeStorageSegment(suffix || defaultSuffix, defaultSuffix).replace(/\s+/g, '');
    if (safeSuffix && !safeSuffix.startsWith('.')) safeSuffix = `.${safeSuffix}`;
    return `${safeStem}${safeSuffix || defaultSuffix}`;
}

function toPosixPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

function normalizeRelativePath(relativePath) {
    const normalized = toPosixPath(relativePath).replace(/^\/+/g, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('파일 경로가 비어 있습니다.');
    if (parts.some(part => part === '.' || part === '..')) throw new Error('허용되지 않는 파일 경로입니다.');
    if ([LEGACY_METADATA_FILE, METADATA_DB_FILE, SYNC_STATE_FILE].includes(parts[0])) throw new Error('동기화할 수 없는 시스템 파일입니다.');
    return parts.join('/');
}

function isSystemRelativePath(relativePath) {
    const firstPart = toPosixPath(relativePath).replace(/^\/+/g, '').split('/').filter(Boolean)[0] || '';
    return [LEGACY_METADATA_FILE, METADATA_DB_FILE, SYNC_STATE_FILE].includes(firstPart);
}

function isAttachmentRelativePath(relativePath) {
    return normalizeRelativePath(relativePath).split('/').includes('.attachments');
}

function contentTypeForFileName(fileName) {
    return mimeTypeForFileName(fileName);
}

function mimeTypeForFileName(fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
    if (lower.endsWith('.avif')) return 'image/avif';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain; charset=utf-8';
    if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
    if (lower.endsWith('.csv')) return 'text/csv; charset=utf-8';
    return 'application/octet-stream';
}

function isImageFileName(fileName) {
    return mimeTypeForFileName(fileName).startsWith('image/');
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

function workspaceIdFromRelativePath(relativePath) {
    if (!relativePath) return '';
    try {
        const safeRelativePath = normalizeRelativePath(relativePath);
        const folder = path.posix.dirname(safeRelativePath);
        return folder && folder !== '.' ? folder : '';
    } catch (error) {
        return '';
    }
}

function noteWorkspaceId(note = {}) {
    return workspaceIdFromRelativePath(note.relativePath) || note.folder || note.workspace || UNFILED_WORKSPACE_ID;
}

function noteWorkspaceName(note = {}, workspaceId = noteWorkspaceId(note)) {
    return note.workspaceName || note.workspaceLabel || (workspaceId === UNFILED_WORKSPACE_ID ? '미지정 워크스페이스' : workspaceId);
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

function storageFolderPartsForNote(note = {}, relativePath = '') {
    const logicalPath = relativePath ? path.posix.parse(normalizeRelativePath(relativePath)) : null;
    let folder = note.folder;
    if (!folder && logicalPath) folder = logicalPath.dir;

    const rawParts = String(folder || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..');
    const workspaceId = noteWorkspaceId(note);
    const workspaceName = noteWorkspaceName(note, workspaceId);
    const workspaceFirst = workspaceId ? String(workspaceId).replace(/\\/g, '/').split('/', 1)[0] : '';

    if (workspaceName) {
        if (rawParts.length > 0) {
            const first = rawParts[0];
            if (!workspaceId || first === workspaceId || first === workspaceFirst || first === '미지정 워크스페이스' || first === UNFILED_WORKSPACE_ID) {
                rawParts[0] = workspaceName;
            }
        } else {
            rawParts.push(workspaceName);
        }
    }

    return rawParts.map(part => safeStorageSegment(part, 'folder'));
}

function desiredNoteStoragePath(note = {}, relativePath = relativePathForNote(note)) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    const suffix = path.posix.extname(note.fileName || safeRelativePath) || '.md';
    const fallbackStem = path.posix.basename(safeRelativePath, path.posix.extname(safeRelativePath)) || 'note';
    const fileName = safeStorageFileName(note.title || note.fileName || fallbackStem, fallbackStem, suffix);
    return normalizeRelativePath(path.posix.join(...storageFolderPartsForNote(note, safeRelativePath), fileName));
}

function noteStoragePath(note = {}, relativePath = relativePathForNote(note)) {
    if (note.storagePath) return normalizeRelativePath(note.storagePath);
    return desiredNoteStoragePath(note, relativePath);
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
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function listMarkdownFiles(dirPath, depth = 1, rootPath = dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === LEGACY_METADATA_FILE || entry.name === METADATA_DB_FILE) continue;
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
    const relativePath = normalizeRelativePath(metadataNote.relativePath);
    const storageRelativePath = noteStoragePath(metadataNote, relativePath);
    const workspaceId = noteWorkspaceId({ ...metadataNote, relativePath });
    const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);
    let body = '';
    try {
        body = await fs.readFile(absolutePath, 'utf8');
    } catch (error) {
        body = '';
    }

    return {
        ...metadataNote,
        relativePath,
        storagePath: storageRelativePath,
        body,
        folder: workspaceId,
        workspace: workspaceId
    };
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
        if (error?.code !== 'ENOENT') {
            const stateError = new Error(
                '동기화 상태 파일을 읽지 못했습니다. 상태를 초기화하지 않았으며 파일 권한과 손상 여부를 확인해야 합니다.'
            );
            stateError.code = 'SYNC_STATE_UNREADABLE';
            stateError.cause = error;
            throw stateError;
        }
        return {
            serverRevision: 0,
            metadataRevision: 0,
            metadataHash: null,
            files: {},
            attachments: {}
        };
    }
}

async function writeSyncState(storagePath, state) {
    await fs.mkdir(storagePath, { recursive: true });
    const targetPath = syncStatePath(storagePath);
    const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await fs.rename(temporaryPath, targetPath);
    } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}

function syncMutationJournalKey(endpoint, relativePath) {
    const kind = String(endpoint || '').includes('/attachment') ? 'attachment' : 'file';
    return `${kind}:${normalizeRelativePath(relativePath)}`;
}

function syncMutationProofBody(body = {}) {
    return {
        relativePath: normalizeRelativePath(body.relativePath),
        lastKnownRevision: Number(body.lastKnownRevision) || 0,
        deleted: isDeletedFlag(body.deleted),
        contentHash: body.contentHash || null,
        updatedAtMs: Number(body.updatedAtMs) || null,
        ...(body.note ? { note: body.note } : {}),
        ...(body.attachment ? { attachment: body.attachment } : {})
    };
}

async function rememberUncertainSyncMutation(prepared, endpoint) {
    const key = syncMutationJournalKey(endpoint, prepared.body.relativePath);
    await runStorageOperation(prepared.storagePath, async () => {
        const state = await readSyncState(prepared.storagePath);
        state.uncertainMutations = {
            ...(state.uncertainMutations || {}),
            [key]: {
                endpoint,
                body: syncMutationProofBody(prepared.body),
                attemptedAt: new Date().toISOString()
            }
        };
        state.updatedAt = new Date().toISOString();
        await writeSyncState(prepared.storagePath, state);
    });
    return key;
}

async function forgetUncertainSyncMutation(storagePath, key) {
    await runStorageOperation(storagePath, async () => {
        const state = await readSyncState(storagePath);
        if (!state.uncertainMutations?.[key]) return;
        delete state.uncertainMutations[key];
        if (Object.keys(state.uncertainMutations).length === 0) delete state.uncertainMutations;
        state.updatedAt = new Date().toISOString();
        await writeSyncState(storagePath, state);
    });
}

async function recoverPreviousUncertainSyncMutation(prepared, endpoint) {
    const key = syncMutationJournalKey(endpoint, prepared.body.relativePath);
    const state = await readSyncState(prepared.storagePath);
    const mutation = state.uncertainMutations?.[key];
    if (!mutation) return null;

    const proof = await recoverMutationFromManifest({
        loadManifest: () => fetchFreshSyncManifest(
            prepared.serverUrl,
            prepared.token,
            state.serverRevision,
            { timeoutMs: 8000, maxAttempts: 1 }
        ),
        acknowledged: manifest => acknowledgedSyncUploadEntry(
            mutation.body,
            mutation.endpoint || endpoint,
            manifest
        )
    });
    if (!proof.manifest) {
        const recoveryError = proof.error || new Error('이전 동기화 결과를 확인하지 못했습니다.');
        recoveryError.userMessage = syncNetworkUserMessage(recoveryError)
            || '이전 동기화 요청의 서버 반영 여부를 확인하지 못했습니다. 로컬 변경은 보존되며 연결이 안정된 뒤 다시 시도할 수 있습니다.';
        throw recoveryError;
    }

    const nextState = await runStorageOperation(prepared.storagePath, async () => {
        const currentState = await readSyncState(prepared.storagePath);
        const checkpoint = await writeSyncStateFromManifest(
            prepared.storagePath,
            proof.manifest,
            currentState,
            proof.acknowledged
                ? preparedUploadCheckpointOptions(
                    { body: mutation.body },
                    mutation.endpoint || endpoint
                )
                : {}
        );
        return checkpoint;
    });
    prepared.syncState = nextState;
    prepared.body.baseRevision = Number(nextState.serverRevision)
        || Number(proof.manifest.serverRevision)
        || 0;
    const attachment = endpoint.includes('/attachment');
    const entryState = attachment
        ? nextState.attachments?.[prepared.body.relativePath]
        : nextState.files?.[prepared.body.relativePath];
    prepared.body.lastKnownRevision = Number(entryState?.lastKnownRevision) || 0;

    const acknowledgedEntry = acknowledgedSyncUploadEntry(
        prepared.body,
        endpoint,
        proof.manifest
    );
    if (!acknowledgedEntry) return { recovered: proof.acknowledged, manifest: proof.manifest };
    return {
        recovered: true,
        response: {
            status: 'ok',
            manifest: proof.manifest,
            recoveredBeforeRetry: true,
            ...(attachment ? { attachment: acknowledgedEntry } : { file: acknowledgedEntry })
        }
    };
}

function normalizeSyncManifest(manifest = {}) {
    return {
        ...manifest,
        files: (manifest.files || [])
            .filter(file => file?.relativePath && !isSystemRelativePath(file.relativePath))
            .map(file => ({ ...file, relativePath: normalizeRelativePath(file.relativePath) })),
        attachments: (manifest.attachments || [])
            .filter(file => file?.relativePath && !isSystemRelativePath(file.relativePath))
            .map(file => ({ ...file, relativePath: normalizeRelativePath(file.relativePath) }))
    };
}

function syncCheckpointAcceptedPaths(options = {}) {
    return new Set([
        ...(Array.isArray(options.acceptPaths) ? options.acceptPaths : []),
        ...(Array.isArray(options.clearRebaseConflictPaths)
            ? options.clearRebaseConflictPaths
            : [])
    ].map(value => normalizeRelativePath(value)));
}

async function localCheckpointDescriptor(storagePath, storageRelativePath, metadata) {
    try {
        const content = await fs.readFile(
            resolveStorageFile(storagePath, storageRelativePath).absolutePath
        );
        return {
            exists: true,
            contentHash: sha256(content),
            updatedAtMs: Number(metadata?.updatedAtMs) || 0,
            metadata
        };
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        return {
            exists: false,
            contentHash: null,
            updatedAtMs: Number(metadata?.updatedAtMs) || 0,
            metadata
        };
    }
}

async function protectLocallyChangedCheckpointPaths(
    storagePath,
    currentState,
    manifest,
    options = {}
) {
    const acceptedPaths = syncCheckpointAcceptedPaths(options);
    const metadata = await readMetadata(storagePath);
    const notes = new Map();
    const attachments = new Map();
    for (const note of metadata?.notes || []) {
        if (!note?.relativePath) continue;
        const relativePath = normalizeRelativePath(note.relativePath);
        notes.set(relativePath, note);
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath || isDeletedFlag(attachment.deleted)) continue;
            attachments.set(normalizeRelativePath(attachment.relativePath), attachment);
        }
    }

    const preservePaths = new Set(
        (Array.isArray(options.preservePaths) ? options.preservePaths : [])
            .map(value => normalizeRelativePath(value))
    );
    const inspectEntries = async (entries, stateEntries, localEntries, attachment) => {
        for (const remote of entries || []) {
            const relativePath = normalizeRelativePath(remote.relativePath);
            if (acceptedPaths.has(relativePath)) continue;
            const localMetadata = localEntries.get(relativePath);
            if (!localMetadata) continue;
            const previous = stateEntries?.[relativePath];
            if (!syncManifestEntryChanged(previous, remote)) continue;
            const storageRelativePath = attachment
                ? normalizeRelativePath(localMetadata.storagePath || relativePath)
                : noteStoragePath(localMetadata, relativePath);
            const local = await localCheckpointDescriptor(
                storagePath,
                storageRelativePath,
                localMetadata
            );
            if (shouldPreserveLocalSyncEntry(previous, remote, local, attachment)) {
                preservePaths.add(relativePath);
            }
        }
    };
    await inspectEntries(manifest.files, currentState.files, notes, false);
    await inspectEntries(manifest.attachments, currentState.attachments, attachments, true);
    return { acceptedPaths, attachments, notes, preservePaths };
}

function updateCheckpointLocalMetadataHashes(state, currentState, local, acceptedPaths, options = {}) {
    const acceptedMetadataByPath = options.acceptedMetadataByPath || {};
    for (const [relativePath, note] of local.notes.entries()) {
        const accepted = acceptedPaths.has(relativePath);
        updateSyncEntryLocalMetadataHash(
            state.files?.[relativePath],
            currentState.files?.[relativePath],
            accepted && acceptedMetadataByPath[relativePath]
                ? acceptedMetadataByPath[relativePath]
                : note,
            false,
            accepted
        );
    }
    for (const [relativePath, attachment] of local.attachments.entries()) {
        const accepted = acceptedPaths.has(relativePath);
        updateSyncEntryLocalMetadataHash(
            state.attachments?.[relativePath],
            currentState.attachments?.[relativePath],
            accepted && acceptedMetadataByPath[relativePath]
                ? acceptedMetadataByPath[relativePath]
                : attachment,
            true,
            accepted
        );
    }
    return state;
}

function syncConflictCheckpointOptions(items = [], fallbackRelativePath = '') {
    const preservePaths = new Set();
    const queue = Array.isArray(items) ? [...items] : [items];
    const visited = new Set();
    while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;
        if (Array.isArray(item)) {
            queue.push(...item);
            continue;
        }
        if (typeof item !== 'object' || visited.has(item)) continue;
        visited.add(item);
        if (item.relativePath) {
            try {
                preservePaths.add(normalizeRelativePath(item.relativePath));
            } catch (error) {
                // Ignore malformed conflict details; the fallback path remains available.
            }
        }
        for (const key of ['file', 'attachment', 'conflicts', 'attachmentConflicts']) {
            if (item[key]) queue.push(item[key]);
        }
    }
    if (preservePaths.size === 0 && fallbackRelativePath) {
        preservePaths.add(normalizeRelativePath(fallbackRelativePath));
    }
    return preservePaths.size > 0
        ? { preservePaths: [...preservePaths], preserveMetadata: true }
        : {};
}

async function writeSyncStateFromManifest(storagePath, manifest, previousState = {}, options = {}) {
    if (!manifest) return previousState;
    const currentState = await readSyncState(storagePath);
    const normalizedManifest = normalizeSyncManifest(manifest);
    const initial = syncStateFromManifest(
        currentState,
        normalizedManifest,
        previousState,
        options
    );
    if (!initial.shouldWrite) return initial.state;
    const local = await protectLocallyChangedCheckpointPaths(
        storagePath,
        currentState,
        normalizedManifest,
        options
    );
    const { state, shouldWrite } = syncStateFromManifest(
        currentState,
        normalizedManifest,
        previousState,
        {
            ...options,
            preservePaths: [...local.preservePaths],
            preserveState: currentState
        }
    );
    if (shouldWrite) {
        updateCheckpointLocalMetadataHashes(
            state,
            currentState,
            local,
            local.acceptedPaths,
            options
        );
        clearAcknowledgedSyncMutations(state, normalizedManifest);
        await writeSyncState(storagePath, state);
    }
    return state;
}

async function localSyncIdentityDescriptors(storagePath, metadata = {}) {
    const notes = [];
    const attachments = [];
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        const relativePath = normalizeRelativePath(note.relativePath);
        const storagePathForNote = noteStoragePath(note, relativePath);
        let contentHash = '';
        try {
            contentHash = sha256(await fs.readFile(resolveStorageFile(storagePath, storagePathForNote).absolutePath));
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        notes.push({
            relativePath,
            id: String(note.id || '').trim(),
            storagePath: storagePathForNote,
            contentHash,
            note
        });

        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath || isDeletedFlag(attachment.deleted)) continue;
            const attachmentRelativePath = normalizeRelativePath(attachment.relativePath);
            const attachmentStoragePath = normalizeRelativePath(attachment.storagePath || attachmentRelativePath);
            let attachmentHash = '';
            try {
                attachmentHash = sha256(await fs.readFile(
                    resolveStorageFile(storagePath, attachmentStoragePath).absolutePath
                ));
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
            attachments.push({
                attachmentIdentity: true,
                relativePath: attachmentRelativePath,
                id: String(attachment.id || attachment.attachmentId || '').trim(),
                storagePath: attachmentStoragePath,
                contentHash: attachmentHash,
                noteRelativePath: relativePath,
                attachment,
                note
            });
        }
    }
    return { notes, attachments };
}

function remoteSyncIdentityDescriptors(manifest = {}) {
    return {
        notes: (manifest.files || []).map(file => ({ ...file })),
        attachments: (manifest.attachments || []).map(attachment => ({
            ...attachment,
            attachmentIdentity: true
        }))
    };
}

function pendingDeleteDescriptors(syncState = {}, attachment = false) {
    const entries = attachment ? syncState.attachments : syncState.files;
    return Object.entries(entries || {})
        .filter(([_relativePath, state]) => isPendingSyncDeleteIntent(state))
        .map(([relativePath, state]) => ({
            ...state,
            ...(attachment ? { attachmentIdentity: true } : {}),
            relativePath: normalizeRelativePath(relativePath),
            id: attachment
                ? String(state.attachmentId || '').trim()
                : String(state.noteId || '').trim()
        }));
}

function preservePendingDeletesAfterRebase(state, syncState, manifest) {
    const remote = remoteSyncIdentityDescriptors(manifest);
    const pendingNotes = matchSyncIdentityEntries(
        pendingDeleteDescriptors(syncState, false),
        remote.notes
    ).matches;
    const pendingAttachments = matchSyncIdentityEntries(
        pendingDeleteDescriptors(syncState, true),
        remote.attachments
    ).matches;
    for (const match of pendingNotes) {
        if (isDeletedFlag(match.remote.deleted)) continue;
        const entry = state.files?.[normalizeRelativePath(match.remote.relativePath)];
        if (entry) {
            entry.pendingDelete = true;
            entry.lastKnownRevision = 0;
            entry.rebaseConflict = true;
            if (match.local.storagePath) {
                entry.storagePath = normalizeRelativePath(match.local.storagePath);
            }
            if (Array.isArray(match.local.syncIdentityAliases)) {
                entry.syncIdentityAliases = [...match.local.syncIdentityAliases];
            }
        }
    }
    for (const match of pendingAttachments) {
        if (isDeletedFlag(match.remote.deleted)) continue;
        const entry = state.attachments?.[normalizeRelativePath(match.remote.relativePath)];
        if (entry) {
            entry.pendingDelete = true;
            entry.lastKnownRevision = 0;
            entry.rebaseConflict = true;
            if (match.local.storagePath) {
                entry.storagePath = normalizeRelativePath(match.local.storagePath);
            }
            if (match.remote.noteRelativePath) {
                entry.noteRelativePath = normalizeRelativePath(match.remote.noteRelativePath);
            }
            if (Array.isArray(match.local.syncIdentityAliases)) {
                entry.syncIdentityAliases = [...match.local.syncIdentityAliases];
            }
        }
    }
}

async function fetchFreshSyncManifest(serverUrl, token, clientRevision, options = {}) {
    const query = new URLSearchParams({
        notedownClientRevision: String(Number(clientRevision) || 0),
        notedownNonce: crypto.randomUUID()
    });
    return syncRequest(serverUrl, `/api/manifest?${query.toString()}`, {
        token,
        ...options,
        headers: { 'Cache-Control': 'no-cache', ...(options.headers || {}) }
    });
}

async function rebaseSyncStateIfServerReset(args = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const initialState = await readSyncState(storagePath);
    if (!hasSyncHistory(initialState) || Number(initialState.serverRevision) <= 0) {
        return { rebased: false };
    }

    let manifest = await fetchFreshSyncManifest(serverUrl, token, initialState.serverRevision);
    if (!shouldRebaseServerRevision(initialState, manifest)) return { rebased: false, manifest };
    manifest = await fetchFreshSyncManifest(serverUrl, token, initialState.serverRevision);
    if (!shouldRebaseServerRevision(initialState, manifest)) return { rebased: false, manifest };

    return runStorageOperation(storagePath, async () => {
        const syncState = await readSyncState(storagePath);
        if (!shouldRebaseServerRevision(syncState, manifest)) return { rebased: false, manifest };
        const storedMetadata = await ensureMetadata(storagePath);
        const normalizedManifest = normalizeSyncManifest(manifest);
        const duplicateRepair = consolidateDuplicateMetadataStoragePaths(
            storedMetadata,
            syncState,
            normalizedManifest
        );
        if (duplicateRepair.unresolved > 0) {
            throw new Error('같은 실제 파일을 가리키는 문서 identity를 안전하게 복구하지 못했습니다.');
        }
        const metadata = duplicateRepair.metadata;
        validateMetadataStorageIdentities(metadata);
        const local = await localSyncIdentityDescriptors(storagePath, metadata);
        const remote = remoteSyncIdentityDescriptors(normalizedManifest);
        const noteMatches = matchSyncIdentityEntries(local.notes, remote.notes).matches;
        const attachmentMatches = matchSyncIdentityEntries(local.attachments, remote.attachments).matches;
        const metadataRebase = rebaseMetadataRelativePaths(metadata, noteMatches, attachmentMatches);
        validateMetadataStorageIdentities(metadataRebase.metadata);

        const { state, shouldWrite } = syncStateFromManifest(
            syncState,
            normalizedManifest,
            syncState,
            { allowServerRevisionReset: true }
        );
        if (!shouldWrite) return { rebased: false, manifest };
        applyLocalIdentityDetailsToRebasedState(state, noteMatches, attachmentMatches);
        preservePendingDeletesAfterRebase(state, syncState, normalizedManifest);
        state.lastServerRevisionReset = {
            previousRevision: Number(syncState.serverRevision) || 0,
            serverRevision: Number(normalizedManifest.serverRevision) || 0,
            recoveredAt: new Date().toISOString()
        };
        if (duplicateRepair.changed || metadataRebase.changed) {
            metadataRebase.metadata.generatedAt = new Date().toISOString();
            await writeMetadata(storagePath, metadataRebase.metadata);
        }
        await writeSyncState(storagePath, state);
        bumpStorageMutationGeneration(storagePath);
        return {
            rebased: true,
            manifest: normalizedManifest,
            previousRevision: Number(syncState.serverRevision) || 0,
            serverRevision: Number(normalizedManifest.serverRevision) || 0,
            matchedFiles: noteMatches.length,
            matchedAttachments: attachmentMatches.length,
            consolidatedDuplicateFiles: duplicateRepair.consolidated
        };
    });
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

const CRC32_TABLE = Array.from({ length: 256 }, (_value, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
        crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return crc >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

function zipEntryName(value, fallback = 'file') {
    const normalized = toPosixPath(value || fallback)
        .replace(/^\/+/g, '')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
    return normalized || fallback;
}

function uniqueZipEntryName(usedNames, entryName) {
    const normalized = zipEntryName(entryName);
    if (!usedNames.has(normalized)) {
        usedNames.add(normalized);
        return normalized;
    }

    const ext = path.posix.extname(normalized);
    const base = normalized.slice(0, normalized.length - ext.length);
    let suffix = 2;
    while (usedNames.has(`${base}-${suffix}${ext}`)) suffix++;
    const next = `${base}-${suffix}${ext}`;
    usedNames.add(next);
    return next;
}

async function createZipBuffer(entries = []) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
        const compressedCandidate = await deflateRaw(data, { level: 9 });
        const useDeflate = compressedCandidate.length < data.length;
        const compressedData = useDeflate ? compressedCandidate : data;
        const compression = useDeflate ? 8 : 0;
        const nameBuffer = Buffer.from(zipEntryName(entry.name), 'utf8');
        const { time, date } = dosDateTime(entry.date || new Date());
        const checksum = crc32(data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(compression, 8);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(date, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressedData.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, compressedData);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(compression, 10);
        centralHeader.writeUInt16LE(time, 12);
        centralHeader.writeUInt16LE(date, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressedData.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + compressedData.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirectory, endRecord]);
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

async function removeMetadataOrphans(storagePath, previousMetadata, writtenStoragePaths, writtenAttachmentStoragePaths = new Set()) {
    const root = path.resolve(storagePath);
    const previousNotes = Array.isArray(previousMetadata?.notes) ? previousMetadata.notes : [];

    for (const note of previousNotes) {
        if (!note?.relativePath) continue;
        const storageRelativePath = noteStoragePath(note, note.relativePath);
        if (writtenStoragePaths.has(storageRelativePath)) continue;
        const absolutePath = path.resolve(storagePath, storageRelativePath);
        if (!isInsidePath(root, absolutePath) || [LEGACY_METADATA_FILE, METADATA_DB_FILE].includes(path.basename(absolutePath))) continue;
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), root);
    }

    for (const note of previousNotes) {
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath) continue;
            const relativePath = normalizeRelativePath(attachment.relativePath);
            const storageRelativePath = normalizeRelativePath(attachment.storagePath || relativePath);
            if (writtenAttachmentStoragePaths.has(storageRelativePath)) continue;
            const absolutePath = path.resolve(storagePath, storageRelativePath);
            if (!isInsidePath(root, absolutePath)) continue;
            await fs.rm(absolutePath, { force: true });
            await removeEmptyParents(path.dirname(absolutePath), root);
        }
    }
}

function makeMetadataNote(storagePath, relativePath, workspaceId, workspaceName, body, stat) {
    const fileName = path.basename(relativePath);
    const updatedAtMs = stat?.mtimeMs ? Math.round(stat.mtimeMs) : Date.now();
    const createdAtMs = stat?.birthtimeMs ? Math.round(stat.birthtimeMs) : updatedAtMs;
    const note = {
        workspace: workspaceId,
        workspaceName,
        folder: workspaceId,
        fileName,
        relativePath
    };
    const storageRelativePath = noteStoragePath(note, relativePath);
    return {
        id: noteIdFromRelativePath(relativePath),
        icon: 'N',
        title: titleFromMarkdown(body, fileName),
        tags: [],
        status: 'active',
        workspace: workspaceId,
        workspaceName,
        folder: workspaceId,
        fileName: path.posix.basename(storageRelativePath),
        relativePath,
        storagePath: storageRelativePath,
        createdAt: labelForDate(createdAtMs),
        createdAtMs,
        updatedAt: labelForDate(updatedAtMs),
        updatedAtMs
    };
}

function normalizeAttachmentMetadata(attachment = {}, noteRelativePath = '') {
    const relativePath = normalizeRelativePath(attachment.relativePath);
    const storagePath = normalizeRelativePath(attachment.storagePath || relativePath);
    const fileName = safeAttachmentFileName(attachment.fileName || path.posix.basename(relativePath));
    return {
        id: attachment.id || attachment.attachmentId || `att-${crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 16)}`,
        fileName,
        relativePath,
        storagePath,
        noteRelativePath: attachment.noteRelativePath ? normalizeRelativePath(attachment.noteRelativePath) : noteRelativePath,
        mimeType: attachment.mimeType || null,
        size: Number.isFinite(attachment.size) ? Number(attachment.size) : null,
        contentHash: attachment.contentHash || null,
        updatedAtMs: Number.isFinite(attachment.updatedAtMs) ? Number(attachment.updatedAtMs) : null,
        deleted: isDeletedFlag(attachment.deleted),
        ...(Array.isArray(attachment.syncIdentityAliases) && attachment.syncIdentityAliases.length > 0
            ? { syncIdentityAliases: [...new Set(attachment.syncIdentityAliases.map(String).filter(Boolean))] }
            : {})
    };
}

function validateMetadataStorageIdentities(metadata = {}) {
    const notes = Array.isArray(metadata?.notes) ? metadata.notes : [];
    const noteIdentities = indexPreviousNoteIdentities(notes, normalizeRelativePath);
    const attachmentIdentities = indexPreviousAttachmentIdentities(notes, normalizeRelativePath);
    for (const storagePath of attachmentIdentities.byStoragePath.keys()) {
        if (noteIdentities.byStoragePath.has(storagePath)) {
            throw new Error(`첨부 실제 저장 경로가 노트 파일과 충돌합니다: ${storagePath}`);
        }
    }
    return { notes: noteIdentities, attachments: attachmentIdentities };
}

function resolveAttachmentStorageIdentity(metadata, attachment = {}, noteRelativePath = '') {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const identities = validateMetadataStorageIdentities(metadata);
    const previous = identities.attachments;
    const requestedId = String(attachment.id || attachment.attachmentId || '').trim();
    const requestedRelativePath = attachment.relativePath
        ? normalizeRelativePath(attachment.relativePath)
        : '';
    const requestedStoragePath = attachment.storagePath
        ? normalizeRelativePath(attachment.storagePath)
        : '';
    const existingById = requestedId ? previous.byId.get(requestedId) || null : null;
    const existingByRelativePath = requestedRelativePath
        ? previous.byRelativePath.get(requestedRelativePath) || null
        : null;

    if (existingById && existingByRelativePath && existingById !== existingByRelativePath) {
        throw new Error(`첨부 ID와 경로가 서로 다른 기존 첨부를 가리킵니다: ${requestedRelativePath}`);
    }
    const existing = existingById || existingByRelativePath;
    if (existing && existing.noteRelativePath !== safeNoteRelativePath) {
        throw new Error(`첨부가 다른 노트에 연결되어 있습니다: ${requestedRelativePath || requestedId}`);
    }
    if (
        existingById
        && requestedRelativePath
        && existingById.relativePath !== requestedRelativePath
        && !identityMatches(existingById.attachment, requestedId)
        && (!requestedStoragePath || requestedStoragePath !== existingById.storagePath)
    ) {
        throw new Error(`첨부 ID가 다른 경로에 연결되어 있습니다: ${requestedId}`);
    }
    if (
        existingByRelativePath
        && requestedId
        && existingByRelativePath.id
        && !identityMatches(existingByRelativePath.attachment, requestedId)
    ) {
        throw new Error(`첨부 경로가 다른 ID에 연결되어 있습니다: ${requestedRelativePath}`);
    }
    if (existing && requestedStoragePath && existing.storagePath && existing.storagePath !== requestedStoragePath) {
        throw new Error(`첨부 실제 저장 경로가 기존 메타데이터와 다릅니다: ${requestedRelativePath}`);
    }

    const storagePath = existing?.storagePath || requestedStoragePath;
    const storageOwner = storagePath ? previous.byStoragePath.get(storagePath) || null : null;
    if (storageOwner && storageOwner !== existing) {
        throw new Error(`첨부 실제 저장 경로가 다른 첨부에 연결되어 있습니다: ${storagePath}`);
    }
    if (storagePath && identities.notes.byStoragePath.has(storagePath)) {
        throw new Error(`첨부 실제 저장 경로가 노트 파일과 충돌합니다: ${storagePath}`);
    }
    return {
        existing,
        id: existing?.id || requestedId || '',
        relativePath: existing?.relativePath || requestedRelativePath || '',
        storagePath
    };
}

function noteAttachmentDirectory(noteRelativePath, note = {}) {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const noteRelativeStoragePath = noteStoragePath(note, safeNoteRelativePath);
    const noteDir = path.posix.dirname(noteRelativeStoragePath);
    const noteName = path.posix.basename(noteRelativeStoragePath, path.posix.extname(noteRelativeStoragePath));
    const noteSegment = safeStorageSegment(note.title || noteName || 'note', 'note');
    return normalizeRelativePath(path.posix.join(noteDir === '.' ? '' : noteDir, 'attachments', noteSegment));
}

async function uniqueAttachmentRelativePath(storagePath, baseRelativePath) {
    const safeRelativePath = normalizeRelativePath(baseRelativePath);
    const ext = path.posix.extname(safeRelativePath);
    const dir = path.posix.dirname(safeRelativePath);
    const stem = path.posix.basename(safeRelativePath, ext);
    let candidate = safeRelativePath;
    let suffix = 2;
    while (await exists(resolveStorageFile(storagePath, candidate).absolutePath)) {
        candidate = normalizeRelativePath(path.posix.join(dir === '.' ? '' : dir, `${stem}-${suffix}${ext}`));
        suffix++;
    }
    return candidate;
}

async function uniqueStorageRelativePath(storagePath, baseRelativePath, usedPaths = new Set(), currentRelativePath = '') {
    const safeRelativePath = normalizeRelativePath(baseRelativePath);
    const currentPath = currentRelativePath ? normalizeRelativePath(currentRelativePath) : '';
    const ext = path.posix.extname(safeRelativePath);
    const dir = path.posix.dirname(safeRelativePath);
    const stem = path.posix.basename(safeRelativePath, ext);
    let candidate = safeRelativePath;
    let suffix = 2;

    while (
        usedPaths.has(candidate)
        || (candidate !== currentPath && await exists(resolveStorageFile(storagePath, candidate).absolutePath))
    ) {
        candidate = normalizeRelativePath(path.posix.join(dir === '.' ? '' : dir, `${stem}-${suffix}${ext}`));
        suffix++;
    }

    usedPaths.add(candidate);
    return candidate;
}

function upsertMetadataAttachment(metadata, noteRelativePath, attachment) {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const note = (metadata.notes || []).find(item => item?.relativePath && normalizeRelativePath(item.relativePath) === safeNoteRelativePath);
    if (!note) return;
    const identity = resolveAttachmentStorageIdentity(metadata, attachment, safeNoteRelativePath);
    const nextAttachment = normalizeAttachmentMetadata({
        ...attachment,
        ...(identity.id ? { id: identity.id } : {}),
        relativePath: identity.relativePath || attachment.relativePath,
        storagePath: identity.storagePath || attachment.storagePath
    }, safeNoteRelativePath);
    if (!Array.isArray(note.attachments)) note.attachments = [];
    const index = identity.existing
        ? note.attachments.indexOf(identity.existing.attachment)
        : -1;
    if (index >= 0) {
        note.attachments[index] = { ...note.attachments[index], ...nextAttachment };
    } else {
        note.attachments.push(nextAttachment);
    }
}

function removeMetadataAttachment(metadata, relativePath) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    for (const note of metadata.notes || []) {
        if (!Array.isArray(note.attachments)) continue;
        note.attachments = note.attachments.filter(attachment => {
            if (!attachment?.relativePath) return false;
            return normalizeRelativePath(attachment.relativePath) !== safeRelativePath;
        });
    }
}

function removeMetadataNoteAttachments(metadata, noteRelativePath) {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const note = (metadata.notes || []).find(item => item?.relativePath && normalizeRelativePath(item.relativePath) === safeNoteRelativePath);
    const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
    if (note) note.attachments = [];
    return attachments;
}

function noteAttachmentsForMetadata(note = {}, noteRelativePath) {
    if (!Array.isArray(note.attachments)) return [];
    return note.attachments
        .filter(attachment => attachment?.relativePath)
        .map(attachment => normalizeAttachmentMetadata(attachment, noteRelativePath))
        .filter(attachment => !attachment.deleted);
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
    const workspaces = [];
    const notes = [];
    const knownRelativePaths = new Set();
    let hasUnfiledWorkspace = false;
    let rootMarkdownCount = 0;
    let deepMarkdownCount = 0;
    let copiedDeepCount = 0;

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === LEGACY_METADATA_FILE || entry.name === METADATA_DB_FILE) continue;
        const entryPath = path.join(storagePath, entry.name);

        if (entry.isFile() && /\.md$/i.test(entry.name)) {
            const relativePath = entry.name;
            const body = await fs.readFile(entryPath, 'utf8');
            const stat = await fs.stat(entryPath);
            if (!hasUnfiledWorkspace) {
                workspaces.push({ id: UNFILED_WORKSPACE_ID, name: '미지정 워크스페이스' });
                hasUnfiledWorkspace = true;
            }
            notes.push(makeMetadataNote(storagePath, relativePath, UNFILED_WORKSPACE_ID, '미지정 워크스페이스', body, stat));
            knownRelativePaths.add(relativePath);
            rootMarkdownCount++;
            continue;
        }

        if (!entry.isDirectory()) continue;
        const workspaceId = entry.name;
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
        metadataPath: metadataDbPath(storagePath),
        notes: notes.length,
        workspaces: workspaces.length,
        rootMarkdownCount,
        deepMarkdownCount,
        copiedDeepCount,
        metadata
    };
}

async function mergeIncomingNotesWithStoredNotes(storagePath, notes, previousMetadata, deletedNoteIds = []) {
    const merged = [...(notes || [])];
    const missingPreviousNotes = selectMissingPreviousNotes(
        merged,
        previousMetadata?.notes || [],
        deletedNoteIds,
        normalizeRelativePath
    );
    for (const previousNote of missingPreviousNotes) {
        merged.push(await readMarkdownNote(storagePath, previousNote));
    }
    return merged;
}

function syncStateIdentityDescriptors(syncState = {}, attachment = false) {
    const entries = attachment ? syncState.attachments : syncState.files;
    return Object.entries(entries || {}).map(([relativePath, state]) => ({
        ...state,
        ...(attachment ? { attachmentIdentity: true } : {}),
        relativePath: normalizeRelativePath(relativePath),
        id: attachment
            ? String(state?.attachmentId || '').trim()
            : String(state?.noteId || '').trim()
    }));
}

function deletedTokensMatchIdentity(tokens, value = {}) {
    const relativePath = value?.relativePath
        ? normalizeRelativePath(value.relativePath)
        : '';
    for (const token of tokens || []) {
        if (identityMatches(value, token)) return true;
        if (relativePath && normalizeRelativePath(token) === relativePath) return true;
    }
    return false;
}

function pendingDeleteStateMatch(syncState, value = {}, attachment = false) {
    const descriptor = {
        ...value,
        ...(attachment ? { attachmentIdentity: true } : {}),
        relativePath: value?.relativePath ? normalizeRelativePath(value.relativePath) : '',
        id: String(
            attachment
                ? (value?.attachmentId || value?.id || '')
                : (value?.noteId || value?.id || '')
        ).trim(),
        storagePath: value?.storagePath ? normalizeRelativePath(value.storagePath) : '',
        contentHash: String(value?.contentHash || '').trim()
    };
    return findPendingDeleteIdentity(
        descriptor,
        pendingDeleteDescriptors(syncState, attachment),
        attachment
    );
}

async function recordPendingSyncDeletes(storagePath, previousMetadata, options = {}) {
    if (!previousMetadata) return false;
    const deletedNoteTokens = new Set(
        (options.deletedNoteIds || []).map(value => String(value || '').trim()).filter(Boolean)
    );
    const deletedAttachmentTokens = new Set(
        (options.deletedAttachmentIds || []).map(value => String(value || '').trim()).filter(Boolean)
    );
    if (deletedNoteTokens.size === 0 && deletedAttachmentTokens.size === 0) return false;

    const syncState = await readSyncState(storagePath);
    const local = await localSyncIdentityDescriptors(storagePath, previousMetadata);
    const noteMatches = matchSyncIdentityEntries(
        local.notes,
        syncStateIdentityDescriptors(syncState, false)
    ).matches;
    const attachmentMatches = matchSyncIdentityEntries(
        local.attachments,
        syncStateIdentityDescriptors(syncState, true)
    ).matches;
    const noteStatePathByLocalPath = new Map(noteMatches.map(match => [
        normalizeRelativePath(match.local.relativePath),
        normalizeRelativePath(match.remote.relativePath)
    ]));
    const attachmentStatePathByLocalPath = new Map(attachmentMatches.map(match => [
        normalizeRelativePath(match.local.relativePath),
        normalizeRelativePath(match.remote.relativePath)
    ]));
    let changed = false;

    for (const descriptor of local.notes) {
        const note = descriptor.note;
        const deletingNote = deletedTokensMatchIdentity(deletedNoteTokens, note);
        if (!deletingNote) continue;
        const statePath = noteStatePathByLocalPath.get(normalizeRelativePath(descriptor.relativePath));
        const state = statePath ? syncState.files?.[statePath] : null;
        if (state && Number(state.lastKnownRevision) > 0 && !isDeletedFlag(state.deleted)) {
            state.pendingDelete = true;
            state.storagePath = descriptor.storagePath;
            if (descriptor.id) state.noteId = descriptor.id;
            state.syncIdentityAliases = [...new Set([
                ...(Array.isArray(state.syncIdentityAliases) ? state.syncIdentityAliases : []),
                ...(Array.isArray(note?.syncIdentityAliases) ? note.syncIdentityAliases : [])
            ].map(value => String(value || '').trim()).filter(Boolean))];
            changed = true;
        }
    }

    for (const descriptor of local.attachments) {
        const note = descriptor.note;
        const attachment = descriptor.attachment;
        const deletingNote = deletedTokensMatchIdentity(deletedNoteTokens, note);
        const deletingAttachment = deletedTokensMatchIdentity(deletedAttachmentTokens, attachment);
        if (!deletingNote && !deletingAttachment) continue;
        const statePath = attachmentStatePathByLocalPath.get(normalizeRelativePath(descriptor.relativePath));
        const state = statePath ? syncState.attachments?.[statePath] : null;
        if (state && Number(state.lastKnownRevision) > 0 && !isDeletedFlag(state.deleted)) {
            state.pendingDelete = true;
            state.storagePath = descriptor.storagePath;
            state.noteRelativePath = descriptor.noteRelativePath;
            if (descriptor.id) state.attachmentId = descriptor.id;
            state.syncIdentityAliases = [...new Set([
                ...(Array.isArray(state.syncIdentityAliases) ? state.syncIdentityAliases : []),
                ...(Array.isArray(attachment?.syncIdentityAliases)
                    ? attachment.syncIdentityAliases
                    : [])
            ].map(value => String(value || '').trim()).filter(Boolean))];
            changed = true;
        }
    }

    if (changed) {
        syncState.updatedAt = new Date().toISOString();
        await writeSyncState(storagePath, syncState);
    }
    return changed;
}

async function clearPendingSyncDeletesForActiveMetadata(storagePath, metadata = {}) {
    const syncState = await readSyncState(storagePath);
    let changed = false;
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        const noteState = syncState.files?.[normalizeRelativePath(note.relativePath)];
        if (noteState?.pendingDelete === true) {
            delete noteState.pendingDelete;
            changed = true;
        }
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath) continue;
            const attachmentState = syncState.attachments?.[
                normalizeRelativePath(attachment.relativePath)
            ];
            if (attachmentState?.pendingDelete === true) {
                delete attachmentState.pendingDelete;
                changed = true;
            }
        }
    }
    if (changed) {
        syncState.updatedAt = new Date().toISOString();
        await writeSyncState(storagePath, syncState);
    }
    return changed;
}

async function saveNotesToStorage(storagePath, notes, options = {}) {
    await fs.mkdir(storagePath, { recursive: true });
    let previousMetadata = await readMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const previousRepair = consolidateDuplicateMetadataStoragePaths(previousMetadata, syncState);
    const incomingRepair = consolidateDuplicateMetadataStoragePaths({ notes: notes || [] }, syncState);
    if (previousRepair.unresolved > 0 || incomingRepair.unresolved > 0) {
        throw new Error('같은 실제 파일을 가리키는 문서 identity를 안전하게 복구하지 못했습니다.');
    }
    previousMetadata = previousRepair.metadata;
    await recordPendingSyncDeletes(storagePath, previousMetadata, options);
    const mergedNotes = await mergeIncomingNotesWithStoredNotes(
        storagePath,
        incomingRepair.metadata.notes || [],
        previousMetadata,
        options.deletedNoteIds || []
    );
    const preparedNotes = prepareNoteStorageIdentities(
        mergedNotes,
        previousMetadata?.notes || [],
        {
            normalizeRelativePath,
            relativePathForNote,
            deletedAttachmentIds: options.deletedAttachmentIds || []
        }
    );
    const workspaces = new Map();
    const metadataNotes = [];
    const writtenStoragePaths = new Set();
    const writtenAttachmentStoragePaths = new Set();
    const usedStoragePaths = new Set();

    for (const prepared of preparedNotes) {
        const note = prepared.note;
        const workspaceId = noteWorkspaceId(note);
        const workspaceName = noteWorkspaceName(note, workspaceId);
        const relativePath = prepared.relativePath;
        const desiredStoragePath = desiredNoteStoragePath({ ...note, workspace: workspaceId, folder: workspaceId, workspaceName }, relativePath);
        const storageRelativePath = await uniqueStorageRelativePath(
            storagePath,
            desiredStoragePath,
            usedStoragePaths,
            prepared.currentStoragePath
        );
        const fileName = path.posix.basename(storageRelativePath);
        const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);

        workspaces.set(workspaceId, { id: workspaceId, name: workspaceName });
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, note.body || '', 'utf8');
        writtenStoragePaths.add(storageRelativePath);
        const attachments = noteAttachmentsForMetadata(note, relativePath);
        for (const attachment of attachments) writtenAttachmentStoragePaths.add(attachment.storagePath || attachment.relativePath);

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
            storagePath: storageRelativePath,
            attachments,
            createdAt: note.createdAt || labelForDate(note.createdAtMs || Date.now()),
            createdAtMs: note.createdAtMs || Date.now(),
            updatedAt: note.updatedAt || labelForDate(Date.now()),
            updatedAtMs: note.updatedAtMs || Date.now()
        });
    }

    const nextMetadata = {
        version: 1,
        generatedAt: new Date().toISOString(),
        workspaces: Array.from(workspaces.values()),
        notes: metadataNotes
    };
    await writeMetadata(storagePath, nextMetadata);
    await clearPendingSyncDeletesForActiveMetadata(storagePath, nextMetadata);
    await removeMetadataOrphans(storagePath, previousMetadata, writtenStoragePaths, writtenAttachmentStoragePaths);

    return {
        ok: true,
        notes: metadataNotes.length,
        workspaces: workspaces.size,
        savedNotes: metadataNotes
    };
}

async function saveAttachmentToStorage(args = {}) {
    const storagePath = rememberStoragePath(args.storagePath);
    const metadata = await ensureMetadata(storagePath);
    validateMetadataStorageIdentities(metadata);
    const payloadNote = args.note || null;
    const noteRelativePath = normalizeRelativePath(args.noteRelativePath || payloadNote?.relativePath || relativePathForNote(payloadNote));
    const note = findMetadataNote(metadata, noteRelativePath, payloadNote);
    if (!note) throw new Error('첨부할 노트를 찾지 못했습니다.');

    upsertMetadataWorkspace(metadata, workspacePayload(metadata, note));
    upsertMetadataNote(metadata, notePayload(note, noteRelativePath));

    const fileName = safeAttachmentFileName(args.fileName || 'attachment');
    const attachmentDir = noteAttachmentDirectory(noteRelativePath, note);
    const logicalRelativePath = args.relativePath ? normalizeRelativePath(args.relativePath) : '';
    const requestedIdentity = resolveAttachmentStorageIdentity(metadata, {
        id: args.id,
        relativePath: logicalRelativePath,
        storagePath: args.attachmentStoragePath || ''
    }, noteRelativePath);
    const baseStoragePath = requestedIdentity.storagePath
        || normalizeRelativePath(path.posix.join(attachmentDir, fileName));
    const storageRelativePath = await uniqueStorageRelativePath(
        storagePath,
        baseStoragePath,
        new Set(),
        requestedIdentity.existing ? requestedIdentity.storagePath : ''
    );
    const relativePath = requestedIdentity.relativePath || logicalRelativePath || storageRelativePath;
    const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);
    const contentEncoding = args.contentEncoding || 'base64';
    const content = contentEncoding === 'base64'
        ? Buffer.from(String(args.content || ''), 'base64')
        : Buffer.from(String(args.content || ''), 'utf8');
    const updatedAtMs = Date.now();

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);

    const attachment = normalizeAttachmentMetadata({
        id: requestedIdentity.id || `att-${crypto.randomUUID()}`,
        fileName,
        relativePath,
        storagePath: storageRelativePath,
        noteRelativePath,
        mimeType: args.mimeType || null,
        size: content.length,
        contentHash: sha256(content),
        updatedAtMs
    }, noteRelativePath);

    upsertMetadataAttachment(metadata, noteRelativePath, attachment);
    metadata.generatedAt = new Date().toISOString();
    await writeMetadata(storagePath, metadata);

    return {
        ok: true,
        storagePath,
        noteRelativePath,
        attachment
    };
}

async function chooseAttachmentsForStorage(event, args = {}) {
    const storagePath = rememberStoragePath(args.storagePath);
    const mode = args.mode === 'image' ? 'image' : 'file';
    const parent = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
    const filters = mode === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }]
        : [{ name: 'All Files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(parent, {
        title: mode === 'image' ? '이미지 첨부' : '파일 첨부',
        properties: ['openFile', 'multiSelections'],
        filters
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true, attachments: [] };
    }

    const attachments = [];
    let skipped = 0;
    for (const filePath of result.filePaths) {
        if (mode === 'image' && !isImageFileName(filePath)) {
            skipped++;
            continue;
        }

        const content = await fs.readFile(filePath);
        const saved = await saveAttachmentToStorage({
            ...args,
            storagePath,
            fileName: path.basename(filePath),
            mimeType: mimeTypeForFileName(filePath),
            content: content.toString('base64'),
            contentEncoding: 'base64'
        });
        if (saved?.attachment) attachments.push(saved.attachment);
    }

    if (attachments.length === 0) {
        return {
            ok: false,
            canceled: false,
            skipped,
            attachments: [],
            error: mode === 'image' ? '선택한 이미지가 없습니다.' : '저장한 첨부 파일이 없습니다.'
        };
    }

    return {
        ok: true,
        storagePath,
        attachments,
        attachment: attachments[0],
        skipped
    };
}

async function openAttachmentFromStorage(args = {}) {
    const storagePath = rememberStoragePath(args.storagePath);
    const relativePath = normalizeRelativePath(args.relativePath);
    const metadata = await readMetadata(storagePath);
    const attachment = metadata ? findMetadataAttachment(metadata, relativePath, { relativePath }) : null;
    const { absolutePath } = resolveStorageFile(storagePath, attachment?.storagePath || relativePath);
    if (!await exists(absolutePath)) throw new Error('첨부 파일을 찾지 못했습니다.');
    const error = await shell.openPath(absolutePath);
    if (error) throw new Error(error);
    return { ok: true, relativePath };
}

function normalizeServerUrl(serverUrl) {
    const rawUrl = String(serverUrl || '').trim();
    if (!rawUrl) throw new Error('동기화 서버 주소를 입력해야 합니다.');
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP 또는 HTTPS 동기화 서버만 사용할 수 있습니다.');
    return parsed.toString().replace(/\/+$/g, '');
}

function syncConfig(args = {}, requireToken = true) {
    const storagePath = rememberStoragePath(args.storagePath);
    const serverUrl = normalizeServerUrl(args.serverUrl);
    const token = String(args.token || '').trim();
    const clientId = String(args.clientId || 'notedown-electron').trim() || 'notedown-electron';
    if (requireToken && !token) throw new Error('동기화 서버 로그인이 필요합니다.');
    return { storagePath, serverUrl, token, clientId };
}

async function syncRequestOnce(serverUrl, endpoint, options = {}) {
    const url = new URL(endpoint, `${normalizeServerUrl(serverUrl)}/`).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), syncRequestTimeoutMs(options));
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
    } catch (error) {
        if (controller.signal.aborted) {
            const timeoutError = new Error(syncNetworkUserMessage({ name: 'AbortError' }));
            timeoutError.name = 'SyncTimeoutError';
            timeoutError.code = 'SYNC_TIMEOUT';
            timeoutError.cause = error;
            throw timeoutError;
        }
        const userMessage = syncNetworkUserMessage(error);
        if (userMessage && error && typeof error === 'object') error.userMessage = userMessage;
        throw error;
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

function canRetrySyncRequest(endpoint, options, error) {
    const method = String(options.method || (options.body == null ? 'GET' : 'POST')).toUpperCase();
    const endpointPath = new URL(endpoint, 'http://notedown.local').pathname;
    const safeEndpoint = method === 'GET' || method === 'HEAD' || RETRYABLE_SYNC_ENDPOINTS.has(endpointPath);
    if (!safeEndpoint) return false;
    return shouldRetrySyncNetworkError(error);
}

function isTransientSyncError(error) {
    return isTransientSyncNetworkError(error);
}

async function syncRequest(serverUrl, endpoint, options = {}) {
    let lastError;
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 2);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await syncRequestOnce(serverUrl, endpoint, options);
        } catch (error) {
            lastError = error;
            if (attempt + 1 >= maxAttempts || !canRetrySyncRequest(endpoint, options, error)) throw error;
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    throw lastError;
}

function syncError(error, fallback = '동기화 작업 중 오류가 발생했습니다.') {
    return {
        ok: false,
        error: error?.userMessage
            || syncNetworkUserMessage(error)
            || (error instanceof Error && error.message ? error.message : fallback),
        statusCode: error?.status,
        data: error?.data
    };
}

function planItemRelativePath(item = {}) {
    return item?.relativePath
        || item?.file?.relativePath
        || item?.serverFile?.relativePath
        || item?.serverAttachment?.relativePath
        || item?.attachment?.relativePath
        || '';
}

function syncItemContentSize(item = {}) {
    const candidates = [
        item.size,
        item.file?.size,
        item.attachment?.size,
        item.serverFile?.size,
        item.serverAttachment?.size,
        item.serverAttachmentMetadata?.size
    ];
    return candidates.map(Number).find(value => Number.isFinite(value) && value > 0) || 0;
}

function syncDownloadOptions(token, item = {}) {
    const contentSize = syncItemContentSize(item);
    return {
        token,
        ...(contentSize > 0
            ? { expectedResponseBytes: Math.ceil((contentSize * 4) / 3) + 64 * 1024 }
            : {})
    };
}

function isSystemPlanItem(item) {
    return isSystemRelativePath(planItemRelativePath(item));
}

function isSyntheticMetadataConflict(item = {}) {
    const relativePath = toPosixPath(planItemRelativePath(item)).replace(/^\/+|\/+$/g, '');
    return item?.type === 'metadata'
        && item?.reason === 'server_metadata_changed_after_client_base'
        && relativePath === 'metadata';
}

function nonSystemPlanItems(items = []) {
    if (!Array.isArray(items)) return [];
    return items.filter(item => !isSystemPlanItem(item));
}

function summarizePlan(plan = {}) {
    return {
        uploadFiles: nonSystemPlanItems(plan.uploadFiles).length,
        downloadFiles: nonSystemPlanItems(plan.downloadFiles).length,
        deleteServerFiles: nonSystemPlanItems(plan.deleteServerFiles).length,
        deleteLocalFiles: nonSystemPlanItems(plan.deleteLocalFiles).length,
        uploadAttachments: nonSystemPlanItems(plan.uploadAttachments).length,
        downloadAttachments: nonSystemPlanItems(plan.downloadAttachments).length,
        deleteServerAttachments: nonSystemPlanItems(plan.deleteServerAttachments).length,
        deleteLocalAttachments: nonSystemPlanItems(plan.deleteLocalAttachments).length,
        conflicts: nonSystemPlanItems(plan.conflicts).length
    };
}

function clonePlan(plan = {}) {
    return {
        uploadFiles: [...(plan.uploadFiles || [])],
        downloadFiles: [...(plan.downloadFiles || [])],
        deleteServerFiles: [...(plan.deleteServerFiles || [])],
        deleteLocalFiles: [...(plan.deleteLocalFiles || [])],
        uploadAttachments: [...(plan.uploadAttachments || [])],
        downloadAttachments: [...(plan.downloadAttachments || [])],
        deleteServerAttachments: [...(plan.deleteServerAttachments || [])],
        deleteLocalAttachments: [...(plan.deleteLocalAttachments || [])],
        conflicts: [...(plan.conflicts || [])]
    };
}

function filterSyncPlan(plan = {}) {
    const next = clonePlan(plan);
    next.uploadFiles = nonSystemPlanItems(next.uploadFiles);
    next.downloadFiles = nonSystemPlanItems(next.downloadFiles);
    next.deleteServerFiles = nonSystemPlanItems(next.deleteServerFiles);
    next.deleteLocalFiles = nonSystemPlanItems(next.deleteLocalFiles);
    next.uploadAttachments = nonSystemPlanItems(next.uploadAttachments);
    next.downloadAttachments = nonSystemPlanItems(next.downloadAttachments);
    next.deleteServerAttachments = nonSystemPlanItems(next.deleteServerAttachments);
    next.deleteLocalAttachments = nonSystemPlanItems(next.deleteLocalAttachments);
    next.conflicts = nonSystemPlanItems(next.conflicts).map(item => {
        if (!isLocalDeleteConflict(item)) return item;
        const type = String(item?.reason || '').includes('attachment') ? 'attachment' : (item?.type || 'file');
        return markLocalDeleteConflict(item, type);
    });
    return next;
}

function filterInitialSyntheticMetadataConflict(plan = {}, metadata = {}) {
    const next = filterSyncPlan(plan);
    if ((metadata.notes || []).length === 0) {
        next.conflicts = next.conflicts.filter(item => !isSyntheticMetadataConflict(item));
    }
    return next;
}

function hasSyncHistory(syncState = {}) {
    if (Number(syncState.serverRevision) > 0 || Number(syncState.metadataRevision) > 0) return true;
    const fileStates = Object.values(syncState.files || {});
    const attachmentStates = Object.values(syncState.attachments || {});
    return fileStates.concat(attachmentStates).some(state => Number(state?.lastKnownRevision) > 0);
}

function serverDeleteLastKnownRevision(syncState = {}, item = {}, attachment = false) {
    const itemRevision = Number(item?.lastKnownRevision)
        || Number(item?.file?.lastKnownRevision)
        || Number(item?.attachment?.lastKnownRevision)
        || Number(item?.clientFile?.lastKnownRevision)
        || Number(item?.clientAttachment?.lastKnownRevision)
        || 0;
    if (itemRevision > 0) return itemRevision;

    const relativePath = planItemRelativePath(item);
    if (!relativePath || isSystemRelativePath(relativePath)) return 0;
    try {
        const state = (attachment ? syncState.attachments : syncState.files)?.[normalizeRelativePath(relativePath)] || {};
        return Number(state.lastKnownRevision) || 0;
    } catch (error) {
        return 0;
    }
}

function isPendingServerDelete(syncState = {}, item = {}, attachment = false) {
    const relativePath = planItemRelativePath(item);
    if (!relativePath || isSystemRelativePath(relativePath)) return false;
    try {
        const state = (attachment ? syncState.attachments : syncState.files)?.[
            normalizeRelativePath(relativePath)
        ];
        return isPendingSyncDeleteState(state);
    } catch (error) {
        return false;
    }
}

function filterUnsafeServerDeletes(plan = {}, syncState = {}) {
    const next = filterSyncPlan(plan);
    next.deleteServerFiles = next.deleteServerFiles.filter(item => (
        isPendingServerDelete(syncState, item, false)
        && serverDeleteLastKnownRevision(syncState, item, false) > 0
    ));
    next.deleteServerAttachments = next.deleteServerAttachments.filter(item => (
        isPendingServerDelete(syncState, item, true)
        && serverDeleteLastKnownRevision(syncState, item, true) > 0
    ));
    return next;
}

function planIncludesPath(plan, relativePath) {
    const groups = ['uploadFiles', 'downloadFiles', 'deleteServerFiles', 'deleteLocalFiles', 'conflicts'];
    return groups.some(group => (plan[group] || []).some(item => {
        const itemPath = planItemRelativePath(item);
        if (!itemPath || isSystemRelativePath(itemPath)) return false;
        return normalizeRelativePath(itemPath) === relativePath;
    }));
}

function mapManifestFiles(manifest = {}) {
    const files = new Map();
    for (const file of manifest.files || []) {
        if (!file?.relativePath) continue;
        if (isSystemRelativePath(file.relativePath)) continue;
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
        workspace: noteWorkspaceId(note),
        workspaceName: note.workspaceName || '',
        fileName: note.fileName || '',
        relativePath: note.relativePath ? normalizeRelativePath(note.relativePath) : '',
        updatedAtMs: Number(note.updatedAtMs) || 0
    };
}

function metadataNoteChanged(left, right) {
    return JSON.stringify(comparableMetadataNote(left)) !== JSON.stringify(comparableMetadataNote(right));
}

async function localFileSyncInfo(storagePath, syncState, relativePath, storageRelativePath = '') {
    const state = syncState.files?.[relativePath] || {};
    try {
        const { absolutePath } = resolveStorageFile(
            storagePath,
            storageRelativePath || state.storagePath || relativePath
        );
        const content = await fs.readFile(absolutePath);
        const stat = await fs.stat(absolutePath);
        return {
            exists: true,
            contentHash: sha256(content),
            updatedAtMs: Math.round(stat.mtimeMs),
            state
        };
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
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
    const plan = filterInitialSyntheticMetadataConflict(response.plan, localMetadata);
    if (!serverMetadata || metadataStatus === 'same' || metadataStatus === 'server_empty') return plan;

    const serverFiles = mapManifestFiles(response.manifest);
    const serverNotes = mapMetadataNotes(serverMetadata);
    const serverWorkspaces = mapMetadataWorkspaces(serverMetadata);
    const localNotes = mapMetadataNotes(localMetadata);

    for (const [relativePath, serverNote] of serverNotes.entries()) {
        if (planIncludesPath(plan, relativePath)) continue;

        const serverFile = serverFiles.get(relativePath);
        if (!serverFile || isDeletedFlag(serverFile.deleted)) continue;

        const localNote = localNotes.get(relativePath);
        const localInfo = await localFileSyncInfo(storagePath, syncState, relativePath, localNote?.storagePath);
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

        const localInfo = await localFileSyncInfo(storagePath, syncState, relativePath, localNote?.storagePath);
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
        const byId = notes.find(note => identityMatches(note, payloadNote.id));
        if (byId) return byId;
    }
    if (payloadNote?.storagePath) {
        const safeStoragePath = normalizeRelativePath(payloadNote.storagePath);
        const byStoragePath = notes.find(note => (
            note?.relativePath
            && noteStoragePath(note, note.relativePath) === safeStoragePath
        ));
        if (byStoragePath) return byStoragePath;
    }
    if (!payloadNote) return null;
    return {
        ...payloadNote,
        folder: noteWorkspaceId(payloadNote),
        workspace: noteWorkspaceId(payloadNote),
        workspaceName: noteWorkspaceName(payloadNote),
        fileName: noteFileName(payloadNote),
        relativePath: safeRelativePath || relativePathForNote(payloadNote),
        storagePath: payloadNote.storagePath || desiredNoteStoragePath(payloadNote, safeRelativePath || relativePathForNote(payloadNote))
    };
}

function notePayload(note, relativePath, storagePathOverride = '') {
    if (!note) return null;
    const workspaceId = noteWorkspaceId(note);
    const {
        body: _body,
        syncIdentityAliases: _syncIdentityAliases,
        ...metadataNote
    } = note;
    if (Array.isArray(metadataNote.attachments)) {
        metadataNote.attachments = metadataNote.attachments.map(attachment => {
            const { syncIdentityAliases: _attachmentAliases, ...payloadAttachment } = attachment;
            return payloadAttachment;
        });
    }
    const storagePath = storagePathOverride
        ? normalizeRelativePath(storagePathOverride)
        : noteStoragePath(note, relativePath);
    return {
        ...metadataNote,
        workspace: workspaceId,
        folder: workspaceId,
        workspaceName: noteWorkspaceName(note, workspaceId),
        fileName: path.posix.basename(storagePath),
        relativePath,
        storagePath
    };
}

function metadataSyncPayload(metadata = {}) {
    return {
        ...metadata,
        notes: (metadata.notes || []).map(note => {
            const { syncIdentityAliases: _noteAliases, ...payloadNote } = note || {};
            payloadNote.attachments = (note?.attachments || []).map(attachment => {
                const { syncIdentityAliases: _attachmentAliases, ...payloadAttachment } = attachment;
                return payloadAttachment;
            });
            return payloadNote;
        })
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
    const previous = indexPreviousNoteIdentities(metadata.notes, normalizeRelativePath);
    indexPreviousAttachmentIdentities(metadata.notes, normalizeRelativePath);
    const requestedId = String(note.id || '').trim();
    const requestedRelativePath = normalizeRelativePath(note.relativePath);
    const existingById = requestedId ? previous.byId.get(requestedId) || null : null;
    const existingByRelativePath = previous.byRelativePath.get(requestedRelativePath) || null;
    if (existingById && existingByRelativePath && existingById !== existingByRelativePath) {
        throw new Error(`노트 ID와 경로가 서로 다른 기존 노트를 가리킵니다: ${requestedRelativePath}`);
    }
    if (existingByRelativePath && requestedId && !identityMatches(existingByRelativePath, requestedId)) {
        throw new Error(`노트 경로가 다른 ID에 연결되어 있습니다: ${requestedRelativePath}`);
    }
    const existing = existingById || existingByRelativePath;
    const relativePath = existing?.relativePath
        ? normalizeRelativePath(existing.relativePath)
        : requestedRelativePath;
    const workspaceId = noteWorkspaceId({ ...note, relativePath });
    const nextNote = {
        ...(existing || {}),
        ...note,
        id: existing?.id || requestedId || note.id,
        folder: workspaceId,
        workspace: workspaceId,
        relativePath,
        storagePath: existing?.storagePath
            ? normalizeRelativePath(existing.storagePath)
            : (note.storagePath ? normalizeRelativePath(note.storagePath) : noteStoragePath(note, relativePath)),
        ...(existing && Array.isArray(existing.attachments)
            ? { attachments: existing.attachments }
            : {})
    };
    const index = existing ? metadata.notes.indexOf(existing) : -1;
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
    const activePaths = new Set();
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        const relativePath = normalizeRelativePath(note.relativePath);
        try {
            const { absolutePath } = resolveStorageFile(storagePath, noteStoragePath(note, relativePath));
            const content = await fs.readFile(absolutePath);
            const stat = await fs.stat(absolutePath);
            const state = syncState.files?.[relativePath] || {};
            files.push({
                relativePath,
                contentHash: sha256(content),
                lastKnownRevision: Number(state.lastKnownRevision) || 0,
                updatedAtMs: Number(note.updatedAtMs) || Math.round(stat.mtimeMs)
            });
            activePaths.add(relativePath);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            // A genuinely missing file is recoverable from metadata/server state, but is never a delete intent.
        }
    }

    for (const [rawRelativePath, state] of Object.entries(syncState.files || {})) {
        if (!rawRelativePath || isDeletedFlag(state?.deleted)) continue;
        const relativePath = normalizeRelativePath(rawRelativePath);
        const lastKnownRevision = Number(state?.lastKnownRevision) || 0;
        if (
            !isPendingSyncDeleteIntent(state)
            || activePaths.has(relativePath)
            || isSystemRelativePath(relativePath)
        ) continue;
        files.push({ relativePath, deleted: true, lastKnownRevision });
    }

    return files;
}

async function buildKnownAttachments(storagePath, metadata, syncState) {
    const attachments = [];
    const activePaths = new Set();
    for (const note of metadata.notes || []) {
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath || isDeletedFlag(attachment.deleted)) continue;
            const relativePath = normalizeRelativePath(attachment.relativePath);
            const storageRelativePath = normalizeRelativePath(attachment.storagePath || relativePath);
            try {
                const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);
                const content = await fs.readFile(absolutePath);
                const stat = await fs.stat(absolutePath);
                const state = syncState.attachments?.[relativePath] || {};
                attachments.push({
                    relativePath,
                    contentHash: sha256(content),
                    lastKnownRevision: Number(state.lastKnownRevision) || 0,
                    updatedAtMs: Number(attachment.updatedAtMs) || Math.round(stat.mtimeMs)
                });
                activePaths.add(relativePath);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
                // A genuinely missing attachment is recoverable, but is never a delete intent.
            }
        }
    }

    for (const [rawRelativePath, state] of Object.entries(syncState.attachments || {})) {
        if (!rawRelativePath || isDeletedFlag(state?.deleted)) continue;
        const relativePath = normalizeRelativePath(rawRelativePath);
        const lastKnownRevision = Number(state?.lastKnownRevision) || 0;
        if (
            !isPendingSyncDeleteIntent(state)
            || activePaths.has(relativePath)
            || isSystemRelativePath(relativePath)
        ) continue;
        attachments.push({ relativePath, deleted: true, lastKnownRevision });
    }

    return attachments;
}

async function createSyncPlan(args = {}) {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
    const syncRecovery = await rebaseSyncStateIfServerReset(args);
    const metadata = await ensureMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const syncHistoryExists = hasSyncHistory(syncState);
    const knownFiles = syncHistoryExists ? await buildKnownFiles(storagePath, metadata, syncState) : [];
    const knownAttachments = syncHistoryExists ? await buildKnownAttachments(storagePath, metadata, syncState) : [];

    const response = await syncRequest(serverUrl, '/api/sync/plan', {
        token,
        body: {
            clientId,
            baseRevision: Number(syncState.serverRevision) || 0,
            knownFiles,
            knownAttachments,
            metadata: {
                body: metadataSyncPayload(metadata),
                lastKnownRevision: Number(syncState.metadataRevision) || 0
            }
        }
    });
    response.plan = filterUnsafeServerDeletes(
        await reconcilePlanWithServerMetadata(storagePath, metadata, syncState, response),
        syncState
    );

    return {
        ok: true,
        ...response,
        ...(syncRecovery.rebased ? { syncRecovery } : {}),
        summary: summarizePlan(response.plan)
    };
}

async function prepareLocalFileUpload(args = {}, relativePathOverride = '') {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
    const metadata = await ensureMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const payloadNote = args.note || null;
    const note = findMetadataNote(metadata, relativePathOverride || args.relativePath, payloadNote);
    const deleted = isDeletedFlag(args.deleted);
    let relativePath = normalizeRelativePath(relativePathOverride || args.relativePath || note?.relativePath || relativePathForNote(payloadNote));
    let fileState = syncState.files?.[relativePath] || {};
    if (deleted && !isPendingSyncDeleteState(fileState)) {
        const pendingState = pendingDeleteStateMatch(syncState, {
            ...(payloadNote || note || {}),
            relativePath
        });
        if (pendingState?.relativePath) {
            relativePath = normalizeRelativePath(pendingState.relativePath);
            fileState = syncState.files?.[relativePath] || pendingState;
        }
    }
    const lastKnownRevision = Number(args.lastKnownRevision) || Number(fileState.lastKnownRevision) || 0;
    if (deleted && lastKnownRevision <= 0) {
        throw new Error('서버 파일 삭제에는 lastKnownRevision이 필요합니다.');
    }
    const body = {
        clientId,
        baseRevision: Number(syncState.serverRevision) || 0,
        relativePath,
        lastKnownRevision
    };
    if (deleted) body.deleted = true;

    if (note) {
        const canonicalNote = fileState.noteId
            ? { ...note, id: fileState.noteId }
            : note;
        body.note = notePayload(canonicalNote, relativePath);
        body.workspace = workspacePayload(metadata, canonicalNote);
    }

    if (!deleted) {
        const { absolutePath } = resolveStorageFile(storagePath, note ? noteStoragePath(note, relativePath) : relativePath);
        const content = await fs.readFile(absolutePath);
        const stat = await fs.stat(absolutePath);
        body.content = content.toString('base64');
        body.contentEncoding = 'base64';
        body.contentHash = sha256(content);
        body.updatedAtMs = Number(note?.updatedAtMs) || Math.round(stat.mtimeMs);
    }

    return { storagePath, serverUrl, token, syncState, body };
}

function preparedUploadCheckpointOptions(prepared, endpoint, options = {}) {
    const relativePath = normalizeRelativePath(prepared.body.relativePath);
    const attachment = String(endpoint || '').includes('/attachment');
    const metadata = attachment ? prepared.body.attachment : prepared.body.note;
    return {
        ...options,
        clearRebaseConflictPaths: [...new Set([
            ...(Array.isArray(options.clearRebaseConflictPaths)
                ? options.clearRebaseConflictPaths
                : []),
            relativePath
        ])],
        ...(metadata
            ? {
                acceptedMetadataByPath: {
                    ...(options.acceptedMetadataByPath || {}),
                    [relativePath]: metadata
                }
            }
            : {})
    };
}

async function sendPreparedSyncUpload(prepared, endpoint, writeState = true) {
    const previousRecovery = await recoverPreviousUncertainSyncMutation(prepared, endpoint);
    let response = previousRecovery?.response || null;
    const journalKey = response
        ? null
        : await rememberUncertainSyncMutation(prepared, endpoint);
    try {
        if (!response) {
            response = await syncRequest(prepared.serverUrl, endpoint, {
                token: prepared.token,
                body: prepared.body
            });
        }
    } catch (error) {
        if (!isTransientSyncError(error)) {
            await forgetUncertainSyncMutation(prepared.storagePath, journalKey);
            throw error;
        }
        if (!shouldProbeMutationResult(error)) throw error;
        const proof = await recoverMutationFromManifest({
            loadManifest: () => fetchFreshSyncManifest(
                prepared.serverUrl,
                prepared.token,
                prepared.body.baseRevision,
                { timeoutMs: 8000, maxAttempts: 1 }
            ),
            acknowledged: manifest => acknowledgedSyncUploadEntry(
                prepared.body,
                endpoint,
                manifest
            )
        });
        if (!proof.acknowledged) throw error;
        const manifest = proof.manifest;
        const acknowledgedEntry = proof.entry;
        const attachment = endpoint.includes('/attachment');
        response = {
            status: 'ok',
            manifest,
            recoveredAfterResponseError: true,
            ...(attachment ? { attachment: acknowledgedEntry } : { file: acknowledgedEntry })
        };
    }
    if (response.status === 'conflict' && journalKey) {
        await forgetUncertainSyncMutation(prepared.storagePath, journalKey);
    }
    if (writeState && response.manifest) {
        const checkpointOptions = response.status === 'conflict'
            ? syncConflictCheckpointOptions(response, prepared.body.relativePath)
            : preparedUploadCheckpointOptions(prepared, endpoint);
        await writeSyncStateFromManifest(
            prepared.storagePath,
            response.manifest,
            prepared.syncState,
            checkpointOptions
        );
    }
    return {
        ok: response.status === 'ok',
        ...response
    };
}

async function uploadLocalFile(args = {}, relativePathOverride = '') {
    return sendPreparedSyncUpload(
        await prepareLocalFileUpload(args, relativePathOverride),
        '/api/sync/file'
    );
}

function findMetadataAttachment(metadata, relativePath, fallback = null) {
    const safeRelativePath = relativePath ? normalizeRelativePath(relativePath) : '';
    const fallbackId = String(fallback?.id || fallback?.attachmentId || '').trim();
    const fallbackStoragePath = fallback?.storagePath
        ? normalizeRelativePath(fallback.storagePath)
        : '';
    for (const note of metadata.notes || []) {
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath) continue;
            if (
                normalizeRelativePath(attachment.relativePath) === safeRelativePath
                || (fallbackId && identityMatches(attachment, fallbackId))
                || (
                    fallbackStoragePath
                    && normalizeRelativePath(attachment.storagePath || attachment.relativePath) === fallbackStoragePath
                )
            ) {
                return normalizeAttachmentMetadata(attachment, note.relativePath ? normalizeRelativePath(note.relativePath) : '');
            }
        }
    }
    if (fallback?.relativePath) return normalizeAttachmentMetadata(fallback, fallback.noteRelativePath || '');
    return null;
}

function findMetadataNoteByAttachment(metadata, attachment = {}) {
    const noteRelativePath = attachment.noteRelativePath || '';
    if (noteRelativePath) {
        const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
        return (metadata.notes || []).find(note => note?.relativePath && normalizeRelativePath(note.relativePath) === safeNoteRelativePath) || null;
    }
    const attachmentRelativePath = attachment.relativePath ? normalizeRelativePath(attachment.relativePath) : '';
    if (!attachmentRelativePath) return null;
    return (metadata.notes || []).find(note => (note.attachments || []).some(item => {
        if (!item?.relativePath) return false;
        return normalizeRelativePath(item.relativePath) === attachmentRelativePath;
    })) || null;
}

async function prepareLocalAttachmentUpload(args = {}, item = {}) {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
    const metadata = await ensureMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const requestedRelativePath = normalizeRelativePath(item.relativePath || args.relativePath);
    const deleted = isDeletedFlag(args.deleted) || isDeletedFlag(item.deleted);
    const attachment = findMetadataAttachment(
        metadata,
        requestedRelativePath,
        item.attachment || args.attachment || item
    );
    let relativePath = normalizeRelativePath(attachment?.relativePath || requestedRelativePath);
    let state = syncState.attachments?.[relativePath] || {};
    if (deleted && !isPendingSyncDeleteState(state)) {
        const pendingState = pendingDeleteStateMatch(syncState, {
            ...(item.attachment || args.attachment || item || {}),
            relativePath
        }, true);
        if (pendingState?.relativePath) {
            relativePath = normalizeRelativePath(pendingState.relativePath);
            state = syncState.attachments?.[relativePath] || pendingState;
        }
    }
    const note = findMetadataNoteByAttachment(metadata, attachment || item) || findMetadataNote(metadata, item.noteRelativePath || attachment?.noteRelativePath || args.noteRelativePath, item.note || args.note);
    const rawNoteRelativePath = deleted
        ? (
            state.noteRelativePath
            || item.noteRelativePath
            || attachment?.noteRelativePath
            || note?.relativePath
            || args.noteRelativePath
            || ''
        )
        : (
            item.noteRelativePath
            || attachment?.noteRelativePath
            || note?.relativePath
            || args.noteRelativePath
            || state.noteRelativePath
            || ''
        );
    const noteRelativePath = rawNoteRelativePath ? normalizeRelativePath(rawNoteRelativePath) : '';
    if (!deleted && !noteRelativePath) throw new Error('첨부 파일을 연결할 노트 경로가 필요합니다.');
    const lastKnownRevision = Number(args.lastKnownRevision) || Number(item.lastKnownRevision) || Number(state.lastKnownRevision) || 0;
    if (deleted && lastKnownRevision <= 0) {
        throw new Error('서버 첨부 파일 삭제에는 lastKnownRevision이 필요합니다.');
    }
    const body = {
        clientId,
        baseRevision: Number(syncState.serverRevision) || 0,
        relativePath,
        lastKnownRevision
    };
    if (noteRelativePath) body.noteRelativePath = noteRelativePath;
    if (deleted) body.deleted = true;

    if (attachment) {
        body.attachment = normalizeAttachmentMetadata({
            ...attachment,
            ...(state.attachmentId ? { id: state.attachmentId } : {}),
            relativePath,
            noteRelativePath
        }, noteRelativePath);
        body.fileName = attachment.fileName;
        body.mimeType = attachment.mimeType || undefined;
    }
    if (note && !deleted) {
        body.note = notePayload(note, normalizeRelativePath(note.relativePath || noteRelativePath));
        body.workspace = workspacePayload(metadata, note);
    }

    if (!deleted) {
        const { absolutePath } = resolveStorageFile(storagePath, attachment?.storagePath || relativePath);
        const content = await fs.readFile(absolutePath);
        const stat = await fs.stat(absolutePath);
        body.contentHash = sha256(content);
        body.updatedAtMs = Number(attachment?.updatedAtMs) || Math.round(stat.mtimeMs);
        if (item.contentRequired !== false) {
            body.content = content.toString('base64');
            body.contentEncoding = 'base64';
        }
        if (!body.attachment) {
            body.attachment = normalizeAttachmentMetadata({
                fileName: path.posix.basename(relativePath),
                relativePath,
                noteRelativePath,
                size: content.length,
                contentHash: body.contentHash,
                updatedAtMs: body.updatedAtMs
            }, noteRelativePath);
        } else {
            body.attachment = {
                ...body.attachment,
                contentHash: body.contentHash,
                size: Number(body.attachment.size) || content.length,
                updatedAtMs: body.updatedAtMs
            };
        }
    }

    return { storagePath, serverUrl, token, syncState, body };
}

async function uploadLocalAttachment(args = {}, item = {}) {
    return sendPreparedSyncUpload(
        await prepareLocalAttachmentUpload(args, item),
        '/api/sync/attachment'
    );
}

async function uploadLocalNoteWithAttachments(args = {}) {
    const { storagePath } = syncConfig(args);
    const syncRecovery = await rebaseSyncStateIfServerReset(args);
    if (syncRecovery.rebased) {
        return {
            ...localStorageChangedDuringSyncResult({ plan: {} }, null, false),
            syncRecovery
        };
    }
    if (isDeletedFlag(args.deleted)) {
        const syncState = await readSyncState(storagePath);
        const pendingDelete = pendingDeleteStateMatch(syncState, args.note || {});
        if (pendingDelete?.rebaseConflict === true) {
            const planResponse = await createSyncPlan(args);
            const conflicts = nonSystemPlanItems(planResponse.plan?.conflicts);
            return {
                ...planResponse,
                ok: false,
                status: conflicts.length > 0 ? 'conflict' : 'error',
                error: conflicts.length > 0
                    ? ''
                    : '서버 기준이 변경된 삭제 요청은 전체 동기화에서 확인한 뒤 적용해야 합니다.'
            };
        }
    }
    const snapshot = await runStorageOperation(storagePath, async () => {
        const storageGeneration = storageMutationGeneration(storagePath);
        const noteUpload = await prepareLocalFileUpload(args);
        const note = noteUpload.body.note || args.note || null;
        const attachments = Array.isArray(note?.attachments)
            ? note.attachments.map(attachment => ({ ...attachment }))
            : [];
        const deleting = isDeletedFlag(args.deleted);
        const attachmentUploads = [];

        for (const attachment of attachments) {
            if (!attachment?.relativePath) continue;
            if (!deleting && isDeletedFlag(attachment.deleted)) continue;
            attachmentUploads.push(await prepareLocalAttachmentUpload(
                deleting ? { ...args, deleted: true } : args,
                {
                    ...attachment,
                    attachment,
                    noteRelativePath: attachment.noteRelativePath
                        || note?.relativePath
                        || relativePathForNote(note)
                }
            ));
        }
        if (storageMutationGeneration(storagePath) !== storageGeneration) {
            return { storageChanged: true, storageGeneration };
        }
        return { storageGeneration, noteUpload, attachmentUploads, deleting };
    });

    if (
        snapshot.storageChanged
        || storageMutationGeneration(storagePath) !== snapshot.storageGeneration
    ) {
        return localStorageChangedDuringSyncResult({ plan: {} }, null, false);
    }

    const uploadedAttachments = [];
    const attachmentConflicts = [];
    let latestManifest = null;
    let didSend = false;
    const sendSnapshot = async (prepared, endpoint) => {
        if (latestManifest?.serverRevision != null) {
            prepared.body.baseRevision = Number(latestManifest.serverRevision) || prepared.body.baseRevision;
        }
        didSend = true;
        const result = await sendPreparedSyncUpload(prepared, endpoint, false);
        if (result.manifest) latestManifest = result.manifest;
        return result;
    };

    let noteResult;
    if (snapshot.deleting) {
        for (const prepared of snapshot.attachmentUploads) {
            const result = await sendSnapshot(prepared, '/api/sync/attachment');
            if (result.status === 'conflict') {
                const conflict = markLocalDeleteConflict(
                    result.attachment || result.file || { relativePath: prepared.body.relativePath },
                    'attachment'
                );
                if (result.attachment) result.attachment = conflict;
                else result.file = conflict;
                attachmentConflicts.push(conflict);
            } else {
                uploadedAttachments.push(result.attachment);
            }
        }
        noteResult = attachmentConflicts.length > 0
            ? { ok: false, status: 'conflict', manifest: latestManifest }
            : await sendSnapshot(snapshot.noteUpload, '/api/sync/file');
        if (noteResult.status === 'conflict' && noteResult.file) {
            noteResult.file = markLocalDeleteConflict(noteResult.file, 'file');
            noteResult.file.clientNote = noteResult.file.clientNote || snapshot.noteUpload.body.note || null;
        }
    } else {
        noteResult = await sendSnapshot(snapshot.noteUpload, '/api/sync/file');
    }

    if (!snapshot.deleting && noteResult.status !== 'conflict') {
        for (const prepared of snapshot.attachmentUploads) {
            const result = await sendSnapshot(prepared, '/api/sync/attachment');
            if (result.status === 'conflict') {
                attachmentConflicts.push(result.attachment || result.file);
            } else {
                uploadedAttachments.push(result.attachment);
            }
        }
    }

    const uploadResult = {
        ...noteResult,
        ok: Boolean(noteResult.ok && attachmentConflicts.length === 0),
        uploadedAttachments,
        attachmentConflicts
    };
    const stateApplied = await runStorageOperation(storagePath, async () => {
        const storageUnchanged = storageMutationGeneration(storagePath) === snapshot.storageGeneration;
        if (latestManifest) {
            const conflictItems = [
                ...attachmentConflicts,
                ...(noteResult.status === 'conflict' ? [noteResult.file || noteResult.attachment] : [])
            ];
            const conflictOptions = syncConflictCheckpointOptions(
                conflictItems,
                noteResult.status === 'conflict' ? snapshot.noteUpload.body.relativePath : ''
            );
            const clearRebaseConflictPaths = [
                ...(noteResult.status !== 'conflict'
                    ? [snapshot.noteUpload.body.relativePath]
                    : []),
                ...uploadedAttachments.map(item => planItemRelativePath(item)).filter(Boolean)
            ];
            const acceptedPaths = new Set(clearRebaseConflictPaths.map(normalizeRelativePath));
            const acceptedMetadataByPath = {};
            for (const prepared of [snapshot.noteUpload, ...snapshot.attachmentUploads]) {
                const preparedPath = normalizeRelativePath(prepared.body.relativePath);
                if (!acceptedPaths.has(preparedPath)) continue;
                const acceptedMetadata = prepared.body.note || prepared.body.attachment;
                if (acceptedMetadata) acceptedMetadataByPath[preparedPath] = acceptedMetadata;
            }
            await writeSyncStateFromManifest(
                storagePath,
                latestManifest,
                snapshot.noteUpload.syncState,
                {
                    ...conflictOptions,
                    clearRebaseConflictPaths,
                    acceptedMetadataByPath
                }
            );
        }
        return storageUnchanged;
    });
    if (!stateApplied) {
        return {
            ...uploadResult,
            ...localStorageChangedDuringSyncResult({ plan: {} }, null, didSend),
            uploadedAttachments,
            attachmentConflicts
        };
    }
    return uploadResult;
}

function encodeRelativePathForUrl(relativePath) {
    return normalizeRelativePath(relativePath).split('/').map(encodeURIComponent).join('/');
}

function decodeFilePayloadContent(payload = {}) {
    if (isDeletedFlag(payload.deleted)) return '';
    if (payload.contentEncoding === 'base64') return Buffer.from(payload.content || '', 'base64').toString('utf8');
    return String(payload.content || '');
}

function decodeBinaryPayloadContent(payload = {}) {
    if (isDeletedFlag(payload.deleted)) return Buffer.alloc(0);
    if (payload.contentEncoding === 'base64') return Buffer.from(payload.content || '', 'base64');
    return Buffer.from(String(payload.content || ''), 'utf8');
}

async function downloadServerAttachment(args = {}, item, metadata, payloadOverride) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = payloadOverride === undefined
        ? await syncRequest(
            serverUrl,
            `/api/attachments/${encodeRelativePathForUrl(relativePath)}`,
            syncDownloadOptions(token, item)
        )
        : payloadOverride;
    validateMetadataStorageIdentities(metadata);
    const noteRelativePath = normalizeRelativePath(
        item.noteRelativePath
        || item.attachment?.noteRelativePath
        || payload.noteRelativePath
        || payload.attachment?.noteRelativePath
    );
    const existingAttachment = findMetadataAttachment(metadata, relativePath);
    const requestedStoragePath = normalizeRelativePath(
        payload.storagePath
        || item.serverAttachment?.storagePath
        || item.attachment?.storagePath
        || item.storagePath
        || relativePath
    );
    const identity = resolveAttachmentStorageIdentity(metadata, {
        id: item.attachment?.id || payload.attachmentId || existingAttachment?.id,
        relativePath,
        storagePath: existingAttachment?.storagePath || requestedStoragePath
    }, noteRelativePath || existingAttachment?.noteRelativePath || '');
    const storageRelativePath = identity.storagePath || requestedStoragePath;
    const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);

    if (isDeletedFlag(payload.deleted)) {
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
        removeMetadataAttachment(metadata, relativePath);
        return { relativePath, deleted: true };
    }

    if (item.note) {
        upsertMetadataWorkspace(metadata, item.workspace || workspacePayload(metadata, item.note));
        upsertMetadataNote(metadata, notePayload(item.note, noteRelativePath));
    }
    if (!findMetadataNote(metadata, noteRelativePath, null)) {
        throw new Error(`첨부 파일을 연결할 노트를 찾지 못했습니다: ${noteRelativePath}`);
    }
    const content = decodeBinaryPayloadContent(payload);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);

    const attachment = normalizeAttachmentMetadata({
        ...(item.attachment || {}),
        id: identity.id
            || item.attachment?.id
            || payload.attachmentId
            || normalizeAttachmentMetadata({ relativePath }, noteRelativePath).id,
        fileName: item.attachment?.fileName || payload.fileName || path.posix.basename(relativePath),
        relativePath,
        storagePath: storageRelativePath,
        noteRelativePath,
        mimeType: item.attachment?.mimeType || payload.mimeType || null,
        size: Number(payload.size) || content.length,
        contentHash: payload.contentHash || sha256(content),
        updatedAtMs: item.attachment?.updatedAtMs || payload.clientUpdatedAtMs || Date.now()
    }, noteRelativePath);
    upsertMetadataAttachment(metadata, noteRelativePath, attachment);
    return { relativePath, deleted: false, attachment };
}

async function downloadServerFile(args = {}, item, metadata, payloadOverride) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = payloadOverride === undefined
        ? await syncRequest(
            serverUrl,
            `/api/files/${encodeRelativePathForUrl(relativePath)}`,
            syncDownloadOptions(token, item)
        )
        : payloadOverride;
    validateMetadataStorageIdentities(metadata);
    const existingNote = findMetadataNote(metadata, relativePath, null);
    const requestedStoragePath = normalizeRelativePath(
        payload.storagePath
        || item.serverFile?.storagePath
        || item.note?.storagePath
        || item.storagePath
        || desiredNoteStoragePath(item.note || { relativePath, title: payload.title || path.posix.basename(relativePath) }, relativePath)
    );
    const storageRelativePath = existingNote
        ? noteStoragePath(existingNote, relativePath)
        : requestedStoragePath;
    const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);

    if (isDeletedFlag(payload.deleted)) {
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
        removeMetadataNote(metadata, relativePath);
        return { relativePath, deleted: true };
    }

    const content = payload.contentEncoding === 'base64'
        ? Buffer.from(payload.content || '', 'base64')
        : Buffer.from(String(payload.content || ''), 'utf8');
    const note = item.note || {
        id: noteIdFromRelativePath(relativePath),
        icon: 'N',
        title: titleFromMarkdown(content.toString('utf8'), path.posix.basename(relativePath)),
        tags: [],
        status: 'active',
        workspace: item.workspace?.id || UNFILED_WORKSPACE_ID,
        workspaceName: item.workspace?.name,
        fileName: path.posix.basename(storageRelativePath),
        relativePath,
        storagePath: storageRelativePath,
        updatedAtMs: payload.clientUpdatedAtMs || Date.now()
    };
    upsertMetadataWorkspace(metadata, item.workspace || workspacePayload(metadata, note));
    upsertMetadataNote(metadata, notePayload(note, relativePath, storageRelativePath));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
    return { relativePath, deleted: false };
}

async function deleteLocalFile(storagePath, item, metadata) {
    const relativePath = normalizeRelativePath(item.relativePath);
    const note = findMetadataNote(metadata, relativePath, item.note || null);
    const { absolutePath } = resolveStorageFile(storagePath, note ? noteStoragePath(note, relativePath) : relativePath);
    const attachments = removeMetadataNoteAttachments(metadata, relativePath);
    for (const attachment of attachments) {
        if (!attachment?.relativePath) continue;
        const attachmentPath = resolveStorageFile(storagePath, attachment.storagePath || attachment.relativePath).absolutePath;
        await fs.rm(attachmentPath, { force: true });
        await removeEmptyParents(path.dirname(attachmentPath), path.resolve(storagePath));
    }
    await fs.rm(absolutePath, { force: true });
    await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
    removeMetadataNote(metadata, relativePath);
    return { relativePath };
}

async function deleteLocalAttachment(storagePath, item, metadata) {
    const relativePath = normalizeRelativePath(item.relativePath);
    const attachment = findMetadataAttachment(metadata, relativePath, item.attachment || item);
    const { absolutePath } = resolveStorageFile(storagePath, attachment?.storagePath || relativePath);
    await fs.rm(absolutePath, { force: true });
    await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
    removeMetadataAttachment(metadata, relativePath);
    return { relativePath };
}

async function readSyncConflictFile(args = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    if (isSystemRelativePath(args.relativePath)) {
        return {
            ok: false,
            relativePath: String(args.relativePath || ''),
            localExists: false,
            error: '시스템 파일은 충돌 비교 대상이 아닙니다.'
        };
    }
    const relativePath = normalizeRelativePath(args.relativePath);
    const isAttachment = args.type === 'attachment' || relativePath.includes('/.attachments/');
    const metadata = await ensureMetadata(storagePath);
    const localNote = findMetadataNote(metadata, relativePath, null);
    const localAttachment = isAttachment ? findMetadataAttachment(metadata, relativePath, args.attachment || null) : null;
    const localStoragePath = isAttachment
        ? (localAttachment?.storagePath || relativePath)
        : (localNote ? noteStoragePath(localNote, relativePath) : relativePath);
    const { absolutePath } = resolveStorageFile(storagePath, localStoragePath);
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
        if (isAttachment) {
            const content = await fs.readFile(absolutePath);
            const stat = await fs.stat(absolutePath);
            result.localContent = `첨부 파일\n\n경로: ${relativePath}\n크기: ${content.length} bytes\nSHA-256: ${sha256(content)}\n수정: ${stat.mtime.toISOString()}`;
        } else {
            result.localContent = await fs.readFile(absolutePath, 'utf8');
        }
        result.localExists = true;
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            result.localError = error instanceof Error ? error.message : '로컬 파일을 읽지 못했습니다.';
        }
    }

    try {
        const endpoint = isAttachment ? `/api/attachments/${encodeRelativePathForUrl(relativePath)}` : `/api/files/${encodeRelativePathForUrl(relativePath)}`;
        const serverFile = await syncRequest(serverUrl, endpoint, syncDownloadOptions(token, args));
        result.serverFile = serverFile;
        result.serverContent = isAttachment
            ? `첨부 파일\n\n경로: ${relativePath}\n크기: ${serverFile.size || 0} bytes\nSHA-256: ${serverFile.contentHash || ''}\n수정: ${serverFile.serverUpdatedAt || ''}`
            : decodeFilePayloadContent(serverFile);
    } catch (error) {
        result.serverError = error instanceof Error ? error.message : '서버 파일을 읽지 못했습니다.';
    }

    result.localDeleted = !result.localExists && !(isAttachment ? localAttachment : localNote);
    return result;
}

async function localSyncPathExists(storagePath, relativePath, isAttachment) {
    const metadata = await ensureMetadata(storagePath);
    const localNote = findMetadataNote(metadata, relativePath, null);
    const localAttachment = isAttachment ? findMetadataAttachment(metadata, relativePath, null) : null;
    if (isAttachment ? !localAttachment : !localNote) return false;
    const storageRelativePath = isAttachment
        ? (localAttachment.storagePath || relativePath)
        : noteStoragePath(localNote, relativePath);
    try {
        await fs.stat(resolveStorageFile(storagePath, storageRelativePath).absolutePath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

function checkpointServerResolvedEntry(syncState, relativePath, payload, metadataEntry, attachment) {
    const entries = attachment
        ? (syncState.attachments ||= {})
        : (syncState.files ||= {});
    const previous = entries[relativePath] || {};
    const deleted = isDeletedFlag(payload.deleted);
    const next = {
        ...previous,
        lastKnownRevision: Number(payload.revision) || Number(previous.lastKnownRevision) || 0,
        contentHash: deleted ? null : (payload.contentHash || previous.contentHash || null),
        updatedAtMs: Number(payload.clientUpdatedAtMs) || Number(previous.updatedAtMs) || null,
        deleted
    };
    delete next.pendingDelete;
    delete next.rebaseConflict;
    if (metadataEntry && !deleted) {
        next.localMetadataHash = syncLocalMetadataFingerprint(metadataEntry, attachment);
    } else {
        delete next.localMetadataHash;
    }
    entries[relativePath] = next;
    syncState.updatedAt = new Date().toISOString();
    return syncState;
}

function serverResolutionManifestEntry(manifest, relativePath, attachment) {
    const entries = attachment ? manifest?.attachments : manifest?.files;
    return (entries || []).find(entry => (
        entry?.relativePath
        && normalizeRelativePath(entry.relativePath) === relativePath
    )) || null;
}

async function convergeAppliedSyncConflict(args, details = {}) {
    try {
        const planResponse = await convergeSyncAfterResolution(args);
        return {
            ...planResponse,
            ...details,
            didApply: true,
            summary: planResponse.summary || summarizePlan(planResponse.plan || {})
        };
    } catch (error) {
        return {
            ok: false,
            status: 'retry',
            retryable: true,
            didApply: true,
            ...details,
            error: syncNetworkUserMessage(error)
                || (error instanceof Error ? error.message : '적용 결과를 다시 확인해야 합니다.')
        };
    }
}

async function resolveSyncConflict(args = {}, options = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const syncRecovery = options.rebase === false
        ? { rebased: false }
        : await rebaseSyncStateIfServerReset(args);
    if (syncRecovery.rebased) {
        return {
            ...localStorageChangedDuringSyncResult({ plan: {} }, null, false),
            syncRecovery
        };
    }
    const relativePath = normalizeRelativePath(args.relativePath);
    const resolution = String(args.resolution || '').trim();
    const isAttachment = args.type === 'attachment' || relativePath.includes('/.attachments/');
    if (!['server', 'local'].includes(resolution)) {
        throw new Error('적용할 충돌 버전을 선택하세요.');
    }
    const initialStorageGeneration = await runStorageOperation(
        storagePath,
        () => storageMutationGeneration(storagePath)
    );

    if (resolution === 'server') {
        const previousState = await readSyncState(storagePath);
        const endpoint = isAttachment
            ? `/api/attachments/${encodeRelativePathForUrl(relativePath)}`
            : `/api/files/${encodeRelativePathForUrl(relativePath)}`;
        const serverDescriptor = isAttachment
            ? (args.serverAttachment || args.serverFile)
            : args.serverFile;
        const payload = isDeletedFlag(serverDescriptor?.deleted)
            ? {
                ...serverDescriptor,
                relativePath,
                deleted: true,
                revision: Number(serverDescriptor.revision) || Number(args.serverRevision) || 0
            }
            : await syncRequest(serverUrl, endpoint, syncDownloadOptions(token, args));
        const applyResult = await runStorageOperation(storagePath, async () => {
            if (storageMutationGeneration(storagePath) !== initialStorageGeneration) {
                return { storageChanged: true };
            }
            const metadata = await ensureMetadata(storagePath);
            validateMetadataStorageIdentities(metadata);
            const appliedStorageGeneration = bumpStorageMutationGeneration(storagePath);
            const file = !isAttachment && isDeletedFlag(payload.deleted)
                ? await deleteLocalFile(storagePath, {
                    relativePath,
                    note: args.clientNote || args.serverNote || null
                }, metadata)
                : isAttachment
                    ? await downloadServerAttachment(args, {
                relativePath,
                serverAttachment: args.serverAttachment || args.serverFile || null,
                attachment: args.serverAttachmentMetadata || args.serverAttachment || null,
                noteRelativePath: args.noteRelativePath || args.serverAttachmentMetadata?.noteRelativePath || null,
                note: args.serverNote || null,
                workspace: args.serverWorkspace || null
                }, metadata, payload)
                : await downloadServerFile(args, {
                relativePath,
                serverFile: args.serverFile || null,
                note: args.serverNote || null,
                workspace: args.serverWorkspace || null
                }, metadata, payload);
            metadata.generatedAt = new Date().toISOString();
            await writeMetadata(storagePath, metadata);
            const resolvedMetadata = isAttachment
                ? findMetadataAttachment(metadata, relativePath, args.serverAttachmentMetadata || null)
                : findMetadataNote(metadata, relativePath, args.serverNote || null);
            const currentState = await readSyncState(storagePath);
            checkpointServerResolvedEntry(
                currentState,
                relativePath,
                payload,
                resolvedMetadata,
                isAttachment
            );
            await writeSyncState(storagePath, currentState);
            return { storageChanged: false, file, storageGeneration: appliedStorageGeneration };
        });
        if (applyResult.storageChanged) {
            return {
                ...localStorageChangedDuringSyncResult({ plan: {} }, null, false),
                resolution,
                resolvedPath: relativePath
            };
        }

        let manifest;
        try {
            manifest = await fetchFreshSyncManifest(
                serverUrl,
                token,
                previousState.serverRevision
            );
        } catch (error) {
            return {
                ok: false,
                status: 'retry',
                retryable: true,
                didApply: true,
                resolution,
                resolvedPath: relativePath,
                file: applyResult.file,
                error: syncNetworkUserMessage(error)
                    || (error instanceof Error ? error.message : '서버 버전 적용 결과를 다시 확인해야 합니다.')
            };
        }
        const wroteState = await runStorageOperation(storagePath, async () => {
            const storageUnchanged = storageMutationGeneration(storagePath) === applyResult.storageGeneration;
            const manifestEntry = serverResolutionManifestEntry(
                manifest,
                relativePath,
                isAttachment
            );
            await writeSyncStateFromManifest(storagePath, manifest, previousState, {
                ...(serverResolutionStillCurrent(payload, manifestEntry)
                    ? { clearRebaseConflictPaths: [relativePath] }
                    : { preservePaths: [relativePath], preserveMetadata: true })
            });
            return storageUnchanged;
        });
        if (!wroteState) {
            return {
                ...localStorageChangedDuringSyncResult({ plan: {} }, null, true),
                resolution,
                resolvedPath: relativePath
            };
        }
        const currentManifestEntry = serverResolutionManifestEntry(
            manifest,
            relativePath,
            isAttachment
        );
        if (!serverResolutionStillCurrent(payload, currentManifestEntry)) {
            const conflict = {
                relativePath,
                type: isAttachment ? 'attachment' : 'file',
                reason: 'server_changed_during_conflict_resolution',
                ...(isAttachment
                    ? { serverAttachment: currentManifestEntry }
                    : { serverFile: currentManifestEntry })
            };
            return {
                ok: false,
                status: 'retry',
                retryable: true,
                didApply: true,
                resolution,
                resolvedPath: relativePath,
                file: applyResult.file,
                conflicts: [conflict],
                manifest,
                summary: {
                    uploadFiles: 0,
                    downloadFiles: 0,
                    deleteServerFiles: 0,
                    deleteLocalFiles: 0,
                    conflicts: 1
                },
                error: '적용 중 서버 버전이 다시 변경되어 최신 버전을 덮어쓰지 않았습니다. 다시 확인해 주세요.'
            };
        }
        if (options.converge === false) {
            return {
                ok: true,
                status: 'ok',
                didApply: true,
                resolution,
                resolvedPath: relativePath,
                file: applyResult.file,
                manifest
            };
        }
        return convergeAppliedSyncConflict(args, {
            resolution,
            resolvedPath: relativePath,
            file: applyResult.file
        });
    }

    let lastKnownRevision = Number(args.serverRevision) || Number(args.serverFile?.revision) || Number(args.serverAttachment?.revision) || 0;
    if (!lastKnownRevision) {
        const endpoint = isAttachment ? `/api/attachments/${encodeRelativePathForUrl(relativePath)}` : `/api/files/${encodeRelativePathForUrl(relativePath)}`;
        const serverFile = await syncRequest(serverUrl, endpoint, syncDownloadOptions(token, args));
        lastKnownRevision = Number(serverFile.revision) || 0;
    }

    const localDeleted = isLocalDeleteConflict(args)
        || !(await localSyncPathExists(storagePath, relativePath, isAttachment));
    const preparedUpload = await runStorageOperation(storagePath, async () => {
        if (storageMutationGeneration(storagePath) !== initialStorageGeneration) {
            return { storageChanged: true };
        }
        const prepared = isAttachment
            ? await prepareLocalAttachmentUpload({ ...args, deleted: localDeleted, lastKnownRevision }, {
                relativePath,
                deleted: localDeleted,
                attachment: args.clientAttachment || args.attachment || null,
                noteRelativePath: args.noteRelativePath || args.clientAttachment?.noteRelativePath || null
            })
            : await prepareLocalFileUpload({ ...args, deleted: localDeleted, lastKnownRevision }, relativePath);
        return { storageChanged: false, prepared };
    });
    if (preparedUpload.storageChanged) {
        return {
            ...localStorageChangedDuringSyncResult({ plan: {} }, null, false),
            resolution,
            resolvedPath: relativePath
        };
    }
    const uploadResult = await sendPreparedSyncUpload(
        preparedUpload.prepared,
        isAttachment ? '/api/sync/attachment' : '/api/sync/file',
        false
    );
    const appliedResponse = await runStorageOperation(storagePath, async () => {
        const storageUnchanged = storageMutationGeneration(storagePath) === initialStorageGeneration;
        if (uploadResult.manifest) {
            await writeSyncStateFromManifest(
                storagePath,
                uploadResult.manifest,
                preparedUpload.prepared.syncState,
                uploadResult.status === 'conflict'
                    ? syncConflictCheckpointOptions(uploadResult, relativePath)
                    : preparedUploadCheckpointOptions(
                        preparedUpload.prepared,
                        isAttachment ? '/api/sync/attachment' : '/api/sync/file'
                    )
            );
        }
        return storageUnchanged;
    });
    if (!appliedResponse) {
        return {
            ...localStorageChangedDuringSyncResult({ plan: {} }, null, true),
            resolution,
            resolvedPath: relativePath
        };
    }
    if (uploadResult.status === 'conflict') {
        const conflict = uploadResult.file || uploadResult.attachment;
        const decoratedConflict = localDeleted
            ? markLocalDeleteConflict(conflict || { relativePath }, isAttachment ? 'attachment' : 'file')
            : conflict;
        if (isAttachment) uploadResult.attachment = decoratedConflict;
        else uploadResult.file = decoratedConflict;
        return {
            ok: false,
            status: 'conflict',
            didApply: false,
            resolution,
            resolvedPath: relativePath,
            conflicts: [decoratedConflict].filter(Boolean),
            summary: { uploadFiles: 0, downloadFiles: 0, deleteServerFiles: 0, deleteLocalFiles: 0, conflicts: 1 },
            ...uploadResult
        };
    }

    if (options.converge === false) {
        return {
            ok: true,
            status: 'ok',
            didApply: true,
            resolution,
            resolvedPath: relativePath,
            file: uploadResult.file || uploadResult.attachment,
            upload: uploadResult,
            manifest: uploadResult.manifest
        };
    }
    return convergeAppliedSyncConflict(args, {
        resolution,
        resolvedPath: relativePath,
        file: uploadResult.file || uploadResult.attachment,
        upload: uploadResult
    });
}

function syncBatchConflictItems(batch, convergence) {
    const items = [
        ...(Array.isArray(convergence?.conflicts) ? convergence.conflicts : []),
        ...(Array.isArray(convergence?.plan?.conflicts) ? convergence.plan.conflicts : []),
        ...batch.resolved.flatMap(({ result }) => (
            Array.isArray(result?.conflicts) ? result.conflicts : []
        )),
        ...batch.failed.flatMap(failure => (
            Array.isArray(failure.result?.conflicts)
                ? failure.result.conflicts
                : [failure.item]
        )),
        ...batch.skipped
    ];
    const unique = new Map();
    for (const item of nonSystemPlanItems(items)) {
        const relativePath = planItemRelativePath(item);
        if (!relativePath) continue;
        const type = item.type
            || (String(relativePath).includes('/.attachments/') ? 'attachment' : 'file');
        const key = `${type}:${normalizeRelativePath(relativePath)}`;
        unique.set(key, item);
    }
    return [...unique.values()];
}

async function resolveSyncConflicts(args = {}) {
    const resolution = String(args.resolution || '').trim();
    if (!['server', 'local'].includes(resolution)) {
        throw new Error('일괄 적용할 충돌 버전을 선택하세요.');
    }
    const syncRecovery = await rebaseSyncStateIfServerReset(args);
    if (syncRecovery.rebased) {
        return {
            ...localStorageChangedDuringSyncResult({ plan: { conflicts: args.conflicts || [] } }, null, false),
            conflicts: nonSystemPlanItems(args.conflicts || []),
            syncRecovery
        };
    }
    const batchItems = [...(Array.isArray(args.conflicts) ? args.conflicts : [])];
    if (resolution === 'local') {
        batchItems.sort((left, right) => {
            const leftAttachment = left?.type === 'attachment'
                || String(left?.relativePath || '').includes('/.attachments/');
            const rightAttachment = right?.type === 'attachment'
                || String(right?.relativePath || '').includes('/.attachments/');
            return Number(rightAttachment) - Number(leftAttachment);
        });
    }
    const batch = await runSyncConflictBatch({
        items: batchItems,
        resolve: item => resolveSyncConflict(
            { ...args, ...item, resolution },
            { converge: false, rebase: false }
        ),
        shouldStop: (result, error) => (
            Boolean(syncNetworkErrorKind(error))
            || result?.status === 'retry'
        ),
        converge: () => convergeSyncAfterResolution(args)
    });
    const convergence = batch.convergence;
    const conflicts = syncBatchConflictItems(batch, convergence);
    const resolved = batch.resolved.map(({ item, result }) => ({
        relativePath: item.relativePath,
        type: item.type || '',
        resolution,
        status: result?.status || 'ok'
    }));
    const failed = batch.failed.map(({ item, result, error }) => ({
        relativePath: item.relativePath,
        type: item.type || '',
        status: result?.status || 'error',
        error: result?.error
            || syncNetworkUserMessage(error)
            || (error instanceof Error ? error.message : '충돌을 적용하지 못했습니다.')
    }));
    const skipped = batch.skipped.map(item => ({
        relativePath: item.relativePath,
        type: item.type || '',
        error: '연결 또는 로컬 상태가 안정되지 않아 이번 일괄 적용에서 건너뛰었습니다.'
    }));
    const convergenceError = batch.convergenceError;
    const retryable = batch.stopped
        || Boolean(convergenceError)
        || convergence?.status === 'retry';
    const partial = resolved.length > 0 && (failed.length > 0 || skipped.length > 0 || retryable);
    const status = retryable
        ? (partial ? 'partial' : 'retry')
        : conflicts.length > 0
            ? (resolved.length > 0 ? 'partial' : 'conflict')
            : failed.length > 0
                ? (resolved.length > 0 ? 'partial' : 'error')
                : 'ok';
    return {
        ...(convergence || {}),
        ok: status === 'ok',
        status,
        didApply: resolved.length > 0,
        retryable,
        resolution,
        resolved,
        failed,
        skipped,
        conflicts,
        error: convergenceError
            ? syncNetworkUserMessage(convergenceError)
                || (convergenceError instanceof Error
                    ? convergenceError.message
                    : '일괄 적용 결과를 다시 확인해야 합니다.')
            : retryable
                ? '연결 또는 로컬 상태가 변경되어 남은 충돌은 적용하지 않았습니다.'
                : '',
        summary: {
            ...(convergence?.summary || summarizePlan(convergence?.plan || {})),
            conflicts: conflicts.length,
            resolved: resolved.length,
            failed: failed.length,
            skipped: skipped.length
        }
    };
}

function localStorageChangedDuringSyncResult(planResponse, operations = null, didApply = false) {
    const reason = 'local_storage_changed_during_sync';
    const message = '동기화 중 로컬 저장소가 변경되어 최신 상태로 다시 확인해야 합니다.';
    const plan = filterSyncPlan(planResponse.plan || {});
    return {
        ...planResponse,
        ok: false,
        status: 'retry',
        retryable: true,
        didApply,
        reason,
        error: message,
        conflicts: [],
        plan,
        summary: summarizePlan(plan),
        ...(operations ? { operations } : {})
    };
}

function syncOperationsDidApply(operations = {}) {
    return [
        'uploaded',
        'downloaded',
        'deletedServer',
        'deletedLocal',
        'uploadedAttachments',
        'downloadedAttachments',
        'deletedServerAttachments',
        'deletedLocalAttachments'
    ].some(key => Array.isArray(operations[key]) && operations[key].length > 0);
}

function syncPlanOperationCount(plan = {}) {
    return [
        'uploadFiles',
        'downloadFiles',
        'deleteServerFiles',
        'deleteLocalFiles',
        'uploadAttachments',
        'downloadAttachments',
        'deleteServerAttachments',
        'deleteLocalAttachments'
    ].reduce((total, key) => total + nonSystemPlanItems(plan[key]).length, 0);
}

async function convergeSyncAfterResolution(args = {}) {
    const planResponse = await createSyncPlan(args);
    const plan = planResponse.plan || {};
    if ((plan.conflicts || []).length > 0 || syncPlanOperationCount(plan) === 0) {
        return planResponse;
    }
    return runFullSync(args);
}

async function runFullSync(args = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const initialStorageGeneration = await runStorageOperation(
        storagePath,
        () => storageMutationGeneration(storagePath)
    );
    const planResponse = await createSyncPlan(args);
    const syncState = await readSyncState(storagePath);
    const plan = planResponse.plan || {};

    if ((plan.conflicts || []).length > 0) {
        return {
            ...planResponse,
            ok: false,
            status: 'conflict',
            didApply: false
        };
    }

    const operations = {
        uploaded: [],
        downloaded: [],
        deletedServer: [],
        deletedLocal: [],
        uploadedAttachments: [],
        downloadedAttachments: [],
        deletedServerAttachments: [],
        deletedLocalAttachments: [],
        conflicts: []
    };
    let latestManifest = planResponse.manifest;

    try {
    const pendingFileDownloads = [];
    for (const item of plan.downloadFiles || []) {
        const relativePath = normalizeRelativePath(item.relativePath);
        const payload = await syncRequest(
            serverUrl,
            `/api/files/${encodeRelativePathForUrl(relativePath)}`,
            syncDownloadOptions(token, item)
        );
        pendingFileDownloads.push({ item, payload });
    }

    const pendingAttachmentDownloads = [];
    for (const item of plan.downloadAttachments || []) {
        const relativePath = normalizeRelativePath(item.relativePath);
        const payload = await syncRequest(
            serverUrl,
            `/api/attachments/${encodeRelativePathForUrl(relativePath)}`,
            syncDownloadOptions(token, item)
        );
        pendingAttachmentDownloads.push({ item, payload });
    }

    const localApply = await runStorageOperation(storagePath, async () => {
        if (storageMutationGeneration(storagePath) !== initialStorageGeneration) {
            return { storageChanged: true };
        }

        const metadata = await ensureMetadata(storagePath);
        validateMetadataStorageIdentities(metadata);
        let metadataChanged = false;
        const hasLocalMutations = pendingFileDownloads.length > 0
            || pendingAttachmentDownloads.length > 0
            || (plan.deleteLocalFiles || []).length > 0
            || (plan.deleteLocalAttachments || []).length > 0;
        const appliedStorageGeneration = hasLocalMutations
            ? bumpStorageMutationGeneration(storagePath)
            : initialStorageGeneration;
        for (const pending of pendingFileDownloads) {
            operations.downloaded.push(
                await downloadServerFile(args, pending.item, metadata, pending.payload)
            );
            metadataChanged = true;
        }
        for (const pending of pendingAttachmentDownloads) {
            operations.downloadedAttachments.push(
                await downloadServerAttachment(args, pending.item, metadata, pending.payload)
            );
            metadataChanged = true;
        }
        for (const item of plan.deleteLocalAttachments || []) {
            operations.deletedLocalAttachments.push(await deleteLocalAttachment(storagePath, item, metadata));
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
        return { storageChanged: false, storageGeneration: appliedStorageGeneration };
    });

    if (localApply.storageChanged) {
        return localStorageChangedDuringSyncResult(planResponse, operations, false);
    }

    const expectedStorageGeneration = localApply.storageGeneration;
    if (latestManifest) {
        const checkpointed = await runStorageOperation(storagePath, async () => {
            const storageUnchanged = storageMutationGeneration(storagePath) === expectedStorageGeneration;
            const previousState = await readSyncState(storagePath);
            await writeSyncStateFromManifest(storagePath, latestManifest, previousState, {
                acceptPaths: [
                    ...pendingFileDownloads.map(({ item }) => planItemRelativePath(item)),
                    ...pendingAttachmentDownloads.map(({ item }) => planItemRelativePath(item)),
                    ...(plan.deleteLocalFiles || []).map(item => planItemRelativePath(item)),
                    ...(plan.deleteLocalAttachments || []).map(item => planItemRelativePath(item))
                ].filter(Boolean)
            });
            return storageUnchanged;
        });
        if (!checkpointed) {
            return localStorageChangedDuringSyncResult(
                planResponse,
                operations,
                syncOperationsDidApply(operations)
            );
        }
    }
    const storageChanged = () => runStorageOperation(
        storagePath,
        () => storageMutationGeneration(storagePath) !== expectedStorageGeneration
    );
    const changedResult = () => localStorageChangedDuringSyncResult(
        planResponse,
        operations,
        syncOperationsDidApply(operations)
    );
    const conflictCheckpointPaths = new Set();
    const guardedUpload = async (prepare, endpoint) => {
        const staged = await runStorageOperation(storagePath, async () => {
            if (storageMutationGeneration(storagePath) !== expectedStorageGeneration) {
                return { storageChanged: true };
            }
            return { storageChanged: false, prepared: await prepare() };
        });
        if (staged.storageChanged) return staged;
        const result = await sendPreparedSyncUpload(staged.prepared, endpoint, false);
        if (result.status === 'conflict') {
            const options = syncConflictCheckpointOptions(result, staged.prepared.body.relativePath);
            for (const relativePath of options.preservePaths || []) {
                conflictCheckpointPaths.add(relativePath);
            }
        }
        const stateApplied = await runStorageOperation(storagePath, async () => {
            const storageUnchanged = storageMutationGeneration(storagePath) === expectedStorageGeneration;
            if (result.manifest) {
                await writeSyncStateFromManifest(
                    storagePath,
                    result.manifest,
                    staged.prepared.syncState,
                    conflictCheckpointPaths.size > 0
                        ? {
                            preservePaths: [...conflictCheckpointPaths],
                            preserveMetadata: true,
                            ...(result.status === 'conflict'
                                ? {}
                                : preparedUploadCheckpointOptions(staged.prepared, endpoint))
                        }
                        : (
                            result.status === 'conflict'
                                ? {}
                                : preparedUploadCheckpointOptions(staged.prepared, endpoint)
                        )
                );
            }
            return storageUnchanged;
        });
        return stateApplied ? { storageChanged: false, result } : { storageChanged: true, result };
    };

    for (const item of plan.uploadFiles || []) {
        const upload = await guardedUpload(
            () => prepareLocalFileUpload(args, item.relativePath),
            '/api/sync/file'
        );
        if (upload.storageChanged) return changedResult();
        const result = upload.result;
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.file);
        } else {
            operations.uploaded.push(result.file);
        }
    }

    for (const item of plan.uploadAttachments || []) {
        const upload = await guardedUpload(
            () => prepareLocalAttachmentUpload(args, item),
            '/api/sync/attachment'
        );
        if (upload.storageChanged) return changedResult();
        const result = upload.result;
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.attachment || result.file);
        } else {
            operations.uploadedAttachments.push(result.attachment);
        }
    }

    for (const item of plan.deleteServerAttachments || []) {
        if (await storageChanged()) return changedResult();
        const lastKnownRevision = serverDeleteLastKnownRevision(syncState, item, true);
        if (lastKnownRevision <= 0) continue;
        const upload = await guardedUpload(
            () => prepareLocalAttachmentUpload({ ...args, deleted: true, lastKnownRevision }, item),
            '/api/sync/attachment'
        );
        if (upload.storageChanged) return changedResult();
        const result = upload.result;
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(markLocalDeleteConflict(
                result.attachment || result.file || { relativePath: item.relativePath },
                'attachment'
            ));
        } else {
            operations.deletedServerAttachments.push(result.attachment);
        }
    }

    for (const item of plan.deleteServerFiles || []) {
        if (await storageChanged()) return changedResult();
        const lastKnownRevision = serverDeleteLastKnownRevision(syncState, item, false);
        if (lastKnownRevision <= 0) continue;
        const upload = await guardedUpload(
            () => prepareLocalFileUpload({ ...args, deleted: true, lastKnownRevision }, item.relativePath),
            '/api/sync/file'
        );
        if (upload.storageChanged) return changedResult();
        const result = upload.result;
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(markLocalDeleteConflict(
                result.file || { relativePath: item.relativePath },
                'file'
            ));
        } else {
            operations.deletedServer.push(result.file);
        }
    }

    if (operations.conflicts.length === 0 && latestManifest) {
        const wroteState = await runStorageOperation(storagePath, async () => {
            const storageUnchanged = storageMutationGeneration(storagePath) === expectedStorageGeneration;
            const previousState = await readSyncState(storagePath);
            await writeSyncStateFromManifest(storagePath, latestManifest, previousState);
            return storageUnchanged;
        });
        if (!wroteState) return changedResult();
    }

    return {
        ...planResponse,
        ok: operations.conflicts.length === 0,
        status: operations.conflicts.length > 0 ? 'conflict' : 'ok',
        didApply: true,
        manifest: latestManifest || planResponse.manifest,
        operations
    };
    } catch (error) {
        return {
            ...planResponse,
            ok: false,
            status: 'error',
            didApply: syncOperationsDidApply(operations),
            error: error instanceof Error
                ? error.message
                : '전체 동기화 작업 중 오류가 발생했습니다.',
            manifest: latestManifest || planResponse.manifest,
            operations
        };
    }
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
        const storagePath = rememberStoragePath(args.storagePath);
        await fs.mkdir(storagePath, { recursive: true });
        const metadata = await readMetadata(storagePath);
        const shallowMarkdownFiles = await listMarkdownFiles(storagePath, 1, storagePath);
        const allMarkdownFiles = await listMarkdownFiles(storagePath, 20, storagePath);
        const deepMarkdownCount = allMarkdownFiles.filter(relativePath => relativePath.split(path.sep).length > 2).length;

        return {
            ok: true,
            storagePath,
            metadataPath: metadataDbPath(storagePath),
            metadataExists: Boolean(metadata),
            notes: metadata?.notes?.length || 0,
            workspaces: metadata?.workspaces?.length || 0,
            shallowMarkdownCount: shallowMarkdownFiles.length,
            deepMarkdownCount
        };
    });

    ipcMain.handle('notedown:storage:initialize', async (_event, args = {}) => {
        const storagePath = rememberStoragePath(args.storagePath);
        return runStorageMutation(storagePath, () => generateMetadata(
            storagePath,
            { importDeepMarkdown: Boolean(args.importDeepMarkdown) }
        ));
    });

    ipcMain.handle('notedown:storage:load-notes', async (_event, args = {}) => {
        const storagePath = rememberStoragePath(args.storagePath);
        return runStorageOperation(storagePath, async () => {
            let metadata = await readMetadata(storagePath);
            if (!metadata) {
                const generated = await generateMetadata(storagePath, { importDeepMarkdown: false });
                metadata = generated.metadata;
            }
            const notes = await Promise.all((metadata.notes || []).map(note => readMarkdownNote(storagePath, note)));
            return { ok: true, notes, metadata };
        });
    });

    ipcMain.handle('notedown:storage:save-notes', async (_event, args = {}) => {
        const storagePath = rememberStoragePath(args.storagePath);
        return runStorageMutation(storagePath, () => saveNotesToStorage(
            storagePath,
            args.notes || [],
            {
                deletedNoteIds: args.deletedNoteIds || [],
                deletedAttachmentIds: args.deletedAttachmentIds || []
            }
        ));
    });

    ipcMain.handle('notedown:storage:export-folder-zip', async (event, args = {}) => {
        try {
            return await exportFolderZip(event, args);
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : '폴더 ZIP 내보내기에 실패했습니다.'
            };
        }
    });

    ipcMain.handle('notedown:storage:save-attachment', async (_event, args = {}) => {
        try {
            const storagePath = rememberStoragePath(args.storagePath);
            return await runStorageMutation(storagePath, () => saveAttachmentToStorage(args));
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : '첨부 파일을 저장하지 못했습니다.'
            };
        }
    });

    ipcMain.handle('notedown:storage:choose-attachments', async (event, args = {}) => {
        try {
            const storagePath = rememberStoragePath(args.storagePath);
            return await runStorageMutation(storagePath, () => chooseAttachmentsForStorage(event, args));
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : '첨부 파일을 선택하지 못했습니다.'
            };
        }
    });

    ipcMain.handle('notedown:storage:open-attachment', async (_event, args = {}) => {
        try {
            return await openAttachmentFromStorage(args);
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : '첨부 파일을 열지 못했습니다.'
            };
        }
    });
}

function registerSyncHandlers() {
    ipcMain.handle('notedown:sync:health', async (_event, args = {}) => {
        try {
            return { ok: true, ...(await syncRequest(args.serverUrl, '/api/health')) };
        } catch (error) {
            return syncError(error, '동기화 서버에 연결하지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:setup-status', async (_event, args = {}) => {
        try {
            return { ok: true, ...(await syncRequest(args.serverUrl, '/api/setup/status')) };
        } catch (error) {
            return syncError(error, '동기화 서버 설정 상태를 확인하지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:setup', async (_event, args = {}) => {
        try {
            const data = await syncRequest(args.serverUrl, '/api/setup', {
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
            const data = await syncRequest(args.serverUrl, '/api/login', {
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
            return await runSyncOperation(args, () => createSyncPlan(args));
        } catch (error) {
            return syncError(error, '동기화 계획을 만들지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:run-full', async (_event, args = {}) => {
        try {
            return await runSyncOperation(
                args,
                () => retryStorageChangedSync(() => runFullSync(args))
            );
        } catch (error) {
            return syncError(error, '전체 동기화에 실패했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:upload-note', async (_event, args = {}) => {
        try {
            return await runSyncOperation(
                args,
                () => retryStorageChangedSync(() => uploadLocalNoteWithAttachments(args))
            );
        } catch (error) {
            return syncError(error, '문서 동기화에 실패했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:read-file', async (_event, args = {}) => {
        try {
            return await runSyncOperation(args, () => readSyncConflictFile(args));
        } catch (error) {
            return syncError(error, '충돌 파일을 읽지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:resolve-conflict', async (_event, args = {}) => {
        try {
            return await runSyncOperation(
                args,
                () => retryStorageChangedSync(() => resolveSyncConflict(args))
            );
        } catch (error) {
            return syncError(error, '충돌을 적용하지 못했습니다.');
        }
    });

    ipcMain.handle('notedown:sync:resolve-conflicts', async (_event, args = {}) => {
        try {
            return await runSyncOperation(args, () => resolveSyncConflicts(args));
        } catch (error) {
            return syncError(error, '선택한 충돌을 일괄 적용하지 못했습니다.');
        }
    });
}

async function renderPdfBuffer(html) {
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
        return await pdfWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            preferCSSPageSize: true,
            margins: { marginType: 'none' }
        });
    } finally {
        if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    }
}

function normalizePdfExportAttachments(attachments = []) {
    if (!Array.isArray(attachments)) return [];
    const normalized = [];
    for (const attachment of attachments) {
        try {
            const relativePath = normalizeRelativePath(attachment?.relativePath || '');
            normalized.push({
                fileName: safeAttachmentFileName(attachment?.fileName || path.posix.basename(relativePath)),
                relativePath,
                storagePath: attachment?.storagePath ? normalizeRelativePath(attachment.storagePath) : relativePath,
                mimeType: attachment?.mimeType || mimeTypeForFileName(relativePath),
                size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : null
            });
        } catch (error) {
            // Ignore invalid attachment paths in export payloads.
        }
    }
    return normalized;
}

async function pdfAttachmentZipEntries(storagePath, attachments = [], usedNames = new Set()) {
    const entries = [];
    const skippedAttachments = [];

    for (const attachment of normalizePdfExportAttachments(attachments)) {
        try {
            const { absolutePath } = resolveStorageFile(storagePath, attachment.storagePath || attachment.relativePath);
            const data = await fs.readFile(absolutePath);
            entries.push({
                name: uniqueZipEntryName(usedNames, path.posix.join('attachments', attachment.fileName || path.posix.basename(attachment.storagePath || attachment.relativePath))),
                data,
                date: attachment.updatedAtMs ? new Date(Number(attachment.updatedAtMs)) : new Date()
            });
        } catch (error) {
            skippedAttachments.push({
                relativePath: attachment.relativePath,
                fileName: attachment.fileName,
                error: error instanceof Error ? error.message : '첨부 파일을 읽지 못했습니다.'
            });
        }
    }

    return { entries, skippedAttachments };
}

function folderExportEntryName(rootName, folderId, relativePath) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    const parts = safeRelativePath.split('/');
    const innerPath = parts[0] === folderId ? parts.slice(1).join('/') : safeRelativePath;
    return path.posix.join(rootName, innerPath || path.posix.basename(safeRelativePath));
}

async function folderExportNotes(storagePath, args = {}) {
    if (Array.isArray(args.notes) && args.notes.length > 0) return args.notes;

    let metadata = await readMetadata(storagePath);
    if (!metadata) {
        const generated = await generateMetadata(storagePath, { importDeepMarkdown: false });
        metadata = generated.metadata;
    }
    return Promise.all((metadata.notes || []).map(note => readMarkdownNote(storagePath, note)));
}

async function folderZipEntries(storagePath, args = {}) {
    const folderId = String(args.folderId || '').trim();
    if (!folderId || folderId === 'all') throw new Error('내보낼 폴더가 올바르지 않습니다.');

    const folderLabel = String(args.folderLabel || folderId).trim() || folderId;
    const rootName = zipEntryName(folderLabel, 'folder');
    const notes = (await folderExportNotes(storagePath, args))
        .filter(note => noteWorkspaceId(note) === folderId);
    const usedNames = new Set();
    const entries = [];
    const skipped = [];

    for (const note of notes) {
        const relativePath = relativePathForNote(note);
        const storageRelativePath = noteStoragePath(note, relativePath);
        try {
            let data;
            try {
                data = await fs.readFile(resolveStorageFile(storagePath, storageRelativePath).absolutePath);
            } catch (error) {
                data = Buffer.from(note.body || '', 'utf8');
            }
            entries.push({
                name: uniqueZipEntryName(usedNames, folderExportEntryName(rootName, folderId, storageRelativePath)),
                data,
                date: note.updatedAtMs ? new Date(Number(note.updatedAtMs)) : new Date()
            });
        } catch (error) {
            skipped.push({
                relativePath,
                error: error instanceof Error ? error.message : '노트 파일을 읽지 못했습니다.'
            });
        }

        for (const attachment of noteAttachmentsForMetadata(note, relativePath)) {
            try {
                const attachmentStoragePath = attachment.storagePath || attachment.relativePath;
                const { absolutePath } = resolveStorageFile(storagePath, attachmentStoragePath);
                entries.push({
                    name: uniqueZipEntryName(usedNames, folderExportEntryName(rootName, folderId, attachmentStoragePath)),
                    data: await fs.readFile(absolutePath),
                    date: attachment.updatedAtMs ? new Date(Number(attachment.updatedAtMs)) : new Date()
                });
            } catch (error) {
                skipped.push({
                    relativePath: attachment.relativePath,
                    error: error instanceof Error ? error.message : '첨부 파일을 읽지 못했습니다.'
                });
            }
        }
    }

    return { entries, skipped, noteCount: notes.length };
}

async function exportFolderZip(event, args = {}) {
    const storagePath = rememberStoragePath(args.storagePath);
    const folderLabel = String(args.folderLabel || args.folderId || 'folder').trim() || 'folder';
    const { entries, skipped, noteCount } = await folderZipEntries(storagePath, args);
    if (entries.length === 0) return { ok: false, error: '내보낼 노트나 첨부 파일이 없습니다.' };

    const parent = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showSaveDialog(parent, {
        title: '폴더를 ZIP으로 내보내기',
        defaultPath: path.join(app.getPath('documents'), safeExportFileName(folderLabel, 'zip')),
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const targetPath = result.filePath.toLowerCase().endsWith('.zip')
        ? result.filePath
        : `${result.filePath}.zip`;
    const zipBuffer = await createZipBuffer(entries);
    await fs.writeFile(targetPath, zipBuffer);
    return {
        ok: true,
        filePath: targetPath,
        bytes: zipBuffer.length,
        files: entries.length,
        notes: noteCount,
        skipped
    };
}

async function saveNotePdf(args = {}) {
    const title = String(args.title || '제목 없음');
    const html = String(args.html || '');
    const exportMode = args.exportMode === 'zip-with-attachments' ? 'zip-with-attachments' : 'markdown-images';
    const zipExport = exportMode === 'zip-with-attachments';
    const parent = BrowserWindow.getFocusedWindow() || undefined;
    const extension = zipExport ? 'zip' : 'pdf';
    const result = await dialog.showSaveDialog(parent, {
        title: zipExport ? 'PDF와 첨부를 ZIP으로 저장' : 'PDF로 저장',
        defaultPath: path.join(app.getPath('documents'), safeExportFileName(title, extension)),
        filters: [zipExport ? { name: 'ZIP', extensions: ['zip'] } : { name: 'PDF', extensions: ['pdf'] }]
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const targetPath = result.filePath.toLowerCase().endsWith(`.${extension}`)
        ? result.filePath
        : `${result.filePath}.${extension}`;

    try {
        const pdfBuffer = await renderPdfBuffer(html);
        if (!zipExport) {
            await fs.writeFile(targetPath, pdfBuffer);
            return { ok: true, filePath: targetPath, bytes: pdfBuffer.length };
        }

        const usedNames = new Set();
        const pdfName = uniqueZipEntryName(usedNames, safeExportFileName(title, 'pdf'));
        const storagePath = normalizeStoragePath(args.storagePath);
        const { entries: attachmentEntries, skippedAttachments } = await pdfAttachmentZipEntries(storagePath, args.attachments, usedNames);
        const zipBuffer = await createZipBuffer([
            { name: pdfName, data: pdfBuffer, date: new Date() },
            ...attachmentEntries
        ]);
        await fs.writeFile(targetPath, zipBuffer);
        return {
            ok: true,
            filePath: targetPath,
            bytes: zipBuffer.length,
            attachments: attachmentEntries.length,
            skippedAttachments
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : (zipExport ? 'ZIP 저장에 실패했습니다.' : 'PDF 저장에 실패했습니다.')
        };
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
        { label: 'Notedown 열기', click: () => { void showMainWindow({ anchorPoint: screen.getCursorScreenPoint() }); } },
        { type: 'separator' },
        { label: '종료', click: quitApplication }
    ]);
}

function isScreenPoint(point) {
    return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function trayClickPoint(bounds, position) {
    if (isScreenPoint(position)) return position;
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
        return {
            x: Math.round(bounds.x + (bounds.width || 0) / 2),
            y: Math.round(bounds.y + (bounds.height || 0) / 2)
        };
    }
    return screen.getCursorScreenPoint();
}

function targetDisplayForPoint(point) {
    return screen.getDisplayNearestPoint(isScreenPoint(point) ? point : screen.getCursorScreenPoint());
}

function centeredBoundsForDisplay(win, display) {
    const bounds = win.getBounds();
    const [minWidth, minHeight] = win.getMinimumSize();
    const workArea = display.workArea;
    const width = Math.min(Math.max(bounds.width || 1400, minWidth || 0), workArea.width);
    const height = Math.min(Math.max(bounds.height || 920, minHeight || 0), workArea.height);

    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height
    };
}

function moveWindowToTargetDisplay(win, anchorPoint) {
    const display = targetDisplayForPoint(anchorPoint);
    win.setBounds(centeredBoundsForDisplay(win, display), false);
}

function revealWindowOnCurrentMacWorkspace(win) {
    if (process.platform !== 'darwin') return;

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (currentWorkspaceRevealTimer) clearTimeout(currentWorkspaceRevealTimer);
    currentWorkspaceRevealTimer = setTimeout(() => {
        currentWorkspaceRevealTimer = null;
        if (!win.isDestroyed()) win.setVisibleOnAllWorkspaces(false);
    }, 250);
}

function ensureTray() {
    if (tray) return tray;

    tray = new Tray(trayIcon());
    tray.setToolTip(APP_NAME);
    tray.on('right-click', () => tray?.popUpContextMenu(trayMenu()));
    if (process.platform === 'darwin') {
        tray.on('click', (_event, bounds, position) => {
            void showMainWindow({ anchorPoint: trayClickPoint(bounds, position) });
        });
    } else {
        tray.on('double-click', (_event, bounds, position) => {
            void showMainWindow({ anchorPoint: trayClickPoint(bounds, position) });
        });
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

async function showMainWindow(options = {}) {
    if (process.platform === 'darwin' && app.dock) await app.dock.show();

    const hadWindow = mainWindow && !mainWindow.isDestroyed();
    const win = hadWindow
        ? mainWindow
        : await createWindow();

    if (!hadWindow || !win.isVisible() || win.isMinimized()) {
        moveWindowToTargetDisplay(win, options.anchorPoint);
    }
    revealWindowOnCurrentMacWorkspace(win);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    if (typeof win.moveTop === 'function') win.moveTop();
}

function updateShareUrl() {
    return process.env.NOTEDOWN_UPDATE_SHARE_URL || DEFAULT_UPDATE_SHARE_URL;
}

function updateDownloadDirectory() {
    return path.join(app.getPath('temp'), 'Notedown Updates');
}

function currentUpdateInfo() {
    return {
        ok: true,
        currentVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        supported: Boolean(supportedArtifact(process.platform, process.arch)),
        shareUrl: updateShareUrl()
    };
}

function createAppUpdater() {
    return createUpdater({
        fetch: (url, options) => net.fetch(url, options),
        currentVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        shareUrl: updateShareUrl(),
        downloadDirectory: updateDownloadDirectory()
    });
}

function sendUpdateStatus(webContents, status) {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send('notedown:update:status', status);
}

function updateErrorMessage(error, fallback = '업데이트 작업에 실패했습니다.') {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/User canceled|User cancelled|-128/i.test(message)) return '업데이트 설치가 취소되었습니다.';
    if (/aborted|timed?\s*out|timeout/i.test(message)) return '업데이트 서버 응답 시간이 초과되었습니다.';
    return message || fallback;
}

function appleScriptString(value) {
    return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function relaunchArgs() {
    return process.argv.slice(1).filter(arg => arg !== START_HIDDEN_ARG && arg !== QUIT_ARG);
}

async function installMacUpdate(installerPath, webContents, version) {
    const script = `do shell script "/usr/sbin/installer -pkg " & quoted form of ${appleScriptString(installerPath)} & " -target /" with administrator privileges`;
    await execFileAsync('/usr/bin/osascript', ['-e', script], {
        timeout: 15 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
    });
    sendUpdateStatus(webContents, { stage: 'restarting', version, message: '설치가 완료되어 앱을 다시 엽니다.' });
    isQuitting = true;
    app.relaunch({
        execPath: '/Applications/Notedown.app/Contents/MacOS/Notedown',
        args: relaunchArgs()
    });
    setTimeout(() => app.exit(0), 250);
    return { ok: true, restarting: true, version };
}

async function installWindowsUpdate(installerPath, webContents, version) {
    const child = spawn(installerPath, ['/S', '--updated', '--force-run'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
    sendUpdateStatus(webContents, { stage: 'restarting', version, message: '설치를 시작했습니다. 앱이 곧 다시 열립니다.' });
    isQuitting = true;
    setTimeout(() => app.quit(), 250);
    return { ok: true, restarting: true, version };
}

async function downloadAndInstallUpdate(webContents) {
    if (updateOperation) return { ok: false, error: '이미 업데이트 작업을 진행 중입니다.' };
    if (!app.isPackaged) return { ok: false, error: '개발 실행 중에는 업데이트를 설치할 수 없습니다.' };

    updateOperation = (async () => {
        const updater = createAppUpdater();
        sendUpdateStatus(webContents, { stage: 'checking', message: '새 버전을 확인하는 중입니다.' });
        const release = await updater.check();
        if (!release.updateAvailable) {
            return {
                ...release,
                ok: true,
                error: release.error || '현재 최신 버전을 사용하고 있습니다.'
            };
        }

        sendUpdateStatus(webContents, {
            stage: 'downloading',
            version: release.version,
            percent: 0,
            message: `Notedown ${release.version} 다운로드를 시작합니다.`
        });
        const installerPath = await updater.download(release, status => {
            sendUpdateStatus(webContents, { ...status, version: release.version });
        });
        sendUpdateStatus(webContents, {
            stage: 'installing',
            version: release.version,
            percent: 100,
            message: '다운로드를 확인했습니다. 업데이트를 설치하는 중입니다.'
        });

        if (process.platform === 'darwin') {
            return installMacUpdate(installerPath, webContents, release.version);
        }
        if (process.platform === 'win32') {
            return installWindowsUpdate(installerPath, webContents, release.version);
        }
        throw new Error('현재 운영체제에서는 앱 내 설치를 지원하지 않습니다.');
    })();

    try {
        return await updateOperation;
    } catch (error) {
        const message = updateErrorMessage(error);
        sendUpdateStatus(webContents, { stage: 'error', message });
        return { ok: false, error: message };
    } finally {
        updateOperation = null;
    }
}

function registerAppHandlers() {
    ipcMain.handle('notedown:app:installer-settings', async () => {
        const settings = await readInstallerSettings();
        if (!settings) return { ok: true, settings: null };
        await writeAppPreferences({
            keepInBackgroundOnClose: settings.keepInBackgroundOnClose,
            launchAtStartup: settings.launchAtStartup
        });
        return { ok: true, settings };
    });
    ipcMain.handle('notedown:app:preferences', async () => ({ ok: true, ...appPreferences, ...launchAtStartupState() }));
    ipcMain.handle('notedown:app:set-preferences', async (_event, args = {}) => {
        const nextPreferences = await writeAppPreferences(args);
        return { ok: true, ...nextPreferences };
    });
    ipcMain.handle('notedown:app:show-window', async () => {
        await showMainWindow();
        return { ok: true };
    });
}

function registerUpdateHandlers() {
    ipcMain.handle('notedown:update:current', async () => currentUpdateInfo());
    ipcMain.handle('notedown:update:check', async () => {
        try {
            return await createAppUpdater().check();
        } catch (error) {
            return { ...currentUpdateInfo(), ok: false, error: updateErrorMessage(error, '업데이트를 확인하지 못했습니다.') };
        }
    });
    ipcMain.handle('notedown:update:download-and-install', async (event) => downloadAndInstallUpdate(event.sender));
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
    },
    {
        scheme: 'notedown-attachment',
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

async function registerAttachmentProtocol() {
    if (attachmentProtocolRegistered) return;

    protocol.handle('notedown-attachment', async (request) => {
        try {
            const requestUrl = new URL(request.url);
            const rawStoragePath = requestUrl.searchParams.get('storagePath') || '';
            const rawRelativePath = requestUrl.searchParams.get('relativePath') || '';
            if (!rawStoragePath || !rawRelativePath) {
                return new Response('첨부 파일 경로가 비어 있습니다.', { status: 400 });
            }

            const storagePath = normalizeStoragePath(rawStoragePath);
            const root = path.resolve(storagePath);
            if (!activeStorageRoots.has(root)) {
                return new Response('등록되지 않은 저장소입니다.', { status: 403 });
            }

            const relativePath = normalizeRelativePath(rawRelativePath);
            const metadata = await readMetadata(storagePath);
            const attachment = metadata ? findMetadataAttachment(metadata, relativePath, { relativePath }) : null;
            const storageRelativePath = attachment?.storagePath || relativePath;
            if (!isAttachmentRelativePath(relativePath) && !storageRelativePath.split('/').includes('attachments')) {
                return new Response('첨부 파일 경로만 열 수 있습니다.', { status: 403 });
            }

            const { absolutePath } = resolveStorageFile(storagePath, storageRelativePath);
            const stat = await fs.stat(absolutePath);
            if (!stat.isFile()) {
                return new Response('첨부 파일을 찾지 못했습니다.', { status: 404 });
            }

            const content = await fs.readFile(absolutePath);
            return new Response(content, {
                headers: {
                    'Content-Type': contentTypeForFileName(storageRelativePath),
                    'Cache-Control': 'no-store'
                }
            });
        } catch (error) {
            return new Response(error instanceof Error ? error.message : '첨부 파일을 열지 못했습니다.', { status: 404 });
        }
    });

    attachmentProtocolRegistered = true;
}

async function createWindow(options = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    if (!DEV_URL) await registerLocalProtocol();
    await registerAttachmentProtocol();

    const win = new BrowserWindow({
        width: 1400,
        height: 920,
        minWidth: 1024,
        minHeight: 720,
        backgroundColor: '#fbfbfa',
        title: APP_NAME,
        icon: APP_ICON_PATH,
        frame: true,
        show: options.show !== false,
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

    win.on('query-session-end', () => {
        isQuitting = true;
    });

    win.on('session-end', () => {
        isQuitting = true;
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv = []) => {
        if (shouldQuitFromArgs(argv)) {
            quitApplication();
            return;
        }
        void showMainWindow();
    });

    app.whenReady().then(async () => {
        if (shouldQuitFromArgs(process.argv)) {
            quitApplication();
            return;
        }

        await readAppPreferences();
        syncTrayState();
        registerAppHandlers();
        registerUpdateHandlers();
        registerStorageHandlers();
        registerSyncHandlers();
        registerPdfHandlers();
        const startHidden = shouldStartHiddenLoginItem(
            appPreferences,
            launchedAsHiddenLoginItem()
        );
        await createWindow({ show: !startHidden });
        if (startHidden && process.platform === 'darwin' && app.dock) app.dock.hide();

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
}
