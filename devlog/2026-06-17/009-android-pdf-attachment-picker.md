# Android PDF export 0B 방지 및 첨부 picker toolbar 전환

## 원 요청

- Android PDF 추출 기능이 저장은 되지만 0B로 생성되는 문제 수정.
- Android toolbar의 파일/이미지 첨부 버튼은 바로 파일 선택기를 열지 말고, 기존 첨부 목록을 먼저 보여주고 마크다운에 즉시 삽입할 수 있게 수정.
- 해당 목록 안에서도 새 파일/이미지 업로드 기능은 유지.

## 변경 파일

- `src/app/page.notes/view.ts`
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
- `devlog.md`
- `devlog/2026-06-17/009-android-pdf-attachment-picker.md`

## 작업 내용

- Android toolbar의 `이미지 첨부`/`파일 첨부` 버튼이 기존 첨부 picker를 열도록 변경.
- 첨부 picker는 기존 첨부 항목을 선택하면 마크다운 링크/이미지를 삽입하고, 마지막 항목에서 새 파일/이미지를 업로드할 수 있는 기존 흐름을 사용.
- Android PDF export에서 WebView를 Activity에 오프스크린으로 붙여 렌더링한 뒤 `PdfDocument`를 메모리 버퍼로 먼저 생성하도록 수정.
- 생성된 PDF byte 길이가 0이면 오류로 처리하고, 정상 byte만 Android 문서 URI에 쓰고 flush하도록 보강.
- Android PDF 저장 실패 시 브라우저 print fallback으로 넘어가지 않고 오류를 표시하도록 조정.

## 확인 결과

- `wiz_project_build` 성공.
- `npm run android:build:debug` 성공.
- 새 APK 빌드 성공.
- 중간에 무선 ADB가 offline이 된 뒤 장치 목록에서 사라져, 최종 빌드 APK의 실기기 재설치와 PDF 저장 완료 검증은 진행하지 못함.
