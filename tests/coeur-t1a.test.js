import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, sansAccents, correspond } from '../js/coeur/slug.js';
import {
  categorieDuPlat, visuelDuPlat, filtrerPlats, nouveauPlatParNom, demandeDeRecette,
  quantiteLisible, cuissonLisible, NOM_MAX,
} from '../js/coeur/plats.js';
import { trierProfils, profilDeLEmail, preparerProfil, libellePortion } from '../js/coeur/profils.js';
import { dimensionsReduites, carreCentral } from '../js/coeur/photo.js';
import { lireHash, resoudreRoute, roleEffectif, routeAutorisee } from '../js/coeur/roles.js';

// ——— slug.js ———

test('slug : accents, casse, ligatures et ponctuation', () => {
  assert.equal(slug('Carbonade flamande'), 'carbonade-flamande');
  assert.equal(slug('  Bœuf bourguignon !  '), 'boeuf-bourguignon');
  assert.equal(slug('Crème brûlée à l’érable'), 'creme-brulee-a-l-erable');
  assert.equal(slug('Pâtes — 4 fromages'), 'pates-4-fromages');
  assert.equal(slug('!!!'), '');
  assert.equal(slug(undefined), '');
});

test('sansAccents et correspond : recherche tolérante', () => {
  assert.equal(sansAccents('  Gratin   DAUPHINOIS '), 'gratin dauphinois');
  assert.equal(correspond('Gratin dauphinois', 'dauph'), true);
  assert.equal(correspond('Crème brûlée', 'creme brulee'), true);
  assert.equal(correspond('Crème brûlée', 'brulee creme'), true);
  assert.equal(correspond('Crème brûlée', 'chocolat'), false);
  assert.equal(correspond('Tout plat', ''), true);
});

// ——— plats.js ———

test('categorieDuPlat : type d’abord, puis forme, puis poisson', () => {
  assert.equal(categorieDuPlat({ type: 'dessert', nom: 'Tarte aux pommes' }), 'dessert');
  assert.equal(categorieDuPlat({ type: 'apero', nom: 'Rillettes de saumon' }), 'apero');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Gratin de pâtes au jambon' }), 'gratin');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Quiche lorraine' }), 'gratin');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Lasagnes au saumon' }), 'pates');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Spaghettis bolognaise' }), 'pates');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Pavé de cabillaud' }), 'poisson');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Papillotes', ingredients: [{ marqueurs: ['poisson'] }] }), 'poisson');
  assert.equal(categorieDuPlat({ type: 'plat', nom: 'Carbonade flamande' }), 'mijote');
  assert.equal(categorieDuPlat({ nom: 'Sans type' }), 'mijote');
  assert.equal(categorieDuPlat({ type: 'inconnu', nom: 'X' }), 'mijote');
});

test('visuelDuPlat : emoji et teinte', () => {
  assert.deepEqual(visuelDuPlat({ type: 'plat', nom: 'Carbonade' }), { emoji: '🍲', teinte: '' });
  assert.deepEqual(visuelDuPlat({ type: 'plat', nom: 'Saumon grillé' }), { emoji: '🐟', teinte: 'bleu' });
  assert.equal(visuelDuPlat({ type: 'apero', nom: 'Olives' }).emoji, '🥂');
});

const catalogue = [
  { id: 'tarte-tatin', nom: 'Tarte Tatin', type: 'dessert', statutRecette: 'validee' },
  { id: 'carbonade', nom: 'Carbonade flamande', type: 'plat', statutRecette: 'brouillon' },
  { id: 'boeuf', nom: 'Bœuf bourguignon', type: 'plat', statutRecette: 'attente' },
  { id: 'olives', nom: 'Olives marinées', type: 'apero', statutRecette: 'validee' },
];

test('filtrerPlats : tri par nom, filtres et recherche', () => {
  assert.deepEqual(filtrerPlats(catalogue).map((p) => p.id), ['boeuf', 'carbonade', 'olives', 'tarte-tatin']);
  assert.deepEqual(filtrerPlats(catalogue, { filtre: 'plat' }).map((p) => p.id), ['boeuf', 'carbonade']);
  assert.deepEqual(filtrerPlats(catalogue, { filtre: 'attente' }).map((p) => p.id), ['boeuf']);
  assert.deepEqual(filtrerPlats(catalogue, { recherche: 'boeuf' }).map((p) => p.id), ['boeuf']);
  assert.deepEqual(filtrerPlats(catalogue, { filtre: 'dessert', recherche: 'flam' }), []);
  assert.deepEqual(filtrerPlats(undefined), []);
});

test('nouveauPlatParNom : plat ⏳ prêt à enregistrer', () => {
  const { plat } = nouveauPlatParNom('  Gratin   dauphinois ', catalogue);
  assert.deepEqual(plat, {
    id: 'gratin-dauphinois', nom: 'Gratin dauphinois', type: 'plat', recurrence: 'aucune',
    statutRecette: 'attente', ingredients: [], etapes: [], notes: {},
  });
});

test('nouveauPlatParNom : refus clairs', () => {
  assert.equal(nouveauPlatParNom('   ').erreur, 'Donnez un nom au plat.');
  assert.match(nouveauPlatParNom('x'.repeat(NOM_MAX + 1)).erreur, /trop long/);
  assert.match(nouveauPlatParNom('???').erreur, /ni lettre ni chiffre/);
  const doublon = nouveauPlatParNom('BŒUF', [{ id: 'boeuf', nom: 'Bœuf' }]);
  assert.equal(doublon.erreur, '« Bœuf » existe déjà.');
  assert.equal(doublon.existant, 'boeuf');
});

test('demandeDeRecette : identifiant et contenu', () => {
  assert.deepEqual(demandeDeRecette('gratin', 'a@example.com'), {
    id: 'gratin__recette',
    donnees: { type: 'recette', platId: 'gratin', creePar: 'a@example.com', statut: 'ouverte' },
  });
});

test('quantiteLisible : unités et pluriels', () => {
  assert.equal(quantiteLisible(400, 'g'), '400 g');
  assert.equal(quantiteLisible(1.5, 'kg'), '1,5 kg');
  assert.equal(quantiteLisible(1, 'pc'), '1');
  assert.equal(quantiteLisible(4, 'tranche'), '4 tranches');
  assert.equal(quantiteLisible(1, 'tranche'), '1 tranche');
  assert.equal(quantiteLisible(2, 'cs'), '2 c. à soupe');
  assert.equal(quantiteLisible(undefined, 'g'), '');
});

test('cuissonLisible', () => {
  assert.equal(cuissonLisible({ appareil: 'four', tempC: 200, dureeMin: 20 }), 'Four · 200 °C · 20 min');
  assert.equal(cuissonLisible({ appareil: 'plaque', dureeMin: 12 }), 'Plaque · 12 min');
  assert.equal(cuissonLisible({ appareil: 'cookeo', mode: 'sous pression' }), 'Cookeo · sous pression');
});

// ——— profils.js ———

const profils = [
  { id: 'b', nom: 'B', ordre: 2, email: 'b@example.com', coefPortion: 1 },
  { id: 'a', nom: 'A', ordre: 1, email: 'A@Example.com', coefPortion: 1 },
  { id: 'c', nom: 'C', ordre: 3, coefPortion: 0.5 },
];

test('trierProfils et profilDeLEmail', () => {
  assert.deepEqual(trierProfils(profils).map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(profilDeLEmail(profils, ' a@example.com ').id, 'a');
  assert.equal(profilDeLEmail(profils, 'z@example.com'), null);
  assert.equal(profilDeLEmail(profils, ''), null);
  assert.equal(libellePortion(0.5), 'Enfant');
});

test('preparerProfil : nouveau profil', () => {
  const { profil } = preparerProfil({ nom: ' Élise ', email: '', coefPortion: 0.5 }, { profils });
  assert.deepEqual(profil, { id: 'elise', nom: 'Élise', email: '', coefPortion: 0.5, ordre: 4 });
  const { profil: homonyme } = preparerProfil({ nom: 'A', email: '', coefPortion: 1 }, { profils });
  assert.equal(homonyme.id, 'a-2');
});

test('preparerProfil : modification garde id et ordre', () => {
  const { profil } = preparerProfil({ nom: 'Anne', email: 'A@EXAMPLE.COM', coefPortion: 1 }, { profils, id: 'a' });
  assert.deepEqual(profil, { id: 'a', nom: 'Anne', email: 'a@example.com', coefPortion: 1, ordre: 1 });
});

test('preparerProfil : erreurs', () => {
  assert.deepEqual(preparerProfil({ nom: '', email: 'pas-une-adresse', coefPortion: 2 }, { profils }).erreurs, {
    nom: 'Indiquez un prénom.',
    email: 'Cette adresse ne semble pas valide.',
    coefPortion: 'Choisissez une portion.',
  });
  assert.equal(preparerProfil({ nom: 'X', email: 'b@example.com', coefPortion: 1 }, { profils }).erreurs.email,
    'Cette adresse est déjà celle d’un autre profil.');
});

// ——— photo.js ———

test('dimensionsReduites et carreCentral', () => {
  assert.deepEqual(dimensionsReduites(4000, 3000, 1024), { largeur: 1024, hauteur: 768 });
  assert.deepEqual(dimensionsReduites(3000, 4000, 1024), { largeur: 768, hauteur: 1024 });
  assert.deepEqual(dimensionsReduites(800, 600, 1024), { largeur: 800, hauteur: 600 });
  assert.deepEqual(carreCentral(4000, 3000), { x: 500, y: 0, cote: 3000 });
  assert.deepEqual(carreCentral(300, 500), { x: 0, y: 100, cote: 300 });
});

// ——— roles.js (T1a) ———

test('lireHash : route et paramètre', () => {
  assert.deepEqual(lireHash('#/plat/gratin-dauphinois'), { route: 'plat', parametre: 'gratin-dauphinois' });
  assert.deepEqual(lireHash('#/plat/cr%C3%A8me'), { route: 'plat', parametre: 'crème' });
  assert.deepEqual(lireHash('#/plat/%E0%A4'), { route: 'plat', parametre: '%E0%A4' });
  assert.deepEqual(lireHash('#/plats'), { route: 'plats', parametre: '' });
  assert.deepEqual(lireHash(''), { route: '', parametre: '' });
});

test('resoudreRoute : fiche d’un plat pour les deux rôles', () => {
  assert.equal(routeAutorisee('plat', 'courses'), true);
  assert.equal(resoudreRoute('#/plat/x', 'courses'), 'plat');
  assert.equal(resoudreRoute('#/plat/', 'gestionnaire'), 'plats');
  assert.equal(resoudreRoute('#/plat', 'courses'), 'plats');
});

test('roleEffectif : aperçu de la vue « Repas et courses »', () => {
  assert.equal(roleEffectif('gestionnaire', true), 'courses');
  assert.equal(roleEffectif('gestionnaire', false), 'gestionnaire');
  assert.equal(roleEffectif('courses', true), 'courses');
  assert.equal(roleEffectif(null, true), null);
});
