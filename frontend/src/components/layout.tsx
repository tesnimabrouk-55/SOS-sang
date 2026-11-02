import { useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, ROLE_HOME } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import {
  BellIcon,
  BuildingIcon,
  ChartIcon,
  DocIcon,
  DropIcon,
  GlobeIcon,
  HeartIcon,
  LayersIcon,
  MenuIcon,
  PulseIcon,
  ShieldIcon,
  UsersIcon,
  CrossIcon,
  ArrowIcon,
} from './ui';

/* ------------------------------------------------------------------ logo / langue */

export function Logo({ to = '/', inverted = false }: { to?: string; inverted?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-2.5" aria-label="SOS Sang">
      <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-blood-600 text-white shadow-sm">
        <DropIcon className="h-5 w-5" />
        <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20" />
      </span>
      <span className="leading-none">
        <span className={`block text-[17px] font-extrabold tracking-tight ${inverted ? 'text-white' : 'text-ink-900'}`}>
          SOS <span className="text-blood-600">Sang</span>
        </span>
        <span className={`mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] ${inverted ? 'text-white/60' : 'text-ink-400'}`}>
          Don de sang
        </span>
      </span>
    </Link>
  );
}

export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  return (
    <div className="inline-flex items-center rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-semibold">
      <GlobeIcon className="mx-1.5 h-3.5 w-3.5 text-ink-400" />
      {(['fr', 'ar'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-md px-2 py-1 uppercase transition ${
            lang === code ? 'bg-blood-600 text-white' : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {compact ? code : code === 'fr' ? 'FR' : 'AR'}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ layout public */

export function PublicLayout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/', label: t('nav.home') },
    { to: '/fonctionnement', label: t('nav.how') },
    { to: '/groupes-sanguins', label: t('nav.groups') },
    { to: '/contact', label: t('nav.contact') },
    { to: '/confidentialite', label: t('nav.privacy') },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-blood-50 text-blood-700' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <LangSwitch />
            {user ? (
              <Link to={ROLE_HOME[user.role]} className="btn-primary">
                {t('nav.dashboard')}
                <ArrowIcon className="h-4 w-4 rtl:rotate-180" />
              </Link>
            ) : (
              <>
                <Link to="/connexion" className="btn-ghost">
                  {t('nav.login')}
                </Link>
                <Link to="/inscription" className="btn-primary">
                  {t('nav.becomeDonor')}
                </Link>
              </>
            )}
          </div>
          <button type="button" className="rounded-lg p-2 text-ink-600 lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <CrossIcon /> : <MenuIcon />}
          </button>
        </div>
        {open ? (
          <div className="border-t border-ink-200 bg-white px-4 pb-4 pt-2 lg:hidden">
            <nav className="flex flex-col">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-blood-50 text-blood-700' : 'text-ink-600'}`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-between gap-2">
              <LangSwitch />
              {user ? (
                <Link to={ROLE_HOME[user.role]} className="btn-primary" onClick={() => setOpen(false)}>
                  {t('nav.dashboard')}
                </Link>
              ) : (
                <div className="flex gap-2">
                  <Link to="/connexion" className="btn-secondary" onClick={() => setOpen(false)}>
                    {t('nav.login')}
                  </Link>
                  <Link to="/inscription" className="btn-primary" onClick={() => setOpen(false)}>
                    {t('nav.register')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-ink-500">{t('footer.notMedical')}</p>
            <p className="mt-2 text-xs text-ink-400">{t('footer.rights')}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Plateforme</p>
            <ul className="space-y-1.5 text-sm text-ink-600">
              <li><Link className="hover:text-blood-700" to="/fonctionnement">{t('nav.how')}</Link></li>
              <li><Link className="hover:text-blood-700" to="/groupes-sanguins">{t('nav.groups')}</Link></li>
              <li><Link className="hover:text-blood-700" to="/inscription">{t('nav.becomeDonor')}</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Institutions</p>
            <ul className="space-y-1.5 text-sm text-ink-600">
              <li><Link className="hover:text-blood-700" to="/inscription?role=hospital">{t('nav.hospitalSpace')}</Link></li>
              <li><Link className="hover:text-blood-700" to="/contact">{t('nav.contact')}</Link></li>
              <li><Link className="hover:text-blood-700" to="/confidentialite">{t('nav.privacy')}</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ layout applicatif */

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

function useNavItems(): { items: NavItem[]; space: string } {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user) return { items: [], space: '' };

  if (user.role === 'DONOR') {
    return {
      space: t('donor.space'),
      items: [
        { to: '/donneur', label: t('nav.dashboard'), icon: <DropIcon />, end: true },
        { to: '/donneur/alertes', label: t('nav.alerts'), icon: <BellIcon /> },
        { to: '/donneur/historique', label: t('nav.history'), icon: <HeartIcon /> },
        { to: '/donneur/profil', label: t('nav.profile'), icon: <UsersIcon /> },
      ],
    };
  }
  if (user.role === 'HOSPITAL') {
    return {
      space: t('hospital.space'),
      items: [
        { to: '/hopital', label: t('nav.dashboard'), icon: <BuildingIcon />, end: true },
        { to: '/hopital/urgences', label: t('nav.urgences'), icon: <PulseIcon /> },
        { to: '/hopital/nouvelle-urgence', label: t('nav.newUrgence'), icon: <DropIcon /> },
        { to: '/hopital/stocks', label: t('nav.stock'), icon: <LayersIcon /> },
        { to: '/hopital/statistiques', label: t('nav.stats'), icon: <ChartIcon /> },
      ],
    };
  }
  return {
    space: t('admin.space'),
    items: [
      { to: '/admin', label: t('admin.overview'), icon: <ShieldIcon />, end: true },
      { to: '/admin/hopitaux', label: t('nav.hospitals'), icon: <BuildingIcon /> },
      { to: '/admin/utilisateurs', label: t('nav.users'), icon: <UsersIcon /> },
      { to: '/admin/urgences', label: t('nav.urgences'), icon: <PulseIcon /> },
      { to: '/admin/notifications', label: t('nav.notifications'), icon: <BellIcon /> },
      { to: '/admin/audit', label: t('nav.audit'), icon: <DocIcon /> },
      { to: '/admin/services', label: t('nav.services'), icon: <ChartIcon /> },
    ],
  };
}

export function AppLayout() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const { items, space } = useNavItems();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive ? 'bg-blood-600 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
        >
          <span className="[&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-ink-50">
      <aside className="hidden w-64 shrink-0 border-e border-ink-200 bg-white px-4 py-5 lg:flex lg:flex-col">
        <Logo />
        <p className="mt-6 mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{space}</p>
        {nav}
        <div className="mt-auto rounded-xl bg-ink-50 p-3">
          <p className="truncate text-sm font-semibold text-ink-800">{user.fullName}</p>
          <p className="truncate text-xs text-ink-500">{user.email}</p>
          <button type="button" onClick={() => void logout()} className="mt-2 text-xs font-semibold text-blood-700 hover:underline">
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-lg p-2 text-ink-600 lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
              {open ? <CrossIcon /> : <MenuIcon />}
            </button>
            <span className="text-sm font-semibold text-ink-500 lg:hidden">{space}</span>
            <span className="hidden text-sm font-semibold text-ink-500 lg:block">{t('nav.dashboard')}</span>
          </div>
          <div className="flex items-center gap-2">
            <LangSwitch />
            <div className="hidden items-center gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5 sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blood-100 text-[11px] font-bold text-blood-700">
                {user.fullName.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[140px] truncate text-xs font-semibold text-ink-700">{user.fullName}</span>
            </div>
            <button type="button" onClick={() => void logout()} className="btn-ghost px-2 py-2 text-xs">
              {t('nav.logout')}
            </button>
          </div>
        </header>

        {open ? <div className="border-b border-ink-200 bg-white px-4 py-3 lg:hidden">{nav}</div> : null}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
