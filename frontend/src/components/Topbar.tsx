import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  FileUp,
  Gauge,
  LogOut,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useInstitutions } from '../lib/institution';
import CommandPalette from './CommandPalette';
import NotificationsDrawer, { useNotifications } from './NotificationsDrawer';

const pageTitles: Record<string, string> = {
  '/registrar': 'Registrar portal',
  '/oversight': 'Regulatory oversight',
  '/verifier': 'Credential verifier',
  '/verify': 'Credential verifier',
};

const mobileNav = [
  { to: '/registrar', label: 'Registrar', icon: FileUp },
  { to: '/oversight', label: 'Oversight', icon: Gauge },
  { to: '/verifier', label: 'Verifier', icon: ScanLine },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export default function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const {
    institutions,
    selectedId,
    selected,
    selectInstitution,
    loading,
    academicYear,
    academicYears,
    setAcademicYear,
  } = useInstitutions();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const yearRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const { alerts, loading: alertsLoading } = useNotifications(academicYear);

  const isRegistrar = user?.role === 'REGISTRAR';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (yearRef.current && !yearRef.current.contains(event.target as Node)) setYearOpen(false);
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setYearOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const signOut = () => {
    setProfileOpen(false);
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center gap-2 px-4 py-2.5 lg:px-6">
        <div className="flex items-center gap-2 lg:hidden">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600">
            <img src="/shield.svg" alt="" className="h-4 w-4" />
          </span>
          <span className="font-display text-sm font-extrabold tracking-tight text-[#0F172A]">
            AICTE TrustNet
          </span>
        </div>

        <div className="hidden min-w-0 lg:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Workspace
          </p>
          <p className="truncate text-sm font-semibold text-[#0F172A]">
            {pageTitles[location.pathname] ?? 'AICTE TrustNet'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {isRegistrar ? (
            <div
              title={user?.institution_name ?? selected?.institution_name ?? 'Registrar college'}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] md:flex"
            >
              <Building2 className="h-4 w-4 shrink-0 text-indigo-500" />
              <div className="min-w-0">
                <p className="max-w-[170px] truncate text-[11px] font-semibold leading-tight text-slate-700">
                  {selected?.institution_name ?? user?.institution_name ?? 'Registrar college'}
                </p>
                <p className="mono text-[9px] leading-tight text-slate-400">
                  {user?.institution_id ?? selectedId}
                </p>
              </div>
              <span className="ml-1 rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-600">
                Pinned
              </span>
            </div>
          ) : (
            <label className="relative hidden items-center rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 md:flex">
              <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="sr-only">Selected institution</span>
              <select
                value={selectedId}
                onChange={(event) => selectInstitution(event.target.value)}
                disabled={loading || institutions.length === 0}
                className="max-w-[210px] cursor-pointer appearance-none bg-transparent py-2 pl-2 pr-1 text-xs font-semibold text-slate-700 focus:outline-none disabled:cursor-not-allowed sm:text-sm"
              >
                {institutions.length === 0 ? <option>Loading institutions…</option> : null}
                {institutions.map((institution) => (
                  <option key={institution.institution_id} value={institution.institution_id}>
                    {institution.institution_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400" />
            </label>
          )}

          <div className="relative" ref={yearRef}>
            <button
              type="button"
              onClick={() => {
                setYearOpen((value) => !value);
                setProfileOpen(false);
              }}
              aria-haspopup="dialog"
              aria-expanded={yearOpen}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-slate-300 hover:bg-slate-50"
            >
              <CalendarDays className="h-3.5 w-3.5 text-indigo-500" />
              <span className="tabular-nums">{academicYear}</span>
              <ChevronDown
                className={['h-3.5 w-3.5 text-slate-400 transition', yearOpen ? 'rotate-180' : ''].join(
                  ' ',
                )}
              />
            </button>

            {yearOpen ? (
              <div
                role="dialog"
                aria-label="Select academic year"
                className="absolute right-0 top-full z-50 mt-2 w-[290px] animate-fade-up rounded-2xl border border-slate-200 bg-white p-2 shadow-pop"
              >
                <div className="flex items-center justify-between px-2 pb-2 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Academic cycle
                  </p>
                  <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                    <Sparkles className="h-3 w-3" /> Filters live
                  </span>
                </div>
                <div className="relative space-y-1">
                  <span
                    aria-hidden="true"
                    className="absolute bottom-5 left-[19px] top-5 w-px bg-slate-200"
                  />
                  {academicYears.map((year) => {
                    const active = year.value === academicYear;
                    return (
                      <button
                        key={year.value}
                        type="button"
                        onClick={() => {
                          setAcademicYear(year.value);
                          setYearOpen(false);
                        }}
                        className={[
                          'relative flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition',
                          active
                            ? 'border-indigo-200 bg-indigo-50/70'
                            : 'border-transparent hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 bg-white',
                            active ? 'border-indigo-600' : 'border-slate-300',
                          ].join(' ')}
                        >
                          {active ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={[
                                'text-xs font-semibold',
                                active ? 'text-indigo-700' : 'text-slate-700',
                              ].join(' ')}
                            >
                              {year.label}
                            </span>
                            {year.value === '2026-2027' ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-emerald-700">
                                Live
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-slate-500">
                            {year.caption}
                          </span>
                        </span>
                        {active ? <Check className="h-4 w-4 shrink-0 text-indigo-600" /> : null}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-[10px] leading-relaxed text-slate-400">
                  Metrics, intake charts and enrolled rosters follow the selected cycle.
                </p>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden w-[210px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-slate-300 hover:text-slate-700 xl:flex 2xl:w-[270px]"
            aria-label="Search students, APAAR IDs and colleges"
          >
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="flex-1 truncate text-left">Search students, APAAR, colleges…</span>
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="icon-btn xl:hidden"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="icon-btn relative"
            aria-label={`Notifications${alerts.length ? ` (${alerts.length})` : ''}`}
          >
            <Bell className="h-4 w-4" />
            {alerts.length > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            ) : null}
          </button>

          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => {
                setProfileOpen((value) => !value);
                setYearOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 pr-1 transition hover:border-slate-300 hover:bg-slate-50 sm:pr-2.5"
              aria-label="Open profile menu"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {user?.initials ?? 'AN'}
              </span>
              <span className="hidden max-w-[120px] truncate text-[11px] font-semibold text-slate-700 sm:block">
                {user?.name ?? 'Registrar'}
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
            </button>

            {profileOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-[270px] animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop"
              >
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                      {user?.initials ?? 'AN'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#0F172A]">
                        {user?.name ?? 'Demo user'}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">{user?.title}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="chip border-indigo-200 bg-white text-indigo-700">
                      <ShieldCheck className="h-3 w-3" />
                      {user?.role === 'REGISTRAR' ? 'Registrar workspace' : 'Apex authority'}
                    </span>
                    {user?.institution_id ? (
                      <span className="mono rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] text-slate-500">
                        {user.institution_id}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="p-1.5">
                  <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-slate-500">
                    <UserRound className="h-3.5 w-3.5 text-slate-400" />
                    <span className="truncate">{user?.identifier}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Log out
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <nav className="scrollbar-thin flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 lg:hidden">
        {mobileNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50',
              ].join(' ')
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        alerts={alerts}
        loading={alertsLoading}
      />
    </header>
  );
}
