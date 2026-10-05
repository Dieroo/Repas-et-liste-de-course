// Ajout de recettes au format « paquet@1 » (CLAUDE.md §8) : retrouver la recette dans la réponse de Claude,
// la valider, préparer les écritures. Logique pure : ni DOM ni Firebase.
// Chaque erreur porte deux textes : `message` (affiché, en français courant) et `pourClaude` (codes exacts,
// recopiés dans le texte de correction à recoller dans le Projet Claude).
import { slug, sansAccents } from './slug.js';
import { NOM_MAX, statutDe } from './plats.js';

export const FORMAT = 'paquet@1';
export const TEXTE_MAX = 500_000;
export const PLATS_MAX = 400;

const ID = /^[a-z0-9-]+$/;

export const VOCABULAIRES = {
  type: ['plat', 'dessert', 'accompagnement', 'preparation', 'apero'],
  recurrence: ['aucune', 'hebdo'],
  statutRecette: ['attente', 'brouillon', 'validee'],
  unite: ['g', 'kg', 'ml', 'cl', 'l', 'pc', 'cs', 'cc', 'pincee', 'botte', 'sachet', 'boite', 'tranche'],
  rayon: ['fruits_legumes', 'boucherie', 'charcuterie', 'poissonnerie', 'cremerie', 'fromages', 'epicerie_salee',
    'epicerie_sucree', 'boulangerie', 'surgeles', 'boissons', 'hygiene', 'entretien', 'divers'],
  marqueurs: ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie', 'poisson', 'fruits_de_mer',
    'bouillon_viande', 'gelatine_porc', 'oeuf', 'oeuf_cru', 'laitier', 'alcool_cru', 'cafe', 'legume', 'feculent'],
  appareil: ['plaque', 'four', 'cookeo', 'airfryer', 'monsieur_cuisine'],
  forme: ['hachee', 'fine', 'morceaux', 'effilochable'],
  role: ['principal', 'incorpore'],
};

const VIANDES = ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie'];
const APPAREILS_A_TEMPERATURE = ['four', 'airfryer'];

const CHAMPS_PLAT = ['id', 'nom', 'type', 'recurrence', 'statutRecette', 'portionsBase', 'ingredients', 'etapes',
  'cuisson', 'tempsActifMin', 'conservation', 'emporter', 'variantes', 'source'];
const CHAMPS_INGREDIENT = ['produit', 'qte', 'qtePortion', 'unite', 'rayon', 'marqueurs', 'forme', 'role'];
const CHAMPS_CUISSON = ['appareil', 'tempC', 'mode', 'dureeMin'];
const CHAMPS_CONSERVATION = ['frigoJours', 'congelable'];
const CHAMPS_VARIANTE = ['pour', 'retirer', 'ajouter', 'consigne'];
const ANNONCE_RECETTE = /"(format|plats)"\s*:/;

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
 * Retrouve les recettes dans un texte : réponse complète de Claude (prose et blocs de code), bloc seul ou fichier.
 * → { paquets: [objet, …] } ou { erreur } avec erreur ∈ vide, trop_long, demande, coupee, aucune.
 */
export function extrairePaquet(texte) {
  const brut = String(texte ?? '');
  if (!brut.trim()) return { erreur: 'vide' };
  if (brut.length > TEXTE_MAX) return { erreur: 'trop_long' };
  // Sa propre demande, ou les corrections, recollées à la place de la réponse de Claude.
  if (/^\s*(DEMANDE-|CORRECTION\s+paquet@)/i.test(brut)) return { erreur: 'demande' };
  const paquets = [];
  let finDernier = -1; // fin du dernier objet lu
  let coupe = -1; // dernier objet commencé, jamais refermé, qui annonce une recette
  let budget = 20 * TEXTE_MAX; // caractères parcourus au plus (évite un coût quadratique)
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
  return { erreur: ANNONCE_RECETTE.test(brut) ? 'coupee' : 'aucune' };
}

// ——— Valeurs tolérées ———

/** Valeur comparable aux vocabulaires fermés : « Incorporé » → incorpore, « fruits & légumes » → fruits_legumes. */
export function code(valeur) {
  if (typeof valeur !== 'string') return '';
  return sansAccents(valeur).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Nombre, y compris écrit en texte (« 450 », « 0,5 ») ; NaN sinon. */
function nombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : NaN;
  if (typeof valeur !== 'string') return NaN;
  const propre = valeur.trim().replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(propre) ? Number(propre) : NaN;
}

function booleen(valeur) {
  if (typeof valeur === 'boolean') return valeur;
  const c = code(valeur);
  if (c === 'true' || c === 'oui') return true;
  if (c === 'false' || c === 'non') return false;
  return null;
}

function texte(valeur) {
  return typeof valeur === 'string' ? valeur.replace(/\s+/g, ' ').trim() : '';
}

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);

const liste = (valeurs) => valeurs.map((v) => `\`${v}\``).join(', ');

// ——— Validation ———

/** Ingrédient d'une recette (`qte`) ou d'une variante (`qtePortion`). → { ingredient } ou erreurs ajoutées. */
function validerIngredient(brut, { position, champQte, signaler, inconnu }) {
  const nomProduit = texte(brut?.produit).toLocaleLowerCase('fr-FR');
  const affiche = nomProduit ? `${position.affiche} (${nomProduit})` : position.affiche;
  const claude = nomProduit ? `${position.claude} « ${nomProduit} »` : position.claude;
  const erreur = (message, pourClaude) => signaler(`${affiche}\u00A0: ${message}`, `${claude} : ${pourClaude}`);

  if (!estObjet(brut)) {
    erreur('illisible.', 'objet attendu');
    return null;
  }
  const ingredient = {};
  let valide = true;
  const refuser = (message, pourClaude) => {
    valide = false;
    erreur(message, pourClaude);
  };

  if (!nomProduit) refuser('nom de l’ingrédient manquant.', 'produit manquant');
  else ingredient.produit = nomProduit;

  if (champQte === 'qtePortion' && brut.qtePortion == null && brut.qte != null) {
    refuser('quantité par portion attendue.', '`qtePortion` attendu (quantité par portion) au lieu de `qte`');
  } else {
    const quantite = nombre(brut[champQte]);
    if (!(quantite > 0)) refuser('quantité manquante ou invalide.', `\`${champQte}\` : nombre supérieur à 0`);
    else ingredient[champQte] = quantite;
  }

  const unite = code(brut.unite);
  if (!VOCABULAIRES.unite.includes(unite)) {
    refuser(brut.unite == null ? 'unité manquante.' : `unité «\u00A0${texte(String(brut.unite))}\u00A0» inconnue.`,
      `unite : ${liste(VOCABULAIRES.unite)}`);
  } else {
    ingredient.unite = unite;
  }

  const rayon = code(brut.rayon);
  if (!VOCABULAIRES.rayon.includes(rayon)) {
    refuser(brut.rayon == null ? 'rayon manquant.' : `rayon «\u00A0${texte(String(brut.rayon))}\u00A0» inconnu.`,
      `rayon : ${liste(VOCABULAIRES.rayon)}`);
  } else {
    ingredient.rayon = rayon;
  }

  const marqueurs = [];
  if (brut.marqueurs != null && !Array.isArray(brut.marqueurs)) {
    refuser('marqueurs illisibles.', 'marqueurs : liste attendue');
  } else {
    for (const brutMarqueur of brut.marqueurs ?? []) {
      const marqueur = code(brutMarqueur);
      if (!VOCABULAIRES.marqueurs.includes(marqueur)) {
        refuser(`marqueur «\u00A0${texte(String(brutMarqueur))}\u00A0» inconnu.`, `marqueurs : ${liste(VOCABULAIRES.marqueurs)}`);
      } else if (!marqueurs.includes(marqueur)) {
        marqueurs.push(marqueur);
      }
    }
  }
  ingredient.marqueurs = marqueurs;

  const forme = code(brut.forme);
  if (marqueurs.some((m) => VIANDES.includes(m))) {
    if (!VOCABULAIRES.forme.includes(forme)) {
      refuser('précisez la forme de la viande (hachée, fine, morceaux ou effilochable).',
        `forme manquante ou inconnue pour une viande : ${liste(VOCABULAIRES.forme)}`);
    } else {
      ingredient.forme = forme;
    }
  } else if (VOCABULAIRES.forme.includes(forme)) {
    ingredient.forme = forme;
  }

  const role = code(brut.role);
  if (marqueurs.includes('legume')) {
    if (!VOCABULAIRES.role.includes(role)) {
      refuser('précisez si ce légume est principal ou incorporé.',
        `role manquant ou inconnu pour un légume : ${liste(VOCABULAIRES.role)}`);
    } else {
      ingredient.role = role;
    }
  } else if (VOCABULAIRES.role.includes(role)) {
    ingredient.role = role;
  }

  if (Object.keys(brut).some((cle) => !CHAMPS_INGREDIENT.includes(cle))) inconnu();
  return valide ? ingredient : null;
}

/** Une recette du collage. → { index, id, nom, donnees (null si erreur), erreurs, avertissements } */
function validerPlat(brut, index, idsProfils) {
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
  const resultat = (donnees) => ({ index, id, nom, donnees: erreurs.length ? null : donnees, erreurs, avertissements });

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
  } else if (statut === 'brouillon' || statut === 'validee') {
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
        return ok ? variante : null;
      });
      if (variantes.every(Boolean) && (variantes.length || aRecette)) donnees.variantes = variantes;
    }
  }

  const source = texte(brut.source);
  if (source) donnees.source = source;

  if (Object.keys(brut).some((cle) => !CHAMPS_PLAT.includes(cle))) inconnu();
  if (champsInconnus) prevenir(`${affiche}\u00A0: des informations non reconnues ont été ignorées.`, ': champs inconnus ignorés');
  return resultat(donnees);
}

/**
 * Valide les recettes retrouvées (CLAUDE.md §8). `profils` : profils de l'app (variante pour un profil inconnu → avertissement).
 * → { plats: [{ index, id, nom, donnees, erreurs, avertissements }], erreurs, avertissements, valide }
 *   `donnees` ne contient que des champs présents et valides (aucune valeur undefined, aucune table vide).
 */
export function validerPaquet(paquets, { profils = null } = {}) {
  const erreurs = [];
  const avertissements = [];
  const bruts = [];
  let clesIgnorees = false;
  for (const paquet of Array.isArray(paquets) ? paquets : [paquets]) {
    if (!estObjet(paquet) || code(paquet.format) !== code(FORMAT)) {
      erreurs.push({ message: 'Ce texte ne vient pas de votre projet Claude, ou d’une version que l’app ne connaît pas.', pourClaude: `format : \`${FORMAT}\` attendu` });
      continue;
    }
    if (Object.keys(paquet).some((cle) => cle !== 'format' && cle !== 'plats')) clesIgnorees = true;
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
  if (!bruts.length && !erreurs.length) {
    erreurs.push({ message: 'Aucune recette dans ce texte.', pourClaude: 'plats : au moins une recette attendue' });
  }
  if (bruts.length > PLATS_MAX) {
    erreurs.push({ message: `Trop de recettes d’un coup (${PLATS_MAX} au plus).`, pourClaude: `plats : ${PLATS_MAX} au plus` });
    return { plats: [], erreurs, avertissements, valide: false };
  }

  const idsProfils = Array.isArray(profils) && profils.length ? new Set(profils.map((p) => p.id)) : null;
  const plats = bruts.map((brut, index) => validerPlat(brut, index, idsProfils));

  // Doublons dans le collage : même identifiant ou même nom.
  const vus = new Map();
  for (const plat of plats) {
    for (const [cle, quoi] of [[`id:${plat.id}`, 'identifiant'], [`nom:${slug(plat.nom)}`, 'nom']]) {
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

// ——— Préparer les écritures ———

function idLibre(base, pris) {
  let id = `${base}-2`;
  for (let n = 3; pris.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * Plat visé par chaque recette valide, écritures et demandes à clore (CLAUDE.md §8).
 * `valides` : `donnees` des plats validés. `cible` : plat depuis lequel on a touché « Coller la recette ».
 * → { elements: [{ id, nom, statut, ancienNom?, ingredients, etapes, avertissements }], ecritures: [{ id, donnees }],
 *     demandesAClore: [id], erreurs, avertissements }
 *   statut ∈ nouveau, complete (⏳ complété), remplace (recette existante remplacée), inchange (pas d'ingrédients
 *   reçus pour un plat existant : sa recette reste).
 */
export function preparerImport(valides, { plats = [], demandes = [], cible = null } = {}) {
  const erreurs = [];
  const avertissements = [];
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
  for (const donnees of valides) {
    const avertissementsPlat = [];
    // Plat visé : la cible, sinon le même identifiant s'il s'agit bien du même plat, sinon le même nom (doublons
    // repérés par le nom, §8), sinon un nouveau plat (identifiant libre si un autre plat utilise déjà le sien).
    let vise;
    const memeId = parId.get(donnees.id);
    const memeNom = parNom.get(slug(donnees.nom));
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
      || ouvertes.has(`${memeId.id}__recette`))) {
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
    const recue = Boolean(ecriture.ingredients?.length);
    // Sans ingrédients reçus, un plat qui a déjà sa recette garde son statut (il ne repasse pas en ⏳).
    if (!recue && existant && statutDe(existant) !== 'attente') delete ecriture.statutRecette;
    let statut = 'nouveau';
    if (existant) statut = !recue ? 'inchange' : statutDe(existant) === 'attente' ? 'complete' : 'remplace';
    elements.push({
      id: vise,
      nom: donnees.nom,
      statut,
      ...(existant && slug(existant.nom) !== slug(donnees.nom) ? { ancienNom: existant.nom } : {}),
      ingredients: donnees.ingredients?.length ?? 0,
      etapes: donnees.etapes?.length ?? 0,
      avertissements: avertissementsPlat,
    });
    ecritures.push({ id: vise, donnees: ecriture });

    if (ecriture.ingredients?.length && ouvertes.has(`${vise}__recette`)) demandesAClore.push(`${vise}__recette`);
    for (const variante of ecriture.variantes ?? []) {
      const demande = `${vise}__${variante.pour}`;
      if (ouvertes.has(demande) && !demandesAClore.includes(demande)) demandesAClore.push(demande);
    }
  }
  return { elements, ecritures, demandesAClore, erreurs, avertissements };
}

// ——— Textes échangés avec le Projet Claude ———

/** Texte copié par « Demander à Claude » pour une recette à ajouter (CLAUDE.md §8). */
export function texteDemandeRecette(plat) {
  return [
    `DEMANDE-RECETTE ${FORMAT}`,
    `id: ${plat.id}`,
    `nom: ${plat.nom}`,
    '(Ajoute un lien, une photo ou la recette dictée.)',
  ].join('\n');
}

/**
 * Texte copié par « Copier les corrections pour Claude ».
 * `probleme` : { erreur } (texte illisible) ou résultat de validerPaquet / preparerImport ({ plats?, erreurs }).
 */
export function texteCorrectionPourClaude(probleme) {
  const lignes = [`CORRECTION ${FORMAT}`];
  if (probleme?.erreur) {
    lignes.push(probleme.erreur === 'coupee'
      ? '- La réponse précédente est coupée ou illisible : la fiche n’a pas pu être lue.'
      : '- Aucune fiche lisible dans la réponse précédente.');
  } else {
    for (const erreur of probleme?.erreurs ?? []) lignes.push(`- ${erreur.pourClaude}`);
    for (const plat of probleme?.plats ?? []) {
      if (!plat.erreurs.length) continue;
      if (plat.id) lignes.push(`id: ${plat.id}`);
      for (const erreur of plat.erreurs) lignes.push(`- ${erreur.pourClaude}`);
    }
  }
  lignes.push('(Rends la fiche complète corrigée, en un seul bloc.)');
  return lignes.join('\n');
}
