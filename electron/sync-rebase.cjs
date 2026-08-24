'use strict';

function normalizeIdentityPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isDeletedEntry(entry = {}) {
    return entry.deleted === true || entry.deleted === 'true';
}

function shouldRebaseServerRevision(syncState = {}, manifest = {}) {
    if (!Object.prototype.hasOwnProperty.call(manifest || {}, 'serverRevision')) return false;
    const localRevision = Number(syncState.serverRevision) || 0;
    const serverRevision = Number(manifest.serverRevision) || 0;
    return localRevision > 0 && serverRevision < localRevision;
}

function syncIdentityEntry(value = {}, attachment = false) {
    const entry = value || {};
    return {
        relativePath: normalizeIdentityPath(entry.relativePath),
        id: String(
            attachment
                ? (entry.attachmentId || entry.attachment?.id || entry.id || '')
                : (entry.noteId || entry.note?.id || entry.id || '')
        ).trim(),
        storagePath: normalizeIdentityPath(entry.storagePath),
        contentHash: String(entry.contentHash || '').trim(),
        deleted: isDeletedEntry(entry)
    };
}

function findPendingDeleteIdentity(value = {}, pendingEntries = [], attachment = false) {
    const requested = syncIdentityEntry(value, attachment);
    if (requested.id) {
        const aliasMatches = pendingEntries.filter(entry => {
            const candidate = syncIdentityEntry(entry, attachment);
            const aliases = Array.isArray(entry?.syncIdentityAliases)
                ? entry.syncIdentityAliases.map(alias => String(alias || '').trim()).filter(Boolean)
                : [];
            return candidate.id === requested.id || aliases.includes(requested.id);
        });
        if (aliasMatches.length === 1) return aliasMatches[0];
    }
    return matchSyncIdentityEntries(
        [{ ...value, ...(attachment ? { attachmentIdentity: true } : {}) }],
        pendingEntries
    ).matches[0]?.remote || null;
}

function matchSyncIdentityEntries(localEntries = [], remoteEntries = []) {
    const local = localEntries.map((value, index) => ({
        value,
        index,
        identity: syncIdentityEntry(value, Boolean(value?.attachmentIdentity))
    }));
    const remote = remoteEntries.map((value, index) => ({
        value,
        index,
        identity: syncIdentityEntry(value, Boolean(value?.attachmentIdentity))
    }));
    const unmatchedLocal = new Set(local.map(item => item.index));
    const unmatchedRemote = new Set(remote.map(item => item.index));
    const matches = [];

    const matchUnique = (key, allowDeleted, reason) => {
        const localByValue = new Map();
        const remoteByValue = new Map();
        for (const item of local) {
            if (!unmatchedLocal.has(item.index)) continue;
            const identityValue = item.identity[key];
            if (!identityValue) continue;
            const values = localByValue.get(identityValue) || [];
            values.push(item);
            localByValue.set(identityValue, values);
        }
        for (const item of remote) {
            if (!unmatchedRemote.has(item.index)) continue;
            if (!allowDeleted && item.identity.deleted) continue;
            const identityValue = item.identity[key];
            if (!identityValue) continue;
            const values = remoteByValue.get(identityValue) || [];
            values.push(item);
            remoteByValue.set(identityValue, values);
        }

        for (const [identityValue, localMatches] of localByValue.entries()) {
            const remoteMatches = remoteByValue.get(identityValue) || [];
            if (localMatches.length !== 1 || remoteMatches.length !== 1) continue;
            const localItem = localMatches[0];
            const remoteItem = remoteMatches[0];
            if (!unmatchedLocal.has(localItem.index) || !unmatchedRemote.has(remoteItem.index)) continue;
            unmatchedLocal.delete(localItem.index);
            unmatchedRemote.delete(remoteItem.index);
            matches.push({ local: localItem.value, remote: remoteItem.value, reason });
        }
    };

    matchUnique('relativePath', true, 'relativePath');
    matchUnique('id', true, 'id');
    matchUnique('storagePath', false, 'storagePath');
    matchUnique('contentHash', false, 'contentHash');

    return {
        matches,
        unmatchedLocal: local.filter(item => unmatchedLocal.has(item.index)).map(item => item.value),
        unmatchedRemote: remote.filter(item => unmatchedRemote.has(item.index)).map(item => item.value)
    };
}

function rebaseMetadataRelativePaths(metadata, noteMatches = [], attachmentMatches = []) {
    const next = JSON.parse(JSON.stringify(metadata || {}));
    const noteMatchesByPath = new Map(noteMatches.map(match => [
        normalizeIdentityPath(match.local.relativePath),
        match
    ]));
    const attachmentMatchesByPath = new Map(attachmentMatches.map(match => [
        normalizeIdentityPath(match.local.relativePath),
        match
    ]));
    let changed = false;

    for (const note of next.notes || []) {
        if (!note?.relativePath) continue;
        const previousRelativePath = normalizeIdentityPath(note.relativePath);
        const noteMatch = noteMatchesByPath.get(previousRelativePath);
        const nextRelativePath = noteMatch?.remote?.relativePath
            ? normalizeIdentityPath(noteMatch.remote.relativePath)
            : previousRelativePath;
        if (nextRelativePath !== previousRelativePath) changed = true;
        note.relativePath = nextRelativePath;
        const remoteNoteId = String(noteMatch?.remote?.noteId || noteMatch?.remote?.note?.id || '').trim();
        const localNoteId = String(note.id || '').trim();
        if (remoteNoteId && remoteNoteId !== localNoteId) {
            note.syncIdentityAliases = [...new Set([
                ...(Array.isArray(note.syncIdentityAliases) ? note.syncIdentityAliases : []),
                localNoteId
            ].map(value => String(value || '').trim()).filter(Boolean))];
            note.id = remoteNoteId;
            changed = true;
        }

        for (const attachment of note.attachments || []) {
            if (!attachment?.relativePath) continue;
            const previousAttachmentPath = normalizeIdentityPath(attachment.relativePath);
            const attachmentMatch = attachmentMatchesByPath.get(previousAttachmentPath);
            const nextAttachmentPath = attachmentMatch?.remote?.relativePath
                ? normalizeIdentityPath(attachmentMatch.remote.relativePath)
                : previousAttachmentPath;
            if (nextAttachmentPath !== previousAttachmentPath) changed = true;
            attachment.relativePath = nextAttachmentPath;
            const remoteAttachmentId = String(
                attachmentMatch?.remote?.attachmentId
                || attachmentMatch?.remote?.attachment?.id
                || ''
            ).trim();
            const localAttachmentId = String(attachment.id || attachment.attachmentId || '').trim();
            if (remoteAttachmentId && remoteAttachmentId !== localAttachmentId) {
                attachment.syncIdentityAliases = [...new Set([
                    ...(Array.isArray(attachment.syncIdentityAliases)
                        ? attachment.syncIdentityAliases
                        : []),
                    localAttachmentId
                ].map(value => String(value || '').trim()).filter(Boolean))];
                attachment.id = remoteAttachmentId;
                changed = true;
            }
            if (normalizeIdentityPath(attachment.noteRelativePath) !== nextRelativePath) changed = true;
            attachment.noteRelativePath = nextRelativePath;
        }
    }

    return { metadata: next, changed };
}

function applyLocalIdentityDetailsToRebasedState(state, noteMatches = [], attachmentMatches = []) {
    const rebasedNotePaths = new Map(noteMatches
        .filter(match => match?.local?.relativePath && match?.remote?.relativePath)
        .map(match => [
            normalizeIdentityPath(match.local.relativePath),
            normalizeIdentityPath(match.remote.relativePath)
        ]));
    for (const match of noteMatches) {
        const relativePath = normalizeIdentityPath(match.remote.relativePath);
        const entry = state.files?.[relativePath];
        if (!entry) continue;
        entry.storagePath = normalizeIdentityPath(match.local.storagePath || relativePath);
        const noteId = String(match.remote.noteId || match.remote.note?.id || match.local.id || '').trim();
        if (noteId) entry.noteId = noteId;
        if (
            match.local.contentHash
            && match.remote.contentHash
            && String(match.local.contentHash) !== String(match.remote.contentHash)
        ) {
            entry.lastKnownRevision = 0;
            entry.rebaseConflict = true;
        }
    }
    for (const match of attachmentMatches) {
        const relativePath = normalizeIdentityPath(match.remote.relativePath);
        const entry = state.attachments?.[relativePath];
        if (!entry) continue;
        entry.storagePath = normalizeIdentityPath(match.local.storagePath || relativePath);
        const attachmentId = String(
            match.remote.attachmentId || match.remote.attachment?.id || match.local.id || ''
        ).trim();
        if (attachmentId) entry.attachmentId = attachmentId;
        if (
            match.local.contentHash
            && match.remote.contentHash
            && String(match.local.contentHash) !== String(match.remote.contentHash)
        ) {
            entry.lastKnownRevision = 0;
            entry.rebaseConflict = true;
        }
        const localNoteRelativePath = normalizeIdentityPath(match.local.noteRelativePath);
        const noteRelativePath = match.remote.noteRelativePath
            || rebasedNotePaths.get(localNoteRelativePath)
            || localNoteRelativePath;
        if (noteRelativePath) entry.noteRelativePath = normalizeIdentityPath(noteRelativePath);
    }
    return state;
}

function mergeDuplicateAttachments(canonicalNote, newestNote, canonicalRelativePath) {
    const merged = [];
    const seen = new Set();
    for (const attachment of [
        ...(newestNote?.attachments || []),
        ...(canonicalNote?.attachments || [])
    ]) {
        if (!attachment?.relativePath) continue;
        const identity = String(attachment.id || attachment.attachmentId || '').trim()
            || normalizeIdentityPath(attachment.relativePath);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        merged.push({ ...attachment, noteRelativePath: canonicalRelativePath });
    }
    return merged;
}

function consolidateDuplicateMetadataStoragePaths(metadata, syncState = {}, manifest = {}) {
    const next = JSON.parse(JSON.stringify(metadata || {}));
    const notes = Array.isArray(next.notes) ? next.notes : [];
    const manifestFiles = new Map(
        (manifest.files || [])
            .filter(file => file?.relativePath)
            .map(file => [normalizeIdentityPath(file.relativePath), file])
    );
    const statePaths = new Set(Object.keys(syncState.files || {}).map(normalizeIdentityPath));
    const groups = new Map();
    for (const note of notes) {
        if (!note?.relativePath) continue;
        const storagePath = normalizeIdentityPath(note.storagePath || note.relativePath);
        const group = groups.get(storagePath) || [];
        group.push(note);
        groups.set(storagePath, group);
    }

    const replacements = new Map();
    const removed = new Set();
    let consolidated = 0;
    let unresolved = 0;
    for (const group of groups.values()) {
        if (group.length <= 1) continue;
        const scored = group.map(note => {
            const relativePath = normalizeIdentityPath(note.relativePath);
            const manifestFile = manifestFiles.get(relativePath);
            return {
                note,
                score: (manifestFile ? 4 : 0)
                    + (statePaths.has(relativePath) ? 2 : 0)
                    + (
                        manifestFile?.note?.id
                        && note.id
                        && String(manifestFile.note.id) === String(note.id)
                            ? 1
                            : 0
                    )
            };
        }).sort((left, right) => right.score - left.score);
        const topScore = scored[0]?.score || 0;
        const top = scored.filter(item => item.score === topScore);
        if (topScore <= 0 || top.length !== 1) {
            unresolved++;
            continue;
        }

        const canonical = top[0].note;
        const newest = [...group].sort(
            (left, right) => (Number(right.updatedAtMs) || 0) - (Number(left.updatedAtMs) || 0)
        )[0];
        const canonicalRelativePath = normalizeIdentityPath(canonical.relativePath);
        replacements.set(canonical, {
            ...canonical,
            ...newest,
            id: canonical.id,
            relativePath: canonicalRelativePath,
            storagePath: normalizeIdentityPath(canonical.storagePath || canonical.relativePath),
            attachments: mergeDuplicateAttachments(canonical, newest, canonicalRelativePath)
        });
        for (const note of group) {
            if (note !== canonical) removed.add(note);
        }
        consolidated++;
    }

    if (consolidated > 0) {
        next.notes = notes
            .filter(note => !removed.has(note))
            .map(note => replacements.get(note) || note);
    }
    return {
        metadata: next,
        changed: consolidated > 0,
        consolidated,
        unresolved
    };
}

module.exports = {
    applyLocalIdentityDetailsToRebasedState,
    consolidateDuplicateMetadataStoragePaths,
    findPendingDeleteIdentity,
    isDeletedEntry,
    matchSyncIdentityEntries,
    normalizeIdentityPath,
    rebaseMetadataRelativePaths,
    shouldRebaseServerRevision,
    syncIdentityEntry
};
