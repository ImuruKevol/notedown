# Android readable storage folder names

## 원 요청

Android도 동일하게 바꿔줘.
그리고 폴더 이름들이 "새-폴더-5" 이런 식으로 남아있는데, 폴더 이름도 실제 앱에 보이는 폴더 이름대로 수정해줘.

## 변경 파일

- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`
- `src/angular/app/notedown-android-bridge.ts`
- `devlog.md`
- `devlog/2026-06-29/005-android-readable-storage-folder-names.md`

## 작업 내용

- Android 네이티브 저장소를 `metadata.db` 기준으로 읽고 쓰도록 전환하고, 노트/첨부 파일의 논리 경로와 실제 저장 경로를 `storagePath`로 분리했다.
- Android 동기화 브리지에서 서버와 주고받는 노트/첨부 메타데이터의 `storagePath`를 보존하도록 보강했다.
- `/Users/ktw/Documents/Notedown Notes`와 서버 저장소의 실제 폴더, `metadata.db`, 동기화 상태 파일을 앱에 보이는 폴더명 기준으로 정리했다.
- `새-폴더`, `새-폴더-2`, `새-폴더-3`, `새-폴더-4`, `새-폴더-5`를 각각 `secret`, `사이언스온`, `keycloud`, `Docker Infra`, `시즌`으로 정규화했다.

## 검증

- `./gradlew :app:compileDebugJavaWithJavac`
- WIZ `main` 프로젝트 빌드 성공
- `./gradlew assembleDebug`
- `/Users/ktw/Documents/Notedown Notes`에서 `metadata.json` 삭제 및 `metadata.db` 존재 확인
- 로컬/서버 `metadata.db`, 서버 `state.json`, 로컬 `.notedown-sync.json`에서 `새-폴더*` 잔존 카운트 0 확인
