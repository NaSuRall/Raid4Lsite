# Audit et todo du site

## Réalisé

- [x] Mettre `main` à jour depuis GitHub sans écraser de changement local.
- [x] Remplacer l'ajout de texte par un éditeur clair : titre, description, police, couleur et image liée.
- [x] Conserver le rendu des blocs texte/image à l'identique dans le PDF.
- [x] Simplifier les actions et rendre tableaux, formulaires, galeries et fenêtres confortables sur mobile, tablette et ordinateur.
- [x] Afficher la progression réelle de l'upload et permettre de réessayer sans perdre la sélection.
- [x] Valider le contenu réel des images, limiter leur taille et leurs dimensions, puis ignorer les doublons.
- [x] Rendre la suppression d'une photo fiable en cas d'erreur réseau.
- [x] Ajouter un diagnostic SMTP et un bouton d'email de test dans l'espace organisateur.
- [x] Ajouter des délais, un pool limité et trois tentatives pour chaque email.
- [x] Ne plus marquer l'album « envoyé » lorsque SMTP est absent ou que tous les envois échouent.
- [x] Protéger facultativement les pages et API organisateur avec `ADMIN_PASSWORD`.
- [x] Ajouter des en-têtes de sécurité, un endpoint de santé et un arrêt propre du serveur.
- [x] Fournir Docker, Docker Compose, un volume persistant et un healthcheck.
- [x] Documenter l'installation, la configuration, les sauvegardes et la vérification.

## À faire avant la mise en production

- [ ] Renseigner le vrai domaine dans `APP_BASE_URL`, les identifiants SMTP et un mot de passe organisateur robuste.
- [ ] Envoyer un email de test depuis `/admin.html` et vérifier sa réception (y compris les indésirables).
- [ ] Configurer HTTPS et sauvegarder régulièrement le volume Docker `album-data`.
- [ ] Tester une dernière fois sur les appareils physiques ciblés avec les vraies photos du voyage.
