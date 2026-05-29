# 노트 헤더 저장 시각·PDF 저장 액션 개선

## 요청

리뷰 ID `gwdleovatzxjonhicoahdzjpykdgpzpe`의 노트 화면 헤더 개선 요청. 현재 노트 화면 헤더의 마지막 저장 날짜를 초 단위까지 표시하고, 라인 넘버 토글 버튼 오른쪽의 `+` 버튼을 제거하며, 타이틀 입력 시 포커스가 풀리는 버그를 수정하고, 비어 있던 헤더 버튼 영역에 현재 노트를 PDF로 저장하는 기능을 추가해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `src/app/component.nav.sidebar/view.ts`
- `electron/main.cjs`
- `electron/preload.cjs`
- `devlog.md`
- `devlog/2026-05-28/009-note-header-save-pdf.md`

## 변경 내용

- 노트 헤더의 저장 시각 표시를 `updatedAtMs` 기반으로 계산해 초 단위까지 표시하도록 변경했다.
- 선택된 노트 헤더에서 라인번호 토글 오른쪽 `New note` 버튼을 제거하고, 해당 위치에 `Save PDF` 아이콘 버튼을 추가했다.
- `page.notes`가 자신이 발생시킨 `notedown:notes-changed` 이벤트를 다시 처리하지 않도록 source detail을 추가해, 타이틀 입력 중 active note 재선택과 editor focus 이동이 일어나지 않도록 했다.
- 웹 환경에서는 현재 노트를 인쇄용 HTML로 열어 브라우저의 PDF 저장 흐름을 사용하고, Electron 환경에서는 `printToPDF`와 저장 다이얼로그를 통해 실제 PDF 파일로 저장하도록 IPC를 추가했다.
- 사이드바/Electron metadata 날짜 라벨도 초 단위 포맷으로 맞췄다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `node --check project/main/electron/main.cjs` 성공
- `node --check project/main/electron/preload.cjs` 성공
- 요청 링크 `http://172.16.0.143:3009/notes`에서 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- 노트 헤더 버튼 목록이 `Write`, `Split`, `Preview`, `Toggle line numbers`, `Save PDF`로 표시되고 헤더의 `New note` 버튼이 제거된 것을 확인했다.
- 저장 시각이 `05. 28. 오후 03:01:01`처럼 초 단위까지 표시되는 것을 확인했다.
- 타이틀 입력 후 active element가 계속 title input으로 유지되어 포커스가 풀리지 않는 것을 확인했다.
- `Save PDF` 버튼 클릭 시 인쇄용 HTML이 생성되고 browser print fallback이 호출되는 것을 확인했다.
