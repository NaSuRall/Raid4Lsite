const progressTitle = document.getElementById('progress-title');
const progressPct = document.getElementById('progress-pct');
const progressFill = document.getElementById('progress-fill');
const statPhotos = document.getElementById('stat-photos');
const statPeople = document.getElementById('stat-people');
const statPending = document.getElementById('stat-pending');
const bodyEl = document.getElementById('participants-body');
const titleInput = document.getElementById('title-input');
const generateBtn = document.getElementById('generate-btn');
const remindBtn = document.getElementById('remind-btn');
const msgEl = document.getElementById('msg');
const albumNote = document.getElementById('album-note');
const coverPicker = document.getElementById('cover-picker');
const emailStatusDot = document.getElementById('email-status-dot');
const emailStatusText = document.getElementById('email-status-text');
const emailTest = document.getElementById('email-test');
const emailTestInput = document.getElementById('email-test-input');
const emailTestBtn = document.getElementById('email-test-btn');
const emailMsg = document.getElementById('email-msg');

let selectedCoverId = null;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderStatus(data) {
  const total = data.participants.length;
  const pct = total > 0 ? Math.round((data.participated / total) * 100) : 0;

  progressTitle.textContent = `${data.participated} personne${data.participated > 1 ? 's' : ''} sur ${total} ${data.participated > 1 ? 'ont' : 'a'} participé`;
  progressPct.textContent = `${pct} %`;
  progressFill.style.width = `${pct}%`;

  statPhotos.textContent = data.totalPhotos;
  statPeople.textContent = total;
  statPending.textContent = data.pending;

  if (total === 0) {
    bodyEl.innerHTML = '<tr><td colspan="4">Aucun participant pour le moment.</td></tr>';
  } else {
    bodyEl.innerHTML = data.participants
      .map((p) => {
        const received = p.photoCount > 0;
        const tagClass = received ? 'tag tag-accent-2' : 'tag tag-neutral';
        const status = received ? 'Reçu' : 'En attente';
        const when = p.lastUploadAt ? new Date(p.lastUploadAt).toLocaleDateString('fr-FR') : '—';
        return `<tr>
          <td><div style="font-weight:600;">${escapeHtml(p.name)}</div><div class="text-muted" style="font-size:13px;">${escapeHtml(p.email)}</div></td>
          <td>${p.photoCount}</td>
          <td><span class="${tagClass}">${status}</span></td>
          <td class="text-muted">${when}</td>
        </tr>`;
      })
      .join('');
  }

  if (data.album) {
    if (!titleInput.value) titleInput.value = data.album.title;

    if (data.album.generated_at) {
      const sentPart = data.album.sent_at
        ? ` · envoyé le ${new Date(data.album.sent_at).toLocaleString('fr-FR')}`
        : ' · pas encore envoyé';
      albumNote.innerHTML = `<p class="text-muted" style="margin-top:20px;font-size:14px;">
        Dernier PDF genere : <strong>${escapeHtml(data.album.title)}</strong> le ${new Date(data.album.generated_at).toLocaleString('fr-FR')}
        (${data.album.photo_count} photos)${sentPart}.
        <br /><a href="/preview.html">Voir l'aperçu</a> · <a href="/album.html">Voir la page de téléchargement</a>
      </p>`;
    } else if (data.album.layout_json) {
      albumNote.innerHTML = `<p class="text-muted" style="margin-top:20px;font-size:14px;">
        Une mise en page a ete preparee mais le PDF n'a pas encore ete genere.
        <br /><a href="/preview.html">Reprendre le cadrage et generer le PDF</a>
      </p>`;
    }
  }
}

async function loadStatus() {
  const res = await fetch('/api/admin/status');
  const data = await res.json();
  renderStatus(data);
  return data;
}

function selectCover(id, container) {
  selectedCoverId = id;
  container.querySelectorAll('.opt').forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === (id || '__none__'));
  });
}

async function loadCoverPicker(preselectId) {
  const res = await fetch('/api/admin/all-photos');
  const data = await res.json();

  coverPicker.innerHTML = '';

  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.className = 'opt none';
  noneBtn.dataset.id = '__none__';
  noneBtn.innerHTML = 'Couleur unie<span class="check">✓</span>';
  noneBtn.addEventListener('click', () => selectCover(null, coverPicker));
  coverPicker.appendChild(noneBtn);

  if (data.photos.length === 0) {
    const p = document.createElement('p');
    p.className = 'text-muted';
    p.style.cssText = 'font-size:14px;grid-column:1/-1;';
    p.textContent = 'Aucune photo deposee pour le moment.';
    coverPicker.appendChild(p);
  }

  data.photos.forEach((photo) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'opt';
    btn.dataset.id = photo.id;
    btn.title = photo.participantName;
    btn.innerHTML = `<img src="/api/thumb/${photo.id}" alt="" loading="lazy" /><span class="check">✓</span>`;
    btn.addEventListener('click', () => selectCover(photo.id, coverPicker));
    coverPicker.appendChild(btn);
  });

  selectCover(preselectId || null, coverPicker);
}

async function loadEmailStatus(verify = false) {
  try {
    const res = await fetch(`/api/admin/email-status${verify ? '?verify=true' : ''}`);
    const data = await res.json();
    emailStatusDot.className = `status-dot ${data.verified ? 'is-ok' : data.configured ? 'is-warning' : ''}`;
    emailTest.hidden = !data.configured;
    emailTestInput.value ||= data.fromEmail || '';
    if (!data.configured) {
      emailStatusText.textContent = 'Non configuré — renseignez SMTP_HOST et FROM_EMAIL dans .env.';
    } else if (data.verified) {
      emailStatusText.textContent = `Connexion vérifiée · ${data.host}:${data.port} · expéditeur ${data.fromEmail}`;
    } else if (verify && data.error) {
      emailStatusText.textContent = `Configuration détectée, mais connexion impossible : ${data.error}`;
    } else {
      emailStatusText.textContent = `Configuré · ${data.host}:${data.port} · utilisez « Tester » avant l’envoi final.`;
    }
  } catch {
    emailStatusText.textContent = 'Impossible de vérifier le service email.';
  }
}

emailTestBtn.addEventListener('click', async () => {
  emailTestBtn.disabled = true;
  emailMsg.innerHTML = '';
  try {
    const res = await fetch('/api/admin/email-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailTestInput.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "L'email de test a échoué.");
    emailMsg.innerHTML = '<div class="success-msg">Email de test envoyé. Vérifiez votre boîte de réception.</div>';
    await loadEmailStatus(true);
  } catch (err) {
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = err.message;
    emailMsg.replaceChildren(box);
  } finally {
    emailTestBtn.disabled = false;
  }
});

remindBtn.addEventListener('click', async () => {
  remindBtn.disabled = true;
  const original = remindBtn.textContent;
  remindBtn.innerHTML = '<span class="spinner"></span> Envoi...';
  msgEl.innerHTML = '';

  try {
    const res = await fetch('/api/admin/remind', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');

    if (data.noPending) {
      msgEl.innerHTML = '<div class="success-msg">Tout le monde a déjà participé !</div>';
    } else if (!data.configured) {
      msgEl.innerHTML = '<div class="error">Envoi d\'email non configuré (SMTP absent).</div>';
    } else {
      msgEl.innerHTML = `<div class="success-msg">Relance envoyée à ${data.sent} participant(s)${data.failed ? `, ${data.failed} échec(s)` : ''}.</div>`;
    }
  } catch (err) {
    msgEl.innerHTML = `<div class="error">${err.message}</div>`;
  } finally {
    remindBtn.disabled = false;
    remindBtn.textContent = original;
  }
});

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  const original = generateBtn.innerHTML;
  generateBtn.innerHTML = '<span class="spinner"></span> Préparation...';
  msgEl.innerHTML = '';

  try {
    const res = await fetch('/api/admin/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleInput.value.trim(), coverPhotoId: selectedCoverId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');

    window.location.href = '/preview.html';
  } catch (err) {
    msgEl.innerHTML = `<div class="error">${err.message}</div>`;
    generateBtn.disabled = false;
    generateBtn.innerHTML = original;
  }
});

Promise.all([
  loadStatus().then((data) => loadCoverPicker(data.album?.cover_photo_id)),
  loadEmailStatus(),
]);
