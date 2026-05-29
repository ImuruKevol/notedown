# 슬래시 자동완성·미리보기 상호작용·에디터 헤더 정리

## Original Request

`/` 입력 시 나오는 자동완성 목록이 한글뿐 아니라 영어로도 검색되도록 하되 같은 타입의 한글/영어 항목이 별개로 나오지 않게 해야 한다. `/`는 각 행의 첫 번째에서 입력할 때만 자동완성 목록이 떠야 한다. Preview 체크박스는 클릭하면 실제 문서 본문에 반영되어야 하며, 링크는 현재 창이 아니라 새 창에서 열려야 한다. 코드블럭은 현재 설정 테마를 따라가고 빨간색 고정 텍스트를 없애며 preview 부분에는 Monaco editor readonly로 보여주어야 한다. 에디터 헤더에서 수정일시는 오른쪽으로 붙이고 제목 input이 남는 영역을 차지해야 하며, 작성/분할/미리보기 토글은 헤더의 줄 수 표시 버튼 왼쪽으로 이동해야 한다. 문서 삭제 시 내용이 있으면 확인 후 삭제하고, 내용이 비어 있으면 바로 삭제해야 한다. 설정 화면 헤더의 뒤로가기/타이틀은 왼쪽으로 더 붙이되 macOS 버튼과 겹치지 않게 수정하고, 왼쪽 하단 `Local Off` 카드를 제거해야 한다.

## Summary

- Slash completion provider를 `/` 트리거 전용으로 변경하고, 행의 첫 번째 문자로 시작하는 `/query`에서만 제안이 뜨도록 제한했다.
- 각 slash command를 한 항목으로 유지하면서 영어 alias/filterText를 추가해 `heading`, `todo`, `table`, `divider` 등으로도 검색되게 했다.
- Preview 렌더링을 Markdown HTML 블록과 code block 블록으로 분리하고, code block은 readonly Monaco editor로 렌더링하도록 변경했다.
- Preview task checkbox에 원본 line index를 심어 클릭 시 Markdown 본문 `- [ ]`/`- [x]`가 실제로 갱신되도록 했다.
- Preview 링크는 click handler와 `target="_blank"`/`rel="noopener noreferrer"`를 통해 새 창으로 열리도록 했다.
- Preview inline code의 고정 빨간색 스타일을 제거하고 code block wrapper가 light/dark 테마를 따르도록 스타일을 추가했다.
- 에디터 헤더에서 제목 input이 남는 공간을 차지하게 하고, 수정일시와 모드 토글/라인번호/새 노트/공유 placeholder를 오른쪽 액션 영역으로 재배치했다.
- 노트 삭제 시 의미 있는 본문 내용이 있으면 `window.confirm` 확인을 거치고, 제목만 있는 빈 문서는 바로 삭제되도록 했다.
- 설정 화면 헤더의 좌측 여백을 줄이고, 설정 사이드바 하단의 `Local Off` 카드를 삭제했다.

## Changed Files

- Modified: `src/app/page.notes/view.ts`
- Modified: `src/app/page.notes/view.pug`
- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/page.settings/view.pug`
- Modified: `src/angular/styles/styles.scss`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/006-slash-preview-editor-settings-polish.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `node --check electron/main.cjs` succeeded.
- `node --check electron/preload.cjs` succeeded.
- `npm run electron`으로 노트 화면을 열어 모드 토글이 헤더로 이동한 것, 수정일시가 오른쪽에 배치된 것, preview 체크박스 클릭 시 editor 본문이 `[x]`로 갱신되는 것을 확인했다.
- Electron 설정 화면에서 헤더 좌측 여백이 줄고 왼쪽 하단 `Local Off` 카드가 제거된 것을 확인했다.
