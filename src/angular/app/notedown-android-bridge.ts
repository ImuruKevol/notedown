type NativeBridge = Record<string, (payload?: Record<string, unknown>) => Promise<any>>;

declare global {
    interface Window {
        Capacitor?: any;
        notedown?: any;
    }
}

const METADATA_FILE = 'metadata.json';
const SYNC_STATE_FILE = '.notedown-sync.json';
const DEFAULT_SYNC_SERVER_URL = 'http://172.16.0.143:5500';
const SYNC_REQUEST_TIMEOUT_MS = 15000;
const IMPORTED_WORKSPACE_ID = '_imported';
const UNFILED_WORKSPACE_ID = 'unfiled';

function isDeletedFlag(value: unknown) {
    return value === true || value === 'true';
}

function nativePlugin(): NativeBridge | null {
    return window.Capacitor?.Plugins?.NotedownNative || null;
}

function capacitorHttp(): any {
    return window.Capacitor?.Plugins?.CapacitorHttp || null;
}

function normalizeServerUrl(serverUrl?: string) {
    const url = new URL(String(serverUrl || DEFAULT_SYNC_SERVER_URL).trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP 또는 HTTPS 동기화 서버만 사용할 수 있습니다.');
    return url.toString().replace(/\/+$/g, '');
}

function normalizeRelativePath(relativePath?: string, allowEmpty = false) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/g, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
        if (allowEmpty) return '';
        throw new Error('파일 경로가 비어 있습니다.');
    }
    if (parts.some(part => part === '.' || part === '..')) throw new Error('허용되지 않는 파일 경로입니다.');
    if (parts[0] === METADATA_FILE || parts[0] === SYNC_STATE_FILE) throw new Error('동기화할 수 없는 시스템 파일입니다.');
    return parts.join('/');
}

function optionalRelativePath(relativePath?: string) {
    return normalizeRelativePath(relativePath, true);
}

function isSystemRelativePath(relativePath?: string) {
    const firstPart = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/g, '').split('/').filter(Boolean)[0] || '';
    return firstPart === METADATA_FILE || firstPart === SYNC_STATE_FILE;
}

async function syncRequest(serverUrl: string | undefined, endpoint: string, options: any = {}) {
    const url = new URL(endpoint, `${normalizeServerUrl(serverUrl)}/`).toString();
    const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(options.headers || {})
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body != null) headers['Content-Type'] = 'application/json';

    const method = options.method || (options.body == null ? 'GET' : 'POST');
    const http = capacitorHttp();
    if (http?.request) {
        const response = await http.request({
            url,
            method,
            headers,
            data: options.body,
            connectTimeout: options.timeoutMs || SYNC_REQUEST_TIMEOUT_MS,
            readTimeout: options.timeoutMs || SYNC_REQUEST_TIMEOUT_MS
        });
        const data = parseResponseData(response?.data);
        if (Number(response?.status) >= 400) {
            const error = new Error(data?.message || data?.error || '동기화 서버 요청에 실패했습니다.') as any;
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || SYNC_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method,
            headers,
            body: options.body == null ? undefined : JSON.stringify(options.body),
            signal: controller.signal
        });
        const text = await response.text();
        const data = parseResponseData(text);
        if (!response.ok) {
            const error = new Error(data?.message || data?.error || response.statusText || '동기화 서버 요청에 실패했습니다.') as any;
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data;
    } finally {
        window.clearTimeout(timeout);
    }
}

function parseResponseData(data: any) {
    if (typeof data !== 'string') return data || {};
    if (!data) return {};
    try {
        return JSON.parse(data);
    } catch (error) {
        return { message: data };
    }
}

function syncError(error: any, fallback = '동기화 작업 중 오류가 발생했습니다.') {
    return {
        ok: false,
        error: error?.message || fallback,
        statusCode: error?.status,
        data: error?.data
    };
}

function syncConfig(args: any = {}, requireToken = true) {
    const native = requireNative();
    const storagePath = String(args.storagePath || '').trim();
    const serverUrl = normalizeServerUrl(args.serverUrl);
    const token = String(args.token || '').trim();
    const clientId = String(args.clientId || 'notedown-android').trim() || 'notedown-android';
    if (!storagePath) throw new Error('저장소 경로가 필요합니다.');
    if (requireToken && !token) throw new Error('동기화 서버 로그인이 필요합니다.');
    return { native, storagePath, serverUrl, token, clientId };
}

function planItemRelativePath(item: any = {}) {
    return item?.relativePath
        || item?.file?.relativePath
        || item?.serverFile?.relativePath
        || item?.serverAttachment?.relativePath
        || item?.attachment?.relativePath
        || '';
}

function isSystemPlanItem(item: any) {
    return isSystemRelativePath(planItemRelativePath(item));
}

function nonSystemPlanItems(items: any[] = []) {
    if (!Array.isArray(items)) return [];
    return items.filter(item => !isSystemPlanItem(item));
}

function requireNative() {
    const native = nativePlugin();
    if (!native) throw new Error('Android 네이티브 브리지를 사용할 수 없습니다.');
    return native;
}

function summarizePlan(plan: any = {}) {
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

function clonePlan(plan: any = {}) {
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

function filterSyncPlan(plan: any = {}) {
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

function hasSyncHistory(syncState: any = {}) {
    if (Number(syncState.serverRevision) > 0 || Number(syncState.metadataRevision) > 0) return true;
    const fileStates = Object.values(syncState.files || {});
    const attachmentStates = Object.values(syncState.attachments || {});
    return fileStates.concat(attachmentStates).some((state: any) => Number(state?.lastKnownRevision) > 0);
}

function serverDeleteLastKnownRevision(syncState: any = {}, item: any = {}, attachment = false) {
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

function filterUnsafeServerDeletes(plan: any = {}, syncState: any = {}) {
    const next = filterSyncPlan(plan);
    next.deleteServerFiles = next.deleteServerFiles.filter((item: any) => serverDeleteLastKnownRevision(syncState, item, false) > 0);
    next.deleteServerAttachments = next.deleteServerAttachments.filter((item: any) => serverDeleteLastKnownRevision(syncState, item, true) > 0);
    return next;
}

function planIncludesPath(plan: any, relativePath: string) {
    const groups = ['uploadFiles', 'downloadFiles', 'deleteServerFiles', 'deleteLocalFiles', 'conflicts'];
    return groups.some(group => (plan[group] || []).some((item: any) => {
        const itemPath = planItemRelativePath(item);
        if (!itemPath || isSystemRelativePath(itemPath)) return false;
        return normalizeRelativePath(itemPath) === relativePath;
    }));
}

function mapManifestFiles(manifest: any = {}) {
    const files = new Map<string, any>();
    for (const file of manifest.files || []) {
        if (!file?.relativePath) continue;
        if (isSystemRelativePath(file.relativePath)) continue;
        files.set(normalizeRelativePath(file.relativePath), file);
    }
    return files;
}

function mapMetadataNotes(metadata: any = {}) {
    const notes = new Map<string, any>();
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        notes.set(normalizeRelativePath(note.relativePath), note);
    }
    return notes;
}

function mapMetadataWorkspaces(metadata: any = {}) {
    const workspaces = new Map<string, any>();
    for (const workspace of metadata.workspaces || []) {
        if (!workspace?.id) continue;
        workspaces.set(workspace.id, workspace);
    }
    return workspaces;
}

function comparableMetadataNote(note: any) {
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

function metadataNoteChanged(left: any, right: any) {
    return JSON.stringify(comparableMetadataNote(left)) !== JSON.stringify(comparableMetadataNote(right));
}

function defaultSyncState() {
    return {
        serverRevision: 0,
        metadataRevision: 0,
        metadataHash: null,
        files: {},
        attachments: {}
    };
}

async function readSyncState(native: NativeBridge, storagePath: string) {
    const result = await native.readSyncState({ storagePath });
    return result?.state || defaultSyncState();
}

async function writeSyncState(native: NativeBridge, storagePath: string, state: any) {
    await native.writeSyncState({ storagePath, state });
}

async function writeSyncStateFromManifest(native: NativeBridge, storagePath: string, manifest: any, previousState: any = {}) {
    if (!manifest) return previousState;

    const files: Record<string, any> = {};
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

    const attachments: Record<string, any> = {};
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
    await writeSyncState(native, storagePath, nextState);
    return nextState;
}

function noteWorkspaceId(note: any = {}) {
    return note.folder || note.workspace || UNFILED_WORKSPACE_ID;
}

function noteWorkspaceName(note: any = {}, workspaceId = noteWorkspaceId(note)) {
    return note.workspaceName || note.workspaceLabel || workspaceId;
}

function safeFileName(name: string, fallback = 'note') {
    const base = String(name || fallback)
        .replace(/\.md$/i, '')
        .replace(/[/:\\?%*"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || fallback;
    return `${base}.md`;
}

function safePathSegment(name: string, fallback = 'item') {
    return String(name || fallback)
        .replace(/\.[a-z0-9]{1,12}$/i, '')
        .replace(/[/:\\?%*"<>|.]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || fallback;
}

function noteFileName(note: any = {}) {
    return note.fileName || safeFileName(note.id || note.title, 'note');
}

function relativePathForNote(note: any = {}) {
    if (note.relativePath) return normalizeRelativePath(note.relativePath);
    const workspaceId = noteWorkspaceId(note);
    const fileName = noteFileName(note);
    return normalizeRelativePath(workspaceId === UNFILED_WORKSPACE_ID ? fileName : `${workspaceId}/${fileName}`);
}

async function noteIdFromRelativePath(relativePath: string) {
    const hash = await sha1(relativePath);
    return `note-${hash.slice(0, 16)}`;
}

function titleFromMarkdown(markdown: string, fileName: string) {
    const heading = markdown.split(/\r?\n/).map(line => /^#\s+(.+)$/.exec(line)?.[1]?.trim()).find(Boolean);
    return heading || fileName.replace(/\.md$/i, '') || '제목 없음';
}

function noteAttachmentDirectory(noteRelativePath: string, note: any = {}) {
    const safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
    const slash = safeNoteRelativePath.lastIndexOf('/');
    const noteDir = slash >= 0 ? safeNoteRelativePath.slice(0, slash) : '';
    const noteFile = slash >= 0 ? safeNoteRelativePath.slice(slash + 1) : safeNoteRelativePath;
    const noteName = noteFile.replace(/\.md$/i, '');
    const noteSegment = safePathSegment(note.id || noteName || 'note', 'note');
    return normalizeRelativePath(`${noteDir ? `${noteDir}/` : ''}.attachments/${noteSegment}`);
}

function normalizeAttachmentMetadata(attachment: any = {}, noteRelativePath = '') {
    const relativePath = normalizeRelativePath(attachment.relativePath);
    const fileName = attachment.fileName || relativePath.split('/').pop() || 'attachment';
    return {
        id: attachment.id || attachment.attachmentId || `att-${relativePath.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`,
        fileName,
        relativePath,
        noteRelativePath: attachment.noteRelativePath ? normalizeRelativePath(attachment.noteRelativePath) : noteRelativePath,
        mimeType: attachment.mimeType || null,
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : null,
        contentHash: attachment.contentHash || null,
        updatedAtMs: Number.isFinite(Number(attachment.updatedAtMs)) ? Number(attachment.updatedAtMs) : null,
        deleted: isDeletedFlag(attachment.deleted)
    };
}

function noteAttachmentsForMetadata(note: any = {}, noteRelativePath: string) {
    if (!Array.isArray(note.attachments)) return [];
    return note.attachments
        .filter((attachment: any) => attachment?.relativePath)
        .map((attachment: any) => normalizeAttachmentMetadata(attachment, noteRelativePath))
        .filter((attachment: any) => !attachment.deleted);
}

function notePayload(note: any, relativePath: string) {
    if (!note) return null;
    const workspaceId = noteWorkspaceId(note);
    const { body: _body, ...metadataNote } = note;
    return {
        ...metadataNote,
        workspace: workspaceId,
        folder: workspaceId,
        workspaceName: noteWorkspaceName(note, workspaceId),
        fileName: relativePath.split('/').pop() || noteFileName(note),
        relativePath,
        attachments: noteAttachmentsForMetadata(note, relativePath)
    };
}

function workspacePayload(metadata: any, note: any) {
    if (!note) return null;
    const workspaceId = noteWorkspaceId(note);
    const existing = Array.isArray(metadata?.workspaces)
        ? metadata.workspaces.find((workspace: any) => workspace?.id === workspaceId)
        : null;
    return existing || { id: workspaceId, name: noteWorkspaceName(note, workspaceId) };
}

function findMetadataNote(metadata: any, relativePath?: string, payloadNote?: any) {
    const notes = Array.isArray(metadata?.notes) ? metadata.notes : [];
    const safeRelativePath = optionalRelativePath(relativePath);
    if (safeRelativePath) {
        const byPath = notes.find((note: any) => note?.relativePath && normalizeRelativePath(note.relativePath) === safeRelativePath);
        if (byPath) return byPath;
    }
    if (payloadNote?.id) {
        const byId = notes.find((note: any) => note?.id === payloadNote.id);
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

function findMetadataAttachment(metadata: any, relativePath?: string, fallback: any = null) {
    const safeRelativePath = optionalRelativePath(relativePath);
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

function findMetadataNoteByAttachment(metadata: any, attachment: any = {}) {
    const noteRelativePath = optionalRelativePath(attachment.noteRelativePath);
    if (noteRelativePath) {
        return (metadata.notes || []).find((note: any) => note?.relativePath && normalizeRelativePath(note.relativePath) === noteRelativePath) || null;
    }
    const attachmentRelativePath = optionalRelativePath(attachment.relativePath);
    if (!attachmentRelativePath) return null;
    return (metadata.notes || []).find((note: any) => (note.attachments || []).some((item: any) => {
        if (!item?.relativePath) return false;
        return normalizeRelativePath(item.relativePath) === attachmentRelativePath;
    })) || null;
}

async function loadStorage(native: NativeBridge, storagePath: string) {
    const result = await native.loadNotes({ storagePath });
    if (!result?.ok) throw new Error(result?.error || '저장소를 읽지 못했습니다.');
    return {
        notes: Array.isArray(result.notes) ? result.notes : [],
        metadata: result.metadata || { notes: [], workspaces: [] }
    };
}

async function saveStorageNotes(native: NativeBridge, storagePath: string, notes: any[]) {
    return native.saveNotes({ storagePath, notes });
}

function upsertNote(notes: any[], note: any) {
    const relativePath = normalizeRelativePath(note.relativePath || relativePathForNote(note));
    const nextNote = {
        ...note,
        relativePath,
        folder: noteWorkspaceId(note),
        workspace: noteWorkspaceId(note),
        workspaceName: noteWorkspaceName(note),
        fileName: relativePath.split('/').pop() || noteFileName(note)
    };
    const index = notes.findIndex(item => item?.relativePath && normalizeRelativePath(item.relativePath) === relativePath);
    if (index >= 0) notes[index] = { ...notes[index], ...nextNote };
    else notes.push(nextNote);
}

function removeNote(notes: any[], relativePath: string) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    return notes.filter(note => !note?.relativePath || normalizeRelativePath(note.relativePath) !== safeRelativePath);
}

function removeAttachmentFromNotes(notes: any[], relativePath: string) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    for (const note of notes) {
        if (!Array.isArray(note.attachments)) continue;
        note.attachments = note.attachments.filter((attachment: any) => {
            if (!attachment?.relativePath) return false;
            return normalizeRelativePath(attachment.relativePath) !== safeRelativePath;
        });
    }
}

async function localFileSyncInfo(native: NativeBridge, storagePath: string, syncState: any, relativePath: string, attachment = false) {
    const state = (attachment ? syncState.attachments : syncState.files)?.[relativePath] || {};
    try {
        const file = await native.readFile({ storagePath, relativePath });
        return {
            exists: Boolean(file?.localExists),
            contentHash: file?.contentHash || null,
            updatedAtMs: Number(file?.updatedAtMs) || null,
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

function isLocalDirty(localInfo: any) {
    const knownHash = localInfo.state?.contentHash;
    return Boolean(localInfo.exists && knownHash && localInfo.contentHash && localInfo.contentHash !== knownHash);
}

async function buildKnownFiles(native: NativeBridge, storagePath: string, metadata: any, syncState: any) {
    const files = [];
    const activePaths = new Set<string>();
    for (const note of metadata.notes || []) {
        if (!note?.relativePath) continue;
        const relativePath = normalizeRelativePath(note.relativePath);
        const info = await native.readFile({ storagePath, relativePath });
        if (!info?.localExists) continue;
        const state = syncState.files?.[relativePath] || {};
        files.push({
            relativePath,
            contentHash: info.contentHash,
            lastKnownRevision: Number(state.lastKnownRevision) || 0,
            updatedAtMs: Number(note.updatedAtMs) || Number(info.updatedAtMs) || Date.now()
        });
        activePaths.add(relativePath);
    }

    for (const [rawRelativePath, state] of Object.entries(syncState.files || {})) {
        if (!rawRelativePath || isDeletedFlag((state as any)?.deleted)) continue;
        const relativePath = normalizeRelativePath(rawRelativePath);
        const lastKnownRevision = Number((state as any)?.lastKnownRevision) || 0;
        if (lastKnownRevision <= 0 || activePaths.has(relativePath) || isSystemRelativePath(relativePath)) continue;
        const info = await native.readFile({ storagePath, relativePath });
        if (!info?.localExists) files.push({ relativePath, deleted: true, lastKnownRevision });
    }

    return files;
}

async function buildKnownAttachments(native: NativeBridge, storagePath: string, metadata: any, syncState: any) {
    const attachments = [];
    const activePaths = new Set<string>();
    for (const note of metadata.notes || []) {
        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath || isDeletedFlag(attachment.deleted)) continue;
            const relativePath = normalizeRelativePath(attachment.relativePath);
            const info = await native.readFile({ storagePath, relativePath });
            if (!info?.localExists) continue;
            const state = syncState.attachments?.[relativePath] || {};
            attachments.push({
                relativePath,
                contentHash: info.contentHash,
                lastKnownRevision: Number(state.lastKnownRevision) || 0,
                updatedAtMs: Number(attachment.updatedAtMs) || Number(info.updatedAtMs) || Date.now()
            });
            activePaths.add(relativePath);
        }
    }

    for (const [rawRelativePath, state] of Object.entries(syncState.attachments || {})) {
        if (!rawRelativePath || isDeletedFlag((state as any)?.deleted)) continue;
        const relativePath = normalizeRelativePath(rawRelativePath);
        const lastKnownRevision = Number((state as any)?.lastKnownRevision) || 0;
        if (lastKnownRevision <= 0 || activePaths.has(relativePath) || isSystemRelativePath(relativePath)) continue;
        const info = await native.readFile({ storagePath, relativePath });
        if (!info?.localExists) attachments.push({ relativePath, deleted: true, lastKnownRevision });
    }

    return attachments;
}

async function reconcilePlanWithServerMetadata(native: NativeBridge, storagePath: string, localMetadata: any, syncState: any, response: any) {
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
        const localInfo = await localFileSyncInfo(native, storagePath, syncState, relativePath);
        const localNote = localNotes.get(relativePath);
        const serverRevision = Number(serverFile.revision) || 0;
        const knownRevision = Number(localInfo.state?.lastKnownRevision) || 0;
        const hasSyncHistory = knownRevision > 0 || Boolean(localInfo.state?.contentHash);
        const serverHash = serverFile.contentHash || null;
        const fileChanged = !localInfo.exists || Boolean(serverHash && localInfo.contentHash && serverHash !== localInfo.contentHash);
        const metadataChanged = metadataNoteChanged(localNote, serverNote);
        if (!fileChanged && !metadataChanged) continue;

        if (localInfo.exists && !hasSyncHistory) {
            plan.conflicts.push({ relativePath, reason: 'server_metadata_changed_without_sync_history', type: 'metadata', serverFile, serverNote, clientNote: localNote || null });
            continue;
        }
        if (isLocalDirty(localInfo) && (serverRevision > knownRevision || metadataChanged || fileChanged)) {
            plan.conflicts.push({ relativePath, reason: 'server_metadata_changed_after_local_edit', type: 'metadata', serverFile, serverNote, clientNote: localNote || null });
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
        const localInfo = await localFileSyncInfo(native, storagePath, syncState, relativePath);
        const knownRevision = Number(localInfo.state?.lastKnownRevision) || 0;
        if (knownRevision <= 0) continue;
        if (isLocalDirty(localInfo)) {
            plan.conflicts.push({ relativePath, reason: 'server_metadata_removed_after_local_edit', type: 'metadata', serverFile: serverFiles.get(relativePath) || null, clientNote: localNote });
            continue;
        }
        plan.deleteLocalFiles.push({ relativePath, reason: 'server_metadata_removed', note: localNote, serverFile: serverFiles.get(relativePath) || null });
    }

    return plan;
}

async function createSyncPlan(args: any = {}) {
    const { native, storagePath, serverUrl, token, clientId } = syncConfig(args);
    const { metadata } = await loadStorage(native, storagePath);
    const syncState = await readSyncState(native, storagePath);
    const syncHistoryExists = hasSyncHistory(syncState);
    const knownFiles = syncHistoryExists ? await buildKnownFiles(native, storagePath, metadata, syncState) : [];
    const knownAttachments = syncHistoryExists ? await buildKnownAttachments(native, storagePath, metadata, syncState) : [];
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
        await reconcilePlanWithServerMetadata(native, storagePath, metadata, syncState, response),
        syncState
    );
    return { ok: true, ...response, summary: summarizePlan(response.plan) };
}

async function uploadLocalFile(args: any = {}, relativePathOverride = '') {
    const { native, storagePath, serverUrl, token, clientId } = syncConfig(args);
    const { metadata } = await loadStorage(native, storagePath);
    const syncState = await readSyncState(native, storagePath);
    const payloadNote = args.note || null;
    const note = findMetadataNote(metadata, relativePathOverride || args.relativePath, payloadNote);
    const relativePath = normalizeRelativePath(relativePathOverride || args.relativePath || note?.relativePath || relativePathForNote(payloadNote));
    const fileState = syncState.files?.[relativePath] || {};
    const deleted = isDeletedFlag(args.deleted);
    const lastKnownRevision = Number(args.lastKnownRevision) || Number(fileState.lastKnownRevision) || 0;
    if (deleted && lastKnownRevision <= 0) {
        throw new Error('서버 파일 삭제에는 lastKnownRevision이 필요합니다.');
    }
    const body: any = {
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
        const file = await native.readFile({ storagePath, relativePath });
        if (!file?.localExists) throw new Error('동기화할 로컬 파일을 찾지 못했습니다.');
        body.content = file.contentBase64 || encodeUtf8Base64(file.content || '');
        body.contentEncoding = 'base64';
        body.contentHash = file.contentHash;
        body.updatedAtMs = Number(note?.updatedAtMs) || Number(file.updatedAtMs) || Date.now();
    }

    const response = await syncRequest(serverUrl, '/api/sync/file', { token, body });
    if (response.manifest) await writeSyncStateFromManifest(native, storagePath, response.manifest, syncState);
    return { ok: response.status === 'ok', ...response };
}

async function uploadLocalAttachment(args: any = {}, item: any = {}) {
    const { native, storagePath, serverUrl, token, clientId } = syncConfig(args);
    const { metadata } = await loadStorage(native, storagePath);
    const syncState = await readSyncState(native, storagePath);
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
    const body: any = {
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
        const file = await native.readFile({ storagePath, relativePath });
        if (!file?.localExists) throw new Error('동기화할 첨부 파일을 찾지 못했습니다.');
        body.contentHash = file.contentHash;
        body.updatedAtMs = Number(attachment?.updatedAtMs) || Number(file.updatedAtMs) || Date.now();
        if (item.contentRequired !== false) {
            body.content = file.contentBase64 || encodeUtf8Base64(file.content || '');
            body.contentEncoding = 'base64';
        }
        if (!body.attachment) {
            body.attachment = normalizeAttachmentMetadata({
                fileName: relativePath.split('/').pop() || 'attachment',
                relativePath,
                noteRelativePath,
                size: Number(file.size) || 0,
                contentHash: body.contentHash,
                updatedAtMs: body.updatedAtMs
            }, noteRelativePath);
        } else {
            body.attachment = {
                ...body.attachment,
                contentHash: body.contentHash,
                size: Number(body.attachment.size) || Number(file.size) || 0,
                updatedAtMs: body.updatedAtMs
            };
        }
    }

    const response = await syncRequest(serverUrl, '/api/sync/attachment', { token, body });
    if (response.manifest) await writeSyncStateFromManifest(native, storagePath, response.manifest, syncState);
    return { ok: response.status === 'ok', ...response };
}

async function uploadLocalNoteWithAttachments(args: any = {}) {
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
            if (result.status === 'conflict') attachmentConflicts.push(result.attachment || result.file);
            else uploadedAttachments.push(result.attachment);
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
            if (result.status === 'conflict') attachmentConflicts.push(result.attachment || result.file);
            else uploadedAttachments.push(result.attachment);
        }
    }

    return {
        ...noteResult,
        ok: Boolean(noteResult.ok && attachmentConflicts.length === 0),
        uploadedAttachments,
        attachmentConflicts
    };
}

function encodeRelativePathForUrl(relativePath: string) {
    return normalizeRelativePath(relativePath).split('/').map(encodeURIComponent).join('/');
}

function decodeFilePayloadContent(payload: any = {}) {
    if (isDeletedFlag(payload.deleted)) return '';
    if (payload.contentEncoding === 'base64') return decodeBase64Utf8(payload.content || '');
    return String(payload.content || '');
}

function binaryPayloadAsBase64(payload: any = {}) {
    if (isDeletedFlag(payload.deleted)) return '';
    if (payload.contentEncoding === 'base64') return String(payload.content || '');
    return encodeUtf8Base64(String(payload.content || ''));
}

async function downloadServerFile(args: any = {}, item: any) {
    const { native, storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = await syncRequest(serverUrl, `/api/files/${encodeRelativePathForUrl(relativePath)}`, { token });
    const { notes } = await loadStorage(native, storagePath);

    if (isDeletedFlag(payload.deleted)) {
        await saveStorageNotes(native, storagePath, removeNote(notes, relativePath));
        return { relativePath, deleted: true };
    }

    const content = decodeFilePayloadContent(payload);
    const existing = notes.find((note: any) => note?.relativePath && normalizeRelativePath(note.relativePath) === relativePath);
    const fallbackNote = {
        id: await noteIdFromRelativePath(relativePath),
        icon: 'N',
        title: titleFromMarkdown(content, relativePath.split('/').pop() || 'note.md'),
        tags: [],
        status: 'active',
        workspace: item.workspace?.id || UNFILED_WORKSPACE_ID,
        workspaceName: item.workspace?.name,
        fileName: relativePath.split('/').pop() || 'note.md',
        relativePath,
        updatedAtMs: payload.clientUpdatedAtMs || Date.now()
    };
    const note = {
        ...(existing || {}),
        ...(item.note || fallbackNote),
        body: content,
        relativePath,
        folder: item.note?.folder || item.note?.workspace || item.workspace?.id || existing?.folder || UNFILED_WORKSPACE_ID,
        workspace: item.note?.workspace || item.note?.folder || item.workspace?.id || existing?.workspace || UNFILED_WORKSPACE_ID,
        workspaceName: item.note?.workspaceName || item.workspace?.name || existing?.workspaceName || item.workspace?.id || UNFILED_WORKSPACE_ID
    };
    upsertNote(notes, note);
    await saveStorageNotes(native, storagePath, notes);
    return { relativePath, deleted: false };
}

async function downloadServerAttachment(args: any = {}, item: any) {
    const { native, storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const payload = await syncRequest(serverUrl, `/api/attachments/${encodeRelativePathForUrl(relativePath)}`, { token });
    const { notes } = await loadStorage(native, storagePath);

    if (isDeletedFlag(payload.deleted)) {
        removeAttachmentFromNotes(notes, relativePath);
        await saveStorageNotes(native, storagePath, notes);
        return { relativePath, deleted: true };
    }

    const noteRelativePath = normalizeRelativePath(
        item.noteRelativePath
        || item.attachment?.noteRelativePath
        || payload.noteRelativePath
        || payload.attachment?.noteRelativePath
    );
    let note = notes.find((entry: any) => entry?.relativePath && normalizeRelativePath(entry.relativePath) === noteRelativePath);
    if (!note && item.note) {
        note = { ...item.note, body: item.note.body || '', relativePath: noteRelativePath };
        upsertNote(notes, note);
        await saveStorageNotes(native, storagePath, notes);
    }
    if (!note) throw new Error('첨부 파일을 연결할 노트를 찾지 못했습니다.');

    const attachment = normalizeAttachmentMetadata({
        ...(item.attachment || {}),
        id: item.attachment?.id || payload.attachmentId,
        fileName: item.attachment?.fileName || payload.fileName || relativePath.split('/').pop() || 'attachment',
        relativePath,
        noteRelativePath,
        mimeType: item.attachment?.mimeType || payload.mimeType || null,
        size: Number(payload.size) || null,
        contentHash: payload.contentHash || null,
        updatedAtMs: item.attachment?.updatedAtMs || payload.clientUpdatedAtMs || Date.now()
    }, noteRelativePath);

    const saved = await native.saveAttachment({
        storagePath,
        note,
        noteRelativePath,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        relativePath,
        content: binaryPayloadAsBase64(payload),
        contentEncoding: 'base64',
        id: attachment.id
    });
    return { relativePath, deleted: false, attachment: saved?.attachment || attachment };
}

async function deleteLocalFile(args: any = {}, item: any) {
    const { native, storagePath } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const { notes } = await loadStorage(native, storagePath);
    await saveStorageNotes(native, storagePath, removeNote(notes, relativePath));
    return { relativePath };
}

async function deleteLocalAttachment(args: any = {}, item: any) {
    const { native, storagePath } = syncConfig(args);
    const relativePath = normalizeRelativePath(item.relativePath);
    const { notes } = await loadStorage(native, storagePath);
    removeAttachmentFromNotes(notes, relativePath);
    await saveStorageNotes(native, storagePath, notes);
    return { relativePath };
}

async function readSyncConflictFile(args: any = {}) {
    const { native, storagePath, serverUrl, token } = syncConfig(args);
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
    const { metadata } = await loadStorage(native, storagePath);
    const localNote = findMetadataNote(metadata, relativePath, null);
    const result: any = {
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
        const local = await native.readFile({ storagePath, relativePath });
        result.localExists = Boolean(local?.localExists);
        result.localContent = isAttachment
            ? `첨부 파일\n\n경로: ${relativePath}\n크기: ${local?.size || 0} bytes\nSHA-256: ${local?.contentHash || ''}\n수정: ${new Date(Number(local?.updatedAtMs) || Date.now()).toISOString()}`
            : String(local?.content || '');
    } catch (error: any) {
        result.localError = error?.message || '로컬 파일을 읽지 못했습니다.';
    }

    try {
        const endpoint = isAttachment ? `/api/attachments/${encodeRelativePathForUrl(relativePath)}` : `/api/files/${encodeRelativePathForUrl(relativePath)}`;
        const serverFile = await syncRequest(serverUrl, endpoint, { token });
        result.serverFile = serverFile;
        result.serverContent = isAttachment
            ? `첨부 파일\n\n경로: ${relativePath}\n크기: ${serverFile.size || 0} bytes\nSHA-256: ${serverFile.contentHash || ''}\n수정: ${serverFile.serverUpdatedAt || ''}`
            : decodeFilePayloadContent(serverFile);
    } catch (error: any) {
        result.serverError = error?.message || '서버 파일을 읽지 못했습니다.';
    }

    return result;
}

async function resolveSyncConflict(args: any = {}) {
    const { native, storagePath, serverUrl, token } = syncConfig(args);
    const relativePath = normalizeRelativePath(args.relativePath);
    const resolution = String(args.resolution || '').trim();
    const isAttachment = args.type === 'attachment' || relativePath.includes('/.attachments/');
    if (!['server', 'local'].includes(resolution)) throw new Error('적용할 충돌 버전을 선택하세요.');

    if (resolution === 'server') {
        const previousState = await readSyncState(native, storagePath);
        const file = isAttachment
            ? await downloadServerAttachment(args, {
                relativePath,
                serverAttachment: args.serverAttachment || args.serverFile || null,
                attachment: args.serverAttachmentMetadata || args.serverAttachment || null,
                noteRelativePath: args.noteRelativePath || args.serverAttachmentMetadata?.noteRelativePath || null,
                note: args.serverNote || null,
                workspace: args.serverWorkspace || null
            })
            : await downloadServerFile(args, {
                relativePath,
                serverFile: args.serverFile || null,
                note: args.serverNote || null,
                workspace: args.serverWorkspace || null
            });
        const manifest = await syncRequest(serverUrl, '/api/manifest', { token });
        await writeSyncStateFromManifest(native, storagePath, manifest, previousState);
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

async function runFullSync(args: any = {}) {
    const { native, storagePath } = syncConfig(args);
    const syncState = await readSyncState(native, storagePath);
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

    const operations: any = {
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

    for (const item of plan.downloadFiles || []) operations.downloaded.push(await downloadServerFile(args, item));
    for (const item of plan.downloadAttachments || []) operations.downloadedAttachments.push(await downloadServerAttachment(args, item));
    for (const item of plan.deleteLocalFiles || []) operations.deletedLocal.push(await deleteLocalFile(args, item));
    for (const item of plan.deleteLocalAttachments || []) operations.deletedLocalAttachments.push(await deleteLocalAttachment(args, item));

    for (const item of plan.uploadFiles || []) {
        const result = await uploadLocalFile(args, item.relativePath);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') operations.conflicts.push(result.file);
        else operations.uploaded.push(result.file);
    }

    for (const item of plan.uploadAttachments || []) {
        const result = await uploadLocalAttachment(args, item);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') operations.conflicts.push(result.attachment || result.file);
        else operations.uploadedAttachments.push(result.attachment);
    }

    for (const item of plan.deleteServerFiles || []) {
        const lastKnownRevision = serverDeleteLastKnownRevision(syncState, item, false);
        if (lastKnownRevision <= 0) continue;
        const result = await uploadLocalFile({ ...args, deleted: true, lastKnownRevision }, item.relativePath);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') operations.conflicts.push(result.file);
        else operations.deletedServer.push(result.file);
    }

    for (const item of plan.deleteServerAttachments || []) {
        const lastKnownRevision = serverDeleteLastKnownRevision(syncState, item, true);
        if (lastKnownRevision <= 0) continue;
        const result = await uploadLocalAttachment({ ...args, deleted: true, lastKnownRevision }, item);
        latestManifest = result.manifest || latestManifest;
        if (result.status === 'conflict') operations.conflicts.push(result.attachment || result.file);
        else operations.deletedServerAttachments.push(result.attachment);
    }

    if (operations.conflicts.length === 0 && latestManifest) {
        const previousState = await readSyncState(native, storagePath);
        await writeSyncStateFromManifest(native, storagePath, latestManifest, previousState);
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

function encodeUtf8Base64(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

function decodeBase64Utf8(value: string) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
}

async function sha1(value: string) {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function installAndroidBridge() {
    const native = nativePlugin();
    if (!native || window.notedown) return;

    window.notedown = {
        platform: 'android',
        versions: {
            capacitor: window.Capacitor?.getPlatform?.() || 'android'
        },
        app: {
            preferences: () => native.preferences({}),
            setPreferences: (payload: Record<string, unknown> = {}) => native.setPreferences(payload),
            showWindow: () => native.showWindow({})
        },
        storage: {
            defaultPath: () => native.defaultPath({}),
            chooseDirectory: () => native.defaultPath({}),
            info: (payload: Record<string, unknown> = {}) => native.info(payload),
            initialize: (payload: Record<string, unknown> = {}) => native.initialize(payload),
            loadNotes: (payload: Record<string, unknown> = {}) => native.loadNotes(payload),
            saveNotes: (payload: Record<string, unknown> = {}) => native.saveNotes(payload),
            exportFolderZip: async () => ({ ok: false, error: 'Android에서는 폴더 ZIP 내보내기를 아직 사용할 수 없습니다.' }),
            saveAttachment: (payload: Record<string, unknown> = {}) => native.saveAttachment(payload),
            chooseAttachments: (payload: Record<string, unknown> = {}) => native.chooseAttachments(payload),
            openAttachment: (payload: Record<string, unknown> = {}) => native.openAttachment(payload),
            readFile: (payload: Record<string, unknown> = {}) => native.readFile(payload)
        },
        sync: {
            health: async (payload: any = {}) => {
                try {
                    return { ok: true, ...(await syncRequest(payload.serverUrl, '/api/health')) };
                } catch (error) {
                    return syncError(error, '동기화 서버에 연결하지 못했습니다.');
                }
            },
            setupStatus: async (payload: any = {}) => {
                try {
                    return { ok: true, ...(await syncRequest(payload.serverUrl, '/api/setup/status')) };
                } catch (error) {
                    return syncError(error, '동기화 서버 설정 상태를 확인하지 못했습니다.');
                }
            },
            setup: async (payload: any = {}) => {
                try {
                    const data = await syncRequest(payload.serverUrl, '/api/setup', {
                        body: {
                            username: payload.username,
                            password: payload.password,
                            clientId: payload.clientId || 'notedown-android'
                        }
                    });
                    return { ok: true, ...data };
                } catch (error) {
                    return syncError(error, '동기화 서버 초기 설정에 실패했습니다.');
                }
            },
            login: async (payload: any = {}) => {
                try {
                    const data = await syncRequest(payload.serverUrl, '/api/login', {
                        body: {
                            username: payload.username,
                            password: payload.password,
                            clientId: payload.clientId || 'notedown-android'
                        }
                    });
                    return { ok: true, ...data };
                } catch (error) {
                    return syncError(error, '동기화 서버 로그인에 실패했습니다.');
                }
            },
            plan: async (payload: any = {}) => {
                try {
                    return await createSyncPlan(payload);
                } catch (error) {
                    return syncError(error, '동기화 계획을 만들지 못했습니다.');
                }
            },
            runFull: async (payload: any = {}) => {
                try {
                    return await runFullSync(payload);
                } catch (error) {
                    return syncError(error, '전체 동기화에 실패했습니다.');
                }
            },
            uploadNote: async (payload: any = {}) => {
                try {
                    return await uploadLocalNoteWithAttachments(payload);
                } catch (error) {
                    return syncError(error, '문서 동기화에 실패했습니다.');
                }
            },
            readFile: async (payload: any = {}) => {
                try {
                    return await readSyncConflictFile(payload);
                } catch (error) {
                    return syncError(error, '충돌 파일을 읽지 못했습니다.');
                }
            },
            resolveConflict: async (payload: any = {}) => {
                try {
                    return await resolveSyncConflict(payload);
                } catch (error) {
                    return syncError(error, '충돌을 적용하지 못했습니다.');
                }
            }
        },
        pdf: {
            saveNote: async (payload: Record<string, unknown> = {}) => {
                const html = payload.html;
                if (typeof html === 'string' && native.preparePdf) {
                    if (native.ensurePdfNotificationPermission) {
                        await native.ensurePdfNotificationPermission().catch(() => null);
                    }
                    const prepared = await native.preparePdf({ html });
                    if (!prepared?.ok) return prepared;
                    return native.savePdf({
                        title: payload.title,
                        exportMode: payload.exportMode,
                        storagePath: payload.storagePath,
                        attachments: payload.attachments,
                        token: prepared.token,
                        bytes: prepared.bytes,
                        pages: prepared.pages
                    });
                }

                return native.savePdf(payload);
            }
        }
    };
}

installAndroidBridge();

export {};
