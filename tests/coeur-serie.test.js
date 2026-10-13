// « Coller la suite » (T5-0a) : nature d'un message collé, bilan d'un enregistrement, message recollé, état et phrases
// de la carte de série. Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SOURCE_IDEE, VERSION_INSTRUCTIONS } from '../js/coeur/claude.js';
import { filtrerPreparation, preparerImport, validerPaquet } from '../js/coeur/paquet.js';
import {
  CONSEIL_NOUVELLE_CONVERSATION, SOURCE_IDEE_SERIE, TEXTES_SERIE, bilanDuMessage, dejaEnregistre, etatSerie,
  natureDuMessage, texteSerie,
} from '../js/coeur/serie.js';

// ——— Fixtures ———

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const LENTILLES = ing('lentille corail', 300, 'g', ['feculent']);
const OIGNON = ing('oignon jaune', 1, 'pc', ['legume'], { role: 'incorpore' });

/** Fiche rendue par Claude pour DEMANDE-IDEES (sans versions : aucun profil n'a de règles ici). */
const idee = (id, nom, extra = {}) => ({
  id,
  nom,
  type: 'plat',
  statutRecette: 'brouillon',
  portionsBase: 4,
  ingredients: [LENTILLES, OIGNON],
  etapes: ['Faire revenir l’oignon.', 'Cuire les lentilles.'],
  cuisson: [{ appareil: 'plaque', dureeMin: 20 }],
  source: SOURCE_IDEE,
  ...extra,
});
const recette = (id, nom, extra = {}) => idee(id, nom, { source: 'Version classique', ...extra });
const platRempli = (id, nom) => ({ ...recette(id, nom), statutRecette: 'validee' });

const paquet = (...plats) => ({ format: 'paquet@1', instructions: VERSION_INSTRUCTIONS, plats });
function valider(...plats) {
  const validation = validerPaquet([paquet(...plats)], { profils: [] });
  assert.equal(validation.valide, true, JSON.stringify(validation.erreurs));
  return validation;
}
const preparer = (validation, plats = []) => preparerImport(validation.plats.map((p) => p.donnees), { plats, demandes: [], profils: [] });
/** Plats de l'app après l'enregistrement d'une préparation (fiches complètes seulement). */
const apres = (plats, preparation) => [
  ...plats.filter((p) => !preparation.ecritures.some((e) => e.id === p.id)),
  ...preparation.ecritures.filter((e) => !e.mode).map((e) => ({ ...e.donnees, id: e.id })),
];

// ——— natureDuMessage ———

test('SOURCE_IDEE_SERIE reste égale à SOURCE_IDEE de claude.js (serie.js n’importe rien)', async () => {
  assert.equal(SOURCE_IDEE_SERIE, SOURCE_IDEE);
  const source = await readFile(new URL('../js/coeur/serie.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import /m);
});

test('natureDuMessage : idées dès qu’une fiche complète est une idée de Claude', () => {
  assert.equal(natureDuMessage(valider(idee('dal-coco', 'Dal coco'), idee('chili-doux', 'Chili doux'))), 'idees');
  // Mélange : une idée suffit.
  assert.equal(natureDuMessage(valider(recette('soupe', 'Soupe'), idee('dal-coco', 'Dal coco'))), 'idees');
  // Tableau d'entrées brutes, ou objets { donnees }.
  assert.equal(natureDuMessage([idee('a', 'A')]), 'idees');
  assert.equal(natureDuMessage([{ donnees: idee('a', 'A') }]), 'idees');
  // Espaces autour de la source tolérés (comme paquet.js › texte).
  assert.equal(natureDuMessage([idee('a', 'A', { source: '  Idée de Claude ' })]), 'idees');
});

test('natureDuMessage : null pour une recette seule, des versions, une relecture, rien', () => {
  assert.equal(natureDuMessage(valider(recette('soupe', 'Soupe'))), null);
  // « Idée de Claude » doit être exacte.
  assert.equal(natureDuMessage([idee('a', 'A', { source: 'idée de claude' })]), null);
  assert.equal(natureDuMessage([idee('a', 'A', { source: 'Idée de Claude, revue' })]), null);
  // Une idée sans ingrédients n'est pas une fiche complète.
  assert.equal(natureDuMessage([{ id: 'a', nom: 'A', source: SOURCE_IDEE }]), null);
  // Versions seules.
  assert.equal(natureDuMessage([{ id: 'a', nom: 'A', variantes: [{ pour: 'profil-b', retirer: [], ajouter: [] }] }]), null);
  // Relecture des repères (T2d), même avec une idée glissée.
  assert.equal(natureDuMessage([{ id: 'a', nom: 'A', empreinte: 'abc123', precautions: [] }, idee('b', 'B')]), null);
  assert.equal(natureDuMessage([]), null);
  assert.equal(natureDuMessage(null), null);
  assert.equal(natureDuMessage({}), null);
  assert.equal(natureDuMessage([null, 3, 'x']), null);
});

test('natureDuMessage : lot d’étapes prévu (T5-0b), pas encore branché', () => {
  assert.equal(natureDuMessage([{ id: 'a', nom: 'A', empreinte: 'abc123', realisation: [] }]), 'etapes');
  // Empreinte seule : une relecture d'aujourd'hui, pas un lot d'étapes.
  assert.equal(natureDuMessage([{ id: 'a', nom: 'A', empreinte: 'abc123' }]), null);
});

// ——— bilanDuMessage et dejaEnregistre, sur de vraies préparations ———

test('bilanDuMessage : plats écrits dans l’ordre de l’aperçu, idées non reprises avec leur raison', () => {
  const plats = [platRempli('chili-doux', 'Chili doux')];
  const preparation = preparer(valider(idee('dal-coco', 'Dal coco'), idee('chili-doux', 'Chili doux'), idee('gratin-courge', 'Gratin de courge')), plats);
  const bilan = bilanDuMessage(preparation);
  assert.deepEqual(bilan.ajoutes, [{ id: 'dal-coco', nom: 'Dal coco' }, { id: 'gratin-courge', nom: 'Gratin de courge' }]);
  assert.deepEqual(bilan.autres, []);
  assert.deepEqual(bilan.nonRepris, [{
    id: 'chili-doux',
    nom: 'Chili doux',
    raison: '«\u00A0Chili doux\u00A0» est déjà dans vos plats\u00A0: cette idée n’est pas reprise.',
    remettable: false,
  }]);
});

test('bilanDuMessage : une fiche qui n’est pas une idée (recette remplacée, recette neuve) est dite à part, jamais comptée comme idée', () => {
  // Claude a écrit une autre source (« Idée de Claude (plus léger) ») : paquet.js n'y voit pas une idée et remplace la
  // recette du foyer.
  const plats = [platRempli('chili-doux', 'Chili doux')];
  const preparation = preparer(valider(
    idee('dal-coco', 'Dal coco'),
    idee('gratin-courge', 'Gratin de courge'),
    idee('chili-doux', 'Chili doux', { source: 'Idée de Claude (plus léger)' }),
    recette('soupe', 'Soupe'),
  ), plats);
  assert.deepEqual(preparation.elements.map((e) => e.statut), ['nouveau', 'nouveau', 'remplace', 'nouveau']);
  const bilan = bilanDuMessage(preparation);
  assert.deepEqual(bilan.ajoutes.map((p) => p.nom), ['Dal coco', 'Gratin de courge']);
  assert.deepEqual(bilan.autres, [
    { id: 'chili-doux', nom: 'Chili doux', statut: 'remplace' },
    { id: 'soupe', nom: 'Soupe', statut: 'nouveau' },
  ]);
  const textes = texteSerie(etatSerie({ nature: 'idees', ajoutesDepuisOuverture: bilan.ajoutes, dernier: bilan.ajoutes, autres: bilan.autres }));
  assert.equal(textes.titre, '✓ 2\u00A0idées ajoutées');
  assert.deepEqual(textes.noms, ['Dal coco', 'Gratin de courge']);
  assert.deepEqual(textes.autres, ['«\u00A0Chili doux\u00A0»\u00A0: recette remplacée.', '«\u00A0Soupe\u00A0»\u00A0: recette enregistrée.']);
  assert.equal(textes.depuis, null);
  // Sans idée écrite (idée déjà dans les plats) : le titre compte les recettes, jamais « 0 idée ».
  const seules = texteSerie(etatSerie({ nature: 'idees', autres: [{ nom: 'Soupe', statut: 'nouveau' }] }));
  assert.equal(seules.titre, '✓ 1\u00A0recette enregistrée');
  assert.equal(texteSerie(etatSerie({ nature: 'idees' })).titre, 'Aucune idée ajoutée.');
});

test('bilanDuMessage : un plat décoché dans l’aperçu n’est pas compté', () => {
  const preparation = preparer(valider(idee('dal-coco', 'Dal coco'), idee('gratin-courge', 'Gratin de courge')));
  const bilan = bilanDuMessage(filtrerPreparation(preparation, new Set(['dal-coco'])));
  assert.deepEqual(bilan.ajoutes.map((p) => p.id), ['gratin-courge']);
  assert.deepEqual(bilan.nonRepris, []);
});

test('bilanDuMessage : un plat ⏳ complété par une idée compte ; versions et relectures jamais', () => {
  const preparation = preparer(valider(idee('dal-coco', 'Dal coco')), [{ id: 'dal-coco', nom: 'Dal coco' }]);
  assert.equal(preparation.elements[0].statut, 'complete');
  assert.deepEqual(bilanDuMessage(preparation).ajoutes, [{ id: 'dal-coco', nom: 'Dal coco' }]);
  const fausse = {
    elements: [{ id: 'a', nom: 'A', statut: 'versions' }, { id: 'b', nom: 'B', statut: 'relecture' }],
    ecritures: [{ id: 'a', mode: 'versions', variantes: [] }, { id: 'b', mode: 'precautions' }],
  };
  assert.deepEqual(bilanDuMessage(fausse), { ajoutes: [], autres: [], nonRepris: [] });
  assert.deepEqual(bilanDuMessage(null), { ajoutes: [], autres: [], nonRepris: [] });
});

test('dejaEnregistre : le même message recollé après l’enregistrement n’apporte rien', () => {
  const message = valider(idee('dal-coco', 'Dal coco'), idee('gratin-courge', 'Gratin de courge'));
  const premiere = preparer(message);
  assert.equal(dejaEnregistre(premiere), false);
  const plats = apres([], premiere);
  const recollee = preparer(message, plats);
  assert.deepEqual(recollee.elements.map((e) => e.statut), ['deja', 'deja']);
  const visite = premiere.ecritures.map((e) => e.id);
  assert.equal(dejaEnregistre(recollee, visite), true);
  // Le message suivant, lui, apporte du nouveau.
  const suite = preparer(valider(idee('tarte-poireau', 'Tarte aux poireaux'), idee('dal-coco', 'Dal coco')), plats);
  assert.equal(dejaEnregistre(suite, visite), false);
});

test('dejaEnregistre : un message jamais collé, fait seulement de plats que le foyer avait déjà, garde son aperçu', () => {
  const foyer = [platRempli('chili-doux', 'Chili doux'), platRempli('dal-coco', 'Dal coco')];
  const message1 = valider(idee('gratin-courge', 'Gratin de courge'), idee('tarte-poireau', 'Tarte aux poireaux'));
  const premiere = preparer(message1, foyer);
  const visite = premiere.ecritures.map((e) => e.id);
  const plats = apres(foyer, premiere);
  const message2 = preparer(valider(idee('chili-doux', 'Chili doux'), idee('dal-coco', 'Dal coco')), plats);
  assert.deepEqual(message2.elements.map((e) => e.statut), ['deja', 'deja']);
  assert.equal(dejaEnregistre(message2, visite), false);
  // Sans plats écrits pendant la visite, jamais.
  assert.equal(dejaEnregistre(preparer(message1, plats)), false);
  // Message 1 recollé, avec une idée du foyer d'avant : « déjà enregistré ».
  const avecFoyer = valider(idee('gratin-courge', 'Gratin de courge'), idee('chili-doux', 'Chili doux'));
  const premiereBis = preparer(avecFoyer, foyer);
  assert.equal(dejaEnregistre(preparer(avecFoyer, apres(foyer, premiereBis)), premiereBis.ecritures.map((e) => e.id)), true);
});

test('dejaEnregistre : une idée pour un plat de la corbeille qui a sa recette (rien à prendre) n’empêche pas « déjà enregistré »', () => {
  const jete = { ...platRempli('chili-doux', 'Chili doux'), corbeille: { le: 1, par: 'a@example.com' } };
  const message = valider(idee('gratin-courge', 'Gratin de courge'), idee('chili-doux', 'Chili doux'), idee('tarte-poireau', 'Tarte aux poireaux'));
  const premiere = preparer(message, [jete]);
  assert.deepEqual(premiere.elements.map((e) => `${e.statut}:${e.remettable ?? ''}`), ['nouveau:', 'corbeille:false', 'nouveau:']);
  assert.equal(bilanDuMessage(premiere).nonRepris[0].remettable, false);
  const recollee = preparer(message, apres([jete], premiere));
  assert.deepEqual(recollee.elements.map((e) => e.statut), ['deja', 'corbeille', 'deja']);
  assert.equal(dejaEnregistre(recollee, premiere.ecritures.map((e) => e.id)), true);
  // Plat ⏳ de la corbeille : remis, il prendrait la recette ; l'aperçu propose « Remettre », pas « déjà enregistré ».
  const jeteAttente = { id: 'chili-doux', nom: 'Chili doux', corbeille: { le: 1, par: 'a@example.com' } };
  const premiere2 = preparer(message, [jeteAttente]);
  assert.equal(premiere2.elements[1].remettable, true);
  assert.equal(bilanDuMessage(premiere2).nonRepris[0].remettable, true);
  const recollee2 = preparer(message, apres([jeteAttente], premiere2));
  assert.equal(dejaEnregistre(recollee2, premiere2.ecritures.map((e) => e.id)), false);
});

test('dejaEnregistre : un plat de la corbeille ou une demande à clore n’est pas « déjà enregistré »', () => {
  const jete = { ...platRempli('dal-coco', 'Dal coco'), corbeille: { le: 1, par: 'a@example.com' } };
  const preparation = preparer(valider(idee('dal-coco', 'Dal coco')), [jete]);
  assert.equal(preparation.elements[0].statut, 'corbeille');
  assert.equal(dejaEnregistre(preparation, ['dal-coco']), false);
  assert.equal(dejaEnregistre({ elements: [{ id: 'a', statut: 'identique' }], ecritures: [], demandesAClore: ['a__recette'] }, ['a']), false);
  assert.equal(dejaEnregistre({ elements: [{ id: 'a', statut: 'identique' }], ecritures: [], demandesAClore: [] }, ['a']), true);
  assert.equal(dejaEnregistre({ elements: [{ id: 'a', statut: 'identique' }], ecritures: [], demandesAClore: [] }, ['b']), false);
  assert.equal(dejaEnregistre({ elements: [], ecritures: [] }), false);
  assert.equal(dejaEnregistre(undefined), false);
});

// ——— etatSerie et texteSerie ———

test('etatSerie (idées) : compte de la visite sans doublon, total inconnu', () => {
  const etat = etatSerie({
    nature: 'idees',
    ajoutesDepuisOuverture: [{ id: 'a', nom: 'A' }, { id: 'b', nom: 'B' }, { id: 'a', nom: 'A' }, 'c'],
    dernier: [{ id: 'c', nom: 'C' }],
  });
  assert.deepEqual(etat, { nature: 'idees', faits: 3, dernier: [{ id: 'c', nom: 'C' }], autres: [], nonRepris: [], recolle: false, total: null });
  assert.deepEqual(etatSerie(), { nature: undefined, faits: 0, dernier: [], autres: [], nonRepris: [], recolle: false, total: null });
  // Idée non reprise : identifiant et `remettable` gardés (« Remettre » de la carte).
  assert.deepEqual(etatSerie({ nature: 'idees', nonRepris: [{ id: 'x', nom: 'X', raison: 'r', remettable: true }, { nom: 'Y' }] }).nonRepris, [
    { id: 'x', nom: 'X', raison: 'r', remettable: true },
    { id: null, nom: 'Y', raison: '', remettable: false },
  ]);
});

test('texteSerie (idées) : premier message, puis messages suivants avec le compte de la visite', () => {
  const premier = texteSerie(etatSerie({
    nature: 'idees',
    ajoutesDepuisOuverture: ['a', 'b', 'c'].map((id) => ({ id, nom: id.toUpperCase() })),
    dernier: ['a', 'b', 'c'].map((id) => ({ id, nom: id.toUpperCase() })),
  }));
  assert.deepEqual(premier, {
    titre: '✓ 3\u00A0idées ajoutées',
    noms: ['A', 'B', 'C'],
    autres: [],
    nonRepris: [],
    depuis: null,
    restants: null,
    aide: 'Écrivez «\u00A0suite\u00A0» à Claude, copiez toute sa réponse, puis touchez «\u00A0Coller la suite\u00A0».',
    conseil: null,
  });
  const second = texteSerie(etatSerie({
    nature: 'idees',
    ajoutesDepuisOuverture: ['a', 'b', 'c', 'd', 'e', 'f'],
    dernier: [{ id: 'd', nom: 'D' }, { id: 'e', nom: 'E' }, { id: 'f', nom: 'F' }],
  }));
  assert.equal(second.titre, '✓ 3\u00A0idées ajoutées');
  assert.equal(second.depuis, '6\u00A0depuis l’ouverture de cet écran.');
  const une = texteSerie(etatSerie({ nature: 'idees', ajoutesDepuisOuverture: ['a', 'b'], dernier: [{ id: 'b', nom: 'B' }] }));
  assert.equal(une.titre, '✓ 1\u00A0idée ajoutée');
  assert.equal(une.depuis, '2\u00A0depuis l’ouverture de cet écran.');
});

test('texteSerie (idées) : idée non reprise avec la raison de l’aperçu, sinon une phrase de repli', () => {
  const textes = texteSerie(etatSerie({
    nature: 'idees',
    ajoutesDepuisOuverture: ['a'],
    dernier: [{ id: 'a', nom: 'A' }],
    nonRepris: [{ nom: 'Chili doux', raison: '«\u00A0Chili doux\u00A0» est déjà dans vos plats\u00A0: cette idée n’est pas reprise.' }, { nom: 'Soupe' }],
  }));
  assert.deepEqual(textes.nonRepris, [
    '«\u00A0Chili doux\u00A0» est déjà dans vos plats\u00A0: cette idée n’est pas reprise.',
    '«\u00A0Soupe\u00A0» n’est pas repris.',
  ]);
});

test('texteSerie : message recollé, sans noms, l’aide remplacée', () => {
  const textes = texteSerie(etatSerie({ nature: 'idees', ajoutesDepuisOuverture: ['a', 'b', 'c'], recolle: true }));
  assert.equal(textes.titre, 'Ce message est déjà enregistré.');
  assert.equal(`${textes.titre} ${textes.aide}`, 'Ce message est déjà enregistré. Écrivez «\u00A0suite\u00A0» à Claude pour le suivant.');
  assert.deepEqual(textes.noms, []);
  assert.equal(textes.depuis, '3\u00A0depuis l’ouverture de cet écran.');
});

test('etatSerie et texteSerie (étapes, T5-0b) : restants lus dans la base, fin, conseil après 5 réponses', () => {
  const plats = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const etat = etatSerie({ nature: 'etapes', ajoutesDepuisOuverture: ['a', 'b', 'c'], dernier: ['a', 'b', 'c'], aDetailler: plats(38), reponses: 1 });
  assert.equal(etat.restants, 38);
  assert.equal(etat.conseil, false);
  const textes = texteSerie({ ...etat, dernier: [{ id: 'a', nom: 'Gratin' }, { id: 'b', nom: 'Carbonade' }, { id: 'c', nom: 'Curry' }], nonRepris: [{ nom: 'Velouté' }] });
  assert.equal(textes.titre, '✓ 3\u00A0recettes détaillées');
  assert.equal(textes.restants, 'Encore 38\u00A0recettes à détailler.');
  assert.deepEqual(textes.nonRepris, ['«\u00A0Velouté\u00A0» n’a pas été repris\u00A0: il restera à détailler.']);
  assert.equal(CONSEIL_NOUVELLE_CONVERSATION, 5);
  const long = etatSerie({ nature: 'etapes', aDetailler: plats(2), reponses: 5 });
  assert.equal(long.conseil, true);
  assert.equal(texteSerie(long).conseil, TEXTES_SERIE.conseil);
  const fin = texteSerie(etatSerie({ nature: 'etapes', dernier: ['a'], aDetailler: [], reponses: 6 }));
  assert.equal(fin.restants, '✓ Toutes vos recettes sont détaillées 🎉');
  assert.equal(fin.aide, null);
  assert.equal(fin.conseil, null);
  assert.equal(etatSerie({ nature: 'etapes', aDetailler: 4 }).restants, 4);
});

test('textes de la série : jamais d’espace insécable littérale, apostrophes typographiques', () => {
  const tous = JSON.stringify(TEXTES_SERIE);
  assert.doesNotMatch(tous, /'/);
  assert.equal(TEXTES_SERIE.collerLaSuite, '📋 Coller la suite');
  assert.equal(TEXTES_SERIE.voirLesPlats, 'Voir les plats ›');
  assert.equal(TEXTES_SERIE.zone, 'Collez la réponse ici');
});
