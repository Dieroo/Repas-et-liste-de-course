// Pictogrammes des rayons (2026-10-14, option B du propriétaire) : coeur/edition.js (PICTOS_RAYON, pictoRayon) et
// coeur/liste.js (pictogramme de chaque groupe de grouperParRayon ; enGroupesDeRayon, petits titres de rayon du mode
// Drive). Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBELLES_RAYON, PICTOS_RAYON, pictoRayon } from '../js/coeur/edition.js';
import { RAYONS_DE_DEPART, enGroupesDeRayon, grouperDrive, grouperParRayon } from '../js/coeur/liste.js';

const ligne = (cle, nom, rayon, extra = {}) => ({ cle, produitId: cle, nom, rayon, ...extra });

test('PICTOS_RAYON : les 14 rayons ont un pictogramme et un libellé, et rien de plus', () => {
  const rayons = Object.keys(LIBELLES_RAYON);
  assert.equal(rayons.length, 14);
  assert.deepEqual(Object.keys(PICTOS_RAYON).sort(), [...rayons].sort());
  for (const rayon of rayons) {
    assert.equal(typeof PICTOS_RAYON[rayon], 'string');
    assert.ok(PICTOS_RAYON[rayon].length > 0, rayon);
    assert.ok(LIBELLES_RAYON[rayon].length > 0, rayon);
    assert.equal(pictoRayon(rayon), PICTOS_RAYON[rayon]);
  }
  assert.equal(new Set(Object.values(PICTOS_RAYON)).size, 14, 'un pictogramme différent par rayon');
  assert.equal(PICTOS_RAYON.fruits_legumes, '🥕');
  assert.equal(PICTOS_RAYON.divers, '📦');
  assert.ok(Object.isFrozen(PICTOS_RAYON));
});

test('pictoRayon : un rayon inconnu ou absent prend celui de « Divers »', () => {
  for (const inconnu of ['rayon-inconnu', '', null, undefined, 'constructor', '__proto__']) {
    assert.equal(pictoRayon(inconnu), PICTOS_RAYON.divers, String(inconnu));
  }
});

test('grouperParRayon : chaque groupe porte le pictogramme de son rayon (inconnu → Divers, libellé compris)', () => {
  const liste = {
    lignes: [ligne('tomate', 'Tomate', 'fruits_legumes'), ligne('beurre', 'Beurre', 'cremerie'), ligne('x', 'Truc', 'rayon-inconnu')],
    articles: [],
  };
  const groupes = grouperParRayon(liste).aAcheter;
  assert.deepEqual(groupes.map((g) => [g.rayon, g.libelle, g.picto, g.lignes.length]), [
    ['fruits_legumes', 'Fruits et légumes', '🥕', 1],
    ['cremerie', 'Crèmerie', '🥛', 1],
    ['rayon-inconnu', 'Divers', '📦', 1],
  ]);
});

test('enGroupesDeRayon : lignes consécutives d’un même rayon réunies, ordre gardé, compte par groupe', () => {
  const lignes = [
    ligne('oignon', 'Oignon', 'fruits_legumes'), ligne('tomate', 'Tomate', 'fruits_legumes'),
    ligne('beurre', 'Beurre', 'cremerie'),
    ligne('pates', 'Pâtes', 'epicerie_salee'), ligne('riz', 'Riz', 'epicerie_salee'), ligne('thon', 'Thon', 'epicerie_salee'),
  ];
  const groupes = enGroupesDeRayon(lignes);
  assert.deepEqual(groupes.map((g) => ({ cle: g.cle, rayon: g.rayon, libelle: g.libelle, picto: g.picto, n: g.lignes.length })), [
    { cle: 'fruits_legumes', rayon: 'fruits_legumes', libelle: 'Fruits et légumes', picto: '🥕', n: 2 },
    { cle: 'cremerie', rayon: 'cremerie', libelle: 'Crèmerie', picto: '🥛', n: 1 },
    { cle: 'epicerie_salee', rayon: 'epicerie_salee', libelle: 'Épicerie salée', picto: '🥫', n: 3 },
  ]);
  // Ordre gardé, mêmes objets, aucune ligne perdue.
  assert.deepEqual(groupes.flatMap((g) => g.lignes), lignes);
  assert.equal(groupes[0].lignes[0], lignes[0]);
});

test('enGroupesDeRayon : rien n’est trié ; un rayon qui revient plus loin fait un autre groupe, à clé unique', () => {
  const lignes = [ligne('a', 'A', 'cremerie'), ligne('b', 'B', 'fromages'), ligne('c', 'C', 'cremerie'), ligne('d', 'D', 'cremerie')];
  const groupes = enGroupesDeRayon(lignes);
  assert.deepEqual(groupes.map((g) => [g.cle, g.rayon, g.lignes.map((l) => l.nom).join('')]),
    [['cremerie', 'cremerie', 'A'], ['fromages', 'fromages', 'B'], ['cremerie--2', 'cremerie', 'CD']]);
  assert.equal(new Set(groupes.map((g) => g.cle)).size, groupes.length);
});

test('enGroupesDeRayon : liste vide ou absente → aucun groupe ; un seul rayon → un seul groupe', () => {
  assert.deepEqual(enGroupesDeRayon([]), []);
  assert.deepEqual(enGroupesDeRayon(null), []);
  assert.deepEqual(enGroupesDeRayon(undefined), []);
  const seul = enGroupesDeRayon([ligne('piles', 'Piles', 'divers'), ligne('ruban', 'Ruban', 'divers')]);
  assert.equal(seul.length, 1);
  assert.deepEqual([seul[0].cle, seul[0].libelle, seul[0].picto, seul[0].lignes.length], ['divers', 'Divers', '📦', 2]);
});

test('enGroupesDeRayon : rayon inconnu → libellé et pictogramme de « Divers », sa propre clé', () => {
  const [groupe] = enGroupesDeRayon([ligne('x', 'Truc', 'rayon-inconnu')]);
  assert.deepEqual([groupe.cle, groupe.rayon, groupe.libelle, groupe.picto], ['rayon-inconnu', 'rayon-inconnu', 'Divers', '📦']);
});

test('grouperDrive puis enGroupesDeRayon : groupes dans l’ordre des rayons du foyer, une seule fois chacun', () => {
  const liste = {
    lignes: [
      ligne('tomate', 'Tomate', 'fruits_legumes'), ligne('beurre', 'Beurre', 'cremerie'), ligne('pates', 'Pâtes', 'epicerie_salee'),
      ligne('lait', 'Lait', 'cremerie', { chaqueSemaine: true }), ligne('oignon', 'Oignon', 'fruits_legumes'),
      ligne('jambon', 'Jambon', 'charcuterie', { cochee: true }),
      // Deux rayons inconnus : jamais mêlés (rangés par leur nom), chacun son groupe.
      ligne('z1', 'Aaa', 'zz-inconnu'), ligne('y1', 'Bbb', 'yy-inconnu'), ligne('z2', 'Ccc', 'zz-inconnu'),
    ],
    articles: [ligne('piles', 'Piles', 'divers')],
  };
  const ordre = ['epicerie_salee', 'divers', ...RAYONS_DE_DEPART.filter((r) => !['epicerie_salee', 'divers'].includes(r))];
  const drive = grouperDrive(liste, { rayons: ordre });
  const semaine = enGroupesDeRayon(drive.pourCetteSemaine);
  assert.deepEqual(semaine.map((g) => [g.cle, g.lignes.map((l) => l.nom)]), [
    ['epicerie_salee', ['Pâtes']],
    ['divers', ['Piles']],
    ['fruits_legumes', ['Oignon', 'Tomate']],
    ['cremerie', ['Beurre']],
    ['yy-inconnu', ['Bbb']],
    ['zz-inconnu', ['Aaa', 'Ccc']],
  ]);
  assert.deepEqual(enGroupesDeRayon(drive.commeChaqueSemaine).map((g) => [g.cle, g.picto, g.lignes.length]), [['cremerie', '🥛', 1]]);
  // Le panier reste à plat (aucun groupe ici) ; mêmes lignes à acheter qu'en mode Magasin.
  const magasin = grouperParRayon(liste, { rayons: ordre });
  assert.equal(semaine.reduce((n, g) => n + g.lignes.length, 0) + drive.commeChaqueSemaine.length,
    magasin.aAcheter.reduce((n, g) => n + g.lignes.length, 0));
});
