const participant = JSON.parse(localStorage.getItem('participant') || 'null');

if (!participant?.id) window.location.href = '/';

const MAX_FILES = 40;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(avif|heic|heif|jpe?g|png|tiff?|webp)$/i;
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
const progressWrap = document.getElementById('upload-progress');
const progressBar = document.getElementById('upload-progress-bar');
const progressText = document.getElementById('upload-progress-text');

let pending = [];

document.getElementById('switch-link').addEventListener('click', (event) => {
  event.preventDefault();
  clearPending();
  localStorage.removeItem('participant');
  window.location.href = '/';
});

function showMessage(text, type = 'error') {
  msg.innerHTML = '';
  if (!text) return;
  const box = document.createElement('div');
  box.className = type === 'success' ? 'success-msg' : 'error';
  box.textContent = text;
  msg.appendChild(box);
}

function fingerprint(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function renderPending() {
  pendingGrid.innerHTML = '';
  pending.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const image = document.createElement('img');
    image.src = item.url;
    image.alt = `Aperçu de ${item.file.name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'del';
    remove.title = 'Retirer cette photo';
    remove.setAttribute('aria-label', `Retirer ${item.file.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => removePending(index));
    div.append(image, remove);
    pendingGrid.appendChild(div);
  });
  const count = pending.length;
  pendingCountEl.textContent = `${count} photo${count > 1 ? 's' : ''} choisie${count > 1 ? 's' : ''}`;
  clearPendingBtn.hidden = count === 0;
  sendBtn.disabled = count === 0;
  sendBtn.textContent = count ? `Envoyer ${count} photo${count > 1 ? 's' : ''}` : 'Envoyer mes photos';
}

function removePending(index) {
  URL.revokeObjectURL(pending[index].url);
  pending.splice(index, 1);
  renderPending();
}

function clearPending() {
  pending.forEach((item) => URL.revokeObjectURL(item.url));
  pending = [];
  renderPending();
}

function addFiles(fileList) {
  const current = new Set(pending.map((item) => fingerprint(item.file)));
  const errors = [];
  for (const file of Array.from(fileList)) {
    if (pending.length >= MAX_FILES) {
      errors.push(`Maximum ${MAX_FILES} photos par envoi.`);
      break;
    }
    if (!(file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name))) {
      errors.push(`${file.name} n'est pas une image compatible.`);
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name} dépasse 25 Mo.`);
      continue;
    }
    if (!file.size || current.has(fingerprint(file))) continue;
    current.add(fingerprint(file));
    pending.push({ file, url: URL.createObjectURL(file) });
  }
  renderPending();
  showMessage(errors.join(' '));
}

chooseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});
clearPendingBtn.addEventListener('click', clearPending);

['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.remove('drag');
}));
dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

function addSentThumb(photo) {
  const div = document.createElement('div');
  div.className = 'thumb';
  div.dataset.id = photo.id;
  const image = document.createElement('img');
  image.src = `/uploads/${encodeURIComponent(participant.id)}/${encodeURIComponent(photo.filename)}`;
  image.alt = photo.originalName ? `Photo ${photo.originalName}` : 'Photo envoyée';
  image.loading = 'lazy';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'del';
  remove.title = 'Supprimer cette photo';
  remove.setAttribute('aria-label', 'Supprimer cette photo');
  remove.textContent = '×';
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    const response = await fetch(`/api/photo/${encodeURIComponent(photo.id)}`, { method: 'DELETE' });
    if (response.ok) {
      div.remove();
      updateSentCount();
    } else {
      remove.disabled = false;
      showMessage("La photo n'a pas pu être supprimée. Réessayez.");
    }
  });
  div.append(image, remove);
  sentGrid.prepend(div);
}

function updateSentCount() {
  const count = sentGrid.children.length;
  sentSection.hidden = count === 0;
  sentCountEl.textContent = `Déjà envoyée${count > 1 ? 's' : ''} (${count})`;
}

async function loadExisting() {
  try {
    const response = await fetch(`/api/participant/${encodeURIComponent(participant.id)}/photos`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    data.photos.forEach(addSentThumb);
    updateSentCount();
  } catch {
    showMessage("Impossible de charger les photos déjà envoyées. Vérifiez votre connexion.");
  }
}

function uploadFiles(formData) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.responseType = 'json';
    request.timeout = 5 * 60 * 1000;
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percentage = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${percentage} %`;
    });
    request.addEventListener('load', () => {
      const data = request.response || {};
      if (request.status >= 200 && request.status < 300) resolve(data);
      else reject(new Error(data.error || "L'envoi a échoué."));
    });
    request.addEventListener('error', () => reject(new Error('Connexion interrompue. Vos photos restent sélectionnées : vous pouvez réessayer.')));
    request.addEventListener('timeout', () => reject(new Error("L'envoi prend trop de temps. Vos photos restent sélectionnées : réessayez avec moins de photos.")));
    request.send(formData);
  });
}

sendBtn.addEventListener('click', async () => {
  if (!pending.length) return;
  sendBtn.disabled = true;
  chooseBtn.disabled = true;
  showMessage('');
  progressWrap.hidden = false;
  progressBar.style.width = '0%';
  progressText.textContent = 'Préparation…';

  const formData = new FormData();
  formData.append('participantId', participant.id);
  pending.forEach((item) => formData.append('photos', item.file));

  try {
    const data = await uploadFiles(formData);
    localStorage.setItem('lastUploadCount', String(data.uploaded));
    localStorage.setItem('lastUploadRejected', String(data.rejected?.length || 0));
    clearPending();
    window.location.href = '/confirm.html';
  } catch (error) {
    showMessage(error.message);
    progressWrap.hidden = true;
    sendBtn.disabled = false;
    chooseBtn.disabled = false;
  }
});

window.addEventListener('beforeunload', () => pending.forEach((item) => URL.revokeObjectURL(item.url)));
renderPending();
loadExisting();
