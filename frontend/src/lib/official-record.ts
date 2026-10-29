import type { CredentialEnvelope, CredentialRecord } from './api';

export interface OfficialRecord {
  apaar: string;
  student_name: string;
  dob: string | null;
  institution_id: string;
  institution_name: string | null;
  course_name: string | null;
  academic_year: string;
  status: string;
  issued_at: string | null;
  qr_code_url: string | null;
  credential: CredentialEnvelope;
  reference: string;
}

export function referenceFor(academicYear: string, apaar: string): string {
  const year = academicYear || 'unknown';
  const suffix = apaar.slice(-6).padStart(6, '0');
  return `AICTE/AVR/${year}/${suffix}`;
}

export function fromCredentialRecord(record: CredentialRecord): OfficialRecord {
  return {
    apaar: record.apaar_id,
    student_name: record.student_name,
    dob: record.dob,
    institution_id: record.institution_id,
    institution_name: record.institution_name,
    course_name: record.course_name,
    academic_year: record.academic_year,
    status: record.status,
    issued_at: record.created_at,
    qr_code_url: record.qr_code_url,
    credential: record.credential,
    reference: referenceFor(record.academic_year, record.apaar_id),
  };
}

export function fromCredentialEnvelope(credential: CredentialEnvelope): OfficialRecord {
  const apaar = String(credential.payload.apaar ?? '');
  const year = String(credential.payload.yr ?? '');
  return {
    apaar,
    student_name: '',
    dob: null,
    institution_id: String(credential.payload.inst ?? ''),
    institution_name: null,
    course_name: null,
    academic_year: year,
    status: String(credential.payload.status ?? ''),
    issued_at: null,
    qr_code_url: null,
    credential,
    reference: referenceFor(year, apaar),
  };
}

export function formatRecordDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatRecordDateTime(value: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
