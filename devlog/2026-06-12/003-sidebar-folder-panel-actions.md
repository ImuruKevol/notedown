# 폴더 패널 액션 위치 정리

## 원 요청

> 사이드바 왼쪽 하단 버튼으로 폴더 목록을 열 수 있어.
> 근데 버튼을 누르면 그 버튼 자리에 설정 버튼이 들어가있어서 뭔가 UX가 별로인 느낌이야.
> 설정 버튼은 어차피 노트 목록 패널쪽에 있으니까 폴더 패널 쪽의 설정 버튼은 제거해줘. 그리고 그 위에 새 폴더 버튼은 폴더 목록 "로컬" label 오른쪽에 + 버튼을 만드는 식으로 위치를 이동해줘.

## 변경 파일

- `src/app/component.nav.sidebar/view.pug`
- `devlog.md`
- `devlog/2026-06-12/003-sidebar-folder-panel-actions.md`

## 변경 내용

- 폴더 패널 하단의 설정 링크를 제거했다.
- 기존 하단 새 폴더 버튼을 제거하고, 폴더 목록 헤더의 `로컬` 라벨 오른쪽에 작은 `+` 아이콘 버튼으로 배치했다.
- 노트 목록 패널 하단의 설정 버튼은 유지했다.

## 확인 결과

- `wiz_project_build(projectName="main", clean=false)` 성공.
- 빌드 산출물 `project/main/build/dist/build/main.js`에 변경된 폴더 패널 템플릿이 반영된 것을 확인했다.
- 검증 쿠키(`season-wiz-project=main`, `season-wiz-devmode=true`)를 포함해 요청 링크 `http://172.16.0.143:3009`에 접속을 시도했지만, 현재 환경에서 서버 연결이 실패해 브라우저 시각 검증은 수행하지 못했다.
