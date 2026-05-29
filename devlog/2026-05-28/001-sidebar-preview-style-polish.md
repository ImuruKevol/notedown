# 사이드바 정렬 메뉴 및 preview 체크리스트/코드블럭 스타일 정리

## Original Request

정렬 select, 체크박스 간 여백, 코드블럭의 아래 여백 등 스타일 쪽에서 문제가 많으니 실제 화면을 확인하고 문제점을 파악한 후 알아서 스타일을 깔끔하게 수정해야 한다.

## Summary

- Electron 화면을 직접 확인해 정렬 select가 사이드바에서 과도한 별도 행을 차지하고, preview 체크리스트와 코드블럭 간격이 문서 흐름을 끊는 문제를 확인했다.
- 노트 목록 정렬 control을 native select에서 헤더의 compact sort icon + dropdown menu로 변경했다.
- 검색 input은 기존처럼 필요할 때만 표시하되, 정렬 행 제거 후 노트 목록과의 밀도가 자연스럽게 이어지도록 유지했다.
- Preview task markup을 block 구조로 조정해 텍스트 클릭 편의성을 유지하면서 `prose` 문단 margin 영향을 줄였다.
- Preview task item의 높이, checkbox 정렬, gap, line-height를 조정해 체크리스트 항목 사이 여백을 줄였다.
- Readonly Monaco code preview의 padding과 최소 높이를 낮추고 preview block flow gap을 조정해 코드블럭 아래 여백을 줄였다.

## Changed Files

- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/component.nav.sidebar/view.pug`
- Modified: `src/app/page.notes/view.ts`
- Modified: `src/app/page.notes/view.pug`
- Modified: `src/angular/styles/styles.scss`
- Modified: `devlog.md`
- Added: `devlog/2026-05-28/001-sidebar-preview-style-polish.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `npm run electron`으로 실제 화면을 확인했다.
- 사이드바 정렬 select가 제거되고 sort icon dropdown으로 동작하는 것을 확인했다.
- Preview 체크리스트 간격이 줄고 checked item 스타일이 유지되는 것을 확인했다.
- Code block preview의 card height와 아래 여백이 줄어든 것을 확인했다.
