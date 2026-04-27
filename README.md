# ChartTrace

트레이더 중심 암호화폐 기술적 분석 플랫폼. 실시간 캔들차트, 기술 지표, 시가총액 순위 히스토리를 하나의 UI에서 제공합니다.

---

## 주요 기능

### 차트 분석
- **캔들차트 / 하이킨아시** 실시간 전환 (Binance WebSocket)
- **기술 지표**: BB, EMA 20/50/200, MACD, RSI, StochRSI, OBV, ATR
- **캔들 패턴 자동 인식**: 도지, 망치형, 역망치형, 유성형, 상승/하락 장악형
- **하이킨아시 반전 신호** 마커 자동 표시
- **거래량 이상 감지** + 매수/매도 비율

### 순위 비교 차트 (Bump Chart)
- 시가총액 기준 Top 200 코인 순위를 **SVG bump chart**로 시각화
- **30일 / 90일 / 180일** 시간 범위 선택
- **순위 구간별** 탭: 1~25위, 26~50위, 51~75위, 76~100위
- **섹터별** 탭: L1, L2, DeFi, AI, Meme, 게임, ISO20022, Privacy
- 스테이블코인 / 래핑 자산 자동 제외
- 10분마다 자동 스냅샷 누적 → 서버 재시작 시 파일에서 복구

### 멀티 코인 비교
- 최대 4개 코인 동시 비교 (/compare 페이지)

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | Next.js 14, React 18, TypeScript |
| 차트 렌더링 | TradingView Lightweight Charts (캔들), SVG (순위) |
| 상태 관리 | Zustand |
| 데이터 페칭 | TanStack Query |
| 백엔드 | Express.js, TypeScript (tsx) |
| 실시간 | Binance WebSocket 프록시 |
| 외부 API | Binance REST (OHLCV), CoinGecko (시가총액 · 순위) |
| 기술 지표 | technicalindicators |

---

## 프로젝트 구조

```
ChartTrace/
├── backend/
│   └── src/
│       ├── index.ts              # Express 서버 + WebSocket 프록시
│       ├── routes/
│       │   ├── klines.ts         # OHLCV + 집계 거래량
│       │   ├── indicators.ts     # 기술 지표 계산
│       │   ├── rankings.ts       # 순위 히스토리 (Phase1/2 시딩, autoSnapshot)
│       │   ├── signals.ts        # 신호 점수
│       │   └── volume.ts         # 거래량 분석
│       ├── services/
│       │   ├── heikinashi.ts
│       │   ├── indicators.ts
│       │   ├── patterns.ts
│       │   └── signalScore.ts
│       └── exchanges/            # 거래소 어댑터 (Binance, Bybit, OKX 등)
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # 메인 차트
│   │   ├── rankings/page.tsx     # 순위 비교 차트
│   │   └── compare/page.tsx      # 멀티 코인 비교
│   ├── components/
│   │   ├── chart/
│   │   │   ├── CandleChart.tsx   # 메인 캔들차트
│   │   │   ├── RankCompareView.tsx # Bump chart (SVG)
│   │   │   └── ...
│   │   ├── layout/, sidebar/, panels/, rankings/
│   └── lib/
│       ├── store.ts              # Zustand 글로벌 상태
│       ├── binance.ts            # Binance API 헬퍼
│       └── coingecko.ts          # CoinGecko API 헬퍼
├── docs/
│   └── ranking-chart.md          # 순위 차트 상세 기술 문서
└── data/                         # 런타임 생성 — rank-history.json (gitignore)
```

---

## 빠른 시작

### 1. 환경 변수 설정

`backend/.env` 파일 생성:

```env
PORT=4000
COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxxxxxxxxxx
```

> CoinGecko API Key는 [coingecko.com/en/developers](https://www.coingecko.com/en/developers/dashboard) 에서 무료 Demo 키 발급 (회원가입만 하면 됨). 없어도 동작하나 rate limit이 낮음 (분당 ~5회 → 30회).

### 2. 백엔드 실행 (포트 4000)

```bash
cd backend
npm install
npm run dev
```

### 3. 프론트엔드 실행 (포트 3000)

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/klines` | OHLCV 캔들 데이터 |
| GET | `/api/indicators` | 기술 지표 |
| GET | `/api/rankings` | 현재 Top 200 순위 |
| GET | `/api/rankings/history` | 순위 히스토리 (배치) |
| GET | `/api/rankings/price-history/:coinId` | 코인별 가격 히스토리 |
| GET | `/api/signals` | 신호 점수 |
| GET | `/api/volume` | 거래량 분석 |
| WS | `/ws` | Binance 실시간 스트림 프록시 |

---

## 순위 데이터 수집 방식

서버 시작 시 두 단계로 과거 순위 데이터를 구성합니다.

- **Phase 1**: CoinGecko 배치 API → 현재가 + 변동률 필드(1h, 24h, 7d, 14d, 30d, 200d, 1y)로 과거 시가총액 역산 → 7개 앵커 포인트 생성
- **Phase 2**: 코인별 `market_chart?days=200&interval=daily` 개별 fetch → 200개 일별 포인트로 180일 해상도 확보
- **autoSnapshot**: 이후 10분마다 Top 200 스냅샷 누적, `backend/data/rank-history.json`에 저장
- 재시작 시 파일에서 복구 → Phase 2 대상 코인 수가 크게 줄어 시딩 속도 향상

자세한 내용은 [docs/ranking-chart.md](docs/ranking-chart.md) 참고.

---

## License

Copyright (c) 2025 chartccoli. All Rights Reserved.  
무단 복제, 배포, 수정을 금합니다.
