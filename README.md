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
  index.html          # markup de la page (contenu, pas de logique)
  src/
    style.css         # tous les styles
    main.js           # logique : copy-to-clipboard, claim manuel, connect/mint Noir Wallet
```

## À adapter avant de publier publiquement

- `index.html` → `#receiptNote` : le commentaire `<!-- TODO -->` te rappelle d'ajouter ton vrai contact (X / email) pour que les gens qui paient manuellement puissent t'envoyer leur claim.
- `src/main.js` → `PAY_ADDRESS` est lu directement depuis `#payAddr` dans `index.html` — c'est déjà ton adresse Zcash réelle confirmée plus tôt dans la conversation. Vérifie-la avant chaque déploiement.
- Le mint reste **manuel et honor-system** (pas de smart contract, pas d'escrow) — c'est expliqué dans l'encart rouge de la page elle-même.
