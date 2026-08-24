# Notedown 0.2.6 데스크톱 안정화 릴리스

- **ID**: 004
- **날짜**: 2026-08-24
- **유형**: 릴리스

## 작업 요약

다중 기기 동기화 기준선, 서버 revision 재설정 복구, 삭제 tombstone, 저속·오프라인 네트워크, 충돌 일괄 해결과 Windows startup 보강을 포함해 Notedown 데스크톱 앱 버전을 `0.2.6`으로 상향했다. WIZ 프로덕션 번들과 Electron 회귀 테스트를 검증한 뒤 macOS arm64/x64 및 Windows x64 설치 파일을 생성하고, 전체 변경을 릴리스 커밋과 annotated tag로 기록한다.

이번 릴리스에는 동기화 서버 저장소, API, Dockerfile 또는 컨테이너 구성이 변경되지 않았다. 따라서 서버 이미지 버전 갱신과 registry push는 수행하지 않는다.

## 원문 요청사항

```text
버전을 올리고 git commit, tag 등을 진행해줘.
electron 앱도 빌드하고.
```

## 릴리스 버전

- Notedown 데스크톱: `0.2.6`
- 지원 플랫폼: macOS arm64, macOS x64, Windows x64
- Notedown Sync Server: 변경 없음

## 릴리스 노트

- 서버 revision이 이전 로컬 체크포인트보다 낮아진 복원·교체 상황을 반복 충돌이나 전체 삭제로 오인하지 않도록 안전한 재기준화 절차를 추가했다.
- 실제 사용자 삭제만 명시적 tombstone으로 서버에 반영하고, 파일 부재·권한 오류·손상된 상태 파일을 삭제 의도로 오인하지 않게 했다.
- 다중 기기에서 다른 문서를 저장한 결과가 아직 업로드하지 않은 로컬 편집 문서의 기준 revision과 hash를 덮어쓰지 않도록 경로별 체크포인트를 보호했다.
- 전송 중 다시 편집된 문서는 실제 전송한 snapshot까지만 동기화 완료로 기록해 후속 변경을 보존한다.
- 서버 버전으로 충돌을 해결하는 도중 다른 기기가 같은 문서를 다시 수정하면 새 서버 revision을 잘못 승인하지 않고 충돌을 유지한다.
- 서버 삭제 충돌을 해결할 때 존재하지 않는 파일을 다시 요청하지 않고 삭제 tombstone을 직접 적용하며 연결된 로컬 첨부 파일도 정리한다.
- 여러 충돌을 선택해 서버 또는 로컬 기준으로 일괄 적용할 수 있으며, 부분 성공·오프라인·로컬 저장 경합 시 성공 항목과 보류 항목을 구분한다.
- 제어 요청과 데이터 전송 요청의 timeout을 분리하고 파일 크기 기반 적응형 제한, 지연 commit 확인 저널과 manifest polling으로 저속·응답 유실 환경을 보강했다.
- Windows 시작 프로그램 등록 경로·인자·활성 상태 readback과 NSIS HKCU Run 등록을 보강했다.

## 주요 변경 파일

- `electron/main.cjs`, `electron/preload.cjs`
- `electron/sync-state.cjs`, `electron/sync-state.test.cjs`
- `electron/sync-rebase.cjs`, `electron/sync-rebase.test.cjs`
- `electron/sync-network.cjs`, `electron/sync-network.test.cjs`
- `electron/sync-conflict-batch.cjs`, `electron/sync-conflict-batch.test.cjs`
- `electron/startup-settings.cjs`, `electron/startup-settings.test.cjs`
- `electron/storage-identity.cjs`, `electron/storage-runtime.test.cjs`
- `build-resources/installer.nsh`
- `src/app/page.notes/view.ts`, `src/app/page.notes/view.pug`
- `package.json`, 로컬 `package-lock.json`
- `devlog.md`, `devlog/2026-08-19/004-build-electron-0-2-5.md`, `devlog/2026-08-24/`

## Git 릴리스

- 앱 릴리스 커밋 메시지: `release: Notedown 0.2.6`
- 앱 annotated tag: `0.2.6`
- 원격 대상: `origin/main`, `origin` tag `0.2.6`
- 서버 저장소: 변경·커밋·태그·이미지 push 없음

## 빌드 산출물

- macOS arm64: `dist/Notedown-0.2.6-mac-arm64.pkg`, `dist/Notedown-0.2.6-mac-arm64.zip`
- macOS x64: `dist/Notedown-0.2.6-mac-x64.pkg`, `dist/Notedown-0.2.6-mac-x64.zip`
- Windows x64: `dist/Notedown-0.2.6-win-x64.exe`

## 산출물 SHA-256

- `Notedown-0.2.6-mac-arm64.pkg`: `93d085cdee829b055193254a732611aa8f71c7238dac0ba10cb14e5a8e9066c3`
- `Notedown-0.2.6-mac-arm64.zip`: `20d0943656f7e5fd8eebabe7ed354d487a1e54e137ab5f7f3376f50828e2ea7a`
- `Notedown-0.2.6-mac-x64.pkg`: `3692017a40f856c835cb3ed0957deb3c304135195f112703f8cfdf12862914c6`
- `Notedown-0.2.6-mac-x64.zip`: `b5dcc3b8aa174a36e692f72ee8978833e5261b4bc83d41e9e5df4c59b478d0d6`
- `Notedown-0.2.6-win-x64.exe`: `5987964f8cb19f026b6df5b79b0dc95f7d4308cbaec4d986072a49a0a194d85f`

## 검증 결과

- `npm run test:electron` 성공: 60개 테스트 통과.
- Electron main/preload 및 신규 동기화·startup 모듈 구문 검사 성공.
- `git diff --check` 성공.
- `wiz_project_build(projectName=main, clean=false)` 성공: `main.js` 4.27 MB, 전체 4.47 MB.
- `npm run dist:requested` 성공: macOS arm64/x64 PKG·ZIP 및 Windows x64 NSIS 생성.
- macOS 실행 파일 아키텍처가 각각 arm64/x86_64이고 앱 버전이 `0.2.6`임을 확인했다.
- macOS 앱 codesign 무결성, ZIP 압축 무결성 및 Windows NSIS PE 형식을 확인했다.
- macOS arm64/x64와 Windows ASAR에서 패키지 버전 `0.2.6`, 최신 WIZ 번들 및 동기화·startup 모듈 포함을 확인했다.
- 실제 사용자 문서와 동기화 서버 데이터는 변경하지 않았다.

## 알려진 제한 사항

- macOS 패키지는 공증되지 않았으며, Windows 설치 파일의 운영 배포용 Authenticode 인증서 서명 여부는 별도로 확인해야 한다.
- 실제 이전 버전 설치본에서 0.2.6 자동 업데이트 설치와 재실행을 끝까지 수행하는 E2E는 이번 빌드 검증 범위에 포함하지 않았다.
