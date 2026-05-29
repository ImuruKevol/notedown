# Quote row radius 제거 및 생성일시 표시 추가

## 요청

리뷰 ID `eysfhbyfqeipnzeyfihohgquvhvuagjb`의 후속 요청. Preview quote 행들에 적용된 rounded 처리를 제거하고, 노트 헤더에 마지막 저장 일시뿐 아니라 생성일시도 표시하며, PDF 출력 시에도 생성일시를 추가해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/011-quote-radius-created-at.md`

## 변경 내용

- `createdAtLabel()`을 추가해 `createdAtMs` 우선, 기존 문자열 fallback 방식으로 생성일시를 표시하도록 했다.
- 노트 헤더 메타 문구를 `생성: ... · 저장: ...` 형식으로 변경했다.
- PDF HTML 메타 영역에 `생성`과 `마지막 저장` 값을 함께 출력하도록 변경했다.
- Preview quote row, blockquote, quote paragraph의 `border-radius`를 `0`으로 고정했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `node --check electron/main.cjs` 성공
- `git diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/angular/styles/styles.scss electron/main.cjs` 성공
- 요청 링크 `http://172.16.0.143:3009/notes`에서 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- 헤더 텍스트가 `생성: 05. 28. 오후 01:23:45 · 저장: 05. 28. 오후 03:45:10` 형식으로 표시되는 것을 확인했다.
- Save PDF 클릭 경로에서 캡처한 PDF HTML에 `생성:`과 `마지막 저장:`이 모두 포함되는 것을 확인했다.
- quote row, blockquote, quote paragraph의 computed `border-radius`가 모두 `0px`인 것을 확인했다.
