# Preview 라인번호와 렌더링 간격 재정리

## 요청

Preview 화면이 여전히 어색하다는 피드백. 첨부 스크린샷에서 Preview가 가운데 좁은 컬럼으로 몰리고, 빈 줄 라인번호가 떠서 미리보기 화면으로 보기 어렵다는 문제를 확인했다.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/007-preview-line-number-layout-polish.md`

## 변경 내용

- Preview flow의 `mx-auto max-w-[780px]`를 제거하고 전체 폭 기준으로 좌측 정렬되도록 했다.
- Markdown 빈 줄은 Preview block으로 렌더하지 않아 빈 줄 번호가 떠 보이지 않도록 했다.
- Preview 라인번호 gutter 폭을 줄이고, heading 크기와 line-height를 낮춰 editor 옆 미리보기로 과하게 보이지 않도록 했다.
- Preview 행 gap을 조정해 내용이 뭉치지 않으면서도 과한 간격이 생기지 않도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- 빌드 산출물 임시 서버와 요청 링크 `http://172.16.0.143:3009/notes`에서 headless Chrome으로 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정해 검증했다.
- Preview가 좌측 기준으로 배치되고, 라인번호가 `1, 3, 4, 5, 7, 9`처럼 실제 렌더링되는 줄에만 표시됨을 확인했다.
- 기존 토글 버튼 클릭 시 Preview 라인번호와 editor 라인번호가 함께 0개로 사라짐을 확인했다.
