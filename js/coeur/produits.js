// Produits (T3-0, CLAUDE.md §6) : ce que l'app sait d'un nom de produit saisi, d'abord par les produits du foyer
// (ingrédients de ses recettes, edition.js › catalogueProduits), puis par les produits courants (dictionnaire.js).
// Reconnaissance exacte seulement : le nom ou une autre écriture du même article, au pluriel, à la casse, aux accents
// et aux tirets près. Jamais de ressemblance (début du nom, mot principal, adjectif retiré, faute de frappe) : elle
// donnerait une mauvaise nature sans le dire (« steak de soja » lu comme de la viande, « lait de coco » comme un
// produit laitier). Les ressemblances ne servent qu'aux suggestions, que la personne touche elle-même.
// Logique pure : ni DOM ni Firebase. N'importe que slug.js, vocabulaire.js et dictionnaire.js ; edition.js l'importe,
// jamais l'inverse (pas de cycle). En T3 : `ficheProduit` (priorité champ par champ).
import { cleProduit, motsAccentues, slug } from './slug.js';
import { MARQUEURS_PRECAUTION, VIANDES, VOCABULAIRES, marqueursEffectifs } from './vocabulaire.js';
import { DICTIONNAIRE } from './dictionnaire.js';

/**
 * Clés de mots (cleProduit) qui, sans leurs accents, peuvent vouloir dire autre chose : pâte, pâté et pâtes ; thé ;
 * maïs ; rosé ; mûre ; côte ; pêche ; salé. Un mot de la saisie dont la clé est ici se compare aussi avec ses accents
 * (minuscules, `s` ou `x` final retiré) : « pâté de campagne » n'est jamais « pâte… », « cote de boeuf » sans accent
 * n'est pas reconnu (la question reste). Un test calcule les paires du dictionnaire et échoue en les nommant.
 */
export const HOMOGRAPHES = new Set(['pate', 'the', 'mai', 'rose', 'mure', 'cote', 'peche', 'sale']);

/**
 * Formes admises d'un mot homographe (§4.2 du plan, figées) : le mot saisi (minuscules, accents et pluriel gardés) est
 * lu comme la forme indiquée. « pates » sans accent, la saisie la plus fréquente au clavier : des pâtes (décision du
 * propriétaire, 2026-10-10).
 */
const FORMES_ADMISES = new Map([['pates', 'pâtes']]);

/**
 * Saisies qui, seules (un seul mot), peuvent vouloir dire plusieurs choses : « pâte » (brisée, feuilletée…), « pâté »
 * (de campagne…). Jamais reconnues par les produits courants : la question « C'est… ? » reste, avec une aide.
 * Comparées en minuscules, accents et pluriel gardés (« pâtes » et « pates » sont des pâtes).
 */
const AMBIGUS_SEULS = new Set(['pâte', 'pâté', 'pâtés', 'pate']);

const POISSONS = ['poisson', 'fruits_de_mer'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const comparer = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

// ——— Nature ———

/**
 * 'viande' | 'poisson' | 'legume' | 'autre', d'après les marqueurs. Déplacé ici depuis edition.js (T3-0), qui le
 * réexporte, pour que produits.js s'en serve sans cycle.
 */
export function natureDe(ingredient) {
  const marqueurs = Array.isArray(ingredient?.marqueurs) ? ingredient.marqueurs : [];
  if (marqueurs.some((m) => VIANDES.includes(m))) return 'viande';
  if (marqueurs.some((m) => POISSONS.includes(m))) return 'poisson';
  if (marqueurs.includes('legume')) return 'legume';
  return 'autre';
}

/** Mots de la ligne « ✓ Produit connu : <mot> · <rayon> » (écran « Modifier »), sans jargon. */
export const MOTS_NATURE = Object.freeze({
  viande: 'viande', poisson: 'poisson', legume: 'légume', feculent: 'féculent', laitier: 'produit laitier', oeuf: 'œuf',
});

/**
 * Mots des repères de précaution sur la ligne « ✓ Produit connu » (« · au lait cru, à vérifier ») : courts, sans
 * virgule, pris dans une phrase (les libellés des cases « Repères » sont faits pour une case à cocher : « Café, thé,
 * cola », « Fruits à coque entiers »). `cru` dépend de la nature (motDeRepere).
 */
export const MOTS_REPERE = Object.freeze({
  cru: 'cru', poisson_predateur: 'grand prédateur', lait_cru: 'au lait cru', fruit_coque: 'fruits à coque',
  cafe: 'caféine', cafeine: 'caféine', alcool_cru: 'alcool non cuit', oeuf_cru: 'œuf cru', miel: 'miel', soja: 'soja',
  bouillon_viande: 'bouillon de viande', gelatine_animale: 'gélatine animale', gelatine_porc: 'gélatine animale',
  graisse_animale: 'graisse animale',
});

/** Mot d'un repère de précaution (MOTS_REPERE) ; `cru` d'une viande : « crue ou rosée ». null pour un autre marqueur. */
export function motDeRepere(marqueur, marqueurs = []) {
  if (!Object.hasOwn(MOTS_REPERE, marqueur ?? '')) return null;
  if (marqueur === 'cru' && marqueursEffectifs({ marqueurs }).has('viande')) return 'crue ou rosée';
  return MOTS_REPERE[marqueur];
}

/**
 * Mot de la nature d'un produit, pour la ligne « ✓ Produit connu » : viande, poisson (fruits de mer compris), légume,
 * puis féculent, produit laitier, œuf ; null pour tout autre produit (la ligne ne dit alors que le rayon).
 */
export function motDeNature(marqueurs) {
  const liste = Array.isArray(marqueurs) ? marqueurs : [];
  const nature = natureDe({ marqueurs: liste });
  if (nature !== 'autre') return MOTS_NATURE[nature];
  const famille = ['feculent', 'laitier', 'oeuf'].find((m) => liste.includes(m));
  return famille ? MOTS_NATURE[famille] : null;
}

// ——— Homographes ———

/** Mots comparés avec leurs accents : formes admises appliquées, puis sans pluriel (« pates » → pâte, « pâtés » → pâté). */
function motsCompares(nom) {
  return motsAccentues(nom).map((mot) => motsAccentues(FORMES_ADMISES.get(mot) ?? mot, { pluriel: false })[0]);
}

/** Vrai si un mot de la clé est un homographe. */
const toucheHomographe = (cle) => cle.split('-').some((mot) => HOMOGRAPHES.has(mot));

/**
 * Vrai si deux noms de même clé (cleProduit) s'accordent aussi sur leurs mots homographes, comparés avec leurs
 * accents : « pâtes courtes » et « pates courtes » oui ; « pâté » et « pâtes » non.
 */
function accentsAccordes(a, b) {
  const cles = cleProduit(a).split('-');
  const motsA = motsCompares(a);
  const motsB = motsCompares(b);
  return cles.every((cle, i) => !HOMOGRAPHES.has(cle) || motsA[i] === motsB[i]);
}

/** Vrai si la saisie, seule, peut vouloir dire plusieurs choses (« pâte », « pâté », « pate ») : la question reste. */
export function estAmbigu(nom) {
  const mots = motsAccentues(nom);
  return mots.length === 1 && AMBIGUS_SEULS.has(mots[0]);
}

/** Vrai si un mot (motsCompares) porte un accent : « pâte », ou « pates » lu comme des pâtes ; pas « the ». */
const accentue = (mot) => /[^a-z0-9]/.test(mot ?? '');

/**
 * Accord d'un nom saisi avec le nom d'un produit du foyer de même slug (T3-0) : sur chaque mot homographe, les mêmes
 * accents (formes admises comprises), ou l'un des deux écrit sans accent (« the » pour le « thé » du foyer, « pate
 * brisee » pour sa « pâte brisée » : saisie du clavier, comportement d'avant). Deux accents différents ne s'accordent
 * jamais : « pâtés » n'est pas les « pâtes » du foyer, ni « pâté » sa « pâte », ni « pates » (des pâtes) ses
 * « pâtés ». Un nom ambigu seul (« pate », « pâté ») demande exactement les mêmes accents.
 */
function accordFoyer(nom, produit) {
  const cle = cleProduit(nom);
  if (!toucheHomographe(cle)) return true;
  if (estAmbigu(nom)) return accentsAccordes(nom, produit);
  const motsA = motsCompares(nom);
  const motsB = motsCompares(produit);
  return cle.split('-').every((mot, i) => !HOMOGRAPHES.has(mot) || motsA[i] === motsB[i]
    || !accentue(motsA[i]) || !accentue(motsB[i]));
}

/**
 * Écart d'accents d'un nom proposé avec la saisie (suggestions) : vrai si un mot homographe déjà tapé en entier et
 * accentué (« pâté », « pâtés », « pates » lu comme des pâtes) est écrit avec d'autres accents dans le nom proposé
 * (« pâtes », « pâte brisée » pour « pâté »). Le nom proposé passe alors après ceux qui s'accordent.
 */
function ecartAccents(saisie, forme) {
  const cles = cleProduit(saisie).split('-');
  if (!cles.some((mot) => HOMOGRAPHES.has(mot))) return false;
  const motsA = motsCompares(saisie);
  const motsB = motsCompares(forme);
  return cles.some((mot, i) => HOMOGRAPHES.has(mot) && i < motsB.length && accentue(motsA[i]) && accentue(motsB[i])
    && motsA[i] !== motsB[i]);
}

// ——— Produits du foyer ———

const indexFoyers = new WeakMap();

/** Index d'un catalogue du foyer (slug et cleProduit → premier élément), gardé tant que le tableau ne change pas. */
function indexFoyer(catalogue) {
  if (!Array.isArray(catalogue)) return { parSlug: new Map(), parCle: new Map() };
  const garde = indexFoyers.get(catalogue);
  if (garde && garde.taille === catalogue.length) return garde;
  const parSlug = new Map();
  const parCle = new Map();
  for (const element of catalogue) {
    // Ceinture et bretelles : un élément venu des produits courants (catalogue fusionné) n'est jamais du foyer.
    if (!estObjet(element) || element.origine === 'dictionnaire' || typeof element.produit !== 'string') continue;
    const cleSlug = slug(element.produit);
    if (!cleSlug) continue;
    if (!parSlug.has(cleSlug)) parSlug.set(cleSlug, element);
    const cle = cleProduit(element.produit);
    if (!parCle.has(cle)) parCle.set(cle, element);
  }
  const index = { parSlug, parCle, taille: catalogue.length };
  indexFoyers.set(catalogue, index);
  return index;
}

/**
 * Élément du foyer pour ce nom, ou null : même slug, les mots homographes accordés (accordFoyer : « pâtés » n'est pas
 * les « pâtes » du foyer, mais « the » est son « thé »), sinon même cleProduit (au pluriel près), sauf si la clé touche
 * un homographe (« pâte » n'est pas « pâtes »). Les éléments d'origine 'dictionnaire' sont ignorés.
 */
export function connuDuFoyer(nom, catalogue) {
  const cleSlug = slug(nom);
  if (!cleSlug) return null;
  const { parSlug, parCle } = indexFoyer(catalogue);
  if (parSlug.has(cleSlug)) {
    const element = parSlug.get(cleSlug);
    return accordFoyer(nom, element.produit) ? element : null;
  }
  const cle = cleProduit(nom);
  if (toucheHomographe(cle)) return null;
  return parCle.get(cle) ?? null;
}

// ——— Produits courants ———

let index = null;

/**
 * Élément d'une entrée du dictionnaire, de la forme d'un élément de catalogueProduits (`produit`, `unite`, `rayon`,
 * `marqueurs`, `forme?`, `role?`, `nature`), sans quantité (jamais inventée), plus `origine: 'dictionnaire'`, `id`,
 * `nomCourant` et `alias`. Gelé : partagé par tous les appels.
 */
function elementDe(entree) {
  const element = {
    produit: entree.nom,
    unite: entree.unite,
    rayon: entree.rayon,
    marqueurs: Object.freeze((Array.isArray(entree.marqueurs) ? entree.marqueurs : [])
      .filter((m) => VOCABULAIRES.marqueurs.includes(m))),
  };
  if (VOCABULAIRES.forme.includes(entree.forme)) element.forme = entree.forme;
  if (VOCABULAIRES.role.includes(entree.role)) element.role = entree.role;
  element.nature = natureDe(element);
  element.origine = 'dictionnaire';
  element.id = entree.id;
  element.nomCourant = entree.nom;
  element.alias = Object.freeze(Array.isArray(entree.alias) ? [...entree.alias] : []);
  return Object.freeze(element);
}

/** Index des produits courants, construit à la première recherche puis gardé. */
function indexDictionnaire() {
  if (index) return index;
  const parCle = new Map();
  const elements = [];
  for (const entree of DICTIONNAIRE) {
    const element = elementDe(entree);
    elements.push(element);
    for (const forme of [entree.nom, ...(Array.isArray(entree.alias) ? entree.alias : [])]) {
      const cle = cleProduit(forme);
      // Clés uniques sur tout le dictionnaire (tests/coeur-dictionnaire.test.js) : la première l'emporterait.
      if (cle && !parCle.has(cle)) parCle.set(cle, { entree, element, forme });
    }
  }
  elements.sort((a, b) => comparer(a.produit, b.produit) || (a.id < b.id ? -1 : 1));
  index = { parCle, elements: Object.freeze(elements) };
  return index;
}

/** Éléments des produits courants (voir elementDe), triés par nom. Même tableau gelé à chaque appel. */
export function elementsDuDictionnaire() {
  return indexDictionnaire().elements;
}

/** Noms d'un élément ou d'une entrée des produits courants : le nom courant, puis ses autres écritures. */
export function formesDe(element) {
  if (!estObjet(element)) return [];
  const nom = element.nomCourant ?? element.nom ?? element.produit;
  return [nom, ...(Array.isArray(element.alias) ? element.alias : [])].filter((f) => typeof f === 'string' && f !== '');
}

/** { entree, element, forme } des produits courants pour ce nom (même cleProduit, homographes accordés), ou null. */
function dansLeDictionnaire(nom) {
  const trouve = indexDictionnaire().parCle.get(cleProduit(nom));
  return trouve && accentsAccordes(nom, trouve.forme) ? trouve : null;
}

// ——— Reconnaître ———

/** Élément du foyer tel que reconnaitre le rend : copie avec `origine: 'foyer'` (et sa nature). */
const duFoyer = (element) => ({ ...element, nature: element.nature ?? natureDe(element), origine: 'foyer' });

/**
 * Produit du foyer trouvé par une autre écriture que le nom saisi (pluriel, autre nom du même produit courant) : il
 * l'emporte (nature, rayon, unité, forme, rôle), mais rien de moins prudent que le nom saisi seul. Les repères de
 * précaution du produit courant (`entree`) qu'il ne porte pas s'ajoutent à ses marqueurs (`ajoutes`), et
 * `autreEcriture` dit aux écrans de proposer aussi tous les repères que le nom annonce (edition.js › reperesProposes) :
 * une ancienne recette « cerneau de noix » sans repère ne fait pas perdre `fruit_coque` à « noix ».
 */
function parAutreEcriture(element, entree) {
  const copie = duFoyer(element);
  const portes = Array.isArray(copie.marqueurs) ? copie.marqueurs : [];
  const effectifs = marqueursEffectifs({ marqueurs: portes });
  const ajoutes = (Array.isArray(entree?.marqueurs) ? entree.marqueurs : [])
    .filter((m) => MARQUEURS_PRECAUTION.includes(m) && !effectifs.has(m));
  copie.marqueurs = [...portes, ...ajoutes];
  const resultat = { origine: 'foyer', element: copie, autreEcriture: true, ajoutes };
  if (entree) resultat.entree = entree;
  return resultat;
}

/**
 * Ce que l'app sait d'un nom saisi. On prend le premier trouvé :
 * 1. foyer exact : élément du catalogue du foyer de même slug, mots homographes accordés (connuDuFoyer) ;
 * 2. foyer au pluriel près : même cleProduit, sauf si la clé touche un homographe ;
 * 3. produits courants : nom ou autre écriture de même cleProduit, homographes accordés ; si un nom ou une autre
 *    écriture de cette entrée est connu du foyer (étapes 1-2 sur ce nom), l'élément du foyer l'emporte (« oignon
 *    jaune » quand le foyer a « oignon ») ;
 * 4. sinon null, ou { ambigu: true } pour « pâte », « pâté » et « pate » seuls.
 * Aux étapes 2 et 3 (`autreEcriture: true`), le foyer l'emporte sans rien perdre des repères de précaution : ceux du
 * produit courant s'y ajoutent (`ajoutes`, voir parAutreEcriture), et le nom saisi garde les siens (edition.js).
 * `catalogue` : celui du foyer (catalogueProduits) ; un élément d'origine 'dictionnaire' y est ignoré.
 * `element` a la forme d'un élément de catalogueProduits, plus `origine` ('foyer' ou 'dictionnaire') ; venu des
 * produits courants, il porte aussi `id`, `nomCourant` et `alias`, jamais de quantité. `entree` : l'entrée des produits
 * courants quand elle est trouvée (étapes 2 et 3).
 * → { origine: 'foyer' | 'dictionnaire', element, entree?, autreEcriture?, ajoutes? } | { ambigu: true } | null
 */
export function reconnaitre(nom, { catalogue = [] } = {}) {
  if (!cleProduit(nom)) return null;
  const foyer = connuDuFoyer(nom, catalogue);
  if (foyer) {
    if (slug(foyer.produit) === slug(nom)) return { origine: 'foyer', element: duFoyer(foyer) };
    return parAutreEcriture(foyer, dansLeDictionnaire(nom)?.entree);
  }
  if (estAmbigu(nom)) return { ambigu: true };
  const trouve = dansLeDictionnaire(nom);
  if (!trouve) return null;
  for (const forme of formesDe(trouve.entree)) {
    const element = connuDuFoyer(forme, catalogue);
    if (element) return parAutreEcriture(element, trouve.entree);
  }
  return { origine: 'dictionnaire', element: trouve.element, entree: trouve.entree };
}

// ——— Suggestions ———

const formesIndexees = new WeakMap();

/**
 * Noms cherchés d'un élément de catalogue, préparés une fois : le produit (foyer), ou le nom courant et les autres
 * écritures (produits courants). → [{ forme, slug, cle, mots }]
 */
function formesCherchees(element) {
  if (!estObjet(element)) return [];
  if (formesIndexees.has(element)) return formesIndexees.get(element);
  const formes = (element.origine === 'dictionnaire' ? formesDe(element) : [element.produit])
    .filter((forme) => typeof forme === 'string')
    .map((forme) => {
      const cleSlug = slug(forme);
      return { forme, slug: cleSlug, cle: cleProduit(forme), mots: cleSlug.split('-').length };
    })
    .filter((forme) => forme.slug);
  formesIndexees.set(element, formes);
  return formes;
}

/** Saisie en cours, chaque mot terminé (tous sauf le dernier) sans pluriel : « pommes de t » → 'pomme-de-t'. */
function debutSansPluriel(cherche) {
  const mots = cherche.split('-');
  return [...cleProduit(mots.slice(0, -1).join('-')).split('-').filter(Boolean), mots[mots.length - 1]].join('-');
}

/**
 * Rang d'un élément de catalogue pour une saisie :
 * - 0 pour le nom exact : même slug ou même cleProduit, mots homographes accordés comme pour reconnaitre (accordFoyer
 *   pour le foyer ; accentsAccordes pour les produits courants, jamais pour un nom ambigu seul) ;
 * - 1 pour un nom qui commence par la saisie ; 2 pour un mot qui commence par elle ; 3 pour un nom qui la contient
 *   (foyer seulement : jamais pour les produits courants).
 * Les mots terminés se comparent sans pluriel (« pommes de t » → pomme de terre) ; le dernier mot est un début tel que
 * tapé, ou un mot entier sans son pluriel (« cerneaux » → cerneau de noix ; « pois » ne propose pas « poire »).
 * `ecart` (0 ou 1) : un mot homographe tapé avec ses accents est écrit avec d'autres accents dans le nom (« pâtes » ou
 * « pâte brisée » pour « pâté ») ; à rang égal, ce nom passe après les autres. `mots` : nombre de mots de la forme
 * trouvée (à rang égal, le nom le plus court d'abord : la première suggestion ne bouge pas quand on finit le mot,
 * « pât » puis « pâtes »). Pour les produits courants, le nom courant et les autres écritures sont cherchés, et la
 * meilleure compte. La saisie est préparée une fois : `chercheur(saisie)` rend la fonction de rang (null pour une
 * saisie vide). → (element) → { rang, ecart, mots } ou null
 */
export function chercheur(saisie) {
  const cherche = slug(saisie);
  if (!cherche) return null;
  const cle = cleProduit(saisie);
  const debut = debutSansPluriel(cherche);
  const ambigu = estAmbigu(saisie);
  const homographe = toucheHomographe(cle);
  const calculs = new Map(); // forme → { foyer, courant, ecart } (accords des homographes), à la demande
  const accentsDe = (forme) => {
    if (!calculs.has(forme)) {
      calculs.set(forme, homographe ? {
        foyer: accordFoyer(saisie, forme), courant: !ambigu && accentsAccordes(saisie, forme), ecart: ecartAccents(saisie, forme),
      } : { foyer: true, courant: !ambigu, ecart: false });
    }
    return calculs.get(forme);
  };
  return (element) => {
    const courant = element?.origine === 'dictionnaire';
    let meilleur = null;
    for (const forme of formesCherchees(element)) {
      const memeCle = forme.cle === cle;
      let rang = -1;
      if (courant ? memeCle && accentsDe(forme.forme).courant
        : (forme.slug === cherche && accentsDe(forme.forme).foyer) || (memeCle && !homographe)) rang = 0;
      else if (forme.slug.startsWith(cherche) || forme.cle.startsWith(debut) || memeCle || forme.cle.startsWith(`${cle}-`)) rang = 1;
      else if (forme.slug.includes(`-${cherche}`) || forme.cle.includes(`-${debut}`) || forme.cle.endsWith(`-${cle}`)
        || forme.cle.includes(`-${cle}-`)) rang = 2;
      else if (!courant && forme.slug.includes(cherche)) rang = 3;
      if (rang < 0) continue;
      const ecart = homographe && accentsDe(forme.forme).ecart ? 1 : 0;
      const trouve = { rang, ecart, mots: forme.mots };
      const ecartAuMeilleur = meilleur ? rang - meilleur.rang || ecart - meilleur.ecart || forme.mots - meilleur.mots : -1;
      if (ecartAuMeilleur < 0) meilleur = trouve;
    }
    return meilleur;
  };
}

/** Rang d'un élément pour une saisie (voir chercheur). → { rang, ecart, mots } ou null */
export function rangSuggestion(element, saisie) {
  return chercheur(saisie)?.(element) ?? null;
}
