# 차트 아키텍처 — 기술 문서

> 관련 파일:
> - `frontend/components/chart/CandleChart.tsx` — 메인 차트 컴포넌트
> - `frontend/components/chart/StackedVolumeChart.tsx` — 거래소별 거래량 SVG
> - `frontend/components/chart/Indicators.tsx` — 지표 상수/레이블 정의
> - `frontend/lib/store.ts` — Zustand 전역 상태
> - `frontend/lib/binance.ts` — API 헬퍼

---

## 1. 차트 레이아웃 구조

```
CandleChart (flex-col)
  │
  ├─ [div] mainChartRef ──────── LWC 메인 캔들차트 (높이: 드래그 조절 가능)
  │
  ├─ [div] 드래그 핸들 ────────── h-1.5, cursor-row-resize
  │
  ├─ [div] border-t ────────────── StackedVolumeChart (SVG, 높이 88px 고정)
  │
  ├─ [div] subChart1Ref ──────── LWC 서브차트 1 (높이 140px, 활성 지표 있을 때만)
  │
  └─ [div] subChart2Ref ──────── LWC 서브차트 2 (높이 140px, 활성 지표 있을 때만)
```

---

## 2. LWC (Lightweight Charts) 핵심 패턴

### 2-1. Imperative API vs React 패턴 불일치

LWC는 DOM을 직접 다루는 imperative API다. React의 declarative 패턴과 충돌하므로 `useRef`와 `useEffect`로 수동 관리한다.

```typescript
const mainChartRef = useRef<HTMLDivElement>(null);  // DOM 컨테이너
const mainChartApi = useRef<IChartApi | null>(null); // LWC 인스턴스

useEffect(() => {
  mainChartApi.current = createChart(mainChartRef.current, options);
  // ...
  return () => { mainChartApi.current?.remove(); }; // 언마운트 시 정리
}, []);
```

### 2-2. 차트 초기화 useEffect 분리 전략

차트 초기화는 **두 개의 useEffect**로 분리되어 있다:

| useEffect | deps | 역할 |
|-----------|------|------|
| 1번 (마운트) | `[]` | mainChart 생성, `attachMainSubscriptions` 호출 |
| 2번 (오버레이) | `[indData, indicators.bb, indicators.ema20, ...]` | 차트 재생성 + 오버레이 시리즈 + `attachMainSubscriptions` 재호출 |

> ⚠️ **2번 useEffect가 차트를 재생성하는 이유**: LWC는 생성된 시리즈를 "제거" 할 수 없고, 새 시리즈를 추가하기만 할 수 있다. 오버레이(BB, EMA 등)를 껐다 켤 때마다 이전 시리즈가 누적되는 문제를 방지하기 위해 차트를 통째로 재생성한다.

> ⚠️ **재생성 후 반드시 `attachMainSubscriptions` 재호출**: 차트를 `remove()`하고 `createChart()`하면 crosshairMove, visibleLogicalRange 구독이 모두 사라진다. 구독 코드를 `attachMainSubscriptions(chart)` 헬퍼 함수로 분리하고, 1번과 2번 useEffect 모두에서 호출해야 한다.

```typescript
const attachMainSubscriptions = useCallback((chart: IChartApi) => {
  // crosshairMove, visibleLogicalRangeChange 구독 등록
  chart.subscribeCrosshairMove(...);
  chart.timeScale().subscribeVisibleLogicalRangeChange(...);
}, []);

// 1번 useEffect (마운트)
mainChartApi.current = createChart(...);
attachMainSubscriptions(mainChartApi.current);

// 2번 useEffect (오버레이 — 차트 재생성)
mainChartApi.current.remove();
mainChartApi.current = createChart(...);
attachMainSubscriptions(mainChartApi.current); // 재등록 필수
```

### 2-3. 높이 유지 버그 방지

```typescript
// ❌ 잘못된 방식: 하드코딩된 높이
mainChartApi.current = createChart(ref, baseChartOptions(420));

// ✅ 올바른 방식: ref에서 현재 높이 읽기
mainChartApi.current = createChart(ref, baseChartOptions(mainChartHeightRef.current));
```

차트를 재생성하는 useEffect에서 하드코딩된 기본값을 쓰면 드래그로 조절한 높이가 초기화된다. 반드시 `mainChartHeightRef.current`를 참조.

---

## 3. 세로 드래그 리사이즈

```typescript
const MAIN_CHART_DEFAULT_H = 420;
const MAIN_CHART_MIN_H = 180;
const MAIN_CHART_MAX_H = 800;

const mainChartHeightRef = useRef(MAIN_CHART_DEFAULT_H);

const handleMainChartDrag = useCallback((e: React.MouseEvent) => {
  const startY = e.clientY;
  const startH = mainChartHeightRef.current;

  const onMove = (ev: MouseEvent) => {
    const newH = Math.max(MIN, Math.min(MAX, startH + ev.clientY - startY));
    mainChartHeightRef.current = newH;
    mainChartApi.current?.applyOptions({ height: newH }); // LWC 즉시 반영
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}, []);
```

**`mainChartHeightRef`를 쓰는 이유**: `useState`를 쓰면 드래그 중 매 픽셀마다 re-render가 발생해 성능이 저하된다. `applyOptions({ height })`로 LWC에만 직접 반영하고, ref에 값을 보관한다. re-render 없이도 높이가 유지된다.

**드래그 핸들 JSX**:
```jsx
<div
  onMouseDown={handleMainChartDrag}
  className="h-1.5 w-full shrink-0 bg-border hover:bg-accent cursor-row-resize select-none"
/>
```

---

## 4. X축 동기화 (메인 ↔ 서브차트)

메인차트와 서브차트들의 시간 축이 항상 같아야 한다.

```typescript
const isSyncingRef = useRef(false); // 순환 업데이트 방지

// 메인차트 → 서브차트 방향
mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
  if (isSyncingRef.current || !range) return;
  isSyncingRef.current = true;
  subChart1Api.current?.timeScale().setVisibleLogicalRange(range);
  subChart2Api.current?.timeScale().setVisibleLogicalRange(range);
  isSyncingRef.current = false;
});

// 서브차트 → 메인 + 다른 서브차트 방향 (서브차트 useEffect 안에서)
subChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
  if (isSyncingRef.current || !r) return;
  isSyncingRef.current = true;
  mainChartApi.current?.timeScale().setVisibleLogicalRange(r);
  otherSubChartApi.current?.timeScale().setVisibleLogicalRange(r);
  isSyncingRef.current = false;
});
```

`isSyncingRef`로 순환 루프 방지: A → B 업데이트 → B 이벤트 → A 업데이트 → ... 방지.

---

## 5. StackedVolumeChart — LWC 좌표 연동

### 5-1. `timeToCoordinate` 연동

```typescript
// CandleChart.tsx
const timeToCoord = useCallback(
  (time: number) => mainChartApi.current?.timeScale().timeToCoordinate(time as Time) ?? null,
  []
);

// StackedVolumeChart에 전달
<StackedVolumeChart
  candles={klinesData?.candles ?? []}
  aggVolData={aggVolData ?? []}
  timeToCoord={timeToCoord}
/>
```

`timeToCoordinate(time)` 반환값 = 차트 컨테이너 좌측 기준 x픽셀 (float). SVG도 같은 너비의 div 안에 있으므로 이 값이 그대로 SVG x좌표가 된다.

### 5-2. 스크롤/줌 시 자동 갱신

```typescript
// CandleChart.tsx — visibleRange state로 re-render 트리거
const [visibleRange, setVisibleRange] = useState(null);

mainChartApi.current.timeScale().subscribeVisibleLogicalRangeChange(range => {
  if (range) setVisibleRange({ from: range.from, to: range.to });
});
```

스크롤 → `visibleRange` state 변경 → `CandleChart` re-render → `StackedVolumeChart` re-render → `timeToCoord` 재호출 → 최신 x좌표로 SVG 갱신.

> ⚠️ `timeToCoord`를 `useCallback([], [])`으로 만들면 `mainChartApi.current`가 이미 설정된 뒤에도 stable reference를 유지하면서, 호출 시점에 최신 LWC 상태를 읽는다. dependency에 `mainChartApi`를 넣지 않는 이유: ref 자체는 변경되지 않으므로 stable callback이 보장된다.

### 5-3. 데이터 흐름

```typescript
// StackedVolumeChart 내부
const aggVolMap = useMemo(() => {
  const map = new Map<number, AggregatedKline>();
  aggVolData.forEach(k => map.set(k.timestamp, k));
  return map;
}, [aggVolData]); // aggVolData가 바뀔 때만 Map 재생성

// bars는 매 render마다 계산 (memoize 안 함)
// → visibleRange 변경으로 인한 re-render 시 최신 좌표 반영
const bars = candles
  .map(candle => ({ x: timeToCoord(candle.time), candle, aggK: aggVolMap.get(candle.time) }))
  .filter(b => b.x !== null);
```

---

## 6. 서브차트 지표 (MACD, RSI 등)

서브차트는 최대 2개까지 동시에 표시 가능.

```typescript
const subIndicators = activeList.filter(k =>
  ['macd', 'rsi', 'stochRsi', 'obv', 'atr'].includes(k)
);
const sub1 = subIndicators[0];
const sub2 = subIndicators[1];
```

각 서브차트는 지표가 활성화될 때 `createChart()` 호출, 비활성화되면 `remove()` 호출. 지표 변경 시 차트 재생성.

**NaN 처리**:
```typescript
// null 대신 NaN 사용 → LWC가 해당 포인트만 건너뜀
// 전체 데이터 포인트 수가 유지되어 X축 logical index가 메인차트와 일치
s.setData(data.rsi.map((v, i) => ({ time: times[i], value: v ?? NaN })));
```

---

## 7. 데이터 페칭 구조

```typescript
// 캔들 데이터 (30초마다 갱신)
useQuery({
  queryKey: ['klines', symbol, timeframe],
  queryFn: () => fetchKlines(symbol, timeframe, 500),
  refetchInterval: 30000,
});

// 기술 지표 (활성 지표가 있을 때만)
useQuery({
  queryKey: ['indicators', symbol, timeframe, activeList],
  queryFn: () => fetchIndicators(symbol, timeframe, activeList, 500),
  enabled: activeList.length > 0,
  refetchInterval: 30000,
});

// 집계 거래량 (60초마다, 30초 stale)
useQuery({
  queryKey: ['agg-volume', stdSymbol, timeframe],
  queryFn: () => fetchAggregatedVolume(stdSymbol, timeframe, 500, true), // dex=true
  refetchInterval: 60000,
  staleTime: 30000,
});
```

**표준 심볼 변환** (집계 거래량 요청용):
```typescript
const stdSymbol = symbol.endsWith('USDT')
  ? `${symbol.slice(0, -4)}/USDT`  // BTCUSDT → BTC/USDT
  : symbol;
```

---

## 8. 하이킨아시 변환

백엔드에서 계산된 하이킨아시 캔들을 그대로 사용한다. `candleType === 'heikinashi'` 시 `klinesData.heikinAshi`를 LWC에 set.

하이킨아시 반전 마커:
```typescript
(klinesData.heikinAshi as HeikinAshiCandle[]).forEach(c => {
  if (c.isReversal === 'bearish') markers.push({ position: 'aboveBar', shape: 'arrowDown', ... });
  if (c.isReversal === 'bullish') markers.push({ position: 'belowBar', shape: 'arrowUp', ... });
});
```

---

## 9. Zustand 전역 상태 (`store.ts`)

| 상태 | 타입 | 설명 |
|------|------|------|
| `symbol` | `string` | 현재 코인 (예: `'BTCUSDT'`) |
| `timeframe` | `Timeframe` | 현재 타임프레임 |
| `candleType` | `'normal' \| 'heikinashi'` | 캔들 종류 |
| `indicators` | `ActiveIndicators` | 각 지표 on/off 상태 |
| `showPatterns` | `boolean` | 패턴 마커 표시 여부 (현재 UI 비노출) |
| `viewMode` | `'chart' \| 'rankings'` | 메인 뷰 전환 |

`indicators` 구조:
```typescript
interface ActiveIndicators {
  bb: boolean; ema20: boolean; ema50: boolean; ema200: boolean;
  macd: boolean; rsi: boolean; stochRsi: boolean; obv: boolean; atr: boolean;
}
```

---

## 10. 알려진 함정 모음

### ❌ `aggVolMap.current`를 prop으로 전달
mutable ref를 prop으로 넘기면 React가 변경을 감지 못한다. ref 내부 값이 바뀌어도 re-render 없이 stale 데이터가 사용된다.
→ **해결**: 실제 데이터 배열(`aggVolData`)을 prop으로 전달, 컴포넌트 내부에서 Map 생성.

### ❌ 드래그 후 차트 재생성 시 높이 초기화
오버레이 지표 변경 시 차트를 재생성하면서 `baseChartOptions(420)`처럼 하드코딩된 높이를 쓰면 드래그 높이가 리셋된다.
→ **해결**: `baseChartOptions(mainChartHeightRef.current)`.

### ❌ 서브차트 추가 후 X축 동기화 누락
서브차트를 새로 생성할 때 현재 메인차트의 visibleLogicalRange를 적용하지 않으면 보이는 범위가 달라진다.
```typescript
const range = mainChartApi.current?.timeScale().getVisibleLogicalRange();
if (range) chart.timeScale().setVisibleLogicalRange(range);
```

### ❌ `Set` iteration TypeScript 오류
`for (const item of mySet)` 구문은 `--downlevelIteration` 설정 없이 TS 오류 발생.
→ **해결**: `Array.from(mySet)` 사용.

### ❌ LWC에 같은 time 중복 데이터 전달
LWC는 time이 중복되면 오류를 발생시킨다. 데이터를 set하기 전 반드시 오름차순 정렬 및 중복 제거.

### ✅ 서브차트 NaN vs null
LWC에 null을 전달하면 차트 전체가 이상하게 동작할 수 있다. 빈 값은 반드시 `NaN`으로 전달하면 해당 포인트만 건너뛰고 나머지는 정상 표시.

### ❌ 서브차트 `fitContent()` 후 `setVisibleLogicalRange` 경쟁 조건
`renderSubChart` 마지막에 `fitContent()`를 호출하면 LWC가 내부적으로 비동기 렌더를 스케줄한다.  
그 직후 바로 `setVisibleLogicalRange(range)`를 호출하면 fitContent의 비동기 작업에 의해 range가 덮어씌워져 싱크가 맞지 않는다.
→ **해결**: rAF **내부**에서 range를 읽고 적용. (rAF 밖에서 읽은 뒤 rAF 안에서 적용하면 stale range가 들어갈 수 있다)
```typescript
// ❌ rAF 밖에서 range 읽기 — fitContent 이전의 stale range일 수 있음
const range = mainChartApi.current?.timeScale().getVisibleLogicalRange();
requestAnimationFrame(() => chart.timeScale().setVisibleLogicalRange(range));

// ✅ rAF 내부에서 range 읽기 — fitContent 완료 이후 정확한 range 획득
requestAnimationFrame(() => {
  const range = mainChartApi.current?.timeScale().getVisibleLogicalRange();
  if (range) chart.timeScale().setVisibleLogicalRange(range);
});
```

### ❌ 오버레이 지표 useEffect가 차트 재생성 후 crosshair 구독 소실
인디케이터 useEffect(`[indData, indicators.bb, ...]`)는 메인 차트를 `remove()` 후 재생성한다. 이 때 마운트 useEffect(`[]`)에서 등록한 `subscribeCrosshairMove` 구독이 소실된다. 이후 크로스헤어가 서브차트·SVG에 전파되지 않고, 거래소 분포 툴팁도 동작하지 않는다.  
→ **해결**: 구독 코드를 `attachMainSubscriptions(chart)` 헬퍼로 추출하고, 마운트 useEffect와 인디케이터 useEffect 양쪽에서 모두 호출.

### ❌ OBV price scale 폭 차이로 bars x좌표 불일치
OBV 값(수십억 단위)은 price scale 자동 폭이 메인차트보다 훨씬 넓어진다. 같은 logical range를 설정해도 차트 컨텐츠 영역 폭이 달라져 bars x좌표가 어긋난다.  
→ **해결**: `rightPriceScale.width: 80` 고정 + OBV series에 `priceFormat: { type: 'volume' }` 추가.

### ❌ 서브차트에 메인차트 crosshair 옵션 그대로 사용
`baseChartOptions`를 서브차트에 그대로 쓰면 horizontal crosshair line이 나타나 가격 스케일과 겹쳐 혼란스럽다.  
서브차트는 시간 축 동기화가 목적이므로 vertical line만 있으면 된다.
→ **해결**: 별도 `subChartOptions` 함수를 만들어 `horzLine.visible: false, labelVisible: false` 설정.
```typescript
const subChartOptions = (height: number) => ({
  ...baseChartOptions(height),
  crosshair: {
    mode: CrosshairMode.Normal,
    horzLine: { visible: false, labelVisible: false },
  },
});
```

---

## 11. 크로스헤어 전파 (모든 차트 간 동기화)

메인차트, 서브차트, 거래량 SVG 사이에서 마우스 hover 시 크로스헤어가 모든 차트에 전파된다.

### 11-1. 구조

```
메인차트 hover → setCrosshairPosition(0, time, series) → 서브차트1, 서브차트2
                → setCrosshairX(param.point.x) → 거래량 SVG vertical line

서브차트 hover → setCrosshairPosition(price, time, candleSeries) → 메인차트
                → setCrosshairPosition(0, time, series) → 다른 서브차트
                → timeToCoordinate(time) → setCrosshairX → 거래량 SVG

거래량 SVG hover → onCrosshairChange(time) → setCrosshairPosition → 모든 LWC 차트
                 → timeToCoordinate(time) → setCrosshairX → 자신의 vertical line
```

### 11-2. LWC API

```typescript
// 서브차트에 크로스헤어 표시 (수평선은 subChartOptions에서 숨겼으므로 price=0 OK)
subChart1Api.current.setCrosshairPosition(0, param.time, subChart1SeriesRef.current);

// 크로스헤어 제거
subChart1Api.current.clearCrosshairPosition();
```

`setCrosshairPosition`은 `subscribeCrosshairMove` 콜백을 **동기적으로** 트리거한다. `crosshairSyncRef` 플래그로 순환 방지 필수.

```typescript
const crosshairSyncRef = useRef(false);

// 크로스헤어 이벤트 핸들러 내
if (crosshairSyncRef.current) return;
crosshairSyncRef.current = true;
// ... 다른 차트에 setCrosshairPosition 호출 ...
crosshairSyncRef.current = false;
```

### 11-3. 거래량 SVG ↔ LWC 좌표 일치

`timeToCoordinate(time)` 반환값과 `param.point.x`는 동일한 좌표계다 (차트 컨테이너 좌측 기준). SVG도 같은 너비의 부모 div 안에 있으므로 `crosshairX` 값을 SVG `<line x1={crosshairX}>` 에 그대로 쓸 수 있다.

```typescript
// 서브차트 hover 시 SVG crosshairX 갱신
const x = mainChartApi.current?.timeScale().timeToCoordinate(param.time as Time) ?? null;
setCrosshairX(x);

// 메인차트 hover 시 SVG crosshairX 갱신
setCrosshairX(param.point?.x ?? null);
```

### 11-4. OBV price scale 폭 맞추기

OBV 값은 매우 커서 price scale 자동 폭이 넓어지면 bars x좌표가 메인차트와 어긋난다.

```typescript
// ❌ 자동 폭 → 차트마다 다른 price scale 폭 → bars x좌표 불일치
rightPriceScale: { borderColor: GRID_COLOR }

// ✅ 고정 폭 + OBV 값 축약
rightPriceScale: { borderColor: GRID_COLOR, width: 80 }  // 모든 차트 동일

// OBV 시리즈에 volume format 추가 → "1.23B" 식으로 축약 → 80px 안에 맞춤
chart.addLineSeries({ priceFormat: { type: 'volume' } });
```

---

## 12. 서브차트 추가/수정 체크리스트

서브차트 관련 코드를 건드릴 때 반드시 확인:

- [ ] 서브차트 생성 시 `subChartOptions` 사용 (`baseChartOptions` 아님)
- [ ] `renderSubChart`가 primary series를 **return** 하는지, ref에 저장하는지 확인 (크로스헤어 전파에 필요)
- [ ] `setVisibleLogicalRange`는 rAF **내부**에서 range 읽고 적용 (`requestAnimationFrame(() => { const range = ...; ... })`)
- [ ] 서브차트 useEffect 안에 `subscribeCrosshairMove` + `subscribeVisibleLogicalRangeChange` 모두 등록
- [ ] LWC에 전달하는 빈 값은 `null` 아닌 `NaN`
- [ ] times 배열과 value 배열의 길이가 일치하는지 확인
- [ ] 서브차트 제거 시 `chart.remove()` + api ref + series ref 모두 `null` 초기화

---

## 13. 차트 수정 전 공통 체크리스트

LWC 관련 코드를 수정하기 전에 확인:

- [ ] 차트를 재생성(`remove` + `createChart`)하는 useEffect라면 `attachMainSubscriptions(chart)` **재호출**했는가
- [ ] 재생성 useEffect에서 `baseChartOptions`에 하드코딩된 높이 대신 `mainChartHeightRef.current` 사용했는가
- [ ] mutable ref를 prop으로 전달하지 않았는가 (대신 실제 데이터 배열 전달)
- [ ] 서브차트가 새로 생성될 때 rAF 내부에서 메인 차트 range를 읽어 적용했는가
- [ ] 새 거래소 색상 키가 소문자인가 (백엔드 응답이 소문자)
- [ ] `crosshairSyncRef` 플래그로 크로스헤어 순환 업데이트 막았는가
