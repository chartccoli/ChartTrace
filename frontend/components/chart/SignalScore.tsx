'use client';

import { SignalScore } from '@/lib/binance';

const LEVEL_CONFIG = {
  none: { color: 'text-text-secondary', bg: 'bg-border', label: '신호 없음' },
  weak: { color: 'text-yellow-400', bg: 'bg-yellow-400/15', label: '약한 신호' },
  medium: { color: 'text-orange-400', bg: 'bg-orange-400/15', label: '신호 감지' },
  strong: { color: 'text-up', bg: 'bg-up/15', label: '강한 신호' },
};

const DIRECTION_ICON = {
  bullish: '▲',
  bearish: '▼',
  neutral: '●',
};

const DIRECTION_BADGE = {
  bullish: { color: 'text-up',              bg: 'bg-up/15'   },
  bearish: { color: 'text-down',            bg: 'bg-down/15' },
  neutral: { color: 'text-yellow-400',      bg: 'bg-yellow-400/15' },
};

/** 사이드바용 작은 뱃지 */
export function ScoreBadge({ score }: { score: SignalScore | null | undefined }) {
  if (!score || score.level === 'none') return null;
  const cfg = DIRECTION_BADGE[score.direction];
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
      {DIRECTION_ICON[score.direction]} {score.score}
    </span>
  );
}

/** 메인 차트 상단 상세 패널 */
export function SignalScorePanel({ score }: { score: SignalScore | null | undefined }) {
  if (!score) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-lg border border-border">
        <span className="text-xs text-text-secondary">신호 분석 중...</span>
      </div>
    );
  }

  const cfg = LEVEL_CONFIG[score.level];
  const triggered = score.signals.filter((s) => s.triggered);

  return (
    <div className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${
      score.level === 'strong'
        ? 'border-up/40 bg-up/5'
        : score.level === 'medium'
        ? 'border-orange-400/40 bg-orange-400/5'
        : score.level === 'weak'
        ? 'border-yellow-400/30 bg-yellow-400/5'
        : 'border-border bg-card'
    }`}>
      {/* 스코어 원형 */}
      <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 shrink-0 ${
        score.level === 'strong'
          ? 'border-up text-up'
          : score.level === 'medium'
          ? 'border-orange-400 text-orange-400'
          : score.level === 'weak'
          ? 'border-yellow-400 text-yellow-400'
          : 'border-border text-text-secondary'
      }`}>
        <span className="text-lg font-bold leading-none">{score.score}</span>
        <span className="text-[8px] uppercase tracking-wider opacity-70">score</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold ${cfg.color}`}>
            {DIRECTION_ICON[score.direction]} {cfg.label}
          </span>
          {score.level === 'strong' && (
            <span className="text-[10px] bg-up/20 text-up px-1.5 py-0.5 rounded animate-pulse">
              ● 알림
            </span>
          )}
        </div>
        {triggered.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {triggered.map((s) => (
              <span
                key={s.key}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  s.direction === 'bullish'
                    ? 'bg-up/15 text-up'
                    : s.direction === 'bearish'
                    ? 'bg-down/15 text-down'
                    : 'bg-border text-text-secondary'
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-text-secondary">활성 신호 없음</span>
        )}
      </div>
    </div>
  );
}
