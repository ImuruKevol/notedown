# 첫 동기화 metadata 가상 충돌 및 디렉토리 읽기 오류 수정

- **ID**: 001
- **날짜**: 2026-07-16
- **유형**: 버그 수정

## 작업 요약

서버가 메타데이터 버전 차이를 실제 파일이 아닌 `metadata` 가상 경로의 충돌로 반환하고, 클라이언트가 이를 일반 파일로 읽어 `ENOENT` 또는 `EISDIR` 오류를 표시하던 원인을 수정했다. 첫 동기화에서 로컬 노트가 없으면 서버 문서를 정상 다운로드하고, 동일 경로의 로컬 문서가 이미 있으면 실제 파일 충돌로 전환해 덮어쓰기를 방지한다. 같은 서버 응답을 사용하는 Android 브리지에도 동일한 호환 방어를 적용했다.

## 원문 요청사항

```text
윈도우에 설치는 정상적으로 되었는데 동기화를 하려고 하니까 이런 첨부한 스크린샷과 같이 에러가 뜨고 있어.
동기화를 시도하기 전에 먼저 "metadata 생성/갱신" 버튼을 눌러서 그런지, 상태 새로고침 버튼을 눌러서 그런지, 뭐가 문제인지 모르겠어. 첨부한 스크린샷과 같이 뜨기 전에는 metadata 디렉토리가 없다는 텍스트가 떠서 저장소 위치에다가 metadata 디렉토리도 내가 수동으로 만들었어.
제발 문제를 확실하게 파악하고 고쳐줘
```

## 변경 파일 목록

- `/Users/ktw/Documents/notedown-server/sync_store.py`
  - 전역 메타데이터 차이를 `metadata` 가상 파일 충돌로 추가하던 처리를 제거했다.
  - 동기화 이력이 없는 상태에서 서버와 로컬에 같은 문서/첨부 경로가 있으면 실제 파일 충돌로 반환하도록 보강했다.
- `/Users/ktw/Documents/notedown-server/tests/test_sync_api.py`
  - 빈 초기 저장소의 서버 다운로드와 동일 경로 파일의 충돌 전환 회귀 테스트를 추가했다.
- `electron/main.cjs`
  - 구버전 서버의 가상 `metadata` 충돌은 로컬 노트가 없는 초기 저장소에서만 제외하도록 호환 처리를 추가했다.
- `src/angular/app/notedown-android-bridge.ts`
  - Android 동기화에도 Electron과 같은 초기 저장소 가상 충돌 필터를 적용했다.
- `src/app/page.settings/view.ts`
- `src/app/page.notes/view.ts`
  - 실제 동일 경로 첫 동기화 충돌 사유를 사용자 문구로 표시하도록 추가했다.
- `devlog.md`
- `devlog/2026-07-16/001-initial-sync-metadata-conflict-fix.md`

## 검증 결과

- 첨부 화면 확인: `metadata` 가상 경로를 파일로 읽어 수동 생성 전에는 `ENOENT`, 생성 후에는 `EISDIR: illegal operation on a directory, read`가 발생하는 흐름 확인.
- `python -m unittest discover -s tests`: 38개 테스트 통과.
- 신규 첫 동기화 회귀 테스트 2개 통과.
- `node --check electron/main.cjs`: 통과.
- `wiz_project_build(clean=false, projectName="main")`: 성공.
- `npm run android:build:debug`: 성공.
- `npx electron-builder --win nsis --x64 --publish never`: 성공.
- Windows 패키지의 `app.asar` 및 Android APK 자산에 수정 코드 포함 여부 확인.
- 관련 파일 `git diff --check`: 통과.
