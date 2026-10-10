// Notification ntfy (CLAUDE.md §7, T2e) : sujet du foyer, texte et adresse du message, lien d'abonnement, issue d'un
// envoi et phrases de l'essai de Réglages. Logique pure : ni DOM, ni Firebase, ni réseau (l'envoi vit dans
// js/notifications.js). Rien sur les profils n'entre ici : ni adresse, ni prénom, ni identifiant de profil, ni âge,
// ni date ; seuls le type de la demande et le nom du plat font le message.

export const SERVEUR_NTFY = 'https://ntfy.sh/';
export const TITRE_NOTIFICATION = 'Repas & Courses';
export const ETIQUETTE_NOTIFICATION = 'mailbox_with_mail'; // affichée 📬 par l'app ntfy
export const PRIORITE_NOTIFICATION = 4; // haute : bandeau, et message mieux livré téléphone en veille
export const PREFIXE_SUJET = 'repas-';
export const SIGNES_SUJET = 24;
// 32 signes, sans « l », « o », « 0 » ni « 1 » : rien à confondre si l'on doit relire le sujet.
export const ALPHABET_SUJET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const LIEN_INSTALLER_NTFY = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy';
export const NOM_PLAT_MAX = 80;

// Sujet accepté par ntfy (nom de sujet du serveur).
const SUJET_VALIDE = /^[-_A-Za-z0-9]{1,64}$/;

const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');

/** Vrai pour un sujet que ntfy accepte : /^[-_A-Za-z0-9]{1,64}$/. */
export function sujetValide(sujet) {
  return typeof sujet === 'string' && SUJET_VALIDE.test(sujet);
}

/**
 * Nouveau sujet : PREFIXE_SUJET suivi de 24 signes de ALPHABET_SUJET, un par octet (`octet & 31` : 256 est un
 * multiple de 32, aucun biais). `octets` : Uint8Array de crypto.getRandomValues (l'écran le fournit : la fonction reste
 * testable). null s'il y a moins de 24 octets, ou si l'un d'eux n'est pas un entier de 0 à 255.
 */
export function nouveauSujet(octets) {
  if (!octets || typeof octets !== 'object' || !Number.isInteger(octets.length) || octets.length < SIGNES_SUJET) return null;
  let signes = '';
  for (let i = 0; i < SIGNES_SUJET; i += 1) {
    const octet = octets[i];
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    signes += ALPHABET_SUJET[octet & 31];
  }
  return `${PREFIXE_SUJET}${signes}`;
}

/** Nom du plat pour le message : espaces resserrés, coupé à NOM_PLAT_MAX caractères, « … » compris. */
function nomCourt(nomPlat) {
  const signes = Array.from(reduire(nomPlat)); // par caractère : un emoji n'est jamais coupé en deux
  if (signes.length <= NOM_PLAT_MAX) return signes.join('');
  return `${signes.slice(0, NOM_PLAT_MAX - 1).join('').trimEnd()}…`;
}

/**
 * Corps du message. `type` : 'recette' | 'variante' | 'essai' ; '' si inconnu. Nom du plat réduit (espaces), coupé à
 * NOM_PLAT_MAX (« … ») ; nom vide : « Recette à ajouter », « Version à ajouter », sans deux-points. Jamais de prénom
 * (décision 1 de T2e) : tout autre champ reçu est ignoré.
 */
export function texteNotification({ type, nomPlat = '' } = {}) {
  if (type === 'essai') return 'Essai\u00A0: les demandes arriveront ici.';
  const debut = { recette: 'Recette à ajouter', variante: 'Version à ajouter' }[type];
  if (typeof debut !== 'string') return '';
  const nom = nomCourt(nomPlat);
  return nom ? `${debut}\u00A0: ${nom}` : debut;
}

/**
 * Adresse du POST : 'https://ntfy.sh/<sujet>?title=Repas%20%26%20Courses&tags=mailbox_with_mail&priority=4' suivie de
 * '&click=<lien encodé>' (le « # » du lien devient « %23 ») ; `click` omis si `lien` est vide ; jamais d'autre
 * paramètre (options lues par ntfy dans l'adresse : aucun en-tête posé par l'app, donc aucune pré-vérification CORS).
 * null si le sujet n'est pas valide.
 */
export function adresseNotification(sujet, { lien = '' } = {}) {
  if (!sujetValide(sujet)) return null;
  let adresse = `${SERVEUR_NTFY}${sujet}?title=${encodeURIComponent(TITRE_NOTIFICATION)}`
    + `&tags=${ETIQUETTE_NOTIFICATION}&priority=${PRIORITE_NOTIFICATION}`;
  const clic = typeof lien === 'string' ? lien.trim() : '';
  if (clic) adresse += `&click=${encodeURIComponent(clic)}`;
  return adresse;
}

/** Lien qui ouvre l'app ntfy et l'abonne au sujet : 'ntfy://ntfy.sh/<sujet>?display=Repas%20%26%20Courses' ; null si
 *  le sujet n'est pas valide. */
export function lienAbonnement(sujet) {
  if (!sujetValide(sujet)) return null;
  return `ntfy://ntfy.sh/${sujet}?display=${encodeURIComponent(TITRE_NOTIFICATION)}`;
}

/**
 * Issue d'un envoi, d'après ce que rend js/notifications.js › envoyerNtfy ({ ok, statut } ou { erreur }) :
 * { code: 'ok' } (2xx) | { code: 'quota' } (429) | { code: 'panne', statut } (≥ 500) | { code: 'refus', statut }
 * (autre statut) | { code: 'reseau' } (erreur, ou réponse sans statut lisible ni `ok`).
 */
export function issueEnvoi(reponse) {
  if (!reponse || typeof reponse !== 'object' || reponse.erreur) return { code: 'reseau' };
  const { statut } = reponse;
  if (Number.isInteger(statut) && statut >= 100 && statut <= 599) {
    if (statut >= 200 && statut < 300) return { code: 'ok' };
    if (statut === 429) return { code: 'quota' };
    if (statut >= 500) return { code: 'panne', statut };
    return { code: 'refus', statut };
  }
  return reponse.ok === true ? { code: 'ok' } : { code: 'reseau' };
}

/**
 * Phrase de la carte « 🔔 Notifications » après « Envoyer un essai », pour chaque issue (issueEnvoi), plus
 * { code: 'attente' } (pas de réponse au bout de 15 s). Aucune ne conseille de changer de sujet : le sujet, créé par
 * l'app et vérifié avant l'envoi, n'est jamais la cause. '' pour une issue inconnue.
 */
export function texteEssai(issue) {
  switch (issue?.code) {
    case 'ok':
      return 'Message envoyé. Il arrive dans ntfy d’ici quelques secondes. Sinon, vérifiez l’abonnement dans ntfy, et '
        + 'dans les réglages d’Android que ntfy a le droit d’envoyer des notifications.';
    case 'quota':
      return 'ntfy.sh refuse d’autres messages aujourd’hui depuis ce réseau. Réessayez plus tard, ou en 4G.';
    case 'panne':
      return 'ntfy.sh ne répond pas pour le moment. Réessayez dans quelques minutes.';
    case 'refus': {
      if (!Number.isInteger(issue.statut)) return 'ntfy.sh a refusé le message. Votre sujet n’est pas en cause.';
      return `ntfy.sh a refusé le message (code ${issue.statut}). Votre sujet n’est pas en cause\u00A0: notez ce code pour `
        + 'Claude Code.';
    }
    case 'reseau':
      return 'Le message n’est pas parti. Vérifiez le réseau et réessayez.';
    case 'attente':
      return 'Pas encore de réponse de ntfy.sh. Vérifiez le réseau\u00A0; si le message arrive quand même, tout va bien.';
    default:
      return '';
  }
}
