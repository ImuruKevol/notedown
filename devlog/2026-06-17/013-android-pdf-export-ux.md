# Android PDF 저장 로딩 표시 및 완료 알림 추가

## 원 요청

- Android PDF 저장 시 export가 오래 걸리는데 로딩 표시가 없어 0B 파일로 보이는 UX 문제 개선.
- PDF 저장 완료 시 다운로드 완료 알림을 표시하고, 알림에서 해당 PDF를 바로 열 수 있도록 개선.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/app/notedown-android-bridge.ts`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
- `android/app/src/main/res/drawable/ic_notification_pdf.xml`
- `devlog.md`
- `devlog/2026-06-17/013-android-pdf-export-ux.md`

## 작업 내용

- PDF 저장 버튼에 진행 중 spinner와 disabled 상태를 추가.
- 노트 화면 하단에 PDF 저장 중 오버레이를 추가해 긴 export 동안 진행 상태를 표시.
- Android PDF 흐름을 `preparePdf`에서 완성 PDF bytes를 먼저 생성하고 cache token을 반환한 뒤, DocumentsUI 저장 단계에서는 준비된 bytes를 즉시 쓰도록 변경.
- Android 13 이상 알림 권한을 요청할 수 있도록 `POST_NOTIFICATIONS` 권한과 Capacitor permission alias를 추가.
- PDF 저장 완료 후 notification channel을 통해 다운로드 완료 알림을 표시하고, 알림 클릭 시 저장된 PDF URI를 `ACTION_VIEW`로 열도록 연결.
- 알림 권한이 없거나 알림 생성이 실패하면 toast로 저장 완료를 fallback 표시하도록 처리.

## 확인 결과

- `wiz_project_build` 성공.
- `npm run android:sync && cd android && ./gradlew :app:assembleDebug` 성공.
- `adb devices -l` 기준 현재 연결된 Android 기기가 없어 실기기 설치와 완료 알림 클릭 검증은 진행하지 못함.
