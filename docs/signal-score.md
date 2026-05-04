# 신호 점수 시스템 (Signal Score) — 기술 문서

> 관련 파일:
> - `backend/src/services/signalScore.ts` — 신호 계산 엔진
> - `backend/src/routes/signals.ts` — HTTP 엔드포인트
> - `frontend/components/chart/SignalScore.tsx` — UI 컴포넌트
> - `frontend/components/sidebar/CoinList.tsx` — 배치 조회 및 정렬

---

## 1. 시스템 개요

Top 200 코인 각각에 대해 기술적 지표를 분석하여 **방향성(bullish/bearish)** 과 **강도(score)** 를 산출한다. 신호는 트리거된 것만 표시되며, 방향에 따라 초록(강세)/빨강(약세) 뱃지로 구분한다.

```
[signals.ts route]
  Binance REST (1h × 100봉, 4h × 100봉, 1d × 60봉)
  VolumeAggregator (4h × 30봉, CEX+DEX 통합)
        │
        ▼
[signalScore.ts: calculateSignalScore()]
  각 신호 → { triggered, direction, weight }
  bullScore = triggered bullish 신호의 weight 합계
  bearScore = triggered bearish 신호의 weight 합계
  score = max(bullScore, bearScore)
  direction = 높은 쪽
        │
        ▼
[SignalScore.tsx]
  direction 기준 색상 뱃지
  triggered 신호만 카드 표시
```

---

## 2. 신호 목록

| key | 설명 | weight | 타임프레임 |
|-----|------|--------|-----------|
| `ha_4h` | 하이킨아시 반전 | 3 | 4H |
| `ha_1d` | 하이킨아시 반전 | 3 | 1D |
| `ema_cross` | EMA20/50 골든·데스크로스 | 3 | 4H |
| `rsi_oversold` | RSI 과매도 반등 (< 30 → 상승 전환) | 2 | 4H |
| `rsi_overbought` | RSI 과매수 반락 (> 70 → 하락 전환) | 2 | 4H |
| `bb_squeeze` | 볼린저밴드 수축 + 방향 돌파 | 2 | 4H |
| `vol_spike` | 거래량 스파이크 (20봉 평균 2배 이상) | 2 | 4H |
| `rsi_bull_div_1H` | RSI 강세 다이버전스 | 3 | 1H |
| `rsi_bear_div_1H` | RSI 약세 다이버전스 | 3 | 1H |
| `rsi_bull_div_4H` | RSI 강세 다이버전스 | 3 | 4H |
| `rsi_bear_div_4H` | RSI 약세 다이버전스 | 3 | 4H |
| `obv_bull_div` | OBV 강세 다이버전스 (집계 거래량) | 2 | 4H |
| `obv_bear_div` | OBV 약세 다이버전스 (집계 거래량) | 2 | 4H |
| `rank_rising` | 시총 순위 7일 2위 이상 상승 | 1 | — |
| `macd_cross` | MACD 골든·데스크로스 | 2 | 4H |

**score → level 매핑**

| score | level |
|-------|-------|
| 0 ~ 3 | `none` |
| 4 ~ 6 | `weak` |
| 7 ~ 9 | `medium` |
| 10+ | `strong` |

---

## 3. 신호별 계산 상세

### 3-1. 하이킨아시 반전 (ha_4h, ha_1d)

하이킨아시 캔들로 변환 후 마지막 봉이 `isReversal === 'bullish' | 'bearish'`인지 확인.
`heikinashi.ts`의 반전 조건: 이전 봉과 현재 봉의 도지(body가 거의 없음) + 방향 전환.

### 3-2. EMA 크로스 (ema_cross)

```
EMA20 계산 (period 20), EMA50 계산 (period 50)
prev[i-1]: ema20 <= ema50 && curr: ema20 > ema50 → 골든크로스 (bullish)
prev[i-1]: ema20 >= ema50 && curr: ema20 < ema50 → 데스크로스 (bearish)
```

### 3-3. RSI 계열 (rsi_oversold, rsi_overbought)

마지막 두 봉의 RSI를 비교한다. 아래에서 위로 교차 or 위에서 아래로 교차 확인.

```
prev RSI < 30 && curr RSI >= 30 → 과매도 반등 (bullish)
prev RSI > 70 && curr RSI <= 70 → 과매수 반락 (bearish)
```

> ⚠️ "RSI가 30 미만" 단순 조건이 아니라 **교차** 조건이다. RSI가 오랫동안 30 아래에 있어도 올라오는 시점에만 신호 발생.

### 3-4. 볼린저밴드 수축 (bb_squeeze)

```
밴드폭 = (upper - lower) / middle
최근 5봉 평균 밴드폭 < 20봉 전 밴드폭 * 0.7 → 수축 상태
현재 close > upper → 상향 돌파 (bullish)
현재 close < lower → 하향 돌파 (bearish)
```

### 3-5. 거래량 스파이크 (vol_spike)

```
최근 20봉 평균 거래량 = avg20
마지막 봉 거래량 > avg20 * 2 → 스파이크
방향: close > open → bullish, close < open → bearish
```

### 3-6. RSI 다이버전스

> ⚠️ **과거 버그**: 처음엔 30봉 슬라이스에서 RSI를 계산했다. period 14 warmup이 슬라이스의 처음 13봉을 소모하므로 Window A(0~14)에서 유효한 RSI는 인덱스 13, 14 딱 2개뿐이었다. 실질적으로 다이버전스가 거의 발생하지 않는 버그.

**올바른 구현**:
```typescript
// 전체 캔들(100봉)에서 RSI 계산 → warmup이 LOOKBACK 바깥에서 완료
const allRsi = RSI.calculate({ period: 14, values: candles.map(c => c.close) });
const rsiSlice = allRsi.slice(-LOOKBACK); // 30봉 모두 유효한 RSI
```

**다이버전스 판정 (Window A vs B)**:
```
슬라이스: 마지막 30봉
Window A: 인덱스 0~14 (older half)
Window B: 인덱스 15~28 (newer half, 현재봉 제외)

강세: minLow_B < minLow_A (가격 더 낮은 저점)
    && rsi_at_minLow_B > rsi_at_minLow_A + 3pt (RSI 더 높은 저점)

약세: maxHigh_B > maxHigh_A (가격 더 높은 고점)
    && rsi_at_maxHigh_B < rsi_at_maxHigh_A - 3pt (RSI 더 낮은 고점)
```

RSI 버퍼 3pt는 노이즈 필터. 너무 민감하면 잦은 false positive 발생.

### 3-7. OBV 다이버전스

집계 거래량(16개 거래소 합산)으로 누적 OBV를 계산한 뒤 RSI 다이버전스와 동일한 Window A/B 방식으로 비교한다.

**OBV 계산**:
```typescript
// 전체 candles4h에서 누적 계산 → 마지막 30봉 구간도 올바른 OBV 보장
for (let i = 0; i < candles4h.length; i++) {
  const vol = aggMap.get(candle.time) ?? candle.volume; // 집계 우선, 폴백 Binance
  obv += close > prevClose ? vol : close < prevClose ? -vol : 0;
}
const sliceOBV = allOBV.slice(-LOOKBACK);
```

**노이즈 필터**: OBV 차이가 현재 OBV 절대값의 3% 미만이면 무시 (단위가 다른 코인 간 비교 불필요).

> ⚠️ OBV는 선행보다 확인 지표에 가깝다. weight 2로 RSI 다이버전스(3)보다 낮게 설정한 이유.

> ⚠️ `aggVol.length >= 30` 조건 미충족 시 OBV 다이버전스는 계산하지 않는다. 집계 데이터가 부족하면 부정확한 OBV가 되기 때문.

---

## 4. 캐싱 전략

| 캐시 | TTL | 설명 |
|------|-----|------|
| 단일 심볼 `signals:{symbol}` | 60s | 개별 코인 신호 |
| 배치 `signals:batch:{sorted}` | 180s | Top 200 배치 |

배치 캐시 TTL이 더 긴 이유: 200코인 × 3타임프레임 Binance 호출이라 재계산 비용이 크다. 3분은 충분히 신선하다.

---

## 5. 프론트엔드 캐시 전략

탭 이탈 후 복귀 시 신호가 사라지는 문제 방지를 위해:

```typescript
// QueryProvider.tsx
refetchOnWindowFocus: false  // 탭 복귀 시 자동 refetch 비활성

// CoinList.tsx scoreMap 쿼리
staleTime: 120000,           // refetchInterval과 일치 → 인터벌 사이에 stale 판정 없음
placeholderData: (prev) => prev  // refetch 중에도 이전 데이터 표시
```

**탭 복귀 동작 흐름**:
```
탭 이탈 → 복귀 (120s 이내)
  staleTime 미경과 → refetch 안 함 → 기존 데이터 즉시 표시 ✅

탭 이탈 → 복귀 (120s 초과)
  refetchOnWindowFocus: false → 탭 복귀 트리거 없음
  다음 refetchInterval(120s) 사이클에서 백그라운드 갱신
  placeholderData → 갱신 중에도 기존 데이터 표시 ✅
```

---

## 6. 스테이블코인 필터

신호 분석 대상에서 완전히 제외. `CoinList.tsx`의 `STABLECOINS` Set에 정의.

```typescript
const STABLECOINS = new Set([
  'USDT','USDC','DAI','BUSD','TUSD','USDP','FDUSD',
  'USDE','SUSDE','RLUSD','USDS',
  'STETH','WBTC','WETH','WEETH','RETH','CBBTC',
]);
```

필터는 심볼 목록 생성 **전에** 적용된다. WebSocket 구독, 신호 배치 요청 모두 필터된 목록 기준.

---

## 7. 배치 요청 구조

Top 200 코인을 100개씩 청크로 나눠 병렬 요청:

```typescript
const chunks = [symbols.slice(0, 100), symbols.slice(100)].filter(c => c.length > 0);
const results = await Promise.all(chunks.map(fetchBatchSignalScores));
```

백엔드 배치 엔드포인트는 내부에서 개별 캐시를 먼저 확인하므로, 단일 심볼 캐시가 살아있으면 재계산 없이 즉시 반환한다.

---

## 8. 유지보수 가이드

### 신호 추가
1. `signalScore.ts`에 계산 로직 작성, `signals.push(...)` 추가
2. weight는 다른 신호와의 균형 고려 (현재 최대 3)
3. direction이 항상 bullish/bearish/neutral 중 하나인지 확인

### 임계값 조정
- RSI 버퍼: `RSI_BUFFER = 3` (pt) — 낮추면 신호 빈도 증가
- OBV 버퍼: `OBV_BUFFER_PCT = 0.03` (3%) — 낮추면 신호 빈도 증가
- 볼류 스파이크: `avg20 * 2` — 배수 낮추면 신호 빈도 증가

### level 기준 변경
`signalScore.ts` 하단:
```typescript
const level = score >= 10 ? 'strong' : score >= 7 ? 'medium' : score >= 4 ? 'weak' : 'none';
```
