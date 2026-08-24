'use strict';

function conflictBatchItemKey(item = {}) {
    const relativePath = item.relativePath || '';
    const type = item.type || (String(relativePath).includes('/.attachments/') ? 'attachment' : 'file');
    return [type, relativePath].join(':');
}

function normalizeConflictBatchItems(items = [], maximum = 200) {
    const unique = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        const relativePath = String(item?.relativePath || '').trim();
        if (!relativePath) continue;
        const normalized = { ...item, relativePath };
        unique.set(conflictBatchItemKey(normalized), normalized);
        if (unique.size > maximum) throw new Error(`한 번에 최대 ${maximum}개의 충돌을 처리할 수 있습니다.`);
    }
    return [...unique.values()];
}

function serverResolutionStillCurrent(payload = {}, manifestEntry = null) {
    if (!manifestEntry) return false;
    const deleted = value => value === true || value === 'true';
    if (deleted(payload.deleted) !== deleted(manifestEntry.deleted)) return false;
    const payloadRevision = Number(payload.revision) || 0;
    const manifestRevision = Number(manifestEntry.revision) || 0;
    if (payloadRevision > 0 && manifestRevision > 0 && payloadRevision !== manifestRevision) return false;
    if (!deleted(payload.deleted) && payload.contentHash && manifestEntry.contentHash) {
        return String(payload.contentHash) === String(manifestEntry.contentHash);
    }
    return true;
}

async function runSyncConflictBatch(options = {}) {
    const items = normalizeConflictBatchItems(options.items, options.maximum);
    if (items.length === 0) throw new Error('일괄 적용할 충돌을 선택하세요.');
    const resolved = [];
    const failed = [];
    const skipped = [];
    let stopped = false;

    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        try {
            const result = await options.resolve(item, index);
            if (result?.didApply === true) resolved.push({ item, result });
            else failed.push({ item, result });
            if (options.shouldStop?.(result, null, item) === true) {
                skipped.push(...items.slice(index + 1));
                stopped = true;
                break;
            }
        } catch (error) {
            failed.push({ item, error });
            if (options.shouldStop?.(null, error, item) === true) {
                skipped.push(...items.slice(index + 1));
                stopped = true;
                break;
            }
        }
    }

    let convergence = null;
    let convergenceError = null;
    if (!stopped && typeof options.converge === 'function') {
        try {
            convergence = await options.converge();
        } catch (error) {
            convergenceError = error;
        }
    }
    return { convergence, convergenceError, failed, resolved, skipped, stopped };
}

module.exports = {
    conflictBatchItemKey,
    normalizeConflictBatchItems,
    runSyncConflictBatch,
    serverResolutionStillCurrent
};
