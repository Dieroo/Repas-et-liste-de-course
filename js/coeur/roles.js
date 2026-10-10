// Rôles et accès aux écrans (CLAUDE.md §2). Logique pure : ni DOM ni Firebase.

export const ROUTE_PAR_DEFAUT = 'semaine';

// Écrans connus, et ceux réservés au gestionnaire.
const ROUTES = ['semaine', 'courses', 'plats', 'plat', 'modifier', 'decouvrir', 'reglages', 'import', 'restaurer', 'regime',
  'demandes'];
const ROUTES_GESTIONNAIRE = ['reglages', 'import', 'restaurer', 'regime', 'demandes'];

// Écrans qui reçoivent un identifiant : « #/plat/<id> » et « #/modifier/<id> » (plat, obligatoire),
// « #/import/<id> » (plat, facultatif), « #/regime/<profilId> » (profil, obligatoire).
export const ROUTES_AVEC_PARAMETRE = ['plat', 'modifier', 'import', 'regime'];
const ROUTES_PARAMETRE_OBLIGATOIRE = ['plat', 'modifier', 'regime'];
// Écran de repli quand l'identifiant obligatoire manque : la liste d'où l'on vient.
const REPLI = { plat: 'plats', modifier: 'plats', regime: 'reglages' };
const PARAMETRE_VALIDE = /^[a-z0-9-]+$/;

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

/**
 * Écran à afficher pour un hash (« #/courses ») : l'écran demandé s'il est permis, sinon l'accueil.
 * `profils` (facultatif) : profils connus ; « #/regime/<id> » d'un profil absent retombe alors sur Réglages.
 */
export function resoudreRoute(hash, role, { profils = null } = {}) {
  const { route, parametre } = lireHash(hash);
  // Fiche d'un plat, sa modification, régime d'un profil : identifiant au format slug seulement (sinon la liste).
  const inconnu = route === 'regime' && Array.isArray(profils) && !profils.some((p) => p?.id === parametre);
  if (ROUTES_PARAMETRE_OBLIGATOIRE.includes(route) && (!PARAMETRE_VALIDE.test(parametre) || inconnu)) {
    if (!routeAutorisee(route, role)) return ROUTE_PAR_DEFAUT;
    return routeAutorisee(REPLI[route], role) ? REPLI[route] : ROUTE_PAR_DEFAUT;
  }
  return routeAutorisee(route, role) ? route : ROUTE_PAR_DEFAUT;
}

/** Paramètre retenu pour un écran : l'identifiant du plat (ou du profil) s'il est valide, sinon ''. */
export function parametreDe(hash, route) {
  if (!ROUTES_AVEC_PARAMETRE.includes(route)) return '';
  const { route: demandee, parametre } = lireHash(hash);
  return demandee === route && PARAMETRE_VALIDE.test(parametre) ? parametre : '';
}
