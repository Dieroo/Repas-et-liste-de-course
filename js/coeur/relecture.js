// Relecture des repères de précaution par Claude (CLAUDE.md §8, T2d) : plats à relire, empreinte de relecture,
// changements proposés par Claude, application aux ingrédients, repères gardés quand une recette est remplacée ou
// qu'une modification en cours est enregistrée. Logique pure : ni DOM ni Firebase.
// Une relecture ne touche qu'aux marqueurs de précaution (MARQUEURS_PRECAUTION) : jamais aux quantités, unités, noms,
// étapes ni versions. N'importe ni paquet.js, ni claude.js, ni edition.js (qui l'importent) : pas de cycle.
import { slug } from './slug.js';
import {
  CASES_REPERES, IMPLICATIONS, MARQUEURS_PRECAUTION, VERSION_REPERES, VOCABULAIRES, code, estObjet, estRelue, liste,
  libelleRepere, marqueursEffectifs, texte,
} from './vocabulaire.js';
import { evaluer, marqueursDouteux, profilsContraints } from './compatibilite.js';
import { aSaRecette, statutDe, typeDe } from './plats.js';
import { estDansCorbeille } from './corbeille.js';

export { VERSION_REPERES, estRelue };

/** Plats d'une demande de relecture : une réponse plus longue risque d'être coupée. */
export const LOT_PRECAUTIONS = 10;
/** Longueur au plus de la raison donnée par Claude (`pourquoi`), affichée telle quelle. */
export const POURQUOI_MAX = 120;

// Ordre des types dans la liste des plats à relire.
const ORDRE_TYPES = ['plat', 'dessert', 'apero', 'accompagnement', 'preparation'];
// Ce qu'un repère `cru` doit accompagner pour avoir un effet (marqueurs effectifs).
const CRUS_POSSIBLES = ['viande', 'poisson', 'fruits_de_mer'];
// Repères d'accompagnement que Claude pose souvent à côté d'un repère de précaution : ignorés sans rien dire.
const COMPAGNONS = { laitier: 'lait_cru', oeuf: 'oeuf_cru', poisson: 'poisson_predateur' };

const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
const marqueursDe = (valeurs) => [...new Set((Array.isArray(valeurs) ? valeurs : []).filter((m) => typeof m === 'string' && m !== ''))];
const ingredientsDe = (plat) => (Array.isArray(plat?.ingredients) ? plat.ingredients : []).filter(estObjet);
/** Une ligne de texte, sans retour à la ligne (même règle que claude.js). */
const ligne = (valeur) => texte(typeof valeur === 'number' ? String(valeur) : valeur);
const guillemets = (valeur) => `«\u00A0${valeur}\u00A0»`;

/** Copie d'une valeur sans aucune valeur undefined, à toute profondeur. */
function propre(valeur) {
  if (Array.isArray(valeur)) return valeur.filter((v) => v !== undefined).map(propre);
  if (estObjet(valeur)) {
    const copie = {};
    for (const [cle, v] of Object.entries(valeur)) if (v !== undefined) copie[cle] = propre(v);
    return copie;
  }
  return valeur;
}

// ——— Même produit ———

/** Mots d'un produit, chacun sans `s` ni `x` final (« pommes de terre » → pomme, de, terre ; « œufs » → oeuf). */
function motsSinguliers(produit) {
  return slug(produit).split('-').filter(Boolean).map((mot) => (mot.length > 2 ? mot.replace(/[sx]$/, '') : mot));
}

/**
 * Vrai si deux noms désignent le même produit : comparés en slug (casse, accents, tirets ignorés), un `s` ou un `x`
 * final toléré sur chaque mot, dans les deux sens (« pommes de terre » = « pomme de terre », « œufs » = « oeuf »).
 */
export function memeProduit(a, b) {
  const motsA = motsSinguliers(a);
  const motsB = motsSinguliers(b);
  return motsA.length > 0 && motsA.length === motsB.length && motsA.every((mot, i) => mot === motsB[i]);
}

// ——— Plats à relire ———

/** Vrai si le plat a sa recette (ni ⏳, ni sans ingrédients) et n'est pas relu ; la corbeille n'est pas regardée. */
export function aRelire(plat) {
  return estObjet(plat) && statutDe(plat) !== 'attente' && aSaRecette(plat) && !estRelue(plat);
}

/**
 * Plats dont Claude n'a pas encore relu les repères : plats actifs (hors corbeille), qui ont leur recette (ni ⏳, ni
 * plat sans ingrédients), de tous les types, sans marque `reperesRelus` à jour. Ordre indépendant des profils :
 * d'abord ceux dont un nom d'ingrédient annonce un repère absent (compatibilite.js › marqueursDouteux, tous les mots),
 * puis par type (plat, dessert, apéro, accompagnement, préparation), puis par nom.
 */
export function platsARelire(plats) {
  const retenus = (Array.isArray(plats) ? plats : [])
    .filter((plat) => estObjet(plat) && !estDansCorbeille(plat) && aRelire(plat));
  const rang = (plat) => {
    const i = ORDRE_TYPES.indexOf(typeDe(plat));
    return i === -1 ? ORDRE_TYPES.length : i;
  };
  const avecSoupcon = new Map(retenus.map((plat) => [plat, marqueursDouteux(plat).length > 0]));
  return [...retenus].sort((a, b) => Number(avecSoupcon.get(b)) - Number(avecSoupcon.get(a))
    || rang(a) - rang(b)
    || comparerNoms(String(a.nom ?? ''), String(b.nom ?? ''))
    || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}

/** Prochain lot de relecture : les LOT_PRECAUTIONS premiers plats à relire. */
export function lotDePrecautions(plats) {
  return platsARelire(plats).slice(0, LOT_PRECAUTIONS);
}

// ——— Texte d'un plat et empreinte ———

/** « four 200 °C 25 min » (espaces ordinaires). */
function cuissonEnTexte(etape) {
  return [ligne(etape?.appareil), etape?.tempC != null ? `${ligne(etape.tempC)} °C` : '',
    etape?.dureeMin != null ? `${ligne(etape.dureeMin)} min` : ''].filter(Boolean).join(' ');
}

/**
 * Lignes d'un plat dans DEMANDE-PRECAUTIONS, sauf `id`, `nom` et `empreinte` : `ingrédients:` (produits suivis de
 * leurs repères bruts entre crochets, sans quantités), `étapes:` et `cuisson:` (omises quand elles sont vides).
 */
export function lignesRelecture(plat) {
  const lignes = [`  ingrédients: ${ingredientsDe(plat)
    .map((ingredient) => `${ligne(ingredient.produit)} [${marqueursDe(ingredient.marqueurs).map(ligne).join(', ')}]`)
    .join(' ; ')}`];
  const etapes = (Array.isArray(plat?.etapes) ? plat.etapes : []).map(ligne).filter(Boolean);
  if (etapes.length) lignes.push(`  étapes: ${etapes.join(' / ')}`);
  const cuisson = (Array.isArray(plat?.cuisson) ? plat.cuisson : []).filter(estObjet).map(cuissonEnTexte).filter(Boolean);
  if (cuisson.length) lignes.push(`  cuisson: ${cuisson.join(' ; ')}`);
  return lignes;
}

/**
 * Empreinte de relecture d'un plat : 6 caractères [0-9a-z], hachage FNV-1a 32 bits du texte exact de ses lignes
 * `ingrédients:`, `étapes:` et `cuisson:` (lignesRelecture). Elle change avec un produit, un repère, une étape ou une
 * cuisson ; pas avec une quantité ni un renommage.
 */
export function empreinteRelecture(plat) {
  const source = lignesRelecture(plat).join('\n');
  let h = 0x811c9dc5;
  for (const octet of new TextEncoder().encode(source)) {
    h ^= octet;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % (36 ** 6)).toString(36).padStart(6, '0');
}

// ——— Validation d'une relecture ———

/** Liste de codes : une chaîne seule vaut une liste d'un élément ; null si illisible. */
function codesLus(valeur) {
  if (valeur == null) return [];
  const brutes = typeof valeur === 'string' ? [valeur] : valeur;
  if (!Array.isArray(brutes) || brutes.some((v) => typeof v !== 'string')) return null;
  return brutes.map((v) => ({ brut: texte(v), code: code(v) })).filter((v) => v.code);
}

/**
 * Forme et vocabulaire de `precautions` d'une réponse à DEMANDE-PRECAUTIONS. `position.affiche` : nom du plat
 * (messages). → { precautions: [{ produit, poser, enlever, pourquoi }] (deux éléments du même produit réunis),
 *   erreurs: [{ message, pourClaude }] (`pourClaude` commence par `precautions…`), avertissements,
 *   horsRelecture: [{ produit, marqueur, sens: 'poser' | 'enlever' }] (repères connus hors relecture, ni écrits ni
 *   bloquants ; `laitier`, `oeuf` et `poisson` posés à côté de `lait_cru`, `oeuf_cru` et `poisson_predateur` ignorés
 *   sans rien dire) }.
 */
export function validerPrecautions(brut, { position = {} } = {}) {
  const erreurs = [];
  const avertissements = [];
  const horsRelecture = [];
  const precautions = [];
  const nomPlat = texte(position?.affiche);
  const malFormee = `La relecture de ${nomPlat ? guillemets(nomPlat) : 'cette recette'} est mal formée.`;
  if (!Array.isArray(brut)) {
    erreurs.push({ message: malFormee, pourClaude: 'precautions : liste attendue' });
    return { precautions, erreurs, avertissements, horsRelecture };
  }
  brut.forEach((element, j) => {
    const la = `precautions[${j}]`;
    if (!estObjet(element)) {
      erreurs.push({ message: malFormee, pourClaude: `${la} : objet { "produit", "poser", "enlever", "pourquoi" } attendu` });
      return;
    }
    const produit = texte(element.produit).toLocaleLowerCase('fr-FR');
    if (!produit) {
      erreurs.push({ message: malFormee, pourClaude: `${la} : produit manquant` });
      return;
    }
    const ici = `${la} « ${produit} »`;
    const lus = {};
    let ok = true;
    for (const sens of ['poser', 'enlever']) {
      const codes = codesLus(element[sens]);
      if (!codes) {
        erreurs.push({ message: malFormee, pourClaude: `${ici} : ${sens} : liste attendue` });
        ok = false;
        continue;
      }
      lus[sens] = [];
      for (const { brut: valeur, code: marqueur } of codes) {
        if (!VOCABULAIRES.marqueurs.includes(marqueur)) {
          erreurs.push({
            message: `Claude a proposé un repère inconnu pour ${guillemets(produit)}.`,
            pourClaude: `${ici} : repère \`${valeur}\` inconnu ; repères de la relecture : ${liste(MARQUEURS_PRECAUTION)}`,
          });
          ok = false;
        } else if (!lus[sens].includes(marqueur)) {
          lus[sens].push(marqueur);
        }
      }
    }
    if (!ok) return;
    const pourquoi = [...texte(element.pourquoi)].slice(0, POURQUOI_MAX).join('').trim();
    let cible = precautions.find((p) => memeProduit(p.produit, produit));
    if (!cible) {
      cible = { produit, poser: [], enlever: [], pourquoi: '', position: j };
      precautions.push(cible);
    }
    for (const sens of ['poser', 'enlever']) {
      for (const marqueur of lus[sens]) if (!cible[sens].includes(marqueur)) cible[sens].push(marqueur);
    }
    if (pourquoi && !cible.pourquoi) cible.pourquoi = pourquoi;
    else if (pourquoi && !cible.pourquoi.includes(pourquoi)) cible.pourquoi = [...`${cible.pourquoi} ${pourquoi}`].slice(0, POURQUOI_MAX).join('');
  });
  // Contradictions, repères hors relecture.
  for (const precaution of precautions) {
    const ici = `precautions[${precaution.position}] « ${precaution.produit} »`;
    for (const marqueur of precaution.poser) {
      if (precaution.enlever.includes(marqueur)) {
        erreurs.push({ message: malFormee, pourClaude: `${ici} : \`${marqueur}\` à la fois dans poser et dans enlever` });
      }
    }
    for (const sens of ['poser', 'enlever']) {
      precaution[sens] = precaution[sens].filter((marqueur) => {
        if (MARQUEURS_PRECAUTION.includes(marqueur)) return true;
        const compagnon = COMPAGNONS[marqueur];
        if (!(sens === 'poser' && compagnon && precaution.poser.includes(compagnon))) {
          horsRelecture.push({ produit: precaution.produit, marqueur, sens });
        }
        return false;
      });
    }
  }
  return {
    precautions: erreurs.length ? [] : precautions.map(({ position: _p, ...reste }) => reste),
    erreurs,
    avertissements,
    horsRelecture,
  };
}

// ——— Changements proposés ———

/** Case « Repères » qui pose ce marqueur (retrait d'une case entière : `cafeine` retire aussi `cafe`). */
const caseQuiPose = (marqueur) => CASES_REPERES.find((d) => d.pose.includes(marqueur)) ?? null;

/**
 * Effet d'un retrait sur les marqueurs : ce qui est enlevé et ce qui est posé à la place. Le retrait suit la case
 * (`cafeine` retire aussi `cafe`, `gelatine_animale` aussi `gelatine_porc`) ; le retrait du seul repère précis ne fait
 * jamais perdre le repère général de précaution qu'il impliquait (`gelatine_porc` → `gelatine_animale`, `cafe` →
 * `cafeine`).
 */
function effetRetrait(marqueur) {
  const definition = caseQuiPose(marqueur);
  if (definition) return { enleve: [...definition.retire], pose: [] };
  const generaux = (IMPLICATIONS[marqueur] ?? []).filter((m) => MARQUEURS_PRECAUTION.includes(m));
  return { enleve: [marqueur], pose: generaux };
}

/**
 * Clé d'une case de l'aperçu : `<platId>|<slug produit>|<marqueur>|ajout` ou `…|retrait`. L'identifiant du plat en
 * fait partie : le même produit dans deux recettes (un œuf cru dans deux desserts) a deux cases indépendantes.
 */
export function cleChangement(platId, produit, marqueur, sens) {
  return `${String(platId ?? '')}|${slug(produit)}|${marqueur}|${sens}`;
}

/**
 * Repères hors relecture (une nature : `poisson` impliqué par `poisson_predateur`) qu'un retrait ferait perdre à
 * l'ingrédient, parce qu'il ne les porte que par ce repère. → [marqueur] ; [] : le retrait ne change que des repères de
 * précaution. Un tel retrait n'est jamais fait par une relecture : il changerait ce qu'un adulte peut manger.
 */
function naturesPerdues(ingredient, marqueur) {
  const { enleve, pose } = effetRetrait(marqueur);
  const restants = [...marqueursDe(ingredient?.marqueurs).filter((m) => !enleve.includes(m)), ...pose];
  const apres = marqueursEffectifs({ marqueurs: restants });
  return [...marqueursEffectifs(ingredient)].filter((m) => !MARQUEURS_PRECAUTION.includes(m) && !apres.has(m));
}

/** Clé de la case « La marquer relue quand même » d'un plat. */
export function cleQuandMeme(platId) {
  return `${platId}|relue`;
}

/**
 * Changements que proposent les `precautions` (validées) sur la fiche telle qu'elle est :
 * → { ajouts: [{ cle, produit, marqueur, libelle, pourquoi }], retraits: [même forme],
 *     introuvables: [produit], ignores: [{ produit, marqueur, raison: 'nature' | 'deux_fois' }],
 *     avertissements: [texte], complete }
 * - ingrédient retrouvé par memeProduit ; introuvable : avertissement, `complete` faux ;
 * - ajout : seulement si le marqueur manque (marqueurs effectifs) sur au moins une occurrence du produit ; `cru` sur un
 *   ingrédient qui n'est ni viande, ni poisson, ni fruits de mer, ou `poisson_predateur` sur une viande : refusé
 *   (`ignores`, avertissement, `complete` faux) ;
 * - retrait : seulement si le marqueur est présent (marqueurs effectifs) ; un produit présent deux fois, ou un retrait
 *   qui ferait perdre à l'ingrédient sa nature (`poisson_predateur` sur un ingrédient qui n'est pas marqué `poisson`) :
 *   retrait ignoré (sens prudent, `complete` reste vrai), avertissement.
 * `cle` : cleChangement, avec l'identifiant du plat. `produit` des changements : le nom de l'ingrédient de la fiche.
 * `pourquoi` d'un retrait : « (sans raison donnée) » si Claude n'en a pas donné.
 */
export function changementsRelecture(plat, precautions) {
  const ingredients = ingredientsDe(plat);
  const nomPlat = texte(plat?.nom) || texte(plat?.id);
  const platId = plat?.id;
  const ajouts = [];
  const retraits = [];
  const introuvables = [];
  const ignores = [];
  const avertissements = [];
  let complete = true;
  for (const precaution of Array.isArray(precautions) ? precautions : []) {
    if (!estObjet(precaution)) continue;
    const occurrences = ingredients.filter((i) => typeof i.produit === 'string' && memeProduit(i.produit, precaution.produit));
    if (!occurrences.length) {
      introuvables.push(precaution.produit);
      avertissements.push(`${guillemets(nomPlat)}\u00A0: ${guillemets(precaution.produit)} n’est pas dans la recette\u00A0: ignoré.`);
      complete = false;
      continue;
    }
    const produit = texte(occurrences[0].produit);
    const pourquoi = texte(precaution.pourquoi);
    for (const marqueur of marqueursDe(precaution.poser)) {
      if (!MARQUEURS_PRECAUTION.includes(marqueur)) continue;
      const manque = occurrences.filter((i) => !marqueursEffectifs(i).has(marqueur));
      if (!manque.length) continue;
      const effectifs = marqueursEffectifs(manque[0]);
      if (marqueur === 'cru' && !CRUS_POSSIBLES.some((m) => effectifs.has(m))) {
        ignores.push({ produit, marqueur, raison: 'nature' });
        avertissements.push(`${guillemets(produit)} n’est marqué ni comme viande ni comme poisson\u00A0: corrigez-le dans Modifier, puis la recette reviendra à relire.`);
        complete = false;
        continue;
      }
      if (marqueur === 'poisson_predateur' && effectifs.has('viande')) {
        ignores.push({ produit, marqueur, raison: 'nature' });
        avertissements.push(`${guillemets(produit)} est marqué comme viande\u00A0: corrigez-le dans Modifier, puis la recette reviendra à relire.`);
        complete = false;
        continue;
      }
      const cle = cleChangement(platId, produit, marqueur, 'ajout');
      if (ajouts.some((a) => a.cle === cle)) continue;
      ajouts.push({ cle, produit, marqueur, libelle: libelleRepere(marqueur, manque[0]), pourquoi });
    }
    for (const marqueur of marqueursDe(precaution.enlever)) {
      if (!MARQUEURS_PRECAUTION.includes(marqueur)) continue;
      if (!occurrences.some((i) => marqueursEffectifs(i).has(marqueur))) continue;
      if (occurrences.length > 1) {
        ignores.push({ produit, marqueur, raison: 'deux_fois' });
        avertissements.push(`${guillemets(produit)} apparaît deux fois\u00A0: à enlever dans Modifier si c’est juste.`);
        continue;
      }
      const perdues = naturesPerdues(occurrences[0], marqueur);
      if (perdues.length) {
        ignores.push({ produit, marqueur, raison: 'nature' });
        avertissements.push(`${guillemets(produit)} n’est pas marqué comme ${libelleRepere(perdues[0])}\u00A0: à enlever dans Modifier si c’est juste.`);
        continue;
      }
      const cle = cleChangement(platId, produit, marqueur, 'retrait');
      if (retraits.some((r) => r.cle === cle)) continue;
      retraits.push({
        cle, produit, marqueur, libelle: libelleRepere(marqueur, occurrences[0]),
        pourquoi: pourquoi || '(sans raison donnée)',
      });
    }
  }
  return { ajouts, retraits, introuvables, ignores, avertissements, complete };
}

/**
 * Ingrédients après une relecture : `ajouts` et `retraits` ([{ produit, marqueur }]) appliqués à chaque ingrédient du
 * même produit (memeProduit) ; un retrait n'agit que si le produit n'apparaît qu'une fois et ne fait perdre aucune
 * nature à l'ingrédient (naturesPerdues). Seuls les marqueurs de précaution changent (copie de chaque ingrédient,
 * champs inconnus gardés, ordre stable, sans doublon, sans undefined) ; une quantité changée entre-temps dans
 * `ingredients` est gardée. Rien à changer : une liste égale (profondément).
 */
export function appliquerReperes(ingredients, { ajouts = [], retraits = [] } = {}) {
  const liste = Array.isArray(ingredients) ? ingredients : [];
  const concerne = (ingredient, changement) => estObjet(ingredient) && typeof ingredient.produit === 'string'
    && estObjet(changement) && memeProduit(ingredient.produit, changement.produit);
  return liste.map((ingredient) => {
    if (!estObjet(ingredient)) return ingredient;
    const avant = marqueursDe(ingredient.marqueurs);
    const effectifs = marqueursEffectifs(ingredient);
    const poses = [];
    const enleves = new Set();
    for (const ajout of Array.isArray(ajouts) ? ajouts : []) {
      if (!concerne(ingredient, ajout) || !MARQUEURS_PRECAUTION.includes(ajout.marqueur)) continue;
      if (!effectifs.has(ajout.marqueur)) poses.push(ajout.marqueur);
    }
    for (const retrait of Array.isArray(retraits) ? retraits : []) {
      if (!concerne(ingredient, retrait) || !MARQUEURS_PRECAUTION.includes(retrait.marqueur)) continue;
      if (liste.filter((autre) => concerne(autre, retrait)).length > 1) continue;
      if (!effectifs.has(retrait.marqueur)) continue;
      if (naturesPerdues(ingredient, retrait.marqueur).length) continue;
      const { enleve, pose } = effetRetrait(retrait.marqueur);
      for (const m of enleve) enleves.add(m);
      for (const m of pose) if (!avant.includes(m)) poses.push(m);
    }
    const apres = [...avant, ...poses].filter((m, i, tous) => !enleves.has(m) && tous.indexOf(m) === i);
    const copie = propre(ingredient);
    if (apres.length === avant.length && apres.every((m, i) => m === avant[i])) return copie;
    copie.marqueurs = apres;
    return copie;
  });
}

// ——— Effet sur les versions d'un adulte ———

/**
 * Profils qui ont un régime (compatibilite.js › profilsContraints) pour qui le plat, avec ces repères cochés, aurait
 * besoin d'une version (plat qui convenait, tel quel ou par une version, et qui passe « à créer » ou « à revoir »).
 * → [{ pour, nom, libelles: [texte], texte }] ; texte : « 🌿 Avec ces repères, <Prénom> aura besoin d’une version de
 * ce plat (bouillon de viande). » Le prénom vient des profils (Firestore), jamais du dépôt.
 */
export function effetsSurLesVersions(plat, { ajouts = [], retraits = [] } = {}, profils = []) {
  const effets = [];
  if (!estObjet(plat)) return effets;
  const apres = { ...plat, ingredients: appliquerReperes(plat.ingredients, { ajouts, retraits }) };
  for (const profil of profilsContraints(Array.isArray(profils) ? profils : [])) {
    const avant = evaluer(plat, profil);
    if (avant.niveau === 'inconnu' || avant.aCreer || avant.aRevoir) continue;
    const ensuite = evaluer(apres, profil);
    if (!(ensuite.aCreer || ensuite.aRevoir)) continue;
    const libelles = [...new Set((Array.isArray(ajouts) ? ajouts : []).filter((ajout) => {
      const seul = { produit: 'x', qte: 1, unite: 'g', rayon: 'divers', marqueurs: [ajout.marqueur] };
      return evaluer({ ingredients: [seul] }, profil).niveau === 'exclu';
    }).map((ajout) => libelleRepere(ajout.marqueur)))];
    const nom = texte(profil.nom) || String(profil.id ?? '');
    const cause = libelles.length ? ` (${libelles.join(', ')})` : '';
    effets.push({ pour: profil.id, nom, libelles, texte: `🌿 Avec ces repères, ${nom} aura besoin d’une version de ce plat${cause}.` });
  }
  return effets;
}

// ——— Repères gardés ———

/** Vrai si le marqueur `m` est déjà couvert par les marqueurs effectifs `effectifs` (lui, ou ce qu'il implique). */
function couvert(m, effectifs) {
  if (effectifs.has(m)) return true;
  const generaux = (IMPLICATIONS[m] ?? []).filter((g) => MARQUEURS_PRECAUTION.includes(g));
  return generaux.length > 0 && generaux.every((g) => effectifs.has(g));
}

/**
 * Recette remplacée (fiche complète de Claude, recette d'une sauvegarde) : chaque nouvel ingrédient qui a un ancien de
 * même produit (memeProduit) reçoit les repères de précaution de l'ancien qu'il n'a pas. → { ingredients (copies),
 * gardes: [{ produit, marqueurs }], perdus: [{ produit, marqueurs }] } ; `perdus` : repères de précaution d'anciens
 * ingrédients sans équivalent dans la nouvelle recette (supprimés ou renommés), à annoncer.
 */
export function garderReperes(anciens, nouveaux) {
  const avant = (Array.isArray(anciens) ? anciens : []).filter((i) => estObjet(i) && typeof i.produit === 'string');
  const gardes = [];
  const ingredients = (Array.isArray(nouveaux) ? nouveaux : []).map((ingredient) => {
    if (!estObjet(ingredient) || typeof ingredient.produit !== 'string') return ingredient;
    const pareils = avant.filter((ancien) => memeProduit(ancien.produit, ingredient.produit));
    const copie = propre(ingredient);
    if (!pareils.length) return copie;
    const effectifs = marqueursEffectifs(ingredient);
    const ajoutes = [];
    for (const ancien of pareils) {
      for (const m of marqueursDe(ancien.marqueurs)) {
        if (MARQUEURS_PRECAUTION.includes(m) && !couvert(m, effectifs) && !ajoutes.includes(m)) ajoutes.push(m);
      }
    }
    if (!ajoutes.length) return copie;
    copie.marqueurs = [...marqueursDe(ingredient.marqueurs), ...ajoutes];
    gardes.push({ produit: texte(ingredient.produit), marqueurs: ajoutes });
    return copie;
  });
  const recus = ingredients.filter((i) => estObjet(i) && typeof i.produit === 'string');
  const perdus = [];
  for (const ancien of avant) {
    if (recus.some((i) => memeProduit(i.produit, ancien.produit))) continue;
    const marqueurs = marqueursDe(ancien.marqueurs).filter((m) => MARQUEURS_PRECAUTION.includes(m));
    if (marqueurs.length) perdus.push({ produit: texte(ancien.produit), marqueurs });
  }
  return { ingredients, gardes, perdus };
}

/**
 * « Modifier » (T2d) : repères de précaution posés ailleurs depuis l'ouverture (par une relecture ou l'autre
 * téléphone) reportés dans la saisie. Pour chaque ingrédient saisi de même produit qu'un ingrédient d'`actuel`, les
 * marqueurs de précaution présents sur `actuel` et absents de `base` (saisie figée à l'ouverture) sont ajoutés. Ceux
 * que la personne a décochés (dans `base`, pas dans la saisie) restent enlevés ; un repère enlevé ailleurs mais encore
 * dans la saisie reste. → ingrédients (copies).
 */
export function reporterReperes(base, saisie, actuel) {
  const departs = (Array.isArray(base) ? base : []).filter((i) => estObjet(i) && typeof i.produit === 'string');
  const lus = (Array.isArray(actuel) ? actuel : []).filter((i) => estObjet(i) && typeof i.produit === 'string');
  return (Array.isArray(saisie) ? saisie : []).map((ingredient) => {
    if (!estObjet(ingredient) || typeof ingredient.produit !== 'string') return propre(ingredient);
    const copie = propre(ingredient);
    const ailleurs = lus.filter((i) => memeProduit(i.produit, ingredient.produit));
    if (!ailleurs.length) return copie;
    const auDepart = new Set(departs.filter((i) => memeProduit(i.produit, ingredient.produit)).flatMap((i) => marqueursDe(i.marqueurs)));
    const presents = marqueursDe(ingredient.marqueurs);
    const ajoutes = [];
    for (const lu of ailleurs) {
      for (const m of marqueursDe(lu.marqueurs)) {
        if (MARQUEURS_PRECAUTION.includes(m) && !auDepart.has(m) && !presents.includes(m) && !ajoutes.includes(m)) ajoutes.push(m);
      }
    }
    if (ajoutes.length) copie.marqueurs = [...presents, ...ajoutes];
    return copie;
  });
}

// ——— Comparaison aux repères près ———

/** Ingrédient sans ses marqueurs de précaution (marqueurs triés), pour comparer deux recettes aux repères près. */
function sansPrecautions(ingredient) {
  if (!estObjet(ingredient)) return ingredient;
  const copie = propre(ingredient);
  copie.marqueurs = marqueursDe(ingredient.marqueurs).filter((m) => !MARQUEURS_PRECAUTION.includes(m)).sort();
  return copie;
}

/** Repères de précaution effectifs d'un ingrédient. */
const precautionsDe = (ingredient) => new Set([...marqueursEffectifs(ingredient)].filter((m) => MARQUEURS_PRECAUTION.includes(m)));

function egales(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => egales(v, b[i]));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((cle) => egales(a[cle], b[cle]));
}

/**
 * Deux listes d'ingrédients comparées sans leurs marqueurs de précaution : `differents` si elles diffèrent hors
 * repères ; sinon `egaux` (mêmes repères de précaution effectifs), `plusIci` (`actuels` en a au moins autant pour
 * chaque ingrédient, et au moins un de plus) ou `moinsIci`.
 */
export function comparerAuxReperesPres(actuels, recus) {
  const a = Array.isArray(actuels) ? actuels : [];
  const b = Array.isArray(recus) ? recus : [];
  if (!egales(a.map(sansPrecautions), b.map(sansPrecautions))) return 'differents';
  let plus = false;
  let moins = false;
  a.forEach((ingredient, i) => {
    const ici = precautionsDe(ingredient);
    const la = precautionsDe(b[i]);
    if ([...la].some((m) => !ici.has(m))) moins = true;
    if ([...ici].some((m) => !la.has(m))) plus = true;
  });
  if (moins) return 'moinsIci';
  return plus ? 'plusIci' : 'egaux';
}

/**
 * Repères de précaution qu'a `recus` et pas `actuels`, ingrédient par ingrédient (même produit) :
 * [{ produit, marqueurs }]. Sert à « Le fichier a des repères que l’app n’a plus : … ».
 */
export function reperesEnPlus(actuels, recus) {
  const ici = (Array.isArray(actuels) ? actuels : []).filter((i) => estObjet(i) && typeof i.produit === 'string');
  const resultat = [];
  for (const recu of (Array.isArray(recus) ? recus : []).filter((i) => estObjet(i) && typeof i.produit === 'string')) {
    const pareils = ici.filter((i) => memeProduit(i.produit, recu.produit));
    const presents = new Set(pareils.flatMap((i) => [...precautionsDe(i)]));
    const marqueurs = marqueursDe(recu.marqueurs).filter((m) => MARQUEURS_PRECAUTION.includes(m) && !couvert(m, presents));
    if (marqueurs.length) resultat.push({ produit: texte(recu.produit), marqueurs });
  }
  return resultat;
}

/**
 * Texte d'une liste de repères par produit, groupée par libellé : « au lait cru (reblochon, camembert), alcool non
 * cuit (marsala) ». `liste` : [{ produit, marqueurs }].
 */
export function texteReperes(listeReperes) {
  const groupes = new Map();
  for (const { produit, marqueurs } of Array.isArray(listeReperes) ? listeReperes : []) {
    for (const marqueur of marqueursDe(marqueurs)) {
      const libelle = libelleRepere(marqueur);
      if (!groupes.has(libelle)) groupes.set(libelle, []);
      const produits = groupes.get(libelle);
      if (!produits.includes(produit)) produits.push(produit);
    }
  }
  return [...groupes].map(([libelle, produits]) => `${libelle} (${produits.join(', ')})`).join(', ');
}

// ——— Choix de l'aperçu et annonce ———

/**
 * Écritures d'une relecture selon les cases de l'aperçu. `preparation` : résultat de paquet.js › preparerImport pour
 * un lot de relecture ; `choix` : { [cle]: boolean } (cleChangement ; un ajout est coché par défaut, un retrait
 * décoché ; cleQuandMeme(id) : « La marquer relue quand même »). → [{ id, mode: 'precautions', ajouts: [{ produit,
 * marqueur }], retraits, marquerRelue, empreinte }], seulement pour les plats qui ont quelque chose à écrire (un repère
 * ou la marque). Aucune écriture si la préparation est refusée (`refus`).
 */
export function ecrituresRelecture(preparation, choix = {}) {
  if (preparation?.refus) return [];
  const coches = estObjet(choix) ? choix : {};
  const ecritures = [];
  for (const element of Array.isArray(preparation?.elements) ? preparation.elements : []) {
    if (!estObjet(element) || element.statut !== 'relecture') continue;
    const ajouts = (element.ajouts ?? []).filter((a) => coches[a.cle] !== false).map(({ produit, marqueur }) => ({ produit, marqueur }));
    const retraits = (element.retraits ?? []).filter((r) => coches[r.cle] === true).map(({ produit, marqueur }) => ({ produit, marqueur }));
    const marquerRelue = Boolean(element.marquerRelue) || coches[cleQuandMeme(element.id)] === true;
    if (!ajouts.length && !retraits.length && !marquerRelue) continue;
    ecritures.push({ id: element.id, mode: 'precautions', ajouts, retraits, marquerRelue, empreinte: element.empreinte });
  }
  return ecritures;
}

const pluriel = (n, un, plusieurs) => (n === 1 ? un : plusieurs);

/**
 * Phrases d'en-tête de l'aperçu d'une relecture, selon le nombre d'ajouts et de retraits proposés : « Claude propose
 * d’ajouter 6 repères. Décochez ceux qui vous semblent faux. », puis « Claude propose aussi d’en enlever 2 : cochez
 * seulement si vous en êtes sûr. » ; sans ajout, « Claude propose d’enlever 2 repères : … ». → [texte]
 */
export function phrasesApercuRelecture(ajouts = 0, retraits = 0) {
  const phrases = [];
  if (ajouts > 0) {
    phrases.push(ajouts > 1
      ? `Claude propose d’ajouter ${ajouts}\u00A0repères. Décochez ceux qui vous semblent faux.`
      : 'Claude propose d’ajouter 1\u00A0repère. Décochez-le s’il vous semble faux.');
  }
  if (retraits > 0 && ajouts > 0) {
    phrases.push(`Claude propose aussi d’en enlever ${retraits}\u00A0: cochez seulement si vous en êtes sûr.`);
  } else if (retraits > 0) {
    phrases.push(retraits > 1
      ? `Claude propose d’enlever ${retraits}\u00A0repères\u00A0: cochez seulement si vous en êtes sûr.`
      : 'Claude propose d’enlever 1\u00A0repère\u00A0: cochez-le seulement si vous en êtes sûr.');
  }
  return phrases;
}

/**
 * Bilan d'une relecture enregistrée. `ecritures` : celles envoyées (ecrituresRelecture) ; `ecrites` : identifiants des
 * plats que les transactions ont écrits (donnees.js › relireReperes). → { relues: [id] (marquées relues), aRelire:
 * [id] (repères écrits, mais pas marquées relues : produit introuvable, nature à corriger, fiche changée depuis la
 * demande), ajoutes, enleves (cases cochées des plats écrits) }.
 */
export function bilanRelecture(ecritures, ecrites) {
  const faites = new Set(Array.isArray(ecrites) ? ecrites : []);
  const ecrits = (Array.isArray(ecritures) ? ecritures : [])
    .filter((ecriture) => estObjet(ecriture) && ecriture.mode === 'precautions' && faites.has(ecriture.id));
  const total = (cle) => ecrits.reduce((n, ecriture) => n + (Array.isArray(ecriture[cle]) ? ecriture[cle].length : 0), 0);
  return {
    relues: ecrits.filter((ecriture) => ecriture.marquerRelue === true).map((ecriture) => ecriture.id),
    aRelire: ecrits.filter((ecriture) => ecriture.marquerRelue !== true).map((ecriture) => ecriture.id),
    ajoutes: total('ajouts'),
    enleves: total('retraits'),
  };
}

/**
 * Annonce qui suit l'enregistrement d'une relecture : « 10 recettes relues, 6 repères ajoutés, 1 enlevé. 32 restent à
 * relire. » (sans retrait : « …, 6 repères ajoutés. » ; sans ajout : « …, rien à ajouter. », ou « …, 1 repère
 * enlevé. » s'il y a un retrait ; plus rien à relire : « Toutes vos recettes sont relues. »), puis une phrase par
 * incident. `relues` : nombre de recettes marquées relues, seulement ; `aRelire` : [nom] des recettes dont les repères
 * cochés sont écrits mais qui restent à relire (« 1 reste à relire : « Salade César ». », puis « En tout, 32 restent à
 * relire. ») ; `ajoutes`, `enleves` : repères des plats écrits ; `incidents` : [{ nom, cause: 'change' | 'supprime' |
 * 'corbeille' }] (rien n'est écrit pour eux).
 */
export function annonceRelecture({
  relues = 0, ajoutes = 0, enleves = 0, restants = 0, aRelire = [], incidents = [],
} = {}) {
  const phrases = [];
  const reperes = [];
  if (ajoutes > 0) {
    reperes.push(`${ajoutes} ${pluriel(ajoutes, 'repère ajouté', 'repères ajoutés')}`);
    if (enleves > 0) reperes.push(`${enleves} ${pluriel(enleves, 'enlevé', 'enlevés')}`);
  } else if (enleves > 0) {
    reperes.push(`${enleves} ${pluriel(enleves, 'repère enlevé', 'repères enlevés')}`);
  }
  if (relues > 0) {
    const debut = `${relues} ${pluriel(relues, 'recette relue', 'recettes relues')}`;
    phrases.push(`${[debut, ...(reperes.length ? reperes : ['rien à ajouter'])].join(', ')}.`);
  } else if (reperes.length) {
    phrases.push(`${reperes.join(', ')}.`);
  }
  const noms = (Array.isArray(aRelire) ? aRelire : []).map((nom) => guillemets(nom));
  if (noms.length) {
    phrases.push(`${noms.length} ${pluriel(noms.length, 'reste à relire', 'restent à relire')}\u00A0: ${noms.join(', ')}.`);
    if (restants > noms.length) phrases.push(`En tout, ${restants} ${pluriel(restants, 'reste à relire', 'restent à relire')}.`);
  } else if (restants > 0) {
    phrases.push(`${restants} ${pluriel(restants, 'reste à relire', 'restent à relire')}.`);
  } else {
    phrases.push('Toutes vos recettes sont relues.');
  }
  for (const { nom, cause } of Array.isArray(incidents) ? incidents : []) {
    if (cause === 'change') phrases.push(`${guillemets(nom)} a changé entre-temps\u00A0: il reste à relire.`);
    else if (cause === 'supprime') phrases.push(`${guillemets(nom)} a été supprimé entre-temps.`);
    else if (cause === 'corbeille') phrases.push(`${guillemets(nom)} a été mis à la corbeille entre-temps.`);
  }
  return phrases.join(' ');
}
