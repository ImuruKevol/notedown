const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.NOTEDOWN_DEV_URL;
const DIST_DIR = path.resolve(__dirname, '..', 'bundle', 'www');
let protocolRegistered = false;

const METADATA_FILE = 'metadata.json';
const IMPORTED_WORKSPACE_ID = '_imported';
const UNFILED_WORKSPACE_ID = 'unfiled';

function expandHome(filePath) {
    if (!filePath) return '';
    if (filePath === '~') return app.getPath('home');
    if (filePath.startsWith('~/')) return path.join(app.getPath('home'), filePath.slice(2));
    return filePath;
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

function isInsidePath(parentPath, childPath) {
    const relativePath = path.relative(parentPath, childPath);
    return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
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
        const workspaceId = note.folder || note.workspace || UNFILED_WORKSPACE_ID;
        const workspaceName = note.workspaceName || workspaceId;
        const fileName = note.fileName || safeFileName(note.id || note.title, 'note');
        const relativePath = note.relativePath || (workspaceId === UNFILED_WORKSPACE_ID ? fileName : path.join(workspaceId, fileName));
        const absolutePath = path.join(storagePath, relativePath);

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
    if (!DEV_URL) await registerLocalProtocol();

    const win = new BrowserWindow({
        width: 1400,
        height: 920,
        minWidth: 1024,
        minHeight: 720,
        backgroundColor: '#fbfbfa',
        title: 'Notedown',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    if (DEV_URL) {
        await win.loadURL(DEV_URL);
    } else {
        await win.loadURL('notedown://app/index.html');
    }
}

app.whenReady().then(async () => {
    registerStorageHandlers();
    registerPdfHandlers();
    await createWindow();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
