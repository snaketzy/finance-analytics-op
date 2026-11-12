import type { MonthlyRow } from '../api';
import { formatCny } from '../lib/format';

/** 纯 CSS/div 柱状图：每月收入 / 支出两条柱。 */
export function TrendChart({ data }: { data: MonthlyRow[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.incomeCny, d.expenseCny)));

  return (
    <div className="flex h-56 items-stretch gap-3 overflow-x-auto pb-1">
      {data.map((d) => (
        <div key={d.ym} className="flex h-full min-w-[44px] flex-1 flex-col items-center gap-2">
          <div className="flex w-full flex-1 items-end justify-center gap-1">
            <div
              title={`${d.ym} 收入 ¥${formatCny(d.incomeCny)}`}
              className="w-3 rounded-t bg-emerald-500/80 transition-all hover:bg-emerald-400"
              style={{
                height: `${(d.incomeCny / max) * 100}%`,
                minHeight: d.incomeCny > 0 ? 2 : 0,
              }}
            />
            <div
              title={`${d.ym} 支出 ¥${formatCny(d.expenseCny)}`}
              className="w-3 rounded-t bg-rose-500/80 transition-all hover:bg-rose-400"
              style={{
                height: `${(d.expenseCny / max) * 100}%`,
                minHeight: d.expenseCny > 0 ? 2 : 0,
              }}
            />
          </div>
          <span className="whitespace-nowrap text-[11px] text-slate-500">{d.ym}</span>
        </div>
      ))}
    </div>
  );
}
