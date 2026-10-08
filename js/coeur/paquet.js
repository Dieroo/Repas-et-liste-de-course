// Ajout de recettes au format « paquet@1 » (CLAUDE.md §8) : retrouver la recette dans la réponse de Claude,
// la valider, préparer les écritures. Logique pure : ni DOM ni Firebase.
// Chaque erreur porte deux textes : `message` (affiché, en français courant) et `pourClaude` (codes exacts,
// recopiés dans le texte de correction à recoller dans le Projet Claude).
import { sansAccents, slug } from './slug.js';
import { NOM_MAX, statutDe } from './plats.js';
import { VOCABULAIRES, code, estObjet, liste, nombre, texte, validerIngredient } from './vocabulaire.js';
import { evaluer, marqueursEffectifs } from './compatibilite.js';
import { VERSION_INSTRUCTIONS } from './claude.js';

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
const CHAMPS_VARIANTE = ['pour', 'retirer', 'ajouter', 'consigne'];
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

// ——— Validation ———

/**
 * Une recette du collage. → { index, id, nom, donnees (null si erreur), erreurs, avertissements }
 * `versionsEnDouble` : deux variantes pour le même profil sont une erreur à l'ajout de recettes ('erreur') ; ailleurs
 * (fiches en base, sauvegardes, empreintes : 'premiere'), seule la première est gardée, comme le fait evaluer.
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
      // Une seule version par profil.
      const vues = new Set();
      const uniques = [];
      variantes.forEach((variante, j) => {
        if (!variante) return;
        if (!vues.has(variante.pour)) {
          vues.add(variante.pour);
          uniques.push(variante);
        } else if (versionsEnDouble === 'erreur') {
          signaler(`Deux versions pour le même profil dans ${affiche}.`, `variantes[${j}].pour « ${variante.pour} » : deux variantes pour le même profil`);
        } else {
          prevenir(`${affiche}\u00A0: deux versions pour le même profil, seule la première est gardée.`, `variantes[${j}].pour « ${variante.pour} » : deux variantes pour le même profil, la première est gardée`);
        }
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
 * `versionsEnDouble` : 'erreur' (ajout de recettes) ou 'premiere' (sauvegarde : seule la première est gardée).
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

/**
 * Versions d'une fiche après réception de `recues` : chaque version reçue remplace celle du même profil (`pour`), à sa
 * place ; les versions des autres profils restent, dans leur ordre ; les nouvelles vont à la fin. Une version reçue ne
 * retire jamais celle d'un autre profil. Aucune valeur undefined (ni null) dans le résultat.
 */
export function fusionnerVariantes(actuelles, recues) {
  const resultat = (Array.isArray(actuelles) ? actuelles : []).filter((v) => v != null).map(propre);
  const vus = new Set();
  for (const recue of Array.isArray(recues) ? recues : []) {
    if (!estObjet(recue) || typeof recue.pour !== 'string' || !recue.pour || vus.has(recue.pour)) continue;
    vus.add(recue.pour);
    const position = resultat.findIndex((v) => estObjet(v) && v.pour === recue.pour);
    if (position === -1) {
      resultat.push(propre(recue));
      continue;
    }
    resultat[position] = propre(recue);
    // Une ancienne version en double pour ce profil (fiche abîmée) ne survit pas à la nouvelle.
    for (let i = resultat.length - 1; i > position; i -= 1) {
      if (estObjet(resultat[i]) && resultat[i].pour === recue.pour) resultat.splice(i, 1);
    }
  }
  return resultat;
}

/** Profil d'identifiant `pour` ; un profil inconnu compte comme un profil sans règle. */
function profilDe(profils, pour) {
  return profils.find((p) => p.id === pour) ?? { id: pour };
}

/**
 * Ce que donne la version de `pour` sur la fiche (déjà fusionnée) : { convient, restants: [{ nom, marqueurs }] }.
 * Une version convient si le plat a sa recette et n'est plus « à créer » ni « à revoir » pour ce profil
 * (compatibilite.js › evaluer).
 */
function versionConvient(fiche, profil) {
  const resultat = evaluer(fiche, profil);
  // Plat sans recette (⏳) : rien ne dit encore que la version convient.
  if (resultat.niveau === 'inconnu') return { convient: false, restants: [] };
  if (!resultat.aCreer && !resultat.aRevoir) return { convient: true, restants: [] };
  // Marqueurs exclus par le profil, pour nommer la cause à Claude.
  const exclus = new Set();
  for (const regle of Array.isArray(profil?.regles) ? profil.regles : []) {
    if (estObjet(regle) && regle.actif !== false && regle.severite === 'exclu' && regle.type === 'exclureMarqueurs') {
      for (const marqueur of Array.isArray(regle.marqueurs) ? regle.marqueurs : []) exclus.add(marqueur);
    }
  }
  const version = (Array.isArray(fiche.variantes) ? fiche.variantes : []).find((v) => estObjet(v) && v.pour === profil.id);
  const candidats = [...(Array.isArray(fiche.ingredients) ? fiche.ingredients : []),
    ...(Array.isArray(version?.ajouter) ? version.ajouter : [])].filter(estObjet);
  const restants = (resultat.restants.length ? resultat.restants : resultat.fautifs.map((i) => texte(i.produit)))
    .map((nom) => {
      const ingredient = candidats.find((i) => texte(i.produit) === nom);
      const marqueurs = ingredient ? [...marqueursEffectifs(ingredient)].filter((m) => exclus.has(m)) : [];
      return { nom, marqueurs };
    });
  return { convient: false, restants };
}

/**
 * Demandes ouvertes que la recette reçue par le plat `id` satisfait : `<id>__recette` si elle a des ingrédients ;
 * `<id>__<profil>` pour chaque variante reçue, seulement si la version convient vraiment à ce profil sur la fiche
 * qui en résulte (`plat` : fiche fusionnée ; à défaut, `donnees`). `ouvertes` : identifiants des demandes ouvertes
 * (Set ou liste). `profils` (obligatoire) : profils de l'app, pour juger les versions.
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
    if (versionConvient(fiche, profilDe(connus, variante.pour)).convient) satisfaites.push(demande);
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
 *     ecritures: [{ id, donnees, effacerModification? } | { id, mode: 'versions', variantes }],
 *     demandesAClore: [id], erreurs, avertissements, corrections: [{ id, pour, message, pourClaude }] }
 *   statut ∈ nouveau, complete (⏳ complété), remplace (recette remplacée), inchange (plat ⏳ sans ingrédients reçus),
 *   versions (seules les versions reçues s'écrivent, fusionnées par profil : ni nom, ni statut, ni recette, marque
 *   « modifiée à la main » gardée), identique (rien n'est écrit ; les demandes satisfaites sont closes).
 *   `versions` : [{ pour, nom, action: 'ajoutee' | 'remplacee', convient, libelle }] (versions reçues qui changent).
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

  /** Versions reçues jugées sur la fiche qui en résulte : libellés, avertissements et corrections. */
  const jugerVersions = (vise, fiche, recues, actuelles, avertissementsPlat) => {
    const versions = [];
    for (const variante of recues) {
      const avant = (Array.isArray(actuelles) ? actuelles : []).find((v) => estObjet(v) && v.pour === variante.pour);
      if (avant && egales(propre(avant), variante)) continue;
      const nom = prenom(variante.pour);
      const { convient, restants } = versionConvient(fiche, profilDe(connus, variante.pour));
      versions.push({
        pour: variante.pour,
        nom,
        action: avant ? 'remplacee' : 'ajoutee',
        convient,
        // 🌿 seulement pour une version qui convient : sinon le plat reste « à revoir ».
        libelle: avant ? `Version pour ${nom} remplacée` : `${convient ? '🌿 ' : ''}Version pour ${nom} ajoutée`,
      });
      if (!convient) {
        const message = `La version pour ${nom} contient encore\u00A0: ${restants.map((r) => r.nom).join(', ')}.`;
        avertissementsPlat.push(message);
        corrections.push({
          id: vise,
          pour: variante.pour,
          message,
          pourClaude: `id ${vise} variantes[pour=${variante.pour}] : contient ${restants
            .map((r) => (r.marqueurs.length ? `${r.nom} (${r.marqueurs.join(', ')})` : r.nom)).join(', ')}, exclu pour ${variante.pour}`,
        });
      }
    }
    return versions;
  };

  /** Seules les versions reçues pour un plat rempli : statut `versions`, ou `identique` si rien ne change. */
  const prendreVersions = (existant, recues, avertissementsPlat, extra = {}, recette = null) => {
    const vise = existant.id;
    const fusion = fusionnerVariantes(existant.variantes, recues);
    const fiche = { ...existant, variantes: fusion };
    const versions = jugerVersions(vise, fiche, recues, existant.variantes, avertissementsPlat);
    const changees = recues.filter((v) => versions.some((version) => version.pour === v.pour));
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
    if (changees.length) ecritures.push({ id: vise, mode: 'versions', variantes: changees.map(propre) });
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
            avertissementsPlat.push(`Version pour ${prenom(variante.pour)}\u00A0: «\u00A0${produit}\u00A0» n’est pas dans la recette.`);
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

    // Versions reçues avec une fiche complète : fusionnées avec celles de la fiche (celles des autres profils restent).
    if (existant && ecriture.variantes) ecriture.variantes = fusionnerVariantes(existant.variantes, ecriture.variantes);
    // Sans ingrédients reçus, un plat qui a déjà sa recette garde son statut (il ne repasse pas en ⏳).
    let statut = 'nouveau';
    if (existant) statut = !recue ? 'inchange' : rempli ? 'remplace' : 'complete';
    // Modifications faites à la main remplacées : l'aperçu le dit, l'écriture efface leur marque.
    const effacerModification = (statut === 'remplace' || statut === 'complete') && modifieeALaMain(existant);
    const secondes = existant?.modifieeLe?.seconds;
    const fiche = { ...(existant ?? {}), ...ecriture };
    const versions = jugerVersions(vise, fiche, recues, existant?.variantes, avertissementsPlat);
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
