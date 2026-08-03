const subtitle = document.getElementById('subtitle');
const cover = document.getElementById('cover');
const coverPhoto = document.getElementById('cover-photo');
const coverDot = document.getElementById('cover-dot');
const coverTitle = document.getElementById('cover-title');
const coverDate = document.getElementById('cover-date');
const coverEdit = document.getElementById('cover-edit');
const layoutPagesEl = document.getElementById('layout-pages');
const saveState = document.getElementById('save-state');
const generateBtn = document.getElementById('generate-btn');
const sendBtn = document.getElementById('send-btn');
const msg = document.getElementById('msg');
const sendMsg = document.getElementById('send-msg');
const generatedSection = document.getElementById('generated-section');
const removedPhotos = document.getElementById('removed-photos');
const removedCount = document.getElementById('removed-count');
const removedPhotosGrid = document.getElementById('removed-photos-grid');

const dialog = document.getElementById('crop-dialog');
const dialogTitle = document.getElementById('crop-dialog-title');
const cropStage = document.getElementById('crop-stage');
const cropStagePhoto = document.getElementById('crop-stage-photo');
const cropStageDot = document.getElementById('crop-stage-dot');
const cropStageHelp = document.getElementById('crop-stage-help');
const cropMode = document.getElementById('crop-mode');
const zoomField = document.getElementById('zoom-field');
const cropZoom = document.getElementById('crop-zoom');
const cropZoomValue = document.getElementById('crop-zoom-value');
const cropReset = document.getElementById('crop-reset');
const cropSave = document.getElementById('crop-save');
const cropMsg = document.getElementById('crop-msg');
const miniPhotoDialog = document.getElementById('mini-photo-dialog');
const miniPhotoGrid = document.getElementById('mini-photo-grid');

let albumLayout = null;
let draggedPhotoId = null;
let editingPhoto = null;
let editorValues = null;
let hadGeneratedPdf = false;
let decorationPageIndex = null;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `element-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function photoValues(photo) {
  return {
    x: photo.cropX != null ? photo.cropX : 0.5,
    y: photo.cropY != null ? photo.cropY : 0.5,
    zoom: clamp(photo.cropZoom || 1, 1, 3),
    mode: photo.cropMode === 'contain' ? 'contain' : 'cover',
  };
}

function applyPhotoView(img, dot, values) {
  img.style.objectFit = values.mode === 'contain' ? 'contain' : 'cover';
  img.style.objectPosition = `${values.x * 100}% ${values.y * 100}%`;
  img.style.transformOrigin = `${values.x * 100}% ${values.y * 100}%`;
  img.style.transform = values.mode === 'contain' ? 'none' : `scale(${values.zoom})`;
  if (dot) {
    dot.style.left = `${values.x * 100}%`;
    dot.style.top = `${values.y * 100}%`;
    dot.hidden = values.mode === 'contain';
  }
}

function getStageRatio(page) {
  if (!page) return 1 / 1.414;
  if (page.type === 'feature') return 523 / 770;
  if (page.type === 'quad') return 254 / 377;
  return 254 / 246;
}

function planPageSizes(total) {
  const best = Array(total + 1).fill(null);
  best[0] = { sizes: [], singles: 0 };
  for (let count = 1; count <= total; count++) {
    for (const size of [6, 4, 1]) {
      if (count < size || !best[count - size]) continue;
      const candidate = {
        sizes: [...best[count - size].sizes, size],
        singles: best[count - size].singles + (size === 1 ? 1 : 0),
      };
      const current = best[count];
      if (
        !current ||
        candidate.sizes.length < current.sizes.length ||
        (candidate.sizes.length === current.sizes.length && candidate.singles < current.singles)
      ) best[count] = candidate;
    }
  }
  return best[total]?.sizes || [];
}

function normalizePageFormats() {
  const expectedCounts = { feature: 1, quad: 4, six: 6 };
  const alreadyValid = albumLayout.pages.every((page) => (
    expectedCounts[page.type] === page.photos.length
  ));
  if (alreadyValid) return false;

  const photos = flatPhotos();
  const oldPages = albumLayout.pages;
  let offset = 0;
  albumLayout.pages = planPageSizes(photos.length).map((size, pageIndex) => {
    const oldPage = oldPages[pageIndex];
    const page = {
      type: size === 1 ? 'feature' : size === 4 ? 'quad' : 'six',
      photos: photos.slice(offset, offset + size),
      elements: oldPage?.elements || [],
      backgroundColor: oldPage?.backgroundColor || '#ffffff',
    };
    offset += size;
    return page;
  });
  return true;
}

function setSaveState(text, type = '') {
  saveState.textContent = text;
  saveState.className = `save-state ${type}`;
}

function markPdfOutdated() {
  albumLayout.generated = false;
  generatedSection.style.display = 'none';
  if (hadGeneratedPdf) {
    msg.innerHTML = '<div class="success-msg pdf-outdated">Vos modifications sont enregistrées. Cliquez sur « Régénérer le PDF » pour créer la nouvelle version.</div>';
    generateBtn.childNodes[0].textContent = 'Régénérer le PDF ';
  } else {
    msg.innerHTML = '';
  }
}

function findPhotoPosition(photoId) {
  for (let pageIndex = 0; pageIndex < albumLayout.pages.length; pageIndex++) {
    const photoIndex = albumLayout.pages[pageIndex].photos.findIndex((photo) => photo?.id === photoId);
    if (photoIndex !== -1) return { pageIndex, photoIndex };
  }
  return null;
}

function flatPhotos() {
  return albumLayout.pages.flatMap((page) => page.photos).filter(Boolean);
}

async function persistLayout() {
  updateSubtitle();
  setSaveState('Enregistrement…');
  const pages = albumLayout.pages.map((page) => ({
    type: page.type,
    photoIds: page.photos.map((photo) => photo?.id || null),
    elements: page.elements || [],
    backgroundColor: page.backgroundColor || '#ffffff',
  }));

  try {
    const res = await fetch('/api/admin/layout', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages,
        excludedPhotoIds: (albumLayout.excludedPhotos || []).map((photo) => photo.id),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "La mise en page n'a pas pu être enregistrée.");
    markPdfOutdated();
    setSaveState('Modifications enregistrées', 'is-saved');
  } catch (err) {
    setSaveState(err.message, 'is-error');
  }
}

function swapPhotos(firstId, secondId) {
  if (!firstId || !secondId || firstId === secondId) return;
  const first = findPhotoPosition(firstId);
  const second = findPhotoPosition(secondId);
  if (!first || !second) return;

  const firstPage = albumLayout.pages[first.pageIndex];
  const secondPage = albumLayout.pages[second.pageIndex];
  const temp = firstPage.photos[first.photoIndex];
  firstPage.photos[first.photoIndex] = secondPage.photos[second.photoIndex];
  secondPage.photos[second.photoIndex] = temp;
  renderPages();
  persistLayout();
}

function movePhoto(photoId, delta) {
  const photos = flatPhotos();
  const current = photos.findIndex((photo) => photo.id === photoId);
  const target = current + delta;
  if (current < 0 || target < 0 || target >= photos.length) return;
  swapPhotos(photoId, photos[target].id);
}

function movePhotoToSlot(photoId, pageIndex, slotIndex) {
  const source = findPhotoPosition(photoId);
  if (!source) return;
  const sourcePage = albumLayout.pages[source.pageIndex];
  const targetPage = albumLayout.pages[pageIndex];
  const targetPhoto = targetPage.photos[slotIndex];
  targetPage.photos[slotIndex] = sourcePage.photos[source.photoIndex];
  sourcePage.photos[source.photoIndex] = targetPhoto || null;
  renderPages();
  persistLayout();
}

function releasePhotoSlot(pageIndex, slotIndex) {
  const page = albumLayout.pages[pageIndex];
  const photo = page.photos[slotIndex];
  if (!photo) return;
  page.photos[slotIndex] = null;
  albumLayout.pages.push({
    type: 'feature',
    photos: [photo],
    elements: [],
    backgroundColor: '#ffffff',
  });
  renderPages();
  persistLayout();
}

function excludePhoto(pageIndex, slotIndex) {
  const page = albumLayout.pages[pageIndex];
  const photo = page.photos[slotIndex];
  if (!photo) return;
  page.photos[slotIndex] = null;
  albumLayout.excludedPhotos ||= [];
  if (!albumLayout.excludedPhotos.some((item) => item.id === photo.id)) albumLayout.excludedPhotos.push(photo);
  albumLayout.pages.forEach((item) => {
    item.elements = (item.elements || []).filter((element) => !(element.type === 'photo' && element.photoId === photo.id));
  });
  if (albumLayout.cover?.id === photo.id) albumLayout.cover = null;
  renderCover();
  renderPages();
  renderExcludedPhotos();
  updateSubtitle();
  persistLayout();
}

function restorePhoto(photoId) {
  const index = (albumLayout.excludedPhotos || []).findIndex((photo) => photo.id === photoId);
  if (index === -1) return;
  const [photo] = albumLayout.excludedPhotos.splice(index, 1);
  let restored = false;
  for (const page of albumLayout.pages) {
    const emptyIndex = page.photos.findIndex((item) => !item);
    if (emptyIndex !== -1) {
      page.photos[emptyIndex] = photo;
      restored = true;
      break;
    }
  }
  if (!restored) {
    albumLayout.pages.push({ type: 'feature', photos: [photo], elements: [], backgroundColor: '#ffffff' });
  }
  renderPages();
  renderExcludedPhotos();
  updateSubtitle();
  persistLayout();
}

function renderExcludedPhotos() {
  const photos = albumLayout.excludedPhotos || [];
  removedPhotos.hidden = photos.length === 0;
  removedCount.textContent = `${photos.length} photo${photos.length > 1 ? 's' : ''}`;
  removedPhotosGrid.innerHTML = '';
  photos.forEach((photo) => {
    const item = document.createElement('div');
    item.className = 'removed-photo-item';
    item.innerHTML = `<img src="/api/thumb/${photo.id}" alt="Photo retirée de ${photo.participantName}"><button type="button">Remettre</button>`;
    item.querySelector('button').addEventListener('click', () => restorePhoto(photo.id));
    removedPhotosGrid.appendChild(item);
  });
}

function updateSubtitle() {
  const totalPhotos = flatPhotos().length;
  const removed = (albumLayout.excludedPhotos || []).length;
  subtitle.textContent = `${albumLayout.pages.length + 1} pages · ${totalPhotos} photo${totalPhotos > 1 ? 's' : ''} dans l’album${removed ? ` · ${removed} retirée${removed > 1 ? 's' : ''}` : ''}.`;
}

function changePageGrid(pageIndex, size) {
  const page = albumLayout.pages[pageIndex];
  const currentSize = page.photos.length;
  if (currentSize === size) return;

  const prefix = albumLayout.pages.slice(0, pageIndex);
  const oldTail = albumLayout.pages.slice(pageIndex);
  const remainingPhotos = oldTail.flatMap((item) => item.photos).filter(Boolean);
  if (remainingPhotos.length < size) return;

  const firstPage = {
    type: size === 1 ? 'feature' : size === 4 ? 'quad' : 'six',
    photos: remainingPhotos.slice(0, size),
    elements: oldTail[0]?.elements || [],
    backgroundColor: oldTail[0]?.backgroundColor || '#ffffff',
  };
  let offset = size;
  const followingPages = planPageSizes(remainingPhotos.length - size).map((nextSize, nextIndex) => {
    const nextPage = {
      type: nextSize === 1 ? 'feature' : nextSize === 4 ? 'quad' : 'six',
      photos: remainingPhotos.slice(offset, offset + nextSize),
      elements: oldTail[nextIndex + 1]?.elements || [],
      backgroundColor: oldTail[nextIndex + 1]?.backgroundColor || '#ffffff',
    };
    offset += nextSize;
    return nextPage;
  });

  const rebuiltTail = [firstPage, ...followingPages];
  if (oldTail.length > rebuiltTail.length) {
    const lastPage = rebuiltTail[rebuiltTail.length - 1];
    oldTail.slice(rebuiltTail.length).forEach((oldPage) => {
      lastPage.elements.push(...(oldPage.elements || []));
    });
  }

  albumLayout.pages = [...prefix, ...rebuiltTail];
  renderPages();
  persistLayout();
}

function buildBox(photo, pageIndex, slotIndex) {
  const div = document.createElement('article');
  div.className = 'crop-box';
  div.dataset.photoId = photo.id;
  div.draggable = true;

  const img = document.createElement('img');
  img.className = 'crop-photo';
  img.src = `/api/thumb/${photo.id}?mode=full`;
  img.alt = `Photo envoyée par ${photo.participantName}`;
  img.draggable = false;

  const dot = document.createElement('span');
  dot.className = 'focal-dot';
  applyPhotoView(img, dot, photoValues(photo));
  div.append(img, dot);

  const chip = document.createElement('span');
  chip.className = 'name-chip';
  chip.textContent = photo.participantName;
  div.appendChild(chip);

  const actions = document.createElement('div');
  actions.className = 'photo-actions';
  actions.innerHTML = `
    <button type="button" class="photo-action move-prev" aria-label="Déplacer la photo vers la place précédente">←</button>
    <button type="button" class="photo-action edit-crop">Ajuster</button>
    <button type="button" class="photo-action free-slot" title="Créer un espace vide">Espace</button>
    <button type="button" class="photo-action exclude-photo" title="Retirer cette photo de l’album">Retirer</button>
    <button type="button" class="photo-action move-next" aria-label="Déplacer la photo vers la place suivante">→</button>
  `;
  actions.querySelector('.move-prev').addEventListener('click', (event) => {
    event.stopPropagation();
    movePhoto(photo.id, -1);
  });
  actions.querySelector('.move-next').addEventListener('click', (event) => {
    event.stopPropagation();
    movePhoto(photo.id, 1);
  });
  actions.querySelector('.edit-crop').addEventListener('click', (event) => {
    event.stopPropagation();
    openCropEditor(photo);
  });
  actions.querySelector('.free-slot').addEventListener('click', (event) => {
    event.stopPropagation();
    releasePhotoSlot(pageIndex, slotIndex);
  });
  actions.querySelector('.exclude-photo').addEventListener('click', (event) => {
    event.stopPropagation();
    excludePhoto(pageIndex, slotIndex);
  });
  div.appendChild(actions);

  div.addEventListener('dblclick', () => openCropEditor(photo));
  div.addEventListener('dragstart', (event) => {
    draggedPhotoId = photo.id;
    div.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', photo.id);
  });
  div.addEventListener('dragend', () => {
    draggedPhotoId = null;
    div.classList.remove('is-dragging');
  });
  div.addEventListener('dragover', (event) => {
    event.preventDefault();
    div.classList.add('is-drop-target');
  });
  div.addEventListener('dragleave', () => div.classList.remove('is-drop-target'));
  div.addEventListener('drop', (event) => {
    event.preventDefault();
    div.classList.remove('is-drop-target');
    swapPhotos(draggedPhotoId || event.dataTransfer.getData('text/plain'), photo.id);
  });

  return div;
}

function slotCenter(type, slotIndex) {
  if (type === 'feature') return { x: 0.5, y: 0.5 };
  const col = slotIndex % 2;
  const row = Math.floor(slotIndex / 2);
  if (type === 'quad') return { x: col ? 0.73 : 0.27, y: row ? 0.72 : 0.28 };
  return { x: col ? 0.73 : 0.27, y: [0.2, 0.5, 0.8][row] };
}

function buildEmptyBox(page, pageIndex, slotIndex) {
  const div = document.createElement('article');
  div.className = 'crop-box empty-slot';
  div.innerHTML = '<span>Emplacement libre</span><button type="button">+ Ajouter du texte ici</button>';
  div.querySelector('button').addEventListener('click', () => addText(pageIndex, slotCenter(page.type, slotIndex)));
  div.addEventListener('dragover', (event) => {
    event.preventDefault();
    div.classList.add('is-drop-target');
  });
  div.addEventListener('dragleave', () => div.classList.remove('is-drop-target'));
  div.addEventListener('drop', (event) => {
    event.preventDefault();
    div.classList.remove('is-drop-target');
    movePhotoToSlot(draggedPhotoId || event.dataTransfer.getData('text/plain'), pageIndex, slotIndex);
  });
  return div;
}

function addText(pageIndex, position = { x: 0.5, y: 0.18 }) {
  const text = window.prompt('Quel texte voulez-vous ajouter ?', 'Un beau souvenir…');
  if (!text?.trim()) return;
  const page = albumLayout.pages[pageIndex];
  page.elements ||= [];
  page.elements.push({
    id: makeId(), type: 'text', text: text.trim().slice(0, 240),
    x: position.x, y: position.y, size: 28, color: '#3a2415',
  });
  renderPages();
  persistLayout();
}

function addEmoji(pageIndex, position = { x: 0.5, y: 0.18 }) {
  const text = window.prompt('Quel emoji voulez-vous ajouter ?', '✨');
  if (!text?.trim()) return;
  const page = albumLayout.pages[pageIndex];
  page.elements ||= [];
  page.elements.push({
    id: makeId(), type: 'emoji', text: text.trim().slice(0, 24),
    x: position.x, y: position.y, size: 38,
  });
  renderPages();
  persistLayout();
}

function openMiniPhotoPicker(pageIndex) {
  decorationPageIndex = pageIndex;
  miniPhotoGrid.innerHTML = '';
  const photos = [...new Map(flatPhotos().map((photo) => [photo.id, photo])).values()];
  photos.forEach((photo) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-photo-option';
    button.innerHTML = `<img src="/api/thumb/${photo.id}" alt="Photo de ${photo.participantName}" loading="lazy"><span>${photo.participantName}</span>`;
    button.addEventListener('click', () => {
      const page = albumLayout.pages[decorationPageIndex];
      page.elements ||= [];
      page.elements.push({ id: makeId(), type: 'photo', photoId: photo.id, x: 0.5, y: 0.2, size: 0.22 });
      closeMiniPhotoPicker();
      renderPages();
      persistLayout();
    });
    miniPhotoGrid.appendChild(button);
  });
  miniPhotoDialog.hidden = false;
  document.body.classList.add('dialog-open');
}

function closeMiniPhotoPicker() {
  miniPhotoDialog.hidden = true;
  decorationPageIndex = null;
  if (dialog.hidden) document.body.classList.remove('dialog-open');
}

function editElement(pageIndex, element) {
  if (element.type === 'photo') return;
  const label = element.type === 'text' ? 'Modifiez votre texte' : 'Modifiez votre emoji';
  const next = window.prompt(label, element.text);
  if (!next?.trim()) return;
  element.text = next.trim().slice(0, element.type === 'text' ? 240 : 24);
  renderPages();
  persistLayout();
}

function resizeElement(pageIndex, element, direction) {
  if (element.type === 'photo') element.size = clamp((element.size || 0.22) + direction * 0.04, 0.1, 0.45);
  else element.size = clamp((element.size || 28) + direction * 4, 12, 72);
  renderPages();
  persistLayout();
}

function removeElement(pageIndex, elementId) {
  const page = albumLayout.pages[pageIndex];
  page.elements = (page.elements || []).filter((element) => element.id !== elementId);
  renderPages();
  persistLayout();
}

function buildDecoration(element, pageIndex, stage) {
  const item = document.createElement('div');
  item.className = `album-element element-${element.type}`;
  item.style.left = `${element.x * 100}%`;
  item.style.top = `${element.y * 100}%`;
  if (element.type === 'photo') item.style.width = `${(element.size || 0.22) * 100}%`;
  else item.style.fontSize = `${(element.size || 28) / 5.95}cqw`;

  if (element.type === 'photo') {
    const photo = flatPhotos().find((candidate) => candidate.id === element.photoId);
    if (!photo) return item;
    const img = document.createElement('img');
    img.src = `/api/thumb/${photo.id}?mode=full`;
    img.alt = 'Mini-photo décorative';
    img.draggable = false;
    item.appendChild(img);
  } else {
    const content = document.createElement('span');
    content.className = 'element-content';
    content.textContent = element.text;
    if (element.type === 'text') content.style.color = element.color || '#3a2415';
    item.appendChild(content);
  }

  const controls = document.createElement('div');
  controls.className = 'element-controls';
  controls.innerHTML = `
    <button type="button" data-action="smaller" aria-label="Réduire">−</button>
    <button type="button" data-action="larger" aria-label="Agrandir">+</button>
    ${element.type !== 'photo' ? '<button type="button" data-action="edit" aria-label="Modifier">Modifier</button>' : ''}
    <button type="button" data-action="delete" aria-label="Supprimer">×</button>
  `;
  controls.querySelector('[data-action="smaller"]').addEventListener('click', () => resizeElement(pageIndex, element, -1));
  controls.querySelector('[data-action="larger"]').addEventListener('click', () => resizeElement(pageIndex, element, 1));
  controls.querySelector('[data-action="edit"]')?.addEventListener('click', () => editElement(pageIndex, element));
  controls.querySelector('[data-action="delete"]').addEventListener('click', () => removeElement(pageIndex, element.id));
  if (element.type === 'text') {
    const color = document.createElement('input');
    color.type = 'color';
    color.value = element.color || '#3a2415';
    color.title = 'Couleur du texte';
    color.addEventListener('input', () => {
      element.color = color.value;
      item.querySelector('.element-content').style.color = color.value;
    });
    color.addEventListener('change', persistLayout);
    controls.prepend(color);
  }
  item.appendChild(controls);

  item.addEventListener('dblclick', () => editElement(pageIndex, element));
  item.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.element-controls')) return;
    item.setPointerCapture(event.pointerId);
    item.classList.add('is-moving');
  });
  item.addEventListener('pointermove', (event) => {
    if (!item.hasPointerCapture(event.pointerId)) return;
    const rect = stage.getBoundingClientRect();
    element.x = clamp((event.clientX - rect.left) / rect.width, 0.03, 0.97);
    element.y = clamp((event.clientY - rect.top) / rect.height, 0.03, 0.97);
    item.style.left = `${element.x * 100}%`;
    item.style.top = `${element.y * 100}%`;
  });
  item.addEventListener('pointerup', (event) => {
    if (!item.hasPointerCapture(event.pointerId)) return;
    item.releasePointerCapture(event.pointerId);
    item.classList.remove('is-moving');
    persistLayout();
  });
  return item;
}

function buildPage(page, pageNumber, pageIndex) {
  const wrap = document.createElement('section');
  let variant = 'feature';
  let label = 'Grande photo';
  if (page.type === 'quad') {
    variant = 'quad';
    label = 'Mosaïque · 4 photos';
  } else if (page.type === 'six') {
    variant = 'six';
    label = 'Mosaïque · 6 photos';
  }
  wrap.className = `layout-page ${variant}`;

  const header = document.createElement('div');
  header.className = 'page-heading';
  const labelEl = document.createElement('div');
  labelEl.className = 'page-label';
  labelEl.textContent = `Page ${pageNumber} · ${label}`;
  header.appendChild(labelEl);

  const gridPicker = document.createElement('div');
  gridPicker.className = 'grid-picker';
  const gridLabel = document.createElement('span');
  gridLabel.className = 'grid-picker-label';
  gridLabel.textContent = 'Grille';
  gridPicker.appendChild(gridLabel);

  const choices = document.createElement('div');
  choices.className = 'segmented compact';
  const availablePhotos = albumLayout.pages.slice(pageIndex).reduce(
    (total, item) => total + item.photos.filter(Boolean).length,
    0
  );
  [1, 4, 6].forEach((size) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(size);
    button.title = `Afficher ${size} photo${size > 1 ? 's' : ''} sur cette page`;
    button.setAttribute('aria-label', button.title);
    button.classList.toggle('is-active', page.photos.length === size);
    button.disabled = availablePhotos < size;
    button.addEventListener('click', () => changePageGrid(pageIndex, size));
    choices.appendChild(button);
  });
  gridPicker.appendChild(choices);
  const backgroundControl = document.createElement('label');
  backgroundControl.className = 'background-control';
  backgroundControl.innerHTML = '<span>Fond</span>';
  const backgroundInput = document.createElement('input');
  backgroundInput.type = 'color';
  backgroundInput.value = page.backgroundColor || '#ffffff';
  backgroundInput.title = 'Choisir la couleur de fond de cette page';
  backgroundInput.addEventListener('input', () => {
    page.backgroundColor = backgroundInput.value;
    wrap.querySelector('.page-stage').style.backgroundColor = backgroundInput.value;
  });
  backgroundInput.addEventListener('change', persistLayout);
  backgroundControl.appendChild(backgroundInput);

  const pageSettings = document.createElement('div');
  pageSettings.className = 'page-settings';
  pageSettings.append(gridPicker, backgroundControl);
  header.appendChild(pageSettings);

  wrap.appendChild(header);

  const toolbar = document.createElement('div');
  toolbar.className = 'page-tools';
  toolbar.innerHTML = `
    <span>Ajouter :</span>
    <button type="button" data-tool="text">T Texte</button>
    <button type="button" data-tool="emoji">😊 Emoji</button>
    <button type="button" data-tool="photo">▣ Petite photo</button>
  `;
  toolbar.querySelector('[data-tool="text"]').addEventListener('click', () => addText(pageIndex));
  toolbar.querySelector('[data-tool="emoji"]').addEventListener('click', () => addEmoji(pageIndex));
  toolbar.querySelector('[data-tool="photo"]').addEventListener('click', () => openMiniPhotoPicker(pageIndex));
  wrap.appendChild(toolbar);

  const stage = document.createElement('div');
  stage.className = 'page-stage';
  stage.style.backgroundColor = page.backgroundColor || '#ffffff';

  const boxes = document.createElement('div');
  boxes.className = 'boxes';
  page.photos.forEach((photo, slotIndex) => {
    boxes.appendChild(photo
      ? buildBox(photo, pageIndex, slotIndex)
      : buildEmptyBox(page, pageIndex, slotIndex));
  });
  stage.appendChild(boxes);

  const elements = document.createElement('div');
  elements.className = 'album-elements';
  (page.elements || []).forEach((element) => elements.appendChild(buildDecoration(element, pageIndex, stage)));
  stage.appendChild(elements);
  wrap.appendChild(stage);
  return wrap;
}

function renderPages() {
  layoutPagesEl.innerHTML = '';
  albumLayout.pages.forEach((page, index) => {
    if (page.photos.length > 0) layoutPagesEl.appendChild(buildPage(page, index + 2, index));
  });
}

function renderCover() {
  coverTitle.textContent = albumLayout.title;
  coverDate.textContent = new Date()
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .toUpperCase();

  if (!albumLayout.cover) {
    cover.classList.remove('has-photo');
    coverPhoto.removeAttribute('src');
    coverDot.hidden = true;
    coverEdit.hidden = true;
    coverEdit.onclick = null;
    return;
  }
  coverEdit.hidden = false;
  cover.classList.add('has-photo');
  coverPhoto.src = `/api/thumb/${albumLayout.cover.id}?mode=full`;
  coverPhoto.alt = 'Photo de couverture';
  applyPhotoView(coverPhoto, coverDot, photoValues(albumLayout.cover));
  coverEdit.onclick = () => openCropEditor(albumLayout.cover, true);
}

function updateCropEditor() {
  applyPhotoView(cropStagePhoto, cropStageDot, editorValues);
  cropMode.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === editorValues.mode);
  });
  cropZoom.value = editorValues.zoom;
  cropZoomValue.textContent = `${Math.round(editorValues.zoom * 100)} %`;
  const contained = editorValues.mode === 'contain';
  zoomField.classList.toggle('is-disabled', contained);
  cropZoom.disabled = contained;
  cropStageHelp.textContent = contained
    ? 'La photo entière sera visible, avec des marges si nécessaire'
    : 'Cliquez ou glissez sur le sujet à garder dans le cadre';
}

function openCropEditor(photo, isCover = false) {
  editingPhoto = photo;
  editorValues = photoValues(photo);
  dialogTitle.textContent = isCover ? 'Ajuster la couverture' : `Ajuster la photo de ${photo.participantName}`;
  cropStage.style.aspectRatio = getStageRatio(isCover ? null : albumLayout.pages[findPhotoPosition(photo.id)?.pageIndex]);
  cropStagePhoto.src = `/api/thumb/${photo.id}?mode=full`;
  cropMsg.innerHTML = '';
  dialog.hidden = false;
  document.body.classList.add('dialog-open');
  updateCropEditor();
  cropSave.focus();
}

function closeCropEditor() {
  dialog.hidden = true;
  document.body.classList.remove('dialog-open');
  editingPhoto = null;
  editorValues = null;
}

function setFocalFromPointer(event) {
  if (!editorValues || editorValues.mode === 'contain') return;
  const rect = cropStage.getBoundingClientRect();
  editorValues.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  editorValues.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  updateCropEditor();
}

cropStage.addEventListener('pointerdown', (event) => {
  if (editorValues?.mode === 'contain') return;
  cropStage.setPointerCapture(event.pointerId);
  setFocalFromPointer(event);
});
cropStage.addEventListener('pointermove', (event) => {
  if (cropStage.hasPointerCapture(event.pointerId)) setFocalFromPointer(event);
});
cropStage.addEventListener('pointerup', (event) => {
  if (cropStage.hasPointerCapture(event.pointerId)) cropStage.releasePointerCapture(event.pointerId);
});

cropMode.querySelectorAll('button').forEach((button) => {
  button.addEventListener('click', () => {
    editorValues.mode = button.dataset.mode;
    updateCropEditor();
  });
});

cropZoom.addEventListener('input', () => {
  editorValues.zoom = Number(cropZoom.value);
  updateCropEditor();
});

cropReset.addEventListener('click', () => {
  editorValues = { x: 0.5, y: 0.5, zoom: 1, mode: 'cover' };
  updateCropEditor();
});

cropSave.addEventListener('click', async () => {
  cropSave.disabled = true;
  cropMsg.innerHTML = '';
  try {
    const res = await fetch(`/api/photo/${editingPhoto.id}/crop`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editorValues),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Le cadrage n'a pas pu être enregistré.");

    Object.assign(editingPhoto, {
      cropX: editorValues.x,
      cropY: editorValues.y,
      cropZoom: editorValues.zoom,
      cropMode: editorValues.mode,
    });
    albumLayout.pages.flatMap((page) => page.photos)
      .filter((photo) => photo?.id === editingPhoto.id)
      .forEach((photo) => Object.assign(photo, editingPhoto));
    if (albumLayout.cover?.id === editingPhoto.id) Object.assign(albumLayout.cover, editingPhoto);

    markPdfOutdated();
    setSaveState('Cadrage enregistré', 'is-saved');
    renderPages();
    renderCover();
    closeCropEditor();
  } catch (err) {
    cropMsg.innerHTML = `<div class="error">${err.message}</div>`;
  } finally {
    cropSave.disabled = false;
  }
});

dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeCropEditor));
miniPhotoDialog.querySelectorAll('[data-close-mini-photo]').forEach((button) => button.addEventListener('click', closeMiniPhotoPicker));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!dialog.hidden) closeCropEditor();
  if (!miniPhotoDialog.hidden) closeMiniPhotoPicker();
});

async function load() {
  const res = await fetch('/api/admin/layout');
  const layout = await res.json();
  if (!layout.ready) {
    window.location.href = '/admin.html';
    return;
  }

  albumLayout = layout;
  albumLayout.excludedPhotos ||= [];
  hadGeneratedPdf = layout.generated;
  const pageFormatsChanged = normalizePageFormats();
  updateSubtitle();
  renderCover();
  renderPages();
  renderExcludedPhotos();
  if (pageFormatsChanged) persistLayout();
  if (layout.generated) generatedSection.style.display = 'block';
}

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  let restoredContent = generateBtn.innerHTML;
  generateBtn.innerHTML = '<span class="spinner"></span> Génération en cours...';
  msg.innerHTML = '';
  try {
    const res = await fetch('/api/admin/generate', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');
    albumLayout.generated = true;
    hadGeneratedPdf = true;
    restoredContent = restoredContent.replace('Régénérer le PDF', 'Générer le PDF');
    msg.innerHTML = '';
    generatedSection.style.display = 'block';
    generatedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    msg.innerHTML = `<div class="error">${err.message}</div>`;
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = restoredContent;
  }
});

sendBtn.addEventListener('click', async () => {
  sendBtn.disabled = true;
  const original = sendBtn.innerHTML;
  sendBtn.innerHTML = '<span class="spinner"></span> Envoi en cours...';
  sendMsg.innerHTML = '';
  try {
    const res = await fetch('/api/admin/send', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');
    window.location.href = '/album.html';
  } catch (err) {
    sendMsg.innerHTML = `<div class="error">${err.message}</div>`;
    sendBtn.disabled = false;
    sendBtn.innerHTML = original;
  }
});

load();
