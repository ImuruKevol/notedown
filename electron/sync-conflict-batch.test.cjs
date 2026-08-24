'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeConflictBatchItems,
    runSyncConflictBatch,
    serverResolutionStillCurrent
} = require('./sync-conflict-batch.cjs');

test('conflict batches resolve independent items serially and converge once', async () => {
    const calls = [];
    let converged = 0;
    const result = await runSyncConflictBatch({
        items: [
            { relativePath: 'memo/a.md', type: 'file' },
            { relativePath: 'memo/b.md', type: 'file' },
            { relativePath: 'memo/c.md', type: 'file' }
        ],
        resolve: async item => {
            calls.push(item.relativePath);
            return item.relativePath.endsWith('b.md')
                ? { ok: false, status: 'conflict', didApply: false }
                : { ok: true, status: 'ok', didApply: true };
        },
        shouldStop: resultItem => resultItem?.status === 'retry',
        converge: async () => {
            converged++;
            return { ok: false, status: 'conflict', plan: { conflicts: [{ relativePath: 'memo/b.md' }] } };
        }
    });
    assert.deepEqual(calls, ['memo/a.md', 'memo/b.md', 'memo/c.md']);
    assert.deepEqual(result.resolved.map(item => item.item.relativePath), ['memo/a.md', 'memo/c.md']);
    assert.deepEqual(result.failed.map(item => item.item.relativePath), ['memo/b.md']);
    assert.equal(converged, 1);
});

test('a fatal offline failure stops the batch without hammering remaining items', async () => {
    const calls = [];
    const offline = Object.assign(new Error('offline'), { code: 'ERR_INTERNET_DISCONNECTED' });
    const result = await runSyncConflictBatch({
        items: [
            { relativePath: 'memo/a.md' },
            { relativePath: 'memo/b.md' },
            { relativePath: 'memo/c.md' }
        ],
        resolve: async item => {
            calls.push(item.relativePath);
            if (item.relativePath.endsWith('b.md')) throw offline;
            return { ok: true, didApply: true };
        },
        shouldStop: (_result, error) => error?.code === 'ERR_INTERNET_DISCONNECTED',
        converge: async () => assert.fail('convergence must not run while offline')
    });
    assert.deepEqual(calls, ['memo/a.md', 'memo/b.md']);
    assert.deepEqual(result.resolved.map(item => item.item.relativePath), ['memo/a.md']);
    assert.deepEqual(result.failed.map(item => item.item.relativePath), ['memo/b.md']);
    assert.deepEqual(result.skipped.map(item => item.relativePath), ['memo/c.md']);
    assert.equal(result.stopped, true);
});

test('duplicate batch identities are collapsed and oversized batches are rejected', () => {
    assert.deepEqual(normalizeConflictBatchItems([
        { relativePath: 'memo/a.md', type: 'file', reason: 'old-conflict' },
        { relativePath: 'memo/a.md', type: 'file', reason: 'new-conflict' }
    ]).length, 1);
    assert.throws(() => normalizeConflictBatchItems([
        { relativePath: 'memo/a.md' },
        { relativePath: 'memo/b.md' }
    ], 1), /최대 1개/);
});

test('server resolution never checkpoints a newer device revision than the bytes it applied', () => {
    const downloaded = { revision: 8, contentHash: 'downloaded' };
    assert.equal(serverResolutionStillCurrent(downloaded, {
        revision: 8,
        contentHash: 'downloaded'
    }), true);
    assert.equal(serverResolutionStillCurrent(downloaded, {
        revision: 9,
        contentHash: 'changed-on-device-c'
    }), false);
    assert.equal(serverResolutionStillCurrent({ revision: 10, deleted: true }, {
        revision: 10,
        deleted: true
    }), true);
});
