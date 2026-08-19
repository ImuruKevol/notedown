# Android 제거 및 자동 동기화·다중 기기 충돌 기준 보강

- **ID**: 002
- **날짜**: 2026-08-19
- **유형**: 기능 제거 / 버그 수정

## 작업 요약

Android 네이티브 프로젝트, Capacitor 구성과 패키지, Angular 브리지, Android 전용 UI·저장소·PDF 분기, 관련 문서를 제거해 Electron 데스크톱 앱만 유지했다. 추적되지 않던 Android 빌드 잔여물까지 작업 경로에서 제거했으며, 복구할 수 있도록 macOS 휴지통의 `notedown-android-removed-20260819-1428` 폴더로 이동했다.

앱이 blur/비활성 상태에서 focus/visible 상태로 돌아올 때 실행하던 전체 동기화 이벤트와 시간 기반 activation sync 제어를 제거했다. 전체 동기화 진입점은 앱 시작 시 1회, 사이드바 수동 동기화 버튼, 설정의 전체 동기화 버튼으로 제한했다. 저장 시에는 기존처럼 해당 문서와 첨부만 업로드하며, 노트 화면의 focus/visibility 리스너는 커서와 선택 영역 복원에만 사용한다.

다중 기기 동기화와 충돌 체크포인트를 다시 감사했다. 업로드 경합으로 충돌 응답을 받았을 때 최신 서버 manifest를 그대로 기록하면 충돌 경로의 이전 `lastKnownRevision`까지 최신값으로 오염되어 다음 계획에서 충돌이 사라질 수 있었다. 충돌한 파일·첨부 경로와 metadata 기준 revision은 보존하고, 같은 실행에서 정상 처리된 다른 경로와 전역 server revision만 전진하도록 수정했다. 이후 성공한 업로드의 manifest가 앞선 충돌 경로를 다시 덮어쓰지 않도록 전체 동기화 동안 보존 경로를 누적한다.

파일/첨부 변경 POST를 네트워크 오류 직후 무조건 재전송하던 흐름도 제거했다. 첫 요청이 서버에는 반영되고 응답만 유실된 경우 오래된 revision으로 재전송되어 가짜 충돌이 날 수 있으므로, 오류 후 서버 manifest에서 같은 content hash 또는 삭제 tombstone이 확인되는 경우에만 이미 반영된 요청으로 복구한다. 동기화가 시작된 이후 revision이 없거나 stale인 manifest가 로컬 기준 revision을 되돌리지 못하도록 방어 검증도 추가했다.

## 원문 요청사항

```text
일단 안드로이드 앱에 대한건 그냥 완전히 제거해줘.
그리고 앱이 포커싱이 풀렸다가 다시 포커싱이 되는 경우 자동으로 동기화가 돌아가는데, 이 기능은 제거해줘. 자동 동기화는 앱을 켰을 때, 저장 시 말고는 없어야 해. 전체 동기화가 필요하면 동기화 버튼을 클릭하면 돼.

그리고 동기화에 대해서 여러 기기를 사용할 때에 대해 로직이 꼬이는 일이 없을지 한 번 더 로직을 상세하게 확인해줘. 충돌 관련해서도 마찬가지고.
```

## 변경 파일 목록

- `android/` 전체, `capacitor.config.json`, `docs/android-environment.md`
  - Android/Capacitor 프로젝트와 문서를 제거했다.
- `package.json`, `package-lock.json`
  - Android 스크립트와 Capacitor 패키지를 제거했다.
- `src/angular/main.ts`, `src/angular/app/notedown-android-bridge.ts`
  - Android 브리지 로딩과 구현을 제거했다.
- `src/app/page.notes/view.ts`, `src/app/page.notes/view.pug`
  - Android 전용 편집기·툴바·첨부 미리보기·PDF 분기와 죽은 보조 코드를 제거했다.
- `src/app/page.settings/view.ts`, `src/app/page.settings/view.pug`
  - Android 전용 설정 섹션 제한과 기본값 분기를 제거했다.
- `src/app/layout.sidebar/view.ts`
  - focus/blur/visibility 기반 전체 동기화를 제거하고 수동 전체 동기화 상태만 관리하도록 정리했다.
- `electron/main.cjs`
  - 충돌 경로 revision 보존 체크포인트, 누적 충돌 보호, 업로드 응답 유실 복구를 적용했다.
- `electron/sync-state.cjs`, `electron/sync-state.test.cjs`
  - 충돌-safe manifest 병합과 업로드 반영 증명 로직 및 회귀 테스트를 추가했다.
- `README.md`
  - Android 안내를 제거하고 허용된 자동/수동 동기화 시점을 명시했다.
- `devlog.md`
- `devlog/2026-08-19/002-remove-android-focus-sync-audit.md`

## 검증 결과

- `npm run test:electron` 성공: 29개 테스트 통과.
- `node --check electron/main.cjs` 및 `node --check electron/sync-state.cjs` 통과.
- `wiz_project_build(projectName=main, clean=false)` 성공.
- `npm ls @capacitor/core @capacitor/android @capacitor/cli --depth=0` 결과가 비어 있음을 확인했다.
- Android/Capacitor 코드·구성·문서 참조가 현재 앱 소스에서 모두 제거됐음을 확인했다. 과거 작업 이력인 기존 devlog는 감사 기록으로 유지했다.
- 전체 동기화 호출점이 앱 시작과 두 수동 버튼으로만 제한되고 activation sync 식별자가 제거됐음을 확인했다.
- `git diff --check` 및 `git diff --cached --check` 통과.
- WIZ 개발 서버가 실행 중이지 않아 쿠키를 포함한 실시간 UI HTTP 검증은 수행하지 못했으며, 서버 재시작 없이 WIZ 빌드 검증으로 대체했다.
