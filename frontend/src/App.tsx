import { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import { AuthProvider, useAuth } from './lib/auth';
import { InstitutionProvider } from './lib/institution';
import LoginPage from './pages/LoginPage';

const RegistrarPortal = lazy(() => import('./pages/RegistrarPortal'));
const OversightDashboard = lazy(() => import('./pages/OversightDashboard'));
const PublicVerifier = lazy(() => import('./pages/PublicVerifier'));

const SIDEBAR_KEY = 'trustnet:sidebar-collapsed';

function PageLoader() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-6" aria-busy="true">
      <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-7 w-64 animate-pulse rounded bg-slate-200" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="panel h-28 animate-pulse" />
        ))}
      </div>
      <div className="mt-5 panel h-80 animate-pulse" />
    </div>
  );
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'APEX' ? '/oversight' : '/registrar'} replace />;
}

function ProtectedShell() {
  const { user } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* private browsing can block storage */
      }
      return next;
    });
  };

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return (
    <InstitutionProvider>
      <div className="min-h-screen bg-[#F8FAFC]">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
        <div
          className={[
            'flex min-h-screen flex-col transition-[padding] duration-300 ease-out',
            collapsed ? 'lg:pl-[84px]' : 'lg:pl-[260px]',
          ].join(' ')}
        >
          <Topbar />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 lg:px-6 lg:py-6">
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </main>
          <footer className="border-t border-slate-200 bg-white">
            <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-2 px-4 py-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:px-6 lg:px-6">
              <p>
                <span className="font-semibold text-slate-700">AICTE-TrustNet</span> · APAAR
                concurrency guard &amp; cryptographic academic ledger · SIH26263 prototype
              </p>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Ed25519 · Verhoeff Mod-10
              </span>
            </div>
          </footer>
        </div>
      </div>
    </InstitutionProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedShell />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/registrar" element={<RegistrarPortal />} />
            <Route path="/oversight" element={<OversightDashboard />} />
            <Route path="/verifier" element={<PublicVerifier />} />
            <Route path="/verify" element={<Navigate to="/verifier" replace />} />
            <Route path="*" element={<HomeRedirect />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
