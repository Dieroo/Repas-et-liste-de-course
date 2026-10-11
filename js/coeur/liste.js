// Liste de courses (T3a, CLAUDE.md §9 « Liste ») : calculée sur chaque téléphone, jamais écrite. On n'écrit que les
// gestes : les coches (`coches.<cle>` : ce qui a été pris), « À racheter » (`racheter.<cle>`) et les articles ajoutés à
// la main (`articles/{id}`). Logique pure : ni DOM ni Firebase.
// - Une ligne par produit (produits.js › idProduit), unités réunies (« Beurre · 230 g + 2 c. à soupe »).
// - Seule la version servie compte : ses ajouts pour les portions de ce profil ; ce qu'elle retire n'est pas acheté
//   pour sa part (décision 16).
// - Sommes dans un ordre fixe (plat, profil, produit, famille, quantité), puis arrondies au millionième : la liste ne
//   dépend ni de l'ordre des plats ni de celui des ingrédients, au bit près.
// - Arrondi d'achat au supérieur, tolérant (jamais 120 g pour 110,000…01 g) ; une coche retient la quantité affichée.
import { slug } from './slug.js';
import { cleDeRepli, ficheProduit, idProduit, indexDesRecettes } from './produits.js';
import { quantiteLisible } from './plats.js';
import { deNom } from './notes.js';
import {
  EFFACER, RANGS_STATUT, cheminSur, coefDe, lireSemaine, peutPreparerLaSuivante, platsDeLaSemaine, semaineSuivante,
  semaineVisee, statutSemaine, texteDates, texteJour,
} from './semaine.js';
import { LIBELLES_RAYON } from './edition.js';
import { LIBELLES_STYLE } from './vocabulaire.js';

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
 * de départ (LIBELLES_RAYON) ; `drive` : null jusqu'à T3b ; `apero` : { incontournables: [] } jusqu'à T3e.
 */
export function reglagesCourses(reglages) {
  const depart = Object.keys(LIBELLES_RAYON);
  const lus = [...new Set(listeDe(reglages?.rayons).filter((rayon) => depart.includes(rayon)))];
  return {
    rayons: [...lus, ...depart.filter((rayon) => !lus.includes(rayon))],
    drive: null,
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
 * Placard sans seuil (`{}`) → vrai ; comparaison impossible (pas de quantité, unité sans équivalence, seuil illisible)
 * → faux : dans le doute, on l'achète. Équivalences générales (EQUIVALENCES) et du produit, pour comparer seulement.
 */
export function dansLePlacard(totaux, placard, equivalences = null) {
  if (!estObjet(placard)) return false;
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
  if (oui) return { id: lue.id, champs: { [chemin]: valeurCoche(ligne.totaux, maintenant) } };
  const champs = { [chemin]: EFFACER };
  const repli = ligne.repli ? cheminSur('coches', ligne.repli) : null;
  if (repli && Object.hasOwn(lue.coches, ligne.repli)) champs[repli] = EFFACER;
  return { id: lue.id, champs };
}

/** Cocher ou décocher un article ajouté à la main → { articleId, champs: { coche: { le } | EFFACER } }. */
export function ecrituresCocheArticle(article, oui, { maintenant = null } = {}) {
  if (article?.type !== 'article' || typeof article.articleId !== 'string' || article.articleId === '') return { code: 'invalide' };
  if (!oui) return { articleId: article.articleId, champs: { coche: EFFACER } };
  return { articleId: article.articleId, champs: { coche: estNombre(maintenant) ? { le: maintenant } : {} } };
}

/**
 * « À racheter » d'un produit du placard → { id, champs: { racheter.<cle>: true | EFFACER } } ; `repli` (la clé de
 * repli de la ligne) : éteindre efface aussi `racheter.<repli>`, sinon la ligne resterait rachetée.
 */
export function ecrituresRachat(semaine, cle, oui, { repli = null } = {}) {
  const lue = lireSemaine(semaine);
  const chemin = cheminSur('racheter', cle ?? '');
  if (!lue || !chemin) return { code: 'invalide' };
  const champs = { [chemin]: oui ? true : EFFACER };
  const cheminRepli = !oui && repli && repli !== cle ? cheminSur('racheter', repli) : null;
  if (cheminRepli && Object.hasOwn(lue.racheter, repli)) champs[cheminRepli] = EFFACER;
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
 * sansPortion, aVerifier } :
 * - `lignes` : une par produit (idProduit), à acheter ou cochées, rangées par rayon (ordreRayons), puis par nom ;
 * - `maison` : produits du placard sous leur seuil (« Déjà à la maison ? »), sauf rachetés (`racheter.<cle>`) ;
 * - `articles` : articles ajoutés à la main (`articles/{id}` avec `id`), cachés s'ils ont été cochés avant
 *   min(creeLe, minuit du début) de la semaine (sans semaine : cochés depuis plus de 2 jours, d'après `maintenant`) ;
 *   jamais dans le placard ; un article « lait » et une ligne « lait » restent deux lignes ;
 * - `sansRecette` : plats ⏳ (fiches) ; `horsListe` : [{ platId, plat (null si introuvable), etat }] (corbeille ou
 *   introuvable) ; `sansPortion` : plats que personne ne mange (fiches) ; `aVerifier` : [{ plat, produit }] (portions de
 *   base illisibles : `produit` null ; quantité ou unité illisible : le nom, la ligne existe sans quantité).
 * Ligne : { type: 'ligne', cle, produitId, repli, nom (majuscule), libelle (minuscules), rayon, totaux (exacts, par
 *   famille, en unités de base), quantite (affichée), sources: [{ type: 'plat', platId, nom, pour?, style?, totaux }],
 *   placard (produit du placard sous son seuil), rachetee, cochee, dejaPris, reste, recherche }.
 * Article : { type: 'article', cle: 'article:<id>', articleId, produitId, nom, libelle, precision, rayon, totaux: {},
 *   quantite (la précision), sources: [], placard: false, rachetee: false, cochee, cocheLe, creeLe, dejaPris: null,
 *   reste: null, recherche }.
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
  const sortie = { lignes: [], maison: [], articles: [], sansRecette: [], horsListe: [], sansPortion: [], aVerifier: [] };

  // 1 à 3. Contributions de chaque plat retenu : recette (moins ce que les versions retirent), puis versions servies.
  const contributions = [];
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
    const ajouter = (brut, quantite, facteur, rangProfil, version) => {
      const nom = reduire(brut?.produit);
      const produitId = idProduit(nom);
      if (!produitId) {
        sortie.aVerifier.push({ plat, produit: nom });
        return;
      }
      const lu = versBase(quantite, brut.unite);
      if (!lu) sortie.aVerifier.push({ plat, produit: nom });
      contributions.push({
        rangPlat, rangProfil, produitId, nom: nom.toLocaleLowerCase('fr-FR'),
        famille: lu?.famille ?? null, qte: lu ? lu.qte * facteur : null,
        source: {
          platId: element.platId, nom: reduire(plat.nom),
          // Style seulement s'il s'affiche (semaine.js › versionServie, `nomme`) : « pour vous (votre version) » sinon.
          ...(version ? { pour: version.profil.id, ...(version.nomme === false ? {} : { style: version.style }) } : {}),
        },
      });
    };
    for (const ingredient of listeDe(plat.ingredients)) {
      if (!estObjet(ingredient)) continue;
      const retire = retires.get(slug(ingredient.produit)) ?? 0;
      const facteur = base === null ? 1 : Math.max(0, total - retire) / base;
      if (facteur <= TOLERANCE) continue; // personne ne mange cet ingrédient (toutes les parts le retirent)
      ajouter(ingredient, ingredient.qte, facteur, 0, null);
    }
    element.versions.forEach((version, i) => {
      const parts = coefDe(version.profil) * element.repas;
      for (const ajout of listeDe(version.variante?.ajouter)) {
        if (estObjet(ajout)) ajouter(ajout, ajout.qtePortion, parts, i + 1, version);
      }
    });
  });

  // 5. Agrégation par produit, dans un ordre fixe, puis arrondi au millionième.
  contributions.sort((a, b) => a.rangPlat - b.rangPlat || a.rangProfil - b.rangProfil || parId(a.produitId, b.produitId)
    || parId(a.famille ?? '', b.famille ?? '') || (a.qte ?? -1) - (b.qte ?? -1) || parId(a.nom, b.nom));
  const produits = new Map();
  for (const c of contributions) {
    if (!produits.has(c.produitId)) produits.set(c.produitId, { noms: [], totaux: {}, sources: new Map() });
    const produit = produits.get(c.produitId);
    if (!produit.noms.includes(c.nom)) produit.noms.push(c.nom);
    const cleSource = `${c.source.platId}|${c.source.pour ?? ''}`;
    if (!produit.sources.has(cleSource)) produit.sources.set(cleSource, { type: 'plat', ...c.source, totaux: {} });
    if (c.famille && c.qte > 0) {
      produit.totaux[c.famille] = (produit.totaux[c.famille] ?? 0) + c.qte;
      const source = produit.sources.get(cleSource);
      source.totaux[c.famille] = (source.totaux[c.famille] ?? 0) + c.qte;
    }
  }

  // 6 à 9. Fiche du produit, placard, coches.
  const coches = lue?.coches ?? {};
  const racheter = lue?.racheter ?? {};
  for (const [produitId, produit] of produits) {
    const totaux = arrondirTotaux(produit.totaux);
    const sources = [...produit.sources.values()].map((s) => ({ ...s, totaux: arrondirTotaux(s.totaux) }));
    const saisie = produit.noms[0] ?? '';
    let fiche = ficheProduit(produitId, { produitsFoyer, index: idx, saisie });
    // Clé de repli (un id changé par les produits courants) : jamais celle d'un homographe ni d'une autre ligne
    // (« pâté » n'hérite jamais de la coche des pâtes).
    const cleRepli = cleDeRepli(fiche.nom.valeur, produitId);
    const repli = cleRepli && !produits.has(cleRepli) ? cleRepli : null;
    if (repli) fiche = ficheProduit(produitId, { produitsFoyer, index: idx, saisie, repli });
    const placard = fiche.placard.valeur !== null && dansLePlacard(totaux, fiche.placard.valeur, fiche.equivalences.valeur);
    const rachetee = placard && (racheter[produitId] === true || (repli !== null && racheter[repli] === true));
    const coche = Object.hasOwn(coches, produitId) ? coches[produitId] : repli !== null ? coches[repli] : undefined;
    const etat = placard && !rachetee ? { cochee: false, dejaPris: null, reste: null } : etatCoche(totaux, coche);
    const libelle = fiche.nom.valeur || saisie;
    const ligne = {
      type: 'ligne', cle: produitId, produitId, repli, nom: majuscule(libelle), libelle, rayon: fiche.rayon.valeur,
      totaux, quantite: texteQuantites(totaux), sources, placard, rachetee, ...etat, recherche: fiche.recherche.valeur,
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
    const fiche = ficheProduit(produitId, { produitsFoyer, index: idx, saisie: libelle });
    const precision = reduireQuantite(article.precision) || null;
    sortie.articles.push({
      type: 'article', cle: `article:${article.id}`, articleId: article.id, produitId, nom: majuscule(libelle), libelle,
      precision, rayon: fiche.rayon.valeur, totaux: {}, quantite: precision ?? '', sources: [], placard: false,
      rachetee: false, cochee, cocheLe, creeLe: estNombre(article.creeLe) ? article.creeLe : null, dejaPris: null,
      reste: null, recherche: fiche.recherche.source === 'foyer' ? fiche.recherche.valeur : libelle,
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

/** Totaux arrondis au millionième, familles positives seulement. */
function arrondirTotaux(totaux) {
  const propres = {};
  for (const f of famillesDe(totaux)) {
    const valeur = arrondi(totaux[f]);
    if (valeur > 0) propres[f] = valeur;
  }
  return propres;
}

/**
 * Écran Courses : rayons dans l'ordre du foyer → { aAcheter: [{ rayon, libelle, lignes }], maison, panier, total, pris,
 * vide }. Lignes et articles à acheter rangés par rayon puis par nom ; `panier` : ceux qui sont cochés (« Dans le
 * panier ») ; `maison` : « Déjà à la maison ? » (hors des comptes). `total` : lignes et articles, cochés compris ;
 * `pris` : cochés ; `vide` : aucune ligne ni article (jamais « Tout est dans le panier » sur une liste vide).
 * `rayons` : ordreRayons(reglages) (ordre de départ sinon).
 */
export function grouperParRayon(liste, { rayons = null } = {}) {
  const ordre = Array.isArray(rayons) && rayons.length ? rayons : ordreRayons(null);
  const rangs = new Map(ordre.map((rayon, i) => [rayon, i]));
  const rang = (rayon) => rangs.get(rayon) ?? rangs.size;
  const parNom = (a, b) => comparerNoms(a.nom, b.nom) || parId(a.cle, b.cle);
  const elements = [...listeDe(liste?.lignes), ...listeDe(liste?.articles)];
  const groupes = new Map();
  for (const element of elements.filter((e) => !e.cochee)) {
    if (!groupes.has(element.rayon)) groupes.set(element.rayon, []);
    groupes.get(element.rayon).push(element);
  }
  const aAcheter = [...groupes].sort(([a], [b]) => rang(a) - rang(b) || parId(a, b))
    .map(([rayon, lignes]) => ({ rayon, libelle: LIBELLES_RAYON[rayon] ?? LIBELLES_RAYON.divers, lignes: lignes.sort(parNom) }));
  const panier = elements.filter((e) => e.cochee).sort((a, b) => rang(a.rayon) - rang(b.rayon) || parNom(a, b));
  return {
    aAcheter, maison: listeDe(liste?.maison), panier, total: elements.length, pris: panier.length,
    vide: elements.length === 0,
  };
}

// ——— Textes ———

const nomDe = (profil) => reduire(profil?.nom) || 'Sans prénom';
/** « a et b », « a, b et c » */
const enumerer = (mots) => (mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}` : mots.join(''));
const pluriel = (n, singulier, plurielDe = `${singulier}s`) => `${n}\u00A0${n > 1 ? plurielDe : singulier}`;

/**
 * Origine d'une ligne (seconde ligne de Courses, après la quantité) : « Gratin, Salade de pâtes » ; une version :
 * « pour Adulte B (version mer) », « pour vous (version mer) » ; version d'un profil sans styles (source sans `style`) :
 * « pour Adulte A (sa version) », « pour vous (votre version) » ; article : « Ajouté à la main ». Mêmes mots pour les
 * deux rôles : jamais de croix.
 */
export function texteOrigine(ligne, { profils = [], moi = null } = {}) {
  if (ligne?.type === 'article') return 'Ajouté à la main';
  const morceaux = [];
  for (const source of listeDe(ligne?.sources)) {
    let morceau;
    if (source.pour) {
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
 * « Votre version · … ». Sans quantité, le nom seul.
 */
export function texteSource(source, { profils = [], moi = null } = {}) {
  const quantite = texteQuantites(source?.totaux);
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
  return { donnees: { libelle: propre }, aussi: meme ? { nom: meme.nom, quantite: meme.quantite } : null };
}

/**
 * Annonce de la feuille « Ajouter à la liste » : « ✓ « Piles » ajouté. » ; même produit déjà dans la liste (`aussi`,
 * preparerAjout) : « ✓ « Lait » ajouté. Il y en a aussi 6 l pour vos plats. ».
 */
export function texteAjoutArticle(libelle, aussi = null) {
  const nom = majuscule(reduire(libelle));
  if (!aussi) return `✓ «\u00A0${nom}\u00A0» ajouté.`;
  const quantite = typeof aussi.quantite === 'string' ? aussi.quantite.trim() : ''; // espaces insécables gardées
  return `✓ «\u00A0${nom}\u00A0» ajouté. Il y en a aussi ${quantite ? `${quantite} ` : ''}pour vos plats.`;
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
 * Lignes restées à acheter d'une semaine dont les courses ont commencé (au moins une coche : `coches` de la semaine
 * ou un article coché visible) et ne sont pas terminées (statut avant `courses_faites`) → [{ libelle, precision,
 * produitId }] (`precision` : le reste d'une ligne prise en partie, sinon sa quantité, arrondis à l'achat ; '' sans
 * quantité ; `produitId` : fixe l'identifiant de l'article, semaine.js › idReste). Ni
 * le placard (« Déjà à la maison ? »), ni les articles à la main (ils restent d'eux-mêmes).
 */
export function restes(liste, semaine) {
  const lue = lireSemaine(semaine);
  if (!lue || RANGS_STATUT[statutSemaine(lue)] >= RANGS_STATUT.courses_faites) return [];
  const commencees = Object.values(lue.coches).some(estObjet) || listeDe(liste?.articles).some((a) => a?.cochee);
  if (!commencees) return [];
  return listeDe(liste?.lignes).filter((ligne) => !ligne.cochee).map((ligne) => ({
    libelle: ligne.libelle, precision: texteQuantites(ligne.reste ?? ligne.totaux).slice(0, PRECISION_MAX),
    produitId: ligne.produitId,
  }));
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

/**
 * Carte « prochaine action » de Semaine (le seul bouton principal de l'écran) → { cas, titre, texte, fin, boutons,
 * suivante } ; `boutons` : [{ action: 'choisir' | 'courses' | 'preparer', libelle, principal }] ; `suivante` : la
 * semaine que « Préparer la semaine du … » ouvrira (rien n'est écrit), sinon null. Cas :
 * - 'chargement' : semaines pas encore lues ;
 * - 'choisir' : aucune semaine ou aucun plat (« Que mange-t-on cette semaine ? », ou les dates de la semaine visée
 *   quand elle commence plus tard : « Que mange-t-on du 17 au 23 octobre ? ») ;
 * - 'liste' : « Courses : 32 articles », puis « Courses : encore 12 articles » ;
 * - 'sansRecette' : rien à acheter et des plats ⏳ ; 'rien' : rien à acheter (personne n'en mange) ;
 * - 'panier' : tout est coché (au moins une ligne ou un article).
 * En plus, si la semaine a des plats et finit dans 2 jours au plus : `fin` (« Cette semaine se termine vendredi 16
 * octobre. ») et « Préparer la semaine du 17 au 23 octobre » (principal quand tout est dans le panier).
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
  if (total === 0) {
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
      cas: 'panier', titre: 'Tout est dans le panier 🎉', texte: 'Bon appétit\u00A0!',
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
        principal: sortie.cas === 'panier' || !sortie.boutons.some((b) => b.principal),
      }];
    }
  }
  return sortie;
}
