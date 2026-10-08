// Deux versions par profil, mer et végétale : validation des versions (style, jours au frigo), fusion par (profil,
// style), ajout de recettes (versions seules, fiches complètes, demandes), affichage local et sauvegarde.
// Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validerPaquet, preparerImport, fusionnerVariantes, demandesSatisfaites, recetteValidee, stylesAttendusDesVersions,
} from '../js/coeur/paquet.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { creerSauvegarde, lireSauvegarde, validerSauvegarde, preparerRestauration, appliquerConditions } from '../js/coeur/sauvegarde.js';
import { appliquerImport, versionsEcrites, annonceVersions } from '../js/coeur/import-local.js';
import { texteCorrectionPourClaude } from '../js/coeur/claude.js';
import { ecrireRegime } from '../js/coeur/regles.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const NI_POISSON = ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: new Set() }, []);
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: 'b@example.com', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5, regles: NI_POISSON };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A];

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const BOEUF = ing('bœuf à braiser', 800, 'g', ['viande', 'boeuf'], { forme: 'morceaux' });
const FOND = ing('fond de veau', 1, 'cs', ['bouillon_viande']);
const OIGNON = ing('oignon jaune', 2, 'pc', ['legume'], { role: 'incorpore' });
const PATES = ing('pâtes', 400, 'g', ['feculent']);
const LARDONS = ing('lardons', 200, 'g', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' });
const ajout = (produit, qtePortion, unite, marqueurs = [], extra = {}) => ({ produit, qtePortion, unite, rayon: 'divers', marqueurs, ...extra });
const SAUMON = ajout('saumon fumé', 2, 'tranche', ['poisson']);
const CREVETTES = ajout('crevettes', 60, 'g', ['fruits_de_mer']);
const THON = ajout('thon au naturel', 50, 'g', ['poisson']);
const TOFU = ajout('tofu fumé', 60, 'g');
const OEUF = ajout('œuf', 1, 'pc', ['oeuf']);
const BOUILLON = ajout('bouillon de volaille', 10, 'cl', ['bouillon_viande']);

const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', recurrence: 'aucune', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Cuire.'], ...extra,
});
const GRATIN = plat('gratin-test', 'Gratin test', [PATES, LARDONS]);
const CARBONADE = plat('carbonade-flamande', 'Carbonade flamande', [BOEUF, OIGNON, FOND]);

const v = (pour, retirer, ajouter, extra = {}) => ({ pour, retirer, ajouter, consigne: 'Part à part.', ...extra });
const MER_B = v('profil-b', ['lardons'], [SAUMON], { style: 'mer', frigoJours: 2, consigne: 'Part au saumon.' });
const VEG_B = v('profil-b', ['lardons'], [TOFU], { style: 'vegetal', consigne: 'Part au tofu.' });
const VEG_ENFANT = v('enfant', ['lardons'], [TOFU, OEUF], { style: 'vegetal' });
// Versions d'avant les styles : leur style se déduit des ajouts (poisson → mer, sinon végétale).
const ANCIENNE_THON_B = v('profil-b', ['lardons'], [THON], { consigne: 'Part au thon.' });
const ANCIENNE_TOFU_B = v('profil-b', ['lardons'], [TOFU], { consigne: 'Ancienne part au tofu.' });
// Carbonade : bœuf et fond de veau à retirer.
const MER_CARBO = v('profil-b', ['bœuf à braiser', 'fond de veau'], [SAUMON], { style: 'mer', frigoJours: 2 });
const VEG_CARBO = v('profil-b', ['bœuf à braiser', 'fond de veau'], [TOFU], { style: 'vegetal' });

const clone = (valeur) => structuredClone(valeur);
const paquet = (...plats) => ({ format: 'paquet@1', plats });
const valider = (brut, options = {}) => validerPaquet([paquet(brut)], { profils: PROFILS, ...options });
const valides = (...plats) => {
  const resultat = validerPaquet([paquet(...plats)], { profils: PROFILS });
  assert.equal(resultat.valide, true, JSON.stringify(resultat.erreurs.concat(resultat.plats.flatMap((p) => p.erreurs))));
  return resultat.plats.map((p) => p.donnees);
};
const importer = (plats, options) => preparerImport(valides(...plats), { demandes: [], profils: PROFILS, ...options });
const avecVersions = (fiche, ...variantes) => ({ ...fiche, variantes });

/** Vrai si la valeur contient undefined ou null, à quelque profondeur que ce soit. */
function contientVide(valeur) {
  if (valeur === undefined || valeur === null) return true;
  if (Array.isArray(valeur)) return valeur.some(contientVide);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientVide);
  return false;
}

/** Aucun mot technique dans un message affiché (CLAUDE.md §4). */
function sansMotTechnique(message) {
  assert.doesNotMatch(message, /style|vegetal(?!e)|frigoJours|fruits_de_mer|JSON|paquet|format|variantes\[/i, message);
}

// ——— Validation : style ———

test('style toléré (casse, accents, synonymes) et gardé dans les données ; absent ou vide : pas de style', () => {
  const cas = [['Mer', 'mer'], [' MER ', 'mer'], ['végétal', 'vegetal'], ['Végétale', 'vegetal'], ['vegetarienne', 'vegetal'],
    ['Végétarien', 'vegetal'], ['VEGETAL', 'vegetal']];
  for (const [brut, attendu] of cas) {
    const ajouts = attendu === 'mer' ? [SAUMON] : [TOFU];
    const r = valider(avecVersions(GRATIN, v('profil-b', ['lardons'], ajouts, { style: brut, frigoJours: 2 })));
    assert.equal(r.valide, true, brut);
    assert.equal(r.plats[0].donnees.variantes[0].style, attendu, brut);
    assert.equal(r.plats[0].donnees.variantes[0].frigoJours, 2);
  }
  for (const style of [undefined, null, '', '  ']) {
    const r = valider(avecVersions(GRATIN, v('profil-b', ['lardons'], [TOFU], { style })));
    assert.equal(r.valide, true);
    assert.equal('style' in r.plats[0].donnees.variantes[0], false);
    assert.equal(contientVide(r.plats[0].donnees), false);
    assert.deepEqual(r.plats[0].avertissements, [], 'style et frigoJours ne sont pas des champs inconnus');
  }
});

test('style inconnu : erreur, message sans mot technique, codes exacts pour Claude', () => {
  const r = valider(avecVersions(GRATIN, v('profil-b', ['lardons'], [SAUMON], { style: 'Poisson', frigoJours: 2 })));
  assert.equal(r.valide, false);
  const [erreur] = r.plats[0].erreurs;
  assert.equal(erreur.message, '«\u00A0Gratin test\u00A0», variante 1\u00A0: version «\u00A0Poisson\u00A0» inconnue (mer ou végétale).');
  assert.equal(erreur.pourClaude, 'plats[0] (gratin-test) variantes[0].style « Poisson » : `mer` ou `vegetal`');
  sansMotTechnique(erreur.message);
  const objet = valider(avecVersions(GRATIN, v('profil-b', ['lardons'], [TOFU], { style: { nom: 'mer' } })));
  assert.equal(objet.plats[0].erreurs[0].pourClaude, 'plats[0] (gratin-test) variantes[0].style « ? » : `mer` ou `vegetal`');
});

// ——— Validation : jours au frigo ———

test('frigoJours : entier de 1 à 30, texte de chiffres accepté ; sinon erreur', () => {
  for (const [brut, attendu] of [[1, 1], [30, 30], ['3', 3], [' 2 ', 2]]) {
    const r = valider(avecVersions(GRATIN, { ...MER_B, frigoJours: brut }));
    assert.equal(r.valide, true, String(brut));
    assert.equal(r.plats[0].donnees.variantes[0].frigoJours, attendu);
  }
  for (const brut of [0, 31, 2.5, 'deux', true, -1, {}]) {
    const r = valider(avecVersions(GRATIN, { ...MER_B, frigoJours: brut }));
    assert.equal(r.valide, false, String(brut));
    const erreurs = r.plats[0].erreurs;
    assert.equal(erreurs.length, 1, JSON.stringify(erreurs));
    assert.equal(erreurs[0].message, '«\u00A0Gratin test\u00A0», variante 1\u00A0: nombre de jours au frigo invalide (de 1 à 30).');
    assert.equal(erreurs[0].pourClaude, 'plats[0] (gratin-test) variantes[0].frigoJours : nombre entier de jours (1 à 30)');
  }
  // Facultatif pour une version végétale ou sans style ; gardé s'il est donné.
  const veg = valider(avecVersions(GRATIN, { ...VEG_B, frigoJours: 4 }, { ...ANCIENNE_TOFU_B, pour: 'enfant', frigoJours: '3' }));
  assert.equal(veg.valide, true);
  assert.deepEqual(veg.plats[0].donnees.variantes.map((x) => x.frigoJours), [4, 3]);
});

test('version mer sans jours au frigo : erreur à l’ajout de recettes', () => {
  const { frigoJours: _f, ...sansJours } = MER_B;
  for (const mer of [sansJours, { ...sansJours, frigoJours: null }, { ...sansJours, frigoJours: ' ' }]) {
    const r = valider(avecVersions(GRATIN, VEG_ENFANT, mer));
    assert.equal(r.valide, false);
    assert.deepEqual(r.plats[0].erreurs, [{
      message: 'Version mer de «\u00A0Gratin test\u00A0»\u00A0: combien de jours au frigo\u202F?',
      pourClaude: 'plats[0] (gratin-test) variantes[1] (mer) : `frigoJours` manquant (nombre entier de jours)',
    }]);
  }
  const r = valider(avecVersions(GRATIN, VEG_ENFANT, sansJours));
  sansMotTechnique(r.plats[0].erreurs[0].message);
  assert.match(texteCorrectionPourClaude(r), /\n- plats\[0\] \(gratin-test\) variantes\[1\] \(mer\) : `frigoJours` manquant \(nombre entier de jours\)\n/);
});

// ——— Validation : ajouts selon le style ———

test('version mer : au moins un poisson ou fruit de mer ajouté', () => {
  assert.equal(valider(avecVersions(GRATIN, { ...MER_B, ajouter: [CREVETTES] })).valide, true);
  assert.equal(valider(avecVersions(GRATIN, { ...MER_B, ajouter: [TOFU, { ...SAUMON, marqueurs: ['Poisson'] }] })).valide, true);
  const r = valider(avecVersions(GRATIN, { ...MER_B, ajouter: [TOFU] }));
  assert.equal(r.valide, false);
  assert.deepEqual(r.plats[0].erreurs, [{
    message: 'Version mer de «\u00A0Gratin test\u00A0»\u00A0: aucun poisson ni fruit de mer ajouté.',
    pourClaude: 'plats[0] (gratin-test) variantes[0] (mer) : aucun ingrédient `poisson` ou `fruits_de_mer` dans `ajouter`',
  }]);
  sansMotTechnique(r.plats[0].erreurs[0].message);
  // Rien d'ajouté du tout : même erreur (en plus de l'avertissement « elle ne change rien »).
  const vide = valider(avecVersions(GRATIN, { ...MER_B, retirer: [], ajouter: [] }));
  assert.equal(vide.valide, false);
  assert.match(vide.plats[0].erreurs[0].pourClaude, /\(mer\) : aucun ingrédient/);
});

test('version végétale : ni poisson ni fruits de mer ajoutés ; œufs et laitages permis', () => {
  assert.equal(valider(avecVersions(GRATIN, { ...VEG_B, ajouter: [TOFU, OEUF, ajout('gruyère', 30, 'g', ['laitier'])] })).valide, true);
  const r = valider(avecVersions(GRATIN, { ...VEG_B, ajouter: [TOFU, CREVETTES, THON] }));
  assert.equal(r.valide, false);
  assert.deepEqual(r.plats[0].erreurs.map((e) => e.pourClaude), [
    'plats[0] (gratin-test) variantes[0] (vegetal) ajouter[1] « crevettes » : ni `poisson` ni `fruits_de_mer` dans une version `vegetal`',
    'plats[0] (gratin-test) variantes[0] (vegetal) ajouter[2] « thon au naturel » : ni `poisson` ni `fruits_de_mer` dans une version `vegetal`',
  ]);
  assert.equal(r.plats[0].erreurs[0].message, 'Version végétale de «\u00A0Gratin test\u00A0»\u00A0: «\u00A0crevettes\u00A0» est un poisson ou un fruit de mer.');
  for (const erreur of r.plats[0].erreurs) sansMotTechnique(erreur.message);
});

// ——— Validation : une version par (profil, style) ———

test('mer et végétale pour le même profil : acceptées ; une par style et par profil', () => {
  const r = valider(avecVersions(GRATIN, MER_B, VEG_B, VEG_ENFANT, { ...MER_B, pour: 'enfant' }));
  assert.equal(r.valide, true, JSON.stringify(r.plats[0].erreurs));
  assert.deepEqual(r.plats[0].donnees.variantes.map((x) => [x.pour, x.style]),
    [['profil-b', 'mer'], ['profil-b', 'vegetal'], ['enfant', 'vegetal'], ['enfant', 'mer']]);
  assert.deepEqual(r.plats[0].donnees.variantes[0], MER_B);
});

test('deux versions du même style pour le même profil : erreur à l’ajout de recettes', () => {
  const mer = valider(avecVersions(GRATIN, MER_B, VEG_B, { ...MER_B, ajouter: [CREVETTES] }));
  assert.equal(mer.valide, false);
  assert.deepEqual(mer.plats[0].erreurs, [{
    message: 'Deux versions mer pour le même profil dans «\u00A0Gratin test\u00A0».',
    pourClaude: 'plats[0] (gratin-test) variantes[2] : deux versions `mer` pour le profil `profil-b`',
  }]);
  const veg = valider(avecVersions(GRATIN, VEG_B, { ...VEG_B, consigne: 'Autre.' }));
  assert.deepEqual(veg.plats[0].erreurs, [{
    message: 'Deux versions végétales pour le même profil dans «\u00A0Gratin test\u00A0».',
    pourClaude: 'plats[0] (gratin-test) variantes[1] : deux versions `vegetal` pour le profil `profil-b`',
  }]);
  for (const erreur of [...mer.plats[0].erreurs, ...veg.plats[0].erreurs]) sansMotTechnique(erreur.message);
});

test('une version sans style doit être la seule de son profil (dans les deux ordres)', () => {
  for (const variantes of [[ANCIENNE_TOFU_B, MER_B], [MER_B, ANCIENNE_TOFU_B]]) {
    const r = valider(avecVersions(GRATIN, ...variantes));
    assert.equal(r.valide, false);
    assert.deepEqual(r.plats[0].erreurs, [{
      message: 'Deux versions pour le même profil dans «\u00A0Gratin test\u00A0», dont une qui ne dit pas si elle est mer ou végétale.',
      pourClaude: 'plats[0] (gratin-test) variantes[1] : une variante sans `style` doit être la seule du profil `profil-b`',
    }]);
    sansMotTechnique(r.plats[0].erreurs[0].message);
  }
  // Deux versions sans style : textes d'avant les styles (non-régression).
  const avant = valider(avecVersions(GRATIN, ANCIENNE_TOFU_B, ANCIENNE_THON_B));
  assert.deepEqual(avant.plats[0].erreurs, [{
    message: 'Deux versions pour le même profil dans «\u00A0Gratin test\u00A0».',
    pourClaude: 'plats[0] (gratin-test) variantes[1].pour « profil-b » : deux variantes pour le même profil',
  }]);
  // Une version sans style par profil, pour plusieurs profils : comme avant.
  assert.equal(valider(avecVersions(GRATIN, ANCIENNE_TOFU_B, { ...ANCIENNE_TOFU_B, pour: 'enfant' })).valide, true);
});

test('fiches en base et sauvegardes : conflits et incohérences en avertissements, la première version gardée', () => {
  const { frigoJours: _f, ...merSansJours } = MER_B;
  const fiche = avecVersions(GRATIN, merSansJours, VEG_B, { ...VEG_B, consigne: 'Doublon.' }, ANCIENNE_THON_B,
    { ...MER_B, pour: 'enfant', ajouter: [TOFU] });
  const r = validerPaquet([paquet(fiche)], { versionsEnDouble: 'premiere' });
  assert.equal(r.valide, true, JSON.stringify(r.plats[0].erreurs));
  assert.deepEqual(r.plats[0].donnees.variantes.map((x) => [x.pour, x.style, x.consigne]), [
    ['profil-b', 'mer', 'Part au saumon.'],
    ['profil-b', 'vegetal', 'Part au tofu.'],
    ['enfant', 'mer', 'Part au saumon.'],
  ]);
  assert.deepEqual(r.plats[0].avertissements.map((a) => a.pourClaude), [
    'plats[0] (gratin-test) variantes[0] (mer) : `frigoJours` manquant (nombre entier de jours)',
    'plats[0] (gratin-test) variantes[4] (mer) : aucun ingrédient `poisson` ou `fruits_de_mer` dans `ajouter`',
    'plats[0] (gratin-test) variantes[2] : deux versions `vegetal` pour le profil `profil-b`, la première est gardée',
    'plats[0] (gratin-test) variantes[3] : une variante sans `style` doit être la seule du profil `profil-b`, la première est gardée',
  ]);
  assert.equal(r.plats[0].avertissements[2].message,
    'Deux versions végétales pour le même profil dans «\u00A0Gratin test\u00A0»\u00A0: seule la première est gardée.');
  // recetteValidee lit les fiches en base de la même façon.
  assert.deepEqual(recetteValidee(fiche).variantes, r.plats[0].donnees.variantes);
});

// ——— fusionnerVariantes : par (profil, style) ———

test('fusion : une version reçue remplace celle du même profil et du même style, les autres restent', () => {
  const nouvelleMer = { ...MER_B, ajouter: [CREVETTES], consigne: 'Part aux crevettes.' };
  const actuelles = [VEG_ENFANT, MER_B, VEG_B];
  assert.deepEqual(fusionnerVariantes(actuelles, [nouvelleMer]), [VEG_ENFANT, nouvelleMer, VEG_B]);
  assert.deepEqual(actuelles, [VEG_ENFANT, MER_B, VEG_B], 'entrée intacte');
  // Nouveau style pour un profil qui a déjà l'autre : à la fin.
  assert.deepEqual(fusionnerVariantes([MER_B, VEG_ENFANT], [VEG_B]), [MER_B, VEG_ENFANT, VEG_B]);
  // Rien sur la fiche : les deux à la fin, dans l'ordre reçu.
  assert.deepEqual(fusionnerVariantes([VEG_ENFANT], [MER_B, VEG_B]), [VEG_ENFANT, MER_B, VEG_B]);
});

test('fusion : une version d’avant les styles compte pour son style déduit', () => {
  // Même style déduit : remplacée, à sa place.
  assert.deepEqual(fusionnerVariantes([ANCIENNE_TOFU_B, VEG_ENFANT], [VEG_B]), [VEG_B, VEG_ENFANT]);
  assert.deepEqual(fusionnerVariantes([ANCIENNE_THON_B], [MER_B]), [MER_B]);
  // Autre style déduit : elle reste, avec son style écrit (une version sans style serait seule de son profil).
  assert.deepEqual(fusionnerVariantes([ANCIENNE_TOFU_B, VEG_ENFANT], [MER_B]),
    [{ ...ANCIENNE_TOFU_B, style: 'vegetal' }, VEG_ENFANT, MER_B]);
  const fusion = fusionnerVariantes([ANCIENNE_THON_B], [VEG_B]);
  assert.deepEqual(fusion, [{ ...ANCIENNE_THON_B, style: 'mer' }, VEG_B]);
  // Ses jours au frigo ne sont pas inventés : la fiche reste valide à la lecture (fiches en base, sauvegarde).
  assert.equal('frigoJours' in fusion[0], false);
  const fiche = avecVersions(GRATIN, ...fusion);
  assert.ok(recetteValidee(fiche));
  assert.equal(validerPaquet([paquet(fiche)], { versionsEnDouble: 'premiere' }).valide, true);
});

// « Modifier » revalide la fiche entière (edition.js › preparerModification) : une version mer dont le style a été
// déduit et écrit par la fusion n'a pas de jours au frigo. « Modifier » ne touche pas aux versions : il les juge comme
// une fiche en base (`versionsEnDouble: 'premiere'`) et l'enregistrement passe.
test('« Modifier » une fiche dont la fusion a écrit le style d’une ancienne version au poisson', async () => {
  const { preparerModification, normaliserPourEdition } = await import('../js/coeur/edition.js');
  const fiche = avecVersions(GRATIN, ...fusionnerVariantes([ANCIENNE_THON_B], [VEG_B]));
  const base = normaliserPourEdition(fiche, null);
  assert.deepEqual(preparerModification(base, { ...base, nom: 'Gratin renommé' }, fiche).erreurs, []);
});

test('fusion : une version reçue sans style remplace toutes celles de son profil, comme avant', () => {
  assert.deepEqual(fusionnerVariantes([VEG_ENFANT, MER_B, VEG_B], [ANCIENNE_THON_B]), [VEG_ENFANT, ANCIENNE_THON_B]);
  assert.deepEqual(fusionnerVariantes([MER_B, VEG_ENFANT, VEG_B], [ANCIENNE_TOFU_B]), [ANCIENNE_TOFU_B, VEG_ENFANT]);
});

// Profil passé à « Ni viande ni poisson », ou version mer d'avant les styles pour l'enfant : sa version mer n'est plus
// attendue, et rien ne la redemanderait. La version végétale reçue la remplace aussi.
const ANCIENNE_SAUMON_ENFANT = v('enfant', ['lardons'], [SAUMON], { consigne: 'Part au saumon.' });
const MER_ENFANT = { ...MER_B, pour: 'enfant' };

test('stylesAttendusDesVersions : seulement les profils qui n’attendent pas tous les styles', () => {
  assert.equal(stylesAttendusDesVersions(GRATIN, [MER_B, VEG_B], PROFILS), null);
  assert.deepEqual(stylesAttendusDesVersions(GRATIN, [VEG_ENFANT, VEG_B, { ...VEG_ENFANT }], PROFILS), { enfant: ['vegetal'] });
  // Dessert : « Pas de viande » n'attend que la végétale.
  assert.deepEqual(stylesAttendusDesVersions({ ...GRATIN, type: 'dessert' }, [VEG_B], PROFILS), { 'profil-b': ['vegetal'] });
  // Profil inconnu ou sans style attendu : rien.
  assert.equal(stylesAttendusDesVersions(GRATIN, [{ ...VEG_B, pour: 'inconnu' }, { ...VEG_B, pour: 'profil-a' }], PROFILS), null);
  assert.equal(stylesAttendusDesVersions(GRATIN, null, PROFILS), null);
});

test('fusion : avec les styles attendus, une version reçue remplace aussi celles d’un style plus attendu', () => {
  const attendus = { enfant: ['vegetal'] };
  // Version d'avant les styles (saumon) : remplacée à sa place ; les versions des autres profils restent.
  assert.deepEqual(fusionnerVariantes([MER_B, ANCIENNE_SAUMON_ENFANT, VEG_B], [VEG_ENFANT], { attendus }), [MER_B, VEG_ENFANT, VEG_B]);
  // Version mer écrite et version végétale : les deux remplacées par la végétale reçue.
  assert.deepEqual(fusionnerVariantes([MER_ENFANT, VEG_B, { ...VEG_ENFANT, consigne: 'Ancienne.' }], [VEG_ENFANT], { attendus }),
    [VEG_ENFANT, VEG_B]);
  // Sans les styles attendus (restauration) : la version mer reste, avec son style écrit.
  assert.deepEqual(fusionnerVariantes([ANCIENNE_SAUMON_ENFANT], [VEG_ENFANT]), [{ ...ANCIENNE_SAUMON_ENFANT, style: 'mer' }, VEG_ENFANT]);
  // Une version mer reçue avec la végétale n'est pas ôtée par elle (l'aperçu la signale) ; une version sans style
  // remplace toujours tout son profil.
  assert.deepEqual(fusionnerVariantes([], [MER_ENFANT, VEG_ENFANT], { attendus }), [MER_ENFANT, VEG_ENFANT]);
  assert.deepEqual(fusionnerVariantes([MER_ENFANT, VEG_ENFANT], [ANCIENNE_SAUMON_ENFANT], { attendus }), [ANCIENNE_SAUMON_ENFANT]);
  // « Pas de viande » attend les deux styles : rien d'autre ne part.
  assert.deepEqual(fusionnerVariantes([MER_B, VEG_B], [{ ...VEG_B, consigne: 'Nouvelle.' }], { attendus: { 'profil-b': ['mer', 'vegetal'] } }),
    [MER_B, { ...VEG_B, consigne: 'Nouvelle.' }]);
});

test('fusion : deux reçues de même clé → la première ; doublons d’une fiche abîmée retirés ; jamais de vide', () => {
  const autreMer = { ...MER_B, consigne: 'Seconde.' };
  assert.deepEqual(fusionnerVariantes([], [MER_B, autreMer, VEG_B]), [MER_B, VEG_B]);
  assert.deepEqual(fusionnerVariantes([MER_B, VEG_ENFANT, { ...MER_B, consigne: 'Doublon.' }], [autreMer]), [autreMer, VEG_ENFANT]);
  const fusion = fusionnerVariantes([{ ...VEG_B, consigne: undefined }, null, { ...ANCIENNE_THON_B, consigne: undefined }],
    [{ ...MER_B, frigoJours: undefined, consigne: undefined }, null, { pour: '' }, 'x']);
  assert.equal(contientVide(fusion), false);
  assert.deepEqual(fusion.map((x) => [x.pour, x.style]), [['profil-b', 'vegetal'], ['profil-b', 'mer']]);
  // Style inconnu sur une version reçue : elle compte comme sans style.
  assert.deepEqual(fusionnerVariantes([MER_B, VEG_B], [{ ...ANCIENNE_TOFU_B, style: 'autre' }]).length, 1);
});

// ——— Ajout de recettes : versions seules ———

test('versions seules mer + végétale : écrites avec leur style, libellés 🐟 et 🌿, demande close', () => {
  const demandes = [{ id: 'carbonade-flamande__profil-b', statut: 'ouverte' }];
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [MER_CARBO, VEG_CARBO] }],
    { plats: [CARBONADE], demandes });
  assert.equal(r.elements[0].statut, 'versions');
  assert.deepEqual(r.ecritures, [{ id: 'carbonade-flamande', mode: 'versions', variantes: [MER_CARBO, VEG_CARBO] }]);
  assert.deepEqual(r.elements[0].versions, [
    { pour: 'profil-b', style: 'mer', nom: 'Adulte B', action: 'ajoutee', convient: true, libelle: '🐟 Version mer pour Adulte B ajoutée' },
    { pour: 'profil-b', style: 'vegetal', nom: 'Adulte B', action: 'ajoutee', convient: true, libelle: '🌿 Version végétale pour Adulte B ajoutée' },
  ]);
  assert.deepEqual(r.demandesAClore, ['carbonade-flamande__profil-b']);
  assert.deepEqual(r.corrections, []);
  for (const ecriture of r.ecritures) assert.equal(contientVide(ecriture), false);
  // Affichage local : la fiche a les deux versions.
  const [apres] = appliquerImport([CARBONADE], r.ecritures);
  assert.deepEqual(apres.variantes, [MER_CARBO, VEG_CARBO]);
});

test('versions seules : comparées à la version de même clé, style déduit pour une version d’avant les styles', () => {
  const ancienneThon = v('profil-b', ['bœuf à braiser', 'fond de veau'], [THON], { consigne: 'Part au thon.' });
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [MER_CARBO, VEG_CARBO] }],
    { plats: [avecVersions(CARBONADE, ancienneThon)] });
  assert.deepEqual(r.elements[0].versions.map((x) => [x.style, x.action, x.libelle]), [
    ['mer', 'remplacee', '🐟 Version mer pour Adulte B remplacée'],
    ['vegetal', 'ajoutee', '🌿 Version végétale pour Adulte B ajoutée'],
  ]);
  assert.deepEqual(fusionnerVariantes([ancienneThon], r.ecritures[0].variantes), [MER_CARBO, VEG_CARBO]);
});

test('versions seules : la version déjà sur la fiche n’est pas réécrite, seule l’autre part', () => {
  // Même version mer (écrite), végétale nouvelle.
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [MER_CARBO, VEG_CARBO] }],
    { plats: [avecVersions(CARBONADE, MER_CARBO)] });
  assert.deepEqual(r.ecritures, [{ id: 'carbonade-flamande', mode: 'versions', variantes: [VEG_CARBO] }]);
  assert.deepEqual(r.elements[0].versions.map((x) => x.style), ['vegetal']);
  // Version d'avant les styles, même contenu que la végétale reçue : identique, rien n'est écrit.
  const { style: _s, ...ancienneTofu } = VEG_CARBO;
  const identique = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [VEG_CARBO] }],
    { plats: [avecVersions(CARBONADE, ancienneTofu)] });
  assert.equal(identique.elements[0].statut, 'identique');
  assert.deepEqual(identique.ecritures, []);
});

test('version végétale qui ne convient pas : importée, avertissement et correction avec son style', () => {
  const demandes = [{ id: 'carbonade-flamande__profil-b', statut: 'ouverte' }];
  const mauvaise = { ...VEG_CARBO, ajouter: [TOFU, BOUILLON] };
  // Seule version : la demande reste ouverte.
  const seule = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [mauvaise] }],
    { plats: [CARBONADE], demandes });
  assert.deepEqual(seule.demandesAClore, []);
  assert.equal(seule.ecritures.length, 1, 'la version est importée quand même');
  assert.deepEqual(seule.elements[0].versions, [{
    pour: 'profil-b', style: 'vegetal', nom: 'Adulte B', action: 'ajoutee', convient: false, libelle: 'Version végétale pour Adulte B ajoutée',
  }]);
  assert.ok(seule.elements[0].avertissements.includes('La version végétale pour Adulte B contient encore\u00A0: bouillon de volaille.'));
  assert.deepEqual(seule.corrections, [{
    id: 'carbonade-flamande',
    pour: 'profil-b',
    style: 'vegetal',
    message: 'La version végétale pour Adulte B contient encore\u00A0: bouillon de volaille.',
    pourClaude: 'id carbonade-flamande variantes[pour=profil-b, style=vegetal] : contient bouillon de volaille (bouillon_viande), exclu pour profil-b',
  }]);
  assert.match(texteCorrectionPourClaude(seule),
    /\n- id carbonade-flamande variantes\[pour=profil-b, style=vegetal\] : contient bouillon de volaille \(bouillon_viande\), exclu pour profil-b\n/);
  // Avec une version mer qui convient : le plat n'est plus à créer ni à revoir, la demande se clôt ; la végétale
  // reçue reste signalée.
  const avecMer = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [MER_CARBO, mauvaise] }],
    { plats: [CARBONADE], demandes });
  assert.deepEqual(avecMer.demandesAClore, ['carbonade-flamande__profil-b']);
  assert.deepEqual(avecMer.elements[0].versions.map((x) => x.convient), [true, false]);
  assert.equal(avecMer.corrections.length, 1);
});

test('version mer pour un profil qui ne mange pas de poisson : jugée seule, correction', () => {
  const merEnfant = { ...MER_CARBO, pour: 'enfant' };
  const vegEnfant = { ...VEG_CARBO, pour: 'enfant' };
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [merEnfant, vegEnfant] }],
    { plats: [CARBONADE], demandes: [{ id: 'carbonade-flamande__enfant', statut: 'ouverte' }] });
  assert.deepEqual(r.elements[0].versions.map((x) => [x.libelle, x.convient]), [
    ['Version mer pour Enfant ajoutée', false],
    ['🌿 Version végétale pour Enfant ajoutée', true],
  ]);
  assert.deepEqual(r.corrections.map((c) => c.pourClaude), [
    'id carbonade-flamande variantes[pour=enfant, style=mer] : contient saumon fumé (poisson), exclu pour enfant',
  ]);
  assert.deepEqual(r.demandesAClore, ['carbonade-flamande__enfant']);
});

test('version mer d’avant pour « ni viande ni poisson » : la végétale reçue la remplace, plus rien n’est à revoir', () => {
  const fiche = avecVersions(GRATIN, MER_B, ANCIENNE_SAUMON_ENFANT);
  assert.equal(evaluer(fiche, ENFANT).aRevoir, true);
  const demandes = [{ id: 'gratin-test__enfant', statut: 'ouverte' }];
  const r = importer([{ id: 'gratin-test', nom: 'Gratin test', variantes: [VEG_ENFANT] }], { plats: [fiche], demandes });
  assert.deepEqual(r.elements[0].versions.map((x) => [x.action, x.libelle]), [['remplacee', '🌿 Version végétale pour Enfant remplacée']]);
  assert.deepEqual(r.ecritures, [{ id: 'gratin-test', mode: 'versions', variantes: [VEG_ENFANT], attendus: { enfant: ['vegetal'] } }]);
  assert.deepEqual(r.demandesAClore, ['gratin-test__enfant']);
  // Écriture (même fusion que donnees.js) et affichage local : la version mer de l'enfant est partie.
  const ecrite = fusionnerVariantes(fiche.variantes, r.ecritures[0].variantes, { attendus: r.ecritures[0].attendus });
  assert.deepEqual(ecrite, [MER_B, VEG_ENFANT]);
  const [apres] = appliquerImport([fiche], r.ecritures);
  assert.deepEqual(apres.variantes, ecrite);
  const juge = evaluer(apres, ENFANT);
  assert.equal(juge.niveau, 'adaptable');
  assert.ok(juge.versions.every((x) => x.convient));
  assert.deepEqual(juge.manquants, []);
  // Réimporter la même végétale sur une fiche où la mer est restée (avant ce correctif) : elle part aussi.
  const resteMer = avecVersions(GRATIN, MER_ENFANT, VEG_ENFANT);
  const encore = importer([{ id: 'gratin-test', nom: 'Gratin test', variantes: [VEG_ENFANT] }], { plats: [resteMer] });
  assert.equal(encore.elements[0].statut, 'versions');
  assert.deepEqual(appliquerImport([resteMer], encore.ecritures)[0].variantes, [VEG_ENFANT]);
});

test('fiche complète « remplacer » : la version mer plus attendue part aussi', () => {
  const recu = { ...avecVersions(GRATIN, VEG_ENFANT), etapes: ['Autre façon.'] };
  const r = importer([recu], { plats: [avecVersions(GRATIN, ANCIENNE_SAUMON_ENFANT, MER_B)] });
  assert.equal(r.elements[0].statut, 'remplace');
  assert.deepEqual(r.ecritures[0].donnees.variantes, [VEG_ENFANT, MER_B]);
  assert.deepEqual(r.elements[0].versions.map((x) => x.libelle), ['🌿 Version végétale pour Enfant remplacée']);
});

test('versions seules : « à retirer » absent de la recette, nommé avec le style', () => {
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [{ ...VEG_CARBO, retirer: ['jambon'] }] }],
    { plats: [CARBONADE] });
  assert.ok(r.elements[0].avertissements.includes('Version végétale pour Adulte B\u00A0: «\u00A0jambon\u00A0» n’est pas dans la recette.'),
    r.elements[0].avertissements.join(' | '));
});

// ——— Ajout de recettes : fiches complètes ———

test('fiche complète d’un nouveau plat avec versions mer et végétale : gardées, jugées, libellées', () => {
  const demandes = [{ id: 'gratin-test__recette', statut: 'ouverte' }, { id: 'gratin-test__profil-b', statut: 'ouverte' }];
  const r = importer([avecVersions(GRATIN, MER_B, VEG_B, VEG_ENFANT)], { plats: [{ id: 'gratin-test', nom: 'Gratin test' }], demandes });
  assert.equal(r.elements[0].statut, 'complete');
  assert.deepEqual(r.ecritures[0].donnees.variantes, [MER_B, VEG_B, VEG_ENFANT]);
  assert.deepEqual(r.elements[0].versions.map((x) => x.libelle), [
    '🐟 Version mer pour Adulte B ajoutée',
    '🌿 Version végétale pour Adulte B ajoutée',
    '🌿 Version végétale pour Enfant ajoutée',
  ]);
  assert.deepEqual(r.demandesAClore, ['gratin-test__recette', 'gratin-test__profil-b']);
  assert.equal(contientVide(r.ecritures), false);
});

test('fiche complète qui remplace la recette : versions fusionnées par (profil, style)', () => {
  const recu = { ...avecVersions(GRATIN, VEG_B), etapes: ['Autre façon.'] };
  const r = importer([recu], { plats: [avecVersions(GRATIN, VEG_ENFANT, ANCIENNE_THON_B)] });
  assert.equal(r.elements[0].statut, 'remplace');
  assert.deepEqual(r.ecritures[0].donnees.variantes, [VEG_ENFANT, { ...ANCIENNE_THON_B, style: 'mer' }, VEG_B]);
});

// ——— Non-régression : versions sans style ———

test('profil sans styles attendus : versions sans style, libellés et corrections d’avant', () => {
  const navet = { id: 'profil-c', nom: 'Adulte C', ordre: 4, regles: [{ type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }] };
  const profils = [...PROFILS, navet];
  const pot = plat('pot-au-feu', 'Pot-au-feu', [ing('navet', 2, 'pc', ['legume'], { role: 'principal' }), ing('carotte', 3, 'pc', ['legume'], { role: 'principal' })]);
  const mauvaise = v('profil-c', ['carotte'], [ajout('pomme de terre', 1, 'pc', ['legume'], { role: 'principal' })]);
  const r = preparerImport(validerPaquet([paquet({ id: 'pot-au-feu', nom: 'Pot-au-feu', variantes: [mauvaise] })], { profils }).plats.map((p) => p.donnees),
    { plats: [pot], demandes: [], profils });
  assert.deepEqual(r.elements[0].versions, [{
    pour: 'profil-c', style: null, nom: 'Adulte C', action: 'ajoutee', convient: false, libelle: 'Version pour Adulte C ajoutée',
  }]);
  assert.deepEqual(r.corrections, [{
    id: 'pot-au-feu', pour: 'profil-c', style: null, message: 'La version pour Adulte C contient encore\u00A0: navet.',
    pourClaude: 'id pot-au-feu variantes[pour=profil-c] : contient navet, exclu pour profil-c',
  }]);
  const bonne = { ...mauvaise, retirer: ['navet'] };
  const ok = preparerImport(validerPaquet([paquet({ id: 'pot-au-feu', nom: 'Pot-au-feu', variantes: [bonne] })], { profils }).plats.map((p) => p.donnees),
    { plats: [avecVersions(pot, mauvaise)], demandes: [], profils });
  assert.deepEqual(ok.elements[0].versions.map((x) => x.libelle), ['Version pour Adulte C remplacée']);
  assert.deepEqual(ok.ecritures, [{ id: 'pot-au-feu', mode: 'versions', variantes: [bonne] }]);
});

test('demandesSatisfaites : close si au moins une version convient après fusion', () => {
  const ouvertes = new Set(['gratin-test__profil-b']);
  const mauvaise = { ...VEG_B, ajouter: [TOFU, BOUILLON] };
  assert.deepEqual(demandesSatisfaites('gratin-test', { variantes: [mauvaise] }, ouvertes,
    { plat: avecVersions(GRATIN, mauvaise), profils: PROFILS }), []);
  assert.deepEqual(demandesSatisfaites('gratin-test', { variantes: [mauvaise] }, ouvertes,
    { plat: avecVersions(GRATIN, MER_B, mauvaise), profils: PROFILS }), ['gratin-test__profil-b']);
});

// ——— Affichage local et annonce ———

test('appliquerImport : même fusion qu’à l’écriture ; versionsEcrites compte chaque version', () => {
  const ecritures = [{ id: 'gratin-test', mode: 'versions', variantes: [MER_B, VEG_ENFANT] }];
  const [apres] = appliquerImport([avecVersions(GRATIN, ANCIENNE_TOFU_B)], ecritures);
  assert.deepEqual(apres.variantes, [{ ...ANCIENNE_TOFU_B, style: 'vegetal' }, MER_B, VEG_ENFANT]);
  const deux = [{ id: 'gratin-test', mode: 'versions', variantes: [MER_B, VEG_B] }, { id: 'autre', mode: 'versions', variantes: [MER_B] }];
  assert.equal(versionsEcrites(deux, 'profil-b'), 3);
  assert.equal(versionsEcrites(deux, 'profil-b', ['autre']), 2);
});

test('annonceVersions : plats à compléter annoncés seulement s’ils sont donnés', () => {
  assert.equal(annonceVersions([{ nom: 'Adulte B', ajoutees: 2, restants: 0, aCompleter: 3 }]),
    '2 versions ajoutées. Plus aucun plat n’attend de version pour Adulte B. 3 plats à compléter pour Adulte B.');
  assert.equal(annonceVersions([{ nom: 'Adulte B', ajoutees: 1, restants: 2, aCompleter: 1 }]),
    '1 version ajoutée. 2 plats attendent encore une version pour Adulte B. 1 plat à compléter pour Adulte B.');
  assert.equal(annonceVersions([{ nom: 'Adulte B', ajoutees: 1, restants: 2, aCompleter: 0 }]),
    '1 version ajoutée. 2 plats attendent encore une version pour Adulte B.');
  assert.equal(annonceVersions([{ nom: 'Adulte B', ajoutees: 1, restants: 2 }]),
    '1 version ajoutée. 2 plats attendent encore une version pour Adulte B.');
});

// ——— Sauvegarde ———

function relue(etat) {
  const sauvegarde = creerSauvegarde(etat);
  return { ...sauvegarde, validation: validerSauvegarde(lireSauvegarde(sauvegarde.texte).sauvegarde) };
}

test('sauvegarde : style et jours au frigo des versions, aller-retour sans perte', () => {
  const fiche = avecVersions(GRATIN, MER_B, VEG_B, VEG_ENFANT);
  const etat = { plats: [fiche], profils: clone(PROFILS) };
  const { texte, aCorriger, validation } = relue(etat);
  assert.deepEqual(aCorriger, []);
  const fichier = JSON.parse(texte);
  assert.deepEqual(fichier.plats[0].variantes, [MER_B, VEG_B, VEG_ENFANT]);
  assert.match(texte, /"style": "mer"/);
  assert.match(texte, /"frigoJours": 2/);
  assert.deepEqual(validation.plats[0].recette.variantes, [MER_B, VEG_B, VEG_ENFANT]);
  assert.deepEqual(validation.avertissements, []);
  // La même base relue ne prévoit aucune écriture.
  assert.equal(preparerRestauration(validation, { ...etat, demandes: [] }).rien, true);
});

test('sauvegarde : une fiche fusionnée (version mer déduite, sans jours au frigo) reste restaurable', () => {
  const fiche = avecVersions(GRATIN, ...fusionnerVariantes([ANCIENNE_THON_B], [VEG_B]));
  const { aCorriger, validation } = relue({ plats: [fiche], profils: clone(PROFILS) });
  assert.deepEqual(aCorriger, []);
  assert.deepEqual(validation.plats[0].recette.variantes, fiche.variantes);
  // Versions d'avant les styles : exportées et relues sans style (il se déduit à la lecture).
  const ancienne = relue({ plats: [avecVersions(GRATIN, ANCIENNE_TOFU_B)], profils: clone(PROFILS) });
  assert.deepEqual(ancienne.validation.plats[0].recette.variantes, [ANCIENNE_TOFU_B]);
});

test('sauvegarde : deux versions du même style pour un profil, la première gardée', () => {
  const fiche = avecVersions(GRATIN, MER_B, { ...MER_B, consigne: 'Doublon.' });
  const { aCorriger, validation } = relue({ plats: [fiche], profils: clone(PROFILS) });
  assert.deepEqual(aCorriger, []);
  assert.deepEqual(validation.plats[0].recette.variantes, [MER_B]);
});

test('restauration : les versions d’un profil absent de la fiche reviennent toutes, avec style et jours au frigo', () => {
  const { validation } = relue({ plats: [avecVersions(GRATIN, MER_B, VEG_B, VEG_ENFANT)], profils: clone(PROFILS) });
  const app = { plats: [clone(GRATIN)], profils: clone(PROFILS), demandes: [{ id: 'gratin-test__profil-b', statut: 'ouverte' }] };
  const r = preparerRestauration(validation, app);
  const [ecriture] = r.lots.flat();
  assert.deepEqual(ecriture.donnees, { variantes: [MER_B, VEG_B, VEG_ENFANT] });
  assert.deepEqual(ecriture.condition, { variantesAbsentes: ['profil-b', 'enfant'] });
  assert.deepEqual(r.resume.versionsRemises, [{ pour: 'profil-b', nom: 'Adulte B', nombre: 2 }, { pour: 'enfant', nom: 'Enfant', nombre: 1 }]);
  assert.deepEqual(r.demandesAClore, ['gratin-test__profil-b']);
  // À l'envoi : une version de l'enfant posée entre-temps gagne ; celles de profil-b partent.
  const envoi = appliquerConditions(ecriture, avecVersions(GRATIN, { ...VEG_ENFANT, consigne: 'Posée ailleurs.' }));
  assert.deepEqual(envoi.donnees.variantes.map((x) => [x.pour, x.style, x.consigne]), [
    ['enfant', 'vegetal', 'Posée ailleurs.'],
    ['profil-b', 'mer', 'Part au saumon.'],
    ['profil-b', 'vegetal', 'Part au tofu.'],
  ]);
  assert.equal(envoi.donnees.variantes[1].frigoJours, 2);
  // Tout est déjà sur la fiche : rien à écrire.
  assert.equal(preparerRestauration(validation, { ...app, plats: [avecVersions(GRATIN, MER_B, VEG_B, VEG_ENFANT)] }).rien, true);
});

test('restauration : mer présente, végétale perdue → la végétale revient, la mer de la fiche reste', () => {
  const { validation } = relue({ plats: [avecVersions(GRATIN, MER_B, VEG_B, VEG_ENFANT)], profils: clone(PROFILS) });
  const merAutre = { ...MER_B, consigne: 'Mer de la fiche.' };
  const app = { plats: [avecVersions(GRATIN, merAutre, VEG_ENFANT)], profils: clone(PROFILS), demandes: [] };
  const r = preparerRestauration(validation, app);
  assert.equal(r.rien, false);
  // Recette identique (comparée sans ses versions) : rien à cocher.
  assert.deepEqual(r.recettesDifferentes, []);
  const [ecriture] = r.lots.flat();
  assert.deepEqual(ecriture.donnees, { variantes: [merAutre, VEG_ENFANT, VEG_B] });
  assert.deepEqual(ecriture.condition, { stylesAbsents: [{ pour: 'profil-b', style: 'vegetal' }] });
  assert.deepEqual(r.resume.versionsRemises, [{ pour: 'profil-b', nom: 'Adulte B', nombre: 1 }]);
  // À l'envoi : relue telle quelle, la végétale part ; une végétale posée entre-temps (même d'avant les styles) gagne.
  assert.deepEqual(appliquerConditions(ecriture, app.plats[0]).donnees.variantes, [merAutre, VEG_ENFANT, VEG_B]);
  assert.equal(appliquerConditions(ecriture, avecVersions(GRATIN, merAutre, { ...VEG_B, consigne: 'Posée ailleurs.' })), null);
  assert.equal(appliquerConditions(ecriture, avecVersions(GRATIN, merAutre, ANCIENNE_TOFU_B)), null);
  // Une version mer perdue revient de même quand la végétale est restée.
  const sansMer = preparerRestauration(validation, { ...app, plats: [avecVersions(GRATIN, VEG_B, VEG_ENFANT)] });
  assert.deepEqual(sansMer.lots.flat()[0].donnees.variantes, [VEG_B, VEG_ENFANT, MER_B]);
});

test('restauration : jamais une version d’un style que le profil n’attend pas, ni une version sans style à côté d’une autre', () => {
  // L'enfant (« Ni viande ni poisson ») a sa végétale : sa version mer de la sauvegarde ne revient pas.
  const { validation } = relue({ plats: [avecVersions(GRATIN, MER_ENFANT, VEG_B)], profils: clone(PROFILS) });
  assert.equal(preparerRestauration(validation, { plats: [avecVersions(GRATIN, VEG_ENFANT, VEG_B)], profils: clone(PROFILS), demandes: [] }).rien, true);
  // Dessert : « Pas de viande » n'attend pas de version mer.
  const dessert = { ...GRATIN, type: 'dessert' };
  const sauvegardeDessert = relue({ plats: [avecVersions(dessert, MER_B, VEG_B)], profils: clone(PROFILS) }).validation;
  assert.equal(preparerRestauration(sauvegardeDessert, { plats: [avecVersions(dessert, VEG_B)], profils: clone(PROFILS), demandes: [] }).rien, true);
  // Version d'avant les styles dans la sauvegarde, profil qui a déjà une version : elle ne revient pas (elle serait
  // la seule de son profil), comme avant les styles.
  const ancienne = relue({ plats: [avecVersions(GRATIN, ANCIENNE_TOFU_B)], profils: clone(PROFILS) }).validation;
  assert.equal(preparerRestauration(ancienne, { plats: [avecVersions(GRATIN, MER_B)], profils: clone(PROFILS), demandes: [] }).rien, true);
});

// ——— Fichiers ———

test('aucune espace insécable écrite telle quelle dans les fichiers des versions par style', async () => {
  for (const fichier of ['../js/coeur/paquet.js', '../js/coeur/sauvegarde.js', '../js/coeur/import-local.js', './coeur-styles-import.test.js']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});
