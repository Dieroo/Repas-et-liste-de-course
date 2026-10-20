// Plan du batch (2026-10-19) : plats du batch, empreinte, texte DEMANDE-BATCH, lecture et validation de la réponse de
// Claude, correction, carte de Semaine, écran du batch. Fixtures génériques (tests/donnees/plan-batch.js).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTETE_DEMANDE_BATCH, PLATS_BATCH_MIN, TEXTES_PLAN_BATCH, cleRepriseBatch, empreintePlanBatch,
  estReponseBatch, etatCarteBatch, pasAPasBatch, phraseDemandeBatch, planDeLaReponse, platsDuBatch, portionsDuBatch,
  texteCorrectionBatch,
  texteDemandeBatch, texteSemaineDuPlan, validerPlanBatch,
} from '../js/coeur/plan-batch.js';
import { VERSION_INSTRUCTIONS } from '../js/coeur/claude.js';
import { ADULTE_A, GRATIN, PLATS, POULET, PROFILS, SALADE, SEMAINE, planExemple } from './donnees/plan-batch.js';

/** Le curry, avec une coriandre ajoutée seulement le jour du repas (étape `auService`). */
const POULET_SERVI = {
  ...POULET,
  ingredients: [...POULET.ingredients, { produit: 'coriandre fraîche', qte: 1, unite: 'botte', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' }],
  realisation: [...POULET.realisation, { titre: 'Parsemer de coriandre', texte: 'Réchauffez, puis parsemez de coriandre ciselée.', duree: 5, auService: true, ingredients: ['coriandre fraîche'] }],
  etapes: [...POULET.etapes, 'Parsemer de coriandre'],
};

const elementsDe = (semaine = SEMAINE, plats = PLATS) => platsDuBatch(semaine, { tousLesPlats: plats, profils: PROFILS });
const ELEMENTS = elementsDe();
const EMPREINTE = empreintePlanBatch(ELEMENTS);
const valider = (brut, extra = {}) => validerPlanBatch(brut, { elements: ELEMENTS, semaineId: SEMAINE.id, empreinte: EMPREINTE, ...extra });
const copie = (valeur) => JSON.parse(JSON.stringify(valeur));
const codes = (resultat) => resultat.erreurs.map((e) => e.pourClaude);

// ——— Plats du batch ———

test('platsDuBatch : plats de la semaine avec leur recette, que quelqu’un mange, ni apéro ni ⏳, dans l’ordre de la semaine', () => {
  assert.deepEqual(ELEMENTS.map((e) => e.platId), ['gratin-pommes-de-terre', 'salade-pommes-de-terre', 'poulet-curry']);
  for (const e of ELEMENTS) {
    assert.deepEqual(e.element.semaine, { id: '2026-10-24', debut: '2026-10-24', fin: '2026-10-30' });
    assert.ok(e.quantites.portions > 0);
  }
  // Le gratin : la part d'Adulte B (version mer) ne prend pas de lardons.
  const gratin = ELEMENTS[0];
  assert.equal(gratin.quantites.parts.length, 1);
  assert.equal(gratin.quantites.lignes.find((l) => l.produit === 'lardons').qte, 75);
  // Un plat retiré, de la corbeille ou que personne ne mange n'y est pas.
  const retire = { ...SEMAINE, plats: { ...SEMAINE.plats, 'poulet-curry': { ajouteLe: 3, retire: true } } };
  assert.deepEqual(elementsDe(retire).map((e) => e.platId), ['gratin-pommes-de-terre', 'salade-pommes-de-terre']);
  const corbeille = PLATS.map((p) => (p.id === 'salade-pommes-de-terre' ? { ...p, corbeille: { le: 1, par: 'a@exemple.fr' } } : p));
  assert.deepEqual(elementsDe(SEMAINE, corbeille).map((e) => e.platId), ['gratin-pommes-de-terre', 'poulet-curry']);
  assert.deepEqual(platsDuBatch(null), []);
  assert.deepEqual(platsDuBatch({ id: 'x' }), []);
});

test('empreintePlanBatch : plats, recettes et parts ; jamais les portions de la semaine ni l’ordre', () => {
  assert.match(EMPREINTE, /^[0-9a-z]{6}$/);
  assert.equal(empreintePlanBatch([...ELEMENTS].reverse()), EMPREINTE);
  // Un invité de plus : mêmes plats, même empreinte, portions changées.
  const invites = { ...SEMAINE, plats: { ...SEMAINE.plats, 'poulet-curry': { ajouteLe: 3, invites: { adultes: 2 } } } };
  const avecInvites = elementsDe(invites);
  assert.equal(empreintePlanBatch(avecInvites), EMPREINTE);
  assert.notDeepEqual(portionsDuBatch(avecInvites), portionsDuBatch(ELEMENTS));
  // Un plat de moins, une recette changée : autre empreinte.
  assert.notEqual(empreintePlanBatch(ELEMENTS.slice(0, 2)), EMPREINTE);
  const recette = PLATS.map((p) => (p.id === SALADE.id ? { ...p, ingredients: [...p.ingredients, { produit: 'persil', qte: 1, unite: 'botte', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' }] } : p));
  assert.notEqual(empreintePlanBatch(elementsDe(SEMAINE, recette)), EMPREINTE);
  assert.equal(empreintePlanBatch([]), null);
});

// ——— Demande pour Claude ———

test('texteDemandeBatch : en-tête, version, semaine, empreinte, appareils, nombre, consigne, puis chaque plat', () => {
  const texte = texteDemandeBatch(ELEMENTS, { semaine: SEMAINE });
  const lignes = texte.split('\n');
  assert.equal(lignes[0], ENTETE_DEMANDE_BATCH);
  assert.equal(lignes[1], `instructions: ${VERSION_INSTRUCTIONS}`);
  assert.equal(lignes[2], 'semaine: 2026-10-24');
  assert.equal(lignes[3], `empreinte: ${EMPREINTE}`);
  assert.equal(lignes[4], 'appareils: plaque, four, cookeo, airfryer');
  assert.equal(lignes[5], 'nombre: 3');
  assert.match(lignes[6], /^\(Organise le batch de ces plats pour une seule personne/);
  assert.equal(lignes[7], 'plats:');
  assert.ok(lignes.includes('- id: gratin-pommes-de-terre'));
  assert.ok(lignes.includes('  ingrédients: 1 kg pomme de terre ; 75 g lardons ; 20 cl crème fraîche épaisse ; 100 g gruyère râpé'));
  assert.ok(lignes.includes('  parts à mettre de côté: sans lardons (avec thon au naturel) — 2 portions'));
  assert.ok(!texte.includes('\u00A0'), 'texte copié sans espace insécable');
  assert.ok(lignes.includes('  portions à cuisiner: 4'));
  assert.ok(!lignes.some((l) => l.startsWith('  au service:')));
  assert.ok(lignes.includes('  se garde: 3 jours au frigo ; ne se congèle pas'));
  assert.ok(lignes.some((l) => /^ {4}2\. Faire revenir les lardons \(6 min ; plaque, feu moyen ; ingrédients : lardons ; ustensiles : poêle ; parts mises de côté avant\) : /.test(l)));
  // Appareils actifs des réglages.
  assert.match(texteDemandeBatch(ELEMENTS, { semaine: SEMAINE, appareils: ['four', { id: 'cookeo', actif: false }, 'plaque'] }), /\nappareils: plaque, four\n/);
});

test('texteDemandeBatch : rien sur les personnes (ni prénom, ni profil, ni adresse)', () => {
  const texte = texteDemandeBatch(ELEMENTS, { semaine: SEMAINE });
  for (const interdit of ['Adulte', 'profil-a', 'profil-b', 'exemple.fr']) assert.ok(!texte.includes(interdit), interdit);
  assert.doesNotMatch(texte, /[\w.-]+@[\w-]+\.[a-z]/i);
});

// ——— Réponse de Claude ———

test('planDeLaReponse, estReponseBatch : le premier objet qui porte `batch`', () => {
  const plan = planExemple(EMPREINTE);
  assert.deepEqual(planDeLaReponse([{ format: 'paquet@1', plats: [] }, { format: 'paquet@1', instructions: 11, batch: plan }]), { batch: plan, instructions: 11 });
  assert.equal(planDeLaReponse([{ format: 'paquet@1', plats: [] }]), null);
  assert.ok(estReponseBatch([{ batch: {} }]));
  assert.ok(!estReponseBatch(null));
});

test('validerPlanBatch : le plan exemple est valide, normalisé, sans avertissement', () => {
  const r = valider(planExemple(EMPREINTE));
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.avertissements, []);
  assert.equal(r.refus, null);
  assert.equal(r.plan.etapes.length, 11);
  assert.equal(r.plan.etapes[0].plats.length, 2);
  assert.deepEqual(r.plan.etapes[3], {
    titre: 'Allumer le four', texte: 'Allumez le four pour le gratin.', duree: 1, actif: null, appareil: 'four', mode: null, tempC: 200,
    feu: null, ustensiles: [], plats: ['gratin-pommes-de-terre'], ingredients: [], aussi: [], pret: null, prechauffer: true, partAvant: [], veille: false,
  });
  assert.deepEqual(r.plan.etapes[6].partAvant, ['gratin-pommes-de-terre']);
  assert.equal(r.plan.dureeTotale, 85);
  assert.deepEqual(r.plan.recipients[0], { plat: 'gratin-pommes-de-terre', ustensile: 'plat à gratin', taille: '25 × 20 cm, pour 4 parts' });
});

test('validerPlanBatch : refus d’un plan d’une autre semaine ou d’avant un changement des plats (rien à corriger)', () => {
  const autre = valider({ ...planExemple(EMPREINTE), semaine: '2026-10-17' });
  assert.equal(autre.refus, 'semaine');
  assert.equal(autre.plan, null);
  const ancien = valider({ ...planExemple('zzzzzz') });
  assert.equal(ancien.refus, 'perime');
  assert.equal(ancien.plan, null);
  // Recopie oubliée : une erreur à corriger, pas un refus.
  const sansEmpreinte = valider({ ...planExemple(EMPREINTE), empreinte: undefined });
  assert.equal(sansEmpreinte.refus, null);
  assert.deepEqual(codes(sansEmpreinte), [`batch.empreinte : « ${EMPREINTE} » attendu`]);
});

test('validerPlanBatch : erreurs de forme, avec les codes exacts pour Claude et des messages justes', () => {
  assert.deepEqual(codes(valider(null)), ['batch : objet attendu']);
  const plan = planExemple(EMPREINTE);
  plan.dureeTotale = 0;
  plan.etapes[1].titre = '';
  plan.etapes[2].titre = 'x'.repeat(61);
  plan.etapes[2].duree = 2000;
  plan.etapes[5].plats = ['inconnu'];
  plan.etapes[5].texte = 'x'.repeat(1001);
  const r = valider(plan);
  assert.equal(r.plan, null);
  assert.deepEqual(codes(r), [
    'batch.dureeTotale : entier de 1 à 1440 attendu',
    'batch.etapes[1].titre : texte de 1 à 60 caractères attendu',
    'batch.etapes[2].titre : texte de 1 à 60 caractères attendu',
    'batch.etapes[2].duree : entier de 1 à 1440 attendu',
    'batch.etapes[5].texte : texte de 1 à 1000 caractères attendu',
    'batch.etapes[5].plats : « inconnu » n\'est pas un plat de la demande',
  ]);
  assert.deepEqual(r.erreurs.map((e) => e.message), [
    'La durée du batch est illisible.',
    'L’étape 2 n’a pas de titre.',
    'Le titre de l’étape 3 est trop long.',
    'La durée de l’étape 3 est illisible.',
    'Le texte de l’étape 6 est trop long.',
    'L’étape 6 parle d’un plat qui n’est pas dans la semaine.',
  ]);
  // Messages affichés : sans code ni mot technique.
  for (const e of r.erreurs) assert.doesNotMatch(e.message, /batch\.|etapes\[|json|paquet|slug/i);
  // Une étape sans plat ni ingrédient qui le dise ; trop d'étapes.
  const sans = planExemple(EMPREINTE);
  sans.etapes[5].plats = [];
  assert.deepEqual(codes(valider(sans)), ['batch.etapes[5].plats : identifiants des plats de la demande attendus']);
  const long = planExemple(EMPREINTE);
  long.etapes = Array.from({ length: 61 }, () => long.etapes[0]);
  assert.deepEqual(valider(long).erreurs.map((e) => e.message), ['Le plan a trop d’étapes (60 au plus).']);
});

test('validerPlanBatch : souplesse sur ce qu’un vrai Claude écrit (texte, nom approché, ajout d’une part, plats déduits)', () => {
  const plan = planExemple(EMPREINTE);
  plan.dureeTotale = '85';
  plan.travail = 120;
  plan.etapes[1].ingredients = ['haut de cuisse de poulet', 'oignon'];
  plan.etapes[3].plats = undefined;
  plan.etapes[3].prechauffer = 'true';
  plan.etapes[4].plats = [];
  plan.etapes[6].partAvant = true;
  plan.etapes[6].ingredients.push({ produit: 'thon au naturel', plat: 'gratin-pommes-de-terre' });
  plan.etapes[9].ingredients = [{ produit: 'mayonnaise', plat: 'salade-pommes-de-terre' }, { produit: 'moutarde' }];
  plan.recipients[0].ustensile = 'grand plat à gratin rectangulaire en céramique émaillée';
  const r = valider(plan);
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.plan.dureeTotale, 85);
  assert.equal(r.plan.travail, 85, 'temps de travail ramené à la durée');
  assert.deepEqual(r.plan.etapes[1].ingredients.map((c) => [c.produit, c.plat]), [['haut de cuisse de poulet', 'poulet-curry'], ['oignon jaune', 'poulet-curry']]);
  assert.deepEqual(r.plan.etapes[3].plats, ['gratin-pommes-de-terre'], 'four allumé pour le plat de son prochain usage');
  assert.equal(r.plan.etapes[3].prechauffer, true);
  assert.deepEqual(r.plan.etapes[4].plats, ['gratin-pommes-de-terre'], 'plat déduit des ingrédients');
  assert.deepEqual(r.plan.etapes[6].partAvant, ['gratin-pommes-de-terre']);
  assert.ok(!r.plan.etapes[6].ingredients.some((c) => c.produit === 'thon au naturel'), 'ajout de la part retiré, sans erreur');
  assert.deepEqual(r.plan.etapes[9].ingredients.map((c) => c.produit), ['moutarde']);
  assert.equal(r.plan.recipients[0].ustensile.length, 40);
  const textes = r.avertissements.map((a) => a.message);
  assert.ok(textes.includes('Le temps de travail dépasse la durée du batch\u00A0: il est ramené à la durée.'));
  assert.ok(textes.includes('L’étape 10 cite «\u00A0mayonnaise\u00A0», qui n’est pas dans «\u00A0Salade de pommes de terre\u00A0»\u00A0: sa quantité ne s’affichera pas.'));
  assert.ok(textes.includes('«\u00A0Échalote\u00A0» de «\u00A0Salade de pommes de terre\u00A0» n’est cité dans aucune étape\u00A0: il est seulement dans «\u00A0Sortir tout ce qu’il faut\u00A0».'));
  assert.ok(textes.includes('Le nom du plat de cuisson de «\u00A0Gratin de pommes de terre\u00A0» est long\u00A0: il est raccourci.'));
  assert.ok(!textes.some((t) => /thon/.test(t)), 'l’ajout d’une part ne fait pas d’avertissement');
  // Un ingrédient cité deux fois pour le même plat dans une étape : une seule fois.
  const deux = planExemple(EMPREINTE);
  deux.etapes[0].ingredients.push({ produit: 'pommes de terre', plat: 'gratin-pommes-de-terre' });
  assert.equal(valider(deux).plan.etapes[0].ingredients.length, 2);
  // Parts de plus de 1.
  const parts = planExemple(EMPREINTE);
  parts.etapes[6].ingredients[0].part = 0.8;
  parts.etapes[7].ingredients = [{ produit: 'crème fraîche épaisse', plat: 'gratin-pommes-de-terre', part: 0.5 }];
  assert.ok(valider(parts).avertissements.some((a) => a.message === 'Les parts de «\u00A0crème fraîche épaisse\u00A0» de «\u00A0Gratin de pommes de terre\u00A0» font plus que la quantité de la recette.'));
});

test('validerPlanBatch : la manière de cuire de chaque recette est gardée (appareil, four à 10 °C près)', () => {
  const froid = planExemple(EMPREINTE);
  froid.etapes[7].tempC = 170;
  assert.deepEqual(codes(valider(froid)), ['batch.etapes : four de gratin-pommes-de-terre à 170 °C au lieu de 200 °C']);
  assert.deepEqual(valider(froid).erreurs.map((e) => e.message), ['«\u00A0Gratin de pommes de terre\u00A0» cuit à 170\u00A0°C au lieu de 200\u00A0°C.']);
  const proche = planExemple(EMPREINTE);
  proche.etapes[7].tempC = 190;
  assert.deepEqual(valider(proche).erreurs, []);
  const plaque = planExemple(EMPREINTE);
  for (const e of plaque.etapes.filter((x) => x.appareil === 'cookeo')) e.appareil = 'plaque';
  assert.deepEqual(codes(valider(plaque)), ['batch.etapes : l\'appareil cookeo de poulet-curry n\'apparaît dans aucune étape']);
  assert.deepEqual(valider(plaque).erreurs.map((e) => e.message), ['«\u00A0Poulet au curry\u00A0» ne passe plus par le Cookeo de sa recette.']);
  // Four jamais allumé : un avertissement, le rappel ira sur l'étape d'avant.
  const sansAllumer = planExemple(EMPREINTE);
  sansAllumer.etapes.splice(3, 1);
  assert.ok(valider(sansAllumer).avertissements.some((a) => a.message === 'Le plan n’allume pas le four avant «\u00A0Cuire le gratin\u00A0»\u00A0: l’app le rappellera à l’étape d’avant.'));
});

test('validerPlanBatch : une étape « le jour du repas » est retirée ; un ingrédient du seul service n’est pas à citer', () => {
  const servi = { ...POULET_SERVI };
  const elements = elementsDe(SEMAINE, [GRATIN, SALADE, servi]);
  const empreinte = empreintePlanBatch(elements);
  const texte = texteDemandeBatch(elements, { semaine: SEMAINE });
  assert.match(texte, /\n {2}au service: 1 botte coriandre fraîche\n/);
  assert.doesNotMatch(texte, /ingrédients: [^\n]*coriandre/);
  const plan = planExemple(empreinte);
  plan.etapes.push({ titre: 'Réchauffer une portion', texte: 'Réchauffez au micro-ondes.', duree: 3, plats: ['poulet-curry'], auService: true });
  const r = validerPlanBatch(plan, { elements, semaineId: SEMAINE.id, empreinte });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.plan.etapes.length, 11);
  assert.ok(r.avertissements.some((a) => a.message === '«\u00A0Réchauffer une portion\u00A0» se fait le jour du repas\u00A0: elle n’est pas reprise (l’app la rappelle à la fin).'));
  assert.ok(!r.avertissements.some((a) => /coriandre/.test(a.message)));
  // La fin le rappelle.
  const ecran = pasAPasBatch(r.plan, { elements, profils: PROFILS, aujourdhui: '2026-10-25' });
  assert.deepEqual(ecran.fin.plats[2].service.map((e) => e.titre), ['Parsemer de coriandre']);
  assert.ok(!ecran.avant.reunir[2].ingredients.some((i) => /Coriandre/.test(i.texte)));
});

test('validerPlanBatch : un plat absent de toutes les étapes (erreur), un ingrédient jamais cité (avertissement)', () => {
  const plan = planExemple(EMPREINTE);
  plan.etapes = plan.etapes.filter((e) => !e.plats.includes('poulet-curry'));
  plan.etapes[0].ingredients = plan.etapes[0].ingredients.filter((c) => c.plat !== 'salade-pommes-de-terre');
  const r = valider(plan);
  assert.deepEqual(codes(r), ['batch.etapes : le plat poulet-curry n\'apparaît dans aucune étape']);
  assert.ok(r.avertissements.some((a) => /«\u00A0Pomme de terre\u00A0» de «\u00A0Salade de pommes de terre\u00A0» n’est cité dans aucune étape/.test(a.message)));
});

test('validerPlanBatch : sans semaine montrée, refus ; semaine et empreinte écrites en nombre', () => {
  assert.equal(validerPlanBatch(planExemple(EMPREINTE), { elements: ELEMENTS, semaineId: null, empreinte: EMPREINTE }).refus, 'semaine');
  assert.equal(validerPlanBatch({ ...planExemple('123456'), empreinte: 123456 }, { elements: ELEMENTS, semaineId: SEMAINE.id, empreinte: '123456' }).refus, null);
});

test('validerPlanBatch : champs facultatifs fautifs retirés avec un avertissement, jamais une erreur', () => {
  const plan = planExemple(EMPREINTE);
  plan.etapes[0].actif = 99;
  plan.etapes[1].appareil = 'micro-ondes';
  plan.etapes[3].tempC = 1000;
  plan.etapes[4].partAvant = 'salade-pommes-de-terre';
  plan.etapes[7].pret = 'x'.repeat(200);
  plan.recipients = plan.recipients.slice(0, 2);
  const r = valider(plan, { appareils: ['plaque', 'four'] });
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.plan);
  assert.equal(r.plan.etapes[0].actif, null);
  assert.equal(r.plan.etapes[1].appareil, null);
  assert.equal(r.plan.etapes[3].prechauffer, false);
  assert.deepEqual(r.plan.etapes[4].partAvant, []);
  assert.equal(r.plan.etapes[7].pret, null);
  const textes = r.avertissements.map((a) => a.message);
  assert.ok(textes.includes('L’appareil de l’étape 2 est inconnu\u00A0: il n’est pas repris.'));
  assert.ok(textes.includes('L’étape 3 utilise un appareil que vos réglages n’ont pas.'));
  assert.ok(textes.includes('L’étape 4 allume un appareil sans dire lequel ni à quelle température.'));
  assert.ok(textes.includes('L’étape 5 met de côté une part qui n’existe pas\u00A0: ce n’est pas repris.'));
  assert.ok(textes.includes('Pas de plat de cuisson donné pour «\u00A0Poulet au curry\u00A0».'));
});

test('validerPlanBatch : le plat d’un ingrédient cité rejoint ceux de l’étape ; ingrédient au pluriel près', () => {
  const plan = planExemple(EMPREINTE);
  plan.etapes[1].plats = ['gratin-pommes-de-terre'];
  plan.etapes[1].ingredients[0].produit = 'hauts de cuisse de poulet';
  const r = valider(plan);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.plan.etapes[1].plats, ['gratin-pommes-de-terre', 'poulet-curry']);
});

test('texteCorrectionBatch : CORRECTION, version, semaine, codes, formule du plan entier', () => {
  const r = valider({ ...planExemple(EMPREINTE), travail: 0 });
  assert.equal(texteCorrectionBatch({ erreurs: r.erreurs, semaineId: SEMAINE.id }), [
    'CORRECTION paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'semaine: 2026-10-24',
    '- batch.travail : entier de 1 à dureeTotale attendu',
    '(Rends le plan de batch entier, corrigé, { "format", "instructions", "batch" }, en un seul bloc.)',
  ].join('\n'));
});

// ——— Carte de Semaine ———

test('etatCarteBatch : visible avec au moins 2 plats ; à demander, demandé, prêt, périmé', () => {
  assert.equal(PLATS_BATCH_MIN, 2);
  assert.equal(etatCarteBatch({ elements: ELEMENTS.slice(0, 1), semaine: SEMAINE }).visible, false);
  assert.equal(etatCarteBatch({ elements: ELEMENTS, semaine: null }).visible, false);
  const aDemander = etatCarteBatch({ elements: ELEMENTS, semaine: SEMAINE });
  assert.deepEqual([aDemander.visible, aDemander.etat, aDemander.nombre], [true, 'aDemander', 3]);
  // Demandée (horodatage du serveur ; nul tant qu'il n'est pas revenu).
  const demande = { statut: 'ouverte', creePar: 'b@exemple.fr', creeLe: new Date('2026-10-24T09:00:00') };
  const demandee = etatCarteBatch({ doc: { demande }, elements: ELEMENTS, semaine: SEMAINE, aujourdhui: '2026-10-24' });
  assert.equal(demandee.etat, 'demande');
  assert.deepEqual(demandee.demande, { par: 'b@exemple.fr', quand: 'aujourd’hui', horsLigne: false });
  assert.equal(etatCarteBatch({ doc: { demande }, elements: ELEMENTS, semaine: SEMAINE, aujourdhui: '2026-10-26' }).demande.quand, 'le 24 octobre');
  assert.equal(etatCarteBatch({ doc: { demande: { ...demande, creeLe: null } }, elements: ELEMENTS, semaine: SEMAINE }).demande.horsLigne, true);
  // Prêt : plan à l'empreinte de la semaine ; la demande est alors traitée, même restée ouverte.
  const { plan } = valider(planExemple(EMPREINTE));
  const pret = etatCarteBatch({ doc: { demande, plan, empreinte: EMPREINTE, portions: portionsDuBatch(ELEMENTS) }, elements: ELEMENTS, semaine: SEMAINE });
  assert.deepEqual([pret.etat, pret.duree, pret.portionsChangees, pret.demande], ['pret', 'Environ 1\u00A0h\u00A025, dont 50\u00A0min de travail', false, null]);
  // Portions changées depuis (un invité) : toujours prêt, avec la phrase.
  const invites = elementsDe({ ...SEMAINE, plats: { ...SEMAINE.plats, 'poulet-curry': { ajouteLe: 3, invites: { adultes: 2 } } } });
  assert.equal(etatCarteBatch({ doc: { plan, empreinte: EMPREINTE, portions: portionsDuBatch(ELEMENTS) }, elements: invites, semaine: SEMAINE }).portionsChangees, true);
  // Plats changés : périmé ; redemandé : demandé.
  const deux = ELEMENTS.slice(0, 2);
  assert.equal(etatCarteBatch({ doc: { plan, empreinte: EMPREINTE }, elements: deux, semaine: SEMAINE }).etat, 'perime');
  assert.equal(etatCarteBatch({ doc: { plan, empreinte: EMPREINTE, demande }, elements: deux, semaine: SEMAINE }).etat, 'demande');
  // Demande close (Annuler) : à demander.
  assert.equal(etatCarteBatch({ doc: { demande: { ...demande, statut: 'traitee' } }, elements: ELEMENTS, semaine: SEMAINE }).etat, 'aDemander');
});

test('textes : semaine du plan, notification sans date, clé de reprise', () => {
  assert.equal(texteSemaineDuPlan(SEMAINE), 'Semaine du 24 au 30 octobre');
  assert.equal(TEXTES_PLAN_BATCH.notification, 'Plan du batch à préparer');
  assert.doesNotMatch(TEXTES_PLAN_BATCH.notification, /\d/);
  assert.equal(cleRepriseBatch('uid1', '2026-10-24'), 'repas-courses:batch:uid1:2026-10-24');
});

// ——— Écran du batch ———

const ECRAN = pasAPasBatch(valider(planExemple(EMPREINTE)).plan, { elements: ELEMENTS, profils: PROFILS, moi: ADULTE_A, aujourdhui: '2026-10-25' });

test('pasAPasBatch : avant de commencer (plats, plats de cuisson, hygiène, parts, ce qu’il faut sortir)', () => {
  assert.equal(ECRAN.etat, 'ok');
  assert.equal(ECRAN.titrePage, 'Batch\u00A0: 3\u00A0plats');
  assert.equal(ECRAN.duree, 'Environ 1\u00A0h\u00A025, dont 50\u00A0min de travail');
  assert.equal(ECRAN.total, 10, 'l’étape qui allume le four n’a pas d’écran');
  assert.deepEqual(ECRAN.avant.plats, ['Gratin de pommes de terre · 4\u00A0portions', 'Salade de pommes de terre · 4\u00A0portions', 'Poulet au curry · 4\u00A0portions']);
  assert.equal(ECRAN.avant.recipients[0], 'Gratin de pommes de terre\u00A0: Plat à gratin · 25 × 20 cm, pour 4 parts');
  assert.equal(ECRAN.avant.hygiene.length, 2);
  assert.deepEqual(ECRAN.avant.parts, ['✂️ La part d’Adulte B de «\u00A0Gratin de pommes de terre\u00A0» se met de côté avant l’étape 6\u00A0: Mettez sa part dans un petit plat avant les lardons, ajoutez le thon.']);
  assert.deepEqual(ECRAN.avant.reunir.map((r) => r.ingredients.length), [5, 3, 3]);
  assert.equal(ECRAN.avant.reunir[0].ingredients[4].texte, 'Thon au naturel · 100\u00A0g (part d’Adulte B)');
  assert.ok(ECRAN.avant.ustensiles.some((u) => u.nom === 'Plat à gratin'));
});

test('pasAPasBatch : étapes avec leurs plats, quantités réunies, rappels du four et de la part, cuisson à cœur', () => {
  const [pdt, saisir, curry, four] = ECRAN.etapes;
  assert.ok(!ECRAN.etapes.some((e) => e.titre === 'Allumer le four'));
  assert.equal(four.titre, 'Faire revenir les lardons', 'le rappel du four va sur l’étape qui suit « Allumer le four »');
  assert.equal(pdt.pour, 'Pour\u00A0: Gratin de pommes de terre, Salade de pommes de terre');
  assert.deepEqual(pdt.quantites.map((q) => q.texte), ['Pomme de terre · 1,6\u00A0kg (1\u00A0kg pour Gratin de pommes de terre, 600\u00A0g pour Salade de pommes de terre)']);
  assert.equal(pdt.pendant, true);
  assert.deepEqual(saisir.conseils, []);
  assert.equal(curry.conseils.length, 1);
  assert.equal(four.rappels[0].genre, 'four');
  assert.match(four.rappels[0].texte, /Allumez le four à 200\u00A0°C maintenant\u00A0: il servira à «\u00A0Cuire le gratin\u00A0»\./);
  const monter = ECRAN.etapes.find((e) => e.titre === 'Monter le gratin');
  assert.equal(monter.rappels[0].genre, 'part');
  assert.equal(monter.rappels[0].case.cle, 'part:gratin-pommes-de-terre:profil-b');
  assert.deepEqual(monter.rappels[0].ajouts, ['Thon au naturel · 100\u00A0g']);
  assert.equal(ECRAN.etapes.at(-1).pendant, false);
  // « Pendant que ça cuit » jamais juste avant une étape du même plat (le gratin, puis sa sortie).
  const cuire = ECRAN.etapes.find((e) => e.titre === 'Cuire le gratin');
  assert.equal(cuire.pendant, true, 'suivi d’« Ouvrir le Cookeo »');
  const sansCookeo = planExemple(EMPREINTE);
  sansCookeo.etapes = sansCookeo.etapes.filter((e) => e.titre !== 'Ouvrir le Cookeo' && e.titre !== 'Assaisonner la salade');
  sansCookeo.etapes.splice(7, 0, { ...planExemple(EMPREINTE).etapes[9] });
  const ecran = pasAPasBatch(valider(sansCookeo).plan, { elements: ELEMENTS, profils: PROFILS, aujourdhui: '2026-10-25' });
  const cuire2 = ecran.etapes.findIndex((e) => e.titre === 'Cuire le gratin');
  assert.equal(ecran.etapes[cuire2 + 1].titre, 'Sortir le gratin');
  assert.equal(ecran.etapes[cuire2].pendant, false);
});

test('pasAPasBatch : quantités d’un produit présent deux fois dans une recette, additionnées', () => {
  const gratin = { ...GRATIN, ingredients: [...GRATIN.ingredients, { produit: 'gruyère râpé', qte: 50, unite: 'g', rayon: 'fromages', marqueurs: ['laitier'] }, { produit: 'beurre', qte: 20, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] }] };
  const salade = { ...SALADE, ingredients: [...SALADE.ingredients, { produit: 'beurre', qte: 30, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] }, { produit: 'beurre', qte: 1, unite: 'cs', rayon: 'cremerie', marqueurs: ['laitier'] }] };
  const elements = elementsDe(SEMAINE, [gratin, salade, POULET]);
  const empreinte = empreintePlanBatch(elements);
  const plan = planExemple(empreinte);
  plan.etapes[0].ingredients.push({ produit: 'beurre', plat: 'gratin-pommes-de-terre' }, { produit: 'beurre', plat: 'salade-pommes-de-terre' });
  const r = validerPlanBatch(plan, { elements, semaineId: SEMAINE.id, empreinte });
  const ecran = pasAPasBatch(r.plan, { elements, profils: PROFILS, aujourdhui: '2026-10-25' });
  assert.ok(ecran.etapes[0].quantites.some((q) => q.texte === 'Beurre · 50\u00A0g + 1\u00A0c. à soupe (20\u00A0g pour Gratin de pommes de terre, 30\u00A0g + 1\u00A0c. à soupe pour Salade de pommes de terre)'), ecran.etapes[0].quantites.map((q) => q.texte).join(' | '));
  assert.ok(ecran.avant.reunir[0].ingredients.some((i) => i.texte === 'Gruyère râpé · 150\u00A0g'), ecran.avant.reunir[0].ingredients.map((i) => i.texte).join(' | '));
});

test('pasAPasBatch : fin de chaque plat ; plan illisible ; étapes d’un plat qui n’est plus dans la semaine', () => {
  assert.equal(ECRAN.fin.titre, 'Batch terminé 🎉');
  assert.deepEqual(ECRAN.fin.plats.map((p) => p.nom), ['Gratin de pommes de terre', 'Salade de pommes de terre', 'Poulet au curry']);
  assert.match(ECRAN.fin.plats[1].congeler, /^Ce plat ne se congèle pas/);
  assert.ok(ECRAN.fin.plats[0].partFragile);
  assert.equal(pasAPasBatch(null).etat, 'introuvable');
  const sansPoulet = pasAPasBatch(valider(planExemple(EMPREINTE)).plan, { elements: ELEMENTS.slice(0, 2), profils: PROFILS, aujourdhui: '2026-10-25' });
  assert.ok(!sansPoulet.etapes.some((e) => e.titre === 'Lancer le curry'));
  assert.equal(sansPoulet.fin.plats.length, 2);
});

test('pasAPasBatch : une étape « la veille » va dans « Avant de commencer »', () => {
  const plan = planExemple(EMPREINTE);
  plan.etapes[1].veille = true;
  const ecran = pasAPasBatch(valider(plan).plan, { elements: ELEMENTS, profils: PROFILS, aujourdhui: '2026-10-25' });
  assert.deepEqual(ecran.avant.veille.map((e) => e.titre), ['Saisir le poulet']);
  assert.equal(ecran.total, 9);
  assert.ok(!ecran.etapes.some((e) => e.titre === 'Saisir le poulet'));
});

test('GRATIN et SALADE : fixtures cohérentes (recette validée)', () => {
  assert.equal(GRATIN.realisation.length, GRATIN.etapes.length);
  assert.equal(SALADE.realisation.length, SALADE.etapes.length);
  assert.deepEqual(copie(GRATIN).id, 'gratin-pommes-de-terre');
});

test('phraseDemandeBatch : quand, auteur (prénom ou « vous », jamais une adresse), hors ligne', () => {
  const profils = [{ id: 'profil-b', nom: 'Adulte B', email: 'B@Exemple.fr ' }];
  const demande = { par: 'b@exemple.fr', quand: 'le 24 octobre', horsLigne: false };
  assert.equal(phraseDemandeBatch(demande), '📬 Demandé le 24 octobre. Il apparaîtra ici dès qu’il sera prêt.');
  assert.equal(phraseDemandeBatch(demande, { profils, avecAuteur: true }), '📬 Demandé par Adulte B le 24 octobre.');
  assert.equal(phraseDemandeBatch(demande, { profils, avecAuteur: true, moi: 'b@exemple.fr' }), '📬 Demandé par vous le 24 octobre.');
  assert.equal(phraseDemandeBatch({ ...demande, par: 'inconnu@exemple.fr' }, { profils, avecAuteur: true }), '📬 Demandé le 24 octobre.');
  // Pas encore datée par le serveur : « aujourd’hui » en ligne, la phrase du réseau hors ligne.
  const enAttente = { par: 'b@exemple.fr', quand: '', horsLigne: true };
  assert.equal(phraseDemandeBatch(enAttente), '📬 Demandé aujourd’hui. Il apparaîtra ici dès qu’il sera prêt.');
  assert.equal(phraseDemandeBatch(enAttente, { enLigne: false }), TEXTES_PLAN_BATCH.demandeHorsLigne);
  assert.equal(phraseDemandeBatch(null), '');
  for (const texte of [phraseDemandeBatch(demande, { profils, avecAuteur: true }), phraseDemandeBatch(enAttente, { enLigne: false })]) {
    assert.doesNotMatch(texte, /@/);
  }
});

test('quandDemande et texteEnviron', async () => {
  const { quandDemande, texteEnviron } = await import('../js/coeur/plan-batch.js');
  assert.equal(quandDemande('2026-10-24', '2026-10-24'), 'aujourd’hui');
  assert.equal(quandDemande('2026-10-24', '2026-10-26'), 'le 24 octobre');
  assert.equal(quandDemande(null, '2026-10-24'), '');
  assert.equal(texteEnviron(85, 50), 'Environ 1\u00A0h\u00A025, dont 50\u00A0min de travail');
  assert.equal(texteEnviron(40, 40), 'Environ 40\u00A0min');
  assert.equal(texteEnviron(0, 10), null);
});
