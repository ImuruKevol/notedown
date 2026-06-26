# PDF export 이미지 레이아웃 안정화 및 첨부 ZIP 옵션 추가

## 사용자 원 요청

작업 시작

리뷰 ID: `pvtbdltwmisyalbkottalpvbesguelwp`

리뷰어 요청:
- Electron, Android 모두 PDF export가 불안정함.
- 고해상도 이미지가 들어가도 폰트 사이즈는 일정해야 하며 이미지는 화면/PDF 폭에 맞아야 함.
- 첨부 파일/이미지가 있는 경우 PDF export 시 Markdown 문법으로 삽입된 이미지만 포함할지, 모든 첨부를 포함해 ZIP으로 export할지 선택할 수 있어야 함.
- Android PDF export 결과의 폰트 사이즈, 페이지 여백, padding, margin이 Electron과 맞지 않음.
- Android에서 이미지 포함 PDF 용량이 과도하게 커짐.

## 변경 파일

- `src/app/page.notes/view.ts`
  - PDF export 옵션 모달 상태와 `markdown-images` / `zip-with-attachments` export mode를 추가.
  - Markdown 본문에 실제 삽입된 이미지 첨부만 PDF 이미지로 preload하도록 변경.
  - Android PDF export 전용 이미지 data URL cache를 분리하고 큰 이미지를 최대 1400x2000px JPEG로 축소.
  - PDF HTML/CSS에 A4 page size, 고정 body font size, Android screen media padding, 이미지 max-width/height, table/pre overflow 보정을 추가.
- `src/app/page.notes/view.pug`
  - PDF 버튼을 옵션 진입점으로 변경.
  - 첨부가 있는 노트에서 Markdown 이미지 PDF / PDF + 모든 첨부 ZIP 선택 모달을 추가.
- `electron/main.cjs`
  - Electron PDF 렌더링을 재사용 함수로 분리.
  - Node 내장 `zlib` 기반 ZIP 생성 로직을 추가.
  - `zip-with-attachments` mode에서 PDF와 모든 첨부를 ZIP으로 저장하도록 확장.
- `src/angular/app/notedown-android-bridge.ts`
  - Android native `savePdf` 호출에 export mode, storage path, attachments payload를 전달.
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
  - Android 저장 다이얼로그가 PDF/ZIP MIME과 확장자를 구분하도록 변경.
  - 준비된 PDF cache를 재사용해 PDF + attachments ZIP을 생성하는 `ZipOutputStream` 경로를 추가.
  - ZIP export 시 PDF 열기 알림은 띄우지 않도록 저장 응답을 분리.

## 검증 결과

- `node --check electron/main.cjs` 성공.
- `wiz_project_build(projectName=main, clean=false)` 성공.
- `bundle/www/main.js`와 `build/dist/build/main.js`에서 `zip-with-attachments`, PDF 옵션 UI, Android 이미지 축소 로직 반영 확인.
- `npm run android:sync` 성공.
- `cd android && ./gradlew assembleDebug` 성공.
- 요청 링크 `http://172.16.0.143:3009`는 현재 머신에서 연결 실패하여 화면 클릭/실제 PDF 저장 결과물 검증은 수행하지 못함.

## 남은 리스크

- 실제 Electron/Android 저장 다이얼로그와 생성된 PDF/ZIP 파일의 시각 결과는 런타임 앱에서 추가 확인이 필요함.
- Android PDF 용량은 큰 이미지 data URL 축소로 완화했지만, WebView/PdfDocument 렌더링 특성상 기기별 PDF 내부 인코딩 차이는 남을 수 있음.
