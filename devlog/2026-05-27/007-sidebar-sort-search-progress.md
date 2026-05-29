# 영어 슬래시 메뉴·체크리스트 달성률·사이드바 정렬/검색 개선

## Original Request

`/` 자동완성 목록은 한글 항목 대신 영어 항목이 보이도록 해야 한다. Preview 화면의 체크박스는 체크박스 자체뿐 아니라 해당 텍스트를 클릭해도 토글되도록 하고, 체크된 항목은 취소선과 회색 텍스트로 표시해야 한다. 문서에 포함된 체크박스의 총 숫자와 체크된 항목 수를 %로 계산해서 체크박스가 있는 노트 행 오른쪽 끝에 달성률을 표시해야 한다. 사이드바 노트 목록은 생성일, 수정일, 제목 기준으로 오름차순/내림차순 정렬을 선택할 수 있어야 한다. 노트 검색 input은 기본적으로 숨기고, 사이드바 헤더의 `+` 버튼 왼쪽 검색 아이콘을 눌렀을 때만 보여야 한다. 노트 목록의 `최근` label은 삭제해야 한다. 워크스페이스 목록은 노트 목록 위에 오버랩하지 말고 실제 공간을 펼치기/감추기 개념으로 표시해야 한다.

## Summary

- Slash completion 표시 label을 한글에서 영어로 변경하고, 기존 한글/영어 filterText는 유지해 검색 호환성을 남겼다.
- Preview task item을 `label[data-task-line]` 구조로 렌더링해 체크박스 텍스트 클릭도 원본 Markdown 라인을 토글하도록 했다.
- 체크된 preview task는 취소선과 회색 텍스트로 표시되도록 전역 preview 스타일을 보강했다.
- 노트별 checkbox 완료율을 계산해 체크박스가 1개 이상인 노트 행 오른쪽에 `%`로 표시하도록 했다.
- 노트 목록에 수정일/생성일/제목 정렬 옵션을 추가하고, 노트 생성/수정 시 정렬용 timestamp metadata를 저장하도록 했다.
- 검색 input은 기본 숨김으로 바꾸고, 사이드바 헤더의 검색 아이콘 클릭 시에만 열리도록 했다.
- 노트 목록의 `최근` label을 삭제했다.
- 워크스페이스 패널을 absolute overlay에서 flex 컬럼으로 바꾸고, 부모 layout이 패널 열림 이벤트에 따라 사이드바 폭과 본문 padding을 함께 조정하도록 연결했다.

## Changed Files

- Modified: `src/app/page.notes/view.ts`
- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/component.nav.sidebar/view.pug`
- Modified: `src/app/layout.sidebar/view.ts`
- Modified: `src/app/layout.sidebar/view.pug`
- Modified: `src/angular/styles/styles.scss`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/007-sidebar-sort-search-progress.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `npm run electron`으로 앱을 열어 노트 목록 검색 input이 기본 숨김 상태이고, 검색 아이콘 클릭 시 표시되는 것을 확인했다.
- Electron 화면에서 워크스페이스 버튼 클릭 시 패널이 노트 목록 위에 겹치지 않고 실제 공간을 차지하며 펼쳐지는 것을 확인했다.
- Preview의 checkbox 텍스트를 클릭해 본문 `- [ ]`/`- [x]`가 토글되고, 노트 목록 달성률이 `100%`에서 `67%`로 바뀌는 것을 확인한 뒤 다시 원상 복구했다.
