// Étapes détaillées dans l'ajout de recettes, la demande à Claude, la série, « Modifier » et la sauvegarde (T5-0b) :
// fiches complètes en version 7, lots d'étapes (réponse à DEMANDE-ETAPES), statuts, écritures en liste fermée,
// DEMANDE-ETAPES, correction, « Coller la suite », éditeur réduit, restauration. Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHAMPS_ECRITS_PAR_ETAPES, FORMAT, VERSION_REALISATION, champsEcritureEtapes, controlerInstructions, ecrituresEtapes,
  entreesPourImport, filtrerPreparation, preparerImport, recetteValidee, validerPaquet, verifierEcritureEtapes,
} from '../js/coeur/paquet.js';
import {
  ETAPES_PAR_MESSAGE, FORMULE_CORRECTION_ETAPES, IDEES_PAR_MESSAGE, SOURCE_IDEE, VERSION_INSTRUCTIONS,
  texteCorrectionPourClaude, texteDemandeEtapes,
} from '../js/coeur/claude.js';
import { empreinteEtapes, titresDe } from '../js/coeur/realisation.js';
import { bilanDuMessage, dejaEnregistre, etatSerie, natureDuMessage, texteSerie } from '../js/coeur/serie.js';
import {
  brouillonValide, changerCuissonEtEtapes, normaliserPourEdition, preparerModification,
} from '../js/coeur/edition.js';
import { creerSauvegarde, lireSauvegarde, preparerRestauration, validerSauvegarde } from '../js/coeur/sauvegarde.js';
import { appliquerImport } from '../js/coeur/import-local.js';
import { ecrireRegime } from '../js/coeur/regles.js';
import { GATEAU, GRATIN, REALISATION_GATEAU, REALISATION_GRATIN } from './donnees/exemples-etapes.js';

// ——— Fixtures ———

const PROFILS = [
  { id: 'profil-a', nom: 'Adulte A', ordre: 0, coefPortion: 1, email: 'a@exemple.fr', regles: [] },
  { id: 'profil-b', nom: 'Adulte B', ordre: 1, coefPortion: 1, email: 'b@exemple.fr', regles: ecrireRegime({ regime: 'sans_viande' }) },
  { id: 'enfant', nom: 'Enfant', ordre: 2, coefPortion: 0.5, naissance: '2024-03-01', regles: [] },
];
const reponse = (plats, instructions = VERSION_INSTRUCTIONS) => ({ format: FORMAT, instructions, plats });
const entree = (plat, realisation, extra = {}) => ({ id: plat.id, nom: plat.nom, empreinte: empreinteEtapes(plat), realisation: structuredClone(realisation), ...extra });
const detaille = (plat, realisation) => ({ ...structuredClone(plat), realisation: structuredClone(realisation), etapes: titresDe(realisation) });
const ficheV7 = (plat, realisation) => ({ ...structuredClone(plat), realisation: structuredClone(realisation) });
/** Lot d'étapes validé puis préparé contre les plats. */
function preparerLot(paquet, plats, options = {}) {
  const validation = validerPaquet(paquet, { profils: PROFILS });
  return { validation, prep: preparerImport(entreesPourImport(validation), { plats, profils: PROFILS, ...options }) };
}
const statuts = (prep) => prep.elements.map((e) => [e.id, e.statut]);

// ——— Fiches complètes ———

test('version 7 : une fiche complète porte sa réalisation ; `etapes` = ses titres (la liste reçue est ignorée)', () => {
  // Versions 8 (critère des légumes dans les idées) et 9 (Claude relit sa fiche avant de l’envoyer) : la réalisation
  // reste exigée depuis la version 7.
  assert.equal(VERSION_INSTRUCTIONS, 9);
  assert.equal(VERSION_REALISATION, 7);
  const v = validerPaquet(reponse([{ ...ficheV7(GRATIN, REALISATION_GRATIN), etapes: ['Autre chose.'] }]), { profils: PROFILS });
  assert.equal(v.valide, true, JSON.stringify(v.plats[0].erreurs));
  assert.deepEqual(v.plats[0].avertissements, []);
  assert.deepEqual(v.plats[0].donnees.etapes, titresDe(REALISATION_GRATIN));
  assert.equal(v.plats[0].donnees.realisation.length, REALISATION_GRATIN.length);
});

test('version 7 : une fiche complète sans réalisation est une erreur ; jamais pour un ⏳, des versions seules, une réponse d’avant', () => {
  const sans = validerPaquet(reponse([structuredClone(GRATIN)]), { profils: PROFILS });
  assert.equal(sans.valide, false);
  assert.deepEqual(sans.plats[0].erreurs.map((e) => e.pourClaude), ['plats[0] (gratin-pates-jambon) realisation attendue']);
  assert.equal(sans.plats[0].erreurs[0].message, '«\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: les étapes détaillées manquent.');
  assert.equal(validerPaquet(reponse([structuredClone(GRATIN)], 6), { profils: PROFILS }).valide, true);
  assert.equal(validerPaquet({ format: FORMAT, plats: [structuredClone(GRATIN)] }, { profils: PROFILS }).valide, true);
  assert.equal(validerPaquet(reponse([{ id: 'soupe', nom: 'Soupe' }]), { profils: PROFILS }).valide, true);
  const versions = { id: GRATIN.id, nom: GRATIN.nom, variantes: [{ pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'], ajouter: [{ produit: 'tofu fumé', qtePortion: 60, unite: 'g', rayon: 'cremerie', marqueurs: ['soja'] }] }] };
  assert.equal(validerPaquet(reponse([versions]), { profils: PROFILS }).valide, true);
});

test('fiche complète : un écart de manière de cuire refuse l’ajout ; en base, ce n’est qu’un avertissement', () => {
  const sansFour = REALISATION_GRATIN.map((e) => ({ ...e, appareil: e.appareil === 'four' ? undefined : e.appareil, tempC: undefined }));
  const v = validerPaquet(reponse([ficheV7(GRATIN, sansFour)]), { profils: PROFILS });
  assert.equal(v.valide, false);
  assert.ok(v.plats[0].erreurs.some((e) => e.pourClaude === 'plats[0] (gratin-pates-jambon) realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape'));
  const enBase = recetteValidee(detaille(GRATIN, sansFour));
  assert.ok(enBase.realisation);
  // Réalisation abîmée en base : retirée de la lecture, la recette reste valide.
  const abimee = recetteValidee({ ...detaille(GRATIN, REALISATION_GRATIN), realisation: [{ titre: 'Sans texte' }] });
  assert.equal(abimee.realisation, undefined);
  assert.deepEqual(abimee.ingredients, GRATIN.ingredients);
  // Fiche en base dont les étapes ont été changées par une app d'avant : la différence reste visible.
  const perimee = recetteValidee({ ...detaille(GRATIN, REALISATION_GRATIN), etapes: ['Une autre façon de faire.'] });
  assert.deepEqual(perimee.etapes, ['Une autre façon de faire.']);
});

test('fiche v6 inchangée : sans réalisation, la recette se lit et se compare comme avant', () => {
  const lue = recetteValidee(GRATIN);
  assert.equal(lue.realisation, undefined);
  assert.deepEqual(lue.etapes, GRATIN.etapes);
  const prep = preparerImport(validerPaquet(reponse([structuredClone(GRATIN)], 6)).plats.map((p) => p.donnees), { plats: [GRATIN], profils: PROFILS });
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'identique']]);
});

test('même recette : fiche détaillée à jour face à une réponse sans réalisation → identique ; même réalisation → identique', () => {
  const fiche = detaille(GRATIN, REALISATION_GRATIN);
  const ancienne = validerPaquet(reponse([structuredClone(GRATIN)], 6)).plats.map((p) => p.donnees);
  assert.deepEqual(statuts(preparerImport(ancienne, { plats: [fiche], profils: PROFILS })), [[GRATIN.id, 'identique']]);
  const memes = validerPaquet(reponse([ficheV7(GRATIN, REALISATION_GRATIN)])).plats.map((p) => p.donnees);
  const prep = preparerImport(memes, { plats: [fiche], profils: PROFILS });
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'identique']]);
  assert.deepEqual(prep.ecritures, []);
  // Autre réalisation : la recette est remplacée (réalisation et titres écrits).
  const autre = REALISATION_GRATIN.map((e, i) => (i === 0 ? { ...e, texte: 'Autrement.' } : e));
  const remplace = preparerImport(validerPaquet(reponse([ficheV7(GRATIN, autre)])).plats.map((p) => p.donnees), { plats: [fiche], profils: PROFILS });
  assert.deepEqual(statuts(remplace), [[GRATIN.id, 'remplace']]);
  assert.equal(remplace.ecritures[0].donnees.realisation[0].texte, 'Autrement.');
  assert.equal(remplace.ecritures[0].supprimer, undefined);
});

test('réponse d’avant sans réalisation qui remplace une fiche détaillée : la réalisation est effacée, l’aperçu le dit', () => {
  const fiche = detaille(GRATIN, REALISATION_GRATIN);
  const autreRecette = { ...structuredClone(GRATIN), ingredients: GRATIN.ingredients.map((i) => (i.produit === 'gruyère râpé' ? { ...i, qte: 150 } : i)) };
  const prep = preparerImport(validerPaquet(reponse([autreRecette], 6)).plats.map((p) => p.donnees), { plats: [fiche], profils: PROFILS, choix: { [GRATIN.id]: 'remplacer' } });
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'remplace']]);
  assert.deepEqual(prep.ecritures[0].supprimer, ['realisation']);
  assert.ok(prep.elements[0].avertissements.includes('Les étapes détaillées actuelles seront remplacées par des étapes courtes.'));
});

// ——— Lots d'étapes : détection et dérives ———

test('détection (ordre testé) : precautions → relecture ; empreinte et réalisation → étapes ; réalisation sans ingrédients → étapes ; empreinte seule → relecture', () => {
  const etapes = entree(GRATIN, REALISATION_GRATIN);
  assert.equal(validerPaquet(reponse([{ ...etapes, precautions: [] }])).relecture, true);
  assert.equal(validerPaquet(reponse([etapes])).lotDEtapes, true);
  const sansEmpreinte = { id: GRATIN.id, nom: GRATIN.nom, realisation: REALISATION_GRATIN };
  const lot = validerPaquet(reponse([sansEmpreinte]));
  assert.equal(lot.lotDEtapes, true);
  assert.deepEqual(lot.plats[0].erreurs.map((e) => e.pourClaude), ['plats[0] (gratin-pates-jambon) empreinte manquante, recopie celle de la demande']);
  assert.equal(validerPaquet(reponse([{ id: GRATIN.id, empreinte: 'abcdef', precautions: [] }])).relecture, true);
  assert.equal(validerPaquet(reponse([ficheV7(GRATIN, REALISATION_GRATIN)])).lotDEtapes, undefined);
});

test('dérive 1 : une recette entière avec empreinte dans un lot d’étapes est refusée, les autres passent', () => {
  const entiere = { ...ficheV7(GRATIN, REALISATION_GRATIN), empreinte: empreinteEtapes(GRATIN) };
  const { validation, prep } = preparerLot(reponse([entiere, entree(GATEAU, REALISATION_GATEAU)]), [GRATIN, GATEAU]);
  assert.equal(validation.valide, true);
  assert.equal(validation.plats[0].erreurs[0].refus, 'Claude a rendu la recette entière de «\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: seules ses étapes étaient demandées.');
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'refusee'], [GATEAU.id, 'etapes']]);
  assert.deepEqual(prep.ecritures.map((e) => e.id), [GATEAU.id]);
});

test('dérive 2 : en série d’étapes, une fiche complète sans empreinte pour un plat qui a sa recette est refusée ; idée et ⏳ suivent leur règle', () => {
  const fiches = validerPaquet(reponse([
    ficheV7(GRATIN, REALISATION_GRATIN),
    { ...ficheV7(GATEAU, REALISATION_GATEAU), id: 'gateau-neuf', nom: 'Gâteau neuf', source: SOURCE_IDEE },
    { ...ficheV7(GATEAU, REALISATION_GATEAU), id: 'quatre-quarts', nom: 'Quatre-quarts' },
  ]), { profils: PROFILS });
  assert.equal(fiches.valide, true);
  const plats = [GRATIN, { id: 'quatre-quarts', nom: 'Quatre-quarts' }];
  const prep = preparerImport(fiches.plats.map((p) => p.donnees), { plats, profils: PROFILS, serieEtapes: true });
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'refusee'], ['gateau-neuf', 'nouveau'], ['quatre-quarts', 'complete']]);
  assert.equal(prep.elements[0].raison, 'Claude a rendu la recette entière de «\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: seules ses étapes étaient demandées.');
  assert.deepEqual(prep.ecritures.map((e) => e.id), ['gateau-neuf', 'quatre-quarts']);
  // Hors série : remplacement habituel.
  assert.deepEqual(statuts(preparerImport(fiches.plats.map((p) => p.donnees), { plats, profils: PROFILS }))[0], [GRATIN.id, 'remplace']);
});

test('dérive 3 : { id, nom, realisation } seule, sans empreinte : refusée, rien remplacé', () => {
  const { validation, prep } = preparerLot(reponse([{ id: GRATIN.id, nom: GRATIN.nom, realisation: REALISATION_GRATIN }]), [GRATIN]);
  assert.equal(validation.valide, false);
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'refusee']]);
  assert.equal(prep.elements[0].raison, '«\u00A0Gratin de pâtes au jambon\u00A0» n’est pas repris\u00A0: l’empreinte de la demande manque. Il restera à détailler.');
  assert.deepEqual(prep.ecritures, []);
});

test('chaque entrée pour elle-même : une entrée fautive ou rendue deux fois n’arrête pas les autres', () => {
  const fautive = REALISATION_GATEAU.map((e, i) => (i === 2 ? { ...e, duree: '3 min' } : e));
  const { validation, prep } = preparerLot(reponse([
    entree(GRATIN, REALISATION_GRATIN), entree(GATEAU, fautive), entree(GRATIN, REALISATION_GRATIN),
  ]), [GRATIN, GATEAU]);
  assert.equal(validation.valide, true);
  assert.equal(validation.plats[2].erreurs[0].refus, 'Claude a rendu deux fois «\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: seule la première est reprise.');
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'etapes'], [GATEAU.id, 'refusee'], [GRATIN.id, 'refusee']]);
  assert.equal(prep.elements[1].raison, '«\u00A0Gâteau au yaourt\u00A0» n’est pas repris\u00A0: l’étape 3 n’a pas de durée lisible. Il restera à détailler.');
  assert.deepEqual(prep.elements[1].aCorriger, ['realisation[2].duree : entier de 1 à 1440 attendu']);
  assert.deepEqual(prep.ecritures.map((e) => e.id), [GRATIN.id]);
});

// ——— Lots d'étapes : statuts ———

test('statuts : inconnu, corbeille, attente, identique (avant change), déjà détaillé, change, refusée contre la fiche', () => {
  const corbeille = { ...structuredClone(GATEAU), corbeille: { le: 1, par: 'a@exemple.fr' } };
  const attente = { id: 'soupe', nom: 'Soupe' };
  const fiche = detaille(GRATIN, REALISATION_GRATIN);
  const lot = (plats, ...entrees) => preparerLot(reponse(entrees), plats).prep;
  assert.deepEqual(statuts(lot([], entree(GRATIN, REALISATION_GRATIN))), [[GRATIN.id, 'inconnu']]);
  assert.deepEqual(statuts(lot([corbeille], entree(GATEAU, REALISATION_GATEAU))), [[GATEAU.id, 'corbeille']]);
  assert.deepEqual(statuts(lot([attente], { id: 'soupe', nom: 'Soupe', empreinte: 'abcdef', realisation: REALISATION_GATEAU })), [['soupe', 'attente']]);
  // Recollé après l'enregistrement : la fiche a changé d'empreinte, mais elle a déjà ces étapes.
  assert.deepEqual(statuts(lot([fiche], entree(GRATIN, REALISATION_GRATIN))), [[GRATIN.id, 'identique']]);
  const autre = REALISATION_GRATIN.map((e, i) => (i === 0 ? { ...e, texte: 'Autrement.' } : e));
  assert.deepEqual(statuts(lot([fiche], entree(GRATIN, autre))), [[GRATIN.id, 'dejaDetaille']]);
  assert.deepEqual(statuts(lot([GRATIN], { ...entree(GRATIN, REALISATION_GRATIN), empreinte: 'zzzzzz' })), [[GRATIN.id, 'change']]);
  const sansFour = REALISATION_GRATIN.map((e) => ({ ...e, appareil: e.appareil === 'four' ? undefined : e.appareil, tempC: undefined }));
  const refusee = lot([GRATIN], entree(GRATIN, sansFour));
  assert.deepEqual(statuts(refusee), [[GRATIN.id, 'refusee']]);
  assert.equal(refusee.elements[0].raison, '«\u00A0Gratin de pâtes au jambon\u00A0» n’est pas repris\u00A0: l’appareil four de sa cuisson n’apparaît dans aucune étape. Il restera à détailler.');
  assert.deepEqual(refusee.elements[0].aCorriger, ['realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape']);
});

test('statut `etapes` : titres, nombre, travail, remplace, modifiée à la main, repères à revoir, autres champs ignorés', () => {
  const modifiee = { ...structuredClone(GRATIN), realisation: REALISATION_GRATIN, etapes: ['Autre.'], modifieeLe: { seconds: Date.UTC(2026, 9, 9, 10) / 1000 }, modifieePar: 'a@exemple.fr' };
  const { prep } = preparerLot(reponse([
    { ...entree(modifiee, REALISATION_GRATIN), reperesARevoir: true, statutRecette: 'brouillon', cuisson: [] },
    entree(GATEAU, REALISATION_GATEAU),
  ]), [modifiee, GATEAU]);
  const [gratin, gateau] = prep.elements;
  assert.equal(gratin.statut, 'etapes');
  assert.equal(gratin.etapes, REALISATION_GRATIN.length);
  assert.deepEqual(gratin.titres, titresDe(REALISATION_GRATIN));
  assert.equal(gratin.travail, 23); // hors « le jour du repas »
  assert.equal(gratin.remplace, true);
  assert.equal(gratin.modifieeA, Date.UTC(2026, 9, 9, 10) / 1000);
  assert.equal(gratin.reperesARevoir, true);
  assert.deepEqual(gratin.avertissements, ['Seules les étapes de «\u00A0Gratin de pâtes au jambon\u00A0» sont reprises.']);
  assert.equal(gateau.remplace, false);
  assert.equal(gateau.reperesARevoir, false);
  assert.equal(gateau.travail, 13);
  assert.equal(prep.lotDEtapes, true);
  assert.deepEqual(prep.demandesAClore, []);
});

test('version des instructions : un lot d’étapes d’une autre version est refusé en entier', () => {
  const paquet = reponse([entree(GRATIN, REALISATION_GRATIN)], VERSION_INSTRUCTIONS - 1);
  const ancien = preparerLot(paquet, [GRATIN], { controle: controlerInstructions([paquet]) }).prep;
  assert.equal(ancien.refus, 'instructions');
  assert.equal(ancien.messageRefus, 'Ces étapes ne viennent pas des instructions actuelles. Recopiez-les depuis Réglages › Projet Claude, puis redemandez ces recettes.');
  assert.deepEqual(ancien.ecritures, []);
  const recent = reponse([entree(GRATIN, REALISATION_GRATIN)], VERSION_INSTRUCTIONS + 1);
  assert.equal(preparerLot(recent, [GRATIN], { controle: controlerInstructions([recent]) }).prep.refus, 'app');
  assert.equal(preparerLot(reponse([entree(GRATIN, REALISATION_GRATIN)]), [GRATIN], { controle: controlerInstructions([reponse([])]) }).prep.refus, undefined);
});

// ——— Écritures ———

test('ecrituresEtapes : liste fermée de champs ; décochées retirées ; `effacerRelue` seulement sur signal de Claude', () => {
  const relue = { ...structuredClone(GRATIN), reperesRelus: 1 };
  const { prep } = preparerLot(reponse([{ ...entree(relue, REALISATION_GRATIN), reperesARevoir: true }, entree(GATEAU, REALISATION_GATEAU)]), [relue, GATEAU]);
  assert.deepEqual(prep.ecritures.map((e) => Object.keys(e).sort()), [
    ['effacerRelue', 'empreinte', 'etapes', 'id', 'mode', 'realisation'], ['effacerRelue', 'empreinte', 'etapes', 'id', 'mode', 'realisation'],
  ]);
  assert.deepEqual(prep.ecritures.map((e) => [e.id, e.mode, e.effacerRelue, e.empreinte]), [
    [GRATIN.id, 'etapes', true, empreinteEtapes(relue)], [GATEAU.id, 'etapes', false, empreinteEtapes(GATEAU)],
  ]);
  assert.deepEqual(prep.ecritures[0].etapes, titresDe(REALISATION_GRATIN));
  assert.deepEqual(filtrerPreparation(prep, [GATEAU.id]).ecritures.map((e) => e.id), [GRATIN.id]);
  assert.deepEqual(ecrituresEtapes({ ...prep, elements: prep.elements.map((e) => ({ ...e, retenu: e.id !== GRATIN.id })) }).map((e) => e.id), [GATEAU.id]);
  // Champs écrits : seulement réalisation et titres (plus majPar, majLe et l'effacement de la marque « relue »).
  assert.deepEqual(CHAMPS_ECRITS_PAR_ETAPES, ['realisation', 'etapes', 'majPar', 'majLe', 'reperesRelus']);
  assert.deepEqual(Object.keys(champsEcritureEtapes(prep.ecritures[0]).champs), ['realisation', 'etapes']);
  assert.deepEqual(champsEcritureEtapes(prep.ecritures[0]).effacer, ['reperesRelus']);
  assert.deepEqual(champsEcritureEtapes(prep.ecritures[1]).effacer, []);
  for (const interdit of ['ingredients', 'cuisson', 'variantes', 'notes', 'statutRecette', 'modifieeLe', 'modifieePar', 'nom']) {
    assert.ok(!CHAMPS_ECRITS_PAR_ETAPES.includes(interdit), interdit);
  }
});

test('verifierEcritureEtapes : fiche supprimée, à la corbeille, sans recette, changée depuis l’aperçu', () => {
  const ecriture = { id: GRATIN.id, mode: 'etapes', empreinte: empreinteEtapes(GRATIN) };
  assert.equal(verifierEcritureEtapes(ecriture, structuredClone(GRATIN)), null);
  assert.equal(verifierEcritureEtapes(ecriture, null), 'supprime');
  assert.equal(verifierEcritureEtapes(ecriture, { ...GRATIN, corbeille: { le: 1 } }), 'corbeille');
  assert.equal(verifierEcritureEtapes(ecriture, { id: GRATIN.id, nom: GRATIN.nom }), 'sansRecette');
  assert.equal(verifierEcritureEtapes(ecriture, { ...GRATIN, portionsBase: 6 }), 'change');
  // Une quantité changée ailleurs ne bloque pas.
  assert.equal(verifierEcritureEtapes(ecriture, { ...GRATIN, ingredients: GRATIN.ingredients.map((i) => ({ ...i, qte: i.qte * 2 })) }), null);
  // Fiche déjà détaillée de ces mêmes étapes (autre appareil, premier envoi en partie réussi) : jamais « changée ».
  const { prep } = preparerLot(reponse([entree(GRATIN, REALISATION_GRATIN)]), [structuredClone(GRATIN)]);
  const [ec] = prep.ecritures;
  const apres = { ...structuredClone(GRATIN), ...champsEcritureEtapes(ec).champs };
  assert.equal(verifierEcritureEtapes(ec, apres), 'dejaFaite');
  // Détaillée autrement entre-temps : changée.
  const autrement = REALISATION_GRATIN.map((e, i) => (i === 0 ? { ...e, texte: 'Autrement.' } : e));
  assert.equal(verifierEcritureEtapes(ec, detaille(GRATIN, autrement)), 'change');
});

test('appliquerImport : étapes posées si l’empreinte tient, marque « relue » retirée sur signal ; `supprimer` d’une fiche complète', () => {
  const relue = { ...structuredClone(GRATIN), reperesRelus: 1 };
  const { prep } = preparerLot(reponse([{ ...entree(relue, REALISATION_GRATIN), reperesARevoir: true }]), [relue]);
  const [apres] = appliquerImport([relue], prep.ecritures);
  assert.deepEqual(apres.etapes, titresDe(REALISATION_GRATIN));
  assert.equal(apres.realisation.length, REALISATION_GRATIN.length);
  assert.equal(apres.reperesRelus, undefined);
  assert.deepEqual(appliquerImport([{ ...relue, portionsBase: 2 }], prep.ecritures)[0].realisation, undefined);
  assert.deepEqual(appliquerImport([], prep.ecritures), []);
  const [efface] = appliquerImport([detaille(GRATIN, REALISATION_GRATIN)], [{ id: GRATIN.id, donnees: { etapes: ['Court.'] }, supprimer: ['realisation'] }]);
  assert.equal(efface.realisation, undefined);
  assert.deepEqual(efface.etapes, ['Court.']);
});

// ——— DEMANDE-ETAPES et correction ———

const SECTION_UN_PLAT = '(Écris la réalisation détaillée de ce plat, selon la section 2 bis. Ne change ni les ingrédients, ni les quantités, ni les portions, ni la manière de cuire, ni les repères. Nomme chaque ingrédient exactement comme dans la ligne `ingrédients:`. Rends seulement { "id", "nom", "empreinte", "realisation" }, `id`, `nom` et `empreinte` recopiés tels quels, en un seul bloc.)';

test('texteDemandeEtapes : un seul plat (fiche), lignes omises quand elles sont vides, à corriger', () => {
  const simple = { id: 'soupe', nom: 'Soupe', portionsBase: 2, ingredients: [{ produit: 'poireau', qte: 2, unite: 'pc', marqueurs: ['legume'] }, { produit: 'sel', qte: 1, unite: 'pincee' }] };
  assert.equal(texteDemandeEtapes([simple], { appareils: ['plaque', { id: 'four', actif: false }] }), [
    'DEMANDE-ETAPES paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'appareils: plaque',
    SECTION_UN_PLAT,
    'plats:',
    '- id: soupe',
    '  nom: Soupe',
    `  empreinte: ${empreinteEtapes(simple)}`,
    '  portions: 2',
    '  ingrédients: 2 poireau [legume] ; 1 pincee sel []',
  ].join('\n'));
  const corrige = texteDemandeEtapes([GRATIN, GATEAU], { aCorriger: { [GATEAU.id]: ['realisation[2].duree : entier de 1 à 1440 attendu', 'realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape'] } });
  assert.ok(corrige.endsWith([
    '  temps de travail: 10 min',
    '  à corriger: realisation[2].duree : entier de 1 à 1440 attendu',
    '  à corriger: realisation : l\'appareil four de cuisson n\'apparaît dans aucune étape',
  ].join('\n')));
  assert.match(corrige, /\nnombre: 2\npar message: 4\n/);
  // Plats sans ingrédients : pas dans la demande.
  assert.doesNotMatch(texteDemandeEtapes([GRATIN, { id: 'vide', nom: 'Vide' }]), /vide/);
  assert.equal(ETAPES_PAR_MESSAGE, 4);
  assert.equal(IDEES_PAR_MESSAGE, 3);
});

test('texteDemandeEtapes : rien sur les personnes (ni profil, ni prénom, ni adresse, ni âge, ni style)', () => {
  const avecVersions = {
    ...structuredClone(GRATIN),
    notes: { 'profil-a': 5, enfant: 0 },
    variantes: [
      { pour: 'profil-b', style: 'mer', retirer: ['jambon blanc'], ajouter: [{ produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] }], frigoJours: 2 },
      { pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'], ajouter: [{ produit: 'tofu fumé', qtePortion: 60, unite: 'g', rayon: 'cremerie', marqueurs: ['soja'] }] },
    ],
    modifieePar: 'a@exemple.fr',
  };
  const texte = texteDemandeEtapes([avecVersions], { profils: PROFILS });
  for (const interdit of [/profil/, /Adulte/, /Enfant/i, /[\w.]+@[\w-]+\./, /2024/, /\bmer\b/, /vegetal/, /végétal/, /notes?:/]) assert.doesNotMatch(texte, interdit);
  assert.match(texte, /\n {2}parts à mettre de côté: sans jambon blanc \(avec thon au naturel\) ; sans jambon blanc \(avec tofu fumé\)$/);
});

test('correction d’un message d’étapes dont aucune recette n’a pu être reprise : étapes seules, puis « suite »', () => {
  const fautive = REALISATION_GRATIN.map((e, i) => (i === 7 ? { ...e, duree: '20 min' } : e));
  const v = validerPaquet(reponse([entree(GRATIN, fautive)]));
  assert.equal(v.valide, false);
  assert.equal(texteCorrectionPourClaude(v), [
    'CORRECTION paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'id: gratin-pates-jambon',
    '- plats[0] (gratin-pates-jambon) realisation[7].duree : entier de 1 à 1440 attendu',
    FORMULE_CORRECTION_ETAPES,
  ].join('\n'));
  assert.equal(FORMULE_CORRECTION_ETAPES, '(Rends seulement { "id", "nom", "empreinte", "realisation" } de chaque plat de ce message, corrigé, en un seul bloc ; puis attends « suite ».)');
});

// ——— Série d'étapes (« Coller la suite ») ———

test('série : nature, bilan, recollé, état et phrases d’un lot d’étapes', () => {
  const fautive = REALISATION_GATEAU.map((e, i) => (i === 2 ? { ...e, duree: '3 min' } : e));
  const { validation, prep } = preparerLot(reponse([entree(GRATIN, REALISATION_GRATIN), entree(GATEAU, fautive)]), [GRATIN, GATEAU]);
  assert.equal(natureDuMessage(validation), 'etapes');
  assert.equal(natureDuMessage(prep), 'etapes');
  assert.equal(natureDuMessage({ lotDEtapes: true, plats: [] }), 'etapes');
  const bilan = bilanDuMessage(prep);
  assert.deepEqual(bilan.ajoutes, [{ id: GRATIN.id, nom: GRATIN.nom }]);
  assert.deepEqual(bilan.autres, []);
  assert.deepEqual(bilan.nonRepris.map((n) => [n.id, n.aCorriger]), [[GATEAU.id, ['realisation[2].duree : entier de 1 à 1440 attendu']]]);
  // Recollé après l'enregistrement : identique, rien de nouveau.
  const recolle = preparerLot(reponse([entree(GRATIN, REALISATION_GRATIN)]), [detaille(GRATIN, REALISATION_GRATIN)]).prep;
  assert.equal(dejaEnregistre(recolle, [GRATIN.id]), true);
  const restants = Array.from({ length: 38 }, (_, i) => ({ id: `plat-${i}`, nom: `Plat ${i}` }));
  const etat = etatSerie({
    nature: 'etapes', ajoutesDepuisOuverture: bilan.ajoutes, dernier: bilan.ajoutes, nonRepris: bilan.nonRepris,
    aDetailler: [...restants, { id: GATEAU.id, nom: GATEAU.nom }], reponses: 5, refuses: [{ id: GATEAU.id, nom: GATEAU.nom }, { id: 'detaille-depuis', nom: 'Détaillé depuis' }],
  });
  assert.equal(etat.restants, 39);
  assert.equal(etat.conseil, true);
  assert.deepEqual(etat.refuses, [{ id: GATEAU.id, nom: GATEAU.nom }]);
  const textes = texteSerie(etat);
  assert.equal(textes.titre, '✓ 1\u00A0recette détaillée');
  assert.deepEqual(textes.noms, [GRATIN.nom]);
  assert.equal(textes.restants, 'Encore 39\u00A0recettes à détailler.');
  assert.deepEqual(textes.nonRepris, ['«\u00A0Gâteau au yaourt\u00A0» n’a pas été repris\u00A0: il restera à détailler.']);
  assert.equal(textes.conseil, 'La conversation devient longue\u00A0: pour la suite, ouvrez une nouvelle conversation Claude.');
  assert.equal(textes.recopier, '📋 Recopier la demande pour les 39\u00A0restantes');
  assert.equal(textes.refuses, '1\u00A0recette n’a pas été reprise\u00A0: «\u00A0Gâteau au yaourt\u00A0».');
  assert.equal(textes.redemander, '📋 Redemander cette recette');
  const deux = texteSerie(etatSerie({ nature: 'etapes', aDetailler: 2, refuses: [{ id: 'a', nom: 'Gratin' }, { id: 'b', nom: 'Velouté' }] }));
  assert.equal(deux.refuses, '2\u00A0recettes n’ont pas été reprises\u00A0: «\u00A0Gratin\u00A0», «\u00A0Velouté\u00A0».');
  assert.equal(deux.redemander, '📋 Redemander ces 2\u00A0recettes');
  assert.equal(deux.recopier, null);
  assert.equal(deux.titre, 'Aucune recette détaillée.');
  const fin = texteSerie(etatSerie({ nature: 'etapes', dernier: bilan.ajoutes, aDetailler: [] }));
  assert.equal(fin.restants, '✓ Toutes vos recettes sont détaillées 🎉');
  assert.equal(fin.aide, null);
});

// ——— « Modifier » : éditeur réduit ———

test('« Modifier » : réalisation à jour dans la saisie ; étapes écrites avec leurs titres ; jamais la marque « relue » effacée pour des étapes', () => {
  const plat = { ...detaille(GRATIN, REALISATION_GRATIN), reperesRelus: 1 };
  const base = normaliserPourEdition(plat);
  assert.equal(base.realisation.length, REALISATION_GRATIN.length);
  assert.equal(normaliserPourEdition({ ...plat, etapes: ['Autre.'] }).realisation, null);
  assert.equal(brouillonValide({ v: 1, depuis: 1, base, saisie: base }), true);
  const { realisation: _r, ...ancien } = base;
  assert.equal(brouillonValide({ v: 1, depuis: 1, base: ancien, saisie: ancien }), true, 'brouillon d’avant T5-0b');
  const saisie = structuredClone(base);
  saisie.realisation[0].titre = '  Préparer  l’oignon ';
  saisie.realisation[0].duree = 6;
  saisie.realisation.splice(9, 1);
  const r = preparerModification(base, saisie, plat, { plats: [plat] });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(Object.keys(r.champs).sort(), ['etapes', 'realisation']);
  assert.equal(r.champs.realisation[0].titre, 'Préparer l’oignon');
  assert.deepEqual(r.champs.etapes, titresDe(r.champs.realisation));
  assert.equal(r.champs.etapes.length, 9);
  assert.ok(!r.supprimer.includes('reperesRelus'));
  assert.deepEqual(r.avertissements, []);
});

test('« Modifier » : étape sans titre, sans texte ou sans durée → erreurs ; tout retirer efface réalisation et étapes', () => {
  const plat = detaille(GRATIN, REALISATION_GRATIN);
  const base = normaliserPourEdition(plat);
  const saisie = structuredClone(base);
  saisie.realisation[1].titre = ' ';
  saisie.realisation[2].texte = '';
  saisie.realisation[3].duree = 0;
  const r = preparerModification(base, saisie, plat);
  assert.deepEqual(r.erreurs, [
    { champ: 'realisation', message: 'Écrivez ce qu’on fait à cette étape.' },
    { champ: 'realisation', message: 'Écrivez comment faire cette étape.' },
    { champ: 'realisation', message: 'Indiquez la durée de l’étape, en minutes.' },
  ]);
  const vide = preparerModification(base, { ...structuredClone(base), realisation: [] }, plat);
  assert.deepEqual(vide.supprimer, ['realisation', 'etapes']);
});

test('« Modifier » : ingrédient retiré encore cité, mesures « Et aussi » pour d’autres portions : avertissements', () => {
  const plat = detaille(GRATIN, REALISATION_GRATIN);
  const base = normaliserPourEdition(plat);
  const saisie = structuredClone(base);
  saisie.ingredients = saisie.ingredients.filter((i) => i.produit !== 'jambon blanc');
  saisie.portionsBase = 6;
  const r = preparerModification(base, saisie, plat);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.avertissements, [
    '«\u00A0jambon blanc\u00A0» n’est plus dans la recette\u00A0: sa quantité ne s’affichera plus à l’étape 6.',
  ]);
  // Mesures « Et aussi » non fixes : un « Et aussi » mesuré pour 4 portions.
  const avecMesure = detaille(GRATIN, REALISATION_GRATIN.map((e, i) => (i === 4 ? { ...e, aussi: [{ produit: 'sel fin', qte: 1, unite: 'cc' }] } : e)));
  const b2 = normaliserPourEdition(avecMesure);
  const r2 = preparerModification(b2, { ...structuredClone(b2), portionsBase: 6 }, avecMesure);
  assert.deepEqual(r2.avertissements, ['Les mesures «\u00A0Et aussi\u00A0» des étapes (sel, eau) étaient pour 4\u00A0portions.']);
});

test('« Modifier » : « Cuit surtout au » changé, la plus longue étape de l’ancien appareil suit, bandeau de relecture', () => {
  const plat = detaille(GRATIN, REALISATION_GRATIN);
  const base = normaliserPourEdition(plat);
  const { cuisson, realisation, relire } = changerCuissonEtEtapes(base, { appareil: 'airfryer', dureeMin: 15 });
  assert.deepEqual(cuisson[1], { appareil: 'airfryer', tempC: 200, dureeMin: 15 });
  assert.deepEqual([realisation[7].appareil, realisation[7].tempC, realisation[7].duree], ['airfryer', 200, 15]);
  assert.equal(relire, 'Relisez l’étape «\u00A0Gratiner au four\u00A0»\u00A0: son texte parle peut-être encore de l’ancien appareil.');
  const r = preparerModification(base, { ...structuredClone(base), cuisson, realisation }, plat);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(Object.keys(r.champs).sort(), ['cuisson', 'etapes', 'realisation']);
  // Même appareil, autre durée : l'étape suit sans bandeau.
  const meme = changerCuissonEtEtapes(base, { appareil: 'four', dureeMin: 25 });
  assert.equal(meme.realisation[7].duree, 25);
  assert.equal(meme.relire, null);
  // Sans étapes détaillées : la cuisson seule.
  assert.equal(changerCuissonEtEtapes(normaliserPourEdition(GRATIN), { appareil: 'four', dureeMin: 30 }).realisation, null);
});

test('« Modifier » : portions changées ailleurs pendant qu’une quantité change ici → conflit, avec ou sans étapes détaillées', () => {
  for (const plat of [structuredClone(GRATIN), detaille(GRATIN, REALISATION_GRATIN)]) {
    const base = normaliserPourEdition(plat);
    const saisie = structuredClone(base);
    saisie.ingredients[0].qte = 500;
    const r = preparerModification(base, saisie, { ...structuredClone(plat), portionsBase: 8 });
    assert.deepEqual(r.conflits, ['portionsBase']);
    assert.equal(r.champs.portionsBase, 4);
    assert.equal(r.champs.ingredients[0].qte, 500);
  }
});

test('« Modifier » : le bandeau « Relisez l’étape » n’est dans le document que lorsqu’il parle', async () => {
  // Régression de T5-0b : ce bandeau, caché mais toujours présent, portait `bandeau bandeau-alerte` ; l’écran avait
  // alors deux bandeaux d’alerte et deux bandeaux tout court, et celui du conflit (« … vient d’être changé sur l’autre
  // téléphone ») ou celui de la reprise ne se trouvaient plus seuls. Les bandeaux de l’écran créés cachés sont ceux
  // des messages sous le titre ; « Relisez l’étape » est créé visible et posé seulement quand il a un texte.
  const source = await readFile(new URL('../js/ui/modifier.js', import.meta.url), 'utf8');
  const caches = source.match(/el\('p', \{ class: 'bandeau[^']*', hidden: true \}/g) ?? [];
  assert.equal(caches.length, 2, caches.join(' | '));
  assert.match(source, /const bandeauRepris = el\('p', \{ class: 'bandeau', hidden: true \}/);
  assert.match(source, /const bandeauConflit = el\('p', \{ class: 'bandeau bandeau-alerte', hidden: true \}/);
  assert.match(source, /bandeauRelire = el\('p', \{ class: 'bandeau bandeau-alerte' \}/);
  assert.match(source, /if \(!relire\) bandeauRelire\.remove\(\);\n\s+else if \(!bandeauRelire\.isConnected\) zoneRelire\?\.append\(bandeauRelire\);/);
  assert.doesNotMatch(source, /bandeauRelire\.hidden/);
  assert.match(source, /zoneRelire = el\('div', \{ role: 'status' \}, aideCuisson\)\)/);
});

// ——— Sauvegarde ———

test('sauvegarde : la réalisation fait l’aller-retour ; une recette reprise d’un fichier sans réalisation la remplace, l’aperçu le dit', () => {
  const maintenant = new Date('2026-10-13T10:00:00Z');
  const plat = { ...detaille(GRATIN, REALISATION_GRATIN), notes: {} };
  const avec = validerSauvegarde(lireSauvegarde(creerSauvegarde({ plats: [plat], profils: [] }, { maintenant }).texte).sauvegarde);
  assert.deepEqual(avec.avertissements, []);
  assert.deepEqual(avec.plats[0].recette.realisation, recetteValidee(plat).realisation);
  assert.equal(preparerRestauration(avec, { plats: [plat], profils: [], demandes: [], email: 'a@exemple.fr' }).rien, true);
  // Fichier d'avant les étapes détaillées, même recette sinon : différente, avec la phrase.
  const ancien = validerSauvegarde(lireSauvegarde(creerSauvegarde({ plats: [structuredClone(GRATIN)], profils: [] }, { maintenant }).texte).sauvegarde);
  const app = { plats: [plat], profils: [], demandes: [], email: 'a@exemple.fr' };
  const apercu = preparerRestauration(ancien, app);
  assert.deepEqual(apercu.recettesDifferentes.map((r) => [r.id, r.mention]), [
    [GRATIN.id, '«\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: les étapes détaillées seront remplacées par les étapes courtes du fichier.'],
  ]);
  const reprise = preparerRestauration(ancien, app, { recettesAReprendre: [GRATIN.id] });
  const ecriture = reprise.lots.flat().find((e) => e.id === GRATIN.id);
  assert.ok(ecriture.effacer.includes('realisation'));
  assert.deepEqual(ecriture.donnees.etapes, GRATIN.etapes);
});

test('sauvegarde : des étapes détaillées abîmées dans le fichier sont laissées de côté, avec un avertissement', () => {
  const maintenant = new Date('2026-10-13T10:00:00Z');
  const { texte } = creerSauvegarde({ plats: [{ ...detaille(GRATIN, REALISATION_GRATIN), notes: {} }], profils: [] }, { maintenant });
  const fichier = JSON.parse(texte);
  fichier.plats[0].realisation = [{ titre: 'Sans texte ni durée' }];
  const v = validerSauvegarde(fichier);
  assert.equal(v.valide, true);
  assert.equal(v.plats[0].recette.realisation, undefined);
  assert.deepEqual(v.avertissements, ['«\u00A0Gratin de pâtes au jambon\u00A0»\u00A0: ses étapes détaillées sont abîmées dans ce fichier, elles ne seront pas reprises.']);
});

test('version 7 : une recette entière rendue à la place d’une relecture en cours dit « au lieu de sa seule relecture »', () => {
  // Plat du dernier lot de relecture copié : pas d'erreur « étapes détaillées manquent » ; preparerImport signale la
  // recette entière et la correction redemande des relectures seules (T2d).
  const v = validerPaquet(reponse([structuredClone(GRATIN)]), { profils: PROFILS, relectureEnCours: [GRATIN.id] });
  assert.equal(v.valide, true, JSON.stringify(v.plats[0].erreurs));
  const prep = preparerImport(v.plats.map((p) => p.donnees), {
    plats: [structuredClone(GRATIN)], profils: PROFILS, relectureEnCours: [GRATIN.id],
  });
  assert.equal(prep.relecture, true);
  assert.match(prep.erreurs[0].message, /au lieu de sa seule relecture/);
  // Hors du lot de relecture : l'erreur de la version 7 reste.
  assert.equal(validerPaquet(reponse([structuredClone(GRATIN)]), { profils: PROFILS, relectureEnCours: ['autre'] }).valide, false);
});

test('série d’étapes : une recette rendue deux fois dont la première est écrite n’est jamais « non reprise »', () => {
  const premiere = entree(GRATIN, REALISATION_GRATIN);
  const { prep } = preparerLot(reponse([premiere, structuredClone(premiere)]), [structuredClone(GRATIN)]);
  assert.deepEqual(statuts(prep), [[GRATIN.id, 'etapes'], [GRATIN.id, 'refusee']]);
  const bilan = bilanDuMessage(prep);
  assert.deepEqual(bilan.ajoutes.map((p) => p.id), [GRATIN.id]);
  assert.deepEqual(bilan.nonRepris, []);
});

test('détection : une idée sans ingrédients garde le message d’idées entier (jamais un lot d’étapes) ; sa correction redemande toutes les fiches', () => {
  const idee = (plat, id, nom) => ({ ...ficheV7(plat, plat === GRATIN ? REALISATION_GRATIN : REALISATION_GATEAU), id, nom, source: SOURCE_IDEE });
  const vide = { ...idee(GATEAU, 'soupe-neuve', 'Soupe neuve'), ingredients: [] };
  const sansChamp = idee(GATEAU, 'soupe-neuve', 'Soupe neuve');
  delete sansChamp.ingredients;
  for (const fautive of [vide, sansChamp]) {
    const v = validerPaquet(reponse([idee(GRATIN, 'gratin-neuf', 'Gratin neuf'), idee(GATEAU, 'gateau-neuf', 'Gâteau neuf'), fautive]), { profils: PROFILS });
    assert.equal(v.lotDEtapes, undefined);
    assert.equal(v.valide, false);
    assert.deepEqual(v.plats.slice(0, 2).map((p) => p.erreurs), [[], []]);
    const correction = texteCorrectionPourClaude(v);
    assert.match(correction, /Rends toutes les fiches du message, corrigées, en un seul bloc/);
    assert.doesNotMatch(correction, /empreinte/);
  }
  // { id, nom, realisation } seule reste un lot d'étapes (dérive 3), mais pas à côté d'une fiche complète.
  const seule = { id: GRATIN.id, nom: GRATIN.nom, realisation: structuredClone(REALISATION_GRATIN) };
  assert.equal(validerPaquet(reponse([seule])).lotDEtapes, true);
  assert.equal(validerPaquet(reponse([seule, idee(GATEAU, 'gateau-neuf', 'Gâteau neuf')])).lotDEtapes, undefined);
});

test('sauvegarde et « Modifier » ne sont jamais un lot d’étapes : une fiche abîmée n’emporte pas les autres recettes', () => {
  const abimee = { id: 'soupe', nom: 'Soupe', statutRecette: 'attente', etapes: ['Cuire'], realisation: [{ titre: 'Cuire', texte: 'Faites cuire.', duree: 20 }] };
  for (const plats of [[detaille(GRATIN, REALISATION_GRATIN), abimee], [abimee]]) {
    const v = validerSauvegarde({ format: FORMAT, sauvegardeLe: '2026-10-13T10:00:00.000Z', reglages: {}, profils: [], produits: [], plats });
    assert.equal(v.valide, true);
    assert.ok(v.plats.every((p) => p.recette), JSON.stringify(v.avertissements));
    assert.ok(!v.avertissements.some((a) => /recette est abîmée/.test(a)), JSON.stringify(v.avertissements));
  }
  assert.equal(validerPaquet({ format: FORMAT, plats: [abimee] }, { lotsDEtapes: false }).lotDEtapes, undefined);
});

test('détection, sens inverse : étapes rangées sous `etapes` ou une clé accentuée → lot d’étapes, correction « realisation » ; en série, l’empreinte seule aussi', () => {
  const base = { id: GRATIN.id, nom: GRATIN.nom, empreinte: empreinteEtapes(GRATIN) };
  const attendu = `plats[0] (${GRATIN.id}) realisation attendue (la liste des étapes va sous la clé "realisation", jamais "etapes")`;
  for (const entreeFautive of [
    { ...base, etapes: structuredClone(REALISATION_GRATIN) },
    { ...base, 'réalisation': structuredClone(REALISATION_GRATIN) },
  ]) {
    const v = validerPaquet(reponse([entreeFautive]));
    assert.equal(v.lotDEtapes, true);
    assert.equal(v.relecture, undefined);
    assert.deepEqual(v.plats[0].erreurs.map((e) => e.pourClaude), [attendu]);
    const correction = texteCorrectionPourClaude(v);
    assert.ok(correction.endsWith(FORMULE_CORRECTION_ETAPES), correction);
    assert.doesNotMatch(correction, /precautions/);
  }
  // Réalisation oubliée : relecture hors série (règle 3), lot d'étapes en série d'étapes.
  assert.equal(validerPaquet(reponse([base])).relecture, true);
  const enSerie = validerPaquet(reponse([base]), { serieEtapes: true });
  assert.equal(enSerie.lotDEtapes, true);
  assert.deepEqual(enSerie.plats[0].erreurs.map((e) => e.pourClaude), [attendu]);
  // Une vraie relecture (avec `precautions`) reste une relecture, même en série.
  assert.equal(validerPaquet(reponse([{ ...base, precautions: [] }]), { serieEtapes: true }).relecture, true);
});
