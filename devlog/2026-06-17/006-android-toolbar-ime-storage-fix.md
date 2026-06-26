# Android 툴바 아이콘화, 한글 입력, 기본 저장소 첨부 경로 보강

## 요청

- 리뷰 ID: `xxvinnsvhifwqghifludssinzxljtknm`
- 원문 요청: "툴바
- B, I는 삭제
- H1은 선택하면 H1~H4 중에 선택할 수 있는 목록이 나오도록 할 것
- \"- [ ]\"는 이대로 표시하지 말고 체크박스 아이콘으로 보이도록 해서 가시성을 높일 것.
\t- \"-\", \">\", \"Code\", \"Link\"도 마찬가지로 아이콘으로 변경할 것.

editor
- 한글 입력이 제대로 동작하지 않음. 한글을 입력하면 스페이스바를 눌러 단어를 분리하기 전까지는 단어 자체가 파란색 박스 안에 표시되면서 첫 번째 글자가 보이지 않는 버그가 있음.

파일 첨부
- 저장소 경로를 커스텀할 수 있는 기능을 없애라고 했지 저장소 자체를 없애라고는 안했음. 저장소 경로를 안드로이드 자체에서 제공하는 기본 경로로 고정시키고 파일, 이미지 첨부 기능을 동작시키도록 할 것."

## 변경 파일

- `src/app/page.notes/view.ts`: Android 툴바 액션에서 B/I 제거, H1~H4 메뉴 추가, Android editor를 native textarea로 전환, textarea selection 기반 툴바 삽입 처리, Android 저장소 fallback 경로 보강
- `src/app/page.notes/view.pug`: 툴바 버튼을 아이콘 중심으로 변경, H1 메뉴 UI 추가, Android textarea 렌더링 추가
- `src/app/page.settings/view.ts`: Android에서 native 기본 저장소 경로를 항상 설정하도록 보강
- `src/angular/app/notedown-android-bridge.ts`: Android 디렉터리 선택 API를 기본 경로 반환으로 고정
- `android/app/src/main/java/com/notedown/app/NotedownNativePlugin.java`: Android 저장소 루트를 앱 기본 Documents 경로로 강제하고 디렉터리 선택 호출도 기본 경로만 반환하도록 변경
- `devlog.md`, `devlog/2026-06-17/006-android-toolbar-ime-storage-fix.md`: 작업 로그 추가

## 확인

- `wiz_project_build`: 성공
- `npm run android:build:debug`: 성공
- 무선 디버깅 기기 `SM_F966N`에 새 `app-debug.apk` 설치 성공
- `com.notedown.app` 실행 성공, PID 확인
- Android WebView DOM 확인: main editor가 `textarea`로 렌더링되고 Monaco main editor는 사용하지 않음
- Android WebView DOM 확인: 툴바 표시, B/I 미표시, H1 메뉴가 `H1`, `H2`, `H3`, `H4`로 표시
- Android WebView DOM 확인: 툴바 아이콘 SVG 6개 표시, 첨부 선택/저장 API 노출
- Android WebView DOM 확인: 임의 storagePath로 `info()`를 호출해도 native 기본 저장소 경로로 고정됨
- 최근 logcat에서 Notedown 관련 fatal/crash 로그 없음

## 참고

- Android 한글 IME 조합 문제는 Monaco mobile 입력 처리 대신 native textarea를 쓰는 방식으로 회피했다.
- 실제 파일/이미지 picker에서 사용자가 파일을 선택하는 상호작용은 자동화하지 않았고, 네이티브 첨부 API 노출 및 기본 저장소 고정까지 확인했다.
