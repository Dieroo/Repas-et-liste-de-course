// Rôles et accès aux écrans (CLAUDE.md §2). Logique pure : ni DOM ni Firebase.

export const ROUTE_PAR_DEFAUT = 'semaine';

// Écrans connus, et ceux réservés au gestionnaire.
const ROUTES = ['semaine', 'courses', 'plats', 'plat', 'decouvrir', 'reglages'];
const ROUTES_GESTIONNAIRE = ['reglages'];

/** Adresse comparable : sans espaces autour, en minuscules ; '' si absente. */
export function normaliserEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Rôle de la personne connectée, déduit de son adresse et de `reglages/foyer`.
 * → 'gestionnaire', 'courses', ou null si aucune adresse.
 */
export function roleDe(email, reglages) {
  const moi = normaliserEmail(email);
  if (!moi) return null;
  const gestionnaire = normaliserEmail(reglages?.gestionnaire);
  return gestionnaire !== '' && moi === gestionnaire ? 'gestionnaire' : 'courses';
}

/** Vrai tant que personne n'est gestionnaire (document absent, ou sans adresse) : écran de première ouverture. */
export function gestionnaireADesigner(reglages) {
  return normaliserEmail(reglages?.gestionnaire) === '';
}

/** Vrai si l'écran existe et que ce rôle peut l'ouvrir. */
export function routeAutorisee(route, role) {
  if (role !== 'gestionnaire' && role !== 'courses') return false;
  if (!ROUTES.includes(route)) return false;
  return !ROUTES_GESTIONNAIRE.includes(route) || role === 'gestionnaire';
}

/** Rôle sous lequel l'app s'affiche : le gestionnaire peut prévisualiser la vue « Repas et courses ». */
export function roleEffectif(role, apercu) {
  return role === 'gestionnaire' && apercu ? 'courses' : role;
}

/** Découpe un hash : « #/plat/gratin-dauphinois » → { route: 'plat', parametre: 'gratin-dauphinois' }. */
export function lireHash(hash) {
  const [route = '', parametre = ''] = String(hash ?? '').replace(/^#\/?/, '').split(/[?#]/)[0].split('/');
  let decode = parametre;
  try {
    decode = decodeURIComponent(parametre);
  } catch {
    // Paramètre mal encodé : gardé tel quel.
  }
  return { route, parametre: decode };
}

/** Écran à afficher pour un hash (« #/courses ») : l'écran demandé s'il est permis, sinon l'accueil. */
export function resoudreRoute(hash, role) {
  const { route, parametre } = lireHash(hash);
  // Fiche d'un plat : identifiant au format slug seulement (sinon la liste des plats).
  if (route === 'plat' && !/^[a-z0-9-]+$/.test(parametre)) return routeAutorisee('plats', role) ? 'plats' : ROUTE_PAR_DEFAUT;
  return routeAutorisee(route, role) ? route : ROUTE_PAR_DEFAUT;
}
