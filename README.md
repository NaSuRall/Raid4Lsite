# Album Voyage

Site simple pour collecter les photos de voyage de tout le monde puis generer,
en un clic, un album PDF (photos melangees, mise en page varie type magazine,
sans nom affiche) et un ZIP de toutes les photos originales. Les participants
recoivent le lien par email et peuvent aussi le retrouver sur la page
`/album.html`.

## Fonctionnement

Parcours voyageur (3 etapes) :

1. `/` — chacun renseigne son prenom + email (aucun mot de passe).
2. `/upload.html` — choisit ses photos (bouton ou glisser-deposer), les
   retire si besoin, puis les envoie explicitement. Peut revenir plus tard
   ajouter ou supprimer des photos.
3. `/confirm.html` — confirmation visuelle du depot.

Parcours organisateur (3 etapes, page `/admin.html` **non protegee par mot de
passe** — choix fait pour rester simple) :

1. **Suivi** (`/admin.html`) — barre de progression, statistiques, tableau des
   participants (photos, statut, date de reception). Un bouton permet de
   relancer par email les voyageurs qui n'ont encore rien depose.
2. **Aperçu** (`/preview.html`) — l'organisateur choisit d'abord une photo de
   couverture (ou garde une couleur unie) sur `/admin.html`, puis clique sur
   « Creer l'album » : les photos de tout le monde sont melangees et reparties
   une fois pour toutes sur des pages contenant uniquement une grande photo,
   une mosaique de 4 ou une mosaique de 6 (aucune page a 2 photos longues ;
   mise en page figee, donc stable meme si on revient
   ajuster la composition). Chaque photo est deja recadree automatiquement
   (recadrage intelligent base sur la zone la plus interessante de l'image,
   sans nom affiche). Dans l'apercu, l'organisateur peut ensuite **glisser les
   photos pour echanger leurs places**, choisir la grille de chaque page
   (1, 4 ou 6 photos), choisir sa couleur de fond et ouvrir **Ajuster** pour
   recentrer, zoomer ou afficher une photo entiere sans la couper. Il peut
   liberer un cadre avec le bouton **Espace**, puis y ajouter du texte, des
   emojis ou une petite photo decorative. Un bloc de texte peut contenir un
   titre et une description, avec choix de la police (moderne, elegante ou
   machine a ecrire) et de la couleur, sans encadre blanc. Une image facultative
   peut etre attachee sous le texte, avec taille et forme modulables (rectangle
   arrondi, carre ou cercle) ; l'ensemble se deplace comme un seul bloc. Les decorations se deplacent par
   glisser-deposer et peuvent etre modifiees, redimensionnees ou supprimees.
   Une photo peut aussi etre retiree de l'album sans supprimer son fichier
   original ; elle reste disponible dans la zone **Photos retirees** pour etre
   remise plus tard.
   Tous ces choix sont sauvegardes et seront repris a
   l'identique dans le PDF. Ils restent modifiables apres une premiere
   generation : l'interface demande alors simplement de regenerer le PDF.
   Une fois satisfait, le
   bouton « Generer le PDF » produit le fichier (telechargeable pour
   verification) sans encore rien envoyer ; « Envoyer a tout le monde »
   declenche l'email seulement quand vous etes pret.
3. **Envoyé** — en cliquant sur « Envoyer a tout le monde », l'email (si
   configure) part vers chaque participant avec le lien de `/album.html`,
   page publique de telechargement du PDF et du ZIP.

Comme `/admin.html` n'a pas de mot de passe, ne partagez ce lien qu'avec les
personnes de confiance (ou vous-meme) — n'importe qui avec l'URL peut
declencher/relancer la generation et l'envoi.

## Stack

Node.js + Express, stockage des photos sur disque local, base SQLite (module
natif `node:sqlite`, aucune compilation requise), PDFKit pour le PDF,
`archiver` pour le ZIP, `nodemailer` pour l'email (optionnel).

## Installation locale

Prerequis : Node.js **22.5 ou plus recent** (pour `node:sqlite`).

```bash
npm install
cp .env.example .env
node server.js
```

Le site est alors sur http://localhost:3000

### Variables d'environnement (`.env`)

| Variable | Description |
|---|---|
| `TRIP_NAME` | Nom du voyage affiche sur le site et titre d'album par defaut |
| `PORT` | Port d'ecoute (3000 par defaut) |
| `APP_BASE_URL` | URL publique du site, utilisee dans les emails (ex. `https://album.mondomaine.com`) |
| `DATA_DIR` | Dossier de stockage (photos + base + fichiers generes). Par defaut `./data` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Identifiants SMTP pour l'envoi d'email. Laissez vide pour desactiver l'envoi (la page `/album.html` reste utilisable sans) |
| `FROM_NAME`, `FROM_EMAIL` | Expediteur des emails |

Pour le SMTP : un compte Gmail avec un "mot de passe d'application" fonctionne
(`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`), ou un service comme Brevo,
qui offre un quota gratuit adapte a ce genre d'usage ponctuel.

## Deploiement sur un VPS Hostinger (Ubuntu)

Ces etapes installent le site en permanence sur votre VPS, avec redemarrage
automatique et HTTPS.

### 1. Connexion et prerequis

```bash
ssh root@VOTRE_IP_VPS
apt update && apt upgrade -y
```

Installer Node.js 22 (via NodeSource) :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git nginx
node --version   # doit afficher v22.x ou plus
```

### 2. Recuperer le code

Depuis votre machine, poussez ce dossier sur un depot Git (GitHub/GitLab) puis
sur le VPS :

```bash
cd /var/www
git clone <url-de-votre-repo> album-voyage
cd album-voyage
npm ci --omit=dev
cp .env.example .env
nano .env   # renseignez TRIP_NAME, APP_BASE_URL, SMTP...
```

(Sans depot Git, `scp -r` le dossier directement depuis votre machine vers le
VPS fonctionne aussi.)

### 3. Lancer l'app en permanence avec PM2

```bash
npm install -g pm2
pm2 start server.js --name album-voyage
pm2 save
pm2 startup   # copiez-collez la commande qu'il affiche pour demarrer au boot
```

### 4. Nginx en reverse proxy + HTTPS

Creez `/etc/nginx/sites-available/album-voyage` :

```nginx
server {
    listen 80;
    server_name album.mondomaine.com;

    client_max_body_size 30M;   # important : sinon les photos volumineuses sont rejetees

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/album-voyage /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Pointez un enregistrement DNS A de votre domaine (dans le panneau Hostinger)
vers l'IP du VPS, puis activez le HTTPS gratuit :

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d album.mondomaine.com
```

Mettez a jour `APP_BASE_URL=https://album.mondomaine.com` dans `.env`, puis
`pm2 restart album-voyage`.

### Sauvegardes

Tout ce qui compte (base de donnees, photos, album genere) vit dans le
dossier `data/`. Pensez a le sauvegarder regulierement (ex. `rsync` vers
votre machine, ou snapshot Hostinger).

### Mise a jour du code

```bash
cd /var/www/album-voyage
git pull
npm ci --omit=dev
pm2 restart album-voyage
```
