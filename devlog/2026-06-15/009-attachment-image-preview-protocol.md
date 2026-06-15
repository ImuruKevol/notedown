# Electron 첨부 이미지 미리보기 로딩 복구 및 실제 앱 검증

- 날짜: 2026-06-15
- 번호: 009

## 사용자 요청

파일 및 이미지 문법 및 기능을 개발을 한다고 했는데 아예 동작하지 않아. 기능을 개발하고 electron app 기준으로 실제 확인을 해줘. devlog(2026-06-15/008-note-attachments-sync.md)를 참고하면 돼.

## 변경 파일

- `electron/main.cjs`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-06-15/009-attachment-image-preview-protocol.md`

## 변경 내용

- Electron의 `notedown://app` 페이지에서 `file://` 첨부 이미지가 `Not allowed to load local resource`로 차단되는 문제를 확인했다.
- `notedown-attachment://` 전용 프로토콜을 추가해 등록된 노트 저장소 내부의 `.attachments` 파일만 응답하도록 했다.
- 노트 로드/저장/첨부/동기화 IPC가 사용한 저장소 루트만 첨부 프로토콜에서 허용하도록 제한했다.
- Preview 이미지 `src` 변환을 `file://` 대신 `notedown-attachment://file?...`로 변경했다.

## 확인 결과

- `node --check electron/main.cjs`: 통과
- `node --check electron/preload.cjs`: 통과
- `wiz_project_build(clean=false, projectName=main)`: 성공
- Electron 앱 실제 실행 검증:
  - 임시 저장소에서 파일 첨부 metadata 저장 및 실제 파일 생성 확인
  - `/file`, `/f` 입력 후 Enter로 파일 첨부 팝오버 표시 및 Markdown 링크 삽입 확인
  - `/image`, `/i`, `/img` 입력 후 Enter로 이미지 첨부 팝오버 표시 및 Markdown 이미지 문법 삽입 확인
  - 이미지 미리보기 `src`가 `notedown-attachment://...`로 렌더링되고 `naturalWidth: 1`로 실제 로드되는 것 확인

## 남은 리스크

- 실제 동기화 서버 토큰을 사용한 첨부 업로드/다운로드 end-to-end 검증은 이번 작업 범위에서 수행하지 않았다.
