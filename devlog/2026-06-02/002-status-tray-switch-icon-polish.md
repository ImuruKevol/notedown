# 상태바 설정 스위치 및 트레이 아이콘 보정

## 사용자 원 요청

> 리뷰 ID: ewxibuwpwrrwqzkkikzkxkbhwitkzyov
>
> 닫을 때 백그라운드 유지 설정을 그 위에 자동 저장처럼 스위치 버튼 스타일로 변경해줘.
> 그리고 맥 기준 상태바에 뜨는 아이콘이 그냥 검은색 박스라서 알아보기가 힘들어. 가능하면 로고 이미지를 아이콘으로 적용해줘.

## 변경 파일

- `src/app/page.settings/view.pug`
  - `닫을 때 백그라운드 유지` 컨트롤을 checkbox input에서 자동 저장과 동일한 `button role="switch"` UI로 변경했다.
- `src/app/page.settings/view.ts`
  - `toggle()`에서 `keepInBackgroundOnClose`도 처리할 수 있도록 `ToggleKey`에 해당 키를 추가했다.
- `electron/main.cjs`
  - macOS 트레이 아이콘 경로를 `build-resources/tray-icon.png`로 분기했다.
  - 트레이 전용 아이콘이 비어 있으면 기존 앱 아이콘으로 fallback하도록 처리했다.
  - Windows/Linux는 기존 컬러 앱 아이콘을 계속 사용하게 유지했다.
- `build-resources/tray-icon.svg`
  - 배경 없는 문서 로고 형태의 macOS 상태바 템플릿 아이콘 원본을 추가했다.
- `build-resources/tray-icon.png`
  - `tray-icon.svg`에서 생성한 64x64 RGBA PNG 상태바 아이콘을 추가했다.

## 확인 결과

- `node --check electron/main.cjs` 통과.
- `node --check electron/preload.cjs` 통과.
- `file build-resources/tray-icon.png`로 64x64 RGBA PNG 생성 확인.
- `wiz_project_build(clean=false)` 성공.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/settings`에서 200 OK와 최신 빌드 시각을 확인했다.
- 빌드 산출물 `build/dist/build/main.js`에서 `닫을 때 백그라운드 유지`가 `button role="switch"`로 렌더링되는 템플릿을 확인했다.
- `git diff --check` 통과.

## 남은 리스크

- Browser 플러그인에서 `iab` 세션을 제공하지 않아 실제 브라우저 화면 클릭/시각 검증은 수행하지 못했다.
- macOS 상태바 아이콘 표시 품질은 실제 Electron 앱 실행 환경의 메뉴바에서 최종 확인이 필요하다.
