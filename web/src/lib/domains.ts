import type { CategoryType } from '../api';

export type DomainLabel = { cn: string; en: string };

export const INCOME_DOMAINS: Record<string, DomainLabel> = {
  subscription: { cn: '订阅收入', en: 'Subscription' },
  transactional: { cn: '点播收入', en: 'Transactional' },
  advertising: { cn: '广告收入', en: 'Advertising' },
  licensing: { cn: '版权分发', en: 'Licensing' },
  valueadd: { cn: '增值周边', en: 'Value-added' },
  sponsorship: { cn: '赞助', en: 'Sponsorship' },
  incentive: { cn: '平台激励', en: 'Platform Incentive' },
  financial: { cn: '金融收益', en: 'Financial' },
  other: { cn: '其他收入', en: 'Other Income' },
};

export const EXPENSE_DOMAINS: Record<string, DomainLabel> = {
  infra: { cn: '基础设施', en: 'Infrastructure' },
  compute: { cn: '算力', en: 'Compute' },
  content: { cn: '内容', en: 'Content' },
  people: { cn: '人力', en: 'People' },
  marketing: { cn: '市场', en: 'Marketing' },
  channel: { cn: '平台渠道', en: 'Platform Channel' },
  ops: { cn: '管理', en: 'G&A' },
  other: { cn: '其他支出', en: 'Other Expense' },
};

/** 按收支方向取 domain 的中英文展示名；未知时回退为原始 key。 */
export function domainLabel(domain: string, type: CategoryType): DomainLabel {
  const map = type === 'income' ? INCOME_DOMAINS : EXPENSE_DOMAINS;
  return map[domain] ?? { cn: domain, en: domain };
}

export const DIRECTION_LABEL: Record<CategoryType, DomainLabel> = {
  income: { cn: '收入', en: 'Income' },
  expense: { cn: '支出', en: 'Expense' },
};

export const ACCOUNT_TYPE_LABEL: Record<string, DomainLabel> = {
  cash: { cn: '现金', en: 'Cash' },
  bank: { cn: '银行', en: 'Bank' },
  platform: { cn: '平台余额', en: 'Platform' },
  credit: { cn: '信用卡', en: 'Credit' },
  virtual: { cn: '虚拟账户', en: 'Virtual' },
};

export const SUPPLIER_KIND_LABEL: Record<string, DomainLabel> = {
  vendor: { cn: '供应商', en: 'Vendor' },
  customer: { cn: '客户', en: 'Customer' },
  both: { cn: '供应商/客户', en: 'Vendor / Customer' },
};

export const SUPPLIER_REGION_LABEL: Record<string, DomainLabel> = {
  cn: { cn: '国内', en: 'Domestic' },
  global: { cn: '海外', en: 'Overseas' },
};

