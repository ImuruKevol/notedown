# 서버 이미지 push 및 Android APK 빌드

## 사용자 원 요청
```text
서버를 이미지로 빌드해서 최신화하고 push까지 해줘.
그리고 electron app은 빌드를 이미 했으니 android app을 빌드해줘. 그리고 apk 이름이 notedown.apk로 빌드가 되어야 해.
```

## 변경 파일
- `android/app/build.gradle`
  - Debug/Release APK 산출물 파일명을 `notedown.apk`로 고정하도록 Gradle outputFileName 설정을 추가.
- `devlog.md`
- `devlog/2026-07-01/002-server-image-android-apk-build.md`

## 빌드 산출물
- 서버 이미지:
  - `registry.nanoha.kr/kwon3286/notedown-server:latest`
  - `registry.nanoha.kr/kwon3286/notedown-server:260701`
  - 이미지 ID: `sha256:2321fc7c9a13efad99815646ddb25402f1697e109cc8350a8c2426a41f57b793`
  - Registry manifest digest: `sha256:73fd3602a663c8715cd47bdf68a6a6cf7a883c9723efdff9959d243329e79b88`
- Android APK:
  - `android/app/build/outputs/apk/debug/notedown.apk`
  - SHA-256: `80a3a9fa22468fb89abd873593840b0a74bf76685ed1ebf1de1a6fd6e527238b`

## 검증 결과
- 서버 테스트: `python -m unittest discover -s tests` 통과, 36개 테스트 성공.
- 서버 Docker 빌드: `docker build --platform linux/amd64 --pull` 성공.
- 서버 컨테이너 smoke test: `/api/health` 응답 `{"status":"ok"}` 확인.
- 서버 이미지 push: `:260701`, `:latest` 모두 Harbor registry push 성공.
- Android 빌드: `npm run android:build:debug` 성공.
- APK 이름 검증: `output-metadata.json`의 `outputFile`이 `notedown.apk`로 생성됨.
- APK 압축 검증: `unzip -t android/app/build/outputs/apk/debug/notedown.apk` 통과.
