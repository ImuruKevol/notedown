# Notedown 0.2.5 데스크톱 릴리스

- **ID**: 003
- **날짜**: 2026-08-19
- **유형**: 릴리스

## 작업 요약

Android/Capacitor 앱 제거와 Electron 다중 기기 동기화·삭제 충돌 수렴 보강을 포함해 Notedown 데스크톱 앱 버전을 `0.2.5`로 상향한다. 전체 변경과 릴리즈 로그를 `release: Notedown 0.2.5` 커밋으로 기록하고 annotated tag `0.2.5`를 생성한다.

이번 변경은 Electron/WIZ 클라이언트에만 적용됐으며 동기화 서버 저장소, API 구현, Dockerfile 또는 compose 구성은 변경하지 않았다. 따라서 서버 이미지 버전 갱신과 registry push는 수행하지 않는다.

## 원문 요청사항

```text
버전업을 하고 git commit, tag를 해줘. 당연하지만 릴리즈 로그도 작성해야하고.
서버쪽 수정을 했으면 서버 이미지도 갱신해서 push까지 해줘
```

## 릴리스 버전

- Notedown 데스크톱: `0.2.5`
- 지원 플랫폼: macOS, Windows
- Android: 지원 및 프로젝트 제거
- Notedown Sync Server: 변경 없음

## 릴리스 노트

- Android 네이티브 프로젝트, Capacitor 패키지·스크립트·브리지와 Android 전용 UI/문서를 제거했다.
- 포커스 또는 화면 표시 상태 복귀 시 실행되던 전체 동기화를 제거했다. 자동 동기화는 앱 시작과 저장 시에만 실행하며, 전체 동기화는 사용자가 버튼으로 실행한다.
- 문서 삭제 충돌을 존재하지 않는 파일 재읽기가 아닌 로컬 삭제 tombstone으로 해결할 수 있게 했다.
- 문서 삭제 시 첨부 tombstone을 먼저 전송하고 문서 tombstone을 마지막에 전송해 다중 기기 삭제 수렴 순서를 고정했다.
- 충돌 응답의 최신 manifest가 충돌 경로의 이전 `lastKnownRevision`을 덮어쓰지 않게 하고, 같은 전체 동기화에서 이후 manifest가 해당 경로를 다시 오염시키지 않도록 했다.
- 업로드 응답 유실 시 변경 POST를 무조건 재전송하지 않고, 서버 manifest에서 동일 content hash 또는 삭제 tombstone이 증명될 때만 성공으로 복구한다.
- stale 또는 revision 없는 manifest, 로컬 저장 경합, 기기별 실제 저장 경로 차이로 인한 revision rollback과 오인 충돌을 방어한다.

## 주요 변경 파일

- `electron/main.cjs`
- `electron/sync-state.cjs`, `electron/sync-state.test.cjs`
- `src/app/component.nav.sidebar/view.ts`
- `src/app/layout.sidebar/view.ts`
- `src/app/page.notes/view.ts`, `src/app/page.notes/view.pug`
- `src/app/page.settings/view.ts`, `src/app/page.settings/view.pug`
- `src/angular/main.ts`
- `android/` 전체, `src/angular/app/notedown-android-bridge.ts`, `capacitor.config.json`, `docs/android-environment.md` 제거
- `package.json`, 로컬 `package-lock.json`
- `README.md`
- `devlog.md`, `devlog/2026-08-19/001-sync-convergence-delete-conflict-hardening.md`, `devlog/2026-08-19/002-remove-android-focus-sync-audit.md`, `devlog/2026-08-19/003-release-0-2-5.md`

## Git 릴리스

- 앱 릴리스 커밋 메시지: `release: Notedown 0.2.5`
- 앱 annotated tag: `0.2.5`
- 서버 저장소: 변경·커밋·태그·이미지 push 없음

## 검증 결과

- WIZ 일반 빌드(`clean=false`) 성공.
- Electron 테스트 29개 통과.
- Electron main/sync-state 구문 검사 성공.
- Android/Capacitor 소스·구성·의존성 잔여 참조가 없음을 확인했다.
- 전체 동기화 호출점이 앱 시작과 수동 동기화 버튼으로 제한되고 focus activation sync가 제거됐음을 확인했다.
- Git diff whitespace 검사 성공.

## 알려진 제한 사항

- 이번 요청에는 설치 패키지 생성이나 배포 저장소 업로드가 포함되지 않아 macOS PKG/ZIP 및 Windows NSIS 산출물은 생성하지 않는다.
- WIZ 개발 서버가 실행 중이지 않아 브라우저 UI smoke test는 수행하지 않았으며, WIZ 프로덕션 빌드로 컴파일을 검증했다.
- Git 원격 push는 요청되지 않아 커밋과 tag는 로컬 저장소에 생성한다.
