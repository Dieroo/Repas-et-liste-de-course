// Corbeille des plats (coeur/corbeille.js, ajustements de coeur/plats.js, coeur/paquet.js et coeur/sauvegarde.js).
// Fixtures génériques. Dates locales vérifiées à l'heure de Paris (chaque fichier de test tourne dans son propre
// processus).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estDansCorbeille, dateCorbeille, separerCorbeille, platsSansPreneur, demandesDesPlats, texteCorbeille,
} from '../js/coeur/corbeille.js';
import { nouveauPlatParNom } from '../js/coeur/plats.js';
import { normaliserPourEdition, preparerModification } from '../js/coeur/edition.js';
import { filtrerPreparation, preparerImport, recetteValidee, validerPaquet } from '../js/coeur/paquet.js';
import {
  appliquerConditions, creerSauvegarde, lireSauvegarde, preparerRestauration, validerSauvegarde,
} from '../js/coeur/sauvegarde.js';
import { texteDemandeIdees, SOURCE_IDEE, VERSION_INSTRUCTIONS } from '../js/coeur/claude.js';

// ——— Fixtures génériques (aucune donnée du foyer) ———

const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', email: 'a@example.com', ordre: 1, coefPortion: 1 };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', email: 'b@example.com', ordre: 2, coefPortion: 1 };
const ENFANT = { id: 'enfant', nom: 'Enfant', email: '', ordre: 3, coefPortion: 0.5 };
const PROFILS = [ENFANT, ADULTE_B, ADULTE_A];

const MAINTENANT = new Date('2026-10-09T10:00:00.000Z');
const JETE = new Date('2026-10-08T16:20:00.000Z');
const HEURE_SERVEUR = new Date('2026-10-09T12:00:00.000Z');

const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, marqueurs = []) => ({ produit, qtePortion, unite, rayon: 'divers', marqueurs });

/** Plat qui a sa recette. */
const platRempli = (id, nom, extra = {}) => ({
  id, nom, type: 'plat', recurrence: 'aucune', statutRecette: 'brouillon', portionsBase: 4,
  ingredients: [ing('lentille corail', 300, 'g', ['feculent'])], etapes: ['Cuire.', 'Servir.'], ...extra,
});
const jete = (plat, le = JETE, par = 'b@example.com') => ({ ...plat, corbeille: { le, par } });

const clone = (valeur) => JSON.parse(JSON.stringify(valeur));

// Aucun mot technique, aucune adresse, espaces insécables à leur place dans un texte affiché.
function textesPropres(textes) {
  for (const texte of textes) {
    assert.equal(typeof texte, 'string');
    assert.doesNotMatch(texte, /paquet|slug|json|\bIA\b|undefined|null|NaN|\[object|`|[{}[\]_@]/i, texte);
    assert.doesNotMatch(texte, /\u00A0{2}| {2}|\u00A0 | \u00A0/, texte);
    assert.doesNotMatch(texte, / [:;!?»]|« /, `espace insécable attendue : ${texte}`);
  }
}

// ——— estDansCorbeille, dateCorbeille ———

test('estDansCorbeille : seulement un champ `corbeille` objet', () => {
  assert.equal(estDansCorbeille(jete(platRempli('a', 'A'))), true);
  assert.equal(estDansCorbeille({ id: 'a', nom: 'A', corbeille: {} }), true);
  assert.equal(estDansCorbeille({ id: 'a', nom: 'A', corbeille: { le: null, par: 'a@example.com' } }), true); // hors ligne
  for (const corbeille of [undefined, null, true, false, 'oui', 0, 1, []]) {
    assert.equal(estDansCorbeille({ id: 'a', nom: 'A', corbeille }), false, String(corbeille));
  }
  for (const rien of [null, undefined, 'a', 3, []]) assert.equal(estDansCorbeille(rien), false);
});

test('dateCorbeille : Date, horodatage Firestore (toDate ou secondes), texte ISO ; null sinon', () => {
  const avec = (le) => ({ id: 'a', nom: 'A', corbeille: { le } });
  assert.equal(dateCorbeille(avec(JETE)).getTime(), JETE.getTime());
  assert.equal(dateCorbeille(avec({ toDate: () => JETE })).getTime(), JETE.getTime());
  assert.equal(dateCorbeille(avec({ seconds: 1790000000, nanoseconds: 500000000 })).getTime(), 1790000000500);
  assert.equal(dateCorbeille(avec({ seconds: 1790000000 })).getTime(), 1790000000000);
  assert.equal(dateCorbeille(avec(' 2026-10-08T16:20:00.000Z ')).getTime(), JETE.getTime());
  const casse = { toDate: () => { throw new Error('horodatage abîmé'); } };
  for (const illisible of [undefined, null, '', 'hier', {}, casse, new Date('x'), 42, { seconds: 'x' }, { seconds: Infinity }]) {
    assert.equal(dateCorbeille(avec(illisible)), null, String(illisible));
  }
  assert.equal(dateCorbeille({ id: 'a', nom: 'A' }), null);
  assert.equal(dateCorbeille(null), null);
});

// ——— separerCorbeille ———

test('separerCorbeille : actifs dans l’ordre reçu ; corbeille du plus récent au plus ancien, illisibles en dernier', () => {
  const plats = [
    platRempli('b', 'B'),
    jete(platRempli('ancien', 'Ancien'), '2026-09-01T10:00:00.000Z'), // texte ISO
    { id: 'a', nom: 'A' },
    jete(platRempli('recent', 'Récent'), { toDate: () => new Date('2026-10-09T08:00:00.000Z') }),
    jete(platRempli('attente', 'En attente'), null), // horodatage du serveur pas encore revenu
    jete(platRempli('milieu', 'Milieu'), { seconds: Date.UTC(2026, 9, 1) / 1000, nanoseconds: 0 }),
    jete(platRempli('abime', 'Abîmé'), 'hier'),
    jete(platRempli('date', 'Date'), new Date('2026-10-05T10:00:00.000Z')),
  ];
  const avant = JSON.stringify(plats);
  const { actifs, corbeille } = separerCorbeille(plats);
  assert.deepEqual(actifs.map((p) => p.id), ['b', 'a']);
  assert.deepEqual(corbeille.map((p) => p.id), ['recent', 'date', 'milieu', 'ancien', 'abime', 'attente']);
  assert.equal(JSON.stringify(plats), avant, 'liste reçue intacte');
  assert.equal(actifs[0], plats[0], 'mêmes fiches, pas des copies');
});

test('separerCorbeille : même date ou date illisible → par nom (sans accents ni casse), puis par identifiant', () => {
  const le = '2026-10-08T16:20:00.000Z';
  const plats = [
    jete(platRempli('z', 'éclair'), le),
    jete(platRempli('y', 'Daube'), le),
    jete(platRempli('x', 'ECLAIR'), le),
    jete(platRempli('w', 'Agneau'), le),
    jete(platRempli('v', 'Zeste'), null),
    jete(platRempli('u', 'Bar'), 'x'),
  ];
  assert.deepEqual(separerCorbeille(plats).corbeille.map((p) => p.id), ['w', 'y', 'x', 'z', 'u', 'v']);
});

test('separerCorbeille : entrées vides ou abîmées', () => {
  assert.deepEqual(separerCorbeille(undefined), { actifs: [], corbeille: [] });
  assert.deepEqual(separerCorbeille('x'), { actifs: [], corbeille: [] });
  const { actifs, corbeille } = separerCorbeille([null, undefined, 'plat', 3, { id: 'a', nom: 'A' }, { id: 'b', corbeille: {} }]);
  assert.deepEqual(actifs.map((p) => p.id), ['a']);
  assert.deepEqual(corbeille.map((p) => p.id), ['b']);
});

// ——— platsSansPreneur ———

test('platsSansPreneur : notés « Jamais » par tous les profils, triés par nom ; la corbeille est écartée', () => {
  const tous0 = { 'profil-a': 0, 'profil-b': 0, enfant: 0 };
  const plats = [
    platRempli('poireaux', 'Poireaux vinaigrette', { notes: tous0 }),
    platRempli('abats', 'Abats', { notes: tous0 }),
    { id: 'attente', nom: 'Plat en attente', notes: tous0 }, // ⏳ compris
    platRempli('partiel', 'Partiellement noté', { notes: { 'profil-a': 0, 'profil-b': 0 } }), // l'enfant n'a pas noté
    platRempli('un-trois', 'Un pourquoi pas', { notes: { ...tous0, enfant: 3 } }),
    platRempli('sans-note', 'Sans note'),
    jete(platRempli('deja-jete', 'Déjà jeté', { notes: tous0 })),
    platRempli('texte', 'Note en texte', { notes: { ...tous0, enfant: '0' } }), // note abîmée : pas « Jamais »
  ];
  assert.deepEqual(platsSansPreneur(plats, PROFILS).map((p) => p.id), ['abats', 'attente', 'poireaux']);
  assert.equal(platsSansPreneur(plats, PROFILS)[0], plats[1], 'mêmes fiches');
});

test('platsSansPreneur : seuls les profils de l’app comptent (profil retiré ignoré) ; aucun profil → rien', () => {
  const plats = [
    // Adore d'un profil retiré : ignoré.
    platRempli('a', 'A', { notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0, 'ancien-profil': 5 } }),
    // « Jamais » d'un profil retiré seulement : ne suffit pas.
    platRempli('b', 'B', { notes: { 'profil-a': 0, 'ancien-profil': 0 } }),
  ];
  assert.deepEqual(platsSansPreneur(plats, PROFILS).map((p) => p.id), ['a']);
  assert.deepEqual(platsSansPreneur(plats, [ADULTE_A]).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(platsSansPreneur(plats, []), []);
  assert.deepEqual(platsSansPreneur(plats, undefined), []);
  assert.deepEqual(platsSansPreneur(plats, [null, { nom: 'Sans identifiant' }, { id: '' }]), []);
  // Profils abîmés ignorés, doublons comptés une fois.
  assert.deepEqual(platsSansPreneur(plats, [null, ADULTE_A, ADULTE_A, { id: 42 }]).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(platsSansPreneur(undefined, PROFILS), []);
  assert.deepEqual(platsSansPreneur([null, 'x', { nom: 'Sans id', notes: { 'profil-a': 0 } }], [ADULTE_A]), []);
});

// ——— demandesDesPlats ———

test('demandesDesPlats : demandes ouvertes de ces plats seulement (recette et versions), une fois chacune', () => {
  const demandes = [
    { id: 'gratin__recette', type: 'recette', platId: 'gratin', statut: 'ouverte' },
    { id: 'gratin__profil-b', type: 'variante', platId: 'gratin', profilId: 'profil-b', statut: 'ouverte' },
    { id: 'gratin__enfant', type: 'variante', platId: 'gratin', profilId: 'enfant', statut: 'traitee' },
    { id: 'gratin-2__recette', type: 'recette', platId: 'gratin-2', statut: 'ouverte' }, // autre plat
    { id: 'soupe__recette', statut: 'ouverte' }, // sans platId : reconnue par l'identifiant
    { id: 'autre-id', platId: 'soupe', statut: 'ouverte' }, // identifiant inattendu : reconnue par platId
    { id: 'gratin__recette', platId: 'gratin', statut: 'ouverte' }, // doublon
    { id: 'tarte__recette', platId: 'tarte', statut: 'ouverte' },
    null,
    { platId: 'gratin', statut: 'ouverte' }, // sans identifiant
  ];
  assert.deepEqual(demandesDesPlats(['gratin', 'soupe'], demandes),
    ['gratin__recette', 'gratin__profil-b', 'soupe__recette', 'autre-id']);
  assert.deepEqual(demandesDesPlats([], demandes), []);
  assert.deepEqual(demandesDesPlats(['gratin'], undefined), []);
  assert.deepEqual(demandesDesPlats(undefined, demandes), []);
});

// ——— texteCorbeille ———

test('texteCorbeille : date du jour local, « 1er », année si elle diffère ; sans date lisible, sans date', () => {
  const avec = (le, par) => ({ id: 'a', nom: 'A', corbeille: { le, ...(par !== undefined ? { par } : {}) } });
  const options = { maintenant: MAINTENANT };
  assert.equal(texteCorbeille(avec(new Date('2026-10-09T08:00:00.000Z')), options), 'Mis à la corbeille le 9 octobre');
  // 0 h 30 à Paris : le jour local, pas celui de l'UTC.
  assert.equal(texteCorbeille(avec('2026-10-08T22:30:00.000Z'), options), 'Mis à la corbeille le 9 octobre');
  assert.equal(texteCorbeille(avec({ toDate: () => new Date(2026, 2, 1, 12) }), options), 'Mis à la corbeille le 1er mars');
  assert.equal(texteCorbeille(avec({ seconds: new Date(2026, 7, 15, 9).getTime() / 1000 }), options), 'Mis à la corbeille le 15 août');
  assert.equal(texteCorbeille(avec(new Date(2025, 11, 31, 23, 30)), options), 'Mis à la corbeille le 31 décembre 2025');
  assert.equal(texteCorbeille(avec(new Date(2026, 1, 1)), { maintenant: new Date(2027, 0, 2) }), 'Mis à la corbeille le 1er février 2026');
  assert.equal(texteCorbeille(avec(null), options), 'Mis à la corbeille');
  assert.equal(texteCorbeille(avec('demain'), options), 'Mis à la corbeille');
  // Pas dans la corbeille : rien.
  assert.equal(texteCorbeille({ id: 'a', nom: 'A' }, options), '');
  assert.equal(texteCorbeille(null), '');
  // `maintenant` illisible : la date du téléphone.
  assert.match(texteCorbeille(avec(new Date(2020, 4, 8)), { maintenant: 'x' }), /^Mis à la corbeille le 8 mai 2020$/);
});

test('texteCorbeille : « par vous », « par <prénom> », jamais d’adresse', () => {
  const plat = (par) => ({ id: 'a', nom: 'A', corbeille: { le: JETE, par } });
  const options = { profils: PROFILS, maintenant: MAINTENANT };
  assert.equal(texteCorbeille(plat('b@example.com'), options), 'Mis à la corbeille le 8 octobre par Adulte B');
  assert.equal(texteCorbeille(plat(' B@Example.COM '), options), 'Mis à la corbeille le 8 octobre par Adulte B');
  // La personne connectée : son profil, ou son adresse si elle n'est reliée à aucun profil.
  assert.equal(texteCorbeille(plat('b@example.com'), { ...options, moi: ADULTE_B }), 'Mis à la corbeille le 8 octobre par vous');
  assert.equal(texteCorbeille(plat('c@example.com'), { ...options, moi: 'C@example.com' }), 'Mis à la corbeille le 8 octobre par vous');
  assert.equal(texteCorbeille(plat('b@example.com'), { ...options, moi: ADULTE_A }), 'Mis à la corbeille le 8 octobre par Adulte B');
  // Adresse inconnue des profils, ou absente : ni prénom ni adresse.
  assert.equal(texteCorbeille(plat('inconnu@example.com'), options), 'Mis à la corbeille le 8 octobre');
  assert.equal(texteCorbeille(plat(''), options), 'Mis à la corbeille le 8 octobre');
  assert.equal(texteCorbeille(plat(undefined), { ...options, moi: { id: 'x', email: '' } }), 'Mis à la corbeille le 8 octobre');
  // Profil sans prénom lisible : pas de « par ».
  assert.equal(texteCorbeille(plat('d@example.com'), { profils: [{ id: 'd', nom: '  ', email: 'd@example.com' }], maintenant: MAINTENANT }),
    'Mis à la corbeille le 8 octobre');
  // Prénom aux espaces en trop : réduit.
  assert.equal(texteCorbeille(plat('d@example.com'), { profils: [{ id: 'd', nom: ' Adulte   D ', email: 'd@example.com' }], maintenant: MAINTENANT }),
    'Mis à la corbeille le 8 octobre par Adulte D');
  textesPropres([texteCorbeille(plat('b@example.com'), options), texteCorbeille(plat('inconnu@example.com'), options)]);
});

// ——— Ajout par nom ———

test('ajout par nom : nom d’un plat de la corbeille → erreur qui dit de le remettre, sans lien vers la fiche', () => {
  const plats = [platRempli('gratin', 'Gratin dauphinois'), jete(platRempli('dahl-corail', 'Dahl corail'))];
  const r = nouveauPlatParNom('  DAHL   corail ', plats);
  assert.deepEqual(r, {
    erreur: '«\u00A0Dahl corail\u00A0» est dans la corbeille. Remettez-le depuis la corbeille, en bas de cet écran.',
    corbeille: 'dahl-corail',
  });
  textesPropres([r.erreur]);
  // Un plat actif du même nom passe avant : « existe déjà », avec son lien.
  const deux = nouveauPlatParNom('Dahl corail', [jete(platRempli('dahl-corail', 'Dahl corail')), platRempli('dahl-corail-2', 'Dahl Corail')]);
  assert.deepEqual(deux, { erreur: '«\u00A0Dahl Corail\u00A0» existe déjà.', existant: 'dahl-corail-2' });
  // Identifiant pris par un plat de la corbeille d'un autre nom : identifiant libre, la fiche jetée reste intacte.
  assert.deepEqual(nouveauPlatParNom('Soupe', [jete(platRempli('soupe', 'Soupe de légumes'))]).plat, { id: 'soupe-2', nom: 'Soupe' });
  // Sans corbeille : comme avant.
  assert.deepEqual(nouveauPlatParNom('Soupe', plats).plat, { id: 'soupe', nom: 'Soupe' });
});

test('« Modifier » : renommer un plat du nom d’un plat de la corbeille → message qui le dit ; un plat actif passe avant', () => {
  const soupe = platRempli('soupe', 'Soupe');
  const renommer = (nom, plats) => {
    const base = normaliserPourEdition(soupe, {});
    const saisie = clone(base);
    saisie.nom = nom;
    return preparerModification(base, saisie, soupe, { plats: [soupe, ...plats], demandes: [], reglages: {} }).erreurs;
  };
  const dahlJete = jete(platRempli('dahl-corail', 'Dahl corail'));
  const erreurs = renommer('dahl  CORAIL', [dahlJete]);
  assert.deepEqual(erreurs, [{ champ: 'nom', message: '«\u00A0Dahl corail\u00A0» est dans la corbeille. Choisissez un autre nom.' }]);
  textesPropres(erreurs.map((e) => e.message));
  assert.deepEqual(renommer('Dahl corail', [dahlJete, platRempli('dahl-corail-2', 'Dahl Corail')]),
    [{ champ: 'nom', message: '«\u00A0Dahl Corail\u00A0» existe déjà.' }]);
  assert.deepEqual(renommer('Dahl rouge', [dahlJete]), []);
});

// ——— Ajout de recettes ———

const paquet = (...plats) => ({ format: 'paquet@1', instructions: VERSION_INSTRUCTIONS, plats });
function valides(...plats) {
  const resultat = validerPaquet([paquet(...plats)], { profils: PROFILS });
  assert.equal(resultat.valide, true, JSON.stringify(resultat.erreurs.concat(resultat.plats.flatMap((p) => p.erreurs))));
  return resultat.plats.map((p) => p.donnees);
}
const importer = (plats, options) => preparerImport(valides(...plats), { demandes: [], profils: PROFILS, ...options });
const recette = (id, nom, extra = {}) => ({
  id, nom, statutRecette: 'brouillon', portionsBase: 4,
  ingredients: [ing('pois chiche', 400, 'g', ['feculent']), ing('épinard', 200, 'g', ['legume'], { role: 'incorpore' })],
  etapes: ['Cuire.', 'Mélanger.', 'Servir.'],
  ...extra,
});

test('validation : `corbeille` dans une réponse est connue et ignorée, sans avertissement', () => {
  const r = validerPaquet([paquet(recette('dahl', 'Dahl', { corbeille: { le: '2026-10-08T16:20:00.000Z', par: 'a@example.com' } }))]);
  assert.equal(r.valide, true);
  assert.deepEqual(r.avertissements, []);
  assert.deepEqual(r.plats[0].avertissements, []);
  assert.equal('corbeille' in r.plats[0].donnees, false);
  // recetteValidee ne la garde pas non plus.
  assert.equal('corbeille' in recetteValidee(jete(platRempli('a', 'A'))), false);
});

test('ajout de recettes : une recette qui vise un plat de la corbeille n’est pas écrite ; les autres s’enregistrent', () => {
  const plats = [jete(platRempli('dahl', 'Dahl')), platRempli('soupe', 'Soupe')];
  const demandes = [{ id: 'dahl__recette', statut: 'ouverte' }, { id: 'dahl__profil-b', statut: 'ouverte' }];
  const r = importer([recette('dahl', 'Dahl'), recette('curry', 'Curry de pois chiches')], { plats, demandes });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.corrections, []);
  assert.deepEqual(r.elements[0], {
    index: 0,
    id: 'dahl',
    nom: 'Dahl',
    statut: 'corbeille',
    remettable: true,
    ingredients: 2,
    etapes: 3,
    avertissements: ['«\u00A0Dahl\u00A0» est dans la corbeille\u00A0: remettez-le pour lui ajouter cette recette.'],
    versions: [],
  });
  textesPropres(r.elements[0].avertissements);
  assert.deepEqual(r.ecritures.map((e) => e.id), ['curry']);
  assert.equal(r.elements[1].statut, 'nouveau');
  assert.equal(r.elements[1].index, 1);
  assert.deepEqual(r.demandesAClore, [], 'les demandes du plat jeté restent telles quelles');
  // Décocher l'entrée ne change rien.
  assert.deepEqual(filtrerPreparation(r, ['dahl']).ecritures.map((e) => e.id), ['curry']);
});

test('ajout de recettes : plat de la corbeille visé par son nom, par la fiche (« Coller la recette ») ou ⏳', () => {
  // Même nom, autre identifiant.
  const parNom = importer([recette('dahl-de-lentilles', 'DAHL')], { plats: [jete(platRempli('dahl', 'Dahl'))] });
  assert.equal(parNom.elements[0].statut, 'corbeille');
  assert.equal(parNom.elements[0].id, 'dahl');
  assert.equal(parNom.elements[0].nom, 'DAHL');
  assert.deepEqual(parNom.ecritures, []);
  // Recette collée depuis la fiche d'un plat de la corbeille.
  const cible = importer([recette('autre', 'Autre nom')], { plats: [jete(platRempli('dahl', 'Dahl'))], cible: 'dahl' });
  assert.equal(cible.elements[0].statut, 'corbeille');
  assert.equal(cible.elements[0].id, 'dahl');
  assert.deepEqual(cible.ecritures, []);
  // Plat ⏳ dans la corbeille : pas complété, sa demande de recette reste ouverte.
  const attente = importer([recette('poulet', 'Poulet')], {
    plats: [jete({ id: 'poulet', nom: 'Poulet' })], demandes: [{ id: 'poulet__recette', statut: 'ouverte' }],
  });
  assert.equal(attente.elements[0].statut, 'corbeille');
  assert.deepEqual(attente.ecritures, []);
  assert.deepEqual(attente.demandesAClore, []);
  // Entrée sans ingrédients (nom seul) pour un plat de la corbeille : rien non plus, et rien à lui ajouter une fois remis.
  const nomSeul = importer([{ id: 'dahl', nom: 'Dahl', statutRecette: 'attente' }], { plats: [jete(platRempli('dahl', 'Dahl'))] });
  assert.equal(nomSeul.elements[0].statut, 'corbeille');
  assert.equal(nomSeul.elements[0].ingredients, 0);
  assert.equal(nomSeul.elements[0].remettable, false);
  assert.deepEqual(nomSeul.elements[0].avertissements, ['«\u00A0Dahl\u00A0» est dans la corbeille\u00A0: cette réponse n’apporte rien à ce plat.']);
  textesPropres(nomSeul.elements[0].avertissements);
  assert.deepEqual(nomSeul.ecritures, []);
  // Deux entrées pour le même plat de la corbeille : ni écriture ni erreur.
  // (Le premier vise le plat ⏳ par son identifiant, le second par son nom.)
  const deux = importer([recette('dahl', 'Dahl indien'), recette('dahl-maison', 'Dahl')], { plats: [jete({ id: 'dahl', nom: 'Dahl' })] });
  assert.deepEqual(deux.elements.map((e) => [e.id, e.statut]), [['dahl', 'corbeille'], ['dahl', 'corbeille']]);
  assert.deepEqual(deux.erreurs, []);
  assert.deepEqual(deux.ecritures, []);
});

test('ajout de recettes : un plat actif du même nom passe avant celui de la corbeille ; son identifiant n’est jamais repris', () => {
  const plats = [platRempli('dahl', 'Dahl', { statutRecette: 'brouillon' }), jete(platRempli('dahl-2', 'Dahl'))];
  const r = importer([recette('dahl-maison', 'Dahl')], { plats });
  assert.equal(r.elements[0].statut, 'remplace');
  assert.equal(r.elements[0].id, 'dahl');
  // Ordre inverse dans la liste : même plat visé.
  assert.equal(importer([recette('dahl-maison', 'Dahl')], { plats: [...plats].reverse() }).elements[0].id, 'dahl');
  // Nouveau plat dont l'identifiant est celui d'un plat jeté d'un autre nom : identifiant libre, rien n'est écrit sur la fiche jetée.
  const libre = importer([recette('soupe', 'Soupe de pois')], { plats: [jete(platRempli('soupe', 'Soupe de légumes'))] });
  assert.equal(libre.elements[0].statut, 'nouveau');
  assert.deepEqual(libre.ecritures.map((e) => e.id), ['soupe-2']);
});

test('ajout de recettes : versions seules pour un plat de la corbeille → ni écrites ni closes', () => {
  const plat = jete(platRempli('chili', 'Chili', {
    ingredients: [ing('bœuf haché', 500, 'g', ['viande', 'boeuf'], { forme: 'hachee' }), ing('haricot rouge', 400, 'g', ['feculent'])],
  }));
  const versions = (...variantes) => ({ id: 'chili', nom: 'Chili', variantes });
  const vegetale = { pour: 'profil-b', style: 'vegetal', retirer: ['bœuf haché'], ajouter: [ajout('protéines de soja', 30, 'g')], consigne: 'Soja à part.' };
  const mer = { pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['bœuf haché'], ajouter: [ajout('thon', 60, 'g', ['poisson'])], consigne: 'Thon à part.' };
  const demandes = [{ id: 'chili__profil-b', statut: 'ouverte' }];
  const une = importer([versions(vegetale)], { plats: [plat], demandes });
  assert.deepEqual(une.erreurs, []);
  assert.equal(une.elements[0].statut, 'corbeille');
  assert.equal(une.elements[0].id, 'chili');
  assert.equal(une.elements[0].ingredients, 2);
  assert.equal(une.elements[0].etapes, 2);
  assert.deepEqual(une.elements[0].avertissements, ['«\u00A0Chili\u00A0» est dans la corbeille\u00A0: remettez-le pour lui ajouter cette version.']);
  assert.equal(une.elements[0].remettable, true);
  assert.deepEqual(une.ecritures, []);
  assert.deepEqual(une.demandesAClore, []);
  const deux = importer([versions(mer, vegetale)], { plats: [plat], demandes });
  assert.deepEqual(deux.elements[0].avertissements, ['«\u00A0Chili\u00A0» est dans la corbeille\u00A0: remettez-le pour lui ajouter ces versions.']);
  // Plat ⏳ de la corbeille : remis, il ignorerait ses versions ; on ne propose donc pas de le remettre pour elles.
  const attente = importer([versions(vegetale)], { plats: [jete({ id: 'chili', nom: 'Chili' })], demandes });
  assert.deepEqual(attente.erreurs, []);
  assert.equal(attente.elements[0].statut, 'corbeille');
  assert.equal(attente.elements[0].remettable, false);
  assert.deepEqual(attente.elements[0].avertissements, ['«\u00A0Chili\u00A0» est dans la corbeille\u00A0: cette réponse n’apporte rien à ce plat.']);
  assert.deepEqual(attente.ecritures, []);
  assert.deepEqual(attente.demandesAClore, []);
  textesPropres([...une.elements[0].avertissements, ...deux.elements[0].avertissements, ...attente.elements[0].avertissements]);
});

test('ajout de recettes : idée de Claude pour un plat de la corbeille → pas reprise (avec recette) ou à remettre (⏳)', () => {
  const idee = (id, nom) => recette(id, nom, { source: SOURCE_IDEE });
  const avecRecette = importer([idee('dahl-corail', 'Dahl corail'), idee('curry', 'Curry')], { plats: [jete(platRempli('dahl', 'Dahl corail'))] });
  assert.equal(avecRecette.elements[0].statut, 'corbeille');
  assert.deepEqual(avecRecette.elements[0].avertissements, ['«\u00A0Dahl corail\u00A0» est dans la corbeille\u00A0: cette idée n’est pas reprise.']);
  assert.equal(avecRecette.elements[0].remettable, false);
  assert.deepEqual(avecRecette.ecritures.map((e) => e.id), ['curry']);
  const attente = importer([idee('dahl-corail', 'Dahl corail')], { plats: [jete({ id: 'dahl', nom: 'Dahl corail' })] });
  assert.equal(attente.elements[0].statut, 'corbeille');
  assert.equal(attente.elements[0].remettable, true);
  assert.match(attente.elements[0].avertissements[0], /remettez-le pour lui ajouter cette recette/);
  textesPropres([...avecRecette.elements[0].avertissements, ...attente.elements[0].avertissements]);
});

test('ajout de recettes : idées collées depuis une fiche (« Coller la recette », plusieurs entrées) → l’idée pour un plat de la corbeille qui a sa recette n’est pas « remettable »', () => {
  // Plusieurs entrées : la fiche d'où l'on colle ne prime pas ; chaque idée suit les règles habituelles.
  const idee = (id, nom) => recette(id, nom, { source: SOURCE_IDEE });
  const plats = [platRempli('tarte', 'Tarte'), jete(platRempli('gratin', 'Gratin'))];
  const r = importer([idee('gratin', 'Gratin'), idee('curry', 'Curry')], { plats, cible: 'tarte' });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.elements[0].statut, 'corbeille');
  assert.equal(r.elements[0].remettable, false, 'pas de « Remettre » : remis, le plat ne prendrait pas l’idée');
  assert.deepEqual(r.elements[0].avertissements, ['«\u00A0Gratin\u00A0» est dans la corbeille\u00A0: cette idée n’est pas reprise.']);
  assert.deepEqual(r.ecritures.map((e) => e.id), ['curry']);
  // Remis, l'aperçu le classerait « Déjà dans vos plats » : rien ne serait repris non plus.
  const remis = importer([idee('gratin', 'Gratin'), idee('curry', 'Curry')], { plats: [plats[0], platRempli('gratin', 'Gratin')], cible: 'tarte' });
  assert.equal(remis.elements[0].statut, 'deja');
});

test('ajout de recettes : `remettable` dit vrai : une fois le plat remis, l’entrée écrit quelque chose si et seulement si elle était « remettable »', () => {
  const chili = (extra = {}) => platRempli('chili', 'Chili', {
    ingredients: [ing('bœuf haché', 500, 'g', ['viande', 'boeuf'], { forme: 'hachee' }), ing('haricot rouge', 400, 'g', ['feculent'])],
    ...extra,
  });
  const vegetale = { pour: 'profil-b', style: 'vegetal', retirer: ['bœuf haché'], ajouter: [ajout('protéines de soja', 30, 'g')], consigne: 'Soja à part.' };
  const cas = [
    { nom: 'recette, plat rempli', plat: chili(), entrees: [recette('chili', 'Chili')], attendu: true },
    { nom: 'recette, plat ⏳', plat: { id: 'chili', nom: 'Chili' }, entrees: [recette('chili', 'Chili')], attendu: true },
    { nom: 'idée, plat rempli', plat: chili(), entrees: [recette('chili', 'Chili', { source: SOURCE_IDEE })], attendu: false },
    { nom: 'idée, plat ⏳', plat: { id: 'chili', nom: 'Chili' }, entrees: [recette('chili', 'Chili', { source: SOURCE_IDEE })], attendu: true },
    { nom: 'versions, plat rempli', plat: chili(), entrees: [{ id: 'chili', nom: 'Chili', variantes: [vegetale] }], attendu: true },
    { nom: 'versions, plat ⏳', plat: { id: 'chili', nom: 'Chili' }, entrees: [{ id: 'chili', nom: 'Chili', variantes: [vegetale] }], attendu: false },
    { nom: 'nom seul, plat rempli', plat: chili(), entrees: [{ id: 'chili', nom: 'Chili' }], attendu: false },
    { nom: 'nom seul, plat ⏳', plat: { id: 'chili', nom: 'Chili' }, entrees: [{ id: 'chili', nom: 'Chili' }], attendu: false },
  ];
  for (const { nom, plat, entrees, attendu } of cas) {
    const avant = importer(entrees, { plats: [jete(plat)] });
    assert.equal(avant.elements[0]?.statut, 'corbeille', nom);
    assert.equal(avant.elements[0].remettable, attendu, nom);
    assert.deepEqual(avant.ecritures, [], nom);
    textesPropres(avant.elements[0].avertissements);
    const apres = importer(entrees, { plats: [plat] });
    assert.equal(apres.ecritures.some((e) => e.id === 'chili'), attendu, `${nom} : remis, ${JSON.stringify(apres.elements)}`);
  }
});

test('« Coller la recette » : Claude rend le nom d’un plat de la corbeille → la recette va à la fiche, qui garde son nom ; un plat actif du même nom reste une erreur', () => {
  const fiche = { id: 'dahl-de-lentilles-corail', nom: 'Dahl de lentilles corail' };
  const demandes = [{ id: 'dahl-de-lentilles-corail__recette', statut: 'ouverte' }];
  const r = importer([recette('dahl', 'Dahl')], { plats: [fiche, jete(platRempli('dahl', 'Dahl'))], demandes, cible: fiche.id });
  assert.deepEqual(r.erreurs, [], 'aucune erreur ni correction « recette de dahl reçue » pour Claude');
  assert.deepEqual(r.corrections, []);
  assert.equal(r.elements.length, 1);
  assert.equal(r.elements[0].id, fiche.id);
  assert.equal(r.elements[0].statut, 'complete');
  assert.equal(r.elements[0].nom, 'Dahl de lentilles corail');
  assert.equal('ancienNom' in r.elements[0], false);
  assert.deepEqual(r.elements[0].avertissements, ['Claude l’appelle «\u00A0Dahl\u00A0»\u00A0: le nom de la fiche est gardé.']);
  textesPropres(r.elements[0].avertissements);
  assert.deepEqual(r.ecritures.map((e) => [e.id, e.donnees.nom]), [[fiche.id, 'Dahl de lentilles corail']]);
  assert.deepEqual(r.demandesAClore, ['dahl-de-lentilles-corail__recette']);
  // Un plat actif du même nom : toujours l'erreur d'avant (la réponse est sans doute celle d'un autre plat).
  const actif = importer([recette('dahl', 'Dahl')], { plats: [fiche, platRempli('dahl', 'Dahl')], demandes, cible: fiche.id });
  assert.equal(actif.erreurs.length, 1);
  assert.match(actif.erreurs[0].message, /déjà dans vos plats/);
  assert.deepEqual(actif.ecritures, []);
});

test('DEMANDE-IDEES : un plat de la corbeille reste dans « déjà dans l’app » (Claude ne le repropose pas)', () => {
  const texte = texteDemandeIdees({ plats: [platRempli('soupe', 'Soupe'), jete(platRempli('dahl', 'Dahl'))], profils: PROFILS });
  assert.ok(texte.split('\n').includes('déjà dans l\'app: Dahl ; Soupe'), texte);
  // Notes : un plat de la corbeille n'est jamais « aimé » (même noté « J'adore »), mais reste « évité ».
  const notes = texteDemandeIdees({
    plats: [
      platRempli('soupe', 'Soupe', { notes: { 'profil-a': 5 } }),
      jete(platRempli('dahl', 'Dahl', { notes: { 'profil-b': 5, 'profil-a': 0 } })),
    ],
    profils: PROFILS,
  }).split('\n');
  assert.ok(notes.includes('aimés: Soupe'), notes.join('\n'));
  assert.ok(notes.includes('évités: Dahl'), notes.join('\n'));
});

// ——— Sauvegarde et restauration ———

/** Remplace le marqueur d'horodatage par une date, comme serverTimestamp() une fois l'écriture faite. */
function horodater(valeur) {
  if (valeur && typeof valeur === 'object' && valeur.horodatageServeur === true) return HEURE_SERVEUR;
  if (Array.isArray(valeur)) return valeur.map(horodater);
  if (valeur && typeof valeur === 'object' && !(valeur instanceof Date)) {
    return Object.fromEntries(Object.entries(valeur).map(([c, v]) => [c, horodater(v)]));
  }
  return valeur;
}

/** Applique des lots d'écritures (revus par appliquerConditions, comme à l'envoi) à un état { plats, profils }. */
function appliquer(etat, lots) {
  const collections = {
    plats: new Map(etat.plats.map((p) => [p.id, structuredClone(p)])),
    profils: new Map(etat.profils.map((p) => [p.id, structuredClone(p)])),
  };
  for (const lot of lots) {
    for (const prevue of lot) {
      const docs = collections[prevue.collection];
      const ecriture = appliquerConditions(prevue, docs.get(prevue.id) ?? null);
      if (!ecriture) continue;
      const donnees = horodater(ecriture.donnees);
      if (ecriture.mode === 'fusion') {
        docs.set(ecriture.id, { ...(docs.get(ecriture.id) ?? {}), ...donnees });
        continue;
      }
      const doc = docs.get(ecriture.id);
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

/** Sauvegarde relue et validée, comme à la restauration. */
function relue(etat, maintenant = MAINTENANT) {
  const { texte } = creerSauvegarde(etat, { maintenant });
  const lue = lireSauvegarde(texte);
  assert.ok(lue.sauvegarde, `lecture : ${lue.erreur}`);
  return validerSauvegarde(lue.sauvegarde);
}
const ecrituresDe = (preparation) => preparation.lots.flat();

test('sauvegarde : la marque de corbeille part en ISO avec son auteur, après le suivi ; rien pour un plat actif', () => {
  const plats = [
    jete(platRempli('a', 'A'), JETE, ' b@example.com '),
    jete(platRempli('b', 'B'), { toDate: () => JETE }),
    jete(platRempli('c', 'C'), { seconds: JETE.getTime() / 1000, nanoseconds: 0 }, ''),
    jete(platRempli('d', 'D'), '2026-10-08T16:20:00.000Z', 42),
    { ...platRempli('e', 'E'), corbeille: { par: 'a@example.com' } }, // horodatage du serveur pas encore revenu
    { ...platRempli('f', 'F'), corbeille: null },
    { ...platRempli('g', 'G'), corbeille: true }, // pas un objet : pas dans la corbeille
    platRempli('h', 'H', { notes: { 'profil-a': 4 }, modifieePar: 'a@example.com' }),
  ];
  const fichier = JSON.parse(creerSauvegarde({ plats, profils: PROFILS }, { maintenant: MAINTENANT }).texte);
  const parId = Object.fromEntries(fichier.plats.map((p) => [p.id, p]));
  assert.deepEqual(parId.a.corbeille, { le: '2026-10-08T16:20:00.000Z', par: 'b@example.com' });
  assert.deepEqual(Object.keys(parId.a).slice(-1), ['corbeille']);
  assert.deepEqual(parId.b.corbeille, { le: '2026-10-08T16:20:00.000Z', par: 'b@example.com' });
  assert.deepEqual(parId.c.corbeille, { le: '2026-10-08T16:20:00.000Z' });
  assert.deepEqual(parId.d.corbeille, { le: '2026-10-08T16:20:00.000Z' });
  // Date encore inconnue : celle de la sauvegarde, pour ne pas perdre la marque.
  assert.deepEqual(parId.e.corbeille, { le: MAINTENANT.toISOString(), par: 'a@example.com' });
  for (const id of ['f', 'g', 'h']) assert.equal('corbeille' in parId[id], false, id);
});

test('sauvegarde relue : marque de corbeille lue (Date) ; illisible → avertissement et ignorée', () => {
  const v = relue({ plats: [jete(platRempli('a', 'A')), platRempli('b', 'B')], profils: PROFILS });
  assert.deepEqual(v.avertissements, []);
  const a = v.plats.find((p) => p.id === 'a');
  assert.ok(a.corbeille.le instanceof Date);
  assert.equal(a.corbeille.le.getTime(), JETE.getTime());
  assert.equal(a.corbeille.par, 'b@example.com');
  assert.equal('corbeille' in a.recette, false);
  assert.equal('corbeille' in v.plats.find((p) => p.id === 'b'), false);

  const fichier = (corbeille) => ({
    format: 'paquet@1', sauvegardeLe: MAINTENANT.toISOString(), profils: [], plats: [{ ...platRempli('x', 'Plat X'), corbeille }],
  });
  for (const illisible of ['oui', true, 3, [], {}, { par: 'a@example.com' }, { le: 'hier' }, { le: 1790000000 },
    { le: { seconds: 1790000000 } }, { le: '' }]) {
    const lu = validerSauvegarde(fichier(illisible));
    assert.equal(lu.valide, true);
    assert.equal('corbeille' in lu.plats[0], false, JSON.stringify(illisible));
    assert.deepEqual(lu.avertissements, ['«\u00A0Plat X\u00A0»\u00A0: sa mise à la corbeille est illisible dans ce fichier, elle a été ignorée.']);
    assert.ok(lu.plats[0].recette, 'la recette reste reprise');
  }
  textesPropres(validerSauvegarde(fichier('oui')).avertissements);
  // `null` : pas de marque, sans avertissement ; auteur illisible : marque gardée sans auteur.
  assert.deepEqual(validerSauvegarde(fichier(null)).avertissements, []);
  const sansAuteur = validerSauvegarde(fichier({ le: '2026-10-08T16:20:00.000Z', par: { nom: 'x' } }));
  assert.deepEqual(sansAuteur.avertissements, []);
  assert.deepEqual(Object.keys(sansAuteur.plats[0].corbeille), ['le']);
});

test('aller-retour : sur une base vide, un plat de la corbeille revient dans la corbeille ; puis plus rien ne manque', () => {
  const etat = {
    plats: [jete(platRempli('dahl', 'Dahl', { notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0 } })), platRempli('soupe', 'Soupe')],
    profils: clone(PROFILS),
  };
  const r = preparerRestauration(relue(etat), { plats: [], profils: [], demandes: [], email: 'a@example.com' });
  const ecriture = ecrituresDe(r).find((e) => e.id === 'dahl');
  assert.equal(ecriture.mode, 'fusion');
  assert.ok(ecriture.donnees.corbeille.le instanceof Date, 'Date du fichier, comme modifieeLe');
  assert.equal(ecriture.donnees.corbeille.le.getTime(), JETE.getTime());
  assert.equal(ecriture.donnees.corbeille.par, 'b@example.com');
  assert.equal('corbeille' in ecrituresDe(r).find((e) => e.id === 'soupe').donnees, false);
  // Le résumé dit qu'il revient dans la corbeille (il n'apparaîtra pas dans la liste des plats).
  assert.deepEqual([...r.resume.platsRemis].sort(), ['Dahl (dans la corbeille)', 'Soupe']);
  const apres = appliquer({ plats: [], profils: [] }, r.lots);
  const { actifs, corbeille } = separerCorbeille(apres.plats);
  assert.deepEqual(actifs.map((p) => p.id), ['soupe']);
  assert.deepEqual(corbeille.map((p) => p.id), ['dahl']);
  assert.equal(dateCorbeille(corbeille[0]).getTime(), JETE.getTime());
  assert.deepEqual(recetteValidee(corbeille[0]), recetteValidee(etat.plats[0]));
  // Restauré de nouveau : rien à faire ; et la sauvegarde suivante redonne la même marque.
  assert.equal(preparerRestauration(relue(etat), { ...apres, demandes: [] }).rien, true);
  assert.deepEqual(JSON.parse(creerSauvegarde(apres, { maintenant: MAINTENANT }).texte).plats.find((p) => p.id === 'dahl').corbeille,
    { le: JETE.toISOString(), par: 'b@example.com' });
});

test('restauration additive : la marque d’un plat présent n’est jamais posée ni effacée, recette cochée comprise', () => {
  const fichierJete = jete(platRempli('dahl', 'Dahl', { notes: { 'profil-a': 4 } }));
  const fichierActif = platRempli('soupe', 'Soupe', { notes: { 'profil-b': 2 } });
  const v = relue({ plats: [fichierJete, fichierActif], profils: clone(PROFILS) });
  // Dans l'app : le dahl est actif (remis entre-temps), la soupe est dans la corbeille ; recettes et notes différentes.
  const app = {
    plats: [
      platRempli('dahl', 'Dahl', { etapes: ['Autre.'] }),
      jete(platRempli('soupe', 'Soupe', { etapes: ['Autre.'] }), new Date('2026-10-09T07:00:00.000Z'), 'a@example.com'),
    ],
    profils: clone(PROFILS),
  };
  const r = preparerRestauration(v, { ...app, demandes: [], email: 'a@example.com' }, { recettesAReprendre: ['dahl', 'soupe'] });
  assert.equal(r.resume.recettesReprises, 2);
  assert.equal(r.resume.notesRemises, 2);
  for (const e of ecrituresDe(r)) {
    assert.equal(e.mode, 'update');
    assert.equal('corbeille' in e.donnees, false, e.id);
    assert.equal((e.effacer ?? []).includes('corbeille'), false, e.id);
  }
  const apres = appliquer(app, r.lots);
  const dahl = apres.plats.find((p) => p.id === 'dahl');
  const soupe = apres.plats.find((p) => p.id === 'soupe');
  assert.equal(estDansCorbeille(dahl), false, 'jamais remis dans la corbeille');
  assert.deepEqual(soupe.corbeille, { le: new Date('2026-10-09T07:00:00.000Z'), par: 'a@example.com' }, 'jamais sorti de la corbeille');
  assert.deepEqual(dahl.etapes, ['Cuire.', 'Servir.']);
  assert.deepEqual(soupe.notes, { 'profil-b': 2 });
});

test('restauration : plat absent dont le nom est porté par un plat de la corbeille → non remis', () => {
  const v = relue({ plats: [platRempli('dahl', 'Dahl')], profils: [] });
  const r = preparerRestauration(v, { plats: [jete(platRempli('dahl-maison', 'DAHL'))], profils: [], demandes: [], email: 'a@example.com' });
  assert.equal(r.rien, true);
  assert.deepEqual(r.resume.nonRemis, ['Dahl']);
});

test('restauration : plat de la corbeille identique des deux côtés → rien à écrire', () => {
  const etat = { plats: [jete(platRempli('dahl', 'Dahl', { notes: { 'profil-a': 0 } }))], profils: clone(PROFILS) };
  const app = { plats: [jete(platRempli('dahl', 'Dahl', { notes: { 'profil-a': 0 } }), { toDate: () => JETE })], profils: clone(PROFILS) };
  assert.equal(preparerRestauration(relue(etat), { ...app, demandes: [] }).rien, true);
});
