# 커맨드 팔렛트 hover와 키보드 선택 경합 수정

## 사용자 원 요청

> 마우스 커서가 커맨드 팔렛트 아래 결과 목록 중 하나 위에 있으면 화살표를 아무리 눌러도 선택 항목이 이동하지 않는 버그가 있어.

## 변경 파일

- `src/app/layout.sidebar/view.ts`
  - 포인터로 항목을 실제 이동했을 때만 팔렛트 선택 인덱스를 갱신하는 `selectPaletteItemByPointer()`를 추가했다.
  - 같은 인덱스에 대한 중복 갱신은 무시하고 필요한 경우에만 `renderSoon()`을 호출하도록 했다.
- `src/app/layout.sidebar/view.pug`
  - 팔렛트 항목의 hover 선택 이벤트를 `mouseenter` 직접 대입에서 `mousemove` 헬퍼 호출로 바꿨다.
  - 키보드 방향키로 선택 항목이 바뀐 뒤, 정지한 마우스 위치의 기존 hover 이벤트가 선택 인덱스를 다시 덮지 않도록 했다.
- `devlog.md`, `devlog/2026-06-08/004-command-palette-hover-keyboard.md`
  - 작업 요약 및 상세 기록을 추가했다.

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/notes`에서 200 OK를 확인했다.
- Browser에서 `Cmd+P`로 팔렛트를 열고 `>` 명령 모드로 전환한 뒤, 마우스를 첫 번째 결과 항목 위에 고정한 상태로 `ArrowDown`을 두 번 눌렀을 때 활성 인덱스가 `0 -> 1 -> 2`로 이동하는 것을 확인했다.
- Browser 콘솔 error 로그가 없는 것을 확인했다.

## 남은 리스크

- 브라우저 기반 검증이며 Electron 네이티브 메뉴/accelerator 전달 경로는 별도 실행 검증하지 않았다.
