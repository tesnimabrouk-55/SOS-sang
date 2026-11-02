import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, BLOOD_GROUPS, type AuthUser } from '../lib/api';
import { ROLE_HOME, useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { ArrowIcon, Badge, Button, Card, DropIcon, ErrorBanner, Field, Input, Select, useToast } from '../components/ui';

/* ------------------------------------------------------------------ connexion */

export function LoginPage() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={params.get('from') ?? ROLE_HOME[user.role]} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const account = await login(email.trim(), password);
      navigate(params.get('from') ?? ROLE_HOME[account.role], { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.code === 'HOSPITAL_PENDING') setError(t('hospital.pendingText'));
      else if (apiErr.code === 'RATE_LIMITED') setError('Trop de tentatives. Réessayez dans quelques minutes.');
      else setError(apiErr.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
      <div className="hidden lg:block">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{t('auth.loginTitle')}</h1>
        <p className="mt-3 max-w-md text-ink-600">{t('auth.loginSubtitle')}</p>
        <div className="mt-8 space-y-3">
          {[
            { role: 'Donneur', email: 'donneur1@sos-sang.local', note: 'Profil complet, O−, disponible' },
            { role: 'Hôpital', email: 'hopital.central@sos-sang.local', note: 'Établissement validé' },
            { role: 'Administrateur', email: 'admin@sos-sang.local', note: 'Supervision complète' },
          ].map((d) => (
            <Card key={d.role} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink-800">{d.role}</p>
                  <p className="text-xs text-ink-500">{d.note}</p>
                </div>
                <code className="rounded bg-ink-100 px-2 py-1 text-[11px] text-ink-600">{d.email}</code>
              </div>
            </Card>
          ))}
          <p className="text-xs text-ink-400">{t('auth.demoHint')}</p>
        </div>
      </div>

      <Card className="p-6 sm:p-8">
        <h2 className="text-xl font-bold text-ink-900">{t('auth.loginTitle')}</h2>
        <p className="mt-1 text-sm text-ink-500">{t('auth.loginSubtitle')}</p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          {error ? <ErrorBanner message={error} /> : null}
          <Field label={t('auth.email')} htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prenom.nom@exemple.tn"
            />
          </Field>
          <Field label={t('auth.password')} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
            />
          </Field>
          <Button type="submit" loading={loading} className="w-full">
            {t('auth.login')}
            <ArrowIcon className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </form>

        <p className="mt-5 text-sm text-ink-500">
          {t('auth.noAccount')}{' '}
          <Link to="/inscription" className="link">
            {t('auth.registerDonor')}
          </Link>
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ inscription */

export function RegisterPage() {
  const { t } = useI18n();
  const { user, registerDonor, registerHospital } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { push } = useToast();
  const [tab, setTab] = useState<'donor' | 'hospital'>(params.get('role') === 'hospital' ? 'hospital' : 'donor');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const [donor, setDonor] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    bloodGroup: 'O+',
    birthDate: '',
    weightKg: '',
    password: '',
    locationConsent: false,
    notificationsConsent: true,
  });

  const [hospital, setHospital] = useState({
    hospitalName: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    address: '',
    password: '',
  });

  const passwordHint = useMemo(() => '10 caractères minimum, avec majuscule, minuscule et chiffre.', []);

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  async function submitDonor(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const base = {
        email: donor.email.trim(),
        password: donor.password,
        firstName: donor.firstName.trim(),
        lastName: donor.lastName.trim(),
        phone: donor.phone.trim(),
        city: donor.city.trim(),
        bloodGroup: donor.bloodGroup,
        locationConsent: donor.locationConsent,
        notificationsConsent: donor.notificationsConsent,
      };
      const payload: Record<string, unknown> = { ...base };
      if (donor.birthDate) payload.birthDate = donor.birthDate;
      if (donor.weightKg) payload.weightKg = Number(donor.weightKg);

      if (donor.locationConsent && 'geolocation' in navigator) {
        const position = await new Promise<GeolocationPosition | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve(p),
            () => resolve(null),
            { timeout: 6000, maximumAge: 600000 },
          );
        });
        if (position) {
          payload.lat = Number(position.coords.latitude.toFixed(3));
          payload.lng = Number(position.coords.longitude.toFixed(3));
        }
      }

      await registerDonor(payload);
      navigate('/donneur', { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitHospital(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await registerHospital({
        hospitalName: hospital.hospitalName.trim(),
        contactName: hospital.contactName.trim(),
        email: hospital.email.trim(),
        phone: hospital.phone.trim(),
        city: hospital.city.trim(),
        address: hospital.address.trim(),
        password: hospital.password,
      });
      setCreated(hospital.email.trim());
      push('success', t('auth.hospitalCreated'));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <Card className="p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-vital-50 text-vital-600">
            <DropIcon />
          </span>
          <h1 className="mt-4 text-xl font-bold text-ink-900">{t('auth.hospitalPending')}</h1>
          <p className="mt-2 text-sm text-ink-600">
            Compte créé pour <strong>{created}</strong>. Vous pourrez vous connecter dès qu’un administrateur aura validé
            l’établissement.
          </p>
          <Link to="/connexion" className="btn-primary mt-6">
            {t('nav.login')}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{t('auth.registerTitle')}</h1>
        <p className="mt-2 text-ink-600">
          {tab === 'donor' ? 'Quelques informations suffisent pour recevoir les alertes compatibles.' : t('auth.hospitalPending')}
        </p>
      </div>

      <div className="mx-auto mt-6 flex w-full max-w-sm rounded-xl border border-ink-200 bg-white p-1">
        {(['donor', 'hospital'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setError(null);
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === key ? 'bg-blood-600 text-white' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {t(key === 'donor' ? 'auth.donorTab' : 'auth.hospitalTab')}
          </button>
        ))}
      </div>

      <Card className="mt-5 p-6 sm:p-8">
        {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}

        {tab === 'donor' ? (
          <form className="space-y-5" onSubmit={submitDonor}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('auth.firstName')}>
                <Input required value={donor.firstName} onChange={(e) => setDonor({ ...donor, firstName: e.target.value })} />
              </Field>
              <Field label={t('auth.lastName')}>
                <Input required value={donor.lastName} onChange={(e) => setDonor({ ...donor, lastName: e.target.value })} />
              </Field>
              <Field label={t('auth.email')}>
                <Input type="email" required value={donor.email} onChange={(e) => setDonor({ ...donor, email: e.target.value })} />
              </Field>
              <Field label={t('auth.phone')}>
                <Input required value={donor.phone} onChange={(e) => setDonor({ ...donor, phone: e.target.value })} placeholder="+216 20 00 00 00" />
              </Field>
              <Field label={t('auth.city')}>
                <Input required value={donor.city} onChange={(e) => setDonor({ ...donor, city: e.target.value })} />
              </Field>
              <Field label={t('auth.bloodGroup')}>
                <Select value={donor.bloodGroup} onChange={(e) => setDonor({ ...donor, bloodGroup: e.target.value })}>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date de naissance" hint={t('common.optional')}>
                <Input type="date" value={donor.birthDate} onChange={(e) => setDonor({ ...donor, birthDate: e.target.value })} />
              </Field>
              <Field label="Poids (kg)" hint={t('common.optional')}>
                <Input type="number" min={30} max={250} value={donor.weightKg} onChange={(e) => setDonor({ ...donor, weightKg: e.target.value })} />
              </Field>
            </div>

            <Field label={t('auth.password')} hint={passwordHint}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={donor.password}
                onChange={(e) => setDonor({ ...donor, password: e.target.value })}
              />
            </Field>

            <div className="space-y-3 rounded-xl border border-ink-200 bg-ink-50/60 p-4">
              <label className="flex items-start gap-3 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-blood-600"
                  checked={donor.notificationsConsent}
                  onChange={(e) => setDonor({ ...donor, notificationsConsent: e.target.checked })}
                />
                <span>{t('auth.consentNotif')}</span>
              </label>
              <label className="flex items-start gap-3 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-blood-600"
                  checked={donor.locationConsent}
                  onChange={(e) => setDonor({ ...donor, locationConsent: e.target.checked })}
                />
                <span>{t('auth.consentLocation')}</span>
              </label>
            </div>

            <Button type="submit" loading={loading} className="w-full">
              {t('auth.registerDonor')}
            </Button>
            <p className="text-center text-xs text-ink-400">{t('donor.disclaimer')}</p>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={submitHospital}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('auth.hospitalName')}>
                <Input required value={hospital.hospitalName} onChange={(e) => setHospital({ ...hospital, hospitalName: e.target.value })} />
              </Field>
              <Field label={t('auth.contactName')}>
                <Input required value={hospital.contactName} onChange={(e) => setHospital({ ...hospital, contactName: e.target.value })} />
              </Field>
              <Field label={t('auth.email')}>
                <Input type="email" required value={hospital.email} onChange={(e) => setHospital({ ...hospital, email: e.target.value })} />
              </Field>
              <Field label={t('auth.phone')}>
                <Input required value={hospital.phone} onChange={(e) => setHospital({ ...hospital, phone: e.target.value })} />
              </Field>
              <Field label={t('auth.city')}>
                <Input required value={hospital.city} onChange={(e) => setHospital({ ...hospital, city: e.target.value })} />
              </Field>
              <Field label={t('auth.address')}>
                <Input required value={hospital.address} onChange={(e) => setHospital({ ...hospital, address: e.target.value })} />
              </Field>
            </div>
            <Field label={t('auth.password')} hint={passwordHint}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={hospital.password}
                onChange={(e) => setHospital({ ...hospital, password: e.target.value })}
              />
            </Field>
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <Badge tone="amber">Validation</Badge>
              <p>{t('auth.hospitalPending')}</p>
            </div>
            <Button type="submit" loading={loading} className="w-full">
              {t('auth.registerHospital')}
            </Button>
          </form>
        )}
      </Card>

      <p className="mt-5 text-center text-sm text-ink-500">
        Déjà inscrit ?{' '}
        <Link to="/connexion" className="link">
          {t('auth.login')}
        </Link>
      </p>
    </div>
  );
}

export type { AuthUser };
