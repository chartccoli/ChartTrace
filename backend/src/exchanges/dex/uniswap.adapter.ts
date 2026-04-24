import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

// The Graph — Uniswap V3 subgraph (Ethereum mainnet)
const GRAPH_URL = 'https://gateway.thegraph.com/api/deployments/id/QmZeCuoZeadgHkGwLwMeguyqUKz1WPWQYKcKyMCeQqGhsF';

// interval → The Graph poolHourDatas / poolDayDatas
const INTERVAL_TYPE: Record<string, 'hourly' | 'daily'> = {
  '15m': 'hourly',
  '1h':  'hourly',
  '4h':  'hourly',
  '1d':  'daily',
  '1w':  'daily',
};

// 주요 풀 주소 (token0/token1 기준 USDT 풀)
const POOL_MAP: Record<string, string> = {
  'BTC/USDT':  '0x4e68ccd3e89f51c3074ca5072bbac773960dfa36', // WBTC/USDT 0.3%
  'ETH/USDT':  '0x4e68ccd3e89f51c3074ca5072bbac773960dfa36', // ETH/USDT — 실제 사용 시 정확한 주소 필요
  'BNB/USDT':  '',
  'SOL/USDT':  '',
};

export class UniswapAdapter implements ExchangeAdapter {
  name = 'uniswap';
  type = 'DEX' as const;

  normalizeSymbol(s: string): string {
    return s; // 이미 표준 형식
  }

  toExchangeSymbol(s: string): string {
    return s;
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const poolAddress = POOL_MAP[symbol];
    if (!poolAddress) return []; // 미지원 심볼

    const type = INTERVAL_TYPE[interval] ?? 'hourly';
    const useHourly = type === 'hourly';

    const query = useHourly
      ? `{
          poolHourDatas(
            first: ${Math.min(limit, 500)},
            orderBy: periodStartUnix,
            orderDirection: desc,
            where: { pool: "${poolAddress}" }
          ) {
            periodStartUnix
            open
            high
            low
            close
            volumeToken0
            volumeUSD
          }
        }`
      : `{
          poolDayDatas(
            first: ${Math.min(limit, 365)},
            orderBy: date,
            orderDirection: desc,
            where: { pool: "${poolAddress}" }
          ) {
            date
            open
            high
            low
            close
            volumeToken0
            volumeUSD
          }
        }`;

    const { data } = await axios.post(
      GRAPH_URL,
      { query },
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
    );

    const items = useHourly
      ? data?.data?.poolHourDatas ?? []
      : data?.data?.poolDayDatas ?? [];

    return items.reverse().map((k: any) => ({
      openTime: parseInt(k.periodStartUnix ?? k.date),
      open: parseFloat(k.open ?? 0),
      high: parseFloat(k.high ?? 0),
      low: parseFloat(k.low ?? 0),
      close: parseFloat(k.close ?? 0),
      volume: parseFloat(k.volumeToken0 ?? 0),
      quoteVolume: parseFloat(k.volumeUSD ?? 0),
      takerBuyVolume: 0,
      source: 'uniswap',
    }));
  }
}
