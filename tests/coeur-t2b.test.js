// T2b « Les versions par Claude, dix à la fois » : claude.js (textes copiés), paquet.js (versions à l'import,
// fusion, clôture conditionnelle, cases décochées) et sauvegarde.js (versions additives). Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LOT_VERSIONS, VERSION_INSTRUCTIONS, texteDemandeRecette, texteDemandeVariantes, texteCorrectionPourClaude,
} from '../js/coeur/claude.js';
import {
  extrairePaquet, validerPaquet, preparerImport, fusionnerVariantes, demandesSatisfaites, filtrerPreparation,
  recetteValidee,
} from '../js/coeur/paquet.js';
import {
  creerSauvegarde, lireSauvegarde, validerSauvegarde, preparerRestauration, appliquerConditions,
} from '../js/coeur/sauvegarde.js';
import { platsSansVersion, evaluer } from '../js/coeur/compatibilite.js';
import { ecrireRegime, decrireRegles } from '../js/coeur/regles.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const NI_POISSON = ecrireRegime({ regime: 'sans_viande_ni_poisson', precisions: new Set() }, []);
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: 'b@example.com', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5, regles: NI_POISSON };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A];

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const BOEUF = ing('bœuf à braiser', 800, 'g', ['viande', 'boeuf'], { forme: 'morceaux' });
const BIERE = ing('bière brune', 25, 'cl', ['alcool_cru']);
const OIGNON = ing('oignon jaune', 2, 'pc', ['legume'], { role: 'incorpore' });
const PAIN = ing('pain d’épices', 2, 'tranche');
const FOND = ing('fond de veau', 1, 'cs', ['bouillon_viande']);
const PATES = ing('pâtes', 400, 'g', ['feculent']);
const LARDONS = ing('lardons', 200, 'g', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' });
const THON = { produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] };
const TOFU = { produit: 'tofu fumé', qtePortion: 60, unite: 'g', rayon: 'cremerie', marqueurs: [] };

const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', recurrence: 'aucune', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Cuire.'], ...extra,
});
const CARBONADE = plat('carbonade-flamande', 'Carbonade flamande', [BOEUF, BIERE, OIGNON, PAIN, FOND]);
const GRATIN = plat('gratin-test', 'Gratin test', [PATES, LARDONS]);
const version = (pour, retirer, ajouter = [], consigne = 'Part à part.') => ({ pour, retirer, ajouter, consigne });
const POUR_B = version('profil-b', ['lardons'], [THON], 'Part au thon.');
const POUR_ENFANT = version('enfant', ['lardons'], [TOFU], 'Part au tofu.');

const clone = (valeur) => structuredClone(valeur);
const paquet = (...plats) => ({ format: 'paquet@1', plats });
const valides = (...plats) => {
  const v = validerPaquet([paquet(...plats)], { profils: PROFILS });
  assert.equal(v.valide, true, JSON.stringify(v.erreurs.concat(v.plats.flatMap((p) => p.erreurs))));
  return v.plats.map((p) => p.donnees);
};
const importer = (plats, options) => preparerImport(valides(...plats), { demandes: [], profils: PROFILS, ...options });

/** Vrai si la valeur contient undefined, à quelque profondeur que ce soit. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (Array.isArray(valeur)) return valeur.some(contientUndefined);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientUndefined);
  return false;
}

// ——— claude.js : textes ———

test('LOT_VERSIONS vaut 10', () => {
  assert.equal(LOT_VERSIONS, 10);
});

test('texteDemandeRecette : sans profil contraint, texte de T1b à l’identique (plus la version des instructions)', () => {
  const t1b = `DEMANDE-RECETTE paquet@1\ninstructions: ${VERSION_INSTRUCTIONS}\nid: plat-x\nnom: Plat X\n(Ajoute un lien, une photo ou la recette dictée.)`;
  assert.equal(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }), t1b);
  assert.equal(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }, { profils: [] }), t1b);
  assert.equal(texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }, { profils: [ADULTE_A, { ...ADULTE_B, regles: [] }] }), t1b);
});

test('texteDemandeRecette : une ligne de versions par profil contraint, dans l’ordre d’affichage', () => {
  const texte = texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }, { profils: PROFILS });
  assert.equal(texte, [
    'DEMANDE-RECETTE paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'id: plat-x',
    'nom: Plat X',
    'versions:',
    '- pour: profil-b — Ne mange pas de viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni de bouillon ou de fond de viande ou de volaille, ni de gélatine animale, ni de graisse animale (saindoux, graisse de canard). Mange du poisson, des fruits de mer, du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel.',
    '- pour: enfant — Ne mange ni viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni poisson, ni fruits de mer, ni bouillon ou fond de viande, de volaille ou de poisson, ni gélatine animale, ni graisse animale. Mange des œufs, du fromage (même à présure animale) et du miel.',
    '(Ajoute un lien, une photo ou la recette dictée.)',
    '(Si le plat contient ce qu\'un de ces profils ne mange pas, ajoute sa variante : remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Rends la fiche complète, en un seul bloc.)',
  ].join('\n'));
});

test('texteDemandeVariantes : texte exact, fautifs marqués ✗, unité « pc » sous-entendue', () => {
  assert.equal(texteDemandeVariantes([CARBONADE], ADULTE_B), [
    'DEMANDE-VARIANTES paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'pour: profil-b',
    'besoin: sans_viande',
    'règles: Ne mange pas de viande (bœuf, porc, volaille, agneau, charcuterie, escargots, grenouilles), ni de bouillon ou de fond de viande ou de volaille, ni de gélatine animale, ni de graisse animale (saindoux, graisse de canard). Mange du poisson, des fruits de mer, du fumet de poisson, des œufs, du fromage (même à présure animale) et du miel.',
    '(Pour chaque plat, rends seulement { "id", "nom", "variantes": [la variante pour ce profil] }, jamais la recette entière. Remplace ce qui est retiré par une vraie alternative, riche en goût et en texture (section 4). Tous les plats dans un seul bloc paquet@1. Un plat impossible à adapter : ne le rends pas, et dis-le en une phrase.)',
    'plats:',
    '- id: carbonade-flamande',
    '  nom: Carbonade flamande',
    '  portions: 4',
    '  ingrédients: 800 g bœuf à braiser ✗ ; 25 cl bière brune ; 2 oignon jaune ; 2 tranche pain d’épices ; 1 cs fond de veau ✗',
  ].join('\n'));
});

test('texteDemandeVariantes : éléments de platsSansVersion acceptés ; version à revoir envoyée avec sa version actuelle', () => {
  const aRevoir = { ...GRATIN, variantes: [version('profil-b', ['lardons'], [{ ...THON, produit: 'jambon', marqueurs: ['viande'], forme: 'fine' }], 'Part à part.')] };
  assert.equal(evaluer(aRevoir, ADULTE_B).aRevoir, true);
  const elements = platsSansVersion([aRevoir], ADULTE_B, { profils: PROFILS });
  const texte = texteDemandeVariantes(elements, ADULTE_B);
  assert.match(texte, /\n {2}ingrédients: 400 g pâtes ; 200 g lardons ✗\n/);
  assert.match(texte, /\n {2}version actuelle: retirer: lardons ; ajouter: 50 g jambon par portion ✗ ; consigne: Part à part\.$/);
});

test('texteDemandeVariantes : besoin omis si les plats du lot n’ont pas le même', () => {
  const profil = { ...ADULTE_B, regles: [...SANS_VIANDE, { type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }] };
  const navets = plat('navets', 'Navets', [ing('navet', 4, 'pc', ['legume'], { role: 'principal' })]);
  const texte = texteDemandeVariantes([CARBONADE, navets], profil);
  assert.doesNotMatch(texte, /\nbesoin:/);
  assert.match(texte, /Évite aussi : navet\./);
  assert.match(texteDemandeVariantes([navets], profil), /\nbesoin: adapter\n/);
});

test('texteDemandeVariantes : 10 plats au plus', () => {
  const plats = Array.from({ length: 12 }, (_, i) => ({ ...CARBONADE, id: `plat-${i}`, nom: `Plat ${i}` }));
  const texte = texteDemandeVariantes(plats, ADULTE_B);
  assert.equal(texte.match(/^- id: /gm).length, LOT_VERSIONS);
  assert.match(texte, /- id: plat-9\n/);
  assert.doesNotMatch(texte, /plat-10/);
});

test('textes pour Claude : ni adresse, ni prénom, ni retour à la ligne venu d’un nom', () => {
  const profils = [{ ...ADULTE_B, nom: 'Prénom Secret' }, ADULTE_A];
  const textes = [
    texteDemandeRecette({ id: 'plat-x', nom: 'Plat\nX' }, { profils }),
    texteDemandeVariantes([{ ...CARBONADE, nom: 'Carbonade\nflamande' }], profils[0]),
  ];
  for (const texte of textes) {
    assert.doesNotMatch(texte, /@example|Prénom Secret|Adulte/);
    assert.doesNotMatch(texte, /Plat\nX|Carbonade\nflamande/);
  }
});

test('texte pour Claude : règles en codes quand l’écran ne sait pas les dire', () => {
  const profil = { id: 'profil-b', regles: [{ type: 'exclureMarqueurs', marqueurs: ['poisson'], severite: 'exclu' }] };
  assert.match(texteDemandeRecette({ id: 'x', nom: 'X' }, { profils: [profil] }), /- pour: profil-b — exclut les marqueurs poisson\.\n/);
});

test('extrairePaquet refuse une demande recollée (DEMANDE-VARIANTES, DEMANDE-RECETTE avec versions)', () => {
  assert.equal(extrairePaquet(texteDemandeVariantes([CARBONADE], ADULTE_B)).erreur, 'demande');
  assert.equal(extrairePaquet(texteDemandeRecette({ id: 'x', nom: 'X' }, { profils: PROFILS })).erreur, 'demande');
});

// ——— Validation ———

test('deux versions pour le même profil : erreur à l’import, avec le code pour Claude', () => {
  const v = validerPaquet([paquet({ ...GRATIN, variantes: [POUR_B, { ...POUR_B, consigne: 'Autre.' }] })]);
  assert.equal(v.valide, false);
  assert.equal(v.plats[0].erreurs[0].message, 'Deux versions pour le même profil dans «\u00A0Gratin test\u00A0».');
  assert.match(texteCorrectionPourClaude(v), /variantes\[1\]\.pour « profil-b » : deux variantes pour le même profil/);
});

test('deux versions pour le même profil en base : recette valide, la première gardée, sauvegarde stable', () => {
  const fiche = { ...GRATIN, variantes: [POUR_B, { ...POUR_B, consigne: 'Autre.' }] };
  const recette = recetteValidee(fiche);
  assert.ok(recette);
  assert.deepEqual(recette.variantes.map((v) => v.consigne), ['Part au thon.']);
  // Sauvegarde : rien à corriger, et la même base relue ne prévoit aucune écriture (empreinte identique).
  const etat = { plats: [fiche], profils: clone(PROFILS) };
  const { texte, aCorriger } = creerSauvegarde(etat);
  assert.deepEqual(aCorriger, []);
  const relue = validerSauvegarde(lireSauvegarde(texte).sauvegarde);
  assert.deepEqual(relue.plats[0].recette.variantes.map((v) => v.consigne), ['Part au thon.']);
  assert.equal(preparerRestauration(relue, { ...etat, demandes: [] }).rien, true);
});

test('version qui retire un produit absent, ou qui ne change rien : avertissements', () => {
  const v = validerPaquet([paquet({ ...GRATIN, variantes: [version('profil-b', ['jambon'], [THON]), version('enfant', [], [])] })]);
  assert.equal(v.valide, true);
  const messages = v.plats[0].avertissements.map((a) => a.message);
  assert.ok(messages.includes('«\u00A0Gratin test\u00A0», variante 1\u00A0: «\u00A0jambon\u00A0» n’est pas dans la recette.'), messages);
  assert.ok(messages.includes('«\u00A0Gratin test\u00A0», variante 2\u00A0: elle ne change rien à la recette.'), messages);
});

// ——— fusionnerVariantes ———

test('fusionnerVariantes : remplace par profil, garde les autres dans leur ordre, nouvelles à la fin', () => {
  const autre = version('profil-c', ['lardons']);
  const actuelles = [POUR_B, autre];
  const nouvelleB = version('profil-b', ['lardons'], [TOFU], 'Part au tofu.');
  const fusion = fusionnerVariantes(actuelles, [POUR_ENFANT, nouvelleB]);
  assert.deepEqual(fusion, [nouvelleB, autre, POUR_ENFANT]);
  assert.deepEqual(actuelles, [POUR_B, autre], 'entrée intacte');
  assert.deepEqual(fusionnerVariantes(undefined, [POUR_B]), [POUR_B]);
  assert.deepEqual(fusionnerVariantes([POUR_B], undefined), [POUR_B]);
});

test('fusionnerVariantes : aucune valeur undefined ; doublon ancien d’un profil remplacé retiré', () => {
  const fusion = fusionnerVariantes([{ ...POUR_B, consigne: undefined }, null, { ...POUR_B, consigne: 'Doublon.' }],
    [{ ...POUR_ENFANT, consigne: undefined }]);
  assert.equal(contientUndefined(fusion), false);
  assert.equal(fusion.length, 3);
  const remplace = fusionnerVariantes([POUR_B, POUR_ENFANT, { ...POUR_B, consigne: 'Doublon.' }], [version('profil-b', ['lardons'], [TOFU])]);
  assert.deepEqual(remplace.map((v) => v.pour), ['profil-b', 'enfant']);
});

// ——— preparerImport : versions ———

test('versions seules { id, nom, type, variantes } : statut versions, ni nom ni statut ni recette écrits', () => {
  const fiche = { ...GRATIN, statutRecette: 'validee', modifieePar: 'a@example.com', modifieeLe: { seconds: 42 } };
  const r = importer([{ id: 'gratin-test', nom: 'Gratin aux lardons', type: 'dessert', variantes: [POUR_B] }], { plats: [fiche] });
  assert.equal(r.elements[0].statut, 'versions');
  assert.equal(r.elements[0].nom, 'Gratin test');
  assert.deepEqual(r.ecritures, [{ id: 'gratin-test', mode: 'versions', variantes: [POUR_B] }]);
  assert.deepEqual(r.elements[0].versions, [{
    pour: 'profil-b', nom: 'Adulte B', action: 'ajoutee', convient: true, libelle: '🌿 Version pour Adulte B ajoutée',
  }]);
  assert.deepEqual(r.elements[0].avertissements, [
    'Seule la version de «\u00A0Gratin test\u00A0» est reprise.',
    'Claude l’appelle «\u00A0Gratin aux lardons\u00A0»\u00A0: le nom de la fiche est gardé.',
  ]);
  assert.equal('modifieeA' in r.elements[0], false);
});

test('versions seules : trouvées par le nom si l’identifiant diffère ; « retirer » comparé à la fiche', () => {
  const r = importer([{ id: 'gratin', nom: 'Gratin test', variantes: [version('profil-b', ['jambon'], [THON])] }], { plats: [GRATIN] });
  assert.equal(r.ecritures[0].id, 'gratin-test');
  assert.match(r.elements[0].avertissements.join(' '), /Version pour Adulte B\u00A0: «\u00A0jambon\u00A0» n’est pas dans la recette\./);
});

test('cible + une seule entrée dont l’identifiant diffère → la cible', () => {
  const r = importer([{ id: 'autre-chose', nom: 'Autre chose', variantes: [POUR_B] }], { plats: [GRATIN], cible: 'gratin-test' });
  assert.equal(r.ecritures[0].id, 'gratin-test');
  assert.equal(r.elements[0].statut, 'versions');
});

test('cible + entrée sans ingrédients au nom d’un autre plat → la cible, sans l’erreur « recette d’un autre plat »', () => {
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [POUR_B] }],
    { plats: [GRATIN, CARBONADE], cible: 'gratin-test' });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.ecritures[0].id, 'gratin-test');
});

test('plat inconnu ou ⏳ dans une réponse de versions : avertissements, le reste s’enregistre', () => {
  const attente = { id: 'plat-en-attente', nom: 'Plat en attente' };
  const r = importer([
    { id: 'inconnu', nom: 'Plat inventé', variantes: [POUR_B] },
    { id: 'plat-en-attente', nom: 'Plat en attente', variantes: [POUR_B] },
    { id: 'gratin-test', nom: 'Gratin test', variantes: [POUR_B] },
  ], { plats: [GRATIN, attente] });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.avertissements.map((a) => a.message), [
    'Claude a répondu pour «\u00A0Plat inventé\u00A0», qui n’est pas dans vos plats\u00A0: ignoré.',
    '«\u00A0Plat en attente\u00A0» n’a pas encore sa recette\u00A0: sa version est ignorée. Demandez la recette avec sa version.',
  ]);
  assert.deepEqual(r.ecritures.map((e) => e.id), ['gratin-test']);
  assert.deepEqual(r.elements.map((e) => e.id), ['gratin-test']);
  assert.equal(r.elements[0].index, 2, 'position de l’entrée collée, pour retrouver ses avertissements de validation');
});

test('entrée sans versions ni ingrédients pour un plat inconnu : plat ⏳ créé comme en T1b', () => {
  const r = importer([{ id: 'soupe', nom: 'Soupe' }], { plats: [GRATIN] });
  assert.equal(r.elements[0].statut, 'nouveau');
  assert.deepEqual(r.ecritures[0].donnees, { id: 'soupe', nom: 'Soupe' });
});

test('fiche complète égale hors versions (et nom) → versions seules, marque « modifiée à la main » et nom gardés', () => {
  const fiche = { ...GRATIN, nom: 'Gratin du dimanche', modifieePar: 'a@example.com', modifieeLe: { seconds: 42 } };
  const r = importer([{ ...GRATIN, variantes: [POUR_B] }], { plats: [fiche] });
  assert.equal(r.elements[0].statut, 'versions');
  assert.deepEqual(r.ecritures, [{ id: 'gratin-test', mode: 'versions', variantes: [POUR_B] }]);
  assert.match(r.elements[0].avertissements.join(' '), /le nom de la fiche est gardé/);
});

test('fiche complète différente avec versions : choix, coché d’avance selon la fiche', () => {
  const recu = { ...GRATIN, etapes: ['Autre façon.'], variantes: [POUR_B] };
  const brouillon = importer([recu], { plats: [{ ...GRATIN, variantes: [POUR_ENFANT] }] });
  assert.deepEqual(brouillon.elements[0].choix, { retenu: 'remplacer', parDefaut: 'remplacer' });
  assert.equal(brouillon.elements[0].statut, 'remplace');
  // « Remplacer » : la version de l'autre profil reste (fusion par profil).
  assert.deepEqual(brouillon.ecritures[0].donnees.variantes, [POUR_ENFANT, POUR_B]);
  for (const fiche of [{ ...GRATIN, statutRecette: 'validee' }, { ...GRATIN, modifieePar: 'a@example.com' }]) {
    const r = importer([recu], { plats: [fiche] });
    assert.deepEqual(r.elements[0].choix, { retenu: 'version', parDefaut: 'version' });
    assert.equal(r.elements[0].statut, 'versions');
    assert.deepEqual(r.ecritures, [{ id: 'gratin-test', mode: 'versions', variantes: [POUR_B] }]);
  }
  const force = importer([recu], { plats: [{ ...GRATIN, statutRecette: 'validee' }], choix: { 'gratin-test': 'remplacer' } });
  assert.deepEqual(force.elements[0].choix, { retenu: 'remplacer', parDefaut: 'version' });
  assert.equal(force.elements[0].statut, 'remplace');
  // Sans version reçue : remplacée comme en T1b, sans choix.
  const sansVersion = importer([{ ...GRATIN, etapes: ['Autre façon.'] }], { plats: [{ ...GRATIN, statutRecette: 'validee' }] });
  assert.equal(sansVersion.elements[0].statut, 'remplace');
  assert.equal('choix' in sansVersion.elements[0], false);
});

test('version déjà sur la fiche → identique, rien n’est écrit, la demande est close ; remplacée → libellé', () => {
  const fiche = { ...GRATIN, variantes: [POUR_ENFANT, POUR_B] };
  const demandes = [{ id: 'gratin-test__profil-b', statut: 'ouverte' }];
  const r = importer([{ id: 'gratin-test', nom: 'Gratin test', variantes: [POUR_B] }], { plats: [fiche], demandes });
  assert.equal(r.elements[0].statut, 'identique');
  assert.deepEqual(r.ecritures, []);
  assert.deepEqual(r.demandesAClore, ['gratin-test__profil-b']);
  const autre = version('profil-b', ['lardons'], [TOFU], 'Part au tofu.');
  const remplacee = importer([{ id: 'gratin-test', nom: 'Gratin test', variantes: [autre] }], { plats: [fiche] });
  assert.equal(remplacee.elements[0].versions[0].libelle, 'Version pour Adulte B remplacée');
});

test('une version reçue ne retire jamais celle d’un autre profil ; aucune valeur undefined', () => {
  const fiche = { ...GRATIN, variantes: [POUR_ENFANT] };
  const r = importer([{ id: 'gratin-test', nom: 'Gratin test', variantes: [POUR_B] }], { plats: [fiche] });
  assert.deepEqual(fusionnerVariantes(fiche.variantes, r.ecritures[0].variantes), [POUR_ENFANT, POUR_B]);
  for (const ecriture of r.ecritures) {
    assert.equal(contientUndefined(ecriture), false);
    assert.equal('donnees' in ecriture, false);
  }
});

test('clôture : version qui convient → close ; qui laisse un fautif → ouverte, avertissement, correction', () => {
  const demandes = [{ id: 'carbonade-flamande__profil-b', statut: 'ouverte' }];
  const bonne = version('profil-b', ['bœuf à braiser', 'fond de veau'], [THON]);
  const ok = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [bonne] }], { plats: [CARBONADE], demandes });
  assert.deepEqual(ok.demandesAClore, ['carbonade-flamande__profil-b']);
  assert.deepEqual(ok.corrections, []);

  const incomplete = version('profil-b', ['bœuf à braiser'], [THON]);
  const r = importer([{ id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [incomplete] }], { plats: [CARBONADE], demandes });
  assert.deepEqual(r.demandesAClore, []);
  assert.equal(r.ecritures.length, 1, 'la version est importée quand même');
  assert.equal(r.elements[0].versions[0].convient, false);
  assert.ok(r.elements[0].avertissements.includes('La version pour Adulte B contient encore\u00A0: fond de veau.'));
  assert.deepEqual(r.corrections.map((c) => c.pourClaude), [
    'id carbonade-flamande variantes[pour=profil-b] : contient fond de veau (bouillon_viande), exclu pour profil-b',
  ]);
  const texte = texteCorrectionPourClaude(r);
  assert.equal(texte, [
    'CORRECTION paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    '- id carbonade-flamande variantes[pour=profil-b] : contient fond de veau (bouillon_viande), exclu pour profil-b',
    '(Rends seulement { "id", "nom", "variantes" } de chaque plat corrigé, en un seul bloc.)',
  ].join('\n'));
});

test('demandesSatisfaites : profils obligatoires ; version jugée sur la fiche fusionnée', () => {
  const ouvertes = new Set(['gratin-test__profil-b', 'gratin-test__enfant']);
  assert.throws(() => demandesSatisfaites('gratin-test', { variantes: [POUR_B] }, ouvertes), TypeError);
  // Thon : convient à profil-b, pas à l'enfant (ni viande ni poisson).
  const thonEnfant = version('enfant', ['lardons'], [THON]);
  const fiche = { ...GRATIN, variantes: [POUR_B, thonEnfant] };
  assert.deepEqual(demandesSatisfaites('gratin-test', { variantes: [POUR_B, thonEnfant] }, ouvertes, { plat: fiche, profils: PROFILS }),
    ['gratin-test__profil-b']);
  // Plat sans recette : rien n'est satisfait par une version.
  assert.deepEqual(demandesSatisfaites('x', { variantes: [POUR_B] }, new Set(['x__profil-b']), { plat: { id: 'x' }, profils: PROFILS }), []);
});

test('fiche complète d’un nouveau plat ou d’un ⏳ : versions jugées et libellées aussi', () => {
  const demandes = [{ id: 'gratin-test__recette', statut: 'ouverte' }, { id: 'gratin-test__profil-b', statut: 'ouverte' }];
  const r = importer([{ ...GRATIN, variantes: [POUR_B] }], { plats: [{ id: 'gratin-test', nom: 'Gratin test' }], demandes });
  assert.equal(r.elements[0].statut, 'complete');
  assert.deepEqual(r.demandesAClore, ['gratin-test__recette', 'gratin-test__profil-b']);
  assert.equal(r.elements[0].versions[0].libelle, '🌿 Version pour Adulte B ajoutée');
});

test('filtrerPreparation : décocher retire l’écriture, les demandes et les corrections du plat', () => {
  const demandes = [
    { id: 'gratin-test__profil-b', statut: 'ouverte' },
    { id: 'carbonade-flamande__profil-b', statut: 'ouverte' },
  ];
  const r = importer([
    { id: 'gratin-test', nom: 'Gratin test', variantes: [POUR_B] },
    { id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [version('profil-b', ['bœuf à braiser'], [THON])] },
  ], { plats: [GRATIN, CARBONADE], demandes });
  assert.equal(r.ecritures.length, 2);
  assert.equal(r.corrections.length, 1);
  const filtree = filtrerPreparation(r, new Set(['carbonade-flamande']));
  assert.deepEqual(filtree.ecritures.map((e) => e.id), ['gratin-test']);
  assert.deepEqual(filtree.demandesAClore, ['gratin-test__profil-b']);
  assert.deepEqual(filtree.corrections, []);
  assert.deepEqual(filtree.elements.map((e) => e.retenu), [true, false]);
  const sansGratin = filtrerPreparation(r, ['gratin-test']);
  assert.deepEqual(sansGratin.demandesAClore, []);
  assert.equal(r.ecritures.length, 2, 'préparation d’origine intacte');
});

// ——— Lots dans Plats ———

test('platsSansVersion avec envoyes : après un import de 10, les 10 suivants sont les premiers restants', () => {
  const plats = Array.from({ length: 25 }, (_, i) => plat(`plat-${String(i).padStart(2, '0')}`, `Plat ${String(i).padStart(2, '0')}`, [BOEUF]));
  const premiers = platsSansVersion(plats, ADULTE_B, { profils: PROFILS }).slice(0, LOT_VERSIONS).map((e) => e.plat.id);
  // Claude rend 9 versions ; le 10e plat est jugé impossible (pas de réponse).
  const apres = plats.map((p) => (premiers.slice(0, 9).includes(p.id)
    ? { ...p, variantes: [version('profil-b', ['bœuf à braiser'], [THON])] } : p));
  const suivants = platsSansVersion(apres, ADULTE_B, { profils: PROFILS, envoyes: premiers });
  assert.equal(suivants.length, 16);
  const attendus = plats.map((p) => p.id).filter((id) => !premiers.includes(id)).slice(0, LOT_VERSIONS);
  assert.deepEqual(suivants.slice(0, LOT_VERSIONS).map((e) => e.plat.id), attendus);
  assert.equal(suivants.at(-1).plat.id, premiers[9], 'le plat impossible passe en fin de liste');
});

// ——— Restauration : versions additives ———

function relue(etat) {
  const { texte } = creerSauvegarde(etat);
  return validerSauvegarde(lireSauvegarde(texte).sauvegarde);
}

test('restauration : une version ajoutée depuis la sauvegarde n’en fait pas une « recette différente »', () => {
  const sauvegarde = relue({ plats: [GRATIN], profils: clone(PROFILS) });
  const app = { plats: [{ ...GRATIN, variantes: [POUR_B] }], profils: clone(PROFILS), demandes: [] };
  const r = preparerRestauration(sauvegarde, app);
  assert.deepEqual(r.recettesDifferentes, []);
  assert.equal(r.rien, true);
});

test('restauration : version absente de la fiche → remise (variantesAbsentes), présente jamais remplacée', () => {
  const sauvegarde = relue({ plats: [{ ...GRATIN, variantes: [{ ...POUR_B, consigne: 'Ancienne.' }, POUR_ENFANT] }], profils: clone(PROFILS) });
  const app = { plats: [{ ...GRATIN, variantes: [POUR_B] }], profils: clone(PROFILS), demandes: [{ id: 'gratin-test__enfant', statut: 'ouverte' }] };
  const r = preparerRestauration(sauvegarde, app);
  const [ecriture] = r.lots.flat();
  assert.equal(ecriture.mode, 'update');
  assert.deepEqual(ecriture.condition, { variantesAbsentes: ['enfant'] });
  assert.deepEqual(ecriture.donnees, { variantes: [POUR_B, POUR_ENFANT] });
  assert.deepEqual(r.resume.versionsRemises, [{ pour: 'enfant', nom: 'Enfant', nombre: 1 }]);
  assert.deepEqual(r.demandesAClore, ['gratin-test__enfant']);
  // À l'envoi : une version de l'enfant posée entre-temps gagne ; une autre version arrivée reste.
  const autreTofu = version('enfant', ['lardons'], [TOFU], 'Posée ailleurs.');
  assert.equal(appliquerConditions(ecriture, { ...GRATIN, variantes: [POUR_B, autreTofu] }), null);
  const pose = appliquerConditions(ecriture, { ...GRATIN, variantes: [version('profil-c', [])] });
  assert.deepEqual(pose.donnees.variantes.map((v) => v.pour), ['profil-c', 'enfant']);
  assert.deepEqual(pose.clore, ['gratin-test__enfant']);
});

test('restauration : version remise qui ne convient pas → demande laissée ouverte', () => {
  const thonEnfant = version('enfant', ['lardons'], [THON]);
  const sauvegarde = relue({ plats: [{ ...GRATIN, variantes: [thonEnfant] }], profils: clone(PROFILS) });
  const app = { plats: [clone(GRATIN)], profils: clone(PROFILS), demandes: [{ id: 'gratin-test__enfant', statut: 'ouverte' }] };
  const r = preparerRestauration(sauvegarde, app);
  assert.equal(r.lots.flat().length, 1, 'la version revient');
  assert.deepEqual(r.demandesAClore, []);
  // Plat absent remis entier : même règle.
  const absent = preparerRestauration(sauvegarde, { ...app, plats: [] });
  assert.deepEqual(absent.demandesAClore, []);
});

test('restauration : une recette cochée garde les versions de la fiche, celles du fichier qui manquent reviennent', () => {
  const sauvegarde = relue({ plats: [{ ...GRATIN, etapes: ['Ancienne façon.'], variantes: [{ ...POUR_B, consigne: 'Ancienne.' }, POUR_ENFANT] }], profils: clone(PROFILS) });
  const app = { plats: [{ ...GRATIN, variantes: [POUR_B] }], profils: clone(PROFILS), demandes: [] };
  const r = preparerRestauration(sauvegarde, app, { recettesAReprendre: ['gratin-test'] });
  assert.equal(r.recettesDifferentes.length, 1);
  const [ecriture] = r.lots.flat();
  assert.deepEqual(ecriture.donnees.etapes, ['Ancienne façon.']);
  assert.deepEqual(ecriture.donnees.variantes, [POUR_B, POUR_ENFANT]);
  assert.equal((ecriture.effacer ?? []).includes('variantes'), false);
  // Fiche changée entre-temps : la recette ne part plus, la version manquante si.
  const reste = appliquerConditions(ecriture, { ...GRATIN, etapes: ['Encore autre.'], variantes: [POUR_B] });
  assert.deepEqual(Object.keys(reste.donnees), ['variantes']);
  // Une version ajoutée entre-temps ne change pas l'empreinte de la recette : la reprise part toujours.
  const avecVersion = appliquerConditions(ecriture, { ...GRATIN, variantes: [POUR_B, version('profil-c', [])] });
  assert.deepEqual(avecVersion.donnees.etapes, ['Ancienne façon.']);
  assert.deepEqual(avecVersion.donnees.variantes.map((v) => v.pour), ['profil-b', 'profil-c', 'enfant']);
});

test('restauration : plat ⏳ dans l’app, recette non cochée → aucune version posée', () => {
  const sauvegarde = relue({ plats: [{ ...GRATIN, variantes: [POUR_B] }], profils: clone(PROFILS) });
  const r = preparerRestauration(sauvegarde, { plats: [{ id: 'gratin-test', nom: 'Gratin test' }], profils: clone(PROFILS), demandes: [] });
  assert.equal(r.rien, true);
  assert.deepEqual(r.resume.versionsRemises, []);
});

// ——— Corrections de la relecture de T2b ———

test('versions seules avec un statut recopié (brouillon, vérifiée) : acceptées, seule la version est reprise', () => {
  for (const statutRecette of ['brouillon', 'validee', 'Brouillon']) {
    const v = validerPaquet([paquet({ id: 'gratin-test', nom: 'Gratin test', statutRecette, variantes: [POUR_B] })], { profils: PROFILS });
    assert.equal(v.valide, true, statutRecette);
    assert.equal(v.plats[0].versionsSeules, true);
    const r = preparerImport(v.plats.map((p) => p.donnees), { plats: [GRATIN], demandes: [], profils: PROFILS });
    assert.equal(r.elements[0].statut, 'versions');
    assert.deepEqual(r.ecritures, [{ id: 'gratin-test', mode: 'versions', variantes: [POUR_B] }]);
    assert.deepEqual(r.elements[0].avertissements, ['Seule la version de «\u00A0Gratin test\u00A0» est reprise.']);
  }
  // Ailleurs (fiche en base, sauvegarde), une recette « brouillon » sans ingrédients reste invalide.
  assert.equal(recetteValidee({ id: 'x', nom: 'X', statutRecette: 'brouillon', variantes: [POUR_B] }), null);
  // Une fiche sans ingrédients ni versions, « brouillon », reste une erreur à l'import.
  assert.equal(validerPaquet([paquet({ id: 'x', nom: 'X', statutRecette: 'brouillon' })]).valide, false);
});

test('correction d’une réponse de versions refusée : versions seules, tout le lot redemandé', () => {
  const qte = { ...version('profil-b', ['lardons'], [{ ...THON, qte: 50, qtePortion: undefined }]) };
  const v = validerPaquet([paquet(
    { id: 'gratin-test', nom: 'Gratin test', variantes: [qte] },
    { id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [version('profil-b', ['bœuf à braiser'], [TOFU])] },
  )], { profils: PROFILS });
  assert.equal(v.valide, false);
  assert.equal(texteCorrectionPourClaude(v), [
    'CORRECTION paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'id: gratin-test',
    '- plats[0] (gratin-test) variantes[0].ajouter[0] « thon au naturel » : `qtePortion` attendu (quantité par portion) au lieu de `qte`',
    '- Rien n’a été enregistré : rends aussi, telles quelles, les versions des autres plats du lot (carbonade-flamande).',
    '(Rends seulement { "id", "nom", "variantes" } de chaque plat du lot, corrigé, en un seul bloc.)',
  ].join('\n'));
  // Erreur du lot entier (deux entrées pour le même plat) : versions seules aussi.
  const doublon = validerPaquet([paquet(
    { id: 'gratin-test', nom: 'Gratin test', variantes: [POUR_B] },
    { id: 'gratin', nom: 'Gratin test bis', variantes: [POUR_ENFANT] },
  )], { profils: PROFILS });
  assert.match(texteCorrectionPourClaude({ ...doublon, erreurs: [{ pourClaude: 'id gratin-test : deux recettes pour le même plat' }] }),
    /\(Rends seulement \{ "id", "nom", "variantes" \} de chaque plat du lot, corrigé, en un seul bloc\.\)$/);
  // Une fiche complète en erreur garde la consigne de T1b.
  const complete = validerPaquet([paquet({ ...GRATIN, ingredients: [PATES, { ...LARDONS, forme: undefined }] })], { profils: PROFILS });
  assert.match(texteCorrectionPourClaude(complete), /\(Rends la fiche complète corrigée, en un seul bloc\.\)$/);
});

test('textes pour Claude : les règles que la phrase du régime ne dit pas sont ajoutées en codes', () => {
  const regime = [...SANS_VIANDE, { type: 'exclureMarqueurs', marqueurs: ['alcool_cru', 'oeuf_cru'], severite: 'exclu' }];
  const profilA = { id: 'profil-a', nom: 'Adulte A', regles: regime };
  const phrase = decrireRegles(profilA);
  assert.ok(phrase);
  assert.match(texteDemandeRecette({ id: 'x', nom: 'X' }, { profils: [profilA] }),
    new RegExp(`- pour: profil-a — ${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Exclut les marqueurs alcool_cru, oeuf_cru\\.\\n`));
  const enfant = { id: 'enfant', nom: 'Enfant', regles: [
    { type: 'exclureMarqueurs', marqueurs: ['oeuf_cru'], severite: 'exclu' },
    { type: 'exclureProduits', produits: ['navet'], severite: 'exclu' },
  ] };
  const tiramisu = plat('tiramisu', 'Tiramisu', [ing('œuf', 3, 'pc', ['oeuf', 'oeuf_cru'])]);
  assert.equal(evaluer(tiramisu, enfant).niveau, 'exclu');
  assert.match(texteDemandeRecette({ id: 'x', nom: 'X' }, { profils: [enfant] }),
    /- pour: enfant — Évite aussi : navet\. Exclut les marqueurs oeuf_cru\.\n/);
  assert.match(texteDemandeVariantes([tiramisu], enfant), /\nrègles: Évite aussi : navet\. Exclut les marqueurs oeuf_cru\.\n/);
  // Règle du régime non reconnue + produit évité : la règle n'est pas perdue.
  const bancal = { id: 'profil-b', regles: [{ id: 'regime', type: 'exclureMarqueurs', marqueurs: ['viande', 'poisson'], severite: 'exclu' },
    { type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }] };
  assert.match(texteDemandeRecette({ id: 'x', nom: 'X' }, { profils: [bancal] }), /Exclut les marqueurs viande, poisson\./);
  // Règles inactives ou de préférence : rien de plus.
  const calme = { id: 'profil-a', regles: [...SANS_VIANDE, { type: 'exclureMarqueurs', marqueurs: ['cafe'], severite: 'exclu', actif: false },
    { type: 'exclureMarqueurs', marqueurs: ['alcool_cru'], severite: 'preference' }] };
  assert.match(texteDemandeRecette({ id: 'x', nom: 'X' }, { profils: [calme] }), new RegExp(`— ${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
});

// ——— Modules ———

test('claude.js n’importe pas paquet.js ; paquet.js ne réexporte plus les textes', async () => {
  const claude = await readFile(new URL('../js/coeur/claude.js', import.meta.url), 'utf8');
  assert.doesNotMatch(claude, /from '\.\/paquet\.js'/);
  for (const module of ['regles.js', 'compatibilite.js', 'vocabulaire.js']) assert.match(claude, new RegExp(`from '\\./${module.replace('.', '\\.')}'`));
  const paquetModule = await import('../js/coeur/paquet.js');
  assert.equal('texteDemandeRecette' in paquetModule, false);
  assert.equal('texteCorrectionPourClaude' in paquetModule, false);
});

test('aucune espace insécable écrite telle quelle dans les fichiers de T2b', async () => {
  for (const fichier of ['../js/coeur/claude.js', '../js/coeur/paquet.js', '../js/coeur/sauvegarde.js', './coeur-t2b.test.js']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});
