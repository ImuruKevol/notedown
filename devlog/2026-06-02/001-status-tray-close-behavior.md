# 상태바/트레이 백그라운드 종료 동작 추가

## 사용자 원 요청

> 리뷰 ID: ewxibuwpwrrwqzkkikzkxkbhwitkzyov
>
> Notedown 앱을 닫으면 실제 종료하지 않고 화면만 닫아 백그라운드에 남기고, macOS는 상태바 클릭, Windows는 트레이 더블클릭으로 다시 열리게 해달라. 완전 종료는 우클릭 후 종료로 처리하고, 설정에서 앱을 닫을 때 완전히 종료할지 백그라운드에 유지할지 체크박스로 선택하게 해달라. 기본값은 백그라운드 유지.
>
> 설정 화면은 자동 저장되므로 우측 상단 버튼들이 필요 없고, 설정 - 일반의 이름 설정도 의미가 없다.

## 변경 파일

- `electron/main.cjs`
  - Electron `Tray`, `Menu`, `nativeImage` 기반 상태바/트레이 아이콘을 추가했다.
  - 기본값 `keepInBackgroundOnClose: true` 앱 환경설정을 userData의 `app-preferences.json`에 저장/로드하도록 추가했다.
  - 창 닫기 시 설정값이 백그라운드 유지이면 창을 숨기고, macOS에서는 Dock도 숨기도록 처리했다.
  - macOS 트레이 클릭 및 Windows/Linux 트레이 더블클릭으로 창을 다시 표시하도록 연결했다.
  - 트레이 우클릭 메뉴에 `Notedown 열기`, `종료`를 추가하고 종료 시 실제 `app.quit()`으로 빠지게 했다.
- `electron/preload.cjs`
  - 렌더러에서 앱 환경설정을 읽고 저장할 수 있도록 `window.notedown.app` IPC 브리지를 추가했다.
- `src/app/page.settings/view.ts`
  - 설정 모델에 `keepInBackgroundOnClose`를 추가하고 기본값을 `true`로 설정했다.
  - 설정 자동 저장 시 Electron 앱 환경설정도 함께 동기화하도록 연결했다.
  - 저장된 로컬 설정이 없을 때는 Electron 환경설정 값을 UI 기본값으로 가져오도록 처리했다.
- `src/app/page.settings/view.pug`
  - 설정 우측 상단 저장/초기화 버튼을 제거했다.
  - 일반 섹션의 이름 입력을 제거했다.
  - `닫을 때 백그라운드 유지` 체크박스를 추가했다.

## 확인 결과

- `node --check electron/main.cjs` 통과.
- `node --check electron/preload.cjs` 통과.
- `wiz_project_build(clean=false)` 성공.
- `curl -I http://172.16.0.143:3009/settings`에서 200 OK와 최신 빌드 시각을 확인했다.
- 빌드 산출물 `build/dist/build/main.js`에 `keepInBackgroundOnClose`와 `닫을 때 백그라운드 유지` 템플릿이 포함된 것을 확인했다.
- `src/app/page.settings/view.pug`에서 설정 헤더의 Save/Reset 버튼과 일반 섹션 이름 입력이 제거된 것을 확인했다.

## 남은 리스크

- Browser 플러그인에서 `iab` 세션을 제공하지 않아 실제 브라우저 화면 클릭/시각 검증은 수행하지 못했다.
- macOS 상태바 클릭, Windows 트레이 더블클릭/우클릭은 Electron 런타임 동작이라 실제 OS별 패키지 실행 환경에서 한 번 더 확인이 필요하다.
