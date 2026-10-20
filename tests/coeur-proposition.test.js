// T4-0 « Proposer les plats de la semaine » : coeur/proposition.js (nombre voulu, filtre dur, historique, paliers,
// groupes, score, remplissage, desserts à part, « Une autre idée », textes) et les écritures groupées de
// coeur/semaine.js (ecrituresAjoutGroupe, ecrituresRetraitGroupe, ecrituresRemplacement), la carte « prochaine
// action » (coeur/liste.js). Fixtures génériques : aucune donnée du foyer.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ecrireRegime } from '../js/coeur/regles.js';
import { BAREME_AGE, regleDuPalier } from '../js/coeur/age.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { carteProchaineAction } from '../js/coeur/liste.js';
import {
  EFFACER, aDesReglagesEcrits, appliquerChamps, aDesPlats, champsValides, ecrituresAjoutGroupe, ecrituresRemplacement,
  ecrituresRetraitGroupe, jourDeDerniereFois,
} from '../js/coeur/semaine.js';
import {
  BASES_DE_SAUCE, BRUIT_MAX, DESSERTS_MAX, ECARTES_MAX, GRAMMES_PAR_BOITE, JOURS_RECENTS, LEGUMES_AROMATIQUES,
  LEGUMES_MIN, LEGUME_VISIBLE_G, POIDS_PIECE_LEGUMES, PORTION_LEGUMES_G, PROPOSITION_MIN, TEXTES_PROPOSER, aDesLegumes, annonceProposition,
  apercuProposition, autreIdee, candidats, changerDesPlats, ecartAuMenu, emplacements, graineProposition, historiqueDesPlats,
  libelleProposer, libelleProposerDesserts, nombreAProposer, nombreDeDessertsParDefaut, nombreProposable,
  nomAutreIdee, peutChangerDIdee, proposerDesserts, proposerPlats, sousTitreDesserts, texteAutreIdee, texteRaison,
  texteSansProposition,
} from '../js/coeur/proposition.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const MIEL = regleDuPalier(BAREME_AGE.find((e) => e.code === 'miel'), 0);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1, email: 'a@exemple.fr' };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, email: 'b@exemple.fr', regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [MIEL] };
const PROFILS = [E, B, A]; // dans le désordre exprès

const ing = (produit, marqueurs = [], extra = {}) => ({ produit, qte: 100, unite: 'g', rayon: 'epicerie_salee', marqueurs, ...extra });
const LENTILLES = ing('lentilles', ['feculent']);
const BOEUF = ing('bœuf', ['viande', 'boeuf'], { forme: 'morceaux' });
const POULET = ing('poulet', ['viande', 'volaille'], { forme: 'morceaux' });
const SAUMON = ing('saumon', ['poisson']);
const MIEL_ING = ing('miel', ['miel']);
const VERSION_B = { pour: 'profil-b', style: 'vegetal', retirer: ['bœuf', 'poulet'], ajouter: [], consigne: 'Sans viande.' };
const plat = (id, nom, ingredients = [LENTILLES], extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, ...extra,
});
const dessert = (id, nom, extra = {}) => plat(id, nom, [ing('farine', [])], { type: 'dessert', ...extra });
const notes = (a, b, e) => ({ notes: Object.fromEntries([['profil-a', a], ['profil-b', b], ['enfant', e]].filter(([, n]) => n !== undefined)) });

const CIBLE = { id: '2026-10-12', debut: '2026-10-12', fin: '2026-10-18' };
const SUIVANTE = { id: '2026-10-19', debut: '2026-10-19', fin: '2026-10-25' };
const semaine = (id, debut, fin, plats = {}, extra = {}) => ({ id, debut, fin, creeLe: 1, plats, ...extra });
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
const opts = (extra = {}) => ({ cible: CIBLE, semaines: [], profils: PROFILS, evaluer, ...extra });

/** Gel profond : une fonction qui modifierait ses entrées lèverait une erreur. */
function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

/** Catalogue riche : 4 aimés, 4 à découvrir, tous mangés par tout le monde (sans viande ni miel). */
const AIMES = ['aime-1', 'aime-2', 'aime-3', 'aime-4'].map((id, i) => plat(id, `Aimé ${i + 1}`, [LENTILLES], notes(5, 4, 4)));
const DECOUVRIR = ['neuf-1', 'neuf-2', 'neuf-3', 'neuf-4'].map((id, i) => plat(id, `Neuf ${i + 1}`, [LENTILLES]));
const RICHE = geler([...AIMES, ...DECOUVRIR]);

// ——— Emplacements ———

test('emplacements : 1 à 10 ; 4 → 2 aimés + 2 à découvrir ; 3 → 2 + 1', () => {
  assert.deepEqual(emplacements(4), ['aime', 'aime', 'decouvrir', 'decouvrir']);
  assert.deepEqual(emplacements(3), ['aime', 'aime', 'decouvrir']);
  assert.deepEqual(emplacements(1), ['aime']);
  assert.deepEqual(emplacements(0), []);
  assert.deepEqual(emplacements(-2), []);
  for (let n = 1; n <= 10; n += 1) {
    const e = emplacements(n);
    assert.equal(e.length, n);
    assert.equal(e.filter((g) => g === 'aime').length, Math.ceil(n / 2));
  }
});

// ——— Nombre voulu ———

const histo = (id, debut, fin, ids) => semaine(id, debut, fin, Object.fromEntries(ids.map((p, i) => [p, dans(i + 1)])));
const N = (semaines, cible = CIBLE, tousLesPlats = RICHE) => nombreAProposer(semaines, cible, { tousLesPlats, profils: PROFILS, evaluer });

test('nombreAProposer : 4 sans historique ; médiane des 3 dernières semaines ; semaine de 10 jours ramenée à 7', () => {
  assert.deepEqual(N([]), { voulu: 4, presents: 0, aProposer: 4 });
  const s1 = histo('2026-09-21', '2026-09-21', '2026-09-27', ['aime-1', 'aime-2', 'aime-3', 'aime-4', 'neuf-1']);
  const s2 = histo('2026-09-28', '2026-09-28', '2026-10-04', ['aime-1', 'aime-2', 'aime-3']);
  const s3 = histo('2026-10-05', '2026-10-05', '2026-10-11', ['aime-1', 'aime-2', 'aime-3', 'aime-4', 'neuf-1', 'neuf-2']);
  assert.equal(N([s1, s2, s3]).voulu, 5, 'médiane de 3, 5 et 6');
  const ancienne = histo('2026-09-14', '2026-09-14', '2026-09-20', ['aime-1', 'aime-2', 'aime-3']);
  assert.equal(N([ancienne, s1, s2, s3]).voulu, 5, 'seules les 3 dernières comptent');
  // 10 jours, 5 plats → 3,5 pour 7 jours → 4.
  const longue = histo('2026-10-01', '2026-10-01', '2026-10-10', ['aime-1', 'aime-2', 'aime-3', 'aime-4', 'neuf-1']);
  assert.equal(N([longue]).voulu, 4);
  // Deux semaines : moyenne des deux valeurs du milieu.
  assert.equal(N([s2, s3]).voulu, 5, '(3 + 6) ÷ 2 = 4,5 → 5');
});

test('nombreAProposer : bornes 3 et 6 ; cible de 14 jours (6 à 10) ; semaine vidée, corbeille et « personne » non comptés', () => {
  const peu = histo('2026-10-05', '2026-10-05', '2026-10-11', ['aime-1']);
  assert.equal(N([peu]).voulu, 3);
  const beaucoup = histo('2026-10-05', '2026-10-05', '2026-10-11', [...AIMES, ...DECOUVRIR].map((p) => p.id));
  assert.equal(N([beaucoup]).voulu, 6);
  const quinze = { id: '2026-10-12', debut: '2026-10-12', fin: '2026-10-25' };
  assert.equal(N([], quinze).voulu, 8, '4 × 2');
  assert.equal(N([beaucoup], quinze).voulu, 10, 'plafond 10');
  assert.equal(N([peu], quinze).voulu, 6, 'plancher 3 × 2');
  const videe = semaine('2026-10-05', '2026-10-05', '2026-10-11', { 'aime-1': dans(1, { retire: true }) });
  assert.equal(N([videe]).voulu, 4, 'semaine vidée ignorée');
  const jete = { ...plat('jete', 'Jeté'), corbeille: { le: 1, par: 'x@exemple.fr' } };
  const personne = plat('personne', 'Personne', [LENTILLES], notes(0, 0, 0));
  const tous = [...RICHE, jete, personne];
  const s = histo('2026-10-05', '2026-10-05', '2026-10-11', ['jete', 'personne', 'aime-1']);
  assert.equal(N([s], CIBLE, tous).voulu, 3, 'un seul plat compté : plancher');
  assert.equal(N([histo('2026-10-05', '2026-10-05', '2026-10-11', ['jete', 'personne'])], CIBLE, tous).voulu, 4, 'aucun : sans historique');
});

test('nombreAProposer : desserts non comptés ; présents de la cible ; semaine d’après la cible ignorée ; cible illisible', () => {
  const tarte = dessert('tarte', 'Tarte');
  const s = histo('2026-10-05', '2026-10-05', '2026-10-11', ['aime-1', 'aime-2', 'aime-3', 'aime-4', 'tarte']);
  assert.equal(N([s], CIBLE, [...RICHE, tarte]).voulu, 4);
  const cible = { ...CIBLE, plats: { 'aime-1': dans(1), tarte: dans(2), 'neuf-1': dans(3, { retire: true }) } };
  assert.deepEqual(N([], cible, [...RICHE, tarte]), { voulu: 4, presents: 1, aProposer: 3 });
  const apres = histo('2026-10-19', '2026-10-19', '2026-10-25', [...AIMES, ...DECOUVRIR].map((p) => p.id));
  assert.equal(N([apres]).voulu, 4);
  assert.deepEqual(N([], { id: 'X', debut: 'non', fin: 'non' }), { voulu: 0, presents: 0, aProposer: 0 });
});

// ——— Filtre dur ———

test('filtre dur : corbeille, apéro, préparation hebdo, accompagnement, sans recette, cible active, refusé, « Jamais » d’un adulte', () => {
  const catalogue = [
    plat('bon', 'Bon'),
    { ...plat('jete', 'Jeté'), corbeille: { le: 1, par: 'x@exemple.fr' } },
    plat('apero', 'Apéro', [LENTILLES], { type: 'apero' }),
    plat('yaourts', 'Yaourts', [LENTILLES], { type: 'preparation', recurrence: 'hebdo' }),
    plat('riz', 'Riz', [LENTILLES], { type: 'accompagnement' }),
    { id: 'attente', nom: 'Sans recette' },
    plat('attente-avec', 'Attente avec ingrédients', [LENTILLES], { statutRecette: 'attente' }),
    plat('actif', 'Actif'),
    plat('retire', 'Retiré'),
    plat('refuse', 'Refusé'),
    plat('jamais-a', 'Jamais A', [LENTILLES], notes(0)),
    plat('jamais-enfant', 'Jamais Enfant', [LENTILLES], notes(undefined, undefined, 0)),
    plat('jamais-ancien', 'Jamais d’un profil retiré', [LENTILLES], { notes: { 'profil-z': 0 } }),
  ];
  const cible = { ...CIBLE, plats: { actif: dans(1), retire: dans(2, { retire: true }) } };
  const ids = candidats(geler(catalogue), opts({ cible, refuses: ['refuse'] })).map((c) => c.platId);
  assert.deepEqual(ids, ['attente-avec', 'bon', 'jamais-ancien', 'jamais-enfant', 'retire']);
  const enfant = candidats(catalogue, opts({ cible })).find((c) => c.platId === 'jamais-enfant');
  assert.equal(enfant.palier, 3);
  assert.deepEqual(enfant.ecartes, [{ profilId: 'enfant', raison: 'jamaisEnfant' }]);
});

test('filtre dur : personne n’en mange (sauf foyer sans profil) ; « Jamais » d’un adulte sans adresse = écarté seulement', () => {
  const tous = [plat('personne', 'Personne', [LENTILLES], notes(0, 0, 0)), plat('bon', 'Bon')];
  assert.deepEqual(candidats(tous, opts()).map((c) => c.platId), ['bon']);
  const sansProfil = candidats(tous, opts({ profils: [] }));
  assert.deepEqual(sansProfil.map((c) => [c.platId, c.moyenne, c.palier]), [['bon', 3, 1], ['personne', 3, 1]]);
  const sansAdresse = { ...A, email: undefined };
  const c = candidats([plat('x', 'X', [LENTILLES], notes(0))], opts({ profils: [sansAdresse, B, E] }));
  assert.deepEqual(c[0].ecartes, [{ profilId: 'profil-a', raison: 'jamaisEnfant' }]);
});

// ——— Historique ———

test('historique : fin des semaines, derniereFois (texte et horodatage), semaines vides et cible ignorées', () => {
  const s1 = semaine('2026-09-28', '2026-09-28', '2026-10-04', { a: dans(1), b: dans(2, { retire: true }) });
  const vide = semaine('2026-09-21', '2026-09-21', '2026-09-27', { a: dans(1, { retire: true }) });
  const cible = semaine('2026-10-12', '2026-10-12', '2026-10-18', { a: dans(1) });
  const plats = [
    { id: 'a', nom: 'A', derniereFois: '2026-09-14' },
    { id: 'c', nom: 'C', derniereFois: { seconds: Date.UTC(2026, 8, 1, 12) / 1000 } },
    { id: 'd', nom: 'D', derniereFois: 'illisible' },
  ];
  const h = historiqueDesPlats([s1, vide, cible], plats, { cible: CIBLE });
  assert.deepEqual(h.get('a'), [{ debut: '2026-09-28', fin: '2026-10-04' }, { debut: '2026-09-14', fin: '2026-09-20' }]);
  assert.equal(h.has('b'), false, 'retiré');
  assert.deepEqual(h.get('c'), [{ debut: '2026-09-01', fin: '2026-09-07' }]);
  assert.equal(h.has('d'), false);
  assert.equal(jourDeDerniereFois('2026-10-10'), '2026-10-10');
  assert.equal(jourDeDerniereFois(null), null);
});

test('écart au menu : avant, après la cible, 0 si elle touche ; null sans passage', () => {
  assert.equal(ecartAuMenu([{ debut: '2026-09-28', fin: '2026-10-04' }], CIBLE), 8);
  assert.equal(ecartAuMenu([{ debut: '2026-10-25', fin: '2026-10-31' }], CIBLE), 7, 'semaine après la cible');
  assert.equal(ecartAuMenu([{ debut: '2026-10-15', fin: '2026-10-21' }], CIBLE), 0);
  assert.equal(ecartAuMenu([{ debut: '2026-09-01', fin: '2026-09-07' }, { debut: '2026-10-05', fin: '2026-10-11' }], CIBLE), 1);
  assert.equal(ecartAuMenu([], CIBLE), null);
  assert.equal(ecartAuMenu(undefined, CIBLE), null);
});

// ——— Paliers ———

const passe = (id, fin) => semaine(`s-${fin}`, `${fin.slice(0, 8)}${String(Number(fin.slice(8)) - 6).padStart(2, '0')}`, fin, { [id]: dans(1) });

test('paliers : récent à 14 jours, pas à 15 ; semaine d’après la cible récente ; palier 2 : le plus grand écart d’abord', () => {
  const tous = [plat('quatorze', 'Quatorze', [LENTILLES], { derniereFois: '2026-09-22' }), plat('quinze', 'Quinze', [LENTILLES], { derniereFois: '2026-09-21' })];
  // derniereFois 2026-09-22 → fin 2026-09-28 → 14 jours avant le 12 octobre.
  const c = Object.fromEntries(candidats(tous, opts()).map((x) => [x.platId, x]));
  assert.equal(c.quatorze.ecart, JOURS_RECENTS);
  assert.equal(c.quatorze.palier, 2);
  assert.equal(c.quinze.ecart, 15);
  assert.equal(c.quinze.palier, 1);
  const apres = candidats([plat('apres', 'Après')], opts({ semaines: [semaine('2026-10-26', '2026-10-26', '2026-11-01', { apres: dans(1) })] }));
  assert.deepEqual([apres[0].ecart, apres[0].palier], [8, 2]);
  // Palier 2 seul : le plus ancien d'abord, même mieux noté ailleurs.
  const recents = [
    plat('hier', 'Hier', [LENTILLES], { derniereFois: '2026-10-05', ...notes(5, 5, 5) }),
    plat('avant', 'Avant', [LENTILLES], { derniereFois: '2026-09-25', ...notes(4, 4, 4) }),
  ];
  assert.deepEqual(proposerPlats(recents, opts({ nombre: 1 })).ids, ['avant']);
});

test('paliers : version manquante, 🧸 « Pas avant… » et « Jamais » de l’enfant au palier 3 ; 🧸 « Déconseillé » au palier 1', () => {
  const soja = regleDuPalier(BAREME_AGE.find((e) => e.code === 'soja'), 0);
  const enfantSoja = { ...E, regles: [soja] };
  const tous = [
    plat('boeuf', 'Bœuf', [BOEUF]),
    plat('miel', 'Miel', [LENTILLES, MIEL_ING]),
    plat('tofu', 'Tofu', [ing('tofu', ['soja'])]),
  ];
  const c = Object.fromEntries(candidats(tous, opts({ profils: [A, B, enfantSoja, { ...E, id: 'enfant-2', nom: 'Enfant 2' }] })).map((x) => [x.platId, x]));
  assert.equal(c.boeuf.palier, 3);
  assert.deepEqual(c.boeuf.ecartes, [{ profilId: 'profil-b', raison: 'version' }]);
  assert.equal(c.miel.palier, 3);
  assert.deepEqual(c.miel.ecartes, [{ profilId: 'enfant-2', raison: 'age' }]);
  assert.equal(soja.severite, 'adaptable', 'soja : « Déconseillé avant 3 ans »');
  assert.equal(c.tofu.palier, 1, 'une précaution « Déconseillé » n’écarte personne');
  const avecVersion = candidats([plat('boeuf-v', 'Bœuf v', [BOEUF], { variantes: [VERSION_B] })], opts());
  assert.equal(avecVersion[0].palier, 1);
});

test('paliers : 1 avant 2 avant 3 ; palier 3 au plus 1 en comptant la cible ; « mange: true », ⏳ et corbeille non comptés, dessert compté', () => {
  const tous = [
    plat('p1', 'P1'), plat('p2', 'P2', [LENTILLES], { derniereFois: '2026-10-05' }),
    plat('x1', 'X1', [BOEUF]), plat('x2', 'X2', [POULET]),
  ];
  const r = proposerPlats(geler(tous), opts({ nombre: 4 }));
  // Ordre des emplacements (aimés d'abord) : le palier 3 a pris le premier emplacement resté libre.
  assert.deepEqual(r.choisis.map((c) => c.palier).sort(), [1, 2, 3]);
  assert.deepEqual(r.ids, ['x1', 'p1', 'p2']);
  assert.equal(r.code, 'peu');
  assert.equal(r.manque, 1);
  const bilan = (cible, autres = []) => proposerPlats([...tous, ...autres], opts({ nombre: 4, cible })).choisis.filter((c) => c.palier === 3).length;
  assert.equal(bilan({ ...CIBLE, plats: { 'b-cible': dans(1) } }, [plat('b-cible', 'Dans la cible', [BOEUF])]), 0, 'la cible en a déjà un');
  assert.equal(bilan({ ...CIBLE, plats: { 'b-cible': dans(1, { mange: { 'profil-b': true } }) } }, [plat('b-cible', 'Dans la cible', [BOEUF])]), 1, 'coché à la main : pas écarté');
  assert.equal(bilan({ ...CIBLE, plats: { attente: dans(1) } }, [{ id: 'attente', nom: 'Bœuf ⏳' }]), 1, '⏳ non compté');
  assert.equal(bilan({ ...CIBLE, plats: { jete: dans(1) } }, [{ ...plat('jete', 'Jeté', [BOEUF]), corbeille: { le: 1, par: 'x' } }]), 1, 'corbeille non comptée');
  assert.equal(bilan({ ...CIBLE, plats: { 'd-miel': dans(1) } }, [dessert('d-miel', 'Dessert au miel', { ingredients: [MIEL_ING] })]), 0, 'dessert compté');
  assert.equal(ECARTES_MAX, 1);
});

// ——— Groupes ———

test('groupes : « aimé » (un 4, les autres non notés), un 5 et un 2 → autre, « à découvrir », plancher sous 3', () => {
  const tous = [
    plat('un-quatre', 'Un quatre', [LENTILLES], notes(4)),
    plat('cinq-deux', 'Cinq et deux', [LENTILLES], notes(5, 2)),
    plat('non-note', 'Non noté', [LENTILLES], { derniereFois: '2026-01-05' }),
    plat('tous-trois', 'Tous trois', [LENTILLES], { derniereFois: '2026-01-05', ...notes(3, 3, 3) }),
    plat('tous-trois-jamais-servi', 'Jamais servi', [LENTILLES], notes(3, 3, 3)),
    plat('bof', 'Bof', [LENTILLES], notes(undefined, 2)),
  ];
  const g = Object.fromEntries(candidats(tous, opts()).map((c) => [c.platId, c.groupe]));
  assert.deepEqual(g, {
    'un-quatre': 'aime', 'cinq-deux': 'autre', 'non-note': 'decouvrir', 'tous-trois': 'autre',
    'tous-trois-jamais-servi': 'decouvrir', bof: 'autre',
  });
  const aime = candidats(tous, opts()).find((c) => c.platId === 'un-quatre');
  assert.deepEqual(aime.aimePar, ['profil-a']);
});

test('groupes : 4 → 2 aimés + 2 à découvrir ; un groupe vide est comblé par le meilleur score ; un plat noté sous 3 jamais dans un emplacement de groupe', () => {
  const r = proposerPlats(RICHE, opts({ nombre: 4 }));
  assert.deepEqual(r.choisis.map((c) => c.groupe), ['aime', 'aime', 'decouvrir', 'decouvrir']);
  assert.equal(r.code, 'ok');
  // Aucun aimé : les emplacements des aimés vont au meilleur score restant.
  const r2 = proposerPlats(DECOUVRIR, opts({ nombre: 4 }));
  assert.equal(r2.ids.length, 4);
  // Un plat noté 2 par un mangeur : jamais choisi dans un emplacement de groupe, même avec un très bon score ailleurs.
  const bof = plat('bof', 'Bof', [LENTILLES], notes(5, 2, 5));
  for (let i = 0; i < 20; i += 1) {
    const r3 = proposerPlats([...RICHE, bof], opts({ nombre: 4, graine: `g${i}` }));
    assert.equal(r3.ids.includes('bof'), false);
  }
  // … mais il vient quand il n'y a rien d'autre.
  assert.deepEqual(proposerPlats([bof, plat('n', 'N')], opts({ nombre: 2 })).ids.sort(), ['bof', 'n']);
});

// ——— Score et variété ———

test('score : non noté = 3 ; ancienneté plafonnée ; jamais au menu + 0,4', () => {
  const c = Object.fromEntries(candidats([
    plat('jamais', 'Jamais servi'),
    plat('vieux', 'Vieux', [LENTILLES], { derniereFois: '2025-01-01' }),
    plat('trois', 'Trois semaines', [LENTILLES], { derniereFois: '2026-09-14' }),
  ], opts()).map((x) => [x.platId, x]));
  assert.equal(c.jamais.moyenne, 3);
  assert.equal(c.jamais.base, 3.4);
  assert.equal(c.vieux.base, 3.8, 'plafond 8 semaines');
  assert.equal(c.trois.ecart, 22);
  assert.equal(c.trois.base, 3.3);
});

test('variété : même protéine − 0,4 puis − 0,8 ; « mijoté » sans malus, gratin avec', () => {
  // Trois poissons notés 5 (5,4) et un plat végétal noté 4 pas servi depuis 8 semaines (4,8) : le deuxième poisson
  // (5,0) passe devant le végétal, le troisième (4,6) après lui, quel que soit le départage (≤ 0,15).
  const poissons = ['p1', 'p2', 'p3'].map((id) => plat(id, `Poisson ${id}`, [SAUMON], notes(5, 5, 5)));
  const vege = plat('v', 'Légumes', [LENTILLES], { derniereFois: '2026-08-01', ...notes(4, 4, 4) });
  for (let i = 0; i < 20; i += 1) {
    const r = proposerPlats([...poissons, vege], opts({ nombre: 3, graine: `v${i}` }));
    assert.equal(r.ids.includes('v'), true, `graine v${i}`);
    assert.equal(r.ids.filter((id) => id.startsWith('p')).length, 2);
  }
  // Deux gratins (protéines différentes) et un mijoté, même note : jamais les deux gratins ensemble.
  const formes = [
    plat('gratin-1', 'Gratin de bœuf', [BOEUF], { notes: { 'profil-a': 4 } }),
    plat('gratin-2', 'Gratin de poulet', [POULET], { notes: { 'profil-a': 4 } }),
    plat('curry', 'Curry doux', [LENTILLES], { notes: { 'profil-a': 4 } }),
  ];
  for (let i = 0; i < 20; i += 1) {
    const deux = proposerPlats(formes, { ...opts({ nombre: 2, graine: `f${i}` }), profils: [A] }).ids;
    assert.ok(deux.includes('curry'), `graine f${i} : ${deux}`);
  }
});

test('ordre total : à égalité parfaite, le plus grand écart, puis le nom, puis l’identifiant', () => {
  const a = plat('b-id', 'Même nom');
  const b = plat('a-id', 'Même nom');
  const r = proposerPlats([a, b], opts({ nombre: 2, graine: 'g' }));
  assert.equal(new Set(r.ids).size, 2);
  // Graine sans effet sur un seul candidat par palier.
  assert.deepEqual(proposerPlats([a], opts({ nombre: 1, graine: 'g1' })).ids, proposerPlats([a], opts({ nombre: 1, graine: 'g2' })).ids);
});

// ——— Hasard ———

test('déterminisme : mêmes entrées, même sortie, quel que soit l’ordre des plats ; entrées jamais modifiées', () => {
  const r1 = proposerPlats(RICHE, opts({ nombre: 4 }));
  const r2 = proposerPlats([...RICHE].reverse(), opts({ nombre: 4 }));
  assert.deepEqual(r1, r2);
  assert.deepEqual(proposerPlats(RICHE, opts({ nombre: 4 })), r1);
});

test('graine : tirée des données ; avance quand une entrée de la cible passe « retire: true »', () => {
  assert.equal(graineProposition(CIBLE), 'proposer|2026-10-12|2026-10-18|0');
  const apres = { ...CIBLE, plats: { a: dans(1, { retire: true }), b: dans(2) } };
  assert.equal(graineProposition(apres), 'proposer|2026-10-12|2026-10-18|1');
  assert.equal(graineProposition(CIBLE, [semaine(CIBLE.id, CIBLE.debut, CIBLE.fin, { a: dans(1, { retire: true }) })]), 'proposer|2026-10-12|2026-10-18|1');
  assert.equal(graineProposition({ id: 'X' }), '');
  // Une entrée retirée n'écarte jamais un plat.
  assert.ok(candidats(RICHE, opts({ cible: { ...CIBLE, plats: { 'aime-1': dans(1, { retire: true }) } } })).some((c) => c.platId === 'aime-1'));
});

test('invariant 6 : sur 100 graines, un écart de moyenne de 0,25 n’est jamais renversé (départage ≤ 0,15)', () => {
  assert.equal(BRUIT_MAX, 0.15);
  // Quatre adultes sans règle : moyennes 4 et 3,75, même ancienneté, même variété.
  const profils = ['a', 'b', 'c', 'd'].map((x, i) => ({ id: `adulte-${x}`, nom: `Adulte ${x}`, ordre: i, coefPortion: 1, email: `${x}@exemple.fr` }));
  const sesNotes = (...n) => ({ notes: Object.fromEntries(n.map((v, i) => [profils[i].id, v])) });
  const haut = plat('haut', 'Haut', [LENTILLES], sesNotes(4, 4, 4, 4));
  const bas = plat('bas', 'Bas', [LENTILLES], sesNotes(5, 4, 3, 3));
  for (let i = 0; i < 100; i += 1) {
    const r = proposerPlats([bas, haut], { cible: CIBLE, semaines: [], profils, evaluer, nombre: 1, graine: `graine-${i}` });
    assert.deepEqual(r.ids, ['haut'], `graine-${i}`);
  }
});

// ——— « Une autre idée » ———

test('autreIdee : jamais l’ancien, la cible ni un refusé ; même groupe d’abord ; null sans candidat', () => {
  const cible = { ...CIBLE, plats: { 'aime-1': dans(1), 'neuf-1': dans(2) } };
  const r = autreIdee(RICHE, 'aime-1', opts({ cible, refuses: ['aime-2'] }));
  assert.ok(['aime-3', 'aime-4'].includes(r.platId), r.platId);
  assert.equal(r.groupe, 'aime');
  assert.deepEqual(r.raison, { code: 'aime', profils: ['profil-a', 'profil-b', 'enfant'] });
  const n = autreIdee(RICHE, 'neuf-1', opts({ cible }));
  assert.equal(n.groupe, 'decouvrir');
  assert.notEqual(n.platId, 'neuf-1');
  const seul = { ...CIBLE, plats: { 'aime-1': dans(1) } };
  assert.equal(autreIdee([AIMES[0]], 'aime-1', opts({ cible: seul })), null);
  assert.equal(autreIdee(RICHE, 'inconnu', opts({ cible })), null);
});

test('autreIdee : un dessert par un dessert ; palier 3 permis quand on remplace le plat du palier 3', () => {
  const desserts = [dessert('d1', 'Dessert 1'), dessert('d2', 'Dessert 2')];
  const cible = { ...CIBLE, plats: { d1: dans(1), 'aime-1': dans(2) } };
  assert.equal(autreIdee([...RICHE, ...desserts], 'd1', opts({ cible })).platId, 'd2');
  const b1 = plat('b1', 'B1', [BOEUF]);
  const b2 = plat('b2', 'B2', [POULET]);
  const avecB = { ...CIBLE, plats: { b1: dans(1), 'aime-1': dans(2) } };
  assert.equal(autreIdee([AIMES[0], b1, b2], 'b1', opts({ cible: avecB })).platId, 'b2');
  // En remplaçant un autre plat, b2 ne vient pas : la cible a déjà b1.
  assert.equal(autreIdee([AIMES[0], b1, b2], 'aime-1', opts({ cible: avecB })), null);
});

// ——— Causes ———

test('causes : versions (avec le profil), recettes, recents, catalogue', () => {
  const sansVersion = ['b1', 'b2', 'b3'].map((id) => plat(id, id, [BOEUF]));
  const r = proposerPlats(sansVersion, opts({ nombre: 4 }));
  assert.deepEqual([r.code, r.cause, r.profilCause, r.ids.length], ['peu', 'versions', 'profil-b', 1]);
  const attente = [{ id: 'a1', nom: 'A1' }, { id: 'a2', nom: 'A2' }, plat('ok', 'Ok')];
  assert.deepEqual([proposerPlats(attente, opts({ nombre: 4 })).cause], ['recettes']);
  const recents = ['r1', 'r2'].map((id) => plat(id, id, [LENTILLES], { derniereFois: '2026-10-05' }));
  assert.equal(proposerPlats(recents, opts({ nombre: 4 })).cause, 'recents');
  assert.deepEqual(proposerPlats([], opts({ nombre: 4 })), {
    type: 'plat', ids: [], choisis: [], manque: 4, code: 'aucun', cause: 'catalogue', profilCause: null,
  });
  assert.equal(proposerPlats([plat('jamais', 'J', [LENTILLES], notes(0))], opts({ nombre: 4 })).cause, 'jamais');
  assert.equal(proposerPlats(RICHE, opts({ cible: { id: 'X', debut: 'x', fin: 'y' }, nombre: 4 })).code, 'aucun');
});

// ——— proposerPlats : invariants ———

test('proposerPlats : sans doublon, au plus `nombre`, jamais de dessert ; nombre par défaut ; aucun plat du filtre dur', () => {
  const desserts = [dessert('d1', 'D1', notes(5, 5, 5)), dessert('d2', 'D2')];
  const tous = geler([...RICHE, ...desserts, { id: 'attente', nom: 'Attente' }]);
  const r = proposerPlats(tous, opts());
  assert.equal(r.ids.length, 4, 'nombreAProposer par défaut');
  assert.equal(new Set(r.ids).size, r.ids.length);
  assert.ok(r.ids.every((id) => !id.startsWith('d') && id !== 'attente'));
  assert.equal(r.type, 'plat');
  assert.deepEqual(proposerPlats(tous, opts({ nombre: 0 })).ids, []);
  for (const choisi of r.choisis) assert.ok(['aime', 'decouvrir'].includes(choisi.raison.code));
});

test('proposerPlats : raisons « ancien » et « recent »', () => {
  const tous = [
    plat('ancien', 'Ancien', [LENTILLES], { derniereFois: '2026-08-01', ...notes(3, 3, 3) }),
    plat('recent', 'Récent', [LENTILLES], { derniereFois: '2026-10-05', ...notes(3, 3, 3) }),
  ];
  const r = proposerPlats(tous, opts({ nombre: 2 }));
  assert.deepEqual(Object.fromEntries(r.choisis.map((c) => [c.platId, c.raison.code])), { ancien: 'ancien', recent: 'recent' });
});

// ——— Desserts (D6) ———

const DESSERTS = geler([
  dessert('mousse', 'Mousse', notes(5, 5)),
  dessert('tarte', 'Tarte'),
  dessert('flan', 'Flan', notes(4)),
  dessert('crumble', 'Crumble'),
  dessert('cake-miel', 'Cake au miel', { ingredients: [MIEL_ING] }),
]);

test('proposerDesserts : seulement des desserts, jamais un dessert actif de la cible ; groupes ; graine distincte', () => {
  const r = proposerDesserts([...RICHE, ...DESSERTS], opts({ nombre: 2 }));
  assert.equal(r.type, 'dessert');
  assert.equal(r.ids.length, 2);
  assert.ok(r.ids.every((id) => DESSERTS.some((d) => d.id === id)));
  assert.deepEqual(r.choisis.map((c) => c.groupe), ['aime', 'decouvrir']);
  const cible = { ...CIBLE, plats: { mousse: dans(1) } };
  assert.equal(proposerDesserts(DESSERTS, opts({ cible, nombre: 4 })).ids.includes('mousse'), false);
  // Déterministe ; la graine par défaut n'est pas celle des plats.
  assert.deepEqual(proposerDesserts([...DESSERTS].reverse(), opts({ nombre: 2 })), r);
  const avecGraineDesPlats = proposerDesserts(DESSERTS, opts({ nombre: 4, graine: graineProposition(CIBLE) }));
  const parDefaut = proposerDesserts(DESSERTS, opts({ nombre: 4 }));
  assert.equal(avecGraineDesPlats.ids.length, parDefaut.ids.length);
});

test('proposerDesserts : la limite du palier 3 est partagée avec les plats de la cible ; moins que choisi', () => {
  const tous = [plat('b', 'Bœuf', [BOEUF]), dessert('cake-miel', 'Cake au miel', { ingredients: [MIEL_ING] }), dessert('flan', 'Flan')];
  const cible = { ...CIBLE, plats: { b: dans(1) } };
  const r = proposerDesserts(tous, opts({ cible, nombre: 2 }));
  assert.deepEqual([r.ids, r.code, r.manque], [['flan'], 'peu', 1]);
  const libre = proposerDesserts(tous, opts({ nombre: 2 }));
  assert.deepEqual(libre.ids, ['cake-miel', 'flan'], 'ordre des emplacements');
  assert.equal(nombreProposable(tous, opts({ cible, type: 'dessert' })), 1);
  assert.equal(nombreProposable(tous, opts({ type: 'dessert' })), 2);
});

test('nombreDeDessertsParDefaut : 1 sans historique ; la dernière semaine qui en avait ; bornes 1–4 et disponible', () => {
  const tous = [...RICHE, ...DESSERTS];
  const D = (semaines, tousLesPlats = tous) => nombreDeDessertsParDefaut(semaines, CIBLE, { tousLesPlats, profils: PROFILS, evaluer });
  assert.equal(D([]), 1);
  const avecDeux = histo('2026-09-28', '2026-09-28', '2026-10-04', ['mousse', 'tarte', 'aime-1']);
  const sansDessert = histo('2026-10-05', '2026-10-05', '2026-10-11', ['aime-1']);
  assert.equal(D([avecDeux, sansDessert]), 2, 'la plus récente qui en avait');
  const cinq = histo('2026-10-05', '2026-10-05', '2026-10-11', DESSERTS.map((d) => d.id));
  assert.equal(D([cinq]), DESSERTS_MAX - 0, 'au plus 4');
  assert.equal(D([cinq], [DESSERTS[0], DESSERTS[1]]), 2, 'au plus le disponible');
  assert.equal(D([cinq], []), 1, 'rien de proposable : 1');
});

// ——— Aperçu (carte et feuille) ———

test('apercuProposition : nombre de plats du bouton, cause sans bouton, desserts proposables', () => {
  const a = apercuProposition([...RICHE, ...DESSERTS], opts());
  assert.deepEqual(a, { plats: 4, voulu: 4, presents: 0, aProposer: 4, disponibles: 8, cause: null, profilCause: null, desserts: 4 });
  const pauvre = apercuProposition([plat('ok', 'Ok'), plat('b', 'B', [BOEUF]), plat('c', 'C', [POULET])], opts());
  assert.deepEqual([pauvre.plats, pauvre.disponibles], [2, 2], 'palier 3 limité à 1');
  const unSeul = apercuProposition([plat('b', 'B', [BOEUF]), plat('c', 'C', [POULET])], opts());
  assert.deepEqual([unSeul.plats, unSeul.cause, unSeul.profilCause, unSeul.desserts], [0, 'versions', 'profil-b', 0]);
  assert.equal(apercuProposition([], opts()).cause, 'catalogue');
  assert.equal(PROPOSITION_MIN, 2);
});

// ——— Textes ———

const TXT = { moi: A, profils: PROFILS };

test('libellés : « Proposer 4 plats », « Proposer 2 plats », desserts, sous-titre, « Une autre idée »', () => {
  assert.deepEqual(libelleProposer({ plats: 4 }), { emoji: '✨', libelle: 'Proposer 4\u00A0plats' });
  assert.deepEqual(libelleProposer({ plats: 2 }), { emoji: '✨', libelle: 'Proposer 2\u00A0plats' });
  assert.deepEqual(libelleProposerDesserts(2), { emoji: '🍰', libelle: 'Proposer 2\u00A0desserts' });
  assert.deepEqual(libelleProposerDesserts(1), { emoji: '🍰', libelle: 'Proposer un dessert' });
  assert.equal(TEXTES_PROPOSER.desserts.libelle, 'Proposer des desserts');
  assert.equal(TEXTES_PROPOSER.desserts.titre, 'Combien de desserts\u00A0?');
  assert.equal(TEXTES_PROPOSER.desserts.aide, 'Ils s’ajoutent aux plats de la semaine.');
  assert.equal(sousTitreDesserts(CIBLE, '2026-10-12'), 'Pour cette semaine.');
  assert.equal(sousTitreDesserts({ id: 'x', debut: '2026-10-17', fin: '2026-10-23' }, '2026-10-15'), 'Pour la semaine du 17 au 23 octobre.');
  assert.equal(nomAutreIdee('Gratin de pâtes'), 'Remplacer «\u00A0Gratin de pâtes\u00A0» par une autre idée');
  assert.equal(texteAutreIdee({ nouveau: 'Curry de lentilles', ancien: 'Gratin de pâtes' }),
    '«\u00A0Curry de lentilles\u00A0» à la place de «\u00A0Gratin de pâtes\u00A0».');
  assert.equal(texteAutreIdee({ nouveau: 'Curry de lentilles', ancien: 'Gratin de pâtes', reglages: true }),
    '«\u00A0Curry de lentilles\u00A0» à la place de «\u00A0Gratin de pâtes\u00A0». Invités et repas sont à régler de nouveau.');
  assert.equal(TEXTES_PROPOSER.autreIdee.aucune, 'Plus d’autre idée pour l’instant.');
  assert.equal(TEXTES_PROPOSER.erreurs.chevauche, 'Les dates de la semaine ont changé\u00A0: touchez de nouveau «\u00A0Proposer\u00A0».');
});

test('texteRaison : vous, vous et un autre, trois profils, un autre, deux autres, sans moi, à découvrir, depuis longtemps', () => {
  const aime = (...profils) => ({ code: 'aime', profils });
  const P = '✨ Proposé\u00A0: ';
  assert.equal(texteRaison(aime('profil-a'), TXT), `${P}vous l’aimez.`);
  assert.equal(texteRaison(aime('profil-b', 'profil-a'), TXT), `${P}vous et Adulte B l’aimez.`);
  assert.equal(texteRaison(aime('enfant', 'profil-b', 'profil-a'), TXT), `${P}vous, Adulte B et Enfant l’aimez.`);
  assert.equal(texteRaison(aime('profil-b'), TXT), `${P}Adulte B l’aime.`);
  assert.equal(texteRaison(aime('profil-a', 'enfant'), { moi: B, profils: PROFILS }), `${P}Adulte A et Enfant l’aiment.`);
  assert.equal(texteRaison(aime('profil-a'), { moi: null, profils: PROFILS }), `${P}Adulte A l’aime.`);
  assert.equal(texteRaison(aime('profil-z'), TXT), null, 'profil retiré');
  assert.equal(texteRaison({ code: 'decouvrir' }, TXT), `${P}à découvrir.`);
  assert.equal(texteRaison({ code: 'ancien' }, TXT), `${P}pas au menu depuis longtemps.`);
  assert.equal(texteRaison({ code: 'recent' }, TXT), null);
  assert.equal(texteRaison({ code: 'autre' }, TXT), null);
});

let rangChoisi = 0;
const choisi = (groupe, palier = 1, ecartes = [], aimePar = ['profil-a']) => ({
  platId: `p-${(rangChoisi += 1)}`, groupe, palier, ecartes, raison: groupe === 'aime' ? { code: 'aime', profils: aimePar } : { code: groupe },
});
const resultat = (choisis, extra = {}) => ({ type: 'plat', ids: choisis.map((c) => c.platId), choisis, code: 'ok', cause: null, profilCause: null, ...extra });

test('annonceProposition : phrase 1 (nombre, composition, sans moi, singulier)', () => {
  const quatre = resultat([choisi('aime'), choisi('aime'), choisi('decouvrir'), choisi('decouvrir')]);
  // Jamais « pour cette semaine » (retour du propriétaire, 2026-10-13 : annonce plus courte).
  assert.equal(annonceProposition(quatre, TXT), '4\u00A0plats proposés\u00A0: 2\u00A0que vous aimez, 2\u00A0à découvrir.');
  assert.equal(annonceProposition(quatre, { profils: PROFILS }), '4\u00A0plats proposés\u00A0: 2\u00A0aimés à la maison, 2\u00A0à découvrir.');
  assert.equal(annonceProposition(resultat([choisi('aime')]), TXT), 'Un plat proposé.');
  assert.equal(annonceProposition(resultat([choisi('aime'), choisi('autre')]), TXT), '2\u00A0plats proposés.', 'un seul groupe montré');
  assert.equal(annonceProposition(resultat([choisi('aime'), choisi('decouvrir'), choisi('decouvrir')]), { profils: PROFILS }),
    '3\u00A0plats proposés\u00A0: 1\u00A0aimé à la maison, 2\u00A0à découvrir.');
  // Un plat que seul un autre membre aime n'est jamais « que vous aimez ».
  const melange = resultat([choisi('aime', 1, [], ['profil-b']), choisi('aime', 1, [], ['profil-a', 'profil-b']), choisi('decouvrir'), choisi('decouvrir')]);
  assert.equal(annonceProposition(melange, TXT), '4\u00A0plats proposés\u00A0: 1\u00A0que vous aimez, 1\u00A0aimé à la maison, 2\u00A0à découvrir.');
  const autres = resultat([choisi('aime', 1, [], ['profil-b']), choisi('aime', 1, [], ['enfant']), choisi('decouvrir')]);
  assert.equal(annonceProposition(autres, TXT), '3\u00A0plats proposés\u00A0: 2\u00A0aimés à la maison, 1\u00A0à découvrir.');
  assert.equal(annonceProposition(resultat([choisi('decouvrir'), choisi('decouvrir')])), '2\u00A0plats proposés.');
});

test('annonceProposition : ni dates ni restes, quel que soit le chemin (Semaine montre ensuite la semaine proposée)', () => {
  // Relecture du 2026-10-13 : depuis « Préparer la semaine du 17 au 23 octobre », l'annonce disait encore les dates et
  // les restes (186 caractères, 10 lignes en police agrandie, posées sur le premier plat proposé) ; ses dates sont le
  // titre de Semaine juste au-dessus du bandeau et étaient sur le bouton touché, ses restes, la feuille venait de les
  // dire. Les anciennes options (`cible`, `aujourdhui`, `restes`) ne changent plus rien.
  const deux = resultat([choisi('aime'), choisi('decouvrir')]);
  const attendu = '2\u00A0plats proposés\u00A0: 1\u00A0que vous aimez, 1\u00A0à découvrir.';
  for (const options of [
    { ...TXT, cible: CIBLE, aujourdhui: '2026-10-12' },
    { ...TXT, cible: SUIVANTE, aujourdhui: '2026-10-17' },
    { ...TXT, cible: SUIVANTE, aujourdhui: '2026-10-17', restes: 4 },
    { ...TXT, restes: [{ id: 'r' }] },
  ]) assert.equal(annonceProposition(deux, options), attendu, JSON.stringify(options));
  const dessert = { ...resultat([choisi('aime')]), type: 'dessert' };
  assert.equal(annonceProposition(dessert, { ...TXT, cible: SUIVANTE, aujourdhui: '2026-10-17', restes: 2 }), 'Un dessert proposé.');
});

test('annonceProposition : aucune phrase d’aide par défaut (plats et desserts)', () => {
  const dessertR = (choisis) => ({ ...resultat(choisis), type: 'dessert' });
  for (const r of [
    resultat([choisi('aime'), choisi('decouvrir')]),
    resultat([choisi('aime')]),
    dessertR([choisi('aime'), choisi('decouvrir')]),
    dessertR([choisi('decouvrir')]),
  ]) {
    const texte = annonceProposition(r, TXT);
    assert.doesNotMatch(texte, /Touchez/, texte);
    assert.equal(texte.split('. ').length, 1, `une seule phrase : ${texte}`);
    assert.ok(texte.endsWith('.'), texte);
  }
  assert.equal(TEXTES_PROPOSER.toucherPlat, undefined, 'texte devenu inutile, retiré');
  assert.equal(TEXTES_PROPOSER.toucherDessert, undefined, 'texte devenu inutile, retiré');
});

test('annonceProposition : phrase 2 (cause, palier 3 vu par l’écarté, par un autre, Enfant, « Jamais » de l’enfant)', () => {
  const base = TXT;
  const deux = [choisi('aime'), choisi('decouvrir')];
  const fin = (r, o = base) => annonceProposition(r, o).split('. ').slice(1).join('. ');
  assert.equal(fin(resultat(deux, { code: 'peu', cause: 'versions', profilCause: 'profil-b' })), 'Les autres plats n’ont pas encore de version pour Adulte B.');
  assert.equal(fin(resultat(deux, { code: 'peu', cause: 'versions', profilCause: 'profil-b' }), { ...base, moi: B }), 'Les autres plats n’ont pas encore de version pour vous.');
  assert.equal(fin(resultat(deux, { code: 'peu', cause: 'age', profilCause: 'enfant' })), 'Les autres plats ne sont pas encore pour Enfant.');
  assert.equal(fin(resultat(deux, { code: 'peu', cause: 'recettes' })), 'Les autres plats n’ont pas encore leur recette.');
  assert.equal(fin(resultat(deux, { code: 'peu', cause: 'recents' })), 'Les autres plats ont été mangés ces deux dernières semaines.');
  assert.equal(fin(resultat(deux, { code: 'peu', cause: 'catalogue' })), 'Ajoutez des plats pour avoir plus d’idées.');
  const ecarteB = [choisi('aime'), choisi('autre', 3, [{ profilId: 'profil-b', raison: 'version' }])];
  assert.equal(fin(resultat(ecarteB)), 'Un plat n’a pas encore de version pour Adulte B\u00A0: c’est écrit sur sa carte.');
  assert.equal(fin(resultat(ecarteB), { ...base, moi: B }), 'Un plat n’a pas encore de version pour vous\u00A0: c’est écrit sur sa carte.');
  const ecarteE = [choisi('aime'), choisi('autre', 3, [{ profilId: 'enfant', raison: 'age' }])];
  assert.equal(fin(resultat(ecarteE)), 'Un plat n’est pas encore pour Enfant\u00A0: c’est écrit sur sa carte.');
  const jamaisE = [choisi('aime'), choisi('autre', 3, [{ profilId: 'enfant', raison: 'jamaisEnfant' }])];
  assert.equal(fin(resultat(jamaisE)), 'Enfant a dit «\u00A0Jamais\u00A0» à un plat\u00A0: c’est écrit sur sa carte.');
  // La cause passe avant le palier 3 ; sans l'une ni l'autre, une seule phrase.
  assert.equal(fin(resultat(ecarteB, { code: 'peu', cause: 'recettes' })), 'Les autres plats n’ont pas encore leur recette.');
  assert.equal(fin(resultat(deux)), '');
  // Textes entiers : la seconde phrase suit la première.
  assert.equal(annonceProposition(resultat(deux, { code: 'peu', cause: 'versions', profilCause: 'profil-b' }), base),
    '2\u00A0plats proposés\u00A0: 1\u00A0que vous aimez, 1\u00A0à découvrir. Les autres plats n’ont pas encore de version pour Adulte B.');
  assert.equal(annonceProposition(resultat(ecarteE), base),
    '2\u00A0plats proposés. Un plat n’est pas encore pour Enfant\u00A0: c’est écrit sur sa carte.', 'un seul groupe montré');
});

test('annonceProposition des desserts : pluriel, singulier, moins que choisi, palier 3', () => {
  const dessertR = (choisis, extra = {}) => ({ ...resultat(choisis, extra), type: 'dessert' });
  assert.equal(annonceProposition(dessertR([choisi('aime'), choisi('decouvrir')]), TXT), '2\u00A0desserts proposés\u00A0: 1\u00A0que vous aimez, 1\u00A0à découvrir.');
  assert.equal(annonceProposition(dessertR([choisi('aime')]), TXT), 'Un dessert proposé.');
  assert.equal(annonceProposition(dessertR([choisi('aime')], { code: 'peu', cause: 'versions', profilCause: 'profil-b' }), TXT),
    'Un dessert proposé. Il n’y avait pas d’autre dessert à proposer.');
  assert.equal(annonceProposition(dessertR([choisi('autre', 3, [{ profilId: 'profil-a', raison: 'version' }])]), TXT),
    'Un dessert proposé. Un dessert n’a pas encore de version pour vous\u00A0: c’est écrit sur sa carte.');
  // Dessert manquant avant le palier 3.
  assert.equal(annonceProposition(dessertR([choisi('autre', 3, [{ profilId: 'profil-a', raison: 'version' }])], { code: 'peu', cause: 'catalogue' }), TXT),
    'Un dessert proposé. Il n’y avait pas d’autre dessert à proposer.');
});

test('texteSansProposition : recettes, versions (vous ou prénom), récents ; null pour catalogue, « Jamais » et âge', () => {
  assert.equal(texteSansProposition('recettes', TXT), 'L’app proposera des plats quand ils auront leur recette.');
  assert.equal(texteSansProposition('versions', { ...TXT, profilCause: 'profil-b' }), 'L’app proposera des plats quand ils auront une version pour Adulte B.');
  assert.equal(texteSansProposition('versions', { moi: B, profils: PROFILS, profilCause: 'profil-b' }), 'L’app proposera des plats quand ils auront une version pour vous.');
  assert.equal(texteSansProposition('recents', TXT), 'Vos plats ont tous été mangés ces deux dernières semaines\u00A0: choisissez-les vous-même.');
  for (const cause of ['catalogue', 'jamais', 'age', null]) assert.equal(texteSansProposition(cause, TXT), null);
});

// ——— Écritures groupées (semaine.js) ———

const BASE = { semainesChargees: true, aujourdhui: '2026-10-12', auteur: 'a@exemple.fr', maintenant: 1000 };
const CHEMINS_PERMIS = /^plats\.[a-z0-9-]+\.(ajouteLe|retire)$/;

test('ecrituresAjoutGroupe : une création, ajouteLe croissants, seuls les chemins d’une case cochée', () => {
  const r = ecrituresAjoutGroupe([], ['aime-1', 'neuf-1', 'aime-2'], { ...BASE, cible: CIBLE, tousLesPlats: RICHE });
  assert.deepEqual(r.creation, { id: CIBLE.id, donnees: { debut: CIBLE.debut, fin: CIBLE.fin, creePar: 'a@exemple.fr', creeLe: 1000 } });
  assert.deepEqual(r.ajoutes, [{ platId: 'aime-1', ajouteLe: 1000 }, { platId: 'neuf-1', ajouteLe: 1001 }, { platId: 'aime-2', ajouteLe: 1002 }]);
  assert.deepEqual(r.deja, []);
  assert.ok(Object.keys(r.champs).every((c) => CHEMINS_PERMIS.test(c)));
  assert.equal(r.champs['plats.neuf-1.retire'], EFFACER);
  assert.ok(champsValides(r.champs));
  assert.equal(r.articles, undefined);
});

test('ecrituresAjoutGroupe : restes une fois, seulement si la cible n’avait aucun plat ; reprise d’une semaine vidée', () => {
  const restes = [{ produitId: 'beurre', libelle: 'Beurre', precision: '30 g' }];
  const r = ecrituresAjoutGroupe([], ['aime-1', 'aime-2'], { ...BASE, cible: SUIVANTE, restes, tousLesPlats: RICHE });
  assert.deepEqual(r.articles.map((a) => a.id), ['reste--2026-10-19--beurre']);
  const avecPlat = semaine(SUIVANTE.id, SUIVANTE.debut, SUIVANTE.fin, { 'neuf-1': dans(5) });
  const r2 = ecrituresAjoutGroupe([avecPlat], ['aime-1'], { ...BASE, cible: SUIVANTE, restes, tousLesPlats: RICHE });
  assert.equal(r2.articles, undefined);
  assert.equal(r2.creation, undefined);
  const videe = semaine(SUIVANTE.id, '2026-10-18', '2026-10-24', { 'neuf-1': dans(5, { retire: true }) });
  const r3 = ecrituresAjoutGroupe([videe], ['aime-1', 'aime-2'], { ...BASE, cible: SUIVANTE, restes, tousLesPlats: RICHE });
  assert.deepEqual(r3.creation.donnees.debut, SUIVANTE.debut, 'reprise à ses nouvelles dates, une seule fois');
  assert.equal(r3.articles.length, 1);
});

test('ecrituresAjoutGroupe : déjà là sauté, plat devenu invalide sauté, chevauche sans rien, vide, chargement', () => {
  const existante = semaine(CIBLE.id, CIBLE.debut, CIBLE.fin, { 'aime-1': dans(5) });
  const jete = { ...plat('jete', 'Jeté'), corbeille: { le: 1, par: 'x' } };
  const r = ecrituresAjoutGroupe([existante], ['aime-1', 'jete', 'inconnu', 'aime-2'], { ...BASE, cible: CIBLE, tousLesPlats: [...RICHE, jete] });
  assert.deepEqual(r.deja, ['aime-1']);
  assert.deepEqual(r.ajoutes.map((a) => a.platId), ['aime-2']);
  const autre = semaine('2026-10-15', '2026-10-15', '2026-10-21', { 'neuf-1': dans(1) });
  assert.deepEqual(ecrituresAjoutGroupe([autre], ['aime-1', 'aime-2'], { ...BASE, cible: CIBLE, tousLesPlats: RICHE }), { code: 'chevauche' });
  assert.deepEqual(ecrituresAjoutGroupe([existante], ['aime-1'], { ...BASE, cible: CIBLE, tousLesPlats: RICHE }), { code: 'vide', deja: ['aime-1'] });
  assert.deepEqual(ecrituresAjoutGroupe([], ['aime-1'], { ...BASE, semainesChargees: false, cible: CIBLE }), { code: 'chargement' });
  assert.deepEqual(ecrituresAjoutGroupe([], ['aime-1'], { ...BASE, maintenant: null, cible: CIBLE }), { code: 'invalide' });
  assert.deepEqual(ecrituresAjoutGroupe([], ['aime-1'], { ...BASE, cible: { id: 'X!', debut: 'a', fin: 'b' } }), { code: 'invalide' });
  // Sans tousLesPlats : aucun contrôle du plat (comme ecrituresAjout sans `plat`).
  assert.equal(ecrituresAjoutGroupe([], ['a', 'b'], { ...BASE, cible: CIBLE }).ajoutes.length, 2);
});

test('ecrituresRetraitGroupe : ne retire que ses ajouteLe ; semaine qui commence plus tard vidée → supprimer ; inutile', () => {
  const s = semaine(SUIVANTE.id, SUIVANTE.debut, SUIVANTE.fin, { a: dans(1000), b: dans(1001), c: dans(5) });
  const ajoutes = [{ platId: 'a', ajouteLe: 1000 }, { platId: 'b', ajouteLe: 999 }];
  const r = ecrituresRetraitGroupe(s, ajoutes, { aujourdhui: '2026-10-17' });
  assert.deepEqual(r, { id: SUIVANTE.id, champs: { 'plats.a.retire': true }, vide: false });
  const seule = semaine(SUIVANTE.id, SUIVANTE.debut, SUIVANTE.fin, { a: dans(1000), b: dans(1001) });
  const articles = [{ id: 'reste--2026-10-19--beurre', libelle: 'Beurre' }, { id: 'reste--2026-10-19--sel', libelle: 'Sel', coche: { le: 1 } }];
  const r2 = ecrituresRetraitGroupe(seule, [{ platId: 'a', ajouteLe: 1000 }, { platId: 'b', ajouteLe: 1001 }], { articles, aujourdhui: '2026-10-17' });
  assert.deepEqual(r2.supprimer, ['reste--2026-10-19--beurre']);
  assert.equal(r2.vide, true);
  assert.equal(aDesPlats(appliquerChamps(seule, r2.champs)), false);
  assert.deepEqual(ecrituresRetraitGroupe(seule, [{ platId: 'a', ajouteLe: 1 }], {}), { code: 'inutile' });
  assert.deepEqual(ecrituresRetraitGroupe(null, [], {}), { code: 'invalide' });
});

test('ecrituresRemplacement : même ajouteLe, jamais de semaine vide, inverse, courses faites refusé', () => {
  const s = semaine(CIBLE.id, CIBLE.debut, CIBLE.fin, { a: dans(1000, { repas: 3 }), c: dans(1001) });
  const r = ecrituresRemplacement(s, 'a', 'b');
  assert.deepEqual(r, { id: CIBLE.id, champs: { 'plats.b.ajouteLe': 1000, 'plats.b.retire': EFFACER, 'plats.a.retire': true } });
  const apres = appliquerChamps(s, r.champs);
  assert.ok(aDesPlats(apres));
  const inverse = ecrituresRemplacement(apres, 'a', 'b', { inverse: true });
  assert.deepEqual(inverse, { id: CIBLE.id, champs: { 'plats.a.retire': EFFACER, 'plats.b.retire': true } });
  const remis = appliquerChamps(apres, inverse.champs);
  assert.deepEqual(remis.plats.a, { ajouteLe: 1000, repas: 3 }, 'l’ancien revient avec ses réglages');
  assert.deepEqual(ecrituresRemplacement(remis, 'a', 'b', { inverse: true }), { code: 'inutile' });
  assert.deepEqual(ecrituresRemplacement(s, 'a', 'c'), { code: 'inutile' }, 'le nouveau y est déjà');
  assert.deepEqual(ecrituresRemplacement({ ...s, statut: 'courses_faites' }, 'a', 'b'), { code: 'faites' });
  assert.deepEqual(ecrituresRemplacement(s, 'a', 'a'), { code: 'invalide' });
  assert.deepEqual(ecrituresRemplacement(s, 'a', 'B!'), { code: 'invalide' });
  // Courses faites : pas de 🔄 sur la feuille du plat.
  assert.equal(peutChangerDIdee(s, AIMES[0]), true);
  assert.equal(peutChangerDIdee({ ...s, statut: 'courses_faites' }, AIMES[0]), false);
  assert.equal(peutChangerDIdee(s, { id: 'attente', nom: 'Attente' }), false);
});

test('ecrituresRemplacement : un plat retiré plus tôt revient sans ses anciens réglages, l’ancien garde les siens', () => {
  const retire = { ajouteLe: 5, retire: true, repas: 3, invites: { adultes: 2 }, mange: { 'profil-b': false }, styles: { 'profil-b': 'vegetal' } };
  const s = semaine(CIBLE.id, CIBLE.debut, CIBLE.fin, { curry: dans(1000, { repas: 2 }), gratin: retire });
  const r = ecrituresRemplacement(s, 'curry', 'gratin');
  assert.deepEqual(r.champs, {
    'plats.gratin.repas': EFFACER,
    'plats.gratin.mange.profil-b': EFFACER,
    'plats.gratin.invites.adultes': EFFACER,
    'plats.gratin.styles.profil-b': EFFACER,
    'plats.gratin.ajouteLe': 1000,
    'plats.gratin.retire': EFFACER,
    'plats.curry.retire': true,
  });
  assert.ok(champsValides(r.champs));
  const apres = appliquerChamps(s, r.champs);
  assert.equal(aDesReglagesEcrits(apres.plats.gratin), false, 'le nouveau repart des réglages de départ');
  assert.equal(apres.plats.curry.repas, 2, 'l’ancien garde ses réglages');
  const remis = appliquerChamps(apres, ecrituresRemplacement(apres, 'curry', 'gratin', { inverse: true }).champs);
  assert.deepEqual(remis.plats.curry, { ajouteLe: 1000, repas: 2 });
  assert.equal(remis.plats.gratin.retire, true);
});

test('proposerPlats avec `plafond` (chemin du bouton) : le libellé déjà réduit garde le code « peu » et sa cause ; jamais plus que le libellé', () => {
  // 2 plats ont leur recette, 5 n'en ont pas : le bouton dit « Proposer 2 plats » (4 voulus).
  const attente = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id, nom: `Attente ${id}` }));
  const maigre = geler([AIMES[0], DECOUVRIR[0], ...attente]);
  const apercu = apercuProposition(maigre, opts());
  assert.equal(apercu.plats, 2);
  assert.equal(apercu.aProposer, 4);
  const r = proposerPlats(maigre, opts({ nombre: apercu.aProposer, plafond: Math.min(apercu.plats, apercu.aProposer) }));
  assert.equal(r.ids.length, 2);
  assert.equal(r.code, 'peu');
  assert.equal(r.cause, 'recettes');
  assert.match(annonceProposition(r, { ...TXT, cible: CIBLE, aujourdhui: '2026-10-12' }), /Les autres plats n’ont pas encore leur recette\.$/);
  // Des plats arrivés depuis l'affichage : jamais plus que le libellé, proposition complète pour ce nombre.
  const plafonne = proposerPlats(RICHE, opts({ nombre: 4, plafond: 2 }));
  assert.equal(plafonne.ids.length, 2);
  assert.equal(plafonne.code, 'ok');
  assert.deepEqual(plafonne.choisis.map((c) => c.groupe), ['aime', 'decouvrir']);
  // Sans plafond, comme avant.
  assert.equal(proposerPlats(RICHE, opts({ nombre: 4 })).ids.length, 4);
});

test('annonce de « Proposer » (✨ et 🍰) : 10 s, une seule durée voulue ; les autres annonces gardent 8 s et 3,5 s', async () => {
  // Retour du propriétaire (2026-10-13) : 30 s, c'était trop long. La durée vit dans js/app.js (écran), lue ici.
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /^const DUREE_ANNONCE_PROPOSITION_MS = 10000;$/m);
  // Seuls les appels d'`annoncer` comptent (une autre `duree:` d'app.js, minuteur d'une étape par exemple, n'est pas une
  // annonce) : un seul choisit sa durée, celui de la proposition.
  const annonces = app.match(/\bannoncer\([^;]*?\bduree:/gs) ?? [];
  assert.equal(annonces.length, 1, `seule l'annonce de la proposition choisit sa durée : ${annonces.join(' | ')}`);
  assert.match(app, /annoncer\(texte, \{\s*action: \{ libelle: 'Annuler'[^;]*?duree: DUREE_ANNONCE_PROPOSITION_MS,/s);
  assert.match(app, /duree: DUREE_ANNONCE_PROPOSITION_MS,/);
  const dom = await readFile(new URL('../js/ui/dom.js', import.meta.url), 'utf8');
  assert.match(dom, /^const DUREE_ANNONCE_MS = 3500;$/m);
  assert.match(dom, /^const DUREE_ANNONCE_ACTION_MS = 8000;$/m);
});

// ——— Carte « prochaine action » ———

const carte = (proposition, sansProposition = null) => carteProchaineAction(null, {
  semainesChargees: true, semaines: [], aujourdhui: '2026-10-12', plats: [], liste: null, groupes: null, proposition, sansProposition,
});

test('carteProchaineAction : « ✨ Proposer 4 plats » principal et « ＋ Choisir les plats » secondaire ; sans proposition inchangée avec sa ligne', () => {
  const avec = carte({ plats: 4 });
  assert.equal(avec.cas, 'choisir');
  assert.equal(avec.texte, 'Laissez l’app proposer, ou choisissez vous-même\u00A0: la liste de courses se fait toute seule.');
  assert.deepEqual(avec.boutons, [
    { action: 'proposer', emoji: '✨', libelle: 'Proposer 4\u00A0plats', principal: true, nombre: 4 },
    { action: 'choisir', emoji: '＋', libelle: 'Choisir les plats', principal: false },
  ]);
  assert.equal(carte({ plats: 2 }).boutons[0].libelle, 'Proposer 2\u00A0plats');
  const sans = carte({ plats: 1 }, 'L’app proposera des plats quand ils auront leur recette.');
  assert.equal(sans.texte, 'Choisissez quelques plats\u00A0: la liste de courses se fait toute seule.');
  assert.equal(sans.ligne, 'L’app proposera des plats quand ils auront leur recette.');
  assert.deepEqual(sans.boutons, [{ action: 'choisir', emoji: '＋', libelle: 'Choisir les plats', principal: true }]);
  assert.equal(carte(null).ligne, null);
});

test('carteProchaineAction : semaine aux entrées toutes dans la corbeille → cas « choisir », avec proposition', () => {
  const jete = { ...plat('jete', 'Jeté'), corbeille: { le: 1, par: 'x' } };
  const s = semaine(CIBLE.id, CIBLE.debut, CIBLE.fin, { jete: dans(1) });
  const c = carteProchaineAction(s, {
    semainesChargees: true, semaines: [s], aujourdhui: '2026-10-12',
    plats: [{ platId: 'jete', plat: jete, etat: 'corbeille', mangeurs: [] }], proposition: { plats: 3 },
  });
  assert.equal(c.cas, 'choisir');
  assert.equal(c.boutons[0].action, 'proposer');
  // La cible garde l'entrée active de la corbeille : jamais reproposée, et elle compte 0 présent.
  assert.equal(nombreAProposer([s], CIBLE, { tousLesPlats: [...RICHE, jete], profils: PROFILS, evaluer }).presents, 0);
});

// ——— Légumes (2026-10-13 : « au moins un, même si c'est une purée ») ———

const leg = (produit, qte, unite, role = 'incorpore') => ({ produit, qte, unite, rayon: 'fruits_legumes', marqueurs: ['legume'], role });
const SAUCISSE = ing('saucisse de Toulouse', ['viande', 'porc'], { forme: 'morceaux' });
const PATES = ing('pâtes', ['feculent']);

test('aDesLegumes (a) : un légume principal ; jamais un aromatique, la pomme de terre ni un féculent', () => {
  assert.deepEqual([LEGUMES_MIN, PORTION_LEGUMES_G, LEGUME_VISIBLE_G, GRAMMES_PAR_BOITE], [1, 80, 40, 400]);
  assert.deepEqual([...LEGUMES_AROMATIQUES], ['oignon', 'echalote', 'ail', 'cive', 'ciboule']);
  // Ratatouille : une courgette principale (50 g par portion) suffit.
  assert.equal(aDesLegumes(plat('ratatouille', 'Ratatouille', [leg('courgette', 1, 'pc', 'principal')])), true);
  assert.equal(aDesLegumes(plat('poelee', 'Poêlée', [leg('petits pois', 160, 'g', 'Principal')])), true, 'rôle toléré, petits pois, 40 g par portion');
  for (const produit of ['oignon rouge', 'ail des ours', 'échalotes', 'cives', 'ciboule', 'gousses d’ail', 'petits oignons']) {
    assert.equal(aDesLegumes(plat('x', 'Plat', [leg(produit, 2, 'kg', 'principal')])), false, produit);
  }
  // « aile de poulet » n'est pas de l'ail (premier mot « aile ») : repère `legume` posé exprès pour le vérifier.
  assert.equal(aDesLegumes(plat('x', 'Plat', [leg('aile de poulet', 1, 'pc', 'principal')])), true);
  // La pomme de terre est un féculent, même marquée `legume`, même en purée.
  assert.equal(aDesLegumes(plat('puree', 'Purée de pommes de terre', [leg('pommes de terre', 1, 'kg', 'principal')])), false);
  assert.equal(aDesLegumes(plat('puree', 'Purée de pommes de terre', [ing('pomme de terre', ['feculent'], { qte: 1, unite: 'kg' })])), false);
  // Patate douce (relecture) : un féculent, qu'elle vienne des produits courants (`feculent`) ou d'une recette de Claude
  // qui la marque `legume` principal (exemple des instructions) ; « patate » seule aussi.
  assert.equal(aDesLegumes(plat('pd', 'Gratin de patates douces', [ing('patate douce', ['feculent'], { qte: 600 })])), false);
  assert.equal(aDesLegumes(plat('pd', 'Poulet au miso', [leg('patate douce', 600, 'g', 'principal')])), false);
  assert.equal(aDesLegumes(plat('pd', 'Purée de patates douces', [leg('patates douces', 2, 'pc', 'principal')], { portionsBase: 2 })), false);
  assert.equal(aDesLegumes(plat('pd', 'Curry de patate douce', [leg('patate douce', 1, 'kg', 'principal')])), false);
  assert.equal(aDesLegumes(plat('pt', 'Patates sautées', [leg('patates', 1, 'kg', 'principal')])), false);
  assert.equal(Object.hasOwn(POIDS_PIECE_LEGUMES, 'patate-douce'), false);
  assert.equal(aDesLegumes(plat('x', 'Plat', [{ ...leg('courgette', 1, 'pc', 'principal'), marqueurs: ['legume', 'feculent'] }])), false);
});

test('aDesLegumes (a) et (b) : une garniture ne suffit pas, 40 g par portion quand la quantité se lit', () => {
  const steak = ing('steak haché', ['viande', 'boeuf'], { forme: 'hachee', qte: 500 });
  // Burger, tacos : rondelle de tomate (120 g ÷ 4 = 30 g) et quart de laitue (19 g), principaux : non.
  const garniture = [leg('tomate', 1, 'pc', 'principal'), leg('laitue', 0.25, 'pc', 'principal')];
  assert.equal(aDesLegumes(plat('bu', 'Burger maison', [steak, ...garniture])), false);
  assert.equal(aDesLegumes(plat('ta', 'Tacos au bœuf', [steak, ...garniture])), false);
  // Pizza reine : 100 g de champignons pour 4 (25 g), principaux : non ; 160 g (40 g) : oui.
  const pate = ing('pâte à pizza', ['feculent'], { qte: 1, unite: 'pc' });
  assert.equal(aDesLegumes(plat('pz', 'Pizza reine', [pate, leg('champignon de Paris', 100, 'g', 'principal')])), false);
  assert.equal(aDesLegumes(plat('pz', 'Pizza reine', [pate, leg('champignon de Paris', 160, 'g', 'principal')])), true);
  // Poulet aux champignons : 100 g pour 4 (25 g), nommé : non ; risotto aux champignons, 300 g (75 g) : oui.
  assert.equal(aDesLegumes(plat('pc', 'Poulet aux champignons', [POULET, leg('champignon de Paris', 100, 'g')])), false);
  assert.equal(aDesLegumes(plat('rc', 'Risotto aux champignons', [ing('riz', ['feculent']), leg('champignon de Paris', 300, 'g')])), true);
  // Pièces de poids connu : 10 champignons (200 g, 50 g par portion), nommés : oui.
  assert.equal(aDesLegumes(plat('pc', 'Poulet aux champignons', [POULET, leg('champignons', 10, 'pc')])), true);
  // Quantité qui ne se lit pas (botte, pièce de poids inconnu, cuillères) ou portions illisibles : sans quantité.
  assert.equal(aDesLegumes(plat('gb', 'Gratin de blettes', [leg('blette', 1, 'botte')])), true);
  assert.equal(aDesLegumes(plat('pk', 'Sauté de porc', [leg('pak choï', 1, 'pc', 'principal')])), true);
  assert.equal(aDesLegumes({ id: 'bu', nom: 'Burger maison', type: 'plat', ingredients: [steak, ...garniture] }), true, 'sans portionsBase');
  // Le seuil est par légume : deux garnitures (30 g + 19 g) ne s'additionnent pas pour (a).
  assert.equal(aDesLegumes(plat('x', 'Plat du jour', [leg('tomate', 1, 'pc', 'principal'), leg('poivron', 1, 'pc', 'principal')])), false);
  // Une garniture trop légère compte quand même pour (c) : 1 tomate (30 g) et 220 g de courgettes (55 g) → 85 g.
  assert.equal(aDesLegumes(plat('x', 'Plat du jour', [leg('tomate', 1, 'pc', 'principal'), leg('courgette', 220, 'g')])), true);
});

test('aDesLegumes (b) : un mot du légume dans le nom du plat (pluriel, accents) ; ni couleur ni état', () => {
  // Purée de carottes (en pièces et en grammes) : 50 g par portion, le nom suffit.
  assert.equal(aDesLegumes(plat('p', 'Purée de carottes et saucisses', [SAUCISSE, leg('carotte', 2, 'pc')])), true);
  assert.equal(aDesLegumes(plat('p', 'Purée de carottes et saucisses', [SAUCISSE, leg('carottes', 200, 'g')])), true);
  assert.equal(aDesLegumes(plat('v', 'Velouté de potiron', [leg('potiron', 200, 'g')])), true);
  assert.equal(aDesLegumes(plat('v', 'Velouté de butternut', [leg('courge butternut', 1, 'pc')])), true);
  assert.equal(aDesLegumes(plat('c', 'Curry de courgettes', [LENTILLES, leg('courgette', 1, 'pc')])), true);
  assert.equal(aDesLegumes(plat('c', 'Curry de haricots verts', [LENTILLES, leg('haricot vert', 200, 'g')])), true);
  assert.equal(aDesLegumes(plat('d', 'Dal aux épinards', [LENTILLES, leg('épinards', 200, 'g'), { ...leg('tomates concassées', 1, 'boite'), rayon: 'epicerie_salee' }])), true);
  assert.equal(aDesLegumes(plat('t', 'Tomates farcies', [SAUCISSE, leg('tomates', 4, 'pc')])), true, 'tomates fraîches');
  // Même légume, autre nom : rien (50 g par portion).
  assert.equal(aDesLegumes(plat('c', 'Curry vert', [LENTILLES, leg('haricot vert', 200, 'g')])), false, '« vert » ne dit pas le légume');
  assert.equal(aDesLegumes(plat('c', 'Saucisses lentilles', [SAUCISSE, LENTILLES, leg('carotte', 1, 'pc')])), false);
  // Un aromatique dans le nom ne compte pas : « Soupe à l'oignon ».
  assert.equal(aDesLegumes(plat('s', 'Soupe à l’oignon', [leg('oignon jaune', 6, 'pc')])), false);
});

test('aDesLegumes (c) : 80 g de légumes par portion (g, kg, boîte, pièces) ; sans portions lisibles, non', () => {
  const quatre = (...ingredients) => plat('x', 'Plat du jour', ingredients);
  assert.equal(aDesLegumes(quatre(leg('haricot vert', 320, 'g'))), true, '80 g par portion');
  assert.equal(aDesLegumes(quatre(leg('haricot vert', 316, 'g'))), false, '79 g par portion');
  assert.equal(aDesLegumes(quatre(leg('épinard', '0,5', 'kg'))), true, 'kg et nombre en texte');
  assert.equal(aDesLegumes(quatre(leg('haricots verts', 1, 'boite'))), true, 'une boîte ≈ 400 g');
  assert.equal(aDesLegumes(quatre(leg('carotte', 2, 'pc'), leg('poireau', 1, 'pc'))), true, '200 + 150 g');
  assert.equal(aDesLegumes(quatre(leg('carotte', 3, 'pc'))), false, '75 g par portion');
  assert.equal(aDesLegumes(plat('x', 'Plat du jour', [leg('chou-fleur', 1, 'pc')], { portionsBase: 10 })), true, 'chou-fleur 800 g');
  assert.equal(aDesLegumes(plat('x', 'Plat du jour', [leg('chou rouge', 1, 'pc')], { portionsBase: 12 })), true, 'chou rouge → chou 1 kg');
  assert.equal(aDesLegumes(quatre(leg('choux de Bruxelles', 10, 'pc'))), false, '15 g la pièce, pas 1 kg');
  assert.equal(aDesLegumes(quatre(leg('tomates cerises', 12, 'pc'))), false, '15 g la pièce');
  assert.equal(aDesLegumes(quatre(leg('pak choi', 10, 'pc'))), false, 'pièce sans poids connu : ignorée');
  assert.equal(aDesLegumes(quatre(leg('haricot vert', 30, 'cs'))), false, 'autre unité ignorée');
  // Les aromatiques ne s'additionnent pas : 4 oignons et une carotte.
  assert.equal(aDesLegumes(quatre(leg('oignon jaune', 4, 'pc'), leg('carotte', 1, 'pc'))), false);
  // Bases de sauce tomate (relecture) : jamais comptées. Bolognaise au coulis, ou à la tomate concassée et une carotte
  // (25 g de carotte par portion), lasagnes, chili, dal à la boîte de tomates, gnocchis sauce tomate : non.
  const boeufHache = ing('bœuf haché', ['viande', 'boeuf'], { forme: 'hachee', qte: 500 });
  const coulis = { produit: 'coulis de tomate', qte: 50, unite: 'cl', rayon: 'epicerie_salee', marqueurs: [] };
  const conserve = (produit, qte, unite) => ({ ...leg(produit, qte, unite), rayon: 'epicerie_salee' });
  assert.equal(aDesLegumes(plat('b', 'Spaghetti bolognaise', [PATES, boeufHache, leg('oignon jaune', 1, 'pc'), coulis])), false);
  assert.equal(aDesLegumes(plat('b', 'Spaghetti bolognaise', [PATES, boeufHache, leg('oignon jaune', 1, 'pc'), leg('carotte', 1, 'pc'), conserve('tomate concassée', 2, 'boite')])), false);
  assert.equal(aDesLegumes(plat('l', 'Lasagnes à la bolognaise', [PATES, boeufHache, conserve('tomates concassées', 800, 'g')], { portionsBase: 6 })), false);
  assert.equal(aDesLegumes(plat('c', 'Chili con carne', [boeufHache, conserve('tomates pelées', 2, 'boite'), leg('poivron', 1, 'pc')], { portionsBase: 6 })), false);
  assert.equal(aDesLegumes(plat('d', 'Dal de lentilles', [LENTILLES, conserve('pulpe de tomate', 1, 'boite')])), false);
  assert.equal(aDesLegumes(plat('g', 'Gnocchis sauce tomate', [ing('gnocchi', ['feculent']), conserve('tomate concassée', 1, 'boite')])), false);
  for (const produit of ['sauce tomate', 'coulis de tomate', 'purée de tomate', 'passata', 'concentré de tomate', 'double concentré de tomate', 'tomates séchées', 'concassée de tomates', 'tomates en conserve', 'ketchup']) {
    assert.equal(aDesLegumes(plat('x', 'Tomate', [{ ...conserve(produit, 1, 'kg'), role: 'principal' }])), false, produit);
  }
  assert.ok(BASES_DE_SAUCE.includes('tomate-concassee'));
  // Les tomates fraîches, « tomate cerise » comprise, ne sont pas des bases de sauce.
  assert.equal(aDesLegumes(quatre(leg('tomates cerises', 400, 'g'))), true);
  assert.equal(aDesLegumes(quatre(leg('tomate', 3, 'pc'))), true, '360 g : 90 g par portion');
  // Carbonade aux oignons seulement : non, même un kilo d'oignons.
  assert.equal(aDesLegumes(plat('c', 'Carbonade flamande', [BOEUF, leg('oignon jaune', 1, 'kg', 'incorpore')])), false);
  // Sans portionsBase lisible : (c) ne compte pas ; (a) et (b) restent.
  const sansPortions = { id: 'x', nom: 'Plat du jour', type: 'plat', ingredients: [leg('haricot vert', 1, 'kg')] };
  assert.equal(aDesLegumes(sansPortions), false);
  assert.equal(aDesLegumes({ ...sansPortions, portionsBase: 'beaucoup' }), false);
  assert.equal(aDesLegumes({ ...sansPortions, portionsBase: 0 }), false);
  assert.equal(aDesLegumes({ ...sansPortions, nom: 'Haricots verts sautés' }), true);
  assert.equal(POIDS_PIECE_LEGUMES.carotte, 100);
});

test('aDesLegumes : la recette seule, jamais ses versions ; entrées illisibles', () => {
  const version = { pour: 'profil-b', style: 'vegetal', retirer: ['bœuf'], ajouter: [{ ...leg('carotte', 0, 'g', 'principal'), qte: undefined, qtePortion: 200 }], consigne: 'Carottes.' };
  assert.equal(aDesLegumes(plat('x', 'Bœuf mijoté', [BOEUF], { variantes: [version] })), false);
  assert.equal(aDesLegumes(null), false);
  assert.equal(aDesLegumes({ id: 'attente', nom: 'Purée de carottes' }), false, 'sans recette');
  assert.equal(aDesLegumes(plat('x', 'Plat', [null, 'carotte', { produit: '', marqueurs: ['legume'], role: 'principal' }])), false);
  const gele = geler(plat('g', 'Gratin de courgettes', [leg('courgette', 3, 'pc', 'principal')]));
  assert.equal(aDesLegumes(gele), true);
});

// Catalogue où le meilleur choix n'a aucun légume : RICHE (lentilles), plus un plat avec des légumes moins bien placé.
// Soupe : pas notée, servie il y a 15 jours (+ 0,2) : 3,2 + départage < 3,4 des plats neufs. Témoin : même identifiant,
// même nom, sans légume (même départage).
const SOUPE = plat('soupe-carottes', 'Soupe de carottes', [leg('carotte', 2, 'pc')], { derniereFois: '2026-09-21' });
const TEMOIN = plat('soupe-carottes', 'Soupe de carottes', [LENTILLES], { derniereFois: '2026-09-21' });

test('légumes : aucun plat avec des légumes → échange dans le même groupe, au dernier emplacement possible', () => {
  const temoin = proposerPlats(geler([...RICHE, TEMOIN]), opts({ nombre: 4 }));
  assert.equal(temoin.ids.includes('soupe-carottes'), false, 'sans la règle, la soupe ne viendrait pas');
  const r = proposerPlats(geler([...RICHE, SOUPE]), opts({ nombre: 4 }));
  assert.deepEqual(r.ids.slice(0, 3), temoin.ids.slice(0, 3));
  assert.equal(r.ids[3], 'soupe-carottes');
  assert.deepEqual(r.choisis.map((c) => c.groupe), ['aime', 'aime', 'decouvrir', 'decouvrir']);
  assert.deepEqual(r.choisis[3].raison, { code: 'decouvrir', legumes: true });
  assert.deepEqual([r.code, r.manque, r.ids.length], ['ok', 0, 4]);
  // Même groupe « aimé » : seul un aimé a des légumes ; il remplace le dernier aimé, les plats à découvrir restent.
  const aimeLegumes = plat('aime-legumes', 'Gratin de courgettes', [leg('courgette', 3, 'pc', 'principal')], notes(4));
  const temoinAime = proposerPlats([...RICHE, { ...aimeLegumes, ingredients: [LENTILLES] }], opts({ nombre: 4 }));
  const r2 = proposerPlats([...RICHE, aimeLegumes], opts({ nombre: 4 }));
  assert.equal(temoinAime.ids.includes('aime-legumes'), false);
  assert.deepEqual([r2.ids[0], r2.ids[2], r2.ids[3]], [temoinAime.ids[0], temoinAime.ids[2], temoinAime.ids[3]]);
  assert.equal(r2.ids[1], 'aime-legumes');
  assert.deepEqual(r2.choisis[1].raison, { code: 'aime', profils: ['profil-a'], legumes: true });
});

test('légumes : aucun groupe ne convient → le meilleur, tous groupes, remplace le dernier ; nombre 1', () => {
  // Noté 2 par Adulte B : groupe « autre » (jamais un emplacement de groupe sans la règle).
  const bof = plat('bof-legumes', 'Poêlée de légumes', [leg('poivron', 2, 'pc', 'principal')], notes(undefined, 2));
  const r = proposerPlats([...RICHE, bof], opts({ nombre: 4 }));
  assert.equal(r.ids[3], 'bof-legumes');
  assert.equal(r.choisis[3].groupe, 'autre');
  assert.deepEqual(r.choisis[3].raison, { code: 'autre', legumes: true });
  // Un seul plat demandé : l'emplacement « aimé » n'a pas d'aimé avec des légumes ; la soupe le prend.
  const un = proposerPlats([...RICHE, SOUPE], opts({ nombre: 1 }));
  assert.deepEqual(un.ids, ['soupe-carottes']);
  assert.equal(un.code, 'ok');
});

test('légumes : rien ne change quand la cible ou la proposition en a déjà, ou sans candidat avec des légumes', () => {
  // Un plat avec des légumes déjà dans la cible (case cochée) : la soupe ne vient pas ; sans légume, elle vient.
  const cuisine = plat('dans-la-cible', 'Gratin de courgettes', [leg('courgette', 3, 'pc', 'principal')]);
  const cible = { ...CIBLE, plats: { 'dans-la-cible': dans(1) } };
  assert.equal(proposerPlats([...RICHE, SOUPE, cuisine], opts({ nombre: 3, cible })).ids.includes('soupe-carottes'), false);
  const sansLegume = { ...cuisine, nom: 'Gratin', ingredients: [LENTILLES] };
  assert.equal(proposerPlats([...RICHE, SOUPE, sansLegume], opts({ nombre: 3, cible })).ids.includes('soupe-carottes'), true);
  // … mais un plat de la cible dont personne ne mange, ou à la corbeille, ne compte pas.
  const personne = { ...CIBLE, plats: { 'dans-la-cible': dans(1, { mange: { 'profil-a': false, 'profil-b': false, enfant: false } }) } };
  assert.equal(proposerPlats([...RICHE, SOUPE, cuisine], opts({ nombre: 3, cible: personne })).ids.includes('soupe-carottes'), true);
  const jete = { ...cuisine, corbeille: { le: 1, par: 'x' } };
  assert.equal(proposerPlats([...RICHE, SOUPE, jete], opts({ nombre: 3, cible })).ids.includes('soupe-carottes'), true);
  // Un aimé a des légumes : la proposition en a déjà, la soupe ne vient pas.
  const aimeLegumes = plat('aime-1', 'Aimé 1', [leg('courgette', 3, 'pc', 'principal')], notes(5, 4, 4));
  const r = proposerPlats([aimeLegumes, ...RICHE.slice(1), SOUPE], opts({ nombre: 4 }));
  assert.equal(r.ids.includes('aime-1'), true);
  assert.equal(r.ids.includes('soupe-carottes'), false);
  // Aucun candidat avec des légumes (« Jamais » d'un adulte, corbeille, dessert) : proposition inchangée.
  const exclus = [
    { ...SOUPE, notes: { 'profil-a': 0 } },
    { ...SOUPE, id: 'soupe-jetee', corbeille: { le: 1, par: 'x' } },
    dessert('gateau-carottes', 'Gâteau aux carottes', { ingredients: [leg('carotte', 4, 'pc', 'principal')] }),
  ];
  assert.deepEqual(proposerPlats([...RICHE, ...exclus], opts({ nombre: 4 })), proposerPlats(RICHE, opts({ nombre: 4 })));
});

test('légumes : palier 3 seulement si ECARTES_MAX le permet encore après l’échange', () => {
  // Bœuf aux carottes : pas de version pour Adulte B (palier 3), à découvrir.
  const boeufCarottes = plat('boeuf-carottes', 'Bœuf aux carottes', [BOEUF, leg('carotte', 4, 'pc', 'principal')]);
  const r = proposerPlats([...RICHE, boeufCarottes], opts({ nombre: 4 }));
  assert.equal(r.ids[3], 'boeuf-carottes');
  assert.equal(r.choisis[3].palier, 3);
  // La cible a déjà un plat que quelqu'un ne mange pas : la limite est atteinte, rien ne change.
  const cible = { ...CIBLE, plats: { 'b-cible': dans(1) } };
  const tous = [...RICHE, boeufCarottes, plat('b-cible', 'Dans la cible', [BOEUF])];
  assert.equal(proposerPlats(tous, opts({ nombre: 4, cible })).ids.includes('boeuf-carottes'), false);
  // Un plat du palier 3 retenu remplacé par un plat du palier 3 avec des légumes (même groupe) : permis.
  const p1 = plat('p1', 'P1');
  const x1 = plat('x1', 'X1', [BOEUF], notes(5));
  const xLegumes = plat('x-legumes', 'Poulet aux poivrons', [POULET, leg('poivron', 3, 'pc', 'principal')], notes(4));
  assert.deepEqual(proposerPlats([p1, x1], opts({ nombre: 2 })).ids, ['x1', 'p1']);
  assert.deepEqual(proposerPlats([p1, x1, xLegumes], opts({ nombre: 2 })).ids, ['x-legumes', 'p1']);
  // Sans groupe commun (relecture) : le palier 3 ne remplace pas le plat du palier 1 (la limite serait dépassée), mais
  // il remplace le plat du palier 3 retenu plus haut : un seul plat écarté, et des légumes.
  const xLegumesNeuf = { ...xLegumes, notes: {} };
  assert.deepEqual(proposerPlats([p1, x1, xLegumesNeuf], opts({ nombre: 2 })).ids, ['x-legumes', 'p1']);
  const p2 = plat('p2', 'P2');
  assert.deepEqual(proposerPlats([p1, p2, x1], opts({ nombre: 3 })).ids, ['p2', 'x1', 'p1']);
  assert.deepEqual(proposerPlats([p1, p2, x1, xLegumesNeuf], opts({ nombre: 3 })).ids, ['p2', 'x-legumes', 'p1']);
});

test('légumes : palier par palier, un plat que tout le monde mange passe avant un plat que quelqu’un ne mange pas', () => {
  // Gratin de courgettes : aimé par Adulte A, palier 1, pas retenu par le remplissage. Bœuf aux carottes : à découvrir,
  // palier 3 (pas de version pour Adulte B), du groupe du dernier retenu. Le gratin entre, à la place du dernier aimé.
  const gratin = plat('gratin-courgettes', 'Gratin de courgettes', [leg('courgette', 3, 'pc', 'principal')], notes(4));
  const boeufCarottes = plat('boeuf-carottes', 'Bœuf aux carottes', [BOEUF, leg('carotte', 4, 'pc', 'principal')]);
  const sansBoeuf = proposerPlats([...RICHE, gratin], opts({ nombre: 4 }));
  const r = proposerPlats([...RICHE, gratin, boeufCarottes], opts({ nombre: 4 }));
  assert.deepEqual(r, sansBoeuf, 'ajouter un plat du palier 3 ne fait pas sortir le gratin');
  assert.equal(r.ids.includes('gratin-courgettes'), true);
  assert.deepEqual(r.choisis.map((c) => c.palier), [1, 1, 1, 1]);
  assert.equal(r.choisis.find((c) => c.platId === 'gratin-courgettes').groupe, 'aime');
  // Soupe de carottes servie la semaine d'avant : palier 2, à découvrir ; le gratin (palier 1, aimé) passe devant.
  const recente = plat('soupe-carottes', 'Soupe de carottes', [leg('carotte', 2, 'pc')], { derniereFois: '2026-10-05' });
  const r2 = proposerPlats([...RICHE, gratin, recente], opts({ nombre: 4 }));
  assert.equal(r2.ids.includes('gratin-courgettes'), true);
  assert.equal(r2.ids.includes('soupe-carottes'), false);
  assert.deepEqual(r2.choisis.map((c) => c.palier), [1, 1, 1, 1]);
  // Sans le gratin, la soupe récente (palier 2) passe avant le bœuf (palier 3).
  const r3 = proposerPlats([...RICHE, recente, boeufCarottes], opts({ nombre: 4 }));
  assert.equal(r3.ids.includes('soupe-carottes'), true);
  assert.equal(r3.ids.includes('boeuf-carottes'), false);
  assert.deepEqual(r3.choisis.find((c) => c.platId === 'soupe-carottes').palier, 2);
  // Un plat du palier 1 d'un autre groupe passe avant un plat du palier 2 du même groupe : palier d'abord.
  const gratinNeuf = plat('gratin-courgettes', 'Gratin de courgettes', [leg('courgette', 3, 'pc', 'principal')], notes(5, 4, 4));
  const r4 = proposerPlats([...RICHE, recente, gratinNeuf], opts({ nombre: 4 }));
  assert.equal(r4.ids.includes('gratin-courgettes'), true);
  assert.equal(r4.ids.includes('soupe-carottes'), false);
});

test('légumes : déterministe, indépendant de l’ordre des plats ; desserts jamais touchés', () => {
  const tous = geler([...RICHE, SOUPE, plat('velo', 'Velouté de potiron', [leg('potiron', 200, 'g')], { derniereFois: '2026-09-21' })]);
  const r1 = proposerPlats(tous, opts({ nombre: 4 }));
  assert.deepEqual(proposerPlats([...tous].reverse(), opts({ nombre: 4 })), r1);
  assert.deepEqual(proposerPlats(tous, opts({ nombre: 4 })), r1);
  assert.equal(r1.ids.filter((id) => id === 'soupe-carottes' || id === 'velo').length, 1, 'un seul échange');
  // Desserts : aucun échange, aucune raison « légumes ».
  const gateau = dessert('gateau-carottes', 'Gâteau aux carottes', { ingredients: [leg('carotte', 4, 'pc', 'principal')], derniereFois: '2026-09-21' });
  const d = proposerDesserts([...DESSERTS, gateau], opts({ nombre: 2 }));
  assert.equal(d.ids.includes('gateau-carottes'), false);
  const seul = proposerDesserts([gateau], opts({ nombre: 1 }));
  assert.deepEqual(seul.ids, ['gateau-carottes']);
  assert.equal(Object.hasOwn(seul.choisis[0].raison, 'legumes'), false);
  assert.equal(candidats([gateau], opts({ type: 'dessert' }))[0].legumes, true, 'le fait reste connu');
});

test('autreIdee : un plat avec des légumes, seul de la cible, est remplacé par un plat avec des légumes d’abord', () => {
  const velo = plat('velo', 'Velouté de potiron', [leg('potiron', 200, 'g')], { derniereFois: '2026-09-21' });
  const tous = [...RICHE, SOUPE, velo];
  const cible = { ...CIBLE, plats: { 'soupe-carottes': dans(1), 'aime-1': dans(2) } };
  const r = autreIdee(tous, 'soupe-carottes', opts({ cible }));
  assert.equal(r.platId, 'velo');
  assert.deepEqual(r.raison, { code: 'decouvrir', legumes: true });
  // Un autre plat de la cible a des légumes : recherche ordinaire (un plat neuf, mieux placé).
  const gratin = plat('gratin-courgettes', 'Gratin de courgettes', [leg('courgette', 3, 'pc', 'principal')], notes(3, 3, 3));
  const avecGratin = { ...CIBLE, plats: { ...cible.plats, 'gratin-courgettes': dans(3) } };
  assert.match(autreIdee([...tous, gratin], 'soupe-carottes', opts({ cible: avecGratin })).platId, /^neuf-/);
  // L'ancien plat n'avait pas de légumes : recherche ordinaire, même si la cible n'en a aucun.
  const sansLegume = { ...CIBLE, plats: { 'neuf-1': dans(1), 'aime-1': dans(2) } };
  assert.match(autreIdee(tous, 'neuf-1', opts({ cible: sansLegume })).platId, /^neuf-/);
  // Aucun autre plat avec des légumes : n'importe lequel.
  assert.match(autreIdee([...RICHE, SOUPE], 'soupe-carottes', opts({ cible })).platId, /^neuf-/);
  // Un dessert n'est jamais concerné.
  const gateau = dessert('gateau-carottes', 'Gâteau aux carottes', { ingredients: [leg('carotte', 4, 'pc', 'principal')] });
  const gateau2 = dessert('gateau-courgettes', 'Gâteau aux courgettes', { ingredients: [leg('courgette', 2, 'pc', 'principal')], derniereFois: '2026-09-21' });
  const cibleDessert = { ...CIBLE, plats: { 'gateau-carottes': dans(1) } };
  const d = autreIdee([...DESSERTS, gateau, gateau2], 'gateau-carottes', opts({ cible: cibleDessert }));
  assert.notEqual(d.platId, 'gateau-courgettes');
  assert.equal(Object.hasOwn(d.raison, 'legumes'), false);
});

test('texteRaison : « · avec des légumes » à la fin de la raison ; seul quand rien d’autre n’est dit', () => {
  const P = '✨ Proposé\u00A0: ';
  assert.equal(TEXTES_PROPOSER.legumes, 'avec des légumes');
  assert.equal(texteRaison({ code: 'aime', profils: ['profil-a'], legumes: true }, TXT), `${P}vous l’aimez · avec des légumes.`);
  assert.equal(texteRaison({ code: 'aime', profils: ['profil-a', 'enfant'], legumes: true }, { moi: B, profils: PROFILS }), `${P}Adulte A et Enfant l’aiment · avec des légumes.`);
  assert.equal(texteRaison({ code: 'decouvrir', legumes: true }, TXT), `${P}à découvrir · avec des légumes.`);
  assert.equal(texteRaison({ code: 'ancien', legumes: true }, TXT), `${P}pas au menu depuis longtemps · avec des légumes.`);
  assert.equal(texteRaison({ code: 'recent', legumes: true }, TXT), `${P}avec des légumes.`);
  assert.equal(texteRaison({ code: 'autre', legumes: true }, TXT), `${P}avec des légumes.`);
  assert.equal(texteRaison({ code: 'aime', profils: ['profil-z'], legumes: true }, TXT), `${P}avec des légumes.`);
  assert.equal(texteRaison({ code: 'autre' }, TXT), null);
  assert.equal(texteRaison({ code: 'decouvrir', legumes: false }, TXT), `${P}à découvrir.`);
  assert.equal(texteRaison(null, TXT), null);
});

// ——— Pureté ———

test('pureté : ni heure ni hasard du téléphone dans proposition.js ; module au précache', async () => {
  const source = await readFile(new URL('../js/coeur/proposition.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now|new Date\(|Math\.random/);
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\.\/js\/coeur\/proposition\.js'/);
});

// ——— « Ma cuisine » (2026-10-20) : option `ecarter` ———

test('ecarter : un plat qui demande un objet absent n’est jamais proposé, ni en 🔄 ; cause « cuisine »', () => {
  const ecarter = (p) => p.id.startsWith('neuf');
  assert.ok(!candidats(RICHE, opts({ ecarter })).some((c) => c.platId.startsWith('neuf')));
  assert.equal(candidats(RICHE, opts()).length, 8);
  const proposition = proposerPlats(RICHE, opts({ ecarter, nombre: 6 }));
  assert.ok(proposition.ids.every((id) => id.startsWith('aime')));
  assert.equal(proposition.code, 'peu');
  assert.equal(proposition.cause, 'cuisine');
  assert.match(annonceProposition(proposition, { profils: PROFILS }), /Les autres plats demandent un objet que vous n’avez pas\./);
  const idee = autreIdee(RICHE, 'aime-1', opts({ ecarter: (p) => p.id !== 'aime-2' && p.id !== 'aime-1' }));
  assert.equal(idee?.platId, 'aime-2');
  assert.equal(autreIdee(RICHE, 'aime-1', opts({ ecarter: (p) => p.id !== 'aime-1' })), null);
  assert.equal(nombreProposable(RICHE, opts({ ecarter: () => true })), 0);
  const apercu = apercuProposition(RICHE, opts({ ecarter: (p) => p.id !== 'aime-1' }));
  assert.equal(apercu.plats, 0);
  assert.equal(apercu.cause, 'cuisine');
  assert.equal(texteSansProposition('cuisine'), 'Vos plats demandent un objet que vous n’avez pas : choisissez-les vous-même.');
  // « Changer des plats » passe l'option à chaque « Une autre idée ».
  const sem = semaine(CIBLE.id, CIBLE.debut, CIBLE.fin, { 'aime-1': dans(1) });
  const change = changerDesPlats(RICHE, ['aime-1'], { semaine: sem, semaines: [sem], profils: PROFILS, evaluer, ecarter: (p) => !['aime-1', 'aime-3'].includes(p.id) });
  assert.deepEqual(change.remplacements.map((r) => r.platId), ['aime-3']);
  // Un plat sans recette n'est jamais « écarté par la cuisine » : sa cause reste la recette.
  const sansRecette = [plat('vide', 'Vide', [])];
  assert.equal(apercuProposition(sansRecette, opts({ ecarter: () => true })).cause, 'recettes');
});
