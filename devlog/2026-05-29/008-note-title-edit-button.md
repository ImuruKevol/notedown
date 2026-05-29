# 문서 제목 인라인 편집 버튼 방식으로 개선

## 요청

ReviewOps `yknuriafkxmlcoavtrwbjcxleiqduteh` - 문서 제목이 평상시 border 없는 input으로 전체 영역을 차지해 빈 공간 드래그가 막히므로, 제목 텍스트 오른쪽의 아이콘을 눌렀을 때만 input으로 전환해 수정할 수 있게 해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-29/008-note-title-edit-button.md`

## 변경 내용

- 노트 헤더 제목을 기본 상태에서는 `span` 텍스트와 작은 편집 버튼으로 렌더링하도록 변경했다.
- 편집 버튼 클릭 시에만 제목 input을 표시하고, Enter/blur로 저장, Escape로 취소하도록 제목 편집 상태를 추가했다.
- 노트 선택 변경 또는 선택 해제 시 제목 편집 상태를 닫아 이전 노트의 draft 값이 남지 않도록 정리했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- `http://172.16.0.143:3009`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 HTML 응답을 확인했다.
- 동일 쿠키 조건으로 `main.js` 산출물에 `editingTitle`, `titleDraft`, `data-note-title-input`, `Edit title` 템플릿이 반영된 것을 확인했다.
- 인앱 브라우저와 Chrome extension 브라우저가 현재 세션에 노출되지 않아 실제 클릭 기반 브라우저 검증은 수행하지 못했다.
