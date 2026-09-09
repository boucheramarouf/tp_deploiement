# TP Déploiement — CI/CD automatisé

Application web de démonstration + pipeline **GitHub Actions** qui, à chaque push sur `main`,
teste, construit une image Docker, la publie sur **Docker Hub** et la déploie sur une **VM Azure**
via SSH. Aucune action manuelle après le `git push`.

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
5) Deploy sur VM Azure (SSH)          ← idempotent, conteneur "myapp"
      ↓
6) Healthcheck HTTP sur l'IP publique
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

Ou avec Docker Compose (identique au déploiement VM, port 80) :

```bash
IMAGE=tp-deploiement docker compose up -d
```

## Les tests

| Type | Commande | Outils |
|------|----------|--------|
| Unitaires | `npm test` | Jest, Supertest |
| E2E | `npm run e2e` | Cypress + start-server-and-test |

- **Unitaires** : logique métier (`normalizeText`) + comportement des routes (`/health`,
  `/api/messages` GET/POST, cas d'erreur 400).
- **E2E** : `npm run e2e` démarre le serveur, attend `/health`, puis Cypress vérifie :
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
| `e2e-tests` | `npm ci` + `npm run e2e` | `unit-tests` |
| `build-push` | build image + tags `latest` et `<sha7>` + push Docker Hub | `unit-tests`, `e2e-tests` |
| `deploy` | SSH sur la VM Azure, `docker pull`, redémarre `myapp`, healthcheck | `build-push` |

Grâce à `needs:`, **le build ne se lance que si les tests unitaires ET E2E passent**, et le
déploiement seulement si le build/push a réussi.

### Comment le déploiement est déclenché

1. `git push` sur `main`.
2. GitHub Actions exécute les 4 jobs en séquence.
3. Le job `deploy` se connecte en SSH à la VM Azure (`appleboy/ssh-action`), fait
   `docker login` + `docker pull` de l'image taguée avec le SHA du commit, puis :

   ```bash
   docker rm -f myapp 2>/dev/null || true
   docker run -d --name myapp --restart unless-stopped -p 80:3000 -e PORT=3000 <image>
   ```

4. Un dernier step interroge `http://<IP_PUBLIQUE_VM>/health` (10 tentatives) ; la pipeline
   échoue si l'app ne renvoie pas `200`.

### Idempotence

- Nom de conteneur **fixe** (`myapp`) + `docker rm -f` avant `docker run` → jamais deux
  conteneurs, pas de conflit de port.
- `--restart unless-stopped` → l'app repart au reboot de la VM.
- Rejouer le workflow ou repousser le même commit **redéploie proprement** le même état.
- `docker image prune -f` nettoie les anciennes images.

## Secrets GitHub (aucun identifiant en clair dans le dépôt)

À créer dans **Settings → Secrets and variables → Actions** :

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | utilisateur Docker Hub |
| `DOCKERHUB_TOKEN` | access token Docker Hub (Account settings → Security) |
| `AZURE_VM_HOST` | IP publique (ou DNS) de la VM Azure |
| `AZURE_VM_USER` | utilisateur SSH de la VM (ex : `azureuser`) |
| `AZURE_SSH_PRIVATE_KEY` | clé privée SSH correspondant à la clé publique de la VM |

## Préparation de la VM Azure (une seule fois)

```bash
# sur la VM
sudo apt-get update && sudo apt-get install -y docker.io
sudo usermod -aG docker $USER   # puis se reconnecter
```

Ouvrir le port **80** dans le *Network Security Group* Azure (règle entrante HTTP).
La clé publique doit être dans `~/.ssh/authorized_keys` de l'utilisateur SSH.

## Choix techniques

- **Express** : minimal, démarrage rapide, healthcheck trivial.
- **Jest + Supertest** : tests des routes sans lancer de vrai serveur (rapide en CI).
- **Cypress** : parcours E2E réel (navigateur) incluant l'UI, comme demandé.
- **Dockerfile multi-stage** + image `node:20-alpine`, utilisateur non-root, `HEALTHCHECK` intégré.
- **Tag par SHA de commit** : traçabilité + déploiement déterministe (on déploie exactement
  l'image buildée par ce run), `latest` en complément.
- **`appleboy/ssh-action`** : déploiement 100 % dans GitHub Actions, rien à la main.
- **Déploiement par `docker run` + nom fixe** : idempotent et sans dépendance supplémentaire
  sur la VM (une alternative `docker compose` est fournie dans `docker-compose.yml`).

## Capture d'écran

La capture de la VM Azure accessible sur son IP publique est dans
[`screenshots/`](screenshots/).
