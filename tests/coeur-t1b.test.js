import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extrairePaquet, validerPaquet, preparerImport, texteDemandeRecette, texteCorrectionPourClaude, code, PLATS_MAX,
} from '../js/coeur/paquet.js';
import { lireHash, resoudreRoute, parametreDe } from '../js/coeur/roles.js';

// ——— Fixtures génériques (aucune donnée du foyer) ———

const RISOTTO = {
  id: 'risotto-test',
  nom: 'Risotto test',
  type: 'plat',
  recurrence: 'aucune',
  statutRecette: 'brouillon',
  portionsBase: 6,
  ingredients: [
    { produit: 'riz arborio', qte: 450, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'pavé de saumon', qte: 600, unite: 'g', rayon: 'poissonnerie', marqueurs: ['poisson'] },
    { produit: 'oignon jaune', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    { produit: "gousse d'ail", qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
    { produit: "huile d'olive", qte: 2, unite: 'cs', rayon: 'epicerie_salee', marqueurs: [] },
    { produit: 'vin blanc sec', qte: 10, unite: 'cl', rayon: 'boissons', marqueurs: [] },
    { produit: 'beurre', qte: 30, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] },
    { produit: 'aneth', qte: 0.5, unite: 'botte', rayon: 'fruits_legumes', marqueurs: [] },
  ],
  etapes: ['Faire revenir l’oignon.', 'Ajouter le riz.', 'Cuire sous pression.'],
  cuisson: [{ appareil: 'cookeo', mode: 'dorer puis cuisson sous pression', dureeMin: 15 }],
  tempsActifMin: 15,
  conservation: { frigoJours: 2, congelable: false },
  emporter: false,
  variantes: [],
  source: 'Version classique',
};

const paquet = (...plats) => ({ format: 'paquet@1', plats });
const bloc = (objet) => `\`\`\`json\n${JSON.stringify(objet, null, 2)}\n\`\`\``;

// Même forme que les réponses réelles du projet Claude : résumé, puces, hypothèses, puis bloc de code.
const PROSE = `Résumé : risotto crémeux au saumon, 6 portions, ~15 min de travail.

* \`profil-a\` ✅ : poisson présent.
* \`profil-b\` ✅ : bouillon de légumes.

Hypothèses à corriger si besoin :

* \`emporter: false\` : se réchauffe mal.
* Vin blanc facultatif.

`;

const PROFILS = [{ id: 'profil-a', nom: 'Adulte A' }, { id: 'profil-b', nom: 'Adulte B' }];

/** Aucune valeur undefined, à aucune profondeur (le vrai Firestore les refuse). */
function sansUndefined(valeur, chemin = 'racine') {
  if (valeur === undefined) assert.fail(`undefined à ${chemin}`);
  if (Array.isArray(valeur)) valeur.forEach((v, i) => sansUndefined(v, `${chemin}[${i}]`));
  else if (valeur && typeof valeur === 'object') for (const [cle, v] of Object.entries(valeur)) sansUndefined(v, `${chemin}.${cle}`);
}

const INTERDITS = /paquet|slug|json|\bIA\b/i;

// ——— Extraction ———

test('extrairePaquet : réponse complète (prose puis bloc de code)', () => {
  const { paquets } = extrairePaquet(PROSE + bloc(paquet(RISOTTO)));
  assert.equal(paquets.length, 1);
  assert.equal(paquets[0].plats[0].id, 'risotto-test');
});

test('extrairePaquet : bloc seul, texte brut, accolades dans la prose', () => {
  assert.equal(extrairePaquet(JSON.stringify(paquet(RISOTTO))).paquets.length, 1);
  assert.equal(extrairePaquet(`Le modèle {q} ne gêne pas.\n${bloc(paquet(RISOTTO))}`).paquets.length, 1);
});

test('extrairePaquet : deux blocs dans la même réponse', () => {
  const autre = { ...RISOTTO, id: 'autre-plat', nom: 'Autre plat' };
  const { paquets } = extrairePaquet(`${PROSE}${bloc(paquet(RISOTTO))}\n\nEt la suivante :\n${bloc(paquet(autre))}`);
  assert.equal(paquets.length, 2);
  assert.deepEqual(paquets.map((p) => p.plats[0].id), ['risotto-test', 'autre-plat']);
});

test('extrairePaquet : espaces insécables et guillemets courbes', () => {
  const insecables = JSON.stringify(paquet(RISOTTO), null, 2).replace(/\n {2}/g, '\n\u00A0\u00A0');
  assert.equal(extrairePaquet(insecables).paquets.length, 1);
  const courbes = JSON.stringify(paquet({ id: 'plat-x', nom: 'Plat X' })).replace(/"([^"]*)"/g, '“$1”');
  assert.equal(extrairePaquet(courbes).paquets[0].plats[0].id, 'plat-x');
});

test('extrairePaquet : codes d’erreur distincts', () => {
  assert.equal(extrairePaquet('').erreur, 'vide');
  assert.equal(extrairePaquet('   \n ').erreur, 'vide');
  assert.equal(extrairePaquet(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' })).erreur, 'demande');
  const coupe = PROSE + bloc(paquet(RISOTTO)).slice(0, 400);
  assert.equal(extrairePaquet(coupe).erreur, 'coupee');
  const virgule = JSON.stringify(paquet({ id: 'plat-x', nom: 'Plat X' })).replace(/}]}$/, '},]}');
  assert.equal(extrairePaquet(virgule).erreur, 'coupee');
  assert.equal(extrairePaquet('Bonjour, voici une recette sans fiche.').erreur, 'aucune');
  assert.equal(extrairePaquet('x'.repeat(500_001)).erreur, 'trop_long');
});

// ——— Validation ———

test('validerPaquet : la recette d’exemple passe telle quelle', () => {
  const resultat = validerPaquet(extrairePaquet(PROSE + bloc(paquet(RISOTTO))).paquets, { profils: PROFILS });
  assert.equal(resultat.valide, true, JSON.stringify(resultat.plats[0].erreurs));
  const { donnees } = resultat.plats[0];
  assert.equal(donnees.statutRecette, 'brouillon');
  assert.equal(donnees.ingredients.length, 8);
  assert.equal(donnees.ingredients[3].role, 'incorpore');
  assert.deepEqual(donnees.conservation, { frigoJours: 2, congelable: false });
  assert.deepEqual(donnees.variantes, []);
  assert.equal(resultat.plats[0].avertissements.length, 0);
  sansUndefined(donnees);
});

test('validerPaquet : sortie plausible tolérée (casse, accents, nombres en texte)', () => {
  const plausible = {
    id: 'Plat-Plausible',
    nom: '  Plat   plausible ',
    type: 'Plat',
    statutRecette: 'Brouillon',
    portionsBase: '4',
    ingredients: [
      { produit: 'Oignon Jaune', qte: '0,5', unite: 'PC', rayon: 'Fruits_Legumes', marqueurs: ['Légume'], role: 'Incorporé' },
      { produit: 'sel', qte: 1, unite: 'Pincée', rayon: 'épicerie salée', marqueurs: [] },
      { produit: 'boîte de thon', qte: 1, unite: 'boîte', rayon: 'epicerie_salee', marqueurs: ['poisson'] },
    ],
    cuisson: [{ appareil: 'Monsieur Cuisine', dureeMin: '20' }],
    conservation: { frigoJours: '3', congelable: 'true' },
    emporter: 'false',
  };
  const resultat = validerPaquet([{ format: 'Paquet@1', plats: [plausible] }]);
  assert.equal(resultat.valide, true, JSON.stringify(resultat.plats[0].erreurs));
  const { donnees } = resultat.plats[0];
  assert.equal(donnees.id, 'plat-plausible');
  assert.equal(donnees.nom, 'Plat plausible');
  assert.equal(donnees.portionsBase, 4);
  assert.deepEqual(donnees.ingredients[0], {
    produit: 'oignon jaune', qte: 0.5, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore',
  });
  assert.equal(donnees.ingredients[1].unite, 'pincee');
  assert.equal(donnees.ingredients[1].rayon, 'epicerie_salee');
  assert.equal(donnees.ingredients[2].unite, 'boite');
  assert.equal(donnees.cuisson[0].appareil, 'monsieur_cuisine');
  assert.deepEqual(donnees.conservation, { frigoJours: 3, congelable: true });
  assert.equal(donnees.emporter, false);
});

test('validerPaquet : un plat avec seulement son nom est accepté, sans valeur ajoutée', () => {
  const resultat = validerPaquet([paquet({ id: 'plat-x', nom: 'Plat X' })]);
  assert.equal(resultat.valide, true);
  assert.deepEqual(resultat.plats[0].donnees, { id: 'plat-x', nom: 'Plat X' });
  const attente = validerPaquet([paquet({ id: 'plat-y', nom: 'Plat Y', statutRecette: 'attente', ingredients: [] })]);
  assert.deepEqual(attente.plats[0].donnees, { id: 'plat-y', nom: 'Plat Y', statutRecette: 'attente' });
});

test('validerPaquet : statut déduit ou corrigé selon les ingrédients', () => {
  const sansStatut = { ...RISOTTO };
  delete sansStatut.statutRecette;
  assert.equal(validerPaquet([paquet(sansStatut)]).plats[0].donnees.statutRecette, 'brouillon');
  const attente = validerPaquet([paquet({ ...RISOTTO, statutRecette: 'attente' })]);
  assert.equal(attente.plats[0].donnees.statutRecette, 'brouillon');
  assert.equal(attente.plats[0].avertissements.length, 1);
});

/** Erreurs d'une recette modifiée : messages affichés et consignes pour Claude. */
function erreursDe(modification) {
  const plat = structuredClone(RISOTTO);
  modification(plat);
  const resultat = validerPaquet([paquet(plat)], { profils: PROFILS });
  assert.equal(resultat.valide, false, 'la recette aurait dû être refusée');
  return resultat.plats[0].erreurs;
}

test('validerPaquet : chaque règle du format a son erreur', () => {
  const cas = [
    [(p) => { p.nom = ''; }, /nom manquant/, /nom : texte obligatoire/],
    [(p) => { p.nom = 'x'.repeat(81); }, /trop long/, /80 caractères/],
    [(p) => { p.type = 'soupe'; }, /type de plat inconnu/, /type : `plat`/],
    [(p) => { p.recurrence = 'mensuelle'; }, /récurrence inconnue/, /recurrence :/],
    [(p) => { p.statutRecette = 'fini'; }, /statut de la recette inconnu/, /statutRecette :/],
    [(p) => { p.portionsBase = 0; }, /portions/, /portionsBase : entier/],
    [(p) => { p.portionsBase = 2.5; }, /portions/, /portionsBase/],
    [(p) => { delete p.portionsBase; }, /portions/, /portionsBase/],
    [(p) => { p.ingredients = []; }, /ingrédients manquants/, /ingredients : liste non vide/],
    [(p) => { p.ingredients = 'riz'; }, /ingrédients illisible/, /ingredients : liste attendue/],
    [(p) => { p.ingredients[0].produit = ''; }, /nom de l’ingrédient manquant/, /produit manquant/],
    [(p) => { p.ingredients[0].qte = 0; }, /quantité/, /`qte` : nombre supérieur à 0/],
    [(p) => { p.ingredients[0].qte = 'beaucoup'; }, /quantité/, /`qte`/],
    [(p) => { p.ingredients[0].unite = 'tasse'; }, /unité «\stasse\s» inconnue/, /unite : `g`/],
    [(p) => { delete p.ingredients[0].unite; }, /unité manquante/, /unite :/],
    [(p) => { p.ingredients[0].rayon = 'cave'; }, /rayon «\scave\s» inconnu/, /rayon : `fruits_legumes`/],
    [(p) => { p.ingredients[0].marqueurs = ['bio']; }, /marqueur «\sbio\s» inconnu/, /marqueurs : `viande`/],
    [(p) => { p.ingredients[0].marqueurs = 'feculent'; }, /marqueurs illisibles/, /marqueurs : liste attendue/],
    [(p) => { p.ingredients[1].marqueurs = ['viande']; }, /forme de la viande/, /forme manquante ou inconnue pour une viande/],
    [(p) => { p.ingredients[1].marqueurs = ['porc', 'charcuterie']; }, /forme de la viande/, /forme manquante/],
    [(p) => { p.ingredients[1].marqueurs = ['volaille']; p.ingredients[1].forme = 'entiere'; }, /forme de la viande/, /forme/],
    [(p) => { delete p.ingredients[2].role; }, /principal ou incorporé/, /role manquant ou inconnu pour un légume : `principal`, `incorpore`/],
    [(p) => { p.ingredients[2].role = 'garniture'; }, /principal ou incorporé/, /role/],
    [(p) => { p.etapes = 'Cuire.'; }, /étapes illisibles/, /etapes : liste/],
    [(p) => { p.cuisson = [{ appareil: 'barbecue', dureeMin: 10 }]; }, /appareil inconnu/, /cuisson\[0\]\.appareil/],
    [(p) => { p.cuisson = [{ appareil: 'four', tempC: 200 }]; }, /durée/, /cuisson\[0\]\.dureeMin/],
    [(p) => { p.cuisson = [{ appareil: 'four', tempC: -5, dureeMin: 10 }]; }, /température invalide/, /tempC/],
    [(p) => { p.cuisson = { appareil: 'four' }; }, /cuisson illisible/, /cuisson : liste/],
    [(p) => { p.tempsActifMin = -1; }, /temps de travail/, /tempsActifMin/],
    [(p) => { p.conservation = { frigoJours: 1.5 }; }, /frigo/, /frigoJours/],
    [(p) => { p.conservation = { congelable: 'peut-être' }; }, /congélation/, /congelable/],
    [(p) => { p.conservation = 3; }, /conservation illisible/, /conservation :/],
    [(p) => { p.emporter = 'parfois'; }, /emporter/, /emporter : true ou false/],
    [(p) => { p.variantes = {}; }, /variantes illisibles/, /variantes : liste/],
    [(p) => { p.variantes = [{ ajouter: [] }]; }, /profil manquant/, /variantes\[0\]\.pour/],
    [(p) => { p.variantes = [{ pour: 'profil-b', ajouter: [{ produit: 'thon', qte: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] }] }]; },
      /quantité par portion attendue/, /`qtePortion` attendu/],
    [(p) => { p.variantes = [{ pour: 'profil-b', ajouter: [{ produit: 'jambon', qtePortion: 1, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande'] }] }]; },
      /forme de la viande/, /variantes\[0\]\.ajouter\[0\]/],
    [(p) => { p.variantes = [{ pour: 'profil-b', retirer: 'jambon' }]; }, /à retirer/, /retirer : liste/],
  ];
  for (const [modification, affiche, claude] of cas) {
    const erreurs = erreursDe(modification);
    assert.ok(erreurs.some((e) => affiche.test(e.message)), `message attendu ${affiche} dans ${JSON.stringify(erreurs)}`);
    assert.ok(erreurs.some((e) => claude.test(e.pourClaude)), `consigne attendue ${claude} dans ${JSON.stringify(erreurs)}`);
    for (const erreur of erreurs) assert.doesNotMatch(erreur.message, INTERDITS, erreur.message);
  }
});

test('validerPaquet : erreurs du collage entier', () => {
  const format = validerPaquet([{ format: 'paquet@2', plats: [RISOTTO] }]);
  assert.equal(format.valide, false);
  assert.match(format.erreurs[0].message, /projet Claude/);
  assert.match(format.erreurs[0].pourClaude, /`paquet@1`/);
  assert.equal(validerPaquet([{ format: 'paquet@1', plats: {} }]).valide, false);
  assert.equal(validerPaquet([{ format: 'paquet@1' }]).valide, false);
  const doublonId = validerPaquet([paquet(RISOTTO, { ...RISOTTO, nom: 'Autre nom' })]);
  assert.match(doublonId.erreurs[0].message, /même identifiant/);
  const doublonNom = validerPaquet([paquet(RISOTTO), paquet({ ...RISOTTO, id: 'autre-id', nom: 'RISOTTO TEST' })]);
  assert.match(doublonNom.erreurs[0].message, /même nom/);
  const trop = validerPaquet([paquet(...Array.from({ length: PLATS_MAX + 1 }, (_, i) => ({ id: `p-${i}`, nom: `P ${i}` })))]);
  assert.match(trop.erreurs[0].message, /Trop de recettes/);
  for (const r of [format, doublonId, doublonNom, trop]) for (const e of r.erreurs) assert.doesNotMatch(e.message, INTERDITS);
});

test('validerPaquet : avertissements (clés ignorées, champs inconnus, profil inconnu, température)', () => {
  const plat = structuredClone(RISOTTO);
  plat.notes = { 'profil-a': 5 };
  plat.ingredients[0].marque = 'X';
  plat.cuisson.push({ appareil: 'four', dureeMin: 10 });
  plat.variantes = [{ pour: 'profil-z', retirer: ['saumon'], ajouter: [], consigne: 'Sans poisson.' }];
  const resultat = validerPaquet([{ format: 'paquet@1', plats: [plat], profils: [], reglages: {} }], { profils: PROFILS });
  assert.equal(resultat.valide, true);
  assert.match(resultat.avertissements[0].message, /Seules les recettes/);
  const messages = resultat.plats[0].avertissements.map((a) => a.message).join(' | ');
  assert.match(messages, /non reconnues/); // l'ingrédient porte un champ inconnu (`marque`)
  // T1d-2 : les notes sont connues mais ignorées, avec leur propre avertissement.
  assert.equal(resultat.avertissements[1].message, 'Les notes ne sont pas reprises ici.');
  assert.match(messages, /aucun profil «\sprofil-z\s»/);
  assert.match(messages, /température non précisée/);
  assert.doesNotMatch(messages, INTERDITS);
  assert.equal(resultat.plats[0].donnees.notes, undefined);
  assert.equal('marque' in resultat.plats[0].donnees.ingredients[0], false);
  assert.deepEqual(resultat.plats[0].donnees.variantes, [{ pour: 'profil-z', retirer: ['saumon'], ajouter: [], consigne: 'Sans poisson.' }]);
});

test('validerPaquet : jamais de table vide ni de valeur undefined', () => {
  const plat = { ...RISOTTO, conservation: {}, cuisson: [{ appareil: 'plaque', dureeMin: 5, mode: '' }] };
  const { donnees } = validerPaquet([paquet(plat)]).plats[0];
  assert.equal('conservation' in donnees, false);
  assert.deepEqual(donnees.cuisson, [{ appareil: 'plaque', dureeMin: 5 }]);
  sansUndefined(donnees);
});

test('code : vocabulaire tolérant', () => {
  assert.equal(code('Incorporé'), 'incorpore');
  assert.equal(code(' fruits & légumes '), 'fruits_legumes');
  assert.equal(code('Bœuf'), 'boeuf');
  assert.equal(code(3), '');
});

// ——— Préparer les écritures ———

const valides = (...plats) => validerPaquet([paquet(...plats)], { profils: PROFILS }).plats.map((p) => p.donnees);

test('preparerImport : nouveau plat', () => {
  const { elements, ecritures, demandesAClore, erreurs } = preparerImport(valides(RISOTTO), { plats: [], demandes: [] });
  assert.deepEqual(erreurs, []);
  assert.equal(elements[0].statut, 'nouveau');
  assert.equal(elements[0].ingredients, 8);
  assert.equal(elements[0].etapes, 3);
  assert.equal(ecritures[0].id, 'risotto-test');
  assert.equal(ecritures[0].donnees.id, 'risotto-test');
  assert.deepEqual(demandesAClore, []);
  sansUndefined(ecritures);
});

test('preparerImport : plat ⏳ complété par son identifiant, demande close', () => {
  const plats = [{ id: 'risotto-test', nom: 'Risotto test' }];
  const demandes = [{ id: 'risotto-test__recette', statut: 'ouverte' }];
  const r = preparerImport(valides(RISOTTO), { plats, demandes });
  assert.equal(r.elements[0].statut, 'complete');
  assert.deepEqual(r.demandesAClore, ['risotto-test__recette']);
});

test('preparerImport : plat reconnu par son nom quand l’identifiant diffère', () => {
  const plats = [{ id: 'risotto', nom: 'risotto TEST' }];
  const r = preparerImport(valides(RISOTTO), { plats, demandes: [{ id: 'risotto__recette', statut: 'ouverte' }] });
  assert.equal(r.ecritures[0].id, 'risotto');
  assert.equal(r.ecritures[0].donnees.id, 'risotto');
  assert.equal(r.elements[0].statut, 'complete');
  assert.deepEqual(r.demandesAClore, ['risotto__recette']);
});

test('preparerImport : cible depuis une fiche, même si le nom change', () => {
  const plats = [{ id: 'plat-du-jour', nom: 'Plat du jour' }];
  const r = preparerImport(valides(RISOTTO), { plats, demandes: [], cible: 'plat-du-jour' });
  assert.equal(r.ecritures[0].id, 'plat-du-jour');
  assert.equal(r.elements[0].ancienNom, 'Plat du jour');
  assert.equal(r.elements[0].statut, 'complete');
});

test('preparerImport : cible ignorée si plusieurs recettes', () => {
  const plats = [{ id: 'plat-du-jour', nom: 'Plat du jour' }];
  const r = preparerImport(valides(RISOTTO, { ...RISOTTO, id: 'autre', nom: 'Autre' }), { plats, demandes: [], cible: 'plat-du-jour' });
  assert.deepEqual(r.ecritures.map((e) => e.id), ['risotto-test', 'autre']);
  assert.match(r.avertissements[0].message, /Plusieurs recettes/);
});

test('preparerImport : recette existante remplacée, renommage signalé', () => {
  const plats = [{ id: 'risotto-test', nom: 'Risotto test', statutRecette: 'validee', ingredients: [{ produit: 'riz' }] }];
  const meme = preparerImport(valides(RISOTTO), { plats, demandes: [] });
  assert.equal(meme.elements[0].statut, 'remplace');
  assert.equal(meme.elements[0].ancienNom, undefined);
});

test('preparerImport : identifiant pris par un autre plat déjà rempli → plat à part', () => {
  const plats = [{ id: 'risotto-test', nom: 'Gratin', statutRecette: 'validee' }];
  const r = preparerImport(valides(RISOTTO), { plats, demandes: [] });
  assert.equal(r.ecritures[0].id, 'risotto-test-2');
  assert.equal(r.elements[0].statut, 'nouveau');
  assert.match(r.elements[0].avertissements[0], /utilise déjà cet identifiant/);
});

test('preparerImport : identifiant pris par un autre plat, mais même nom ailleurs → ce plat-là', () => {
  const plats = [
    { id: 'risotto-test', nom: 'Gratin', statutRecette: 'validee' },
    { id: 'risotto-ancien', nom: 'Risotto test', statutRecette: 'brouillon' },
  ];
  const r = preparerImport(valides(RISOTTO), { plats, demandes: [] });
  assert.equal(r.ecritures[0].id, 'risotto-ancien');
  assert.equal(r.elements[0].statut, 'remplace');
});

test('preparerImport : plat ⏳ complété sous un nom déjà porté par un autre plat → avertissement', () => {
  const plats = [{ id: 'risotto-test', nom: 'Ancien nom' }, { id: 'autre', nom: 'Risotto test', statutRecette: 'validee' }];
  const r = preparerImport(valides(RISOTTO), { plats, demandes: [] });
  assert.equal(r.ecritures[0].id, 'risotto-test');
  assert.match(r.elements[0].avertissements[0], /Un autre plat s’appelle déjà/);
});

test('preparerImport : deux recettes visant le même plat → erreur', () => {
  const plats = [{ id: 'commun', nom: 'Risotto test' }];
  const deux = valides(RISOTTO, { ...RISOTTO, id: 'commun', nom: 'Commun bis' });
  const r = preparerImport(deux, { plats, demandes: [] });
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0].message, /visent le même plat/);
  assert.doesNotMatch(r.erreurs[0].message, INTERDITS);
});

test('preparerImport : demandes de variante closes, demandes traitées ou absentes ignorées', () => {
  const plat = { ...RISOTTO, variantes: [{ pour: 'profil-b', retirer: ['pavé de saumon'], ajouter: [], consigne: 'x' }] };
  const demandes = [
    { id: 'risotto-test__profil-b', statut: 'ouverte' },
    { id: 'risotto-test__recette', statut: 'traitee' },
  ];
  const r = preparerImport(valides(plat), { plats: [{ id: 'risotto-test', nom: 'Risotto test' }], demandes });
  assert.deepEqual(r.demandesAClore, ['risotto-test__profil-b']);
});

test('preparerImport : plat sans ingrédients → demande de recette laissée ouverte', () => {
  const r = preparerImport(valides({ id: 'plat-x', nom: 'Plat X' }), {
    plats: [{ id: 'plat-x', nom: 'Plat X' }],
    demandes: [{ id: 'plat-x__recette', statut: 'ouverte' }],
  });
  assert.deepEqual(r.demandesAClore, []);
});

test('preparerImport : l’écriture ne contient ni vignette, ni notes, ni table vide', () => {
  const plats = [{ id: 'risotto-test', nom: 'Risotto test', vignette: 'data:image/jpeg;base64,xx', notes: { 'profil-a': 4 }, majLe: 1 }];
  const { ecritures } = preparerImport(valides(RISOTTO), { plats, demandes: [] });
  const champs = Object.keys(ecritures[0].donnees);
  for (const interdit of ['vignette', 'notes', 'majLe', 'majPar', 'derniereFois']) assert.equal(champs.includes(interdit), false, interdit);
  for (const [cle, valeur] of Object.entries(ecritures[0].donnees)) {
    if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) assert.ok(Object.keys(valeur).length, `table vide : ${cle}`);
  }
  sansUndefined(ecritures);
});

// ——— Textes échangés avec le projet Claude ———

test('texteDemandeRecette : texte exact', () => {
  assert.equal(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }),
    'DEMANDE-RECETTE paquet@1\nid: plat-x\nnom: Plat X\n(Ajoute un lien, une photo ou la recette dictée.)');
});

test('texteCorrectionPourClaude : consignes exactes, plat par plat', () => {
  const plat = structuredClone(RISOTTO);
  delete plat.ingredients[2].role;
  plat.ingredients[1].marqueurs = ['viande'];
  const texte = texteCorrectionPourClaude(validerPaquet([paquet(plat)]));
  const lignes = texte.split('\n');
  assert.equal(lignes[0], 'CORRECTION paquet@1');
  assert.equal(lignes[1], 'id: risotto-test');
  assert.match(texte, /ingredients\[2\] « oignon jaune » : role manquant ou inconnu pour un légume : `principal`, `incorpore`/);
  assert.match(texte, /ingredients\[1\] « pavé de saumon » : forme manquante/);
  assert.equal(lignes.at(-1), '(Rends la fiche complète corrigée, en un seul bloc.)');
  assert.match(texteCorrectionPourClaude({ erreur: 'coupee' }), /coupée ou illisible/);
});

// ——— Routes ———

test('routes : « Ajouter des recettes » réservé au gestionnaire, plat ciblé facultatif', () => {
  assert.equal(resoudreRoute('#/import', 'gestionnaire'), 'import');
  assert.equal(resoudreRoute('#/import/risotto-test', 'gestionnaire'), 'import');
  assert.equal(resoudreRoute('#/import', 'courses'), 'semaine');
  assert.equal(parametreDe('#/import/risotto-test', 'import'), 'risotto-test');
  assert.equal(parametreDe('#/import', 'import'), '');
  assert.equal(parametreDe('#/import/Abc!', 'import'), '');
  assert.equal(parametreDe('#/import/..%2Fx', 'import'), '');
  assert.equal(parametreDe('#/plat/gratin', 'plat'), 'gratin');
  assert.equal(parametreDe('#/courses/x', 'courses'), '');
  assert.equal(parametreDe('#/plat/gratin', 'import'), '');
  assert.deepEqual(lireHash('#/import/risotto-test'), { route: 'import', parametre: 'risotto-test' });
});

// ——— Cas relevés à la relecture ———

test('extrairePaquet : second bloc coupé → tout est refusé (jamais d’import partiel)', () => {
  const complet = bloc(paquet(RISOTTO));
  const coupe = bloc(paquet({ ...RISOTTO, id: 'autre', nom: 'Autre' })).slice(0, 120);
  assert.equal(extrairePaquet(`${PROSE}${complet}\n\nEt la suivante :\n${coupe}`).erreur, 'coupee');
});

test('extrairePaquet : une accolade seule dans la prose ne bloque pas une réponse complète', () => {
  const r = extrairePaquet(`Le modèle commence par { puis les plats.\n${PROSE}${bloc(paquet(RISOTTO))}`);
  assert.equal(r.paquets?.length, 1);
  const apres = extrairePaquet(`${bloc(paquet(RISOTTO))}\nAstuce : une accolade { qui traîne.`);
  assert.equal(apres.paquets?.length, 1);
});

test('extrairePaquet : les corrections recollées par erreur sont reconnues', () => {
  const corrections = texteCorrectionPourClaude({ erreur: 'coupee' });
  assert.equal(extrairePaquet(corrections).erreur, 'demande');
  assert.equal(extrairePaquet(`  ${corrections}`).erreur, 'demande');
});

test('validerPaquet : null vaut absent pour les champs facultatifs', () => {
  const plat = {
    ...RISOTTO,
    type: null, recurrence: null, tempsActifMin: null, conservation: null, emporter: null, variantes: null, source: null,
    cuisson: [{ appareil: 'cookeo', tempC: null, mode: null, dureeMin: 15 }],
    ingredients: [{ produit: 'riz', qte: 300, unite: 'g', rayon: 'epicerie_salee', marqueurs: null, forme: null, role: null }],
    etapes: ['Cuire.', null],
  };
  const resultat = validerPaquet([paquet(plat)]);
  assert.equal(resultat.valide, true, JSON.stringify(resultat.plats[0].erreurs));
  const { donnees } = resultat.plats[0];
  assert.deepEqual(donnees.cuisson, [{ appareil: 'cookeo', dureeMin: 15 }]);
  assert.deepEqual(donnees.ingredients[0].marqueurs, []);
  assert.deepEqual(donnees.etapes, ['Cuire.']);
  for (const champ of ['type', 'recurrence', 'tempsActifMin', 'conservation', 'emporter', 'variantes', 'source']) assert.equal(champ in donnees, false, champ);
  sansUndefined(donnees);
  const attente = validerPaquet([paquet({ id: 'plat-x', nom: 'Plat X', statutRecette: 'attente', portionsBase: null, ingredients: null })]);
  assert.equal(attente.valide, true);
  assert.equal(validerPaquet([paquet({ ...RISOTTO, cuisson: [{ appareil: 'four', dureeMin: null }] })]).valide, false, 'durée toujours obligatoire');
});

test('validerPaquet : étapes et produits « à retirer » qui ne sont pas du texte → erreur', () => {
  const etapes = erreursDe((p) => { p.etapes = [{ ordre: 1, texte: 'Cuire' }]; });
  assert.ok(etapes.some((e) => /étape 1 illisible/.test(e.message) && /etapes\[0\]/.test(e.pourClaude)));
  const retirer = erreursDe((p) => { p.variantes = [{ pour: 'profil-b', retirer: [{ produit: 'jambon' }] }]; });
  assert.ok(retirer.some((e) => /à retirer\u00A0» illisible/.test(e.message)));
});

test('validerPaquet : champs inconnus imbriqués et clés de premier niveau signalés', () => {
  const plat = structuredClone(RISOTTO);
  plat.cuisson = [{ appareil: 'cookeo', dureeMin: 6, programme: 'pression' }];
  plat.conservation = { frigoJours: 2, congelateurMois: 3 };
  plat.variantes = [{ pour: 'profil-b', retirer: [], besoin: 'sans_viande' }];
  const resultat = validerPaquet([{ format: 'paquet@1', hypotheses: ['x'], plats: [plat] }], { profils: PROFILS });
  assert.equal(resultat.valide, true);
  assert.match(resultat.avertissements[0].message, /Seules les recettes/);
  assert.match(resultat.plats[0].avertissements.map((a) => a.message).join(' | '), /non reconnues/);
  assert.deepEqual(resultat.plats[0].donnees.conservation, { frigoJours: 2 });
});

test('validerPaquet : espaces insécables autour des guillemets dans les messages affichés', () => {
  const messages = [
    ...validerPaquet([paquet({ ...RISOTTO, statutRecette: 'attente' })]).plats[0].avertissements,
    ...erreursDe((p) => { p.emporter = 'parfois'; }),
    ...erreursDe((p) => { p.variantes = [{ pour: 'profil-b', retirer: 'x', ajouter: 'y' }]; }),
  ].map((e) => e.message);
  for (const message of messages) assert.doesNotMatch(message, /« | »/, message);
});

test('preparerImport : collage sans ingrédients sur un plat rempli → sa recette et son statut restent', () => {
  const plats = [{ id: 'risotto-test', nom: 'Risotto test', statutRecette: 'brouillon', ingredients: [{ produit: 'riz' }] }];
  const r = preparerImport(valides({ id: 'risotto-test', nom: 'Risotto test', statutRecette: 'attente' }), { plats, demandes: [] });
  assert.equal(r.elements[0].statut, 'inchange');
  assert.equal('statutRecette' in r.ecritures[0].donnees, false);
  // Plat ⏳ recollé tel quel sur la même fiche ⏳ : identique, rien n'est écrit (T1d-2).
  const attente = preparerImport(valides({ id: 'plat-x', nom: 'Plat X' }), { plats: [{ id: 'plat-x', nom: 'Plat X' }], demandes: [] });
  assert.equal(attente.elements[0].statut, 'identique');
  assert.deepEqual(attente.ecritures, []);
  // Plat ⏳ recollé sous un autre type : rien à compléter, le nouveau type est écrit.
  const autreType = preparerImport(valides({ id: 'plat-x', nom: 'Plat X', type: 'dessert' }), { plats: [{ id: 'plat-x', nom: 'Plat X' }], demandes: [] });
  assert.equal(autreType.elements[0].statut, 'inchange');
});

test('preparerImport : la recette d’un autre plat existant, collée sur une fiche → erreur, rien d’écrit', () => {
  const plats = [{ id: 'plat-du-jour', nom: 'Plat du jour' }, { id: 'risotto-test', nom: 'Risotto test', statutRecette: 'brouillon' }];
  const demandes = [{ id: 'plat-du-jour__recette', statut: 'ouverte' }];
  const r = preparerImport(valides(RISOTTO), { plats, demandes, cible: 'plat-du-jour' });
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0].message, /recette de «\u00A0Risotto test\u00A0», déjà dans vos plats/);
  assert.doesNotMatch(r.erreurs[0].message, INTERDITS);
  assert.deepEqual(r.ecritures, []);
  assert.deepEqual(r.demandesAClore, []);
});
