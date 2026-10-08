// Plats déjà copiés pour Claude dans une demande de versions (T2b) : gardés sur le téléphone, par compte, 30 jours,
// pour qu'ils passent en fin de liste (coeur/compatibilite.js › platsSansVersion, option `envoyes`) et qu'un plat que
// Claude ne sait pas adapter ne revienne pas en tête à chaque lot. Simple confort : le stockage est partagé avec les
// autres sites du même domaine github.io, d'où le préfixe, et tout accès peut échouer (stockage plein ou bloqué) :
// l'ordre reste alors celui des notes.

const PREFIXE = 'repas-courses:envoyes:';
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

/** Oublie tous les plats envoyés (déconnexion) : rien ne reste sur le téléphone. */
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
