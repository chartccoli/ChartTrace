# 시총 순위 변동 차트 (RankCompareView) — 기술 문서

> 작성일: 2026-04-25  
> 관련 파일:  
> - `backend/src/routes/rankings.ts`  
> - `frontend/components/chart/RankCompareView.tsx`  
> - `frontend/lib/coingecko.ts`

---

## 1. 시스템 개요

암호화폐 시총 순위의 역사적 변동을 **SVG 범프 차트(bump chart)**로 시각화하는 컴포넌트다.  
각 코인이 시간에 따라 순위가 어떻게 오르내렸는지를 선의 흐름으로 보여준다.

**주요 기능**
- 1~100위를 25 단위 구간으로 분리해서 보기
- L1/L2/DeFi/AI/Meme/게임/ISO20022/Privacy 섹터별 필터링 (섹터 내 상대 순위 재산정)
- 30일 / 90일 / 180일 시간 범위 선택
- 코인 호버 시 하이라이트 + 델타(▲▼) 표시

---

## 2. 아키텍처 개요

```
CoinGecko API
     │
     ▼
[Backend: rankings.ts]
  Phase 1 Seed ──────────────────── 서버 시작 시 1회
  Phase 2 Seed (daily market_chart) ─ Phase 1 직후 백그라운드
  autoSnapshot ──────────────────── 10분마다 반복
  File persistence ───────────────── autoSnapshot마다 저장
     │
     │  HTTP GET /api/rankings/history-batch?symbols=...
     ▼
[Frontend: RankCompareView.tsx]
  React Query (staleTime 5분)
  computeSectorRanks()
  BumpChartFull (SVG)
```

---

## 3. 백엔드 상세 (`rankings.ts`)

### 3-1. 인메모리 스토어

```typescript
const rankHistory: Record<string, { rank: number; timestamp: number }[]> = {};
```

- 키: `"BTCUSDT"`, `"ETHUSDT"` 등 Binance 심볼 형태 (심볼 + "USDT")
- 값: `{ rank, timestamp(초) }` 배열, 타임스탬프 오름차순 정렬 유지
- `MAX_HISTORY_POINTS = 26000` (180일 × 144회/일 기준)

---

### 3-2. Phase 1 시드 (`seedRankHistory`)

**목적**: 서버가 처음 켜졌을 때 역산 공식으로 과거 데이터를 즉시 복원.

**호출 타이밍**: 서버 시작 3초 후 1회. `seeded` 플래그로 중복 방지.

**동작 원리**  
CoinGecko `/coins/markets`에 `price_change_percentage: '1h,24h,7d,14d,30d,200d,1y'`를 요청하면 각 코인의 변동률이 담겨 온다. 이 값으로 과거 시총을 역산할 수 있다.

```
과거 시총 = 현재 시총 ÷ (1 + 변동률/100)
```

각 변동률 필드로 얻을 수 있는 시점:

| 필드 | 시점 |
|------|------|
| `price_change_percentage_1y_in_currency` | 1년 전 |
| `price_change_percentage_200d_in_currency` | 200일 전 |
| `price_change_percentage_30d_in_currency` | 30일 전 |
| `price_change_percentage_14d_in_currency` | 14일 전 |
| `price_change_percentage_7d_in_currency` | 7일 전 |
| `price_change_percentage_24h_in_currency` | 24시간 전 |
| `price_change_percentage_1h_in_currency` | 1시간 전 |

각 시점에서 모든 코인의 역산 시총을 내림차순 정렬하면 그 시점의 상대 순위를 구할 수 있다.

**제약사항**  
- CoinGecko는 `200d` 필드를 모든 코인에 반환하지 않는다 (신생 코인, 비주류 코인은 null).
- 30일과 200일 사이 구간 (31~199일)은 이 배치 API로 복원할 수 없다 → Phase 2가 필요한 이유.

**429 대응**: 최대 5회 재시도, 90초 대기.

**종료 후 작업**:
1. `rankings:1:50`, `rankings:1:100`, `rankings:1:200` 캐시 사전 채우기 (프론트가 시작하자마자 캐시 히트)
2. Phase 2를 non-blocking으로 실행 (`.catch`로 에러 처리)

---

### 3-3. Phase 2 시드 (`seedPhase2`)

**목적**: Phase 1이 커버하지 못하는 0~200일 구간 전체를 일별 해상도로 채운다.

**왜 필요한가**  
Phase 1은 7개 시점의 스냅샷만 제공한다. 30일과 200일 사이에 아무 데이터가 없으면 차트 선이 끊기거나 해상도가 극히 낮아진다. 또한 최근 30일도 6개 포인트(30d, 14d, 7d, 24h, 1h, now)뿐이라 일별 데이터(~30포인트)보다 훨씬 성기다.

**동작 원리**  
1. Phase 2 대상 코인 선정: `rankHistory[sym]`의 30~210일 구간 포인트가 30개 미만인 코인 (dense 데이터가 없는 코인)
2. 각 코인에 대해 `/coins/{id}/market_chart?days=200&interval=daily` 호출 → 일별 시총 배열 (~200개 포인트)
3. 모든 코인 fetch 완료 후, 날짜별로 묶어 시총 내림차순 정렬 → 상대 순위 산정
4. `rankHistory`에 삽입 (36시간 이내 중복 방지)

**Skip 조건 (스마트 캐시)**  
```typescript
const midRangeCount = (rankHistory[sym] ?? [])
  .filter(p => p.timestamp > phase2Lo && p.timestamp < phase2Hi).length;
return midRangeCount < 30; // dense 데이터 이미 있으면 skip
```
파일에서 로드된 dense 히스토리가 있으면 해당 코인은 API 호출 없이 건너뜀.  
→ 최초 실행: 170코인 전체 fetch (~7분)  
→ 재시작: 이미 dense 데이터 있으므로 대부분 skip (수초 내 완료)

**rate limit 대응**  
- API 키 있을 때: 2.5초 간격 (Demo 30req/min 안전권)
- API 키 없을 때: 4초 간격
- 429 응답: 90초 대기 후 같은 코인 재시도

> ⚠️ **중요한 함정 (과거 실수)**  
> Phase 1이 `rankHistory`에 200d 앵커 포인트를 추가한 *후에* Phase 2 skip 조건을 체크한다.  
> 초기 구현은 "90일 이상 된 포인트가 하나라도 있으면 skip"으로 했는데, Phase 1의 200d 포인트(200일 전)가 이 조건을 만족시켜 사실상 모든 코인이 Phase 2를 건너뛰었다.  
> 올바른 조건은 **특정 구간에 포인트가 충분히 많은지(dense)** 를 확인하는 것이다.

---

### 3-4. autoSnapshot

**목적**: 서버가 켜져 있는 동안 10분마다 현재 순위를 기록해 실시간 히스토리를 축적.

**동작**: 서버 시작 10분 후부터, 10분마다 `/coins/markets?per_page=200` 호출 → `snapshotRanks()` → 캐시 갱신 → 파일 저장.

**왜 별도로 필요한가**  
프론트의 `CoinList` 컴포넌트는 top 50만 fetch한다. 51~200위 코인은 사용자가 순위 페이지를 열지 않으면 `snapshotRanks`가 자동으로 호출되지 않는다. `autoSnapshot`이 없으면 51~200위 코인의 최신 데이터가 업데이트되지 않아 차트 오른쪽 끝 선이 끊겨 보인다.

---

### 3-5. 파일 영속성

```
backend/data/rank-history.json
```

- `saveRankHistory()`: `autoSnapshot` 완료 후 호출. rankHistory 전체를 JSON으로 직렬화.
- `loadRankHistory()`: 서버 시작 시 `seedRankHistory()` 보다 **먼저** 호출. 파일이 없으면 조용히 무시.
- `backend/.gitignore`에 `data/` 포함 (커밋하지 않음, 각 환경에서 독립적으로 축적)

**효과**: Phase 2의 ~7분 소요 시간이 최초 1회 이후엔 수초로 줄어든다. 서버를 재시작해도 180일 히스토리가 보존된다.

> ⚠️ `data/rank-history.json`이 오염된 경우(sparse 데이터 저장됨 등) 파일 삭제 후 재시작하면 된다.  
> 삭제 명령: `rm backend/data/rank-history.json`

---

### 3-6. CoinGecko API Key 설정

```
backend/.env
COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxxxx
```

- `CG-`로 시작 → Demo 키 (`x-cg-demo-api-key` 헤더) — 무료, 30req/min
- 기타 형태 → Pro 키 (`x-cg-pro-api-key` 헤더) — 유료, 500req/min
- 키 없이도 동작하나 공개 API (5~10req/min)는 Phase 2에서 429가 자주 발생함

Demo 키 발급: https://www.coingecko.com/en/developers/dashboard (무료 회원가입)

> ⚠️ `--env-file=.env` Node 플래그는 `NODE_OPTIONS`에서 허용되지 않는다.  
> 반드시 `dotenv/config`를 index.ts 맨 첫 줄에서 import하는 방식을 사용한다.

---

### 3-7. SKIP_STORE (스테이블/래핑 코인 제외)

```typescript
const SKIP_STORE = new Set([
  'USDT','USDC','DAI','BUSD',... // 스테이블코인
  'STETH','WBTC','WETH',...      // 래핑 토큰
]);
```

순위 차트에서 스테이블코인과 래핑 토큰은 의미 있는 순위 변동이 없으므로 rankHistory 저장 및 Phase 2 대상에서 제외. **모듈 레벨**에 선언되어 seed/phase2/snapshot 모두 공유한다.

---

### 3-8. API 라우트 요약

| 라우트 | 설명 |
|--------|------|
| `GET /api/rankings` | CoinGecko 코인 목록 (캐시 5분, 429시 fallback) |
| `GET /api/rankings/history/:symbol` | 단일 심볼 rankHistory 반환 |
| `GET /api/rankings/history-batch?symbols=` | 복수 심볼 일괄 반환 (최대 100개) |
| `GET /api/rankings/price-history/:coinId` | CoinGecko market_chart (가격/시총) |

---

## 4. 프론트엔드 상세 (`RankCompareView.tsx`)

### 4-1. 시간 범위 (TIME_RANGES)

```typescript
const TIME_RANGES = [
  { days: 30,  windowDays: 32  },
  { days: 90,  windowDays: 93  },
  { days: 180, windowDays: 210 },
];
```

`windowDays`는 실제 X축 범위. `180일` 탭은 `windowDays: 210`을 써서 Phase 1의 200d 앵커 포인트도 창 안에 포함시킨다.

```typescript
const rangeMinTime = now - tr.windowDays * 24 * 3600; // 초 단위
```

차트에서 `timestamp >= rangeMinTime`인 포인트만 표시.

---

### 4-2. 순위 범위 (RANK_RANGES)

```typescript
const RANK_RANGES = [
  { id: '1-25',   lo: 1,  hi: 25  },
  { id: '26-50',  lo: 26, hi: 50  },
  { id: '51-75',  lo: 51, hi: 75  },
  { id: '76-100', lo: 76, hi: 100 },
];
```

> 처음엔 1~20 / 21~50 / 51~100 구간이었으나, 21~50 구간이 너무 촘촘하다는 피드백으로 25단위 균등 구간으로 변경.

---

### 4-3. 섹터 정의 (SECTORS)

```typescript
const SECTORS = {
  'L1':       ['BTC','ETH','BNB','XRP','SOL', ...],
  'L2':       ['POL','OP','ARB','IMX','STX', ...],
  'DeFi':     ['UNI','AAVE','MKR','CRV', ...],
  'AI':       ['FET','RENDER','TAO','WLD', ...],
  'Meme':     ['DOGE','SHIB','PEPE','BONK', ...],
  '게임':      ['AXS','SAND','MANA', ...],
  'ISO20022': ['XRP','XLM','HBAR','ALGO','QNT','XDC','IOTA'],
  'Privacy':  ['XMR','ZEC','DASH','SCRT','ROSE', ...],
};
```

섹터 모드일 때 `rankings(1, 200)`을 fetch한다 (순위 모드는 100). L2, AI 등 중간 순위 코인이 top 100에 없을 수 있기 때문.

---

### 4-4. 섹터 내 상대 순위 계산 (`computeSectorRanks`)

섹터 모드에서는 글로벌 순위가 아닌 섹터 내 순위로 재산정한다.

```
알고리즘:
1. 섹터 코인들의 모든 타임스탬프를 수집
2. 각 타임스탬프에서 해당 코인들의 글로벌 순위를 가져옴
3. 글로벌 순위 오름차순 정렬 → 섹터 내 순위(1, 2, 3...) 부여
4. rankHistory 대신 이 재산정된 순위를 차트에 사용
```

> ⚠️ `for (const ts of tsSet)` 구문은 TypeScript의 `--downlevelIteration` 없이 컴파일 오류 발생.  
> `Array.from(tsSet)` 으로 변환해서 사용해야 한다.

---

### 4-5. BumpChartFull (SVG 차트)

**레이아웃 상수**
```typescript
const PAD = { left: 40, right: 112, top: 20, bottom: 28 };
const VW = 960, VH = 460;
```

**Y축**: 현재 표시 중인 코인들의 순위 범위에 맞게 동적 계산.  
```typescript
const loRank = Math.max(1, Math.min(...currentRanks) - 1);
const hiRank = Math.min(105, Math.max(...currentRanks) + 3);
```

**X축**: `rangeMinTime`부터 `now`까지 선형 매핑.  
```typescript
const toX = (ts) => PAD.left + ((ts - rangeMinTime) / (now - rangeMinTime)) * IW;
```

**라벨 충돌 방지**: 오른쪽 심볼 라벨이 겹치지 않도록 `MIN_GAP = 11px` 간격 강제.

**smoothPath**: 각 포인트를 bezier 곡선으로 연결 (cubic bezier, 제어점은 이전/현재 점의 X 중간값).

**visible 필터**: Y축 범위를 벗어난 포인트는 렌더링하지 않음.  
```typescript
const visible = pts.filter(p => p.rank >= loRank - 2 && p.rank <= hiRank + 2);
if (visible.length < 2) return null; // 선 대신 null
```

---

## 5. 데이터 흐름 전체

```
1. 서버 시작
   └─ loadRankHistory() ─── 파일 있으면 메모리에 로드
   └─ seedRankHistory() ─── CoinGecko 배치 API (1회, 최대 5회 재시도)
       ├─ Phase 1: 7개 시점 역산 → rankHistory 초기화
       ├─ 캐시 사전 채우기 (rankings:1:50/100/200)
       └─ seedPhase2() ─── 백그라운드 실행 (non-blocking)
           └─ 코인별 market_chart 200d 일별 데이터 fetch
           └─ 날짜별 시총 정렬 → rankHistory에 daily 포인트 삽입
   └─ startAutoSnapshot() ─ 10분 후부터 10분마다 반복
       └─ snapshotRanks() + 캐시 갱신 + saveRankHistory()

2. 프론트엔드 접속
   └─ useQuery(['rankings', 1, 100/200])
       └─ GET /api/rankings → 캐시 히트 (seed가 사전 채움)
   └─ useQuery(['rank-history-batch', symbols])
       └─ GET /api/rankings/history-batch?symbols=BTCUSDT,ETHUSDT,...
       └─ rankHistory에서 직접 반환 (DB 없음, 순수 인메모리)

3. 차트 렌더링
   └─ filterMode === 'sector' → computeSectorRanks()
   └─ BumpChartFull에 histories + rangeMinTime 전달
   └─ SVG 렌더링
```

---

## 6. 알려진 제약사항

### 6-1. 서버 메모리에만 존재
`rankHistory`는 프로세스 메모리에 있다. `data/rank-history.json`으로 영속화하지만 파일이 없거나 손상되면 Phase 2 완료까지 (~7분) 히스토리가 비어있다.

### 6-2. 섹터 순위의 상대성
섹터 모드 순위는 섹터 정의 코인 중 top 200에 있는 것끼리만 비교한 상대 순위다. 어떤 날 섹터 코인 중 절반만 데이터가 있으면 그 절반 안에서의 순위가 된다.

### 6-3. 코인 추가/제거 시
`SECTORS` 정의와 `SKIP_STORE`는 코드에 하드코딩되어 있다. 새로운 코인을 추가하거나 섹터를 바꾸려면 코드 수정이 필요하다.

### 6-4. Phase 2 순위의 정확도
Phase 2의 일별 순위는 fetch한 ~170개 코인 안에서의 상대 순위다. 실제 글로벌 top 200 순위와 1~5위 차이가 있을 수 있다 (스테이블코인 제외 효과 등).

### 6-5. CoinGecko 무료 API 한계
`200d` 변동률 필드는 일부 코인(신생·비주류)에서 null이다. Phase 2가 이를 보완하지만, 상장한 지 200일 미만인 코인은 전체 히스토리를 복원할 수 없다.

---

## 7. 시행착오에서 배운 것들

### ❌ 스파크라인 방식 금지
처음엔 CoinGecko의 `sparkline_in_7d` 필드로 7일 미니 차트를 그리려 했으나, 해상도가 너무 낮고 데이터 형식이 변동률과 달라 버렸다. 역산 공식 방식으로 전환.

### ❌ Phase 2 skip 로직의 함정
"90일 이상 된 포인트가 있으면 skip"이라는 조건은 Phase 1의 200d 앵커 포인트에 의해 항상 참이 되어 Phase 2가 사실상 작동하지 않았다. 올바른 조건은 "30~210일 구간에 30개 이상 포인트가 있는가(dense)"다.

### ❌ thirtyDaysAgo 스킵 실수
Phase 2에서 최근 30일 데이터를 "Phase 1이 커버한다"는 이유로 skip했다. 하지만 Phase 1은 최근 30일에 6개 포인트뿐이고, Phase 2의 일별 데이터는 30개 포인트를 준다. 결과적으로 30~180일 구간이 오히려 0~30일보다 해상도가 높아지는 역전 현상이 발생했다.

### ❌ 캐시 키 충돌로 인한 startup 429
프론트가 `per_page=50`, `per_page=100`, `per_page=200`으로 각각 요청하는데, seed 완료 전에 세 요청이 동시에 들어오면 세 번의 CoinGecko 호출이 발생한다. 해결: seed 완료 직후 세 캐시 키를 모두 사전 채운다.

### ❌ L2 섹터에 코인이 3개만 나타남
섹터 모드에서 top 100만 사용했더니 L2 코인 대부분이 100위 밖이어서 표시되지 않았다. 섹터 모드는 top 200을 fetch하도록 수정.

### ❌ 일부 선이 "현재" 지점에 닿지 않음
`autoSnapshot`이 top 50 기반 CoinList 컴포넌트에 의존했기 때문에 51~200위 코인은 사용자가 페이지를 열어야만 갱신됐다. 별도 `autoSnapshot` 타이머를 서버 측에서 직접 실행하도록 수정.

### ✅ 역산 공식의 정확성
`histMC = currentMC / (1 + changePct/100)` — 이 공식은 수학적으로 정확하다. 단, `divisor <= 0`이거나 `Infinity`인 경우(극단적 변동률)를 필터링해야 한다.

### ✅ MAX_HISTORY_POINTS로 메모리 제어
무제한으로 쌓으면 메모리 부족. 26,000포인트(180일 × 144회/일)로 제한하고 오래된 것부터 trim.

---

## 8. 유지보수 가이드

### 서버 재시작 시
```bash
# 정상 재시작 (데이터 보존)
cd backend && npm run dev

# Dense 데이터 재생성 필요 시 (파일 손상 등)
rm backend/data/rank-history.json
cd backend && npm run dev
# Phase 2 완료까지 ~7분 대기
```

### 섹터 코인 추가/수정
`frontend/components/chart/RankCompareView.tsx` 상단 `SECTORS` 객체를 수정.  
심볼은 CoinGecko 심볼 기준 (대문자, USDT 제외).

### 스테이블코인 필터 업데이트
새로운 스테이블코인이 top 200에 진입하면:  
- `backend/src/routes/rankings.ts`의 `SKIP_STORE`에 추가  
- `frontend/components/chart/RankCompareView.tsx`의 `STABLECOINS`에 추가

### API 키 만료/변경
`backend/.env`의 `COINGECKO_API_KEY` 값만 교체 후 서버 재시작.

### 시간 범위 추가 (예: 365일)
1. `TIME_RANGES`에 `{ days: 365, windowDays: 380 }` 추가
2. Phase 1 seed의 `1y` 포인트가 365일 전 데이터를 제공하므로 별도 API 변경 불필요
3. Phase 2의 `days: 200` 파라미터를 늘려야 360일 구간을 채울 수 있음 (현재는 200일 한계)

---

## 9. 환경 설정 체크리스트

```bash
# backend/.env
PORT=4000
COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxxxx   # coingecko.com/en/developers에서 무료 발급

# backend/.gitignore 확인
node_modules/
dist/
.env          # API 키 보호
data/         # 런타임 데이터, 커밋 불필요
```

```bash
# 처음 실행 순서
cd backend && npm install
cd backend && npm run dev

# 기대 로그
[CoinGecko] API key loaded: CG-xxxxx...
[rankHistory] No saved file — starting fresh
[seed] Fetching top 200 with price_change_percentage (attempt 1/5)...
[seed] Complete — 189 coins, 8 data points
[seed] Starting phase 2 for 170 coins...
[seed:p2] Fetching 200d daily market_chart for 170 coins...
[seed:p2] 10/170 done
...
[seed:p2] Complete — 29XXX daily rank points added
```
