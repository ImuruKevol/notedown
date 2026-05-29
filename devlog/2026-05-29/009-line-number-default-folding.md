# 라인번호 기본 비활성화 및 스타일/스크립트 접기 지원

## 요청

ReviewOps `lnwupayftdcxvdopsgofgcjkuztyixjq` - Toggle line numbers가 기본 활성화되어 있으므로 기본 비활성화로 바꾸고, 스타일 타입과 스크립트 타입은 해당 부분을 접을 수 있도록 해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-29/009-line-number-default-folding.md`

## 변경 내용

- `showLineNumbers` 초기값을 `false`로 변경해 Preview와 Monaco editor 라인번호가 기본 비활성화되도록 했다.
- Markdown editor에 folding range provider를 추가해 `:::global`/`:::` 스타일 블럭과 fenced code/script 블럭을 접기 범위로 제공하도록 했다.
- folding provider disposable을 관리해 컴포넌트 해제 시 등록을 정리하도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- 요청 링크 `http://172.16.0.143:3009/notes`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- 초기 Preview 라인번호 개수가 0이고 라인번호 토글 버튼이 비활성 상태임을 확인했다.
- 토글 클릭 후 Preview 라인번호가 4개 표시되어 기존 토글 동작이 유지됨을 확인했다.
- 등록된 Markdown folding provider가 스타일 블럭 `[1, 3]`, script/code fence `[5, 7]` 범위를 반환함을 확인했다.
