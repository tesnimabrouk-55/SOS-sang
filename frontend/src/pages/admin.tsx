import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AuthUser, type DonorNotification } from '../lib/api';
import { useI18n } from '../lib/i18n';
import {
  Badge,
  Button,
  Card,
  CheckIcon,
  CrossIcon,
  DocIcon,
  EmptyState,
  ErrorBanner,
  PulseIcon,
  SectionTitle,
  Select,
  Stat,
  useToast,
} from '../components/ui';
import { BarChart, Donut } from './charts';

/* ------------------------------------------------------------------ hooks */

function useApi<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps.concat(load));

  return { data, setData, error, loading, reload: load };
}

/* ------------------------------------------------------------------ vue d'ensemble */

interface Overview {
  live: { urgencesDeclared: number; bagsCollected: number; donorsMobilized: number; hospitalsEngaged: number; avgMobilisationSeconds: number };
  users: { users: Array<{ role: string; status: string; count: number }>; totals: Record<string, number>; pendingHospitals: number } | null;
  urgences: { byStatus: Array<{ status: string; count: string }>; byPriority: Array<{ priority: string; count: string }> };
  series: Array<{ day: string; count: number }>;
  recentEvents: Array<{ type: string; occurred_at: string; correlation_id: string | null }>;
}

export function AdminOverview() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi<Overview>('/dashboard/admin/overview');

  if (loading && !data) return <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return null;

  const totalUsers = data.users?.totals ? Object.values(data.users.totals).reduce((s, n) => s + n, 0) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{t('admin.overview')}</h1>
        <p className="text-sm text-ink-500">Supervision globale de la plateforme, alimentée par le journal d’événements.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.urgencesDeclared')} value={data.live.urgencesDeclared} tone="red" />
        <Stat label={t('admin.donorsMobilized')} value={data.live.donorsMobilized} />
        <Stat label={t('admin.bagsCollected')} value={data.live.bagsCollected} tone="green" />
        <Stat label={t('admin.avgMobilisation')} value={data.live.avgMobilisationSeconds ? `${data.live.avgMobilisationSeconds} s` : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <SectionTitle title="Utilisateurs" subtitle={`${totalUsers} comptes au total`} />
          <Donut
            data={(data.users?.users ?? []).map((u) => ({
              label: `${u.role} · ${u.status}`,
              value: u.count,
              color: u.role === 'DONOR' ? '#E03131' : u.role === 'HOSPITAL' ? '#A51111' : '#12A150',
            }))}
            centerLabel="Comptes"
          />
          {data.users?.pendingHospitals ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {data.users.pendingHospitals} hôpital(aux) en attente de validation
            </p>
          ) : null}
        </Card>

        <Card className="p-5">
          <SectionTitle title="Urgences par priorité" subtitle="Événements urgence.creee" />
          <BarChart data={data.urgences.byPriority.map((r) => ({ label: r.priority, value: Number(r.count) }))} />
        </Card>

        <Card className="p-5">
          <SectionTitle title="Urgences déclarées (14 j)" />
          <BarChart data={data.series.map((s) => ({ label: s.day.slice(5), value: s.count }))} height={150} />
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-ink-100 px-5 py-4">
          <SectionTitle title={t('admin.events')} subtitle="25 derniers événements reçus par le service de tableau de bord." />
        </div>
        {data.recentEvents.length === 0 ? (
          <p className="p-5 text-sm text-ink-400">{t('common.empty')}</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.recentEvents.map((e, i) => (
              <li key={`${e.type}-${i}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blood-400" />
                  <code className="text-xs font-semibold text-ink-700">{e.type}</code>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-ink-400">
                  {e.correlation_id ? <span className="font-mono">{e.correlation_id.slice(0, 8)}</span> : null}
                  <span>{new Date(e.occurred_at).toLocaleString('fr-FR')}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ hopitaux */

export function AdminHospitals() {
  const { t } = useI18n();
  const { data, error, reload } = useApi<{ users: AuthUser[] }>('/admin/users?role=HOSPITAL');
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      await api.post(`/admin/hospitals/${id}/${action}`);
      push('success', action === 'approve' ? 'Établissement validé.' : 'Établissement refusé.');
      await reload();
    } catch (err) {
      push('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  const hospitals = data?.users ?? [];
  const pending = hospitals.filter((h) => h.status === 'PENDING');

  return (
    <div className="space-y-5">
      <SectionTitle
        title={t('nav.hospitals')}
        subtitle="Un compte établissement reste sans accès tant qu’un administrateur ne l’a pas validé."
        action={<Badge tone={pending.length ? 'amber' : 'green'}>{pending.length} en attente</Badge>}
      />

      {hospitals.length === 0 ? (
        <EmptyState title="Aucun établissement enregistré" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-4">Établissement</th>
                <th className="pt-4">Contact</th>
                <th className="pt-4">Créé le</th>
                <th className="pt-4">Statut</th>
                <th className="pt-4 pe-5 text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {hospitals.map((h) => (
                <tr key={h.id}>
                  <td className="px-5">
                    <p className="font-semibold text-ink-800">{h.fullName}</p>
                    <p className="text-xs text-ink-500">{h.email}</p>
                  </td>
                  <td className="text-xs">{h.phone ?? '—'}</td>
                  <td className="text-xs">{new Date(h.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td>
                    <Badge tone={h.status === 'ACTIVE' ? 'green' : h.status === 'PENDING' ? 'amber' : 'red'}>
                      {h.status === 'ACTIVE' ? 'Validé' : h.status === 'PENDING' ? 'En attente' : 'Refusé'}
                    </Badge>
                  </td>
                  <td className="pe-5 text-end">
                    <div className="flex justify-end gap-1.5">
                      {h.status !== 'ACTIVE' ? (
                        <Button className="px-2.5 py-1.5 text-xs" loading={busy === h.id} onClick={() => void act(h.id, 'approve')}>
                          <CheckIcon className="h-3.5 w-3.5" />
                          {t('admin.approve')}
                        </Button>
                      ) : null}
                      {h.status === 'PENDING' ? (
                        <Button
                          variant="secondary"
                          className="border-blood-200 px-2.5 py-1.5 text-xs text-blood-700"
                          onClick={() => void act(h.id, 'reject')}
                        >
                          <CrossIcon className="h-3.5 w-3.5" />
                          {t('admin.reject')}
                        </Button>
                      ) : null}
                    </div>
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

/* ------------------------------------------------------------------ utilisateurs */

export function AdminUsers() {
  const { t } = useI18n();
  const [role, setRole] = useState('');
  const { data, error, reload } = useApi<{ users: AuthUser[] }>(`/admin/users${role ? `?role=${role}` : ''}`, [role]);
  const { push } = useToast();
  const [query, setQuery] = useState('');

  async function changeRole(id: string, next: string) {
    try {
      await api.patch(`/admin/users/${id}/role`, { role: next });
      push('success', 'Rôle mis à jour.');
      await reload();
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  async function suspend(id: string) {
    try {
      await api.post(`/admin/users/${id}/suspend`);
      push('success', 'Compte suspendu.');
      await reload();
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  const users = (data?.users ?? []).filter(
    (u) => !query || u.email.toLowerCase().includes(query.toLowerCase()) || u.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('nav.users')}
        subtitle="Recherche, changement de rôle et suspension. Toute action est journalisée."
        action={
          <Select className="!w-40" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Tous les rôles</option>
            <option value="DONOR">Donneurs</option>
            <option value="HOSPITAL">Hôpitaux</option>
            <option value="ADMIN">Administrateurs</option>
          </Select>
        }
      />

      <input
        className="input max-w-sm"
        placeholder="Rechercher par nom ou e-mail…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {users.length === 0 ? (
        <EmptyState title="Aucun utilisateur" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-4">Utilisateur</th>
                <th className="pt-4">Rôle</th>
                <th className="pt-4">Statut</th>
                <th className="pt-4">Créé le</th>
                <th className="pt-4 pe-5 text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.slice(0, 60).map((u) => (
                <tr key={u.id}>
                  <td className="px-5">
                    <p className="font-semibold text-ink-800">{u.fullName}</p>
                    <p className="text-xs text-ink-500">{u.email}</p>
                  </td>
                  <td>
                    <Select className="!w-32 !py-1 text-xs" value={u.role} onChange={(e) => void changeRole(u.id, e.target.value)}>
                      <option value="DONOR">DONOR</option>
                      <option value="HOSPITAL">HOSPITAL</option>
                      <option value="ADMIN">ADMIN</option>
                    </Select>
                  </td>
                  <td>
                    <Badge tone={u.status === 'ACTIVE' ? 'green' : u.status === 'PENDING' ? 'amber' : 'red'}>{u.status}</Badge>
                  </td>
                  <td className="text-xs">{new Date(u.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td className="pe-5 text-end">
                    {u.status === 'ACTIVE' ? (
                      <button type="button" onClick={() => void suspend(u.id)} className="text-xs font-semibold text-blood-700 hover:underline">
                        {t('admin.suspend')}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-300">—</span>
                    )}
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

/* ------------------------------------------------------------------ urgences */

interface AdminUrgence {
  id: string;
  status: string;
  lastEvent: string;
  lastEventAt: string;
  bloodGroup: string | null;
  priority: string | null;
  hospitalId: string | null;
  bagsNeeded: number | null;
  bagsConfirmed: number;
}

export function AdminUrgences() {
  const { t } = useI18n();
  const { data, error, reload } = useApi<{ urgences: AdminUrgence[] }>('/dashboard/admin/urgences');
  const [status, setStatus] = useState<'all' | 'OPEN' | 'COVERED' | 'CLOSED'>('all');

  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  const all = data?.urgences ?? [];
  const list = status === 'all' ? all : all.filter((u) => u.status === status);

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('nav.urgences')}
        subtitle="Vue reconstruite depuis les événements : aucun accès direct aux tables du service hospitalier."
        action={
          <Select className="!w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">{t('common.all')}</option>
            <option value="OPEN">Ouvertes</option>
            <option value="COVERED">Couvertes</option>
            <option value="CLOSED">Clôturées</option>
          </Select>
        }
      />

      {list.length === 0 ? (
        <EmptyState title="Aucune urgence dans ce filtre" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-4">Référence</th>
                <th className="pt-4">Groupe</th>
                <th className="pt-4">Priorité</th>
                <th className="pt-4">Poches</th>
                <th className="pt-4">Dernier événement</th>
                <th className="pt-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 font-mono text-xs text-ink-500">{u.id.slice(0, 8)}</td>
                  <td className="text-xs font-semibold">{u.bloodGroup ?? '—'}</td>
                  <td>
                    <Badge tone={u.priority === 'CRITICAL' ? 'red' : u.priority === 'HIGH' ? 'amber' : 'neutral'}>{u.priority ?? '—'}</Badge>
                  </td>
                  <td className="text-xs">
                    {u.bagsConfirmed}/{u.bagsNeeded ?? '?'}
                  </td>
                  <td className="text-xs">
                    <code className="text-[11px] text-ink-600">{u.lastEvent}</code>
                    <span className="ms-2 text-ink-400">{new Date(u.lastEventAt).toLocaleString('fr-FR')}</span>
                  </td>
                  <td>
                    <Badge tone={u.status === 'OPEN' ? 'red' : u.status === 'COVERED' ? 'green' : 'neutral'}>{t(`status.${u.status}`)}</Badge>
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

/* ------------------------------------------------------------------ notifications */

interface NotifStats {
  byStatus: Array<{ status: string; count: number }>;
  byChannel: Array<{ channel: string; count: number }>;
  latency: { avgMs: number | null; maxMs: number | null; p95Ms: number | null };
  transport: string;
}

export function AdminNotifications() {
  const { t } = useI18n();
  const stats = useApi<NotifStats>('/admin/notifications/stats');
  const list = useApi<{ notifications: DonorNotification[] }>('/admin/notifications');
  const { push } = useToast();

  async function retry(id: string) {
    try {
      await api.post(`/admin/notifications/${id}/retry`);
      push('success', 'Nouvelle tentative demandée.');
      await list.reload();
    } catch (err) {
      push('error', (err as ApiError).message);
    }
  }

  if (stats.error) return <ErrorBanner message={stats.error} onRetry={stats.reload} />;
  if (!stats.data) return <div className="skeleton h-40" />;

  return (
    <div className="space-y-5">
      <SectionTitle
        title={t('admin.notifSupervision')}
        subtitle={`Transport e-mail configuré : ${stats.data.transport} (les envois réels sont simulés dans cette démonstration).`}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('admin.avgLatency')} value={stats.data.latency.avgMs !== null ? `${stats.data.latency.avgMs} ms` : '—'} tone="green" />
        <Stat label={t('admin.p95Latency')} value={stats.data.latency.p95Ms !== null ? `${stats.data.latency.p95Ms} ms` : '—'} />
        <Stat label={t('admin.maxLatency')} value={stats.data.latency.maxMs !== null ? `${stats.data.latency.maxMs} ms` : '—'} />
        <Stat
          label={t('admin.failed')}
          value={stats.data.byStatus.find((s) => s.status === 'FAILED')?.count ?? 0}
          tone={stats.data.byStatus.find((s) => s.status === 'FAILED')?.count ? 'red' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="Par canal" />
          <Donut data={stats.data.byChannel.map((c) => ({ label: c.channel, value: c.count }))} centerLabel="Envois" />
        </Card>
        <Card className="p-5">
          <SectionTitle title="Par statut" />
          <BarChart
            data={stats.data.byStatus.map((s) => ({
              label: s.status,
              value: s.count,
              color: s.status === 'FAILED' ? '#A51111' : s.status === 'SENT' ? '#12A150' : '#8C95A6',
            }))}
          />
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-ink-100 px-5 py-4">
          <SectionTitle title="Dernières notifications" subtitle="Chaque échec peut être relancé manuellement." />
        </div>
        {list.error ? (
          <p className="p-5 text-sm text-blood-700">{list.error}</p>
        ) : (list.data?.notifications.length ?? 0) === 0 ? (
          <p className="p-5 text-sm text-ink-400">{t('common.empty')}</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-3">Titre</th>
                <th className="pt-3">Canal</th>
                <th className="pt-3">Statut</th>
                <th className="pt-3">Latence</th>
                <th className="pt-3 pe-5 text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.data!.notifications.slice(0, 30).map((n) => (
                <tr key={n.id}>
                  <td className="max-w-[280px] truncate px-5 text-xs">{n.title}</td>
                  <td className="text-xs">{n.channel}</td>
                  <td>
                    <Badge tone={n.status === 'FAILED' ? 'red' : n.status === 'SENT' ? 'green' : 'neutral'}>{n.status}</Badge>
                  </td>
                  <td className="text-xs">{n.latencyMs !== null ? `${n.latencyMs} ms` : '—'}</td>
                  <td className="pe-5 text-end">
                    {n.status === 'FAILED' ? (
                      <button type="button" onClick={() => void retry(n.id)} className="text-xs font-semibold text-blood-700 hover:underline">
                        {t('admin.retryNotif')}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ audit */

interface AuditEntry {
  id: string;
  action: string;
  actor_role: string | null;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
  ip: string | null;
}

export function AdminAudit() {
  const { t } = useI18n();
  const { data, error, reload } = useApi<{ entries: AuditEntry[] }>('/admin/audit?limit=100');

  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('admin.auditLog')}
        subtitle="Connexions, validations d’hôpitaux, changements de rôle et suppressions de compte."
        action={<DocIcon className="text-ink-300" />}
      />
      {!data ? (
        <div className="skeleton h-56" />
      ) : data.entries.length === 0 ? (
        <EmptyState title="Journal vide" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th className="px-5 pt-4">Date</th>
                <th className="pt-4">Action</th>
                <th className="pt-4">Acteur</th>
                <th className="pt-4">Cible</th>
                <th className="pt-4 pe-5">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 text-xs">{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                  <td>
                    <code className="text-[11px] font-semibold text-ink-700">{e.action}</code>
                  </td>
                  <td className="text-xs">{e.actor_role ?? 'anonyme'}</td>
                  <td className="text-xs text-ink-500">
                    {e.target_type ?? '—'}
                    {e.target_id ? <span className="ms-1 font-mono text-[10px]">{e.target_id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="pe-5 text-xs text-ink-400">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ services */

interface ServiceHealth {
  services: Array<{ name: string; status: string; latencyMs: number; uptimeSeconds?: number }>;
  checkedAt: string;
  totalMs: number;
  allUp: boolean;
}

export function AdminServices() {
  const { t } = useI18n();
  const { data, error, reload, loading } = useApi<ServiceHealth>('/dashboard/admin/services');

  if (error) return <ErrorBanner message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('nav.services')}
        subtitle="Vérification des endpoints /health de chaque microservice."
        action={
          <Button variant="secondary" loading={loading} onClick={() => void reload()}>
            <PulseIcon className="h-4 w-4" />
            {t('admin.healthCheck')}
          </Button>
        }
      />

      {!data ? (
        <div className="skeleton h-48" />
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${data.allUp ? 'bg-vital-50 text-vital-600' : 'bg-blood-50 text-blood-600'}`}>
                {data.allUp ? <CheckIcon /> : <CrossIcon />}
              </span>
              <div>
                <p className="font-semibold text-ink-800">
                  {data.services.filter((s) => s.status === 'UP').length}/{data.services.length} {t('admin.servicesUp')}
                </p>
                <p className="text-xs text-ink-500">Vérifié le {new Date(data.checkedAt).toLocaleString('fr-FR')}</p>
              </div>
            </div>
            <Badge tone={data.allUp ? 'green' : 'red'}>{data.totalMs} ms</Badge>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.services.map((s) => (
              <Card key={s.name} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-semibold text-ink-800">{s.name}</p>
                  <p className="text-[11px] text-ink-400">
                    {s.latencyMs} ms{s.uptimeSeconds ? ` · up ${Math.round(s.uptimeSeconds)} s` : ''}
                  </p>
                </div>
                <Badge tone={s.status === 'UP' ? 'green' : 'red'}>{s.status}</Badge>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
