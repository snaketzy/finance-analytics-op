import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useGetFxLatestQuery } from '../api';
import { formatDate, formatRate } from '../lib/format';

type NavLeaf = { to: string; en: string; cn: string; end?: boolean };
type NavGroup = { key: string; en: string; cn: string; children: NavLeaf[] };

const NAV: (NavLeaf | NavGroup)[] = [
  { to: '/', en: 'Dashboard', cn: '总览', end: true },
  {
    key: 'cost',
    en: 'Costs',
    cn: '成本',
    children: [
      { to: '/ledger', en: 'Ledger', cn: '台账流水' },
      { to: '/recurring', en: 'Recurring Costs', cn: '周期成本' },
      { to: '/cloudflare-billing', en: 'Cloudflare Billing', cn: 'Cloudflare 账单' },
    ],
  },
  { to: '/budgets', en: 'Budgets', cn: '预算' },
  { to: '/projects', en: 'Projects', cn: '项目维护' },
  { to: '/products', en: 'Products', cn: '产品维护' },
  { to: '/unit-economics', en: 'Unit Economics', cn: '盈利模型' },
  {
    key: 'analytics',
    en: 'Cost / Revenue Analytics',
    cn: '成本/收入分析',
    children: [
      { to: '/cost', en: 'Cost Analytics', cn: '成本分析' },
      { to: '/revenue', en: 'Revenue Analytics', cn: '收入分析' },
    ],
  },
  {
    key: 'settings',
    en: 'Settings',
    cn: '设置',
    children: [
      { to: '/categories', en: 'Categories', cn: '科目' },
      { to: '/suppliers', en: 'Suppliers', cn: '供应商' },
      { to: '/accounts', en: 'Accounts', cn: '账户' },
      { to: '/fx', en: 'FX', cn: '汇率' },
      { to: '/payments', en: 'Payment Channels', cn: '支付渠道' },
    ],
  },
];

/** 含子菜单的父级导航项（可折叠，任一子项激活时自动展开）。 */
function NavGroupItem({ group }: { group: NavGroup }) {
  const { pathname } = useLocation();
  const active = group.children.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`));
  const [expanded, setExpanded] = useState(active);
  // 进入该分组的子路由时自动展开一次；其余情况由用户手动收起/展开。
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setExpanded(true);
    wasActive.current = active;
  }, [active]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition ${
          active ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`}
      >
        <div className="leading-tight">
          <div className="text-sm font-medium">{group.en}</div>
          <div className={`text-[11px] ${active ? 'text-emerald-400/70' : 'text-slate-500'}`}>{group.cn}</div>
        </div>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 ml-3 space-y-1 border-l border-slate-800 pl-3">
          {group.children.map((c) => (
            <NavLink
              key={c.to}
              to={c.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-1.5 transition ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              {({ isActive }) => (
                <div className="leading-tight">
                  <div className="text-[13px] font-medium">{c.en}</div>
                  <div className={`text-[11px] ${isActive ? 'text-emerald-400/70' : 'text-slate-500'}`}>{c.cn}</div>
                </div>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function FxBadge() {
  const { data } = useGetFxLatestQuery();
  return (
    <div className="text-right leading-tight">
      <div className="text-xs text-slate-300">
        1 USD = ¥ <span className="font-semibold text-emerald-400">{formatRate(data?.rate)}</span>
      </div>
      <div className="text-[11px] text-slate-500">汇率日期 {formatDate(data?.rateDate)}</div>
    </div>
  );
}

export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* 侧边栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-800 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-emerald-500/15 text-sm font-bold text-emerald-400">
            F
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">FBAP</div>
            <div className="text-[11px] text-slate-500">财务与经营分析</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) =>
            'children' in item ? (
              <NavGroupItem key={item.key} group={item} />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-2 transition ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`
                }
              >
                {({ isActive }) => (
                  <div className="leading-tight">
                    <div className="text-sm font-medium">{item.en}</div>
                    <div className={`text-[11px] ${isActive ? 'text-emerald-400/70' : 'text-slate-500'}`}>
                      {item.cn}
                    </div>
                  </div>
                )}
              </NavLink>
            )
          )}
        </nav>
        <div className="border-t border-slate-800 px-5 py-3 text-[11px] text-slate-600">v1.0</div>
      </aside>

      {/* 右侧主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 md:px-12">
          <div className="leading-tight">
            <div className="text-base font-semibold">Finance &amp; Business Analytics</div>
            <div className="text-[11px] text-slate-500">项目财务与经营分析平台</div>
          </div>
          <FxBadge />
        </header>

        {/* 内容区：仅此区域滚动，页面各自管理内部滚动 */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>

        <footer className="flex h-11 shrink-0 items-center justify-between border-t border-slate-800 bg-slate-900 px-4 text-[11px] text-slate-500 md:px-12">
          <span>© 2026 FBAP · Finance &amp; Business Analytics Platform</span>
          <span>本位币 CNY · 副币 USD</span>
        </footer>
      </div>
    </div>
  );
}
