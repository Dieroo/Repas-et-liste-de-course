// Garde-fous de docs/projet-claude.md (T2b) : les instructions copiées dans le projet Claude suivent le code de l'app
// (vocabulaires, champs, codes des demandes) et leurs exemples s'ajoutent tels quels. Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VOCABULAIRES } from '../js/coeur/vocabulaire.js';
import { CHAMPS_PLAT, FORMAT, validerPaquet, extrairePaquet } from '../js/coeur/paquet.js';
import { texteDemandeRecette, texteDemandeVariantes, texteCorrectionPourClaude } from '../js/coeur/claude.js';
import { ecrireRegime } from '../js/coeur/regles.js';

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

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });

test('en tête : titre et version des instructions', () => {
  assert.match(doc.split('\n')[0], /^# Instructions du projet Claude — version T2 \(2026-10\)$/);
});

test('chaque valeur des vocabulaires fermés figure dans les instructions', () => {
  for (const [champ, valeurs] of Object.entries(VOCABULAIRES)) {
    for (const valeur of valeurs) assert.ok(doc.includes(`\`${valeur}\``), `${champ} : « ${valeur} » absent`);
  }
});

test('chaque champ d’une fiche figure dans les instructions', () => {
  for (const champ of CHAMPS_PLAT) assert.ok(doc.includes(`\`${champ}\``), `champ « ${champ} » absent`);
  for (const champ of ['format', 'plats', 'qtePortion', 'forme', 'role', 'pour', 'retirer', 'ajouter', 'consigne']) {
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
  ];
  assert.deepEqual([...new Set(enTetes)], ['DEMANDE-RECETTE paquet@1', 'DEMANDE-VARIANTES paquet@1', 'CORRECTION paquet@1']);
  for (const enTete of enTetes) assert.ok(doc.includes(`\`${enTete}\``), `« ${enTete} » absent`);
  assert.ok(doc.includes('`DEMANDE-IDEES`'), 'DEMANDE-IDEES (annoncé pour plus tard) absent');
  // Chaque code DEMANDE-… cité est connu.
  const cites = new Set(doc.match(/DEMANDE-[A-Z]+/g));
  assert.deepEqual([...cites].sort(), ['DEMANDE-IDEES', 'DEMANDE-RECETTE', 'DEMANDE-VARIANTES']);
});

test('les exemples de demandes sont ceux que l’app copie', () => {
  const exemples = blocs('');
  const quiche = { id: 'quiche-lardons', nom: 'Quiche aux lardons' };
  assert.ok(exemples.includes(texteDemandeRecette(quiche, { profils })), 'exemple DEMANDE-RECETTE différent du texte copié');

  const lot = [
    {
      id: 'carbonade-flamande', nom: 'Carbonade flamande', portionsBase: 4, ingredients: [
        ing('bœuf à braiser', 800, 'g', ['viande', 'boeuf'], { forme: 'morceaux' }),
        ing('bière brune', 25, 'cl', ['alcool_cru']),
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

  // Une demande recollée par erreur n'est jamais prise pour une réponse.
  for (const exemple of exemples) assert.equal(extrairePaquet(exemple).erreur, 'demande');
});

test('les exemples de réponses s’ajoutent sans erreur ni avertissement', () => {
  const reponses = blocs('json');
  assert.ok(reponses.length >= 3, 'au moins un exemple de fiche, de recette demandée et de versions');
  for (const reponse of reponses) {
    const extrait = extrairePaquet(`Voici la fiche.\n\n\`\`\`json\n${reponse}\n\`\`\``);
    assert.ok(extrait.paquets, `exemple illisible : ${reponse.slice(0, 60)}`);
    const resultat = validerPaquet(extrait.paquets, { profils });
    const messages = [...resultat.erreurs, ...resultat.avertissements,
      ...resultat.plats.flatMap((p) => [...p.erreurs, ...p.avertissements])].map((e) => e.pourClaude);
    assert.equal(resultat.valide, true, messages.join('\n'));
    assert.deepEqual(messages, []);
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

test('les aliments permis à un profil sans viande gardent leur repère (œufs, fromages, beurre)', () => {
  assert.doesNotMatch(doc, /sans repère particulier/);
  const phrase = doc.split('\n').find((l) => l.startsWith('Ne relèvent pas de la viande'));
  assert.ok(phrase, 'phrase des aliments permis absente');
  for (const repere of ['`oeuf`', '`laitier`', '`poisson`']) assert.ok(phrase.includes(repere), repere);
});
