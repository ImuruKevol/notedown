# Preview 및 PDF 빈 행 보존

## 요청

ReviewOps `lnwupayftdcxvdopsgofgcjkuztyixjq` - Preview 화면에서 빈 행들이 하나로 합쳐지거나 생략되지 않고 전부 표시되어야 하며, PDF로 다운로드할 때도 동일하게 보존되어야 한다는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-29/007-preview-pdf-blank-lines.md`

## 변경 내용

- PDF export HTML을 만들 때 빈 줄을 Markdown 변환기에만 맡기지 않고, 원본 빈 줄마다 `notedown-blank-line cell-blank` spacer를 생성하도록 분리했다.
- 코드 블럭 내부의 빈 줄은 기존처럼 코드 내용으로 유지하고, 코드 블럭 밖의 빈 줄만 문서 빈 행으로 보존하도록 처리했다.
- Preview의 `cell-blank` 행에 숨김 line box를 추가해 빈 행이 실제 높이를 가진 행으로 안정적으로 렌더링되도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- 요청 링크 `http://172.16.0.143:3009/notes`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- 테스트 문서에서 Preview 빈 행 5개가 원본 line index `[1, 2, 4, 5, 6]`로 생성되고 각 행 높이가 24px임을 확인했다.
- PDF 저장 경로를 stub 처리해 생성 HTML을 검사했고, `.notedown-blank-line.cell-blank` 5개와 코드 블럭 내부 `one\n\nthree\n` 보존을 확인했다.
