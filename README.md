# Notedown

Notedown is a local-first desktop Markdown notes app built with Electron, WIZ, and Angular.

> Develop by [WIZ](https://github.com/season-framework/wiz) with AI.

---

## 한국어

Notedown은 데스크톱에서 빠르게 Markdown 문서를 작성하고, 로컬 파일로 관리하며, 필요할 때 동기화할 수 있는 노트 앱입니다. Electron 셸 위에 WIZ/Angular 화면을 올려 macOS와 Windows 배포 빌드를 지원합니다.

### 주요 기능

- 로컬 Markdown 저장소: 기본 경로는 `~/Documents/Notedown Notes`이며, 워크스페이스와 노트 메타데이터를 함께 관리합니다.
- 편집과 미리보기: Monaco 기반 Markdown 편집기와 실시간 미리보기, 라인 매핑, hover 동기화, 접기 UI를 제공합니다.
- 문서 스타일: 문서/구역 단위 스타일 지시문, 체크리스트, 코드 블록, 인용문, 표, 구분선 렌더링을 지원합니다.
- 워크스페이스 사이드바: 노트 검색, 정렬, 워크스페이스 패널, 최근 동기화 상태 표시를 제공합니다.
- PDF 내보내기: 현재 문서를 PDF로 저장할 수 있습니다.
- 동기화: 서버 로그인/설정, 시작 시 동기화, 전체 동기화, 충돌 감지, Monaco diff 기반 충돌 해결 흐름을 포함합니다.
- 데스크톱 패키징: Notedown 이름과 앱 아이콘이 적용된 macOS Apple Silicon/Intel, Windows NSIS 빌드를 지원합니다.

### 프로젝트 구조

```text
project/main/
├── electron/              # Electron main/preload 프로세스
├── src/app/               # WIZ/Angular 화면 앱
├── src/assets/brand/      # 서비스 로고와 원본 브랜드 에셋
├── build-resources/       # Electron 빌드용 icon.icns/icon.ico/icon.png
├── bundle/www/            # Electron이 로드하는 WIZ/Angular 번들
└── dist/                  # Electron 배포 산출물
```

### 실행

```bash
npm install
npm run electron
```

개발 서버에 Electron을 연결할 때는 다음처럼 실행합니다.

```bash
NOTEDOWN_DEV_URL=http://localhost:4200 npm run electron
```

### 배포 빌드

Electron 패키징 전에 WIZ/Angular 번들을 최신 상태로 갱신해 `bundle/www/`에 반영해야 합니다.

```bash
npm run dist:mac:arm64
npm run dist:mac:x64
npm run dist:win:nsis
```

요청된 세 플랫폼을 한 번에 빌드하려면 다음 스크립트를 사용할 수 있습니다.

```bash
npm run dist:requested
```

생성 산출물은 `dist/`에 저장됩니다.

### 작성자

- Taewook Kwon
- Nickname: ImuruKevol
- Email: kwon3286@season.co.kr

### 라이선스

MIT License. 자세한 내용은 `LICENSE`를 참고하세요.

---

## English

Notedown is a desktop Markdown note app for writing quickly, keeping notes as local files, and syncing them when needed. It combines an Electron shell with a WIZ/Angular interface and supports packaged builds for macOS and Windows.

### Features

- Local Markdown storage: the default path is `~/Documents/Notedown Notes`, with workspace and note metadata management.
- Editing and preview: Monaco-based Markdown editor, live preview, line mapping, synchronized hover states, and folding controls.
- Document styling: document/section style directives, checklists, code blocks, quotes, tables, and dividers.
- Workspace sidebar: note search, sorting, workspace panel, and recent sync status.
- PDF export: save the current note as a PDF.
- Sync workflow: server setup/login, startup sync, full sync, conflict detection, and Monaco diff-based conflict resolution.
- Desktop packaging: macOS Apple Silicon/Intel and Windows NSIS builds with the Notedown name and app icon applied.

### Project Structure

```text
project/main/
├── electron/              # Electron main/preload process
├── src/app/               # WIZ/Angular app screens
├── src/assets/brand/      # Source brand logo assets
├── build-resources/       # Electron build icons: icon.icns/icon.ico/icon.png
├── bundle/www/            # WIZ/Angular bundle loaded by Electron
└── dist/                  # Electron release artifacts
```

### Run

```bash
npm install
npm run electron
```

To attach Electron to a development server:

```bash
NOTEDOWN_DEV_URL=http://localhost:4200 npm run electron
```

### Release Builds

Refresh the WIZ/Angular bundle into `bundle/www/` before packaging the Electron app.

```bash
npm run dist:mac:arm64
npm run dist:mac:x64
npm run dist:win:nsis
```

To build all requested targets:

```bash
npm run dist:requested
```

Release artifacts are written to `dist/`.

### Author

- [ImuruKevol](https://github.com/ImuruKevol)

### License

MIT License. See `LICENSE` for details.
