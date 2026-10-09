// Vocabulaires fermés du format « paquet@1 » (CLAUDE.md §8) et validation d'un ingrédient. Module feuille : il
// n'importe que slug.js, pour que paquet.js, compatibilite.js et regles.js puissent tous s'en servir sans cycle.
// Logique pure : ni DOM ni Firebase.
import { sansAccents } from './slug.js';

export const VOCABULAIRES = {
  type: ['plat', 'dessert', 'accompagnement', 'preparation', 'apero'],
  recurrence: ['aucune', 'hebdo'],
  statutRecette: ['attente', 'brouillon', 'validee'],
  unite: ['g', 'kg', 'ml', 'cl', 'l', 'pc', 'cs', 'cc', 'pincee', 'botte', 'sachet', 'boite', 'tranche'],
  rayon: ['fruits_legumes', 'boucherie', 'charcuterie', 'poissonnerie', 'cremerie', 'fromages', 'epicerie_salee',
    'epicerie_sucree', 'boulangerie', 'surgeles', 'boissons', 'hygiene', 'entretien', 'divers'],
  // T2a : `graisse_animale` (saindoux, graisse de canard ou d'oie, suif ; jamais le beurre ni la crème) et
  // `gelatine_animale` (toute gélatine animale, feuilles ou poudre ; l'agar-agar ne porte rien).
  // T2c (précautions d'un jeune enfant, coeur/age.js) : `cru` (viande, charcuterie, poisson ou fruits de mer servis
  // crus ou peu cuits), `lait_cru`, `fruit_coque` (entiers ou en morceaux), `cafeine` (thé, cola… ; `cafe` l'implique),
  // `miel`, `poisson_predateur` (espadon, requin, marlin ; implique `poisson`), `soja` (jamais la sauce soja). Le
  // vocabulaire ne fait que s'agrandir : une fiche ou une sauvegarde d'avant reste valide.
  marqueurs: ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie', 'poisson', 'fruits_de_mer',
    'bouillon_viande', 'gelatine_porc', 'oeuf', 'oeuf_cru', 'laitier', 'alcool_cru', 'cafe', 'legume', 'feculent',
    'graisse_animale', 'gelatine_animale', 'cru', 'lait_cru', 'fruit_coque', 'cafeine', 'miel', 'poisson_predateur',
    'soja'],
  appareil: ['plaque', 'four', 'cookeo', 'airfryer', 'monsieur_cuisine'],
  forme: ['hachee', 'fine', 'morceaux', 'effilochable'],
  role: ['principal', 'incorpore'],
};

/** Styles d'une version (variante) : mer (poisson ou fruits de mer), vegetal (végétarienne : œufs et fromage permis). */
export const STYLES = ['mer', 'vegetal'];
export const LIBELLES_STYLE = { mer: 'mer', vegetal: 'végétale' };
export const EMOJIS_STYLE = { mer: '🐟', vegetal: '🌿' };

/** Sous-types de viande : chacun implique `viande` (CLAUDE.md §7). */
export const SOUS_TYPES_VIANDE = ['boeuf', 'porc', 'volaille', 'agneau', 'charcuterie'];
export const VIANDES = ['viande', ...SOUS_TYPES_VIANDE];

/**
 * Marqueurs impliqués par un autre, appliqués à la lecture (marqueursEffectifs), jamais écrits dans les fiches : une
 * fiche marquée `gelatine_porc` reste juste sans être réécrite. `cafe` vaut aussi `cafeine` (précautions de l'enfant,
 * T2c) ; `poisson_predateur` vaut aussi `poisson`, même si le repère `poisson` a été oublié.
 */
export const IMPLICATIONS = { gelatine_porc: ['gelatine_animale'], cafe: ['cafeine'], poisson_predateur: ['poisson'] };

// ——— Repères de précaution (T2c-2, T2d) ———

/**
 * Cases « Repères » de « Modifier » › un ingrédient › « Plus de précisions ». Cocher ajoute `pose` ; décocher retire
 * tout `retire` (« Café, thé, cola » enlève aussi l'ancien `cafe`, « Gélatine animale » aussi `gelatine_porc`).
 * `natures` : natures d'ingrédient (edition.js › NATURES) sous lesquelles la case est proposée, si une règle la
 * surveille. Libellés de 26 caractères au plus. Déplacé ici depuis edition.js (T2d) pour que relecture.js, claude.js
 * et compatibilite.js s'en servent sans cycle ; edition.js les réexporte.
 */
export const CASES_REPERES = [
  { id: 'cru_viande', libelle: 'Crue ou rosée', pose: ['cru'], retire: ['cru'], natures: ['viande'] },
  { id: 'cru_poisson', libelle: 'Cru', pose: ['cru'], retire: ['cru'], natures: ['poisson'] },
  { id: 'poisson_predateur', libelle: 'Espadon, requin, marlin', pose: ['poisson_predateur'], retire: ['poisson_predateur'], natures: ['poisson'] },
  { id: 'lait_cru', libelle: 'Au lait cru', pose: ['lait_cru'], retire: ['lait_cru'], natures: ['autre'] },
  { id: 'fruit_coque', libelle: 'Fruits à coque entiers', pose: ['fruit_coque'], retire: ['fruit_coque'], natures: ['autre'] },
  { id: 'cafeine', libelle: 'Café, thé, cola', pose: ['cafeine'], retire: ['cafe', 'cafeine'], natures: ['autre'] },
  { id: 'alcool_cru', libelle: 'Alcool non cuit', pose: ['alcool_cru'], retire: ['alcool_cru'], natures: ['autre'] },
  { id: 'oeuf_cru', libelle: 'Œuf cru ou peu cuit', pose: ['oeuf_cru'], retire: ['oeuf_cru'], natures: ['autre'] },
  { id: 'miel', libelle: 'Miel', pose: ['miel'], retire: ['miel'], natures: ['autre'] },
  { id: 'soja', libelle: 'Soja', pose: ['soja'], retire: ['soja'], natures: ['autre'] },
  { id: 'bouillon_viande', libelle: 'Bouillon de viande', pose: ['bouillon_viande'], retire: ['bouillon_viande'], natures: ['autre'] },
  { id: 'gelatine', libelle: 'Gélatine animale', pose: ['gelatine_animale'], retire: ['gelatine_animale', 'gelatine_porc'], natures: ['autre'] },
  { id: 'graisse_animale', libelle: 'Graisse animale', pose: ['graisse_animale'], retire: ['graisse_animale'], natures: ['autre', 'viande'] },
];

/** Marqueurs que les cases peuvent retirer (union des `retire`, dans l'ordre des cases) : repères relus par Claude (T2d). */
export const MARQUEURS_PRECAUTION = [...new Set(CASES_REPERES.flatMap((c) => c.retire))];

/**
 * Version des repères relus (`plats/{id}.reperesRelus`, T2d) : une recette marquée d'un entier inférieur, ou sans
 * marque, est à relire. Passe à 2 si de nouveaux repères de précaution s'ajoutent un jour.
 */
export const VERSION_REPERES = 1;

/** Vrai si Claude a relu les repères de précaution de la recette (marque posée par l'app, T2d). */
export function estRelue(plat) {
  return Number.isInteger(plat?.reperesRelus) && plat.reperesRelus >= VERSION_REPERES;
}

// Ce qu'un repère `cru` doit accompagner pour avoir un effet (marqueurs effectifs).
const CRUS_POSSIBLES = ['viande', 'poisson', 'fruits_de_mer'];

const CHAMPS_INGREDIENT = ['produit', 'qte', 'qtePortion', 'unite', 'rayon', 'marqueurs', 'forme', 'role'];

// ——— Valeurs tolérées ———

/** Valeur comparable aux vocabulaires fermés : « Incorporé » → incorpore, « fruits & légumes » → fruits_legumes. */
export function code(valeur) {
  if (typeof valeur !== 'string') return '';
  return sansAccents(valeur).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Nombre, y compris écrit en texte (« 450 », « 0,5 ») ; NaN sinon. */
export function nombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : NaN;
  if (typeof valeur !== 'string') return NaN;
  const propre = valeur.trim().replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(propre) ? Number(propre) : NaN;
}

/** Texte sur une ligne, espaces réduits ; '' si ce n'est pas un texte. */
export function texte(valeur) {
  return typeof valeur === 'string' ? valeur.replace(/\s+/g, ' ').trim() : '';
}

export const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);

const textes = (valeurs) => (Array.isArray(valeurs) ? valeurs.filter((v) => typeof v === 'string' && v !== '') : []);

/** « `a`, `b`, `c` » : valeurs permises, recopiées pour Claude. */
export const liste = (valeurs) => valeurs.map((v) => `\`${v}\``).join(', ');

// ——— Marqueurs effectifs ———

/**
 * Marqueurs d'un ingrédient, plus ceux qu'ils impliquent : `viande` pour un sous-type, `gelatine_animale` pour
 * `gelatine_porc`, `cafeine` pour `cafe`, `poisson` pour `poisson_predateur`. Déplacé ici depuis compatibilite.js
 * (qui le réexporte) pour que coeur/age.js s'en serve sans importer compatibilite.js.
 */
export function marqueursEffectifs(ingredient) {
  const marqueurs = new Set(textes(ingredient?.marqueurs));
  for (const marqueur of [...marqueurs]) {
    if (SOUS_TYPES_VIANDE.includes(marqueur)) marqueurs.add('viande');
    if (Object.hasOwn(IMPLICATIONS, marqueur)) for (const implique of IMPLICATIONS[marqueur]) marqueurs.add(implique);
  }
  return marqueurs;
}

// ——— Validation d'un ingrédient ———

/**
 * Ingrédient d'une recette (`qte`) ou d'une variante (`qtePortion`). → l'ingrédient propre, ou null (erreurs
 * signalées par `signaler(message, pourClaude)` ; `inconnu()` appelé si un champ n'est pas reconnu).
 * `position` : { affiche, claude } (où se trouve l'ingrédient, pour les messages).
 * `prevenir(message, pourClaude)` (facultatif) : avertissements, jamais bloquants (T2c) : `cru` sans viande, poisson
 * ni fruits de mer (le repère est sans effet) ; `poisson_predateur` sans le repère `poisson`. Aucune erreur nouvelle :
 * une fiche ou une sauvegarde valide le reste.
 */
export function validerIngredient(brut, { position, champQte, signaler, inconnu, prevenir = null }) {
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
  if (typeof prevenir === 'function' && nomProduit) {
    const avertir = (message, pourClaude) => prevenir(`${position.affiche}\u00A0: ${message}`, `${claude} : ${pourClaude}`);
    const effectifs = marqueursEffectifs({ marqueurs });
    if (marqueurs.includes('cru') && !CRUS_POSSIBLES.some((m) => effectifs.has(m))) {
      avertir(`«\u00A0${nomProduit}\u00A0» est marqué cru sans être une viande ni un poisson\u00A0: le repère est sans effet.`,
        '`cru` sans `viande`, `poisson` ni `fruits_de_mer` : repère sans effet');
    }
    if (marqueurs.includes('poisson_predateur') && !marqueurs.includes('poisson')) {
      avertir(`«\u00A0${nomProduit}\u00A0» est un poisson\u00A0: ajoutez aussi le repère poisson.`,
        '`poisson_predateur` sans `poisson` : ajoute aussi `poisson`');
    }
  }

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

// Mots affichés des repères sans case « Repères » (natures et familles d'ingrédients) : jamais le code brut à l'écran.
const LIBELLES_MARQUEURS = {
  viande: 'viande', boeuf: 'bœuf', porc: 'porc', volaille: 'volaille', agneau: 'agneau', charcuterie: 'charcuterie',
  poisson: 'poisson', fruits_de_mer: 'fruits de mer', oeuf: 'œuf', laitier: 'laitier', legume: 'légume', feculent: 'féculent',
};

/**
 * Libellé d'un repère, en minuscules : pour un repère de précaution, celui de la case de « Modifier » (« au lait cru »,
 * « café, thé, cola » pour `cafe` comme pour `cafeine`, « gélatine animale » pour `gelatine_porc` aussi ; `cru` :
 * « crue ou rosée » sur une viande, « cru » ailleurs) ; pour un autre repère, son mot (« légume », « œuf », « fruits de
 * mer ») ; un code inconnu, sans tiret bas.
 */
export function libelleRepere(marqueur, ingredient = null) {
  if (marqueur === 'cru') {
    return marqueursEffectifs(ingredient).has('viande') ? 'crue ou rosée' : 'cru';
  }
  const definition = CASES_REPERES.find((d) => d.pose.includes(marqueur))
    ?? CASES_REPERES.find((d) => d.retire.includes(marqueur));
  if (definition) return definition.libelle.toLocaleLowerCase('fr-FR');
  return Object.hasOwn(LIBELLES_MARQUEURS, marqueur ?? '') ? LIBELLES_MARQUEURS[marqueur] : String(marqueur ?? '').replace(/_/g, ' ');
}
