// « Ma cuisine » (2026-10-20) : objets connus, reconnaissance dans les recettes, états, alertes, écran, écritures et
// lignes des demandes à Claude. Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJETS, PLATS_ET_MOULES_MAX, PLAT_ET_MOULE_MAX, aLObjet, ajoutPlatEtMoule, alerteDuPlat, annonceReponse,
  appareilsActifs, appareilsDuFoyer, cheminCuisineSur, cuisineReglee, ecrituresObjet, etatObjet, libellesReponse,
  lignesCuisine, lignesMaCuisine, lireCuisine, lirePlatsEtMoules, manqueUnObjet, nomsPourClaude, objetDAppareil,
  objetDUstensile, objetsDUstensile, objetsDuPlat, recettesParObjet, remplacantADemander, retraitPlatEtMoule,
  texteManquants, textePour, texteQuestion,
} from '../js/coeur/ma-cuisine.js';
import { EFFACER } from '../js/coeur/semaine.js';
import { texteDemandeEtapes, texteDemandeIdees, texteDemandeRecette, appareilsActifs as appareilsDeClaude } from '../js/coeur/claude.js';
import { texteDemandeBatch } from '../js/coeur/plan-batch.js';

const ING = [{ produit: 'crème liquide', qte: 20, unite: 'cl', rayon: 'cremerie', marqueurs: ['laitier'] }];

// Réalisations à jour : `etapes` = leurs titres (realisation.js › realisationAJour).
const CHEESECAKE = {
  id: 'cheesecake', nom: 'Cheesecake', type: 'dessert', portionsBase: 8, ingredients: ING, etapes: ['Foncer le moule', 'Cuire'],
  cuisson: [{ appareil: 'four', tempC: 160, dureeMin: 50 }],
  realisation: [
    { titre: 'Foncer le moule', texte: '…', duree: 5, ustensiles: ['grand moule à charnière', 'saladier'] },
    { titre: 'Cuire', texte: '…', duree: 50, appareil: 'four', tempC: 160, ustensiles: ['Moule à charnière'] },
  ],
};
const VELOUTE = {
  id: 'veloute', nom: 'Velouté de courge', portionsBase: 4, ingredients: ING, etapes: ['Cuire', 'Mixer'],
  cuisson: [{ appareil: 'cookeo', dureeMin: 15 }],
  realisation: [
    { titre: 'Cuire', texte: '…', duree: 15, appareil: 'cookeo', ustensiles: ['cuve du Cookeo'] },
    { titre: 'Mixer', texte: '…', duree: 3, ustensiles: ['mixeur plongeant', 'louche'] },
  ],
};
const BRIOCHE = {
  id: 'brioche', nom: 'Brioche', type: 'dessert', portionsBase: 8, ingredients: ING, etapes: ['Pétrir'],
  realisation: [{ titre: 'Pétrir', texte: '…', duree: 10, ustensiles: ['robot pâtissier'] }],
};
const GRATIN = {
  id: 'gratin', nom: 'Gratin', portionsBase: 4, ingredients: ING, etapes: ['Gratiner'],
  cuisson: [{ appareil: 'four', tempC: 200, dureeMin: 30 }],
  realisation: [{ titre: 'Gratiner', texte: '…', duree: 30, appareil: 'four', ustensiles: ['plat à gratin', 'plaque de four'] }],
};
const ATTENTE = { id: 'tarte', nom: 'Tarte', realisation: [{ titre: 'x', ustensiles: ['siphon'] }] };

test('les identifiants des objets sont figés et sûrs pour un chemin Firestore', () => {
  assert.deepEqual(OBJETS.map((o) => o.id), [
    'plaque', 'four', 'cookeo', 'airfryer', 'monsieur-cuisine',
    'mixeur-plongeant', 'blender', 'robot', 'robot-patissier', 'batteur-electrique', 'cuiseur-vapeur', 'autocuiseur',
    'friteuse', 'plancha', 'appareil-a-raclette', 'service-a-fondue', 'gaufrier', 'sorbetiere', 'yaourtiere',
    'machine-a-pain', 'extracteur-de-jus',
    'mandoline', 'siphon', 'chalumeau', 'poche-a-douille', 'thermometre', 'mortier', 'moule-a-charniere', 'moule-a-cake',
    'moule-a-tarte', 'moule-a-muffins', 'cercle-a-patisserie', 'emporte-pieces', 'ramequins', 'cocotte-en-fonte',
  ]);
  for (const objet of OBJETS) {
    assert.match(objet.id, /^[a-z0-9-]+$/);
    assert.ok(['un', 'une', 'des'].includes(objet.article), objet.id);
    for (const autre of objet.remplacePar) assert.ok(OBJETS.some((o) => o.id === autre), `${objet.id} → ${autre}`);
  }
});

test('reconnaissance d’un ustensile : le nom le plus long, jamais un ustensile courant', () => {
  assert.equal(objetDUstensile('grand moule à charnière'), 'moule-a-charniere');
  assert.equal(objetDUstensile('Moules à charnière'), 'moule-a-charniere');
  assert.equal(objetDUstensile('robot pâtissier'), 'robot-patissier');
  assert.equal(objetDUstensile('robot'), 'robot');
  assert.equal(objetDUstensile('mixeur'), 'mixeur-plongeant');
  assert.equal(objetDUstensile('mixeur blender'), 'blender');
  assert.equal(objetDUstensile('cocotte-minute'), 'autocuiseur');
  assert.equal(objetDUstensile('Emporte-pièce'), 'emporte-pieces');
  assert.equal(objetDUstensile('ramequins'), 'ramequins');
  for (const courant of ['moule', 'plaque de four', 'plat à gratin', 'cocotte', 'casserole', 'saladier', 'poêle', 'fouet', 'balance', '']) {
    assert.equal(objetDUstensile(courant), null, courant);
  }
  // Relecture : l'airfryer sous ses autres noms, le blender par son bol, le pilon à purée n'est pas un mortier.
  assert.equal(objetDUstensile('friteuse sans huile'), 'airfryer');
  assert.equal(objetDUstensile('Friteuse à air'), 'airfryer');
  assert.equal(objetDUstensile('friteuse'), 'friteuse');
  assert.equal(objetDUstensile('bol du mixeur'), 'blender');
  assert.equal(objetDUstensile('robot cuiseur'), 'monsieur-cuisine');
  assert.equal(objetDUstensile('pilon à purée'), null);
  assert.equal(objetDUstensile('mortier et pilon'), 'mortier');
  assert.equal(objetDUstensile('plaque de cuisson'), null, 'un appareil de cuisson se lit par son code, jamais par son nom');
  // Au choix : un objet seulement si chaque possibilité en est un.
  assert.equal(objetDUstensile('mixeur plongeant ou presse-purée'), null);
  assert.equal(objetDUstensile('robot pâtissier (ou batteur électrique)'), 'robot-patissier');
  assert.equal(objetDUstensile('cocotte en fonte / faitout'), null);
  // Relecture : toutes les possibilités, dans l'ordre ; une barre sans espaces est une taille.
  assert.deepEqual(objetsDUstensile('robot pâtissier ou batteur électrique'), ['robot-patissier', 'batteur-electrique']);
  assert.deepEqual(objetsDUstensile('moule à charnière 24/26 cm'), ['moule-a-charniere']);
  assert.equal(objetsDUstensile('saladier'), null);
  assert.equal(objetDAppareil('cookeo'), 'cookeo');
  assert.equal(objetDAppareil('monsieur_cuisine'), 'monsieur-cuisine');
  assert.equal(objetDAppareil('micro_ondes'), null);
});

test('objets d’une recette : appareils puis ustensiles, chacun une fois ; rien sans recette', () => {
  assert.deepEqual(objetsDuPlat(CHEESECAKE), ['four', 'moule-a-charniere']);
  assert.deepEqual(objetsDuPlat(VELOUTE), ['cookeo', 'mixeur-plongeant']);
  assert.deepEqual(objetsDuPlat(GRATIN), ['four']);
  assert.deepEqual(objetsDuPlat(ATTENTE), []);
  assert.equal(objetsDuPlat(CHEESECAKE), objetsDuPlat(CHEESECAKE), 'même tableau pour la même fiche');
  // Réalisation périmée (étapes changées par une app d'avant) : seulement la cuisson.
  assert.deepEqual(objetsDuPlat({ ...CHEESECAKE, etapes: ['Autre chose'] }), ['four']);
  // Étape « le jour du repas » : un objet seulement pratique n'y compte pas.
  const servi = { ...GRATIN, etapes: ['Gratiner', 'Servir'], realisation: [...GRATIN.realisation, { titre: 'Servir', texte: '…', duree: 2, auService: true, ustensiles: ['ramequins'] }] };
  assert.deepEqual(objetsDuPlat(servi), ['four']);
});

test('états : deux réponses, appareils de départ tant que rien n’est dit', () => {
  assert.equal(etatObjet('siphon', {}), null);
  assert.equal(etatObjet('siphon', { cuisine: { siphon: true } }), 'oui');
  assert.equal(etatObjet('siphon', { cuisine: { siphon: false } }), 'non');
  assert.equal(etatObjet('siphon', { cuisine: { siphon: 'oui' } }), null, 'valeur illisible');
  assert.equal(etatObjet('cookeo', {}), 'oui');
  assert.equal(etatObjet('monsieur-cuisine', {}), null);
  assert.equal(etatObjet('cookeo', { appareils: ['plaque', 'four'] }), null);
  assert.equal(etatObjet('cookeo', { cuisine: { cookeo: false } }), 'non');
  assert.equal(etatObjet('inconnu', {}), null);
  assert.deepEqual([...lireCuisine({ cuisine: { siphon: true, inconnu: true, four: false, x: 1 } })], [['four', false], ['siphon', true]]);
});

test('un objet qui en remplace un autre suffit', () => {
  const reglages = { cuisine: { 'mixeur-plongeant': false, blender: true } };
  assert.equal(aLObjet('mixeur-plongeant', reglages), true);
  assert.equal(alerteDuPlat(VELOUTE, reglages), null);
  assert.equal(manqueUnObjet(VELOUTE, reglages), false);
  assert.equal(aLObjet('mixeur-plongeant', { cuisine: { 'mixeur-plongeant': false } }), false);
  assert.equal(aLObjet('autocuiseur', {}), true, 'le Cookeo de départ remplace la cocotte-minute');
});

test('alerte d’une recette : question pour ce qui n’est pas dit, manquants pour ce qui est absent', () => {
  assert.deepEqual(alerteDuPlat(CHEESECAKE, {}), { manquants: [], question: 'moule-a-charniere', pour: null });
  assert.equal(alerteDuPlat(CHEESECAKE, { cuisine: { 'moule-a-charniere': true } }), null);
  assert.deepEqual(alerteDuPlat(CHEESECAKE, { cuisine: { 'moule-a-charniere': false } }), { manquants: ['moule-a-charniere'], question: null, pour: null });
  assert.deepEqual(alerteDuPlat(VELOUTE, { cuisine: { cookeo: false } }), { manquants: ['cookeo'], question: 'mixeur-plongeant', pour: null });
  // Mixeur dit absent : on demande ses remplaçants pas encore dits, un à un ; la recette reste proposée d'ici là.
  assert.deepEqual(alerteDuPlat(VELOUTE, { cuisine: { 'mixeur-plongeant': false } }), { manquants: [], question: 'blender', pour: 'mixeur-plongeant' });
  assert.equal(manqueUnObjet(VELOUTE, { cuisine: { 'mixeur-plongeant': false } }), false);
  assert.deepEqual(alerteDuPlat(VELOUTE, { cuisine: { 'mixeur-plongeant': false, blender: false, robot: false } }),
    { manquants: [], question: 'monsieur-cuisine', pour: 'mixeur-plongeant' });
  const sansRien = { cuisine: { 'mixeur-plongeant': false, blender: false, robot: false, 'monsieur-cuisine': false } };
  assert.deepEqual(alerteDuPlat(VELOUTE, sansRien), { manquants: ['mixeur-plongeant'], question: null, pour: null });
  assert.equal(manqueUnObjet(VELOUTE, sansRien), true);
  // Un moule de « Mes plats et moules » compte comme « Je l'ai » tant que rien n'est dit.
  assert.equal(alerteDuPlat(CHEESECAKE, { platsEtMoules: { 'moule-a-charniere-24-cm': 'Moule à charnière 24 cm' } }), null);
  assert.equal(alerteDuPlat(GRATIN, {}), null);
  assert.equal(manqueUnObjet(CHEESECAKE, {}), false, 'pas encore dit : la recette reste proposée');
  assert.equal(manqueUnObjet(CHEESECAKE, { cuisine: { 'moule-a-charniere': false } }), true);
  assert.equal(manqueUnObjet(GRATIN, { cuisine: { four: false } }), true);
});

test('ustensile au choix : une seule possibilité suffit, quel que soit son rang', () => {
  const BRIOCHE_AU_CHOIX = {
    id: 'brioche-choix', nom: 'Brioche au choix', type: 'dessert', portionsBase: 8, ingredients: ING, etapes: ['Pétrir'],
    cuisson: [{ appareil: 'four', tempC: 180, dureeMin: 30 }],
    realisation: [{ titre: 'Pétrir', texte: '…', duree: 10, ustensiles: ['robot pâtissier ou batteur électrique'] }],
  };
  const four = { four: true };
  assert.equal(alerteDuPlat(BRIOCHE_AU_CHOIX, { cuisine: { ...four, 'batteur-electrique': true } }), null, 'la seconde possibilité suffit');
  assert.equal(manqueUnObjet(BRIOCHE_AU_CHOIX, { cuisine: { ...four, 'robot-patissier': false, 'batteur-electrique': true } }), false);
  // La première dite absente : la suivante est demandée.
  const alerte = alerteDuPlat(BRIOCHE_AU_CHOIX, { cuisine: { ...four, 'robot-patissier': false } });
  assert.equal(alerte?.question, 'batteur-electrique');
  assert.equal(alerte?.pour, 'robot-patissier');
  // Puis ce qui remplacerait le robot pâtissier (Monsieur Cuisine), et seulement ensuite il manque.
  assert.equal(manqueUnObjet(BRIOCHE_AU_CHOIX, { cuisine: { ...four, 'robot-patissier': false, 'batteur-electrique': false } }), false);
  const sansRien = { ...four, 'robot-patissier': false, 'batteur-electrique': false, 'monsieur-cuisine': false };
  assert.equal(manqueUnObjet(BRIOCHE_AU_CHOIX, { cuisine: sansRien }), true);
  // Demandé seul ailleurs dans la recette : plus de choix pour lui.
  const SEUL = { ...BRIOCHE_AU_CHOIX, id: 'seul', realisation: [...BRIOCHE_AU_CHOIX.realisation, { titre: 'Fouetter', texte: '…', duree: 5, ustensiles: ['robot pâtissier'] }], etapes: ['Pétrir', 'Fouetter'] };
  assert.equal(manqueUnObjet(SEUL, { cuisine: { ...sansRien, 'batteur-electrique': true } }), true);
  assert.equal(manqueUnObjet(BRIOCHE_AU_CHOIX, { cuisine: { ...sansRien, 'batteur-electrique': true } }), false);
});

test('textes : question, réponses, manquants, annonces', () => {
  assert.equal(texteQuestion('siphon'), 'Il faut un siphon. Vous l’avez\u202F?');
  assert.equal(texteQuestion('mandoline'), 'Il faut une mandoline. Vous l’avez\u202F?');
  assert.equal(texteQuestion('ramequins'), 'Il faut des ramequins. Vous les avez\u202F?');
  assert.equal(texteQuestion('cookeo'), 'Il faut un Cookeo. Vous l’avez\u202F?');
  assert.equal(texteQuestion('blender', 'mixeur-plongeant'), 'Pas de mixeur plongeant. Vous avez un blender\u202F?');
  assert.equal(texteQuestion('mixeur-plongeant', 'airfryer'), 'Pas d’airfryer. Vous avez un mixeur plongeant\u202F?');
  assert.equal(annonceReponse('yaourtiere', false), 'C’est noté\u00A0: pas de yaourtière. L’app ne proposera plus les plats qui en demandent.');
  assert.deepEqual(libellesReponse('siphon'), { oui: 'Je l’ai', non: 'Je ne l’ai pas' });
  assert.deepEqual(libellesReponse('ramequins'), { oui: 'Je les ai', non: 'Je ne les ai pas' });
  assert.equal(texteManquants(['siphon']), 'Il faut un siphon\u00A0: vous n’en avez pas.');
  assert.equal(texteManquants(['siphon', 'mandoline'], { changer: true }),
    'Il faut un siphon et une mandoline\u00A0: vous n’en avez pas. Touchez le plat pour en choisir un autre.');
  assert.equal(texteManquants([]), '');
  assert.equal(annonceReponse('siphon', true), 'C’est noté\u00A0: siphon dans Ma cuisine.');
  assert.equal(annonceReponse('airfryer', false), 'C’est noté\u00A0: pas d’airfryer. L’app ne proposera plus les plats qui en demandent.');
  // Un objet qui le remplacerait reste à demander : rien n'est encore écarté, l'annonce ne le promet pas.
  assert.equal(annonceReponse('mixeur-plongeant', false, { remplacant: true }), 'C’est noté\u00A0: pas de mixeur plongeant.');
  assert.equal(remplacantADemander('mixeur-plongeant', {}), true);
  assert.equal(remplacantADemander('mixeur-plongeant', { cuisine: { blender: false, robot: false, 'monsieur-cuisine': false } }), false);
  assert.equal(remplacantADemander('siphon', {}), false);
  assert.equal(textePour(['A', 'B']), 'Pour\u00A0: A et B');
  assert.equal(textePour(['A', 'B', 'C', 'D', 'E']), 'Pour\u00A0: A, B, C et 2\u00A0autres');
  assert.equal(textePour([]), '');
});

test('écran : recettes par objet, sections', () => {
  const plats = [CHEESECAKE, VELOUTE, BRIOCHE, GRATIN, ATTENTE, { ...BRIOCHE, id: 'b2', nom: 'Vieille brioche', corbeille: { le: 1, par: 'x' } }];
  const parObjet = recettesParObjet(plats);
  assert.deepEqual(parObjet.get('four'), ['Cheesecake', 'Gratin']);
  assert.deepEqual(parObjet.get('robot-patissier'), ['Brioche']);
  assert.equal(recettesParObjet(plats), parObjet);
  const lignes = lignesMaCuisine({ cuisine: { siphon: false } }, plats);
  assert.deepEqual(lignes.demandes.map((l) => l.id), ['mixeur-plongeant', 'moule-a-charniere', 'robot-patissier']);
  assert.deepEqual(lignes.cuire.map((l) => [l.id, l.etat]), [['plaque', 'oui'], ['four', 'oui'], ['cookeo', 'oui'], ['airfryer', 'oui'], ['monsieur-cuisine', null]]);
  assert.ok(lignes.autres.some((l) => l.id === 'siphon' && l.etat === 'non'));
  assert.ok(!lignes.autres.some((l) => l.id === 'mixeur-plongeant'));
  assert.equal(lignes.autres.find((l) => l.id === 'ramequins').pluriel, true);
});

test('plats et moules : lecture, ajout, retrait', () => {
  const reglages = { platsEtMoules: { 'plat-a-gratin-30-x-20-cm': 'Plat à gratin 30 × 20 cm', 'cocotte-5-l': 'Cocotte 5 l', 'MAL': 'x', vide: '  ' } };
  assert.deepEqual(lirePlatsEtMoules(reglages), [
    { id: 'cocotte-5-l', nom: 'Cocotte 5 l' }, { id: 'plat-a-gratin-30-x-20-cm', nom: 'Plat à gratin 30 × 20 cm' },
  ]);
  assert.deepEqual(ajoutPlatEtMoule('  Moule à cake  22 cm ', reglages), {
    id: 'moule-a-cake-22-cm', nom: 'Moule à cake 22 cm',
    champs: { 'platsEtMoules.moule-a-cake-22-cm': 'Moule à cake 22 cm', 'cuisine.moule-a-cake': true },
  });
  assert.match(ajoutPlatEtMoule('cocotte 5 L', reglages).erreur, /déjà dans la liste/);
  assert.equal(ajoutPlatEtMoule('  ', reglages).erreur, 'Écrivez le nom d’un plat ou d’un moule.');
  assert.match(ajoutPlatEtMoule('x'.repeat(PLAT_ET_MOULE_MAX + 1), reglages).erreur, /au plus/);
  const plein = { platsEtMoules: Object.fromEntries(Array.from({ length: PLATS_ET_MOULES_MAX }, (_, i) => [`p${i}`, `P${i}`])) };
  assert.match(ajoutPlatEtMoule('Encore un', plein).erreur, /retirez-en un/);
  // Au-delà (deux téléphones en même temps) : tous restent lisibles.
  const trop = { platsEtMoules: Object.fromEntries(Array.from({ length: PLATS_ET_MOULES_MAX + 2 }, (_, i) => [`p${i}`, `P${i}`])) };
  assert.equal(lirePlatsEtMoules(trop).length, PLATS_ET_MOULES_MAX + 2);
  // Un nom qui désigne un objet connu dit aussi « Je l'ai », dans le même lot (sauf s'il l'était déjà).
  assert.deepEqual(ajoutPlatEtMoule('Moule à charnière 24 cm', { cuisine: { 'moule-a-charniere': false } }).champs,
    { 'platsEtMoules.moule-a-charniere-24-cm': 'Moule à charnière 24 cm', 'cuisine.moule-a-charniere': true });
  assert.deepEqual(ajoutPlatEtMoule('Moule à charnière 24 cm', { cuisine: { 'moule-a-charniere': true } }).champs,
    { 'platsEtMoules.moule-a-charniere-24-cm': 'Moule à charnière 24 cm' });
  assert.deepEqual(retraitPlatEtMoule('cocotte-5-l'), { 'platsEtMoules.cocotte-5-l': EFFACER });
  assert.equal(retraitPlatEtMoule('Mal Écrit'), null);
});

test('écritures et garde des chemins', () => {
  assert.deepEqual(ecrituresObjet('siphon', true), { 'cuisine.siphon': true });
  assert.deepEqual(ecrituresObjet('four', false), { 'cuisine.four': false });
  assert.deepEqual(ecrituresObjet('siphon', null), { 'cuisine.siphon': EFFACER });
  assert.equal(ecrituresObjet('inconnu', true), null);
  assert.equal(ecrituresObjet('siphon', 'oui'), null);
  assert.equal(cheminCuisineSur('cuisine.siphon', true), true);
  assert.equal(cheminCuisineSur('cuisine.siphon', EFFACER), true);
  assert.equal(cheminCuisineSur('cuisine.siphon', 'oui'), false);
  assert.equal(cheminCuisineSur('cuisine.inconnu', true), false);
  assert.equal(cheminCuisineSur('cuisine', {}), false);
  assert.equal(cheminCuisineSur('platsEtMoules.cocotte-5-l', 'Cocotte 5 l'), true);
  assert.equal(cheminCuisineSur('platsEtMoules.cocotte-5-l', 'Autre chose'), false);
  assert.equal(cheminCuisineSur('platsEtMoules.cocotte-5-l', ' Cocotte 5 l'), false);
  assert.equal(cheminCuisineSur('platsEtMoules.cocotte-5-l', EFFACER), true);
  assert.equal(cheminCuisineSur('drive', {}), false);
  assert.equal(cheminCuisineSur('cuisine.siphon.x', true), false);
});

test('appareils du foyer : réponses d’abord, sinon les appareils de départ', () => {
  assert.deepEqual(appareilsActifs(null), ['plaque', 'four', 'cookeo', 'airfryer']);
  assert.equal(appareilsDeClaude, appareilsActifs, 'claude.js réexporte la même fonction');
  assert.deepEqual(appareilsDuFoyer({}), ['plaque', 'four', 'cookeo', 'airfryer']);
  assert.deepEqual(appareilsDuFoyer({ cuisine: { airfryer: false, 'monsieur-cuisine': true } }), ['plaque', 'four', 'cookeo', 'monsieur_cuisine']);
  assert.deepEqual(appareilsDuFoyer({ cuisine: { plaque: false, four: false, cookeo: false, airfryer: false } }), [],
    'tous dits absents : aucun (jamais à la fois dans `appareils:` et `pas de:`)');
});

test('lignes pour Claude : seulement ce qui est dit', () => {
  assert.equal(cuisineReglee({}), false);
  assert.deepEqual(lignesCuisine({}), []);
  const reglages = {
    cuisine: { siphon: true, 'mixeur-plongeant': true, airfryer: false, mandoline: false },
    platsEtMoules: { 'plat-a-gratin-30-x-20-cm': 'Plat à gratin 30 × 20 cm', 'cocotte-5-l': 'Cocotte 5 l' },
  };
  assert.equal(cuisineReglee(reglages), true);
  assert.equal(cuisineReglee({ platsEtMoules: { a: 'A' } }), true);
  assert.deepEqual(lignesCuisine(reglages), [
    'dans la cuisine: mixeur plongeant, siphon',
    'pas de: airfryer, mandoline',
    'plats et moules: Cocotte 5 l ; Plat à gratin 30 × 20 cm',
  ]);
  assert.ok(nomsPourClaude().includes('moule à charnière'));
  assert.ok(!nomsPourClaude().includes('four'));
});

test('demandes à Claude : lignes de la cuisine après `appareils:`, rien de plus tant que rien n’est dit', () => {
  const reglages = { cuisine: { siphon: true, cookeo: false }, platsEtMoules: { 'cocotte-5-l': 'Cocotte 5 l' } };
  const plat = { id: 'tarte', nom: 'Tarte' };
  assert.equal(texteDemandeRecette(plat, {}), texteDemandeRecette(plat, { reglages: {} }));
  assert.ok(!texteDemandeRecette(plat, { reglages: {} }).includes('appareils:'));
  const recette = texteDemandeRecette(plat, { reglages, demande: { id: 'tarte__recette', statut: 'ouverte', facon: ' avec des lardons,\n au Cookeo ' } }).split('\n');
  assert.deepEqual(recette.slice(2, 8), [
    'id: tarte', 'nom: Tarte', 'notre façon: avec des lardons, au Cookeo', 'appareils: plaque, four, airfryer',
    'dans la cuisine: siphon', 'pas de: cookeo',
  ]);
  assert.equal(recette[8], 'plats et moules: Cocotte 5 l');
  const idees = texteDemandeIdees({ reglages }).split('\n');
  const i = idees.indexOf('appareils: plaque, four, airfryer');
  assert.ok(i > 0);
  assert.deepEqual(idees.slice(i + 1, i + 4), ['dans la cuisine: siphon', 'pas de: cookeo', 'plats et moules: Cocotte 5 l']);
  assert.equal(texteDemandeIdees({ appareils: ['plaque', 'four'] }), texteDemandeIdees({ appareils: ['plaque', 'four'], reglages: null }));
  const etapes = texteDemandeEtapes([GRATIN], { reglages }).split('\n');
  assert.deepEqual(etapes.slice(2, 6), ['appareils: plaque, four, airfryer', 'dans la cuisine: siphon', 'pas de: cookeo', 'plats et moules: Cocotte 5 l']);
  assert.ok(texteDemandeEtapes([GRATIN], { reglages: {} }).split('\n')[3].startsWith('('), 'sans réglage : la consigne suit');
  const batch = texteDemandeBatch([], { reglages }).split('\n');
  assert.deepEqual(batch.slice(4, 8), ['appareils: plaque, four, airfryer', 'dans la cuisine: siphon', 'pas de: cookeo', 'plats et moules: Cocotte 5 l']);
});
