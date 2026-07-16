# 동기화 서버 주소 기본값 제거

- 날짜: 2026-07-07
- ID: 002
- 리뷰 ID: xfathofjjkckpklnslutpdfzwbebgnyu
- 제목: 프로그램 설치 시 버그

## 사용자 원문 요청

```text
동기화 주소 기본값이 http://172.16.0.143:5500 이걸로 되어있는 것 같던데, 기본값은 넣으면 안돼.
```

## 변경 파일

- `electron/main.cjs`
- `src/angular/app/notedown-android-bridge.ts`
- `src/app/page.settings/view.ts`
- `src/app/layout.sidebar/view.ts`
- `devlog.md`
- `devlog/2026-07-07/002-remove-default-sync-server-url.md`

## 변경 내용

- Electron sync handler와 Android bridge에서 하드코딩된 동기화 서버 기본값을 제거했다.
- 서버 주소가 비어 있을 때 임의 기본값으로 보정하지 않고 `동기화 서버 주소를 입력해야 합니다.` 오류를 반환하도록 했다.
- 설정 화면과 사이드바 기본 설정의 `syncServerUrl`을 빈 문자열로 변경했다.
- 이전 버전에서 계정/토큰 없이 자동 저장된 레거시 기본 주소는 설정 로드 시 빈 값으로 마이그레이션하도록 했다.

## 검증 결과

- `rg`로 Electron/Android/설정/노트 주요 소스와 빌드 산출물에서 `http://172.16.0.143:5500` 문자열이 남지 않았음을 확인했다.
- `node --check electron/main.cjs` 성공.
- `git diff --check` 성공.
- WIZ `main` 프로젝트 빌드 성공.
- Playwright로 빌드 산출물을 확인했고, 첫 실행 구성 마법사에서 동기화 등록을 켰을 때 서버 URL 입력값이 빈 문자열인 것을 확인했다.
