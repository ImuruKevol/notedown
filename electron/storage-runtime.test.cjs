'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeyedQueue } = require('./keyed-queue.cjs');
const {
    indexPreviousAttachmentIdentities,
    indexPreviousNoteIdentities,
    prepareNoteStorageIdentities,
    selectMissingPreviousNotes
} = require('./storage-identity.cjs');

test('keyed queue serializes the same key and recovers after rejection', async () => {
    const queue = createKeyedQueue();
    const events = [];
    const first = queue.run('notes', async () => {
        events.push('first:start');
        await new Promise(resolve => setTimeout(resolve, 20));
        events.push('first:end');
        throw new Error('expected');
    });
    const second = queue.run('notes', async () => {
        events.push('second:start');
        events.push('second:end');
        return 2;
    });

    await assert.rejects(first, /expected/);
    assert.equal(await second, 2);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
    assert.equal(queue.size, 0);
});

test('keyed queue allows independent keys to progress concurrently', async () => {
    const queue = createKeyedQueue();
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let started = 0;

    const left = queue.run('left', async () => {
        started++;
        await barrier;
        return 'left';
    });
    const right = queue.run('right', async () => {
        started++;
        await barrier;
        return 'right';
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(started, 2);
    release();
    assert.deepEqual(await Promise.all([left, right]), ['left', 'right']);
});

test('storage generations follow queued mutation order rather than invocation order', async () => {
    const queue = createKeyedQueue();
    let releaseFirst;
    const firstBarrier = new Promise(resolve => { releaseFirst = resolve; });
    let generation = 0;

    const firstMutation = queue.run('notes', async () => {
        generation++;
        await firstBarrier;
    });
    const capture = queue.run('notes', async () => generation);
    const futureMutation = queue.run('notes', async () => {
        generation++;
    });

    releaseFirst();
    await firstMutation;
    assert.equal(await capture, 1);
    await futureMutation;
    assert.equal(generation, 2);
});

test('storage identity reuses canonical storagePath by note id', () => {
    const normalizeRelativePath = value => String(value).replace(/\\/g, '/').replace(/^\/+/, '');
    const relativePathForNote = note => note.relativePath || `${note.folder}/${note.id}.md`;
    const previous = [{
        id: 'note-1',
        relativePath: 'memo/note-1.md',
        storagePath: '메모/새 노트-5.md',
        title: '새 노트'
    }];
    const [prepared] = prepareNoteStorageIdentities([
        { id: 'note-1', folder: 'memo', title: '새 노트', body: 'changed' }
    ], previous, { normalizeRelativePath, relativePathForNote });

    assert.equal(prepared.relativePath, 'memo/note-1.md');
    assert.equal(prepared.currentStoragePath, '메모/새 노트-5.md');
    assert.equal(prepared.note.storagePath, '메모/새 노트-5.md');
    assert.equal(prepared.note.body, 'changed');
});

test('storage identity rejects duplicate ids and logical paths before writes', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    assert.throws(() => prepareNoteStorageIdentities([
        { id: 'same', relativePath: 'a.md' },
        { id: 'same', relativePath: 'b.md' }
    ], [], { normalizeRelativePath, relativePathForNote }), /중복 노트 ID/);
    assert.throws(() => prepareNoteStorageIdentities([
        { id: 'one', relativePath: 'a.md' },
        { id: 'two', relativePath: 'a.md' }
    ], [], { normalizeRelativePath, relativePathForNote }), /중복 노트 경로/);
});

test('existing metadata duplicate note and attachment identities are rejected before writes', () => {
    const normalizeRelativePath = value => String(value);
    assert.throws(() => indexPreviousNoteIdentities([
        { id: 'same', relativePath: 'a.md', storagePath: 'a.md' },
        { id: 'same', relativePath: 'b.md', storagePath: 'b.md' }
    ], normalizeRelativePath), /중복 노트 ID/);
    assert.throws(() => indexPreviousNoteIdentities([
        { id: 'one', relativePath: 'same.md', storagePath: 'a.md' },
        { id: 'two', relativePath: 'same.md', storagePath: 'b.md' }
    ], normalizeRelativePath), /중복 노트 경로/);
    assert.throws(() => indexPreviousAttachmentIdentities([{
        id: 'note',
        relativePath: 'note.md',
        attachments: [
            { id: 'same', relativePath: 'a.png', storagePath: 'physical-a.png' },
            { id: 'same', relativePath: 'b.png', storagePath: 'physical-b.png' }
        ]
    }], normalizeRelativePath), /중복 첨부 ID/);
    assert.throws(() => indexPreviousAttachmentIdentities([{
        id: 'note',
        relativePath: 'note.md',
        attachments: [
            { id: 'a', relativePath: 'a.png', storagePath: 'same.png' },
            { id: 'b', relativePath: 'b.png', storagePath: 'same.png' }
        ]
    }], normalizeRelativePath), /중복 실제 첨부 경로/);

    const relativePathForNote = note => note.relativePath;
    assert.throws(() => prepareNoteStorageIdentities([], [{
        id: 'note',
        relativePath: 'note.md',
        storagePath: 'shared.bin',
        attachments: [{
            id: 'attachment',
            relativePath: 'attachment.bin',
            storagePath: 'shared.bin'
        }]
    }], { normalizeRelativePath, relativePathForNote }), /노트 파일과 충돌/);
});


test('storage identity rejects a path already owned by another note id', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [
        { id: 'one', relativePath: 'a.md', storagePath: 'physical-a.md' },
        { id: 'two', relativePath: 'b.md', storagePath: 'physical-b.md' }
    ];

    assert.throws(() => prepareNoteStorageIdentities([
        { id: 'new-id', relativePath: 'a.md' }
    ], previous, { normalizeRelativePath, relativePathForNote }), /다른 ID/);

    const [prepared] = prepareNoteStorageIdentities([
        { id: 'one', relativePath: 'renamed.md' }
    ], previous, { normalizeRelativePath, relativePathForNote });
    assert.equal(prepared.relativePath, 'a.md');
    assert.equal(prepared.currentStoragePath, 'physical-a.md');
});


test('existing note canonical storagePath wins and another owner cannot be claimed', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [
        { id: 'one', relativePath: 'one.md', storagePath: 'physical-one.md', attachments: [] },
        { id: 'two', relativePath: 'two.md', storagePath: 'physical-two.md', attachments: [] }
    ];

    const [prepared] = prepareNoteStorageIdentities([
        { id: 'one', relativePath: 'one.md', storagePath: 'one.md', attachments: [] }
    ], previous, { normalizeRelativePath, relativePathForNote });
    assert.equal(prepared.currentStoragePath, 'physical-one.md');
    assert.equal(prepared.note.storagePath, 'physical-one.md');

    assert.throws(() => prepareNoteStorageIdentities([
        { id: 'one', relativePath: 'one.md', storagePath: 'physical-two.md', attachments: [] }
    ], previous, { normalizeRelativePath, relativePathForNote }), /다른 ID/);
});

test('attachment identity deep merge preserves canonical physical and parent paths', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [{
        id: 'note-1',
        relativePath: 'memo/note-1.md',
        storagePath: '메모/노트.md',
        attachments: [{
            id: 'att-1',
            relativePath: 'memo/attachments/file.png',
            storagePath: '메모/.attachments/노트/file.png',
            noteRelativePath: 'memo/note-1.md',
            contentHash: 'old-hash'
        }]
    }];

    const [prepared] = prepareNoteStorageIdentities([{
        id: 'note-1',
        relativePath: 'memo/note-1.md',
        attachments: [{
            id: 'att-1',
            relativePath: 'memo/attachments/file.png',
            storagePath: '',
            noteRelativePath: '',
            size: 42
        }]
    }], previous, { normalizeRelativePath, relativePathForNote });
    const attachment = prepared.note.attachments[0];
    assert.equal(attachment.storagePath, '메모/.attachments/노트/file.png');
    assert.equal(attachment.noteRelativePath, 'memo/note-1.md');
    assert.equal(attachment.contentHash, 'old-hash');
    assert.equal(attachment.size, 42);
});

test('attachment identity rejects id, path, and physical ownership mismatches', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [{
        id: 'note-1',
        relativePath: 'note.md',
        storagePath: 'physical-note.md',
        attachments: [
            { id: 'att-1', relativePath: 'attachments/a.png', storagePath: 'physical/a.png', noteRelativePath: 'note.md' },
            { id: 'att-2', relativePath: 'attachments/b.png', storagePath: 'physical/b.png', noteRelativePath: 'note.md' }
        ]
    }];
    const wrap = attachments => [{
        id: 'note-1',
        relativePath: 'note.md',
        attachments
    }];

    assert.throws(() => prepareNoteStorageIdentities(wrap([
        { id: 'att-1', relativePath: 'attachments/b.png' }
    ]), previous, { normalizeRelativePath, relativePathForNote }), /서로 다른 기존 첨부|다른 경로/);

    assert.throws(() => prepareNoteStorageIdentities(wrap([
        { id: 'att-1', relativePath: 'attachments/a.png', storagePath: 'physical/b.png' }
    ]), previous, { normalizeRelativePath, relativePathForNote }), /기존 메타데이터와 다릅니다|다른 첨부/);

    assert.throws(() => prepareNoteStorageIdentities(wrap([
        { id: 'new', relativePath: 'attachments/new.png', storagePath: 'physical/a.png' }
    ]), previous, { normalizeRelativePath, relativePathForNote }), /다른 첨부/);
});

test('attachment identity rejects duplicate incoming ids, logical paths, and storage paths', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const prepare = attachments => prepareNoteStorageIdentities([{
        id: 'note',
        relativePath: 'note.md',
        attachments
    }], [], { normalizeRelativePath, relativePathForNote });

    assert.throws(() => prepare([
        { id: 'same', relativePath: 'a.png', storagePath: 'physical-a.png' },
        { id: 'same', relativePath: 'b.png', storagePath: 'physical-b.png' }
    ]), /중복 첨부 ID/);
    assert.throws(() => prepare([
        { id: 'a', relativePath: 'same.png', storagePath: 'physical-a.png' },
        { id: 'b', relativePath: 'same.png', storagePath: 'physical-b.png' }
    ]), /중복 첨부 경로/);
    assert.throws(() => prepare([
        { id: 'a', relativePath: 'a.png', storagePath: 'same-physical.png' },
        { id: 'b', relativePath: 'b.png', storagePath: 'same-physical.png' }
    ]), /중복 실제 첨부 경로/);
});


test('stale timestamps never replace an incoming note and only missing notes are restored', () => {
    const normalizeRelativePath = value => String(value);
    const incoming = [{
        id: 'same',
        relativePath: 'same.md',
        updatedAtMs: 1,
        body: 'authoritative incoming'
    }];
    const previous = [
        { id: 'same', relativePath: 'same.md', updatedAtMs: 999999, body: 'clock-skewed disk' },
        { id: 'missing', relativePath: 'missing.md', updatedAtMs: 2 }
    ];

    assert.deepEqual(
        selectMissingPreviousNotes(incoming, previous, [], normalizeRelativePath).map(note => note.id),
        ['missing']
    );
    assert.deepEqual(
        selectMissingPreviousNotes(incoming, previous, ['missing'], normalizeRelativePath),
        []
    );
});


test('stale attachment omission preserves the existing canonical attachment', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [{
        id: 'note',
        relativePath: 'note.md',
        storagePath: 'physical-note.md',
        attachments: [{
            id: 'att',
            relativePath: 'attachments/a.png',
            storagePath: 'physical/a.png',
            noteRelativePath: 'note.md'
        }]
    }];

    const [prepared] = prepareNoteStorageIdentities([{
        id: 'note',
        relativePath: 'note.md',
        attachments: []
    }], previous, { normalizeRelativePath, relativePathForNote });

    assert.equal(prepared.note.attachments.length, 1);
    assert.equal(prepared.note.attachments[0].id, 'att');
    assert.equal(prepared.note.attachments[0].storagePath, 'physical/a.png');
});

test('explicit deletedAttachmentIds removes only the canonical owner attachment', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [{
        id: 'note',
        relativePath: 'note.md',
        storagePath: 'physical-note.md',
        attachments: [{
            id: 'att',
            relativePath: 'attachments/a.png',
            storagePath: 'physical/a.png',
            noteRelativePath: 'note.md'
        }]
    }];

    const [prepared] = prepareNoteStorageIdentities([{
        id: 'note',
        relativePath: 'note.md',
        attachments: []
    }], previous, {
        normalizeRelativePath,
        relativePathForNote,
        deletedAttachmentIds: ['att']
    });
    assert.deepEqual(prepared.note.attachments, []);
});

test('deletedAttachmentIds rejects unknown, still-present, and wrong-owner targets', () => {
    const normalizeRelativePath = value => String(value);
    const relativePathForNote = note => note.relativePath;
    const previous = [
        {
            id: 'one',
            relativePath: 'one.md',
            attachments: [{
                id: 'att-one',
                relativePath: 'attachments/one.png',
                storagePath: 'physical/one.png',
                noteRelativePath: 'one.md'
            }]
        },
        {
            id: 'two',
            relativePath: 'two.md',
            attachments: [{
                id: 'att-two',
                relativePath: 'attachments/two.png',
                storagePath: 'physical/two.png',
                noteRelativePath: 'two.md'
            }]
        }
    ];
    const noteOne = [{
        id: 'one',
        relativePath: 'one.md',
        attachments: []
    }];

    assert.throws(() => prepareNoteStorageIdentities(noteOne, previous, {
        normalizeRelativePath,
        relativePathForNote,
        deletedAttachmentIds: ['missing']
    }), /찾을 수 없습니다/);

    assert.throws(() => prepareNoteStorageIdentities([{
        id: 'one',
        relativePath: 'one.md',
        attachments: [{
            id: 'att-one',
            relativePath: 'attachments/one.png'
        }]
    }], previous, {
        normalizeRelativePath,
        relativePathForNote,
        deletedAttachmentIds: ['att-one']
    }), /요청에 남아/);

    assert.throws(() => prepareNoteStorageIdentities(noteOne, previous, {
        normalizeRelativePath,
        relativePathForNote,
        deletedAttachmentIds: ['att-two']
    }), /소유자와 일치하지 않습니다/);
});
