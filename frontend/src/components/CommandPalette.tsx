import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  FileUp,
  Gauge,
  Loader2,
  ScanLine,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { api, endpoints, type SearchInstitution, type SearchResponse, type SearchStudent } from '../lib/api';
import { useInstitutions } from '../lib/institution';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type PaletteItem =
  | { kind: 'student'; key: string; student: SearchStudent }
  | { kind: 'institution'; key: string; institution: SearchInstitution }
  | { kind: 'page'; key: string; label: string; hint: string; to: string; icon: typeof FileUp };

const pageShortcuts = [
  { to: '/registrar', label: 'Registrar portal', hint: 'Admission batches & details updation', icon: FileUp },
  { to: '/oversight', label: 'Regulatory oversight', hint: 'National intake telemetry', icon: Gauge },
  { to: '/verifier', label: 'Credential verifier', hint: 'Verify an academic credential', icon: ScanLine },
];

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { institutions, academicYear, selectInstitution } = useInstitutions();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<SearchResponse>({ students: [], institutions: [] });
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const reset = useCallback(() => {
    setQuery('');
    setRemote({ students: [], institutions: [] });
    setActiveIndex(0);
    setLoading(false);
    requestId.current += 1;
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setRemote({ students: [], institutions: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      api
        .get<SearchResponse>(endpoints.search(term, academicYear))
        .then(({ data }) => {
          if (id !== requestId.current) return;
          setRemote(data);
          setActiveIndex(0);
        })
        .catch(() => {
          if (id === requestId.current) setRemote({ students: [], institutions: [] });
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, open, academicYear]);

  const localInstitutions = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? institutions.filter(
          (item) =>
            item.institution_id.toLowerCase().includes(term) ||
            item.institution_name.toLowerCase().includes(term),
        )
      : institutions;
    return matches.slice(0, 4).map<SearchInstitution>((item) => ({
      institution_id: item.institution_id,
      institution_name: item.institution_name,
      course_name: item.course_name,
      academic_year: item.academic_year,
      sanctioned_intake: item.sanctioned_intake,
      current_enrolled: item.current_enrolled,
    }));
  }, [institutions, query]);

  const institutionItems = useMemo(() => {
    const merged = new Map<string, SearchInstitution>();
    for (const item of [...localInstitutions, ...remote.institutions]) {
      merged.set(item.institution_id, item);
    }
    return Array.from(merged.values()).slice(0, 5);
  }, [localInstitutions, remote.institutions]);

  const items = useMemo<PaletteItem[]>(() => {
    const next: PaletteItem[] = [];
    for (const student of remote.students) {
      next.push({ kind: 'student', key: `student-${student.apaar_id}`, student });
    }
    for (const institution of institutionItems) {
      next.push({
        kind: 'institution',
        key: `institution-${institution.institution_id}`,
        institution,
      });
    }
    if (!query.trim()) {
      for (const [index, shortcut] of pageShortcuts.entries()) {
        next.push({
          kind: 'page',
          key: `page-${index}`,
          label: shortcut.label,
          hint: shortcut.hint,
          to: shortcut.to,
          icon: shortcut.icon,
        });
      }
    }
    return next;
  }, [remote.students, institutionItems, query]);

  useEffect(() => {
    setActiveIndex((current) => (items.length === 0 ? 0 : Math.min(current, items.length - 1)));
  }, [items.length]);

  const activate = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      if (item.kind === 'student') {
        selectInstitution(item.student.institution_id);
        navigate(`/registrar?student=${encodeURIComponent(item.student.apaar_id)}`);
      } else if (item.kind === 'institution') {
        selectInstitution(item.institution.institution_id);
        navigate('/registrar');
      } else {
        navigate(item.to);
      }
      onClose();
    },
    [navigate, onClose, selectInstitution],
  );

  if (!open) return null;

  const studentCount = remote.students.length;
  const institutionCount = institutionItems.length;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh] backdrop-blur-sm sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search students, APAAR IDs and colleges"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-indigo-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (items.length) setActiveIndex((index) => (index + 1) % items.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (items.length) {
                  setActiveIndex((index) => (index - 1 + items.length) % items.length);
                }
              } else if (event.key === 'Enter') {
                event.preventDefault();
                activate(items[activeIndex]);
              }
            }}
            placeholder="Search by student name, APAAR ID or college code…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            aria-label="Search query"
          />
          {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
          >
            ESC
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="scrollbar-thin max-h-[58vh] overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400">
                <Search className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-700">
                {query.trim().length < 2
                  ? 'Type at least two characters'
                  : `No matches for “${query.trim()}”`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Try an APAAR ID, a student name or a college code such as AICTE-TN-1042.
              </p>
            </div>
          ) : (
            <>
              {studentCount > 0 ? (
                <PaletteGroup label={`Students · ${academicYear}`}>
                  {remote.students.map((student) => {
                    const index = items.findIndex(
                      (item) => item.kind === 'student' && item.student.apaar_id === student.apaar_id,
                    );
                    return (
                      <PaletteRow
                        key={`student-${student.apaar_id}`}
                        active={index === activeIndex}
                        icon={UserRound}
                        tone="indigo"
                        title={student.student_name}
                        subtitle={`${student.apaar_id} · ${student.institution_name}`}
                        onSelect={() => activate(items[index])}
                        onHover={() => setActiveIndex(index)}
                      />
                    );
                  })}
                </PaletteGroup>
              ) : null}

              {institutionCount > 0 ? (
                <PaletteGroup label="Colleges">
                  {institutionItems.map((institution) => {
                    const index = items.findIndex(
                      (item) =>
                        item.kind === 'institution' &&
                        item.institution.institution_id === institution.institution_id,
                    );
                    return (
                      <PaletteRow
                        key={`institution-${institution.institution_id}`}
                        active={index === activeIndex}
                        icon={Building2}
                        tone="slate"
                        title={institution.institution_name}
                        subtitle={`${institution.institution_id} · ${institution.current_enrolled}/${institution.sanctioned_intake} seats`}
                        onSelect={() => activate(items[index])}
                        onHover={() => setActiveIndex(index)}
                      />
                    );
                  })}
                </PaletteGroup>
              ) : null}

              {!query.trim() ? (
                <PaletteGroup label="Navigate">
                  {items
                    .filter((item): item is Extract<PaletteItem, { kind: 'page' }> => item.kind === 'page')
                    .map((page) => {
                      const index = items.findIndex((item) => item.key === page.key);
                      return (
                        <PaletteRow
                          key={page.key}
                          active={index === activeIndex}
                          icon={page.icon}
                          tone="slate"
                          title={page.label}
                          subtitle={page.hint}
                          onSelect={() => activate(items[index])}
                          onHover={() => setActiveIndex(index)}
                        />
                      );
                    })}
                </PaletteGroup>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[10px] font-medium text-slate-500">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">↑</kbd>
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5">↵</kbd>
            open
          </span>
          <span className="ml-auto">Search is scoped to {academicYear}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PaletteGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function PaletteRow({
  active,
  icon: Icon,
  tone,
  title,
  subtitle,
  onSelect,
  onHover,
}: {
  active: boolean;
  icon: typeof FileUp;
  tone: 'indigo' | 'slate';
  title: string;
  subtitle: string;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onSelect}
      className={[
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
        active ? 'bg-indigo-50' : 'hover:bg-slate-50',
      ].join(' ')}
    >
      <span
        className={[
          'grid h-9 w-9 shrink-0 place-items-center rounded-lg border',
          tone === 'indigo'
            ? 'border-indigo-100 bg-white text-indigo-600'
            : 'border-slate-200 bg-white text-slate-500',
        ].join(' ')}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-[#0F172A]">{title}</span>
        <span className="mono mt-0.5 block truncate text-[10px] text-slate-500">{subtitle}</span>
      </span>
      <ArrowRight
        className={['h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300'].join(' ')}
      />
    </button>
  );
}
