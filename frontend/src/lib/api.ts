import axios from 'axios';
import {
  SESSION_EXPIRED_EVENT,
  clearSession,
  getToken,
  type AuthUser,
} from './session';

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 90_000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !(error.config?.url ?? '').includes('/auth/login')
    ) {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  },
);

export type { AuthUser } from './session';

export interface LoginResponse {
  token: string;
  expires_at: string;
  user: AuthUser;
}

export interface Institution {
  institution_id: string;
  institution_name: string;
  course_name: string;
  academic_year: string;
  sanctioned_intake: number;
  current_enrolled: number;
  seats_remaining: number;
  utilization_percent: number;
}

export interface CredentialPayload {
  apaar: string;
  inst: string;
  yr: string;
  status: string;
}

export interface CredentialEnvelope {
  payload: CredentialPayload;
  signature: string;
  algorithm: string;
  issuer: string;
}

export interface PayloadSummary {
  apaar: string;
  institution: string;
  academic_year: string;
  status: string;
}

export interface EnrolledStudent {
  enrollment_id: string;
  apaar_id: string;
  student_name: string;
  dob: string;
  institution_id: string;
  academic_year: string;
  status: string;
  signed_payload: string | null;
  credential: CredentialEnvelope | null;
  qr_code_url: string | null;
  payload_summary: PayloadSummary | null;
  created_at: string | null;
}

export interface CredentialRecord {
  enrollment_id: string;
  apaar_id: string;
  student_name: string;
  dob: string;
  institution_id: string;
  institution_name: string;
  course_name: string;
  academic_year: string;
  status: string;
  credential: CredentialEnvelope;
  qr_code_url: string;
  created_at: string | null;
}

export interface SearchStudent {
  apaar_id: string;
  student_name: string;
  institution_id: string;
  institution_name: string;
  academic_year: string;
}

export interface SearchInstitution {
  institution_id: string;
  institution_name: string;
  course_name: string;
  academic_year: string;
  sanctioned_intake: number;
  current_enrolled: number;
}

export interface SearchResponse {
  students: SearchStudent[];
  institutions: SearchInstitution[];
}

export interface BatchUploadResult {
  institution_id: string;
  institution_name: string;
  academic_year: string;
  enrolled_count: number;
  seats_filled: number;
  sanctioned_intake: number;
  seats_remaining: number;
  students: EnrolledStudent[];
}

export interface ConflictDetail {
  apaar_id: string;
  student_name: string;
  conflicting_institution: string;
  conflicting_institution_id: string;
  reason: string;
}

export interface RosterRowError {
  row: number;
  apaar_id: string;
  student_name?: string;
  error: string;
}

export type UploadFailure = {
  status: number;
  message: string;
  quotaMessage?: string;
  conflicts?: ConflictDetail[];
  rowErrors?: RosterRowError[];
};

export interface AuditLog {
  id: number;
  event_type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  apaar_id: string | null;
  student_name: string | null;
  institution_id: string | null;
  conflicting_institution_id: string | null;
  academic_year: string | null;
  detail: string;
  created_at: string;
}

export interface Overview {
  total_institutions: number;
  total_registered_apaars: number;
  prevented_concurrency_violations: number;
  prevented_quota_violations: number;
  total_sanctioned_seats: number;
  total_seats_filled: number;
  seat_utilization_percent: number;
  active_academic_year: string;
}

export interface IntakeRow {
  institution_id: string;
  institution_name: string;
  course_name: string;
  academic_year: string;
  sanctioned_intake: number;
  current_enrolled: number;
  seats_remaining: number;
  utilization_percent: number;
}

export interface ApexKey {
  issuer: string;
  algorithm: string;
  public_key: string;
  key_fingerprint: string;
  usage: string;
  endpoints: Record<string, string>;
}

export interface SampleCredential {
  student_name: string;
  institution_id: string;
  academic_year: string;
  credential: CredentialEnvelope;
  qr_code_url: string;
}

export function parseUploadFailure(error: unknown): UploadFailure {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const data = error.response?.data as unknown;

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const detail = record.detail;

      if (typeof detail === 'string') {
        return {
          status,
          message: detail,
          conflicts: Array.isArray(record.conflicts)
            ? (record.conflicts as ConflictDetail[])
            : undefined,
        };
      }

      if (detail && typeof detail === 'object') {
        const nested = detail as Record<string, unknown>;
        return {
          status,
          message: typeof nested.detail === 'string' ? nested.detail : 'Roster validation failed',
          rowErrors: Array.isArray(nested.errors) ? (nested.errors as RosterRowError[]) : undefined,
        };
      }
    }

    if (!error.response) {
      return {
        status: 0,
        message:
          'Cannot reach the AICTE-TrustNet API. Confirm the backend is running on http://localhost:8000.',
      };
    }
    return { status, message: error.message };
  }

  return { status: 0, message: error instanceof Error ? error.message : 'Unexpected error' };
}

function withQuery(
  path: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const endpoints = {
  login: '/api/v1/auth/login',
  me: '/api/v1/auth/me',
  institutions: (academicYear?: string) =>
    withQuery('/api/v1/admissions/institutions', { academic_year: academicYear }),
  institution: (institutionId: string, academicYear?: string) =>
    withQuery(`/api/v1/admissions/institutions/${institutionId}`, {
      academic_year: academicYear,
    }),
  enrollments: (institutionId: string, limit = 15, academicYear?: string) =>
    withQuery(`/api/v1/admissions/institutions/${institutionId}/enrollments`, {
      limit,
      academic_year: academicYear,
    }),
  credentialLookup: (params: {
    apaar_id?: string;
    student_name?: string;
    institution_id?: string;
    academic_year?: string;
  }) => withQuery('/api/v1/admissions/credential', params),
  search: (q: string, academicYear?: string, limit = 6) =>
    withQuery('/api/v1/admissions/search', { q, academic_year: academicYear, limit }),
  batchUpload: '/api/v1/admissions/batch-upload',
  sampleCredential: (academicYear?: string) =>
    withQuery('/api/v1/admissions/sample-credential', { academic_year: academicYear }),
  apexKey: '/api/v1/auth/apex-public-key',
  verify: '/api/v1/auth/verify-credential',
  overview: (academicYear?: string) =>
    withQuery('/api/v1/analytics/overview', { academic_year: academicYear }),
  intake: (academicYear?: string) =>
    withQuery('/api/v1/analytics/intake', { academic_year: academicYear }),
  auditLogs: (academicYear?: string, limit = 60, eventType?: string) =>
    withQuery('/api/v1/analytics/audit-logs', {
      limit,
      event_type: eventType,
      academic_year: academicYear,
    }),
  reset: (token: string) => `/api/v1/admin/reset?token=${encodeURIComponent(token)}`,
};
