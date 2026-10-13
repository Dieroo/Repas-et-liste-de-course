// T3d « Placard, habituels et rayons » : coeur/liste.js (habituels « À acheter chaque semaine », préparations de chaque
// semaine, « Pas cette semaine », « Comme chaque semaine » en mode Drive, réglages d'un produit dans la liste : rayon,
// placard et habituel du foyer, écritures de chaque geste, « Précision (facultatif) », ordre des rayons, récents de
// « Ajouter à la liste », carte « 🏠 Placard », textes). Fixtures génériques : aucun produit du foyer.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { melanger } from '../js/coeur/notes.js';
import { LIBELLES_RAYON } from '../js/coeur/edition.js';
import { EFFACER, appliquerChamps, champsValides, peutAllerDansLaSemaine } from '../js/coeur/semaine.js';
import {
  ERREURS_HABITUEL, ERREURS_PRECISION, PRECISION_MAX, RAYONS_DE_DEPART, RECENTS_MAX, TEXTES_T3D, ajouterAuxRecents,
  cleRecents, descendreRayon, deplacerRayon, ecrituresCoche, ecrituresHabituel, ecrituresPlacard, ecrituresPrecision,
  ecrituresRayon, ecrituresRayons, ecrituresRecherche, ecrituresSansHabituel, ecrituresSansHebdo, estPreparationHebdo,
  grouperDrive, grouperParRayon, habituelsDuFoyer, lireNombreSaisi, lireRecents, listeDeCourses, monterRayon,
  phraseRestesFin, placardDuFoyer, preparationsChaqueSemaine, preparerAjout, preparerFinDesCourses, restes, restesFinDesCourses,
  texteAjoutArticle, texteChaqueSemaineAussi, texteDeplacerRayon, texteOrigine, textePlacard, texteRayon, texteSource,
  valeurCoche,
} from '../js/coeur/liste.js';

// ——— Fixtures ———

const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const PROFILS = [A];
const ing = (produit, qte, unite, rayon, marqueurs = []) => ({ produit, qte, unite, rayon, marqueurs });
/** Recette pour 2 portions : un adulte seul, 2 repas, la recette telle quelle. */
const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 2, ingredients, etapes: ['Cuire.'], ...extra,
});
const GRATIN = plat('gratin', 'Gratin', [
  ing('pâtes', 200, 'g', 'epicerie_salee', ['feculent']),
  ing('beurre', 20, 'g', 'cremerie', ['laitier']),
  ing('farine t55', 100, 'g', 'epicerie_salee'), // au-delà du seuil de la farine (50 g) : sur la liste
]);
const YAOURTS = {
  id: 'yaourts-maison', nom: 'Yaourts maison', type: 'preparation', recurrence: 'hebdo', statutRecette: 'brouillon',
  portionsBase: 8, ingredients: [ing('lait entier', 1, 'l', 'cremerie', ['laitier']), ing('yaourt nature', 1, 'pc', 'cremerie', ['laitier'])],
};
const PAIN = { id: 'pain-maison', nom: 'Pain maison', type: 'preparation', recurrence: 'hebdo' }; // ⏳ : pas encore de recette
const JETEE = { ...YAOURTS, id: 'compote-jetee', nom: 'Compote jetée', corbeille: { le: 1, par: 'x@exemple.fr' } };
const PAS_HEBDO = { ...YAOURTS, id: 'confiture', nom: 'Confiture', recurrence: 'aucune' };
const PLAT_HEBDO = { ...GRATIN, id: 'soupe', nom: 'Soupe', recurrence: 'hebdo' }; // un plat, pas une préparation
const TOUS = [GRATIN, YAOURTS, PAIN, JETEE, PAS_HEBDO, PLAT_HEBDO];

const H = (iso) => new Date(iso).getTime();
const CREEE = H('2026-10-10T09:00:00+02:00');
const S1 = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: CREEE };
const semaineAvec = (extra = {}) => ({ ...S1, plats: { gratin: { ajouteLe: 1 } }, ...extra });
const SEMAINE = semaineAvec();
const LAIT_HABITUEL = { habituel: { actif: true, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' } };
const FOYER = {
  'lait-demi-ecreme': LAIT_HABITUEL,
  pile: { habituel: { actif: true, libelle: 'piles' } },
  'croquette-pour-chat': { habituel: { actif: true, qte: 2, unite: 'pc', libelle: 'croquettes pour chat' } },
  beurre: { habituel: { actif: true, qte: 250, unite: 'g', libelle: 'beurre' } },
  sucre: { habituel: { actif: false, qte: 1, unite: 'kg', libelle: 'sucre' } },
  pate: { rechercheDrive: 'penne' },
};
const calculer = (semaine, extra = {}) => listeDeCourses(semaine, { tousLesPlats: TOUS, profils: PROFILS, ...extra });
const trouver = (liste, produitId) => [...liste.lignes, ...liste.maison].find((l) => l.produitId === produitId);

function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

// ——— Préparations de chaque semaine ———

test('estPreparationHebdo : préparation `hebdo` hors corbeille ; ni un plat `hebdo`, ni une préparation ordinaire', () => {
  assert.equal(estPreparationHebdo(YAOURTS), true);
  assert.equal(estPreparationHebdo(PAIN), true);
  for (const p of [JETEE, PAS_HEBDO, PLAT_HEBDO, GRATIN, null, { ...YAOURTS, id: 'A B' }]) assert.equal(estPreparationHebdo(p), false);
  // Les mêmes plats que « Ajouter à la semaine » écarte (semaine.js › peutAllerDansLaSemaine).
  assert.equal(peutAllerDansLaSemaine(YAOURTS), false);
  assert.equal(peutAllerDansLaSemaine(PLAT_HEBDO), true);
});

test('preparationsChaqueSemaine : triées par nom ; « Pas cette semaine » (`sansHebdo`) ; sans recette ; déjà dans la semaine écartée', () => {
  const preps = preparationsChaqueSemaine(SEMAINE, { tousLesPlats: TOUS });
  assert.deepEqual(preps.map((p) => [p.platId, p.nom, p.saute, p.sansRecette]),
    [['pain-maison', 'Pain maison', false, true], ['yaourts-maison', 'Yaourts maison', false, false]]);
  assert.equal(preps[1].plat, YAOURTS);
  const sautee = preparationsChaqueSemaine(semaineAvec({ sansHebdo: { 'yaourts-maison': true, 'pain-maison': 'oui' } }), { tousLesPlats: TOUS });
  assert.deepEqual(sautee.map((p) => p.saute), [false, true]);
  // Une préparation déjà dans les plats de la semaine (donnée d'une autre version) n'est jamais comptée deux fois.
  const dedans = semaineAvec({ plats: { gratin: { ajouteLe: 1 }, 'yaourts-maison': { ajouteLe: 2 } } });
  assert.deepEqual(preparationsChaqueSemaine(dedans, { tousLesPlats: TOUS }).map((p) => p.platId), ['pain-maison']);
  // Retirée de la semaine, elle revient chaque semaine.
  const retiree = semaineAvec({ plats: { gratin: { ajouteLe: 1 }, 'yaourts-maison': { ajouteLe: 2, retire: true } } });
  assert.deepEqual(preparationsChaqueSemaine(retiree, { tousLesPlats: TOUS }).map((p) => p.platId), ['pain-maison', 'yaourts-maison']);
  // Sans semaine : aucune n'est sautée.
  assert.deepEqual(preparationsChaqueSemaine(null, { tousLesPlats: TOUS }).map((p) => p.saute), [false, false]);
  assert.deepEqual(preparationsChaqueSemaine(SEMAINE), []);
});

test('liste : une préparation de chaque semaine entre telle qu’elle est écrite (facteur 1), source « chaque semaine : … »', () => {
  const liste = calculer(SEMAINE);
  const lait = trouver(liste, 'lait-entier');
  assert.deepEqual(lait.totaux, { volume: 1000 });
  assert.equal(lait.quantite, '1\u00A0l');
  assert.deepEqual(lait.sources, [{ type: 'hebdo', platId: 'yaourts-maison', nom: 'Yaourts maison', totaux: { volume: 1000 } }]);
  assert.equal(lait.chaqueSemaine, true);
  assert.equal(lait.placard, false, '1 l dépasse le seuil du lait (10 cl)');
  assert.deepEqual(trouver(liste, 'yaourt-nature').totaux, { pc: 1 });
  assert.equal(texteOrigine(lait), 'chaque semaine\u00A0: Yaourts maison');
  assert.equal(texteSource(lait.sources[0]), 'Chaque semaine\u00A0: Yaourts maison · 1\u00A0l');
  // Ni la préparation à la corbeille, ni une préparation ordinaire, ni un plat `hebdo`, ni la préparation ⏳.
  assert.deepEqual(liste.lignes.flatMap((l) => l.sources.map((s) => s.platId)).filter(Boolean).sort(),
    ['gratin', 'gratin', 'yaourts-maison', 'yaourts-maison']);
  assert.deepEqual(liste.preparations.map((p) => p.platId), ['pain-maison', 'yaourts-maison']);
  assert.deepEqual(liste.sansRecette, [], 'la préparation ⏳ n’est pas un plat de la semaine');
});

test('liste : « Pas cette semaine » d’une préparation (`sansHebdo.<id>`) la retire de cette semaine seulement', () => {
  const sautee = calculer(semaineAvec({ sansHebdo: { 'yaourts-maison': true } }));
  assert.equal(trouver(sautee, 'lait-entier'), undefined);
  assert.equal(sautee.preparations.find((p) => p.platId === 'yaourts-maison').saute, true);
  const suivante = calculer({ ...semaineAvec(), id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' });
  assert.ok(trouver(suivante, 'lait-entier'), 'la semaine suivante, elle revient');
  const r = ecrituresSansHebdo(SEMAINE, 'yaourts-maison', true);
  assert.deepEqual(r, { id: '2026-10-10', champs: { 'sansHebdo.yaourts-maison': true } });
  assert.ok(champsValides(r.champs));
  assert.equal(trouver(calculer(appliquerChamps(SEMAINE, r.champs)), 'lait-entier'), undefined);
  assert.deepEqual(ecrituresSansHebdo(SEMAINE, 'yaourts-maison', false), { id: '2026-10-10', champs: { 'sansHebdo.yaourts-maison': EFFACER } });
  assert.deepEqual(ecrituresSansHebdo(SEMAINE, 'A B', true), { code: 'invalide' });
  assert.deepEqual(ecrituresSansHebdo(null, 'yaourts-maison', true), { code: 'invalide' });
});

test('liste : une préparation de chaque semaine dont une quantité est illisible est à vérifier, nommée', () => {
  const abimee = { ...YAOURTS, ingredients: [ing('lait entier', 'beaucoup', 'l', 'cremerie', ['laitier'])] };
  const liste = listeDeCourses(SEMAINE, { tousLesPlats: [GRATIN, abimee], profils: PROFILS });
  assert.deepEqual(liste.aVerifier.map((v) => [v.plat.id, v.produit]), [['yaourts-maison', 'lait entier']]);
  assert.deepEqual(trouver(liste, 'lait-entier').totaux, {});
});

// ——— Habituels ———

test('habituelsDuFoyer : actifs seulement, triés ; nom, quantité ; « Pas cette semaine » ; table ou Map', () => {
  const habituels = habituelsDuFoyer(FOYER, semaineAvec({ sansHabituel: { pile: true } }));
  assert.deepEqual(habituels.map((h) => [h.produitId, h.cle, h.nom, h.quantite, h.saute]), [
    ['beurre', 'beurre', 'Beurre', '250\u00A0g', false],
    ['croquette-pour-chat', 'croquette-pour-chat', 'Croquettes pour chat', '2', false],
    ['lait-demi-ecreme', 'lait-demi-ecreme', 'Lait demi-écrémé', '6\u00A0l', false],
    ['pile', 'pile', 'Piles', '', true],
  ]);
  assert.deepEqual(habituels[2].totaux, { volume: 6000 });
  assert.deepEqual(habituelsDuFoyer(new Map(Object.entries(FOYER))).map((h) => h.produitId), habituels.map((h) => h.produitId));
  assert.deepEqual(habituelsDuFoyer(null), []);
});

test('habituelsDuFoyer : rangé sous une clé de repli, il rejoint son produit ; l’id l’emporte, même éteint', () => {
  const sousRepli = { 'farine-t55': { habituel: { actif: true, qte: 1, unite: 'kg', libelle: 'farine t55' } } };
  assert.deepEqual(habituelsDuFoyer(sousRepli).map((h) => [h.produitId, h.cle]), [['farine', 'farine-t55']]);
  assert.deepEqual(habituelsDuFoyer({ ...sousRepli, farine: { habituel: { actif: false } } }), []);
  assert.deepEqual(habituelsDuFoyer({ ...sousRepli, farine: { habituel: { actif: true, qte: 2, unite: 'kg' } } }).map((h) => [h.cle, h.quantite]),
    [['farine', '2\u00A0kg']]);
  // Sans nom gardé : son identifiant ; un identifiant illisible est ignoré.
  assert.deepEqual(habituelsDuFoyer({ lessive: { habituel: { actif: true } }, 'A B': { habituel: { actif: true } } })
    .map((h) => [h.produitId, h.nom]), [['lessive', 'Lessive']]);
});

test('liste : un habituel est une ligne « Comme chaque semaine » (source « chaque semaine ») ; sans quantité, la ligne existe', () => {
  const liste = calculer(SEMAINE, { produitsFoyer: FOYER });
  const lait = trouver(liste, 'lait-demi-ecreme');
  assert.deepEqual(lait.sources, [{ type: 'habituel', produitId: 'lait-demi-ecreme', totaux: { volume: 6000 } }]);
  assert.equal(lait.quantite, '6\u00A0l');
  assert.equal(lait.chaqueSemaine, true);
  assert.deepEqual(lait.habituel, { actif: true, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' });
  assert.equal(texteOrigine(lait), 'chaque semaine');
  assert.equal(texteSource(lait.sources[0]), 'Chaque semaine · 6\u00A0l');
  const piles = trouver(liste, 'pile');
  assert.deepEqual([piles.nom, piles.rayon, piles.totaux, piles.quantite, piles.chaqueSemaine], ['Piles', 'divers', {}, '', true]);
  assert.equal(texteSource(piles.sources[0]), 'Chaque semaine');
  assert.equal(trouver(liste, 'croquette-pour-chat').nom, 'Croquettes pour chat');
  // Un habituel éteint n'apporte rien.
  assert.equal(trouver(liste, 'sucre'), undefined);
  assert.deepEqual(liste.habituels.map((h) => h.produitId), ['beurre', 'croquette-pour-chat', 'lait-demi-ecreme', 'pile']);
});

test('liste : l’habituel d’un produit des plats s’ajoute à sa ligne (deux sources) ; jamais mis de côté (prioritaire sur le placard)', () => {
  const sans = calculer(SEMAINE);
  assert.ok(sans.maison.some((l) => l.produitId === 'beurre'), 'sans habituel, 20 g de beurre restent à la maison');
  const liste = calculer(SEMAINE, { produitsFoyer: FOYER });
  const beurre = trouver(liste, 'beurre');
  assert.ok(liste.lignes.includes(beurre));
  assert.deepEqual(beurre.totaux, { masse: 270 });
  assert.deepEqual(beurre.sources.map((s) => [s.type, s.totaux]), [['plat', { masse: 20 }], ['habituel', { masse: 250 }]]);
  assert.equal(beurre.chaqueSemaine, false, 'elle sert aussi un plat de la semaine');
  assert.equal(texteOrigine(beurre), 'Gratin, chaque semaine');
  // Même sous son seuil, un habituel est sur la liste.
  const petit = calculer(SEMAINE, { produitsFoyer: { beurre: { habituel: { actif: true, qte: 5, unite: 'g' } } } });
  assert.ok(petit.lignes.some((l) => l.produitId === 'beurre'));
  assert.equal(petit.maison.some((l) => l.produitId === 'beurre'), false);
});

test('liste : « Pas cette semaine » d’un habituel (`sansHabituel.<id>`) le retire de cette semaine ; le placard revient', () => {
  const r = ecrituresSansHabituel(SEMAINE, 'beurre', true);
  assert.deepEqual(r, { id: '2026-10-10', champs: { 'sansHabituel.beurre': true } });
  assert.ok(champsValides(r.champs));
  const liste = calculer(appliquerChamps(SEMAINE, r.champs), { produitsFoyer: FOYER });
  assert.ok(liste.maison.some((l) => l.produitId === 'beurre'), '20 g de beurre : de nouveau à la maison');
  const habituel = liste.habituels.find((h) => h.produitId === 'beurre');
  assert.equal(habituel.saute, true, 'il reste nommé, pour être remis');
  assert.equal(liste.maison.find((l) => l.produitId === 'beurre').habituelSaute, true);
  const autreSemaine = calculer({ ...appliquerChamps(SEMAINE, r.champs), id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23',
    sansHabituel: {} }, { produitsFoyer: FOYER });
  assert.deepEqual(trouver(autreSemaine, 'beurre').totaux, { masse: 270 });
  assert.deepEqual(ecrituresSansHabituel(SEMAINE, 'beurre', false), { id: '2026-10-10', champs: { 'sansHabituel.beurre': EFFACER } });
  assert.deepEqual(ecrituresSansHabituel(SEMAINE, '', true), { code: 'invalide' });
  assert.deepEqual(ecrituresSansHabituel({ id: 'x' }, 'beurre', true), { code: 'invalide' });
});

test('liste : sans semaine, ni habituel ni préparation (une coche s’écrit dans la semaine)', () => {
  const liste = listeDeCourses(null, { tousLesPlats: TOUS, profils: PROFILS, produitsFoyer: FOYER });
  assert.deepEqual([liste.lignes, liste.habituels, liste.preparations], [[], [], []]);
});

test('liste : une ligne d’habituel se coche comme les autres (un chemin `coches.<id>`)', () => {
  const liste = calculer(SEMAINE, { produitsFoyer: FOYER });
  const lait = trouver(liste, 'lait-demi-ecreme');
  const r = ecrituresCoche(SEMAINE, lait, true, { maintenant: 5 });
  assert.deepEqual(r.champs, { 'coches.lait-demi-ecreme': valeurCoche(lait.totaux, 5) });
  const apres = calculer(appliquerChamps(SEMAINE, r.champs), { produitsFoyer: FOYER });
  assert.equal(trouver(apres, 'lait-demi-ecreme').cochee, true);
  assert.ok(grouperDrive(apres).panier.some((l) => l.produitId === 'lait-demi-ecreme'));
});

// ——— Mode Drive : « Comme chaque semaine » ———

test('grouperDrive : « Comme chaque semaine » (habituels et préparations) à part de « Pour cette semaine », par rayon puis nom', () => {
  const articles = [{ id: 'a1', libelle: 'lessive', creeLe: CREEE + 1 }];
  const liste = calculer(SEMAINE, { produitsFoyer: FOYER, articles });
  const drive = grouperDrive(liste);
  assert.deepEqual(drive.commeChaqueSemaine.map((l) => l.nom),
    ['Lait demi-écrémé', 'Lait entier', 'Yaourt nature', 'Croquettes pour chat', 'Piles']);
  assert.deepEqual(drive.pourCetteSemaine.map((l) => l.nom), ['Beurre', 'Farine t55', 'Pâtes', 'Lessive']);
  // Mêmes comptes que le mode Magasin.
  const magasin = grouperParRayon(liste);
  assert.deepEqual([drive.total, drive.pris, drive.vide], [magasin.total, magasin.pris, magasin.vide]);
  // Ordre des rayons du foyer : Divers d'abord.
  const ordre = ['divers', ...RAYONS_DE_DEPART.filter((r) => r !== 'divers')];
  assert.deepEqual(grouperDrive(liste, { rayons: ordre }).commeChaqueSemaine.map((l) => l.nom).slice(0, 2), ['Croquettes pour chat', 'Piles']);
  // Une liste sans habituel ni préparation : « Comme chaque semaine » vide (cachée).
  assert.deepEqual(grouperDrive(listeDeCourses(SEMAINE, { tousLesPlats: [GRATIN], profils: PROFILS })).commeChaqueSemaine, []);
});

// ——— Fin des courses et semaine suivante : ce qui revient de soi-même n'est pas gardé ———

test('restes et « Courses terminées » : ni habituel ni préparation gardés (ils reviennent) ; une ligne mixte ne garde que la part des plats', () => {
  const semaine = semaineAvec({ coches: { pate: { q: { masse: 200 } } } });
  const liste = calculer(semaine, { produitsFoyer: FOYER });
  assert.deepEqual(restes(liste, semaine).map((r) => [r.libelle, r.precision]), [['beurre', '20\u00A0g'], ['farine t55', '100\u00A0g']]);
  // La feuille « Courses terminées ? » nomme aussi ce qui revient chaque semaine (relecture de T3d) : rien n'est oublié
  // sans le savoir ; seuls les plats sont gardés pour la prochaine fois.
  assert.deepEqual(restesFinDesCourses(liste).map((r) => [r.libelle, Boolean(r.chaqueSemaine)]), [
    ['beurre', false], ['lait demi-écrémé', true], ['lait entier', true], ['yaourt nature', true], ['farine t55', false],
    ['croquettes pour chat', true], ['piles', true],
  ]);
  const fin = preparerFinDesCourses(semaine, { liste, plats: [], garder: true, aujourdhui: '2026-10-10', maintenant: CREEE + 9 });
  assert.deepEqual(fin.lot.articles.map((a) => [a.id, a.precision]),
    [['garde--2026-10-10--beurre', '20\u00A0g'], ['garde--2026-10-10--farine', '100\u00A0g']]);
  // Ligne mixte prise en partie : ce qui a été pris compte d'abord pour l'habituel (il reviendra) ; la part des plats qui
  // manque encore est gardée (100 g pris sur 270 g : les 20 g du gratin restent, dans le doute).
  const prise = semaineAvec({ coches: { beurre: { q: { masse: 100 } } } });
  assert.deepEqual(restes(calculer(prise, { produitsFoyer: FOYER }), prise).map((r) => [r.libelle, r.precision]),
    [['beurre', '20\u00A0g'], ['farine t55', '100\u00A0g'], ['pâtes', '200\u00A0g']]);
  // Tout pris : rien.
  const toutPris = semaineAvec({ coches: { beurre: { q: { masse: 270 } } } });
  assert.equal(restes(calculer(toutPris, { produitsFoyer: FOYER }), toutPris).some((r) => r.libelle === 'beurre'), false);
});

test('« Courses terminées » : un habituel pas pris ouvre la feuille (« Il reste 1 article : lait. ») sans article gardé', () => {
  const foyer = { lait: { habituel: { actif: true, qte: 1, unite: 'l', libelle: 'lait' } } };
  const cochee = (l) => ({ q: { ...l.totaux } });
  const semaine0 = semaineAvec();
  const avant = calculer(semaine0, { produitsFoyer: foyer });
  // Tout est coché sauf le lait.
  const coches = Object.fromEntries(avant.lignes.filter((l) => l.produitId !== 'lait').map((l) => [l.cle, cochee(l)]));
  const semaine = semaineAvec({ coches });
  const liste = calculer(semaine, { produitsFoyer: foyer });
  const r = restesFinDesCourses(liste);
  assert.deepEqual(r.map((x) => [x.type, x.libelle, x.precision, x.chaqueSemaine]), [['ligne', 'lait', '1\u00A0l', true]]);
  assert.equal(phraseRestesFin(r), 'Il reste 1\u00A0article\u00A0: lait.');
  const fin = preparerFinDesCourses(semaine, { liste, plats: [], garder: true, aujourdhui: '2026-10-10', maintenant: CREEE + 9 });
  assert.deepEqual([fin.lot.articles, fin.gardes], [[], 0], 'jamais d’article gardé : il reviendra la semaine suivante');
  assert.deepEqual(restes(liste, semaine), []);
  // Une préparation de chaque semaine pas prise : nommée de même, jamais gardée.
  const avecYaourts = listeDeCourses(semaine0, { tousLesPlats: [GRATIN, YAOURTS], profils: PROFILS });
  const sansYaourts = semaineAvec({
    coches: Object.fromEntries(avecYaourts.lignes.filter((l) => l.chaqueSemaine !== true).map((l) => [l.cle, cochee(l)])),
  });
  const listeY = listeDeCourses(sansYaourts, { tousLesPlats: [GRATIN, YAOURTS], profils: PROFILS });
  assert.deepEqual(restesFinDesCourses(listeY).map((x) => x.libelle), ['lait entier', 'yaourt nature']);
  assert.deepEqual(preparerFinDesCourses(sansYaourts, { liste: listeY, plats: [], garder: true, aujourdhui: '2026-10-10',
    maintenant: CREEE + 9 }).lot.articles, []);
});

test('« Courses terminées » : un habituel pris, puis un plat ajouté qui en demande : la part du plat n’est jamais perdue', () => {
  // Beurre chaque semaine (250 g), coché pendant les courses ; l'autre téléphone ajoute ensuite un plat qui en demande 200 g.
  const foyer = { beurre: { habituel: { actif: true, qte: 250, unite: 'g', libelle: 'beurre' } } };
  const gratinBeurre = plat('gratin-beurre', 'Gratin au beurre', [ing('beurre', 200, 'g', 'cremerie', ['laitier'])]);
  const semaine = { ...S1, plats: { 'gratin-beurre': { ajouteLe: 2 } }, coches: { beurre: { q: { masse: 250 } } } };
  const liste = listeDeCourses(semaine, { tousLesPlats: [gratinBeurre], profils: PROFILS, produitsFoyer: foyer });
  const beurre = liste.lignes.find((l) => l.produitId === 'beurre');
  assert.deepEqual([beurre.cochee, beurre.reste, beurre.chaqueSemaine], [false, { masse: 200 }, false]);
  assert.deepEqual(restesFinDesCourses(liste).map((r) => [r.libelle, r.precision]), [['beurre', '200\u00A0g']]);
  const fin = preparerFinDesCourses(semaine, { liste, plats: [], garder: true, aujourdhui: '2026-10-10', maintenant: CREEE + 9 });
  assert.deepEqual(fin.lot.articles.map((a) => [a.id, a.precision]), [['garde--2026-10-10--beurre', '200\u00A0g']]);
  assert.deepEqual(restes(liste, semaine).map((r) => [r.libelle, r.precision]), [['beurre', '200\u00A0g']]);
  // Pris en partie au-delà de l'habituel (300 g sur 450 g) : il manque 150 g, tous pour le plat.
  const partiel = { ...semaine, coches: { beurre: { q: { masse: 300 } } } };
  const listeP = listeDeCourses(partiel, { tousLesPlats: [gratinBeurre], profils: PROFILS, produitsFoyer: foyer });
  assert.deepEqual(restes(listeP, partiel).map((r) => r.precision), ['150\u00A0g']);
});

// ——— Ajouter à la liste ———

test('preparerAjout et texteAjoutArticle : le même produit « chaque semaine » le dit (au lieu de « pour vos plats »)', () => {
  const liste = calculer(SEMAINE, { produitsFoyer: FOYER });
  const r = preparerAjout('lait demi-écrémé', { liste });
  assert.deepEqual(r.aussi, { nom: 'Lait demi-écrémé', quantite: '6\u00A0l', chaqueSemaine: true });
  assert.equal(texteAjoutArticle('lait demi-écrémé', r.aussi), '✓ «\u00A0Lait demi-écrémé\u00A0» ajouté. Il y en a aussi 6\u00A0l chaque semaine.');
  assert.deepEqual(preparerAjout('beurre', { liste }).aussi, { nom: 'Beurre', quantite: '270\u00A0g' });
});

// ——— Réglages d'un produit dans la liste ———

test('liste : réglages du produit sur chaque ligne et chaque article (rayon de départ, placard, habituel)', () => {
  const produitsFoyer = { ...FOYER, beurre: { ...FOYER.beurre, rayon: 'fromages' }, farine: { placard: { actif: false } } };
  const liste = calculer(SEMAINE, { produitsFoyer, articles: [{ id: 'a1', libelle: 'beurre demi-sel', creeLe: CREEE + 1 }] });
  const beurre = trouver(liste, 'beurre');
  assert.deepEqual([beurre.rayon, beurre.rayonDeDepart, beurre.rayonDuFoyer], ['fromages', 'cremerie', true]);
  assert.deepEqual([beurre.placardProduit, beurre.placardDuFoyer], [{ seuil: 30, unite: 'g' }, false]);
  const farine = trouver(liste, 'farine');
  assert.deepEqual([farine.placard, farine.placardProduit, farine.placardDuFoyer, farine.habituel], [false, null, true, null]);
  const article = liste.articles[0];
  assert.deepEqual([article.produitId, article.rayonDeDepart, article.placardProduit, article.habituel, article.chaqueSemaine],
    ['beurre-demi-sel', 'cremerie', null, null, false]);
});

test('liste : « papier hygiénique », devenu « papier toilette » pour l’app, garde son mot cherché et son rayon (clé de repli)', () => {
  const produitsFoyer = { 'papier-hygienique': { rechercheDrive: 'papier wc', rayon: 'divers' } };
  const [article] = listeDeCourses(SEMAINE, { tousLesPlats: [], profils: PROFILS, produitsFoyer,
    articles: [{ id: 'a1', libelle: 'papier hygiénique' }] }).articles;
  assert.deepEqual([article.produitId, article.replis, article.repli], ['papier-toilette', ['papier-hygienique'], 'papier-hygienique']);
  assert.deepEqual([article.recherche, article.rechercheFoyer, article.rayon, article.rayonDuFoyer], ['papier wc', 'papier wc', 'divers', true]);
  assert.deepEqual(ecrituresRecherche(article, '', { produitsFoyer }).ecritures, [{ id: 'papier-hygienique', champs: { rechercheDrive: EFFACER } }]);
  const sans = listeDeCourses(SEMAINE, { articles: [{ id: 'a1', libelle: 'papier hygiénique' }] }).articles[0];
  assert.equal(sans.rayon, 'hygiene');
});

test('liste : placard du foyer allumé sur un produit hors du départ (toujours mis de côté) ; éteint sur un produit du départ', () => {
  const semi = plat('tartine', 'Tartine', [ing('beurre demi-sel', 100, 'g', 'cremerie', ['laitier']), ing('sel', 1, 'pincee', 'epicerie_salee')]);
  const avec = (produitsFoyer) => listeDeCourses(semaineAvec({ plats: { tartine: { ajouteLe: 1 } } }),
    { tousLesPlats: [semi], profils: PROFILS, produitsFoyer });
  assert.ok(avec({}).lignes.some((l) => l.produitId === 'beurre-demi-sel'));
  assert.ok(avec({}).maison.some((l) => l.produitId === 'sel'));
  const regle = avec({ 'beurre-demi-sel': { placard: { actif: true } }, sel: { placard: { actif: false } } });
  assert.ok(regle.maison.some((l) => l.produitId === 'beurre-demi-sel'), '100 g : toujours mis de côté');
  assert.ok(regle.lignes.some((l) => l.produitId === 'sel'), 'le sel, éteint, revient sur la liste');
});

test('liste : rayon changé par le foyer (sous l’id ou une clé de repli) : la ligne change de rayon en mode Magasin', () => {
  const avant = grouperParRayon(calculer(SEMAINE));
  assert.ok(avant.aAcheter.find((g) => g.rayon === 'epicerie_salee').lignes.some((l) => l.produitId === 'farine'));
  const apres = grouperParRayon(calculer(SEMAINE, { produitsFoyer: { 'farine-t55': { rayon: 'boulangerie' } } }));
  assert.ok(apres.aAcheter.find((g) => g.rayon === 'boulangerie').lignes.some((l) => l.produitId === 'farine'));
  assert.equal(apres.aAcheter.find((g) => g.rayon === 'epicerie_salee').lignes.some((l) => l.produitId === 'farine'), false);
});

// ——— Écritures des gestes de produits ———

test('ecrituresRayon : un autre rayon écrit sous le produit ; le rayon de départ efface le réglage (id et clés de repli)', () => {
  const liste = calculer(SEMAINE);
  const beurre = trouver(liste, 'beurre');
  assert.deepEqual(ecrituresRayon(beurre, 'surgeles'), { rayon: 'surgeles', ecritures: [{ id: 'beurre', champs: { rayon: 'surgeles' } }] });
  assert.deepEqual(ecrituresRayon(beurre, 'cremerie'), { rayon: 'cremerie', ecritures: [] }, 'déjà le rayon de départ : rien');
  const produitsFoyer = { beurre: { rayon: 'surgeles' } };
  const regle = trouver(calculer(SEMAINE, { produitsFoyer }), 'beurre');
  assert.deepEqual(ecrituresRayon(regle, 'surgeles', { produitsFoyer }).ecritures, [], 'déjà ce rayon : rien');
  assert.deepEqual(ecrituresRayon(regle, 'cremerie', { produitsFoyer }).ecritures, [{ id: 'beurre', champs: { rayon: EFFACER } }]);
  // Clé de repli : « farine t55 » (devenue « farine »).
  const foyerRepli = { 'farine-t55': { rayon: 'boulangerie' } };
  const farine = trouver(calculer(SEMAINE, { produitsFoyer: foyerRepli }), 'farine');
  assert.deepEqual(farine.replis, ['farine-t55']);
  assert.deepEqual(ecrituresRayon(farine, 'epicerie_salee', { produitsFoyer: foyerRepli }).ecritures,
    [{ id: 'farine-t55', champs: { rayon: EFFACER } }]);
  assert.deepEqual(ecrituresRayon(farine, 'surgeles', { produitsFoyer: foyerRepli }).ecritures, [{ id: 'farine', champs: { rayon: 'surgeles' } }]);
  // Article : un produit hors cuisine (« piles » : Divers au départ).
  const [piles] = listeDeCourses(SEMAINE, { articles: [{ id: 'a', libelle: 'piles' }] }).articles;
  assert.deepEqual(ecrituresRayon(piles, 'entretien').ecritures, [{ id: 'pile', champs: { rayon: 'entretien' } }]);
  // Refus.
  assert.deepEqual(ecrituresRayon(beurre, 'cave'), { code: 'invalide' });
  assert.deepEqual(ecrituresRayon({ produitId: 'A B' }, 'divers'), { code: 'invalide' });
  assert.deepEqual(ecrituresRayon(null, 'divers'), { code: 'invalide' });
});

test('ecrituresPlacard : éteindre un produit du départ, allumer un autre ; revenir au départ efface ; rien qui change → rien', () => {
  const beurre = { produitId: 'beurre' };
  assert.deepEqual(ecrituresPlacard(beurre, false), { actif: false, ecritures: [{ id: 'beurre', champs: { placard: { actif: false } } }] });
  assert.deepEqual(ecrituresPlacard(beurre, true), { actif: true, ecritures: [] });
  const eteint = { beurre: { placard: { actif: false } } };
  assert.deepEqual(ecrituresPlacard(beurre, true, { produitsFoyer: eteint }).ecritures, [{ id: 'beurre', champs: { placard: EFFACER } }]);
  assert.deepEqual(ecrituresPlacard(beurre, false, { produitsFoyer: eteint }).ecritures, []);
  const semi = { produitId: 'beurre-demi-sel' };
  assert.deepEqual(ecrituresPlacard(semi, true).ecritures, [{ id: 'beurre-demi-sel', champs: { placard: { actif: true } } }]);
  assert.deepEqual(ecrituresPlacard(semi, false).ecritures, []);
  const allume = { 'beurre-demi-sel': { placard: { actif: true } } };
  assert.deepEqual(ecrituresPlacard(semi, false, { produitsFoyer: allume }).ecritures, [{ id: 'beurre-demi-sel', champs: { placard: EFFACER } }]);
  // Clé de repli : le réglage rangé sous l'ancienne clé est effacé (jamais deux réglages pour un produit).
  const farine = { produitId: 'farine', replis: ['farine-t55'] };
  const sousRepli = { 'farine-t55': { placard: { actif: false } } };
  assert.deepEqual(ecrituresPlacard(farine, true, { produitsFoyer: sousRepli }).ecritures, [{ id: 'farine-t55', champs: { placard: EFFACER } }]);
  assert.deepEqual(ecrituresPlacard(farine, false, { produitsFoyer: sousRepli }).ecritures,
    [{ id: 'farine', champs: { placard: { actif: false } } }, { id: 'farine-t55', champs: { placard: EFFACER } }]);
  // Un homographe n'a pas de placard de départ ; refus.
  assert.deepEqual(ecrituresPlacard({ produitId: 'pate--pa3te1' }, true).ecritures, [{ id: 'pate--pa3te1', champs: { placard: { actif: true } } }]);
  assert.deepEqual(ecrituresPlacard({ produitId: '' }, true), { code: 'invalide' });
});

test('lireNombreSaisi : « 0,5 », « 2 », « 1.5 » ; vide → null ; illisible → NaN', () => {
  assert.equal(lireNombreSaisi('0,5'), 0.5);
  assert.equal(lireNombreSaisi(' 2 '), 2);
  assert.equal(lireNombreSaisi('1.5'), 1.5);
  assert.equal(lireNombreSaisi(',5'), 0.5);
  assert.equal(lireNombreSaisi(3), 3);
  for (const vide of ['', '   ', null, undefined]) assert.equal(lireNombreSaisi(vide), null);
  for (const faux of ['abc', '1,2,3', '-1', '2 kg', Number.NaN, Infinity]) assert.ok(Number.isNaN(lireNombreSaisi(faux)), String(faux));
});

test('ecrituresHabituel : allumer (avec ou sans quantité, nom gardé) ; erreurs ; éteindre garde la quantité ; rien qui change → rien', () => {
  const [lait] = listeDeCourses(SEMAINE, { articles: [{ id: 'a', libelle: 'lait demi-écrémé' }] }).articles;
  const avec = ecrituresHabituel(lait, { actif: true, qte: '6', unite: 'l' });
  const attendu = { actif: true, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' };
  assert.deepEqual(avec, { habituel: attendu, ecritures: [{ id: 'lait-demi-ecreme', champs: { habituel: attendu } }] });
  assert.deepEqual(ecrituresHabituel(lait, { actif: true, qte: '0,5', unite: 'l' }).habituel.qte, 0.5);
  assert.deepEqual(ecrituresHabituel(lait, { actif: true, qte: '1,234', unite: 'l' }).habituel.qte, 1.23);
  assert.deepEqual(ecrituresHabituel(lait, { actif: true, qte: '', unite: 'l' }).habituel, { actif: true, libelle: 'lait demi-écrémé' });
  assert.deepEqual(ecrituresHabituel(lait, { actif: true }).habituel, { actif: true, libelle: 'lait demi-écrémé' });
  for (const [qte, unite, erreur] of [['abc', 'l', 'quantite'], ['0', 'l', 'quantite'], ['0,001', 'l', 'quantite'], ['-2', 'l', 'quantite'],
    ['1000', 'g', 'grande'], ['2', 'litre', 'unite'], ['2', null, 'unite']]) {
    assert.deepEqual(ecrituresHabituel(lait, { actif: true, qte, unite }), { erreur }, `${qte} ${unite}`);
  }
  const produitsFoyer = { 'lait-demi-ecreme': { habituel: attendu } };
  assert.deepEqual(ecrituresHabituel(lait, { actif: true, qte: 6, unite: 'l' }, { produitsFoyer }).ecritures, [], 'rien ne change');
  const eteint = ecrituresHabituel(lait, { actif: false }, { produitsFoyer });
  assert.deepEqual(eteint, {
    habituel: { actif: false, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' },
    ecritures: [{ id: 'lait-demi-ecreme', champs: { habituel: { actif: false, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' } } }],
  });
  assert.deepEqual(ecrituresHabituel(lait, { actif: false }), { habituel: null, ecritures: [] }, 'jamais réglé : rien');
  assert.deepEqual(ERREURS_HABITUEL, { quantite: 'Écrivez un nombre plus grand que 0.', grande: '999\u00A0au plus.', unite: 'Choisissez une unité.' });
});

test('ecrituresHabituel : un habituel sous une clé de repli est effacé là ; un nom qui ne redonne pas le produit n’est pas gardé', () => {
  const farine = { produitId: 'farine', libelle: 'farine', replis: ['farine-t55'] };
  const produitsFoyer = { 'farine-t55': { habituel: { actif: true, qte: 1, unite: 'kg', libelle: 'farine t55' } } };
  assert.deepEqual(ecrituresHabituel(farine, { actif: true, qte: 2, unite: 'kg' }, { produitsFoyer }).ecritures, [
    { id: 'farine', champs: { habituel: { actif: true, qte: 2, unite: 'kg', libelle: 'farine' } } },
    { id: 'farine-t55', champs: { habituel: EFFACER } },
  ]);
  // Éteindre : la quantité d'avant (lue sous la clé de repli) est gardée.
  assert.deepEqual(ecrituresHabituel(farine, { actif: false }, { produitsFoyer }).ecritures, [
    { id: 'farine', champs: { habituel: { actif: false, qte: 1, unite: 'kg', libelle: 'farine' } } },
    { id: 'farine-t55', champs: { habituel: EFFACER } },
  ]);
  // Un nom qui donnerait un autre produit n'est pas gardé (l'habituel retrouve son produit par son nom).
  assert.deepEqual(ecrituresHabituel({ produitId: 'lait', libelle: 'lait demi-écrémé' }, { actif: true }).habituel, { actif: true });
  assert.deepEqual(ecrituresHabituel({ produitId: 'A B' }, { actif: true }), { code: 'invalide' });
});

test('aller-retour : un habituel allumé par ecrituresHabituel apparaît dans la liste, avec sa quantité', () => {
  const [article] = listeDeCourses(SEMAINE, { articles: [{ id: 'a', libelle: 'éponges' }] }).articles;
  const { ecritures } = ecrituresHabituel(article, { actif: true, qte: '3', unite: 'pc' });
  const produitsFoyer = Object.fromEntries(ecritures.map(({ id, champs }) => [id, champs]));
  const liste = listeDeCourses(SEMAINE, { tousLesPlats: [], profils: PROFILS, produitsFoyer });
  assert.deepEqual(liste.lignes.map((l) => [l.produitId, l.nom, l.rayon, l.quantite, l.chaqueSemaine]),
    [['eponge', 'Éponge', 'entretien', '3', true]]);
});

test('ecrituresPrecision : « Précision (facultatif) », 40 caractères au plus ; vide l’efface ; même texte → rien', () => {
  const [article] = listeDeCourses(SEMAINE, { articles: [{ id: 'a', libelle: 'piles' }] }).articles;
  assert.deepEqual(ecrituresPrecision(article, '  4   AA '), { articleId: 'a', champs: { precision: '4 AA' } });
  assert.deepEqual(ecrituresPrecision(article, ''), { code: 'inchange' });
  const [precise] = listeDeCourses(SEMAINE, { articles: [{ id: 'b', libelle: 'beurre', precision: '30\u00A0g' }] }).articles;
  assert.deepEqual(ecrituresPrecision(precise, ''), { articleId: 'b', champs: { precision: EFFACER } });
  assert.deepEqual(ecrituresPrecision(precise, '30\u00A0g'), { code: 'inchange' });
  assert.deepEqual(ecrituresPrecision(article, 'x'.repeat(PRECISION_MAX + 1)), { erreur: 'long' });
  assert.deepEqual(ecrituresPrecision(article, 'x'.repeat(PRECISION_MAX)).champs, { precision: 'x'.repeat(40) });
  assert.deepEqual(ecrituresPrecision({ type: 'ligne', produitId: 'beurre' }, '1'), { code: 'invalide' });
  assert.deepEqual(ERREURS_PRECISION, { long: '40\u00A0caractères au plus.' });
});

// ——— Ordre des rayons ———

test('monterRayon, descendreRayon : un cran ; au bord ou inconnu, l’ordre tel quel ; l’entrée n’est jamais modifiée', () => {
  assert.deepEqual(RAYONS_DE_DEPART, Object.keys(LIBELLES_RAYON));
  assert.equal(RAYONS_DE_DEPART.length, 14);
  const ordre = geler([...RAYONS_DE_DEPART]);
  const monte = monterRayon(ordre, 'cremerie');
  assert.deepEqual(monte.slice(2, 5), ['charcuterie', 'cremerie', 'poissonnerie']);
  assert.deepEqual(descendreRayon(monte, 'cremerie'), [...RAYONS_DE_DEPART]);
  assert.deepEqual(monterRayon(ordre, 'fruits_legumes'), [...RAYONS_DE_DEPART]);
  assert.deepEqual(descendreRayon(ordre, 'divers'), [...RAYONS_DE_DEPART]);
  assert.deepEqual(monterRayon(ordre, 'cave'), [...RAYONS_DE_DEPART]);
  assert.notEqual(monterRayon(ordre, 'cave'), ordre);
  // Un ordre partiel du foyer est complété avant de bouger.
  assert.deepEqual(deplacerRayon(['divers'], 'divers', 1).slice(0, 2), ['fruits_legumes', 'divers']);
  assert.equal(texteDeplacerRayon('cremerie', -1), 'Monter «\u00A0Crèmerie\u00A0»');
  assert.equal(texteDeplacerRayon('cremerie', 1), 'Descendre «\u00A0Crèmerie\u00A0»');
});

test('ecrituresRayons : la liste entière ; l’ordre de départ efface le réglage ; le même ordre → rien ; illisible → refus', () => {
  const ordre = monterRayon(RAYONS_DE_DEPART, 'cremerie');
  assert.deepEqual(ecrituresRayons(ordre, { reglages: null }), { champs: { rayons: ordre } });
  assert.deepEqual(ecrituresRayons(ordre, { reglages: { rayons: ordre } }), { code: 'inchange' });
  assert.deepEqual(ecrituresRayons([...RAYONS_DE_DEPART], { reglages: { rayons: ordre } }), { champs: { rayons: EFFACER } });
  assert.deepEqual(ecrituresRayons([...RAYONS_DE_DEPART], { reglages: {} }), { code: 'inchange' });
  assert.deepEqual(ecrituresRayons(['boissons', 'cave', 'boissons']).champs.rayons,
    ['boissons', ...RAYONS_DE_DEPART.filter((r) => r !== 'boissons')]);
  // Un ordre partiel enregistré est réécrit en entier.
  assert.deepEqual(ecrituresRayons(['boissons'], { reglages: { rayons: ['boissons'] } }).champs.rayons.length, 14);
  assert.deepEqual(ecrituresRayons([]), { code: 'invalide' });
  assert.deepEqual(ecrituresRayons('boissons'), { code: 'invalide' });
  assert.ok(champsValides(ecrituresRayons(ordre).champs));
});

test('liste : l’ordre des rayons du foyer range les lignes et les articles (mode Magasin)', () => {
  const reglages = { rayons: ['divers', 'cremerie'] };
  const liste = calculer(SEMAINE, { produitsFoyer: FOYER, reglages });
  assert.deepEqual(grouperParRayon(liste, { rayons: ['divers', 'cremerie', ...RAYONS_DE_DEPART.filter((r) => !['divers', 'cremerie'].includes(r))] })
    .aAcheter.map((g) => g.rayon), ['divers', 'cremerie', 'epicerie_salee']);
  assert.deepEqual(liste.lignes.map((l) => l.rayon).filter((r, i, t) => t.indexOf(r) === i), ['divers', 'cremerie', 'epicerie_salee']);
});

// ——— Récents ———

test('récents : le plus récent d’abord, un par produit, 8 au plus ; illisibles ignorés ; clé par compte', () => {
  assert.equal(RECENTS_MAX, 8);
  assert.equal(cleRecents(' uid-1 '), 'repas-courses:recents:uid-1');
  assert.equal(cleRecents(''), '');
  assert.equal(cleRecents(null), '');
  let recents = ajouterAuxRecents([], 'Piles');
  recents = ajouterAuxRecents(recents, 'lait');
  assert.deepEqual(recents, ['lait', 'Piles']);
  assert.deepEqual(ajouterAuxRecents(recents, 'piles'), ['piles', 'lait'], 'même produit : remonté, jamais doublé');
  assert.deepEqual(ajouterAuxRecents(recents, '   '), recents);
  assert.deepEqual(ajouterAuxRecents(recents, 'x'.repeat(61)), recents);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) recents = ajouterAuxRecents(recents, `article ${n}`);
  assert.equal(recents.length, RECENTS_MAX);
  assert.equal(recents[0], 'article 9');
  assert.deepEqual(lireRecents(JSON.stringify(['lait', 'Lait', 3, '', 'piles'])), ['lait', 'piles']);
  for (const illisible of ['pas du json', null, undefined, '{"a":1}', 42]) assert.deepEqual(lireRecents(illisible), [], String(illisible));
});

// ——— Carte « 🏠 Placard » de Réglages et textes ———

test('textePlacard : « Toujours mis de côté. » ; « Mis de côté si la semaine en demande 30 g au plus. »', () => {
  assert.equal(textePlacard({}), 'Toujours mis de côté.');
  assert.equal(textePlacard({ seuil: 30, unite: 'g' }), 'Mis de côté si la semaine en demande 30\u00A0g au plus.');
  assert.equal(textePlacard({ seuil: 6, unite: 'cs' }), 'Mis de côté si la semaine en demande 6\u00A0c. à soupe au plus.');
  assert.equal(textePlacard({ seuil: 10, unite: 'cl' }), 'Mis de côté si la semaine en demande 10\u00A0cl au plus.');
  assert.equal(textePlacard({ seuil: 1, unite: 'sachet' }), 'Mis de côté si la semaine en demande 1\u00A0sachet au plus.');
  assert.equal(textePlacard({ seuil: 2, unite: 'pc' }), 'Mis de côté si la semaine en demande 2\u00A0pièces au plus.');
  assert.equal(textePlacard({ seuil: 1, unite: 'pc' }), 'Mis de côté si la semaine en demande 1\u00A0pièce au plus.');
  assert.equal(textePlacard(null), '');
  // L'ail se compte en gousses (§9 : « Ail | 2 gousses ») : jamais « 2 pièces », qu'on lirait « 2 têtes ».
  assert.equal(textePlacard({ seuil: 2, unite: 'pc' }, { produitId: 'ail' }), 'Mis de côté si la semaine en demande 2\u00A0gousses au plus.');
  assert.equal(textePlacard({ seuil: 1, unite: 'pc' }, { produitId: 'ail' }), 'Mis de côté si la semaine en demande 1\u00A0gousse au plus.');
  assert.equal(textePlacard({ seuil: 30, unite: 'g' }, { produitId: 'ail' }), 'Mis de côté si la semaine en demande 30\u00A0g au plus.');
  assert.equal(placardDuFoyer({ ail: { placard: { actif: true } } })[0].texte, 'Mis de côté si la semaine en demande 2\u00A0gousses au plus.');
  const ail = calculer(semaineAvec({ plats: { pistou: { ajouteLe: 1 } } }), {
    tousLesPlats: [plat('pistou', 'Pistou', [ing('ail', 1, 'pc', 'fruits_legumes', ['legume'])])],
  }).maison.find((l) => l.produitId === 'ail');
  assert.equal(textePlacard(ail.placardProduit, { produitId: ail.produitId }), 'Mis de côté si la semaine en demande 2\u00A0gousses au plus.');
});

test('placard du foyer : le nom de la ligne est gardé avec le réglage ; la carte « 🏠 Placard » le montre quand plus aucune recette ne le porte', () => {
  const tofu = plat('poelee', 'Poêlée', [ing('tofu fumé maison', 200, 'g', 'cremerie')]);
  const liste = listeDeCourses(semaineAvec({ plats: { poelee: { ajouteLe: 1 } } }), { tousLesPlats: [tofu], profils: PROFILS });
  const ligne = liste.lignes.find((l) => l.produitId === 'tofu-fume-maison');
  const r = ecrituresPlacard(ligne, true);
  assert.deepEqual(r.ecritures, [{ id: 'tofu-fume-maison', champs: { placard: { actif: true, libelle: 'tofu fumé maison' } } }]);
  const produitsFoyer = { 'tofu-fume-maison': r.ecritures[0].champs };
  // La recette a changé : plus aucun plat ne porte ce nom ; la carte garde ses accents.
  assert.deepEqual(placardDuFoyer(produitsFoyer).map((p) => p.nom), ['Tofu fumé maison']);
  // « pâte » (nom ambigu) : jamais « Pate ».
  assert.deepEqual(placardDuFoyer({ 'pate--pa3te': { placard: { actif: true, libelle: 'pâte' } } }).map((p) => p.nom), ['Pâte']);
  // Un nom qui ne redonne pas le produit n'est pas gardé ; Réglages ({ produitId }) garde celui d'avant.
  assert.deepEqual(ecrituresPlacard({ produitId: 'tofu-fume-maison', libelle: 'autre chose' }, true).ecritures[0].champs.placard,
    { actif: true });
  const eteint = ecrituresPlacard({ produitId: 'beurre' }, false, { produitsFoyer: { beurre: { placard: { actif: true, libelle: 'beurre' } } } });
  assert.deepEqual(eteint.ecritures, [{ id: 'beurre', champs: { placard: { actif: false, libelle: 'beurre' } } }]);
  // Un nom illisible est omis à la lecture, jamais bloquant.
  assert.deepEqual(placardDuFoyer({ beurre: { placard: { actif: false, libelle: 42 } } }).map((p) => [p.nom, p.actif]), [['Beurre', false]]);
});

test('« Pas cette semaine » se lit sous chaque clé de l’habituel (id, document, clé de repli) ; « remettre » les efface toutes', () => {
  // Posé quand le nom était inconnu, sous `papier-hygienique` ; l'app reconnaît ensuite « papier hygiénique » comme papier toilette.
  const foyer = { 'papier-hygienique': { habituel: { actif: true, libelle: 'papier hygiénique' } } };
  const semaine = semaineAvec({ sansHabituel: { 'papier-hygienique': true } });
  const [habituel] = habituelsDuFoyer(foyer, semaine);
  assert.deepEqual([habituel.produitId, habituel.cle, habituel.saute], ['papier-toilette', 'papier-hygienique', true]);
  assert.ok(habituel.cles.includes('papier-hygienique'));
  const liste = calculer(semaine, { produitsFoyer: foyer });
  assert.equal(liste.lignes.some((l) => l.produitId === 'papier-toilette'), false, 'toujours sauté cette semaine');
  // Remettre : le chemin de l'id et celui de l'ancienne clé.
  const r = ecrituresSansHabituel(semaine, habituel.produitId, false, { cles: habituel.cles });
  assert.deepEqual(r.champs, { 'sansHabituel.papier-toilette': EFFACER, 'sansHabituel.papier-hygienique': EFFACER });
  assert.ok(champsValides(r.champs));
  const remis = calculer(appliquerChamps(semaine, r.champs), { produitsFoyer: foyer });
  assert.equal(remis.lignes.some((l) => l.produitId === 'papier-toilette'), true);
  // Sauter : un seul chemin, sous l'id.
  assert.deepEqual(ecrituresSansHabituel(SEMAINE, 'papier-toilette', true, { cles: habituel.cles }).champs,
    { 'sansHabituel.papier-toilette': true });
});

test('placardDuFoyer : les produits réglés par le foyer, mis de côté ou éteints, triés par nom ; jamais tout le placard de départ', () => {
  const produitsFoyer = {
    beurre: { placard: { actif: false } },
    'beurre-demi-sel': { placard: { actif: true } },
    'croquette-pour-chat': { placard: { actif: true } },
    farine: { placard: { actif: true } },
    pate: { rechercheDrive: 'penne' },
    sel: { placard: { actif: 'non' } },
  };
  assert.deepEqual(placardDuFoyer(produitsFoyer), [
    { produitId: 'beurre', nom: 'Beurre', actif: false, deDepart: true, texte: '' },
    { produitId: 'beurre-demi-sel', nom: 'Beurre demi-sel', actif: true, deDepart: false, texte: 'Toujours mis de côté.' },
    { produitId: 'croquette-pour-chat', nom: 'Croquette pour chat', actif: true, deDepart: false, texte: 'Toujours mis de côté.' },
    { produitId: 'farine', nom: 'Farine', actif: true, deDepart: true, texte: 'Mis de côté si la semaine en demande 50\u00A0g au plus.' },
  ]);
  assert.deepEqual(placardDuFoyer({}), []);
  assert.deepEqual(placardDuFoyer(new Map([['beurre', { placard: { actif: false } }]])).map((p) => p.produitId), ['beurre']);
  // Une ligne de Réglages s'écrit comme la feuille ⋮ : { produitId }.
  assert.deepEqual(ecrituresPlacard({ produitId: 'beurre' }, true, { produitsFoyer }).ecritures, [{ id: 'beurre', champs: { placard: EFFACER } }]);
});

test('texteRayon, texteChaqueSemaineAussi, TEXTES_T3D : textes exacts, sans mot technique', () => {
  assert.equal(texteRayon('epicerie_salee'), 'Rayon\u00A0: Épicerie salée');
  assert.equal(texteRayon('cave'), 'Rayon\u00A0: Divers');
  assert.equal(texteChaqueSemaineAussi([{ nom: 'Yaourts maison' }]), 'Chaque semaine aussi\u00A0: Yaourts maison');
  assert.equal(texteChaqueSemaineAussi(preparationsChaqueSemaine(SEMAINE, { tousLesPlats: TOUS })),
    'Chaque semaine aussi\u00A0: Pain maison et Yaourts maison');
  assert.equal(texteChaqueSemaineAussi([]), '');
  assert.deepEqual(TEXTES_T3D, {
    changer: 'Changer',
    suivantes: 'Il servira les semaines suivantes.',
    placard: 'Toujours dans mon placard',
    toujours: 'Toujours mis de côté.',
    habituel: 'À acheter chaque semaine',
    quantite: 'Quantité (facultatif)',
    pasCetteSemaine: 'Pas cette semaine',
    precision: 'Précision (facultatif)',
    commeChaqueSemaine: 'Comme chaque semaine',
    chaqueSemaineAussi: 'Chaque semaine aussi',
    ordreRayons: 'Ordre des rayons',
    ordreDeDepart: 'Remettre l’ordre de départ',
    enregistrer: 'Enregistrer',
    recents: 'Récents',
    placardReglages: '🏠 Placard',
    // Relecture de T3d.
    misDeCote: 'Mis de côté',
    achete: 'Acheté quand vos plats en demandent.',
    aideOrdre: 'Touchez un rayon, puis montez-le ou descendez-le.',
    monter: 'Monter',
    descendre: 'Descendre',
  });
  for (const texte of [...Object.values(TEXTES_T3D), ...Object.values(ERREURS_HABITUEL), textePlacard({ seuil: 30, unite: 'g' })]) {
    assert.equal(/paquet|slug|json|\bIA\b|dictionnaire|catalogue|habituel|hebdo/i.test(texte), false, texte);
  }
});

// ——— Pureté et déterminisme ———

test('liste : habituels et préparations ne dépendent ni de l’ordre des plats ni de celui des produits du foyer ; entrées intactes', () => {
  const reference = JSON.stringify(calculer(SEMAINE, { produitsFoyer: FOYER }).lignes);
  for (let graine = 1; graine <= 5; graine += 1) {
    const plats = melanger([...TOUS], graine);
    const foyer = Object.fromEntries(melanger(Object.entries(FOYER), graine));
    assert.equal(JSON.stringify(listeDeCourses(SEMAINE, { tousLesPlats: plats, profils: PROFILS, produitsFoyer: foyer }).lignes), reference);
  }
  const gele = geler(structuredClone({ semaine: semaineAvec({ sansHebdo: { 'pain-maison': true }, sansHabituel: { pile: true } }), tous: TOUS, foyer: FOYER }));
  listeDeCourses(gele.semaine, { tousLesPlats: gele.tous, profils: PROFILS, produitsFoyer: gele.foyer, reglages: geler({ rayons: ['divers'] }) });
  ecrituresHabituel(geler({ produitId: 'beurre', libelle: 'beurre' }), { actif: false }, { produitsFoyer: gele.foyer });
  ecrituresPlacard(geler({ produitId: 'beurre' }), false, { produitsFoyer: gele.foyer });
  placardDuFoyer(gele.foyer);
  habituelsDuFoyer(gele.foyer, gele.semaine);
});
