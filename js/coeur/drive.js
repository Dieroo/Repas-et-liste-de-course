// Drive (T3b, CLAUDE.md §9.7) : l'adresse de recherche du site du drive du foyer, réglée une fois en collant l'adresse
// d'une vraie recherche du mot d'essai (« courgette »), et le lien de recherche de chaque produit. L'app ne lit jamais
// ces sites : elle ouvre seulement des liens (aucune API). Logique pure : ni DOM ni Firebase.
// - Le modèle garde l'adresse collée telle quelle, chaque occurrence du mot d'essai devenue `{q}` : un site qui répète
//   le terme (chemin et paramètre) reçoit le nouveau terme partout.
// - `https:` seulement : jamais `http:`, `javascript:` ni `data:`.
// - Aucune enseigne ni aucun magasin dans le code ni dans les tests (domaines fictifs : drive.exemple.fr) : le drive du
//   foyer est réglé dans l'app et vit dans Firestore (`reglages/foyer.drive`).
import { EFFACER } from './semaine.js';

/** Mot cherché sur le site du drive pour régler l'adresse ; il devient `{q}` dans le modèle. */
export const MOT_ESSAI = 'courgette';
/** Mot du lien « Essayer avec « beurre » › » de la feuille « Votre drive ». */
export const MOT_EXEMPLE = 'beurre';
/** Place du terme cherché dans le modèle d'adresse. */
export const JETON_RECHERCHE = '{q}';
/** Adresse collée : 500 caractères au plus. */
export const ADRESSE_MAX = 500;
/** Mot cherché au drive pour un produit (`produits/{id}.rechercheDrive`) : 60 caractères au plus. */
export const RECHERCHE_MAX = 60;
/** Nom du drive affiché (le domaine) : au-delà, il est recalculé depuis l'adresse. */
const NOM_MAX = 100;

/** Erreurs de modeleDrive, en mots de tous les jours (feuille « Votre drive »). */
export const ERREURS_DRIVE = Object.freeze({
  vide: 'Collez l’adresse de la page des résultats.',
  https: 'Cette adresse doit commencer par https://.',
  absent: `Le mot «\u00A0${MOT_ESSAI}\u00A0» n’est pas dans cette adresse. Cherchez-le sur le site, puis recopiez l’adresse.`,
  longue: 'Cette adresse est trop longue\u00A0: recopiez celle de la page des résultats.',
});

/** « ✓ C'est bon : l'app cherchera chaque produit à la place de « courgette ». » (adresse valide). */
export const TEXTE_DRIVE_VALIDE = `✓ C’est bon\u00A0: l’app cherchera chaque produit à la place de «\u00A0${MOT_ESSAI}\u00A0».`;

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');
/** Blancs et caractères de contrôle : jamais dans une adresse gardée telle quelle (le navigateur les retirerait). */
const BLANCS = /[\s\u0000-\u001F\u007F]/;
const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Le mot d'essai, au singulier ou au pluriel, en clair ou encodé, casse ignorée, comme mot entier : ni lettre ni
 * chiffre autour, mais un caractère encodé (« %22courgette%22 ») compte comme une limite. « mini-courgettes » le
 * contient, « courgettesbio » non.
 */
const MOT = (() => {
  const formes = [...new Set([MOT_ESSAI, encodeURIComponent(MOT_ESSAI)])].map(echapper).join('|');
  return new RegExp(`(?:(?<=%[0-9A-Fa-f]{2})|(?<![\\p{L}\\p{N}]))(?:${formes})s?(?![\\p{L}\\p{N}])`, 'giu');
})();

/** Vrai pour une adresse https: que le navigateur lit, avec un domaine, sans identifiant ni blanc. */
function httpsValide(adresse) {
  if (typeof adresse !== 'string' || !/^https:\/\//i.test(adresse) || BLANCS.test(adresse)) return false;
  try {
    const url = new URL(adresse);
    return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Domaine d'une adresse, sans « www. » (« drive.exemple.fr ») ; '' si elle est illisible. */
function domaineDe(adresse) {
  try {
    return new URL(adresse).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Adresse collée (la page des résultats de « courgette » sur le site du drive) → { modele, nom } | { erreur: 'vide' |
 * 'https' | 'absent' | 'longue' } (ERREURS_DRIVE) :
 * - espaces autour retirés ; un texte collé autour de l'adresse est écarté (la première adresse `https://` est lue) ;
 * - 500 caractères au plus ('longue') ; `https:` seulement ('https' : `http:`, `javascript:`, adresse illisible) ;
 * - toutes les occurrences du mot d'essai (singulier ou pluriel, en clair ou encodé, casse ignorée, mot entier) après
 *   le domaine deviennent `{q}` ('absent' s'il n'y en a aucune) ; le reste de l'adresse est gardé tel quel ;
 * - `nom` : le domaine sans « www. » (« drive.exemple.fr »).
 */
export function modeleDrive(adresse) {
  const texte = typeof adresse === 'string' ? adresse.trim() : '';
  if (!texte) return { erreur: 'vide' };
  if (texte.length > 4 * ADRESSE_MAX) return { erreur: 'longue' };
  const trouvee = /^https:\/\//i.test(texte) ? texte.split(/\s/)[0] : texte.match(/https:\/\/[^\s<>"']+/i)?.[0] ?? null;
  if (!trouvee) return { erreur: 'https' };
  if (trouvee.length > ADRESSE_MAX) return { erreur: 'longue' };
  if (!httpsValide(trouvee)) return { erreur: 'https' };
  // Le domaine reste tel quel : seul ce qui suit (chemin, paramètres, ancre) peut porter le terme cherché.
  const fin = trouvee.slice('https://'.length).search(/[/?#]/);
  const coupure = fin < 0 ? trouvee.length : 'https://'.length + fin;
  const [site, suite] = [trouvee.slice(0, coupure), trouvee.slice(coupure)];
  MOT.lastIndex = 0;
  if (!MOT.test(suite)) return { erreur: 'absent' };
  MOT.lastIndex = 0;
  return { modele: `${site}${suite.replace(MOT, JETON_RECHERCHE)}`, nom: domaineDe(trouvee) };
}

/**
 * Lien de recherche d'un produit : chaque `{q}` du modèle → encodeURIComponent(terme) (« crème fraîche » →
 * « cr%C3%A8me%20fra%C3%AEche »). null si le modèle n'est pas une adresse https: valide qui contient `{q}`, ou si le
 * terme est vide.
 */
export function lienDrive(modele, terme) {
  if (typeof modele !== 'string' || !modele.includes(JETON_RECHERCHE)) return null;
  const mot = reduire(terme);
  if (!mot) return null;
  const lien = modele.split(JETON_RECHERCHE).join(encodeURIComponent(mot));
  return httpsValide(lien) ? lien : null;
}

/**
 * Drive du foyer lu dans `reglages/foyer.drive` → { nom, urlRecherche } | null : modèle https: avec `{q}`, de 500
 * caractères au plus ; `nom` : celui qui est écrit, sinon le domaine de l'adresse.
 */
export function lireDrive(valeur) {
  if (!estObjet(valeur)) return null;
  const urlRecherche = typeof valeur.urlRecherche === 'string' ? valeur.urlRecherche.trim() : '';
  if (!urlRecherche || urlRecherche.length > ADRESSE_MAX || lienDrive(urlRecherche, MOT_EXEMPLE) === null) return null;
  const ecrit = reduire(valeur.nom);
  const nom = ecrit && ecrit.length <= NOM_MAX ? ecrit : domaineDe(urlRecherche);
  return { nom, urlRecherche };
}

/**
 * Écriture du drive dans `reglages/foyer` (`update` du seul champ `drive`) → { champs: { drive: { nom, urlRecherche } } }
 * (« Enregistrer », ou « Annuler » de « Ne plus chercher au drive » avec le drive d'avant) ; `null` → { champs: { drive:
 * EFFACER } } (« Ne plus chercher au drive ») ; { code: 'invalide' } pour un drive illisible (lireDrive).
 */
export function ecrituresDrive(drive) {
  if (drive === null) return { champs: { drive: EFFACER } };
  const lu = lireDrive(drive);
  return lu ? { champs: { drive: lu } } : { code: 'invalide' };
}

/** Mode de Courses retenu sur le téléphone pour ce compte : 'drive' (d'avance) ou 'magasin'. */
export const MODES_COURSES = Object.freeze(['drive', 'magasin']);
/** Retour du drive : l'app redevient visible moins de 15 minutes après un 🔍. */
export const RETOUR_DRIVE_MINUTES = 15;
/** Mode Magasin : l'écran reste allumé, rendu après 10 minutes sans toucher dans Courses. */
export const ECRAN_ALLUME_MINUTES = 10;
const MINUTE_MS = 60_000;

/** Clé `localStorage` du mode de Courses (`repas-courses:mode-courses:<uid>`) ; '' sans compte lisible. */
export function cleModeCourses(uid) {
  return typeof uid === 'string' && uid.trim() !== '' ? `repas-courses:mode-courses:${uid.trim()}` : '';
}

/** Mode lu sur le téléphone : 'magasin' seulement s'il a été choisi, sinon 'drive' (d'avance, décision 17). */
export function lireModeCourses(valeur) {
  return valeur === 'magasin' ? 'magasin' : 'drive';
}

/**
 * Vrai si l'app redevient visible moins de RETOUR_DRIVE_MINUTES après un 🔍 (`ouvertLe`, `maintenant` : heures du
 * téléphone, en millisecondes) : la ligne revient à l'écran, avec « Pas le bon produit ? ». Jamais cochée d'office.
 */
export function retourDuDrive(ouvertLe, maintenant) {
  if (!Number.isFinite(ouvertLe) || !Number.isFinite(maintenant)) return false;
  const ecart = maintenant - ouvertLe;
  return ecart >= 0 && ecart < RETOUR_DRIVE_MINUTES * MINUTE_MS;
}

/** Vrai si l'écran allumé du mode Magasin doit être rendu : ECRAN_ALLUME_MINUTES sans toucher (ou plus). */
export function ecranAEteindre(dernierToucher, maintenant) {
  if (!Number.isFinite(dernierToucher) || !Number.isFinite(maintenant)) return true;
  return maintenant - dernierToucher >= ECRAN_ALLUME_MINUTES * MINUTE_MS;
}

/** Textes fixes du mode Drive, de la feuille « Votre drive » et de « Au drive, je cherche » (plan §4.2.c). */
export const TEXTES_DRIVE = Object.freeze({
  drive: '🚗 Drive',
  magasin: '🛒 Magasin',
  aide: 'Touchez 🔍 pour chercher le produit au drive, puis cochez-le.',
  horsLigne: 'Hors ligne\u00A0: la recherche au drive attend le réseau. Vous pouvez cocher.',
  pourCetteSemaine: 'Pour cette semaine',
  commeChaqueSemaine: 'Comme chaque semaine',
  pasLeBonProduit: 'Pas le bon produit\u00A0?',
  changerLeMot: 'Changer le mot cherché',
  aRegler: 'Pour chercher chaque produit au drive d’un toucher, réglez votre drive une fois.',
  regler: 'Régler le drive',
  titre: 'Votre drive',
  etape1: `Ouvrez le site de votre drive dans Chrome, choisissez votre magasin, puis cherchez «\u00A0${MOT_ESSAI}\u00A0».`,
  etape2: 'Copiez l’adresse de la page des résultats, en haut de Chrome, puis collez-la ici.',
  champ: 'Adresse de la page des résultats',
  coller: '📋 Coller',
  essayer: `Essayer avec «\u00A0${MOT_EXEMPLE}\u00A0» ›`,
  enregistrer: 'Enregistrer',
  changer: 'Changer',
  arreter: 'Ne plus chercher au drive',
  titreMot: 'Au drive, je cherche',
  aideMot: 'Le mot qui trouve le bon produit sur le site de votre drive\u00A0: «\u00A0penne\u00A0» plutôt que «\u00A0pâtes '
    + 'courtes\u00A0». Il servira les semaines suivantes.',
  serviraSuivantes: 'Il servira les semaines suivantes.',
});

/** Bouton texte de la feuille « Au drive, je cherche » : « Revenir à « pâtes courtes » ». */
export function texteRevenirA(nom) {
  return `Revenir à «\u00A0${reduire(nom)}\u00A0»`;
}

/** Ligne de la feuille d'un article (⋮) : « Au drive, je cherche : « pâtes courtes » ». */
export function texteJeCherche(terme) {
  return `Au drive, je cherche\u00A0: «\u00A0${reduire(terme)}\u00A0»`;
}

/** Nom accessible du bouton 🔍 : « Chercher « pâtes courtes » sur drive.exemple.fr ». */
export function texteChercher(terme, nom) {
  const site = reduire(nom);
  return `Chercher «\u00A0${reduire(terme)}\u00A0»${site ? ` sur ${site}` : ' au drive'}`;
}

/** « Votre drive : drive.exemple.fr ». */
export function texteVotreDrive(nom) {
  return `Votre drive\u00A0: ${reduire(nom)}`;
}

/** Annonce de « Au drive, je cherche » : « C'est noté : « penne » servira les prochaines fois. ». */
export function texteMotNote(terme) {
  return `C’est noté\u00A0: «\u00A0${reduire(terme)}\u00A0» servira les prochaines fois.`;
}
