# Preview 리스트 depth 렌더링 복구

- 날짜: 2026-06-12
- ID: 001
- 리뷰 ID: cdtgpkttamzohrwzwqjrfeujeizoptpa

## 사용자 원 요청

작업 시작

리뷰 요청: 첨부한 스크린샷과 같이 리스트 타입에 depth가 제대로 작동하지 않음.

## 변경 파일

- `src/app/page.notes/view.ts`
  - Showdown의 2칸 하위 리스트 옵션을 활성화.
  - 미리보기에서 연속 리스트 라인을 하나의 마크다운 블록으로 렌더링하도록 변경.
  - task list 체크박스에 원본 라인 번호를 다시 연결해 기존 토글 동작 유지.
- `src/angular/styles/styles.scss`
  - 중첩 리스트의 padding/margin을 명시.
  - Showdown task list 체크박스 스타일과 클릭 커서를 보강.
- `devlog.md`
- `devlog/2026-06-12/001-preview-list-depth-fix.md`

## 검증 결과

- `wiz_project_build(projectName="main", clean=false)` 성공.
- Node 스크립트로 `- 항목`, `  - 하위 항목`, `    continuation` 샘플을 Showdown 렌더링해 하위 항목이 중첩 `<ul>`로 생성되고 continuation이 `<pre>` 코드블록으로 변하지 않는 것을 확인.
- UI 검증용 쿠키(`season-wiz-project=main`, `season-wiz-devmode=true`)를 포함해 `http://172.16.0.143:3009` 접속을 시도했으나 서버 연결이 거부됨.
- 인앱 브라우저 세션도 사용 불가(`Browser is not available: iab`)라 실제 화면 캡처 검증은 수행하지 못함.
