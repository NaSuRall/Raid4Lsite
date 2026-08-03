const participant = JSON.parse(localStorage.getItem('participant') || 'null');

if (!participant || !participant.id) {
  window.location.href = '/';
}

document.getElementById('switch-link').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem('participant');
  window.location.href = '/';
});

const fileInput = document.getElementById('file-input');
const chooseBtn = document.getElementById('choose-btn');
const dropzone = document.getElementById('dropzone');
const pendingGrid = document.getElementById('pending-grid');
const pendingCountEl = document.getElementById('pending-count');
const clearPendingBtn = document.getElementById('clear-pending');
const sendBtn = document.getElementById('send-btn');
const msg = document.getElementById('msg');
const sentSection = document.getElementById('sent-section');
const sentGrid = document.getElementById('sent-grid');
const sentCountEl = document.getElementById('sent-count');

let pending = []; // { file, url }

function renderPending() {
  pendingGrid.innerHTML = '';
  pending.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${p.url}" alt="" /><button class="del" title="Retirer">×</button>`;
    div.querySelector('.del').addEventListener('click', () => {
      pending.splice(i, 1);
      renderPending();
    });
    pendingGrid.appendChild(div);
  });
  const n = pending.length;
  pendingCountEl.textContent = `${n} photo${n > 1 ? 's' : ''} choisie${n > 1 ? 's' : ''}`;
  sendBtn.disabled = n === 0;
  sendBtn.textContent = n > 0 ? `Envoyer mes ${n} photo${n > 1 ? 's' : ''}` : 'Envoyer mes photos';
}

function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  files.forEach((file) => pending.push({ file, url: URL.createObjectURL(file) }));
  renderPending();
}

chooseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

clearPendingBtn.addEventListener('click', () => {
  pending = [];
  renderPending();
});

['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
});
['dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
});
dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

function addSentThumb(photo) {
  const div = document.createElement('div');
  div.className = 'thumb';
  div.dataset.id = photo.id;
  div.innerHTML = `<img src="/uploads/${participant.id}/${photo.filename}" alt="" loading="lazy" /><button class="del" title="Supprimer">×</button>`;
  div.querySelector('.del').addEventListener('click', async () => {
    div.remove();
    updateSentCount();
    await fetch(`/api/photo/${photo.id}`, { method: 'DELETE' });
  });
  sentGrid.prepend(div);
}

function updateSentCount() {
  const n = sentGrid.children.length;
  sentSection.style.display = n > 0 ? 'block' : 'none';
  sentCountEl.textContent = `Déjà envoyées (${n})`;
}

async function loadExisting() {
  const res = await fetch(`/api/participant/${participant.id}/photos`);
  const data = await res.json();
  data.photos.forEach(addSentThumb);
  updateSentCount();
}

sendBtn.addEventListener('click', async () => {
  if (pending.length === 0) return;
  sendBtn.disabled = true;
  const originalLabel = sendBtn.textContent;
  sendBtn.innerHTML = '<span class="spinner"></span> Envoi en cours...';
  msg.innerHTML = '';

  const formData = new FormData();
  formData.append('participantId', participant.id);
  pending.forEach((p) => formData.append('photos', p.file));

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Echec de l'envoi.");

    localStorage.setItem('lastUploadCount', String(data.uploaded));
    window.location.href = '/confirm.html';
  } catch (err) {
    msg.innerHTML = `<div class="error">${err.message}</div>`;
    sendBtn.disabled = false;
    sendBtn.textContent = originalLabel;
  }
});

loadExisting();
