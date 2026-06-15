# Electron 앱 배포 산출물 재빌드

## 사용자 원 요청

> 빌드 다시 해줘

## 변경 파일

- `build/dist/build/`
  - WIZ/Angular 빌드 결과를 갱신했다.
- `bundle/www/`
  - Electron 앱이 로드하는 웹 번들을 최신 빌드 결과로 갱신했다.
- `dist/`
  - macOS Apple Silicon, macOS Intel, Windows NSIS 배포 산출물을 재생성했다.
- `devlog.md`
  - 이번 재빌드 작업 요약 row를 추가했다.
- `devlog/2026-06-12/006-electron-release-rebuild.md`
  - 이번 재빌드 상세 기록을 추가했다.

## 생성 산출물

- `dist/Notedown-0.1.0-mac-arm64.dmg`
- `dist/Notedown-0.1.0-mac-arm64.zip`
- `dist/Notedown-0.1.0-mac-x64.dmg`
- `dist/Notedown-0.1.0-mac-x64.zip`
- `dist/Notedown-0.1.0-win-x64.exe`

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- `npm run dist:mac:arm64` 성공.
- `npm run dist:mac:x64` 성공.
- `npm run dist:win:nsis` 성공.
- 산출물 timestamp가 2026-06-12 13:20-13:22 KST 기준으로 갱신됨을 확인했다.
- macOS arm64 앱 실행 파일이 `Mach-O 64-bit executable arm64`로 생성됨을 확인했다.
- macOS Intel 앱 실행 파일이 `Mach-O 64-bit executable x86_64`로 생성됨을 확인했다.
- Windows unpacked 실행 파일이 `PE32+ executable (GUI) x86-64`로 생성됨을 확인했다.
- Windows NSIS 설치 파일이 `Nullsoft Installer self-extracting archive`로 생성됨을 확인했다.
- macOS 양쪽 앱 `Info.plist`에서 `CFBundleDisplayName`, `CFBundleExecutable`, `CFBundleIconFile`, `CFBundleIdentifier`, `CFBundleName`이 Notedown 설정으로 유지됨을 확인했다.
- macOS/Windows `app.asar` 내부 `package.json`에서 `name=notedown`, `productName=Notedown`, `main=electron/main.cjs`를 확인했다.
- macOS arm64/x64 앱에 대해 `codesign --verify --deep --strict --verbose=2` 검증이 통과했다.
- macOS 앱 서명 상태는 `Signature=adhoc`, `Identifier=com.notedown.app`로 확인했다.
- 패키징된 macOS icon.icns가 1024x1024, Windows icon.ico가 256x256으로 확인됐다.

## 남은 리스크

- macOS 산출물은 Apple Developer ID 서명이 아닌 ad-hoc 서명이며 notarization은 하지 않았다.
- Windows NSIS 설치 파일은 배포용 Authenticode 인증서 서명 검증을 수행하지 않았다.
- 실제 macOS/Windows 설치 및 실행 smoke test는 수행하지 않았다.
