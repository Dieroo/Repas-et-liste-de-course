// Plan du batch (2026-10-19) : plats du batch, empreinte, texte DEMANDE-BATCH, lecture et validation de la réponse de
// Claude, correction, carte de Semaine, écran du batch. Fixtures génériques (tests/donnees/plan-batch.js).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTETE_DEMANDE_BATCH, PLATS_BATCH_MIN, TEXTES_PLAN_BATCH, cleRepriseBatch, demandeBatchATraiter, empreintePlanBatch,
  estReponseBatch, etatCarteBatch, pasAPasBatch, planDeLaReponse, platsDuBatch, portionsDuBatch, texteCorrectionBatch,
  texteDemandeBatch, texteSemaineDuPlan, validerPlanBatch,
} from '../js/coeur/plan-batch.js';
import { VERSION_INSTRUCTIONS } from '../js/coeur/claude.js';
import { ADULTE_A, GRATIN, PLATS, PROFILS, SALADE, SEMAINE, planExemple } from './donnees/plan-batch.js';

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
  assert.ok(lignes.includes('  parts à mettre de côté: sans lardons (avec thon au naturel)'));
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
    feu: null, ustensiles: [], plats: ['gratin-pommes-de-terre'], ingredients: [], aussi: [], pret: null, prechauffer: true, partAvant: null, veille: false,
  });
  assert.equal(r.plan.etapes[6].partAvant, 'gratin-pommes-de-terre');
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

test('validerPlanBatch : erreurs de forme, avec les codes exacts pour Claude', () => {
  assert.deepEqual(codes(valider(null)), ['batch : objet attendu']);
  const plan = planExemple(EMPREINTE);
  plan.dureeTotale = 0;
  plan.travail = 999;
  plan.etapes[1].titre = '';
  plan.etapes[2].duree = 2000;
  plan.etapes[4].plats = [];
  plan.etapes[5].plats = ['inconnu'];
  plan.etapes[9].ingredients = [{ produit: 'mayonnaise', plat: 'salade-pommes-de-terre' }, { produit: 'moutarde' }];
  const r = valider(plan);
  assert.equal(r.plan, null);
  assert.deepEqual(codes(r), [
    'batch.dureeTotale : entier de 1 à 1440 attendu',
    'batch.etapes[1].titre : texte de 1 à 60 caractères attendu',
    'batch.etapes[2].duree : entier de 1 à 1440 attendu',
    'batch.etapes[4].plats : identifiants des plats de la demande attendus',
    'batch.etapes[5].plats : « inconnu » n\'est pas un plat de la demande',
    'batch.etapes[9].ingredients[0] : « mayonnaise » n\'est pas un ingrédient de salade-pommes-de-terre',
    'batch.etapes[9].ingredients[1] : { "produit", "plat" } attendu',
    'batch.etapes : « échalote » de salade-pommes-de-terre n\'est cité dans aucune étape',
    'batch.etapes : « moutarde » de salade-pommes-de-terre n\'est cité dans aucune étape',
  ]);
  // Messages affichés : sans code ni mot technique.
  for (const e of r.erreurs) assert.doesNotMatch(e.message, /batch\.|etapes\[|json|paquet|slug/i);
});

test('validerPlanBatch : un plat absent de toutes les étapes, un ingrédient jamais cité', () => {
  const plan = planExemple(EMPREINTE);
  plan.etapes = plan.etapes.filter((e) => !e.plats.includes('poulet-curry'));
  plan.etapes[0].ingredients = plan.etapes[0].ingredients.filter((c) => c.plat !== 'salade-pommes-de-terre');
  assert.deepEqual(codes(valider(plan)), [
    'batch.etapes : « pomme de terre » de salade-pommes-de-terre n\'est cité dans aucune étape',
    'batch.etapes : le plat poulet-curry n\'apparaît dans aucune étape',
  ]);
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
  assert.equal(r.plan.etapes[4].partAvant, null);
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
  const r = valider({ ...planExemple(EMPREINTE), dureeTotale: 30, travail: 45 });
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
  assert.ok(demandeBatchATraiter({ doc: { demande }, elements: ELEMENTS, semaine: SEMAINE }));
  // Prêt : plan à l'empreinte de la semaine ; la demande est alors traitée, même restée ouverte.
  const { plan } = valider(planExemple(EMPREINTE));
  const pret = etatCarteBatch({ doc: { demande, plan, empreinte: EMPREINTE, portions: portionsDuBatch(ELEMENTS) }, elements: ELEMENTS, semaine: SEMAINE });
  assert.deepEqual([pret.etat, pret.duree, pret.portionsChangees, pret.demande], ['pret', 'Environ 1 h 20, dont 50 min de travail', false, null]);
  assert.ok(!demandeBatchATraiter({ doc: { demande, plan, empreinte: EMPREINTE }, elements: ELEMENTS, semaine: SEMAINE }));
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
  assert.equal(TEXTES_PLAN_BATCH.notification, 'Plan de batch à préparer');
  assert.doesNotMatch(TEXTES_PLAN_BATCH.notification, /\d/);
  assert.equal(cleRepriseBatch('uid1', '2026-10-24'), 'repas-courses:batch:uid1:2026-10-24');
});

// ——— Écran du batch ———

const ECRAN = pasAPasBatch(valider(planExemple(EMPREINTE)).plan, { elements: ELEMENTS, profils: PROFILS, moi: ADULTE_A, aujourdhui: '2026-10-25' });

test('pasAPasBatch : avant de commencer (plats, plats de cuisson, hygiène, parts, ce qu’il faut sortir)', () => {
  assert.equal(ECRAN.etat, 'ok');
  assert.equal(ECRAN.titrePage, 'Batch : 3 plats');
  assert.equal(ECRAN.duree, 'Environ 1 h 20, dont 50 min de travail');
  assert.equal(ECRAN.total, 11);
  assert.deepEqual(ECRAN.avant.plats, ['Gratin de pommes de terre · 4 portions', 'Salade de pommes de terre · 4 portions', 'Poulet au curry · 4 portions']);
  assert.equal(ECRAN.avant.recipients[0], 'Gratin de pommes de terre : Plat à gratin · 25 × 20 cm, pour 4 parts');
  assert.equal(ECRAN.avant.hygiene.length, 2);
  assert.deepEqual(ECRAN.avant.parts, ['✂️ La part d’Adulte B de « Gratin de pommes de terre » se met de côté avant l’étape 7 : Mettez sa part dans un petit plat avant les lardons, ajoutez le thon.']);
  assert.deepEqual(ECRAN.avant.reunir.map((r) => r.ingredients.length), [5, 3, 3]);
  assert.equal(ECRAN.avant.reunir[0].ingredients[4].texte, 'Thon au naturel · 100 g (part d’Adulte B)');
  assert.ok(ECRAN.avant.ustensiles.some((u) => u.nom === 'Plat à gratin'));
});

test('pasAPasBatch : étapes avec leurs plats, quantités réunies, rappels du four et de la part, cuisson à cœur', () => {
  const [pdt, saisir, curry, four] = ECRAN.etapes;
  assert.equal(pdt.pour, 'Pour : Gratin de pommes de terre, Salade de pommes de terre');
  assert.deepEqual(pdt.quantites.map((q) => q.texte), ['Pomme de terre · 1,6 kg (1 kg pour Gratin de pommes de terre, 600 g pour Salade de pommes de terre)']);
  assert.equal(pdt.pendant, true);
  assert.deepEqual(saisir.conseils, []);
  assert.equal(curry.conseils.length, 1);
  assert.equal(four.rappels[0].genre, 'four');
  assert.match(four.rappels[0].texte, /Allumez le four à 200 °C maintenant : il servira à « Cuire le gratin »\./);
  const monter = ECRAN.etapes[6];
  assert.equal(monter.rappels[0].genre, 'part');
  assert.equal(monter.rappels[0].case.cle, 'part:gratin-pommes-de-terre:profil-b');
  assert.deepEqual(monter.rappels[0].ajouts, ['Thon au naturel · 100 g']);
  assert.equal(ECRAN.etapes.at(-1).pendant, false);
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
  assert.equal(ecran.total, 10);
  assert.ok(!ecran.etapes.some((e) => e.titre === 'Saisir le poulet'));
});

test('GRATIN et SALADE : fixtures cohérentes (recette validée)', () => {
  assert.equal(GRATIN.realisation.length, GRATIN.etapes.length);
  assert.equal(SALADE.realisation.length, SALADE.etapes.length);
  assert.deepEqual(copie(GRATIN).id, 'gratin-pommes-de-terre');
});
