'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applyLocalIdentityDetailsToRebasedState,
    consolidateDuplicateMetadataStoragePaths,
    findPendingDeleteIdentity,
    matchSyncIdentityEntries,
    rebaseMetadataRelativePaths,
    shouldRebaseServerRevision,
    syncIdentityEntry
} = require('./sync-rebase.cjs');

test('a confirmed lower server revision requires a safe rebase', () => {
    assert.equal(shouldRebaseServerRevision({ serverRevision: 937 }, { serverRevision: 146 }), true);
    assert.equal(shouldRebaseServerRevision({ serverRevision: 146 }, { serverRevision: 146 }), false);
    assert.equal(shouldRebaseServerRevision({ serverRevision: 146 }, { serverRevision: 147 }), false);
    assert.equal(shouldRebaseServerRevision({ serverRevision: 146 }, {}), false);
});

test('sync identities prefer exact paths and stable ids before physical paths and hashes', () => {
    const local = [
        { key: 'path', relativePath: 'memo/same.md', storagePath: '메모/같음.md', contentHash: 'local-edit' },
        { key: 'id', relativePath: 'memo/new-name.md', id: 'note-2', storagePath: '메모/새 이름.md', contentHash: 'changed' },
        { key: 'storage', relativePath: 'memo/new-3.md', storagePath: '메모/문서 3.md', contentHash: 'changed-3' },
        { key: 'hash', relativePath: 'memo/new-4.md', storagePath: '메모/문서 4.md', contentHash: 'same-hash' }
    ];
    const remote = [
        { key: 'path', relativePath: 'memo/same.md', storagePath: 'remote/path.md', contentHash: 'server-edit' },
        { key: 'id', relativePath: 'memo/note-2.md', note: { id: 'note-2' }, storagePath: 'remote/id.md', contentHash: 'server-id' },
        { key: 'storage', relativePath: 'memo/note-3.md', storagePath: '메모/문서 3.md', contentHash: 'server-storage' },
        { key: 'hash', relativePath: 'memo/note-4.md', storagePath: 'remote/hash.md', contentHash: 'same-hash' }
    ];

    const result = matchSyncIdentityEntries(local, remote);
    assert.deepEqual(
        result.matches.map(match => [match.local.key, match.remote.key, match.reason]),
        [
            ['path', 'path', 'relativePath'],
            ['id', 'id', 'id'],
            ['storage', 'storage', 'storagePath'],
            ['hash', 'hash', 'contentHash']
        ]
    );
    assert.equal(result.unmatchedLocal.length, 0);
    assert.equal(result.unmatchedRemote.length, 0);
});

test('ambiguous hashes and deleted physical-path candidates are not rebound', () => {
    const local = [
        { key: 'left', relativePath: 'local/left.md', storagePath: 'local/left.md', contentHash: 'duplicate' },
        { key: 'right', relativePath: 'local/right.md', storagePath: 'local/right.md', contentHash: 'duplicate' },
        { key: 'deleted', relativePath: 'local/deleted.md', storagePath: 'same/storage.md', contentHash: 'deleted-hash' }
    ];
    const remote = [
        { key: 'remote-left', relativePath: 'server/left.md', contentHash: 'duplicate' },
        { key: 'remote-right', relativePath: 'server/right.md', contentHash: 'duplicate' },
        { key: 'remote-deleted', relativePath: 'server/deleted.md', storagePath: 'same/storage.md', contentHash: 'deleted-hash', deleted: true }
    ];

    const result = matchSyncIdentityEntries(local, remote);
    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatchedLocal.length, 3);
    assert.equal(result.unmatchedRemote.length, 3);
});

test('attachment identity reads canonical attachment ids', () => {
    assert.equal(syncIdentityEntry({ attachmentId: 'att-1' }, true).id, 'att-1');
    assert.equal(syncIdentityEntry({ attachment: { id: 'att-2' } }, true).id, 'att-2');
});

test('pending deletes recover canonical identities from stale UI aliases and physical paths', () => {
    const pendingNotes = [{
        id: 'server-note-id',
        syncIdentityAliases: ['local-note-id'],
        relativePath: 'memo/server-note.md',
        storagePath: '메모/문서.md',
        pendingDelete: true
    }];
    assert.equal(
        findPendingDeleteIdentity({ id: 'local-note-id' }, pendingNotes)?.relativePath,
        'memo/server-note.md'
    );
    assert.equal(
        findPendingDeleteIdentity({ storagePath: '메모/문서.md' }, pendingNotes)?.id,
        'server-note-id'
    );

    const pendingAttachments = [{
        attachmentIdentity: true,
        id: 'server-attachment-id',
        syncIdentityAliases: ['local-attachment-id'],
        relativePath: 'memo/.attachments/server-note/image.png',
        storagePath: '메모/attachments/문서/image.png',
        pendingDelete: true
    }];
    assert.equal(
        findPendingDeleteIdentity(
            { id: 'local-attachment-id' },
            pendingAttachments,
            true
        )?.relativePath,
        'memo/.attachments/server-note/image.png'
    );
});

test('a rebase restores server identities while retaining local paths as UI aliases', () => {
    const metadata = {
        notes: [{
            id: 'local-note-id',
            relativePath: '메모/읽기 쉬운 이름.md',
            storagePath: '메모/읽기 쉬운 이름.md',
            attachments: [{
                id: 'local-attachment-id',
                relativePath: '메모/attachments/읽기 쉬운 이름/image.png',
                storagePath: '메모/attachments/읽기 쉬운 이름/image.png',
                noteRelativePath: '메모/읽기 쉬운 이름.md'
            }]
        }]
    };
    const localNote = {
        id: 'local-note-id',
        relativePath: '메모/읽기 쉬운 이름.md',
        storagePath: '메모/읽기 쉬운 이름.md',
        contentHash: 'local-note-hash'
    };
    const remoteNote = {
        relativePath: 'memo/note-stable.md',
        storagePath: '메모/읽기 쉬운 이름.md',
        contentHash: 'server-note-hash',
        note: { id: 'server-note-id' }
    };
    const localAttachment = {
        attachmentIdentity: true,
        id: 'local-attachment-id',
        relativePath: '메모/attachments/읽기 쉬운 이름/image.png',
        storagePath: '메모/attachments/읽기 쉬운 이름/image.png',
        contentHash: 'local-attachment-hash',
        noteRelativePath: '메모/읽기 쉬운 이름.md'
    };
    const remoteAttachment = {
        attachmentIdentity: true,
        relativePath: 'memo/.attachments/note-stable/image.png',
        storagePath: '메모/attachments/읽기 쉬운 이름/image.png',
        contentHash: 'server-attachment-hash',
        attachmentId: 'server-attachment-id',
        noteRelativePath: 'memo/note-stable.md'
    };
    const noteMatches = [{ local: localNote, remote: remoteNote, reason: 'storagePath' }];
    const attachmentMatches = [{ local: localAttachment, remote: remoteAttachment, reason: 'storagePath' }];

    const rebasedMetadata = rebaseMetadataRelativePaths(metadata, noteMatches, attachmentMatches);
    const note = rebasedMetadata.metadata.notes[0];
    assert.equal(rebasedMetadata.changed, true);
    assert.equal(note.id, 'server-note-id');
    assert.deepEqual(note.syncIdentityAliases, ['local-note-id']);
    assert.equal(note.relativePath, 'memo/note-stable.md');
    assert.equal(note.storagePath, '메모/읽기 쉬운 이름.md');
    assert.equal(note.attachments[0].id, 'server-attachment-id');
    assert.deepEqual(note.attachments[0].syncIdentityAliases, ['local-attachment-id']);
    assert.equal(note.attachments[0].relativePath, 'memo/.attachments/note-stable/image.png');
    assert.equal(note.attachments[0].noteRelativePath, 'memo/note-stable.md');

    const state = {
        files: { 'memo/note-stable.md': { lastKnownRevision: 10, storagePath: 'server/device.md' } },
        attachments: {
            'memo/.attachments/note-stable/image.png': {
                lastKnownRevision: 11,
                storagePath: 'server/device/image.png'
            }
        }
    };
    applyLocalIdentityDetailsToRebasedState(state, noteMatches, attachmentMatches);
    assert.equal(state.files['memo/note-stable.md'].storagePath, '메모/읽기 쉬운 이름.md');
    assert.equal(state.files['memo/note-stable.md'].noteId, 'server-note-id');
    assert.equal(state.files['memo/note-stable.md'].lastKnownRevision, 0);
    assert.equal(state.files['memo/note-stable.md'].rebaseConflict, true);
    assert.equal(
        state.attachments['memo/.attachments/note-stable/image.png'].storagePath,
        '메모/attachments/읽기 쉬운 이름/image.png'
    );
    assert.equal(
        state.attachments['memo/.attachments/note-stable/image.png'].attachmentId,
        'server-attachment-id'
    );
    assert.equal(
        state.attachments['memo/.attachments/note-stable/image.png'].lastKnownRevision,
        0
    );
    assert.equal(
        state.attachments['memo/.attachments/note-stable/image.png'].rebaseConflict,
        true
    );
    assert.equal(
        state.attachments['memo/.attachments/note-stable/image.png'].noteRelativePath,
        'memo/note-stable.md'
    );
});

test('duplicate physical owners consolidate into the canonical server identity without losing newer metadata', () => {
    const canonical = {
        id: 'canonical-id',
        title: 'old title',
        relativePath: 'memo/note-stable.md',
        storagePath: '메모/문서.md',
        updatedAtMs: 10,
        attachments: []
    };
    const duplicate = {
        id: 'duplicate-id',
        title: 'new title',
        relativePath: '메모/문서.md',
        storagePath: '메모/문서.md',
        updatedAtMs: 20,
        tags: ['latest'],
        attachments: []
    };
    const result = consolidateDuplicateMetadataStoragePaths(
        { notes: [duplicate, canonical] },
        { files: { 'memo/note-stable.md': { lastKnownRevision: 7 } } },
        { files: [{ relativePath: 'memo/note-stable.md', note: { id: 'server-id' } }] }
    );

    assert.equal(result.changed, true);
    assert.equal(result.consolidated, 1);
    assert.equal(result.unresolved, 0);
    assert.equal(result.metadata.notes.length, 1);
    assert.equal(result.metadata.notes[0].id, 'canonical-id');
    assert.equal(result.metadata.notes[0].relativePath, 'memo/note-stable.md');
    assert.equal(result.metadata.notes[0].storagePath, '메모/문서.md');
    assert.equal(result.metadata.notes[0].title, 'new title');
    assert.deepEqual(result.metadata.notes[0].tags, ['latest']);
});

test('ambiguous duplicate physical owners are left untouched for manual recovery', () => {
    const result = consolidateDuplicateMetadataStoragePaths({
        notes: [
            { id: 'one', relativePath: 'one.md', storagePath: 'shared.md' },
            { id: 'two', relativePath: 'two.md', storagePath: 'shared.md' }
        ]
    });
    assert.equal(result.changed, false);
    assert.equal(result.unresolved, 1);
    assert.equal(result.metadata.notes.length, 2);
});
