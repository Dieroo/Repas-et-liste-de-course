// Deux versions par profil, mer et végétale (cœur « compatibilité et textes ») : vocabulaire.js (styles),
// regles.js (stylesAttendus), compatibilite.js (styleDe, evaluer, platsSansVersion, bilanCompatibilite),
// plats.js (aCompleterSelon, filtre « Versions à créer ») et claude.js (textes copiés). Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STYLES, LIBELLES_STYLE, EMOJIS_STYLE, VOCABULAIRES } from '../js/coeur/vocabulaire.js';
import { ecrireRegime, stylesAttendus } from '../js/coeur/regles.js';
import {
  styleDe, evaluer, platsSansVersion, bilanCompatibilite, aAdapterPour,
} from '../js/coeur/compatibilite.js';
import { aCompleterSelon, aAdapterSelon, filtresPour, filtreRetenu, filtrerPlats } from '../js/coeur/plats.js';
import { VERSION_INSTRUCTIONS, texteDemandeRecette, texteDemandeVariantes } from '../js/coeur/claude.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const NI_POISSON = ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: new Set() }, []);
// Règle d'exclusion qui n'est pas celle de l'écran du régime : aucun style attendu.
const SANS_VIANDE_EN_CODES = [{ type: 'exclureMarqueurs', marqueurs: ['viande', 'bouillon_viande'], severite: 'exclu' }];

const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const ENFANT = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: NI_POISSON };
const SANS_STYLE = { ...ADULTE_B, regles: SANS_VIANDE_EN_CODES };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A];

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const PATES = ing('pâtes', 400, 'g', ['feculent']);
const LARDONS = ing('lardons', 200, 'g', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' });
const OEUFS = ing('œuf', 3, 'pc', ['oeuf']);
const BOEUF = ing('bœuf à braiser', 800, 'g', ['viande', 'boeuf'], { forme: 'morceaux' });
const FOND = ing('fond de veau', 1, 'cs', ['bouillon_viande']);

const ajout = (produit, qtePortion, unite, marqueurs = []) => ({ produit, qtePortion, unite, rayon: 'divers', marqueurs });
const SAUMON = ajout('saumon fumé', 2, 'tranche', ['poisson']);
const CREVETTES = ajout('crevettes', 60, 'g', ['fruits_de_mer']);
const TOFU = ajout('tofu fumé', 60, 'g');
const CHAMPIGNONS = ajout('champignon de paris', 50, 'g', ['legume']);
const JAMBON = { ...ajout('jambon', 50, 'g', ['viande', 'porc']), forme: 'fine' };

const version = (pour, retirer, ajouter, consigne, extra = {}) => ({ pour, retirer, ajouter, consigne, ...extra });
const MER = version('profil-b', ['lardons'], [SAUMON], 'Part au saumon.', { style: 'mer', frigoJours: 2 });
const VEGETALE = version('profil-b', ['lardons'], [TOFU, CHAMPIGNONS], 'Part au tofu.', { style: 'vegetal' });

const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Cuire.'], ...extra,
});
const QUICHE = plat('quiche-test', 'Quiche test', [PATES, LARDONS, OEUFS]);

// ——— vocabulaire.js ———

test('styles : mer et vegetal, libellés et emojis ; les vocabulaires de paquet@1 inchangés', () => {
  assert.deepEqual(STYLES, ['mer', 'vegetal']);
  assert.deepEqual(LIBELLES_STYLE, { mer: 'mer', vegetal: 'végétale' });
  assert.deepEqual(EMOJIS_STYLE, { mer: '🐟', vegetal: '🌿' });
  assert.equal('style' in VOCABULAIRES, false);
  assert.equal('styles' in VOCABULAIRES, false);
});

// ——— regles.js › stylesAttendus ———

test('stylesAttendus : déduits du régime de l’écran', () => {
  assert.deepEqual(stylesAttendus(ADULTE_B), ['mer', 'vegetal']);
  assert.deepEqual(stylesAttendus(ENFANT), ['vegetal']);
  // Précisions cochées et autres aliments évités : le régime reste reconnu.
  const charcuterie = ecrireRegime({ regime: 'sans_viande', precisions: new Set(['charcuterie', 'bouillon']) },
    [{ type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }]);
  assert.deepEqual(stylesAttendus({ id: 'x', regles: charcuterie }), ['mer', 'vegetal']);
  assert.deepEqual(stylesAttendus({ id: 'x', regles: ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: ['gelatine'] }) }), ['vegetal']);
});

test('stylesAttendus : « Mange de tout », règles en codes, profil sans règles → aucun style', () => {
  assert.deepEqual(stylesAttendus(ADULTE_A), []);
  assert.deepEqual(stylesAttendus({ id: 'x', regles: [] }), []);
  assert.deepEqual(stylesAttendus(SANS_STYLE), []);
  assert.deepEqual(stylesAttendus({ id: 'x', regles: [{ type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }] }), []);
  assert.deepEqual(stylesAttendus(null), []);
  assert.deepEqual(stylesAttendus(undefined), []);
  assert.deepEqual(stylesAttendus({ regles: 'abîmé' }), []);
  // Chaque appel rend une liste neuve.
  const styles = stylesAttendus(ADULTE_B);
  styles.push('autre');
  assert.deepEqual(stylesAttendus(ADULTE_B), ['mer', 'vegetal']);
});

// ——— compatibilite.js › styleDe ———

test('styleDe : style écrit s’il est valide, sinon déduit des ajouts (poisson ou fruits de mer → mer)', () => {
  assert.equal(styleDe(MER), 'mer');
  assert.equal(styleDe(VEGETALE), 'vegetal');
  assert.equal(styleDe({ pour: 'profil-b', ajouter: [SAUMON] }), 'mer');
  assert.equal(styleDe({ pour: 'profil-b', ajouter: [TOFU, CREVETTES] }), 'mer');
  assert.equal(styleDe({ pour: 'profil-b', ajouter: [TOFU, OEUFS] }), 'vegetal');
  assert.equal(styleDe({ pour: 'profil-b', ajouter: [] }), 'vegetal');
  assert.equal(styleDe({ pour: 'profil-b' }), 'vegetal');
  assert.equal(styleDe(null), 'vegetal');
  // Style écrit : il l'emporte sur la déduction ; un style inconnu est ignoré.
  assert.equal(styleDe({ style: 'vegetal', ajouter: [SAUMON] }), 'vegetal');
  assert.equal(styleDe({ style: 'poisson', ajouter: [SAUMON] }), 'mer');
  assert.equal(styleDe({ style: 'Mer', ajouter: [TOFU] }), 'vegetal');
  // Rien n'est écrit dans la version.
  const ancienne = { pour: 'profil-b', ajouter: [SAUMON] };
  styleDe(ancienne);
  assert.equal('style' in ancienne, false);
});

// ——— compatibilite.js › evaluer ———

test('evaluer : aucune version → à créer, tous les styles attendus manquent', () => {
  const r = evaluer(QUICHE, ADULTE_B);
  assert.equal(r.niveau, 'exclu');
  assert.equal(r.aCreer, true);
  assert.equal(r.aRevoir, false);
  assert.deepEqual(r.versions, []);
  assert.deepEqual(r.manquants, ['mer', 'vegetal']);
  assert.equal(r.aCompleter, false);
  assert.equal(r.besoin, 'sans_viande');
  // « Ni viande ni poisson » : la seule végétale.
  assert.deepEqual(evaluer(QUICHE, ENFANT).manquants, ['vegetal']);
});

test('evaluer : des versions, aucune ne convient → à revoir, restants de la première, tous les styles manquent', () => {
  const merRatee = version('profil-b', [], [SAUMON], 'Ajouter le saumon.', { style: 'mer', frigoJours: 2 });
  const vegetaleRatee = version('profil-b', ['lardons'], [JAMBON], 'Part au jambon.', { style: 'vegetal' });
  const p = { ...QUICHE, variantes: [merRatee, vegetaleRatee] };
  const r = evaluer(p, ADULTE_B);
  assert.equal(r.niveau, 'exclu');
  assert.equal(r.aRevoir, true);
  assert.equal(r.aCreer, false);
  assert.equal(r.variante, null);
  assert.deepEqual(r.restants, ['lardons']);
  assert.equal(r.besoin, 'sans_viande');
  assert.deepEqual(r.manquants, ['mer', 'vegetal']);
  assert.equal(r.aCompleter, false);
  assert.deepEqual(r.versions, [
    { variante: merRatee, style: 'mer', convient: false, restants: ['lardons'] },
    { variante: vegetaleRatee, style: 'vegetal', convient: false, restants: ['jambon'] },
  ]);
  assert.equal(r.versions[0].variante, merRatee, 'l’objet de la fiche');
});

test('evaluer : version mer seule qui convient → adaptable, à compléter (végétale manquante)', () => {
  const r = evaluer({ ...QUICHE, variantes: [MER] }, ADULTE_B);
  assert.equal(r.niveau, 'adaptable');
  assert.equal(r.aCreer, false);
  assert.equal(r.aRevoir, false);
  assert.deepEqual(r.variante, {
    source: 'fiche', retirer: ['lardons'], ajouter: [SAUMON], consigne: 'Part au saumon.', style: 'mer', frigoJours: 2,
  });
  assert.deepEqual(r.fautifs, [LARDONS]);
  assert.deepEqual(r.restants, []);
  assert.deepEqual(r.manquants, ['vegetal']);
  assert.equal(r.aCompleter, true);
  assert.equal(r.besoin, 'sans_viande');
  assert.deepEqual(r.versions, [{ variante: MER, style: 'mer', convient: true, restants: [] }]);
});

test('evaluer : version végétale seule → à compléter (mer manquante) ; pour « ni poisson », rien ne manque', () => {
  const r = evaluer({ ...QUICHE, variantes: [VEGETALE] }, ADULTE_B);
  assert.equal(r.niveau, 'adaptable');
  assert.equal(r.variante.style, 'vegetal');
  assert.equal('frigoJours' in r.variante, false);
  assert.deepEqual(r.manquants, ['mer']);
  assert.equal(r.aCompleter, true);
  const enfant = evaluer({ ...QUICHE, variantes: [{ ...VEGETALE, pour: 'enfant' }] }, ENFANT);
  assert.equal(enfant.niveau, 'adaptable');
  assert.deepEqual(enfant.manquants, []);
  assert.equal(enfant.aCompleter, false);
  assert.equal(enfant.besoin, null);
});

test('evaluer : deux versions qui conviennent → rien ne manque, la version mer retenue (préférence du foyer)', () => {
  for (const variantes of [[MER, VEGETALE], [VEGETALE, MER]]) {
    const r = evaluer({ ...QUICHE, variantes }, ADULTE_B);
    assert.equal(r.niveau, 'adaptable');
    assert.deepEqual(r.manquants, []);
    assert.equal(r.aCompleter, false);
    assert.equal(r.besoin, null);
    assert.equal(r.variante.style, 'mer');
    assert.equal(r.variante.consigne, 'Part au saumon.');
    assert.deepEqual(r.versions.map((v) => v.style), variantes.map((v) => v.style));
    assert.ok(r.versions.every((v) => v.convient));
  }
  // Sans version mer qui convient : la première qui convient.
  const autreVegetale = { ...VEGETALE, consigne: 'Autre part.' };
  assert.equal(evaluer({ ...QUICHE, variantes: [autreVegetale, VEGETALE] }, ADULTE_B).variante.consigne, 'Autre part.');
  // Une version mer qui ne convient pas n'est jamais retenue.
  const merRatee = { ...MER, retirer: [] };
  const r = evaluer({ ...QUICHE, variantes: [merRatee, VEGETALE] }, ADULTE_B);
  assert.equal(r.variante.style, 'vegetal');
  assert.deepEqual(r.manquants, ['mer']);
  assert.equal(r.aCompleter, true);
});

test('evaluer : versions sans style (d’avant) → style déduit, mer ou végétale', () => {
  const ancienneMer = version('profil-b', ['lardons'], [CREVETTES], 'Part aux crevettes.');
  const ancienneVegetale = version('profil-b', ['lardons'], [TOFU], 'Part au tofu.');
  const r = evaluer({ ...QUICHE, variantes: [ancienneVegetale, ancienneMer] }, ADULTE_B);
  assert.deepEqual(r.versions.map((v) => v.style), ['vegetal', 'mer']);
  assert.deepEqual(r.manquants, []);
  assert.equal(r.variante.style, 'mer');
  assert.equal(r.variante.consigne, 'Part aux crevettes.');
  // Une seule ancienne version, sans poisson : végétale, la mer manque.
  const seule = evaluer({ ...QUICHE, variantes: [ancienneVegetale] }, ADULTE_B);
  assert.equal(seule.variante.style, 'vegetal');
  assert.deepEqual(seule.manquants, ['mer']);
});

test('evaluer : « ni viande ni poisson » → une version mer ne convient pas, la végétale suffit', () => {
  const mer = { ...MER, pour: 'enfant' };
  const r = evaluer({ ...QUICHE, variantes: [mer] }, ENFANT);
  assert.equal(r.aRevoir, true);
  assert.deepEqual(r.restants, ['saumon fumé']);
  assert.deepEqual(r.manquants, ['vegetal']);
  const avecVegetale = evaluer({ ...QUICHE, variantes: [mer, { ...VEGETALE, pour: 'enfant' }] }, ENFANT);
  assert.equal(avecVegetale.niveau, 'adaptable');
  assert.equal(avecVegetale.variante.style, 'vegetal');
  assert.deepEqual(avecVegetale.manquants, []);
  assert.equal(avecVegetale.aCompleter, false);
  assert.deepEqual(avecVegetale.versions.map((v) => v.convient), [false, true]);
});

test('evaluer : profil sans style attendu → jamais de manquants ni de plat à compléter', () => {
  const sansStyle = (variantes) => evaluer({ ...QUICHE, variantes: variantes.map((v) => ({ ...v, pour: 'profil-b' })) }, SANS_STYLE);
  const aucune = sansStyle([]);
  assert.equal(aucune.aCreer, true);
  assert.deepEqual(aucune.manquants, []);
  const mer = sansStyle([version('profil-b', ['lardons'], [SAUMON], 'Part au saumon.')]);
  assert.equal(mer.niveau, 'adaptable');
  assert.deepEqual(mer.manquants, []);
  assert.equal(mer.aCompleter, false);
  assert.equal(mer.besoin, null);
  const ratee = sansStyle([version('profil-b', [], [TOFU], 'Rien.')]);
  assert.equal(ratee.aRevoir, true);
  assert.deepEqual(ratee.manquants, []);
  // Profil sans règle : les versions sont listées, toutes conviennent, rien d'autre ne change.
  const libre = evaluer({ ...QUICHE, variantes: [{ ...MER, pour: 'profil-a' }] }, ADULTE_A);
  assert.equal(libre.niveau, 'ok');
  assert.equal(libre.variante, null);
  assert.deepEqual(libre.versions.map((v) => v.convient), [true]);
  assert.deepEqual(libre.manquants, []);
});

test('evaluer : plat qui se mange tel quel, plat sans ingrédients → rien ne manque', () => {
  const omelette = plat('omelette', 'Omelette', [OEUFS], { variantes: [{ ...VEGETALE, retirer: [] }] });
  const r = evaluer(omelette, ADULTE_B);
  assert.equal(r.niveau, 'ok');
  assert.deepEqual(r.manquants, []);
  assert.equal(r.aCompleter, false);
  assert.equal(r.versions.length, 1);
  const attente = evaluer({ id: 'a', nom: 'À venir', variantes: [MER] }, ADULTE_B);
  assert.equal(attente.niveau, 'inconnu');
  assert.deepEqual(attente.versions, []);
  assert.deepEqual(attente.manquants, []);
  assert.equal(attente.aCompleter, false);
});

test('evaluer : frigoJours repris seulement s’il est un entier de 1 à 30', () => {
  const avec = (frigoJours) => evaluer({ ...QUICHE, variantes: [{ ...MER, frigoJours }] }, ADULTE_B).variante;
  assert.equal(avec(1).frigoJours, 1);
  assert.equal(avec(30).frigoJours, 30);
  for (const invalide of [0, 31, 2.5, '2', null, undefined]) assert.equal('frigoJours' in avec(invalide), false, String(invalide));
  // Une version végétale peut aussi le donner.
  assert.equal(evaluer({ ...QUICHE, variantes: [{ ...VEGETALE, frigoJours: 3 }] }, ADULTE_B).variante.frigoJours, 3);
});

// ——— Plats à compléter : platsSansVersion, bilan, filtres ———

const CATALOGUE = [
  plat('boeuf-carottes', 'Bœuf carottes', [BOEUF]),
  plat('quiche', 'Quiche', [PATES, LARDONS, OEUFS], { notes: { 'profil-a': 5 } }),
  plat('gratin', 'Gratin', [PATES, LARDONS], { variantes: [MER] }),
  plat('tarte', 'Tarte', [PATES, LARDONS], { variantes: [VEGETALE], notes: { 'profil-a': 5 } }),
  plat('risotto', 'Risotto', [PATES, FOND], { variantes: [{ ...MER, retirer: [] }] }),
  plat('cake', 'Cake', [PATES, LARDONS], { variantes: [MER, VEGETALE] }),
  plat('jamais', 'Jamais', [PATES, LARDONS], { variantes: [MER], notes: { 'profil-b': 0 } }),
  plat('feuilletes', 'Feuilletés', [PATES, LARDONS], { type: 'apero', variantes: [MER] }),
  plat('fond-maison', 'Fond maison', [PATES, LARDONS], { type: 'preparation', variantes: [MER] }),
  plat('omelette', 'Omelette', [OEUFS]),
];

test('platsSansVersion : les plats à compléter après tous les plats à créer ou à revoir, chacun dans son ordre', () => {
  const ids = (options) => platsSansVersion(CATALOGUE, ADULTE_B, { profils: PROFILS, ...options }).map((e) => e.plat.id);
  // À créer ou à revoir : quiche (5), puis bœuf carottes et risotto (3, par nom) ; à compléter : tarte (5), gratin.
  assert.deepEqual(ids(), ['quiche', 'boeuf-carottes', 'risotto', 'tarte', 'gratin']);
  // Demande ouverte en tête de son groupe ; un plat à compléter ne passe jamais devant un plat à créer.
  assert.deepEqual(ids({ demandes: [{ id: 'gratin__profil-b', statut: 'ouverte' }, { id: 'risotto__profil-b', statut: 'ouverte' }] }),
    ['risotto', 'quiche', 'boeuf-carottes', 'gratin', 'tarte']);
  // Déjà envoyés : en fin de leur groupe.
  assert.deepEqual(ids({ envoyes: ['quiche', 'tarte'] }), ['boeuf-carottes', 'risotto', 'quiche', 'gratin', 'tarte']);
  assert.deepEqual(ids({ envoyes: ['quiche', 'boeuf-carottes', 'risotto'] }), ['quiche', 'boeuf-carottes', 'risotto', 'tarte', 'gratin']);
});

test('platsSansVersion : chaque élément porte manquants et aCompleter', () => {
  const elements = platsSansVersion(CATALOGUE, ADULTE_B, { profils: PROFILS });
  const parId = Object.fromEntries(elements.map((e) => [e.plat.id, e]));
  assert.deepEqual(parId.quiche, {
    plat: CATALOGUE[1], fautifs: [LARDONS], besoin: 'sans_viande', aRevoir: false, manquants: ['mer', 'vegetal'], aCompleter: false,
  });
  // Le risotto n'est exclu que par son bouillon : sans viande à remplacer, seule la version végétale est attendue.
  assert.deepEqual(parId.risotto.manquants, ['vegetal']);
  assert.equal(parId.risotto.aRevoir, true);
  assert.deepEqual(parId.gratin, {
    plat: CATALOGUE[2], fautifs: [LARDONS], besoin: 'sans_viande', aRevoir: false, manquants: ['vegetal'], aCompleter: true,
  });
  assert.deepEqual(parId.tarte.manquants, ['mer']);
  // Apéro, préparation, « Jamais », plat complet ou mangeable tel quel : jamais à compléter.
  for (const id of ['cake', 'jamais', 'feuilletes', 'fond-maison', 'omelette']) assert.equal(parId[id], undefined, id);
});

test('platsSansVersion : un profil sans style attendu n’a jamais de plat à compléter', () => {
  const ids = platsSansVersion(CATALOGUE, SANS_STYLE, { profils: PROFILS }).map((e) => e.plat.id);
  assert.deepEqual(ids, ['quiche', 'boeuf-carottes', 'risotto']);
  assert.ok(platsSansVersion(CATALOGUE, SANS_STYLE).every((e) => !e.aCompleter && e.manquants.length === 0));
});

test('bilanCompatibilite : aCompleter compté, aussi dans avecVersion', () => {
  assert.deepEqual(bilanCompatibilite(CATALOGUE, ADULTE_B), { convient: 1, avecVersion: 3, aCreer: 3, aCompleter: 2, orphelines: 0 });
  assert.deepEqual(bilanCompatibilite(CATALOGUE, SANS_STYLE), { convient: 1, avecVersion: 3, aCreer: 3, aCompleter: 0, orphelines: 0 });
  assert.equal(platsSansVersion(CATALOGUE, ADULTE_B).length, 5);
});

test('aCompleterSelon : mêmes filtres qu’aAdapterSelon ; aAdapterPour inchangé', () => {
  const gratin = CATALOGUE.find((p) => p.id === 'gratin');
  const r = evaluer(gratin, ADULTE_B);
  assert.equal(aCompleterSelon(gratin, ADULTE_B, r), true);
  assert.equal(aAdapterSelon(gratin, ADULTE_B, r), false);
  assert.equal(aAdapterPour(gratin, ADULTE_B), false);
  for (const id of ['jamais', 'feuilletes', 'fond-maison']) {
    const p = CATALOGUE.find((x) => x.id === id);
    assert.equal(evaluer(p, ADULTE_B).aCompleter, true, id);
    assert.equal(aCompleterSelon(p, ADULTE_B, evaluer(p, ADULTE_B)), false, id);
  }
  assert.equal(aCompleterSelon(gratin, ADULTE_B, null), false);
  assert.equal(aCompleterSelon({ id: 'a', nom: 'A' }, ADULTE_B, { aCompleter: true }), false, 'plat sans recette');
});

test('filtrerPlats « Versions à créer » : garde aussi les plats à compléter', () => {
  const filtres = filtresPour([ADULTE_B], { role: 'gestionnaire' });
  const ids = (profils) => filtrerPlats(CATALOGUE, { filtre: { ...filtreRetenu(filtres, 'a-creer'), profils }, evaluer }).map((p) => p.id);
  assert.deepEqual(ids([ADULTE_B]), ['boeuf-carottes', 'gratin', 'quiche', 'risotto', 'tarte']);
  assert.deepEqual(ids([SANS_STYLE]), ['boeuf-carottes', 'quiche', 'risotto']);
  // « Pour <Prénom> » : un plat à compléter se mange déjà (version qui convient).
  const pour = filtrerPlats(CATALOGUE, { filtre: filtreRetenu(filtres, 'pour-profil-b'), evaluer }).map((p) => p.id);
  assert.ok(pour.includes('gratin') && pour.includes('tarte') && pour.includes('cake'));
});

// ——— claude.js : textes copiés ———

const REGLES_B = 'Ne mange pas de viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni de bouillon ou de fond de viande ou de volaille, ni de gélatine animale, ni de graisse animale (saindoux, graisse de canard). Mange du poisson, des fruits de mer, du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel.';
const REGLES_ENFANT = 'Ne mange ni viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni poisson, ni fruits de mer, ni bouillon ou fond de viande, de volaille ou de poisson, ni gélatine animale, ni graisse animale. Mange des œufs, du fromage (même à présure animale) et du miel.';
const CONSIGNE_RECETTE = '(Si le plat contient ce qu\'un de ces profils ne mange pas, ajoute sa variante — une par style indiqué, avec `style` (et `frigoJours` pour `mer`) : remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Rends la fiche complète, en un seul bloc.)';
const CONSIGNE_STYLES = '(Pour chaque plat, rends seulement { "id", "nom", "variantes": [les versions de sa ligne « à faire »] }, jamais la recette entière. Une version par style, avec `style` (et `frigoJours` pour `mer`) ; une version que tu rends remplace celle du même style, les autres restent. Remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Tous les plats dans un seul bloc paquet@1. Un plat impossible à adapter : ne le rends pas, et dis-le en une phrase.)';
const CONSIGNE_SANS_STYLE = '(Pour chaque plat, rends seulement { "id", "nom", "variantes": [la variante pour ce profil] }, jamais la recette entière. Remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Tous les plats dans un seul bloc paquet@1. Un plat impossible à adapter : ne le rends pas, et dis-le en une phrase.)';

test('DEMANDE-RECETTE : styles en fin de ligne des profils qui en attendent, ligne inchangée sinon', () => {
  const autre = { id: 'profil-c', nom: 'Adulte C', ordre: 4, regles: SANS_VIANDE_EN_CODES };
  assert.equal(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }, { profils: [...PROFILS, autre] }), [
    'DEMANDE-RECETTE paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'id: plat-x',
    'nom: Plat X',
    'versions:',
    `- pour: profil-b — ${REGLES_B} — styles: mer, vegetal`,
    `- pour: enfant — ${REGLES_ENFANT} — styles: vegetal`,
    '- pour: profil-c — exclut les marqueurs viande, bouillon_viande.',
    '(Ajoute un lien, une photo ou la recette dictée.)',
    CONSIGNE_RECETTE,
  ].join('\n'));
  // Sans profil contraint : texte de T1b.
  assert.equal(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }, { profils: [ADULTE_A] }),
    `DEMANDE-RECETTE paquet@1\ninstructions: ${VERSION_INSTRUCTIONS}\nid: plat-x\nnom: Plat X\n(Ajoute un lien, une photo ou la recette dictée.)`);
});

test('DEMANDE-VARIANTES : profil avec styles, plats à créer, à revoir et à compléter (texte exact)', () => {
  const merRatee = version('profil-b', ['lardons'], [SAUMON, JAMBON], 'Part au saumon.', { style: 'mer', frigoJours: 2 });
  const lot = [
    plat('quiche-test', 'Quiche test', [PATES, LARDONS, OEUFS]),
    plat('cake-test', 'Cake test', [PATES, LARDONS], { variantes: [merRatee, VEGETALE] }),
    plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes: [MER] }),
  ];
  assert.equal(texteDemandeVariantes(lot, ADULTE_B), [
    'DEMANDE-VARIANTES paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'pour: profil-b',
    'styles: mer, vegetal',
    'besoin: sans_viande',
    `règles: ${REGLES_B}`,
    CONSIGNE_STYLES,
    'plats:',
    '- id: quiche-test',
    '  nom: Quiche test',
    '  portions: 4',
    '  ingrédients: 400 g pâtes ; 200 g lardons ✗ ; 3 œuf',
    '  à faire: mer, vegetal',
    '- id: cake-test',
    '  nom: Cake test',
    '  portions: 4',
    '  ingrédients: 400 g pâtes ; 200 g lardons ✗',
    '  version actuelle (mer): retirer: lardons ; ajouter: 2 tranche saumon fumé par portion, 50 g jambon par portion ✗ ; consigne: Part au saumon.',
    '  à faire: mer',
    '- id: gratin-test',
    '  nom: Gratin test',
    '  portions: 4',
    '  ingrédients: 400 g pâtes ; 200 g lardons ✗',
    '  à faire: vegetal',
  ].join('\n'));
});

test('DEMANDE-VARIANTES : « ni viande ni poisson » → styles: vegetal ; version mer à revoir montrée sous le style à faire', () => {
  // Version d'avant les styles qui ajoute du saumon (cas de T2a) : elle est à revoir, et c'est elle que Claude refait.
  // Son style (mer) n'est pas attendu : elle est montrée comme la version végétale actuelle, et le besoin vient d'elle
  // (elle ajoute du poisson → adapter). La version rendue la remplace (paquet.js › fusionnerVariantes, attendus).
  const ancienne = version('enfant', ['lardons'], [SAUMON], 'Part au saumon.');
  for (const variante of [ancienne, { ...MER, pour: 'enfant' }]) {
    const p = plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes: [variante] });
    assert.equal(texteDemandeVariantes([p], ENFANT), [
      'DEMANDE-VARIANTES paquet@1',
      `instructions: ${VERSION_INSTRUCTIONS}`,
      'pour: enfant',
      'styles: vegetal',
      'besoin: adapter',
      `règles: ${REGLES_ENFANT}`,
      CONSIGNE_STYLES,
      'plats:',
      '- id: gratin-test',
      '  nom: Gratin test',
      '  portions: 4',
      '  ingrédients: 400 g pâtes ; 200 g lardons ✗',
      '  version actuelle (vegetal): retirer: lardons ; ajouter: 2 tranche saumon fumé par portion ✗ ; consigne: Part au saumon.',
      '  à faire: vegetal',
    ].join('\n'));
  }
});

test('DEMANDE-VARIANTES : version végétale à revoir et version mer plus attendue → seule la végétale, besoin tiré d’elle', () => {
  const mer = { ...MER, pour: 'enfant' };
  const vegetaleRatee = version('enfant', ['lardons'], [JAMBON], 'Part au jambon.', { style: 'vegetal' });
  for (const variantes of [[mer, vegetaleRatee], [vegetaleRatee, mer]]) {
    const p = plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes });
    const r = evaluer(p, ENFANT);
    assert.equal(r.aRevoir, true);
    // Restants et besoin : ceux de la version d'un style attendu (jambon → sans_viande), pas de la version mer.
    assert.deepEqual(r.restants, ['jambon']);
    assert.equal(r.besoin, 'sans_viande');
    const texte = texteDemandeVariantes([p], ENFANT);
    assert.match(texte, /\nbesoin: sans_viande\n/);
    assert.match(texte, /\n {2}version actuelle \(vegetal\): retirer: lardons ; ajouter: 50 g jambon par portion ✗ ; consigne: Part au jambon\.\n {2}à faire: vegetal$/);
    assert.doesNotMatch(texte, /saumon/);
  }
  // Plat complet malgré tout (version végétale qui convient) : la version mer n'est pas montrée.
  const complet = plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes: [mer, { ...VEGETALE, pour: 'enfant' }] });
  assert.doesNotMatch(texteDemandeVariantes([complet], ENFANT), /version actuelle|saumon/);
});

// ——— Desserts et accompagnements : jamais de version mer attendue ———

const GELATINE = ing('gélatine', 4, 'pc', ['gelatine_porc']);
const CREME = ing('crème liquide', 50, 'cl', ['laitier']);
const AGAR = ajout('agar-agar', 0.5, 'g');
const PANNA = plat('panna-cotta', 'Panna cotta', [CREME, GELATINE], { type: 'dessert' });
const PANNA_AGAR = { ...PANNA, variantes: [version('profil-b', ['gélatine'], [AGAR], 'À l’agar-agar.')] };

test('stylesAttendus : un dessert ou un accompagnement n’attend que la version végétale', () => {
  assert.deepEqual(stylesAttendus(ADULTE_B, PANNA), ['vegetal']);
  assert.deepEqual(stylesAttendus(ADULTE_B, { ...PANNA, type: 'accompagnement' }), ['vegetal']);
  assert.deepEqual(stylesAttendus(ADULTE_B, QUICHE), ['mer', 'vegetal']);
  assert.deepEqual(stylesAttendus(ADULTE_B, { id: 'x', nom: 'Sans type' }), ['mer', 'vegetal']);
  assert.deepEqual(stylesAttendus(ENFANT, PANNA), ['vegetal']);
  assert.deepEqual(stylesAttendus(ADULTE_A, PANNA), []);
  assert.deepEqual(stylesAttendus(SANS_STYLE, PANNA), []);
});

test('dessert à la gélatine avec sa version végétale : rien ne manque, jamais « à compléter »', () => {
  const r = evaluer(PANNA_AGAR, ADULTE_B);
  assert.equal(r.niveau, 'adaptable');
  assert.equal(r.variante.style, 'vegetal');
  assert.deepEqual(r.manquants, []);
  assert.equal(r.aCompleter, false);
  assert.equal(r.besoin, null);
  assert.equal(aCompleterSelon(PANNA_AGAR, ADULTE_B, r), false);
  assert.deepEqual(platsSansVersion([PANNA_AGAR], ADULTE_B), []);
  assert.deepEqual(bilanCompatibilite([PANNA_AGAR], ADULTE_B), { convient: 0, avecVersion: 1, aCreer: 0, aCompleter: 0, orphelines: 0 });
  const filtres = filtresPour([ADULTE_B], { role: 'gestionnaire' });
  assert.deepEqual(filtrerPlats([PANNA_AGAR], { filtre: { ...filtreRetenu(filtres, 'a-creer'), profils: [ADULTE_B] }, evaluer }), []);
  // Accompagnement : pareil.
  const accompagnement = { ...PANNA_AGAR, type: 'accompagnement' };
  assert.deepEqual(evaluer(accompagnement, ADULTE_B).manquants, []);
});

test('dessert sans version : seule la végétale est à faire, dans le texte copié aussi', () => {
  const r = evaluer(PANNA, ADULTE_B);
  assert.equal(r.aCreer, true);
  assert.deepEqual(r.manquants, ['vegetal']);
  const [element] = platsSansVersion([PANNA], ADULTE_B);
  assert.deepEqual(element.manquants, ['vegetal']);
  const texte = texteDemandeVariantes([PANNA, PANNA_AGAR, QUICHE], ADULTE_B);
  assert.match(texte, /- id: panna-cotta\n(?:.*\n){3} {2}à faire: vegetal\n/);
  // Dessert déjà complet, envoyé quand même : tous les styles attendus pour un dessert, donc la végétale seule.
  assert.match(texte, /- id: panna-cotta\n(?:.*\n){4}- id: panna-cotta\n(?:.*\n){3} {2}à faire: vegetal\n/);
  assert.match(texte, /- id: quiche-test\n(?:.*\n){3} {2}à faire: mer, vegetal$/);
  assert.doesNotMatch(texte, /à faire: mer\n/);
  // Demande de recette d'un plat déjà connu comme dessert : « — styles: vegetal ».
  const recette = texteDemandeRecette({ id: 'mousse', nom: 'Mousse', type: 'dessert' }, { profils: PROFILS });
  assert.match(recette, /\n- pour: profil-b — .* — styles: vegetal\n/);
  assert.doesNotMatch(recette, /styles: mer/);
});

test('DEMANDE-VARIANTES : versions à revoir de chaque style à refaire, une ligne par style', () => {
  const vieille = version('profil-b', [], [TOFU], 'Rien retiré.');
  const doublon = version('profil-b', [], [CHAMPIGNONS], 'Doublon.');
  const merRatee = { ...MER, retirer: [] };
  const p = plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes: [vieille, merRatee, doublon] });
  const texte = texteDemandeVariantes([p], ADULTE_B);
  assert.match(texte, /\n {2}version actuelle \(vegetal\): retirer: rien ; ajouter: 60 g tofu fumé par portion ; consigne: Rien retiré\.\n/);
  assert.match(texte, /\n {2}version actuelle \(mer\): retirer: rien ; ajouter: 2 tranche saumon fumé par portion ; consigne: Part au saumon\.\n/);
  assert.doesNotMatch(texte, /Doublon/);
  assert.match(texte, /\n {2}à faire: mer, vegetal$/);
});

test('DEMANDE-VARIANTES : lot de plats à compléter → besoin gardé ; plat sans rien à faire → tous les styles', () => {
  const lot = [
    plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes: [MER] }),
    plat('tarte-test', 'Tarte test', [PATES, LARDONS], { variantes: [VEGETALE] }),
  ];
  const texte = texteDemandeVariantes(lot, ADULTE_B);
  assert.match(texte, /\nstyles: mer, vegetal\nbesoin: sans_viande\nrègles: /);
  assert.match(texte, /- id: gratin-test\n(?:.*\n){3} {2}à faire: vegetal\n- id: tarte-test\n(?:.*\n){3} {2}à faire: mer$/);
  assert.doesNotMatch(texte, /version actuelle/);
  // Plat complet (deux versions qui conviennent) envoyé quand même : tous les styles, sans version actuelle.
  const complet = texteDemandeVariantes([plat('cake-test', 'Cake test', [PATES, LARDONS], { variantes: [MER, VEGETALE] })], ADULTE_B);
  assert.match(complet, /\n {2}à faire: mer, vegetal$/);
  assert.doesNotMatch(complet, /version actuelle|\nbesoin:/);
});

test('DEMANDE-VARIANTES : profil sans style attendu → texte d’avant, à l’identique', () => {
  const ratee = version('profil-b', ['lardons'], [JAMBON], 'Part au jambon.');
  const lot = [
    plat('quiche-test', 'Quiche test', [PATES, LARDONS, OEUFS]),
    plat('gratin-test', 'Gratin test', [PATES, LARDONS], { variantes: [ratee] }),
  ];
  assert.equal(texteDemandeVariantes(lot, SANS_STYLE), [
    'DEMANDE-VARIANTES paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'pour: profil-b',
    'besoin: sans_viande',
    'règles: exclut les marqueurs viande, bouillon_viande.',
    CONSIGNE_SANS_STYLE,
    'plats:',
    '- id: quiche-test',
    '  nom: Quiche test',
    '  portions: 4',
    '  ingrédients: 400 g pâtes ; 200 g lardons ✗ ; 3 œuf',
    '- id: gratin-test',
    '  nom: Gratin test',
    '  portions: 4',
    '  ingrédients: 400 g pâtes ; 200 g lardons ✗',
    '  version actuelle: retirer: lardons ; ajouter: 50 g jambon par portion ✗ ; consigne: Part au jambon.',
  ].join('\n'));
});

test('aucune espace insécable écrite telle quelle dans les fichiers des styles', async () => {
  for (const fichier of ['../js/coeur/vocabulaire.js', '../js/coeur/regles.js', '../js/coeur/compatibilite.js',
    '../js/coeur/plats.js', '../js/coeur/claude.js', './coeur-styles-compat.test.js']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});
