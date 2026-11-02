# Scénario de démonstration — SOS Sang

Durée : 10 à 15 minutes. Toutes les données sont fictives.

## Préparation

```bash
npm install
npm run build:shared
npm run dev        # terminal 1 — API gateway sur :8080
npm run seed       # données de démonstration
npm run dev:web    # terminal 2 — interface sur :5173
```

Ouvrir http://localhost:5173.

## 1. Page publique (2 min)

1. Accueil : message, parcours en quatre étapes, chiffres **réels** de l'instance et bloc « données de démonstration » clairement étiqueté.
2. Basculer la langue en **العربية** (bouton FR/AR) : la mise en page passe en RTL, la navigation et les libellés sont traduits.
3. Page « Groupes sanguins » : matrice GR, avec la mention explicite que plasma et plaquettes ne suivent pas les mêmes règles.

## 2. Espace donneur (3 min)

Se connecter : `donneur1@sos-sang.local` / `Demo!Passw0rd`.

1. **Tableau de bord** : carte de profil, groupe sanguin, disponibilité (commutateur actif), encart d'éligibilité avec l'avertissement « pas une validation médicale ».
2. **Alertes** : notifications reçues avec canal (EMAIL, SMS, WEB), statut `SENT` et latence mesurée.
3. **Urgences compatibles** : distance, échéance, progression des poches confirmées.
4. Cliquer **« J'arrive »** sur une urgence ouverte : la réponse est enregistrée et publiée (`reponse.recue`).
5. **Profil** : ajouter une position (consentement explicite), puis retirer le consentement — les coordonnées sont effacées.

## 3. Espace hôpital (4 min)

Se connecter : `hopital.central@sos-sang.local` / `Demo!Passw0rd`.

1. **Tableau de bord** : urgences actives, couvertes, en attente, clôturées ; stocks avec groupes sous seuil.
2. **Déclarer une urgence** : groupe `O−`, 2 poches, priorité critique, échéance +3 h → « Publier et alerter ».
3. **Détail de l'urgence** : la pastille « Temps réel » est active. Les donneurs contactés apparaissent avec distance et rang ; les statuts évoluent sans recharger la page à chaque réponse.
4. Ouvrir un second navigateur (ou une fenêtre privée) avec `donneur2` puis `donneur4`, répondre « J'arrive » : le compteur passe à 1/2, puis à 2/2 et l'urgence bascule en **Couverte**.
5. Une troisième réponse « J'arrive » **n'ajoute pas** de confirmation : la place est déjà prise (opération atomique).
6. **Clôturer** : les dons sont enregistrés, l'urgence passe en `CLOSED`, l'historique du donneur confirmé est mis à jour (`don.effectue`).
7. **Stocks** : ajuster un groupe de +1/−1, puis définir une valeur absolue ; les mouvements apparaissent dans le journal.
8. **Statistiques** : répartition par statut, par groupe, délai moyen de couverture.

## 4. Espace administrateur (3 min)

Se connecter : `admin@sos-sang.local` / `Demo!Passw0rd`.

1. **Vue d'ensemble** : urgences déclarées, donneurs mobilisés, poches collectées, répartition des comptes, événements récents.
2. **Hôpitaux** : `Hôpital Nord` est en attente → **Valider**. Il peut désormais se connecter ; l'action est tracée.
3. **Utilisateurs** : recherche, changement de rôle, suspension (impossible sur son propre compte).
4. **Urgences** : liste reconstruite depuis le journal d'événements, avec statut calculé et dernier événement.
5. **Notifications** : volumes par canal, latence moyenne / p95 / max, échecs et bouton de renvoi.
6. **Audit** : connexions, validations, changements de rôle, suppressions.
7. **État des services** : 7 services `UP` avec latence.

## 5. Vérifications en ligne de commande

```bash
# Santé agrégée
curl -s http://localhost:8080/api/health | jq

# Connexion et jeton
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sos-sang.local","password":"Demo!Passw0rd"}' | jq -r .token)

# Supervision des notifications (latence réelle)
curl -s http://localhost:8080/api/admin/notifications/stats -H "authorization: Bearer $TOKEN" | jq

# Santé des microservices
curl -s http://localhost:8080/api/dashboard/admin/services -H "authorization: Bearer $TOKEN" | jq
```

## 6. Suite de tests complète

```bash
SOS_E2E=1 npm test
```

Résultat attendu (mesuré dans cet environnement) : **31 tests passent**, dont la mesure `déclaration → notification : 141 ms`.

## 7. Points à annoncer honnêtement pendant la soutenance

- E-mail et SMS sont **simulés** ; les notifications web sont réelles.
- En exécution locale sans Docker, le bus et le cache sont **en mémoire**.
- La carte est **schématique** ; aucune position précise de donneur n'est exposée.
- Docker, Kubernetes, Helm, CI et monitoring sont fournis mais **n'ont pas été exécutés dans cet environnement** (aucun moteur Docker disponible).
- Deux réplicas sur un cluster mono-nœud ne constituent **pas** une haute disponibilité matérielle.
