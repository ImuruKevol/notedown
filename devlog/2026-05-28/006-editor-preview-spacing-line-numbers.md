# Editor와 Preview 여백 축소 및 Preview 라인번호 추가

## 요청

Preview에 각 행 사이의 간격이 너무 넓고, Preview에도 각 라인 번호 보기 기능을 추가해달라는 요청. 기존 토글 버튼 하나로 editor와 Preview 라인 번호를 같이 동작시키고, editor 라인 번호와 실제 입력칸 사이 간격 및 editor/preview 영역 padding을 거의 없는 수준으로 줄여달라는 요청.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/006-editor-preview-spacing-line-numbers.md`

## 변경 내용

- Preview 영역 padding을 `px-8 py-12`에서 `p-2`로 줄였다.
- Preview 행 간격을 `0.75rem`에서 `0.125rem`로 줄이고, row/content 구조를 추가해 라인번호와 내용 정렬을 분리했다.
- 기존 라인번호 토글이 Preview 일반 행, 빈 행, 코드 preview에도 함께 반영되도록 했다.
- Monaco editor의 top/bottom padding과 line number gutter 폭을 줄여 라인번호와 본문 사이 간격을 좁혔다.

## 검증

- `wiz_project_build(clean=false)` 성공
- 요청 URL `http://172.16.0.143:3009`는 현재 연결되지 않음을 확인했다.
- 빌드 산출물을 `http://127.0.0.1:4210/notes`에서 정적 서버로 띄워 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- 라인번호 켜짐 상태에서 Preview 라인번호와 editor 라인번호가 표시됨을 확인했다.
- 동일 토글 클릭 후 Preview 라인번호와 editor 라인번호가 함께 사라짐을 확인했다.
- 스크린샷으로 Preview padding이 8px, Preview 행 gap이 2px로 반영되고 레이아웃이 깨지지 않음을 확인했다.
