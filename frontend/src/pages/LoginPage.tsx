import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  QrCode,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { UserRole } from '../lib/session';

const ROLES: {
  role: UserRole;
  title: string;
  short: string;
  description: string;
  icon: typeof Building2;
  email: string;
  home: string;
  initials: string;
}[] = [
  {
    role: 'REGISTRAR',
    title: 'College Registrar',
    short: 'Registrar',
    description: 'Run admission batches, update student details and issue signed APAAR credentials.',
    icon: Building2,
    email: 'registrar@sjit.edu.in',
    home: '/registrar',
    initials: 'AN',
  },
  {
    role: 'APEX',
    title: 'AICTE Apex Regulatory Officer',
    short: 'Apex officer',
    description: 'Monitor national intake telemetry, quota adherence and prevented conflicts.',
    icon: Landmark,
    email: 'apex@aicte.gov.in',
    home: '/oversight',
    initials: 'AM',
  },
];

const DEMO_PASSWORD = 'trustnet';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<UserRole>('REGISTRAR');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination = (roleToUse: UserRole) => {
    const state = location.state as { from?: string } | null;
    if (state?.from && state.from !== '/login') return state.from;
    return ROLES.find((item) => item.role === roleToUse)?.home ?? '/registrar';
  };

  useEffect(() => {
    if (user) navigate(destination(user.role), { replace: true });
    // The redirect only depends on the authenticated identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const chooseRole = (nextRole: UserRole) => {
    setRole(nextRole);
    setError(null);
  };

  const fillDemo = (nextRole: UserRole) => {
    const account = ROLES.find((item) => item.role === nextRole);
    if (!account) return;
    setRole(nextRole);
    setIdentifier(account.email);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const account = await login(role, identifier, password);
      navigate(destination(account.role), { replace: true });
    } catch (caught: unknown) {
      if (axios.isAxiosError(caught)) {
        const detail = (caught.response?.data as { detail?: unknown } | undefined)?.detail;
        setError(
          typeof detail === 'string'
            ? detail
            : caught.response
              ? 'Sign-in failed. Check your workspace, identifier and password.'
              : 'Cannot reach the AICTE-TrustNet API. Confirm the backend is running on port 8000.',
        );
      } else {
        setError('Unexpected sign-in error. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden overflow-hidden border-r border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-slate-50 px-12 py-10 lg:flex lg:flex-col lg:justify-between">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.45]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(79,70,229,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(79,70,229,0.06) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 top-1/4 h-80 w-80 rounded-full bg-indigo-200/30 blur-3xl"
          />

          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-600 shadow-[0_10px_24px_-12px_rgba(79,70,229,0.8)]">
                <img src="/shield.svg" alt="" className="h-6 w-6" />
              </span>
              <div>
                <p className="font-display text-base font-extrabold tracking-tight text-[#0F172A]">
                  AICTE TrustNet
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  APAAR Credential Network
                </p>
              </div>
            </div>

            <div className="mt-16 max-w-lg">
              <span className="chip border-indigo-200 bg-white/80 text-indigo-700">
                <Sparkles className="h-3.5 w-3.5" /> SIH26263 · National education ledger
              </span>
              <h1 className="font-display mt-5 text-4xl font-extrabold leading-[1.12] tracking-tight text-[#0F172A]">
                One national ledger.
                <br />
                Zero double enrollments.
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-600">
                AICTE-TrustNet anchors every approved seat to a Verhoeff-checked APAAR ID and an
                Ed25519-signed credential. Registrars admit, the apex authority oversees, and
                verifiers confirm authenticity offline.
              </p>

              <ul className="mt-8 space-y-4">
                {[
                  {
                    icon: ShieldCheck,
                    title: 'Concurrency guard',
                    body: 'A unique active-seat index blocks the same APAAR from holding two seats.',
                    tone: 'border-emerald-100 bg-emerald-50 text-emerald-600',
                  },
                  {
                    icon: Fingerprint,
                    title: 'Verhoeff Mod-10 gate',
                    body: 'Every uploaded APAAR ID is checksum-validated before any ledger write.',
                    tone: 'border-indigo-100 bg-indigo-50 text-indigo-600',
                  },
                  {
                    icon: QrCode,
                    title: 'Signed QR credentials',
                    body: 'Students leave with a scannable pass that verifies against the apex key.',
                    tone: 'border-blue-100 bg-blue-50 text-blue-600',
                  },
                ].map(({ icon: Icon, title, body, tone }) => (
                  <li key={title} className="flex gap-3">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${tone}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">{title}</p>
                      <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-slate-500">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative flex items-center justify-between gap-4 border-t border-slate-200 pt-5 text-[11px] text-slate-500">
            <span>Prototype for the Smart India Hackathon · 2026</span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Ed25519 · Verhoeff Mod-10
            </span>
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600">
                <img src="/shield.svg" alt="" className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-sm font-extrabold tracking-tight text-[#0F172A]">
                  AICTE TrustNet
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  APAAR Credential Network
                </p>
              </div>
            </div>

            <div>
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">
                <Lock className="h-3.5 w-3.5" /> Secure workspace
              </p>
              <h2 className="font-display mt-2 text-2xl font-extrabold tracking-tight text-[#0F172A]">
                Sign in to your workspace
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                Choose the role you are authorised for, then enter your institutional credentials.
              </p>
            </div>

            <form onSubmit={submit} className="mt-6 space-y-5">
              <fieldset>
                <legend className="label mb-2">Select role</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ROLES.map((account) => {
                    const active = role === account.role;
                    const Icon = account.icon;
                    return (
                      <button
                        key={account.role}
                        type="button"
                        onClick={() => chooseRole(account.role)}
                        aria-pressed={active}
                        className={[
                          'group rounded-xl border p-3 text-left transition',
                          active
                            ? 'border-indigo-300 bg-indigo-50/70 shadow-[inset_0_0_0_1px_rgba(79,70,229,0.12)]'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={[
                              'grid h-8 w-8 place-items-center rounded-lg border',
                              active
                                ? 'border-indigo-200 bg-white text-indigo-600'
                                : 'border-slate-200 bg-slate-50 text-slate-500',
                            ].join(' ')}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span
                            className={[
                              'mt-1 grid h-4 w-4 place-items-center rounded-full border',
                              active ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 bg-white',
                            ].join(' ')}
                          >
                            {active ? <CheckCircle2 className="h-3 w-3 text-white" /> : null}
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-snug text-[#0F172A]">
                          {account.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                          {account.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <label htmlFor="identifier" className="label mb-1.5 block">
                  Institutional email
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder={role === 'REGISTRAR' ? 'registrar@sjit.edu.in' : 'apex@aicte.gov.in'}
                    required
                    className="input pl-10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="label mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter workspace password"
                    required
                    className="input pl-10 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-relaxed text-rose-700"
                >
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              ) : null}

              <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {submitting ? 'Signing in…' : 'Sign in securely'}
                {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
              </button>
            </form>

            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-slate-700">Demo access</p>
                <span className="chip border-slate-200 bg-slate-50 text-slate-500">Password · trustnet</span>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {ROLES.map((account) => (
                  <button
                    key={account.role}
                    type="button"
                    onClick={() => fillDemo(account.role)}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left transition hover:border-indigo-200 hover:bg-indigo-50/60"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">
                      {account.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-slate-700">
                        {account.short}
                      </span>
                      <span className="block truncate text-[10px] text-slate-500">
                        {account.email}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
              <Lock className="h-3 w-3" /> Sessions expire after 12 hours · HMAC-signed demo tokens
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
