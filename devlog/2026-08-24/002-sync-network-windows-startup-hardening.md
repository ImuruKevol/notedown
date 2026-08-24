# 오프라인·저속 동기화 복구 및 Windows startup 보강

- **ID**: 002
- **날짜**: 2026-08-24
- **유형**: 버그 수정 및 안정성 보강

## 작업 요약

동기화 요청, 저장 시 업로드, 삭제 tombstone, manifest 체크포인트, 앱 재시작 뒤 재시도, 전체 동기화의 다운로드 경로를 다시 감사했다. 고정 60초 제한을 제어 요청과 데이터 전송 요청으로 분리하고, 본문·첨부 크기에 따라 16 KiB/s 저속 전송까지 고려하는 적응형 제한을 적용했다. 명백한 오프라인·DNS·연결 거부·타임아웃은 무의미하게 즉시 재시도하지 않으며, 로컬 변경이 보존됐음을 오류 메시지에 명시한다.

서버가 쓰기를 반영한 직후 응답만 유실되면 같은 요청을 다시 전송해 충돌을 만들 수 있었다. 쓰기 전에 본문 원본을 제외한 작은 확인 대기 저널을 `.notedown-sync.json`에 원자적으로 기록하고, 응답 오류 뒤에는 cache-busting manifest를 제한된 횟수로 조회해 content hash와 client timestamp/metadata로 반영 여부를 증명하도록 변경했다. 앱이 종료되거나 오프라인 상태가 이어져도 다음 저장 전에 저널을 먼저 확인하며, 서버 확인이 불가능한 동안에는 로컬 변경을 유지하고 중복 POST를 차단한다.

동기화 상태 파일의 손상·권한 오류와 문서/첨부 읽기 권한 오류를 파일 부재로 오인해 상태를 초기화하거나 삭제 계획으로 바꾸던 경로를 차단했다. 실제 `ENOENT`만 파일 부재로 처리한다. 삭제 의도는 unrelated manifest 체크포인트에서도 원래 확인한 revision/hash와 함께 유지되고, 다른 기기에서 해당 항목을 수정했거나 서버 revision이 재설정된 경우 자동 삭제 대신 충돌로 남는다. 서버가 삭제 tombstone을 반환했거나 같은 identity가 다시 활성화된 경우에만 삭제 의도를 정리한다.

Windows startup은 Electron 등록 시 설치 실행 파일 경로, hidden 인자, 이름과 enabled 값을 명시한다. readback은 정규화된 실행 경로/인자를 대조하고 Windows StartupApproved 비활성 상태를 레지스트리 등록 의도보다 우선한다. 로그인 startup의 hidden 실행이 `keepInBackgroundOnClose`에 잘못 종속되던 조건을 분리했다. 신규 NSIS 설치에서는 HKCU Run 값을 직접 기록하고 제거 시 정리한다.

## 원문 요청사항

```text
업데이트를 하면 할수록 계속 동기화, 충돌 관련해서 버그, 에러가 발생하는데, 확실하게 검수해줘.
저속도 네트워크나 오프라인 환경 등도 생각해야해.
그리고 윈도우에서는 현재 startup 관련 기능이 작동하지 않는데, 이 부분도 확인해야 하고.
```

## 변경 파일 목록

- `electron/main.cjs`
  - 적응형 요청 제한, 네트워크 오류 분류, 쓰기 결과 확인 저널 및 manifest polling, 안전한 파일 오류 처리, 삭제 의도 수명과 Windows startup 적용을 통합했다.
- `electron/sync-network.cjs`
  - 제어/전송 timeout, 오프라인·DNS·연결 오류 분류, 안전한 retry/probe 정책과 지연 반영 확인기를 추가했다.
- `electron/sync-network.test.cjs`
  - 저속 업로드·다운로드, 오프라인·타임아웃, 지연 commit과 오프라인 probe 중단 회귀 테스트를 추가했다.
- `electron/sync-state.cjs`
  - 삭제 의도 체크포인트 보존과 정확한 업로드 acknowledgment, 확인된 mutation 저널 정리를 추가했다.
- `electron/sync-state.test.cjs`
  - 동일 본문 metadata 변경, timestamp 증명, mutation 저널, 삭제 tombstone 수명 테스트를 추가했다.
- `electron/startup-settings.cjs`
  - Windows startup 등록/readback과 hidden login 판정을 테스트 가능한 순수 로직으로 분리했다.
- `electron/startup-settings.test.cjs`
  - 경로·인자 정규화, StartupApproved 비활성, hidden startup 설정 독립성 테스트를 추가했다.
- `build-resources/installer.nsh`
  - 신규 설치 시 HKCU Run 등록 및 제거 시 레지스트리 정리를 추가했다.
- `devlog.md`
- `devlog/2026-08-24/002-sync-network-windows-startup-hardening.md`

## 검증 결과

- `npm run test:electron` 성공: 52개 테스트 통과.
- `node --check electron/main.cjs electron/sync-state.cjs electron/sync-network.cjs electron/startup-settings.cjs` 성공.
- `git diff --check` 성공.
- `wiz_project_build(projectName=main, clean=false)` 성공: `main.js` 4.25 MB, 전체 4.46 MB.
- `npm run dist:win:nsis` 성공: `dist/Notedown-0.2.5-win-x64.exe` 생성.
- Windows 설치 파일 SHA-256: `da6f96b1f0bf9b6bad2e4949d54c984fcaaf6041d88217ab203da5dc5bf7974f`.
- Windows unpacked ASAR에서 `electron/main.cjs`, `sync-network.cjs`, `sync-state.cjs`, `startup-settings.cjs` 포함을 확인했다.
- 실제 사용자 문서와 동기화 서버 데이터는 변경하지 않았다.
