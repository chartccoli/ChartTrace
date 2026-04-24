'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchRankHistory } from '@/lib/binance';
import { CoinMarket, toBinanceSymbol } from '@/lib/coingecko';
import RankSparkline from './RankSparkline';

interface Props {
  coin: CoinMarket;
  onClick?: () => void;
  selected?: boolean;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${price.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

function RankChangeBadge({ history }: { history: { rank: number; timestamp: number }[] }) {
  if (history.length < 2) return <span className="text-text-secondary text-xs">—</span>;

  const first = history[0].rank;
  const last = history[history.length - 1].rank;
  const delta = first - last; // positive = improved (rank number went down)

  if (delta === 0) return <span className="text-text-secondary text-xs">±0</span>;

  const improved = delta > 0;
  return (
    <span className={`text-xs font-semibold ${improved ? 'text-up' : 'text-down'}`}>
      {improved ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  );
}

export default function RankRow({ coin, onClick, selected }: Props) {
  const binanceSymbol = toBinanceSymbol(coin.symbol);

  const { data: rankData } = useQuery({
    queryKey: ['rank-history', binanceSymbol],
    queryFn: () => fetchRankHistory(binanceSymbol),
    staleTime: 5 * 60 * 1000,
  });

  const history = rankData?.history ?? [];
  const change24h = coin.price_change_percentage_24h;
  const change7d = coin.price_change_percentage_7d_in_currency;

  return (
    <tr
      onClick={onClick}
      className={`border-b border-border/40 transition-colors cursor-pointer text-sm
        ${selected ? 'bg-accent/10' : 'hover:bg-card'}`}
    >
      {/* 현재 순위 */}
      <td className="py-2.5 px-3 text-text-secondary w-10 text-center font-mono">
        {coin.market_cap_rank}
      </td>

      {/* 코인 정보 */}
      <td className="py-2.5 px-2">
        <div className="flex items-center gap-2">
          <img src={coin.image} alt={coin.symbol} className="w-6 h-6 rounded-full shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-text-primary">{coin.symbol.toUpperCase()}</div>
            <div className="text-xs text-text-secondary truncate max-w-[80px]">{coin.name}</div>
          </div>
        </div>
      </td>

      {/* 가격 */}
      <td className="py-2.5 px-2 text-right font-mono text-text-primary">
        {formatPrice(coin.current_price)}
      </td>

      {/* 24h 변동 */}
      <td className="py-2.5 px-2 text-right">
        {change24h == null ? (
          <span className="text-text-secondary text-xs">—</span>
        ) : (
          <span className={`text-xs font-medium ${change24h >= 0 ? 'text-up' : 'text-down'}`}>
            {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
          </span>
        )}
      </td>

      {/* 7d 변동 */}
      <td className="py-2.5 px-2 text-right">
        {change7d == null ? (
          <span className="text-text-secondary text-xs">—</span>
        ) : (
          <span className={`text-xs font-medium ${change7d >= 0 ? 'text-up' : 'text-down'}`}>
            {change7d >= 0 ? '+' : ''}{change7d.toFixed(2)}%
          </span>
        )}
      </td>

      {/* 7일 순위 변동 */}
      <td className="py-2.5 px-2 text-center w-16">
        <RankChangeBadge history={history} />
      </td>

      {/* 순위 히스토리 스파크라인 */}
      <td className="py-2.5 px-2 text-right">
        <RankSparkline history={history} width={80} height={22} />
      </td>
    </tr>
  );
}
