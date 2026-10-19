// Garde-fous de docs/projet-claude.md (T2b) : les instructions copiées dans le projet Claude suivent le code de l'app
// (vocabulaires, champs, codes des demandes) et leurs exemples s'ajoutent tels quels. Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STYLES, VOCABULAIRES } from '../js/coeur/vocabulaire.js';
import { CHAMPS_PLAT, FORMAT, validerPaquet, extrairePaquet, controlerInstructions } from '../js/coeur/paquet.js';
import {
  VERSION_INSTRUCTIONS, texteDemandeEtapes, texteDemandeIdees, texteDemandePrecautions, texteDemandeRecette,
  texteDemandeVariantes, texteCorrectionPourClaude,
} from '../js/coeur/claude.js';
import { entreesPourImport, preparerImport } from '../js/coeur/paquet.js';
import { empreinteEtapes } from '../js/coeur/realisation.js';
import { GATEAU, GRATIN, REALISATION_GRATIN } from './donnees/exemples-etapes.js';
import { ecrireRegime } from '../js/coeur/regles.js';
import { slug } from '../js/coeur/slug.js';
import {
  empreintePlanBatch, platsDuBatch, texteCorrectionBatch, texteDemandeBatch, validerPlanBatch,
} from '../js/coeur/plan-batch.js';
import { PLATS as PLATS_BATCH, PROFILS as PROFILS_BATCH, SEMAINE as SEMAINE_BATCH } from './donnees/plan-batch.js';

const doc = await readFile(new URL('../docs/projet-claude.md', import.meta.url), 'utf8');

const PROFILS_PERMIS = ['profil-a', 'profil-b', 'enfant'];
const profils = [
  { id: 'profil-a', nom: 'Adulte A', ordre: 0, regles: ecrireRegime({ regime: 'sans_viande' }) },
  { id: 'profil-b', nom: 'Adulte B', ordre: 1, regles: [] },
];

/** Contenu des blocs de code d'un langage donné ('' : blocs sans langage). */
function blocs(langage) {
  return [...doc.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].filter((m) => m[1] === langage).map((m) => m[2].trimEnd());
}

/** Blocs `json` de fiches (clé `plats`) ; le plan de batch (clé `batch`) a son propre test. */
const blocsDeFiches = () => blocs('json').filter((r) => !Object.hasOwn(JSON.parse(r), 'batch'));
const ELEMENTS_BATCH = platsDuBatch(SEMAINE_BATCH, { tousLesPlats: PLATS_BATCH, profils: PROFILS_BATCH });

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });

test('en tête : titre et version des instructions', () => {
  assert.equal(doc.split('\n')[0], `# Instructions du projet Claude — version ${VERSION_INSTRUCTIONS}`);
});

test('chaque valeur des vocabulaires fermés figure dans les instructions', () => {
  for (const [champ, valeurs] of Object.entries(VOCABULAIRES)) {
    for (const valeur of valeurs) assert.ok(doc.includes(`\`${valeur}\``), `${champ} : « ${valeur} » absent`);
  }
  // Styles d'une version (mer, végétale) : hors VOCABULAIRES, mais dans les instructions.
  for (const style of STYLES) assert.ok(doc.includes(`\`${style}\``), `style : « ${style} » absent`);
});

test('chaque champ d’une fiche figure dans les instructions', () => {
  for (const champ of CHAMPS_PLAT) assert.ok(doc.includes(`\`${champ}\``), `champ « ${champ} » absent`);
  for (const champ of ['format', 'plats', 'qtePortion', 'forme', 'role', 'pour', 'style', 'retirer', 'ajouter', 'consigne', 'frigoJours']) {
    assert.ok(doc.includes(`\`${champ}\``), `champ « ${champ} » absent`);
  }
});

test('les en-têtes des demandes produites par l’app figurent dans les instructions', () => {
  const plat = { id: 'p', nom: 'P', portionsBase: 4, ingredients: [ing('lardon', 100, 'g', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' })] };
  const enTetes = [
    texteDemandeRecette(plat).split('\n')[0],
    texteDemandeRecette(plat, { profils }).split('\n')[0],
    texteDemandeVariantes([plat], profils[0]).split('\n')[0],
    texteCorrectionPourClaude({ erreur: 'aucune' }).split('\n')[0],
    texteDemandeIdees({ profils }).split('\n')[0],
    texteDemandePrecautions([plat]).split('\n')[0],
    texteDemandeEtapes([plat]).split('\n')[0],
    texteDemandeBatch(ELEMENTS_BATCH, { semaine: SEMAINE_BATCH }).split('\n')[0],
  ];
  assert.deepEqual([...new Set(enTetes)], ['DEMANDE-RECETTE paquet@1', 'DEMANDE-VARIANTES paquet@1', 'CORRECTION paquet@1', 'DEMANDE-IDEES paquet@1', 'DEMANDE-PRECAUTIONS paquet@1', 'DEMANDE-ETAPES paquet@1', 'DEMANDE-BATCH paquet@1']);
  for (const enTete of enTetes) assert.ok(doc.includes(`\`${enTete}\``), `« ${enTete} » absent`);
  // Chaque code DEMANDE-… cité est connu.
  const cites = new Set(doc.match(/DEMANDE-[A-Z]+/g));
  assert.deepEqual([...cites].sort(), ['DEMANDE-BATCH', 'DEMANDE-ETAPES', 'DEMANDE-IDEES', 'DEMANDE-PRECAUTIONS', 'DEMANDE-RECETTE', 'DEMANDE-VARIANTES']);
});

test('les exemples de demandes sont ceux que l’app copie', () => {
  const exemples = blocs('');
  const quiche = { id: 'quiche-lardons', nom: 'Quiche aux lardons' };
  assert.ok(exemples.includes(texteDemandeRecette(quiche, { profils })), 'exemple DEMANDE-RECETTE différent du texte copié');

  const lot = [
    {
      id: 'carbonade-flamande', nom: 'Carbonade flamande', portionsBase: 4, ingredients: [
        ing('bœuf à braiser', 800, 'g', ['viande', 'boeuf'], { forme: 'morceaux' }),
        // Mijote plus de deux heures : ni `alcool_cru` ni autre repère (section 3, version 5).
        ing('bière brune', 25, 'cl'),
        ing('oignon jaune', 2, 'pc', ['legume'], { role: 'incorpore' }),
        ing('pain d\'épices', 2, 'tranche'),
        ing('moutarde', 1, 'cs'),
      ],
    },
    {
      id: 'risotto-champignons', nom: 'Risotto aux champignons', portionsBase: 4, ingredients: [
        ing('riz arborio', 300, 'g', ['feculent']),
        ing('champignon de paris', 250, 'g', ['legume'], { role: 'incorpore' }),
        ing('bouillon de volaille', 1, 'l', ['bouillon_viande']),
        ing('parmesan', 50, 'g', ['laitier']),
      ],
      // Sa version mer convient déjà : seule la végétale est « à faire ».
      variantes: [{ pour: 'profil-a', style: 'mer', frigoJours: 2, retirer: ['bouillon de volaille'], ajouter: [
        { produit: 'fumet de poisson', qtePortion: 25, unite: 'cl', rayon: 'epicerie_salee', marqueurs: ['poisson'] },
        { produit: 'crevette décortiquée', qtePortion: 80, unite: 'g', rayon: 'poissonnerie', marqueurs: ['fruits_de_mer'] },
      ], consigne: 'Cuire sa part au fumet de poisson ; crevettes poêlées ajoutées à la fin.' }],
    },
  ];
  assert.ok(exemples.includes(texteDemandeVariantes(lot, profils[0])), 'exemple DEMANDE-VARIANTES différent du texte copié');

  const sansForme = { format: FORMAT, plats: [{
    id: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', portionsBase: 4, ingredients: [
      { produit: 'pâtes courtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
      { produit: 'jambon blanc', qte: 4, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'] },
    ],
  }] };
  assert.ok(exemples.includes(texteCorrectionPourClaude(validerPaquet(sansForme, { profils }))), 'exemple CORRECTION différent du texte copié');

  // Réponse de versions refusée (« qte » au lieu de « qtePortion ») : tout le lot est redemandé, versions seules.
  const versionsRefusees = { format: FORMAT, plats: [
    { id: 'carbonade-flamande', nom: 'Carbonade flamande', variantes: [{ pour: 'profil-a', retirer: ['bœuf à braiser'],
      ajouter: [{ produit: 'seitan', qte: 150, unite: 'g', rayon: 'cremerie', marqueurs: [] }], consigne: 'Part au seitan.' }] },
    { id: 'risotto-champignons', nom: 'Risotto aux champignons', variantes: [{ pour: 'profil-a', retirer: ['bouillon de volaille'],
      ajouter: [{ produit: 'bouillon de légumes', qtePortion: 25, unite: 'cl', rayon: 'epicerie_salee', marqueurs: [] }], consigne: 'Bouillon de légumes.' }] },
  ] };
  assert.ok(exemples.includes(texteCorrectionPourClaude(validerPaquet(versionsRefusees, { profils }))), 'exemple CORRECTION de versions différent du texte copié');

  // Message d'idées refusé (une viande sans forme) : toutes les fiches du message sont redemandées (T2b+).
  // Version 7 : 3 fiches par message, chacune avec sa réalisation (T5-0b).
  const ideeRendue = (nom, ingredient) => ({
    id: slug(nom), nom, statutRecette: 'brouillon', portionsBase: 4, ingredients: [ingredient], etapes: ['Cuire'],
    realisation: [{ titre: 'Cuire', texte: 'Faites cuire à feu doux.', duree: 20, ingredients: [ingredient.produit] }],
    source: 'Idée de Claude',
  });
  const messageRefuse = { format: FORMAT, instructions: VERSION_INSTRUCTIONS, plats: [
    ideeRendue('Dahl de lentilles corail', ing('lentille corail', 300, 'g', ['feculent'])),
    ideeRendue('Boulettes de pois chiches au cumin', ing('pois chiche', 400, 'g', ['feculent'])),
    ideeRendue('Poulet au miso et patate douce', ing('haut de cuisse de poulet', 800, 'g', ['viande', 'volaille'])),
  ] };
  assert.ok(exemples.includes(texteCorrectionPourClaude(validerPaquet(messageRefuse, { profils }))), 'exemple CORRECTION d’un message d’idées différent du texte copié');

  // Demande d'idées : envie, versions avec styles, aimés, évités et plats déjà dans l'app (T2b+).
  const platsDeLApp = [
    { id: 'carbonade-flamande', nom: 'Carbonade flamande', notes: { 'profil-b': 5 } },
    { id: 'risotto-champignons', nom: 'Risotto aux champignons', notes: { 'profil-a': 5, 'profil-b': 3 } },
    { id: 'chou-farci', nom: 'Chou farci', notes: { 'profil-a': 0, 'profil-b': 0 } },
    { id: 'quiche-lardons', nom: 'Quiche aux lardons' },
    { id: 'gratin-pates-jambon', nom: 'Gratin de pâtes au jambon', notes: { 'profil-b': 4 } },
  ];
  const idees = texteDemandeIdees({ nombre: 10, envie: 'cuisine du monde', plats: platsDeLApp, profils });
  for (const debut of ['envie: ', 'versions:', 'aimés: ', 'évités: ', 'déjà dans l\'app: ']) {
    assert.ok(idees.split('\n').some((l) => l.startsWith(debut)), `ligne « ${debut} » absente de l’exemple`);
  }
  assert.ok(exemples.includes(idees), 'exemple DEMANDE-IDEES différent du texte copié');

  // Demande d'étapes détaillées (T5-0b) : deux plats, parts anonymes ; correction d'un message refusé.
  assert.ok(exemples.includes(texteDemandeEtapes([GRATIN, GATEAU])), 'exemple DEMANDE-ETAPES différent du texte copié');
  const fautive = structuredClone(REALISATION_GRATIN);
  fautive[7].duree = '20 min';
  const refuse = validerPaquet({ format: FORMAT, instructions: VERSION_INSTRUCTIONS, plats: [
    { id: GRATIN.id, nom: GRATIN.nom, empreinte: empreinteEtapes(GRATIN), realisation: fautive }] });
  assert.equal(refuse.valide, false);
  assert.ok(exemples.includes(texteCorrectionPourClaude(refuse)), 'exemple CORRECTION d’un message d’étapes différent du texte copié');

  // Plan de batch (2026-10-19) : la demande d'une semaine de trois plats, et la correction d'un plan refusé.
  assert.ok(exemples.includes(texteDemandeBatch(ELEMENTS_BATCH, { semaine: SEMAINE_BATCH })), 'exemple DEMANDE-BATCH différent du texte copié');
  const empreinte = empreintePlanBatch(ELEMENTS_BATCH);
  const planBatch = JSON.parse(blocs('json').find((r) => Object.hasOwn(JSON.parse(r), 'batch'))).batch;
  delete planBatch.etapes[9].ingredients;
  const refuseBatch = validerPlanBatch(planBatch, { elements: ELEMENTS_BATCH, semaineId: SEMAINE_BATCH.id, empreinte });
  assert.equal(refuseBatch.plan, null);
  assert.ok(exemples.includes(texteCorrectionBatch({ erreurs: refuseBatch.erreurs, semaineId: SEMAINE_BATCH.id })), 'exemple CORRECTION d’un plan de batch différent du texte copié');

  // Une demande recollée par erreur n'est jamais prise pour une réponse.
  for (const exemple of exemples) assert.equal(extrairePaquet(exemple).erreur, 'demande');
});

test('l’exemple de réponse à DEMANDE-ETAPES s’enregistre contre les fiches de la demande, sans avertissement', () => {
  const reponse = blocsDeFiches().map((r) => JSON.parse(r)).find((p) => p.plats.every((plat) => 'empreinte' in plat && 'realisation' in plat));
  assert.ok(reponse, 'exemple de réponse à DEMANDE-ETAPES absent');
  const validation = validerPaquet([reponse], { profils });
  assert.equal(validation.lotDEtapes, true);
  assert.equal(validation.valide, true);
  const prep = preparerImport(entreesPourImport(validation), { plats: [GRATIN, GATEAU], profils });
  assert.deepEqual(prep.elements.map((e) => [e.id, e.statut, e.avertissements]), [
    [GRATIN.id, 'etapes', []], [GATEAU.id, 'etapes', []],
  ]);
  assert.equal(prep.ecritures.length, 2);
  // La fiche du §2 porte la même réalisation que la réponse (les mêmes étapes, deux fois montrées).
  const fiche = blocsDeFiches().map((r) => JSON.parse(r)).find((p) => p.plats[0].id === GRATIN.id && p.plats[0].ingredients).plats[0];
  assert.deepEqual(fiche.realisation, reponse.plats[0].realisation);
  assert.deepEqual(fiche.etapes, reponse.plats[0].realisation.map((e) => e.titre));
});

test('la section 2 bis tient les règles de l’essai du 2026-10-12 : geste de fin d’attente, mains, réchauffage, longueur', () => {
  const section = doc.match(/\n## 2 bis\. La réalisation \(étapes détaillées\)\n([\s\S]*?)\n## 3\. /)?.[1];
  assert.ok(section, 'section 2 bis absente, ou pas entre les sections 2 et 3');
  for (const champ of ['titre', 'texte', 'duree', 'actif', 'appareil', 'mode', 'tempC', 'feu', 'ustensiles', 'ingredients', 'aussi', 'pret', 'apres', 'auService', 'veille', 'partAvant']) {
    assert.ok(section.includes(`\`${champ}\``), `champ « ${champ} » absent de la section 2 bis`);
  }
  assert.ok(section.includes('`"reperesARevoir": true`'), 'reperesARevoir absent de la section 2 bis');
  for (const feu of ['`doux`', '`moyen`', '`vif`']) assert.ok(section.includes(feu), feu);
  assert.match(section, /2 ou 3 phrases courtes, 350 caractères au plus/);
  assert.match(section, /« Cuire au four » puis « Sortir du four »/);
  assert.match(section, /viande crue \(bœuf, porc, lardons, volaille…\), du poisson cru ou des œufs crus/);
  assert.match(section, /réchauffer au four à 160 °C un gratin cuit à 180 °C/);
});

test('l’exemple de fiche de DEMANDE-IDEES est une idée de Claude, au statut brouillon, avec ses versions', () => {
  const idees = blocsDeFiches().map((r) => JSON.parse(r)).filter((p) => p.plats.some((plat) => plat.source === 'Idée de Claude'));
  assert.equal(idees.length, 1, 'un exemple de fiche rendue à DEMANDE-IDEES');
  for (const plat of idees[0].plats) {
    // L'identifiant d'une idée est le slug de son nom (section 5), comme Claude doit le créer.
    assert.equal(plat.id, slug(plat.nom));
    assert.equal(plat.statutRecette, 'brouillon');
    assert.ok(plat.ingredients.length > 0);
    assert.deepEqual(plat.variantes.map((v) => `${v.pour}/${v.style}`).sort(), ['profil-a/mer', 'profil-a/vegetal']);
  }
});

test('l’exemple de plan de batch s’enregistre contre les plats de la demande, sans erreur ni avertissement', () => {
  const blocsBatch = blocs('json').filter((r) => Object.hasOwn(JSON.parse(r), 'batch'));
  assert.equal(blocsBatch.length, 1, 'un exemple de réponse à DEMANDE-BATCH');
  const extrait = extrairePaquet(`Voici le plan.\n\n\`\`\`json\n${blocsBatch[0]}\n\`\`\``);
  assert.ok(extrait.paquets);
  assert.equal(controlerInstructions(extrait.paquets), null);
  const resultat = validerPlanBatch(extrait.paquets[0].batch, {
    elements: ELEMENTS_BATCH, semaineId: SEMAINE_BATCH.id, empreinte: empreintePlanBatch(ELEMENTS_BATCH),
  });
  assert.deepEqual([resultat.erreurs, resultat.avertissements, resultat.refus], [[], [], null]);
  assert.ok(resultat.plan.etapes.some((e) => e.plats.length > 1), 'l’exemple regroupe au moins une étape pour deux plats');
  assert.ok(resultat.plan.etapes.some((e) => e.prechauffer), 'l’exemple allume le four');
  assert.ok(resultat.plan.etapes.some((e) => e.partAvant), 'l’exemple met une part de côté');
});

test('les exemples de réponses s’ajoutent sans erreur ni avertissement', () => {
  const reponses = blocsDeFiches();
  assert.ok(reponses.length >= 3, 'au moins un exemple de fiche, de recette demandée et de versions');
  for (const reponse of reponses) {
    const extrait = extrairePaquet(`Voici la fiche.\n\n\`\`\`json\n${reponse}\n\`\`\``);
    assert.ok(extrait.paquets, `exemple illisible : ${reponse.slice(0, 60)}`);
    const resultat = validerPaquet(extrait.paquets, { profils });
    const messages = [...resultat.erreurs, ...resultat.avertissements,
      ...resultat.plats.flatMap((p) => [...p.erreurs, ...p.avertissements])].map((e) => e.pourClaude);
    assert.equal(resultat.valide, true, messages.join('\n'));
    assert.deepEqual(messages, []);
    // Chaque exemple porte la version des instructions de l'app : aucun avertissement de version.
    assert.equal(controlerInstructions(extrait.paquets), null, `version des instructions : ${reponse.slice(0, 60)}`);
  }
  // L'exemple de versions ne rend que { id, nom, variantes }.
  const versions = JSON.parse(reponses.find((r) => !r.includes('"ingredients"')));
  for (const plat of versions.plats) assert.deepEqual(Object.keys(plat).sort(), ['id', 'nom', 'variantes']);
});

test('aucune donnée personnelle : ni adresse, ni autre identifiant de profil que les génériques', () => {
  assert.doesNotMatch(doc, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  for (const [, id] of doc.matchAll(/"?pour"?\s*:\s*"?([a-z0-9-]+)/g)) assert.ok(PROFILS_PERMIS.includes(id), `profil « ${id} »`);
  for (const [id] of doc.matchAll(/profil-[a-z0-9-]+/g)) assert.ok(PROFILS_PERMIS.includes(id), `profil « ${id} »`);
});

test('les aliments permis à un profil sans viande gardent leur repère (œufs, fromages, beurre, miel)', () => {
  assert.doesNotMatch(doc, /sans repère particulier/);
  const phrase = doc.split('\n').find((l) => l.startsWith('Ne relèvent pas de la viande'));
  assert.ok(phrase, 'phrase des aliments permis absente');
  for (const repere of ['`oeuf`', '`laitier`', '`miel`', '`poisson`']) assert.ok(phrase.includes(repere), repere);
});

test('`reperesARevoir` n’est demandé que dans une réponse à DEMANDE-ETAPES (une fiche complète l’ignorerait)', () => {
  const lignes = doc.split('\n').filter((l) => l.includes('reperesARevoir'));
  assert.ok(lignes.length >= 2);
  for (const l of lignes) assert.match(l, /DEMANDE-ETAPES|empreinte/, `ligne qui demande reperesARevoir hors DEMANDE-ETAPES : ${l}`);
  assert.ok(lignes.some((l) => /jamais dans une fiche complète/.test(l)));
  // L'app ne le connaît que dans un lot d'étapes : une fiche complète le traite comme un champ inconnu.
  assert.ok(!CHAMPS_PLAT.includes('reperesARevoir'));
});
