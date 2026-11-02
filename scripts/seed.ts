/**
 * Jeu de donnees de DEMONSTRATION (100% fictif).
 * A executer pendant que la pile tourne: `npm run seed`.
 *
 * Comptes crees (mot de passe commun, fictif): Demo!Passw0rd
 *   admin@sos-sang.local              (ADMIN)
 *   hopital.central@sos-sang.local    (HOSPITAL, valide)
 *   hopital.nord@sos-sang.local       (HOSPITAL, en attente de validation)
 *   donneur1..10@sos-sang.local       (DONOR)
 */
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const AUTH_DIRECT = process.env.AUTH_SERVICE_URL ?? 'http://localhost:4001';
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-change-me';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo!Passw0rd';
const adminEmail = 'admin@sos-sang.local';

type Json = Record<string, unknown>;

async function api(
  endpoint: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; data: Json }> {
  const response = await fetch(`${GATEWAY}${endpoint}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data: Json = {};
  try {
    data = text ? (JSON.parse(text) as Json) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

const HOSPITALS = [
  {
    email: 'hopital.central@sos-sang.local',
    hospitalName: 'Hopital Central de Tunis',
    contactName: 'Dr Amine Ben Salah',
    phone: '+216 71 000 111',
    city: 'Tunis',
    address: '12 avenue de la Republique, Tunis',
    lat: 36.8065,
    lng: 10.1815,
  },
  {
    email: 'hopital.nord@sos-sang.local',
    hospitalName: 'Clinique du Nord',
    contactName: 'Dr Salma Trabelsi',
    phone: '+216 71 000 222',
    city: 'La Marsa',
    address: '4 rue des Oliviers, La Marsa',
    lat: 36.8782,
    lng: 10.3247,
  },
];

// Coordonnees fictives autour de Tunis.
const DONORS = [
  { firstName: 'Yassine', lastName: 'Mansour', bloodGroup: 'O-', city: 'Ariana', lat: 36.8625, lng: 10.1956 },
  { firstName: 'Ines', lastName: 'Gharbi', bloodGroup: 'O-', city: 'Ben Arous', lat: 36.7531, lng: 10.2289 },
  { firstName: 'Mehdi', lastName: 'Khelifi', bloodGroup: 'O-', city: 'La Goulette', lat: 36.8181, lng: 10.3053 },
  { firstName: 'Sarra', lastName: 'Bouzid', bloodGroup: 'O+', city: 'Le Bardo', lat: 36.8093, lng: 10.1407 },
  { firstName: 'Karim', lastName: 'Jebali', bloodGroup: 'A+', city: 'Carthage', lat: 36.8528, lng: 10.3233 },
  { firstName: 'Nour', lastName: 'Ayari', bloodGroup: 'A-', city: 'Manouba', lat: 36.8081, lng: 10.0858 },
  { firstName: 'Samir', lastName: 'Ferchichi', bloodGroup: 'B+', city: 'Megrine', lat: 36.7692, lng: 10.2322 },
  { firstName: 'Leila', lastName: 'Haddad', bloodGroup: 'B-', city: 'Sidi Bou Said', lat: 36.8708, lng: 10.3417 },
  { firstName: 'Anis', lastName: 'Riahi', bloodGroup: 'AB+', city: 'Tunis', lat: 36.799, lng: 10.17 },
  { firstName: 'Rania', lastName: 'Chaabane', bloodGroup: 'O-', city: 'Ariana', lat: 36.8502, lng: 10.2105 },
];

async function main(): Promise<void> {
  // --- Administrateur : via l'API interne du service d'authentification.
  // Aucun acces direct a la base depuis le script: le service reste seul ecrivain.
  const bootstrap = await fetch(`${AUTH_DIRECT}/api/internal/admin/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
    body: JSON.stringify({ email: adminEmail, password: PASSWORD }),
  });
  if (!bootstrap.ok) {
    throw new Error(`Amorcage administrateur impossible: HTTP ${bootstrap.status} ${await bootstrap.text()}`);
  }

  const adminLogin = await api('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: PASSWORD } });
  if (adminLogin.status !== 200) throw new Error(`Connexion admin impossible: ${JSON.stringify(adminLogin.data)}`);
  const adminToken = (adminLogin.data as { token: string }).token;

  // --- Hopitaux
  const hospitalTokens: Record<string, string> = {};
  const hospitalIds: string[] = [];
  for (const hospital of HOSPITALS) {
    const created = await api('/api/auth/register/hospital', {
      method: 'POST',
      body: { ...hospital, password: PASSWORD },
    });
    if (created.status === 201) {
      const user = (created.data as { user: { id: string } }).user;
      hospitalIds.push(user.id);
      hospitalTokens[hospital.email] = (created.data as { token: string }).token;
    } else if (created.status === 409) {
      const login = await api('/api/auth/login', { method: 'POST', body: { email: hospital.email, password: PASSWORD } });
      if (login.status === 200) {
        hospitalTokens[hospital.email] = (login.data as { token: string }).token;
        hospitalIds.push((login.data as { user: { id: string } }).user.id);
      } else {
        console.log(`  ! hopital ${hospital.email}: connexion impossible (${login.data.error && (login.data.error as Json).code})`);
      }
    } else {
      console.log(`  ! hopital ${hospital.email}: ${JSON.stringify(created.data)}`);
    }
  }

  // Validation du premier hopital par l'administrateur (le second reste en attente).
  if (hospitalIds[0]) {
    const approval = await api(`/api/admin/hospitals/${hospitalIds[0]}/approve`, {
      method: 'PATCH',
      token: adminToken,
    });
    if (approval.status !== 200) console.log('  ! validation hopital:', JSON.stringify(approval.data));
  }

  // --- Donneurs
  const donorIds: { id: string; email: string; bloodGroup: string }[] = [];
  let index = 0;
  for (const donor of DONORS) {
    index += 1;
    const email = `donneur${index}@sos-sang.local`;
    const payload = {
      email,
      password: PASSWORD,
      firstName: donor.firstName,
      lastName: donor.lastName,
      phone: `+216 20 00 00 ${String(index).padStart(2, '0')}`,
      city: donor.city,
      bloodGroup: donor.bloodGroup,
      lat: donor.lat,
      lng: donor.lng,
      locationConsent: true,
      notificationsConsent: true,
      birthDate: `199${index % 9}-0${(index % 9) + 1}-15`,
      weightKg: 68 + (index % 15),
    };
    // Re-execution : on reutilise le compte existant au lieu de consommer le quota d'inscription.
    const existing = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    if (existing.status === 200) {
      donorIds.push({
        id: (existing.data as { user: { id: string } }).user.id,
        email,
        bloodGroup: donor.bloodGroup,
      });
      continue;
    }

    const created = await api('/api/auth/register/donor', { method: 'POST', body: payload });
    if (created.status === 201) {
      donorIds.push({ id: (created.data as { user: { id: string } }).user.id, email, bloodGroup: donor.bloodGroup });
    } else if (created.status === 409) {
      const login = await api('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
      if (login.status === 200) {
        donorIds.push({
          id: (login.data as { user: { id: string } }).user.id,
          email,
          bloodGroup: donor.bloodGroup,
        });
      }
    } else {
      console.log(`  ! donneur ${email}: ${JSON.stringify(created.data)}`);
    }
  }

  const centralEmail = HOSPITALS[0].email;
  const centralToken = hospitalTokens[centralEmail];
  if (!centralToken) {
    console.log('Hopital central indisponible: arret du seed.');
    return;
  }

  // --- Stocks du premier hopital
  const stock: [string, number][] = [
    ['O-', 2],
    ['O+', 8],
    ['A+', 6],
    ['A-', 1],
    ['B+', 4],
    ['B-', 2],
    ['AB+', 3],
    ['AB-', 1],
  ];
  for (const [group, units] of stock) {
    await api(`/api/stock/me/${encodeURIComponent(group)}`, {
      method: 'PUT',
      token: centralToken,
      body: { units, threshold: 3 },
    });
  }

  // --- Urgence O- (couvert par 2 donneurs) : declenche matching + notifications
  const urgency = await api('/api/hospitals/me/urgences', {
    method: 'POST',
    token: centralToken,
    body: {
      bloodGroup: 'O-',
      bagsNeeded: 2,
      priority: 'CRITICAL',
      deadlineAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      notes: 'Bloc operatoire: hemorragie post-partum. Scenario de demonstration.',
    },
  });
  let urgenceId: string | null = null;
  if (urgency.status === 201) {
    urgenceId = (urgency.data as { urgence: { id: string } }).urgence.id;
    console.log(`  Urgence O- creee: ${urgenceId}`);
  } else {
    console.log('  ! creation urgence:', JSON.stringify(urgency.data));
  }

  // --- Reponses de 2 donneurs O- (confirmation atomique, besoin couvert)
  if (urgenceId) {
    const oMinus = donorIds.filter((donor) => donor.bloodGroup === 'O-').slice(0, 3);
    for (const donor of oMinus) {
      const login = await api('/api/auth/login', { method: 'POST', body: { email: donor.email, password: PASSWORD } });
      if (login.status !== 200) continue;
      const token = (login.data as { token: string }).token;
      const response = await api('/api/donors/me/responses', {
        method: 'POST',
        token,
        body: { urgenceId, answer: 'COMING' },
      });
      console.log(`  Reponse ${donor.email}: ${response.status}`);
    }
  }

  // --- Deuxieme urgence, laissee ouverte (A+)
  const openUrgence = await api('/api/hospitals/me/urgences', {
    method: 'POST',
    token: centralToken,
    body: {
      bloodGroup: 'A+',
      bagsNeeded: 3,
      priority: 'HIGH',
      deadlineAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      notes: 'Chirurgie programmee. Scenario de demonstration.',
    },
  });
  if (openUrgence.status !== 201) console.log('  ! urgence A+:', JSON.stringify(openUrgence.data));

  console.log(
    [
      '',
      'Donnees de demonstration pretes.',
      `  Admin     : ${adminEmail} / ${PASSWORD}`,
      `  Hopital   : ${HOSPITALS[0].email} / ${PASSWORD}  (valide)`,
      `  Hopital   : ${HOSPITALS[1].email} / ${PASSWORD}  (en attente)`,
      `  Donneurs  : donneur1..${DONORS.length}@sos-sang.local / ${PASSWORD}`,
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed:', err);
  process.exit(1);
});
