const participant = JSON.parse(localStorage.getItem('participant') || 'null');

if (!participant || !participant.id) {
  window.location.href = '/';
}

const count = Number(localStorage.getItem('lastUploadCount') || '0');

document.getElementById('title').textContent = `C'est envoyé, merci ${participant.name} !`;
document.getElementById('subtitle').innerHTML = count > 1
  ? `Vos <strong>${count} photos</strong> ont bien été ajoutées à l'album.`
  : count === 1
    ? `Votre <strong>1 photo</strong> a bien été ajoutée à l'album.`
    : 'Vos photos ont bien été ajoutées à l\'album.';

localStorage.removeItem('lastUploadCount');
