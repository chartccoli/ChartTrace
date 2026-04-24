import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency: number;
  total_volume: number;
}

export async function fetchRankings(page = 1, perPage = 50): Promise<CoinMarket[]> {
  const { data } = await axios.get<CoinMarket[]>(`${API_BASE}/api/rankings`, {
    params: { page, per_page: perPage },
  });
  return data;
}

export async function fetchCoinHistory(coinId: string) {
  const { data } = await axios.get(`${API_BASE}/api/rankings/history/${coinId}`);
  return data;
}

// 코인 심볼 → Binance 심볼 변환 (예: BTC → BTCUSDT)
export function toBinanceSymbol(symbol: string): string {
  return `${symbol.toUpperCase()}USDT`;
}
