import { ExchangeAdapter, Kline, AggregatedVolume } from './adapter.interface';
import { BinanceAdapter }      from './cex/binance.adapter';
import { OKXAdapter }          from './cex/okx.adapter';
import { BybitAdapter }        from './cex/bybit.adapter';
import { UpbitAdapter }        from './cex/upbit.adapter';
import { CoinbaseAdapter }     from './cex/coinbase.adapter';
import { MexcAdapter }         from './cex/mexc.adapter';
import { KrakenAdapter }       from './cex/kraken.adapter';
import { HtxAdapter }          from './cex/htx.adapter';
import { GateioAdapter }       from './cex/gateio.adapter';
import { KucoinAdapter }       from './cex/kucoin.adapter';
import { BitgetAdapter }       from './cex/bitget.adapter';
import { CryptocomAdapter }    from './cex/cryptocom.adapter';
import { UniswapAdapter }      from './dex/uniswap.adapter';
import { PancakeSwapAdapter }  from './dex/pancakeswap.adapter';
import { DydxAdapter }         from './dex/dydx.adapter';
import { HyperliquidAdapter }  from './dex/hyperliquid.adapter';

export interface AggregatedKline extends AggregatedVolume {
  // 대표 OHLC (Binance 우선, 없으면 첫 번째 성공 어댑터)
  open: number;
  high: number;
  low: number;
  close: number;
}

export class VolumeAggregator {
  private adapters: ExchangeAdapter[];

  constructor(adapters?: ExchangeAdapter[]) {
    this.adapters = adapters ?? [
      // CEX — 볼륨 큰 순
      new BinanceAdapter(),
      new OKXAdapter(),
      new BybitAdapter(),
      new MexcAdapter(),
      new KucoinAdapter(),
      new BitgetAdapter(),
      new HtxAdapter(),
      new GateioAdapter(),
      new KrakenAdapter(),
      new CoinbaseAdapter(),
      new CryptocomAdapter(),
      new UpbitAdapter(),
      // DEX
      new HyperliquidAdapter(),
      new UniswapAdapter(),
      new PancakeSwapAdapter(),
      new DydxAdapter(),
    ];
  }

  /**
   * 모든 거래소에서 klines를 수집하고 타임스탬프 기준으로 합산
   * Promise.allSettled — 일부 거래소 실패해도 나머지로 계속
   */
  async getAggregatedKlines(
    symbol: string,
    interval: string,
    limit: number
  ): Promise<AggregatedKline[]> {
    const results = await Promise.allSettled(
      this.adapters.map((a) => a.getKlines(symbol, interval, limit))
    );

    // 성공한 어댑터 결과만 추출
    const byExchange: { name: string; type: 'CEX' | 'DEX'; klines: Kline[] }[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        byExchange.push({
          name: this.adapters[i].name,
          type: this.adapters[i].type,
          klines: r.value,
        });
      }
    });

    if (byExchange.length === 0) return [];

    return this.mergeByTimestamp(byExchange, limit);
  }

  /**
   * 타임스탬프 기준 합산
   * Binance OHLC를 기준으로 하고, 다른 거래소의 volume만 더한다
   */
  private mergeByTimestamp(
    byExchange: { name: string; type: 'CEX' | 'DEX'; klines: Kline[] }[],
    limit: number
  ): AggregatedKline[] {
    // 기준 타임스탬프 집합: Binance(있으면) 또는 첫 번째 어댑터
    const primary = byExchange.find((e) => e.name === 'binance') ?? byExchange[0];
    const timestamps = primary.klines.map((k) => k.openTime);

    return timestamps.slice(-limit).map((ts) => {
      let open = 0, high = 0, low = 0, close = 0;
      let totalQuote = 0;
      const breakdown: AggregatedKline['breakdown'] = [];

      for (const ex of byExchange) {
        // 타임스탬프 근사 매칭 (±5분 이내)
        const match = ex.klines.find((k) => Math.abs(k.openTime - ts) < 300);
        if (!match) continue;

        if (ex.name === primary.name) {
          open = match.open;
          high = match.high;
          low = match.low;
          close = match.close;
        }

        breakdown.push({
          exchange: ex.name,
          type: ex.type,
          volume: match.volume,
          quoteVolume: match.quoteVolume,
          share: 0, // 아래에서 재계산
        });

        totalQuote += match.quoteVolume;
      }

      // share 재계산
      if (totalQuote > 0) {
        breakdown.forEach((b) => {
          b.share = (b.quoteVolume / totalQuote) * 100;
        });
      }

      const cexVol = breakdown
        .filter((b) => b.type === 'CEX')
        .reduce((a, b) => a + b.quoteVolume, 0);
      const dexVol = breakdown
        .filter((b) => b.type === 'DEX')
        .reduce((a, b) => a + b.quoteVolume, 0);

      return {
        timestamp: ts,
        open,
        high,
        low,
        close,
        totalVolume: breakdown.reduce((a, b) => a + b.volume, 0),
        totalQuoteVolume: totalQuote,
        breakdown,
        cexVolume: cexVol,
        dexVolume: dexVol,
        dexRatio: totalQuote > 0 ? dexVol / totalQuote : 0,
      };
    });
  }
}

// 싱글턴 인스턴스 — 서버 전체에서 공유
export const volumeAggregator = new VolumeAggregator();
