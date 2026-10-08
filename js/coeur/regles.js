// Règles d'un profil (CLAUDE.md §7) : régime choisi à l'écran « Ce que <Prénom> mange », validation des règles
// venues d'un fichier, description pour Claude. Logique pure : ni DOM ni Firebase.
// Le modèle du §7 reste entier : toute règle valide est gardée, même d'un type que T2 n'évalue pas.
import { slug } from './slug.js';
import { VIANDES, VOCABULAIRES, code } from './vocabulaire.js';
import { deNom } from './notes.js';
import { typeDe } from './plats.js';

export const REGIMES = {
  tout: { libelle: 'Mange de tout', emoji: '🍽️' },
  sans_viande: { libelle: 'Pas de viande', emoji: '🐟', aide: 'Poisson et fruits de mer, oui.' },
  sans_viande_ni_poisson: { libelle: 'Ni viande ni poisson', emoji: '🥦' },
};

// « Mange quand même : » ; décochées par défaut ; hors « Mange de tout ».
export const PRECISIONS = [
  { id: 'charcuterie', libelle: 'De la charcuterie (jambon, lardons…)', marqueur: 'charcuterie', effet: 'sauf' },
  { id: 'bouillon', libelle: 'Des plats cuits avec un bouillon de viande', marqueur: 'bouillon_viande', effet: 'retire' },
  { id: 'gelatine', libelle: 'Des desserts à la gélatine', marqueur: 'gelatine_animale', effet: 'retire' },
  { id: 'graisse', libelle: 'De la graisse animale (saindoux, graisse de canard)', marqueur: 'graisse_animale', effet: 'retire' },
];

export const ID_REGIME = 'regime';
export const REGLES_MAX = 30;
export const PRODUITS_MAX = 50;

const TYPES_CONNUS = ['exclureProduits', 'exclureMarqueurs', 'formeViande', 'legumePrincipal', 'proteineChaqueRepas',
  'aEmporter', 'substitution'];
const SEVERITES = ['exclu', 'adaptable', 'preference'];
const MARQUEURS_VIANDE = ['bouillon_viande', 'gelatine_animale', 'graisse_animale', 'viande'];
const MARQUEURS_POISSON = ['fruits_de_mer', 'poisson'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
const trie = (valeurs) => [...new Set(valeurs)].sort();

/** Copie profonde des tables et des listes ; les valeurs undefined sont omises (clés absentes). */
function copier(valeur) {
  if (Array.isArray(valeur)) return valeur.filter((v) => v !== undefined).map(copier);
  if (estObjet(valeur)) {
    const copie = {};
    for (const [cle, v] of Object.entries(valeur)) if (v !== undefined) copie[cle] = copier(v);
    return copie;
  }
  return valeur;
}

/** Égalité profonde : tables sans tenir compte de l'ordre des clés, listes dans l'ordre. */
function egales(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => egales(v, b[i]));
  const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...cles].every((cle) => egales(a[cle], b[cle]));
}

// ——— Régime choisi à l'écran ———

/** Règle `id: 'regime'` d'un régime et de ses précisions ; null pour « Mange de tout ». */
function regleDuRegime(regime, precisions) {
  if (regime !== 'sans_viande' && regime !== 'sans_viande_ni_poisson') return null;
  const cochees = new Set(precisions instanceof Set ? precisions : Array.isArray(precisions) ? precisions : []);
  const retires = PRECISIONS.filter((p) => p.effet === 'retire' && cochees.has(p.id)).map((p) => p.marqueur);
  const marqueurs = trie([...MARQUEURS_VIANDE, ...(regime === 'sans_viande_ni_poisson' ? MARQUEURS_POISSON : [])]
    .filter((m) => !retires.includes(m)));
  const sauf = trie(PRECISIONS.filter((p) => p.effet === 'sauf' && cochees.has(p.id)).map((p) => p.marqueur));
  return {
    id: ID_REGIME,
    type: 'exclureMarqueurs',
    marqueurs,
    ...(sauf.length ? { saufMarqueurs: sauf } : {}),
    severite: 'exclu',
  };
}

/**
 * Régime lu dans les règles d'un profil. Seule la règle `id: 'regime'` que l'écran sait réécrire à l'identique est
 * reconnue ; tout le reste (autres règles, règle « regime » modifiée ailleurs) va dans `autres`, tel quel.
 * → { regime: 'tout' | 'sans_viande' | 'sans_viande_ni_poisson', precisions: Set, autres: [regles], position }
 *   `position` : place de la règle du régime dans la liste (pour la réécrire au même endroit).
 */
export function lireRegime(regles) {
  const liste = Array.isArray(regles) ? regles : [];
  for (const [position, regle] of liste.entries()) {
    if (!estObjet(regle) || regle.id !== ID_REGIME || regle.type !== 'exclureMarqueurs') continue;
    const marqueurs = new Set(Array.isArray(regle.marqueurs) ? regle.marqueurs : []);
    const poisson = MARQUEURS_POISSON.filter((m) => marqueurs.has(m)).length;
    if (!marqueurs.has('viande') || poisson === 1) continue;
    const regime = poisson ? 'sans_viande_ni_poisson' : 'sans_viande';
    const sauf = Array.isArray(regle.saufMarqueurs) ? regle.saufMarqueurs : [];
    const precisions = new Set(PRECISIONS
      .filter((p) => (p.effet === 'sauf' ? sauf.includes(p.marqueur) : !marqueurs.has(p.marqueur)))
      .map((p) => p.id));
    if (!egales(regleDuRegime(regime, precisions), regle)) continue;
    return { regime, precisions, autres: liste.filter((_, i) => i !== position), position };
  }
  return { regime: 'tout', precisions: new Set(), autres: [...liste], position: 0 };
}

/**
 * Règles à enregistrer pour un régime : la règle `id: 'regime'` (à sa place d'origine, `position`, sinon en tête)
 * et les `autres`, gardées telles quelles. « Mange de tout » → les autres seules. Listes triées, `saufMarqueurs`
 * omis s'il est vide : même entrée, même sortie, jamais de valeur undefined.
 * Garde-fou : ecrireRegime(lireRegime(r), lireRegime(r).autres) redonne r.
 */
export function ecrireRegime({ regime, precisions, position = 0 } = {}, autres = []) {
  const reste = (Array.isArray(autres) ? autres : []).map(copier);
  const regle = regleDuRegime(regime, precisions);
  if (!regle) return reste;
  const ici = Number.isInteger(position) && position >= 0 ? Math.min(position, reste.length) : 0;
  return [...reste.slice(0, ici), regle, ...reste.slice(ici)];
}

/** Types de plats qui n'attendent jamais de version mer : du poisson dans un dessert ou un accompagnement n'a pas de sens. */
export const TYPES_SANS_MER = ['dessert', 'accompagnement'];

/**
 * Styles de versions attendus pour ce profil, déduits de son régime : [] | ['vegetal'] | ['mer', 'vegetal'].
 * « Pas de viande » (mange du poisson) attend une version mer et une version végétale ; « Ni viande ni poisson », la
 * seule végétale ; tout autre régime ou règle, aucun style (une seule version, sans style). Profil sans règles → [].
 * `plat` (facultatif) : un dessert ou un accompagnement (TYPES_SANS_MER) n'attend que la version végétale ; un plat
 * dont la recette ne contient aucune viande (exclu seulement par un bouillon, une gélatine ou une graisse) aussi : la
 * version mer sert à remplacer la viande, pas à ajouter du poisson partout. Un plat sans ingrédients (⏳) garde les
 * deux styles.
 */
export function stylesAttendus(profil, plat = null) {
  const { regime } = lireRegime(profil?.regles);
  let styles = [];
  if (regime === 'sans_viande') styles = ['mer', 'vegetal'];
  else if (regime === 'sans_viande_ni_poisson') styles = ['vegetal'];
  if (!plat) return styles;
  const ingredients = Array.isArray(plat.ingredients) ? plat.ingredients.filter((i) => i && typeof i === 'object') : [];
  const sansViande = ingredients.length > 0
    && !ingredients.some((i) => Array.isArray(i.marqueurs) && i.marqueurs.some((m) => VIANDES.includes(m)));
  return TYPES_SANS_MER.includes(typeDe(plat)) || sansViande ? styles.filter((style) => style !== 'mer') : styles;
}

// ——— Règles venues d'un fichier ———

/** Liste de marqueurs propre (codes connus, sans doublon) ; null si elle est absente, vide, trop longue ou inconnue. */
function marqueursPropres(valeurs, { facultatif = false } = {}) {
  if (valeurs == null && facultatif) return [];
  if (!Array.isArray(valeurs) || (!valeurs.length && !facultatif) || valeurs.length > PRODUITS_MAX) return null;
  const propres = [];
  for (const valeur of valeurs) {
    const marqueur = code(valeur);
    if (!VOCABULAIRES.marqueurs.includes(marqueur)) return null;
    if (!propres.includes(marqueur)) propres.push(marqueur);
  }
  return propres;
}

/** Une règle du fichier : { regle } (propre), { inconnue: regle } (type pas encore compris, gardée) ou {} (abîmée). */
function validerRegle(brute) {
  if (!estObjet(brute) || typeof brute.type !== 'string' || !brute.type.trim()) return {};
  if (!TYPES_CONNUS.includes(brute.type)) return { inconnue: copier(brute) };
  if (brute.id != null && (typeof brute.id !== 'string' || !brute.id.trim())) return {};
  if (brute.actif != null && typeof brute.actif !== 'boolean') return {};
  const regle = copier(brute);
  if (brute.type !== 'substitution') {
    const severite = code(brute.severite);
    if (!SEVERITES.includes(severite)) return {};
    regle.severite = severite;
  } else if (!estObjet(brute.si)) {
    return {};
  }
  if (brute.type === 'exclureMarqueurs') {
    const marqueurs = marqueursPropres(brute.marqueurs);
    const sauf = marqueursPropres(brute.saufMarqueurs, { facultatif: true });
    if (!marqueurs || !sauf) return {};
    regle.marqueurs = marqueurs;
    if (sauf.length) regle.saufMarqueurs = sauf;
    else delete regle.saufMarqueurs;
  } else if (brute.type === 'exclureProduits') {
    const produits = brute.produits;
    if (!Array.isArray(produits) || !produits.length || produits.length > PRODUITS_MAX) return {};
    const propres = [];
    for (const produit of produits) {
      const nom = typeof produit === 'string' ? reduire(produit).toLocaleLowerCase('fr-FR') : '';
      if (!slug(nom)) return {};
      if (!propres.some((p) => slug(p) === slug(nom))) propres.push(nom);
    }
    regle.produits = propres;
  }
  return { regle };
}

/**
 * Règles d'un profil lues dans un fichier (ou dans l'app). Absent, null ou autre chose qu'une liste → [] sans
 * planter. Types du §7 reconnus ; les types qu'evaluer n'applique pas encore sont vérifiés au minimum (objet,
 * type, sévérité) et gardés tels quels ; un type inconnu est gardé (avertissement) ; une règle abîmée est retirée
 * (avertissement nommant le profil si `nom` est donné). 30 règles et 50 produits ou marqueurs par règle au plus.
 * → { regles, avertissements: [texte] }
 */
export function validerRegles(brutes, { nom = '' } = {}) {
  const regles = [];
  const avertissements = [];
  if (!Array.isArray(brutes)) return { regles, avertissements };
  const prenom = reduire(nom);
  let abimees = 0;
  let inconnues = 0;
  for (const brute of brutes.slice(0, REGLES_MAX)) {
    const { regle, inconnue } = validerRegle(brute);
    if (regle) regles.push(regle);
    else if (inconnue) {
      regles.push(inconnue);
      inconnues += 1;
    } else {
      abimees += 1;
    }
  }
  const de = prenom ? ` ${deNom(prenom)}` : '';
  if (abimees === 1) avertissements.push(`Une règle abîmée${de} a été ignorée.`);
  else if (abimees > 1) avertissements.push(`${abimees} règles abîmées${de} ont été ignorées.`);
  if (inconnues === 1) avertissements.push('Une règle n’est pas comprise par cette version de l’app.');
  else if (inconnues > 1) avertissements.push(`${inconnues} règles ne sont pas comprises par cette version de l’app.`);
  if (brutes.length > REGLES_MAX) {
    avertissements.push(`Trop de règles${de}\u00A0: seules les ${REGLES_MAX} premières sont gardées.`);
  }
  return { regles, avertissements };
}

// ——— Description pour Claude (sans prénom) ———

/** « a », « a et b », « a, b et c » */
function enumerer(mots) {
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}` : mots.join('');
}

// Ce que chaque précision ajoute à « Mange ».
const MANGE_PRECISION = {
  charcuterie: 'de la charcuterie',
  bouillon: 'des plats cuits avec un bouillon de viande',
  gelatine: 'de la gélatine',
  graisse: 'de la graisse animale',
};

/** Phrase du régime : interdit, puis ce qui reste permis (pour que Claude ne retire pas des œufs sans raison). */
function phraseDuRegime(regime, precisions) {
  const avec = (id) => precisions.has(id);
  const viandes = ['bœuf', 'porc', 'volaille', 'agneau', ...(avec('charcuterie') ? [] : ['charcuterie']), 'escargots', 'grenouilles'];
  const mange = PRECISIONS.filter((p) => avec(p.id)).map((p) => MANGE_PRECISION[p.id]);
  if (regime === 'sans_viande') {
    const interdits = [`Ne mange pas de viande (${viandes.join(', ')})`];
    if (!avec('bouillon')) interdits.push('ni de bouillon ou de fond de viande ou de volaille');
    if (!avec('gelatine')) interdits.push('ni de gélatine animale');
    if (!avec('graisse')) interdits.push('ni de graisse animale (saindoux, graisse de canard)');
    mange.push('du poisson', 'des fruits de mer', 'du fumet de poisson', 'des œufs', 'du fromage (même à présure animale)', 'du miel');
    return `${interdits.join(', ')}. Mange ${enumerer(mange)}.`;
  }
  const interdits = [`Ne mange ni viande (${viandes.join(', ')})`, 'ni poisson', 'ni fruits de mer',
    avec('bouillon') ? 'ni bouillon ou fond de poisson' : 'ni bouillon ou fond de viande, de volaille ou de poisson'];
  if (!avec('gelatine')) interdits.push('ni gélatine animale');
  if (!avec('graisse')) interdits.push('ni graisse animale');
  mange.push('des œufs', 'du fromage (même à présure animale)', 'du miel');
  return `${interdits.join(', ')}. Mange ${enumerer(mange)}.`;
}

/**
 * Ce que mange le profil, en clair, sans prénom (écran du régime, textes pour Claude). '' si rien n'est réglé.
 * Les règles « autres aliments à éviter » (`exclureProduits`) ajoutent « Évite aussi : céleri, navet. »
 */
export function decrireRegles(profil) {
  const { regime, precisions, autres } = lireRegime(profil?.regles);
  const phrases = [];
  if (regime !== 'tout') phrases.push(phraseDuRegime(regime, precisions));
  const evites = [];
  for (const regle of autres) {
    if (!estObjet(regle) || regle.type !== 'exclureProduits' || regle.actif === false || regle.severite === 'preference') continue;
    for (const produit of Array.isArray(regle.produits) ? regle.produits : []) {
      const nom = typeof produit === 'string' ? reduire(produit).toLocaleLowerCase('fr-FR') : '';
      if (slug(nom) && !evites.some((e) => slug(e) === slug(nom))) evites.push(nom);
    }
  }
  if (evites.length) phrases.push(`Évite aussi\u00A0: ${evites.join(', ')}.`);
  return phrases.join(' ');
}
