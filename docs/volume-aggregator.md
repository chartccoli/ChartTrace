# 멀티 거래소 거래량 집계 시스템 — 기술 문서

> 관련 파일:
> - `backend/src/exchanges/adapter.interface.ts` — 어댑터 인터페이스 + INTERVAL_MAP
> - `backend/src/exchanges/aggregator.ts` — 집계 엔진 (싱글턴)
> - `backend/src/exchanges/cex/` — CEX 어댑터 12개
> - `backend/src/exchanges/dex/` — DEX 어댑터 4개
> - `backend/src/routes/volume.ts` — HTTP 엔드포인트
> - `backend/src/routes/indicators.ts` — OBV에 집계 거래량 주입
> - `frontend/components/chart/StackedVolumeChart.tsx` — SVG 누적 바 차트

---

## 1. 지원 거래소

### CEX (12개)

| 이름 | 클래스 | 파일 | 심볼 형식 | interval 형식 |
|------|--------|------|-----------|--------------|
| Binance | `BinanceAdapter` | `cex/binance.adapter.ts` | `BTCUSDT` | `1h`, `4h` |
| OKX | `OKXAdapter` | `cex/okx.adapter.ts` | `BTC-USDT` | `1H`, `4H` |
| Bybit | `BybitAdapter` | `cex/bybit.adapter.ts` | `BTCUSDT` | `60`, `240` |
| MEXC | `MexcAdapter` | `cex/mexc.adapter.ts` | `BTCUSDT` | `1h`, `4h` |
| KuCoin | `KucoinAdapter` | `cex/kucoin.adapter.ts` | `BTC-USDT` | `1hour`, `4hour` |
| Bitget | `BitgetAdapter` | `cex/bitget.adapter.ts` | `BTCUSDT` | `1h`, `4h` |
| HTX | `HtxAdapter` | `cex/htx.adapter.ts` | `btcusdt` | `60min`, `4hour` |
| Gate.io | `GateioAdapter` | `cex/gateio.adapter.ts` | `BTC_USDT` | `1h`, `4h` |
| Kraken | `KrakenAdapter` | `cex/kraken.adapter.ts` | `XBTUSDT` | `60`, `240` (분 단위) |
| Coinbase | `CoinbaseAdapter` | `cex/coinbase.adapter.ts` | `BTC-USD` | `ONE_HOUR`, `FOUR_HOUR` |
| Crypto.com | `CryptocomAdapter` | `cex/cryptocom.adapter.ts` | `BTC_USDT` | `H1`, `H4` |
| Upbit | `UpbitAdapter` | `cex/upbit.adapter.ts` | `KRW-BTC` | `minutes/60`, `minutes/240` |

### DEX (4개)

| 이름 | 클래스 | 파일 | 특이사항 |
|------|--------|------|---------|
| Hyperliquid | `HyperliquidAdapter` | `dex/hyperliquid.adapter.ts` | 퍼펙츄얼 DEX, POST 방식 API |
| Uniswap | `UniswapAdapter` | `dex/uniswap.adapter.ts` | The Graph 서브그래프 |
| PancakeSwap | `PancakeSwapAdapter` | `dex/pancakeswap.adapter.ts` | The Graph 서브그래프 |
| dYdX | `DydxAdapter` | `dex/dydx.adapter.ts` | 퍼펙츄얼 DEX |

> ⚠️ DEX 어댑터(Uniswap, PancakeSwap)는 The Graph API를 사용하여 응답이 느리다 (1~3초).  
> `dex=true` 쿼리 시 캐시 TTL이 5분으로 늘어나는 이유.

---

## 2. 어댑터 인터페이스

```typescript
interface ExchangeAdapter {
  name: string;        // 소문자, 식별자 (예: 'binance', 'kucoin')
  type: 'CEX' | 'DEX';

  normalizeSymbol(exchangeSymbol: string): string;  // 거래소 → BTC/USDT 표준
  toExchangeSymbol(standardSymbol: string): string; // BTC/USDT → 거래소 형식

  getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>;
}

interface Kline {
  openTime: number;      // Unix 초
  open, high, low, close: number;
  volume: number;        // 코인 기준 (BTC)
  quoteVolume: number;   // USDT 기준 (집계에 사용)
  takerBuyVolume: number;
  source: string;
}
```

> ⚠️ **`quoteVolume`이 집계의 기준이다.** `volume`(BTC 단위)은 거래소마다 동일하지만 `quoteVolume`(USDT)이 금액 비교에 정확하다. 어댑터가 `quoteVolume`을 제공하지 못하면 `volume * close`로 근사 계산한다 (Coinbase, Crypto.com, Kraken 등).

**표준 심볼 형식**: `BASE/QUOTE` (예: `BTC/USDT`, `ETH/USDT`). 모든 어댑터는 이 형식을 입력으로 받아 자체 형식으로 변환한다.

---

## 3. 집계 엔진 (`aggregator.ts`)

### 3-1. `getAggregatedKlines(symbol, interval, limit)`

```
1. 모든 어댑터에서 getKlines() 병렬 호출 (Promise.allSettled)
2. 실패한 어댑터는 조용히 무시 (빈 배열 처리)
3. 성공한 어댑터 결과를 mergeByTimestamp()로 합산
```

`Promise.allSettled` 사용으로 한 거래소가 다운되어도 나머지 거래소 데이터는 정상 반환된다.

### 3-2. `mergeByTimestamp()`

```
기준 타임스탬프: Binance kline의 openTime 배열 (없으면 첫 번째 성공 어댑터)

각 타임스탬프 ts에 대해:
  - 각 어댑터에서 |openTime - ts| < 300초인 kline 매칭
  - OHLC는 Binance(primary) 기준
  - quoteVolume 합산 → totalQuoteVolume
  - breakdown 배열 구성 → share(%) 계산

반환: AggregatedKline[]
  { timestamp, open, high, low, close,
    totalVolume, totalQuoteVolume,
    breakdown: [{ exchange, type, volume, quoteVolume, share }],
    cexVolume, dexVolume, dexRatio }
```

**타임스탬프 300초 허용 오차**: 거래소마다 캔들 경계가 약간 다를 수 있다. 300초(5분)는 4h 캔들에서 무시할 수 있는 범위.

### 3-3. 싱글턴 인스턴스

```typescript
export const volumeAggregator = new VolumeAggregator();
```

서버 전체에서 하나의 인스턴스만 사용한다. `signals.ts`, `indicators.ts`, `volume.ts` 모두 이 인스턴스를 import한다.

---

## 4. HTTP 엔드포인트 (`volume.ts`)

### `GET /api/volume`

| 파라미터 | 기본값 | 설명 |
|---------|--------|------|
| `symbol` | `BTC/USDT` | 표준 심볼 형식 |
| `interval` | `4h` | 타임프레임 |
| `limit` | `500` | 봉 개수 |
| `dex` | `false` | DEX 포함 여부 |

**`dex=false` (기본)**
- DEX 어댑터 결과를 필터링하여 반환
- breakdown에서 `type === 'DEX'` 항목 제거
- `dexVolume: 0`, `dexRatio: 0`으로 덮어씀
- 캐시 TTL: 60초

**`dex=true`**
- CEX + DEX 전체 포함
- 캐시 TTL: 300초 (DEX API 느림)

> ⚠️ 프론트에서 `dex=true`를 사용 중. DEX 거래량도 시장에 영향을 주므로 전체 집계가 더 정확하다.

### `GET /api/volume/exchanges`

현재 등록된 거래소 목록과 우선순위 반환. 프론트 범례와 동기화 불필요 (범례는 실제 데이터 기반으로 자동 생성됨).

---

## 5. OBV와의 연동 (`indicators.ts`)

OBV 지표 요청 시에만 집계 거래량을 추가로 fetch하여 Binance 단일 거래량을 교체한다.

```typescript
const needsAggVol = indicators.includes('obv');

const [klinesRes, aggKlines] = await Promise.all([
  axios.get(BINANCE_BASE + '/klines', ...),
  needsAggVol
    ? volumeAggregator.getAggregatedKlines(stdSymbol, interval, limit).catch(() => [])
    : Promise.resolve([]),
]);

// 캔들 volume을 집계 거래량으로 교체
const aggVolMap = new Map(aggKlines.map(k => [k.timestamp, k.totalQuoteVolume]));
candles[i].volume = aggVolMap.get(time) ?? binanceVol; // 폴백: Binance
```

**왜 OBV에만 적용하는가**: BB, EMA, RSI, MACD는 가격(close) 기반이라 집계 거래량이 불필요하다. OBV만 volume이 핵심 입력값이므로 추가 API 호출 비용을 OBV에만 부담시킨다.

---

## 6. 프론트엔드 (`StackedVolumeChart.tsx`)

### 6-1. 거래소 색상 맵

```typescript
// 키는 반드시 소문자 (백엔드가 소문자로 반환)
const EXCHANGE_COLORS: Record<string, string> = {
  'binance':     '#F0B90B',
  'okx':         '#7B8FA1',
  'bybit':       '#FF6B35',
  'mexc':        '#16C784',
  'kucoin':      '#00A3FF',
  'bitget':      '#00F0FF',
  'htx':         '#2DB7F5',
  'gateio':      '#E040FB',
  'kraken':      '#5741D9',
  'coinbase':    '#4D8EFF',
  'cryptocom':   '#103F68',
  'upbit':       '#1AC8DB',
  'hyperliquid': '#00E5A0',
  'uniswap':     '#FF007A',
  'pancakeswap': '#1FC7D4',
  'dydx':        '#6966FF',
};
```

> ⚠️ **대소문자 버그 경험**: 최초 구현에서 키를 `'Binance'`, `'OKX'`처럼 대문자로 작성했으나 백엔드 응답은 `'binance'`, `'okx'` 소문자라 모든 색상이 폴백 회색(`#6b6b80`)으로 표시됐다. 항상 소문자로 통일.

`exchangeColor(name)` 함수는 `name.toLowerCase()`로 정규화한 뒤 조회한다.

### 6-2. 픽셀 정렬 (LWC 연동)

SVG 바가 메인 캔들차트와 정확히 정렬되어야 한다. 이를 위해 LWC의 `timeToCoordinate` API를 사용한다.

```typescript
// CandleChart.tsx
const timeToCoord = useCallback(
  (time: number) => mainChartApi.current?.timeScale().timeToCoordinate(time as Time) ?? null,
  []
);

// StackedVolumeChart.tsx props
interface Props {
  candles: Candle[];
  aggVolData: AggregatedKline[];
  timeToCoord: (time: number) => number | null;
}
```

> ⚠️ **과거 버그 1 (회색 바)**: `aggVolMap.current`(mutable ref)를 prop으로 전달했더니 React가 변경을 감지 못해 stale Map으로 렌더링. 수정: `aggVolData` 배열을 직접 전달, `useMemo`로 Map 내부 생성.

> ⚠️ **과거 버그 2 (정렬 불일치)**: 인덱스 기반 균등 분배로 x좌표를 계산했더니 LWC 바와 일치하지 않음. 수정: `timeToCoordinate(time)`으로 픽셀 좌표를 LWC에서 직접 읽어옴.

**바 너비 계산**:
```typescript
const barHalfW = bars.length >= 2
  ? Math.abs(bars[1].x - bars[0].x) * 0.38
  : 4;
```
인접한 두 바의 x 간격에서 동적으로 계산 → 줌 레벨이 달라져도 자동 적응.

**스크롤/줌 동기화**: `CandleChart`가 `visibleRange` state를 구독 → 스크롤 시 re-render → `StackedVolumeChart`도 re-render → `timeToCoord` 호출로 최신 x좌표 반영.

### 6-3. 렌더링 로직

```
bars = candles
  .map(candle => ({ x: timeToCoord(candle.time), candle, aggK: aggVolMap.get(candle.time) }))
  .filter(b => b.x !== null)  // 화면 밖 자동 제외

aggK 없으면 → 단색 폴백 (bullish: #2ebd85, bearish: #f6465d)
aggK 있으면 → breakdown 거래량 내림차순 정렬 후 아래서 위로 쌓기 (yStack -= segH)
```

---

## 7. 어댑터 추가 가이드

새 거래소를 추가하는 방법:

### Step 1 — 어댑터 파일 생성

`backend/src/exchanges/cex/newexchange.adapter.ts`:

```typescript
import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

export class NewExchangeAdapter implements ExchangeAdapter {
  name = 'newexchange'; // 소문자, 공백 없음
  type = 'CEX' as const;

  normalizeSymbol(s: string): string { /* → BTC/USDT */ }
  toExchangeSymbol(s: string): string { /* BTC/USDT → 거래소 형식 */ }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    // interval 변환 필요 시 로컬 map 사용 (INTERVAL_MAP 추가 불필요)
    // 반드시 openTime을 Unix 초로 반환
    // quoteVolume 없으면 volume * close로 근사
  }
}
```

### Step 2 — aggregator.ts에 등록

```typescript
import { NewExchangeAdapter } from './cex/newexchange.adapter';

// constructor 어댑터 배열에 추가 (볼륨 큰 순 유지)
new NewExchangeAdapter(),
```

### Step 3 — 프론트 색상/라벨 추가

`frontend/components/chart/StackedVolumeChart.tsx`:

```typescript
const EXCHANGE_COLORS = { ..., 'newexchange': '#COLOR' };
const EXCHANGE_LABELS = { ..., 'newexchange': 'New Exchange' };
```

### Step 4 — volume.ts exchanges 목록 업데이트 (선택)

`/api/volume/exchanges` 엔드포인트의 배열에 추가.

---

## 8. 알려진 제약사항

### 8-1. Upbit KRW 쌍
Upbit는 KRW 마켓 거래소라 `BTC/USDT` 요청 시 `KRW-BTC` 쌍을 사용한다. quoteVolume이 KRW 단위라 USDT 기준으로 집계하면 환율 오차가 있다. 실용적 수준에서 무시 가능하지만 정밀 분석 시 유의.

### 8-2. Coinbase USD 쌍
Coinbase는 USDT가 아닌 USD 마켓. `BTC-USD` 기준으로 quoteVolume을 반환한다. USD ≈ USDT로 처리.

### 8-3. Hyperliquid 퍼펙츄얼
Hyperliquid는 스팟이 아닌 퍼펙츄얼 시장이다. 스팟 가격과 오차가 있을 수 있으며 펀딩 비용이 반영된다. 그러나 시장 압력 지표로는 유효하다.

### 8-4. DEX 슬리피지/MEV
Uniswap, PancakeSwap의 quoteVolume은 실제 체결 금액이지만 MEV와 샌드위치 공격 등으로 인위적으로 부풀려질 수 있다. dexRatio가 높으면 참고 용도로만 활용.

### 8-5. limit 상한
| 거래소 | limit 상한 |
|--------|-----------|
| Bybit | 200 |
| OKX | 300 |
| Coinbase | 300 |
| Crypto.com | 300 |
| 나머지 | 500~1500 |

`getAggregatedKlines(symbol, interval, 500)` 호출 시 Bybit는 200봉만 반환한다. 타임스탬프 매칭으로 자연스럽게 처리되므로 별도 처리 불필요.
