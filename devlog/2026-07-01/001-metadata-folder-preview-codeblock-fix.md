# metadata.db 폴더 메타데이터 정리 및 preview 코드블럭 렌더 안정화

## 사용자 원 요청
- 현재 `~/Documents/Notedown Notes/metadata.db`에 저장된 메타데이터들을 정리해줘. 현재 Electron app에서는 아직 정리가 되지 않아 중복되어 표시가 되고 있어.
- 번외로 버그가 있어. preview에 표시되는 코드블럭이 앱의 어딘가를 클릭/입력 등을 할 때마다 다시 렌더링이 되는지 코드블럭이 깜빡이는 현상이 발생하고 있어.

## 변경 파일
- `electron/main.cjs`
  - metadata 생성/저장 시 실제 `relativePath`의 디렉토리명을 workspace/folder 기준으로 사용하도록 수정.
  - `unfiled` 워크스페이스를 항상 쓰지 않고 root Markdown 파일이 있을 때만 생성하도록 수정.
  - metadata note 읽기/비교/upsert 시 stale `workspace` alias보다 실제 경로 기반 folder를 우선하도록 수정.
- `src/app/component.nav.sidebar/view.ts`
  - 노트 기반 폴더와 같은 표시명을 가진 stale localStorage 폴더 alias를 목록에서 제외.
  - 정리된 폴더 목록을 `notedown.folders.v1`에 다시 저장.
- `src/app/layout.sidebar/view.ts`
  - 커맨드 팔렛트/레이아웃 사이드바 workspace 목록에서도 같은 표시명의 stale alias를 note 기반 workspace가 이기도록 병합.
- `src/app/page.notes/view.ts`
  - preview 코드블럭 Monaco 옵션을 언어/테마/tab size별로 캐시하고 preview block 생성 시 고정 옵션/높이를 보관.
  - preview block `trackBy`를 추가해 불필요한 DOM 재생성을 줄임.
- `src/app/page.notes/view.pug`
  - preview `ngFor`에 `trackBy` 적용.
  - 코드블럭 preview가 매 change detection마다 새 옵션 객체를 받지 않도록 block의 고정 옵션/높이를 바인딩.
- `devlog.md`
- `devlog/2026-07-01/001-metadata-folder-preview-codeblock-fix.md`

## 데이터 정리
- 대상 DB: `/Users/ktw/Documents/Notedown Notes/metadata.db`
- 백업: `/Users/ktw/Documents/Notedown Notes/metadata.db.backup-20260701-105836`
- 정리 결과:
  - note 6건의 `workspace_id`, `folder`, `workspace`를 실제 문서 경로의 디렉토리 기준으로 보정.
  - 중복 표시명을 만들던 workspace 3건 제거.
  - 실제 디렉토리명 기준 workspace 2건 추가.

## 검증 결과
- `node --check /Users/ktw/Documents/notedown/project/main/electron/main.cjs`: 통과.
- `git -C /Users/ktw/Documents/notedown/project/main diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/app/component.nav.sidebar/view.ts src/app/layout.sidebar/view.ts electron/main.cjs`: 통과.
- `wiz_project_build(clean=false, projectName="main")`: 성공.
- metadata.db 검증 스크립트:
  - note 18건과 첨부 경로 제외 실제 Markdown 파일 18건 일치.
  - workspace/folder mismatch 0건.
  - workspace 표시명 중복 0건.
