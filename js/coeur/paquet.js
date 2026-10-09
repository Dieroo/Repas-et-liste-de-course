// Ajout de recettes au format « paquet@1 » (CLAUDE.md §8) : retrouver la recette dans la réponse de Claude,
// la valider, préparer les écritures. Logique pure : ni DOM ni Firebase.
// Chaque erreur porte deux textes : `message` (affiché, en français courant) et `pourClaude` (codes exacts,
// recopiés dans le texte de correction à recoller dans le Projet Claude).
import { sansAccents, slug } from './slug.js';
import { NOM_MAX, statutDe } from './plats.js';
import {
  EMOJIS_STYLE, LIBELLES_STYLE, STYLES, VOCABULAIRES, code, estObjet, liste, nombre, texte, validerIngredient,
} from './vocabulaire.js';
import { evaluer, marqueursEffectifs, styleDe } from './compatibilite.js';
import { SOURCE_IDEE, VERSION_INSTRUCTIONS } from './claude.js';
import { stylesAttendus } from './regles.js';

// Déplacés dans vocabulaire.js (module feuille, T2a) ; toujours importables d'ici.
export { VOCABULAIRES, SOUS_TYPES_VIANDE, VIANDES, IMPLICATIONS, code, validerIngredient } from './vocabulaire.js';

export const FORMAT = 'paquet@1';
export const TEXTE_MAX = 500_000;
export const PLATS_MAX = 400;

const ID = /^[a-z0-9-]+$/;

const APPAREILS_A_TEMPERATURE = ['four', 'airfryer'];

export const CHAMPS_PLAT = ['id', 'nom', 'type', 'recurrence', 'statutRecette', 'portionsBase', 'ingredients', 'etapes',
  'cuisson', 'tempsActifMin', 'conservation', 'emporter', 'variantes', 'source'];
// Champs de la fiche connus mais jamais repris par l'ajout de recettes (notes, dernier passage, marque « modifiée à
// la main ») : ils voyagent dans une sauvegarde, que seule la restauration reprend.
const CHAMPS_IGNORES = ['notes', 'derniereFois', 'modifieeLe', 'modifieePar'];
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
 * Une recette du collage. → { index, id, nom, donnees (null si erreur), erreurs, avertissements }
 * Versions d'un même profil : une par style (`mer`, `vegetal`), et une version sans style est la seule de son profil.
 * `versionsEnDouble` : à l'ajout de recettes ('erreur'), deux versions en conflit sont une erreur, comme une version
 * dont le style ne va pas avec ses ajouts (mer sans poisson ni fruits de mer ni jours au frigo, végétale avec) ;
 * ailleurs (fiches en base, sauvegardes, empreintes : 'premiere'), seule la première version en conflit est gardée et
 * une version incohérente reste, avec un avertissement.
 */
function validerPlat(brut, index, idsProfils, { versionsEnDouble = 'premiere' } = {}) {
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
 * → { plats: [{ index, id, nom, donnees, erreurs, avertissements }], erreurs, avertissements, valide }
 *   `donnees` ne contient que des champs présents et valides (aucune valeur undefined, aucune table vide).
 */
export function validerPaquet(paquets, {
  profils = null, platsMax = PLATS_MAX, doublonsDeNom = true, versionsEnDouble = 'erreur',
} = {}) {
  const erreurs = [];
  const avertissements = [];
  const bruts = [];
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
  }
  if (clesIgnorees) {
    avertissements.push({ message: 'Seules les recettes sont ajoutées ici\u00A0: le reste a été ignoré.', pourClaude: 'clés autres que plats ignorées' });
  }
  if (bruts.some((brut) => estObjet(brut) && brut.notes != null)) {
    avertissements.push({ message: 'Les notes ne sont pas reprises ici.', pourClaude: 'notes ignorées' });
  }
  if (!bruts.length && !erreurs.length) {
    erreurs.push({ message: 'Aucune recette dans ce texte.', pourClaude: 'plats : au moins une recette attendue' });
  }
  if (bruts.length > platsMax) {
    erreurs.push({ message: `Trop de recettes d’un coup (${platsMax} au plus).`, pourClaude: `plats : ${platsMax} au plus` });
    return { plats: [], erreurs, avertissements, valide: false };
  }

  const idsProfils = Array.isArray(profils) && profils.length ? new Set(profils.map((p) => p.id)) : null;
  const plats = bruts.map((brut, index) => validerPlat(brut, index, idsProfils, { versionsEnDouble }));

  // Doublons dans le collage : même identifiant ou même nom (sauf demande contraire).
  const vus = new Map();
  for (const plat of plats) {
    const cles = [[`id:${plat.id}`, 'identifiant']];
    if (doublonsDeNom) cles.push([`nom:${slug(plat.nom)}`, 'nom']);
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
  return { plats, erreurs, avertissements, valide };
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

/** Recette d'une fiche sans ses versions, son nom ni son statut : ce qui compte pour « même recette ». */
function recetteSansVersions(plat) {
  const recette = recetteValidee(plat);
  if (!recette) return null;
  const { variantes: _v, nom: _n, statutRecette: _s, ...reste } = recette;
  return reste;
}

/**
 * Plat visé par chaque recette valide, écritures et demandes à clore (CLAUDE.md §8, T2b).
 * `valides` : `donnees` des plats validés. `cible` : plat depuis lequel on a touché « Coller la réponse » (prime si une
 * seule entrée est collée). `profils` : profils de l'app (libellés, versions qui conviennent). `choix` : { [platId]:
 * 'version' | 'remplacer' }, pour une fiche complète reçue, différente de la recette actuelle et porteuse de versions.
 * → { elements: [{ index, id, nom, statut, ancienNom?, modifieeA?, ingredients, etapes, avertissements, versions,
 *       choix? }],
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
 *   les règles habituelles).
 *   `versions` : [{ pour, style, nom, action: 'ajoutee' | 'remplacee', convient, libelle }] (versions reçues qui
 *   changent ; `style` : celui de la version reçue, ou null). Une version reçue est comparée à celle du même profil et
 *   du même style (déduit pour une version d'avant les styles), et jugée seule (evaluer › versions).
 *   `choix` : { retenu, parDefaut } ('version' ou 'remplacer' ; « Ne prendre que sa version » d'avance si la fiche
 *   est vérifiée ou modifiée à la main).
 *   Une entrée sans ingrédients porteuse de versions, pour un plat inconnu ou ⏳, n'est qu'un avertissement : le
 *   reste s'enregistre. Une version qui ne convient pas encore est importée, avec un avertissement et une
 *   correction pour Claude ; sa demande reste ouverte.
 */
export function preparerImport(valides, { plats = [], demandes = [], cible = null, profils = [], choix = {} } = {}) {
  const erreurs = [];
  const avertissements = [];
  const corrections = [];
  const connus = (Array.isArray(profils) ? profils : []).filter(estObjet);
  const prenom = (pour) => texte(connus.find((p) => p.id === pour)?.nom) || pour;
  const choixRetenus = estObjet(choix) ? choix : {};
  const parId = new Map(plats.map((p) => [p.id, p]));
  const parNom = new Map(plats.map((p) => [slug(p.nom), p]));
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
    if (viseCible) {
      // La recette d'un autre plat déjà présent, collée sur cette fiche, en ferait un doublon.
      if (memeNom && memeNom.id !== cible) {
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

    // Idée de Claude (DEMANDE-IDEES) pour un plat qui a déjà sa recette : une idée ne remplace jamais une recette du
    // foyer. Rien n'est écrit, sans erreur : les autres idées du lot s'enregistrent.
    const dejaLa = !viseCible && recue && texte(donnees.source) === SOURCE_IDEE ? parId.get(vise) : null;
    if (dejaLa && aSaRecette(dejaLa)) {
      elements.push({
        index,
        id: vise,
        nom: donnees.nom,
        statut: 'deja',
        ingredients: dejaLa.ingredients.length,
        etapes: Array.isArray(dejaLa.etapes) ? dejaLa.etapes.length : 0,
        avertissements: [...avertissementsPlat, `«\u00A0${dejaLa.nom}\u00A0» est déjà dans vos plats\u00A0: cette idée n’est pas reprise.`],
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
    vises.set(vise, donnees.nom);
    pris.add(vise);

    const existant = parId.get(vise);
    if (memeNom && memeNom.id !== vise) {
      avertissementsPlat.push(`Un autre plat s’appelle déjà «\u00A0${memeNom.nom}\u00A0».`);
    }
    const ecriture = { ...donnees, id: vise };
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
      if (actuelle && egales(actuelle, recetteSansVersions(ecriture))) {
        // Même recette (hors versions, nom et statut) : seules les versions reçues comptent ; le nom reste.
        if (slug(donnees.nom) !== slug(existant.nom)) {
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
          index, id: vise, nom: donnees.nom, statut: 'identique', ingredients: 0, etapes: 0, avertissements: avertissementsPlat, versions: [],
        });
        clore(demandesSatisfaites(vise, ecriture, ouvertes, { plat: { ...existant, ...ecriture }, profils: connus }));
        continue;
      }
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
    const secondes = existant?.modifieeLe?.seconds;
    const fiche = { ...(existant ?? {}), ...ecriture };
    const { versions } = jugerVersions(vise, fiche, recues, existant?.variantes, avertissementsPlat, attendus);
    elements.push({
      index,
      id: vise,
      nom: donnees.nom,
      statut,
      ...(existant && slug(existant.nom) !== slug(donnees.nom) ? { ancienNom: existant.nom } : {}),
      ...(effacerModification ? { modifieeA: typeof secondes === 'number' && Number.isFinite(secondes) ? secondes : true } : {}),
      ingredients: donnees.ingredients?.length ?? 0,
      etapes: donnees.etapes?.length ?? 0,
      avertissements: avertissementsPlat,
      versions,
      ...(choixPlat ? { choix: choixPlat } : {}),
    });
    ecritures.push({ id: vise, donnees: propre(ecriture), ...(effacerModification ? { effacerModification: true } : {}) });
    clore(demandesSatisfaites(vise, ecriture, ouvertes, { plat: fiche, profils: connus }));
  }
  return { elements, ecritures, demandesAClore, erreurs, avertissements, corrections };
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
