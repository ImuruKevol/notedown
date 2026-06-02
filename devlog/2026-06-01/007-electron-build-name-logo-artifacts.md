# Electron 앱 이름/로고 빌드 설정 및 배포 산출물 생성

## 사용자 원 요청

> 작업 시작. 빌드할 때 로고 이미지와 이 서비스 이름이 확실하게 적용되어야 해.
>
> Electron 앱을 빌드해줘. mac apple 실리콘 버전, intel 칩 버전, 윈도우용 nsis 인스톨러 버전으로 각각 빌드해줘.

## 변경 파일

- `package.json`
  - `productName`, `author`, `description`을 추가해 빌드 메타데이터의 서비스명을 `Notedown`으로 고정했다.
  - `electron-builder`를 devDependency로 추가했다.
  - macOS arm64/x64, Windows x64 NSIS 빌드 스크립트를 추가했다.
  - `appId`, `productName`, macOS/Windows icon, macOS ad-hoc signing, NSIS 설정을 `build` 설정에 추가했다.
- `package-lock.json`
  - `electron-builder` 설치 및 루트 빌드 의존성 분류 변경을 반영했다.
- `electron/main.cjs`
  - Electron 런타임 앱 이름, Windows AppUserModelId, BrowserWindow title/icon을 `Notedown` 및 빌드 리소스 아이콘으로 고정했다.
- `build-resources/icon.png`
  - `src/assets/brand/icon.svg`에서 생성한 1024x1024 PNG 앱 아이콘.
- `build-resources/icon.icns`
  - macOS 빌드용 1024x1024 ICNS 앱 아이콘.
- `build-resources/icon.ico`
  - Windows 빌드용 16/32/48/64/128/256 멀티 사이즈 ICO 앱 아이콘.
- `bundle/www/`
  - WIZ/Angular 빌드 결과를 최신 Electron 번들로 갱신했다.
- `dist/`
  - macOS Apple Silicon, macOS Intel, Windows NSIS 배포 산출물을 생성했다.

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
- macOS arm64 앱 실행 파일이 `Mach-O 64-bit executable arm64`로 생성됨을 확인했다.
- macOS Intel 앱 실행 파일이 `Mach-O 64-bit executable x86_64`로 생성됨을 확인했다.
- Windows unpacked 실행 파일이 `PE32+ executable (GUI) x86-64`로 생성됨을 확인했다.
- macOS 양쪽 앱의 `Info.plist`에서 다음 값을 확인했다.
  - `CFBundleDisplayName`: `Notedown`
  - `CFBundleExecutable`: `Notedown`
  - `CFBundleIconFile`: `icon.icns`
  - `CFBundleIdentifier`: `com.notedown.app`
  - `CFBundleName`: `Notedown`
- macOS/Windows `app.asar` 내부 `package.json`에서 `name=notedown`, `productName=Notedown`, `main=electron/main.cjs`를 확인했다.
- 패키징된 `electron/main.cjs`에 `APP_NAME='Notedown'`, `APP_ID='com.notedown.app'`, `icon: APP_ICON_PATH`가 포함되어 있음을 확인했다.
- 패키징된 macOS icon.icns가 1024x1024로 포함되어 있음을 확인했다.
- macOS arm64/x64 앱에 대해 `codesign --verify --deep --strict --verbose=2` 검증이 통과했다.
- macOS 앱 서명 상태는 `Signature=adhoc`, `Identifier=com.notedown.app`로 확인했다.

## 남은 리스크

- 이번 macOS 산출물은 Apple Developer ID 서명이 아닌 ad-hoc 서명이며 notarization은 하지 않았다.
- Windows NSIS 설치 파일도 배포용 Authenticode 인증서 서명은 적용하지 않았다.
- 외부 배포 전 Apple Developer ID 서명/공증 및 Windows 코드 서명 인증서 적용이 필요하다.
