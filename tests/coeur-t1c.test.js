import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuissonPrincipale, APPAREILS } from '../js/coeur/plats.js';

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
