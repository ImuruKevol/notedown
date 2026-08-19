'use strict';

const LOCAL_STORAGE_CHANGED_REASON = 'local_storage_changed_during_sync';
const LOCAL_DELETE_CONFLICT_REASONS = new Set([
    'server_file_changed_after_client_delete',
    'server_attachment_changed_after_client_delete'
]);

function manifestEntryState(entry = {}, previous = {}) {
    const next = {
        lastKnownRevision: Number(entry.revision) || 0,
        contentHash: entry.contentHash || null,
        updatedAtMs: Number(entry.clientUpdatedAtMs) || null,
        deleted: entry.deleted === true || entry.deleted === 'true'
    };
    for (const key of [
        'storagePath',
        'kind',
        'noteRelativePath',
        'noteId',
        'attachmentId',
        'fileName',
        'mimeType'
    ]) {
        const value = entry[key] ?? previous[key];
        if (value !== undefined && value !== null && value !== '') next[key] = value;
    }
    return next;
}

function syncStateFromManifest(currentState = {}, manifest, previousState = {}, options = {}) {
    if (!manifest) return { state: previousState, shouldWrite: false };

    const currentRevision = Number(currentState.serverRevision) || 0;
    const manifestRevision = Number(manifest.serverRevision) || 0;
    if (currentRevision > 0 && manifestRevision <= 0) {
        return { state: currentState, shouldWrite: false };
    }
    if (manifestRevision > 0 && manifestRevision < currentRevision) {
        return { state: currentState, shouldWrite: false };
    }

    const baseState = currentRevision >= (Number(previousState.serverRevision) || 0)
        ? currentState
        : previousState;
    const files = {};
    for (const entry of manifest.files || []) {
        if (!entry?.relativePath) continue;
        files[entry.relativePath] = manifestEntryState(
            entry,
            baseState.files?.[entry.relativePath] || {}
        );
    }
    const attachments = {};
    for (const entry of manifest.attachments || []) {
        if (!entry?.relativePath) continue;
        attachments[entry.relativePath] = manifestEntryState(
            entry,
            baseState.attachments?.[entry.relativePath] || {}
        );
    }

    const preserveState = previousState && typeof previousState === 'object'
        ? previousState
        : baseState;
    const preservePaths = new Set(
        Array.isArray(options.preservePaths)
            ? options.preservePaths.map(value => String(value || '')).filter(Boolean)
            : []
    );
    for (const relativePath of preservePaths) {
        if (Object.prototype.hasOwnProperty.call(preserveState.files || {}, relativePath)) {
            files[relativePath] = { ...preserveState.files[relativePath] };
        } else {
            delete files[relativePath];
        }
        if (Object.prototype.hasOwnProperty.call(preserveState.attachments || {}, relativePath)) {
            attachments[relativePath] = { ...preserveState.attachments[relativePath] };
        } else {
            delete attachments[relativePath];
        }
    }

    const preserveMetadata = options.preserveMetadata === true;

    return {
        shouldWrite: true,
        state: {
            ...baseState,
            serverRevision: manifestRevision,
            metadataRevision: preserveMetadata
                ? Number(preserveState.metadataRevision) || 0
                : Number(manifest.metadata?.revision) || 0,
            metadataHash: preserveMetadata
                ? preserveState.metadataHash || null
                : manifest.metadata?.contentHash || null,
            files,
            attachments,
            updatedAt: new Date().toISOString()
        }
    };
}

function isLocalDeleteConflict(item = {}) {
    return item.localDeleted === true
        || item.clientDeleted === true
        || LOCAL_DELETE_CONFLICT_REASONS.has(String(item.reason || item.status || ''));
}

function markLocalDeleteConflict(item, type = '') {
    if (!item || typeof item !== 'object') return item;
    return {
        ...item,
        ...(type && !item.type ? { type } : {}),
        localDeleted: true,
        clientDeleted: true
    };
}

function isLocalStorageChangedResult(result = {}) {
    return result.reason === LOCAL_STORAGE_CHANGED_REASON
        || result.status === 'retry';
}

function acknowledgedSyncUploadEntry(body = {}, endpoint = '', manifest = {}) {
    const relativePath = String(body.relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!relativePath) return null;
    const attachments = String(endpoint || '').includes('/attachment');
    const entries = attachments ? manifest.attachments : manifest.files;
    const entry = (Array.isArray(entries) ? entries : []).find(item => (
        String(item?.relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') === relativePath
    ));
    if (!entry) return null;

    const expectedDeleted = body.deleted === true || body.deleted === 'true';
    const actualDeleted = entry.deleted === true || entry.deleted === 'true';
    if (expectedDeleted) return actualDeleted ? entry : null;
    if (actualDeleted || !body.contentHash) return null;
    return entry.contentHash === body.contentHash ? entry : null;
}

module.exports = {
    LOCAL_STORAGE_CHANGED_REASON,
    acknowledgedSyncUploadEntry,
    isLocalDeleteConflict,
    isLocalStorageChangedResult,
    manifestEntryState,
    markLocalDeleteConflict,
    syncStateFromManifest
};
