// T1c-2 : une recette recollée depuis Claude sur une fiche modifiée à la main (« Modifier »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerPaquet, preparerImport } from '../js/coeur/paquet.js';

// ——— Fixtures génériques (aucune donnée du foyer) ———

const RECETTE = {
  id: 'gratin-test',
  nom: 'Gratin test',
  type: 'plat',
  statutRecette: 'brouillon',
  portionsBase: 4,
  ingredients: [
    { produit: 'pâtes courtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'gruyère râpé', qte: 100, unite: 'g', rayon: 'fromages', marqueurs: ['laitier'] },
  ],
  etapes: ['Cuire les pâtes.', 'Gratiner.'],
  cuisson: [{ appareil: 'four', tempC: 200, dureeMin: 20 }],
};

const valides = (...plats) => validerPaquet([{ format: 'paquet@1', plats }]).plats.map((p) => p.donnees);

// Fiche déjà remplie, puis modifiée à la main sur un téléphone (écriture confirmée par le serveur).
const REMPLIE = { id: 'gratin-test', nom: 'Gratin test', statutRecette: 'brouillon', ingredients: [{ produit: 'pâtes' }] };
const MODIFIEE = { ...REMPLIE, modifieePar: 'membre@example.com', modifieeLe: { seconds: 1_790_000_000, nanoseconds: 0 } };
// Même modification, pas encore confirmée : le téléphone lit `modifieeLe` à null.
const EN_ATTENTE = { ...REMPLIE, modifieePar: 'membre@example.com', modifieeLe: null };

/** Aucune valeur undefined, à aucune profondeur (le vrai Firestore les refuse). */
function sansUndefined(valeur, chemin = 'racine') {
  if (valeur === undefined) assert.fail(`undefined à ${chemin}`);
  if (Array.isArray(valeur)) valeur.forEach((v, i) => sansUndefined(v, `${chemin}[${i}]`));
  else if (valeur && typeof valeur === 'object') for (const [cle, v] of Object.entries(valeur)) sansUndefined(v, `${chemin}.${cle}`);
}

// ——— modifieeA : l'aperçu prévient ———

test('preparerImport : fiche modifiée à la main et remplacée → modifieeA en secondes', () => {
  const r = preparerImport(valides(RECETTE), { plats: [MODIFIEE], demandes: [] });
  assert.equal(r.elements[0].statut, 'remplace');
  assert.equal(r.elements[0].modifieeA, 1_790_000_000);
  sansUndefined(r);
});

test('preparerImport : modification pas encore confirmée (modifieeLe null) → modifieeA vaut true', () => {
  const r = preparerImport(valides(RECETTE), { plats: [EN_ATTENTE], demandes: [] });
  assert.equal(r.elements[0].modifieeA, true);
  // Date illisible ou absente : même réponse.
  const sansDate = { ...REMPLIE, modifieePar: 'membre@example.com' };
  assert.equal(preparerImport(valides(RECETTE), { plats: [sansDate], demandes: [] }).elements[0].modifieeA, true);
  const dateAbimee = { ...REMPLIE, modifieePar: 'membre@example.com', modifieeLe: { seconds: 'x' } };
  assert.equal(preparerImport(valides(RECETTE), { plats: [dateAbimee], demandes: [] }).elements[0].modifieeA, true);
});

test('preparerImport : fiche jamais modifiée à la main → ni modifieeA ni effacerModification', () => {
  const r = preparerImport(valides(RECETTE), { plats: [REMPLIE], demandes: [] });
  assert.equal(r.elements[0].statut, 'remplace');
  assert.equal('modifieeA' in r.elements[0], false);
  assert.equal('effacerModification' in r.ecritures[0], false);
  const nouveau = preparerImport(valides(RECETTE), { plats: [], demandes: [] });
  assert.equal(nouveau.elements[0].statut, 'nouveau');
  assert.equal('modifieeA' in nouveau.elements[0], false);
  assert.equal('effacerModification' in nouveau.ecritures[0], false);
});

// ——— effacerModification : seulement pour une recette complétée ou remplacée ———

test('preparerImport : recette remplacée sur une fiche modifiée → effacerModification à côté des données', () => {
  const r = preparerImport(valides(RECETTE), { plats: [MODIFIEE], demandes: [] });
  assert.equal(r.ecritures[0].effacerModification, true);
  // Jamais dans les données écrites : la marque est effacée par donnees.js, pas recopiée.
  for (const champ of ['effacerModification', 'modifieePar', 'modifieeLe']) {
    assert.equal(champ in r.ecritures[0].donnees, false, champ);
  }
  sansUndefined(r.ecritures);
});

test('preparerImport : plat ⏳ modifié à la main (nom seulement) puis complété → effacerModification', () => {
  const attente = { id: 'gratin-test', nom: 'Gratin test', modifieePar: 'membre@example.com', modifieeLe: null };
  const r = preparerImport(valides(RECETTE), { plats: [attente], demandes: [] });
  assert.equal(r.elements[0].statut, 'complete');
  assert.equal(r.elements[0].modifieeA, true);
  assert.equal(r.ecritures[0].effacerModification, true);
});

test('preparerImport : recette inchangée (sans ingrédients) sur une fiche modifiée → rien n’est effacé', () => {
  const r = preparerImport(valides({ id: 'gratin-test', nom: 'Gratin test' }), { plats: [MODIFIEE], demandes: [] });
  assert.equal(r.elements[0].statut, 'inchange');
  assert.equal('modifieeA' in r.elements[0], false);
  assert.equal('effacerModification' in r.ecritures[0], false);
});

test('preparerImport : seule modifieeLe présente compte aussi comme une modification à la main', () => {
  const r = preparerImport(valides(RECETTE), { plats: [{ ...REMPLIE, modifieeLe: { seconds: 42 } }], demandes: [] });
  assert.equal(r.elements[0].modifieeA, 42);
  assert.equal(r.ecritures[0].effacerModification, true);
});

test('preparerImport : plusieurs recettes, seule la fiche modifiée porte la marque', () => {
  const autre = { ...RECETTE, id: 'tarte-test', nom: 'Tarte test' };
  const plats = [MODIFIEE, { id: 'tarte-test', nom: 'Tarte test', statutRecette: 'validee', ingredients: [{ produit: 'farine' }] }];
  const r = preparerImport(valides(RECETTE, autre), { plats, demandes: [] });
  assert.deepEqual(r.ecritures.map((e) => Boolean(e.effacerModification)), [true, false]);
  assert.deepEqual(r.elements.map((e) => e.modifieeA ?? null), [1_790_000_000, null]);
});

test('preparerImport : cible depuis la fiche modifiée → marque effacée', () => {
  const r = preparerImport(valides({ ...RECETTE, id: 'autre-id', nom: 'Autre nom' }), {
    plats: [MODIFIEE],
    demandes: [],
    cible: 'gratin-test',
  });
  assert.equal(r.ecritures[0].id, 'gratin-test');
  assert.equal(r.elements[0].statut, 'remplace');
  assert.equal(r.ecritures[0].effacerModification, true);
});

// ——— Plat visé : une fiche renommée à la main reste le même plat ———

test('preparerImport : même identifiant et fiche modifiée à la main → même plat malgré un autre nom', () => {
  const renommee = { ...MODIFIEE, nom: 'Gratin du dimanche' };
  const r = preparerImport(valides(RECETTE), { plats: [renommee], demandes: [] });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.ecritures[0].id, 'gratin-test');
  assert.equal(r.ecritures[0].donnees.id, 'gratin-test');
  assert.equal(r.elements[0].statut, 'remplace');
  assert.equal(r.elements[0].ancienNom, 'Gratin du dimanche');
  assert.equal(r.elements[0].modifieeA, 1_790_000_000);
  assert.equal(r.ecritures[0].effacerModification, true);
  assert.deepEqual(r.elements[0].avertissements, []);
});

test('preparerImport : modification pas encore confirmée, renommée → même plat aussi', () => {
  const r = preparerImport(valides(RECETTE), { plats: [{ ...EN_ATTENTE, nom: 'Gratin du dimanche' }], demandes: [] });
  assert.equal(r.ecritures[0].id, 'gratin-test');
  assert.equal(r.elements[0].modifieeA, true);
});

// ——— Non-régression des règles existantes ———

test('preparerImport : même identifiant, autre nom, fiche jamais modifiée → toujours un plat à part', () => {
  const r = preparerImport(valides(RECETTE), { plats: [{ ...REMPLIE, nom: 'Tarte' }], demandes: [] });
  assert.equal(r.ecritures[0].id, 'gratin-test-2');
  assert.equal(r.elements[0].statut, 'nouveau');
  assert.match(r.elements[0].avertissements[0], /utilise déjà cet identifiant/);
  assert.equal('effacerModification' in r.ecritures[0], false);
});

test('preparerImport : le même nom ailleurs l’emporte sur un identifiant pris par un plat non modifié', () => {
  const plats = [
    { id: 'gratin-test', nom: 'Tarte', statutRecette: 'validee' },
    { id: 'gratin-ancien', nom: 'Gratin test', statutRecette: 'brouillon', modifieePar: 'membre@example.com', modifieeLe: null },
  ];
  const r = preparerImport(valides(RECETTE), { plats, demandes: [] });
  assert.equal(r.ecritures[0].id, 'gratin-ancien');
  assert.equal(r.elements[0].statut, 'remplace');
  assert.equal(r.elements[0].modifieeA, true);
  assert.equal(r.ecritures[0].effacerModification, true);
});

test('preparerImport : fiche modifiée renommée, son ancien nom porté par un autre plat → avertissement gardé', () => {
  const plats = [
    { ...MODIFIEE, nom: 'Gratin du dimanche' },
    { id: 'autre', nom: 'Gratin test', statutRecette: 'validee' },
  ];
  const r = preparerImport(valides(RECETTE), { plats, demandes: [] });
  assert.equal(r.ecritures[0].id, 'gratin-test');
  assert.match(r.elements[0].avertissements[0], /Un autre plat s’appelle déjà/);
});

test('preparerImport : fiche renommée à la main, mais un plat ⏳ porte exactement le nom collé → le ⏳ est visé', () => {
  // « Gratin test » (gratin-test) renommé à la main ; un nouveau « Gratin test » ajouté par son nom (gratin-test-2),
  // avec sa demande de recette ouverte.
  const plats = [
    { ...MODIFIEE, nom: 'Lasagnes maison' },
    { id: 'gratin-test-2', nom: 'Gratin test' },
  ];
  const r = preparerImport(valides(RECETTE), { plats, demandes: [{ id: 'gratin-test-2__recette', statut: 'ouverte' }] });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.ecritures[0].id, 'gratin-test-2');
  assert.equal(r.elements[0].statut, 'complete');
  assert.deepEqual(r.demandesAClore, ['gratin-test-2__recette']);
  assert.equal(r.ecritures[0].effacerModification, undefined);
  // Sans ⏳ ni demande pour ce nom : la fiche renommée reste visée.
  const seule = preparerImport(valides(RECETTE), { plats: [{ ...MODIFIEE, nom: 'Lasagnes maison' }], demandes: [] });
  assert.equal(seule.ecritures[0].id, 'gratin-test');
});

test('preparerImport : demande de recette ouverte close aussi sur une fiche modifiée', () => {
  const attente = { id: 'gratin-test', nom: 'Gratin maison', modifieePar: 'membre@example.com', modifieeLe: null };
  const r = preparerImport(valides(RECETTE), {
    plats: [attente],
    demandes: [{ id: 'gratin-test__recette', statut: 'ouverte' }],
  });
  assert.equal(r.elements[0].statut, 'complete');
  assert.deepEqual(r.demandesAClore, ['gratin-test__recette']);
});
