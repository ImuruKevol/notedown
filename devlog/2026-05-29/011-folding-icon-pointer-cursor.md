# Monaco 접기 아이콘 pointer cursor 적용

## 요청

ReviewOps `lnwupayftdcxvdopsgofgcjkuztyixjq` - 접기 아이콘에 cursor pointer를 지정해달라는 요청.

## 변경 파일

- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-29/011-folding-icon-pointer-cursor.md`

## 변경 내용

- Monaco editor 마진 영역의 folding codicon 요소(`[class*="codicon-folding-"]`)에 `cursor: pointer`를 적용했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- 요청 링크 `http://172.16.0.143:3009/notes`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- foldable 문서를 열고 접기 아이콘 DOM이 존재하며 computed cursor가 `pointer`로 적용됨을 확인했다.
