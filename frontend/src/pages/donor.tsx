import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  BLOOD_GROUPS,
  type CompatibleUrgence,
  type DonorNotification,
  type DonorProfile,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import {
  Badge,
  BloodTag,
  Button,
  Card,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  DropIcon,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PinIcon,
  Progress,
  SectionTitle,
  Select,
  Stat,
  Toggle,
  useToast,
} from '../components/ui';

/* ------------------------------------------------------------------ hooks */

function useDonorData() {
  const [donor, setDonor] = useState<DonorProfile | null>(null);
  const [urgences, setUrgences] = useState<CompatibleUrgence[]>([]);
  const [notifications, setNotifications] = useState<DonorNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profile, compat, notifs] = await Promise.all([
        api.get<{ donor: DonorProfile }>('/donors/me'),
        api.get<{ urgences: CompatibleUrgence[] }>('/donors/me/compatible-urgences'),
        api.get<{ notifications: DonorNotification[] }>('/notifications/me'),
      ]);
      setDonor(profile.donor);
      setUrgences(compat.urgences);
      setNotifications(notifs.notifications);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { donor, setDonor, urgences, notifications, setNotifications, error, loading, reload: load };
}

const PRIORITY_TONE = { CRITICAL: 'red', HIGH: 'amber', NORMAL: 'neutral' } as const;

function timeLeft(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return 'Échéance dépassée';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return `${Math.floor(hours / 24)} j ${hours % 24} h`;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/* ------------------------------------------------------------------ tableau de bord */

export function DonorDashboard() {
  const { t, formatDate } = useI18n();
  const { donor, setDonor, urgences, notifications, error, loading, reload } = useDonorData();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !donor) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!donor) return null;

  const unread = notifications.filter((n) => !n.readAt).length;

  async function toggleAvailability(next: boolean) {
    setBusy('availability');
    try {
      const data = await api.post<{ donor: DonorProfile }>('/donors/me/availability', { isAvailable: next });
      setDonor(data.donor);
      push('success', next ? 'Vous êtes de nouveau disponible.' : 'Vous ne recevrez plus d’alertes.');
    } catch (err) {
      push('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function respond(urgenceId: string, answer: 'COMING' | 'CANNOT') {
    setBusy(urgenceId);
    try {
      await api.post('/donors/me/responses', { urgenceId, answer });
      push('success', answer === 'COMING' ? 'Votre venue est enregistrée. L’hôpital est prévenu.' : 'Réponse enregistrée. Merci.');
      await reload();
    } catch (err) {
      push('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-ink-100 bg-gradient-to-br from-blood-50 to-white p-5">
            <BloodTag group={donor.bloodGroup} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-500">{t('donor.space')}</p>
              <h1 className="truncate text-xl font-bold text-ink-900">
                {donor.firstName} {donor.lastName}
              </h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                <PinIcon className="h-3.5 w-3.5" />
                {donor.city}
                {donor.location ? <span className="text-ink-400">· position enregistrée</span> : <span className="text-amber-600">· position non renseignée</span>}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-500">
                  {donor.isAvailable ? t('donor.available') : t('donor.unavailable')}
                </span>
                <Toggle
                  checked={donor.isAvailable}
                  onChange={(v) => void toggleAvailability(v)}
                  label="Disponibilité"
                  disabled={busy === 'availability'}
                />
              </div>
              <Link to="/donneur/profil" className="text-xs font-semibold text-blood-700 hover:underline">
                {t('nav.profile')} →
              </Link>
            </div>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className={`rounded-xl border p-4 ${donor.eligibility.eligible ? 'border-vital-500/30 bg-vital-50/60' : 'border-amber-300 bg-amber-50'}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t('donor.eligibility')}</p>
                <Badge tone={donor.eligibility.eligible ? 'green' : 'amber'}>
                  {donor.eligibility.eligible ? t('donor.eligible') : t('donor.notEligible')}
                </Badge>
              </div>
              {donor.eligibility.nextEligibleOn ? (
                <p className="mt-2 text-sm text-ink-600">
                  {t('donor.nextEligible')} : <strong>{formatDate(donor.eligibility.nextEligibleOn)}</strong>
                </p>
              ) : null}
              {donor.eligibility.blockers.length ? (
                <ul className="mt-2 space-y-1 text-xs text-ink-600">
                  {donor.eligibility.blockers.map((b) => (
                    <li key={b} className="flex items-center gap-1.5">
                      <CrossIcon className="h-3 w-3 text-blood-600" />
                      {blockerLabel(b)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-[11px] leading-relaxed text-ink-500">{t('donor.disclaimer')}</p>
            </div>

            <div className="rounded-xl border border-ink-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Dernier don</p>
              <p className="mt-1 text-sm font-semibold text-ink-800">{donor.lastDonationDate ? formatDate(donor.lastDonationDate) : 'Aucun don enregistré'}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-2xl font-bold text-ink-900">{donor.totalDonations}</p>
                  <p className="text-[11px] uppercase tracking-wide text-ink-400">{t('donor.donations')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink-900">{donor.alertsComing}</p>
                  <p className="text-[11px] uppercase tracking-wide text-ink-400">{t('donor.confirmations')}</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label={t('donor.alertsReceived')} value={donor.alertsReceived} icon={<DropIcon />} />
          <Stat label={t('donor.responses')} value={donor.alertsAnswered} icon={<CheckIcon />} />
          <Stat label={t('donor.confirmations')} value={donor.alertsComing} tone="green" icon={<CheckIcon />} />
          <Stat label={t('donor.donations')} value={donor.totalDonations} icon={<DropIcon />} />
          <div className="card-pad sm:col-span-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-800">{t('donor.myAlerts')}</p>
              <Link to="/donneur/alertes" className="link text-xs">
                {unread > 0 ? `${unread} non lue(s)` : 'Tout voir'}
              </Link>
            </div>
            <div className="mt-2 space-y-2">
              {notifications.slice(0, 3).map((n) => (
                <div key={n.id} className="flex items-start gap-2 rounded-lg border border-ink-100 px-3 py-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-ink-200' : 'bg-blood-500'}`} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink-700">{n.title}</p>
                    <p className="text-[11px] text-ink-400">
                      {n.channel} · {new Date(n.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {!notifications.length ? <p className="py-3 text-center text-xs text-ink-400">{t('common.empty')}</p> : null}
            </div>
          </div>
        </div>
      </div>

      <section>
        <SectionTitle
          title={t('donor.compatibleTitle')}
          subtitle="Triées par distance croissante, puis par fiabilité documentée."
          action={<span className="badge bg-ink-100 text-ink-600">{urgences.length}</span>}
        />
        {urgences.length === 0 ? (
          <EmptyState title={t('donor.noCompatible')} text="Activez votre disponibilité et renseignez votre position pour recevoir des alertes pertinentes." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {urgences.map((u) => (
              <Card key={u.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <BloodTag group={u.bloodGroup} />
                    <div>
                      <p className="font-semibold text-ink-800">{u.hospitalName}</p>
                      <p className="text-xs text-ink-500">
                        {u.city} · {u.distanceKm !== null ? `${u.distanceKm.toFixed(1)} km` : 'distance inconnue'}
                      </p>
                    </div>
                  </div>
                  <Badge tone={PRIORITY_TONE[u.priority]}>{t(`priority.${u.priority}`)}</Badge>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span>
                      {u.bagsConfirmed}/{u.bagsNeeded} poches confirmées
                    </span>
                    <span className="flex items-center gap-1">
                      <ClockIcon className="h-3.5 w-3.5" />
                      {timeLeft(u.deadlineAt)}
                    </span>
                  </div>
                  <Progress value={u.bagsConfirmed} max={u.bagsNeeded} />
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1"
                    loading={busy === u.id}
                    onClick={() => void respond(u.id, 'COMING')}
                    disabled={u.bagsConfirmed >= u.bagsNeeded}
                  >
                    {t('donor.iAmComing')}
                  </Button>
                  <Button variant="secondary" onClick={() => void respond(u.id, 'CANNOT')} disabled={busy === u.id}>
                    {t('donor.iCannot')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function blockerLabel(code: string): string {
  const map: Record<string, string> = {
    AGE_TOO_LOW: 'Âge inférieur au minimum configuré',
    AGE_TOO_HIGH: 'Âge supérieur au maximum configuré',
    WEIGHT_TOO_LOW: 'Poids inférieur au seuil configuré',
    INTERVAL_TOO_SHORT: 'Délai minimum entre deux dons non respecté',
    MISSING_MEDICAL_DATA: 'Données médicales manquantes',
  };
  return map[code] ?? code;
}

function LoadingBlock() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-40 w-full" />
      <div className="grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ alertes */

export function DonorAlerts() {
  const { t, formatDateTime } = useI18n();
  const { notifications, setNotifications, error, loading, reload } = useDonorData();
  const { push } = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const list = filter === 'unread' ? notifications.filter((n) => !n.readAt) : notifications;

  async function markAll() {
    try {
      await api.post('/notifications/me/read-all');
      setNotifications(notifications.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString(), status: 'READ' as const })));
      push('success', 'Toutes les alertes sont marquées comme lues.');
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  async function markOne(id: string) {
    try {
      await api.post(`/notifications/me/${id}/read`);
      setNotifications(notifications.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString(), status: 'READ' as const } : n)));
    } catch {
      /* silencieux : l'etat reste inchange */
    }
  }

  if (loading && !notifications.length) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  return (
    <div>
      <SectionTitle
        title={t('donor.myAlerts')}
        subtitle="Notifications persistées par canal (e-mail, SMS simulé, web) avec leur statut d’envoi."
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-semibold">
              {(['all', 'unread'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1.5 ${filter === f ? 'bg-ink-800 text-white' : 'text-ink-500'}`}
                >
                  {f === 'all' ? t('common.all') : 'Non lues'}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => void markAll()}>
              {t('donor.markRead')}
            </Button>
          </div>
        }
      />

      {list.length === 0 ? (
        <EmptyState title={t('common.empty')} text="Vous recevrez une alerte dès qu’une urgence compatible sera publiée près de vous." />
      ) : (
        <div className="space-y-2.5">
          {list.map((n) => (
            <Card key={n.id} className={`p-4 ${n.readAt ? '' : 'border-blood-200 bg-blood-50/30'}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${n.type === 'NEED_COVERED' ? 'bg-vital-50 text-vital-600' : 'bg-blood-50 text-blood-600'}`}>
                  {n.type === 'NEED_COVERED' ? <CheckIcon className="h-4 w-4" /> : <DropIcon className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-800">{n.title}</p>
                    <Badge tone={n.status === 'FAILED' ? 'red' : n.status === 'SENT' ? 'green' : 'neutral'}>{n.status}</Badge>
                    <Badge tone="neutral">{n.channel}</Badge>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600">{n.body}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-400">
                    <span>{formatDateTime(n.createdAt)}</span>
                    {n.latencyMs !== null ? <span>latence {n.latencyMs} ms</span> : null}
                    <span>{n.attempts} tentative(s)</span>
                    {n.error ? <span className="text-blood-600">{n.error}</span> : null}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {!n.readAt ? (
                    <button type="button" onClick={() => void markOne(n.id)} className="text-xs font-semibold text-blood-700 hover:underline">
                      Marquer lu
                    </button>
                  ) : null}
                  {n.type === 'URGENT_NEED' ? (
                    <Link to="/donneur" className="btn-secondary px-2.5 py-1.5 text-xs">
                      Répondre
                    </Link>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ historique */

interface HistoryPayload {
  donations: Array<{ id: string; donationDate: string; hospitalName?: string; bags?: number; createdAt?: string }>;
  responses: Array<{ urgencyId: string; status: string; answer?: string; createdAt: string; bloodGroup?: string; hospitalName?: string }>;
}

export function DonorHistory() {
  const { t, formatDate } = useI18n();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HistoryPayload>('/donors/me/history')
      .then(setData)
      .catch((err) => setError((err as ApiError).message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <LoadingBlock />;

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle title="Dons enregistrés" subtitle="Chaque ligne correspond à un don confirmé par un établissement." />
        {data.donations.length === 0 ? (
          <EmptyState title="Aucun don enregistré" text="Vos dons apparaîtront ici après clôture d’une urgence par l’hôpital." />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="px-5 pt-4">Date</th>
                  <th className="pt-4">Hôpital</th>
                  <th className="pt-4">Poches</th>
                </tr>
              </thead>
              <tbody>
                {data.donations.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5">{formatDate(d.donationDate)}</td>
                    <td>{d.hospitalName ?? 'Établissement partenaire'}</td>
                    <td>{d.bags ?? 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle title="Réponses aux alertes" subtitle="Historique de vos réponses, y compris celles qui n’ont pas abouti à une confirmation." />
        {data.responses.length === 0 ? (
          <EmptyState title="Aucune réponse pour l’instant" />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="px-5 pt-4">Date</th>
                  <th className="pt-4">Urgence</th>
                  <th className="pt-4">Statut</th>
                </tr>
              </thead>
              <tbody>
                {data.responses.map((r) => (
                  <tr key={r.urgencyId + r.createdAt}>
                    <td className="px-5">{formatDate(r.createdAt)}</td>
                    <td className="font-mono text-xs text-ink-500">{r.urgencyId.slice(0, 8)}</td>
                    <td>
                      <Badge tone={r.status === 'CONFIRMED' ? 'green' : r.status === 'DECLINED' ? 'neutral' : 'amber'}>
                        {t(`resp.${r.status}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ profil */

export function DonorProfilePage() {
  const { t, formatDate } = useI18n();
  const { donor, setDonor, error, loading, reload } = useDonorData();
  const { logout } = useAuth();
  const { push } = useToast();
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (donor && !Object.keys(form).length) {
      setForm({
        firstName: donor.firstName,
        lastName: donor.lastName,
        phone: donor.phone ?? '',
        city: donor.city,
        bloodGroup: donor.bloodGroup,
        birthDate: donor.birthDate ? donor.birthDate.slice(0, 10) : '',
        weightKg: donor.weightKg ?? '',
        lastDonationDate: donor.lastDonationDate ? donor.lastDonationDate.slice(0, 10) : '',
        notificationsConsent: donor.notificationsConsent,
      });
    }
  }, [donor, form]);

  if (loading && !donor) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!donor) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        city: form.city,
        bloodGroup: form.bloodGroup,
        notificationsConsent: form.notificationsConsent,
        birthDate: form.birthDate || null,
        lastDonationDate: form.lastDonationDate || null,
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
      };
      const data = await api.patch<{ donor: DonorProfile }>('/donors/me', payload);
      setDonor(data.donor);
      push('success', 'Profil mis à jour.');
    } catch (err) {
      push('error', (err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function sharePosition() {
    if (!('geolocation' in navigator)) {
      push('error', 'Géolocalisation non disponible dans ce navigateur.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await api.post<{ donor: DonorProfile }>('/donors/me/location', {
            lat: Number(pos.coords.latitude.toFixed(3)),
            lng: Number(pos.coords.longitude.toFixed(3)),
            consent: true,
          });
          setDonor(data.donor);
          push('success', 'Position approximative enregistrée (arrondie à ~1 km).');
        } catch (err) {
          push('error', (err as ApiError).message);
        }
      },
      () => push('error', 'Impossible d’obtenir votre position.'),
      { timeout: 8000 },
    );
  }

  async function withdrawLocation() {
    try {
      const data = await api.patch<{ donor: DonorProfile }>('/donors/me', { locationConsent: false, lat: null, lng: null });
      setDonor(data.donor);
      push('success', 'Consentement retiré et coordonnées effacées.');
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api.del('/auth/me');
      push('success', 'Compte supprimé. Vous allez être déconnecté.');
      await logout();
    } catch (err) {
      push('error', (err as ApiError).message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <SectionTitle title="Mon profil donneur" subtitle="Ces informations servent uniquement à vérifier la compatibilité et à calculer une distance." />
        <form className="space-y-5" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('auth.firstName')}>
              <Input value={form.firstName ?? ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </Field>
            <Field label={t('auth.lastName')}>
              <Input value={form.lastName ?? ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </Field>
            <Field label={t('auth.email')} hint="L’adresse e-mail est l’identifiant du compte et n’est pas modifiable ici.">
              <Input value={donor.email} disabled />
            </Field>
            <Field label={t('auth.phone')}>
              <Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            </Field>
            <Field label={t('auth.city')}>
              <Input value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
            </Field>
            <Field label={t('auth.bloodGroup')}>
              <Select value={form.bloodGroup ?? donor.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date de naissance" hint={t('common.optional')}>
              <Input type="date" value={form.birthDate ?? ''} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
            </Field>
            <Field label="Poids (kg)" hint={t('common.optional')}>
              <Input type="number" min={30} max={250} value={form.weightKg ?? ''} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} />
            </Field>
            <Field label="Date du dernier don" hint="Utilisée pour le délai minimum entre deux dons.">
              <Input type="date" value={form.lastDonationDate ?? ''} onChange={(e) => setForm({ ...form, lastDonationDate: e.target.value })} />
            </Field>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-ink-200 bg-ink-50/60 p-4 text-sm text-ink-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-blood-600"
              checked={Boolean(form.notificationsConsent)}
              onChange={(e) => setForm({ ...form, notificationsConsent: e.target.checked })}
            />
            <span>{t('auth.consentNotif')}</span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={saving}>
              {t('common.save')}
            </Button>
            <span className="text-xs text-ink-400">Profil créé le {formatDate(donor.createdAt)}</span>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <SectionTitle title={t('donor.locationTitle')} subtitle={t('donor.locationHelp')} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void sharePosition()}>
            <PinIcon className="h-4 w-4" />
            {t('donor.useMyPosition')}
          </Button>
          {donor.locationConsent ? (
            <Button variant="ghost" onClick={() => void withdrawLocation()}>
              {t('donor.consentWithdraw')}
            </Button>
          ) : null}
          <span className="text-xs text-ink-500">
            {donor.location ? `Position enregistrée (${donor.location.lat.toFixed(2)}, ${donor.location.lng.toFixed(2)})` : 'Aucune position enregistrée'}
          </span>
        </div>
      </Card>

      <Card className="border-blood-200 p-6">
        <SectionTitle title="Supprimer mon compte" subtitle="L’identité et les coordonnées sont effacées ; seules des statistiques anonymes sont conservées." />
        <Button variant="secondary" className="border-blood-200 text-blood-700 hover:bg-blood-50" onClick={() => setConfirmDelete(true)}>
          Demander la suppression
        </Button>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Confirmer la suppression du compte"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void deleteAccount()}>
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <p>
          Cette action anonymise votre compte, supprime vos coordonnées et vous déconnecte immédiatement. Les dons déjà
          enregistrés restent comptabilisés de façon anonyme.
        </p>
      </Modal>
    </div>
  );
}
