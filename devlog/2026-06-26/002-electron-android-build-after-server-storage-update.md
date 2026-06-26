# 서버 저장 로직 개선 후 Electron 및 Android 앱 빌드

- **ID**: 002
- **날짜**: 2026-06-26
- **유형**: 빌드 검증

## 작업 요약

Notedown Sync Server 저장 로직 개선 후 현재 WIZ 번들을 다시 생성하고 Electron macOS arm64 패키지와 Android debug APK를 빌드했다.
서버 쪽 마이그레이션 전용 런타임 로직 제거 및 README 갱신 작업 이후 앱 패키징이 가능한지 확인했다.

## 원문 요청사항

```text
마이그레이션이라는 로직 자체가 필요 없다니까? 변경이 되었으면 변경된 로직으로 쓰면 되는거야.
그리고 README들을 현재 개선된 내용들에 맞춰서 업데이트해줘.
그 후엔 electron app과 android app을 빌드해줘.
```

## 변경 파일 목록

- `build/dist/build/`: `wiz_project_build(clean=false)`로 WIZ/Angular 번들 재생성
- `bundle/www/`: Electron/Capacitor가 로드하는 웹 번들 갱신
- `dist/Notedown-0.1.0-mac-arm64.dmg`: Electron macOS arm64 DMG 산출물 생성
- `dist/Notedown-0.1.0-mac-arm64.zip`: Electron macOS arm64 ZIP 산출물 생성
- `android/app/build/outputs/apk/debug/app-debug.apk`: Android debug APK 산출물 생성
- `devlog.md`, `devlog/2026-06-26/002-electron-android-build-after-server-storage-update.md`: 작업 기록 추가

## 검증 결과

- `wiz_project_build(clean=false, projectName="main")` 성공
- `npm run dist:mac:arm64` 성공
- `npm run android:build:debug` 성공
