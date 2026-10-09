// T2d-1 « Relire les recettes » : demande DEMANDE-PRECAUTIONS, empreinte, validation d'une relecture, changements
// proposés, application, marque `reperesRelus`, repères gardés (remplacement, « Modifier », sauvegarde). Fixtures
// génériques (profil-a, profil-b, enfant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CASES_REPERES, MARQUEURS_PRECAUTION, VERSION_REPERES, VOCABULAIRES, estRelue, libelleRepere,
} from '../js/coeur/vocabulaire.js';
import {
  LOT_PRECAUTIONS, annonceRelecture, appliquerReperes, bilanRelecture, changementsRelecture, cleChangement, cleQuandMeme,
  comparerAuxReperesPres, ecrituresRelecture, effetsSurLesVersions, empreinteRelecture, garderReperes, lotDePrecautions,
  memeProduit, phrasesApercuRelecture, platsARelire, reporterReperes, validerPrecautions,
} from '../js/coeur/relecture.js';
import { VERSION_INSTRUCTIONS, texteCorrectionPourClaude, texteDemandePrecautions } from '../js/coeur/claude.js';
import { FORMAT, controlerInstructions, extrairePaquet, preparerImport, validerPaquet } from '../js/coeur/paquet.js';
import { appliquerImport } from '../js/coeur/import-local.js';
import { catalogueProduits, normaliserPourEdition, preparerModification } from '../js/coeur/edition.js';
import { evaluer, marqueursDouteux } from '../js/coeur/compatibilite.js';
import { ecrireRegime } from '../js/coeur/regles.js';
import {
  appliquerConditions, creerSauvegarde, lireSauvegarde, preparerRestauration, validerSauvegarde,
} from '../js/coeur/sauvegarde.js';

const doc = await readFile(new URL('../docs/projet-claude.md', import.meta.url), 'utf8');

const PROFILS = [
  { id: 'profil-a', nom: 'Adulte A', ordre: 0, regles: [] },
  { id: 'profil-b', nom: 'Adulte B', ordre: 1, regles: ecrireRegime({ regime: 'sans_viande' }) },
  { id: 'enfant', nom: 'Enfant', ordre: 2, coefPortion: 0.5 },
];

const ing = (produit, qte, unite, rayon, marqueurs, extra = {}) => ({ produit, qte, unite, rayon, marqueurs, ...extra });

// Les quatre fiches de l'exemple de docs/projet-claude.md (section 5, DEMANDE-PRECAUTIONS).
const LOT_DOC = [
  {
    id: 'tiramisu', nom: 'Tiramisu', type: 'dessert', statutRecette: 'brouillon', portionsBase: 6,
    ingredients: [
      ing('mascarpone', 250, 'g', 'cremerie', ['laitier']),
      ing('œuf', 3, 'pc', 'cremerie', ['oeuf']),
      ing('sucre', 80, 'g', 'epicerie_sucree', []),
      ing('café fort', 30, 'cl', 'epicerie_sucree', ['cafe']),
      ing('marsala', 5, 'cl', 'boissons', []),
      ing('biscuit à la cuillère', 24, 'pc', 'epicerie_sucree', ['feculent']),
    ],
    etapes: ['Séparer les blancs des jaunes.', 'Fouetter les jaunes avec le sucre, puis avec le mascarpone.',
      'Monter les blancs en neige et les incorporer.', 'Tremper les biscuits dans le café mêlé au marsala.',
      'Alterner biscuits et crème ; réserver 6 heures au frais.'],
  },
  {
    id: 'tartiflette', nom: 'Tartiflette', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [
      ing('pomme de terre', 1, 'kg', 'fruits_legumes', ['feculent']),
      ing('reblochon', 1, 'pc', 'fromages', ['laitier', 'lait_cru']),
      ing('lardon fumé', 200, 'g', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' }),
      ing('oignon jaune', 1, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
      ing('crème fraîche épaisse', 20, 'cl', 'cremerie', ['laitier']),
    ],
    etapes: ['Cuire les pommes de terre à l\'eau.', 'Faire revenir les lardons et l\'oignon.',
      'Tout mettre dans un plat, couvrir du reblochon coupé en deux.', 'Cuire au four jusqu\'à ce que le fromage bouillonne.'],
    cuisson: [{ appareil: 'plaque', dureeMin: 20 }, { appareil: 'four', tempC: 200, dureeMin: 25 }],
  },
  {
    id: 'salade-lentilles-saumon-fume', nom: 'Salade de lentilles au saumon fumé', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [
      ing('lentille verte', 300, 'g', 'epicerie_salee', ['feculent']),
      ing('saumon fumé', 4, 'tranche', 'poissonnerie', ['poisson', 'cru']),
      ing('cerneau de noix', 50, 'g', 'epicerie_sucree', []),
      ing('camembert', 1, 'pc', 'fromages', ['laitier']),
      ing('sauce soja', 2, 'cs', 'epicerie_salee', ['soja']),
    ],
    etapes: ['Cuire les lentilles, les laisser tiédir.', 'Ajouter le saumon en lanières, les cerneaux de noix et le camembert en dés.',
      'Assaisonner d\'un trait de sauce soja.'],
    cuisson: [{ appareil: 'plaque', dureeMin: 25 }],
  },
  {
    id: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [
      ing('pâtes courtes', 400, 'g', 'epicerie_salee', ['feculent']),
      ing('jambon blanc', 4, 'tranche', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'fine' }),
      ing('crème fraîche épaisse', 20, 'cl', 'cremerie', ['laitier']),
      ing('gruyère râpé', 100, 'g', 'fromages', ['laitier']),
      ing('oignon jaune', 1, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
    ],
    etapes: ['Cuire les pâtes al dente.', 'Faire revenir l\'oignon émincé, ajouter la crème et le jambon coupé fin.',
      'Mélanger avec les pâtes, couvrir de gruyère, gratiner.'],
    cuisson: [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, dureeMin: 20 }],
  },
];
const [TIRAMISU, TARTIFLETTE, SALADE, GRATIN] = LOT_DOC;

/** Contenu des blocs de code d'un langage donné ('' : blocs sans langage). */
function blocs(langage) {
  return [...doc.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].filter((m) => m[1] === langage).map((m) => m[2].trimEnd());
}

/** Réponse de relecture (objet paquet). */
const reponse = (plats, instructions = VERSION_INSTRUCTIONS) => ({ format: FORMAT, instructions, plats });
const entree = (plat, precautions = [], extra = {}) => ({ id: plat.id, nom: plat.nom, empreinte: empreinteRelecture(plat), precautions, ...extra });

/** Lot validé puis préparé contre des plats. */
function preparer(paquet, plats, options = {}) {
  const validation = validerPaquet(paquet, { profils: PROFILS });
  assert.equal(validation.valide, true, JSON.stringify(validation.plats.flatMap((p) => p.erreurs)));
  return preparerImport(validation.plats.map((p) => p.donnees), { plats, profils: PROFILS, ...options });
}

// ——— Texte et alignement ———

test('1. texteDemandePrecautions des quatre fiches = exemple du document, empreintes comprises', () => {
  const texte = texteDemandePrecautions(LOT_DOC);
  assert.ok(blocs('').includes(texte), 'exemple DEMANDE-PRECAUTIONS différent du texte copié');
  const lignes = texte.split('\n');
  assert.equal(lignes[0], 'DEMANDE-PRECAUTIONS paquet@1');
  assert.equal(lignes[1], `instructions: ${VERSION_INSTRUCTIONS}`);
  assert.equal(lignes[2], `repères: ${MARQUEURS_PRECAUTION.join(', ')}`);
  // La réponse du document recopie les empreintes de la demande.
  const json = JSON.parse(blocs('json').find((b) => b.includes('"precautions"')));
  assert.deepEqual(json.plats.map((p) => p.empreinte), LOT_DOC.map(empreinteRelecture));
});

test('2. la demande ne dit rien des personnes : ni pour, ni versions, ni règles, ni date, ni âge', () => {
  const texte = texteDemandePrecautions(LOT_DOC);
  assert.doesNotMatch(texte, /pour:/);
  assert.doesNotMatch(texte, /versions:/);
  assert.doesNotMatch(texte, /règles:/);
  assert.doesNotMatch(texte, /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(texte, /\b(ans?|mois)\b/);
  assert.doesNotMatch(texte, /profil|enfant/);
  // La signature ne prend aucun profil : un second argument est sans effet.
  assert.equal(texteDemandePrecautions(LOT_DOC, { profils: PROFILS }), texte);
  assert.doesNotMatch(texte, /[\u00A0\u202F]/);
});

test('3. plats sans ingrédients exclus, LOT_PRECAUTIONS au plus, lignes vides omises', () => {
  const vide = { id: 'attente', nom: 'Attente' };
  const plats = [vide, ...Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`, nom: `P${i}`, ingredients: [ing('sel', 1, 'g', 'divers', [])],
  }))];
  const texte = texteDemandePrecautions(plats);
  assert.equal(texte.split('\n').filter((l) => l.startsWith('- id: ')).length, LOT_PRECAUTIONS);
  assert.doesNotMatch(texte, /id: attente/);
  assert.doesNotMatch(texte, /étapes:/);
  assert.doesNotMatch(texte, /cuisson:/);
  assert.match(texte, /\n {2}ingrédients: sel \[\]/);
  assert.doesNotMatch(texteDemandePrecautions([TIRAMISU]), /cuisson:/);
});

test('4. empreinteRelecture : stable, 6 caractères ; change avec produit, repère, étape, cuisson ; pas avec quantité ni nom', () => {
  const e = empreinteRelecture(TARTIFLETTE);
  assert.match(e, /^[0-9a-z]{6}$/);
  assert.equal(empreinteRelecture(structuredClone(TARTIFLETTE)), e);
  const avec = (changement) => empreinteRelecture({ ...structuredClone(TARTIFLETTE), ...changement });
  const ingredients = structuredClone(TARTIFLETTE.ingredients);
  assert.notEqual(avec({ ingredients: [...ingredients, ing('ail', 1, 'pc', 'fruits_legumes', [])] }), e);
  assert.notEqual(avec({ ingredients: ingredients.map((i, k) => (k === 1 ? { ...i, marqueurs: ['laitier'] } : i)) }), e);
  assert.notEqual(avec({ etapes: ['Tout cuire.'] }), e);
  assert.notEqual(avec({ cuisson: [{ appareil: 'plaque', dureeMin: 40 }] }), e);
  assert.equal(avec({ ingredients: ingredients.map((i) => ({ ...i, qte: i.qte * 2 })) }), e);
  assert.equal(avec({ nom: 'Tartiflette savoyarde', portionsBase: 8 }), e);
});

test('5. extrairePaquet refuse une demande DEMANDE-PRECAUTIONS recollée', () => {
  assert.equal(extrairePaquet(texteDemandePrecautions(LOT_DOC)).erreur, 'demande');
});

test('6. correction d’un lot de relecture = exemple du document ; même fin pour une recette entière', () => {
  const json = JSON.parse(blocs('json').find((b) => b.includes('"precautions"')));
  json.plats[2].precautions[1].poser = ['fruits_coque'];
  const validation = validerPaquet(json, { profils: PROFILS });
  assert.equal(validation.valide, false);
  assert.equal(validation.relecture, true);
  const correction = texteCorrectionPourClaude(validation);
  assert.ok(blocs('').includes(correction), `exemple CORRECTION de relecture différent :\n${correction}`);

  // Une entrée rendue comme recette entière dans un lot de relecture : même texte de fin.
  const mixte = reponse([entree(TIRAMISU), { ...GRATIN }]);
  const texte = texteCorrectionPourClaude(validerPaquet(mixte, { profils: PROFILS }));
  const lignes = texte.split('\n');
  assert.equal(lignes.at(-1), '(Rends seulement { "id", "nom", "empreinte", "precautions" } de chaque plat du lot, corrigé, en un seul bloc.)');
  assert.ok(lignes.includes('- plats[1] (gratin-pates-jambon) : rends seulement { "id", "nom", "empreinte", "precautions" }, sans la recette ni les versions'));
  assert.ok(lignes.includes('- Rien n’a été enregistré : rends aussi, telles quelles, les relectures des autres plats du lot (tiramisu).'));
});

test('7. MARQUEURS_PRECAUTION = union des `retire` des cases, dans le vocabulaire et le document', () => {
  assert.deepEqual(MARQUEURS_PRECAUTION, [...new Set(CASES_REPERES.flatMap((c) => c.retire))]);
  assert.deepEqual(MARQUEURS_PRECAUTION, ['cru', 'poisson_predateur', 'lait_cru', 'fruit_coque', 'cafe', 'cafeine',
    'alcool_cru', 'oeuf_cru', 'miel', 'soja', 'bouillon_viande', 'gelatine_animale', 'gelatine_porc', 'graisse_animale']);
  for (const m of MARQUEURS_PRECAUTION) {
    assert.ok(VOCABULAIRES.marqueurs.includes(m), m);
    assert.ok(doc.includes(`\`${m}\``), m);
  }
});

test('8. le document cite la demande, ses champs et les définitions de la version 5', () => {
  for (const mot of ['DEMANDE-PRECAUTIONS', '`precautions`', '`poser`', '`enlever`', '`pourquoi`', '`empreinte`', 'mont-d\'or', 'au moins deux heures']) {
    assert.ok(doc.includes(mot), mot);
  }
  assert.doesNotMatch(doc, /au moins une heure/);
  // Après l'exemple de versions : le premier bloc json sans « ingredients » reste celui des versions.
  const premier = blocs('json').find((b) => !b.includes('"ingredients"'));
  assert.ok(premier.includes('"variantes"') && !premier.includes('"precautions"'));
});

// ——— Validation ———

const erreursDe = (validation) => [...validation.erreurs, ...validation.plats.flatMap((p) => p.erreurs)].map((e) => e.pourClaude);

test('9. erreurs : precautions non liste, élément non objet, produit manquant, repère inconnu, contradiction, empreinte', () => {
  const cas = [
    [{ precautions: 'oui' }, 'plats[0] (tiramisu) precautions : liste attendue'],
    [{ precautions: ['marsala'] }, 'plats[0] (tiramisu) precautions[0] : objet { "produit", "poser", "enlever", "pourquoi" } attendu'],
    [{ precautions: [{ poser: ['miel'] }] }, 'plats[0] (tiramisu) precautions[0] : produit manquant'],
    [{ precautions: [{ produit: 'marsala', poser: { a: 1 } }] }, 'plats[0] (tiramisu) precautions[0] « marsala » : poser : liste attendue'],
    [{ precautions: [{ produit: 'noix', poser: ['fruits_coque'] }] },
      `plats[0] (tiramisu) precautions[0] « noix » : repère \`fruits_coque\` inconnu ; repères de la relecture : ${MARQUEURS_PRECAUTION.map((m) => `\`${m}\``).join(', ')}`],
    [{ precautions: [{ produit: 'marsala', poser: ['alcool_cru'], enlever: ['alcool_cru'] }] },
      'plats[0] (tiramisu) precautions[0] « marsala » : `alcool_cru` à la fois dans poser et dans enlever'],
    [{ precautions: [], empreinte: undefined }, 'plats[0] (tiramisu) : empreinte manquante, recopie celle de la demande'],
  ];
  for (const [extra, attendu] of cas) {
    const brut = { ...entree(TIRAMISU), ...extra };
    if (Object.hasOwn(extra, 'empreinte')) delete brut.empreinte;
    const validation = validerPaquet(reponse([brut]));
    assert.equal(validation.valide, false, attendu);
    assert.deepEqual(erreursDe(validation), [attendu]);
  }
  // Messages affichés sans mot technique.
  const inconnu = validerPaquet(reponse([entree(TIRAMISU, [{ produit: 'noix', poser: ['fruits_coque'] }])]));
  assert.equal(inconnu.plats[0].erreurs[0].message, 'Claude a proposé un repère inconnu pour «\u00A0noix\u00A0».');
  const mal = validerPaquet(reponse([entree(TIRAMISU, 'oui')]));
  assert.equal(mal.plats[0].erreurs[0].message, 'La relecture de «\u00A0Tiramisu\u00A0» est mal formée.');
});

test('10. repère connu hors relecture : ni erreur ni écriture, montré ; laitier à côté de lait_cru, sans rien dire', () => {
  const lu = validerPrecautions([
    { produit: 'lardon fumé', poser: ['viande'] },
    { produit: 'camembert', poser: ['lait_cru', 'laitier'] },
    { produit: 'mascarpone', enlever: ['laitier'] },
  ]);
  assert.deepEqual(lu.erreurs, []);
  assert.deepEqual(lu.horsRelecture, [
    { produit: 'lardon fumé', marqueur: 'viande', sens: 'poser' },
    { produit: 'mascarpone', marqueur: 'laitier', sens: 'enlever' },
  ]);
  assert.deepEqual(lu.precautions.map((p) => [p.produit, p.poser, p.enlever]), [
    ['lardon fumé', [], []], ['camembert', ['lait_cru'], []], ['mascarpone', [], []],
  ]);
  const prep = preparer(reponse([entree(TARTIFLETTE, [{ produit: 'lardon fumé', poser: ['viande'] }])]), [TARTIFLETTE]);
  assert.deepEqual(prep.elements[0].infos, ['Claude signale aussi «\u00A0viande\u00A0» pour «\u00A0lardon fumé\u00A0»\u00A0: à corriger dans Modifier si c’est juste.']);
  assert.deepEqual(prep.elements[0].ajouts, []);
});

test('11. tolérances : chaîne seule, « Lait cru », accents ; éléments du même produit réunis ; nom absent accepté', () => {
  const lu = validerPrecautions([
    { produit: 'Camembert', poser: 'Lait cru', pourquoi: 'Servi cru.' },
    { produit: 'camemberts', poser: ['Fruit_Coque'] },
    { produit: 'Œufs', poser: ['œuf cru'] },
  ]);
  assert.deepEqual(lu.erreurs, []);
  assert.deepEqual(lu.precautions, [
    { produit: 'camembert', poser: ['lait_cru', 'fruit_coque'], enlever: [], pourquoi: 'Servi cru.' },
    { produit: 'œufs', poser: ['oeuf_cru'], enlever: [], pourquoi: '' },
  ]);
  const sansNom = { id: 'tiramisu', empreinte: empreinteRelecture(TIRAMISU), precautions: [] };
  const validation = validerPaquet(reponse([sansNom]));
  assert.equal(validation.valide, true);
  assert.deepEqual(validation.plats[0].donnees, { id: 'tiramisu', empreinte: empreinteRelecture(TIRAMISU), precautions: [] });
  // `pourquoi` coupé à 120 caractères.
  assert.equal(validerPrecautions([{ produit: 'x', poser: ['miel'], pourquoi: 'a'.repeat(300) }]).precautions[0].pourquoi.length, 120);
});

test('12. statut ou type recopiés par habitude : non bloquants', () => {
  const validation = validerPaquet(reponse([{ ...entree(TIRAMISU), statutRecette: 'brouillon', type: 'dessert' }]));
  assert.equal(validation.valide, true);
  assert.deepEqual(validation.plats[0].avertissements, []);
  assert.deepEqual(Object.keys(validation.plats[0].donnees).sort(), ['empreinte', 'id', 'nom', 'precautions']);
});

test('13. lot de relecture : recette, versions ou precautions absentes → erreur ; aucun plat créé', () => {
  const cas = [
    [{ ...entree(TIRAMISU), ingredients: TIRAMISU.ingredients }, 'rends seulement { "id", "nom", "empreinte", "precautions" }, sans la recette ni les versions'],
    [{ ...entree(TIRAMISU), variantes: [] }, 'rends seulement { "id", "nom", "empreinte", "precautions" }, sans la recette ni les versions'],
    [{ id: 'tiramisu', nom: 'Tiramisu', empreinte: 'abcdef' }, 'precautions : liste attendue, même vide'],
  ];
  for (const [brut, attendu] of cas) {
    const validation = validerPaquet(reponse([entree(GRATIN), brut]));
    assert.equal(validation.relecture, true);
    assert.equal(validation.valide, false);
    assert.deepEqual(erreursDe(validation), [`plats[1] (tiramisu) : ${attendu}`]);
  }
  assert.equal(validerPaquet(reponse([entree(GRATIN), { ...entree(TIRAMISU), ingredients: [] }])).plats[1].erreurs[0].message,
    'Claude a rendu la recette entière de «\u00A0Tiramisu\u00A0» au lieu de sa seule relecture.');
  // Un id inconnu n'est jamais créé.
  const prep = preparer(reponse([{ id: 'paella', nom: 'Paella', empreinte: 'abcdef', precautions: [] }]), [GRATIN]);
  assert.equal(prep.elements[0].statut, 'inconnu');
  assert.deepEqual(prep.ecritures, []);
  assert.deepEqual(appliquerImport([GRATIN], [{ id: 'paella', mode: 'precautions', ajouts: [], retraits: [], marquerRelue: true, empreinte: 'abcdef' }]), [GRATIN]);
});

test('14. relectureEnCours : recette entière pour un plat du lot → erreur ; par « Coller la recette » → remplacement', () => {
  const recue = { ...structuredClone(GRATIN), etapes: ['Tout gratiner.'] };
  const validation = validerPaquet(reponse([recue]), { profils: PROFILS });
  const valides = validation.plats.map((p) => p.donnees);
  const prep = preparerImport(valides, { plats: [GRATIN], profils: PROFILS, relectureEnCours: ['gratin-pates-jambon'] });
  assert.deepEqual(prep.erreurs.map((e) => e.pourClaude), ['plats[0] (gratin-pates-jambon) : rends seulement { "id", "nom", "empreinte", "precautions" }, sans la recette ni les versions']);
  assert.equal(prep.relecture, true);
  assert.deepEqual(prep.ecritures, []);
  const correction = texteCorrectionPourClaude(prep).split('\n');
  assert.equal(correction.at(-1), '(Rends seulement { "id", "nom", "empreinte", "precautions" } de chaque plat du lot, corrigé, en un seul bloc.)');
  const cible = preparerImport(valides, { plats: [GRATIN], profils: PROFILS, relectureEnCours: ['gratin-pates-jambon'], cible: 'gratin-pates-jambon' });
  assert.deepEqual(cible.erreurs, []);
  assert.equal(cible.elements[0].statut, 'remplace');
  // Plat déjà relu : remplacement ordinaire aussi.
  const relu = preparerImport(valides, { plats: [{ ...GRATIN, reperesRelus: 1 }], profils: PROFILS, relectureEnCours: ['gratin-pates-jambon'] });
  assert.equal(relu.elements[0].statut, 'remplace');
});

// ——— Changements ———

test('15. ajout ; ajout déjà présent, y compris par implication, ignoré', () => {
  const ch = changementsRelecture(TIRAMISU, [
    { produit: 'marsala', poser: ['alcool_cru'], enlever: [], pourquoi: 'Ajouté sans cuisson.' },
    { produit: 'café fort', poser: ['cafeine'], enlever: [], pourquoi: '' },
    { produit: 'mascarpone', poser: [], enlever: [], pourquoi: '' },
  ]);
  assert.deepEqual(ch.ajouts, [{
    cle: 'tiramisu|marsala|alcool_cru|ajout', produit: 'marsala', marqueur: 'alcool_cru', libelle: 'alcool non cuit', pourquoi: 'Ajouté sans cuisson.',
  }]);
  assert.deepEqual(ch.retraits, []);
  assert.equal(ch.complete, true);
});

test('16. retraits : présent, absent, case entière, repère général gardé', () => {
  const plat = {
    id: 'p', nom: 'P', ingredients: [
      ing('café', 1, 'cl', 'divers', ['cafe']),
      ing('thé', 1, 'cl', 'divers', ['cafeine', 'cafe']),
      ing('gélatine', 2, 'pc', 'divers', ['gelatine_porc', 'gelatine_animale']),
      ing('gélatine de porc', 2, 'pc', 'divers', ['gelatine_porc']),
      ing('reblochon', 1, 'pc', 'fromages', ['laitier', 'lait_cru']),
    ],
  };
  const p = (produit, enlever) => ({ produit, poser: [], enlever, pourquoi: '' });
  const ch = changementsRelecture(plat, [p('reblochon', ['lait_cru']), p('reblochon', ['miel']), p('thé', ['cafeine']),
    p('gélatine', ['gelatine_animale']), p('gélatine de porc', ['gelatine_porc']), p('café', ['cafe'])]);
  assert.deepEqual(ch.retraits.map((r) => [r.produit, r.marqueur, r.pourquoi]), [
    ['reblochon', 'lait_cru', '(sans raison donnée)'], ['thé', 'cafeine', '(sans raison donnée)'],
    ['gélatine', 'gelatine_animale', '(sans raison donnée)'], ['gélatine de porc', 'gelatine_porc', '(sans raison donnée)'],
    ['café', 'cafe', '(sans raison donnée)'],
  ]);
  const apres = appliquerReperes(plat.ingredients, { retraits: ch.retraits });
  assert.deepEqual(apres.map((i) => i.marqueurs), [['cafeine'], [], [], ['gelatine_animale'], ['laitier']]);
});

test('17. memeProduit : pluriels dans les deux sens ; ajout sur deux occurrences ; retrait sur deux occurrences ignoré', () => {
  assert.equal(memeProduit('pommes de terre', 'pomme de terre'), true);
  assert.equal(memeProduit('pomme de terre', 'pommes de terre'), true);
  assert.equal(memeProduit('œufs', 'oeuf'), true);
  assert.equal(memeProduit('Oeuf', 'œufs'), true);
  assert.equal(memeProduit('pomme', 'pomme de terre'), false);
  assert.equal(memeProduit('', ''), false);
  const plat = { id: 'p', nom: 'P', ingredients: [
    ing('camembert', 1, 'pc', 'fromages', ['laitier']), ing('farine', 1, 'g', 'divers', []), ing('camemberts', 1, 'pc', 'fromages', ['laitier', 'lait_cru']),
  ] };
  const ajout = changementsRelecture(plat, [{ produit: 'camembert', poser: ['lait_cru'], enlever: [], pourquoi: '' }]);
  assert.equal(ajout.ajouts.length, 1);
  assert.deepEqual(appliquerReperes(plat.ingredients, ajout).map((i) => i.marqueurs), [['laitier', 'lait_cru'], [], ['laitier', 'lait_cru']]);
  const retrait = changementsRelecture(plat, [{ produit: 'camembert', poser: [], enlever: ['lait_cru'], pourquoi: '' }]);
  assert.deepEqual(retrait.retraits, []);
  assert.equal(retrait.complete, true);
  assert.deepEqual(retrait.ignores, [{ produit: 'camembert', marqueur: 'lait_cru', raison: 'deux_fois' }]);
  assert.deepEqual(retrait.avertissements, ['«\u00A0camembert\u00A0» apparaît deux fois\u00A0: à enlever dans Modifier si c’est juste.']);
  // Même appliqué directement, un retrait sur deux occurrences n'agit pas.
  assert.deepEqual(appliquerReperes(plat.ingredients, { retraits: [{ produit: 'camembert', marqueur: 'lait_cru' }] }), plat.ingredients);
});

test('18. ingrédient introuvable → avertissement, complete faux, les autres changements gardés', () => {
  const ch = changementsRelecture(TIRAMISU, [
    { produit: 'marsala sec', poser: ['alcool_cru'], enlever: [], pourquoi: '' },
    { produit: 'œufs', poser: ['oeuf_cru'], enlever: [], pourquoi: '' },
  ]);
  assert.equal(ch.complete, false);
  assert.deepEqual(ch.introuvables, ['marsala sec']);
  assert.deepEqual(ch.avertissements, ['«\u00A0Tiramisu\u00A0»\u00A0: «\u00A0marsala sec\u00A0» n’est pas dans la recette\u00A0: ignoré.']);
  assert.deepEqual(ch.ajouts.map((a) => [a.produit, a.marqueur, a.libelle]), [['œuf', 'oeuf_cru', 'œuf cru ou peu cuit']]);
});

test('19. nature : cru sur un légume refusé ; poisson_predateur sur une viande refusé ; sur « espadon » sans poisson accepté', () => {
  const plat = { id: 'p', nom: 'P', ingredients: [
    ing('carotte', 1, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
    ing('bœuf', 1, 'g', 'boucherie', ['viande', 'boeuf'], { forme: 'morceaux' }),
    ing('espadon', 1, 'g', 'poissonnerie', []),
  ] };
  const ch = changementsRelecture(plat, [
    { produit: 'carotte', poser: ['cru'], enlever: [], pourquoi: '' },
    { produit: 'bœuf', poser: ['poisson_predateur', 'cru'], enlever: [], pourquoi: '' },
    { produit: 'espadon', poser: ['poisson_predateur'], enlever: [], pourquoi: '' },
  ]);
  assert.equal(ch.complete, false);
  assert.deepEqual(ch.ignores, [
    { produit: 'carotte', marqueur: 'cru', raison: 'nature' }, { produit: 'bœuf', marqueur: 'poisson_predateur', raison: 'nature' },
  ]);
  assert.deepEqual(ch.ajouts.map((a) => [a.produit, a.marqueur, a.libelle]), [['bœuf', 'cru', 'crue ou rosée'], ['espadon', 'poisson_predateur', 'espadon, requin, marlin']]);
  assert.equal(ch.avertissements[0], '«\u00A0carotte\u00A0» n’est marqué ni comme viande ni comme poisson\u00A0: corrigez-le dans Modifier, puis la recette reviendra à relire.');
});

// ——— Application ———

test('20. appliquerReperes : seuls les marqueurs, champs inconnus gardés, ordre stable, sans doublon ni undefined', () => {
  const ingredients = [
    { produit: 'marsala', qte: 5, unite: 'cl', rayon: 'boissons', marqueurs: ['feculent'], inconnu: 'garde' },
    { produit: 'sucre', qte: 80, unite: 'g', rayon: 'epicerie_sucree' },
  ];
  const apres = appliquerReperes(ingredients, { ajouts: [{ produit: 'marsala', marqueur: 'alcool_cru' }, { produit: 'Marsala', marqueur: 'alcool_cru' }] });
  assert.deepEqual(apres, [
    { produit: 'marsala', qte: 5, unite: 'cl', rayon: 'boissons', marqueurs: ['feculent', 'alcool_cru'], inconnu: 'garde' },
    { produit: 'sucre', qte: 80, unite: 'g', rayon: 'epicerie_sucree' },
  ]);
  assert.ok(!JSON.stringify(apres).includes('undefined'));
  assert.notEqual(apres[1], ingredients[1], 'copies');
  assert.deepEqual(appliquerReperes(ingredients, {}), ingredients);
  assert.deepEqual(appliquerReperes(ingredients, { ajouts: [{ produit: 'riz', marqueur: 'miel' }] }), ingredients);
  // Un marqueur hors relecture n'est jamais écrit.
  assert.deepEqual(appliquerReperes(ingredients, { ajouts: [{ produit: 'sucre', marqueur: 'viande' }] }), ingredients);
  // Quantité changée entre-temps dans la liste reçue : gardée.
  const changee = [{ ...ingredients[0], qte: 9 }];
  assert.equal(appliquerReperes(changee, { ajouts: [{ produit: 'marsala', marqueur: 'alcool_cru' }] })[0].qte, 9);
});

// ——— preparerImport, branche précautions ———

test('21. inconnu sans plat créé ; corbeille et ⏳ sans écriture ni erreur', () => {
  const jete = { ...structuredClone(GRATIN), corbeille: { le: { seconds: 1 }, par: 'x' } };
  const attente = { id: 'chili', nom: 'Chili' };
  const prep = preparer(reponse([
    { id: 'paella', nom: 'Paella', empreinte: 'aaaaaa', precautions: [] },
    entree(GRATIN), { id: 'chili', nom: 'Chili', empreinte: 'aaaaaa', precautions: [] }, entree(TIRAMISU),
  ]), [jete, attente, TIRAMISU]);
  assert.deepEqual(prep.elements.map((e) => e.statut), ['inconnu', 'corbeille', 'attente', 'relecture']);
  assert.deepEqual(prep.erreurs, []);
  assert.deepEqual(prep.ecritures.map((e) => e.id), ['tiramisu']);
  assert.deepEqual(prep.demandesAClore, []);
});

test('22. déjà relue : aucune écriture, même si Claude propose un ajout', () => {
  const relu = { ...TIRAMISU, reperesRelus: VERSION_REPERES };
  const prep = preparer(reponse([entree(relu, [{ produit: 'marsala', poser: ['alcool_cru'] }]), entree({ ...GRATIN, reperesRelus: 1 })]), [relu, { ...GRATIN, reperesRelus: 1 }]);
  assert.deepEqual(prep.elements.map((e) => [e.statut, e.propose]), [['dejaRelue', true], ['dejaRelue', false]]);
  assert.deepEqual(prep.elements[0].avertissements, ['Pour changer un repère\u00A0: Modifier.']);
  assert.deepEqual(prep.ecritures, []);
  assert.deepEqual(ecrituresRelecture(prep, { [cleQuandMeme('tiramisu')]: true }), []);
});

test('23. plat modifié à la main : ni modifieeLe ni modifieePar ; nom différent ignoré', () => {
  const modifie = { ...structuredClone(TIRAMISU), modifieeLe: { seconds: 5 }, modifieePar: 'a@b.c' };
  const prep = preparer(reponse([{ ...entree(modifie, [{ produit: 'marsala', poser: ['alcool_cru'] }]), nom: 'Tiramisu maison' }]), [modifie]);
  assert.equal(prep.elements[0].nom, 'Tiramisu');
  assert.deepEqual(prep.ecritures, [{
    id: 'tiramisu', mode: 'precautions', ajouts: [{ produit: 'marsala', marqueur: 'alcool_cru' }], retraits: [],
    marquerRelue: true, empreinte: empreinteRelecture(modifie),
  }]);
  const local = appliquerImport([modifie], prep.ecritures)[0];
  assert.deepEqual(local.modifieeLe, { seconds: 5 });
  assert.equal(local.modifieePar, 'a@b.c');
  assert.equal(local.nom, 'Tiramisu');
});

test('24. choix par repère : ajout décoché, retrait coché ; marquée relue malgré un ajout décoché', () => {
  const prep = preparer(reponse([
    entree(TIRAMISU, [{ produit: 'œuf', poser: ['oeuf_cru'] }, { produit: 'marsala', poser: ['alcool_cru'] }]),
    entree(TARTIFLETTE, [{ produit: 'reblochon', enlever: ['lait_cru'], pourquoi: 'Bien cuit au four, dans le plat.' }]),
  ]), [TIRAMISU, TARTIFLETTE]);
  // Par défaut : ajouts cochés, retrait décoché.
  assert.deepEqual(prep.ecritures.map((e) => [e.id, e.ajouts.length, e.retraits.length, e.marquerRelue]), [['tiramisu', 2, 0, true], ['tartiflette', 0, 0, true]]);
  const choix = { [cleChangement('tiramisu', 'marsala', 'alcool_cru', 'ajout')]: false, [cleChangement('tartiflette', 'reblochon', 'lait_cru', 'retrait')]: true };
  const ecritures = ecrituresRelecture(prep, choix);
  assert.deepEqual(ecritures.map((e) => [e.id, e.ajouts, e.retraits, e.marquerRelue]), [
    ['tiramisu', [{ produit: 'œuf', marqueur: 'oeuf_cru' }], [], true],
    ['tartiflette', [], [{ produit: 'reblochon', marqueur: 'lait_cru' }], true],
  ]);
  const retrait = prep.elements[1].retraits[0];
  assert.equal(retrait.libelle, 'au lait cru');
  assert.equal(retrait.pourquoi, 'Bien cuit au four, dans le plat.');
});

test('25. empreinte de Claude différente → pas marquée relue ; « quand même » → marquée', () => {
  const prep = preparer(reponse([{ ...entree(TIRAMISU, [{ produit: 'marsala', poser: ['alcool_cru'] }]), empreinte: 'zzzzzz' }]), [TIRAMISU]);
  const element = prep.elements[0];
  assert.equal(element.change, true);
  assert.equal(element.marquerRelue, false);
  assert.ok(element.avertissements.includes('«\u00A0Tiramisu\u00A0» a changé depuis la demande\u00A0: les repères cochés seront enregistrés, mais elle restera à relire.'));
  assert.equal(prep.ecritures[0].marquerRelue, false);
  assert.equal(prep.ecritures[0].empreinte, empreinteRelecture(TIRAMISU));
  assert.equal(ecrituresRelecture(prep, { [cleQuandMeme('tiramisu')]: true })[0].marquerRelue, true);
  // Rien coché et pas relue : aucune écriture.
  assert.deepEqual(ecrituresRelecture(prep, { [cleChangement('tiramisu', 'marsala', 'alcool_cru', 'ajout')]: false }), []);
  // Introuvable : pas marquée relue non plus.
  const incomplet = preparer(reponse([entree(TIRAMISU, [{ produit: 'rhum', poser: ['alcool_cru'] }])]), [TIRAMISU]);
  assert.equal(incomplet.elements[0].marquerRelue, false);
  assert.deepEqual(incomplet.ecritures, []);
});

test('26. réponse d’une autre version des instructions : pas d’écriture, refus « instructions »', () => {
  const paquet = reponse([entree(TIRAMISU, [{ produit: 'marsala', poser: ['alcool_cru'] }])], VERSION_INSTRUCTIONS - 1);
  const controle = controlerInstructions(paquet);
  assert.ok(controle);
  const prep = preparer(paquet, [TIRAMISU], { controle });
  assert.equal(prep.refus, 'instructions');
  assert.equal(prep.messageRefus, 'Cette relecture ne vient pas des instructions actuelles. Recopiez-les depuis Réglages › Projet Claude, puis redemandez ce lot.');
  assert.deepEqual(prep.ecritures, []);
  assert.deepEqual(ecrituresRelecture(prep, {}), []);
});

test('27. effet sur l’adulte : un bouillon de viande ajouté → version à créer ; décoché → plus de ligne', () => {
  const veloute = { id: 'veloute', nom: 'Velouté de potiron', statutRecette: 'brouillon', portionsBase: 4, ingredients: [
    ing('potiron', 1, 'kg', 'fruits_legumes', ['legume'], { role: 'principal' }), ing('bouillon de volaille', 1, 'l', 'epicerie_salee', []),
  ] };
  const prep = preparer(reponse([entree(veloute, [{ produit: 'bouillon de volaille', poser: ['bouillon_viande'] }])]), [veloute]);
  assert.deepEqual(prep.elements[0].effets, [{
    pour: 'profil-b', nom: 'Adulte B', libelles: ['bouillon de viande'],
    texte: '🌿 Avec ces repères, Adulte B aura besoin d’une version de ce plat (bouillon de viande).',
  }]);
  assert.deepEqual(effetsSurLesVersions(veloute, { ajouts: [] }, PROFILS), []);
  // Le prénom ne vient que des profils : aucun profil, aucune ligne.
  assert.deepEqual(effetsSurLesVersions(veloute, { ajouts: prep.elements[0].ajouts }, []), []);
});

// ——— Marque reperesRelus ———

test('28. platsARelire : corbeille, ⏳ et relus exclus ; tous les types ; soupçons, type, nom ; sans profils', () => {
  const p = (id, nom, extra = {}) => ({ id, nom, statutRecette: 'brouillon', ingredients: [ing('sel', 1, 'g', 'divers', [])], ...extra });
  const plats = [
    p('b', 'Bœuf mode'),
    p('a', 'Apéro', { type: 'apero' }),
    p('d', 'Dessert', { type: 'dessert' }),
    p('n', 'Noix', { ingredients: [ing('noix', 1, 'g', 'divers', [])] }), // soupçon fruit_coque
    p('c', 'Corbeille', { corbeille: { le: { seconds: 1 } } }),
    { id: 'att', nom: 'Attente' },
    p('r', 'Relue', { reperesRelus: 1 }),
    p('v', 'Vieille marque', { reperesRelus: 0 }),
    p('pr', 'Pâte', { type: 'preparation' }),
    p('ac', 'Accompagnement', { type: 'accompagnement' }),
  ];
  assert.deepEqual(platsARelire(plats).map((x) => x.id), ['n', 'b', 'v', 'd', 'a', 'ac', 'pr']);
  assert.deepEqual(lotDePrecautions(plats).map((x) => x.id), platsARelire(plats).map((x) => x.id));
  assert.equal(lotDePrecautions(Array.from({ length: 15 }, (_, i) => p(`x${i}`, `X${i}`))).length, LOT_PRECAUTIONS);
  assert.equal(estRelue({ reperesRelus: 1 }), true);
  assert.equal(estRelue({ reperesRelus: '1' }), false);
  assert.equal(estRelue({}), false);
});

test('29. fiche complète : nouveau sans marque ; remplace et complete d’une fiche relue → effacerRelue ; identique et version seule → rien', () => {
  const nouveau = preparer(reponse([GRATIN]), []);
  assert.equal(nouveau.elements[0].statut, 'nouveau');
  assert.equal(Object.hasOwn(nouveau.ecritures[0].donnees, 'reperesRelus'), false);
  assert.equal(nouveau.ecritures[0].effacerRelue, undefined);

  const relu = { ...structuredClone(GRATIN), reperesRelus: 1 };
  const autre = { ...structuredClone(GRATIN), etapes: ['Tout gratiner.'] };
  const remplace = preparer(reponse([autre]), [relu]);
  assert.equal(remplace.elements[0].statut, 'remplace');
  assert.equal(remplace.ecritures[0].effacerRelue, true);
  assert.equal(appliquerImport([relu], remplace.ecritures)[0].reperesRelus, undefined);

  // Fiche non relue à l'aperçu : marque effacée quand même (une relecture a pu être enregistrée ailleurs avant l'envoi).
  const nonRelue = preparer(reponse([autre]), [structuredClone(GRATIN)]);
  assert.equal(nonRelue.elements[0].statut, 'remplace');
  assert.equal(nonRelue.ecritures[0].effacerRelue, true);

  const attente = { id: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', statutRecette: 'attente', reperesRelus: 1 };
  const complete = preparer(reponse([GRATIN]), [attente]);
  assert.equal(complete.elements[0].statut, 'complete');
  assert.equal(complete.ecritures[0].effacerRelue, true);

  const identique = preparer(reponse([GRATIN]), [relu]);
  assert.equal(identique.elements[0].statut, 'identique');
  assert.deepEqual(identique.ecritures, []);

  const avecVersion = { ...autre, variantes: [{ pour: 'profil-a', retirer: ['jambon blanc'], ajouter: [ing('tofu', 1, 'g', 'cremerie', ['soja'])].map(({ qte, ...i }) => ({ ...i, qtePortion: qte })), consigne: 'Tofu.' }] };
  const versionSeule = preparer(reponse([avecVersion]), [relu], { choix: { 'gratin-pates-jambon': 'version' } });
  assert.equal(versionSeule.elements[0].statut, 'versions');
  assert.equal(versionSeule.ecritures[0].mode, 'versions');
  assert.equal(versionSeule.ecritures[0].effacerRelue, undefined);
});

test('30. remplace : repères de précaution gardés et annoncés ; ingrédient renommé → perdus annoncés', () => {
  const sansLaitCru = structuredClone(TARTIFLETTE);
  sansLaitCru.ingredients[1].marqueurs = ['laitier'];
  sansLaitCru.etapes = ['Tout cuire au four.'];
  const prep = preparer(reponse([sansLaitCru]), [TARTIFLETTE]);
  assert.equal(prep.elements[0].statut, 'remplace');
  assert.deepEqual(prep.ecritures[0].donnees.ingredients[1].marqueurs, ['laitier', 'lait_cru']);
  assert.equal(prep.elements[0].reperesGardes, 'Repères gardés de la recette actuelle\u00A0: au lait cru (reblochon). Pour en enlever un\u00A0: Modifier.');
  assert.equal(prep.elements[0].reperesPerdus, undefined);

  const renomme = structuredClone(sansLaitCru);
  renomme.ingredients[1].produit = 'reblochon fermier';
  const prep2 = preparer(reponse([renomme]), [TARTIFLETTE]);
  assert.equal(prep2.elements[0].reperesGardes, undefined);
  assert.equal(prep2.elements[0].reperesPerdus, 'Repères perdus avec des ingrédients qui ne sont plus dans la recette\u00A0: au lait cru (reblochon).');
  assert.deepEqual(garderReperes(TARTIFLETTE.ingredients, renomme.ingredients).perdus, [{ produit: 'reblochon', marqueurs: ['lait_cru'] }]);
});

test('31. même recette aux repères près ; egales inchangée pour les versions', () => {
  const plus = structuredClone(TIRAMISU);
  plus.ingredients[4].marqueurs = ['alcool_cru'];
  // Fiche actuelle avec plus de repères que la recette recollée : même recette.
  assert.equal(preparer(reponse([TIRAMISU]), [plus]).elements[0].statut, 'identique');
  // Fiche actuelle avec moins de repères : recette différente.
  assert.equal(preparer(reponse([plus]), [TIRAMISU]).elements[0].statut, 'remplace');
  assert.equal(comparerAuxReperesPres(plus.ingredients, TIRAMISU.ingredients), 'plusIci');
  assert.equal(comparerAuxReperesPres(TIRAMISU.ingredients, plus.ingredients), 'moinsIci');
  assert.equal(comparerAuxReperesPres(TIRAMISU.ingredients, structuredClone(TIRAMISU.ingredients)), 'egaux');
  assert.equal(comparerAuxReperesPres(TIRAMISU.ingredients, TIRAMISU.ingredients.slice(1)), 'differents');
  // Une version qui ne diffère que par un repère reste différente (egales, non modifiée).
  const version = (marqueurs) => ({ pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'],
    ajouter: [{ produit: 'tofu fumé', qtePortion: 60, unite: 'g', rayon: 'cremerie', marqueurs }], consigne: 'Tofu.' });
  const avec = { ...structuredClone(GRATIN), variantes: [version(['soja'])] };
  const prep = preparer(reponse([{ id: GRATIN.id, nom: GRATIN.nom, variantes: [version([])] }]), [avec]);
  assert.equal(prep.elements[0].statut, 'versions');
});

test('32. reperesRelus dans une réponse de Claude : jamais écrit, avertissement', () => {
  const validation = validerPaquet(reponse([{ ...GRATIN, reperesRelus: 1 }]), { profils: PROFILS });
  assert.equal(validation.valide, true);
  assert.equal(Object.hasOwn(validation.plats[0].donnees, 'reperesRelus'), false);
  assert.deepEqual(validation.avertissements.map((a) => a.pourClaude), ['reperesRelus ignoré']);
  assert.deepEqual(validation.plats[0].avertissements, []);
  const prep = preparerImport(validation.plats.map((x) => x.donnees), { plats: [], profils: PROFILS });
  assert.equal(Object.hasOwn(prep.ecritures[0].donnees, 'reperesRelus'), false);
});

test('33. « Modifier » : produit nouveau ou appareil principal changé → reperesRelus effacé ; le reste non', () => {
  const relu = { ...structuredClone(TARTIFLETTE), reperesRelus: 1 };
  const base = normaliserPourEdition(relu);
  const avec = (changer) => {
    const saisie = structuredClone(base);
    changer(saisie);
    return preparerModification(base, saisie, relu);
  };
  const efface = (r) => r.supprimer.includes('reperesRelus');
  assert.equal(efface(avec((s) => s.ingredients.push(ing('camembert', 1, 'pc', 'fromages', ['laitier'])))), true);
  assert.equal(efface(avec((s) => { s.ingredients[2].produit = 'lardon nature'; })), true);
  assert.equal(efface(avec((s) => { s.cuisson[1] = { appareil: 'plaque', dureeMin: 25 }; })), true);
  assert.equal(efface(avec((s) => { s.ingredients[0].qte = 2; })), false);
  assert.equal(efface(avec((s) => { s.portionsBase = 6; })), false);
  assert.equal(efface(avec((s) => { s.cuisson[1].dureeMin = 30; })), false);
  assert.equal(efface(avec((s) => { s.etapes = ['Tout cuire.']; })), false);
  assert.equal(efface(avec((s) => { s.ingredients[1].marqueurs = ['laitier']; })), false);
  assert.equal(efface(avec((s) => { s.ingredients.splice(3, 1); })), false);
  // Fiche lue ici sans la marque : effacée quand même pour un produit nouveau. Une modification faite hors ligne part
  // plus tard, peut-être après une relecture enregistrée ailleurs, qui jugeait l'ancienne recette.
  const nonRelue = structuredClone(TARTIFLETTE);
  const saisie = normaliserPourEdition(nonRelue);
  saisie.ingredients.push(ing('camembert', 1, 'pc', 'fromages', ['laitier']));
  assert.equal(preparerModification(normaliserPourEdition(nonRelue), saisie, nonRelue).supprimer.includes('reperesRelus'), true);
  const quantite = normaliserPourEdition(nonRelue);
  quantite.ingredients[0].qte = 3;
  assert.equal(preparerModification(normaliserPourEdition(nonRelue), quantite, nonRelue).supprimer.includes('reperesRelus'), false);
});

test('34. reporterReperes : posé ailleurs gardé ; décoché ici reste enlevé ; enlevé ailleurs mais saisi reste', () => {
  const base = [ing('marsala', 5, 'cl', 'boissons', []), ing('reblochon', 1, 'pc', 'fromages', ['laitier', 'lait_cru']), ing('miel', 1, 'cs', 'divers', ['miel'])];
  const saisie = [{ ...base[0], qte: 6 }, { ...base[1], marqueurs: ['laitier'] }, base[2]];
  const actuel = [{ ...base[0], marqueurs: ['alcool_cru'] }, base[1], { ...base[2], marqueurs: [] }];
  assert.deepEqual(reporterReperes(base, saisie, actuel).map((i) => [i.qte, i.marqueurs]), [
    [6, ['alcool_cru']], [1, ['laitier']], [1, ['miel']],
  ]);
  // Dans « Modifier » : brouillon ouvert avant une relecture, enregistré après.
  const ouvert = structuredClone(TIRAMISU);
  const baseSaisie = normaliserPourEdition(ouvert);
  const enCours = structuredClone(baseSaisie);
  enCours.ingredients[0].qte = 300;
  const relu = structuredClone(TIRAMISU);
  relu.ingredients[4].marqueurs = ['alcool_cru'];
  relu.reperesRelus = 1;
  const resultat = preparerModification(baseSaisie, enCours, relu);
  assert.deepEqual(resultat.champs.ingredients[4].marqueurs, ['alcool_cru']);
  assert.equal(resultat.champs.ingredients[0].qte, 300);
  assert.equal(resultat.supprimer.includes('reperesRelus'), false);
});

test('35. catalogueProduits : une occurrence au lait cru sur trois → le produit connu est au lait cru', () => {
  const plats = [
    { id: 'a', ingredients: [ing('reblochon', 1, 'pc', 'fromages', ['laitier'])] },
    { id: 'b', ingredients: [ing('reblochon', 1, 'pc', 'fromages', ['laitier'])] },
    { id: 'c', ingredients: [ing('reblochon', 1, 'pc', 'fromages', ['laitier', 'lait_cru'])] },
  ];
  const [connu] = catalogueProduits(plats);
  assert.deepEqual(connu.marqueurs, ['laitier', 'lait_cru']);
});

test('36. marqueursDouteux : fiche relue → plus de soupçon de précaution ; le soupçon viande reste', () => {
  const plat = { id: 'p', nom: 'P', ingredients: [ing('noix', 1, 'g', 'divers', []), ing('lardon', 1, 'g', 'divers', [])] };
  assert.deepEqual(marqueursDouteux(plat).map((d) => d.attendu), ['fruit_coque', 'viande']);
  assert.deepEqual(marqueursDouteux({ ...plat, reperesRelus: 1 }).map((d) => d.attendu), ['viande']);
});

// ——— Import local ———

test('38. appliquerImport en mode precautions : repères et marque tout de suite ; empreinte différente → rien ; effacerRelue', () => {
  const prep = preparer(reponse([entree(TIRAMISU, [{ produit: 'marsala', poser: ['alcool_cru'] }])]), [TIRAMISU]);
  const [apres] = appliquerImport([TIRAMISU], prep.ecritures);
  assert.deepEqual(apres.ingredients[4].marqueurs, ['alcool_cru']);
  assert.equal(apres.reperesRelus, VERSION_REPERES);
  assert.deepEqual(apres.ingredients.map((i) => i.qte), TIRAMISU.ingredients.map((i) => i.qte));
  const change = { ...structuredClone(TIRAMISU), etapes: ['Autre.'] };
  assert.deepEqual(appliquerImport([change], prep.ecritures), [change]);
  assert.equal(appliquerImport([TIRAMISU], prep.ecritures).length, 1);
  // Un mode inconnu n'écrit rien (ni fiche vide, ni plat recréé).
  assert.deepEqual(appliquerImport([TIRAMISU], [{ id: 'tiramisu', mode: 'autre', donnees: { nom: 'X' } }]), [TIRAMISU]);
  assert.deepEqual(appliquerImport([], [{ id: 'x', mode: 'autre', donnees: { nom: 'X' } }]), []);
});

test('libellés des repères et annonce de la relecture', () => {
  assert.equal(libelleRepere('lait_cru'), 'au lait cru');
  assert.equal(libelleRepere('cafe'), 'café, thé, cola');
  assert.equal(libelleRepere('cafeine'), 'café, thé, cola');
  assert.equal(libelleRepere('gelatine_porc'), 'gélatine animale');
  assert.equal(libelleRepere('cru', { marqueurs: ['viande'] }), 'crue ou rosée');
  assert.equal(libelleRepere('cru', { marqueurs: ['poisson'] }), 'cru');
  // Repères sans case : leur mot, jamais le code (« legume », « oeuf »).
  assert.deepEqual(['legume', 'feculent', 'oeuf', 'boeuf', 'fruits_de_mer', 'viande'].map((m) => libelleRepere(m)),
    ['légume', 'féculent', 'œuf', 'bœuf', 'fruits de mer', 'viande']);
  assert.equal(annonceRelecture({ relues: 10, ajoutes: 6, enleves: 1, restants: 32 }), '10 recettes relues, 6 repères ajoutés, 1 enlevé. 32 restent à relire.');
  assert.equal(annonceRelecture({ relues: 10, ajoutes: 6, restants: 32 }), '10 recettes relues, 6 repères ajoutés. 32 restent à relire.');
  assert.equal(annonceRelecture({ relues: 10, restants: 32 }), '10 recettes relues, rien à ajouter. 32 restent à relire.');
  assert.equal(annonceRelecture({ relues: 2, enleves: 1, restants: 3 }), '2 recettes relues, 1 repère enlevé. 3 restent à relire.');
  assert.equal(annonceRelecture({ relues: 1, ajoutes: 1, restants: 0, incidents: [{ nom: 'Tiramisu', cause: 'change' }, { nom: 'X', cause: 'supprime' }, { nom: 'Y', cause: 'corbeille' }] }),
    '1 recette relue, 1 repère ajouté. Toutes vos recettes sont relues. «\u00A0Tiramisu\u00A0» a changé entre-temps\u00A0: il reste à relire. «\u00A0X\u00A0» a été supprimé entre-temps. «\u00A0Y\u00A0» a été mis à la corbeille entre-temps.');
});

test('invariant : une relecture n’écrit que des marqueurs de précaution', () => {
  const json = JSON.parse(blocs('json').find((b) => b.includes('"precautions"')));
  const prep = preparer(json, LOT_DOC);
  const choix = Object.fromEntries(prep.elements.flatMap((e) => (e.retraits ?? []).map((r) => [r.cle, true])));
  const ecritures = ecrituresRelecture(prep, choix);
  assert.equal(ecritures.length, 4);
  const apres = appliquerImport(LOT_DOC, ecritures);
  apres.forEach((plat, i) => {
    const avant = LOT_DOC[i];
    assert.equal(plat.reperesRelus, VERSION_REPERES, plat.id);
    for (const cle of ['nom', 'etapes', 'cuisson', 'portionsBase', 'variantes', 'modifieeLe', 'modifieePar', 'statutRecette']) {
      assert.deepEqual(plat[cle], avant[cle], `${plat.id} ${cle}`);
    }
    plat.ingredients.forEach((ingredient, k) => {
      const { marqueurs: m1, ...reste1 } = ingredient;
      const { marqueurs: m2, ...reste2 } = avant.ingredients[k];
      assert.deepEqual(reste1, reste2);
      const changes = [...m1.filter((m) => !m2.includes(m)), ...m2.filter((m) => !m1.includes(m))];
      for (const m of changes) assert.ok(MARQUEURS_PRECAUTION.includes(m), `${plat.id} ${m}`);
    });
  });
  // Exemple de la réponse : les repères attendus.
  assert.deepEqual(apres[0].ingredients.map((i) => i.marqueurs), [['laitier'], ['oeuf', 'oeuf_cru'], [], ['cafe'], ['alcool_cru'], ['feculent']]);
  assert.deepEqual(apres[1].ingredients[1].marqueurs, ['laitier']);
  assert.deepEqual(apres[2].ingredients.map((i) => i.marqueurs), [['feculent'], ['poisson'], ['fruit_coque'], ['laitier', 'lait_cru'], []]);
  // Sans retrait coché : aucun retrait.
  const parDefaut = appliquerImport(LOT_DOC, prep.ecritures);
  assert.deepEqual(parDefaut[1].ingredients[1].marqueurs, ['laitier', 'lait_cru']);
});

// ——— Sauvegarde ———

const MAINTENANT = new Date('2026-10-09T10:00:00Z');
const valider = (plats) => {
  const lu = lireSauvegarde(creerSauvegarde({ plats, profils: [] }, { maintenant: MAINTENANT }).texte);
  return validerSauvegarde(lu.sauvegarde);
};

test('39. aller-retour : reperesRelus écrit, lu, restauré avec un plat absent', () => {
  const relu = { ...structuredClone(TIRAMISU), reperesRelus: 1 };
  const { texte } = creerSauvegarde({ plats: [relu], profils: [] }, { maintenant: MAINTENANT });
  assert.equal(JSON.parse(texte).plats[0].reperesRelus, 1);
  const validation = valider([relu]);
  assert.equal(validation.plats[0].reperesRelus, 1);
  const prep = preparerRestauration(validation, { plats: [], email: 'a@b.c' });
  const ecriture = prep.lots.flat().find((e) => e.id === 'tiramisu');
  assert.equal(ecriture.donnees.reperesRelus, 1);
  assert.deepEqual(ecriture.donnees.ingredients, relu.ingredients);
});

test('40. marque de relecture illisible → avertissement', () => {
  const { texte } = creerSauvegarde({ plats: [TIRAMISU], profils: [] }, { maintenant: MAINTENANT });
  const fichier = JSON.parse(texte);
  fichier.plats[0].reperesRelus = 'oui';
  const validation = validerSauvegarde(fichier);
  assert.ok(validation.avertissements.includes('«\u00A0Tiramisu\u00A0»\u00A0: sa marque de relecture est illisible, elle a été ignorée.'));
  assert.equal(validation.plats[0].reperesRelus, undefined);
});

test('41. reperesRelus connu de la sauvegarde : aucun avertissement « non reconnu »', () => {
  const validation = valider([{ ...TIRAMISU, reperesRelus: 1 }]);
  assert.deepEqual(validation.avertissements, []);
  // L'empreinte de la recette (condition de reprise) ignore la marque : une fiche marquée depuis l'aperçu se reprend.
  const fichier = valider([{ ...structuredClone(TIRAMISU), etapes: ['Autre.'] }]);
  const prep = preparerRestauration(fichier, { plats: [TIRAMISU] }, { recettesAReprendre: ['tiramisu'] });
  const [ecriture] = prep.lots.flat();
  const { condition } = ecriture;
  assert.ok(condition.recette);
  const prep2 = preparerRestauration(fichier, { plats: [{ ...TIRAMISU, reperesRelus: 1 }] }, { recettesAReprendre: ['tiramisu'] });
  assert.equal(prep2.lots.flat()[0].condition.recette, condition.recette);
});

test('42. comparaison aux repères près : plusIci identique ; moinsIci différente avec la mention ; étape différente', () => {
  const plus = structuredClone(TARTIFLETTE);
  plus.ingredients[2].marqueurs.push('cru');
  const fichierMoins = valider([TARTIFLETTE]);
  assert.equal(preparerRestauration(fichierMoins, { plats: [plus] }).resume.identiques, 1);
  const moins = structuredClone(TARTIFLETTE);
  moins.ingredients[1].marqueurs = ['laitier'];
  const prep = preparerRestauration(fichierMoins, { plats: [moins] });
  assert.equal(prep.resume.identiques, 0);
  assert.equal(prep.recettesDifferentes[0].mention, 'Le fichier a des repères que l’app n’a plus\u00A0: au lait cru (reblochon).');
  const etapes = valider([{ ...structuredClone(TARTIFLETTE), etapes: ['Autre.'] }]);
  const prep3 = preparerRestauration(etapes, { plats: [plus] });
  assert.equal(prep3.recettesDifferentes.length, 1);
  assert.equal(prep3.recettesDifferentes[0].mention, undefined);
});

test('43. recette cochée : repères de la fiche gardés, ligne du résumé, marque du fichier', () => {
  const fiche = { ...structuredClone(TARTIFLETTE), reperesRelus: 1 };
  fiche.ingredients[4].marqueurs.push('lait_cru');
  const ancienne = structuredClone(TARTIFLETTE);
  ancienne.etapes = ['Ancienne étape.'];
  const prep = preparerRestauration(valider([ancienne]), { plats: [fiche], email: 'a@b.c' }, { recettesAReprendre: ['tartiflette'] });
  const [ecriture] = prep.lots.flat();
  assert.deepEqual(ecriture.donnees.ingredients[4].marqueurs, ['laitier', 'lait_cru']);
  assert.deepEqual(ecriture.donnees.etapes, ['Ancienne étape.']);
  assert.ok(ecriture.effacer.includes('reperesRelus'), 'marque du fichier absente : effacée');
  assert.deepEqual(prep.resume.reperesGardes, ['«\u00A0Tartiflette\u00A0»\u00A0: repères gardés\u00A0: au lait cru (crème fraîche épaisse).']);
  // Fichier relu : la marque suit le fichier.
  const prep2 = preparerRestauration(valider([{ ...ancienne, reperesRelus: 1 }]), { plats: [{ ...fiche, reperesRelus: undefined }] }, { recettesAReprendre: ['tartiflette'] });
  assert.equal(prep2.lots.flat()[0].donnees.reperesRelus, 1);
});

test('44. plat présent sans marque, recette identique : la marque ne revient pas seule', () => {
  const prep = preparerRestauration(valider([{ ...TIRAMISU, reperesRelus: 1 }]), { plats: [TIRAMISU] });
  assert.equal(prep.rien, true);
  // Recette différente non cochée : rien non plus.
  const prep2 = preparerRestauration(valider([{ ...structuredClone(TIRAMISU), etapes: ['X.'], reperesRelus: 1 }]), { plats: [TIRAMISU] });
  assert.equal(prep2.rien, true);
});

test('aucune espace insécable écrite telle quelle dans les fichiers de T2d', async () => {
  for (const fichier of ['../js/coeur/relecture.js', '../js/coeur/vocabulaire.js', '../js/coeur/sauvegarde.js', '../js/coeur/import-local.js',
    '../js/coeur/edition.js', '../js/coeur/compatibilite.js', './coeur-t2d.test.js']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});

// ——— Corrections de la relecture critique ———

test('cases par plat : le même produit dans deux recettes a deux cases indépendantes', () => {
  const mousse = { id: 'mousse', nom: 'Mousse', type: 'dessert', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [ing('chocolat noir', 200, 'g', 'epicerie_sucree', []), ing('œuf', 6, 'pc', 'cremerie', ['oeuf'])], etapes: ['Monter.'] };
  const prep = preparer(reponse([
    entree(TIRAMISU, [{ produit: 'œuf', poser: ['oeuf_cru'] }]), entree(mousse, [{ produit: 'œufs', poser: ['oeuf_cru'] }]),
  ]), [TIRAMISU, mousse]);
  const [cleT, cleM] = prep.elements.map((e) => e.ajouts[0].cle);
  assert.equal(cleT, cleChangement('tiramisu', 'œuf', 'oeuf_cru', 'ajout'));
  assert.notEqual(cleT, cleM);
  // Décocher l'œuf cru du tiramisu laisse celui de la mousse coché.
  assert.deepEqual(ecrituresRelecture(prep, { [cleT]: false }).map((e) => [e.id, e.ajouts.length]), [['tiramisu', 0], ['mousse', 1]]);
});

test('bilan et annonce : seules les recettes marquées relues sont comptées, les autres restent à relire', () => {
  const ecritures = [
    { id: 'a', mode: 'precautions', ajouts: [{ produit: 'x', marqueur: 'miel' }], retraits: [], marquerRelue: true, empreinte: 'e' },
    { id: 'b', mode: 'precautions', ajouts: [{ produit: 'y', marqueur: 'oeuf_cru' }], retraits: [], marquerRelue: false, empreinte: 'e' },
    { id: 'c', mode: 'precautions', ajouts: [], retraits: [{ produit: 'z', marqueur: 'lait_cru' }], marquerRelue: true, empreinte: 'e' },
    { id: 'd', mode: 'precautions', ajouts: [{ produit: 'w', marqueur: 'miel' }], retraits: [], marquerRelue: true, empreinte: 'e' },
  ];
  // « d » n'a pas été écrit (fiche changée entre-temps).
  const bilan = bilanRelecture(ecritures, ['a', 'b', 'c']);
  assert.deepEqual(bilan, { relues: ['a', 'c'], aRelire: ['b'], ajoutes: 2, enleves: 1 });
  assert.equal(annonceRelecture({ relues: 2, ajoutes: 2, enleves: 1, aRelire: ['Salade César'], restants: 5 }),
    '2 recettes relues, 2 repères ajoutés, 1 enlevé. 1 reste à relire\u00A0: «\u00A0Salade César\u00A0». En tout, 5 restent à relire.');
  // Toutes celles qui restent sont celles-là : pas de « En tout ».
  assert.equal(annonceRelecture({ relues: 0, ajoutes: 1, aRelire: ['A', 'B'], restants: 2 }),
    '1 repère ajouté. 2 restent à relire\u00A0: «\u00A0A\u00A0», «\u00A0B\u00A0».');
  assert.equal(annonceRelecture({ relues: 3, restants: 0 }), '3 recettes relues, rien à ajouter. Toutes vos recettes sont relues.');
});

test('une idée de Claude pour un plat du lot de relecture n’est pas une erreur : elle n’est simplement pas reprise', () => {
  const idee = { ...structuredClone(TIRAMISU), source: 'Idée de Claude', etapes: ['Autre.'] };
  const validation = validerPaquet(reponse([idee]), { profils: PROFILS });
  const prep = preparerImport(validation.plats.map((p) => p.donnees), { plats: [TIRAMISU], profils: PROFILS, relectureEnCours: ['tiramisu'] });
  assert.deepEqual(prep.erreurs, []);
  assert.equal(prep.relecture, undefined);
  assert.deepEqual(prep.elements.map((e) => e.statut), ['deja']);
  assert.deepEqual(prep.ecritures, []);
});

test('retrait qui ferait perdre sa nature à l’ingrédient (espadon sans « poisson ») : ignoré, jamais écrit', () => {
  const plat = { id: 'p', nom: 'P', statutRecette: 'brouillon', ingredients: [
    ing('thon', 200, 'g', 'poissonnerie', ['poisson_predateur']), ing('espadon', 200, 'g', 'poissonnerie', ['poisson', 'poisson_predateur']),
  ] };
  const ch = changementsRelecture(plat, [
    { produit: 'thon', poser: [], enlever: ['poisson_predateur'], pourquoi: 'Le thon n’en est pas.' },
    { produit: 'espadon', poser: [], enlever: ['poisson_predateur'], pourquoi: 'x' },
  ]);
  assert.deepEqual(ch.retraits.map((r) => r.produit), ['espadon']);
  assert.deepEqual(ch.ignores, [{ produit: 'thon', marqueur: 'poisson_predateur', raison: 'nature' }]);
  assert.deepEqual(ch.avertissements, ['«\u00A0thon\u00A0» n’est pas marqué comme poisson\u00A0: à enlever dans Modifier si c’est juste.']);
  assert.equal(ch.complete, true);
  // Même demandé directement, le retrait n'agit pas : le thon reste un poisson pour un adulte qui n'en mange pas.
  const apres = appliquerReperes(plat.ingredients, { retraits: [{ produit: 'thon', marqueur: 'poisson_predateur' }, { produit: 'espadon', marqueur: 'poisson_predateur' }] });
  assert.deepEqual(apres.map((i) => i.marqueurs), [['poisson_predateur'], ['poisson']]);
  const sansPoisson = { id: 'b', nom: 'B', regles: ecrireRegime({ regime: 'sans_viande_ni_poisson' }) };
  assert.equal(evaluer({ ...plat, ingredients: apres }, sansPoisson).niveau, 'exclu');
});

test('repère hors relecture montré par son mot (« légume », « œuf »), jamais par son code', () => {
  const lu = validerPrecautions([{ produit: 'lentilles vertes', poser: ['legume', 'feculent'] }, { produit: 'œuf', enlever: ['oeuf'] }]);
  const prep = preparerImport([{ id: 'tiramisu', empreinte: empreinteRelecture(TIRAMISU), precautions: lu.precautions, horsRelecture: lu.horsRelecture }], { plats: [TIRAMISU] });
  assert.deepEqual(prep.elements[0].infos, [
    'Claude signale aussi «\u00A0légume\u00A0» pour «\u00A0lentilles vertes\u00A0»\u00A0: à corriger dans Modifier si c’est juste.',
    'Claude signale aussi «\u00A0féculent\u00A0» pour «\u00A0lentilles vertes\u00A0»\u00A0: à corriger dans Modifier si c’est juste.',
    'Claude signale aussi «\u00A0œuf\u00A0» pour «\u00A0œuf\u00A0»\u00A0: à corriger dans Modifier si c’est juste.',
  ]);
  for (const info of prep.elements[0].infos) assert.doesNotMatch(info, /\b[a-z]+_[a-z_]+\b|\blegume\b|\bfeculent\b|\boeuf\b/);
});

test('phrases de l’aperçu : « aussi d’en enlever » seulement après des ajouts', () => {
  assert.deepEqual(phrasesApercuRelecture(6, 2), [
    'Claude propose d’ajouter 6\u00A0repères. Décochez ceux qui vous semblent faux.',
    'Claude propose aussi d’en enlever 2\u00A0: cochez seulement si vous en êtes sûr.',
  ]);
  assert.deepEqual(phrasesApercuRelecture(1, 0), ['Claude propose d’ajouter 1\u00A0repère. Décochez-le s’il vous semble faux.']);
  assert.deepEqual(phrasesApercuRelecture(0, 2), ['Claude propose d’enlever 2\u00A0repères\u00A0: cochez seulement si vous en êtes sûr.']);
  assert.deepEqual(phrasesApercuRelecture(0, 1), ['Claude propose d’enlever 1\u00A0repère\u00A0: cochez-le seulement si vous en êtes sûr.']);
  assert.deepEqual(phrasesApercuRelecture(0, 0), []);
});

test('restauration : une marque « relue » posée depuis l’aperçu est effacée avec la recette reprise du fichier', () => {
  const fiche = structuredClone(TARTIFLETTE);
  const ancienne = { ...structuredClone(TARTIFLETTE), etapes: ['Ancienne étape.'] };
  const prep = preparerRestauration(valider([ancienne]), { plats: [fiche], email: 'a@b.c' }, { recettesAReprendre: ['tartiflette'] });
  const [ecriture] = prep.lots.flat();
  assert.equal((ecriture.effacer ?? []).includes('reperesRelus'), false, 'fiche sans marque à l’aperçu');
  // Entre l'aperçu et l'envoi, une relecture sans changement de repère marque la fiche (même empreinte de recette).
  const envoi = appliquerConditions(ecriture, { ...fiche, reperesRelus: 1 });
  assert.deepEqual(envoi.donnees.etapes, ['Ancienne étape.']);
  assert.ok(envoi.effacer.includes('reperesRelus'), 'la marque suit le fichier, qui ne l’a pas');
  // Fichier relu : la marque est écrite, rien à effacer.
  const relu = preparerRestauration(valider([{ ...ancienne, reperesRelus: 1 }]), { plats: [fiche], email: 'a@b.c' }, { recettesAReprendre: ['tartiflette'] });
  const envoiRelu = appliquerConditions(relu.lots.flat()[0], { ...fiche, reperesRelus: 1 });
  assert.equal(envoiRelu.donnees.reperesRelus, 1);
  assert.equal((envoiRelu.effacer ?? []).includes('reperesRelus'), false);
});

test('document : la puce de rappel de DEMANDE-PRECAUTIONS ne contredit pas « nom recopié tel quel »', () => {
  const puce = doc.split('\n').find((l) => l.startsWith('- `DEMANDE-PRECAUTIONS` :'));
  assert.ok(puce);
  assert.doesNotMatch(puce, /jamais le nom/);
  assert.match(puce, /jamais un autre nom/);
});
