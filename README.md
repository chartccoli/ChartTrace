# ChartTrace

트레이더 중심 암호화폐 기술적 분석 플랫폼

## 빠른 시작

### 1. Node.js 환경 활성화 (nvm 설치된 경우)
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
```

### 2. 백엔드 실행 (포트 4000)
```bash
cd backend
npm run dev
```

### 3. 프론트엔드 실행 (포트 3000)
```bash
cd frontend
npm run dev
```

브라우저에서 http://localhost:3000 접속

## 구조

```
charttrace/
├── backend/          # Express.js API 서버
│   └── src/
│       ├── routes/   # klines, indicators, rankings
│       └── services/ # heikinashi, patterns, indicators
└── frontend/         # Next.js 14 앱
    ├── app/          # 페이지 (/, /compare, /rankings)
    ├── components/   # chart, sidebar, panels, layout
    └── lib/          # binance, coingecko, store
```

## 기능

- 캔들차트 / 하이킨아시 차트 전환
- 기술 지표: BB, EMA 20/50/200, MACD, RSI, StochRSI, OBV, ATR
- 캔들패턴 자동 인식 (도지, 망치형, 장악형)
- 하이킨아시 반전 신호 마커
- 실시간 가격 (Binance WebSocket)
- 시가총액 순위 Top 50 (CoinGecko)
- 멀티 코인 비교 (최대 4개)
- 거래량 이상 감지 + 매수/매도 비율
