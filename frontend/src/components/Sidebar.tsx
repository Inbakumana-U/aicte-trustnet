import { NavLink, useNavigate } from 'react-router-dom';
import {
  FileUp,
  Gauge,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const primaryNav = [
  { to: '/registrar', label: 'Registrar', hint: 'Admissions & intake', icon: FileUp },
  { to: '/oversight', label: 'Oversight', hint: 'National analytics', icon: Gauge },
  { to: '/verifier', label: 'Verifier', hint: 'Credential checks', icon: ScanLine },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside
      className={[
        'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200 bg-white transition-[width] duration-300 ease-out lg:flex',
        collapsed ? 'w-[84px]' : 'w-[260px]',
      ].join(' ')}
    >
      <div
        className={[
          'flex h-16 shrink-0 items-center border-b border-slate-100',
          collapsed ? 'justify-center px-2' : 'gap-3 px-5',
        ].join(' ')}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-600">
          <img src="/shield.svg" alt="" className="h-5 w-5" />
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="font-display truncate text-sm font-extrabold tracking-tight text-[#0F172A]">
              AICTE TrustNet
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
              APAAR Credential Network
            </p>
          </div>
        ) : null}
      </div>

      <div
        className={[
          'flex-1 overflow-y-auto overflow-x-hidden py-4',
          collapsed ? 'px-2.5' : 'px-3',
        ].join(' ')}
      >
        {!collapsed ? (
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Workspace
          </p>
        ) : null}
        <nav className={collapsed ? 'mt-0 space-y-1.5' : 'mt-2 space-y-1'}>
          {primaryNav.map(({ to, label, hint, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              aria-label={label}
              className={({ isActive }) =>
                [
                  'group flex items-center rounded-xl text-sm font-medium transition',
                  collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2.5',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={[
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition',
                      isActive
                        ? 'border-indigo-100 bg-white text-indigo-600'
                        : 'border-slate-200 bg-white text-slate-500 group-hover:text-slate-700',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {!collapsed ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{label}</span>
                      <span
                        className={[
                          'block truncate text-[10px] font-medium',
                          isActive ? 'text-indigo-500' : 'text-slate-400',
                        ].join(' ')}
                      >
                        {hint}
                      </span>
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {!collapsed ? (
          <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <p className="text-[11px] font-semibold text-emerald-900">Apex key active</p>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-emerald-700">
              Ed25519 issuer online · offline verification enabled
            </p>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        {user ? (
          collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <span
                title={`${user.name} · ${user.title}`}
                className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white"
              >
                {user.initials}
              </span>
              <button
                type="button"
                onClick={signOut}
                title="Log out"
                aria-label="Log out"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                  {user.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-[#0F172A]">{user.name}</p>
                  <p className="truncate text-[10px] text-slate-500">{user.title}</p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  title="Log out"
                  aria-label="Log out"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
              <p className="mono mt-2 truncate border-t border-slate-200 pt-1.5 text-[9px] text-slate-400">
                {user.institution_id ?? 'AICTE apex workspace'}
              </p>
            </div>
          )
        ) : null}

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={[
            'mt-2 flex w-full items-center rounded-lg px-2 py-2 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700',
            collapsed ? 'justify-center' : 'gap-2',
          ].join(' ')}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" />
              Collapse sidebar
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
