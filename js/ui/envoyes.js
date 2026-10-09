// Plats déjà copiés pour Claude dans une demande de versions (T2b) : gardés sur le téléphone, par compte, 30 jours,
// pour qu'ils passent en fin de liste (coeur/compatibilite.js › platsSansVersion, option `envoyes`) et qu'un plat que
// Claude ne sait pas adapter ne revienne pas en tête à chaque lot. Simple confort : le stockage est partagé avec les
// autres sites du même domaine github.io, d'où le préfixe, et tout accès peut échouer (stockage plein ou bloqué) :
// l'ordre reste alors celui des notes.
// Le fichier garde aussi la version des instructions du projet Claude copiée en dernier (Réglages › Projet Claude),
// pour rappeler de les recopier quand elles changent.

const PREFIXE = 'repas-courses:envoyes:';
// Hors de PREFIXE : effacerEnvoyes ne la touche pas (une version d'instructions n'est pas une donnée personnelle).
const PREFIXE_INSTRUCTIONS = 'repas-courses:instructions-copiees:';
const DUREE_MAX_MS = 30 * 24 * 60 * 60 * 1000; // au-delà de 30 jours, un plat envoyé est oublié
const ENVOYES_MAX = 500;

const cle = (uid) => `${PREFIXE}${uid}`;

/** { platId: date d'envoi en ms } encore valables, ou {} (stockage abîmé ou inaccessible). */
function lire(uid, maintenant) {
  try {
    const brut = localStorage.getItem(cle(uid));
    if (brut === null) return {};
    let memo = null;
    try {
      memo = JSON.parse(brut);
    } catch {
      memo = null;
    }
    const envoyes = memo?.v === 1 && memo.envoyes && typeof memo.envoyes === 'object' && !Array.isArray(memo.envoyes)
      ? memo.envoyes
      : {};
    return Object.fromEntries(Object.entries(envoyes).filter(([id, depuis]) => id
      && typeof depuis === 'number' && Number.isFinite(depuis) && maintenant - depuis <= DUREE_MAX_MS && depuis <= maintenant));
  } catch {
    return {};
  }
}

/** Identifiants des plats envoyés à Claude par cette personne ces 30 derniers jours, du plus ancien au plus récent. */
export function lireEnvoyes(uid, { maintenant = Date.now() } = {}) {
  if (!uid) return [];
  return Object.entries(lire(uid, maintenant)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/** Retient les plats d'un lot copié pour Claude (date d'envoi remise à maintenant). Échec silencieux. */
export function noterEnvoyes(uid, platIds, { maintenant = Date.now() } = {}) {
  if (!uid || !Array.isArray(platIds) || !platIds.length) return;
  const envoyes = lire(uid, maintenant);
  for (const id of platIds) {
    if (typeof id !== 'string' || !id) continue;
    delete envoyes[id]; // remis à la fin, dans l'ordre d'envoi
    envoyes[id] = maintenant;
  }
  // Les plus anciens partent d'abord si la liste devient trop longue.
  const gardes = Object.entries(envoyes).sort((a, b) => a[1] - b[1]).slice(-ENVOYES_MAX);
  try {
    localStorage.setItem(cle(uid), JSON.stringify({ v: 1, envoyes: Object.fromEntries(gardes) }));
  } catch {
    // Stockage plein ou bloqué : l'ordre reste celui des notes.
  }
}

/** Oublie tous les plats envoyés (déconnexion). La version des instructions copiée reste (lireInstructionsCopiees). */
export function effacerEnvoyes() {
  try {
    const cles = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const nom = localStorage.key(i);
      if (nom?.startsWith(PREFIXE)) cles.push(nom);
    }
    for (const nom of cles) localStorage.removeItem(nom);
  } catch {
    // Rien à faire.
  }
}

/**
 * Version des instructions copiée en dernier par ce compte sur ce téléphone, ou null (jamais copiées, stockage abîmé
 * ou inaccessible).
 */
export function lireInstructionsCopiees(uid) {
  if (!uid) return null;
  try {
    const brut = localStorage.getItem(`${PREFIXE_INSTRUCTIONS}${uid}`);
    return typeof brut === 'string' && /^[1-9]\d{0,8}$/.test(brut) ? Number(brut) : null;
  } catch {
    return null;
  }
}

/** Retient la version copiée (après une copie réussie). Échec silencieux : le rappel reviendra. */
export function noterInstructionsCopiees(uid, version) {
  if (!uid || !Number.isInteger(version) || version < 1) return;
  try {
    localStorage.setItem(`${PREFIXE_INSTRUCTIONS}${uid}`, String(version));
  } catch {
    // Stockage plein ou bloqué : rien à faire.
  }
}

// Dernier lot de relecture des repères copié pour Claude (T2d) : ses identifiants, gardés deux jours sur ce téléphone,
// pour reconnaître des recettes entières rendues à la place d'une relecture (coeur/paquet.js › preparerImport, option
// `relectureEnCours`). Sous PREFIXE : effacé à la déconnexion avec les plats envoyés.
const cleRelecture = (uid) => `${PREFIXE}relecture:${uid}`;
const DUREE_RELECTURE_MS = 2 * 24 * 60 * 60 * 1000;

/** Identifiants du dernier lot de relecture copié par ce compte sur ce téléphone depuis moins de deux jours, ou []. */
export function lireRelectureEnCours(uid, { maintenant = Date.now() } = {}) {
  if (!uid) return [];
  try {
    const memo = JSON.parse(localStorage.getItem(cleRelecture(uid)) ?? 'null');
    if (memo?.v !== 1 || typeof memo.le !== 'number' || !Array.isArray(memo.ids)) return [];
    if (maintenant - memo.le > DUREE_RELECTURE_MS || memo.le > maintenant) return [];
    return memo.ids.filter((id) => typeof id === 'string' && id);
  } catch {
    return [];
  }
}

/** Retient le lot de relecture copié (remplace le précédent). Échec silencieux. */
export function noterRelectureEnCours(uid, platIds, { maintenant = Date.now() } = {}) {
  if (!uid || !Array.isArray(platIds)) return;
  const ids = platIds.filter((id) => typeof id === 'string' && id);
  try {
    localStorage.setItem(cleRelecture(uid), JSON.stringify({ v: 1, le: maintenant, ids }));
  } catch {
    // Stockage plein ou bloqué : des recettes entières rendues par erreur resteront un remplacement ordinaire.
  }
}
