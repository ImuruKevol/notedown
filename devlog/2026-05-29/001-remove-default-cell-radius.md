# 문서 셀 기본 radius 제거

## 요청

리뷰 ID `jsevvorameczakitpwsyezqsmlkcabxj`의 후속 요청. 첨부 스크린샷처럼 `border-left` 스타일을 주면 각 셀에 기본 radius가 남아 보이므로, 기본적으로 radius를 전부 제거해달라는 요청.

## 변경 파일

- `src/angular/styles/styles.scss`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-29/001-remove-default-cell-radius.md`

## 변경 내용

- Preview row 기본 `border-radius`를 `0`으로 변경했다.
- Preview Markdown 내부 `p`, heading, blockquote, list item 셀의 기본 `border-radius`를 `0`으로 변경했다.
- Preview task cell과 code cell의 기본 `border-radius`를 `0`으로 변경했다.
- PDF HTML의 code block(`pre`) 기본 `border-radius`도 `0`으로 맞췄다.
- 버튼/툴바 등 문서 셀이 아닌 UI 컨트롤의 radius는 변경하지 않았다.

## 검증

- 첨부 스크린샷에서 border-left가 걸린 각 Preview 셀의 둥근 모서리 현상을 확인했다.
- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/angular/styles/styles.scss src/app/page.notes/view.ts` 성공
- `border-radius` 선언 값이 문서 렌더링 관련 파일에서 모두 `0`인지 스모크 테스트로 확인했다.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/notes`가 `200 OK`로 응답하는 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 계속 사용 불가 상태라 실제 화면 조작 검증은 수행하지 못했다.
