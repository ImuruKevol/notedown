# 시작 프로그램 등록 설정 추가

## 사용자 원 요청

> ReviewOps 리뷰 ID: bpwqgezbpdnxwuxzfmkeqnwoadteofam
>
> 제목: 시작 프로그램 등록 기능 추가
>
> 요청 링크: http://172.16.0.143:3009
>
> 작업 시작

## 변경 파일

- `electron/main.cjs`
  - Electron `app.getLoginItemSettings()` / `app.setLoginItemSettings()` 기반 시작 프로그램 등록 상태 조회와 적용 로직을 추가했다.
  - macOS/Windows 지원 여부를 preferences 응답에 포함하고, Windows는 동일한 `path`/`args`로 상태를 조회하도록 구성했다.
  - 로그인 시작으로 실행된 경우 백그라운드 유지 설정과 함께 창을 숨김 상태로 시작하도록 처리했다.
- `src/app/page.settings/view.ts`
  - `launchAtStartup` 설정값과 지원 여부 상태를 추가했다.
  - Electron preferences의 실제 OS 시작 등록 상태를 UI 설정에 반영하고, 토글 변경 시 앱 preferences와 OS 로그인 항목을 동기화하도록 했다.
- `src/app/page.settings/view.pug`
  - 설정 > 일반 > 앱 영역에 `시작 프로그램 등록` 스위치를 추가했다.
- `src/app/layout.sidebar/view.ts`
  - 커맨드 팔렛트에서 Electron 데스크톱 환경일 때 `시작 프로그램 등록` 설정을 토글할 수 있도록 추가했다.
- `README.md`
  - 설정/데스크톱 동작 기능 목록에 시작 프로그램 등록을 반영했다.
- `devlog.md`
  - 이번 작업 요약 행을 추가했다.

## 확인 결과

- `node --check electron/main.cjs` 통과.
- `node --check electron/preload.cjs` 통과.
- `wiz_project_build(clean=false)` 성공.
- `rg`로 `build/dist/build/main.js`와 `bundle/www/main.js`에 `launchAtStartup`, `시작 프로그램 등록` 템플릿 및 설정 동기화 코드가 반영된 것을 확인했다.
- UI 검증용 쿠키 `season-wiz-project=main; season-wiz-devmode=true`를 넣어 `http://172.16.0.143:3009/settings`와 `http://127.0.0.1:3009/settings`에 접근했으나 포트가 열려 있지 않아 연결되지 않았다.
- 현재 감지된 `127.0.0.1:5000/settings`는 `AirTunes/770.8.1` 403 응답으로 WIZ 앱이 아니어서 화면 검증 대상에서 제외했다.

## 남은 리스크

- macOS 로그인 항목 승인 상태와 Windows 시작 앱 등록은 OS 설정에 쓰는 기능이라 실제 패키지 실행 환경에서 한 번 더 확인이 필요하다.
- 요청 링크 `http://172.16.0.143:3009`가 연결되지 않아 브라우저 시각 검증은 수행하지 못했다.
