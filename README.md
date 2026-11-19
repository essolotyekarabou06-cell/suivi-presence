# Suivi des présences — serveur (Vercel + Neon)

## Déploiement
1. Mettez ces fichiers dans un dépôt GitHub (en gardant le dossier `api/`).
2. Sur vercel.com : Add New → Project → importez le dépôt → Deploy.
3. Projet Vercel → Storage → créez une base **Neon (Postgres)** et connectez-la au projet
   (elle ajoute `DATABASE_URL` automatiquement).
4. Projet → Settings → Environment Variables, ajoutez :
   - `AUTH_SECRET`    : une longue phrase aléatoire (32 caractères ou plus)
   - `ADMIN_PASSWORD` : le mot de passe du premier compte administrateur
   - `ADMIN_USER`     : (facultatif) identifiant de l'admin, par défaut `admin`
   - `APP_TZ`         : (facultatif) fuseau horaire, par défaut `Africa/Lome`
5. Deployments → Redeploy (pour que les variables soient prises en compte).
6. Test : ouvrez `https://VOTRE-PROJET.vercel.app/api/auth?a=me` → doit afficher `{"user":null}`.

Le compte admin est créé automatiquement au premier appel, avec `ADMIN_USER` / `ADMIN_PASSWORD`.
Dans l'application Flutter, mettez l'adresse du projet dans `kBase` (lib/api.dart).
