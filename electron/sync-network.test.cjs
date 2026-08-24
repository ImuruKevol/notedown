'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    CONTROL_REQUEST_TIMEOUT_MS,
    MAX_WRITE_TIMEOUT_MS,
    MIN_WRITE_TIMEOUT_MS,
    recoverMutationFromManifest,
    shouldProbeMutationResult,
    shouldRetrySyncNetworkError,
    syncNetworkErrorKind,
    syncNetworkUserMessage,
    syncRequestTimeoutMs
} = require('./sync-network.cjs');

test('control requests fail within a bounded window while slow writes receive an adaptive timeout', () => {
    assert.equal(syncRequestTimeoutMs({}), CONTROL_REQUEST_TIMEOUT_MS);
    assert.equal(syncRequestTimeoutMs({ timeoutMs: 1234 }), 1234);
    assert.equal(syncRequestTimeoutMs({ body: { content: 'small' } }), MIN_WRITE_TIMEOUT_MS);
    const slowUploadTimeout = syncRequestTimeoutMs({ body: { content: 'x'.repeat(4 * 1024 * 1024) } });
    assert.ok(slowUploadTimeout > MIN_WRITE_TIMEOUT_MS);
    assert.ok(slowUploadTimeout <= MAX_WRITE_TIMEOUT_MS);
    const slowDownloadTimeout = syncRequestTimeoutMs({ expectedResponseBytes: 4 * 1024 * 1024 });
    assert.ok(slowDownloadTimeout > MIN_WRITE_TIMEOUT_MS);
    assert.ok(slowDownloadTimeout <= MAX_WRITE_TIMEOUT_MS);
});

test('offline and timeout failures are reported as preserved local changes without blind retries', () => {
    const offline = Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { code: 'ERR_INTERNET_DISCONNECTED' });
    const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
    assert.equal(syncNetworkErrorKind(offline), 'offline');
    assert.equal(syncNetworkErrorKind(timeout), 'timeout');
    assert.match(syncNetworkUserMessage(offline), /로컬 변경은 보존/);
    assert.match(syncNetworkUserMessage(timeout), /로컬 변경은 보존/);
    assert.equal(shouldRetrySyncNetworkError(offline), false);
    assert.equal(shouldRetrySyncNetworkError(timeout), false);
    assert.equal(shouldProbeMutationResult(offline), false);
    assert.equal(shouldProbeMutationResult(timeout), true);
    assert.equal(syncNetworkErrorKind({ code: 'UND_ERR_CONNECT_TIMEOUT' }), 'timeout');
    assert.equal(syncNetworkErrorKind({ code: 'ERR_CONNECTION_CLOSED' }), 'connection');
});

test('a delayed server commit is acknowledged by bounded manifest polling', async () => {
    let calls = 0;
    const waits = [];
    const result = await recoverMutationFromManifest({
        delays: [0, 100, 200, 400],
        wait: async delay => { waits.push(delay); },
        loadManifest: async () => ({ revision: ++calls }),
        acknowledged: manifest => manifest.revision >= 3 ? { revision: manifest.revision } : null
    });
    assert.equal(result.acknowledged, true);
    assert.equal(result.entry.revision, 3);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [100, 200]);
});

test('manifest proof stops immediately when the client is definitely offline', async () => {
    let calls = 0;
    const result = await recoverMutationFromManifest({
        delays: [0, 100, 200],
        wait: async () => undefined,
        loadManifest: async () => {
            calls++;
            throw Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), {
                code: 'ERR_INTERNET_DISCONNECTED'
            });
        },
        acknowledged: () => null
    });
    assert.equal(result.acknowledged, false);
    assert.equal(calls, 1);
});
