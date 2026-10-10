// T2e « Demander sa version, être prévenu » : demandes de recettes et de versions (coeur/demandes.js), notification
// ntfy (coeur/ntfy.js), aller-retour avec la clôture de l'ajout de recettes (paquet.js › demandesSatisfaites,
// preparerImport), confidentialité de ce qui part chez ntfy.sh. Fixtures génériques (aucune donnée du foyer). Dates
// locales vérifiées à l'heure de Paris (chaque fichier de test tourne dans son propre processus).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import {
  SUFFIXE_RECETTE, idDemande, lireIdDemande, demandeOuverte, dateDemande, versionADemander, etatDemande,
  preparerDemande, demandeUtile, demandesATraiter, grouperDemandes, texteDemandee,
} from '../js/coeur/demandes.js';
import {
  SERVEUR_NTFY, TITRE_NOTIFICATION, ETIQUETTE_NOTIFICATION, PRIORITE_NOTIFICATION, PREFIXE_SUJET, SIGNES_SUJET,
  ALPHABET_SUJET, LIEN_INSTALLER_NTFY, NOM_PLAT_MAX, sujetValide, nouveauSujet, texteNotification, adresseNotification,
  lienAbonnement, issueEnvoi, texteEssai,
} from '../js/coeur/ntfy.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { demandeDeRecette } from '../js/coeur/plats.js';
import { versDate, jourLisible, demandesDesPlats } from '../js/coeur/corbeille.js';
import {
  validerPaquet, preparerImport, demandesSatisfaites, fusionnerVariantes, stylesAttendusDesVersions,
} from '../js/coeur/paquet.js';
import { ecrireRegime } from '../js/coeur/regles.js';
import { reglesSelonAge } from '../js/coeur/age.js';

// ——— Fixtures génériques (aucune donnée du foyer) ———

const MAINTENANT = new Date('2026-10-10T10:00:00.000Z'); // midi à Paris
const NAISSANCE = '2024-03-15';
const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const SANS_NAVET = [{ id: 'navet', type: 'exclureProduits', produits: ['navet'], severite: 'exclu' }];

const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: 'b@example.com', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
// L'enfant n'a que des précautions selon son âge : jamais de version, jamais de demande.
const ENFANT = {
  id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5, naissance: NAISSANCE,
  regles: reglesSelonAge(NAISSANCE, MAINTENANT, []).regles,
};
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A]; // volontairement dans le désordre
const AUTEUR = 'b@example.com';

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, marqueurs = []) => ({ produit, qtePortion, unite, rayon: 'divers', marqueurs });
const JAMBON = ing('jambon blanc', 4, 'tranche', ['viande', 'porc', 'charcuterie'], { forme: 'fine' });
const SAUCISSON = ing('saucisson sec', 1, 'pc', ['viande', 'porc', 'charcuterie'], { forme: 'fine' });
const LARDONS = ing('lardons', 150, 'g', ['viande', 'porc', 'charcuterie'], { forme: 'morceaux' });
const GELATINE = ing('gélatine', 2, 'pc', ['gelatine_porc']);
const PATES = ing('pâtes courtes', 400, 'g', ['feculent']);
const SAUMON = ajout('saumon fumé', 2, 'tranche', ['poisson']);
const TOFU = ajout('tofu fumé', 60, 'g');
const BOUILLON = ajout('bouillon de volaille', 10, 'cl', ['bouillon_viande']);

const fiche = (id, nom, type, ingredients, extra = {}) => ({
  id, nom, type, recurrence: 'aucune', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Préparer.'], ...extra,
});
const GRATIN = fiche('gratin-test', 'Gratin test', 'plat', [PATES, JAMBON]);
const LENTILLES = fiche('lentilles-test', 'Lentilles test', 'plat', [ing('lentille corail', 300, 'g', ['feculent'])]);
const APERO = fiche('planche-apero', 'Planche apéro', 'apero', [SAUCISSON, ing('olive verte', 100, 'g')]);
const PREPARATION = fiche('yaourt-test', 'Yaourt test', 'preparation', [ing('lait', 1, 'l', ['laitier']), GELATINE]);
const ACCOMPAGNEMENT = fiche('haricots-test', 'Haricots test', 'accompagnement', [ing('haricot vert', 500, 'g'), LARDONS]);
const DESSERT = fiche('panna-test', 'Panna test', 'dessert', [ing('crème liquide', 50, 'cl', ['laitier']), GELATINE]);
const ATTENTE = { id: 'lasagnes', nom: 'Lasagnes' }; // ⏳ : ajouté par son nom

const version = (pour, retirer, ajouter, extra = {}) => ({ pour, retirer, ajouter, consigne: 'Part à part.', ...extra });
const MER_GRATIN = version('profil-b', ['jambon blanc'], [SAUMON], { style: 'mer', frigoJours: 2 });
const VEG_GRATIN = version('profil-b', ['jambon blanc'], [TOFU], { style: 'vegetal' });
const MAUVAISE_GRATIN = version('profil-b', ['jambon blanc'], [TOFU, BOUILLON], { style: 'vegetal' });
const VEG_APERO = version('profil-b', ['saucisson sec'], [TOFU], { style: 'vegetal' });
const avecVersions = (plat, ...variantes) => ({ ...plat, variantes });
const jete = (plat) => ({ ...plat, corbeille: { le: new Date('2026-10-09T08:00:00.000Z'), par: 'a@example.com' } });
const note = (plat, notes) => ({ ...plat, notes });

/** Horodatage Firestore (toDate et secondes). */
const horodatage = (iso) => {
  const date = new Date(iso);
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0, toDate: () => new Date(date) };
};
/** Demande telle que l'app la lit : identifiant, données préparées, `creeLe`. */
const lue = (preparation, creeLe = horodatage('2026-10-08T09:00:00.000Z')) => ({ id: preparation.id, ...preparation.donnees, creeLe });
const ouverteVersion = (platId, profilId = 'profil-b', extra = {}) => ({
  id: `${platId}__${profilId}`, type: 'variante', platId, profilId, creePar: AUTEUR, statut: 'ouverte',
  creeLe: horodatage('2026-10-08T09:00:00.000Z'), ...extra,
});
const ouverteRecette = (platId, extra = {}) => ({
  id: `${platId}__recette`, type: 'recette', platId, creePar: AUTEUR, statut: 'ouverte',
  creeLe: horodatage('2026-10-08T09:00:00.000Z'), ...extra,
});

/** Vrai si la valeur contient undefined ou null, à quelque profondeur que ce soit. */
function contientVide(valeur) {
  if (valeur === undefined || valeur === null) return true;
  if (Array.isArray(valeur)) return valeur.some(contientVide);
  if (valeur && typeof valeur === 'object') return Object.values(valeur).some(contientVide);
  return false;
}

// Aucun mot technique, aucune adresse, espaces insécables à leur place dans un texte affiché.
function textesPropres(textes) {
  for (const texte of textes) {
    assert.equal(typeof texte, 'string');
    assert.ok(texte.length > 0);
    assert.doesNotMatch(texte, /paquet|slug|json|\bIA\b|undefined|null|NaN|\[object|`|[{}[\]_@]/i, texte);
    assert.doesNotMatch(texte, /\u00A0{2}| {2}|\u00A0 | \u00A0/, texte);
    assert.doesNotMatch(texte, / [:;!?»]|« /, `espace insécable attendue : ${texte}`);
    assert.doesNotMatch(texte, /'/, `apostrophe typographique attendue : ${texte}`);
  }
}

const valides = (...plats) => {
  const resultat = validerPaquet([{ format: 'paquet@1', plats }], { profils: PROFILS });
  assert.equal(resultat.valide, true, JSON.stringify(resultat.erreurs.concat(resultat.plats.flatMap((p) => p.erreurs))));
  return resultat.plats.map((p) => p.donnees);
};

/** Fiche après réception de ces versions, fusionnées comme à l'écriture (paquet.js). */
function fusionnee(plat, recues) {
  const attendus = stylesAttendusDesVersions(plat, recues, PROFILS);
  return { ...plat, variantes: fusionnerVariantes(plat.variantes, recues, { attendus }) };
}

// ——— Identifiants ———

test('idDemande : recette sans profil, version avec son profil', () => {
  assert.equal(SUFFIXE_RECETTE, 'recette');
  assert.equal(idDemande('gratin-test'), 'gratin-test__recette');
  assert.equal(idDemande('gratin-test', null), 'gratin-test__recette');
  assert.equal(idDemande('gratin-test', 'profil-b'), 'gratin-test__profil-b');
  // Exactement l'identifiant que demandesSatisfaites reconstruit, et celui de demandeDeRecette.
  assert.equal(idDemande('lasagnes'), demandeDeRecette('lasagnes', AUTEUR).id);
});

test('idDemande : slug invalide ou profil « recette » → null', () => {
  for (const platId of ['Gratin', 'gratin test', 'a/b', 'a__b', '', ' ', 'été', undefined, null, 42, {}]) {
    assert.equal(idDemande(platId), null, String(platId));
    assert.equal(idDemande(platId, 'profil-b'), null, String(platId));
  }
  for (const profilId of ['Profil-B', 'profil b', 'p/b', 'p__b', '', 42, {}, 'recette']) {
    assert.equal(idDemande('gratin-test', profilId), null, String(profilId));
  }
});

test('lireIdDemande : recette et version', () => {
  assert.deepEqual(lireIdDemande('gratin-test__recette'), { platId: 'gratin-test', profilId: null, type: 'recette' });
  assert.deepEqual(lireIdDemande('gratin-test__profil-b'), { platId: 'gratin-test', profilId: 'profil-b', type: 'variante' });
  // Aller-retour.
  for (const [platId, profilId] of [['a', null], ['plat-2', 'profil-a'], ['x-y-z', 'enfant']]) {
    assert.deepEqual(lireIdDemande(idDemande(platId, profilId)), { platId, profilId, type: profilId ? 'variante' : 'recette' });
  }
});

test('lireIdDemande : identifiant illisible → null', () => {
  for (const id of ['gratin-test', 'gratin-test__', '__profil-b', '__', 'a__b__c', 'a____b', 'A__b', 'a__B', 'a b__c', '', undefined, null, 42]) {
    assert.equal(lireIdDemande(id), null, String(id));
  }
});

test('demandeOuverte : la demande ouverte de cet identifiant, sinon null', () => {
  const demandes = [
    ouverteVersion('gratin-test', 'profil-b', { statut: 'traitee' }),
    ouverteRecette('lasagnes'),
    null,
    'bizarre',
  ];
  assert.equal(demandeOuverte(demandes, 'gratin-test__profil-b'), null);
  assert.equal(demandeOuverte(demandes, 'lasagnes__recette'), demandes[1]);
  assert.equal(demandeOuverte(demandes, 'inconnu__recette'), null);
  assert.equal(demandeOuverte(undefined, 'lasagnes__recette'), null);
  assert.equal(demandeOuverte(demandes, ''), null);
  assert.equal(demandeOuverte(demandes, undefined), null);
});

test('dateDemande : horodatage Firestore, secondes, Date, texte ISO', () => {
  const attendu = new Date('2026-10-08T09:00:00.000Z').getTime();
  for (const creeLe of [
    horodatage('2026-10-08T09:00:00.000Z'),
    { seconds: attendu / 1000, nanoseconds: 0 },
    new Date(attendu),
    '2026-10-08T09:00:00.000Z',
  ]) {
    const { date, enAttente } = dateDemande({ id: 'a__recette', creeLe });
    assert.equal(enAttente, false);
    assert.equal(date.getTime(), attendu);
  }
});

test('dateDemande : null = en attente du serveur ; absent ou illisible = date inconnue', () => {
  assert.deepEqual(dateDemande({ id: 'a__recette', creeLe: null }), { date: null, enAttente: true });
  for (const demande of [{ id: 'a__recette' }, { creeLe: undefined }, { creeLe: 'pas une date' }, { creeLe: {} },
    { creeLe: { toDate: () => { throw new Error('abîmé'); } } }, { creeLe: 12 }]) {
    assert.deepEqual(dateDemande(demande), { date: null, enAttente: false }, JSON.stringify(demande));
  }
  assert.deepEqual(dateDemande(null), { date: null, enAttente: false });
  assert.deepEqual(dateDemande(undefined), { date: null, enAttente: false });
});

// ——— versionADemander ———

test('versionADemander : plat, accompagnement, dessert, apéro et préparation à créer → vrai', () => {
  for (const plat of [GRATIN, ACCOMPAGNEMENT, DESSERT, APERO, PREPARATION]) {
    const resultat = evaluer(plat, ADULTE_B);
    assert.equal(resultat.aCreer, true, plat.id);
    assert.equal(versionADemander(plat, ADULTE_B, resultat), true, plat.id);
  }
});

test('versionADemander : à revoir → vrai ; à compléter, qui convient, ⏳, « Jamais », corbeille → faux', () => {
  const revoir = avecVersions(GRATIN, MAUVAISE_GRATIN);
  assert.equal(evaluer(revoir, ADULTE_B).aRevoir, true);
  assert.equal(versionADemander(revoir, ADULTE_B, evaluer(revoir, ADULTE_B)), true);
  const completer = avecVersions(GRATIN, MER_GRATIN);
  assert.equal(evaluer(completer, ADULTE_B).aCompleter, true);
  const faux = [
    completer,
    avecVersions(GRATIN, MER_GRATIN, VEG_GRATIN),
    LENTILLES,
    ATTENTE,
    note(GRATIN, { 'profil-b': 0 }),
    jete(GRATIN),
  ];
  for (const plat of faux) {
    assert.equal(versionADemander(plat, ADULTE_B, evaluer(plat, ADULTE_B)), false, plat.id);
  }
  // Une autre note que « Jamais » ne change rien ; la note d'un autre profil non plus.
  assert.equal(versionADemander(note(GRATIN, { 'profil-b': 1, 'profil-a': 0 }), ADULTE_B, evaluer(GRATIN, ADULTE_B)), true);
});

test('versionADemander : sans résultat, sans profil ou sans plat → faux', () => {
  assert.equal(versionADemander(GRATIN, ADULTE_B, null), false);
  assert.equal(versionADemander(GRATIN, ADULTE_B, {}), false);
  assert.equal(versionADemander(GRATIN, null, { aCreer: true }), false);
  assert.equal(versionADemander(null, ADULTE_B, { aCreer: true }), false);
  assert.equal(versionADemander(GRATIN, ADULTE_B, { aCreer: false, aRevoir: false, aCompleter: true }), false);
});

// ——— etatDemande et preparerDemande ———

test('plat au jambon sans version (à créer) : possible, document exact', () => {
  assert.deepEqual(etatDemande(GRATIN, ADULTE_B), { possible: true, id: 'gratin-test__profil-b' });
  assert.deepEqual(preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { auteur: AUTEUR }), {
    id: 'gratin-test__profil-b',
    donnees: { type: 'variante', platId: 'gratin-test', profilId: 'profil-b', besoin: 'sans_viande', creePar: AUTEUR, statut: 'ouverte' },
  });
});

test('seule version, qui ne convient pas (à revoir) : possible, besoin de la version montrée', () => {
  const revoir = avecVersions(GRATIN, MAUVAISE_GRATIN);
  assert.deepEqual(etatDemande(revoir, ADULTE_B), { possible: true, id: 'gratin-test__profil-b' });
  assert.equal(preparerDemande({ plat: revoir, profil: ADULTE_B }, { auteur: AUTEUR }).donnees.besoin, 'sans_viande');
  // Un profil qui ne mange pas de navet : la version laisse le navet, besoin « adapter ».
  const sansNavet = { ...ADULTE_A, regles: SANS_NAVET };
  const pot = fiche('pot-test', 'Pot test', 'plat', [ing('navet', 2, 'pc', ['legume'], { role: 'principal' }), PATES],
    { variantes: [version('profil-a', [], [TOFU])] });
  assert.equal(evaluer(pot, sansNavet).aRevoir, true);
  assert.deepEqual(preparerDemande({ plat: pot, profil: sansNavet }, { auteur: 'a@example.com' }), {
    id: 'pot-test__profil-a',
    donnees: { type: 'variante', platId: 'pot-test', profilId: 'profil-a', besoin: 'adapter', creePar: 'a@example.com', statut: 'ouverte' },
  });
});

test('version mer qui convient, végétale manquante (à compléter) : rien à demander', () => {
  const completer = avecVersions(GRATIN, MER_GRATIN);
  assert.equal(etatDemande(completer, ADULTE_B), null);
  assert.deepEqual(preparerDemande({ plat: completer, profil: ADULTE_B }, { auteur: AUTEUR }), { erreur: 'inutile' });
});

test('plat qui convient, ou sans viande : rien à demander', () => {
  for (const plat of [LENTILLES, avecVersions(GRATIN, MER_GRATIN, VEG_GRATIN)]) {
    assert.equal(etatDemande(plat, ADULTE_B), null, plat.id);
    assert.deepEqual(preparerDemande({ plat, profil: ADULTE_B }, { auteur: AUTEUR }), { erreur: 'inutile' }, plat.id);
  }
});

test('plat ⏳ : jamais de version ; la recette se demande', () => {
  assert.equal(etatDemande(ATTENTE, ADULTE_B), null);
  assert.deepEqual(preparerDemande({ plat: ATTENTE, profil: ADULTE_B }, { auteur: AUTEUR }), { erreur: 'inutile' });
  assert.deepEqual(etatDemande(ATTENTE, null), { possible: true, id: 'lasagnes__recette' });
  assert.deepEqual(etatDemande(ATTENTE), { possible: true, id: 'lasagnes__recette' });
  const preparation = preparerDemande({ plat: ATTENTE }, { auteur: AUTEUR });
  assert.deepEqual(preparation, {
    id: 'lasagnes__recette', donnees: { type: 'recette', platId: 'lasagnes', creePar: AUTEUR, statut: 'ouverte' },
  });
  // Même forme que l'ajout par nom (plats.js › demandeDeRecette).
  assert.deepEqual(preparation, demandeDeRecette('lasagnes', AUTEUR));
});

test('plat rempli : sa recette ne se demande pas', () => {
  assert.equal(etatDemande(GRATIN, null), null);
  assert.deepEqual(preparerDemande({ plat: GRATIN }, { auteur: AUTEUR }), { erreur: 'inutile' });
});

test('apéro ou préparation au jambon sans version : se demandent comme un plat', () => {
  for (const plat of [APERO, PREPARATION]) {
    assert.deepEqual(etatDemande(plat, ADULTE_B), { possible: true, id: `${plat.id}__profil-b` });
    assert.deepEqual(preparerDemande({ plat, profil: ADULTE_B }, { auteur: AUTEUR }), {
      id: `${plat.id}__profil-b`,
      donnees: { type: 'variante', platId: plat.id, profilId: 'profil-b', besoin: 'sans_viande', creePar: AUTEUR, statut: 'ouverte' },
    });
  }
});

test('apéro avec une version qui convient : rien à demander', () => {
  const apero = avecVersions(APERO, VEG_APERO);
  assert.equal(evaluer(apero, ADULTE_B).aCompleter, true);
  assert.equal(etatDemande(apero, ADULTE_B), null);
  assert.deepEqual(preparerDemande({ plat: apero, profil: ADULTE_B }, { auteur: AUTEUR }), { erreur: 'inutile' });
});

test('plat noté « Jamais » par ce profil : rien à demander', () => {
  const jamais = note(GRATIN, { 'profil-b': 0 });
  assert.equal(etatDemande(jamais, ADULTE_B), null);
  assert.deepEqual(preparerDemande({ plat: jamais, profil: ADULTE_B }, { auteur: AUTEUR }), { erreur: 'inutile' });
});

test('plat de la corbeille, ou absent : rien à demander, ni version ni recette', () => {
  for (const [plat, profil] of [[jete(GRATIN), ADULTE_B], [jete(ATTENTE), null], [null, ADULTE_B], [undefined, null], ['gratin', null]]) {
    assert.equal(etatDemande(plat, profil), null);
    assert.deepEqual(preparerDemande({ plat, profil }, { auteur: AUTEUR }), { erreur: 'inutile' });
  }
  assert.deepEqual(preparerDemande(undefined, { auteur: AUTEUR }), { erreur: 'inutile' });
});

test('profil sans règle, passé à « Mange de tout », enfant qui n’a que des précautions d’âge : rien à demander', () => {
  assert.ok(ENFANT.regles.length > 0);
  for (const profil of [ADULTE_A, { ...ADULTE_B, regles: [] }, ENFANT, { ...ADULTE_B, regles: [{ ...SANS_VIANDE[0], actif: false }] }]) {
    assert.equal(etatDemande(GRATIN, profil), null, profil.id);
    assert.deepEqual(preparerDemande({ plat: GRATIN, profil }, { auteur: AUTEUR }), { erreur: 'inutile' }, profil.id);
  }
});

test('identifiant impossible : profil « recette », plat ou profil sans slug → invalide', () => {
  const recette = { id: 'recette', nom: 'Recette', ordre: 4, coefPortion: 1, regles: SANS_VIANDE };
  assert.equal(etatDemande(GRATIN, recette), null);
  assert.deepEqual(preparerDemande({ plat: GRATIN, profil: recette }, { auteur: AUTEUR }), { erreur: 'invalide' });
  assert.deepEqual(preparerDemande({ plat: { ...GRATIN, id: 'Gratin Test' }, profil: ADULTE_B }, { auteur: AUTEUR }), { erreur: 'invalide' });
  assert.deepEqual(preparerDemande({ plat: { ...ATTENTE, id: 'a__b' } }, { auteur: AUTEUR }), { erreur: 'invalide' });
  // Un profil sans identifiant ne devient jamais une demande de recette.
  assert.deepEqual(preparerDemande({ plat: ATTENTE, profil: { nom: 'Sans identifiant', regles: SANS_VIANDE } }, { auteur: AUTEUR }),
    { erreur: 'invalide' });
  assert.deepEqual(preparerDemande({ plat: GRATIN, profil: 'profil-b' }, { auteur: AUTEUR }), { erreur: 'invalide' });
  assert.equal(etatDemande(GRATIN, { nom: 'Sans identifiant', regles: SANS_VIANDE }), null);
  assert.equal(etatDemande(ATTENTE, { nom: 'Sans identifiant', regles: SANS_VIANDE }), null);
});

test('auteur vide → invalide, rien n’est préparé', () => {
  for (const auteur of ['', '   ', undefined, null, 42]) {
    assert.deepEqual(preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { auteur }), { erreur: 'invalide' }, String(auteur));
    assert.deepEqual(preparerDemande({ plat: ATTENTE }, { auteur }), { erreur: 'invalide' }, String(auteur));
  }
  assert.deepEqual(preparerDemande({ plat: GRATIN, profil: ADULTE_B }), { erreur: 'invalide' });
});

test('demande déjà ouverte : montrée, jamais réécrite', () => {
  const version = ouverteVersion('gratin-test');
  const recette = ouverteRecette('lasagnes');
  const demandes = [version, recette];
  assert.deepEqual(etatDemande(GRATIN, ADULTE_B, { demandes }), { ouverte: version });
  assert.deepEqual(preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { demandes, auteur: AUTEUR }), { erreur: 'deja' });
  assert.deepEqual(etatDemande(ATTENTE, null, { demandes }), { ouverte: recette });
  assert.deepEqual(preparerDemande({ plat: ATTENTE }, { demandes, auteur: AUTEUR }), { erreur: 'deja' });
  // La demande ouverte d'un autre profil ne compte pas.
  assert.deepEqual(etatDemande(GRATIN, ADULTE_B, { demandes: [ouverteVersion('gratin-test', 'profil-a')] }),
    { possible: true, id: 'gratin-test__profil-b' });
});

test('demande traitée ou retirée du même identifiant : se rouvre, document entier', () => {
  const traitee = ouverteVersion('gratin-test', 'profil-b', { statut: 'traitee', traiteeLe: horodatage('2026-10-09T09:00:00.000Z') });
  const demandes = [traitee];
  assert.deepEqual(etatDemande(GRATIN, ADULTE_B, { demandes }), { possible: true, id: 'gratin-test__profil-b' });
  const preparation = preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { demandes, auteur: 'a@example.com' });
  assert.deepEqual(preparation, {
    id: 'gratin-test__profil-b',
    donnees: { type: 'variante', platId: 'gratin-test', profilId: 'profil-b', besoin: 'sans_viande', creePar: 'a@example.com', statut: 'ouverte' },
  });
  assert.equal('traiteeLe' in preparation.donnees, false);
  assert.equal('creeLe' in preparation.donnees, false, 'creeLe est posé par donnees.js');
  const recette = preparerDemande({ plat: ATTENTE }, { demandes: [ouverteRecette('lasagnes', { statut: 'traitee' })], auteur: AUTEUR });
  assert.equal(recette.id, 'lasagnes__recette');
});

test('documents préparés : aucun undefined ni null, aucun champ hors de la liste', () => {
  const cas = [
    preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { auteur: AUTEUR }),
    preparerDemande({ plat: avecVersions(GRATIN, MAUVAISE_GRATIN), profil: ADULTE_B }, { auteur: AUTEUR }),
    preparerDemande({ plat: APERO, profil: ADULTE_B }, { auteur: AUTEUR }),
    preparerDemande({ plat: ATTENTE }, { auteur: AUTEUR }),
    preparerDemande({ plat: ATTENTE, profil: null }, { auteur: AUTEUR }),
  ];
  for (const preparation of cas) {
    assert.equal(contientVide(preparation), false, JSON.stringify(preparation));
    const champs = preparation.donnees.type === 'recette'
      ? ['type', 'platId', 'creePar', 'statut']
      : ['type', 'platId', 'profilId', 'besoin', 'creePar', 'statut'];
    for (const cle of Object.keys(preparation.donnees)) assert.ok(champs.includes(cle), cle);
  }
});

test('evaluer fourni : appelé une fois, jamais recalculé ; besoin absent s’il n’en donne pas', () => {
  const appels = [];
  const espion = (reponse) => (plat, profil) => {
    appels.push([plat.id, profil.id]);
    return reponse;
  };
  // Lentilles : conviennent d'après le vrai evaluer ; l'evaluer fourni dit « à créer », sans besoin.
  const sansBesoin = preparerDemande({ plat: LENTILLES, profil: ADULTE_B }, { auteur: AUTEUR, evaluer: espion({ aCreer: true, besoin: null }) });
  assert.deepEqual(sansBesoin, {
    id: 'lentilles-test__profil-b',
    donnees: { type: 'variante', platId: 'lentilles-test', profilId: 'profil-b', creePar: AUTEUR, statut: 'ouverte' },
  });
  assert.deepEqual(appels, [['lentilles-test', 'profil-b']]);
  const besoinNonTexte = preparerDemande({ plat: LENTILLES, profil: ADULTE_B },
    { auteur: AUTEUR, evaluer: espion({ aRevoir: true, besoin: 3 }) });
  assert.equal('besoin' in besoinNonTexte.donnees, false);
  assert.deepEqual(etatDemande(LENTILLES, ADULTE_B, { evaluer: espion({ aCreer: true }) }), { possible: true, id: 'lentilles-test__profil-b' });
  // L'inverse : le vrai evaluer dirait « à créer », l'evaluer fourni dit « convient ».
  assert.equal(etatDemande(GRATIN, ADULTE_B, { evaluer: espion({ niveau: 'ok' }) }), null);
  // Une demande de recette n'évalue rien.
  appels.length = 0;
  preparerDemande({ plat: ATTENTE }, { auteur: AUTEUR, evaluer: espion({ aCreer: true }) });
  assert.deepEqual(appels, []);
});

test('demande ouverte devenue inutile : plus montrée (ni bouton, ni phrase)', () => {
  const demandes = [ouverteVersion('gratin-test'), ouverteRecette('gratin-test')];
  // Version arrivée, recette arrivée.
  assert.equal(etatDemande(avecVersions(GRATIN, VEG_GRATIN), ADULTE_B, { demandes }), null);
  assert.equal(etatDemande(GRATIN, null, { demandes }), null);
  // Plat noté « Jamais », plat de la corbeille.
  assert.equal(etatDemande(note(GRATIN, { 'profil-b': 0 }), ADULTE_B, { demandes }), null);
  assert.equal(etatDemande(jete(GRATIN), ADULTE_B, { demandes }), null);
});

// ——— Aller-retour avec la clôture (invariants 4 et 5) ———

test('ce qui peut être demandé est exactement ce que le gestionnaire voit ensuite', () => {
  const plats = [GRATIN, avecVersions(GRATIN, MAUVAISE_GRATIN), APERO, PREPARATION, ACCOMPAGNEMENT, DESSERT, ATTENTE];
  let vus = 0;
  for (const plat of plats) {
    for (const profil of [null, ...PROFILS]) {
      const etat = etatDemande(plat, profil);
      const preparation = preparerDemande({ plat, profil }, { auteur: AUTEUR });
      assert.equal(Boolean(etat?.possible), 'id' in preparation, `${plat.id} ${profil?.id}`);
      if (!etat?.possible) continue;
      assert.equal(preparation.id, etat.id);
      const demande = lue(preparation);
      assert.equal(demandeUtile(demande, { plats: [plat], profils: PROFILS }), true, `${plat.id} ${profil?.id}`);
      const [element] = demandesATraiter([demande], { plats: [plat], profils: PROFILS });
      assert.equal(element.plat, plat);
      assert.equal(element.profil, profil ? PROFILS.find((p) => p.id === profil.id) : null);
      assert.deepEqual(etatDemande(plat, profil, { demandes: [demande] }), { ouverte: demande });
      vus += 1;
    }
  }
  assert.equal(vus, 7, 'six versions pour Adulte B et une recette');
});

test('versions reçues : une demande montrée se clôt ⇔ elle n’est plus utile, quel que soit le type', () => {
  // Pour chaque plat demandé et chaque réponse possible de Claude (versions qui conviennent ou non, pour ce profil ou
  // un autre), la fiche fusionnée et la clôture de l'ajout de recettes disent la même chose.
  const reponses = (plat) => {
    const retirer = evaluer(plat, ADULTE_B).fautifs.map((i) => i.produit);
    return {
      merBonne: [version('profil-b', retirer, [SAUMON], { style: 'mer', frigoJours: 2 })],
      vegBonne: [version('profil-b', retirer, [TOFU], { style: 'vegetal' })],
      vegMauvaise: [version('profil-b', retirer, [TOFU, BOUILLON], { style: 'vegetal' })],
      incomplete: [version('profil-b', [], [TOFU], { style: 'vegetal' })],
      autreProfil: [version('profil-a', retirer, [TOFU])],
      lesDeux: [version('profil-b', retirer, [TOFU, BOUILLON], { style: 'vegetal' }),
        version('profil-b', retirer, [SAUMON], { style: 'mer', frigoJours: 2 })],
    };
  };
  const attendus = {
    merBonne: true, vegBonne: true, vegMauvaise: false, incomplete: false, autreProfil: false, lesDeux: true,
  };
  for (const plat of [GRATIN, avecVersions(GRATIN, MAUVAISE_GRATIN), APERO, PREPARATION, ACCOMPAGNEMENT, DESSERT]) {
    const demande = lue(preparerDemande({ plat, profil: ADULTE_B }, { auteur: AUTEUR }));
    for (const [nom, recues] of Object.entries(reponses(plat))) {
      const apres = fusionnee(plat, recues);
      const satisfaites = demandesSatisfaites(plat.id, { id: plat.id, nom: plat.nom, variantes: recues }, [demande.id],
        { plat: apres, profils: PROFILS });
      const close = satisfaites.includes(demande.id);
      assert.equal(close, attendus[nom], `${plat.id} ${nom}`);
      assert.equal(demandeUtile(demande, { plats: [apres], profils: PROFILS }), !close, `${plat.id} ${nom}`);
      assert.equal(demandesATraiter([demande], { plats: [apres], profils: PROFILS }).length, close ? 0 : 1, `${plat.id} ${nom}`);
    }
  }
});

test('ajout de recettes « versions seules » : une version qui convient clôt la demande, une autre la laisse ouverte et utile', () => {
  const demande = lue(preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { auteur: AUTEUR }));
  const autre = ouverteVersion('gratin-test', 'profil-a');
  const demandes = [demande, autre];
  const bonne = preparerImport(valides({ id: 'gratin-test', nom: 'Gratin test', variantes: [MER_GRATIN] }),
    { plats: [GRATIN], demandes, profils: PROFILS });
  assert.deepEqual(bonne.ecritures.map((e) => e.mode), ['versions']);
  assert.deepEqual(bonne.demandesAClore, ['gratin-test__profil-b']);
  assert.equal(demandeUtile(demande, { plats: [fusionnee(GRATIN, [MER_GRATIN])], profils: PROFILS }), false);
  const mauvaise = preparerImport(valides({ id: 'gratin-test', nom: 'Gratin test', variantes: [MAUVAISE_GRATIN] }),
    { plats: [GRATIN], demandes, profils: PROFILS });
  assert.deepEqual(mauvaise.demandesAClore, []);
  const apres = fusionnee(GRATIN, [MAUVAISE_GRATIN]);
  assert.equal(demandeUtile(demande, { plats: [apres], profils: PROFILS }), true);
  assert.deepEqual(etatDemande(apres, ADULTE_B, { demandes }), { ouverte: demande });
  // La demande d'un profil sans règle n'est jamais montrée.
  assert.equal(demandeUtile(autre, { plats: [GRATIN], profils: PROFILS }), false);
});

test('ajout de recettes « versions seules » : un apéro demandé se clôt comme un plat', () => {
  const demande = lue(preparerDemande({ plat: APERO, profil: ADULTE_B }, { auteur: AUTEUR }));
  assert.equal(demande.id, 'planche-apero__profil-b');
  const r = preparerImport(valides({ id: 'planche-apero', nom: 'Planche apéro', variantes: [VEG_APERO] }),
    { plats: [APERO], demandes: [demande], profils: PROFILS });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.demandesAClore, ['planche-apero__profil-b']);
  assert.equal(demandeUtile(demande, { plats: [fusionnee(APERO, [VEG_APERO])], profils: PROFILS }), false);
  // Une version qui ne convient pas : ouverte et utile.
  const mauvaise = version('profil-b', ['saucisson sec'], [TOFU, BOUILLON], { style: 'vegetal' });
  const r2 = preparerImport(valides({ id: 'planche-apero', nom: 'Planche apéro', variantes: [mauvaise] }),
    { plats: [APERO], demandes: [demande], profils: PROFILS });
  assert.deepEqual(r2.demandesAClore, []);
  assert.equal(demandeUtile(demande, { plats: [fusionnee(APERO, [mauvaise])], profils: PROFILS }), true);
});

test('recette reçue avec ses ingrédients : clôt la demande de recette ; sans ingrédients, non', () => {
  const demande = lue(preparerDemande({ plat: ATTENTE }, { auteur: AUTEUR }));
  const recette = {
    id: 'lasagnes', nom: 'Lasagnes', type: 'plat', portionsBase: 4, statutRecette: 'brouillon',
    ingredients: [ing('feuille de lasagne', 250, 'g', ['feculent'])], etapes: ['Monter.'],
  };
  assert.deepEqual(demandesSatisfaites('lasagnes', recette, [demande.id], { profils: PROFILS }), ['lasagnes__recette']);
  assert.deepEqual(demandesSatisfaites('lasagnes', { id: 'lasagnes', nom: 'Lasagnes' }, [demande.id], { profils: PROFILS }), []);
  const r = preparerImport(valides(recette), { plats: [ATTENTE], demandes: [demande], profils: PROFILS });
  assert.deepEqual(r.demandesAClore, ['lasagnes__recette']);
  // La fiche remplie : la demande n'est plus utile.
  assert.equal(demandeUtile(demande, { plats: [{ ...ATTENTE, ...recette }], profils: PROFILS }), false);
  assert.equal(demandeUtile(demande, { plats: [ATTENTE], profils: PROFILS }), true);
});

// ——— demandeUtile, demandesATraiter, grouperDemandes ———

test('demandeUtile : seulement les demandes ouvertes', () => {
  const options = { plats: [GRATIN, ATTENTE], profils: PROFILS };
  assert.equal(demandeUtile(ouverteVersion('gratin-test'), options), true);
  assert.equal(demandeUtile(ouverteRecette('lasagnes'), options), true);
  for (const statut of ['traitee', 'retiree', undefined, 'OUVERTE']) {
    assert.equal(demandeUtile(ouverteVersion('gratin-test', 'profil-b', { statut }), options), false, String(statut));
  }
  assert.equal(demandeUtile(null, options), false);
  assert.equal(demandeUtile(ouverteVersion('gratin-test')), false, 'sans plats ni profils');
});

test('demandeUtile : plat absent, de la corbeille, déjà rempli ou désormais adapté → caché', () => {
  const version = ouverteVersion('gratin-test');
  const recette = ouverteRecette('lasagnes');
  assert.equal(demandeUtile(version, { plats: [], profils: PROFILS }), false);
  assert.equal(demandeUtile(version, { plats: [jete(GRATIN)], profils: PROFILS }), false);
  assert.equal(demandeUtile(recette, { plats: [jete(ATTENTE)], profils: PROFILS }), false);
  assert.equal(demandeUtile(recette, { plats: [{ ...ATTENTE, ingredients: [PATES] }], profils: PROFILS }), false);
  assert.equal(demandeUtile(version, { plats: [avecVersions(GRATIN, VEG_GRATIN)], profils: PROFILS }), false);
  assert.equal(demandeUtile(version, { plats: [avecVersions(GRATIN, MER_GRATIN)], profils: PROFILS }), false, 'à compléter');
});

test('demandeUtile : profil retiré, passé à « Mange de tout », ou plat noté « Jamais » → caché', () => {
  const version = ouverteVersion('gratin-test');
  assert.equal(demandeUtile(version, { plats: [GRATIN], profils: [ADULTE_A, ENFANT] }), false);
  assert.equal(demandeUtile(version, { plats: [GRATIN], profils: [{ ...ADULTE_B, regles: [] }] }), false);
  assert.equal(demandeUtile(version, { plats: [note(GRATIN, { 'profil-b': 0 })], profils: PROFILS }), false);
  // Enfant qui n'a que des précautions d'âge : jamais montrée.
  assert.equal(demandeUtile(ouverteVersion('gratin-test', 'enfant'), { plats: [GRATIN], profils: PROFILS }), false);
});

test('demandeUtile : apéro à créer gardé, apéro dont une version convient caché', () => {
  const demande = ouverteVersion('planche-apero');
  assert.equal(demandeUtile(demande, { plats: [APERO], profils: PROFILS }), true);
  assert.equal(demandeUtile(demande, { plats: [avecVersions(APERO, VEG_APERO)], profils: PROFILS }), false);
});

test('demandeUtile : plat et profil lus dans l’identifiant ; identifiant illisible ignoré', () => {
  const sansPlatId = { id: 'gratin-test__profil-b', statut: 'ouverte', creePar: AUTEUR };
  assert.equal(demandeUtile(sansPlatId, { plats: [GRATIN], profils: PROFILS }), true);
  // Seul l'identifiant compte (c'est lui que la clôture reconstruit).
  assert.equal(demandeUtile({ ...sansPlatId, platId: 'autre', profilId: 'profil-a' }, { plats: [GRATIN], profils: PROFILS }), true);
  for (const id of ['gratin-test', 'gratin-test__profil-b__x', '__profil-b', undefined]) {
    assert.equal(demandeUtile({ ...sansPlatId, id, platId: 'gratin-test' }, { plats: [GRATIN], profils: PROFILS }), false, String(id));
  }
  assert.deepEqual(demandesATraiter([{ ...sansPlatId, id: 'illisible' }], { plats: [GRATIN], profils: PROFILS }), []);
});

test('demandesATraiter : éléments, la plus ancienne d’abord, date en attente ou inconnue en dernier, puis nom, puis identifiant', () => {
  const plats = [GRATIN, APERO, PREPARATION, ACCOMPAGNEMENT, DESSERT, ATTENTE, LENTILLES];
  const demandes = [
    ouverteVersion('yaourt-test', 'profil-b', { creeLe: null }), // en attente du serveur
    ouverteVersion('panna-test', 'profil-b', { creeLe: undefined }), // date inconnue
    ouverteRecette('lasagnes', { creeLe: horodatage('2026-10-09T08:00:00.000Z') }),
    ouverteVersion('planche-apero', 'profil-b', { creeLe: '2026-10-07T08:00:00.000Z' }),
    ouverteVersion('gratin-test', 'profil-b', { creeLe: new Date('2026-10-09T08:00:00.000Z') }),
    ouverteVersion('haricots-test', 'profil-b', { creeLe: null }),
    ouverteVersion('lentilles-test', 'profil-b'), // plat qui convient : caché
    ouverteVersion('gratin-test', 'profil-b', { statut: 'traitee' }),
  ];
  const aTraiter = demandesATraiter(demandes, { plats, profils: PROFILS });
  assert.deepEqual(aTraiter.map((e) => e.demande.id), [
    'planche-apero__profil-b', // 7 octobre
    'gratin-test__profil-b', // 9 octobre, « Gratin test »
    'lasagnes__recette', // 9 octobre, « Lasagnes »
    'haricots-test__profil-b', // sans date : par nom
    'panna-test__profil-b',
    'yaourt-test__profil-b',
  ]);
  const [apero, gratin, lasagnes, haricots] = aTraiter;
  assert.deepEqual(Object.keys(apero).sort(), ['date', 'demande', 'plat', 'profil', 'type']);
  assert.equal(apero.type, 'variante');
  assert.equal(apero.plat, APERO);
  assert.equal(apero.profil, ADULTE_B);
  assert.equal(apero.date.toISOString(), '2026-10-07T08:00:00.000Z');
  assert.equal(gratin.date.toISOString(), '2026-10-09T08:00:00.000Z');
  assert.deepEqual([lasagnes.type, lasagnes.profil], ['recette', null]);
  assert.equal(haricots.date, null);
  // Même date, même nom : par identifiant.
  const memeNom = demandesATraiter([ouverteVersion('b-plat'), ouverteVersion('a-plat')], {
    plats: [{ ...GRATIN, id: 'b-plat' }, { ...GRATIN, id: 'a-plat' }], profils: PROFILS,
  });
  assert.deepEqual(memeNom.map((e) => e.demande.id), ['a-plat__profil-b', 'b-plat__profil-b']);
  assert.deepEqual(demandesATraiter(undefined, { plats, profils: PROFILS }), []);
});

test('demandesATraiter : un identifiant une seule fois ; evaluer fourni utilisé', () => {
  const a = ouverteVersion('gratin-test');
  const b = ouverteVersion('gratin-test', 'profil-b', { creePar: 'a@example.com' });
  assert.deepEqual(demandesATraiter([a, b], { plats: [GRATIN], profils: PROFILS }).map((e) => e.demande), [a]);
  const toutConvient = () => ({ niveau: 'ok', aCreer: false, aRevoir: false });
  assert.deepEqual(demandesATraiter([a], { plats: [GRATIN], profils: PROFILS, evaluer: toutConvient }), []);
});

test('grouperDemandes : recettes à part, versions par profil dans l’ordre des profils', () => {
  const ADULTE_C = { id: 'profil-c', nom: 'Adulte C', email: 'c@example.com', ordre: 0, coefPortion: 1, regles: SANS_VIANDE };
  const profils = [...PROFILS, ADULTE_C];
  const aTraiter = demandesATraiter([
    ouverteVersion('gratin-test', 'profil-b', { creeLe: '2026-10-05T08:00:00.000Z' }),
    ouverteRecette('lasagnes', { creeLe: '2026-10-06T08:00:00.000Z' }),
    ouverteVersion('planche-apero', 'profil-c', { creeLe: '2026-10-07T08:00:00.000Z' }),
    ouverteVersion('planche-apero', 'profil-b', { creeLe: '2026-10-08T08:00:00.000Z' }),
  ], { plats: [GRATIN, APERO, ATTENTE], profils });
  const groupes = grouperDemandes(aTraiter);
  assert.deepEqual(groupes.recettes.map((e) => e.demande.id), ['lasagnes__recette']);
  assert.deepEqual(groupes.versions.map((g) => g.profil.id), ['profil-c', 'profil-b']);
  assert.deepEqual(groupes.versions[1].elements.map((e) => e.demande.id), ['gratin-test__profil-b', 'planche-apero__profil-b']);
  assert.equal(groupes.versions[1].profil, ADULTE_B);
  assert.deepEqual(grouperDemandes([]), { recettes: [], versions: [] });
  assert.deepEqual(grouperDemandes(undefined), { recettes: [], versions: [] });
  assert.deepEqual(grouperDemandes([null, { type: 'variante' }]), { recettes: [], versions: [] });
});

// ——— texteDemandee ———

const options = { maintenant: MAINTENANT, profils: PROFILS };

test('texteDemandee : aujourd’hui, autre jour, « 1er », autre année (dates locales)', () => {
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: horodatage('2026-10-10T06:00:00.000Z') }), options), 'Demandée aujourd’hui.');
  // 1 h 30 à Paris le 10 octobre : aujourd'hui (date locale, pas UTC).
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: '2026-10-09T23:30:00.000Z' }), options), 'Demandée aujourd’hui.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: '2026-10-09T21:30:00.000Z' }), options), 'Demandée le 9 octobre.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: { seconds: Date.parse('2026-10-01T10:00:00.000Z') / 1000 } }), options),
    'Demandée le 1er octobre.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: new Date('2025-12-28T10:00:00.000Z') }), options),
    'Demandée le 28 décembre 2025.');
});

test('texteDemandee : en attente du serveur, en ligne ou hors ligne ; date inconnue', () => {
  const enAttente = ouverteVersion('a', 'b', { creeLe: null });
  assert.equal(texteDemandee(enAttente, options), 'Demandée aujourd’hui.');
  assert.equal(texteDemandee(enAttente, { ...options, horsLigne: false }), 'Demandée aujourd’hui.');
  assert.equal(texteDemandee(enAttente, { ...options, horsLigne: true }), 'Demandée. La demande partira au retour du réseau.');
  // Déjà sur le serveur, date inconnue : jamais « partira ».
  const inconnue = ouverteVersion('a', 'b', { creeLe: undefined });
  delete inconnue.creeLe;
  assert.equal(texteDemandee(inconnue, options), 'Demandée.');
  assert.equal(texteDemandee(inconnue, { ...options, horsLigne: true }), 'Demandée.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: 'abîmée' }), { ...options, horsLigne: true }), 'Demandée.');
  // Date connue hors ligne : rien de plus.
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: '2026-10-09T08:00:00.000Z' }), { ...options, horsLigne: true }),
    'Demandée le 9 octobre.');
  assert.equal(texteDemandee(null, options), 'Demandée.');
});

test('texteDemandee : avec l’auteur, son prénom ou « vous », jamais une adresse', () => {
  const avec = { ...options, avecAuteur: true };
  const le9 = '2026-10-09T08:00:00.000Z';
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9 }), avec), 'Demandée par Adulte B le 9 octobre.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9, creePar: ' B@Example.COM ' }), avec), 'Demandée par Adulte B le 9 octobre.');
  // La personne connectée : par son adresse (casse comprise) ou par son profil.
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: null, creePar: 'a@example.com' }), { ...avec, moi: 'A@EXAMPLE.com' }),
    'Demandée par vous aujourd’hui.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9, creePar: 'a@example.com' }), { ...avec, moi: ADULTE_A }),
    'Demandée par vous le 9 octobre.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: null }), { ...avec, moi: ADULTE_B, horsLigne: true }),
    'Demandée par vous. La demande partira au retour du réseau.');
  // Adresse inconnue, profil sans prénom, auteur absent : sans « par ».
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9, creePar: 'inconnu@example.com' }), avec), 'Demandée le 9 octobre.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9 }), { ...avec, profils: [{ ...ADULTE_B, nom: '  ' }] }),
    'Demandée le 9 octobre.');
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9, creePar: undefined }), avec), 'Demandée le 9 octobre.');
  const inconnue = ouverteVersion('a', 'b');
  delete inconnue.creeLe;
  assert.equal(texteDemandee(inconnue, avec), 'Demandée par Adulte B.');
  // Sans l'auteur par défaut.
  assert.equal(texteDemandee(ouverteVersion('a', 'b', { creeLe: le9 }), { ...options, moi: ADULTE_B }), 'Demandée le 9 octobre.');
});

test('texteDemandee : textes propres, sans « @ » ni mot technique', () => {
  const textes = [];
  for (const creeLe of [null, undefined, '2026-10-09T08:00:00.000Z', horodatage('2026-10-10T08:00:00.000Z'), 'x']) {
    for (const creePar of [AUTEUR, 'a@example.com', 'inconnu@example.com', '']) {
      for (const horsLigne of [false, true]) {
        for (const avecAuteur of [false, true]) {
          textes.push(texteDemandee(ouverteVersion('a', 'b', { creeLe, creePar }), { ...options, horsLigne, avecAuteur, moi: ADULTE_A }));
        }
      }
    }
  }
  textesPropres(textes);
  for (const texte of textes) assert.match(texte, /^Demandée( par (vous|Adulte [AB]))?( aujourd’hui| le \d+ octobre)?\.( La demande partira au retour du réseau\.)?$/, texte);
});

// ——— coeur/ntfy.js ———

test('ntfy : constantes', () => {
  assert.equal(SERVEUR_NTFY, 'https://ntfy.sh/');
  assert.equal(TITRE_NOTIFICATION, 'Repas & Courses');
  assert.equal(ETIQUETTE_NOTIFICATION, 'mailbox_with_mail');
  assert.equal(PRIORITE_NOTIFICATION, 4);
  assert.equal(PREFIXE_SUJET, 'repas-');
  assert.equal(SIGNES_SUJET, 24);
  assert.equal(NOM_PLAT_MAX, 80);
  assert.equal(LIEN_INSTALLER_NTFY, 'https://play.google.com/store/apps/details?id=io.heckel.ntfy');
  assert.equal(ALPHABET_SUJET.length, 32);
  assert.equal(new Set(ALPHABET_SUJET).size, 32);
  assert.match(ALPHABET_SUJET, /^[a-z2-9]+$/);
  for (const signe of ['l', 'o', '0', '1']) assert.equal(ALPHABET_SUJET.includes(signe), false, signe);
});

test('sujetValide : ce que ntfy accepte', () => {
  for (const sujet of ['a', 'repas-abc', 'Repas_ABC-123', 'x'.repeat(64), '-', '_']) assert.equal(sujetValide(sujet), true, sujet);
  for (const sujet of ['', 'x'.repeat(65), 'repas-é', 'repas abc', 'repas/abc', 'repas.abc', 'repas?x', 'repas#x', undefined, null, 42, ['a']]) {
    assert.equal(sujetValide(sujet), false, String(sujet));
  }
});

test('nouveauSujet : octets fixés → sujet attendu, 30 caractères, valide pour ntfy', () => {
  const octets = Uint8Array.from({ length: 24 }, (_, i) => i);
  assert.equal(nouveauSujet(octets), `repas-${ALPHABET_SUJET.slice(0, 24)}`);
  // octet & 31 : 32 donne le même signe que 0, 255 le même que 31.
  const bords = new Uint8Array(24);
  bords.set([0, 31, 32, 63, 255, 224]);
  assert.equal(nouveauSujet(bords), `repas-a9a99a${'a'.repeat(18)}`);
  // Plus de 24 octets : seuls les 24 premiers servent ; un tableau ordinaire convient aussi.
  assert.equal(nouveauSujet(Uint8Array.from({ length: 40 }, (_, i) => i)), nouveauSujet(octets));
  assert.equal(nouveauSujet(Array.from({ length: 24 }, (_, i) => i)), nouveauSujet(octets));
  for (let essai = 0; essai < 50; essai += 1) {
    const sujet = nouveauSujet(webcrypto.getRandomValues(new Uint8Array(24)));
    assert.equal(sujet.length, 30);
    assert.ok(sujet.startsWith(PREFIXE_SUJET));
    assert.ok(sujetValide(sujet), sujet);
    assert.ok([...sujet.slice(6)].every((signe) => ALPHABET_SUJET.includes(signe)), sujet);
    assert.equal(sujet, sujet.toLowerCase());
  }
});

test('nouveauSujet : moins de 24 octets, ou octets abîmés → null', () => {
  for (const octets of [new Uint8Array(23), new Uint8Array(0), [], undefined, null, 'abcdefghijklmnopqrstuvwxyz', 42,
    [...new Array(23).fill(1), 256], [...new Array(23).fill(1), -1], [...new Array(23).fill(1), 1.5], new Array(24)]) {
    assert.equal(nouveauSujet(octets), null, String(octets));
  }
});

test('texteNotification : trois textes exacts, sans prénom', () => {
  assert.equal(texteNotification({ type: 'recette', nomPlat: 'Gratin du dimanche' }), 'Recette à ajouter\u00A0: Gratin du dimanche');
  assert.equal(texteNotification({ type: 'variante', nomPlat: 'Carbonade flamande' }), 'Version à ajouter\u00A0: Carbonade flamande');
  assert.equal(texteNotification({ type: 'essai' }), 'Essai\u00A0: les demandes arriveront ici.');
  assert.equal(texteNotification({ type: 'essai', nomPlat: 'Gratin' }), 'Essai\u00A0: les demandes arriveront ici.');
  // Tout autre champ est ignoré : jamais de prénom (décision 1).
  assert.equal(texteNotification({ type: 'variante', nomPlat: 'Carbonade flamande', prenom: 'Adulte B', profilId: 'profil-b' }),
    'Version à ajouter\u00A0: Carbonade flamande');
});

test('texteNotification : espaces resserrés, coupe à 80 caractères, nom vide, type inconnu', () => {
  assert.equal(texteNotification({ type: 'recette', nomPlat: '  Gratin \n du\tdimanche  ' }), 'Recette à ajouter\u00A0: Gratin du dimanche');
  const long = `${'Très long nom '.repeat(10)}fin`;
  const texte = texteNotification({ type: 'variante', nomPlat: long });
  const nom = texte.slice('Version à ajouter\u00A0: '.length);
  assert.ok(nom.endsWith('…'), nom);
  assert.ok([...nom].length <= NOM_PLAT_MAX, String([...nom].length));
  assert.ok(long.startsWith(nom.slice(0, -1)));
  assert.equal(texteNotification({ type: 'recette', nomPlat: 'x'.repeat(80) }), `Recette à ajouter\u00A0: ${'x'.repeat(80)}`);
  assert.equal([...texteNotification({ type: 'recette', nomPlat: 'x'.repeat(81) }).slice(20)].length, NOM_PLAT_MAX);
  // Un emoji n'est jamais coupé en deux.
  const emojis = texteNotification({ type: 'recette', nomPlat: '🍲'.repeat(100) });
  assert.equal(emojis.isWellFormed(), true);
  for (const vide of ['', '   ', undefined, null, 42]) {
    assert.equal(texteNotification({ type: 'recette', nomPlat: vide }), 'Recette à ajouter');
    assert.equal(texteNotification({ type: 'variante', nomPlat: vide }), 'Version à ajouter');
  }
  for (const type of ['autre', '', undefined, 'RECETTE', 'toString']) assert.equal(texteNotification({ type, nomPlat: 'Gratin' }), '', String(type));
  assert.equal(texteNotification(), '');
});

test('adresseNotification : adresse exacte, lien encodé avec son « # », aucun autre paramètre', () => {
  const lien = 'https://pseudo.github.io/depot/#/plat/carbonade-flamande';
  const adresse = adresseNotification('repas-abc', { lien });
  assert.equal(adresse, 'https://ntfy.sh/repas-abc?title=Repas%20%26%20Courses&tags=mailbox_with_mail&priority=4'
    + '&click=https%3A%2F%2Fpseudo.github.io%2Fdepot%2F%23%2Fplat%2Fcarbonade-flamande');
  const url = new URL(adresse);
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams.keys()], ['title', 'tags', 'priority', 'click']);
  assert.equal(url.searchParams.get('title'), 'Repas & Courses');
  assert.equal(url.searchParams.get('click'), lien);
  assert.equal(url.origin + url.pathname, 'https://ntfy.sh/repas-abc');
  // Sans lien : pas de `click`.
  for (const sans of [{}, { lien: '' }, { lien: '   ' }, { lien: undefined }, { lien: 42 }, undefined]) {
    assert.equal(adresseNotification('repas-abc', sans), 'https://ntfy.sh/repas-abc?title=Repas%20%26%20Courses&tags=mailbox_with_mail&priority=4');
  }
  for (const sujet of ['', 'repas abc', 'repas/abc', '../x', undefined, 'x'.repeat(65)]) {
    assert.equal(adresseNotification(sujet, { lien }), null, String(sujet));
  }
});

test('lienAbonnement : lien ntfy exact ; sujet invalide → null', () => {
  assert.equal(lienAbonnement('repas-abc'), 'ntfy://ntfy.sh/repas-abc?display=Repas%20%26%20Courses');
  for (const sujet of ['', 'repas abc', 'repas/abc', null]) assert.equal(lienAbonnement(sujet), null, String(sujet));
});

test('issueEnvoi : ok, quota, panne, refus, réseau', () => {
  for (const statut of [200, 201, 204]) assert.deepEqual(issueEnvoi({ ok: true, statut }), { code: 'ok' }, String(statut));
  assert.deepEqual(issueEnvoi({ ok: false, statut: 429 }), { code: 'quota' });
  for (const statut of [500, 502, 503]) assert.deepEqual(issueEnvoi({ ok: false, statut }), { code: 'panne', statut });
  for (const statut of [400, 403, 404, 413, 301]) assert.deepEqual(issueEnvoi({ ok: false, statut }), { code: 'refus', statut });
  assert.deepEqual(issueEnvoi({ erreur: 'reseau' }), { code: 'reseau' });
  for (const reponse of [undefined, null, {}, { ok: false }, { statut: 0 }, 'ok', { ok: false, statut: 'x' }]) {
    assert.deepEqual(issueEnvoi(reponse), { code: 'reseau' }, JSON.stringify(reponse));
  }
  assert.deepEqual(issueEnvoi({ ok: true }), { code: 'ok' });
});

test('texteEssai : une phrase exacte par issue ; le sujet n’est jamais mis en cause', () => {
  const attendus = {
    ok: 'Message envoyé. Il arrive dans ntfy d’ici quelques secondes. Sinon, vérifiez l’abonnement dans ntfy, et dans les réglages d’Android que ntfy a le droit d’envoyer des notifications.',
    quota: 'ntfy.sh refuse d’autres messages aujourd’hui depuis ce réseau. Réessayez plus tard, ou en 4G.',
    panne: 'ntfy.sh ne répond pas pour le moment. Réessayez dans quelques minutes.',
    reseau: 'Le message n’est pas parti. Vérifiez le réseau et réessayez.',
    attente: 'Pas encore de réponse de ntfy.sh. Vérifiez le réseau\u00A0; si le message arrive quand même, tout va bien.',
  };
  for (const [code, texte] of Object.entries(attendus)) assert.equal(texteEssai({ code, statut: 503 }), texte, code);
  assert.equal(texteEssai(issueEnvoi({ ok: false, statut: 400 })),
    'ntfy.sh a refusé le message (code 400). Votre sujet n’est pas en cause\u00A0: notez ce code pour Claude Code.');
  assert.match(texteEssai({ code: 'refus', statut: 403 }), /code 403/);
  assert.equal(texteEssai({ code: 'refus' }), 'ntfy.sh a refusé le message. Votre sujet n’est pas en cause.');
  for (const inconnue of [undefined, null, {}, { code: 'autre' }]) assert.equal(texteEssai(inconnue), '');
  const textes = [...Object.keys(attendus), 'refus'].map((code) => texteEssai({ code, statut: 400 }));
  for (const texte of textes) {
    assert.doesNotMatch(texte, /arrêtez|réactivez|changez de sujet/i, texte);
    assert.doesNotMatch(texte, / [:;!?]|'/, texte);
  }
});

test('confidentialité : ni adresse, ni prénom, ni identifiant de profil, ni âge, ni date chez ntfy.sh', () => {
  const sujet = nouveauSujet(Uint8Array.from({ length: 24 }, (_, i) => i * 7));
  const base = 'https://pseudo.github.io/depot/';
  const demandes = [
    lue(preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { auteur: AUTEUR })),
    lue(preparerDemande({ plat: APERO, profil: ADULTE_B }, { auteur: AUTEUR })),
    lue(preparerDemande({ plat: ATTENTE }, { auteur: 'a@example.com' })),
  ];
  const envois = [];
  for (const element of demandesATraiter(demandes, { plats: [GRATIN, APERO, ATTENTE], profils: PROFILS })) {
    // Ce que l'app envoie (plan §5.3) : type lu dans l'identifiant, nom du plat, lien vers sa fiche.
    const lu = lireIdDemande(element.demande.id);
    envois.push(texteNotification({ type: lu.type, nomPlat: element.plat.nom, ...element.demande, profil: element.profil }));
    envois.push(adresseNotification(sujet, { lien: `${base}#/plat/${encodeURIComponent(element.plat.id)}` }));
  }
  envois.push(texteNotification({ type: 'essai' }), adresseNotification(sujet, { lien: `${base}#/reglages` }));
  assert.equal(envois.length, 8);
  const interdits = ['@', 'Adulte', 'Enfant', 'profil-a', 'profil-b', 'enfant', 'example', NAISSANCE, '2024', '2026',
    'octobre', 'sans_viande', 'sans viande', 'besoin', 'precaution', 'regime'];
  for (const envoi of envois) {
    assert.equal(typeof envoi, 'string');
    for (const mot of interdits) assert.equal(envoi.toLowerCase().includes(mot.toLowerCase()), false, `${mot} dans ${envoi}`);
    assert.doesNotMatch(envoi, /\d{4}-\d{2}-\d{2}|\d+ ans|\d+ mois/, envoi);
  }
  for (const adresse of envois.filter((e) => e.startsWith('https://'))) {
    const url = new URL(adresse);
    assert.ok([...url.searchParams.keys()].every((cle) => ['title', 'tags', 'priority', 'click'].includes(cle)), adresse);
  }
});

// ——— Ailleurs ———

test('corbeille.js : versDate et jourLisible exportés, comportement inchangé', () => {
  const date = new Date('2026-10-09T08:00:00.000Z');
  assert.equal(versDate(date), date);
  assert.equal(versDate({ seconds: date.getTime() / 1000 }).getTime(), date.getTime());
  assert.equal(versDate({ toDate: () => date }).getTime(), date.getTime());
  assert.equal(versDate('2026-10-09T08:00:00.000Z').getTime(), date.getTime());
  for (const illisible of [null, undefined, '', 'x', {}, 12]) assert.equal(versDate(illisible), null, String(illisible));
  assert.equal(jourLisible(date, MAINTENANT), '9 octobre');
  assert.equal(jourLisible(new Date('2026-03-01T10:00:00.000Z'), MAINTENANT), '1er mars');
  assert.equal(jourLisible(new Date('2025-12-28T10:00:00.000Z'), MAINTENANT), '28 décembre 2025');
  // Les demandes de version créées par T2e sont closes par « Vider la corbeille » comme les autres.
  assert.deepEqual(demandesDesPlats(['gratin-test'], [lue(preparerDemande({ plat: GRATIN, profil: ADULTE_B }, { auteur: AUTEUR }))]),
    ['gratin-test__profil-b']);
});

const racine = new URL('../', import.meta.url);

test('coeur/demandes.js et coeur/ntfy.js : logique pure, sans espace insécable écrite telle quelle', async () => {
  for (const fichier of ['js/coeur/demandes.js', 'js/coeur/ntfy.js', 'js/coeur/corbeille.js', 'js/coeur/roles.js', 'tests/coeur-t2e.test.js']) {
    const source = await readFile(new URL(fichier, racine), 'utf8');
    assert.doesNotMatch(source, /[\u00A0\u202F]/, fichier);
    if (!fichier.startsWith('js/coeur/')) continue;
    assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|\bfetch\(|\blocalStorage\b|\bsessionStorage\b|\bnavigator\.|innerHTML|getRandomValues\(|\bglobalThis\b/, fichier);
    assert.doesNotMatch(source, /from '[^']*(firebase|gstatic)/i, fichier);
    for (const [, chemin] of source.matchAll(/from '([^']+)'/g)) assert.match(chemin, /^\.\/[a-z-]+\.js$/, `${fichier} : ${chemin}`);
  }
});

test('aucun module de coeur/ n’importe coeur/demandes.js (pas de cycle)', async () => {
  const dossier = new URL('js/coeur/', racine);
  for (const nom of await readdir(dossier)) {
    if (nom === 'demandes.js' || !nom.endsWith('.js')) continue;
    const source = await readFile(new URL(nom, dossier), 'utf8');
    assert.doesNotMatch(source, /from '\.\/demandes\.js'/, nom);
  }
});

test('js/notifications.js : fetch en priorité haute, aucun en-tête posé par l’app', async (t) => {
  const chemin = new URL('js/notifications.js', racine);
  try {
    await access(chemin);
  } catch {
    t.skip('js/notifications.js n’existe pas encore');
    return;
  }
  const source = await readFile(chemin, 'utf8');
  assert.match(source, /priority:\s*'high'/);
  assert.doesNotMatch(source, /priority:\s*'low'/);
  assert.doesNotMatch(source, /headers/i);
  assert.match(source, /method:\s*'POST'/);
});
