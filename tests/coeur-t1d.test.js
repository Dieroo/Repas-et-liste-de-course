// T1d-1 : notes des plats, file de Découvrir, personne connectée reliée à son profil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_MAX, NOTE_PAR_DEFAUT, LIBELLES_NOTE, TEXTE_NON_NOTE, GESTES,
  noteValide, noteDe, estNote, noteRetenue, jamaisPropose, libelleNote, cheminNote, avecNote,
  profilsNotables, melanger, aDecouvrir, fileDecouverte, suivant, completerFile, nombreANoter, bilan,
  texteIngredients, resumeNotes, grainePour, deNom,
} from '../js/coeur/notes.js';
import { estEnfant, profilsARelier, preparerReliure, preparerDeliure, preparerProfil } from '../js/coeur/profils.js';
import { normaliserPourEdition, preparerModification } from '../js/coeur/edition.js';
import { validerPaquet, preparerImport } from '../js/coeur/paquet.js';

// ——— Fixtures génériques (aucune donnée du foyer) ———

const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: '', ordre: 2, coefPortion: 1 };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5 };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A]; // volontairement dans le désordre

const clone = (valeur) => JSON.parse(JSON.stringify(valeur));

/** Gèle une valeur à toute profondeur : toute modification lève une erreur en mode strict. */
function geler(valeur) {
  if (valeur && typeof valeur === 'object') {
    for (const v of Object.values(valeur)) geler(v);
    Object.freeze(valeur);
  }
  return valeur;
}

/** Plat minimal ; `recette: true` lui donne un statut autre que ⏳. */
function plat(id, { type, recette = true, notes, nom = `Plat ${id}` } = {}) {
  return {
    id,
    nom,
    ...(type ? { type } : {}),
    ...(recette ? { statutRecette: 'brouillon' } : {}),
    ...(notes ? { notes } : {}),
  };
}

// Aucun mot technique ni code dans un texte affiché ou lu par TalkBack.
const INTERDITS = /paquet|slug|json|\bIA\b|undefined|null|NaN|\[object|`|[{}[\]_]/i;
const CODES = /notes\.|profil-[a-z]|\b(validee|apero|attente|brouillon|preparation|accompagnement|coefPortion|statutRecette|ingredients|produit|gauche|droite|haut)\b/;

function textesPropres(textes) {
  assert.ok(textes.length > 0);
  for (const texte of textes) {
    assert.equal(typeof texte, 'string');
    assert.notEqual(texte.trim(), '', 'texte vide');
    assert.doesNotMatch(texte, INTERDITS, texte);
    assert.doesNotMatch(texte, CODES, texte);
    assert.doesNotMatch(texte, /\u00A0{2}| {2}|\u00A0 | \u00A0/, texte);
  }
}

// ——— Constantes ———

test('constantes : six libellés de 0 à 5, trois gestes, non noté = 3', () => {
  assert.equal(NOTE_MAX, 5);
  assert.equal(NOTE_PAR_DEFAUT, 3);
  assert.deepEqual(LIBELLES_NOTE, ['Jamais', 'Pas trop', 'Bof', 'Pourquoi pas', 'J’aime bien', 'J’adore']);
  assert.equal(LIBELLES_NOTE.length, NOTE_MAX + 1);
  assert.equal(TEXTE_NON_NOTE, 'Pas encore noté · compte comme Pourquoi pas');
  assert.deepEqual(GESTES, [
    { note: 0, emoji: '👎', libelle: 'Jamais', sortie: 'gauche' },
    { note: 3, emoji: '👍', libelle: 'Pourquoi pas', sortie: 'haut' },
    { note: 5, emoji: '❤️', libelle: 'J’adore', sortie: 'droite' },
  ]);
  // Chaque geste porte le libellé de sa note.
  for (const geste of GESTES) assert.equal(geste.libelle, LIBELLES_NOTE[geste.note]);
});

// ——— Lecture d'une note ———

test('noteValide : entier de 0 à 5, 0 compris', () => {
  for (const note of [0, 1, 2, 3, 4, 5]) assert.equal(noteValide(note), true, String(note));
  for (const v of ['4', 4.5, 2.5, 6, -1, null, undefined, NaN, true, Infinity, {}]) assert.equal(noteValide(v), false, String(v));
});

test('noteDe : 0 renvoie 0 ; note absente ou abîmée → null', () => {
  assert.equal(noteDe(plat('p', { notes: { 'profil-a': 0 } }), 'profil-a'), 0);
  assert.equal(noteDe(plat('p', { notes: { 'profil-a': 4 } }), 'profil-a'), 4);
  for (const abimee of ['4', 4.5, 6, -1, null]) {
    assert.equal(noteDe(plat('p', { notes: { 'profil-a': abimee } }), 'profil-a'), null, String(abimee));
  }
  assert.equal(noteDe(plat('p'), 'profil-a'), null); // notes absent
  assert.equal(noteDe(plat('p', { notes: { 'profil-b': 5 } }), 'profil-a'), null); // autre profil
  assert.equal(noteDe({ id: 'p', notes: 'abîmé' }, 'profil-a'), null);
  assert.equal(noteDe({ id: 'p', notes: [5] }, '0'), null);
  assert.equal(noteDe(null, 'profil-a'), null);
  assert.equal(noteDe(plat('p', { notes: { 'profil-a': 5 } }), undefined), null);
  // Clés héritées ignorées.
  assert.equal(noteDe(plat('p', { notes: {} }), 'toString'), null);
});

test('estNote : vrai pour 0 et pour 3, faux pour absent ou abîmé', () => {
  assert.equal(estNote(plat('p', { notes: { 'profil-a': 0 } }), 'profil-a'), true);
  assert.equal(estNote(plat('p', { notes: { 'profil-a': 3 } }), 'profil-a'), true);
  assert.equal(estNote(plat('p'), 'profil-a'), false);
  assert.equal(estNote(plat('p', { notes: { 'profil-a': '3' } }), 'profil-a'), false);
});

test('noteRetenue et jamaisPropose : absent → 3, 0 → 0, abîmé → 3', () => {
  assert.equal(noteRetenue(plat('p'), 'profil-a'), 3);
  assert.equal(noteRetenue(plat('p', { notes: { 'profil-a': 0 } }), 'profil-a'), 0);
  assert.equal(noteRetenue(plat('p', { notes: { 'profil-a': '5' } }), 'profil-a'), 3);
  assert.equal(noteRetenue(plat('p', { notes: { 'profil-a': 4 } }), 'profil-a'), 4);
  assert.equal(jamaisPropose(plat('p', { notes: { 'profil-a': 0 } }), 'profil-a'), true);
  for (const note of [1, 2, 3, 4, 5, '0', null]) {
    assert.equal(jamaisPropose(plat('p', { notes: { 'profil-a': note } }), 'profil-a'), false, String(note));
  }
  assert.equal(jamaisPropose(plat('p'), 'profil-a'), false);
});

test('libelleNote : textes exacts ; sans note → « Pas encore noté · compte comme Pourquoi pas »', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(libelleNote), ['Jamais', 'Pas trop', 'Bof', 'Pourquoi pas', 'J’aime bien', 'J’adore']);
  assert.equal(libelleNote(null), 'Pas encore noté · compte comme Pourquoi pas');
  assert.equal(libelleNote(undefined), TEXTE_NON_NOTE);
  assert.equal(libelleNote('4'), TEXTE_NON_NOTE);
});

// ——— Écriture d'une note ———

test('cheminNote : slug strict seulement', () => {
  assert.equal(cheminNote('profil-a'), 'notes.profil-a');
  assert.equal(cheminNote('enfant'), 'notes.enfant');
  assert.equal(cheminNote('profil-2'), 'notes.profil-2');
  for (const refuse of ['', 'A', 'a.b', '../x', 'a b', 'a/b', '__proto__', 'é', null, undefined, 3]) {
    assert.equal(cheminNote(refuse), null, String(refuse));
  }
});

test('avecNote : ajout, remplacement, retrait ; l’original reste intact', () => {
  const original = geler(plat('p', { notes: { 'profil-b': 4 } }));
  const ajoute = avecNote(original, 'profil-a', 5);
  assert.deepEqual(ajoute.notes, { 'profil-b': 4, 'profil-a': 5 });
  assert.equal(ajoute.nom, original.nom);
  assert.notEqual(ajoute, original);
  const remplace = avecNote(ajoute, 'profil-a', 0);
  assert.deepEqual(remplace.notes, { 'profil-b': 4, 'profil-a': 0 }); // 0 est une vraie note
  assert.deepEqual(ajoute.notes, { 'profil-b': 4, 'profil-a': 5 });
  const retire = avecNote(remplace, 'profil-a', null);
  assert.deepEqual(retire.notes, { 'profil-b': 4 });
  assert.deepEqual(remplace.notes, { 'profil-b': 4, 'profil-a': 0 });
  assert.deepEqual(original, { id: 'p', nom: 'Plat p', statutRecette: 'brouillon', notes: { 'profil-b': 4 } });
  // Plat jamais noté.
  const sansNotes = geler(plat('q'));
  assert.deepEqual(avecNote(sansNotes, 'enfant', 3).notes, { enfant: 3 });
  assert.equal('notes' in sansNotes, false);
  // Valeur qui n'est pas une note : retirée, jamais écrite telle quelle.
  assert.deepEqual(avecNote(original, 'profil-b', 7).notes, {});
  // Identifiant refusé : copie inchangée.
  assert.deepEqual(avecNote(original, 'a.b', 5).notes, { 'profil-b': 4 });
  assert.deepEqual(avecNote(original, '__proto__', 5).notes, { 'profil-b': 4 });
});

// ——— Pour qui la personne connectée peut noter ———

test('estEnfant : portion de moins d’un adulte', () => {
  assert.equal(estEnfant(ENFANT), true);
  assert.equal(estEnfant(ADULTE_A), false);
  assert.equal(estEnfant({ coefPortion: 0.75 }), true);
  assert.equal(estEnfant({}), false);
  assert.equal(estEnfant(null), false);
});

test('profilsNotables : soi d’abord, puis l’enfant sans adresse', () => {
  const notables = profilsNotables(PROFILS, ADULTE_A);
  assert.deepEqual(notables.map(({ profil, estMoi }) => [profil.id, estMoi]), [['profil-a', true], ['enfant', false]]);
  assert.equal(notables[0].profil, ADULTE_A);
});

test('profilsNotables : un autre adulte n’y figure jamais, avec ou sans adresse', () => {
  const avecAdresse = { ...ADULTE_B, email: 'b@example.com' };
  assert.deepEqual(profilsNotables([ADULTE_A, ADULTE_B, ENFANT], ADULTE_A).map((n) => n.profil.id), ['profil-a', 'enfant']);
  assert.deepEqual(profilsNotables([ADULTE_A, avecAdresse, ENFANT], avecAdresse).map((n) => n.profil.id), ['profil-b', 'enfant']);
});

test('profilsNotables : un enfant qui a son adresse note lui-même', () => {
  const enfantRelie = { ...ENFANT, email: 'enfant@example.com' };
  assert.deepEqual(profilsNotables([ADULTE_A, enfantRelie], ADULTE_A).map((n) => n.profil.id), ['profil-a']);
  // L'enfant connecté note pour lui-même, une seule fois.
  assert.deepEqual(profilsNotables([ADULTE_A, enfantRelie], enfantRelie).map((n) => [n.profil.id, n.estMoi]), [['enfant', true]]);
});

test('profilsNotables : sans personne reconnue, l’enfant seul ; enfants dans l’ordre d’affichage', () => {
  assert.deepEqual(profilsNotables(PROFILS, null).map((n) => [n.profil.id, n.estMoi]), [['enfant', false]]);
  const cadet = { id: 'cadet', nom: 'Cadet', email: '', ordre: 4, coefPortion: 0.5 };
  assert.deepEqual(profilsNotables([cadet, ...PROFILS], ADULTE_A).map((n) => n.profil.id), ['profil-a', 'enfant', 'cadet']);
  assert.deepEqual(profilsNotables([], null), []);
  assert.deepEqual(profilsNotables(undefined, null), []);
});

// ——— Qui êtes-vous ? ———

test('profilsARelier : adultes seulement, sans le profil du gestionnaire, dans l’ordre d’affichage', () => {
  const autre = { id: 'profil-c', nom: 'Adulte C', email: 'ancienne@example.com', ordre: 0, coefPortion: 1 };
  const profils = [ENFANT, ADULTE_B, autre, ADULTE_A];
  const liste = profilsARelier(profils, { gestionnaire: ' A@Example.com ' });
  assert.deepEqual(liste.map(({ profil, autreAdresse }) => [profil.id, autreAdresse]), [['profil-c', true], ['profil-b', false]]);
  // Sans gestionnaire connu : tous les adultes.
  assert.deepEqual(profilsARelier(profils, {}).map((r) => r.profil.id), ['profil-c', 'profil-a', 'profil-b']);
  assert.deepEqual(profilsARelier(profils).map((r) => r.profil.id), ['profil-c', 'profil-a', 'profil-b']);
  assert.deepEqual(profilsARelier([], { gestionnaire: 'a@example.com' }), []);
});

test('preparerReliure : adresse de la personne connectée, en minuscules ; attendu = adresse actuelle', () => {
  assert.deepEqual(preparerReliure(PROFILS, 'profil-b', ' B@Example.COM ', { gestionnaire: 'a@example.com' }),
    { id: 'profil-b', email: 'b@example.com', attendu: '' });
  const ancienne = { ...ADULTE_B, email: 'Ancienne@Example.com' };
  assert.deepEqual(preparerReliure([ADULTE_A, ancienne], 'profil-b', 'b@example.com', { gestionnaire: 'a@example.com' }),
    { id: 'profil-b', email: 'b@example.com', attendu: 'ancienne@example.com' });
  // Le gestionnaire peut reprendre son propre profil.
  assert.deepEqual(preparerReliure(PROFILS, 'profil-a', 'A@example.com', { gestionnaire: 'a@example.com' }),
    { id: 'profil-a', email: 'a@example.com', attendu: 'a@example.com' });
});

test('preparerReliure : chaque erreur', () => {
  const options = { gestionnaire: 'a@example.com' };
  assert.deepEqual(preparerReliure(PROFILS, 'absent', 'b@example.com', options), { erreur: 'inconnu' });
  assert.deepEqual(preparerReliure(PROFILS, 'profil-b', '  ', options), { erreur: 'inconnu' });
  assert.deepEqual(preparerReliure(undefined, 'profil-b', 'b@example.com', options), { erreur: 'inconnu' });
  assert.deepEqual(preparerReliure(PROFILS, 'enfant', 'b@example.com', options), { erreur: 'enfant' });
  assert.deepEqual(preparerReliure(PROFILS, 'profil-a', 'b@example.com', options), { erreur: 'gestionnaire' });
  assert.deepEqual(preparerReliure(PROFILS, 'profil-a', 'b@example.com', { gestionnaire: 'A@EXAMPLE.COM' }), { erreur: 'gestionnaire' });
  const dejaRelie = { id: 'profil-c', nom: 'Adulte C', email: 'B@example.com', ordre: 4, coefPortion: 1 };
  assert.deepEqual(preparerReliure([...PROFILS, dejaRelie], 'profil-b', 'b@example.com', options),
    { erreur: 'adresse_prise', nom: 'Adulte C' });
  // Sans gestionnaire connu, le profil n'est plus protégé.
  assert.equal(preparerReliure(PROFILS, 'profil-a', 'b@example.com', {}).id, 'profil-a');
});

test('preparerReliure : adresse montrée à l’écran (vu) différente de l’adresse actuelle → change, sans rien préparer', () => {
  const options = { gestionnaire: 'a@example.com' };
  const prise = { ...ADULTE_B, email: 'autre@example.com' };
  // L'écran montrait le profil sans adresse ; une autre personne l'a pris entre-temps.
  assert.deepEqual(preparerReliure([ADULTE_A, prise], 'profil-b', 'b@example.com', { ...options, vu: '' }), { erreur: 'change' });
  // L'écran montrait une adresse, remplacée ailleurs par une autre.
  assert.deepEqual(preparerReliure([ADULTE_A, prise], 'profil-b', 'b@example.com', { ...options, vu: 'ancienne@example.com' }),
    { erreur: 'change' });
  // Même adresse (casse et espaces ignorés) : préparé normalement.
  assert.deepEqual(preparerReliure([ADULTE_A, prise], 'profil-b', 'b@example.com', { ...options, vu: ' Autre@Example.com ' }),
    { id: 'profil-b', email: 'b@example.com', attendu: 'autre@example.com' });
  assert.deepEqual(preparerReliure(PROFILS, 'profil-b', 'b@example.com', { ...options, vu: '' }),
    { id: 'profil-b', email: 'b@example.com', attendu: '' });
  // Sans vu (null ou absent) : pas de comparaison.
  assert.equal(preparerReliure([ADULTE_A, prise], 'profil-b', 'b@example.com', { ...options, vu: null }).id, 'profil-b');
});

test('preparerProfil (Réglages) : adresse non touchée dans le formulaire → pas écrite, liaison faite ailleurs gardée', () => {
  // Formulaire ouvert sur Adulte B sans adresse ; entre-temps, « C'est moi » l'a relié à b@example.com.
  const relieAilleurs = { ...ADULTE_B, email: 'b@example.com' };
  const profils = [ADULTE_A, relieAilleurs, ENFANT];
  const options = { profils, id: 'profil-b', emailOuverture: '' };
  const { profil } = preparerProfil({ nom: 'Adulte Béa', email: '', coefPortion: 1 }, options);
  assert.equal('email' in profil, false, 'email absent : la liaison faite ailleurs reste');
  assert.equal(profil.nom, 'Adulte Béa');
  // Ouvert avec une adresse, déliée ailleurs entre-temps : non touchée, elle n'est pas recréée.
  const delie = preparerProfil({ nom: 'Adulte B', email: ' Ancienne@Example.com ' , coefPortion: 1 },
    { profils: [ADULTE_A, ADULTE_B, ENFANT], id: 'profil-b', emailOuverture: 'ancienne@example.com' });
  assert.equal('email' in delie.profil, false);
  // Adresse changée dans le formulaire : écrite, et validée contre les profils à jour.
  assert.equal(preparerProfil({ nom: 'Adulte B', email: 'N@example.com', coefPortion: 1 }, options).profil.email, 'n@example.com');
  assert.equal(preparerProfil({ nom: 'Adulte B', email: 'a@example.com', coefPortion: 1 }, options).erreurs.email,
    'Cette adresse est déjà celle d’un autre profil.');
  // Adresse vidée volontairement : écrite vide.
  assert.equal(preparerProfil({ nom: 'Adulte A', email: '', coefPortion: 1 },
    { profils, id: 'profil-a', emailOuverture: 'a@example.com' }).profil.email, '');
  // Adresse non touchée : pas d'erreur « déjà celle d'un autre profil » pour une valeur qu'on n'écrit pas.
  const doublon = [ADULTE_A, { ...ADULTE_B, email: 'a@example.com' }];
  assert.equal(preparerProfil({ nom: 'Adulte B', email: 'a@example.com', coefPortion: 1 },
    { profils: doublon, id: 'profil-b', emailOuverture: 'a@example.com' }).erreurs, undefined);
  // Nouveau profil : l'adresse est toujours écrite.
  assert.equal(preparerProfil({ nom: 'Adulte C', email: '', coefPortion: 1 }, { profils, emailOuverture: '' }).profil.email, '');
});

test('preparerDeliure : profil relié, ou non relié', () => {
  const relie = { ...ADULTE_B, email: 'B@Example.com' };
  assert.deepEqual(preparerDeliure([ADULTE_A, relie, ENFANT], ' b@example.com'), { id: 'profil-b', attendu: 'b@example.com' });
  assert.deepEqual(preparerDeliure(PROFILS, 'b@example.com'), { erreur: 'non_relie' });
  assert.deepEqual(preparerDeliure(PROFILS, ''), { erreur: 'non_relie' });
  assert.deepEqual(preparerDeliure([], 'a@example.com'), { erreur: 'non_relie' });
});

// ——— melanger ———

const VINGT = Array.from({ length: 20 }, (_, i) => `plat-${String(i).padStart(2, '0')}`);

test('melanger : vraie permutation, déterministe, entrée intacte', () => {
  const entree = geler([...VINGT]);
  const melange = melanger(entree, 'profil-a:2026-10-06');
  assert.notEqual(melange, entree);
  assert.deepEqual([...melange].sort(), [...VINGT]);
  assert.notDeepEqual(melange, VINGT);
  assert.deepEqual(melanger(entree, 'profil-a:2026-10-06'), melange);
  assert.notDeepEqual(melanger(entree, 'profil-a:2026-10-07'), melange);
  // Doublons gardés.
  assert.deepEqual(melanger(['x', 'x', 'y'], 'g').sort(), ['x', 'x', 'y']);
});

test('melanger : liste vide, un seul élément, graine absente', () => {
  assert.deepEqual(melanger([], 'g'), []);
  assert.deepEqual(melanger(['seul'], 'g'), ['seul']);
  assert.deepEqual(melanger(undefined, 'g'), []);
  assert.deepEqual(melanger(VINGT), melanger(VINGT, ''));
  assert.deepEqual([...melanger(VINGT, undefined)].sort(), VINGT);
});

// ——— File de Découvrir ———

test('aDecouvrir : nom, pas une préparation, pas encore noté (note abîmée = pas notée)', () => {
  assert.equal(aDecouvrir(plat('p'), 'profil-a'), true);
  assert.equal(aDecouvrir(plat('p', { recette: false }), 'profil-a'), true); // ⏳ : le nom suffit
  assert.equal(aDecouvrir(plat('p', { notes: { 'profil-a': 0 } }), 'profil-a'), false);
  assert.equal(aDecouvrir(plat('p', { notes: { 'profil-a': 3 } }), 'profil-a'), false);
  assert.equal(aDecouvrir(plat('p', { notes: { 'profil-a': '3' } }), 'profil-a'), true);
  assert.equal(aDecouvrir(plat('p', { notes: { 'profil-b': 5 } }), 'profil-a'), true);
  assert.equal(aDecouvrir(plat('p', { type: 'preparation' }), 'profil-a'), false);
  assert.equal(aDecouvrir(plat('p', { nom: '   ' }), 'profil-a'), false);
  assert.equal(aDecouvrir({ id: 'p' }, 'profil-a'), false);
  assert.equal(aDecouvrir({ nom: 'Sans identifiant' }, 'profil-a'), false);
  assert.equal(aDecouvrir(null, 'profil-a'), false);
});

test('fileDecouverte : notés exclus (0 compris), note abîmée incluse, préparation et plat sans nom exclus', () => {
  const plats = [
    plat('jamais', { notes: { 'profil-a': 0 } }),
    plat('aime', { notes: { 'profil-a': 4 } }),
    plat('abimee', { notes: { 'profil-a': 'x' } }),
    plat('note-par-un-autre', { notes: { enfant: 0 } }),
    plat('yaourts', { type: 'preparation' }),
    plat('sans-nom', { nom: '' }),
  ];
  assert.deepEqual(fileDecouverte(plats, 'profil-a', { graine: 'g' }).sort(), ['abimee', 'note-par-un-autre']);
  assert.deepEqual(fileDecouverte(plats, 'enfant', { graine: 'g' }).sort(), ['abimee', 'aime', 'jamais']);
  assert.deepEqual(fileDecouverte([], 'profil-a', { graine: 'g' }), []);
  assert.deepEqual(fileDecouverte(undefined, 'profil-a'), []);
});

test('fileDecouverte : ordre des types, ⏳ en dernier dans chaque type', () => {
  const plats = [
    plat('accomp', { type: 'accompagnement' }),
    plat('apero-1', { type: 'apero' }),
    plat('apero-attente', { type: 'apero', recette: false }),
    plat('dessert-attente', { type: 'dessert', recette: false }),
    plat('dessert-1', { type: 'dessert' }),
    plat('plat-attente', { recette: false }),
    plat('plat-1', { type: 'plat' }),
    plat('plat-2'), // type absent : un plat
    plat('soupe', { type: 'inconnu' }), // type inconnu : un plat
    { ...plat('plat-statut-abime'), statutRecette: 'xyz' }, // statut inconnu : ⏳
  ];
  const file = fileDecouverte(plats, 'profil-a', { graine: 'profil-a:2026-10-06' });
  const groupe = (id) => file.indexOf(id);
  const avant = (a, b) => assert.ok(groupe(a) < groupe(b), `${a} avant ${b} : ${file.join(', ')}`);
  assert.equal(file.length, plats.length);
  assert.deepEqual(file.slice(0, 3).sort(), ['plat-1', 'plat-2', 'soupe']);
  assert.deepEqual(file.slice(3, 5).sort(), ['plat-attente', 'plat-statut-abime']);
  assert.deepEqual(file.slice(5), ['dessert-1', 'dessert-attente', 'apero-1', 'apero-attente', 'accomp']);
  avant('plat-attente', 'dessert-1');
});

test('fileDecouverte : même graine → même ordre, même avec le tableau permuté ; autre graine → autre ordre', () => {
  const plats = geler(VINGT.map((id) => plat(id)));
  const options = { graine: 'profil-a:2026-10-06' };
  const file = fileDecouverte(plats, 'profil-a', options);
  assert.deepEqual([...file].sort(), VINGT);
  assert.deepEqual(fileDecouverte([...plats].reverse(), 'profil-a', options), file);
  assert.deepEqual(fileDecouverte(melanger(plats, 'autre'), 'profil-a', options), file);
  assert.notDeepEqual(fileDecouverte(plats, 'profil-a', { graine: 'profil-a:2026-10-07' }), file);
  assert.notDeepEqual(file, VINGT); // vraiment mélangée
  // Entrée intacte (gelée : toute modification aurait levé une erreur).
  assert.deepEqual(plats.map((p) => p.id), VINGT);
});

test('fileDecouverte : un plat en double n’apparaît qu’une fois', () => {
  const file = fileDecouverte([plat('a'), plat('b'), plat('a')], 'profil-a', { graine: 'g' });
  assert.deepEqual([...file].sort(), ['a', 'b']);
  assert.equal(nombreANoter([plat('a'), plat('b'), plat('a')], 'profil-a'), 2);
});

test('suivant : saute un plat noté ailleurs et un plat supprimé ; longueur en fin de file', () => {
  const file = ['supprime', 'note-ailleurs', 'reste', 'dernier'];
  const plats = [plat('note-ailleurs', { notes: { 'profil-a': 5 } }), plat('reste'), plat('dernier')];
  assert.equal(suivant(file, 0, plats, 'profil-a'), 2);
  assert.equal(suivant(file, 2, plats, 'profil-a'), 2);
  assert.equal(suivant(file, 3, plats, 'profil-a'), 3);
  assert.equal(suivant(file, 4, plats, 'profil-a'), 4);
  assert.equal(suivant(file, -1, plats, 'profil-a'), 2);
  // Tout est noté : fin de file.
  const tousNotes = plats.map((p) => avecNote(p, 'profil-a', 3));
  assert.equal(suivant(file, 0, tousNotes, 'profil-a'), file.length);
  assert.equal(suivant([], 0, plats, 'profil-a'), 0);
  // Une préparation (type changé ailleurs) est sautée aussi.
  assert.equal(suivant(['reste'], 0, [plat('reste', { type: 'preparation' })], 'profil-a'), 1);
});

test('completerFile : nouveau plat à la fin', () => {
  const plats = [plat('a', { notes: { 'profil-a': 5 } }), plat('b'), plat('c')];
  const file = geler(['a', 'b', 'c']);
  const nouveau = plat('d');
  assert.deepEqual(completerFile(file, 1, [...plats, nouveau], 'profil-a', { graine: 'g' }), ['a', 'b', 'c', 'd']);
  // Rien de neuf : même contenu, nouvelle liste.
  const meme = completerFile(file, 1, plats, 'profil-a', { graine: 'g' });
  assert.deepEqual(meme, ['a', 'b', 'c']);
  assert.notEqual(meme, file);
});

test('completerFile : note effacée d’un plat déjà passé → à la fin, une seule fois', () => {
  const file = ['a', 'b', 'c'];
  // La note de « a » a été effacée sur la fiche ; « b », carte affichée, vient d'être notée.
  const effacee = [plat('a'), plat('b', { notes: { 'profil-a': 5 } }), plat('c')];
  const apres = completerFile(file, 1, effacee, 'profil-a', { graine: 'g' });
  assert.deepEqual(apres, ['a', 'b', 'c', 'a']);
  assert.deepEqual(completerFile(apres, 1, effacee, 'profil-a', { graine: 'g' }), apres);
  assert.deepEqual(completerFile(apres, 2, effacee, 'profil-a', { graine: 'g' }), apres);
  // Fin de file : « a » et « c », dépassés sans note, reviennent une fois chacun.
  assert.deepEqual(completerFile(apres, 4, effacee, 'profil-a', { graine: 'g' }).slice(4).sort(), ['a', 'c']);
});

test('completerFile : plat déjà devant → pas de doublon ; carte affichée jamais ajoutée', () => {
  const plats = [plat('a'), plat('b'), plat('c'), plat('d')];
  // Carte affichée : « b » (position 1) ; « c » est devant ; « a », passé et non noté, revient ; « d » est nouveau.
  const apres = completerFile(['a', 'b', 'c'], 1, plats, 'profil-a', { graine: 'g' });
  assert.deepEqual(apres.slice(0, 3), ['a', 'b', 'c']);
  assert.deepEqual(apres.slice(3).sort(), ['a', 'd']);
  assert.equal(apres.filter((id) => id === 'b').length, 1);
  assert.equal(apres.filter((id) => id === 'c').length, 1);
  // Fin de file (aucune carte affichée) : tout ce qui reste à découvrir revient, dans l'ordre de fileDecouverte.
  const fin = completerFile(['a', 'b'], 2, plats, 'profil-a', { graine: 'g' });
  assert.deepEqual(fin.slice(2), fileDecouverte(plats, 'profil-a', { graine: 'g' }));
  // Les ajouts suivent l'ordre de fileDecouverte.
  const nouveaux = VINGT.map((id) => plat(id));
  assert.deepEqual(completerFile([], 0, nouveaux, 'profil-a', { graine: 'g' }), fileDecouverte(nouveaux, 'profil-a', { graine: 'g' }));
});

test('nombreANoter : plats pas encore notés par ce profil', () => {
  const plats = [
    plat('a', { notes: { 'profil-a': 0 } }),
    plat('b', { notes: { enfant: 5 } }),
    plat('c', { recette: false }),
    plat('d', { type: 'preparation' }),
    plat('e', { nom: '' }),
    plat('f', { notes: { 'profil-a': 4.5 } }),
  ];
  assert.equal(nombreANoter(plats, 'profil-a'), 3); // b, c, f
  assert.equal(nombreANoter(plats, 'enfant'), 3); // a, c, f
  assert.equal(nombreANoter([], 'profil-a'), 0);
  assert.equal(nombreANoter(undefined, 'profil-a'), 0);
});

test('bilan : j’adore, pourquoi pas et jamais', () => {
  assert.deepEqual(bilan([{ note: 5 }, { note: 3 }, { note: 5 }, { note: 0 }, { note: 5 }]), { adore: 3, pourquoiPas: 1, jamais: 1 });
  assert.deepEqual(bilan([]), { adore: 0, pourquoiPas: 0, jamais: 0 });
  assert.deepEqual(bilan(undefined), { adore: 0, pourquoiPas: 0, jamais: 0 });
  assert.deepEqual(bilan([{ note: 0 }, null, { note: 4 }]), { adore: 0, pourquoiPas: 0, jamais: 1 });
});

test('grainePour : « <profil>:<AAAA-MM-JJ> » à la date du téléphone', () => {
  assert.equal(grainePour('profil-a', new Date(2026, 9, 6, 23, 59)), 'profil-a:2026-10-06');
  assert.equal(grainePour('enfant', new Date(2026, 0, 5, 0, 1)), 'enfant:2026-01-05');
  assert.notEqual(grainePour('profil-a', new Date(2026, 9, 6)), grainePour('profil-a', new Date(2026, 9, 7)));
  assert.match(grainePour('profil-a'), /^profil-a:\d{4}-\d{2}-\d{2}$/);
});

// ——— Textes ———

const ingredients = (...produits) => produits.map((produit) => ({ produit, qte: 1, unite: 'pc', rayon: 'divers', marqueurs: [] }));

test('texteIngredients : 0, 1, 3, 4 et 5 ingrédients', () => {
  assert.equal(texteIngredients({ ingredients: [] }), '');
  assert.equal(texteIngredients({}), '');
  assert.equal(texteIngredients(null), '');
  assert.equal(texteIngredients({ ingredients: ingredients('pâtes courtes') }), 'Avec\u00A0: pâtes courtes');
  assert.equal(texteIngredients({ ingredients: ingredients('pâtes courtes', 'jambon blanc') }), 'Avec\u00A0: pâtes courtes et jambon blanc');
  assert.equal(texteIngredients({ ingredients: ingredients('pâtes courtes', 'jambon blanc', 'gruyère râpé') }),
    'Avec\u00A0: pâtes courtes, jambon blanc et gruyère râpé');
  assert.equal(texteIngredients({ ingredients: ingredients('pâtes courtes', 'jambon blanc', 'gruyère râpé', 'oignon jaune') }),
    'Avec\u00A0: pâtes courtes, jambon blanc, gruyère râpé et 1 autre');
  const cinq = { ingredients: ingredients('pâtes courtes', 'jambon blanc', 'gruyère râpé', 'oignon jaune', 'crème fraîche épaisse') };
  assert.equal(texteIngredients(cinq), 'Avec\u00A0: pâtes courtes, jambon blanc, gruyère râpé et 2 autres');
  assert.equal(texteIngredients(cinq, 2), 'Avec\u00A0: pâtes courtes, jambon blanc et 3 autres');
  assert.equal(texteIngredients(cinq, 5), 'Avec\u00A0: pâtes courtes, jambon blanc, gruyère râpé, oignon jaune et crème fraîche épaisse');
});

test('texteIngredients : produit manquant ignoré, doublon compté une fois', () => {
  const plat = { ingredients: [{ qte: 1 }, null, { produit: '  ' }, { produit: 4 }, { produit: ' oignon  jaune ' }, { produit: 'beurre' }, { produit: 'beurre' }] };
  assert.equal(texteIngredients(plat), 'Avec\u00A0: oignon jaune et beurre');
  assert.equal(texteIngredients({ ingredients: [{ qte: 1 }] }), '');
});

test('resumeNotes : morceaux dans l’ordre des profils, profils inconnus omis', () => {
  const p = plat('p', { notes: { enfant: 0, 'profil-b': 4, 'profil-a': 5, disparu: 2 } });
  const resume = resumeNotes(p, PROFILS);
  assert.deepEqual(resume.morceaux, [
    { profilId: 'profil-a', texte: 'Adulte A\u00A0❤️' },
    { profilId: 'profil-b', texte: 'Adulte B\u00A0★4' },
    { profilId: 'enfant', texte: 'Enfant\u00A0👎' },
  ]);
  assert.equal(resume.accessible, 'Notes\u00A0: Adulte A, j’adore\u00A0; Adulte B, j’aime bien\u00A0; Enfant, jamais.');
  for (const note of [1, 2, 3]) {
    assert.equal(resumeNotes(plat('p', { notes: { 'profil-b': note } }), PROFILS).morceaux[0].texte, `Adulte B\u00A0★${note}`);
  }
});

test('resumeNotes : phrase accessible avec ceux qui n’ont pas encore noté', () => {
  const p = plat('p', { notes: { 'profil-a': 5, enfant: 0 } });
  assert.equal(resumeNotes(p, PROFILS).accessible,
    'Notes\u00A0: Adulte A, j’adore\u00A0; Enfant, jamais. Pas encore noté\u00A0: Adulte B, compte comme Pourquoi pas.');
  assert.deepEqual(resumeNotes(p, PROFILS).morceaux.map((m) => m.profilId), ['profil-a', 'enfant']);
  const seul = plat('p', { notes: { 'profil-b': 3, 'profil-a': 'abîmée' } });
  assert.equal(resumeNotes(seul, PROFILS).accessible,
    'Notes\u00A0: Adulte B, pourquoi pas. Pas encore noté\u00A0: Adulte A et Enfant, compte comme Pourquoi pas.');
});

test('resumeNotes : null sans aucune note d’un profil connu', () => {
  assert.equal(resumeNotes(plat('p'), PROFILS), null);
  assert.equal(resumeNotes(plat('p', { notes: {} }), PROFILS), null);
  assert.equal(resumeNotes(plat('p', { notes: { disparu: 5 } }), PROFILS), null);
  assert.equal(resumeNotes(plat('p', { notes: { 'profil-a': '5', enfant: null } }), PROFILS), null);
  assert.equal(resumeNotes(plat('p', { notes: { 'profil-a': 5 } }), []), null);
  assert.equal(resumeNotes(plat('p', { notes: { 'profil-a': 5 } }), undefined), null);
});

test('aucun code ni mot technique dans les textes affichés', () => {
  const p = { ...plat('p', { notes: { 'profil-a': 5, 'profil-b': 2, enfant: 0 } }), ingredients: ingredients('pâtes courtes', 'jambon blanc', 'gruyère râpé', 'oignon jaune', 'beurre') };
  const unSeul = plat('q', { notes: { 'profil-b': 4 } });
  const resumes = [resumeNotes(p, PROFILS), resumeNotes(unSeul, PROFILS)];
  textesPropres([
    ...LIBELLES_NOTE,
    TEXTE_NON_NOTE,
    ...GESTES.map((geste) => geste.libelle),
    ...[0, 1, 2, 3, 4, 5, null].map(libelleNote),
    texteIngredients(p),
    texteIngredients(p, 1),
    texteIngredients({ ingredients: ingredients('beurre') }),
    ...resumes.flatMap((resume) => [resume.accessible, ...resume.morceaux.map((m) => m.texte)]),
  ]);
});

// ——— Non-régression : les notes ne sont écrites que par leur propre chemin ———

const RECETTE = {
  id: 'gratin-test',
  nom: 'Gratin test',
  type: 'plat',
  statutRecette: 'brouillon',
  portionsBase: 4,
  ingredients: [
    { produit: 'pâtes courtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'gruyère râpé', qte: 100, unite: 'g', rayon: 'fromages', marqueurs: ['laitier'] },
  ],
  etapes: ['Cuire les pâtes.', 'Gratiner.'],
  cuisson: [{ appareil: 'four', tempC: 200, dureeMin: 20 }],
  conservation: { frigoJours: 3, congelable: true },
};
const REGLAGES = { frigoJoursDefaut: 3 };

/** Vrai si une clé `notes` (ou un chemin `notes.…`) apparaît, à n'importe quelle profondeur. */
function contientNotes(valeur) {
  if (Array.isArray(valeur)) return valeur.some(contientNotes);
  if (valeur && typeof valeur === 'object') {
    return Object.entries(valeur).some(([cle, v]) => cle === 'notes' || cle.startsWith('notes.') || contientNotes(v));
  }
  return false;
}

test('preparerModification n’écrit jamais les notes', () => {
  const fiche = { ...clone(RECETTE), notes: { 'profil-a': 5, enfant: 0 } };
  const base = normaliserPourEdition(fiche, REGLAGES);
  const saisie = clone(base);
  saisie.nom = 'Gratin renommé';
  saisie.portionsBase = 6;
  saisie.ingredients.push({ produit: 'beurre', qte: 20, unite: 'g', rayon: 'cremerie', marqueurs: ['laitier'] });
  saisie.etapes.push('Servir chaud.');
  saisie.frigoJours = 2;
  saisie.verifiee = true;
  const r = preparerModification(base, saisie, fiche, { plats: [fiche], demandes: [], reglages: REGLAGES });
  assert.deepEqual(r.erreurs, []);
  assert.equal(contientNotes(r.champs), false);
  assert.equal(r.supprimer.includes('notes'), false);
  // Plat ⏳ déjà noté qui reçoit sa recette : la recette entière est écrite, toujours sans les notes.
  const attente = { id: 'soupe-test', nom: 'Soupe test', notes: { 'profil-a': 3 } };
  const b2 = normaliserPourEdition(attente, REGLAGES);
  const s2 = clone(b2);
  s2.ingredients.push({ produit: 'poireau', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'principal' });
  const r2 = preparerModification(b2, s2, attente, { plats: [attente], demandes: [], reglages: REGLAGES });
  assert.deepEqual(r2.erreurs, []);
  assert.ok(r2.champs.ingredients);
  assert.equal(contientNotes(r2.champs), false);
});

test('preparerModification : une note changée ailleurs ne crée aucun conflit', () => {
  const fiche = clone(RECETTE);
  const base = normaliserPourEdition(fiche, REGLAGES);
  const saisie = clone(base);
  saisie.nom = 'Gratin renommé';
  saisie.portionsBase = 2;
  const ailleurs = avecNote(avecNote(fiche, 'profil-a', 0), 'enfant', 5);
  const r = preparerModification(base, saisie, ailleurs, { plats: [ailleurs], demandes: [], reglages: REGLAGES });
  assert.deepEqual(r.conflits, []);
  assert.equal(contientNotes(r.champs), false);
  // Rien touché ici, une note posée ailleurs : rien à écrire.
  const rien = preparerModification(base, clone(base), ailleurs, { plats: [ailleurs], demandes: [], reglages: REGLAGES });
  assert.equal(rien.rien, true);
  assert.deepEqual(rien.conflits, []);
});

test('preparerImport : les écritures ne contiennent jamais les notes', () => {
  // Une recette collée qui porterait des notes : ignorées dès la validation, avec un avertissement.
  const paquet = { format: 'paquet@1', plats: [{ ...clone(RECETTE), notes: { 'profil-a': 0 }, derniereFois: '2026-09-27' }] };
  const valide = validerPaquet([paquet]);
  assert.equal(valide.valide, true);
  assert.equal(contientNotes(valide.plats[0].donnees), false);
  assert.ok(valide.plats[0].avertissements.length > 0);
  const donnees = valide.plats.map((p) => p.donnees);
  // Nouveau plat, recette remplacée sur une fiche notée, plat ⏳ noté complété.
  const notee = { ...clone(RECETTE), notes: { 'profil-a': 5, enfant: 0 } };
  const attente = { id: 'gratin-test', nom: 'Gratin test', notes: { 'profil-a': 3 } };
  for (const plats of [[], [notee], [attente]]) {
    const r = preparerImport(donnees, { plats, demandes: [] });
    assert.deepEqual(r.erreurs, []);
    assert.equal(r.ecritures.length, 1);
    assert.equal(contientNotes(r.ecritures), false);
  }
  // Recette collée sur la fiche (cible).
  const cible = preparerImport(donnees, { plats: [notee], demandes: [], cible: 'gratin-test' });
  assert.equal(contientNotes(cible.ecritures), false);
});

test('deNom : « d’ » devant une voyelle (accentuée ou non, Œ, Æ) ou un h, « de » sinon', () => {
  for (const [nom, attendu] of [
    ['Emma', 'd’Emma'], ['emma', 'd’emma'], ['Élise', 'd’Élise'], ['Èva', 'd’Èva'], ['Îris', 'd’Îris'],
    ['Anne', 'd’Anne'], ['Âmes', 'd’Âmes'], ['Isabelle', 'd’Isabelle'], ['Olivier', 'd’Olivier'], ['Ugo', 'd’Ugo'],
    ['Œnone', 'd’Œnone'], ['Æsa', 'd’Æsa'], ['Hélène', 'd’Hélène'], ['hugo', 'd’hugo'], ['Yves', 'd’Yves'],
    ['Paul', 'de Paul'], ['Yann', 'de Yann'], ['Zoé', 'de Zoé'], ['Adulte A', 'd’Adulte A'], ['Enfant', 'd’Enfant'],
    ['  Emma ', 'd’Emma'], ['Camille Martin', 'de Camille Martin'],
  ]) assert.equal(deNom(nom), attendu, nom);
  // Nom vide ou absent : « de » seul, sans planter.
  assert.equal(deNom(''), 'de ');
  assert.equal(deNom(undefined), 'de ');
  assert.equal(deNom(null), 'de ');
});
