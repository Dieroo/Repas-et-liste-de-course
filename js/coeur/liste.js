// Liste de courses (T3a, CLAUDE.md §9 « Liste ») : calculée sur chaque téléphone, jamais écrite. On n'écrit que les
// gestes : les coches (`coches.<cle>` : ce qui a été pris), « À racheter » (`racheter.<cle>`), les articles ajoutés à
// la main (`articles/{id}`), et en T3b le mot cherché au drive (`produits/{id}.rechercheDrive`) et « Courses
// terminées » (statut de la semaine, articles achetés retirés, `derniereFois` des plats) ; en T3d, les réglages d'un
// produit (`produits/{id}.rayon`, `.placard`, `.habituel`), « Pas cette semaine » (`sansHabituel.<id>`,
// `sansHebdo.<id>`), la précision d'un article et l'ordre des rayons (`reglages/foyer.rayons`). Logique pure : ni DOM ni
// Firebase.
// - T3d : habituels (« À acheter chaque semaine ») et préparations de chaque semaine entrent d'eux-mêmes dans la liste
//   de la semaine montrée (« Comme chaque semaine » en mode Drive) ; un habituel n'est jamais mis de côté.
// - Une ligne par produit (produits.js › idProduit), unités réunies (« Beurre · 230 g + 2 c. à soupe »).
// - Seule la version servie compte : ses ajouts pour les portions de ce profil ; ce qu'elle retire n'est pas acheté
//   pour sa part (décision 16).
// - Sommes dans un ordre fixe (plat, profil, produit, famille, quantité), puis arrondies au millionième : la liste ne
//   dépend ni de l'ordre des plats ni de celui des ingrédients, au bit près.
// - Arrondi d'achat au supérieur, tolérant (jamais 120 g pour 110,000…01 g) ; une coche retient la quantité affichée.
import { slug } from './slug.js';
import {
  HABITUEL_LIBELLE_MAX, HABITUEL_QTE_MAX, cleDeRepli, clesDuProduit, entreeParId, ficheProduit, idProduit,
  indexDesRecettes, lireHabituel, lirePlacardFoyer, lireRayonFoyer, rayonDeDepart, reglageDuFoyer,
} from './produits.js';
import { aSaRecette, quantiteLisible, typeDe } from './plats.js';
import { estDansCorbeille } from './corbeille.js';
import { deNom } from './notes.js';
import {
  EFFACER, RANGS_STATUT, articlesDesRestes, cheminSur, coefDe, ecrituresRouvrir, idGarde, jourValide, lireSemaine,
  peutPreparerLaSuivante, platsDeLaSemaine, semaineSuivante, semaineVisee, statutSemaine, texteDates, texteJour,
} from './semaine.js';
import { LIBELLES_RAYON, UNITES_EDITION } from './edition.js';
import { LIBELLES_STYLE } from './vocabulaire.js';
import { RECHERCHE_MAX, lireDrive } from './drive.js';

/** Unité → [famille, facteur vers l'unité de base] : masse (g), volume (ml), puis une famille par autre unité. */
export const FAMILLES = Object.freeze({
  g: ['masse', 1], kg: ['masse', 1000], ml: ['volume', 1], cl: ['volume', 10], l: ['volume', 1000], pc: ['pc', 1],
  tranche: ['tranche', 1], sachet: ['sachet', 1], boite: ['boite', 1], botte: ['botte', 1], cs: ['cs', 1],
  cc: ['cc', 1], pincee: ['pincee', 1],
});
/** Ordre des familles dans une quantité affichée (« 230 g + 2 c. à soupe »). */
export const ORDRE_FAMILLES = Object.freeze(['masse', 'volume', 'pc', 'tranche', 'sachet', 'boite', 'botte', 'cs', 'cc',
  'pincee']);
/** Équivalences générales, pour comparer au seuil du placard seulement (§9.9) : jamais à l'affichage. */
export const EQUIVALENCES = Object.freeze({ pincee: { g: 0.5 }, cc: { g: 5, ml: 5 }, cs: { g: 15, ml: 15 } });
export const TOLERANCE = 1e-9;
/** Article ajouté à la main : nom (60 caractères au plus) et précision (40). */
export const ARTICLE_MAX = 60;
export const PRECISION_MAX = 40;
export const ERREURS_ARTICLE = Object.freeze({ vide: 'Écrivez le nom d’un article.', long: '60 caractères au plus.' });
/** Sans semaine affichée, un article coché depuis plus de 2 jours est caché (courses déjà faites). */
export const ARTICLES_COCHES_JOURS = 2;

const UNITE_DE_BASE = { masse: 'g', volume: 'ml' };
const JOUR_MS = 86_400_000;
const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const listeDe = (valeur) => (Array.isArray(valeur) ? valeur : []);
const reduire = (texte) => (typeof texte === 'string' ? texte.replace(/\s+/g, ' ').trim() : '');
/** Comme reduire, mais les espaces insécables d'une quantité (« 30 g ») restent. */
const reduireQuantite = (texte) => (typeof texte === 'string' ? texte.replace(/[ \t\r\n\f\v]+/g, ' ').trim() : '');
const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const arrondi = (valeur) => Math.round(valeur * 1e6) / 1e6;
const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
/** Écart toléré entre deux quantités : relatif, au moins TOLERANCE. */
const ecartTolere = (valeur) => TOLERANCE * Math.max(1, Math.abs(valeur));

// ——— Quantités ———

/** Quantité ramenée à l'unité de base de sa famille → { famille, qte } ; null si l'unité ou la quantité est illisible. */
export function versBase(qte, unite) {
  if (!estNombre(qte) || qte <= 0 || typeof unite !== 'string' || !Object.hasOwn(FAMILLES, unite)) return null;
  const [famille, facteur] = FAMILLES[unite];
  return { famille, qte: qte * facteur };
}

/** Multiple de `pas` au supérieur, tolérant : 110,000…01 au pas de 10 → 110. */
const auSuperieur = (qte, pas) => Math.max(0, Math.ceil(qte / pas - TOLERANCE)) * pas;

/** Arrondi d'achat → { qte, unite, base } (`base` : la quantité affichée, ramenée à l'unité de base). */
function achat(famille, qte) {
  const q = estNombre(qte) && qte > 0 ? qte : 0;
  if (famille === 'masse' || famille === 'volume') {
    let base;
    if (q < 10) base = auSuperieur(q, 1);
    else if (q <= 100) base = auSuperieur(q, 5);
    else if (q < 1000) base = auSuperieur(q, 10);
    else base = auSuperieur(q, 100);
    base = arrondi(base);
    if (base >= 1000) return { qte: Math.round(base / 100) / 10, unite: famille === 'masse' ? 'kg' : 'l', base };
    if (famille === 'volume' && base > 100) return { qte: Math.round(base / 10), unite: 'cl', base };
    return { qte: base, unite: UNITE_DE_BASE[famille], base };
  }
  const pas = famille === 'cs' || famille === 'cc' ? 0.5 : 1;
  const base = arrondi(auSuperieur(q, pas));
  return { qte: base, unite: Object.hasOwn(FAMILLES, famille) ? famille : 'pc', base };
}

/**
 * Arrondi d'achat, toujours au supérieur, tolérant (TOLERANCE) → { qte, unite } :
 * - masse : 1 g sous 10 g, 5 g de 10 à 100 g, 10 g jusqu'à 999 g, puis « kg » au dixième ;
 * - volume : 1 ml sous 10 ml, 5 ml de 10 à 100 ml, « cl » entiers jusqu'à 999 ml, puis « l » au dixième ;
 * - pièces, bottes, sachets, boîtes, tranches, pincées : entier ; cuillères : demi.
 */
export function arrondiAchat(famille, qte) {
  const { qte: arrondie, unite } = achat(famille, qte);
  return { qte: arrondie, unite };
}

/** Familles d'un total, dans l'ordre d'affichage, avec une quantité positive. */
function famillesDe(totaux) {
  if (!estObjet(totaux)) return [];
  const connues = ORDRE_FAMILLES.filter((f) => estNombre(totaux[f]) && totaux[f] > 0);
  const autres = Object.keys(totaux).filter((f) => !ORDRE_FAMILLES.includes(f) && estNombre(totaux[f]) && totaux[f] > 0);
  return [...connues, ...autres.sort()];
}

/**
 * Quantité affichée d'un total par famille : « 1,3 kg + 2 c. à soupe » ; « 3 » (pièces) ; '' sans quantité. (Pas
 * `quantiteLisible` : le nom existe dans plats.js, qui écrit chaque morceau.)
 */
export function texteQuantites(totaux) {
  return famillesDe(totaux).filter((f) => ORDRE_FAMILLES.includes(f)).map((f) => {
    const { qte, unite } = achat(f, totaux[f]);
    return quantiteLisible(qte, unite);
  }).join(' + ');
}

// ——— Réglages des courses ———

/**
 * Réglages des courses avec leurs défauts (§3.5 du plan) → { rayons, drive, apero } : `rayons` (ordre du parcours,
 * `reglages.rayons` du foyer, T3d) : rayons inconnus et doublons ignorés, rayons manquants ajoutés à la fin dans l'ordre
 * de départ (LIBELLES_RAYON) ; `drive` (T3b) : { nom, urlRecherche } du foyer (drive.js › lireDrive : modèle https:
 * avec `{q}`), sinon null (pas réglé : aucun défaut, le dépôt est public) ; `apero` : { incontournables: [] } jusqu'à
 * T3e.
 */
export function reglagesCourses(reglages) {
  const depart = Object.keys(LIBELLES_RAYON);
  const lus = [...new Set(listeDe(reglages?.rayons).filter((rayon) => depart.includes(rayon)))];
  return {
    rayons: [...lus, ...depart.filter((rayon) => !lus.includes(rayon))],
    drive: lireDrive(reglages?.drive),
    apero: { incontournables: [] },
  };
}

/** Ordre des rayons du foyer (reglagesCourses). */
export function ordreRayons(reglages) {
  return reglagesCourses(reglages).rayons;
}

// ——— Placard ———

/** Ce qu'une unité de base d'une famille vaut en g (masse) et en ml (volume), d'après les équivalences. */
function conversionsDe(famille, equivalences) {
  const dimensions = {};
  if (famille === 'masse' || famille === 'volume') dimensions[famille] = 1;
  const generale = EQUIVALENCES[famille];
  if (generale) {
    if (estNombre(generale.g)) dimensions.masse = generale.g;
    if (estNombre(generale.ml)) dimensions.volume = generale.ml;
  }
  for (const [unite, valeur] of Object.entries(estObjet(equivalences) ? equivalences : {})) {
    if (!Object.hasOwn(FAMILLES, unite) || FAMILLES[unite][0] !== famille || !estObjet(valeur)) continue;
    const cible = versBase(valeur.qte, valeur.unite);
    if (!cible || (cible.famille !== 'masse' && cible.famille !== 'volume')) continue;
    dimensions[cible.famille] = cible.qte / FAMILLES[unite][1];
  }
  return dimensions;
}

/** Quantité d'une famille ramenée à une autre, par la masse ou le volume ; null si aucune équivalence ne les relie. */
function convertir(qte, de, vers, equivalences) {
  if (de === vers) return qte;
  const a = conversionsDe(de, equivalences);
  const b = conversionsDe(vers, equivalences);
  for (const dimension of ['masse', 'volume']) {
    if (a[dimension] && b[dimension]) return (qte * a[dimension]) / b[dimension];
  }
  return null;
}

/**
 * Vrai si le total tient dans le seuil du placard (seuil compris, tolérance) : il va dans « Déjà à la maison ? ».
 * Placard sans seuil (`{}`) → vrai, sauf une quantité en bottes (une botte est toujours un produit frais : « laurier
 * 1 botte » s'achète) ; comparaison impossible (pas de quantité, unité sans équivalence, seuil illisible) → faux : dans
 * le doute, on l'achète. Équivalences générales (EQUIVALENCES) et du produit, pour comparer seulement.
 */
export function dansLePlacard(totaux, placard, equivalences = null) {
  if (!estObjet(placard)) return false;
  if (estObjet(totaux) && estNombre(totaux.botte) && totaux.botte > 0) return false;
  if (placard.seuil === undefined && placard.unite === undefined) return true;
  const seuil = versBase(placard.seuil, placard.unite);
  if (!seuil) return false;
  const familles = famillesDe(totaux);
  if (!familles.length) return false;
  let total = 0;
  for (const famille of familles) {
    const converti = convertir(totaux[famille], famille, seuil.famille, equivalences);
    if (converti === null) return false;
    total += converti;
  }
  return total <= seuil.qte + ecartTolere(seuil.qte);
}

// ——— Coches ———

/**
 * Compare le total exact à ce qui a été pris (coche `{ q, le }`) → { cochee, dejaPris, reste } : cochée si, pour chaque
 * famille du total, il ne dépasse pas ce qui a été pris (tolérance) ; sinon à acheter, avec `dejaPris` (ce qui a été
 * pris) et `reste` (total − pris, pour les familles qui dépassent ; affiché arrondi à l'achat). Sans coche, ou si rien
 * de lisible n'a été pris : { cochee: false, dejaPris: null, reste: null }.
 */
export function etatCoche(totaux, coche) {
  const rien = { cochee: false, dejaPris: null, reste: null };
  if (!estObjet(coche)) return rien;
  const pris = estObjet(coche.q) ? coche.q : {};
  const prisDe = (f) => (estNombre(pris[f]) && pris[f] > 0 ? pris[f] : 0);
  const depasse = famillesDe(totaux).filter((f) => totaux[f] > prisDe(f) + ecartTolere(prisDe(f)));
  if (!depasse.length) return { cochee: true, dejaPris: null, reste: null };
  const dejaPris = {};
  for (const f of famillesDe(pris)) dejaPris[f] = pris[f];
  if (!Object.keys(dejaPris).length) return rien;
  const reste = {};
  for (const f of depasse) reste[f] = arrondi(totaux[f] - prisDe(f));
  return { cochee: false, dejaPris, reste };
}

/**
 * Ce qui est retenu en cochant → { q, le } : pour chaque famille, la quantité AFFICHÉE (arrondi d'achat) ramenée à
 * l'unité de base (1,25 pièce → 2 ; 583 g → 590 ; 1 250 g → 1 300) ; `le` : l'heure du téléphone (omise si illisible).
 */
export function valeurCoche(totaux, maintenant) {
  const q = {};
  for (const f of famillesDe(totaux)) q[f] = achat(f, totaux[f]).base;
  return estNombre(maintenant) ? { q, le: maintenant } : { q };
}

// ——— Écritures d'un geste (une coche = un chemin) ———

/**
 * Cocher ou décocher une ligne → { id, champs: { coches.<cle>: valeurCoche(totaux) | EFFACER } } : la quantité
 * affichée au moment du toucher. Une coche rangée sous la clé de repli est effacée aussi au décocher. { code:
 * 'invalide' } pour une semaine illisible ou une clé hors chemin sûr. Deux coches posées en même temps, même hors
 * ligne, ne touchent jamais le même chemin.
 */
export function ecrituresCoche(semaine, ligne, oui, { maintenant = null } = {}) {
  const lue = lireSemaine(semaine);
  const chemin = cheminSur('coches', ligne?.cle ?? '');
  if (!lue || !chemin || ligne?.type === 'article') return { code: 'invalide' };
  const champs = { [chemin]: oui ? valeurCoche(ligne.totaux, maintenant) : EFFACER };
  // Coches rangées sous les clés de repli : effacées au décocher, et au cocher, puisque la nouvelle coche dit tout ce
  // qui a été pris (elles s'ajouteraient sinon à elle).
  for (const cle of clesDeRepli(ligne)) {
    const repli = cheminSur('coches', cle);
    if (repli && repli !== chemin && Object.hasOwn(lue.coches, cle)) champs[repli] = EFFACER;
  }
  return { id: lue.id, champs };
}

/** Clés de repli d'une ligne : `replis`, sinon `repli` (une ligne calculée par une version d'avant). */
function clesDeRepli(ligne) {
  if (Array.isArray(ligne?.replis)) return ligne.replis.filter((cle) => typeof cle === 'string' && cle !== '');
  return typeof ligne?.repli === 'string' && ligne.repli !== '' ? [ligne.repli] : [];
}

/** Cocher ou décocher un article ajouté à la main → { articleId, champs: { coche: { le } | EFFACER } }. */
export function ecrituresCocheArticle(article, oui, { maintenant = null } = {}) {
  if (article?.type !== 'article' || typeof article.articleId !== 'string' || article.articleId === '') return { code: 'invalide' };
  if (!oui) return { articleId: article.articleId, champs: { coche: EFFACER } };
  return { articleId: article.articleId, champs: { coche: estNombre(maintenant) ? { le: maintenant } : {} } };
}

/**
 * « À racheter » d'un produit du placard → { id, champs: { racheter.<cle>: true | EFFACER } } ; `replis` (les clés de
 * repli de la ligne ; `repli` : une seule) : éteindre efface aussi `racheter.<repli>`, sinon la ligne resterait rachetée.
 */
export function ecrituresRachat(semaine, cle, oui, { repli = null, replis = null } = {}) {
  const lue = lireSemaine(semaine);
  const chemin = cheminSur('racheter', cle ?? '');
  if (!lue || !chemin) return { code: 'invalide' };
  const champs = { [chemin]: oui ? true : EFFACER };
  if (!oui) {
    for (const autre of clesDeRepli({ repli, replis })) {
      const cheminRepli = autre !== cle ? cheminSur('racheter', autre) : null;
      if (cheminRepli && Object.hasOwn(lue.racheter, autre)) champs[cheminRepli] = EFFACER;
    }
  }
  return { id: lue.id, champs };
}

// ——— La liste ———

/** Minuit local d'une date « AAAA-MM-JJ » (instant), ou null. */
function minuitLocal(jour) {
  const m = typeof jour === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour) : null;
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Portions de base lisibles d'une recette, ou null. */
const portionsBaseDe = (plat) => (estNombre(plat?.portionsBase) && plat.portionsBase > 0 ? plat.portionsBase : null);

/**
 * Liste calculée (jamais écrite) de la semaine montrée → { lignes, maison, articles, sansRecette, horsListe,
 * sansPortion, aVerifier, habituels, preparations } :
 * - `lignes` : une par produit (idProduit), à acheter ou cochées, rangées par rayon (ordreRayons), puis par nom ;
 * - `maison` : produits du placard sous leur seuil (« Déjà à la maison ? »), sauf rachetés (`racheter.<cle>`) et sauf
 *   un produit « À acheter chaque semaine » (T3d : l'habituel l'emporte sur le placard) ;
 * - `articles` : articles ajoutés à la main (`articles/{id}` avec `id`), cachés s'ils ont été cochés avant
 *   min(creeLe, minuit du début) de la semaine (sans semaine : cochés depuis plus de 2 jours, d'après `maintenant`) ;
 *   jamais dans le placard ; un article « lait » et une ligne « lait » restent deux lignes ;
 * - `sansRecette` : plats ⏳ (fiches) ; `horsListe` : [{ platId, plat (null si introuvable), etat }] (corbeille ou
 *   introuvable) ; `sansPortion` : plats que personne ne mange (fiches) ; `aVerifier` : [{ plat, produit }] (portions de
 *   base illisibles : `produit` null ; quantité ou unité illisible : le nom, la ligne existe sans quantité) ;
 * - `habituels` (T3d) : produits « À acheter chaque semaine » du foyer (habituelsDuFoyer), sautés compris (`saute` :
 *   « Pas cette semaine », pour pouvoir les remettre) ; [] sans semaine ;
 * - `preparations` (T3d) : préparations de chaque semaine (preparationsChaqueSemaine), sautées et sans recette
 *   comprises ; [] sans semaine.
 * Contributions, dans un ordre fixe : plats de la semaine (recette, versions servies), puis préparations de chaque
 * semaine (T3d : recette telle qu'elle est écrite, facteur 1, sauf `sansHebdo.<platId>`, source { type: 'hebdo',
 * platId, nom }), puis habituels (T3d : leur quantité, ou aucune, sauf `sansHabituel.<produitId>`, source { type:
 * 'habituel', produitId }) ; un habituel ou une préparation d'un produit déjà dans la liste s'ajoute à sa ligne. Rien de
 * tout cela sans semaine (une coche s'écrit dans la semaine).
 * Ligne : { type: 'ligne', cle, produitId, repli (la première de `replis`), replis (clés de repli), nom (majuscule),
 *   libelle (minuscules), rayon, totaux (exacts, par famille, en unités de base), quantite (affichée), sources: [{ type:
 *   'plat', platId, nom, pour?, style?, totaux } | { type: 'hebdo', platId, nom, totaux } | { type: 'habituel',
 *   produitId, totaux }], placard (produit du placard sous son seuil), rachetee, cochee, dejaPris, reste, recherche,
 *   rechercheFoyer, chaqueSemaine (T3d : toutes ses sources sont des habituels ou des préparations de chaque semaine :
 *   « Comme chaque semaine »), rayonDeDepart (T3d : le rayon sans réglage du foyer, produits.js › rayonDeDepart),
 *   rayonDuFoyer (T3d : le rayon vient de produits/{id}), placardProduit (T3d : ficheProduit().placard.valeur : null,
 *   {} ou { seuil, unite } ; l'interrupteur « Toujours dans mon placard » est allumé s'il n'est pas null), placardDuFoyer
 *   (T3d : réglé par le foyer), habituel (T3d : null, ou { actif: true, qte?, unite?, libelle? } du foyer, actif), habituelSaute
 *   (T3d : « Pas cette semaine » pour cet habituel) }.
 * Article : { type: 'article', cle: 'article:<id>', articleId, produitId, repli, replis, nom, libelle, precision, rayon,
 *   totaux: {}, quantite (la précision), sources: [], placard: false, rachetee: false, cochee, cocheLe, creeLe,
 *   dejaPris: null, reste: null, recherche, rechercheFoyer, chaqueSemaine: false, rayonDeDepart, rayonDuFoyer,
 *   placardProduit, placardDuFoyer, habituel, habituelSaute }. T3d : clé de repli (cleDeRepli du libellé) comme une
 *   ligne : « papier hygiénique », devenu « papier toilette » pour l'app, garde son mot cherché et son rayon.
 * `recherche` (T3b) : le mot cherché au drive, celui que le foyer a écrit (`rechercheFoyer` : `produits/{id}
 * .rechercheDrive` de la ligne, sinon de sa première clé de repli qui en a un, comme une coche), sinon `libelle` ;
 * `rechercheFoyer` : ce mot, ou null (« Revenir à « pâtes courtes » » seulement s'il existe).
 * `index` : indexDesRecettes(tousLesPlats) (calculé sinon) ; `produitsFoyer` : produits/{id} par id (T3b) ;
 * `evaluer` : celui de l'app (mémorisé). Rien n'est modifié en entrée.
 */
export function listeDeCourses(semaine, {
  tousLesPlats = [], profils = [], produitsFoyer = {}, articles = [], reglages = null, evaluer = undefined,
  index = null, maintenant = null,
} = {}) {
  const lue = lireSemaine(semaine);
  const idx = index instanceof Map ? index : indexDesRecettes(Array.isArray(tousLesPlats) ? tousLesPlats : []);
  const options = { tousLesPlats, profils, reglages, ...(typeof evaluer === 'function' ? { evaluer } : {}) };
  const elements = lue ? platsDeLaSemaine(lue, options) : [];
  const sortie = {
    lignes: [], maison: [], articles: [], sansRecette: [], horsListe: [], sansPortion: [], aVerifier: [], habituels: [],
    preparations: [],
  };

  // 1 à 3. Contributions de chaque plat retenu : recette (moins ce que les versions retirent), puis versions servies.
  const contributions = [];
  const noter = (brut, quantite, facteur, rang, rangProfil, source, plat) => {
    const nom = reduire(brut?.produit);
    const produitId = idProduit(nom);
    if (!produitId) {
      sortie.aVerifier.push({ plat, produit: nom });
      return;
    }
    const lu = versBase(quantite, brut.unite);
    if (!lu) sortie.aVerifier.push({ plat, produit: nom });
    contributions.push({
      rangPlat: rang, rangProfil, produitId, nom: nom.toLocaleLowerCase('fr-FR'),
      famille: lu?.famille ?? null, qte: lu ? lu.qte * facteur : null, source,
    });
  };
  elements.forEach((element, rangPlat) => {
    const { plat } = element;
    if (element.etat === 'sansRecette') {
      sortie.sansRecette.push(plat);
      return;
    }
    if (element.etat !== 'ok') {
      sortie.horsListe.push({ platId: element.platId, plat, etat: element.etat });
      return;
    }
    const total = element.aCuire + element.aCongeler;
    if (!(total > 0)) {
      sortie.sansPortion.push(plat);
      return;
    }
    const base = portionsBaseDe(plat);
    if (base === null) sortie.aVerifier.push({ plat, produit: null });
    const retires = new Map();
    for (const version of element.versions) {
      for (const produit of new Set(listeDe(version.variante?.retirer).map(slug).filter(Boolean))) {
        retires.set(produit, (retires.get(produit) ?? 0) + coefDe(version.profil) * element.repas);
      }
    }
    const sourceDe = (version) => ({
      type: 'plat', cle: `${element.platId}|${version?.profil.id ?? ''}`, platId: element.platId, nom: reduire(plat.nom),
      // Style seulement s'il s'affiche (semaine.js › versionServie, `nomme`) : « pour vous (votre version) » sinon.
      ...(version ? { pour: version.profil.id, ...(version.nomme === false ? {} : { style: version.style }) } : {}),
    });
    for (const ingredient of listeDe(plat.ingredients)) {
      if (!estObjet(ingredient)) continue;
      const retire = retires.get(slug(ingredient.produit)) ?? 0;
      const facteur = base === null ? 1 : Math.max(0, total - retire) / base;
      if (facteur <= TOLERANCE) continue; // personne ne mange cet ingrédient (toutes les parts le retirent)
      noter(ingredient, ingredient.qte, facteur, rangPlat, 0, sourceDe(null), plat);
    }
    element.versions.forEach((version, i) => {
      const parts = coefDe(version.profil) * element.repas;
      for (const ajout of listeDe(version.variante?.ajouter)) {
        if (estObjet(ajout)) noter(ajout, ajout.qtePortion, parts, rangPlat, i + 1, sourceDe(version), plat);
      }
    });
  });

  // 4. Préparations de chaque semaine (T3d) : la recette telle qu'elle est écrite ; puis habituels du foyer.
  let rang = elements.length;
  if (lue) {
    sortie.preparations = preparationsChaqueSemaine(lue, { tousLesPlats });
    for (const preparation of [...sortie.preparations].sort((a, b) => parId(a.platId, b.platId))) {
      const rangPrep = rang;
      rang += 1;
      if (preparation.saute || preparation.sansRecette) continue;
      const source = { type: 'hebdo', cle: `hebdo:${preparation.platId}`, platId: preparation.platId, nom: preparation.nom };
      for (const ingredient of listeDe(preparation.plat.ingredients)) {
        if (estObjet(ingredient)) noter(ingredient, ingredient.qte, 1, rangPrep, 0, source, preparation.plat);
      }
    }
    sortie.habituels = habituelsDuFoyer(produitsFoyer, lue, { index: idx });
    for (const habituel of sortie.habituels) {
      const rangHabituel = rang;
      rang += 1;
      if (habituel.saute) continue;
      const lu = versBase(habituel.habituel.qte, habituel.habituel.unite);
      contributions.push({
        rangPlat: rangHabituel, rangProfil: 0, produitId: habituel.produitId,
        nom: (habituel.habituel.libelle ?? '').toLocaleLowerCase('fr-FR'), famille: lu?.famille ?? null, qte: lu?.qte ?? null,
        source: { type: 'habituel', cle: `habituel:${habituel.produitId}`, produitId: habituel.produitId },
      });
    }
  }

  // 5. Agrégation par produit, dans un ordre fixe, puis arrondi au millionième.
  contributions.sort((a, b) => a.rangPlat - b.rangPlat || a.rangProfil - b.rangProfil || parId(a.produitId, b.produitId)
    || parId(a.famille ?? '', b.famille ?? '') || (a.qte ?? -1) - (b.qte ?? -1) || parId(a.nom, b.nom));
  const produits = new Map();
  for (const c of contributions) {
    if (!produits.has(c.produitId)) produits.set(c.produitId, { noms: [], totaux: {}, sources: new Map() });
    const produit = produits.get(c.produitId);
    if (c.nom && !produit.noms.includes(c.nom)) produit.noms.push(c.nom);
    const { cle: cleSource, ...source } = c.source;
    if (!produit.sources.has(cleSource)) produit.sources.set(cleSource, { ...source, totaux: {} });
    if (c.famille && c.qte > 0) {
      produit.totaux[c.famille] = (produit.totaux[c.famille] ?? 0) + c.qte;
      const sourceLue = produit.sources.get(cleSource);
      sourceLue.totaux[c.famille] = (sourceLue.totaux[c.famille] ?? 0) + c.qte;
    }
  }

  // 6 à 9. Fiche du produit, placard, coches.
  const coches = lue?.coches ?? {};
  const racheter = lue?.racheter ?? {};
  const sautes = new Set(sortie.habituels.filter((h) => h.saute).map((h) => h.produitId));
  for (const [produitId, produit] of produits) {
    const totaux = arrondirTotaux(produit.totaux);
    const sources = [...produit.sources.values()].map((s) => ({ ...s, totaux: arrondirTotaux(s.totaux) }));
    const saisie = produit.noms[0] ?? '';
    let fiche = ficheProduit(produitId, { produitsFoyer, index: idx, saisie });
    // Clés de repli (un id changé par les produits courants) : celle du nom affiché, puis celle de chaque écriture de
    // la semaine qui donne la ligne (le nom affiché vient de toutes les recettes du foyer : « farine » d'une autre
    // recette ne doit pas faire perdre la coche posée sous « farine-t55 ») ; jamais celle d'un homographe ni d'une
    // autre ligne (« pâté » n'hérite jamais de la coche des pâtes).
    const replis = [];
    for (const nom of [fiche.nom.valeur, ...produit.noms]) {
      const cle = cleDeRepli(nom, produitId);
      if (cle && !produits.has(cle) && !replis.includes(cle)) replis.push(cle);
    }
    const repli = replis[0] ?? null;
    if (repli) fiche = ficheProduit(produitId, { produitsFoyer, index: idx, saisie, replis });
    // Un produit « À acheter chaque semaine » n'est jamais mis de côté (T3d) : il est sur la liste.
    const avecHabituel = sources.some((s) => s.type === 'habituel');
    const placard = !avecHabituel && fiche.placard.valeur !== null
      && dansLePlacard(totaux, fiche.placard.valeur, fiche.equivalences.valeur);
    const rachetee = placard && [produitId, ...replis].some((cle) => racheter[cle] === true);
    const coche = cocheReunie([produitId, ...replis].filter((cle) => Object.hasOwn(coches, cle)).map((cle) => coches[cle]));
    const etat = placard && !rachetee ? { cochee: false, dejaPris: null, reste: null } : etatCoche(totaux, coche);
    const libelle = fiche.nom.valeur || saisie || nomDeRepli(produitId);
    const rechercheFoyer = motDuFoyer(produitsFoyer, [produitId, ...replis]);
    const ligne = {
      type: 'ligne', cle: produitId, produitId, repli, replis, nom: majuscule(libelle), libelle, rayon: fiche.rayon.valeur,
      totaux, quantite: texteQuantites(totaux), sources, placard, rachetee, ...etat, recherche: rechercheFoyer ?? libelle,
      rechercheFoyer, chaqueSemaine: sources.length > 0 && sources.every((s) => s.type !== 'plat'),
      ...reglagesDeLaFiche(fiche, produitId, idx, sautes),
    };
    (placard && !rachetee ? sortie.maison : sortie.lignes).push(ligne);
  }

  // 10. Articles ajoutés à la main.
  let borne = null;
  if (lue) borne = Math.min(lue.creeLe ?? Infinity, minuitLocal(lue.debut) ?? Infinity);
  else if (estNombre(maintenant)) borne = maintenant - ARTICLES_COCHES_JOURS * JOUR_MS;
  for (const article of listeDe(articles)) {
    if (!estObjet(article) || typeof article.id !== 'string' || article.id === '') continue;
    const libelle = reduire(article.libelle);
    if (!libelle) continue;
    const cochee = estObjet(article.coche);
    const cocheLe = cochee && estNombre(article.coche.le) ? article.coche.le : null;
    if (cocheLe !== null && borne !== null && Number.isFinite(borne) && cocheLe < borne) continue;
    const produitId = idProduit(libelle);
    const replis = [cleDeRepli(libelle, produitId)].filter(Boolean);
    const fiche = ficheProduit(produitId, { produitsFoyer, index: idx, saisie: libelle, replis });
    const precision = reduireQuantite(article.precision) || null;
    const rechercheFoyer = motDuFoyer(produitsFoyer, [produitId, ...replis]);
    sortie.articles.push({
      type: 'article', cle: `article:${article.id}`, articleId: article.id, produitId, repli: replis[0] ?? null, replis,
      nom: majuscule(libelle), libelle, precision, rayon: fiche.rayon.valeur, totaux: {}, quantite: precision ?? '',
      sources: [], placard: false, rachetee: false, cochee, cocheLe, creeLe: estNombre(article.creeLe) ? article.creeLe : null,
      dejaPris: null, reste: null, recherche: rechercheFoyer ?? libelle, rechercheFoyer, chaqueSemaine: false,
      ...reglagesDeLaFiche(fiche, produitId, idx, sautes),
    });
  }

  // 11. Ordre : rayon, nom, clé.
  const rangs = new Map(ordreRayons(reglages).map((rayon, i) => [rayon, i]));
  const parRayon = (a, b) => (rangs.get(a.rayon) ?? rangs.size) - (rangs.get(b.rayon) ?? rangs.size)
    || comparerNoms(a.nom, b.nom) || parId(a.cle, b.cle);
  sortie.lignes.sort(parRayon);
  sortie.articles.sort(parRayon);
  sortie.maison.sort((a, b) => comparerNoms(a.nom, b.nom) || parId(a.cle, b.cle));
  return sortie;
}

/**
 * Réglages du produit d'une ligne ou d'un article, pour la feuille ⋮ (T3d) : rayonDeDepart, rayonDuFoyer,
 * placardProduit, placardDuFoyer, habituel (actif du foyer, ou null), habituelSaute.
 */
function reglagesDeLaFiche(fiche, produitId, index, sautes) {
  return {
    rayonDeDepart: rayonDeDepart(produitId, { index }).valeur,
    rayonDuFoyer: fiche.rayon.source === 'foyer',
    placardProduit: fiche.placard.valeur,
    placardDuFoyer: fiche.placard.source === 'foyer',
    habituel: fiche.habituel.valeur,
    habituelSaute: sautes.has(produitId),
  };
}

/** Nom lisible d'un identifiant de produit sans autre nom connu (« croquette-pour-chat » → « croquette pour chat »). */
function nomDeRepli(id) {
  return typeof id === 'string' ? id.split('--')[0].replace(/-/g, ' ').trim() : '';
}

// ——— Chaque semaine (T3d) : préparations de chaque semaine et habituels ———

const ID_PRODUIT = /^[a-z0-9-]+$/;

/**
 * Vrai pour une préparation de chaque semaine (T3d) : type `preparation`, `recurrence: 'hebdo'`, identifiant sûr, hors
 * corbeille. Les mêmes plats que semaine.js › peutAllerDansLaSemaine écarte de « Ajouter à la semaine » : ils entrent
 * d'eux-mêmes dans chaque semaine.
 */
export function estPreparationHebdo(plat) {
  return estObjet(plat) && typeof plat.id === 'string' && ID_PRODUIT.test(plat.id) && typeDe(plat) === 'preparation'
    && plat.recurrence === 'hebdo' && !estDansCorbeille(plat);
}

/**
 * Préparations de chaque semaine (T3d, Semaine : « Chaque semaine aussi : Yaourts maison ») → [{ platId, plat, nom,
 * saute, sansRecette }], triées par nom puis identifiant : `saute` : « Pas cette semaine » (`sansHebdo.<platId>` de la
 * semaine vaut true) ; `sansRecette` : pas encore d'ingrédients (elle n'apporte rien à la liste). Une préparation déjà
 * dans les plats de la semaine (donnée d'une autre version) n'est pas reprise ici : jamais comptée deux fois. Sans
 * semaine, aucune n'est sautée.
 */
export function preparationsChaqueSemaine(semaine, { tousLesPlats = [] } = {}) {
  const lue = lireSemaine(semaine);
  const sans = estObjet(lue?.sansHebdo) ? lue.sansHebdo : {};
  const dansLaSemaine = new Set(Object.keys(lue?.plats ?? {}).filter((id) => estObjet(lue.plats[id])
    && estNombre(lue.plats[id].ajouteLe) && lue.plats[id].retire !== true));
  const vues = new Set();
  const preparations = [];
  for (const plat of listeDe(tousLesPlats)) {
    if (!estPreparationHebdo(plat) || vues.has(plat.id) || dansLaSemaine.has(plat.id)) continue;
    vues.add(plat.id);
    preparations.push({
      platId: plat.id, plat, nom: reduire(plat.nom) || 'Préparation sans nom', saute: sans[plat.id] === true,
      sansRecette: !aSaRecette(plat),
    });
  }
  return preparations.sort((a, b) => comparerNoms(a.nom, b.nom) || parId(a.platId, b.platId));
}

/** Documents `produits/{id}` du foyer (objet par id ou Map) → [[id, document]], identifiants sûrs, triés par id. */
function documentsDuFoyer(produitsFoyer) {
  let entrees = [];
  if (produitsFoyer instanceof Map) entrees = [...produitsFoyer];
  else if (estObjet(produitsFoyer)) entrees = Object.entries(produitsFoyer);
  return entrees.filter(([id, doc]) => typeof id === 'string' && ID_PRODUIT.test(id) && estObjet(doc))
    .sort(([a], [b]) => parId(a, b));
}

/**
 * Produits « À acheter chaque semaine » du foyer (T3d) → [{ produitId, cle, cles, nom, libelle, habituel, quantite,
 * totaux, saute }], triés par identifiant :
 * - `habituel` : `produits/{cle}.habituel` lu (produits.js › lireHabituel), actif seulement ; `cle` : le document qui le
 *   porte ; `produitId` : l'identifiant de la ligne, celui du nom gardé avec l'habituel (`libelle`, idProduit : un id
 *   changé par les produits courants rejoint la bonne ligne), sinon `cle`. Deux documents pour le même produit (son id
 *   et une clé de repli) : celui de l'id l'emporte, éteint ou pas ;
 * - `nom` : nom affiché (ficheProduit, sinon le nom gardé, sinon l'identifiant) ; `quantite` : « 1 l » ('' sans
 *   quantité) ; `totaux` : en unités de base ;
 * - `saute` : « Pas cette semaine » (`sansHabituel.<k>` de la semaine vaut true sous une de ses `cles` : `produitId`,
 *   `cle` et la clé de repli du nom gardé, comme une coche ; ecrituresSansHabituel les efface toutes au « remettre »).
 * `index` : indexDesRecettes (noms des recettes).
 */
export function habituelsDuFoyer(produitsFoyer, semaine = null, { index = new Map() } = {}) {
  const lue = lireSemaine(semaine);
  const sans = estObjet(lue?.sansHabituel) ? lue.sansHabituel : {};
  const parProduit = new Map();
  for (const [cle, doc] of documentsDuFoyer(produitsFoyer)) {
    const habituel = lireHabituel(doc.habituel);
    if (!habituel) continue;
    const produitId = (habituel.libelle && idProduit(habituel.libelle)) || cle;
    const deja = parProduit.get(produitId);
    if (!deja || (cle === produitId && deja.cle !== produitId)) parProduit.set(produitId, { cle, habituel });
  }
  const habituels = [];
  for (const [produitId, { cle, habituel }] of parProduit) {
    if (!habituel.actif) continue;
    const lu = versBase(habituel.qte, habituel.unite);
    const totaux = lu ? { [lu.famille]: arrondi(lu.qte) } : {};
    const fiche = ficheProduit(produitId, { produitsFoyer, index, saisie: habituel.libelle ?? '' });
    const libelle = fiche.nom.valeur || nomDeRepli(produitId);
    // « Pas cette semaine » se lit comme une coche : sous l'identifiant, le document qui porte l'habituel et la clé de
    // repli du nom gardé (un identifiant changé par une mise à jour de l'app ne fait pas revenir un habituel sauté).
    const cles = [...new Set([produitId, cle, cleDeRepli(habituel.libelle ?? '', produitId)])]
      .filter((k) => typeof k === 'string' && ID_PRODUIT.test(k));
    habituels.push({
      produitId, cle, cles, nom: majuscule(libelle), libelle, habituel, quantite: texteQuantites(totaux), totaux,
      saute: cles.some((k) => sans[k] === true),
    });
  }
  return habituels.sort((a, b) => parId(a.produitId, b.produitId));
}

/** `produits/{id}` du foyer (objet par id ou Map), ou null. */
function produitDuFoyer(produitsFoyer, id) {
  if (typeof id !== 'string' || id === '') return null;
  const valeur = produitsFoyer instanceof Map ? produitsFoyer.get(id)
    : estObjet(produitsFoyer) && Object.hasOwn(produitsFoyer, id) ? produitsFoyer[id] : null;
  return estObjet(valeur) ? valeur : null;
}

/** Mot cherché au drive écrit par le foyer sous la première de ces clés qui en a un (`rechercheDrive`), ou null. */
function motDuFoyer(produitsFoyer, cles) {
  for (const cle of cles) {
    const mot = reduire(produitDuFoyer(produitsFoyer, cle)?.rechercheDrive);
    if (mot) return mot;
  }
  return null;
}

/**
 * Coches d'une même ligne rangées sous plusieurs clés (son id et ses clés de repli : deux écritures réunies par les
 * produits courants, chacune cochée avant) → une seule coche, ce qui a été pris additionné famille par famille ;
 * undefined sans coche lisible. Une seule coche est rendue telle quelle.
 */
function cocheReunie(lues) {
  const valides = lues.filter(estObjet);
  if (valides.length <= 1) return valides[0];
  const q = {};
  let le = null;
  for (const coche of valides) {
    if (estObjet(coche.q)) {
      for (const f of famillesDe(coche.q)) if (estNombre(coche.q[f]) && coche.q[f] > 0) q[f] = arrondi((q[f] ?? 0) + coche.q[f]);
    }
    if (estNombre(coche.le)) le = le === null ? coche.le : Math.max(le, coche.le);
  }
  return le === null ? { q } : { q, le };
}

/** Totaux arrondis au millionième, familles positives seulement. */
function arrondirTotaux(totaux) {
  const propres = {};
  for (const f of famillesDe(totaux)) {
    const valeur = arrondi(totaux[f]);
    if (valeur > 0) propres[f] = valeur;
  }
  return propres;
}

/** Rang d'un rayon dans l'ordre du foyer (`rayons`, sinon l'ordre de départ) ; un rayon inconnu va à la fin. */
function rangeurDeRayons(rayons) {
  const ordre = Array.isArray(rayons) && rayons.length ? rayons : ordreRayons(null);
  const rangs = new Map(ordre.map((rayon, i) => [rayon, i]));
  return (rayon) => rangs.get(rayon) ?? rangs.size;
}

const parNomDeLigne = (a, b) => comparerNoms(a.nom, b.nom) || parId(a.cle, b.cle);

/**
 * Écran Courses : rayons dans l'ordre du foyer → { aAcheter: [{ rayon, libelle, lignes }], maison, panier, total, pris,
 * vide }. Lignes et articles à acheter rangés par rayon puis par nom ; `panier` : ceux qui sont cochés (« Dans le
 * panier ») ; `maison` : « Déjà à la maison ? » (hors des comptes). `total` : lignes et articles, cochés compris ;
 * `pris` : cochés ; `vide` : aucune ligne ni article (jamais « Tout est dans le panier » sur une liste vide).
 * `rayons` : ordreRayons(reglages) (ordre de départ sinon).
 */
export function grouperParRayon(liste, { rayons = null } = {}) {
  const rang = rangeurDeRayons(rayons);
  const elements = [...listeDe(liste?.lignes), ...listeDe(liste?.articles)];
  const groupes = new Map();
  for (const element of elements.filter((e) => !e.cochee)) {
    if (!groupes.has(element.rayon)) groupes.set(element.rayon, []);
    groupes.get(element.rayon).push(element);
  }
  const aAcheter = [...groupes].sort(([a], [b]) => rang(a) - rang(b) || parId(a, b))
    .map(([rayon, lignes]) => ({ rayon, libelle: LIBELLES_RAYON[rayon] ?? LIBELLES_RAYON.divers, lignes: lignes.sort(parNomDeLigne) }));
  const panier = elements.filter((e) => e.cochee).sort((a, b) => rang(a.rayon) - rang(b.rayon) || parNomDeLigne(a, b));
  return {
    aAcheter, maison: listeDe(liste?.maison), panier, total: elements.length, pris: panier.length,
    vide: elements.length === 0,
  };
}

/**
 * Écran Courses en mode Drive (T3b, décision 17) → { pourCetteSemaine, commeChaqueSemaine, panier, maison, total,
 * pris, vide } : trois listes à plat, sans en-têtes de rayon, chacune rangée par rayon (ordre du foyer) puis par nom :
 * `pourCetteSemaine` (lignes des plats et articles ajoutés à la main, à acheter ; une ligne d'un habituel ou d'une
 * préparation qui sert aussi un plat de la semaine en fait partie), `commeChaqueSemaine` (T3d : lignes à acheter dont
 * toutes les sources sont des habituels ou des préparations de chaque semaine, `chaqueSemaine`), `panier` (cochés,
 * « Dans le panier ») ; `maison`, `total`, `pris` et `vide` comme grouperParRayon (mêmes comptes dans les deux modes).
 */
export function grouperDrive(liste, { rayons = null } = {}) {
  const rang = rangeurDeRayons(rayons);
  const ordre = (a, b) => rang(a.rayon) - rang(b.rayon) || parNomDeLigne(a, b);
  const elements = [...listeDe(liste?.lignes), ...listeDe(liste?.articles)];
  const panier = elements.filter((e) => e.cochee).sort(ordre);
  return {
    pourCetteSemaine: elements.filter((e) => !e.cochee && e.chaqueSemaine !== true).sort(ordre),
    commeChaqueSemaine: elements.filter((e) => !e.cochee && e.chaqueSemaine === true).sort(ordre),
    panier,
    maison: listeDe(liste?.maison),
    total: elements.length,
    pris: panier.length,
    vide: elements.length === 0,
  };
}

/**
 * « Au drive, je cherche » (T3b) pour une ligne ou un article → { terme, ecritures: [{ id, champs: { rechercheDrive:
 * terme | EFFACER } }] } (`produits/{id}` : `set` + `mergeFields` du seul champ, donnees.js) | { erreur: 'long' }
 * (ERREURS_ARTICLE.long : 60 caractères au plus) | { code: 'invalide' } (pas de produit lisible) :
 * - un mot (espaces réduits) → écrit sous le produit de la ligne (`produitId`), `terme` : ce mot ;
 * - vide, ou le nom de la ligne (casse ignorée, accents comptés : « Pâtes courtes » pour « pâtes courtes », mais
 *   « pates courtes » est un mot choisi) → retour au nom
 *   (« Revenir à « pâtes courtes » ») : `terme` null, le mot effacé sous chaque clé de la ligne qui en porte un (son
 *   produit et ses clés de repli, comme une coche) ; aucune écriture si aucune n'en porte.
 * `produitsFoyer` : produits/{id} par id (objet ou Map).
 */
export function ecrituresRecherche(ligne, saisie, { produitsFoyer = {} } = {}) {
  const produitId = ligne?.produitId;
  if (!cheminSur('produits', typeof produitId === 'string' ? produitId : '')) return { code: 'invalide' };
  const terme = reduire(saisie);
  if (terme.length > RECHERCHE_MAX) return { erreur: 'long' };
  const libelle = reduire(ligne.libelle);
  if (terme && terme.toLocaleLowerCase('fr-FR') !== libelle.toLocaleLowerCase('fr-FR')) {
    return { terme, ecritures: [{ id: produitId, champs: { rechercheDrive: terme } }] };
  }
  const cles = [...new Set([produitId, ...clesDeRepli(ligne)])].filter((cle) => cheminSur('produits', cle));
  const ecritures = cles.filter((cle) => reduire(produitDuFoyer(produitsFoyer, cle)?.rechercheDrive))
    .map((cle) => ({ id: cle, champs: { rechercheDrive: EFFACER } }));
  return { terme: null, ecritures };
}

// ——— Réglages d'un produit (T3d) : rayon, placard, habituel ; chacun `set` + `mergeFields` du seul champ ———

/** Clés d'une ligne ou d'un article où lire et effacer les réglages de son produit : son id, puis ses clés de repli. */
const clesDeLaLigne = (ligne) => clesDuProduit(ligne?.produitId, { replis: clesDeRepli(ligne) })
  .filter((cle) => cheminSur('produits', cle));

/** Écritures qui effacent un champ sous chaque clé qui en porte un lisible (`lire`), sauf `sauf`. */
function effacerSous(produitsFoyer, cles, champ, lire, sauf = null) {
  return cles.filter((cle) => cle !== sauf && lire(produitDuFoyer(produitsFoyer, cle)?.[champ]) !== null)
    .map((cle) => ({ id: cle, champs: { [champ]: EFFACER } }));
}

/**
 * « Rayon : Épicerie salée · Changer » (feuille ⋮, T3d) → { rayon, ecritures: [{ id, champs: { rayon: r | EFFACER } }] }
 * (`produits/{id}` : `set` + `mergeFields` du seul champ, donnees.js) | { code: 'invalide' } (rayon hors des 14, ou
 * produit illisible) :
 * - le rayon de départ de la ligne (`ligne.rayonDeDepart`, produits.js › rayonDeDepart : recettes, produit courant,
 *   Divers) : le réglage du foyer est effacé sous chaque clé qui en porte un (son produit et ses clés de repli) ;
 *   produits/{id} ne garde que des différences ;
 * - un autre rayon : écrit sous le produit de la ligne (`produitId`), sauf s'il y est déjà (aucune écriture).
 * `ecritures` vide : rien à envoyer. Le rayon sert les semaines suivantes, dans les deux modes.
 */
export function ecrituresRayon(ligne, rayon, { produitsFoyer = {} } = {}) {
  const produitId = ligne?.produitId;
  if (!lireRayonFoyer(rayon) || !cheminSur('produits', typeof produitId === 'string' ? produitId : '')) return { code: 'invalide' };
  const cles = clesDeLaLigne(ligne);
  const depart = lireRayonFoyer(ligne.rayonDeDepart) ?? lireRayonFoyer(entreeParId(produitId)?.rayon) ?? 'divers';
  if (rayon === depart) return { rayon, ecritures: effacerSous(produitsFoyer, cles, 'rayon', lireRayonFoyer) };
  if (lireRayonFoyer(produitDuFoyer(produitsFoyer, produitId)?.rayon) === rayon) return { rayon, ecritures: [] };
  return { rayon, ecritures: [{ id: produitId, champs: { rayon } }] };
}

/**
 * Interrupteur « Toujours dans mon placard » (feuille ⋮ ; carte « 🏠 Placard » de Réglages, T3d ; décision du placard
 * du 2026-10-11) → { actif, ecritures: [{ id, champs: { placard: { actif } | EFFACER } }] } | { code: 'invalide' } :
 * - revenir au départ (allumer un produit du placard de départ, éteindre un produit qui n'en est pas) : le réglage du
 *   foyer est effacé sous chaque clé qui en porte un ;
 * - éteindre un produit du placard de départ : `{ actif: false }` (il revient sur la liste) ; allumer un autre produit
 *   (beurre demi-sel, harissa…) : `{ actif: true }` (toujours mis de côté ; un produit à seuil garde son seuil de
 *   départ), sous son produit, et effacé sous ses clés de repli ;
 * - rien qui change : `ecritures` vide.
 * `ligne` : une ligne, un article ou { produitId } (Réglages).
 */
export function ecrituresPlacard(ligne, oui, { produitsFoyer = {} } = {}) {
  const produitId = ligne?.produitId;
  if (!cheminSur('produits', typeof produitId === 'string' ? produitId : '')) return { code: 'invalide' };
  const actif = Boolean(oui);
  const cles = clesDeLaLigne(ligne);
  const deDepart = estObjet(entreeParId(produitId)?.placard);
  if (actif === deDepart) return { actif, ecritures: effacerSous(produitsFoyer, cles, 'placard', lirePlacardFoyer) };
  const avant = reglageDuFoyer(produitsFoyer, cles, 'placard', lirePlacardFoyer)?.valeur ?? null;
  const ecrit = lirePlacardFoyer(produitDuFoyer(produitsFoyer, produitId)?.placard);
  const autres = effacerSous(produitsFoyer, cles, 'placard', lirePlacardFoyer, produitId);
  if (ecrit?.actif === actif) return { actif, ecritures: autres };
  // Le nom de la ligne nomme le produit dans la carte « 🏠 Placard », même si plus aucune recette ne le porte.
  const libelle = libelleDuProduit(ligne, produitId, avant?.libelle);
  return { actif, ecritures: [{ id: produitId, champs: { placard: { actif, ...(libelle ? { libelle } : {}) } } }, ...autres] };
}

/**
 * Nom gardé avec un réglage du foyer (habituel, placard) : celui de la ligne, sinon celui d'avant, seulement s'il redonne
 * le même identifiant (idProduit) ; HABITUEL_LIBELLE_MAX caractères au plus ; '' sinon.
 */
function libelleDuProduit(ligne, produitId, avant = '') {
  const nomDeLaLigne = reduire(ligne?.libelle).slice(0, HABITUEL_LIBELLE_MAX).trim();
  return [nomDeLaLigne, reduire(avant)].find((nom) => nom && idProduit(nom) === produitId) ?? '';
}

/** Erreurs de la quantité de « À acheter chaque semaine » (T3d). */
export const ERREURS_HABITUEL = Object.freeze({
  quantite: 'Écrivez un nombre plus grand que 0.',
  grande: `${HABITUEL_QTE_MAX}\u00A0au plus.`,
  unite: 'Choisissez une unité.',
});

/**
 * Nombre tapé (« 0,5 », « 2 », « 1.5 ») → nombre ; null si rien n'est tapé ; NaN s'il est illisible. Un nombre déjà
 * lu passe tel quel.
 */
export function lireNombreSaisi(saisie) {
  if (saisie === null || saisie === undefined) return null;
  if (typeof saisie === 'number') return Number.isFinite(saisie) ? saisie : Number.NaN;
  const texte = String(saisie).replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  if (!texte) return null;
  return /^\d+(\.\d+)?$|^\.\d+$/.test(texte) ? Number(texte) : Number.NaN;
}

/**
 * Interrupteur « À acheter chaque semaine » et sa « Quantité (facultatif) » (feuille ⋮, T3d) → { habituel, ecritures:
 * [{ id, champs: { habituel: valeur | EFFACER } }] } | { erreur: 'quantite' | 'grande' | 'unite' } (ERREURS_HABITUEL) |
 * { code: 'invalide' } :
 * - allumer : `{ actif: true, qte?, unite?, libelle }` sous le produit de la ligne (`libelle` : son nom, qui nomme le
 *   produit même hors des recettes et des produits courants, gardé seulement s'il redonne le même identifiant
 *   (idProduit) ; `qte` arrondie au centième, plus grande que 0,
 *   HABITUEL_QTE_MAX au plus, avec une unité de l'écran ; sans quantité tapée : sans quantité) ;
 * - éteindre : `{ actif: false }` avec la quantité et le nom d'avant (rallumé, il les retrouve) ;
 * - un habituel rangé sous une clé de repli est effacé là (jamais deux habituels pour un produit) ;
 * - rien qui change : `ecritures` vide.
 * `habituel` rendu : la valeur écrite (lireHabituel la relit telle quelle).
 */
export function ecrituresHabituel(ligne, { actif = true, qte = null, unite = null } = {}, { produitsFoyer = {} } = {}) {
  const produitId = ligne?.produitId;
  if (!cheminSur('produits', typeof produitId === 'string' ? produitId : '')) return { code: 'invalide' };
  const cles = clesDeLaLigne(ligne);
  const avant = reglageDuFoyer(produitsFoyer, cles, 'habituel', lireHabituel)?.valeur ?? null;
  // Le nom gardé retrouve le produit (habituelsDuFoyer) : seulement s'il donne bien cet identifiant.
  const libelle = libelleDuProduit(ligne, produitId, avant?.libelle);
  let habituel;
  if (actif) {
    const nombre = lireNombreSaisi(qte);
    let quantite = null;
    if (nombre !== null) {
      const arrondie = Math.round(nombre * 100) / 100;
      if (!Number.isFinite(arrondie) || arrondie <= 0) return { erreur: 'quantite' };
      if (arrondie > HABITUEL_QTE_MAX) return { erreur: 'grande' };
      if (!UNITES_EDITION.includes(unite)) return { erreur: 'unite' };
      quantite = { qte: arrondie, unite };
    }
    habituel = { actif: true, ...(quantite ?? {}), ...(libelle ? { libelle } : {}) };
  } else {
    if (!avant) return { habituel: null, ecritures: effacerSous(produitsFoyer, cles, 'habituel', lireHabituel) };
    habituel = { actif: false, ...(avant.qte !== undefined ? { qte: avant.qte, unite: avant.unite } : {}),
      ...(libelle ? { libelle } : {}) };
  }
  const autres = effacerSous(produitsFoyer, cles, 'habituel', lireHabituel, produitId);
  const ecrit = lireHabituel(produitDuFoyer(produitsFoyer, produitId)?.habituel);
  if (ecrit && JSON.stringify(ecrit) === JSON.stringify(habituel)) return { habituel, ecritures: autres };
  return { habituel, ecritures: [{ id: produitId, champs: { habituel } }, ...autres] };
}

// ——— Réglages de la semaine (T3d) : « Pas cette semaine » ———

/**
 * « Pas cette semaine » d'un habituel (feuille ⋮) → { id, champs: { sansHabituel.<produitId>: true | EFFACER } } |
 * { code: 'invalide' } : un seul chemin de la semaine montrée, `update` en lot (aucune transaction) ; remettre efface le
 * chemin, et celui de chacune des autres `cles` du même habituel qui en porte un (habituelsDuFoyer › cles). La semaine
 * suivante, l'habituel revient de lui-même.
 */
export function ecrituresSansHabituel(semaine, produitId, oui, { cles = [] } = {}) {
  const lue = lireSemaine(semaine);
  const cle = cheminSur(typeof produitId === 'string' ? produitId : '');
  const chemin = cle ? `sansHabituel.${cle}` : null;
  if (!lue || !chemin) return { code: 'invalide' };
  const champs = { [chemin]: oui ? true : EFFACER };
  // Remettre : le saut posé sous une autre clé du même habituel (habituelsDuFoyer › cles) est effacé aussi.
  if (!oui) {
    const sans = estObjet(lue.sansHabituel) ? lue.sansHabituel : {};
    for (const autre of listeDe(cles)) {
      const autreChemin = typeof autre === 'string' && autre !== cle ? cheminSur(autre) : null;
      if (autreChemin && sans[autre] === true) champs[`sansHabituel.${autreChemin}`] = EFFACER;
    }
  }
  return { id: lue.id, champs };
}

/**
 * « Pas cette semaine » d'une préparation de chaque semaine (Semaine, « Chaque semaine aussi ») → { id, champs: {
 * sansHebdo.<platId>: true | EFFACER } } | { code: 'invalide' } ; même règle.
 */
export function ecrituresSansHebdo(semaine, platId, oui) {
  const lue = lireSemaine(semaine);
  const cle = cheminSur(typeof platId === 'string' ? platId : '');
  const chemin = cle ? `sansHebdo.${cle}` : null;
  if (!lue || !chemin) return { code: 'invalide' };
  return { id: lue.id, champs: { [chemin]: oui ? true : EFFACER } };
}

// ——— Article : « Précision (facultatif) » (T3d) ———

/** Erreur de la précision d'un article. */
export const ERREURS_PRECISION = Object.freeze({ long: `${PRECISION_MAX}\u00A0caractères au plus.` });

/**
 * « Précision (facultatif) » d'un article ajouté à la main (feuille ⋮) → { articleId, champs: { precision: texte |
 * EFFACER } } (`update` du seul champ ; un article supprimé entre-temps n'est jamais recréé) | { erreur: 'long' }
 * (PRECISION_MAX caractères au plus) | { code: 'invalide' | 'inchange' } : espaces réduits (les insécables d'une
 * quantité gardées) ; vide : la précision est effacée.
 */
export function ecrituresPrecision(article, saisie) {
  if (article?.type !== 'article' || typeof article.articleId !== 'string' || article.articleId === '') return { code: 'invalide' };
  const texte = reduireQuantite(typeof saisie === 'string' ? saisie : '');
  if (texte.length > PRECISION_MAX) return { erreur: 'long' };
  if (texte === (reduireQuantite(article.precision ?? '') || '')) return { code: 'inchange' };
  return { articleId: article.articleId, champs: { precision: texte || EFFACER } };
}

// ——— Ordre des rayons (T3d) ———

/** Ordre des rayons de départ (LIBELLES_RAYON) : celui d'un foyer qui n'a rien réglé. */
export const RAYONS_DE_DEPART = Object.freeze(Object.keys(LIBELLES_RAYON));

/** Ordre lu (reglagesCourses) ; `sens` : -1 monte, +1 descend ; un rayon inconnu ou au bord : l'ordre tel quel (copie). */
export function deplacerRayon(ordre, rayon, sens) {
  const lu = reglagesCourses({ rayons: Array.isArray(ordre) ? ordre : [] }).rayons;
  const i = lu.indexOf(rayon);
  const j = i + (sens < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= lu.length) return lu;
  [lu[i], lu[j]] = [lu[j], lu[i]];
  return lu;
}

/** « ↑ » : le rayon monte d'un cran. */
export const monterRayon = (ordre, rayon) => deplacerRayon(ordre, rayon, -1);
/** « ↓ » : le rayon descend d'un cran. */
export const descendreRayon = (ordre, rayon) => deplacerRayon(ordre, rayon, 1);

/**
 * « Enregistrer » de l'écran « Ordre des rayons » (Courses, mode Magasin ; Réglages) → { champs: { rayons: [14 rayons] |
 * EFFACER } } (`update` du seul champ de `reglages/foyer`, la liste entière : rare ; jamais un `set` du document) |
 * { code: 'invalide' | 'inchange' } : l'ordre de départ efface le réglage (« Remettre l'ordre de départ » puis
 * « Enregistrer ») ; le même ordre que celui du foyer : rien. `ordre` lu par reglagesCourses (inconnus et doublons
 * ignorés, manquants ajoutés).
 */
export function ecrituresRayons(ordre, { reglages = null } = {}) {
  if (!Array.isArray(ordre) || !ordre.length) return { code: 'invalide' };
  const nouveau = reglagesCourses({ rayons: ordre }).rayons;
  const ecrit = Array.isArray(reglages?.rayons);
  const memeQue = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);
  if (memeQue(nouveau, RAYONS_DE_DEPART)) return ecrit ? { champs: { rayons: EFFACER } } : { code: 'inchange' };
  if (ecrit && memeQue(nouveau, reglagesCourses(reglages).rayons)
    && memeQue(nouveau, reglages.rayons)) return { code: 'inchange' };
  return { champs: { rayons: nouveau } };
}

/** « Monter « Crèmerie » », « Descendre « Crèmerie » » (`aria-label` des boutons « ↑ » et « ↓ »). */
export function texteDeplacerRayon(rayon, sens) {
  const libelle = LIBELLES_RAYON[rayon] ?? LIBELLES_RAYON.divers;
  return `${sens < 0 ? 'Monter' : 'Descendre'} «\u00A0${libelle}\u00A0»`;
}

// ——— Récents de « Ajouter à la liste » (T3d, sur le téléphone) ———

/** Nombre d'articles récents gardés (puces « Récents »). */
export const RECENTS_MAX = 8;

/** Clé `localStorage` des récents de ce compte sur ce téléphone ; '' sans compte. */
export function cleRecents(uid) {
  return typeof uid === 'string' && uid.trim() !== '' ? `repas-courses:recents:${uid.trim()}` : '';
}

/** Même article : même produit (idProduit), sinon même nom (casse ignorée). */
const cleDeRecent = (libelle) => idProduit(libelle) || libelle.toLocaleLowerCase('fr-FR');

/**
 * Récents lus (`localStorage` : texte JSON ou tableau) → [libellé], le plus récent d'abord, RECENTS_MAX au plus, un seul
 * par produit, chacun de 1 à ARTICLE_MAX caractères ; [] si illisible.
 */
export function lireRecents(valeur) {
  let liste = valeur;
  if (typeof valeur === 'string') {
    try {
      liste = JSON.parse(valeur);
    } catch {
      return [];
    }
  }
  const vus = new Set();
  const recents = [];
  for (const brut of listeDe(liste)) {
    const libelle = reduire(brut);
    if (!libelle || libelle.length > ARTICLE_MAX || vus.has(cleDeRecent(libelle))) continue;
    vus.add(cleDeRecent(libelle));
    recents.push(libelle);
    if (recents.length >= RECENTS_MAX) break;
  }
  return recents;
}

/** Récents après l'ajout d'un article : lui d'abord (le même produit tapé avant est retiré), RECENTS_MAX au plus. */
export function ajouterAuxRecents(recents, libelle) {
  const propre = reduire(libelle);
  const avant = lireRecents(recents);
  if (!propre || propre.length > ARTICLE_MAX) return avant;
  return lireRecents([propre, ...avant]);
}

// ——— Placard du foyer (Réglages, T3d) ———

/** Mot d'une pièce, par produit courant, quand ce n'est pas « pièce » : l'ail se compte en gousses (§9 : « 2 gousses »). */
const PIECES = Object.freeze({ ail: Object.freeze(['gousse', 'gousses']) });

/**
 * « Toujours mis de côté. » (sans seuil) ; « Mis de côté si la semaine en demande 30 g au plus. » (seuil de départ :
 * produits courants ; en pièces, le mot du produit : « 2 gousses » pour l'ail, `produitId`) ; '' si le produit n'est
 * pas dans le placard (`placard` null).
 */
export function textePlacard(placard, { produitId = null } = {}) {
  if (!estObjet(placard)) return '';
  if (placard.seuil === undefined && placard.unite === undefined) return TEXTES_T3D.toujours;
  const [une, plusieurs] = PIECES[produitId] ?? ['pièce', 'pièces'];
  const quantite = placard.unite === 'pc'
    ? `${new Intl.NumberFormat('fr-FR').format(placard.seuil)}\u00A0${placard.seuil > 1 ? plusieurs : une}`
    : quantiteLisible(placard.seuil, placard.unite);
  return `Mis de côté si la semaine en demande ${quantite} au plus.`;
}

/**
 * Carte « 🏠 Placard » de Réglages → [{ produitId, nom, actif, deDepart, texte }] : les produits que le foyer a réglés
 * (`produits/{id}.placard { actif }`), mis de côté (`actif`) ou éteints, triés par nom ; `deDepart` : du placard de
 * départ ; `texte` : textePlacard (mis de côté), sinon ''. Pas la liste entière des produits du placard de départ.
 * Nom : celui des recettes ou du produit courant, sinon celui gardé avec le réglage (`placard.libelle`), sinon
 * l'identifiant. `index` : indexDesRecettes (noms des recettes).
 */
export function placardDuFoyer(produitsFoyer, { index = new Map() } = {}) {
  const produits = [];
  for (const [produitId, doc] of documentsDuFoyer(produitsFoyer)) {
    const reglage = lirePlacardFoyer(doc.placard);
    if (!reglage) continue;
    const fiche = ficheProduit(produitId, { produitsFoyer, index });
    const libelle = fiche.nom.valeur || reglage.libelle || nomDeRepli(produitId);
    produits.push({
      produitId, nom: majuscule(libelle), actif: reglage.actif, deDepart: estObjet(entreeParId(produitId)?.placard),
      texte: reglage.actif ? textePlacard(fiche.placard.valeur, { produitId }) : '',
    });
  }
  return produits.sort((a, b) => comparerNoms(a.nom, b.nom) || parId(a.produitId, b.produitId));
}

/** « Rayon : Épicerie salée » (feuille ⋮). */
export function texteRayon(rayon) {
  return `Rayon\u00A0: ${LIBELLES_RAYON[rayon] ?? LIBELLES_RAYON.divers}`;
}

/** « Chaque semaine aussi : Yaourts maison », « … : Yaourts maison et Pain de mie maison » ; '' sans préparation. */
export function texteChaqueSemaineAussi(preparations) {
  const noms = listeDe(preparations).map((p) => reduire(typeof p === 'string' ? p : p?.nom)).filter(Boolean);
  return noms.length ? `${TEXTES_T3D.chaqueSemaineAussi}\u00A0: ${enumerer(noms)}` : '';
}

/** Textes fixes de T3d (feuille ⋮, Semaine, Courses, Ordre des rayons, Réglages), tels que le plan les écrit. */
export const TEXTES_T3D = Object.freeze({
  changer: 'Changer',
  suivantes: 'Il servira les semaines suivantes.',
  placard: 'Toujours dans mon placard',
  toujours: 'Toujours mis de côté.',
  habituel: 'À acheter chaque semaine',
  quantite: 'Quantité (facultatif)',
  pasCetteSemaine: 'Pas cette semaine',
  precision: 'Précision (facultatif)',
  commeChaqueSemaine: 'Comme chaque semaine',
  chaqueSemaineAussi: 'Chaque semaine aussi',
  ordreRayons: 'Ordre des rayons',
  ordreDeDepart: 'Remettre l’ordre de départ',
  enregistrer: 'Enregistrer',
  recents: 'Récents',
  placardReglages: '🏠 Placard',
  // Relecture de T3d : mot visible de l'interrupteur de la carte « 🏠 Placard », et la ligne d'un produit éteint.
  misDeCote: 'Mis de côté',
  achete: 'Acheté quand vos plats en demandent.',
  // Relecture de T3d : « Ordre des rayons », on choisit un rayon, puis « Monter » ou « Descendre » (en bas de la
  // feuille, toujours à la même place : plusieurs touchers déplacent toujours le même rayon).
  aideOrdre: 'Touchez un rayon, puis montez-le ou descendez-le.',
  monter: 'Monter',
  descendre: 'Descendre',
});

// ——— Textes ———

const nomDe = (profil) => reduire(profil?.nom) || 'Sans prénom';
/** « a et b », « a, b et c » */
const enumerer = (mots) => (mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}` : mots.join(''));
const pluriel = (n, singulier, plurielDe = `${singulier}s`) => `${n}\u00A0${n > 1 ? plurielDe : singulier}`;

/**
 * Origine d'une ligne (seconde ligne de Courses, après la quantité) : « Gratin, Salade de pâtes » ; une version :
 * « pour Adulte B (version mer) », « pour vous (version mer) » ; version d'un profil sans styles (source sans `style`) :
 * « pour Adulte A (sa version) », « pour vous (votre version) » ; article : « Ajouté à la main ». T3d : un habituel,
 * « chaque semaine » ; une préparation de chaque semaine, « chaque semaine : Yaourts maison ». Mêmes mots pour les
 * deux rôles : jamais de croix.
 */
export function texteOrigine(ligne, { profils = [], moi = null } = {}) {
  if (ligne?.type === 'article') return 'Ajouté à la main';
  const morceaux = [];
  for (const source of listeDe(ligne?.sources)) {
    let morceau;
    if (source?.type === 'habituel') morceau = 'chaque semaine';
    else if (source?.type === 'hebdo') morceau = `chaque semaine\u00A0: ${reduire(source.nom) || 'Préparation sans nom'}`;
    else if (source.pour) {
      const profil = listeDe(profils).find((p) => p?.id === source.pour);
      const pourMoi = Boolean(moi) && moi.id === source.pour;
      const style = LIBELLES_STYLE[source.style];
      const laquelle = style ? `version ${style}` : pourMoi ? 'votre version' : 'sa version';
      morceau = `pour ${pourMoi ? 'vous' : nomDe(profil)} (${laquelle})`;
    } else morceau = reduire(source.nom) || 'Plat sans nom';
    if (!morceaux.includes(morceau)) morceaux.push(morceau);
  }
  return morceaux.join(', ');
}

/** Seconde ligne d'une ligne prise en partie : « Déjà pris : 600 g · encore 200 g » ; '' sinon. */
export function texteDejaPris(ligne) {
  if (!ligne?.dejaPris || !ligne?.reste) return '';
  return `Déjà pris\u00A0: ${texteQuantites(ligne.dejaPris)} · encore ${texteQuantites(ligne.reste)}`;
}

/**
 * Une source de la feuille d'un article (⋮) : « Gratin de pâtes · 400 g » ; « Version mer d'Adulte B · Gratin ·
 * 100 g » ; pour soi : « Votre version mer · Gratin · 100 g » ; profil sans styles : « Version d'Adulte A · … »,
 * « Votre version · … ». Sans quantité, le nom seul. T3d : « Chaque semaine · 1 l » (habituel), « Chaque semaine :
 * Yaourts maison · 1 l » (préparation de chaque semaine).
 */
export function texteSource(source, { profils = [], moi = null } = {}) {
  const quantite = texteQuantites(source?.totaux);
  if (source?.type === 'habituel' || source?.type === 'hebdo') {
    const quoi = source.type === 'habituel' ? 'Chaque semaine'
      : `Chaque semaine\u00A0: ${reduire(source.nom) || 'Préparation sans nom'}`;
    return quantite ? `${quoi} · ${quantite}` : quoi;
  }
  const nom = reduire(source?.nom) || 'Plat sans nom';
  const morceaux = [];
  if (source?.pour) {
    const style = LIBELLES_STYLE[source.style];
    const profil = listeDe(profils).find((p) => p?.id === source.pour);
    const mot = style ? ` ${style}` : '';
    morceaux.push(moi && moi.id === source.pour ? `Votre version${mot}` : `Version${mot} ${deNom(nomDe(profil))}`);
  }
  morceaux.push(nom);
  if (quantite) morceaux.push(quantite);
  return morceaux.join(' · ');
}

/**
 * Article tapé dans « Ajouter à la liste » → { erreur: 'vide' | 'long' } (ERREURS_ARTICLE) | { donnees: { libelle },
 * aussi: null | { nom, quantite } } : `aussi`, la ligne du même produit déjà dans la liste (l'ajout reste fait ; la
 * feuille le dit sans ressembler à un refus : « ✓ « Lait » ajouté. Il y en a aussi 6 l pour vos plats. »).
 */
export function preparerAjout(libelle, { liste = null } = {}) {
  const propre = reduire(libelle);
  if (!propre) return { erreur: 'vide' };
  if (propre.length > ARTICLE_MAX) return { erreur: 'long' };
  const produitId = idProduit(propre);
  const meme = produitId ? listeDe(liste?.lignes).find((ligne) => ligne?.produitId === produitId) : null;
  if (!meme) return { donnees: { libelle: propre }, aussi: null };
  // T3d : une ligne « Comme chaque semaine » (habituel, préparation) le dit, au lieu de « pour vos plats ».
  return {
    donnees: { libelle: propre },
    aussi: { nom: meme.nom, quantite: meme.quantite, ...(meme.chaqueSemaine === true ? { chaqueSemaine: true } : {}) },
  };
}

/**
 * Annonce de la feuille « Ajouter à la liste » : « ✓ « Piles » ajouté. » ; même produit déjà dans la liste (`aussi`,
 * preparerAjout) : « ✓ « Lait » ajouté. Il y en a aussi 6 l pour vos plats. » ; T3d, une ligne « Comme chaque
 * semaine » : « ✓ « Lait » ajouté. Il y en a aussi 1 l chaque semaine. ».
 */
export function texteAjoutArticle(libelle, aussi = null) {
  const nom = majuscule(reduire(libelle));
  if (!aussi) return `✓ «\u00A0${nom}\u00A0» ajouté.`;
  const quantite = typeof aussi.quantite === 'string' ? aussi.quantite.trim() : ''; // espaces insécables gardées
  const pour = aussi.chaqueSemaine === true ? 'chaque semaine' : 'pour vos plats';
  return `✓ «\u00A0${nom}\u00A0» ajouté. Il y en a aussi ${quantite ? `${quantite} ` : ''}${pour}.`;
}

/**
 * Bandeaux de Courses → { sansRecette: texte | null, aVerifier: [texte] } : « « Tarte aux poireaux » n'a pas encore sa
 * recette : ajoutez ses ingrédients à la main. » ; à plusieurs : « 2 plats n'ont pas encore leur recette : « A » et
 * « B ». Ajoutez leurs ingrédients à la main. » ; un par plat à vérifier : « Une quantité de « Gratin » n'a pas pu être
 * comptée : vérifiez la recette. ».
 */
export function bandeauxCourses(liste) {
  const cite = (plat) => `«\u00A0${reduire(plat?.nom) || 'Plat sans nom'}\u00A0»`;
  const sans = listeDe(liste?.sansRecette).filter(Boolean);
  let sansRecette = null;
  if (sans.length === 1) sansRecette = `${cite(sans[0])} n’a pas encore sa recette\u00A0: ajoutez ses ingrédients à la main.`;
  else if (sans.length > 1) {
    sansRecette = `${sans.length}\u00A0plats n’ont pas encore leur recette\u00A0: ${enumerer(sans.map(cite))}. `
      + 'Ajoutez leurs ingrédients à la main.';
  }
  const vus = new Set();
  const aVerifier = [];
  for (const { plat } of listeDe(liste?.aVerifier)) {
    if (!plat || vus.has(plat.id)) continue;
    vus.add(plat.id);
    aVerifier.push(`Une quantité de ${cite(plat)} n’a pas pu être comptée\u00A0: vérifiez la recette.`);
  }
  return { sansRecette, aVerifier };
}

/**
 * Lignes calculées restées à acheter → [{ libelle, precision, produitId }] (`precision` : le reste d'une ligne prise en
 * partie, sinon sa quantité, arrondis à l'achat, 40 caractères au plus ; '' sans quantité). Ni le placard (« Déjà à la
 * maison ? »), ni les articles à la main. T3d : ni ce qui revient de soi-même la semaine suivante (habituels et
 * préparations de chaque semaine) : une ligne « Comme chaque semaine » est omise, et une ligne qui sert aussi un plat ne
 * garde que la part des plats qui manque (partDesPlats ; omise si rien ne manque pour les plats). Avec `chaqueSemaine`
 * (la phrase de « Courses terminées ? ») : les lignes omises pour cette raison sont nommées aussi, avec ce qui manque et
 * `chaqueSemaine: true` (jamais gardées pour la prochaine fois : elles reviendront).
 */
function lignesRestantes(liste, { chaqueSemaine = false } = {}) {
  const restantes = [];
  for (const ligne of listeDe(liste?.lignes)) {
    if (ligne.cochee) continue;
    const quantite = ligne.chaqueSemaine === true ? null : partDesPlats(ligne);
    if (quantite === null) {
      if (chaqueSemaine) {
        restantes.push({
          libelle: ligne.libelle, precision: texteQuantites(ligne.reste ?? ligne.totaux ?? {}).slice(0, PRECISION_MAX),
          produitId: ligne.produitId, chaqueSemaine: true,
        });
      }
      continue;
    }
    restantes.push({ libelle: ligne.libelle, precision: texteQuantites(quantite).slice(0, PRECISION_MAX), produitId: ligne.produitId });
  }
  return restantes;
}

/**
 * Ce qui manque d'une ligne pour les plats seulement (T3d) : famille par famille, le plus petit de son reste (prise en
 * partie, sinon son total) et de la part des plats (sources `plat`) ; ce qui a été pris compte d'abord pour les habituels
 * et les préparations de chaque semaine, qui reviendront d'eux-mêmes (dans le doute, la part des plats est gardée :
 * jamais perdue). Une ligne sans quantité de chaque semaine : son reste tel quel. null si rien ne manque pour les plats
 * alors qu'il y avait une quantité (tout reviendra la semaine suivante).
 */
function partDesPlats(ligne) {
  const base = ligne.reste ?? ligne.totaux ?? {};
  const plats = {};
  let chaque = false;
  for (const source of listeDe(ligne.sources)) {
    if (!estObjet(source?.totaux)) continue;
    if (source.type !== 'plat') {
      if (famillesDe(source.totaux).some((f) => source.totaux[f] > 0)) chaque = true;
      continue;
    }
    for (const f of famillesDe(source.totaux)) plats[f] = (plats[f] ?? 0) + source.totaux[f];
  }
  if (!chaque) return base;
  const reste = {};
  for (const f of famillesDe(base)) {
    const valeur = arrondi(Math.min(base[f], plats[f] ?? 0));
    if (valeur > ecartTolere(base[f])) reste[f] = valeur;
  }
  return famillesDe(base).length && !Object.keys(reste).length ? null : reste;
}

/**
 * Lignes restées à acheter d'une semaine dont les courses ont commencé (au moins une coche : `coches` de la semaine
 * ou un article coché visible) et ne sont pas terminées (statut avant `courses_faites`) → [{ libelle, precision,
 * produitId }] (`precision` : le reste d'une ligne prise en partie, sinon sa quantité, arrondis à l'achat ; '' sans
 * quantité ; `produitId` : fixe l'identifiant de l'article, semaine.js › idReste). T3d : ni les habituels ni les
 * préparations de chaque semaine, qui reviennent d'eux-mêmes (lignesRestantes). Ni
 * le placard (« Déjà à la maison ? »), ni les articles à la main (ils restent d'eux-mêmes), ni une ligne dont le produit
 * a déjà un article pas coché (il la rappellera : jamais deux « Beurre » sur la nouvelle liste). Une fois les courses
 * terminées (T3b), rien : ce qui manquait a été gardé, ou laissé, par « Courses terminées ».
 */
export function restes(liste, semaine) {
  const lue = lireSemaine(semaine);
  if (!lue || RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites) return [];
  const commencees = Object.values(lue.coches).some(estObjet) || listeDe(liste?.articles).some((a) => a?.cochee);
  if (!commencees) return [];
  return sansArticleDuMemeProduit(lignesRestantes(liste), liste);
}

/** Lignes restantes dont le produit n'a pas déjà un article pas coché (ajouté à la main, reste, article gardé). */
function sansArticleDuMemeProduit(restants, liste) {
  const notes = new Set(articlesPasCoches(liste).map((a) => a.produitId).filter((id) => typeof id === 'string' && id));
  return restants.filter((reste) => !notes.has(reste.produitId));
}

/**
 * Fin de l'annonce d'un ajout qui a emporté des restes (fiche, Plats) : « L'article pas pris de la semaine qui finit
 * passe sur sa liste. », « Les 7 articles pas pris de la semaine qui finit passent sur sa liste. » ; '' sans reste.
 */
export function phraseRestesAjoutes(n) {
  if (!Number.isInteger(n) || n < 1) return '';
  return n === 1 ? 'L’article pas pris de la semaine qui finit passe sur sa liste.'
    : `Les ${n}\u00A0articles pas pris de la semaine qui finit passent sur sa liste.`;
}

/**
 * Phrase des restes (feuille « Ajouter à la semaine ») : « Il reste 2 articles de la semaine qui finit : beurre et sel.
 * Ils passeront sur la nouvelle liste. » ; au-delà de trois, « beurre, sel, piles et 2 autres ». '' sans reste.
 */
export function phraseRestes(liste) {
  const noms = listeDe(liste).map((r) => reduire(r?.libelle)).filter(Boolean);
  if (!noms.length) return '';
  const autres = noms.length - 3;
  const quoi = autres > 0 ? `${noms.slice(0, 3).join(', ')} et ${pluriel(autres, 'autre')}` : enumerer(noms);
  return noms.length === 1
    ? `Il reste 1\u00A0article de la semaine qui finit\u00A0: ${quoi}. Il passera sur la nouvelle liste.`
    : `Il reste ${noms.length}\u00A0articles de la semaine qui finit\u00A0: ${quoi}. Ils passeront sur la nouvelle liste.`;
}

// ——— « Courses terminées » (T3b) ———

/** Textes fixes de « Courses terminées » (Courses, Semaine). */
export const TEXTES_FIN_DES_COURSES = Object.freeze({
  bouton: 'Courses terminées',
  annonce: 'Courses terminées. Bon appétit\u00A0!',
  titre: 'Courses terminées\u00A0?',
  garder: 'Les garder pour la prochaine fois',
  sansEux: 'Terminer sans eux',
  continuer: 'Continuer les courses',
  prochaines: 'Pour les prochaines courses',
  revoir: 'Revoir la liste',
  rouvrir: 'Rouvrir la liste',
  rouverte: 'La liste est rouverte.',
  panier: 'Dites-le dans Courses quand c’est fini.',
});

/** Vrai si les courses de la semaine sont terminées (statut `courses_faites` ou plus loin). */
export function coursesFaites(semaine) {
  const lue = lireSemaine(semaine);
  return Boolean(lue) && RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites;
}

/**
 * Ce qui reste à acheter au moment de « Courses terminées » → [{ type: 'ligne' | 'article', libelle, precision,
 * produitId, articleId?, chaqueSemaine? }] : les lignes calculées pas cochées (avec la quantité qui manque : le reste
 * d'une ligne prise en partie ; T3d : une ligne « Comme chaque semaine » pas prise est nommée aussi, `chaqueSemaine:
 * true`, pour qu'un lait oublié se voie avant de finir ; preparerFinDesCourses ne la garde jamais, elle reviendra),
 * puis les articles ajoutés à la main pas cochés (leur précision). Un produit n'est nommé qu'une fois : une
 * ligne passe avant un article du même produit (un article « beurre » ajouté à la main et la ligne « beurre » des plats :
 * « Il reste 1 article : beurre. »). Ni le placard, ni ce qui est coché. Vide : « Courses terminées » finit tout de
 * suite ; sinon la feuille « Courses terminées ? » le dit (phraseRestesFin).
 */
export function restesFinDesCourses(liste) {
  const vus = new Set();
  const premier = ({ produitId }) => {
    if (typeof produitId !== 'string' || produitId === '') return true;
    if (vus.has(produitId)) return false;
    vus.add(produitId);
    return true;
  };
  return [
    ...lignesRestantes(liste, { chaqueSemaine: true }).map((reste) => ({ type: 'ligne', ...reste })),
    ...articlesPasCoches(liste).map((a) => ({
      type: 'article', libelle: a.libelle, precision: a.precision ?? '', produitId: a.produitId, articleId: a.articleId,
    })),
  ].filter(premier);
}

/** Articles de la liste (ajoutés à la main, restes, gardés) pas cochés. */
function articlesPasCoches(liste) {
  return listeDe(liste?.articles).filter((a) => a && !a.cochee);
}

/**
 * Phrase de la feuille « Courses terminées ? » : « Il reste 3 articles : beurre, sel et piles. », « Il reste 1 article :
 * beurre. » ; au-delà de trois, « beurre, sel, piles et 2 autres ». '' sans reste.
 */
export function phraseRestesFin(liste) {
  const noms = listeDe(liste).map((r) => reduire(r?.libelle)).filter(Boolean);
  if (!noms.length) return '';
  const autres = noms.length - 3;
  const quoi = autres > 0 ? `${noms.slice(0, 3).join(', ')} et ${pluriel(autres, 'autre')}` : enumerer(noms);
  return `Il reste ${pluriel(noms.length, 'article')}\u00A0: ${quoi}.`;
}

/** Date « AAAA-MM-JJ » d'une `derniereFois` lue (texte, ou horodatage à sa date locale) ; null sinon. */
function jourDeDerniereFois(valeur) {
  if (typeof valeur === 'string') return jourValide(valeur) ? valeur : null;
  let date = null;
  if (valeur instanceof Date) date = valeur;
  else if (estObjet(valeur) && typeof valeur.toDate === 'function') {
    try {
      date = valeur.toDate();
    } catch {
      date = null;
    }
  } else if (estObjet(valeur) && estNombre(valeur.seconds)) date = new Date(valeur.seconds * 1000);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const deux = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

/** Copie d'un article tel qu'il est (`{ id, ...champs }`), pour le remettre par « Annuler » ; aucune valeur undefined. */
function copieArticle(valeur) {
  if (Array.isArray(valeur)) return valeur.map(copieArticle);
  if (!estObjet(valeur)) return valeur;
  return Object.fromEntries(Object.entries(valeur).filter(([, v]) => v !== undefined).map(([c, v]) => [c, copieArticle(v)]));
}

/**
 * « Courses terminées » (T3b, un geste, décisions 11 et 12) → { lot, derniereFois, avant, gardes } | { code } :
 * - `lot` : { id (la semaine), champs, articles, supprimer }, un seul lot (donnees.js) :
 *   `champs` : `statut: 'courses_faites'`, `statutAvant` (le statut d'avant s'il est écrit : `validee` ; rien s'il était
 *   absent, effacé s'il en traînait un), `coursesFaitesLe` (`aujourdhui`, date du téléphone), `coursesFaitesPar`
 *   (`auteur`), `coursesFaitesA` (`maintenant`, l'heure du téléphone : « N articles ajoutés depuis ») ;
 *   `supprimer` : **tous** les articles cochés (`articles` : tous les documents, cachés compris) ; sans `garder`, les
 *   articles pas cochés aussi ;
 *   `articles` (avec `garder`) : une ligne pas cochée = un article (semaine.js › articlesDesRestes, la même fonction
 *   que les restes d'une semaine suivante : { id: `garde--<semaine>--<produit>`, libelle, precision (la quantité qui
 *   manque : le reste d'une ligne prise en partie, pas son total), creePar?, creeLe }), écrit par un `set` sans fusion
 *   (un article de même identifiant est remplacé, jamais doublé) ; les articles pas cochés restent tels quels, et une
 *   ligne dont le produit a déjà un article pas coché n'en reçoit pas un de plus (`liste.articles`, `produitId`) ;
 * - `derniereFois` : [{ platId, avant (valeur lue, null si absente), apres }] : `debut` de la semaine, pour chaque plat
 *   de la semaine (pas retiré, ni de la corbeille ni supprimé, ⏳ compris) dont au moins une portion est cuisinée,
 *   seulement si elle est plus récente que celle de la fiche (jamais en arrière) ; un lot par plat (ecrituresDernieresFois) ;
 * - `avant` : { id, champs, articles, supprimer } : de quoi tout remettre (« Annuler ») : les champs d'avant (EFFACER
 *   pour un champ absent), les articles supprimés tels qu'ils étaient (`set` sans fusion, même identifiant), les
 *   articles créés à retirer ; avec `derniereFois` (ecrituresDernieresFois(…, { annuler: true })) ;
 * - `gardes` : le nombre d'articles créés pour la prochaine fois.
 * { code: 'invalide' } : semaine illisible, `aujourdhui` ou `maintenant` illisible ; { code: 'deja' } : courses déjà
 * terminées (statut `courses_faites` ou plus loin : un statut ne recule jamais, et n'avance que d'ici).
 * `liste` : listeDeCourses de cette semaine ; `plats` : platsDeLaSemaine (calculé sinon, avec `tousLesPlats`,
 * `profils`, `evaluer`, `reglages`). Rien n'est modifié en entrée.
 */
export function preparerFinDesCourses(semaine, {
  liste = null, articles = [], plats = null, tousLesPlats = [], profils = [], evaluer = undefined, reglages = null,
  garder = true, auteur = null, aujourdhui = null, maintenant = null,
} = {}) {
  const lue = lireSemaine(semaine);
  if (!lue || !jourValide(aujourdhui) || !estNombre(maintenant)) return { code: 'invalide' };
  if (RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites) return { code: 'deja' };

  // Statut et traces de la fin des courses.
  const champs = { statut: 'courses_faites' };
  if (lue.statut !== undefined) champs.statutAvant = lue.statut;
  else if (Object.hasOwn(lue, 'statutAvant')) champs.statutAvant = EFFACER;
  champs.coursesFaitesLe = aujourdhui;
  const par = reduire(auteur);
  if (par) champs.coursesFaitesPar = par;
  else if (Object.hasOwn(lue, 'coursesFaitesPar')) champs.coursesFaitesPar = EFFACER;
  champs.coursesFaitesA = maintenant;

  // Articles : cochés retirés (cachés compris) ; pas cochés gardés, ou retirés sans `garder`. Une ligne dont le produit
  // a déjà un article pas coché (ajouté à la main, reste ou article gardé d'avant) n'en reçoit pas un de plus : cet
  // article, gardé tel quel, la rappellera (jamais deux « Beurre » sur la liste suivante).
  const documents = listeDe(articles).filter((a) => estObjet(a) && typeof a.id === 'string' && a.id !== '');
  const existants = new Set(documents.map((a) => a.id));
  const crees = garder
    ? articlesDesRestes(sansArticleDuMemeProduit(lignesRestantes(liste), liste),
      { semaineId: lue.id, auteur: par, maintenant, garde: true }).filter((a) => a.id)
    : [];
  const idsCrees = new Set(crees.map((a) => a.id));
  const supprimes = documents.filter((a) => (estObjet(a.coche) || !garder) && !idsCrees.has(a.id)).map((a) => a.id);

  // Dates des plats : le début de la semaine, jamais en arrière.
  const elements = Array.isArray(plats) ? plats
    : platsDeLaSemaine(lue, { tousLesPlats, profils, reglages, ...(typeof evaluer === 'function' ? { evaluer } : {}) });
  const derniereFois = [];
  for (const element of elements) {
    if (!estObjet(element) || !cheminSur('plats', element.platId ?? '') || !estObjet(element.plat)) continue;
    if (element.etat !== 'ok' && element.etat !== 'sansRecette') continue;
    if (!((element.aCuire ?? 0) + (element.aCongeler ?? 0) > 0)) continue;
    const valeur = element.plat.derniereFois;
    const connue = jourDeDerniereFois(valeur);
    if (connue && connue >= lue.debut) continue;
    if (!derniereFois.some((d) => d.platId === element.platId)) {
      derniereFois.push({ platId: element.platId, avant: valeur ?? null, apres: lue.debut });
    }
  }

  const avantChamps = {};
  for (const champ of Object.keys(champs)) avantChamps[champ] = Object.hasOwn(lue, champ) ? lue[champ] : EFFACER;
  return {
    lot: { id: lue.id, champs, articles: crees, supprimer: supprimes },
    derniereFois,
    avant: {
      id: lue.id,
      champs: avantChamps,
      // Remis tels qu'ils étaient : les articles supprimés, et ceux qu'un article gardé a remplacés.
      articles: documents.filter((a) => supprimes.includes(a.id) || idsCrees.has(a.id)).map(copieArticle),
      supprimer: crees.map((a) => a.id).filter((id) => !existants.has(id)),
    },
    gardes: crees.length,
  };
}

/**
 * Écritures de `derniereFois` (preparerFinDesCourses › derniereFois) → [{ platId, champs: { derniereFois } }], une par
 * plat (un lot chacun : un plat supprimé entre-temps n'empêche que le sien) : `apres` ; avec `annuler`, la valeur
 * d'avant (EFFACER si elle était absente). Ni `majPar` ni `majLe`.
 */
export function ecrituresDernieresFois(derniereFois, { annuler = false } = {}) {
  return listeDe(derniereFois).filter((d) => estObjet(d) && cheminSur('plats', d.platId ?? ''))
    .map(({ platId, avant, apres }) => ({
      platId,
      champs: { derniereFois: annuler ? (avant === null || avant === undefined ? EFFACER : avant) : apres },
    }))
    .filter(({ champs }) => champs.derniereFois !== undefined);
}

/**
 * L'article qui garde une ligne pour la prochaine fois (T3b) : une fois les courses de la semaine terminées, l'article
 * `garde--<semaine>--<produit>` de la ligne (« Les garder pour la prochaine fois »), s'il est dans `liste.articles` ;
 * sinon null (courses pas terminées, article à la main, rien de gardé). Cocher ou décocher la ligne dans « Revoir la
 * liste » coche ou décoche aussi cet article (app.js › actions.cocher) : une seule chose dit ce qui manque, et le
 * produit n'est jamais acheté deux fois.
 */
export function articleGardeDeLaLigne(semaine, ligne, liste) {
  const lue = lireSemaine(semaine);
  if (!lue || RANGS_STATUT[statutSemaine(lue)] < RANGS_STATUT.courses_faites || !estObjet(ligne) || ligne.type === 'article') {
    return null;
  }
  const id = idGarde(lue.id, ligne.produitId);
  return id ? listeDe(liste?.articles).find((a) => a?.articleId === id) ?? null : null;
}

/**
 * « Rouvrir la liste » avec la liste du moment (T3b) : semaine.js › ecrituresRouvrir (le statut d'avant revient ; les
 * articles gardés par ces courses et pas cochés repartent, leurs lignes reviennent à acheter), et un article gardé
 * coché depuis (acheté) rend sa coche à sa ligne : `coches.<cle>` à la quantité de la ligne (ecrituresCoche), s'il
 * n'y est pas déjà, et l'article repart aussi ; la ligne revient « dans le panier », jamais à acheter une seconde fois.
 * Sans ligne (plat retiré depuis), l'article coché reste. `articles` : les documents (`{ id, coche? }`) ; `liste` :
 * listeDeCourses de cette semaine ; `maintenant` : l'heure du téléphone. → { id, champs, supprimer? } | { code }.
 */
export function ecrituresRouvrirListe(semaine, { articles = [], liste = null, maintenant = null } = {}) {
  const resultat = ecrituresRouvrir(semaine, { articles });
  if (resultat.code) return resultat;
  const lue = lireSemaine(semaine);
  const champs = { ...resultat.champs };
  const supprimer = [...(resultat.supprimer ?? [])];
  const documents = listeDe(articles).filter((a) => estObjet(a) && typeof a.id === 'string' && estObjet(a.coche));
  for (const ligne of listeDe(liste?.lignes)) {
    const id = idGarde(lue.id, ligne?.produitId);
    if (!id || !documents.some((a) => a.id === id) || supprimer.includes(id)) continue;
    if (!ligne.cochee) {
      const coche = ecrituresCoche(lue, ligne, true, { maintenant });
      if (coche.code) continue;
      Object.assign(champs, coche.champs);
    }
    supprimer.push(id);
  }
  return supprimer.length ? { id: resultat.id, champs, supprimer } : { id: resultat.id, champs };
}

/**
 * Lignes arrivées après « Courses terminées » (« Revoir la liste » : « 2 articles ajoutés depuis ») : lignes pas
 * cochées dont au moins un plat est entré (ou revenu) dans la semaine après la fin des courses (`plats.<id>.ajouteLe`
 * plus tard que `coursesFaitesA`). 0 si les courses ne sont pas terminées ou si l'heure de la fin est inconnue.
 */
export function lignesAjouteesDepuis(liste, semaine) {
  const lue = lireSemaine(semaine);
  if (!lue || RANGS_STATUT[statutSemaine(lue)] < RANGS_STATUT.courses_faites || !estNombre(lue.coursesFaitesA)) return 0;
  const apres = (platId) => estObjet(lue.plats[platId]) && estNombre(lue.plats[platId].ajouteLe)
    && lue.plats[platId].ajouteLe > lue.coursesFaitesA;
  return listeDe(liste?.lignes).filter((ligne) => !ligne.cochee
    && listeDe(ligne.sources).some((source) => source?.type === 'plat' && apres(source.platId))).length;
}

/** « 1 article ajouté depuis », « 2 articles ajoutés depuis » ; '' pour 0. */
export function texteAjoutesDepuis(n) {
  if (!Number.isInteger(n) || n < 1) return '';
  return `${pluriel(n, 'article ajouté', 'articles ajoutés')} depuis`;
}

/** En-tête de Courses après la fin des courses : « Courses faites ✓ le samedi 10 octobre » (sans date lisible : « Courses faites ✓ »). */
export function texteCoursesFaites(semaine) {
  const jour = texteJour(semaine?.coursesFaitesLe, { jourSemaine: true });
  return jour ? `Courses faites ✓ le ${jour}` : 'Courses faites ✓';
}

/**
 * Carte « prochaine action » de Semaine (le seul bouton principal de l'écran) → { cas, titre, texte, fin, boutons,
 * suivante } ; `boutons` : [{ action: 'choisir' | 'courses' | 'preparer', libelle, principal }] ; `suivante` : la
 * semaine que « Préparer la semaine du … » ouvrira (rien n'est écrit), sinon null. Cas :
 * - 'chargement' : semaines pas encore lues ;
 * - 'choisir' : aucune semaine ou aucun plat (« Que mange-t-on cette semaine ? », ou les dates de la semaine visée
 *   quand elle commence plus tard : « Que mange-t-on du 17 au 23 octobre ? ») ;
 * - 'liste' : « Courses : 32 articles », puis « Courses : encore 12 articles » ;
 * - 'sansRecette' : rien à acheter et des plats ⏳ ; 'rien' : rien à acheter (personne n'en mange) ;
 * - 'panier' : tout est coché (au moins une ligne ou un article) : « Tout est dans le panier 🎉 », « Dites-le dans
 *   Courses quand c'est fini. » (T3b) ;
 * - 'faites' (T3b) : courses terminées : « Courses faites ✓ », « Le samedi 10 octobre. Bon appétit ! », sans bouton
 *   principal (la semaine qu'on cuisine reste à l'écran), « Voir la liste › » secondaire.
 * En plus, si la semaine a des plats et finit dans 2 jours au plus : `fin` (« Cette semaine se termine vendredi 16
 * octobre. ») et « Préparer la semaine du 17 au 23 octobre » (principal quand tout est dans le panier ou les courses
 * faites, ou sans autre bouton principal).
 * `plats` : platsDeLaSemaine ; `liste` : listeDeCourses ; `groupes` : grouperParRayon.
 */
export function carteProchaineAction(semaine, {
  semainesChargees = false, semaines = [], aujourdhui = null, plats = [], liste = null, groupes = null,
} = {}) {
  const carte = { cas: 'chargement', titre: 'Chargement de la semaine…', texte: null, fin: null, boutons: [], suivante: null };
  if (!semainesChargees) return carte;
  const lue = lireSemaine(semaine);
  const actifs = listeDe(plats).filter((e) => e?.etat === 'ok' || e?.etat === 'sansRecette');
  if (!lue || !actifs.length) {
    // Les dates de la semaine où iront les plats (la feuille de choix dit les mêmes), si elle commence plus tard.
    const connues = listeDe(semaines);
    const toutes = lue && !connues.some((s) => s?.id === lue.id) ? [...connues, lue] : connues;
    const visee = semaineVisee(toutes, aujourdhui);
    const plusTard = visee && visee.debut > aujourdhui;
    return {
      ...carte,
      cas: 'choisir',
      titre: plusTard ? `Que mange-t-on ${texteDates(visee.debut, visee.fin)}\u00A0?` : 'Que mange-t-on cette semaine\u00A0?',
      texte: 'Choisissez quelques plats\u00A0: la liste de courses se fait toute seule.',
      boutons: [{ action: 'choisir', libelle: '＋ Choisir les plats', principal: true }],
    };
  }
  const total = groupes?.total ?? 0;
  const pris = groupes?.pris ?? 0;
  const nbArticles = listeDe(liste?.articles).length;
  const quoi = nbArticles
    ? `${pluriel(actifs.length, 'plat')} et ${pluriel(nbArticles, 'article ajouté', 'articles ajoutés')} à la main.`
    : `${pluriel(actifs.length, 'plat')}.`;
  let resultat;
  if (RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites) {
    const jour = texteJour(lue.coursesFaitesLe, { jourSemaine: true });
    resultat = {
      cas: 'faites', titre: 'Courses faites ✓',
      texte: jour ? `Le ${jour}. Bon appétit\u00A0!` : 'Bon appétit\u00A0!',
      boutons: [{ action: 'courses', libelle: 'Voir la liste ›', principal: false }],
    };
  } else if (total === 0) {
    resultat = actifs.some((e) => e.etat === 'sansRecette')
      ? {
        cas: 'sansRecette', titre: 'Courses',
        texte: 'Les plats choisis n’ont pas encore leur recette\u00A0: ajoutez leurs ingrédients à la main.',
        boutons: [{ action: 'courses', libelle: 'Faire les courses ›', principal: true }],
      }
      : {
        cas: 'rien', titre: 'Rien à acheter pour l’instant', texte: quoi,
        boutons: [{ action: 'courses', libelle: 'Voir la liste ›', principal: false }],
      };
  } else if (pris >= total) {
    resultat = {
      cas: 'panier', titre: 'Tout est dans le panier 🎉', texte: TEXTES_FIN_DES_COURSES.panier,
      boutons: [{ action: 'courses', libelle: 'Voir la liste ›', principal: false }],
    };
  } else {
    resultat = {
      cas: 'liste',
      titre: pris ? `Courses\u00A0: encore ${pluriel(total - pris, 'article')}` : `Courses\u00A0: ${pluriel(total, 'article')}`,
      texte: quoi,
      boutons: [{ action: 'courses', libelle: 'Faire les courses ›', principal: true }],
    };
  }
  const sortie = { ...carte, ...resultat };
  if (peutPreparerLaSuivante(lue, aujourdhui)) {
    const suivante = semaineSuivante(semaines, aujourdhui, lue);
    if (suivante) {
      sortie.fin = `Cette semaine se termine ${texteJour(lue.fin, { jourSemaine: true })}.`;
      sortie.suivante = suivante;
      sortie.boutons = [...sortie.boutons, {
        action: 'preparer',
        libelle: `Préparer la semaine ${texteDates(suivante.debut, suivante.fin)}`,
        principal: sortie.cas === 'panier' || sortie.cas === 'faites' || !sortie.boutons.some((b) => b.principal),
      }];
    }
  }
  return sortie;
}
