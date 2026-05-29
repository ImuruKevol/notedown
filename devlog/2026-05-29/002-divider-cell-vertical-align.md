# Divider 셀 세로 중앙 정렬

## 요청

리뷰 ID `jsevvorameczakitpwsyezqsmlkcabxj`의 후속 요청. Divider 셀이 `border-top` 형식으로 렌더링되는 것 같은데, 해당 셀이 세로 가운데 정렬되어야 한다는 요청.

## 변경 파일

- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-29/002-divider-cell-vertical-align.md`

## 변경 내용

- Preview divider row(`is-divider`)를 `align-items: center`로 정렬했다.
- divider row의 content/Markdown wrapper를 flex 중앙 정렬로 바꿔 `hr`가 셀 높이 중앙에 놓이도록 했다.
- `hr`의 기본 margin을 제거하고 너비 100%의 border-top line으로 고정했다.
- dark mode용 divider border 색상도 명시했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/angular/styles/styles.scss` 성공
- 스타일 스모크 테스트로 divider row 중앙 정렬, content flex 정렬, `hr` margin 제거 및 dark 색상 rule 생성을 확인했다.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/notes`가 `200 OK`로 응답하는 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 계속 사용 불가 상태라 실제 화면 조작 검증은 수행하지 못했다.
