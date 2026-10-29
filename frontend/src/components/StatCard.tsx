import type { LucideIcon } from 'lucide-react';

export type Accent = 'indigo' | 'emerald' | 'amber' | 'rose' | 'blue';

const accents: Record<Accent, { icon: string; text: string }> = {
  indigo: {
    icon: 'border-indigo-100 bg-indigo-50 text-indigo-600',
    text: 'text-indigo-600',
  },
  emerald: {
    icon: 'border-emerald-100 bg-emerald-50 text-emerald-600',
    text: 'text-emerald-600',
  },
  amber: {
    icon: 'border-amber-100 bg-amber-50 text-amber-600',
    text: 'text-amber-600',
  },
  rose: {
    icon: 'border-rose-100 bg-rose-50 text-rose-600',
    text: 'text-rose-600',
  },
  blue: {
    icon: 'border-blue-100 bg-blue-50 text-blue-600',
    text: 'text-blue-600',
  },
};

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: Accent;
  hint?: string;
  suffix?: string;
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  accent = 'indigo',
  hint,
  suffix,
}: StatCardProps) {
  const theme = accents[accent];
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="label pt-1">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${theme.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-[26px] font-bold leading-none tabular-nums tracking-tight text-[#0F172A]">
          {value}
        </span>
        {suffix ? <span className={`text-sm font-semibold ${theme.text}`}>{suffix}</span> : null}
      </div>
      {hint ? <p className="mt-2 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}
