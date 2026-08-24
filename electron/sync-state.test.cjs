'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
    syncStateFromManifest,
    updateSyncEntryLocalMetadataHash
} = require('./sync-state.cjs');

test('a lost upload response is acknowledged only when the manifest proves the mutation', () => {
    const manifest = {
        files: [
            { relativePath: 'memo/saved.md', revision: 5, contentHash: 'saved-hash' },
            { relativePath: 'memo/deleted.md', revision: 6, deleted: true }
        ],
        attachments: [
            { relativePath: 'memo/.attachments/image.png', revision: 7, contentHash: 'image-hash' }
        ]
    };

    assert.equal(
        acknowledgedSyncUploadEntry(
            { relativePath: 'memo/saved.md', contentHash: 'saved-hash' },
            '/api/sync/file',
            manifest
        )?.revision,
        5
    );
    assert.equal(
        acknowledgedSyncUploadEntry(
            { relativePath: 'memo/deleted.md', deleted: true },
            '/api/sync/file',
            manifest
        )?.revision,
        6
    );
    assert.equal(
        acknowledgedSyncUploadEntry(
            { relativePath: 'memo/.attachments/image.png', contentHash: 'wrong-hash' },
            '/api/sync/attachment',
            manifest
        ),
        null
    );

    assert.equal(
        acknowledgedSyncUploadEntry(
            {
                relativePath: 'memo/saved.md',
                contentHash: 'saved-hash',
                note: { id: 'note-1', title: 'renamed title' }
            },
            '/api/sync/file',
            {
                files: [{
                    relativePath: 'memo/saved.md',
                    revision: 5,
                    contentHash: 'saved-hash',
                    note: { id: 'note-1', title: 'old title' }
                }]
            }
        ),
        null
    );

    assert.equal(
        acknowledgedSyncUploadEntry(
            {
                relativePath: 'memo/saved.md',
                contentHash: 'saved-hash',
                updatedAtMs: 1720000000123,
                note: { id: 'note-1', title: 'renamed title' }
            },
            '/api/sync/file',
            {
                files: [{
                    relativePath: 'memo/saved.md',
                    revision: 8,
                    contentHash: 'saved-hash',
                    clientUpdatedAtMs: 1720000000123
                }]
            }
        )?.revision,
        8
    );
    assert.equal(
        acknowledgedSyncUploadEntry(
            {
                relativePath: 'memo/saved.md',
                contentHash: 'saved-hash',
                updatedAtMs: 1720000000123,
                note: { id: 'note-1', title: 'renamed title' }
            },
            '/api/sync/file',
            {
                files: [{
                    relativePath: 'memo/saved.md',
                    revision: 9,
                    contentHash: 'saved-hash',
                    clientUpdatedAtMs: 1720000000000
                }]
            }
        ),
        null
    );
});

test('manifest checkpoints clear only journaled mutations that the server has acknowledged', () => {
    const state = {
        uncertainMutations: {
            'file:memo/saved.md': {
                endpoint: '/api/sync/file',
                body: {
                    relativePath: 'memo/saved.md',
                    contentHash: 'saved-hash',
                    updatedAtMs: 1720000000123,
                    note: { id: 'note-1' }
                }
            },
            'file:memo/pending.md': {
                endpoint: '/api/sync/file',
                body: {
                    relativePath: 'memo/pending.md',
                    contentHash: 'pending-hash',
                    updatedAtMs: 1720000000456,
                    note: { id: 'note-2' }
                }
            }
        }
    };
    clearAcknowledgedSyncMutations(state, {
        files: [{
            relativePath: 'memo/saved.md',
            contentHash: 'saved-hash',
            clientUpdatedAtMs: 1720000000123
        }]
    });
    assert.deepEqual(Object.keys(state.uncertainMutations), ['file:memo/pending.md']);
});

test('an unrelated device checkpoint never adopts a remote revision over a local edit', () => {
    const previous = {
        lastKnownRevision: 5,
        contentHash: 'shared-base',
        updatedAtMs: 100
    };
    const remoteAfterDeviceA = {
        revision: 6,
        contentHash: 'device-a-edit',
        clientUpdatedAtMs: 200
    };
    assert.equal(shouldPreserveLocalSyncEntry(previous, remoteAfterDeviceA, {
        exists: true,
        contentHash: 'device-b-edit',
        updatedAtMs: 300,
        metadata: { id: 'note-1', title: 'Device B', updatedAtMs: 300 }
    }), true);
    assert.equal(shouldPreserveLocalSyncEntry(previous, remoteAfterDeviceA, {
        exists: true,
        contentHash: 'shared-base',
        updatedAtMs: 100,
        metadata: { id: 'note-1', title: 'Shared', updatedAtMs: 100 }
    }), false);
});

test('a protected path advances the global checkpoint but keeps the device local baseline', () => {
    const current = {
        serverRevision: 5,
        files: {
            'memo/shared.md': {
                lastKnownRevision: 5,
                contentHash: 'shared-base',
                localMetadataHash: 'device-b-baseline'
            }
        },
        attachments: {}
    };
    const stalePreparedSnapshot = {
        serverRevision: 4,
        files: {
            'memo/shared.md': { lastKnownRevision: 4, contentHash: 'older-base' }
        },
        attachments: {}
    };
    const result = syncStateFromManifest(current, {
        serverRevision: 6,
        files: [{ relativePath: 'memo/shared.md', revision: 6, contentHash: 'device-a-edit' }],
        attachments: []
    }, stalePreparedSnapshot, {
        preservePaths: ['memo/shared.md'],
        preserveState: current
    });
    assert.equal(result.state.serverRevision, 6);
    assert.deepEqual(result.state.files['memo/shared.md'], current.files['memo/shared.md']);
});

test('metadata-only edits on another device retain their original conflict baseline', () => {
    const baselineNote = { id: 'note-1', title: 'Shared', updatedAtMs: 100 };
    const previous = {
        lastKnownRevision: 5,
        contentHash: 'same-content',
        updatedAtMs: 100,
        localMetadataHash: syncLocalMetadataFingerprint(baselineNote)
    };
    assert.equal(shouldPreserveLocalSyncEntry(previous, {
        revision: 6,
        contentHash: 'same-content',
        clientUpdatedAtMs: 200
    }, {
        exists: true,
        contentHash: 'same-content',
        updatedAtMs: 300,
        metadata: { ...baselineNote, title: 'Device B', updatedAtMs: 300 }
    }), true);
});

test('an acknowledged upload fingerprints the sent snapshot instead of a newer concurrent edit', () => {
    const sent = { id: 'note-1', title: 'Sent', updatedAtMs: 200 };
    const newerLocal = { id: 'note-1', title: 'Typed while syncing', updatedAtMs: 300 };
    const previous = {
        lastKnownRevision: 5,
        contentHash: 'same-content',
        updatedAtMs: 100,
        localMetadataHash: syncLocalMetadataFingerprint({
            id: 'note-1',
            title: 'Base',
            updatedAtMs: 100
        })
    };
    const acknowledged = {
        lastKnownRevision: 6,
        contentHash: 'same-content',
        updatedAtMs: 200
    };
    updateSyncEntryLocalMetadataHash(acknowledged, previous, sent, false, true);
    assert.equal(acknowledged.localMetadataHash, syncLocalMetadataFingerprint(sent));
    assert.equal(shouldPreserveLocalSyncEntry(acknowledged, {
        revision: 7,
        contentHash: 'device-a-next',
        clientUpdatedAtMs: 400
    }, {
        exists: true,
        contentHash: 'same-content',
        updatedAtMs: 300,
        metadata: newerLocal
    }), true);
});

test('sync state rejects stale manifests instead of rolling revisions back', () => {
    const current = { serverRevision: 9, files: { 'memo/a.md': { lastKnownRevision: 9 } } };
    const result = syncStateFromManifest(current, { serverRevision: 8, files: [] }, {});
    assert.equal(result.shouldWrite, false);
    assert.equal(result.state, current);
});

test('sync state rejects a revisionless manifest after synchronization has begun', () => {
    const current = { serverRevision: 9, files: { 'memo/a.md': { lastKnownRevision: 9 } } };
    const result = syncStateFromManifest(current, { files: [] }, {});
    assert.equal(result.shouldWrite, false);
    assert.equal(result.state, current);
});

test('sync state accepts a confirmed server revision reset only when explicitly allowed', () => {
    const current = {
        serverRevision: 937,
        metadataRevision: 937,
        files: { 'legacy/note.md': { lastKnownRevision: 936, contentHash: 'legacy' } },
        attachments: {}
    };
    const result = syncStateFromManifest(current, {
        serverRevision: 146,
        metadata: { revision: 146, contentHash: 'current-metadata' },
        files: [{ relativePath: 'memo/note.md', revision: 145, contentHash: 'current' }],
        attachments: []
    }, current, { allowServerRevisionReset: true });

    assert.equal(result.shouldWrite, true);
    assert.equal(result.state.serverRevision, 146);
    assert.equal(result.state.metadataRevision, 146);
    assert.equal(result.state.files['legacy/note.md'], undefined);
    assert.equal(result.state.files['memo/note.md'].lastKnownRevision, 145);
});

test('sync state keeps canonical storage and attachment ownership metadata', () => {
    const current = {
        serverRevision: 3,
        files: {
            'memo/a.md': { storagePath: '매모/A.md', lastKnownRevision: 2 }
        },
        attachments: {
            'memo/.attachments/a/image.png': {
                storagePath: '매모/.attachments/a/image.png',
                noteRelativePath: 'memo/a.md',
                attachmentId: 'att-1',
                lastKnownRevision: 3
            }
        }
    };
    const result = syncStateFromManifest(current, {
        serverRevision: 4,
        metadata: { revision: 3, contentHash: 'metadata-hash' },
        files: [{
            relativePath: 'memo/a.md',
            revision: 2,
            contentHash: 'file-hash',
            storagePath: '다른 기기/문서.md'
        }],
        attachments: [{
            relativePath: 'memo/.attachments/a/image.png',
            revision: 4,
            contentHash: 'attachment-hash',
            storagePath: '다른 기기/첨부.png'
        }]
    }, {});

    assert.equal(result.shouldWrite, true);
    assert.equal(result.state.files['memo/a.md'].storagePath, '매모/A.md');
    assert.equal(
        result.state.attachments['memo/.attachments/a/image.png'].noteRelativePath,
        'memo/a.md'
    );
    assert.equal(
        result.state.attachments['memo/.attachments/a/image.png'].storagePath,
        '매모/.attachments/a/image.png'
    );
    assert.equal(result.state.attachments['memo/.attachments/a/image.png'].attachmentId, 'att-1');
});

test('server-reset content conflicts survive unrelated checkpoints until explicitly resolved', () => {
    const current = {
        serverRevision: 146,
        files: {
            'memo/conflict.md': {
                lastKnownRevision: 0,
                contentHash: 'server-old',
                rebaseConflict: true
            },
            'memo/other.md': { lastKnownRevision: 145, contentHash: 'other-old' }
        },
        attachments: {}
    };
    const manifest = {
        serverRevision: 147,
        files: [
            { relativePath: 'memo/conflict.md', revision: 140, contentHash: 'server-current' },
            { relativePath: 'memo/other.md', revision: 147, contentHash: 'other-current' }
        ],
        attachments: []
    };

    const checkpoint = syncStateFromManifest(current, manifest, current);
    assert.equal(checkpoint.state.files['memo/conflict.md'].lastKnownRevision, 0);
    assert.equal(checkpoint.state.files['memo/conflict.md'].rebaseConflict, true);

    const resolved = syncStateFromManifest(checkpoint.state, manifest, checkpoint.state, {
        clearRebaseConflictPaths: ['memo/conflict.md']
    });
    assert.equal(resolved.state.files['memo/conflict.md'].lastKnownRevision, 140);
    assert.equal(resolved.state.files['memo/conflict.md'].rebaseConflict, undefined);
});

test('conflict checkpoints advance the manifest without accepting conflicted revisions', () => {
    const previous = {
        serverRevision: 4,
        metadataRevision: 3,
        metadataHash: 'metadata-before-conflict',
        files: {
            'memo/conflicted.md': { lastKnownRevision: 4, contentHash: 'local-base' },
            'memo/unchanged.md': { lastKnownRevision: 3, contentHash: 'old' }
        },
        attachments: {}
    };
    const result = syncStateFromManifest(previous, {
        serverRevision: 7,
        metadata: { revision: 7, contentHash: 'server-metadata' },
        files: [
            { relativePath: 'memo/conflicted.md', revision: 7, contentHash: 'server-winner' },
            { relativePath: 'memo/unchanged.md', revision: 6, contentHash: 'new' }
        ],
        attachments: []
    }, previous, {
        preservePaths: ['memo/conflicted.md'],
        preserveMetadata: true
    });

    assert.equal(result.shouldWrite, true);
    assert.equal(result.state.serverRevision, 7);
    assert.equal(result.state.files['memo/conflicted.md'].lastKnownRevision, 4);
    assert.equal(result.state.files['memo/conflicted.md'].contentHash, 'local-base');
    assert.equal(result.state.files['memo/unchanged.md'].lastKnownRevision, 6);
    assert.equal(result.state.metadataRevision, 3);
    assert.equal(result.state.metadataHash, 'metadata-before-conflict');
});

test('conflict checkpoints do not create a base revision for a previously unknown path', () => {
    const previous = { serverRevision: 1, files: {}, attachments: {} };
    const result = syncStateFromManifest(previous, {
        serverRevision: 2,
        files: [{ relativePath: 'memo/new-conflict.md', revision: 2 }],
        attachments: []
    }, previous, {
        preservePaths: ['memo/new-conflict.md']
    });

    assert.equal(result.shouldWrite, true);
    assert.equal(result.state.files['memo/new-conflict.md'], undefined);
});

test('delete conflicts retain local tombstone intent', () => {
    const marked = markLocalDeleteConflict({
        relativePath: 'memo/deleted.md',
        reason: 'conflict'
    }, 'file');
    assert.equal(isLocalDeleteConflict(marked), true);
    assert.equal(
        isLocalDeleteConflict({ reason: 'server_file_changed_after_client_delete' }),
        true
    );
});

test('storage changes are retryable results rather than document conflicts', () => {
    assert.equal(isLocalStorageChangedResult({ status: 'retry' }), true);
    assert.equal(isLocalStorageChangedResult({ reason: 'local_storage_changed_during_sync' }), true);
    assert.equal(isLocalStorageChangedResult({ status: 'conflict' }), false);
});

test('only an explicit live pending tombstone is eligible for server deletion', () => {
    assert.equal(isPendingSyncDeleteState({ lastKnownRevision: 8, pendingDelete: true }), true);
    assert.equal(isPendingSyncDeleteState({ lastKnownRevision: 8 }), false);
    assert.equal(isPendingSyncDeleteState({ pendingDelete: true }), false);
    assert.equal(
        isPendingSyncDeleteState({ lastKnownRevision: 8, pendingDelete: true, deleted: true }),
        false
    );
    assert.equal(isPendingSyncDeleteIntent({ lastKnownRevision: 0, pendingDelete: true }), true);
});

test('pending delete intent survives unrelated manifest checkpoints and clears after server deletion', () => {
    const current = {
        serverRevision: 5,
        files: {
            'memo/delete.md': {
                lastKnownRevision: 4,
                contentHash: 'old',
                pendingDelete: true,
                syncIdentityAliases: ['old-note-id']
            }
        },
        attachments: {}
    };
    const liveCheckpoint = syncStateFromManifest(current, {
        serverRevision: 6,
        files: [{ relativePath: 'memo/delete.md', revision: 6, contentHash: 'edited-remotely' }],
        attachments: []
    }, current);
    assert.equal(liveCheckpoint.state.files['memo/delete.md'].pendingDelete, true);
    assert.equal(liveCheckpoint.state.files['memo/delete.md'].lastKnownRevision, 4);
    assert.equal(liveCheckpoint.state.files['memo/delete.md'].contentHash, 'old');
    assert.deepEqual(
        liveCheckpoint.state.files['memo/delete.md'].syncIdentityAliases,
        ['old-note-id']
    );

    const deletedCheckpoint = syncStateFromManifest(liveCheckpoint.state, {
        serverRevision: 7,
        files: [{ relativePath: 'memo/delete.md', revision: 7, deleted: true }],
        attachments: []
    }, liveCheckpoint.state);
    assert.equal(deletedCheckpoint.state.files['memo/delete.md'].pendingDelete, undefined);
    assert.equal(deletedCheckpoint.state.files['memo/delete.md'].deleted, true);
});
