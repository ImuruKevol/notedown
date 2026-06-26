# Android Capacitor 환경 구성 및 권한/네트워크 정책 추가

## 요청

- 리뷰 ID: `xxvinnsvhifwqghifludssinzxljtknm`
- 원문 요청: "현재 electron app의 기능을 모두 안드로이드 앱으로도 개발하고 싶어. 일단 안드로이드 환경부터 구성해줘. 환경 구성 시 필요한 권한같은것도 신경써야해"

## 변경 파일

- `package.json`: Capacitor 의존성 및 Android sync/open/run/debug build/clean 스크립트 추가
- `package-lock.json`: Capacitor 의존성 설치 반영
- `capacitor.config.json`: Notedown Android 앱 ID, 앱 이름, `bundle/www` webDir, Android mixed content 설정 추가
- `android/**`: Capacitor Android 네이티브 프로젝트 생성
- `android/app/src/main/AndroidManifest.xml`: 인터넷, 네트워크 상태, 이미지/레거시 외부 저장소 권한 추가 및 네트워크 보안 설정 연결
- `android/app/src/main/res/xml/network_security_config.xml`: 기본 cleartext 차단, 로컬 개발/동기화 호스트만 HTTP 허용
- `android/app/src/androidTest/java/com/notedown/app/ExampleInstrumentedTest.java`: 앱 패키지명 기준 instrumented test 정리
- `android/app/src/test/java/com/notedown/app/ExampleUnitTest.java`: 앱 패키지명 기준 unit test 정리
- `docs/android-environment.md`: Android SDK, 실행 명령, 권한, Storage Access Framework 이식 방향 문서화
- `README.md`: Android 환경 섹션과 문서 링크 추가

## 확인

- `npx cap doctor android`: 성공
- `npm run android:sync`: 성공
- `npm run android:build:debug`: 성공, `android/app/build/outputs/apk/debug/app-debug.apk` 생성
- `cd android && ./gradlew testDebugUnitTest --no-daemon`: 성공
- `aapt dump permissions android/app/build/outputs/apk/debug/app-debug.apk`: 의도한 Android 권한 반영 확인

## 참고

- 첫 debug 빌드 과정에서 Gradle이 Android SDK Build-Tools 35와 Android SDK Platform 36을 로컬 SDK에 설치했다.
- Electron의 `window.notedown` 브리지 기능은 아직 Android 네이티브 브리지로 이식되지 않았다. 이번 변경은 Android 런타임/빌드 환경 구성 범위다.
