# 다중 기기 동기화 및 삭제 충돌 수렴 로직 보강

- **ID**: 001
- **날짜**: 2026-08-19
- **유형**: 버그 수정

## 작업 요약

Electron과 Android의 동기화 계획 생성, 파일/첨부 업로드, 삭제, 충돌 해결, revision 체크포인트 기록 흐름을 함께 점검했다.

로컬에서 삭제된 문서의 충돌을 일반 업로드로 처리해 존재하지 않는 파일을 다시 읽던 문제를 tombstone 삭제 의도로 보존하도록 수정했다. 문서와 첨부 삭제는 첨부 tombstone을 먼저 전송하고 문서 tombstone을 마지막에 전송해, 삭제된 문서가 첨부 메타데이터 처리로 되살아나거나 첨부 삭제가 누락되지 않도록 했다.

서버 반영 도중 로컬 저장이 발생한 경우 이를 문서 충돌로 등록하지 않고 재확인 가능한 상태로 분리했으며, 서버가 이미 반환한 최신 manifest/revision은 안전하게 체크포인트한 뒤 최신 로컬 변경을 다음 동기화의 dirty 변경으로 이어가도록 했다. stale manifest의 revision rollback을 차단하고 실제 `storagePath` 및 첨부 소유 메타데이터를 보존해 기기별 경로 차이로 인한 오인 삭제도 방지했다.

충돌 UI는 로컬 삭제 상태를 파일 읽기 오류로 표시하지 않고 “로컬 삭제 유지”로 해결할 수 있게 했으며, 개별 저장/삭제 동기화 결과는 경로별로 병합해 해결된 충돌만 제거하고 다른 문서의 유효한 충돌은 유지하도록 정리했다.

## 원문 요청사항

```text
여전히 동기화쪽 로직이 개판이야. 동기화 관련 버그가 너무많아.
여러 기기에서 사용할 때 동기화 기준이나 로직이 꼬여서 충돌이 계속 발생하고 있어.
그리고 문서를 삭제한 후 동기화를 하면 충돌이 났다면서 파일을 찾을 수가 없다는 치명적인 버그도 있어. 그리고 그 직후에 다른 문서를 저장해서 동기화를 하면 충돌났다고 계속 뜨고 있고.

동기화 관련해서 확실하게 문제점을 전부 찾아서 보강해줘.
```

## 변경 파일 목록

- `electron/main.cjs`
  - 삭제 충돌 tombstone 처리, 첨부 우선 삭제 순서, 경합 시 manifest 체크포인트, stale revision 방지, 충돌 해결 후 잔여 계획 수렴을 적용했다.
- `electron/sync-state.cjs`
  - manifest 기반 상태 병합과 삭제 충돌/재시도 상태 판정을 분리했다.
- `electron/sync-state.test.cjs`
  - stale manifest, 실제 저장 경로 및 첨부 소유 메타데이터 보존, 삭제 의도, 재시도 상태 회귀 테스트를 추가했다.
- `src/angular/app/notedown-android-bridge.ts`
  - Electron과 같은 삭제/충돌/revision 규칙을 적용하고 Android의 논리 경로와 실제 저장 경로 사용을 일치시켰다.
- `src/app/component.nav.sidebar/view.ts`
  - 사이드바의 문서/폴더 삭제 동기화 결과를 더 이상 버리지 않고 전역 상태에 전달하도록 했다.
- `src/app/layout.sidebar/view.ts`
  - 개별 동기화 결과를 경로별로 병합해 해결된 충돌만 제거하도록 했다.
- `src/app/page.notes/view.ts`
  - 로컬 삭제 충돌 payload와 표시, 재시도/오류 결과 처리, 개별 저장 결과 전달을 보강했다.
- `src/app/page.notes/view.pug`
  - 삭제 충돌의 로컬 선택 액션을 “로컬 삭제 유지”로 표시했다.
- `src/app/page.settings/view.ts`
  - 삭제 충돌 사유와 로컬 삭제 상태를 보존·표시하도록 했다.
- `devlog.md`
- `devlog/2026-08-19/001-sync-convergence-delete-conflict-hardening.md`

## 검증 결과

- `npm run test:electron` 성공: 25개 테스트 통과.
- `node --check electron/main.cjs` 및 `git diff --check` 통과.
- `wiz_project_build(projectName=main, clean=false)` 성공.
- JDK 24 환경의 `./gradlew assembleDebug` 성공.
- JDK 24 환경의 `./gradlew lintDebug` 성공.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함한 빌드 산출물 루트 요청이 HTTP 200을 반환했다.
