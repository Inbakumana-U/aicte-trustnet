import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CalendarDays,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Fingerprint,
  Hash,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  QrCode,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react';
import {
  api,
  endpoints,
  parseUploadFailure,
  type ApexKey,
  type CredentialEnvelope,
  type CredentialRecord,
  type SampleCredential,
} from '../lib/api';
import {
  INVALID_SIGNATURE_MESSAGE,
  extractCredential,
  verifyCredentialLocally,
} from '../lib/credential';
import {
  formatRecordDate,
  formatRecordDateTime,
  fromCredentialEnvelope,
  fromCredentialRecord,
  type OfficialRecord,
} from '../lib/official-record';
import { downloadVerificationCertificate } from '../lib/certificate';
import { useInstitutions } from '../lib/institution';

type VerificationSource = 'form' | 'camera' | 'file' | 'sample' | 'pass';

interface VerificationResult {
  status: 'valid' | 'invalid' | 'error';
  record: OfficialRecord | null;
  credential: CredentialEnvelope | null;
  reason: string;
  checkedAt: Date;
  source: VerificationSource;
  note?: string | null;
}

const sourceLabels: Record<VerificationSource, string> = {
  form: 'Ledger data lookup',
  camera: 'Live camera scan',
  file: 'QR image upload',
  sample: 'Apex sample credential',
  pass: 'Signed QR pass',
};

export default function PublicVerifier() {
  const { academicYear, academicYears, institutions } = useInstitutions();
  const [apexKey, setApexKey] = useState<ApexKey | null>(null);
  const [keySource, setKeySource] = useState<'live' | 'cache' | 'none'>('none');
  const [apaar, setApaar] = useState('');
  const [studentName, setStudentName] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [year, setYear] = useState<string>(academicYear);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fileScanning, setFileScanning] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoVerified = useRef(false);

  useEffect(() => {
    setYear(academicYear);
  }, [academicYear]);

  useEffect(() => {
    let cached: ApexKey | null = null;
    try {
      const raw = localStorage.getItem('trustnet:apex-key');
      if (raw) cached = JSON.parse(raw) as ApexKey;
    } catch {
      cached = null;
    }
    if (cached) {
      setApexKey(cached);
      setKeySource('cache');
    }

    api
      .get<ApexKey>(endpoints.apexKey)
      .then(({ data }) => {
        setApexKey(data);
        setKeySource('live');
        localStorage.setItem('trustnet:apex-key', JSON.stringify(data));
      })
      .catch(() => {
        if (!cached) setKeySource('none');
      });
  }, []);

  const stopScan = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
        scanner.clear();
      } catch {
        /* scanner already torn down */
      }
    }
    setScanning(false);
  }, []);

  const verifyEnvelope = useCallback(
    async (credential: CredentialEnvelope, source: VerificationSource) => {
      setVerifying(true);
      setCameraError(null);
      const checkedAt = new Date();
      try {
        if (!apexKey) {
          setResult({
            status: 'error',
            record: null,
            credential,
            reason:
              'Apex public key is not available. Connect to the AICTE key endpoint once to verify offline.',
            checkedAt,
            source,
          });
          return;
        }

        let valid = false;
        try {
          valid = verifyCredentialLocally(credential, apexKey.public_key);
        } catch (error) {
          setResult({
            status: 'error',
            record: null,
            credential,
            reason:
              error instanceof Error
                ? error.message
                : 'This credential could not be parsed for verification.',
            checkedAt,
            source,
          });
          return;
        }

        const payloadRecord = fromCredentialEnvelope(credential);
        if (!valid) {
          setResult({
            status: 'invalid',
            record: payloadRecord,
            credential,
            reason: INVALID_SIGNATURE_MESSAGE,
            checkedAt,
            source,
          });
          return;
        }

        let record = payloadRecord;
        let note: string | null = null;
        try {
          const { data } = await api.get<CredentialRecord>(
            endpoints.credentialLookup({
              apaar_id: payloadRecord.apaar || undefined,
              institution_id: payloadRecord.institution_id || undefined,
              academic_year: payloadRecord.academic_year || undefined,
            }),
          );
          record = fromCredentialRecord(data);
        } catch {
          note =
            'The Ed25519 signature is authentic, but the ledger metadata for this credential could not be enriched.';
        }

        setResult({
          status: 'valid',
          record,
          credential,
          reason:
            'The detached Ed25519 signature matches the AICTE apex key and the credential payload is intact.',
          checkedAt,
          source,
          note,
        });
      } finally {
        setVerifying(false);
      }
    },
    [apexKey],
  );

  const verifyScanned = useCallback(
    (raw: string, source: VerificationSource) => {
      try {
        const credential = extractCredential(raw);
        setApaar(String(credential.payload.apaar ?? ''));
        setInstitutionId(String(credential.payload.inst ?? ''));
        if (credential.payload.yr) setYear(String(credential.payload.yr));
        setFormError(null);
        void verifyEnvelope(credential, source);
      } catch (error) {
        setResult({
          status: 'error',
          record: null,
          credential: null,
          reason:
            error instanceof Error
              ? error.message
              : 'This QR payload could not be parsed as an AICTE credential.',
          checkedAt: new Date(),
          source,
        });
      }
    },
    [verifyEnvelope],
  );

  useEffect(() => {
    if (!apexKey || autoVerified.current) return;
    const pending = sessionStorage.getItem('trustnet:pending-credential');
    if (!pending) return;
    autoVerified.current = true;
    sessionStorage.removeItem('trustnet:pending-credential');
    verifyScanned(pending, 'pass');
  }, [apexKey, verifyScanned]);

  useEffect(() => {
    return () => {
      void stopScan();
    };
  }, [stopScan]);

  const startScan = useCallback(async () => {
    setCameraError(null);
    if (scannerRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not expose a camera API. Use QR image upload instead.');
      return;
    }
    const scanner = new Html5Qrcode('qr-reader', { verbose: false });
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 232, height: 232 } },
        (decoded) => {
          void stopScan();
          verifyScanned(decoded, 'camera');
        },
        () => {
          /* per-frame decode misses are expected */
        },
      );
      setScanning(true);
    } catch (error) {
      scannerRef.current = null;
      setScanning(false);
      try {
        scanner.clear();
      } catch {
        /* nothing to clear */
      }
      const message = error instanceof Error ? error.message : 'Camera could not be started.';
      setCameraError(
        `${message} — grant camera permission, or upload a QR image instead.`,
      );
    }
  }, [stopScan, verifyScanned]);

  const scanImage = async (file: File | null) => {
    if (!file) return;
    setCameraError(null);
    setFileScanning(true);
    const scanner = new Html5Qrcode('qr-file-scan', { verbose: false });
    try {
      const decoded = await scanner.scanFile(file, false);
      verifyScanned(decoded, 'file');
    } catch {
      setCameraError('No readable AICTE credential found in that image. Try a sharper QR photo.');
    } finally {
      try {
        scanner.clear();
      } catch {
        /* container may already be cleared */
      }
      setFileScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (verifying) return;
    const cleanApaar = apaar.replace(/\s+/g, '');
    const cleanName = studentName.trim();
    if (!cleanApaar && !cleanName) {
      setFormError('Enter an APAAR ID or a student name to verify.');
      return;
    }
    if (cleanApaar && !/^\d{12}$/.test(cleanApaar)) {
      setFormError('APAAR ID must be exactly 12 numeric digits.');
      return;
    }
    setFormError(null);
    setResult(null);
    setVerifying(true);
    const checkedAt = new Date();
    try {
      const { data } = await api.get<CredentialRecord>(
        endpoints.credentialLookup({
          apaar_id: cleanApaar || undefined,
          student_name: cleanName || undefined,
          institution_id: institutionId.trim() || undefined,
          academic_year: year,
        }),
      );

      if (!apexKey) {
        setResult({
          status: 'error',
          record: fromCredentialRecord(data),
          credential: data.credential,
          reason:
            'Apex public key is not available. Connect to the AICTE key endpoint once to verify offline.',
          checkedAt,
          source: 'form',
        });
        return;
      }

      let valid = false;
      try {
        valid = verifyCredentialLocally(data.credential, apexKey.public_key);
      } catch {
        valid = false;
      }

      setResult({
        status: valid ? 'valid' : 'invalid',
        record: fromCredentialRecord(data),
        credential: data.credential,
        reason: valid
          ? 'The detached Ed25519 signature matches the AICTE apex key and the credential payload is intact.'
          : INVALID_SIGNATURE_MESSAGE,
        checkedAt,
        source: 'form',
      });
    } catch (error: unknown) {
      const failure = parseUploadFailure(error);
      setResult({
        status: 'error',
        record: null,
        credential: null,
        reason: failure.message,
        checkedAt,
        source: 'form',
      });
    } finally {
      setVerifying(false);
    }
  };

  const loadSample = async () => {
    setLoadingSample(true);
    setCameraError(null);
    setFormError(null);
    try {
      const { data } = await api.get<SampleCredential>(endpoints.sampleCredential(year));
      setApaar(String(data.credential.payload.apaar ?? ''));
      setStudentName(data.student_name);
      setInstitutionId(data.institution_id);
      setYear(data.academic_year);
      await verifyEnvelope(data.credential, 'sample');
    } catch {
      setCameraError(
        'Could not fetch a sample credential. Upload a roster in the Registrar portal first.',
      );
    } finally {
      setLoadingSample(false);
    }
  };

  const reset = () => {
    void stopScan();
    setResult(null);
    setFormError(null);
    setCameraError(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
            <ScanLine className="h-3.5 w-3.5" /> Public verifier
          </p>
          <h1 className="font-display mt-1.5 text-2xl font-extrabold tracking-tight text-[#0F172A] sm:text-3xl">
            Verify an academic credential
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Enter the student's details or scan the signed QR pass. The Ed25519 signature is checked
            locally against the AICTE apex public key — the backend is never trusted with the
            verdict.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`chip ${
              keySource === 'live'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : keySource === 'cache'
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {keySource === 'live'
              ? 'Apex key live'
              : keySource === 'cache'
                ? 'Apex key cached'
                : 'Fetching apex key'}
          </span>
          <span className="chip border-slate-200 bg-white text-slate-600">
            <Lock className="h-3.5 w-3.5" /> Offline signature check
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="panel-title flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600" /> Credential data entry
              </h2>
              <p className="panel-subtitle">
                Resolve the identity from the national APAAR ledger, then prove the signature
              </p>
            </div>
            <span className="chip border-indigo-200 bg-indigo-50 text-indigo-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Ed25519
            </span>
          </div>

          <form onSubmit={submitForm} className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="apaar" className="label mb-1.5 block">
                  APAAR ID
                </label>
                <div className="relative">
                  <Hash className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="apaar"
                    value={apaar}
                    onChange={(event) => setApaar(event.target.value)}
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="12-digit APAAR"
                    className="input mono pl-9 text-xs"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="student-name" className="label mb-1.5 block">
                  Student Name
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="student-name"
                    value={studentName}
                    onChange={(event) => setStudentName(event.target.value)}
                    placeholder="Full name as enrolled"
                    className="input pl-9 text-xs"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="institution-code" className="label mb-1.5 block">
                  Institution Code
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="institution-code"
                    list="institution-codes"
                    value={institutionId}
                    onChange={(event) => setInstitutionId(event.target.value)}
                    placeholder="AICTE-TN-1042 (optional)"
                    className="input mono pl-9 text-xs"
                  />
                  <datalist id="institution-codes">
                    {institutions.map((institution) => (
                      <option key={institution.institution_id} value={institution.institution_id}>
                        {institution.institution_name}
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label htmlFor="academic-year" className="label mb-1.5 block">
                  Academic Year
                </label>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <select
                    id="academic-year"
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                    className="input appearance-none pl-9 pr-8 text-xs"
                  >
                    {academicYears.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    ▾
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Provide an APAAR ID or the enrolled student name. Institution code and academic year
              narrow the ledger lookup.
            </p>

            {formError ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-700"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={verifying} className="btn-primary">
                {verifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {verifying ? 'Verifying Credential' : 'Verify Credential'}
              </button>
              <button
                type="button"
                onClick={() => void loadSample()}
                disabled={loadingSample || verifying}
                className="btn-soft"
              >
                {loadingSample ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Load sample
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={!result && !formError}
                className="btn-ghost ml-auto"
              >
                <RotateCcw className="h-4 w-4" /> Clear
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
              <Fingerprint className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
              Canonical JSON + detached Ed25519 signature · any altered field invalidates the record
            </div>
          </form>
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="panel-title flex items-center gap-2">
                <Camera className="h-4 w-4 text-indigo-600" /> Optical verification
              </h2>
              <p className="panel-subtitle">Point the camera at an Apex-signed QR credential</p>
            </div>
            <span
              className={`chip ${
                scanning
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              {scanning ? 'Scanning' : 'Idle'}
            </span>
          </div>

          <div className="p-4 sm:p-5">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
              <div id="qr-reader" className="absolute inset-0" />
              <span className="pointer-events-none absolute left-4 top-4 h-8 w-8 rounded-tl-lg border-l-2 border-t-2 border-indigo-400" />
              <span className="pointer-events-none absolute right-4 top-4 h-8 w-8 rounded-tr-lg border-r-2 border-t-2 border-indigo-400" />
              <span className="pointer-events-none absolute bottom-4 left-4 h-8 w-8 rounded-bl-lg border-b-2 border-l-2 border-indigo-400" />
              <span className="pointer-events-none absolute bottom-4 right-4 h-8 w-8 rounded-br-lg border-b-2 border-r-2 border-indigo-400" />

              {!scanning ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-white/10 text-indigo-200">
                      <QrCode className="h-7 w-7" />
                    </span>
                    <p className="mt-3 text-xs font-medium text-slate-300">
                      Camera is off — start a scan below
                    </p>
                  </div>
                </div>
              ) : (
                <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                  Align the QR inside the frame
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {scanning ? (
                <button type="button" onClick={() => void stopScan()} className="btn-danger">
                  <CameraOff className="h-4 w-4" /> Stop camera
                </button>
              ) : (
                <button type="button" onClick={() => void startScan()} className="btn-primary">
                  <Camera className="h-4 w-4" /> Start camera scan
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-ghost"
                disabled={fileScanning}
              >
                {fileScanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {fileScanning ? 'Decoding image' : 'Upload QR image'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void scanImage(event.target.files?.[0] ?? null)}
              />
              <div id="qr-file-scan" className="hidden" />
            </div>

            {cameraError ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {cameraError}
              </p>
            ) : (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Camera access needs a secure context (localhost qualifies). Scanned credentials are
                checked locally and enriched from the ledger automatically.
              </p>
            )}
          </div>
        </div>
      </div>

      {verifying ? (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-medium text-indigo-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying signature against the AICTE apex key…
        </div>
      ) : null}

      {result?.status === 'valid' && result.record ? (
        <OfficialRecordCard result={result} record={result.record} apexKey={apexKey} onReset={reset} />
      ) : result ? (
        <VerificationFailure result={result} />
      ) : (
        <EmptyVerifier />
      )}
    </div>
  );
}

function OfficialRecordCard({
  result,
  record,
  apexKey,
  onReset,
}: {
  result: VerificationResult;
  record: OfficialRecord;
  apexKey: ApexKey | null;
  onReset: () => void;
}) {
  const download = () => {
    downloadVerificationCertificate(record, {
      checkedAt: result.checkedAt,
      keyFingerprint: apexKey?.key_fingerprint ?? null,
    });
  };

  const facts: { label: string; value: string; tone?: 'green' }[] = [
    { label: 'Student Name', value: record.student_name || '—' },
    { label: 'APAAR ID', value: record.apaar || '—' },
    { label: 'Date of Birth', value: formatRecordDate(record.dob) },
    { label: 'Institution Code', value: record.institution_id || '—' },
    { label: 'Institution', value: record.institution_name ?? record.institution_id },
    { label: 'Programme', value: record.course_name ?? '—' },
    { label: 'Academic Year', value: record.academic_year || '—' },
    { label: 'Seat Status', value: record.status || '—', tone: 'green' },
    { label: 'Credential Issued', value: formatRecordDateTime(record.issued_at) },
    { label: 'Verification Checked', value: formatRecordDateTime(result.checkedAt) },
  ];

  return (
    <section className="panel animate-fade-up overflow-hidden" aria-label="Academic Verification Record">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/80 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-200 bg-white text-emerald-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-emerald-900">Academic Verification Record</p>
            <p className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-700">
              <span className="inline-flex items-center gap-1 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" /> Cryptographically Verified via Ed25519
              </span>
              <span className="text-emerald-400">·</span>
              <span>{sourceLabels[result.source]}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={download} className="btn-primary">
            <Download className="h-4 w-4" /> Download Official Verification Certificate
          </button>
          <button type="button" onClick={onReset} className="btn-ghost">
            <RotateCcw className="h-4 w-4" /> Verify another
          </button>
        </div>
      </div>

      {result.note ? (
        <p className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-700 sm:px-5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {result.note}
        </p>
      ) : null}

      <div className="relative overflow-hidden bg-slate-100/70 p-2.5 sm:p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden"
        >
          <span className="font-display -rotate-[24deg] select-none text-[110px] font-black tracking-[0.18em] text-slate-900/[0.035] sm:text-[170px]">
            AICTE
          </span>
        </div>

        <article className="relative mx-auto max-w-4xl border-[3px] border-double border-slate-400 bg-white px-4 py-5 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.5)] sm:px-7 sm:py-6">
          <div className="flex items-center justify-center gap-3 border-b border-slate-200 pb-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-indigo-700 bg-indigo-50">
              <img src="/shield.svg" alt="" className="h-6 w-6" />
            </span>
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600 sm:text-[10px]">
                All India Council for Technical Education
              </p>
              <p className="mt-0.5 text-[10px] font-semibold text-indigo-700">
                AICTE-TrustNet · National APAAR Credential Ledger
              </p>
            </div>
          </div>

          <div className="mt-4 text-center">
            <h2 className="font-serif text-lg font-bold uppercase tracking-[0.14em] text-[#0F172A] sm:text-xl">
              Academic Verification Record
            </h2>
            <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Official cryptographic attestation of an approved academic seat
            </p>
            <p className="mono mt-2 text-[10px] text-slate-500">
              Reference&nbsp;
              <span className="font-semibold text-slate-700">{record.reference}</span>
            </p>
          </div>

          <div className="mt-4 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Cryptographically Verified via Ed25519
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-slate-300 bg-slate-300 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="bg-white px-3 py-2.5">
                <dt className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  {fact.label}
                </dt>
                <dd
                  className={[
                    'mt-1 break-words text-[11px] font-semibold sm:text-xs',
                    fact.tone === 'green' ? 'text-emerald-700' : 'text-[#0F172A]',
                  ].join(' ')}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 grid gap-4 border-t border-slate-200 pt-3 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0 space-y-2">
              <div>
                <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  Apex key fingerprint
                </p>
                <p className="mono mt-0.5 break-all text-[9px] leading-relaxed text-slate-600">
                  {apexKey?.key_fingerprint ?? 'Unavailable at verification'}
                </p>
              </div>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  Detached Ed25519 signature
                </p>
                <p className="mono mt-0.5 break-all text-[9px] leading-relaxed text-slate-500">
                  {record.credential.signature.slice(0, 80)}…
                </p>
              </div>
              <p className="flex items-start gap-1.5 text-[9px] leading-relaxed text-slate-500">
                <Lock className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                Verified locally in this browser. Canonical JSON binds the APAAR ID, institution,
                academic year and seat status; any alteration invalidates this attestation.
              </p>
            </div>
            {record.qr_code_url ? (
              <figure className="justify-self-start sm:justify-self-end">
                <img
                  src={record.qr_code_url}
                  alt={`Scannable credential QR for ${record.apaar}`}
                  className="h-24 w-24 rounded border border-slate-200 bg-white p-1"
                />
                <figcaption className="mt-1 text-center text-[8px] font-medium uppercase tracking-wide text-slate-400">
                  Scan to re-verify
                </figcaption>
              </figure>
            ) : null}
          </div>

          <div className="mt-4 border-t border-dashed border-slate-300 pt-2 text-center">
            <p className="text-[9px] text-slate-500">
              Computer-generated record · AICTE-TrustNet · SIH26263 prototype
            </p>
            <p className="mono mt-0.5 text-[9px] text-slate-400">
              Verified {formatRecordDateTime(result.checkedAt)}
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

function VerificationFailure({ result }: { result: VerificationResult }) {
  const isInvalid = result.status === 'invalid';
  const notFound = !isInvalid && result.reason.toLowerCase().startsWith('no signed credential');
  const theme = isInvalid
    ? {
        wrap: 'border-rose-200 bg-rose-50',
        icon: 'border-rose-200 bg-white text-rose-600',
        title: 'text-rose-900',
        sub: 'text-rose-700',
        chip: 'border-rose-200 bg-white text-rose-700',
        Icon: ShieldOff,
        heading: 'Tamper / Fraud Detected',
        subheading: 'Cryptographic signature mismatch',
      }
    : {
        wrap: 'border-amber-200 bg-amber-50',
        icon: 'border-amber-200 bg-white text-amber-600',
        title: 'text-amber-900',
        sub: 'text-amber-700',
        chip: 'border-amber-200 bg-white text-amber-700',
        Icon: AlertCircle,
        heading: notFound ? 'No matching credential' : 'Verification unavailable',
        subheading: notFound ? 'The ledger returned no signed record' : 'Credential could not be checked',
      };

  return (
    <div
      className={`animate-fade-up overflow-hidden rounded-2xl border shadow-[0_1px_3px_rgba(15,23,42,0.05)] ${theme.wrap}`}
      role="status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${theme.icon}`}>
            <theme.Icon className="h-5 w-5" />
          </span>
          <div>
            <p className={`font-display text-base font-bold tracking-tight ${theme.title}`}>
              {theme.heading}
            </p>
            <p className={`mt-0.5 text-xs font-medium ${theme.sub}`}>{theme.subheading}</p>
            <p className={`mt-1.5 max-w-2xl text-xs leading-relaxed ${theme.sub}`}>{result.reason}</p>
          </div>
        </div>
        <span className={`chip ${theme.chip}`}>{sourceLabels[result.source]}</span>
      </div>

      {isInvalid && result.credential ? (
        <div className="grid gap-px border-t border-rose-200 bg-rose-200 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'APAAR ID', value: result.credential.payload.apaar },
            { label: 'Institution', value: result.credential.payload.inst },
            { label: 'Academic year', value: result.credential.payload.yr },
            { label: 'Claimed status', value: result.credential.payload.status },
          ].map((item) => (
            <div key={item.label} className="bg-white px-4 py-3">
              <p className="label">{item.label}</p>
              <p className="mono mt-1 break-all text-xs text-[#0F172A]">
                {String(item.value ?? '—')}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-200 bg-white/70 px-4 py-2.5 text-[10px] text-slate-500 sm:px-5">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Checked {result.checkedAt.toLocaleTimeString('en-IN')}
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" /> Verified locally in this browser
        </span>
        <span className="flex items-center gap-1.5">
          <Landmark className="h-3.5 w-3.5" /> AICTE apex authority
        </span>
      </div>
    </div>
  );
}

function EmptyVerifier() {
  return (
    <div className="panel px-4 py-6 sm:px-5">
      <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-3">
        {[
          {
            icon: FileText,
            title: '1 · Enter details',
            body: 'Provide an APAAR ID or enrolled name to resolve the credential from the national ledger.',
          },
          {
            icon: ScanLine,
            title: '2 · Scan the QR',
            body: 'Decode the signed pass locally with the camera or a QR image — nothing leaves the browser.',
          },
          {
            icon: ShieldCheck,
            title: '3 · Official record',
            body: 'A government-format Academic Verification Record is issued and can be downloaded as a PDF.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-[#0F172A]">{title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
