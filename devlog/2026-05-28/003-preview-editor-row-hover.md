# Preview 및 Monaco editor 행 hover 효과 추가

## Original Request

Preview에서 각 행에 마우스 커서를 hover하면 해당 셀에 연한 회색 배경색으로 행 전체 hover 효과를 줘야 한다. 가능하면 Markdown editor 영역에도 해당 셀에 같은 배경색 효과를 적용해야 한다. 또한 현재 문서들이 어떤 형식으로 저장되는지 설명해야 한다.

## Summary

- Preview markdown block의 paragraph, heading, list item, blockquote, table, task row, code block에 연한 회색 hover 배경을 추가했다.
- Preview hover 배경이 row처럼 보이도록 좌우 padding과 negative margin, border radius를 정리했다.
- Monaco editor mouse move 이벤트를 연결해 마우스가 올라간 줄에 whole-line decoration을 추가했다.
- Editor hover decoration은 content, gutter, margin 영역에 같은 연한 회색 계열 배경을 적용했다.
- Editor hover listener와 decoration은 component destroy 시 정리되도록 dispose 처리를 추가했다.

## Changed Files

- Modified: `src/app/page.notes/view.ts`
- Modified: `src/angular/styles/styles.scss`
- Modified: `devlog.md`
- Added: `devlog/2026-05-28/003-preview-editor-row-hover.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `npm run electron`으로 실제 노트 화면을 열어 preview row hover와 editor line hover가 표시되는 것을 확인했다.
