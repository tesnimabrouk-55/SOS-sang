import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import {
  api,
  ApiError,
  BLOOD_GROUPS,
  type HospitalProfile,
  type StockRow,
  type Urgence,
  type UrgenceResponseRow,
} from '../lib/api';
import { tokenStore } from '../lib/api';
import { useI18n } from '../lib/i18n';
import {
  Badge,
  BloodTag,
  Button,
  Card,
  CheckIcon,
  ClockIcon,
  DropIcon,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Progress,
  SectionTitle,
  Select,
  Stat,
  Textarea,
  useToast,
} from '../components/ui';
import { BarChart, Donut, MapSketch } from './charts';

/* ------------------------------------------------------------------ helpers */

function useHospital() {
  const [hospital, setHospital] = useState<HospitalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ hospital: HospitalProfile }>('/hospitals/me');
      setHospital(data.hospital);
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

  return { hospital, error, loading, reload: load };
}

const statusTone: Record<string, 'red' | 'amber' | 'green' | 'neutral'> = {
  OPEN: 'red',
  COVERED: 'green',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};
const priorityTone: Record<string, 'red' | 'amber' | 'neutral'> = { CRITICAL: 'red', HIGH: 'amber', NORMAL: 'neutral' };

function formatDelay(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function PendingValidation() {
  const { t } = useI18n();
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <ClockIcon />
      </span>
      <h1 className="mt-4 text-xl font-bold text-ink-900">{t('hospital.pendingValidation')}</h1>
      <p className="mt-2 text-sm text-ink-600">{t('hospital.pendingText')}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ tableau de bord */

interface DashPayload {
  hospital: HospitalProfile;
  counts: { active: number; open: number; covered: number; closed: number; cancelled: number };
  latest: Urgence[];
}

export function HospitalDashboard() {
  const { t, formatDateTime } = useI18n();
  const { hospital, loading, error, reload } = useHospital();
  const [dash, setDash] = useState<DashPayload | null>(null);
  const [stocks, setStocks] = useState<StockRow[]>([]);

  const loadDash = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        api.get<DashPayload>('/hospitals/me/dashboard'),
        api.get<{ stocks: StockRow[] }>('/stock/me').catch(() => ({ stocks: [] })),
      ]);
      setDash(d);
      setStocks(s.stocks);
    } catch {
      /* le statut du compte est deja remonte par useHospital */
    }
  }, []);

  useEffect(() => {
    void loadDash();
  }, [loadDash]);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    const socket: Socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    const onChange = () => void loadDash();
    socket.on('urgence:update', onChange);
    socket.on('urgence:response', onChange);
    return () => {
      socket.close();
    };
  }, [loadDash]);

  if (loading && !hospital) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-28" />
        <div className="skeleton h-56" />
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (hospital?.status === 'PENDING') return <PendingValidation />;
  if (!hospital) return null;

  const low = stocks.filter((s) => s.low);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-500">{t('hospital.space')}</p>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{hospital.name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {hospital.city} · {hospital.address ?? 'adresse non renseignée'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/hopital/nouvelle-urgence" className="btn-primary">
            <DropIcon className="h-4 w-4" />
            {t('hospital.declare')}
          </Link>
          <Link to="/hopital/urgences" className="btn-secondary">
            {t('nav.urgences')}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('hospital.activeUrgences')} value={dash?.counts.active ?? '—'} tone="red" icon={<DropIcon />} />
        <Stat label={t('hospital.covered')} value={dash?.counts.covered ?? '—'} tone="green" icon={<CheckIcon />} />
        <Stat label={t('hospital.pending')} value={dash?.counts.open ?? '—'} icon={<ClockIcon />} />
        <Stat label={t('hospital.closed')} value={dash?.counts.closed ?? '—'} icon={<CheckIcon />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <SectionTitle
            title="Dernières urgences"
            subtitle="Mise à jour automatique à chaque réponse de donneur."
            action={
              <Link to="/hopital/urgences" className="link text-xs">
                Tout voir
              </Link>
            }
          />
          {dash && dash.latest.length ? (
            <div className="space-y-2.5">
              {dash.latest.slice(0, 5).map((u) => (
                <Link
                  key={u.id}
                  to={`/hopital/urgences/${u.id}`}
                  className="flex items-center gap-3 rounded-xl border border-ink-100 px-3 py-3 transition hover:border-blood-200 hover:bg-blood-50/40"
                >
                  <BloodTag group={u.bloodGroup} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={priorityTone[u.priority]}>{t(`priority.${u.priority}`)}</Badge>
                      <Badge tone={statusTone[u.status]}>{t(`status.${u.status}`)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {u.bagsConfirmed}/{u.bagsNeeded} poches · {u.counts?.contacted ?? 0} contactés · échéance{' '}
                      {formatDateTime(u.deadlineAt)}
                    </p>
                  </div>
                  <Progress value={u.bagsConfirmed} max={u.bagsNeeded} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucune urgence déclarée"
              text="Déclarez une urgence pour alerter immédiatement les donneurs compatibles à proximité."
              action={
                <Link to="/hopital/nouvelle-urgence" className="btn-primary">
                  {t('hospital.declare')}
                </Link>
              }
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle title={t('hospital.stockTitle')} action={<Link to="/hopital/stocks" className="link text-xs">Gérer</Link>} />
            <div className="grid grid-cols-4 gap-2">
              {stocks.slice(0, 8).map((s) => (
                <div
                  key={s.bloodGroup}
                  className={`rounded-lg border p-2 text-center ${s.low ? 'border-blood-200 bg-blood-50' : 'border-ink-100 bg-white'}`}
                >
                  <p className="text-xs font-bold text-ink-700">{s.bloodGroup}</p>
                  <p className={`text-lg font-bold ${s.low ? 'text-blood-700' : 'text-ink-800'}`}>{s.units}</p>
                </div>
              ))}
            </div>
            {low.length ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {low.length} groupe(s) sous le seuil : {low.map((s) => s.bloodGroup).join(', ')}
              </p>
            ) : (
              <p className="mt-3 text-xs text-ink-400">Tous les groupes sont au-dessus de leur seuil.</p>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle title="Localisation" subtitle={t('hospital.mapNote')} />
            <MapSketch
              center={hospital.location ?? { lat: 36.8, lng: 10.18 }}
              points={
                hospital.location
                  ? [{ id: hospital.id, lat: hospital.location.lat, lng: hospital.location.lng, label: hospital.name, kind: 'hospital' }]
                  : []
              }
              height={190}
            />
            <p className="mt-2 text-[11px] text-ink-400">
              Les coordonnées précises des donneurs ne sont jamais exposées à l’interface hospitalière.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ liste urgences */

export function HospitalUrgences() {
  const { t, formatDateTime } = useI18n();
  const { hospital, loading } = useHospital();
  const [urgences, setUrgences] = useState<Urgence[]>([]);
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'COVERED' | 'CLOSED'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ urgences: Urgence[] }>('/hospitals/me/urgences');
      setUrgences(data.urgences);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hospital?.status === 'PENDING') return <PendingValidation />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (loading && !urgences.length) return <div className="skeleton h-64" />;

  const list = filter === 'all' ? urgences : urgences.filter((u) => u.status === filter);

  return (
    <div>
      <SectionTitle
        title={t('nav.urgences')}
        subtitle="Suivi des demandes de l’établissement, du plus récent au plus ancien."
        action={
          <Link to="/hopital/nouvelle-urgence" className="btn-primary">
            {t('hospital.declare')}
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['all', 'OPEN', 'COVERED', 'CLOSED'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              filter === f ? 'border-ink-800 bg-ink-800 text-white' : 'border-ink-200 bg-white text-ink-600'
            }`}
          >
            {f === 'all' ? t('common.all') : t(`status.${f}`)}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState title="Aucune urgence dans ce filtre" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-4">Groupe</th>
                <th className="pt-4">Priorité</th>
                <th className="pt-4">Poches</th>
                <th className="pt-4">Contactés</th>
                <th className="pt-4">Échéance</th>
                <th className="pt-4">Statut</th>
                <th className="pt-4 pe-5 text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td className="px-5">
                    <BloodTag group={u.bloodGroup} size="sm" />
                  </td>
                  <td>
                    <Badge tone={priorityTone[u.priority]}>{t(`priority.${u.priority}`)}</Badge>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink-700">
                        {u.bagsConfirmed}/{u.bagsNeeded}
                      </span>
                      <div className="w-16">
                        <Progress value={u.bagsConfirmed} max={u.bagsNeeded} />
                      </div>
                    </div>
                  </td>
                  <td className="text-xs">{u.counts?.contacted ?? 0}</td>
                  <td className="text-xs">{formatDateTime(u.deadlineAt)}</td>
                  <td>
                    <Badge tone={statusTone[u.status]}>{t(`status.${u.status}`)}</Badge>
                  </td>
                  <td className="pe-5 text-end">
                    <Link to={`/hopital/urgences/${u.id}`} className="text-xs font-semibold text-blood-700 hover:underline">
                      Détail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ nouvelle urgence */

export function NewUrgencePage() {
  const { t } = useI18n();
  const { hospital } = useHospital();
  const navigate = useNavigate();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    bloodGroup: 'O-',
    bagsNeeded: 2,
    priority: 'CRITICAL',
    deadline: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16),
    notes: '',
    contactPhone: '',
  });

  if (hospital?.status === 'PENDING') return <PendingValidation />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        bloodGroup: form.bloodGroup,
        bagsNeeded: Number(form.bagsNeeded),
        priority: form.priority,
        deadlineAt: new Date(form.deadline).toISOString(),
        notes: form.notes || undefined,
        contactPhone: form.contactPhone || undefined,
      };
      if (hospital?.location) {
        payload.lat = hospital.location.lat;
        payload.lng = hospital.location.lng;
        payload.city = hospital.city;
      }
      const data = await api.post<{ urgence: Urgence }>('/hospitals/me/urgences', payload);
      push('success', 'Urgence publiée. Les donneurs compatibles sont en cours d’alerte.');
      navigate(`/hopital/urgences/${data.urgence.id}`);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.code === 'HOSPITAL_NOT_APPROVED' ? t('hospital.pendingText') : apiErr.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SectionTitle title={t('hospital.declare')} subtitle={t('hospital.declareSubtitle')} />
      <Card className="p-6">
        {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('auth.bloodGroup')}>
              <Select value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hospital.bagsNeeded')} hint="Entre 1 et 50 poches.">
              <Input
                type="number"
                min={1}
                max={50}
                required
                value={form.bagsNeeded}
                onChange={(e) => setForm({ ...form, bagsNeeded: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('common.priority')}>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="CRITICAL">Critique</option>
                <option value="HIGH">Élevée</option>
                <option value="NORMAL">Normale</option>
              </Select>
            </Field>
            <Field label={t('hospital.deadline')}>
              <Input
                type="datetime-local"
                required
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </Field>
          </div>

          <Field label={t('hospital.notes')} hint="Visible uniquement par l’établissement.">
            <Textarea value={form.notes} maxLength={500} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          <Field label={t('hospital.contactPhone')} hint="Transmis aux donneurs confirmés.">
            <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder={hospital?.phone ?? ''} />
          </Field>

          <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4 text-xs text-ink-600">
            <p className="font-semibold text-ink-700">Localisation utilisée</p>
            <p className="mt-1">
              {hospital?.location
                ? `${hospital.city} (${hospital.location.lat.toFixed(3)}, ${hospital.location.lng.toFixed(3)}) — coordonnées de l’établissement.`
                : 'Aucune coordonnée enregistrée pour cet établissement : le matching utilisera la ville uniquement.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" loading={saving}>
              Publier et alerter
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ detail urgence */

interface DetailPayload {
  urgence: Urgence;
  responses: UrgenceResponseRow[];
}

export function UrgenceDetailPage() {
  const { id = '' } = useParams();
  const { t, formatDateTime, formatDate } = useI18n();
  const { push } = useToast();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [granted, setGranted] = useState<Record<string, number>>({});
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<DetailPayload>(`/hospitals/me/urgences/${id}`);
      setData(payload);
      setError(null);
      setGranted((prev) => {
        if (Object.keys(prev).length) return prev;
        const initial: Record<string, number> = {};
        for (const r of payload.responses.filter((r) => r.status === 'CONFIRMED')) initial[r.donorId] = 1;
        return initial;
      });
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token || !id) return;
    const socket: Socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('urgence:response', (payload: any) => {
      if (payload?.urgenceId === id) void load();
    });
    socket.on('urgence:update', (payload: any) => {
      if (payload?.urgenceId === id) void load();
    });
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [id, load]);

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <div className="skeleton h-72" />;

  const { urgence, responses } = data;
  const confirmed = responses.filter((r) => r.status === 'CONFIRMED');
  const coming = responses.filter((r) => r.status === 'COMING');
  const declined = responses.filter((r) => r.status === 'DECLINED');

  async function closeUrgence() {
    setClosing(true);
    try {
      await api.post(`/hospitals/me/urgences/${id}/close`, {
        donations: confirmed.map((r) => ({ donorId: r.donorId, bags: granted[r.donorId] ?? 1 })),
      });
      push('success', 'Urgence clôturée. Les dons sont enregistrés dans l’historique des donneurs.');
      await load();
    } catch (err) {
      push('error', (err as ApiError).message);
    } finally {
      setClosing(false);
    }
  }

  async function cancelUrgence() {
    try {
      await api.post(`/hospitals/me/urgences/${id}/cancel`);
      push('success', 'Urgence annulée.');
      setConfirmCancel(false);
      await load();
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BloodTag group={urgence.bloodGroup} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={priorityTone[urgence.priority]}>{t(`priority.${urgence.priority}`)}</Badge>
              <Badge tone={statusTone[urgence.status]}>{t(`status.${urgence.status}`)}</Badge>
              {live ? (
                <span className="badge bg-vital-50 text-vital-600">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-vital-500" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-vital-600" />
                  </span>
                  {t('hospital.realtime')}
                </span>
              ) : null}
            </div>
            <h1 className="mt-1.5 text-xl font-bold text-ink-900">
              {urgence.bagsNeeded} poche(s) de {urgence.bloodGroup}
            </h1>
            <p className="text-xs text-ink-500">
              Déclarée le {formatDateTime(urgence.createdAt)} · échéance {formatDateTime(urgence.deadlineAt)} · rayon {urgence.radiusKm} km
            </p>
          </div>
        </div>
        <Link to="/hopital/urgences" className="btn-secondary">
          {t('common.back')}
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('hospital.contacted')} value={urgence.counts?.contacted ?? responses.length} />
        <Stat label={t('hospital.coming')} value={coming.length + confirmed.length} />
        <Stat label={t('hospital.confirmed')} value={confirmed.length} tone="green" />
        <Stat label={t('hospital.declined')} value={declined.length} />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-ink-700">
            {urgence.bagsConfirmed} / {urgence.bagsNeeded} poches confirmées
          </span>
          <span className="text-xs text-ink-500">{Math.round((urgence.bagsConfirmed / urgence.bagsNeeded) * 100)}%</span>
        </div>
        <div className="mt-2">
          <Progress value={urgence.bagsConfirmed} max={urgence.bagsNeeded} tone={urgence.status === 'COVERED' ? 'green' : 'red'} />
        </div>
        {urgence.notes ? <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">{urgence.notes}</p> : null}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-ink-100 px-5 py-4">
          <SectionTitle title={t('hospital.responders')} subtitle="Les identités complètes ne sont pas exposées : chaque donneur est identifié par son rang de sélection." />
        </div>
        {responses.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Aucun donneur contacté pour l’instant" text="Le matching publie les sélections quelques secondes après la déclaration." />
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-3">Donneur</th>
                <th className="pt-3">{t('common.distance')}</th>
                <th className="pt-3">Rang</th>
                <th className="pt-3">Statut</th>
                {urgence.status !== 'CLOSED' && urgence.status !== 'CANCELLED' ? <th className="pt-3 pe-5 text-end">Poches</th> : null}
              </tr>
            </thead>
            <tbody>
              {responses.map((r, i) => (
                <tr key={r.donorId}>
                  <td className="px-5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-[11px] font-bold text-ink-500">
                        D{i + 1}
                      </span>
                      <span className="font-mono text-[11px] text-ink-400">{r.donorId.slice(0, 8)}</span>
                    </div>
                  </td>
                  <td className="text-xs">{r.distanceKm !== null ? `${r.distanceKm.toFixed(1)} km` : '—'}</td>
                  <td className="text-xs">{r.rank ?? '—'}</td>
                  <td>
                    <Badge tone={r.status === 'CONFIRMED' ? 'green' : r.status === 'DECLINED' ? 'neutral' : r.status === 'COMING' ? 'amber' : 'neutral'}>
                      {t(`resp.${r.status}`)}
                    </Badge>
                  </td>
                  {urgence.status !== 'CLOSED' && urgence.status !== 'CANCELLED' ? (
                    <td className="pe-5 text-end">
                      {r.status === 'CONFIRMED' ? (
                        <Select
                          className="!w-20 !py-1 text-xs"
                          value={granted[r.donorId] ?? 1}
                          onChange={(e) => setGranted({ ...granted, [r.donorId]: Number(e.target.value) })}
                        >
                          {[1, 2, 3].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-ink-300">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {urgence.status === 'OPEN' || urgence.status === 'COVERED' ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-semibold text-ink-800">Clôturer l’urgence</p>
            <p className="text-xs text-ink-500">
              Enregistre les dons réellement effectués et libère les donneurs non retenus. Action définitive.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
              {t('hospital.cancelUrgence')}
            </Button>
            <Button loading={closing} onClick={() => void closeUrgence()}>
              {t('hospital.closeUrgence')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5 text-sm text-ink-600">
          Urgence {t(`status.${urgence.status}`).toLowerCase()} le {formatDate(urgence.closedAt ?? urgence.coveredAt ?? urgence.createdAt)}.
        </Card>
      )}

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Annuler cette urgence ?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              {t('common.back')}
            </Button>
            <Button variant="danger" onClick={() => void cancelUrgence()}>
              {t('hospital.cancelUrgence')}
            </Button>
          </>
        }
      >
        <p>Les donneurs déjà confirmés ne seront pas notifiés automatiquement de l’annulation. Prévoyez de les contacter.</p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ stocks */

export function StockPage() {
  const { t, formatDateTime } = useI18n();
  const { hospital } = useHospital();
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; bloodGroup: string; delta: number; reason: string | null; createdAt: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { push } = useToast();

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        api.get<{ stocks: StockRow[] }>('/stock/me'),
        api.get<{ movements: typeof history }>('/stock/me/history').catch(() => ({ movements: [] })),
      ]);
      setStocks(s.stocks);
      setHistory(h.movements ?? []);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hospital?.status === 'PENDING') return <PendingValidation />;

  async function adjust(group: string, delta: number) {
    try {
      await api.post(`/stock/me/${encodeURIComponent(group)}/adjust`, { delta, reason: 'Ajustement manuel' });
      await load();
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  async function setUnits(group: string) {
    const value = Number(draft[group]);
    if (Number.isNaN(value)) return;
    try {
      await api.put(`/stock/me/${encodeURIComponent(group)}`, { units: value });
      setDraft({ ...draft, [group]: '' });
      push('success', `Stock ${group} mis à jour.`);
      await load();
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      <SectionTitle title={t('hospital.stockTitle')} subtitle="Unités disponibles par groupe sanguin, avec seuil d’alerte configurable." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stocks.map((s) => (
          <Card key={s.bloodGroup} className={`p-4 ${s.low ? 'border-blood-200' : ''}`}>
            <div className="flex items-center justify-between">
              <BloodTag group={s.bloodGroup} />
              <Badge tone={s.low ? 'red' : 'green'}>{s.low ? t('hospital.stockLow') : t('hospital.stockOk')}</Badge>
            </div>
            <p className="mt-3 text-3xl font-bold text-ink-900">{s.units}</p>
            <p className="text-[11px] uppercase tracking-wide text-ink-400">seuil {s.threshold}</p>
            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void adjust(s.bloodGroup, -1)}
                disabled={s.units === 0}
                className="h-8 w-8 rounded-lg border border-ink-200 text-sm font-bold text-ink-600 disabled:opacity-40"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => void adjust(s.bloodGroup, 1)}
                className="h-8 w-8 rounded-lg border border-ink-200 text-sm font-bold text-ink-600"
              >
                +
              </button>
              <input
                className="input !w-16 !py-1 text-center text-xs"
                placeholder="set"
                value={draft[s.bloodGroup] ?? ''}
                onChange={(e) => setDraft({ ...draft, [s.bloodGroup]: e.target.value })}
              />
              <button
                type="button"
                onClick={() => void setUnits(s.bloodGroup)}
                className="rounded-lg bg-ink-800 px-2 py-1.5 text-[11px] font-semibold text-white"
              >
                {t('hospital.setUnits')}
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-ink-100 px-5 py-4">
          <SectionTitle title="Mouvements récents" subtitle="Chaque ajustement est journalisé côté service de stock." />
        </div>
        {history.length === 0 ? (
          <p className="p-5 text-sm text-ink-400">{t('common.empty')}</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-3">Date</th>
                <th className="pt-3">Groupe</th>
                <th className="pt-3">Variation</th>
                <th className="pt-3 pe-5">Motif</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 12).map((m) => (
                <tr key={m.id}>
                  <td className="px-5 text-xs">{formatDateTime(m.createdAt)}</td>
                  <td className="text-xs font-semibold">{m.bloodGroup}</td>
                  <td className={`text-xs font-semibold ${m.delta > 0 ? 'text-vital-600' : 'text-blood-700'}`}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </td>
                  <td className="pe-5 text-xs text-ink-500">{m.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ statistiques */

interface StatsPayload {
  byStatus: Array<{ status: string; count: number }>;
  byBloodGroup: Array<{ bloodGroup: string; count: number }>;
  avgCoverSeconds: number | null;
  responses: Array<{ status: string; count: number }>;
}

export function HospitalStatsPage() {
  const { t } = useI18n();
  const { hospital } = useHospital();
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<StatsPayload>('/hospitals/me/stats')
      .then(setStats)
      .catch((err) => setError((err as ApiError).message));
  }, []);

  if (hospital?.status === 'PENDING') return <PendingValidation />;
  if (error) return <ErrorBanner message={error} />;
  if (!stats) return <div className="skeleton h-72" />;

  const totalUrgences = stats.byStatus.reduce((s, r) => s + r.count, 0);
  const totalResponses = stats.responses.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-5">
      <SectionTitle title={t('nav.stats')} subtitle="Indicateurs calculés à partir des urgences et réponses de votre établissement." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Urgences déclarées" value={totalUrgences} />
        <Stat label="Réponses de donneurs" value={totalResponses} />
        <Stat label="Délai moyen de couverture" value={formatDelay(stats.avgCoverSeconds)} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="Urgences par statut" />
          <BarChart
            data={stats.byStatus.map((r) => ({
              label: t(`status.${r.status}`),
              value: r.count,
              color: r.status === 'COVERED' ? '#12A150' : r.status === 'OPEN' ? '#E03131' : '#8C95A6',
            }))}
          />
        </Card>
        <Card className="p-5">
          <SectionTitle title="Réponses par statut" />
          <Donut
            data={stats.responses.map((r) => ({ label: t(`resp.${r.status}`), value: r.count }))}
            centerLabel="Réponses"
          />
        </Card>
        <Card className="p-5 lg:col-span-2">
          <SectionTitle title="Demandes par groupe sanguin" />
          <BarChart data={stats.byBloodGroup.map((r) => ({ label: r.bloodGroup, value: r.count }))} />
        </Card>
      </div>
    </div>
  );
}
