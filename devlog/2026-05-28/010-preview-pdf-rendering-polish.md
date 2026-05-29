# Preview quote/table 렌더링 및 PDF 출력 스타일 개선

## 요청

리뷰 ID `eysfhbyfqeipnzeyfihohgquvhvuagjb`의 "Preview, pdf 개선" 요청. Preview에서 줄 번호와 텍스트의 세로 정렬을 맞추고, quote 타입의 디자인과 여백을 PDF 출력처럼 정리하며 연속 quote 행은 붙여서 표시하고, PDF 출력 시 왼쪽 체크박스가 살짝 잘리는 문제와 Preview/PDF 스타일 차이를 줄이며, table 타입이 Preview에서 제대로 처리되도록 개선해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/styles/styles.scss`
- `electron/main.cjs`
- `devlog.md`
- `devlog/2026-05-28/010-preview-pdf-rendering-polish.md`

## 변경 내용

- Preview 블록 메타데이터에 quote/table variant와 다중 라인 번호 정보를 추가했다.
- Markdown table은 헤더/구분선/행을 하나의 블록으로 묶어 Showdown table 렌더링이 정상 동작하도록 했다.
- quote 행은 연속 여부를 감지해 간격 없이 붙이고, Tailwind Typography의 자동 따옴표와 italic 스타일을 제거해 PDF와 유사한 blockquote 스타일로 맞췄다.
- Preview 라인번호와 텍스트의 line-height/min-height를 통일하고, 다중 라인 번호를 지원하도록 템플릿을 조정했다.
- PDF HTML에서 Showdown tasklist의 inline style을 제거하고 task list 전용 class/CSS를 적용해 체크박스 왼쪽이 잘리지 않도록 했다.
- Electron PDF 출력 margin을 `printableArea`에서 `none`으로 바꿔 CSS `@page` margin 기준으로 출력되도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `node --check electron/main.cjs` 성공
- `git diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/angular/styles/styles.scss electron/main.cjs` 성공
- 요청 링크 `http://172.16.0.143:3009/notes`에서 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- 테스트 노트에서 quote 행 2개가 `is-quote`로 감지되고 행 사이 gap이 `0`, quote pseudo content가 `none`인 것을 확인했다.
- Markdown table이 실제 `<table>`로 렌더링되고 `이름/값`, `Quote/Table`, `체크/OK` 셀이 표시되는 것을 확인했다.
- 일반 텍스트 행의 라인번호와 텍스트 상단/높이 차이가 `0`으로 계산되는 것을 확인했다.
