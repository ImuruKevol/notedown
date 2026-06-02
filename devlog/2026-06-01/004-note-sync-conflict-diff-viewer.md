# 동기화 충돌 진입점 개선 및 노트 화면 Monaco diff 뷰어 이동

## 요청

ReviewOps `xbyheezgknlyegsiclrqtcoobtbagpte` - 충돌 발생 시 해당 텍스트가 클릭 가능하다는 점이 확실히 드러나도록 디자인을 개선하고, 동기화 충돌 클릭 시 설정 화면이 아니라 문서 화면에서 문서 에디터 대신 충돌 뷰어를 띄워야 한다. 충돌 뷰어는 Monaco Editor의 diff editor를 사용해 변경점을 명확히 인식할 수 있어야 한다.

## 변경 파일

- `src/app/component.nav.sidebar/view.ts`
- `src/app/component.nav.sidebar/view.pug`
- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `devlog.md`
- `devlog/2026-06-01/004-note-sync-conflict-diff-viewer.md`

## 변경 내용

- 사이드바 왼쪽 하단 동기화 상태 링크를 `/notes`로 변경하고, 충돌 상태에서는 배경/테두리/underline hover/"열기" 배지로 클릭 가능성을 강화했다.
- 충돌 상태 클릭 시 `notedown:open-sync-conflict` 이벤트를 보내 현재 노트 화면에서도 충돌 뷰어가 열리도록 했다.
- 설정 화면의 충돌 비교 textarea 뷰어를 제거하고, 문서 화면으로 이동하는 "충돌 보기" 안내 링크만 남겼다.
- 노트 화면에서 충돌이 감지되면 일반 문서 에디터/미리보기 영역을 숨기고 충돌 목록과 선택 충돌 상세를 표시하도록 했다.
- 노트 화면 충돌 상세는 `window.monaco.editor.createDiffEditor` 기반 diff editor로 서버 버전과 로컬 버전을 좌우 비교하도록 구현했다.
- Monaco가 아직 로드되지 않은 순간에는 readonly textarea fallback을 보여주고, 숨김 `nu-monaco-editor` 초기화 이벤트를 통해 diff editor 렌더를 재시도하도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- `git diff --check` 성공.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Mon, 01 Jun 2026 06:37:07 GMT` 응답을 확인했다.
- `rg`로 설정 화면의 "동기화 계획 확인" 및 "충돌 뷰어" 텍스트가 남아 있지 않고, 노트 화면에 `createDiffEditor`와 `notedown-sync-conflict-diff`가 연결된 것을 확인했다.
- 수정 대상 파일의 conflict marker 및 trailing whitespace 검색 결과 없음.
- Browser 플러그인 검증은 `iab` 브라우저가 제공되지 않아 실행하지 못했다.
