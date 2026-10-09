// T2c-2 « Repères à la main » : cases « Repères » de « Modifier » (coeur/edition.js), repères devinés d'après le nom et
// bandeau « à vérifier » (coeur/compatibilite.js). Fixtures génériques (aucune donnée du foyer) ; dates calculées depuis
// une date de référence fixe.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOCABULAIRES } from '../js/coeur/vocabulaire.js';
import { MOTS_DOUTEUX, reperesAttendus, marqueursDouteux } from '../js/coeur/compatibilite.js';
import { ecrireRegime, marqueursSurveilles } from '../js/coeur/regles.js';
import { reglesSelonAge, basculerPrecaution, precautionsAge } from '../js/coeur/age.js';
import {
  CASES_REPERES, MARQUEURS_PRECAUTION, MARQUEURS_PREPARATION, NATURES, casesPour, appliquerCase, reperesProposes,
  natureProposee, ingredientSaisi, marqueursDeDepart, catalogueProduits, normaliserPourEdition, preparerModification,
} from '../js/coeur/edition.js';

// ——— Fixtures ———

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

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const reglesAge = (mois) => reglesSelonAge(neIlYA(mois), REF, []).regles;
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
/** Enfant de 30 mois, œufs crus éteints. */
const ENFANT_30 = {
  id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, naissance: neIlYA(30),
  regles: basculerPrecaution(reglesAge(30), 'oeuf_cru', false),
};
/** Marqueurs surveillés : régime sans viande + précautions d'un enfant de 30 mois (sans œuf cru ni miel). */
const SURVEILLES = marqueursSurveilles([ADULTE_A, ADULTE_B, ENFANT_30]);
/** Régime sans viande seul. */
const REGIME_SEUL = marqueursSurveilles([ADULTE_A, ADULTE_B]);
/** Personne n'a de règle. */
const AUCUN = new Set();

const ids = (cases) => cases.map((c) => c.id);
const cochees = (cases) => cases.filter((c) => c.coche).map((c) => c.id);

/** Vrai si la valeur contient undefined, à quelque profondeur que ce soit. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientUndefined);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientUndefined);
  return false;
}

// ——— CASES_REPERES et MARQUEURS_PRECAUTION ———

test('CASES_REPERES : ids uniques, marqueurs du vocabulaire, libellés de 26 caractères au plus, natures connues', () => {
  assert.equal(new Set(ids(CASES_REPERES)).size, CASES_REPERES.length);
  for (const definition of CASES_REPERES) {
    for (const marqueur of [...definition.pose, ...definition.retire]) {
      assert.ok(VOCABULAIRES.marqueurs.includes(marqueur), `${definition.id} : ${marqueur}`);
    }
    assert.ok(definition.libelle.length > 0 && definition.libelle.length <= 26, definition.libelle);
    assert.ok(definition.pose.length > 0 && definition.natures.length > 0, definition.id);
    // Décocher retire au moins ce que cocher pose : une case cochée puis décochée ne laisse rien.
    assert.ok(definition.pose.every((m) => definition.retire.includes(m)), definition.id);
    assert.ok(definition.natures.every((n) => Object.hasOwn(NATURES, n)), definition.id);
  }
  // Les repères de T2a deviennent des cases.
  assert.deepEqual(ids(CASES_REPERES).filter((id) => ['bouillon_viande', 'gelatine', 'graisse_animale'].includes(id)),
    ['bouillon_viande', 'gelatine', 'graisse_animale']);
});

test('MARQUEURS_PRECAUTION : union des `retire`, sans doublon, dans l’ordre des cases (pour T2d)', () => {
  assert.deepEqual(MARQUEURS_PRECAUTION, [...new Set(CASES_REPERES.flatMap((c) => c.retire))]);
  assert.equal(new Set(MARQUEURS_PRECAUTION).size, MARQUEURS_PRECAUTION.length);
  for (const marqueur of ['cru', 'lait_cru', 'fruit_coque', 'cafe', 'cafeine', 'miel', 'poisson_predateur', 'soja',
    'oeuf_cru', 'alcool_cru', 'bouillon_viande', 'gelatine_animale', 'gelatine_porc', 'graisse_animale']) {
    assert.ok(MARQUEURS_PRECAUTION.includes(marqueur), marqueur);
  }
  assert.ok(!MARQUEURS_PRECAUTION.includes('viande'), 'une nature, pas une case');
  // Les repères de préparation ont tous leur case.
  assert.ok(MARQUEURS_PREPARATION.every((m) => MARQUEURS_PRECAUTION.includes(m)));
});

// ——— casesPour ———

test('casesPour : cases de la nature de l’ingrédient, quand rien ne filtre', () => {
  assert.deepEqual(ids(casesPour(viande('bœuf', ['viande', 'boeuf']))), ['cru_viande', 'graisse_animale']);
  assert.deepEqual(ids(casesPour(ing('cabillaud', ['poisson']))), ['cru_poisson', 'poisson_predateur']);
  assert.deepEqual(ids(casesPour(ing('crevettes', ['fruits_de_mer']))), ['cru_poisson', 'poisson_predateur']);
  assert.deepEqual(ids(casesPour(ing('fromage', ['laitier']))),
    ['lait_cru', 'fruit_coque', 'cafeine', 'alcool_cru', 'oeuf_cru', 'miel', 'soja', 'bouillon_viande', 'gelatine', 'graisse_animale']);
  assert.deepEqual(casesPour(ing('courgette', ['legume'], { role: 'incorpore' })), []);
  // Nature imposée (choisie à l'écran, pas encore appliquée aux marqueurs).
  assert.deepEqual(ids(casesPour(ing('saumon', []), { nature: 'poisson' })), ['cru_poisson', 'poisson_predateur']);
  assert.deepEqual(ids(casesPour(ing('saumon', []), { nature: 'inconnue' })), ids(casesPour(ing('saumon', []))));
  // Entrées abîmées.
  assert.deepEqual(ids(casesPour(null)), ids(casesPour(ing('x', []))));
  assert.deepEqual(ids(casesPour({ marqueurs: 'cru' })), ids(casesPour(ing('x', []))));
});

test('casesPour : une case qu’aucune règle active ne surveille est cachée ; rien du tout sans règle', () => {
  // Régime + enfant de 30 mois : œuf cru éteint, miel passé (12 mois), alcool et café surveillés.
  assert.deepEqual(ids(casesPour(ing('fromage', ['laitier']), { surveilles: SURVEILLES })),
    ['lait_cru', 'fruit_coque', 'cafeine', 'alcool_cru', 'soja', 'bouillon_viande', 'gelatine', 'graisse_animale']);
  assert.deepEqual(ids(casesPour(viande('bœuf', ['viande', 'boeuf']), { surveilles: SURVEILLES })), ['cru_viande', 'graisse_animale']);
  assert.deepEqual(ids(casesPour(ing('cabillaud', ['poisson']), { surveilles: SURVEILLES })), ['cru_poisson', 'poisson_predateur']);
  // Régime seul : les repères de T2a seulement.
  assert.deepEqual(ids(casesPour(ing('fromage', ['laitier']), { surveilles: REGIME_SEUL })), ['bouillon_viande', 'gelatine', 'graisse_animale']);
  assert.deepEqual(ids(casesPour(ing('cabillaud', ['poisson']), { surveilles: REGIME_SEUL })), []);
  // Personne n'a de règle : aucune case (rien d'affiché).
  assert.deepEqual(casesPour(ing('fromage', ['laitier']), { surveilles: AUCUN }), []);
  // Une liste vaut un Set.
  assert.deepEqual(ids(casesPour(ing('fromage', []), { surveilles: ['miel'] })), ['miel']);
  // Une règle sur l'ancien marqueur suffit à montrer sa case (`gelatine_porc` → « Gélatine animale »).
  assert.deepEqual(ids(casesPour(ing('fromage', []), { surveilles: new Set(['gelatine_porc']) })), ['gelatine']);
});

test('casesPour : une case déjà cochée reste montrée sous une autre nature, une seule fois', () => {
  // Passage de « Poisson » à « Autre » : le `cru` resté se voit et se décoche (une seule case « cru »).
  const cases = casesPour(ing('saumon', ['cru']), { surveilles: AUCUN });
  assert.deepEqual(cases, [{ id: 'cru_viande', libelle: 'Crue ou rosée', coche: true }]);
  // Sous sa nature, la case de la nature seule (pas aussi « Cru » d'un poisson).
  assert.deepEqual(ids(casesPour(ing('saumon', ['poisson', 'cru']), { surveilles: AUCUN })), ['cru_poisson']);
  assert.deepEqual(ids(casesPour(viande('bœuf', ['viande', 'cru']), { surveilles: AUCUN })), ['cru_viande']);
  // Un repère d'« Autre » sur une viande, non surveillé : montré quand même (décochable).
  assert.deepEqual(casesPour(viande('bœuf', ['viande', 'lait_cru']), { surveilles: AUCUN }),
    [{ id: 'lait_cru', libelle: 'Au lait cru', coche: true }]);
  // Légume : rien, sauf un repère présent.
  assert.deepEqual(ids(casesPour(ing('poivron', ['legume', 'miel'], { role: 'incorpore' }), { surveilles: SURVEILLES })), ['miel']);
});

test('casesPour : `coche` lu sur les marqueurs effectifs (`cafe` coche « Café, thé, cola », `gelatine_porc` « Gélatine animale »)', () => {
  const cafe = casesPour(ing('café', ['cafe']), { surveilles: SURVEILLES });
  assert.deepEqual(cafe.find((c) => c.id === 'cafeine'), { id: 'cafeine', libelle: 'Café, thé, cola', coche: true });
  assert.deepEqual(cochees(cafe), ['cafeine']);
  const gelatine = casesPour(ing('gélatine', ['gelatine_porc']), { surveilles: SURVEILLES });
  assert.deepEqual(cochees(gelatine), ['gelatine']);
  // Montrées même sans règle, puisqu'elles sont cochées.
  assert.deepEqual(casesPour(ing('café', ['cafe']), { surveilles: AUCUN }), [{ id: 'cafeine', libelle: 'Café, thé, cola', coche: true }]);
  assert.deepEqual(casesPour(ing('gélatine', ['gelatine_porc']), { surveilles: AUCUN }),
    [{ id: 'gelatine', libelle: 'Gélatine animale', coche: true }]);
  // `poisson_predateur` sans `poisson` : la case reste montrée et cochée (la nature lue est « Autre »).
  assert.deepEqual(cochees(casesPour(ing('espadon', ['poisson_predateur']), { surveilles: SURVEILLES })), ['poisson_predateur']);
});

// ——— appliquerCase ———

test('appliquerCase : cocher ajoute `pose` à la fin ; déjà cochée, rien ne change', () => {
  assert.deepEqual(appliquerCase(['laitier'], 'lait_cru', true), ['laitier', 'lait_cru']);
  assert.deepEqual(appliquerCase(['viande', 'boeuf'], 'cru_viande', true), ['viande', 'boeuf', 'cru']);
  assert.deepEqual(appliquerCase([], 'gelatine', true), ['gelatine_animale']);
  // Déjà cochée par un marqueur équivalent : `cafe` reste `cafe`, `gelatine_porc` reste `gelatine_porc`.
  assert.deepEqual(appliquerCase(['cafe'], 'cafeine', true), ['cafe']);
  assert.deepEqual(appliquerCase(['gelatine_porc'], 'gelatine', true), ['gelatine_porc']);
  assert.deepEqual(appliquerCase(['poisson', 'cru'], 'cru_poisson', true), ['poisson', 'cru']);
  // Deux cases « cru » : la seconde ne double pas le marqueur.
  assert.deepEqual(appliquerCase(appliquerCase(['viande'], 'cru_viande', true), 'cru_poisson', true), ['viande', 'cru']);
});

test('appliquerCase : décocher retire tout `retire` (paire gélatine, `cafe` et `cafeine`) ; les autres restent', () => {
  assert.deepEqual(appliquerCase(['oeuf', 'gelatine_porc', 'laitier', 'gelatine_animale'], 'gelatine', false), ['oeuf', 'laitier']);
  assert.deepEqual(appliquerCase(['cafe', 'laitier', 'cafeine'], 'cafeine', false), ['laitier']);
  assert.deepEqual(appliquerCase(['viande', 'cru', 'boeuf'], 'cru_viande', false), ['viande', 'boeuf']);
  // Décocher une case non cochée : rien ne change.
  assert.deepEqual(appliquerCase(['laitier', 'feculent'], 'miel', false), ['laitier', 'feculent']);
});

test('appliquerCase : ordre stable, sans doublon, sans undefined ; case inconnue sans effet ; entrée intacte', () => {
  const entree = ['laitier', 'laitier', undefined, 'cafe', null, '', 'feculent'];
  const copie = [...entree];
  const resultat = appliquerCase(entree, 'miel', true);
  assert.deepEqual(resultat, ['laitier', 'cafe', 'feculent', 'miel']);
  assert.ok(!contientUndefined(resultat));
  assert.deepEqual(entree, copie, 'la liste reçue n’est pas modifiée');
  assert.notEqual(appliquerCase(['laitier'], 'inconnue', true), entree);
  assert.deepEqual(appliquerCase(['laitier', 'laitier'], 'inconnue', true), ['laitier']);
  assert.deepEqual(appliquerCase(['laitier'], 'toString', true), ['laitier']);
  assert.deepEqual(appliquerCase(null, 'soja', true), ['soja']);
  assert.deepEqual(appliquerCase(undefined, 'soja', false), []);
});

// ——— reperesAttendus (mots du nom) ———

test('reperesAttendus : « jambon cru » → viande et cru ; plusieurs repères, sans doublon', () => {
  assert.deepEqual(reperesAttendus('jambon cru'), ['viande', 'cru']);
  assert.deepEqual(reperesAttendus('Jambon de Bayonne'), ['viande', 'cru']);
  assert.deepEqual(reperesAttendus('jambon de Parme'), ['viande', 'cru']);
  assert.deepEqual(reperesAttendus('carpaccio de bœuf'), ['viande', 'cru']);
  assert.deepEqual(reperesAttendus('jambon blanc'), ['viande']);
  assert.deepEqual(reperesAttendus('huîtres'), ['cru']);
  assert.deepEqual(reperesAttendus('saumon gravlax'), ['cru']);
  assert.deepEqual(reperesAttendus('noix'), ['fruit_coque']);
  assert.deepEqual(reperesAttendus('cacahuètes grillées'), ['fruit_coque']);
  assert.deepEqual(reperesAttendus('café fort'), ['cafeine']);
  assert.deepEqual(reperesAttendus('thé vert'), ['cafeine']);
  assert.deepEqual(reperesAttendus('coca-cola'), ['cafeine']);
  assert.deepEqual(reperesAttendus('miel de fleurs'), ['miel']);
  assert.deepEqual(reperesAttendus('espadon'), ['poisson_predateur']);
  assert.deepEqual(reperesAttendus('pavé de requin'), ['poisson_predateur']);
  for (const nom of ['tofu fumé', 'tempeh', 'lait de soja', 'edamames', 'pâte de miso']) {
    assert.deepEqual(reperesAttendus(nom), ['soja'], nom);
  }
  // Mot entier seulement : « menthe » n'est pas du thé, « porcini » pas du porc.
  assert.deepEqual(reperesAttendus('menthe'), []);
  assert.deepEqual(reperesAttendus('porcini'), []);
  assert.deepEqual(reperesAttendus(''), []);
  assert.deepEqual(reperesAttendus(null), []);
});

test('reperesAttendus : fruits à coque, les mots `sauf` annulent la ligne (« noix de coco », « beurre noisette »…)', () => {
  for (const nom of ['noix de coco', 'poudre d’amande', "poudre d'amandes", 'noix de Saint-Jacques', 'pommes noisettes',
    'beurre noisette', 'noix de muscade', 'purée de noisettes', 'pâte d’amande', 'lait d’amande', 'huile de noix',
    'beurre de cacahuète', 'noix de pétoncle']) {
    assert.ok(!reperesAttendus(nom).includes('fruit_coque'), nom);
  }
  // Viande, pas de fruits à coque.
  assert.deepEqual(reperesAttendus('noix de veau'), ['viande']);
  assert.deepEqual(reperesAttendus('noix de jambon'), ['viande']);
  assert.deepEqual(reperesAttendus('noisette d’agneau'), ['viande']);
  // Entiers ou en morceaux : comptés.
  assert.deepEqual(reperesAttendus('amandes effilées'), ['fruit_coque']);
  assert.deepEqual(reperesAttendus('noisettes concassées'), ['fruit_coque']);
});

test('reperesAttendus : sauce soja jamais soja ; sauce tartare et riz à sushi jamais crus ; tartare de saumon cru', () => {
  assert.deepEqual(reperesAttendus('sauce soja'), []);
  assert.deepEqual(reperesAttendus('sauce soja sucrée'), []);
  // Haricots mungo, appelés « pousses de soja » ou « germes de soja ».
  assert.deepEqual(reperesAttendus('pousses de soja'), []);
  assert.deepEqual(reperesAttendus('germes de soja'), []);
  assert.deepEqual(reperesAttendus('tartare de saumon'), ['cru']);
  assert.deepEqual(reperesAttendus('steak tartare'), ['cru']);
  assert.deepEqual(reperesAttendus('sauce tartare'), []);
  assert.deepEqual(reperesAttendus('riz à sushi'), []);
  assert.deepEqual(reperesAttendus('vinaigre de riz pour sushi'), []);
  assert.deepEqual(reperesAttendus('fromage Tartare ail et fines herbes'), []);
});

test('reperesAttendus : jamais de lait cru ni d’alcool non cuit ; « fumet de poisson » toujours rien', () => {
  assert.deepEqual(reperesAttendus('reblochon au lait cru'), []);
  assert.deepEqual(reperesAttendus('camembert au lait cru'), []);
  assert.deepEqual(reperesAttendus('vin rouge'), []);
  assert.deepEqual(reperesAttendus('rhum'), []);
  assert.ok(!MOTS_DOUTEUX.some((e) => e.attendu === 'lait_cru' || e.attendu === 'alcool_cru'));
  assert.deepEqual(reperesAttendus('fumet de poisson'), []);
  assert.deepEqual(reperesAttendus('gélatine végétale'), []);
  // Le premier de la nature l'emporte encore (T2a).
  assert.deepEqual(reperesAttendus('bouillon de bœuf'), ['bouillon_viande']);
  assert.deepEqual(reperesAttendus('graisse de canard'), ['graisse_animale']);
});

test('MOTS_DOUTEUX : repères du vocabulaire, mots et `sauf` lisibles', () => {
  for (const entree of MOTS_DOUTEUX) {
    assert.ok(VOCABULAIRES.marqueurs.includes(entree.attendu), entree.attendu);
    assert.ok(entree.mots.length > 0);
    for (const mot of [...entree.mots, ...(entree.sauf ?? []), ...(entree.apres ?? [])]) {
      assert.match(mot, /^[a-z]+( [a-z]+)*$/, `${entree.attendu} : « ${mot} » (sans accents, en minuscules)`);
    }
  }
});

// ——— reperesProposes et natureProposee ———

test('reperesProposes : repères d’une case surveillée, jamais `viande` ; produit connu : préparation seulement', () => {
  assert.deepEqual(reperesProposes('jambon cru'), ['cru']);
  assert.deepEqual(reperesProposes('jambon cru', { surveilles: SURVEILLES }), ['cru']);
  assert.deepEqual(reperesProposes('jambon cru', { surveilles: REGIME_SEUL }), []);
  assert.deepEqual(reperesProposes('noix', { surveilles: SURVEILLES }), ['fruit_coque']);
  assert.deepEqual(reperesProposes('noix', { surveilles: SURVEILLES, connu: true }), []);
  assert.deepEqual(reperesProposes('jambon cru', { surveilles: SURVEILLES, connu: true }), ['cru']);
  // Miel : la précaution est passée pour un enfant de 30 mois.
  assert.deepEqual(reperesProposes('miel', { surveilles: SURVEILLES }), []);
  assert.deepEqual(reperesProposes('bouillon de volaille', { surveilles: REGIME_SEUL }), ['bouillon_viande']);
  assert.deepEqual(reperesProposes('lardons', { surveilles: SURVEILLES }), []);
  assert.deepEqual(reperesProposes('courgette'), []);
});

test('natureProposee : nature et repères proposés ; produit connu : seuls ses repères de préparation', () => {
  const s = { surveilles: SURVEILLES };
  assert.deepEqual(natureProposee('noix', [], s), { nature: 'autre', reperes: ['fruit_coque'] });
  assert.deepEqual(natureProposee('jambon cru', [], s), { nature: 'viande', reperes: ['cru'] });
  assert.deepEqual(natureProposee('saucisson sec', [], s), { nature: 'viande', reperes: ['cru'] });
  // Viande ou poisson ? Le nom ne le dit pas : rien de présélectionné, mais le repère est proposé.
  assert.deepEqual(natureProposee('tartare de saumon', [], s), { nature: null, reperes: ['cru'] });
  assert.deepEqual(natureProposee('espadon', [], s), { nature: 'poisson', reperes: ['poisson_predateur'] });
  assert.deepEqual(natureProposee('tofu', [], s), { nature: 'autre', reperes: ['soja'] });
  assert.deepEqual(natureProposee('café', [], s), { nature: 'autre', reperes: ['cafeine'] });
  // Repère non surveillé : la nature reste proposée, sans repère.
  assert.deepEqual(natureProposee('miel', [], s), { nature: 'autre', reperes: [] });
  assert.deepEqual(natureProposee('noix', [], { surveilles: REGIME_SEUL }), { nature: 'autre', reperes: [] });
  assert.equal(natureProposee('tartare de saumon', [], { surveilles: REGIME_SEUL }), null);
  assert.equal(natureProposee('courgette', [], s), null);
  assert.equal(natureProposee('sauce soja', [], s), null);
  // Produit connu : sa nature vient du catalogue.
  const catalogue = [{ produit: 'Jambon cru', marqueurs: ['viande', 'porc', 'charcuterie'] }, { produit: 'noix', marqueurs: [] }];
  assert.deepEqual(natureProposee('jambon cru', catalogue, s), { nature: null, reperes: ['cru'] });
  assert.equal(natureProposee('noix', catalogue, s), null);
  assert.equal(natureProposee('jambon cru', catalogue, { surveilles: AUCUN }), null);
});

// ——— ingredientSaisi ———

const champs = (extra) => ({ qte: '1', unite: 'pc', rayon: '', nature: '', forme: '', role: '', ...extra });

test('ingredientSaisi : seules les cases changées s’appliquent (`cafe` et `gelatine_porc` intacts)', () => {
  const ingredients = [ing('café', ['cafe', 'laitier']), ing('gélatine', ['gelatine_porc']), ing('crème', ['laitier'])];
  const options = (index) => ({ ingredients, index, surveilles: SURVEILLES });
  // Une autre case touchée : `cafe` reste `cafe` (pas de `cafeine` ajouté ni de `cafe` retiré).
  const cafe = ingredientSaisi(champs({ produit: 'café', reperes: [{ caseId: 'alcool_cru', coche: true }] }), options(0)).ingredient;
  assert.deepEqual(cafe.marqueurs, ['cafe', 'laitier', 'alcool_cru']);
  const gelatine = ingredientSaisi(champs({ produit: 'gélatine', reperes: [{ caseId: 'miel', coche: false }] }), options(1)).ingredient;
  assert.deepEqual(gelatine.marqueurs, ['gelatine_porc']);
  // Aucun changement : marqueurs identiques, dans le même ordre.
  assert.deepEqual(ingredientSaisi(champs({ produit: 'café' }), options(0)).ingredient.marqueurs, ['cafe', 'laitier']);
  assert.deepEqual(ingredientSaisi(champs({ produit: 'café', reperes: [] }), options(0)).ingredient.marqueurs, ['cafe', 'laitier']);
  // Une case renvoyée cochée alors qu'elle l'est déjà : rien ne change.
  assert.deepEqual(ingredientSaisi(champs({ produit: 'café', reperes: [{ caseId: 'cafeine', coche: true }] }), options(0))
    .ingredient.marqueurs, ['cafe', 'laitier']);
  // Décochée : les deux formes partent.
  assert.deepEqual(ingredientSaisi(champs({ produit: 'café', reperes: [{ caseId: 'cafeine', coche: false }] }), options(0))
    .ingredient.marqueurs, ['laitier']);
  assert.deepEqual(ingredientSaisi(champs({ produit: 'gélatine', reperes: [{ caseId: 'gelatine', coche: false }] }), options(1))
    .ingredient.marqueurs, []);
  // Cocher « Au lait cru » sur la crème.
  assert.deepEqual(ingredientSaisi(champs({ produit: 'crème', reperes: [{ caseId: 'lait_cru', coche: true }] }), options(2))
    .ingredient.marqueurs, ['laitier', 'lait_cru']);
});

test('ingredientSaisi : changements dans l’ordre des touchers ; changements illisibles ignorés', () => {
  const ingredients = [viande('bœuf', ['viande', 'boeuf'])];
  const saisir = (reperes) => ingredientSaisi(champs({ produit: 'bœuf', reperes }), { ingredients, index: 0 }).ingredient.marqueurs;
  assert.deepEqual(saisir([{ caseId: 'cru_viande', coche: true }, { caseId: 'cru_viande', coche: false }]), ['viande', 'boeuf']);
  assert.deepEqual(saisir([{ caseId: 'cru_viande', coche: false }, { caseId: 'cru_viande', coche: true }]), ['viande', 'boeuf', 'cru']);
  // Anciens repères de T2a (liste de marqueurs), case inconnue, `coche` non booléen : ignorés.
  assert.deepEqual(saisir(['cru', null, { caseId: 'inconnue', coche: true }, { caseId: 'cru_viande', coche: 'oui' },
    { caseId: 'toString', coche: true }]), ['viande', 'boeuf']);
  assert.deepEqual(saisir('cru'), ['viande', 'boeuf']);
});

test('ingredientSaisi : produit connu « jambon cru » → cru proposé ; ses autres repères viennent du catalogue', () => {
  const plats = [plat('salade', [viande('jambon cru', ['viande', 'porc', 'charcuterie', 'cru'], { forme: 'fine' }),
    ing('noix', [])])];
  const catalogue = catalogueProduits(plats);
  const saisir = (produit, options = {}) => ingredientSaisi(champs({ produit, unite: 'tranche', ...options.champs }),
    { catalogue, surveilles: SURVEILLES, ...options.opts });
  // Le catalogue ne garde jamais `cru` (T2c-1) ; le nom l'annonce : proposé coché.
  assert.deepEqual(saisir('Jambon cru').ingredient.marqueurs, ['viande', 'porc', 'charcuterie', 'cru']);
  assert.equal(saisir('Jambon cru').ingredient.forme, 'fine');
  // Décoché par la personne : il ne revient pas.
  assert.deepEqual(saisir('jambon cru', { champs: { reperes: [{ caseId: 'cru_viande', coche: false }] } }).ingredient.marqueurs,
    ['viande', 'porc', 'charcuterie']);
  // Non surveillé : pas proposé.
  assert.deepEqual(saisir('jambon cru', { opts: { surveilles: REGIME_SEUL } }).ingredient.marqueurs, ['viande', 'porc', 'charcuterie']);
  // Produit connu : `fruit_coque` est une propriété du produit, pas un repère de préparation : rien n'est ajouté.
  assert.deepEqual(saisir('noix').ingredient.marqueurs, []);
  // L'ingrédient modifié lui-même (même produit) garde ce qu'il porte, sans proposition.
  const ingredients = [viande('jambon cru', ['viande', 'porc', 'charcuterie'], { forme: 'fine' })];
  assert.deepEqual(saisir('jambon cru', { opts: { ingredients, index: 0 } }).ingredient.marqueurs, ['viande', 'porc', 'charcuterie']);
});

test('ingredientSaisi : produit jamais vu, repères proposés posés ; décochés, absents ; filtrés par les règles', () => {
  const noix = ingredientSaisi(champs({ produit: 'Noix', unite: 'g', nature: 'autre' }), { surveilles: SURVEILLES }).ingredient;
  assert.deepEqual(noix, { produit: 'noix', qte: 1, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['fruit_coque'] });
  assert.deepEqual(ingredientSaisi(champs({ produit: 'noix', nature: 'autre', reperes: [{ caseId: 'fruit_coque', coche: false }] }),
    { surveilles: SURVEILLES }).ingredient.marqueurs, []);
  assert.deepEqual(ingredientSaisi(champs({ produit: 'noix', nature: 'autre' }), { surveilles: REGIME_SEUL }).ingredient.marqueurs, []);
  // Jambon cru jamais vu, nature Viande présélectionnée : viande et cru.
  const jambon = ingredientSaisi(champs({ produit: 'jambon cru', nature: 'viande' }), { surveilles: SURVEILLES }).ingredient;
  assert.deepEqual(jambon.marqueurs, ['viande', 'cru']);
  assert.equal(jambon.forme, 'morceaux');
  // Tartare de saumon, nature choisie Poisson : cru proposé.
  assert.deepEqual(ingredientSaisi(champs({ produit: 'tartare de saumon', nature: 'poisson' }), { surveilles: SURVEILLES })
    .ingredient.marqueurs, ['poisson', 'cru']);
  // Toujours la nature d'abord pour un produit jamais vu.
  assert.ok(ingredientSaisi(champs({ produit: 'noix' }), { surveilles: SURVEILLES }).erreurs.nature);
  // Café jamais vu : `cafeine`, et la case le coche.
  const cafe = ingredientSaisi(champs({ produit: 'café soluble', nature: 'autre' }), { surveilles: SURVEILLES }).ingredient;
  assert.deepEqual(cafe.marqueurs, ['cafeine']);
  assert.deepEqual(cochees(casesPour(cafe, { surveilles: SURVEILLES })), ['cafeine']);
  assert.ok(!contientUndefined(noix) && !contientUndefined(jambon) && !contientUndefined(cafe));
});

test('marqueursDeDepart : les marqueurs que « Modifier » montre avant tout toucher sont ceux qu’ingredientSaisi part', () => {
  const plats = [plat('salade', [viande('jambon cru', ['viande', 'porc', 'charcuterie'], { forme: 'fine' })])];
  const catalogue = catalogueProduits(plats);
  const ingredients = [ing('café', ['cafe'])];
  const cas = [
    [{ produit: 'noix', nature: 'autre' }, {}],
    [{ produit: 'tartare de saumon', nature: 'poisson' }, {}],
    [{ produit: 'jambon cru' }, {}],
    [{ produit: 'café' }, { ingredients, index: 0 }],
    [{ produit: 'bouillon de volaille', nature: 'autre' }, {}],
  ];
  for (const [saisis, opts] of cas) {
    const options = { catalogue, surveilles: SURVEILLES, ...opts };
    const depart = marqueursDeDepart(saisis, options);
    const { ingredient } = ingredientSaisi(champs(saisis), options);
    assert.deepEqual(depart.marqueurs, ingredient.marqueurs, saisis.produit);
  }
  assert.deepEqual(marqueursDeDepart({ produit: 'noix' }, { surveilles: SURVEILLES }), { marqueurs: ['fruit_coque'], proposes: ['fruit_coque'] });
  assert.deepEqual(marqueursDeDepart({ produit: 'café' }, { ingredients, index: 0, surveilles: SURVEILLES }), { marqueurs: ['cafe'], proposes: [] });
  assert.equal(marqueursDeDepart({ produit: '  ' }), null);
  assert.equal(marqueursDeDepart(null), null);
});

// ——— Enregistrer sans toucher une case ———

test('Modifier : ouvrir puis enregistrer sans toucher une case n’écrit rien', () => {
  const avant = plat('tiramisu', [ing('café', ['cafe']), ing('gélatine', ['gelatine_porc']), ing('mascarpone', ['laitier']),
    ing('noix', [])], { type: 'dessert' });
  const base = normaliserPourEdition(avant);
  // Chaque ingrédient revalidé sans case touchée (comme « Valider » dans la feuille) : la saisie ne change pas.
  const revalides = base.ingredients.map((ingredient, index) => ingredientSaisi(
    champs({ produit: ingredient.produit, qte: String(ingredient.qte), unite: ingredient.unite, rayon: ingredient.rayon }),
    { ingredients: base.ingredients, index, surveilles: SURVEILLES },
  ).ingredient);
  assert.deepEqual(revalides, base.ingredients);
  const r = preparerModification(base, { ...base, ingredients: revalides }, avant);
  assert.equal(r.rien, true);
  assert.deepEqual(r.champs, {});
});

test('Modifier : cocher « Au lait cru » écrit les ingrédients et fait apparaître la précaution de l’enfant', () => {
  const avant = plat('gratin', [ing('tomme', ['laitier']), ing('pomme de terre', ['legume'], { role: 'principal' })]);
  assert.deepEqual(precautionsAge(avant, ENFANT_30), []);
  const base = normaliserPourEdition(avant);
  const { ingredient } = ingredientSaisi(champs({ produit: 'tomme', reperes: [{ caseId: 'lait_cru', coche: true }] }),
    { ingredients: base.ingredients, index: 0, surveilles: SURVEILLES });
  const saisie = { ...base, ingredients: [ingredient, base.ingredients[1]] };
  const r = preparerModification(base, saisie, avant);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(Object.keys(r.champs).sort(), ['ingredients', 'portionsBase']);
  assert.deepEqual(r.champs.ingredients[0].marqueurs, ['laitier', 'lait_cru']);
  const apres = { ...avant, ...r.champs };
  assert.deepEqual(precautionsAge(apres, ENFANT_30).map((p) => [p.code, p.produits]), [['lait_cru', ['tomme']]]);
  // Décoché ensuite : la précaution disparaît.
  const base2 = normaliserPourEdition(apres);
  const leve = ingredientSaisi(champs({ produit: 'tomme', reperes: [{ caseId: 'lait_cru', coche: false }] }),
    { ingredients: base2.ingredients, index: 0, surveilles: SURVEILLES }).ingredient;
  const r2 = preparerModification(base2, { ...base2, ingredients: [leve, base2.ingredients[1]] }, apres);
  assert.deepEqual(precautionsAge({ ...apres, ...r2.champs }, ENFANT_30), []);
});

// ——— marqueursDouteux ———

test('marqueursDouteux : seulement les repères surveillés ; plusieurs par ingrédient', () => {
  const p = plat('x', [
    ing('noix', []), ing('café fort', []), ing('miel', []), ing('tofu', []), ing('espadon', ['poisson']),
    viande('jambon cru', ['viande', 'porc', 'charcuterie'], { forme: 'fine' }), ing('bouillon de volaille', []),
    ing('sauce soja', []), ing('noix de coco', []), ing('reblochon au lait cru', ['laitier']),
  ]);
  const resume = (options) => marqueursDouteux(p, options).map((d) => `${d.produit}:${d.attendu}`);
  // Régime + enfant de 30 mois (miel passé).
  assert.deepEqual(resume({ surveilles: SURVEILLES }), [
    'noix:fruit_coque', 'café fort:cafeine', 'tofu:soja', 'espadon:poisson_predateur', 'jambon cru:cru',
    'bouillon de volaille:bouillon_viande',
  ]);
  // Régime seul : les soupçons de T2a.
  assert.deepEqual(resume({ surveilles: REGIME_SEUL }), ['bouillon de volaille:bouillon_viande']);
  // Aucune règle : rien (le bandeau ne s'affiche pas).
  assert.deepEqual(resume({ surveilles: AUCUN }), []);
  // Sans filtre : tout ce que le nom annonce.
  assert.ok(resume().includes('miel:miel'));
  // Une liste vaut un Set.
  assert.deepEqual(resume({ surveilles: ['soja'] }), ['tofu:soja']);
  // Repère présent, ou équivalent effectif : rien à vérifier.
  const marques = plat('y', [ing('noix', ['fruit_coque']), ing('café', ['cafe']), ing('espadon', ['poisson_predateur']),
    ing('gélatine', ['gelatine_porc'])]);
  assert.deepEqual(marqueursDouteux(marques, { surveilles: SURVEILLES }), []);
});

test('marqueursDouteux : `cru` soupçonné seulement sur une viande, un poisson ou des fruits de mer', () => {
  const p = plat('x', [
    ing('tartare de saumon', ['poisson']), ing('huîtres', ['fruits_de_mer']), ing('carpaccio de courgettes', ['legume'], { role: 'principal' }),
    ing('tartare', ['laitier']), ing('tartare de saumon', ['poisson', 'cru']),
  ]);
  assert.deepEqual(marqueursDouteux(p, { surveilles: SURVEILLES }), [
    { produit: 'tartare de saumon', attendu: 'cru' }, { produit: 'huîtres', attendu: 'cru' },
  ]);
  // « jambon cru » non marqué viande, avec seulement les précautions de l'enfant : la viande manque d'abord.
  const age = marqueursSurveilles([ENFANT_30]);
  assert.ok(!age.has('viande'));
  assert.deepEqual(marqueursDouteux(plat('j', [ing('jambon cru', [])]), { surveilles: age }),
    [{ produit: 'jambon cru', attendu: 'viande' }]);
  // Sans `cru` surveillé ni viande : rien.
  assert.deepEqual(marqueursDouteux(plat('j', [ing('jambon cru', [])]), { surveilles: new Set(['lait_cru']) }), []);
  // Plat sans ingrédients ou abîmé.
  assert.deepEqual(marqueursDouteux({ statutRecette: 'attente' }, { surveilles: SURVEILLES }), []);
  assert.deepEqual(marqueursDouteux(plat('z', [null, { produit: 3 }, ing('noix', [])]), { surveilles: SURVEILLES }),
    [{ produit: 'noix', attendu: 'fruit_coque' }]);
});
