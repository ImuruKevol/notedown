# Style 블럭 자동 접힘 및 접기 cursor 보강

## 요청

ReviewOps `lnwupayftdcxvdopsgofgcjkuztyixjq` - 접기 아이콘에 cursor pointer가 적용되지 않고 있으며, 문서를 열었을 때 style 타입은 기본 접기 상태로 열리게 해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-29/012-style-auto-fold-cursor-fix.md`

## 변경 내용

- Monaco folding icon 내부 요소뿐 아니라 실제 hover/click 영역인 `.cldr` gutter decoration, sticky folding icon, inline folded marker까지 `cursor: pointer !important`를 적용했다.
- 문서 선택 및 editor 초기화 후 style block 시작 라인을 찾아 `editor.fold` 액션에 전달해 style block이 기본 접힘 상태로 열리도록 했다.
- 자동 접힘 예약 타이머와 note별 적용 상태를 관리해 같은 문서에서 반복적으로 강제 접히지 않도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- 요청 링크 `http://172.16.0.143:3009/notes`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 설정한 headless Chrome 검증을 수행했다.
- Monaco gutter `.cldr`와 folding icon 모두 computed cursor가 `pointer`임을 확인했다.
- style block 문서 로드 후 `.inline-folded` 1개가 생성되고 style 내부 `color/background` 라인이 보이지 않으며, code fence 내용은 계속 표시됨을 확인했다.
