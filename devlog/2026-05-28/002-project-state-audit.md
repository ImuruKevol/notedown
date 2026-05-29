# Notedown 프로젝트 현 상태 점검

## 사용자 요청

현재 이 프로젝트가 뭐하는 프로젝트이고, 개발 상태가 어떤지에 대해 파악해줘.

## 변경 파일

- `devlog.md`: 상태 점검 작업 기록 추가
- `devlog/2026-05-28/002-project-state-audit.md`: 상세 기록 추가
- WIZ 빌드 검증 과정에서 `build/`, `bundle/`, 일부 생성 `app.json` 산출물이 갱신됨

## 확인 내용

- WIZ 워크스페이스 현재 프로젝트가 `main` 하나임을 확인
- Source 앱 5개, portal 앱 6개, portal route 2개 구성 확인
- `README.md`, 주요 앱/레이아웃/사이드바/Electron 파일, Angular 설정을 검토
- `wiz_project_build(clean=false)` 실행 결과 성공 확인

## 검증 결과

- WIZ 빌드 성공: Angular 번들 생성 완료, 출력 위치 `project/main/build/dist/build`
- 요청 링크 `http://172.16.0.143:3009`는 현재 실행 환경에서 연결 실패
- Browser 플러그인의 in-app browser 세션은 사용 가능한 브라우저가 없어 열람 불가

## 남은 리스크

- 실제 원격 리뷰 화면은 접속 불가로 시각 검증하지 못함
- Electron 실행 및 파일 시스템 저장 API는 별도 런타임 검증이 필요함
