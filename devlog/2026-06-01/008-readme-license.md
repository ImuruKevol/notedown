# Notedown 한영 README 및 MIT 라이선스 문서 추가

## 사용자 원 요청

> readme를 이 서비스에 맞게 한글, 영어로 작성해줘.
> 그리고 라이센스 파일도 MIT로 해서 작성해줘.
> name: Taewook Kwon
> email: kwon3286@season.co.kr
> nickname: ImuruKevol

## 변경 파일

- `README.md`
  - 기존 스켈레톤 설명을 Notedown 서비스 설명으로 교체했다.
  - 한국어/영어 섹션을 각각 추가했다.
  - 주요 기능, 프로젝트 구조, 실행 방법, 배포 빌드, 작성자, 라이선스 정보를 정리했다.
- `LICENSE`
  - MIT License 전문을 추가했다.
  - 저작권 표기를 `Taewook Kwon (ImuruKevol) <kwon3286@season.co.kr>`로 작성했다.
- `package.json`
  - `author`를 `Taewook Kwon (ImuruKevol) <kwon3286@season.co.kr>`로 갱신했다.
  - `license`를 `MIT`로 추가했다.
- `package-lock.json`
  - `npm install`로 루트 패키지의 `license: MIT` 반영을 확인했다.

## 확인 결과

- `README.md`에 한국어와 영어 섹션이 모두 포함되어 있음을 확인했다.
- `LICENSE`에 MIT License 전문과 요청받은 이름/이메일/닉네임이 포함되어 있음을 확인했다.
- `package.json`의 `author`, `license`, `productName` 값을 Node로 확인했다.
- `npm install` 성공, 취약점 0건을 확인했다.

## 남은 리스크

- 문서 변경 작업이므로 별도 앱 빌드나 런타임 검증은 수행하지 않았다.
