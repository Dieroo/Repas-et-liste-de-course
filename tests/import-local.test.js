// Application locale d'un import (T2b) : ce que l'app affiche avant la copie de Firestore, et l'annonce des versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquerImport, profilsDesVersions, versionsEcrites, annonceVersions } from '../js/coeur/import-local.js';

const sansUndefined = (valeur) => JSON.stringify(valeur, (_, v) => (v === undefined ? '__undefined__' : v)).includes('__undefined__') === false;

const versionA = { pour: 'profil-a', retirer: ['lardons'], ajouter: [], consigne: 'Sans lardons.' };
const versionB = { pour: 'profil-b', retirer: ['jambon blanc'], ajouter: [], consigne: 'Part au thon.' };
const versionA2 = { pour: 'profil-a', retirer: ['lardons', 'bouillon de bœuf'], ajouter: [], consigne: 'Bouillon de légumes.' };

test('appliquerImport : une version vers un plat inconnu ne crée aucun plat local', () => {
  const plats = [{ id: 'gratin', nom: 'Gratin', variantes: [] }];
  const apres = appliquerImport(plats, [{ id: 'inconnu', mode: 'versions', variantes: [versionA] }]);
  assert.deepEqual(apres.map((p) => p.id), ['gratin']);
  assert.deepEqual(apres[0], plats[0]);
});

test('appliquerImport : une version se fusionne par profil, sans toucher au reste de la fiche', () => {
  const plat = { id: 'gratin', nom: 'Gratin', statutRecette: 'validee', modifieePar: 'x', variantes: [versionB, versionA] };
  const apres = appliquerImport([plat], [{ id: 'gratin', mode: 'versions', variantes: [versionA2] }]);
  assert.equal(apres[0].nom, 'Gratin');
  assert.equal(apres[0].statutRecette, 'validee');
  assert.equal(apres[0].modifieePar, 'x');
  assert.deepEqual(apres[0].variantes.map((v) => v.pour), ['profil-b', 'profil-a']);
  assert.deepEqual(apres[0].variantes[1], versionA2);
  assert.deepEqual(plat.variantes, [versionB, versionA], 'liste d’origine intacte');
  assert.ok(sansUndefined(apres));
});

test('appliquerImport : fiches complètes comme en T1b (remplacement, marque effacée, nouveau plat à la fin)', () => {
  const plats = [{ id: 'a', nom: 'A', modifieeLe: { seconds: 1 }, modifieePar: 'x', notes: { 'profil-a': 5 } }];
  const apres = appliquerImport(plats, [
    { id: 'a', donnees: { id: 'a', nom: 'A bis', portionsBase: 4 }, effacerModification: true },
    { id: 'b', donnees: { id: 'b', nom: 'B' } },
  ]);
  assert.deepEqual(apres, [
    { id: 'a', nom: 'A bis', portionsBase: 4, notes: { 'profil-a': 5 } },
    { id: 'b', nom: 'B' },
  ]);
});

test('profilsDesVersions, versionsEcrites : seules les écritures de versions comptent, plats disparus exclus', () => {
  const ecritures = [
    { id: 'a', mode: 'versions', variantes: [versionA] },
    { id: 'b', mode: 'versions', variantes: [versionA, versionB] },
    { id: 'c', donnees: { id: 'c', nom: 'C', variantes: [versionA] } },
  ];
  assert.deepEqual(profilsDesVersions(ecritures), ['profil-a', 'profil-b']);
  assert.equal(versionsEcrites(ecritures, 'profil-a'), 2);
  assert.equal(versionsEcrites(ecritures, 'profil-a', ['b']), 1);
  assert.equal(versionsEcrites(ecritures, 'profil-b', ['b']), 0);
});

test('annonceVersions : nombre de versions, plats restants, plats disparus', () => {
  assert.equal(
    annonceVersions([{ nom: 'Profil A', ajoutees: 9, restants: 14 }]),
    '9 versions ajoutées. 14 plats attendent encore une version pour Profil A.',
  );
  assert.equal(
    annonceVersions([{ nom: 'Profil A', ajoutees: 1, restants: 1 }]),
    '1 version ajoutée. 1 plat attend encore une version pour Profil A.',
  );
  assert.equal(
    annonceVersions([{ nom: 'Profil A', ajoutees: 2, restants: 0 }], ['Gratin']),
    '2 versions ajoutées. Plus aucun plat n’attend de version pour Profil A. «\u00A0Gratin\u00A0» n’est plus dans vos plats\u00A0: sa version n’a pas été enregistrée.',
  );
  assert.equal(annonceVersions([{ nom: 'Profil A', ajoutees: 0, restants: 3 }]), '');
});
