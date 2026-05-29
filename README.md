# Notedown

Electron 기반 로컬 Markdown 노트 앱을 위한 WIZ/Angular 스켈레톤입니다.

## 현재 구성

- `src/app/page.notes`: 노트 작성, 분할 미리보기, 로컬 저장 스켈레톤
- `src/app/page.settings`: 작업공간, 편집기, 화면, 저장소 설정 스켈레톤
- `src/app/layout.sidebar`: Notion형 사이드바 레이아웃
- `src/app/component.nav.sidebar`: Notedown 내비게이션
- `src/assets/brand`: Notedown 로고 및 아이콘
- `electron`: Electron 실행 셸

## 로컬 저장

현재 화면 상태는 브라우저/Electron `localStorage`에 저장됩니다. 파일 시스템 기반 저장소는 Electron preload/API 계층에서 다음 단계로 연결할 수 있도록 설정 화면에 경로 값만 준비했습니다.

## 실행

```bash
npm run electron
```

개발 서버를 따로 띄워 Electron으로 붙일 때는 다음 환경변수를 사용합니다.

```bash
NOTEDOWN_DEV_URL=http://localhost:4200 npm run electron
```
