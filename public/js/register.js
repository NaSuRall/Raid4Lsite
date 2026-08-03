const form = document.getElementById('register-form');
const msg = document.getElementById('msg');
const submitBtn = document.getElementById('submit-btn');
const submitBtnOriginal = submitBtn.innerHTML;

const existing = JSON.parse(localStorage.getItem('participant') || 'null');
if (existing) {
  document.getElementById('name').value = existing.name || '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.innerHTML = '';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Un instant...';

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Une erreur est survenue.');
    }

    localStorage.setItem('participant', JSON.stringify({ id: data.id, name: data.name }));
    window.location.href = '/upload.html';
  } catch (err) {
    msg.innerHTML = `<div class="error">${err.message}</div>`;
    submitBtn.disabled = false;
    submitBtn.innerHTML = submitBtnOriginal;
  }
});
