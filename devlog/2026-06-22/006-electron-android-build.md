# Electron 및 Android 앱 빌드

- **ID**: 006
- **날짜**: 2026-06-22
- **유형**: 빌드

## 작업 요약
WIZ 프론트엔드 번들을 새로 생성한 뒤 Electron 배포 산출물과 Android debug APK를 빌드했습니다. Electron은 macOS arm64/x64 DMG 및 ZIP, Windows x64 NSIS 설치 파일을 생성했고 Android는 debug APK를 생성했습니다.

## 원문 요청사항
```text
electron app과 android app을 빌드해줘
```

## 변경 파일 목록
- `dist/Notedown-0.1.0-mac-arm64.dmg`
- `dist/Notedown-0.1.0-mac-arm64.zip`
- `dist/Notedown-0.1.0-mac-x64.dmg`
- `dist/Notedown-0.1.0-mac-x64.zip`
- `dist/Notedown-0.1.0-win-x64.exe`
- `android/app/build/outputs/apk/debug/app-debug.apk`
- `devlog.md`
- `devlog/2026-06-22/006-electron-android-build.md`

## 검증 결과
- `wiz_project_build(clean=false, projectName="main")` 성공.
- `npm run dist:requested` 성공.
- `npm run android:build:debug` 성공.
- Electron builder 경고: macOS notarization 설정이 없어 notarization은 건너뜀.
- Android Gradle 경고: `flatDir` 사용 경고가 표시됐으나 `assembleDebug`는 성공.
