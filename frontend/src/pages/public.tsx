import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, RBC_TABLE, BLOOD_GROUPS } from '../lib/api';
import { useI18n } from '../lib/i18n';
import {
  ArrowIcon,
  Badge,
  BellIcon,
  BloodTag,
  Button,
  Card,
  CheckIcon,
  ClockIcon,
  DropIcon,
  Field,
  HeartIcon,
  Input,
  PinIcon,
  ShieldIcon,
  Textarea,
  useToast,
  UsersIcon,
} from '../components/ui';

/* ------------------------------------------------------------------ accueil */

interface PublicStats {
  live: { urgencesDeclared: number; bagsCollected: number; donorsMobilized: number; hospitalsEngaged: number; avgMobilisationSeconds: number };
  demo: { donorsRegistered: number; hospitalsConnected: number; livesSupported: number; averageResponseMinutes: number; label: string };
}

export function HomePage() {
  const { t, formatNumber } = useI18n();
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    api
      .get<PublicStats>('/dashboard/public')
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const steps = [
    { icon: <DropIcon />, title: t('home.step1Title'), text: t('home.step1Text') },
    { icon: <PinIcon />, title: t('home.step2Title'), text: t('home.step2Text') },
    { icon: <BellIcon />, title: t('home.step3Title'), text: t('home.step3Text') },
    { icon: <CheckIcon />, title: t('home.step4Title'), text: t('home.step4Text') },
  ];

  return (
    <div>
      {/* Hero */}
      <section className="hero-glow relative overflow-hidden border-b border-ink-200/70 bg-white">
        <div className="pointer-events-none absolute inset-0 grid-lines opacity-60" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
          <div className="animate-fade-up">
            <span className="badge bg-blood-50 text-blood-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-blood-500" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blood-600" />
              </span>
              {t('home.eyebrow')}
            </span>
            <h1 className="mt-5 text-3xl font-extrabold leading-[1.1] tracking-tight text-ink-900 sm:text-4xl lg:text-[2.9rem]">
              {t('home.title')}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-600">{t('home.subtitle')}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/inscription" className="btn-primary px-5 py-3 text-base">
                {t('home.ctaDonor')}
                <ArrowIcon className="h-4 w-4 rtl:rotate-180" />
              </Link>
              <Link to="/inscription?role=hospital" className="btn-secondary px-5 py-3 text-base">
                {t('home.ctaHospital')}
              </Link>
            </div>
            <ul className="mt-8 grid gap-2.5 text-sm text-ink-600 sm:grid-cols-2">
              {[t('home.trust1'), t('home.trust2'), t('home.trust3'), t('home.trust4')].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-vital-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative animate-fade-up lg:pl-6">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/70 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-blood-500" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-blood-600" />
                  </span>
                  {t('hospital.realtime')}
                </div>
                <Badge tone="red">O−</Badge>
              </div>
              <div className="space-y-4 p-4">
                <div className="rounded-xl border border-blood-100 bg-blood-50/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blood-700">Urgence critique</p>
                  <p className="mt-1 text-sm font-semibold text-ink-800">Hôpital Central de Tunis · 2 poches O−</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
                    <ClockIcon className="h-3.5 w-3.5" />
                    Échéance 3 h · 4 donneurs en route
                  </div>
                </div>
                {[
                  { name: 'Yassine M.', dist: '6,3 km', status: 'Confirmé', tone: 'green' as const },
                  { name: 'Ines B.', dist: '7,3 km', status: 'En route', tone: 'amber' as const },
                  { name: 'Karim T.', dist: '11,1 km', status: 'Contacté', tone: 'neutral' as const },
                ].map((d) => (
                  <div key={d.name} className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-500">
                        {d.name.slice(0, 1)}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-ink-800">{d.name}</p>
                        <p className="text-[11px] text-ink-400">{d.dist}</p>
                      </div>
                    </div>
                    <Badge tone={d.tone}>{d.status}</Badge>
                  </div>
                ))}
                <p className="text-center text-[11px] text-ink-400">Aperçu illustratif du tableau de bord hospitalier.</p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Statistiques */}
      <section className="border-b border-ink-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={t('home.statUrgences')} value={stats ? formatNumber(stats.live.urgencesDeclared) : '—'} icon={<Pulse />} />
            <StatBlock label={t('home.statDonors')} value={stats ? formatNumber(stats.live.donorsMobilized) : '—'} icon={<UsersIcon />} />
            <StatBlock label={t('home.statHospitals')} value={stats ? formatNumber(stats.live.hospitalsEngaged) : '—'} icon={<Building />} />
            <StatBlock
              label={t('home.statDelay')}
              value={stats ? (stats.live.avgMobilisationSeconds > 0 ? `${stats.live.avgMobilisationSeconds} s` : '< 10 s') : '—'}
              icon={<ClockIcon />}
            />
          </div>
          <p className="mt-3 text-center text-xs text-ink-400">
            Chiffres calculés sur les données réelles de cette instance. {t('home.demoNote')}
          </p>
          {stats ? (
            <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-ink-200 bg-ink-50/60 p-4 text-sm sm:grid-cols-4">
              <DemoStat label="Donneurs inscrits" value={formatNumber(stats.demo.donorsRegistered)} />
              <DemoStat label="Hôpitaux connectés" value={formatNumber(stats.demo.hospitalsConnected)} />
              <DemoStat label="Vies accompagnées" value={formatNumber(stats.demo.livesSupported)} />
              <DemoStat label="Réponse moyenne" value={`${stats.demo.averageResponseMinutes} min`} />
              <p className="text-[11px] uppercase tracking-wide text-ink-400 sm:col-span-4">
                {stats.demo.label} — jeu fictif de démonstration
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* Fonctionnement */}
      <section className="bg-ink-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{t('home.howTitle')}</h2>
            <p className="mt-2 text-ink-600">{t('home.howSubtitle')}</p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <Card key={s.title} className="relative p-5">
                <span className="absolute end-4 top-4 text-3xl font-black text-ink-100">{i + 1}</span>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blood-50 text-blood-600">{s.icon}</span>
                <h3 className="mt-3 font-semibold text-ink-800">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{s.text}</p>
              </Card>
            ))}
          </div>
          <div className="mt-6">
            <Link to="/fonctionnement" className="link text-sm">
              Voir le détail du parcours technique →
            </Link>
          </div>
        </div>
      </section>

      {/* Groupes sanguins */}
      <section className="border-y border-ink-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{t('home.groupsTitle')}</h2>
              <p className="mt-2 text-ink-600">{t('home.groupsSubtitle')}</p>
            </div>
            <Link to="/groupes-sanguins" className="btn-secondary">
              {t('nav.groups')}
              <ArrowIcon className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {BLOOD_GROUPS.map((g) => (
              <div key={g} className="rounded-xl border border-ink-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <BloodTag group={g} size="lg" />
                  {g === 'O-' ? <Badge tone="red">{t('groups.universalDonor')}</Badge> : null}
                  {g === 'AB+' ? <Badge tone="slate">{t('groups.universalRecipient')}</Badge> : null}
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-400">{t('groups.donorCanGive')}</p>
                <p className="mt-1 text-sm text-ink-700">{RBC_TABLE[g].join(' · ')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="overflow-hidden rounded-2xl bg-ink-900 px-6 py-10 text-center sm:px-10">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blood-600 text-white">
              <HeartIcon />
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('home.finalTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-white/70">{t('home.finalText')}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/inscription" className="btn bg-white px-5 py-3 text-base text-ink-900 hover:bg-ink-100">
                {t('home.ctaDonor')}
              </Link>
              <Link to="/connexion" className="btn border border-white/25 px-5 py-3 text-base text-white hover:bg-white/10">
                {t('nav.login')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Pulse() {
  return <span className="text-ink-300"><HeartIcon /></span>;
}
function Building() {
  return <span className="text-ink-300"><ShieldIcon /></span>;
}

function StatBlock({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
        <span className="text-ink-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      </div>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink-900">{value}</p>
    </div>
  );
}

function DemoStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-ink-700">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ fonctionnement */

export function HowItWorksPage() {
  const { t } = useI18n();
  const flow = [
    {
      title: '1. Déclaration de l’urgence',
      text: 'Le personnel hospitalier saisit le groupe requis, le nombre de poches, la priorité, l’échéance et la localisation. Le serveur valide chaque champ et vérifie que l’établissement est approuvé.',
      tag: 'POST /api/hospitals/me/urgences',
    },
    {
      title: '2. Publication de l’événement',
      text: 'La demande est enregistrée puis un événement `urgence.creee` est publié via une boîte d’envoi transactionnelle : aucun événement n’est perdu si le broker est momentanément indisponible.',
      tag: 'urgence.creee',
    },
    {
      title: '3. Sélection des donneurs',
      text: 'Le service de matching filtre par compatibilité des globules rouges, disponibilité, consentement et éligibilité, puis trie par distance croissante et fiabilité documentée (dons, réactivité).',
      tag: 'donneurs.selectionnes',
    },
    {
      title: '4. Alertes et réponses',
      text: 'Chaque notification est persistée par canal (e-mail, SMS simulé, web) avec son statut et sa latence. Le donneur répond « J’arrive » ou « Je ne peux pas » depuis son espace.',
      tag: 'reponse.recue',
    },
    {
      title: '5. Confirmation atomique',
      text: 'Seul le nombre de poches nécessaires est confirmé. Un verrou de ligne et une mise à jour conditionnelle empêchent deux donneurs d’obtenir la même place, même en concurrence.',
      tag: 'besoin.couvert',
    },
    {
      title: '6. Clôture et dons réels',
      text: 'L’hôpital clôture l’urgence et enregistre les dons effectivement réalisés. L’historique du donneur et les statistiques sont mis à jour.',
      tag: 'don.effectue',
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{t('how.title')}</h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('how.intro')}</p>

      <div className="mt-8 space-y-3">
        {flow.map((step, i) => (
          <Card key={step.title} className="flex gap-4 p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blood-600 text-sm font-bold text-white">{i + 1}</span>
            <div>
              <h2 className="font-semibold text-ink-800">{step.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">{step.text}</p>
              <code className="mt-2 inline-block rounded-md bg-ink-100 px-2 py-1 text-[11px] font-semibold text-ink-600">{step.tag}</code>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6 border-blood-200 bg-blood-50/50 p-5">
        <h2 className="font-semibold text-blood-800">Éligibilité, compatibilité, validation clinique : trois notions distinctes</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-blood-900/80">
          <li>· <strong>Compatibilité</strong> : matrice ABO/RhD des globules rouges, déterministe et testée.</li>
          <li>· <strong>Éligibilité</strong> : règle configurable (délai entre dons, âge, poids) — indicative seulement.</li>
          <li>· <strong>Validation clinique</strong> : réservée au centre de transfusion, jamais automatisée ici.</li>
        </ul>
      </Card>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/inscription" className="btn-primary">{t('nav.becomeDonor')}</Link>
        <Link to="/groupes-sanguins" className="btn-secondary">{t('nav.groups')}</Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ groupes sanguins */

export function BloodGroupsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{t('groups.title')}</h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('groups.intro')}</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {BLOOD_GROUPS.map((g) => {
          const receivers = RBC_TABLE[g];
          const donors = BLOOD_GROUPS.filter((d) => RBC_TABLE[d].includes(g));
          return (
            <Card key={g} className="p-5">
              <div className="flex items-center gap-3">
                <BloodTag group={g} size="lg" />
                <div>
                  <p className="font-semibold text-ink-800">Groupe {g}</p>
                  <p className="text-xs text-ink-500">
                    {g === 'O-' ? t('groups.universalDonor') : g === 'AB+' ? t('groups.universalRecipient') : 'Compatible selon la matrice GR'}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t('groups.donorCanGive')}</p>
                  <p className="text-ink-700">{receivers.join(' · ')}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t('groups.receiveFrom')}</p>
                  <p className="text-ink-700">{donors.join(' · ')}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-5 text-sm text-ink-600">
        <p className="font-semibold text-ink-800">Périmètre de cette matrice</p>
        <p className="mt-1">
          Elle concerne uniquement les <strong>globules rouges</strong>. La compatibilité plasma et plaquettes suit d’autres règles.
          Elle ne préjuge ni de l’éligibilité médicale d’un donneur ni de la décision clinique du centre de transfusion.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ contact */

export function ContactPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', subject: 'don', message: '' });

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_.8fr]">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{t('contact.title')}</h1>
        <p className="mt-3 text-ink-600">{t('contact.intro')}</p>

        <Card className="mt-6 p-5">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
              push('success', t('contact.sent'));
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom">
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('auth.email')}>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            </div>
            <Field label="Sujet">
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
            <Field label={t('contact.message')}>
              <Textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </Field>
            <Button type="submit">{t('contact.send')}</Button>
            {sent ? <p className="text-xs text-ink-500">{t('contact.sent')}</p> : null}
          </form>
        </Card>
      </div>

      <div className="space-y-3">
        <Card className="p-5">
          <h2 className="font-semibold text-ink-800">Urgence médicale</h2>
          <p className="mt-1 text-sm text-ink-600">
            SOS Sang n’est pas un service d’urgence. En cas de danger immédiat, contactez les secours de votre pays.
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-ink-800">Hôpitaux</h2>
          <p className="mt-1 text-sm text-ink-600">
            Créez un compte établissement : l’accès est ouvert après validation par un administrateur de la plateforme.
          </p>
          <Link to="/inscription?role=hospital" className="link mt-2 inline-block text-sm">
            Inscrire mon hôpital →
          </Link>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-ink-800">Données personnelles</h2>
          <p className="mt-1 text-sm text-ink-600">Consultez la page confidentialité pour vos droits d’accès, de rectification et de suppression.</p>
          <Link to="/confidentialite" className="link mt-2 inline-block text-sm">
            {t('nav.privacy')} →
          </Link>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ confidentialite */

export function PrivacyPage() {
  const { t } = useI18n();
  const sections = [
    {
      title: 'Données collectées',
      body: 'Donneurs : nom, prénom, e-mail, téléphone, ville, groupe sanguin, date de naissance et poids (facultatifs), date du dernier don, préférences de disponibilité et consentements. Hôpitaux : nom de l’établissement, contact, adresse et localisation. Aucune donnée de santé détaillée n’est demandée.',
    },
    {
      title: 'Localisation',
      body: 'La position n’est enregistrée qu’après consentement explicite. Elle sert à calculer une distance et à trier les alertes. Elle n’est jamais affichée publiquement et le consentement peut être retiré à tout moment, ce qui efface les coordonnées.',
    },
    {
      title: 'Finalité et base légale',
      body: 'Mise en relation entre un besoin hospitalier et des donneurs compatibles. Les alertes ne sont envoyées qu’aux donneurs ayant consenti aux notifications et dont le groupe est compatible.',
    },
    {
      title: 'Minimisation et sécurité',
      body: 'Mots de passe hachés avec bcrypt, jetons JWT signés et expirants, contrôle d’accès par rôle, validation serveur, requêtes paramétrées, limitation de débit sur les routes sensibles, journal d’audit des actions critiques.',
    },
    {
      title: 'Durée de conservation',
      body: 'Les données de compte sont conservées tant que le compte est actif. Une demande de suppression anonymise le compte : l’identité est effacée, les coordonnées sont supprimées, les statistiques agrégées restent anonymes.',
    },
    {
      title: 'Vos droits',
      body: 'Accès, rectification, retrait du consentement et suppression sont disponibles depuis l’espace donneur ou sur demande. Aucune donnée n’est revendue ni transmise à un tiers commercial.',
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{t('privacy.title')}</h1>
      <p className="mt-3 text-ink-600">{t('privacy.intro')}</p>
      <div className="mt-8 space-y-4">
        {sections.map((s) => (
          <Card key={s.title} className="p-5">
            <h2 className="font-semibold text-ink-800">{s.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.body}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-ink-400">
        Ce texte décrit le comportement effectif de l’application de démonstration. Il ne constitue pas un avis juridique.
      </p>
    </div>
  );
}
