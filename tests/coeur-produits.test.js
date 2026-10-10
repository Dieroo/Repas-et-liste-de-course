// T3-0 « Produits courants » : clé d'un produit (slug.js › cleProduit), reconnaissance d'un nom saisi (produits.js),
// catalogue fusionné, suggestions et saisie d'un ingrédient avec les produits courants (edition.js). Fixtures
// génériques (aucune donnée du foyer) ; le dictionnaire testé est celui de l'app (js/coeur/dictionnaire.js).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleProduit, motsAccentues, slug } from '../js/coeur/slug.js';
import { memeProduit } from '../js/coeur/relecture.js';
import { marqueursDouteux, reperesAttendus } from '../js/coeur/compatibilite.js';
import { MARQUEURS_PRECAUTION, marqueursEffectifs } from '../js/coeur/vocabulaire.js';
import { marqueursSurveilles, ecrireRegime } from '../js/coeur/regles.js';
import { reglesSelonAge } from '../js/coeur/age.js';
import { creerSauvegarde, lireSauvegarde, validerSauvegarde } from '../js/coeur/sauvegarde.js';
import { DICTIONNAIRE } from '../js/coeur/dictionnaire.js';
import {
  HOMOGRAPHES, MOTS_NATURE, MOTS_REPERE, connuDuFoyer, elementsDuDictionnaire, estAmbigu, formesDe, motDeNature,
  natureDe as natureDeProduits, rangSuggestion, reconnaitre,
} from '../js/coeur/produits.js';
import {
  catalogueAvecDictionnaire, catalogueProduits, casesPour, ingredientSaisi, marqueursDeDepart, natureDe,
  natureProposee, normaliserPourEdition, preparerModification, produitConnu, reperesProposes, suggestions,
  texteProduitConnu,
} from '../js/coeur/edition.js';
import { CORPUS_INGREDIENTS } from './donnees/corpus-ingredients.js';

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
const plat = (id, ingredients, extra = {}) => ({
  id, nom: extra.nom ?? `Plat ${id}`, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, ...extra,
});
/** Catalogue du foyer tiré d'un seul plat. */
const foyerDe = (...ingredients) => catalogueProduits([plat('essai', ingredients)]);

const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []) };
const ENFANT_30 = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, naissance: neIlYA(30), regles: reglesSelonAge(neIlYA(30), REF, []).regles };
/** Régime sans viande + précautions d'un enfant de 30 mois (cru, lait cru, fruits à coque…). */
const SURVEILLES = marqueursSurveilles([ADULTE_B, ENFANT_30]);
/** Personne n'a de règle. */
const AUCUN = new Set();

const saisir = (produit, options = {}) => ingredientSaisi({ produit, qte: '1', unite: 'pc', ...options.champs },
  { catalogue: options.catalogue ?? [], surveilles: options.surveilles ?? AUCUN, dictionnaire: true, ...options.extra });
/** Ce que la reconnaissance comprend, en bref : 'ambigu', null, ou { origine, produit, rayon, marqueurs, forme?, role? }. */
function lu(nom, catalogue = []) {
  const r = reconnaitre(nom, { catalogue });
  if (!r) return null;
  if (r.ambigu) return 'ambigu';
  const { origine, element } = r;
  const resume = { origine, produit: element.produit, rayon: element.rayon, unite: element.unite, marqueurs: [...element.marqueurs] };
  if (element.forme) resume.forme = element.forme;
  if (element.role) resume.role = element.role;
  return resume;
}

/** Vrai si la valeur contient undefined, à quelque profondeur que ce soit. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientUndefined);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientUndefined);
  return false;
}

// ——— Clé d'un produit (slug.js) ———

test('cleProduit : slug, chaque mot de plus de 2 lettres sans « s » ni « x » final', () => {
  assert.equal(cleProduit('Pommes de terre'), 'pomme-de-terre');
  assert.equal(cleProduit('pomme de terre'), 'pomme-de-terre');
  assert.equal(cleProduit('Œufs'), 'oeuf');
  assert.equal(cleProduit('noix'), 'noi');
  assert.equal(cleProduit('choux'), 'chou');
  assert.equal(cleProduit('radis'), 'radi');
  assert.equal(cleProduit('riz'), 'riz');
  // Mots de 2 lettres ou moins : gardés tels quels.
  assert.equal(cleProduit('os'), 'os');
  assert.equal(cleProduit('lentilles vertes'), 'lentille-verte');
  assert.equal(cleProduit('Petits  pois'), 'petit-poi');
  assert.equal(cleProduit("Huile d'olive"), 'huile-d-olive');
  assert.equal(cleProduit('huile d’olive'), 'huile-d-olive');
  assert.equal(cleProduit('pâtes'), cleProduit('pâté'), 'sans accents, pâtes et pâté ont la même clé : d’où les homographes');
  for (const vide of ['', '   ', '!?', undefined, null]) assert.equal(cleProduit(vide), '');
});

test('memeProduit s’appuie sur cleProduit (comportement inchangé)', () => {
  for (const [a, b] of [['pommes de terre', 'pomme de terre'], ['œufs', 'oeuf'], ['Oeuf', 'œufs'], ['Lardons', 'lardon']]) {
    assert.equal(memeProduit(a, b), true, `${a} / ${b}`);
    assert.equal(cleProduit(a), cleProduit(b));
  }
  assert.equal(memeProduit('pomme', 'pomme de terre'), false);
  assert.equal(memeProduit('', ''), false);
  assert.equal(memeProduit('!', '?'), false);
});

test('motsAccentues : mêmes mots que slug, accents gardés ; sans pluriel sur demande', () => {
  assert.deepEqual(motsAccentues('Pâté de  Campagne'), ['pâté', 'de', 'campagne']);
  assert.deepEqual(motsAccentues('Œufs'), ['oeufs']);
  assert.deepEqual(motsAccentues('pâtes', { pluriel: false }), ['pâte']);
  assert.deepEqual(motsAccentues('pâtés', { pluriel: false }), ['pâté']);
  assert.deepEqual(motsAccentues('os', { pluriel: false }), ['os']);
  assert.deepEqual(motsAccentues("pavé d'espadon"), ['pavé', 'd', 'espadon']);
  assert.deepEqual(motsAccentues(''), []);
  // Accents décomposés (NFD) ou composés (NFC) : même résultat, rendu composé.
  assert.deepEqual(motsAccentues('pa\u0302te\u0301'), ['pâté']);
  // Toujours un mot par mot de slug, dans le même ordre.
  for (const nom of [...CORPUS_INGREDIENTS, 'Crème  fraîche — épaisse', 'Straße', 'İl', 'a \u0301b', 'Ærø']) {
    const mots = motsAccentues(nom);
    assert.equal(mots.length, slug(nom).split('-').filter(Boolean).length, nom);
    assert.equal(mots.map((m) => slug(m)).join('-'), slug(nom), nom);
    assert.equal(motsAccentues(nom, { pluriel: false }).map((m) => slug(m)).join('-'), cleProduit(nom), nom);
  }
});

// ——— Homographes ———

test('HOMOGRAPHES : la liste du plan', () => {
  assert.deepEqual([...HOMOGRAPHES].sort(), ['cote', 'mai', 'mure', 'pate', 'peche', 'rose', 'sale', 'the']);
});

test('homographes : la table des formes accentuées admises (pâtes, pates, pâte, pâté)', () => {
  const pates = { origine: 'dictionnaire', produit: 'pâtes', rayon: 'epicerie_salee', unite: 'g', marqueurs: ['feculent'] };
  for (const nom of ['pâtes', 'Pâtes', 'PÂTES', ' pâtes  courtes ', 'pâtes sèches', 'pates', 'Pates', 'pates courtes']) {
    assert.deepEqual(lu(nom), pates, nom);
  }
  // Seuls : la question reste, avec une aide.
  for (const nom of ['pâte', 'Pâte', 'pâté', 'PÂTÉ', 'pate', 'pâtés', ' pâte. ']) {
    assert.deepEqual(reconnaitre(nom), { ambigu: true }, nom);
    assert.equal(estAmbigu(nom), true, nom);
  }
  for (const nom of ['pâtes', 'pates', 'pâte brisée', 'pâté de campagne', 'tomate', '']) assert.equal(estAmbigu(nom), false, nom);
  // Dans un nom composé du dictionnaire.
  assert.deepEqual(lu('pâté de campagne'), {
    origine: 'dictionnaire', produit: 'pâté de campagne', rayon: 'charcuterie', unite: 'g', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'fine',
  });
  assert.deepEqual(lu('pâtés de campagne').produit, 'pâté de campagne');
  for (const nom of ['pâte feuilletée', 'pâtes feuilletées', 'Pâte brisée']) assert.deepEqual(lu(nom).marqueurs, [], nom);
  assert.equal(lu('pâte feuilletée').rayon, 'cremerie');
  // Un homographe mal accentué n'est pas reconnu (jamais de pâté pris pour des pâtes, ni l'inverse).
  for (const nom of ['pâte de campagne', 'pâté feuilleté', 'pate feuilletee', 'pate de campagne', 'pâtés courtes']) {
    assert.equal(reconnaitre(nom), null, nom);
  }
});

test('homographes : sans accent, le mot n’est pas reconnu (thé, maïs, côte, pêche)', () => {
  assert.equal(lu('thé').produit, 'thé');
  assert.equal(reconnaitre('the'), null);
  assert.equal(lu('maïs').produit, 'maïs doux');
  assert.equal(lu('Maïs doux').produit, 'maïs doux');
  assert.equal(reconnaitre('mais'), null);
  assert.equal(reconnaitre('mais doux'), null);
  assert.equal(lu('côte de bœuf').produit, 'côte de bœuf');
  assert.equal(lu('Côtes de boeuf').produit, 'côte de bœuf', 'œ et pluriel sans effet');
  assert.equal(reconnaitre('cote de boeuf'), null);
  assert.equal(lu('pêches').produit, 'pêche');
  assert.equal(reconnaitre('peche'), null);
  // Un mot sans homographe reste comparé sans accents.
  assert.equal(lu('creme fraiche epaisse').produit, 'crème fraîche épaisse');
  assert.equal(lu('BOEUF HACHE').produit, 'bœuf haché');
});

// ——— Reconnaître : les cas limites ———

test('reconnaitre : les cas limites du plan', () => {
  const cas = {
    'lait de coco': { rayon: 'epicerie_salee', marqueurs: [] },
    'noix de coco': { marqueurs: [] },
    'noix de muscade': { marqueurs: [] },
    'noix de Saint-Jacques': { rayon: 'poissonnerie', marqueurs: ['fruits_de_mer'] },
    'sauce soja': { marqueurs: [] },
    tofu: { rayon: 'cremerie', marqueurs: ['soja'] },
    'fumet de poisson': { marqueurs: ['poisson'] },
    'bouillon de volaille': { marqueurs: ['bouillon_viande'] },
    'bouillon de légumes': { marqueurs: [] },
    beurre: { rayon: 'cremerie', marqueurs: ['laitier'] },
    lait: { rayon: 'cremerie', marqueurs: ['laitier'] },
    'jambon cru': { rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'fine' },
    gélatine: { marqueurs: ['gelatine_porc', 'gelatine_animale'] },
    'agar-agar': { marqueurs: [] },
    'noix de veau': { marqueurs: ['viande', 'boeuf'], forme: 'morceaux' },
    noix: { marqueurs: ['fruit_coque'] },
    'cerneaux de noix': { marqueurs: ['fruit_coque'] },
    "poudre d'amande": { marqueurs: [] },
    'beurre de cacahuète': { marqueurs: [] },
    'crème de marrons': { marqueurs: [] },
    reblochon: { rayon: 'fromages', marqueurs: ['laitier', 'lait_cru'] },
    comté: { marqueurs: ['laitier'] },
    'parmesan râpé': { marqueurs: ['laitier'] },
    'gruyère râpé': { marqueurs: ['laitier'] },
    lardons: { rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'morceaux' },
    escargots: { marqueurs: ['viande'], forme: 'morceaux' },
    'pousses de soja': { marqueurs: ['legume'], role: 'incorpore' },
    edamame: { marqueurs: ['soja'] },
    "pain d'épices": { marqueurs: ['miel'] },
    "pavé d'espadon": { marqueurs: ['poisson', 'poisson_predateur'] },
  };
  for (const [nom, attendu] of Object.entries(cas)) {
    const resume = lu(nom);
    assert.ok(resume && resume !== 'ambigu', nom);
    assert.equal(resume.origine, 'dictionnaire', nom);
    for (const [champ, valeur] of Object.entries(attendu)) assert.deepEqual(resume[champ], valeur, `${nom} › ${champ}`);
    if (!attendu.forme) assert.equal(resume.forme, undefined, nom);
  }
});

test('reconnaitre : noms ambigus laissés hors du dictionnaire, la question reste', () => {
  for (const nom of ['bouillon', 'bouillon cube', 'crème', 'fromage', 'steak', 'saucisse', 'farce', 'viande', 'poisson', 'fruits de mer']) {
    assert.equal(reconnaitre(nom), null, nom);
  }
});

test('reconnaitre : aucune ressemblance (début, mot principal, adjectif retiré)', () => {
  // Noms voisins de produits courants (poulet, steak de soja, lait d'avoine, tomate cerise, pâtes fraîches, beurre salé,
  // noix de cajou, gélatine, café…), absents eux-mêmes : jamais reconnus par ressemblance.
  for (const nom of ['poulet fermier', 'steak végétal', 'saucisse végétale', "lait d'avoine bio", 'oignon jaune bio', 'tomates cerises jaunes',
    'pâtes fraîches maison', 'oign', 'jambon', 'beurre salé aux algues', 'noix de cajou grillées', 'gélatine de poisson', 'café décaféiné']) {
    assert.equal(reconnaitre(nom), null, nom);
  }
});

test('reconnaitre : saisie vide ou illisible → null ; catalogue illisible ignoré', () => {
  for (const nom of ['', '  ', '!?', undefined, null, 42]) assert.equal(reconnaitre(nom), null, String(nom));
  assert.equal(reconnaitre('pâtes', { catalogue: null }).origine, 'dictionnaire');
  assert.equal(reconnaitre('pâtes', { catalogue: [null, 3, {}, { produit: 7 }] }).origine, 'dictionnaire');
  assert.equal(reconnaitre('pâtes', {}).origine, 'dictionnaire');
  assert.equal(reconnaitre('pâtes').origine, 'dictionnaire');
});

test('reconnaitre : élément des produits courants (forme du catalogue, origine, id, nom courant, jamais de quantité)', () => {
  const r = reconnaitre('Oignons');
  assert.equal(r.origine, 'dictionnaire');
  assert.equal(r.entree.id, 'oignon-jaune');
  assert.deepEqual({ ...r.element, marqueurs: [...r.element.marqueurs], alias: [...r.element.alias] }, {
    produit: 'oignon jaune', unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore', nature: 'legume',
    origine: 'dictionnaire', id: 'oignon-jaune', nomCourant: 'oignon jaune', alias: ['oignon', 'oignon émincé'],
  });
  assert.equal('qte' in r.element, false);
  assert.ok(Object.isFrozen(r.element) && Object.isFrozen(r.element.marqueurs));
  // Le même élément à chaque appel (gelé, partagé).
  assert.equal(reconnaitre('oignon émincé').element, r.element);
  assert.equal(contientUndefined(r.element), false);
});

// ——— Priorité du foyer ———

test('reconnaitre : le foyer l’emporte (exact, au pluriel près, par une autre écriture), en bloc', () => {
  // Exact : le foyer range « pâtes » en Divers.
  const divers = foyerDe(ing('pâtes', ['feculent'], { unite: 'g', rayon: 'divers' }));
  const r = reconnaitre('Pâtes', { catalogue: divers });
  assert.equal(r.origine, 'foyer');
  assert.equal(r.element.rayon, 'divers');
  assert.equal(r.element.origine, 'foyer');
  assert.equal(r.element.nature, 'autre');
  assert.equal(r.entree, undefined);
  // Le foyer a « oignon » : « oignons » (pluriel près) et « oignon jaune » (autre écriture de la même entrée).
  const oignon = foyerDe(ing('oignon', ['legume'], { role: 'principal', rayon: 'divers' }));
  for (const nom of ['oignons', 'Oignon', 'oignon jaune', 'oignons jaunes', 'oignon émincé']) {
    const trouve = reconnaitre(nom, { catalogue: oignon });
    assert.equal(trouve.origine, 'foyer', nom);
    assert.equal(trouve.element.produit, 'oignon', nom);
    assert.equal(trouve.element.role, 'principal', nom);
  }
  assert.equal(reconnaitre('oignon jaune', { catalogue: oignon }).entree.id, 'oignon-jaune');
  assert.equal(reconnaitre('oignon jaune', { catalogue: oignon }).autreEcriture, true);
  assert.equal(reconnaitre('Oignon', { catalogue: oignon }).autreEcriture, undefined, 'même nom : le foyer décide seul');
  // Le foyer ne connaît que « cerneau de noix », sans repère (recette d'avant les précautions, pas encore relue) :
  // « noix » prend l'élément du foyer (rayon, unité), mais garde le repère de précaution du produit courant.
  const cerneaux = foyerDe(ing('cerneau de noix', [], { unite: 'g', rayon: 'epicerie_sucree' }));
  const noix = reconnaitre('noix', { catalogue: cerneaux });
  assert.equal(noix.origine, 'foyer');
  assert.equal(noix.element.produit, 'cerneau de noix');
  assert.equal(noix.element.rayon, 'epicerie_sucree');
  assert.deepEqual(noix.element.marqueurs, ['fruit_coque']);
  assert.deepEqual(noix.ajoutes, ['fruit_coque']);
  assert.deepEqual(cerneaux[0].marqueurs, [], 'le catalogue du foyer n’est pas touché');
  // Même nom au foyer : sa décision (aucun repère) reste.
  assert.deepEqual(reconnaitre('noix', { catalogue: foyerDe(ing('noix', [], { unite: 'g' })) }).element.marqueurs, []);
  // Un produit que seul un plat de la corbeille connaît fait partie du catalogue du foyer.
  const corbeille = catalogueProduits([plat('jete', [ing('tofu', [], { rayon: 'epicerie_salee' })], { corbeille: { le: 1, par: 'a@example.com' } })]);
  assert.equal(reconnaitre('tofu', { catalogue: corbeille }).element.rayon, 'epicerie_salee');
});

test('foyer trouvé par une autre écriture : rien de moins prudent que le nom saisi seul (plus prudent tout de suite)', () => {
  // Recettes d'avant les précautions (T2c-1), pas encore relues : le produit du foyer n'a pas le repère.
  const cas = [
    ['cerneau de noix', 'noix', ['fruit_coque']],
    ['amande', 'amandes', ['fruit_coque']],
    ['pignon de pin', 'pignons', ['fruit_coque']],
    ['tofu', 'tofu ferme', ['soja']],
    ['café', 'expresso', ['cafeine']],
    ['thé', 'thés', ['cafeine']],
    ['feuille de gélatine', 'gélatine', ['gelatine_animale']],
    ['bouillon de volaille', 'bouillon de poulet', ['bouillon_viande']],
    ['reblochon', 'reblochons', ['lait_cru']],
  ];
  for (const [aufoyer, tape, attendus] of cas) {
    const foyer = foyerDe(ing(aufoyer, [], { unite: 'g', rayon: 'epicerie_salee' }));
    for (const surveilles of [SURVEILLES, AUCUN]) {
      const { ingredient } = saisir(tape, { catalogue: foyer, surveilles, champs: { unite: 'g' } });
      const effectifs = marqueursEffectifs(ingredient);
      for (const m of attendus) assert.ok(effectifs.has(m), `${tape} (foyer « ${aufoyer} ») : ${m}`);
      // Le foyer l'emporte pour le reste : son rayon, aucune question.
      assert.equal(ingredient.rayon, 'epicerie_salee', tape);
      // Les cases montrées partent des mêmes marqueurs que ceux enregistrés.
      assert.deepEqual(marqueursDeDepart({ produit: tape }, { catalogue: foyer, surveilles, dictionnaire: true }).marqueurs,
        ingredient.marqueurs, tape);
    }
  }
  // Repère annoncé par le nom, absent du produit courant trouvé : il reste proposé (« jambons crus » → cru).
  const jambon = foyerDe(ing('jambon cru', ['viande', 'porc', 'charcuterie'], { forme: 'fine', rayon: 'charcuterie' }));
  assert.ok(saisir('jambons crus', { catalogue: jambon, surveilles: SURVEILLES }).ingredient.marqueurs.includes('cru'));
  assert.deepEqual(natureProposee('noix', foyerDe(ing('cerneau de noix', [])), { surveilles: SURVEILLES, dictionnaire: true }),
    { nature: null, reperes: ['fruit_coque'] });
  // Même nom au foyer : sa décision reste (« noix » sans repère, enlevé exprès).
  assert.deepEqual(saisir('noix', { catalogue: foyerDe(ing('noix', [], { unite: 'g' })), surveilles: SURVEILLES }).ingredient.marqueurs, []);
});

test('reconnaitre : foyer au pluriel près, jamais à travers un homographe', () => {
  // Le foyer a « pâte » (brisée, en vrac) : « pâtes » reste le produit courant ; « pâté », « pâtés » et « pate » seuls
  // posent la question (jamais la « pâte » du foyer, sans viande).
  const pate = foyerDe(ing('pâte', [], { rayon: 'divers' }));
  assert.equal(reconnaitre('pâtes', { catalogue: pate }).origine, 'dictionnaire');
  assert.deepEqual(reconnaitre('pâté', { catalogue: pate }), { ambigu: true });
  assert.deepEqual(reconnaitre('pâtés', { catalogue: pate }), { ambigu: true });
  assert.deepEqual(reconnaitre('pate', { catalogue: pate }), { ambigu: true });
  assert.equal(reconnaitre('Pâte', { catalogue: pate }).origine, 'foyer', 'mêmes accents : le foyer');
  assert.equal(ingredientSaisi({ produit: 'pâté', qte: 1, unite: 'g' }, { catalogue: pate, dictionnaire: true }).erreurs.nature,
    'Choisissez\u00A0: viande, poisson, légume ou autre.');
  // Le foyer a « pâtes » : « pâte » seule reste ambiguë ; « pâtés » n'est jamais ses pâtes (pas de féculent sans viande).
  const pates = foyerDe(ing('pâtes', ['feculent'], { rayon: 'divers' }));
  assert.deepEqual(reconnaitre('pâte', { catalogue: pates }), { ambigu: true });
  assert.deepEqual(reconnaitre('pâtés', { catalogue: pates }), { ambigu: true });
  assert.ok(ingredientSaisi({ produit: 'pâtés', qte: 1, unite: 'g' }, { catalogue: pates, dictionnaire: true }).erreurs.nature);
  assert.equal(reconnaitre('pates', { catalogue: pates }).element.rayon, 'divers', '« pates » : des pâtes, celles du foyer');
  // Le foyer a « pâtés » (viande) : « pâtes courtes », « pâtes sèches », « pates » restent des pâtes, jamais de la viande.
  const pates2 = foyerDe(ing('pâtés', ['viande', 'porc', 'charcuterie'], { forme: 'fine', rayon: 'charcuterie' }));
  for (const nom of ['pâtes', 'pates', 'pâtes courtes', 'pâtes sèches']) {
    assert.deepEqual(lu(nom, pates2)?.marqueurs, ['feculent'], nom);
    assert.equal(lu(nom, pates2)?.origine, 'dictionnaire', nom);
  }
  assert.ok(catalogueAvecDictionnaire([plat('p', [ing('pâtés', ['viande', 'porc', 'charcuterie'], { forme: 'fine' })])])
    .some((e) => e.produit === 'pâtes' && e.origine === 'dictionnaire'), 'les pâtés du foyer ne cachent pas les pâtes');
  // Saisie sans accent d'un homographe écrit avec ses accents au foyer (ou l'inverse) : le foyer, comme avant.
  assert.equal(reconnaitre('the', { catalogue: foyerDe(ing('thé', ['cafeine'])) }).element.produit, 'thé');
  assert.equal(reconnaitre('pâte brisée', { catalogue: foyerDe(ing('pate brisee', [])) }).element.produit, 'pate brisee');
  assert.equal(reconnaitre('pate brisee', { catalogue: foyerDe(ing('pâte brisée', [])) }).element.produit, 'pâte brisée');
  assert.equal(connuDuFoyer('pâté de campagne', foyerDe(ing('pâte de campagne', []))), null, 'deux accents différents');
  // Au pluriel près, hors homographe.
  const lentille = foyerDe(ing('lentille corail', ['feculent'], { rayon: 'divers' }));
  assert.equal(reconnaitre('lentilles corail', { catalogue: lentille }).element.produit, 'lentille corail');
  assert.equal(connuDuFoyer('lentilles corail', lentille).produit, 'lentille corail');
  assert.equal(connuDuFoyer('lentilles', lentille), null);
  assert.equal(connuDuFoyer('', lentille), null);
});

test('reconnaitre : un catalogue fusionné ne fait jamais passer un produit courant pour un produit du foyer', () => {
  const fusion = catalogueAvecDictionnaire([plat('essai', [ing('courgette', ['legume'], { role: 'principal' })])]);
  assert.ok(fusion.some((e) => e.produit === 'pâtes' && e.origine === 'dictionnaire'));
  assert.equal(reconnaitre('pâtes', { catalogue: fusion }).origine, 'dictionnaire');
  assert.equal(reconnaitre('courgettes', { catalogue: fusion }).origine, 'foyer');
  assert.equal(connuDuFoyer('pâtes', fusion), null);
});

// ——— Catalogue fusionné ———

test('catalogueAvecDictionnaire : le foyer, puis les produits courants triés ; jamais en double ; mémoire', () => {
  const plats = [plat('a', [ing('oignon', ['legume'], { role: 'incorpore' }), ing('Riz basmati', ['feculent'], { unite: 'g' })])];
  const fusion = catalogueAvecDictionnaire(plats);
  assert.equal(catalogueAvecDictionnaire(plats), fusion, 'même tableau plats → même résultat');
  const foyer = catalogueProduits(plats);
  assert.deepEqual(fusion.slice(0, foyer.length), foyer);
  assert.ok(fusion.slice(0, foyer.length).every((e, i) => e === foyer[i]));
  const courants = fusion.slice(foyer.length);
  assert.ok(courants.every((e) => e.origine === 'dictionnaire'));
  const noms = courants.map((e) => e.produit);
  assert.deepEqual(noms, [...noms].sort(new Intl.Collator('fr', { sensitivity: 'base' }).compare));
  // « oignon » du foyer cache « oignon jaune » (son autre écriture) ; « riz basmati », lui-même.
  assert.equal(noms.includes('oignon jaune'), false);
  assert.equal(noms.includes('riz basmati'), false);
  assert.ok(noms.includes('pâtes'));
  assert.equal(courants.length, elementsDuDictionnaire().length - 2);
  // Sans plats : tous les produits courants.
  assert.equal(catalogueAvecDictionnaire([]).length, DICTIONNAIRE.length);
  assert.equal(catalogueAvecDictionnaire(null).length, DICTIONNAIRE.length);
  // Le foyer qui connaît « pâte » ne cache pas « pâtes ».
  assert.ok(catalogueAvecDictionnaire([plat('b', [ing('pâte', [])])]).some((e) => e.produit === 'pâtes'));
});

test('elementsDuDictionnaire et formesDe', () => {
  const elements = elementsDuDictionnaire();
  assert.equal(elementsDuDictionnaire(), elements);
  assert.ok(Object.isFrozen(elements));
  assert.equal(elements.length, DICTIONNAIRE.length);
  assert.deepEqual(formesDe(elements.find((e) => e.id === 'pate')), ['pâtes', 'pâtes sèches', 'pâtes courtes']);
  assert.deepEqual(formesDe(DICTIONNAIRE.find((e) => e.id === 'pate')), ['pâtes', 'pâtes sèches', 'pâtes courtes']);
  assert.deepEqual(formesDe({ produit: 'tomate' }), ['tomate']);
  assert.deepEqual(formesDe(null), []);
});

// ——— Suggestions ———

test('suggestions : produits courants cherchés par leur nom et leurs autres écritures, rendus sous leur nom courant', () => {
  const tout = catalogueAvecDictionnaire([]);
  const noms = (saisie, options) => suggestions(tout, saisie, options).map((e) => e.produit);
  assert.equal(noms('oign')[0], 'oignon jaune');
  assert.equal(noms('oignons')[0], 'oignon jaune', 'saisie complète d’une autre écriture : le nom courant d’abord');
  assert.deepEqual(noms('steak h'), ['bœuf haché']);
  assert.equal(noms('cerneaux')[0], 'noix');
  assert.equal(noms('pommes de t')[0], 'pomme de terre', 'mots terminés comparés sans pluriel');
  assert.equal(noms('pâtes')[0], 'pâtes');
  assert.equal(noms('pates')[0], 'pâtes');
  // Une entrée n'est proposée qu'une fois, même trouvée par plusieurs écritures.
  const pates = noms('pâtes', { max: 20 });
  assert.equal(pates.filter((n) => n === 'pâtes').length, 1);
  // Pas de rang « contient » pour les produits courants.
  assert.deepEqual(noms('ignon'), []);
  assert.deepEqual(noms('erbe'), []);
  assert.equal(rangSuggestion(tout.find((e) => e.produit === 'oignon jaune'), 'ignon'), null);
  // Un mot qui commence par la saisie (rang 2).
  assert.ok(noms('campagne').includes('pâté de campagne'));
  // Maximum respecté.
  assert.equal(noms('p').length, 4);
  assert.deepEqual(noms('p', { max: 0 }), []);
});

test('suggestions : accents des homographes et mot entier au pluriel près', () => {
  const tout = catalogueAvecDictionnaire([]);
  const noms = (saisie, catalogue = tout) => suggestions(catalogue, saisie).map((e) => e.produit);
  // « pâté » ou « pâtés » (la question s'affiche) : un pâté d'abord, jamais « pâtes » comme nom exact.
  for (const saisie of ['pâté', 'pâtés', 'Pâtés']) {
    assert.equal(noms(saisie)[0], 'pâté de campagne', saisie);
    assert.ok(noms(saisie).indexOf('pâté en croûte') < noms(saisie).indexOf('pâtes'), saisie);
  }
  const pates = tout.find((e) => e.produit === 'pâtes');
  assert.deepEqual(rangSuggestion(pates, 'pâtés'), { rang: 1, ecart: 1, mots: 1 });
  assert.deepEqual(rangSuggestion(pates, 'pates'), { rang: 0, ecart: 0, mots: 1 });
  assert.deepEqual(rangSuggestion(pates, 'pâtes'), { rang: 0, ecart: 0, mots: 1 });
  // « pâte », « pate » : les pâtes et les pâtes à tarte d'abord ; la première ne bouge pas en finissant le mot.
  for (const saisie of ['pât', 'pâte', 'pate', 'pâtes', 'pates']) assert.equal(noms(saisie)[0], 'pâtes', saisie);
  // Le foyer a des « pâtes » : « pâtés » propose quand même un pâté d'abord.
  const foyer = catalogueAvecDictionnaire([plat('a', [ing('pâtes', ['feculent'], { unite: 'g' })])]);
  assert.equal(noms('pâtés', foyer)[0], 'pâté de campagne');
  assert.equal(noms('pâtes', foyer)[0], 'pâtes');
  assert.equal(suggestions(foyer, 'pâtes')[0].origine, undefined, 'les pâtes du foyer');
  // « pois » : un mot entier sans pluriel, jamais un simple début (« poire », « poivre »).
  const pois = noms('pois');
  assert.ok(pois.includes('pois cassé') && pois.includes('pois chiche'), pois.join(', '));
  for (const faux of ['poire', 'poireau', 'poivre', 'poivron']) assert.equal(pois.includes(faux), false, faux);
  // Un mot entier au pluriel reste trouvé (« cerneaux » → cerneau de noix) ; un début tel que tapé aussi.
  assert.equal(noms('cerneaux')[0], 'noix');
  assert.equal(noms('poi').includes('poire'), true);
});

test('suggestions : à rang égal, le foyer avant les produits courants ; le foyer garde son rang « contient »', () => {
  const plats = [plat('a', [ing('pâtes complètes', ['feculent']), ing('compote', []), ing('tomate farcie', ['legume'], { role: 'principal' })])];
  const fusion = catalogueAvecDictionnaire(plats);
  const noms = (saisie, max = 4) => suggestions(fusion, saisie, { max }).map((e) => e.produit);
  // « pât » : rang 1 partout ; le foyer d'abord.
  assert.deepEqual(noms('pât', 2), ['pâtes complètes', 'pâtes']);
  // « tomate » : nom exact (produit courant, rang 0) avant un début de nom du foyer (rang 1).
  assert.deepEqual(noms('tomate', 2), ['tomate', 'tomate farcie']);
  // « pote » : contenu dans « compote » (foyer, rang 3) ; aucun produit courant ne le contient au rang 3.
  assert.deepEqual(noms('pote'), ['compote']);
  // Le foyer au pluriel près est en tête (rang 0), hors homographes.
  const oignon = catalogueAvecDictionnaire([plat('b', [ing('oignon', ['legume'], { role: 'incorpore' }), ing('gros oignon', ['legume'], { role: 'incorpore' })])]);
  assert.deepEqual(suggestions(oignon, 'oignons').map((e) => e.produit)[0], 'oignon');
});

// ——— produitConnu et saisie d'un ingrédient ———

test('produitConnu : sans l’option, slug exact comme avant ; avec, la reconnaissance', () => {
  for (const nom of ['panais', 'colin', 'paprika', 'sel', 'pâtes']) {
    if (nom === 'sel' || nom === 'pâtes') assert.ok(produitConnu([], nom, { reconnaitre: true }), nom);
    assert.equal(produitConnu([], nom), null, nom);
  }
  assert.equal(produitConnu([], 'pâtes', { reconnaitre: true }).origine, 'dictionnaire');
  assert.equal(produitConnu([], 'pâte', { reconnaitre: true }), null, 'ambigu : rien de connu');
  const foyer = foyerDe(ing('oignon', ['legume'], { role: 'incorpore' }));
  assert.equal(produitConnu(foyer, 'oignons'), null, 'sans l’option, pas de pluriel');
  assert.equal(produitConnu(foyer, 'oignons', { reconnaitre: true }).produit, 'oignon');
});

test('ingredientSaisi (produits courants) : « pâtes » sans question, nom tapé gardé, aucun champ de plus', () => {
  const { ingredient, erreurs } = saisir('Pâtes', { champs: { unite: 'g', qte: '400' } });
  assert.equal(erreurs, undefined);
  assert.deepEqual(ingredient, { produit: 'pâtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] });
  // Nom tapé gardé (jamais renommé en nom courant).
  assert.equal(saisir('oignons').ingredient.produit, 'oignons');
  assert.deepEqual(saisir('oignons').ingredient, { produit: 'oignons', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' });
  // Viande : forme du produit courant.
  assert.deepEqual(saisir('lardons', { champs: { unite: 'g' } }).ingredient,
    { produit: 'lardons', qte: 1, unite: 'g', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'morceaux' });
  // Sans l'option : la question reste.
  assert.ok(ingredientSaisi({ produit: 'pâtes', qte: '1', unite: 'g' }, { catalogue: [] }).erreurs.nature);
  // Nom ambigu : la question reste.
  assert.ok(saisir('pâte').erreurs.nature);
  assert.ok(saisir('crème').erreurs.nature);
});

test('ingredientSaisi (produits courants) : repères de précaution du produit, repères de préparation d’après le nom', () => {
  assert.deepEqual(saisir('noix').ingredient.marqueurs, ['fruit_coque']);
  assert.deepEqual(saisir('reblochon').ingredient.marqueurs, ['laitier', 'lait_cru']);
  assert.deepEqual(saisir('tofu').ingredient.marqueurs, ['soja']);
  assert.deepEqual(saisir('gélatine').ingredient.marqueurs, ['gelatine_porc', 'gelatine_animale']);
  assert.deepEqual(saisir('bouillon de volaille').ingredient.marqueurs, ['bouillon_viande']);
  // « jambon cru » : `cru` proposé d'après le nom si une règle le surveille.
  assert.deepEqual(saisir('jambon cru', { surveilles: SURVEILLES }).ingredient.marqueurs, ['viande', 'porc', 'charcuterie', 'cru']);
  assert.deepEqual(saisir('jambon cru', { surveilles: AUCUN }).ingredient.marqueurs, ['viande', 'porc', 'charcuterie']);
  // Charcuterie sèche : chorizo, rosette, saucisson sec.
  for (const nom of ['chorizo', 'rosette', 'saucisson sec']) {
    assert.ok(saisir(nom, { surveilles: SURVEILLES }).ingredient.marqueurs.includes('cru'), nom);
  }
  // Une case décochée l'emporte.
  assert.deepEqual(saisir('reblochon', { champs: { reperes: [{ caseId: 'lait_cru', coche: false }] } }).ingredient.marqueurs, ['laitier']);
});

test('ingredientSaisi (produits courants) : une nature, un rayon, une forme touchés l’emportent', () => {
  assert.deepEqual(saisir('pâtes', { champs: { nature: 'legume', unite: 'g' } }).ingredient,
    { produit: 'pâtes', qte: 1, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['legume', 'feculent'], role: 'incorpore' },
    'le rayon du produit reste, comme pour un produit du foyer');
  assert.equal(saisir('pâtes', { champs: { rayon: 'divers' } }).ingredient.rayon, 'divers');
  assert.equal(saisir('lardons', { champs: { forme: 'fine' } }).ingredient.forme, 'fine');
  assert.deepEqual(saisir('lardons', { champs: { nature: 'autre' } }).ingredient.marqueurs, []);
});

test('ingredientSaisi : le foyer passe avant les produits courants', () => {
  const foyer = foyerDe(ing('pâtes', ['feculent'], { unite: 'g', rayon: 'divers' }));
  assert.equal(saisir('pâtes', { catalogue: foyer }).ingredient.rayon, 'divers');
  // L'ingrédient modifié garde les siens.
  const liste = [ing('reblochon', ['laitier'], { rayon: 'fromages' })];
  assert.deepEqual(saisir('reblochon', { extra: { ingredients: liste, index: 0 } }).ingredient.marqueurs, ['laitier']);
});

test('natureProposee et marqueursDeDepart (produits courants) : connus comme un produit du foyer', () => {
  const s = { surveilles: SURVEILLES };
  // Sans l'option : produit jamais vu.
  assert.deepEqual(natureProposee('noix', [], s), { nature: 'autre', reperes: ['fruit_coque'] });
  // Avec : connu, ses repères viennent de lui ; seuls ceux de préparation sont proposés d'après le nom.
  assert.equal(natureProposee('noix', [], { ...s, dictionnaire: true }), null);
  assert.deepEqual(natureProposee('jambon cru', [], { ...s, dictionnaire: true }), { nature: null, reperes: ['cru'] });
  assert.deepEqual(natureProposee('chorizo', [], { ...s, dictionnaire: true }), { nature: null, reperes: ['cru'] });
  assert.equal(natureProposee('pâte', [], { ...s, dictionnaire: true }), null);
  assert.deepEqual(marqueursDeDepart({ produit: 'reblochon' }, { ...s, dictionnaire: true }), { marqueurs: ['laitier', 'lait_cru'], proposes: [] });
  assert.deepEqual(marqueursDeDepart({ produit: 'jambon cru' }, { ...s, dictionnaire: true }),
    { marqueurs: ['viande', 'porc', 'charcuterie', 'cru'], proposes: ['cru'] });
  assert.deepEqual(marqueursDeDepart({ produit: 'reblochon' }, s), { marqueurs: [], proposes: [] });
  // Mêmes marqueurs que l'ingrédient enregistré.
  for (const nom of ['reblochon', 'jambon cru', 'noix', 'pâtes', 'chorizo', 'gélatine', 'café']) {
    assert.deepEqual(marqueursDeDepart({ produit: nom }, { ...s, dictionnaire: true }).marqueurs,
      saisir(nom, { surveilles: SURVEILLES }).ingredient.marqueurs, nom);
  }
});

test('lait_cru porté sans règle qui le surveille : la case cochée se voit dans « Repères »', () => {
  const { ingredient } = saisir('camembert', { surveilles: AUCUN });
  assert.deepEqual(ingredient.marqueurs, ['laitier', 'lait_cru']);
  assert.deepEqual(casesPour(ingredient, { surveilles: AUCUN }), [{ id: 'lait_cru', libelle: 'Au lait cru', coche: true }]);
});

test('corpus : chaque nom reconnu s’enregistre sans question de nature, et passe l’import', () => {
  let reconnus = 0;
  for (const nom of CORPUS_INGREDIENTS) {
    const r = reconnaitre(nom);
    if (!r || r.ambigu) continue;
    reconnus += 1;
    const resultat = ingredientSaisi({ produit: nom, qte: 1, unite: r.element.unite }, { catalogue: [], dictionnaire: true });
    assert.equal(resultat.erreurs, undefined, `${nom} : ${JSON.stringify(resultat.erreurs)}`);
    assert.equal(contientUndefined(resultat.ingredient), false, nom);
    assert.deepEqual(Object.keys(resultat.ingredient).filter((k) => !['produit', 'qte', 'unite', 'rayon', 'marqueurs', 'forme', 'role'].includes(k)), [], nom);
  }
  assert.ok(reconnus > 0);
});

test('recette relue : un produit courant ajouté la renvoie à relire, comme tout produit nouveau', () => {
  const relue = { ...plat('relue', [ing('tomate', ['legume'], { role: 'incorpore' })]), reperesRelus: 1 };
  const base = normaliserPourEdition(relue);
  const { ingredient } = saisir('noix', { champs: { unite: 'g' } });
  const saisie = { ...base, ingredients: [...base.ingredients, ingredient] };
  assert.ok(preparerModification(base, saisie, relue).supprimer.includes('reperesRelus'));
});

test('sauvegarde : un plat saisi avec les produits courants ressort identique, sans aucun champ de plus', () => {
  const ingredients = ['pâtes', 'lardons', 'reblochon', 'oignons', 'noix'].map((nom) => saisir(nom, { champs: { unite: 'g', qte: '100' } }).ingredient);
  const fiche = plat('gratin-courant', ingredients, { nom: 'Gratin courant' });
  const { texte } = creerSauvegarde({ plats: [fiche], profils: [] }, { maintenant: new Date('2026-10-10T10:00:00Z') });
  assert.equal(/origine|nomCourant|alias/.test(texte), false);
  const v = validerSauvegarde(lireSauvegarde(texte).sauvegarde);
  assert.equal(v.valide, true);
  assert.deepEqual(v.plats[0].recette.ingredients, ingredients);
});

// ——— Ligne « ✓ Produit connu » ———

test('motDeNature : viande, poisson, légume, féculent, produit laitier, œuf ; sinon rien', () => {
  assert.equal(natureDeProduits, natureDe, 'natureDe réexporté par edition.js');
  assert.equal(motDeNature(['viande', 'porc']), 'viande');
  assert.equal(motDeNature(['boeuf']), 'viande');
  assert.equal(motDeNature(['fruits_de_mer']), 'poisson');
  assert.equal(motDeNature(['poisson', 'poisson_predateur']), 'poisson');
  assert.equal(motDeNature(['legume']), 'légume');
  assert.equal(motDeNature(['feculent', 'laitier']), 'féculent');
  assert.equal(motDeNature(['laitier', 'lait_cru']), 'produit laitier');
  assert.equal(motDeNature(['oeuf']), 'œuf');
  assert.equal(motDeNature(['soja']), null);
  assert.equal(motDeNature([]), null);
  assert.equal(motDeNature(undefined), null);
  assert.deepEqual(Object.values(MOTS_NATURE).filter((m) => /dictionnaire|catalogue|_/.test(m)), []);
});

test('texteProduitConnu : les textes exacts de la ligne', () => {
  const texte = (nom) => texteProduitConnu(reconnaitre(nom).element);
  assert.equal(texte('pâtes'), '✓ Produit connu\u00A0: féculent\u00A0· Épicerie salée');
  assert.equal(texte('lardons'), '✓ Produit connu\u00A0: viande\u00A0· Charcuterie');
  assert.equal(texte('bœuf haché'), '✓ Produit connu\u00A0: viande\u00A0· Boucherie');
  assert.equal(texte('crevette décortiquée'), '✓ Produit connu\u00A0: poisson\u00A0· Poissonnerie');
  assert.equal(texte('carotte'), '✓ Produit connu\u00A0: légume\u00A0· Fruits et légumes');
  assert.equal(texte('beurre'), '✓ Produit connu\u00A0: produit laitier\u00A0· Crèmerie');
  assert.equal(texte('œuf'), '✓ Produit connu\u00A0: œuf\u00A0· Crèmerie');
  assert.equal(texte('sucre'), '✓ Produit connu\u00A0· Épicerie sucrée');
  assert.equal(texte('reblochon'), '✓ Produit connu\u00A0: produit laitier\u00A0· Fromages\u00A0· au lait cru, à vérifier');
  assert.equal(texte('noix'), '✓ Produit connu\u00A0· Épicerie salée\u00A0· fruits à coque, à vérifier');
  assert.equal(texte('amande effilée'), '✓ Produit connu\u00A0· Épicerie sucrée\u00A0· fruits à coque, à vérifier');
  // `cafe` et `gelatine_porc` : un seul mot, sans virgule.
  assert.equal(texte('café'), '✓ Produit connu\u00A0· Épicerie sucrée\u00A0· caféine, à vérifier');
  assert.equal(texte('cola'), '✓ Produit connu\u00A0· Boissons\u00A0· caféine, à vérifier');
  assert.equal(texte('gélatine'), '✓ Produit connu\u00A0· Épicerie sucrée\u00A0· gélatine animale, à vérifier');
  assert.equal(texte('espadon'), '✓ Produit connu\u00A0: poisson\u00A0· Poissonnerie\u00A0· grand prédateur, à vérifier');
  // Repère de préparation coché (la ligne dit ce qui sera enregistré) ; plusieurs repères réunis par « et ».
  assert.equal(texteProduitConnu({ marqueurs: ['viande', 'porc', 'charcuterie', 'cru'], rayon: 'charcuterie' }),
    '✓ Produit connu\u00A0: viande\u00A0· Charcuterie\u00A0· crue ou rosée, à vérifier');
  assert.equal(texteProduitConnu({ marqueurs: ['laitier', 'lait_cru', 'alcool_cru'], rayon: 'fromages' }),
    '✓ Produit connu\u00A0: produit laitier\u00A0· Fromages\u00A0· au lait cru et alcool non cuit, à vérifier');
  assert.equal(texteProduitConnu({ marqueurs: ['lait_cru', 'miel', 'fruit_coque'] }),
    '✓ Produit connu\u00A0· au lait cru, miel et fruits à coque, à vérifier');
  assert.equal(texteProduitConnu({ marqueurs: [] }), '✓ Produit connu');
  assert.equal(texteProduitConnu(null), '✓ Produit connu');
  // Chaque mot de repère est court et sans virgule (pris dans une phrase).
  for (const [marqueur, mot] of Object.entries(MOTS_REPERE)) {
    assert.equal(/[,_]/.test(mot), false, marqueur);
    assert.ok(MARQUEURS_PRECAUTION.includes(marqueur), marqueur);
  }
  assert.deepEqual(MARQUEURS_PRECAUTION.filter((m) => !Object.hasOwn(MOTS_REPERE, m)), [], 'un mot par repère de précaution');
  for (const element of elementsDuDictionnaire()) {
    const ligne = texteProduitConnu(element);
    assert.equal(/dictionnaire|catalogue|_/.test(ligne), false, element.produit);
    // Format : « ✓ Produit connu[ : nature] · rayon[ · repères, à vérifier] », sans virgule ailleurs.
    assert.match(ligne, /^✓ Produit connu(\u00A0: [^·,]+)?\u00A0· [^·,]+(\u00A0· [^·,]+, à vérifier)?$/, element.produit);
    assert.equal(/entier/.test(ligne), false, element.produit);
  }
});

// ——— Charcuterie crue ou sèche (MOTS_DOUTEUX) ———

test('MOTS_DOUTEUX : la charcuterie crue ou sèche propose `cru`, même pour un produit connu', () => {
  for (const nom of ['chorizo', 'rosette', 'jambon serrano', 'pancetta', 'viande des grisons', 'lonzo', 'saucisson sec', 'jambon cru',
    'coppa', 'bresaola', 'chorizos']) {
    assert.ok(reperesAttendus(nom).includes('cru'), nom);
    assert.deepEqual(reperesProposes(nom, { surveilles: SURVEILLES, connu: true }), ['cru'], nom);
  }
  assert.deepEqual(reperesAttendus('chorizo'), ['viande', 'cru']);
  // Au pluriel près sur chaque mot de l'expression : « jambons crus », « saucissons secs », « viande de grison ».
  for (const nom of ['jambons crus', 'jambons cru', 'jambons de bayonne', 'jambons de parme', 'saucissons secs', 'saucissons sec',
    'viande de grison']) {
    assert.deepEqual(reperesProposes(nom, { surveilles: SURVEILLES, connu: true }), ['cru'], nom);
    assert.equal(reconnaitre(nom)?.origine, 'dictionnaire', nom);
    assert.ok(saisir(nom, { surveilles: SURVEILLES }).ingredient.marqueurs.includes('cru'), nom);
  }
  // Le bandeau « à vérifier » de la fiche passe par la même fonction.
  assert.deepEqual(marqueursDouteux(plat('charcuterie', [ing('jambons crus', ['viande', 'porc', 'charcuterie'], { forme: 'fine' })]),
    { surveilles: SURVEILLES }), [{ produit: 'jambons crus', attendu: 'cru' }]);
  // Les faux amis restent muets.
  for (const nom of ['sauce chorizo', 'fromage à raclette']) assert.equal(reperesAttendus(nom).includes('cru'), false, nom);
});
