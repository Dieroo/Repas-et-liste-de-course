// T3a « La semaine et sa liste » : identifiant d'un produit des courses (produits.js › idProduit), accès aux produits
// courants (entreeCourante, entreeParId), ce que les recettes disent de chaque produit (indexDesRecettes) et fiche d'un
// produit, champ par champ (ficheProduit). Les homographes (pâte, pâté, pâtes) et les noms inconnus des fixtures vivent
// ici (fichier écarté de la couverture du dictionnaire par son nom). Fixtures génériques : aucune donnée du foyer.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleProduit } from '../js/coeur/slug.js';
import { DICTIONNAIRE } from '../js/coeur/dictionnaire.js';
import {
  entreeCourante, entreeParId, ficheProduit, idProduit, indexDesRecettes, reconnaitre,
} from '../js/coeur/produits.js';
import { listeDeCourses } from '../js/coeur/liste.js';
import { CORPUS_INGREDIENTS } from './donnees/corpus-ingredients.js';

const ing = (produit, qte, unite, rayon = 'epicerie_salee', marqueurs = []) => ({ produit, qte, unite, rayon, marqueurs });
const plat = (id, ingredients, extra = {}) => ({
  id, nom: extra.nom ?? `Plat ${id}`, type: 'plat', statutRecette: 'brouillon', portionsBase: 2, ingredients, ...extra,
});
const ADULTE = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const semaineDe = (...ids) => ({
  id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: 0,
  plats: Object.fromEntries(ids.map((id, i) => [id, { ajouteLe: i + 1 }])),
});

// ——— idProduit ———

test('idProduit : le tableau du plan (§3.4)', () => {
  const attendus = {
    pâtes: 'pate', Pâtes: 'pate', pates: 'pate', 'pâtes courtes': 'pate',
    pâte: 'pate--pa3te',
    pâté: 'pate--pa3te1', pâtés: 'pate--pa3te1',
    pate: 'pate--pate',
    'pâté de campagne': 'pate-de-campagne',
    'pâtes complètes': 'pate-complete--pa3te', 'pates complètes': 'pate-complete--pa3te',
    'pate brisee': 'pate-brisee--pate',
    oignon: 'oignon-jaune', oignons: 'oignon-jaune', 'oignon jaune': 'oignon-jaune', 'Oignons Jaunes': 'oignon-jaune',
    thé: 'the', the: 'the--the',
    'tofu fumé maison': 'tofu-fume-maison',
  };
  for (const [nom, id] of Object.entries(attendus)) assert.equal(idProduit(nom), id, nom);
});

test('idProduit : pâte, pâté et pâtes n’ont jamais le même id ; « pâte » est lue avant les produits courants', () => {
  const ids = ['pâte', 'pâté', 'pâtes', 'pate'].map(idProduit);
  assert.equal(new Set(ids).size, 4);
  // Les produits courants rendraient les pâtes pour « pâte » (le pluriel retiré) : l'ambiguïté passe avant.
  assert.equal(cleProduit('pâte'), cleProduit('pâtes'));
  assert.notEqual(idProduit('pâte'), idProduit('pâtes'));
  // Accents codés : aigu 1, grave 2, circonflexe 3, tréma 4, cédille 5.
  assert.equal(idProduit('farine de maïs'), 'farine-de-mai--mai4');
  assert.equal(idProduit('pêches plates'), 'peche-plate--pe3che');
  assert.equal(idProduit('peches plates'), 'peche-plate--peche');
});

test('idProduit : produits courants par leur nom et leurs autres écritures ; nom inconnu → cleProduit', () => {
  assert.equal(idProduit(' Sel fin '), 'sel');
  assert.equal(idProduit('lardons'), 'lardon-fume');
  assert.equal(idProduit('pâte brisée'), 'pate-brisee');
  assert.equal(idProduit('eau tiède'), 'eau');
  assert.equal(idProduit('fumet'), 'fumet-de-poisson');
  assert.equal(idProduit('gousse d’ail'), 'ail', 'apostrophe typographique');
  assert.equal(idProduit('vinaigre de vin'), 'vinaigre-de-vin');
  assert.equal(idProduit('piles'), 'pile');
  assert.equal(idProduit('Papier Toilette'), 'papier-toilette');
});

test('idProduit : vide ou illisible → \'\' ; toujours un chemin sûr, jamais deux tirets hors homographe', () => {
  for (const nom of ['', '   ', '!?', undefined, null, 42, {}]) assert.equal(idProduit(nom), '', String(nom));
  for (const nom of [...CORPUS_INGREDIENTS, ...DICTIONNAIRE.flatMap((e) => [e.nom, ...(e.alias ?? [])])]) {
    const id = idProduit(nom);
    assert.match(id, /^[a-z0-9-]+$/, nom);
    if (id.includes('--')) assert.ok(id.split('--')[0].split('-').some((mot) => ['pate', 'the', 'mai', 'rose', 'mure', 'cote', 'peche', 'sale'].includes(mot)), nom);
  }
});

test('idProduit : ne dépend pas des recettes du foyer (même nom, même id, quoi que disent les recettes)', () => {
  // Une recette du foyer qui écrirait « pâtes » comme une viande ne change rien à l'id ni à la reconnaissance.
  const avant = idProduit('pâtes');
  indexDesRecettes([plat('x', [ing('pâtes', 1, 'pc', 'boucherie', ['viande'])])]);
  assert.equal(idProduit('pâtes'), avant);
  assert.equal(idProduit.length, 1, 'un seul paramètre : le nom');
});

// ——— entreeCourante, entreeParId ———

test('entreeCourante : l’entrée des produits courants ; nom ambigu seul ou inconnu → null', () => {
  assert.equal(entreeCourante('oignons')?.id, 'oignon-jaune');
  assert.equal(entreeCourante('Pâtes')?.id, 'pate');
  assert.equal(entreeCourante('pâté de campagne')?.id, 'pate-de-campagne');
  for (const nom of ['pâte', 'pâté', 'pâtés', 'pate', 'the', 'tofu fumé maison', '', null, 42]) {
    assert.equal(entreeCourante(nom), null, String(nom));
  }
  // Même entrée que reconnaitre (sans foyer).
  assert.equal(entreeCourante('sel fin'), reconnaitre('sel fin').entree);
});

test('entreeParId : l’entrée de cet id ; id inconnu, vide ou non texte → null', () => {
  assert.equal(entreeParId('sel').nom, 'sel');
  assert.deepEqual(entreeParId('laurier').placard, {}, 'herbe sèche : toujours à la maison (décision du 2026-10-11)');
  assert.deepEqual(entreeParId('beurre').placard, { seuil: 30, unite: 'g' });
  for (const id of ['inconnu', '', null, undefined, 3, 'pate--pa3te']) assert.equal(entreeParId(id), null, String(id));
  for (const entree of DICTIONNAIRE) assert.equal(entreeParId(entree.id), entree, entree.id);
});

// ——— indexDesRecettes ———

test('indexDesRecettes : noms et rayons comptés par produit, ingrédients et ajouts des versions', () => {
  const plats = [
    plat('a', [ing('Oignons', 2, 'pc', 'fruits_legumes'), ing('pâtes courtes', 200, 'g')]),
    plat('b', [ing('oignon', 1, 'pc', 'fruits_legumes'), ing('oignon', 1, 'pc', 'epicerie_salee')], {
      variantes: [{ pour: 'profil-b', retirer: [], ajouter: [{ produit: 'tofu fumé maison', qtePortion: 50, unite: 'g', rayon: 'cremerie', marqueurs: [] }] }],
    }),
    { id: 'sans-ingredients', nom: 'Plat ⏳' },
    null,
  ];
  const index = indexDesRecettes(plats);
  assert.deepEqual([...index.keys()].sort(), ['oignon-jaune', 'pate', 'tofu-fume-maison']);
  assert.deepEqual([...index.get('oignon-jaune').noms], [['oignons', 1], ['oignon', 2]]);
  assert.deepEqual([...index.get('oignon-jaune').rayons], [['fruits_legumes', 2], ['epicerie_salee', 1]]);
  assert.deepEqual([...index.get('tofu-fume-maison').rayons], [['cremerie', 1]]);
  // Rayon hors vocabulaire ignoré ; nom vide ignoré.
  const autre = indexDesRecettes([plat('c', [ing('farine', 100, 'g', 'rayon-inconnu'), ing('', 1, 'g')])]);
  assert.deepEqual([...autre.get('farine').rayons], []);
  assert.equal(autre.size, 1);
});

test('indexDesRecettes : même tableau → même Map (mémoire) ; entrée illisible → Map vide', () => {
  const plats = [plat('a', [ing('sel', 1, 'pincee')])];
  assert.equal(indexDesRecettes(plats), indexDesRecettes(plats));
  assert.notEqual(indexDesRecettes([...plats]), indexDesRecettes(plats));
  for (const illisible of [null, undefined, 'x', {}]) assert.equal(indexDesRecettes(illisible).size, 0);
});

// ——— ficheProduit ———

test('ficheProduit : nom le plus fréquent des recettes, à égalité le plus court puis l’ordre alphabétique', () => {
  const index = indexDesRecettes([
    plat('a', [ing('pâtes courtes', 1, 'g'), ing('pâtes', 1, 'g')]),
    plat('b', [ing('pâtes courtes', 1, 'g')]),
  ]);
  assert.deepEqual(ficheProduit('pate', { index }).nom, { valeur: 'pâtes courtes', source: 'recettes' });
  const egalite = indexDesRecettes([plat('c', [ing('pâtes courtes', 1, 'g'), ing('pâtes', 1, 'g')])]);
  assert.deepEqual(ficheProduit('pate', { index: egalite }).nom, { valeur: 'pâtes', source: 'recettes' });
  const memeLongueur = indexDesRecettes([plat('d', [ing('oignons', 1, 'pc'), ing('oignon', 1, 'pc'), ing('oignonx', 1, 'pc')])]);
  assert.equal(ficheProduit('oignon-jaune', { index: memeLongueur }).nom.valeur, 'oignon');
  // Sans recette : le nom courant, puis la saisie, puis rien. (T3d : « piles » est devenu un produit courant hors
  // cuisine ; un produit inconnu de l'app prend sa place.)
  assert.deepEqual(ficheProduit('pate', {}).nom, { valeur: 'pâtes', source: 'courants' });
  assert.deepEqual(ficheProduit('croquette-pour-chat', { saisie: '  Croquettes pour chat ' }).nom,
    { valeur: 'Croquettes pour chat', source: 'saisie' });
  assert.deepEqual(ficheProduit('croquette-pour-chat').nom, { valeur: '', source: 'defaut' });
  assert.deepEqual(ficheProduit('pile', { saisie: '  Piles ' }).nom, { valeur: 'piles', source: 'courants' });
});

test('ficheProduit : rayon du foyer > le plus fréquent des recettes > courant > divers', () => {
  const index = indexDesRecettes([plat('a', [ing('oignon', 1, 'pc', 'epicerie_salee'), ing('oignons', 1, 'pc', 'epicerie_salee'), ing('oignon jaune', 1, 'pc', 'fruits_legumes')])]);
  assert.deepEqual(ficheProduit('oignon-jaune', { index }).rayon, { valeur: 'epicerie_salee', source: 'recettes' });
  assert.deepEqual(ficheProduit('oignon-jaune', { index, produitsFoyer: { 'oignon-jaune': { rayon: 'surgeles' } } }).rayon,
    { valeur: 'surgeles', source: 'foyer' });
  assert.deepEqual(ficheProduit('oignon-jaune', { index, produitsFoyer: { 'oignon-jaune': { rayon: 'inconnu' } } }).rayon.source, 'recettes');
  assert.deepEqual(ficheProduit('oignon-jaune').rayon, { valeur: 'fruits_legumes', source: 'courants' });
  assert.deepEqual(ficheProduit('croquette-pour-chat', { saisie: 'croquettes pour chat' }).rayon, { valeur: 'divers', source: 'defaut' });
  // T3d : un produit hors cuisine a son rayon (piles en Divers, lessive en Entretien).
  assert.deepEqual(ficheProduit('pile', { saisie: 'piles' }).rayon, { valeur: 'divers', source: 'courants' });
  assert.deepEqual(ficheProduit('lessive').rayon, { valeur: 'entretien', source: 'courants' });
  // Égalité entre deux rayons des recettes : l'ordre du vocabulaire (fruits et légumes avant l'épicerie).
  const egalite = indexDesRecettes([plat('b', [ing('oignon', 1, 'pc', 'epicerie_salee'), ing('oignon', 1, 'pc', 'fruits_legumes')])]);
  assert.equal(ficheProduit('oignon-jaune', { index: egalite }).rayon.valeur, 'fruits_legumes');
});

test('ficheProduit : recherche = mot du foyer (T3b), sinon le nom ; clé de repli ; produitsFoyer en Map', () => {
  const index = indexDesRecettes([plat('a', [ing('pâtes courtes', 1, 'g')])]);
  assert.deepEqual(ficheProduit('pate', { index }).recherche, { valeur: 'pâtes courtes', source: 'recettes' });
  assert.deepEqual(ficheProduit('pate', { index, produitsFoyer: { pate: { rechercheDrive: ' penne ' } } }).recherche,
    { valeur: 'penne', source: 'foyer' });
  // L'id a changé (le dictionnaire a appris le nom) : le mot cherché, rangé sous l'ancienne clé, est retrouvé.
  assert.deepEqual(ficheProduit('pate', { index, produitsFoyer: { 'pate-courte': { rechercheDrive: 'penne' } }, repli: 'pate-courte' }).recherche.valeur, 'penne');
  // Un homographe n'hérite jamais du mot cherché d'un voisin (« pâté » et les pâtes).
  assert.notEqual(ficheProduit('pate--pa3te1', { produitsFoyer: { pate: { rechercheDrive: 'penne' } }, repli: 'pate', saisie: 'pâté' }).recherche.valeur, 'penne');
  assert.equal(ficheProduit('pate', { index, produitsFoyer: { 'pate-courte': { rechercheDrive: 'penne' } } }).recherche.valeur, 'pâtes courtes');
  assert.equal(ficheProduit('pate', { index, produitsFoyer: new Map([['pate', { rechercheDrive: 'penne' }]]) }).recherche.valeur, 'penne');
  // Un mot vide ne compte pas.
  assert.equal(ficheProduit('pate', { index, produitsFoyer: { pate: { rechercheDrive: '  ' } } }).recherche.source, 'recettes');
});

test('ficheProduit : placard du foyer (actif faux → null, vrai → seuil courant ou toujours) > courant > null', () => {
  assert.deepEqual(ficheProduit('beurre').placard, { valeur: { seuil: 30, unite: 'g' }, source: 'courants' });
  assert.deepEqual(ficheProduit('sel').placard, { valeur: {}, source: 'courants' });
  assert.deepEqual(ficheProduit('beurre', { produitsFoyer: { beurre: { placard: { actif: false } } } }).placard, { valeur: null, source: 'foyer' });
  assert.deepEqual(ficheProduit('beurre', { produitsFoyer: { beurre: { placard: { actif: true } } } }).placard,
    { valeur: { seuil: 30, unite: 'g' }, source: 'foyer' });
  assert.deepEqual(ficheProduit('pile', { produitsFoyer: { pile: { placard: { actif: true } } } }).placard, { valeur: {}, source: 'foyer' });
  assert.deepEqual(ficheProduit('pile').placard, { valeur: null, source: 'defaut' });
  assert.deepEqual(ficheProduit('ail').equivalences, { valeur: { pc: { qte: 5, unite: 'g' } }, source: 'courants' });
  assert.deepEqual(ficheProduit('pile').equivalences, { valeur: null, source: 'defaut' });
  assert.deepEqual(ficheProduit('lait', { produitsFoyer: { lait: { habituel: { actif: true, qte: 6, unite: 'l' } } } }).habituel,
    { valeur: { actif: true, qte: 6, unite: 'l' }, source: 'foyer' });
  assert.deepEqual(ficheProduit('lait', { produitsFoyer: { lait: { habituel: { actif: false } } } }).habituel, { valeur: null, source: 'defaut' });
});

test('ficheProduit : rien n’est modifié en entrée ; une fiche neuve à chaque appel', () => {
  const produitsFoyer = Object.freeze({ pate: Object.freeze({ rechercheDrive: 'penne', placard: Object.freeze({ actif: false }) }) });
  const index = indexDesRecettes(Object.freeze([Object.freeze(plat('a', Object.freeze([Object.freeze(ing('pâtes', 1, 'g'))])))]));
  const fiche = ficheProduit('pate', { produitsFoyer, index, saisie: 'pâtes' });
  assert.equal(fiche.recherche.valeur, 'penne');
  assert.notEqual(ficheProduit('pate'), ficheProduit('pate'));
  assert.deepEqual(Object.keys(fiche), ['nom', 'rayon', 'recherche', 'placard', 'equivalences', 'habituel']);
});

// ——— Dans la liste ———

test('liste : « pâté », « pâtes » et « pâte » font trois lignes ; « oignon », « oignons », « oignon jaune » une seule', () => {
  const recette = plat('melange', [
    ing('pâté', 100, 'g', 'charcuterie', ['viande', 'porc', 'charcuterie']),
    ing('pâtes', 200, 'g'),
    ing('pâte', 1, 'pc', 'cremerie'),
    ing('oignon', 1, 'pc', 'fruits_legumes', ['legume']),
    ing('oignons', 2, 'pc', 'fruits_legumes', ['legume']),
    ing('oignon jaune', 1, 'pc', 'fruits_legumes', ['legume']),
  ]);
  const liste = listeDeCourses(semaineDe('melange'), { tousLesPlats: [recette], profils: [ADULTE] });
  const parId = Object.fromEntries(liste.lignes.map((l) => [l.produitId, l]));
  assert.deepEqual(Object.keys(parId).sort(), ['oignon-jaune', 'pate', 'pate--pa3te', 'pate--pa3te1']);
  assert.deepEqual(parId['oignon-jaune'].totaux, { pc: 4 });
  assert.equal(parId['pate--pa3te1'].nom, 'Pâté');
  assert.equal(parId['pate--pa3te'].nom, 'Pâte');
  assert.equal(parId.pate.nom, 'Pâtes');
});

test('liste : un produit inconnu garde le nom et le rayon de la recette ; un nom sans accent d’homographe fait sa ligne', () => {
  const recette = plat('essai', [
    ing('tofu fumé maison', 100, 'g', 'cremerie', ['soja']),
    ing('pâte brisée', 1, 'pc', 'cremerie'),
    ing('pate brisee', 1, 'pc', 'cremerie'),
  ]);
  const liste = listeDeCourses(semaineDe('essai'), { tousLesPlats: [recette], profils: [ADULTE] });
  const tofu = liste.lignes.find((l) => l.produitId === 'tofu-fume-maison');
  assert.equal(tofu.nom, 'Tofu fumé maison');
  assert.equal(tofu.rayon, 'cremerie');
  // Limite assumée (§5 du plan) : « pate brisee » sans accents est à part de « pâte brisée ».
  assert.deepEqual(liste.lignes.map((l) => l.produitId).filter((id) => id.startsWith('pate-brisee')).sort(), ['pate-brisee', 'pate-brisee--pate']);
});
