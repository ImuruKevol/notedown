'use strict';

function normalizedOptional(value, normalizeRelativePath) {
    return value ? normalizeRelativePath(value) : '';
}

function putPreviousIdentity(map, key, value, message) {
    if (!key) return;
    const previous = map.get(key);
    if (previous && previous !== value) throw new Error(`${message}: ${key}`);
    map.set(key, value);
}

function indexPreviousNoteIdentities(previousNotes = [], normalizeRelativePath) {
    const byId = new Map();
    const byRelativePath = new Map();
    const byStoragePath = new Map();

    for (const note of previousNotes || []) {
        if (!note) continue;
        const id = String(note.id || '').trim();
        const relativePath = normalizedOptional(note.relativePath, normalizeRelativePath);
        const storagePath = normalizedOptional(note.storagePath || relativePath, normalizeRelativePath);

        putPreviousIdentity(byId, id, note, '기존 메타데이터에 중복 노트 ID가 있습니다');
        putPreviousIdentity(byRelativePath, relativePath, note, '기존 메타데이터에 중복 노트 경로가 있습니다');
        putPreviousIdentity(byStoragePath, storagePath, note, '기존 메타데이터에 중복 실제 노트 경로가 있습니다');
    }
    return { byId, byRelativePath, byStoragePath };
}

function indexPreviousAttachmentIdentities(previousNotes = [], normalizeRelativePath) {
    const byId = new Map();
    const byRelativePath = new Map();
    const byStoragePath = new Map();
    const all = [];

    for (const note of previousNotes || []) {
        const noteRelativePath = normalizedOptional(note?.relativePath, normalizeRelativePath);
        for (const attachment of note?.attachments || []) {
            if (!attachment) continue;
            const relativePath = normalizedOptional(attachment.relativePath, normalizeRelativePath);
            if (!relativePath) continue;
            const identity = {
                attachment,
                note,
                id: String(attachment.id || attachment.attachmentId || '').trim(),
                relativePath,
                storagePath: normalizedOptional(attachment.storagePath || relativePath, normalizeRelativePath),
                noteRelativePath: normalizedOptional(attachment.noteRelativePath || noteRelativePath, normalizeRelativePath)
            };
            putPreviousIdentity(byId, identity.id, identity, '기존 메타데이터에 중복 첨부 ID가 있습니다');
            putPreviousIdentity(byRelativePath, identity.relativePath, identity, '기존 메타데이터에 중복 첨부 경로가 있습니다');
            putPreviousIdentity(byStoragePath, identity.storagePath, identity, '기존 메타데이터에 중복 실제 첨부 경로가 있습니다');
            all.push(identity);
        }
    }
    return { byId, byRelativePath, byStoragePath, all };
}

function prepareAttachmentStorageIdentities(
    attachments,
    noteRelativePath,
    existingNote,
    previousAttachments,
    deletedAttachments,
    consumedDeletedAttachments,
    seen,
    noteStoragePaths,
    normalizeRelativePath
) {
    const matchedExisting = new Set();
    const prepared = (attachments || []).map(attachment => {
        const requestedRelativePath = normalizedOptional(attachment?.relativePath, normalizeRelativePath);
        if (!requestedRelativePath) throw new Error('첨부 경로가 비어 있습니다.');
        const requestedId = String(attachment?.id || attachment?.attachmentId || '').trim();
        const existingById = requestedId ? previousAttachments.byId.get(requestedId) || null : null;
        const existingByRelativePath = previousAttachments.byRelativePath.get(requestedRelativePath) || null;

        if (existingById && existingByRelativePath && existingById !== existingByRelativePath) {
            throw new Error(`첨부 ID와 경로가 서로 다른 기존 첨부를 가리킵니다: ${requestedRelativePath}`);
        }
        if (existingById && existingById.relativePath !== requestedRelativePath) {
            throw new Error(`첨부 ID가 다른 경로에 연결되어 있습니다: ${requestedId}`);
        }
        if (
            existingByRelativePath
            && requestedId
            && existingByRelativePath.id
            && existingByRelativePath.id !== requestedId
        ) {
            throw new Error(`첨부 경로가 다른 ID에 연결되어 있습니다: ${requestedRelativePath}`);
        }

        const existing = existingById || existingByRelativePath;
        if (existing && existing.note !== existingNote) {
            throw new Error(`첨부가 다른 노트에 연결되어 있습니다: ${requestedRelativePath}`);
        }
        if (existing && deletedAttachments.has(existing)) {
            throw new Error(`삭제 대상으로 지정한 첨부가 요청에 남아 있습니다: ${requestedRelativePath}`);
        }
        if (existing) matchedExisting.add(existing);

        const id = requestedId || existing?.id || '';
        const requestedStoragePath = normalizedOptional(attachment?.storagePath, normalizeRelativePath);
        const existingStoragePath = existing?.storagePath || '';
        if (existing && requestedStoragePath && existingStoragePath && requestedStoragePath !== existingStoragePath) {
            throw new Error(`첨부 실제 저장 경로가 기존 메타데이터와 다릅니다: ${requestedRelativePath}`);
        }
        const storagePath = existingStoragePath || requestedStoragePath || requestedRelativePath;
        const storageOwner = previousAttachments.byStoragePath.get(storagePath) || null;
        if (storageOwner && storageOwner !== existing) {
            throw new Error(`첨부 실제 저장 경로가 다른 첨부에 연결되어 있습니다: ${storagePath}`);
        }

        const requestedNoteRelativePath = normalizedOptional(attachment?.noteRelativePath, normalizeRelativePath);
        const existingNoteRelativePath = existing?.noteRelativePath || '';
        if (requestedNoteRelativePath && requestedNoteRelativePath !== noteRelativePath) {
            throw new Error(`첨부가 다른 노트 경로를 가리킵니다: ${requestedRelativePath}`);
        }
        if (existingNoteRelativePath && existingNoteRelativePath !== noteRelativePath) {
            throw new Error(`기존 첨부가 다른 노트 경로에 연결되어 있습니다: ${requestedRelativePath}`);
        }

        registerPreparedAttachmentIdentity(id, requestedRelativePath, storagePath, seen, noteStoragePaths);
        const merged = {
            ...(existing?.attachment || {}),
            ...attachment,
            relativePath: requestedRelativePath,
            storagePath,
            noteRelativePath
        };
        if (id) merged.id = id;
        return merged;
    });

    for (const existing of previousAttachments.all) {
        if (existing.note !== existingNote || matchedExisting.has(existing)) continue;
        if (deletedAttachments.has(existing)) {
            consumedDeletedAttachments.add(existing);
            continue;
        }
        if (existing.noteRelativePath && existing.noteRelativePath !== noteRelativePath) {
            throw new Error(`기존 첨부가 다른 노트 경로에 연결되어 있습니다: ${existing.relativePath}`);
        }
        registerPreparedAttachmentIdentity(
            existing.id,
            existing.relativePath,
            existing.storagePath,
            seen,
            noteStoragePaths
        );
        prepared.push({
            ...existing.attachment,
            ...(existing.id ? { id: existing.id } : {}),
            relativePath: existing.relativePath,
            storagePath: existing.storagePath,
            noteRelativePath
        });
    }
    return prepared;
}

function registerPreparedAttachmentIdentity(id, relativePath, storagePath, seen, noteStoragePaths) {
    if (id && seen.ids.has(id)) throw new Error(`중복 첨부 ID가 있습니다: ${id}`);
    if (seen.relativePaths.has(relativePath)) throw new Error(`중복 첨부 경로가 있습니다: ${relativePath}`);
    if (seen.storagePaths.has(storagePath)) throw new Error(`중복 실제 첨부 경로가 있습니다: ${storagePath}`);
    if (noteStoragePaths.has(storagePath)) {
        throw new Error(`첨부 실제 저장 경로가 노트 파일과 충돌합니다: ${storagePath}`);
    }
    if (id) seen.ids.add(id);
    seen.relativePaths.add(relativePath);
    seen.storagePaths.add(storagePath);
}

function resolveDeletedAttachments(tokens, previousAttachments) {
    const deleted = new Set();
    const seenTokens = new Set();
    for (const rawToken of tokens || []) {
        const token = String(rawToken || '').trim();
        if (!token) continue;
        if (seenTokens.has(token)) throw new Error(`중복 삭제 첨부 ID가 있습니다: ${token}`);
        seenTokens.add(token);
        const byId = previousAttachments.byId.get(token) || null;
        const byRelativePath = previousAttachments.byRelativePath.get(token) || null;
        if (byId && byRelativePath && byId !== byRelativePath) {
            throw new Error(`삭제 첨부 ID가 다른 첨부 경로와 충돌합니다: ${token}`);
        }
        const identity = byId || byRelativePath;
        if (!identity) throw new Error(`삭제할 첨부를 찾을 수 없습니다: ${token}`);
        deleted.add(identity);
    }
    return deleted;
}

function selectMissingPreviousNotes(
    notes = [],
    previousNotes = [],
    deletedNoteIds = [],
    normalizeRelativePath
) {
    if (typeof normalizeRelativePath !== 'function') {
        throw new TypeError('normalizeRelativePath is required');
    }
    const deletedIds = new Set((deletedNoteIds || []).map(id => String(id || '').trim()).filter(Boolean));
    const incomingIds = new Set();
    const incomingRelativePaths = new Set();
    for (const note of notes || []) {
        const id = String(note?.id || '').trim();
        if (id) incomingIds.add(id);
        const relativePath = normalizedOptional(note?.relativePath, normalizeRelativePath);
        if (relativePath) incomingRelativePaths.add(relativePath);
    }

    return (previousNotes || []).filter(note => {
        const id = String(note?.id || '').trim();
        if (id && deletedIds.has(id)) return false;
        if (id && incomingIds.has(id)) return false;
        const relativePath = normalizedOptional(note?.relativePath, normalizeRelativePath);
        return !relativePath || !incomingRelativePaths.has(relativePath);
    });
}

function prepareNoteStorageIdentities(notes = [], previousNotes = [], helpers = {}) {
    const {
        normalizeRelativePath,
        relativePathForNote,
        deletedAttachmentIds = []
    } = helpers;
    if (typeof normalizeRelativePath !== 'function' || typeof relativePathForNote !== 'function') {
        throw new TypeError('note identity helpers are required');
    }

    const previous = indexPreviousNoteIdentities(previousNotes, normalizeRelativePath);
    const previousAttachments = indexPreviousAttachmentIdentities(previousNotes, normalizeRelativePath);
    for (const storagePath of previousAttachments.byStoragePath.keys()) {
        if (previous.byStoragePath.has(storagePath)) {
            throw new Error(`첨부 실제 저장 경로가 노트 파일과 충돌합니다: ${storagePath}`);
        }
    }
    const deletedAttachments = resolveDeletedAttachments(deletedAttachmentIds, previousAttachments);
    const consumedDeletedAttachments = new Set();
    const seenIds = new Set();
    const seenRelativePaths = new Set();
    const seenStoragePaths = new Set();
    const seenAttachments = {
        ids: new Set(),
        relativePaths: new Set(),
        storagePaths: new Set()
    };

    const preparedNotes = (notes || []).map(note => {
        const id = String(note?.id || '').trim();
        if (!id) throw new Error('노트 ID가 비어 있습니다.');
        if (seenIds.has(id)) throw new Error(`중복 노트 ID가 있습니다: ${id}`);

        const requestedRelativePath = normalizeRelativePath(relativePathForNote(note));
        const existingById = previous.byId.get(id) || null;
        const existingByRelativePath = previous.byRelativePath.get(requestedRelativePath) || null;
        if (existingById && existingByRelativePath && existingById !== existingByRelativePath) {
            throw new Error(`노트 ID와 경로가 서로 다른 기존 노트를 가리킵니다: ${requestedRelativePath}`);
        }
        if (existingByRelativePath && String(existingByRelativePath.id || '').trim() !== id) {
            throw new Error(`노트 경로가 다른 ID에 연결되어 있습니다: ${requestedRelativePath}`);
        }
        const existing = existingById || existingByRelativePath;
        const relativePath = existing?.relativePath
            ? normalizeRelativePath(existing.relativePath)
            : requestedRelativePath;
        if (seenRelativePaths.has(relativePath)) {
            throw new Error(`중복 노트 경로가 있습니다: ${relativePath}`);
        }

        const existingStoragePath = normalizedOptional(existing?.storagePath || existing?.relativePath, normalizeRelativePath);
        const requestedStoragePath = normalizedOptional(note?.storagePath, normalizeRelativePath);
        const requestedStorageOwner = requestedStoragePath
            ? previous.byStoragePath.get(requestedStoragePath) || null
            : null;
        if (requestedStorageOwner && requestedStorageOwner !== existing) {
            throw new Error(`노트 실제 저장 경로가 다른 ID에 연결되어 있습니다: ${requestedStoragePath}`);
        }
        const currentStoragePath = existingStoragePath || requestedStoragePath || relativePath;
        if (seenStoragePaths.has(currentStoragePath)) {
            throw new Error(`중복 실제 노트 경로가 있습니다: ${currentStoragePath}`);
        }
        if (
            previousAttachments.byStoragePath.has(currentStoragePath)
            || seenAttachments.storagePaths.has(currentStoragePath)
        ) {
            throw new Error(`노트 실제 저장 경로가 첨부 파일과 충돌합니다: ${currentStoragePath}`);
        }
        const noteStoragePaths = new Set(seenStoragePaths);
        noteStoragePaths.add(currentStoragePath);

        const attachments = prepareAttachmentStorageIdentities(
            Array.isArray(note?.attachments) ? note.attachments : [],
            relativePath,
            existing,
            previousAttachments,
            deletedAttachments,
            consumedDeletedAttachments,
            seenAttachments,
            noteStoragePaths,
            normalizeRelativePath
        );

        seenIds.add(id);
        seenRelativePaths.add(relativePath);
        seenStoragePaths.add(currentStoragePath);
        return {
            note: {
                ...(existing || {}),
                ...note,
                id,
                relativePath,
                storagePath: currentStoragePath,
                attachments
            },
            existing,
            relativePath,
            currentStoragePath
        };
    });

    for (const deletedAttachment of deletedAttachments) {
        if (!consumedDeletedAttachments.has(deletedAttachment)) {
            throw new Error(`삭제 첨부가 현재 노트 소유자와 일치하지 않습니다: ${deletedAttachment.id || deletedAttachment.relativePath}`);
        }
    }
    return preparedNotes;
}

module.exports = {
    indexPreviousNoteIdentities,
    indexPreviousAttachmentIdentities,
    prepareNoteStorageIdentities,
    selectMissingPreviousNotes
};
