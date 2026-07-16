# 서버 이미지 배포 및 Notedown 0.2.1 멀티플랫폼 릴리스

- **ID**: 002
- **날짜**: 2026-07-16
- **리뷰 ID**: xfathofjjkckpklnslutpdfzwbebgnyu
- **유형**: 릴리스

## 원문 요청사항

```text
서버의 이미지를 빌드하고 push까지 해줘.
맥용, 윈도우용, 안드로이드용들에 대해 버전을 올리고 git commit, tag까지 해줘.
맥용 설치파일도 재생성하고.
```

## 변경 파일 목록

- `package.json`
  - Electron 앱 버전을 `0.2.1`로 올렸다.
- `package-lock.json`
  - 로컬 lockfile 버전을 `0.2.1`로 맞췄다. 이 파일은 현재 `.gitignore` 대상이다.
- `android/app/build.gradle`
  - Android `versionCode`를 `3`, `versionName`을 `0.2.1`로 올렸다.
- `devlog.md`
- `devlog/2026-07-16/002-release-0-2-1.md`
- `/Users/ktw/Documents/notedown-server/.dockerignore`
  - 로컬 Playwright 작업 디렉토리를 Docker 빌드 컨텍스트에서 제외했다.
- `/Users/ktw/Documents/notedown-server/sync_store.py`
- `/Users/ktw/Documents/notedown-server/tests/test_sync_api.py`
  - 이번 릴리스에 포함되는 첫 동기화 metadata 충돌 수정과 회귀 테스트다.

## 배포 및 산출물

- 서버 커밋: `0dea814` (`fix: normalize metadata sync conflicts`)
- 서버 이미지:
  - `registry.nanoha.kr/kwon3286/notedown-server:260716`
  - `registry.nanoha.kr/kwon3286/notedown-server:latest`
  - 원격 다이제스트: `sha256:59f9257adbc89c8e39cdb9b9015dd438fccec2426f24229f707129a02f698cb9`
- Electron/Android 릴리스 버전: `0.2.1`
- macOS arm64: `dist/Notedown-0.2.1-mac-arm64.pkg`, `dist/Notedown-0.2.1-mac-arm64.zip`
- macOS x64: `dist/Notedown-0.2.1-mac-x64.pkg`, `dist/Notedown-0.2.1-mac-x64.zip`
- Windows x64: `dist/Notedown-0.2.1-win-x64.exe`
- Android: `android/app/build/outputs/apk/debug/notedown.apk`
- 앱 소스 태그: `0.2.1` (annotated tag)

## 검증 결과

- `python -m unittest discover -s tests`: 서버 테스트 38개 통과.
- 새 서버 이미지 컨테이너의 `/api/health`: `{"status":"ok"}`.
- 날짜 태그와 `latest`의 원격 manifest가 동일한 다이제스트임을 확인했다.
- `wiz_project_build(clean=false, projectName="main")`: 성공.
- `npm run android:build:debug`: 성공.
- `npm run dist:mac:arm64`: 성공.
- `npm run dist:mac:x64`: 성공.
- `npm run dist:win:nsis`: 성공.
- macOS PKG의 앱 버전 `0.2.1`과 설치 스크립트가 `preinstall` 하나뿐임을 확인했다.
- Windows `app.asar`의 버전 `0.2.1`을 확인했다.
- Android APK의 `versionCode 3`, `versionName 0.2.1` 및 ZIP 무결성을 확인했다.

## 산출물 SHA-256

- `Notedown-0.2.1-mac-arm64.pkg`: `e65eb8a0ea0196a6fb24995962cd90e457f0e1135eb6e26b203cb84d5aee8f44`
- `Notedown-0.2.1-mac-arm64.zip`: `b2b0d01c4fef8a480f76c14b5c3c30feee3cc1c14b3ba54011e116ff299caa8a`
- `Notedown-0.2.1-mac-x64.pkg`: `195bd85bfce61fb1f69fc89c4ce1bb97a47eea63b0f9b5c57d288eb31dceb18c`
- `Notedown-0.2.1-mac-x64.zip`: `cb8b4ddd7b624da1aa2d51398ab76625a16eea98d7a5a06b41a2aeb083cdab82`
- `Notedown-0.2.1-win-x64.exe`: `8b1f06031d7156e8a4a16ad90c2db5b4c343fad0f40b536107f916113a60131f`
- `notedown.apk`: `04aa8d2f4e84cd9bbe8755e1721192a2f682fff8d84a84b6c6cb31966669af1d`

## 남은 사항

- Docker registry push는 완료했다.
- GitHub HTTPS 인증을 macOS Keychain에서 읽지 못해 소스 원격 push는 완료하지 못했다. 커밋과 앱 태그는 로컬 저장소에 생성한다.
- macOS 패키지는 notarization이 설정되지 않아 공증되지 않았다.
- Windows와 Android는 패키지 빌드 및 무결성을 확인했으며 실제 기기 설치 검증은 수행하지 않았다.
