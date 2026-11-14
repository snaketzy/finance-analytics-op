import type { ReactNode } from 'react';

/** 页面主标题：英文在上、中文在下。 */
export function PageHeader({
  en,
  cn,
  titleExtra,
  children,
}: {
  en: string;
  cn: string;
  titleExtra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="leading-tight">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-100">{en}</h1>
          {titleExtra}
        </div>
        <p className="text-xs text-slate-500">{cn}</p>
      </div>
      {children}
    </div>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900 ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({ en, cn, right }: { en: string; cn: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-100">{en}</div>
        <div className="text-[11px] text-slate-500">{cn}</div>
      </div>
      {right}
    </div>
  );
}

export function Empty({ text = '暂无数据' }: { text?: string }) {
  return <div className="py-10 text-center text-xs text-slate-600">{text}</div>;
}
