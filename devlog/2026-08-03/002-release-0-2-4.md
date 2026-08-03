# Notedown 0.2.4 멀티플랫폼 릴리스

- **ID**: 002
- **날짜**: 2026-08-03
- **유형**: 릴리스

## 작업 요약

충돌 해결 후 병합 뷰어가 남던 버그 수정을 포함해 Notedown Electron/Android 버전을 `0.2.4`로 상향했다.
WIZ 번들, macOS ARM64/x64, Windows x64, Android debug 앱을 모두 빌드하고 버전·아키텍처·무결성을 검증한 뒤 릴리스 커밋과 annotated tag를 생성한다.

## 원문 요청사항

```text
git commit, tag를 하면서 버전을 올려줘.
app build도 싹 하고
```

## 릴리스 버전

- Notedown Electron/Android: `0.2.4`
- Android versionCode: `6`

## 릴리스 노트

- 서버 또는 로컬 버전으로 충돌을 해결한 성공 파일이 충돌 목록에 다시 등록되지 않도록 수정했다.
- 실제 충돌 응답만 병합 뷰어에 유지하고, 남은 충돌이 없으면 노트 편집 화면으로 즉시 복귀한다.
- 노트, 설정, 포커스/수동 동기화 상태 소비 지점에 같은 판정 기준을 적용했다.

## 변경 파일 목록

- `package.json`: Electron 앱 버전 `0.2.4`
- `package-lock.json`: 로컬 lockfile 버전 `0.2.4` (gitignore 대상)
- `android/app/build.gradle`: Android `versionCode 6`, `versionName 0.2.4`
- `src/app/page.notes/view.ts`: 충돌 해결 성공 파일의 충돌 재등록 방지
- `src/app/page.settings/view.ts`: 설정 화면 충돌 상태 판정 보강
- `src/app/layout.sidebar/view.ts`: 포커스/수동 동기화 충돌 상태 판정 보강
- `devlog.md`
- `devlog/2026-08-03/001-sync-conflict-viewer-dismiss.md`
- `devlog/2026-08-03/002-release-0-2-4.md`

## Git 릴리스

- 앱 릴리스 커밋 메시지: `release: Notedown 0.2.4`
- 앱 annotated tag: `0.2.4`

## 빌드 산출물

- macOS arm64: `dist/Notedown-0.2.4-mac-arm64.pkg`, `dist/Notedown-0.2.4-mac-arm64.zip`
- macOS x64: `dist/Notedown-0.2.4-mac-x64.pkg`, `dist/Notedown-0.2.4-mac-x64.zip`
- Windows x64: `dist/Notedown-0.2.4-win-x64.exe`
- Android: `android/app/build/outputs/apk/debug/notedown.apk`

## 검증 결과

- WIZ 일반 빌드(`clean=false`) 성공.
- Electron 테스트 21개 통과, main/preload/updater 구문 검사와 `git diff --check` 통과.
- macOS arm64/x64 PKG·ZIP과 Windows x64 NSIS 빌드 성공.
- macOS 실행 파일의 arm64/x86_64 아키텍처, 앱 버전 `0.2.4`, ad-hoc codesign 무결성을 확인했다.
- macOS/Windows ASAR의 버전 `0.2.4`, updater 파일 포함, Windows `--force-run` 재실행 인자를 확인했다.
- Android는 기본 JDK 17에서 Java 21 source 오류가 발생해 JDK 24로 재실행했으며, debug APK 빌드와 ZIP 무결성 검사에 성공했다.
- Android APK의 `versionCode 6`, `versionName 0.2.4`, minSdk 24, targetSdk 36을 확인했다.

## 산출물 SHA-256

- `Notedown-0.2.4-mac-arm64.pkg`: `c545869af10558a91ebf40ce893fcfcaf3e88be63702d2b94ca1536f88583dfe`
- `Notedown-0.2.4-mac-arm64.zip`: `505a66bc30e3a6ff14ea879fd4bd87a6cb81d96caf59ac316b4509ff4810f066`
- `Notedown-0.2.4-mac-x64.pkg`: `944a03c39b2eecc3476097a2b841b5f8cb7dbe98abdc35d9bbfeace447022161`
- `Notedown-0.2.4-mac-x64.zip`: `b0537c8c229430acbd0f4579fc791be425226067684716ef7985f5e0a57e44dd`
- `Notedown-0.2.4-win-x64.exe`: `be6165269b8489b05156d153c2a2e5e64bd38518a9eab0bf53cecf46c282e62e`
- `notedown.apk`: `1a0e29025578ea02a4b38c155616732a9d039cd1ac5c23de81090665a87a043d`

## 알려진 제한 사항

- macOS PKG는 미서명·미공증이고 Windows NSIS도 Authenticode 서명이 없어 운영 배포 전 서명이 필요하다.
- 실제 이전 버전 설치본에서 업데이트 설치와 재실행을 끝까지 수행하는 macOS/Windows E2E는 수행하지 않았다.
- 산출물은 로컬에 생성했으며 원격 저장소 push나 배포 저장소 업로드는 이번 요청 범위에서 수행하지 않았다.
