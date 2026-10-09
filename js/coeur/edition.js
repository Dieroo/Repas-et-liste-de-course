// Écran « Modifier » une recette : libellés, nature d'un ingrédient, cases « Repères » (T2c-2), catalogue des produits
// connus, saisie d'un ingrédient, comparaison et préparation de l'enregistrement. Logique pure : ni DOM ni Firebase.
import { slug } from './slug.js';
import { APPAREILS, NOM_MAX, statutDe, typeDe } from './plats.js';
import { FORMAT, validerPaquet } from './paquet.js';
import {
  CASES_REPERES, VIANDES, VOCABULAIRES, estRelue, marqueursEffectifs,
} from './vocabulaire.js';
import { reporterReperes } from './relecture.js';
import { reperesAttendus } from './compatibilite.js';
import { estDansCorbeille } from './corbeille.js';

// ——— Libellés (ordre d'affichage = ordre des clés) ———

export const UNITES_EDITION = ['g', 'kg', 'pc', 'cs', 'cc', 'ml', 'cl', 'l', 'tranche', 'pincee', 'sachet', 'boite', 'botte'];

export const LIBELLES_UNITE = {
  g: 'g',
  kg: 'kg',
  pc: 'pièce',
  cs: 'c. à soupe',
  cc: 'c. à café',
  ml: 'ml',
  cl: 'cl',
  l: 'l',
  tranche: 'tranche',
  pincee: 'pincée',
  sachet: 'sachet',
  boite: 'boîte',
  botte: 'botte',
};

export const LIBELLES_RAYON = {
  fruits_legumes: 'Fruits et légumes',
  boucherie: 'Boucherie',
  charcuterie: 'Charcuterie',
  poissonnerie: 'Poissonnerie',
  cremerie: 'Crèmerie',
  fromages: 'Fromages',
  epicerie_salee: 'Épicerie salée',
  epicerie_sucree: 'Épicerie sucrée',
  boulangerie: 'Boulangerie',
  surgeles: 'Surgelés',
  boissons: 'Boissons',
  hygiene: 'Hygiène',
  entretien: 'Entretien',
  divers: 'Divers',
};

export const LIBELLES_FORME = { hachee: 'Hachée', fine: 'En fines lamelles', morceaux: 'En morceaux', effilochable: 'Effilochée' };

export const LIBELLES_ROLE = { principal: 'Bien visible', incorpore: 'Fondu dans le plat' };

// Nature d'un ingrédient, demandée une fois pour toutes pour un produit jamais vu. Marqueurs exclusifs.
export const NATURES = {
  viande: { libelle: 'Viande', marqueurs: ['viande'], forme: 'morceaux', rayon: 'boucherie' },
  poisson: { libelle: 'Poisson', marqueurs: ['poisson'], rayon: 'poissonnerie' },
  legume: { libelle: 'Légume', marqueurs: ['legume'], role: 'incorpore', rayon: 'fruits_legumes' },
  autre: { libelle: 'Autre', marqueurs: [], rayon: 'epicerie_salee' },
};

export const PORTIONS_MAX = 50; // portions de base
export const FRIGO_JOURS_MAX = 14;
export const DUREE_MAX = 1440; // minutes
export const QTE_MAX = 100000;

/**
 * Repères de préparation (T2c) : ils disent comment la recette sert le produit, pas ce qu'est le produit. Jamais
 * hérités du catalogue : un filet de bœuf vu dans un carpaccio (`cru`) n'arrive pas cru dans un ragoût. L'ingrédient
 * modifié (même produit) garde les siens. `lait_cru`, `fruit_coque`, `miel`, `soja`, `poisson_predateur` et `cafeine`
 * sont des propriétés du produit : ils restent hérités.
 */
export const MARQUEURS_PREPARATION = ['cru', 'oeuf_cru', 'alcool_cru'];

const POISSONS = ['poisson', 'fruits_de_mer'];
const MARQUEURS_DE_NATURE = [...VIANDES, ...POISSONS, 'legume'];
const APPAREILS_A_TEMPERATURE = ['four', 'airfryer'];
const PRODUIT_MAX = 80;

// Champs du modèle d'édition, dans l'ordre des conflits annoncés.
const CHAMPS_SAISIE = ['nom', 'type', 'portionsBase', 'ingredients', 'etapes', 'cuisson', 'frigoJours', 'congelable',
  'emporter', 'verifiee'];
// Champs de recette du format d'import (CLAUDE.md §8) : les seuls soumis à la validation.
const CHAMPS_RECETTE = ['id', 'nom', 'type', 'recurrence', 'statutRecette', 'portionsBase', 'ingredients', 'etapes',
  'cuisson', 'tempsActifMin', 'conservation', 'emporter', 'variantes', 'source'];

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();
const comparer = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

/** Copie profonde des tables et des listes ; les clés de valeur undefined sont omises. */
function copier(valeur) {
  if (Array.isArray(valeur)) return valeur.map(copier);
  if (estObjet(valeur)) {
    const copie = {};
    for (const [cle, v] of Object.entries(valeur)) if (v !== undefined) copie[cle] = copier(v);
    return copie;
  }
  return valeur;
}

// ——— Nature d'un ingrédient ———

/** 'viande' | 'poisson' | 'legume' | 'autre', d'après les marqueurs. */
export function natureDe(ingredient) {
  const marqueurs = Array.isArray(ingredient?.marqueurs) ? ingredient.marqueurs : [];
  if (marqueurs.some((m) => VIANDES.includes(m))) return 'viande';
  if (marqueurs.some((m) => POISSONS.includes(m))) return 'poisson';
  if (marqueurs.includes('legume')) return 'legume';
  return 'autre';
}

/**
 * Nouvel ingrédient de la nature choisie. Seuls les marqueurs de nature sont remplacés (laitier, féculent, œuf…
 * restent) ; forme gardée pour une viande seulement (« en morceaux » par défaut), rôle pour un légume seulement
 * (« fondu dans le plat » par défaut). Le rayon ne change pas.
 */
export function appliquerNature(ingredient, nature) {
  const copie = copier(estObjet(ingredient) ? ingredient : {});
  if (!Object.hasOwn(NATURES, nature ?? '') || natureDe(copie) === nature) return copie;
  const autres = (Array.isArray(copie.marqueurs) ? copie.marqueurs : []).filter((m) => !MARQUEURS_DE_NATURE.includes(m));
  copie.marqueurs = [...new Set([...NATURES[nature].marqueurs, ...autres])];
  if (nature === 'viande') copie.forme = VOCABULAIRES.forme.includes(copie.forme) ? copie.forme : NATURES.viande.forme;
  else delete copie.forme;
  if (nature === 'legume') copie.role = VOCABULAIRES.role.includes(copie.role) ? copie.role : NATURES.legume.role;
  else delete copie.role;
  return copie;
}

// ——— Repères (T2c-2) ———

// Cases « Repères » et repères de précaution : déplacés dans vocabulaire.js (T2d), toujours importables d'ici.
export { CASES_REPERES, MARQUEURS_PRECAUTION } from './vocabulaire.js';

const CASES_PAR_ID = new Map(CASES_REPERES.map((c) => [c.id, c]));

/** `surveilles` lisible : un Set (Set ou liste reçus), ou null quand il est absent (alors tout compte). */
function ensembleSurveille(surveilles) {
  if (surveilles instanceof Set) return surveilles;
  if (Array.isArray(surveilles)) return new Set(surveilles);
  return null;
}

/** Vrai si une règle active surveille l'un des marqueurs de la case (`pose` ou `retire`) ; `suivis` null : toujours. */
const caseSuivie = (definition, suivis) => !suivis || [...definition.pose, ...definition.retire].some((m) => suivis.has(m));

/** Vrai si la case est cochée : l'un de ses `retire` est porté (marqueurs effectifs : `cafe` vaut `cafeine`). */
const caseCochee = (definition, effectifs) => definition.retire.some((m) => effectifs.has(m));

// Deux cases qui retirent les mêmes marqueurs (« Crue ou rosée » d'une viande, « Cru » d'un poisson) : une seule montrée.
const signatureRetrait = (definition) => [...definition.retire].sort().join('|');

/** Marqueurs (textes) d'une liste, sans doublon, dans leur ordre. */
const marqueursDe = (liste) => [...new Set((Array.isArray(liste) ? liste : []).filter((m) => typeof m === 'string' && m !== ''))];

/**
 * Cases « Repères » à montrer pour cet ingrédient, dans l'ordre de CASES_REPERES. Une case est montrée :
 * - si sa nature est celle de l'ingrédient (`nature`, sinon natureDe) et qu'une règle active surveille l'un de ses
 *   marqueurs (`surveilles` : Set ou liste, regles.js › marqueursSurveilles ; absent, tous) ;
 * - ou si elle est déjà cochée, quelle que soit la nature (un `cru` resté après un passage de « Poisson » à « Autre »
 *   reste visible et décochable) ; parmi les cases qui retirent les mêmes marqueurs, une seule : celle de la nature,
 *   sinon la première.
 * `coche` : l'un de ses `retire` est présent dans les marqueurs effectifs (`cafe` coche « Café, thé, cola »,
 * `gelatine_porc` coche « Gélatine animale »). → [{ id, libelle, coche }] ([] : rien à afficher)
 */
export function casesPour(ingredient, { surveilles = null, nature = null } = {}) {
  const suivis = ensembleSurveille(surveilles);
  const marqueurs = marqueursDe(ingredient?.marqueurs);
  const effectifs = marqueursEffectifs({ marqueurs });
  const sienne = Object.hasOwn(NATURES, nature ?? '') ? nature : natureDe({ marqueurs });
  const montrees = new Set();
  const signatures = new Set();
  const montrer = (definition) => {
    montrees.add(definition.id);
    signatures.add(signatureRetrait(definition));
  };
  for (const definition of CASES_REPERES) {
    if (definition.natures.includes(sienne) && (caseSuivie(definition, suivis) || caseCochee(definition, effectifs))) {
      montrer(definition);
    }
  }
  for (const definition of CASES_REPERES) {
    if (montrees.has(definition.id) || signatures.has(signatureRetrait(definition))) continue;
    if (caseCochee(definition, effectifs)) montrer(definition);
  }
  return CASES_REPERES.filter((d) => montrees.has(d.id))
    .map((d) => ({ id: d.id, libelle: d.libelle, coche: caseCochee(d, effectifs) }));
}

/**
 * Marqueurs après un toucher sur une case : cocher ajoute `pose` (rien si la case est déjà cochée : un `cafe` reste
 * `cafe`) ; décocher retire tout `retire`. Les autres marqueurs restent, dans leur ordre, sans doublon. Case inconnue :
 * marqueurs inchangés. → nouvelle liste
 */
export function appliquerCase(marqueurs, caseId, coche) {
  const liste = marqueursDe(marqueurs);
  const definition = typeof caseId === 'string' ? CASES_PAR_ID.get(caseId) : undefined;
  if (!definition) return liste;
  if (!coche) return liste.filter((m) => !definition.retire.includes(m));
  if (caseCochee(definition, marqueursEffectifs({ marqueurs: liste }))) return liste;
  return [...liste, ...definition.pose.filter((m) => !liste.includes(m))];
}

/**
 * Repères proposés cochés d'après le nom (compatibilite.js › reperesAttendus), seulement ceux d'une case qu'une règle
 * active surveille (`surveilles` ; absent, tous). `connu` : produit déjà connu du catalogue, qui garde ses propriétés
 * (lait cru, fruits à coque…) : seuls les repères de préparation (MARQUEURS_PREPARATION) sont proposés (« jambon cru »
 * → cru). Jamais `viande` (une nature, pas une case). → [marqueurs]
 */
export function reperesProposes(produit, { surveilles = null, connu = false } = {}) {
  const suivis = ensembleSurveille(surveilles);
  return reperesAttendus(produit).filter((marqueur) => {
    if (connu && !MARQUEURS_PREPARATION.includes(marqueur)) return false;
    return CASES_REPERES.some((d) => d.pose.includes(marqueur) && caseSuivie(d, suivis));
  });
}

/** Nature que laissent attendre les repères d'un nom : viande, puis poisson, puis autre ; null si rien n'est sûr (cru). */
function natureAnnoncee(attendus) {
  const natures = attendus.map((marqueur) => {
    if (marqueur === 'viande') return 'viande';
    const premieres = new Set(CASES_REPERES.filter((d) => d.pose.includes(marqueur)).map((d) => d.natures[0]));
    return premieres.size === 1 ? [...premieres][0] : null;
  });
  return ['viande', 'poisson', 'autre'].find((n) => natures.includes(n)) ?? null;
}

/**
 * Ce que le nom d'un produit laisse attendre, toujours modifiable :
 * - produit jamais vu : `nature` présélectionnée (« Viande » pour lardons, poulet, escargots, jambon cru… ; « Poisson »
 *   pour l'espadon ; « Autre » pour un bouillon, un fond ou un fumet de viande, une gélatine, une graisse animale, des
 *   noix, du café, du miel, du tofu ; null si le nom ne dit pas ce que c'est, « tartare de saumon ») et `reperes`
 *   proposés cochés (reperesProposes, filtrés par `surveilles`) ;
 * - produit connu du catalogue : sa nature vient du catalogue (`nature: null`) ; seuls ses repères de préparation sont
 *   proposés (« jambon cru » → cru).
 * → { nature, reperes } ou null (rien à proposer).
 */
export function natureProposee(produit, catalogue = [], { surveilles = null } = {}) {
  if (produitConnu(catalogue, produit)) {
    const reperes = reperesProposes(produit, { surveilles, connu: true });
    return reperes.length ? { nature: null, reperes } : null;
  }
  const nature = natureAnnoncee(reperesAttendus(produit));
  const reperes = reperesProposes(produit, { surveilles });
  return nature || reperes.length ? { nature, reperes } : null;
}

// ——— Base qui s'enrichit : catalogue des produits connus ———

/** Valeur la plus fréquente ; en cas d'égalité, la première rencontrée. undefined si la liste est vide. */
function plusFrequente(valeurs, cle = (v) => v) {
  const comptes = new Map();
  for (const valeur of valeurs) {
    const k = cle(valeur);
    const compte = comptes.get(k);
    if (compte) compte.n += 1;
    else comptes.set(k, { valeur, n: 1 });
  }
  let meilleure;
  for (const compte of comptes.values()) if (!meilleure || compte.n > meilleure.n) meilleure = compte;
  return meilleure?.valeur;
}

const memoire = new WeakMap();

/**
 * Produits déjà connus, tirés des ingrédients de tous les plats (variantes comprises) : unité et rayon les plus
 * fréquents, marqueurs, forme et rôle de l'occurrence la plus fréquente, quantité habituelle dans l'unité retenue.
 * Les repères de préparation (MARQUEURS_PREPARATION) ne sont jamais retenus.
 * → [{ produit, unite, rayon, marqueurs, forme?, role?, qte?, nature }] trié par nom. Même tableau `plats` → même
 * résultat (identité), sans recalcul.
 */
export function catalogueProduits(plats) {
  if (!Array.isArray(plats)) return [];
  if (memoire.has(plats)) return memoire.get(plats);
  const parProduit = new Map();
  const noter = (brut, avecQte) => {
    if (!estObjet(brut) || typeof brut.produit !== 'string') return;
    const produit = reduire(brut.produit).toLocaleLowerCase('fr-FR');
    const cle = slug(produit);
    if (!cle) return;
    const marqueurs = [...new Set((Array.isArray(brut.marqueurs) ? brut.marqueurs : [])
      .filter((m) => VOCABULAIRES.marqueurs.includes(m) && !MARQUEURS_PREPARATION.includes(m)))];
    const occurrence = { produit, marqueurs };
    if (VOCABULAIRES.unite.includes(brut.unite)) occurrence.unite = brut.unite;
    if (VOCABULAIRES.rayon.includes(brut.rayon)) occurrence.rayon = brut.rayon;
    if (VOCABULAIRES.forme.includes(brut.forme)) occurrence.forme = brut.forme;
    if (VOCABULAIRES.role.includes(brut.role)) occurrence.role = brut.role;
    if (avecQte && estNombre(brut.qte) && brut.qte > 0) occurrence.qte = brut.qte;
    if (!parProduit.has(cle)) parProduit.set(cle, []);
    parProduit.get(cle).push(occurrence);
  };
  for (const plat of plats) {
    for (const ingredient of Array.isArray(plat?.ingredients) ? plat.ingredients : []) noter(ingredient, true);
    for (const variante of Array.isArray(plat?.variantes) ? plat.variantes : []) {
      for (const ajout of Array.isArray(variante?.ajouter) ? variante.ajouter : []) noter(ajout, false);
    }
  }

  const catalogue = [];
  for (const occurrences of parProduit.values()) {
    const signature = plusFrequente(occurrences, (o) => JSON.stringify([[...o.marqueurs].sort(), o.forme ?? '', o.role ?? '']));
    const nature = natureDe(signature);
    const unite = plusFrequente(occurrences.map((o) => o.unite).filter(Boolean)) ?? 'g';
    const element = {
      produit: plusFrequente(occurrences.map((o) => o.produit)),
      unite,
      rayon: plusFrequente(occurrences.map((o) => o.rayon).filter(Boolean)) ?? NATURES[nature].rayon,
      marqueurs: [...signature.marqueurs],
    };
    // Lait cru (T2d) : sens prudent, le produit connu le porte dès qu'une seule occurrence le porte (un reblochon dont
    // le repère a été enlevé dans une tartiflette cuite au four reste « au lait cru » ailleurs).
    if (!element.marqueurs.includes('lait_cru') && occurrences.some((o) => o.marqueurs.includes('lait_cru'))) {
      element.marqueurs.push('lait_cru');
    }
    if (signature.forme) element.forme = signature.forme;
    if (signature.role) element.role = signature.role;
    const qte = plusFrequente(occurrences.filter((o) => o.unite === unite && o.qte !== undefined).map((o) => o.qte));
    if (qte !== undefined) element.qte = qte;
    element.nature = nature;
    catalogue.push(element);
  }
  catalogue.sort((a, b) => comparer(a.produit, b.produit));
  memoire.set(plats, catalogue);
  return catalogue;
}

/**
 * Suggestions pour la saisie (casse et accents ignorés) : d'abord le nom exact, puis les noms qui commencent par
 * la saisie, puis ceux dont un mot commence par la saisie, puis ceux qui la contiennent.
 */
export function suggestions(catalogue, saisie, { max = 4 } = {}) {
  const cherche = slug(saisie);
  if (!cherche || !Array.isArray(catalogue)) return [];
  const rangs = [];
  for (const element of catalogue) {
    const nom = slug(element?.produit);
    let rang = -1;
    if (nom === cherche) rang = 0;
    else if (nom.startsWith(cherche)) rang = 1;
    else if (nom.includes(`-${cherche}`)) rang = 2;
    else if (nom.includes(cherche)) rang = 3;
    if (rang >= 0) rangs.push({ element, rang });
  }
  // Tri stable : l'ordre du catalogue (alphabétique) est gardé à rang égal.
  return rangs.sort((a, b) => a.rang - b.rang).slice(0, Math.max(0, max)).map((r) => r.element);
}

/** Élément du catalogue pour ce produit (casse et accents ignorés), ou null. */
export function produitConnu(catalogue, produit) {
  const cherche = slug(produit);
  if (!cherche || !Array.isArray(catalogue)) return null;
  return catalogue.find((element) => slug(element?.produit) === cherche) ?? null;
}

// ——— Saisie d'un ingrédient (feuille) ———

/** Quantité saisie (« 0,5 », « 450 ») arrondie à 3 décimales ; NaN si illisible. */
function quantite(valeur) {
  if (estNombre(valeur)) return Math.round(valeur * 1000) / 1000;
  if (typeof valeur !== 'string') return NaN;
  const propre = valeur.replace(/\s/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(propre)) return NaN;
  return Math.round(Number(propre) * 1000) / 1000;
}

/**
 * Point de départ des marqueurs d'un ingrédient saisi, avant tout toucher sur une case « Repères » : ceux de
 * l'ingrédient modifié (même produit), sinon ceux du produit connu (sans ses repères de préparation), sinon aucun ;
 * la nature choisie appliquée ; puis les repères que le nom annonce (reperesProposes, filtrés par `surveilles`) : tous
 * pour un produit jamais vu, ceux de préparation pour un produit connu, aucun pour l'ingrédient modifié (il montre ce
 * qu'il porte). `source` : base retenue, null pour un produit jamais vu sans nature choisie.
 * → { source, marqueurs, proposes }
 */
function depart(produit, { catalogue, liste, index, choisie, surveilles }) {
  const cle = slug(produit);
  const modifie = Number.isInteger(index) && estObjet(liste[index]) && slug(liste[index].produit) === cle
    ? liste[index] : null;
  const connu = modifie ? null : produitConnu(catalogue, produit);
  // Produit connu (pas l'ingrédient modifié) : ses repères de préparation ne suivent jamais.
  const base = modifie ?? (connu ? { ...connu, marqueurs: (Array.isArray(connu.marqueurs) ? connu.marqueurs : [])
    .filter((m) => !MARQUEURS_PREPARATION.includes(m)) } : null);
  let source = null;
  if (choisie) source = appliquerNature(base ?? { marqueurs: [] }, choisie);
  else if (base) source = copier(base);
  const marqueurs = marqueursDe(source?.marqueurs).filter((m) => VOCABULAIRES.marqueurs.includes(m));
  const proposes = modifie ? [] : reperesProposes(produit, { surveilles, connu: Boolean(connu) });
  const effectifs = marqueursEffectifs({ marqueurs });
  for (const marqueur of proposes) if (!effectifs.has(marqueur) && !marqueurs.includes(marqueur)) marqueurs.push(marqueur);
  return { source, marqueurs, proposes };
}

/**
 * Marqueurs que « Modifier » montre pour un ingrédient avant tout toucher sur une case (les mêmes qu'ingredientSaisi
 * part, voir `depart`) : de quoi dessiner les cases (casesPour) sans écart avec ce qui sera enregistré.
 * `champs` : { produit, nature? } ; options comme ingredientSaisi. → { marqueurs, proposes } ou null (nom vide).
 */
export function marqueursDeDepart(champs, { catalogue = [], ingredients = [], index = null, surveilles = null } = {}) {
  const produit = reduire(champs?.produit).toLocaleLowerCase('fr-FR');
  if (!slug(produit)) return null;
  const choisie = Object.hasOwn(NATURES, champs?.nature ?? '') ? champs.nature : null;
  const { marqueurs, proposes } = depart(produit, {
    catalogue, liste: Array.isArray(ingredients) ? ingredients : [], index, choisie, surveilles,
  });
  return { marqueurs, proposes };
}

/** Changements de cases lisibles : { caseId } d'une case connue et `coche` booléen ; les autres sont ignorés. */
function changementsDe(reperes) {
  return (Array.isArray(reperes) ? reperes : [])
    .filter((c) => estObjet(c) && typeof c.caseId === 'string' && CASES_PAR_ID.has(c.caseId) && typeof c.coche === 'boolean');
}

/**
 * Ingrédient complet à partir des champs de la feuille.
 * `champs` : { produit, qte, unite, rayon, nature, forme, role, reperes? } tels que saisis. `reperes` (facultatif) :
 * changements des cases « Repères », [{ caseId, coche }] dans l'ordre des touchers ; seules les cases changées y
 * figurent et sont appliquées (appliquerCase) : une case non touchée laisse ses marqueurs tels quels (un `cafe` reste
 * `cafe`, un `gelatine_porc` reste `gelatine_porc`). Avant eux, les repères proposés d'après le nom sont posés (voir
 * `depart` : produit jamais vu, ou repères de préparation d'un produit connu, filtrés par `surveilles`).
 * `ingredients` : ceux de la recette en cours ; `index` : position de l'ingrédient modifié (null pour un ajout) ;
 * `surveilles` : marqueurs que surveille une règle active (regles.js › marqueursSurveilles ; absent, tous).
 * → { ingredient } ou { erreurs: { produit?, qte?, unite?, nature? } }
 */
export function ingredientSaisi(champs, { catalogue = [], ingredients = [], index = null, surveilles = null } = {}) {
  const erreurs = {};
  const produit = reduire(champs?.produit).toLocaleLowerCase('fr-FR');
  const cle = slug(produit);
  const liste = Array.isArray(ingredients) ? ingredients : [];
  if (!produit) erreurs.produit = 'Écrivez le nom de l’ingrédient.';
  else if (produit.length > PRODUIT_MAX) erreurs.produit = `Nom trop long (${PRODUIT_MAX} caractères au plus).`;
  else if (!cle) erreurs.produit = 'Ce nom ne contient ni lettre ni chiffre.';
  else if (liste.some((ingredient, i) => i !== index && slug(ingredient?.produit) === cle)) {
    erreurs.produit = `«\u00A0${produit}\u00A0» est déjà dans la recette.`;
  }

  const qte = quantite(champs?.qte);
  if (!(qte > 0 && qte <= QTE_MAX)) erreurs.qte = 'Quantité\u00A0: un nombre, par exemple 0,5.';

  const unite = champs?.unite;
  if (!VOCABULAIRES.unite.includes(unite)) erreurs.unite = 'Choisissez une unité.';

  // Marqueurs, forme et rôle : la nature choisie, sinon l'ingrédient modifié (même produit), sinon le catalogue.
  const choisie = Object.hasOwn(NATURES, champs?.nature ?? '') ? champs.nature : null;
  let debut = null;
  if (!erreurs.produit) {
    debut = depart(produit, { catalogue, liste, index, choisie, surveilles });
    if (!debut.source) erreurs.nature = 'Choisissez\u00A0: viande, poisson, légume ou autre.';
  }
  if (Object.keys(erreurs).length) return { erreurs };

  const { source } = debut;
  // Repères : ceux du départ (proposés compris), puis les seules cases touchées, dans l'ordre des touchers.
  let marqueurs = debut.marqueurs;
  for (const { caseId, coche } of changementsDe(champs?.reperes)) marqueurs = appliquerCase(marqueurs, caseId, coche);
  marqueurs = marqueurs.filter((m) => VOCABULAIRES.marqueurs.includes(m));
  const nature = natureDe({ marqueurs });
  // Rayon : celui choisi, sinon celui de la base retenue, sinon celui de la nature.
  let rayon = NATURES[choisie ?? nature].rayon;
  if (VOCABULAIRES.rayon.includes(champs?.rayon)) rayon = champs.rayon;
  else if (VOCABULAIRES.rayon.includes(source.rayon)) rayon = source.rayon;

  const ingredient = { produit, qte, unite, rayon, marqueurs };
  // Forme et rôle selon les marqueurs, comme la validation : un ingrédient peut être à la fois viande et légume.
  if (marqueurs.some((m) => VIANDES.includes(m))) {
    const forme = [champs?.forme, source.forme].find((f) => VOCABULAIRES.forme.includes(f));
    ingredient.forme = forme ?? NATURES.viande.forme;
  }
  if (marqueurs.includes('legume')) {
    const role = [champs?.role, source.role].find((r) => VOCABULAIRES.role.includes(r));
    ingredient.role = role ?? NATURES.legume.role;
  }
  return { ingredient };
}

// ——— Modèle d'édition (« saisie ») ———

/** Valeurs affichées par l'écran « Modifier », comparables entre elles. */
export function normaliserPourEdition(plat, reglages) {
  const portions = plat?.portionsBase;
  return {
    nom: String(plat?.nom ?? ''),
    type: typeDe(plat),
    portionsBase: Number.isInteger(portions) && portions >= 1 ? portions : 4,
    ingredients: Array.isArray(plat?.ingredients) ? copier(plat.ingredients) : [],
    etapes: Array.isArray(plat?.etapes) ? plat.etapes.map(String) : [],
    cuisson: Array.isArray(plat?.cuisson) ? copier(plat.cuisson) : [],
    frigoJours: plat?.conservation?.frigoJours ?? reglages?.frigoJoursDefaut ?? 3,
    congelable: plat?.conservation?.congelable ?? null,
    emporter: plat?.emporter ?? true,
    verifiee: plat?.statutRecette === 'validee',
  };
}

/** Égalité profonde : tables sans tenir compte de l'ordre des clés, listes dans l'ordre ; undefined = clé absente. */
export function egalProfonde(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => egalProfonde(v, b[i]));
  for (const cle of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!egalProfonde(a[cle], b[cle])) return false;
  }
  return true;
}

/** Nouvelle liste où l'élément `de` est placé en position `vers` ; simple copie si l'une des positions est hors bornes. */
export function deplacer(liste, de, vers) {
  const copie = Array.isArray(liste) ? [...liste] : [];
  const dedans = (i) => Number.isInteger(i) && i >= 0 && i < copie.length;
  if (!dedans(de) || !dedans(vers)) return copie;
  const [element] = copie.splice(de, 1);
  copie.splice(vers, 0, element);
  return copie;
}

/** Nouvelle liste d'étapes, avec l'étape ajoutée à la fin ; une étape vide n'est pas ajoutée. */
export function ajouterEtape(etapes, texte) {
  const copie = Array.isArray(etapes) ? [...etapes] : [];
  const propre = reduire(texte);
  if (propre) copie.push(propre);
  return copie;
}

// ——— Cuisson principale (« Cuit surtout au ») ———

/** Position de l'étape de cuisson principale (même règle que `cuissonPrincipale`), ou -1. */
export function indexCuissonPrincipale(cuisson) {
  let index = -1;
  let plusLongue = 0;
  (Array.isArray(cuisson) ? cuisson : []).forEach((etape, i) => {
    if (!Object.hasOwn(APPAREILS, etape?.appareil ?? '')) return;
    const duree = estNombre(etape.dureeMin) ? etape.dureeMin : 0;
    if (index === -1 || duree > plusLongue) {
      index = i;
      plusLongue = duree;
    }
  });
  return index;
}

/**
 * Nouvelle liste de cuisson avec la cuisson principale choisie. « Aucun » (`appareil` null) → []. L'étape
 * principale garde sa température pour le four et l'airfryer, et son mode si l'appareil ne change pas ; sans étape
 * principale, une étape est ajoutée à la fin. `dureeMin` null : durée pas encore saisie (étape sans durée) ; une
 * durée en texte (« 20 ») est lue comme un nombre.
 */
export function changerCuissonPrincipale(cuisson, { appareil, dureeMin } = {}) {
  if (appareil === null) return [];
  const liste = Array.isArray(cuisson) ? copier(cuisson) : [];
  if (!Object.hasOwn(APPAREILS, appareil ?? '')) return liste;
  const index = indexCuissonPrincipale(liste);
  const etape = { appareil };
  if (index >= 0) {
    const ancienne = liste[index];
    if (APPAREILS_A_TEMPERATURE.includes(appareil) && ancienne.tempC != null) etape.tempC = ancienne.tempC;
    if (ancienne.appareil === appareil && ancienne.mode != null) etape.mode = ancienne.mode;
  }
  const duree = typeof dureeMin === 'string' ? quantite(dureeMin) : dureeMin;
  if (estNombre(duree)) etape.dureeMin = duree;
  if (index >= 0) liste[index] = etape;
  else liste.push(etape);
  return liste;
}

// ——— Préparer l'enregistrement ———

const dureeValide = (duree) => estNombre(duree) && duree >= 1 && duree <= DUREE_MAX;

/**
 * Écritures de « Enregistrer ». `base` : saisie figée à l'ouverture ; `saisie` : saisie courante ; `actuel` :
 * document actuel du plat (avec `id`). Seuls les champs touchés (saisie ≠ base) sont écrits : un champ non touché
 * suit la fiche actuelle, même changée ailleurs entre-temps.
 * → { champs, supprimer, demandesAClore, conflits, erreurs: [{ champ, message }], rien }
 */
export function preparerModification(base, saisie, actuel, { plats = [], demandes = [], reglages = null } = {}) {
  const plat = estObjet(actuel) ? actuel : {};
  const touche = (champ) => !egalProfonde(saisie?.[champ], base?.[champ]);
  const ailleurs = normaliserPourEdition(plat, reglages);
  const champs = {};
  const supprimer = [];
  const demandesAClore = [];
  const erreurs = [];
  const erreur = (champ, message) => erreurs.push({ champ, message });
  const enAttente = statutDe(plat) === 'attente';
  const ingredientsSaisis = Array.isArray(saisie?.ingredients) ? saisie.ingredients : [];

  // Plat ⏳ qui reçoit ses ingrédients : la recette entière est écrite, et la demande de recette close.
  const recetteRecue = enAttente && ingredientsSaisis.length > 0;
  // Les quantités valent pour le nombre de portions affiché : portions et ingrédients s'écrivent ensemble
  // (sauf les ingrédients d'un plat ⏳ resté sans ingrédients).
  const ecrirePortions = touche('portionsBase') || touche('ingredients') || recetteRecue;
  const ecrireIngredients = touche('ingredients') || recetteRecue || (ecrirePortions && !enAttente);
  const ecrits = new Set(CHAMPS_SAISIE.filter(touche));
  if (ecrirePortions) ecrits.add('portionsBase');
  if (ecrireIngredients) ecrits.add('ingredients');
  const conflits = CHAMPS_SAISIE.filter((champ) => ecrits.has(champ) && !egalProfonde(ailleurs[champ], base?.[champ]));

  if (touche('nom')) {
    const nom = reduire(saisie.nom);
    const cle = slug(nom);
    // Un plat de la corbeille garde son nom (on le remet au lieu de le recréer) ; un plat actif du même nom passe avant.
    const memeNom = cle ? (Array.isArray(plats) ? plats : []).filter((p) => p?.id !== plat.id && slug(p?.nom) === cle) : [];
    const autre = memeNom.find((p) => !estDansCorbeille(p)) ?? memeNom[0] ?? null;
    if (!nom) erreur('nom', 'Donnez un nom au plat.');
    else if (nom.length > NOM_MAX) erreur('nom', `Le nom est trop long (${NOM_MAX} caractères au plus).`);
    else if (!cle) erreur('nom', 'Ce nom ne contient ni lettre ni chiffre.');
    else if (autre && estDansCorbeille(autre)) erreur('nom', `«\u00A0${autre.nom}\u00A0» est dans la corbeille. Choisissez un autre nom.`);
    else if (autre) erreur('nom', `«\u00A0${autre.nom}\u00A0» existe déjà.`);
    champs.nom = nom;
  }
  if (touche('type')) champs.type = saisie.type;

  if (ecrirePortions) {
    const portions = saisie?.portionsBase;
    if (!(Number.isInteger(portions) && portions >= 1 && portions <= PORTIONS_MAX)) {
      erreur('portionsBase', 'Indiquez au moins une portion.');
    }
    champs.portionsBase = portions;
  }
  // Repères de précaution posés ailleurs depuis l'ouverture (relecture par Claude, autre téléphone) : gardés (T2d).
  if (ecrireIngredients) {
    champs.ingredients = reporterReperes(base?.ingredients, ingredientsSaisis, Array.isArray(plat.ingredients) ? plat.ingredients : []);
  }
  // Ingrédients tels qu'ils seront enregistrés : ceux de la saisie s'ils sont écrits, sinon ceux de la fiche.
  const ingredients = ecrireIngredients ? champs.ingredients : (Array.isArray(plat.ingredients) ? plat.ingredients : []);
  if (!ingredients.length && !enAttente) erreur('ingredients', 'Ajoutez au moins un ingrédient.');

  if (touche('verifiee') && saisie.verifiee && !ingredients.length) {
    erreur('verifiee', 'Ajoutez les ingrédients avant de la marquer vérifiée.');
  }
  if (recetteRecue) champs.statutRecette = saisie.verifiee ? 'validee' : 'brouillon';
  else if (touche('verifiee')) champs.statutRecette = saisie.verifiee ? 'validee' : 'brouillon';

  if (touche('etapes')) {
    const etapes = (Array.isArray(saisie.etapes) ? saisie.etapes : []).map(reduire).filter(Boolean);
    if (etapes.length) champs.etapes = etapes;
    else supprimer.push('etapes');
  }

  if (touche('cuisson')) {
    const cuisson = Array.isArray(saisie.cuisson) ? copier(saisie.cuisson) : [];
    const principale = indexCuissonPrincipale(cuisson);
    const sansDuree = cuisson.some((etape, i) => (i === principale
      ? !dureeValide(etape?.dureeMin)
      : !(estNombre(etape?.dureeMin) && etape.dureeMin > 0)));
    if (sansDuree) erreur('cuisson', 'Indiquez la durée de cuisson, en minutes.');
    if (cuisson.length) champs.cuisson = cuisson;
    else supprimer.push('cuisson');
  }

  // Conservation : seuls les sous-champs touchés (écrits un par un par donnees.js : l'autre sous-champ, changé
  // ailleurs peut-être, reste). Jamais de table vide.
  if (touche('frigoJours') || touche('congelable')) {
    const conservation = {};
    if (touche('frigoJours')) {
      const jours = saisie.frigoJours;
      if (!(Number.isInteger(jours) && jours >= 0 && jours <= FRIGO_JOURS_MAX)) {
        erreur('frigoJours', `Nombre de jours au frigo\u00A0: de 0 à ${FRIGO_JOURS_MAX}.`);
      }
      if (jours !== undefined) conservation.frigoJours = jours;
    }
    if (touche('congelable') && typeof saisie.congelable === 'boolean') conservation.congelable = saisie.congelable;
    if (Object.keys(conservation).length) champs.conservation = conservation;
  }

  if (touche('emporter') && saisie.emporter !== undefined) champs.emporter = saisie.emporter;

  // Recette relue par Claude (T2d) : elle revient à relire si un produit nouveau apparaît (ingrédient ajouté ou
  // renommé) ou si l'appareil de cuisson principal change. Jamais pour une quantité, une unité, les portions, les
  // étapes, la durée, la nature ni une case « Repères » : décisions humaines, qui priment. La marque est effacée même
  // si la fiche lue ici n'est pas relue : une modification faite hors ligne part plus tard, peut-être après une
  // relecture enregistrée ailleurs, qui jugeait l'ancienne recette (effacer un champ absent ne fait rien).
  {
    const connus = new Set((Array.isArray(plat.ingredients) ? plat.ingredients : []).filter(estObjet).map((i) => slug(i.produit)));
    const produitNouveau = ecrireIngredients && ingredients.some((i) => estObjet(i) && !connus.has(slug(i.produit)));
    const appareilPrincipal = (cuisson) => {
      const liste = Array.isArray(cuisson) ? cuisson : [];
      return liste[indexCuissonPrincipale(liste)]?.appareil ?? null;
    };
    let appareilChange = false;
    if (touche('cuisson')) {
      appareilChange = appareilPrincipal(champs.cuisson ?? []) !== appareilPrincipal(plat.cuisson);
    }
    if (produitNouveau || appareilChange) supprimer.push('reperesRelus');
  }

  const ouverte = (d) => d?.id === `${plat.id}__recette` && d?.statut === 'ouverte';
  if (recetteRecue && Array.isArray(demandes) && demandes.some(ouverte)) {
    demandesAClore.push(`${plat.id}__recette`);
  }

  // Dernier filet : la fiche telle qu'elle sera enregistrée doit rester valide pour le format d'import. Les versions
  // ne se modifient pas ici : elles sont jugées comme une fiche en base (`versionsEnDouble: 'premiere'` : versions en
  // double ou incohérentes, par exemple une ancienne version mer sans jours au frigo, ne bloquent pas l'enregistrement).
  if (!erreurs.length) {
    const candidat = {};
    for (const champ of CHAMPS_RECETTE) if (plat[champ] != null) candidat[champ] = copier(plat[champ]);
    Object.assign(candidat, copier(champs));
    if (champs.conservation) {
      candidat.conservation = { ...(estObjet(plat.conservation) ? copier(plat.conservation) : {}), ...champs.conservation };
    }
    for (const champ of supprimer) delete candidat[champ];
    const resultat = validerPaquet({ format: FORMAT, plats: [candidat] }, { versionsEnDouble: 'premiere' });
    for (const e of [...resultat.erreurs, ...resultat.plats.flatMap((p) => p.erreurs)]) erreur('recette', e.message);
  }

  for (const [cle, valeur] of Object.entries(champs)) if (valeur === undefined) delete champs[cle];
  const rien = !Object.keys(champs).length && !supprimer.length;
  return { champs, supprimer, demandesAClore, conflits, erreurs, rien };
}

// ——— Brouillon ———

const TYPES_SAISIE = {
  nom: (v) => typeof v === 'string',
  type: (v) => typeof v === 'string',
  portionsBase: (v) => estNombre(v),
  ingredients: (v) => Array.isArray(v) && v.every(estObjet),
  etapes: (v) => Array.isArray(v) && v.every((e) => typeof e === 'string'),
  cuisson: (v) => Array.isArray(v) && v.every(estObjet),
  frigoJours: (v) => estNombre(v),
  congelable: (v) => v === null || typeof v === 'boolean',
  emporter: (v) => typeof v === 'boolean',
  verifiee: (v) => typeof v === 'boolean',
};

function saisieValide(saisie) {
  if (!estObjet(saisie)) return false;
  const cles = Object.keys(saisie);
  if (cles.length !== CHAMPS_SAISIE.length || cles.some((cle) => !CHAMPS_SAISIE.includes(cle))) return false;
  return CHAMPS_SAISIE.every((cle) => TYPES_SAISIE[cle](saisie[cle]));
}

/** Vrai pour un brouillon intact : { v: 1, base, saisie, depuis }. Sert à rejeter un brouillon abîmé. */
export function brouillonValide(objet) {
  return estObjet(objet)
    && objet.v === 1
    && estNombre(objet.depuis)
    && saisieValide(objet.base)
    && saisieValide(objet.saisie);
}
