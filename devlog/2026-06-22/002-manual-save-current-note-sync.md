# 자동 저장 제거 및 수동 저장 시 현재 노트 동기화 적용

- **ID**: 002
- **날짜**: 2026-06-22
- **유형**: 기능 변경

## 작업 요약
자동 저장과 자동 업로드 설정 경로를 제거하고, 명시적인 저장 액션에서만 로컬 저장을 수행하도록 변경했다.
Electron에서는 Cmd/Ctrl+S 저장 시 현재 노트만 서버 업로드 API로 동기화하고, Android에서는 우측 하단 저장 FAB를 추가해 동일한 저장/동기화 경로를 사용하도록 했다.

## 원문 요청사항
```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

작업 시작

## 리뷰 요약

- 리뷰 ID: kddcrnpdryorhqvzawmsbvseodyovogt
- 제목: electron app, android app 수정
- 요청 링크: http://172.16.0.143:5500
- Codex 요청자: 권태욱
- 프로젝트 루트: /Users/ktw/Documents/notedown-server
- Codex 세션 ID: 신규
- 스크린샷 컨텍스트: 없음
- 에이전트 작업 지시서 컨텍스트: 포함됨
- HTML 문서 생성 규칙 컨텍스트: 없음
- HTML 문서 설정 컨텍스트: 없음
- HTML 프로젝트 인스트럭션 파일: 없음
- 첨부파일 컨텍스트: 0개

## 에이전트 작업 지시서

# 에이전트 작업 지시서

## 리뷰 정보

- 리뷰 ID: kddcrnpdryorhqvzawmsbvseodyovogt
- 제목: electron app, android app 수정
- 상태: open
- 우선순위: high
- 분류: design
- 프로젝트: Notedown Server
- 프로젝트 종류: web_service
- 요청 링크: http://172.16.0.143:5500
- 화면: 1440x900
- 캡처 방식: browser-display-capture-element
- 스크린샷 첨부: no
- 리뷰 첨부 파일: 0개

## 리뷰어 요청 내용

- 현재 자동 저장 기능이 지원되는데, 제거할 것.
- electron app에서는 cmd(ctrl) + s를 눌러야 저장이 되도록 하고, 저장 시 해당 파일만 서버에 동기화를 시켜야 함
- android app에서는 우측 하단에 플로팅 버튼으로 저장 기능을 추가할 것. 여기도 동일하게 저장을 하면 해당 파일을 서버에 동기화를 시키도록 할 것.

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

## 변경 파일 목록
- `src/app/page.notes/view.ts`: 자동 저장 타이머/자동 업로드 스케줄을 제거하고, `saveNow()`가 로컬 저장 후 현재 노트만 서버 업로드하도록 변경. 저장 중 상태와 unsaved 보존 처리를 추가.
- `src/app/page.notes/view.pug`: Android 우측 하단 저장 FAB 추가, 기존 Android preview toggle은 위로 배치.
- `src/app/page.settings/view.ts`: `autoSave`, `syncAutoUpload` 설정 필드 제거.
- `src/app/page.settings/view.pug`: 자동 저장 및 저장 시 업로드 토글 UI 제거.
- `src/app/layout.sidebar/view.ts`: 명령 팔레트의 자동 저장 토글 제거 및 설정 모델 정리.
- `src/app/component.nav.sidebar/view.ts`: 명시적 노트 생성/삭제 동기화가 `syncAutoUpload` 토글에 의존하지 않도록 정리.
- `devlog.md`, `devlog/2026-06-22/002-manual-save-current-note-sync.md`: 작업 이력 추가.

## 검증 결과
- `wiz_project_build(clean=false)` 성공.
- `npm run android:build:debug` 성공.
- `rg`로 `autoSave`, `syncAutoUpload`, 자동 저장 스케줄 참조가 앱 소스에서 제거된 것을 확인.
- 로컬 정적 서버 `http://127.0.0.1:4173/` HEAD 200 확인.
- 빌드 산출물 `build/dist/build/main.js`에서 `data-android-save-note`, `showAndroidSaveButton`, `notedown-save-note` 포함 확인.

## 남은 리스크
- in-app Browser 플러그인 연결이 `sandboxCwd must be an absolute file URI` 오류로 실패해 실제 브라우저 클릭 검증은 수행하지 못했다.
- 실제 Electron/Android 런타임에서 서버 토큰이 설정된 상태의 수동 저장 업로드는 실기기/앱 실행 환경에서 추가 확인이 필요하다.
