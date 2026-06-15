# 탭 크기 설정 기반 Preview 리스트 depth 정규화

- 날짜: 2026-06-12
- ID: 002
- 리뷰 ID: cdtgpkttamzohrwzwqjrfeujeizoptpa

## 사용자 원 요청

`- 11`, `  - 22`, `    - 33`, `      - 44`와 같이 작성했을 때 첨부한 스크린샷과 같이 일부 depth가 제대로 동작하지 않고 있음. 탭 size 설정과 연계되어 작동해야 하는 부분이니 수정 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
  - 리스트 렌더링 직전에 에디터 `tabSize` 설정을 기준으로 리스트 들여쓰기를 Markdown 파서용 4-space depth로 정규화.
  - Preview와 PDF export 모두 같은 정규화 경로를 사용하도록 렌더링 헬퍼를 분리.
  - 탭 문자도 현재 탭 크기 기준 컬럼으로 계산.
  - 탭 크기 설정 변경 시 Preview를 즉시 재계산하도록 연결.
- `devlog.md`
- `devlog/2026-06-12/002-tab-size-list-depth-normalization.md`

## 검증 결과

- Node 스크립트로 탭 크기 2 샘플(`0, 2, 4, 6` spaces)과 탭 크기 4 샘플(`0, 4, 8, 12` spaces)이 모두 4단계 중첩 `<ul>`로 렌더링되는 것을 확인.
- `wiz_project_build(projectName="main", clean=false)` 성공.
- UI 검증용 쿠키(`season-wiz-project=main`, `season-wiz-devmode=true`)를 포함해 `http://172.16.0.143:3009` 접속을 재시도했으나 서버 연결이 거부됨.
