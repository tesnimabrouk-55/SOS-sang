# API — SOS Sang

Toutes les routes publiques passent par la gateway : `http://localhost:8080/api/...`.
Les routes `/internal/...` ne sont **jamais** exposées par la gateway ; elles exigent l'en-tête `x-internal-token` et ne sont accessibles que depuis le réseau interne.

Authentification : `Authorization: Bearer <jwt>`.
Format d'erreur : `{ "error": { "code": "CODE", "message": "...", "details": ... } }`.

## Authentification

| Méthode | Route | Rôle | Corps / effet |
|---|---|---|---|
| POST | `/auth/register/donor` | public | `email, password, firstName, lastName, phone, city, bloodGroup, birthDate?, weightKg?, locationConsent?, notificationsConsent?, lat?, lng?` → `201 {token, user}` |
| POST | `/auth/register/hospital` | public | `hospitalName, contactName, email, phone, city, address, password` → compte `PENDING` |
| POST | `/auth/login` | public | `{email, password}` → `{token, user}` · 403 `HOSPITAL_PENDING`, 429 `RATE_LIMITED` |
| GET | `/auth/me` | authentifié | profil du compte |
| POST | `/auth/logout` | authentifié | invalide la session côté client |
| POST | `/auth/password` | authentifié | changement de mot de passe |
| DELETE | `/auth/me` | authentifié | suppression du compte (anonymisation) |

## Donneurs

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/donors/me` | DONOR | profil + éligibilité calculée |
| PATCH | `/donors/me` | DONOR | mise à jour (nom, téléphone, ville, groupe, dates, poids, consentements) |
| POST | `/donors/me/availability` | DONOR | `{isAvailable: boolean}` |
| POST | `/donors/me/location` | DONOR | `{lat, lng, consent: true}` — coordonnées arrondies |
| GET | `/donors/me/eligibility` | DONOR | éligibilité + règle appliquée |
| GET | `/donors/me/history` | DONOR | `{donations, responses}` |
| GET | `/donors/me/compatible-urgences` | DONOR | urgences compatibles triées par distance |
| POST | `/donors/me/responses` | DONOR | `{urgenceId, answer: "COMING" \| "CANNOT"}` → publie `reponse.recue` |
| GET | `/donors/rules` | ADMIN | règle d'éligibilité courante |
| PUT | `/donors/rules` | ADMIN | nouvelle règle (versionnée) |

## Hôpitaux et urgences

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/hospitals/me` | HOSPITAL | profil de l'établissement |
| PATCH | `/hospitals/me` | HOSPITAL | mise à jour du profil |
| GET | `/hospitals/me/dashboard` | HOSPITAL | `{hospital, counts, latest}` |
| GET | `/hospitals/me/urgences` | HOSPITAL | liste avec compteurs par statut de réponse |
| POST | `/hospitals/me/urgences` | HOSPITAL | `{bloodGroup, bagsNeeded, priority, deadlineAt, city?, notes?, lat?, lng?, contactPhone?}` → `201` puis `urgence.creee` |
| GET | `/hospitals/me/urgences/:id` | HOSPITAL | détail + réponses (identifiants donneurs, distances, rangs) |
| POST | `/hospitals/me/urgences/:id/close` | HOSPITAL | `{donations:[{donorId, bags}]}` → `don.effectue` + `urgence.cloturee` |
| POST | `/hospitals/me/urgences/:id/cancel` | HOSPITAL | annulation → `urgence.cloturee` (statut `CANCELLED`) |
| GET | `/hospitals/me/stats` | HOSPITAL | répartition par statut, groupe, réponses ; délai moyen de couverture |

## Notifications

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/notifications/me` | DONOR | notifications (canal, statut, latence, tentative) |
| POST | `/notifications/me/:id/read` | DONOR | marque comme lue |
| POST | `/notifications/me/read-all` | DONOR | marque tout comme lu |
| GET | `/admin/notifications` | ADMIN | supervision, filtres |
| GET | `/admin/notifications/stats` | ADMIN | volumes par canal/statut, latence moyenne, max, p95 |
| POST | `/admin/notifications/:id/retry` | ADMIN | nouvelle tentative d'envoi |

## Stocks

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/stock/me` | HOSPITAL | stocks des 8 groupes + seuils + alerte `low` |
| PUT | `/stock/me/:bloodGroup` | HOSPITAL | `{units, threshold?}` |
| POST | `/stock/me/:bloodGroup/adjust` | HOSPITAL | `{delta, reason?}` (borné à ≥ 0, mouvement journalisé) |
| GET | `/stock/me/history` | HOSPITAL | mouvements récents |

## Tableau de bord

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/dashboard/public` | public | agrégats réels + jeu de démonstration identifié |
| GET | `/dashboard/admin/overview` | ADMIN | utilisateurs, urgences par priorité, série 14 jours, derniers événements |
| GET | `/dashboard/admin/urgences` | ADMIN | urgences reconstruites depuis les événements (statut, poches, dernier événement) |
| GET | `/dashboard/admin/events` | ADMIN | journal d'événements paginé |
| GET | `/dashboard/admin/services` | ADMIN | `/health` de chaque service, latence, disponibilité |
| GET | `/api/health` (gateway) | public | agrégat de santé |

## Administration

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/admin/users?role=` | ADMIN | liste des comptes |
| PATCH | `/admin/users/:id/role` | ADMIN | `{role}` |
| POST | `/admin/users/:id/suspend` | ADMIN | suspension (impossible sur soi-même) |
| POST | `/admin/hospitals/:id/approve` | ADMIN | validation + synchronisation `hospital-service` |
| POST | `/admin/hospitals/:id/reject` | ADMIN | refus motivé |
| GET | `/admin/audit?limit=` | ADMIN | journal d'audit |
| GET | `/admin/stats` | ADMIN | répartition des comptes |

## Matching (supervision)

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| GET | `/matching/runs` | ADMIN | exécutions récentes |
| GET | `/matching/runs/:urgenceId` | ADMIN | détail d'une sélection |
| GET | `/matching/config` | ADMIN | rayons et limites actifs |

## Temps réel

Socket.IO sur `/socket.io`, authentification par `auth.token` (JWT). Rooms : `hospital:<id>` (personnel) et `admins`.

| Événement | Charge utile |
|---|---|
| `urgence:update` | `{type, urgenceId, contacted, radiusKm}` |
| `urgence:response` | `{type, urgenceId, donorId, answer, confirmed, urgence}` |

## Codes d'erreur usuels

| Code | HTTP | Signification |
|---|---|---|
| `UNAUTHENTICATED` | 401 | jeton absent, expiré ou invalide |
| `FORBIDDEN` | 403 | rôle insuffisant |
| `HOSPITAL_PENDING` | 403 | établissement non validé |
| `ACCOUNT_REJECTED` | 403 | compte refusé ou suspendu |
| `VALIDATION_ERROR` | 400 | corps de requête invalide |
| `EMAIL_TAKEN` | 409 | adresse déjà utilisée |
| `ALREADY_CLOSED` | 409 | urgence déjà clôturée |
| `RATE_LIMITED` | 429 | limite de débit atteinte |
| `UPSTREAM_UNAVAILABLE` | 503 | service amont indisponible |
