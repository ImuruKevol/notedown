# Android 동기화·첨부·PDF 브리지 확장

## 요청

- 리뷰 ID: `xxvinnsvhifwqghifludssinzxljtknm`
- 원문 요청: "이어서 진행해줘. 남은 리스크들을 해소하고 electron app과 동일한 레벨로 안드로이드에서도 사용할 수 있도록."

## 변경 파일

- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`: Android 첨부 파일 선택, 파일 해시/바이너리 읽기, 파일 쓰기/삭제, `.notedown-sync.json` 읽기/쓰기, PDF 저장, 디렉터리 선택 콜백 추가
- `src/angular/app/notedown-android-bridge.ts`: Android `window.notedown`에 `storage.chooseAttachments`, `sync.plan`, `sync.runFull`, `sync.uploadNote`, `sync.readFile`, `sync.resolveConflict`, `pdf.saveNote` 구현
- `README.md`: Android 지원 범위 갱신
- `docs/android-environment.md`: Android 브리지 지원 범위와 scoped storage 한계 갱신
- `devlog.md`, `devlog/2026-06-17/004-android-sync-attachment-pdf-bridge.md`: 작업 로그 추가

## 확인

- `wiz_project_build`: 성공
- `cd android && ./gradlew compileDebugJavaWithJavac --no-daemon`: 성공
- `npm run android:build:debug`: 성공
- `cd android && ./gradlew testDebugUnitTest --no-daemon`: 성공
- `npx cap doctor android`: 성공
- 에뮬레이터에 APK 설치 및 `com.notedown.app/.MainActivity` 실행 성공
- WebView DevTools 프로토콜에서 Android `window.notedown`의 `storage.chooseAttachments`, `sync.plan/runFull/uploadNote/readFile/resolveConflict`, `pdf.saveNote` 노출 확인
- 에뮬레이터에서 Android 브리지로 노트 저장, 첨부 저장, 첨부 파일 해시 읽기, `.notedown-sync.json` 쓰기/읽기 성공
- 에뮬레이터 파일 시스템에서 Markdown 파일, 첨부 파일, `metadata.json`, `.notedown-sync.json` 생성 확인
- Android 스크린샷에서 Notedown 화면 렌더링 확인

## 참고

- Android는 Electron처럼 임의 로컬 폴더를 경로 문자열로 직접 다루기 어렵다. 현재 디렉터리 선택은 SAF URI를 확보하지만 실제 노트 저장은 앱 전용 Documents 경로를 유지한다.
- 데스크톱 tray/status-bar 동작은 Android 앱 생명주기와 맞지 않아 API 호환만 유지한다.
