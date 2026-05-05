import { Router, Request, Response } from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import fs   from 'fs';
import path from 'path';

const router = Router();
const cache = new NodeCache({ stdTTL: 300 });

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// CoinGecko API Key (Demo: CG-xxx 무료, Pro: 유료)
const cgApiKey = process.env.COINGECKO_API_KEY;
const cgHeaders: Record<string, string> = cgApiKey
  ? { [cgApiKey.startsWith('CG-') ? 'x-cg-demo-api-key' : 'x-cg-pro-api-key']: cgApiKey }
  : {};
const cgAxios = axios.create({ baseURL: COINGECKO_BASE, headers: cgHeaders });
if (cgApiKey) console.log('[CoinGecko] API key loaded:', cgApiKey.slice(0, 8) + '...');

const PHASE2_DELAY_MS = cgApiKey ? 2500 : 4000; // Demo 30req/min → 2.5s 간격으로 충분

// ─── 순위 히스토리 인메모리 스토어 ──────────────────────────────────────────
const rankHistory: Record<string, { rank: number; timestamp: number }[]> = {};
const MAX_HISTORY_POINTS = 26000; // 180일 × 144포인트/일 (10분당 1회 기준)

function snapshotRanks(coins: { symbol: string; market_cap_rank: number }[]) {
  const ts = Math.floor(Date.now() / 1000);
  for (const coin of coins) {
    const sym = coin.symbol.toUpperCase() + 'USDT';
    if (!rankHistory[sym]) rankHistory[sym] = [];
    // 동일 타임스탬프 중복 방지 (±10분 이내)
    const last = rankHistory[sym][rankHistory[sym].length - 1];
    if (last && ts - last.timestamp < 600) continue;
    rankHistory[sym].push({ rank: coin.market_cap_rank, timestamp: ts });
    if (rankHistory[sym].length > MAX_HISTORY_POINTS) {
      rankHistory[sym] = rankHistory[sym].slice(-MAX_HISTORY_POINTS);
    }
  }
}

// ─── 파일 영속성 ─────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, '../../data');
const HIST_FILE = path.join(DATA_DIR, 'rank-history.json');

export function loadRankHistory(): void {
  try {
    if (!fs.existsSync(HIST_FILE)) {
      console.log('[rankHistory] No saved file — starting fresh');
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(HIST_FILE, 'utf-8')) as typeof rankHistory;
    for (const [sym, pts] of Object.entries(parsed)) rankHistory[sym] = pts;
    const total = Object.values(rankHistory).reduce((s, v) => s + v.length, 0);
    console.log(`[rankHistory] Loaded ${Object.keys(rankHistory).length} coins, ${total} points`);
  } catch (err: any) {
    console.error('[rankHistory] Load failed:', err.message);
  }
}

function saveRankHistory(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HIST_FILE, JSON.stringify(rankHistory), 'utf-8');
  } catch (err: any) {
    console.error('[rankHistory] Save failed:', err.message);
  }
}

// ─── 스테이블·래핑 코인 제외 목록 (모듈 레벨 — seed/phase2/snapshot 공유) ──────
const SKIP_STORE = new Set([
  'USDT','USDC','DAI','BUSD','TUSD','FDUSD','PYUSD','FRAX','USDP','USDS','USDB',
  'GUSD','LUSD','USDD','USTC','SUSD','EURS','CRVUSD','USDE','SUSDE',
  'STETH','WBTC','WETH','WBETH','WEETH','RETH','CBBTC','BSDETH',
]);

// ─── Seed Phase 2: 200d 데이터 없는 코인들의 market_chart 개별 fetch ────────
// Phase 1의 price_change_percentage 배치 호출에서 200d 필드가 null인 코인들을
// 개별 market_chart(200일) API로 보완한다.
// 60d/90d/150d/200d 네 시점의 시총을 추출해 상대 순위를 산정하고 rankHistory에 저장.
// 4초 간격 → CoinGecko 무료 API rate limit(~15 req/min) 안전권
async function seedPhase2(
  phase2Coins: { id: string; symbol: string }[],
  phase1McAt200d: { sym: string; mc: number }[],
) {
  if (phase2Coins.length === 0) {
    console.log('[seed:p2] No coins need phase2, skipping');
    return;
  }
  console.log(`[seed:p2] Fetching 200d daily market_chart for ${phase2Coins.length} coins...`);

  // sym → 일별 { day(초, 하루 단위 반올림), mc } 배열
  const p2Daily: Record<string, { day: number; mc: number }[]> = {};

  let i = 0;
  while (i < phase2Coins.length) {
    const coin = phase2Coins[i];
    try {
      const { data } = await cgAxios.get(`/coins/${coin.id}/market_chart`, {
        params: { vs_currency: 'usd', days: 200, interval: 'daily' },
        timeout: 15000,
      });

      const sym  = coin.symbol.toUpperCase() + 'USDT';
      const caps = data.market_caps as [number, number][] | undefined;

      if (caps && caps.length > 0) {
        const DAY_SEC = 24 * 3600;
        p2Daily[sym] = caps
          .filter(([, mc]) => mc > 0)
          .map(([tsMs, mc]) => ({
            day: Math.floor(tsMs / 1000 / DAY_SEC) * DAY_SEC,
            mc,
          }));
      }
      i++;
    } catch (err: any) {
      if (err.response?.status === 429) {
        console.log('[seed:p2] Rate limited — waiting 90s...');
        await new Promise<void>(r => setTimeout(r, 90000));
      } else {
        i++;
      }
    }

    if (i > 0 && i % 10 === 0) console.log(`[seed:p2] ${i}/${phase2Coins.length} done`);
    if (i < phase2Coins.length) await new Promise<void>(r => setTimeout(r, PHASE2_DELAY_MS));
  }

  // 모든 일별 타임스탬프 수집
  const allDays = new Set<number>();
  for (const arr of Object.values(p2Daily)) {
    for (const { day } of arr) allDays.add(day);
  }

  const nowSec             = Math.floor(Date.now() / 1000);
  const twoHundredDaysAgo  = nowSec - 200 * 24 * 3600;

  let totalAdded = 0;

  for (const day of Array.from(allDays).sort()) {
    if (day > nowSec) continue; // 미래 타임스탬프 방지

    const items: { sym: string; mc: number }[] = [];

    for (const [sym, arr] of Object.entries(p2Daily)) {
      const pt = arr.find(p => p.day === day);
      if (pt && !SKIP_STORE.has(sym.slice(0, -4))) {
        items.push({ sym, mc: pt.mc });
      }
    }

    // 200d 시점에 phase1 데이터 병합 → 더 완전한 글로벌 순위
    if (Math.abs(day - twoHundredDaysAgo) < 2 * 24 * 3600) {
      for (const p1 of phase1McAt200d) {
        if (!items.some(x => x.sym === p1.sym)) items.push(p1);
      }
    }

    if (items.length < 5) continue;
    items.sort((a, b) => b.mc - a.mc);

    for (let rank = 0; rank < items.length; rank++) {
      const { sym } = items[rank];
      if (!rankHistory[sym]) rankHistory[sym] = [];
      // 36시간 이내 중복 방지 (일별 포인트는 24h 간격이므로 정확히 하나만 저장됨)
      const nearby = rankHistory[sym].some(p => Math.abs(p.timestamp - day) < 36 * 3600);
      if (!nearby) {
        rankHistory[sym].push({ rank: rank + 1, timestamp: day });
        totalAdded++;
      }
    }
  }

  // 타임스탬프 정렬 및 용량 제한
  for (const sym of Object.keys(rankHistory)) {
    rankHistory[sym].sort((a, b) => a.timestamp - b.timestamp);
    if (rankHistory[sym].length > MAX_HISTORY_POINTS) {
      rankHistory[sym] = rankHistory[sym].slice(-MAX_HISTORY_POINTS);
    }
  }

  console.log(`[seed:p2] Complete — ${totalAdded} daily rank points added`);
}

// ─── Seed Phase 1: 배치 API 호출로 주요 시점 시드 ─────────────────────────────
let seeded = false;
export async function seedRankHistory() {
  if (seeded) return;
  seeded = true;

  // 429 rate-limit 대비: 최대 5회 재시도, 90초 대기
  let coins: any[] | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`[seed] Fetching top 200 with price_change_percentage (attempt ${attempt}/5)...`);
      const { data } = await cgAxios.get('/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 200,
          page: 1,
          sparkline: false,
          price_change_percentage: '1h,24h,7d,14d,30d,200d,1y',
        },
        timeout: 20000,
      });
      coins = data;
      break;
    } catch (err: any) {
      if (err.response?.status === 429 && attempt < 5) {
        console.log(`[seed] Rate limited (429) — waiting 90s before retry ${attempt + 1}/5...`);
        await new Promise<void>((r) => setTimeout(r, 90000));
      } else {
        console.error('[seed] Rank history seed failed:', err.message);
        return;
      }
    }
  }

  if (!coins) return;

  try {

    const validCoins = (coins as any[]).filter(
      (c: any) => c.market_cap > 0 && c.current_price > 0
    );

    if (validCoins.length === 0) {
      console.warn('[seed] No valid coins found');
      return;
    }

    const now = Math.floor(Date.now() / 1000);

    // histMC = currentMC / (1 + changePct/100) — 수학적으로 정확한 과거 시총 역산
    const timePoints: { field: string; offsetSec: number }[] = [
      { field: 'price_change_percentage_1y_in_currency',   offsetSec: 365 * 24 * 3600 },
      { field: 'price_change_percentage_200d_in_currency', offsetSec: 200 * 24 * 3600 },
      { field: 'price_change_percentage_30d_in_currency',  offsetSec:  30 * 24 * 3600 },
      { field: 'price_change_percentage_14d_in_currency',  offsetSec:  14 * 24 * 3600 },
      { field: 'price_change_percentage_7d_in_currency',   offsetSec:   7 * 24 * 3600 },
      { field: 'price_change_percentage_24h_in_currency',  offsetSec:       24 * 3600 },
      { field: 'price_change_percentage_1h_in_currency',   offsetSec:            3600 },
    ];

    // Phase 2를 위해 수집: 200d 데이터가 있는 코인의 시총 / 없는 코인 목록
    const phase1McAt200d: { sym: string; mc: number }[] = [];
    const has200dSet = new Set<string>(); // 200d 데이터 확보된 심볼

    for (const { field, offsetSec } of timePoints) {
      const ts = now - offsetSec;
      const mcAtTime: { sym: string; mc: number; skip: boolean }[] = [];

      for (const coin of validCoins) {
        const changePct = coin[field] as number | null | undefined;
        if (changePct == null) continue;
        const divisor = 1 + changePct / 100;
        if (divisor <= 0 || !isFinite(divisor)) continue;
        const histMC = coin.market_cap / divisor;
        if (histMC <= 0 || !isFinite(histMC)) continue;
        const sym  = (coin.symbol as string).toUpperCase() + 'USDT';
        const skip = SKIP_STORE.has((coin.symbol as string).toUpperCase());
        mcAtTime.push({ sym, mc: histMC, skip });

        // 200d 시총 수집 (phase2 병합용)
        if (field === 'price_change_percentage_200d_in_currency' && !skip) {
          phase1McAt200d.push({ sym, mc: histMC });
          has200dSet.add(sym);
        }
      }

      mcAtTime.sort((a, b) => b.mc - a.mc);

      for (let rank = 0; rank < mcAtTime.length; rank++) {
        const { sym, skip } = mcAtTime[rank];
        if (skip) continue;
        if (!rankHistory[sym]) rankHistory[sym] = [];
        rankHistory[sym].push({ rank: rank + 1, timestamp: ts });
      }
    }

    // Phase 2 대상: 30~200일 구간에 dense 데이터(30포인트 이상)가 없는 코인
    // phase1 seed의 200d 앵커 포인트(1개)는 dense로 간주하지 않음
    const phase2Lo = now - 210 * 24 * 3600;
    const phase2Hi = now - 30  * 24 * 3600;
    const missingCoins = validCoins
      .filter((c: any) => {
        if (SKIP_STORE.has((c.symbol as string).toUpperCase())) return false;
        if (!c.id) return false;
        const sym  = (c.symbol as string).toUpperCase() + 'USDT';
        const midRangeCount = (rankHistory[sym] ?? [])
          .filter(p => p.timestamp > phase2Lo && p.timestamp < phase2Hi).length;
        return midRangeCount < 30; // dense 데이터 이미 있으면 skip
      })
      .map((c: any) => ({ id: c.id as string, symbol: c.symbol as string }));

    // 현재 순위 — market_cap_rank 직접 사용 (가장 정확)
    for (const coin of validCoins) {
      const sym = (coin.symbol as string).toUpperCase() + 'USDT';
      if (SKIP_STORE.has((coin.symbol as string).toUpperCase())) continue;
      if (!coin.market_cap_rank) continue;
      if (!rankHistory[sym]) rankHistory[sym] = [];
      rankHistory[sym].push({ rank: coin.market_cap_rank as number, timestamp: now });
    }

    // 타임스탬프 기준 정렬
    let count = 0;
    for (const sym of Object.keys(rankHistory)) {
      rankHistory[sym].sort((a, b) => a.timestamp - b.timestamp);
      if (rankHistory[sym].length > MAX_HISTORY_POINTS) {
        rankHistory[sym] = rankHistory[sym].slice(-MAX_HISTORY_POINTS);
      }
      count++;
    }

    console.log(`[seed] Complete — ${count} coins, 8 data points (1y/200d/30d/14d/7d/24h/1h + now)`);

    // rankings 캐시 사전 채우기 — seed 직후 프론트 요청이 CoinGecko를 재호출하지 않도록
    // CoinList(50), RankCompareView 순위 모드(100), 섹터 모드(200) 등 모든 cache key 커버
    for (const n of [50, 100, 200]) {
      const key = `rankings:1:${n}`;
      if (!cache.get(key)) cache.set(key, coins.slice(0, n));
    }
    console.log('[seed] Rankings cache pre-warmed (50/100/200)');

    // Phase 2: 200d 누락 코인 백그라운드 보완 (non-blocking)
    console.log(`[seed] Starting phase 2 for ${missingCoins.length} coins missing 200d data...`);
    seedPhase2(missingCoins, phase1McAt200d).catch((err) =>
      console.error('[seed:p2] Unhandled error:', err.message)
    );
  } catch (err: any) {
    console.error('[seed] Rank history seed failed:', err.message);
  }
}

// ─── 자동 스냅샷 (10분마다 top 200 전체 갱신) ────────────────────────────────
// CoinList는 top 50만 fetch하므로 51~200위 코인은 snapshotRanks가 자동 실행되지 않음.
// 별도 타이머로 전체 코인의 순위 히스토리를 주기적으로 누적한다.
async function autoSnapshot() {
  try {
    const { data } = await cgAxios.get('/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 200,
        page: 1,
        sparkline: false,
      },
      timeout: 10000,
    });
    snapshotRanks(data);
    // 캐시도 갱신 — 다음 프론트 요청이 바로 최신 데이터를 받게
    for (const n of [50, 100, 200]) {
      cache.set(`rankings:1:${n}`, (data as any[]).slice(0, n));
    }
    saveRankHistory(); // 10분마다 파일에 영속화
  } catch (err: any) {
    if (err.response?.status !== 429) {
      console.error('[rankings] auto-snapshot failed:', err.message);
    }
  }
}

// seed 완료 후 10분부터 시작, 이후 10분마다 반복
export function startAutoSnapshot() {
  setTimeout(() => {
    autoSnapshot();
    setInterval(autoSnapshot, 10 * 60 * 1000);
  }, 10 * 60 * 1000);
}

// ─── 라우트 ──────────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const { page = '1', per_page = '50' } = req.query as Record<string, string>;
  const cacheKey = `rankings:${page}:${per_page}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const response = await cgAxios.get('/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: parseInt(per_page),
        page: parseInt(page),
        sparkline: false,
        price_change_percentage: '24h,7d',
      },
      timeout: 10000,
    });

    snapshotRanks(response.data);
    cache.set(cacheKey, response.data);
    res.json(response.data);
  } catch (err: any) {
    const status = err.response?.status;
    console.error(`CoinGecko rankings error: ${err.message}`);

    // 429 rate limit — seed로 채운 캐시가 만료됐을 때 인접 cache key로 대체
    if (status === 429) {
      const fallbackKeys = [`rankings:1:200`, `rankings:1:100`, `rankings:1:50`];
      for (const fb of fallbackKeys) {
        const fallback = cache.get(fb) as any[] | undefined;
        if (fallback) {
          const n = parseInt(per_page);
          res.json(fallback.slice(0, n));
          return;
        }
      }
    }
    res.status(502).json({ error: 'Failed to fetch rankings from CoinGecko' });
  }
});

// 인메모리 순위 히스토리 반환 (단일)
router.get('/history/:symbol', async (req: Request, res: Response) => {
  const { symbol } = req.params;
  const sym = (Array.isArray(symbol) ? symbol[0] : symbol).toUpperCase();
  const hist = rankHistory[sym] ?? [];
  res.json({ symbol: sym, history: hist });
});

// 인메모리 순위 히스토리 반환 (배치) — GET /api/rankings/history-batch?symbols=BTCUSDT,ETHUSDT,...
router.get('/history-batch', (req: Request, res: Response) => {
  const { symbols } = req.query as { symbols?: string };
  if (!symbols) {
    // symbols 미지정 시 전체 반환
    res.json(rankHistory);
    return;
  }
  const symList = symbols.split(',').map((s) => s.trim().toUpperCase()).slice(0, 100);
  const result: Record<string, { rank: number; timestamp: number }[]> = {};
  for (const sym of symList) {
    result[sym] = rankHistory[sym] ?? [];
  }
  res.json(result);
});

router.get('/price-history/:coinId', async (req: Request, res: Response) => {
  const { coinId } = req.params;
  const { days = '7' } = req.query as Record<string, string>;
  const cacheKey = `price-history:${coinId}:${days}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const response = await cgAxios.get(`/coins/${coinId}/market_chart`, {
      params: { vs_currency: 'usd', days, interval: days === '1' ? 'hourly' : 'daily' },
      timeout: 10000,
    });
    const data = { prices: response.data.prices, market_caps: response.data.market_caps };
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err: any) {
    console.error('CoinGecko price history error:', err.message);
    res.status(502).json({ error: 'Failed to fetch coin history' });
  }
});

export default router;
