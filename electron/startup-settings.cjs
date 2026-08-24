'use strict';

function normalizeWindowsPath(value) {
    return String(value || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
}

function normalizeArgs(values = []) {
    return (Array.isArray(values) ? values : [])
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
}

function windowsLoginItemOptions(execPath, appName, startHiddenArg, openAtLogin) {
    return {
        openAtLogin: Boolean(openAtLogin),
        path: execPath,
        args: [startHiddenArg],
        name: appName,
        ...(openAtLogin ? { enabled: true } : {})
    };
}

function windowsLoginItemQuery(execPath, startHiddenArg) {
    return { path: execPath, args: [startHiddenArg] };
}

function windowsLoginItemEnabled(settings = {}, expected = {}) {
    const expectedPath = normalizeWindowsPath(expected.path);
    const expectedArgs = normalizeArgs(expected.args);
    const launchItems = Array.isArray(settings.launchItems) ? settings.launchItems : [];
    const matchingItem = launchItems.find(item => {
        if (normalizeWindowsPath(item?.path) !== expectedPath) return false;
        const itemArgs = normalizeArgs(item?.args);
        return expectedArgs.every(arg => itemArgs.includes(arg));
    });
    if (matchingItem) return matchingItem.enabled !== false;
    if (typeof settings.executableWillLaunchAtLogin === 'boolean') {
        return settings.executableWillLaunchAtLogin;
    }
    return settings.openAtLogin === true;
}

function shouldStartHiddenLoginItem(preferences = {}, launchedHidden = false) {
    return preferences.launchAtStartup === true && launchedHidden === true;
}

module.exports = {
    normalizeWindowsPath,
    shouldStartHiddenLoginItem,
    windowsLoginItemEnabled,
    windowsLoginItemOptions,
    windowsLoginItemQuery
};
