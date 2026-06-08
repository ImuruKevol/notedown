# 현재 기능 기준 README 갱신 및 Electron 스크린샷 추가

## 사용자 요청

현재 기능들을 기준으로 README를 업데이트해줘. 그리고 이 앱이 무슨 앱인지 확실하게 알 수 있는 스크린샷 2~3개 정도를 추가해줘. electron을 띄워서 캡쳐하면 돼.

## 변경 파일

- `README.md`
- `screenshots/notedown-editor-preview.png`
- `screenshots/notedown-command-palette.png`
- `screenshots/notedown-settings-storage.png`
- `devlog.md`
- `devlog/2026-06-08/005-readme-screenshots-current-features.md`

## 변경 내용

- README 상단에 Electron에서 캡처한 앱 스크린샷 3장을 추가했다.
- 현재 앱 기능 기준으로 로컬 Markdown 저장소, 저장소 관리, Monaco 편집/미리보기, 문서 렌더링, 사이드바, 커맨드 팔렛트, 설정, PDF 내보내기, 서버 동기화, 충돌 해결, 트레이/패키징 설명을 정리했다.
- 한국어/영어 섹션의 기본 워크플로와 프로젝트 구조를 최신 기능에 맞게 갱신했다.

## 검증

- `npm run electron`에 원격 디버깅 포트를 붙여 실제 Electron 앱을 실행했다.
- 임시 로컬 저장소(`/tmp/notedown-readme-storage`)를 사용해 노트 편집/미리보기, 커맨드 팔렛트, 저장소 설정 화면을 캡처했다.
- 생성된 세 PNG를 시각적으로 확인했다.
- 문서와 이미지 변경만 포함되어 별도 빌드는 실행하지 않았다.
