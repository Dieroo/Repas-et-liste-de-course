// « 🍳 Ma cuisine » (2026-10-20, CLAUDE.md §6 `reglages/foyer.cuisine` et `platsEtMoules`) : ce que la cuisine du foyer
// a, dit par la personne. Logique pure : ni DOM, ni Firebase, ni stockage du téléphone.
// - Objets connus (OBJETS, identifiants figés) : les cinq appareils de cuisson du format (plaques, four, Cookeo,
//   airfryer, Monsieur Cuisine) et des objets peu courants (siphon, mandoline, moule à charnière…). Un objet courant
//   (casserole, poêle, saladier…) n'y est jamais : l'app ne prévient que pour ce qui manque souvent (décision 25).
// - Deux états seulement, écrits par un geste (décision 26) : « Je l'ai » (`true`) et « Je ne l'ai pas » (`false`) ;
//   absent = pas encore dit. Les appareils de cuisson suivent, tant que rien n'est dit, les appareils de départ
//   (`reglages/foyer.appareils`, sinon plaques, four, Cookeo, airfryer).
// - Reconnaissance dans une recette : l'appareil de chaque cuisson et de chaque étape, et les ustensiles des étapes
//   détaillées, comparés aux noms et autres écritures des objets (cleProduit : casse, accents, pluriel), le nom le plus
//   long d'abord ; jamais de ressemblance.
// - Un objet manque quand il est dit absent et qu'aucun objet qui le remplace (REMPLACE_PAR) n'est dit présent : la
//   recette n'est alors plus proposée (proposition.js, option `ecarter`), et sa carte le dit.
// - Lignes des demandes à Claude (`dans la cuisine:`, `pas de:`, `plats et moules:`), seulement quand quelque chose
//   est dit : sinon les demandes restent celles d'avant.
// Typographie : \u00A0 avant « : », \u202F avant « ? », apostrophe ’.
import { cleProduit, slug } from './slug.js';
import { VOCABULAIRES, code, texte } from './vocabulaire.js';
import { aSaRecette } from './plats.js';
import { estDansCorbeille } from './corbeille.js';
import { EFFACER } from './semaine.js';
import { realisationAJour } from './realisation.js';

// ——— Objets connus ———

/**
 * Objets de « Ma cuisine », dans l'ordre de l'écran. `id` figé (chemin `cuisine.<id>` de Firestore : un id livré ne
 * disparaît jamais) ; `groupe` : 'cuire' (appareils de cuisson du format, reconnus seulement par leur code
 * `appareil`), 'petit' (petits appareils), 'ustensile' (moules et ustensiles) ; `phrase` : le nom dans une phrase
 * (minuscule, sauf nom propre) ; `claude` : le nom que Claude écrit dans `ustensiles` (au singulier, comme les
 * ustensiles de docs/projet-claude.md ; le code du format pour un appareil de cuisson, comme la ligne `appareils:` ;
 * sinon `phrase`) ; `article` : un, une ou des ; `alias` : autres écritures reconnues dans les ustensiles d'une recette
 * (un appareil de cuisson n'est reconnu dans les ustensiles que par ses `alias` : « friteuse sans huile ») ;
 * `remplacePar` : objets qui font le même travail (le mixeur plongeant d'une recette est là si le blender l'est).
 */
export const OBJETS = Object.freeze([
  { id: 'plaque', nom: 'Plaques de cuisson', phrase: 'plaques de cuisson', article: 'des', groupe: 'cuire', appareil: 'plaque', claude: 'plaque' },
  { id: 'four', nom: 'Four', phrase: 'four', article: 'un', groupe: 'cuire', appareil: 'four', claude: 'four' },
  { id: 'cookeo', nom: 'Cookeo', phrase: 'Cookeo', article: 'un', groupe: 'cuire', appareil: 'cookeo', claude: 'cookeo' },
  { id: 'airfryer', nom: 'Airfryer', phrase: 'airfryer', article: 'un', groupe: 'cuire', appareil: 'airfryer', claude: 'airfryer',
    alias: ['air fryer', 'friteuse sans huile', 'friteuse à air'] },
  { id: 'monsieur-cuisine', nom: 'Monsieur Cuisine', phrase: 'Monsieur Cuisine', article: 'un', groupe: 'cuire', appareil: 'monsieur_cuisine',
    claude: 'monsieur_cuisine', alias: ['robot cuiseur'] },

  { id: 'mixeur-plongeant', nom: 'Mixeur plongeant', article: 'un', groupe: 'petit',
    alias: ['mixeur', 'mixer', 'mixeur à main', 'mixeur plongeur', 'pied mixeur'], remplacePar: ['blender', 'robot', 'monsieur-cuisine'] },
  { id: 'blender', nom: 'Blender', article: 'un', groupe: 'petit',
    alias: ['blendeur', 'mixeur blender', 'mixeur à bol', 'bol mixeur', 'bol du mixeur'], remplacePar: ['mixeur-plongeant', 'robot', 'monsieur-cuisine'] },
  { id: 'robot', nom: 'Robot multifonction', article: 'un', groupe: 'petit',
    alias: ['robot', 'robot ménager', 'robot mixeur', 'robot de cuisine', 'robot culinaire'],
    remplacePar: ['blender', 'mixeur-plongeant', 'monsieur-cuisine'] },
  { id: 'robot-patissier', nom: 'Robot pâtissier', article: 'un', groupe: 'petit',
    alias: ['batteur sur socle'], remplacePar: ['monsieur-cuisine'] },
  { id: 'batteur-electrique', nom: 'Batteur électrique', article: 'un', groupe: 'petit',
    alias: ['batteur', 'fouet électrique', 'mixeur batteur'], remplacePar: ['robot-patissier', 'monsieur-cuisine'] },
  { id: 'cuiseur-vapeur', nom: 'Cuiseur vapeur', article: 'un', groupe: 'petit',
    alias: ['panier vapeur', 'panier à vapeur', 'cuit-vapeur', 'cuiseur à vapeur'], remplacePar: ['cookeo', 'monsieur-cuisine'] },
  { id: 'autocuiseur', nom: 'Cocotte-minute', article: 'une', groupe: 'petit',
    alias: ['cocotte minute', 'autocuiseur', 'autocuiseur électrique'], remplacePar: ['cookeo'] },
  { id: 'friteuse', nom: 'Friteuse', article: 'une', groupe: 'petit', alias: ['friteuse électrique'] },
  { id: 'plancha', nom: 'Plancha', article: 'une', groupe: 'petit', alias: ['plancha électrique'] },
  { id: 'appareil-a-raclette', nom: 'Appareil à raclette', article: 'un', groupe: 'petit', alias: ['service à raclette'] },
  { id: 'service-a-fondue', nom: 'Service à fondue', article: 'un', groupe: 'petit', alias: ['appareil à fondue', 'caquelon'] },
  { id: 'gaufrier', nom: 'Gaufrier', article: 'un', groupe: 'petit', alias: ['appareil à gaufres', 'moule à gaufres', 'gaufrier électrique'] },
  { id: 'sorbetiere', nom: 'Sorbetière', article: 'une', groupe: 'petit', alias: ['turbine à glace', 'turbine', 'machine à glace'] },
  { id: 'yaourtiere', nom: 'Yaourtière', article: 'une', groupe: 'petit', alias: ['yaourtière électrique'] },
  { id: 'machine-a-pain', nom: 'Machine à pain', article: 'une', groupe: 'petit' },
  { id: 'extracteur-de-jus', nom: 'Extracteur de jus', article: 'un', groupe: 'petit', alias: ['centrifugeuse'] },

  { id: 'mandoline', nom: 'Mandoline', article: 'une', groupe: 'ustensile' },
  { id: 'siphon', nom: 'Siphon', article: 'un', groupe: 'ustensile', alias: ['siphon à chantilly'] },
  { id: 'chalumeau', nom: 'Chalumeau', article: 'un', groupe: 'ustensile', alias: ['chalumeau de cuisine'] },
  { id: 'poche-a-douille', nom: 'Poche à douille', article: 'une', groupe: 'ustensile', alias: ['douille', 'poche pâtissière'] },
  { id: 'thermometre', nom: 'Thermomètre de cuisson', article: 'un', groupe: 'ustensile',
    alias: ['thermomètre', 'thermomètre de cuisine', 'thermomètre à sonde', 'sonde de cuisson', 'thermomètre à sucre'] },
  { id: 'mortier', nom: 'Mortier', article: 'un', groupe: 'ustensile', alias: ['mortier et pilon', 'pilon et mortier'] },
  { id: 'moule-a-charniere', nom: 'Moule à charnière', article: 'un', groupe: 'ustensile',
    alias: ['moule à fond amovible', 'moule démontable', 'moule à manqué à charnière'] },
  { id: 'moule-a-cake', nom: 'Moule à cake', article: 'un', groupe: 'ustensile' },
  { id: 'moule-a-tarte', nom: 'Moule à tarte', article: 'un', groupe: 'ustensile', alias: ['tourtière'] },
  { id: 'moule-a-muffins', nom: 'Moule à muffins', article: 'un', groupe: 'ustensile', alias: ['moule à cupcakes'] },
  { id: 'cercle-a-patisserie', nom: 'Cercle à pâtisserie', article: 'un', groupe: 'ustensile', alias: ['cercle', 'cercle à entremets'] },
  { id: 'emporte-pieces', nom: 'Emporte-pièces', article: 'des', groupe: 'ustensile', alias: ['emporte-pièce'], claude: 'emporte-pièce' },
  { id: 'ramequins', nom: 'Ramequins', article: 'des', groupe: 'ustensile', alias: ['ramequin'], claude: 'ramequin' },
  { id: 'cocotte-en-fonte', nom: 'Cocotte en fonte', article: 'une', groupe: 'ustensile', alias: ['cocotte fonte', 'cocotte en fonte émaillée'] },
].map((objet) => Object.freeze({
  ...objet,
  phrase: objet.phrase ?? objet.nom.charAt(0).toLocaleLowerCase('fr-FR') + objet.nom.slice(1),
  claude: objet.claude ?? objet.phrase ?? objet.nom.charAt(0).toLocaleLowerCase('fr-FR') + objet.nom.slice(1),
  alias: Object.freeze([...(objet.alias ?? [])]),
  remplacePar: Object.freeze([...(objet.remplacePar ?? [])]),
})));

const OBJET_PAR_ID = new Map(OBJETS.map((objet) => [objet.id, objet]));
const OBJET_PAR_APPAREIL = new Map(OBJETS.filter((o) => o.appareil).map((objet) => [objet.appareil, objet]));
const ID_SUR = /^[a-z0-9-]+$/;

/** L'objet connu de cet identifiant, ou null. */
export function objetParId(id) {
  return OBJET_PAR_ID.get(id) ?? null;
}

/** Plats et moules de la liste libre : nombre et longueur au plus. */
export const PLATS_ET_MOULES_MAX = 15;
export const PLAT_ET_MOULE_MAX = 40;

// Appareils annoncés quand les réglages n'en disent rien (monsieur_cuisine : seulement s'il est actif).
const APPAREILS_PAR_DEFAUT = Object.freeze(['plaque', 'four', 'cookeo', 'airfryer']);

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : typeof valeur === 'string' ? [valeur] : []);
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
// Nombre de caractères visibles (un emoji compte pour un).
const longueur = (chaine) => [...chaine].length;

// ——— Appareils de départ ———

/**
 * Codes des appareils actifs des réglages (`reglages/foyer.appareils` : codes, ou objets { id | appareil | code,
 * actif }), dans l'ordre du vocabulaire ; `monsieur_cuisine` seulement s'il est actif. Sans liste lisible ni appareil
 * actif : plaque, four, cookeo, airfryer.
 */
export function appareilsActifs(appareils) {
  const actifs = new Set();
  for (const appareil of Array.isArray(appareils) ? appareils : []) {
    if (estObjet(appareil) && appareil.actif === false) continue;
    const brut = estObjet(appareil) ? [appareil.id, appareil.appareil, appareil.code].find((v) => typeof v === 'string') : appareil;
    const valeur = code(brut);
    if (VOCABULAIRES.appareil.includes(valeur)) actifs.add(valeur);
  }
  const ordonnes = VOCABULAIRES.appareil.filter((valeur) => actifs.has(valeur));
  return ordonnes.length ? ordonnes : [...APPAREILS_PAR_DEFAUT];
}

// ——— Ce que la personne a dit ———

/** Réponses lues dans `reglages/foyer.cuisine` : Map id → true | false, objets connus seulement. */
export function lireCuisine(reglages) {
  const reponses = new Map();
  const brut = estObjet(reglages?.cuisine) ? reglages.cuisine : {};
  for (const objet of OBJETS) {
    if (brut[objet.id] === true || brut[objet.id] === false) reponses.set(objet.id, brut[objet.id]);
  }
  return reponses;
}

/** Nom d'un plat ou d'un moule de la liste libre, une ligne, PLAT_ET_MOULE_MAX caractères au plus ; '' si vide. */
function nomPlatEtMoule(valeur) {
  const nom = texte(valeur);
  return nom ? [...nom].slice(0, PLAT_ET_MOULE_MAX).join('').trim() : '';
}

/**
 * « Mes plats et moules » lus dans `reglages/foyer.platsEtMoules` ({ <id>: nom }) → [{ id, nom }] triés par nom ;
 * identifiants sûrs et noms lisibles seulement. Tous, même au-delà de PLATS_ET_MOULES_MAX (deux téléphones qui
 * ajoutent en même temps) : chacun reste visible, retirable et envoyé ; seul l'ajout est borné.
 */
export function lirePlatsEtMoules(reglages) {
  const brut = estObjet(reglages?.platsEtMoules) ? reglages.platsEtMoules : {};
  return Object.entries(brut)
    .filter(([id]) => ID_SUR.test(id))
    .map(([id, valeur]) => ({ id, nom: nomPlatEtMoule(valeur) }))
    .filter((element) => element.nom)
    .sort((a, b) => comparerNoms(a.nom, b.nom) || (a.id < b.id ? -1 : 1));
}

/**
 * État d'un objet → 'oui' (« Je l'ai »), 'non' (« Je ne l'ai pas ») ou null (pas encore dit). Pas encore dit : un
 * objet nommé par « Mes plats et moules » (« Moule à charnière 24 cm ») est là ; un appareil de cuisson suit les
 * appareils de départ ('oui' s'il en est, sinon null).
 */
export function etatObjet(id, reglages) {
  const objet = OBJET_PAR_ID.get(id);
  if (!objet) return null;
  const reponse = estObjet(reglages?.cuisine) ? reglages.cuisine[id] : undefined;
  if (reponse === true) return 'oui';
  if (reponse === false) return 'non';
  if (objetsDesPlatsEtMoules(reglages).has(id)) return 'oui';
  if (objet.appareil) return appareilsActifs(reglages?.appareils).includes(objet.appareil) ? 'oui' : null;
  return null;
}

const memoPlatsEtMoules = new WeakMap();

/** Objets connus que « Mes plats et moules » nomme (Set d'ids ; même Set tant que la liste est le même objet). */
function objetsDesPlatsEtMoules(reglages) {
  const brut = reglages?.platsEtMoules;
  if (!estObjet(brut)) return new Set();
  if (!memoPlatsEtMoules.has(brut)) {
    memoPlatsEtMoules.set(brut, new Set(lirePlatsEtMoules(reglages).map((element) => objetDUstensile(element.nom)).filter(Boolean)));
  }
  return memoPlatsEtMoules.get(brut);
}

/** Vrai si la cuisine a cet objet, ou un objet qui le remplace (REMPLACE_PAR). */
export function aLObjet(id, reglages) {
  const objet = OBJET_PAR_ID.get(id);
  if (!objet) return true;
  return etatObjet(id, reglages) === 'oui' || objet.remplacePar.some((autre) => etatObjet(autre, reglages) === 'oui');
}

/**
 * Codes des appareils de cuisson du foyer, pour Claude (`appareils:`) : ceux qui ont « Je l'ai » (ou, pas encore dits,
 * ceux de départ), dans l'ordre du vocabulaire ; aucun : les appareils de départ qui ne sont pas dits absents ([] si
 * tous le sont : la demande dit alors `appareils: aucun`).
 */
export function appareilsDuFoyer(reglages) {
  const codes = OBJETS.filter((objet) => objet.appareil && etatObjet(objet.id, reglages) === 'oui').map((o) => o.appareil);
  const ordonnes = VOCABULAIRES.appareil.filter((valeur) => codes.includes(valeur));
  if (ordonnes.length) return ordonnes;
  return appareilsActifs(reglages?.appareils).filter((valeur) => etatObjet(OBJET_PAR_APPAREIL.get(valeur)?.id, reglages) !== 'non');
}

/** Vrai dès que quelque chose est dit dans « Ma cuisine » (une réponse, ou un plat ou un moule de la liste). */
export function cuisineReglee(reglages) {
  return lireCuisine(reglages).size > 0 || lirePlatsEtMoules(reglages).length > 0;
}

// ——— Objets d'une recette ———

/** Mots d'un nom, comme cleProduit (casse, accents, pluriel de chaque mot). */
const motsDe = (nom) => cleProduit(nom).split('-').filter(Boolean);

// Noms reconnus dans les ustensiles : nom et autres écritures des objets ; un appareil de cuisson (reconnu d'abord par
// son code) seulement par ses autres écritures (« friteuse sans huile »), jamais par son nom (« plaque de four » n'est
// pas une plaque de cuisson). Le nom le plus long d'abord ; à longueur égale, l'ordre de OBJETS.
const NOMS_RECONNUS = OBJETS
  .flatMap((objet) => [...(objet.groupe === 'cuire' ? [] : [objet.nom]), ...objet.alias].map((nom) => ({ id: objet.id, mots: motsDe(nom) })))
  .filter((entree) => entree.mots.length)
  .sort((a, b) => b.mots.length - a.mots.length);

/** Vrai si `mots` contient la suite `suite`, mots consécutifs. */
function contientLaSuite(mots, suite) {
  for (let i = 0; i + suite.length <= mots.length; i += 1) {
    if (suite.every((mot, j) => mots[i + j] === mot)) return true;
  }
  return false;
}

/** Objet connu d'un seul nom d'ustensile, ou null. */
function objetDUnNom(nom) {
  const mots = motsDe(nom);
  if (!mots.length) return null;
  return NOMS_RECONNUS.find((entree) => entree.mots.length <= mots.length && contientLaSuite(mots, entree.mots))?.id ?? null;
}

/**
 * Objets connus d'un ustensile écrit dans une étape, au choix → [ids] (« grand moule à charnière » →
 * ['moule-a-charniere'] ; « robot pâtissier ou batteur électrique » → ['robot-patissier', 'batteur-electrique'] : l'un
 * ou l'autre suffit) ; null pour un ustensile courant ou inconnu, ou dès qu'une possibilité est courante (« mixeur
 * plongeant ou presse-purée » : le presse-purée suffit). « ou » et une barre entre espaces séparent les possibilités
 * (« 24/26 cm » reste une taille).
 */
export function objetsDUstensile(nom) {
  const possibilites = texte(nom).replace(/[()]/g, ' ').split(/\s+ou\s+|\s+\/\s+/i).map((p) => p.trim()).filter(Boolean);
  if (!possibilites.length) return null;
  const objets = possibilites.map(objetDUnNom);
  return objets.every(Boolean) ? [...new Set(objets)] : null;
}

/**
 * Objet connu d'un ustensile (« robot pâtissier » → 'robot-patissier', jamais 'robot') : la première possibilité de
 * objetsDUstensile, ou null.
 */
export function objetDUstensile(nom) {
  return objetsDUstensile(nom)?.[0] ?? null;
}

/** Objet d'un code d'appareil du format (« cookeo » → 'cookeo', « monsieur_cuisine » → 'monsieur-cuisine'), ou null. */
export function objetDAppareil(appareil) {
  return OBJET_PAR_APPAREIL.get(code(typeof appareil === 'string' ? appareil : ''))?.id ?? null;
}

const memoBesoins = new WeakMap();

/**
 * Besoins d'une recette → [{ id, autres: [ids] }], dans l'ordre de la recette, un par objet : l'appareil de chaque
 * cuisson (`cuisson[]`), puis, étape par étape (`realisation[]` à jour seulement, realisation.js › realisationAJour ;
 * jamais les étapes « le jour du repas », où un objet n'est que pratique), son appareil et ses ustensiles ; `autres` :
 * les autres possibilités d'un ustensile au choix (« robot pâtissier ou batteur électrique »), [] si l'objet est demandé
 * seul quelque part. [] pour un plat sans recette.
 */
function besoinsDuPlat(plat) {
  if (!estObjet(plat) || !aSaRecette(plat)) return [];
  if (memoBesoins.has(plat)) return memoBesoins.get(plat);
  const parId = new Map();
  const ajouter = ([id, ...autres] = []) => {
    if (!id) return;
    const deja = parId.get(id);
    if (!deja) parId.set(id, { id, autres });
    else if (deja.autres.length) deja.autres = autres.length ? [...new Set([...deja.autres, ...autres])] : [];
  };
  for (const cuisson of Array.isArray(plat.cuisson) ? plat.cuisson : []) ajouter([objetDAppareil(cuisson?.appareil)]);
  for (const etape of realisationAJour(plat) ? plat.realisation : []) {
    if (!estObjet(etape) || etape.auService === true) continue;
    ajouter([objetDAppareil(etape.appareil)]);
    for (const ustensile of listeDe(etape.ustensiles)) ajouter(objetsDUstensile(ustensile) ?? []);
  }
  const figes = Object.freeze([...parId.values()].map((b) => Object.freeze({ id: b.id, autres: Object.freeze(b.autres) })));
  memoBesoins.set(plat, figes);
  return figes;
}

const memoObjets = new WeakMap();

/** Objets connus dont une recette a besoin (besoinsDuPlat), dans son ordre, chacun une fois → [ids] (même tableau). */
export function objetsDuPlat(plat) {
  if (!estObjet(plat)) return [];
  if (!memoObjets.has(plat)) memoObjets.set(plat, Object.freeze(besoinsDuPlat(plat).map((b) => b.id)));
  return memoObjets.get(plat);
}

/**
 * Où en est un besoin d'une recette ({ id, autres }) → 'la' (la cuisine a l'objet, une autre possibilité de
 * l'ustensile, ou un objet qui le remplace), 'manque' (tout cela dit absent), ou { question, pour } : l'objet à
 * demander, `question`, l'objet lui-même (pas encore dit), ou, l'objet dit absent, la première possibilité pas encore
 * dite (les autres de l'ustensile, puis ses remplaçants ; `pour` : l'objet absent ; « Pas de mixeur plongeant. Vous
 * avez un blender ? »).
 */
function besoin({ id, autres = [] }, reglages) {
  const remplacants = [...autres, ...(OBJET_PAR_ID.get(id)?.remplacePar ?? [])].filter((r) => r !== id);
  if (aLObjet(id, reglages) || remplacants.some((r) => etatObjet(r, reglages) === 'oui')) return 'la';
  if (etatObjet(id, reglages) !== 'non') return { question: id, pour: null };
  const autre = remplacants.find((r) => etatObjet(r, reglages) === null) ?? null;
  return autre ? { question: autre, pour: id } : 'manque';
}

/** Vrai si, après une réponse « Je ne l'ai pas », un objet qui le remplacerait reste à demander. */
export function remplacantADemander(id, reglages) {
  return (OBJET_PAR_ID.get(id)?.remplacePar ?? []).some((r) => etatObjet(r, reglages) === null);
}

/**
 * Ce que la cuisine du foyer dit d'une recette → null (rien à dire) ou { manquants: [id], question: id | null, pour:
 * id | null } : `manquants`, objets dits absents sans rien qui les remplace (la recette n'est plus proposée) ;
 * `question`, le premier objet à demander (« Il faut un siphon. Vous l'avez ? ») ; `pour`, l'objet absent que
 * `question` remplacerait (« Pas de mixeur plongeant. Vous avez un blender ? »), sinon null.
 */
export function alerteDuPlat(plat, reglages) {
  const manquants = [];
  let question = null;
  let pour = null;
  for (const b of besoinsDuPlat(plat)) {
    const etat = besoin(b, reglages);
    if (etat === 'la') continue;
    if (etat === 'manque') manquants.push(b.id);
    else if (!question) ({ question, pour } = etat);
  }
  return manquants.length || question ? { manquants, question, pour } : null;
}

/**
 * Vrai si la recette demande un objet que la cuisine n'a pas, ni rien qui le remplace (filtre des propositions) ; un
 * objet pas encore dit, ou dont un remplaçant n'est pas encore dit, n'écarte rien (dans le doute, on propose).
 */
export function manqueUnObjet(plat, reglages) {
  return besoinsDuPlat(plat).some((b) => besoin(b, reglages) === 'manque');
}

const memoRecettes = new WeakMap();

/**
 * Noms des recettes qui demandent chaque objet (plats actifs qui ont leur recette, tous types) → Map id → [noms] triés.
 * Même Map tant que la liste des plats est le même tableau.
 */
export function recettesParObjet(plats) {
  if (Array.isArray(plats) && memoRecettes.has(plats)) return memoRecettes.get(plats);
  const parObjet = new Map();
  for (const plat of Array.isArray(plats) ? plats : []) {
    if (!estObjet(plat) || estDansCorbeille(plat)) continue;
    const nom = texte(plat.nom);
    if (!nom) continue;
    for (const id of objetsDuPlat(plat)) {
      if (!parObjet.has(id)) parObjet.set(id, []);
      if (!parObjet.get(id).includes(nom)) parObjet.get(id).push(nom);
    }
  }
  for (const noms of parObjet.values()) noms.sort(comparerNoms);
  if (Array.isArray(plats)) memoRecettes.set(plats, parObjet);
  return parObjet;
}

// ——— Écran « Ma cuisine » ———

/**
 * Lignes de l'écran → { demandes, cuire, autres, platsEtMoules } : `demandes`, objets (hors appareils de cuisson) que
 * des recettes du foyer demandent, le plus demandé d'abord ; `cuire`, les cinq appareils de cuisson ; `autres`, le
 * reste des objets, dans l'ordre de OBJETS. Chaque ligne : { id, nom, etat, pour: [noms], pluriel }.
 */
export function lignesMaCuisine(reglages, plats) {
  const parObjet = recettesParObjet(plats);
  const ligne = (objet) => ({
    id: objet.id,
    nom: objet.nom,
    etat: etatObjet(objet.id, reglages),
    pour: parObjet.get(objet.id) ?? [],
    pluriel: objet.article === 'des',
  });
  const cuire = OBJETS.filter((objet) => objet.groupe === 'cuire').map(ligne);
  const reste = OBJETS.filter((objet) => objet.groupe !== 'cuire').map(ligne);
  const demandes = reste.filter((l) => l.pour.length)
    .sort((a, b) => b.pour.length - a.pour.length || comparerNoms(a.nom, b.nom));
  const autres = reste.filter((l) => !l.pour.length);
  return { demandes, cuire, autres, platsEtMoules: lirePlatsEtMoules(reglages) };
}

/** « Pour : Cheesecake et Tarte au citron » ; au-delà de trois, « Pour : A, B, C et 2 autres ». '' sans recette. */
export function textePour(noms) {
  const liste = listeDe(noms).map(texte).filter(Boolean);
  if (!liste.length) return '';
  if (liste.length > 3) return `Pour\u00A0: ${liste.slice(0, 3).join(', ')} et ${liste.length - 3}\u00A0autre${liste.length - 3 > 1 ? 's' : ''}`;
  return `Pour\u00A0: ${liste.length > 1 ? `${liste.slice(0, -1).join(', ')} et ${liste.at(-1)}` : liste[0]}`;
}

/** Libellés des deux réponses d'un objet : « Je l'ai » / « Je ne l'ai pas » (« Je les ai » pour des ramequins). */
export function libellesReponse(id) {
  const pluriel = OBJET_PAR_ID.get(id)?.article === 'des';
  return pluriel
    ? { oui: 'Je les ai', non: 'Je ne les ai pas' }
    : { oui: 'Je l’ai', non: 'Je ne l’ai pas' };
}

/** « un siphon », « une mandoline », « des ramequins ». */
function avecArticle(objet) {
  return `${objet.article} ${objet.phrase}`;
}

/** « de siphon », « d’airfryer », « de yaourtière » (après « pas » ; élision devant une voyelle seulement). */
function avecDe(objet) {
  return /^[aeiouàâéèêëîïôû]/i.test(objet.phrase) ? `d’${objet.phrase}` : `de ${objet.phrase}`;
}

/**
 * Question de la carte et de la fiche : « Il faut un siphon. Vous l’avez ? » (« Vous les avez ? » au pluriel) ; avec
 * `pour` (l'objet absent que celui-ci remplacerait) : « Pas de mixeur plongeant. Vous avez un blender ? ».
 */
export function texteQuestion(id, pour = null) {
  const objet = OBJET_PAR_ID.get(id);
  if (!objet) return '';
  const absent = pour ? OBJET_PAR_ID.get(pour) : null;
  if (absent) return `Pas ${avecDe(absent)}. Vous avez ${avecArticle(objet)}\u202F?`;
  return `Il faut ${avecArticle(objet)}. Vous ${objet.article === 'des' ? 'les ' : 'l’'}avez\u202F?`;
}

/**
 * Objets qui manquent : « Il faut un siphon : vous n’en avez pas. », « Il faut un siphon et une mandoline : vous n’en
 * avez pas. » ; `changer` (carte d'un plat qu'on peut encore changer) : « Touchez le plat pour en choisir un autre. »
 * en plus. '' sans objet.
 */
export function texteManquants(ids, { changer = false } = {}) {
  const objets = listeDe(ids).map((id) => OBJET_PAR_ID.get(id)).filter(Boolean);
  if (!objets.length) return '';
  const noms = objets.map(avecArticle);
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0];
  return `Il faut ${liste}\u00A0: vous n’en avez pas.${changer ? ' Touchez le plat pour en choisir un autre.' : ''}`;
}

/**
 * Annonce après une réponse (`valeur` : true « Je l'ai », false « Je ne l'ai pas ») : « C’est noté : siphon dans Ma
 * cuisine. », « C’est noté : pas de siphon. L’app ne proposera plus les plats qui en demandent. » ; `remplacant` (un
 * objet qui le remplacerait reste à demander) : « C’est noté : pas de mixeur plongeant. ».
 */
export function annonceReponse(id, valeur, { remplacant = false } = {}) {
  const objet = OBJET_PAR_ID.get(id);
  if (!objet) return '';
  if (valeur) return `C’est noté\u00A0: ${objet.phrase} dans Ma cuisine.`;
  // Un objet qui le remplacerait reste à demander : rien n'est encore écarté.
  return remplacant
    ? `C’est noté\u00A0: pas ${avecDe(objet)}.`
    : `C’est noté\u00A0: pas ${avecDe(objet)}. L’app ne proposera plus les plats qui en demandent.`;
}

/** Textes fixes de l'écran « Ma cuisine » et de sa carte dans Réglages. */
export const TEXTES_MA_CUISINE = Object.freeze({
  titre: 'Ma cuisine',
  intro: 'Dites ce que vous avez\u00A0: l’app ne vous proposera plus un plat qui demande un objet que vous n’avez pas, et Claude en tiendra compte pour les recettes.',
  introCourses: 'Dites ce que vous avez\u00A0: l’app ne vous proposera plus un plat qui demande un objet que vous n’avez pas.',
  demandes: 'Vos recettes demandent',
  demandesVide: 'Aucune de vos recettes ne demande d’objet peu courant pour l’instant.',
  cuire: 'Pour cuire',
  autres: 'Autres objets',
  autresAide: 'Seulement si vous voulez\u00A0: l’app vous posera la question quand une recette en aura besoin.',
  platsEtMoules: 'Mes plats et moules',
  platsEtMoulesAide: 'Leur taille aide à choisir le bon plat pour le batch. Par exemple\u00A0: «\u00A0Plat à gratin 30\u00A0×\u00A020\u00A0cm\u00A0», «\u00A0Cocotte 5\u00A0l\u00A0».',
  platsEtMoulesVide: 'Aucun pour l’instant.',
  ajouter: 'Ajouter',
  champ: 'Nom et taille',
  retirer: 'Retirer',
  carteReglages: 'Les appareils, objets peu courants, plats et moules de la cuisine.',
  ouvrir: 'Ouvrir Ma cuisine',
});

/** Erreurs de l'ajout d'un plat ou d'un moule. */
export const ERREURS_PLAT_ET_MOULE = Object.freeze({
  vide: 'Écrivez le nom d’un plat ou d’un moule.',
  long: `${PLAT_ET_MOULE_MAX}\u00A0caractères au plus.`,
  plein: `${PLATS_ET_MOULES_MAX}\u00A0au plus\u00A0: retirez-en un d’abord.`,
});

// ——— Écritures (un chemin de `reglages/foyer` par geste) ———

/**
 * Réponse pour un objet → { 'cuisine.<id>': true | false | EFFACER } (`valeur` null : retour à « pas encore dit »,
 * pour « Annuler ») ; null pour un objet inconnu ou une valeur illisible.
 */
export function ecrituresObjet(id, valeur) {
  if (!OBJET_PAR_ID.has(id)) return null;
  if (valeur !== true && valeur !== false && valeur !== null) return null;
  return { [`cuisine.${id}`]: valeur === null ? EFFACER : valeur };
}

/**
 * Ajout à « Mes plats et moules » → { erreur } ou { id, nom, champs: { 'platsEtMoules.<id>': nom, 'cuisine.<objet>'?:
 * true } } : identifiant = slug du nom (deux téléphones écrivent le même chemin ; un nom déjà dans la liste, à la casse
 * et aux accents près, est refusé), PLATS_ET_MOULES_MAX au plus ; un nom qui désigne un objet connu (« Moule à
 * charnière 24 cm ») dit aussi « Je l'ai » pour lui, dans le même lot, s'il ne l'était pas.
 */
export function ajoutPlatEtMoule(nom, reglages) {
  const lu = texte(nom);
  if (!lu || !slug(lu)) return { erreur: ERREURS_PLAT_ET_MOULE.vide };
  if (longueur(lu) > PLAT_ET_MOULE_MAX) return { erreur: ERREURS_PLAT_ET_MOULE.long };
  const id = slug(lu);
  const liste = lirePlatsEtMoules(reglages);
  const deja = liste.find((element) => element.id === id);
  if (deja) return { erreur: `«\u00A0${deja.nom}\u00A0» est déjà dans la liste.` };
  if (liste.length >= PLATS_ET_MOULES_MAX) return { erreur: ERREURS_PLAT_ET_MOULE.plein };
  const objet = objetDUstensile(lu);
  const aussi = objet && lireCuisine(reglages).get(objet) !== true ? { [`cuisine.${objet}`]: true } : {};
  return { id, nom: lu, champs: { [`platsEtMoules.${id}`]: lu, ...aussi } };
}

/** Retrait d'un plat ou d'un moule → { 'platsEtMoules.<id>': EFFACER } ; null pour un identifiant illisible. */
export function retraitPlatEtMoule(id) {
  return typeof id === 'string' && ID_SUR.test(id) ? { [`platsEtMoules.${id}`]: EFFACER } : null;
}

/**
 * Vrai pour un chemin et une valeur que Ma cuisine écrit (garde de donnees.js) : `cuisine.<objet connu>` avec true,
 * false ou EFFACER ; `platsEtMoules.<slug>` avec EFFACER, ou un nom lisible de PLAT_ET_MOULE_MAX caractères au plus
 * dont le slug est l'identifiant.
 */
export function cheminCuisineSur(chemin, valeur) {
  const [champ, id, ...reste] = String(chemin ?? '').split('.');
  if (reste.length || !id) return false;
  if (champ === 'cuisine') return OBJET_PAR_ID.has(id) && (valeur === true || valeur === false || valeur === EFFACER);
  if (champ === 'platsEtMoules') {
    if (!ID_SUR.test(id)) return false;
    if (valeur === EFFACER) return true;
    return typeof valeur === 'string' && valeur === texte(valeur) && longueur(valeur) <= PLAT_ET_MOULE_MAX && slug(valeur) === id;
  }
  return false;
}

// ——— Demandes à Claude ———

/**
 * Lignes de la cuisine du foyer pour une demande à Claude, après `appareils:` : `dans la cuisine:` (objets peu courants
 * dits présents), `pas de:` (dits absents, appareils de cuisson compris : ils manquent déjà à `appareils:`, la ligne
 * le redit), `plats et moules:` (la liste libre, séparée par « ; », sans un plat dont l'objet est dit absent). Chaque
 * ligne omise quand elle est vide ; [] tant que rien n'est dit.
 */
export function lignesCuisine(reglages) {
  const lignes = [];
  const reponses = lireCuisine(reglages);
  const oui = OBJETS.filter((objet) => objet.groupe !== 'cuire' && reponses.get(objet.id) === true).map((o) => o.claude);
  const non = OBJETS.filter((objet) => reponses.get(objet.id) === false).map((o) => o.claude);
  // Un plat ou un moule dont l'objet est dit absent depuis (« Je ne l'ai pas ») ne part pas : la dernière réponse compte.
  const platsEtMoules = lirePlatsEtMoules(reglages)
    .filter((element) => reponses.get(objetDUstensile(element.nom)) !== false).map((element) => element.nom);
  if (oui.length) lignes.push(`dans la cuisine: ${oui.join(', ')}`);
  if (non.length) lignes.push(`pas de: ${non.join(', ')}`);
  if (platsEtMoules.length) lignes.push(`plats et moules: ${platsEtMoules.join(' ; ')}`);
  return lignes;
}

/** Noms des objets peu courants, tels que Claude doit les écrire dans `ustensiles` (docs/projet-claude.md). */
export function nomsPourClaude() {
  return OBJETS.filter((objet) => objet.groupe !== 'cuire').map((objet) => objet.claude);
}
