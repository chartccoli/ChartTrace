import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

// PancakeSwap V3 — BSC subgraph
const GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc';

const POOL_MAP: Record<string, string> = {
  'BTC/USDT':  '0x172fcd41e0913e95784454622d1c3724f546f849', // BTCB/USDT
  'ETH/USDT':  '0x1ac1a8feaaea1900c4166deeed0c11cc10669d36',
  'BNB/USDT':  '0x36696169c63e42cd08ce11f5deebbcebae652050',
};

const INTERVAL_TYPE: Record<string, 'hourly' | 'daily'> = {
  '15m': 'hourly',
  '1h':  'hourly',
  '4h':  'hourly',
  '1d':  'daily',
  '1w':  'daily',
};

export class PancakeSwapAdapter implements ExchangeAdapter {
  name = 'pancakeswap';
  type = 'DEX' as const;

  normalizeSymbol(s: string): string { return s; }
  toExchangeSymbol(s: string): string { return s; }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const poolAddress = POOL_MAP[symbol];
    if (!poolAddress) return [];

    const useHourly = (INTERVAL_TYPE[interval] ?? 'hourly') === 'hourly';

    const query = useHourly
      ? `{
          poolHourDatas(
            first: ${Math.min(limit, 500)},
            orderBy: periodStartUnix,
            orderDirection: desc,
            where: { pool: "${poolAddress}" }
          ) {
            periodStartUnix open high low close volumeToken0 volumeUSD
          }
        }`
      : `{
          poolDayDatas(
            first: ${Math.min(limit, 365)},
            orderBy: date,
            orderDirection: desc,
            where: { pool: "${poolAddress}" }
          ) {
            date open high low close volumeToken0 volumeUSD
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
      source: 'pancakeswap',
    }));
  }
}
