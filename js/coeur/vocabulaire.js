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
  marqueurs: ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie', 'poisson', 'fruits_de_mer',
    'bouillon_viande', 'gelatine_porc', 'oeuf', 'oeuf_cru', 'laitier', 'alcool_cru', 'cafe', 'legume', 'feculent',
    'graisse_animale', 'gelatine_animale'],
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
 * Marqueurs impliqués par un autre, appliqués à la lecture (compatibilite.js › marqueursEffectifs), jamais écrits
 * dans les fiches : une fiche marquée `gelatine_porc` reste juste sans être réécrite. `cafeine` sert à T2c.
 */
export const IMPLICATIONS = { gelatine_porc: ['gelatine_animale'], cafe: ['cafeine'] };

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

/** « `a`, `b`, `c` » : valeurs permises, recopiées pour Claude. */
export const liste = (valeurs) => valeurs.map((v) => `\`${v}\``).join(', ');

// ——— Validation d'un ingrédient ———

/**
 * Ingrédient d'une recette (`qte`) ou d'une variante (`qtePortion`). → l'ingrédient propre, ou null (erreurs
 * signalées par `signaler(message, pourClaude)` ; `inconnu()` appelé si un champ n'est pas reconnu).
 * `position` : { affiche, claude } (où se trouve l'ingrédient, pour les messages).
 */
export function validerIngredient(brut, { position, champQte, signaler, inconnu }) {
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
