# 저속 네트워크 동기화 및 노트 저장 무결성 오류 수정

- **ID**: 002
- **날짜**: 2026-07-21
- **유형**: 버그 수정
- **리뷰 ID**: iqrklwzdbyyqkinhodmzryatwjmnvlhb

## 작업 요약

저속 네트워크에서 노트 전환·생성·자동 저장·시작 동기화가 겹칠 때 이전 노트 본문이나 오래된 메타데이터가 새 노트에 적용될 수 있던 경합을 수정했다.
노트와 첨부의 ID·논리 경로·실제 저장 경로를 서버, Electron, Android에서 동일하게 검증하고, 삭제는 명시적 ID로만 처리하도록 저장 계약을 통일했다.
실제 사용자 저장소는 읽기 전용으로 점검했으며 데이터 손실 가능성 때문에 suffix 파일이나 고아 파일을 자동 삭제하지 않았다.

## 원문 요청사항

```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

작업 시작

## 리뷰 요약

- 리뷰 ID: iqrklwzdbyyqkinhodmzryatwjmnvlhb
- 제목: 동기화 및 저속 네트워크 환경 관련 오류
- 요청 링크: http://172.16.0.143:5500
- Codex 요청자: 권태욱
- 프로젝트 루트: /Users/ktw/Documents/notedown-server
- Codex 세션 ID: 신규
- Codex 모델: 5.6 sol (gpt-5.6-sol)
- Codex 추론수준: ultra (ultra)
- 스크린샷 컨텍스트: 없음
- 에이전트 작업 지시서 컨텍스트: 포함됨
- HTML 문서 생성 규칙 컨텍스트: 없음
- HTML 문서 설정 컨텍스트: 없음
- HTML 프로젝트 인스트럭션 파일: 없음
- 첨부파일 컨텍스트: 0개

## 에이전트 작업 지시서

# 에이전트 작업 지시서

## 리뷰 정보

- 리뷰 ID: iqrklwzdbyyqkinhodmzryatwjmnvlhb
- 제목: 동기화 및 저속 네트워크 환경 관련 오류
- 상태: open
- 우선순위: normal
- 분류: ux
- 프로젝트: Notedown Server
- 프로젝트 종류: web_service
- 요청 링크: http://172.16.0.143:5500
- 화면: 1440x900
- 캡처 방식: capture-unavailable-cross-origin
- 스크린샷 첨부: no
- 리뷰 첨부 파일: 0개

## 리뷰어 요청 내용

USB 테더링으로 윈도우 노트북에서 Electron app으로 노트를 쓰고 있었는데, 좀 오류가 많아.
- 노트 작성 후 새 노트 생성한 다음 새 노트를 작성하는데 이전 노트 내용이 덮어씌워지는 버그 발생
  - 노트 ID값이 꼬였는지 충돌이 발생했다고 뜸.
  - 실제 저장소 디렉토리를 보니 노트 이름에 -2, -3, -4, -5 이런 식으로 뭔가 이상하게 오류가 난듯한 느낌으로 저장이 되어있는 것을 확인할 수 있었음.

이와 관련된 부분들을 싹 분석하여 확인 후 버그가 일어날만한 곳들을 전부 수정해줘.

## 첨부 파일

-

## 콘솔 로그 요약

-

## 네트워크 로그 요약

-

## 환경 로그 요약

- browser-fingerprint: MacIntel / ko-KR / 2560x1440
- iframe-fingerprint: restricted / http://172.16.0.143:5500
- iframe-fingerprint: restricted / http://172.16.0.143:5500
- browser-fingerprint: MacIntel / ko-KR / 2560x1440
- iframe-fingerprint: restricted / http://172.16.0.143:5500
- reviewops-sdk: SDK missing
- browser-fingerprint: MacIntel / ko-KR / 2560x1440
- iframe-fingerprint: restricted / http://172.16.0.143:5500
```

## 원인 분석

- 페이지와 사이드바가 서로 다른 전체 노트 스냅샷을 저장하고, Monaco의 늦은 change listener가 노트 전환 뒤 새 active note에 이전 model 본문을 적용할 수 있었다.
- 시간값 기반 노트 ID와 누락된 `storagePath`가 충돌 시 새 suffix 경로를 계속 할당하게 만들었다.
- 느린 시작 동기화와 충돌 해결 응답이 도착했을 때 그 사이 발생한 로컬 저장을 재검증하지 않아 최신 편집·삭제를 덮을 수 있었다.
- 노트/첨부 누락을 암묵 삭제로 해석하고 ID 또는 경로 중 하나만 같아도 기존 메타데이터를 교체하는 경로가 있었다.
- 서버 batch 처리 전에 전체 ID·경로·첨부 소유권을 검증하지 않아 후반 충돌 시 부분 적용 가능성이 있었다.

## 변경 파일 목록

### Notedown Server

- `/Users/ktw/Documents/notedown-server/sync_store.py`
  - 저장소 프로세스 잠금, batch 사전 검증, 원자적 파일 쓰기, stale revision 및 exact retry 검증을 추가했다.
  - 노트·첨부 ID/논리 경로/실제 경로/부모 노트 소유권의 재할당과 중복을 거부한다.
  - 같은 내용의 이름 변경과 metadata-only 변경에서도 canonical storage path와 revision을 일관되게 갱신한다.
  - 활성 파일·첨부의 암묵 메타데이터 제거를 막고 revision이 일치하는 명시 삭제만 허용한다.
- `/Users/ktw/Documents/notedown-server/tests/test_sync_api.py`
  - batch 부분 쓰기, ID/경로 충돌, same-hash rename, stale retry, 첨부 소유권·삭제·canonical path, 원자 쓰기 회귀 테스트를 추가했다.
- `/Users/ktw/Documents/notedown-server/openapi_spec.py`
  - ID와 경로 재할당을 허용하지 않는 실제 upsert 계약을 문서화했다.

### Notedown WIZ/Electron/Android

- `electron/main.cjs`
  - 저장·동기화 keyed queue, 저장 세대 검증, 60초 timeout과 안전 재시도, 원자적 sync state 쓰기를 추가했다.
  - 네트워크 밖에서 일관된 업로드 snapshot을 만들고 응답 적용 전에 저장 세대를 다시 확인한다.
  - 느린 full sync·충돌 해결·단건 업로드가 최신 로컬 변경을 덮거나 stale server 삭제를 수행하지 않도록 했다.
- `electron/keyed-queue.cjs`
  - 저장소별 작업 직렬화 helper를 추가했다.
- `electron/storage-identity.cjs`
  - canonical 노트·첨부 identity 병합과 중복/소유권/명시 삭제 사전 검증을 추가했다.
- `electron/storage-runtime.test.cjs`
  - queue 순서와 note/attachment identity·삭제·stale snapshot 회귀 테스트 15개를 추가했다.
- `src/angular/app/notedown-android-bridge.ts`
  - Android 저장·동기화 queue, 저장 세대 drain/capture, coherent upload snapshot, guarded local apply를 Electron과 동일한 계약으로 구현했다.
  - 누락 첨부 보존, 명시 삭제 ID, 안정적인 첨부 ID, 저속 네트워크 timeout/retry를 적용했다.
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
  - 파일 작업 잠금, 전체 identity preflight, canonical attachment path 재사용, UUID 첨부 ID, 명시 삭제 계약을 추가했다.
  - 개별 파일을 temp+fsync+원자 교체로 저장하고 Android API 24/25 호환 경로를 제공한다.
- `src/app/page.notes/view.ts`
  - UUID 노트 생성, 페이지 단일 생성 소유권, note-ID/epoch 기반 Monaco binding, 저장 promise queue를 적용했다.
  - 시작 동기화·reload generation guard, canonical 저장 결과 병합, 삭제 노트 부활 방지, 명시 첨부 삭제를 구현했다.
- `src/app/page.notes/view.pug`
  - Monaco auto-format 지연을 비활성화하고 첨부 명시 삭제 UI를 연결했다.
- `src/app/component.nav.sidebar/view.ts`
  - 새 노트 생성 command 단일화, 즉시 로컬 삭제/선택 전환, 삭제 ID 전달, pending 편집 overlay를 적용했다.
- `devlog.md`
- `devlog/2026-07-21/002-sync-slow-network-integrity-fix.md`

## 검증 결과

- Server 전체 unittest 49개 통과.
- Server `py_compile` 및 `git diff --check` 통과.
- Electron `node --check` 통과.
- Electron storage runtime 회귀 테스트 15/15 통과.
- WIZ normal build 성공: `wiz_project_build(projectName="main", clean=false)`.
- Android `compileDebugJavaWithJavac --rerun-tasks` 성공.
- Android `lintDebug --rerun-tasks` 성공. 기존 Gradle flatDir/deprecated API 안내 외 신규 실패 없음.
- WIZ 프로젝트 `git diff --check` 통과.
- 실제 저장소를 읽기 전용 점검해 Markdown 29개와 metadata note 26개 사이의 불일치를 확인했다.
  - metadata에 없는 동일 내용 suffix 파일: `피드백 memo-2.md`, `피드백 memo-3.md`, `새 노트-4.md`.
  - sync state에는 남았지만 metadata와 로컬 파일에 없는 경로: `memo/note-1784305817619.md`, `새-폴더-3/note-1784521591035.md`.
  - 물리 첨부 2개가 metadata/sync attachment 목록에 없는 상태를 확인했다.
- SQLite integrity check는 `ok`였고 중복 note/attachment ID는 없었다. 저장소 파일은 수정하거나 삭제하지 않았다.
- 요청 링크 `http://172.16.0.143:5500`은 최종 확인 시 연결되지 않았다.

## 남은 리스크

- 실제 Windows Electron + USB 테더링 환경에서 장시간 패킷 지연·중단·재접속 E2E는 수행하지 못했다.
- 기존 suffix·고아 파일은 자동 삭제하지 않았다. Windows 쪽에만 최신 원본이 있을 수 있으므로 전체 백업 후 내용과 revision을 수동 대조해야 한다.
- Android 개별 파일은 원자적으로 저장하지만 여러 노트 파일·SQLite metadata·orphan 삭제 전체는 하나의 전역 트랜잭션이 아니다. 저장 중 프로세스 강제 종료나 디스크 오류에서는 mixed snapshot 가능성이 남는다.
