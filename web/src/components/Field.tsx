import { useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { zhCN } from 'react-day-picker/locale/zh-CN';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <span>{label}</span>
        {hint && <span className="normal-case tracking-normal text-slate-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const baseControl =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${baseControl} ${className}`} />;
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${baseControl} pr-8 ${className}`}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* 日期控件：输入框 + 弹层，恒定以「年/月/日」「年/月」呈现            */
/* ------------------------------------------------------------------ */

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 26 }, (_, i) => CURRENT_YEAR - 20 + i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

/** ISO 字符串 → 本地 Date，避免 UTC 偏移导致跨天。 */
function parseISODate(value: string): Date | undefined {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!matched) return undefined;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 本地 Date → YYYY-MM-DD。 */
function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const POPOVER_CONTENT =
  'z-[60] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-2xl outline-none';

const NAV_BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent';

const FOOTER_BUTTON =
  'rounded px-2 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200';

const CALENDAR_CLASS_NAMES = {
  months: 'relative flex',
  month: 'space-y-2',
  month_caption: 'flex h-8 items-center justify-center px-9',
  caption_label: 'text-xs font-semibold text-slate-100',
  dropdowns: 'relative inline-flex items-center gap-1',
  dropdown_root: 'relative inline-flex items-center',
  dropdown: 'absolute inset-0 z-[2] w-full cursor-pointer opacity-0',
  nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
  button_previous: NAV_BUTTON,
  button_next: NAV_BUTTON,
  chevron: 'h-3.5 w-3.5 fill-current',
  month_grid: 'w-full border-collapse',
  weekday: 'h-7 w-9 text-center text-[11px] font-medium text-slate-500',
  day: 'h-9 w-9 p-0 text-center align-middle',
  day_button:
    'flex h-8 w-8 items-center justify-center rounded-md text-[13px] text-slate-300 transition hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
  selected:
    '[&>button]:bg-emerald-500 [&>button]:font-semibold [&>button]:text-white hover:[&>button]:bg-emerald-500',
  today: '[&>button]:font-semibold [&>button]:text-emerald-400',
  outside: 'opacity-40',
  disabled: 'opacity-30',
};

const CHEVRON_DOWN = (
  <svg className="h-3.5 w-3.5 shrink-0 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
      clipRule="evenodd"
    />
  </svg>
);

type PeriodInputProps = {
  /** DateInput: YYYY-MM-DD；MonthInput: YYYY-MM；空串表示未填。 */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
};

function triggerClass(filled: boolean, className: string) {
  return `${baseControl} flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed ${
    filled ? '' : 'text-slate-500'
  } ${className}`;
}

/** 年/月/日 选择器，值恒为 YYYY-MM-DD。 */
export function DateInput({ value, onChange, className = '', disabled }: PeriodInputProps) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);
  const [month, setMonth] = useState<Date>(() => selected ?? new Date());

  const commit = (date: Date) => {
    onChange(toISODate(date));
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMonth(selected ?? new Date());
      }}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" disabled={disabled} className={triggerClass(Boolean(selected), className)}>
          <span className="truncate">{selected ? value.slice(0, 10) : '选择日期'}</span>
          {CHEVRON_DOWN}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          collisionPadding={8}
          className={POPOVER_CONTENT}
        >
          <DayPicker
            mode="single"
            locale={zhCN}
            weekStartsOn={1}
            showOutsideDays
            captionLayout="dropdown"
            navLayout="around"
            startMonth={new Date(CURRENT_YEAR - 20, 0)}
            endMonth={new Date(CURRENT_YEAR + 5, 11)}
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            classNames={CALENDAR_CLASS_NAMES}
            onSelect={(date) => {
              if (date) commit(date);
            }}
          />
          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
            <button type="button" className={FOOTER_BUTTON} onClick={() => commit(new Date())}>
              今天
            </button>
            <button
              type="button"
              className={FOOTER_BUTTON}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              清除
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** 年/月 选择器，值恒为 YYYY-MM。 */
export function MonthInput({ value, onChange, className = '', disabled }: PeriodInputProps) {
  const [open, setOpen] = useState(false);
  const matched = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  const selectedYear = matched ? Number(matched[1]) : undefined;
  const selectedMonth = matched ? Number(matched[2]) : undefined;
  const [year, setYear] = useState(() => selectedYear ?? CURRENT_YEAR);

  const commit = (nextYear: number, nextMonth: number) => {
    onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(selectedYear ?? CURRENT_YEAR);
      }}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" disabled={disabled} className={triggerClass(Boolean(matched), className)}>
          <span className="truncate">{matched ? value.slice(0, 7) : '选择月份'}</span>
          {CHEVRON_DOWN}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          collisionPadding={8}
          className={`${POPOVER_CONTENT} w-[15rem]`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="上一年"
              className={NAV_BUTTON}
              onClick={() => setYear((current) => current - 1)}
            >
              ‹
            </button>
            <select
              aria-label="年"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-center text-xs text-slate-100 outline-none transition focus:border-emerald-500"
            >
              {YEAR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} 年
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="下一年"
              className={NAV_BUTTON}
              onClick={() => setYear((current) => current + 1)}
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_OPTIONS.map((option) => {
              const active = selectedYear === year && selectedMonth === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => commit(year, option)}
                  className={`h-8 rounded-md text-xs transition ${
                    active
                      ? 'bg-emerald-500 font-semibold text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  {option} 月
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
            <button type="button" className={FOOTER_BUTTON} onClick={() => commit(CURRENT_YEAR, new Date().getMonth() + 1)}>
              本月
            </button>
            <button
              type="button"
              className={FOOTER_BUTTON}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              清除
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  const variants: Record<string, string> = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-500',
    ghost: 'border border-slate-700 text-slate-300 hover:bg-slate-800',
    subtle: 'bg-slate-800 text-slate-200 hover:bg-slate-700',
    danger: 'border border-rose-500/40 text-rose-400 hover:bg-rose-500/10',
  };
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3 py-2 text-sm',
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
    />
  );
}
