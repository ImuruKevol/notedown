# Electron 및 Android 앱 버전 0.2.0 상향

- 날짜: 2026-06-29
- 작업 ID: 003
- 리뷰 ID: zypnwcrwfrkjnxbvehuryogdohgeazll

## 사용자 요청

0.2.0으로 버전을 올려줘.

## 변경 파일

- `package.json`
  - Electron 배포 및 앱 패키지 버전을 `0.1.0`에서 `0.2.0`으로 변경했다.
- `package-lock.json`
  - 로컬 lockfile의 루트 패키지 버전도 `0.2.0`으로 맞췄다. 이 파일은 현재 `.gitignore` 대상이다.
- `android/app/build.gradle`
  - Android `versionName`을 `0.2.0`으로 변경했다.
  - Android `versionCode`를 `1`에서 `2`로 증가시켰다.
- `devlog.md`
- `devlog/2026-06-29/003-app-version-0-2-0.md`

## 검증 결과

- `npm pkg get version`으로 패키지 버전 `0.2.0`을 확인했다.
- `rg`로 `android/app/build.gradle`의 `versionCode 2`, `versionName "0.2.0"`을 확인했다.
- `git diff --check`로 공백 오류가 없음을 확인했다.

## 비고

- 이번 요청은 버전 메타데이터 변경만 수행했다.
- 변경 후 Electron/Android 재빌드는 별도로 수행하지 않았다.
