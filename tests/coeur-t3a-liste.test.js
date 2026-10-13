// T3a « La semaine et sa liste » : coeur/liste.js (familles d'unités, arrondis d'achat, placard, coches qui retiennent
// ce qui a été pris, liste calculée : versions servies et ce qu'elles retirent, articles ajoutés à la main, ordre,
// pureté et déterminisme ; écran Courses, textes, restes, carte « prochaine action »). Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireRegime } from '../js/coeur/regles.js';
import { BAREME_AGE, regleDuPalier } from '../js/coeur/age.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { melanger } from '../js/coeur/notes.js';
import { cleDeRepli, indexDesRecettes } from '../js/coeur/produits.js';
import { platsDeLaSemaine } from '../js/coeur/semaine.js';
import {
  ARTICLE_MAX, EQUIVALENCES, ERREURS_ARTICLE, FAMILLES, TOLERANCE, arrondiAchat, bandeauxCourses, carteProchaineAction,
  dansLePlacard, texteAjoutArticle,
  ecrituresCoche, ecrituresCocheArticle, ecrituresRachat, etatCoche, grouperParRayon, listeDeCourses, ordreRayons,
  phraseRestes, preparerAjout, reglagesCourses, restes, texteDejaPris, texteOrigine, texteQuantites, texteSource,
  valeurCoche, versBase, phraseRestesAjoutes,
} from '../js/coeur/liste.js';
import { EFFACER, appliquerChamps, champsValides } from '../js/coeur/semaine.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const MIEL = regleDuPalier(BAREME_AGE.find((e) => e.code === 'miel'), 0);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [MIEL] };
const PROFILS = [A, B, E];

const ing = (produit, qte, unite, rayon, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon, marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, rayon, marqueurs = []) => ({ produit, qtePortion, unite, rayon, marqueurs });
const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Cuire.'], ...extra,
});

const JAMBON = ing('jambon blanc', 4, 'tranche', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'fine' });
const MER = {
  pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['jambon blanc'],
  ajouter: [ajout('thon au naturel', 50, 'g', 'epicerie_salee', ['poisson'])], consigne: 'Part au thon.',
};
const VEGETALE = {
  pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'],
  ajouter: [ajout('tofu fumé', 60, 'g', 'cremerie', ['soja']), ajout('crème fraîche épaisse', 2, 'cl', 'cremerie', ['laitier'])],
  consigne: 'Part au tofu.',
};
const GRATIN = plat('gratin-pates-jambon', 'Gratin de pâtes au jambon', [
  ing('pâtes courtes', 400, 'g', 'epicerie_salee', ['feculent']),
  JAMBON,
  ing('crème fraîche épaisse', 20, 'cl', 'cremerie', ['laitier']),
  ing('gruyère râpé', 100, 'g', 'fromages', ['laitier']),
], { variantes: [MER, VEGETALE] });
const SALADE = plat('salade-pates', 'Salade de pâtes', [
  ing('pâtes', 200, 'g', 'epicerie_salee', ['feculent']),
  ing('tomate', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
  ing("huile d'olive", 2, 'cs', 'epicerie_salee'),
  ing('sel', 1, 'pincee', 'epicerie_salee'),
], { portionsBase: 2 });
const TARTE = { id: 'tarte-poireaux', nom: 'Tarte aux poireaux' };
const JETE = { ...plat('jete', 'Plat jeté', [ing('riz', 100, 'g', 'epicerie_salee')]), corbeille: { le: 1, par: 'x@exemple.fr' } };
const TOUS = [GRATIN, SALADE, TARTE, JETE];

const H = (iso) => new Date(iso).getTime();
const CREEE = H('2026-10-10T09:00:00+02:00');
const S1 = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: CREEE };
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
const semaineAvec = (plats, extra = {}) => ({ ...S1, plats, ...extra });
const SEMAINE = semaineAvec({ 'gratin-pates-jambon': dans(1), 'salade-pates': dans(2) });
const calculer = (semaine, extra = {}) => listeDeCourses(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer, ...extra });
const ligne = (liste, produitId) => [...liste.lignes, ...liste.maison].find((l) => l.produitId === produitId);
/** Un adulte seul et des recettes pour 2 : 2 repas, la recette telle quelle (facteur 1). */
const SOLO = [A];
const telle = (id, ingredients, extra = {}) => plat(id, `Plat ${id}`, ingredients, { portionsBase: 2, ...extra });
const listeSolo = (...plats) => listeDeCourses(semaineAvec(Object.fromEntries(plats.map((p, i) => [p.id, dans(i + 1)]))),
  { tousLesPlats: plats, profils: SOLO });

function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

// ——— Familles et arrondis ———

test('versBase : familles et facteurs (g↔kg, ml↔cl↔l, une famille par autre unité) ; illisible → null', () => {
  assert.deepEqual(versBase(1.3, 'kg'), { famille: 'masse', qte: 1300 });
  assert.deepEqual(versBase(20, 'cl'), { famille: 'volume', qte: 200 });
  assert.deepEqual(versBase(0.5, 'l'), { famille: 'volume', qte: 500 });
  assert.deepEqual(versBase(2, 'cs'), { famille: 'cs', qte: 2 });
  assert.deepEqual(versBase(3, 'tranche'), { famille: 'tranche', qte: 3 });
  for (const [qte, unite] of [[0, 'g'], [-1, 'g'], ['3', 'g'], [Number.NaN, 'g'], [1, 'gousse'], [1, undefined], [1, 'toString']]) {
    assert.equal(versBase(qte, unite), null, `${qte} ${unite}`);
  }
  assert.deepEqual(Object.keys(FAMILLES).sort(), ['boite', 'botte', 'cc', 'cl', 'cs', 'g', 'kg', 'l', 'ml', 'pc', 'pincee', 'sachet', 'tranche']);
  assert.deepEqual(EQUIVALENCES, { pincee: { g: 0.5 }, cc: { g: 5, ml: 5 }, cs: { g: 15, ml: 15 } });
});

test('arrondiAchat : masse (1 g sous 10, 5 g jusqu’à 100, 10 g, puis kg au dixième), toujours au supérieur, tolérant', () => {
  const cas = [[0.4, 1, 'g'], [2, 2, 'g'], [9.2, 10, 'g'], [10, 10, 'g'], [12, 15, 'g'], [100, 100, 'g'], [100.2, 110, 'g'],
    [110.00000000000001, 110, 'g'], [100 * 1.1, 110, 'g'], [583, 590, 'g'], [995, 1, 'kg'], [1000, 1, 'kg'],
    [1250, 1.3, 'kg'], [1300, 1.3, 'kg'], [1301, 1.4, 'kg'], [2000.0000001, 2, 'kg']];
  for (const [qte, attendu, unite] of cas) assert.deepEqual(arrondiAchat('masse', qte), { qte: attendu, unite }, String(qte));
});

test('arrondiAchat : volume (ml, cl entiers, l au dixième), pièces entières, cuillères à la demie', () => {
  const volume = [[3, 3, 'ml'], [12, 15, 'ml'], [100, 100, 'ml'], [250, 25, 'cl'], [251, 26, 'cl'], [1600, 1.6, 'l'], [999, 1, 'l']];
  for (const [qte, attendu, unite] of volume) assert.deepEqual(arrondiAchat('volume', qte), { qte: attendu, unite }, String(qte));
  assert.deepEqual(arrondiAchat('pc', 1.25), { qte: 2, unite: 'pc' });
  assert.deepEqual(arrondiAchat('pc', 2.0000000001), { qte: 2, unite: 'pc' });
  assert.deepEqual(arrondiAchat('tranche', 3), { qte: 3, unite: 'tranche' });
  assert.deepEqual(arrondiAchat('pincee', 1.25), { qte: 2, unite: 'pincee' });
  assert.deepEqual(arrondiAchat('cs', 2.2), { qte: 2.5, unite: 'cs' });
  assert.deepEqual(arrondiAchat('cc', 0.3), { qte: 0.5, unite: 'cc' });
  assert.deepEqual(arrondiAchat('cs', 2.5), { qte: 2.5, unite: 'cs' });
  assert.equal(TOLERANCE, 1e-9);
});

test('texteQuantites : unités réunies par famille, « + » entre familles ; pièces sans unité ; vide → \'\'', () => {
  assert.equal(texteQuantites({ masse: 1300 }), '1,3\u00A0kg');
  assert.equal(texteQuantites({ volume: 250 }), '25\u00A0cl');
  assert.equal(texteQuantites({ volume: 1600 }), '1,6\u00A0l');
  assert.equal(texteQuantites({ cs: 2, masse: 230 }), '230\u00A0g + 2\u00A0c. à soupe');
  assert.equal(texteQuantites({ pc: 3 }), '3');
  assert.equal(texteQuantites({ tranche: 1 }), '1\u00A0tranche');
  assert.equal(texteQuantites({ pincee: 2, pc: 1.25 }), '2 + 2\u00A0pincées');
  assert.equal(texteQuantites({}), '');
  assert.equal(texteQuantites(null), '');
  assert.equal(texteQuantites({ masse: 0, volume: -1 }), '');
});

// ——— Réglages des courses ———

test('reglagesCourses : rayons de départ ; ordre du foyer, inconnus et doublons ignorés, manquants ajoutés à la fin', () => {
  const depart = reglagesCourses(null);
  assert.deepEqual(depart.rayons.slice(0, 3), ['fruits_legumes', 'boucherie', 'charcuterie']);
  assert.equal(depart.rayons.length, 14);
  assert.equal(depart.drive, null);
  assert.deepEqual(depart.apero, { incontournables: [] });
  const foyer = reglagesCourses({ rayons: ['epicerie_salee', 'inconnu', 'cremerie', 'epicerie_salee'] });
  assert.deepEqual(foyer.rayons.slice(0, 3), ['epicerie_salee', 'cremerie', 'fruits_legumes']);
  assert.equal(foyer.rayons.length, 14);
  assert.equal(new Set(foyer.rayons).size, 14);
  assert.deepEqual(ordreRayons({ rayons: 'pas une liste' }), depart.rayons);
});

// ——— Placard ———

test('dansLePlacard : sans seuil → toujours ; seuil compris ; au-dessus → sur la liste', () => {
  assert.equal(dansLePlacard({ pincee: 40 }, {}), true);
  assert.equal(dansLePlacard({}, {}), true, 'toujours mis de côté, même sans quantité');
  const beurre = { seuil: 30, unite: 'g' };
  assert.equal(dansLePlacard({ masse: 30 }, beurre), true);
  assert.equal(dansLePlacard({ masse: 30.0000000001 }, beurre), true, 'tolérance');
  assert.equal(dansLePlacard({ masse: 31 }, beurre), false);
  assert.equal(dansLePlacard({ cs: 2 }, beurre), true, '2 c. à soupe ≈ 30 g');
  assert.equal(dansLePlacard({ masse: 10, cs: 1.5 }, beurre), false, '10 g + 22,5 g');
});

test('dansLePlacard : seuil en pièces, gousses en g, cubes en cl, pincées et cuillères ; sans équivalence → sur la liste', () => {
  assert.equal(dansLePlacard({ pc: 4 }, { seuil: 4, unite: 'pc' }), true, 'seuil en pièces');
  assert.equal(dansLePlacard({ pc: 5 }, { seuil: 4, unite: 'pc' }), false);
  assert.equal(dansLePlacard({ cc: 1 }, { seuil: 4, unite: 'pc' }), false, 'pièces contre cuillère : rien ne les relie');
  const ail = { pc: { qte: 5, unite: 'g' } };
  assert.equal(dansLePlacard({ masse: 10 }, { seuil: 2, unite: 'pc' }, ail), true);
  assert.equal(dansLePlacard({ masse: 15 }, { seuil: 2, unite: 'pc' }, ail), false);
  assert.equal(dansLePlacard({ masse: 10 }, { seuil: 2, unite: 'pc' }), false, 'sans l’équivalence du produit');
  const cube = { pc: { qte: 500, unite: 'ml' } };
  assert.equal(dansLePlacard({ volume: 500 }, { seuil: 2, unite: 'pc' }, cube), true);
  assert.equal(dansLePlacard({ volume: 1500 }, { seuil: 2, unite: 'pc' }, cube), false);
  assert.equal(dansLePlacard({ pincee: 3 }, { seuil: 2, unite: 'cc' }), true, 'pincées : 1,5 g pour 10 g');
  assert.equal(dansLePlacard({ masse: 50 }, { seuil: 2, unite: 'cs' }), false, 'chapelure : 50 g pour 30 g');
  assert.equal(dansLePlacard({ volume: 50 }, { seuil: 4, unite: 'cs' }), true, '50 ml pour 60 ml');
  assert.equal(dansLePlacard({ sachet: 1 }, { seuil: 1, unite: 'sachet' }, { sachet: { qte: 11, unite: 'g' } }), true);
  assert.equal(dansLePlacard({ masse: 12 }, { seuil: 1, unite: 'sachet' }, { sachet: { qte: 11, unite: 'g' } }), false);
});

test('dansLePlacard : comparaison impossible → faux (dans le doute, on l’achète)', () => {
  assert.equal(dansLePlacard({}, { seuil: 30, unite: 'g' }), false, 'sans quantité');
  assert.equal(dansLePlacard({ masse: 1 }, { seuil: 0, unite: 'g' }), false);
  assert.equal(dansLePlacard({ masse: 1 }, { seuil: 30, unite: 'gousse' }), false);
  assert.equal(dansLePlacard({ masse: 1 }, null), false);
  assert.equal(dansLePlacard({ masse: 1 }, 'oui'), false);
  assert.equal(dansLePlacard({ masse: 1 }, { seuil: 30, unite: 'g' }, { pc: 'x', g: { qte: 1, unite: 'pc' } }), true);
});

// ——— Coches ———

test('etatCoche : cochée tant que le total ne dépasse pas ce qui a été pris ; sinon « Déjà pris » et le reste', () => {
  const pris = { q: { masse: 600 }, le: 1 };
  assert.deepEqual(etatCoche({ masse: 600 }, pris), { cochee: true, dejaPris: null, reste: null });
  assert.deepEqual(etatCoche({ masse: 500 }, pris), { cochee: true, dejaPris: null, reste: null });
  assert.deepEqual(etatCoche({ masse: 600.0000000001 }, pris), { cochee: true, dejaPris: null, reste: null });
  assert.deepEqual(etatCoche({ masse: 800 }, pris), { cochee: false, dejaPris: { masse: 600 }, reste: { masse: 200 } });
  assert.equal(texteDejaPris({ dejaPris: { masse: 600 }, reste: { masse: 200 } }), 'Déjà pris\u00A0: 600\u00A0g · encore 200\u00A0g');
  // Une famille nouvelle (des cuillères en plus) : à racheter.
  assert.deepEqual(etatCoche({ masse: 600, cs: 2 }, pris), { cochee: false, dejaPris: { masse: 600 }, reste: { cs: 2 } });
  assert.deepEqual(etatCoche({ masse: 600 }, null), { cochee: false, dejaPris: null, reste: null });
  assert.deepEqual(etatCoche({ masse: 600 }, { q: {}, le: 1 }), { cochee: false, dejaPris: null, reste: null });
  assert.deepEqual(etatCoche({}, { q: {}, le: 1 }), { cochee: true, dejaPris: null, reste: null }, 'ligne sans quantité cochée');
});

test('valeurCoche : la quantité AFFICHÉE au moment de cocher (583 g → 590, 1 250 g → 1 300, 1,25 pièce → 2)', () => {
  assert.deepEqual(valeurCoche({ masse: 583 }, 7), { q: { masse: 590 }, le: 7 });
  assert.deepEqual(valeurCoche({ masse: 1250, cs: 2.2 }, 7), { q: { masse: 1300, cs: 2.5 }, le: 7 });
  assert.deepEqual(valeurCoche({ volume: 1650 }, 7), { q: { volume: 1700 }, le: 7 });
  assert.deepEqual(valeurCoche({}, 7), { q: {}, le: 7 });
  assert.deepEqual(valeurCoche({ pc: 1 }), { q: { pc: 1 } }, 'heure illisible : omise, jamais undefined');
  // 1,25 oignon affiché « 2 », coché : le total passe à 1,5 → toujours coché ; à 2,2 → « Déjà pris : 2 · encore 1 ».
  const coche = valeurCoche({ pc: 1.25 }, 7);
  assert.deepEqual(coche.q, { pc: 2 });
  assert.equal(etatCoche({ pc: 1.5 }, coche).cochee, true);
  const etat = etatCoche({ pc: 2.2 }, coche);
  assert.equal(etat.cochee, false);
  assert.equal(texteDejaPris(etat), 'Déjà pris\u00A0: 2 · encore 1');
});

// ——— La liste ———

test('liste : gratin (tout le monde, 2 repas, 5 portions) et salade ; version mer de B : 3 tranches de jambon, 100 g de thon', () => {
  const liste = calculer(SEMAINE);
  const resume = Object.fromEntries(liste.lignes.map((l) => [l.produitId, [l.nom, l.quantite, l.rayon]]));
  assert.deepEqual(resume, {
    tomate: ['Tomate', '3', 'fruits_legumes'],
    'jambon-blanc': ['Jambon blanc', '3\u00A0tranches', 'charcuterie'],
    'creme-fraiche-epaisse': ['Crème fraîche épaisse', '25\u00A0cl', 'cremerie'],
    'gruyere-rape': ['Gruyère râpé', '130\u00A0g', 'fromages'],
    pate: ['Pâtes', '750\u00A0g', 'epicerie_salee'],
    'thon-au-naturel': ['Thon au naturel', '100\u00A0g', 'epicerie_salee'],
  });
  assert.deepEqual(liste.lignes.map((l) => l.produitId),
    ['tomate', 'jambon-blanc', 'creme-fraiche-epaisse', 'gruyere-rape', 'pate', 'thon-au-naturel'], 'par rayon, puis par nom');
  assert.deepEqual(ligne(liste, 'jambon-blanc').totaux, { tranche: 3 });
  assert.deepEqual(ligne(liste, 'pate').totaux, { masse: 750 });
  assert.deepEqual(ligne(liste, 'pate').sources, [
    { type: 'plat', platId: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', totaux: { masse: 500 } },
    { type: 'plat', platId: 'salade-pates', nom: 'Salade de pâtes', totaux: { masse: 250 } },
  ]);
  assert.deepEqual(ligne(liste, 'thon-au-naturel').sources, [
    { type: 'plat', platId: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', pour: 'profil-b', style: 'mer', totaux: { masse: 100 } },
  ]);
  assert.deepEqual(liste.maison.map((l) => [l.produitId, l.quantite]), [['huile-d-olive', '2,5\u00A0c. à soupe'], ['sel', '2\u00A0pincées']]);
  assert.deepEqual([liste.sansRecette, liste.horsListe, liste.sansPortion, liste.aVerifier, liste.articles], [[], [], [], [], []]);
});

test('liste : forme d’une ligne (clé = produit, recherche = nom, ni coche ni placard)', () => {
  const pates = ligne(calculer(SEMAINE), 'pate');
  assert.deepEqual(pates, {
    type: 'ligne', cle: 'pate', produitId: 'pate', repli: null, replis: [], nom: 'Pâtes', libelle: 'pâtes', rayon: 'epicerie_salee',
    totaux: { masse: 750 }, quantite: '750\u00A0g', sources: pates.sources, placard: false, rachetee: false,
    cochee: false, dejaPris: null, reste: null, recherche: 'pâtes', rechercheFoyer: null, // T3b : aucun mot du foyer
    // T3d : une ligne des plats ; réglages du produit pour la feuille ⋮ (aucun du foyer ici).
    chaqueSemaine: false, rayonDeDepart: 'epicerie_salee', rayonDuFoyer: false, placardProduit: null, placardDuFoyer: false,
    habituel: null, habituelSaute: false,
  });
});

test('liste : version végétale choisie → le tofu à la place du thon ; la crème de la version s’ajoute (deux sources)', () => {
  const liste = calculer(semaineAvec({ 'gratin-pates-jambon': dans(1, { styles: { 'profil-b': 'vegetal' } }) }));
  assert.equal(ligne(liste, 'thon-au-naturel'), undefined);
  assert.equal(ligne(liste, 'tofu-fume').quantite, '120\u00A0g');
  const creme = ligne(liste, 'creme-fraiche-epaisse');
  assert.deepEqual(creme.totaux, { volume: 290 });
  assert.equal(creme.quantite, '29\u00A0cl');
  assert.deepEqual(creme.sources.map((s) => [s.pour ?? null, s.totaux]), [[null, { volume: 250 }], ['profil-b', { volume: 40 }]]);
  assert.deepEqual(ligne(liste, 'jambon-blanc').totaux, { tranche: 3 });
});

test('liste : seule la version servie compte ; sans version, B ne mange pas : sa part n’est pas achetée', () => {
  const sansVersion = { ...GRATIN, variantes: [] };
  const liste = listeDeCourses(semaineAvec({ 'gratin-pates-jambon': dans(1) }), { tousLesPlats: [sansVersion], profils: PROFILS, evaluer });
  // A et Enfant : 1,5 part, 3 repas, 4,5 portions → facteur 1,125.
  assert.deepEqual(ligne(liste, 'jambon-blanc').totaux, { tranche: 4.5 });
  assert.equal(ligne(liste, 'jambon-blanc').quantite, '5\u00A0tranches');
  assert.deepEqual(ligne(liste, 'pate').totaux, { masse: 450 });
  assert.equal(ligne(liste, 'thon-au-naturel'), undefined);
});

test('liste : une version qui retire un produit absent de la recette n’a aucun effet ; tout retiré → aucune ligne', () => {
  const autre = { ...GRATIN, variantes: [{ ...MER, retirer: ['jambon blanc', 'lardons'] }] };
  const liste = listeDeCourses(semaineAvec({ 'gratin-pates-jambon': dans(1) }), { tousLesPlats: [autre], profils: PROFILS });
  assert.deepEqual(ligne(liste, 'jambon-blanc').totaux, { tranche: 3 });
  assert.deepEqual(ligne(liste, 'pate').totaux, { masse: 500 });
  // Seul B en mange : sa version retire le jambon, il n'y en a plus du tout.
  const seulB = listeDeCourses(semaineAvec({ 'gratin-pates-jambon': dans(1) }), { tousLesPlats: [GRATIN], profils: [B] });
  assert.equal(ligne(seulB, 'jambon-blanc'), undefined);
  assert.deepEqual(ligne(seulB, 'thon-au-naturel').totaux, { masse: 200 }, 'B seul : 4 repas');
});

test('liste : profil sans règle avec des versions sur la fiche → aucune ligne de version', () => {
  const liste = listeDeCourses(SEMAINE, { tousLesPlats: TOUS, profils: [A, { ...B, regles: [] }, E] });
  assert.equal(ligne(liste, 'thon-au-naturel'), undefined);
  assert.equal(ligne(liste, 'tofu-fume'), undefined);
  assert.deepEqual(ligne(liste, 'jambon-blanc').totaux, { tranche: 5 });
});

test('liste : plat ⏳ (sans ligne, nommé), corbeille ou introuvable (hors liste), personne n’en mange (sans portion)', () => {
  const semaine = semaineAvec({ 'tarte-poireaux': dans(1), jete: dans(2), disparu: dans(3), 'salade-pates': dans(4) });
  const tous = [...TOUS.filter((p) => p.id !== 'salade-pates'), { ...SALADE, notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0 } }];
  const liste = listeDeCourses(semaine, { tousLesPlats: tous, profils: PROFILS });
  assert.deepEqual(liste.lignes, []);
  assert.deepEqual(liste.maison, []);
  assert.deepEqual(liste.sansRecette, [TARTE]);
  assert.deepEqual(liste.horsListe, [{ platId: 'jete', plat: JETE, etat: 'corbeille' }, { platId: 'disparu', plat: null, etat: 'absent' }]);
  assert.equal(liste.sansPortion.length, 1);
  assert.equal(liste.sansPortion[0].id, 'salade-pates');
  // Remis de la corbeille, le plat revient avec ses réglages.
  const remis = listeDeCourses(semaineAvec({ jete: dans(1, { repas: 8 }) }), { tousLesPlats: [{ ...JETE, corbeille: undefined }], profils: SOLO });
  assert.deepEqual(ligne(remis, 'riz').totaux, { masse: 200 });
});

test('liste : portions à congeler ajoutées au facteur ; invités sans profil', () => {
  const congeler = calculer(semaineAvec({ 'gratin-pates-jambon': dans(1, { portionsACongeler: 2 }) }));
  assert.deepEqual(ligne(congeler, 'pate').totaux, { masse: 700 });
  assert.deepEqual(ligne(congeler, 'jambon-blanc').totaux, { tranche: 5 }, '(5 + 2 − 2) ÷ 4 × 4');
  const invites = listeDeCourses(semaineAvec({ 'salade-pates': dans(1, { invites: { adultes: 2, enfants: 0 } }) }), { tousLesPlats: TOUS, profils: [] });
  assert.deepEqual(ligne(invites, 'pate').totaux, { masse: 200 });
  assert.deepEqual(ligne(invites, 'pate').sources[0].pour, undefined);
});

test('liste : 100 g × 1,1 → « 110 g » ; g et kg réunis ; ml, cl et l réunis ; g et c. à soupe sur une ligne', () => {
  const riz = plat('riz-essai', 'Riz', [ing('riz', 100, 'g', 'epicerie_salee', ['feculent'])], { portionsBase: 10 });
  const onze = listeDeCourses(semaineAvec({ 'riz-essai': dans(1, { repas: 2, invites: { adultes: 3, enfants: 0 } }) }),
    { tousLesPlats: [riz], profils: PROFILS });
  assert.equal(ligne(onze, 'riz').quantite, '110\u00A0g');
  assert.deepEqual(ligne(onze, 'riz').totaux, { masse: 110 }, 'total arrondi au millionième');
  const kg = listeSolo(telle('a', [ing('riz', 1, 'kg', 'epicerie_salee')]), telle('b', [ing('riz', 300, 'g', 'epicerie_salee')]));
  assert.equal(ligne(kg, 'riz').quantite, '1,3\u00A0kg');
  const cl = listeSolo(telle('a', [ing('lait de coco', 20, 'cl', 'epicerie_salee')]), telle('b', [ing('lait de coco', 50, 'ml', 'epicerie_salee')]));
  assert.equal(ligne(cl, 'lait-de-coco').quantite, '25\u00A0cl');
  const litres = listeSolo(telle('a', [ing('lait de coco', 0.8, 'l', 'epicerie_salee')]), telle('b', [ing('lait de coco', 0.8, 'l', 'epicerie_salee')]));
  assert.equal(ligne(litres, 'lait-de-coco').quantite, '1,6\u00A0l');
  const beurre = listeSolo(telle('a', [ing('beurre', 230, 'g', 'cremerie')]), telle('b', [ing('beurre', 2, 'cs', 'cremerie')]));
  assert.equal(ligne(beurre, 'beurre').quantite, '230\u00A0g + 2\u00A0c. à soupe');
  assert.equal(beurre.lignes.length, 1);
});

test('liste : « oignon », « oignons » et « oignon jaune » font une seule ligne ; 1,25 + 0,5 oignon = 2, pas 3', () => {
  const liste = listeSolo(telle('a', [ing('oignon', 1, 'pc', 'fruits_legumes'), ing('oignons', 2, 'pc', 'fruits_legumes'), ing('oignon jaune', 1, 'pc', 'fruits_legumes')]));
  assert.equal(liste.lignes.length, 1);
  assert.deepEqual(ligne(liste, 'oignon-jaune').totaux, { pc: 4 });
  const quarts = listeDeCourses(semaineAvec({ a: dans(1, { repas: 1 }), b: dans(2, { repas: 1 }) }), {
    tousLesPlats: [telle('a', [ing('oignon', 1.25, 'pc', 'fruits_legumes')], { portionsBase: 1 }), telle('b', [ing('oignons', 0.5, 'pc', 'fruits_legumes')], { portionsBase: 1 })],
    profils: SOLO,
  });
  assert.deepEqual(ligne(quarts, 'oignon-jaune').totaux, { pc: 1.75 });
  assert.equal(ligne(quarts, 'oignon-jaune').quantite, '2');
});

test('liste : quantité ou unité illisible → la ligne existe sans quantité, et le plat est à vérifier ; portions de base illisibles', () => {
  const liste = listeSolo(telle('a', [ing('persil', 1, 'bouquet', 'fruits_legumes'), ing('riz', 'beaucoup', 'g', 'epicerie_salee'), ing('', 1, 'g', 'divers')]));
  assert.deepEqual(liste.lignes.map((l) => [l.produitId, l.quantite]), [['persil', ''], ['riz', '']]);
  assert.deepEqual(liste.aVerifier.map((v) => v.produit), ['persil', 'riz', '']);
  const sansBase = listeSolo(telle('b', [ing('riz', 100, 'g', 'epicerie_salee')], { portionsBase: 0 }));
  assert.deepEqual(ligne(sansBase, 'riz').totaux, { masse: 100 }, 'facteur 1');
  assert.deepEqual(sansBase.aVerifier.map((v) => [v.plat.id, v.produit]), [['b', null]]);
});

test('liste : placard (sel, laurier, bouillon et eau toujours ; beurre et ail au seuil compris) ; racheté → sur la liste', () => {
  const placard = (ingredients, semaineExtra = {}) => listeDeCourses(semaineAvec({ p: dans(1) }, semaineExtra), { tousLesPlats: [telle('p', ingredients)], profils: SOLO });
  assert.deepEqual(placard([ing('sel', 40, 'pincee', 'epicerie_salee')]).maison.map((l) => l.produitId), ['sel']);
  assert.deepEqual(placard([ing('beurre', 30, 'g', 'cremerie')]).maison.map((l) => l.produitId), ['beurre']);
  assert.deepEqual(placard([ing('beurre', 31, 'g', 'cremerie')]).lignes.map((l) => l.produitId), ['beurre']);
  assert.deepEqual(placard([ing('laurier', 2, 'pc', 'epicerie_salee'), ing('feuille de laurier', 2, 'pc', 'epicerie_salee')]).maison.map((l) => l.produitId), ['laurier']);
  assert.deepEqual(placard([ing('ail', 10, 'g', 'fruits_legumes')]).maison.map((l) => l.produitId), ['ail']);
  assert.deepEqual(placard([ing('bouillon de volaille', 50, 'cl', 'epicerie_salee', ['bouillon_viande'])]).maison.map((l) => l.produitId), ['bouillon-de-volaille']);
  // Décision du 2026-10-11 : un bouillon est toujours à la maison, quelle que soit la quantité (avant : sur la liste
  // au-delà de 2 cubes).
  assert.deepEqual(placard([ing('bouillon de volaille', 150, 'cl', 'epicerie_salee', ['bouillon_viande'])]).maison.map((l) => l.produitId), ['bouillon-de-volaille']);
  assert.deepEqual(placard([ing('eau', 2, 'l', 'boissons')]).maison.map((l) => l.produitId), ['eau']);
  assert.deepEqual(placard([ing('laurier', 1, 'cc', 'epicerie_salee')]).maison.map((l) => l.produitId), ['laurier'], 'toujours, même en cuillère');
  assert.deepEqual(placard([ing('beurre', 1, 'boite', 'cremerie')]).lignes.map((l) => l.produitId), ['beurre'], 'seuil gardé, sans équivalence : on l’achète');
  assert.deepEqual(placard([ing('ail', 3, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' })]).lignes.map((l) => l.produitId), ['ail'], 'au-delà de 2 gousses');
  const rachete = placard([ing('sel', 1, 'pincee', 'epicerie_salee')], { racheter: { sel: true } });
  assert.deepEqual(rachete.maison, []);
  assert.deepEqual(rachete.lignes.map((l) => [l.produitId, l.placard, l.rachetee]), [['sel', true, true]]);
  const maison = placard([ing('sel', 1, 'pincee', 'epicerie_salee')]).maison[0];
  assert.deepEqual([maison.placard, maison.rachetee, maison.cochee], [true, false, false]);
});

test('liste : constat de l’essai du 2026-10-11 rejoué : produits durables dans « Déjà à la maison ? », beurre au-delà de 30 g sur la liste', () => {
  // Recette pour 5, un adulte seul : 5 repas, la recette telle quelle.
  const p = plat('p', 'Plat p', [
    ing('cannelle moulue', 3.5, 'cc', 'epicerie_salee'), ing('fleur de sel', 1, 'pincee', 'epicerie_salee'),
    ing("moutarde à l'ancienne", 1.5, 'cs', 'epicerie_salee'), ing('paprika fumé', 1.5, 'cc', 'epicerie_salee'),
    ing("huile d'olive", 10.5, 'cs', 'epicerie_salee'), ing('bouillon de légumes', 1.6, 'l', 'epicerie_salee'),
    ing('poivre du moulin', 2, 'pincee', 'epicerie_salee'), ing('thym séché', 1, 'cc', 'epicerie_salee'),
    ing('huile végétale', 2, 'cs', 'epicerie_salee'), ing('beurre', 40, 'g', 'cremerie', ['laitier']),
  ], { portionsBase: 5 });
  const liste = listeDeCourses(semaineAvec({ p: dans(1) }), { tousLesPlats: [p], profils: SOLO });
  assert.deepEqual(liste.maison.map((l) => l.produitId).sort(), ['bouillon-de-legume', 'cannelle', 'fleur-de-sel',
    'huile-d-olive', 'huile-neutre', 'moutarde-a-l-ancienne', 'paprika-fume', 'poivre', 'thym'].sort());
  assert.deepEqual(liste.lignes.map((l) => [l.produitId, l.quantite]), [['beurre', '40\u00A0g']]);
  assert.equal(ligne(liste, 'huile-d-olive').quantite, '10,5\u00A0c. à soupe', 'au-delà de 6 c. à soupe');
  assert.equal(ligne(liste, 'bouillon-de-legume').quantite, '1,6\u00A0l', 'en litres, au-delà de 2 cubes');
  // Le nom affiché reste celui des recettes ; aucune écriture : une coche posée sous l'ancien identifiant
  // (« cannelle-moulue ») est ignorée en maison, et relue par la clé de repli si la ligne est rachetée.
  assert.equal(ligne(liste, 'cannelle').nom, 'Cannelle moulue');
  const coches = { 'cannelle-moulue': { q: { cc: 3.5 }, le: 1 } };
  const rachetee = listeDeCourses(semaineAvec({ p: dans(1) }, { coches, racheter: { cannelle: true } }), { tousLesPlats: [p], profils: SOLO });
  assert.deepEqual([ligne(rachetee, 'cannelle').repli, ligne(rachetee, 'cannelle').cochee], ['cannelle-moulue', true]);
  const enMaison = listeDeCourses(semaineAvec({ p: dans(1) }, { coches }), { tousLesPlats: [p], profils: SOLO });
  assert.equal(ligne(enMaison, 'cannelle').cochee, false);
});

test('liste : écriture nouvellement reconnue hors placard : la coche posée sous l’ancien identifiant reste lue (clé de repli)', () => {
  // Avant le 2026-10-11, « farine t55 » était inconnue : sa ligne avait l’identifiant « farine-t55 ».
  const p = telle('p', [ing('farine t55', 200, 'g', 'epicerie_sucree')]);
  const semaine = semaineAvec({ p: dans(1) }, { coches: { 'farine-t55': { q: { masse: 200 }, le: 1 } } });
  const liste = listeDeCourses(semaine, { tousLesPlats: [p], profils: SOLO });
  const farine = ligne(liste, 'farine');
  assert.deepEqual([farine.nom, farine.repli, farine.cochee, farine.placard], ['Farine t55', 'farine-t55', true, false]);
  assert.deepEqual(liste.maison, []);
  // Décocher efface aussi la clé de repli : aucune coche orpheline.
  assert.deepEqual(Object.keys(ecrituresCoche(semaine, farine, false).champs).sort(), ['coches.farine', 'coches.farine-t55']);
  // Recocher l'efface aussi : la nouvelle coche dit tout ce qui a été pris.
  assert.deepEqual(ecrituresCoche(semaine, farine, true, { maintenant: 5 }).champs,
    { 'coches.farine': { q: { masse: 200 }, le: 5 }, 'coches.farine-t55': EFFACER });
  // Une autre recette du foyer, hors de la semaine, écrit « farine » : le nom affiché devient « Farine », et la coche
  // posée sous « farine-t55 » reste lue (clé de chaque écriture de la semaine, pas seulement du nom affiché).
  const q = telle('q', [ing('farine', 100, 'g', 'epicerie_sucree')]);
  const autre = ligne(listeDeCourses(semaine, { tousLesPlats: [p, q], profils: SOLO }), 'farine');
  assert.deepEqual([autre.nom, autre.replis, autre.cochee], ['Farine', ['farine-t55'], true]);
  // Même chose pour le sucre (« sucre semoule » coché, une recette « sucre » ailleurs).
  const s1 = telle('s1', [ing('sucre semoule', 100, 'g', 'epicerie_sucree')]);
  const s2 = telle('s2', [ing('sucre', 50, 'g', 'epicerie_sucree')]);
  const sucre = ligne(listeDeCourses(semaineAvec({ s1: dans(1) }, { coches: { 'sucre-semoule': { q: { masse: 100 }, le: 1 } } }),
    { tousLesPlats: [s1, s2], profils: SOLO }), 'sucre');
  assert.deepEqual([sucre.nom, sucre.cochee], ['Sucre', true]);
});

test('liste : deux écritures réunies en une ligne, cochées chacune avant : ce qui a été pris s’additionne', () => {
  // « farine » (déjà reconnue, id « farine ») et « farine t55 » (id « farine-t55 » avant le 2026-10-11), cochées toutes
  // les deux : une seule ligne de 300 g, cochée en entier.
  const p = telle('p', [ing('farine', 100, 'g', 'epicerie_sucree'), ing('farine t55', 200, 'g', 'epicerie_sucree')]);
  const coches = { farine: { q: { masse: 100 }, le: 1 }, 'farine-t55': { q: { masse: 200 }, le: 2 } };
  const semaine = semaineAvec({ p: dans(1) }, { coches });
  const farine = ligne(listeDeCourses(semaine, { tousLesPlats: [p], profils: SOLO }), 'farine');
  assert.deepEqual([farine.totaux, farine.replis, farine.cochee, farine.dejaPris], [{ masse: 300 }, ['farine-t55'], true, null]);
  // Une seule des deux cochée : « Déjà pris » le dit.
  const moitie = ligne(listeDeCourses(semaineAvec({ p: dans(1) }, { coches: { 'farine-t55': coches['farine-t55'] } }),
    { tousLesPlats: [p], profils: SOLO }), 'farine');
  assert.deepEqual([moitie.cochee, moitie.dejaPris, moitie.reste], [false, { masse: 200 }, { masse: 100 }]);
  // « Beurre fondu » coché et « beurre » à la maison avant : une ligne de 70 g, cochée pour ce qui a été pris (50 g).
  const b = telle('b', [ing('beurre fondu', 50, 'g', 'cremerie', ['laitier']), ing('beurre', 20, 'g', 'cremerie', ['laitier'])]);
  const beurre = ligne(listeDeCourses(semaineAvec({ b: dans(1) }, { coches: { 'beurre-fondu': { q: { masse: 50 }, le: 1 } } }),
    { tousLesPlats: [b], profils: SOLO }), 'beurre');
  assert.deepEqual([beurre.totaux, beurre.dejaPris, beurre.reste], [{ masse: 70 }, { masse: 50 }, { masse: 20 }]);
  // Décocher efface toutes les clés.
  assert.deepEqual(Object.keys(ecrituresCoche(semaine, farine, false).champs).sort(), ['coches.farine', 'coches.farine-t55']);
});

test('liste : une herbe en bottes ou en branches s’achète ; en cuillères, elle est à la maison', () => {
  const p = telle('p', [ing('thym', 1, 'botte', 'fruits_legumes')]);
  const q = telle('q', [ing('thym', 2, 'pc', 'fruits_legumes')]);
  const r = telle('r', [ing('thym', 1, 'cc', 'epicerie_salee'), ing('laurier', 2, 'pc', 'epicerie_salee'),
    ing('origan', 1, 'cc', 'epicerie_salee')]);
  const t = telle('t', [ing('laurier', 1, 'botte', 'fruits_legumes'), ing('origan', 1, 'botte', 'fruits_legumes')]);
  const enMaison = (plats) => listeDeCourses(semaineAvec(Object.fromEntries(plats.map((x, i) => [x.id, dans(i + 1)]))),
    { tousLesPlats: plats, profils: SOLO });
  assert.deepEqual(enMaison([p]).lignes.map((l) => l.produitId), ['thym']);
  assert.deepEqual(enMaison([q]).lignes.map((l) => l.produitId), ['thym']);
  assert.deepEqual(enMaison([r]).maison.map((l) => l.produitId), ['laurier', 'origan', 'thym']);
  assert.deepEqual(enMaison([t]).lignes.map((l) => l.produitId).sort(), ['laurier', 'origan']);
  // Thym en cuillère et en botte la même semaine : sur la liste (dans le doute, on l'achète).
  assert.deepEqual(enMaison([p, r]).lignes.map((l) => l.produitId), ['thym']);
});

test('liste : produits/{id} du foyer (T3b, T3d) : mot cherché, placard éteint', () => {
  const produitsFoyer = { pate: { rechercheDrive: 'penne' }, sel: { placard: { actif: false } } };
  const liste = calculer(SEMAINE, { produitsFoyer });
  assert.equal(ligne(liste, 'pate').recherche, 'penne');
  assert.equal(liste.lignes.some((l) => l.produitId === 'sel'), true, 'placard éteint : sur la liste');
});

test('liste : coches (prise, dépassée, clé de repli) ; la coche d’une ligne disparue est ignorée', () => {
  const coches = { pate: { q: { masse: 600 }, le: 1 }, 'jambon-blanc': { q: { tranche: 3 }, le: 1 }, disparue: { q: { pc: 1 }, le: 1 } };
  const liste = calculer({ ...SEMAINE, coches });
  assert.equal(ligne(liste, 'jambon-blanc').cochee, true);
  const pates = ligne(liste, 'pate');
  assert.deepEqual([pates.cochee, pates.dejaPris, pates.reste], [false, { masse: 600 }, { masse: 150 }]);
  assert.equal(texteDejaPris(pates), 'Déjà pris\u00A0: 600\u00A0g · encore 150\u00A0g');
  assert.equal(liste.lignes.some((l) => l.produitId === 'disparue'), false);
  // Le nom affiché vient des recettes (« oignons ») : une coche rangée sous sa clé est retrouvée.
  const oignons = listeDeCourses(semaineAvec({ a: dans(1) }, { coches: { oignon: { q: { pc: 4 }, le: 1 } } }),
    { tousLesPlats: [telle('a', [ing('oignons', 2, 'pc', 'fruits_legumes')])], profils: SOLO });
  assert.deepEqual([ligne(oignons, 'oignon-jaune').repli, ligne(oignons, 'oignon-jaune').cochee], ['oignon', true]);
});

test('liste : articles ajoutés à la main (rayon du produit, sinon Divers ; « lait » à part de la ligne « lait »)', () => {
  const articles = [
    { id: 'Ab12', libelle: 'piles', creeLe: CREEE },
    { id: 'Cd34', libelle: ' lait ', precision: '6 l', creeLe: CREEE },
    { id: 'vide', libelle: '  ' },
    { libelle: 'sans id' },
  ];
  const liste = calculer(semaineAvec({ p: dans(1) }), { tousLesPlats: [telle('p', [ing('lait', 50, 'cl', 'cremerie', ['laitier'])])], profils: SOLO, articles });
  assert.deepEqual(liste.articles.map((a) => [a.cle, a.nom, a.rayon, a.quantite, a.cochee]),
    [['article:Cd34', 'Lait', 'cremerie', '6 l', false], ['article:Ab12', 'Piles', 'divers', '', false]]);
  assert.deepEqual(liste.lignes.map((l) => l.produitId), ['lait']);
  assert.equal(liste.articles[0].type, 'article');
  assert.equal(liste.articles[0].produitId, 'lait');
  assert.equal(liste.articles[0].recherche, 'lait');
  assert.equal(liste.articles[0].placard, false);
  // Jamais dans le placard, même un produit du placard.
  const sel = calculer(null, { articles: [{ id: 's', libelle: 'sel' }] });
  assert.deepEqual([sel.articles.length, sel.maison.length], [1, 0]);
});

test('liste : un article coché avant min(création, minuit du début) est caché ; semaine préparée d’avance', () => {
  const articles = [
    { id: 'avant', libelle: 'piles', coche: { le: H('2026-10-09T20:00:00+02:00') } },
    { id: 'matin', libelle: 'éponge', coche: { le: H('2026-10-10T08:00:00+02:00') } },
    { id: 'non', libelle: 'lessive' },
    { id: 'sansdate', libelle: 'ampoule', coche: {} },
  ];
  const liste = calculer(S1, { articles });
  assert.deepEqual(liste.articles.map((a) => [a.articleId, a.cochee]).sort(), [['matin', true], ['non', false], ['sansdate', true]]);
  // Semaine créée le jeudi 15 au soir pour le samedi 17 : les courses du vendredi 16 restent dans « Dans le panier ».
  const avance = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', creeLe: H('2026-10-15T20:00:00+02:00') };
  const avecAvance = calculer(avance, { articles: [
    { id: 'veille', libelle: 'piles', coche: { le: H('2026-10-16T11:00:00+02:00') } },
    { id: 'jeudi', libelle: 'éponge', coche: { le: H('2026-10-15T10:00:00+02:00') } },
  ] });
  assert.deepEqual(avecAvance.articles.map((a) => a.articleId), ['veille']);
});

test('liste : sans semaine, seuls les articles cochés depuis 2 jours au plus restent', () => {
  const maintenant = H('2026-10-20T12:00:00+02:00');
  const articles = [
    { id: 'hier', libelle: 'piles', coche: { le: maintenant - 86_400_000 } },
    { id: 'vieux', libelle: 'éponge', coche: { le: maintenant - 3 * 86_400_000 } },
    { id: 'libre', libelle: 'lessive' },
  ];
  assert.deepEqual(listeDeCourses(null, { articles, maintenant }).articles.map((a) => a.articleId).sort(), ['hier', 'libre']);
  assert.deepEqual(listeDeCourses(null, { articles }).articles.length, 3, 'sans heure : rien n’est caché');
  const vide = listeDeCourses(undefined);
  assert.deepEqual(vide, {
    lignes: [], maison: [], articles: [], sansRecette: [], horsListe: [], sansPortion: [], aVerifier: [],
    habituels: [], preparations: [], // T3d : rien de chaque semaine sans semaine
  });
});

test('liste : ordre des rayons du foyer, puis le nom ; articles rangés de même', () => {
  const liste = calculer(SEMAINE, { reglages: { rayons: ['epicerie_salee', 'cremerie'] } });
  assert.deepEqual(liste.lignes.map((l) => l.produitId), ['pate', 'thon-au-naturel', 'creme-fraiche-epaisse', 'tomate', 'jambon-blanc', 'gruyere-rape']);
});

test('liste : ne dépend ni de l’ordre des plats ni de celui des ingrédients, au bit près ; rien n’est modifié en entrée', () => {
  const fractions = [0.1, 0.2, 0.3, 0.7, 1.1, 0.05];
  const plats = fractions.map((f, i) => telle(`p${i}`, [ing('riz', f, 'kg', 'epicerie_salee'), ing('lait de coco', f, 'l', 'epicerie_salee'),
    ing('pâtes', f * 1000, 'g', 'epicerie_salee'), ing('tomate', f * 3, 'pc', 'fruits_legumes')]));
  const semaine = semaineAvec(Object.fromEntries(plats.map((p, i) => [p.id, dans(i % 2)])));
  const reference = listeDeCourses(semaine, { tousLesPlats: plats, profils: SOLO });
  for (let graine = 0; graine < 12; graine += 1) {
    const melanges = melanger(plats, `g${graine}`).map((p) => ({ ...p, ingredients: melanger(p.ingredients, `${p.id}${graine}`) }));
    const entrees = melanger(Object.entries(semaine.plats), `s${graine}`);
    const autre = listeDeCourses({ ...semaine, plats: Object.fromEntries(entrees) }, { tousLesPlats: melanges, profils: melanger(SOLO, 'x') });
    assert.deepEqual(autre.lignes.map((l) => l.produitId), reference.lignes.map((l) => l.produitId));
    for (const l of reference.lignes) {
      const m = ligne(autre, l.produitId);
      for (const [famille, valeur] of Object.entries(l.totaux)) assert.ok(Object.is(m.totaux[famille], valeur), `${l.produitId} ${famille}`);
    }
  }
  assert.deepEqual(ligne(reference, 'riz').totaux, { masse: 2450 });
  const gele = geler({ semaine: structuredClone({ ...SEMAINE, coches: { pate: { q: { masse: 600 } } } }), tous: structuredClone(TOUS), profils: structuredClone(PROFILS) });
  const avant = JSON.stringify(gele);
  listeDeCourses(gele.semaine, { tousLesPlats: gele.tous, profils: gele.profils, articles: geler([{ id: 'a', libelle: 'piles' }]), reglages: geler({ rayons: ['divers'] }) });
  assert.equal(JSON.stringify(gele), avant);
});

test('liste : l’index des recettes passé par l’app est utilisé (nom affiché) ; sinon il est calculé', () => {
  const index = indexDesRecettes([telle('x', [ing('pâtes courtes', 1, 'g', 'epicerie_salee'), ing('pâtes courtes', 1, 'g', 'epicerie_salee')])]);
  assert.equal(ligne(calculer(SEMAINE, { index }), 'pate').nom, 'Pâtes courtes');
  assert.equal(ligne(calculer(SEMAINE), 'pate').nom, 'Pâtes');
});

// ——— Écran Courses ———

test('grouperParRayon : rayons dans l’ordre, lignes et articles à acheter ; panier ; compteurs', () => {
  const liste = calculer({ ...SEMAINE, coches: { 'jambon-blanc': { q: { tranche: 3 }, le: 1 } } }, { articles: [{ id: 'a1', libelle: 'piles' }, { id: 'a2', libelle: 'tomates cerises', coche: { le: CREEE + 1 } }] });
  const groupes = grouperParRayon(liste, { rayons: ordreRayons(null) });
  assert.deepEqual(groupes.aAcheter.map((g) => [g.rayon, g.libelle, g.lignes.map((l) => l.nom)]), [
    ['fruits_legumes', 'Fruits et légumes', ['Tomate']],
    ['cremerie', 'Crèmerie', ['Crème fraîche épaisse']],
    ['fromages', 'Fromages', ['Gruyère râpé']],
    ['epicerie_salee', 'Épicerie salée', ['Pâtes', 'Thon au naturel']],
    ['divers', 'Divers', ['Piles']],
  ]);
  assert.deepEqual(groupes.panier.map((l) => l.nom), ['Tomates cerises', 'Jambon blanc']);
  assert.deepEqual([groupes.total, groupes.pris, groupes.vide], [8, 2, false]);
  assert.equal(groupes.maison.length, 2, 'hors des comptes');
});

test('grouperParRayon : liste vide → `vide` (jamais « tout est dans le panier ») ; articles seuls → pas vide', () => {
  const vide = grouperParRayon(listeDeCourses(null));
  assert.deepEqual(vide, { aAcheter: [], maison: [], panier: [], total: 0, pris: 0, vide: true });
  const placardSeul = grouperParRayon(listeDeCourses(semaineAvec({ p: dans(1) }), { tousLesPlats: [telle('p', [ing('sel', 1, 'pincee', 'epicerie_salee')])], profils: SOLO }));
  assert.equal(placardSeul.vide, true);
  const articles = grouperParRayon(listeDeCourses(semaineAvec({}), { articles: [{ id: 'a', libelle: 'piles' }] }));
  assert.deepEqual([articles.vide, articles.total], [false, 1]);
  assert.equal(grouperParRayon(null).vide, true);
});

test('texteOrigine : les plats ; une version : « pour Adulte B (version mer) », « pour vous » ; article ; jamais de croix', () => {
  const liste = calculer(SEMAINE, { articles: [{ id: 'a', libelle: 'piles' }] });
  assert.equal(texteOrigine(ligne(liste, 'pate'), { profils: PROFILS }), 'Gratin de pâtes au jambon, Salade de pâtes');
  assert.equal(texteOrigine(ligne(liste, 'thon-au-naturel'), { profils: PROFILS, moi: A }), 'pour Adulte B (version mer)');
  assert.equal(texteOrigine(ligne(liste, 'thon-au-naturel'), { profils: PROFILS, moi: B }), 'pour vous (version mer)');
  assert.equal(texteOrigine(liste.articles[0]), 'Ajouté à la main');
  const vegetale = calculer(semaineAvec({ 'gratin-pates-jambon': dans(1, { styles: { 'profil-b': 'vegetal' } }) }));
  assert.equal(texteOrigine(ligne(vegetale, 'creme-fraiche-epaisse'), { profils: PROFILS }), 'Gratin de pâtes au jambon, pour Adulte B (version végétale)');
  for (const role of ['gestionnaire', 'courses']) {
    for (const l of [...liste.lignes, ...vegetale.lignes]) assert.equal(/❌/.test(texteOrigine(l, { profils: PROFILS, moi: B, role })), false);
  }
});

test('texteSource : détail d’une ligne (⋮) : plat et quantité ; version d’un profil ; pour soi', () => {
  const liste = calculer(SEMAINE);
  assert.equal(texteSource(ligne(liste, 'pate').sources[0]), 'Gratin de pâtes au jambon · 500\u00A0g');
  const thon = ligne(liste, 'thon-au-naturel').sources[0];
  assert.equal(texteSource(thon, { profils: PROFILS, moi: A }), 'Version mer d’Adulte B · Gratin de pâtes au jambon · 100\u00A0g');
  assert.equal(texteSource(thon, { profils: PROFILS, moi: B }), 'Votre version mer · Gratin de pâtes au jambon · 100\u00A0g');
  assert.equal(texteSource({ nom: 'Soupe', totaux: {} }), 'Soupe');
});

test('texteOrigine et texteSource : version d’un profil sans styles (« pas de tomate ») → « sa version », jamais « végétale »', () => {
  const sansTomate = { ...A, regles: [{ type: 'exclureProduits', produits: ['tomate'], severite: 'exclu' }] };
  const salade = { ...SALADE, variantes: [{ pour: 'profil-a', retirer: ['tomate'], ajouter: [ajout('concombre', 0.25, 'pc', 'fruits_legumes', ['legume'])], consigne: '' }] };
  const liste = listeDeCourses(semaineAvec({ 'salade-pates': dans(1) }), { tousLesPlats: [salade], profils: [sansTomate, { ...B, regles: [] }] });
  const concombre = ligne(liste, 'concombre');
  assert.equal('style' in concombre.sources[0], false);
  assert.equal(texteOrigine(concombre, { profils: [sansTomate], moi: sansTomate }), 'pour vous (votre version)');
  assert.equal(texteOrigine(concombre, { profils: [sansTomate], moi: B }), 'pour Adulte A (sa version)');
  assert.equal(texteSource(concombre.sources[0], { profils: [sansTomate], moi: sansTomate }).startsWith('Votre version · Salade de pâtes'), true);
  assert.equal(texteSource(concombre.sources[0], { profils: [sansTomate], moi: B }).startsWith('Version d’Adulte A · Salade de pâtes'), true);
});

test('preparerAjout : vide, plus de 60 caractères ; même produit déjà dans la liste → `aussi` (l’ajout reste fait)', () => {
  const liste = calculer(SEMAINE);
  assert.deepEqual(preparerAjout('   ', { liste }), { erreur: 'vide' });
  assert.deepEqual(preparerAjout(undefined), { erreur: 'vide' });
  assert.deepEqual(preparerAjout('x'.repeat(ARTICLE_MAX + 1), { liste }), { erreur: 'long' });
  assert.deepEqual(preparerAjout('x'.repeat(ARTICLE_MAX), { liste }).donnees, { libelle: 'x'.repeat(60) });
  assert.deepEqual(preparerAjout('  piles  ', { liste }), { donnees: { libelle: 'piles' }, aussi: null });
  assert.deepEqual(preparerAjout('Pâtes courtes', { liste }), { donnees: { libelle: 'Pâtes courtes' }, aussi: { nom: 'Pâtes', quantite: '750\u00A0g' } });
  assert.deepEqual(ERREURS_ARTICLE, { vide: 'Écrivez le nom d’un article.', long: '60 caractères au plus.' });
});

test('restes : aucune coche → rien ; courses terminées → rien ; sinon les lignes restantes, sans placard ni articles', () => {
  const sansCoche = calculer(SEMAINE);
  assert.deepEqual(restes(sansCoche, SEMAINE), []);
  const semaine = { ...SEMAINE, coches: { 'jambon-blanc': { q: { tranche: 3 }, le: 1 }, pate: { q: { masse: 600 }, le: 1 } } };
  const liste = calculer(semaine, { articles: [{ id: 'a', libelle: 'piles' }] });
  assert.deepEqual(restes(liste, semaine), [
    { libelle: 'tomate', precision: '3', produitId: 'tomate' },
    { libelle: 'crème fraîche épaisse', precision: '25\u00A0cl', produitId: 'creme-fraiche-epaisse' },
    { libelle: 'gruyère râpé', precision: '130\u00A0g', produitId: 'gruyere-rape' },
    { libelle: 'pâtes', precision: '150\u00A0g', produitId: 'pate' },
    { libelle: 'thon au naturel', precision: '100\u00A0g', produitId: 'thon-au-naturel' },
  ]);
  assert.deepEqual(restes(liste, { ...semaine, statut: 'courses_faites' }), []);
  assert.deepEqual(restes(liste, { ...semaine, statut: 'batch_fait' }), []);
  assert.equal(restes(liste, { ...semaine, statut: 'validee' }).length, 5);
  // Un article coché suffit à dire que les courses ont commencé.
  const articleCoche = calculer(SEMAINE, { articles: [{ id: 'a', libelle: 'piles', coche: { le: CREEE + 1 } }] });
  assert.equal(restes(articleCoche, SEMAINE).length, 6);
  assert.deepEqual(restes(liste, null), []);
});

test('phraseRestesAjoutes : fin de l’annonce d’un ajout qui emporte les restes (fiche, Plats)', () => {
  assert.equal(phraseRestesAjoutes(1), 'L’article pas pris de la semaine qui finit passe sur sa liste.');
  assert.equal(phraseRestesAjoutes(7), 'Les 7\u00A0articles pas pris de la semaine qui finit passent sur sa liste.');
  assert.equal(phraseRestesAjoutes(0), '');
  assert.equal(phraseRestesAjoutes(undefined), '');
});

test('phraseRestes : « Il reste 2 articles de la semaine qui finit : beurre et sel. Ils passeront sur la nouvelle liste. »', () => {
  assert.equal(phraseRestes([{ libelle: 'beurre' }, { libelle: 'sel' }]),
    'Il reste 2\u00A0articles de la semaine qui finit\u00A0: beurre et sel. Ils passeront sur la nouvelle liste.');
  assert.equal(phraseRestes([{ libelle: 'beurre' }]), 'Il reste 1\u00A0article de la semaine qui finit\u00A0: beurre. Il passera sur la nouvelle liste.');
  assert.equal(phraseRestes(['a', 'b', 'c', 'd', 'e'].map((libelle) => ({ libelle }))),
    'Il reste 5\u00A0articles de la semaine qui finit\u00A0: a, b, c et 2\u00A0autres. Ils passeront sur la nouvelle liste.');
  assert.equal(phraseRestes([]), '');
});

// ——— Carte « prochaine action » de Semaine ———

function carte(semaine, { aujourdhui = '2026-10-12', semaines = [semaine].filter(Boolean), articles = [], chargees = true, tousLesPlats = TOUS } = {}) {
  const plats = semaine ? platsDeLaSemaine(semaine, { tousLesPlats, profils: PROFILS }) : [];
  const liste = listeDeCourses(semaine, { tousLesPlats, profils: PROFILS, articles });
  return carteProchaineAction(semaine, { semainesChargees: chargees, semaines, aujourdhui, plats, liste, groupes: grouperParRayon(liste) });
}

test('carteProchaineAction : chargement ; aucune semaine ou aucun plat → « Que mange-t-on… ? » + « ＋ Choisir les plats »', () => {
  assert.deepEqual(carte(SEMAINE, { chargees: false }), {
    cas: 'chargement', titre: 'Chargement de la semaine…', texte: null, fin: null, boutons: [], suivante: null,
  });
  const vide = carte(null);
  assert.equal(vide.cas, 'choisir');
  assert.equal(vide.titre, 'Que mange-t-on cette semaine\u00A0?');
  assert.equal(vide.texte, 'Choisissez quelques plats\u00A0: la liste de courses se fait toute seule.');
  assert.deepEqual(vide.boutons, [{ action: 'choisir', libelle: '＋ Choisir les plats', principal: true }]);
  assert.equal(carte(semaineAvec({ jete: dans(1) })).cas, 'choisir', 'plat de la corbeille seulement');
  // Semaine qui commence plus tard, avec un plat de la corbeille seulement : ses dates.
  const plusTard = carte({ id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', plats: { jete: dans(1) } }, { aujourdhui: '2026-10-16' });
  assert.equal(plusTard.titre, 'Que mange-t-on du 17 au 23 octobre\u00A0?');
  // Semaine suivante vidée (« Annuler ») : la semaine du jour revient ; la suivante, reprise telle quelle, est visée.
  const S2_VIDE = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', creeLe: CREEE + 1, plats: { curry: dans(2, { retire: true }) } };
  const reprise = carte(semaineAvec({}), { aujourdhui: '2026-10-16', semaines: [semaineAvec({}), S2_VIDE] });
  assert.equal(reprise.titre, 'Que mange-t-on du 17 au 23 octobre\u00A0?');
  const finAvecVide = carte(SEMAINE, { aujourdhui: '2026-10-16', semaines: [SEMAINE, S2_VIDE] });
  assert.deepEqual(finAvecVide.suivante, { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' }, 'jamais « 2026-10-17-2 »');
  assert.equal(finAvecVide.boutons.at(-1).libelle, 'Préparer la semaine du 17 au 23 octobre');
  // Semaine sans plat qui finit dans 2 jours : les plats iront à la suivante, la carte le dit.
  assert.equal(carte(semaineAvec({}), { aujourdhui: '2026-10-15' }).titre, 'Que mange-t-on du 17 au 23 octobre\u00A0?');
  assert.equal(carte(semaineAvec({}), { aujourdhui: '2026-10-12' }).titre, 'Que mange-t-on cette semaine\u00A0?');
});

test('carteProchaineAction : « Courses : 7 articles », puis « encore N » ; plats et articles ajoutés à la main', () => {
  const liste = carte(SEMAINE, { articles: [{ id: 'a', libelle: 'piles' }] });
  assert.equal(liste.cas, 'liste');
  assert.equal(liste.titre, 'Courses\u00A0: 7\u00A0articles');
  assert.equal(liste.texte, '2\u00A0plats et 1\u00A0article ajouté à la main.');
  assert.deepEqual(liste.boutons, [{ action: 'courses', libelle: 'Faire les courses ›', principal: true }]);
  assert.equal(liste.fin, null);
  const encore = carte({ ...SEMAINE, coches: { pate: { q: { masse: 750 } } } }, { articles: [{ id: 'a', libelle: 'piles' }, { id: 'b', libelle: 'lessive' }] });
  assert.equal(encore.titre, 'Courses\u00A0: encore 7\u00A0articles');
  assert.equal(encore.texte, '2\u00A0plats et 2\u00A0articles ajoutés à la main.');
  const unSeul = carte(semaineAvec({ 'salade-pates': dans(1) }), { tousLesPlats: [{ ...SALADE, ingredients: [SALADE.ingredients[1], SALADE.ingredients[3]] }] });
  assert.equal(unSeul.titre, 'Courses\u00A0: 1\u00A0article');
  assert.equal(unSeul.texte, '1\u00A0plat.');
});

test('carteProchaineAction : plats sans recette seulement ; tout est dans le panier ; « Préparer la semaine du … »', () => {
  const sansRecette = carte(semaineAvec({ 'tarte-poireaux': dans(1) }));
  assert.deepEqual([sansRecette.cas, sansRecette.titre, sansRecette.texte], ['sansRecette', 'Courses',
    'Les plats choisis n’ont pas encore leur recette\u00A0: ajoutez leurs ingrédients à la main.']);
  assert.deepEqual(sansRecette.boutons, [{ action: 'courses', libelle: 'Faire les courses ›', principal: true }]);
  const coches = Object.fromEntries(calculer(SEMAINE).lignes.map((l) => [l.cle, valeurCoche(l.totaux, 1)]));
  const panier = carte({ ...SEMAINE, coches });
  // T3b : tant que les courses ne sont pas terminées, la carte invite à le dire dans Courses (« Bon appétit ! » vient
  // avec « Courses faites ✓ », coeur-t3b-courses.test.js).
  assert.deepEqual([panier.cas, panier.titre, panier.texte], ['panier', 'Tout est dans le panier 🎉', 'Dites-le dans Courses quand c’est fini.']);
  assert.deepEqual(panier.boutons, [{ action: 'courses', libelle: 'Voir la liste ›', principal: false }]);
  // Deux derniers jours : la semaine suivante se prépare (principal quand tout est dans le panier).
  const fin = carte({ ...SEMAINE, coches }, { aujourdhui: '2026-10-15' });
  assert.equal(fin.fin, 'Cette semaine se termine vendredi 16 octobre.');
  assert.deepEqual(fin.suivante, { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' });
  assert.deepEqual(fin.boutons, [{ action: 'courses', libelle: 'Voir la liste ›', principal: false },
    { action: 'preparer', libelle: 'Préparer la semaine du 17 au 23 octobre', principal: true }]);
  const finListe = carte(SEMAINE, { aujourdhui: '2026-10-16' });
  assert.deepEqual(finListe.boutons.map((b) => [b.action, b.principal]), [['courses', true], ['preparer', false]]);
  // Personne n'en mange : rien à acheter.
  const rien = carte(semaineAvec({ 'salade-pates': dans(1) }), { tousLesPlats: [{ ...SALADE, notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0 } }] });
  assert.deepEqual([rien.cas, rien.titre, rien.texte], ['rien', 'Rien à acheter pour l’instant', '1\u00A0plat.']);
});

// ——— Écritures d'un geste : une coche = un chemin ———

test('ecrituresCoche : un seul chemin `coches.<cle>`, la quantité affichée ; décocher efface (et la clé de repli)', () => {
  const liste = calculer(SEMAINE);
  const pates = ligne(liste, 'pate');
  assert.deepEqual(ecrituresCoche(SEMAINE, pates, true, { maintenant: 9 }), { id: '2026-10-10', champs: { 'coches.pate': { q: { masse: 750 }, le: 9 } } });
  assert.deepEqual(ecrituresCoche(SEMAINE, pates, false), { id: '2026-10-10', champs: { 'coches.pate': EFFACER } });
  const semaineRepli = semaineAvec({ a: dans(1) }, { coches: { oignon: { q: { pc: 4 }, le: 1 } } });
  const oignons = ligne(listeDeCourses(semaineRepli, { tousLesPlats: [telle('a', [ing('oignons', 2, 'pc', 'fruits_legumes')])], profils: SOLO }), 'oignon-jaune');
  assert.deepEqual(ecrituresCoche(semaineRepli, oignons, false).champs, { 'coches.oignon-jaune': EFFACER, 'coches.oignon': EFFACER });
  for (const [semaine, l] of [[null, pates], [SEMAINE, { ...pates, cle: 'a.b' }], [SEMAINE, null], [SEMAINE, { type: 'article', cle: 'x' }]]) {
    assert.deepEqual(ecrituresCoche(semaine, l, true), { code: 'invalide' });
  }
  assert.ok(champsValides(ecrituresCoche(SEMAINE, pates, true, { maintenant: 9 }).champs));
});

test('clé de repli : jamais celle d’un homographe ni d’une autre ligne (cocher « Pâtes » ne coche ni « Pâte » ni « Pâté »)', () => {
  const tarte = telle('tarte', [ing('pâtes', 400, 'g', 'epicerie_salee'), ing('pâte', 1, 'pc', 'epicerie_salee'),
    ing('pâté', 150, 'g', 'charcuterie'), ing('pate', 1, 'pc', 'epicerie_salee'), ing('thé', 2, 'sachet', 'boissons'),
    ing('the', 1, 'sachet', 'boissons'), ing('pâte brisée', 1, 'pc', 'epicerie_salee'), ing('pate brisee', 1, 'pc', 'epicerie_salee')]);
  const semaine = semaineAvec({ tarte: dans(1) });
  const options = { tousLesPlats: [tarte], profils: SOLO };
  const avant = listeDeCourses(semaine, options);
  const ids = ['pate', 'pate--pa3te', 'pate--pa3te1', 'pate--pate', 'the', 'the--the', 'pate-brisee', 'pate-brisee--pate'];
  assert.deepEqual(ids.map((id) => ligne(avant, id)?.repli), ids.map(() => null), 'aucune clé de repli');
  // Cocher les pâtes, le thé et la pâte brisée : seules ces trois lignes sont cochées.
  const coches = Object.fromEntries(['pate', 'the', 'pate-brisee'].map((id) => [id, valeurCoche(ligne(avant, id).totaux, 1)]));
  const apres = listeDeCourses({ ...semaine, coches }, options);
  assert.deepEqual(ids.map((id) => ligne(apres, id).cochee), [true, false, false, false, true, false, true, false]);
  assert.deepEqual(ids.map((id) => ligne(apres, id).dejaPris), ids.map(() => null), 'jamais « Déjà pris » d’un voisin');
  // Décocher le pâté n'efface que son chemin, jamais la coche des pâtes.
  const pate = ligne(listeDeCourses({ ...semaine, coches: { ...coches, 'pate--pa3te1': valeurCoche({ masse: 150 }, 1) } }, options), 'pate--pa3te1');
  assert.deepEqual(ecrituresCoche({ ...semaine, coches }, pate, false).champs, { 'coches.pate--pa3te1': EFFACER });
  // « À racheter » d'un voisin : jamais lu.
  assert.equal(ligne(listeDeCourses({ ...semaine, racheter: { pate: true } }, options), 'pate--pa3te1').rachetee, false);
  // Le repli d'un nom ordinaire appris par les produits courants reste (« oignons » → 'oignon').
  assert.equal(cleDeRepli('oignons', 'oignon-jaune'), 'oignon');
  assert.equal(cleDeRepli('pâté', 'pate--pa3te1'), null);
  assert.equal(cleDeRepli('pâtes courtes', 'pate'), null);
  assert.equal(cleDeRepli('oignon jaune', 'oignon-jaune'), null);
});

test('coches : deux coches posées en même temps (deux téléphones, hors ligne) restent toutes les deux', () => {
  const liste = calculer(SEMAINE);
  const ici = ecrituresCoche(SEMAINE, ligne(liste, 'pate'), true, { maintenant: 1 });
  const labas = ecrituresCoche(SEMAINE, ligne(liste, 'tomate'), true, { maintenant: 2 });
  assert.deepEqual(Object.keys(ici.champs).filter((c) => Object.hasOwn(labas.champs, c)), [], 'aucun chemin commun');
  const fusion = appliquerChamps(appliquerChamps(SEMAINE, labas.champs), ici.champs);
  const apres = calculer(fusion);
  assert.deepEqual([ligne(apres, 'pate').cochee, ligne(apres, 'tomate').cochee], [true, true]);
  // L'autre téléphone ajoute un plat qui demande plus de pâtes : la ligne revient, « Déjà pris ».
  const plus = calculer({ ...fusion, plats: { ...fusion.plats, 'salade-pates': dans(2, { repas: 3 }) } });
  assert.equal(ligne(plus, 'pate').cochee, false);
  assert.equal(texteDejaPris(ligne(plus, 'pate')), 'Déjà pris\u00A0: 750\u00A0g · encore 500\u00A0g');
});

test('ecrituresCocheArticle et ecrituresRachat : un seul champ chacun', () => {
  const [article] = calculer(SEMAINE, { articles: [{ id: 'Ab12', libelle: 'piles' }] }).articles;
  assert.deepEqual(ecrituresCocheArticle(article, true, { maintenant: 4 }), { articleId: 'Ab12', champs: { coche: { le: 4 } } });
  assert.deepEqual(ecrituresCocheArticle(article, false), { articleId: 'Ab12', champs: { coche: EFFACER } });
  assert.deepEqual(ecrituresCocheArticle(ligne(calculer(SEMAINE), 'pate'), true), { code: 'invalide' });
  assert.deepEqual(ecrituresRachat(SEMAINE, 'sel', true), { id: '2026-10-10', champs: { 'racheter.sel': true } });
  assert.deepEqual(ecrituresRachat(SEMAINE, 'sel', false), { id: '2026-10-10', champs: { 'racheter.sel': EFFACER } });
  assert.deepEqual(ecrituresRachat(SEMAINE, 'Sel', true), { code: 'invalide' });
  assert.deepEqual(ecrituresRachat(null, 'sel', true), { code: 'invalide' });
  // « À racheter » rangé sous la clé de repli : éteindre l'efface aussi (sinon la ligne resterait rachetée).
  const rangee = { ...SEMAINE, racheter: { oignon: true } };
  assert.deepEqual(ecrituresRachat(rangee, 'oignon-jaune', false, { repli: 'oignon' }).champs,
    { 'racheter.oignon-jaune': EFFACER, 'racheter.oignon': EFFACER });
  assert.deepEqual(ecrituresRachat(SEMAINE, 'oignon-jaune', false, { repli: 'oignon' }).champs, { 'racheter.oignon-jaune': EFFACER });
  assert.deepEqual(ecrituresRachat(rangee, 'oignon-jaune', true, { repli: 'oignon' }).champs, { 'racheter.oignon-jaune': true });
  // Plusieurs clés de repli : éteindre efface chacune de celles qui sont posées.
  const deux = { ...SEMAINE, racheter: { 'farine-t55': true, 'farine-fluide': true } };
  assert.deepEqual(ecrituresRachat(deux, 'farine', false, { replis: ['farine-t55', 'farine-fluide', 'farine-blanche'] }).champs,
    { 'racheter.farine': EFFACER, 'racheter.farine-t55': EFFACER, 'racheter.farine-fluide': EFFACER });
});

test('liste calculée, jamais écrite : calculer la liste ne produit aucune écriture ni ne modifie la semaine', () => {
  const semaine = geler(structuredClone({ ...SEMAINE, coches: { pate: { q: { masse: 600 }, le: 1 } }, racheter: { sel: true } }));
  const avant = JSON.stringify(semaine);
  const liste = calculer(semaine);
  grouperParRayon(liste);
  restes(liste, semaine);
  assert.equal(JSON.stringify(semaine), avant);
  assert.equal(Object.isFrozen(liste), false, 'résultat neuf, que l’écran peut garder');
});

test('texteAjoutArticle et bandeauxCourses : annonces de « Ajouter à la liste » et bandeaux de Courses', () => {
  assert.equal(texteAjoutArticle('piles'), '✓ «\u00A0Piles\u00A0» ajouté.');
  assert.equal(texteAjoutArticle('lait', { nom: 'Lait', quantite: '6\u00A0l' }), '✓ «\u00A0Lait\u00A0» ajouté. Il y en a aussi 6\u00A0l pour vos plats.');
  assert.equal(texteAjoutArticle('persil', { nom: 'Persil', quantite: '' }), '✓ «\u00A0Persil\u00A0» ajouté. Il y en a aussi pour vos plats.');
  const un = bandeauxCourses(calculer(semaineAvec({ 'tarte-poireaux': dans(1) })));
  assert.deepEqual(un, { sansRecette: '«\u00A0Tarte aux poireaux\u00A0» n’a pas encore sa recette\u00A0: ajoutez ses ingrédients à la main.', aVerifier: [] });
  const deux = bandeauxCourses({ sansRecette: [{ nom: 'A' }, { nom: 'B' }], aVerifier: [] });
  assert.equal(deux.sansRecette, '2\u00A0plats n’ont pas encore leur recette\u00A0: «\u00A0A\u00A0» et «\u00A0B\u00A0». Ajoutez leurs ingrédients à la main.');
  const verifier = listeSolo(telle('a', [ing('persil', 1, 'bouquet', 'fruits_legumes'), ing('riz', 'x', 'g', 'epicerie_salee')], { nom: 'Gratin' }));
  assert.deepEqual(bandeauxCourses(verifier), { sansRecette: null, aVerifier: ['Une quantité de «\u00A0Gratin\u00A0» n’a pas pu être comptée\u00A0: vérifiez la recette.'] });
  assert.deepEqual(bandeauxCourses(null), { sansRecette: null, aVerifier: [] });
});

