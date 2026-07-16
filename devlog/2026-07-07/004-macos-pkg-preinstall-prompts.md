# macOS PKG 설치 중 초기 구성 입력 대화상자 추가

- 날짜: 2026-07-07
- ID: 004
- 리뷰 ID: xfathofjjkckpklnslutpdfzwbebgnyu
- 제목: 프로그램 설치 시 버그

## 사용자 원문 요청

```text
postinstall이란건 뭐야? pkg로 설치하니까 뭐가 아무것도 안뜨는데?
가능하면 설치 마법사에서 할 수 있었으면 좋겠는데
```

## 변경 파일

- `package.json`
- `build-resources/pkg-scripts/preinstall`
- `devlog.md`
- `devlog/2026-07-07/004-macos-pkg-preinstall-prompts.md`

## 변경 내용

- `postinstall`은 PKG 설치 후 조용히 실행되는 script라 사용자 입력 화면이 뜨지 않는다는 문제를 확인했다.
- macOS PKG에 `preinstall` script를 추가해 설치 중 AppleScript 대화상자로 저장소 디렉토리, 동기화 서버 URL, 사용자 이름, 백그라운드 유지, 로그인 시 시작 여부를 입력받도록 했다.
- 사용자가 취소하거나 GUI 대화상자 실행이 실패하면 기존 기본값으로 fallback되도록 했다.
- `pkg.scripts` 경로가 build resources 기준 상대 경로임을 확인하고, 실제 산출물에 scripts가 포함되도록 `pkg-scripts`로 수정했다.

## 검증 결과

- `sh -n build-resources/pkg-scripts/preinstall` 성공.
- `sh -n build-resources/pkg-scripts/postinstall` 성공.
- `package.json` JSON 파싱 성공.
- `git diff --check` 성공.
- `npx electron-builder --mac pkg --arm64 --publish never` 성공.
- `pkgutil --expand dist/Notedown-0.2.0-mac-arm64.pkg`로 산출물 내부에 `Scripts/preinstall`과 `Scripts/postinstall`이 포함된 것을 확인했다.

## 남은 리스크

- AppleScript 대화상자는 설치 중 뜨는 modal prompt이며, Windows NSIS처럼 Installer 창 안에 완전히 내장된 custom page는 아니다.
- macOS 보안/실행 환경에 따라 GUI prompt가 실패할 수 있으며, 이 경우 기본 설정으로 fallback된다.
