import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileUp,
  Fingerprint,
  Gauge,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import CapacityProgress from '../components/CapacityProgress';
import { NOTIFICATIONS_REFRESH_EVENT } from '../components/NotificationsDrawer';
import QRModal from '../components/QRModal';
import StatCard from '../components/StatCard';
import { useInstitutions } from '../lib/institution';
import {
  API_BASE,
  api,
  endpoints,
  parseUploadFailure,
  type BatchUploadResult,
  type CredentialRecord,
  type EnrolledStudent,
  type UploadFailure,
} from '../lib/api';

const RESET_TOKEN = 'trustnet-reset';
const SAMPLE_FILES = [
  {
    name: '01_valid_roster.csv',
    title: 'Valid roster',
    description: '2 valid APAAR IDs — fills TN-1042 to 60/60 in 2026-2027.',
  },
  {
    name: '02_quota_overflow.csv',
    title: 'Quota overflow',
    description: '5 students against the 2-seat headroom in 2026-2027 — HTTP 422.',
  },
  {
    name: '03_concurrency_collision.csv',
    title: 'Concurrency collision',
    description: 'APAAR 234567890124 holds a Pune seat — HTTP 409.',
  },
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function recordToStudent(record: CredentialRecord): EnrolledStudent {
  return {
    enrollment_id: record.enrollment_id,
    apaar_id: record.apaar_id,
    student_name: record.student_name,
    dob: record.dob,
    institution_id: record.institution_id,
    academic_year: record.academic_year,
    status: record.status,
    signed_payload: JSON.stringify(record.credential),
    credential: record.credential,
    qr_code_url: record.qr_code_url,
    payload_summary: {
      apaar: String(record.credential.payload.apaar ?? record.apaar_id),
      institution: String(record.credential.payload.inst ?? record.institution_id),
      academic_year: String(record.credential.payload.yr ?? record.academic_year),
      status: String(record.credential.payload.status ?? record.status),
    },
    created_at: record.created_at,
  };
}

export default function RegistrarPortal() {
  const {
    institutions,
    selectedId,
    selected,
    academicYear,
    selectInstitution,
    error: institutionsError,
    refresh,
  } = useInstitutions();
  const [searchParams, setSearchParams] = useSearchParams();
  const studentParam = searchParams.get('student');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<BatchUploadResult | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [recent, setRecent] = useState<EnrolledStudent[]>([]);
  const [modalStudent, setModalStudent] = useState<EnrolledStudent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const institutionName = useCallback(
    (id: string) => institutions.find((item) => item.institution_id === id)?.institution_name ?? id,
    [institutions],
  );

  const loadRecent = useCallback(async (institutionId: string, year: string) => {
    if (!institutionId) return;
    try {
      const { data } = await api.get<EnrolledStudent[]>(
        endpoints.enrollments(institutionId, 8, year),
      );
      setRecent(data);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    if (institutionsError) setFailure({ status: 0, message: institutionsError });
  }, [institutionsError]);

  useEffect(() => {
    if (!selectedId) return;
    setResult(null);
    setFailure(null);
    setFile(null);
    void loadRecent(selectedId, academicYear);
  }, [selectedId, academicYear, loadRecent]);

  useEffect(() => {
    if (!studentParam) return;
    let active = true;
    api
      .get<CredentialRecord>(
        endpoints.credentialLookup({ apaar_id: studentParam, academic_year: academicYear }),
      )
      .then(({ data }) => {
        if (!active) return;
        if (data.institution_id !== selectedId) selectInstitution(data.institution_id);
        setModalStudent(recordToStudent(data));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailure(parseUploadFailure(error));
      })
      .finally(() => {
        if (!active) return;
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('student');
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      active = false;
    };
  }, [studentParam, academicYear, selectedId, selectInstitution, setSearchParams]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const pickFile = (candidate: File | null) => {
    if (!candidate) return;
    if (!/\.(csv|xlsx|xls)$/i.test(candidate.name)) {
      setFailure({
        status: 0,
        message: `Unsupported file "${candidate.name}". Upload a CSV or XLSX roster.`,
      });
      return;
    }
    setFile(candidate);
    setFailure(null);
    setResult(null);
  };

  const submit = async () => {
    if (!file || !selected) return;
    setUploading(true);
    setFailure(null);
    setResult(null);
    const form = new FormData();
    form.append('institution_id', selected.institution_id);
    form.append('academic_year', academicYear);
    form.append('file', file);

    try {
      const { data } = await api.post<BatchUploadResult>(endpoints.batchUpload, form);
      setResult(data);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setNotice(
        `${data.enrolled_count} credential${data.enrolled_count === 1 ? '' : 's'} issued · ledger now ${data.seats_filled}/${data.sanctioned_intake} for ${data.academic_year}`,
      );
      await Promise.all([refresh(), loadRecent(data.institution_id, data.academic_year)]);
      window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
    } catch (error: unknown) {
      setFailure(parseUploadFailure(error));
      await Promise.all([refresh(), loadRecent(selected.institution_id, academicYear)]);
      window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
    } finally {
      setUploading(false);
    }
  };

  const resetDemo = async () => {
    if (resetting) return;
    if (
      !window.confirm(
        'Reset the demo ledger? This restores 158 seeded seats and clears audit history.',
      )
    ) {
      return;
    }
    setResetting(true);
    setResult(null);
    setFailure(null);
    setFile(null);
    try {
      await api.post(endpoints.reset(RESET_TOKEN));
      await refresh();
      await loadRecent(selectedId, academicYear);
      setNotice(`Demo ledger restored — sanctions and rosters reloaded for ${academicYear}.`);
      window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
    } catch (error: unknown) {
      setFailure(parseUploadFailure(error));
    } finally {
      setResetting(false);
    }
  };

  const downloadSample = async (name: string) => {
    try {
      const response = await fetch(`${API_BASE}/samples/${name}`);
      if (!response.ok) throw new Error('Sample unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setFailure({
        status: 0,
        message: 'Could not download the sample roster. Confirm the backend is running.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
            <FileUp className="h-3.5 w-3.5" /> Admissions workspace
          </p>
          <h1 className="font-display mt-1.5 text-2xl font-extrabold tracking-tight text-[#0F172A] sm:text-3xl">
            Registrar portal
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Update student details for {selected?.institution_name ?? 'your college'} ·{' '}
            {academicYear}. Every row is checksum-verified, checked against the national APAAR
            ledger and signed with the AICTE apex Ed25519 key.
          </p>
        </div>
        <button type="button" onClick={resetDemo} className="btn-ghost" disabled={resetting}>
          {resetting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Reset demo
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sanctioned intake"
          value={selected?.sanctioned_intake ?? '—'}
          icon={Building2}
          accent="blue"
          hint={`Approved seats · ${academicYear}`}
        />
        <StatCard
          label="Confirmed seats"
          value={selected?.current_enrolled ?? '—'}
          icon={UserCheck}
          accent="emerald"
          hint={`${selected?.utilization_percent?.toFixed(1) ?? '0.0'}% of sanctioned intake filled · ${academicYear}`}
        />
        <StatCard
          label="Remaining quota"
          value={selected?.seats_remaining ?? '—'}
          icon={Gauge}
          accent="amber"
          hint={`Seats available before the quota guard trips · ${academicYear}`}
        />
      </div>

      {notice ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <CapacityProgress institution={selected} />

        <div className="panel p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label">Guard posture</p>
              <p className="mt-1 text-sm font-semibold text-[#0F172A]">
                Both hard stops are armed
              </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            for {selected?.academic_year ?? academicYear} · pre-flight and database level ·
            scoped to this college only
          </p>
            </div>
            <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Protected
            </span>
          </div>
          <ul className="mt-5 space-y-4">
            {[
              {
                icon: Fingerprint,
                title: 'Verhoeff Mod-10 gate',
                body: 'Rejects any APAAR ID whose check digit was mistyped or forged.',
                tone: 'border-indigo-100 bg-indigo-50 text-indigo-600',
              },
              {
                icon: Users,
                title: 'National concurrency lock',
                body: 'One active seat per APAAR per academic year, enforced by a unique index.',
                tone: 'border-emerald-100 bg-emerald-50 text-emerald-600',
              },
              {
                icon: Lock,
                title: 'Sanctioned intake guard',
                body: 'Batch size is measured against live seat counts before any write.',
                tone: 'border-amber-100 bg-amber-50 text-amber-600',
              },
              {
                icon: ShieldCheck,
                title: 'Ed25519 credential signing',
                body: 'Each admitted student leaves with a scannable QR pass verifiable offline.',
                tone: 'border-blue-100 bg-blue-50 text-blue-600',
              },
            ].map(({ icon: Icon, title, body, tone }) => (
              <li key={title} className="flex gap-3">
                <span
                  className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${tone}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-[#0F172A]">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Quota guard armed
            </span>
            <span className="chip border-indigo-200 bg-indigo-50 text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Concurrency armed
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="panel-title flex items-center gap-2">
                <FileUp className="h-4 w-4 text-indigo-600" /> Details Updation
              </h2>
              <p className="panel-subtitle">
                CSV or XLSX · required columns: apaar_id, student_name, dob · {academicYear}
              </p>
            </div>
            <span className="chip border-slate-200 bg-slate-50 text-slate-600">Max 5 MB</span>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pickFile(event.dataTransfer.files?.[0] ?? null);
              }}
              className={[
                'group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white p-8 text-center transition-colors',
                dragging
                  ? 'border-indigo-500 bg-indigo-50/60'
                  : 'border-slate-300 hover:border-indigo-500',
              ].join(' ')}
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-600 transition group-hover:scale-105">
                <UploadCloud className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-semibold text-[#0F172A]">
                {file ? file.name : 'Drop roster here or click to browse'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB · ready for validation`
                  : 'Only CSV, XLSX and XLS files are accepted'}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-[11px] leading-relaxed text-slate-500">
                Records are validated row-by-row. A single invalid APAAR rejects the entire batch —
                no partial admissions.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void downloadSample('01_valid_roster.csv')}
                  className="btn-ghost px-3 py-2 text-xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Sample CSV
                </button>
                {file ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = '';
                    }}
                    className="btn-ghost px-3 py-2 text-xs"
                    disabled={uploading}
                  >
                    <X className="h-3.5 w-3.5" /> Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={submit}
                  className="btn-primary"
                  disabled={!file || uploading || !selected}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {uploading ? 'Validating & signing' : 'Run admission batch'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="panel-title flex items-center gap-2">
                <Download className="h-4 w-4 text-indigo-600" /> Sample rosters
              </h2>
              <p className="panel-subtitle">Pre-computed Verhoeff IDs for every scenario</p>
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {SAMPLE_FILES.map((sample) => (
              <li key={sample.name}>
                <button
                  type="button"
                  onClick={() => void downloadSample(sample.name)}
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 sm:px-5"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 group-hover:border-indigo-200 group-hover:text-indigo-600">
                    <FileSpreadsheet className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-[#0F172A]">
                      {sample.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {sample.description}
                    </span>
                  </span>
                  <Download className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-indigo-600" />
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-500 sm:px-5">
            Upload 01 first to fill TN-1042. Then try 02 for the quota stop and 03 for the
            cross-college collision.
          </p>
        </div>
      </div>

      {failure ? <FailureBanner failure={failure} /> : null}

      {result ? (
        <div className="panel animate-fade-up overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <h2 className="text-sm font-semibold text-emerald-900">
                  {result.enrolled_count} student{result.enrolled_count === 1 ? '' : 's'} admitted and
                  cryptographically signed
                </h2>
                <p className="mt-0.5 text-xs text-emerald-700">
                  {result.institution_name} · ledger {result.seats_filled}/{result.sanctioned_intake}{' '}
                  · {result.seats_remaining} seats remaining
                </p>
              </div>
            </div>
            <span className="chip border-emerald-200 bg-white text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Anchored
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="table-head px-4 py-3 sm:px-5">Student</th>
                  <th className="table-head px-3 py-3">APAAR ID</th>
                  <th className="table-head px-3 py-3">Date of birth</th>
                  <th className="table-head px-3 py-3">Status</th>
                  <th className="table-head px-4 py-3 text-right sm:px-5">Credential</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.students.map((student) => (
                  <tr key={student.enrollment_id} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-[#0F172A] sm:px-5">
                      {student.student_name}
                    </td>
                    <td className="mono px-3 py-3 text-xs text-slate-600">{student.apaar_id}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{student.dob}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      <button
                        type="button"
                        onClick={() => setModalStudent(student)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
                      >
                        <QrCode className="h-3.5 w-3.5" /> View QR badge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        <div className="panel-header">
          <div>
            <h2 className="panel-title flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-500" /> Recent ledger entries
            </h2>
            <p className="panel-subtitle">
              Latest signed seats for {selected?.institution_name ?? 'the selected institution'} ·{' '}
              {academicYear}
            </p>
          </div>
          <span className="chip border-slate-200 bg-slate-50 text-slate-600">
            {recent.length} shown
          </span>
        </div>

        {recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500 sm:px-5">
            No enrollment records yet for this institution in {academicYear}.
          </p>
        ) : (
          <div className="scrollbar-thin max-h-[460px] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="table-head px-4 py-3 sm:px-5">Student</th>
                  <th className="table-head px-3 py-3">APAAR ID</th>
                  <th className="table-head px-3 py-3">Signed at</th>
                  <th className="table-head px-3 py-3">Status</th>
                  <th className="table-head px-4 py-3 text-right sm:px-5">Credential</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((student) => (
                  <tr key={student.enrollment_id} className="transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-[#0F172A] sm:px-5">
                      {student.student_name}
                    </td>
                    <td className="mono px-3 py-3 text-xs text-slate-600">{student.apaar_id}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {formatDate(student.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        Active
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      <button
                        type="button"
                        onClick={() => setModalStudent(student)}
                        disabled={!student.qr_code_url}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <QrCode className="h-3.5 w-3.5" /> View badge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalStudent ? (
        <QRModal
          student={modalStudent}
          institutionName={institutionName(modalStudent.institution_id)}
          onClose={() => setModalStudent(null)}
        />
      ) : null}
    </div>
  );
}

function FailureBanner({ failure }: { failure: UploadFailure }) {
  const isConflict = failure.status === 409;
  const isQuota = failure.status === 422 && !failure.rowErrors;
  const isValidation = Boolean(failure.rowErrors?.length);
  const unreachable = failure.status === 0;

  const headline = isConflict
    ? 'Concurrency conflict — batch rejected'
    : isQuota
      ? 'Quota guard triggered — batch rejected'
      : isValidation
        ? 'Roster validation failed'
        : unreachable
          ? 'Backend unreachable'
          : 'Upload rejected';

  const Icon = isConflict ? ShieldAlert : isValidation ? AlertCircle : AlertTriangle;

  const tone = isQuota
    ? {
        wrap: 'border-amber-200 border-l-amber-500 bg-amber-50 text-amber-900',
        icon: 'border-amber-200 bg-white text-amber-600',
        chip: 'border-amber-200 bg-white text-amber-700',
        detail: 'text-amber-800',
        muted: 'text-amber-700',
      }
    : {
        wrap: 'border-rose-200 border-l-rose-500 bg-rose-50 text-rose-900',
        icon: 'border-rose-200 bg-white text-rose-600',
        chip: 'border-rose-200 bg-white text-rose-700',
        detail: 'text-rose-800',
        muted: 'text-rose-700',
      };

  return (
    <div
      className={`animate-fade-up rounded-2xl border border-l-4 p-4 sm:p-5 ${tone.wrap}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${tone.icon}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{headline}</h2>
            <span className={`chip ${tone.chip}`}>HTTP {failure.status || 'ERR'}</span>
          </div>
          <p className={`mt-1 text-sm leading-relaxed ${tone.detail}`}>{failure.message}</p>

          {failure.conflicts?.length ? (
            <ul className="mt-3 space-y-2">
              {failure.conflicts.map((conflict) => (
                <li
                  key={`${conflict.apaar_id}-${conflict.conflicting_institution_id}`}
                  className="rounded-xl border border-rose-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                      {conflict.apaar_id}
                    </span>
                    <span className="text-xs font-semibold text-slate-800">
                      {conflict.student_name}
                    </span>
                    <span className="text-[11px] text-slate-500">already holds a seat at</span>
                    <span className="text-xs font-semibold text-rose-700">
                      {conflict.conflicting_institution}
                    </span>
                    <span className="mono text-[10px] text-slate-400">
                      {conflict.conflicting_institution_id}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">{conflict.reason}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {failure.rowErrors?.length ? (
            <ul className="mt-3 space-y-1.5">
              {failure.rowErrors.map((row) => (
                <li
                  key={`${row.row}-${row.apaar_id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-[11px]"
                >
                  <span className="chip border-slate-200 bg-slate-50 text-slate-500">
                    row {row.row}
                  </span>
                  <span className="mono text-slate-700">{row.apaar_id}</span>
                  <span className="text-slate-500">{row.error}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {isQuota ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The batch was fully rolled back. Split the roster or request an intake revision — the
              seat ledger was not modified.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
