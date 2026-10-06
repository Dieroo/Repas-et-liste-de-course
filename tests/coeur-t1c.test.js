import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuissonPrincipale, APPAREILS, STATUTS } from '../js/coeur/plats.js';
import { VOCABULAIRES, validerPaquet } from '../js/coeur/paquet.js';
import {
  UNITES_EDITION, LIBELLES_UNITE, LIBELLES_RAYON, LIBELLES_FORME, LIBELLES_ROLE, NATURES,
  PORTIONS_MAX, FRIGO_JOURS_MAX, DUREE_MAX, QTE_MAX,
  natureDe, appliquerNature, catalogueProduits, suggestions, produitConnu, ingredientSaisi,
  normaliserPourEdition, egalProfonde, deplacer, ajouterEtape,
  indexCuissonPrincipale, changerCuissonPrincipale, preparerModification, brouillonValide,
} from '../js/coeur/edition.js';

// ——— plats.js : mode de cuisson principal ———

test('cuissonPrincipale : l’étape la plus longue donne l’appareil', () => {
  const gratin = { cuisson: [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, dureeMin: 20 }] };
  assert.deepEqual(cuissonPrincipale(gratin), { appareil: 'four', dureeMin: 20 });
});

test('cuissonPrincipale : en cas d’égalité, la première étape', () => {
  const plat = { cuisson: [{ appareil: 'cookeo', dureeMin: 15 }, { appareil: 'plaque', dureeMin: 15 }] };
  assert.equal(cuissonPrincipale(plat).appareil, 'cookeo');
});

test('cuissonPrincipale : durée absente comptée 0, une étape seule suffit', () => {
  assert.deepEqual(cuissonPrincipale({ cuisson: [{ appareil: 'airfryer' }] }), { appareil: 'airfryer', dureeMin: 0 });
  const plat = { cuisson: [{ appareil: 'plaque' }, { appareil: 'four', dureeMin: 5 }] };
  assert.equal(cuissonPrincipale(plat).appareil, 'four');
});

test('cuissonPrincipale : null sans cuisson ou avec un appareil inconnu', () => {
  assert.equal(cuissonPrincipale({}), null);
  assert.equal(cuissonPrincipale(null), null);
  assert.equal(cuissonPrincipale({ cuisson: [] }), null);
  assert.equal(cuissonPrincipale({ cuisson: 'four' }), null);
  assert.equal(cuissonPrincipale({ cuisson: [{ appareil: 'barbecue', dureeMin: 30 }] }), null);
  assert.equal(cuissonPrincipale({ cuisson: [{ appareil: 'toString', dureeMin: 30 }, null] }), null);
});

test('cuissonPrincipale : un appareil inconnu n’empêche pas de trouver le connu', () => {
  const plat = { cuisson: [{ appareil: 'barbecue', dureeMin: 60 }, { appareil: 'plaque', dureeMin: 10 }] };
  assert.deepEqual(cuissonPrincipale(plat), { appareil: 'plaque', dureeMin: 10 });
});

test('APPAREILS : un nom affiché pour chaque appareil du format d’import', () => {
  assert.deepEqual(Object.keys(APPAREILS).sort(), ['airfryer', 'cookeo', 'four', 'monsieur_cuisine', 'plaque']);
});

test('STATUTS : « Recette vérifiée », le code reste validee', () => {
  assert.equal(STATUTS.validee.libelle, 'Recette vérifiée');
  assert.equal(STATUTS.validee.emoji, '✅');
  assert.deepEqual(Object.keys(STATUTS), VOCABULAIRES.statutRecette);
});

// ——— edition.js : fixtures génériques (aucune donnée du foyer) ———

const RISOTTO = {
  id: 'risotto-test',
  nom: 'Risotto test',
  type: 'plat',
  recurrence: 'aucune',
  statutRecette: 'brouillon',
  portionsBase: 6,
  ingredients: [
    { produit: 'riz arborio', qte: 450, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'pavé de saumon', qte: 600, unite: 'g', rayon: 'poissonnerie', marqueurs: ['poisson'] },
    { produit: 'oignon jaune', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    { produit: 'beurre', qte: 30, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] },
  ],
  etapes: ['Faire revenir l’oignon.', 'Ajouter le riz.', 'Cuire sous pression.'],
  cuisson: [{ appareil: 'cookeo', mode: 'sous pression', dureeMin: 15 }],
  tempsActifMin: 15,
  conservation: { frigoJours: 2, congelable: false },
  emporter: false,
  variantes: [],
  source: 'Version classique',
  notes: { 'profil-a': 4 },
  majPar: 'membre@example.com',
};

const GRATIN = {
  id: 'gratin-test',
  nom: 'Gratin test',
  type: 'plat',
  statutRecette: 'validee',
  portionsBase: 4,
  ingredients: [
    { produit: 'pâtes courtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'jambon blanc', qte: 4, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'fine' },
    { produit: 'oignon jaune', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    { produit: 'beurre', qte: 20, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] },
  ],
  etapes: ['Cuire les pâtes.', 'Gratiner.'],
  cuisson: [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, dureeMin: 20 }],
  conservation: { frigoJours: 3, congelable: true },
  emporter: true,
  variantes: [{
    pour: 'profil-b',
    retirer: ['jambon blanc'],
    ajouter: [{ produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] }],
    consigne: 'Prélever sa part avant le jambon.',
  }],
};

// Plat ajouté par son nom : identifiant et nom seulement (⏳).
const SOUPE = { id: 'soupe-test', nom: 'Soupe test' };

const PLATS = [RISOTTO, GRATIN, SOUPE];
const REGLAGES = { frigoJoursDefaut: 3 };

const clone = (valeur) => JSON.parse(JSON.stringify(valeur));

/** Aucune valeur undefined, à aucune profondeur (le vrai Firestore les refuse). */
function sansUndefined(valeur, chemin = 'racine') {
  if (valeur === undefined) assert.fail(`undefined à ${chemin}`);
  if (Array.isArray(valeur)) valeur.forEach((v, i) => sansUndefined(v, `${chemin}[${i}]`));
  else if (valeur && typeof valeur === 'object') for (const [cle, v] of Object.entries(valeur)) sansUndefined(v, `${chemin}.${cle}`);
}

// Aucun mot technique ni code de vocabulaire dans un message affiché.
const INTERDITS = /paquet|slug|json|\bIA\b|undefined|null|NaN|`|[{}[\]_]/i;
// Codes qui ne sont pas des mots français (« cuisson », « nature »… le sont).
const CODES = /\b(pc|cs|cc|pincee|boite|hachee|effilochable|incorpore|validee|portionsBase|ingredients|etapes|frigoJours|congelable|emporter|verifiee|statutRecette|dureeMin|qte|unite|marqueurs|tempC)\b/;

function messagesPropres(messages) {
  assert.ok(messages.length > 0);
  for (const message of messages) {
    assert.equal(typeof message, 'string');
    assert.doesNotMatch(message, INTERDITS, message);
    assert.doesNotMatch(message, CODES, message);
    assert.doesNotMatch(message, /\u00A0{2}| {2}/, message);
  }
}

/** Modèle d'édition du plat, après une modification de la saisie. */
function modifier(plat, changer, reglages = REGLAGES) {
  const base = normaliserPourEdition(plat, reglages);
  const saisie = clone(base);
  changer(saisie);
  return { base, saisie };
}

// ——— edition.js : libellés ———

test('libellés : chaque vocabulaire du format d’import est couvert exactement', () => {
  const memes = (libelles, vocabulaire) => assert.deepEqual(Object.keys(libelles).sort(), [...vocabulaire].sort());
  memes(LIBELLES_UNITE, VOCABULAIRES.unite);
  memes(LIBELLES_RAYON, VOCABULAIRES.rayon);
  memes(LIBELLES_FORME, VOCABULAIRES.forme);
  memes(LIBELLES_ROLE, VOCABULAIRES.role);
  assert.deepEqual([...UNITES_EDITION].sort(), [...VOCABULAIRES.unite].sort());
  assert.equal(new Set(UNITES_EDITION).size, UNITES_EDITION.length);
  // Ordre d'affichage : celui des clés.
  assert.deepEqual(Object.keys(LIBELLES_UNITE), UNITES_EDITION);
  assert.deepEqual(UNITES_EDITION.slice(0, 5), ['g', 'kg', 'pc', 'cs', 'cc']);
});

test('libellés : en français, jamais le code', () => {
  assert.equal(LIBELLES_UNITE.pc, 'pièce');
  assert.equal(LIBELLES_UNITE.cs, 'c. à soupe');
  assert.equal(LIBELLES_UNITE.cc, 'c. à café');
  assert.equal(LIBELLES_UNITE.pincee, 'pincée');
  assert.equal(LIBELLES_UNITE.boite, 'boîte');
  assert.equal(LIBELLES_RAYON.epicerie_salee, 'Épicerie salée');
  assert.equal(LIBELLES_RAYON.fruits_legumes, 'Fruits et légumes');
  assert.equal(LIBELLES_FORME.morceaux, 'En morceaux');
  assert.equal(LIBELLES_ROLE.incorpore, 'Fondu dans le plat');
  for (const libelle of [...Object.values(LIBELLES_RAYON), ...Object.values(LIBELLES_FORME), ...Object.values(LIBELLES_ROLE)]) {
    assert.doesNotMatch(libelle, /_/);
    assert.match(libelle, /^\p{Lu}/u);
  }
  for (const libelle of Object.values(LIBELLES_UNITE)) assert.doesNotMatch(libelle, /_/);
});

test('NATURES : quatre natures, valeurs du vocabulaire, marqueurs exclusifs', () => {
  assert.deepEqual(Object.keys(NATURES), ['viande', 'poisson', 'legume', 'autre']);
  assert.deepEqual(Object.values(NATURES).map((n) => n.libelle), ['Viande', 'Poisson', 'Légume', 'Autre']);
  for (const [nature, def] of Object.entries(NATURES)) {
    for (const m of def.marqueurs) assert.ok(VOCABULAIRES.marqueurs.includes(m), m);
    assert.ok(VOCABULAIRES.rayon.includes(def.rayon), def.rayon);
    assert.equal(natureDe({ marqueurs: def.marqueurs }), nature);
  }
  assert.equal(NATURES.viande.forme, 'morceaux');
  assert.equal(NATURES.legume.role, 'incorpore');
  assert.ok(VOCABULAIRES.forme.includes(NATURES.viande.forme));
  assert.ok(VOCABULAIRES.role.includes(NATURES.legume.role));
  // Chaque nature a ses propres marqueurs, sans recouvrement.
  const tous = Object.values(NATURES).flatMap((n) => n.marqueurs);
  assert.equal(new Set(tous).size, tous.length);
});

test('bornes : valeurs attendues', () => {
  assert.equal(PORTIONS_MAX, 50);
  assert.equal(FRIGO_JOURS_MAX, 14);
  assert.equal(DUREE_MAX, 1440);
  assert.equal(QTE_MAX, 100000);
});

// ——— natureDe et appliquerNature ———

test('natureDe : viande et sous-types, puis poisson, puis légume, sinon autre', () => {
  for (const m of ['viande', 'boeuf', 'porc', 'volaille', 'agneau', 'charcuterie']) assert.equal(natureDe({ marqueurs: [m] }), 'viande', m);
  assert.equal(natureDe({ marqueurs: ['poisson'] }), 'poisson');
  assert.equal(natureDe({ marqueurs: ['fruits_de_mer'] }), 'poisson');
  assert.equal(natureDe({ marqueurs: ['legume'] }), 'legume');
  assert.equal(natureDe({ marqueurs: ['laitier', 'feculent'] }), 'autre');
  assert.equal(natureDe({ marqueurs: [] }), 'autre');
  // Priorités : viande avant poisson, poisson avant légume.
  assert.equal(natureDe({ marqueurs: ['poisson', 'porc'] }), 'viande');
  assert.equal(natureDe({ marqueurs: ['legume', 'fruits_de_mer'] }), 'poisson');
  assert.equal(natureDe({ marqueurs: ['bouillon_viande'] }), 'autre');
  // Entrées abîmées.
  assert.equal(natureDe(null), 'autre');
  assert.equal(natureDe({}), 'autre');
  assert.equal(natureDe({ marqueurs: 'viande' }), 'autre');
});

test('appliquerNature : seuls les marqueurs de nature changent, laitier et féculent restent', () => {
  const jambon = { produit: 'jambon', qte: 2, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie', 'laitier'], forme: 'fine' };
  const avant = clone(jambon);
  const poisson = appliquerNature(jambon, 'poisson');
  assert.deepEqual(poisson, { produit: 'jambon', qte: 2, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['poisson', 'laitier'] });
  assert.deepEqual(jambon, avant, 'aucune mutation');

  const beurre = { produit: 'beurre', qte: 30, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier', 'feculent'] };
  assert.deepEqual(appliquerNature(beurre, 'viande'),
    { produit: 'beurre', qte: 30, unite: 'g', rayon: 'cremerie', marqueurs: ['viande', 'laitier', 'feculent'], forme: 'morceaux' });
  assert.deepEqual(appliquerNature(beurre, 'legume').role, 'incorpore');
  assert.deepEqual(appliquerNature(beurre, 'legume').marqueurs, ['legume', 'laitier', 'feculent']);

  const crevette = { produit: 'crevette', marqueurs: ['fruits_de_mer', 'oeuf'], rayon: 'poissonnerie' };
  assert.deepEqual(appliquerNature(crevette, 'autre'), { produit: 'crevette', marqueurs: ['oeuf'], rayon: 'poissonnerie' });
});

test('appliquerNature : forme gardée pour une viande seulement, rôle pour un légume seulement', () => {
  const carotte = { produit: 'carotte', marqueurs: ['legume'], role: 'principal' };
  const enViande = appliquerNature(carotte, 'viande');
  assert.equal(enViande.forme, 'morceaux');
  assert.equal('role' in enViande, false);
  const retour = appliquerNature(enViande, 'legume');
  assert.equal(retour.role, 'incorpore', 'rôle par défaut après un passage par une autre nature');
  assert.equal('forme' in retour, false);
  // Une forme déjà connue est gardée en devenant viande.
  assert.equal(appliquerNature({ marqueurs: [], forme: 'hachee' }, 'viande').forme, 'hachee');
  assert.equal(appliquerNature({ marqueurs: [], forme: 'carre' }, 'viande').forme, 'morceaux');
  // Un rôle déjà connu est gardé en devenant légume.
  assert.equal(appliquerNature({ marqueurs: [], role: 'principal' }, 'legume').role, 'principal');
});

test('appliquerNature : même nature → copie identique ; nature inconnue → copie', () => {
  const steak = { produit: 'steak haché', marqueurs: ['viande', 'boeuf'], forme: 'hachee', rayon: 'boucherie' };
  const copie = appliquerNature(steak, 'viande');
  assert.deepEqual(copie, steak);
  assert.notEqual(copie, steak);
  assert.notEqual(copie.marqueurs, steak.marqueurs);
  // Copie identique, même sans forme (rien n'est ajouté).
  assert.deepEqual(appliquerNature({ marqueurs: ['viande'] }, 'viande'), { marqueurs: ['viande'] });
  assert.deepEqual(appliquerNature(steak, 'mineral'), steak);
  assert.deepEqual(appliquerNature(steak, undefined), steak);
  assert.deepEqual(appliquerNature(null, 'viande'), { marqueurs: ['viande'], forme: 'morceaux' });
  assert.deepEqual(appliquerNature({ produit: 'sel' }, 'poisson'), { produit: 'sel', marqueurs: ['poisson'] });
});

// ——— catalogueProduits, suggestions, produitConnu ———

test('catalogueProduits : un élément par produit, ingrédients et variantes, trié par nom', () => {
  const catalogue = catalogueProduits(PLATS);
  assert.deepEqual(catalogue.map((e) => e.produit),
    ['beurre', 'jambon blanc', 'oignon jaune', 'pâtes courtes', 'pavé de saumon', 'riz arborio', 'thon au naturel']);
  const thon = catalogue.find((e) => e.produit === 'thon au naturel');
  assert.deepEqual(thon, { produit: 'thon au naturel', unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'], nature: 'poisson' });
  const jambon = catalogue.find((e) => e.produit === 'jambon blanc');
  assert.deepEqual(jambon, {
    produit: 'jambon blanc', unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'],
    forme: 'fine', qte: 4, nature: 'viande',
  });
  assert.equal(catalogue.find((e) => e.produit === 'oignon jaune').role, 'incorpore');
  assert.equal(catalogue.find((e) => e.produit === 'oignon jaune').nature, 'legume');
  assert.equal(catalogue.find((e) => e.produit === 'beurre').nature, 'autre');
  sansUndefined(catalogue);
});

test('catalogueProduits : unité, rayon et nature les plus fréquents', () => {
  const plats = [
    { ingredients: [{ produit: 'Échalote', qte: 100, unite: 'g', rayon: 'divers', marqueurs: [] }] },
    { ingredients: [{ produit: 'échalote', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'principal' }] },
    { ingredients: [{ produit: 'echalote', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'principal' }] },
    { ingredients: [{ produit: 'échalote', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'principal' }] },
  ];
  assert.deepEqual(catalogueProduits(plats), [{
    produit: 'échalote', unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'principal', qte: 1, nature: 'legume',
  }]);
});

test('catalogueProduits : en cas d’égalité, la première occurrence rencontrée', () => {
  const plats = [
    { ingredients: [{ produit: 'lardons', qte: 200, unite: 'g', rayon: 'charcuterie', marqueurs: ['viande', 'porc'], forme: 'morceaux' }] },
    { ingredients: [{ produit: 'lardons', qte: 1, unite: 'boite', rayon: 'boucherie', marqueurs: ['viande', 'charcuterie'], forme: 'fine' }] },
  ];
  const [lardons] = catalogueProduits(plats);
  assert.equal(lardons.unite, 'g');
  assert.equal(lardons.rayon, 'charcuterie');
  assert.deepEqual(lardons.marqueurs, ['viande', 'porc']);
  assert.equal(lardons.forme, 'morceaux');
  assert.equal(lardons.qte, 200);
});

test('catalogueProduits : marqueurs, forme et rôle viennent ensemble de l’occurrence la plus fréquente', () => {
  const lardon = (marqueurs, forme) => ({ produit: 'lardons', qte: 100, unite: 'g', rayon: 'charcuterie', marqueurs, forme });
  const plats = [
    { ingredients: [lardon(['viande'], 'fine')] },
    { ingredients: [lardon(['viande', 'porc', 'charcuterie'], 'morceaux')] },
    { ingredients: [lardon(['charcuterie', 'porc', 'viande'], 'morceaux')] }, // même signature, ordre différent
  ];
  const [lardons] = catalogueProduits(plats);
  assert.deepEqual(lardons.marqueurs, ['viande', 'porc', 'charcuterie']);
  assert.equal(lardons.forme, 'morceaux');
});

test('catalogueProduits : quantité d’une occurrence dans l’unité retenue, absente sinon', () => {
  const plats = [
    { ingredients: [{ produit: 'lait', qte: 50, unite: 'cl', rayon: 'cremerie', marqueurs: ['laitier'] }] },
    { ingredients: [{ produit: 'lait', qte: 1, unite: 'l', rayon: 'cremerie', marqueurs: ['laitier'] }] },
    { ingredients: [{ produit: 'lait', qte: 1, unite: 'l', rayon: 'cremerie', marqueurs: ['laitier'] }] },
    { variantes: [{ ajouter: [{ produit: 'crème de soja', qtePortion: 5, unite: 'cl', rayon: 'cremerie', marqueurs: [] }] }] },
  ];
  const catalogue = catalogueProduits(plats);
  const lait = catalogue.find((e) => e.produit === 'lait');
  assert.equal(lait.unite, 'l');
  assert.equal(lait.qte, 1);
  const soja = catalogue.find((e) => e.produit === 'crème de soja');
  assert.equal(soja.unite, 'cl');
  assert.equal('qte' in soja, false);
});

test('catalogueProduits : tri alphabétique français (accents, casse)', () => {
  const plats = [{ ingredients: ['zeste', 'Échalote', 'ail', 'œuf', 'endive', 'oignon'].map((produit) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs: [] })) }];
  assert.deepEqual(catalogueProduits(plats).map((e) => e.produit), ['ail', 'échalote', 'endive', 'œuf', 'oignon', 'zeste']);
});

test('catalogueProduits : mémorisé par tableau (même tableau → même résultat)', () => {
  const plats = clone(PLATS);
  const premier = catalogueProduits(plats);
  assert.equal(catalogueProduits(plats), premier);
  const autre = clone(PLATS);
  const second = catalogueProduits(autre);
  assert.notEqual(second, premier);
  assert.deepEqual(second, premier);
});

test('catalogueProduits : entrées abîmées ignorées', () => {
  assert.deepEqual(catalogueProduits(null), []);
  assert.deepEqual(catalogueProduits(undefined), []);
  assert.deepEqual(catalogueProduits([]), []);
  const plats = [
    null,
    { ingredients: 'riz' },
    { ingredients: [null, {}, { produit: 12 }, { produit: '  ' }, { produit: '!!!' }] },
    { variantes: [null, { ajouter: 'thon' }] },
    { ingredients: [{ produit: 'Sel   FIN', unite: 'zz', rayon: 'zz', marqueurs: ['zz', 'laitier', 'laitier'], forme: 'zz', qte: -1 }] },
  ];
  const catalogue = catalogueProduits(plats);
  assert.deepEqual(catalogue, [{ produit: 'sel fin', unite: 'g', rayon: 'epicerie_salee', marqueurs: ['laitier'], nature: 'autre' }]);
  sansUndefined(catalogue);
});

test('suggestions : début du nom, puis début d’un mot, puis contenu', () => {
  const catalogue = catalogueProduits([{ ingredients: ['oignon rouge', 'ciboule', 'pâte brisée', 'gros oignon', 'rognon', 'oignon jaune', 'oie']
    .map((produit) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs: [] })) }]);
  assert.deepEqual(suggestions(catalogue, 'oi').map((e) => e.produit), ['oie', 'oignon jaune', 'oignon rouge', 'gros oignon']);
  assert.deepEqual(suggestions(catalogue, 'oignon', { max: 10 }).map((e) => e.produit), ['oignon jaune', 'oignon rouge', 'gros oignon']);
  assert.deepEqual(suggestions(catalogue, 'gnon', { max: 10 }).map((e) => e.produit), ['gros oignon', 'oignon jaune', 'oignon rouge', 'rognon']);
  assert.deepEqual(suggestions(catalogue, 'jaune').map((e) => e.produit), ['oignon jaune']);
});

test('suggestions : sans accents ni casse, maximum', () => {
  const catalogue = catalogueProduits([{ ingredients: ['pâte brisée', 'croûte de pâté', 'pâte feuilletée', 'pâte', 'pâtes courtes', 'tomate']
    .map((produit) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs: [] })) }]);
  assert.deepEqual(suggestions(catalogue, 'PATE').map((e) => e.produit), ['pâte', 'pâte brisée', 'pâte feuilletée', 'pâtes courtes']);
  assert.equal(suggestions(catalogue, 'PÂTÉ')[0].produit, 'pâte');
  assert.equal(suggestions(catalogue, 'pate').length, 4, '4 au plus par défaut');
  assert.deepEqual(suggestions(catalogue, 'pate', { max: 2 }).map((e) => e.produit), ['pâte', 'pâte brisée']);
  assert.deepEqual(suggestions(catalogue, 'pate', { max: 10 }).map((e) => e.produit),
    ['pâte', 'pâte brisée', 'pâte feuilletée', 'pâtes courtes', 'croûte de pâté']);
  assert.deepEqual(suggestions(catalogue, 'pate', { max: 0 }), []);
  assert.deepEqual(suggestions(catalogue, 'brisee').map((e) => e.produit), ['pâte brisée']);
  // Les éléments renvoyés sont ceux du catalogue.
  assert.equal(suggestions(catalogue, 'tomate')[0], catalogue.find((e) => e.produit === 'tomate'));
});

test('suggestions : le nom exact en tête, quel que soit l’ordre du catalogue', () => {
  const catalogue = [{ produit: 'gros sel' }, { produit: 'sel fin' }, { produit: 'Sel' }, { produit: 'persil' }];
  assert.deepEqual(suggestions(catalogue, 'sel').map((e) => e.produit), ['Sel', 'sel fin', 'gros sel']);
  assert.deepEqual(suggestions(catalogue, 'SEL', { max: 1 }).map((e) => e.produit), ['Sel']);
  assert.deepEqual(suggestions([null, {}, { produit: 'sel' }], 'sel').map((e) => e.produit), ['sel']);
});

test('catalogueProduits : produits comparés sans accents ni casse (« pâte » et « pâté » ne font qu’un)', () => {
  const plats = [{ ingredients: ['pâte', 'pâté', 'PÂTE'].map((produit) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs: [] })) }];
  assert.deepEqual(catalogueProduits(plats).map((e) => e.produit), ['pâte']);
});

test('suggestions : saisie sans caractère utile ou sans correspondance → aucune', () => {
  const catalogue = catalogueProduits(PLATS);
  assert.deepEqual(suggestions(catalogue, ''), []);
  assert.deepEqual(suggestions(catalogue, '   '), []);
  assert.deepEqual(suggestions(catalogue, '!?'), []);
  assert.deepEqual(suggestions(catalogue, undefined), []);
  assert.deepEqual(suggestions(catalogue, 'chocolat'), []);
  assert.deepEqual(suggestions(null, 'riz'), []);
  assert.deepEqual(suggestions(catalogue, 'r').map((e) => e.produit), ['riz arborio', 'beurre', 'pâtes courtes', 'thon au naturel']);
});

test('produitConnu : comparaison sans accents ni casse, nom entier', () => {
  const catalogue = catalogueProduits(PLATS);
  assert.equal(produitConnu(catalogue, '  Riz   ARBORIO ').produit, 'riz arborio');
  assert.equal(produitConnu(catalogue, 'pave de saumon').produit, 'pavé de saumon');
  assert.equal(produitConnu(catalogue, 'riz'), null);
  assert.equal(produitConnu(catalogue, ''), null);
  assert.equal(produitConnu(catalogue, undefined), null);
  assert.equal(produitConnu(null, 'riz arborio'), null);
});

// ——— ingredientSaisi ———

const CATALOGUE = catalogueProduits(PLATS);
const champsDe = (champs) => ({ produit: '', qte: '', unite: 'g', rayon: '', nature: '', forme: '', role: '', ...champs });

/** L'ingrédient passe la validation du format d'import sans être modifié. */
function accepteParLImport(ingredient) {
  const resultat = validerPaquet({ format: 'paquet@1', plats: [{ id: 'essai', nom: 'Essai', portionsBase: 4, ingredients: [ingredient] }] });
  assert.equal(resultat.valide, true, JSON.stringify(resultat.plats[0]?.erreurs));
  assert.deepEqual(resultat.plats[0].donnees.ingredients[0], ingredient);
}

test('ingredientSaisi : produit connu → marqueurs, forme et rayon du catalogue', () => {
  const { ingredient, erreurs } = ingredientSaisi(champsDe({ produit: 'Jambon  Blanc ', qte: '3', unite: 'tranche' }),
    { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients });
  assert.equal(erreurs, undefined);
  assert.deepEqual(ingredient, {
    produit: 'jambon blanc', qte: 3, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'fine',
  });
  accepteParLImport(ingredient);
  sansUndefined(ingredient);
  // Rayon choisi : il l'emporte sur celui du catalogue.
  assert.equal(ingredientSaisi(champsDe({ produit: 'jambon blanc', qte: '3', unite: 'tranche', rayon: 'boucherie' }),
    { catalogue: CATALOGUE }).ingredient.rayon, 'boucherie');
});

test('ingredientSaisi : produit inconnu sans nature → erreur ; avec nature → ses valeurs par défaut', () => {
  const sans = ingredientSaisi(champsDe({ produit: 'panais', qte: '300' }), { catalogue: CATALOGUE });
  assert.deepEqual(sans, { erreurs: { nature: 'Choisissez\u00A0: viande, poisson, légume ou autre.' } });

  const legume = ingredientSaisi(champsDe({ produit: 'panais', qte: '300', nature: 'legume' }), { catalogue: CATALOGUE }).ingredient;
  assert.deepEqual(legume, { produit: 'panais', qte: 300, unite: 'g', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' });
  accepteParLImport(legume);

  const viande = ingredientSaisi(champsDe({ produit: 'joue de bœuf', qte: '1', unite: 'kg', nature: 'viande' }), { catalogue: CATALOGUE }).ingredient;
  assert.deepEqual(viande, { produit: 'joue de bœuf', qte: 1, unite: 'kg', rayon: 'boucherie', marqueurs: ['viande'], forme: 'morceaux' });
  accepteParLImport(viande);

  const poisson = ingredientSaisi(champsDe({ produit: 'colin', qte: '2', unite: 'pc', nature: 'poisson' }), { catalogue: CATALOGUE }).ingredient;
  assert.deepEqual(poisson, { produit: 'colin', qte: 2, unite: 'pc', rayon: 'poissonnerie', marqueurs: ['poisson'] });

  const autre = ingredientSaisi(champsDe({ produit: 'paprika', qte: '1', unite: 'cc', nature: 'autre' }), { catalogue: CATALOGUE }).ingredient;
  assert.deepEqual(autre, { produit: 'paprika', qte: 1, unite: 'cc', rayon: 'epicerie_salee', marqueurs: [] });
  accepteParLImport(autre);

  // Rayon choisi, forme et rôle choisis.
  assert.equal(ingredientSaisi(champsDe({ produit: 'petits pois', qte: '1', nature: 'legume', rayon: 'surgeles' }), { catalogue: CATALOGUE }).ingredient.rayon, 'surgeles');
  assert.equal(ingredientSaisi(champsDe({ produit: 'veau', qte: '1', nature: 'viande', forme: 'hachee' }), { catalogue: CATALOGUE }).ingredient.forme, 'hachee');
  assert.equal(ingredientSaisi(champsDe({ produit: 'veau', qte: '1', nature: 'viande', forme: 'zz' }), { catalogue: CATALOGUE }).ingredient.forme, 'morceaux');
  assert.equal(ingredientSaisi(champsDe({ produit: 'navet', qte: '1', nature: 'legume', role: 'principal' }), { catalogue: CATALOGUE }).ingredient.role, 'principal');
  // Une forme ou un rôle sans objet sont ignorés.
  const sel = ingredientSaisi(champsDe({ produit: 'sel', qte: '1', unite: 'pincee', nature: 'autre', forme: 'hachee', role: 'principal' }), { catalogue: CATALOGUE }).ingredient;
  assert.deepEqual(sel, { produit: 'sel', qte: 1, unite: 'pincee', rayon: 'epicerie_salee', marqueurs: [] });
  // Une nature inconnue vaut absente.
  assert.ok(ingredientSaisi(champsDe({ produit: 'panais', qte: '1', nature: 'mineral' }), { catalogue: CATALOGUE }).erreurs.nature);
  assert.ok(ingredientSaisi(champsDe({ produit: 'panais', qte: '1', nature: 'toString' }), { catalogue: CATALOGUE }).erreurs.nature);
});

test('ingredientSaisi : nature choisie pour un produit connu → appliquée au catalogue', () => {
  const { ingredient } = ingredientSaisi(champsDe({ produit: 'jambon blanc', qte: '2', unite: 'tranche', nature: 'autre' }), { catalogue: CATALOGUE });
  assert.deepEqual(ingredient, { produit: 'jambon blanc', qte: 2, unite: 'tranche', rayon: 'charcuterie', marqueurs: [] });
  const forme = ingredientSaisi(champsDe({ produit: 'jambon blanc', qte: '2', unite: 'tranche', forme: 'effilochable' }), { catalogue: CATALOGUE });
  assert.equal(forme.ingredient.forme, 'effilochable');
});

test('ingredientSaisi : ingrédient modifié qui garde son produit → ses marqueurs, même si le catalogue dit autre chose', () => {
  const ingredients = [{ produit: 'beurre', qte: 30, unite: 'g', rayon: 'divers', marqueurs: ['laitier', 'feculent'] }, ...RISOTTO.ingredients.slice(0, 2)];
  const { ingredient } = ingredientSaisi(champsDe({ produit: 'Beurre', qte: '45', unite: 'g' }), { catalogue: CATALOGUE, ingredients, index: 0 });
  assert.deepEqual(ingredient, { produit: 'beurre', qte: 45, unite: 'g', rayon: 'divers', marqueurs: ['laitier', 'feculent'] });

  // Changement de nature sur l'ingrédient modifié : le rayon reste le sien.
  const saumon = ingredientSaisi(champsDe({ produit: 'pavé de saumon', qte: '600', nature: 'viande' }),
    { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients, index: 1 }).ingredient;
  assert.deepEqual(saumon, { produit: 'pavé de saumon', qte: 600, unite: 'g', rayon: 'poissonnerie', marqueurs: ['viande'], forme: 'morceaux' });

  // Rôle choisi pour un légume modifié.
  const oignon = ingredientSaisi(champsDe({ produit: 'oignon jaune', qte: '2', unite: 'pc', role: 'principal' }),
    { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients, index: 2 }).ingredient;
  assert.equal(oignon.role, 'principal');
  accepteParLImport(oignon);
});

test('ingredientSaisi : renommage → catalogue ou nature obligatoire', () => {
  const opts = { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients, index: 0 };
  // Renommé en un produit inconnu : la nature doit être choisie (celle de l'ancien ne compte plus).
  assert.ok(ingredientSaisi(champsDe({ produit: 'riz carnaroli', qte: '450' }), opts).erreurs.nature);
  const carnaroli = ingredientSaisi(champsDe({ produit: 'riz carnaroli', qte: '450', nature: 'autre' }), opts).ingredient;
  assert.deepEqual(carnaroli, { produit: 'riz carnaroli', qte: 450, unite: 'g', rayon: 'epicerie_salee', marqueurs: [] });
  // Renommé en un produit connu : les valeurs du catalogue.
  const jambon = ingredientSaisi(champsDe({ produit: 'jambon blanc', qte: '4', unite: 'tranche' }), opts).ingredient;
  assert.deepEqual(jambon.marqueurs, ['viande', 'porc', 'charcuterie']);
  assert.equal(jambon.rayon, 'charcuterie');
  // Renommé en un produit déjà présent ailleurs dans la recette : doublon.
  assert.equal(ingredientSaisi(champsDe({ produit: 'beurre', qte: '4' }), opts).erreurs.produit, '«\u00A0beurre\u00A0» est déjà dans la recette.');
});

test('ingredientSaisi : doublon repéré sans accents ni casse, mais pas l’ingrédient modifié lui-même', () => {
  const ajout = ingredientSaisi(champsDe({ produit: '  Riz   ARBORIO ', qte: '100' }), { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients });
  assert.deepEqual(ajout, { erreurs: { produit: '«\u00A0riz arborio\u00A0» est déjà dans la recette.' } });
  assert.ok(ingredientSaisi(champsDe({ produit: 'Pave de saumon', qte: '1' }), { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients }).erreurs.produit);
  const modif = ingredientSaisi(champsDe({ produit: 'riz arborio', qte: '500' }), { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients, index: 0 });
  assert.equal(modif.ingredient.qte, 500);
});

test('ingredientSaisi : quantité (virgule, espaces, arrondi, bornes)', () => {
  const qte = (valeur) => ingredientSaisi(champsDe({ produit: 'beurre', qte: valeur }), { catalogue: CATALOGUE });
  assert.equal(qte('0,5').ingredient.qte, 0.5);
  assert.equal(qte(' 2.25 ').ingredient.qte, 2.25);
  assert.equal(qte('1 000').ingredient.qte, 1000);
  assert.equal(qte(',5').ingredient.qte, 0.5);
  assert.equal(qte('3,').ingredient.qte, 3);
  assert.equal(qte('0,3333').ingredient.qte, 0.333);
  assert.equal(qte('0,0005').ingredient.qte, 0.001);
  assert.equal(qte(1.23456).ingredient.qte, 1.235);
  assert.equal(qte(String(QTE_MAX)).ingredient.qte, QTE_MAX);
  const message = 'Quantité\u00A0: un nombre, par exemple 0,5.';
  for (const mauvaise of ['', '  ', '0', '0,0004', '-1', 'abc', '1/2', '1,5,5', '1e3', String(QTE_MAX + 1), undefined, null, NaN, Infinity, -2]) {
    assert.deepEqual(qte(mauvaise), { erreurs: { qte: message } }, String(mauvaise));
  }
});

test('ingredientSaisi : nom et unité obligatoires, erreurs réunies', () => {
  assert.deepEqual(ingredientSaisi(champsDe({ produit: '  ', qte: '1' }), { catalogue: CATALOGUE }),
    { erreurs: { produit: 'Écrivez le nom de l’ingrédient.' } });
  assert.deepEqual(ingredientSaisi(champsDe({ produit: 'x'.repeat(81), qte: '1' }), { catalogue: CATALOGUE }),
    { erreurs: { produit: 'Nom trop long (80 caractères au plus).' } });
  assert.ok(ingredientSaisi(champsDe({ produit: 'x'.repeat(80), qte: '1', nature: 'autre' }), { catalogue: CATALOGUE }).ingredient);
  assert.ok(ingredientSaisi(champsDe({ produit: '!!!', qte: '1', nature: 'autre' }), { catalogue: CATALOGUE }).erreurs.produit);
  for (const unite of ['', 'gramme', undefined, 'toString']) {
    assert.deepEqual(ingredientSaisi(champsDe({ produit: 'beurre', qte: '1', unite }), { catalogue: CATALOGUE }),
      { erreurs: { unite: 'Choisissez une unité.' } }, String(unite));
  }
  // Plusieurs erreurs à la fois ; la nature n'est demandée qu'une fois le nom correct.
  assert.deepEqual(Object.keys(ingredientSaisi({ produit: '', qte: 'x', unite: '' }, { catalogue: CATALOGUE }).erreurs), ['produit', 'qte', 'unite']);
  assert.deepEqual(Object.keys(ingredientSaisi({ produit: 'panais', qte: 'x', unite: '' }, { catalogue: CATALOGUE }).erreurs), ['qte', 'unite', 'nature']);
  // Champs absents, options absentes.
  assert.ok(ingredientSaisi({}).erreurs.produit);
  assert.ok(ingredientSaisi(undefined).erreurs.produit);
  assert.deepEqual(ingredientSaisi({ produit: 'panais', qte: '1', unite: 'g', nature: 'legume' }).ingredient.marqueurs, ['legume']);
  messagesPropres([
    'Écrivez le nom de l’ingrédient.', 'Nom trop long (80 caractères au plus).', 'Choisissez une unité.',
    ...Object.values(ingredientSaisi({ produit: 'panais', qte: 'x', unite: '' }, { catalogue: CATALOGUE }).erreurs),
    ...Object.values(ingredientSaisi({ produit: 'beurre', qte: '1', unite: 'g' }, { catalogue: CATALOGUE, ingredients: RISOTTO.ingredients }).erreurs),
  ]);
});

test('ingredientSaisi : résultat toujours conforme au format d’import (viande sans forme, légume sans rôle au catalogue)', () => {
  const catalogue = catalogueProduits([{ ingredients: [
    { produit: 'merguez', qte: 4, unite: 'pc', rayon: 'boucherie', marqueurs: ['viande', 'agneau'] },
    { produit: 'poireau', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'] },
  ] }]);
  const merguez = ingredientSaisi(champsDe({ produit: 'merguez', qte: '4', unite: 'pc' }), { catalogue }).ingredient;
  assert.equal(merguez.forme, 'morceaux');
  accepteParLImport(merguez);
  const poireau = ingredientSaisi(champsDe({ produit: 'poireau', qte: '2', unite: 'pc' }), { catalogue }).ingredient;
  assert.equal(poireau.role, 'incorpore');
  accepteParLImport(poireau);
  for (const ingredient of [merguez, poireau]) {
    assert.equal('nature' in ingredient, false);
    for (const valeur of Object.values(ingredient)) assert.notEqual(valeur, '');
    sansUndefined(ingredient);
  }
});

// ——— normaliserPourEdition ———

test('normaliserPourEdition : valeurs affichées d’une recette complète', () => {
  assert.deepEqual(normaliserPourEdition(RISOTTO, REGLAGES), {
    nom: 'Risotto test',
    type: 'plat',
    portionsBase: 6,
    ingredients: RISOTTO.ingredients,
    etapes: RISOTTO.etapes,
    cuisson: RISOTTO.cuisson,
    frigoJours: 2,
    congelable: false,
    emporter: false,
    verifiee: false,
  });
  assert.equal(normaliserPourEdition(GRATIN).verifiee, true);
  assert.equal(normaliserPourEdition(GRATIN).congelable, true);
});

test('normaliserPourEdition : valeurs par défaut d’un plat ajouté par son nom', () => {
  assert.deepEqual(normaliserPourEdition(SOUPE, { frigoJoursDefaut: 5 }), {
    nom: 'Soupe test', type: 'plat', portionsBase: 4, ingredients: [], etapes: [], cuisson: [],
    frigoJours: 5, congelable: null, emporter: true, verifiee: false,
  });
  assert.equal(normaliserPourEdition(SOUPE).frigoJours, 3);
  assert.equal(normaliserPourEdition(SOUPE, {}).frigoJours, 3);
  assert.equal(normaliserPourEdition(SOUPE, null).frigoJours, 3);
  const vide = normaliserPourEdition(null);
  assert.equal(vide.nom, '');
  assert.equal(vide.portionsBase, 4);
  assert.deepEqual(normaliserPourEdition(undefined), vide);
});

test('normaliserPourEdition : portions invalides, zéro jour, étapes en texte, listes abîmées', () => {
  for (const portions of [0, -2, 2.5, '6', null, NaN]) assert.equal(normaliserPourEdition({ portionsBase: portions }).portionsBase, 4, String(portions));
  assert.equal(normaliserPourEdition({ conservation: { frigoJours: 0 } }, { frigoJoursDefaut: 5 }).frigoJours, 0);
  assert.equal(normaliserPourEdition({ conservation: { congelable: false } }).congelable, false);
  assert.equal(normaliserPourEdition({ emporter: false }).emporter, false);
  assert.deepEqual(normaliserPourEdition({ etapes: ['a', 2] }).etapes, ['a', '2']);
  assert.deepEqual(normaliserPourEdition({ etapes: 'a', ingredients: {}, cuisson: 'four' }), normaliserPourEdition({}));
  assert.equal(normaliserPourEdition({ type: 'dessert' }).type, 'dessert');
  assert.equal(normaliserPourEdition({ statutRecette: 'brouillon' }).verifiee, false);
});

test('normaliserPourEdition : copie profonde, la fiche n’est jamais touchée', () => {
  const plat = clone(GRATIN);
  const saisie = normaliserPourEdition(plat);
  saisie.ingredients[0].qte = 1;
  saisie.ingredients[1].marqueurs.push('poisson');
  saisie.cuisson[1].tempC = 100;
  saisie.etapes.push('Servir.');
  assert.deepEqual(plat, GRATIN);
});

// ——— egalProfonde, deplacer, ajouterEtape ———

test('egalProfonde : clés permutées égales, listes réordonnées différentes', () => {
  assert.equal(egalProfonde({ a: 1, b: { c: [1, 2], d: 'x' } }, { b: { d: 'x', c: [1, 2] }, a: 1 }), true);
  const saisie = normaliserPourEdition(RISOTTO);
  const permute = clone(saisie);
  permute.ingredients = permute.ingredients.map((i) => Object.fromEntries(Object.entries(i).reverse()));
  assert.equal(egalProfonde(saisie, permute), true);
  const echange = clone(saisie);
  [echange.ingredients[0], echange.ingredients[1]] = [echange.ingredients[1], echange.ingredients[0]];
  assert.equal(egalProfonde(saisie, echange), false);
  assert.equal(egalProfonde([1, 2], [2, 1]), false);
  assert.equal(egalProfonde([1, 2], [1, 2, 3]), false);
  assert.equal(egalProfonde({ a: [1] }, { a: [1], b: 2 }), false);
});

test('egalProfonde : undefined vaut une clé absente, null non', () => {
  assert.equal(egalProfonde({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(egalProfonde({ x: { a: undefined } }, { x: {} }), true);
  assert.equal(egalProfonde(undefined, undefined), true);
  assert.equal(egalProfonde({ a: null }, { a: undefined }), false);
  assert.equal(egalProfonde(null, undefined), false);
  assert.equal(egalProfonde(null, {}), false);
  assert.equal(egalProfonde({}, null), false);
  assert.equal(egalProfonde([], {}), false);
  assert.equal(egalProfonde({ 0: 'a', length: 1 }, ['a']), false);
  assert.equal(egalProfonde(1, '1'), false);
  assert.equal(egalProfonde(0, -0), false);
  assert.equal(egalProfonde(NaN, NaN), true);
  assert.equal(egalProfonde('a', 'a'), true);
  assert.equal(egalProfonde(true, false), false);
  assert.equal(egalProfonde([undefined], []), false);
});

test('deplacer : nouvelle liste, bornes vérifiées', () => {
  const liste = ['a', 'b', 'c', 'd'];
  assert.deepEqual(deplacer(liste, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(deplacer(liste, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(deplacer(liste, 1, 2), ['a', 'c', 'b', 'd']);
  assert.deepEqual(deplacer(liste, 2, 1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(deplacer(liste, 2, 2), liste);
  for (const [de, vers] of [[-1, 0], [0, -1], [4, 0], [0, 4], [1.5, 0], [undefined, 1], [0, '1']]) {
    const copie = deplacer(liste, de, vers);
    assert.deepEqual(copie, liste, `${de} → ${vers}`);
    assert.notEqual(copie, liste);
  }
  assert.deepEqual(liste, ['a', 'b', 'c', 'd'], 'aucune mutation');
  assert.deepEqual(deplacer(null, 0, 1), []);
});

test('ajouterEtape : à la fin, texte réduit, jamais une étape vide', () => {
  const etapes = ['Cuire.'];
  assert.deepEqual(ajouterEtape(etapes, '  Servir   chaud. \n'), ['Cuire.', 'Servir chaud.']);
  assert.deepEqual(etapes, ['Cuire.'], 'aucune mutation');
  for (const vide of ['', '   ', '\n', undefined, null]) {
    const copie = ajouterEtape(etapes, vide);
    assert.deepEqual(copie, etapes);
    assert.notEqual(copie, etapes);
  }
  assert.deepEqual(ajouterEtape(undefined, 'Cuire.'), ['Cuire.']);
});

// ——— Cuisson principale ———

test('indexCuissonPrincipale : même règle que cuissonPrincipale', () => {
  const cas = [
    GRATIN.cuisson,
    [{ appareil: 'cookeo', dureeMin: 15 }, { appareil: 'plaque', dureeMin: 15 }],
    [{ appareil: 'plaque' }, { appareil: 'four', dureeMin: 5 }],
    [{ appareil: 'barbecue', dureeMin: 60 }, { appareil: 'plaque', dureeMin: 10 }],
    [{ appareil: 'airfryer' }],
    [{ appareil: 'four', dureeMin: 30 }, null, { appareil: 'toString', dureeMin: 90 }],
  ];
  const attendus = [1, 0, 1, 1, 0, 0];
  cas.forEach((cuisson, i) => {
    const index = indexCuissonPrincipale(cuisson);
    assert.equal(index, attendus[i], `cas ${i}`);
    assert.equal(cuisson[index].appareil, cuissonPrincipale({ cuisson }).appareil);
  });
  assert.equal(indexCuissonPrincipale([]), -1);
  assert.equal(indexCuissonPrincipale(undefined), -1);
  assert.equal(indexCuissonPrincipale('four'), -1);
  assert.equal(indexCuissonPrincipale([{ appareil: 'barbecue', dureeMin: 10 }]), -1);
});

test('changerCuissonPrincipale : « Aucun » → plus de cuisson', () => {
  assert.deepEqual(changerCuissonPrincipale(GRATIN.cuisson, { appareil: null, dureeMin: 20 }), []);
  assert.deepEqual(changerCuissonPrincipale([], { appareil: null }), []);
});

test('changerCuissonPrincipale : étape principale remplacée, température gardée pour four et airfryer', () => {
  const avant = clone(GRATIN.cuisson);
  assert.deepEqual(changerCuissonPrincipale(GRATIN.cuisson, { appareil: 'airfryer', dureeMin: 15 }),
    [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'airfryer', tempC: 200, dureeMin: 15 }]);
  assert.deepEqual(changerCuissonPrincipale(GRATIN.cuisson, { appareil: 'four', dureeMin: 35 }),
    [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, dureeMin: 35 }]);
  assert.deepEqual(changerCuissonPrincipale(GRATIN.cuisson, { appareil: 'cookeo', dureeMin: 25 }),
    [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'cookeo', dureeMin: 25 }]);
  assert.deepEqual(GRATIN.cuisson, avant, 'aucune mutation');
});

test('changerCuissonPrincipale : mode gardé seulement si l’appareil ne change pas', () => {
  const cuisson = [{ appareil: 'four', tempC: 180, mode: 'chaleur tournante', dureeMin: 40 }];
  assert.deepEqual(changerCuissonPrincipale(cuisson, { appareil: 'four', dureeMin: 45 }),
    [{ appareil: 'four', tempC: 180, mode: 'chaleur tournante', dureeMin: 45 }]);
  assert.deepEqual(changerCuissonPrincipale(cuisson, { appareil: 'airfryer', dureeMin: 25 }),
    [{ appareil: 'airfryer', tempC: 180, dureeMin: 25 }]);
  assert.deepEqual(changerCuissonPrincipale(RISOTTO.cuisson, { appareil: 'cookeo', dureeMin: 12 }),
    [{ appareil: 'cookeo', mode: 'sous pression', dureeMin: 12 }]);
  assert.deepEqual(changerCuissonPrincipale(RISOTTO.cuisson, { appareil: 'plaque', dureeMin: 25 }),
    [{ appareil: 'plaque', dureeMin: 25 }]);
});

test('changerCuissonPrincipale : sans étape principale, une étape est ajoutée à la fin', () => {
  assert.deepEqual(changerCuissonPrincipale([], { appareil: 'four', dureeMin: 30 }), [{ appareil: 'four', dureeMin: 30 }]);
  assert.deepEqual(changerCuissonPrincipale(undefined, { appareil: 'plaque', dureeMin: 10 }), [{ appareil: 'plaque', dureeMin: 10 }]);
  assert.deepEqual(changerCuissonPrincipale([{ appareil: 'barbecue', dureeMin: 10 }], { appareil: 'monsieur_cuisine', dureeMin: 20 }),
    [{ appareil: 'barbecue', dureeMin: 10 }, { appareil: 'monsieur_cuisine', dureeMin: 20 }]);
});

test('changerCuissonPrincipale : durée pas encore saisie → étape sans durée ; appareil inconnu → rien ne change', () => {
  assert.deepEqual(changerCuissonPrincipale([], { appareil: 'cookeo', dureeMin: null }), [{ appareil: 'cookeo' }]);
  assert.deepEqual(changerCuissonPrincipale([], { appareil: 'cookeo', dureeMin: NaN }), [{ appareil: 'cookeo' }]);
  assert.deepEqual(changerCuissonPrincipale([], { appareil: 'cookeo', dureeMin: '' }), [{ appareil: 'cookeo' }]);
  assert.deepEqual(changerCuissonPrincipale([], { appareil: 'cookeo', dureeMin: ' 20 ' }), [{ appareil: 'cookeo', dureeMin: 20 }]);
  assert.deepEqual(changerCuissonPrincipale([], { appareil: 'cookeo' }), [{ appareil: 'cookeo' }]);
  assert.deepEqual(changerCuissonPrincipale(RISOTTO.cuisson, { appareil: 'cookeo', dureeMin: null }),
    [{ appareil: 'cookeo', mode: 'sous pression' }]);
  const copie = changerCuissonPrincipale(GRATIN.cuisson, { appareil: 'barbecue', dureeMin: 10 });
  assert.deepEqual(copie, GRATIN.cuisson);
  assert.notEqual(copie, GRATIN.cuisson);
  sansUndefined(changerCuissonPrincipale(GRATIN.cuisson, { appareil: 'plaque', dureeMin: undefined }));
});

// ——— preparerModification ———

const contexte = { plats: PLATS, demandes: [], reglages: REGLAGES };

test('preparerModification : rien de touché → rien à écrire', () => {
  for (const plat of [RISOTTO, GRATIN, SOUPE]) {
    const base = normaliserPourEdition(plat, REGLAGES);
    const r = preparerModification(base, clone(base), plat, contexte);
    assert.deepEqual(r, { champs: {}, supprimer: [], demandesAClore: [], conflits: [], erreurs: [], rien: true }, plat.id);
  }
});

test('preparerModification : seuls les champs touchés sont écrits', () => {
  const cas = [
    [(s) => { s.nom = '  Risotto   au saumon '; }, { nom: 'Risotto au saumon' }],
    [(s) => { s.type = 'accompagnement'; }, { type: 'accompagnement' }],
    // Portions et ingrédients vont ensemble : les quantités valent pour le nombre affiché.
    [(s) => { s.portionsBase = 8; }, { portionsBase: 8, ingredients: clone(RISOTTO.ingredients) }],
    [(s) => { s.emporter = true; }, { emporter: true }],
    [(s) => { s.verifiee = true; }, { statutRecette: 'validee' }],
    [(s) => { s.etapes = ['  Faire   revenir. ', '', 'Servir.']; }, { etapes: ['Faire revenir.', 'Servir.'] }],
    [(s) => { s.cuisson = changerCuissonPrincipale(s.cuisson, { appareil: 'plaque', dureeMin: 20 }); }, { cuisson: [{ appareil: 'plaque', dureeMin: 20 }] }],
    [(s) => { s.ingredients[0].qte = 500; }, { portionsBase: 6, ingredients: [{ ...RISOTTO.ingredients[0], qte: 500 }, ...RISOTTO.ingredients.slice(1)] }],
  ];
  for (const [changer, attendu] of cas) {
    const { base, saisie } = modifier(RISOTTO, changer);
    const r = preparerModification(base, saisie, RISOTTO, contexte);
    assert.deepEqual(r.erreurs, [], JSON.stringify(attendu));
    assert.deepEqual(r.champs, attendu);
    assert.deepEqual(r.supprimer, []);
    assert.equal(r.rien, false);
    sansUndefined(r);
  }
  // Recette vérifiée décochée → à vérifier.
  const { base, saisie } = modifier(GRATIN, (s) => { s.verifiee = false; });
  assert.deepEqual(preparerModification(base, saisie, GRATIN, contexte).champs, { statutRecette: 'brouillon' });
});

test('preparerModification : un champ non touché, changé ailleurs, n’est jamais réécrit', () => {
  const { base, saisie } = modifier(RISOTTO, (s) => { s.type = 'accompagnement'; });
  const ailleurs = { ...clone(RISOTTO), nom: 'Risotto du jeudi', etapes: ['Tout autre chose.'], portionsBase: 2, conservation: { frigoJours: 1, congelable: true } };
  const r = preparerModification(base, saisie, ailleurs, contexte);
  assert.deepEqual(r.champs, { type: 'accompagnement' });
  assert.deepEqual(r.conflits, []);
  assert.deepEqual(r.erreurs, []);
});

test('preparerModification : conflit quand un champ touché ici a aussi changé ailleurs, dans l’ordre du modèle', () => {
  const { base, saisie } = modifier(RISOTTO, (s) => {
    s.verifiee = true;
    s.ingredients[0].qte = 500;
    s.nom = 'Risotto maison';
    s.frigoJours = 3;
  });
  const ailleurs = clone(RISOTTO);
  ailleurs.nom = 'Risotto du jeudi';
  ailleurs.ingredients[1].qte = 700;
  ailleurs.statutRecette = 'validee';
  ailleurs.etapes = ['Changée ailleurs, pas ici.'];
  const r = preparerModification(base, saisie, ailleurs, contexte);
  assert.deepEqual(r.conflits, ['nom', 'ingredients', 'verifiee']);
  // La saisie l'emporte sur les champs touchés ; les autres suivent la fiche actuelle.
  assert.equal(r.champs.nom, 'Risotto maison');
  assert.equal(r.champs.ingredients[1].qte, 600);
  assert.equal('etapes' in r.champs, false);
  // Conservation : seul le sous-champ touché.
  assert.deepEqual(r.champs.conservation, { frigoJours: 3 });
});

test('preparerModification : ingrédients écrits avec leurs portions, et conflit si les portions ont changé ailleurs', () => {
  // L'autre téléphone passe la recette à 8 portions ; ici, une quantité change pour les 6 portions affichées.
  const { base, saisie } = modifier(RISOTTO, (s) => { s.ingredients[0].qte = 500; });
  const ailleurs = { ...clone(RISOTTO), portionsBase: 8 };
  const r = preparerModification(base, saisie, ailleurs, contexte);
  assert.equal(r.champs.portionsBase, 6);
  assert.equal(r.champs.ingredients[0].qte, 500);
  assert.deepEqual(r.conflits, ['portionsBase']);
  // Sens inverse : portions changées ici, ingrédients changés ailleurs → les deux écrits, conflit sur les ingrédients.
  const portions = modifier(RISOTTO, (s) => { s.portionsBase = 4; });
  const autres = clone(RISOTTO);
  autres.ingredients[0].qte = 900;
  const r2 = preparerModification(portions.base, portions.saisie, autres, contexte);
  assert.equal(r2.champs.portionsBase, 4);
  assert.equal(r2.champs.ingredients[0].qte, 450);
  assert.deepEqual(r2.conflits, ['ingredients']);
});

test('preparerModification : plat ⏳ complété ailleurs pendant la saisie → portions affichées écrites, conflit annoncé', () => {
  const panais = ingredientSaisi(champsDe({ produit: 'panais', qte: '500', nature: 'legume' }), { catalogue: CATALOGUE }).ingredient;
  const { base, saisie } = modifier(SOUPE, (s) => { s.ingredients.push(panais); });
  // La recette de Claude est arrivée entre-temps : 6 portions, ses propres ingrédients.
  const complete = { ...SOUPE, statutRecette: 'brouillon', portionsBase: 6, ingredients: [clone(RISOTTO.ingredients[0])] };
  const r = preparerModification(base, saisie, complete, contexte);
  assert.equal(r.champs.portionsBase, 4);
  assert.deepEqual(r.champs.ingredients, [panais]);
  assert.deepEqual(r.conflits, ['portionsBase', 'ingredients']);
});

test('preparerModification : plat ⏳ dont seules les portions changent → portions seules, sans ingrédients', () => {
  const { base, saisie } = modifier(SOUPE, (s) => { s.portionsBase = 2; });
  const r = preparerModification(base, saisie, SOUPE, contexte);
  assert.deepEqual(r.champs, { portionsBase: 2 });
  assert.deepEqual(r.erreurs, []);
});

test('preparerModification : photo, note, vignette ou sa propre écriture → aucun conflit', () => {
  const { base, saisie } = modifier(RISOTTO, (s) => { s.portionsBase = 4; s.ingredients.pop(); });
  const ailleurs = {
    ...clone(RISOTTO), vignette: 'data:image/jpeg;base64,AAAA', notes: { 'profil-a': 5, 'profil-b': 0 },
    modifieePar: 'membre@example.com', modifieeLe: null, majLe: { seconds: 1 }, derniereFois: '2026-09-27',
  };
  assert.deepEqual(preparerModification(base, saisie, ailleurs, contexte).conflits, []);
  // Sa propre écriture déjà appliquée à la fiche : plus rien à écrire, aucun conflit.
  const ecrite = { ...clone(RISOTTO), portionsBase: 4, ingredients: saisie.ingredients, modifieePar: 'membre@example.com' };
  const apres = preparerModification(saisie, clone(saisie), ecrite, contexte);
  assert.deepEqual(apres.conflits, []);
  assert.equal(apres.rien, true);
});

test('preparerModification : plat ⏳ ouvert puis fermé sans rien toucher → rien', () => {
  const base = normaliserPourEdition(SOUPE, REGLAGES);
  const demandes = [{ id: 'soupe-test__recette', type: 'recette', platId: 'soupe-test', statut: 'ouverte' }];
  const r = preparerModification(base, clone(base), SOUPE, { ...contexte, demandes });
  assert.equal(r.rien, true);
  assert.deepEqual(r.champs, {});
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.demandesAClore, []);
  // Seul le nom changé : pas de statut écrit, la demande reste ouverte.
  const { base: b2, saisie } = modifier(SOUPE, (s) => { s.nom = 'Soupe de légumes test'; });
  const nom = preparerModification(b2, saisie, SOUPE, { ...contexte, demandes });
  assert.deepEqual(nom.champs, { nom: 'Soupe de légumes test' });
  assert.deepEqual(nom.demandesAClore, []);
  assert.deepEqual(nom.erreurs, []);
});

test('preparerModification : plat ⏳ + un ingrédient → recette écrite, statut à vérifier, demande close', () => {
  const panais = ingredientSaisi(champsDe({ produit: 'panais', qte: '500', nature: 'legume' }), { catalogue: CATALOGUE }).ingredient;
  const { base, saisie } = modifier(SOUPE, (s) => { s.ingredients.push(panais); });
  const demandes = [
    { id: 'soupe-test__recette', type: 'recette', platId: 'soupe-test', statut: 'ouverte' },
    { id: 'soupe-test__profil-b', type: 'variante', platId: 'soupe-test', statut: 'ouverte' },
  ];
  const r = preparerModification(base, saisie, SOUPE, { ...contexte, demandes });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.champs, { portionsBase: 4, ingredients: [panais], statutRecette: 'brouillon' });
  assert.deepEqual(r.demandesAClore, ['soupe-test__recette']);
  assert.equal(r.rien, false);
  sansUndefined(r);
  // Demande déjà traitée ou absente : rien à clore.
  assert.deepEqual(preparerModification(base, saisie, SOUPE, { ...contexte, demandes: [{ ...demandes[0], statut: 'traitee' }] }).demandesAClore, []);
  assert.deepEqual(preparerModification(base, saisie, SOUPE, contexte).demandesAClore, []);
  assert.deepEqual(preparerModification(base, saisie, SOUPE).demandesAClore, []);
  // Cochée « Recette vérifiée » en même temps : statut vérifié.
  const verifiee = { ...clone(saisie), verifiee: true };
  assert.equal(preparerModification(base, verifiee, SOUPE, contexte).champs.statutRecette, 'validee');
  // Portions touchées : leur valeur.
  assert.equal(preparerModification(base, { ...clone(saisie), portionsBase: 2 }, SOUPE, contexte).champs.portionsBase, 2);
});

test('ingredientSaisi : ingrédient à la fois viande et légume → forme et rôle gardés, accepté par l’import', () => {
  const farci = { produit: 'tomate farcie', qte: 4, unite: 'pc', rayon: 'boucherie', marqueurs: ['viande', 'legume'], forme: 'hachee', role: 'principal' };
  const { ingredient, erreurs } = ingredientSaisi(champsDe({ produit: 'tomate farcie', qte: '6', unite: 'pc' }),
    { catalogue: CATALOGUE, ingredients: [farci], index: 0 });
  assert.equal(erreurs, undefined);
  assert.equal(ingredient.forme, 'hachee');
  assert.equal(ingredient.role, 'principal');
  accepteParLImport(ingredient);
  // Légume et poisson, ajouté depuis le catalogue : rôle gardé.
  const catalogue = catalogueProduits([{ ingredients: [{ produit: 'courgette au thon', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['poisson', 'legume'], role: 'principal' }] }]);
  const ajout = ingredientSaisi(champsDe({ produit: 'courgette au thon', qte: '3', unite: 'pc' }), { catalogue }).ingredient;
  assert.equal(ajout.role, 'principal');
  accepteParLImport(ajout);
});

test('preparerModification : plat ⏳ — ingrédients retirés jusqu’au dernier : pas d’erreur, rien d’écrit', () => {
  const { base, saisie } = modifier(SOUPE, (s) => { s.ingredients = []; });
  const r = preparerModification(base, saisie, SOUPE, contexte);
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.rien, true);
});

test('preparerModification : toutes les étapes retirées → champ supprimé ; « Aucun » → cuisson supprimée', () => {
  const { base, saisie } = modifier(RISOTTO, (s) => { s.etapes = ['  ', '']; s.cuisson = changerCuissonPrincipale(s.cuisson, { appareil: null }); });
  const r = preparerModification(base, saisie, RISOTTO, contexte);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.champs, {});
  assert.deepEqual(r.supprimer, ['etapes', 'cuisson']);
  assert.equal(r.rien, false);
  const vide = modifier(RISOTTO, (s) => { s.etapes = []; });
  assert.deepEqual(preparerModification(vide.base, vide.saisie, RISOTTO, contexte).supprimer, ['etapes']);
});

test('preparerModification : conservation — seuls les sous-champs touchés sont écrits', () => {
  // Jours seulement : la congélation n'est pas réécrite (donnees.js écrit chaque sous-champ à part).
  const jours = modifier(RISOTTO, (s) => { s.frigoJours = 4; });
  assert.deepEqual(preparerModification(jours.base, jours.saisie, RISOTTO, contexte).champs, { conservation: { frigoJours: 4 } });
  // Congélation changée ailleurs entre-temps : elle n'est pas écrasée.
  const ailleurs = { ...clone(RISOTTO), conservation: { frigoJours: 2, congelable: true } };
  assert.deepEqual(preparerModification(jours.base, jours.saisie, ailleurs, contexte).champs.conservation, { frigoJours: 4 });
  // Plat sans conservation : seul le sous-champ touché, jamais la valeur par défaut affichée.
  const congelable = modifier(SOUPE, (s) => { s.congelable = true; });
  assert.deepEqual(preparerModification(congelable.base, congelable.saisie, SOUPE, contexte).champs, { conservation: { congelable: true } });
  const zero = modifier(SOUPE, (s) => { s.frigoJours = 0; });
  assert.deepEqual(preparerModification(zero.base, zero.saisie, SOUPE, contexte).champs, { conservation: { frigoJours: 0 } });
  // « Non précisé » n'est jamais écrit.
  const retour = modifier(RISOTTO, (s) => { s.congelable = null; });
  const r = preparerModification(retour.base, retour.saisie, RISOTTO, contexte);
  assert.deepEqual(r.champs, {});
  const sansRien = modifier(SOUPE, (s) => { s.congelable = true; });
  sansRien.saisie.congelable = null;
  assert.deepEqual(preparerModification(sansRien.base, sansRien.saisie, SOUPE, contexte).champs, {});
  // Jours par défaut des réglages : affichés, jamais écrits sans changement.
  const defaut = normaliserPourEdition(SOUPE, { frigoJoursDefaut: 4 });
  assert.equal(defaut.frigoJours, 4);
  assert.equal(preparerModification(defaut, clone(defaut), SOUPE, { ...contexte, reglages: { frigoJoursDefaut: 4 } }).rien, true);
});

test('preparerModification : nom vide, trop long ou déjà pris par un autre plat', () => {
  const erreurDuNom = (nom) => {
    const { base, saisie } = modifier(RISOTTO, (s) => { s.nom = nom; });
    return preparerModification(base, saisie, RISOTTO, contexte).erreurs;
  };
  assert.deepEqual(erreurDuNom('   '), [{ champ: 'nom', message: 'Donnez un nom au plat.' }]);
  assert.deepEqual(erreurDuNom('x'.repeat(81)), [{ champ: 'nom', message: 'Le nom est trop long (80 caractères au plus).' }]);
  assert.deepEqual(erreurDuNom('x'.repeat(80)), []);
  assert.deepEqual(erreurDuNom('  gratin   TÉST '), [{ champ: 'nom', message: '«\u00A0Gratin test\u00A0» existe déjà.' }]);
  assert.deepEqual(erreurDuNom('Soupe-test'), [{ champ: 'nom', message: '«\u00A0Soupe test\u00A0» existe déjà.' }]);
  assert.equal(erreurDuNom('???')[0].champ, 'nom');
  // Son propre nom, autrement écrit : pas un doublon.
  assert.deepEqual(erreurDuNom('RISOTTO  Test'), []);
});

test('preparerModification : portions hors bornes', () => {
  for (const portions of [0, -1, 2.5, PORTIONS_MAX + 1, '4', null, NaN]) {
    const { base, saisie } = modifier(RISOTTO, (s) => { s.portionsBase = portions; });
    assert.deepEqual(preparerModification(base, saisie, RISOTTO, contexte).erreurs,
      [{ champ: 'portionsBase', message: 'Indiquez au moins une portion.' }], String(portions));
  }
  for (const portions of [1, PORTIONS_MAX]) {
    const { base, saisie } = modifier(RISOTTO, (s) => { s.portionsBase = portions; });
    assert.deepEqual(preparerModification(base, saisie, RISOTTO, contexte).erreurs, [], String(portions));
  }
});

test('preparerModification : au moins un ingrédient ; « Recette vérifiée » seulement avec des ingrédients', () => {
  const vide = modifier(RISOTTO, (s) => { s.ingredients = []; });
  assert.deepEqual(preparerModification(vide.base, vide.saisie, RISOTTO, contexte).erreurs,
    [{ champ: 'ingredients', message: 'Ajoutez au moins un ingrédient.' }]);
  // Plat déjà vérifié, vidé : une seule erreur.
  const verifie = modifier(GRATIN, (s) => { s.ingredients = []; });
  assert.deepEqual(preparerModification(verifie.base, verifie.saisie, GRATIN, contexte).erreurs.map((e) => e.champ), ['ingredients']);
  // Plat ⏳ coché « vérifiée » sans ingrédient.
  const soupe = modifier(SOUPE, (s) => { s.verifiee = true; });
  assert.deepEqual(preparerModification(soupe.base, soupe.saisie, SOUPE, contexte).erreurs,
    [{ champ: 'verifiee', message: 'Ajoutez les ingrédients avant de la marquer vérifiée.' }]);
  // Recette vidée et cochée à la fois.
  const les2 = modifier(RISOTTO, (s) => { s.ingredients = []; s.verifiee = true; });
  assert.deepEqual(preparerModification(les2.base, les2.saisie, RISOTTO, contexte).erreurs.map((e) => e.champ), ['ingredients', 'verifiee']);
});

test('preparerModification : durée de cuisson manquante ou hors bornes', () => {
  const avecDuree = (dureeMin) => {
    const { base, saisie } = modifier(GRATIN, (s) => { s.cuisson = changerCuissonPrincipale(s.cuisson, { appareil: 'four', dureeMin }); });
    return preparerModification(base, saisie, GRATIN, contexte).erreurs;
  };
  const erreur = [{ champ: 'cuisson', message: 'Indiquez la durée de cuisson, en minutes.' }];
  assert.deepEqual(avecDuree(null), erreur, 'durée pas encore saisie (la plaque devient l’étape la plus longue)');
  assert.deepEqual(avecDuree(DUREE_MAX + 1), erreur);
  assert.deepEqual(avecDuree(0), erreur);
  assert.deepEqual(avecDuree(DUREE_MAX), []);
  assert.deepEqual(avecDuree(1), []);
  // Plat sans cuisson : une étape ajoutée sans durée.
  const { base, saisie } = modifier(SOUPE, (s) => {
    s.ingredients.push({ produit: 'poireau', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' });
    s.cuisson = changerCuissonPrincipale(s.cuisson, { appareil: 'plaque', dureeMin: null });
  });
  assert.deepEqual(preparerModification(base, saisie, SOUPE, contexte).erreurs, erreur);
});

test('preparerModification : jours au frigo de 0 à 14', () => {
  const avecJours = (jours) => {
    const { base, saisie } = modifier(RISOTTO, (s) => { s.frigoJours = jours; });
    return preparerModification(base, saisie, RISOTTO, contexte).erreurs;
  };
  for (const jours of [-1, FRIGO_JOURS_MAX + 1, 1.5, '3', null]) {
    assert.deepEqual(avecJours(jours), [{ champ: 'frigoJours', message: 'Nombre de jours au frigo\u00A0: de 0 à 14.' }], String(jours));
  }
  for (const jours of [0, FRIGO_JOURS_MAX]) assert.deepEqual(avecJours(jours), [], String(jours));
});

test('preparerModification : fiche finale refusée par le format d’import → erreur « recette »', () => {
  const unite = modifier(RISOTTO, (s) => { s.ingredients[0].unite = 'poignee'; });
  const r = preparerModification(unite.base, unite.saisie, RISOTTO, contexte);
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.erreurs[0].champ, 'recette');
  assert.match(r.erreurs[0].message, /unité/);
  const type = modifier(RISOTTO, (s) => { s.type = 'soupe'; });
  assert.deepEqual(preparerModification(type.base, type.saisie, RISOTTO, contexte).erreurs.map((e) => e.champ), ['recette']);
  // Seules les erreurs comptent, jamais les avertissements (four sans température).
  const four = modifier(RISOTTO, (s) => { s.cuisson = [{ appareil: 'four', dureeMin: 30 }]; });
  assert.deepEqual(preparerModification(four.base, four.saisie, RISOTTO, contexte).erreurs, []);
});

test('preparerModification : messages d’erreur sans code ni mot technique', () => {
  const messages = [];
  const ajouter = (plat, changer) => {
    const { base, saisie } = modifier(plat, changer);
    messages.push(...preparerModification(base, saisie, plat, contexte).erreurs.map((e) => e.message));
  };
  ajouter(RISOTTO, (s) => { s.nom = ''; s.portionsBase = 0; s.ingredients = []; s.frigoJours = 99; s.cuisson = [{ appareil: 'four' }]; });
  ajouter(RISOTTO, (s) => { s.nom = 'x'.repeat(81); s.verifiee = true; s.ingredients = []; });
  ajouter(RISOTTO, (s) => { s.nom = 'Gratin test'; });
  ajouter(SOUPE, (s) => { s.verifiee = true; });
  assert.equal(messages.length, 10);
  messagesPropres(messages);
});

test('preparerModification : jamais de valeur undefined, même avec une saisie incomplète', () => {
  const base = normaliserPourEdition(RISOTTO, REGLAGES);
  const saisie = { ...clone(base), type: undefined, emporter: undefined, portionsBase: undefined };
  saisie.ingredients[0] = { ...saisie.ingredients[0], forme: undefined };
  const r = preparerModification(base, saisie, RISOTTO, contexte);
  sansUndefined(r);
  assert.equal('type' in r.champs, false);
  assert.equal('emporter' in r.champs, false);
  assert.equal('portionsBase' in r.champs, false);
  // Fiche disparue entre-temps : pas d'exception.
  const disparue = preparerModification(base, { ...clone(base), nom: 'Autre nom' }, null, contexte);
  sansUndefined(disparue);
  assert.equal(disparue.champs.nom, 'Autre nom');
});

test('preparerModification : modification complète valide, écrite telle que la fiche la montrera', () => {
  const catalogue = catalogueProduits(PLATS);
  const { base, saisie } = modifier(RISOTTO, (s) => {
    const jambon = ingredientSaisi(champsDe({ produit: 'jambon', qte: '2', unite: 'tranche' }), { catalogue, ingredients: s.ingredients });
    assert.ok(jambon.erreurs.nature, 'produit jamais vu');
    const lardons = ingredientSaisi(champsDe({ produit: 'lardons', qte: '150', nature: 'viande', forme: 'morceaux', rayon: 'charcuterie' }), { catalogue, ingredients: s.ingredients });
    s.ingredients.push(lardons.ingredient);
    s.ingredients.splice(1, 1);
    s.etapes = deplacer(ajouterEtape(s.etapes, 'Parsemer d’aneth.'), 3, 0);
    s.cuisson = changerCuissonPrincipale(s.cuisson, { appareil: 'plaque', dureeMin: 20 });
    s.portionsBase = 4;
    s.verifiee = true;
  });
  const r = preparerModification(base, saisie, RISOTTO, contexte);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(Object.keys(r.champs).sort(), ['cuisson', 'etapes', 'ingredients', 'portionsBase', 'statutRecette']);
  assert.equal(r.champs.etapes[0], 'Parsemer d’aneth.');
  assert.deepEqual(r.champs.ingredients.map((i) => i.produit), ['riz arborio', 'oignon jaune', 'beurre', 'lardons']);
  sansUndefined(r);
});

// ——— brouillonValide ———

test('brouillonValide : brouillon intact, y compris après un passage par le stockage', () => {
  const brouillon = { v: 1, base: normaliserPourEdition(RISOTTO), saisie: normaliserPourEdition(SOUPE), depuis: Date.now() };
  assert.equal(brouillonValide(brouillon), true);
  assert.equal(brouillonValide(JSON.parse(JSON.stringify(brouillon))), true);
  const { base, saisie } = modifier(GRATIN, (s) => { s.congelable = null; s.cuisson = []; });
  assert.equal(brouillonValide({ v: 1, base, saisie, depuis: 0 }), true);
});

test('brouillonValide : brouillon abîmé refusé', () => {
  const base = normaliserPourEdition(RISOTTO);
  const bon = { v: 1, base, saisie: clone(base), depuis: 1700000000000 };
  const abimes = [
    null, undefined, 'brouillon', [], {},
    { ...bon, v: 2 }, { ...bon, v: '1' }, { ...bon, depuis: undefined }, { ...bon, depuis: '1700' }, { ...bon, depuis: NaN },
    { ...bon, base: undefined }, { ...bon, saisie: null }, { ...bon, saisie: [] },
  ];
  const saisieAbimee = (changer) => {
    const saisie = clone(base);
    changer(saisie);
    return { ...bon, saisie };
  };
  abimes.push(
    saisieAbimee((s) => { delete s.nom; }),
    saisieAbimee((s) => { s.inconnu = 1; }),
    saisieAbimee((s) => { s.nom = 12; }),
    saisieAbimee((s) => { s.type = null; }),
    saisieAbimee((s) => { s.portionsBase = '4'; }),
    saisieAbimee((s) => { s.portionsBase = null; }),
    saisieAbimee((s) => { s.ingredients = {}; }),
    saisieAbimee((s) => { s.ingredients = [null]; }),
    saisieAbimee((s) => { s.etapes = ['a', 2]; }),
    saisieAbimee((s) => { s.cuisson = ['four']; }),
    saisieAbimee((s) => { s.frigoJours = '3'; }),
    saisieAbimee((s) => { s.congelable = 'oui'; }),
    saisieAbimee((s) => { s.emporter = null; }),
    saisieAbimee((s) => { s.verifiee = 'true'; }),
  );
  abimes.forEach((brouillon, i) => assert.equal(brouillonValide(brouillon), false, `cas ${i}`));
  // La base est vérifiée comme la saisie.
  assert.equal(brouillonValide({ ...bon, base: { ...base, etapes: 'a' } }), false);
});
