# 선택 노트 없음 상태 화면 및 저장 가드 추가

## 요청

아무 노트가 선택되어있지 않을 때 문서 제목과 에디터가 동작은 하지만 주기적으로 초기화되고 있으므로, 아무 노트가 선택되어있지 않은 상태에서는 노트가 선택되지 않았다고 표시해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-28/005-no-selected-note-empty-state.md`

## 변경 내용

- 선택된 노트가 있을 때만 문서 제목 입력, 편집기, preview 영역을 렌더링하도록 노트 화면을 분기했다.
- 선택된 노트가 없을 때는 `노트가 선택되지 않았습니다` 상태와 새 노트 생성 버튼만 표시하도록 했다.
- 선택된 노트가 없을 때 `touchNote`, preview 갱신, editor focus, active note key 저장이 불필요하게 실행되지 않도록 상태 가드를 추가했다.
- 선택 노트가 사라질 때 기존 editor hover 핸들러와 editor 참조를 정리하도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- 요청 URL 검증을 위해 인앱 브라우저와 Chrome 자동화 연결을 시도했으나 현재 세션에서 두 브라우저 백엔드를 사용할 수 없어 실제 DOM 검증은 수행하지 못했다.
