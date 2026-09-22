# $GHST Mint

Page de mint pour $GHST sur le réseau Zcash (ZEC), avec intégration réelle du wallet **Noir Wallet** (connect + paiement direct depuis le solde shielded), plus un fallback manuel (copier/coller txid).

Projet Vite + JS vanilla. `@noir-wallet/sdk` est une vraie dépendance npm (pas un import CDN) — voir `src/main.js`.

## Lancer le projet (PowerShell)

Prérequis : [Node.js](https://nodejs.org) installé (LTS, ex. v20). Vérifie avec :

```powershell
node -v
npm -v
```

Ensuite, dans le dossier du projet :

```powershell
cd C:\chemin\vers\ghst-mint-project
npm install
npm run dev
```

`npm run dev` lance un serveur local (Vite affiche l'URL, généralement `http://localhost:5173`). Ouvre cette URL dans **Chrome avec l'extension Noir Wallet installée et activée** :

https://chromewebstore.google.com/detail/noir-wallet/mfoghjbpfanobmnoemoepenjjcmfpmdn?pli=1

Sans l'extension installée, la page se rabat automatiquement sur "Wallet not found" + le flux manuel (déjà présent en dessous, dans "Prefer to pay manually?").

## Autres commandes

```powershell
npm run build     # build de production dans dist/
npm run preview   # sert le build de dist/ en local pour vérifier avant de déployer
```

## Structure

```
ghst-mint-project/
  package.json
  vercel.json          # dit à Vercel que c'est un projet Vite
  index.html            # markup de la page (contenu, pas de logique)
  api/
    _kv.js                    # helper partagé pour parler à Vercel KV
    verify-claim.js          # fonction serverless Vercel — anti-bot public (captcha + re-vérif PoW + rate-limit)
    verify-team-claim.js    # fonction serverless Vercel — gate team (code secret + rate-limit + cap 33)
  src/
    style.css           # tous les styles
    config.js            # LA config à éditer à la main : supply mintée, prix, difficulté
    pow.js               # moteur proof-of-work (web workers)
    main.js               # logique : copy-to-clipboard, claim manuel, connect/mint Noir Wallet, anti-bot
```

## Anti-bot : captcha + rate-limit (obligatoire pour que le mint gate marche)

Le mint ne s'active plus juste en résolvant le proof-of-work dans le navigateur — un bot peut faire ça aussi vite ou plus vite qu'un humain (sha256 c'est justement le genre de calcul qu'un bot fait bien). Maintenant il faut **en plus** :
1. résoudre un captcha Cloudflare Turnstile
2. que le serveur (une fonction Vercel) revérifie lui-même le nonce et le captcha
3. passer sous la limite : 1 claim vérifié par adresse, et max 5 tentatives par IP par heure

**Tant que tu n'as pas configuré ça, le mint reste bloqué (fail-safe)** — c'est voulu, pas un bug.

### Étapes pour activer (à faire une fois, après le premier déploiement Vercel)

**1. Cloudflare Turnstile (captcha gratuit, 2 min)**
- Va sur https://dash.cloudflare.com/ (compte gratuit si t'en as pas)
- Turnstile → Add site → mets le domaine de ton site Vercel (ex. `zecghost.vercel.app`)
- Tu obtiens 2 clés : une **Site Key** (publique) et une **Secret Key** (privée, jamais dans le code)

**2. Vercel KV (base de données gratuite pour le rate-limit)**
- Dans ton projet sur vercel.com → onglet **Storage** → **Create Database** → **KV** (c'est Upstash Redis, plan gratuit largement suffisant)
- Une fois créé, clique **Connect Project** et sélectionne ton projet `zecghost` — Vercel ajoute automatiquement `KV_REST_API_URL` et `KV_REST_API_TOKEN` dans tes variables d'environnement

**3. Ajouter les variables d'environnement sur Vercel**
- Projet → **Settings** → **Environment Variables**, ajoute :
  - `VITE_TURNSTILE_SITE_KEY` = ta Site Key (celle-là peut être publique, c'est normal)
  - `TURNSTILE_SECRET_KEY` = ta Secret Key (⚠️ jamais avec le préfixe `VITE_`, sinon elle finirait exposée au navigateur)
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` sont déjà ajoutées automatiquement par l'étape 2
- Redéploie (`vercel --prod` ou juste un nouveau push sur `main`) pour que les nouvelles variables soient prises en compte

### Tester en local

`npm run dev` (Vite tout seul) affiche bien la page et le widget captcha, **mais** `/api/verify-claim` et `/api/verify-team-claim` ne répondent pas (404) — Vite ne fait pas tourner les fonctions serverless. Pour tester le flux complet en local :

```powershell
npm install -g vercel
vercel link      # une fois, connecte ce dossier à ton projet Vercel
vercel env pull  # récupère tes vraies variables d'environnement en local
vercel dev       # lance Vite + les fonctions /api ensemble
```

## Team mint (Phase 1 — 33 gratuits, invite-only)

Section repliée sur la page ("Team mint (Phase 1 — invite only)"), séparée du mint public : pas de proof-of-work, pas de captcha — juste un **code secret** que toi seul connais, vérifié côté serveur (jamais présent dans le code envoyé au navigateur). Protégé en plus par : 1 claim par adresse, max 10 tentatives de code par IP/heure, et un plafond dur de 33 claims au total.

**Étape supplémentaire à faire sur Vercel** (en plus des 3 déjà listées plus haut, la KV sert aux deux) :
- Projet → **Settings** → **Environment Variables**, ajoute `TEAM_MINT_CODE` = un code de ton choix (ex. `ghst-team-2026-xyz`), à partager en privé avec tes 33 membres — jamais dans le repo, jamais dans un message public.
- Redéploie après l'avoir ajouté.

Le montant envoyé (`0.0001 ZEC`) est symbolique — Zcash a besoin d'un montant non-nul pour attacher un memo, donc c'est pas vraiment gratuit au sens "0 ZEC", mais c'est le prix réseau minimum, pas le prix public (0.025 ZEC).

## À adapter avant de publier publiquement

- `index.html` → `#receiptNote` : le commentaire `<!-- TODO -->` te rappelle d'ajouter ton vrai contact (X / email) pour que les gens qui paient manuellement puissent t'envoyer leur claim.
- `src/main.js` → `PAY_ADDRESS` est lu directement depuis `#payAddr` dans `index.html` — c'est déjà ton adresse Zcash réelle confirmée plus tôt dans la conversation. Vérifie-la avant chaque déploiement.
- Le mint reste **manuel et honor-system** (pas de smart contract, pas d'escrow) — c'est expliqué dans l'encart rouge de la page elle-même.
