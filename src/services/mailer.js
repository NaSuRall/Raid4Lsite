import nodemailer from 'nodemailer';

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendAlbumEmails(participants, { title, albumUrl }) {
  if (!isConfigured()) {
    return { configured: false, sent: 0, failed: 0, errors: [] };
  }

  const transporter = getTransporter();
  const fromName = process.env.FROM_NAME || 'Album Voyage';
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;

  let sent = 0;
  const errors = [];

  for (const participant of participants) {
    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: participant.email,
        subject: `${title} est pret !`,
        html: `
          <p>Bonjour ${escapeHtml(participant.name)},</p>
          <p>L'album <strong>${escapeHtml(title)}</strong> vient d'etre genere avec les photos de tout le monde !</p>
          <p><a href="${albumUrl}">Cliquez ici pour telecharger le PDF de l'album et le ZIP de toutes les photos</a></p>
          <p>${albumUrl}</p>
          <p>Merci d'avoir partage vos photos !</p>
        `,
      });
      sent++;
    } catch (err) {
      errors.push({ email: participant.email, error: err.message });
    }
  }

  return { configured: true, sent, failed: errors.length, errors };
}

export async function sendReminderEmails(participants, { tripName, homeUrl }) {
  if (!isConfigured()) {
    return { configured: false, sent: 0, failed: 0, errors: [] };
  }

  const transporter = getTransporter();
  const fromName = process.env.FROM_NAME || 'Album Voyage';
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;

  let sent = 0;
  const errors = [];

  for (const participant of participants) {
    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: participant.email,
        subject: `On attend vos photos pour ${tripName} !`,
        html: `
          <p>Bonjour ${escapeHtml(participant.name)},</p>
          <p>Petit rappel : l'album <strong>${escapeHtml(tripName)}</strong> se prepare bientot et vous n'avez pas encore depose de photos.</p>
          <p><a href="${homeUrl}">Cliquez ici pour ajouter vos photos</a></p>
          <p>${homeUrl}</p>
        `,
      });
      sent++;
    } catch (err) {
      errors.push({ email: participant.email, error: err.message });
    }
  }

  return { configured: true, sent, failed: errors.length, errors };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

export { isConfigured };
