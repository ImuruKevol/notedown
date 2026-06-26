# Android 네이티브 브리지 및 에뮬레이터 실행 검증

## 요청

- 리뷰 ID: `xxvinnsvhifwqghifludssinzxljtknm`
- 원문 요청: "예전에 안드로이드 스튜디오를 설치해서 adb?도 구성을 했었으니 에뮬레이터쪽은 있을거야. 확인해줘. 이제 본격적으로 앱을 개발해줘."

## 변경 파일

- `android/app/src/main/java/com/notedown/app/MainActivity.java`: Capacitor 시작 시 `NotedownNativePlugin` 등록
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`: Android 앱 설정, 앱 전용 로컬 저장소, Markdown/metadata 저장/로드, 첨부 저장/열기, 파일 읽기 네이티브 브리지 추가
- `android/app/src/main/res/xml/file_paths.xml`: 앱 내부/외부 파일 및 캐시 경로를 `FileProvider` 공유 경로에 추가
- `src/angular/main.ts`: Android 브리지 초기화 모듈 로드
- `src/angular/app/notedown-android-bridge.ts`: Capacitor Android에서 `window.notedown` 브리지 구성 및 기본 sync health/setup/login 요청 연결
- `README.md`: Android 앱 브리지 지원 범위 설명 갱신
- `docs/android-environment.md`: Android 네이티브 브리지 지원 범위와 현재 한계 문서화
- `devlog.md`, `devlog/2026-06-17/003-android-native-bridge-emulator.md`: 작업 로그 추가

## 확인

- Android SDK 경로 `/Users/ktw/Library/Android/sdk` 및 `adb` 설치 확인
- AVD `Pixel_3a_API_34_extension_level_7_arm64-v8a` 존재 확인
- `npm run android:build:debug`: 성공, Android APK 빌드 및 Capacitor sync 완료
- `wiz_project_build`: 성공, WIZ/Angular 번들 생성 완료
- `cd android && ./gradlew testDebugUnitTest --no-daemon`: 성공
- 에뮬레이터 부팅 후 `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`: 성공
- `adb shell am start -n com.notedown.app/.MainActivity`: 성공, 포그라운드 Activity가 `com.notedown.app/.MainActivity`임을 확인
- Android 스크린샷에서 Notedown 노트 화면이 정상 렌더링되는 것을 확인
- logcat에서 `NotedownNative` 플러그인 등록과 `https://localhost` 앱 로드를 확인했고 치명적 크래시는 발견하지 못함
- WebView DevTools 프로토콜로 `window.notedown.platform === "android"` 및 `Capacitor.Plugins.NotedownNative` 존재 확인
- `window.notedown.storage.defaultPath()`, `initialize()`, `info()` 직접 호출 성공
- 에뮬레이터 파일 시스템에서 `/sdcard/Android/data/com.notedown.app/files/Documents/Notedown Notes/metadata.json` 생성 확인

## 참고

- Android 디렉터리 선택은 현재 앱 전용 기본 저장소를 반환한다. 임의 공유 폴더 선택까지 필요하면 Storage Access Framework 기반 picker가 추가로 필요하다.
- 전체 동기화 plan/run/upload/conflict resolution, PDF 저장, 임의 파일 첨부 picker는 아직 Android 완전 이식 범위에 남아 있다.
- WebView 로그에서 safe-area CSS 주입 경고와 `ResizeObserver loop limit exceeded`가 보였지만 앱 실행을 막지는 않았다.
