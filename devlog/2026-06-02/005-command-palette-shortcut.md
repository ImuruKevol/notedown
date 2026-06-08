# 커맨드 팔렛트 Cmd/Ctrl+P 캡처 단축키 적용

## 사용자 원 요청

> 리뷰 ID: fjymgmieojiztfpgmegealvmazmvmhkk
>
> 커맨드 팔렛트를 불러내는 곳이 없어. 커맨드 팔렛트는 맥 기준 cmd+p, 윈도우에서는 ctrl+p로 열리게 해줘.
> editor 편집 중에도 당연히 열리도록 처리해야해.

## 변경 파일

- `src/app/layout.sidebar/view.ts`
  - 기존 `document:keydown` HostListener 방식 대신 `window.addEventListener('keydown', ..., true)` 캡처 단계 리스너를 등록했다.
  - `Cmd+P`/`Ctrl+P`에서 팔렛트를 열고 브라우저 인쇄 기본 동작과 편집기 후속 핸들러 전파를 막도록 처리했다.
  - `Cmd/Ctrl+Shift+P`는 기존처럼 설정 명령 모드(`>`)로 열리도록 유지했다.
- `devlog.md`, `devlog/2026-06-02/005-command-palette-shortcut.md`
  - 작업 요약 및 상세 기록을 추가했다.

## 확인 결과

- `wiz_project_build(clean=false)` 성공.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/notes`에서 200 OK와 최신 빌드 시각을 확인했다.
- 소스와 빌드 산출물 `build/src/app/layout.sidebar/layout.sidebar.component.ts`에서 `handlePaletteShortcut`, `stopImmediatePropagation`, `keydown` 캡처 리스너 등록/해제가 반영된 것을 확인했다.
- `git diff --check` 통과.

## 남은 리스크

- 현재 세션에서 브라우저 자동화 백엔드가 연결되지 않아 Monaco 편집기 내부에서 실제 키 입력으로 여는 시각 검증은 수행하지 못했다.
