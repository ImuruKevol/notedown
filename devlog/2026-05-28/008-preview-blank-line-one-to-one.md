# Preview 빈 줄 포함 1:1 라인번호 매핑 복구

## 요청

빈 줄도 라인 번호가 표시되어야 하고, 빈 줄도 Preview에 표시되어야 하며, editor와 Preview가 무조건 1:1 라인 매핑되어야 한다는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-28/008-preview-blank-line-one-to-one.md`

## 변경 내용

- `buildPreviewBlocks`에서 빈 줄을 건너뛰지 않고 `blank` block으로 다시 생성하도록 복구했다.
- 기존 Preview 좌측 정렬과 compact heading 스타일은 유지하면서, 빈 줄 row와 라인번호가 함께 표시되도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- 요청 링크 `http://172.16.0.143:3009/notes`에서 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- Preview 라인번호가 `1,2,3,4,5,6,7,8,9`로 표시되고, 빈 줄 row `2,6,8`도 존재함을 확인했다.
- 기존 토글 버튼 클릭 시 Preview 라인번호와 editor 라인번호가 함께 0개로 사라짐을 확인했다.
