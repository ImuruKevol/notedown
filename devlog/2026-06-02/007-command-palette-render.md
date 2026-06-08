# 커맨드 팔렛트 단축키 렌더 갱신 보강

## 사용자 원 요청

> 리뷰 ID: fjymgmieojiztfpgmegealvmazmvmhkk
>
> 커맨드 팔렛트 호출 단축키 입력 시 service.render가 호출되지 않아 렌더링이 바로 되지 않는 것 같아.

## 변경 파일

- `src/app/layout.sidebar/view.ts`
  - `Service`를 주입하고 `ngOnInit()`에서 `service.init(this)` 및 초기 `service.render()`를 호출하도록 보강했다.
  - `Cmd/Ctrl+P` 캡처 단축키로 `openPalette()`가 실행될 때 상태 변경 후 `service.render()`를 호출하고, 렌더 후 입력 포커스를 잡도록 변경했다.
  - 팔렛트 닫기, 검색어 변경, 결과 선택 이동, 워크스페이스 변경 등 팔렛트 관련 상태 변경에도 렌더 요청을 추가했다.
- `devlog.md`, `devlog/2026-06-02/007-command-palette-render.md`
  - 작업 요약 및 상세 기록을 추가했다.

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/notes`에서 200 OK와 최신 빌드 시각을 확인했다.
- 소스와 빌드 산출물 `build/src/app/layout.sidebar/layout.sidebar.component.ts`에서 `Service` 주입, `service.init`, `service.render`, `renderSoon()` 호출이 반영된 것을 확인했다.
- `git diff --check` 통과.

## 남은 리스크

- 현재 세션에서 브라우저 자동화 백엔드가 연결되지 않아 실제 단축키 입력 후 즉시 렌더링되는 장면은 시각 검증하지 못했다.
