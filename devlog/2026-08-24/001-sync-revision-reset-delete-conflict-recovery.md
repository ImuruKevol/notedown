# 서버 리비전 역전 복구 및 오인 삭제·반복 충돌 방지

- **ID**: 001
- **날짜**: 2026-08-24
- **유형**: 버그 수정

## 작업 요약

실제 Electron 저장소와 인증된 동기화 서버 manifest를 읽기 전용으로 대조했다. 로컬 동기화 상태의 서버 revision은 `937`인데 현재 서버 revision은 `146`이어서, 0.2.5의 stale-manifest 보호가 서버 복원·교체 후의 정상적인 revision 역전까지 영구 차단하고 있었다. 그 결과 이전 상태에만 남은 41개 과거 경로가 로컬 파일 누락으로 해석되고, 저장할 때마다 오래된 기준 revision으로 충돌이 반복됐다.

서버 revision 역전을 cache-busting manifest 두 번으로 확인한 뒤 문서 identity를 논리 경로, 안정 ID, 기기별 실제 저장 경로, 고유 콘텐츠 해시 순서로 일대일 재매핑하도록 복구 절차를 추가했다. 같은 실제 파일을 소유한 중복 메타데이터는 서버·동기화 상태에 근거해 canonical identity 하나로 합치며, 구 UI가 가진 이전 ID는 로컬 별칭으로 보존한다.

파일이 보이지 않는다는 이유만으로 삭제 tombstone을 추론하던 로직을 제거했다. 사용자가 실제 삭제한 순간에만 `pendingDelete`를 기록하고, 서버 삭제 계획과 직접 삭제 업로드 모두 이 명시적 삭제 저널과 유효한 `lastKnownRevision`이 있어야 실행된다. 재기준화 직후 구 ID로 삭제해도 별칭과 실제 저장 경로를 통해 canonical 서버 항목을 찾도록 보강했다.

재기준화 과정에서 로컬과 서버 콘텐츠 해시가 다른 항목은 현재 서버 revision을 이미 확인한 것으로 취급하지 않는다. 해당 항목은 보존되는 `rebaseConflict` 상태와 revision `0`으로 계획 API에 전달되어 실제 충돌로 분리되고, 다른 문서를 저장하거나 manifest를 체크포인트해도 사라지지 않는다. 사용자가 서버 또는 로컬 버전으로 충돌을 해결한 뒤에만 이 보호 상태를 해제한다.

## 원문 요청사항

```text
지금 뭔가 이상해. 문서들이 전부 로컬에서 삭제된 항목이라 뜨고, 뭔가 저장을 할때마다 여전히 충돌되었따고 뜨고 있어.
```

## 변경 파일 목록

- `electron/main.cjs`
  - 서버 revision 역전 확인·identity 재기준화, 명시적 삭제 저널, 안전한 삭제 필터, 구 identity 별칭 처리, 복구 충돌 체크포인트 수명을 적용했다.
- `electron/sync-rebase.cjs`
  - revision 역전 판정, 일대일 identity 매칭, 메타데이터/상태 재기준화, 중복 실제 파일 소유자 통합, pending-delete 재탐색을 분리했다.
- `electron/sync-rebase.test.cjs`
  - 재기준화 우선순위, 모호한 해시 차단, 구 ID 삭제, 콘텐츠 불일치 보호, 중복 소유자 복구 회귀 테스트를 추가했다.
- `electron/sync-state.cjs`
  - 확인된 revision reset 허용, 기기별 `storagePath` 보존, 명시적 삭제 판정, 복구 충돌의 지속·해제 규칙을 추가했다.
- `electron/sync-state.test.cjs`
  - revision reset, cross-device 경로, pending tombstone, 복구 충돌 체크포인트 테스트를 추가했다.
- `electron/storage-identity.cjs`
  - canonical ID와 이전 UI ID 별칭을 함께 인덱싱하고 실제 저장 경로를 보존하도록 보강했다.
- `electron/storage-runtime.test.cjs`
  - 재기준화 후 구 UI 문서·첨부 ID 저장 회귀 테스트를 추가했다.
- `devlog.md`
- `devlog/2026-08-24/001-sync-revision-reset-delete-conflict-recovery.md`

## 실제 상태 검증

- 실제 문서 저장소의 파일이나 서버 데이터를 변경하지 않고 스냅샷과 read-only 계획 API만 사용했다.
- 로컬 revision `937`, 서버 revision `146`의 역전을 확인했다.
- 메타데이터 62개 중 같은 실제 Markdown 파일을 소유한 중복 1개를 안전하게 식별했으며 실제 물리 파일 누락은 0개였다.
- 재기준화 예상 결과는 로컬 고유 문서 61개, 서버 identity 안전 매칭 54개, 로컬 신규/미매칭 7개였다.
- 콘텐츠가 실제로 다른 2개 문서는 충돌로 유지됐다. 보수적 계획 결과는 파일 업로드 59개, 다운로드 2개, 충돌 2개이며 서버/로컬 파일 및 첨부 삭제는 모두 0개였다.

## 검증 결과

- `npm run test:electron` 성공: 41개 테스트 통과.
- `node --check electron/main.cjs electron/sync-rebase.cjs electron/storage-identity.cjs electron/sync-state.cjs` 성공.
- `git diff --check` 성공.
- `wiz_project_build(projectName=main, clean=false)` 성공: `main.js` 4.25 MB, 전체 4.46 MB.
