// Garde-fou de CLAUDE.md §14 (lu au début de chaque session) : une case cochée veut dire « publié et essayé sur
// le téléphone ». Une livraison encore à publier ou à essayer reste décochée, sinon la session suivante passe à la
// tranche d'après sans attendre le retour du propriétaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const claude = await readFile(new URL('../CLAUDE.md', import.meta.url), 'utf8');
const statut = claude.match(/\n## 14\. Statut\n([\s\S]*?)\nDécisions :/)?.[1];

/** Éléments de la liste de §14 : { retrait, coche, texte, enfants }. */
function elements() {
  const lus = [...statut.matchAll(/^( *)- \[([ x])\] (.*)$/gm)].map(([, espaces, c, texte]) => ({
    retrait: espaces.length, coche: c === 'x', texte, enfants: [],
  }));
  const pile = [];
  for (const element of lus) {
    while (pile.length && pile.at(-1).retrait >= element.retrait) pile.pop();
    pile.at(-1)?.enfants.push(element);
    pile.push(element);
  }
  return lus;
}

test('CLAUDE.md §14 : une livraison cochée est essayée, jamais « à publier » ni « à faire »', () => {
  assert.ok(statut, 'section « 14. Statut » introuvable, ou plus suivie de « Décisions : »');
  const liste = elements();
  assert.ok(liste.length >= 10);
  for (const { coche, texte, enfants } of liste) {
    if (!coche) continue;
    if (enfants.length) {
      // Tranche découpée : cochée seulement quand chacune de ses livraisons l'est.
      for (const enfant of enfants) assert.ok(enfant.coche, `« ${texte.slice(0, 40)} » cochée, mais pas « ${enfant.texte.slice(0, 40)} »`);
      continue;
    }
    assert.match(texte, /essay|essai|validé/, `cochée sans essai sur le téléphone : « ${texte.slice(0, 60)} »`);
    assert.doesNotMatch(texte, /à faire|à publier|à ouvrir|à essayer/, `cochée mais pas finie : « ${texte.slice(0, 60)} »`);
  }
});
