# Electron readable storage metadata.db

## 원 요청

서버에 저장될 때만 문서 이름을 실제 문서 이름으로 하고, 폴더 이름도 실제 폴더 이름으로 하면서 metadata.db를 만들었네....
electron app에서는 아직 여전히 옛날 방식으로 저장을 하고 있는데 서버 방식대로 통일해줘. "~/Documents/Notedown Notes" 경로에 있으니 반영해줘.

## 변경 파일

- `electron/main.cjs`
- `electron/metadata-store.cjs`
- `README.md`
- `src/app/page.settings/view.pug`
- `src/app/page.settings/view.ts`
- `src/app/page.notes/view.ts`
- `src/app/layout.sidebar/view.ts`
- `src/angular/app/notedown-android-bridge.ts`
- `devlog.md`
- `devlog/2026-06-29/004-electron-readable-storage-metadata-db.md`

## 작업 내용

- Electron 로컬 메타데이터 저장소를 `metadata.json`에서 SQLite 기반 `metadata.db`로 전환했다.
- 노트의 동기화 식별자인 `relativePath`는 유지하고, 실제 파일 위치는 `storagePath`로 분리해 문서 제목 기반 Markdown 파일명으로 저장하도록 했다.
- 첨부 파일도 논리 경로와 실제 저장 경로를 분리해 `attachments/<노트명>/` 하위의 읽기 쉬운 경로로 저장하도록 했다.
- UI 문구와 시스템 파일 필터를 `metadata.db` 기준으로 갱신했다.
- `/Users/ktw/Documents/Notedown Notes`의 기존 `metadata.json`을 `metadata.db`로 변환하고, 16개 노트와 누락되어 있던 첨부 파일 2개를 새 물리 경로로 옮겼다.

## 검증

- `node --check electron/main.cjs`
- `node --check electron/metadata-store.cjs`
- `ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(process.versions.node); console.log(typeof require('node:sqlite').DatabaseSync)"`
- `node` 샘플 스크립트로 `metadata-store.cjs`의 `writeMetadata`/`readMetadata` 왕복 확인
- `/Users/ktw/Documents/Notedown Notes`에서 `metadata.json` 삭제 및 `metadata.db` 생성 확인
- `sqlite3 ~/Documents/Notedown\ Notes/metadata.db`로 9개 워크스페이스, 16개 노트, 2개 첨부 파일 확인
- WIZ `main` 프로젝트 빌드 성공
