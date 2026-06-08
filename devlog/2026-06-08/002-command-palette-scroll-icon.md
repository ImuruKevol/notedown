# 커맨드 팔렛트 선택 스크롤 및 입력 아이콘 보정

## 사용자 원 요청

> - 커맨드 팔렛트에서 화살표로 항목 이동 시 스크롤때문에 보이지 않는 항목으로 이동하면 스크롤도 이동해야 함.
> - 커맨드 팔렛트의 input 왼쪽에 있는 아이콘이 이상하게 깨져있음

## 변경 파일

- `src/app/layout.sidebar/view.ts`
  - 팔렛트 열기, 검색어 변경, ArrowUp/ArrowDown/Home/End 이동 후 선택 항목을 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`로 보이게 맞추도록 추가했다.
- `src/app/layout.sidebar/view.pug`
  - 팔렛트 리스트 컨테이너와 항목에 `data-command-palette-list`, `data-command-palette-index` 표식을 추가했다.
  - 입력 왼쪽의 깨져 보이는 양방향 화살표 SVG를 검색 아이콘 SVG로 교체했다.
- `devlog.md`, `devlog/2026-06-08/002-command-palette-scroll-icon.md`
  - 작업 요약 및 상세 기록을 추가했다.

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/notes`에서 200 OK 및 최신 빌드 시각을 확인했다.
- Browser에서 `Cmd+P`로 팔렛트를 열고 `>` 명령 모드 진입 후 `End` 키를 눌렀을 때 리스트 `scrollTop`이 0에서 365로 이동하고 마지막 항목이 리스트 안에 보이는 것을 확인했다.
- Browser에서 입력 왼쪽 SVG가 검색 아이콘 원형 경로를 포함하고 기존 깨진 화살표 경로가 사라진 것을 확인했다.
- Browser 콘솔 error 로그가 없는 것을 확인했다.

## 남은 리스크

- 브라우저 기반 검증이며 Electron 네이티브 셸의 실제 단축키 전달 경로는 별도 실행 검증하지 않았다.
