(async function () {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    document.querySelectorAll('[data-trip-name]').forEach((el) => {
      el.textContent = cfg.tripName;
    });
    const inline = document.getElementById('trip-name-inline');
    if (inline) inline.textContent = cfg.tripName;
    window.__tripName = cfg.tripName;
  } catch (e) {
    // config indisponible, on garde les valeurs par defaut affichees dans le HTML
  }
})();
