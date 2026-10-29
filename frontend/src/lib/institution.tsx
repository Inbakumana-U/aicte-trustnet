import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, endpoints, type Institution } from './api';
import { useAuth } from './auth';

const STORAGE_INSTITUTION = 'trustnet:institution';
const STORAGE_YEAR = 'trustnet:academic-year';

export const ACTIVE_ACADEMIC_YEAR = '2026-2027';
export const ACADEMIC_YEARS = [
  { value: '2024-2025', label: '2024–2025', caption: 'Archived cycle' },
  { value: '2025-2026', label: '2025–2026', caption: 'Previous cycle' },
  { value: '2026-2027', label: '2026–2027', caption: 'Current cycle' },
] as const;

export type AcademicYear = (typeof ACADEMIC_YEARS)[number]['value'];

interface InstitutionContextValue {
  institutions: Institution[];
  selectedId: string;
  selected: Institution | null;
  loading: boolean;
  error: string | null;
  academicYear: AcademicYear;
  academicYears: typeof ACADEMIC_YEARS;
  selectInstitution: (institutionId: string) => void;
  setAcademicYear: (academicYear: AcademicYear) => void;
  refresh: () => Promise<void>;
}

const InstitutionContext = createContext<InstitutionContextValue | null>(null);

function storedValue(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing can block storage */
  }
}

function storedYear(): AcademicYear {
  const candidate = storedValue(STORAGE_YEAR);
  return ACADEMIC_YEARS.some((year) => year.value === candidate)
    ? (candidate as AcademicYear)
    : ACTIVE_ACADEMIC_YEAR;
}

export function InstitutionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [academicYear, setAcademicYearState] = useState<AcademicYear>(storedYear);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const selectInstitution = useCallback(
    (institutionId: string) => {
      if (user?.role === 'REGISTRAR' && user.institution_id) {
        setSelectedId(user.institution_id);
        store(STORAGE_INSTITUTION, user.institution_id);
        return;
      }
      setSelectedId(institutionId);
      store(STORAGE_INSTITUTION, institutionId);
    },
    [user],
  );

  const setAcademicYear = useCallback((year: AcademicYear) => {
    setAcademicYearState(year);
    store(STORAGE_YEAR, year);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setInstitutions([]);
      setSelectedId('');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get<Institution[]>(endpoints.institutions(academicYear));
      setInstitutions(data);
      setError(null);
      setSelectedId((current) => {
        if (user.role === 'REGISTRAR' && user.institution_id) {
          return data.some((item) => item.institution_id === user.institution_id)
            ? user.institution_id
            : data[0]?.institution_id ?? '';
        }
        const preferred = current || storedValue(STORAGE_INSTITUTION);
        if (data.some((item) => item.institution_id === preferred)) return preferred;
        return (
          data.find((item) => item.institution_id === 'AICTE-TN-1042')?.institution_id ??
          data[0]?.institution_id ??
          ''
        );
      });
    } catch {
      setError(`Unable to load the sanctioned intake ledger for ${academicYear}.`);
    } finally {
      setLoading(false);
    }
  }, [academicYear, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => institutions.find((item) => item.institution_id === selectedId) ?? null,
    [institutions, selectedId],
  );

  const value = useMemo(
    () => ({
      institutions,
      selectedId,
      selected,
      loading,
      error,
      academicYear,
      academicYears: ACADEMIC_YEARS,
      selectInstitution,
      setAcademicYear,
      refresh,
    }),
    [
      institutions,
      selectedId,
      selected,
      loading,
      error,
      academicYear,
      selectInstitution,
      setAcademicYear,
      refresh,
    ],
  );

  return <InstitutionContext.Provider value={value}>{children}</InstitutionContext.Provider>;
}

export function useInstitutions(): InstitutionContextValue {
  const context = useContext(InstitutionContext);
  if (!context) throw new Error('useInstitutions must be used within InstitutionProvider');
  return context;
}
