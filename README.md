# TP Déploiement — CI/CD automatisé

Application web de démonstration + pipeline **GitHub Actions** qui, à chaque push sur `main`,
teste, construit une image Docker, la publie sur **Docker Hub** et la déploie **sur Azure**
(conteneur exposé sur une IP publique). Aucune action manuelle après le `git push`.

```
git push (main)
      ↓
GitHub Actions
      ↓
1) Unit tests  (Jest + Supertest)
      ↓
2) E2E tests   (Cypress)              ← démarre seulement si 1) OK
      ↓
3) Build image Docker                 ← seulement si 1) ET 2) OK
      ↓
4) Push image sur Docker Hub
      ↓
5) Deploy sur Azure (conteneur "myapp", IP publique)   ← idempotent
      ↓
6) Healthcheck HTTP sur l'IP/FQDN public
```

## L'application

- **Node.js + Express**, port **3000** (configurable via `PORT`).
- Endpoints :
  - `GET /health` → `{ "status": "ok", "uptime": <s>, "timestamp": <iso> }` — vérification
  - `GET /` → page web (liste de messages + formulaire d'ajout)
  - `GET /api/messages` → liste JSON des messages
  - `POST /api/messages` `{ "text": "..." }` → ajoute un message

### Lancer en local

```bash
npm install
npm start           # http://localhost:3000
curl http://localhost:3000/health
```

### Lancer avec Docker

```bash
docker build -t tp-deploiement .
docker run -d --name myapp -p 3000:3000 tp-deploiement
curl http://localhost:3000/health
```

Ou avec Docker Compose :

```bash
IMAGE=tp-deploiement docker compose up -d   # expose http://localhost
```

## Les tests

| Type | Commande | Outils |
|------|----------|--------|
| Unitaires | `npm test` | Jest, Supertest |
| E2E | `npm run e2e` | Cypress + start-server-and-test |

- **Unitaires** : logique métier (`normalizeText`) + comportement des routes (`/health`,
  `/api/messages` GET/POST, cas d'erreur 400).
- **E2E** : le serveur est démarré, on attend `/health`, puis Cypress vérifie :
  1. disponibilité de l'application (`GET /health` = 200),
  2. chargement de la page d'accueil,
  3. ajout d'un message via l'interface (fonctionnalité en plus de `/health`),
  4. réponse JSON de `/api/messages`.

La commande renvoie un code non nul si un test échoue → **la pipeline échoue**.

## Le pipeline GitHub Actions

Fichier : [.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml) — déclencheur : `push` sur `main`.

| Job | Rôle | Dépend de |
|-----|------|-----------|
| `unit-tests` | `npm ci` + `npm test` | — |
| `e2e-tests` | démarre le serveur + `cypress run` | `unit-tests` |
| `build-push` | build image + tags `latest` et `<sha7>` + push Docker Hub | `unit-tests`, `e2e-tests` |
| `deploy` | login Azure + déploie le conteneur + healthcheck sur l'IP publique | `build-push` |

Grâce à `needs:`, **le build ne se lance que si les tests unitaires ET E2E passent**, et le
déploiement seulement si le build/push a réussi.

### Comment le déploiement est déclenché

1. `git push` sur `main`.
2. GitHub Actions exécute les 4 jobs en séquence.
3. Le job `deploy` s'authentifie sur Azure en **OIDC** (`azure/login`, identité managée), puis
   recrée le conteneur `myapp` à partir de l'image taguée avec le SHA du commit :

   ```bash
   az container delete -g <RG> -n myapp --yes || true
   az container create -g <RG> -n myapp --image <user>/tp-deploiement:<sha7> \
     --ports 3000 --ip-address Public --dns-name-label <label> \
     --environment-variables PORT=3000 --restart-policy Always
   ```

4. Un dernier step interroge `http://<label>.francecentral.azurecontainer.io:3000/health`
   (20 tentatives) ; la pipeline échoue si l'app ne renvoie pas `200`.

### Idempotence

- **Nom fixe** `myapp` + `az container delete` avant `az container create` → jamais deux
  conteneurs, pas de doublon.
- **DNS label fixe** → le FQDN/URL public reste identique à chaque déploiement.
- `--restart-policy Always` → le conteneur redémarre en cas de crash.
- Rejouer le workflow ou repousser le même commit **redéploie proprement le même état**.

### Pourquoi Azure Container Instances et pas une VM Azure + SSH ?

L'abonnement **Azure for Students** utilisé pour ce TP n'autorise la création d'**aucune VM** :

- toutes les régions sauf `francecentral` sont bloquées par une *policy* (`RequestDisallowedByAzure`) ;
- en `francecentral`, toutes les familles de VM renvoient `SkuNotAvailable` (capacité) ou
  `QuotaExceeded` (quota vCPU = 0), y compris `B1s`, `B2s`, `D2s_v3`, etc.

Le déploiement se fait donc sur **Azure Container Instances** : c'est toujours du 100 % Azure,
sur une **IP publique Azure**, **entièrement piloté par GitHub Actions** et **idempotent**.
La seule différence avec l'énoncé est l'accès (CLI Azure au lieu de SSH).
Le workflow « VM + SSH » d'origine reste fourni dans
[`deploy/ci-cd-vm-ssh.yml`](deploy/ci-cd-vm-ssh.yml) et [`docker-compose.yml`](docker-compose.yml) :
il suffit de renseigner les secrets `AZURE_VM_*` et de l'activer si une VM est disponible.

## Secrets GitHub (aucun identifiant en clair dans le dépôt)

**Settings → Secrets and variables → Actions** :

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | utilisateur Docker Hub |
| `DOCKERHUB_TOKEN` | *personal access token* Docker Hub (Read & Write) |
| `AZURE_CLIENT_ID` | `clientId` de l'identité managée (OIDC) |
| `AZURE_TENANT_ID` | `tenantId` du compte Azure |
| `AZURE_SUBSCRIPTION_ID` | `subscriptionId` du compte Azure |
| `AZURE_RG` | nom du groupe de ressources, ex. `rg-tp` |
| `AZURE_DNS_LABEL` | préfixe DNS **unique**, ex. `tp-deploiement-bm` → `…​.francecentral.azurecontainer.io` |

Aucun mot de passe / clé secrète Azure n'est stocké : l'authentification GitHub → Azure se fait
en **OIDC** (jeton court généré à chaque run), via une **identité managée affectée par
l'utilisateur** dotée d'une *federated credential* sur ce dépôt/branche.

### Mise en place de l'auth OIDC (une fois, dans Azure Cloud Shell)

Le tenant utilisé interdit la création de *service principal*
(`Insufficient privileges`). On utilise donc une identité managée — ce sont des ressources
Azure normales (pas d'app registration, aucun droit annuaire requis) :

```bash
RG=rg-tp; REPO=boucheramarouf/tp_deploiement
SUB=$(az account show --query id -o tsv); TENANT=$(az account show --query tenantId -o tsv)

az group create -n $RG -l francecentral -o none
az identity create -g $RG -n gh-oidc -o none
MI_CLIENT=$(az identity show -g $RG -n gh-oidc --query clientId -o tsv)
MI_PRINCIPAL=$(az identity show -g $RG -n gh-oidc --query principalId -o tsv)

az identity federated-credential create --identity-name gh-oidc -g $RG --name github-main \
  --issuer https://token.actions.githubusercontent.com \
  --subject "repo:$REPO:ref:refs/heads/main" \
  --audiences api://AzureADTokenExchange

az role assignment create --assignee-object-id $MI_PRINCIPAL \
  --assignee-principal-type ServicePrincipal --role Contributor \
  --scope /subscriptions/$SUB/resourceGroups/$RG

echo "AZURE_CLIENT_ID=$MI_CLIENT"; echo "AZURE_TENANT_ID=$TENANT"; echo "AZURE_SUBSCRIPTION_ID=$SUB"
```

Reporter les 3 dernières valeurs dans les secrets GitHub correspondants.

## Choix techniques

- **Express** : minimal, démarrage rapide, healthcheck trivial.
- **Jest + Supertest** : test des routes sans vrai serveur réseau (rapide en CI).
- **Cypress** : parcours E2E réel (navigateur) incluant l'UI, comme demandé.
- **Dockerfile multi-stage**, image `node:20-alpine`, utilisateur non-root, `HEALTHCHECK` intégré.
- **Tag par SHA de commit** : traçabilité + déploiement déterministe (on déploie exactement
  l'image buildée par ce run) ; `latest` en complément.
- **Déploiement dans GitHub Actions** via `azure/login` (OIDC, sans secret) + `az` : rien à la main.
- **Azure Container Instances + nom & DNS fixes** : idempotent, IP publique, sans VM
  (contrainte de l'abonnement étudiant — voir section dédiée).

## Capture d'écran

La capture de l'application accessible sur l'IP / le FQDN public Azure est dans
[`screenshots/`](screenshots/) (`http://<AZURE_DNS_LABEL>.francecentral.azurecontainer.io:3000/`).

