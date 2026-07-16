# macOS PKG 설치 script 중복 실행 방지

- 날짜: 2026-07-07
- ID: 005
- 리뷰 ID: xfathofjjkckpklnslutpdfzwbebgnyu
- 제목: 프로그램 설치 시 버그

## 사용자 원문 요청

```text
postscript가 두번이나 중복으로 실행되는 버그가 있어.
```

## 변경 파일

- `build-resources/pkg-scripts/preinstall`
- `build-resources/pkg-scripts/postinstall`
- `devlog.md`
- `devlog/2026-07-07/005-macos-pkg-script-dedup.md`

## 변경 내용

- macOS PKG에 `preinstall`과 `postinstall` 두 script가 함께 포함되던 구조를 `preinstall` 하나로 정리했다.
- `preinstall` 시작 시 `installer-settings.ini`가 이미 있으면 즉시 종료하도록 guard를 추가해, 설치 엔진이 script를 반복 호출해도 prompt와 설정 쓰기가 중복되지 않도록 했다.
- 기본값 fallback과 설정 파일 생성은 `preinstall` 안에서 처리하므로 별도 `postinstall` script를 제거했다.

## 검증 결과

- `sh -n build-resources/pkg-scripts/preinstall` 성공.
- `git diff --check` 성공.
- `npx electron-builder --mac pkg --arm64 --publish never` 성공.
- `pkgutil --expand dist/Notedown-0.2.0-mac-arm64.pkg`로 산출물 내부에 `Scripts/preinstall`만 있고 `Scripts/postinstall`은 없는 것을 확인했다.

## 남은 리스크

- 기존에 설치되어 `installer-settings.ini`가 남아 있는 환경에서는 재설치 시 초기 구성 prompt를 건너뛴다.
