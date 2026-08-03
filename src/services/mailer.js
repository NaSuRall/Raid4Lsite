import nodemailer from 'nodemailer';

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 3;

export function getEmailStatus() {
  const hasUser = Boolean(process.env.SMTP_USER);
  const hasPass = Boolean(process.env.SMTP_PASS);
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || '';
  const configured = Boolean(process.env.SMTP_HOST && fromEmail && hasUser === hasPass);

  return {
    configured,
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    fromEmail: fromEmail || null,
  };
}

function getTransporter() {
  const options = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    pool: true,
    maxConnections: CONCURRENCY,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    options.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  return nodemailer.createTransport(options);
}

export async function verifyEmailConfiguration() {
  const status = getEmailStatus();
  if (!status.configured) return { ...status, verified: false, error: 'Configuration SMTP incomplète.' };

  const transporter = getTransporter();
  try {
    await transporter.verify();
    return { ...status, verified: true, error: null };
  } catch (error) {
    return { ...status, verified: false, error: publicError(error) };
  } finally {
    transporter.close();
  }
}

export async function sendAlbumEmails(participants, { title, albumUrl }) {
  return sendToParticipants(participants, (participant) => ({
    subject: `${title} est prêt !`,
    text: `Bonjour ${participant.name},\n\nL'album « ${title} » est prêt. Téléchargez le PDF et les photos ici : ${albumUrl}\n\nMerci d'avoir partagé vos photos !`,
    html: `
      <p>Bonjour ${escapeHtml(participant.name)},</p>
      <p>L'album <strong>${escapeHtml(title)}</strong> est prêt avec les photos de tout le monde.</p>
      <p><a href="${escapeHtml(albumUrl)}">Télécharger le PDF de l'album et toutes les photos</a></p>
      <p style="color:#645c50;font-size:13px">${escapeHtml(albumUrl)}</p>
      <p>Merci d'avoir partagé vos photos !</p>
    `,
  }));
}

export async function sendReminderEmails(participants, { tripName, homeUrl }) {
  return sendToParticipants(participants, (participant) => ({
    subject: `On attend vos photos pour ${tripName} !`,
    text: `Bonjour ${participant.name},\n\nPetit rappel : ajoutez vos photos pour « ${tripName} » ici : ${homeUrl}`,
    html: `
      <p>Bonjour ${escapeHtml(participant.name)},</p>
      <p>Petit rappel : l'album <strong>${escapeHtml(tripName)}</strong> se prépare et vos photos sont attendues.</p>
      <p><a href="${escapeHtml(homeUrl)}">Ajouter mes photos</a></p>
      <p style="color:#645c50;font-size:13px">${escapeHtml(homeUrl)}</p>
    `,
  }));
}

export async function sendTestEmail(to) {
  return sendToParticipants([{ name: 'Organisateur', email: to }], () => ({
    subject: 'Test email — Album Voyage',
    text: "Votre configuration SMTP fonctionne. L'envoi des emails de l'album est prêt.",
    html: '<p><strong>Bonne nouvelle :</strong> votre configuration SMTP fonctionne.</p><p>L’envoi des emails de l’album est prêt.</p>',
  }));
}

async function sendToParticipants(participants, buildMessage) {
  const status = getEmailStatus();
  if (!status.configured) {
    return { configured: false, sent: 0, failed: participants.length, errors: [], sentRecipients: [] };
  }

  const transporter = getTransporter();
  const fromName = (process.env.FROM_NAME || 'Album Voyage').replace(/[\r\n"]/g, '');
  const from = `"${fromName}" <${status.fromEmail}>`;
  const queue = [...participants];
  const sentRecipients = [];
  const errors = [];

  async function worker() {
    while (queue.length) {
      const participant = queue.shift();
      try {
        await sendWithRetry(transporter, { from, to: participant.email, ...buildMessage(participant) });
        sentRecipients.push({ name: participant.name, email: participant.email });
      } catch (error) {
        errors.push({ email: participant.email, error: publicError(error) });
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } finally {
    transporter.close();
  }

  return {
    configured: true,
    sent: sentRecipients.length,
    failed: errors.length,
    errors,
    sentRecipients,
  };
}

async function sendWithRetry(transporter, message) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await transporter.sendMail(message);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function publicError(error) {
  const code = error?.code ? `${error.code}: ` : '';
  return `${code}${error?.message || 'Erreur SMTP inconnue'}`.slice(0, 240);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
