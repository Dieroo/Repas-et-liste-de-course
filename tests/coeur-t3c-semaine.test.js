// T3c « Ajuster la semaine » : coeur/semaine.js (« Qui en mange ? », invités, Mer / Végétale et repas par
// ecrituresReglage ; « Revenir aux réglages de départ » ; touchers réunis ; dates de la semaine ; modèle et phrases de la
// feuille du plat) et la liste de courses qui les suit (coeur/liste.js, inchangé). Fixtures génériques : aucune donnée
// du foyer.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireRegime } from '../js/coeur/regles.js';
import { BAREME_AGE, regleDuPalier } from '../js/coeur/age.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { idProduit } from '../js/coeur/produits.js';
import { listeDeCourses } from '../js/coeur/liste.js';
import {
  CHAMPS_REGLAGE, COMPTEURS, DUREE_MAX_JOURS, EFFACER, INVITES_MAX, REPAS_MAX, TEXTE_PERSONNE, TEXTES_DATES,
  TEXTES_PLAT_SEMAINE, aDesReglagesEcrits, appliquerChamps, champsValides, ecrituresDepart, ecrituresReglage,
  exceptionPlat, feuillePlat, fusionnerReglages, nomCompteur, phrasePortions, platsDeLaSemaine, raisonsEcartes,
  aDesPlats, ecrituresAjout, ecrituresRetrait, resumePlat, semaineAPreparer, semaineEnCours, semaineSuivante,
  semaineVisee, texteErreurDates, validerDates,
} from '../js/coeur/semaine.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const MIEL = regleDuPalier(BAREME_AGE.find((e) => e.code === 'miel'), 0);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [MIEL] };
const PROFILS = [E, B, A]; // dans le désordre exprès : l'ordre d'affichage vient de trierProfils

const ing = (produit, qte, unite, rayon, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon, marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, rayon, marqueurs = []) => ({ produit, qtePortion, unite, rayon, marqueurs });
const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Cuire.'], ...extra,
});

const PATES = ing('pâtes courtes', 400, 'g', 'epicerie_salee', ['feculent']);
const JAMBON = ing('jambon blanc', 4, 'tranche', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'fine' });
const CREME = ing('crème fraîche épaisse', 20, 'cl', 'cremerie', ['laitier']);
const GRUYERE = ing('gruyère râpé', 100, 'g', 'fromages', ['laitier']);
const MER = {
  pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['jambon blanc'],
  ajouter: [ajout('thon au naturel', 50, 'g', 'epicerie_salee', ['poisson'])], consigne: 'Part au thon.',
};
const VEGETALE = {
  pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'],
  ajouter: [ajout('tofu fumé', 60, 'g', 'cremerie', ['soja'])], consigne: 'Part au tofu.',
};
const GRATIN = plat('gratin-pates-jambon', 'Gratin de pâtes au jambon', [PATES, JAMBON, CREME, GRUYERE], { variantes: [MER, VEGETALE] });
const GRATIN_SANS_VERSION = plat('gratin-sans-version', 'Gratin sans version', [PATES, JAMBON, CREME, GRUYERE]);
const YAOURT_MIEL = plat('yaourt-miel', 'Yaourt au miel', [ing('yaourt nature', 4, 'pc', 'cremerie', ['laitier']),
  ing('miel', 2, 'cs', 'epicerie_sucree', ['miel'])], { type: 'dessert' });
const TARTE = { id: 'tarte-poireaux', nom: 'Tarte aux poireaux' };
const JETE = { ...plat('jete', 'Plat jeté', [PATES]), corbeille: { le: 1, par: 'x@exemple.fr' } };
const TOUS = [GRATIN, GRATIN_SANS_VERSION, YAOURT_MIEL, TARTE, JETE];

const T = 1_791_201_600_000; // une heure du téléphone (Date.now())
const S1 = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: T, creePar: 'a@exemple.fr' };
const avecPlats = (semaine, plats) => ({ ...semaine, plats });
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
const OPTIONS = { evaluer, tousLesPlats: TOUS, profils: PROFILS };
const ctx = (extra = {}) => ({ tousLesPlats: TOUS, profils: PROFILS, evaluer, ...extra });
/** La semaine avec un seul plat réglé par `entree`. */
const semaineDe = (platId, entree = {}) => avecPlats(S1, { [platId]: dans(1, entree) });
const element = (platId, entree = {}, extra = {}) => platsDeLaSemaine(semaineDe(platId, entree), ctx(extra))[0];
/** Écrit un réglage puis relit la semaine, comme l'écran l'affiche tout de suite (appliquerChamps). */
function apres(semaine, platId, reglage, options = OPTIONS) {
  const ecritures = ecrituresReglage(semaine, platId, reglage, options);
  assert.ok(ecritures.champs, JSON.stringify(ecritures));
  return appliquerChamps(semaine, ecritures.champs);
}
const lire = (semaine, extra = {}) => platsDeLaSemaine(semaine, ctx(extra));

function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

// ——— « Qui en mange ? » ———

test('mange : décocher un profil qui en mange écrit false ; le recocher (son défaut) efface le chemin', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { mange: { 'profil-a': false } }, OPTIONS),
    { id: '2026-10-10', champs: { 'plats.gratin-pates-jambon.mange.profil-a': false } });
  const sansA = apres(semaine, 'gratin-pates-jambon', { mange: { 'profil-a': false } });
  assert.deepEqual(ecrituresReglage(sansA, 'gratin-pates-jambon', { mange: { 'profil-a': true } }, OPTIONS).champs,
    { 'plats.gratin-pates-jambon.mange.profil-a': EFFACER });
  const revenu = apres(sansA, 'gratin-pates-jambon', { mange: { 'profil-a': true } });
  assert.deepEqual(revenu.plats['gratin-pates-jambon'].mange, {}, 'aucune valeur par défaut stockée');
  assert.equal(lire(revenu)[0].mangeurs[0].mange, true);
});

test('mange : true pour un profil sans version → il mange la recette telle quelle ; false (son défaut) efface', () => {
  const semaine = semaineDe('gratin-sans-version');
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-sans-version', { mange: { 'profil-b': true } }, OPTIONS).champs,
    { 'plats.gratin-sans-version.mange.profil-b': true });
  const avecB = lire(apres(semaine, 'gratin-sans-version', { mange: { 'profil-b': true } }))[0];
  assert.deepEqual(avecB.mangeurs.map((m) => [m.profil.id, m.mange, m.parDefaut, m.raison]),
    [['profil-a', true, true, null], ['profil-b', true, false, 'version'], ['enfant', true, true, null]]);
  assert.deepEqual(avecB.versions, [], 'aucune version servie : la recette');
  assert.equal(avecB.parRepasFoyer, 2.5);
  assert.equal(ecrituresReglage(semaine, 'gratin-sans-version', { mange: { 'profil-b': false } }, OPTIONS).champs['plats.gratin-sans-version.mange.profil-b'],
    EFFACER, 'false est son défaut');
  // null : revenir au défaut, quel que soit le choix écrit.
  assert.equal(ecrituresReglage(semaine, 'gratin-sans-version', { mange: { 'profil-b': null } }, OPTIONS).champs['plats.gratin-sans-version.mange.profil-b'], EFFACER);
});

test('mange : une version arrivée plus tard fait entrer le profil tout seul (aucune écriture)', () => {
  // B décoché par défaut (pas de version) ; rien d'écrit.
  const semaine = semaineDe('gratin-pates-jambon');
  const avant = lire(semaine, { tousLesPlats: [{ ...GRATIN, variantes: [] }] })[0];
  assert.equal(avant.mangeurs[1].mange, false);
  const ensuite = lire(semaine)[0];
  assert.equal(ensuite.mangeurs[1].mange, true);
  assert.equal(ensuite.versions[0].style, 'mer');
});

test('mange : le défaut se juge sur la version que le profil recevra (styles appliqués d’abord)', () => {
  const enfantSansViande = { ...E, regles: [...SANS_VIANDE, MIEL] };
  const curry = plat('curry', 'Curry de poulet', [
    ing('blanc de poulet', 400, 'g', 'boucherie', ['viande', 'volaille'], { forme: 'morceaux' }),
    ing('lait de coco', 40, 'cl', 'epicerie_salee'),
  ], {
    variantes: [
      { pour: 'enfant', style: 'mer', frigoJours: 2, retirer: ['blanc de poulet'], ajouter: [ajout('cabillaud', 60, 'g', 'poissonnerie', ['poisson'])] },
      { pour: 'enfant', style: 'vegetal', retirer: ['blanc de poulet'], ajouter: [ajout('pois chiches', 60, 'g', 'epicerie_salee', ['feculent']), ajout('miel', 0.5, 'cs', 'epicerie_sucree', ['miel'])] },
    ],
  });
  const options = { evaluer, tousLesPlats: [curry], profils: [A, enfantSansViande] };
  const semaine = semaineDe('curry');
  // Mer d'avance : sans miel, l'enfant en mange ; le décocher s'écrit.
  assert.equal(ecrituresReglage(semaine, 'curry', { mange: { enfant: false } }, options).champs['plats.curry.mange.enfant'], false);
  // Végétale choisie dans le même geste : « Pas avant 1 an » (miel), false devient le défaut.
  assert.deepEqual(ecrituresReglage(semaine, 'curry', { styles: { enfant: 'vegetal' }, mange: { enfant: false } }, options).champs,
    { 'plats.curry.styles.enfant': 'vegetal', 'plats.curry.mange.enfant': EFFACER });
  // Végétale déjà choisie : le recocher s'écrit (il mangera le plat malgré la précaution, par un toucher).
  const vegetale = semaineDe('curry', { styles: { enfant: 'vegetal' } });
  assert.equal(ecrituresReglage(vegetale, 'curry', { mange: { enfant: true } }, options).champs['plats.curry.mange.enfant'], true);
  const coche = platsDeLaSemaine(apres(vegetale, 'curry', { mange: { enfant: true } }, options), { ...options })[0];
  assert.deepEqual(coche.mangeurs.map((m) => [m.profil.id, m.mange, m.raison]), [['profil-a', true, null], ['enfant', true, 'age']]);
});

test('mange : profil inconnu, clé de chemin illisible, valeur qui n’est pas un booléen → refusé ; plat inconnu → écrit tel quel', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  for (const mange of [{ inconnu: false }, { 'Profil.A': false }, { 'profil-a': 'non' }, { 'profil-a': 0 }, 'profil-a', null]) {
    assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { mange }, OPTIONS), { code: 'invalide' }, JSON.stringify(mange));
  }
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { mange: { 'profil-a': true } }), { code: 'invalide' }, 'sans profils');
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { mange: { 'profil-a': true } }, { ...OPTIONS, tousLesPlats: [] }).champs,
    { 'plats.gratin-pates-jambon.mange.profil-a': true }, 'défaut inconnu : la valeur telle quelle');
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { mange: {} }, OPTIONS), { code: 'invalide' }, 'rien à écrire');
});

// ——— Invités ———

test('invités : chacun son chemin, bornés de 0 à 20 ; 0 ou null efface ; illisible refusé', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  const champs = (invites) => ecrituresReglage(semaine, 'gratin-pates-jambon', { invites }, OPTIONS).champs;
  assert.deepEqual(champs({ adultes: 2 }), { 'plats.gratin-pates-jambon.invites.adultes': 2 });
  assert.deepEqual(champs({ enfants: 1 }), { 'plats.gratin-pates-jambon.invites.enfants': 1 });
  assert.deepEqual(champs({ adultes: 2, enfants: 0 }),
    { 'plats.gratin-pates-jambon.invites.adultes': 2, 'plats.gratin-pates-jambon.invites.enfants': EFFACER });
  assert.deepEqual(champs({ adultes: 0 }), { 'plats.gratin-pates-jambon.invites.adultes': EFFACER });
  assert.deepEqual(champs({ adultes: null }), { 'plats.gratin-pates-jambon.invites.adultes': EFFACER });
  assert.deepEqual(champs({ adultes: 99 }), { 'plats.gratin-pates-jambon.invites.adultes': INVITES_MAX });
  assert.deepEqual(champs({ adultes: -3 }), { 'plats.gratin-pates-jambon.invites.adultes': EFFACER });
  assert.deepEqual(champs({ adultes: 1.6 }), { 'plats.gratin-pates-jambon.invites.adultes': 2 });
  for (const invites of [{ adultes: '2' }, { bebes: 1 }, { adultes: Number.NaN }, 3, null]) {
    assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { invites }, OPTIONS), { code: 'invalide' }, JSON.stringify(invites));
  }
});

test('invités : jamais d’écriture de `repas` ; ils ajoutent des portions (adulte 1, enfant 0,5)', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  const ecritures = ecrituresReglage(semaine, 'gratin-pates-jambon', { invites: { adultes: 1, enfants: 2 } }, OPTIONS);
  assert.equal(Object.keys(ecritures.champs).some((chemin) => chemin.endsWith('.repas')), false);
  const [gratin] = lire(appliquerChamps(semaine, ecritures.champs));
  assert.deepEqual(gratin.invites, { adultes: 1, enfants: 2 });
  assert.equal(gratin.parRepasFoyer, 2.5);
  assert.equal(gratin.parRepas, 4.5);
  assert.equal(gratin.repas, 2, 'défaut sur le foyer seul');
  assert.equal(gratin.aCuire, 9);
});

test('invariant : ajouter un invité n’abaisse jamais ni le nombre de repas ni les portions (compteur touché ou non)', () => {
  const quiMange = [{}, { 'profil-a': false }, { 'profil-b': false, enfant: false }, { 'profil-a': false, 'profil-b': false, enfant: false }];
  for (const platId of ['gratin-pates-jambon', 'gratin-sans-version', 'yaourt-miel']) {
    for (const mange of quiMange) {
      for (const repas of [undefined, 1, 3, REPAS_MAX]) {
        let semaine = semaineDe(platId, { mange, ...(repas === undefined ? {} : { repas }) });
        let avant = lire(semaine)[0];
        for (const invites of [{ adultes: 1 }, { enfants: 1 }, { adultes: 3, enfants: 2 }, { adultes: INVITES_MAX }]) {
          const total = { adultes: (avant.invites.adultes ?? 0) + (invites.adultes ?? 0), enfants: (avant.invites.enfants ?? 0) + (invites.enfants ?? 0) };
          semaine = apres(semaine, platId, { invites: total });
          const ensuite = lire(semaine)[0];
          const cas = `${platId} ${JSON.stringify(mange)} ${repas} ${JSON.stringify(total)}`;
          assert.ok(ensuite.repas >= avant.repas, `repas : ${cas}`);
          assert.ok(ensuite.aCuire >= avant.aCuire, `portions : ${cas}`);
          assert.equal(ensuite.repas, avant.repas, `un invité ne change pas le nombre de repas : ${cas}`);
          avant = ensuite;
        }
      }
    }
  }
});

// ——— Styles, repas et réglages réunis ———

test('styles par ecrituresReglage : comme ecrituresStyle (défaut effacé, style qui ne convient pas refusé) ; null efface', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  const reglage = (styles, options = OPTIONS) => ecrituresReglage(semaine, 'gratin-pates-jambon', { styles }, options);
  assert.deepEqual(reglage({ 'profil-b': 'vegetal' }).champs, { 'plats.gratin-pates-jambon.styles.profil-b': 'vegetal' });
  assert.deepEqual(reglage({ 'profil-b': 'mer' }).champs, { 'plats.gratin-pates-jambon.styles.profil-b': EFFACER });
  assert.deepEqual(reglage({ 'profil-b': null }).champs, { 'plats.gratin-pates-jambon.styles.profil-b': EFFACER });
  assert.deepEqual(reglage({ 'profil-b': 'mer' }, { ...OPTIONS, tousLesPlats: [{ ...GRATIN, variantes: [VEGETALE] }] }), { code: 'style' });
  for (const styles of [{ 'profil-b': 'poisson' }, { 'Profil.B': 'mer' }, 'mer']) {
    assert.deepEqual(reglage(styles), { code: 'invalide' }, JSON.stringify(styles));
  }
});

test('ecrituresReglage : plusieurs réglages réunis en une écriture ; chemins sûrs ; jamais de statut ; clé inconnue refusée', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  const ecritures = ecrituresReglage(semaine, 'gratin-pates-jambon', {
    repas: 3, mange: { enfant: false }, invites: { adultes: 2 }, styles: { 'profil-b': 'vegetal' },
  }, OPTIONS);
  assert.deepEqual(ecritures, {
    id: '2026-10-10',
    champs: {
      'plats.gratin-pates-jambon.repas': 3,
      'plats.gratin-pates-jambon.styles.profil-b': 'vegetal',
      'plats.gratin-pates-jambon.mange.enfant': false,
      'plats.gratin-pates-jambon.invites.adultes': 2,
    },
  });
  assert.ok(champsValides(ecritures.champs));
  assert.equal(/statut|ajouteLe|retire|portionsACongeler/.test(JSON.stringify(ecritures)), false);
  for (const reglage of [{ repas: 2, autre: 1 }, {}, { verrou: true }, { portionsACongeler: 2 }]) {
    assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', reglage, OPTIONS), { code: 'invalide' }, JSON.stringify(reglage));
  }
  // T3a inchangé : le repas seul, écrit même s'il vaut le défaut.
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { repas: 2 }, OPTIONS).champs, { 'plats.gratin-pates-jambon.repas': 2 });
  assert.deepEqual(ecrituresReglage(null, 'gratin-pates-jambon', { repas: 2 }, OPTIONS), { code: 'invalide' });
});

test('ecrituresReglage : entrées gelées jamais modifiées', () => {
  const semaine = geler(semaineDe('gratin-pates-jambon', { mange: { 'profil-a': false }, styles: { 'profil-b': 'vegetal' } }));
  const reglage = geler({ mange: { 'profil-a': true }, invites: { adultes: 1 }, styles: { 'profil-b': null } });
  const avant = JSON.stringify([semaine, reglage]);
  ecrituresReglage(semaine, 'gratin-pates-jambon', reglage, { ...OPTIONS, tousLesPlats: geler(structuredClone(TOUS)) });
  ecrituresDepart(semaine, 'gratin-pates-jambon');
  assert.equal(JSON.stringify([semaine, reglage]), avant);
});

// ——— « Revenir aux réglages de départ » ———

const REGLE = {
  repas: 4, mange: { 'profil-a': false }, invites: { adultes: 2, enfants: 1 }, styles: { 'profil-b': 'vegetal' }, portionsACongeler: 2,
};

test('ecrituresDepart : chaque réglage écrit effacé, chemin par chemin ; jamais ajouteLe, retire ni portionsACongeler', () => {
  const semaine = semaineDe('gratin-pates-jambon', REGLE);
  const ecritures = ecrituresDepart(semaine, 'gratin-pates-jambon');
  assert.deepEqual(ecritures, {
    id: '2026-10-10',
    champs: {
      'plats.gratin-pates-jambon.repas': EFFACER,
      'plats.gratin-pates-jambon.mange.profil-a': EFFACER,
      'plats.gratin-pates-jambon.invites.adultes': EFFACER,
      'plats.gratin-pates-jambon.invites.enfants': EFFACER,
      'plats.gratin-pates-jambon.styles.profil-b': EFFACER,
    },
  });
  assert.ok(champsValides(ecritures.champs));
  // Tout revient au défaut ; les portions à congeler (T4/T5) restent.
  const [revenu] = lire(appliquerChamps(semaine, ecritures.champs));
  const [depart] = lire(semaineDe('gratin-pates-jambon', { portionsACongeler: 2 }));
  for (const champ of ['repas', 'repasTouche', 'parRepasFoyer', 'parRepas', 'aCuire', 'aCongeler', 'invites', 'reglagesEcrits']) {
    assert.deepEqual(revenu[champ], depart[champ], champ);
  }
  assert.deepEqual(revenu.mangeurs, depart.mangeurs);
  assert.deepEqual(revenu.versions.map((v) => v.style), ['mer']);
  assert.equal(revenu.aCongeler, 2);
  assert.equal(revenu.reglagesEcrits, false);
  // Le même geste par ecrituresReglage.
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { depart: true }, OPTIONS), ecritures);
});

test('ecrituresDepart : rien d’écrit → inutile ; tables vides ignorées ; table illisible effacée entière ; plat absent', () => {
  assert.deepEqual(ecrituresDepart(semaineDe('gratin-pates-jambon'), 'gratin-pates-jambon'), { code: 'inutile' });
  assert.deepEqual(ecrituresDepart(semaineDe('gratin-pates-jambon', { mange: {}, invites: {}, portionsACongeler: 2 }), 'gratin-pates-jambon'),
    { code: 'inutile' });
  assert.deepEqual(ecrituresReglage(semaineDe('gratin-pates-jambon'), 'gratin-pates-jambon', { depart: true }, OPTIONS), { code: 'inutile' });
  assert.deepEqual(ecrituresDepart(semaineDe('gratin-pates-jambon', { mange: 'oui', invites: { 'Mal Ecrit': 1 } }), 'gratin-pates-jambon').champs,
    { 'plats.gratin-pates-jambon.mange': EFFACER, 'plats.gratin-pates-jambon.invites': EFFACER });
  assert.deepEqual(ecrituresDepart(semaineDe('gratin-pates-jambon', REGLE), 'autre-plat'), { code: 'invalide' });
  assert.deepEqual(ecrituresDepart(semaineDe('gratin-pates-jambon', REGLE), 'a.b'), { code: 'invalide' });
  assert.deepEqual(ecrituresDepart(null, 'gratin-pates-jambon'), { code: 'invalide' });
});

test('ecrituresReglage : « Revenir » suivi d’un toucher, en une écriture ; depart illisible refusé', () => {
  const semaine = semaineDe('gratin-pates-jambon', REGLE);
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { depart: true, invites: { adultes: 1 }, mange: { 'profil-a': true } }, OPTIONS).champs, {
    'plats.gratin-pates-jambon.repas': EFFACER,
    'plats.gratin-pates-jambon.mange.profil-a': EFFACER,
    'plats.gratin-pates-jambon.invites.adultes': 1,
    'plats.gratin-pates-jambon.invites.enfants': EFFACER,
    'plats.gratin-pates-jambon.styles.profil-b': EFFACER,
  });
  // Un toucher après « Revenir » sur un plat sans réglage écrit : le toucher seul.
  assert.deepEqual(ecrituresReglage(semaineDe('gratin-pates-jambon'), 'gratin-pates-jambon', { depart: true, invites: { adultes: 1 } }, OPTIONS).champs,
    { 'plats.gratin-pates-jambon.invites.adultes': 1 });
  // Table illisible effacée entière : un toucher dedans ne peut partir dans la même écriture (chemins imbriqués).
  const illisible = ecrituresReglage(semaineDe('gratin-pates-jambon', { invites: 'deux' }), 'gratin-pates-jambon',
    { depart: true, invites: { adultes: 1 } }, OPTIONS);
  assert.deepEqual(illisible.champs, { 'plats.gratin-pates-jambon.invites': EFFACER });
  for (const depart of [false, 'oui', null]) {
    assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { depart }, OPTIONS), { code: 'invalide' }, String(depart));
  }
});

test('aDesReglagesEcrits et reglagesEcrits : repas, une case, un invité, un style ; ni ajouteLe ni portionsACongeler', () => {
  assert.deepEqual([...CHAMPS_REGLAGE], ['repas', 'mange', 'invites', 'styles']);
  assert.ok(Object.isFrozen(CHAMPS_REGLAGE));
  assert.equal(aDesReglagesEcrits(dans(1)), false);
  assert.equal(aDesReglagesEcrits(dans(1, { portionsACongeler: 2, retire: false })), false);
  assert.equal(aDesReglagesEcrits(dans(1, { mange: {}, invites: {}, styles: {} })), false);
  for (const entree of [{ repas: 2 }, { mange: { 'profil-a': false } }, { invites: { adultes: 1 } }, { styles: { 'profil-b': 'vegetal' } }]) {
    assert.equal(aDesReglagesEcrits(dans(1, entree)), true, JSON.stringify(entree));
    assert.equal(element('gratin-pates-jambon', entree).reglagesEcrits, true, JSON.stringify(entree));
  }
  assert.equal(aDesReglagesEcrits(null), false);
  assert.equal(element('gratin-pates-jambon').reglagesEcrits, false);
});

// ——— Touchers réunis ———

test('fusionnerReglages : le plus récent l’emporte, profil par profil ; « Revenir » remplace ce qui attendait', () => {
  const a = geler({ repas: 2, mange: { 'profil-a': false }, invites: { adultes: 1 } });
  const b = geler({ repas: 3, mange: { enfant: false }, invites: { adultes: 2, enfants: 1 }, styles: { 'profil-b': 'vegetal' } });
  assert.deepEqual(fusionnerReglages(a, b), {
    repas: 3, mange: { 'profil-a': false, enfant: false }, invites: { adultes: 2, enfants: 1 }, styles: { 'profil-b': 'vegetal' },
  });
  assert.deepEqual(fusionnerReglages(a, { mange: { 'profil-a': true } }).mange, { 'profil-a': true });
  assert.deepEqual(fusionnerReglages(null, { invites: { adultes: 1 } }), { invites: { adultes: 1 } });
  assert.deepEqual(fusionnerReglages(a, undefined), a);
  assert.deepEqual(fusionnerReglages(a, { depart: true }), { depart: true });
  assert.deepEqual(fusionnerReglages({ depart: true }, { invites: { adultes: 1 } }), { depart: true, invites: { adultes: 1 } });
  // Cinq touchers rapides sur « Adultes [+] » : un seul chemin à écrire.
  let enAttente = null;
  for (let n = 1; n <= 5; n += 1) enAttente = fusionnerReglages(enAttente, { invites: { adultes: n } });
  assert.deepEqual(ecrituresReglage(semaineDe('gratin-pates-jambon'), 'gratin-pates-jambon', enAttente, OPTIONS).champs,
    { 'plats.gratin-pates-jambon.invites.adultes': 5 });
  // Décocher puis recocher dans la même rafale : rien de stocké (le défaut).
  const allerRetour = fusionnerReglages({ mange: { 'profil-a': false } }, { mange: { 'profil-a': true } });
  assert.deepEqual(ecrituresReglage(semaineDe('gratin-pates-jambon'), 'gratin-pates-jambon', allerRetour, OPTIONS).champs,
    { 'plats.gratin-pates-jambon.mange.profil-a': EFFACER });
});

// ——— La liste suit ———

const ligne = (liste, nom) => [...liste.lignes, ...liste.maison].find((l) => l.produitId === idProduit(nom)) ?? null;
const calculer = (semaine, extra = {}) => listeDeCourses(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer, ...extra });

test('liste : un invité adulte ajoute sa part de la recette, sans retirer de repas (5 → 7 portions)', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  const avant = calculer(semaine);
  assert.deepEqual(ligne(avant, 'pâtes courtes').totaux, { masse: 500 });
  assert.deepEqual(ligne(avant, 'jambon blanc').totaux, { tranche: 3 }, 'la part de B (version mer) n’en a pas');
  const invite = calculer(apres(semaine, 'gratin-pates-jambon', { invites: { adultes: 1 } }));
  assert.deepEqual(ligne(invite, 'pâtes courtes').totaux, { masse: 700 });
  assert.deepEqual(ligne(invite, 'jambon blanc').totaux, { tranche: 5 });
  assert.deepEqual(ligne(invite, 'thon au naturel').totaux, { masse: 100 }, 'la version de B ne change pas');
  const enfantInvite = calculer(apres(semaine, 'gratin-pates-jambon', { invites: { enfants: 2 } }));
  assert.deepEqual(ligne(enfantInvite, 'pâtes courtes').totaux, { masse: 700 }, 'deux enfants = un adulte');
});

test('liste : un profil décoché sort, sa version aussi ; un profil sans version coché mange la recette', () => {
  const semaine = semaineDe('gratin-pates-jambon');
  const sansB = calculer(apres(semaine, 'gratin-pates-jambon', { mange: { 'profil-b': false } }));
  assert.equal(ligne(sansB, 'thon au naturel'), null);
  assert.deepEqual(ligne(sansB, 'jambon blanc').totaux, { tranche: 4.5 }, '1,5 part × 3 repas (défaut sur le foyer)');
  const personne = calculer(apres(semaine, 'gratin-pates-jambon', { mange: { 'profil-a': false, 'profil-b': false, enfant: false } }));
  assert.deepEqual(personne.lignes, []);
  assert.deepEqual(personne.sansPortion.map((p) => p.id), ['gratin-pates-jambon']);
  // Sans version pour B : décoché d'avance ; coché à la main, sa part suit la recette (jambon compris).
  const sansVersion = semaineDe('gratin-sans-version');
  assert.deepEqual(ligne(calculer(sansVersion), 'jambon blanc').totaux, { tranche: 4.5 });
  const avecB = calculer(apres(sansVersion, 'gratin-sans-version', { mange: { 'profil-b': true } }));
  assert.deepEqual(ligne(avecB, 'jambon blanc').totaux, { tranche: 5 });
  assert.deepEqual(ligne(avecB, 'pâtes courtes').totaux, { masse: 500 });
  assert.equal(ligne(avecB, 'jambon blanc').sources.some((s) => s.pour), false, 'aucune ligne de version');
});

test('liste : « Revenir aux réglages de départ » rend la liste de départ ; personne du foyer mais des invités', () => {
  const depart = semaineDe('gratin-pates-jambon');
  const regle = semaineDe('gratin-pates-jambon', { repas: 4, mange: { enfant: false }, invites: { adultes: 2 }, styles: { 'profil-b': 'vegetal' } });
  const revenu = appliquerChamps(regle, ecrituresDepart(regle, 'gratin-pates-jambon').champs);
  const totaux = (liste) => liste.lignes.map((l) => [l.produitId, l.totaux]);
  assert.notDeepEqual(totaux(calculer(regle)), totaux(calculer(depart)));
  assert.deepEqual(totaux(calculer(revenu)), totaux(calculer(depart)));
  const invitesSeuls = calculer(semaineDe('gratin-pates-jambon', { mange: { 'profil-a': false, 'profil-b': false, enfant: false }, invites: { adultes: 2 } }));
  assert.deepEqual(ligne(invitesSeuls, 'pâtes courtes').totaux, { masse: 200 }, '2 invités, 1 repas (personne du foyer)');
  assert.equal(ligne(invitesSeuls, 'thon au naturel'), null);
});

// ——— Dates de la semaine ———

const S0 = avecPlats({ id: '2026-10-03', debut: '2026-10-03', fin: '2026-10-09', creeLe: T - 7 * 86_400_000 },
  { 'gratin-sans-version': dans(0) });
const S2 = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', creeLe: T + 6 * 86_400_000 };
const SEMAINES = [S0, avecPlats(S1, { 'gratin-pates-jambon': dans(1) }), avecPlats(S2, { 'yaourt-miel': dans(2) })];
const changer = (debut, fin, extra = {}) => validerDates({ debut, fin }, { semaines: SEMAINES, id: '2026-10-10', ...extra });

test('validerDates : début et fin ensemble dès que l’une change (jamais une date seule) ; mêmes dates → inchangé', () => {
  // Une date écrite seule par chacun de deux téléphones pourrait laisser une semaine de plus de 14 jours, illisible :
  // les deux dates partent toujours ensemble (donnees.js refuse une date seule).
  assert.deepEqual(changer('2026-10-10', '2026-10-15'), { id: '2026-10-10', champs: { debut: '2026-10-10', fin: '2026-10-15' } });
  assert.deepEqual(changer('2026-10-11', '2026-10-16'), { id: '2026-10-10', champs: { debut: '2026-10-11', fin: '2026-10-16' } });
  assert.deepEqual(changer('2026-10-11', '2026-10-14'), { id: '2026-10-10', champs: { debut: '2026-10-11', fin: '2026-10-14' } });
  assert.deepEqual(changer('2026-10-10', '2026-10-16'), { code: 'inchange' });
  assert.deepEqual(changer('2026-10-12', '2026-10-12'), { id: '2026-10-10', champs: { debut: '2026-10-12', fin: '2026-10-12' } }, 'un seul jour');
  assert.ok(champsValides(changer('2026-10-11', '2026-10-14').champs));
  // Mêmes dates : rien à écrire, même si la semaine est déjà passée ou touche une autre semaine (rien ne change).
  assert.deepEqual(changer('2026-10-10', '2026-10-16', { aujourdhui: '2026-10-20' }), { code: 'inchange' });
  const touchee = { ...S0, fin: '2026-10-10' };
  assert.deepEqual(validerDates({ debut: '2026-10-10', fin: '2026-10-16' }, { semaines: [touchee, SEMAINES[1]], id: '2026-10-10' }), { code: 'inchange' });
});

test('validerDates : la fin avant le début ; plus de deux semaines ; dates vides ou illisibles', () => {
  assert.deepEqual(changer('2026-10-12', '2026-10-11'), { erreur: 'ordre' });
  assert.deepEqual(changer('2026-10-10', '2026-10-23', { semaines: [SEMAINES[1]] }), { id: '2026-10-10', champs: { debut: '2026-10-10', fin: '2026-10-23' } }, '14 jours');
  assert.equal(DUREE_MAX_JOURS, 14);
  assert.deepEqual(changer('2026-10-10', '2026-10-24', { semaines: [SEMAINES[1]] }), { erreur: 'duree' });
  for (const [debut, fin] of [['', '2026-10-16'], ['2026-10-10', ''], ['2026-02-30', '2026-03-02'], [null, null], ['10/10/2026', '2026-10-16']]) {
    assert.deepEqual(changer(debut, fin), { erreur: 'vide' }, `${debut} ${fin}`);
  }
});

test('validerDates : à cheval sur deux mois et deux années ; heure d’été sans effet', () => {
  const fin = { id: '2026-10-28', debut: '2026-10-28', fin: '2026-11-03' };
  assert.deepEqual(validerDates({ debut: '2026-10-25', fin: '2026-11-07' }, { semaines: [fin], id: '2026-10-28' }),
    { id: '2026-10-28', champs: { debut: '2026-10-25', fin: '2026-11-07' } }, '14 jours, passage à l’heure d’hiver compris');
  assert.deepEqual(validerDates({ debut: '2026-10-25', fin: '2026-11-08' }, { semaines: [fin], id: '2026-10-28' }), { erreur: 'duree' });
  const annee = { id: '2026-12-28', debut: '2026-12-28', fin: '2027-01-03' };
  assert.deepEqual(validerDates({ debut: '2026-12-26', fin: '2027-01-08' }, { semaines: [annee], id: '2026-12-28' }).champs,
    { debut: '2026-12-26', fin: '2027-01-08' });
});

test('validerDates : une autre semaine qui a des plats (passée, suivante) touchée → refusé, avec ses dates', () => {
  assert.deepEqual(changer('2026-10-08', '2026-10-16'), { erreur: 'chevauche', avec: { debut: '2026-10-03', fin: '2026-10-09' } });
  assert.deepEqual(changer('2026-10-09', '2026-10-16').avec, { debut: '2026-10-03', fin: '2026-10-09' }, 'un seul jour commun suffit');
  assert.deepEqual(changer('2026-10-10', '2026-10-17'), { erreur: 'chevauche', avec: { debut: '2026-10-17', fin: '2026-10-23' } });
  assert.deepEqual(changer('2026-10-05', '2026-10-18').avec, { debut: '2026-10-03', fin: '2026-10-09' }, 'la première par date');
  // Bord à bord : permis.
  assert.deepEqual(changer('2026-10-11', '2026-10-16').champs, { debut: '2026-10-11', fin: '2026-10-16' });
  // Documents illisibles ignorés.
  assert.deepEqual(validerDates({ debut: '2026-10-10', fin: '2026-10-18' },
    { semaines: [SEMAINES[1], { id: 'X', debut: '2026-10-17', fin: '2026-10-23', plats: { a: dans(1) } }, { id: 'y', debut: 'x', fin: 'y' }], id: '2026-10-10' }).champs,
  { debut: '2026-10-10', fin: '2026-10-18' });
});

test('validerDates : une semaine sans plat (vidée par « Annuler ») ne bloque jamais, et ne passe jamais devant (T3c, relecture)', () => {
  // Jeudi 15 : la semaine du 17 au 23, créée par un ajout puis vidée par « Annuler », est invisible ; prolonger la
  // semaine en cours jusqu'au 18 (courses repoussées) est permis, sans nommer une semaine que personne ne voit.
  const videe = { ...S2, plats: { 'yaourt-miel': dans(2, { retire: true }) } };
  const semaines = [SEMAINES[1], videe];
  assert.equal(semaineAPreparer(semaines, '2026-10-15').id, '2026-10-10');
  const prolonger = validerDates({ debut: '2026-10-10', fin: '2026-10-18' }, { semaines, id: '2026-10-10', aujourdhui: '2026-10-15' });
  assert.deepEqual(prolonger, { id: '2026-10-10', champs: { debut: '2026-10-10', fin: '2026-10-18' } });
  // Le 17 et le 18, la semaine qui a les plats reste montrée : la semaine vidée ne la cache jamais.
  const prolongees = [appliquerChamps(semaines[0], prolonger.champs), videe];
  for (const jour of ['2026-10-17', '2026-10-18']) assert.equal(semaineAPreparer(prolongees, jour).id, '2026-10-10', jour);
  // Le 19, elle est finie : la semaine vidée, commencée, est la semaine du jour (sans plat).
  assert.equal(semaineAPreparer(prolongees, '2026-10-19').id, '2026-10-17');
  // Une semaine sans plat du tout (aucune entrée) non plus.
  assert.deepEqual(validerDates({ debut: '2026-10-10', fin: '2026-10-18' }, { semaines: [SEMAINES[1], S2], id: '2026-10-10' }).champs,
    { debut: '2026-10-10', fin: '2026-10-18' });
});

test('validerDates : fin déjà passée (avec aujourdhui) ; semaine inconnue ; semaine aux courses faites', () => {
  assert.deepEqual(changer('2026-10-10', '2026-10-11', { aujourdhui: '2026-10-12' }), { erreur: 'passee' });
  assert.deepEqual(changer('2026-10-10', '2026-10-12', { aujourdhui: '2026-10-12' }).champs, { debut: '2026-10-10', fin: '2026-10-12' }, 'finir aujourd’hui');
  assert.deepEqual(changer('2026-10-10', '2026-10-11'), { id: '2026-10-10', champs: { debut: '2026-10-10', fin: '2026-10-11' } }, 'sans aujourdhui : pas de contrôle');
  assert.deepEqual(changer('2026-10-10', '2026-10-15', { id: '2026-10-99' }), { code: 'invalide' });
  assert.deepEqual(changer('2026-10-10', '2026-10-15', { id: null }), { code: 'invalide' });
  assert.deepEqual(validerDates({ debut: '2026-10-10', fin: '2026-10-15' }), { code: 'invalide' });
  // Courses faites : les dates changent, rien d'autre.
  const faites = { ...SEMAINES[1], statut: 'courses_faites', statutAvant: 'validee', coursesFaitesLe: '2026-10-10', coursesFaitesA: T };
  const resultat = validerDates({ debut: '2026-10-10', fin: '2026-10-14' }, { semaines: [faites], id: '2026-10-10' });
  assert.deepEqual(resultat, { id: '2026-10-10', champs: { debut: '2026-10-10', fin: '2026-10-14' } });
  const changee = appliquerChamps(faites, resultat.champs);
  assert.deepEqual([changee.statut, changee.statutAvant, changee.coursesFaitesLe, changee.coursesFaitesA, changee.plats],
    [faites.statut, faites.statutAvant, faites.coursesFaitesLe, faites.coursesFaitesA, faites.plats]);
});

test('validerDates : la semaine changée reste celle qu’on montre ; entrées gelées intactes', () => {
  const semaines = geler(structuredClone(SEMAINES.slice(0, 2)));
  const resultat = validerDates(geler({ debut: '2026-10-10', fin: '2026-10-20' }), { semaines, id: '2026-10-10' });
  const changees = [semaines[0], appliquerChamps(semaines[1], resultat.champs)];
  assert.equal(semaineAPreparer(changees, '2026-10-18').id, '2026-10-10');
  assert.equal(semaineAPreparer(changees, '2026-10-18').fin, '2026-10-20');
});

test('textes des dates : feuille et erreurs, mot pour mot', () => {
  assert.deepEqual({ ...TEXTES_DATES }, {
    changer: 'Changer', titre: 'Les dates de la semaine', du: 'Du', au: 'Au', aide: 'Deux semaines au plus.', enregistrer: 'Enregistrer',
  });
  assert.ok(Object.isFrozen(TEXTES_DATES));
  assert.equal(texteErreurDates({ erreur: 'ordre' }), 'La fin doit venir après le début.');
  assert.equal(texteErreurDates({ erreur: 'duree' }), 'Deux semaines au plus.');
  assert.equal(texteErreurDates(changer('2026-10-08', '2026-10-16')),
    'Ces dates touchent la semaine du 3 au 9 octobre : choisissez d’autres dates.');
  assert.equal(texteErreurDates({ erreur: 'chevauche', avec: { debut: '2026-10-28', fin: '2026-11-03' } }),
    'Ces dates touchent la semaine du 28 octobre au 3 novembre : choisissez d’autres dates.');
  assert.equal(texteErreurDates({ erreur: 'chevauche', avec: { debut: '2026-10-09', fin: '2026-10-09' } }),
    'Ces dates touchent la semaine du 9 octobre : choisissez d’autres dates.');
  assert.equal(texteErreurDates({ erreur: 'chevauche' }), 'Ces dates touchent une autre semaine : choisissez d’autres dates.');
  assert.equal(texteErreurDates({ erreur: 'vide' }), 'Choisissez les deux dates.');
  assert.equal(texteErreurDates({ erreur: 'passee' }), 'La semaine doit finir aujourd’hui ou plus tard.');
  for (const resultat of [{ code: 'inchange' }, { id: 'x', champs: {} }, null, undefined]) assert.equal(texteErreurDates(resultat), '');
});

// ——— Dates changées : jamais deux semaines qui se chevauchent (relecture de T3c) ———

/** Applique un lot d'écritures (création ou reprise : set fusionné ; champs : update) aux semaines, comme Firestore. */
function ecrire(semaines, ecritures) {
  assert.ok(ecritures && !ecritures.code && !ecritures.erreur, JSON.stringify(ecritures));
  const existante = semaines.find((x) => x.id === ecritures.id);
  const base = ecritures.creation ? { ...(existante ?? {}), ...ecritures.creation.donnees, id: ecritures.id } : existante;
  const maj = { ...appliquerChamps(base, ecritures.champs), id: ecritures.id };
  return existante ? semaines.map((x) => (x === existante ? maj : x)) : [...semaines, maj];
}
const AJOUT = { semainesChargees: true, auteur: 'a@exemple.fr' };
const montree = (semaines, jour) => {
  const m = semaineAPreparer(semaines, jour);
  return m && { id: m.id, debut: m.debut, fin: m.fin, plats: Object.keys(m.plats).filter((p) => !m.plats[p].retire) };
};
const sansChevauchement = (semaines) => {
  const pleines = semaines.filter(aDesPlats);
  return pleines.every((a) => pleines.every((b) => a === b || a.fin < b.debut || b.fin < a.debut));
};

test('semaineAPreparer et semaineEnCours : une semaine sans plat ne passe jamais devant une semaine qui a des plats', () => {
  const pleine = avecPlats(S1, { 'gratin-pates-jambon': dans(1) });
  const videeDecalee = { id: '2026-10-12', debut: '2026-10-12', fin: '2026-10-18', creeLe: T + 1, plats: { curry: dans(2, { retire: true }) } };
  for (const jour of ['2026-10-12', '2026-10-14', '2026-10-16']) assert.equal(semaineAPreparer([pleine, videeDecalee], jour).id, '2026-10-10', jour);
  assert.equal(semaineAPreparer([pleine, videeDecalee], '2026-10-17').id, '2026-10-12', 'la semaine pleine finie : la semaine du jour');
  // Deux semaines sans plat qui se touchent : la plus récente, comme avant.
  assert.equal(semaineAPreparer([S1, videeDecalee], '2026-10-13').id, '2026-10-12');
  // En cours : celle qui a des plats, quand la suivante est montrée.
  const suivante = avecPlats(S2, { 'yaourt-miel': dans(3) });
  const videeEnCours = { id: '2026-10-11', debut: '2026-10-11', fin: '2026-10-16', creeLe: T + 2, plats: {} };
  assert.equal(semaineEnCours([pleine, videeEnCours, suivante], '2026-10-15').id, '2026-10-10');
});

test('dates avancées puis semaine vidée : le prochain plat la reprend, jamais une semaine de plus (relecture, cas 1)', () => {
  // Samedi 10 : semaine du 10 au 16 avec le gratin ; « Changer » la passe du 12 au 18 (elle reste montrée).
  let semaines = [avecPlats(S1, { 'gratin-pates-jambon': dans(1) })];
  const dates = validerDates({ debut: '2026-10-12', fin: '2026-10-18' }, { semaines, id: '2026-10-10', aujourdhui: '2026-10-10' });
  semaines = ecrire(semaines, dates);
  assert.equal(montree(semaines, '2026-10-10').id, '2026-10-10');
  // « Retirer de la semaine » le gratin : la semaine, qui commence plus tard, est vidée et cachée.
  semaines = ecrire(semaines, ecrituresRetrait(semaines[0], 'gratin-pates-jambon', { aujourdhui: '2026-10-10' }));
  assert.equal(semaineAPreparer(semaines, '2026-10-10'), null);
  // « Choisir les plats » : la semaine vidée est reprise sous son identifiant, du jour même à + 6.
  const visee = semaineVisee(semaines, '2026-10-10');
  assert.deepEqual(visee, { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', nouvelle: true, autre: null });
  const ajout = ecrituresAjout(semaines, 'curry', { ...AJOUT, cible: visee, aujourdhui: '2026-10-10', maintenant: T + 5 });
  assert.deepEqual(ajout.creation, { id: '2026-10-10', donnees: { debut: '2026-10-10', fin: '2026-10-16', creePar: 'a@exemple.fr', creeLe: T + 5 } });
  semaines = ecrire(semaines, ajout);
  assert.equal(semaines.length, 1, 'aucune semaine « -2 »');
  for (const jour of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-16']) {
    assert.deepEqual(montree(semaines, jour), { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', plats: ['curry'] }, jour);
  }
});

test('semaine en cours raccourcie, suivante vidée : la suivante est reprise aux nouvelles dates (relecture, cas 2)', () => {
  // Mercredi 14 : « Préparer la semaine du 17 au 23 », un plat, puis « Annuler » : la semaine du 17 au 23 est vidée.
  let semaines = [avecPlats(S1, { 'gratin-pates-jambon': dans(1) })];
  const jour = '2026-10-14';
  let visee = semaineVisee(semaines, jour);
  semaines = ecrire(semaines, ecrituresAjout(semaines, 'tarte-poireaux', { ...AJOUT, cible: visee, aujourdhui: jour, maintenant: T + 1 }));
  semaines = ecrire(semaines, ecrituresRetrait(semaines.find((x) => x.id === visee.id), 'tarte-poireaux', { aujourdhui: jour }));
  // Prolonger la semaine en cours jusqu'au 17 est permis (la semaine vidée ne bloque pas).
  assert.deepEqual(validerDates({ debut: '2026-10-10', fin: '2026-10-17' }, { semaines, id: '2026-10-10', aujourdhui: jour }).champs,
    { debut: '2026-10-10', fin: '2026-10-17' });
  // La raccourcir au 15 : la suivante devient « du 16 au 22 », sous l'identifiant de la semaine vidée.
  semaines = ecrire(semaines, validerDates({ debut: '2026-10-10', fin: '2026-10-15' }, { semaines, id: '2026-10-10', aujourdhui: jour }));
  assert.deepEqual(semaineSuivante(semaines, jour, semaines[0]), { id: '2026-10-17', debut: '2026-10-16', fin: '2026-10-22' });
  visee = semaineVisee(semaines, jour);
  assert.equal(visee.id, '2026-10-17');
  semaines = ecrire(semaines, ecrituresAjout(semaines, 'tarte-poireaux', { ...AJOUT, cible: visee, aujourdhui: jour, maintenant: T + 2 }));
  assert.ok(sansChevauchement(semaines) && semaines.length === 2);
  assert.deepEqual(montree(semaines, '2026-10-16'), { id: '2026-10-17', debut: '2026-10-16', fin: '2026-10-22', plats: ['tarte-poireaux'] });
  assert.deepEqual(montree(semaines, '2026-10-17'), { id: '2026-10-17', debut: '2026-10-16', fin: '2026-10-22', plats: ['tarte-poireaux'] });
});

test('semaine suivante décalée puis vidée : reprise le jour venu, jamais cachée par elle (relecture, cas 3)', () => {
  // Jeudi 15 : la semaine du 17 au 23 a un plat (montrée) ; « Changer » la passe du 19 au 25, puis son plat est retiré.
  let semaines = [avecPlats(S1, { 'gratin-pates-jambon': dans(1) }), avecPlats(S2, { curry: dans(2) })];
  semaines = ecrire(semaines, validerDates({ debut: '2026-10-19', fin: '2026-10-25' }, { semaines, id: '2026-10-17', aujourdhui: '2026-10-15' }));
  semaines = ecrire(semaines, ecrituresRetrait(semaines[1], 'curry', { aujourdhui: '2026-10-15' }));
  // Samedi 17 : plus de semaine à préparer ; les plats choisis reprennent la semaine vidée, du 17 au 23.
  assert.equal(semaineAPreparer(semaines, '2026-10-17'), null);
  const visee = semaineVisee(semaines, '2026-10-17');
  assert.deepEqual([visee.id, visee.debut, visee.fin], ['2026-10-17', '2026-10-17', '2026-10-23']);
  semaines = ecrire(semaines, ecrituresAjout(semaines, 'tajine', { ...AJOUT, cible: visee, aujourdhui: '2026-10-17', maintenant: T + 3 }));
  assert.equal(semaines.length, 2);
  for (const jour of ['2026-10-17', '2026-10-19', '2026-10-23']) assert.deepEqual(montree(semaines, jour).plats, ['tajine'], jour);
});

test('ecrituresAjout : une cible figée qui touche désormais une semaine qui a des plats → « chevauche », rien d’écrit', () => {
  // Jeudi 15 : la feuille s'ouvre sur « la semaine du 17 au 23 » (à créer) ; l'autre téléphone prolonge la semaine en
  // cours jusqu'au 19.
  const s1 = avecPlats(S1, { 'gratin-pates-jambon': dans(1) });
  const cible = semaineVisee([s1], '2026-10-15');
  assert.deepEqual([cible.id, cible.nouvelle], ['2026-10-17', true]);
  const prolongee = appliquerChamps(s1, validerDates({ debut: '2026-10-10', fin: '2026-10-19' }, { semaines: [s1], id: '2026-10-10' }).champs);
  assert.deepEqual(ecrituresAjout([prolongee], 'curry', { ...AJOUT, cible, aujourdhui: '2026-10-15', maintenant: T }), { code: 'chevauche' });
  // L'écran recalcule la semaine visée : la semaine prolongée (plus dans ses deux derniers jours).
  const nouvelle = semaineVisee([prolongee], '2026-10-15');
  assert.deepEqual([nouvelle.id, nouvelle.debut, nouvelle.fin, nouvelle.nouvelle], ['2026-10-10', '2026-10-10', '2026-10-19', false]);
  assert.equal(ecrituresAjout([prolongee], 'curry', { ...AJOUT, cible: nouvelle, aujourdhui: '2026-10-15', maintenant: T }).id, '2026-10-10');
  // Une semaine sans plat qui touche la cible ne l'empêche pas ; une semaine qui a déjà des plats reçoit le plat.
  const videe = { ...prolongee, plats: { 'gratin-pates-jambon': dans(1, { retire: true }) } };
  assert.equal(ecrituresAjout([videe], 'curry', { ...AJOUT, cible, aujourdhui: '2026-10-15', maintenant: T }).id, '2026-10-17');
  const s2 = avecPlats(S2, { tajine: dans(4) });
  assert.equal(ecrituresAjout([prolongee, s2], 'curry', { ...AJOUT, cible, aujourdhui: '2026-10-15', maintenant: T }).id, '2026-10-17',
    'la cible a déjà des plats : rien de nouveau ne se crée');
});

test('ecrituresAjout : une semaine sans plat reprise à d’autres dates reçoit ses nouvelles dates et les restes, sous son identifiant', () => {
  const vide = { id: '2026-10-17', debut: '2026-10-18', fin: '2026-10-20', creeLe: T - 5, creePar: 'b@exemple.fr', plats: { curry: dans(1, { retire: true }) } };
  const s1 = avecPlats(S1, { 'gratin-pates-jambon': dans(1) });
  const cible = semaineVisee([s1, vide], '2026-10-16');
  assert.deepEqual([cible.id, cible.debut, cible.fin, cible.nouvelle], ['2026-10-17', '2026-10-17', '2026-10-23', true]);
  const restes = [{ libelle: 'beurre', precision: '30 g', produitId: 'beurre' }];
  const ajout = ecrituresAjout([s1, vide], 'tajine', { ...AJOUT, cible, aujourdhui: '2026-10-16', maintenant: T, restes });
  assert.deepEqual(ajout.creation, { id: '2026-10-17', donnees: { debut: '2026-10-17', fin: '2026-10-23', creePar: 'a@exemple.fr', creeLe: T } });
  assert.deepEqual(ajout.articles.map((a) => a.id), ['reste--2026-10-17--beurre']);
  assert.ok(champsValides(ajout.creation.donnees) && champsValides(ajout.champs));
  // Mêmes dates : pas de création (comme en T3a).
  const memes = { ...vide, debut: '2026-10-17', fin: '2026-10-23' };
  assert.equal('creation' in ecrituresAjout([s1, memes], 'tajine', { ...AJOUT, cible, aujourdhui: '2026-10-16', maintenant: T }), false);
});

// ——— Feuille du plat ———

test('feuillePlat : cases « Qui en mange ? » dans l’ordre des profils, prénoms, cochées selon le défaut', () => {
  const feuille = feuillePlat(element('gratin-sans-version'), { moi: A, role: 'courses' });
  assert.deepEqual(feuille.qui.map((q) => [q.profil.id, q.libelle, q.coche, q.parDefaut, q.raison]),
    [['profil-a', 'Adulte A', true, true, null], ['profil-b', 'Adulte B', false, false, 'version'], ['enfant', 'Enfant', true, true, null]]);
  assert.deepEqual(feuille.qui.map((q) => q.texte), [null, 'Adulte B : pas encore de version.', null]);
});

test('feuillePlat : demande de version seulement dans la vue « Repas et courses », sous un profil sans version', () => {
  const sansVersion = element('gratin-sans-version');
  const pourMoi = feuillePlat(sansVersion, { moi: B, role: 'courses' }).qui[1];
  assert.deepEqual([pourMoi.texte, pourMoi.demande, pourMoi.libelleDemande], ['Pas encore de version pour vous.', true, 'Demander ma version']);
  const pourB = feuillePlat(sansVersion, { moi: A, role: 'courses' }).qui[1];
  assert.deepEqual([pourB.demande, pourB.libelleDemande], [true, 'Demander une version pour Adulte B']);
  const gestionnaire = feuillePlat(sansVersion, { moi: A, role: 'gestionnaire' }).qui[1];
  assert.deepEqual([gestionnaire.demande, gestionnaire.libelleDemande], [false, null]);
  // Les autres raisons ne demandent rien.
  for (const q of feuillePlat(element('yaourt-miel', {}, { tousLesPlats: [{ ...YAOURT_MIEL, notes: { 'profil-a': 0 } }] }), { role: 'courses' }).qui) {
    assert.equal(q.demande, false, q.profil.id);
    assert.equal(q.libelleDemande, null);
  }
  // Coché à la main : sa part suit la recette, et la version peut toujours être demandée.
  const coche = element('gratin-sans-version', { mange: { 'profil-b': true } });
  const moiCoche = feuillePlat(coche, { moi: B, role: 'courses' }).qui[1];
  assert.deepEqual([moiCoche.coche, moiCoche.texte, moiCoche.demande],
    [true, 'Pas encore de version pour vous : votre part suit la recette.', true]);
  assert.equal(feuillePlat(coche, { moi: A, role: 'gestionnaire' }).qui[1].texte,
    'Pas encore de version pour Adulte B : sa part suit la recette.');
});

test('feuillePlat : « Jamais » et précaution d’âge restent dits, cochés ou non ; jamais de croix dans la vue « Repas et courses »', () => {
  const jamais = { ...YAOURT_MIEL, notes: { 'profil-a': 0 } };
  const [a, , enfant] = feuillePlat(element('yaourt-miel', {}, { tousLesPlats: [jamais] }), { role: 'courses' }).qui;
  assert.equal(a.texte, 'Adulte A a dit « Jamais ».');
  assert.equal(enfant.texte, 'Enfant : 🧸 pas avant 1 an (miel).');
  const gestionnaire = feuillePlat(element('yaourt-miel', {}, { tousLesPlats: [jamais] }), { role: 'gestionnaire', moi: A }).qui;
  assert.equal(gestionnaire[0].texte, 'Vous avez dit « Jamais ».');
  assert.equal(gestionnaire[2].texte, 'Enfant : 🧸 ❌ Pas avant 1 an : miel.');
  const coches = feuillePlat(element('yaourt-miel', { mange: { 'profil-a': true, enfant: true } }, { tousLesPlats: [jamais] }), { role: 'courses' }).qui;
  assert.deepEqual(coches.map((q) => [q.coche, q.texte]), [
    [true, 'Adulte A a dit « Jamais ».'], [true, null], [true, 'Enfant : 🧸 pas avant 1 an (miel).'],
  ]);
  for (const q of [...coches, a, enfant]) assert.equal(/❌/.test(q.texte ?? ''), false);
  // Décoché à la main : la case le dit, aucune phrase.
  assert.equal(feuillePlat(element('gratin-pates-jambon', { mange: { 'profil-a': false } })).qui[0].texte, null);
});

test('feuillePlat : compteurs nommés, invités repliés tant qu’il n’y en a pas, portions, versions, « Revenir »', () => {
  const depart = feuillePlat(element('gratin-pates-jambon'), { role: 'courses' });
  assert.deepEqual(depart.compteurs.repas, { ...COMPTEURS.repas, valeur: 2, nom: 'Repas : 2' });
  assert.equal(depart.compteurs.adultes.nom, 'Adultes invités : 0');
  assert.equal(depart.compteurs.enfants.nom, 'Enfants invités : 0');
  assert.deepEqual([depart.compteurs.repas.min, depart.compteurs.repas.max, depart.compteurs.adultes.min, depart.compteurs.adultes.max], [1, REPAS_MAX, 0, INVITES_MAX]);
  assert.deepEqual(depart.invites, { adultes: 0, enfants: 0, ouvert: false });
  assert.deepEqual(depart.repas, { valeur: 2, parDefaut: 2, touche: false });
  assert.equal(depart.portions, '5 portions à cuisiner. La recette en fait 4 : les quantités suivent.');
  assert.equal(depart.resume, 'Tout le monde · 2 repas · 5 portions');
  assert.deepEqual(depart.versions.map((v) => [v.profil.id, v.auChoix]), [['profil-b', ['mer', 'vegetal']]]);
  assert.equal(depart.conservation, '🐟 La part d’Adulte B se garde 2 jours après cuisson (le plat : 3).');
  assert.equal(depart.depart, false);
  const regle = feuillePlat(element('gratin-pates-jambon', { repas: 3, invites: { adultes: 1, enfants: 2 } }), { role: 'courses' });
  assert.deepEqual(regle.invites, { adultes: 1, enfants: 2, ouvert: true });
  assert.equal(regle.compteurs.adultes.nom, 'Adultes invités : 1');
  assert.equal(regle.compteurs.enfants.valeur, 2);
  assert.deepEqual(regle.repas, { valeur: 3, parDefaut: 2, touche: true });
  assert.equal(regle.portions, '13,5 portions à cuisiner. La recette en fait 4 : les quantités suivent.');
  assert.equal(regle.depart, true);
});

test('feuillePlat : rien pour un plat ⏳, de la corbeille ou introuvable', () => {
  assert.equal(feuillePlat(element('tarte-poireaux')), null);
  assert.equal(feuillePlat(element('jete')), null);
  assert.equal(feuillePlat(element('disparu')), null);
  assert.equal(feuillePlat(null), null);
});

test('textes de la feuille du plat et compteurs, mot pour mot', () => {
  assert.deepEqual({ ...TEXTES_PLAT_SEMAINE }, {
    quiEnMange: 'Qui en mange ?', invites: 'Des invités ?', depart: 'Revenir aux réglages de départ',
  });
  assert.deepEqual(Object.fromEntries(Object.entries(COMPTEURS).map(([k, c]) => [k, [c.etiquette, c.plus, c.moins]])), {
    repas: ['Pour combien de repas ?', 'Un repas de plus', 'Un repas de moins'],
    adultes: ['Adultes', 'Un adulte invité de plus', 'Un adulte invité de moins'],
    enfants: ['Enfants', 'Un enfant invité de plus', 'Un enfant invité de moins'],
  });
  assert.ok(Object.isFrozen(COMPTEURS) && Object.isFrozen(COMPTEURS.repas) && Object.isFrozen(TEXTES_PLAT_SEMAINE));
  assert.equal(nomCompteur('repas', 3), 'Repas : 3');
  assert.equal(nomCompteur('enfants', 0), 'Enfants invités : 0');
  assert.equal(nomCompteur('autre', 1), '');
});

// ——— Phrases de la carte avec des invités ———

test('resumePlat : invités énumérés avec les prénoms ; invités seuls ; personne', () => {
  assert.equal(resumePlat(element('gratin-pates-jambon', { invites: { adultes: 2 } })), 'Tout le monde et 2 invités · 2 repas · 9 portions');
  assert.equal(resumePlat(element('gratin-sans-version', { invites: { enfants: 1 } })), 'Adulte A, Enfant et 1 invité · 3 repas · 6 portions');
  assert.equal(resumePlat(element('gratin-pates-jambon', { mange: { 'profil-b': false, enfant: false }, invites: { adultes: 1, enfants: 1 } })),
    'Adulte A et 2 invités · 4 repas · 10 portions');
  const invitesSeuls = element('gratin-pates-jambon', { mange: { 'profil-a': false, 'profil-b': false, enfant: false }, invites: { adultes: 2 } });
  assert.equal(resumePlat(invitesSeuls), '2 invités · 1 repas · 2 portions');
  assert.equal(phrasePortions(invitesSeuls), '2 portions à cuisiner. La recette en fait 4 : les quantités suivent.');
  const personne = element('gratin-pates-jambon', { mange: { 'profil-a': false, 'profil-b': false, enfant: false } });
  assert.equal(resumePlat(personne), TEXTE_PERSONNE);
  assert.equal(phrasePortions(personne), TEXTE_PERSONNE);
  // T3a inchangé : deux prénoms sans invité.
  assert.equal(resumePlat(element('gratin-sans-version')), 'Adulte A et Enfant · 3 repas · 4,5 portions');
});

test('carte : un profil coché à la main n’est plus écarté ; raisonsEcartes inchangées', () => {
  assert.equal(exceptionPlat(element('gratin-sans-version', { mange: { 'profil-b': true } })), null);
  assert.equal(exceptionPlat(element('gratin-pates-jambon', { mange: { 'profil-a': false } })), 'Sans Adulte A.');
  assert.deepEqual(raisonsEcartes(element('gratin-sans-version'), { moi: B }).map((r) => r.texte), ['Pas encore de version pour vous.']);
  assert.deepEqual(raisonsEcartes(element('gratin-pates-jambon', { mange: { 'profil-a': false } }), { moi: A }).map((r) => r.texte), ['Vous n’en mangez pas.']);
  assert.deepEqual(raisonsEcartes(element('gratin-sans-version', { mange: { 'profil-b': true } })), []);
});
