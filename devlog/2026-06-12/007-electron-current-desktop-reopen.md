# Electron 상태바 재열기 위치를 현재 화면/데스크탑 기준으로 보정

## 사용자 원 요청

> electron 앱을 cmd+w로 닫으면 화면이 숨김처리됨. 그리고 화면 위의 작업표시줄에서 notedown app 아이콘을 클릭하면 닫았던 그 모니터의 그 화면에서 다시 나타남.
> 근데 모니터를 여러 개 쓸 때 해당 모니터에서 아이콘을 클릭하면 마지막 위치가 아니라 그 모니터에 앱 화면이 표시되었으면 해.
> 그리고 맥에서는 데스크탑 화면을 여러 개 띄울 수 있잖아? 근데 이 경우도 마찬가지로 닫았던 그 데스크탑 화면으로 이동한 후 열리는게 아니라 현재 데스크탑 화면에 앱이 열렸으면 해.

## 변경 파일

- `electron/main.cjs`
  - Electron `screen` 모듈을 사용해 상태바/트레이 클릭 위치 또는 현재 커서 위치의 디스플레이를 계산하도록 추가했다.
  - 숨김/최소화 상태에서 창을 다시 열 때 마지막 위치 대신 대상 디스플레이의 작업 영역 중앙으로 창 bounds를 이동하도록 처리했다.
  - macOS에서 재표시 직전에 `setVisibleOnAllWorkspaces(true)`를 짧게 적용해 이전 Space로 전환하지 않고 현재 데스크탑에 창을 노출하도록 보정했다.
  - 상태바 클릭, 트레이 더블클릭, 우클릭 메뉴의 열기 동작이 같은 재표시 경로를 사용하도록 연결했다.
- `devlog.md`
  - 이번 작업 요약 행을 추가했다.
- `devlog/2026-06-12/007-electron-current-desktop-reopen.md`
  - 이번 작업 상세 devlog를 추가했다.

## 확인 결과

- `node --check electron/main.cjs` 통과.
- `git diff --check -- electron/main.cjs` 통과.
- `wiz_project_build(clean=false)` 성공.

## 남은 리스크

- macOS 상태바 클릭의 다중 모니터/다중 Space 동작은 실제 Electron 앱 실행 환경에서 최종 확인이 필요하다.
