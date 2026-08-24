'use strict';

const CONTROL_REQUEST_TIMEOUT_MS = 30000;
const MIN_WRITE_TIMEOUT_MS = 60000;
const MAX_WRITE_TIMEOUT_MS = 15 * 60 * 1000;
const ASSUMED_SLOW_UPLOAD_BYTES_PER_SECOND = 16 * 1024;
const WRITE_TIMEOUT_GRACE_MS = 30000;
const MUTATION_PROOF_DELAYS_MS = [0, 500, 1500, 3000, 5000];

function serializedBodyBytes(body) {
    if (body == null) return 0;
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

function syncRequestTimeoutMs(options = {}) {
    const explicit = Number(options.timeoutMs);
    if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
    const expectedResponseBytes = Number(options.expectedResponseBytes) || 0;
    if (options.body == null && expectedResponseBytes <= 0) return CONTROL_REQUEST_TIMEOUT_MS;
    const transferBytes = Math.max(serializedBodyBytes(options.body), expectedResponseBytes);
    const transferMs = Math.ceil(
        (transferBytes / ASSUMED_SLOW_UPLOAD_BYTES_PER_SECOND) * 1000
    );
    return Math.min(
        MAX_WRITE_TIMEOUT_MS,
        Math.max(MIN_WRITE_TIMEOUT_MS, WRITE_TIMEOUT_GRACE_MS + transferMs)
    );
}

function syncNetworkErrorKind(error = {}) {
    const code = String(error.code || error.cause?.code || '').toUpperCase();
    const name = String(error.name || '');
    const message = String(error.message || error.cause?.message || '').toUpperCase();
    const details = `${code} ${message}`;
    if (
        name === 'AbortError'
        || code === 'SYNC_TIMEOUT'
        || /ABORT|ETIMEDOUT|ERR_TIMED_OUT|TIMED?\s*OUT|TIMEOUT/.test(details)
    ) {
        return 'timeout';
    }
    if (
        /ERR_INTERNET_DISCONNECTED|ENETUNREACH|ENETDOWN|ERR_NETWORK_CHANGED/.test(details)
    ) {
        return 'offline';
    }
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(details)) return 'dns';
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(details)) return 'refused';
    if (
        /ERR_CONNECTION_(RESET|CLOSED|ABORTED)|ECONNRESET|EPIPE|UND_ERR_SOCKET|ERR_FAILED|FETCH FAILED/.test(details)
    ) {
        return 'connection';
    }
    return '';
}

function syncNetworkUserMessage(error = {}) {
    const kind = syncNetworkErrorKind(error);
    if (kind === 'timeout') {
        return '동기화 서버 응답 시간이 초과되었습니다. 로컬 변경은 보존되며 다음 동기화에서 서버 반영 여부를 다시 확인합니다.';
    }
    if (kind === 'offline' || kind === 'dns' || kind === 'refused') {
        return '동기화 서버에 연결할 수 없습니다. 로컬 변경은 보존되며 네트워크가 복구된 뒤 다시 동기화할 수 있습니다.';
    }
    if (kind === 'connection') {
        return '동기화 연결이 중간에 끊겼습니다. 로컬 변경은 보존되며 서버 반영 여부를 확인한 뒤 다시 시도할 수 있습니다.';
    }
    return '';
}

function isTransientSyncNetworkError(error = {}) {
    const status = Number(error.status) || 0;
    return Boolean(syncNetworkErrorKind(error)) || status === 408 || status === 429 || status >= 500;
}

function shouldRetrySyncNetworkError(error = {}) {
    const status = Number(error.status) || 0;
    const kind = syncNetworkErrorKind(error);
    if (kind === 'offline' || kind === 'dns' || kind === 'refused' || kind === 'timeout') return false;
    return kind === 'connection' || status === 408 || status === 429 || status >= 500;
}

function shouldProbeMutationResult(error = {}) {
    const kind = syncNetworkErrorKind(error);
    if (kind === 'offline' || kind === 'dns' || kind === 'refused') return false;
    return isTransientSyncNetworkError(error);
}

async function recoverMutationFromManifest(options = {}) {
    const delays = Array.isArray(options.delays) ? options.delays : MUTATION_PROOF_DELAYS_MS;
    const wait = options.wait || (delay => new Promise(resolve => setTimeout(resolve, delay)));
    let lastManifest = null;
    let lastError = null;
    for (const delay of delays) {
        if (delay > 0) await wait(delay);
        try {
            lastManifest = await options.loadManifest();
            const entry = options.acknowledged(lastManifest);
            if (entry) return { acknowledged: true, entry, manifest: lastManifest };
        } catch (error) {
            lastError = error;
            const kind = syncNetworkErrorKind(error);
            if (kind === 'offline' || kind === 'dns' || kind === 'refused') break;
        }
    }
    return { acknowledged: false, manifest: lastManifest, error: lastError };
}

module.exports = {
    CONTROL_REQUEST_TIMEOUT_MS,
    MAX_WRITE_TIMEOUT_MS,
    MIN_WRITE_TIMEOUT_MS,
    MUTATION_PROOF_DELAYS_MS,
    isTransientSyncNetworkError,
    recoverMutationFromManifest,
    serializedBodyBytes,
    shouldProbeMutationResult,
    shouldRetrySyncNetworkError,
    syncNetworkErrorKind,
    syncNetworkUserMessage,
    syncRequestTimeoutMs
};
