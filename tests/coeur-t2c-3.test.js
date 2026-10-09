// T2c-3 « 🧸🎂 Il a grandi » : précautions dont l'âge est passé (coeur/age.js › propositionsAge, appliquerChoixAge,
// carteAnniversaire), ordre du brouillon de l'écran de l'enfant, aller-retour de `age.garde` par la sauvegarde ; et
// parmesan, grana padano en pâtes pressées cuites (instructions en version 6, aide du barème). Fixtures génériques
// (aucune donnée du foyer) ; dates calculées depuis une date de référence fixe, jamais l'âge réel d'un enfant.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BAREME_AGE, ageEnMois, regleDuPalier, reglesSelonAge, basculerPrecaution, lireAge, propositionsAge, appliquerChoixAge,
  rejouerChoixAge, carteAnniversaire, precautionsAge,
} from '../js/coeur/age.js';
import { ecrireRegime, validerRegles } from '../js/coeur/regles.js';
import { VERSION_INSTRUCTIONS } from '../js/coeur/claude.js';
import {
  creerSauvegarde, lireSauvegarde, validerSauvegarde, preparerRestauration,
} from '../js/coeur/sauvegarde.js';

// ——— Fixtures ———

/** Date de référence fixe des tests (date du téléphone, « AAAA-MM-JJ »). */
const REF = '2026-10-09';
/** Veille de REF. */
const VEILLE = '2026-10-08';
const deux = (n) => String(n).padStart(2, '0');
/** Date de naissance d'un enfant qui a `mois` mois révolus à REF (calculée, jamais une vraie date). */
function neIlYA(mois) {
  const [a, m, j] = REF.split('-').map(Number);
  const total = a * 12 + (m - 1) - mois;
  return `${Math.floor(total / 12)}-${deux((total % 12) + 1)}-${deux(j)}`;
}

const ing = (produit, marqueurs = [], extra = {}) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs, ...extra });
const plat = (id, ingredients, extra = {}) => ({
  id, nom: extra.nom ?? `Plat ${id}`, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, ...extra,
});
const CAMEMBERT = plat('camembert-roti', [ing('camembert', ['laitier', 'lait_cru']), ing('pain', ['feculent'])]);

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
/** Règles enregistrées quand l'enfant avait `mois` mois (ce que l'écran a écrit à l'époque). */
const reglesA = (mois) => reglesSelonAge(neIlYA(mois), REF, []).regles;
const entree = (code) => BAREME_AGE.find((e) => e.code === code);
const regleDe = (regles, code) => regles.find((r) => r.age?.code === code);
/** Enfant né il y a `mois` mois, dont les précautions ont été enregistrées à `enregistreA` mois. */
const enfant = (mois, enregistreA, extra = {}) => ({
  id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, naissance: neIlYA(mois), regles: reglesA(enregistreA), ...extra,
});
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };

const ASSOUPLIR = 'Passer à «\u00A0déconseillé\u00A0»';
const RETIRER = 'Retirer la précaution';
const actions = (propositions) => propositions.map((p) => `${p.code}:${p.action}`);

/** Vrai si la valeur contient undefined, à quelque profondeur que ce soit. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientUndefined);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientUndefined);
  return false;
}

/**
 * Brouillon de l'écran, dans l'ordre fixe : enregistrées → reglesSelonAge → choix de T2c-3 → interrupteurs. Les choix
 * sont faits à l'âge `faitA` (mois ; par défaut, l'âge de `naissance`), comme l'écran les retient.
 */
function brouillon(naissance, enregistrees, choix = [], bascules = [], faitA = ageEnMois(naissance, REF)) {
  const mois = ageEnMois(naissance, REF);
  let regles = reglesSelonAge(naissance, REF, enregistrees).regles;
  regles = rejouerChoixAge(regles, choix.map(([code, c]) => ({ code, choix: c, mois: faitA })), mois);
  for (const [code, actif] of bascules) regles = basculerPrecaution(regles, code, actif);
  return regles;
}

// ——— propositionsAge ———

test('propositionsAge : veille et jour de la borne (1 an, 3 ans, 5 ans), dans l’ordre du barème', () => {
  // Miel (1 an) : enregistré à 6 mois.
  const bebe = { ...enfant(12, 6) };
  assert.deepEqual(propositionsAge(bebe, VEILLE), []);
  assert.deepEqual(propositionsAge(bebe, REF), [{ code: 'miel', regleId: 'age-miel', action: 'retirer', texte: RETIRER }]);
  // 3 ans : enregistré à 30 mois.
  const trois = enfant(36, 30);
  assert.deepEqual(propositionsAge(trois, VEILLE), []);
  assert.deepEqual(actions(propositionsAge(trois, REF)), ['viande_crue:assouplir', 'charcuterie_crue:retirer',
    'poisson_cru:retirer', 'oeuf_cru:retirer', 'poisson_predateur:retirer', 'soja:retirer']);
  // 5 ans : lait cru et fruits à coque s'y ajoutent.
  const cinq = enfant(60, 30);
  assert.equal(ageEnMois(cinq.naissance, VEILLE), 59);
  assert.deepEqual(actions(propositionsAge(cinq, VEILLE)), actions(propositionsAge(trois, REF)));
  const jour = propositionsAge(cinq, REF);
  assert.deepEqual(actions(jour), ['lait_cru:assouplir', 'viande_crue:assouplir', 'charcuterie_crue:retirer',
    'poisson_cru:retirer', 'oeuf_cru:retirer', 'fruit_coque:retirer', 'poisson_predateur:retirer', 'soja:retirer']);
  assert.deepEqual(jour[0], { code: 'lait_cru', regleId: 'age-lait_cru', action: 'assouplir', texte: ASSOUPLIR });
  assert.equal(jour[2].texte, RETIRER);
  // Café, thé, alcool : jusqu'à 18 ans.
  assert.deepEqual(actions(propositionsAge(enfant(216, 200), VEILLE)), []);
  assert.deepEqual(actions(propositionsAge(enfant(216, 200), REF)), ['cafeine:retirer', 'alcool:retirer']);
});

test('propositionsAge : désactivée ou gardée → rien ; sans date → rien ; doublons → une entrée ; règle sans id', () => {
  const base = enfant(70, 30);
  const eteinte = { ...base, regles: basculerPrecaution(base.regles, 'lait_cru', false) };
  assert.ok(!actions(propositionsAge(eteinte, REF)).includes('lait_cru:assouplir'));
  const gardee = { ...base, regles: appliquerChoixAge(base.regles, 'lait_cru', 'garder', 70) };
  assert.equal(regleDe(gardee.regles, 'lait_cru').age.garde, true);
  assert.ok(!propositionsAge(gardee, REF).some((p) => p.code === 'lait_cru'));
  assert.equal(propositionsAge(gardee, REF).length, propositionsAge(base, REF).length - 1);
  // Sans date, date illisible ou future : rien n'est « passé ».
  for (const naissance of [undefined, '', '2025-02-30', '2027-01-01']) {
    assert.deepEqual(propositionsAge({ ...base, naissance }, REF), [], String(naissance));
  }
  assert.deepEqual(propositionsAge(null, REF), []);
  assert.deepEqual(propositionsAge({ naissance: neIlYA(70), regles: SANS_VIANDE }, REF), []);
  // Doublons du même code : une seule entrée (celle qui agit, puis la plus stricte, comme lireAge).
  const doublons = { ...base, regles: [...base.regles, regleDuPalier(entree('lait_cru'), 1)] };
  assert.equal(propositionsAge(doublons, REF).filter((p) => p.code === 'lait_cru').length, 1);
  assert.equal(propositionsAge(doublons, REF)[0].action, 'assouplir');
  // Règle lue dans un fichier, sans id : identifiant déduit du code.
  const sansId = { ...base, regles: base.regles.map(({ id, ...r }) => r) };
  assert.deepEqual(propositionsAge(sansId, REF), propositionsAge(base, REF));
  const autreId = { ...base, regles: base.regles.map((r) => (r.age.code === 'soja' ? { ...r, id: 'age-soja-fichier' } : r)) };
  assert.equal(propositionsAge(autreId, REF).find((p) => p.code === 'soja').regleId, 'age-soja-fichier');
});

test('propositionsAge : assouplir si un palier suivant est en vigueur, sinon retirer (palier passé sauté)', () => {
  const lait = (mois, palier) => ({ naissance: neIlYA(mois), regles: [regleDuPalier(entree('lait_cru'), palier)] });
  assert.deepEqual(actions(propositionsAge(lait(70, 0), REF)), ['lait_cru:assouplir']);
  assert.deepEqual(actions(propositionsAge(lait(179, 0), REF)), ['lait_cru:assouplir']);
  // Le palier « ! » est passé lui aussi : il est sauté, la précaution se retire.
  assert.deepEqual(actions(propositionsAge(lait(180, 0), REF)), ['lait_cru:retirer']);
  assert.deepEqual(actions(propositionsAge(lait(179, 1), REF)), []);
  assert.deepEqual(actions(propositionsAge(lait(180, 1), REF)), ['lait_cru:retirer']);
  // Soja : un seul palier, « ! » jusqu'à 3 ans.
  assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(36), regles: [regleDuPalier(entree('soja'), 0)] }, REF)),
    ['soja:retirer']);
});

test('propositionsAge : code inconnu → retirer à sa borne ; palier inconnu → retirer quand le barème n’a plus rien en vigueur ; borne copiée plus basse que le barème → rien', () => {
  const futur = { id: 'age-futur', type: 'precautionAge', marqueurs: ['cru'], severite: 'exclu', age: { code: 'futur', palier: 0, jusquAMois: 48 }, actif: true };
  assert.deepEqual(propositionsAge({ naissance: neIlYA(47), regles: [futur] }, REF), []);
  assert.deepEqual(propositionsAge({ naissance: neIlYA(48), regles: [futur] }, REF),
    [{ code: 'futur', regleId: 'age-futur', action: 'retirer', texte: RETIRER }]);
  // Palier d'une autre version de l'app (borne 90) : à 90 mois, le barème de l'app demande encore « déconseillé »
  // jusqu'à 15 ans. Retirée, la précaution reviendrait aussitôt par reglesSelonAge : rien n'est proposé avant 15 ans.
  const palierFutur = { ...regleDuPalier(entree('lait_cru'), 0), age: { code: 'lait_cru', palier: 4, jusquAMois: 90 } };
  assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(89), regles: [palierFutur] }, REF)), []);
  assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(90), regles: [palierFutur] }, REF)), []);
  assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(179), regles: [palierFutur] }, REF)), []);
  assert.equal(lireAge({ naissance: neIlYA(90), regles: [palierFutur] }, REF)[0].etat, 'passee');
  assert.deepEqual(reglesSelonAge(neIlYA(90), REF, [palierFutur]).regles.filter((r) => r.age.code === 'lait_cru'), [palierFutur]);
  assert.ok(reglesSelonAge(neIlYA(90), REF, []).ajoutees.includes('lait_cru'));
  assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(180), regles: [palierFutur] }, REF)), ['lait_cru:retirer']);
  // Borne copiée d'un ancien barème (4 ans) alors que celui-ci demande encore ce palier jusqu'à 5 ans : rien n'est
  // proposé (moins prudent que le barème de l'app), même si la ligne de l'écran dit l'âge passé.
  const ancienne = { ...regleDuPalier(entree('lait_cru'), 0), age: { code: 'lait_cru', palier: 0, jusquAMois: 48 } };
  assert.deepEqual(propositionsAge({ naissance: neIlYA(50), regles: [ancienne] }, REF), []);
  assert.equal(lireAge({ naissance: neIlYA(50), regles: [ancienne] }, REF)[0].etat, 'passee');
  assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(60), regles: [ancienne] }, REF)), ['lait_cru:assouplir']);
});

test('propositionsAge et lireAge concordent sur le barème : à chaque âge, « passée » = à revoir', () => {
  const enregistrees = reglesA(0);
  for (let mois = 0; mois <= 220; mois += 1) {
    const profil = { naissance: neIlYA(mois), regles: enregistrees };
    const passees = lireAge(profil, REF).filter((e) => e.etat === 'passee').map((e) => e.regle.age.code);
    assert.deepEqual(propositionsAge(profil, REF).map((p) => p.code), passees, `${mois} mois`);
  }
});

// ——— appliquerChoixAge ———

test('appliquerChoixAge assouplir : palier « ! » et son conseil, à sa place ; actif gardé, garde retiré', () => {
  const regles = [...SANS_VIANDE, ...reglesA(30)];
  const index = regles.findIndex((r) => r.age?.code === 'lait_cru');
  const sortie = appliquerChoixAge(regles, 'lait_cru', 'assouplir', 70);
  assert.equal(sortie.length, regles.length);
  assert.deepEqual(sortie[index], regleDuPalier(entree('lait_cru'), 1));
  assert.deepEqual(sortie[index], {
    id: 'age-lait_cru', type: 'precautionAge', marqueurs: ['lait_cru'], severite: 'adaptable',
    consigne: 'Préférer pasteurisé, pâte pressée cuite ou bien cuit.', age: { code: 'lait_cru', palier: 1, jusquAMois: 180 }, actif: true,
  });
  sortie.forEach((regle, i) => { if (i !== index) assert.deepEqual(regle, regles[i]); });
  // Une précaution éteinte reste éteinte ; une précaution gardée (puis revue) perd sa marque.
  const eteinte = appliquerChoixAge(basculerPrecaution(regles, 'viande_crue', false), 'viande_crue', 'assouplir', 70);
  assert.deepEqual(regleDe(eteinte, 'viande_crue'), regleDuPalier(entree('viande_crue'), 1, { actif: false }));
  const gardee = appliquerChoixAge(regles, 'viande_crue', 'garder', 70);
  assert.equal(Object.hasOwn(regleDe(appliquerChoixAge(gardee, 'viande_crue', 'assouplir', 70), 'viande_crue').age, 'garde'), false);
  // Âge pas encore atteint, ou palier « ! » passé lui aussi (seul « retirer » est possible) : rien ne change.
  assert.deepEqual(appliquerChoixAge(regles, 'lait_cru', 'assouplir', 59), regles);
  assert.deepEqual(appliquerChoixAge(regles, 'lait_cru', 'assouplir', 180), regles);
  // Jamais un durcissement : une règle déjà au palier « ! » ne bouge pas.
  const deja = appliquerChoixAge(regles, 'lait_cru', 'assouplir', 70);
  assert.deepEqual(appliquerChoixAge(deja, 'lait_cru', 'assouplir', 70), deja);
});

test('appliquerChoixAge assouplir : les paliers passés sont sautés (barème d’essai à trois paliers)', () => {
  const essai = {
    code: 'essai_paliers', libelle: 'Essai', court: 'essai', marqueurs: ['miel'],
    paliers: [
      { severite: 'exclu', jusquAMois: 12 },
      { severite: 'adaptable', jusquAMois: 24, consigne: 'Un peu.' },
      { severite: 'adaptable', jusquAMois: 48, consigne: 'Encore moins.' },
    ],
  };
  BAREME_AGE.push(essai);
  try {
    const regles = [regleDuPalier(essai, 0)];
    assert.deepEqual(appliquerChoixAge(regles, 'essai_paliers', 'assouplir', 18), [regleDuPalier(essai, 1)]);
    assert.deepEqual(appliquerChoixAge(regles, 'essai_paliers', 'assouplir', 30), [regleDuPalier(essai, 2)]);
    assert.deepEqual(actions(propositionsAge({ naissance: neIlYA(30), regles }, REF)), ['essai_paliers:assouplir']);
    assert.deepEqual(appliquerChoixAge(regles, 'essai_paliers', 'assouplir', 48), regles);
    assert.deepEqual(appliquerChoixAge(regles, 'essai_paliers', 'retirer', 48), []);
    // Vers un palier « Pas avant… » moins strict, le bouton le dit.
    essai.paliers[1] = { severite: 'exclu', jusquAMois: 24 };
    assert.equal(propositionsAge({ naissance: neIlYA(18), regles }, REF)[0].texte, 'Passer à «\u00A0pas avant 2 ans\u00A0»');
  } finally {
    BAREME_AGE.splice(BAREME_AGE.indexOf(essai), 1);
  }
  assert.ok(!BAREME_AGE.some((e) => e.code === 'essai_paliers'));
});

test('appliquerChoixAge retirer : seulement quand aucun palier n’est plus en vigueur', () => {
  const regles = [...SANS_VIANDE, ...reglesA(30)];
  const sansSoja = appliquerChoixAge(regles, 'soja', 'retirer', 40);
  assert.deepEqual(sansSoja, regles.filter((r) => r.age?.code !== 'soja'));
  assert.deepEqual(appliquerChoixAge(regles, 'soja', 'retirer', 35), regles);
  // Lait cru à 70 mois : le palier « ! » est en vigueur, la précaution ne se retire pas (elle s'assouplit).
  assert.deepEqual(appliquerChoixAge(regles, 'lait_cru', 'retirer', 70), regles);
  assert.deepEqual(appliquerChoixAge(regles, 'lait_cru', 'retirer', 180), regles.filter((r) => r.age?.code !== 'lait_cru'));
  // Une règle éteinte se retire aussi (le choix passe avant les interrupteurs).
  const eteintes = basculerPrecaution(regles, 'poisson_cru', false);
  assert.deepEqual(appliquerChoixAge(eteintes, 'poisson_cru', 'retirer', 40), eteintes.filter((r) => r.age?.code !== 'poisson_cru'));
});

test('appliquerChoixAge garder puis revoir : garde posé, plus rien de proposé ; revoir le retire, toujours permis', () => {
  const profil = enfant(70, 30);
  const gardees = appliquerChoixAge(profil.regles, 'viande_crue', 'garder', 70);
  assert.deepEqual(regleDe(gardees, 'viande_crue'), { ...regleDe(profil.regles, 'viande_crue'), age: { code: 'viande_crue', palier: 0, jusquAMois: 36, garde: true } });
  assert.equal(lireAge({ ...profil, regles: gardees }, REF).find((e) => e.regle.age.code === 'viande_crue').etat, 'gardee');
  assert.ok(!propositionsAge({ ...profil, regles: gardees }, REF).some((p) => p.code === 'viande_crue'));
  // Garder une seconde fois : rien de plus.
  assert.deepEqual(appliquerChoixAge(gardees, 'viande_crue', 'garder', 70), gardees);
  // Revoir : la règle redevient exactement celle d'avant, de nouveau à revoir ; même sans date (mois null).
  assert.deepEqual(appliquerChoixAge(gardees, 'viande_crue', 'revoir', 70), profil.regles);
  assert.deepEqual(appliquerChoixAge(gardees, 'viande_crue', 'revoir', null), profil.regles);
  assert.equal(lireAge(profil, REF).find((e) => e.regle.age.code === 'viande_crue').etat, 'passee');
  // Revoir une règle qui n'est pas gardée : rien ne change ; `garde: false` est retiré.
  assert.deepEqual(appliquerChoixAge(profil.regles, 'viande_crue', 'revoir', 70), profil.regles);
  const faux = profil.regles.map((r) => (r.age.code === 'miel' ? r : { ...r, age: { ...r.age, garde: false } }));
  assert.deepEqual(regleDe(appliquerChoixAge(faux, 'soja', 'revoir', 70), 'soja'), regleDe(profil.regles, 'soja'));
  // Garder une précaution dont l'âge n'est pas atteint : rien (elle n'est pas à revoir).
  assert.deepEqual(appliquerChoixAge(profil.regles, 'alcool', 'garder', 70), profil.regles);
  // La précaution gardée agit toujours sur les plats.
  assert.deepEqual(precautionsAge(CAMEMBERT, { regles: appliquerChoixAge(profil.regles, 'lait_cru', 'garder', 70) })
    .map((p) => `${p.code}:${p.severite}`), ['lait_cru:exclu']);
});

test('appliquerChoixAge : seule la règle visée change, copie sans valeur undefined, liste reçue intacte', () => {
  const lue = [
    { type: 'typeFutur', x: [1, undefined] },
    undefined,
    ...SANS_VIANDE,
    { ...regleDuPalier(entree('lait_cru'), 0), consigne: undefined },
    regleDuPalier(entree('soja'), 0),
  ];
  const avant = JSON.stringify(lue);
  for (const [code, choix] of [['lait_cru', 'assouplir'], ['soja', 'retirer'], ['soja', 'garder'], ['soja', 'revoir'], ['lait_cru', 'garder']]) {
    const sortie = appliquerChoixAge(lue, code, choix, 70);
    assert.equal(contientUndefined(sortie), false, `${code} ${choix}`);
    const autres = sortie.filter((r) => r.age?.code !== code);
    assert.deepEqual(autres, [{ type: 'typeFutur', x: [1] }, ...SANS_VIANDE,
      ...[regleDuPalier(entree('lait_cru'), 0), regleDuPalier(entree('soja'), 0)].filter((r) => r.age.code !== code)]);
  }
  assert.equal(JSON.stringify(lue), avant, 'la liste reçue n’est pas modifiée');
  // Code absent, choix inconnu, âge inconnu : copie inchangée (sauf pour « revoir »).
  const regles = reglesA(30);
  assert.deepEqual(appliquerChoixAge(regles, 'inconnu', 'retirer', 70), regles);
  assert.deepEqual(appliquerChoixAge(regles, 'soja', 'oublier', 70), regles);
  assert.deepEqual(appliquerChoixAge(regles, '', 'retirer', 70), regles);
  for (const mois of [null, undefined, -1, 40.5, '40']) {
    assert.deepEqual(appliquerChoixAge(regles, 'soja', 'retirer', mois), regles, String(mois));
  }
  assert.deepEqual(appliquerChoixAge(null, 'soja', 'retirer', 70), []);
});

test('appliquerChoixAge : code ou palier inconnu → assouplir impossible ; retirer et garder seulement quand plus rien n’est en vigueur', () => {
  const futur = { id: 'age-futur', type: 'precautionAge', marqueurs: ['cru'], severite: 'exclu', age: { code: 'futur', palier: 0, jusquAMois: 48 }, actif: true };
  const palierFutur = { ...regleDuPalier(entree('lait_cru'), 0), age: { code: 'lait_cru', palier: 4, jusquAMois: 90 } };
  // `borne` : âge à partir duquel la précaution peut se retirer (code inconnu : sa borne ; palier inconnu : la borne la
  // plus haute, celle du dernier palier du barème de l'app, 15 ans pour le lait cru).
  for (const [regle, code, borne] of [[futur, 'futur', 48], [palierFutur, 'lait_cru', 180]]) {
    const regles = [...SANS_VIANDE, regle];
    assert.deepEqual(appliquerChoixAge(regles, code, 'assouplir', borne + 100), regles, code);
    assert.deepEqual(appliquerChoixAge(regles, code, 'retirer', borne), SANS_VIANDE, code);
    assert.deepEqual(appliquerChoixAge(regles, code, 'retirer', borne - 1), regles, code);
    assert.deepEqual(appliquerChoixAge(regles, code, 'garder', borne).at(-1), { ...regle, age: { ...regle.age, garde: true } }, code);
    assert.deepEqual(appliquerChoixAge(regles, code, 'garder', borne - 1), regles, code);
  }
  // Palier inconnu, entre sa borne (90) et la fin du barème (180) : ni retirée, ni gardée, ni assouplie.
  const regles = [...SANS_VIANDE, palierFutur];
  for (const choix of ['retirer', 'garder', 'assouplir']) assert.deepEqual(appliquerChoixAge(regles, 'lait_cru', choix, 90), regles, choix);
  // Retirée à 15 ans, rien ne revient par reglesSelonAge.
  assert.ok(!reglesSelonAge(neIlYA(180), REF, appliquerChoixAge(regles, 'lait_cru', 'retirer', 180)).ajoutees.includes('lait_cru'));
});

// ——— rejouerChoixAge ———

test('rejouerChoixAge : un choix ne vaut que pour l’âge où il a été fait (date corrigée, effacée, nouveau mois)', () => {
  const enregistrees = [...SANS_VIANDE, ...reglesA(30)];
  const selon = (mois) => reglesSelonAge(neIlYA(mois), REF, enregistrees).regles;
  const faits = [
    { code: 'lait_cru', choix: 'assouplir', mois: 72 },
    { code: 'poisson_cru', choix: 'retirer', mois: 72 },
    { code: 'viande_crue', choix: 'garder', mois: 72 },
  ];
  // Au même âge : appliqués dans l'ordre, comme appliquerChoixAge un par un.
  let attendu = selon(72);
  for (const { code, choix } of faits) attendu = appliquerChoixAge(attendu, code, choix, 72);
  assert.deepEqual(rejouerChoixAge(selon(72), faits, 72), attendu);
  assert.equal(regleDe(attendu, 'lait_cru').age.palier, 1);
  assert.equal(regleDe(attendu, 'poisson_cru'), undefined);
  assert.equal(regleDe(attendu, 'viande_crue').age.garde, true);
  // Date corrigée vers un autre âge où les mêmes choix seraient possibles (5 ans et demi, 16 ans) : aucun ne s'applique,
  // les précautions redeviennent à revoir.
  for (const mois of [66, 192]) {
    assert.deepEqual(rejouerChoixAge(selon(mois), faits, mois), selon(mois), `${mois} mois`);
    assert.ok(propositionsAge({ naissance: neIlYA(mois), regles: rejouerChoixAge(selon(mois), faits, mois) }, REF)
      .some((p) => p.code === 'poisson_cru'), `${mois} mois : poisson cru de nouveau à revoir`);
  }
  // Date effacée : rien ; date plus jeune : rien.
  assert.deepEqual(rejouerChoixAge(enregistrees, faits, null), enregistrees);
  assert.deepEqual(rejouerChoixAge(selon(40), faits, 40), selon(40));
  // Choix faits à deux âges : seuls ceux de l'âge du brouillon comptent.
  const melanges = [...faits, { code: 'soja', choix: 'retirer', mois: 66 }, { code: 'lait_cru', choix: 'garder', mois: 66 }];
  assert.deepEqual(rejouerChoixAge(selon(72), melanges, 72), attendu);
  const a66 = rejouerChoixAge(selon(66), melanges, 66);
  assert.equal(regleDe(a66, 'soja'), undefined);
  assert.equal(regleDe(a66, 'lait_cru').age.garde, true);
  assert.equal(regleDe(a66, 'lait_cru').age.palier, 0);
  assert.ok(regleDe(a66, 'poisson_cru'));
});

test('rejouerChoixAge : « Revoir » sans date, entrées abîmées, copie sans undefined, liste reçue intacte', () => {
  const gardees = appliquerChoixAge(reglesA(30), 'viande_crue', 'garder', 70);
  // Une précaution gardée, écran sans date : « Revoir » (fait sans date) agit, les autres choix non.
  const sansDate = rejouerChoixAge(gardees, [{ code: 'viande_crue', choix: 'revoir', mois: null }, { code: 'soja', choix: 'retirer', mois: null }], null);
  assert.deepEqual(sansDate, reglesA(30));
  // « Garder » puis « Revoir » au même âge : la règle revient telle quelle.
  assert.deepEqual(rejouerChoixAge(reglesA(30), [{ code: 'soja', choix: 'garder', mois: 70 }, { code: 'soja', choix: 'revoir', mois: 70 }], 70), reglesA(30));
  // Entrées abîmées ou âge illisible : ignorées.
  const lue = [{ type: 'typeFutur', x: [1, undefined] }, undefined, ...reglesA(30)];
  const avant = JSON.stringify(lue);
  for (const choix of [null, undefined, 'x', [null, 'soja', { code: 'soja', choix: 'retirer' }, { code: 'soja', choix: 'retirer', mois: '40' }, { code: 'soja', choix: 'retirer', mois: 40.5 }]]) {
    const sortie = rejouerChoixAge(lue, choix, 40);
    assert.equal(contientUndefined(sortie), false);
    assert.deepEqual(sortie, [{ type: 'typeFutur', x: [1] }, ...reglesA(30)], JSON.stringify(choix));
  }
  assert.deepEqual(rejouerChoixAge(lue, [{ code: 'soja', choix: 'retirer', mois: 40 }], 40), [{ type: 'typeFutur', x: [1] }, ...reglesA(30).filter((r) => r.age.code !== 'soja')]);
  for (const mois of [undefined, -1, 40.5, '40']) {
    assert.deepEqual(rejouerChoixAge(reglesA(30), [{ code: 'soja', choix: 'retirer', mois: 40 }], mois), reglesA(30), String(mois));
  }
  assert.equal(JSON.stringify(lue), avant, 'la liste reçue n’est pas modifiée');
  assert.deepEqual(rejouerChoixAge(null, [], 40), []);
});

// ——— Brouillon de l'écran ———

test('brouillon : enregistrées → reglesSelonAge → choix → interrupteurs ; relu après « Enregistrer », plus rien ne bouge', () => {
  const naissance = neIlYA(74);
  const enregistrees = [...SANS_VIANDE, ...basculerPrecaution(reglesA(30), 'oeuf_cru', false)];
  const profil = { naissance, regles: enregistrees };
  // Œufs crus éteints : rien n'est proposé pour eux.
  assert.ok(!propositionsAge(profil, REF).some((p) => p.code === 'oeuf_cru'));
  const choix = [['lait_cru', 'assouplir'], ['poisson_cru', 'retirer'], ['viande_crue', 'garder'], ['charcuterie_crue', 'garder'],
    ['fruit_coque', 'garder'], ['poisson_predateur', 'garder'], ['soja', 'retirer']];
  // Œufs crus rallumés dans le brouillon, puis retirés : le choix s'applique avant l'interrupteur.
  const enregistre = brouillon(naissance, enregistrees, [...choix, ['oeuf_cru', 'retirer']], [['oeuf_cru', true], ['alcool', false]]);
  assert.deepEqual(enregistre.slice(0, SANS_VIANDE.length), SANS_VIANDE);
  assert.deepEqual(lireAge({ naissance, regles: enregistre }, REF).map((e) => [e.regle.age.code, e.regle.age.palier, e.etat]), [
    ['lait_cru', 1, 'en_cours'], ['viande_crue', 0, 'gardee'], ['charcuterie_crue', 0, 'gardee'], ['fruit_coque', 0, 'gardee'],
    ['poisson_predateur', 0, 'gardee'], ['cafeine', 0, 'en_cours'], ['alcool', 0, 'desactivee'],
  ]);
  // Rouvert : rien n'est ajouté, durci ni proposé ; la carte de Semaine a disparu.
  assert.deepEqual(reglesSelonAge(naissance, REF, enregistre), { regles: enregistre, ajoutees: [], durcies: [] });
  assert.deepEqual(propositionsAge({ naissance, regles: enregistre }, REF), []);
  assert.equal(carteAnniversaire([{ ...ADULTE_A }, { id: 'enfant', nom: 'Enfant', ordre: 3, naissance, regles: enregistre }], REF), null);
  // Le plat au camembert passe en « attention » avec son conseil.
  assert.deepEqual(precautionsAge(CAMEMBERT, { regles: enregistre }).map((p) => [p.code, p.severite, p.consigne]),
    [['lait_cru', 'attention', 'Préférer pasteurisé, pâte pressée cuite ou bien cuit.']]);
});

test('brouillon : date corrigée après un choix → le choix ne s’applique plus (jamais moins prudent que l’âge)', () => {
  const enregistrees = reglesA(30);
  const choix = [['lait_cru', 'assouplir'], ['poisson_cru', 'retirer'], ['viande_crue', 'garder']];
  // Date saisie trop vieille, choix faits, puis date corrigée : même résultat que la seule date corrigée.
  assert.notDeepEqual(brouillon(neIlYA(70), enregistrees, choix), enregistrees);
  assert.deepEqual(brouillon(neIlYA(30), enregistrees, choix, [], 70), brouillon(neIlYA(30), enregistrees));
  assert.deepEqual(brouillon(neIlYA(30), enregistrees, choix, [], 70), enregistrees);
  // Date corrigée vers un autre âge où ces choix seraient encore possibles (5 ans et demi) : ils ne s'appliquent pas,
  // les précautions sont de nouveau à revoir (personne n'a choisi pour cet âge).
  assert.deepEqual(brouillon(neIlYA(66), enregistrees, choix, [], 70), brouillon(neIlYA(66), enregistrees));
  assert.deepEqual(propositionsAge({ naissance: neIlYA(66), regles: brouillon(neIlYA(66), enregistrees, choix, [], 70) }, REF),
    propositionsAge({ naissance: neIlYA(66), regles: enregistrees }, REF));
  // Date remise : les choix de cet âge reviennent.
  assert.deepEqual(brouillon(neIlYA(70), enregistrees, choix, [], 70), brouillon(neIlYA(70), enregistrees, choix));
  // Date effacée : aucun choix ne retire ni n'assouplit.
  let regles = reglesSelonAge(null, REF, enregistrees).regles;
  regles = rejouerChoixAge(regles, choix.map(([code, c]) => ({ code, choix: c, mois: 70 })), ageEnMois(null, REF));
  assert.deepEqual(regles, enregistrees);
  // Date rajeunie sous la borne d'une précaution assouplie et enregistrée : reglesSelonAge la durcit de nouveau.
  const assouplies = brouillon(neIlYA(70), enregistrees, [['lait_cru', 'assouplir']]);
  assert.deepEqual(reglesSelonAge(neIlYA(40), REF, assouplies).durcies, ['lait_cru']);
});

// ——— carteAnniversaire ———

test('carteAnniversaire : aucun profil, un enfant, deux enfants (premier dans l’ordre, nombre tous profils confondus)', () => {
  assert.equal(carteAnniversaire([], REF), null);
  assert.equal(carteAnniversaire(undefined, REF), null);
  assert.equal(carteAnniversaire([ADULTE_A, ADULTE_B], REF), null);
  // Rien d'atteint, sans date, tout gardé ou éteint : pas de carte.
  assert.equal(carteAnniversaire([ADULTE_A, enfant(30, 30)], REF), null);
  assert.equal(carteAnniversaire([{ ...enfant(70, 30), naissance: undefined }], REF), null);
  const tout = enfant(70, 30);
  let calmes = tout.regles;
  for (const { code } of propositionsAge(tout, REF)) calmes = appliquerChoixAge(calmes, code, 'garder', 70);
  assert.equal(carteAnniversaire([{ ...tout, regles: calmes }], REF), null);
  assert.equal(carteAnniversaire([{ ...tout, regles: tout.regles.map((r) => ({ ...r, actif: false })) }], REF), null);
  // Un enfant.
  const un = enfant(70, 30);
  assert.deepEqual(carteAnniversaire([ADULTE_B, un, ADULTE_A], REF), { profil: un, age: '5 ans', nombre: 8 });
  assert.deepEqual(carteAnniversaire([enfant(60, 30)], VEILLE), { profil: enfant(60, 30), age: '4 ans', nombre: 6 });
  // Deux enfants : le premier dans l'ordre d'affichage qui a quelque chose à revoir ; le nombre les réunit.
  const petit = { ...enfant(12, 6), id: 'enfant-2', nom: 'Enfant deux', ordre: 4 };
  assert.deepEqual(carteAnniversaire([petit, un], REF), { profil: un, age: '5 ans', nombre: 9 });
  assert.deepEqual(carteAnniversaire([petit, { ...un, ordre: 5 }], REF), { profil: petit, age: '12 mois', nombre: 9 });
  assert.deepEqual(carteAnniversaire([petit, enfant(30, 30)], REF), { profil: petit, age: '12 mois', nombre: 1 });
});

// ——— Sauvegarde ———

test('sauvegarde : aller-retour de `age.garde` ; validerRegles le garde ; restauration d’un profil absent', () => {
  const gardees = appliquerChoixAge(appliquerChoixAge(reglesA(30), 'viande_crue', 'garder', 70), 'lait_cru', 'assouplir', 70);
  const profil = { ...enfant(70, 30), regles: [...SANS_VIANDE, ...gardees] };
  assert.deepEqual(validerRegles(profil.regles).regles, profil.regles);
  const { texte } = creerSauvegarde({ plats: [], profils: [profil, ADULTE_B] }, { maintenant: new Date('2026-10-09T10:00:00Z') });
  const lu = lireSauvegarde(texte);
  assert.ok(lu.sauvegarde, JSON.stringify(lu));
  const v = validerSauvegarde(lu.sauvegarde);
  assert.deepEqual(v.avertissements, []);
  const relu = v.profils.find((p) => p.id === 'enfant');
  assert.deepEqual(relu, profil);
  assert.equal(regleDe(relu.regles, 'viande_crue').age.garde, true);
  assert.deepEqual(propositionsAge(relu, REF), propositionsAge(profil, REF));
  assert.equal(contientUndefined(v.profils), false);
  // Profil absent de l'app : il revient avec ses précautions gardées.
  const ecriture = preparerRestauration(v, { plats: [], profils: [ADULTE_B] }).lots.flat().find((e) => e.id === 'enfant');
  assert.deepEqual(ecriture.condition, { absent: true });
  assert.deepEqual(ecriture.donnees.regles, profil.regles);
});

// ——— Parmesan et grana padano (instructions en version 6) ———

test('parmesan et grana padano : pâtes pressées cuites, jamais au lait cru (instructions v6 et aide du barème)', async () => {
  assert.equal(VERSION_INSTRUCTIONS, 6);
  const doc = await readFile(new URL('../docs/projet-claude.md', import.meta.url), 'utf8');
  assert.equal(doc.split('\n')[0], '# Instructions du projet Claude — version 6');
  const definition = doc.split('\n').find((l) => l.startsWith('| `lait_cru` |'));
  assert.ok(definition, 'définition de lait_cru absente');
  const pressees = definition.match(/\*\*Jamais\*\* les pâtes pressées cuites[^(]*\(([^)]*)\)/)?.[1] ?? '';
  for (const fromage of ['comté', 'beaufort', 'emmental', 'gruyère', 'parmesan', 'grana padano']) {
    assert.ok(pressees.includes(fromage), `${fromage} dans les pâtes pressées cuites`);
  }
  const enlever = doc.split('\n').find((l) => l.startsWith('- **Enlever**'));
  for (const fromage of ['un comté', 'un gruyère', 'un parmesan', 'un grana padano']) assert.ok(enlever.includes(fromage), fromage);
  assert.doesNotMatch(doc, /pecorino/i);
  const aide = entree('lait_cru').aide;
  for (const fromage of ['comté', 'beaufort', 'emmental', 'gruyère', 'parmesan', 'grana padano']) assert.ok(aide.includes(fromage), fromage);
});

test('écran de l’enfant : une précaution passée que l’app ne propose pas de revoir dit « âge atteint », sans rien promettre', async () => {
  const source = await readFile(new URL('../js/ui/regime.js', import.meta.url), 'utf8');
  assert.match(source, /etat === 'passee'\) return `\$\{base\}\\u00A0· âge atteint`;/);
  assert.doesNotMatch(source, /bientôt/);
});

test('aucune espace insécable écrite telle quelle dans les fichiers de T2c-3 (cœur et écrans)', async () => {
  for (const fichier of ['../js/coeur/age.js', '../js/coeur/claude.js', '../docs/projet-claude.md', './coeur-t2c-3.test.js',
    '../js/ui/regime.js', '../js/ui/semaine.js', '../css/app.css']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});
