# Bit Flow

비트와 RAM의 동작 원리를 익히는 Next.js 기반 교육용 퍼즐 게임입니다. 게임이 끝나면 렛츠코딩 라운지 SDK를 통해 최종 점수를 랭킹에 제출합니다.

## 로컬 실행

Node.js 20.9 이상이 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

프로덕션 빌드는 다음 명령으로 확인합니다.

```bash
npm run lint
npm run build
```

랭킹 SDK는 앱의 루트 레이아웃에서 자동으로 불러옵니다. Firebase 설정, Firebase 환경변수, 별도 `.env` 파일은 필요하지 않습니다. 로컬 환경에서 SDK를 불러올 수 없거나 라운지에 로그인하지 않은 경우에는 결과 화면에 제출 오류가 표시되며 게임 자체는 계속 동작합니다.

## Vercel 배포

1. 이 Git 저장소를 Vercel 프로젝트로 가져옵니다.
2. 프로젝트의 **Root Directory**를 `bit-flow`로 지정합니다.
3. Framework Preset은 **Next.js** 자동 감지를 사용합니다.
4. Build Command와 Output Directory는 직접 덮어쓰지 않고 Vercel 기본값을 사용합니다.
5. 별도의 환경변수나 `vercel.json` 없이 배포합니다.

Vercel은 `package.json`의 `npm run build`를 사용해 Next.js 앱을 빌드하고 배포합니다.
