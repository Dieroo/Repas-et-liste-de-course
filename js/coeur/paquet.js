// Ajout de recettes au format « paquet@1 » (CLAUDE.md §8) : retrouver la recette dans la réponse de Claude,
// la valider, préparer les écritures. Logique pure : ni DOM ni Firebase.
// Chaque erreur porte deux textes : `message` (affiché, en français courant) et `pourClaude` (codes exacts,
// recopiés dans le texte de correction à recoller dans le Projet Claude).
import { sansAccents, slug } from './slug.js';
import { NOM_MAX, statutDe } from './plats.js';
import {
  EMOJIS_STYLE, LIBELLES_STYLE, STYLES, VOCABULAIRES, code, estObjet, estRelue, libelleRepere, liste, nombre, texte,
  validerIngredient,
} from './vocabulaire.js';
import { evaluer, marqueursEffectifs, styleDe } from './compatibilite.js';
import { SOURCE_IDEE, VERSION_INSTRUCTIONS } from './claude.js';
import { stylesAttendus } from './regles.js';
import { estDansCorbeille } from './corbeille.js';
import {
  empreinteEtapes, realisationAJour, titresDe, travailRecette, validerRealisation,
} from './realisation.js';
import {
  changementsRelecture, comparerAuxReperesPres, ecrituresRelecture, effetsSurLesVersions, empreinteRelecture,
  garderReperes, texteReperes, validerPrecautions,
} from './relecture.js';

// Déplacés dans vocabulaire.js (module feuille, T2a) ; toujours importables d'ici.
export { VOCABULAIRES, SOUS_TYPES_VIANDE, VIANDES, IMPLICATIONS, code, validerIngredient } from './vocabulaire.js';

export const FORMAT = 'paquet@1';
export const TEXTE_MAX = 500_000;
export const PLATS_MAX = 400;

const ID = /^[a-z0-9-]+$/;

const APPAREILS_A_TEMPERATURE = ['four', 'airfryer'];

export const CHAMPS_PLAT = ['id', 'nom', 'type', 'recurrence', 'statutRecette', 'portionsBase', 'ingredients', 'etapes',
  'realisation', 'cuisson', 'tempsActifMin', 'conservation', 'emporter', 'variantes', 'source'];
// Champs de la fiche connus mais jamais repris par l'ajout de recettes (notes, dernier passage, marque « modifiée à
// la main », marque de la corbeille) : ils voyagent dans une sauvegarde, que seule la restauration reprend.
// `reperesRelus` (T2d) : marque posée par l'app seule, jamais reprise d'une réponse de Claude.
const CHAMPS_IGNORES = ['notes', 'derniereFois', 'modifieeLe', 'modifieePar', 'corbeille', 'reperesRelus'];
// Champs d'une entrée de relecture (réponse à DEMANDE-PRECAUTIONS, T2d).
const CHAMPS_RELECTURE = ['id', 'nom', 'empreinte', 'precautions'];
// Champs d'une entrée d'un lot d'étapes (réponse à DEMANDE-ETAPES, T5-0b) ; `etapes` (titres) y est ignoré en silence.
const CHAMPS_ETAPES = ['id', 'nom', 'empreinte', 'realisation', 'reperesARevoir', 'etapes'];
/** Version des instructions à partir de laquelle une fiche complète porte sa `realisation` (docs/projet-claude.md). */
export const VERSION_REALISATION = 7;
/**
 * Champs qu'écrit un lot d'étapes (ecrituresEtapes, une transaction par plat) : liste fermée. `reperesRelus` n'est
 * qu'effacé, et seulement quand Claude signale un repère à revoir (`reperesARevoir`).
 */
export const CHAMPS_ECRITS_PAR_ETAPES = Object.freeze(['realisation', 'etapes', 'majPar', 'majLe', 'reperesRelus']);
const CHAMPS_CUISSON = ['appareil', 'tempC', 'mode', 'dureeMin'];
const CHAMPS_CONSERVATION = ['frigoJours', 'congelable'];
const CHAMPS_VARIANTE = ['pour', 'style', 'retirer', 'ajouter', 'consigne', 'frigoJours'];
// Style d'une version (`mer`, `vegetal`) : tolérances en plus de celles de code() (casse, accents, séparateurs).
const SYNONYMES_STYLE = { vegetale: 'vegetal', vegetarien: 'vegetal', vegetarienne: 'vegetal' };
// Jours au frigo d'une version (part au poisson d'une version `mer`, surtout).
const FRIGO_JOURS_VERSION_MAX = 30;
// Ajouts qui font une version `mer` (au moins un) ; jamais dans une version `vegetal`.
const MARQUEURS_MER = ['poisson', 'fruits_de_mer'];
// Pluriel des libellés de style, pour « Deux versions végétales… ».
const PLURIELS_STYLE = { mer: 'mer', vegetal: 'végétales' };
const ANNONCE_RECETTE = /"(format|plats)"\s*:/;
// Clés connues à la racine d'une réponse ; `instructions` (version des instructions du projet Claude) est lue par
// controlerInstructions. Les autres sont ignorées, avec un avertissement.
const CLES_PAQUET = ['format', 'instructions', 'plats'];
// Phrases de refus du projet Claude (docs/projet-claude.md, section 0), reconnues en tête de ligne seulement (la
// prose d'une réponse peut citer ces mots), sans casse ni accents.
const REFUS = [
  ['instructions', /^instructions a mettre a jour(?![a-z0-9])/],
  ['app', /^app a mettre a jour(?![a-z0-9])/],
];
// Habillage possible en tête de la ligne de refus : espaces, citation, gras ou italique, titre, guillemets, ⚠️.
const HABILLAGE_REFUS = /^[\s>*_#«"“`\u26A0\uFE0F]+/;

// ——— Retrouver la recette dans le texte collé ———

/** Fin de l'objet qui commence à `debut` (accolade fermante correspondante), chaînes comprises ; -1 si coupé. */
function finDObjet(texte, debut) {
  let profondeur = 0;
  let dansChaine = false;
  for (let i = debut; i < texte.length; i += 1) {
    const c = texte[i];
    if (dansChaine) {
      if (c === '\\') i += 1;
      else if (c === '"') dansChaine = false;
    } else if (c === '"') {
      dansChaine = true;
    } else if (c === '{') {
      profondeur += 1;
    } else if (c === '}') {
      profondeur -= 1;
      if (profondeur === 0) return i;
    }
  }
  return -1;
}

/** Objet lu, ou null. Tolère les espaces insécables et, faute de guillemets droits, les guillemets courbes. */
function lireObjet(morceau) {
  const essais = [morceau, morceau.replace(/[\u00A0\u202F\u2007]/g, ' ')];
  if (!morceau.includes('"')) essais.push(essais[1].replace(/[“”„]/g, '"'));
  for (const essai of essais) {
    try {
      const objet = JSON.parse(essai);
      return objet && typeof objet === 'object' && !Array.isArray(objet) ? objet : null;
    } catch {
      // Essai suivant.
    }
  }
  return null;
}

/**
 * Code du refus de Claude (la première ligne qui commence par l'une des phrases) : 'instructions', 'app' ou null.
 * Les lignes sont séparées avant sansAccents, qui fond les retours à la ligne en espaces.
 */
function refusDeClaude(brut) {
  for (const ligne of brut.split(/\r\n?|\n|\u2028|\u2029/)) {
    const lu = sansAccents(ligne.replace(HABILLAGE_REFUS, ''));
    const refus = REFUS.find(([, phrase]) => phrase.test(lu));
    if (refus) return refus[0];
  }
  return null;
}

/**
 * Retrouve les recettes dans un texte : réponse complète de Claude (prose et blocs de code), bloc seul ou fichier.
 * `max` : longueur acceptée (collage : TEXTE_MAX ; fichier : coeur/sauvegarde.js › FICHIER_MAX).
 * → { paquets: [objet, …] } ou { erreur } avec erreur ∈ vide, trop_long, demande, coupee, aucune, instructions
 *   (Claude signale que ses instructions sont plus anciennes que la demande), app (la demande vient d'une app plus
 *   ancienne que ses instructions), reconnues en tête de ligne. Une recette lue ou coupée l'emporte sur une phrase
 *   de refus.
 */
export function extrairePaquet(texte, { max = TEXTE_MAX } = {}) {
  const brut = String(texte ?? '');
  if (!brut.trim()) return { erreur: 'vide' };
  if (brut.length > max) return { erreur: 'trop_long' };
  // Sa propre demande, ou les corrections, recollées à la place de la réponse de Claude.
  if (/^\s*(DEMANDE-|CORRECTION\s+paquet@)/i.test(brut)) return { erreur: 'demande' };
  const paquets = [];
  let finDernier = -1; // fin du dernier objet lu
  let coupe = -1; // dernier objet commencé, jamais refermé, qui annonce une recette
  let budget = 20 * max; // caractères parcourus au plus (évite un coût quadratique)
  let i = brut.indexOf('{');
  while (i !== -1 && budget > 0) {
    const fin = finDObjet(brut, i);
    budget -= (fin === -1 ? brut.length : fin) - i;
    if (fin === -1) {
      // Accolade jamais refermée : réponse coupée si une recette suit, sinon simple accolade dans la prose.
      if (ANNONCE_RECETTE.test(brut.slice(i))) coupe = i;
      i = brut.indexOf('{', i + 1);
      continue;
    }
    const objet = lireObjet(brut.slice(i, fin + 1));
    if (objet && ('format' in objet || 'plats' in objet)) {
      paquets.push(objet);
      finDernier = fin;
      i = brut.indexOf('{', fin + 1);
    } else {
      i = brut.indexOf('{', i + 1);
    }
  }
  // Une recette commencée après la dernière lue mais jamais terminée : rien n'est retenu (tout ou rien).
  if (coupe > finDernier) return { erreur: 'coupee' };
  if (paquets.length) return { paquets };
  if (ANNONCE_RECETTE.test(brut)) return { erreur: 'coupee' };
  // Aucune recette, même commencée : Claude a peut-être refusé la demande, faute d'instructions de la même version.
  return { erreur: refusDeClaude(brut) ?? 'aucune' };
}

// ——— Valeurs tolérées ———

function booleen(valeur) {
  if (typeof valeur === 'boolean') return valeur;
  const c = code(valeur);
  if (c === 'true' || c === 'oui') return true;
  if (c === 'false' || c === 'non') return false;
  return null;
}

/** Style d'une version : « Mer », « végétale », « Végétarienne »… → 'mer' ou 'vegetal' ; null pour une autre valeur. */
function styleLu(valeur) {
  const c = code(valeur);
  const style = SYNONYMES_STYLE[c] ?? c;
  return STYLES.includes(style) ? style : null;
}

/** Valeur reçue, recopiée dans un message (texte sur une ligne ; « ? » pour un objet ou une liste). */
function lisible(valeur) {
  if (typeof valeur === 'string') return texte(valeur);
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  return '?';
}

/** Vrai si l'ingrédient est un poisson ou un fruit de mer (marqueurs effectifs). */
function estDeLaMer(ingredient) {
  const effectifs = marqueursEffectifs(ingredient);
  return MARQUEURS_MER.some((marqueur) => effectifs.has(marqueur));
}

// ——— Validation ———

/**
 * Une entrée d'un lot de relecture (réponse à DEMANDE-PRECAUTIONS, T2d) : `id` obligatoire, `nom` facultatif (jamais
 * repris), `empreinte` et `precautions` (liste, même vide) obligatoires ; une recette entière ou des versions sont une
 * erreur (rien n'est jamais créé ni remplacé par un lot de relecture). Un statut, un type ou une autre clé de fiche
 * recopiés par habitude sont ignorés sans bloquer. → même forme que validerPlat, avec `precautionsSeules` ; `donnees` :
 * { id, nom?, empreinte, precautions, horsRelecture? }.
 */
function validerEntreeRelecture(brut, index) {
  const erreurs = [];
  const avertissements = [];
  const nom = texte(brut?.nom);
  const id = slug(typeof brut?.id === 'string' && brut.id.trim() ? brut.id : '');
  const affiche = nom ? `«\u00A0${nom}\u00A0»` : (id ? `«\u00A0${id}\u00A0»` : `Recette ${index + 1}`);
  const claude = `plats[${index}]${id ? ` (${id})` : ''}`;
  const malFormee = `La relecture de ${affiche} est mal formée.`;
  const signaler = (message, pourClaude) => erreurs.push({ message, pourClaude: `${claude} ${pourClaude}` });
  const resultat = (donnees) => ({
    index, id, nom, donnees: erreurs.length ? null : donnees, erreurs, avertissements, precautionsSeules: true,
  });
  if (!estObjet(brut)) {
    signaler(malFormee, ': objet attendu');
    return resultat(null);
  }
  if (brut.ingredients != null || brut.variantes != null) {
    signaler(`Claude a rendu la recette entière de ${affiche} au lieu de sa seule relecture.`,
      ': rends seulement { "id", "nom", "empreinte", "precautions" }, sans la recette ni les versions');
    return resultat(null);
  }
  if (!id || !ID.test(id)) signaler(`${affiche}\u00A0: identifiant invalide (minuscules, chiffres et tirets seulement).`, 'id : minuscules, chiffres et tirets seulement');
  const donnees = { id };
  if (nom) donnees.nom = nom;
  const empreinte = typeof brut.empreinte === 'string' || typeof brut.empreinte === 'number' ? texte(String(brut.empreinte)) : '';
  if (!empreinte) signaler(malFormee, ': empreinte manquante, recopie celle de la demande');
  else donnees.empreinte = empreinte;
  if (brut.precautions == null) {
    signaler(malFormee, ': precautions : liste attendue, même vide');
  } else {
    const lu = validerPrecautions(brut.precautions, { position: { affiche: nom || id } });
    for (const e of lu.erreurs) signaler(e.message, e.pourClaude);
    for (const a of lu.avertissements) avertissements.push({ message: a.message, pourClaude: `${claude} ${a.pourClaude}` });
    donnees.precautions = lu.precautions;
    if (lu.horsRelecture.length) donnees.horsRelecture = lu.horsRelecture;
  }
  const connues = [...CHAMPS_RELECTURE, ...CHAMPS_PLAT, ...CHAMPS_IGNORES];
  if (Object.keys(brut).some((cle) => !connues.includes(cle))) {
    avertissements.push({ message: `${affiche}\u00A0: des informations non reconnues ont été ignorées.`, pourClaude: `${claude} : champs inconnus ignorés` });
  }
  return resultat(donnees);
}

/**
 * Une entrée d'un lot d'étapes (réponse à DEMANDE-ETAPES, T5-0b) : `id` obligatoire, `nom` facultatif (jamais repris),
 * `empreinte` et `realisation` obligatoires, `reperesARevoir` facultatif ; une recette entière (`ingredients`,
 * `variantes` ou `portionsBase`) est refusée : rien n'est jamais créé ni remplacé par un lot d'étapes. La réalisation
 * n'est vérifiée ici que dans sa structure (preparerImport la juge contre la fiche). Tout autre champ est ignoré
 * (`autresChamps`, « Seules les étapes de « X » sont reprises. »).
 * → même forme que validerPlat, avec `etapesSeules` ; chaque erreur porte aussi `code` (sans préfixe) et `refus` (la
 *   phrase de l'aperçu) ; `donnees` : { id, nom?, empreinte, realisation, reperesARevoir?, autresChamps? }.
 */
function validerEntreeEtapes(brut, index) {
  const erreurs = [];
  const avertissements = [];
  const nom = texte(brut?.nom);
  const id = slug(typeof brut?.id === 'string' && brut.id.trim() ? brut.id : '');
  const affiche = nom ? `«\u00A0${nom}\u00A0»` : (id ? `«\u00A0${id}\u00A0»` : `Recette ${index + 1}`);
  const claude = `plats[${index}]${id ? ` (${id})` : ''}`;
  const signaler = (message, codeClaude, refus = null) => erreurs.push({
    message, code: codeClaude, pourClaude: `${claude} ${codeClaude}`,
    refus: refus ?? `${affiche} n’est pas repris\u00A0: ${message.replace(/^.*?\u00A0:\s*/, '').replace(/\.$/, '')}. Il restera à détailler.`,
  });
  const resultat = (donnees) => ({
    index, id, nom, donnees: erreurs.length ? null : donnees, erreurs, avertissements, etapesSeules: true,
  });
  if (!estObjet(brut)) {
    signaler(`${affiche}\u00A0: la réponse est illisible.`, ': objet attendu');
    return resultat(null);
  }
  if (brut.ingredients != null || brut.variantes != null || brut.portionsBase != null) {
    const phrase = `Claude a rendu la recette entière de ${affiche}\u00A0: seules ses étapes étaient demandées.`;
    signaler(phrase, 'rends seulement { "id", "nom", "empreinte", "realisation" }, sans la recette', phrase);
    return resultat(null);
  }
  if (!id || !ID.test(id)) signaler(`${affiche}\u00A0: identifiant invalide (minuscules, chiffres et tirets seulement).`, 'id : minuscules, chiffres et tirets seulement');
  const donnees = { id };
  if (nom) donnees.nom = nom;
  const empreinte = typeof brut.empreinte === 'string' || typeof brut.empreinte === 'number' ? texte(String(brut.empreinte)) : '';
  if (!empreinte) signaler(`${affiche}\u00A0: l’empreinte de la demande manque.`, 'empreinte manquante, recopie celle de la demande');
  else donnees.empreinte = empreinte;
  // Réalisation rangée ailleurs (sous `etapes`, sous une clé accentuée) ou oubliée : jamais devinée, redemandée.
  const lu = Object.hasOwn(brut, 'realisation') ? validerRealisation(brut.realisation, { prefixe: claude, nom: nom || id })
    : { realisation: null, avertissements: [], erreurs: [{
      message: `${affiche}\u00A0: les étapes détaillées manquent.`, raison: 'les étapes détaillées manquent',
      code: 'realisation attendue (la liste des étapes va sous la clé "realisation", jamais "etapes")',
      pourClaude: `${claude} realisation attendue (la liste des étapes va sous la clé "realisation", jamais "etapes")`,
    }] };
  for (const e of lu.erreurs) {
    erreurs.push({ ...e, refus: `${affiche} n’est pas repris\u00A0: ${e.raison}. Il restera à détailler.` });
  }
  for (const a of lu.avertissements) avertissements.push({ message: a.message, pourClaude: a.pourClaude });
  if (lu.realisation) donnees.realisation = lu.realisation;
  if (booleen(brut.reperesARevoir) === true) donnees.reperesARevoir = true;
  if (Object.keys(brut).some((cle) => !CHAMPS_ETAPES.includes(cle))) donnees.autresChamps = true;
  return resultat(donnees);
}

/**
 * Une recette du collage. → { index, id, nom, donnees (null si erreur), erreurs, avertissements }
 * Versions d'un même profil : une par style (`mer`, `vegetal`), et une version sans style est la seule de son profil.
 * `versionsEnDouble` : à l'ajout de recettes ('erreur'), deux versions en conflit sont une erreur, comme une version
 * dont le style ne va pas avec ses ajouts (mer sans poisson ni fruits de mer ni jours au frigo, végétale avec) ;
 * ailleurs (fiches en base, sauvegardes, empreintes : 'premiere'), seule la première version en conflit est gardée et
 * une version incohérente reste, avec un avertissement.
 */
function validerPlat(brut, index, idsProfils, {
  versionsEnDouble = 'premiere',
  realisationAbimee = versionsEnDouble === 'erreur' ? 'erreur' : 'ignorer',
  ecartCuisson = versionsEnDouble === 'erreur' ? 'erreur' : 'avertissement',
  realisationAttendue = false,
} = {}) {
  const erreurs = [];
  const avertissements = [];
  const nom = texte(brut?.nom);
  const id = slug(typeof brut?.id === 'string' && brut.id.trim() ? brut.id : nom);
  const affiche = nom ? `«\u00A0${nom}\u00A0»` : `Recette ${index + 1}`;
  const claude = `plats[${index}]${id ? ` (${id})` : ''}`;
  const signaler = (message, pourClaude) => erreurs.push({ message, pourClaude: `${claude} ${pourClaude}` });
  const prevenir = (message, pourClaude) => avertissements.push({ message, pourClaude: `${claude} ${pourClaude}` });
  let champsInconnus = false;
  const inconnu = () => { champsInconnus = true; };
  // Entrée sans ingrédients porteuse de versions (réponse à DEMANDE-VARIANTES) : seule sa version sera reprise, et
  // une correction pour Claude doit redemander les seules versions (claude.js › texteCorrectionPourClaude).
  const versionsSeules = estObjet(brut) && !(Array.isArray(brut.ingredients) && brut.ingredients.length)
    && Array.isArray(brut.variantes) && brut.variantes.length > 0;
  const resultat = (donnees) => ({
    index, id, nom, donnees: erreurs.length ? null : donnees, erreurs, avertissements, ...(versionsSeules ? { versionsSeules } : {}),
  });

  if (!estObjet(brut)) {
    signaler(`${affiche}\u00A0: recette illisible.`, ': objet attendu');
    return resultat(null);
  }

  const donnees = {};
  if (!nom) signaler(`${affiche}\u00A0: nom manquant.`, 'nom : texte obligatoire');
  else if (nom.length > NOM_MAX) signaler(`${affiche}\u00A0: nom trop long (${NOM_MAX} caractères au plus).`, `nom : ${NOM_MAX} caractères au plus`);
  if (!id || !ID.test(id)) signaler(`${affiche}\u00A0: identifiant invalide (minuscules, chiffres et tirets seulement).`, 'id : minuscules, chiffres et tirets seulement');
  if (!erreurs.length) Object.assign(donnees, { id, nom });

  for (const champ of ['type', 'recurrence']) {
    if (brut[champ] == null) continue;
    const valeur = code(brut[champ]);
    if (VOCABULAIRES[champ].includes(valeur)) donnees[champ] = valeur;
    else signaler(`${affiche}\u00A0: ${champ === 'type' ? 'type de plat inconnu' : 'récurrence inconnue'}.`, `${champ} : ${liste(VOCABULAIRES[champ])}`);
  }

  let statut;
  if (brut.statutRecette != null) {
    statut = code(brut.statutRecette);
    if (!VOCABULAIRES.statutRecette.includes(statut)) {
      signaler(`${affiche}\u00A0: statut de la recette inconnu.`, `statutRecette : ${liste(VOCABULAIRES.statutRecette)}`);
      statut = undefined;
    }
  }

  // Ingrédients : obligatoires, sauf pour un plat sans recette (⏳).
  const aRecette = Array.isArray(brut.ingredients) && brut.ingredients.length > 0;
  if (brut.ingredients != null && !Array.isArray(brut.ingredients)) {
    signaler(`${affiche}\u00A0: liste des ingrédients illisible.`, 'ingredients : liste attendue');
  } else if (aRecette) {
    const ingredients = brut.ingredients.map((ingredient, j) => validerIngredient(ingredient, {
      position: { affiche: `${affiche}, ingrédient ${j + 1}`, claude: `ingredients[${j}]` },
      champQte: 'qte',
      signaler: (message, pourClaude) => erreurs.push({ message, pourClaude: `${claude} ${pourClaude}` }),
      inconnu,
      prevenir,
    }));
    if (ingredients.every(Boolean)) donnees.ingredients = ingredients;
    if (statut === 'attente') {
      statut = 'brouillon';
      prevenir(`${affiche}\u00A0: la recette a des ingrédients, elle passe en 📝 «\u00A0Recette à vérifier\u00A0».`, 'statutRecette attente avec des ingrédients : brouillon retenu');
    } else if (statut === undefined) {
      statut = 'brouillon';
    }
  } else if ((statut === 'brouillon' || statut === 'validee') && !(versionsSeules && versionsEnDouble === 'erreur')) {
    // À l'ajout de recettes, un statut recopié par habitude sur une réponse « versions seules » ne bloque pas le lot :
    // preparerImport n'en garde que les versions (« Seule la version de «X» est reprise. »).
    signaler(`${affiche}\u00A0: ingrédients manquants.`, 'ingredients : liste non vide obligatoire (sauf statutRecette `attente`)');
  }
  if (statut) donnees.statutRecette = statut;

  if (brut.portionsBase != null || aRecette) {
    const portions = nombre(brut.portionsBase);
    if (!(Number.isInteger(portions) && portions > 0)) signaler(`${affiche}\u00A0: nombre de portions manquant ou invalide.`, 'portionsBase : entier supérieur à 0');
    else donnees.portionsBase = portions;
  }

  if (brut.etapes != null) {
    if (!Array.isArray(brut.etapes)) {
      signaler(`${affiche}\u00A0: étapes illisibles.`, 'etapes : liste de phrases attendue');
    } else {
      // Une étape doit être une phrase : un objet serait perdu sans le dire.
      const lisibles = brut.etapes.map((etape, j) => {
        if (etape == null) return '';
        if (typeof etape === 'string' || typeof etape === 'number') return texte(String(etape));
        signaler(`${affiche}\u00A0: étape ${j + 1} illisible.`, `etapes[${j}] : phrase attendue`);
        return null;
      });
      const etapes = lisibles.filter(Boolean);
      if (!lisibles.includes(null) && etapes.length) donnees.etapes = etapes;
    }
  }

  if (brut.cuisson != null) {
    if (!Array.isArray(brut.cuisson)) {
      signaler(`${affiche}\u00A0: cuisson illisible.`, 'cuisson : liste attendue');
    } else {
      const cuissons = brut.cuisson.map((c, j) => {
        const ici = `${affiche}, cuisson ${j + 1}`;
        const la = `cuisson[${j}]`;
        if (!estObjet(c)) {
          signaler(`${ici}\u00A0: illisible.`, `${la} : objet attendu`);
          return null;
        }
        const cuisson = {};
        let ok = true;
        if (Object.keys(c).some((cle) => !CHAMPS_CUISSON.includes(cle))) inconnu();
        const appareil = code(c.appareil);
        if (!VOCABULAIRES.appareil.includes(appareil)) {
          ok = false;
          signaler(`${ici}\u00A0: appareil inconnu.`, `${la}.appareil : ${liste(VOCABULAIRES.appareil)}`);
        } else {
          cuisson.appareil = appareil;
        }
        if (c.tempC != null) {
          const temperature = nombre(c.tempC);
          if (!(temperature > 0)) {
            ok = false;
            signaler(`${ici}\u00A0: température invalide.`, `${la}.tempC : nombre supérieur à 0`);
          } else {
            cuisson.tempC = temperature;
          }
        } else if (APPAREILS_A_TEMPERATURE.includes(appareil)) {
          prevenir(`${ici}\u00A0: température non précisée.`, `${la}.tempC conseillé pour ${appareil}`);
        }
        const mode = texte(c.mode);
        if (mode) cuisson.mode = mode;
        const duree = nombre(c.dureeMin);
        if (!(duree > 0)) {
          ok = false;
          signaler(`${ici}\u00A0: durée manquante ou invalide.`, `${la}.dureeMin : nombre supérieur à 0`);
        } else {
          cuisson.dureeMin = duree;
        }
        return ok ? cuisson : null;
      });
      if (cuissons.every(Boolean) && (cuissons.length || aRecette)) donnees.cuisson = cuissons;
    }
  }

  // Étapes détaillées (T5-0b) : validées contre les ingrédients et la cuisson de la fiche reçue ; dans une réponse de
  // Claude, `etapes` devient leurs titres (la liste `etapes` reçue avec elles est ignorée en silence). Abîmées dans une
  // fiche en base ou une sauvegarde (`realisationAbimee: 'ignorer'`) : retirées avec un avertissement, la recette
  // reste valide.
  if (brut.realisation != null) {
    const lu = validerRealisation(brut.realisation, {
      produits: Array.isArray(donnees.ingredients) ? donnees.ingredients : null,
      cuisson: Array.isArray(donnees.cuisson) ? donnees.cuisson : null,
      prefixe: claude,
      nom: nom || id,
      ecart: ecartCuisson,
    });
    if (lu.realisation) {
      donnees.realisation = lu.realisation;
      // Réponse de Claude : `etapes` = les titres. Fiche en base ou sauvegarde : les `etapes` lues restent (une app
      // d'avant a pu les changer : la réalisation n'est alors plus à jour, et la différence doit se voir).
      if (realisationAbimee === 'erreur' || !donnees.etapes) donnees.etapes = titresDe(lu.realisation);
      for (const a of lu.avertissements) avertissements.push({ message: a.message, pourClaude: a.pourClaude });
    } else if (realisationAbimee === 'ignorer') {
      prevenir(`${affiche}\u00A0: ses étapes détaillées sont abîmées, elles ne sont pas reprises.`, 'realisation abîmée, ignorée');
    } else {
      for (const e of lu.erreurs) erreurs.push({ message: e.message, pourClaude: e.pourClaude });
      for (const a of lu.avertissements) avertissements.push({ message: a.message, pourClaude: a.pourClaude });
    }
  } else if (realisationAttendue && aRecette) {
    // Réponse en version 7 ou plus : une recette porte ses étapes détaillées (jamais un plat ⏳).
    signaler(`${affiche}\u00A0: les étapes détaillées manquent.`, 'realisation attendue');
  }

  if (brut.tempsActifMin != null) {
    const temps = nombre(brut.tempsActifMin);
    if (!(temps >= 0)) signaler(`${affiche}\u00A0: temps de travail invalide.`, 'tempsActifMin : nombre de minutes');
    else donnees.tempsActifMin = temps;
  }

  if (brut.conservation != null) {
    if (!estObjet(brut.conservation)) {
      signaler(`${affiche}\u00A0: conservation illisible.`, 'conservation : { frigoJours, congelable } attendu');
    } else {
      const conservation = {};
      if (Object.keys(brut.conservation).some((cle) => !CHAMPS_CONSERVATION.includes(cle))) inconnu();
      if (brut.conservation.frigoJours != null) {
        const jours = nombre(brut.conservation.frigoJours);
        if (!(Number.isInteger(jours) && jours >= 0)) signaler(`${affiche}\u00A0: durée au frigo invalide.`, 'conservation.frigoJours : nombre entier de jours');
        else conservation.frigoJours = jours;
      }
      if (brut.conservation.congelable != null) {
        const congelable = booleen(brut.conservation.congelable);
        if (congelable === null) signaler(`${affiche}\u00A0: congélation à préciser (oui ou non).`, 'conservation.congelable : true ou false');
        else conservation.congelable = congelable;
      }
      // Jamais de table vide : écrite en fusion, elle effacerait la conservation existante.
      if (Object.keys(conservation).length) donnees.conservation = conservation;
    }
  }

  if (brut.emporter != null) {
    const emporter = booleen(brut.emporter);
    if (emporter === null) signaler(`${affiche}\u00A0: «\u00A0à emporter\u00A0» à préciser (oui ou non).`, 'emporter : true ou false');
    else donnees.emporter = emporter;
  }

  if (brut.variantes != null) {
    if (!Array.isArray(brut.variantes)) {
      signaler(`${affiche}\u00A0: variantes illisibles.`, 'variantes : liste attendue');
    } else {
      // Cohérence d'une version et de son style (jours au frigo d'une version mer, poisson ajouté ou non) : erreurs à
      // l'ajout de recettes ; ailleurs (fiches en base, sauvegardes), avertissements, la version reste. La fusion par
      // style écrit le style déduit d'une ancienne version sans lui inventer de jours au frigo.
      const incoherence = versionsEnDouble === 'erreur' ? signaler : prevenir;
      const variantes = brut.variantes.map((v, j) => {
        const ici = `${affiche}, variante ${j + 1}`;
        const la = `variantes[${j}]`;
        if (!estObjet(v)) {
          signaler(`${ici}\u00A0: illisible.`, `${la} : objet attendu`);
          return null;
        }
        const variante = {};
        let ok = true;
        if (Object.keys(v).some((cle) => !CHAMPS_VARIANTE.includes(cle))) inconnu();
        const pour = slug(typeof v.pour === 'string' ? v.pour : '');
        if (!pour) {
          ok = false;
          signaler(`${ici}\u00A0: profil manquant.`, `${la}.pour : identifiant du profil`);
        } else {
          variante.pour = pour;
          if (idsProfils && !idsProfils.has(pour)) {
            prevenir(`${ici}\u00A0: aucun profil «\u00A0${pour}\u00A0» dans l’app. Elle sera gardée, sans effet pour l’instant.`, `${la}.pour « ${pour} » : profil inconnu`);
          }
        }
        // Style : absent (ou vide) → une version sans style, comme avant.
        if (!(v.style == null || (typeof v.style === 'string' && !v.style.trim()))) {
          const style = styleLu(v.style);
          if (!style) {
            ok = false;
            signaler(`${ici}\u00A0: version «\u00A0${lisible(v.style)}\u00A0» inconnue (mer ou végétale).`,
              `${la}.style « ${lisible(v.style)} » : ${STYLES.map((s) => `\`${s}\``).join(' ou ')}`);
          } else {
            variante.style = style;
          }
        }
        // « À retirer » : des noms de produits seulement (un objet deviendrait « [object Object] »).
        const retirer = v.retirer ?? [];
        if (!Array.isArray(retirer) || retirer.some((p) => typeof p !== 'string' && typeof p !== 'number')) {
          ok = false;
          signaler(`${ici}\u00A0: liste «\u00A0à retirer\u00A0» illisible.`, `${la}.retirer : liste de noms de produits`);
        } else {
          variante.retirer = retirer.map((p) => texte(String(p)).toLocaleLowerCase('fr-FR')).filter(Boolean);
        }
        if (v.ajouter != null && !Array.isArray(v.ajouter)) {
          ok = false;
          signaler(`${ici}\u00A0: liste «\u00A0à ajouter\u00A0» illisible.`, `${la}.ajouter : liste d’ingrédients`);
        } else {
          const ajouts = (v.ajouter ?? []).map((ingredient, k) => validerIngredient(ingredient, {
            position: { affiche: `${ici}, ajout ${k + 1}`, claude: `${la}.ajouter[${k}]` },
            champQte: 'qtePortion',
            signaler: (message, pourClaude) => erreurs.push({ message, pourClaude: `${claude} ${pourClaude}` }),
            inconnu,
            prevenir,
          }));
          if (ajouts.every(Boolean)) variante.ajouter = ajouts;
          else ok = false;
        }
        const consigne = texte(v.consigne);
        if (consigne) variante.consigne = consigne;
        // Jours au frigo : absents (ou vides) → rien ; facultatifs, sauf pour une version mer (ci-dessous).
        const joursDonnes = !(v.frigoJours == null || (typeof v.frigoJours === 'string' && !v.frigoJours.trim()));
        if (joursDonnes) {
          const jours = nombre(v.frigoJours);
          if (!(Number.isInteger(jours) && jours >= 1 && jours <= FRIGO_JOURS_VERSION_MAX)) {
            ok = false;
            signaler(`${ici}\u00A0: nombre de jours au frigo invalide (de 1 à ${FRIGO_JOURS_VERSION_MAX}).`,
              `${la}.frigoJours : nombre entier de jours (1 à ${FRIGO_JOURS_VERSION_MAX})`);
          } else {
            variante.frigoJours = jours;
          }
        }
        // Style et ajouts : une version mer ajoute du poisson ou des fruits de mer, une version végétale jamais.
        if (variante.style === 'mer') {
          if (!joursDonnes) {
            incoherence(`Version mer de ${affiche}\u00A0: combien de jours au frigo\u202F?`,
              `${la} (mer) : \`frigoJours\` manquant (nombre entier de jours)`);
          }
          if (variante.ajouter && !variante.ajouter.some(estDeLaMer)) {
            incoherence(`Version mer de ${affiche}\u00A0: aucun poisson ni fruit de mer ajouté.`,
              `${la} (mer) : aucun ingrédient \`poisson\` ou \`fruits_de_mer\` dans \`ajouter\``);
          }
        } else if (variante.style === 'vegetal') {
          (variante.ajouter ?? []).forEach((ajout, k) => {
            if (!estDeLaMer(ajout)) return;
            incoherence(`Version végétale de ${affiche}\u00A0: «\u00A0${ajout.produit}\u00A0» est un poisson ou un fruit de mer.`,
              `${la} (vegetal) ajouter[${k}] « ${ajout.produit} » : ni \`poisson\` ni \`fruits_de_mer\` dans une version \`vegetal\``);
          });
        }
        if (ok) {
          if (!variante.retirer.length && !variante.ajouter.length) {
            prevenir(`${ici}\u00A0: elle ne change rien à la recette.`, `${la} : ni retirer ni ajouter`);
          } else if (aRecette && Array.isArray(donnees.ingredients)) {
            // « À retirer » doit citer les ingrédients de la fiche, mot pour mot (au slug près).
            const presents = new Set(donnees.ingredients.map((ingredient) => slug(ingredient.produit)));
            for (const produit of variante.retirer) {
              if (!presents.has(slug(produit))) {
                prevenir(`${ici}\u00A0: «\u00A0${produit}\u00A0» n’est pas dans la recette.`, `${la}.retirer « ${produit} » : absent des ingredients`);
              }
            }
          }
        }
        return ok ? variante : null;
      });
      // Versions d'un même profil : une par style ; une version sans style est la seule de son profil.
      const uniques = [];
      variantes.forEach((variante, j) => {
        if (!variante) return;
        const memeProfil = uniques.filter((gardee) => gardee.pour === variante.pour);
        let message;
        let pourClaude;
        if (!memeProfil.length) {
          uniques.push(variante);
          return;
        }
        if (!variante.style && memeProfil.every((gardee) => !gardee.style)) {
          // Deux versions sans style : textes d'avant les styles.
          message = `Deux versions pour le même profil dans ${affiche}.`;
          pourClaude = `variantes[${j}].pour « ${variante.pour} » : deux variantes pour le même profil`;
        } else if (!variante.style || memeProfil.some((gardee) => !gardee.style)) {
          message = `Deux versions pour le même profil dans ${affiche}, dont une qui ne dit pas si elle est mer ou végétale.`;
          pourClaude = `variantes[${j}] : une variante sans \`style\` doit être la seule du profil \`${variante.pour}\``;
        } else if (memeProfil.some((gardee) => gardee.style === variante.style)) {
          message = `Deux versions ${PLURIELS_STYLE[variante.style]} pour le même profil dans ${affiche}.`;
          pourClaude = `variantes[${j}] : deux versions \`${variante.style}\` pour le profil \`${variante.pour}\``;
        } else {
          uniques.push(variante);
          return;
        }
        if (versionsEnDouble === 'erreur') signaler(message, pourClaude);
        else prevenir(`${message.slice(0, -1)}\u00A0: seule la première est gardée.`, `${pourClaude}, la première est gardée`);
      });
      if (variantes.every(Boolean) && (uniques.length || aRecette)) donnees.variantes = uniques;
    }
  }

  const source = texte(brut.source);
  if (source) donnees.source = source;

  if (Object.keys(brut).some((cle) => !CHAMPS_PLAT.includes(cle) && !CHAMPS_IGNORES.includes(cle))) inconnu();
  if (champsInconnus) prevenir(`${affiche}\u00A0: des informations non reconnues ont été ignorées.`, ': champs inconnus ignorés');
  return resultat(donnees);
}

/** Vrai si l'un des objets retrouvés est une sauvegarde de l'app (il porte `sauvegardeLe`) : elle se restaure, elle ne s'ajoute pas. */
export function estSauvegarde(paquets) {
  return (Array.isArray(paquets) ? paquets : [paquets]).some((paquet) => estObjet(paquet) && Object.hasOwn(paquet, 'sauvegardeLe'));
}

/**
 * Valide les recettes retrouvées (CLAUDE.md §8). `profils` : profils de l'app (variante pour un profil inconnu → avertissement).
 * `platsMax` : nombre de recettes accepté ; `doublonsDeNom` : false pour une sauvegarde, restaurée par identifiant ;
 * `versionsEnDouble` : 'erreur' (ajout de recettes) ou 'premiere' (sauvegarde, fiches en base : seule la première de
 * deux versions en conflit est gardée ; une version dont le style ne va pas avec ses ajouts ou ses jours au frigo
 * reste, avec un avertissement).
 * → { plats: [{ index, id, nom, donnees, erreurs, avertissements }], erreurs, avertissements, valide, relecture?,
 *     lotDEtapes? }
 *   `donnees` ne contient que des champs présents et valides (aucune valeur undefined, aucune table vide).
 *   Nature du collage, dans cet ordre (T5-0b) : une entrée porte `precautions` → `relecture` (T2d, réponse à
 *   DEMANDE-PRECAUTIONS ; chaque entrée est une relecture, `precautionsSeules`) ; sinon une entrée porte `realisation`
 *   avec `empreinte`, ou sans `ingredients` ni `portionsBase` dans un collage dont aucune entrée ne les porte →
 *   `lotDEtapes` (aussi une entrée avec `empreinte` dont les étapes sont sous `etapes` en objets ou sous une clé
 *   accentuée, et, avec `serieEtapes`, toute entrée avec `empreinte`) (réponse à DEMANDE-ETAPES ; jamais avec
 *   `lotsDEtapes: false` : sauvegarde, dernier filet de
 *   « Modifier » ; chaque entrée est jugée seule, `etapesSeules` : une entrée fautive, ou rendue deux fois, n'empêche pas les autres ; `valide` dès qu'une entrée
 *   l'est) ; sinon une entrée porte `empreinte` → `relecture` ; sinon des fiches complètes. Une fiche complète d'une
 *   réponse en version VERSION_REALISATION ou plus (`instructions` de son bloc) sans `realisation` est une erreur
 *   (`realisation attendue`), jamais pour un plat ⏳, une sauvegarde ou une fiche en base (sans `instructions`), ni
 *   pour un plat de `relectureEnCours` (dernier lot de relecture copié : preparerImport dit « au lieu de sa seule
 *   relecture »).
 */
export function validerPaquet(paquets, {
  profils = null, platsMax = PLATS_MAX, doublonsDeNom = true, versionsEnDouble = 'erreur', relectureEnCours = [],
  lotsDEtapes = true, serieEtapes = false,
} = {}) {
  const erreurs = [];
  const avertissements = [];
  const bruts = [];
  const versionsDesBruts = []; // version des instructions du bloc de chaque entrée (null : absente)
  let clesIgnorees = false;
  for (const paquet of Array.isArray(paquets) ? paquets : [paquets]) {
    if (!estObjet(paquet) || code(paquet.format) !== code(FORMAT)) {
      erreurs.push({ message: 'Ce texte ne vient pas de votre projet Claude, ou d’une version que l’app ne connaît pas.', pourClaude: `format : \`${FORMAT}\` attendu` });
      continue;
    }
    if (Object.keys(paquet).some((cle) => !CLES_PAQUET.includes(cle))) clesIgnorees = true;
    if (paquet.plats == null) continue;
    if (!Array.isArray(paquet.plats)) {
      erreurs.push({ message: 'La liste des recettes est illisible.', pourClaude: 'plats : liste attendue' });
      continue;
    }
    bruts.push(...paquet.plats);
    const version = typeof paquet.instructions === 'number' && Number.isInteger(paquet.instructions) ? paquet.instructions
      : (typeof paquet.instructions === 'string' && /^\s*\d+\s*$/.test(paquet.instructions) ? Number(paquet.instructions) : null);
    versionsDesBruts.push(...paquet.plats.map(() => version));
  }
  if (clesIgnorees) {
    avertissements.push({ message: 'Seules les recettes sont ajoutées ici\u00A0: le reste a été ignoré.', pourClaude: 'clés autres que plats ignorées' });
  }
  if (bruts.some((brut) => estObjet(brut) && brut.notes != null)) {
    avertissements.push({ message: 'Les notes ne sont pas reprises ici.', pourClaude: 'notes ignorées' });
  }
  if (bruts.some((brut) => estObjet(brut) && brut.reperesRelus != null)) {
    avertissements.push({ message: 'La marque «\u00A0relue par Claude\u00A0» n’est pas reprise ici.', pourClaude: 'reperesRelus ignoré' });
  }
  if (!bruts.length && !erreurs.length) {
    erreurs.push({ message: 'Aucune recette dans ce texte.', pourClaude: 'plats : au moins une recette attendue' });
  }
  if (bruts.length > platsMax) {
    erreurs.push({ message: `Trop de recettes d’un coup (${platsMax} au plus).`, pourClaude: `plats : ${platsMax} au plus` });
    return { plats: [], erreurs, avertissements, valide: false };
  }

  const idsProfils = Array.isArray(profils) && profils.length ? new Set(profils.map((p) => p.id)) : null;
  // Nature du collage : relecture (T2d), lot d'étapes (T5-0b) ou fiches complètes (ordre testé).
  const porte = (cle) => bruts.some((brut) => estObjet(brut) && Object.hasOwn(brut, cle));
  // Sans `empreinte`, une entrée { id, nom, realisation } ne fait un lot d'étapes que si aucune entrée du collage n'a la
  // forme d'une fiche (`ingredients` ou `portionsBase`) : une idée sans ingrédients reste une fiche complète. Jamais pour
  // une sauvegarde ni pour « Modifier » (`lotsDEtapes: false`).
  // Une entrée avec `empreinte` dont les étapes sont rangées ailleurs (liste d'objets sous `etapes`, clé
  // « réalisation » accentuée) est aussi une entrée d'étapes ; en série d'étapes (`serieEtapes`, écran ouvert depuis une
  // carte d'étapes), toute entrée avec `empreinte` sans `precautions` l'est : jamais une relecture des repères.
  const formeDeFiche = (brut) => estObjet(brut) && (Object.hasOwn(brut, 'ingredients') || Object.hasOwn(brut, 'portionsBase'));
  const porteEtapes = (brut) => Object.hasOwn(brut, 'realisation')
    || Object.keys(brut).some((cle) => code(cle) === 'realisation')
    || (Array.isArray(brut.etapes) && brut.etapes.some(estObjet));
  const lotDEtapes = lotsDEtapes && !porte('precautions') && bruts.some((brut) => estObjet(brut)
    && (Object.hasOwn(brut, 'empreinte')
      ? serieEtapes || porteEtapes(brut)
      : Object.hasOwn(brut, 'realisation') && !formeDeFiche(brut) && !bruts.some(formeDeFiche)));
  const relecture = !lotDEtapes && (porte('precautions') || porte('empreinte'));
  // Plat du dernier lot de relecture copié (T2d) : une recette entière rendue à sa place est l'erreur « au lieu de sa
  // seule relecture » de preparerImport, jamais « étapes détaillées manquent » (la correction redemande la relecture).
  const enRelecture = new Set((Array.isArray(relectureEnCours) ? relectureEnCours : []).map(String));
  const plats = bruts.map((brut, index) => {
    if (relecture) return validerEntreeRelecture(brut, index);
    if (lotDEtapes) return validerEntreeEtapes(brut, index);
    return validerPlat(brut, index, idsProfils, {
      versionsEnDouble,
      realisationAttendue: (versionsDesBruts[index] ?? 0) >= VERSION_REALISATION
        && !enRelecture.has(slug(typeof brut?.id === 'string' ? brut.id : '')),
    });
  });

  if (lotDEtapes) {
    // Chaque entrée vaut pour elle-même : un identifiant rendu deux fois refuse la seconde seulement.
    const vusEtapes = new Set();
    for (const plat of plats) {
      if (!plat.id) continue;
      if (vusEtapes.has(plat.id)) {
        const affiche = `«\u00A0${plat.nom || plat.id}\u00A0»`;
        const phrase = `Claude a rendu deux fois ${affiche}\u00A0: seule la première est reprise.`;
        plat.erreurs.push({ message: phrase, code: 'rendu deux fois dans le message', pourClaude: `plats[${plat.index}] (${plat.id}) rendu deux fois dans le message`, refus: phrase });
        plat.donnees = null;
      } else {
        vusEtapes.add(plat.id);
      }
    }
    const valide = !erreurs.length && plats.some((plat) => !plat.erreurs.length);
    return { plats, erreurs, avertissements, valide, lotDEtapes: true };
  }

  // Doublons dans le collage : même identifiant ou même nom (sauf demande contraire).
  const vus = new Map();
  for (const plat of plats) {
    const cles = [[`id:${plat.id}`, 'identifiant']];
    if (doublonsDeNom && !relecture) cles.push([`nom:${slug(plat.nom)}`, 'nom']);
    for (const [cle, quoi] of cles) {
      if (cle.endsWith(':')) continue;
      if (vus.has(cle)) {
        erreurs.push({
          message: `Deux recettes portent le même ${quoi}\u00A0: «\u00A0${plat.nom || plat.id}\u00A0».`,
          pourClaude: `plats[${vus.get(cle)}] et plats[${plat.index}] : même ${quoi === 'nom' ? 'nom' : 'id'}`,
        });
      } else {
        vus.set(cle, plat.index);
      }
    }
  }

  const valide = !erreurs.length && plats.every((plat) => !plat.erreurs.length);
  return { plats, erreurs, avertissements, valide, ...(relecture ? { relecture: true } : {}) };
}

// ——— Version des instructions ———

// Du moins au plus sérieux : une app pas à jour (réponse plus récente qu'elle) est le problème le plus sérieux.
const GRAVITE_INSTRUCTIONS = ['absente', 'ancienne', 'recente'];
const MESSAGES_INSTRUCTIONS = {
  absente: 'Cette réponse ne dit pas avec quelles instructions elle a été écrite\u00A0: votre projet Claude a peut-être d’anciennes instructions. Recopiez-les depuis Réglages › Projet Claude.',
  ancienne: 'Cette réponse vient d’anciennes instructions du projet Claude. Recopiez-les depuis Réglages › Projet Claude, puis redemandez si quelque chose cloche.',
  recente: 'Cette réponse vient d’instructions plus récentes que votre app. Fermez puis rouvrez l’app avant d’ajouter ces recettes.',
};

/** Version lue à la racine d'une réponse : entier, ou texte de chiffres (« 1 ») ; null pour toute autre valeur. */
function versionLue(valeur) {
  if (typeof valeur === 'number') return Number.isInteger(valeur) && valeur >= 0 ? valeur : null;
  if (typeof valeur === 'string' && /^\s*\d+\s*$/.test(valeur)) return Number(valeur);
  return null;
}

/**
 * Version des instructions de la réponse comparée à celle de l'app. `paquets` : objets retrouvés (extrairePaquet).
 * → null si toutes les recettes portent la version attendue ;
 *   sinon { sens: 'absente' | 'ancienne' | 'recente', message, pourClaude }.
 * Avertissement non bloquant, montré à l'aperçu de l'ajout de recettes ; jamais appelé pour une sauvegarde.
 */
export function controlerInstructions(paquets, attendue = VERSION_INSTRUCTIONS) {
  let pire = -1;
  for (const paquet of Array.isArray(paquets) ? paquets : [paquets]) {
    const lue = versionLue(estObjet(paquet) ? paquet.instructions : undefined);
    let sens = null;
    if (lue === null) sens = 'absente';
    else if (lue < attendue) sens = 'ancienne';
    else if (lue > attendue) sens = 'recente';
    if (sens) pire = Math.max(pire, GRAVITE_INSTRUCTIONS.indexOf(sens));
  }
  if (pire === -1) return null;
  const sens = GRAVITE_INSTRUCTIONS[pire];
  return { sens, message: MESSAGES_INSTRUCTIONS[sens], pourClaude: `instructions : ${attendue} attendu` };
}

// ——— Préparer les écritures ———

/**
 * Recette d'une fiche (champs du §8), validée comme à l'ajout de recettes et complétée de ses défauts (type plat,
 * récurrence aucune, statut ⏳) : deux recettes égales selon edition.js › egalProfonde sont identiques. null si la
 * recette de la fiche n'est pas valide. Notes, photos et marques de mise à jour ne comptent pas.
 */
export function recetteValidee(plat) {
  if (!estObjet(plat)) return null;
  const brut = {};
  for (const champ of CHAMPS_PLAT) if (plat[champ] != null) brut[champ] = plat[champ];
  const resultat = validerPlat(brut, 0, null);
  if (resultat.erreurs.length) return null;
  return { type: 'plat', recurrence: 'aucune', statutRecette: 'attente', ...resultat.donnees };
}

/** Deux valeurs égales, à toute profondeur (ordre des clés indifférent). Même règle que edition.js › egalProfonde. */
function egales(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => egales(v, b[i]));
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((cle) => egales(a[cle], b[cle]));
}


/** Copie d'une valeur sans aucune valeur undefined, à toute profondeur (clés absentes plutôt qu'undefined). */
function propre(valeur) {
  if (Array.isArray(valeur)) return valeur.filter((v) => v !== undefined).map(propre);
  if (estObjet(valeur)) {
    const copie = {};
    for (const [cle, v] of Object.entries(valeur)) if (v !== undefined) copie[cle] = propre(v);
    return copie;
  }
  return valeur;
}

// ——— Versions (variantes) ———

/** Style écrit d'une version (`mer` ou `vegetal`) ; null s'il est absent ou inconnu. */
function styleEcrit(variante) {
  return estObjet(variante) && STYLES.includes(variante.style) ? variante.style : null;
}

/**
 * Vrai si la version reçue remplace la version `actuelle` : même profil et même style (écrit ; déduit par
 * compatibilite.js › styleDe pour une version d'avant les styles). Une version reçue sans style remplace toutes celles
 * de son profil. `attendus` ({ [profilId]: [style] }, facultatif) : une version reçue avec un style remplace aussi
 * celles de son profil d'un style qu'il n'attend pas (mer pour « Ni viande ni poisson », ou pour un dessert).
 */
function remplace(recue, actuelle, attendus = null) {
  if (!estObjet(actuelle) || actuelle.pour !== recue.pour) return false;
  const style = styleEcrit(recue);
  if (!style) return true;
  const sien = styleDe(actuelle);
  if (sien === style) return true;
  const siens = estObjet(attendus) && Object.hasOwn(attendus, recue.pour) ? attendus[recue.pour] : null;
  return Array.isArray(siens) && siens.length > 0 && !siens.includes(sien);
}

/**
 * Styles attendus pour ce plat par les profils de ces versions (regles.js › stylesAttendus ; un dessert ou un
 * accompagnement n'attend pas de version mer), seulement pour ceux qui en attendent certains mais pas tous (pour les
 * autres, aucune version n'est d'un style inattendu) : { [profilId]: [style] }, ou null. `profils` : profils de l'app
 * (un profil inconnu n'attend aucun style).
 */
export function stylesAttendusDesVersions(plat, variantes, profils) {
  const attendus = {};
  const vus = new Set();
  const connus = Array.isArray(profils) ? profils.filter(estObjet) : [];
  for (const variante of Array.isArray(variantes) ? variantes : []) {
    const pour = variante?.pour;
    if (typeof pour !== 'string' || !pour || vus.has(pour)) continue;
    vus.add(pour);
    const styles = stylesAttendus(connus.find((p) => p.id === pour) ?? { id: pour }, plat);
    if (styles.length && styles.length < STYLES.length) attendus[pour] = styles;
  }
  return Object.keys(attendus).length ? attendus : null;
}

/**
 * Versions d'une fiche après réception de `recues`, fusionnées par (profil, style) :
 * - une version reçue avec un style remplace celle du même profil et du même style (une version sans style compte
 *   pour son style déduit, styleDe) ; les autres versions de ce profil restent, et celles qui n'avaient pas de style
 *   reçoivent leur style déduit, écrit (une version sans style doit être la seule de son profil) ;
 * - avec `attendus` ({ [profilId]: [style] }, stylesAttendusDesVersions), elle remplace aussi les versions de son
 *   profil d'un style qu'il n'attend pas (une version mer restée d'avant « Ni viande ni poisson », jamais redemandée),
 *   sauf celles reçues avec elle (jugées et signalées à l'aperçu) ; sans `attendus` (restauration, qui n'ôte rien),
 *   seulement celle du même style ;
 * - une version reçue sans style remplace toutes les versions de son profil, comme avant les styles.
 * La version reçue prend la place de la première remplacée, sinon va à la fin ; deux versions reçues pour le même
 * profil et le même style : la première compte. Une version reçue ne retire jamais celle d'un autre profil ; les
 * versions des autres profils restent, dans leur ordre. Aucune valeur undefined (ni null) dans le résultat.
 */
export function fusionnerVariantes(actuelles, recues, { attendus = null } = {}) {
  let resultat = (Array.isArray(actuelles) ? actuelles : []).filter((v) => v != null).map(propre);
  const vues = new Set();
  const ajoutees = new Set(); // versions reçues déjà posées : jamais ôtées pour leur style inattendu
  for (const brute of Array.isArray(recues) ? recues : []) {
    if (!estObjet(brute) || typeof brute.pour !== 'string' || !brute.pour) continue;
    const recue = propre(brute);
    const style = styleEcrit(recue);
    const cle = JSON.stringify([recue.pour, style]);
    if (vues.has(cle)) continue;
    vues.add(cle);
    const ote = (v) => remplace(recue, v, ajoutees.has(v) ? null : attendus);
    const position = resultat.findIndex(ote);
    const suite = [];
    resultat.forEach((v, i) => {
      if (i === position) suite.push(recue);
      else if (ote(v)) return; // même style, style plus attendu, ou doublon d'une fiche abîmée
      else if (style && estObjet(v) && v.pour === recue.pour && !styleEcrit(v)) suite.push({ ...v, style: styleDe(v) });
      else suite.push(v);
    });
    if (position === -1) suite.push(recue);
    ajoutees.add(recue);
    resultat = suite;
  }
  return resultat;
}

/** Profil d'identifiant `pour` ; un profil inconnu compte comme un profil sans règle. */
function profilDe(profils, pour) {
  return profils.find((p) => p.id === pour) ?? { id: pour };
}

/**
 * Vrai si le plat (fiche déjà fusionnée) a sa recette et n'est plus « à créer » ni « à revoir » pour ce profil : il se
 * mange tel quel, ou au moins une de ses versions convient (compatibilite.js › evaluer).
 */
function platAdapte(fiche, profil) {
  const resultat = evaluer(fiche, profil);
  return resultat.niveau !== 'inconnu' && !resultat.aCreer && !resultat.aRevoir;
}

/** Marqueurs que le profil exclut (règles `exclureMarqueurs` actives), pour nommer la cause à Claude. */
function marqueursExclusPar(profil) {
  const exclus = new Set();
  for (const regle of Array.isArray(profil?.regles) ? profil.regles : []) {
    if (estObjet(regle) && regle.actif !== false && regle.severite === 'exclu' && regle.type === 'exclureMarqueurs') {
      for (const marqueur of Array.isArray(regle.marqueurs) ? regle.marqueurs : []) exclus.add(marqueur);
    }
  }
  return exclus;
}

/**
 * Ce que donne, sur la fiche (déjà fusionnée), la version de `profil` de style `style` (écrit, ou déduit) :
 * { convient, restants: [{ nom, marqueurs }] }. Jugée par compatibilite.js › evaluer (entrée de même style dans
 * `versions`) ; sans entrée de ce style, jugée sur le plat entier, comme avant les styles.
 */
function versionConvient(fiche, profil, style) {
  const resultat = evaluer(fiche, profil);
  // Plat sans recette (⏳) : rien ne dit encore que la version convient.
  if (resultat.niveau === 'inconnu') return { convient: false, restants: [] };
  const entree = (Array.isArray(resultat.versions) ? resultat.versions : [])
    .find((version) => estObjet(version) && version.style === style);
  let noms;
  let version;
  if (entree) {
    if (entree.convient) return { convient: true, restants: [] };
    noms = Array.isArray(entree.restants) ? entree.restants : [];
    version = entree.variante;
  } else {
    if (!resultat.aCreer && !resultat.aRevoir) return { convient: true, restants: [] };
    noms = resultat.restants.length ? resultat.restants : resultat.fautifs.map((i) => texte(i.produit));
    version = (Array.isArray(fiche.variantes) ? fiche.variantes : []).find((v) => estObjet(v) && v.pour === profil.id);
  }
  const exclus = marqueursExclusPar(profil);
  const candidats = [...(Array.isArray(fiche.ingredients) ? fiche.ingredients : []),
    ...(Array.isArray(version?.ajouter) ? version.ajouter : [])].filter(estObjet);
  const restants = noms.map((nom) => {
    const ingredient = candidats.find((i) => texte(i.produit) === nom);
    const marqueurs = ingredient ? [...marqueursEffectifs(ingredient)].filter((m) => exclus.has(m)) : [];
    return { nom, marqueurs };
  });
  return { convient: false, restants };
}

/**
 * Demandes ouvertes que la recette reçue par le plat `id` satisfait : `<id>__recette` si elle a des ingrédients ;
 * `<id>__<profil>` pour chaque profil qui reçoit une version, seulement si, sur la fiche qui en résulte (`plat` : fiche
 * fusionnée ; à défaut, `donnees`), le plat n'est plus à créer ni à revoir pour ce profil (au moins une de ses versions
 * lui convient). `ouvertes` : identifiants des demandes ouvertes (Set ou liste). `profils` (obligatoire) : profils de
 * l'app, pour juger les versions.
 */
export function demandesSatisfaites(id, donnees, ouvertes, { plat = null, profils } = {}) {
  if (!Array.isArray(profils)) throw new TypeError('demandesSatisfaites : profils obligatoire');
  const ouverte = ouvertes instanceof Set ? (cle) => ouvertes.has(cle) : (cle) => (ouvertes ?? []).includes(cle);
  const fiche = estObjet(plat) ? plat : donnees;
  const connus = profils.filter(estObjet);
  const satisfaites = [];
  if (donnees?.ingredients?.length && ouverte(`${id}__recette`)) satisfaites.push(`${id}__recette`);
  for (const variante of Array.isArray(donnees?.variantes) ? donnees.variantes : []) {
    const demande = `${id}__${variante?.pour}`;
    if (!ouverte(demande) || satisfaites.includes(demande)) continue;
    if (platAdapte(fiche, profilDe(connus, variante.pour))) satisfaites.push(demande);
  }
  return satisfaites;
}

function idLibre(base, pris) {
  let id = `${base}-2`;
  for (let n = 3; pris.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Vrai si la fiche a été modifiée à la main (« Modifier ») depuis son dernier ajout par Claude. */
function modifieeALaMain(plat) {
  return Boolean(plat?.modifieePar) || plat?.modifieeLe != null;
}

/** Vrai si la fiche a déjà sa recette : statut autre que ⏳ et au moins un ingrédient. */
function aSaRecette(plat) {
  return statutDe(plat) !== 'attente' && Array.isArray(plat?.ingredients) && plat.ingredients.length > 0;
}

/**
 * Vrai si deux recettes (recetteSansVersions) sont la même : le reste de la recette égal (egales), les ingrédients
 * égaux aux repères de précaution près, la fiche actuelle en ayant au moins autant (relecture.js ›
 * comparerAuxReperesPres : `egaux` ou `plusIci`). Une recette recollée sans les repères posés depuis par une
 * relecture n'est donc pas « différente ».
 */
function memeRecette(actuelle, recue, { ficheAJour = false } = {}) {
  if (!actuelle || !recue) return false;
  const {
    ingredients: ici, realisation: realisationIci, etapes: etapesIci, ...resteIci
  } = actuelle;
  const {
    ingredients: la, realisation: realisationLa, etapes: etapesLa, ...resteLa
  } = recue;
  if (!egales(resteIci, resteLa)) return false;
  // Étapes (T5-0b) : même réalisation ; ou, face à une réponse sans réalisation, une fiche détaillée à jour garde la
  // sienne (rien n'est réécrit) ; sinon les étapes courtes se comparent comme avant.
  if (realisationLa !== undefined) {
    if (!egales(realisationIci, realisationLa)) return false;
  } else if (!(ficheAJour && realisationIci !== undefined) && !egales(etapesIci, etapesLa)) {
    return false;
  }
  return ['egaux', 'plusIci'].includes(comparerAuxReperesPres(ici ?? [], la ?? []));
}

/** Recette d'une fiche sans ses versions, son nom ni son statut : ce qui compte pour « même recette ». */
function recetteSansVersions(plat) {
  const recette = recetteValidee(plat);
  if (!recette) return null;
  const { variantes: _v, nom: _n, statutRecette: _s, ...reste } = recette;
  return reste;
}

/**
 * Plat visé par chaque recette valide, écritures et demandes à clore (CLAUDE.md §8, T2b).
 * `valides` : `donnees` des plats validés. `plats` : tous les plats de l'app, ceux de la corbeille compris (un plat de
 * la corbeille ne se recrée pas à côté, et son identifiant n'est jamais repris). `cible` : plat depuis lequel on a
 * touché « Coller la réponse » (prime si une seule entrée est collée). `profils` : profils de l'app (libellés, versions
 * qui conviennent). `choix` : { [platId]: 'version' | 'remplacer' }, pour une fiche complète reçue, différente de la
 * recette actuelle et porteuse de versions.
 * → { elements: [{ index, id, nom, statut, ancienNom?, modifieeA?, remettable?, ingredients, etapes, avertissements,
 *       versions, choix? }],
 *   `index` : position de l'entrée dans `valides` (une entrée ignorée ou en erreur n'a pas d'élément).
 *     ecritures: [{ id, donnees, effacerModification? } | { id, mode: 'versions', variantes, attendus? }],
 *   `attendus` : styles attendus des profils de ces versions (stylesAttendusDesVersions), pour refaire la même fusion
 *   à l'écriture ;
 *     demandesAClore: [id], erreurs, avertissements, corrections: [{ id, pour, style, message, pourClaude }] }
 *   statut ∈ nouveau, complete (⏳ complété), remplace (recette remplacée), inchange (plat ⏳ sans ingrédients reçus),
 *   versions (seules les versions reçues s'écrivent, fusionnées par profil et par style : ni nom, ni statut, ni
 *   recette, marque « modifiée à la main » gardée), identique (rien n'est écrit ; les demandes satisfaites sont closes),
 *   deja (idée de Claude, `source` « Idée de Claude » (claude.js › SOURCE_IDEE), qui vise par son identifiant ou son
 *   nom un plat qui a déjà sa recette : rien n'est écrit ni clos, un avertissement le dit, le reste du lot
 *   s'enregistre ; `id` : celui du plat gardé, `nom` : celui de l'idée, `ingredients` et `etapes` : ceux de la fiche
 *   gardée ; une idée qui vise un plat ⏳ le complète normalement ; une recette collée depuis une fiche (`cible`) suit
 *   les règles habituelles),
 *   corbeille (l'entrée vise, selon les règles habituelles du plat visé, un plat de la corbeille : rien n'est écrit ni
 *   clos, sans erreur, un avertissement dit de le remettre d'abord, le reste du lot s'enregistre ; `id` : celui du
 *   plat de la corbeille ; `ingredients` et `etapes` : ceux de la recette reçue, ou de la fiche pour une entrée « versions
 *   seules » ; `remettable` : vrai si le plat, remis, prendrait ce qui est reçu ; faux, et l'avertissement le dit, pour
 *   une idée de Claude visant un plat qui a sa recette (« cette idée n'est pas reprise »), des versions pour un plat ⏳
 *   ou une entrée sans recette ni version (« cette réponse n'apporte rien à ce plat »)).
 *   Quand deux plats portent le même nom, le plat actif est visé plutôt que celui de la corbeille. Une recette collée
 *   depuis une fiche (`cible`) sous le nom d'un plat de la corbeille garde le nom de la fiche (avertissement « le nom
 *   de la fiche est gardé ») ; sous le nom d'un plat actif, c'est une erreur, comme avant.
 *   `versions` : [{ pour, style, nom, action: 'ajoutee' | 'remplacee', convient, libelle }] (versions reçues qui
 *   changent ; `style` : celui de la version reçue, ou null). Une version reçue est comparée à celle du même profil et
 *   du même style (déduit pour une version d'avant les styles), et jugée seule (evaluer › versions).
 *   `choix` : { retenu, parDefaut } ('version' ou 'remplacer' ; « Ne prendre que sa version » d'avance si la fiche
 *   est vérifiée ou modifiée à la main).
 *   Une entrée sans ingrédients porteuse de versions, pour un plat inconnu ou ⏳, n'est qu'un avertissement : le
 *   reste s'enregistre. Une version qui ne convient pas encore est importée, avec un avertissement et une
 *   correction pour Claude ; sa demande reste ouverte.
 */
export function preparerImport(valides, {
  plats = [], demandes = [], cible = null, profils = [], choix = {}, relectureEnCours = [], controle = null,
  serieEtapes = false,
} = {}) {
  if ((Array.isArray(valides) ? valides : []).some((donnees) => Array.isArray(donnees?.precautions))) {
    return preparerRelecture(valides, { plats, profils, controle });
  }
  if ((Array.isArray(valides) ? valides : []).some(estEntreeEtapes)) {
    return preparerEtapes(valides, { plats, controle });
  }
  // Entrée refusée à la validation (null) : rien à préparer.
  valides = (Array.isArray(valides) ? valides : []).filter(estObjet);
  const enRelecture = new Set(Array.isArray(relectureEnCours) ? relectureEnCours : []);
  let recetteAuLieuDeRelecture = false;
  const erreurs = [];
  const avertissements = [];
  const corrections = [];
  const connus = (Array.isArray(profils) ? profils : []).filter(estObjet);
  const prenom = (pour) => texte(connus.find((p) => p.id === pour)?.nom) || pour;
  const choixRetenus = estObjet(choix) ? choix : {};
  const parId = new Map(plats.map((p) => [p.id, p]));
  // Même nom : le dernier plat actif, sinon le dernier plat de la corbeille.
  const parNom = new Map();
  for (const plat of plats) {
    const cle = slug(plat.nom);
    const deja = parNom.get(cle);
    if (!deja || estDansCorbeille(deja) || !estDansCorbeille(plat)) parNom.set(cle, plat);
  }
  const ouvertes = new Set(demandes.filter((d) => d.statut === 'ouverte').map((d) => d.id));
  const pris = new Set(plats.map((p) => p.id));
  const vises = new Map();
  let viseCible = false;
  if (cible && parId.has(cible)) {
    if (valides.length === 1) viseCible = true;
    else avertissements.push({ message: 'Plusieurs recettes collées\u00A0: chacune est ajoutée à part.', pourClaude: '' });
  }

  const elements = [];
  const ecritures = [];
  const demandesAClore = [];
  let indexCourant = 0; // position de l'entrée dans `valides` (une entrée ignorée n'a pas d'élément)
  const clore = (ids) => {
    for (const id of ids) if (!demandesAClore.includes(id)) demandesAClore.push(id);
  };
  /**
   * Entrée qui vise le plat `jete`, dans la corbeille : un élément et son avertissement, ni écriture, ni demande close,
   * ni erreur. `apport` : ce que l'entrée apporterait au plat une fois remis (« cette recette », « cette version »…) ;
   * null s'il n'en prendrait rien (idée pour un plat qui a sa recette, versions pour un plat ⏳, entrée sans recette ni
   * version) : l'avertissement le dit, et l'élément n'est pas `remettable` (l'aperçu ne propose pas « Remettre »).
   */
  const dansLaCorbeille = ({ index, id, nom, jete, ingredients, etapes, avertissementsPlat, apport, idee = false }) => {
    let quoi = `remettez-le pour lui ajouter ${apport}.`;
    if (!apport) quoi = idee ? 'cette idée n’est pas reprise.' : 'cette réponse n’apporte rien à ce plat.';
    elements.push({
      index,
      id,
      nom,
      statut: 'corbeille',
      remettable: Boolean(apport),
      ingredients,
      etapes,
      avertissements: [...avertissementsPlat, `«\u00A0${jete.nom}\u00A0» est dans la corbeille\u00A0: ${quoi}`],
      versions: [],
    });
  };

  /**
   * Versions reçues jugées sur la fiche qui en résulte : libellés, avertissements et corrections.
   * → { versions (éléments de l'aperçu), changees (versions reçues qui changent la fiche, à écrire) }
   */
  const jugerVersions = (vise, fiche, recues, actuelles, avertissementsPlat, attendus = null) => {
    const versions = [];
    const changees = [];
    const avant = (Array.isArray(actuelles) ? actuelles : []).filter(estObjet);
    for (const variante of recues) {
      const style = styleEcrit(variante);
      // Un profil qui attend des versions par style (mer, végétale) : une version sans style remplacerait toutes les
      // siennes ; si l'une est d'un autre style que la reçue, elle serait perdue. Refusée : Claude doit dire laquelle
      // c'est (les réponses d'avant les styles, sur une fiche sans autre style, passent comme avant).
      const attendusIci = stylesAttendus(profilDe(connus, variante.pour), fiche);
      const deduit = style ? null : styleDe(variante);
      const perdue = !style && attendusIci.length > 0 && avant.some((v) => v.pour === variante.pour
        && (styleEcrit(v) ?? styleDe(v)) !== deduit);
      if (perdue) {
        erreurs.push({
          message: `La version pour ${prenom(variante.pour)} de «\u00A0${fiche.nom}\u00A0» ne dit pas si elle est ${attendusIci.map((s) => LIBELLES_STYLE[s]).join(' ou ')}.`,
          pourClaude: `id ${vise} variantes[pour=${variante.pour}] : \`style\` attendu (${attendusIci.map((s) => `\`${s}\``).join(' ou ')}) : ce profil a une version par style`,
        });
        continue;
      }
      // Version actuelle de même clé (profil, style) ; une version sans style compte pour son style déduit. Une
      // version d'un style que le profil n'attend pas est remplacée aussi (fusionnerVariantes, `attendus`).
      const memeCle = avant.filter((v) => remplace(variante, v, attendus));
      const [ancienne] = memeCle;
      if (memeCle.length === 1 && egales(propre(style && !styleEcrit(ancienne) ? { ...ancienne, style } : ancienne), variante)) continue;
      changees.push(variante);
      const nom = prenom(variante.pour);
      const { convient, restants } = versionConvient(fiche, profilDe(connus, variante.pour), style ?? styleDe(variante));
      let libelle;
      if (style) {
        libelle = `${convient ? `${EMOJIS_STYLE[style]} ` : ''}Version ${LIBELLES_STYLE[style]} pour ${nom} ${ancienne ? 'remplacée' : 'ajoutée'}`;
      } else {
        // 🌿 seulement pour une version qui convient : sinon le plat reste « à revoir ».
        libelle = ancienne ? `Version pour ${nom} remplacée` : `${convient ? '🌿 ' : ''}Version pour ${nom} ajoutée`;
      }
      versions.push({ pour: variante.pour, style, nom, action: ancienne ? 'remplacee' : 'ajoutee', convient, libelle });
      if (!convient) {
        const laVersion = style ? `La version ${LIBELLES_STYLE[style]} pour ${nom}` : `La version pour ${nom}`;
        const message = restants.length
          ? `${laVersion} contient encore\u00A0: ${restants.map((r) => r.nom).join(', ')}.`
          : `${laVersion} ne lui convient pas encore.`;
        avertissementsPlat.push(message);
        const cle = style ? `pour=${variante.pour}, style=${style}` : `pour=${variante.pour}`;
        corrections.push({
          id: vise,
          pour: variante.pour,
          style,
          message,
          pourClaude: restants.length
            ? `id ${vise} variantes[${cle}] : contient ${restants
              .map((r) => (r.marqueurs.length ? `${r.nom} (${r.marqueurs.join(', ')})` : r.nom)).join(', ')}, exclu pour ${variante.pour}`
            : `id ${vise} variantes[${cle}] : ne convient pas au profil ${variante.pour}`,
        });
      }
    }
    return { versions, changees };
  };

  /** Seules les versions reçues pour un plat rempli : statut `versions`, ou `identique` si rien ne change. */
  const prendreVersions = (existant, recues, avertissementsPlat, extra = {}, recette = null) => {
    const vise = existant.id;
    const attendus = stylesAttendusDesVersions(existant, recues, connus);
    const fusion = fusionnerVariantes(existant.variantes, recues, { attendus });
    const fiche = { ...existant, variantes: fusion };
    const { versions, changees } = jugerVersions(vise, fiche, recues, existant.variantes, avertissementsPlat, attendus);
    elements.push({
      index: indexCourant,
      id: vise,
      nom: existant.nom,
      statut: changees.length ? 'versions' : 'identique',
      ingredients: Array.isArray(existant.ingredients) ? existant.ingredients.length : 0,
      etapes: Array.isArray(existant.etapes) ? existant.etapes.length : 0,
      avertissements: avertissementsPlat,
      versions,
      ...extra,
    });
    // À l'écriture, la fusion se refait dans une transaction (donnees.js), sur les versions lues à cet instant, avec
    // les mêmes styles attendus.
    if (changees.length) {
      const styles = stylesAttendusDesVersions(existant, changees, connus);
      ecritures.push({ id: vise, mode: 'versions', variantes: changees.map(propre), ...(styles ? { attendus: styles } : {}) });
    }
    // Recette reçue identique : une demande de recette restée ouverte est satisfaite aussi.
    const recu = recette?.ingredients?.length ? { ingredients: recette.ingredients, variantes: recues } : { variantes: recues };
    clore(demandesSatisfaites(vise, recu, ouvertes, { plat: fiche, profils: connus }));
  };

  for (const [index, donnees] of valides.entries()) {
    indexCourant = index;
    const avertissementsPlat = [];
    const recue = Boolean(donnees.ingredients?.length);
    const recues = Array.isArray(donnees.variantes) ? donnees.variantes : [];
    const memeId = parId.get(donnees.id);
    const memeNom = parNom.get(slug(donnees.nom));
    const affiche = `«\u00A0${donnees.nom}\u00A0»`;

    // ——— Versions seules (entrée sans ingrédients, porteuse de versions) ———
    // Plat visé : la cible, sinon le même identifiant, sinon le même nom ; jamais de plat nouveau ni de nom approché.
    if (!recue && recues.length) {
      const existant = viseCible ? parId.get(cible) : memeId ?? memeNom ?? null;
      if (!existant) {
        avertissements.push({
          message: `Claude a répondu pour ${affiche}, qui n’est pas dans vos plats\u00A0: ignoré.`,
          pourClaude: `id ${donnees.id} : plat inconnu, ignoré`,
        });
        continue;
      }
      if (estDansCorbeille(existant)) {
        // Remis, un plat ⏳ ignorerait ses versions (voir plus bas) : rien à lui ajouter.
        dansLaCorbeille({
          index,
          id: existant.id,
          nom: existant.nom,
          jete: existant,
          ingredients: Array.isArray(existant.ingredients) ? existant.ingredients.length : 0,
          etapes: Array.isArray(existant.etapes) ? existant.etapes.length : 0,
          avertissementsPlat,
          apport: aSaRecette(existant) ? (recues.length > 1 ? 'ces versions' : 'cette version') : null,
        });
        continue;
      }
      if (statutDe(existant) === 'attente' || !(Array.isArray(existant.ingredients) && existant.ingredients.length)) {
        avertissements.push({
          message: `«\u00A0${existant.nom}\u00A0» n’a pas encore sa recette\u00A0: sa version est ignorée. Demandez la recette avec sa version.`,
          pourClaude: `id ${existant.id} : plat sans recette, version ignorée`,
        });
        continue;
      }
      if (vises.has(existant.id)) {
        erreurs.push({
          message: `«\u00A0${vises.get(existant.id)}\u00A0» et «\u00A0${donnees.nom}\u00A0» visent le même plat.`,
          pourClaude: `id ${existant.id} : deux recettes pour le même plat`,
        });
        continue;
      }
      vises.set(existant.id, donnees.nom);
      if (Object.keys(donnees).some((cle) => cle !== 'id' && cle !== 'nom' && cle !== 'variantes')) {
        avertissementsPlat.push(`Seule la version de «\u00A0${existant.nom}\u00A0» est reprise.`);
      }
      if (slug(donnees.nom) !== slug(existant.nom)) {
        avertissementsPlat.push(`Claude l’appelle ${affiche}\u00A0: le nom de la fiche est gardé.`);
      }
      // « À retirer » comparé aux ingrédients de la fiche.
      const presents = new Set(existant.ingredients.filter(estObjet).map((i) => slug(i.produit)));
      for (const variante of recues) {
        for (const produit of variante.retirer ?? []) {
          if (!presents.has(slug(produit))) {
            const style = styleEcrit(variante);
            avertissementsPlat.push(`Version ${style ? `${LIBELLES_STYLE[style]} ` : ''}pour ${prenom(variante.pour)}\u00A0: «\u00A0${produit}\u00A0» n’est pas dans la recette.`);
          }
        }
      }
      prendreVersions(existant, recues, avertissementsPlat);
      continue;
    }

    // ——— Fiche complète, ou plat sans recette (⏳) ———
    // Plat visé : la cible, sinon le même identifiant s'il s'agit bien du même plat (même nom, ⏳, demande ouverte,
    // ou fiche modifiée à la main, qui a pu être renommée), sinon le même nom (doublons repérés par le nom, §8),
    // sinon un nouveau plat (identifiant libre si un autre plat utilise déjà le sien).
    let vise;
    let nomGarde = null; // nom de la fiche visée, gardé : un plat de la corbeille porte déjà le nom reçu
    if (viseCible) {
      // Un plat de la corbeille porte déjà ce nom (Claude a raccourci celui de la fiche) : la recette va bien à la
      // fiche, qui garde son nom (jamais deux plats du même nom, ni erreur pour un plat qui n'apparaît plus).
      if (memeNom && memeNom.id !== cible && estDansCorbeille(memeNom)) {
        nomGarde = parId.get(cible).nom;
        avertissementsPlat.push(`Claude l’appelle ${affiche}\u00A0: le nom de la fiche est gardé.`);
      } else if (memeNom && memeNom.id !== cible) {
        // La recette d'un autre plat déjà présent, collée sur cette fiche, en ferait un doublon.
        erreurs.push({
          message: `Cette réponse est la recette de «\u00A0${memeNom.nom}\u00A0», déjà dans vos plats. Copiez la réponse pour «\u00A0${parId.get(cible).nom}\u00A0».`,
          pourClaude: `id ${cible} : recette de ${memeNom.id} reçue, recette de ${cible} attendue`,
        });
        continue;
      }
      vise = cible;
    } else if (memeId && (slug(memeId.nom) === slug(donnees.nom)
      || statutDe(memeId) === 'attente'
      || ouvertes.has(`${memeId.id}__recette`)
      || (modifieeALaMain(memeId) && !(memeNom && memeNom.id !== memeId.id
        && (statutDe(memeNom) === 'attente' || ouvertes.has(`${memeNom.id}__recette`)))))) {
      vise = memeId.id;
    } else if (memeNom) {
      vise = memeNom.id;
    } else if (pris.has(donnees.id)) {
      vise = idLibre(donnees.id, pris);
      if (memeId) avertissementsPlat.push(`«\u00A0${memeId.nom}\u00A0» utilise déjà cet identifiant\u00A0: la recette est ajoutée à part.`);
    } else {
      vise = donnees.id;
    }

    // Nom retenu pour la fiche : celui reçu, sauf nom de la fiche gardé (plus haut).
    const nomRetenu = nomGarde ?? donnees.nom;

    // Une idée de Claude (DEMANDE-IDEES, `source` « Idée de Claude ») : jamais une recette rendue à la place d'une
    // relecture ; pour un plat qui a déjà sa recette, elle n'est simplement pas reprise (plus bas).
    const idee = !viseCible && recue && texte(donnees.source) === SOURCE_IDEE;

    // Recette entière rendue à la place d'une relecture (T2d) : le plat est dans le dernier lot de relecture copié sur
    // ce téléphone, a sa recette et n'est pas encore relu. Erreur, corrigée par Claude (relectures seules) ; jamais
    // pour « Coller la recette » d'une fiche, ni pour une idée de Claude.
    const enCours = !viseCible && recue && !idee && enRelecture.has(vise) ? parId.get(vise) : null;
    if (enCours && !estDansCorbeille(enCours) && aSaRecette(enCours) && !estRelue(enCours)) {
      erreurs.push({
        message: `Claude a rendu la recette entière de «\u00A0${enCours.nom}\u00A0» au lieu de sa seule relecture.`,
        pourClaude: `plats[${index}] (${donnees.id}) : rends seulement { "id", "nom", "empreinte", "precautions" }, sans la recette ni les versions`,
      });
      recetteAuLieuDeRelecture = true;
      continue;
    }

    // Plat de la corbeille : rien n'est écrit, sans erreur ; on le remet d'abord (les autres entrées s'enregistrent).
    // Une idée de Claude pour un plat de la corbeille qui a déjà sa recette n'est simplement pas reprise.
    const jete = parId.get(vise);
    if (estDansCorbeille(jete)) {
      // Rien à lui ajouter, même remis : entrée sans recette (ni version : voir plus haut), ou idée pour un plat qui a
      // déjà sa recette.
      dansLaCorbeille({
        index,
        id: vise,
        nom: nomRetenu,
        jete,
        ingredients: donnees.ingredients?.length ?? 0,
        etapes: donnees.etapes?.length ?? 0,
        avertissementsPlat,
        apport: recue && !(idee && aSaRecette(jete)) ? 'cette recette' : null,
        idee,
      });
      continue;
    }

    // Idée de Claude (DEMANDE-IDEES) pour un plat qui a déjà sa recette : une idée ne remplace jamais une recette du
    // foyer. Rien n'est écrit, sans erreur : les autres idées du lot s'enregistrent.
    const dejaLa = idee ? parId.get(vise) : null;
    if (dejaLa && aSaRecette(dejaLa)) {
      elements.push({
        index,
        id: vise,
        nom: nomRetenu,
        statut: 'deja',
        ingredients: dejaLa.ingredients.length,
        etapes: Array.isArray(dejaLa.etapes) ? dejaLa.etapes.length : 0,
        avertissements: [...avertissementsPlat, `«\u00A0${dejaLa.nom}\u00A0» est déjà dans vos plats\u00A0: cette idée n’est pas reprise.`],
        versions: [],
      });
      continue;
    }

    // Écran en série d'étapes (T5-0b) : une recette entière glissée dans la série (Claude qui dérive après plusieurs
    // « suite ») ne remplace jamais une recette du foyer ; refusée entrée par entrée, sans erreur, les autres passent.
    const dejaRemplie = serieEtapes && !viseCible && recue && !idee ? parId.get(vise) : null;
    if (dejaRemplie && aSaRecette(dejaRemplie) && statutDe(dejaRemplie) !== 'attente') {
      elements.push({
        index,
        id: vise,
        nom: dejaRemplie.nom,
        statut: 'refusee',
        raison: `Claude a rendu la recette entière de «\u00A0${dejaRemplie.nom}\u00A0»\u00A0: seules ses étapes étaient demandées.`,
        ingredients: dejaRemplie.ingredients.length,
        etapes: Array.isArray(dejaRemplie.etapes) ? dejaRemplie.etapes.length : 0,
        avertissements: [...avertissementsPlat],
        versions: [],
      });
      continue;
    }

    if (vises.has(vise)) {
      erreurs.push({
        message: `«\u00A0${vises.get(vise)}\u00A0» et «\u00A0${donnees.nom}\u00A0» visent le même plat.`,
        pourClaude: `id ${vise} : deux recettes pour le même plat`,
      });
      continue;
    }
    vises.set(vise, nomRetenu);
    pris.add(vise);

    const existant = parId.get(vise);
    if (memeNom && memeNom.id !== vise && !nomGarde) {
      avertissementsPlat.push(`Un autre plat s’appelle déjà «\u00A0${memeNom.nom}\u00A0».`);
    }
    const ecriture = { ...donnees, id: vise, nom: nomRetenu };
    const rempli = existant && statutDe(existant) !== 'attente';

    // Plat rempli : la recette actuelle reste, sauf fiche complète différente (et, si elle porte des versions,
    // « Remplacer la recette » choisi).
    let choixPlat = null;
    if (rempli) {
      if (!recue) {
        // Ni ingrédients ni versions : la recette actuelle est gardée, rien n'est écrit.
        if (Object.keys(donnees).some((cle) => cle !== 'id' && cle !== 'nom')) {
          avertissementsPlat.push(`«\u00A0${existant.nom}\u00A0» a déjà sa recette\u00A0: elle est gardée.`);
        }
        prendreVersions(existant, [], avertissementsPlat);
        continue;
      }
      const actuelle = recetteSansVersions(existant);
      if (actuelle && memeRecette(actuelle, recetteSansVersions(ecriture), { ficheAJour: realisationAJour(existant) })) {
        // Même recette (hors versions, nom et statut) : seules les versions reçues comptent ; le nom reste.
        if (slug(nomRetenu) !== slug(existant.nom)) {
          avertissementsPlat.push(`Claude l’appelle ${affiche}\u00A0: le nom de la fiche est gardé.`);
        }
        prendreVersions(existant, recues, avertissementsPlat, {}, ecriture);
        continue;
      }
      if (recues.length) {
        const parDefaut = statutDe(existant) === 'validee' || modifieeALaMain(existant) ? 'version' : 'remplacer';
        const retenu = choixRetenus[vise] === 'version' || choixRetenus[vise] === 'remplacer' ? choixRetenus[vise] : parDefaut;
        choixPlat = { retenu, parDefaut };
        if (retenu === 'version') {
          prendreVersions(existant, recues, avertissementsPlat, { choix: choixPlat });
          continue;
        }
      }
    } else if (existant) {
      // Plat ⏳ : recollé tel quel, rien n'est écrit (la demande de recette reste ouverte faute d'ingrédients).
      const actuelle = recetteValidee(existant);
      if (actuelle && egales(actuelle, recetteValidee(ecriture))) {
        elements.push({
          index, id: vise, nom: nomRetenu, statut: 'identique', ingredients: 0, etapes: 0, avertissements: avertissementsPlat, versions: [],
        });
        clore(demandesSatisfaites(vise, ecriture, ouvertes, { plat: { ...existant, ...ecriture }, profils: connus }));
        continue;
      }
    }

    // Recette remplacée (T2d) : les repères de précaution de la recette actuelle sont gardés, ingrédient par
    // ingrédient (plus prudent tout de suite, moins prudent seulement par un toucher dans « Modifier »).
    let reperes = null;
    if (rempli && recue && Array.isArray(existant.ingredients)) {
      reperes = garderReperes(existant.ingredients, ecriture.ingredients);
      ecriture.ingredients = reperes.ingredients;
    }

    // Versions reçues avec une fiche complète : fusionnées avec celles de la fiche (celles des autres profils restent,
    // celles d'un style que leur profil n'attend pas partent).
    const attendus = existant && ecriture.variantes
      ? stylesAttendusDesVersions({ ...existant, ...ecriture }, ecriture.variantes, connus) : null;
    if (existant && ecriture.variantes) ecriture.variantes = fusionnerVariantes(existant.variantes, ecriture.variantes, { attendus });
    // Sans ingrédients reçus, un plat qui a déjà sa recette garde son statut (il ne repasse pas en ⏳).
    let statut = 'nouveau';
    if (existant) statut = !recue ? 'inchange' : rempli ? 'remplace' : 'complete';
    // Modifications faites à la main remplacées : l'aperçu le dit, l'écriture efface leur marque.
    const effacerModification = (statut === 'remplace' || statut === 'complete') && modifieeALaMain(existant);
    // Une recette remplacée ou complétée revient à relire (T2d) : jamais marquée relue d'office. Effacée même si la
    // fiche n'était pas relue à l'aperçu : une relecture enregistrée entre-temps ailleurs (ou avant l'envoi d'un ajout
    // fait hors ligne) jugeait l'ancienne recette.
    const effacerRelue = statut === 'remplace' || statut === 'complete';
    // Réponse sans étapes détaillées (instructions d'avant la version 7) sur une fiche qui en a : jamais de recette
    // hybride, la réalisation est effacée avec la recette remplacée.
    const effacerRealisation = statut === 'remplace' && existant?.realisation != null && !ecriture.realisation;
    if (effacerRealisation) avertissementsPlat.push('Les étapes détaillées actuelles seront remplacées par des étapes courtes.');
    const secondes = existant?.modifieeLe?.seconds;
    const fiche = { ...(existant ?? {}), ...ecriture };
    const { versions } = jugerVersions(vise, fiche, recues, existant?.variantes, avertissementsPlat, attendus);
    elements.push({
      index,
      id: vise,
      nom: nomRetenu,
      statut,
      ...(existant && slug(existant.nom) !== slug(nomRetenu) ? { ancienNom: existant.nom } : {}),
      ...(effacerModification ? { modifieeA: typeof secondes === 'number' && Number.isFinite(secondes) ? secondes : true } : {}),
      ingredients: donnees.ingredients?.length ?? 0,
      etapes: donnees.etapes?.length ?? 0,
      avertissements: avertissementsPlat,
      versions,
      ...(choixPlat ? { choix: choixPlat } : {}),
      ...(reperes?.gardes.length ? {
        reperesGardes: `Repères gardés de la recette actuelle\u00A0: ${texteReperes(reperes.gardes)}. Pour en enlever un\u00A0: Modifier.`,
      } : {}),
      ...(reperes?.perdus.length ? {
        reperesPerdus: `Repères perdus avec des ingrédients qui ne sont plus dans la recette\u00A0: ${texteReperes(reperes.perdus)}.`,
      } : {}),
    });
    ecritures.push({
      id: vise,
      donnees: propre(ecriture),
      ...(effacerModification ? { effacerModification: true } : {}),
      ...(effacerRelue ? { effacerRelue: true } : {}),
      ...(effacerRealisation ? { supprimer: ['realisation'] } : {}),
    });
    clore(demandesSatisfaites(vise, ecriture, ouvertes, { plat: fiche, profils: connus }));
  }
  return {
    elements, ecritures, demandesAClore, erreurs, avertissements, corrections,
    ...(recetteAuLieuDeRelecture ? { relecture: true } : {}),
  };
}

const MESSAGE_REFUS_RELECTURE = 'Cette relecture ne vient pas des instructions actuelles. Recopiez-les depuis Réglages › Projet Claude, puis redemandez ce lot.';

/**
 * Branche « relecture » de preparerImport (T2d) : chaque entrée vise un plat par son seul `id` (un nom différent est
 * ignoré, la fiche n'est jamais renommée ni créée). Statuts : `inconnu` (pas dans les plats), `corbeille`, `attente`
 * (⏳ ou sans ingrédients), `dejaRelue` (rien n'est écrit, quoi que Claude propose ; `propose` : vrai s'il proposait un
 * changement), `relecture` (changements proposés, voir relecture.js › changementsRelecture : `ajouts` cochés par
 * défaut, `retraits` décochés, `introuvables`, `ignores`, `complete` ; `empreinte` : celle de la fiche actuelle ;
 * `empreinteClaude` ; `change` : la fiche a changé depuis la demande ; `marquerRelue` : relecture complète sur une
 * fiche inchangée ; `effets` : effets des ajouts par défaut sur les versions des adultes (effetsSurLesVersions, à
 * recalculer quand une case change) ; `infos` : repères connus hors relecture). Rien n'est demandé ni clos.
 * `controle` : résultat de controlerInstructions ; non nul, la relecture n'est pas enregistrable (`refus:
 * 'instructions'`, `messageRefus`, aucune écriture).
 * → { relecture: true, elements, ecritures (ecrituresRelecture sans choix), demandesAClore: [], erreurs: [],
 *     avertissements, corrections: [], refus?, messageRefus? }
 */
function preparerRelecture(valides, { plats = [], profils = [], controle = null } = {}) {
  const parId = new Map((Array.isArray(plats) ? plats : []).filter(estObjet).map((p) => [p.id, p]));
  const connus = (Array.isArray(profils) ? profils : []).filter(estObjet);
  const elements = [];
  for (const [index, donnees] of valides.entries()) {
    if (!estObjet(donnees)) continue;
    const plat = parId.get(donnees.id);
    const element = {
      index,
      id: donnees.id,
      nom: texte(plat?.nom) || donnees.nom || donnees.id,
      ingredients: Array.isArray(plat?.ingredients) ? plat.ingredients.length : 0,
      etapes: Array.isArray(plat?.etapes) ? plat.etapes.length : 0,
      avertissements: [],
      // Mot du repère (« légume », « fruits de mer ») : aucun code à l'écran.
      infos: (donnees.horsRelecture ?? []).map(({ produit, marqueur }) => `Claude signale aussi «\u00A0${libelleRepere(marqueur)}\u00A0» pour «\u00A0${produit}\u00A0»\u00A0: à corriger dans Modifier si c’est juste.`),
      versions: [],
    };
    if (!plat) {
      elements.push({ ...element, statut: 'inconnu' });
      continue;
    }
    if (estDansCorbeille(plat)) {
      elements.push({ ...element, statut: 'corbeille' });
      continue;
    }
    if (statutDe(plat) === 'attente' || !aSaRecette(plat)) {
      elements.push({ ...element, statut: 'attente' });
      continue;
    }
    const precautions = Array.isArray(donnees.precautions) ? donnees.precautions : [];
    if (estRelue(plat)) {
      const propose = precautions.some((p) => p.poser?.length || p.enlever?.length);
      elements.push({
        ...element, statut: 'dejaRelue', propose, ...(propose ? { avertissements: ['Pour changer un repère\u00A0: Modifier.'] } : {}),
      });
      continue;
    }
    const changements = changementsRelecture(plat, precautions);
    const empreinte = empreinteRelecture(plat);
    const change = donnees.empreinte !== empreinte;
    const avertissements = [...changements.avertissements];
    if (change) {
      avertissements.push(`«\u00A0${plat.nom}\u00A0» a changé depuis la demande\u00A0: les repères cochés seront enregistrés, mais elle restera à relire.`);
    } else if (!changements.complete) {
      avertissements.push('Cette recette restera à relire.');
    }
    elements.push({
      ...element,
      statut: 'relecture',
      ajouts: changements.ajouts,
      retraits: changements.retraits,
      introuvables: changements.introuvables,
      ignores: changements.ignores,
      complete: changements.complete,
      empreinte,
      empreinteClaude: donnees.empreinte,
      change,
      marquerRelue: changements.complete && !change,
      effets: effetsSurLesVersions(plat, { ajouts: changements.ajouts }, connus),
      avertissements,
    });
  }
  const preparation = {
    relecture: true, elements, ecritures: [], demandesAClore: [], erreurs: [], avertissements: [], corrections: [],
  };
  if (controle) return { ...preparation, refus: 'instructions', messageRefus: MESSAGE_REFUS_RELECTURE };
  preparation.ecritures = ecrituresRelecture(preparation, {});
  return preparation;
}

// ——— Lot d'étapes (réponse à DEMANDE-ETAPES, T5-0b) ———

/** Vrai pour une entrée d'un lot d'étapes passée à preparerImport (donnees validées, ou entrée refusée d'entreesPourImport). */
function estEntreeEtapes(entree) {
  return estObjet(entree) && (entree.etapesSeules === true
    || (Object.hasOwn(entree, 'realisation') && Object.hasOwn(entree, 'empreinte')));
}

/**
 * Entrées à passer à preparerImport après validerPaquet. Lot d'étapes : toutes les entrées, dans l'ordre, les
 * refusées comprises (`{ index, id, nom, etapesSeules: true, refus, aCorriger }` : phrase de l'aperçu et codes pour
 * la ligne `à corriger:` de la demande redemandée), pour que l'aperçu les montre « pas repris » ; sinon les `donnees`
 * des entrées valides (chemin d'aujourd'hui).
 */
export function entreesPourImport(validation) {
  const plats = Array.isArray(validation?.plats) ? validation.plats : [];
  if (!validation?.lotDEtapes) return plats.filter((plat) => estObjet(plat?.donnees)).map((plat) => plat.donnees);
  return plats.map((plat) => (estObjet(plat.donnees) && !plat.erreurs?.length
    ? { ...plat.donnees, etapesSeules: true }
    : {
      index: plat.index,
      id: plat.id,
      nom: plat.nom,
      etapesSeules: true,
      refus: plat.erreurs?.[0]?.refus ?? `«\u00A0${plat.nom || plat.id}\u00A0» n’est pas repris. Il restera à détailler.`,
      aCorriger: (plat.erreurs ?? []).map((e) => e.code ?? e.pourClaude).filter(Boolean),
    }));
}

const MESSAGES_REFUS_ETAPES = {
  instructions: 'Ces étapes ne viennent pas des instructions actuelles. Recopiez-les depuis Réglages › Projet Claude, puis redemandez ces recettes.',
  app: 'Ces étapes viennent d’instructions plus récentes que votre app. Fermez puis rouvrez l’app, puis collez de nouveau la réponse.',
};

/**
 * Branche « étapes » de preparerImport (T5-0b) : chaque entrée vise un plat par son seul `id` (jamais créé, renommé
 * ni remplacé) et vaut pour elle-même. Statuts, dans l'ordre de l'examen :
 * `refusee` (entrée refusée à la validation, ou réalisation fautive contre la fiche : `raison`, phrase de l'aperçu,
 * et `aCorriger`, codes pour Claude), `inconnu`, `corbeille`, `attente` (⏳ ou sans ingrédients), `identique` (la
 * fiche a déjà cette réalisation, à jour), `dejaDetaille` (la fiche a une réalisation à jour : rien à écrire, compte
 * comme fait), `change` (empreinte des étapes de la fiche différente de celle de la demande), `etapes` (à écrire :
 * `realisation`, `titres`, `etapes` (nombre), `travail` (minutes), `empreinte` (de la fiche, revérifiée à l'envoi),
 * `remplace` (une réalisation qui n'est plus à jour est remplacée), `modifieeA` (secondes de `modifieeLe`, ou true :
 * fiche modifiée à la main), `reperesARevoir`). `avertissements` : tolérances de la validation, en mots simples, et
 * « Seules les étapes de « X » sont reprises. » pour une entrée qui portait d'autres champs.
 * `controle` (controlerInstructions) non nul : rien n'est enregistrable (`refus` 'instructions', ou 'app' pour une
 * réponse plus récente que l'app ; `messageRefus`).
 * → { lotDEtapes: true, elements, ecritures (ecrituresEtapes), demandesAClore: [], erreurs: [], avertissements: [],
 *     corrections: [], refus?, messageRefus? }
 */
function preparerEtapes(entrees, { plats = [], controle = null } = {}) {
  const parId = new Map((Array.isArray(plats) ? plats : []).filter(estObjet).map((p) => [p.id, p]));
  const elements = [];
  for (const [position, entree] of entrees.entries()) {
    if (!estObjet(entree)) continue;
    const index = Number.isInteger(entree.index) ? entree.index : position;
    const plat = parId.get(entree.id);
    const nom = texte(plat?.nom) || entree.nom || entree.id;
    const element = {
      index,
      id: entree.id,
      nom,
      ingredients: Array.isArray(plat?.ingredients) ? plat.ingredients.length : 0,
      etapes: 0,
      titres: [],
      avertissements: [],
      versions: [],
    };
    if (entree.refus) {
      elements.push({ ...element, statut: 'refusee', raison: entree.refus, aCorriger: entree.aCorriger ?? [] });
      continue;
    }
    if (!plat) {
      elements.push({ ...element, statut: 'inconnu' });
      continue;
    }
    if (estDansCorbeille(plat)) {
      elements.push({ ...element, statut: 'corbeille' });
      continue;
    }
    if (statutDe(plat) === 'attente' || !aSaRecette(plat)) {
      elements.push({ ...element, statut: 'attente' });
      continue;
    }
    const lu = validerRealisation(entree.realisation, {
      produits: plat.ingredients,
      cuisson: Array.isArray(plat.cuisson) ? plat.cuisson : [],
      prefixe: `plats[${index}] (${entree.id})`,
      nom,
    });
    const aJour = realisationAJour(plat);
    if (lu.realisation && aJour && egales(propre(plat.realisation), lu.realisation)) {
      elements.push({ ...element, statut: 'identique' });
      continue;
    }
    if (aJour) {
      elements.push({ ...element, statut: 'dejaDetaille' });
      continue;
    }
    const empreinte = empreinteEtapes(plat);
    if (entree.empreinte !== empreinte) {
      elements.push({ ...element, statut: 'change', empreinte, empreinteClaude: entree.empreinte });
      continue;
    }
    if (!lu.realisation) {
      const [premiere] = lu.erreurs;
      elements.push({
        ...element,
        statut: 'refusee',
        raison: `«\u00A0${nom}\u00A0» n’est pas repris\u00A0: ${premiere?.raison ?? 'ses étapes sont illisibles'}. Il restera à détailler.`,
        aCorriger: lu.erreurs.map((e) => e.code),
      });
      continue;
    }
    const titres = titresDe(lu.realisation);
    const avertissements = lu.avertissements.map((a) => a.message);
    if (entree.autresChamps) avertissements.push(`Seules les étapes de «\u00A0${nom}\u00A0» sont reprises.`);
    const secondes = plat.modifieeLe?.seconds;
    elements.push({
      ...element,
      statut: 'etapes',
      realisation: lu.realisation,
      titres,
      etapes: titres.length,
      travail: travailRecette({ ...plat, realisation: lu.realisation, etapes: titres }),
      empreinte,
      remplace: plat.realisation != null,
      ...(modifieeALaMain(plat) ? { modifieeA: typeof secondes === 'number' && Number.isFinite(secondes) ? secondes : true } : {}),
      reperesARevoir: entree.reperesARevoir === true,
      avertissements,
    });
  }
  const preparation = {
    lotDEtapes: true, elements, ecritures: [], demandesAClore: [], erreurs: [], avertissements: [], corrections: [],
  };
  if (controle) {
    const refus = controle.sens === 'recente' ? 'app' : 'instructions';
    return { ...preparation, refus, messageRefus: MESSAGES_REFUS_ETAPES[refus] };
  }
  preparation.ecritures = ecrituresEtapes(preparation);
  return preparation;
}

/**
 * Écritures d'un lot d'étapes : une par élément `etapes` retenu (pas décoché : `retenu !== false`), aucune si la
 * préparation est refusée. → [{ id, mode: 'etapes', realisation, etapes (titres), empreinte (empreinte des étapes de
 * la fiche à l'aperçu), effacerRelue (Claude signale un repère à revoir, D4) }]. À l'écriture (donnees.js), une
 * transaction par plat, en ligne seulement, qui relit la fiche (verifierEcritureEtapes) et n'écrit que
 * CHAMPS_ECRITS_PAR_ETAPES (champsEcritureEtapes).
 */
export function ecrituresEtapes(preparation) {
  if (preparation?.refus) return [];
  return (Array.isArray(preparation?.elements) ? preparation.elements : [])
    .filter((element) => estObjet(element) && element.statut === 'etapes' && element.retenu !== false)
    .map((element) => ({
      id: element.id,
      mode: 'etapes',
      realisation: propre(element.realisation),
      etapes: [...element.titres],
      empreinte: element.empreinte,
      effacerRelue: element.reperesARevoir === true,
    }));
}

/**
 * Pourquoi une écriture d'étapes ne s'applique plus à la fiche relue dans la transaction : 'supprime' (plus de
 * fiche), 'corbeille', 'sansRecette' (⏳ ou sans ingrédients), 'dejaFaite' (la fiche porte déjà, à jour, exactement
 * cette réalisation : écrite par l'autre appareil ou par un premier envoi ; rien à écrire, comptée comme écrite),
 * 'change' (empreinte des étapes différente de celle de l'aperçu) ; null : à écrire.
 */
export function verifierEcritureEtapes(ecriture, fiche) {
  if (!estObjet(fiche)) return 'supprime';
  if (estDansCorbeille(fiche)) return 'corbeille';
  if (statutDe(fiche) === 'attente' || !aSaRecette(fiche)) return 'sansRecette';
  if (realisationAJour(fiche) && egales(propre(fiche.realisation), propre(ecriture?.realisation ?? null))) return 'dejaFaite';
  if (empreinteEtapes(fiche) !== ecriture?.empreinte) return 'change';
  return null;
}

/**
 * Champs écrits par une écriture d'étapes, hors `majPar` et `majLe` (posés par donnees.js) : { champs: { realisation,
 * etapes }, effacer: ['reperesRelus'] seulement si `effacerRelue` }. Jamais `ingredients`, `cuisson`, `variantes`,
 * `notes`, `statutRecette`, `modifieeLe`, `modifieePar` (CHAMPS_ECRITS_PAR_ETAPES).
 */
export function champsEcritureEtapes(ecriture) {
  return {
    champs: { realisation: propre(ecriture?.realisation ?? []), etapes: [...(ecriture?.etapes ?? [])] },
    effacer: ecriture?.effacerRelue ? ['reperesRelus'] : [],
  };
}

/**
 * Préparation sans les plats décochés dans l'aperçu (`decoches` : Set ou liste d'identifiants de plats) : leurs
 * écritures, leurs demandes à clore et leurs corrections sont retirées ; leurs éléments restent, marqués
 * `retenu: false` (les autres `retenu: true`). `preparation` reste intacte.
 */
export function filtrerPreparation(preparation, decoches) {
  const retires = new Set(decoches instanceof Set ? decoches : Array.isArray(decoches) ? decoches : []);
  const garde = (id) => !retires.has(id);
  const platDeDemande = (demande) => String(demande).split('__')[0];
  return {
    ...preparation,
    elements: (preparation?.elements ?? []).map((element) => ({ ...element, retenu: garde(element.id) })),
    ecritures: (preparation?.ecritures ?? []).filter((ecriture) => garde(ecriture.id)),
    demandesAClore: (preparation?.demandesAClore ?? []).filter((demande) => garde(platDeDemande(demande))),
    corrections: (preparation?.corrections ?? []).filter((correction) => garde(correction.id)),
  };
}
