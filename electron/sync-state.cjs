'use strict';

const LOCAL_STORAGE_CHANGED_REASON = 'local_storage_changed_during_sync';
const LOCAL_DELETE_CONFLICT_REASONS = new Set([
    'server_file_changed_after_client_delete',
    'server_attachment_changed_after_client_delete'
]);

function isDeletedFlag(value) {
    return value === true || value === 'true';
}

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
        const value = key === 'storagePath'
            ? (previous[key] ?? entry[key])
            : (entry[key] ?? previous[key]);
        if (value !== undefined && value !== null && value !== '') next[key] = value;
    }
    if (previous.rebaseConflict === true) {
        next.rebaseConflict = true;
        next.lastKnownRevision = 0;
    }
    if (previous.pendingDelete === true && next.deleted !== true) {
        next.pendingDelete = true;
        next.lastKnownRevision = Number(previous.lastKnownRevision) || 0;
        next.contentHash = previous.contentHash || null;
    }
    if (Array.isArray(previous.syncIdentityAliases) && previous.syncIdentityAliases.length > 0) {
        next.syncIdentityAliases = [...new Set(
            previous.syncIdentityAliases.map(value => String(value || '').trim()).filter(Boolean)
        )];
    }
    return next;
}

function syncStateFromManifest(currentState = {}, manifest, previousState = {}, options = {}) {
    if (!manifest) return { state: previousState, shouldWrite: false };

    const currentRevision = Number(currentState.serverRevision) || 0;
    const manifestRevision = Number(manifest.serverRevision) || 0;
    const allowServerRevisionReset = options.allowServerRevisionReset === true;
    if (!allowServerRevisionReset && currentRevision > 0 && manifestRevision <= 0) {
        return { state: currentState, shouldWrite: false };
    }
    if (!allowServerRevisionReset && manifestRevision > 0 && manifestRevision < currentRevision) {
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

    const preserveState = options.preserveState && typeof options.preserveState === 'object'
        ? options.preserveState
        : previousState && typeof previousState === 'object'
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

    const clearRebaseConflictPaths = new Set(
        Array.isArray(options.clearRebaseConflictPaths)
            ? options.clearRebaseConflictPaths.map(value => String(value || '')).filter(Boolean)
            : []
    );
    for (const relativePath of clearRebaseConflictPaths) {
        const file = files[relativePath];
        if (file) {
            delete file.rebaseConflict;
            const manifestFile = (manifest.files || []).find(entry => entry?.relativePath === relativePath);
            file.lastKnownRevision = Number(manifestFile?.revision) || file.lastKnownRevision || 0;
        }
        const attachment = attachments[relativePath];
        if (attachment) {
            delete attachment.rebaseConflict;
            const manifestAttachment = (manifest.attachments || []).find(
                entry => entry?.relativePath === relativePath
            );
            attachment.lastKnownRevision = Number(manifestAttachment?.revision)
                || attachment.lastKnownRevision
                || 0;
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

function isPendingSyncDeleteIntent(state = {}) {
    return state.pendingDelete === true
        && state.deleted !== true
        && state.deleted !== 'true';
}

function isPendingSyncDeleteState(state = {}) {
    return isPendingSyncDeleteIntent(state)
        && Number(state.lastKnownRevision) > 0;
}

function syncLocalMetadataFingerprint(value = {}, attachment = false) {
    const fields = attachment
        ? [
            'id',
            'fileName',
            'relativePath',
            'noteRelativePath',
            'contentHash',
            'size',
            'mimeType',
            'updatedAtMs'
        ]
        : [
            'id',
            'title',
            'icon',
            'tags',
            'status',
            'workspace',
            'workspaceName',
            'folder',
            'fileName',
            'relativePath',
            'storagePath',
            'updatedAtMs'
        ];
    return JSON.stringify(fields.map(field => {
        const fieldValue = value?.[field];
        return Array.isArray(fieldValue) ? fieldValue : (fieldValue ?? null);
    }));
}

function syncManifestEntryChanged(previous = {}, remote = {}) {
    if (Number(previous.lastKnownRevision) <= 0) return true;
    return Number(previous.lastKnownRevision) !== (Number(remote.revision) || 0)
        || String(previous.contentHash || '') !== String(remote.contentHash || '')
        || isDeletedFlag(previous.deleted) !== isDeletedFlag(remote.deleted);
}

function shouldPreserveLocalSyncEntry(previous, remote, local = {}, attachment = false) {
    if (!syncManifestEntryChanged(previous, remote)) return false;
    if (!previous || Number(previous.lastKnownRevision) <= 0) return local.exists === true;
    if (isPendingSyncDeleteIntent(previous) || previous.rebaseConflict === true) return true;
    if (local.exists !== true) return false;
    if (isDeletedFlag(previous.deleted)) return true;
    if (
        previous.contentHash
        && local.contentHash
        && String(previous.contentHash) !== String(local.contentHash)
    ) {
        return true;
    }
    const localMetadataHash = syncLocalMetadataFingerprint(local.metadata, attachment);
    if (
        previous.localMetadataHash
        && previous.localMetadataHash !== localMetadataHash
    ) {
        return true;
    }
    const previousUpdatedAtMs = Number(previous.updatedAtMs) || 0;
    const localUpdatedAtMs = Number(local.updatedAtMs || local.metadata?.updatedAtMs) || 0;
    return !previous.localMetadataHash
        && previousUpdatedAtMs > 0
        && localUpdatedAtMs > 0
        && previousUpdatedAtMs !== localUpdatedAtMs;
}

function updateSyncEntryLocalMetadataHash(entry, previous, metadata, attachment = false, accepted = false) {
    if (!entry || !metadata) return entry;
    const fingerprint = syncLocalMetadataFingerprint(metadata, attachment);
    const previousFingerprint = previous?.localMetadataHash || '';
    const previousUpdatedAtMs = Number(previous?.updatedAtMs) || 0;
    const localUpdatedAtMs = Number(metadata.updatedAtMs) || 0;
    const metadataWasLocallyChanged = previousFingerprint
        ? previousFingerprint !== fingerprint
        : previousUpdatedAtMs > 0
            && localUpdatedAtMs > 0
            && previousUpdatedAtMs !== localUpdatedAtMs;
    if (accepted || !metadataWasLocallyChanged) entry.localMetadataHash = fingerprint;
    else if (previousFingerprint) entry.localMetadataHash = previousFingerprint;
    return entry;
}

function syncMetadataFieldsMatch(expected, actual, fields) {
    if (!expected) return true;
    if (!actual || typeof actual !== 'object') return false;
    for (const field of fields) {
        const expectedValue = expected[field];
        if (expectedValue === undefined || expectedValue === null || expectedValue === '') continue;
        const actualValue = actual[field];
        if (Array.isArray(expectedValue)) {
            if (JSON.stringify(expectedValue) !== JSON.stringify(actualValue || [])) return false;
            continue;
        }
        if (String(actualValue ?? '') !== String(expectedValue)) return false;
    }
    return true;
}

function syncUploadMetadataAcknowledged(body = {}, entry = {}, attachment = false) {
    const expectedUpdatedAtMs = Number(
        body.updatedAtMs
        || (attachment ? body.attachment?.updatedAtMs : body.note?.updatedAtMs)
    ) || 0;
    const actualUpdatedAtMs = Number(
        entry.clientUpdatedAtMs
        || (attachment ? entry.attachment?.updatedAtMs : entry.note?.updatedAtMs)
    ) || 0;
    if (expectedUpdatedAtMs > 0 && actualUpdatedAtMs > 0) {
        return expectedUpdatedAtMs === actualUpdatedAtMs;
    }
    if (attachment) {
        if (body.attachment && !entry.attachment) return false;
        return syncMetadataFieldsMatch(
            body.attachment,
            entry.attachment,
            [
                'id',
                'fileName',
                'relativePath',
                'noteRelativePath',
                'contentHash',
                'size',
                'mimeType',
                'updatedAtMs'
            ]
        );
    }
    if (body.note && !entry.note) return false;
    return syncMetadataFieldsMatch(
        body.note,
        entry.note,
        [
            'id',
            'title',
            'icon',
            'tags',
            'status',
            'workspace',
            'workspaceName',
            'folder',
            'fileName',
            'relativePath',
            'storagePath',
            'updatedAtMs'
        ]
    );
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
    if (entry.contentHash !== body.contentHash) return null;
    return syncUploadMetadataAcknowledged(body, entry, attachments) ? entry : null;
}

function clearAcknowledgedSyncMutations(state = {}, manifest = {}) {
    const remaining = {};
    for (const [key, mutation] of Object.entries(state.uncertainMutations || {})) {
        if (!acknowledgedSyncUploadEntry(mutation?.body, mutation?.endpoint, manifest)) {
            remaining[key] = mutation;
        }
    }
    if (Object.keys(remaining).length > 0) state.uncertainMutations = remaining;
    else delete state.uncertainMutations;
    return state;
}

module.exports = {
    LOCAL_STORAGE_CHANGED_REASON,
    acknowledgedSyncUploadEntry,
    clearAcknowledgedSyncMutations,
    isLocalDeleteConflict,
    isLocalStorageChangedResult,
    isPendingSyncDeleteIntent,
    isPendingSyncDeleteState,
    manifestEntryState,
    markLocalDeleteConflict,
    shouldPreserveLocalSyncEntry,
    syncLocalMetadataFingerprint,
    syncManifestEntryChanged,
    syncUploadMetadataAcknowledged,
    syncStateFromManifest,
    updateSyncEntryLocalMetadataHash
};
