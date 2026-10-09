// T2c-1 « 🧸 Précautions selon l'âge » : coeur/age.js (barème, âge, règles d'âge, plats repérés), et les ajustements
// de vocabulaire.js, regles.js, edition.js, paquet.js et sauvegarde.js. Fixtures génériques : profils `profil-a`,
// `profil-b`, `enfant` ; dates calculées depuis une date de référence fixe (REF), jamais l'âge réel d'un enfant.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TYPE_AGE, AGE_MAX_MOIS, BAREME_AGE, estRegleAge, ageEnMois, texteAge, texteBorne, texteReste, validerNaissance,
  naissanceLisible, palierEnVigueur, regleDuPalier, reglesSelonAge, basculerPrecaution, lireAge, ingredientsServis,
  precautionsAge, lignePrecautions, profilsAvecAge, bilanPrecautions,
} from '../js/coeur/age.js';
import * as vocabulaire from '../js/coeur/vocabulaire.js';
import * as compatibilite from '../js/coeur/compatibilite.js';
import {
  evaluer, profilsContraints, platsSansVersion, bilanCompatibilite, styleDe,
} from '../js/coeur/compatibilite.js';
import {
  ecrireRegime, lireRegime, validerRegles, decrireRegles, marqueursSurveilles,
} from '../js/coeur/regles.js';
import { filtresPour } from '../js/coeur/plats.js';
import { validerPaquet, preparerImport } from '../js/coeur/paquet.js';
import {
  texteDemandeRecette, texteDemandeIdees, texteDemandeVariantes, texteCorrectionPourClaude,
} from '../js/coeur/claude.js';
import { MARQUEURS_PREPARATION, catalogueProduits, ingredientSaisi } from '../js/coeur/edition.js';
import {
  creerSauvegarde, lireSauvegarde, validerSauvegarde, preparerRestauration, appliquerConditions,
} from '../js/coeur/sauvegarde.js';

// ——— Fixtures ———

/** Date de référence fixe des tests (date du téléphone, « AAAA-MM-JJ »). */
const REF = '2026-10-09';
const deux = (n) => String(n).padStart(2, '0');
/** Date de naissance d'un enfant qui a `mois` mois révolus à REF (calculée, jamais une vraie date). */
function neIlYA(mois) {
  const [a, m, j] = REF.split('-').map(Number);
  const total = a * 12 + (m - 1) - mois;
  return `${Math.floor(total / 12)}-${deux((total % 12) + 1)}-${deux(j)}`;
}

const ing = (produit, marqueurs = [], extra = {}) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs, ...extra });
const viande = (produit, marqueurs, extra = {}) => ing(produit, marqueurs, { forme: 'morceaux', ...extra });
const plat = (id, ingredients, extra = {}) => ({
  id, nom: extra.nom ?? `Plat ${id}`, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, ...extra,
});
const ajout = (produit, marqueurs = [], extra = {}) => ({ produit, qtePortion: 50, unite: 'g', rayon: 'divers', marqueurs, ...extra });

const CARPACCIO = plat('carpaccio', [viande('filet de bœuf', ['viande', 'boeuf', 'cru'], { forme: 'fine' }), ing('parmesan', ['laitier'])],
  { nom: 'Carpaccio de bœuf' });
const BURGER = plat('burger-rose', [viande('steak haché', ['viande', 'boeuf', 'cru'], { forme: 'hachee' }), ing('pain à burger', ['feculent'])],
  { nom: 'Burger rosé' });
const HUITRES = plat('huitres', [ing('huîtres', ['fruits_de_mer', 'cru'])], { nom: 'Huîtres', type: 'apero' });
const SAUMON_FUME = plat('saumon-fume', [ing('saumon fumé', ['poisson']), ing('blinis', ['feculent'])], { nom: 'Saumon fumé', type: 'apero' });
const TIRAMISU = plat('tiramisu', [ing('œuf', ['oeuf', 'oeuf_cru']), ing('mascarpone', ['laitier']), ing('café', ['cafe']),
  ing('marsala', ['alcool_cru'])], { nom: 'Tiramisu', type: 'dessert' });
const GRATIN_COMTE = plat('gratin-comte', [ing('comté', ['laitier']), ing('pomme de terre', ['legume'], { role: 'principal' })],
  { nom: 'Gratin au comté' });
const CAMEMBERT_ROTI = plat('camembert-roti', [ing('camembert', ['laitier', 'lait_cru']), ing('pain', ['feculent'])],
  { nom: 'Camembert et pain' });
const TARTIFLETTE = plat('tartiflette', [ing('reblochon', ['laitier']), viande('lardons', ['viande', 'porc', 'charcuterie']),
  ing('pomme de terre', ['legume'], { role: 'principal' })], { nom: 'Tartiflette' });
const SALADE_NOIX = plat('salade-noix', [ing('noix', ['fruit_coque']), ing('mâche', ['legume'], { role: 'principal' })],
  { nom: 'Salade aux noix', type: 'accompagnement' });
const ESPADON = plat('espadon', [ing('espadon', ['poisson', 'poisson_predateur'])], { nom: 'Espadon grillé' });
const ATTENTE = { id: 'a-ecrire', nom: 'Plat à écrire', statutRecette: 'attente' };
const FIXTURES = [CARPACCIO, BURGER, HUITRES, SAUMON_FUME, TIRAMISU, GRATIN_COMTE, CAMEMBERT_ROTI, TARTIFLETTE, SALADE_NOIX, ESPADON];

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const NI_POISSON = ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: new Set() }, []);
const reglesAge = (mois) => reglesSelonAge(neIlYA(mois), REF, []).regles;
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: 'b@example.com', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const enfant = (mois, extra = {}) => ({
  id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, naissance: neIlYA(mois), regles: reglesAge(mois), ...extra,
});
/** Enfant de 30 mois, œufs crus éteints (il mange déjà de la mousse au chocolat). */
const ENFANT_30 = enfant(30, { regles: basculerPrecaution(reglesAge(30), 'oeuf_cru', false) });
const ENFANT_70 = enfant(70);
const ENFANT_SANS = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [] };
/** Cas mixte : un régime ET des précautions d'âge. */
const ENFANT_MIXTE = enfant(30, { regles: [...NI_POISSON, ...reglesAge(30)] });
const ENFANT_REGIME = { ...ENFANT_SANS, regles: NI_POISSON };

const codes = (regles) => regles.filter(estRegleAge).map((r) => `${r.age.code}:${r.age.palier}`);
const resume = (precautions) => precautions.map((p) => `${p.code}:${p.severite}`);

/** Vrai si la valeur contient undefined, à quelque profondeur que ce soit. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientUndefined);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientUndefined);
  return false;
}

const TOUS = ['miel:0', 'lait_cru:0', 'viande_crue:0', 'charcuterie_crue:0', 'poisson_cru:0', 'oeuf_cru:0', 'fruit_coque:0',
  'poisson_predateur:0', 'soja:0', 'cafeine:0', 'alcool:0'];

// ——— Âge et textes ———

test('ageEnMois : mois révolus, veille et jour de l’anniversaire', () => {
  assert.equal(ageEnMois('2024-03-15', '2024-03-15'), 0);
  assert.equal(ageEnMois('2024-03-15', '2024-04-14'), 0);
  assert.equal(ageEnMois('2024-03-15', '2024-04-15'), 1);
  assert.equal(ageEnMois('2024-03-15', '2025-03-14'), 11);
  assert.equal(ageEnMois('2024-03-15', '2025-03-15'), 12);
  assert.equal(ageEnMois('2020-10-09', '2025-10-08'), 59);
  assert.equal(ageEnMois('2020-10-09', '2025-10-09'), 60);
  for (const mois of [0, 1, 6, 30, 70, 190, 216, 220]) assert.equal(ageEnMois(neIlYA(mois), REF), mois);
});

test('ageEnMois : né un 29 février ou un 31, le mois est révolu le dernier jour d’un mois plus court', () => {
  assert.equal(ageEnMois('2024-02-29', '2025-02-27'), 11);
  assert.equal(ageEnMois('2024-02-29', '2025-02-28'), 12);
  assert.equal(ageEnMois('2024-02-29', '2028-02-28'), 47);
  assert.equal(ageEnMois('2024-02-29', '2028-02-29'), 48);
  assert.equal(ageEnMois('2024-01-31', '2024-04-29'), 2);
  assert.equal(ageEnMois('2024-01-31', '2024-04-30'), 3);
  assert.equal(ageEnMois('2024-01-31', '2024-02-28'), 0);
  assert.equal(ageEnMois('2024-01-31', '2024-02-29'), 1);
  assert.equal(ageEnMois('2023-01-30', '2023-02-28'), 1);
});

test('ageEnMois : date invalide, absente ou future → null ; une Date (date locale) est acceptée', () => {
  for (const valeur of [undefined, null, '', '2025-02-30', '2024-13-01', '2024-1-01', ' 2024-01-01', '01/02/2024', 20240101, {}]) {
    assert.equal(ageEnMois(valeur, REF), null, String(valeur));
  }
  assert.equal(ageEnMois('2026-10-10', REF), null);
  assert.equal(ageEnMois('2024-01-01', 'hier'), null);
  assert.equal(ageEnMois('2024-01-01', new Date(2025, 0, 1)), 12);
  assert.equal(ageEnMois('2024-01-01', new Date(Number.NaN)), null);
});

test('texteAge, texteBorne, texteReste : mois sous deux ans, années ensuite', () => {
  const mois = [0, 1, 11, 12, 18, 23, 24, 59, 60, 179];
  assert.deepEqual(mois.map(texteAge),
    ['0 mois', '1 mois', '11 mois', '12 mois', '18 mois', '23 mois', '2 ans', '4 ans', '5 ans', '14 ans']);
  assert.deepEqual(mois.map(texteReste), ['encore 0 mois', 'encore 1 mois', 'encore 11 mois', 'encore 12 mois',
    'encore 18 mois', 'encore 23 mois', 'encore 2 ans', 'encore 4 ans', 'encore 5 ans', 'encore 14 ans']);
  assert.deepEqual(mois.map(texteBorne),
    ['0 mois', '1 mois', '11 mois', '1 an', '18 mois', '23 mois', '2 ans', '4 ans et 11 mois', '5 ans', '14 ans et 11 mois']);
  // Bornes du barème : toujours des années entières.
  assert.deepEqual([12, 36, 60, 180, 216].map(texteBorne), ['1 an', '3 ans', '5 ans', '15 ans', '18 ans']);
  assert.equal(texteReste(132), 'encore 11 ans');
  assert.equal(texteReste(8), 'encore 8 mois');
  assert.equal(texteAge(Number.NaN), '0 mois');
});

test('validerNaissance : format, date impossible, futur, aujourd’hui accepté, 216 mois acceptés, 217 trop ancienne', () => {
  for (const valeur of ['', '2025-02-30', '2025-2-3', '03/02/2025', ' 2025-02-03', null, undefined, 20250203]) {
    assert.deepEqual(validerNaissance(valeur, REF), { erreur: 'format' }, String(valeur));
  }
  assert.deepEqual(validerNaissance('2026-10-10', REF), { erreur: 'futur' });
  assert.deepEqual(validerNaissance(REF, REF), { naissance: REF });
  assert.deepEqual(validerNaissance(neIlYA(30), REF), { naissance: neIlYA(30) });
  assert.equal(ageEnMois(neIlYA(AGE_MAX_MOIS), REF), 216);
  assert.deepEqual(validerNaissance(neIlYA(216), REF), { naissance: neIlYA(216) });
  assert.deepEqual(validerNaissance(neIlYA(217), REF), { erreur: 'ancienne' });
  assert.deepEqual(validerNaissance('1950-01-01', REF), { erreur: 'ancienne' });
  assert.deepEqual(validerNaissance('2024-02-29', REF), { naissance: '2024-02-29' });
});

test('naissanceLisible : date réelle, même très ancienne ; jamais une date impossible', () => {
  assert.equal(naissanceLisible('1900-01-01'), true);
  assert.equal(naissanceLisible('2024-02-29'), true);
  assert.equal(naissanceLisible('2099-12-31'), true);
  for (const valeur of ['2025-02-30', '2023-02-29', '2025-00-10', '2025-1-10', ' 2025-01-10', '', null, 20250110, {}]) {
    assert.equal(naissanceLisible(valeur), false, String(valeur));
  }
});

// ——— Barème et règles ———

test('BAREME_AGE : marqueurs connus, paliers strictement croissants, codes uniques, libellés courts, conseils', () => {
  const codesVus = new Set();
  for (const entree of BAREME_AGE) {
    assert.ok(!codesVus.has(entree.code), entree.code);
    codesVus.add(entree.code);
    assert.match(entree.code, /^[a-z0-9_]+$/);
    assert.ok(entree.libelle.length <= 26, entree.libelle);
    assert.ok(typeof entree.court === 'string' && entree.court);
    for (const marqueur of [...entree.marqueurs, ...(entree.etMarqueurs ?? []), ...(entree.saufMarqueurs ?? [])]) {
      assert.ok(vocabulaire.VOCABULAIRES.marqueurs.includes(marqueur), `${entree.code} : ${marqueur}`);
    }
    assert.ok(entree.paliers.length >= 1);
    entree.paliers.forEach((palier, i) => {
      assert.ok(['exclu', 'adaptable'].includes(palier.severite));
      assert.ok(Number.isInteger(palier.jusquAMois) && palier.jusquAMois >= 1 && palier.jusquAMois <= AGE_MAX_MOIS);
      if (i > 0) assert.ok(palier.jusquAMois > entree.paliers[i - 1].jusquAMois, entree.code);
      if (palier.severite === 'adaptable') assert.ok(palier.consigne, `${entree.code} : conseil manquant`);
      else assert.equal(palier.consigne, undefined);
    });
  }
  assert.equal(TYPE_AGE, 'precautionAge');
  assert.equal(AGE_MAX_MOIS, 216);
});

test('BAREME_AGE : bornes des décisions A à E, dans l’ordre du tableau', () => {
  const lu = Object.fromEntries(BAREME_AGE.map((e) => [e.code, e.paliers.map((p) => `${p.severite === 'exclu' ? '❌' : '!'} ${p.jusquAMois}`)]));
  assert.deepEqual(lu, {
    miel: ['❌ 12'],
    lait_cru: ['❌ 60', '! 180'],
    viande_crue: ['❌ 36', '! 180'],
    charcuterie_crue: ['❌ 36'],
    poisson_cru: ['❌ 36'],
    oeuf_cru: ['❌ 36'],
    fruit_coque: ['❌ 60'],
    poisson_predateur: ['❌ 36'],
    soja: ['! 36'],
    cafeine: ['❌ 216'],
    alcool: ['❌ 216'],
  });
  assert.deepEqual(BAREME_AGE.map((e) => e.court), ['miel', 'lait cru', 'viande crue', 'charcuterie crue', 'poisson cru',
    'œuf cru', 'fruits à coque', 'espadon, requin', 'soja', 'café, thé', 'alcool']);
  const viandeCrue = BAREME_AGE.find((e) => e.code === 'viande_crue');
  assert.deepEqual([viandeCrue.marqueurs, viandeCrue.etMarqueurs, viandeCrue.saufMarqueurs], [['cru'], ['viande'], ['charcuterie']]);
  assert.equal(viandeCrue.paliers[1].consigne, 'Cuire à cœur, sans rose (surtout la viande hachée).');
  assert.deepEqual(BAREME_AGE.find((e) => e.code === 'poisson_cru').etMarqueurs, ['poisson', 'fruits_de_mer']);
  assert.deepEqual(BAREME_AGE.find((e) => e.code === 'cafeine').marqueurs, ['cafeine']);
});

test('palierEnVigueur : premier palier dont l’âge est sous la borne ; -1 si tous sont passés ou sans âge', () => {
  const laitCru = BAREME_AGE.find((e) => e.code === 'lait_cru');
  assert.equal(palierEnVigueur(laitCru, 0), 0);
  assert.equal(palierEnVigueur(laitCru, 59), 0);
  assert.equal(palierEnVigueur(laitCru, 60), 1);
  assert.equal(palierEnVigueur(laitCru, 179), 1);
  assert.equal(palierEnVigueur(laitCru, 180), -1);
  assert.equal(palierEnVigueur(laitCru, null), -1);
  assert.equal(palierEnVigueur(null, 10), -1);
});

test('regleDuPalier : forme exacte, type precautionAge, jamais de clé undefined', () => {
  const viandeCrue = BAREME_AGE.find((e) => e.code === 'viande_crue');
  assert.deepEqual(regleDuPalier(viandeCrue, 1), {
    id: 'age-viande_crue', type: 'precautionAge', marqueurs: ['cru'], etMarqueurs: ['viande'], saufMarqueurs: ['charcuterie'],
    severite: 'adaptable', consigne: 'Cuire à cœur, sans rose (surtout la viande hachée).',
    age: { code: 'viande_crue', palier: 1, jusquAMois: 180 }, actif: true,
  });
  const laitCru = BAREME_AGE.find((e) => e.code === 'lait_cru');
  const regle = regleDuPalier(laitCru, 0, { actif: false });
  assert.deepEqual(regle, {
    id: 'age-lait_cru', type: 'precautionAge', marqueurs: ['lait_cru'], severite: 'exclu',
    age: { code: 'lait_cru', palier: 0, jusquAMois: 60 }, actif: false,
  });
  assert.deepEqual(Object.keys(regle), ['id', 'type', 'marqueurs', 'severite', 'age', 'actif']);
  for (const entree of BAREME_AGE) {
    entree.paliers.forEach((_, i) => assert.equal(contientUndefined(regleDuPalier(entree, i)), false));
  }
  assert.equal(regleDuPalier(laitCru, 2), null);
  assert.equal(regleDuPalier(laitCru, -1), null);
  assert.equal(regleDuPalier(laitCru, '0'), null);
  // Une copie : modifier la règle ne touche pas le barème.
  regleDuPalier(viandeCrue, 0).marqueurs.push('x');
  assert.deepEqual(viandeCrue.marqueurs, ['cru']);
});

test('regleDuPalier : chaque règle du barème passe validerRegles telle quelle', () => {
  const regles = BAREME_AGE.flatMap((entree) => entree.paliers.map((_, i) => regleDuPalier(entree, i)));
  assert.equal(regles.length, 13);
  const lues = validerRegles(regles);
  assert.deepEqual(lues, { regles, avertissements: [] });
});

test('reglesSelonAge : listes exactes à 6, 11, 13, 30, 40, 70, 190 et 220 mois', () => {
  const sansMiel = TOUS.slice(1);
  const attendu = {
    6: TOUS,
    11: TOUS,
    13: sansMiel,
    30: sansMiel,
    40: ['lait_cru:0', 'viande_crue:1', 'fruit_coque:0', 'cafeine:0', 'alcool:0'],
    70: ['lait_cru:1', 'viande_crue:1', 'cafeine:0', 'alcool:0'],
    190: ['cafeine:0', 'alcool:0'],
    220: [],
  };
  for (const [mois, liste] of Object.entries(attendu)) {
    const r = reglesSelonAge(neIlYA(Number(mois)), REF, []);
    assert.deepEqual(codes(r.regles), liste, `${mois} mois`);
    assert.deepEqual(r.ajoutees, liste.map((c) => c.split(':')[0]), `${mois} mois`);
    assert.deepEqual(r.durcies, []);
    assert.ok(r.regles.every((regle) => regle.actif === true && regle.id === `age-${regle.age.code}`));
    assert.equal(contientUndefined(r.regles), false);
  }
});

test('reglesSelonAge : date rajeunie → règles durcies à leur place (actif gardé, garde retiré), manquantes ajoutées', () => {
  // Enregistré : 70 mois, lait cru éteint et gardé exprès ; viande crue gardée.
  const enregistrees = reglesAge(70).map((regle) => {
    if (regle.age.code === 'lait_cru') return { ...regle, actif: false, age: { ...regle.age, garde: true } };
    if (regle.age.code === 'viande_crue') return { ...regle, age: { ...regle.age, garde: true } };
    return regle;
  });
  const r = reglesSelonAge(neIlYA(30), REF, enregistrees);
  assert.deepEqual(r.durcies, ['lait_cru', 'viande_crue']);
  assert.deepEqual(r.ajoutees, ['charcuterie_crue', 'poisson_cru', 'oeuf_cru', 'fruit_coque', 'poisson_predateur', 'soja']);
  assert.deepEqual(codes(r.regles), ['lait_cru:0', 'viande_crue:0', 'cafeine:0', 'alcool:0', 'charcuterie_crue:0',
    'poisson_cru:0', 'oeuf_cru:0', 'fruit_coque:0', 'poisson_predateur:0', 'soja:0']);
  const lait = r.regles.find((regle) => regle.age.code === 'lait_cru');
  assert.deepEqual(lait, { ...regleDuPalier(BAREME_AGE[1], 0), actif: false });
  assert.equal(Object.hasOwn(lait.age, 'garde'), false);
  const viandeCrue = r.regles.find((regle) => regle.age.code === 'viande_crue');
  assert.equal(viandeCrue.actif, true);
  assert.equal(viandeCrue.severite, 'exclu');
  assert.equal(Object.hasOwn(viandeCrue, 'consigne'), false);
  assert.equal(contientUndefined(r), false);
  // Les règles reçues ne sont jamais modifiées.
  assert.equal(enregistrees[0].actif, false);
});

test('reglesSelonAge : date vieillie → rien ne change (jamais d’assouplissement ni de retrait)', () => {
  for (const [avant, apres] of [[6, 40], [30, 70], [70, 220], [11, 190]]) {
    const enregistrees = reglesAge(avant);
    const r = reglesSelonAge(neIlYA(apres), REF, enregistrees);
    assert.deepEqual(r, { regles: enregistrees, ajoutees: [], durcies: [] }, `${avant} → ${apres} mois`);
  }
  // Plus strict que le palier en vigueur : gardé tel quel.
  const strict = [regleDuPalier(BAREME_AGE[1], 0)];
  assert.deepEqual(reglesSelonAge(neIlYA(70), REF, strict).regles[0], strict[0]);
});

test('reglesSelonAge : régime et code inconnu intacts et à leur place ; ajouts à la fin, dans l’ordre du barème', () => {
  const inconnue = { id: 'age-futur', type: 'precautionAge', marqueurs: ['cru'], severite: 'exclu', age: { code: 'futur', palier: 0, jusquAMois: 48 }, actif: true };
  const produits = { type: 'exclureProduits', produits: ['navet'], severite: 'exclu' };
  const typeFutur = { type: 'typeFutur', regle: { a: 1 } };
  const enregistrees = [inconnue, ...NI_POISSON, produits, typeFutur, regleDuPalier(BAREME_AGE[9], 0)];
  const r = reglesSelonAge(neIlYA(190), REF, enregistrees);
  assert.deepEqual(r.regles, [inconnue, ...NI_POISSON, produits, typeFutur, regleDuPalier(BAREME_AGE[9], 0), regleDuPalier(BAREME_AGE[10], 0)]);
  assert.deepEqual(r.ajoutees, ['alcool']);
  assert.deepEqual(lireRegime(r.regles).regime, 'sans_viande_ni_poisson');
});

test('reglesSelonAge : doublons → un seul, celui qui agit puis le plus strict, à la place du premier (à égalité, le premier)', () => {
  const laitCru = BAREME_AGE.find((e) => e.code === 'lait_cru');
  const souple = regleDuPalier(laitCru, 1);
  const strict = regleDuPalier(laitCru, 0);
  const strictEteint = regleDuPalier(laitCru, 0, { actif: false });
  const soupleEteint = regleDuPalier(laitCru, 1, { actif: false });
  // Deux règles actives : la plus stricte, à la place de la première.
  const r = reglesSelonAge(neIlYA(190), REF, [...SANS_VIANDE, souple, strict]);
  assert.deepEqual(r.regles, [...SANS_VIANDE, strict, regleDuPalier(BAREME_AGE[9], 0), regleDuPalier(BAREME_AGE[10], 0)]);
  // Deux règles éteintes : la plus stricte.
  assert.deepEqual(reglesSelonAge(neIlYA(220), REF, [soupleEteint, strictEteint]).regles, [strictEteint]);
  // À égalité : le premier.
  const premier = { ...regleDuPalier(laitCru, 0), id: 'premier' };
  const second = { ...regleDuPalier(laitCru, 0), id: 'second' };
  const egalite = reglesSelonAge(neIlYA(220), REF, [premier, second]);
  assert.deepEqual(egalite.regles, [premier]);
  // Palier inconnu face à un palier connu : le connu.
  const inconnu = { ...regleDuPalier(laitCru, 0), age: { code: 'lait_cru', palier: 5, jusquAMois: 200 } };
  assert.deepEqual(reglesSelonAge(neIlYA(220), REF, [inconnu, souple]).regles, [souple]);
});

test('reglesSelonAge : doublons → une règle active passe toujours avant une règle éteinte (jamais d’assouplissement sans toucher)', () => {
  const laitCru = BAREME_AGE.find((e) => e.code === 'lait_cru');
  const oeufCru = BAREME_AGE.find((e) => e.code === 'oeuf_cru');
  const souple = regleDuPalier(laitCru, 1);
  const strictEteint = regleDuPalier(laitCru, 0, { actif: false });
  // Active moins stricte + éteinte plus stricte, dans les deux ordres : l'active reste, à la place de la première.
  for (const enregistrees of [[souple, strictEteint], [strictEteint, souple]]) {
    const profil = { ...ENFANT_70, regles: [...SANS_VIANDE, ...enregistrees] };
    const avant = precautionsAge(CAMEMBERT_ROTI, profil);
    assert.deepEqual(resume(avant), ['lait_cru:attention']);
    const r = reglesSelonAge(profil.naissance, REF, profil.regles);
    assert.deepEqual(r.regles.filter((regle) => regle.age?.code === 'lait_cru'), [souple]);
    assert.equal(r.regles.findIndex((regle) => regle.age?.code === 'lait_cru'), SANS_VIANDE.length);
    assert.deepEqual(precautionsAge(CAMEMBERT_ROTI, { ...profil, regles: r.regles }), avant, 'la précaution reste après Enregistrer');
    // L'écran montre la même chose que les plats : l'interrupteur allumé, sur la règle qui agit.
    const lue = lireAge(profil, REF).find((e) => e.regle.age.code === 'lait_cru');
    assert.equal(lue.regle, souple);
    assert.equal(lue.etat, 'en_cours');
  }
  // Même palier : l'éteinte d'abord, l'active ensuite → l'active, à la place de la première.
  const oeufEteint = regleDuPalier(oeufCru, 0, { actif: false });
  const oeufActif = regleDuPalier(oeufCru, 0);
  const profil30 = enfant(30, { regles: [oeufEteint, oeufActif] });
  assert.deepEqual(resume(precautionsAge(TIRAMISU, profil30)).filter((c) => c.startsWith('oeuf_cru')), ['oeuf_cru:exclu']);
  const r30 = reglesSelonAge(profil30.naissance, REF, profil30.regles);
  assert.deepEqual(r30.regles[0], oeufActif);
  assert.deepEqual(r30.regles.filter((regle) => regle.age?.code === 'oeuf_cru'), [oeufActif]);
  assert.deepEqual(resume(precautionsAge(TIRAMISU, { ...profil30, regles: r30.regles })).filter((c) => c.startsWith('oeuf_cru')),
    ['oeuf_cru:exclu']);
  assert.equal(lireAge(profil30, REF).find((e) => e.regle.age.code === 'oeuf_cru').etat, 'en_cours');
  // Active moins stricte qu'il ne faut + éteinte stricte : l'active est durcie, et reste active.
  const r40 = reglesSelonAge(neIlYA(40), REF, [souple, strictEteint]);
  assert.deepEqual(r40.regles.filter((regle) => regle.age?.code === 'lait_cru'), [regleDuPalier(laitCru, 0)]);
  assert.deepEqual(r40.durcies, ['lait_cru']);
  // Une règle « active » sans marqueur n'agit pas : une règle active avec ses marqueurs passe avant elle, même moins stricte.
  const sansMarqueur = { ...regleDuPalier(laitCru, 0), marqueurs: [] };
  assert.deepEqual(reglesSelonAge(neIlYA(220), REF, [sansMarqueur, souple]).regles, [souple]);
});

test('reglesSelonAge : palier inconnu de cette version gardé ; sans date lisible, rien d’ajouté ni de durci', () => {
  const futur = { ...regleDuPalier(BAREME_AGE[1], 0), age: { code: 'lait_cru', palier: 4, jusquAMois: 90 } };
  const r = reglesSelonAge(neIlYA(30), REF, [futur]);
  assert.deepEqual(r.regles[0], futur);
  assert.deepEqual(r.durcies, []);
  assert.ok(!r.ajoutees.includes('lait_cru'));
  // Date effacée ou illisible : les précautions restent, rien n'est ajouté.
  const enregistrees = reglesAge(70);
  for (const date of [null, '', '2025-02-30', '2027-01-01']) {
    assert.deepEqual(reglesSelonAge(date, REF, enregistrees), { regles: enregistrees, ajoutees: [], durcies: [] });
  }
  assert.deepEqual(reglesSelonAge(null, REF, undefined), { regles: [], ajoutees: [], durcies: [] });
  assert.deepEqual(reglesSelonAge(neIlYA(30), REF, [undefined, ...SANS_VIANDE]).regles.slice(0, 1), SANS_VIANDE);
});

test('brouillon : date trop jeune puis corrigée → même résultat que la seule date corrigée (calcul depuis l’enregistré)', () => {
  const enregistrees = reglesAge(70);
  const tropJeune = reglesSelonAge(neIlYA(10), REF, enregistrees);
  assert.ok(tropJeune.durcies.length > 0);
  const corrigee = reglesSelonAge(neIlYA(70), REF, enregistrees);
  assert.deepEqual(corrigee, reglesSelonAge(neIlYA(70), REF, enregistrees));
  assert.deepEqual(corrigee.regles, enregistrees);
  // Le calcul depuis le brouillon précédent garderait des paliers trop stricts : jamais fait par l'écran.
  assert.notDeepEqual(reglesSelonAge(neIlYA(70), REF, tropJeune.regles).regles, enregistrees);
});

test('basculerPrecaution : seul `actif` de la règle de ce code change (copie)', () => {
  const regles = [...SANS_VIANDE, ...reglesAge(30)];
  const eteintes = basculerPrecaution(regles, 'oeuf_cru', false);
  assert.equal(eteintes.length, regles.length);
  eteintes.forEach((regle, i) => {
    if (regle.age?.code === 'oeuf_cru') assert.deepEqual(regle, { ...regles[i], actif: false });
    else assert.deepEqual(regle, regles[i]);
  });
  assert.equal(regles.find((r) => r.age?.code === 'oeuf_cru').actif, true);
  assert.deepEqual(basculerPrecaution(eteintes, 'oeuf_cru', true), regles);
  assert.deepEqual(basculerPrecaution(regles, 'inconnu', false), regles);
  assert.deepEqual(basculerPrecaution(null, 'miel', false), []);
  // Jamais de valeur undefined dans ce qui sera écrit, même si la liste lue en portait.
  const abimee = [{ ...regleDuPalier(BAREME_AGE[0], 0), consigne: undefined }, undefined, { type: 'typeFutur', x: [1, undefined] }];
  const propre = basculerPrecaution(abimee, 'miel', false);
  assert.equal(contientUndefined(propre), false);
  assert.deepEqual(propre, [{ ...regleDuPalier(BAREME_AGE[0], 0), actif: false }, { type: 'typeFutur', x: [1] }]);
  assert.equal(contientUndefined(reglesSelonAge(neIlYA(6), REF, abimee)), false);
});

test('lireAge : une entrée par code, ordre du barème, quatre états, reste en mois', () => {
  const regles = [
    { ...regleDuPalier(BAREME_AGE[10], 0) }, // alcool, en cours
    { id: 'age-futur', type: 'precautionAge', marqueurs: ['cru'], severite: 'exclu', age: { code: 'futur', palier: 0, jusquAMois: 24 } },
    ...SANS_VIANDE,
    regleDuPalier(BAREME_AGE[0], 0), // miel : âge passé (avant T2c-3, la règle reste)
    regleDuPalier(BAREME_AGE[5], 0, { actif: false }), // œuf cru désactivé
    { ...regleDuPalier(BAREME_AGE[1], 0), age: { code: 'lait_cru', palier: 0, jusquAMois: 60, garde: true } },
    regleDuPalier(BAREME_AGE[1], 1), // doublon moins strict : ignoré
  ];
  const lu = lireAge({ naissance: neIlYA(30), regles }, REF);
  assert.deepEqual(lu.map((e) => [e.regle.age.code, e.etat, e.resteMois]), [
    ['miel', 'passee', -18],
    ['lait_cru', 'gardee', 30],
    ['oeuf_cru', 'desactivee', 6],
    ['alcool', 'en_cours', 186],
    ['futur', 'passee', -6],
  ]);
  assert.equal(lu[0].entree, BAREME_AGE[0]);
  assert.equal(lu[4].entree, null);
  assert.equal(lu[1].regle.age.palier, 0);
  // Sans date : pas d'âge, rien de « passé ».
  assert.deepEqual(lireAge({ regles }, REF).map((e) => [e.etat, e.resteMois]),
    [['en_cours', null], ['gardee', null], ['desactivee', null], ['en_cours', null], ['en_cours', null]]);
  assert.deepEqual(lireAge({ regles: SANS_VIANDE }, REF), []);
  assert.deepEqual(lireAge(null, REF), []);
});

// ——— precautionsAge ———

test('precautionsAge : viande crue, charcuterie crue, cru sans effet, poisson fumé non compté', () => {
  const enfant30 = enfant(30);
  const boeufCru = plat('x', [viande('bœuf', ['viande', 'boeuf', 'cru'], { forme: 'fine' })]);
  assert.deepEqual(resume(precautionsAge(boeufCru, enfant30)), ['viande_crue:exclu']);
  const jambonCru = plat('x', [viande('jambon cru', ['viande', 'porc', 'charcuterie', 'cru'], { forme: 'fine' })]);
  assert.deepEqual(resume(precautionsAge(jambonCru, enfant30)), ['charcuterie_crue:exclu']);
  assert.deepEqual(resume(precautionsAge(jambonCru, ENFANT_70)), [], 'charcuterie crue : rien après 3 ans');
  const carotteCrue = plat('x', [ing('carotte', ['legume', 'cru'], { role: 'principal' })]);
  assert.deepEqual(precautionsAge(carotteCrue, enfant30), []);
  assert.deepEqual(precautionsAge(SAUMON_FUME, enfant30), []);
  assert.deepEqual(resume(precautionsAge(HUITRES, enfant30)), ['poisson_cru:exclu']);
});

test('precautionsAge : café → caféine ; espadon sans le repère poisson ; soja en « attention » avec conseil', () => {
  const enfant30 = enfant(30);
  const cafe = precautionsAge(plat('x', [ing('expresso', ['cafe'])], { type: 'dessert' }), enfant30);
  assert.deepEqual(cafe, [{ code: 'cafeine', severite: 'exclu', court: 'café, thé', jusquAMois: 216, produits: ['expresso'] }]);
  const espadon = precautionsAge(plat('x', [ing('espadon', ['poisson_predateur'])]), enfant30);
  assert.deepEqual(resume(espadon), ['poisson_predateur:exclu']);
  const soja = precautionsAge(plat('x', [ing('tofu', ['soja'])]), enfant30);
  assert.deepEqual(soja, [{
    code: 'soja', severite: 'attention', court: 'soja', consigne: 'Préférer une autre protéine.', jusquAMois: 36, produits: ['tofu'],
  }]);
  assert.deepEqual(precautionsAge(plat('x', [ing('tofu', ['soja'])]), ENFANT_70), []);
});

test('precautionsAge : règle éteinte ignorée ; palier « ! » → attention + conseil ; « ❌ » sans conseil', () => {
  assert.deepEqual(resume(precautionsAge(TIRAMISU, enfant(30))), ['cafeine:exclu', 'alcool:exclu', 'oeuf_cru:exclu']);
  assert.deepEqual(resume(precautionsAge(TIRAMISU, ENFANT_30)), ['cafeine:exclu', 'alcool:exclu']);
  const [viandeRosee] = precautionsAge(CARPACCIO, ENFANT_70);
  assert.deepEqual(viandeRosee, {
    code: 'viande_crue', severite: 'attention', court: 'viande crue', consigne: 'Cuire à cœur, sans rose (surtout la viande hachée).',
    jusquAMois: 180, produits: ['filet de bœuf'],
  });
  const [pasAvant] = precautionsAge(CARPACCIO, ENFANT_30);
  assert.equal(Object.hasOwn(pasAvant, 'consigne'), false);
  assert.equal(pasAvant.severite, 'exclu');
});

test('precautionsAge : tri (exclu, borne décroissante, barème), produits uniques, plat ⏳ → []', () => {
  const melange = plat('x', [
    ing('tofu', ['soja']), ing('noix', ['fruit_coque']), ing('miel', ['miel']), ing('rhum', ['alcool_cru']),
    ing('Noix', ['fruit_coque']), ing('cerneaux de noix', ['fruit_coque']), ing('camembert', ['laitier', 'lait_cru']),
  ]);
  const p = precautionsAge(melange, enfant(6));
  assert.deepEqual(resume(p), ['alcool:exclu', 'lait_cru:exclu', 'fruit_coque:exclu', 'miel:exclu', 'soja:attention']);
  assert.deepEqual(p.find((x) => x.code === 'fruit_coque').produits, ['noix', 'cerneaux de noix']);
  assert.deepEqual(precautionsAge(ATTENTE, enfant(6)), []);
  assert.deepEqual(precautionsAge({ ...CARPACCIO, ingredients: [] }, enfant(6)), []);
  assert.deepEqual(precautionsAge(CARPACCIO, ADULTE_B), [], 'un régime n’est jamais une précaution d’âge');
  assert.deepEqual(precautionsAge(CARPACCIO, null), []);
});

test('precautionsAge : le plat tel qu’il est servi (version qui retire le camembert, version qui ajoute du tofu)', () => {
  const sansCamembert = { retirer: ['Camembert'], ajouter: [ajout('comté', ['laitier'])] };
  assert.deepEqual(ingredientsServis(CAMEMBERT_ROTI, sansCamembert).map((i) => i.produit), ['pain', 'comté']);
  assert.deepEqual(precautionsAge(CAMEMBERT_ROTI, ENFANT_30, { variante: sansCamembert }), []);
  assert.deepEqual(resume(precautionsAge(CAMEMBERT_ROTI, ENFANT_30)), ['lait_cru:exclu']);
  const tofu = { retirer: ['lardons'], ajouter: [ajout('tofu fumé', ['soja'])] };
  assert.deepEqual(resume(precautionsAge(TARTIFLETTE, ENFANT_30, { variante: tofu })), ['soja:attention']);
  assert.deepEqual(ingredientsServis(TARTIFLETTE, null), TARTIFLETTE.ingredients);
  assert.deepEqual(ingredientsServis(null, tofu), tofu.ajouter);
  assert.deepEqual(precautionsAge(null, ENFANT_30, { variante: tofu }), [], 'plat sans recette : rien, même avec une version');
});

test('precautionsAge : apéro et préparations compris (l’enfant en mange)', () => {
  const yaourt = plat('yaourt-miel', [ing('yaourt', ['laitier']), ing('miel', ['miel'])], { type: 'preparation' });
  assert.deepEqual(resume(precautionsAge(yaourt, enfant(6))), ['miel:exclu']);
  assert.deepEqual(resume(precautionsAge(HUITRES, enfant(6))), ['poisson_cru:exclu']);
  const cocktail = plat('cocktail', [ing('rhum', ['alcool_cru'])], { type: 'apero' });
  assert.deepEqual(resume(precautionsAge(cocktail, ENFANT_70)), ['alcool:exclu']);
});

test('precautionsAge : deux règles du même code dans le profil → une seule ligne, la plus grave', () => {
  const doubles = { id: 'enfant', regles: [regleDuPalier(BAREME_AGE[1], 1), regleDuPalier(BAREME_AGE[1], 0)] };
  assert.deepEqual(precautionsAge(CAMEMBERT_ROTI, doubles), [
    { code: 'lait_cru', severite: 'exclu', court: 'lait cru', jusquAMois: 60, produits: ['camembert'] },
  ]);
  // Code inconnu de cette version : ses marqueurs servent de mot court.
  const futur = { id: 'enfant', regles: [{ type: 'precautionAge', marqueurs: ['cru', 'laitier'], severite: 'exclu', age: { code: 'futur', palier: 0, jusquAMois: 48 } }] };
  assert.deepEqual(precautionsAge(GRATIN_COMTE, futur), [
    { code: 'futur', severite: 'exclu', court: 'cru, laitier', jusquAMois: 48, produits: ['comté'] },
  ]);
});

// ——— lignePrecautions ———

test('lignePrecautions : la borne la plus haute du groupe le plus grave, deux mots au plus, puis « + N autres »', () => {
  const alcool = { code: 'alcool', severite: 'exclu', court: 'alcool', jusquAMois: 216, produits: ['rhum'] };
  const laitCru = { code: 'lait_cru', severite: 'exclu', court: 'lait cru', jusquAMois: 60, produits: ['camembert'] };
  const cafe = { code: 'cafeine', severite: 'exclu', court: 'café, thé', jusquAMois: 216, produits: ['café'] };
  const viandeRosee = { code: 'viande_crue', severite: 'attention', court: 'viande crue', jusquAMois: 180, produits: ['rôti'] };
  const soja = { code: 'soja', severite: 'attention', court: 'soja', jusquAMois: 36, produits: ['tofu'] };
  const miel = { code: 'miel', severite: 'exclu', court: 'miel', jusquAMois: 12, produits: ['miel'] };
  assert.deepEqual(lignePrecautions([alcool, laitCru]), { severite: 'exclu', jusquAMois: 216, courts: ['alcool'], autres: 1 });
  assert.deepEqual(lignePrecautions([cafe, alcool]), { severite: 'exclu', jusquAMois: 216, courts: ['café, thé', 'alcool'], autres: 0 });
  assert.deepEqual(lignePrecautions([viandeRosee, soja]), { severite: 'attention', jusquAMois: 180, courts: ['viande crue'], autres: 1 });
  assert.deepEqual(lignePrecautions([laitCru, viandeRosee]), { severite: 'exclu', jusquAMois: 60, courts: ['lait cru'], autres: 0 });
  const troisMemeBorne = [{ ...laitCru }, { ...laitCru, code: 'fruit_coque', court: 'fruits à coque' }, { ...laitCru, code: 'x', court: 'x' }, miel];
  assert.deepEqual(lignePrecautions(troisMemeBorne), { severite: 'exclu', jusquAMois: 60, courts: ['lait cru', 'fruits à coque'], autres: 2 });
  assert.equal(lignePrecautions([]), null);
  assert.equal(lignePrecautions(null), null);
  assert.deepEqual(lignePrecautions(precautionsAge(TIRAMISU, ENFANT_30)),
    { severite: 'exclu', jusquAMois: 216, courts: ['café, thé', 'alcool'], autres: 0 });
});

// ——— Fixtures « enfant » ———

test('fixtures enfant : 30 mois (œufs crus éteints), plat par plat', () => {
  const lu = Object.fromEntries(FIXTURES.map((p) => [p.id, precautionsAge(p, ENFANT_30).map((x) => `${x.code}:${x.severite}:${x.produits.join('+')}`)]));
  assert.deepEqual(lu, {
    carpaccio: ['viande_crue:exclu:filet de bœuf'],
    'burger-rose': ['viande_crue:exclu:steak haché'],
    huitres: ['poisson_cru:exclu:huîtres'],
    'saumon-fume': [],
    tiramisu: ['cafeine:exclu:café', 'alcool:exclu:marsala'],
    'gratin-comte': [],
    'camembert-roti': ['lait_cru:exclu:camembert'],
    tartiflette: [],
    'salade-noix': ['fruit_coque:exclu:noix'],
    espadon: ['poisson_predateur:exclu:espadon'],
  });
  assert.deepEqual(bilanPrecautions(FIXTURES, ENFANT_30), { exclus: 7, attention: 0 });
});

test('fixtures enfant : 70 mois, les précautions plus légères et leur conseil', () => {
  const lu = Object.fromEntries(FIXTURES.map((p) => [p.id, resume(precautionsAge(p, ENFANT_70))]));
  assert.deepEqual(lu, {
    carpaccio: ['viande_crue:attention'],
    'burger-rose': ['viande_crue:attention'],
    huitres: [],
    'saumon-fume': [],
    tiramisu: ['cafeine:exclu', 'alcool:exclu'],
    'gratin-comte': [],
    'camembert-roti': ['lait_cru:attention'],
    tartiflette: [],
    'salade-noix': [],
    espadon: [],
  });
  assert.equal(precautionsAge(CAMEMBERT_ROTI, ENFANT_70)[0].consigne, 'Préférer pasteurisé, pâte pressée cuite ou bien cuit.');
  assert.deepEqual(bilanPrecautions(FIXTURES, ENFANT_70), { exclus: 1, attention: 3 });
});

test('cas mixte : versions jugées sur le seul régime, précautions sur le plat servi (version végétale au reblochon cru)', () => {
  const reblochonCru = {
    ...TARTIFLETTE,
    ingredients: [ing('reblochon', ['laitier', 'lait_cru']), ...TARTIFLETTE.ingredients.slice(1)],
    variantes: [{ pour: 'enfant', style: 'vegetal', retirer: ['lardons'], ajouter: [ajout('champignons', ['legume'], { role: 'incorpore' })], consigne: 'Part aux champignons.' }],
  };
  const avec = evaluer(reblochonCru, ENFANT_MIXTE);
  assert.deepEqual(avec, evaluer(reblochonCru, ENFANT_REGIME));
  assert.equal(avec.niveau, 'adaptable');
  assert.equal(avec.versions[0].convient, true);
  assert.deepEqual(precautionsAge(reblochonCru, ENFANT_MIXTE, { variante: avec.variante }), [
    { code: 'lait_cru', severite: 'exclu', court: 'lait cru', jusquAMois: 60, produits: ['reblochon'] },
  ]);
  // Les versions d'un autre profil ne comptent jamais pour l'enfant.
  const avecVersionB = { ...CAMEMBERT_ROTI, variantes: [{ pour: 'profil-b', retirer: ['camembert'], ajouter: [], consigne: 'x' }] };
  assert.equal(evaluer(avecVersionB, ENFANT_30).variante, null);
  assert.deepEqual(resume(precautionsAge(avecVersionB, ENFANT_30, { variante: evaluer(avecVersionB, ENFANT_30).variante })), ['lait_cru:exclu']);
});

// ——— Rien ne part vers Claude ———

const PROFILS_AVEC = [ADULTE_A, ADULTE_B, ENFANT_30];
const PROFILS_SANS = [ADULTE_A, ADULTE_B, ENFANT_SANS];
const PROFILS_MIXTES = [ADULTE_A, ADULTE_B, ENFANT_MIXTE];
const PROFILS_REGIME = [ADULTE_A, ADULTE_B, ENFANT_REGIME];
const NOTES = FIXTURES.map((p, i) => ({ ...p, notes: { enfant: i % 2 ? 5 : 0, 'profil-a': 3 } }));

/** Tous les textes copiés pour Claude, avec ces profils. */
function textesPourClaude(profils) {
  const enfantDesProfils = profils.find((p) => p.id === 'enfant');
  return [
    ...FIXTURES.map((p) => texteDemandeRecette(p, { profils })),
    texteDemandeRecette({ id: 'nouveau', nom: 'Nouveau plat' }, { profils }),
    texteDemandeIdees({ plats: NOTES, profils, envie: 'du poisson' }),
    texteDemandeIdees({ nombre: 5, plats: NOTES, profils }),
    texteDemandeVariantes(platsSansVersion(FIXTURES, ADULTE_B, { profils }), ADULTE_B),
    texteDemandeVariantes(FIXTURES, enfantDesProfils),
    texteDemandeVariantes(platsSansVersion(FIXTURES, enfantDesProfils, { profils }), enfantDesProfils),
  ];
}

test('rien ne part vers Claude : enfant qui n’a que des précautions d’âge → mêmes évaluations, aucun profil contraint', () => {
  for (const p of [...FIXTURES, ATTENTE]) {
    assert.deepEqual(evaluer(p, ENFANT_30), evaluer(p, ENFANT_SANS), p.id);
    assert.deepEqual(evaluer(p, ENFANT_MIXTE), evaluer(p, ENFANT_REGIME), p.id);
  }
  assert.deepEqual(profilsContraints(PROFILS_AVEC).map((p) => p.id), ['profil-b']);
  assert.deepEqual(profilsContraints(PROFILS_MIXTES).map((p) => p.id), ['profil-b', 'enfant']);
  assert.deepEqual(profilsAvecAge(PROFILS_AVEC).map((p) => p.id), ['enfant']);
});

test('rien ne part vers Claude : DEMANDE-RECETTE, DEMANDE-IDEES et DEMANDE-VARIANTES identiques avec ou sans règles d’âge', () => {
  assert.deepEqual(textesPourClaude(PROFILS_AVEC), textesPourClaude(PROFILS_SANS));
  assert.deepEqual(textesPourClaude(PROFILS_MIXTES), textesPourClaude(PROFILS_REGIME));
  // Profil mixte : sa ligne ne cite que son régime.
  const recette = texteDemandeRecette({ id: 'nouveau', nom: 'Nouveau plat' }, { profils: PROFILS_MIXTES });
  assert.ok(recette.includes(`\n- pour: enfant — ${decrireRegles(ENFANT_REGIME)} — styles: vegetal\n`));
  assert.doesNotMatch(recette, /Exclut les marqueurs/);
  assert.match(texteDemandeVariantes([CARPACCIO], ENFANT_MIXTE), new RegExp(`\\nrègles: ${decrireRegles(ENFANT_REGIME).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
});

test('rien ne part vers Claude : aucun texte ne parle d’âge, de règle d’âge, de naissance ni de date', () => {
  const textes = [...textesPourClaude(PROFILS_AVEC), ...textesPourClaude(PROFILS_MIXTES)];
  for (const texte of textes) {
    for (const interdit of ['age-', 'precautionAge', 'naissance', 'jusquAMois', ENFANT_30.naissance]) {
      assert.ok(!texte.includes(interdit), `« ${interdit} » dans :\n${texte}`);
    }
    assert.doesNotMatch(texte, /\d{4}-\d{2}-\d{2}/);
  }
});

test('rien ne part vers Claude : la correction d’une version ne cite que les marqueurs du régime', () => {
  const plats = [{
    ...TARTIFLETTE,
    ingredients: [...TARTIFLETTE.ingredients, ing('fond de veau au miel', ['bouillon_viande', 'miel'])],
  }];
  const recue = { id: 'tartiflette', nom: 'Tartiflette', variantes: [{
    pour: 'enfant', style: 'vegetal', retirer: ['lardons'], ajouter: [ajout('champignons', ['legume'], { role: 'incorpore' })], consigne: 'Part végétale.',
  }] };
  const corriger = (profils) => {
    const v = validerPaquet([{ format: 'paquet@1', plats: [recue] }], { profils });
    assert.equal(v.valide, true);
    const r = preparerImport(v.plats.map((p) => p.donnees), { plats, demandes: [], profils });
    return { corrections: r.corrections.map((c) => c.pourClaude), texte: texteCorrectionPourClaude(r) };
  };
  const avec = corriger(PROFILS_MIXTES);
  assert.deepEqual(avec, corriger(PROFILS_REGIME));
  assert.deepEqual(avec.corrections, [
    'id tartiflette variantes[pour=enfant, style=vegetal] : contient fond de veau au miel (bouillon_viande), exclu pour enfant',
  ]);
});

// ——— Écrans existants inchangés ———

test('écrans existants inchangés : platsSansVersion, bilanCompatibilite, filtresPour avec des règles d’âge', () => {
  const plats = [...FIXTURES, ATTENTE];
  for (const [avec, sans] of [[ENFANT_30, ENFANT_SANS], [ENFANT_MIXTE, ENFANT_REGIME]]) {
    assert.deepEqual(platsSansVersion(plats, avec, { profils: PROFILS_AVEC }), platsSansVersion(plats, sans, { profils: PROFILS_SANS }));
    assert.deepEqual(bilanCompatibilite(plats, avec, { profils: PROFILS_AVEC }), bilanCompatibilite(plats, sans, { profils: PROFILS_SANS }));
  }
  assert.deepEqual(platsSansVersion(plats, ADULTE_B, { profils: PROFILS_MIXTES }), platsSansVersion(plats, ADULTE_B, { profils: PROFILS_REGIME }));
  const filtres = (profils) => filtresPour(profilsContraints(profils), { moi: ADULTE_A, role: 'gestionnaire' })
    .map((f) => [f.id, f.libelle, (f.profils ?? []).map((p) => p.id)]);
  assert.deepEqual(filtres(PROFILS_AVEC), filtres(PROFILS_SANS));
  assert.deepEqual(filtres(PROFILS_MIXTES), filtres(PROFILS_REGIME));
  assert.ok(!filtres(PROFILS_AVEC).some(([id]) => id === 'pour-enfant'));
});

// ——— Bilan, profils, marqueurs surveillés ———

test('bilanPrecautions : plats donnés, ⏳ exclus, tous types ; fonction mémorisée de l’app acceptée', () => {
  const yaourt = plat('yaourt-miel', [ing('miel', ['miel'])], { type: 'preparation' });
  assert.deepEqual(bilanPrecautions([CARPACCIO, ATTENTE, yaourt, HUITRES, null], enfant(6)), { exclus: 3, attention: 0 });
  assert.deepEqual(bilanPrecautions([CARPACCIO, CAMEMBERT_ROTI, TIRAMISU, GRATIN_COMTE], ENFANT_70), { exclus: 1, attention: 2 });
  assert.deepEqual(bilanPrecautions([], ENFANT_70), { exclus: 0, attention: 0 });
  assert.deepEqual(bilanPrecautions(null, ENFANT_70), { exclus: 0, attention: 0 });
  const appels = [];
  const memo = (p, profil) => {
    appels.push(p.id);
    return precautionsAge(p, profil);
  };
  assert.deepEqual(bilanPrecautions([CARPACCIO, ATTENTE], ENFANT_70, { precautions: memo }), { exclus: 0, attention: 1 });
  assert.deepEqual(appels, ['carpaccio']);
});

test('profilsAvecAge : au moins une précaution active, ordre d’affichage', () => {
  const second = { ...ENFANT_30, id: 'enfant-2', nom: 'Bébé', ordre: 0 };
  const eteint = { ...ENFANT_SANS, id: 'enfant-3', regles: basculerPrecaution(reglesAge(30), 'alcool', false).map((r) => ({ ...r, actif: false })) };
  assert.deepEqual(profilsAvecAge([ADULTE_A, ENFANT_30, ADULTE_B, second, eteint, null]).map((p) => p.id), ['enfant-2', 'enfant']);
  assert.deepEqual(profilsAvecAge([ADULTE_A, ADULTE_B, ENFANT_REGIME]), []);
  assert.deepEqual(profilsAvecAge(undefined), []);
});

test('marqueursSurveilles : règles actives `exclureMarqueurs` et `precautionAge`, sans `saufMarqueurs` ni `etMarqueurs`', () => {
  const surveilles = marqueursSurveilles([ADULTE_A, ADULTE_B, ENFANT_30, null]);
  assert.ok(surveilles instanceof Set);
  // 30 mois : plus de règle du miel (passée à 12 mois, jamais ajoutée).
  const attendus = new Set([...SANS_VIANDE[0].marqueurs, 'lait_cru', 'cru', 'fruit_coque', 'poisson_predateur', 'soja',
    'cafeine', 'alcool_cru']);
  assert.deepEqual([...surveilles].sort(), [...attendus].sort());
  assert.ok(!surveilles.has('oeuf_cru'), 'œufs crus éteints');
  assert.ok(!surveilles.has('charcuterie'), 'etMarqueurs et saufMarqueurs ne sont pas surveillés');
  const avecSauf = { regles: [{ type: 'exclureMarqueurs', marqueurs: ['viande'], saufMarqueurs: ['charcuterie'], severite: 'exclu' },
    { type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }, regleDuPalier(BAREME_AGE[2], 0)] };
  assert.deepEqual([...marqueursSurveilles([avecSauf])].sort(), ['cru', 'viande']);
  assert.deepEqual(marqueursSurveilles(null).size, 0);
});

// ——— Règles d'âge venues d'un fichier ———

test('validerRegles (precautionAge) : règle propre gardée ; listes vides retirées ; sévérité et conseil normalisés', () => {
  const brute = {
    id: 'age-viande_crue', type: 'precautionAge', marqueurs: ['Cru', 'cru'], etMarqueurs: ['viande'], saufMarqueurs: [],
    severite: 'Adaptable', consigne: '  Cuire  à cœur. ', age: { code: 'viande_crue', palier: 1, jusquAMois: 180, garde: null }, actif: true,
  };
  const { regles, avertissements } = validerRegles([brute]);
  assert.deepEqual(avertissements, []);
  assert.deepEqual(regles, [{
    id: 'age-viande_crue', type: 'precautionAge', marqueurs: ['cru'], etMarqueurs: ['viande'], severite: 'adaptable',
    consigne: 'Cuire à cœur.', age: { code: 'viande_crue', palier: 1, jusquAMois: 180 }, actif: true,
  }]);
  const sansEt = validerRegles([{ ...regleDuPalier(BAREME_AGE[1], 0), etMarqueurs: [], consigne: '' }]).regles[0];
  assert.deepEqual(sansEt, regleDuPalier(BAREME_AGE[1], 0));
  const garde = { ...regleDuPalier(BAREME_AGE[1], 0), age: { code: 'lait_cru', palier: 0, jusquAMois: 60, garde: true } };
  assert.deepEqual(validerRegles([garde]).regles, [garde]);
  // Code absent du barème (version future) : gardé.
  const futur = { type: 'precautionAge', marqueurs: ['cru'], severite: 'exclu', age: { code: 'nouveau_code', palier: 3, jusquAMois: 216 } };
  assert.deepEqual(validerRegles([futur]), { regles: [futur], avertissements: [] });
});

test('validerRegles (precautionAge) : marqueur inconnu → gardée telle quelle ; structure fausse → retirée', () => {
  const inconnue = { ...regleDuPalier(BAREME_AGE[0], 0), marqueurs: ['miel', 'gluten'] };
  assert.deepEqual(validerRegles([inconnue]), {
    regles: [inconnue], avertissements: ['Une règle n’est pas comprise par cette version de l’app.'],
  });
  const etInconnu = { ...regleDuPalier(BAREME_AGE[2], 0), etMarqueurs: ['gibier'] };
  assert.deepEqual(validerRegles([etInconnu]).regles, [etInconnu]);
  const base = regleDuPalier(BAREME_AGE[0], 0);
  const abimees = [
    { ...base, marqueurs: [] },
    { ...base, marqueurs: 'miel' },
    { ...base, marqueurs: ['miel', 3] },
    { ...base, etMarqueurs: 'viande' },
    { ...base, severite: 'preference' },
    { ...base, severite: 'grave' },
    { ...base, consigne: 12 },
    { ...base, age: undefined },
    { ...base, age: 'miel' },
    { ...base, age: { code: 'Miel!', palier: 0, jusquAMois: 12 } },
    { ...base, age: { palier: 0, jusquAMois: 12 } },
    { ...base, age: { code: 'miel', palier: -1, jusquAMois: 12 } },
    { ...base, age: { code: 'miel', palier: 0.5, jusquAMois: 12 } },
    { ...base, age: { code: 'miel', palier: 0, jusquAMois: 0 } },
    { ...base, age: { code: 'miel', palier: 0, jusquAMois: 217 } },
    { ...base, age: { code: 'miel', palier: 0, jusquAMois: '12' } },
    { ...base, age: { code: 'miel', palier: 0, jusquAMois: 12, garde: 'oui' } },
    { ...base, actif: 'oui' },
    // Structure fausse ET marqueur inconnu : abîmée.
    { ...base, marqueurs: ['gluten'], age: { code: 'miel', palier: 0 } },
  ];
  const r = validerRegles([...abimees, base], { nom: 'Enfant' });
  assert.deepEqual(r.regles, [base]);
  assert.deepEqual(r.avertissements, [`${abimees.length} règles abîmées d’Enfant ont été ignorées.`]);
});

test('lireRegime ∘ ecrireRegime avec des règles d’âge : aller-retour exact, règles d’âge dans `autres`', () => {
  const regles = [regleDuPalier(BAREME_AGE[0], 0), ...NI_POISSON, ...reglesAge(70), { ...regleDuPalier(BAREME_AGE[5], 0), actif: false }];
  const lu = lireRegime(regles);
  assert.equal(lu.regime, 'sans_viande_ni_poisson');
  assert.equal(lu.position, 1);
  assert.equal(lu.autres.length, regles.length - 1);
  assert.ok(lu.autres.every(estRegleAge));
  assert.deepEqual(ecrireRegime(lu, lu.autres), regles);
  // « Mange de tout » : seules les règles d'âge restent.
  assert.deepEqual(ecrireRegime({ regime: 'tout' }, lu.autres), lu.autres);
  assert.equal(decrireRegles({ regles }), decrireRegles({ regles: NI_POISSON }));
  assert.equal(decrireRegles({ regles: reglesAge(30) }), '');
});

// ——— Validation des ingrédients ———

test('validerIngredient : nouveaux marqueurs acceptés, aucune erreur nouvelle ; avertissements cru et espadon', () => {
  const p = plat('repas-test', [
    viande('carpaccio de bœuf', ['viande', 'boeuf', 'cru'], { forme: 'fine' }),
    ing('carotte râpée', ['legume', 'cru'], { role: 'principal' }),
    ing('espadon', ['poisson_predateur']),
    viande('jambon cru', ['viande', 'porc', 'charcuterie', 'cru'], { forme: 'fine' }),
    ing('huîtres', ['Fruits de mer', 'Cru']),
    ing('camembert', ['laitier', 'Lait cru']),
    ing('noix', ['fruit_coque']),
    ing('café', ['cafe']),
    ing('thé', ['cafeine']),
    ing('miel', ['miel']),
    ing('tofu', ['soja']),
    ing('requin', ['poisson', 'poisson_predateur']),
  ], { nom: 'Repas test' });
  const v = validerPaquet({ format: 'paquet@1', plats: [p] });
  assert.equal(v.valide, true, JSON.stringify(v.plats[0].erreurs));
  assert.deepEqual(v.plats[0].erreurs, []);
  assert.deepEqual(v.plats[0].donnees.ingredients.map((i) => i.marqueurs), [
    ['viande', 'boeuf', 'cru'], ['legume', 'cru'], ['poisson_predateur'], ['viande', 'porc', 'charcuterie', 'cru'],
    ['fruits_de_mer', 'cru'], ['laitier', 'lait_cru'], ['fruit_coque'], ['cafe'], ['cafeine'], ['miel'], ['soja'],
    ['poisson', 'poisson_predateur'],
  ]);
  assert.deepEqual(v.plats[0].avertissements, [
    {
      message: '«\u00A0Repas test\u00A0», ingrédient 2\u00A0: «\u00A0carotte râpée\u00A0» est marqué cru sans être une viande ni un poisson\u00A0: le repère est sans effet.',
      pourClaude: 'plats[0] (repas-test) ingredients[1] « carotte râpée » : `cru` sans `viande`, `poisson` ni `fruits_de_mer` : repère sans effet',
    },
    {
      message: '«\u00A0Repas test\u00A0», ingrédient 3\u00A0: «\u00A0espadon\u00A0» est un poisson\u00A0: ajoutez aussi le repère poisson.',
      pourClaude: 'plats[0] (repas-test) ingredients[2] « espadon » : `poisson_predateur` sans `poisson` : ajoute aussi `poisson`',
    },
  ]);
});

test('validerIngredient : avertissements aussi pour les ajouts d’une version ; espadon seul → version mer', () => {
  const espadon = ajout('espadon', ['poisson_predateur'], { rayon: 'poissonnerie' });
  assert.equal(styleDe({ ajouter: [espadon] }), 'mer');
  assert.ok(vocabulaire.marqueursEffectifs(espadon).has('poisson'));
  assert.equal(compatibilite.marqueursEffectifs, vocabulaire.marqueursEffectifs);
  const p = { ...TARTIFLETTE, variantes: [{ pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['lardons'], ajouter: [espadon], consigne: 'Part à l’espadon.' }] };
  const v = validerPaquet({ format: 'paquet@1', plats: [p] }, { profils: PROFILS_AVEC });
  assert.equal(v.valide, true, JSON.stringify(v.plats[0].erreurs));
  assert.deepEqual(v.plats[0].avertissements.map((a) => a.pourClaude),
    ['plats[0] (tartiflette) variantes[0].ajouter[0] « espadon » : `poisson_predateur` sans `poisson` : ajoute aussi `poisson`']);
  // Un adulte « Ni viande ni poisson » ne mange pas d'espadon, même sans le repère poisson.
  const espadonSeul = plat('x', [ing('espadon', ['poisson_predateur'])]);
  assert.equal(evaluer(espadonSeul, { id: 'profil-a', regles: NI_POISSON }).niveau, 'exclu');
  // Sans canal `prevenir` : aucun avertissement, aucune erreur.
  const erreurs = [];
  const propre = vocabulaire.validerIngredient(ing('carotte', ['legume', 'cru'], { role: 'principal' }), {
    position: { affiche: 'Ingrédient 1', claude: 'ingredients[0]' }, champQte: 'qte',
    signaler: (message) => erreurs.push(message), inconnu: () => {},
  });
  assert.deepEqual(propre.marqueurs, ['legume', 'cru']);
  assert.deepEqual(erreurs, []);
});

// ——— Catalogue des produits ———

test('catalogue : repères de préparation jamais hérités ; l’ingrédient modifié garde les siens ; lait_cru reste', () => {
  assert.deepEqual(MARQUEURS_PREPARATION, ['cru', 'oeuf_cru', 'alcool_cru']);
  const plats = [
    plat('carpaccio', [viande('filet de bœuf', ['viande', 'boeuf', 'cru'], { forme: 'fine' }), ing('jaune d’œuf', ['oeuf', 'oeuf_cru']),
      ing('rhum', ['alcool_cru'])]),
    plat('carpaccio-2', [viande('filet de bœuf', ['viande', 'boeuf', 'cru'], { forme: 'fine' }), ing('camembert', ['laitier', 'lait_cru'])]),
    plat('roti', [viande('filet de bœuf', ['viande', 'boeuf'], { forme: 'fine' })]),
  ];
  const catalogue = catalogueProduits(plats);
  const lu = Object.fromEntries(catalogue.map((e) => [e.produit, e.marqueurs]));
  assert.deepEqual(lu, {
    camembert: ['laitier', 'lait_cru'], 'filet de bœuf': ['viande', 'boeuf'], 'jaune d’œuf': ['oeuf'], rhum: [],
  });
  const saisir = (produit, options = {}) => ingredientSaisi({ produit, qte: '1', unite: 'pc', ...options.champs },
    { catalogue, ingredients: options.ingredients ?? [], index: options.index ?? null });
  assert.deepEqual(saisir('Filet de bœuf').ingredient.marqueurs, ['viande', 'boeuf']);
  assert.deepEqual(saisir('jaune d’œuf').ingredient.marqueurs, ['oeuf']);
  assert.deepEqual(saisir('camembert').ingredient.marqueurs, ['laitier', 'lait_cru']);
  // L'ingrédient modifié (même produit) garde ses repères.
  const existant = viande('filet de bœuf', ['viande', 'boeuf', 'cru'], { forme: 'fine', qte: 300, unite: 'g' });
  assert.deepEqual(saisir('filet de bœuf', { ingredients: [existant], index: 0 }).ingredient.marqueurs, ['viande', 'boeuf', 'cru']);
  // Un catalogue fait à la main n'apporte pas non plus de repère de préparation.
  const aLaMain = [{ produit: 'saumon', unite: 'g', rayon: 'poissonnerie', marqueurs: ['poisson', 'cru'], nature: 'poisson' }];
  assert.deepEqual(ingredientSaisi({ produit: 'saumon', qte: '1', unite: 'g' }, { catalogue: aLaMain }).ingredient.marqueurs, ['poisson']);
});

// ——— Sauvegarde et restauration ———

/** Fichier créé puis relu, comme à la restauration. */
function relire(profils, plats = []) {
  const { texte } = creerSauvegarde({ plats, profils }, { maintenant: new Date('2026-10-09T10:00:00Z') });
  const lu = lireSauvegarde(texte);
  assert.ok(lu.sauvegarde, JSON.stringify(lu));
  return validerSauvegarde(lu.sauvegarde);
}

test('sauvegarde : aller-retour de la date de naissance et des règles d’âge (et du régime d’un cas mixte)', () => {
  const v = relire([ENFANT_30, { ...ENFANT_MIXTE, id: 'enfant-2', nom: 'Enfant deux', ordre: 4 }, ADULTE_B]);
  assert.deepEqual(v.avertissements, []);
  const parId = new Map(v.profils.map((p) => [p.id, p]));
  assert.deepEqual(parId.get('enfant'), ENFANT_30);
  assert.equal(parId.get('enfant-2').naissance, ENFANT_MIXTE.naissance);
  assert.deepEqual(parId.get('enfant-2').regles, ENFANT_MIXTE.regles);
  assert.equal(Object.hasOwn(parId.get('profil-b'), 'naissance'), false);
  assert.equal(contientUndefined(v.profils), false);
});

test('sauvegarde : date illisible ignorée avec un avertissement ; date ancienne mais lisible gardée', () => {
  const v = validerSauvegarde({
    format: 'paquet@1', sauvegardeLe: '2026-10-09T10:00:00.000Z', plats: [],
    profils: [
      { ...ENFANT_SANS, naissance: '2025-02-30' },
      { ...ENFANT_SANS, id: 'enfant-2', nom: 'Enfant deux', naissance: '1990-05-17' },
      { ...ENFANT_SANS, id: 'enfant-3', nom: 'Enfant trois', naissance: 20240101 },
    ],
  });
  assert.deepEqual(v.avertissements, ['Une date de naissance illisible a été ignorée.', 'Une date de naissance illisible a été ignorée.']);
  assert.equal(Object.hasOwn(v.profils[0], 'naissance'), false);
  assert.equal(v.profils[1].naissance, '1990-05-17');
  assert.equal(Object.hasOwn(v.profils[2], 'naissance'), false);
  assert.ok(!v.avertissements.some((a) => /non reconnues/.test(a)));
});

test('restauration : la date revient par une écriture séparée (naissanceAbsente), jamais annulée avec les règles', () => {
  const v = relire([ENFANT_30]);
  // Présent dans l'app sans date ni règles : règles et date reviennent, chacune par son écriture.
  const r = preparerRestauration(v, { plats: [], profils: [{ ...ENFANT_SANS, regles: undefined }] });
  const ecritures = r.lots.flat();
  assert.deepEqual(ecritures, [
    { collection: 'profils', id: 'enfant', mode: 'update', donnees: { regles: ENFANT_30.regles }, condition: { reglesAbsentes: true } },
    { collection: 'profils', id: 'enfant', mode: 'update', donnees: { naissance: ENFANT_30.naissance }, condition: { naissanceAbsente: true } },
  ]);
  assert.deepEqual(r.resume.reglesRemises, ['Enfant']);
  assert.deepEqual(r.resume.naissancesRemises, ['Enfant']);
  assert.deepEqual(r.resume.precautionsARemettre, ['Enfant']);
  const [regles, naissance] = ecritures;
  // Les règles ont été réglées entre-temps sur l'autre téléphone : seule la date part.
  assert.equal(appliquerConditions(regles, { ...ENFANT_SANS }), null);
  assert.deepEqual(appliquerConditions(naissance, { ...ENFANT_SANS }), naissance);
  // Une date posée entre-temps n'est jamais remplacée ; profil supprimé : rien.
  assert.equal(appliquerConditions(naissance, { ...ENFANT_SANS, naissance: '2024-01-01' }), null);
  assert.equal(appliquerConditions(naissance, null), null);
  assert.equal(contientUndefined(r.lots), false);
});

test('restauration : profil présent avec ses règles → rien d’écrit, précautions à remettre signalées ; profil absent → revient avec sa date', () => {
  const v = relire([ENFANT_30]);
  // A déjà ses règles (sans règle d'âge) et sa date : rien n'est écrit, l'écran invitera à remettre ses précautions.
  const r = preparerRestauration(v, { plats: [], profils: [{ ...ENFANT_SANS, naissance: neIlYA(31) }] });
  assert.equal(r.rien, true);
  assert.deepEqual(r.resume.naissancesRemises, []);
  assert.deepEqual(r.resume.precautionsARemettre, ['Enfant']);
  // A toutes ses précautions et sa date : rien à signaler.
  const complet = preparerRestauration(v, { plats: [], profils: [{ ...ENFANT_30 }] });
  assert.equal(complet.rien, true);
  assert.deepEqual(complet.resume.precautionsARemettre, []);
  // A ses précautions, pas sa date : la date revient, l'écran est signalé.
  const sansDate = preparerRestauration(v, { plats: [], profils: [{ ...ENFANT_30, naissance: undefined }] });
  assert.deepEqual(sansDate.lots.flat().map((e) => e.condition), [{ naissanceAbsente: true }]);
  assert.deepEqual(sansDate.resume.precautionsARemettre, ['Enfant']);
  // Absent de l'app : il revient entier, date et règles comprises.
  const absent = preparerRestauration(v, { plats: [], profils: [] });
  const [ecriture] = absent.lots.flat();
  assert.deepEqual(ecriture.condition, { absent: true });
  assert.equal(ecriture.donnees.naissance, ENFANT_30.naissance);
  assert.deepEqual(ecriture.donnees.regles, ENFANT_30.regles);
  assert.deepEqual(absent.resume.profilsRemis, ['Enfant']);
  assert.deepEqual(absent.resume.naissancesRemises, []);
  assert.deepEqual(absent.resume.precautionsARemettre, []);
});

// ——— Modules ———

test('age.js n’importe que slug.js, vocabulaire.js et profils.js', async () => {
  const source = await readFile(new URL('../js/coeur/age.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/(?:import|export)\s[^;]*?from\s+'\.\/([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['profils.js', 'slug.js', 'vocabulaire.js']);
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|gstatic|firebase\.js|localStorage/);
});

test('aucune espace insécable écrite telle quelle dans les fichiers de T2c-1 (cœur)', async () => {
  for (const fichier of ['../js/coeur/age.js', '../js/coeur/vocabulaire.js', '../js/coeur/regles.js', '../js/coeur/edition.js',
    '../js/coeur/sauvegarde.js', '../js/coeur/compatibilite.js', '../js/coeur/paquet.js', './coeur-t2c.test.js']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});
