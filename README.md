# SOS Sang

Plateforme de mise en relation entre hôpitaux en besoin urgent de sang et donneurs **compatibles, disponibles et proches**.

Trois rôles (donneur, personnel hospitalier, administrateur), sept microservices, un frontend React bilingue FR/AR (RTL), PostgreSQL, Redis, RabbitMQ, Socket.IO, Docker, Kubernetes et Helm.

---

## 1. Ce qui fonctionne réellement

Vérifié par exécution dans cet environnement (les résultats sont ceux des commandes données plus bas, pas des estimations) :

| Élément | État |
|---|---|
| 7 microservices + API gateway | Démarrés, `/health` OK sur les 8 composants |
| Flux urgence complet | `urgence.creee` → matching → alertes → réponse donneur → confirmation atomique → `besoin.couvert` → clôture → `don.effectue` |
| Mesure déclaration → première notification | **141 ms** (test automatisé, cible < 10 s) |
| Confirmations concurrentes | 4 réponses « J'arrive » pour 2 poches → exactement 2 `CONFIRMED`, urgence `COVERED` |
| Frontend React | Compilé (`vite build`) et servi en développement, 20 pages/écrans raccordés à l'API réelle |
| Tests automatisés | **31 tests passent** (24 unitaires + 7 de bout en bout) |
| Docker / Kubernetes / Helm / CI / monitoring | Fichiers fournis, **non exécutés ici** : aucun moteur Docker dans cet environnement |

### Fonctionnalités simulées (à signaler dans tout rapport)

- **Notifications e-mail et SMS** : transport simulé, journalisé `[SIMULE]`. Les notifications **web** sont réelles et persistées.
- **Profil d'exécution local** : bus d'événements en mémoire et cache mémoire quand `AMQP_URL`/`REDIS_URL` sont absents. Aucune durabilité, aucune distribution. Le profil Docker utilise RabbitMQ et Redis réels.
- **Base embarquée** : PGlite (PostgreSQL compilé en WASM) exposant le protocole Postgres, pour permettre l'exécution sans Docker. Le code SQL, les migrations et les schémas sont identiques à la cible PostgreSQL.
- **Carte** : schématique (projection SVG), sans fond de plan ni tuiles externes. Les coordonnées précises des donneurs ne sont jamais exposées.

---

## 2. Démarrage rapide (sans Docker)

Prérequis : Node.js 20+.

```bash
npm install
npm run build:shared
npm run dev            # API gateway : http://localhost:8080
npm run seed           # données de démonstration fictives
npm run dev:web        # frontend : http://localhost:5173
```

Première exécution : `npm run seed` crée l'administrateur, deux hôpitaux (un validé, un en attente), dix donneurs et trois urgences.

Base embarquée corrompue ou réinitialisation souhaitée :

```bash
EMBEDDED_RESET=true npm run dev
```

### Comptes de démonstration

Mot de passe commun : `Demo!Passw0rd`

| Rôle | Identifiant |
|---|---|
| Administrateur | `admin@sos-sang.local` |
| Hôpital validé | `hopital.central@sos-sang.local` |
| Hôpital en attente | `hopital.nord@sos-sang.local` |
| Donneurs | `donneur1@sos-sang.local` … `donneur10@sos-sang.local` |

> Un donneur ayant enregistré un don devient inéligible pendant 90 jours (règle configurable). Les tests choisissent donc dynamiquement des donneurs éligibles.

### Créer le premier administrateur sans secret en Git

Trois mécanismes, aucun identifiant codé en dur :

```bash
# 1. Ligne de commande (mot de passe aléatoire affiché une seule fois)
npm run create-admin -- vous@exemple.tn

# 2. Variables d'environnement au démarrage du service d'authentification
ADMIN_EMAIL=vous@exemple.tn ADMIN_INITIAL_PASSWORD='...' npm run dev

# 3. Endpoint interne protégé par x-internal-token (Docker/Kubernetes)
curl -X POST http://localhost:8080/api/internal/admin/bootstrap \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"email":"vous@exemple.tn"}'
```

L'endpoint interne n'est jamais proxifié par la gateway : il doit être appelé depuis le réseau interne.

---

## 3. Démarrage avec Docker Compose

```bash
cp .env.example .env
# renseigner JWT_SECRET et INTERNAL_API_TOKEN (voir les commandes openssl dans .env.example)
docker compose up --build
```

- Frontend : http://localhost:3000
- API : http://localhost:8080/api/health
- RabbitMQ management : http://localhost:15672

Créer l'administrateur et charger la démonstration :

```bash
docker compose exec auth-service npm run create-admin -- admin@sos-sang.local
docker compose exec gateway npx tsx scripts/seed.ts
```

Supervision :

```bash
docker compose -f docker-compose.yml -f infrastructure/monitoring/docker-compose.monitoring.yml up -d
# Prometheus :9090 · Grafana :3001 · Loki :3100
```

---

## 4. Tests

```bash
npm test                 # tests unitaires ; les tests E2E sont ignorés sans pile démarrée
SOS_E2E=1 npm test       # suite complète contre l'API sur localhost:8080
```

Résultat réel obtenu :

```
tests/api.e2e.test.ts   7 tests   OK   (dont [mesure] declaration -> notification : 141 ms)
tests/matching.test.ts  9 tests   OK
tests/eligibility.test.ts 9 tests OK
tests/blood.test.ts     6 tests   OK
Test Files  4 passed (4)      Tests  31 passed (31)
```

Les tests couvrent : compatibilité ABO/RhD complète (8×8), éligibilité configurable, classement et extension de rayon, permissions des trois rôles, déclaration d'urgence, délai de notification, confirmation sans doublon, diffusion `besoin.couvert`, clôture et enregistrement des dons, stocks, santé des services.

**Non mesuré ici** (outils absents) : couverture chiffrée, charge 500 urgences simultanées, p95 < 500 ms sous charge, scan Trivy, redémarrage de pod, mise à jour progressive.

---

## 5. Architecture

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour le diagramme Mermaid, le détail des événements, la fiabilité et les limites de la haute disponibilité.

```
sos-sang/
- frontend/            React + Vite + TypeScript + Tailwind, FR/AR avec RTL
- gateway/             point d'entrée unique, CORS, limitation de débit, proxy Socket.IO
- services/
  - auth-service/      4001  comptes, JWT, rôles, validation des hôpitaux, audit
  - donor-service/     4002  profils, disponibilité, éligibilité, réponses
  - hospital-service/  4003  profils, urgences, confirmations atomiques, temps réel
  - matching-service/  4004  sélection et classement des donneurs
  - notification-service/ 4005  e-mail/SMS/web, suivi de statut et de latence
  - stock-service/     4006  stocks par groupe et mouvements
  - dashboard-service/ 4007  read model, statistiques, santé des services
- packages/shared/     sang, éligibilité, géo, bus, base, auth, métriques, contrats d'événements
- infrastructure/
  - docker/             Dockerfiles multi-stage, nginx, env communs
  - helm/sos-sang/      chart paramétrable (profil local ou cible)
  - kubernetes/         manifests de référence (namespaces, probes, HPA, NetworkPolicies, Ingress)
  - argocd/             Application et AppProject GitOps
  - monitoring/         Prometheus, alertes, Grafana, Loki, Promtail
- tests/               suites Vitest (unitaires + bout en bout)
- docs/                architecture, API, scénario de démonstration
```

### Responsabilités et propriété des données

Chaque service possède son schéma PostgreSQL (`auth`, `donor`, `hospital`, `matching`, `notification`, `stock`, `dashboard`) et n'accède jamais à celui d'un autre. Les échanges passent par HTTP interne (jeton `x-internal-token`) ou par événements RabbitMQ.

| Service | Données possédées | Expose |
|---|---|---|
| auth | utilisateurs, journal d'audit | `/auth/*`, `/admin/users*`, `/admin/hospitals/*` |
| donor | donneurs, dons, réponses, règles | `/donors/me*`, `/internal/donors*` |
| hospital | hôpitaux, urgences, réponses de suivi | `/hospitals/me*`, `/internal/urgences/*` |
| matching | exécutions de matching | `/matching/runs*`, `/matching/config` |
| notification | notifications | `/notifications/me*`, `/admin/notifications*` |
| stock | stocks, mouvements | `/stock/*` |
| dashboard | journal d'événements (read model) | `/dashboard/*` |

---

## 6. Variables d'environnement

| Variable | Rôle | Défaut développement |
|---|---|---|
| `JWT_SECRET` | signature des jetons | secret de dev, **à remplacer** |
| `INTERNAL_API_TOKEN` | appels inter-services | jeton de dev, **à remplacer** |
| `DATABASE_URL` | connexion PostgreSQL | base PGlite embarquée |
| `<SERVICE>_DB_SCHEMA` | schéma possédé par le service | `auth`, `donor`, … |
| `REDIS_URL` / `AMQP_URL` | cache et broker | vides → mémoire |
| `CORS_ORIGINS` | origines autorisées | `http://localhost:5173,http://localhost:8080` |
| `ELIGIBILITY_MIN_INTERVAL_DAYS` et suivantes | règle d'éligibilité | 90 / 18 / 65 / 50 |
| `MATCHING_RADII_KM`, `MATCHING_MAX_ALERTS` | extension de rayon | `25,50,100,200`, 50 |
| `NOTIFICATION_EMAIL_MODE` / `NOTIFICATION_SMS_MODE` | `simulated` ou `fail` | `simulated` |
| `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_REGISTER_MAX` | limites des routes sensibles | 10 / 20 |
| `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` | amorçage administrateur | vides |

Les secrets ne sont jamais versionnés : `.env` est ignoré par Git, `.env.example` ne contient que des valeurs factices.

---

## 7. Sécurité mise en œuvre

- Mots de passe : bcrypt (coût 12), politique de complexité côté serveur.
- JWT signés, émetteur `sos-sang`, expiration 12 h, vérification à chaque requête.
- RBAC : `DONOR`, `HOSPITAL`, `ADMIN` ; ressources hospitalières filtrées par `hospital_id`.
- Validation zod de toutes les entrées, requêtes SQL entièrement paramétrées.
- CORS explicite, en-têtes internes supprimés à la gateway, limitation de débit (connexion, inscription, global).
- Verrou `FOR UPDATE` + mises à jour conditionnelles : aucune double confirmation.
- Journal d'audit des actions sensibles, jetons et mots de passe exclus des logs (redaction pino).
- Minimisation : position arrondie, jamais exposée publiquement, effacée au retrait du consentement ; suppression de compte avec anonymisation.

---

## 8. Limites connues

1. **Haute disponibilité** : sur Minikube/Kind mono-nœud, deux réplicas protègent d'une panne de pod, pas d'une panne matérielle. Une vraie HA exige plusieurs nœuds, un stockage répliqué et un PostgreSQL en cluster.
2. **Une seule instance PostgreSQL** en Docker Compose : séparation logique par schéma, pas physique. En production, une instance (ou un cluster) par service.
3. **Profil embarqué** : bus et cache en mémoire, une seule session PostgreSQL sérialisée (`SINGLE_SESSION_DB=true`) — adapté au développement, pas à la charge.
4. **Notifications e-mail/SMS simulées** : aucune passerelle réelle n'est branchée.
5. **Carte** : projection schématique, sans fournisseur de tuiles.

---

## 9. Documentation

- [Architecture et diagramme](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Scénario de démonstration](docs/DEMO.md)
