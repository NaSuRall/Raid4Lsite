const participant = JSON.parse(localStorage.getItem('participant') || 'null');

if (!participant || !participant.id) {
  window.location.href = '/';
}

const count = Number(localStorage.getItem('lastUploadCount') || '0');
const rejected = Number(localStorage.getItem('lastUploadRejected') || '0');

document.getElementById('title').textContent = `C'est envoyé, merci ${participant.name} !`;
document.getElementById('subtitle').innerHTML = count > 1
  ? `Vos <strong>${count} photos</strong> ont bien été ajoutées à l'album.`
  : count === 1
    ? `Votre <strong>1 photo</strong> a bien été ajoutée à l'album.`
    : 'Vos photos ont bien été ajoutées à l\'album.';

if (rejected > 0) {
  const warning = document.getElementById('upload-warning');
  warning.hidden = false;
  warning.textContent = `${rejected} fichier${rejected > 1 ? 's' : ''} ignoré${rejected > 1 ? 's' : ''} (doublon ou image illisible).`;
}

localStorage.removeItem('lastUploadCount');
localStorage.removeItem('lastUploadRejected');
