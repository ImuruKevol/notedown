# Android PDF density 보정 및 이미지 첨부 preview 복구

## 원 요청

- 첨부한 PDF처럼 Android PDF export 결과가 Electron 앱과 다르게 크게 깨지는 문제 수정.
- toolbar에서 파일/이미지를 첨부한 뒤 preview에서 정상적으로 보이지 않는 문제 수정.

## 변경 파일

- `src/app/page.notes/view.ts`
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
- `devlog.md`
- `devlog/2026-06-17/010-android-pdf-density-attachment-preview.md`

## 작업 내용

- 첨부 PDF를 QuickLook으로 렌더링해 Android PDF가 화면 density만큼 확대되어 출력되는 현상을 확인.
- Android PDF 생성 시 WebView layout 크기는 density를 곱한 픽셀 단위로 잡고, PDF canvas에는 `1 / density` scale을 적용하도록 수정.
- Android preview/PDF export에서 이미지 첨부를 `notedown-attachment://` 프로토콜 대신 `readFile` 기반 data URL 캐시로 변환하도록 수정.
- PDF export 전에 Android 이미지 첨부 data URL을 미리 로드해 export HTML에도 이미지가 포함되도록 보강.

## 확인 결과

- 첨부 PDF 첫 페이지 렌더링으로 문제 양상 확인.
- `wiz_project_build` 성공.
- `npm run android:build:debug` 성공.
- ADB 장치가 연결되어 있지 않아 최종 APK 실기기 설치, 실제 Android PDF 저장 파일 재렌더링, preview 이미지 표시 실기기 검증은 진행하지 못함.
