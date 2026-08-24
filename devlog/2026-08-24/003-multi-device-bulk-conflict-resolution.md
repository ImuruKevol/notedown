# 다중 기기 기준선 보호 및 충돌 일괄 해결 UX

- **ID**: 003
- **날짜**: 2026-08-24
- **유형**: 버그 수정 및 UX 개선

## 작업 요약

여러 기기가 같은 동기화 계정을 사용할 때의 상태 전이를 다시 감사했다. 기기 B가 문서 X를 오프라인 편집한 뒤 다른 문서 Y만 먼저 저장하면, Y의 성공 응답에 포함된 전체 manifest가 X의 기준 revision과 hash까지 기기 A의 최신 값으로 덮어쓸 수 있었다. 이후 B가 X를 저장하면 이미 A의 revision을 안다고 제출해 실제 동시 편집을 충돌 없이 덮어쓸 위험이 있었다.

모든 manifest 체크포인트 전에 원격에서 바뀐 경로만 선별하고, 로컬 본문 hash와 기존 동기화 기준, 문서/첨부 metadata fingerprint 및 client timestamp를 대조하도록 변경했다. 로컬에서 편집된 경로는 전역 server revision이 전진하더라도 해당 파일의 원래 `lastKnownRevision`, content hash와 metadata 기준을 유지한다. 자기 기기에서 성공한 업로드는 실제 전송한 snapshot의 metadata fingerprint를 기록하므로, 전송 중 사용자가 다시 편집한 내용도 다음 동기화에서 로컬 변경으로 남는다.

서버 버전으로 충돌을 해결하는 중 다른 기기가 같은 문서를 다시 수정한 경우도 보강했다. 다운로드한 payload와 직후 cache-busting manifest의 revision/hash가 일치할 때만 해결 완료로 체크포인트한다. 값이 달라졌으면 새 서버 revision을 수락하지 않고 충돌을 유지한다. 서버에서 삭제된 문서를 서버 기준으로 선택할 때 파일 GET 404를 내던 경로는 manifest의 삭제 tombstone을 직접 적용하고 로컬 문서와 실제 첨부 파일을 함께 정리한다. 서버 버전을 로컬에 적용한 뒤 네트워크가 끊겨도 해당 파일 기준은 먼저 원자적으로 기록해 반복 충돌을 막는다.

충돌 화면에 개별 체크, 전체 선택/해제, 선택 개수와 `선택 항목 서버 기준 적용` / `선택 항목 로컬 기준 적용` 버튼을 추가했다. 일괄 해결은 저장소별 동기화 큐 안에서 최대 200개를 직렬 처리하고 마지막에 한 번만 수렴 동기화를 수행한다. 일부 항목이 다시 충돌해도 독립 항목은 계속 처리하지만, 오프라인이나 로컬 저장소 변경이 감지되면 남은 요청을 보내지 않는다. 성공한 항목만 목록에서 제거하고 실패·미시도·적용 중 서버가 다시 변경된 항목은 선택 상태로 남긴다.

## 원문 요청사항

```text
다시한번 말하지만 여러 기기에서 사용할 때에 대한 로직도 충분히 고려가 되어야 해.
그리고 충돌 시 지금은 문서 하나하니씩 반영을 해야 하는데, 문서 여러 개를 선택 후 한번에 서버 기준으로 반영한다던지 로컬 기준으로 반영한다던지 등 UX 개선도 필요해.
```

## 변경 파일 목록

- `electron/main.cjs`
  - manifest 체크포인트의 로컬 변경 보호, 전송 snapshot 기준 fingerprint, 서버 적용 중 재변경 탐지, 삭제 tombstone 해결, 일괄 해결 IPC와 부분 성공 결과를 구현했다.
- `electron/preload.cjs`
  - 충돌 일괄 해결 IPC 브리지를 노출했다.
- `electron/sync-state.cjs`
  - 문서/첨부 metadata fingerprint와 다중 기기 체크포인트 보호 판정을 추가했다.
- `electron/sync-state.test.cjs`
  - A/B 기기 동시 편집, metadata-only 편집, 전송 중 재편집, 전역 revision 전진과 파일 기준 보존 테스트를 추가했다.
- `electron/sync-conflict-batch.cjs`
  - 중복 제거, 최대 처리량, 직렬 부분 성공, 치명적 네트워크 중단과 서버 snapshot 검증을 분리했다.
- `electron/sync-conflict-batch.test.cjs`
  - 부분 성공, 오프라인 중단, 중복/상한, 적용 중 서버 재변경 테스트를 추가했다.
- `src/app/page.notes/view.ts`
  - 충돌 선택 상태, 일괄 해결 요청, 성공 항목 제거와 실패 항목 보존, 안정적인 경로별 충돌 중복 제거를 구현했다.
- `src/app/page.notes/view.pug`
  - 개별/전체 선택과 서버·로컬 기준 일괄 적용 UI를 추가했다.
- `devlog.md`
- `devlog/2026-08-24/003-multi-device-bulk-conflict-resolution.md`

## 검증 결과

- `npm run test:electron` 성공: 60개 테스트 통과.
- `node --check electron/main.cjs electron/preload.cjs electron/sync-state.cjs electron/sync-conflict-batch.cjs` 성공.
- `git diff --check` 성공.
- `wiz_project_build(projectName=main, clean=false)` 성공: `main.js` 4.27 MB, 전체 4.47 MB.
- Playwright 로컬 번들 검증 성공: 충돌 3건의 개별 체크, 전체 선택/해제, 서버/로컬 일괄 버튼을 확인했고 900×700 viewport에서도 레이아웃이 겹치지 않았다. 정적 검증 서버의 `/auth/check` 미지원 오류 외 앱 렌더 오류는 없었다.
- `npm run dist:win:nsis` 성공: 최신 Electron main/preload/renderer와 `sync-conflict-batch.cjs`가 Windows ASAR에 포함됐다.
- Windows 설치 파일 SHA-256: `32b2f3f02b735fcc6001d70d3d8119011a10c23c69708a713d79d35809a57dce`.
- 실제 사용자 문서와 동기화 서버 데이터는 변경하지 않았다.
