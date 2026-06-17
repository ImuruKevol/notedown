# 노트 헤더 우측 액션 버튼 간격 축소

## 사용자 요청

> 오른쪽 상단에 버튼 3개가 있는데, 버튼끼리 간격이 너무 멀어.

## 변경 사항

- 노트 화면 상단 우측 보기 모드 버튼 그룹의 padding과 버튼 크기를 줄여 세 버튼 간격을 더 촘촘하게 조정했다.
- 라인번호, 첨부, PDF 저장 액션을 별도 `gap-0.5` 그룹으로 묶고 기존 `ml-2` 여백을 제거했다.
- 라인번호/첨부/PDF 액션 버튼 높이를 32px 기준으로 맞춰 우측 액션 영역의 시각적 간격을 줄였다.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-06-17/001-note-header-action-spacing.md`

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- 빌드 산출물에서 `gap-0.5`, `size-7`, `h-8` 버튼 class 반영을 확인했다.
- 리뷰 링크 `http://172.16.0.143:3009`에는 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키로 접속을 시도했지만 서버 연결이 거부되어 직접 화면 확인은 하지 못했다.
