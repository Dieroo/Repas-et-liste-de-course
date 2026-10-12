// T3b « Au drive » : coeur/liste.js (drive dans les réglages des courses, mot cherché d'une ligne et « Au drive, je
// cherche », mode Drive, « Courses terminées » : statut, articles achetés retirés, restes gardés, dates des plats,
// « Annuler », lignes arrivées depuis, carte de Semaine) et coeur/semaine.js (« Rouvrir la liste », articles gardés).
// Fixtures génériques, domaines fictifs.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireRegime } from '../js/coeur/regles.js';
import { BAREME_AGE, regleDuPalier } from '../js/coeur/age.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import {
  TEXTES_FIN_DES_COURSES, articleGardeDeLaLigne, carteProchaineAction, coursesFaites, ecrituresCoche,
  ecrituresDernieresFois, ecrituresRecherche, ecrituresRouvrirListe, grouperDrive, grouperParRayon, lignesAjouteesDepuis,
  listeDeCourses, phraseRestesFin, preparerFinDesCourses, reglagesCourses, restes, restesFinDesCourses, texteAjoutesDepuis,
  texteCoursesFaites, valeurCoche,
} from '../js/coeur/liste.js';
import {
  EFFACER, PREFIXE_GARDE, appliquerChamps, articlesDesRestes, champsValides, ecrituresAjout, ecrituresRouvrir,
  gardesDeLaSemaine, idGarde, idReste, lireSemaine, peutPreparerLaSuivante, platsDeLaSemaine, statutSemaine,
} from '../js/coeur/semaine.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const MIEL = regleDuPalier(BAREME_AGE.find((e) => e.code === 'miel'), 0);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [MIEL] };
const PROFILS = [A, B, E];
const SOLO = [A];

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
const GRATIN = plat('gratin-pates-jambon', 'Gratin de pâtes au jambon', [
  ing('pâtes courtes', 400, 'g', 'epicerie_salee', ['feculent']),
  JAMBON,
  ing('crème fraîche épaisse', 20, 'cl', 'cremerie', ['laitier']),
  ing('gruyère râpé', 100, 'g', 'fromages', ['laitier']),
], { variantes: [MER] });
const SALADE = plat('salade-pates', 'Salade de pâtes', [
  ing('pâtes', 200, 'g', 'epicerie_salee', ['feculent']),
  ing('tomate', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
  ing("huile d'olive", 2, 'cs', 'epicerie_salee'),
  ing('sel', 1, 'pincee', 'epicerie_salee'),
], { portionsBase: 2, derniereFois: '2026-09-27' });
const TARTE = { id: 'tarte-poireaux', nom: 'Tarte aux poireaux' };
const JETE = { ...plat('jete', 'Plat jeté', [ing('riz', 100, 'g', 'epicerie_salee')]), corbeille: { le: 1, par: 'x@exemple.fr' } };
const BOUDE = { ...plat('boude', 'Plat boudé', [ing('riz', 100, 'g', 'epicerie_salee')]), notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0 } };
const TOUS = [GRATIN, SALADE, TARTE, JETE, BOUDE];

const H = (iso) => new Date(iso).getTime();
const CREEE = H('2026-10-10T09:00:00+02:00');
const FIN = H('2026-10-10T11:30:00+02:00'); // heure de « Courses terminées »
const S1 = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: CREEE };
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
const semaineAvec = (plats, extra = {}) => ({ ...S1, plats, ...extra });
const SEMAINE = semaineAvec({ 'gratin-pates-jambon': dans(1), 'salade-pates': dans(2) });
/** Semaine dont les courses ont commencé : jambon pris, pâtes prises en partie (600 g sur 750). */
const COMMENCEE = { ...SEMAINE, coches: { 'jambon-blanc': { q: { tranche: 3 }, le: 1 }, pate: { q: { masse: 600 }, le: 1 } } };
const calculer = (semaine, extra = {}) => listeDeCourses(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer, ...extra });
const ligne = (liste, produitId) => [...liste.lignes, ...liste.maison].find((l) => l.produitId === produitId);
const telle = (id, ingredients, extra = {}) => plat(id, `Plat ${id}`, ingredients, { portionsBase: 2, ...extra });

const ARTICLES = [
  { id: 'piles', libelle: 'piles', creePar: 'a@exemple.fr', creeLe: CREEE + 5 },
  { id: 'lessive', libelle: 'lessive', creeLe: CREEE + 6, coche: { le: CREEE + 60 } },
  { id: 'vieux', libelle: 'ampoule', creeLe: CREEE - 9e8, coche: { le: CREEE - 8e8 } }, // coché pendant des courses d'avant : caché
];

/** Fin des courses sur COMMENCEE, avec les articles. */
function fin(options = {}, semaine = COMMENCEE) {
  const liste = calculer(semaine, { articles: ARTICLES });
  return preparerFinDesCourses(semaine, {
    liste, articles: ARTICLES, tousLesPlats: TOUS, profils: PROFILS, evaluer, auteur: ' b@exemple.fr ',
    aujourdhui: '2026-10-10', maintenant: FIN, ...options,
  });
}

function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

// Aucun mot technique ni code dans un texte affiché ; espaces insécables devant « : ! ? » et dans « ».
function textePropre(texte) {
  assert.equal(typeof texte, 'string');
  assert.doesNotMatch(texte, /undefined|null|NaN|\[object|json|slug|courses_faites|statut|[{}_]/i, texte);
  assert.doesNotMatch(texte, / [:;!?»]|« /, `espace insécable attendue : ${texte}`);
}

const MODELE = 'https://drive.exemple.fr/recherche?text={q}';

// ——— Réglages des courses : le drive ———

test('reglagesCourses : drive absent → null ; réglé → { nom, urlRecherche } ; illisible → null ; rayons inchangés', () => {
  assert.equal(reglagesCourses(null).drive, null);
  assert.equal(reglagesCourses({}).drive, null);
  assert.deepEqual(reglagesCourses({ drive: { nom: 'drive.exemple.fr', urlRecherche: MODELE } }).drive,
    { nom: 'drive.exemple.fr', urlRecherche: MODELE });
  assert.deepEqual(reglagesCourses({ drive: { urlRecherche: MODELE } }).drive, { nom: 'drive.exemple.fr', urlRecherche: MODELE });
  for (const drive of [{ urlRecherche: 'javascript:{q}' }, { urlRecherche: 'http://drive.exemple.fr/?q={q}' },
    { urlRecherche: 'https://drive.exemple.fr/?q=courgette' }, 'https://drive.exemple.fr/?q={q}', []]) {
    assert.equal(reglagesCourses({ drive }).drive, null, JSON.stringify(drive));
  }
  const avecDrive = reglagesCourses({ drive: { urlRecherche: MODELE }, rayons: ['boissons'] });
  assert.equal(avecDrive.rayons[0], 'boissons');
  assert.deepEqual(avecDrive.apero, { incontournables: [] });
});

// ——— Mot cherché d'une ligne ———

test('liste : recherche = le nom ; le mot du foyer l’emporte (`rechercheFoyer`) ; articles aussi', () => {
  const sans = calculer(SEMAINE, { articles: [{ id: 'a', libelle: 'Piles AA' }] });
  assert.deepEqual([ligne(sans, 'pate').recherche, ligne(sans, 'pate').rechercheFoyer], ['pâtes', null]);
  assert.deepEqual([sans.articles[0].recherche, sans.articles[0].rechercheFoyer], ['Piles AA', null]);
  const produitsFoyer = { pate: { rechercheDrive: ' penne ' }, 'pile-aa': { rechercheDrive: 'piles LR6' }, tomate: { rechercheDrive: '  ' } };
  const avec = calculer(SEMAINE, { articles: [{ id: 'a', libelle: 'Piles AA' }], produitsFoyer });
  assert.deepEqual([ligne(avec, 'pate').recherche, ligne(avec, 'pate').rechercheFoyer], ['penne', 'penne']);
  assert.deepEqual([avec.articles[0].recherche, avec.articles[0].rechercheFoyer], ['piles LR6', 'piles LR6']);
  assert.deepEqual([ligne(avec, 'tomate').recherche, ligne(avec, 'tomate').rechercheFoyer], ['tomate', null], 'mot vide : le nom');
  // Une Map marche aussi.
  assert.equal(ligne(calculer(SEMAINE, { produitsFoyer: new Map([['pate', { rechercheDrive: 'penne' }]]) }), 'pate').recherche, 'penne');
});

test('liste : mot cherché posé sous une clé de repli (comme une coche) ; jamais celui d’un homographe', () => {
  // « farine t55 » : id « farine » depuis le 2026-10-11 ; un mot posé avant sous « farine-t55 » reste lu.
  const p = telle('p', [ing('farine t55', 200, 'g', 'epicerie_sucree')]);
  const semaine = semaineAvec({ p: dans(1) });
  const lu = ligne(listeDeCourses(semaine, { tousLesPlats: [p], profils: SOLO, produitsFoyer: { 'farine-t55': { rechercheDrive: 'farine T55' } } }), 'farine');
  assert.deepEqual([lu.replis, lu.recherche, lu.rechercheFoyer], [['farine-t55'], 'farine T55', 'farine T55']);
  // Le produit de la ligne a un document sans mot (T3d : un rayon) : le mot de la clé de repli reste lu.
  const doc = ligne(listeDeCourses(semaine, { tousLesPlats: [p], profils: SOLO,
    produitsFoyer: { farine: { rayon: 'epicerie_sucree' }, 'farine-t55': { rechercheDrive: 'farine T55' } } }), 'farine');
  assert.equal(doc.recherche, 'farine T55');
  // Le mot du produit lui-même passe avant.
  const deux = ligne(listeDeCourses(semaine, { tousLesPlats: [p], profils: SOLO,
    produitsFoyer: { farine: { rechercheDrive: 'farine bio' }, 'farine-t55': { rechercheDrive: 'farine T55' } } }), 'farine');
  assert.equal(deux.recherche, 'farine bio');
  // « pâté » n'hérite jamais du mot cherché des pâtes.
  const pate = telle('q', [ing('pâté', 100, 'g', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'hachee' })]);
  const pateLigne = listeDeCourses(semaineAvec({ q: dans(1) }), { tousLesPlats: [pate], profils: SOLO, produitsFoyer: { pate: { rechercheDrive: 'penne' } } })
    .lignes[0];
  assert.deepEqual([pateLigne.produitId, pateLigne.recherche, pateLigne.rechercheFoyer], ['pate--pa3te1', 'pâté', null]);
});

test('ecrituresRecherche : un mot → produits/<id>.rechercheDrive ; 60 caractères au plus ; produit illisible refusé', () => {
  const pates = ligne(calculer(SEMAINE), 'pate');
  assert.deepEqual(ecrituresRecherche(pates, '  penne   rigate '), { terme: 'penne rigate', ecritures: [{ id: 'pate', champs: { rechercheDrive: 'penne rigate' } }] });
  assert.deepEqual(ecrituresRecherche(pates, 'x'.repeat(61)), { erreur: 'long' });
  assert.equal(ecrituresRecherche(pates, 'x'.repeat(60)).terme, 'x'.repeat(60));
  assert.deepEqual(ecrituresRecherche({ produitId: '' }, 'penne'), { code: 'invalide' });
  assert.deepEqual(ecrituresRecherche({ produitId: 'a.b' }, 'penne'), { code: 'invalide' });
  assert.deepEqual(ecrituresRecherche(null, 'penne'), { code: 'invalide' });
  // Un article ajouté à la main : son produit.
  const article = calculer(SEMAINE, { articles: [{ id: 'a', libelle: 'piles' }] }).articles[0];
  assert.deepEqual(ecrituresRecherche(article, 'piles LR6').ecritures, [{ id: article.produitId, champs: { rechercheDrive: 'piles LR6' } }]);
  for (const { champs } of ecrituresRecherche(pates, 'penne').ecritures) assert.equal(champsValides(champs), true);
});

test('ecrituresRecherche : vide ou le nom de la ligne → « Revenir à … » : le mot effacé sous chaque clé qui en porte un', () => {
  const p = telle('p', [ing('farine t55', 200, 'g', 'epicerie_sucree')]);
  const produitsFoyer = { farine: { rechercheDrive: 'farine bio', rayon: 'epicerie_sucree' }, 'farine-t55': { rechercheDrive: 'farine T55' } };
  const farine = ligne(listeDeCourses(semaineAvec({ p: dans(1) }), { tousLesPlats: [p], profils: SOLO, produitsFoyer }), 'farine');
  const attendu = { terme: null, ecritures: [
    { id: 'farine', champs: { rechercheDrive: EFFACER } }, { id: 'farine-t55', champs: { rechercheDrive: EFFACER } },
  ] };
  assert.deepEqual(ecrituresRecherche(farine, '', { produitsFoyer }), attendu);
  assert.deepEqual(ecrituresRecherche(farine, '  FARINE t55 ', { produitsFoyer }), attendu, 'le nom de la ligne, casse ignorée');
  // Aucun mot posé : rien à écrire.
  assert.deepEqual(ecrituresRecherche(farine, '', { produitsFoyer: {} }), { terme: null, ecritures: [] });
  // Un nom sans accent n'est pas le nom de la ligne : c'est un mot choisi.
  const pates = ligne(calculer(SEMAINE), 'pate');
  assert.equal(ecrituresRecherche(pates, 'pates').terme, 'pates');
});

// ——— Mode Drive ———

test('grouperDrive : « Pour cette semaine » (plats et articles) puis « Dans le panier », par rayon puis par nom, sans en-têtes', () => {
  const semaine = { ...SEMAINE, coches: { 'jambon-blanc': { q: { tranche: 3 }, le: 1 } } };
  const liste = calculer(semaine, { articles: [{ id: 'a', libelle: 'piles' }, { id: 'b', libelle: 'courgette', coche: { le: CREEE + 1 } }] });
  const drive = grouperDrive(liste);
  assert.deepEqual(drive.pourCetteSemaine.map((l) => l.nom), ['Tomate', 'Crème fraîche épaisse', 'Gruyère râpé', 'Pâtes', 'Thon au naturel', 'Piles']);
  assert.deepEqual(drive.panier.map((l) => l.nom), ['Courgette', 'Jambon blanc']);
  assert.deepEqual(drive.commeChaqueSemaine, [], 'vide jusqu’à T3d');
  assert.deepEqual(drive.maison.map((l) => l.produitId), liste.maison.map((l) => l.produitId));
  // Mêmes comptes que le mode Magasin.
  const magasin = grouperParRayon(liste);
  assert.deepEqual([drive.total, drive.pris, drive.vide], [magasin.total, magasin.pris, magasin.vide]);
  assert.deepEqual([drive.total, drive.pris], [8, 2]);
  // Ordre des rayons du foyer.
  const rayons = reglagesCourses({ rayons: ['epicerie_salee', 'divers'] }).rayons;
  assert.deepEqual(grouperDrive(liste, { rayons }).pourCetteSemaine.map((l) => l.nom),
    ['Pâtes', 'Thon au naturel', 'Piles', 'Tomate', 'Crème fraîche épaisse', 'Gruyère râpé']);
  // Liste vide.
  assert.deepEqual(grouperDrive(null), { pourCetteSemaine: [], commeChaqueSemaine: [], panier: [], maison: [], total: 0, pris: 0, vide: true });
});

// ——— « Courses terminées » ———

test('restesFinDesCourses et phraseRestesFin : lignes pas cochées (le reste d’une ligne prise en partie), puis articles', () => {
  const liste = calculer(COMMENCEE, { articles: ARTICLES });
  const r = restesFinDesCourses(liste);
  assert.deepEqual(r.map((x) => [x.type, x.libelle, x.precision]), [
    ['ligne', 'tomate', '3'], ['ligne', 'crème fraîche épaisse', '25 cl'], ['ligne', 'gruyère râpé', '130 g'],
    ['ligne', 'pâtes', '150 g'], ['ligne', 'thon au naturel', '100 g'], ['article', 'piles', ''],
  ]);
  assert.equal(r.at(-1).articleId, 'piles');
  assert.equal(phraseRestesFin(r), 'Il reste 6 articles : tomate, crème fraîche épaisse, gruyère râpé et 3 autres.');
  assert.equal(phraseRestesFin([{ libelle: 'beurre' }, { libelle: 'sel' }, { libelle: 'piles' }]), 'Il reste 3 articles : beurre, sel et piles.');
  assert.equal(phraseRestesFin([{ libelle: 'beurre' }]), 'Il reste 1 article : beurre.');
  assert.equal(phraseRestesFin([]), '');
  // Tout coché : rien ne reste (« Courses terminées » finit tout de suite).
  const coches = Object.fromEntries(calculer(SEMAINE).lignes.map((l) => [l.cle, valeurCoche(l.totaux, 1)]));
  assert.deepEqual(restesFinDesCourses(calculer({ ...SEMAINE, coches })), []);
  for (const texte of [phraseRestesFin(r), phraseRestesFin([{ libelle: 'beurre' }])]) textePropre(texte);
});

test('restesFinDesCourses, preparerFinDesCourses : un article pas coché du même produit qu’une ligne → nommé une fois, jamais doublé', () => {
  // « tomate » ajoutée à la main, et la ligne « tomate » des plats : ni l'une ni l'autre n'est prise au drive.
  const main = { id: 'tomate-main', libelle: 'tomate', creePar: 'a@exemple.fr', creeLe: CREEE + 7 };
  const articles = [...ARTICLES, main];
  const liste = calculer(COMMENCEE, { articles });
  assert.equal(liste.articles.filter((a) => a.produitId === 'tomate').length, 1, 'la liste garde ses deux lignes (T3a)');
  const r = restesFinDesCourses(liste);
  assert.deepEqual(r.filter((x) => x.produitId === 'tomate').map((x) => [x.type, x.libelle, x.precision]), [['ligne', 'tomate', '3']]);
  assert.equal(r.length, 6);
  assert.equal(phraseRestesFin(restesFinDesCourses(calculer(SEMAINE, { articles: [main] }))).match(/tomate/g).length, 1);
  // Deux articles du même produit (à la main et un reste d'avant) : nommés une fois aussi.
  const reste = { id: idReste('2026-10-10', 'piles'), libelle: 'piles', precision: '4', creeLe: CREEE + 8 };
  const deux = restesFinDesCourses(calculer(COMMENCEE, { articles: [...ARTICLES, reste] }));
  assert.deepEqual(deux.filter((x) => x.libelle === 'piles').map((x) => x.articleId), ['piles']);
  // « Les garder » : aucun article gardé pour la tomate, l'article à la main reste tel quel (jamais deux « Tomate »).
  const fini = preparerFinDesCourses(COMMENCEE, { liste, articles, tousLesPlats: TOUS, profils: PROFILS, evaluer, garder: true,
    aujourdhui: '2026-10-10', maintenant: FIN });
  assert.equal(fini.lot.articles.some((a) => a.id === idGarde('2026-10-10', 'tomate')), false);
  assert.deepEqual(fini.lot.articles.map((a) => a.libelle), ['crème fraîche épaisse', 'gruyère râpé', 'pâtes', 'thon au naturel']);
  assert.equal(fini.gardes, 4);
  assert.equal(fini.lot.supprimer.includes(main.id), false);
  assert.equal(fini.avant.articles.some((a) => a.id === main.id), false);
  // La liste de la semaine suivante : une seule « tomate » à acheter.
  const restants = [...articles.filter((a) => !fini.lot.supprimer.includes(a.id)), ...fini.lot.articles];
  const suivante = listeDeCourses(null, { articles: restants, maintenant: FIN + 1 });
  assert.equal(suivante.articles.filter((a) => a.produitId === 'tomate' && !a.cochee).length, 1);
  // Même règle pour les restes d'une semaine suivante (T3a) : la tomate a déjà son article, elle n'en reçoit pas un de plus.
  assert.deepEqual(restes(liste, COMMENCEE).map((x) => x.libelle), ['crème fraîche épaisse', 'gruyère râpé', 'pâtes', 'thon au naturel']);
  assert.equal(restes(calculer(COMMENCEE, { articles: ARTICLES }), COMMENCEE).some((x) => x.produitId === 'tomate'), true);
});

test('preparerFinDesCourses : brouillon → courses faites, sans statutAvant ; date, auteur et heure du téléphone', () => {
  const r = fin();
  assert.deepEqual(r.lot.champs, {
    statut: 'courses_faites', coursesFaitesLe: '2026-10-10', coursesFaitesPar: 'b@exemple.fr', coursesFaitesA: FIN,
  });
  assert.equal(r.lot.id, '2026-10-10');
  assert.equal(champsValides(r.lot.champs), true);
  // Validée (T4) : le statut d'avant est retenu, pour « Rouvrir la liste ».
  assert.equal(fin({}, { ...COMMENCEE, statut: 'validee' }).lot.champs.statutAvant, 'validee');
  // Un statutAvant qui traînerait est effacé ; sans auteur, coursesFaitesPar n'est pas écrit (effacé s'il traînait).
  const vieux = fin({ auteur: null }, { ...COMMENCEE, statutAvant: 'validee', coursesFaitesPar: 'x@exemple.fr' });
  assert.equal(vieux.lot.champs.statutAvant, EFFACER);
  assert.equal(vieux.lot.champs.coursesFaitesPar, EFFACER);
  assert.equal('coursesFaitesPar' in fin({ auteur: '' }).lot.champs, false);
});

test('preparerFinDesCourses : jamais en arrière (déjà faites, batch fait) ; semaine, date ou heure illisibles refusées', () => {
  assert.deepEqual(fin({}, { ...COMMENCEE, statut: 'courses_faites' }), { code: 'deja' });
  assert.deepEqual(fin({}, { ...COMMENCEE, statut: 'batch_fait' }), { code: 'deja' });
  assert.deepEqual(fin({}, { ...COMMENCEE, id: 'a/b' }), { code: 'invalide' });
  assert.deepEqual(fin({ aujourdhui: '2026-02-30' }), { code: 'invalide' });
  assert.deepEqual(fin({ maintenant: null }), { code: 'invalide' });
  assert.deepEqual(preparerFinDesCourses(null, { aujourdhui: '2026-10-10', maintenant: 1 }), { code: 'invalide' });
});

test('preparerFinDesCourses : « Les garder pour la prochaine fois » : une ligne restante = un article (la quantité qui manque)', () => {
  const r = fin({ garder: true });
  assert.deepEqual(r.lot.articles, [
    { id: 'garde--2026-10-10--tomate', libelle: 'tomate', precision: '3', creePar: 'b@exemple.fr', creeLe: FIN },
    { id: 'garde--2026-10-10--creme-fraiche-epaisse', libelle: 'crème fraîche épaisse', precision: '25 cl', creePar: 'b@exemple.fr', creeLe: FIN },
    { id: 'garde--2026-10-10--gruyere-rape', libelle: 'gruyère râpé', precision: '130 g', creePar: 'b@exemple.fr', creeLe: FIN },
    // Pâtes prises en partie (600 g sur 750) : la précision est le reste, pas le total.
    { id: 'garde--2026-10-10--pate', libelle: 'pâtes', precision: '150 g', creePar: 'b@exemple.fr', creeLe: FIN },
    { id: 'garde--2026-10-10--thon-au-naturel', libelle: 'thon au naturel', precision: '100 g', creePar: 'b@exemple.fr', creeLe: FIN },
  ]);
  assert.equal(r.gardes, 5);
  // Tous les articles cochés supprimés, cachés compris ; l'article pas coché (piles) reste tel quel.
  assert.deepEqual(r.lot.supprimer, ['lessive', 'vieux']);
  // Ni le placard (huile, sel), ni le jambon coché ne sont gardés.
  assert.equal(r.lot.articles.some((a) => /huile|sel|jambon/.test(a.libelle)), false);
});

test('preparerFinDesCourses : « Terminer sans eux » : aucun article créé, les articles pas cochés supprimés aussi', () => {
  const r = fin({ garder: false });
  assert.deepEqual(r.lot.articles, []);
  assert.deepEqual(r.lot.supprimer, ['piles', 'lessive', 'vieux']);
  assert.equal(r.gardes, 0);
  assert.deepEqual(r.avant.articles.map((a) => a.id), ['piles', 'lessive', 'vieux']);
  assert.deepEqual(r.avant.supprimer, []);
});

test('preparerFinDesCourses : rien ne reste → aucun article créé, seuls les cochés partent', () => {
  const coches = Object.fromEntries(calculer(SEMAINE).lignes.map((l) => [l.cle, valeurCoche(l.totaux, 1)]));
  const semaine = { ...SEMAINE, coches };
  const articles = [ARTICLES[1]];
  const r = preparerFinDesCourses(semaine, { liste: calculer(semaine, { articles }), articles, tousLesPlats: TOUS, profils: PROFILS,
    evaluer, aujourdhui: '2026-10-10', maintenant: FIN });
  assert.deepEqual([r.lot.articles, r.lot.supprimer], [[], ['lessive']]);
});

test('preparerFinDesCourses : derniereFois = début de la semaine, pour chaque plat cuisiné (⏳ compris), jamais en arrière', () => {
  const semaine = semaineAvec({
    'gratin-pates-jambon': dans(1), 'salade-pates': dans(2), 'tarte-poireaux': dans(3), jete: dans(4), boude: dans(5),
    retire: dans(6, { retire: true }), disparu: dans(7),
  });
  const tous = [...TOUS, plat('retire', 'Retiré', [ing('riz', 100, 'g', 'epicerie_salee')])];
  const r = preparerFinDesCourses(semaine, { liste: listeDeCourses(semaine, { tousLesPlats: tous, profils: PROFILS, evaluer }),
    tousLesPlats: tous, profils: PROFILS, evaluer, aujourdhui: '2026-10-11', maintenant: FIN });
  assert.deepEqual(r.derniereFois, [
    { platId: 'gratin-pates-jambon', avant: null, apres: '2026-10-10' },
    { platId: 'salade-pates', avant: '2026-09-27', apres: '2026-10-10' },
    { platId: 'tarte-poireaux', avant: null, apres: '2026-10-10' },
  ], 'ni corbeille, ni personne n’en mange, ni retiré, ni supprimé');
  // Une date plus récente (ou égale) reste ; une date illisible est remplacée.
  const plusTard = [{ ...GRATIN, derniereFois: '2026-10-17' }, { ...SALADE, derniereFois: '2026-10-10' }, { ...TARTE, derniereFois: 'hier' }];
  const r2 = preparerFinDesCourses(semaine, { tousLesPlats: plusTard, profils: PROFILS, evaluer, aujourdhui: '2026-10-11', maintenant: FIN });
  assert.deepEqual(r2.derniereFois, [{ platId: 'tarte-poireaux', avant: 'hier', apres: '2026-10-10' }]);
  // Un horodatage est lu à sa date locale.
  const horodate = { ...GRATIN, derniereFois: { seconds: Date.UTC(2026, 9, 9, 22, 30) / 1000, nanoseconds: 0 } }; // 10 oct. 0 h 30 à Paris
  assert.deepEqual(preparerFinDesCourses(semaineAvec({ 'gratin-pates-jambon': dans(1) }), { tousLesPlats: [horodate], profils: PROFILS,
    evaluer, aujourdhui: '2026-10-11', maintenant: FIN }).derniereFois, []);
  // Les plats de la semaine peuvent venir de l'écran (platsDeLaSemaine).
  const plats = platsDeLaSemaine(semaine, { tousLesPlats: tous, profils: PROFILS, evaluer });
  assert.deepEqual(preparerFinDesCourses(semaine, { plats, aujourdhui: '2026-10-11', maintenant: FIN }).derniereFois, r.derniereFois);
});

test('ecrituresDernieresFois : la date de la semaine, une écriture par plat ; « Annuler » remet l’ancienne ou l’efface', () => {
  const { derniereFois } = fin();
  assert.deepEqual(ecrituresDernieresFois(derniereFois), [
    { platId: 'gratin-pates-jambon', champs: { derniereFois: '2026-10-10' } },
    { platId: 'salade-pates', champs: { derniereFois: '2026-10-10' } },
  ]);
  assert.deepEqual(ecrituresDernieresFois(derniereFois, { annuler: true }), [
    { platId: 'gratin-pates-jambon', champs: { derniereFois: EFFACER } },
    { platId: 'salade-pates', champs: { derniereFois: '2026-09-27' } },
  ]);
  assert.deepEqual(ecrituresDernieresFois([{ platId: 'a/b', apres: '2026-10-10' }, null]), []);
  for (const { champs } of ecrituresDernieresFois(derniereFois)) assert.deepEqual(Object.keys(champs), ['derniereFois']);
});

test('preparerFinDesCourses : « Annuler » remet tout comme avant (statut, articles, dates)', () => {
  for (const [semaine, garder] of [[COMMENCEE, true], [COMMENCEE, false], [{ ...COMMENCEE, statut: 'validee' }, true]]) {
    const r = fin({ garder }, semaine);
    // Statut et traces : chaque champ écrit revient à sa valeur d'avant (ou part).
    const apres = appliquerChamps(semaine, r.lot.champs);
    assert.equal(statutSemaine(apres), 'courses_faites');
    const remise = appliquerChamps(apres, r.avant.champs);
    assert.deepEqual(remise, semaine);
    assert.deepEqual(Object.keys(r.avant.champs).sort(), Object.keys(r.lot.champs).sort());
    assert.equal(r.avant.id, semaine.id);
    // Articles : les supprimés reviennent tels qu'ils étaient, les créés repartent.
    let articles = new Map(ARTICLES.map((a) => [a.id, a]));
    for (const id of r.lot.supprimer) articles.delete(id);
    for (const { id, ...donnees } of r.lot.articles) articles.set(id, { id, ...donnees });
    for (const id of r.avant.supprimer) articles.delete(id);
    for (const a of r.avant.articles) articles.set(a.id, a);
    articles = [...articles.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    assert.deepEqual(articles, [...ARTICLES].sort((a, b) => (a.id < b.id ? -1 : 1)));
  }
});

test('preparerFinDesCourses : un article gardé du même identifiant qu’un article existant le remplace (jamais doublé), « Annuler » le rend', () => {
  // Fin, puis rouvert ailleurs sans que l'article gardé « tomate » soit retiré (coché depuis) : il est remplacé.
  const ancien = { id: 'garde--2026-10-10--tomate', libelle: 'tomate', precision: '1', creeLe: CREEE + 1, coche: { le: CREEE + 2 } };
  const articles = [...ARTICLES, ancien];
  const r = preparerFinDesCourses(COMMENCEE, { liste: calculer(COMMENCEE, { articles }), articles, tousLesPlats: TOUS, profils: PROFILS,
    evaluer, aujourdhui: '2026-10-10', maintenant: FIN });
  assert.equal(r.lot.supprimer.includes(ancien.id), false, 'écrit par set sans fusion, jamais supprimé dans le même lot');
  assert.equal(r.lot.articles.filter((a) => a.id === ancien.id).length, 1);
  assert.deepEqual(r.avant.articles.find((a) => a.id === ancien.id), ancien);
  assert.equal(r.avant.supprimer.includes(ancien.id), false);
});

test('preparerFinDesCourses : entrées jamais modifiées ; aucune valeur undefined', () => {
  const semaine = geler(structuredClone(COMMENCEE));
  const articles = geler(structuredClone(ARTICLES));
  const liste = geler(calculer(COMMENCEE, { articles: ARTICLES }));
  const tous = geler(structuredClone(TOUS));
  const r = preparerFinDesCourses(semaine, { liste, articles, tousLesPlats: tous, profils: PROFILS, evaluer, auteur: 'b@exemple.fr',
    aujourdhui: '2026-10-10', maintenant: FIN });
  const sansUndefined = (v) => v === undefined ? false
    : v && typeof v === 'object' ? Object.values(v).every(sansUndefined) : true;
  assert.equal(sansUndefined(r), true);
  // Les articles remis sont des copies.
  r.avant.articles[0].libelle = 'autre';
  assert.equal(ARTICLES.find((a) => a.id === r.avant.articles[0].id).libelle !== 'autre', true);
});

test('après « Courses terminées » : restes() ne repropose rien à la semaine suivante ; peutPreparerLaSuivante inchangé', () => {
  const faite = appliquerChamps(COMMENCEE, fin().lot.champs);
  const liste = calculer(faite);
  assert.deepEqual(restes(liste, faite), []);
  // La semaine suivante créée ensuite n'emporte aucun reste.
  const ajout = ecrituresAjout([faite], 'salade-pates', { semainesChargees: true, aujourdhui: '2026-10-15', maintenant: 9, restes: restes(liste, faite) });
  assert.equal(ajout.id, '2026-10-17');
  assert.equal('articles' in ajout, false);
  // Faites le 10, la semaine finit le 16 : pas encore de « Préparer la semaine suivante » (la semaine qu'on cuisine reste).
  assert.equal(peutPreparerLaSuivante(faite, '2026-10-10'), false);
  assert.equal(peutPreparerLaSuivante(faite, '2026-10-13'), false);
  assert.equal(peutPreparerLaSuivante(faite, '2026-10-14'), true);
});

test('lignesAjouteesDepuis et texteAjoutesDepuis : lignes d’un plat entré après la fin des courses', () => {
  const faite = appliquerChamps(COMMENCEE, fin().lot.champs);
  assert.equal(lignesAjouteesDepuis(calculer(faite), faite), 0);
  // Un plat arrive ensuite (ajouteLe après coursesFaitesA) : ses lignes pas cochées comptent.
  const avecTarte = { ...faite, plats: { ...faite.plats, poelee: dans(FIN + 1) } };
  const poelee = plat('poelee', 'Poêlée', [ing('courgette', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'principal' }),
    ing('pâtes', 100, 'g', 'epicerie_salee', ['feculent'])]);
  const liste = listeDeCourses(avecTarte, { tousLesPlats: [...TOUS, poelee], profils: PROFILS, evaluer });
  assert.equal(lignesAjouteesDepuis(liste, avecTarte), 2, 'courgette et pâtes (encore à prendre)');
  assert.equal(lignesAjouteesDepuis(liste, { ...avecTarte, statut: undefined }), 0, 'courses pas terminées');
  assert.equal(lignesAjouteesDepuis(liste, { ...avecTarte, coursesFaitesA: undefined }), 0, 'heure inconnue');
  assert.equal(texteAjoutesDepuis(2), '2 articles ajoutés depuis');
  assert.equal(texteAjoutesDepuis(1), '1 article ajouté depuis');
  assert.equal(texteAjoutesDepuis(0), '');
});

test('coursesFaites et texteCoursesFaites : « Courses faites ✓ le samedi 10 octobre »', () => {
  const faite = appliquerChamps(COMMENCEE, fin().lot.champs);
  assert.equal(coursesFaites(faite), true);
  assert.equal(coursesFaites(COMMENCEE), false);
  assert.equal(coursesFaites({ ...COMMENCEE, statut: 'batch_fait' }), true);
  assert.equal(coursesFaites(null), false);
  assert.equal(texteCoursesFaites(faite), 'Courses faites ✓ le samedi 10 octobre');
  assert.equal(texteCoursesFaites({ ...faite, coursesFaitesLe: 'hier' }), 'Courses faites ✓');
});

test('TEXTES_FIN_DES_COURSES : textes exacts, sans mot technique', () => {
  assert.deepEqual(TEXTES_FIN_DES_COURSES, {
    bouton: 'Courses terminées',
    annonce: 'Courses terminées. Bon appétit !',
    titre: 'Courses terminées ?',
    garder: 'Les garder pour la prochaine fois',
    sansEux: 'Terminer sans eux',
    continuer: 'Continuer les courses',
    prochaines: 'Pour les prochaines courses',
    revoir: 'Revoir la liste',
    rouvrir: 'Rouvrir la liste',
    rouverte: 'La liste est rouverte.',
    panier: 'Dites-le dans Courses quand c’est fini.',
  });
  for (const texte of Object.values(TEXTES_FIN_DES_COURSES)) textePropre(texte);
});

// ——— Carte « prochaine action » de Semaine ———

function carte(semaine, { aujourdhui = '2026-10-12', semaines = [semaine] } = {}) {
  const plats = platsDeLaSemaine(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer });
  const liste = listeDeCourses(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer });
  return carteProchaineAction(semaine, { semainesChargees: true, semaines, aujourdhui, plats, liste, groupes: grouperParRayon(liste) });
}

test('carteProchaineAction : courses faites → « Courses faites ✓ », « Le samedi 10 octobre. Bon appétit ! », sans bouton principal', () => {
  const faite = appliquerChamps(COMMENCEE, fin().lot.champs);
  const c = carte(faite);
  assert.deepEqual([c.cas, c.titre, c.texte, c.fin, c.suivante], ['faites', 'Courses faites ✓', 'Le samedi 10 octobre. Bon appétit !', null, null]);
  assert.deepEqual(c.boutons, [{ action: 'courses', libelle: 'Voir la liste ›', principal: false }]);
  // Même avec des lignes encore à acheter (gardées pour la prochaine fois) : la semaine qu'on cuisine reste à l'écran.
  assert.ok(calculer(faite).lignes.some((l) => !l.cochee));
  // Deux derniers jours : « Préparer la semaine du 17 au 23 octobre », principal.
  const finDeSemaine = carte(faite, { aujourdhui: '2026-10-15' });
  assert.equal(finDeSemaine.fin, 'Cette semaine se termine vendredi 16 octobre.');
  assert.deepEqual(finDeSemaine.boutons, [{ action: 'courses', libelle: 'Voir la liste ›', principal: false },
    { action: 'preparer', libelle: 'Préparer la semaine du 17 au 23 octobre', principal: true }]);
  // Date illisible : « Bon appétit ! » seul.
  assert.equal(carte({ ...faite, coursesFaitesLe: 'hier' }).texte, 'Bon appétit !');
  textePropre(c.texte);
  // Rouverte : la carte redevient celle des courses.
  const rouverte = appliquerChamps(faite, ecrituresRouvrir(faite).champs);
  assert.equal(carte(rouverte).cas, 'liste');
});

test('carteProchaineAction : tout dans le panier, courses pas terminées → « Dites-le dans Courses quand c’est fini. »', () => {
  const coches = Object.fromEntries(calculer(SEMAINE).lignes.map((l) => [l.cle, valeurCoche(l.totaux, 1)]));
  const c = carte({ ...SEMAINE, coches });
  assert.deepEqual([c.cas, c.titre, c.texte], ['panier', 'Tout est dans le panier 🎉', 'Dites-le dans Courses quand c’est fini.']);
});

// ——— « Rouvrir la liste » (semaine.js) ———

test('ecrituresRouvrir : brouillon → courses faites → rouvrir → brouillon (statut EFFACER) ; validee → … → validee', () => {
  const faite = appliquerChamps(COMMENCEE, fin().lot.champs);
  const r = ecrituresRouvrir(faite);
  assert.deepEqual(r, { id: '2026-10-10', champs: { statut: EFFACER, statutAvant: EFFACER } });
  const rouverte = appliquerChamps(faite, r.champs);
  assert.equal(statutSemaine(rouverte), 'brouillon');
  assert.equal('statut' in rouverte, false);
  assert.equal(champsValides(r.champs), true);
  const validee = appliquerChamps({ ...COMMENCEE, statut: 'validee' }, fin({}, { ...COMMENCEE, statut: 'validee' }).lot.champs);
  const r2 = ecrituresRouvrir(validee);
  assert.deepEqual(r2.champs, { statut: 'validee', statutAvant: EFFACER });
  assert.equal(statutSemaine(appliquerChamps(validee, r2.champs)), 'validee', 'jamais brouillon');
  // Un statutAvant illisible ou trop loin (courses_faites, batch_fait) ne fait jamais avancer : EFFACER.
  for (const statutAvant of ['batch_fait', 'courses_faites', 'perdu', 'brouillon']) {
    assert.equal(ecrituresRouvrir({ ...faite, statutAvant }).champs.statut, EFFACER, statutAvant);
  }
  // Ensuite, « Courses terminées » est de nouveau possible.
  assert.equal(fin({}, rouverte).lot.champs.statut, 'courses_faites');
});

test('ecrituresRouvrir : seulement depuis « courses faites » ; semaine illisible refusée', () => {
  assert.deepEqual(ecrituresRouvrir(COMMENCEE), { code: 'statut' });
  assert.deepEqual(ecrituresRouvrir({ ...COMMENCEE, statut: 'validee' }), { code: 'statut' });
  assert.deepEqual(ecrituresRouvrir({ ...COMMENCEE, statut: 'batch_fait' }), { code: 'statut' });
  assert.deepEqual(ecrituresRouvrir(null), { code: 'invalide' });
  assert.deepEqual(ecrituresRouvrir({ ...COMMENCEE, id: 'A B', statut: 'courses_faites' }), { code: 'invalide' });
});

test('ecrituresRouvrir : les articles gardés pour la prochaine fois, pas cochés, repartent (leurs lignes reviennent)', () => {
  const r = fin({ garder: true });
  const faite = appliquerChamps(COMMENCEE, r.lot.champs);
  const articles = [
    ...ARTICLES.filter((a) => !r.lot.supprimer.includes(a.id)),
    ...r.lot.articles.map((a, i) => (i === 0 ? { ...a, coche: { le: FIN + 9 } } : a)), // la tomate, achetée depuis
    { id: 'garde--2026-10-03--sel', libelle: 'sel', creeLe: 1 }, // gardée par d'autres courses : reste
    { id: idReste('2026-10-10', 'beurre'), libelle: 'beurre', creeLe: 1 }, // un reste n'est pas un article gardé
  ];
  const rouvrir = ecrituresRouvrir(faite, { articles });
  assert.deepEqual(rouvrir.supprimer, r.lot.articles.slice(1).map((a) => a.id));
  assert.deepEqual(gardesDeLaSemaine(faite, articles), rouvrir.supprimer);
  assert.equal('supprimer' in ecrituresRouvrir(faite, { articles: ARTICLES }), false);
});

/** Courses terminées sur COMMENCEE avec « Les garder » → { faite, articles (documents après le lot), r }. */
function gardee() {
  const r = fin({ garder: true });
  const faite = appliquerChamps(COMMENCEE, r.lot.champs);
  const articles = [...ARTICLES.filter((a) => !r.lot.supprimer.includes(a.id)), ...r.lot.articles];
  return { r, faite, articles };
}

test('articleGardeDeLaLigne : une fois les courses terminées, l’article qui garde la ligne ; sinon null', () => {
  const { faite, articles } = gardee();
  const liste = calculer(faite, { articles });
  const tomate = ligne(liste, 'tomate');
  assert.equal(articleGardeDeLaLigne(faite, tomate, liste)?.articleId, 'garde--2026-10-10--tomate');
  // Ligne cochée pendant les courses (jambon) : rien de gardé ; un article n'a pas d'article gardé.
  assert.equal(articleGardeDeLaLigne(faite, ligne(liste, 'jambon-blanc'), liste), null);
  assert.equal(articleGardeDeLaLigne(faite, liste.articles.find((a) => a.articleId === 'piles'), liste), null);
  // Courses pas terminées (rouvertes) : rien de lié.
  const rouverte = appliquerChamps(faite, ecrituresRouvrir(faite).champs);
  assert.equal(articleGardeDeLaLigne(rouverte, tomate, calculer(rouverte, { articles })), null);
  assert.equal(articleGardeDeLaLigne(null, tomate, liste), null);
  // « Revoir la liste » : la tomate retrouvée dans le panier, cochée → l'article gardé est coché avec elle (app.js) ;
  // il n'est plus à acheter pour la semaine suivante.
  const cochee = appliquerChamps(faite, ecrituresCoche(faite, tomate, true, { maintenant: FIN + 5 }).champs);
  const garde = articleGardeDeLaLigne(cochee, ligne(calculer(cochee, { articles }), 'tomate'), calculer(cochee, { articles }));
  assert.equal(garde.cochee, false, 'pas encore coché : app.js le coche dans la foulée');
});

test('ecrituresRouvrirListe : un article gardé coché depuis rend sa coche à sa ligne et repart ; jamais acheté deux fois', () => {
  const { r, faite, articles: apres } = gardee();
  // Achetées depuis : la tomate (sa ligne n'est pas cochée) et la crème (sa ligne est cochée aussi, « Revoir la liste »).
  const tomateId = idGarde('2026-10-10', 'tomate');
  const cremeId = idGarde('2026-10-10', 'creme-fraiche-epaisse');
  const articles = [
    ...apres.map((a) => (a.id === tomateId || a.id === cremeId ? { ...a, coche: { le: FIN + 9 } } : a)),
    { id: idGarde('2026-10-10', 'poireau'), libelle: 'poireau', creeLe: FIN, coche: { le: FIN + 9 } }, // sa ligne a disparu
  ];
  const listeCreme = calculer(faite, { articles });
  const semaine = appliquerChamps(faite, ecrituresCoche(faite, ligne(listeCreme, 'creme-fraiche-epaisse'), true, { maintenant: FIN + 8 }).champs);
  const liste = calculer(semaine, { articles });
  const rouvrir = ecrituresRouvrirListe(semaine, { articles, liste, maintenant: FIN + 20 });
  assert.equal(rouvrir.champs.statut, EFFACER);
  assert.deepEqual(rouvrir.champs['coches.tomate'], valeurCoche(ligne(liste, 'tomate').totaux, FIN + 20));
  assert.equal('coches.creme-fraiche-epaisse' in rouvrir.champs, false, 'déjà cochée : rien de plus');
  assert.equal(champsValides(rouvrir.champs), true);
  // Gardés pas cochés (gruyère, pâtes, thon) et gardés cochés qui ont leur ligne (tomate, crème) repartent ; le poireau reste.
  const gardesNonCoches = r.lot.articles.map((a) => a.id).filter((id) => id !== tomateId && id !== cremeId);
  assert.deepEqual([...rouvrir.supprimer].sort(), [...gardesNonCoches, tomateId, cremeId].sort());
  // Après : la tomate et la crème sont dans le panier, une seule fois ; plus aucun article gardé à acheter.
  const rouverte = appliquerChamps(semaine, rouvrir.champs);
  const restants = articles.filter((a) => !rouvrir.supprimer.includes(a.id));
  const ensuite = calculer(rouverte, { articles: restants });
  assert.equal(ligne(ensuite, 'tomate').cochee, true);
  assert.equal(ligne(ensuite, 'creme-fraiche-epaisse').cochee, true);
  assert.equal(ensuite.articles.some((a) => a.articleId.startsWith(PREFIXE_GARDE) && !a.cochee), false);
  // Sans liste : comme ecrituresRouvrir (les gardés pas cochés seulement) ; refus transmis.
  assert.deepEqual(ecrituresRouvrirListe(semaine, { articles }), ecrituresRouvrir(semaine, { articles }));
  assert.deepEqual(ecrituresRouvrirListe(COMMENCEE, { articles, liste }), { code: 'statut' });
  assert.deepEqual(ecrituresRouvrirListe(null), { code: 'invalide' });
});

test('idGarde, articlesDesRestes : identifiants fixes « garde--<semaine>--<produit> », distincts des restes', () => {
  assert.equal(PREFIXE_GARDE, 'garde--');
  assert.equal(idGarde('2026-10-10', 'beurre'), 'garde--2026-10-10--beurre');
  assert.equal(idGarde('2026-10-10', 'pate--pa3te1'), 'garde--2026-10-10--pate--pa3te1');
  assert.notEqual(idGarde('2026-10-10', 'beurre'), idReste('2026-10-10', 'beurre'));
  for (const [s, p] of [['', 'beurre'], ['2026-10-10', ''], ['a/b', 'beurre'], ['2026-10-10', 'B'], [null, 'beurre']]) {
    assert.equal(idGarde(s, p), '', `${s} ${p}`);
  }
  const restesLus = [{ libelle: 'beurre', precision: '30 g', produitId: 'beurre' }, { libelle: 'beurre', precision: '10 g', produitId: 'beurre' },
    { libelle: ' ', produitId: 'vide' }, { libelle: 'x'.repeat(70), precision: 'y'.repeat(50), produitId: 'long' }, { libelle: 'sans id' }];
  const gardes = articlesDesRestes(restesLus, { semaineId: '2026-10-10', auteur: 'a@exemple.fr', maintenant: 5, garde: true });
  assert.deepEqual(gardes.map((a) => a.id), ['garde--2026-10-10--beurre', 'garde--2026-10-10--long', undefined]);
  assert.deepEqual(gardes[0], { id: 'garde--2026-10-10--beurre', libelle: 'beurre', precision: '30 g', creePar: 'a@exemple.fr', creeLe: 5 });
  assert.deepEqual([gardes[1].libelle.length, gardes[1].precision.length], [60, 40]);
  // Sans `garde` : les restes d'une semaine suivante, comme en T3a.
  assert.equal(articlesDesRestes(restesLus, { semaineId: '2026-10-17', maintenant: 5 })[0].id, 'reste--2026-10-17--beurre');
});

test('lireSemaine garde les traces de la fin des courses (statutAvant, coursesFaitesLe, coursesFaitesPar, coursesFaitesA)', () => {
  const faite = appliquerChamps({ ...COMMENCEE, statut: 'validee' }, fin({}, { ...COMMENCEE, statut: 'validee' }).lot.champs);
  const lue = lireSemaine(faite);
  assert.deepEqual([lue.statut, lue.statutAvant, lue.coursesFaitesLe, lue.coursesFaitesPar, lue.coursesFaitesA],
    ['courses_faites', 'validee', '2026-10-10', 'b@exemple.fr', FIN]);
});
