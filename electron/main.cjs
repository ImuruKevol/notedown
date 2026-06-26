const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, shell, Tray } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const DEV_URL = process.env.NOTEDOWN_DEV_URL;
const DIST_DIR = path.resolve(__dirname, '..', 'bundle', 'www');
const APP_NAME = 'Notedown';
const APP_ID = 'com.notedown.app';
const APP_ICON_PATH = path.resolve(__dirname, '..', 'build-resources', 'icon.png');
const TRAY_ICON_PATH = path.resolve(__dirname, '..', 'build-resources', 'tray-icon.png');
const APP_PREFERENCES_FILE = 'app-preferences.json';
const START_HIDDEN_ARG = '--notedown-start-hidden';
let protocolRegistered = false;
let attachmentProtocolRegistered = false;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let currentWorkspaceRevealTimer = null;
const activeStorageRoots = new Set();
const deflateRaw = promisify(zlib.deflateRaw);
let appPreferences = {
    keepInBackgroundOnClose: true,
    launchAtStartup: false
};

const METADATA_FILE = 'metadata.json';
const SYNC_STATE_FILE = '.notedown-sync.json';
const DEFAULT_SYNC_SERVER_URL = 'http://172.16.0.143:5500';
const SYNC_REQUEST_TIMEOUT_MS = 15000;
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

function normalizeAppPreferences(preferences = {}) {
    return {
        keepInBackgroundOnClose: preferences.keepInBackgroundOnClose !== false,
        launchAtStartup: preferences.launchAtStartup === true
    };
}

function supportsLaunchAtStartup() {
    return process.platform === 'darwin' || process.platform === 'win32';
}

function loginItemSettingsOptions() {
    if (process.platform !== 'win32') return {};
    return {
        path: process.execPath,
        args: [START_HIDDEN_ARG]
    };
}

function loginItemOptions(openAtLogin) {
    const options = { openAtLogin: Boolean(openAtLogin) };
    if (process.platform === 'darwin') {
        options.openAsHidden = true;
    } else if (process.platform === 'win32') {
        options.path = process.execPath;
        options.args = [START_HIDDEN_ARG];
        options.name = APP_NAME;
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
            launchAtStartup: Boolean(settings.openAtLogin)
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

function rememberStoragePath(filePath) {
    const storagePath = normalizeStoragePath(filePath);
    activeStorageRoots.add(path.resolve(storagePath));
    return storagePath;
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

function isSystemRelativePath(relativePath) {
    const firstPart = toPosixPath(relativePath).replace(/^\/+/g, '').split('/').filter(Boolean)[0] || '';
    return firstPart === METADATA_FILE || firstPart === SYNC_STATE_FILE;
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
            files: {},
            attachments: {}
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
        if (isSystemRelativePath(file.relativePath)) continue;
        const relativePath = normalizeRelativePath(file.relativePath);
        files[relativePath] = {
            lastKnownRevision: Number(file.revision) || 0,
            contentHash: file.contentHash || null,
            updatedAtMs: Number(file.clientUpdatedAtMs) || null,
            deleted: isDeletedFlag(file.deleted)
        };
    }

    const attachments = {};
    for (const file of manifest.attachments || []) {
        if (!file?.relativePath) continue;
        if (isSystemRelativePath(file.relativePath)) continue;
        const relativePath = normalizeRelativePath(file.relativePath);
        attachments[relativePath] = {
            lastKnownRevision: Number(file.revision) || 0,
            contentHash: file.contentHash || null,
            updatedAtMs: Number(file.clientUpdatedAtMs) || null,
            deleted: isDeletedFlag(file.deleted)
        };
    }

    const nextState = {
        ...previousState,
        serverRevision: Number(manifest.serverRevision) || 0,
        metadataRevision: Number(manifest.metadata?.revision) || 0,
        metadataHash: manifest.metadata?.contentHash || null,
        files,
        attachments,
        updatedAt: new Date().toISOString()
    };
    await writeSyncState(storagePath, nextState);
    return nextState;
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

async function removeMetadataOrphans(storagePath, previousMetadata, writtenRelativePaths, writtenAttachmentPaths = new Set()) {
    const root = path.resolve(storagePath);
    const previousNotes = Array.isArray(previousMetadata?.notes) ? previousMetadata.notes : [];

    for (const note of previousNotes) {
        if (!note?.relativePath || writtenRelativePaths.has(note.relativePath)) continue;
        const absolutePath = path.resolve(storagePath, note.relativePath);
        if (!isInsidePath(root, absolutePath) || path.basename(absolutePath) === METADATA_FILE) continue;
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), root);
    }

    for (const note of previousNotes) {
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath) continue;
            const relativePath = normalizeRelativePath(attachment.relativePath);
            if (writtenAttachmentPaths.has(relativePath)) continue;
            const absolutePath = path.resolve(storagePath, relativePath);
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

function normalizeAttachmentMetadata(attachment = {}, noteRelativePath = '') {
    const relativePath = normalizeRelativePath(attachment.relativePath);
    const fileName = safeAttachmentFileName(attachment.fileName || path.posix.basename(relativePath));
    return {
        id: attachment.id || attachment.attachmentId || `att-${crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 16)}`,
        fileName,
        relativePath,
        noteRelativePath: attachment.noteRelativePath ? normalizeRelativePath(attachment.noteRelativePath) : noteRelativePath,
        mimeType: attachment.mimeType || null,
        size: Number.isFinite(attachment.size) ? Number(attachment.size) : null,
        contentHash: attachment.contentHash || null,
        updatedAtMs: Number.isFinite(attachment.updatedAtMs) ? Number(attachment.updatedAtMs) : null,
        deleted: isDeletedFlag(attachment.deleted)
    };
}

function noteAttachmentDirectory(noteRelativePath, note = {}) {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const noteDir = path.posix.dirname(safeNoteRelativePath);
    const noteName = path.posix.basename(safeNoteRelativePath, path.posix.extname(safeNoteRelativePath));
    const noteSegment = safePathSegment(note.id || noteName || 'note', 'note');
    return normalizeRelativePath(path.posix.join(noteDir === '.' ? '' : noteDir, '.attachments', noteSegment));
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

function upsertMetadataAttachment(metadata, noteRelativePath, attachment) {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const note = (metadata.notes || []).find(item => item?.relativePath && normalizeRelativePath(item.relativePath) === safeNoteRelativePath);
    if (!note) return;
    const nextAttachment = normalizeAttachmentMetadata(attachment, safeNoteRelativePath);
    if (!Array.isArray(note.attachments)) note.attachments = [];
    const index = note.attachments.findIndex(item => {
        if (!item?.relativePath) return false;
        return normalizeRelativePath(item.relativePath) === nextAttachment.relativePath || (nextAttachment.id && item.id === nextAttachment.id);
    });
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
    const writtenAttachmentPaths = new Set();

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
        const attachments = noteAttachmentsForMetadata(note, relativePath);
        for (const attachment of attachments) writtenAttachmentPaths.add(attachment.relativePath);

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
            attachments,
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
    await removeMetadataOrphans(storagePath, previousMetadata, writtenRelativePaths, writtenAttachmentPaths);

    return { ok: true, notes: metadataNotes.length, workspaces: workspaces.size };
}

async function saveAttachmentToStorage(args = {}) {
    const storagePath = rememberStoragePath(args.storagePath);
    const metadata = await ensureMetadata(storagePath);
    const payloadNote = args.note || null;
    const noteRelativePath = normalizeRelativePath(args.noteRelativePath || payloadNote?.relativePath || relativePathForNote(payloadNote));
    const note = findMetadataNote(metadata, noteRelativePath, payloadNote);
    if (!note) throw new Error('첨부할 노트를 찾지 못했습니다.');

    upsertMetadataWorkspace(metadata, workspacePayload(metadata, note));
    upsertMetadataNote(metadata, notePayload(note, noteRelativePath));

    const fileName = safeAttachmentFileName(args.fileName || 'attachment');
    const attachmentDir = noteAttachmentDirectory(noteRelativePath, note);
    const baseRelativePath = normalizeRelativePath(args.relativePath || path.posix.join(attachmentDir, fileName));
    const relativePath = args.relativePath ? baseRelativePath : await uniqueAttachmentRelativePath(storagePath, baseRelativePath);
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);
    const contentEncoding = args.contentEncoding || 'base64';
    const content = contentEncoding === 'base64'
        ? Buffer.from(String(args.content || ''), 'base64')
        : Buffer.from(String(args.content || ''), 'utf8');
    const updatedAtMs = Date.now();

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);

    const attachment = normalizeAttachmentMetadata({
        id: args.id,
        fileName,
        relativePath,
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
    const { relativePath, absolutePath } = resolveStorageFile(storagePath, args.relativePath);
    if (!await exists(absolutePath)) throw new Error('첨부 파일을 찾지 못했습니다.');
    const error = await shell.openPath(absolutePath);
    if (error) throw new Error(error);
    return { ok: true, relativePath };
}

function normalizeServerUrl(serverUrl) {
    const rawUrl = String(serverUrl || DEFAULT_SYNC_SERVER_URL).trim();
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

function planItemRelativePath(item = {}) {
    return item?.relativePath
        || item?.file?.relativePath
        || item?.serverFile?.relativePath
        || item?.serverAttachment?.relativePath
        || item?.attachment?.relativePath
        || '';
}

function isSystemPlanItem(item) {
    return isSystemRelativePath(planItemRelativePath(item));
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
    next.conflicts = nonSystemPlanItems(next.conflicts);
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

function filterUnsafeServerDeletes(plan = {}, syncState = {}) {
    const next = filterSyncPlan(plan);
    next.deleteServerFiles = next.deleteServerFiles.filter(item => serverDeleteLastKnownRevision(syncState, item, false) > 0);
    next.deleteServerAttachments = next.deleteServerAttachments.filter(item => serverDeleteLastKnownRevision(syncState, item, true) > 0);
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
    const plan = filterSyncPlan(response.plan);
    if (!serverMetadata || metadataStatus === 'same' || metadataStatus === 'server_empty') return plan;

    const serverFiles = mapManifestFiles(response.manifest);
    const serverNotes = mapMetadataNotes(serverMetadata);
    const serverWorkspaces = mapMetadataWorkspaces(serverMetadata);
    const localNotes = mapMetadataNotes(localMetadata);

    for (const [relativePath, serverNote] of serverNotes.entries()) {
        if (planIncludesPath(plan, relativePath)) continue;

        const serverFile = serverFiles.get(relativePath);
        if (!serverFile || isDeletedFlag(serverFile.deleted)) continue;

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
    const activePaths = new Set();
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
            activePaths.add(relativePath);
        } catch (error) {
            // Missing local files are represented by metadata differences in the plan response.
        }
    }

    for (const [rawRelativePath, state] of Object.entries(syncState.files || {})) {
        if (!rawRelativePath || isDeletedFlag(state?.deleted)) continue;
        const relativePath = normalizeRelativePath(rawRelativePath);
        const lastKnownRevision = Number(state?.lastKnownRevision) || 0;
        if (lastKnownRevision <= 0 || activePaths.has(relativePath) || isSystemRelativePath(relativePath)) continue;
        try {
            const { absolutePath } = resolveStorageFile(storagePath, relativePath);
            await fs.stat(absolutePath);
        } catch (error) {
            files.push({ relativePath, deleted: true, lastKnownRevision });
        }
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
            try {
                const { absolutePath } = resolveStorageFile(storagePath, relativePath);
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
                // Missing local attachment bytes are handled through metadata differences and conflicts.
            }
        }
    }

    for (const [rawRelativePath, state] of Object.entries(syncState.attachments || {})) {
        if (!rawRelativePath || isDeletedFlag(state?.deleted)) continue;
        const relativePath = normalizeRelativePath(rawRelativePath);
        const lastKnownRevision = Number(state?.lastKnownRevision) || 0;
        if (lastKnownRevision <= 0 || activePaths.has(relativePath) || isSystemRelativePath(relativePath)) continue;
        try {
            const { absolutePath } = resolveStorageFile(storagePath, relativePath);
            await fs.stat(absolutePath);
        } catch (error) {
            attachments.push({ relativePath, deleted: true, lastKnownRevision });
        }
    }

    return attachments;
}

async function createSyncPlan(args = {}) {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
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
                body: metadata,
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
    const deleted = isDeletedFlag(args.deleted);
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

function findMetadataAttachment(metadata, relativePath, fallback = null) {
    const safeRelativePath = relativePath ? normalizeRelativePath(relativePath) : '';
    for (const note of metadata.notes || []) {
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath) continue;
            if (normalizeRelativePath(attachment.relativePath) === safeRelativePath) {
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

async function uploadLocalAttachment(args = {}, item = {}) {
    const { storagePath, serverUrl, token, clientId } = syncConfig(args);
    const metadata = await ensureMetadata(storagePath);
    const syncState = await readSyncState(storagePath);
    const relativePath = normalizeRelativePath(item.relativePath || args.relativePath);
    const attachment = findMetadataAttachment(metadata, relativePath, item.attachment || args.attachment);
    const note = findMetadataNoteByAttachment(metadata, attachment || item) || findMetadataNote(metadata, item.noteRelativePath || attachment?.noteRelativePath || args.noteRelativePath, item.note || args.note);
    const noteRelativePath = normalizeRelativePath(item.noteRelativePath || attachment?.noteRelativePath || note?.relativePath || args.noteRelativePath);
    const state = syncState.attachments?.[relativePath] || {};
    const deleted = isDeletedFlag(args.deleted) || isDeletedFlag(item.deleted);
    const lastKnownRevision = Number(args.lastKnownRevision) || Number(item.lastKnownRevision) || Number(state.lastKnownRevision) || 0;
    if (deleted && lastKnownRevision <= 0) {
        throw new Error('서버 첨부 파일 삭제에는 lastKnownRevision이 필요합니다.');
    }
    const body = {
        clientId,
        baseRevision: Number(syncState.serverRevision) || 0,
        relativePath,
        noteRelativePath,
        lastKnownRevision
    };
    if (deleted) body.deleted = true;

    if (attachment) {
        body.attachment = normalizeAttachmentMetadata({ ...attachment, noteRelativePath }, noteRelativePath);
        body.fileName = attachment.fileName;
        body.mimeType = attachment.mimeType || undefined;
    }
    if (note) {
        body.note = notePayload(note, normalizeRelativePath(note.relativePath || noteRelativePath));
        body.workspace = workspacePayload(metadata, note);
    }

    if (!deleted) {
        const { absolutePath } = resolveStorageFile(storagePath, relativePath);
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

    const response = await syncRequest(serverUrl, '/api/sync/attachment', { token, body });
    if (response.manifest) {
        await writeSyncStateFromManifest(storagePath, response.manifest, syncState);
    }

    return {
        ok: response.status === 'ok',
        ...response
    };
}

async function uploadLocalNoteWithAttachments(args = {}) {
    const noteResult = await uploadLocalFile(args);
    const note = args.note || null;
    const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
    const deleting = isDeletedFlag(args.deleted);
    const uploadedAttachments = [];
    const attachmentConflicts = [];

    if (!deleting && noteResult.status !== 'conflict') {
        for (const attachment of attachments) {
            if (!attachment?.relativePath || isDeletedFlag(attachment.deleted)) continue;
            const result = await uploadLocalAttachment(args, {
                ...attachment,
                attachment,
                noteRelativePath: attachment.noteRelativePath || note.relativePath || relativePathForNote(note)
            });
            if (result.status === 'conflict') {
                attachmentConflicts.push(result.attachment || result.file);
            } else {
                uploadedAttachments.push(result.attachment);
            }
        }
    }

    if (deleting) {
        for (const attachment of attachments) {
            if (!attachment?.relativePath) continue;
            const result = await uploadLocalAttachment({ ...args, deleted: true }, {
                ...attachment,
                attachment,
                noteRelativePath: attachment.noteRelativePath || note.relativePath || relativePathForNote(note)
            });
            if (result.status === 'conflict') {
                attachmentConflicts.push(result.attachment || result.file);
            } else {
                uploadedAttachments.push(result.attachment);
            }
        }
    }

    return {
        ...noteResult,
        ok: Boolean(noteResult.ok && attachmentConflicts.length === 0),
        uploadedAttachments,
        attachmentConflicts
    };
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

async function downloadServerAttachment(args = {}, item, metadata) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = await syncRequest(serverUrl, `/api/attachments/${encodeRelativePathForUrl(relativePath)}`, { token });
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);

    if (isDeletedFlag(payload.deleted)) {
        await fs.rm(absolutePath, { force: true });
        await removeEmptyParents(path.dirname(absolutePath), path.resolve(storagePath));
        removeMetadataAttachment(metadata, relativePath);
        return { relativePath, deleted: true };
    }

    const content = decodeBinaryPayloadContent(payload);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);

    const noteRelativePath = normalizeRelativePath(
        item.noteRelativePath
        || item.attachment?.noteRelativePath
        || payload.noteRelativePath
        || payload.attachment?.noteRelativePath
    );
    if (item.note) {
        upsertMetadataWorkspace(metadata, item.workspace || workspacePayload(metadata, item.note));
        upsertMetadataNote(metadata, notePayload(item.note, noteRelativePath));
    }

    const attachment = normalizeAttachmentMetadata({
        ...(item.attachment || {}),
        id: item.attachment?.id || payload.attachmentId,
        fileName: item.attachment?.fileName || payload.fileName || path.posix.basename(relativePath),
        relativePath,
        noteRelativePath,
        mimeType: item.attachment?.mimeType || payload.mimeType || null,
        size: Number(payload.size) || content.length,
        contentHash: payload.contentHash || sha256(content),
        updatedAtMs: item.attachment?.updatedAtMs || payload.clientUpdatedAtMs || Date.now()
    }, noteRelativePath);
    upsertMetadataAttachment(metadata, noteRelativePath, attachment);
    return { relativePath, deleted: false, attachment };
}

async function downloadServerFile(args = {}, item, metadata) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = await syncRequest(serverUrl, `/api/files/${encodeRelativePathForUrl(relativePath)}`, { token });
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);

    if (isDeletedFlag(payload.deleted)) {
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
    const attachments = removeMetadataNoteAttachments(metadata, relativePath);
    for (const attachment of attachments) {
        if (!attachment?.relativePath) continue;
        const attachmentPath = resolveStorageFile(storagePath, attachment.relativePath).absolutePath;
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
    const { absolutePath } = resolveStorageFile(storagePath, relativePath);
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
        if (isAttachment) {
            const content = await fs.readFile(absolutePath);
            const stat = await fs.stat(absolutePath);
            result.localContent = `첨부 파일\n\n경로: ${relativePath}\n크기: ${content.length} bytes\nSHA-256: ${sha256(content)}\n수정: ${stat.mtime.toISOString()}`;
        } else {
            result.localContent = await fs.readFile(absolutePath, 'utf8');
        }
        result.localExists = true;
    } catch (error) {
        result.localError = error instanceof Error ? error.message : '로컬 파일을 읽지 못했습니다.';
    }

    try {
        const endpoint = isAttachment ? `/api/attachments/${encodeRelativePathForUrl(relativePath)}` : `/api/files/${encodeRelativePathForUrl(relativePath)}`;
        const serverFile = await syncRequest(serverUrl, endpoint, { token });
        result.serverFile = serverFile;
        result.serverContent = isAttachment
            ? `첨부 파일\n\n경로: ${relativePath}\n크기: ${serverFile.size || 0} bytes\nSHA-256: ${serverFile.contentHash || ''}\n수정: ${serverFile.serverUpdatedAt || ''}`
            : decodeFilePayloadContent(serverFile);
    } catch (error) {
        result.serverError = error instanceof Error ? error.message : '서버 파일을 읽지 못했습니다.';
    }

    return result;
}

async function resolveSyncConflict(args = {}) {
    const { storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(args.relativePath);
    const resolution = String(args.resolution || '').trim();
    const isAttachment = args.type === 'attachment' || relativePath.includes('/.attachments/');
    if (!['server', 'local'].includes(resolution)) {
        throw new Error('적용할 충돌 버전을 선택하세요.');
    }

    if (resolution === 'server') {
        const metadata = await ensureMetadata(storagePath);
        const previousState = await readSyncState(storagePath);
        const file = isAttachment
            ? await downloadServerAttachment(args, {
                relativePath,
                serverAttachment: args.serverAttachment || args.serverFile || null,
                attachment: args.serverAttachmentMetadata || args.serverAttachment || null,
                noteRelativePath: args.noteRelativePath || args.serverAttachmentMetadata?.noteRelativePath || null,
                note: args.serverNote || null,
                workspace: args.serverWorkspace || null
            }, metadata)
            : await downloadServerFile(args, {
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

    let lastKnownRevision = Number(args.serverRevision) || Number(args.serverFile?.revision) || Number(args.serverAttachment?.revision) || 0;
    if (!lastKnownRevision) {
        const endpoint = isAttachment ? `/api/attachments/${encodeRelativePathForUrl(relativePath)}` : `/api/files/${encodeRelativePathForUrl(relativePath)}`;
        const serverFile = await syncRequest(serverUrl, endpoint, { token });
        lastKnownRevision = Number(serverFile.revision) || 0;
    }

    const uploadResult = isAttachment
        ? await uploadLocalAttachment({ ...args, lastKnownRevision }, {
            relativePath,
            attachment: args.clientAttachment || args.attachment || null,
            noteRelativePath: args.noteRelativePath || args.clientAttachment?.noteRelativePath || null
        })
        : await uploadLocalFile({ ...args, lastKnownRevision }, relativePath);
    if (uploadResult.status === 'conflict') {
        return {
            ok: false,
            status: 'conflict',
            didApply: false,
            resolution,
            resolvedPath: relativePath,
            conflicts: [uploadResult.file || uploadResult.attachment].filter(Boolean),
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
        file: uploadResult.file || uploadResult.attachment,
        upload: uploadResult,
        ...planResponse,
        summary: summarizePlan(planResponse.plan || {})
    };
}

async function runFullSync(args = {}) {
    const { storagePath } = syncConfig(args);
    const syncState = await readSyncState(storagePath);
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
        uploadedAttachments: [],
        downloadedAttachments: [],
        deletedServerAttachments: [],
        deletedLocalAttachments: [],
        conflicts: []
    };
    const metadata = await ensureMetadata(storagePath);
    let metadataChanged = false;
    let latestManifest = planResponse.manifest;

    for (const item of plan.downloadFiles || []) {
        operations.downloaded.push(await downloadServerFile(args, item, metadata));
        metadataChanged = true;
    }

    for (const item of plan.downloadAttachments || []) {
        operations.downloadedAttachments.push(await downloadServerAttachment(args, item, metadata));
        metadataChanged = true;
    }

    for (const item of plan.deleteLocalFiles || []) {
        operations.deletedLocal.push(await deleteLocalFile(storagePath, item, metadata));
        metadataChanged = true;
    }

    for (const item of plan.deleteLocalAttachments || []) {
        operations.deletedLocalAttachments.push(await deleteLocalAttachment(storagePath, item, metadata));
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

    for (const item of plan.uploadAttachments || []) {
        const result = await uploadLocalAttachment(args, item);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.attachment || result.file);
        } else {
            operations.uploadedAttachments.push(result.attachment);
        }
    }

    for (const item of plan.deleteServerFiles || []) {
        const lastKnownRevision = serverDeleteLastKnownRevision(syncState, item, false);
        if (lastKnownRevision <= 0) continue;
        const result = await uploadLocalFile({ ...args, deleted: true, lastKnownRevision }, item.relativePath);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.file);
        } else {
            operations.deletedServer.push(result.file);
        }
    }

    for (const item of plan.deleteServerAttachments || []) {
        const lastKnownRevision = serverDeleteLastKnownRevision(syncState, item, true);
        if (lastKnownRevision <= 0) continue;
        const result = await uploadLocalAttachment({ ...args, deleted: true, lastKnownRevision }, item);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') {
            operations.conflicts.push(result.attachment || result.file);
        } else {
            operations.deletedServerAttachments.push(result.attachment);
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
        const storagePath = rememberStoragePath(args.storagePath);
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
        const storagePath = rememberStoragePath(args.storagePath);
        return generateMetadata(storagePath, { importDeepMarkdown: Boolean(args.importDeepMarkdown) });
    });

    ipcMain.handle('notedown:storage:load-notes', async (_event, args = {}) => {
        const storagePath = rememberStoragePath(args.storagePath);
        let metadata = await readMetadata(storagePath);
        if (!metadata) {
            const generated = await generateMetadata(storagePath, { importDeepMarkdown: false });
            metadata = generated.metadata;
        }
        const notes = await Promise.all((metadata.notes || []).map(note => readMarkdownNote(storagePath, note)));
        return { ok: true, notes, metadata };
    });

    ipcMain.handle('notedown:storage:save-notes', async (_event, args = {}) => {
        const storagePath = rememberStoragePath(args.storagePath);
        return saveNotesToStorage(storagePath, args.notes || []);
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
            return await saveAttachmentToStorage(args);
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : '첨부 파일을 저장하지 못했습니다.'
            };
        }
    });

    ipcMain.handle('notedown:storage:choose-attachments', async (event, args = {}) => {
        try {
            return await chooseAttachmentsForStorage(event, args);
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
            return await uploadLocalNoteWithAttachments(args);
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
            const { relativePath, absolutePath } = resolveStorageFile(storagePath, attachment.relativePath);
            const data = await fs.readFile(absolutePath);
            entries.push({
                name: uniqueZipEntryName(usedNames, path.posix.join('attachments', relativePath)),
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
        try {
            let data;
            try {
                data = await fs.readFile(resolveStorageFile(storagePath, relativePath).absolutePath);
            } catch (error) {
                data = Buffer.from(note.body || '', 'utf8');
            }
            entries.push({
                name: uniqueZipEntryName(usedNames, folderExportEntryName(rootName, folderId, relativePath)),
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
                const { relativePath: attachmentPath, absolutePath } = resolveStorageFile(storagePath, attachment.relativePath);
                entries.push({
                    name: uniqueZipEntryName(usedNames, folderExportEntryName(rootName, folderId, attachmentPath)),
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

function registerAppHandlers() {
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
            if (!isAttachmentRelativePath(relativePath)) {
                return new Response('첨부 파일 경로만 열 수 있습니다.', { status: 403 });
            }

            const { absolutePath } = resolveStorageFile(storagePath, relativePath);
            const stat = await fs.stat(absolutePath);
            if (!stat.isFile()) {
                return new Response('첨부 파일을 찾지 못했습니다.', { status: 404 });
            }

            const content = await fs.readFile(absolutePath);
            return new Response(content, {
                headers: {
                    'Content-Type': contentTypeForFileName(relativePath),
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
    const startHidden = appPreferences.keepInBackgroundOnClose && appPreferences.launchAtStartup && launchedAsHiddenLoginItem();
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
