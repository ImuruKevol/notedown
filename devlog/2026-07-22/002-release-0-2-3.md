# Notedown 0.2.3 멀티플랫폼 릴리스

- **ID**: 002
- **날짜**: 2026-07-22
- **유형**: 릴리스
- **리뷰 ID**: kzkolrlhzmnshiamcjidlwnbmycydvnb

## 원문 요청사항

```text
버전을 올리고 git commit, tag, 빌드 등 관련 동작들을 진행해줘.
```

## 릴리스 버전

- Notedown Electron/Android: `0.2.3`
- Android versionCode: `5`
- Notedown Sync Server API: `1.0.1` (변경 없음)

## 릴리스 노트

- 노트 목록 하단에 저장 동작과 분리된 수동 전체 동기화 버튼을 추가했다.
- 설정에서 FileBrowser 공유 저장소의 최신 버전을 확인하고 플랫폼별 PKG/EXE를 내려받아 설치한 뒤 앱을 다시 실행할 수 있다.
- 다운로드 크기 상한, 초과 수신 중단, 동일 출처 제한, 임시 파일 정리와 설치 파일 기본 형식 검증을 적용했다.
- Windows 업데이트 설치는 기존 초기 설정을 보존하고 설치 완료 후 앱을 강제로 다시 실행한다.

## 변경 파일 목록

- `package.json`: Electron 앱 버전 `0.2.3` 및 Electron 테스트 명령
- `package-lock.json`: 로컬 lockfile 버전 `0.2.3` (gitignore 대상)
- `android/app/build.gradle`: Android `versionCode 5`, `versionName 0.2.3`
- `electron/main.cjs`, `electron/preload.cjs`, `electron/updater.cjs`, `electron/updater.test.cjs`
- `build-resources/installer.nsh`
- `src/app/component.nav.sidebar/view.pug`, `src/app/component.nav.sidebar/view.ts`
- `src/app/layout.sidebar/view.pug`, `src/app/layout.sidebar/view.ts`
- `src/app/page.settings/view.pug`, `src/app/page.settings/view.ts`
- `README.md`
- `devlog.md`, `devlog/2026-07-22/001-manual-sync-in-app-update.md`, `devlog/2026-07-22/002-release-0-2-3.md`

## Git 릴리스

- 앱 릴리스 커밋 메시지: `release: Notedown 0.2.3`
- 앱 annotated tag: `0.2.3`
- 서버 저장소: 변경·커밋·태그 없음

## 빌드 산출물

- macOS arm64: `dist/Notedown-0.2.3-mac-arm64.pkg`, `dist/Notedown-0.2.3-mac-arm64.zip`
- macOS x64: `dist/Notedown-0.2.3-mac-x64.pkg`, `dist/Notedown-0.2.3-mac-x64.zip`
- Windows x64: `dist/Notedown-0.2.3-win-x64.exe`
- Android: `android/app/build/outputs/apk/debug/notedown.apk`

## 검증 결과

- WIZ 일반 빌드(`clean=false`) 성공.
- Electron 테스트 21개 통과, main/preload/updater 구문 검사와 `git diff --check` 통과.
- macOS arm64/x64 PKG·ZIP과 Windows x64 NSIS 빌드 성공.
- macOS 실행 파일의 arm64/x86_64 아키텍처, 앱 버전 `0.2.3`, ad-hoc codesign 무결성을 확인했다.
- macOS/Windows ASAR의 버전 `0.2.3`, updater 포함, Windows `--force-run` 재실행 인자를 확인했다.
- Android debug APK 빌드 및 ZIP 무결성 검사에 성공했고 `versionCode 5`, `versionName 0.2.3`을 확인했다.

## 산출물 SHA-256

- `Notedown-0.2.3-mac-arm64.pkg`: `6a161e35ed8cdbc7ac1d52a5028a8972cf329b5aa03e604abb664b2312be572a`
- `Notedown-0.2.3-mac-arm64.zip`: `56480e87b5933eb8f007c1eb0ffc4bae6d707619adaef04d463caf707e29eaf5`
- `Notedown-0.2.3-mac-x64.pkg`: `57b84662717c794944109f5918200d76e754a7a61c5c55289f756f8d5f6b103d`
- `Notedown-0.2.3-mac-x64.zip`: `983e762cdaee8e325700739158c463c5eeb9e7cac45c2080837063b8e9ba50c0`
- `Notedown-0.2.3-win-x64.exe`: `35e1f9f8d2de6efc3a3e5bbe353a7feecb0de3b7e1df59c2e407b312c50d16de`
- `notedown.apk`: `fdaeada7a0f046a4312f6f8ca64088b8a44c317978d82bb486283e862bf7e703`

## 알려진 제한 사항

- macOS PKG는 미서명·미공증이고 Windows NSIS도 Authenticode 서명이 없어, 운영 자동 업데이트 전 배포자 서명 또는 별도 서명 manifest가 필요하다.
- 실제 이전 버전 설치본에서 업데이트 설치와 재실행을 끝까지 수행하는 macOS/Windows E2E는 수행하지 않았다.
- 산출물은 로컬에 생성했으며 FileBrowser 공유 저장소 업로드와 Git 원격 push는 이번 요청 범위에서 수행하지 않았다.
