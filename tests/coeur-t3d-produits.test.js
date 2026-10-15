// T3d « Placard, habituels et rayons » : produits hors cuisine du dictionnaire (`recette: false`), absents de
// « Modifier la recette » mais reconnus par l'identifiant d'une ligne et proposés par « Ajouter à la liste » ; réglages
// d'un produit lus champ par champ (rayon, placard, habituel, mot cherché), sous son id puis ses clés de repli
// (produits.js › ficheProduit, clesDuProduit, reglageDuFoyer, rayonDeDepart). Le nom du fichier l'écarte de la
// couverture des fixtures du dictionnaire (tests/coeur-dictionnaire.test.js, point 11). Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleProduit } from '../js/coeur/slug.js';
import { DICTIONNAIRE } from '../js/coeur/dictionnaire.js';
import { VOCABULAIRES } from '../js/coeur/vocabulaire.js';
import { RECHERCHE_MAX } from '../js/coeur/drive.js';
import {
  HABITUEL_LIBELLE_MAX, HABITUEL_QTE_MAX, clesDuProduit, elementsDuDictionnaire, entreeCourante, entreeParId,
  estHorsCuisine, ficheProduit, idProduit, indexDesRecettes, lireHabituel, lirePlacardFoyer, lireRayonFoyer,
  lireRechercheFoyer, rayonDeDepart, reconnaitre, reglageDuFoyer,
} from '../js/coeur/produits.js';
import { catalogueAvecDictionnaire, ingredientSaisi, suggestions } from '../js/coeur/edition.js';
import { IDS_DICTIONNAIRE } from './donnees/ids-dictionnaire.js';

const HORS_CUISINE = DICTIONNAIRE.filter((e) => e.recette === false);
/** Produits alimentaires pour la liste seulement (2026-10-16) : jamais dans une recette, rangés dans leur rayon. */
const LISTE_SEULEMENT_ALIMENTAIRE = new Set(['barre-de-cereale', 'gourde-de-compote', 'yaourt-a-boire', 'pizza-surgelee',
  'lait-infantile', 'lait-2e-age', 'lait-de-croissance', 'petit-pot', 'cereale-bebe', 'biscuit-bebe']);
const formes = (entree) => [entree.nom, ...(entree.alias ?? [])];

/**
 * Identité des écritures hors cuisine AVANT T3d (calculée avec le code de main e6437ec, une fois, figée) : chacune
 * était un nom inconnu, de clé propre (cleProduit), jamais l'id d'un autre produit. Une coche, un mot cherché ou un
 * réglage rangés sous cette clé restent lus par la clé de repli de la ligne ou de l'article.
 */
const AVANT_T3D = new Map([
  ['papier toilette', 'papier-toilette'], ['papier hygiénique', 'papier-hygienique'], ['mouchoir', 'mouchoir'],
  ['mouchoir en papier', 'mouchoir-en-papier'], ['coton', 'coton'], ['disque de coton', 'disque-de-coton'],
  ['coton-tige', 'coton-tige'], ['dentifrice', 'dentifrice'], ['brosse à dents', 'brosse-a-dent'],
  ['fil dentaire', 'fil-dentaire'], ['bain de bouche', 'bain-de-bouche'], ['shampooing', 'shampooing'],
  ['shampoing', 'shampoing'], ['après-shampooing', 'apre-shampooing'], ['après-shampoing', 'apre-shampoing'],
  ['gel douche', 'gel-douche'], ['savon', 'savon'], ['déodorant', 'deodorant'], ['rasoir', 'rasoir'],
  ['mousse à raser', 'mousse-a-raser'], ['serviette hygiénique', 'serviette-hygienique'],
  ['tampon hygiénique', 'tampon-hygienique'], ['protège-slip', 'protege-slip'], ['couches', 'couche'],
  ['lingette', 'lingette'], ['pansement', 'pansement'], ['éponge', 'eponge'], ['lavette', 'lavette'],
  ['serpillière', 'serpilliere'], ['gant de ménage', 'gant-de-menage'], ['essuie-tout', 'essuie-tout'],
  ['liquide vaisselle', 'liquide-vaisselle'], ['produit vaisselle', 'produit-vaisselle'],
  ['liquide de rinçage', 'liquide-de-rincage'], ['pastille lave-vaisselle', 'pastille-lave-vaisselle'],
  ['tablette lave-vaisselle', 'tablette-lave-vaisselle'], ['sel régénérant', 'sel-regenerant'],
  ['sel lave-vaisselle', 'sel-lave-vaisselle'], ['lessive', 'lessive'], ['adoucissant', 'adoucissant'],
  ['détachant', 'detachant'], ['eau de javel', 'eau-de-javel'], ['javel', 'javel'], ['nettoyant wc', 'nettoyant-wc'],
  ['gel wc', 'gel-wc'], ['nettoyant vitres', 'nettoyant-vitre'], ['nettoyant multi-usage', 'nettoyant-multi-usage'],
  ['nettoyant ménager', 'nettoyant-menager'], ['vinaigre ménager', 'vinaigre-menager'], ['sac poubelle', 'sac-poubelle'],
  ['papier aluminium', 'papier-aluminium'], ['papier alu', 'papier-alu'], ['aluminium', 'aluminium'],
  ['film alimentaire', 'film-alimentaire'], ['film étirable', 'film-etirable'], ['papier cuisson', 'papier-cuisson'],
  ['papier sulfurisé', 'papier-sulfurise'], ['sac congélation', 'sac-congelation'],
  ['sac de congélation', 'sac-de-congelation'], ['piles', 'pile'], ['ampoule', 'ampoule'], ['allumette', 'allumette'],
  ['bougie', 'bougie'], ['briquet', 'briquet'], ['ruban adhésif', 'ruban-adhesif'], ['litière', 'litiere'],
  ['gobelet', 'gobelet'], ['assiette en carton', 'assiette-en-carton'], ['serviette en papier', 'serviette-en-papier'],
  ['cure-dent', 'cure-dent'], ['pique à brochette', 'pique-a-brochette'], ['ficelle de cuisine', 'ficelle-de-cuisine'],  // 2026-10-16 : courses du quotidien pour la liste seulement (chaque écriture était inconnue : sa propre clé).
  ['barre de céréales', 'barre-de-cereale'], ['gourde de compote', 'gourde-de-compote'],
  ['compote à boire', 'compote-a-boire'], ['yaourt à boire', 'yaourt-a-boire'], ['pizza surgelée', 'pizza-surgelee'],
  ['lait infantile', 'lait-infantile'], ['lait bébé', 'lait-bebe'], ['lait 1er âge', 'lait-1er-age'],
  ['lait premier âge', 'lait-premier-age'], ['lait 2e âge', 'lait-2e-age'],
  ['lait deuxième âge', 'lait-deuxieme-age'], ['lait de suite', 'lait-de-suite'],
  ['lait de croissance', 'lait-de-croissance'], ['petit pot', 'petit-pot'], ['petit pot bébé', 'petit-pot-bebe'],
  ['céréales bébé', 'cereale-bebe'], ['céréales infantiles', 'cereale-infantile'], ['biscuit bébé', 'biscuit-bebe'],
  ['couche-culotte', 'couche-culotte'], ['liniment', 'liniment'],
  ['liniment oléo-calcaire', 'liniment-oleo-calcaire'], ['crème pour le change', 'creme-pour-le-change'],
  ['crème de change', 'creme-de-change'], ['sérum physiologique', 'serum-physiologique'],
  ['dosette de sérum physiologique', 'dosette-de-serum-physiologique'], ['gel lavant bébé', 'gel-lavant-bebe'],
  ['shampooing enfant', 'shampooing-enfant'], ['shampooing bébé', 'shampooing-bebe'],
  ['shampoing enfant', 'shampoing-enfant'], ['shampoing bébé', 'shampoing-bebe'],
  ['dentifrice enfant', 'dentifrice-enfant'], ['brosse à dents enfant', 'brosse-a-dent-enfant'],
  ['crème solaire', 'creme-solaire'], ['protection solaire', 'protection-solaire'],
  ['écran solaire', 'ecran-solaire'], ['crème solaire enfant', 'creme-solaire-enfant'],
  ['après-soleil', 'apre-soleil'], ['crème hydratante', 'creme-hydratante'],
  ['crème pour les mains', 'creme-pour-le-main'],
  ['baume à lèvres', 'baume-a-levre'], ['stick à lèvres', 'stick-a-levre'], ['démaquillant', 'demaquillant'],
  ['bain moussant', 'bain-moussant'],
  ['gel hydroalcoolique', 'gel-hydroalcoolique'], ['démêlant', 'demelant'], ['spray démêlant', 'spray-demelant'],
  ['shampooing anti-poux', 'shampooing-anti-pou'], ['shampoing anti-poux', 'shampoing-anti-pou'],
  ['lotion anti-poux', 'lotion-anti-pou'], ['peigne anti-poux', 'peigne-anti-pou'],
  ['élastique à cheveux', 'elastique-a-cheveu'], ['tétine', 'tetine'], ['biberon', 'biberon'], ['cahier', 'cahier'],
  ['stylo', 'stylo'], ['crayon à papier', 'crayon-a-papier'], ['crayon de papier', 'crayon-de-papier'],
  ['crayon de couleur', 'crayon-de-couleur'], ['feutre', 'feutre'], ['gomme', 'gomme'], ['colle', 'colle'],
  ['bâton de colle', 'baton-de-colle'], ['tube de colle', 'tube-de-colle'],
]);

// ——— Dictionnaire : produits hors cuisine ———

test('hors cuisine : une centaine de produits pour la liste seulement, hygiène, entretien et divers surtout ; `recette: false`, ni repère ni placard', () => {
  assert.ok(HORS_CUISINE.length >= 90 && HORS_CUISINE.length <= 110, `${HORS_CUISINE.length} produits hors cuisine`);
  for (const entree of HORS_CUISINE) {
    // 2026-10-16 : quelques produits alimentaires pour la liste seulement (lait infantile, petit pot), dans leur rayon.
    assert.ok(['hygiene', 'entretien', 'divers'].includes(entree.rayon) || LISTE_SEULEMENT_ALIMENTAIRE.has(entree.id), `${entree.id} : rayon`);
    assert.equal(entree.unite, 'pc', entree.id);
    for (const champ of ['marqueurs', 'forme', 'role', 'placard', 'equivalences']) assert.equal(champ in entree, false, `${entree.id} : ${champ}`);
    assert.ok(estHorsCuisine(entree), entree.id);
    assert.ok(IDS_DICTIONNAIRE.includes(entree.id), `${entree.id} : id figé`);
  }
  // Aucun produit de cuisine n'est rangé en hygiène, entretien ni divers ; un produit de cuisine n'a jamais `recette`.
  assert.deepEqual(DICTIONNAIRE.filter((e) => ['hygiene', 'entretien', 'divers'].includes(e.rayon) && e.recette !== false).map((e) => e.id), []);
  assert.equal(estHorsCuisine(DICTIONNAIRE.find((e) => e.id === 'lait')), false);
  assert.equal(estHorsCuisine(null), false);
  // Des trois rayons, et les exemples du plan.
  for (const rayon of ['hygiene', 'entretien', 'divers']) assert.ok(HORS_CUISINE.some((e) => e.rayon === rayon), rayon);
  const parId = Object.fromEntries(HORS_CUISINE.map((e) => [e.id, e.rayon]));
  assert.deepEqual([parId.pile, parId.eponge, parId.lessive, parId['papier-toilette'], parId.dentifrice, parId.ampoule],
    ['divers', 'entretien', 'entretien', 'hygiene', 'hygiene', 'divers']);
});

test('hors cuisine : avant T3d, chaque écriture était inconnue (sa propre clé) ; après, l’id de son entrée (table figée)', () => {
  const toutes = HORS_CUISINE.flatMap(formes);
  assert.deepEqual([...AVANT_T3D.keys()].sort(), [...toutes].sort(), 'AVANT_T3D à jour');
  const idsCuisine = new Set(DICTIONNAIRE.filter((e) => e.recette !== false).map((e) => e.id));
  for (const entree of HORS_CUISINE) {
    for (const forme of formes(entree)) {
      const avant = AVANT_T3D.get(forme);
      assert.equal(avant, cleProduit(forme), `${forme} : sa propre clé`);
      assert.equal(idsCuisine.has(avant), false, `${forme} : jamais l’id d’un produit de cuisine`);
      assert.equal(idProduit(forme), entree.id, forme);
    }
    // Un nom courant donne son id (ids tirés du nom) : rien ne bouge pour lui.
    assert.equal(AVANT_T3D.get(entree.nom), entree.id, entree.nom);
  }
  // Pluriel, casse et accents : la même entrée.
  for (const [saisie, id] of [['Piles', 'pile'], ['PILES', 'pile'], ['éponges', 'eponge'], ['eponge', 'eponge'],
    ['Sacs poubelle', 'sac-poubelle'], ['papier hygienique', 'papier-toilette'], ['Couche', 'couche']]) {
    assert.equal(idProduit(saisie), id, saisie);
  }
  // Une saisie voisine reste à part (jamais de ressemblance).
  assert.equal(idProduit('Piles AA'), 'pile-aa');
});

test('hors cuisine : jamais reconnus ni proposés par « Modifier la recette » ; la question de nature reste', () => {
  for (const entree of HORS_CUISINE) {
    for (const forme of formes(entree)) assert.equal(reconnaitre(forme), null, forme);
  }
  assert.ok(ingredientSaisi({ produit: 'lessive', qte: 1, unite: 'pc' }, { dictionnaire: true }).erreurs.nature);
  const cuisine = catalogueAvecDictionnaire([]);
  assert.equal(cuisine.some((e) => e.horsCuisine), false);
  assert.deepEqual(suggestions(cuisine, 'pil').map((e) => e.produit), ['pilon de poulet']);
  assert.equal(suggestions(cuisine, 'lessiv').length, 0);
  assert.equal(elementsDuDictionnaire().some((e) => e.horsCuisine), false);
  // Les produits de cuisine restent reconnus, même ceux dont un mot est celui d'un produit hors cuisine.
  assert.equal(reconnaitre('sel').entree.id, 'sel');
  assert.equal(reconnaitre('eau').entree.id, 'eau');
  assert.equal(reconnaitre('vinaigre blanc').entree.id, 'vinaigre-blanc');
});

test('hors cuisine : proposés par « Ajouter à la liste » (catalogue avec `horsCuisine`), sous leur nom courant', () => {
  const courses = catalogueAvecDictionnaire([], { horsCuisine: true });
  assert.deepEqual(suggestions(courses, 'pil').map((e) => e.produit), ['piles', 'pilon de poulet']);
  assert.deepEqual(suggestions(courses, 'papier h').map((e) => e.produit), ['papier toilette']);
  assert.deepEqual(suggestions(courses, 'eau', { max: 4 }).map((e) => e.produit), ['eau', 'eau gazeuse', 'eau minérale', 'eau de javel']);
  const piles = suggestions(courses, 'piles')[0];
  assert.equal(piles.horsCuisine, true);
  assert.equal(piles.rayon, 'divers');
  // Un produit du foyer passe toujours avant (un ingrédient « piles » dans une recette, par erreur, reste du foyer).
  const foyer = [{ id: 'a', nom: 'A', ingredients: [{ produit: 'piles', qte: 1, unite: 'pc', rayon: 'divers', marqueurs: [] }] }];
  const avecFoyer = catalogueAvecDictionnaire(foyer, { horsCuisine: true });
  assert.equal(avecFoyer.filter((e) => e.produit === 'piles').length, 1);
  assert.notEqual(avecFoyer.find((e) => e.produit === 'piles').origine, 'dictionnaire');
});

test('hors cuisine : entreeCourante et entreeParId les connaissent (Courses) ; fiche : nom et rayon courants', () => {
  assert.equal(entreeCourante('lessive').id, 'lessive');
  assert.equal(entreeParId('pile').nom, 'piles');
  assert.deepEqual(ficheProduit('pile').nom, { valeur: 'piles', source: 'courants' });
  assert.deepEqual(ficheProduit('eponge').rayon, { valeur: 'entretien', source: 'courants' });
  assert.deepEqual(ficheProduit('pile').placard, { valeur: null, source: 'defaut' });
});

// ——— Réglages d'un produit écrits par le foyer ———

test('lireRayonFoyer, lirePlacardFoyer, lireRechercheFoyer : valeurs propres, sinon null', () => {
  for (const rayon of VOCABULAIRES.rayon) assert.equal(lireRayonFoyer(rayon), rayon);
  for (const brut of ['cave', '', null, undefined, 3, { rayon: 'divers' }, 'Divers']) assert.equal(lireRayonFoyer(brut), null, String(brut));
  assert.deepEqual(lirePlacardFoyer({ actif: true }), { actif: true });
  assert.deepEqual(lirePlacardFoyer({ actif: false, autre: 1 }), { actif: false });
  for (const brut of [{}, { actif: 'oui' }, true, null, [], { actif: null }]) assert.equal(lirePlacardFoyer(brut), null, JSON.stringify(brut));
  assert.equal(lireRechercheFoyer('  penne   rigate '), 'penne rigate');
  assert.equal(lireRechercheFoyer('x'.repeat(RECHERCHE_MAX)), 'x'.repeat(60));
  for (const brut of ['', '   ', 'x'.repeat(RECHERCHE_MAX + 1), 3, null]) assert.equal(lireRechercheFoyer(brut), null, String(brut));
});

test('lireHabituel : actif, quantité et unité ensemble, nom gardé ; le reste omis, jamais bloquant', () => {
  assert.deepEqual(lireHabituel({ actif: true, qte: 6, unite: 'l', libelle: ' lait  demi-écrémé ' }),
    { actif: true, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' });
  assert.deepEqual(lireHabituel({ actif: false }), { actif: false });
  assert.deepEqual(lireHabituel({ actif: true, qte: 0.5, unite: 'kg' }), { actif: true, qte: 0.5, unite: 'kg' });
  // Quantité sans unité, unité inconnue, quantité nulle, négative ou trop grande : sans quantité.
  for (const brut of [{ qte: 6 }, { qte: 6, unite: 'litre' }, { qte: 0, unite: 'l' }, { qte: -1, unite: 'l' },
    { qte: HABITUEL_QTE_MAX + 1, unite: 'g' }, { qte: '6', unite: 'l' }, { unite: 'l' }]) {
    assert.deepEqual(lireHabituel({ actif: true, ...brut }), { actif: true }, JSON.stringify(brut));
  }
  assert.deepEqual(lireHabituel({ actif: true, qte: HABITUEL_QTE_MAX, unite: 'g' }), { actif: true, qte: HABITUEL_QTE_MAX, unite: 'g' });
  assert.deepEqual(lireHabituel({ actif: true, libelle: 'x'.repeat(HABITUEL_LIBELLE_MAX + 1) }), { actif: true });
  assert.deepEqual(lireHabituel({ actif: true, libelle: '   ' }), { actif: true });
  for (const brut of [null, {}, { actif: 'oui' }, [], 'lait']) assert.equal(lireHabituel(brut), null, JSON.stringify(brut));
  assert.equal(HABITUEL_LIBELLE_MAX, 60);
});

test('clesDuProduit : l’id puis ses clés de repli, sans doublon ; jamais de repli pour un homographe', () => {
  assert.deepEqual(clesDuProduit('farine', { replis: ['farine-t55', 'farine', '', null, 'farine-t55', 'farine-t45'] }),
    ['farine', 'farine-t55', 'farine-t45']);
  assert.deepEqual(clesDuProduit('farine', { repli: 'farine-t55' }), ['farine', 'farine-t55']);
  assert.deepEqual(clesDuProduit('farine'), ['farine']);
  assert.deepEqual(clesDuProduit('pate--pa3te1', { replis: ['pate'] }), ['pate--pa3te1']);
  assert.deepEqual(clesDuProduit(''), []);
  assert.deepEqual(clesDuProduit(null), []);
});

test('reglageDuFoyer : chaque champ se lit à part, le premier document lisible dans l’ordre des clés', () => {
  const produitsFoyer = {
    farine: { rechercheDrive: 'farine fluide', rayon: 'cave' },
    'farine-t55': { rayon: 'surgeles', placard: { actif: false } },
  };
  const cles = ['farine', 'farine-t55'];
  assert.deepEqual(reglageDuFoyer(produitsFoyer, cles, 'rayon', lireRayonFoyer), { valeur: 'surgeles', cle: 'farine-t55' });
  assert.deepEqual(reglageDuFoyer(produitsFoyer, cles, 'rechercheDrive', lireRechercheFoyer), { valeur: 'farine fluide', cle: 'farine' });
  assert.deepEqual(reglageDuFoyer(produitsFoyer, cles, 'placard', lirePlacardFoyer), { valeur: { actif: false }, cle: 'farine-t55' });
  assert.equal(reglageDuFoyer(produitsFoyer, cles, 'habituel', lireHabituel), null);
  assert.equal(reglageDuFoyer(new Map(Object.entries(produitsFoyer)), ['farine-t55'], 'rayon', lireRayonFoyer).valeur, 'surgeles');
  assert.equal(reglageDuFoyer(null, cles, 'rayon', lireRayonFoyer), null);
});

test('ficheProduit : rayon, placard, habituel et mot cherché du foyer, champ par champ, sous l’id puis ses clés de repli', () => {
  const produitsFoyer = {
    farine: { rechercheDrive: 'farine fluide' },
    'farine-t55': { rayon: 'surgeles', placard: { actif: false }, habituel: { actif: true, qte: 1, unite: 'kg', libelle: 'farine t55' } },
  };
  const fiche = ficheProduit('farine', { produitsFoyer, replis: ['farine-t55'] });
  assert.deepEqual(fiche.recherche, { valeur: 'farine fluide', source: 'foyer' });
  assert.deepEqual(fiche.rayon, { valeur: 'surgeles', source: 'foyer' });
  assert.deepEqual(fiche.placard, { valeur: null, source: 'foyer' });
  assert.deepEqual(fiche.habituel, { valeur: { actif: true, qte: 1, unite: 'kg', libelle: 'farine t55' }, source: 'foyer' });
  // Sans les clés de repli : seulement l'id.
  const seule = ficheProduit('farine', { produitsFoyer });
  assert.deepEqual([seule.rayon.source, seule.placard.source, seule.habituel.valeur], ['courants', 'courants', null]);
  // `repli` (une seule clé) reste compris.
  assert.equal(ficheProduit('farine', { produitsFoyer, repli: 'farine-t55' }).rayon.valeur, 'surgeles');
  // Un réglage de l'id passe avant celui d'une clé de repli, même éteint.
  const deux = { farine: { habituel: { actif: false } }, 'farine-t55': { habituel: { actif: true } } };
  assert.deepEqual(ficheProduit('farine', { produitsFoyer: deux, replis: ['farine-t55'] }).habituel, { valeur: null, source: 'defaut' });
  // Un homographe ne lit jamais les réglages d'une clé voisine.
  const pate = ficheProduit('pate--pa3te1', { produitsFoyer: { pate: { rayon: 'surgeles' } }, replis: ['pate'], saisie: 'pâté' });
  assert.notEqual(pate.rayon.valeur, 'surgeles');
});

test('ficheProduit : placard du foyer sur un produit hors du placard de départ → toujours mis de côté ; à seuil → le seuil reste', () => {
  assert.deepEqual(ficheProduit('beurre-demi-sel', { produitsFoyer: { 'beurre-demi-sel': { placard: { actif: true } } } }).placard,
    { valeur: {}, source: 'foyer' });
  assert.deepEqual(ficheProduit('beurre-demi-sel').placard, { valeur: null, source: 'defaut' });
  assert.deepEqual(ficheProduit('beurre', { produitsFoyer: { beurre: { placard: { actif: true } } } }).placard,
    { valeur: { seuil: 30, unite: 'g' }, source: 'foyer' });
  assert.deepEqual(ficheProduit('sel', { produitsFoyer: { sel: { placard: { actif: false } } } }).placard, { valeur: null, source: 'foyer' });
  // Un placard illisible ne compte pas : le départ reste.
  assert.deepEqual(ficheProduit('sel', { produitsFoyer: { sel: { placard: { actif: 'non' } } } }).placard, { valeur: {}, source: 'courants' });
});

test('rayonDeDepart : recettes > produit courant > divers ; jamais le réglage du foyer', () => {
  const index = indexDesRecettes([{ id: 'a', nom: 'A', ingredients: [{ produit: 'beurre', qte: 1, unite: 'g', rayon: 'fromages', marqueurs: [] }] }]);
  assert.deepEqual(rayonDeDepart('beurre', { index }), { valeur: 'fromages', source: 'recettes' });
  assert.deepEqual(rayonDeDepart('beurre'), { valeur: 'cremerie', source: 'courants' });
  assert.deepEqual(rayonDeDepart('croquette-pour-chat'), { valeur: 'divers', source: 'defaut' });
  assert.deepEqual(rayonDeDepart('lessive'), { valeur: 'entretien', source: 'courants' });
  assert.deepEqual(ficheProduit('beurre', { index, produitsFoyer: { beurre: { rayon: 'surgeles' } } }).rayon, { valeur: 'surgeles', source: 'foyer' });
  assert.deepEqual(ficheProduit('beurre', { index }).rayon, rayonDeDepart('beurre', { index }));
});

test('produits.js : le mot cherché a la même borne que drive.js (recopiée, sans import)', () => {
  assert.equal(lireRechercheFoyer('x'.repeat(RECHERCHE_MAX)) !== null, true);
  assert.equal(lireRechercheFoyer('x'.repeat(RECHERCHE_MAX + 1)), null);
});
