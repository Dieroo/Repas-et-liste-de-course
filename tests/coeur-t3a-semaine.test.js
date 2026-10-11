// T3a « La semaine et sa liste » : coeur/semaine.js (dates, semaine montrée et semaine visée, qui en mange, version
// servie, repas et portions, écritures d'un geste, feuille « Ajouter à la semaine », textes de la carte d'un plat) et
// les deux fonctions exportées pour elle par compatibilite.js. Fixtures génériques : aucune donnée du foyer.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireRegime } from '../js/coeur/regles.js';
import { BAREME_AGE, regleDuPalier } from '../js/coeur/age.js';
import { evaluer, frigoJoursDe, varianteRetenue } from '../js/coeur/compatibilite.js';
import {
  DUREE_MAX_JOURS, EFFACER, FILTRES_CHOIX, INVITES_MAX, PREFERES_MAX, RANGS_STATUT, REPAS_MAX, TEXTE_PERSONNE,
  TEXTE_SANS_RECETTE, ajouterJours, appliquerChamps, champsValides, cheminSur, coefDe, ecartJours, ecrituresAjout,
  ecrituresReglage, ecrituresRemise, ecrituresRetrait, ecrituresStyle, estDansLaSemaine, exceptionPlat, idsDansLaSemaine,
  jourValide, legendeVersion, libelleStyle, lireSemaine, mangeParDefaut, nouvelleSemaine, peutPreparerLaSuivante,
  phrasePortions, platsAChoisir, platsDeLaSemaine, raisonsEcartes, repasParDefaut, resumePlat, semaineAPreparer,
  semaineEnCours, semaineVisee, statutSemaine, texteConservation, texteDates, texteJour, texteVersionUnique,
  versionServie, semaineSuivante, idReste, restesDeLaSemaine, peutAllerDansLaSemaine, aDesPlats,
} from '../js/coeur/semaine.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const MIEL = regleDuPalier(BAREME_AGE.find((e) => e.code === 'miel'), 0);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [MIEL] };
const PROFILS = [E, B, A]; // dans le désordre exprès : l'ordre d'affichage vient de trierProfils
const B_MANGE_DE_TOUT = { ...B, regles: [] };

const ing = (produit, qte, unite, rayon, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon, marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, rayon, marqueurs = []) => ({ produit, qtePortion, unite, rayon, marqueurs });
const plat = (id, nom, ingredients, extra = {}) => ({
  id, nom, type: 'plat', statutRecette: 'brouillon', portionsBase: 4, ingredients, etapes: ['Cuire.'], ...extra,
});

const PATES = ing('pâtes courtes', 400, 'g', 'epicerie_salee', ['feculent']);
const JAMBON = ing('jambon blanc', 4, 'tranche', 'charcuterie', ['viande', 'porc', 'charcuterie'], { forme: 'fine' });
const CREME = ing('crème fraîche épaisse', 20, 'cl', 'cremerie', ['laitier']);
const GRUYERE = ing('gruyère râpé', 100, 'g', 'fromages', ['laitier']);
const MER = {
  pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['jambon blanc'],
  ajouter: [ajout('thon au naturel', 50, 'g', 'epicerie_salee', ['poisson'])], consigne: 'Part au thon.',
};
const VEGETALE = {
  pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'],
  ajouter: [ajout('tofu fumé', 60, 'g', 'cremerie', ['soja'])], consigne: 'Part au tofu.',
};
const GRATIN = plat('gratin-pates-jambon', 'Gratin de pâtes au jambon', [PATES, JAMBON, CREME, GRUYERE], { variantes: [MER, VEGETALE] });
const GRATIN_SANS_VERSION = plat('gratin-sans-version', 'Gratin sans version', [PATES, JAMBON, CREME, GRUYERE]);
const YAOURT_MIEL = plat('yaourt-miel', 'Yaourt au miel', [ing('yaourt nature', 4, 'pc', 'cremerie', ['laitier']),
  ing('miel', 2, 'cs', 'epicerie_sucree', ['miel'])], { type: 'dessert' });
const TARTE = { id: 'tarte-poireaux', nom: 'Tarte aux poireaux' };
const POELEE = plat('poelee', 'Poêlée de courgettes', [ing('courgette', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'principal' }),
  ing('riz', 150, 'g', 'epicerie_salee', ['feculent'])], {
  portionsBase: 2,
  variantes: [{ pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: [], ajouter: [ajout('saumon', 100, 'g', 'poissonnerie', ['poisson'])], consigne: '' }],
});
const JETE = { ...plat('jete', 'Plat jeté', [PATES]), corbeille: { le: 1, par: 'x@exemple.fr' } };
const TOUS = [GRATIN, GRATIN_SANS_VERSION, YAOURT_MIEL, TARTE, POELEE, JETE];

const T = 1_791_201_600_000; // une heure du téléphone (Date.now())
const S1 = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', creeLe: T, creePar: 'a@exemple.fr' };
const S2 = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', creeLe: T + 6 * 86_400_000 };
const ANCIENNE = { id: '2026-10-01', debut: '2026-10-01', fin: '2026-10-07', creeLe: T - 9 * 86_400_000 };
const avecPlats = (semaine, plats) => ({ ...semaine, plats });
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
/** Semaine suivante avec un plat : elle passe devant (semaineAPreparer). */
const S2P = avecPlats(S2, { curry: dans(T + 6 * 86_400_000) });
const ctx = (extra = {}) => ({ tousLesPlats: TOUS, profils: PROFILS, evaluer, ...extra });
const unPlat = (semaine, extra) => platsDeLaSemaine(semaine, ctx(extra));

/** Gel profond, pour vérifier que rien n'est modifié en entrée. */
function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const v of Object.values(valeur)) geler(v);
  }
  return valeur;
}

// ——— compatibilite.js : exports de T3a ———

test('compatibilite : frigoJoursDe et varianteRetenue exportés (forme des écrans)', () => {
  assert.equal(frigoJoursDe(MER), 2);
  for (const jours of [0, 31, 2.5, '2', null]) assert.equal(frigoJoursDe({ frigoJours: jours }), null, String(jours));
  assert.equal(frigoJoursDe(undefined), null);
  assert.deepEqual(varianteRetenue(MER), {
    source: 'fiche', retirer: ['jambon blanc'], ajouter: MER.ajouter, consigne: 'Part au thon.', style: 'mer', frigoJours: 2,
  });
  assert.deepEqual(varianteRetenue({ pour: 'x', retirer: ['a'], ajouter: [ajout('saumon', 1, 'g', 'poissonnerie', ['poisson'])] }).style, 'mer');
  assert.deepEqual(varianteRetenue(null), { source: 'fiche', retirer: [], ajouter: [], consigne: '', style: 'vegetal' });
  // evaluer rend toujours la même forme qu'avant.
  assert.deepEqual(evaluer(GRATIN, B).variante, varianteRetenue(MER));
});

// ——— Dates ———

test('ajouterJours : fins de mois et d’année, bissextile, en arrière', () => {
  assert.equal(ajouterJours('2026-10-10', 6), '2026-10-16');
  assert.equal(ajouterJours('2026-10-31', 1), '2026-11-01');
  assert.equal(ajouterJours('2026-12-28', 6), '2027-01-03');
  assert.equal(ajouterJours('2028-02-28', 1), '2028-02-29');
  assert.equal(ajouterJours('2027-02-28', 1), '2027-03-01');
  assert.equal(ajouterJours('2026-11-01', -1), '2026-10-31');
  assert.equal(ajouterJours('2026-10-10', 0), '2026-10-10');
});

test('ajouterJours : les deux changements d’heure ne décalent jamais la date', () => {
  assert.equal(ajouterJours('2026-10-24', 1), '2026-10-25');
  assert.equal(ajouterJours('2026-10-25', 1), '2026-10-26');
  assert.equal(ajouterJours('2026-03-28', 2), '2026-03-30');
  assert.equal(ajouterJours('2027-03-27', 7), '2027-04-03');
  // Jour par jour sur deux ans = d'un coup.
  let jour = '2026-01-01';
  for (let i = 0; i < 730; i += 1) jour = ajouterJours(jour, 1);
  assert.equal(jour, ajouterJours('2026-01-01', 730));
  assert.equal(jour, '2028-01-01');
});

test('ajouterJours, jourValide, ecartJours : date ou nombre illisible → null', () => {
  for (const jour of ['2026-02-30', '2026-13-01', '2026-10-1', '10/10/2026', '0999-10-10', '', null, 20261010]) {
    assert.equal(ajouterJours(jour, 1), null, String(jour));
    assert.equal(jourValide(jour), false, String(jour));
  }
  assert.equal(ajouterJours('2026-10-10', 1.5), null);
  assert.equal(ajouterJours('2026-10-10', '1'), null);
  assert.equal(ecartJours('2026-10-10', '2026-10-16'), 6);
  assert.equal(ecartJours('2026-10-16', '2026-10-10'), -6);
  assert.equal(ecartJours('2026-10-24', '2026-10-26'), 2);
  assert.equal(ecartJours('x', '2026-10-10'), null);
});

test('texteDates et texteJour : un mois, deux mois, deux années, un jour, « 1er », jour de la semaine', () => {
  assert.equal(texteDates('2026-10-10', '2026-10-16'), 'du 10 au 16 octobre');
  assert.equal(texteDates('2026-10-28', '2026-11-03'), 'du 28 octobre au 3 novembre');
  assert.equal(texteDates('2026-12-28', '2027-01-03'), 'du 28 décembre 2026 au 3 janvier 2027');
  assert.equal(texteDates('2026-10-10', '2026-10-10'), 'le 10 octobre');
  assert.equal(texteDates('2026-10-01', '2026-10-07'), 'du 1er au 7 octobre');
  assert.equal(texteDates('2026-09-30', '2026-10-01'), 'du 30 septembre au 1er octobre');
  assert.equal(texteDates('x', '2026-10-10'), '');
  assert.equal(texteJour('2026-10-16'), '16 octobre');
  assert.equal(texteJour('2026-10-16', { jourSemaine: true }), 'vendredi 16 octobre');
  assert.equal(texteJour('2026-10-16', { mois: false }), '16');
  assert.equal(texteJour('2026-10-01', { mois: false }), '1er');
  assert.equal(texteJour('2026-08-15', { annee: true }), '15 août 2026');
  assert.equal(texteJour('2026-10-11', { jourSemaine: true }), 'dimanche 11 octobre');
  assert.equal(texteJour('2026-02-30'), '');
});

// ——— Lire les semaines ———

test('lireSemaine : copie propre, défauts, statut absent ; l’entrée n’est jamais modifiée', () => {
  const doc = geler({ ...S1, statut: 'courses_faites', plats: { gratin: dans(1) } });
  const lue = lireSemaine(doc);
  assert.notEqual(lue, doc);
  assert.equal(lue.id, '2026-10-10');
  assert.deepEqual(lue.plats, { gratin: { ajouteLe: 1 } });
  assert.deepEqual(lue.coches, {});
  assert.deepEqual(lue.racheter, {});
  assert.equal(lue.creeLe, T);
  assert.equal(lue.statut, 'courses_faites');
  assert.equal(statutSemaine(lue), 'courses_faites');
  const sansStatut = lireSemaine({ id: 'x-1', debut: '2026-10-10', fin: '2026-10-10', statut: 'inconnu', creeLe: 'hier' });
  assert.equal('statut' in sansStatut, false);
  assert.equal(statutSemaine(sansStatut), 'brouillon');
  assert.equal(sansStatut.creeLe, null);
  // Lire une semaine lue rend la même chose.
  assert.deepEqual(lireSemaine(lue), lue);
});

test('lireSemaine : dates illisibles, fin avant le début, plus de 14 jours, identifiant hors chemin sûr → null', () => {
  assert.ok(lireSemaine({ id: 'a', debut: '2026-10-01', fin: '2026-10-14' }), '14 jours : permis');
  assert.equal(DUREE_MAX_JOURS, 14);
  for (const doc of [
    { id: 'a', debut: '2026-10-01', fin: '2026-10-15' },
    { id: 'a', debut: '2026-10-16', fin: '2026-10-10' },
    { id: 'a', debut: '2026-02-30', fin: '2026-03-02' },
    { id: 'a', debut: '2026-10-10' },
    { id: 'A', debut: '2026-10-10', fin: '2026-10-11' },
    { id: 'a.b', debut: '2026-10-10', fin: '2026-10-11' },
    { debut: '2026-10-10', fin: '2026-10-11' },
    null, [], 'semaine',
  ]) assert.equal(lireSemaine(doc), null, JSON.stringify(doc));
});

test('semaineAPreparer : la plus récente qui n’est pas finie ; passée, en cours, suivante, chevauchement', () => {
  assert.equal(semaineAPreparer([], '2026-10-12'), null);
  assert.equal(semaineAPreparer([ANCIENNE], '2026-10-12'), null, 'passée');
  assert.equal(semaineAPreparer([ANCIENNE, S1], '2026-10-12').id, '2026-10-10', 'en cours');
  assert.equal(semaineAPreparer([S1], '2026-10-16').id, '2026-10-10', 'dernier jour compris');
  assert.equal(semaineAPreparer([S1], '2026-10-17'), null);
  assert.equal(semaineAPreparer([S2P, S1], '2026-10-15').id, '2026-10-17', 'la suivante, avec un plat, passe devant');
  assert.equal(semaineAPreparer([S1, S2], '2026-10-20').id, '2026-10-17');
  // Suivante sans plat (vidée par « Annuler » ou une case décochée) : la semaine en cours reste montrée.
  assert.equal(semaineAPreparer([S2, S1], '2026-10-15').id, '2026-10-10', 'suivante sans plat');
  assert.equal(semaineAPreparer([avecPlats(S2, { curry: dans(1, { retire: true }) }), S1], '2026-10-16').id, '2026-10-10', 'seul plat retiré');
  assert.equal(semaineAPreparer([avecPlats(S2, { jete: dans(1) }), S1], '2026-10-16').id, '2026-10-17', 'un plat de la corbeille compte');
  // Une fois commencée, une semaine sans plat est montrée (la semaine du jour).
  assert.equal(semaineAPreparer([S1, S2], '2026-10-17').id, '2026-10-17');
  // Deux semaines qui se chevauchent (créations hors ligne à deux jours différents) : la plus récente.
  const decalee = { id: '2026-10-12', debut: '2026-10-12', fin: '2026-10-18', creeLe: T };
  assert.equal(semaineAPreparer([S1, decalee], '2026-10-13').id, '2026-10-12');
  // Même début (dates changées) : la plus récemment créée.
  const memeDebut = { id: '2026-10-10-2', debut: '2026-10-10', fin: '2026-10-16', creeLe: T + 1 };
  assert.equal(semaineAPreparer([memeDebut, S1], '2026-10-13').id, '2026-10-10-2');
  // Documents illisibles ignorés ; date du jour illisible → null.
  assert.equal(semaineAPreparer([{ id: 'x', debut: 'x', fin: 'y' }, S1], '2026-10-13').id, '2026-10-10');
  assert.equal(semaineAPreparer([S1], 'demain'), null);
});

test('semaineEnCours : la semaine qui contient aujourd’hui quand la suivante est montrée ; null sinon', () => {
  assert.equal(semaineEnCours([S1, S2P], '2026-10-16').id, '2026-10-10');
  assert.equal(semaineEnCours([S1, S2P], '2026-10-17'), null, 'la semaine montrée a commencé');
  assert.equal(semaineEnCours([S1, S2], '2026-10-16'), null, 'suivante sans plat : pas montrée');
  assert.equal(semaineEnCours([S1], '2026-10-12'), null);
  assert.equal(semaineEnCours([], '2026-10-12'), null);
});

test('nouvelleSemaine : du jour à + 6 ; après la semaine affichée ; identifiant pris → -2, -3', () => {
  assert.deepEqual(nouvelleSemaine([], '2026-10-10'), { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16' });
  assert.deepEqual(nouvelleSemaine([S1], '2026-10-15', { apres: S1 }), { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' });
  // Semaine affichée déjà passée : jamais avant aujourd'hui.
  assert.deepEqual(nouvelleSemaine([ANCIENNE], '2026-10-12', { apres: ANCIENNE }), { id: '2026-10-12', debut: '2026-10-12', fin: '2026-10-18' });
  // Identifiant déjà porté par un document (dates changées ailleurs, ou document illisible) : suffixe.
  const pris = [{ id: '2026-10-17', debut: '2026-10-20', fin: '2026-10-22' }, { id: '2026-10-17-2' }];
  assert.equal(nouvelleSemaine(pris, '2026-10-17').id, '2026-10-17-3');
  assert.equal(nouvelleSemaine([], 'x'), null);
});

test('peutPreparerLaSuivante : fin aujourd’hui, demain, après-demain → vrai ; dans 3 jours ou passée → faux', () => {
  assert.equal(peutPreparerLaSuivante(S1, '2026-10-16'), true);
  assert.equal(peutPreparerLaSuivante(S1, '2026-10-15'), true);
  assert.equal(peutPreparerLaSuivante(S1, '2026-10-14'), true);
  assert.equal(peutPreparerLaSuivante(S1, '2026-10-13'), false);
  assert.equal(peutPreparerLaSuivante(S1, '2026-10-17'), false);
  // Jamais pour la seule raison que les courses sont faites.
  assert.equal(peutPreparerLaSuivante({ ...S1, statut: 'courses_faites' }, '2026-10-11'), false);
  assert.equal(peutPreparerLaSuivante(null, '2026-10-16'), false);
  assert.equal(peutPreparerLaSuivante(S1, null), false);
});

test('semaineVisee : aucune semaine → du jour à J+6 ; plus de 2 jours avant la fin → la semaine montrée', () => {
  assert.deepEqual(semaineVisee([], '2026-10-10'), { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', nouvelle: true, autre: null });
  assert.deepEqual(semaineVisee([ANCIENNE], '2026-10-10'), { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', nouvelle: true, autre: null });
  assert.deepEqual(semaineVisee([S1], '2026-10-13'), { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', nouvelle: false, autre: null });
  assert.equal(semaineVisee([S1], 'x'), null);
});

test('semaineVisee : les deux derniers jours → la semaine suivante (nouvelle), et la semaine qui finit en « autre »', () => {
  for (const jour of ['2026-10-14', '2026-10-15', '2026-10-16']) {
    assert.deepEqual(semaineVisee([S1], jour), {
      id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', nouvelle: true,
      autre: { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16' },
    }, jour);
  }
});

test('semaineVisee : semaine suivante déjà là → elle (pas nouvelle), la semaine qui finit en « autre »', () => {
  assert.deepEqual(semaineVisee([S1, S2P], '2026-10-16'), {
    id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', nouvelle: false,
    autre: { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16' },
  });
  assert.deepEqual(semaineVisee([S1, S2P], '2026-10-18').autre, null);
});

test('semaineVisee : semaine suivante vidée (« Annuler ») → reprise telle quelle (même identifiant, sans plat : nouvelle)', () => {
  for (const vide of [S2, avecPlats(S2, { curry: dans(1, { retire: true }) })]) {
    assert.deepEqual(semaineVisee([S1, vide], '2026-10-16'), {
      id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', nouvelle: true,
      autre: { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16' },
    });
  }
  assert.deepEqual(semaineSuivante([S1, S2], '2026-10-16', S1), { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' });
  assert.deepEqual(semaineSuivante([S1], '2026-10-16', S1), { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' });
  // Un document qui porte l'identifiant à d'autres dates : nouvelle semaine « -2 ».
  assert.equal(semaineSuivante([S1, { id: '2026-10-17', debut: '2026-10-18', fin: '2026-10-20' }], '2026-10-16', S1).id, '2026-10-17-2');
});

// ——— Chemins et champs ———

test('cheminSur : clés `^[a-z0-9-]+$` seulement', () => {
  assert.equal(cheminSur('plats', 'gratin', 'styles', 'profil-b'), 'plats.gratin.styles.profil-b');
  assert.equal(cheminSur('coches', 'pate--pa3te'), 'coches.pate--pa3te');
  for (const cle of ['a.b', 'a/b', '', 'Gratin', 'gratin ', '__proto__', 'é', null, 3, undefined]) {
    assert.equal(cheminSur('plats', cle), null, String(cle));
  }
  assert.equal(cheminSur(), null);
});

test('appliquerChamps : chemins pointés appliqués sur une copie ; EFFACER retire ; l’original reste intact', () => {
  const semaine = geler(avecPlats(S1, { gratin: dans(1, { styles: { 'profil-b': 'vegetal' }, repas: 3 }) }));
  const copie = appliquerChamps(semaine, {
    'plats.gratin.styles.profil-b': EFFACER, 'plats.gratin.repas': 4, 'plats.salade.ajouteLe': 2, 'coches.pate': { q: { masse: 600 }, le: 5 },
  });
  assert.deepEqual(copie.plats, { gratin: { ajouteLe: 1, styles: {}, repas: 4 }, salade: { ajouteLe: 2 } });
  assert.deepEqual(copie.coches, { pate: { q: { masse: 600 }, le: 5 } });
  assert.deepEqual(semaine.plats.gratin, { ajouteLe: 1, styles: { 'profil-b': 'vegetal' }, repas: 3 });
  assert.deepEqual(appliquerChamps(null, { debut: '2026-10-10' }), { debut: '2026-10-10' });
  // Chemin illisible ignoré, jamais de pollution de prototype.
  const sure = appliquerChamps({}, { '__proto__.x': 1, 'a..b': 2, 'a.b': 3 });
  assert.deepEqual(sure, { a: { b: 3 } });
  assert.equal(({}).x, undefined);
  assert.ok(Object.isFrozen(EFFACER));
});

test('champsValides : chemins sûrs, ni undefined, ni NaN, ni tableau vide', () => {
  assert.equal(champsValides({ 'plats.gratin.ajouteLe': 1, 'plats.gratin.retire': EFFACER, 'coches.pate': { q: { masse: 1 }, le: 2 } }), true);
  for (const champs of [
    { 'plats.gratin.ajouteLe': undefined }, { 'plats.gratin.repas': Number.NaN }, { 'plats.gratin.liste': [] },
    { 'plats..repas': 1 }, { 'plats.__proto__.x': 1 }, { 'plats.gratin': { a: undefined } }, { 'a b': 1 }, null, [],
  ]) assert.equal(champsValides(champs), false, JSON.stringify(champs));
});

// ——— Qui en mange, version servie ———

test('mangeParDefaut : tout le monde ; sans version → « version » ; miel → « âge » ; « Jamais » ; plat ⏳', () => {
  for (const profil of [A, B, E]) assert.deepEqual(mangeParDefaut(GRATIN, profil, { evaluer }), { mange: true, raison: null }, profil.id);
  assert.deepEqual(mangeParDefaut(GRATIN_SANS_VERSION, B, { evaluer }), { mange: false, raison: 'version' });
  const enfant = mangeParDefaut(YAOURT_MIEL, E, { evaluer });
  assert.equal(enfant.mange, false);
  assert.equal(enfant.raison, 'age');
  assert.deepEqual(enfant.precautions.map((p) => [p.code, p.severite]), [['miel', 'exclu']]);
  const jamais = { ...GRATIN, notes: { 'profil-a': 0, enfant: 5 } };
  assert.deepEqual(mangeParDefaut(jamais, A, { evaluer }), { mange: false, raison: 'jamais' });
  assert.deepEqual(mangeParDefaut(jamais, E, { evaluer }), { mange: true, raison: null });
  assert.deepEqual(mangeParDefaut(TARTE, B, { evaluer }), { mange: true, raison: null }, 'plat ⏳ : tout le monde');
  assert.deepEqual(mangeParDefaut({ ...TARTE, notes: { 'profil-b': 0 } }, B), { mange: false, raison: 'jamais' });
  // « Jamais » passe avant la version.
  assert.equal(mangeParDefaut({ ...GRATIN_SANS_VERSION, notes: { 'profil-b': 0 } }, B).raison, 'jamais');
});

test('mangeParDefaut : précaution d’âge jugée sur le plat tel qu’il est servi (la version de l’enfant)', () => {
  const enfantSansViande = { ...E, regles: [...SANS_VIANDE, MIEL] };
  const curry = plat('curry', 'Curry de poulet', [
    ing('blanc de poulet', 400, 'g', 'boucherie', ['viande', 'volaille'], { forme: 'morceaux' }),
    ing('lait de coco', 40, 'cl', 'epicerie_salee'),
  ], {
    variantes: [
      { pour: 'enfant', style: 'vegetal', retirer: ['blanc de poulet'], ajouter: [ajout('pois chiches', 60, 'g', 'epicerie_salee', ['feculent']), ajout('miel', 0.5, 'cs', 'epicerie_sucree', ['miel'])] },
    ],
  });
  const resultat = mangeParDefaut(curry, enfantSansViande, { evaluer });
  assert.equal(resultat.raison, 'age');
  assert.deepEqual(resultat.precautions[0].produits, ['miel']);
  // La recette seule n'a pas de miel : sans la version, il en mangerait.
  assert.equal(mangeParDefaut({ ...curry, variantes: [] }, enfantSansViande).raison, 'version');
});

test('versionServie : la mer d’avance ; le style choisi s’il convient encore ; une seule version ; aucune', () => {
  const mer = versionServie(GRATIN, B, null, evaluer);
  assert.deepEqual(mer, { variante: varianteRetenue(MER), style: 'mer', frigoJours: 2, auChoix: ['mer', 'vegetal'], nomme: true });
  const vegetale = versionServie(GRATIN, B, 'vegetal', evaluer);
  assert.equal(vegetale.style, 'vegetal');
  assert.equal(vegetale.frigoJours, null);
  assert.deepEqual(vegetale.variante.ajouter.map((a) => a.produit), ['tofu fumé']);
  // Choix périmé (la version végétale a été supprimée) : retour à la mer, sans écriture.
  const seuleMer = { ...GRATIN, variantes: [MER] };
  assert.deepEqual(versionServie(seuleMer, B, 'vegetal', evaluer), { variante: varianteRetenue(MER), style: 'mer', frigoJours: 2, auChoix: ['mer'], nomme: true });
  // Une seule version, végétale : servie quel que soit le choix.
  assert.equal(versionServie({ ...GRATIN, variantes: [VEGETALE] }, B, 'mer').style, 'vegetal');
  // Choix inconnu : la mer.
  assert.equal(versionServie(GRATIN, B, 'poisson').style, 'mer');
  // Aucune version qui convient, ou plat sans recette : null.
  assert.equal(versionServie(GRATIN_SANS_VERSION, B), null);
  assert.equal(versionServie(TARTE, B), null);
  // Un profil qui mange la recette : jamais de version servie.
  assert.equal(versionServie(GRATIN, A), null);
});

test('versionServie : un profil sans styles (« pas de tomate ») a « sa version », jamais un style déduit affiché', () => {
  const SANS_TOMATE = { ...A, regles: [{ type: 'exclureProduits', produits: ['tomate'], severite: 'exclu' }] };
  const TOMATE = ing('tomate', 4, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' });
  const salade = plat('salade', 'Salade de pâtes', [PATES, TOMATE], {
    variantes: [{ pour: 'profil-a', retirer: ['tomate'], ajouter: [ajout('concombre', 0.25, 'pc', 'fruits_legumes', ['legume'])], consigne: '', frigoJours: 1 }],
  });
  const servie = versionServie(salade, SANS_TOMATE, null, evaluer);
  assert.equal(servie.style, 'vegetal', 'style déduit, pour le choix seulement');
  assert.equal(servie.nomme, false);
  const [element] = platsDeLaSemaine(avecPlats(S1, { salade: dans(1) }), ctx({ tousLesPlats: [salade], profils: [SANS_TOMATE] }));
  assert.equal(texteVersionUnique(element.versions[0], { moi: SANS_TOMATE }), '', 'rien sur la carte');
  assert.equal(element.conservation.limite.style, null);
  assert.equal(texteConservation(element, { moi: SANS_TOMATE }), 'Votre part se garde 1\u00A0jour après cuisson (le plat\u00A0: 3).');
  // Un style écrit sur la version reste nommé, même sans styles attendus.
  const ecrit = { ...salade, variantes: [{ ...salade.variantes[0], style: 'vegetal' }] };
  assert.equal(versionServie(ecrit, SANS_TOMATE, null, evaluer).nomme, true);
});

test('versionServie : profil passé à « Mange de tout » ou recette sans viande → la recette, même avec d’anciennes versions', () => {
  assert.equal(versionServie(GRATIN, B_MANGE_DE_TOUT, 'vegetal', evaluer), null);
  assert.equal(versionServie(POELEE, B, 'mer', evaluer), null);
  assert.deepEqual(mangeParDefaut(POELEE, B), { mange: true, raison: null });
});

test('repasParDefaut : la recette pour le foyer, arrondie au repas, de 1 à 14', () => {
  assert.equal(repasParDefaut(GRATIN, 2.5), 2); // 1,6
  assert.equal(repasParDefaut(GRATIN, 1.5), 3); // 2,67
  assert.equal(repasParDefaut(GRATIN, 2), 2);
  assert.equal(repasParDefaut({ portionsBase: 5 }, 2), 3); // 2,5 → 3
  assert.equal(repasParDefaut({ portionsBase: 40 }, 0.5), REPAS_MAX);
  assert.equal(repasParDefaut({ portionsBase: 1 }, 10), 1);
  assert.equal(repasParDefaut(TARTE, 2.5), 1, 'sans portionsBase');
  assert.equal(repasParDefaut({ portionsBase: '4' }, 2), 1);
  assert.equal(repasParDefaut(GRATIN, 0), 1, 'personne n’en mange');
  assert.equal(repasParDefaut(GRATIN, null), 1);
});

test('coefDe : portion du profil, 1 si illisible', () => {
  assert.equal(coefDe(E), 0.5);
  assert.equal(coefDe(A), 1);
  for (const coef of [undefined, 0, -1, '0,5', Number.NaN]) assert.equal(coefDe({ coefPortion: coef }), 1, String(coef));
});

// ——— Plats de la semaine ———

test('platsDeLaSemaine : gratin pour tout le monde (2,5 parts), 2 repas, 5 portions ; version mer de B au choix', () => {
  const [gratin] = unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1) }));
  assert.equal(gratin.etat, 'ok');
  assert.equal(gratin.plat, GRATIN);
  assert.deepEqual(gratin.mangeurs.map((m) => [m.profil.id, m.mange, m.parDefaut, m.raison]),
    [['profil-a', true, true, null], ['profil-b', true, true, null], ['enfant', true, true, null]]);
  assert.equal(gratin.parRepasFoyer, 2.5);
  assert.equal(gratin.parRepas, 2.5);
  assert.equal(gratin.repasParDefaut, 2);
  assert.equal(gratin.repas, 2);
  assert.equal(gratin.repasTouche, false);
  assert.equal(gratin.aCuire, 5);
  assert.equal(gratin.aCongeler, 0);
  assert.deepEqual(gratin.versions.map((v) => [v.profil.id, v.style, v.frigoJours, v.auChoix]), [['profil-b', 'mer', 2, ['mer', 'vegetal']]]);
  assert.deepEqual(gratin.conservation, { jours: 3, limite: { profil: B, style: 'mer', jours: 2 } });
});

test('platsDeLaSemaine : sans version pour B, B ne mange pas : 1,5 part, 3 repas, 4,5 portions', () => {
  const [gratin] = unPlat(avecPlats(S1, { 'gratin-sans-version': dans(1) }));
  assert.deepEqual(gratin.mangeurs.map((m) => [m.profil.id, m.mange, m.raison]), [['profil-a', true, null], ['profil-b', false, 'version'], ['enfant', true, null]]);
  assert.equal(gratin.parRepas, 1.5);
  assert.equal(gratin.repas, 3);
  assert.equal(gratin.aCuire, 4.5);
  assert.deepEqual(gratin.versions, []);
  assert.deepEqual(gratin.conservation, { jours: 3, limite: null });
});

test('platsDeLaSemaine : miel → enfant écarté (âge) ; « Jamais » → A écarté ; plat ⏳ : tout le monde, aucune version', () => {
  const semaine = avecPlats(S1, { 'yaourt-miel': dans(1), 'tarte-poireaux': dans(2) });
  const [yaourt, tarte] = unPlat(semaine);
  assert.deepEqual(yaourt.mangeurs.map((m) => [m.profil.id, m.mange, m.raison]), [['profil-a', true, null], ['profil-b', true, null], ['enfant', false, 'age']]);
  assert.equal(yaourt.mangeurs[2].precautions[0].code, 'miel');
  assert.equal(yaourt.aCuire, 4);
  assert.equal(tarte.etat, 'sansRecette');
  assert.ok(tarte.mangeurs.every((m) => m.mange));
  assert.equal(tarte.repas, 1);
  assert.deepEqual(tarte.versions, []);
  const jamais = platsDeLaSemaine(avecPlats(S1, { 'gratin-pates-jambon': dans(1) }), ctx({ tousLesPlats: [{ ...GRATIN, notes: { 'profil-a': 0 } }] }));
  assert.deepEqual(jamais[0].mangeurs.map((m) => m.raison), ['jamais', null, null]);
  assert.equal(jamais[0].parRepas, 1.5);
});

test('platsDeLaSemaine : ordre d’ajout puis identifiant ; retirés, sans ajouteLe, clés illisibles ignorés', () => {
  const semaine = avecPlats(S1, {
    poelee: dans(5), 'gratin-pates-jambon': dans(2), 'yaourt-miel': dans(2), 'tarte-poireaux': dans(1, { retire: true }),
    'gratin-sans-version': { repas: 3 }, 'Plat.Faux': dans(0), jete: dans('3'),
  });
  assert.deepEqual(unPlat(semaine).map((p) => p.platId), ['gratin-pates-jambon', 'yaourt-miel', 'poelee']);
  // `retire: false` ou absent : dans la semaine.
  assert.deepEqual(unPlat(avecPlats(S1, { poelee: dans(1, { retire: false }) })).map((p) => p.platId), ['poelee']);
  assert.deepEqual(unPlat({ ...S1, plats: null }), []);
  assert.deepEqual(unPlat(null), []);
});

test('platsDeLaSemaine : plat de la corbeille ou introuvable : aucune portion ; remis, il revient avec ses réglages', () => {
  const semaine = avecPlats(S1, { jete: dans(1, { repas: 4 }), disparu: dans(2) });
  const [jete, disparu] = unPlat(semaine);
  assert.equal(jete.etat, 'corbeille');
  assert.equal(jete.plat, JETE);
  assert.equal(disparu.etat, 'absent');
  assert.equal(disparu.plat, null);
  for (const p of [jete, disparu]) {
    assert.deepEqual([p.aCuire, p.aCongeler, p.repas, p.mangeurs.length, p.versions.length, p.conservation], [0, 0, 0, 0, 0, null]);
  }
  const remis = platsDeLaSemaine(semaine, ctx({ tousLesPlats: [{ ...JETE, corbeille: undefined }] }));
  assert.equal(remis[0].etat, 'ok');
  assert.equal(remis[0].repas, 4);
});

test('platsDeLaSemaine : style choisi « vegetal », puis version végétale supprimée → retour à la mer, sans écriture', () => {
  const semaine = avecPlats(S1, { 'gratin-pates-jambon': dans(1, { styles: { 'profil-b': 'vegetal' } }) });
  assert.equal(unPlat(semaine)[0].versions[0].style, 'vegetal');
  assert.deepEqual(unPlat(semaine)[0].conservation.limite, null, 'la part végétale se garde comme le plat');
  const sansVegetale = platsDeLaSemaine(semaine, ctx({ tousLesPlats: [{ ...GRATIN, variantes: [MER] }] }));
  assert.equal(sansVegetale[0].versions[0].style, 'mer');
  assert.equal(semaine.plats['gratin-pates-jambon'].styles['profil-b'], 'vegetal', 'rien n’est écrit');
});

test('platsDeLaSemaine : un invité ajoute des portions, sans jamais retirer de repas (repas touché ou non)', () => {
  const base = unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1) }))[0];
  const invite = unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1, { invites: { adultes: 1, enfants: 0 } }) }))[0];
  assert.equal(invite.repas, 2);
  assert.equal(invite.parRepasFoyer, 2.5);
  assert.equal(invite.parRepas, 3.5);
  assert.equal(invite.aCuire, 7);
  for (let adultes = 0; adultes <= INVITES_MAX; adultes += 1) {
    for (const repas of [undefined, 1, 3]) {
      const p = unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1, { repas, invites: { adultes, enfants: adultes % 3 } }) }))[0];
      const sansInvite = unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1, { repas }) }))[0];
      assert.ok(p.repas >= sansInvite.repas && p.aCuire >= sansInvite.aCuire, `${adultes} ${repas}`);
    }
  }
  assert.equal(base.aCuire, 5);
  const bornes = unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1, { invites: { adultes: 99, enfants: -3 } }) }))[0];
  assert.deepEqual(bornes.invites, { adultes: INVITES_MAX, enfants: 0 });
});

test('platsDeLaSemaine : repas écrit (borné de 1 à 14), portions à congeler lues ; mange écrit (T3c)', () => {
  const lire = (entree) => unPlat(avecPlats(S1, { 'gratin-pates-jambon': dans(1, entree) }))[0];
  assert.deepEqual([lire({ repas: 3 }).repas, lire({ repas: 3 }).repasTouche, lire({ repas: 3 }).aCuire], [3, true, 7.5]);
  assert.equal(lire({ repas: 0 }).repas, 1);
  assert.equal(lire({ repas: 20 }).repas, REPAS_MAX);
  assert.equal(lire({ repas: 2.6 }).repas, 3);
  assert.equal(lire({ repas: '3' }).repas, 2, 'illisible : le défaut');
  assert.equal(lire({ portionsACongeler: 2 }).aCongeler, 2);
  assert.equal(lire({ portionsACongeler: -1 }).aCongeler, 0);
  const sansA = lire({ mange: { 'profil-a': false } });
  assert.deepEqual(sansA.mangeurs.map((m) => [m.mange, m.parDefaut]), [[false, true], [true, true], [true, true]]);
  assert.equal(sansA.parRepas, 1.5);
  const avecB = unPlat(avecPlats(S1, { 'gratin-sans-version': dans(1, { mange: { 'profil-b': true } }) }))[0];
  assert.deepEqual(avecB.mangeurs[1], { profil: B, mange: true, parDefaut: false, raison: 'version' });
  assert.deepEqual(avecB.versions, [], 'il mange la recette telle quelle');
});

test('platsDeLaSemaine : conservation (fiche, réglage du foyer, 3 par défaut) et part la plus fragile', () => {
  const lire = (plat, reglages = null) => platsDeLaSemaine(avecPlats(S1, { [plat.id]: dans(1) }), ctx({ tousLesPlats: [plat], reglages }))[0].conservation;
  assert.deepEqual(lire({ ...GRATIN, conservation: { frigoJours: 4, congelable: true } }).jours, 4);
  assert.deepEqual(lire(GRATIN, { frigoJoursDefaut: 5 }).jours, 5);
  assert.deepEqual(lire(GRATIN, { frigoJoursDefaut: 'x' }).jours, 3);
  assert.deepEqual(lire({ ...GRATIN, conservation: { frigoJours: 2 } }).limite, null, 'la version tient aussi longtemps que le plat');
  assert.deepEqual(lire({ ...GRATIN, variantes: [{ ...MER, frigoJours: 1 }, VEGETALE] }).limite, { profil: B, style: 'mer', jours: 1 });
});

test('platsDeLaSemaine : profils sans identifiant ignorés ; entrées gelées jamais modifiées', () => {
  const semaine = geler(avecPlats(S1, { 'gratin-pates-jambon': dans(1, { styles: { 'profil-b': 'vegetal' }, repas: 2 }) }));
  const plats = geler(structuredClone(TOUS));
  const profils = geler([...structuredClone(PROFILS), { nom: 'Sans id' }, null]);
  const resultat = platsDeLaSemaine(semaine, { tousLesPlats: plats, profils, evaluer });
  assert.equal(resultat[0].mangeurs.length, 3);
});

test('estDansLaSemaine et idsDansLaSemaine (pastille « Au menu ») : ajouteLe nombre, pas retiré', () => {
  assert.equal(estDansLaSemaine({ ajouteLe: 1 }), true);
  assert.equal(estDansLaSemaine({ ajouteLe: 1, retire: true }), false);
  assert.equal(estDansLaSemaine({ repas: 3 }), false);
  assert.equal(estDansLaSemaine(null), false);
  assert.deepEqual([...idsDansLaSemaine(avecPlats(S1, { a: dans(1), b: dans(2, { retire: true }), jete: dans(3), 'X.y': dans(4) }))].sort(), ['a', 'jete']);
  assert.equal(idsDansLaSemaine(null).size, 0);
});

// ——— Écritures ———

const OPTIONS_AJOUT = { semainesChargees: true, aujourdhui: '2026-10-10', auteur: 'a@exemple.fr', maintenant: T };

test('ecrituresAjout : premier plat → la semaine naît dans le même lot ({ debut, fin, creePar, creeLe }, jamais de statut)', () => {
  const ecritures = ecrituresAjout([], 'gratin-pates-jambon', OPTIONS_AJOUT);
  assert.deepEqual(ecritures, {
    id: '2026-10-10',
    creation: { id: '2026-10-10', donnees: { debut: '2026-10-10', fin: '2026-10-16', creePar: 'a@exemple.fr', creeLe: T } },
    champs: { 'plats.gratin-pates-jambon.ajouteLe': T, 'plats.gratin-pates-jambon.retire': EFFACER },
  });
  assert.equal('statut' in ecritures.creation.donnees, false);
  assert.ok(champsValides(ecritures.champs) && champsValides(ecritures.creation.donnees));
  // Sans auteur : pas de creePar (jamais de valeur undefined).
  assert.deepEqual(Object.keys(ecrituresAjout([], 'gratin', { ...OPTIONS_AJOUT, auteur: null }).creation.donnees), ['debut', 'fin', 'creeLe']);
});

test('ecrituresAjout : semaines pas encore lues → « chargement », jamais de nouvelle semaine', () => {
  assert.deepEqual(ecrituresAjout([], 'gratin', { ...OPTIONS_AJOUT, semainesChargees: false }), { code: 'chargement' });
  assert.deepEqual(ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, semainesChargees: undefined, cible: semaineVisee([S1], '2026-10-12') }), { code: 'chargement' });
  assert.deepEqual(ecrituresAjout([], 'gratin'), { code: 'chargement' });
});

test('ecrituresAjout : la cible figée par l’écran est respectée, même si une autre semaine est apparue entre-temps', () => {
  const cible = semaineVisee([S1], '2026-10-16'); // la feuille s'ouvre : semaine du 17 au 23, à créer
  // Pendant ce temps, l'autre téléphone crée une semaine qui commence le 18 : le plat va quand même au 17-23.
  const autre = { id: '2026-10-18', debut: '2026-10-18', fin: '2026-10-24', creeLe: T };
  const ecritures = ecrituresAjout([S1, autre], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-16', cible });
  assert.equal(ecritures.id, '2026-10-17');
  assert.deepEqual(ecritures.creation.donnees, { debut: '2026-10-17', fin: '2026-10-23', creePar: 'a@exemple.fr', creeLe: T });
  // « Ajouter plutôt à la semaine qui finit le 16 » : la cible devient l'autre semaine, qui existe déjà.
  const plutot = ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-16', cible: cible.autre });
  assert.deepEqual(plutot, { id: '2026-10-10', champs: { 'plats.gratin.ajouteLe': T, 'plats.gratin.retire': EFFACER } });
  // Sans cible donnée : semaineVisee du moment.
  assert.equal(ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-15' }).id, '2026-10-17');
  assert.equal(ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-12' }).id, '2026-10-10');
});

test('ecrituresAjout : semaine déjà créée (l’autre téléphone, ou un premier plat) → pas de création, pas de restes', () => {
  const cible = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', nouvelle: true, autre: null };
  const restes = [{ libelle: 'beurre', precision: '30 g', produitId: 'beurre' }];
  const ecritures = ecrituresAjout([S1, S2P], 'gratin', { ...OPTIONS_AJOUT, cible, restes });
  assert.deepEqual(ecritures, { id: '2026-10-17', champs: { 'plats.gratin.ajouteLe': T, 'plats.gratin.retire': EFFACER } });
  // Créée mais vidée depuis : pas de nouvelle création, mais les restes la suivent (mêmes identifiants).
  const vide = ecrituresAjout([S1, avecPlats(S2, { curry: dans(1, { retire: true }) })], 'gratin', { ...OPTIONS_AJOUT, cible, restes });
  assert.deepEqual(vide, {
    id: '2026-10-17', champs: { 'plats.gratin.ajouteLe': T, 'plats.gratin.retire': EFFACER },
    articles: [{ id: 'reste--2026-10-17--beurre', libelle: 'beurre', precision: '30 g', creePar: 'a@exemple.fr', creeLe: T }],
  });
});

test('ecrituresAjout : deux téléphones qui créent la même semaine écrivent les mêmes articles des restes', () => {
  const cible = semaineVisee([S1], '2026-10-16');
  const restes = [{ libelle: 'beurre', precision: '30 g', produitId: 'beurre' }, { libelle: 'sel', precision: '1 pincée', produitId: 'sel' }];
  const a = ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-16', cible, restes });
  const b = ecrituresAjout([S1], 'curry', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-16', cible, restes, auteur: 'b@exemple.fr', maintenant: T + 5 });
  assert.equal(a.creation.id, b.creation.id);
  assert.deepEqual(a.articles.map((x) => x.id), ['reste--2026-10-17--beurre', 'reste--2026-10-17--sel']);
  assert.deepEqual(b.articles.map((x) => x.id), a.articles.map((x) => x.id));
  assert.equal(idReste('2026-10-17', 'pate--pa3te1'), 'reste--2026-10-17--pate--pa3te1');
  assert.equal(idReste('2026-10-17', 'a.b'), '');
  assert.equal(idReste(null, 'beurre'), '');
});

test('ecrituresAjout : les restes gardés deviennent des articles du lot qui crée la semaine', () => {
  const cible = semaineVisee([S1], '2026-10-16');
  const restes = [{ libelle: ' beurre ', precision: '30\u00A0g', produitId: 'beurre' }, { libelle: 'sel', precision: '', produitId: 'sel' },
    { libelle: '  ' }, null, { libelle: 'x'.repeat(70), precision: 'y'.repeat(50) },
    { libelle: 'beurre doux', precision: '10 g', produitId: 'beurre' }];
  const { articles } = ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-16', cible, restes });
  assert.deepEqual(articles, [
    { id: 'reste--2026-10-17--beurre', libelle: 'beurre', precision: '30\u00A0g', creePar: 'a@exemple.fr', creeLe: T },
    { id: 'reste--2026-10-17--sel', libelle: 'sel', creePar: 'a@exemple.fr', creeLe: T },
    { libelle: 'x'.repeat(60), precision: 'y'.repeat(40), creePar: 'a@exemple.fr', creeLe: T },
  ], 'un produit une fois ; sans produit lisible, identifiant tiré par donnees.js');
  assert.equal('articles' in ecrituresAjout([S1], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-16', cible, restes: [] }), false);
});

test('ecrituresAjout : déjà dans la semaine → « deja » ; retiré → remis (ajouteLe neuf, retire effacé, réglages gardés)', () => {
  const semaine = avecPlats(S1, { gratin: dans(1), salade: dans(2, { retire: true, repas: 4 }) });
  assert.deepEqual(ecrituresAjout([semaine], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-12' }), { code: 'deja', id: '2026-10-10' });
  assert.deepEqual(ecrituresAjout([semaine], 'salade', { ...OPTIONS_AJOUT, aujourdhui: '2026-10-12' }),
    { id: '2026-10-10', champs: { 'plats.salade.ajouteLe': T, 'plats.salade.retire': EFFACER } });
});

test('ecrituresAjout : identifiant, heure ou cible illisibles → « invalide » (rien n’est envoyé)', () => {
  for (const platId of ['Gratin', 'a.b', '', null]) assert.deepEqual(ecrituresAjout([], platId, OPTIONS_AJOUT), { code: 'invalide' }, String(platId));
  assert.deepEqual(ecrituresAjout([], 'gratin', { ...OPTIONS_AJOUT, maintenant: null }), { code: 'invalide' });
  assert.deepEqual(ecrituresAjout([], 'gratin', { ...OPTIONS_AJOUT, aujourdhui: 'x' }), { code: 'invalide' });
  for (const cible of [{ id: 'A', debut: '2026-10-10', fin: '2026-10-16' }, { id: 'a', debut: '2026-10-16', fin: '2026-10-10' },
    { id: 'a', debut: '2026-10-01', fin: '2026-10-20' }]) {
    assert.deepEqual(ecrituresAjout([], 'gratin', { ...OPTIONS_AJOUT, cible }), { code: 'invalide' });
  }
});

test('ecrituresAjout : jamais un apéro, une préparation de chaque semaine ni un plat de la corbeille (fiche, Plats)', () => {
  const apero = plat('olives', 'Olives maison', [PATES], { type: 'apero' });
  const yaourts = plat('yaourts', 'Yaourts maison', [PATES], { type: 'preparation', recurrence: 'hebdo' });
  for (const p of [apero, yaourts, JETE]) {
    assert.deepEqual(ecrituresAjout([], p.id, { ...OPTIONS_AJOUT, plat: p }), { code: 'invalide' }, p.id);
  }
  assert.deepEqual(ecrituresAjout([], 'gratin', { ...OPTIONS_AJOUT, plat: GRATIN }), { code: 'invalide' }, 'autre identifiant');
  assert.equal(ecrituresAjout([], GRATIN.id, { ...OPTIONS_AJOUT, plat: GRATIN }).id, '2026-10-10');
  assert.equal(ecrituresAjout([], TARTE.id, { ...OPTIONS_AJOUT, plat: TARTE }).id, '2026-10-10', 'plat ⏳ permis');
  assert.deepEqual([aDesPlats(S2), aDesPlats(S2P), aDesPlats(null)], [false, true, false]);
});

test('ecrituresRetrait et ecrituresRemise : `retire: true`, jamais de suppression ; « Annuler » le remet', () => {
  const semaine = avecPlats(S1, { gratin: dans(1, { repas: 3 }) });
  assert.deepEqual(ecrituresRetrait(semaine, 'gratin'), { id: '2026-10-10', champs: { 'plats.gratin.retire': true } });
  assert.deepEqual(ecrituresRemise(semaine, 'gratin', { maintenant: T }),
    { id: '2026-10-10', champs: { 'plats.gratin.ajouteLe': T, 'plats.gratin.retire': EFFACER } });
  assert.deepEqual(ecrituresRetrait(semaine, 'absent'), { code: 'invalide' });
  assert.deepEqual(ecrituresRetrait(null, 'gratin'), { code: 'invalide' });
  assert.deepEqual(ecrituresRemise(semaine, 'gratin', {}), { code: 'invalide' });
  assert.deepEqual(ecrituresRemise(semaine, 'a.b', { maintenant: T }), { code: 'invalide' });
});

test('ecrituresRetrait : vider une semaine qui commence plus tard emporte ses restes pas cochés ; « Annuler » les rend', () => {
  const s2 = avecPlats(S2, { curry: dans(1) });
  const articles = [
    { id: 'reste--2026-10-17--beurre', libelle: 'beurre', precision: '30 g', creePar: 'a@exemple.fr', creeLe: T },
    { id: 'reste--2026-10-17--sel', libelle: 'sel', creeLe: T, coche: { le: T + 1 } },
    { id: 'reste--2026-10-10--oignon', libelle: 'oignon', creeLe: T },
    { id: 'piles', libelle: 'piles', creeLe: T },
  ];
  assert.deepEqual(ecrituresRetrait(s2, 'curry', { articles, aujourdhui: '2026-10-16' }),
    { id: '2026-10-17', champs: { 'plats.curry.retire': true }, supprimer: ['reste--2026-10-17--beurre'] });
  // Il reste un plat, ou la semaine a commencé (elle reste montrée) : les restes restent.
  assert.equal('supprimer' in ecrituresRetrait(avecPlats(S2, { curry: dans(1), gratin: dans(2) }), 'curry', { articles, aujourdhui: '2026-10-16' }), false);
  assert.equal('supprimer' in ecrituresRetrait(s2, 'curry', { articles, aujourdhui: '2026-10-17' }), false);
  assert.equal('supprimer' in ecrituresRetrait(s2, 'curry'), false);
  assert.deepEqual(restesDeLaSemaine(s2, articles), ['reste--2026-10-17--beurre']);
  // « Annuler » : le plat revient, et les articles emportés avec lui (mêmes identifiants).
  const remise = ecrituresRemise(avecPlats(S2, { curry: dans(1, { retire: true }) }), 'curry', { maintenant: T, remettre: [articles[0], articles[3]] });
  assert.deepEqual(remise.articles, [articles[0]], 'seulement des restes');
});

test('ecrituresStyle : la mer (défaut) efface le chemin ; végétale l’écrit ; un style qui ne convient pas est refusé', () => {
  const semaine = avecPlats(S1, { 'gratin-pates-jambon': dans(1) });
  const options = { evaluer, tousLesPlats: TOUS, profils: PROFILS };
  assert.deepEqual(ecrituresStyle(semaine, 'gratin-pates-jambon', 'profil-b', 'vegetal', options),
    { id: '2026-10-10', champs: { 'plats.gratin-pates-jambon.styles.profil-b': 'vegetal' } });
  assert.deepEqual(ecrituresStyle(semaine, 'gratin-pates-jambon', 'profil-b', 'mer', options),
    { id: '2026-10-10', champs: { 'plats.gratin-pates-jambon.styles.profil-b': EFFACER } });
  const seuleVegetale = { ...GRATIN, variantes: [VEGETALE] };
  assert.deepEqual(ecrituresStyle(semaine, 'gratin-pates-jambon', 'profil-b', 'mer', { ...options, tousLesPlats: [seuleVegetale] }), { code: 'style' });
  assert.deepEqual(ecrituresStyle(semaine, 'gratin-pates-jambon', 'profil-b', 'vegetal', { ...options, tousLesPlats: [seuleVegetale] }).champs,
    { 'plats.gratin-pates-jambon.styles.profil-b': EFFACER }, 'la seule version est le défaut');
  // Sans plats ni profils : seule la mer efface.
  assert.deepEqual(ecrituresStyle(semaine, 'gratin-pates-jambon', 'profil-b', 'mer').champs, { 'plats.gratin-pates-jambon.styles.profil-b': EFFACER });
  for (const [platId, profilId, style] of [['gratin', 'profil-b', 'poisson'], ['gratin', 'Profil', 'mer'], ['a.b', 'profil-b', 'mer']]) {
    assert.deepEqual(ecrituresStyle(semaine, platId, profilId, style, options), { code: 'invalide' });
  }
});

test('ecrituresReglage : `repas` écrit dès qu’il est touché, même s’il vaut le défaut ; bornes 1 à 14 ; null → défaut', () => {
  const semaine = avecPlats(S1, { 'gratin-pates-jambon': dans(1) });
  const options = { evaluer, tousLesPlats: TOUS, profils: PROFILS };
  assert.equal(unPlat(semaine)[0].repasParDefaut, 2);
  assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', { repas: 2 }, options),
    { id: '2026-10-10', champs: { 'plats.gratin-pates-jambon.repas': 2 } });
  assert.equal(ecrituresReglage(semaine, 'gratin-pates-jambon', { repas: 0 }, options).champs['plats.gratin-pates-jambon.repas'], 1);
  assert.equal(ecrituresReglage(semaine, 'gratin-pates-jambon', { repas: 15 }, options).champs['plats.gratin-pates-jambon.repas'], REPAS_MAX);
  assert.equal(ecrituresReglage(semaine, 'gratin-pates-jambon', { repas: null }, options).champs['plats.gratin-pates-jambon.repas'], EFFACER);
  for (const reglage of [{ repas: '3' }, {}, null, { autre: 1 }]) {
    assert.deepEqual(ecrituresReglage(semaine, 'gratin-pates-jambon', reglage, options), { code: 'invalide' }, JSON.stringify(reglage));
  }
  assert.deepEqual(ecrituresReglage(semaine, 'a.b', { repas: 2 }), { code: 'invalide' });
});

test('statut : rangs figés pour T4 et T5 ; une écriture de T3a n’écrit jamais de statut', () => {
  assert.deepEqual(RANGS_STATUT, { brouillon: 0, validee: 1, courses_faites: 2, batch_fait: 3 });
  assert.ok(Object.isFrozen(RANGS_STATUT));
  const semaine = avecPlats(S1, { gratin: dans(1) });
  for (const ecritures of [ecrituresAjout([], 'gratin', OPTIONS_AJOUT), ecrituresRetrait(semaine, 'gratin'),
    ecrituresRemise(semaine, 'gratin', { maintenant: T }), ecrituresStyle(semaine, 'gratin', 'profil-b', 'vegetal'),
    ecrituresReglage(semaine, 'gratin', { repas: 3 })]) {
    const tout = JSON.stringify(ecritures);
    assert.equal(/statut/.test(tout), false, tout);
  }
});

// ——— Feuille « Ajouter à la semaine » ———

const CHOIX = [
  { ...plat('carbonade', 'Carbonade', [PATES]), notes: { 'profil-a': 5, 'profil-b': 2 } },
  { ...plat('quiche', 'Quiche lorraine', [PATES]), notes: { 'profil-a': 4 } },
  { ...plat('curry-legumes', 'Curry de légumes', [PATES]), notes: { 'profil-b': 5 } },
  { ...plat('fondant', 'Fondant au chocolat', [PATES], { type: 'dessert' }), notes: { 'profil-a': 5 } },
  { ...plat('rillettes', 'Rillettes de thon', [PATES], { type: 'apero' }), notes: { 'profil-a': 5 } },
  { ...plat('yaourts-maison', 'Yaourts maison', [PATES], { type: 'preparation', recurrence: 'hebdo' }) },
  { ...plat('pate-a-crepes', 'Pâte à crêpes', [PATES], { type: 'preparation' }) },
  { ...JETE, notes: { 'profil-a': 5 } },
  { id: 'tarte-poireaux', nom: 'Tarte aux poireaux' },
  { id: 'sans-nom', nom: ' ' },
];

test('platsAChoisir : « Vos préférés » (4 ou 5, par note puis nom), puis tous les autres de A à Z ; exclus', () => {
  const choix = platsAChoisir(CHOIX, { moi: A, profils: PROFILS });
  assert.equal(choix.titrePreferes, 'Vos préférés');
  assert.deepEqual(choix.preferes.map((p) => p.id), ['carbonade', 'quiche']);
  assert.deepEqual(choix.tous.map((p) => p.id), ['curry-legumes', 'tarte-poireaux']);
  assert.equal(choix.nouveau, null);
  assert.equal(choix.aucun, false);
  // Puces : desserts, tout (préparations hors « chaque semaine » comprises ; jamais l'apéro ni la corbeille).
  assert.deepEqual(platsAChoisir(CHOIX, { moi: A, filtre: 'dessert' }).preferes.map((p) => p.id), ['fondant']);
  const tout = platsAChoisir(CHOIX, { moi: A, filtre: 'tout' });
  assert.deepEqual([...tout.preferes, ...tout.tous].map((p) => p.id).sort(),
    ['carbonade', 'curry-legumes', 'fondant', 'pate-a-crepes', 'quiche', 'tarte-poireaux']);
  assert.deepEqual(FILTRES_CHOIX.map((f) => f.id), ['plat', 'dessert', 'tout']);
});

test('platsAChoisir : sans profil relié, « Les préférés de la maison » ; 8 au plus', () => {
  const maison = platsAChoisir(CHOIX, { moi: null, profils: PROFILS });
  assert.equal(maison.titrePreferes, 'Les préférés de la maison');
  assert.deepEqual(maison.preferes.map((p) => p.id), ['carbonade', 'curry-legumes', 'quiche']);
  const beaucoup = Array.from({ length: 12 }, (_, i) => ({ ...plat(`plat-${i}`, `Plat ${String(i).padStart(2, '0')}`, [PATES]), notes: { 'profil-a': 4 + (i % 2) } }));
  const choix = platsAChoisir(beaucoup, { moi: A });
  assert.equal(choix.preferes.length, PREFERES_MAX);
  assert.deepEqual(choix.preferes.slice(0, 2).map((p) => p.id), ['plat-1', 'plat-3'], 'les 5 d’abord');
  assert.equal(choix.tous.length, 4);
});

test('platsAChoisir : une recherche cherche dans tous les types, quelle que soit la puce (un dessert tapé sous « Plats »)', () => {
  const fondant = platsAChoisir(CHOIX, { moi: A, recherche: 'fondant au chocolat', filtre: 'plat' });
  assert.deepEqual([...fondant.preferes, ...fondant.tous].map((p) => p.id), ['fondant']);
  assert.equal(fondant.aucun, false);
  assert.equal(fondant.nouveau, null);
  const partiel = platsAChoisir(CHOIX, { moi: A, recherche: 'fondant', filtre: 'plat' });
  assert.deepEqual([...partiel.preferes, ...partiel.tous].map((p) => p.id), ['fondant']);
  assert.equal(platsAChoisir(CHOIX, { moi: A, recherche: 'crêpes', filtre: 'dessert' }).tous[0].id, 'pate-a-crepes');
  // Jamais l'apéro ni une préparation de chaque semaine, même cherchés par leur nom ; jamais « Aucun plat » pour eux.
  const apero = platsAChoisir(CHOIX, { moi: A, recherche: 'Rillettes de thon', filtre: 'tout' });
  assert.deepEqual([...apero.preferes, ...apero.tous], []);
  assert.deepEqual([apero.nouveau, apero.aucun], [null, false]);
  assert.equal(peutAllerDansLaSemaine(CHOIX[4]), false, 'apéro');
  assert.equal(peutAllerDansLaSemaine(CHOIX[5]), false, 'préparation de chaque semaine');
  assert.equal(peutAllerDansLaSemaine(CHOIX[6]), true, 'préparation');
  assert.equal(peutAllerDansLaSemaine(JETE), false, 'corbeille');
  assert.equal(peutAllerDansLaSemaine(TARTE), true, 'plat ⏳');
});

test('platsAChoisir : recherche sans accents ; « ＋ Nouveau plat » si aucun nom exact ; « Aucun plat » si rien', () => {
  const quiche = platsAChoisir(CHOIX, { moi: A, recherche: 'QUICHE' });
  assert.deepEqual([...quiche.preferes, ...quiche.tous].map((p) => p.id), ['quiche']);
  assert.equal(quiche.nouveau, 'QUICHE');
  assert.equal(platsAChoisir(CHOIX, { moi: A, recherche: 'quiche lorraine' }).nouveau, null);
  // Nom d'un plat de la corbeille : jamais « ＋ Nouveau plat » (voué à l'échec), mais le plat, pour le remettre.
  const jete = platsAChoisir(CHOIX, { moi: A, recherche: 'Plat jeté' });
  assert.equal(jete.nouveau, null);
  assert.equal(jete.corbeille?.id, 'jete');
  assert.equal(jete.aucun, false);
  const rien = platsAChoisir(CHOIX, { moi: A, recherche: '  Tarte   tatin ' });
  assert.equal(rien.nouveau, 'Tarte tatin');
  assert.equal(rien.corbeille, null);
  assert.equal(rien.aucun, true);
  assert.equal(platsAChoisir(CHOIX, { moi: A, recherche: 'curry' }).tous[0].id, 'curry-legumes');
  assert.equal(platsAChoisir(null).tous.length, 0);
});

// ——— Textes de la carte d'un plat et de sa feuille ———

const premier = (plats, entree = {}, extra = {}) => platsDeLaSemaine(avecPlats(S1, { [plats.id]: dans(1, entree) }), ctx({ tousLesPlats: [plats], ...extra }))[0];

test('resumePlat : « Tout le monde · 2 repas · 5 portions », les prénoms, accords, invités ; personne', () => {
  assert.equal(resumePlat(premier(GRATIN)), 'Tout le monde · 2\u00A0repas · 5\u00A0portions');
  assert.equal(resumePlat(premier(GRATIN_SANS_VERSION)), 'Adulte A et Enfant · 3\u00A0repas · 4,5\u00A0portions');
  const petit = platsDeLaSemaine(avecPlats(S1, { mini: dans(1) }), { tousLesPlats: [{ ...GRATIN, id: 'mini', portionsBase: 1 }], profils: [A, E] })[0];
  assert.equal(resumePlat(petit), 'Tout le monde · 1\u00A0repas · 1,5\u00A0portion');
  assert.equal(resumePlat(premier(GRATIN, { invites: { adultes: 2, enfants: 0 } })), 'Tout le monde et 2\u00A0invités · 2\u00A0repas · 9\u00A0portions');
  const personne = premier({ ...GRATIN, notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0 } });
  assert.equal(resumePlat(personne), TEXTE_PERSONNE);
  assert.equal(TEXTE_PERSONNE, 'Personne n’en mange\u00A0: il n’est pas dans les courses.');
  assert.equal(resumePlat(premier(TARTE)), null, 'plat ⏳ : pas de résumé de portions');
  assert.equal(resumePlat(null), null);
});

test('phrasePortions : « 5 portions à cuisiner. La recette en fait 4 : les quantités suivent. » ; « comme la recette »', () => {
  assert.equal(phrasePortions(premier(GRATIN)), '5\u00A0portions à cuisiner. La recette en fait 4\u00A0: les quantités suivent.');
  assert.equal(phrasePortions(premier(GRATIN, { mange: { enfant: false } })), '4\u00A0portions à cuisiner, comme la recette.');
  assert.equal(phrasePortions(premier({ ...GRATIN, portionsBase: undefined })), '2,5\u00A0portions à cuisiner.');
  assert.equal(phrasePortions(premier({ ...GRATIN, notes: { 'profil-a': 0, 'profil-b': 0, enfant: 0 } })), TEXTE_PERSONNE);
  assert.equal(phrasePortions(premier(TARTE)), null);
});

test('exceptionPlat : une seule ligne, dans l’ordre ; jamais de croix dans la vue « Repas et courses »', () => {
  assert.equal(exceptionPlat(premier(TARTE)), TEXTE_SANS_RECETTE);
  assert.equal(TEXTE_SANS_RECETTE, '⏳ Pas encore de recette\u00A0: ajoutez ses ingrédients à la main dans les courses.');
  assert.equal(exceptionPlat(premier(GRATIN)), null);
  const sansVersion = premier(GRATIN_SANS_VERSION);
  assert.equal(exceptionPlat(sansVersion, { moi: A }), 'Sans Adulte B\u00A0: pas encore de version.');
  assert.equal(exceptionPlat(sansVersion, { moi: B, role: 'courses' }), 'Sans vous\u00A0: pas encore de version pour vous.');
  assert.equal(exceptionPlat(premier({ ...GRATIN, notes: { 'profil-a': 0 } })), 'Sans Adulte A («\u00A0Jamais\u00A0»).');
  assert.equal(exceptionPlat(premier({ ...GRATIN, notes: { 'profil-a': 0 } }), { moi: A }), 'Sans vous («\u00A0Jamais\u00A0»).');
  const miel = premier(YAOURT_MIEL);
  assert.equal(exceptionPlat(miel, { role: 'courses' }), '🧸 Sans Enfant\u00A0: pas avant 1 an (miel).');
  assert.equal(exceptionPlat(miel, { role: 'gestionnaire' }), '🧸 Sans Enfant\u00A0: ❌ Pas avant 1 an\u00A0: miel.');
  const deux = premier({ ...YAOURT_MIEL, notes: { 'profil-a': 0 } });
  assert.equal(exceptionPlat(deux), 'Sans Adulte A ni Enfant. Touchez le plat pour voir pourquoi.');
  const trois = premier({ ...GRATIN_SANS_VERSION, notes: { 'profil-a': 0, enfant: 0 } }, {}, {});
  assert.equal(exceptionPlat(trois, { moi: B }), 'Sans Adulte A, vous ni Enfant. Touchez le plat pour voir pourquoi.');
  assert.equal(exceptionPlat(premier(GRATIN, { mange: { 'profil-a': false } })), 'Sans Adulte A.');
  for (const role of ['courses', null]) {
    for (const element of [sansVersion, miel, deux, trois]) assert.equal(/❌/.test(exceptionPlat(element, { role }) ?? ''), false);
  }
});

test('raisonsEcartes : une phrase par profil écarté (feuille du plat)', () => {
  const textes = (element, options) => raisonsEcartes(element, options).map((r) => r.texte);
  assert.deepEqual(textes(premier(GRATIN_SANS_VERSION), { moi: A }), ['Adulte B\u00A0: pas encore de version.']);
  assert.deepEqual(textes(premier(GRATIN_SANS_VERSION), { moi: B }), ['Pas encore de version pour vous.']);
  assert.deepEqual(textes(premier(YAOURT_MIEL)), ['Enfant\u00A0: 🧸 pas avant 1 an (miel).']);
  assert.deepEqual(textes(premier(YAOURT_MIEL), { role: 'gestionnaire' }), ['Enfant\u00A0: 🧸 ❌ Pas avant 1 an\u00A0: miel.']);
  assert.deepEqual(textes(premier({ ...GRATIN, notes: { 'profil-a': 0 } })), ['Adulte A a dit «\u00A0Jamais\u00A0».']);
  assert.deepEqual(textes(premier({ ...GRATIN, notes: { 'profil-a': 0 } }), { moi: A }), ['Vous avez dit «\u00A0Jamais\u00A0».']);
  assert.deepEqual(textes(premier(GRATIN, { mange: { 'profil-a': false } })), ['Adulte A n’en mange pas.']);
  assert.deepEqual(raisonsEcartes(premier(GRATIN)), []);
  assert.deepEqual(raisonsEcartes(premier(TARTE)), []);
});

test('version : légende « Pour Adulte B : » / « Pour vous : », options « 🐟 Mer », « 🌿 Végétale », version unique', () => {
  assert.equal(legendeVersion(B), 'Pour Adulte B\u00A0:');
  assert.equal(legendeVersion(B, { moi: B }), 'Pour vous\u00A0:');
  assert.equal(libelleStyle('mer'), '🐟 Mer');
  assert.equal(libelleStyle('vegetal'), '🌿 Végétale');
  assert.equal(libelleStyle('autre'), '');
  const [auChoix] = premier(GRATIN).versions;
  assert.equal(texteVersionUnique(auChoix), '', 'deux versions : le choix, pas une phrase');
  const [vegetale] = premier({ ...GRATIN, variantes: [VEGETALE] }).versions;
  assert.equal(texteVersionUnique(vegetale), 'Pour Adulte B\u00A0: version végétale 🌿');
  const [mer] = premier({ ...GRATIN, variantes: [MER] }).versions;
  assert.equal(texteVersionUnique(mer, { moi: B }), 'Pour vous\u00A0: version mer 🐟');
});

test('texteConservation : la part la plus fragile, non bloquant ; pour soi ; 1 jour', () => {
  assert.equal(texteConservation(premier(GRATIN)), '🐟 La part d’Adulte B se garde 2\u00A0jours après cuisson (le plat\u00A0: 3).');
  assert.equal(texteConservation(premier(GRATIN), { moi: B }), '🐟 Votre part se garde 2\u00A0jours après cuisson (le plat\u00A0: 3).');
  assert.equal(texteConservation(premier({ ...GRATIN, variantes: [{ ...MER, frigoJours: 1 }] })),
    '🐟 La part d’Adulte B se garde 1\u00A0jour après cuisson (le plat\u00A0: 3).');
  assert.equal(texteConservation(premier(GRATIN, { styles: { 'profil-b': 'vegetal' } })), null);
  assert.equal(texteConservation(premier(TARTE)), null);
});

test('défauts calculés, jamais écrits : lire la semaine ne produit aucune écriture', () => {
  const semaine = geler(avecPlats(S1, { 'gratin-pates-jambon': dans(1), 'yaourt-miel': dans(2) }));
  const avant = JSON.stringify(semaine);
  platsDeLaSemaine(semaine, ctx());
  semaineAPreparer([semaine], '2026-10-12');
  semaineVisee([semaine], '2026-10-15');
  assert.equal(JSON.stringify(semaine), avant);
});
