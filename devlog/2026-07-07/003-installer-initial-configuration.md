# 초기 구성을 앱 마법사에서 설치 단계로 이전

- 날짜: 2026-07-07
- ID: 003
- 리뷰 ID: xfathofjjkckpklnslutpdfzwbebgnyu
- 제목: 프로그램 설치 시 버그

## 사용자 원문 요청

```text
첫 실행이라는 판단 기준 자체를 설치 단계에 추가하는게 나을 것 같아.
현재 /settings 구성 마법사를 그냥 완전히 삭제하고, 이 역할을 설치 단계에 넘기는게 나을 것 같아.
윈도우에서는 설치 마법사에서 초기 구성에 대한 부분들을 직접 입력하거나 선택할 수 있도록 하는 단계를 추가하면 되고, 맥에서는 지금처럼 dmg 형태가 아니라 pkg 형태로 해서 설치 마법사 형태로 진행하도록 바꿔서 하면 될 것 같아.
```

## 변경 파일

- `electron/main.cjs`
- `electron/preload.cjs`
- `package.json`
- `build-resources/installer.nsh`
- `build-resources/pkg-scripts/postinstall`
- `src/angular/app/app.component.ts`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/page.notes/view.ts`
- `src/app/layout.sidebar/view.ts`
- `devlog.md`
- `devlog/2026-07-07/003-installer-initial-configuration.md`

## 변경 내용

- `/settings` 구성 마법사 UI와 앱 시작 시 `/settings`로 강제 이동하던 첫 실행 판단을 제거했다.
- Electron preload/main에 installer 설정 import IPC를 추가했다. 앱 설정 localStorage가 비어 있으면 `installer-settings.ini`를 읽어 `notedown.settings.v1`로 가져온다.
- 설정 완료 여부에 묶여 있던 노트 저장소 로드와 자동 동기화 가드를 제거하고, 동기화는 서버 URL/token/clientId가 모두 있을 때만 실행하도록 단순화했다.
- Windows NSIS 설치 마법사에 초기 구성 페이지를 추가했다. 저장소 디렉토리, 동기화 서버 URL, 사용자 이름, 백그라운드 유지, 시작 프로그램 등록 값을 받아 `%APPDATA%\Notedown\installer-settings.ini`에 저장한다.
- macOS 배포 타깃을 `dmg`에서 `pkg`로 바꾸고, PKG postinstall script가 사용자 Application Support와 기본 저장소 디렉토리 및 `installer-settings.ini`를 준비하도록 했다.

## 검증 결과

- `node --check electron/main.cjs && node --check electron/preload.cjs` 성공.
- `package.json` JSON 파싱 성공.
- `git diff --check` 성공.
- WIZ `main` 프로젝트 빌드 성공.
- Playwright로 빌드 산출물에서 localStorage 초기화 후 `/` 진입 시 `/notes`에 머물고 구성 마법사 문구가 없음을 확인했다.
- Playwright로 설정 링크 진입 시 제목이 `설정`이고 구성 마법사 문구가 없음을 확인했다.
- `npx electron-builder --mac pkg --arm64 --publish never` 성공. 산출물: `dist/Notedown-0.2.0-mac-arm64.pkg`.
- `npx electron-builder --win nsis --x64 --publish never` 성공. 산출물: `dist/Notedown-0.2.0-win-x64.exe`.
- 요청 링크 `http://172.16.0.143:5500`는 쿠키 포함 `curl -I`에서 `302 /login`으로 응답함을 확인했다.

## 남은 리스크

- macOS PKG는 installer 형태로 전환했지만, 현재 구현은 postinstall에서 기본 설정 파일을 준비하는 방식이다. Windows NSIS처럼 사용자 입력 custom page를 macOS Installer에 동일하게 제공하지는 않는다.
- 동기화 비밀번호/token은 installer 설정 파일에 저장하지 않는다. 서버 URL과 사용자 이름만 installer에서 넘기고 실제 로그인은 앱 설정 화면에서 수행해야 한다.
