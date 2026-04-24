# ChartTrace — 트레이더 중심 암호화폐 기술적 분석 플랫폼
## 개발 명세서 (Claude Code용)

---

## 프로젝트 개요

CoinMarketCap·CoinGecko와 달리, 프로젝트 정보(창시자, 발행량 등)보다
**가격 움직임과 기술적 분석**에 집중한 트레이더 전용 암호화폐 대시보드.
단기 매매자가 단일 플랫폼에서 복합 기술 지표를 분석할 수 있도록 설계한다.

---

## 기술 스택

### Frontend
- Framework: Next.js 14 (App Router)
- Language: TypeScript
- Styling: Tailwind CSS
- 차트: TradingView Lightweight Charts v4
- 상태관리: Zustand
- 데이터 패칭: TanStack Query (React Query)

### Backend
- Runtime: Node.js
- Framework: Express.js
- 지표 계산: technicalindicators (npm 패키지)
- WebSocket: ws 패키지 (실시간 가격 스트림)

### 데이터 소스 (모두 무료 Public API)
- 실시간 OHLCV: Binance REST API + WebSocket
  - Base URL: https://api.binance.com/api/v3
  - Klines: GET /klines?symbol=BTCUSDT&interval=4h&limit=500
  - WebSocket: wss://stream.binance.com:9443/ws
- 시가총액·순위: CoinGecko API
  - Base URL: https://api.coingecko.com/api/v3
  - 시총 순위: GET /coins/markets?vs_currency=usd&order=market_cap_desc

### 배포
- Frontend: Vercel
- Backend: Railway

---

## 핵심 기능 명세

### 1. 메인 대시보드 레이아웃
- 좌측: 코인 목록 사이드바 (시총 Top 50, 실시간 가격·등락률 표시)
- 중앙: 메인 차트 영역
- 우측: 지표 패널 (선택된 지표 수치 표시)
- 상단: 코인 검색바, 타임프레임 선택 (15m / 1h / 4h / 1d / 1w)

### 2. 차트 기능

#### 기본 캔들차트
- TradingView Lightweight Charts로 일반 캔들차트 렌더링
- 거래량 히스토그램 차트 하단 병렬 표시
- 크로스헤어 동기화 (메인 차트 ↔ 거래량 차트)

#### 하이킨아시 캔들 (핵심 기능)
- 토글 버튼으로 일반 캔들 ↔ 하이킨아시 전환
- 하이킨아시 계산 공식:
  - HA_Close = (Open + High + Low + Close) / 4
  - HA_Open = (prev_HA_Open + prev_HA_Close) / 2
  - HA_High = max(High, HA_Open, HA_Close)
  - HA_Low = min(Low, HA_Open, HA_Close)
- 반전 신호 자동 감지 로직:
  - 청→적 반전: 직전 캔들이 청색(HA_Close > HA_Open)이고
                현재 캔들이 적색(HA_Close < HA_Open)이며
                현재 캔들에 위꼬리가 없거나 매우 작을 때
  - 적→청 반전: 직전 캔들이 적색이고
                현재 캔들이 청색이며
                아래꼬리가 없거나 매우 작을 때
  - 감지된 반전 시점에 차트 위에 마커(▲ / ▼) 오버레이 표시
  - 4H, 1D 타임프레임에서만 기본 활성화 (설정에서 변경 가능)

#### 캔들패턴 자동 인식
- 감지 대상 패턴:
  - 도지 (Doji): |Close - Open| / (High - Low) < 0.1
  - 망치형 (Hammer): 아래꼬리 > 몸통 * 2, 위꼬리 없음, 하락 추세 후
  - 역망치형 (Inverted Hammer)
  - 장악형 (Engulfing): 불리시/베어리시
- 차트에 패턴 감지 시 아이콘 마커로 표시

### 3. 기술 지표 (technicalindicators 패키지 활용)

아래 지표를 선택적으로 오버레이 또는 서브 차트로 표시:

| 지표 | 타입 | 표시 위치 |
|---|---|---|
| Bollinger Bands | 오버레이 | 메인 차트 위 |
| EMA 20 / 50 / 200 | 오버레이 | 메인 차트 위 |
| MACD | 서브 차트 | 하단 패널 |
| RSI | 서브 차트 | 하단 패널 |
| Stochastic RSI | 서브 차트 | 하단 패널 |
| OBV (On-Balance Volume) | 서브 차트 | 하단 패널 |
| ATR | 서브 차트 | 하단 패널 |

- 서브 차트는 최대 2개 동시 표시
- 각 지표는 우측 패널에서 체크박스로 on/off

### 4. 거래량 분석

- 거래량 색상: 상승봉=파랑, 하락봉=빨강
- 거래량 이상 감지: 최근 20봉 평균 대비 2배 이상 시 강조 표시
- 매수/매도 추정 비율 표시 (Taker Buy Volume 활용, Binance API 제공)

### 5. 시가총액 순위 변동 트래킹

- 별도 페이지 또는 모달로 제공
- 코인별 7일간 시총 순위 변동 차트 (Line chart)
- 24시간 내 순위 급변동(±5위 이상) 코인 상단 알림 배너 표시
- CoinGecko API로 1시간 주기 갱신

### 6. 멀티 코인 비교 뷰

- 최대 4개 코인 선택 후 동일 타임프레임 차트 그리드로 비교
- RSI, 등락률 수치를 테이블로 나란히 비교

---

## 디자인 시스템

- 테마: 다크 모드 전용 (Lighter.xyz 스타일 참고)
- 배경: #0a0a0f (거의 검정)
- 카드/패널: #12121a
- 텍스트 주: #e2e2e8
- 텍스트 보조: #6b6b80
- 강조색: #5b6af0 (인디고)
- 상승: #2ebd85 (그린)
- 하락: #f6465d (레드)
- 폰트: Inter (Google Fonts)
- 차트 배경: 메인 배경과 동일하게 통일

---

## 폴더 구조
charttrace/
├── frontend/                    # Next.js
│   ├── app/
│   │   ├── page.tsx             # 메인 대시보드
│   │   ├── compare/page.tsx     # 멀티 코인 비교
│   │   └── rankings/page.tsx    # 시총 순위 변동
│   ├── components/
│   │   ├── chart/
│   │   │   ├── CandleChart.tsx  # 메인 차트
│   │   │   ├── HeikinAshi.ts    # HA 계산 + 반전 감지
│   │   │   ├── Indicators.ts    # 지표 계산 래퍼
│   │   │   └── PatternDetector.ts
│   │   ├── sidebar/
│   │   │   └── CoinList.tsx
│   │   └── panels/
│   │       └── IndicatorPanel.tsx
│   └── lib/
│       ├── binance.ts           # Binance API 클라이언트
│       └── coingecko.ts         # CoinGecko API 클라이언트
└── backend/
├── src/
│   ├── routes/
│   │   ├── klines.ts        # OHLCV 프록시 + 캐싱
│   │   ├── indicators.ts    # 지표 계산 엔드포인트
│   │   └── rankings.ts      # 시총 순위
│   └── services/
│       ├── heikinashi.ts
│       ├── patterns.ts
│       └── indicators.ts
└── index.ts

---

## 개발 순서 (Claude에게 요청할 순서)

1. 백엔드 기반 세팅 (Express + Binance API 연동 + /klines 라우트)
2. 프론트 기반 세팅 (Next.js + Tailwind + 기본 레이아웃)
3. TradingView Lightweight Charts 캔들차트 연동
4. 하이킨아시 계산 로직 + 반전 감지 + 마커 표시
5. 기술 지표 (Bollinger, EMA, RSI, MACD) 순차 추가
6. 코인 사이드바 + 실시간 WebSocket 가격 스트림
7. 거래량 분석 강화 (이상 감지, 매수/매도 비율)
8. 시총 순위 변동 페이지
9. 멀티 코인 비교 뷰
10. 전체 디자인 다크 테마 통일 + 반응형 처리

---

## 주의사항 (Claude가 실수하기 쉬운 부분)

- Binance API는 CORS 이슈로 프론트에서 직접 호출 금지.
  반드시 백엔드 프록시를 통해 호출할 것.
- TradingView Lightweight Charts는 SSR 불가.
  반드시 `dynamic(() => import(...), { ssr: false })`로 import할 것.
- 하이킨아시 첫 번째 봉은 실제 OHLC값 그대로 사용 (prev 없으므로).
- CoinGecko 무료 API는 분당 10~30회 제한.
  반드시 서버사이드에서 캐싱(5분 TTL) 후 제공할 것.
- technicalindicators 패키지는 입력 배열 길이가
  period보다 짧으면 빈 배열 반환 — 예외 처리 필수.