const content = document.getElementById('content');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function recipientLine(names) {
  if (!names || names.length === 0) return '';
  if (names.length === 1) return `Email envoyé à ${escapeHtml(names[0])}.`;
  if (names.length === 2) return `Email envoyé à ${escapeHtml(names[0])} et ${escapeHtml(names[1])}.`;
  return `Email envoyé à ${escapeHtml(names[0])}, ${escapeHtml(names[1])} et ${names.length - 2} autre${names.length - 2 > 1 ? 's' : ''} voyageur${names.length - 2 > 1 ? 's' : ''}.`;
}

async function load() {
  try {
    const res = await fetch('/api/album/status');
    const data = await res.json();

    if (!data.ready) {
      content.innerHTML = `
        <div class="page-card" style="text-align:center;">
          <h1>L'album n'est pas encore prêt</h1>
          <p class="text-muted">L'organisateur n'a pas encore lancé la création. Revenez un peu plus tard, ou <a href="/">déposez vos photos</a> en attendant !</p>
        </div>
      `;
      return;
    }

    const emailInfo = data.sent
      ? `<div class="info-box">
          <span class="icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m3 7 9 6 9-6"></path></svg></span>
          <p>${recipientLine(data.recipientNames)}</p>
        </div>`
      : '';

    content.innerHTML = `
      <div class="page-card" style="text-align:center;">
        <div style="width:88px;height:88px;border-radius:999px;background:var(--color-accent-2);display:grid;place-items:center;margin:0 auto 24px;color:var(--color-bg);">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </div>
        <h1>${data.sent ? "L'album est envoyé !" : escapeHtml(data.title)}</h1>
        <p class="text-muted" style="max-width:44ch;margin:0 auto 30px;">
          ${data.sent
            ? 'Chaque voyageur a reçu un email avec l\'album en PDF et toutes les photos. Vous pouvez aussi les télécharger ici.'
            : `${data.photoCount} photos de ${data.participantCount} participant(s) — prêtes à télécharger.`}
        </p>

        <div class="download-grid">
          <div class="card download-card pdf">
            <span class="icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg></span>
            <div class="card-title">L'album — PDF</div>
            <p class="card-body">${data.pageCount} pages, prêt à imprimer chez un photographe.</p>
            <a href="/download/album.pdf" class="btn btn-primary btn-block">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
              Télécharger le PDF
            </a>
          </div>
          <div class="card download-card zip">
            <span class="icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><path d="M10 6h4M10 10h4M10 14h4"></path></svg></span>
            <div class="card-title">Toutes les photos — ZIP</div>
            <p class="card-body">${data.photoCount} photos en qualité originale.</p>
            <a href="/download/photos.zip" class="btn btn-primary btn-block">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
              Télécharger le ZIP
            </a>
          </div>
        </div>

        ${emailInfo}

        <a href="/" class="btn btn-ghost" style="margin-top:26px;">Retour à l'accueil</a>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="page-card"><h1>Erreur</h1><p class="text-muted">Impossible de charger le statut de l'album.</p></div>`;
  }
}

load();
