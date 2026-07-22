# 사이드바 수동 동기화 및 앱 내 업데이트 설치

- **ID**: 001
- **날짜**: 2026-07-22
- **유형**: 기능 추가

## 작업 요약

노트 목록 하단 상태 영역에 저장과 분리된 수동 전체 동기화 버튼을 추가했다. 데스크톱 설정 화면에는 공개 FileBrowser 공유의 버전 디렉토리를 확인하고, 현재 운영체제와 CPU에 맞는 PKG/EXE를 내려받아 설치한 뒤 앱을 다시 여는 업데이트 흐름을 추가했다.

## 원문 요청사항

```text
작업 시작.
업데이트 확인 기능이 가능하면 앱 자체에서 업데이트 파일을 다운로드하고 바로 버전을 올려서 다시 열 수 있도록 하는 편의 기능 필요. 다른 앱들에도 있는 것처럼?

- 왼쪽 사이드 패널(노트 목록)에 수동 동기화 버튼 추가 필요. 저장 시 "동기화 중", "동기화 완료" 메세지가 뜨는 자리에 추가하면 될 듯. 클릭하면 저장 동작이 아니라 동기화를 하는 형태로.
- 가능하면 업데이트 확인 기능 추가 요망. file storage 컨테이너를 다른 서버에 띄워서 사용 중인데, https://file.nanoha.kr/share/i3TGy3GF 이 링크에 버전별 디렉토리를 확인할 수 있도록 공유 처리를 해놨음.
```

## 변경 파일 목록

- `electron/updater.cjs`: FileBrowser 버전 조회, 플랫폼별 설치 파일 선택, 제한 다운로드 및 기본 형식 검증 추가
- `electron/updater.test.cjs`: 버전 비교, 설치 파일 선택, 다운로드 완료·거부·상한 테스트 추가
- `electron/main.cjs`: 업데이트 IPC와 macOS PKG/Windows NSIS 설치·재실행 흐름 추가
- `electron/preload.cjs`: renderer용 안전한 업데이트 브리지 추가
- `build-resources/installer.nsh`: Windows 업데이트 설치 시 초기 설정 보존 및 강제 재실행 지원
- `src/app/component.nav.sidebar/view.pug`, `src/app/component.nav.sidebar/view.ts`: 수동 동기화 버튼과 상태 UX 추가
- `src/app/layout.sidebar/view.pug`, `src/app/layout.sidebar/view.ts`: 수동 전체 동기화 실행 소유권과 업데이트 확인 모달 포털 연결
- `src/app/page.settings/view.pug`, `src/app/page.settings/view.ts`: 업데이트 확인·다운로드·설치 UI와 진행 상태 추가
- `package.json`: Electron 테스트 명령 추가
- `README.md`: 수동 동기화, 앱 업데이트, 배포 파일명 규칙 문서화
- `devlog.md`, `devlog/2026-07-22/001-manual-sync-in-app-update.md`: 작업 이력 기록

## 검증 결과

- WIZ 일반 빌드(`clean=false`) 성공: `main.js` 4.36 MB, `styles.css` 203.66 kB
- `npm run test:electron`: 21개 테스트 전체 통과
- Electron main/preload/updater `node --check` 및 `git diff --check` 통과
- 공개 공유 API의 버전/파일 목록과 macOS arm64 PKG Range 응답의 `xar!` 헤더 확인
- Playwright UI 검증 성공: 필수 WIZ 쿠키 적용 후 수동 동기화 상태, 업데이트 확인 결과, 다운로드·설치 확인 모달 확인
- Windows NSIS x64 전체 빌드 성공 및 패키지 ASAR의 updater 파일과 `--force-run` 재실행 인자 확인
- macOS 설치 AppleScript 문법 컴파일 성공
- Notedown Server 기존 테스트 49개 통과; 서버 소스 변경 없음

## 남은 리스크

- 현재 제공된 macOS PKG와 Windows EXE가 배포자 서명되지 않았고 공유 저장소에도 서명된 manifest/checksum이 없어, 파일 크기와 형식 헤더만 확인한다. 운영 배포 전 Developer ID/공증과 Windows 코드 서명 또는 별도 서명 manifest 적용이 필요하다.
- 실제 이전 버전 설치본에서 관리자 권한 설치와 앱 재실행을 끝까지 수행하는 macOS/Windows E2E 검증은 하지 않았다.
