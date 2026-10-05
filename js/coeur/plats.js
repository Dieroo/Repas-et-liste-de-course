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

// Mots au singulier ; le « s » (ou « x ») du pluriel est accepté.
const MOTS_GRATIN = /\b(gratin|gratine|tarte|quiche|tourte|clafouti sale|parmentier|moussaka)[sx]?\b/;
const MOTS_PATES = /\b(pate|spaghetti|tagliatelle|penne|macaroni|lasagne|ravioli|gnocchi|coquillette|fusilli|linguine|nouille|cannelloni)s?\b/;
const MOTS_POISSON = /\b(poisson|saumon|cabillaud|colin|thon|truite|sardine|maquereau|lieu|merlu|dorade|bar|crevette|moule|crabe|calamar|seiche|fruits de mer)[sx]?\b/;

/** Type d'un plat ; « plat » par défaut (plat ajouté par son nom). */
export function typeDe(plat) {
  return plat?.type ?? 'plat';
}

/** Statut de la recette ; ⏳ par défaut (plat ajouté par son nom, sans recette). */
export function statutDe(plat) {
  return STATUTS[plat?.statutRecette] ? plat.statutRecette : 'attente';
}

/** Catégorie visuelle : d'abord le type, puis la forme du plat, puis le poisson, sinon « mijoté ». */
export function categorieDuPlat(plat) {
  const type = typeDe(plat);
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
      if (filtre === 'attente') return statutDe(plat) === 'attente';
      if (filtre !== 'tous') return typeDe(plat) === filtre;
      return true;
    })
    .filter((plat) => correspond(plat.nom, recherche))
    .sort((a, b) => comparer(a.nom ?? '', b.nom ?? ''));
}

/**
 * Plat créé à partir de son seul nom : { id, nom } seulement. Les champs absents valent leurs valeurs par
 * défaut (type « plat », statut ⏳) : l'enregistrement, fusionné, ne peut ainsi jamais écraser une recette
 * ajoutée entre-temps sur l'autre téléphone.
 * → { plat } ou { erreur, existant? } (existant : id du plat qui porte déjà ce nom).
 */
export function nouveauPlatParNom(nom, plats = []) {
  const propre = String(nom ?? '').replace(/\s+/g, ' ').trim();
  if (!propre) return { erreur: 'Donnez un nom au plat.' };
  if (propre.length > NOM_MAX) return { erreur: `Le nom est trop long (${NOM_MAX} caractères au plus).` };
  const base = slug(propre);
  if (!base) return { erreur: 'Ce nom ne contient ni lettre ni chiffre.' };
  const existant = plats.find((plat) => slug(plat.nom) === base);
  if (existant) return { erreur: `«\u00A0${existant.nom}\u00A0» existe déjà.`, existant: existant.id };
  const pris = new Set(plats.map((plat) => plat.id));
  let id = base;
  for (let n = 2; pris.has(id); n += 1) id = `${base}-${n}`;
  return { plat: { id, nom: propre } };
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

export const APPAREILS = {
  plaque: 'Plaque',
  four: 'Four',
  cookeo: 'Cookeo',
  airfryer: 'Airfryer',
  monsieur_cuisine: 'Monsieur Cuisine',
};

/**
 * Étape de cuisson principale : la plus longue (la première en cas d'égalité). Son appareil donne le pictogramme
 * du plat. → { appareil, dureeMin } ou null (pas de cuisson, ou appareil inconnu).
 */
export function cuissonPrincipale(plat) {
  let principale = null;
  for (const cuisson of Array.isArray(plat?.cuisson) ? plat.cuisson : []) {
    if (!Object.hasOwn(APPAREILS, cuisson?.appareil ?? '')) continue;
    const duree = typeof cuisson.dureeMin === 'number' && Number.isFinite(cuisson.dureeMin) ? cuisson.dureeMin : 0;
    if (!principale || duree > principale.dureeMin) principale = { appareil: cuisson.appareil, dureeMin: duree };
  }
  return principale;
}

/** « Four · 200 °C · 20 min · chaleur tournante » */
export function cuissonLisible(cuisson) {
  const morceaux = [APPAREILS[cuisson?.appareil] ?? cuisson?.appareil ?? 'Cuisson'];
  if (typeof cuisson?.tempC === 'number') morceaux.push(`${cuisson.tempC}\u00A0°C`);
  if (typeof cuisson?.dureeMin === 'number') morceaux.push(`${cuisson.dureeMin}\u00A0min`);
  if (cuisson?.mode) morceaux.push(String(cuisson.mode));
  return morceaux.join(' · ');
}
