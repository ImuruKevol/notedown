# Android 런처 아이콘을 Electron 앱 아이콘으로 교체

## 원 요청

- Android 앱 아이콘을 Electron 앱과 동일한 아이콘으로 적용.

## 변경 파일

- `android/app/src/main/res/mipmap-mdpi/ic_launcher.png`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png`
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher.png`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png`
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png`
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png`
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png`
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png`
- `devlog.md`
- `devlog/2026-06-17/014-android-launcher-icon.md`

## 작업 내용

- Electron 앱에서 사용하는 `build-resources/icon.png` 1024px 원본을 Android launcher icon 원본으로 사용.
- Android legacy launcher icon, round icon, adaptive foreground icon을 mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi density별 크기로 재생성.

## 확인 결과

- `mipmap-xxxhdpi/ic_launcher.png`를 열어 Electron 앱과 동일한 문서 아이콘이 들어간 것을 확인.
- `cd android && ./gradlew :app:assembleDebug` 성공.
