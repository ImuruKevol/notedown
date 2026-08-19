'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    acknowledgedSyncUploadEntry,
    isLocalDeleteConflict,
    isLocalStorageChangedResult,
    markLocalDeleteConflict,
    syncStateFromManifest
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
            contentHash: 'file-hash'
        }],
        attachments: [{
            relativePath: 'memo/.attachments/a/image.png',
            revision: 4,
            contentHash: 'attachment-hash'
        }]
    }, {});

    assert.equal(result.shouldWrite, true);
    assert.equal(result.state.files['memo/a.md'].storagePath, '매모/A.md');
    assert.equal(
        result.state.attachments['memo/.attachments/a/image.png'].noteRelativePath,
        'memo/a.md'
    );
    assert.equal(result.state.attachments['memo/.attachments/a/image.png'].attachmentId, 'att-1');
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
