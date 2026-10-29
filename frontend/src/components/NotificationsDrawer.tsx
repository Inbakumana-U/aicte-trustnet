import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Lock,
  ShieldAlert,
  X,
} from 'lucide-react';
import { api, endpoints, type AuditLog, type IntakeRow } from '../lib/api';

export const NOTIFICATIONS_REFRESH_EVENT = 'trustnet:notifications-refresh';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string | null;
  tone: 'rose' | 'amber' | 'emerald' | 'slate';
  kind: 'conflict' | 'quota' | 'admission' | 'seed' | 'capacity';
}

const toneStyles: Record<
  NotificationItem['tone'],
  { wrap: string; icon: string; dot: string }
> = {
  rose: {
    wrap: 'border-rose-200 bg-rose-50/60',
    icon: 'border-rose-200 bg-white text-rose-600',
    dot: 'bg-rose-500',
  },
  amber: {
    wrap: 'border-amber-200 bg-amber-50/60',
    icon: 'border-amber-200 bg-white text-amber-600',
    dot: 'bg-amber-500',
  },
  emerald: {
    wrap: 'border-emerald-200 bg-emerald-50/60',
    icon: 'border-emerald-200 bg-white text-emerald-600',
    dot: 'bg-emerald-500',
  },
  slate: {
    wrap: 'border-slate-200 bg-slate-50/70',
    icon: 'border-slate-200 bg-white text-slate-500',
    dot: 'bg-slate-400',
  },
};

const iconFor = {
  conflict: ShieldAlert,
  quota: AlertTriangle,
  admission: CheckCircle2,
  seed: Activity,
  capacity: Lock,
};

function relativeTime(value: string | null): string {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date);
}

function buildAlerts(
  logs: AuditLog[],
  intake: IntakeRow[],
  academicYear: string,
): NotificationItem[] {
  const names = new Map(intake.map((row) => [row.institution_id, row.institution_name]));
  const alerts: NotificationItem[] = [];

  for (const row of intake) {
    if (row.utilization_percent >= 95) {
      alerts.push({
        id: `capacity-${row.institution_id}`,
        title: `Sanctioned intake limit reached ${row.utilization_percent.toFixed(0)}%`,
        body: `${row.institution_name} (${row.institution_id}) is holding ${row.current_enrolled}/${row.sanctioned_intake} approved seats for ${academicYear}.`,
        time: null,
        tone: 'amber',
        kind: 'capacity',
      });
    }
  }

  for (const log of logs.slice(0, 10)) {
    if (log.event_type === 'CONCURRENCY_CONFLICT') {
      const blockedAt =
        names.get(log.conflicting_institution_id ?? '') ??
        log.conflicting_institution_id ??
        'another college';
      alerts.push({
        id: `log-${log.id}`,
        title: `Seat conflict flagged for ${blockedAt}`,
        body: `${log.apaar_id ?? 'An APAAR ID'}${log.student_name ? ` · ${log.student_name}` : ''} already holds an active seat. Duplicate enrollment was blocked for ${academicYear}.`,
        time: log.created_at,
        tone: 'rose',
        kind: 'conflict',
      });
    } else if (log.event_type === 'QUOTA_BLOCK') {
      alerts.push({
        id: `log-${log.id}`,
        title: 'Quota guard blocked a batch',
        body: log.detail,
        time: log.created_at,
        tone: 'amber',
        kind: 'quota',
      });
    } else if (log.event_type === 'ENROLLMENT_SUCCESS') {
      alerts.push({
        id: `log-${log.id}`,
        title: 'Batch admission approved',
        body: log.detail,
        time: log.created_at,
        tone: 'emerald',
        kind: 'admission',
      });
    } else {
      alerts.push({
        id: `log-${log.id}`,
        title: 'Ledger snapshot anchored',
        body: log.detail,
        time: log.created_at,
        tone: 'slate',
        kind: 'seed',
      });
    }
  }

  return alerts.slice(0, 14);
}

export function useNotifications(academicYear: string) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [intake, setIntake] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [logResponse, intakeResponse] = await Promise.all([
          api.get<AuditLog[]>(endpoints.auditLogs(academicYear, 20)),
          api.get<IntakeRow[]>(endpoints.intake(academicYear)),
        ]);
        if (!active) return;
        setLogs(logResponse.data);
        setIntake(intakeResponse.data);
      } catch {
        if (!active) return;
        setLogs([]);
        setIntake([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    const onRefresh = () => void load();
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh);
    };
  }, [academicYear]);

  const alerts = useMemo(() => buildAlerts(logs, intake, academicYear), [logs, intake, academicYear]);
  return { alerts, loading };
}

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  alerts: NotificationItem[];
  loading: boolean;
}

export default function NotificationsDrawer({
  open,
  onClose,
  alerts,
  loading,
}: NotificationsDrawerProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-hidden="true"
        onMouseDown={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="absolute inset-y-0 left-0 flex w-full max-w-[390px] animate-slide-in-left flex-col border-r border-slate-200 bg-white shadow-pop"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live ledger alerts
            </p>
            <h2 className="font-display mt-1 text-lg font-bold tracking-tight text-[#0F172A]">
              Notifications
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {alerts.length} alert{alerts.length === 1 ? '' : 's'} · refreshes every 30s
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close notifications">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto bg-slate-50/60 p-3">
          {loading && alerts.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2].map((key) => (
                <div key={key} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-700">No alerts for this cycle</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Upload a roster or trigger a guard stop to see live ledger notifications.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alert) => {
                const theme = toneStyles[alert.tone];
                const Icon = iconFor[alert.kind];
                return (
                  <li
                    key={alert.id}
                    className={`flex gap-3 rounded-xl border p-3 ${theme.wrap}`}
                  >
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${theme.icon}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold leading-snug text-[#0F172A]">
                          {alert.title}
                        </p>
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} />
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{alert.body}</p>
                      <p className="mt-1.5 text-[10px] font-medium text-slate-400">
                        {relativeTime(alert.time)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/oversight');
            }}
            className="btn-ghost w-full justify-between text-xs"
          >
            Open oversight audit stream
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-slate-400">
            Alerts are derived from the national audit ledger and current sanctioned-intake
            utilisation for the selected academic year.
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
