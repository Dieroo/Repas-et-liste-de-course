// « 🔄 Changer des plats » (2026-10-18) : plats de la mer (lireMer, FAMILLES_MER), « Une autre idée » de la mer,
// choix « Par quoi ? » (choixDeLaMer), plusieurs plats changés d'un coup (changerDesPlats), écritures d'un lot et leur
// « Annuler » (coeur/semaine.js › ecrituresRemplacements), textes. Fixtures génériques : aucune donnée du foyer.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireRegime } from '../js/coeur/regles.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { appliquerChamps, ecrituresRemplacements, estDansLaSemaine } from '../js/coeur/semaine.js';
import {
  CONDIMENTS_MER, FAMILLES_MER, TEXTES_PROPOSER, annonceChangement, autreIdee, changerDesPlats, choixDeLaMer,
  libelleChanger, libelleFamille, lireMer, texteAucunChangement,
} from '../js/coeur/proposition.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1, email: 'a@exemple.fr' };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, email: 'b@exemple.fr', regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5 };
const PROFILS = [A, B, E];

const ing = (produit, marqueurs = [], extra = {}) => ({ produit, qte: 100, unite: 'g', rayon: 'epicerie_salee', marqueurs, ...extra });
const LENTILLES = ing('lentilles', ['feculent']);
const CAROTTES = ing('carotte', ['legume'], { role: 'principal', qte: 400 });
const plat = (id, nom, ingredients = [LENTILLES], extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, ...extra,
});
const notes = (a) => ({ notes: { 'profil-a': a } });

const NEUFS = ['neuf-1', 'neuf-2', 'neuf-3', 'neuf-4'].map((id, i) => plat(id, `Neuf ${i + 1}`));
const SAUMON = plat('saumon-papillote', 'Saumon en papillote', [ing('pavé de saumon', ['poisson']), LENTILLES]);
const CABILLAUD = plat('curry-cabillaud', 'Curry de cabillaud', [ing('dos de cabillaud', ['poisson'])]);
const CREVETTES = plat('riz-crevettes', 'Riz aux crevettes', [ing('crevettes', ['fruits_de_mer'])]);
const MER = [SAUMON, CABILLAUD, CREVETTES];

const CIBLE = { id: '2026-10-12', debut: '2026-10-12', fin: '2026-10-18' };
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
const semaine = (plats = {}, extra = {}) => ({ ...CIBLE, creeLe: 1, plats, ...extra });
const opts = (extra = {}) => ({ semaines: [], profils: PROFILS, evaluer, ...extra });

/** Gel profond : une fonction qui modifierait ses entrées lèverait une erreur. */
function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

// ——— lireMer ———

test('lireMer : un produit de la mer sans viande fait un plat de la mer, avec ses familles dans l’ordre de FAMILLES_MER', () => {
  assert.deepEqual(lireMer(SAUMON), { deLaMer: true, familles: ['saumon'] });
  assert.deepEqual(lireMer(CABILLAUD), { deLaMer: true, familles: ['cabillaud'] });
  const melange = plat('m', 'M', [ing('crevettes', ['fruits_de_mer']), ing('filet de saumon', ['poisson'])]);
  assert.deepEqual(lireMer(melange), { deLaMer: true, familles: ['saumon', 'crevette'] });
  const coquilles = plat('c', 'C', [ing('noix de Saint-Jacques', ['fruits_de_mer']), ing('mélange de fruits de mer', ['fruits_de_mer'])]);
  assert.deepEqual(lireMer(coquilles).familles, ['saint-jacques', 'fruits-de-mer']);
  // Un grand prédateur est un poisson (marqueursEffectifs) ; un poisson d'aucune famille compte pour « Peu importe ».
  assert.deepEqual(lireMer(plat('e', 'E', [ing('pavé d’espadon', ['poisson_predateur'])])), { deLaMer: true, familles: ['espadon'] });
  assert.deepEqual(lireMer(plat('r', 'R', [ing('requin', ['poisson'])])), { deLaMer: true, familles: [] });
});

test('lireMer : jamais avec de la viande (charcuterie comprise), un assaisonnement de la mer ni sans recette', () => {
  const rien = { deLaMer: false, familles: [] };
  assert.deepEqual(lireMer(plat('p', 'P', [ing('saumon', ['poisson']), ing('lardons', ['charcuterie'])])), rien);
  assert.deepEqual(lireMer(plat('p', 'P', [ing('crevettes', ['fruits_de_mer']), ing('poulet', ['viande', 'volaille'])])), rien);
  assert.deepEqual(lireMer(plat('n', 'N', [ing('sauce nuoc-mâm', ['poisson']), LENTILLES])), rien);
  assert.deepEqual(lireMer(plat('f', 'F', [ing('fumet de poisson', ['poisson'])])), rien);
  assert.deepEqual(lireMer(plat('a', 'A', [ing('filet d’anchois', ['poisson'])])), rien);
  assert.deepEqual(lireMer(plat('l', 'L')), rien);
  assert.deepEqual(lireMer({ id: 'attente', nom: 'Sans recette' }), rien);
  assert.deepEqual(lireMer(null), rien);
  assert.ok(CONDIMENTS_MER.includes('sauce') && CONDIMENTS_MER.includes('fumet'));
});

test('FAMILLES_MER : ids uniques au format des identifiants, noms et tournures remplis, mots au format cleProduit', () => {
  const ids = FAMILLES_MER.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of FAMILLES_MER) {
    assert.match(f.id, /^[a-z0-9-]+$/);
    assert.ok(f.nom && /^(au |aux |à la |à l’)/.test(f.au), f.id);
    assert.ok(Object.isFrozen(f) && f.mots.length && f.mots.every((m) => m.every((mot) => /^[a-z0-9]+$/.test(mot))), f.id);
  }
});

// ——— autreIdee de la mer ———

test('autreIdee mer : la famille demandée, sinon null (jamais un autre plat) ; « tout » ; dessert, valeur inconnue → null', () => {
  const tous = geler([...NEUFS, ...MER]);
  const cible = { ...CIBLE, plats: { 'neuf-1': dans(1) } };
  assert.equal(autreIdee(tous, 'neuf-1', opts({ cible, mer: 'saumon' })).platId, 'saumon-papillote');
  assert.equal(autreIdee(tous, 'neuf-1', opts({ cible, mer: 'crevette' })).platId, 'riz-crevettes');
  assert.ok(MER.some((p) => p.id === autreIdee(tous, 'neuf-1', opts({ cible, mer: 'tout' })).platId));
  assert.equal(autreIdee(tous, 'neuf-1', opts({ cible, mer: 'thon' })), null);
  assert.equal(autreIdee(tous, 'neuf-1', opts({ cible, mer: 'inconnu' })), null);
  assert.match(autreIdee(tous, 'neuf-1', opts({ cible, mer: null })).platId, /^(neuf-|saumon|curry|riz)/);
  const tarte = plat('tarte', 'Tarte', [ing('farine', [])], { type: 'dessert' });
  const avecTarte = { ...CIBLE, plats: { tarte: dans(1) } };
  assert.equal(autreIdee([...tous, tarte], 'tarte', opts({ cible: avecTarte, mer: 'tout' })), null);
});

test('autreIdee mer : garde le filtre dur (« Jamais » d’un adulte) ; un plat déjà dans la semaine n’est pas repris', () => {
  const jamais = { ...SAUMON, ...notes(0) };
  const cible = { ...CIBLE, plats: { 'neuf-1': dans(1) } };
  assert.equal(autreIdee([...NEUFS, jamais], 'neuf-1', opts({ cible, mer: 'saumon' })), null);
  const avecSaumon = { ...CIBLE, plats: { 'neuf-1': dans(1), 'saumon-papillote': dans(2) } };
  assert.equal(autreIdee([...NEUFS, ...MER], 'neuf-1', opts({ cible: avecSaumon, mer: 'saumon' })), null);
});

test('autreIdee mer : le seul plat avec des légumes est remplacé par un plat de la mer avec des légumes d’abord', () => {
  const soupe = plat('soupe-carottes', 'Soupe de carottes', [CAROTTES]);
  const saumonLegumes = plat('saumon-legumes', 'Saumon et carottes', [ing('saumon', ['poisson']), CAROTTES]);
  const cible = { ...CIBLE, plats: { 'soupe-carottes': dans(1) } };
  assert.equal(autreIdee([soupe, ...MER, saumonLegumes], 'soupe-carottes', opts({ cible, mer: 'tout' })).platId, 'saumon-legumes');
  // Sans plat de la mer avec des légumes : un plat de la mer quand même, jamais un plat sans poisson.
  assert.ok(MER.some((p) => p.id === autreIdee([soupe, ...MER, ...NEUFS], 'soupe-carottes', opts({ cible, mer: 'tout' })).platId));
});

// ——— choixDeLaMer ———

test('choixDeLaMer : plats de la mer proposables par famille ; ni la cible, ni un refusé ; cible illisible', () => {
  const thon = plat('salade-thon', 'Salade au thon et saumon', [ing('thon', ['poisson']), ing('saumon fumé', ['poisson'])]);
  const tous = geler([...NEUFS, ...MER, thon]);
  const cible = { ...CIBLE, plats: { 'neuf-1': dans(1), 'curry-cabillaud': dans(2) } };
  assert.deepEqual(choixDeLaMer(tous, opts({ cible })), {
    total: 3,
    familles: [{ id: 'saumon', nom: 'Saumon', nombre: 2 }, { id: 'thon', nom: 'Thon', nombre: 1 }, { id: 'crevette', nom: 'Crevettes', nombre: 1 }],
  });
  assert.equal(choixDeLaMer(tous, opts({ cible, refuses: ['riz-crevettes'] })).total, 2);
  assert.deepEqual(choixDeLaMer(tous, opts({ cible: null })), { total: 0, familles: [] });
  assert.deepEqual(choixDeLaMer(NEUFS, opts({ cible })), { total: 0, familles: [] });
});

// ——— changerDesPlats ———

test('changerDesPlats : chaque plat coché, dans l’ordre de la semaine, a son remplaçant ; jamais deux fois le même', () => {
  const tous = geler([...NEUFS, ...MER]);
  const s = geler(semaine({ 'neuf-1': dans(20), 'neuf-2': dans(10), 'neuf-3': dans(30) }));
  const r = changerDesPlats(tous, ['neuf-1', 'neuf-2'], opts({ semaine: s, mer: 'tout' }));
  assert.deepEqual(r.remplacements.map((x) => x.ancienId), ['neuf-2', 'neuf-1']);
  const nouveaux = r.remplacements.map((x) => x.platId);
  assert.equal(new Set(nouveaux).size, 2);
  assert.ok(nouveaux.every((id) => MER.some((p) => p.id === id)));
  assert.deepEqual(r.restes, []);
  for (const x of r.remplacements) assert.ok(x.raison && x.groupe && x.palier);
});

test('changerDesPlats : moins de plats de la famille que de plats cochés → les autres restent ; jamais un plat coché repris', () => {
  const tous = [...NEUFS, ...MER];
  const s = semaine({ 'neuf-1': dans(1), 'neuf-2': dans(2) });
  const r = changerDesPlats(tous, ['neuf-1', 'neuf-2'], opts({ semaine: s, mer: 'saumon' }));
  assert.deepEqual(r.remplacements.map((x) => [x.ancienId, x.platId]), [['neuf-1', 'saumon-papillote']]);
  assert.deepEqual(r.restes, ['neuf-2']);
  // Sans choix de la mer : neuf-2 ne remplace jamais neuf-1 (tous deux cochés).
  const libre = changerDesPlats(NEUFS.slice(0, 3), ['neuf-1', 'neuf-2'], opts({ semaine: s }));
  assert.deepEqual(libre.remplacements.map((x) => x.platId), ['neuf-3']);
  assert.deepEqual(libre.restes, ['neuf-2']);
});

test('changerDesPlats : plats absents ou retirés ignorés ; semaine illisible → rien', () => {
  const s = semaine({ 'neuf-1': dans(1), 'neuf-2': dans(2, { retire: true }) });
  const r = changerDesPlats([...NEUFS, ...MER], ['neuf-2', 'inconnu', 'neuf-1', 'neuf-1'], opts({ semaine: s, mer: 'crevette' }));
  assert.deepEqual(r.remplacements.map((x) => x.ancienId), ['neuf-1']);
  assert.deepEqual(changerDesPlats(NEUFS, ['neuf-1'], opts({ semaine: null })), { remplacements: [], restes: [] });
});

// ——— Écritures d'un lot et « Annuler » ———

test('ecrituresRemplacements : un lot pour tous les échanges, et « Annuler » qui les défait', () => {
  const s = geler(semaine({ 'neuf-1': dans(1), 'neuf-2': dans(2), 'saumon-papillote': dans(9, { retire: true, repas: 3 }) }));
  const paires = [{ ancienId: 'neuf-1', nouveauId: 'saumon-papillote' }, { ancienId: 'neuf-2', nouveauId: 'riz-crevettes' }];
  const lot = ecrituresRemplacements(s, paires);
  assert.equal(lot.id, CIBLE.id);
  assert.deepEqual(lot.faites, paires);
  const apres = appliquerChamps(s, lot.champs);
  assert.ok(!estDansLaSemaine(apres.plats['neuf-1']) && !estDansLaSemaine(apres.plats['neuf-2']));
  assert.equal(apres.plats['saumon-papillote'].ajouteLe, 1);
  assert.equal(apres.plats['saumon-papillote'].repas, undefined, 'un plat retiré plus tôt repart de ses réglages de départ');
  assert.equal(apres.plats['riz-crevettes'].ajouteLe, 2);
  const annuler = ecrituresRemplacements({ ...apres, id: CIBLE.id }, paires, { inverse: true });
  const remis = appliquerChamps(apres, annuler.champs);
  assert.ok(estDansLaSemaine(remis.plats['neuf-1']) && estDansLaSemaine(remis.plats['neuf-2']));
  assert.ok(!estDansLaSemaine(remis.plats['saumon-papillote']) && !estDansLaSemaine(remis.plats['riz-crevettes']));
});

test('ecrituresRemplacements : un échange devenu inutile est sauté ; aucun → inutile ; courses faites ; paires vides', () => {
  const s = semaine({ 'neuf-1': dans(1), 'neuf-2': dans(2, { retire: true }) });
  const lot = ecrituresRemplacements(s, [{ ancienId: 'neuf-1', nouveauId: 'neuf-3' }, { ancienId: 'neuf-2', nouveauId: 'neuf-4' }]);
  assert.deepEqual(lot.faites, [{ ancienId: 'neuf-1', nouveauId: 'neuf-3' }]);
  assert.deepEqual(ecrituresRemplacements(s, [{ ancienId: 'neuf-2', nouveauId: 'neuf-4' }]), { code: 'inutile' });
  assert.deepEqual(ecrituresRemplacements({ ...s, statut: 'courses_faites' }, [{ ancienId: 'neuf-1', nouveauId: 'neuf-3' }]), { code: 'faites' });
  assert.deepEqual(ecrituresRemplacements(s, []), { code: 'invalide' });
  assert.deepEqual(ecrituresRemplacements(null, [{ ancienId: 'neuf-1', nouveauId: 'neuf-3' }]), { code: 'invalide' });
});

// ——— Textes ———

test('textes : libellé du bouton, puces, annonce et phrase sans plat', () => {
  assert.equal(TEXTES_PROPOSER.changer.libelle, 'Changer des plats');
  assert.equal(libelleChanger(0), 'Remplacer les plats cochés');
  assert.equal(libelleChanger(1), 'Remplacer un plat');
  assert.equal(libelleChanger(3), 'Remplacer 3 plats');
  assert.equal(libelleFamille({ nom: 'Saumon', nombre: 3 }), 'Saumon · 3');
  assert.equal(annonceChangement({ remplaces: 1, voulus: 1 }), 'Un plat changé.');
  assert.equal(annonceChangement({ remplaces: 2, voulus: 2, mer: 'saumon' }), '2 plats changés.');
  assert.equal(annonceChangement({ remplaces: 1, voulus: 2, mer: 'saumon' }),
    'Un plat changé sur 2 : pas d’autre plat au saumon pour l’instant.');
  assert.equal(annonceChangement({ remplaces: 2, voulus: 3, mer: 'tout' }),
    '2 plats changés sur 3 : pas d’autre plat de la mer pour l’instant.');
  assert.equal(annonceChangement({ remplaces: 1, voulus: 2 }), 'Un plat changé sur 2 : pas d’autre idée pour l’instant.');
  assert.equal(texteAucunChangement('crevette'), 'Pas d’autre plat aux crevettes pour l’instant.');
  assert.equal(texteAucunChangement('tout'), 'Pas d’autre plat de la mer pour l’instant.');
  assert.equal(texteAucunChangement(null), 'Plus d’autre idée pour l’instant.');
});
