# Preview hover 동기화 보강 및 파일 기반 저장소 화면 구현

## 요청

preview 코드블럭 카드의 overflow를 해제하고, preview/editor 양쪽에서 빈 행까지 포함한 행 hover 효과를 동기화해달라는 요청. 설정의 저장소 화면을 실제 Markdown 파일과 metadata.json 기반 저장 방식으로 완성하고, 기존 디렉토리/Markdown 문서가 있으면 metadata를 자동 생성하며, 깊은 경로 Markdown은 기본 비활성 옵션으로 복사 가져오기를 지원해달라는 요청.

## 변경 파일

- `electron/main.cjs`
- `electron/preload.cjs`
- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/component.nav.sidebar/view.ts`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/004-file-storage-preview-hover-sync.md`

## 변경 내용

- Preview 코드블럭 wrapper의 `overflow`를 `visible`로 바꾸고, Monaco readonly 코드 미리보기 툴팁이 잘리지 않도록 조정했다.
- Preview를 원문 라인 기준 블록으로 구성해 빈 행도 hover 대상이 되도록 했고, preview hover와 Monaco editor line decoration을 서로 동기화했다.
- 드래그 가능한 Electron 타이틀바 내부의 버튼/링크가 클릭 가능하도록 `no-drag` CSS 우선순위를 보강했다.
- Electron IPC 저장소 API를 추가해 기본 저장소 경로, 디렉토리 선택, 저장소 상태 조회, metadata 생성/갱신, 노트 로드/저장을 지원했다.
- 저장소 구조를 Markdown 파일 + `metadata.json`으로 구성하고, 저장소 루트의 Markdown은 `미지정 워크스페이스`, 루트 직하위 디렉토리는 작업공간으로 자동 매핑하도록 했다.
- 깊은 경로 Markdown은 기본 비활성 옵션으로 두고, 활성화 시 `_imported` 작업공간에 디렉토리 깊이를 `_`로 평탄화한 이름으로 복사하도록 했다.
- 파일 저장소에서 문서 삭제 시 이전 metadata 기준으로 더 이상 참조되지 않는 Markdown 파일을 제거하도록 저장 루틴을 보강했다.

## 검증

- `node --check electron/main.cjs && node --check electron/preload.cjs`
- `wiz_project_build(clean=false)` 성공
- Electron 실행 화면에서 저장소 경로가 `/Users/ktw/Documents/Notedown Notes`로 분리되어 표시되는지 확인
- Electron 실행 화면에서 설정 헤더 뒤로가기 링크와 내용 있는 문서 삭제 확인 다이얼로그 동작 확인
- 검증 중 생성된 샘플 Markdown 파일은 삭제하고 저장소에는 빈 `metadata.json`만 남도록 정리
