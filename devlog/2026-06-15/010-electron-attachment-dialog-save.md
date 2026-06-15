# Electron 파일 선택 첨부 흐름을 main process dialog 저장으로 전환

- 날짜: 2026-06-15
- 번호: 010

## 사용자 요청

`/file` 입력 후 엔터를 누르고 파일 첨부에서 다시 엔터를 누르면 파일 선택까지는 잘 뜨는데, 파일을 선택하면 실제로 파일이 첨부되지도 않고 반응이 없어. 이미지도 똑같아.

## 변경 파일

- `electron/main.cjs`
- `electron/preload.cjs`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-06-15/010-electron-attachment-dialog-save.md`

## 변경 내용

- Electron 환경에서는 숨겨진 `<input type="file">`와 renderer `FileReader` 대신 main process의 `dialog.showOpenDialog`로 파일을 선택하고 바로 첨부 저장까지 수행하도록 `notedown:storage:choose-attachments` IPC를 추가했다.
- preload에 `storage.chooseAttachments`를 노출했다.
- `/file`, `/f`, `/image`, `/i`, `/img` slash 팝오버에서 `파일 첨부...` 또는 `이미지 첨부...`를 선택하면 새 Electron IPC를 우선 사용하도록 했다.
- slash 팝오버에서 업로드를 시작한 경우, 파일 선택 후 저장된 첨부를 즉시 Markdown 링크 또는 이미지 문법으로 삽입하도록 했다.
- Electron IPC가 없거나 브라우저 미리보기인 경우를 위해 기존 숨김 파일 input 경로는 fallback으로 유지했다.

## 확인 결과

- `node --check electron/main.cjs`: 통과
- `node --check electron/preload.cjs`: 통과
- `wiz_project_build(clean=false, projectName=main)`: 성공
- `git diff --check`: 통과
- 빌드 산출물 `bundle/www/main.js`에 `chooseAttachments` 경로 반영 확인

## 남은 리스크

- macOS native 파일 대화상자를 자동 조작하는 검증은 안정적인 결과 로그를 남기지 못했다. 대신 Electron main process dialog 저장 경로로 구현을 전환해, renderer 파일 input `change`/`FileReader` 실패 지점을 제거했다.
