'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    shouldStartHiddenLoginItem,
    windowsLoginItemEnabled,
    windowsLoginItemOptions,
    windowsLoginItemQuery
} = require('./startup-settings.cjs');

test('Windows startup registration uses the installed executable, hidden argument, and enabled flag', () => {
    assert.deepEqual(
        windowsLoginItemOptions('C:\\Apps\\Notedown.exe', 'Notedown', '--notedown-start-hidden', true),
        {
            openAtLogin: true,
            path: 'C:\\Apps\\Notedown.exe',
            args: ['--notedown-start-hidden'],
            name: 'Notedown',
            enabled: true
        }
    );
    assert.deepEqual(
        windowsLoginItemQuery('C:\\Apps\\Notedown.exe', '--notedown-start-hidden'),
        { path: 'C:\\Apps\\Notedown.exe', args: ['--notedown-start-hidden'] }
    );
});

test('Windows startup readback accepts an enabled matching launch item despite API argument normalization', () => {
    const settings = {
        openAtLogin: false,
        executableWillLaunchAtLogin: true,
        launchItems: [{
            path: 'c:/apps/NOTEDOWN.exe',
            args: ['--NOTEDOWN-start-hidden'],
            enabled: true
        }]
    };
    assert.equal(windowsLoginItemEnabled(settings, {
        path: 'C:\\Apps\\Notedown.exe',
        args: ['--notedown-start-hidden']
    }), true);
});

test('Windows startup readback rejects a disabled matching launch item', () => {
    assert.equal(windowsLoginItemEnabled({
        openAtLogin: true,
        executableWillLaunchAtLogin: true,
        launchItems: [{
            path: 'C:\\Apps\\Notedown.exe',
            args: ['--notedown-start-hidden'],
            enabled: false
        }]
    }, {
        path: 'C:\\Apps\\Notedown.exe',
        args: ['--notedown-start-hidden']
    }), false);
});

test('Windows startup readback honors StartupApproved state before the registry intent', () => {
    assert.equal(windowsLoginItemEnabled({
        openAtLogin: true,
        executableWillLaunchAtLogin: false
    }, {
        path: 'C:\\Apps\\Notedown.exe',
        args: ['--notedown-start-hidden']
    }), false);
});

test('login startup remains hidden independently of close-to-background preference', () => {
    assert.equal(shouldStartHiddenLoginItem({
        launchAtStartup: true,
        keepInBackgroundOnClose: false
    }, true), true);
    assert.equal(shouldStartHiddenLoginItem({ launchAtStartup: false }, true), false);
    assert.equal(shouldStartHiddenLoginItem({ launchAtStartup: true }, false), false);
});
