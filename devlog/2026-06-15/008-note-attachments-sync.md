# 노트 첨부 파일/이미지 UI 및 동기화 처리 추가

- 날짜: 2026-06-15
- 번호: 008
- 리뷰 ID: yhogwbfwwebucdsemeansgcjfxdixxtd

## 사용자 요청

작업 시작. 동기화 시 파일 및 이미지를 업로드해야하는데, 실제 동기화 전 메타 확인 과정에서 먼저 파일 및 이미지를 업로드를 해야하는지 확인하는 과정이 있어. openapi.json은 `http://172.16.0.143:5500/api/openapi.json`를 참고.

요청 상세:
- 현재 노트에 파일을 첨부할 수 있는 기능 추가
- 우측 상단 액션 버튼 영역에 첨부 버튼과 현재 노트 첨부 개수 표시
- 버튼 클릭 시 오른쪽 패널에서 첨부 목록 표시
- `/file`, `/f`, `/image`, `/i`, `/img` 문법 추가
- slash 입력 후 Enter 시 현재 노트 첨부 목록과 첨부 업로드 팝오버 표시
- 팝오버는 위/아래 키보드 이동 및 스크롤 대응
- 첨부 목록 선택 후 Enter 시 Markdown 링크 또는 이미지 문법 자동 삽입
- 실제 동기화 전 plan 단계에서 첨부 메타/해시로 업로드 필요 여부 확인

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/component.nav.sidebar/view.ts`
- `src/app/layout.sidebar/view.ts`
- `electron/main.cjs`
- `electron/preload.cjs`
- `devlog.md`
- `devlog/2026-06-15/008-note-attachments-sync.md`

## 변경 내용

- 노트 모델에 `attachments` 메타데이터를 추가하고, 노트 화면에서 우측 첨부 패널과 숨김 파일 입력을 연결했다.
- 첨부 버튼에 현재 노트의 첨부 개수를 표시하고, 패널에서 파일/이미지 첨부 및 첨부 파일 열기를 제공했다.
- Monaco slash completion에 `/file`, `/f`, `/image`, `/i`, `/img` 흐름을 추가하고, 선택 팝오버에서 키보드 이동/Enter 삽입을 처리했다.
- 파일은 `[파일명](첨부경로)`, 이미지는 `![파일명](첨부경로)` Markdown 문법으로 삽입되도록 했다.
- 미리보기 이미지 `src`는 현재 저장소의 로컬 첨부 파일 URL로 변환하고, 첨부 링크 클릭은 Electron IPC로 실제 파일을 열도록 했다.
- Electron storage IPC에 `saveAttachment`, `openAttachment`를 추가하고, 첨부 파일을 노트별 `.attachments` 경로에 저장하도록 했다.
- `metadata.json`의 `notes[].attachments`를 보존하고, 노트/첨부 삭제 시 고아 첨부 파일을 정리하도록 했다.
- OpenAPI의 `/api/sync/plan` 스펙에 맞춰 `knownAttachments`를 전송하고, `/api/sync/attachment`로 실제 첨부 업로드/삭제를 수행하도록 동기화 루틴을 확장했다.
- 전체 동기화의 첨부 다운로드/업로드/로컬 삭제/서버 삭제 plan 그룹을 처리하고, 설정 화면 요약에 첨부 수량을 포함했다.

## 확인 결과

- `node --check electron/main.cjs`: 통과
- `node --check electron/preload.cjs`: 통과
- `wiz_project_build(clean=false, projectName=main)`: 성공

## 남은 리스크

- 실제 서버 토큰과 사용자 저장소 파일을 사용한 end-to-end 첨부 업로드/다운로드는 수행하지 않았다.
- 첨부 충돌 뷰어는 바이너리 내용을 직접 diff하지 않고 파일 메타 정보 비교로 표시한다.
