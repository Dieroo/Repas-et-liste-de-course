// Étapes détaillées `realisation` (T5-0b, js/coeur/realisation.js) : validation, tolérances, lecture, plats à
// détailler, empreinte des étapes, parts à mettre de côté, édition réduite, textes. Fixtures génériques ; la réponse
// réelle de l'essai avec le projet Claude (tests/donnees/reponse-etapes-essai.js) doit passer sans erreur.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAPES_MAX, ETAPES_PAR_MESSAGE, FEUX, TEXTES_ETAPES, USTENSILES_SUGGERES, VEILLE_ATTENTE_MIN, ajouterEtapeALaFin,
  carteEtapesDetaillees, changerEtape, empreinteEtapes, enteteApercuEtapes, etapesLisibles, etatRealisation, ligneAppareil,
  ligneDuree, lignesApercuEtapes, partsAMettreDeCote, platsADetailler, platsDeLaSemaineADetailler, realisationAJour,
  retirerEtapeRealisation, suivreCuissonPrincipale, texteDuree, titresDe, travailRecette, validerRealisation,
} from '../js/coeur/realisation.js';
import { FICHES_ESSAI, REPONSE_ETAPES_ESSAI } from './donnees/reponse-etapes-essai.js';

// ——— Fixtures ———

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const PATES = ing('pâtes courtes', 400, 'g', ['feculent']);
const JAMBON = ing('jambon blanc', 4, 'tranche', ['viande', 'porc', 'charcuterie'], { forme: 'fine' });
const CREME = ing('crème fraîche épaisse', 20, 'cl', ['laitier']);
const BEURRE = ing('beurre', 40, 'g', ['laitier']);
const CUISSON = [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, dureeMin: 20 }];

const etape = (titre, extra = {}) => ({ titre, texte: `${titre}, avec soin.`, duree: 5, ...extra });
const REALISATION = [
  etape('Cuire les pâtes', { duree: 10, actif: 1, appareil: 'plaque', feu: 'vif', ingredients: ['pâtes courtes'], apres: [] }),
  etape('Faire la sauce', { appareil: 'plaque', feu: 'doux', ingredients: ['crème fraîche épaisse', 'jambon blanc'], partAvant: true }),
  etape('Gratiner', { duree: 20, actif: 1, appareil: 'four', tempC: 200, pret: 'Le dessus est doré.', apres: [1, 2] }),
];
const GRATIN = {
  id: 'gratin-test', nom: 'Gratin test', type: 'plat', statutRecette: 'brouillon', portionsBase: 4,
  ingredients: [PATES, JAMBON, CREME], cuisson: CUISSON, etapes: ['Cuire.', 'Gratiner.'], tempsActifMin: 15,
};
const detaille = (plat, realisation = REALISATION) => ({ ...plat, realisation: structuredClone(realisation), etapes: titresDe(realisation) });
const valider = (realisation, plat = GRATIN, options = {}) => validerRealisation(realisation, {
  produits: plat.ingredients, cuisson: plat.cuisson, nom: plat.nom, ...options,
});
const codes = (liste) => liste.map((e) => e.code);
const messages = (liste) => liste.map((e) => e.message);

// ——— Réponse réelle de l'essai ———

test('essai avec le vrai Claude : les trois réalisations passent sans erreur ni avertissement contre leurs fiches', () => {
  assert.equal(REPONSE_ETAPES_ESSAI.plats.length, 3);
  for (const [i, entree] of REPONSE_ETAPES_ESSAI.plats.entries()) {
    const fiche = FICHES_ESSAI[i];
    assert.equal(entree.id, fiche.id);
    const r = valider(entree.realisation, fiche);
    assert.deepEqual(r.erreurs, [], fiche.id);
    assert.deepEqual(r.avertissements, [], fiche.id);
    assert.equal(r.realisation.length, entree.realisation.length);
    // Normalisée puis revalidée : la même (idempotence).
    assert.deepEqual(valider(r.realisation, fiche).realisation, r.realisation);
  }
});

test('essai : le réchauffage au four à 160 °C (le jour du repas) d’un gratin cuit à 180 °C est accepté ; hors service, refusé', () => {
  const [gratin] = REPONSE_ETAPES_ESSAI.plats;
  const fiche = FICHES_ESSAI[0];
  assert.equal(gratin.realisation[5].auService, true);
  assert.deepEqual(valider(gratin.realisation, fiche).erreurs, []);
  const horsService = structuredClone(gratin.realisation);
  delete horsService[5].auService;
  const r = valider(horsService, fiche);
  assert.deepEqual(codes(r.erreurs), ['realisation[5].tempC : 160 °C, la cuisson dit 180 °C pour four (10 °C d\'écart au plus)']);
  assert.equal(r.erreurs[0].raison, 'l’étape 6 cuit au four à 160\u00A0°C, sa cuisson dit 180\u00A0°C');
  assert.equal(r.realisation, null);
  // 10 °C d'écart : toléré.
  horsService[5].tempC = 170;
  assert.deepEqual(valider(horsService, fiche).erreurs, []);
});

test('essai : lecture, travail et quantités mises à l’échelle (6 portions au lieu de 4)', () => {
  const [gratin, carbonade, gateau] = REPONSE_ETAPES_ESSAI.plats.map((entree, i) => {
    const { realisation } = valider(entree.realisation, FICHES_ESSAI[i]);
    return { ...FICHES_ESSAI[i], realisation, etapes: titresDe(realisation) };
  });
  assert.equal(travailRecette(gratin), 29);
  assert.equal(travailRecette(carbonade), 40);
  assert.equal(travailRecette(gateau), 24);
  const lu = etapesLisibles(carbonade, { portions: 6 });
  assert.equal(lu.detaillee, true);
  assert.equal(lu.facteur, 1.5);
  // Le beurre en deux parts : 40 g × 0,7 × 1,5 et 40 g × 0,3 × 1,5.
  assert.deepEqual(lu.etapes[2].ingredients.map((i) => [i.produit, i.qte, i.unite, i.part]), [['beurre', 42, 'g', 0.7], ['lardon fumé', 150, 'g', 1]]);
  assert.deepEqual(lu.etapes[3].ingredients.map((i) => i.texte), ['Beurre · 18\u00A0g']);
  assert.equal(lu.etapes[1].ingredients[0].texte, 'Bœuf à braiser · 1\u202F200\u00A0g');
  // « Et aussi » mesuré : mis à l'échelle (gâteau en 6 portions : facteur 1).
  const lait = etapesLisibles(gratin, { portions: 8 }).etapes[1];
  assert.deepEqual(lait.aussi.map((a) => [a.produit, a.qte, a.unite]), [['sel fin', 2, 'cc'], ['poivre noir', null, null]]);
  assert.equal(etapesLisibles(gateau).etapes[3].aussi[0].texte, 'Sel fin · 1\u00A0pincée');
});

test('ETAPES_PAR_MESSAGE vaut 4 (essai : moins de 4 Ko par recette) ; constantes', () => {
  assert.equal(ETAPES_PAR_MESSAGE, 4);
  assert.equal(ETAPES_MAX, 30);
  assert.equal(VEILLE_ATTENTE_MIN, 240);
  assert.deepEqual(FEUX, ['doux', 'moyen', 'vif']);
  assert.ok(USTENSILES_SUGGERES.includes('plat à gratin'));
  assert.ok(USTENSILES_SUGGERES.every((u) => u === u.toLocaleLowerCase('fr-FR')));
});

// ——— Erreurs de structure : codes exacts ———

test('erreurs : liste vide, illisible ou trop longue', () => {
  for (const brut of [undefined, null, 'étapes', {}, []]) {
    const r = valider(brut);
    assert.deepEqual(codes(r.erreurs), ['realisation : liste de 1 à 30 étapes attendue'], JSON.stringify(brut));
    assert.equal(r.realisation, null);
  }
  const trop = Array.from({ length: 31 }, (_, i) => etape(`Étape ${i + 1}`));
  assert.deepEqual(codes(valider(trop, { ...GRATIN, cuisson: [] }).erreurs), ['realisation : 30 étapes au plus']);
});

test('erreurs : étape illisible, titre, texte et durée (codes exacts, préfixe pour Claude)', () => {
  const r = validerRealisation([
    'Cuire.',
    { texte: 'Sans titre.', duree: 5 },
    { titre: 'x'.repeat(61), texte: 'Titre trop long.', duree: 5 },
    { titre: 'Sans texte', duree: 5 },
    { titre: 'Texte trop long', texte: 'x'.repeat(1001), duree: 5 },
    { titre: 'Durée', texte: 'Durée en texte.', duree: '20 min' },
    { titre: 'Durée', texte: 'Durée nulle.', duree: 0 },
    { titre: 'Durée', texte: 'Durée trop longue.', duree: 1441 },
    { titre: 'Durée', texte: 'Durée pas entière.', duree: 2.5 },
  ], { prefixe: 'plats[0] (gratin)', nom: 'Gratin' });
  assert.deepEqual(codes(r.erreurs), [
    'realisation[0] : objet attendu',
    'realisation[1].titre : texte obligatoire (60 caractères au plus)',
    'realisation[2].titre : 60 caractères au plus',
    'realisation[3].texte : texte obligatoire',
    'realisation[4].texte : 1000 caractères au plus (350 conseillés)',
    'realisation[5].duree : entier de 1 à 1440 attendu',
    'realisation[6].duree : entier de 1 à 1440 attendu',
    'realisation[7].duree : entier de 1 à 1440 attendu',
    'realisation[8].duree : entier de 1 à 1440 attendu',
  ]);
  assert.equal(r.erreurs[5].pourClaude, 'plats[0] (gratin) realisation[5].duree : entier de 1 à 1440 attendu');
  assert.equal(r.erreurs[5].message, '«\u00A0Gratin\u00A0»\u00A0: l’étape 6 n’a pas de durée lisible.');
  assert.equal(r.realisation, null);
  // Durée en texte de chiffres : lue.
  assert.deepEqual(valider([{ ...REALISATION[0], duree: '10' }, ...REALISATION.slice(1)]).erreurs, []);
});

test('erreur : un appareil de la cuisson dans aucune étape (hors le jour du repas)', () => {
  const sansFour = [REALISATION[0], REALISATION[1], etape('Gratiner', { duree: 20 })];
  const r = valider(sansFour);
  assert.deepEqual(codes(r.erreurs), ['realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape']);
  assert.equal(r.erreurs[0].raison, 'l’appareil four de sa cuisson n’apparaît dans aucune étape');
  // Le four seulement le jour du repas : ne compte pas.
  const auService = [...sansFour, etape('Réchauffer', { appareil: 'four', tempC: 160, auService: true })];
  assert.deepEqual(codes(valider(auService).erreurs), ['realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape']);
  // Fiche en base, sauvegarde ou « Modifier » : simple avertissement.
  const doux = valider(sansFour, GRATIN, { ecart: 'avertissement' });
  assert.deepEqual(doux.erreurs, []);
  assert.ok(doux.realisation);
  assert.ok(codes(doux.avertissements).includes('realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape'));
  // Sans cuisson connue (lot d'étapes validé seul) : rien n'est vérifié.
  assert.deepEqual(validerRealisation(sansFour).erreurs, []);
});

// ——— Tolérances ———

test('tolérances : feu (casse, accents, « feu moyen », « moyen-vif », « moyen-doux »), inconnu retiré', () => {
  const avecFeu = (feu) => valider([{ ...REALISATION[0], feu }, ...REALISATION.slice(1)]);
  for (const [brut, attendu] of [['Feu moyen', 'moyen'], ['moyen-vif', 'vif'], ['Moyen-doux', 'doux'], ['FORT', 'vif'], ['à feu doux', 'doux'], ['vif', 'vif']]) {
    const r = avecFeu(brut);
    assert.equal(r.realisation[0].feu, attendu, brut);
    assert.deepEqual(r.avertissements, [], brut);
  }
  const inconnu = avecFeu('braise');
  assert.equal(inconnu.realisation[0].feu, undefined);
  assert.deepEqual(codes(inconnu.avertissements), ['realisation[0].feu « braise » : `doux`, `moyen` ou `vif`']);
  // Un feu sur une étape au four : retiré sans rien dire.
  const four = valider([REALISATION[0], REALISATION[1], { ...REALISATION[2], feu: 'vif' }]);
  assert.equal(four.realisation[2].feu, undefined);
  assert.deepEqual(four.avertissements, []);
});

test('tolérances : travail (au-delà de la durée : ramené ; illisible : ignoré), arrondi', () => {
  const r = valider([{ ...REALISATION[0], actif: 12 }, { ...REALISATION[1], actif: -2 }, { ...REALISATION[2], actif: '1,4' }]);
  assert.equal(r.realisation[0].actif, 10);
  assert.equal(r.realisation[1].actif, undefined);
  assert.equal(r.realisation[2].actif, 1);
  assert.deepEqual(codes(r.avertissements), ['realisation[0].actif : ramené à duree', 'realisation[1].actif : entier de 0 à duree, ignoré']);
});

test('tolérances : appareil inconnu retiré ; micro-ondes le jour du repas sans rien dire ; mode et température', () => {
  const r = valider([
    ...REALISATION,
    etape('Griller', { appareil: 'grill' }),
    etape('Réchauffer', { appareil: 'micro-ondes', auService: true }),
    etape('Réchauffer encore', { appareil: 'Micro-ondes' }),
  ]);
  assert.equal(r.realisation[3].appareil, undefined);
  assert.equal(r.realisation[4].appareil, undefined);
  assert.equal(r.realisation[4].auService, true);
  assert.deepEqual(codes(r.avertissements), [
    'realisation[3].appareil « grill » inconnu, retiré',
    'realisation[5].appareil « Micro-ondes » inconnu, retiré',
  ]);
  const cookeo = { ...GRATIN, cuisson: [{ appareil: 'cookeo', mode: 'sous pression', dureeMin: 25 }] };
  const modes = valider([
    etape('Cuire', { duree: 25, appareil: 'cookeo', mode: 'Sous pression', ingredients: ['pâtes courtes', 'jambon blanc', 'crème fraîche épaisse'] }),
    etape('Dorer', { appareil: 'cookeo', mode: 'x'.repeat(31) }),
    etape('Chauffer', { appareil: 'plaque', mode: 'doux' }),
  ], cookeo);
  assert.equal(modes.realisation[0].mode, 'Sous pression');
  assert.equal(modes.realisation[1].mode, 'x'.repeat(30));
  assert.equal(modes.realisation[2].mode, undefined);
  assert.ok(codes(modes.avertissements).includes('realisation[1].mode : 30 caractères au plus'));
  // Four sans température : avertissement ; température illisible : retirée.
  const sansTemperature = valider([REALISATION[0], REALISATION[1], { ...REALISATION[2], tempC: undefined }]);
  assert.deepEqual(codes(sansTemperature.avertissements), ['realisation[2].tempC conseillé pour four']);
  const illisible = valider([REALISATION[0], REALISATION[1], { ...REALISATION[2], tempC: 'chaud' }]);
  assert.equal(illisible.realisation[2].tempC, undefined);
  assert.deepEqual(codes(illisible.avertissements), ['realisation[2].tempC : nombre supérieur à 0, ignoré']);
});

test('tolérances : ustensiles (minuscules, sans doublon, 8 au plus, 40 caractères), « Et aussi » (6 au plus, mesures)', () => {
  const r = valider([
    { ...REALISATION[0], ustensiles: ['Grande casserole', 'grande casserole', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
    { ...REALISATION[1], ustensiles: 'Sauteuse', aussi: ['Poivre noir', { produit: 'gros sel', qte: 1, unite: 'cs', fixe: true }, { produit: 'eau', qte: 'beaucoup', unite: 'l' }, { produit: 'sel', qte: 1, unite: 'poignée' }, { qte: 2 }] },
    { ...REALISATION[2], ustensiles: ['x'.repeat(45)], aussi: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  ]);
  assert.deepEqual(r.realisation[0].ustensiles, ['grande casserole', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(r.realisation[1].ustensiles, ['sauteuse']);
  assert.deepEqual(r.realisation[1].aussi, ['poivre noir', { produit: 'gros sel', qte: 1, unite: 'cs', fixe: true }, 'eau', 'sel']);
  assert.deepEqual(r.realisation[2].ustensiles, ['x'.repeat(40)]);
  assert.deepEqual(r.realisation[2].aussi, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(codes(r.avertissements), [
    'realisation[0].ustensiles : 8 au plus, 40 caractères chacun',
    'realisation[1].aussi[2] : qte supérieure à 0 et unite connue attendues',
    'realisation[1].aussi[3] : qte supérieure à 0 et unite connue attendues',
    'realisation[1].aussi[4] : nom de produit attendu',
    'realisation[2].ustensiles : 8 au plus, 40 caractères chacun',
    'realisation[2].aussi : 6 au plus',
  ]);
});

test('tolérances : signe « prêt » coupé à 120 ; texte long averti au-delà de 450 ; booléens écrits en texte', () => {
  const r = valider([
    { ...REALISATION[0], pret: 'p'.repeat(130), texte: 't'.repeat(451) },
    { ...REALISATION[1], partAvant: 'oui' },
    { ...REALISATION[2], auService: 'non', veille: 'true' },
  ]);
  assert.equal(r.realisation[0].pret, 'p'.repeat(120));
  assert.equal(r.realisation[0].texte.length, 451);
  assert.equal(r.realisation[1].partAvant, true);
  assert.equal(r.realisation[2].auService, undefined);
  assert.equal(r.realisation[2].veille, true);
  assert.deepEqual(codes(r.avertissements), ['realisation[0].texte : 350 caractères conseillés', 'realisation[0].pret : 120 caractères au plus']);
});

test('tolérances : `apres` vers une étape absente, elle-même ou une suivante : retiré (l’étape suit la précédente) ; [] gardé', () => {
  const r = valider([
    { ...REALISATION[0], apres: [] },
    { ...REALISATION[1], apres: [2, 3] },
    { ...REALISATION[2], apres: ['1', 2, 0, 2.5] },
  ]);
  assert.deepEqual(r.realisation[0].apres, []);
  assert.equal(r.realisation[1].apres, undefined);
  assert.deepEqual(r.realisation[2].apres, [1, 2]);
  assert.deepEqual(codes(r.avertissements), [
    'realisation[1].apres : 2, 3 retiré (numéros d\'étapes plus petits que 2 attendus)',
    'realisation[2].apres : 0, 2.5 retiré (numéros d\'étapes plus petits que 3 attendus)',
  ]);
  // Un seul numéro, sans liste : lu.
  assert.deepEqual(valider([REALISATION[0], REALISATION[1], { ...REALISATION[2], apres: 1 }]).realisation[2].apres, [1]);
});

test('tolérances : une seule étape `partAvant` (les suivantes ignorées)', () => {
  const r = valider([REALISATION[0], REALISATION[1], { ...REALISATION[2], partAvant: true }]);
  assert.equal(r.realisation[1].partAvant, true);
  assert.equal(r.realisation[2].partAvant, undefined);
  assert.deepEqual(codes(r.avertissements), ['realisation[2].partAvant : une seule étape, ignoré']);
});

// ——— Ingrédients cités ———

test('ingrédients : nom de la fiche retenu (pluriel et casse tolérés) ; absent retiré avec la phrase exacte', () => {
  const r = valider([
    { ...REALISATION[0], ingredients: ['Pâtes Courtes'] },
    { ...REALISATION[1], ingredients: ['crèmes fraîches épaisses', 'jambons blancs', 'lardons'] },
    REALISATION[2],
  ]);
  assert.deepEqual(r.realisation[0].ingredients, ['pâtes courtes']);
  assert.deepEqual(r.realisation[1].ingredients, ['crème fraîche épaisse', 'jambon blanc']);
  assert.deepEqual(messages(r.avertissements), [
    '«\u00A0Gratin test\u00A0»\u00A0: «\u00A0lardons\u00A0» n’est pas dans ses ingrédients\u00A0: sa quantité ne s’affichera pas à l’étape 2.',
  ]);
  assert.deepEqual(codes(r.avertissements), ['realisation[1].ingredients « lardons » : absent des ingredients, retiré']);
});

test('ingrédients : cité par aucune étape, cité deux fois sans part, parts de plus de 1, produit deux fois dans la fiche', () => {
  const fiche = { ...GRATIN, ingredients: [PATES, JAMBON, CREME, BEURRE, ing('beurre', 10, 'g', ['laitier'])] };
  const r = valider([
    { ...REALISATION[0], ingredients: ['pâtes courtes', { produit: 'beurre', part: 0.7 }] },
    { ...REALISATION[1], ingredients: ['crème fraîche épaisse', { produit: 'beurre', part: 0.5 }] },
    REALISATION[2],
  ], fiche);
  assert.deepEqual(codes(r.avertissements), [
    'realisation : ingrédient « jambon blanc » cité par aucune étape',
    'ingredients : « beurre » deux fois, quantités additionnées',
    'realisation : parts de « beurre » : somme supérieure à 1',
  ]);
  const deuxFois = valider([
    { ...REALISATION[0], ingredients: ['pâtes courtes', 'jambon blanc'] },
    REALISATION[1],
    REALISATION[2],
  ]);
  assert.deepEqual(codes(deuxFois.avertissements), ['realisation : « jambon blanc » cité aux étapes 1, 2 sans part']);
  assert.equal(deuxFois.avertissements[0].raison, '«\u00A0jambon blanc\u00A0» est cité aux étapes 1 et 2 sans dire quelle part\u00A0: sa quantité s’affichera à chacune');
  // Part illisible : ignorée (l'ingrédient compte en entier).
  const part = valider([{ ...REALISATION[0], ingredients: [{ produit: 'pâtes courtes', part: 2 }] }, REALISATION[1], REALISATION[2]]);
  assert.deepEqual(part.realisation[0].ingredients, ['pâtes courtes']);
  assert.deepEqual(codes(part.avertissements), ['realisation[0].ingredients[0].part : nombre de 0 (exclu) à 1, ignoré']);
});

test('cuisson : appareil absent de la cuisson et durée qui s’écarte de plus de moitié : avertissements', () => {
  const r = valider([
    ...REALISATION.slice(0, 2),
    { ...REALISATION[2], duree: 45 },
    etape('Dorer', { appareil: 'airfryer', tempC: 200 }),
  ]);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(codes(r.avertissements), [
    'realisation : four : étape la plus longue 45 min, cuisson 20 min',
    'realisation[3].appareil airfryer : absent de cuisson',
  ]);
});

// ——— Titres, à jour, état ———

test('titresDe et realisationAJour : à jour quand `etapes` = les titres et la réalisation est lisible', () => {
  assert.deepEqual(titresDe(REALISATION), ['Cuire les pâtes', 'Faire la sauce', 'Gratiner']);
  assert.deepEqual(titresDe(null), []);
  const plat = detaille(GRATIN);
  assert.equal(realisationAJour(plat), true);
  assert.equal(etatRealisation(plat), 'detaillee');
  // Étapes changées par une app d'avant : plus à jour.
  assert.equal(realisationAJour({ ...plat, etapes: ['Cuire.', 'Gratiner.'] }), false);
  assert.equal(etatRealisation({ ...plat, etapes: ['Cuire.'] }), 'perimee');
  // Abîmée : plus à jour ; absente : courte ; ⏳ : sans recette.
  assert.equal(realisationAJour({ ...plat, realisation: [{ titre: 'Cuire les pâtes' }] }), false);
  assert.equal(etatRealisation(GRATIN), 'courte');
  assert.equal(etatRealisation({ id: 'x', nom: 'X' }), 'sansRecette');
  // Un écart de cuisson (« Modifier » a changé l'appareil) ne rend pas la réalisation abîmée.
  assert.equal(realisationAJour({ ...plat, cuisson: [{ appareil: 'cookeo', dureeMin: 20 }] }), true);
});

// ——— Lecture ———

test('etapesLisibles : défauts appliqués (travail, ordre, veille), quantités de la recette', () => {
  const longue = etape('Mariner', { duree: 300, actif: 10 });
  const plat = detaille(GRATIN, [...REALISATION, longue]);
  const { etapes, detaillee, perimee } = etapesLisibles(plat);
  assert.equal(detaillee, true);
  assert.equal(perimee, false);
  assert.deepEqual(etapes.map((e) => [e.n, e.actif, e.apres, e.veille, e.partAvant]), [
    [1, 1, [], false, false], [2, 5, [1], false, true], [3, 1, [1, 2], false, false], [4, 10, [3], true, false],
  ]);
  assert.deepEqual(etapes[1].ingredients.map((i) => i.texte), ['Crème fraîche épaisse · 20\u00A0cl', 'Jambon blanc · 4\u00A0tranches']);
  assert.equal(etapes[2].pret, 'Le dessus est doré.');
  assert.equal(etapes[0].estime, false);
  assert.equal(etapes[0].appareil, 'plaque');
  assert.equal(etapes[3].appareil, null);
});

test('etapesLisibles : repli sur les étapes courtes, puis une étape par cuisson (durée estimée) ; réalisation périmée signalée', () => {
  const { etapes, detaillee, perimee } = etapesLisibles(GRATIN);
  assert.equal(detaillee, false);
  assert.equal(perimee, false);
  assert.deepEqual(etapes.map((e) => [e.n, e.titre, e.duree, e.actif, e.estime, e.apres]), [
    [1, 'Cuire.', null, null, false, []],
    [2, 'Gratiner.', null, null, false, [1]],
    [3, 'Plaque · 12\u00A0min', 12, 2, true, [2]],
    [4, 'Four · 200\u00A0°C · 20\u00A0min', 20, 2, true, [3]],
  ]);
  assert.equal(etapesLisibles({ ...detaille(GRATIN), etapes: ['Cuire.'] }).perimee, true);
  assert.deepEqual(etapesLisibles(null).etapes, []);
});

test('travailRecette : somme des travaux hors jour du repas et veille ; sinon tempsActifMin ; sinon null', () => {
  const plat = detaille(GRATIN, [...REALISATION, etape('Réchauffer', { auService: true }), etape('Tremper', { duree: 600, actif: 5, veille: true })]);
  assert.equal(travailRecette(plat), 7);
  assert.equal(travailRecette(GRATIN), 15);
  assert.equal(travailRecette({ ...GRATIN, tempsActifMin: undefined }), null);
});

test('texteDuree : minutes, heures et minutes sur deux chiffres, heures rondes', () => {
  assert.equal(texteDuree(45), '45\u00A0min');
  assert.equal(texteDuree(65), '1\u00A0h\u00A005');
  assert.equal(texteDuree(120), '2\u00A0h');
  assert.equal(texteDuree(150), '2\u00A0h\u00A030');
  assert.equal(texteDuree(0), '0\u00A0min');
  assert.equal(texteDuree(1440), '24\u00A0h');
  assert.equal(texteDuree(-1), '');
  assert.equal(texteDuree('x'), '');
});

// ——— Plats à détailler ———

test('platsADetailler : plats actifs qui ont leurs ingrédients, pas à jour ; semaine en cours d’abord, puis type, puis nom', () => {
  const plat = (id, nom, extra = {}) => ({ ...GRATIN, id, nom, ...extra });
  const plats = [
    plat('tarte', 'Tarte', { type: 'dessert' }),
    plat('zeste', 'Zeste'),
    plat('apero', 'Apéro', { type: 'apero' }),
    plat('ble', 'Blé'),
    plat('detaille', 'Détaillé', { realisation: REALISATION, etapes: titresDe(REALISATION) }),
    plat('perime', 'Périmé', { realisation: REALISATION, etapes: ['Autre.'] }),
    plat('jete', 'Jeté', { corbeille: { le: 1, par: 'a@exemple.fr' } }),
    { id: 'attente', nom: 'En attente' },
    plat('vide', 'Vide', { ingredients: [] }),
    plat('semaine-b', 'Semaine B'),
    plat('semaine-a', 'Semaine A'),
    plat('passe', 'Passé'),
  ];
  const semaines = [
    { id: '2026-10-20', debut: '2026-10-20', fin: '2026-10-26', plats: { 'semaine-a': { ajouteLe: 5 } } },
    { id: '2026-10-13', debut: '2026-10-13', fin: '2026-10-19', plats: { 'semaine-b': { ajouteLe: 2 }, zeste: { ajouteLe: 1 }, tarte: { ajouteLe: 3, retire: true }, ble: {} } },
    { id: '2026-10-01', debut: '2026-10-01', fin: '2026-10-07', plats: { passe: { ajouteLe: 1 } } },
  ];
  const ids = platsADetailler(plats, { semaines, aujourdhui: '2026-10-13' }).map((p) => p.id);
  assert.deepEqual(ids, ['zeste', 'semaine-b', 'semaine-a', 'ble', 'passe', 'perime', 'tarte', 'apero']);
  assert.equal(platsDeLaSemaineADetailler(plats, { semaines, aujourdhui: new Date(2026, 9, 13) }), 3);
  assert.deepEqual(platsADetailler(plats).map((p) => p.id).slice(0, 3), ['ble', 'passe', 'perime']);
});

// ——— Empreinte des étapes ———

test('empreinteEtapes : stable (quantité, nom, ordre des clés) ; change avec portions, produit, repère, étape, cuisson', () => {
  const base = empreinteEtapes(GRATIN);
  assert.match(base, /^[0-9a-z]{6}$/);
  assert.equal(empreinteEtapes({ ...GRATIN, nom: 'Autre nom' }), base);
  assert.equal(empreinteEtapes({ ...GRATIN, ingredients: [{ ...PATES, qte: 500 }, JAMBON, CREME] }), base);
  for (const [quoi, autre] of [
    ['portions', { ...GRATIN, portionsBase: 6 }],
    ['produit', { ...GRATIN, ingredients: [PATES, JAMBON, { ...CREME, produit: 'crème liquide' }] }],
    ['repère', { ...GRATIN, ingredients: [PATES, JAMBON, { ...CREME, marqueurs: ['laitier', 'lait_cru'] }] }],
    ['étape', { ...GRATIN, etapes: ['Cuire.', 'Gratiner longtemps.'] }],
    ['cuisson', { ...GRATIN, cuisson: [CUISSON[0], { ...CUISSON[1], tempC: 180 }] }],
    ['mode', { ...GRATIN, cuisson: [CUISSON[0], { ...CUISSON[1], mode: 'grill' }] }],
    ['réalisation', detaille(GRATIN)],
  ]) assert.notEqual(empreinteEtapes(autre), base, quoi);
  // Réalisation : clés dans un autre ordre (Firestore), même empreinte ; texte d'une étape changé, autre empreinte.
  const plat = detaille(GRATIN);
  const melange = { ...plat, realisation: plat.realisation.map((e) => Object.fromEntries(Object.entries(e).reverse())) };
  assert.equal(empreinteEtapes(melange), empreinteEtapes(plat));
  const change = detaille(GRATIN, [REALISATION[0], { ...REALISATION[1], texte: 'Autrement.' }, REALISATION[2]]);
  assert.notEqual(empreinteEtapes(change), empreinteEtapes(plat));
});

// ——— Parts à mettre de côté ———

test('partsAMettreDeCote : une ligne par version distincte, sans profil, sans style, sans identifiant', () => {
  const plat = {
    ...GRATIN,
    variantes: [
      { pour: 'profil-b', style: 'mer', retirer: ['jambon blanc'], ajouter: [{ produit: 'thon au naturel', qtePortion: 50 }], frigoJours: 2 },
      { pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'], ajouter: [{ produit: 'tofu fumé', qtePortion: 60 }, { produit: 'champignon de paris' }] },
      { pour: 'enfant', retirer: ['jambon blanc'], ajouter: [{ produit: 'thon au naturel', qtePortion: 25 }] },
      { pour: 'profil-c', retirer: ['jambon blanc'] },
      { pour: 'profil-d', ajouter: [{ produit: 'œuf' }] },
      { pour: 'profil-e' },
      null,
    ],
  };
  const parts = partsAMettreDeCote(plat);
  assert.deepEqual(parts, [
    'sans jambon blanc (avec thon au naturel)',
    'sans jambon blanc (avec tofu fumé, champignon de paris)',
    'sans jambon blanc',
    'avec œuf',
  ]);
  for (const mot of ['profil', 'enfant', 'mer', 'vegetal', 'végétale']) assert.ok(parts.every((p) => !p.includes(mot)), mot);
  assert.deepEqual(partsAMettreDeCote(GRATIN), []);
});

// ——— Édition réduite ———

test('changerEtape : seuls les champs donnés ; travail ramené à la durée ; liste reçue intacte', () => {
  const avant = structuredClone(REALISATION);
  const apres = changerEtape(REALISATION, 1, { titre: '  Cuire  les pâtes  ', duree: 8 });
  assert.equal(apres[0].titre, 'Cuire les pâtes');
  assert.equal(apres[0].duree, 8);
  assert.equal(apres[0].actif, 1);
  assert.equal(apres[0].texte, REALISATION[0].texte);
  assert.equal(changerEtape(REALISATION, 3, { duree: 0.5 })[2].duree, 0.5);
  assert.equal(changerEtape(REALISATION, 2, { actif: 9 })[1].actif, 5);
  assert.equal(changerEtape(REALISATION, 1, { actif: null })[0].actif, undefined);
  assert.deepEqual(changerEtape(REALISATION, 9, { titre: 'X' }), REALISATION);
  assert.deepEqual(REALISATION, avant);
});

test('retirerEtapeRealisation : celles qui l’attendaient héritent de ce qu’elle attendait ; numéros renumérotés', () => {
  const liste = [
    etape('A', { apres: [] }), etape('B', { apres: [] }), etape('C', { apres: [1, 2] }), etape('D'), etape('E', { apres: [3] }),
  ];
  // Retirer C (attendait 1 et 2) : D (qui le suivait) attend 1 et 2 ; E (après 3) attend 1 et 2.
  const sansC = retirerEtapeRealisation(liste, 3);
  assert.deepEqual(sansC.map((e) => [e.titre, e.apres]), [['A', []], ['B', []], ['D', [1, 2]], ['E', [1, 2]]]);
  // Retirer A : B gardait [] ; C attend 1 (ancien B) ; D suit C sans `apres` écrit.
  const sansA = retirerEtapeRealisation(liste, 1);
  assert.deepEqual(sansA.map((e) => [e.titre, e.apres]), [['B', []], ['C', [1]], ['D', undefined], ['E', [2]]]);
  // Retirer une étape au milieu d'une chaîne implicite : la suivante suit la précédente, sans `apres` écrit.
  const chaine = [etape('A'), etape('B'), etape('C')];
  assert.deepEqual(retirerEtapeRealisation(chaine, 2).map((e) => [e.titre, e.apres]), [['A', undefined], ['C', undefined]]);
  assert.deepEqual(retirerEtapeRealisation(chaine, 7), chaine);
});

test('retirerEtapeRealisation : la marque `partAvant` passe à l’étape qui prend sa place', () => {
  const apres = retirerEtapeRealisation(REALISATION, 2);
  assert.deepEqual(apres.map((e) => [e.titre, Boolean(e.partAvant), e.apres]), [['Cuire les pâtes', false, []], ['Gratiner', true, [1]]]);
});

test('ajouterEtapeALaFin : à la fin, elle suit la précédente ; 5 min par défaut', () => {
  const apres = ajouterEtapeALaFin(REALISATION, { titre: ' Servir ', texte: 'Servez chaud.' });
  assert.equal(apres.length, 4);
  assert.deepEqual(apres[3], { titre: 'Servir', texte: 'Servez chaud.', duree: 5 });
  assert.equal(ajouterEtapeALaFin([], { titre: 'A', texte: 'B', duree: 12 })[0].duree, 12);
  assert.equal(REALISATION.length, 3);
});

test('suivreCuissonPrincipale : la plus longue étape de l’ancien appareil prend le nouveau (température, durée)', () => {
  const avecMode = [REALISATION[0], REALISATION[1], { ...REALISATION[2], mode: 'grill', feu: 'vif' }];
  const { realisation, suivie } = suivreCuissonPrincipale(avecMode, { ancien: 'four', nouveau: 'airfryer', tempC: 180, dureeMin: 15 });
  assert.equal(suivie, 3);
  assert.deepEqual(realisation[2], { ...REALISATION[2], appareil: 'airfryer', tempC: 180, duree: 15, actif: 1 });
  // Vers la plaque : plus de température.
  const plaque = suivreCuissonPrincipale(REALISATION, { ancien: 'four', nouveau: 'plaque', dureeMin: 18 }).realisation[2];
  assert.equal(plaque.tempC, undefined);
  assert.equal(plaque.duree, 18);
  // Plaque : la plus longue des étapes sur la plaque (10 min).
  assert.equal(suivreCuissonPrincipale(REALISATION, { ancien: 'plaque', nouveau: 'cookeo', dureeMin: 6 }).suivie, 1);
  // Rien à suivre.
  assert.equal(suivreCuissonPrincipale(REALISATION, { ancien: 'cookeo', nouveau: 'four' }).suivie, null);
  assert.equal(suivreCuissonPrincipale(REALISATION, { ancien: 'four', nouveau: null }).suivie, null);
});

test('invariants de l’édition : chaque édition rend une réalisation valide, `apres` vers des étapes plus petites', () => {
  let liste = structuredClone(REALISATION);
  const cuissonApres = [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'airfryer', tempC: 180, dureeMin: 15 }];
  const etapes = [
    (l) => changerEtape(l, 2, { texte: 'Autre texte.', duree: 7, actif: 3 }),
    (l) => ajouterEtapeALaFin(l, { titre: 'Servir', texte: 'Servez.' }),
    (l) => retirerEtapeRealisation(l, 1),
    (l) => suivreCuissonPrincipale(l, { ancien: 'four', nouveau: 'airfryer', tempC: 180, dureeMin: 15 }).realisation,
  ];
  for (const editer of etapes) {
    liste = editer(liste);
    const r = validerRealisation(liste, { produits: GRATIN.ingredients });
    assert.deepEqual(r.erreurs, []);
    liste.forEach((e, i) => (e.apres ?? []).forEach((k) => assert.ok(k >= 1 && k < i + 1)));
  }
  assert.deepEqual(validerRealisation(liste, { produits: GRATIN.ingredients, cuisson: cuissonApres }).erreurs, []);
});

// ——— Textes ———

test('ligneDuree et ligneAppareil', () => {
  assert.equal(ligneDuree({ duree: 10, actif: 1 }), '⏱ 10\u00A0min · dont 1\u00A0min de travail');
  assert.equal(ligneDuree({ duree: 5, actif: 5 }), '⏱ 5\u00A0min');
  assert.equal(ligneDuree({ duree: 150, actif: 2 }), '⏱ 2\u00A0h\u00A030 · dont 2\u00A0min de travail');
  assert.equal(ligneDuree({ duree: null }), '');
  assert.equal(ligneAppareil({ appareil: 'plaque', feu: 'vif' }), 'Plaque · feu vif');
  assert.equal(ligneAppareil({ appareil: 'four', tempC: 180 }), 'Four · 180\u00A0°C');
  assert.equal(ligneAppareil({ appareil: 'cookeo', mode: 'sous pression' }), 'Cookeo · sous pression');
  assert.equal(ligneAppareil({ appareil: null }), '');
});

test('carteEtapesDetaillees : phrases, bouton, plats de la semaine, instructions pas à jour, hors ligne', () => {
  const plats = [detaille(GRATIN), { ...GRATIN, id: 'a', nom: 'A' }, { ...GRATIN, id: 'b', nom: 'B' }, { id: 'c', nom: 'C' }];
  const semaines = [{ debut: '2026-10-13', fin: '2026-10-19', plats: { a: { ajouteLe: 1 } } }];
  const carte = carteEtapesDetaillees({ plats, semaines, aujourdhui: '2026-10-13' });
  assert.equal(carte.visible, true);
  assert.deepEqual(carte.phrases, [
    '2\u00A0recettes ont des étapes courtes. Claude peut les détailler pour cuisiner avec le téléphone et organiser le batch.',
    '1\u00A0sur 3 est déjà détaillée.',
  ]);
  assert.equal(carte.bouton, '📋 Demander à Claude les 2\u00A0recettes');
  assert.equal(carte.copieActive, true);
  assert.equal(carte.phraseSemaine, 'Les plats de la semaine passent en premier\u00A0: la première réponse suffit pour cette semaine.');
  assert.equal(carte.annonce, 'Demande copiée. Collez-la dans une nouvelle conversation de votre projet Claude. Il répondra 4\u00A0recettes à la fois\u00A0: collez chaque réponse ici, puis écrivez «\u00A0suite\u00A0».');
  assert.equal(carte.horsLigne, null);
  const neuf = Array.from({ length: 9 }, (_, i) => ({ ...GRATIN, id: `p${i}`, nom: `P${i}` }));
  const deSemaine = { debut: '2026-10-13', fin: '2026-10-19', plats: Object.fromEntries(neuf.map((p, i) => [p.id, { ajouteLe: i }])) };
  assert.equal(carteEtapesDetaillees({ plats: neuf, semaines: [deSemaine], aujourdhui: '2026-10-13' }).phraseSemaine,
    'Les plats de la semaine passent en premier\u00A0: les trois premières réponses suffisent pour cette semaine.');
  const une = carteEtapesDetaillees({ plats: [{ ...GRATIN }], instructionsAJour: false, enLigne: false });
  assert.equal(une.bouton, '📋 Demander à Claude la dernière recette');
  assert.equal(une.phrases[0], '1\u00A0recette a des étapes courtes. Claude peut la détailler pour cuisiner avec le téléphone et organiser le batch.');
  assert.equal(une.phrases.at(-1), 'Copiez d’abord les nouvelles instructions ci-dessus.');
  assert.equal(une.copieActive, false);
  assert.equal(une.horsLigne, 'Il faut du réseau pour enregistrer des étapes.');
  assert.equal(une.phraseSemaine, null);
  assert.equal(carteEtapesDetaillees({ plats: [detaille(GRATIN)] }).visible, false);
});

test('lignesApercuEtapes et enteteApercuEtapes : phrases exactes de l’aperçu', () => {
  const base = { id: 'gratin', nom: 'Gratin de pâtes au jambon' };
  assert.deepEqual(lignesApercuEtapes({ ...base, statut: 'etapes', etapes: 9, travail: 21 }), {
    titre: '«\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: 9\u00A0étapes, dont 21\u00A0min de travail.', etat: [], avertissements: [],
  });
  assert.deepEqual(lignesApercuEtapes({ ...base, statut: 'etapes', etapes: 3, travail: 5, remplace: true, reperesARevoir: true }).etat, [
    'Remplace les étapes détaillées actuelles.',
    '🧸 Claude signale que ces étapes changent un repère de «\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: la recette sera à relire.',
  ]);
  const octobre = Date.UTC(2026, 9, 9, 10) / 1000;
  assert.deepEqual(lignesApercuEtapes({ ...base, statut: 'etapes', etapes: 1, travail: null, modifieeA: octobre, remplace: true }).etat, [
    'Cette recette a été modifiée à la main le 9 octobre\u00A0: ses étapes seront remplacées, le reste ne change pas.',
  ]);
  const etat = (statut, extra = {}) => lignesApercuEtapes({ ...base, statut, ...extra }).etat[0];
  assert.equal(etat('identique'), '«\u00A0Gratin de pâtes au jambon\u00A0» a déjà ces étapes\u00A0: rien à enregistrer.');
  assert.equal(etat('dejaDetaille'), '«\u00A0Gratin de pâtes au jambon\u00A0» est déjà détaillé\u00A0: rien à enregistrer.');
  assert.equal(etat('change'), '«\u00A0Gratin de pâtes au jambon\u00A0» a changé depuis la demande\u00A0: ses étapes ne sont pas reprises. Il restera à détailler.');
  assert.equal(etat('refusee', { raison: 'Phrase de refus.' }), 'Phrase de refus.');
  assert.equal(etat('inconnu'), '«\u00A0Gratin de pâtes au jambon\u00A0» n’est pas dans vos plats\u00A0: ses étapes ne sont pas reprises.');
  assert.equal(etat('attente'), '«\u00A0Gratin de pâtes au jambon\u00A0» n’a pas encore sa recette\u00A0: ses étapes ne sont pas reprises.');
  assert.equal(etat('corbeille'), '«\u00A0Gratin de pâtes au jambon\u00A0» est dans la corbeille\u00A0: ses étapes ne sont pas reprises.');
  assert.deepEqual(enteteApercuEtapes({ ecritures: [{ mode: 'etapes' }, { mode: 'etapes' }, { mode: 'etapes' }] }), {
    entete: '3\u00A0recettes reçoivent leurs étapes détaillées. Le reste des recettes ne change pas.',
    bouton: 'Enregistrer les étapes de 3\u00A0recettes',
    actif: true,
  });
  assert.equal(enteteApercuEtapes({ ecritures: [{ mode: 'etapes' }] }).entete,
    '1\u00A0recette reçoit ses étapes détaillées. Le reste des recettes ne change pas.');
  assert.deepEqual(enteteApercuEtapes({ ecritures: [] }), { entete: null, bouton: 'Rien à enregistrer', actif: false });
  assert.equal(enteteApercuEtapes({ ecritures: [{ mode: 'etapes' }], refus: 'instructions' }).actif, false);
});

test('TEXTES_ETAPES : textes de la fiche et de « Modifier »', () => {
  assert.equal(TEXTES_ETAPES.ficheCourte, 'Ces étapes sont courtes. Claude peut les détailler pour cuisiner avec le téléphone.');
  assert.equal(TEXTES_ETAPES.demanderSesEtapes, '📋 Demander ses étapes détaillées');
  assert.equal(TEXTES_ETAPES.perimee, 'Les étapes ont été changées sur un autre appareil\u00A0: demandez de nouveau leur détail à Claude.');
  assert.equal(TEXTES_ETAPES.pretQuand('Le dessus est doré.'), '✓ Prêt quand\u00A0: Le dessus est doré.');
  assert.equal(TEXTES_ETAPES.aideTravail, 'Le reste du temps, on peut faire autre chose\u00A0: l’app s’en sert pour le batch.');
  assert.equal(TEXTES_ETAPES.ordre, 'Pour changer l’ordre des étapes, demandez de nouveau leur détail à Claude.');
  assert.equal(TEXTES_ETAPES.relireEtape('Gratiner au four'), 'Relisez l’étape «\u00A0Gratiner au four\u00A0»\u00A0: son texte parle peut-être encore de l’ancien appareil.');
  assert.equal(TEXTES_ETAPES.mesuresPour(4), 'Les mesures «\u00A0Et aussi\u00A0» des étapes (sel, eau) étaient pour 4\u00A0portions.');
  assert.equal(TEXTES_ETAPES.plusDansLaRecette('lardons', 3), '«\u00A0lardons\u00A0» n’est plus dans la recette\u00A0: sa quantité ne s’affichera plus à l’étape 3.');
  assert.equal(TEXTES_ETAPES.refusEnvoi('Gratin'), '«\u00A0Gratin\u00A0» a changé entre-temps\u00A0: ses étapes n’ont pas été écrites. Il restera à détailler.');
  assert.equal(TEXTES_ETAPES.titreManquant, 'Écrivez ce qu’on fait à cette étape.');
});
