import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  Fingerprint,
  KeyRound,
  Landmark,
  Loader2,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import StatCard from '../components/StatCard';
import { useInstitutions } from '../lib/institution';
import {
  api,
  endpoints,
  type ApexKey,
  type AuditLog,
  type IntakeRow,
  type Overview,
} from '../lib/api';

type Filter = 'ALL' | 'CONCURRENCY_CONFLICT' | 'QUOTA_BLOCK' | 'ENROLLMENT_SUCCESS';

const filters: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All events' },
  { key: 'CONCURRENCY_CONFLICT', label: 'Conflicts' },
  { key: 'QUOTA_BLOCK', label: 'Quota blocks' },
  { key: 'ENROLLMENT_SUCCESS', label: 'Admissions' },
];

const eventTheme: Record<string, { chip: string; label: string }> = {
  CONCURRENCY_CONFLICT: {
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
    label: 'Conflict',
  },
  QUOTA_BLOCK: {
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    label: 'Quota',
  },
  ENROLLMENT_SUCCESS: {
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    label: 'Admission',
  },
  SYSTEM_SEED: {
    chip: 'border-slate-200 bg-slate-50 text-slate-600',
    label: 'System',
  },
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function shortCourse(course: string): string {
  return course.replace(/^B\.Tech\s*/i, '');
}

export default function OversightDashboard() {
  const { academicYear } = useInstitutions();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [intake, setIntake] = useState<IntakeRow[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [apexKey, setApexKey] = useState<ApexKey | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [overviewResponse, intakeResponse, logResponse] = await Promise.all([
        api.get<Overview>(endpoints.overview(academicYear)),
        api.get<IntakeRow[]>(endpoints.intake(academicYear)),
        api.get<AuditLog[]>(endpoints.auditLogs(academicYear, 60)),
      ]);
      setOverview(overviewResponse.data);
      setIntake(intakeResponse.data);
      setLogs(logResponse.data);
      setLastSync(new Date());
      setError(null);
    } catch {
      setError('Live telemetry unavailable. Confirm the backend is running on port 8000.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [academicYear]);

  useEffect(() => {
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(true), 6000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    api
      .get<ApexKey>(endpoints.apexKey)
      .then(({ data }) => setApexKey(data))
      .catch(() => setApexKey(null));
  }, []);

  const institutions = useMemo(
    () => Object.fromEntries(intake.map((row) => [row.institution_id, row.institution_name])),
    [intake],
  );

  const chartData = useMemo(
    () =>
      intake.map((row) => ({
        course: shortCourse(row.course_name),
        sanctioned: row.sanctioned_intake,
        enrolled: row.current_enrolled,
        institution: row.institution_name,
      })),
    [intake],
  );

  const visibleLogs = useMemo(
    () => (filter === 'ALL' ? logs : logs.filter((entry) => entry.event_type === filter)),
    [logs, filter],
  );

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: logs.length };
    for (const entry of logs) {
      counts[entry.event_type] = (counts[entry.event_type] ?? 0) + 1;
    }
    return counts;
  }, [logs]);

  const copyKey = async () => {
    if (!apexKey) return;
    try {
      await navigator.clipboard.writeText(apexKey.public_key);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 1600);
    } catch {
      setCopiedKey(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
            <Landmark className="h-3.5 w-3.5" /> Apex authority
          </p>
          <h1 className="font-display mt-1.5 text-2xl font-extrabold tracking-tight text-[#0F172A] sm:text-3xl">
            Regulatory oversight
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Country-wide seat telemetry, quota adherence and every double-enrollment attempt
            prevented by the national APAAR ledger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulseglow" />
            <Radio className="h-3.5 w-3.5" /> Live · polling 6s
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-ghost"
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Approved colleges"
          value={loading ? '—' : (overview?.total_institutions ?? 0)}
          icon={Building2}
          accent="indigo"
          hint={`Academic year ${academicYear}`}
        />
        <StatCard
          label="Registered APAARs"
          value={loading ? '—' : (overview?.total_registered_apaars ?? 0).toLocaleString('en-IN')}
          icon={Users}
          accent="emerald"
          hint={`${overview?.total_seats_filled ?? 0} active seats across the country`}
        />
        <StatCard
          label="Concurrency violations prevented"
          value={loading ? '—' : (overview?.prevented_concurrency_violations ?? 0)}
          icon={ShieldAlert}
          accent="rose"
          hint="Double-enrollment attempts blocked by the APAAR lock"
        />
        <StatCard
          label="Quota violations prevented"
          value={loading ? '—' : (overview?.prevented_quota_violations ?? 0)}
          icon={ShieldCheck}
          accent="amber"
          hint="Batches rejected for exceeding sanctioned intake"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="panel overflow-hidden">
          <div className="panel-header flex-wrap">
            <div>
              <h2 className="panel-title">Sanctioned intake vs. enrolled seats</h2>
              <p className="panel-subtitle">
                Department-wise capacity compliance for {academicYear}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-indigo-600" /> Sanctioned
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-indigo-200" /> Enrolled
              </span>
            </div>
          </div>
          <div className="h-[300px] w-full px-2 py-4 sm:px-4">
            {chartData.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                No intake telemetry available.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
                  barGap={6}
                >
                  <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="course"
                    tick={{ fill: '#64748B', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#E2E8F0' }}
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    contentStyle={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: 12,
                      fontSize: 12,
                      color: '#0F172A',
                      boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                    }}
                    labelStyle={{ color: '#0F172A', fontWeight: 600, marginBottom: 4 }}
                    formatter={(value, name) => [
                      `${value} seats`,
                      name === 'sanctioned' ? 'Sanctioned intake' : 'Enrolled',
                    ]}
                  />
                  <Bar
                    dataKey="sanctioned"
                    name="sanctioned"
                    fill="#4F46E5"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="enrolled"
                    name="enrolled"
                    fill="#C7D2FE"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2">
            {intake.map((row) => {
              const full = row.seats_remaining === 0;
              const near = row.utilization_percent >= 80;
              return (
                <div key={row.institution_id} className="bg-white px-4 py-3.5 sm:px-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-[#0F172A]">
                      {row.institution_name}
                    </p>
                    <span
                      className={`mono text-[11px] font-semibold ${
                        full ? 'text-rose-600' : near ? 'text-amber-600' : 'text-emerald-600'
                      }`}
                    >
                      {row.utilization_percent.toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {row.course_name} · {row.institution_id}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-600"
                        style={{ width: `${Math.min(row.utilization_percent, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-slate-500">
                      {row.current_enrolled}/{row.sanctioned_intake}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label">Seat utilisation</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold tabular-nums tracking-tight text-[#0F172A]">
                    {overview?.seat_utilization_percent?.toFixed(1) ?? '—'}
                  </span>
                  <span className="text-sm font-semibold text-indigo-600">%</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {overview?.total_seats_filled ?? 0} of {overview?.total_sanctioned_seats ?? 0}{' '}
                  sanctioned seats held nationwide
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
                <Activity className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-700"
                style={{ width: `${Math.min(overview?.seat_utilization_percent ?? 0, 100)}%` }}
              />
            </div>
          </div>

          <div className="panel p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-indigo-600" /> Apex signing key
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Every credential is signed with Ed25519. Verifiers can validate offline against
                  this public key — no database round-trip required.
                </p>
              </div>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600">
                <Fingerprint className="h-4 w-4" />
              </span>
            </div>
            <p className="mono mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              {apexKey?.key_fingerprint ?? 'Loading fingerprint…'}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="mono truncate text-[10px] text-slate-400">
                {apexKey ? `${apexKey.public_key.slice(0, 36)}…` : '—'}
              </p>
              <button
                type="button"
                onClick={() => void copyKey()}
                disabled={!apexKey}
                className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-indigo-600 transition hover:text-indigo-700 disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedKey ? 'Copied' : 'Copy key'}
              </button>
            </div>
            <p className="mt-4 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Key ID rotates with each
              apex deployment
            </p>
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-header flex-wrap">
          <div>
            <h2 className="panel-title flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-600" /> Conflict &amp; audit stream
            </h2>
            <p className="panel-subtitle">
              Immutable log of prevented double-enrollments, quota stops and admissions for{' '}
              {academicYear}
              {lastSync ? ` · synced ${lastSync.toLocaleTimeString('en-IN')}` : ''}
            </p>
          </div>
          <div className="scrollbar-thin flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={[
                  'whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition',
                  filter === item.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {item.label}
                <span className="ml-1.5 tabular-nums text-slate-400">
                  {filterCounts[item.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {visibleLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium text-slate-700">No events in this stream yet</p>
            <p className="max-w-md text-xs leading-relaxed text-slate-500">
              Run the collision roster from the Registrar portal to see the concurrency guard write
              to this audit ledger in real time.
            </p>
          </div>
        ) : (
          <div className="scrollbar-thin max-h-[460px] overflow-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="table-head px-4 py-3 sm:px-5">Event</th>
                  <th className="table-head px-3 py-3">Detail</th>
                  <th className="table-head px-3 py-3">APAAR</th>
                  <th className="table-head px-3 py-3">Institution</th>
                  <th className="table-head px-4 py-3 text-right sm:px-5">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleLogs.map((entry) => {
                  const theme = eventTheme[entry.event_type] ?? {
                    chip: 'border-slate-200 bg-slate-50 text-slate-600',
                    label: entry.event_type,
                  };
                  return (
                    <tr key={entry.id} className="align-top transition hover:bg-slate-50/70">
                      <td className="px-4 py-3 sm:px-5">
                        <span className={`chip ${theme.chip}`}>{theme.label}</span>
                      </td>
                      <td className="max-w-[360px] px-3 py-3.5">
                        <p className="text-xs leading-relaxed text-slate-600">{entry.detail}</p>
                        {entry.event_type === 'CONCURRENCY_CONFLICT' ? (
                          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600">
                            <AlertTriangle className="h-3 w-3" /> Prevented
                          </p>
                        ) : null}
                      </td>
                      <td className="mono px-3 py-3.5 text-[11px] text-slate-500">
                        {entry.apaar_id ?? '—'}
                      </td>
                      <td className="px-3 py-3.5 text-[11px] text-slate-500">
                        {entry.institution_id
                          ? institutions[entry.institution_id] ?? entry.institution_id
                          : '—'}
                        {entry.conflicting_institution_id ? (
                          <span className="mt-0.5 block text-[10px] text-rose-600">
                            blocked:{' '}
                            {institutions[entry.conflicting_institution_id] ??
                              entry.conflicting_institution_id}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right text-[11px] tabular-nums text-slate-400 sm:px-5">
                        {formatTime(entry.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
