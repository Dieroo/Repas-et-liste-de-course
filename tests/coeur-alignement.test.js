// Alignement de l'app et du projet Claude : chaque texte copié porte la version des instructions attendue, chaque
// réponse la sienne (controlerInstructions), les refus de Claude sont reconnus (extrairePaquet), et
// docs/projet-claude.md ne change pas sans que VERSION_INSTRUCTIONS augmente. Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  VERSION_INSTRUCTIONS, EMPREINTE_INSTRUCTIONS, texteDemandeIdees, texteDemandeRecette, texteDemandeVariantes,
  texteCorrectionPourClaude,
} from '../js/coeur/claude.js';
import { FORMAT, extrairePaquet, validerPaquet, controlerInstructions } from '../js/coeur/paquet.js';
import { creerSauvegarde, lireSauvegarde, validerSauvegarde } from '../js/coeur/sauvegarde.js';
import { ecrireRegime } from '../js/coeur/regles.js';

const docBrut = await readFile(new URL('../docs/projet-claude.md', import.meta.url));
const doc = docBrut.toString('utf8');

// ——— Fixtures ———

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande' });
const PROFILS = [
  { id: 'profil-a', nom: 'Adulte A', ordre: 0, coefPortion: 1, regles: SANS_VIANDE },
  { id: 'profil-b', nom: 'Adulte B', ordre: 1, coefPortion: 1, regles: [] },
  { id: 'enfant', nom: 'Enfant', ordre: 2, coefPortion: 0.5 },
];
const LARDONS = ing('lardon fumé', 200, 'g', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' });
const QUICHE = {
  id: 'quiche-test', nom: 'Quiche test', portionsBase: 4,
  ingredients: [ing('pâte brisée', 1, 'pc', ['feculent']), LARDONS, ing('œuf', 3, 'pc', ['oeuf'])],
};
const TOFU = { produit: 'tofu fumé', qtePortion: 100, unite: 'g', rayon: 'cremerie', marqueurs: [] };
const paquet = (...plats) => ({ format: FORMAT, instructions: VERSION_INSTRUCTIONS, plats });
const bloc = (objet) => `Voici la fiche.\n\n\`\`\`json\n${JSON.stringify(objet, null, 2)}\n\`\`\`\n`;

/** Contenu des blocs de code d'un langage donné ('' : blocs sans langage). */
function blocs(langage) {
  return [...doc.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].filter((m) => m[1] === langage).map((m) => m[2].trimEnd());
}

const ligneAttendue = `instructions: ${VERSION_INSTRUCTIONS}`;

// ——— Textes copiés ———

test('VERSION_INSTRUCTIONS est un entier positif ; EMPREINTE_INSTRUCTIONS, 12 caractères hexadécimaux', () => {
  assert.ok(Number.isInteger(VERSION_INSTRUCTIONS) && VERSION_INSTRUCTIONS >= 1);
  assert.match(EMPREINTE_INSTRUCTIONS, /^[0-9a-f]{12}$/);
});

test('chaque texte copié porte en deuxième ligne la version des instructions', () => {
  const versionsRefusees = validerPaquet([paquet(
    { id: 'quiche-test', nom: 'Quiche test', variantes: [{ pour: 'profil-a', retirer: ['lardon fumé'], ajouter: [{ ...TOFU, qte: 100, qtePortion: undefined }] }] },
    { id: 'gratin-test', nom: 'Gratin test', variantes: [{ pour: 'profil-a', retirer: ['jambon'], ajouter: [TOFU] }] },
  )], { profils: PROFILS });
  assert.equal(versionsRefusees.valide, false);
  const ficheEnErreur = validerPaquet([paquet({ ...QUICHE, ingredients: [{ ...LARDONS, forme: undefined }] })], { profils: PROFILS });
  assert.equal(ficheEnErreur.valide, false);
  const textes = {
    'recette sans profil': texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }),
    'recette avec profils': texteDemandeRecette({ id: 'plat-x', nom: 'Plat X' }, { profils: PROFILS }),
    variantes: texteDemandeVariantes([QUICHE], PROFILS[0]),
    'correction : réponse coupée': texteCorrectionPourClaude({ erreur: 'coupee' }),
    'correction : aucune fiche': texteCorrectionPourClaude({ erreur: 'aucune' }),
    'correction : fiche en erreur': texteCorrectionPourClaude(ficheEnErreur),
    'correction : versions qui ne conviennent pas': texteCorrectionPourClaude({
      erreurs: [], corrections: [{ pourClaude: 'id quiche-test variantes[pour=profil-a] : contient lardon fumé (viande), exclu pour profil-a' }],
    }),
    'correction : lot de versions refusé': texteCorrectionPourClaude(versionsRefusees),
    'correction : message de plusieurs fiches refusé': texteCorrectionPourClaude(validerPaquet([paquet(
      { ...QUICHE, ingredients: [{ ...LARDONS, forme: undefined }] }, { ...QUICHE, id: 'quiche-bis', nom: 'Quiche bis' },
    )], { profils: PROFILS })),
    'idées sans profil': texteDemandeIdees(),
    'idées avec profils et envie': texteDemandeIdees({ nombre: 5, envie: 'plats d’automne', plats: [QUICHE], profils: PROFILS }),
  };
  assert.match(textes['recette avec profils'], /\nversions:\n/);
  for (const [quoi, texte] of Object.entries(textes)) {
    const lignes = texte.split('\n');
    assert.match(lignes[0], /^(DEMANDE-RECETTE|DEMANDE-VARIANTES|DEMANDE-IDEES|CORRECTION) paquet@1$/, quoi);
    assert.equal(lignes[1], ligneAttendue, quoi);
    assert.equal(lignes.filter((l) => l.startsWith('instructions:')).length, 1, quoi);
    // Recollé par erreur, il reste reconnu comme une demande.
    assert.equal(extrairePaquet(texte).erreur, 'demande', quoi);
  }
});

// ——— controlerInstructions ———

const MESSAGES = {
  absente: 'Cette réponse ne dit pas avec quelles instructions elle a été écrite\u00A0: votre projet Claude a peut-être d’anciennes instructions. Recopiez-les depuis Réglages › Projet Claude.',
  ancienne: 'Cette réponse vient d’anciennes instructions du projet Claude. Recopiez-les depuis Réglages › Projet Claude, puis redemandez si quelque chose cloche.',
  recente: 'Cette réponse vient d’instructions plus récentes que votre app. Fermez puis rouvrez l’app avant d’ajouter ces recettes.',
};
const avec = (instructions) => ({ format: FORMAT, instructions, plats: [] });
const sans = () => ({ format: FORMAT, plats: [] });

test('controlerInstructions : à jour → null', () => {
  assert.equal(controlerInstructions([avec(VERSION_INSTRUCTIONS)]), null);
  assert.equal(controlerInstructions([avec(VERSION_INSTRUCTIONS), avec(VERSION_INSTRUCTIONS)]), null);
  assert.equal(controlerInstructions(avec(VERSION_INSTRUCTIONS)), null, 'un objet seul est accepté');
  assert.equal(controlerInstructions([avec(3)], 3), null);
  assert.equal(controlerInstructions([]), null);
});

test('controlerInstructions : absente, ancienne, récente', () => {
  assert.deepEqual(controlerInstructions([sans()]), {
    sens: 'absente', message: MESSAGES.absente, pourClaude: `instructions : ${VERSION_INSTRUCTIONS} attendu`,
  });
  assert.deepEqual(controlerInstructions([avec(1)], 2), { sens: 'ancienne', message: MESSAGES.ancienne, pourClaude: 'instructions : 2 attendu' });
  assert.deepEqual(controlerInstructions([avec(0)]), {
    sens: 'ancienne', message: MESSAGES.ancienne, pourClaude: `instructions : ${VERSION_INSTRUCTIONS} attendu`,
  });
  assert.deepEqual(controlerInstructions([avec(VERSION_INSTRUCTIONS + 1)]), {
    sens: 'recente', message: MESSAGES.recente, pourClaude: `instructions : ${VERSION_INSTRUCTIONS} attendu`,
  });
});

test('controlerInstructions : version en texte de chiffres acceptée ; toute autre valeur vaut absente', () => {
  assert.equal(controlerInstructions([avec(String(VERSION_INSTRUCTIONS))]), null);
  assert.equal(controlerInstructions([avec(` ${VERSION_INSTRUCTIONS} `)]), null);
  assert.equal(controlerInstructions([avec('2')], 2), null);
  assert.equal(controlerInstructions([avec('1')], 2).sens, 'ancienne');
  assert.equal(controlerInstructions([avec('3')], 2).sens, 'recente');
  for (const farfelue of [null, '', 'un', '1a', 'v1', '1.0', 1.5, -1, Number.NaN, Infinity, true, [1], { version: 1 }]) {
    assert.equal(controlerInstructions([avec(farfelue)])?.sens, 'absente', `valeur ${JSON.stringify(farfelue)}`);
  }
  assert.equal(controlerInstructions([null]).sens, 'absente');
});

test('controlerInstructions : plusieurs réponses → la pire (récente, puis ancienne, puis absente)', () => {
  const v = 5;
  assert.equal(controlerInstructions([avec(v), sans()], v).sens, 'absente');
  assert.equal(controlerInstructions([sans(), avec(4), avec(v)], v).sens, 'ancienne');
  assert.equal(controlerInstructions([avec(4), sans()], v).sens, 'ancienne');
  assert.equal(controlerInstructions([avec(6), avec(4), sans()], v).sens, 'recente');
  assert.equal(controlerInstructions([sans(), avec(4), avec(6)], v).sens, 'recente');
});

test('controlerInstructions : messages sans mot technique', () => {
  for (const sens of ['absente', 'ancienne', 'recente']) {
    const valeur = { absente: undefined, ancienne: VERSION_INSTRUCTIONS - 1, recente: VERSION_INSTRUCTIONS + 1 }[sens];
    const { message } = controlerInstructions([valeur === undefined ? sans() : avec(valeur)]);
    assert.equal(message, MESSAGES[sens]);
    assert.doesNotMatch(message, /json|paquet|format|instructions\s*:|attendu/i, sens);
    assert.doesNotMatch(message, /\bIA\b/, sens);
  }
});

// ——— validerPaquet : la clé `instructions` est connue ———

const IGNORE = 'Seules les recettes sont ajoutées ici\u00A0: le reste a été ignoré.';

test('validerPaquet : `instructions` ne déclenche pas l’avertissement « le reste a été ignoré »', () => {
  const r = validerPaquet([paquet(QUICHE)], { profils: PROFILS });
  assert.equal(r.valide, true);
  assert.deepEqual(r.avertissements, []);
  // Une version farfelue n'est pas une erreur de validation : seul controlerInstructions en parle.
  const farfelue = validerPaquet([{ ...paquet(QUICHE), instructions: 'n’importe quoi' }], { profils: PROFILS });
  assert.equal(farfelue.valide, true);
  assert.deepEqual(farfelue.avertissements, []);
});

test('validerPaquet : une autre clé inconnue garde l’avertissement', () => {
  const r = validerPaquet([{ ...paquet(QUICHE), reglages: { nbPlats: 4 } }], { profils: PROFILS });
  assert.equal(r.valide, true);
  assert.deepEqual(r.avertissements.map((a) => a.message), [IGNORE]);
  const sansVersion = validerPaquet([{ format: FORMAT, plats: [QUICHE], autre: 1 }], { profils: PROFILS });
  assert.deepEqual(sansVersion.avertissements.map((a) => a.message), [IGNORE]);
});

// ——— extrairePaquet : refus de Claude ———

const REFUS_INSTRUCTIONS = '⚠️ INSTRUCTIONS À METTRE À JOUR : mes instructions sont en version 1, la demande attend la version 2. Recopiez-les depuis Réglages › Projet Claude, puis renvoyez la demande.';
const REFUS_APP = '⚠️ APP À METTRE À JOUR : la demande vient d\'une version plus ancienne de l\'app. Fermez puis rouvrez l\'app, puis recopiez la demande.';

test('extrairePaquet : phrase « instructions à mettre à jour » → instructions', () => {
  assert.deepEqual(extrairePaquet(REFUS_INSTRUCTIONS), { erreur: 'instructions' });
  for (const variante of [
    'INSTRUCTIONS À METTRE À JOUR : mes instructions sont en version 1.',
    'instructions a mettre a jour',
    'Instructions à Mettre à Jour.',
    '**⚠️ INSTRUCTIONS\u00A0À METTRE\u00A0À  JOUR** : voir Réglages.',
    `Bonjour,\n\n> ${REFUS_INSTRUCTIONS}\n`,
    `\`\`\`\n${REFUS_INSTRUCTIONS}\n\`\`\``,
  ]) {
    assert.deepEqual(extrairePaquet(variante), { erreur: 'instructions' }, variante);
  }
});

test('extrairePaquet : phrase « app à mettre à jour » → app', () => {
  assert.deepEqual(extrairePaquet(REFUS_APP), { erreur: 'app' });
  for (const variante of ['APP À METTRE À JOUR', 'app a mettre a jour : fermez puis rouvrez.', '⚠️ App À mettre À jour', `> ${REFUS_APP}`]) {
    assert.deepEqual(extrairePaquet(variante), { erreur: 'app' }, variante);
  }
});

test('extrairePaquet : une recette lisible l’emporte sur une phrase de refus', () => {
  for (const refus of [REFUS_INSTRUCTIONS, REFUS_APP]) {
    const avant = extrairePaquet(`${refus}\n\n${bloc(paquet(QUICHE))}`);
    assert.equal(avant.paquets?.length, 1, refus);
    const apres = extrairePaquet(`${bloc(paquet(QUICHE))}\n${refus}`);
    assert.equal(apres.paquets?.length, 1, refus);
  }
});

test('extrairePaquet : sans phrase de refus, les codes d’avant ne changent pas', () => {
  assert.equal(extrairePaquet('Je n’ai pas compris la demande.').erreur, 'aucune');
  assert.equal(extrairePaquet('Mettez à jour votre liste de courses.').erreur, 'aucune');
  assert.equal(extrairePaquet(bloc(paquet(QUICHE)).slice(0, 80)).erreur, 'coupee');
  assert.equal(extrairePaquet('').erreur, 'vide');
  assert.equal(extrairePaquet(texteDemandeRecette({ id: 'x', nom: 'X' })).erreur, 'demande');
});

test('extrairePaquet : une phrase de refus citée dans la prose ne compte pas', () => {
  // Réponse au lot de versions, coupée : la prose cite les mots du refus sans être un refus.
  const coupee = bloc(paquet(QUICHE)).slice(0, 120);
  for (const prose of [
    'Rien à signaler : pas d’instructions à mettre à jour.',
    'Si besoin, c’est l’app à mettre à jour, pas vos instructions.',
    '**Rien à signaler** : pas d’instructions à mettre à jour.',
  ]) {
    assert.equal(extrairePaquet(`${prose}\n\n${coupee}`).erreur, 'coupee', prose);
    assert.equal(extrairePaquet(`${prose}\n\n${bloc(paquet(QUICHE))}`).paquets?.length, 1, prose);
    assert.equal(extrairePaquet(prose).erreur, 'aucune', prose);
  }
  // Recette coupée, même précédée d'une ligne qui commence comme un refus : la coupure l'emporte (bouton de correction).
  assert.equal(extrairePaquet(`${REFUS_INSTRUCTIONS}\n\n${coupee}`).erreur, 'coupee');
  assert.equal(extrairePaquet(`${REFUS_APP}\n${coupee}`).erreur, 'coupee');
  // Limite de mot : « whatsapp » n'est pas « app », « appli » non plus.
  for (const texte of ['whatsapp à mettre à jour', 'WhatsApp à mettre à jour, puis relancez.', 'Mon whatsapp a mettre a jour', 'instructions a mettre a journal']) {
    assert.equal(extrairePaquet(texte).erreur, 'aucune', texte);
  }
  // Une sauvegarde coupée qui cite ces mots reste « coupée », pas « illisible ».
  const { texte } = creerSauvegarde({ plats: [{ ...QUICHE, nom: 'Instructions à mettre à jour' }], profils: PROFILS },
    { maintenant: new Date('2026-10-08T10:00:00Z') });
  assert.deepEqual(lireSauvegarde(`Note : app à mettre à jour.\n${texte.slice(0, Math.floor(texte.length / 2))}`), { erreur: 'coupee' });
});

// ——— docs/projet-claude.md ———

test('garde-fou : docs/projet-claude.md ne change pas sans que VERSION_INSTRUCTIONS augmente', () => {
  const empreinte = createHash('sha256').update(docBrut).digest('hex').slice(0, 12);
  assert.equal(empreinte, EMPREINTE_INSTRUCTIONS, [
    'docs/projet-claude.md a changé : les instructions collées dans le projet Claude ne sont plus celles de l’app.',
    `1. Augmentez VERSION_INSTRUCTIONS (js/coeur/claude.js, ${VERSION_INSTRUCTIONS} → ${VERSION_INSTRUCTIONS + 1}) et la version`,
    '   écrite dans docs/projet-claude.md (en-tête, section 0, exemples « instructions »).',
    `2. Mettez ensuite EMPREINTE_INSTRUCTIONS à la nouvelle empreinte (actuelle : ${empreinte}).`,
  ].join('\n'));
});

test('docs : l’en-tête et la section 0 citent la version de l’app ; toute version écrite est la même', () => {
  assert.equal(doc.split('\n')[0], `# Instructions du projet Claude — version ${VERSION_INSTRUCTIONS}`);
  const section0 = doc.match(/\n## 0\. Version et alignement avec l'app\n([\s\S]*?)\n## 1\. /)?.[1];
  assert.ok(section0, 'section 0 absente, ou pas juste avant la section 1');
  assert.ok(doc.indexOf('## 0. ') < doc.indexOf('## 1. Ton rôle'), 'section 0 avant « 1. Ton rôle »');
  assert.ok(section0.includes(`version ${VERSION_INSTRUCTIONS}`) || section0.includes(`**version ${VERSION_INSTRUCTIONS}**`));
  assert.ok(section0.includes(`"instructions": ${VERSION_INSTRUCTIONS}`));
  assert.ok(section0.includes('PROPOSITION pour Claude Code'), 'modèle de proposition pour Claude Code absent');
  for (const [, n] of doc.matchAll(/\bversion \**(\d+)/g)) assert.equal(Number(n), VERSION_INSTRUCTIONS, `version ${n}`);
  for (const [, n] of doc.matchAll(/"instructions":\s*(\d+)/g)) assert.equal(Number(n), VERSION_INSTRUCTIONS, `"instructions": ${n}`);
  for (const [, n] of doc.matchAll(/^instructions: (\d+)$/gm)) assert.equal(Number(n), VERSION_INSTRUCTIONS, `instructions: ${n}`);
});

test('docs : chaque exemple de réponse porte la version, juste après le format', () => {
  const reponses = blocs('json');
  assert.ok(reponses.length >= 3);
  for (const reponse of reponses) {
    const objet = JSON.parse(reponse);
    assert.deepEqual(Object.keys(objet).slice(0, 2), ['format', 'instructions'], reponse.slice(0, 60));
    assert.equal(objet.instructions, VERSION_INSTRUCTIONS);
    assert.equal(controlerInstructions([objet]), null);
  }
});

test('docs : chaque exemple de demande porte la ligne de version en deuxième ligne', () => {
  const demandes = blocs('').filter((b) => /^(DEMANDE-|CORRECTION )/.test(b));
  assert.ok(demandes.length >= 5, 'exemples DEMANDE-RECETTE, DEMANDE-VARIANTES, deux CORRECTION et DEMANDE-IDEES');
  assert.equal(demandes.length, blocs('').length, 'un bloc sans langage n’est qu’un exemple de demande');
  for (const demande of demandes) assert.equal(demande.split('\n')[1], ligneAttendue, demande.split('\n')[0]);
});

test('docs : les deux phrases de refus sont reconnues par l’app', () => {
  const phrases = doc.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('> ⚠️'));
  const codes = phrases.map((phrase) => extrairePaquet(phrase.replace(/^>\s*/, '')).erreur);
  assert.deepEqual(codes.sort(), ['app', 'instructions']);
  // Phrases remplies par Claude (version et nombre réels) : toujours reconnues.
  for (const phrase of phrases) {
    const rempli = phrase.replace(/^>\s*/, '').replace('<ta version>', '1').replace('<n>', '2');
    assert.ok(['app', 'instructions'].includes(extrairePaquet(rempli).erreur), rempli);
  }
});

// ——— Sauvegarde ———

test('non-régression : une sauvegarde validée n’a aucun avertissement de version', async () => {
  const plats = [{ ...QUICHE, statutRecette: 'brouillon', notes: { 'profil-a': 4 } }, { id: 'attente-test', nom: 'Attente test' }];
  const { texte } = creerSauvegarde({ plats, profils: PROFILS }, { maintenant: new Date('2026-10-08T10:00:00Z') });
  const lu = lireSauvegarde(texte);
  assert.ok(lu.sauvegarde);
  assert.equal(Object.hasOwn(lu.sauvegarde, 'instructions'), false, 'une sauvegarde ne porte pas de version d’instructions');
  const validation = validerSauvegarde(lu.sauvegarde);
  assert.equal(validation.valide, true);
  assert.deepEqual(validation.avertissements, []);
  const messages = new Set(Object.values(MESSAGES));
  assert.ok(validation.avertissements.every((a) => !messages.has(a)));
  const source = await readFile(new URL('../js/coeur/sauvegarde.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /controlerInstructions/);
});

test('aucune espace insécable écrite telle quelle dans les fichiers de l’alignement', async () => {
  for (const fichier of ['../js/coeur/claude.js', '../js/coeur/paquet.js', './coeur-alignement.test.js', './projet-claude.test.js']) {
    const source = await readFile(new URL(fichier, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
  }
});
