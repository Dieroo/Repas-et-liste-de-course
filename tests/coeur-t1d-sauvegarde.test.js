// T1d-2 : sauvegarde, restauration, recettes par fichier (coeur/sauvegarde.js, ajustements de coeur/paquet.js).
// Dates locales vérifiées à l'heure de Paris (chaque fichier de test tourne dans son propre processus).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FICHIER_MAX, PLATS_MAX_SAUVEGARDE, ECRITURES_PAR_LOT,
  creerSauvegarde, nomFichierSauvegarde, lireSauvegarde, validerSauvegarde, preparerRestauration,
  empreinteRestauration, dateDeSauvegarde, joursDepuis, appliquerConditions,
} from '../js/coeur/sauvegarde.js';
import {
  CHAMPS_PLAT, PLATS_MAX, extrairePaquet, validerPaquet, estSauvegarde, preparerImport, recetteValidee,
  demandesSatisfaites,
} from '../js/coeur/paquet.js';
import { preparerProfil, preparerReliure } from '../js/coeur/profils.js';
import { egalProfonde } from '../js/coeur/edition.js';
import { routeAutorisee, resoudreRoute, parametreDe } from '../js/coeur/roles.js';

// ——— Fixtures génériques (aucune donnée du foyer) ———

const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: '', ordre: 2, coefPortion: 1 };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5 };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A]; // volontairement dans le désordre

const MAINTENANT = new Date('2026-10-06T16:42:00.000Z');
const MODIFIEE = new Date('2026-10-05T18:12:00.000Z');
const JETE = new Date('2026-10-06T07:30:00.000Z'); // mise à la corbeille (Corbeille)

const clone = (valeur) => JSON.parse(JSON.stringify(valeur));

/** Fiche qui porte tous les champs de CHAMPS_PLAT, plus ceux que l'app ajoute (notes, suivi, photo, mise à jour). */
const FICHE_COMPLETE = {
  id: 'gratin-test',
  nom: 'Gratin de test',
  type: 'plat',
  recurrence: 'aucune',
  statutRecette: 'validee',
  portionsBase: 4,
  ingredients: [
    { produit: 'pâtes courtes', qte: 400, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['feculent'] },
    { produit: 'jambon blanc', qte: 4, unite: 'tranche', rayon: 'charcuterie', marqueurs: ['viande', 'porc', 'charcuterie'], forme: 'fine' },
    { produit: 'oignon jaune', qte: 1, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'incorpore' },
  ],
  etapes: ['Cuire les pâtes.', 'Mélanger et gratiner.'],
  cuisson: [{ appareil: 'plaque', dureeMin: 12 }, { appareil: 'four', tempC: 200, mode: 'chaleur tournante', dureeMin: 20 }],
  tempsActifMin: 15,
  conservation: { frigoJours: 3, congelable: true },
  emporter: true,
  variantes: [{
    pour: 'profil-b',
    retirer: ['jambon blanc'],
    ajouter: [{ produit: 'thon au naturel', qtePortion: 50, unite: 'g', rayon: 'epicerie_salee', marqueurs: ['poisson'] }],
    consigne: 'Prélever sa part avant le jambon.',
  }],
  source: 'Version classique',
  notes: { 'profil-a': 5, enfant: 0 },
  derniereFois: '2026-09-27',
  modifieeLe: MODIFIEE,
  modifieePar: 'a@example.com',
  corbeille: { le: JETE, par: 'b@example.com' },
  vignette: 'data:image/jpeg;base64,AAAA',
  majPar: 'a@example.com',
  majLe: { seconds: 1790000000, nanoseconds: 0 },
};
// Champs de la fiche jamais sauvegardés (liste fermée).
const EXCLUSIONS_PLAT = ['vignette', 'majPar', 'majLe'];

const RECETTE_TARTE = {
  id: 'tarte-test',
  nom: 'Tarte de test',
  type: 'dessert',
  statutRecette: 'brouillon',
  portionsBase: 6,
  ingredients: [{ produit: 'farine', qte: 250, unite: 'g', rayon: 'epicerie_sucree', marqueurs: [] }],
  etapes: ['Pétrir.', 'Cuire.'],
};

function ficheAttente(id, nom, extra = {}) {
  return { id, nom, ...extra };
}

function etatDeBase() {
  return {
    plats: [
      structuredClone(FICHE_COMPLETE),
      clone(RECETTE_TARTE),
      ficheAttente('lasagnes', 'Lasagnes', { notes: { 'profil-b': 3 } }),
    ],
    profils: clone(PROFILS),
  };
}

/** Sauvegarde relue et validée, comme à la restauration. */
function relue(etat, maintenant = MAINTENANT) {
  const { texte } = creerSauvegarde(etat, { maintenant });
  const lue = lireSauvegarde(texte);
  assert.ok(lue.sauvegarde, `lecture : ${lue.erreur}`);
  return validerSauvegarde(lue.sauvegarde);
}

const HEURE_SERVEUR = new Date('2026-10-07T08:00:00.000Z');

/** Remplace le marqueur d'horodatage par une date, comme serverTimestamp() une fois l'écriture faite. */
function horodater(valeur) {
  if (valeur && typeof valeur === 'object' && valeur.horodatageServeur === true) return HEURE_SERVEUR;
  if (Array.isArray(valeur)) return valeur.map(horodater);
  if (valeur && typeof valeur === 'object' && !(valeur instanceof Date)) {
    return Object.fromEntries(Object.entries(valeur).map(([c, v]) => [c, horodater(v)]));
  }
  return valeur;
}

/** Fusion profonde (set + merge) : tables fusionnées, listes et valeurs remplacées. */
function fusionner(cible, source) {
  const sortie = { ...cible };
  for (const [cle, valeur] of Object.entries(source)) {
    const estTable = valeur && typeof valeur === 'object' && !Array.isArray(valeur) && !(valeur instanceof Date);
    const cibleTable = sortie[cle] && typeof sortie[cle] === 'object' && !Array.isArray(sortie[cle]) && !(sortie[cle] instanceof Date);
    sortie[cle] = estTable && cibleTable ? fusionner(sortie[cle], valeur) : valeur;
  }
  return sortie;
}

/** Applique des lots d'écritures à un état { plats, profils } (copie), comme le ferait Firestore. */
function appliquer(etat, lots) {
  const collections = {
    plats: new Map(etat.plats.map((p) => [p.id, structuredClone(p)])),
    profils: new Map(etat.profils.map((p) => [p.id, structuredClone(p)])),
  };
  for (const lot of lots) {
    for (const ecriture of lot) {
      const docs = collections[ecriture.collection];
      const donnees = horodater(ecriture.donnees);
      if (ecriture.mode === 'fusion') {
        docs.set(ecriture.id, fusionner(docs.get(ecriture.id) ?? { id: ecriture.id }, donnees));
        continue;
      }
      const doc = docs.get(ecriture.id);
      assert.ok(doc, `update sur un document absent : ${ecriture.id}`);
      for (const [chemin, valeur] of Object.entries(donnees)) {
        const morceaux = chemin.split('.');
        let ici = doc;
        for (const m of morceaux.slice(0, -1)) {
          if (!ici[m] || typeof ici[m] !== 'object') ici[m] = {};
          ici = ici[m];
        }
        ici[morceaux.at(-1)] = valeur;
      }
      for (const champ of ecriture.effacer ?? []) delete doc[champ];
    }
  }
  return { plats: [...collections.plats.values()], profils: [...collections.profils.values()] };
}

/** Toutes les écritures, à plat. */
const ecrituresDe = (preparation) => preparation.lots.flat();
const ecritureDe = (preparation, id) => ecrituresDe(preparation).find((e) => e.id === id);

/** Vrai si une clé contient un point, à toute profondeur. */
function clePointee(valeur) {
  if (!valeur || typeof valeur !== 'object' || valeur instanceof Date) return false;
  return Object.entries(valeur).some(([cle, v]) => cle.includes('.') || clePointee(v));
}

/** Vrai si une valeur undefined traîne, à toute profondeur. */
function contientUndefined(valeur) {
  if (valeur === undefined) return true;
  if (!valeur || typeof valeur !== 'object' || valeur instanceof Date) return false;
  return Object.values(valeur).some(contientUndefined);
}

// Aucun mot technique ni code dans un texte affiché.
const INTERDITS = /paquet|slug|json|\bIA\b|undefined|null|NaN|\[object|`|[{}[\]_]/i;
const CODES = /notes\.|profil-[a-z]|\b(validee|attente|brouillon|coefPortion|statutRecette|ingredients|derniereFois|modifieeLe|sauvegardeLe)\b/;

function textesPropres(textes) {
  for (const texte of textes) {
    assert.equal(typeof texte, 'string');
    assert.doesNotMatch(texte, INTERDITS, texte);
    assert.doesNotMatch(texte, CODES, texte);
    assert.doesNotMatch(texte, /\u00A0{2}| {2}|\u00A0 | \u00A0/, texte);
    assert.doesNotMatch(texte, / [:;!?»]|« /, `espace insécable attendue : ${texte}`);
  }
}

// ——— Constantes, dates ———

test('constantes : fichier de 5 millions de caractères, 2 000 plats, lots de 450', () => {
  assert.equal(FICHIER_MAX, 5_000_000);
  assert.equal(PLATS_MAX_SAUVEGARDE, 2000);
  assert.equal(ECRITURES_PAR_LOT, 450);
});

test('dateDeSauvegarde : horodatage (toDate ou secondes), Date, texte ISO ; null sinon', () => {
  assert.equal(dateDeSauvegarde({ toDate: () => MAINTENANT }).getTime(), MAINTENANT.getTime());
  assert.equal(dateDeSauvegarde({ seconds: 1790000000, nanoseconds: 500000000 }).getTime(), 1790000000500);
  assert.equal(dateDeSauvegarde(MAINTENANT).getTime(), MAINTENANT.getTime());
  assert.equal(dateDeSauvegarde('2026-10-06T16:42:00.000Z').getTime(), MAINTENANT.getTime());
  for (const rien of [undefined, null, '', 'demain', {}, new Date('x'), 42]) assert.equal(dateDeSauvegarde(rien), null);
});

test('joursDepuis : jours de calendrier, jamais négatif, Infinity sans date', () => {
  const soir = new Date(2026, 9, 6, 23, 30);
  assert.equal(joursDepuis(new Date(2026, 9, 6, 0, 5), soir), 0);
  assert.equal(joursDepuis(new Date(2026, 9, 5, 23, 59), new Date(2026, 9, 6, 0, 1)), 1);
  assert.equal(joursDepuis(new Date(2026, 7, 22, 12), new Date(2026, 9, 6, 12)), 45);
  // Passage à l'heure d'hiver (25 octobre 2026) : toujours un nombre entier de jours.
  assert.equal(joursDepuis(new Date(2026, 9, 24, 12), new Date(2026, 9, 26, 12)), 2);
  assert.equal(joursDepuis(new Date(2026, 9, 8), soir), 0);
  assert.equal(joursDepuis(null, soir), Infinity);
  assert.equal(joursDepuis({ seconds: soir.getTime() / 1000 }, soir), 0);
});

// ——— Noms de fichier ———

test('nomFichierSauvegarde : date locale avec zéros, copie de précaution à la minute', () => {
  assert.equal(nomFichierSauvegarde(new Date(2026, 0, 5, 7, 3)), 'repas-courses-sauvegarde-2026-01-05.json');
  assert.equal(nomFichierSauvegarde(new Date(2026, 0, 5, 7, 3), { avantRestauration: true }),
    'repas-courses-avant-restauration-2026-01-05-0703.json');
  // 23 h 30 à Paris : même jour ; 0 h 30 à Paris : jour local, pas celui de l'UTC.
  assert.equal(nomFichierSauvegarde(new Date('2026-10-06T21:30:00Z')), 'repas-courses-sauvegarde-2026-10-06.json');
  assert.equal(nomFichierSauvegarde(new Date('2026-10-06T22:30:00Z')), 'repas-courses-sauvegarde-2026-10-07.json');
  assert.equal(nomFichierSauvegarde(new Date('2026-12-31T22:59:00Z'), { avantRestauration: true }),
    'repas-courses-avant-restauration-2026-12-31-2359.json');
  assert.doesNotMatch(nomFichierSauvegarde(MAINTENANT), /adulte|enfant|profil/i);
});

// ——— creerSauvegarde ———

test('creerSauvegarde : clés exactes, tris, ordre des champs du §8, défauts d’un ⏳', () => {
  const etat = etatDeBase();
  const r = creerSauvegarde({ plats: [...etat.plats].reverse(), profils: etat.profils }, { maintenant: MAINTENANT });
  assert.equal(r.nomFichier, 'repas-courses-sauvegarde-2026-10-06.json');
  const fichier = JSON.parse(r.texte);
  assert.deepEqual(Object.keys(fichier), ['format', 'sauvegardeLe', 'profils', 'plats']);
  assert.equal(fichier.format, 'paquet@1');
  assert.equal(fichier.sauvegardeLe, '2026-10-06T16:42:00.000Z');
  assert.deepEqual(fichier.profils.map((p) => p.id), ['profil-a', 'profil-b', 'enfant']);
  assert.deepEqual(fichier.profils[0], ADULTE_A);
  assert.deepEqual(fichier.plats.map((p) => p.id), ['gratin-test', 'lasagnes', 'tarte-test']);
  const gratin = fichier.plats[0];
  assert.deepEqual(Object.keys(gratin), [...CHAMPS_PLAT, 'notes', 'derniereFois', 'modifieeLe', 'modifieePar', 'corbeille']);
  assert.equal(gratin.modifieeLe, '2026-10-05T18:12:00.000Z');
  assert.deepEqual(gratin.corbeille, { le: '2026-10-06T07:30:00.000Z', par: 'b@example.com' });
  assert.deepEqual(fichier.plats[1], {
    id: 'lasagnes', nom: 'Lasagnes', type: 'plat', recurrence: 'aucune', statutRecette: 'attente', notes: { 'profil-b': 3 },
  });
  // Deux sauvegardes du même état se comparent ligne à ligne.
  assert.equal(creerSauvegarde(etat, { maintenant: MAINTENANT }).texte, r.texte);
  assert.equal(r.texte, `${JSON.stringify(fichier, null, 2)}\n`);
});

test('creerSauvegarde : ni photo, ni mise à jour, ni gestionnaire, ni réglages, ni demandes ; aucun undefined', () => {
  const etat = etatDeBase();
  const r = creerSauvegarde({ ...etat, demandes: [{ id: 'lasagnes__recette', statut: 'ouverte' }], reglages: { gestionnaire: 'a@example.com' } },
    { maintenant: MAINTENANT });
  for (const absent of ['vignette', 'majPar', 'majLe', 'gestionnaire', 'reglages', 'demandes', 'undefined', 'base64']) {
    assert.equal(r.texte.includes(absent), false, absent);
  }
  assert.equal(contientUndefined(JSON.parse(r.texte)), false);
  // Valeurs non sérialisables écartées ; horodatages en ISO.
  const bizarre = {
    id: 'bizarre', nom: 'Plat bizarre', source: undefined, etapes: ['Une étape.', undefined], tempsActifMin: NaN,
    conservation: { frigoJours: 3, congelable: undefined },
  };
  const fichier = JSON.parse(creerSauvegarde({ plats: [bizarre], profils: [{ ...ADULTE_A, lieLe: { seconds: 0 } }] }, { maintenant: MAINTENANT }).texte);
  assert.equal(contientUndefined(fichier), false);
  assert.equal('source' in fichier.plats[0], false);
  assert.equal('tempsActifMin' in fichier.plats[0], false);
  assert.deepEqual(fichier.plats[0].conservation, { frigoJours: 3 });
  assert.equal(fichier.profils[0].lieLe, '1970-01-01T00:00:00.000Z');
});

test('creerSauvegarde : notes abîmées écartées, notes d’un profil retiré gardées', () => {
  const plat = { ...clone(RECETTE_TARTE), notes: { 'profil-a': 4, 'ancien-profil': 0, enfant: 7, 'profil-b': 2.5, 'a.b': 3, X: 1, deux: '4' } };
  const fichier = JSON.parse(creerSauvegarde({ plats: [plat], profils: clone(PROFILS) }, { maintenant: MAINTENANT }).texte);
  assert.deepEqual(fichier.plats[0].notes, { 'ancien-profil': 0, 'profil-a': 4 });
  // Sans note valide : pas de table vide.
  const sansNote = JSON.parse(creerSauvegarde({ plats: [{ ...clone(RECETTE_TARTE), notes: { a: 9 } }], profils: [] }, { maintenant: MAINTENANT }).texte);
  assert.equal('notes' in sansNote.plats[0], false);
});

test('creerSauvegarde : derniereFois recopiée quel que soit le jour, horodatage converti en date locale', () => {
  const plats = [
    { id: 'a', nom: 'A', derniereFois: '2026-10-04' }, // dimanche
    { id: 'b', nom: 'B', derniereFois: '2026-10-07' }, // mercredi
    { id: 'c', nom: 'C', derniereFois: { toDate: () => new Date('2026-10-06T22:30:00Z') } }, // 0 h 30 à Paris
    { id: 'd', nom: 'D', derniereFois: { seconds: Date.UTC(2026, 8, 1, 10) / 1000, nanoseconds: 0 } },
    { id: 'e', nom: 'E', derniereFois: '2026-02-30' },
    { id: 'f', nom: 'F', derniereFois: 'hier' },
  ];
  const fichier = JSON.parse(creerSauvegarde({ plats, profils: [] }, { maintenant: MAINTENANT }).texte);
  assert.deepEqual(fichier.plats.map((p) => p.derniereFois ?? null), ['2026-10-04', '2026-10-07', '2026-10-07', '2026-09-01', null, null]);
});

test('creerSauvegarde : modifieeLe en ISO (toDate, secondes), omis à null', () => {
  const plats = [
    { id: 'a', nom: 'A', modifieeLe: { toDate: () => MODIFIEE }, modifieePar: 'a@example.com' },
    { id: 'b', nom: 'B', modifieeLe: { seconds: MODIFIEE.getTime() / 1000, nanoseconds: 0 } },
    { id: 'c', nom: 'C', modifieeLe: null, modifieePar: 'a@example.com' },
  ];
  const fichier = JSON.parse(creerSauvegarde({ plats, profils: [] }, { maintenant: MAINTENANT }).texte);
  assert.equal(fichier.plats[0].modifieeLe, MODIFIEE.toISOString());
  assert.equal(fichier.plats[0].modifieePar, 'a@example.com');
  assert.equal(fichier.plats[1].modifieeLe, MODIFIEE.toISOString());
  assert.equal('modifieeLe' in fichier.plats[2], false);
});

test('creerSauvegarde : résumé ; une fiche abîmée est signalée, le reste reste restaurable', () => {
  const etat = etatDeBase();
  const abimee = clone(RECETTE_TARTE);
  abimee.id = 'tarte-abimee';
  abimee.nom = 'Tarte abîmée';
  delete abimee.ingredients[0].rayon;
  const r = creerSauvegarde({ plats: [...etat.plats, abimee], profils: etat.profils }, { maintenant: MAINTENANT });
  assert.deepEqual(r.resume, { plats: 4, profils: 3, notes: 3 });
  assert.deepEqual(r.aCorriger, [{ id: 'tarte-abimee', nom: 'Tarte abîmée' }]);
  const validation = validerSauvegarde(lireSauvegarde(r.texte).sauvegarde);
  assert.equal(validation.valide, true);
  assert.deepEqual(validation.plats.filter((p) => p.recette).map((p) => p.id), ['gratin-test', 'lasagnes', 'tarte-test']);
  assert.deepEqual(creerSauvegarde(etat, { maintenant: MAINTENANT }).aCorriger, []);
});

test('creerSauvegarde : 400 plats complets → moins de 2 Mo', () => {
  const plats = Array.from({ length: 400 }, (_, i) => ({ ...clone({ ...FICHE_COMPLETE, modifieeLe: null }), id: `plat-${i}`, nom: `Plat numéro ${i}` }));
  const { texte, aCorriger } = creerSauvegarde({ plats, profils: clone(PROFILS) }, { maintenant: MAINTENANT });
  assert.ok(texte.length < 2_000_000, `${texte.length} caractères`);
  assert.deepEqual(aCorriger, []);
});

// ——— lireSauvegarde ———

test('lireSauvegarde : chaque code', () => {
  const { texte } = creerSauvegarde(etatDeBase(), { maintenant: MAINTENANT });
  assert.ok(lireSauvegarde(texte).sauvegarde);
  assert.ok(lireSauvegarde(`\uFEFF${texte}`).sauvegarde, 'marque d’ordre des octets retirée');
  assert.deepEqual(lireSauvegarde(''), { erreur: 'vide' });
  assert.deepEqual(lireSauvegarde(' \n\t'), { erreur: 'vide' });
  assert.deepEqual(lireSauvegarde('\uFEFF'), { erreur: 'vide' });
  assert.deepEqual(lireSauvegarde(undefined), { erreur: 'vide' });
  assert.deepEqual(lireSauvegarde('Bonjour, voici une liste de courses.'), { erreur: 'illisible' });
  assert.deepEqual(lireSauvegarde('\u0089PNG\r\n\u001a\n'), { erreur: 'illisible' });
  assert.deepEqual(lireSauvegarde('[1, 2]'), { erreur: 'illisible' });
  assert.deepEqual(lireSauvegarde('{"bonjour": 1}'), { erreur: 'illisible' });
  assert.deepEqual(lireSauvegarde(texte.slice(0, Math.floor(texte.length / 2))), { erreur: 'coupee' });
  const recettes = JSON.stringify({ format: 'paquet@1', plats: [RECETTE_TARTE] });
  assert.deepEqual(lireSauvegarde(recettes), { erreur: 'recettes' });
  assert.deepEqual(lireSauvegarde(`Voici la recette :\n\`\`\`json\n${recettes}\n\`\`\`\nBon appétit.`), { erreur: 'recettes' });
  assert.deepEqual(lireSauvegarde(JSON.stringify({ format: 'paquet@2', sauvegardeLe: MAINTENANT.toISOString(), plats: [] })), { erreur: 'version' });
  assert.deepEqual(lireSauvegarde(JSON.stringify({ sauvegardeLe: MAINTENANT.toISOString(), plats: [] })), { erreur: 'version' });
  // Sauvegarde entourée de texte : retrouvée.
  assert.ok(lireSauvegarde(`Ma sauvegarde :\n${texte}\nFin.`).sauvegarde);
});

test('lireSauvegarde : 600 000 caractères acceptés, 5 millions + 1 refusés', () => {
  const { texte } = creerSauvegarde(etatDeBase(), { maintenant: MAINTENANT });
  const long = texte + ' '.repeat(600_000 - texte.length);
  assert.equal(long.length, 600_000);
  assert.ok(lireSauvegarde(long).sauvegarde);
  const limite = texte + ' '.repeat(FICHIER_MAX - texte.length);
  assert.ok(lireSauvegarde(limite).sauvegarde);
  assert.deepEqual(lireSauvegarde(`${limite} `), { erreur: 'trop_gros' });
  assert.deepEqual(lireSauvegarde('x'.repeat(FICHIER_MAX + 1)), { erreur: 'trop_gros' });
});

// ——— validerSauvegarde ———

/** Sauvegarde minimale autour de plats et profils bruts. */
function fichierAvec(plats, profils = clone(PROFILS), extra = {}) {
  return { format: 'paquet@1', sauvegardeLe: MAINTENANT.toISOString(), profils, plats, ...extra };
}

test('validerSauvegarde : date, recettes reprises, défauts', () => {
  const v = relue(etatDeBase());
  assert.equal(v.valide, true);
  assert.deepEqual(v.erreurs, []);
  assert.deepEqual(v.avertissements, []);
  assert.equal(v.date.getTime(), MAINTENANT.getTime());
  const gratin = v.plats.find((p) => p.id === 'gratin-test');
  assert.deepEqual(gratin.notes, { enfant: 0, 'profil-a': 5 });
  assert.equal(gratin.derniereFois, '2026-09-27');
  assert.ok(gratin.modifieeLe instanceof Date);
  assert.equal(gratin.modifieeLe.getTime(), MODIFIEE.getTime());
  assert.equal(gratin.modifieePar, 'a@example.com');
  for (const champ of ['notes', 'derniereFois', 'modifieeLe', 'modifieePar', 'corbeille']) assert.equal(champ in gratin.recette, false, champ);
  assert.deepEqual(gratin.corbeille, { le: JETE, par: 'b@example.com' });
  assert.deepEqual(recetteValidee(gratin.recette), recetteValidee(FICHE_COMPLETE));
  const lasagnes = v.plats.find((p) => p.id === 'lasagnes');
  assert.equal(lasagnes.recette.statutRecette, 'attente');
  assert.deepEqual(v.profils.map((p) => p.id), ['profil-a', 'profil-b', 'enfant']);
});

test('validerSauvegarde : notes (« 4 » toléré ; 2,5, 7, -1 et clé pointée ignorés avec avertissement)', () => {
  const v = validerSauvegarde(fichierAvec([
    { ...clone(RECETTE_TARTE), notes: { 'profil-a': '4', enfant: 0 } },
    { id: 'lasagnes', nom: 'Lasagnes', notes: { 'profil-a': 2.5 } },
    { id: 'soupe', nom: 'Soupe', notes: { 'profil-a': 7, 'profil-b': -1, 'a.b': 3, enfant: 5 } },
  ]));
  assert.equal(v.valide, true);
  assert.deepEqual(v.plats[0].notes, { 'profil-a': 4, enfant: 0 });
  assert.deepEqual(v.plats[1].notes, {});
  assert.deepEqual(v.plats[2].notes, { enfant: 5 });
  assert.deepEqual(v.avertissements, [
    '«\u00A0Lasagnes\u00A0»\u00A0: une note illisible a été ignorée.',
    '«\u00A0Soupe\u00A0»\u00A0: 3 notes illisibles ont été ignorées.',
  ]);
  textesPropres(v.avertissements);
});

test('validerSauvegarde : un plat abîmé sur 3 → recette non reprise, ses notes gardées', () => {
  const abime = { ...clone(RECETTE_TARTE), id: 'tarte-abimee', nom: 'Tarte abîmée', portionsBase: -2, notes: { 'profil-a': 5 } };
  const v = validerSauvegarde(fichierAvec([clone(FICHE_COMPLETE), abime, clone(RECETTE_TARTE)].map((p) => ({ ...p, modifieeLe: undefined }))));
  assert.equal(v.valide, true);
  assert.equal(v.plats.filter((p) => p.recette).length, 2);
  const plat = v.plats.find((p) => p.id === 'tarte-abimee');
  assert.equal(plat.recette, null);
  assert.deepEqual(plat.notes, { 'profil-a': 5 });
  assert.deepEqual(v.avertissements, ['«\u00A0Tarte abîmée\u00A0»\u00A0: sa recette est abîmée dans ce fichier, elle ne sera pas reprise.']);
  textesPropres(v.avertissements);
});

test('validerSauvegarde : même nom accepté, même identifiant bloquant ; plat sans nom ou sans identifiant ignoré', () => {
  const memeNom = validerSauvegarde(fichierAvec([
    { id: 'soupe', nom: 'Soupe' }, { id: 'soupe-2', nom: 'Soupe' },
  ]));
  assert.equal(memeNom.valide, true);
  assert.deepEqual(memeNom.plats.map((p) => p.id), ['soupe', 'soupe-2']);
  const memeId = validerSauvegarde(fichierAvec([{ id: 'soupe', nom: 'Soupe' }, { id: 'soupe', nom: 'Potage' }]));
  assert.equal(memeId.valide, false);
  assert.equal(memeId.erreurs.length, 1);
  textesPropres(memeId.erreurs);
  const ignores = validerSauvegarde(fichierAvec([{ id: 'soupe' }, { nom: 'Potage' }, { id: 'Pas Un Id', nom: 'Velouté' }, 'texte', { id: 'ok', nom: 'Ok' }]));
  assert.equal(ignores.valide, true);
  assert.deepEqual(ignores.plats.map((p) => p.id), ['ok']);
  assert.equal(ignores.avertissements.length, 4);
  textesPropres(ignores.avertissements);
});

test('validerSauvegarde : derniereFois et modifieeLe illisibles → avertissements', () => {
  const v = validerSauvegarde(fichierAvec([
    { id: 'a', nom: 'Plat A', derniereFois: '2026-02-30', modifieeLe: 'pas une date', modifieePar: 'a@example.com' },
    { id: 'b', nom: 'Plat B', derniereFois: 20261004, modifieeLe: 12 },
  ]));
  assert.equal(v.valide, true);
  assert.equal('derniereFois' in v.plats[0], false);
  assert.equal('modifieeLe' in v.plats[0], false);
  assert.equal(v.plats[0].modifieePar, 'a@example.com');
  assert.equal(v.avertissements.length, 4);
  textesPropres(v.avertissements);
});

test('validerSauvegarde : profils invalides ignorés, identifiant en double bloquant, adresse en double sans adresse', () => {
  const v = validerSauvegarde(fichierAvec([], [
    { ...ADULTE_A, email: 'A@Example.com' },
    { id: 'profil-c', nom: 'Adulte C', email: 'a@example.com', ordre: 4, coefPortion: 1 },
    { id: 'profil-d', nom: '', email: '', ordre: 5, coefPortion: 1 },
    { id: 'profil-e', nom: 'Adulte E', email: 'pas-une-adresse', ordre: 6, coefPortion: 1 },
    { id: 'profil-f', nom: 'Adulte F', email: '', ordre: 7, coefPortion: 2 },
    { id: 'Profil G', nom: 'Adulte G', email: '', ordre: 8, coefPortion: 1 },
    { id: 'profil-h', nom: 'x'.repeat(41), email: '', ordre: 9, coefPortion: 1 },
    { id: 'profil-i', nom: 'Adulte I', email: '', ordre: -1, coefPortion: 1 },
    { ...ENFANT, couleur: 'bleu' },
  ]));
  assert.equal(v.valide, true);
  assert.deepEqual(v.profils, [
    ADULTE_A,
    { id: 'profil-c', nom: 'Adulte C', email: '', ordre: 4, coefPortion: 1 },
    ENFANT,
  ]);
  assert.equal(v.avertissements.length, 8); // adresse en double, 6 profils abîmés, un champ inconnu
  textesPropres(v.avertissements);
  const double = validerSauvegarde(fichierAvec([], [ADULTE_A, { ...ADULTE_A, nom: 'Autre' }]));
  assert.equal(double.valide, false);
  textesPropres(double.erreurs);
});

test('validerSauvegarde : clés pas encore reprises ignorées avec avertissement ; listes illisibles bloquantes', () => {
  const v = validerSauvegarde(fichierAvec([], clone(PROFILS), { reglages: { gestionnaire: 'a@example.com' }, produits: [], congelateur: [], semaines: [] }));
  assert.equal(v.valide, true);
  assert.deepEqual(v.avertissements, ['Une partie du fichier n’est pas encore reprise par l’app\u00A0: elle a été ignorée.']);
  for (const plats of [{}, 'plats', 3]) {
    const r = validerSauvegarde(fichierAvec(plats));
    assert.equal(r.valide, false);
    textesPropres(r.erreurs);
  }
  assert.equal(validerSauvegarde(fichierAvec([], 'profils')).valide, false);
  assert.equal(validerSauvegarde(null).valide, false);
});

test('validerSauvegarde : 2 000 plats acceptés, 2 001 refusés', () => {
  const plats = (n) => Array.from({ length: n }, (_, i) => ({ id: `plat-${i}`, nom: `Plat ${i}` }));
  const ok = validerSauvegarde(fichierAvec(plats(2000)));
  assert.equal(ok.valide, true);
  assert.equal(ok.plats.length, 2000);
  const trop = validerSauvegarde(fichierAvec(plats(2001)));
  assert.equal(trop.valide, false);
  assert.deepEqual(trop.plats, []);
  textesPropres(trop.erreurs);
});

// ——— Aller-retour ———

test('aller-retour : même état → rien à restaurer, y compris avec deux plats de même nom', () => {
  const etat = etatDeBase();
  etat.plats.push({ id: 'soupe', nom: 'Soupe' }, { id: 'soupe-2', nom: 'Soupe', statutRecette: 'brouillon', portionsBase: 2,
    ingredients: [{ produit: 'poireau', qte: 2, unite: 'pc', rayon: 'fruits_legumes', marqueurs: ['legume'], role: 'principal' }] });
  etat.plats[0].derniereFois = { seconds: Date.UTC(2026, 8, 27, 10) / 1000, nanoseconds: 0 };
  const r = preparerRestauration(relue(etat), { ...etat, demandes: [], email: 'a@example.com' });
  assert.equal(r.rien, true);
  assert.deepEqual(r.lots, []);
  assert.deepEqual(r.recettesDifferentes, []);
  assert.equal(r.resume.identiques, 5); // tous inchangés, ⏳ compris
  assert.deepEqual(r.resume.platsRemis, []);
  assert.equal(r.resume.ajoutesDepuis, 0);
});

test('aller-retour : sur une base vide, tout revient à l’identique', () => {
  const etat = etatDeBase();
  const r = preparerRestauration(relue(etat), { plats: [], profils: [], demandes: [], email: 'a@example.com' });
  assert.equal(r.rien, false);
  assert.deepEqual(r.resume.platsRemis.sort(), ['Gratin de test (dans la corbeille)', 'Lasagnes', 'Tarte de test']);
  assert.deepEqual(r.resume.profilsRemis, ['Adulte A', 'Adulte B', 'Enfant']);
  assert.equal(r.resume.notesRemises, 3);
  assert.equal(r.resume.datesRemises, 1);
  for (const e of ecrituresDe(r)) assert.equal(e.mode, 'fusion');
  const apres = appliquer({ plats: [], profils: [] }, r.lots);
  for (const original of etat.plats) {
    const remis = apres.plats.find((p) => p.id === original.id);
    assert.deepEqual(recetteValidee(remis), recetteValidee(original), original.id);
    assert.deepEqual(remis.notes ?? {}, original.notes ?? {});
    assert.equal(remis.majPar, 'a@example.com');
    assert.equal(remis.majLe, HEURE_SERVEUR);
  }
  for (const profil of PROFILS) assert.deepEqual(apres.profils.find((p) => p.id === profil.id), profil);
  // Restauré, puis restauré de nouveau : plus rien ne manque.
  assert.equal(preparerRestauration(relue(etat), { ...apres, demandes: [] }).rien, true);
});

test('garde-fou : une fiche portant tous les champs que l’app écrit survit au voyage (sauf exclusions)', () => {
  // Une tranche qui ajoute un champ à CHAMPS_PLAT doit le mettre dans la fiche d'essai, et dans la sauvegarde.
  for (const champ of CHAMPS_PLAT) assert.ok(champ in FICHE_COMPLETE, `champ ${champ} absent de la fiche d’essai`);
  const champsApp = Object.keys(FICHE_COMPLETE).filter((c) => !EXCLUSIONS_PLAT.includes(c));
  const r = preparerRestauration(relue({ plats: [structuredClone(FICHE_COMPLETE)], profils: clone(PROFILS) }),
    { plats: [], profils: clone(PROFILS), demandes: [], email: 'b@example.com' });
  const apres = appliquer({ plats: [], profils: clone(PROFILS) }, r.lots);
  const remis = apres.plats[0];
  // Dates comparées par leur valeur, à toute profondeur (egalProfonde tient deux Date pour égales).
  const sansDates = (v) => {
    if (v instanceof Date) return `date:${v.toISOString()}`;
    if (Array.isArray(v)) return v.map(sansDates);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([c, x]) => [c, sansDates(x)]));
    return v;
  };
  for (const champ of champsApp) {
    const attendu = sansDates(FICHE_COMPLETE[champ]);
    const recu = sansDates(remis[champ]);
    assert.ok(egalProfonde(recu, attendu), `${champ} : ${JSON.stringify(recu)} au lieu de ${JSON.stringify(attendu)}`);
  }
  for (const champ of EXCLUSIONS_PLAT) assert.notDeepEqual(remis[champ], FICHE_COMPLETE[champ], champ);
});

test('garde-fou : un profil portant tous les champs que l’app écrit survit au voyage', () => {
  // Champs écrits par Réglages (preparerProfil) et par « C'est moi » (preparerReliure : l'adresse).
  const { profil } = preparerProfil({ nom: 'Adulte C', email: 'c@example.com', coefPortion: 1 }, { profils: clone(PROFILS) });
  const reliure = preparerReliure([profil], profil.id, 'c@example.com');
  assert.equal(reliure.email, 'c@example.com');
  const complet = { ...profil, email: reliure.email };
  assert.ok(Object.keys(complet).length >= 5);
  const r = preparerRestauration(relue({ plats: [], profils: [complet] }), { plats: [], profils: [], demandes: [], email: 'a@example.com' });
  const apres = appliquer({ plats: [], profils: [] }, r.lots);
  assert.deepEqual(apres.profils, [complet]);
});

// ——— preparerRestauration : plats ———

test('restauration : plat absent remis entier en fusion ; nom porté par un autre plat → non remis', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = { plats: etat.plats.filter((p) => p.id !== 'tarte-test'), profils: etat.profils, demandes: [], email: 'a@example.com' };
  const r = preparerRestauration(v, app);
  assert.equal(ecrituresDe(r).length, 1);
  const e = ecritureDe(r, 'tarte-test');
  assert.equal(e.mode, 'fusion');
  assert.equal(e.collection, 'plats');
  assert.deepEqual(e.donnees.majLe, { horodatageServeur: true });
  assert.equal(e.donnees.majPar, 'a@example.com');
  assert.equal('vignette' in e.donnees, false);
  assert.deepEqual(r.resume.platsRemis, ['Tarte de test']);
  // Un autre plat porte ce nom dans l'app.
  const pris = preparerRestauration(v, { ...app, plats: [...app.plats, { id: 'tarte-maison', nom: 'Tarte de TEST' }] });
  assert.equal(pris.rien, true);
  assert.deepEqual(pris.resume.nonRemis, ['Tarte de test']);
  assert.deepEqual(pris.avertissements, ['«\u00A0Tarte de test\u00A0» n’est pas remis\u00A0: un autre plat porte déjà ce nom.']);
  assert.equal(pris.resume.ajoutesDepuis, 1);
  textesPropres(pris.avertissements);
});

test('restauration : plat absent à recette abîmée → remis ⏳ avec ses notes', () => {
  const v = validerSauvegarde(fichierAvec([{ ...clone(RECETTE_TARTE), portionsBase: 0, notes: { 'profil-a': 5 }, derniereFois: '2026-09-01' }]));
  const r = preparerRestauration(v, { plats: [], profils: clone(PROFILS), demandes: [], email: 'a@example.com' });
  const e = ecritureDe(r, 'tarte-test');
  assert.deepEqual(Object.keys(e.donnees).sort(), ['derniereFois', 'id', 'majLe', 'majPar', 'nom', 'notes']);
  assert.deepEqual(e.donnees.notes, { 'profil-a': 5 });
  assert.equal(r.resume.notesRemises, 1);
});

test('restauration : plat identique → aucune écriture', () => {
  const etat = etatDeBase();
  const r = preparerRestauration(relue(etat), { ...etat, demandes: [] });
  assert.equal(r.rien, true);
  assert.equal(r.resume.identiques, 3);
});

// ——— preparerRestauration : notes ———

test('restauration : note absente de l’app → chemin en update, sans majLe ; la note 0 est écrite', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = structuredClone(etat);
  delete app.plats[0].notes; // gratin : notes profil-a 5, enfant 0 dans le fichier
  const r = preparerRestauration(v, { ...app, demandes: [] });
  const e = ecritureDe(r, 'gratin-test');
  assert.equal(e.mode, 'update');
  assert.deepEqual(e.donnees, { 'notes.enfant': 0, 'notes.profil-a': 5 });
  assert.equal(r.resume.notesRemises, 2);
  assert.deepEqual(r.recettesDifferentes, []);
});

test('restauration : une note présente dans l’app (même différente) n’est jamais remplacée', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = structuredClone(etat);
  app.plats[0].notes = { 'profil-a': 1 }; // enfant manque, profil-a a changé depuis
  const r = preparerRestauration(v, { ...app, demandes: [] });
  assert.deepEqual(ecritureDe(r, 'gratin-test').donnees, { 'notes.enfant': 0 });
  // Note abîmée dans l'app : comptée comme absente.
  app.plats[0].notes = { 'profil-a': 7, enfant: 2 };
  assert.deepEqual(ecritureDe(preparerRestauration(v, { ...app, demandes: [] }), 'gratin-test').donnees, { 'notes.profil-a': 5 });
});

test('restauration : note d’un profil inconnu du fichier comme de l’app → ignorée avec avertissement', () => {
  const v = validerSauvegarde(fichierAvec([{ ...clone(RECETTE_TARTE), notes: { 'ancien-profil': 4, 'profil-a': 2 } }], [ADULTE_A]));
  const r = preparerRestauration(v, { plats: [clone(RECETTE_TARTE)], profils: [ADULTE_A, ENFANT], demandes: [] });
  assert.deepEqual(ecritureDe(r, 'tarte-test').donnees, { 'notes.profil-a': 2 });
  assert.deepEqual(r.avertissements, ['«\u00A0Tarte de test\u00A0»\u00A0: la note d’un profil qui n’existe plus a été ignorée.']);
  textesPropres(r.avertissements);
  // Profil absent de l'app mais présent dans le fichier : il revient, sa note aussi.
  const v2 = validerSauvegarde(fichierAvec([{ ...clone(RECETTE_TARTE), notes: { enfant: 4 } }], [ADULTE_A, ENFANT]));
  const r2 = preparerRestauration(v2, { plats: [clone(RECETTE_TARTE)], profils: [ADULTE_A], demandes: [] });
  assert.deepEqual(ecrituresDe(r2).map((e) => e.collection), ['profils', 'plats']);
  assert.deepEqual(ecritureDe(r2, 'tarte-test').donnees, { 'notes.enfant': 4 });
});

// ——— preparerRestauration : recettes ———

function avecRecetteChangee(etat) {
  const app = structuredClone(etat);
  app.plats[0].ingredients[0].qte = 500;
  return app;
}

test('restauration : recette différente et décochée → aucune écriture de recette', () => {
  const etat = etatDeBase();
  const app = avecRecetteChangee(etat);
  const r = preparerRestauration(relue(etat), { ...app, demandes: [] });
  assert.equal(r.rien, true);
  assert.deepEqual(r.recettesDifferentes, [{
    id: 'gratin-test', nom: 'Gratin de test', modifieeLe: MODIFIEE, appEnAttente: false, cocheeParDefaut: false,
  }]);
  assert.equal(r.resume.recettesReprises, 0);
});

test('restauration : recette cochée → bloc écrit, champs absents effacés, marque et mise à jour réécrites', () => {
  const etat = etatDeBase();
  const v = relue({ ...etat, plats: etat.plats.map((p) => (p.id === 'gratin-test'
    ? { ...p, variantes: undefined, source: undefined, modifieeLe: undefined, modifieePar: undefined } : p)) });
  const app = avecRecetteChangee(etat);
  const r = preparerRestauration(v, { ...app, demandes: [], email: 'b@example.com' }, { recettesAReprendre: ['gratin-test'] });
  const e = ecritureDe(r, 'gratin-test');
  assert.equal(e.mode, 'update');
  // T2b : les versions de la fiche restent (jamais effacées par une recette reprise).
  assert.deepEqual(e.effacer.sort(), ['modifieeLe', 'modifieePar', 'source']);
  assert.equal(e.donnees.ingredients[0].qte, 400);
  for (const champ of ['nom', 'type', 'recurrence', 'statutRecette', 'portionsBase', 'ingredients', 'etapes', 'cuisson', 'tempsActifMin', 'conservation', 'emporter']) {
    assert.ok(champ in e.donnees, champ);
  }
  assert.equal(e.donnees.majPar, 'b@example.com');
  assert.deepEqual(e.donnees.majLe, { horodatageServeur: true });
  assert.equal('id' in e.donnees, false);
  assert.equal(r.resume.recettesReprises, 1);
  assert.equal(r.resume.dontModifiees, 1);
  const apres = appliquer(app, r.lots).plats.find((p) => p.id === 'gratin-test');
  assert.deepEqual(apres.variantes, FICHE_COMPLETE.variantes);
  assert.equal('modifieeLe' in apres, false);
  assert.deepEqual(apres.notes, FICHE_COMPLETE.notes);
  assert.equal(apres.vignette, FICHE_COMPLETE.vignette, 'photo intacte');
  // Marque « modifiée à la main » du fichier réécrite (objet Date).
  const avecMarque = preparerRestauration(relue(etat), { ...app, demandes: [] }, { recettesAReprendre: ['gratin-test'] });
  assert.equal(ecritureDe(avecMarque, 'gratin-test').donnees.modifieeLe.getTime(), MODIFIEE.getTime());
  assert.equal(ecritureDe(avecMarque, 'gratin-test').effacer, undefined);
});

test('restauration : fiche ⏳ dans l’app → cochée par défaut ; demandes de recette et de variante closes', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = structuredClone(etat);
  app.plats[0] = { id: 'gratin-test', nom: 'Gratin de test', notes: { 'profil-a': 5, enfant: 0 }, derniereFois: '2026-09-27' };
  const demandes = [
    { id: 'gratin-test__recette', statut: 'ouverte' },
    { id: 'gratin-test__profil-b', statut: 'ouverte' },
    { id: 'tarte-test__recette', statut: 'traitee' },
  ];
  const sansCase = preparerRestauration(v, { ...app, demandes });
  assert.equal(sansCase.recettesDifferentes[0].cocheeParDefaut, true);
  assert.equal(sansCase.recettesDifferentes[0].appEnAttente, true);
  assert.equal('modifieeLe' in sansCase.recettesDifferentes[0], false);
  assert.equal(sansCase.rien, true, 'rien n’est repris tant que l’écran ne coche pas');
  const r = preparerRestauration(v, { ...app, demandes }, { recettesAReprendre: ['gratin-test'] });
  assert.deepEqual(r.demandesAClore, ['gratin-test__recette', 'gratin-test__profil-b']);
  assert.equal(r.resume.dontModifiees, 0);
  // Plat absent remis avec sa variante : demande close aussi.
  const absent = preparerRestauration(v, { plats: [], profils: etat.profils, demandes });
  assert.deepEqual(absent.demandesAClore, ['gratin-test__recette', 'gratin-test__profil-b']);
});

test('restauration : dessert avec recette face à un ⏳ du fichier → ni type ni nom écrits', () => {
  const v = validerSauvegarde(fichierAvec([{ id: 'tarte-test', nom: 'Tarte' }]));
  const r = preparerRestauration(v, { plats: [clone(RECETTE_TARTE)], profils: clone(PROFILS), demandes: [] },
    { recettesAReprendre: ['tarte-test'] });
  assert.equal(r.rien, true);
  assert.deepEqual(r.recettesDifferentes, []);
});

test('restauration : nom du fichier porté par un autre plat → nom non réécrit, avertissement', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = avecRecetteChangee(etat);
  app.plats[0].nom = 'Gratin du dimanche';
  app.plats.push({ id: 'autre-gratin', nom: 'Gratin de test' });
  const r = preparerRestauration(v, { ...app, demandes: [] }, { recettesAReprendre: ['gratin-test'] });
  const e = ecritureDe(r, 'gratin-test');
  assert.equal('nom' in e.donnees, false);
  assert.equal(r.recettesDifferentes[0].nom, 'Gratin du dimanche');
  assert.deepEqual(r.avertissements, ['«\u00A0Gratin du dimanche\u00A0» garde son nom actuel\u00A0: un autre plat porte déjà celui du fichier.']);
  textesPropres(r.avertissements);
});

// ——— preparerRestauration : derniereFois, profils ———

test('restauration : derniereFois, la plus récente gagne, jamais de recul', () => {
  const v = validerSauvegarde(fichierAvec([{ id: 'soupe', nom: 'Soupe', derniereFois: '2026-09-20' }]));
  const app = (derniereFois) => ({ plats: [{ id: 'soupe', nom: 'Soupe', ...(derniereFois !== undefined ? { derniereFois } : {}) }], profils: clone(PROFILS), demandes: [] });
  assert.deepEqual(ecritureDe(preparerRestauration(v, app()), 'soupe').donnees, { derniereFois: '2026-09-20' });
  assert.deepEqual(ecritureDe(preparerRestauration(v, app('2026-09-13')), 'soupe').donnees, { derniereFois: '2026-09-20' });
  assert.equal(preparerRestauration(v, app('2026-09-27')).rien, true);
  assert.equal(preparerRestauration(v, app('2026-09-20')).rien, true);
  assert.equal(preparerRestauration(v, app({ seconds: Date.UTC(2026, 8, 27, 10) / 1000, nanoseconds: 0 })).rien, true);
  const r = preparerRestauration(v, app('2026-09-13'));
  assert.equal(r.resume.datesRemises, 1);
  assert.equal('majLe' in ecritureDe(r, 'soupe').donnees, false);
});

test('restauration : profil absent ajouté, présent jamais touché, adresse déjà prise → sans adresse', () => {
  const v = validerSauvegarde(fichierAvec([], clone(PROFILS)));
  const r = preparerRestauration(v, {
    plats: [], demandes: [],
    profils: [{ ...ADULTE_A, nom: 'Renommé', email: '' }, { id: 'profil-z', nom: 'Adulte Z', email: 'A@example.com', ordre: 9, coefPortion: 1 }],
  });
  assert.deepEqual(ecrituresDe(r).map((e) => [e.collection, e.id, e.mode]), [['profils', 'enfant', 'fusion'], ['profils', 'profil-b', 'fusion']]);
  assert.deepEqual(r.resume.profilsRemis, ['Enfant', 'Adulte B']);
  assert.deepEqual(ecritureDe(r, 'enfant').donnees, ENFANT);
  // Adresse portée par un autre profil de l'app : remis sans adresse.
  const r2 = preparerRestauration(v, { plats: [], demandes: [], profils: [{ id: 'profil-z', nom: 'Adulte Z', email: 'a@example.com', ordre: 9, coefPortion: 1 }] });
  assert.equal(ecritureDe(r2, 'profil-a').donnees.email, '');
  assert.equal(r2.avertissements.length, 1);
  textesPropres(r2.avertissements);
});

// ——— Lots, résumé, empreinte ———

test('lots : 1 000 plats → 3 lots de 450 au plus, profils en tête, aucune clé pointée en fusion, rien d’indéfini', () => {
  const plats = Array.from({ length: 1000 }, (_, i) => ({ ...clone(RECETTE_TARTE), id: `plat-${i}`, nom: `Plat ${i}`, notes: { 'profil-a': i % 6 } }));
  const r = preparerRestauration(relue({ plats, profils: clone(PROFILS) }), { plats: [], profils: [], demandes: [] });
  assert.equal(r.lots.length, 3);
  for (const lot of r.lots) assert.ok(lot.length <= ECRITURES_PAR_LOT);
  assert.deepEqual(r.lots[0].slice(0, 3).map((e) => e.collection), ['profils', 'profils', 'profils']);
  for (const e of ecrituresDe(r)) {
    assert.equal(clePointee(e.donnees), false);
    assert.equal(contientUndefined(e), false);
    assert.equal('vignette' in e.donnees, false);
  }
  // Un lot passé, puis recalcul : ce lot ne manque plus.
  const apres = appliquer({ plats: [], profils: [] }, [r.lots[0]]);
  const relance = preparerRestauration(relue({ plats, profils: clone(PROFILS) }), { ...apres, demandes: [] });
  const faits = new Set(r.lots[0].map((e) => `${e.collection}/${e.id}`));
  assert.equal(ecrituresDe(relance).some((e) => faits.has(`${e.collection}/${e.id}`)), false);
  assert.equal(ecrituresDe(relance).length, 1003 - r.lots[0].length);
});

test('lots : en update, les clés sont des chemins de notes ou des champs de la recette', () => {
  const etat = etatDeBase();
  const app = avecRecetteChangee(etat);
  delete app.plats[0].notes;
  app.plats[0].derniereFois = '2026-01-01';
  const r = preparerRestauration(relue(etat), { ...app, demandes: [] }, { recettesAReprendre: ['gratin-test'] });
  const permis = new Set([...CHAMPS_PLAT, 'derniereFois', 'modifieeLe', 'modifieePar', 'majPar', 'majLe']);
  for (const e of ecrituresDe(r).filter((x) => x.mode === 'update')) {
    for (const cle of Object.keys(e.donnees)) assert.ok(permis.has(cle) || /^notes\.[a-z0-9-]+$/.test(cle), cle);
    for (const cle of e.effacer ?? []) assert.ok(permis.has(cle), cle);
  }
});

test('résumé : comptes exacts', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = avecRecetteChangee(etat);
  app.plats = app.plats.filter((p) => p.id !== 'tarte-test'); // supprimé sur l'autre appareil
  app.plats.find((p) => p.id === 'lasagnes').notes = {};
  app.plats.push({ id: 'nouveau', nom: 'Nouveau plat' }, { id: 'autre', nom: 'Autre plat' });
  app.profils = app.profils.filter((p) => p.id !== 'enfant');
  const r = preparerRestauration(v, { ...app, demandes: [] });
  assert.deepEqual(r.resume, {
    date: MAINTENANT,
    platsRemis: ['Tarte de test'],
    notesRemises: 1,
    profilsRemis: ['Enfant'],
    datesRemises: 0,
    recettesReprises: 0,
    dontModifiees: 0,
    identiques: 1, // lasagnes, ⏳ des deux côtés
    ajoutesDepuis: 2,
    nonRemis: [],
    reglesRemises: [], // T2a : aucun profil du fichier n'a de règles
    versionsRemises: [], // T2b : les versions du fichier sont déjà sur les fiches
  });
  assert.equal(r.recettesDifferentes.length, 1);
  assert.equal(r.rien, false);
});

test('empreinteRestauration : stable pour le même état, différente après un changement distant', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = structuredClone(etat);
  delete app.plats[0].notes;
  const a = empreinteRestauration(preparerRestauration(v, { ...app, demandes: [] }));
  assert.equal(empreinteRestauration(preparerRestauration(v, { ...structuredClone(app), demandes: [] })), a);
  assert.equal(typeof a, 'string');
  const distant = structuredClone(app);
  distant.plats[0].notes = { 'profil-a': 2 }; // noté entre-temps sur l'autre téléphone
  assert.notEqual(empreinteRestauration(preparerRestauration(v, { ...distant, demandes: [] })), a);
  const recetteChangee = avecRecetteChangee(app);
  assert.notEqual(empreinteRestauration(preparerRestauration(v, { ...recetteChangee, demandes: [] })), a);
});

test('restauration : données d’entrée jamais modifiées', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app = avecRecetteChangee(etat);
  delete app.plats[0].notes;
  const avant = JSON.stringify([v, app]);
  preparerRestauration(v, { ...app, demandes: [] }, { recettesAReprendre: ['gratin-test'] });
  assert.equal(JSON.stringify([v, app]), avant);
});

// ——— paquet.js (ajustements T1d-2) ———

test('extrairePaquet : la longueur acceptée suit `max`', () => {
  const texte = `${JSON.stringify({ format: 'paquet@1', plats: [RECETTE_TARTE] })}${' '.repeat(600_000)}`;
  assert.deepEqual(extrairePaquet(texte), { erreur: 'trop_long' });
  assert.equal(extrairePaquet(texte, { max: FICHIER_MAX }).paquets.length, 1);
});

test('validerPaquet : platsMax et doublonsDeNom', () => {
  const plats = (n) => Array.from({ length: n }, (_, i) => ({ id: `plat-${i}`, nom: `Plat ${i}` }));
  assert.equal(validerPaquet([{ format: 'paquet@1', plats: plats(PLATS_MAX + 1) }]).valide, false);
  assert.equal(validerPaquet([{ format: 'paquet@1', plats: plats(PLATS_MAX + 1) }], { platsMax: PLATS_MAX_SAUVEGARDE }).valide, true);
  const memeNom = [{ format: 'paquet@1', plats: [{ id: 'soupe', nom: 'Soupe' }, { id: 'soupe-2', nom: 'Soupe' }] }];
  assert.equal(validerPaquet(memeNom).valide, false);
  assert.equal(validerPaquet(memeNom, { doublonsDeNom: false }).valide, true);
  const memeId = [{ format: 'paquet@1', plats: [{ id: 'soupe', nom: 'Soupe' }, { id: 'soupe', nom: 'Potage' }] }];
  assert.equal(validerPaquet(memeId, { doublonsDeNom: false }).valide, false);
});

test('estSauvegarde : vrai dès qu’un objet porte sauvegardeLe', () => {
  assert.equal(estSauvegarde([{ format: 'paquet@1', plats: [] }]), false);
  assert.equal(estSauvegarde([{ format: 'paquet@1', plats: [] }, { format: 'paquet@1', sauvegardeLe: 'x', plats: [] }]), true);
  assert.equal(estSauvegarde({ sauvegardeLe: '2026-10-06T16:42:00.000Z' }), true);
  assert.equal(estSauvegarde(null), false);
  const { texte } = creerSauvegarde(etatDeBase(), { maintenant: MAINTENANT });
  assert.equal(estSauvegarde(extrairePaquet(texte, { max: FICHIER_MAX }).paquets), true);
});

test('validerPaquet : notes, derniereFois, modifieeLe, modifieePar connus mais ignorés ; seules les notes avertissent', () => {
  const suivi = { ...clone(RECETTE_TARTE), derniereFois: '2026-09-01', modifieeLe: 'x', modifieePar: 'a@example.com' };
  const sansNote = validerPaquet([{ format: 'paquet@1', plats: [suivi] }]);
  assert.equal(sansNote.valide, true);
  assert.deepEqual(sansNote.avertissements, []);
  assert.deepEqual(sansNote.plats[0].avertissements, []);
  for (const champ of ['derniereFois', 'modifieeLe', 'modifieePar', 'notes']) assert.equal(champ in sansNote.plats[0].donnees, false);
  const avecNotes = validerPaquet([{ format: 'paquet@1', plats: [{ ...suivi, notes: { 'profil-a': 4 } }] }]);
  assert.deepEqual(avecNotes.avertissements.map((a) => a.message), ['Les notes ne sont pas reprises ici.']);
  assert.equal('notes' in avecNotes.plats[0].donnees, false);
});

test('recetteValidee : défauts complétés, notes et suivi écartés, null si abîmée', () => {
  assert.deepEqual(recetteValidee({ id: 'soupe', nom: 'Soupe', notes: { a: 1 }, majLe: 3, vignette: 'x' }),
    { type: 'plat', recurrence: 'aucune', statutRecette: 'attente', id: 'soupe', nom: 'Soupe' });
  assert.equal(recetteValidee({ ...clone(RECETTE_TARTE), portionsBase: 0 }), null);
  assert.equal(recetteValidee(null), null);
  assert.ok(egalProfonde(recetteValidee(FICHE_COMPLETE), recetteValidee(clone({ ...FICHE_COMPLETE, notes: {} }))));
});

test('demandesSatisfaites : recette reçue et variantes, demandes ouvertes seulement', () => {
  const ouvertes = new Set(['gratin-test__recette', 'gratin-test__profil-b', 'gratin-test__enfant']);
  // T2b : `profils` obligatoire (une version n'est satisfaite que si elle convient au profil).
  const profils = clone(PROFILS);
  assert.deepEqual(demandesSatisfaites('gratin-test', FICHE_COMPLETE, ouvertes, { profils }), ['gratin-test__recette', 'gratin-test__profil-b']);
  assert.deepEqual(demandesSatisfaites('gratin-test', { id: 'gratin-test', nom: 'Gratin' }, [...ouvertes], { profils }), []);
  assert.deepEqual(demandesSatisfaites('gratin-test', FICHE_COMPLETE, [], { profils }), []);
  assert.throws(() => demandesSatisfaites('gratin-test', FICHE_COMPLETE, ouvertes), TypeError);
});

test('preparerImport : recette identique → statut identique, aucune écriture, marque gardée ; différente → remplace', () => {
  const recu = validerPaquet([{ format: 'paquet@1', plats: [clone(RECETTE_TARTE)] }]).plats.map((p) => p.donnees);
  const fiche = { ...clone(RECETTE_TARTE), notes: { 'profil-a': 5 }, modifieeLe: { seconds: 1790000000 }, modifieePar: 'b@example.com', vignette: 'x' };
  const identique = preparerImport(recu, { plats: [fiche], demandes: [] });
  assert.equal(identique.elements[0].statut, 'identique');
  assert.deepEqual(identique.ecritures, []);
  assert.equal('modifieeA' in identique.elements[0], false);
  // T2b : même recette, nom différent → le nom de la fiche est gardé, rien n'est écrit, avertissement.
  const renommee = preparerImport(recu, { plats: [{ ...fiche, nom: 'Tarte renommée' }], demandes: [] });
  assert.equal(renommee.elements[0].statut, 'identique');
  assert.equal(renommee.elements[0].nom, 'Tarte renommée');
  assert.deepEqual(renommee.ecritures, []);
  assert.match(renommee.elements[0].avertissements.join(' '), /le nom de la fiche est gardé/);
  // Recette différente : remplacée comme avant, la marque est effacée.
  const differente = preparerImport(recu, { plats: [{ ...fiche, etapes: ['Autre.'] }], demandes: [] });
  assert.equal(differente.elements[0].statut, 'remplace');
  assert.equal(differente.ecritures[0].effacerModification, true);
});

test('preparerImport : recette identique → la demande de recette restée ouverte est close quand même', () => {
  const recu = validerPaquet([{ format: 'paquet@1', plats: [clone(RECETTE_TARTE)] }]).plats.map((p) => p.donnees);
  const demandes = [{ id: 'tarte-test__recette', statut: 'ouverte' }, { id: 'autre__recette', statut: 'ouverte' }];
  const r = preparerImport(recu, { plats: [clone(RECETTE_TARTE)], demandes });
  assert.equal(r.elements[0].statut, 'identique');
  assert.deepEqual(r.ecritures, []);
  assert.deepEqual(r.demandesAClore, ['tarte-test__recette']);
  // Demande déjà traitée : rien à clore.
  const traitee = preparerImport(recu, { plats: [clone(RECETTE_TARTE)], demandes: [{ id: 'tarte-test__recette', statut: 'traitee' }] });
  assert.deepEqual(traitee.demandesAClore, []);
});

// ——— Rôles ———

test('routes : « Restaurer une sauvegarde » réservé au gestionnaire, sans paramètre', () => {
  assert.equal(routeAutorisee('restaurer', 'gestionnaire'), true);
  assert.equal(routeAutorisee('restaurer', 'courses'), false);
  assert.equal(resoudreRoute('#/restaurer', 'gestionnaire'), 'restaurer');
  assert.equal(resoudreRoute('#/restaurer', 'courses'), 'semaine');
  assert.equal(resoudreRoute('#/restaurer/gratin-test', 'gestionnaire'), 'restaurer');
  assert.equal(parametreDe('#/restaurer/gratin-test', 'restaurer'), '');
});

// ——— Revue à l'envoi (appliquerConditions) : rien de ce qui a changé entre-temps n'est écrasé ———

test('envoi : plat ou profil à remettre → seulement s’il manque encore', () => {
  const etat = etatDeBase();
  const app = structuredClone(etat);
  app.plats = app.plats.filter((p) => p.id !== 'tarte-test');
  app.profils = app.profils.filter((p) => p.id !== 'enfant');
  const r = preparerRestauration(relue(etat), { ...app, demandes: [] });
  const plat = ecritureDe(r, 'tarte-test');
  const profil = ecrituresDe(r).find((e) => e.collection === 'profils');
  assert.deepEqual(plat.condition, { absent: true });
  assert.equal(appliquerConditions(plat, null), plat);
  assert.equal(appliquerConditions(plat, { id: 'tarte-test', nom: 'Tarte refaite ailleurs' }), null);
  assert.equal(appliquerConditions(profil, null), profil);
  assert.equal(appliquerConditions(profil, { nom: 'Enfant' }), null);
});

test('envoi : une note posée ailleurs entre-temps n’est pas écrasée ; plat supprimé → rien', () => {
  const etat = etatDeBase();
  const app = structuredClone(etat);
  delete app.plats[0].notes;
  const e = ecritureDe(preparerRestauration(relue(etat), { ...app, demandes: [] }), 'gratin-test');
  assert.deepEqual(e.condition.notesAbsentes.sort(), ['enfant', 'profil-a']);
  const ailleurs = { ...app.plats[0], notes: { 'profil-a': 2 } };
  assert.deepEqual(appliquerConditions(e, ailleurs).donnees, { 'notes.enfant': 0 });
  assert.equal(appliquerConditions(e, { ...app.plats[0], notes: { 'profil-a': 2, enfant: 4 } }), null);
  assert.equal(appliquerConditions(e, null), null, 'plat supprimé : jamais recréé à moitié');
});

test('envoi : derniereFois écrite seulement si elle reste plus récente', () => {
  const etat = etatDeBase();
  const app = structuredClone(etat);
  app.plats[0].derniereFois = '2026-09-01';
  const e = ecritureDe(preparerRestauration(relue(etat), { ...app, demandes: [] }), 'gratin-test');
  assert.deepEqual(e.donnees, { derniereFois: '2026-09-27' });
  assert.deepEqual(appliquerConditions(e, app.plats[0]).donnees, { derniereFois: '2026-09-27' });
  assert.equal(appliquerConditions(e, { ...app.plats[0], derniereFois: '2026-10-04' }), null);
});

test('envoi : recette cochée remplacée seulement si la fiche est encore celle de l’aperçu', () => {
  const etat = etatDeBase();
  const app = avecRecetteChangee(etat);
  delete app.plats[0].notes;
  const demandes = [{ id: 'gratin-test__profil-b', statut: 'ouverte' }];
  const r = preparerRestauration(relue(etat), { ...app, demandes }, { recettesAReprendre: ['gratin-test'] });
  const e = ecritureDe(r, 'gratin-test');
  assert.equal(typeof e.condition.recette, 'string');
  assert.deepEqual(e.clore, ['gratin-test__profil-b']);
  // Fiche inchangée : tout part, demandes comprises.
  assert.deepEqual(appliquerConditions(e, structuredClone(app.plats[0])), e);
  // Fiche changée ailleurs : seules les notes restent, ni recette ni demande.
  const changee = structuredClone(app.plats[0]);
  changee.etapes = ['Une autre façon de faire.'];
  const reste = appliquerConditions(e, changee);
  assert.deepEqual(reste.donnees, { 'notes.enfant': 0, 'notes.profil-a': 5 });
  assert.equal(reste.effacer, undefined);
  assert.equal(reste.clore, undefined);
  // Marque « modifiée à la main » posée ailleurs : la fiche a aussi changé.
  assert.equal(appliquerConditions(e, { ...structuredClone(app.plats[0]), modifieePar: 'b@example.com' }).donnees.ingredients, undefined);
});

test('empreinte : une recette cochée changée entre l’aperçu et le toucher change l’empreinte', () => {
  const etat = etatDeBase();
  const v = relue(etat);
  const app1 = avecRecetteChangee(etat);
  const app2 = structuredClone(app1);
  app2.plats[0].etapes = ['Une autre façon de faire.'];
  const options = { recettesAReprendre: ['gratin-test'] };
  const p1 = preparerRestauration(v, { ...app1, demandes: [] }, options);
  const p2 = preparerRestauration(v, { ...app2, demandes: [] }, options);
  assert.notEqual(empreinteRestauration(p1), empreinteRestauration(p2));
  assert.equal(empreinteRestauration(p1), empreinteRestauration(preparerRestauration(v, { ...structuredClone(app1), demandes: [] }, options)));
});
