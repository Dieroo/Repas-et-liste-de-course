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
  validee: { emoji: '✅', libelle: 'Recette vérifiée' },
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

// ——— Plats à adapter pour un profil (T2a) ———
// Le filtre commun vit ici, module sans dépendance : compatibilite.js (bilan, versions à créer) et la liste des
// plats (filtre « ❌ Versions à créer ») comptent ainsi toujours les mêmes plats.

/** Types concernés par les versions : ni apéro (fiches compatibles avec tous, §9.5), ni préparation. */
export const TYPES_A_ADAPTER = ['plat', 'accompagnement', 'dessert'];

/** Vrai si le plat a ses ingrédients (un plat ⏳ n'en a pas). */
export function aSaRecette(plat) {
  return Array.isArray(plat?.ingredients) && plat.ingredients.length > 0;
}

/**
 * Vrai si le plat compte dans le bilan d'un profil : type plat, accompagnement ou dessert, recette remplie, et pas
 * noté « Jamais » par ce profil.
 */
export function compteDansLeBilan(plat, profil) {
  if (!plat || typeof plat !== 'object' || !TYPES_A_ADAPTER.includes(typeDe(plat)) || !aSaRecette(plat)) return false;
  const notes = plat.notes && typeof plat.notes === 'object' ? plat.notes : {};
  return !(typeof profil?.id === 'string' && Object.hasOwn(notes, profil.id) && notes[profil.id] === 0);
}

/** Vrai si le plat attend une version pour ce profil, d'après `resultat` (compatibilite.js › evaluer). */
export function aAdapterSelon(plat, profil, resultat) {
  return compteDansLeBilan(plat, profil) && Boolean(resultat?.aCreer || resultat?.aRevoir);
}

/**
 * Vrai si le plat est à compléter pour ce profil, d'après `resultat` (compatibilite.js › evaluer) : une de ses
 * versions convient, mais il manque celle d'un style attendu (« Pas de viande » : mer et végétale). Mêmes plats que
 * aAdapterSelon (type, recette, pas « Jamais »).
 */
export function aCompleterSelon(plat, profil, resultat) {
  return compteDansLeBilan(plat, profil) && Boolean(resultat?.aCompleter);
}

// ——— Filtres de la liste ———

/**
 * Filtres de la liste des plats : les cinq de toujours, puis « 🌿 Pour <Prénom> » par profil contraint (« 🌿 Pour
 * moi » pour `moi`), puis, pour le gestionnaire seul, « ❌ Versions à créer » (à créer, à revoir ou à compléter).
 * `profils` : profils contraints, dans l'ordre d'affichage (compatibilite.js › profilsContraints). `role` : rôle
 * effectif.
 * → [{ id, libelle, profil? (filtre « pour »), profils? (« Versions à créer ») }]
 */
export function filtresPour(profils, { moi = null, role = null } = {}) {
  const contraints = (Array.isArray(profils) ? profils : [])
    .filter((p) => p && typeof p.id === 'string' && p.id !== '');
  const filtres = FILTRES.map((f) => ({ ...f }));
  for (const profil of contraints) {
    const estMoi = Boolean(moi) && moi.id === profil.id;
    const nom = String(profil.nom ?? '').replace(/\s+/g, ' ').trim() || 'Sans prénom';
    filtres.push({ id: `pour-${profil.id}`, libelle: estMoi ? '🌿 Pour moi' : `🌿 Pour ${nom}`, profil });
  }
  if (role === 'gestionnaire' && contraints.length) {
    filtres.push({ id: 'a-creer', libelle: '❌ Versions à créer', profils: contraints });
  }
  return filtres;
}

/** Filtre retenu parmi `filtres` (filtresPour) pour un identifiant mémorisé ; « Tous » s'il n'existe plus. */
export function filtreRetenu(filtres, id) {
  const liste = Array.isArray(filtres) ? filtres : [];
  return liste.find((f) => f?.id === id) ?? liste.find((f) => f?.id === 'tous') ?? FILTRES[0];
}

/**
 * Plats correspondant à la recherche et au filtre, triés par nom. `filtre` : identifiant (« tous », « plat »…) ou
 * filtre de filtresPour. Les filtres « pour » et « à créer » demandent `evaluer(plat, profil)` (résultat de
 * compatibilite.js › evaluer) ; sans lui, ou sans son profil, tous les plats sont gardés. « À créer » garde les plats
 * à créer, à revoir ou à compléter pour au moins un des profils du filtre.
 */
export function filtrerPlats(plats, { recherche = '', filtre = 'tous', evaluer = null } = {}) {
  const choisi = filtre && typeof filtre === 'object' ? filtre : { id: filtre };
  const id = choisi.id ?? 'tous';
  const peutEvaluer = typeof evaluer === 'function';
  return (plats ?? [])
    .filter((plat) => {
      if (choisi.profil && peutEvaluer) {
        if (!aSaRecette(plat)) return false;
        const niveau = evaluer(plat, choisi.profil)?.niveau;
        return niveau === 'ok' || niveau === 'adaptable';
      }
      if (Array.isArray(choisi.profils) && peutEvaluer) {
        return choisi.profils.some((profil) => {
          const resultat = evaluer(plat, profil);
          return aAdapterSelon(plat, profil, resultat) || aCompleterSelon(plat, profil, resultat);
        });
      }
      if (id === 'attente') return statutDe(plat) === 'attente';
      // Filtre « pour » ou « à créer » sans son profil (profil disparu, ou réservé au gestionnaire) : « Tous ».
      if (id === 'tous' || id === 'a-creer' || String(id).startsWith('pour-')) return true;
      return typeDe(plat) === id;
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
  const [singulier, pluriel] = Object.hasOwn(UNITES, unite ?? '') ? UNITES[unite] : [unite ?? '', unite ?? ''];
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
