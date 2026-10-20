// T5-1 « Cuisiner pas à pas » : coeur/cuisine.js (plan §6.5, §8.5, §8.7) : accord des quantités avec la liste de
// courses (formule recopiée de liste.js), arrondis de cuisine, quantités et « Et aussi » d'une étape, rappels (four,
// part mise de côté, 🧸), hygiène, fin de cuisson, élément de la semaine, bouton, reprise, modèle de l'écran sur les
// réponses réelles de l'essai (gratin, carbonade et sa part mise de côté, gâteau). Fixtures génériques.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecrireRegime } from '../js/coeur/regles.js';
import { BAREME_AGE, regleDuPalier } from '../js/coeur/age.js';
import { evaluer } from '../js/coeur/compatibilite.js';
import { idProduit } from '../js/coeur/produits.js';
import { platsDeLaSemaine } from '../js/coeur/semaine.js';
import { listeDeCourses, versBase } from '../js/coeur/liste.js';
import { etapesLisibles, titresDe } from '../js/coeur/realisation.js';
import {
  AU_FRIGO_AVANT_MIN, CONSEILS, FINS_IMPLICITES, REPRISE_HEURES, TEXTES_CUISINE, arrondiCuisine, aussiDeLEtape,
  boutonCuisiner, cleReprise, cleTexteCuisine, elementPourCuisiner, etapesDuCoeur, finDeCuisson, hygieneDuPlat,
  lignesEnfant, lireReprise, pasAPas, peutCuisiner, phrasesDeFin, precautionsDuPlat, quantitesACuisiner,
  quantitesDeLEtape, rappelsDeLEtape, texteDateLimite, texteFrigoAvant, texteHeure, texteQuantiteCuisine, valeurReprise,
} from '../js/coeur/cuisine.js';
import { REPONSE_ETAPES_ESSAI, FICHES_ESSAI } from './donnees/reponse-etapes-essai.js';
import { GATEAU, GRATIN as GRATIN_EXEMPLE, REALISATION_GRATIN, REALISATION_POULET } from './donnees/exemples-etapes.js';
import { generateur } from './aides/tirages.js';

// ——— Fixtures ———

const SANS_VIANDE = ecrireRegime({ regime: 'sans_viande', precisions: new Set() }, []);
const MIEL = regleDuPalier(BAREME_AGE.find((e) => e.code === 'miel'), 0);
const A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1 };
const B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1, regles: SANS_VIANDE };
const E = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5, regles: [MIEL] };
const PROFILS = [A, B, E];

const ing = (produit, qte, unite, rayon, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon, marqueurs, ...extra });
const ajout = (produit, qtePortion, unite, rayon, marqueurs = []) => ({ produit, qtePortion, unite, rayon, marqueurs });
const avecRealisation = (fiche, realisation) => ({ ...fiche, realisation, etapes: titresDe(realisation) });
const ficheEssai = (id) => avecRealisation(FICHES_ESSAI.find((f) => f.id === id),
  REPONSE_ETAPES_ESSAI.plats.find((p) => p.id === id).realisation);

const MER = {
  pour: 'profil-b', style: 'mer', frigoJours: 2, retirer: ['jambon blanc'],
  ajouter: [ajout('thon au naturel', 50, 'g', 'epicerie_salee', ['poisson'])], consigne: 'Part au thon.',
};
const VEGETALE = {
  pour: 'profil-b', style: 'vegetal', retirer: ['jambon blanc'],
  ajouter: [ajout('tofu fumé', 60, 'g', 'cremerie', ['soja'])], consigne: 'Part au tofu.',
};
const GRATIN = avecRealisation({ ...GRATIN_EXEMPLE, variantes: [MER, VEGETALE] }, REALISATION_GRATIN);
const DAUPHINOIS = ficheEssai('gratin-dauphinois');
const CARBONADE = ficheEssai('carbonade-flamande');
const GATEAU_CHOCOLAT = ficheEssai('gateau-chocolat');
const CURRY = {
  id: 'curry-lentilles', nom: 'Curry de lentilles', type: 'plat', statutRecette: 'brouillon', portionsBase: 4,
  ingredients: [
    ing('lentille corail', 300, 'g', 'epicerie_salee', ['feculent']),
    ing('lait de coco', 40, 'cl', 'epicerie_salee'),
    ing('oignon jaune', 1, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
    ing('curry', 1, 'cs', 'epicerie_salee'),
    ing('sel', 1, 'pincee', 'epicerie_salee'),
    ing('beurre', 20, 'g', 'cremerie', ['laitier']),
    ing('beurre', 1, 'cs', 'cremerie', ['laitier']),
  ],
  etapes: ['Faire revenir l’oignon.', 'Ajouter les lentilles et le lait de coco, cuire.'],
  cuisson: [{ appareil: 'plaque', dureeMin: 25 }],
  conservation: { frigoJours: 4, congelable: true },
};
const SANS_BASE = {
  id: 'soupe', nom: 'Soupe', type: 'plat', statutRecette: 'brouillon',
  ingredients: [ing('carotte', 500, 'g', 'fruits_legumes', ['legume'], { role: 'principal' }), ing('bouillon de légumes', 1, 'l', 'epicerie_salee')],
  etapes: ['Cuire.'],
};
const ATTENTE = { id: 'tarte-poireaux', nom: 'Tarte aux poireaux' };
const JETE = { ...CURRY, id: 'jete', nom: 'Plat jeté', corbeille: { le: 1, par: 'x@exemple.fr' } };
const TOUS = [GRATIN, DAUPHINOIS, CARBONADE, GATEAU_CHOCOLAT, CURRY, SANS_BASE, ATTENTE, JETE];

const S = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', creeLe: 1 };
const dans = (ajouteLe, extra = {}) => ({ ajouteLe, ...extra });
const semaineAvec = (plats, extra = {}) => ({ ...S, plats, ...extra });
const elementsDe = (semaine) => platsDeLaSemaine(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer });
const elementDe = (semaine, id) => elementsDe(semaine).find((e) => e.platId === id);

// ——— Accord avec la liste de courses ———

/** Totaux exacts par idProduit et par famille, venus des plats de la semaine (lignes et parts). */
function totauxDeLaCuisine(semaine) {
  const totaux = new Map();
  const noter = (produit, qte, unite) => {
    if (!(qte > 0)) return;
    const lu = versBase(qte, unite);
    if (!lu) return;
    const id = idProduit(produit);
    if (!totaux.has(id)) totaux.set(id, {});
    totaux.get(id)[lu.famille] = (totaux.get(id)[lu.famille] ?? 0) + lu.qte;
  };
  for (const element of elementsDe(semaine)) {
    if (element.etat !== 'ok') continue;
    const q = quantitesACuisiner(element.plat, element, PROFILS);
    if (!q.semaine) continue;
    for (const l of q.lignes) noter(l.produit, l.qteExacte, l.unite);
    for (const p of q.parts) for (const a of p.ajouts) noter(a.produit, a.qteExacte, a.unite);
  }
  return totaux;
}

/** Totaux des lignes de la liste venus des plats (sources « plat »), placard compris. */
function totauxDeLaListe(semaine) {
  const liste = listeDeCourses(semaine, { tousLesPlats: TOUS, profils: PROFILS, evaluer });
  const totaux = new Map();
  for (const ligne of [...liste.lignes, ...liste.maison]) {
    for (const source of ligne.sources.filter((s) => s.type === 'plat')) {
      for (const [famille, qte] of Object.entries(source.totaux)) {
        if (!(qte > 0)) continue;
        if (!totaux.has(ligne.produitId)) totaux.set(ligne.produitId, {});
        totaux.get(ligne.produitId)[famille] = (totaux.get(ligne.produitId)[famille] ?? 0) + qte;
      }
    }
  }
  return totaux;
}

function memesTotaux(semaine, nom) {
  const cuisine = totauxDeLaCuisine(semaine);
  const liste = totauxDeLaListe(semaine);
  assert.deepEqual([...cuisine.keys()].sort(), [...liste.keys()].sort(), `${nom} : mêmes produits`);
  for (const [id, familles] of liste) {
    assert.deepEqual(Object.keys(cuisine.get(id)).sort(), Object.keys(familles).sort(), `${nom} : ${id}`);
    for (const [famille, qte] of Object.entries(familles)) {
      assert.ok(Math.abs(cuisine.get(id)[famille] - qte) <= 1e-6 * Math.max(1, qte), `${nom} : ${id} ${famille} ${cuisine.get(id)[famille]} ≠ ${qte}`);
    }
  }
  return liste;
}

const SEMAINES = {
  'versions mer et végétale par défaut, retraits, placard': semaineAvec({
    'gratin-pates-jambon': dans(1), 'carbonade-flamande': dans(2), 'curry-lentilles': dans(3),
  }),
  'végétale choisie, invités, repas touché, portions à congeler': semaineAvec({
    'gratin-pates-jambon': dans(1, { styles: { 'profil-b': 'vegetal' }, invites: { adultes: 2, enfants: 1 }, repas: 3, portionsACongeler: 2 }),
    'curry-lentilles': dans(2, { invites: { enfants: 3 } }),
  }),
  'cases cochées à la main : un profil sans version mange la recette, un autre n’en mange pas': semaineAvec({
    'carbonade-flamande': dans(1, { mange: { enfant: true, 'profil-a': false } }),
    'gratin-dauphinois': dans(2, { mange: { 'profil-b': false } }),
    'gateau-chocolat': dans(3, { portionsACongeler: 3 }),
  }),
  'sans portionsBase, plat ⏳, plat de la corbeille, personne ne mange': semaineAvec({
    soupe: dans(1), 'tarte-poireaux': dans(2), jete: dans(3),
    'curry-lentilles': dans(4, { mange: { 'profil-a': false, 'profil-b': false, enfant: false } }),
    'gratin-pates-jambon': dans(5, { mange: { 'profil-a': false, enfant: false } }),
  }),
};

test('accord avec la liste : la somme des quantités exactes égale le total de la liste, produit par produit', () => {
  for (const [nom, semaine] of Object.entries(SEMAINES)) memesTotaux(semaine, nom);
  // Contrôles de bon sens sur la première semaine : le bœuf n'est acheté que pour Adulte A, le seitan pour Adulte B.
  const carbonade = quantitesACuisiner(CARBONADE, elementDe(SEMAINES['versions mer et végétale par défaut, retraits, placard'], 'carbonade-flamande'));
  const boeuf = carbonade.lignes.find((l) => l.produit === 'bœuf à braiser');
  assert.equal(boeuf.qteExacte, 400);
  assert.deepEqual(boeuf.retirePour, ['profil-b']);
  assert.deepEqual(carbonade.parts.map((p) => [p.profilId, p.style, p.portions, p.ajouts.map((a) => a.texte)]),
    [['profil-b', 'vegetal', 2, ['Seitan · 240\u00A0g']]]);
});

test('accord avec la liste : 200 semaines tirées au hasard (invités, repas, congélation, cases, styles)', () => {
  const hasard = generateur(181026);
  const ids = ['gratin-pates-jambon', 'gratin-dauphinois', 'carbonade-flamande', 'gateau-chocolat', 'curry-lentilles', 'soupe'];
  for (let i = 0; i < 200; i += 1) {
    const plats = {};
    ids.forEach((id, k) => {
      if (hasard() < 0.5) return;
      const entree = { ajouteLe: k + 1 };
      if (hasard() < 0.4) entree.invites = { adultes: Math.floor(hasard() * 4), enfants: Math.floor(hasard() * 3) };
      if (hasard() < 0.3) entree.repas = 1 + Math.floor(hasard() * 5);
      if (hasard() < 0.3) entree.portionsACongeler = 1 + Math.floor(hasard() * 4);
      if (hasard() < 0.3) entree.styles = { 'profil-b': hasard() < 0.5 ? 'mer' : 'vegetal' };
      if (hasard() < 0.3) entree.mange = { [PROFILS[Math.floor(hasard() * 3)].id]: hasard() < 0.5 };
      plats[id] = entree;
    });
    memesTotaux(semaineAvec(plats), `semaine ${i}`);
  }
});

test('quantitesACuisiner : sans élément, les quantités de la recette au bit près', () => {
  for (const plat of [GRATIN, CARBONADE, CURRY, SANS_BASE]) {
    const q = quantitesACuisiner(plat, null);
    assert.equal(q.facteur, 1);
    assert.equal(q.semaine, false);
    assert.deepEqual(q.parts, []);
    plat.ingredients.forEach((ingredient, i) => {
      assert.equal(q.lignes[i].qteExacte, ingredient.qte);
      assert.equal(q.lignes[i].qte, ingredient.qte);
      assert.equal(q.lignes[i].arrondie, false);
    });
  }
  assert.equal(quantitesACuisiner(SANS_BASE, null).sansBase, true);
  // Personne n'en mange : la recette.
  const personne = elementDe(SEMAINES['sans portionsBase, plat ⏳, plat de la corbeille, personne ne mange'], 'curry-lentilles');
  assert.equal(personne.aCuire, 0);
  assert.equal(quantitesACuisiner(CURRY, personne).semaine, false);
});

test('quantitesACuisiner : 6 portions pour une recette de 4 : facteur 1,5, quantités arrondies, textes', () => {
  const semaine = semaineAvec({ 'curry-lentilles': dans(1, { invites: { adultes: 2 }, mange: { enfant: false } }) });
  const element = elementDe(semaine, 'curry-lentilles');
  assert.equal(element.aCuire, 8);
  const q = quantitesACuisiner(CURRY, element);
  assert.equal(q.facteur, 2);
  assert.deepEqual(q.lignes.map((l) => l.texte), [
    'Lentille corail · 600\u00A0g', 'Lait de coco · 80\u00A0cl', 'Oignon jaune · 2', 'Curry · 2\u00A0c. à soupe',
    'Sel · 2\u00A0pincées', 'Beurre · 40\u00A0g', 'Beurre · 2\u00A0c. à soupe',
  ]);
  const trois = quantitesACuisiner(CURRY, { ...element, aCuire: 6, aCongeler: 0 });
  assert.equal(trois.lignes[0].qteExacte, 450);
  assert.equal(trois.lignes[2].texte, 'Oignon jaune · 1,5');
  assert.equal(trois.lignes[4].qte, 2, 'une pincée ne se coupe pas : 1,5 → 2');
});

test('quantitesACuisiner : toutes les parts retirent l’ingrédient → « pas cette fois »', () => {
  const semaine = semaineAvec({ 'gratin-pates-jambon': dans(1, { mange: { 'profil-a': false, enfant: false } }) });
  const q = quantitesACuisiner(GRATIN, elementDe(semaine, 'gratin-pates-jambon'));
  const jambon = q.lignes.find((l) => l.produit === 'jambon blanc');
  assert.equal(jambon.personne, true);
  assert.equal(jambon.qteExacte, 0);
  assert.equal(jambon.texte, 'Jambon blanc · pas cette fois');
  assert.equal(q.parts[0].ajouts[0].texte, 'Thon au naturel · 200\u00A0g', '50 g × 4 repas');
});

// ——— Arrondis ———

test('arrondiCuisine : table du plan (au plus près, jamais 0)', () => {
  const cas = [
    [0.2, 'g', 1], [7.4, 'g', 7], [19.6, 'g', 20], [23, 'g', 25], [197, 'g', 195], [198, 'g', 200], [583, 'g', 580],
    [1.234, 'kg', 1.25], [0.01, 'kg', 0.05], [2, 'ml', 5], [212, 'ml', 210], [7.3, 'cl', 7.5], [0.73, 'l', 0.75],
    [1.2, 'cs', 1], [1.3, 'cs', 1.5], [0.1, 'cc', 0.5], [1.4, 'pc', 1.5], [1.2, 'pc', 1], [0.2, 'pc', 0.5],
    [1.4, 'sachet', 1], [0.3, 'tranche', 1], [2.5, 'pincee', 3], [1.6, 'botte', 2], [1.234, 'inconnue', 1.23],
  ];
  for (const [qte, unite, attendu] of cas) assert.equal(arrondiCuisine(qte, unite), attendu, `${qte} ${unite}`);
  assert.equal(arrondiCuisine(0, 'g'), 0);
  assert.equal(arrondiCuisine(-2, 'g'), -2);
  assert.equal(arrondiCuisine(null, 'g'), null);
});

test('arrondiCuisine : œufs, gousses et ail entiers (au moins 1) ; jamais « 1,5 œuf »', () => {
  const oeuf = { produit: 'œuf', marqueurs: ['oeuf'] };
  assert.equal(arrondiCuisine(1.5, 'pc', oeuf), 2);
  assert.equal(arrondiCuisine(1.4, 'pc', oeuf), 1);
  assert.equal(arrondiCuisine(0.3, 'pc', oeuf), 1);
  assert.equal(arrondiCuisine(2.6, 'pc', 'œufs'), 3);
  assert.equal(arrondiCuisine(1.5, 'pc', 'gousse d’ail'), 2);
  assert.equal(arrondiCuisine(1.5, 'pc', { produit: 'ail', marqueurs: ['legume'] }), 2);
  assert.equal(arrondiCuisine(1.5, 'pc', 'oignon jaune'), 1.5);
});

test('arrondiCuisine : jamais 0, jamais plus d’un demi-pas d’écart (au-dessus d’un pas), idempotente', () => {
  const hasard = generateur(7);
  const unites = ['g', 'kg', 'ml', 'cl', 'l', 'cs', 'cc', 'pc', 'sachet', 'boite', 'tranche', 'pincee', 'botte'];
  const pas = (q, u) => ({ g: q < 20 ? 1 : q < 200 ? 5 : 10, kg: 0.05, ml: q < 200 ? 5 : 10, cl: 0.5, l: 0.05, cs: 0.5, cc: 0.5, pc: 0.5 }[u] ?? 1);
  for (let i = 0; i < 2000; i += 1) {
    const unite = unites[Math.floor(hasard() * unites.length)];
    const qte = hasard() * (unite === 'g' || unite === 'ml' ? 1500 : 12);
    if (qte <= 0) continue;
    const r = arrondiCuisine(qte, unite);
    assert.ok(r > 0, `${qte} ${unite}`);
    if (qte >= pas(qte, unite)) assert.ok(Math.abs(r - qte) <= pas(qte, unite) / 2 + 1e-9, `${qte} ${unite} → ${r}`);
    assert.equal(arrondiCuisine(r, unite), r, `idempotente : ${qte} ${unite}`);
  }
});

test('texteQuantiteCuisine : nombres à la française, unités lisibles', () => {
  assert.equal(texteQuantiteCuisine(600, 'g'), '600\u00A0g');
  assert.equal(texteQuantiteCuisine(1.5, 'pc'), '1,5');
  assert.equal(texteQuantiteCuisine(2, 'cs'), '2\u00A0c. à soupe');
  assert.equal(texteQuantiteCuisine(2, null), '2');
});

// ——— Une étape ———

test('quantitesDeLEtape : quantités de la semaine, `part` avant l’arrondi, produit en double additionné', () => {
  const semaine = SEMAINES['versions mer et végétale par défaut, retraits, placard'];
  const q = quantitesACuisiner(CARBONADE, elementDe(semaine, 'carbonade-flamande'));
  const etapes = etapesLisibles(CARBONADE).etapes;
  assert.deepEqual(quantitesDeLEtape(etapes[2], q).map((x) => x.texte), ['Beurre · 28\u00A0g', 'Lardon fumé · 50\u00A0g'], 'beurre pour 4 (facteur 1) × 0,7 ; lardons pour Adulte A seul');
  assert.deepEqual(quantitesDeLEtape(etapes[3], q).map((x) => x.texte), ['Beurre · 12\u00A0g']);
  assert.deepEqual(quantitesDeLEtape(etapes[1], q).map((x) => x.texte), ['Bœuf à braiser · 400\u00A0g']);
  const six = quantitesACuisiner(CARBONADE, { ...elementDe(semaine, 'carbonade-flamande'), aCuire: 6 });
  assert.deepEqual(quantitesDeLEtape(etapes[2], six).map((x) => x.texte), ['Beurre · 40\u00A0g', 'Lardon fumé · 100\u00A0g'], '0,7 × 60 g = 42 g → 40 g');
  // Recette telle quelle : 0,7 × 40 g = 28 g (seule la part : arrondi au gramme) ; 0,3 × 3 pièces = 0,9 → 1.
  const recette = quantitesACuisiner(CARBONADE, null);
  assert.deepEqual(quantitesDeLEtape(etapes[2], recette).map((x) => x.texte), ['Beurre · 28\u00A0g', 'Lardon fumé · 100\u00A0g']);
  const oignons = quantitesACuisiner(CARBONADE, null);
  assert.deepEqual(quantitesDeLEtape({ ingredients: [{ produit: 'oignon jaune', part: 0.3 }] }, oignons).map((x) => x.texte), ['Oignon jaune · 1']);
  assert.deepEqual(quantitesDeLEtape({ ingredients: [{ produit: 'beurre', part: 0.33 }] }, oignons).map((x) => x.texte), ['Beurre · 13\u00A0g']);
  // Produit en double dans la fiche (beurre en g et en c. à soupe) ; produit introuvable ; citation en double.
  const etape = { ingredients: [{ produit: 'beurre', part: 1 }, 'beurres', 'gingembre'] };
  assert.deepEqual(quantitesDeLEtape(etape, quantitesACuisiner(CURRY, null)), [
    { produit: 'beurre', texte: 'Beurre · 20\u00A0g + 1\u00A0c. à soupe', qte: 20, unite: 'g', mesures: [{ unite: 'g', qte: 20 }, { unite: 'cs', qte: 1 }] },
    { produit: 'gingembre', texte: 'Gingembre', qte: null, unite: null, mesures: [] },
  ]);
  // Toutes les parts retirent le produit.
  const sansA = semaineAvec({ 'carbonade-flamande': dans(1, { mange: { 'profil-a': false } }) });
  const seulB = quantitesACuisiner(CARBONADE, elementDe(sansA, 'carbonade-flamande'));
  assert.equal(quantitesDeLEtape(etapes[1], seulB)[0].texte, 'Bœuf à braiser · pas cette fois');
});

test('aussiDeLEtape : mesures à l’échelle des portions ; eau et sel de cuisson (`fixe`) jamais', () => {
  const etapes = etapesLisibles(GRATIN).etapes;
  assert.deepEqual(aussiDeLEtape(etapes[1], 1.5).map((a) => a.texte), ['Eau · 3\u00A0l']);
  assert.deepEqual(aussiDeLEtape(etapes[2], 1.5).map((a) => a.texte), ['Gros sel · 1\u00A0c. à soupe']);
  assert.deepEqual(aussiDeLEtape(etapes[5], 1.5).map((a) => a.texte), ['Poivre noir']);
  const dauphinois = etapesLisibles(DAUPHINOIS).etapes;
  assert.deepEqual(aussiDeLEtape(dauphinois[1], 1).map((a) => a.texte), ['Sel fin · 1\u00A0c. à café', 'Poivre noir']);
  assert.deepEqual(aussiDeLEtape(dauphinois[1], 1.5).map((a) => a.texte), ['Sel fin · 1,5\u00A0c. à café', 'Poivre noir']);
  assert.deepEqual(aussiDeLEtape({}, 2), []);
});

// ——— Hygiène ———

test('hygieneDuPlat : mains toujours ; planche pour le cru (jamais charcuterie ni « fumé ») ; œufs ; cuisson à cœur', () => {
  const plat = (...ingredients) => ({ ingredients });
  assert.deepEqual(hygieneDuPlat(plat(ing('jambon blanc', 4, 'tranche', 'charcuterie', ['viande', 'porc', 'charcuterie']))), ['mains']);
  assert.deepEqual(hygieneDuPlat(plat(ing('saumon fumé', 4, 'tranche', 'poissonnerie', ['poisson']))), ['mains']);
  assert.deepEqual(hygieneDuPlat(plat(ing('pavé de saumon', 2, 'pc', 'poissonnerie', ['poisson']))), ['mains', 'planche']);
  assert.deepEqual(hygieneDuPlat(plat(ing('haut de cuisse de poulet', 600, 'g', 'boucherie', ['volaille']))), ['mains', 'planche', 'coeur']);
  assert.deepEqual(hygieneDuPlat(plat(ing('bœuf haché', 400, 'g', 'boucherie', ['viande', 'boeuf'], { forme: 'hachee' }))), ['mains', 'planche', 'coeur']);
  assert.deepEqual(hygieneDuPlat(plat(ing('bœuf à braiser', 800, 'g', 'boucherie', ['viande', 'boeuf'], { forme: 'morceaux' }))), ['mains', 'planche']);
  assert.deepEqual(hygieneDuPlat(plat(ing('œuf', 3, 'pc', 'cremerie', ['oeuf']))), ['mains', 'oeufs']);
  assert.deepEqual(hygieneDuPlat(plat(ing('crevette', 200, 'g', 'poissonnerie', ['fruits_de_mer']))), ['mains', 'planche']);
  assert.deepEqual(hygieneDuPlat(null), ['mains']);
});

test('etapesDuCoeur : le conseil 3 va sur l’étape qui cuit le produit (appareil et signe « prêt »)', () => {
  const poulet = {
    ingredients: [ing('haut de cuisse de poulet', 600, 'g', 'boucherie', ['volaille']), ing('patate douce', 500, 'g', 'fruits_legumes', ['legume'], { role: 'principal' }),
      ing('gingembre frais', 1, 'pc', 'fruits_legumes'), ing('miso blanc', 2, 'cs', 'epicerie_salee', ['soja']), ing('miel', 1, 'cs', 'epicerie_sucree', ['miel']),
      ing('riz basmati', 300, 'g', 'epicerie_salee', ['feculent'])],
    cuisson: [{ appareil: 'four', tempC: 200, dureeMin: 35 }, { appareil: 'plaque', dureeMin: 12 }],
  };
  const lus = etapesLisibles(avecRealisation(poulet, REALISATION_POULET)).etapes;
  assert.deepEqual([...etapesDuCoeur(lus, poulet)], [3]);
  assert.deepEqual([...etapesDuCoeur(etapesLisibles(CARBONADE).etapes, CARBONADE)], [], 'bœuf en morceaux, lardons : rien');
});

test('CONSEILS : les sept textes fixes du plan §8.7, avec leur moment', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CONSEILS).map(([k, v]) => [k, v.moment])), {
    mains: 'avant', planche: 'avant', coeur: 'cuisson', boites: 'ranger', etiquette: 'ranger', congeler: 'ranger', decongeler: 'ranger',
  });
  assert.equal(CONSEILS.mains.texte, 'Lavez-vous les mains avant de commencer, et chaque fois que vous avez touché de la viande, du poisson ou des œufs crus.');
  assert.equal(CONSEILS.planche.texte, 'Une planche et un couteau pour le cru, d’autres pour les légumes et le cuit.');
  assert.equal(CONSEILS.coeur.texte, 'Volaille, viande hachée et porc se mangent cuits à cœur\u00A0: plus du tout rosés au centre.');
  assert.equal(CONSEILS.boites.texte, 'Mettez en boîtes peu profondes, couvercle entrouvert, laissez tiédir une heure au plus, puis au frigo en moins de 2\u00A0heures.');
  assert.equal(CONSEILS.etiquette.texte, 'Étiquetez chaque boîte\u00A0: plat, pour qui, date de cuisson et date limite.');
  assert.equal(CONSEILS.congeler.texte, 'Congelez le jour même ce qui ne sera pas mangé à temps.');
  assert.equal(CONSEILS.decongeler.texte, 'Décongelez au frigo, réchauffez une seule fois jusqu’à ce que le centre soit bien chaud, et ne recongelez jamais un plat décongelé.');
  for (const { texte } of Object.values(CONSEILS)) assert.ok(!/ [:;!?]/.test(texte), 'espace insécable avant la ponctuation haute');
});

// ——— Précautions 🧸 ———

test('precautionsDuPlat et lignesEnfant : l’enfant qui en mange, le plat tel qu’il lui est servi ; ❌ pour le gestionnaire seul', () => {
  const sansEnfant = elementDe(SEMAINES['versions mer et végétale par défaut, retraits, placard'], 'carbonade-flamande');
  assert.deepEqual(precautionsDuPlat(CARBONADE, { element: sansEnfant, profils: PROFILS, evaluer }), [], '« pas avant 1 an » : il n’en mange pas');
  const coche = elementDe(SEMAINES['cases cochées à la main : un profil sans version mange la recette, un autre n’en mange pas'], 'carbonade-flamande');
  const liste = precautionsDuPlat(CARBONADE, { element: coche, profils: PROFILS, evaluer });
  assert.equal(liste.length, 1);
  assert.equal(liste[0].profil.id, 'enfant');
  const gestionnaire = lignesEnfant(liste, { role: 'gestionnaire' });
  assert.equal(gestionnaire[0].symbole, '❌');
  assert.match(gestionnaire[0].texte, /^🧸 Pour Enfant\u00A0: ❌ Pas avant 1 an\u00A0: miel \(pain d'épices\)\./);
  const courses = lignesEnfant(liste, { role: 'courses' });
  assert.equal(courses[0].symbole, null);
  assert.match(courses[0].texte, /^🧸 Pour Enfant\u00A0: Pas avant 1 an\u00A0: miel/);
  // Hors semaine : tous les profils qui ont une précaution d'âge.
  assert.equal(precautionsDuPlat(CARBONADE, { profils: PROFILS, evaluer }).length, 1);
});

// ——— Fin de cuisson ———

test('finDeCuisson : cuit le 18, 3 jours → au plus tard le 21 (compris) ; congeler si la semaine finit après', () => {
  const semaine = SEMAINES['versions mer et végétale par défaut, retraits, placard'];
  const element = elementDe(semaine, 'gratin-pates-jambon');
  const fin = finDeCuisson(GRATIN, element, '2026-10-18', { finSemaine: '2026-10-23' });
  assert.equal(fin.auPlusTard, '2026-10-21');
  assert.equal(fin.jours, 3);
  assert.equal(fin.auFrigo, element.aCuire);
  assert.equal(fin.aCongeler, 0);
  assert.equal(fin.congelerSiApres, '2026-10-21');
  assert.deepEqual({ ...fin.partFragile, profil: fin.partFragile.profil.id }, { profil: 'profil-b', style: 'mer', jours: 2, auPlusTard: '2026-10-20' });
  assert.equal(texteDateLimite('2026-10-21'), 'au plus tard le mercredi 21 octobre');
  const phrases = phrasesDeFin(fin);
  assert.equal(phrases.titre, 'C’est prêt 🎉');
  assert.equal(phrases.portions, `${element.aCuire}\u00A0portions au frigo, au plus tard le mercredi 21 octobre.`);
  assert.equal(phrases.partFragile, '🐟 La part d’Adulte B\u00A0: au plus tard le mardi 20 octobre.');
  assert.equal(phrases.congeler, 'Si vous en mangez après le mercredi 21\u00A0: congelez ces portions aujourd’hui, sortez-les au frigo la veille.');
  assert.deepEqual(phrases.conseils, [CONSEILS.boites.texte, CONSEILS.etiquette.texte, CONSEILS.congeler.texte, CONSEILS.decongeler.texte]);
  assert.equal(phrasesDeFin(fin, { moi: B }).partFragile, '🐟 Votre part\u00A0: au plus tard le mardi 20 octobre.');
  // Avec des portions à congeler ; la semaine finit avant la date limite.
  const congele = elementDe(SEMAINES['végétale choisie, invités, repas touché, portions à congeler'], 'gratin-pates-jambon');
  const fin2 = finDeCuisson(GRATIN, congele, '2026-10-18', { finSemaine: '2026-10-20' });
  assert.equal(fin2.congelerSiApres, null);
  const phrases2 = phrasesDeFin(fin2);
  assert.equal(phrases2.portions, `${String(congele.aCuire + 2).replace('.', ',')}\u00A0portions\u00A0: ${String(congele.aCuire).replace('.', ',')} au frigo, au plus tard le mercredi 21 octobre\u00A0; 2 au congélateur.`);
  assert.deepEqual(phrases2.conseils, [CONSEILS.boites.texte, CONSEILS.etiquette.texte, CONSEILS.decongeler.texte]);
  // Sans semaine : portions de la recette, jours de la fiche, sinon du foyer, sinon 3.
  assert.equal(finDeCuisson(CURRY, null, '2026-10-18').auPlusTard, '2026-10-22');
  assert.equal(finDeCuisson(SANS_BASE, null, '2026-10-18', { reglages: { frigoJoursDefaut: 2 } }).auPlusTard, '2026-10-20');
  assert.equal(finDeCuisson(SANS_BASE, null, '2026-10-18').auPlusTard, '2026-10-21');
  assert.equal(finDeCuisson(CURRY, null, '2026-10-18').auFrigo, 4);
});

test('finDeCuisson : un plat qui ne se congèle pas n’est jamais conseillé au congélateur', () => {
  const semaine = SEMAINES['versions mer et végétale par défaut, retraits, placard'];
  const element = elementDe(semaine, 'gratin-pates-jambon');
  const pasCongelable = { ...GRATIN, conservation: { ...(GRATIN.conservation ?? {}), congelable: false } };
  const fin = finDeCuisson(pasCongelable, element, '2026-10-18', { finSemaine: '2026-10-23' });
  assert.equal(fin.congelerSiApres, null);
  assert.equal(fin.aFinirAvant, '2026-10-21');
  const phrases = phrasesDeFin(fin);
  assert.equal(phrases.congeler, 'Ce plat ne se congèle pas\u00A0: prévoyez de le finir au plus tard le mercredi 21.');
  assert.deepEqual(phrases.conseils, [CONSEILS.boites.texte, CONSEILS.etiquette.texte]);
  assert.ok(!/congelez/i.test([phrases.congeler, ...phrases.conseils].join(' ')));
  // La semaine finit avant la date limite : rien à dire.
  const court = finDeCuisson(pasCongelable, element, '2026-10-18', { finSemaine: '2026-10-20' });
  assert.equal(court.aFinirAvant, null);
  assert.equal(phrasesDeFin(court).congeler, null);
  // `congelable` absent : tenu pour congelable, comme avant.
  const sansInfo = { ...GRATIN, conservation: { frigoJours: 3 } };
  assert.equal(finDeCuisson(sansInfo, element, '2026-10-18', { finSemaine: '2026-10-23' }).congelerSiApres, '2026-10-21');
  assert.equal(finDeCuisson(sansInfo, element, '2026-10-18', { finSemaine: '2026-10-23' }).aFinirAvant, null);
});

test('texteHeure et texteFrigoAvant : deux heures après la fin de la cuisson', () => {
  assert.equal(AU_FRIGO_AVANT_MIN, 120);
  assert.equal(texteHeure(new Date(2026, 9, 18, 14, 30)), '14\u00A0h\u00A030');
  assert.equal(texteHeure(new Date(2026, 9, 18, 9, 5)), '9\u00A0h\u00A005');
  assert.equal(texteHeure(new Date(2026, 9, 18, 14, 0)), '14\u00A0h');
  assert.equal(texteFrigoAvant(new Date(2026, 9, 18, 12, 30)), '🧊 Au frigo avant 14\u00A0h\u00A030');
  assert.equal(texteFrigoAvant(null), '');
});

// ——— Semaine, bouton ———

test('elementPourCuisiner : semaine montrée, sinon semaine en cours ; plat retiré ou hors semaine : null', () => {
  const montree = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', plats: { 'curry-lentilles': dans(1), 'gratin-pates-jambon': dans(2, { retire: true }) } };
  const options = { semaines: [montree], aujourdhui: '2026-10-18', tousLesPlats: TOUS, profils: PROFILS, evaluer };
  const element = elementPourCuisiner('curry-lentilles', options);
  assert.equal(element.platId, 'curry-lentilles');
  assert.deepEqual(element.semaine, { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23' });
  assert.equal(elementPourCuisiner('gratin-pates-jambon', options), null);
  assert.equal(elementPourCuisiner('carbonade-flamande', options), null);
  // La semaine suivante est montrée (elle a un plat) : le plat de la semaine en cours reste trouvé.
  const enCours = { id: '2026-10-10', debut: '2026-10-10', fin: '2026-10-16', plats: { 'carbonade-flamande': dans(1) } };
  const suivante = { id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', plats: { 'curry-lentilles': dans(1) } };
  const deux = { ...options, semaines: [enCours, suivante], aujourdhui: '2026-10-15' };
  assert.equal(elementPourCuisiner('carbonade-flamande', deux).semaine.id, '2026-10-10');
  assert.equal(elementPourCuisiner('curry-lentilles', deux).semaine.id, '2026-10-17');
  assert.equal(elementPourCuisiner('curry-lentilles', { ...deux, aujourdhui: new Date(2026, 9, 15) }).semaine.id, '2026-10-17');
});

test('boutonCuisiner et peutCuisiner : principal dans la semaine ; absent pour un plat ⏳, de la corbeille, sans étapes', () => {
  const semaines = [{ id: '2026-10-17', debut: '2026-10-17', fin: '2026-10-23', plats: { 'curry-lentilles': dans(1) } }];
  assert.deepEqual(boutonCuisiner(CURRY, { semaines, aujourdhui: '2026-10-18' }),
    { visible: true, principal: true, libelle: '👩‍🍳 Cuisiner pas à pas', lien: '#/cuisiner/curry-lentilles' });
  assert.equal(boutonCuisiner(GRATIN, { semaines, aujourdhui: '2026-10-18' }).principal, false);
  assert.equal(boutonCuisiner(GRATIN, { semaines, aujourdhui: '2026-10-18' }).visible, true);
  for (const plat of [ATTENTE, JETE, { ...CURRY, etapes: [], cuisson: [] }, null]) {
    assert.equal(peutCuisiner(plat), false);
    assert.equal(boutonCuisiner(plat ?? {}, { semaines }).visible, false);
  }
});

// ——— Reprise ———

test('reprise : clés du téléphone, 12 heures au plus, étape disparue → « Avant de commencer »', () => {
  assert.equal(cleReprise('uid-1', 'gratin'), 'repas-courses:cuisine:uid-1:gratin');
  assert.equal(cleTexteCuisine('uid-1'), 'repas-courses:texte-cuisine:uid-1');
  assert.equal(REPRISE_HEURES, 12);
  const valeur = valeurReprise({ etape: '4', portions: 'recette', cases: ['ing:beurre', 'ing:beurre', 3], maintenant: 1000 });
  assert.deepEqual(valeur, { etape: '4', portions: 'recette', cases: ['ing:beurre'], le: 1000 });
  assert.deepEqual(lireReprise(JSON.stringify(valeur), { maintenant: 1000 + 3_600_000, cles: ['1', '4'] }), valeur);
  assert.equal(lireReprise(JSON.stringify(valeur), { maintenant: 1000 + 12 * 3_600_000 + 1 }), null);
  assert.equal(lireReprise('{abîmé', { maintenant: 1000 }), null);
  assert.equal(lireReprise(null), null);
  assert.equal(lireReprise({ ...valeur, etape: '9' }, { maintenant: 2000, cles: ['1', '4'] }).etape, 'avant');
  assert.equal(lireReprise({ ...valeur, etape: 'fin' }, { maintenant: 2000, cles: ['1'] }).etape, 'fin');
  assert.equal(TEXTES_CUISINE.reprise(4), 'Vous en étiez à l’étape 4.');
});

// ——— Le pas à pas ———

test('pasAPas : états (introuvable, corbeille, sans recette, sans étapes)', () => {
  assert.equal(pasAPas(null).etat, 'introuvable');
  assert.equal(pasAPas(JETE).etat, 'corbeille');
  assert.equal(pasAPas(ATTENTE).etat, 'sansRecette');
  assert.equal(pasAPas({ ...CURRY, etapes: [], cuisson: [] }).etat, 'sansEtapes');
  assert.equal(TEXTES_CUISINE.sansEtapes, 'Cette recette n’a pas encore d’étapes.');
  assert.equal(pasAPas(CURRY).titrePage, 'Cuisiner\u00A0: Curry de lentilles');
});

test('pasAPas : gratin dauphinois (réponse réelle) : fin implicite « Sortir du four » avec le signe du four', () => {
  const ecran = pasAPas(DAUPHINOIS, { aujourdhui: '2026-10-18' });
  assert.equal(ecran.etat, 'ok');
  assert.equal(ecran.detaillee, true);
  assert.equal(ecran.total, 6);
  const derniere = ecran.etapes.at(-1);
  assert.deepEqual([derniere.cle, derniere.n, derniere.rang, derniere.implicite, derniere.titre, derniere.texte, derniere.pret, derniere.ligneAppareil],
    ['5-fin', null, 6, 'four', FINS_IMPLICITES.four.titre, FINS_IMPLICITES.four.texte, DAUPHINOIS.realisation[4].pret, '']);
  assert.match(FINS_IMPLICITES.four.texte, /sortez le plat du four/);
  assert.deepEqual(ecran.service.map((e) => e.titre), ['Réchauffer une portion']);
  assert.ok(!ecran.etapes.some((e) => e.titre === 'Réchauffer une portion'));
  const four = ecran.etapes.flatMap((e) => e.rappels).filter((r) => r.genre === 'four');
  assert.deepEqual(four.map((r) => r.texte), ['🔥 Allumez le four à 180\u00A0°C maintenant\u00A0: il servira à «\u00A0Cuire au four\u00A0».']);
  assert.equal(ecran.portions.bascule, false);
  assert.equal(ecran.portions.choisies, 'recette');
  assert.match(ecran.duree.texte, /^Environ 1\u00A0h\u00A0\d\d, dont \d+\u00A0min de travail$/);
  assert.deepEqual(ecran.etapes[0].quantites, [{ produit: 'pomme de terre', texte: 'Pomme de terre · 1\u00A0kg' }]);
  assert.deepEqual(ecran.avant.hygiene, [`🧼 ${CONSEILS.mains.texte}`]);
  assert.deepEqual(ecran.avant.parts, []);
  assert.equal(ecran.avant.reunir.aussi, 'Et aussi\u00A0: sel fin, poivre noir');
  assert.deepEqual(ecran.avant.reunir.ustensiles.slice(0, 3), [
    { cle: 'ust:eplucheur', nom: 'Éplucheur' }, { cle: 'ust:planche', nom: 'Planche' }, { cle: 'ust:couteau', nom: 'Couteau' },
  ]);
  assert.equal(ecran.fin.portions, '4\u00A0portions au frigo, au plus tard le mercredi 21 octobre.');
});

test('pasAPas : carbonade (réponse réelle) dans la semaine : part d’Adulte B mise de côté avant l’étape 2, quantités de la semaine', () => {
  const semaine = SEMAINES['versions mer et végétale par défaut, retraits, placard'];
  const element = { ...elementDe(semaine, 'carbonade-flamande'), semaine: { id: S.id, debut: S.debut, fin: S.fin } };
  const ecran = pasAPas(CARBONADE, { element, profils: PROFILS, evaluer, role: 'gestionnaire', aujourdhui: '2026-10-18' });
  assert.deepEqual(ecran.avant.parts, ['✂️ La part d’Adulte B se met de côté avant l’étape 2\u00A0: Mettre sa part de côté avant la viande ; seitan saisi, même sauce.']);
  const couper = ecran.etapes.find((e) => e.n === 2);
  assert.equal(couper.rang, 2);
  assert.deepEqual(couper.rappels.map((r) => r.genre), ['part']);
  assert.equal(couper.rappels[0].texte, '✂️ Mettez de côté la part d’Adulte B maintenant, avec une cuillère propre.');
  assert.deepEqual(couper.rappels[0].case, { cle: 'part:profil-b', libelle: 'Part d’Adulte B mise de côté' });
  assert.deepEqual(couper.rappels[0].ajouts, ['Seitan · 240\u00A0g']);
  assert.deepEqual(couper.quantites.map((q) => q.texte), ['Bœuf à braiser · 400\u00A0g']);
  assert.ok(ecran.avant.reunir.ingredients.some((i) => i.texte === 'Seitan · 240\u00A0g (part d’Adulte B)'));
  assert.ok(ecran.avant.reunir.ingredients.some((i) => i.texte === 'Beurre · 40\u00A0g'), 'le beurre réuni (0,7 + 0,3)');
  assert.deepEqual(ecran.avant.hygiene, [`🧼 ${CONSEILS.mains.texte}`, CONSEILS.planche.texte]);
  assert.deepEqual(ecran.avant.enfant, [], 'l’enfant n’en mange pas (miel)');
  assert.ok(!ecran.etapes.some((e) => e.implicite), '« Finir la sauce » suit déjà le four');
  // Pour soi.
  const moi = pasAPas(CARBONADE, { element, profils: PROFILS, evaluer, moi: B, aujourdhui: '2026-10-18' });
  assert.equal(moi.avant.parts[0].slice(0, 30), '✂️ Votre part se met de côté a');
  assert.equal(moi.etapes.find((e) => e.n === 2).rappels[0].case.libelle, 'Votre part mise de côté');
});

test('pasAPas : enfant coché à la main : 🧸 en tête de l’étape qui utilise le produit en cause', () => {
  const semaine = SEMAINES['cases cochées à la main : un profil sans version mange la recette, un autre n’en mange pas'];
  const element = elementDe(semaine, 'carbonade-flamande');
  const ecran = pasAPas(CARBONADE, { element, profils: PROFILS, evaluer, role: 'gestionnaire', aujourdhui: '2026-10-18' });
  assert.equal(ecran.avant.enfant.length, 1);
  const etape = ecran.etapes.find((e) => e.rappels.some((r) => r.genre === 'enfant'));
  assert.equal(etape.n, 5, 'l’étape qui ajoute le pain d’épices');
  const rappel = etape.rappels.find((r) => r.genre === 'enfant');
  assert.match(rappel.texte, /^🧸 Pour Enfant\u00A0: ❌ /);
  const vueCourses = pasAPas(CARBONADE, { element, profils: PROFILS, evaluer, role: 'courses', aujourdhui: '2026-10-18' });
  assert.ok(!vueCourses.etapes.find((e) => e.n === 5).rappels.some((r) => r.texte.includes('❌')));
});

test('pasAPas : sans `partAvant`, la part se met de côté avant la première étape qui utilise un ingrédient retiré', () => {
  const gratin = avecRealisation({ ...GRATIN }, REALISATION_GRATIN.map(({ partAvant: _p, ...e }) => e));
  const semaine = semaineAvec({ 'gratin-pates-jambon': dans(1) });
  const element = elementDe(semaine, 'gratin-pates-jambon');
  const ecran = pasAPas(gratin, { element, profils: PROFILS, evaluer, aujourdhui: '2026-10-18' });
  const avec = ecran.etapes.find((e) => e.rappels.some((r) => r.genre === 'part'));
  assert.equal(avec.n, 6, 'la sauce, qui ajoute le jambon');
  assert.match(ecran.avant.parts[0], new RegExp(`avant l’étape ${avec.rang}\u00A0: Part au thon\\.$`));
});

test('pasAPas : gratin de pâtes : l’eau d’abord, « Pendant que ça cuit », four allumé à temps, bascule des portions', () => {
  const semaine = semaineAvec({ 'gratin-pates-jambon': dans(1, { invites: { adultes: 2 } }) });
  const element = elementDe(semaine, 'gratin-pates-jambon');
  const ecran = pasAPas(GRATIN, { element, profils: PROFILS, evaluer, aujourdhui: '2026-10-18' });
  assert.equal(ecran.etapes[0].titre, 'Faire chauffer l\'eau des pâtes');
  assert.equal(ecran.etapes[0].pendant, true);
  assert.equal(TEXTES_CUISINE.pendant, 'Pendant que ça cuit\u00A0: passez à l’étape suivante.');
  assert.equal(ecran.etapes.at(-1).titre, 'Sortir le gratin', 'pas de fin implicite : le geste est écrit');
  const total = element.aCuire;
  assert.deepEqual(ecran.portions, {
    choisies: 'semaine', semaine: total, recette: 4, bascule: true, legende: 'Quantités pour\u00A0:',
    options: [
      { valeur: 'semaine', libelle: `${String(total).replace('.', ',')}\u00A0portions (cette semaine)` },
      { valeur: 'recette', libelle: '4\u00A0portions (la recette)' },
    ],
  });
  const recette = pasAPas(GRATIN, { element, profils: PROFILS, evaluer, portions: 'recette', aujourdhui: '2026-10-18' });
  assert.equal(recette.portions.choisies, 'recette');
  assert.deepEqual(recette.etapes.find((e) => e.n === 3).quantites.map((q) => q.texte), ['Pâtes courtes · 400\u00A0g']);
  assert.equal(recette.fin.portions, '4\u00A0portions au frigo, au plus tard le mercredi 21 octobre.');
  assert.ok(recette.etapes.find((e) => e.n === 6).rappels.some((r) => r.genre === 'part'), 'la part reste à mettre de côté');
  const etapeFour = ecran.etapes.find((e) => e.rappels.some((r) => r.genre === 'four'));
  const gratiner = ecran.etapes.find((e) => e.n === 8);
  assert.ok(etapeFour.debut <= gratiner.debut - 10, 'allumé au moins dix minutes avant');
  assert.equal(ecran.etapes.find((e) => e.n === 2).aussi[0], 'Eau · 3\u00A0l', 'l’eau des pâtes ne suit pas les portions');
});

test('pasAPas : gâteau (réponse réelle, étapes en parallèle) : ordre calculé, fin implicite, préchauffage avant le four', () => {
  const ecran = pasAPas(GATEAU_CHOCOLAT, { aujourdhui: '2026-10-18' });
  const rang = new Map(ecran.etapes.map((e) => [e.cle, e.rang]));
  assert.ok(rang.get('3') > rang.get('1') && rang.get('3') > rang.get('2'));
  assert.ok(rang.get('5') > rang.get('4'));
  assert.equal(ecran.etapes.at(-1).cle, '6-fin');
  const four = ecran.etapes.find((e) => e.rappels.some((r) => r.genre === 'four'));
  assert.ok(four.rang < rang.get('6'));
  // Des œufs : « Après avoir cassé des œufs, relavez-vous les mains. » (plan §8.5 ; relecture de T5-1).
  assert.deepEqual(ecran.avant.hygiene, [`🧼 ${CONSEILS.mains.texte}`, TEXTES_CUISINE.oeufs]);
  assert.equal(TEXTES_CUISINE.oeufs, 'Après avoir cassé des œufs, relavez-vous les mains.');
  assert.equal(ecran.fin.portions, '6\u00A0portions au frigo, au plus tard le jeudi 22 octobre.');
});

test('pasAPas : recette sans étapes détaillées (repli) : ordre de la recette, four sur la première étape, « Sortir du four »', () => {
  const ecran = pasAPas(GATEAU, { aujourdhui: '2026-10-18' });
  assert.equal(ecran.detaillee, false);
  assert.equal(ecran.estime, true);
  // Les cuissons de la fiche ne sont pas des étapes après les phrases (relecture de T5-1) : en puces, avant.
  assert.deepEqual(ecran.etapes.map((e) => e.titre), [...GATEAU.etapes, 'Sortir du four']);
  assert.deepEqual(ecran.avant.cuissons, ['Four · 180\u00A0°C · 35\u00A0min']);
  assert.deepEqual(ecran.etapes[0].rappels.map((r) => r.texte), ['🔥 Allumez le four à 180\u00A0°C maintenant\u00A0: il servira à «\u00A0Four · 180\u00A0°C · 35\u00A0min\u00A0».']);
  assert.equal(ecran.duree.texte, 'Environ 45\u00A0min, dont 10\u00A0min de travail');
  assert.ok(ecran.etapes.every((e) => e.pendant === false));
});

test('rappelsDeLEtape : ordre four, part, enfant sur une même étape', () => {
  const sequence = [{ cle: '1', titre: 'Préparer', citations: [{ cle: 'miel' }] }, { cle: '2', titre: 'Cuire', citations: [] }];
  const contexte = {
    sequence,
    prechauffages: [{ appareil: 'four', tempC: 200, pour: '2', avant: '1' }],
    parts: [{ profil: B, consigne: 'Sans miel.', etape: '1', ajouts: [] }],
    precautions: [{ profil: E, precautions: [{ code: 'miel', severite: 'exclu', court: 'miel', jusquAMois: 12, produits: ['miel'] }] }],
    role: 'gestionnaire',
  };
  assert.deepEqual(rappelsDeLEtape(contexte, '1').map((r) => r.genre), ['four', 'part', 'enfant']);
  assert.deepEqual(rappelsDeLEtape(contexte, '2'), []);
  assert.equal(rappelsDeLEtape(contexte, '1')[2].texte, '🧸 Pour Enfant\u00A0: ❌ Pas avant 1 an\u00A0: miel (miel).');
  assert.equal(rappelsDeLEtape(contexte, '1')[1].consigne, 'Sans miel.');
});

test('textes de l’écran : libellés exacts du plan §8.5', () => {
  assert.equal(TEXTES_CUISINE.bouton, '👩‍🍳 Cuisiner pas à pas');
  assert.equal(TEXTES_CUISINE.etapeSur(3, 9), 'Étape 3 sur\u00A09');
  assert.equal(TEXTES_CUISINE.quitter, '✕ Quitter');
  assert.equal(TEXTES_CUISINE.plusGrand, 'A+');
  assert.equal(TEXTES_CUISINE.commencer, 'Commencer ›');
  assert.equal(TEXTES_CUISINE.suivante, 'Suivante ›');
  assert.equal(TEXTES_CUISINE.derniere, 'C’est prêt ›');
  assert.equal(TEXTES_CUISINE.precedenteNom, 'Étape précédente');
  assert.equal(TEXTES_CUISINE.sortirToutCeQuIlFaut, 'Sortir tout ce qu’il faut');
  assert.equal(TEXTES_CUISINE.avantDeCommencer, 'Avant de commencer');
  assert.equal(TEXTES_CUISINE.laVeille, 'La veille');
  assert.equal(TEXTES_CUISINE.fin, 'C’est prêt 🎉');
  assert.equal(TEXTES_CUISINE.pourBienConserver, 'Pour bien conserver');
  assert.equal(TEXTES_CUISINE.jourDuRepas, 'Le jour du repas');
  assert.equal(TEXTES_CUISINE.revenir, 'Revenir à la recette');
  assert.equal(TEXTES_CUISINE.ecranAllume, 'L’écran reste allumé.');
  assert.equal(TEXTES_CUISINE.pretQuand('Doré.'), '✓ Prêt quand\u00A0: Doré.');
});

// ——— Relecture de T5-1 ———

const MARINADE = (() => {
  const realisation = [
    { titre: 'Préparer la marinade', texte: 'Mélangez le yaourt et les épices, enrobez le poulet.', duree: 10, ingredients: ['haut de cuisse de poulet', 'yaourt nature'] },
    { titre: 'Laisser mariner', texte: 'Couvrez et laissez une nuit au frigo.', duree: 720, actif: 0 },
    { titre: 'Émincer les oignons', texte: 'Émincez les oignons.', duree: 8, apres: [], ingredients: ['oignon jaune'] },
    { titre: 'Cuire le poulet', texte: 'Faites dorer le poulet et les oignons.', duree: 20, actif: 10, appareil: 'plaque', feu: 'moyen', apres: [2, 3], pret: 'Plus du tout rosé au centre.' },
  ];
  return avecRealisation({
    id: 'poulet-marine', nom: 'Poulet mariné', type: 'plat', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [ing('haut de cuisse de poulet', 800, 'g', 'boucherie', ['volaille']), ing('yaourt nature', 250, 'g', 'cremerie', ['laitier']),
      ing('oignon jaune', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' })],
    cuisson: [{ appareil: 'plaque', dureeMin: 20 }],
  }, realisation);
})();

test('pasAPas : une marinade d’une nuit : ce dont dépend l’étape « la veille » passe la veille, dans l’ordre', () => {
  const ecran = pasAPas(MARINADE, { aujourdhui: '2026-10-18' });
  assert.deepEqual(ecran.avant.veille.map((e) => e.titre), ['Préparer la marinade', 'Laisser mariner']);
  assert.deepEqual(ecran.etapes.map((e) => e.titre), ['Émincer les oignons', 'Cuire le poulet']);
  assert.ok(!/Environ 12/.test(ecran.duree.texte), ecran.duree.texte);
});

test('pasAPas : longue cuisson au four après une étape du jour (porc effiloché) : les deux la veille, conseil de cuisson à cœur gardé', () => {
  const realisation = [
    { titre: 'Couper et saisir le porc', texte: 'Coupez l’échine en morceaux et saisissez-les.', duree: 15, appareil: 'plaque', feu: 'vif', ingredients: ['échine de porc'] },
    { titre: 'Cuire au four', texte: 'Couvrez et enfournez.', duree: 360, actif: 2, appareil: 'four', tempC: 120, pret: 'La viande s’effiloche.' },
    { titre: 'Effilocher', texte: 'Effilochez la viande.', duree: 10, apres: [2] },
  ];
  const porc = avecRealisation({
    id: 'porc', nom: 'Porc effiloché', type: 'plat', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [ing('échine de porc', 1.2, 'kg', 'boucherie', ['viande', 'porc'], { forme: 'morceaux' })],
    cuisson: [{ appareil: 'four', tempC: 120, dureeMin: 360 }],
  }, realisation);
  const ecran = pasAPas(porc, { aujourdhui: '2026-10-18' });
  // Seconde relecture : la cuisson de la veille a sa fin (« Sortir du four ») et le conseil de la mettre au frigo.
  assert.deepEqual(ecran.avant.veille.map((e) => e.titre), ['Couper et saisir le porc', 'Cuire au four', FINS_IMPLICITES.four.titre]);
  assert.deepEqual(ecran.avant.veille.find((e) => e.titre === 'Cuire au four').conseils, [CONSEILS.coeur.texte]);
  assert.deepEqual(ecran.avant.veille.at(-1).conseils, [TEXTES_CUISINE.frigoVeille]);
  assert.deepEqual(ecran.etapes.map((e) => e.titre), ['Effilocher']);
  // La viande cuite la veille (le 17) : 3 jours au frigo comptés depuis le 17 ; elle n'est pas à « sortir » le jour même.
  assert.equal(ecran.fin.details.jour, '2026-10-17');
  assert.equal(ecran.fin.details.auPlusTard, '2026-10-20');
  assert.match(ecran.fin.portions, /au plus tard le mardi 20 octobre\. Compté depuis la cuisson de la veille\.$/);
  assert.deepEqual(ecran.avant.reunir.ingredients, []);
  // Des yaourts : on mélange avant de faire prendre.
  const yaourts = avecRealisation({
    id: 'yaourts', nom: 'Yaourts maison', type: 'preparation', statutRecette: 'brouillon', portionsBase: 8,
    ingredients: [ing('lait', 1, 'l', 'cremerie', ['laitier']), ing('yaourt nature', 125, 'g', 'cremerie', ['laitier'])],
  }, [
    { titre: 'Mélanger', texte: 'Mélangez le lait et le yaourt, répartissez en pots.', duree: 10, ingredients: ['lait', 'yaourt nature'] },
    { titre: 'Faire prendre', texte: 'Laissez prendre 8 heures dans la yaourtière.', duree: 480, actif: 1 },
    { titre: 'Mettre au frigo', texte: 'Fermez les pots, au frigo.', duree: 2 },
  ]);
  const y = pasAPas(yaourts, { aujourdhui: '2026-10-18' });
  assert.deepEqual(y.avant.veille.map((e) => e.titre), ['Mélanger', 'Faire prendre']);
  assert.deepEqual(y.etapes.map((e) => e.titre), ['Mettre au frigo']);
});

test('pasAPas : hors semaine (depuis la fiche), la part d’Adulte B est mise de côté comme dans la semaine', () => {
  const ecran = pasAPas(CARBONADE, { profils: PROFILS, evaluer, aujourdhui: '2026-10-18' });
  assert.equal(ecran.portions.choisies, 'recette');
  assert.equal(ecran.avant.parts.length, 1);
  assert.match(ecran.avant.parts[0], /^✂️ La part d’Adulte B se met de côté avant l’étape \d/);
  const etape = ecran.etapes.find((e) => e.rappels.some((r) => r.genre === 'part'));
  assert.ok(etape, 'une étape porte le rappel et sa case');
  assert.equal(etape.rappels.find((r) => r.genre === 'part').case.libelle, 'Part d’Adulte B mise de côté');
  // Ses ajouts, sans quantité (aucun repas compté hors semaine), dans « Sortir tout ce qu’il faut ».
  assert.ok(ecran.avant.reunir.ingredients.some((i) => /\(part d’Adulte B\)$/.test(i.texte)));
  // « Jamais » : pas de part.
  const jamais = { ...CARBONADE, notes: { 'profil-b': 0 } };
  assert.deepEqual(pasAPas(jamais, { profils: PROFILS, evaluer, aujourdhui: '2026-10-18' }).avant.parts, []);
});

test('hygieneDuPlat : les ajouts d’une version servie comptent (part au saumon d’un gratin au jambon)', () => {
  const saumon = ajout('pavé de saumon', 1, 'pc', 'poissonnerie', ['poisson']);
  assert.deepEqual(hygieneDuPlat(GRATIN_EXEMPLE), ['mains']);
  assert.deepEqual(hygieneDuPlat(GRATIN_EXEMPLE, [saumon]), ['mains', 'planche']);
  const plat = { ...GRATIN, variantes: [{ ...MER, ajouter: [saumon] }] };
  const [element] = platsDeLaSemaine(semaineAvec({ [plat.id]: dans(1) }), { tousLesPlats: [plat], profils: PROFILS, evaluer });
  const ecran = pasAPas(plat, { element, profils: PROFILS, evaluer, aujourdhui: '2026-10-18' });
  assert.ok(ecran.avant.hygiene.includes(CONSEILS.planche.texte));
});

test('pasAPas : recette pas détaillée (gratin de pâtes) : les cuissons de la fiche ne passent pas après les phrases', () => {
  const ecran = pasAPas(GRATIN_EXEMPLE, { aujourdhui: '2026-10-18' });
  assert.deepEqual(ecran.etapes.map((e) => e.titre), [...GRATIN_EXEMPLE.etapes, 'Sortir du four']);
  assert.deepEqual(ecran.avant.cuissons, ['Plaque · 12 min', 'Four · 200 °C · 20 min']);
  assert.match(ecran.etapes[0].rappels[0].texte, /^🔥 Allumez le four à 200 °C maintenant/);
  // Sans phrases (cuissons seules) : les cuissons restent des étapes.
  const seules = pasAPas({ ...GRATIN_EXEMPLE, etapes: [] }, { aujourdhui: '2026-10-18' });
  assert.equal(seules.etat, 'ok');
  assert.ok(seules.etapes.length >= 2);
});

test('reprise : une étape gardée avec son titre est retrouvée par son titre si sa clé a changé', () => {
  const valeur = valeurReprise({ etape: '3', titre: 'Dorer la viande', maintenant: 1000 });
  assert.equal(valeur.titre, 'Dorer la viande');
  const etapes = [{ cle: '1', titre: 'Couper' }, { cle: '2', titre: 'Dorer la viande' }, { cle: '3', titre: 'Fondre les oignons' }];
  assert.equal(lireReprise(valeur, { maintenant: 2000, cles: ['1', '2', '3'], etapes }).etape, '2');
  assert.equal(lireReprise(valeur, { maintenant: 2000, cles: ['1', '2', '3'], etapes: etapes.filter((e) => e.cle !== '2') }).etape, 'avant');
  assert.equal(lireReprise({ ...valeur, titre: undefined }, { maintenant: 2000, cles: ['1', '2', '3'], etapes }).etape, '3', 'reprise d’avant : par la clé');
  assert.equal(lireReprise(valeurReprise({ etape: 'fin', titre: 'x', maintenant: 1000 }), { maintenant: 2000, etapes }).etape, 'fin');
});

test('pasAPas : la fin se calcule sur le jour de cuisson (fin rouverte le lendemain : même date limite)', () => {
  const veille = new Date(2026, 9, 18, 21, 0);
  const lendemain = new Date(2026, 9, 19, 8, 0);
  const a = pasAPas(DAUPHINOIS, { aujourdhui: veille }).fin.portions;
  assert.equal(a, pasAPas(DAUPHINOIS, { aujourdhui: '2026-10-18' }).fin.portions);
  assert.notEqual(a, pasAPas(DAUPHINOIS, { aujourdhui: lendemain }).fin.portions, 'l’écran passe le jour de cuisson, pas le jour d’affichage');
});

// ——— Seconde relecture de T5-1 ———

const avecMer = (frigoJours) => avecRealisation({ ...GRATIN_EXEMPLE, variantes: [{ ...MER, frigoJours }] }, REALISATION_GRATIN);

test('pasAPas : la part au poisson qui se garde moins a sa date en quantités « la recette » et hors semaine', () => {
  const plat = avecMer(1);
  const semaine = { ...S, plats: { [plat.id]: dans(1, { repas: 3 }) } };
  const [element] = platsDeLaSemaine(semaine, { tousLesPlats: [plat], profils: PROFILS, evaluer });
  const avecSemaine = { ...element, semaine: { id: S.id, debut: S.debut, fin: S.fin } };
  const attendu = '🐟 La part d’Adulte B\u00A0: au plus tard le lundi 19 octobre.';
  for (const portions of ['semaine', 'recette']) {
    const ecran = pasAPas(plat, { element: avecSemaine, profils: PROFILS, evaluer, portions, aujourdhui: '2026-10-18' });
    assert.equal(ecran.avant.parts.length, 1, portions);
    assert.equal(ecran.fin.partFragile, attendu, portions);
  }
  const hors = pasAPas(plat, { profils: PROFILS, evaluer, aujourdhui: '2026-10-18' });
  assert.equal(hors.avant.parts.length, 1);
  assert.equal(hors.fin.partFragile, attendu, 'hors semaine');
  // Une version qui se garde autant que le plat : rien de plus.
  assert.equal(pasAPas(avecMer(3), { profils: PROFILS, evaluer, aujourdhui: '2026-10-18' }).fin.partFragile, null);
});

const BOEUF_MARINE = (() => {
  const realisation = [
    { titre: 'Préparer la marinade', texte: 'Mélangez la sauce soja, le miel et l’ail.', duree: 5, ingredients: ['sauce soja', 'miel', 'ail'] },
    { titre: 'Mariner le bœuf', texte: 'Ajoutez le bœuf, couvrez, une nuit au frigo.', duree: 720, actif: 5, ingredients: ['bœuf à braiser'], partAvant: true },
    { titre: 'Émincer les oignons', texte: 'Émincez.', duree: 8, apres: [], ingredients: ['oignon jaune'] },
    { titre: 'Cuire', texte: 'Cuisez le tout en cocotte.', duree: 40, actif: 10, appareil: 'plaque', feu: 'moyen', apres: [2, 3], pret: 'Tendre.' },
  ];
  return avecRealisation({
    id: 'boeuf-marine', nom: 'Bœuf mariné', type: 'plat', statutRecette: 'brouillon', portionsBase: 4,
    ingredients: [ing('sauce soja', 4, 'cs', 'epicerie_salee'), ing('miel', 2, 'cs', 'epicerie_sucree', ['miel']),
      ing('ail', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' }),
      ing('bœuf à braiser', 800, 'g', 'boucherie', ['viande', 'boeuf'], { forme: 'morceaux' }),
      ing('oignon jaune', 2, 'pc', 'fruits_legumes', ['legume'], { role: 'incorpore' })],
    cuisson: [{ appareil: 'plaque', dureeMin: 40 }],
    variantes: [{ pour: 'profil-b', style: 'vegetal', retirer: ['bœuf à braiser'], ajouter: [ajout('tofu ferme', 120, 'g', 'cremerie', ['soja'])], consigne: 'Sa part au tofu.' }],
  }, realisation);
})();

test('pasAPas : une part à mettre de côté la veille (marinade) : rappel et case sur l’étape de la veille, 🧸 aussi', () => {
  const semaine = { ...S, plats: { [BOEUF_MARINE.id]: dans(1, { mange: { enfant: true } }) } };
  const [element] = platsDeLaSemaine(semaine, { tousLesPlats: [BOEUF_MARINE], profils: PROFILS, evaluer });
  const ecran = pasAPas(BOEUF_MARINE, { element: { ...element, semaine }, profils: PROFILS, evaluer, role: 'gestionnaire', aujourdhui: '2026-10-18' });
  assert.deepEqual(ecran.avant.veille.map((e) => e.titre), ['Préparer la marinade', 'Mariner le bœuf']);
  assert.deepEqual(ecran.avant.parts, ['✂️ La part d’Adulte B se met de côté la veille, avant «\u00A0Mariner le bœuf\u00A0»\u00A0: Sa part au tofu.']);
  const mariner = ecran.avant.veille.find((e) => e.titre === 'Mariner le bœuf');
  const part = mariner.rappels.find((r) => r.genre === 'part');
  assert.ok(part, 'le rappel de la part est sur l’étape de la veille');
  assert.equal(part.case.cle, 'part:profil-b');
  assert.ok(ecran.avant.veille[0].rappels.some((r) => r.genre === 'enfant'), 'le miel est rappelé à l’étape qui l’utilise');
  assert.ok(ecran.etapes.every((e) => !e.rappels.some((r) => r.genre === 'part')));
  // Rien de la marinade à « sortir » le jour même (sauf les oignons, cités le jour même).
  assert.deepEqual(ecran.avant.reunir.ingredients.map((i) => i.cle).filter((c) => c.startsWith('ing:')), ['ing:oignon-jaune']);
});

test('pasAPas : une version qui ajoute une volaille porte le conseil de cuisson à cœur avec sa part', () => {
  const C = { id: 'profil-c', nom: 'Adulte C', ordre: 4, coefPortion: 1, regles: [{ type: 'exclureProduits', produits: ['jambon blanc'], severite: 'exclu' }] };
  const plat = avecRealisation({ ...GRATIN_EXEMPLE, variantes: [{ pour: 'profil-c', retirer: ['jambon blanc'],
    ajouter: [ajout('blanc de poulet', 120, 'g', 'boucherie', ['viande', 'volaille'])], consigne: 'Sa part au poulet.' }] }, REALISATION_GRATIN);
  assert.deepEqual(etapesDuCoeur(etapesLisibles(plat).etapes, plat).size, 0, 'la fiche seule ne demande pas de cuisson à cœur');
  const ecran = pasAPas(plat, { profils: [A, C], evaluer, aujourdhui: '2026-10-18' });
  assert.equal(ecran.avant.parts.length, 1);
  assert.ok(ecran.avant.parts[0].endsWith(` ${CONSEILS.coeur.texte}`), ecran.avant.parts[0]);
  const part = ecran.etapes.flatMap((e) => e.rappels).find((r) => r.genre === 'part');
  assert.equal(part.consigne, `Sa part au poulet. ${CONSEILS.coeur.texte}`);
});

test('rappelsDeLEtape : « Rallumez » un four éteint, « Réglez » un four chaud, « Dès que le four est libre »', () => {
  const sequence = [{ cle: '1', titre: 'Préparer', citations: [] }, { cle: '2', titre: 'Cuire', citations: [] }];
  const texte = (p) => rappelsDeLEtape({ sequence, prechauffages: [{ appareil: 'four', tempC: 180, pour: '2', avant: '1', ...p }] }, '1')[0].texte;
  assert.equal(texte({ etat: 'allume' }), '🔥 Allumez le four à 180\u00A0°C maintenant\u00A0: il servira à «\u00A0Cuire\u00A0».');
  assert.equal(texte({ etat: 'rallume' }), '🔥 Rallumez le four à 180\u00A0°C maintenant\u00A0: il servira à «\u00A0Cuire\u00A0».');
  assert.equal(texte({ etat: 'regle' }), '🔥 Réglez le four à 180\u00A0°C maintenant\u00A0: il servira à «\u00A0Cuire\u00A0».');
  assert.equal(texte({ etat: 'regle', quandLibre: true }), '🔥 Dès que le four est libre, réglez-le à 180\u00A0°C\u00A0: il servira à «\u00A0Cuire\u00A0».');
});

test('pasAPas : un fond de tarte cuit à blanc puis refroidi une heure : le four est rallumé pour la tarte', () => {
  const realisation = [
    { titre: 'Foncer le moule', texte: 'Étalez la pâte dans le moule.', duree: 5 },
    { titre: 'Cuire à blanc', texte: 'Enfournez.', duree: 15, actif: 1, appareil: 'four', tempC: 180 },
    { titre: 'Sortir le fond', texte: 'Sortez le fond.', duree: 1 },
    { titre: 'Laisser refroidir', texte: 'Laissez refroidir.', duree: 60, actif: 0 },
    { titre: 'Garnir', texte: 'Garnissez.', duree: 5 },
    { titre: 'Cuire la tarte', texte: 'Enfournez.', duree: 30, actif: 1, appareil: 'four', tempC: 180 },
    { titre: 'Sortir la tarte', texte: 'Sortez la tarte.', duree: 1 },
  ];
  const tarte = avecRealisation({ id: 'tarte', nom: 'Tarte', type: 'dessert', statutRecette: 'brouillon', portionsBase: 6, ingredients: [ing('pâte brisée', 1, 'pc', 'cremerie')] }, realisation);
  const ecran = pasAPas(tarte, { aujourdhui: '2026-10-18' });
  const textes = ecran.etapes.flatMap((e) => e.rappels.filter((r) => r.genre === 'four').map((r) => [e.titre, r.texte]));
  assert.equal(textes.length, 2, JSON.stringify(textes));
  assert.match(textes[0][1], /^🔥 Allumez le four/);
  assert.match(textes[1][1], /^🔥 Rallumez le four à 180/);
});

test('reprise : le jour où l’on a commencé à cuisiner est gardé (élément de la semaine pris ce jour-là)', () => {
  const valeur = valeurReprise({ etape: '2', debut: 500, maintenant: 1000 });
  assert.equal(valeur.debut, 500);
  assert.equal(lireReprise(valeur, { maintenant: 2000 }).debut, 500);
  assert.equal(lireReprise(valeurReprise({ etape: '2', maintenant: 1000 }), { maintenant: 2000 }).debut, undefined);
});
