'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
    compareVersions,
    createUpdater,
    parseShareUrl,
    releaseDirectories,
    selectArtifact
} = require('./updater.cjs');

function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });
}

test('semantic versions are compared numerically and release folders are sorted', () => {
    assert.equal(compareVersions('0.10.0', '0.2.9'), 1);
    assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
    assert.deepEqual(releaseDirectories([
        { name: '0.2.2', isDir: true },
        { name: 'latest', isDir: true },
        { name: '0.10.0', isDir: true },
        { name: '0.3.0', isDir: false }
    ]).map(item => item.version), ['0.10.0', '0.2.2']);
});

test('share URLs and artifacts are constrained to the expected public paths', () => {
    assert.deepEqual(parseShareUrl('https://file.nanoha.kr/share/i3TGy3GF'), {
        origin: 'https://file.nanoha.kr',
        shareId: 'i3TGy3GF',
        shareUrl: 'https://file.nanoha.kr/share/i3TGy3GF'
    });
    assert.throws(() => parseShareUrl('http://file.nanoha.kr/share/i3TGy3GF'), /올바르지/);
    assert.equal(selectArtifact([
        { name: 'Notedown-0.3.0-mac-arm64.pkg', size: 100, isDir: false }
    ], '0.3.0', 'darwin', 'arm64').relativePath, '0.3.0/Notedown-0.3.0-mac-arm64.pkg');
    assert.equal(selectArtifact([
        { name: 'Notedown-0.3.0-mac-x64.pkg', size: 100, isDir: false }
    ], '0.3.0', 'darwin', 'arm64'), null);
    assert.equal(selectArtifact([
        { name: 'Notedown-0.3.0-win-x64.exe', size: 2 * 1024 * 1024 * 1024, isDir: false }
    ], '0.3.0', 'win32', 'x64'), null);
});

test('updater chooses the newest compatible artifact and downloads it completely', async () => {
    const content = Buffer.from('MZ-notedown-update');
    const calls = [];
    const fetch = async (url) => {
        calls.push(url);
        if (url.endsWith('/api/public/share/token/')) {
            return jsonResponse({ items: [
                { name: '0.3.0', isDir: true },
                { name: '0.2.3', isDir: true }
            ] });
        }
        if (url.endsWith('/api/public/share/token/0.3.0/')) {
            return jsonResponse({ items: [
                { name: 'Notedown-0.3.0-win-x64.exe', size: content.length, isDir: false }
            ] });
        }
        if (url.includes('/api/public/dl/token/0.3.0/')) {
            return new Response(content, {
                status: 200,
                headers: { 'content-length': String(content.length) }
            });
        }
        throw new Error(`unexpected URL: ${url}`);
    };
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'notedown-updater-'));
    try {
        const updater = createUpdater({
            fetch,
            currentVersion: '0.2.2',
            platform: 'win32',
            arch: 'x64',
            shareUrl: 'https://updates.example/share/token',
            downloadDirectory: tempDirectory
        });
        const release = await updater.check();
        assert.equal(release.updateAvailable, true);
        assert.equal(release.version, '0.3.0');
        assert.equal(release.artifact.fileName, 'Notedown-0.3.0-win-x64.exe');

        const progress = [];
        const targetPath = await updater.download(release, status => progress.push(status));
        assert.deepEqual(await fs.readFile(targetPath), content);
        assert.equal(progress.at(-1).stage, 'downloaded');
        assert.equal(progress.at(-1).percent, 100);
        assert.equal(calls.length, 3);
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true });
    }
});

test('updater rejects a download that does not match the installer file type', async () => {
    const content = Buffer.from('not-an-executable');
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'notedown-updater-invalid-'));
    try {
        const updater = createUpdater({
            fetch: async (url) => {
                if (url.endsWith('/api/public/share/token/')) {
                    return jsonResponse({ items: [{ name: '0.3.0', isDir: true }] });
                }
                if (url.endsWith('/api/public/share/token/0.3.0/')) {
                    return jsonResponse({ items: [{ name: 'Notedown-0.3.0-win-x64.exe', size: content.length, isDir: false }] });
                }
                return new Response(content, { status: 200, headers: { 'content-length': String(content.length) } });
            },
            currentVersion: '0.2.2',
            platform: 'win32',
            arch: 'x64',
            shareUrl: 'https://updates.example/share/token',
            downloadDirectory: tempDirectory
        });
        const release = await updater.check();
        await assert.rejects(() => updater.download(release), /Windows 설치 파일 형식/);
        await assert.rejects(() => fs.access(path.join(tempDirectory, 'Notedown-0.3.0-win-x64.exe.part')));
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true });
    }
});

test('updater stops when a download exceeds the listed artifact size', async () => {
    const listedContent = Buffer.from('MZ');
    const oversizedContent = Buffer.from('MZ-oversized');
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'notedown-updater-oversized-'));
    try {
        const updater = createUpdater({
            fetch: async (url) => {
                if (url.endsWith('/api/public/share/token/')) {
                    return jsonResponse({ items: [{ name: '0.3.0', isDir: true }] });
                }
                if (url.endsWith('/api/public/share/token/0.3.0/')) {
                    return jsonResponse({ items: [{ name: 'Notedown-0.3.0-win-x64.exe', size: listedContent.length, isDir: false }] });
                }
                return new Response(oversizedContent, { status: 200 });
            },
            currentVersion: '0.2.2',
            platform: 'win32',
            arch: 'x64',
            shareUrl: 'https://updates.example/share/token',
            downloadDirectory: tempDirectory
        });
        const release = await updater.check();
        await assert.rejects(() => updater.download(release), /크기가 저장소 정보보다 큽니다/);
        await assert.rejects(() => fs.access(path.join(tempDirectory, 'Notedown-0.3.0-win-x64.exe.part')));
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true });
    }
});

test('updater reports no update when only the installed version exists', async () => {
    const updater = createUpdater({
        fetch: async () => jsonResponse({ items: [{ name: '0.2.2', isDir: true }] }),
        currentVersion: '0.2.2',
        platform: 'darwin',
        arch: 'arm64',
        shareUrl: 'https://updates.example/share/token',
        downloadDirectory: '/tmp/notedown-updater-test'
    });
    const result = await updater.check();
    assert.equal(result.ok, true);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.latestVersion, '0.2.2');
});
