// T3d « Placard, habituels et rayons » : sauvegarde et restauration des réglages des produits (rayon, placard,
// habituel, en plus du mot cherché de T3b) et de l'ordre des rayons (`reglages.rayons`) ; restauration additive (un
// champ présent n'est jamais remplacé ; l'ordre des rayons n'est écrit que s'il manque, par `update` du seul champ) ;
// fichiers d'avant (T3a, T3b, T3c) toujours lisibles ; garde-fous d'aller-retour. Fixtures génériques, domaines fictifs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBELLES_RAYON } from '../js/coeur/edition.js';
import {
  CHAMPS_PRODUIT, CHAMPS_REGLAGES, CLES_SAUVEGARDE, appliquerConditions, creerSauvegarde, lireChampProduit, lireOrdreRayons,
  lireSauvegarde, phrasesCoursesRemises, preparerRestauration, validerSauvegarde,
} from '../js/coeur/sauvegarde.js';

const MAINTENANT = new Date('2026-10-12T10:00:00Z');
const DEPART = Object.keys(LIBELLES_RAYON);
const DRIVE = { nom: 'drive.exemple.fr', urlRecherche: 'https://drive.exemple.fr/recherche?text={q}' };
const RAYONS = ['divers', 'cremerie', ...DEPART.filter((r) => !['divers', 'cremerie'].includes(r))];
const REGLAGES_FOYER = {
  gestionnaire: 'a@example.com', notifications: { ntfySujet: 'repas-abcdefghijkmnpqrstuvwxy' }, instructionsCopiees: 6,
  frigoJoursDefaut: 3, drive: DRIVE, rayons: RAYONS,
};
const PRODUITS = [
  { id: 'pate', rechercheDrive: 'penne', rayon: 'epicerie_sucree' },
  { id: 'beurre', placard: { actif: false } },
  { id: 'beurre-demi-sel', placard: { actif: true } },
  { id: 'lait-demi-ecreme', habituel: { actif: true, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' } },
  { id: 'pile', habituel: { actif: false, libelle: 'piles' }, rayon: 'entretien' },
];
const etat = () => ({ plats: [], profils: [], produits: structuredClone(PRODUITS), reglages: structuredClone(REGLAGES_FOYER) });
const relue = (donnees) => validerSauvegarde(lireSauvegarde(creerSauvegarde(donnees, { maintenant: MAINTENANT }).texte).sauvegarde);
const fichier = (extra = {}) => ({ format: 'paquet@1', sauvegardeLe: MAINTENANT.toISOString(), plats: [], profils: [], ...extra });
const ecrituresDe = (preparation) => preparation.lots.flat();
const base = (extra = {}) => ({ plats: [], profils: [], demandes: [], email: 'a@example.com', produits: [], reglages: {}, ...extra });

/** Applique des lots (produits et reglages seulement) à des documents { id, … }, comme Firestore (fusion ou update). */
function appliquer(collections, lots) {
  const docs = Object.fromEntries(Object.entries(collections).map(([nom, liste]) => [nom, new Map(liste.map((d) => [d.id, structuredClone(d)]))]));
  for (const ecriture of lots.flat()) {
    docs[ecriture.collection] ??= new Map();
    const actuel = docs[ecriture.collection].get(ecriture.id);
    if (ecriture.mode === 'fusion') docs[ecriture.collection].set(ecriture.id, { ...(actuel ?? { id: ecriture.id }), ...structuredClone(ecriture.donnees) });
    else {
      assert.ok(actuel, `update sur un document absent : ${ecriture.id}`);
      // Chemins pointés (« cuisine.siphon », 2026-10-20) comme Firestore.
      for (const [chemin, valeur] of Object.entries(structuredClone(ecriture.donnees))) {
        const morceaux = chemin.split('.');
        let ici = actuel;
        for (const m of morceaux.slice(0, -1)) {
          if (!ici[m] || typeof ici[m] !== 'object') ici[m] = {};
          ici = ici[m];
        }
        ici[morceaux.at(-1)] = valeur;
      }
    }
  }
  return Object.fromEntries(Object.entries(docs).map(([nom, map]) => [nom, [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1))]));
}

// ——— Lecture des champs ———

test('lireChampProduit : mot cherché, rayon, placard, habituel lus propres ; illisible → null', () => {
  assert.equal(lireChampProduit('rechercheDrive', '  penne  '), 'penne');
  assert.equal(lireChampProduit('rechercheDrive', ''), null);
  assert.equal(lireChampProduit('rayon', 'entretien'), 'entretien');
  assert.equal(lireChampProduit('rayon', 'cave'), null);
  assert.deepEqual(lireChampProduit('placard', { actif: false, autre: 1 }), { actif: false });
  assert.equal(lireChampProduit('placard', { actif: 'non' }), null);
  // Le nom gardé avec le placard (relecture de T3d) : relu tel quel ; illisible, omis sans bloquer.
  assert.deepEqual(lireChampProduit('placard', { actif: true, libelle: '  tofu  fumé maison ' }), { actif: true, libelle: 'tofu fumé maison' });
  assert.deepEqual(lireChampProduit('placard', { actif: true, libelle: 'x'.repeat(61) }), { actif: true });
  assert.deepEqual(lireChampProduit('habituel', { actif: true, qte: 6, unite: 'l', libelle: 'lait' }), { actif: true, qte: 6, unite: 'l', libelle: 'lait' });
  assert.equal(lireChampProduit('habituel', 'chaque semaine'), null);
  assert.equal(lireChampProduit('nom', 'lait'), null, 'champ réservé : jamais sauvegardé');
  assert.deepEqual(CHAMPS_PRODUIT, ['rechercheDrive', 'rayon', 'placard', 'habituel']);
  assert.deepEqual(CHAMPS_REGLAGES, ['drive', 'rayons', 'cuisine', 'platsEtMoules']);
});

test('lireOrdreRayons : les 14 rayons, ceux du foyer d’abord ; inconnus et doublons ignorés ; illisible → null', () => {
  assert.deepEqual(lireOrdreRayons(RAYONS), RAYONS);
  assert.deepEqual(lireOrdreRayons(['boissons', 'cave', 'boissons', 3]), ['boissons', ...DEPART.filter((r) => r !== 'boissons')]);
  for (const illisible of [[], ['cave'], 'boissons', null, { 0: 'divers' }]) assert.equal(lireOrdreRayons(illisible), null, JSON.stringify(illisible));
});

// ——— Fichier ———

test('creerSauvegarde : produits avec rayon, placard et habituel (triés, champs lisibles seulement) ; reglages : drive et rayons', () => {
  const r = creerSauvegarde(etat(), { maintenant: MAINTENANT });
  const lu = JSON.parse(r.texte);
  assert.deepEqual(Object.keys(lu), [...CLES_SAUVEGARDE]);
  assert.deepEqual(lu.reglages, { drive: DRIVE, rayons: RAYONS });
  assert.deepEqual(lu.produits, [
    { id: 'beurre', placard: { actif: false } },
    { id: 'beurre-demi-sel', placard: { actif: true } },
    { id: 'lait-demi-ecreme', habituel: { actif: true, qte: 6, unite: 'l', libelle: 'lait demi-écrémé' } },
    { id: 'pate', rechercheDrive: 'penne', rayon: 'epicerie_sucree' },
    { id: 'pile', rayon: 'entretien', habituel: { actif: false, libelle: 'piles' } },
  ]);
  assert.deepEqual(r.resume, { plats: 0, profils: 0, notes: 0, produits: 5, drive: true, rayons: true, cuisine: 0 });
  for (const absent of ['gestionnaire', 'ntfy', 'instructionsCopiees', 'frigoJoursDefaut', 'sansHebdo', 'sansHabituel', 'precision']) {
    assert.equal(r.texte.includes(absent), false, absent);
  }
  // Champs illisibles écartés ; un produit sans champ lisible est omis ; un ordre partiel est complété.
  const abime = creerSauvegarde({
    produits: [{ id: 'lait', rayon: 'cave', placard: { actif: 'oui' }, habituel: 'toujours' }, { id: 'sel', rayon: 'cave', placard: { actif: true } }],
    reglages: { rayons: ['boissons'] },
  }, { maintenant: MAINTENANT });
  const luAbime = JSON.parse(abime.texte);
  assert.deepEqual(luAbime.produits, [{ id: 'sel', placard: { actif: true } }]);
  assert.deepEqual(luAbime.reglages, { rayons: ['boissons', ...DEPART.filter((r) => r !== 'boissons')] });
  assert.deepEqual(JSON.parse(creerSauvegarde({ reglages: { rayons: ['cave'] } }, { maintenant: MAINTENANT }).texte).reglages, {});
});

test('validerSauvegarde : rayon, placard, habituel et ordre des rayons lus ; illisibles ignorés avec un avertissement', () => {
  const v = relue(etat());
  assert.equal(v.valide, true);
  assert.deepEqual(v.avertissements, []);
  assert.deepEqual(v.reglages, { drive: DRIVE, rayons: RAYONS });
  assert.equal(v.produits.length, 5);
  const abime = validerSauvegarde(fichier({
    reglages: { rayons: ['cave'] },
    produits: [{ id: 'lait', rayon: 'cave', placard: { actif: 'oui' } }, { id: 'sel', habituel: 'toujours', rayon: 'divers' }],
  }));
  assert.equal(abime.valide, true);
  assert.deepEqual(abime.reglages, {});
  assert.deepEqual(abime.produits, [{ id: 'sel', rayon: 'divers' }]);
  assert.deepEqual(abime.avertissements, ['L’ordre des rayons du fichier est illisible\u00A0: il a été ignoré.',
    '3\u00A0réglages de produits illisibles ont été ignorés.']);
});

test('fichiers d’avant : T3a (sans réglages ni produits), T3b et T3c (drive et mot cherché) restent lisibles, sans avertissement', () => {
  const t3a = validerSauvegarde(fichier());
  assert.deepEqual([t3a.valide, t3a.avertissements, t3a.reglages, t3a.produits], [true, [], {}, []]);
  const t3b = validerSauvegarde(fichier({ reglages: { drive: DRIVE }, produits: [{ id: 'pate', rechercheDrive: 'penne' }] }));
  assert.deepEqual([t3b.valide, t3b.avertissements, t3b.reglages, t3b.produits],
    [true, [], { drive: DRIVE }, [{ id: 'pate', rechercheDrive: 'penne' }]]);
  const r = preparerRestauration(t3b, base());
  assert.deepEqual([r.resume.produitsRemis, r.resume.driveRemis, r.resume.rayonsRemis], [1, 'drive.exemple.fr', false]);
});

// ——— Restauration additive ———

test('aller-retour : sur une base vide, chaque réglage revient à l’identique ; restaurés une fois, plus rien ne manque', () => {
  const v = relue(etat());
  const r = preparerRestauration(v, base({ reglages: { gestionnaire: 'a@example.com' } }));
  assert.equal(r.resume.produitsRemis, 5);
  assert.equal(r.resume.rayonsRemis, true);
  assert.deepEqual(ecrituresDe(r).filter((e) => e.collection === 'reglages'), [{
    collection: 'reglages', id: 'foyer', mode: 'update', donnees: { drive: DRIVE, rayons: RAYONS }, condition: { champsAbsents: ['drive', 'rayons'] },
  }]);
  const apres = appliquer({ produits: [], reglages: [{ id: 'foyer', gestionnaire: 'a@example.com' }] }, r.lots);
  assert.deepEqual(apres.produits, [...PRODUITS].sort((a, b) => (a.id < b.id ? -1 : 1)));
  assert.deepEqual(apres.reglages, [{ id: 'foyer', gestionnaire: 'a@example.com', drive: DRIVE, rayons: RAYONS }]);
  const encore = preparerRestauration(v, base({ produits: apres.produits, reglages: apres.reglages[0] }));
  assert.equal(encore.rien, true);
  assert.deepEqual([encore.resume.produitsRemis, encore.resume.rayonsRemis], [0, false]);
  assert.deepEqual(phrasesCoursesRemises(r.resume), ['5\u00A0réglages de produits reviennent.', 'Le drive revient (drive.exemple.fr).',
    'L’ordre des rayons revient.']);
});

test('restauration additive : un rayon, un placard ou un habituel présents ne sont jamais remplacés ; un champ absent revient', () => {
  const v = relue(etat());
  const app = base({
    produits: [
      { id: 'pate', rayon: 'surgeles' }, // rayon présent : gardé ; mot cherché absent : revient
      { id: 'beurre', placard: { actif: true } }, // placard présent (allumé) : gardé
      { id: 'lait-demi-ecreme', habituel: { actif: false } }, // éteint exprès : jamais rallumé
      { id: 'pile', rechercheDrive: 'piles LR6' }, // rayon et habituel absents : reviennent
    ],
    reglages: { ...REGLAGES_FOYER, rayons: DEPART },
  });
  const r = preparerRestauration(v, app);
  assert.deepEqual(ecrituresDe(r).filter((e) => e.collection !== 'plats' && e.collection !== 'profils'), [
    { collection: 'produits', id: 'beurre-demi-sel', mode: 'fusion', donnees: { placard: { actif: true } }, condition: { absent: true } },
    { collection: 'produits', id: 'pate', mode: 'update', donnees: { rechercheDrive: 'penne' }, condition: { champsAbsents: ['rechercheDrive'] } },
    {
      collection: 'produits', id: 'pile', mode: 'update', donnees: { rayon: 'entretien', habituel: { actif: false, libelle: 'piles' } },
      condition: { champsAbsents: ['rayon', 'habituel'] },
    },
  ]);
  assert.deepEqual([r.resume.produitsRemis, r.resume.driveRemis, r.resume.rayonsRemis], [3, null, false]);
  // L'ordre des rayons seul manque : `update` du seul champ.
  const sansRayons = preparerRestauration(v, { ...app, reglages: { gestionnaire: 'a@example.com', drive: DRIVE } });
  assert.deepEqual(ecrituresDe(sansRayons).find((e) => e.collection === 'reglages'),
    { collection: 'reglages', id: 'foyer', mode: 'update', donnees: { rayons: RAYONS }, condition: { champsAbsents: ['rayons'] } });
  assert.equal(sansRayons.resume.rayonsRemis, true);
  for (const e of ecrituresDe(sansRayons)) assert.equal(e.collection === 'reglages' && e.mode !== 'update', false, 'jamais un set de reglages/foyer');
});

test('envoi : un ordre des rayons ou un réglage de produit posés ailleurs entre-temps restent ; le reste part', () => {
  const ecriture = { collection: 'reglages', id: 'foyer', mode: 'update', donnees: { drive: DRIVE, rayons: RAYONS }, condition: { champsAbsents: ['drive', 'rayons'] } };
  assert.deepEqual(appliquerConditions(ecriture, { gestionnaire: 'a@example.com' }), ecriture);
  assert.deepEqual(appliquerConditions(ecriture, { gestionnaire: 'a@example.com', rayons: DEPART }).donnees, { drive: DRIVE });
  assert.equal(appliquerConditions(ecriture, { drive: DRIVE, rayons: DEPART }), null);
  const produit = { collection: 'produits', id: 'pile', mode: 'update', donnees: { rayon: 'entretien', habituel: { actif: true } }, condition: { champsAbsents: ['rayon', 'habituel'] } };
  assert.deepEqual(appliquerConditions(produit, { rayon: 'divers' }).donnees, { habituel: { actif: true } });
  assert.equal(appliquerConditions(produit, { rayon: 'divers', habituel: { actif: false } }), null);
});

test('un fichier T3d lu par une app d’avant T3b (sans `reglages` ni `produits`) : avertissement, le reste restauré', () => {
  const lue = lireSauvegarde(creerSauvegarde(etat(), { maintenant: MAINTENANT }).texte).sauvegarde;
  const avant = validerSauvegarde(lue, { cles: ['format', 'sauvegardeLe', 'plats', 'profils'] });
  assert.equal(avant.valide, true);
  assert.deepEqual(avant.avertissements, ['Une partie du fichier n’est pas encore reprise par l’app\u00A0: elle a été ignorée.']);
  assert.deepEqual([avant.reglages, avant.produits], [{}, []]);
});

test('garde-fou T3d : un produit et des réglages avec chaque champ sauvegardé font l’aller-retour à l’identique', () => {
  const produit = {
    id: 'lait', rechercheDrive: 'lait bio', rayon: 'boissons', placard: { actif: false },
    habituel: { actif: true, qte: 0.5, unite: 'l', libelle: 'lait' },
  };
  const reglages = {
    drive: DRIVE, rayons: RAYONS, cuisine: { 'mixeur-plongeant': true, four: false }, platsEtMoules: { 'moule-a-cake-22-cm': 'Moule à cake 22 cm' },
  };
  for (const champ of CHAMPS_PRODUIT) assert.ok(champ in produit, champ);
  for (const champ of CHAMPS_REGLAGES) assert.ok(champ in reglages, champ);
  const v = relue({ produits: [produit], reglages });
  const r = preparerRestauration(v, base());
  const apres = appliquer({ produits: [], reglages: [{ id: 'foyer' }] }, r.lots);
  assert.deepEqual(apres.produits, [produit]);
  assert.deepEqual(apres.reglages, [{ id: 'foyer', ...reglages }]);
});

test('aller-retour : le nom gardé avec le placard revient de la sauvegarde', () => {
  const produits = [{ id: 'tofu-fume-maison', placard: { actif: true, libelle: 'tofu fumé maison' } }];
  const lu = relue({ ...etat(), produits });
  assert.deepEqual(lu.produits, produits);
});

// ——— « Ma cuisine » (2026-10-20) ———

test('« Ma cuisine » : sauvegardée, puis rendue chemin par chemin sans jamais remplacer une réponse présente', () => {
  const reglages = {
    gestionnaire: 'a@example.com',
    cuisine: { siphon: true, cookeo: false, inconnu: true, mandoline: 'oui' },
    platsEtMoules: { 'cocotte-5-l': 'Cocotte 5 l', 'mal-ecrit': 'Autre nom' },
  };
  const fichierCree = JSON.parse(creerSauvegarde({ reglages }, { maintenant: MAINTENANT }).texte);
  assert.deepEqual(fichierCree.reglages.cuisine, { cookeo: false, siphon: true });
  assert.deepEqual(fichierCree.reglages.platsEtMoules, { 'cocotte-5-l': 'Cocotte 5 l', 'mal-ecrit': 'Autre nom' });
  const v = relue({ reglages });
  assert.deepEqual(v.reglages.cuisine, { cookeo: false, siphon: true });
  assert.deepEqual(v.reglages.platsEtMoules, { 'cocotte-5-l': 'Cocotte 5 l' }, 'un nom qui ne donne pas son identifiant est ignoré');
  assert.ok(v.avertissements.some((a) => /plats et moules/.test(a)));
  // L'app a déjà dit « Je ne l'ai pas » pour le siphon : jamais remplacé ; le Cookeo et la cocotte reviennent.
  const actuels = { gestionnaire: 'a@example.com', cuisine: { siphon: false } };
  const r = preparerRestauration(v, base({ reglages: actuels }));
  const [ecriture] = ecrituresDe(r).filter((e) => e.collection === 'reglages');
  assert.deepEqual(ecriture.donnees, { 'cuisine.cookeo': false, 'platsEtMoules.cocotte-5-l': 'Cocotte 5 l' });
  assert.deepEqual(ecriture.condition, { champsAbsents: ['cuisine.cookeo', 'platsEtMoules.cocotte-5-l'] });
  assert.equal(r.resume.cuisineRemise, 2);
  assert.deepEqual(phrasesCoursesRemises(r.resume), ['2 réglages de « Ma cuisine » reviennent.']);
  // Réponse donnée entre l'aperçu et l'envoi sur l'autre téléphone : elle reste.
  assert.deepEqual(appliquerConditions(ecriture, { cuisine: { siphon: false, cookeo: true } }).donnees, { 'platsEtMoules.cocotte-5-l': 'Cocotte 5 l' });
  const apres = appliquer({ produits: [], reglages: [{ id: 'foyer', ...actuels }] }, r.lots);
  assert.deepEqual(apres.reglages[0].cuisine, { siphon: false, cookeo: false });
  assert.deepEqual(apres.reglages[0].platsEtMoules, { 'cocotte-5-l': 'Cocotte 5 l' });
  // Un objet d'une version plus récente de l'app : « Une partie du fichier… ».
  const recent = validerSauvegarde(fichier({ reglages: { cuisine: { 'objet-futur': true } } }));
  assert.ok(recent.avertissements.some((a) => /Une partie du fichier/.test(a)));
});
