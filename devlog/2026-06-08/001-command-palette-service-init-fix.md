# 커맨드 팔렛트 Service 재초기화 제거

## 사용자 원 요청

> 커맨드 팔렛트 기능을 추가했는데 제대로 동작하지 않고 있어.

## 변경 파일

- `src/app/layout.sidebar/view.ts`
  - `layout.sidebar`가 루트 `Service` 싱글톤을 다시 `init(this)`로 재초기화하던 호출을 제거했다.
  - 루트 `AppComponent`에서 초기화된 `Service`의 `render()`만 사용하도록 유지해 팔렛트 단축키 렌더 갱신은 유지했다.
- `devlog.md`, `devlog/2026-06-08/001-command-palette-service-init-fix.md`
  - 작업 요약 및 상세 기록을 추가했다.

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/notes`에서 200 OK 및 최신 빌드 시각을 확인했다.
- Browser에서 `http://172.16.0.143:3009/notes` 로드 후 콘솔 error 로그가 없는 것을 확인했다.
- Browser에서 `Cmd+P` 입력 시 커맨드 팔렛트 입력이 생성되고 포커스가 이동하는 것을 확인했다.
- Browser에서 `@` 입력 시 워크스페이스 목록, `>` 입력 시 설정 명령 목록이 렌더링되는 것을 확인했다.

## 남은 리스크

- 실제 Electron 메뉴 레벨 accelerator 충돌은 웹 브라우저 검증만으로는 확인하지 못했다.
