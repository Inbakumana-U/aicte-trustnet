import { AlertTriangle, Lock, ShieldCheck } from 'lucide-react';
import type { Institution } from '../lib/api';

interface CapacityProgressProps {
  institution: Institution | null;
}

export default function CapacityProgress({ institution }: CapacityProgressProps) {
  if (!institution) {
    return (
      <div className="panel animate-pulse p-6">
        <div className="h-3 w-32 rounded bg-slate-200" />
        <div className="mt-4 h-7 w-48 rounded bg-slate-200" />
        <div className="mt-6 h-2 w-full rounded-full bg-slate-100" />
      </div>
    );
  }

  const { current_enrolled, sanctioned_intake, seats_remaining, utilization_percent } = institution;
  const ratio = sanctioned_intake > 0 ? current_enrolled / sanctioned_intake : 0;
  const full = seats_remaining <= 0;

  const tone = full
    ? {
        bar: 'bg-rose-500',
        text: 'text-rose-600',
        chip: 'border-rose-200 bg-rose-50 text-rose-700',
        label: 'Intake locked',
        Icon: Lock,
      }
    : ratio >= 0.95
      ? {
          bar: 'bg-rose-500',
          text: 'text-rose-600',
          chip: 'border-rose-200 bg-rose-50 text-rose-700',
          label: 'Critical capacity',
          Icon: AlertTriangle,
        }
      : ratio >= 0.8
        ? {
            bar: 'bg-amber-500',
            text: 'text-amber-600',
            chip: 'border-amber-200 bg-amber-50 text-amber-700',
            label: 'Near capacity',
            Icon: AlertTriangle,
          }
        : {
            bar: 'bg-emerald-500',
            text: 'text-emerald-600',
            chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
            label: 'Healthy headroom',
            Icon: ShieldCheck,
          };

  const percent = Math.min(100, Math.max(0, utilization_percent));

  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Sanctioned intake vs. enrolled seats</p>
          <h2 className="font-display mt-1.5 text-lg font-bold tracking-tight text-[#0F172A]">
            {institution.institution_name}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {institution.course_name} · {institution.academic_year} ·{' '}
            <span className="mono text-slate-400">{institution.institution_id}</span>
          </p>
        </div>
        <span className={`chip ${tone.chip}`}>
          <tone.Icon className="h-3.5 w-3.5" />
          {tone.label}
        </span>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-bold tabular-nums tracking-tight text-[#0F172A]">
            {current_enrolled}
          </span>
          <span className="text-lg font-medium text-slate-400">/ {sanctioned_intake}</span>
          <span className="ml-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            seats
          </span>
        </div>
        <div className={`text-sm font-semibold tabular-nums ${tone.text}`}>
          {percent.toFixed(1)}% utilised
        </div>
      </div>

      <div className="mt-3">
        <div
          role="progressbar"
          aria-valuenow={current_enrolled}
          aria-valuemin={0}
          aria-valuemax={sanctioned_intake}
          aria-label="Seats filled against sanctioned intake"
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
        >
          <div
            className={`h-full rounded-full ${tone.bar} transition-all duration-700 ease-out`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums text-slate-400">
          <span>0</span>
          <span className="hidden sm:inline">80% guard</span>
          <span className="hidden sm:inline">95% guard</span>
          <span>{sanctioned_intake}</span>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <div>
          <dt className="label">Sanctioned</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-[#0F172A]">
            {sanctioned_intake}
          </dd>
        </div>
        <div>
          <dt className="label">Enrolled</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-[#0F172A]">
            {current_enrolled}
          </dd>
        </div>
        <div>
          <dt className="label">Available</dt>
          <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone.text}`}>
            {seats_remaining}
          </dd>
        </div>
      </dl>

      {full ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          All sanctioned seats are held. The quota guard will reject any further roster for this
          intake year.
        </p>
      ) : (
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          Capacity is enforced twice: a pre-flight quota guard in the API and a database
          check-constraint that blocks any write which would exceed the approved intake.
        </p>
      )}
    </div>
  );
}
