# Electron 첫 실행 구성 마법사 및 Windows 설치 종료 처리 보강

- 날짜: 2026-07-07
- ID: 001
- 리뷰 ID: xfathofjjkckpklnslutpdfzwbebgnyu
- 제목: 프로그램 설치 시 버그

## 사용자 원문 요청

```text
작업 시작. Electron app 위주로 확인하고 보완하면 될 것 같고, 안드로이드 앱에서도 발생할 수 있는 버그인지는 로직을 확인해봐야해.

리뷰어 요청 내용:
- 완전 맨 처음에 이 electron 프로그램을 설치 후 서버 정보를 등록하여 동기화를 하려고 하면 파일이 없다느니 권한이 이상하다는 둥 각종 에러가 발생하면서 충돌 뷰어만 뜨고 있음.
- 윈도우에서 이미 이전 버전이 설치가 된 상태에서 버전 업그레이드를 하려고 하면 프로그램이 떠있지도 않은데 종료할 수 없다는 등 에러가 떠서 설치가 안됨. 아예 삭제를 하고 설치를 해야 정상적으로 설치가 진행됨.
- Electron app으로 설치 후 처음 열었을 때 구성 마법사 화면같은걸 띄우도록 할 것.
  - 설정은 어떻게 할건지, 저장할 디렉토리는 어디 경로에 어떤 이름으로 생성해서 저장할건지, 동기화 서버는 등록할건지 등을 선택할 수 있도록.
```

## 변경 파일

- `electron/main.cjs`
- `package.json`
- `build-resources/installer.nsh`
- `src/angular/app/app.component.ts`
- `src/app/layout.sidebar/view.ts`
- `src/app/page.notes/view.ts`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`

## 변경 내용

- Electron 첫 실행 시 저장소와 동기화가 자동 실행되기 전에 설정 화면의 구성 마법사로 진입하도록 초기 설정 완료 플래그를 추가했다.
- 구성 마법사에서 앱 동작, 저장소 경로/metadata 생성, 동기화 서버 등록 여부를 순서대로 선택할 수 있도록 설정 화면을 확장했다.
- 초기 설정 미완료 상태에서는 노트 화면과 사이드바의 시작 동기화가 실행되지 않도록 막아 초기 저장소/권한 오류 가능성을 줄였다.
- Windows 기본 닫기 동작을 백그라운드 유지가 아닌 종료로 바꾸고, 설치/업그레이드 중 기존 숨은 프로세스를 종료하도록 Electron single instance 및 NSIS 초기화 처리를 보강했다.
- Android 네이티브 저장소 생성 로직은 기존에도 metadata를 보장하는 구조임을 확인했고, 공통 Angular 초기 동기화 가드는 Android WebView에도 적용되도록 했다.

## 검증 결과

- `node --check electron/main.cjs && node --check electron/preload.cjs && node --check electron/metadata-store.cjs` 성공.
- `package.json` JSON 파싱 성공.
- WIZ `main` 프로젝트 빌드 성공. 산출물: `/Users/ktw/Documents/notedown/project/main/build/dist/build`.
- 요청 링크 `http://172.16.0.143:5500/settings`는 접속 거부되어 직접 검증하지 못했다.
- 빌드 산출물을 로컬 정적 서버로 띄운 뒤 Playwright로 첫 실행 localStorage 초기화 상태를 확인했다. `/` 진입 후 `/settings` 구성 마법사로 이동했고, `앱 -> 저장소 -> 동기화` 단계가 표시되는 것을 확인했다.
- 정적 서버 검증에서는 WIZ 백엔드가 없어서 `/auth/check` 요청이 501로 실패했지만, 구성 마법사 UI 흐름 확인에는 영향이 없었다.
