import { formatCny, formatUsd } from '../lib/format';

type MoneyProps = {
  cny: number | null | undefined;
  usd?: number | null | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  align?: 'left' | 'right';
  className?: string;
  /** 主值（¥）配色，默认 emerald。 */
  mainClass?: string;
  /** 副值（$）配色，默认 slate-500。 */
  subClass?: string;
};

const MAIN_SIZE: Record<string, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
  xl: 'text-2xl',
};

const SUB_SIZE: Record<string, string> = {
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-xs',
  xl: 'text-sm',
};

/** 统一双币展示：¥ 主值（emerald） + $ 副值（小一号灰色）。 */
export function Money({
  cny,
  usd,
  size = 'md',
  align = 'left',
  className = '',
  mainClass = 'text-emerald-400',
  subClass = 'text-slate-500',
}: MoneyProps) {
  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-2 ${
        align === 'right' ? 'justify-end' : 'justify-start'
      } ${className}`}
    >
      <span className={`font-semibold tabular-nums ${MAIN_SIZE[size]} ${mainClass}`}>
        ¥ {formatCny(cny)}
      </span>
      {usd !== undefined && usd !== null && (
        <span className={`tabular-nums ${SUB_SIZE[size]} ${subClass}`}>$ {formatUsd(usd)}</span>
      )}
    </span>
  );
}
