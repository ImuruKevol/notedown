# Android 실기기 PDF 저장 Activity payload 크래시 수정

## 원 요청

- 무선 디버깅 설정을 다시 했으니 실제 Android 기기에서 수정한 부분을 확인.

## 변경 파일

- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
- `src/angular/app/notedown-android-bridge.ts`
- `devlog.md`
- `devlog/2026-06-17/012-android-pdf-activity-payload-fix.md`

## 작업 내용

- SM-F966N 무선 ADB 연결 상태에서 최신 debug APK를 설치하고 PDF 저장 흐름을 재현.
- PDF export가 Android DocumentsUI로 전환될 때 base64 이미지가 포함된 큰 HTML payload가 Capacitor Activity saved state에 저장되어 `TransactionTooLargeException`을 유발하는 것을 확인.
- Android native plugin에 `preparePdf`를 추가해 export HTML을 앱 캐시에 임시 저장하고, DocumentsUI를 여는 `savePdf`에는 작은 token만 전달하도록 변경.
- 저장 완료 후 임시 PDF HTML 파일을 정리하고, 24시간 이상 지난 pending PDF cache도 정리하도록 보강.

## 확인 결과

- `wiz_project_build` 성공.
- `npm run android:sync && cd android && ./gradlew :app:assembleDebug` 성공.
- SM-F966N 무선 ADB 연결 확인 및 APK 재설치 성공.
- 실제 기기 WebView에서 preview 이미지가 data URL로 로드되고 `naturalWidth=3000`, `naturalHeight=4000`인 것을 확인.
- 실제 Android DocumentsUI 저장 후 native `savePdf` 결과가 `ok=true`, `bytes=54909660`, `pages=14`로 반환되는 것을 확인.
- 저장 후 Notedown 앱 PID가 유지되고 최근 logcat에 `TransactionTooLargeException` 또는 FATAL crash 로그가 없는 것을 확인.
