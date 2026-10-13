// Empreintes courtes et texte de cuisson partagés (T5-0b, js/coeur/empreinte.js) : valeurs figées, mêmes que celles
// de la relecture des repères, aucune dépendance. Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cuissonEnTexte, empreinteDeTexte, etapeDeCuissonEnTexte } from '../js/coeur/empreinte.js';
import { empreinteRelecture, lignesRelecture } from '../js/coeur/relecture.js';
import { titresDe } from '../js/coeur/realisation.js';

const source = (fichier) => readFile(new URL(`../js/coeur/${fichier}`, import.meta.url), 'utf8');

test('empreinteDeTexte : 6 caractères [0-9a-z], valeurs figées (FNV-1a 32 bits)', () => {
  assert.equal(empreinteDeTexte(''), 'ztntfp');
  assert.equal(empreinteDeTexte(null), 'ztntfp');
  assert.equal(empreinteDeTexte('abc'), '7aigaz');
  assert.equal(empreinteDeTexte('Gâteau'), 'n9yu8u');
  for (const texte of ['a', 'b', 'une phrase plus longue', '🍰']) assert.match(empreinteDeTexte(texte), /^[0-9a-z]{6}$/);
});

test('cuissonEnTexte : appareil, mode, température, durée ; « ; » entre les étapes ; mode retiré sur demande', () => {
  const cuisson = [
    { appareil: 'plaque', dureeMin: 12 },
    { appareil: 'four', tempC: 200, dureeMin: 20 },
    { appareil: 'cookeo', mode: 'sous pression', dureeMin: 25 },
  ];
  assert.equal(cuissonEnTexte(cuisson), 'plaque 12 min ; four 200 °C 20 min ; cookeo sous pression 25 min');
  assert.equal(cuissonEnTexte(cuisson, { mode: false }), 'plaque 12 min ; four 200 °C 20 min ; cookeo 25 min');
  assert.equal(etapeDeCuissonEnTexte({ appareil: 'four', mode: 'chaleur tournante', tempC: 180, dureeMin: 35 }), 'four chaleur tournante 180 °C 35 min');
  assert.equal(cuissonEnTexte(null), '');
  assert.equal(cuissonEnTexte([null, 3, {}]), '');
});

test('relecture : son empreinte et sa ligne `cuisson:` restent celles d’avant T5-0b (sans le mode)', () => {
  const plat = {
    ingredients: [{ produit: 'reblochon', marqueurs: ['laitier', 'lait_cru'] }],
    etapes: ['Couper.', 'Cuire.'],
    cuisson: [{ appareil: 'four', tempC: 200, mode: 'grill', dureeMin: 25 }],
  };
  assert.deepEqual(lignesRelecture(plat), [
    '  ingrédients: reblochon [laitier, lait_cru]',
    '  étapes: Couper. / Cuire.',
    '  cuisson: four 200 °C 25 min',
  ]);
  assert.equal(empreinteRelecture(plat), empreinteDeTexte(lignesRelecture(plat).join('\n')));
});

test('relecture : la ligne `étapes:` donne « titre : texte » d’une réalisation à jour ; l’empreinte suit ce qui est envoyé', () => {
  const realisation = [
    { titre: 'Couper', texte: 'Coupez le reblochon en deux.', duree: 2, ingredients: ['reblochon'] },
    { titre: 'Gratiner', texte: 'Gratinez au four.', duree: 25, actif: 1, appareil: 'four', tempC: 200 },
  ];
  const base = {
    ingredients: [{ produit: 'reblochon', marqueurs: ['laitier'] }],
    cuisson: [{ appareil: 'four', tempC: 200, dureeMin: 25 }],
  };
  const detaille = { ...base, realisation, etapes: titresDe(realisation) };
  assert.equal(lignesRelecture(detaille)[1], '  étapes: Couper : Coupez le reblochon en deux. / Gratiner : Gratinez au four.');
  // Empreinte : sur les lignes envoyées à Claude ; le texte d'une étape changé sans son titre la change aussi (une
  // relecture jugée sur un texte qui n'existe plus n'est jamais écrite).
  assert.equal(empreinteRelecture(detaille), empreinteDeTexte(lignesRelecture(detaille).join('\n')));
  const autreTexte = { ...detaille, realisation: realisation.map((e, i) => (i === 1 ? { ...e, texte: 'Posez le reblochon à la sortie du four.' } : e)) };
  assert.equal(autreTexte.etapes.join('|'), detaille.etapes.join('|'));
  assert.notEqual(empreinteRelecture(autreTexte), empreinteRelecture(detaille));
  // Réalisation qui n'est plus à jour (étapes changées par une app d'avant) : les étapes courtes, comme avant.
  const perimee = { ...detaille, etapes: ['Couper et gratiner.'] };
  assert.equal(lignesRelecture(perimee)[1], '  étapes: Couper et gratiner.');
  assert.equal(empreinteRelecture(perimee), empreinteRelecture({ ...base, etapes: ['Couper et gratiner.'] }));
});

test('dépendances : empreinte.js n’importe rien ; realisation.js n’importe ni paquet, ni claude, ni relecture, ni edition', async () => {
  assert.doesNotMatch(await source('empreinte.js'), /^import /m);
  const realisation = await source('realisation.js');
  const imports = [...realisation.matchAll(/from '\.\/([a-z-]+)\.js'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['corbeille', 'empreinte', 'plats', 'slug', 'vocabulaire']);
  assert.match(await source('relecture.js'), /from '\.\/empreinte\.js'/);
});
