'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_UPDATE_SHARE_URL = 'https://file.nanoha.kr/share/i3TGy3GF';
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const UPDATE_FILE_PATTERN = /^Notedown-\d+\.\d+\.\d+-(?:mac-(?:arm64|x64)\.pkg|win-x64\.exe)(?:\.part)?$/;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ARTIFACT_SIZE = 1024 * 1024 * 1024;

function parseVersion(value) {
    const normalized = String(value || '').trim().replace(/^v/i, '');
    const match = normalized.match(VERSION_PATTERN);
    if (!match) return null;
    return {
        value: normalized,
        parts: match.slice(1).map(part => Number(part))
    };
}

function compareVersions(left, right) {
    const parsedLeft = parseVersion(left);
    const parsedRight = parseVersion(right);
    if (!parsedLeft || !parsedRight) throw new Error('올바르지 않은 앱 버전입니다.');
    for (let index = 0; index < parsedLeft.parts.length; index++) {
        if (parsedLeft.parts[index] === parsedRight.parts[index]) continue;
        return parsedLeft.parts[index] > parsedRight.parts[index] ? 1 : -1;
    }
    return 0;
}

function parseShareUrl(value = DEFAULT_UPDATE_SHARE_URL) {
    const url = new URL(String(value || '').trim());
    const match = url.pathname.match(/^\/share\/([^/]+)\/?$/);
    if (url.protocol !== 'https:' || !match) {
        throw new Error('업데이트 저장소 주소가 올바르지 않습니다.');
    }
    return {
        origin: url.origin,
        shareId: decodeURIComponent(match[1]),
        shareUrl: `${url.origin}/share/${encodeURIComponent(decodeURIComponent(match[1]))}`
    };
}

function encodePathSegments(value) {
    return String(value || '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function publicShareApiUrl(share, relativePath = '') {
    const suffix = encodePathSegments(relativePath);
    return `${share.origin}/api/public/share/${encodeURIComponent(share.shareId)}/${suffix ? `${suffix}/` : ''}`;
}

function publicDownloadUrl(share, relativePath) {
    const suffix = encodePathSegments(relativePath);
    if (!suffix) throw new Error('업데이트 파일 경로가 비어 있습니다.');
    return `${share.origin}/api/public/dl/${encodeURIComponent(share.shareId)}/${suffix}`;
}

function supportedArtifact(platform, arch) {
    if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
        return { suffix: `mac-${arch}.pkg`, extension: '.pkg' };
    }
    if (platform === 'win32' && arch === 'x64') {
        return { suffix: 'win-x64.exe', extension: '.exe' };
    }
    return null;
}

function releaseDirectories(items = []) {
    return items
        .filter(item => item?.isDir === true && parseVersion(item.name))
        .map(item => ({ ...item, version: parseVersion(item.name).value }))
        .sort((left, right) => compareVersions(right.version, left.version));
}

function selectArtifact(items = [], version, platform, arch) {
    const expected = supportedArtifact(platform, arch);
    if (!expected) return null;
    const expectedName = `Notedown-${version}-${expected.suffix}`;
    const artifact = items.find(item => (
        item?.isDir === false
        && item.name === expectedName
        && Number.isSafeInteger(Number(item.size))
        && Number(item.size) > 0
        && Number(item.size) <= MAX_ARTIFACT_SIZE
    ));
    if (!artifact) return null;
    return {
        fileName: expectedName,
        relativePath: `${version}/${expectedName}`,
        size: Number(artifact.size),
        modified: String(artifact.modified || ''),
        extension: expected.extension
    };
}

function responseError(response, fallback) {
    const status = Number(response?.status) || 0;
    return new Error(status ? `${fallback} (HTTP ${status})` : fallback);
}

async function validateArtifactHeader(filePath, extension) {
    const handle = await fsp.open(filePath, 'r');
    try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (extension === '.pkg' && (bytesRead < 4 || header.toString('ascii', 0, 4) !== 'xar!')) {
            throw new Error('다운로드한 macOS 설치 파일 형식이 올바르지 않습니다.');
        }
        if (extension === '.exe' && (bytesRead < 2 || header.toString('ascii', 0, 2) !== 'MZ')) {
            throw new Error('다운로드한 Windows 설치 파일 형식이 올바르지 않습니다.');
        }
    } finally {
        await handle.close();
    }
}

async function fetchJson(fetchImpl, url, timeoutMs = REQUEST_TIMEOUT_MS) {
    const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response?.ok) throw responseError(response, '업데이트 저장소를 읽지 못했습니다.');
    const data = await response.json();
    if (!data || !Array.isArray(data.items)) throw new Error('업데이트 저장소 응답 형식이 올바르지 않습니다.');
    return data;
}

function validateResponseLocation(response, expectedUrl) {
    if (!response?.url) return;
    const actual = new URL(response.url);
    const expected = new URL(expectedUrl);
    if (actual.protocol !== 'https:' || actual.origin !== expected.origin) {
        throw new Error('업데이트 다운로드가 신뢰할 수 없는 주소로 이동했습니다.');
    }
}

async function pruneOldDownloads(downloadDirectory, keepFileName) {
    let entries = [];
    try {
        entries = await fsp.readdir(downloadDirectory, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    await Promise.all(entries.map(async entry => {
        if (!entry.isFile() || entry.name === keepFileName || !UPDATE_FILE_PATTERN.test(entry.name)) return;
        await fsp.rm(path.join(downloadDirectory, entry.name), { force: true });
    }));
}

function updaterStatus(currentVersion, platform, arch, extra = {}) {
    return {
        currentVersion,
        platform,
        arch,
        supported: Boolean(supportedArtifact(platform, arch)),
        shareUrl: DEFAULT_UPDATE_SHARE_URL,
        ...extra
    };
}

function createUpdater(options = {}) {
    const fetchImpl = options.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('업데이트 fetch 구현이 필요합니다.');
    const currentVersion = String(options.currentVersion || '').trim();
    const platform = String(options.platform || process.platform);
    const arch = String(options.arch || process.arch);
    const share = parseShareUrl(options.shareUrl || DEFAULT_UPDATE_SHARE_URL);
    const downloadDirectory = String(options.downloadDirectory || '');

    async function check() {
        const baseStatus = updaterStatus(currentVersion, platform, arch, { shareUrl: share.shareUrl });
        if (!baseStatus.supported) {
            return {
                ...baseStatus,
                ok: true,
                updateAvailable: false,
                error: '현재 운영체제 또는 CPU용 업데이트 파일을 제공하지 않습니다.'
            };
        }
        if (!parseVersion(currentVersion)) throw new Error('현재 앱 버전을 확인하지 못했습니다.');

        const root = await fetchJson(fetchImpl, publicShareApiUrl(share));
        const releases = releaseDirectories(root.items);
        const latestVersion = releases[0]?.version || currentVersion;
        const newerReleases = releases.filter(release => compareVersions(release.version, currentVersion) > 0);

        for (const release of newerReleases) {
            const detail = await fetchJson(fetchImpl, publicShareApiUrl(share, release.version));
            const artifact = selectArtifact(detail.items, release.version, platform, arch);
            if (!artifact) continue;
            return {
                ...baseStatus,
                ok: true,
                updateAvailable: true,
                latestVersion,
                version: release.version,
                artifact: {
                    ...artifact,
                    downloadUrl: publicDownloadUrl(share, artifact.relativePath)
                }
            };
        }

        return {
            ...baseStatus,
            ok: true,
            updateAvailable: false,
            latestVersion,
            error: newerReleases.length > 0
                ? '새 버전은 있지만 현재 환경에 맞는 설치 파일이 없습니다.'
                : ''
        };
    }

    async function download(release, onProgress = () => {}) {
        const artifact = release?.artifact;
        if (!release?.updateAvailable || !artifact?.downloadUrl || !artifact.fileName) {
            throw new Error('다운로드할 업데이트가 없습니다.');
        }
        if (!downloadDirectory) throw new Error('업데이트 다운로드 경로가 비어 있습니다.');
        if (path.basename(artifact.fileName) !== artifact.fileName) throw new Error('업데이트 파일 이름이 올바르지 않습니다.');

        await fsp.mkdir(downloadDirectory, { recursive: true });
        const targetPath = path.join(downloadDirectory, artifact.fileName);
        const partialPath = `${targetPath}.part`;
        await pruneOldDownloads(downloadDirectory, artifact.fileName);
        await fsp.rm(partialPath, { force: true });

        const response = await fetchImpl(artifact.downloadUrl, {
            method: 'GET',
            headers: { Accept: 'application/octet-stream' },
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        });
        if (!response?.ok || !response.body) throw responseError(response, '업데이트 파일을 다운로드하지 못했습니다.');
        validateResponseLocation(response, artifact.downloadUrl);

        const expectedSize = Number(artifact.size);
        const contentLength = Number(response.headers?.get?.('content-length'));
        if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== expectedSize) {
            throw new Error('업데이트 파일 크기가 저장소 정보와 다릅니다.');
        }

        let received = 0;
        let lastPercent = -1;
        const progress = new Transform({
            transform(chunk, _encoding, callback) {
                received += chunk.length;
                if (received > expectedSize) {
                    callback(new Error('업데이트 파일 크기가 저장소 정보보다 큽니다.'));
                    return;
                }
                const percent = expectedSize > 0 ? Math.min(100, Math.floor((received / expectedSize) * 100)) : 0;
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    onProgress({ stage: 'downloading', received, total: expectedSize, percent });
                }
                callback(null, chunk);
            }
        });

        try {
            await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(partialPath, { flags: 'wx' }));
            const stat = await fsp.stat(partialPath);
            if (stat.size !== expectedSize) throw new Error('업데이트 파일 다운로드가 완전하지 않습니다.');
            await validateArtifactHeader(partialPath, artifact.extension);
            await fsp.rm(targetPath, { force: true });
            await fsp.rename(partialPath, targetPath);
            onProgress({ stage: 'downloaded', received: stat.size, total: expectedSize, percent: 100 });
            return targetPath;
        } catch (error) {
            await fsp.rm(partialPath, { force: true });
            throw error;
        }
    }

    return { check, download };
}

module.exports = {
    DEFAULT_UPDATE_SHARE_URL,
    compareVersions,
    createUpdater,
    parseShareUrl,
    parseVersion,
    publicDownloadUrl,
    publicShareApiUrl,
    releaseDirectories,
    selectArtifact,
    supportedArtifact,
    validateArtifactHeader
};
