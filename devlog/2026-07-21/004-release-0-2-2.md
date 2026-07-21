# Notedown 0.2.2 및 Sync Server 1.0.1 멀티플랫폼 릴리스

- **ID**: 004
- **날짜**: 2026-07-21
- **유형**: 릴리스
- **리뷰 ID**: iqrklwzdbyyqkinhodmzryatwjmnvlhb

## 원문 요청사항

```text
버전 업데이트를 하고 릴리즈 노트 작성, git commit, tag 등을 해줘.
앱 빌드도 하고.
```

## 릴리스 버전

- Notedown Electron/Android: `0.2.2`
- Android versionCode: `4`
- Notedown Sync Server API: `1.0.1`

## 릴리스 노트

### 동기화 및 저장 무결성

- 서버, Electron, Android의 노트·첨부 ID와 논리/물리 경로 소유권 검증을 강화했다.
- 저장소별 작업 큐, 저장 세대 검증, 원자적 파일 쓰기를 적용해 느린 네트워크에서 오래된 응답이 최신 로컬 변경을 덮지 않도록 보강했다.
- 누락 항목을 암묵 삭제하지 않고 명시적 삭제 ID와 revision이 확인된 경우에만 삭제하도록 저장 계약을 통일했다.
- batch 요청의 전체 사전 검증과 stale metadata/rename 충돌 검사를 추가해 부분 적용과 suffix 파일 증가 가능성을 줄였다.

### 편집기 및 체크리스트

- 노트 전환 시 Monaco model 이벤트가 다른 노트에 적용되지 않도록 note ID와 binding epoch를 검증한다.
- 공백 없는 체크박스 `[]`도 진행률과 프리뷰에서 처리한다.
- 프리뷰 체크박스 및 내용 클릭 결과를 에디터 원문에 반영한다.

## 변경 파일 목록

### Notedown Sync Server

- `/Users/ktw/Documents/notedown-server/openapi_spec.py`
- `/Users/ktw/Documents/notedown-server/sync_store.py`
- `/Users/ktw/Documents/notedown-server/tests/test_sync_api.py`

### Notedown WIZ/Electron/Android

- `package.json`
- `package-lock.json` (로컬 `.gitignore` 대상)
- `android/app/build.gradle`
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
- `electron/main.cjs`
- `electron/keyed-queue.cjs`
- `electron/storage-identity.cjs`
- `electron/storage-runtime.test.cjs`
- `src/angular/app/notedown-android-bridge.ts`
- `src/app/component.nav.sidebar/view.ts`
- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-07-21/001-checkbox-progress-preview-sync.md`
- `devlog/2026-07-21/002-sync-slow-network-integrity-fix.md`
- `devlog/2026-07-21/003-compact-checkbox-syntax.md`
- `devlog/2026-07-21/004-release-0-2-2.md`

## Git 릴리스

- 서버 커밋: `9dfc614` (`fix: harden sync identity and atomic persistence`)
- 서버 annotated tag: `v1.0.1`
- 앱 릴리스 커밋 메시지: `release: Notedown 0.2.2`
- 앱 annotated tag: `0.2.2`

## 빌드 산출물

- macOS arm64: `dist/Notedown-0.2.2-mac-arm64.pkg`, `dist/Notedown-0.2.2-mac-arm64.zip`
- macOS x64: `dist/Notedown-0.2.2-mac-x64.pkg`, `dist/Notedown-0.2.2-mac-x64.zip`
- Windows x64: `dist/Notedown-0.2.2-win-x64.exe`
- Android: `android/app/build/outputs/apk/debug/notedown.apk`

## 검증 결과

- Server unittest 49개 통과 및 Python `py_compile` 통과.
- WIZ normal build 성공: `wiz_project_build(projectName="main", clean=false)`.
- Electron 저장소 queue/identity 회귀 테스트 15개 통과 및 `node --check` 통과.
- Android debug APK 빌드 성공. APK의 `versionCode 4`, `versionName 0.2.2`와 ZIP 무결성을 확인했다.
- macOS arm64/x64 PKG·ZIP 및 Windows x64 NSIS 빌드 성공.
- macOS arm64/x64 실행 파일 아키텍처와 `codesign --verify --deep --strict`를 확인했다.
- macOS/Windows `app.asar`의 앱 버전 `0.2.2`와 엔트리포인트 `electron/main.cjs`를 확인했다.
- `git diff --check` 통과.

## 산출물 SHA-256

- `Notedown-0.2.2-mac-arm64.pkg`: `429876baa3bb34e016fd5eb322a217ad5f53f1c9879dfcc33c013016064b436a`
- `Notedown-0.2.2-mac-arm64.zip`: `717ab4d56a4de6ae62c0531432b68865ca4bfce7e5cfb2f29a8c2fc7b94cb81b`
- `Notedown-0.2.2-mac-x64.pkg`: `f70ddb024ff5b74767b9ea5042d6a4c01ebe3fd44aadc6bc07999ce1fcf795fa`
- `Notedown-0.2.2-mac-x64.zip`: `882ed15143d901c729a1732e88214ccc81da6a90f05f1becaf99db1676b75318`
- `Notedown-0.2.2-win-x64.exe`: `6999d8db85e15f87b4a23b28709c6b25c4a0d977d716f049e4a7b0623c081156`
- `notedown.apk`: `aecea04ccfe7644eb3d117817a936f0452f6914f94cf4bee24bb36119a6f8b03`

## 알려진 제한 사항

- page/sidebar/layout이 별도 노트 상태를 보유하고 전체 snapshot을 저장하는 구조와 노트별 dirty 추적 부재는 이번 릴리스에 남아 있다. 저속 IPC·동기화와 노트 전환이 겹치면 미저장 변경 유실 가능성이 있다.
- 실제 Windows Electron + USB 테더링 장시간 E2E와 실제 기기 설치 검증은 수행하지 않았다.
- macOS 앱은 ad-hoc 서명이고 PKG는 미서명·미공증이며, Windows NSIS도 Authenticode 서명이 없다.
- 기존 suffix·고아 파일은 데이터 손실 위험 때문에 자동 정리하지 않았다.
