# Slash 첨부 팝오버 위치를 입력 줄 기준으로 보정

- 날짜: 2026-06-15
- 번호: 011

## 사용자 요청

`/file`, `/image`를 입력했을 때 나오는 팝오버가 해당 줄 부분에 나오는게 아니라 무조건 왼쪽 상단으로 위치가 고정되어있는 문제가 있어.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `devlog.md`
- `devlog/2026-06-15/011-slash-attachment-popover-position.md`

## 변경 내용

- 첨부 선택 팝오버의 `left-4 top-4` 고정 위치를 제거하고, Angular `ngStyle`로 계산된 좌표를 적용하도록 변경했다.
- Monaco slash completion에서 `/file`, `/image` 항목을 수락할 때 completion 당시의 line/column과 visible pixel 좌표를 command 인자로 전달하도록 했다.
- 팝오버를 열 때 저장된 anchor 좌표를 editor shell 기준 `left/top`으로 변환하고, 화면 밖으로 넘치지 않도록 경계값을 보정했다.
- 창 크기 변경 중에도 열린 팝오버 위치를 다시 계산하도록 resize handler를 추가했다.

## 확인 결과

- `wiz_project_build(clean=false, projectName=main)`: 성공
- `git diff --check`: 통과
- Electron 앱을 remote debugging port로 실행해 Monaco 편집기에 실제 `/file`, `/image`를 입력하고 Enter로 팝오버를 열어 확인했다.
  - `/file`: shell 기준 `left: 63px`, `top: 180px`
  - `/image`: shell 기준 `left: 72px`, `top: 276px`
  - 두 경우 모두 팝오버가 좌상단 고정이 아니라 입력한 줄 위치 기준으로 표시됨을 확인했다.

## 남은 리스크

- 검증 중 Electron 개발 모드 CSP warning이 출력되었지만, 이번 팝오버 위치 변경과 직접 관련된 오류는 아니다.
