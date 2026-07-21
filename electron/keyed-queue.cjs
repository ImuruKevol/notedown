'use strict';

function createKeyedQueue() {
    const tails = new Map();

    function run(key, task) {
        if (typeof task !== 'function') throw new TypeError('queue task must be a function');
        const normalizedKey = String(key || 'default');
        const previous = tails.get(normalizedKey) || Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => task());
        tails.set(normalizedKey, current);
        return current.finally(() => {
            if (tails.get(normalizedKey) === current) tails.delete(normalizedKey);
        });
    }

    return {
        run,
        get size() {
            return tails.size;
        }
    };
}

module.exports = { createKeyedQueue };
