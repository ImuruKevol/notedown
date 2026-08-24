# Notedown 0.2.5 Electron 멀티플랫폼 설치 파일 빌드

- **ID**: 004
- **날짜**: 2026-08-19
- **유형**: 빌드

## 작업 요약

Notedown Electron 앱 0.2.5를 macOS ARM64, macOS x64, Windows x64용으로 패키징했다. 패키지 내부 버전과 실행 파일 아키텍처, macOS ZIP 및 PKG 아카이브 무결성, macOS 앱 번들 코드 서명 상태와 SHA-256 체크섬을 검증했다.

## 원문 요청사항

```text
0.2.5 electron 앱도 빌드해줘
```

## 생성 파일

- `dist/Notedown-0.2.5-mac-arm64.pkg`
- `dist/Notedown-0.2.5-mac-arm64.zip`
- `dist/Notedown-0.2.5-mac-arm64.zip.blockmap`
- `dist/Notedown-0.2.5-mac-x64.pkg`
- `dist/Notedown-0.2.5-mac-x64.zip`
- `dist/Notedown-0.2.5-mac-x64.zip.blockmap`
- `dist/Notedown-0.2.5-win-x64.exe`
- `dist/Notedown-0.2.5-win-x64.exe.blockmap`
- `dist/latest-mac.yml`
- `dist/latest.yml`

## 변경 파일

- `devlog.md`
- `devlog/2026-08-19/004-build-electron-0-2-5.md`

`dist/` 산출물은 Git ignore 대상이며 제품 소스는 변경하지 않았다.

## 검증 결과

- Electron 테스트 29개 통과.
- `npm run dist:requested` 성공.
- macOS ARM64 및 x64 앱의 `CFBundleShortVersionString`, `CFBundleVersion`, 패키지 내부 `package.json` 버전이 모두 `0.2.5`임을 확인했다.
- Windows 패키지 내부 `package.json` 버전이 `0.2.5`이고 실제 앱 실행 파일이 PE32+ x86-64임을 확인했다.
- 두 macOS ZIP에 대해 `unzip -t` 무결성 검사를 통과했다.
- 두 macOS PKG를 `xar`로 정상 열 수 있음을 확인했다.
- 두 macOS 앱 번들에 대해 `codesign --verify --deep --strict` 검사를 통과했다.

## SHA-256

- macOS ARM64 PKG: `f8f662e3f56489dc5c02a8eada64d9352fbc2b8fafd3b753eea4427f60caed69`
- macOS ARM64 ZIP: `f9345b210b3cbd8fa53d653e5c87df06a9aa48d86d52155b392ae0be8939963b`
- macOS x64 PKG: `f0f35ea001442e5a45b1b6f0771975f32c61072163124050549321b1a2eafdd6`
- macOS x64 ZIP: `bdf32d864ec06a967345719db11397c014e59bc4f1094801c247e45948337267`
- Windows x64 NSIS: `98ea89aad906306f3613cfb659219c960b417e9e6e9d303037d2a5782777c362`

## 알려진 제한 사항

- macOS 앱은 현재 빌드 설정에 따라 ad-hoc 서명됐으며 Apple notarization은 적용되지 않았다.
- macOS PKG와 Windows NSIS 설치 파일에는 배포자 인증서 서명이 없다. 외부 배포 시 운영체제의 신뢰 경고가 표시될 수 있다.
- 순차 아키텍처 빌드로 생성된 `latest-mac.yml`은 마지막 macOS x64 ZIP을 가리킨다. 이번 요청은 로컬 설치 파일 생성만 포함하므로 산출물 업로드나 자동 업데이트 채널 배포는 수행하지 않았다.
