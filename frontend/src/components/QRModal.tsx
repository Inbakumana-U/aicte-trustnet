import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { EnrolledStudent } from '../lib/api';

interface QRModalProps {
  student: EnrolledStudent;
  institutionName: string;
  onClose: () => void;
}

export default function QRModal({ student, institutionName, onClose }: QRModalProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState<'signature' | 'json' | null>(null);

  useEffect(() => {
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
  }, [onClose]);

  const credential = student.credential;
  const json = credential ? JSON.stringify(credential, null, 2) : '';
  const summary = student.payload_summary;

  const facts = [
    { label: 'APAAR ID', value: summary?.apaar ?? student.apaar_id },
    { label: 'Institution', value: summary?.institution ?? student.institution_id },
    { label: 'Academic year', value: summary?.academic_year ?? student.academic_year },
    { label: 'Seat status', value: summary?.status ?? student.status },
  ];

  const copy = async (value: string, kind: 'signature' | 'json') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  const openInVerifier = () => {
    if (!credential) return;
    sessionStorage.setItem('trustnet:pending-credential', JSON.stringify(credential));
    onClose();
    navigate('/verifier');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/40 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Signed credential for ${student.student_name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl animate-fade-up rounded-2xl border border-slate-200 bg-white shadow-pop">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
              <ShieldCheck className="h-3.5 w-3.5" /> Apex-signed credential
            </p>
            <h2 className="font-display mt-1 truncate text-lg font-bold text-[#0F172A]">
              {student.student_name}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {institutionName} · <span className="mono">{student.institution_id}</span> ·{' '}
              {student.academic_year}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close credential dialog">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            {student.qr_code_url ? (
              <img
                src={student.qr_code_url}
                alt={`Scannable APAAR credential for ${student.apaar_id}`}
                className="mx-auto h-56 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
              />
            ) : (
              <div className="mx-auto grid h-56 w-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-slate-400">
                <div className="text-center">
                  <QrCode className="mx-auto h-10 w-10" />
                  <p className="mt-2 text-xs font-medium">QR badge unavailable</p>
                </div>
              </div>
            )}
            <p className="mt-3 text-center text-[11px] text-slate-500">
              Scannable offline · embeds the signed Ed25519 envelope
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <a
              href={student.qr_code_url ?? '#'}
              download={`APAAR-${student.apaar_id}-pass.png`}
              aria-disabled={!student.qr_code_url}
              onClick={(event) => {
                if (!student.qr_code_url) event.preventDefault();
              }}
              className="btn-primary w-full aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Download Pass
            </a>
            <button
              type="button"
              onClick={openInVerifier}
              disabled={!credential}
              className="btn-ghost w-full"
            >
              <ExternalLink className="h-4 w-4" /> Verify
            </button>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {facts.map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-3">
                <dt className="label">{item.label}</dt>
                <dd className="mono mt-1 truncate text-xs font-medium text-slate-700">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>

          <details className="group mt-5 rounded-xl border border-slate-200 bg-slate-50">
            <summary className="flex list-none cursor-pointer items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                Inspect signed payload &amp; signature
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-200 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="label">Detached Ed25519 signature</p>
                <button
                  type="button"
                  onClick={() => copy(credential?.signature ?? '', 'signature')}
                  disabled={!credential}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 transition hover:text-indigo-700 disabled:opacity-40"
                >
                  {copied === 'signature' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === 'signature' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mono mt-1.5 break-all rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-600">
                {credential?.signature ?? 'No signature attached to this legacy record'}
              </p>

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="label">Credential envelope</p>
                <button
                  type="button"
                  onClick={() => copy(json, 'json')}
                  disabled={!credential}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 transition hover:text-indigo-700 disabled:opacity-40"
                >
                  {copied === 'json' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === 'json' ? 'Copied' : 'Copy JSON'}
                </button>
              </div>
              <pre className="scrollbar-thin mono mt-1.5 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-600">
                {json || '{}'}
              </pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
