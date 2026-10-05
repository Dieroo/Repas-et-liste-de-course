// Plats : visuel, filtres, ajout par nom, affichage des quantités. Logique pure.
import { slug, correspond } from './slug.js';

export const LIBELLES_TYPE = {
  plat: 'Plat',
  dessert: 'Dessert',
  accompagnement: 'Accompagnement',
  preparation: 'Préparation',
  apero: 'Apéro',
};

export const STATUTS = {
  attente: { emoji: '⏳', libelle: 'Recette à ajouter' },
  brouillon: { emoji: '📝', libelle: 'Recette à vérifier' },
  validee: { emoji: '✅', libelle: 'Recette validée' },
};

export const FILTRES = [
  { id: 'tous', libelle: 'Tous' },
  { id: 'plat', libelle: 'Plats' },
  { id: 'dessert', libelle: 'Desserts' },
  { id: 'apero', libelle: 'Apéro' },
  { id: 'attente', libelle: '⏳ À compléter' },
];

export const NOM_MAX = 80;

// Visuel d'un plat sans photo : grand emoji sur pastille teintée (CLAUDE.md §4).
const VISUELS = {
  mijote: { emoji: '🍲', teinte: '' },
  poisson: { emoji: '🐟', teinte: 'bleu' },
  gratin: { emoji: '🥧', teinte: 'ocre' },
  pates: { emoji: '🍝', teinte: 'ocre' },
  dessert: { emoji: '🍰', teinte: '' },
  apero: { emoji: '🥂', teinte: 'olive' },
  accompagnement: { emoji: '🥗', teinte: 'olive' },
  preparation: { emoji: '🫙', teinte: 'bleu' },
};

const MOTS_GRATIN = /\b(gratin|gratine|tarte|tartes|quiche|tourte|clafoutis sale|parmentier|moussaka)\b/;
const MOTS_PATES = /\b(pates|spaghetti|spaghettis|tagliatelle|tagliatelles|penne|macaroni|macaronis|lasagne|lasagnes|ravioli|raviolis|gnocchi|gnocchis|coquillettes|fusilli|linguine|nouilles|cannelloni|cannellonis)\b/;
const MOTS_POISSON = /\b(poisson|saumon|cabillaud|colin|thon|truite|sardine|sardines|maquereau|lieu|merlu|dorade|bar|crevette|crevettes|moules|crabe|calamar|calamars|seiche|fruits de mer)\b/;

/** Catégorie visuelle : d'abord le type, puis la forme du plat, puis le poisson, sinon « mijoté ». */
export function categorieDuPlat(plat) {
  const type = plat?.type ?? 'plat';
  if (type !== 'plat') return VISUELS[type] ? type : 'mijote';
  const nom = slug(plat?.nom).replace(/-/g, ' ');
  if (MOTS_GRATIN.test(nom)) return 'gratin';
  if (MOTS_PATES.test(nom)) return 'pates';
  const marqueurs = (plat?.ingredients ?? []).flatMap((i) => i?.marqueurs ?? []);
  if (marqueurs.includes('poisson') || marqueurs.includes('fruits_de_mer') || MOTS_POISSON.test(nom)) return 'poisson';
  return 'mijote';
}

export function visuelDuPlat(plat) {
  return VISUELS[categorieDuPlat(plat)];
}

const comparer = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

/** Plats correspondant à la recherche et au filtre, triés par nom. */
export function filtrerPlats(plats, { recherche = '', filtre = 'tous' } = {}) {
  return (plats ?? [])
    .filter((plat) => {
      if (filtre === 'attente') return plat.statutRecette === 'attente';
      if (filtre !== 'tous') return (plat.type ?? 'plat') === filtre;
      return true;
    })
    .filter((plat) => correspond(plat.nom, recherche))
    .sort((a, b) => comparer(a.nom ?? '', b.nom ?? ''));
}

/**
 * Plat créé à partir de son seul nom (statut ⏳).
 * → { plat } ou { erreur, existant? } (existant : id du plat qui porte déjà ce nom).
 */
export function nouveauPlatParNom(nom, plats = []) {
  const propre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  if (!propre) return { erreur: 'Donnez un nom au plat.' };
  if (propre.length > NOM_MAX) return { erreur: `Le nom est trop long (${NOM_MAX} caractères au plus).` };
  const id = slug(propre);
  if (!id) return { erreur: 'Ce nom ne contient ni lettre ni chiffre.' };
  const existant = plats.find((plat) => plat.id === id);
  if (existant) return { erreur: `« ${existant.nom} » existe déjà.`, existant: id };
  return {
    plat: {
      id,
      nom: propre,
      type: 'plat',
      recurrence: 'aucune',
      statutRecette: 'attente',
      ingredients: [],
      etapes: [],
      notes: {},
    },
  };
}

/** Demande de recette créée quand l'autre membre ajoute un plat par son nom (CLAUDE.md §7). */
export function demandeDeRecette(platId, auteur) {
  return {
    id: `${platId}__recette`,
    donnees: { type: 'recette', platId, creePar: auteur, statut: 'ouverte' },
  };
}

const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

const UNITES = {
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  cl: ['cl', 'cl'],
  l: ['l', 'l'],
  pc: ['', ''],
  cs: ['c. à soupe', 'c. à soupe'],
  cc: ['c. à café', 'c. à café'],
  pincee: ['pincée', 'pincées'],
  botte: ['botte', 'bottes'],
  sachet: ['sachet', 'sachets'],
  boite: ['boîte', 'boîtes'],
  tranche: ['tranche', 'tranches'],
};

/** « 400 g », « 2 tranches », « 1 » (pièce) ; « » si la quantité manque. */
export function quantiteLisible(qte, unite) {
  if (typeof qte !== 'number' || !Number.isFinite(qte)) return '';
  const [singulier, pluriel] = UNITES[unite] ?? [unite ?? '', unite ?? ''];
  const mot = qte > 1 ? pluriel : singulier;
  return mot ? `${nombre.format(qte)}\u00A0${mot}` : nombre.format(qte);
}

const APPAREILS = {
  plaque: 'Plaque',
  four: 'Four',
  cookeo: 'Cookeo',
  airfryer: 'Airfryer',
  monsieur_cuisine: 'Monsieur Cuisine',
};

/** « Four · 200 °C · 20 min · chaleur tournante » */
export function cuissonLisible(cuisson) {
  const morceaux = [APPAREILS[cuisson?.appareil] ?? cuisson?.appareil ?? 'Cuisson'];
  if (typeof cuisson?.tempC === 'number') morceaux.push(`${cuisson.tempC}\u00A0°C`);
  if (typeof cuisson?.dureeMin === 'number') morceaux.push(`${cuisson.dureeMin}\u00A0min`);
  if (cuisson?.mode) morceaux.push(String(cuisson.mode));
  return morceaux.join(' · ');
}
