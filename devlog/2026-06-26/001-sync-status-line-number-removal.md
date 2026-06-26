# 저장 동기화 상태 표시 및 라인 넘버 기능 제거

- **ID**: 001
- **날짜**: 2026-06-26
- **유형**: 버그 수정

## 작업 요약
Electron/Android 공통 노트 화면에서 라인 넘버 토글 버튼과 프리뷰 라인 번호 표시 기능을 제거했다.
사이드바 하단의 상시 "동기화 대기" 표시를 숨기고, Cmd/Ctrl+S 저장 후 단일 노트 동기화 결과를 같은 위치에 잠깐 표시했다가 자동으로 사라지도록 변경했다.

## 원문 요청사항
```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

작업 시작

## 리뷰 요약

- 리뷰 ID: utbvntdvrmlxnndemmtuptwpjhbzzlkf
- 제목: electron app, android app 수정

## 리뷰어 요청 내용

아래 내용들을 반영해야 함. electron app 기준으로 작성하였으니, android app은 알아서 잘 적용할 것.

- 왼쪽 하단에 "동기화 대기"가 계속 떠있는데, 이건 제거할 것.
- 라인 넘버 보이는 토글 버튼 및 기능 삭제
- cmd+s로 저장 시 동기화 서버가 지정되어 있으면 동기화 서버에 단일 동기화 요청을 날리는데, 이 요청에 대한 결과를 현재 "동기화 대기"가 표시되고 있는 부분에 잠깐 띄웠다가 잠시 후 사라지도록 하는 식으로 보여줄 것.
```

## 변경 파일 목록
- `src/app/page.notes/view.pug`: 라인 넘버 토글 버튼과 프리뷰 라인 번호 DOM 제거.
- `src/app/page.notes/view.ts`: 라인 넘버 토글 상태/메서드 제거, Monaco 라인 번호 고정 비활성화, 저장 동기화 상태 이벤트 발행 추가.
- `src/app/component.nav.sidebar/view.pug`: 하단 동기화 상태 영역을 상태가 있을 때만 표시하도록 변경.
- `src/app/component.nav.sidebar/view.ts`: 상시 대기 상태 제거, 저장 동기화 상태 이벤트 수신 및 자동 숨김 처리 추가.
- `src/angular/styles/styles.scss`: 미사용 프리뷰 라인 번호 스타일 제거.
- `devlog.md`, `devlog/2026-06-26/001-sync-status-line-number-removal.md`: 작업 이력 기록.

## 검증 결과
- `rg`로 "동기화 대기", 라인 넘버 토글/표시 관련 참조가 남아 있지 않음을 확인했다.
- `wiz_project_build(clean=false)` 성공.
- `npm run android:sync` 성공.
- `npm run android:build:debug` 성공.
- 브라우저 런타임 검증은 현재 프론트 dev 서버가 실행 중이지 않았고 브라우저 도구 연결이 환경 메타데이터 오류로 실패해 수행하지 못했다.
