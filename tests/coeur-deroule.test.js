// T5-1 « Cuisiner pas à pas » : l'ordonnanceur (coeur/deroule.js, plan §6.4) : règles, invariants sur 200 tirages à
// graine fixe (tests/aides/tirages.js), cas limites, fins implicites (essai du 2026-10-12 avec le vrai Claude),
// actions figées. Fixtures génériques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPAREILS_A_SORTIR, APPAREILS_DEPART, FIN_IMPLICITE_MIN, PRECHAUFFAGE_AIRFRYER_MIN, PRECHAUFFAGE_MIN,
  PRECHAUFFAGE_TRAVAIL_MIN, TEMPERATURE_DEFAUT, capacites, dureeTotale, etapesDeLaVeille, ordreDUnPlat, planifier, tachesDUnPlat,
} from '../js/coeur/deroule.js';
import { etapesLisibles, titresDe } from '../js/coeur/realisation.js';
import { REPONSE_ETAPES_ESSAI, FICHES_ESSAI } from './donnees/reponse-etapes-essai.js';
import { GATEAU, GRATIN, REALISATION_GATEAU, REALISATION_GRATIN } from './donnees/exemples-etapes.js';
import { generateur, melanger, platsAuHasard, recetteAUnFour } from './aides/tirages.js';

// ——— Aides ———

const etape = (n, duree, extra = {}) => ({
  n, titre: `Étape ${n}`, texte: '', duree, actif: duree, appareil: null, tempC: null, apres: n > 1 ? [n - 1] : [],
  auService: false, veille: false, estime: false, ingredients: [], aussi: [], ustensiles: [], ...extra,
});
const ficheEssai = (id) => {
  const fiche = FICHES_ESSAI.find((f) => f.id === id);
  const realisation = REPONSE_ETAPES_ESSAI.plats.find((p) => p.id === id).realisation;
  return { ...fiche, realisation, etapes: titresDe(realisation) };
};
const lire = (plat) => etapesLisibles(plat).etapes;
const parCle = (plan) => new Map(plan.actions.map((a) => [a.cle, a]));

/** Toutes les tâches d'un tirage (une recette par plat, ordre des plats en priorité). */
function tachesDuTirage(plats) {
  return plats.flatMap(({ plat, etapes }, i) => tachesDUnPlat(etapes, { plat, priorite: i }));
}

/**
 * Vérifie les invariants du §6.4 sur un plan ; renvoie la liste des défauts (vide si tout va bien).
 * Réservations d'un appareil gardé : de la fin de l'étape d'avant au début de la suivante.
 */
function defauts(taches, plan, caps = capacites(null), { continu = true } = {}) {
  const erreurs = [];
  const actions = parCle(plan);
  const parTache = new Map(taches.map((t) => [t.cle, t]));
  // Toutes les tâches sont planifiées, une fois.
  for (const t of taches) if (!actions.has(t.cle)) erreurs.push(`${t.cle} absente`);
  // Une action ne commence jamais avant la fin de ses `apres`.
  for (const t of taches) {
    const a = actions.get(t.cle);
    for (const avant of t.apres) if (a.debut < actions.get(avant).fin) erreurs.push(`${t.cle} avant la fin de ${avant}`);
  }
  const minutes = Math.ceil(plan.finMin);
  const reservations = taches.filter((t) => t.chaineAvec).map((t) => ({
    cle: t.cle, appareil: t.appareil, de: actions.get(t.chaineAvec).fin, a: actions.get(t.cle).debut, temp: actions.get(t.chaineAvec).tempC,
  }));
  // Température au four à chaque début d'action (seconde relecture) : les plats dedans et ceux qui attendent leur étape
  // gardée (encore dedans, à la température d'avant) s'écartent de `ecartC` au plus.
  for (const a of plan.actions.filter((x) => !x.prechauffe && x.appareil === 'four')) {
    const d = a.debut;
    const temps = [
      ...plan.actions.filter((x) => !x.prechauffe && x.appareil === 'four' && x.debut <= d && d < x.fin).map((x) => x.tempC),
      ...reservations.filter((r) => r.appareil === 'four' && r.de <= d && d < r.a).map((r) => r.temp),
    ].filter((x) => x !== null && x !== undefined);
    if (temps.length && Math.max(...temps) - Math.min(...temps) > caps.four.ecartC) erreurs.push(`début de ${a.cle} : four à ${temps.join(' et ')} °C`);
  }
  for (let m = 0; m < minutes; m += 1) {
    const actives = plan.actions.filter((a) => a.debut <= m && m < a.finActif);
    if (actives.length > 1) erreurs.push(`minute ${m} : la personne fait ${actives.map((a) => a.cle).join(', ')}`);
    const enCours = plan.actions.filter((a) => !a.prechauffe && a.appareil && a.debut <= m && m < a.fin);
    for (const [id, cap] of Object.entries(caps)) {
      const sur = enCours.filter((a) => a.appareil === id);
      const gardees = reservations.filter((r) => r.appareil === id && r.de <= m && m < r.a);
      if (sur.length + gardees.length > cap.nombre * cap.places) erreurs.push(`minute ${m} : ${id} trop plein`);
      if (id === 'four') {
        const temps = sur.map((a) => a.tempC).filter((x) => x !== null);
        if (temps.length && Math.max(...temps) - Math.min(...temps) > cap.ecartC) erreurs.push(`minute ${m} : four à ${temps.join(' et ')} °C`);
      }
    }
    // Un appareil gardé n'est jamais pris par un autre plat entre deux étapes chaînées.
    for (const r of reservations.filter((x) => x.de <= m && m < x.a)) {
      const cap = caps[r.appareil];
      const sur = enCours.filter((a) => a.appareil === r.appareil).length;
      const autres = reservations.filter((x) => x !== r && x.appareil === r.appareil && x.de <= m && m < x.a).length;
      if (sur + autres + 1 > cap.nombre * cap.places) erreurs.push(`minute ${m} : ${r.appareil} gardé pour ${r.cle} pris`);
    }
    // Travail continu : jamais la personne libre quand une étape active est prête et que ses ressources sont libres
    // (sans appareil, ou un appareil sans préchauffage avec une place libre ou gardée pour elle), sauf si la lancer
    // ferait attendre une étape qui demande la personne et ne doit pas attendre (étape gardée, ou étape pour laquelle
    // un appareil chauffe) : elle deviendrait prête pendant ce travail.
    if (continu && !actives.length) {
      const attendues = [];
      for (const g of taches) {
        const a = actions.get(g.cle);
        if (!(g.actif > 0) || a.debut <= m) continue;
        if (g.chaineAvec && actions.get(g.chaineAvec).debut <= m) attendues.push({ h: actions.get(g.chaineAvec).fin, actif: g.actif });
        // Le dernier préchauffage lancé pour elle (un four rallumé remplace le premier).
        const four = plan.actions.filter((x) => x.prechauffe?.pour === g.cle && x.debut <= m).at(-1);
        if (four && g.apres.every((x) => actions.get(x).debut <= m)) {
          attendues.push({ h: Math.max(four.fin, ...g.apres.map((x) => actions.get(x).fin)), actif: g.actif });
        }
      }
      for (const t of taches) {
        const a = actions.get(t.cle);
        if (!(t.actif > 0) || a.debut <= m || !t.apres.every((x) => actions.get(x).fin <= m)) continue;
        if (attendues.some(({ h }) => h > m && h < m + t.actif)) continue;
        // Son étape gardée, qui demande la personne, tomberait sur une étape attendue : elle attendrait sur le feu.
        const sienne = taches.find((g) => g.chaineAvec === t.cle && g.actif > 0);
        if (sienne && attendues.some(({ h, actif }) => h > m && h < m + t.duree + sienne.actif && h + actif > m + t.duree)) continue;
        if (!t.appareil) {
          erreurs.push(`minute ${m} : personne libre, ${t.cle} prête`);
          continue;
        }
        const cap = caps[t.appareil];
        if (cap.prechauffeMin > 0) continue;
        const gardeePourElle = reservations.some((r) => r.cle === t.cle && r.de <= m && m < r.a);
        const sur = enCours.filter((x) => x.appareil === t.appareil).length;
        const autres = reservations.filter((r) => r.cle !== t.cle && r.appareil === t.appareil && r.de <= m && m < r.a).length;
        if (gardeePourElle || sur + autres < cap.nombre * cap.places) erreurs.push(`minute ${m} : personne libre, ${t.cle} prête (${t.appareil} libre)`);
      }
    }
  }
  // Bornes.
  const sommeActif = taches.reduce((s, t) => s + t.actif, 0);
  if (plan.finMin < sommeActif) erreurs.push(`finMin ${plan.finMin} < travail ${sommeActif}`);
  const chemin = new Map();
  for (const t of taches) chemin.set(t.cle, t.duree + Math.max(0, ...t.apres.map((x) => chemin.get(x))));
  const plusLong = Math.max(0, ...chemin.values());
  if (plan.finMin < plusLong) erreurs.push(`finMin ${plan.finMin} < chemin ${plusLong}`);
  const sommeDurees = taches.reduce((s, t) => s + t.duree, 0)
    + plan.actions.filter((a) => a.prechauffe).reduce((s, a) => s + (a.fin - a.debut), 0);
  // (L'ordre affiché peut attendre l'écran suivant pour allumer le four : pas de borne haute.)
  if (continu && plan.finMin > sommeDurees) erreurs.push(`finMin ${plan.finMin} > somme ${sommeDurees}`);
  // Travail : Σ actif, plus les préchauffages.
  const travail = sommeActif + plan.actions.filter((a) => a.prechauffe).reduce((s, a) => s + (a.finActif - a.debut), 0);
  if (plan.travailMin !== travail) erreurs.push(`travail ${plan.travailMin} au lieu de ${travail}`);
  void parTache;
  return erreurs;
}

/**
 * Plan d'une recette seule tel que l'écran le suit (ordreDUnPlat : préchauffages ramenés à l'arrivée sur un écran),
 * sous la forme de planifier, pour defauts().
 */
function planDeLOrdre(etapes, caps = capacites(null)) {
  const o = ordreDUnPlat(etapes, caps);
  const taches = new Map(tachesDUnPlat(etapes).map((t) => [t.cle, t]));
  const actions = [
    ...o.ordre.map((x) => ({ cle: x.cle, debut: x.debut, finActif: x.finActif, fin: x.fin, appareil: taches.get(x.cle).appareil, tempC: taches.get(x.cle).tempC })),
    ...o.prechauffages.map((p) => ({
      cle: p.cle, debut: p.debut, finActif: p.debut + PRECHAUFFAGE_TRAVAIL_MIN, fin: p.debut + caps[p.appareil].prechauffeMin,
      appareil: p.appareil, tempC: p.tempC, prechauffe: { pour: p.pour, tempC: p.tempC },
    })),
  ].sort((a, b) => a.debut - b.debut);
  return { ordre: o, plan: { actions, finMin: o.finMin, travailMin: o.travailMin } };
}

/** Moment d'arrivée sur l'écran de chaque étape de l'ordre (après le travail de l'étape d'avant). */
function arrivees(ordre) {
  const vues = new Map();
  let vue = 0;
  for (const x of ordre) {
    vues.set(x.cle, vue);
    if (x.finActif > x.debut) vue = x.finActif;
  }
  return vues;
}

// ——— Capacités ———

test('capacites : appareils de départ ; reglages.appareils remplace ce qu’il cite', () => {
  const depart = capacites(null);
  assert.deepEqual(Object.keys(depart), APPAREILS_DEPART.map((a) => a.id));
  assert.deepEqual(depart.plaque, { id: 'plaque', nombre: 4, places: 1, ecartC: 0, prechauffeMin: 0, actif: true });
  assert.deepEqual(depart.four, { id: 'four', nombre: 1, places: 2, ecartC: 10, prechauffeMin: PRECHAUFFAGE_MIN, actif: true });
  assert.equal(depart.airfryer.prechauffeMin, PRECHAUFFAGE_AIRFRYER_MIN);
  assert.equal(depart.monsieur_cuisine.actif, false);
  const reglees = capacites({ appareils: ['monsieur_cuisine', { id: 'plaque', nombre: 3 }, { appareil: 'cookeo', actif: false }, 'inconnu', 42, null] });
  assert.equal(reglees.monsieur_cuisine.actif, true);
  assert.equal(reglees.plaque.nombre, 3);
  assert.equal(reglees.cookeo.actif, false);
  assert.equal(reglees.four.places, 2, 'un appareil non cité garde ses valeurs de départ');
  assert.deepEqual(reglees.inconnu, { id: 'inconnu', nombre: 1, places: 1, ecartC: 0, prechauffeMin: 0, actif: true });
  assert.deepEqual(capacites({ appareils: 'four' }), depart, 'liste illisible : départ');
});

test('planifier : un appareil absent ou inactif compte pour un, et il est signalé', () => {
  const taches = [
    { cle: 'a', duree: 10, actif: 1, appareil: 'monsieur_cuisine' },
    { cle: 'b', duree: 10, actif: 1, appareil: 'monsieur_cuisine', apres: [] },
    { cle: 'c', duree: 5, actif: 0, appareil: 'barbecue' },
  ];
  const plan = planifier(taches);
  assert.deepEqual(plan.signales, [{ appareil: 'monsieur_cuisine', raison: 'inactif' }, { appareil: 'barbecue', raison: 'absent' }]);
  const a = parCle(plan);
  assert.ok(a.get('b').debut >= a.get('a').fin || a.get('a').debut >= a.get('b').fin, 'une seule place');
  assert.equal(planifier(taches, capacites({ appareils: ['monsieur_cuisine'] })).signales.length, 1);
});

// ——— Règles ———

test('planifier : une recette linéaire sans appareil dure la somme de ses étapes', () => {
  const plan = planifier([
    { cle: '1', duree: 5, actif: 5 }, { cle: '2', duree: 3, apres: ['1'] }, { cle: '3', duree: 4, actif: 2, apres: ['2'] },
  ]);
  assert.deepEqual(plan.actions.map((a) => [a.cle, a.debut, a.finActif, a.fin]), [['1', 0, 5, 5], ['2', 5, 8, 8], ['3', 8, 10, 12]]);
  assert.equal(plan.finMin, 12);
  assert.equal(plan.travailMin, 10);
});

test('planifier : ce qui peut avancer pendant une attente passe avant (eau qui chauffe, puis la préparation)', () => {
  const etapes = lire({ ...GRATIN, realisation: REALISATION_GRATIN, etapes: titresDe(REALISATION_GRATIN) });
  const { ordre } = ordreDUnPlat(etapes);
  assert.equal(ordre[0].cle, '2', 'l’eau d’abord : elle chauffe pendant qu’on prépare');
  assert.equal(ordre[1].cle, '1');
  const cuire = ordre.find((o) => o.cle === '3');
  const sauce = ordre.find((o) => o.cle === '6');
  assert.ok(sauce.debut < cuire.fin, 'la sauce se fait pendant que les pâtes cuisent');
});

test('planifier : appareil gardé entre deux étapes chaînées (eau puis pâtes), même si un autre plat attend un feu', () => {
  const taches = [
    { cle: 'a/1', plat: 'a', n: 1, duree: 10, actif: 1, appareil: 'cookeo' },
    { cle: 'a/2', plat: 'a', n: 2, duree: 20, actif: 1, appareil: 'cookeo', apres: ['a/1'], chaineAvec: 'a/1' },
    { cle: 'b/1', plat: 'b', n: 1, duree: 5, actif: 5 },
    { cle: 'b/2', plat: 'b', n: 2, duree: 15, actif: 1, appareil: 'cookeo', apres: ['b/1'] },
  ];
  const a = parCle(planifier(taches));
  assert.equal(a.get('a/2').debut, a.get('a/1').fin, 'aucun trou');
  assert.ok(a.get('b/2').debut >= a.get('a/2').fin, 'le Cookeo n’est pas pris entre les deux étapes');
});

test('planifier : l’étape gardée passe avant les autres pour la personne', () => {
  const taches = [
    { cle: 'x/1', plat: 'x', n: 1, duree: 10, actif: 1, appareil: 'plaque' },
    { cle: 'x/2', plat: 'x', n: 2, duree: 2, actif: 2, appareil: 'plaque', apres: ['x/1'], chaineAvec: 'x/1' },
    { cle: 'y/1', plat: 'y', n: 1, duree: 60, actif: 60 },
  ];
  const plan = planifier(taches);
  const a = parCle(plan);
  // La personne commence par la longue préparation (chemin le plus long) ; l'eau est lancée d'abord, puis on attend.
  assert.ok(a.get('x/2').debut >= a.get('x/1').fin);
  assert.deepEqual(defauts(taches.map((t) => ({ apres: [], chaineAvec: null, ...t })), plan), []);
});

test('planifier : une étape d’attente sans travail (repos) n’occupe pas la personne', () => {
  const taches = [
    { cle: 'p/1', plat: 'p', n: 1, duree: 30, actif: 0, appareil: 'plaque' },
    { cle: 'q/1', plat: 'q', n: 1, duree: 10, actif: 10 },
  ];
  const a = parCle(planifier(taches));
  assert.equal(a.get('p/1').debut, 0);
  assert.equal(a.get('q/1').debut, 0, 'les deux en même temps');
});

test('planifier : feux, four (2 plats à 10 °C d’écart au plus), Cookeo et Airfryer limités', () => {
  const taches = [
    ...Array.from({ length: 6 }, (_, i) => ({ cle: `f${i}`, plat: `f${i}`, duree: 20, actif: 0, appareil: 'plaque' })),
    { cle: 'o1', plat: 'o1', duree: 30, actif: 0, appareil: 'four', tempC: 200 },
    { cle: 'o2', plat: 'o2', duree: 30, actif: 0, appareil: 'four', tempC: 195 },
    { cle: 'o3', plat: 'o3', duree: 30, actif: 0, appareil: 'four', tempC: 160 },
    { cle: 'c1', plat: 'c1', duree: 15, actif: 0, appareil: 'cookeo' },
    { cle: 'c2', plat: 'c2', duree: 15, actif: 0, appareil: 'cookeo' },
  ];
  const plan = planifier(taches);
  assert.deepEqual(defauts(taches.map((t) => ({ apres: [], chaineAvec: null, ...t })), plan), []);
  const a = parCle(plan);
  assert.equal(a.get('o1').debut, a.get('o2').debut, 'deux plats proches au four ensemble');
  assert.ok(a.get('o3').debut >= a.get('o1').fin, 'un plat à 160 °C attend la sortie des deux autres');
  assert.ok(plan.actions.some((x) => x.prechauffe?.tempC === 160), 'four remis à 160 °C après leur sortie');
});

test('planifier : préchauffage anticipé : un gratin avec 15 min de préparation finit sans 10 min de plus', () => {
  const etapes = [
    etape(1, 15),
    etape(2, 20, { actif: 1, appareil: 'four', tempC: 200 }),
    etape(3, 1),
  ];
  const plan = planifier(tachesDUnPlat(etapes));
  const a = parCle(plan);
  const four = a.get('prechauffe:2');
  assert.ok(four, 'le four est allumé');
  assert.equal(four.debut, 0, 'avant de commencer la préparation');
  assert.equal(four.finActif - four.debut, PRECHAUFFAGE_TRAVAIL_MIN);
  assert.equal(four.fin - four.debut, PRECHAUFFAGE_MIN);
  assert.equal(a.get('2').debut, a.get('1').fin, 'le four est chaud quand la préparation finit');
  assert.equal(plan.finMin, 1 + 15 + 20 + 1);
  assert.ok(plan.finMin < 15 + 20 + 1 + PRECHAUFFAGE_MIN);
});

test('planifier : préchauffage d’une étape au four prête tout de suite : 10 min d’attente, une seule fois', () => {
  const plan = planifier(tachesDUnPlat([etape(1, 25, { actif: 2, appareil: 'four', tempC: 180, apres: [] })]));
  assert.deepEqual(plan.actions.map((a) => [a.cle, a.debut, a.fin]), [['prechauffe:1', 0, 10], ['1', 10, 35], ['1-fin', 35, 36]]);
});

test('planifier : four sans température : allumé à 180 °C, ou à la température d’un plat déjà dedans', () => {
  const seul = parCle(planifier([{ cle: 'a', duree: 20, actif: 1, appareil: 'four' }]));
  assert.equal(seul.get('prechauffe:a').tempC, TEMPERATURE_DEFAUT);
  assert.equal(seul.get('a').tempC, TEMPERATURE_DEFAUT);
  const avec = planifier([
    { cle: 'b', plat: 'b', duree: 40, actif: 1, appareil: 'four', tempC: 220 },
    { cle: 'c', plat: 'c', duree: 20, actif: 1, appareil: 'four' },
  ]);
  const a = parCle(avec);
  assert.equal(avec.actions.filter((x) => x.prechauffe).length, 1, 'un seul préchauffage');
  assert.equal(a.get('c').tempC, 220, 'il cuit à la température du four');
  assert.ok(a.get('c').debut < a.get('b').fin, 'ensemble dans le four');
});

test('planifier : deux températures successives au four, pour le même plat', () => {
  const chainees = [
    etape(1, 5),
    etape(2, 15, { actif: 1, appareil: 'four', tempC: 220 }),
    etape(3, 40, { actif: 1, appareil: 'four', tempC: 160 }),
  ];
  const plan = planifier(tachesDUnPlat(chainees));
  const a = parCle(plan);
  assert.equal(a.get('3').debut, a.get('2').fin, 'on baisse le four, le plat reste dedans');
  assert.equal(a.get('3').tempC, 160);
  assert.equal(plan.actions.filter((x) => x.prechauffe).length, 1);
  assert.ok(a.has('3-fin'), 'puis on le sort');
  // Sans chaîne (l'étape attend aussi la préparation) : le four se règle de nouveau après la sortie.
  const separees = [
    etape(1, 5),
    etape(2, 15, { actif: 1, appareil: 'four', tempC: 220 }),
    etape(3, 5, { apres: [] }),
    etape(4, 40, { actif: 1, appareil: 'four', tempC: 160, apres: [2, 3] }),
  ];
  const plan2 = planifier(tachesDUnPlat(separees));
  const b = parCle(plan2);
  const second = b.get('prechauffe:4');
  assert.ok(second && second.debut >= b.get('2').fin, 'changement de température avec un plat dedans : on attend sa sortie');
  assert.ok(b.get('4').debut >= second.fin);
  assert.deepEqual(defauts(tachesDUnPlat(separees), plan2), []);
});

test('planifier : un Cookeo partagé par deux plats à deux étapes chacun', () => {
  const plat = (id, priorite) => tachesDUnPlat([
    etape(1, 8, { actif: 8, appareil: 'cookeo' }),
    etape(2, 25, { actif: 1, appareil: 'cookeo' }),
    etape(3, 2),
  ], { plat: id, priorite });
  const taches = [...plat('a', 0), ...plat('b', 1)];
  const plan = planifier(taches);
  assert.deepEqual(defauts(taches, plan), []);
  const a = parCle(plan);
  const [premier, second] = a.get('a/1').debut < a.get('b/1').debut ? ['a', 'b'] : ['b', 'a'];
  assert.ok(a.get(`${second}/1`).debut >= a.get(`${premier}/2`).fin, 'le second plat attend que le Cookeo soit libre');
  assert.equal(a.get(`${premier}/2`).debut, a.get(`${premier}/1`).fin);
});

test('tachesDUnPlat : étapes de la veille et du jour du repas hors calcul ; on ne les attend pas', () => {
  const etapes = [
    etape(1, 600, { actif: 5, veille: true }),
    etape(2, 10, { apres: [1] }),
    etape(3, 30, { actif: 1, appareil: 'plaque' }),
    etape(4, 5, { actif: 1, auService: true }),
  ];
  const taches = tachesDUnPlat(etapes);
  assert.deepEqual(taches.map((t) => [t.cle, t.apres]), [['2', []], ['3', ['2']]]);
  assert.equal(dureeTotale(etapes), 40);
});

test('ordreDUnPlat : un seul plat sans conflit finit au bout de son chemin le plus long', () => {
  const etapes = [
    etape(1, 10, { actif: 1, appareil: 'plaque', apres: [] }),
    etape(2, 6, { apres: [] }),
    etape(3, 12, { actif: 2, appareil: 'plaque', apres: [1] }),
    etape(4, 3, { apres: [2, 3] }),
  ];
  const { finMin, ordre } = ordreDUnPlat(etapes);
  assert.equal(finMin, 10 + 12 + 3);
  assert.deepEqual(ordre.map((o) => o.cle), ['1', '2', '3', '4']);
});

// ——— Fins implicites ———

test('tachesDUnPlat : fin implicite après une attente au four, au Cookeo ou à l’airfryer qu’aucune étape n’attend', () => {
  assert.deepEqual(APPAREILS_A_SORTIR, ['four', 'cookeo', 'airfryer']);
  for (const appareil of APPAREILS_A_SORTIR) {
    const taches = tachesDUnPlat([etape(1, 5), etape(2, 30, { actif: 2, appareil, tempC: appareil === 'cookeo' ? null : 180 })]);
    const fin = taches.find((t) => t.cle === '2-fin');
    assert.deepEqual({ ...fin }, {
      cle: '2-fin', plat: '', n: 2, duree: FIN_IMPLICITE_MIN, actif: FIN_IMPLICITE_MIN, appareil,
      tempC: appareil === 'cookeo' ? null : 180, apres: ['2'], chaineAvec: '2', priorite: 0, implicite: appareil, pour: '2',
      estime: false,
    });
  }
  // Pas de fin implicite : plaque ; étape suivie d'un geste ; étape sans attente ; jour du repas ; veille.
  assert.equal(tachesDUnPlat([etape(1, 30, { actif: 2, appareil: 'plaque' })]).length, 1);
  assert.equal(tachesDUnPlat([etape(1, 30, { actif: 2, appareil: 'four', tempC: 180 }), etape(2, 2)]).length, 2);
  assert.equal(tachesDUnPlat([etape(1, 10, { actif: 10, appareil: 'airfryer', tempC: 180 })]).length, 1);
  assert.equal(tachesDUnPlat([etape(1, 3), etape(2, 15, { actif: 1, appareil: 'four', tempC: 160, auService: true })]).length, 1);
  // Seule une étape « le jour du repas » vient après : fin implicite quand même.
  assert.ok(tachesDUnPlat([etape(1, 40, { actif: 1, appareil: 'four', tempC: 180 }), etape(2, 10, { actif: 1, appareil: 'four', tempC: 160, auService: true })])
    .some((t) => t.cle === '1-fin'));
  // Étapes en parallèle : l'attente qu'aucune étape n'attend reçoit sa fin, même si une étape vient après elle.
  const paralleles = tachesDUnPlat([etape(1, 30, { actif: 1, appareil: 'four', tempC: 200 }), etape(2, 10, { apres: [] })]);
  assert.ok(paralleles.some((t) => t.cle === '1-fin'));
});

test('fins implicites sur les réponses réelles de l’essai : gratin et gâteau, pas la carbonade (« Finir la sauce »)', () => {
  const gratin = ordreDUnPlat(lire(ficheEssai('gratin-dauphinois')));
  assert.deepEqual(gratin.ordre.slice(-2).map((o) => [o.cle, o.implicite]), [['5', null], ['5-fin', 'four']]);
  assert.equal(gratin.ordre.find((o) => o.cle === '5-fin').debut, gratin.ordre.find((o) => o.cle === '5').fin);
  assert.ok(!gratin.ordre.some((o) => o.cle === '6'), 'le réchauffage du jour du repas n’est pas dans le déroulé');
  const gateau = ordreDUnPlat(lire(ficheEssai('gateau-chocolat')));
  assert.equal(gateau.ordre.at(-1).cle, '6-fin');
  const carbonade = ordreDUnPlat(lire(ficheEssai('carbonade-flamande')));
  assert.ok(!carbonade.ordre.some((o) => o.implicite));
  assert.equal(carbonade.ordre.at(-1).cle, '7');
});

test('fins implicites : une fiche sans étapes détaillées (repli) les reçoit aussi, sans être datée', () => {
  const repli = ordreDUnPlat(lire(GATEAU));
  assert.equal(repli.estime, true);
  assert.equal(repli.finMin, null);
  assert.deepEqual(repli.ordre.map((o) => o.cle), ['1', '2', '3', '4', '4-fin']);
  assert.ok(repli.ordre.every((o) => o.debut === null));
  assert.equal(dureeTotale(lire(GATEAU)), null);
});

// ——— Recette seule ———

test('ordreDUnPlat : réponses réelles de l’essai : gâteau aux étapes en parallèle, préchauffage pendant les blancs', () => {
  const gateau = ordreDUnPlat(lire(ficheEssai('gateau-chocolat')));
  const debut = new Map(gateau.ordre.map((o) => [o.cle, o]));
  assert.ok(debut.get('3').debut >= Math.max(debut.get('1').fin, debut.get('2').fin));
  assert.ok(debut.get('5').debut >= Math.max(debut.get('3').fin, debut.get('4').fin));
  assert.equal(gateau.prechauffages.length, 1);
  const four = gateau.prechauffages[0];
  assert.equal(four.tempC, 180);
  assert.equal(four.pour, '6');
  assert.ok(four.debut + PRECHAUFFAGE_MIN <= debut.get('6').debut, 'le four est chaud à temps');
  assert.notEqual(four.avant, '6', 'dit avant l’étape du four');
});

test('ordreDUnPlat : « Allumez le four » sur l’étape commencée juste après, sinon sur celle qu’on a sous les yeux', () => {
  const tot = ordreDUnPlat([etape(1, 15), etape(2, 20, { actif: 1, appareil: 'four', tempC: 200 })]);
  assert.equal(tot.prechauffages[0].avant, '1');
  const gratin = ordreDUnPlat(lire({ ...GRATIN, realisation: REALISATION_GRATIN, etapes: titresDe(REALISATION_GRATIN) }));
  const four = gratin.prechauffages[0];
  const etapeAvant = gratin.ordre.find((o) => o.cle === four.avant);
  // L'étape commencée juste après avoir allumé (dans la minute du geste) : le rappel se lit avant de la commencer.
  assert.ok(etapeAvant.debut <= four.debut + PRECHAUFFAGE_TRAVAIL_MIN, 'jamais après le moment d’allumer');
  assert.ok(four.debut + PRECHAUFFAGE_MIN <= gratin.ordre.find((o) => o.cle === '8').debut);
});

test('dureeTotale = finMin de l’ordre affiché (même calcul pour l’Aperçu et « Cuisiner pas à pas »)', () => {
  for (const id of ['gratin-dauphinois', 'carbonade-flamande', 'gateau-chocolat']) {
    const etapes = lire(ficheEssai(id));
    assert.equal(dureeTotale(etapes), ordreDUnPlat(etapes).finMin, id);
    assert.deepEqual(defauts(tachesDUnPlat(etapes), planifier(tachesDUnPlat(etapes))), [], id);
    const { plan } = planDeLOrdre(etapes);
    assert.deepEqual(defauts(tachesDUnPlat(etapes), plan, capacites(null), { continu: false }), [], `${id} (écrans)`);
  }
  assert.equal(dureeTotale([]), 0);
});

test('ordreDUnPlat : gratin dauphinois de l’essai : le four est allumé à temps, en arrivant sur un écran (seconde relecture)', () => {
  // Le réveil du préchauffage (à r − 10, où « attendre » ne retarde pas encore) était perdu : four allumé 10 min plus
  // tard, plat prêt qui l'attendait, « Environ 1 h 36 ».
  const o = ordreDUnPlat(lire(ficheEssai('gratin-dauphinois')));
  assert.ok(o.finMin <= 90, `fin ${o.finMin}`);
  const four = o.prechauffages[0];
  const debut = new Map(o.ordre.map((x) => [x.cle, x]));
  assert.ok(four.debut + PRECHAUFFAGE_MIN <= debut.get('5').debut, 'le four est chaud quand le plat est prêt');
  assert.equal(arrivees(o.ordre).get(four.avant), four.debut, 'on lit « Allumez le four » au moment d’allumer');
  // Préparer, poêle (3 min de travail), four : allumé en arrivant sur l'écran du four, pendant la poêle.
  const court = ordreDUnPlat([etape(1, 10), etape(2, 15, { actif: 3, appareil: 'plaque' }), etape(3, 40, { actif: 2, appareil: 'four', tempC: 180 })]);
  assert.equal(court.finMin, 10 + 15 + 40 + FIN_IMPLICITE_MIN);
  assert.equal(arrivees(court.ordre).get(court.prechauffages[0].avant), court.prechauffages[0].debut);
});

test('ordreDUnPlat : un préchauffage pendant une longue attente n’est pas lu une heure trop tôt', () => {
  // Mijoter 60 min, puis gratiner : l'écran du gratin arrive au début du mijotage. Le four n'est pas allumé alors (chaud
  // à vide près d'une heure) : il l'est en arrivant sur l'écran du four, quitte à attendre 10 min.
  const o = ordreDUnPlat([etape(1, 5), etape(2, 60, { actif: 2, appareil: 'plaque' }), etape(3, 4),
    etape(4, 30, { actif: 1, appareil: 'four', tempC: 200 })]);
  const four = o.prechauffages[0];
  const vues = arrivees(o.ordre);
  assert.equal(vues.get(four.avant), four.debut);
  const servie = o.ordre.find((x) => x.cle === '4');
  assert.ok(servie.debut - (four.debut + PRECHAUFFAGE_MIN) <= 15, 'jamais longtemps chaud à vide');
});

// ——— Actions figées ———

test('planifier : une action figée garde ses heures, le reste repart de « maintenant »', () => {
  const etapes = [etape(1, 10), etape(2, 5), etape(3, 20, { actif: 2, appareil: 'plaque' })];
  const taches = tachesDUnPlat(etapes);
  const fige = new Map([['1', { debut: 0, fin: 18 }]]);
  const plan = planifier(taches, null, { maintenant: 18, fige });
  const a = parCle(plan);
  assert.deepEqual([a.get('1').debut, a.get('1').fin], [0, 18]);
  assert.equal(a.get('2').debut, 18);
  assert.equal(a.get('3').debut, 23);
  // Une étape lancée (sans fin) occupe son appareil : un autre plat attend.
  const deux = [
    ...tachesDUnPlat([etape(1, 30, { actif: 1, appareil: 'cookeo' }), etape(2, 2)], { plat: 'a' }),
    ...tachesDUnPlat([etape(1, 10, { actif: 1, appareil: 'cookeo' }), etape(2, 2)], { plat: 'b' }),
  ];
  const lance = planifier(deux, null, { maintenant: 5, fige: new Map([['a/1', { debut: 2 }]]) });
  const b = parCle(lance);
  assert.equal(b.get('a/1').fin, 32);
  assert.ok(b.get('b/1').debut >= 32, 'le Cookeo est pris jusqu’à 32');
  assert.ok(lance.actions.every((x) => x.cle === 'a/1' || x.debut >= 5));
});

test('planifier : un préchauffage figé (lancé) n’est pas refait', () => {
  const taches = tachesDUnPlat([etape(1, 5), etape(2, 20, { actif: 1, appareil: 'four', tempC: 200 })]);
  const plan = planifier(taches, null, { maintenant: 3, fige: new Map([['1', { debut: 0 }], ['prechauffe:2', { debut: 0 }]]) });
  assert.equal(plan.actions.filter((a) => a.prechauffe).length, 1);
  assert.equal(parCle(plan).get('2').debut, 10, 'four chaud à 10');
});

// ——— 200 tirages ———

test('invariants sur 200 tirages de 1 à 6 plats (générateur à graine fixe)', () => {
  const hasard = generateur(20261013);
  let actionsVues = 0;
  let prechauffages = 0;
  for (let i = 0; i < 200; i += 1) {
    const plats = platsAuHasard(hasard);
    const taches = tachesDuTirage(plats);
    const plan = planifier(taches);
    const erreurs = defauts(taches, plan);
    assert.deepEqual(erreurs, [], `tirage ${i}`);
    // Même entrée, même plan, quel que soit l'ordre des tâches.
    const melange = planifier(melanger(taches, hasard));
    assert.deepEqual(melange, plan, `tirage ${i} mélangé`);
    actionsVues += plan.actions.length;
    prechauffages += plan.actions.filter((a) => a.prechauffe).length;
    // Recette seule : dureeTotale = finMin de l'ordre affiché, qui respecte les invariants (sauf le travail continu :
    // le four s'allume en arrivant sur un écran).
    for (const { etapes } of plats) {
      const { ordre, plan: affiche } = planDeLOrdre(etapes);
      assert.equal(dureeTotale(etapes), ordre.finMin);
      if (ordre.ordre.length && ordre.finMin !== null) assert.deepEqual(defauts(tachesDUnPlat(etapes), affiche, capacites(null), { continu: false }), [], `tirage ${i} (écrans)`);
    }
  }
  assert.ok(actionsVues > 1000, 'les tirages sont variés');
  assert.ok(prechauffages > 50, 'des fours à préchauffer');
});

test('invariants sur 200 tirages : actions figées gardées, le reste après « maintenant »', () => {
  const hasard = generateur(424242);
  for (let i = 0; i < 200; i += 1) {
    const taches = tachesDuTirage(platsAuHasard(hasard));
    const plan = planifier(taches);
    const maintenant = Math.floor(plan.finMin * hasard());
    // Commencées avant « maintenant » ; une action encore en cours peut finir plus tard que prévu.
    const fige = new Map(plan.actions.filter((a) => a.debut < maintenant && !a.prechauffe)
      .map((a) => [a.cle, { debut: a.debut, fin: a.fin > maintenant && hasard() < 0.3 ? a.fin + 7 : a.fin }]));
    const recalcul = planifier(taches, null, { maintenant, fige });
    const a = parCle(recalcul);
    for (const [cle, f] of fige) assert.deepEqual([a.get(cle).debut, a.get(cle).fin], [f.debut, f.fin], `tirage ${i} : ${cle}`);
    for (const action of recalcul.actions) if (!fige.has(action.cle)) assert.ok(action.debut >= maintenant, `tirage ${i} : ${action.cle}`);
    for (const t of taches) for (const x of t.apres) assert.ok(a.get(t.cle).debut >= a.get(x).fin, `tirage ${i} : ${t.cle} après ${x}`);
  }
});

// ——— Relecture de T5-1 ———

/** Retards d'un plan : fins implicites (début − fin de leur attente) et four chaud à vide (début de l'étape servie − fin du préchauffage). */
function retards(taches, plan) {
  const a = parCle(plan);
  const fins = taches.filter((t) => t.implicite).map((t) => a.get(t.cle).debut - a.get(t.pour).fin);
  const aVide = plan.actions.filter((x) => x.prechauffe).map((x) => a.get(x.prechauffe.pour).debut - x.fin);
  return { fins, aVide };
}

test('planifier : un four rallumé pour une étape après un changement de température (quiche) : rien ne se perd', () => {
  // Le four allumé à 200 °C pour « Rôtir » sert d'abord à « Cuire à blanc », que « Cuire la quiche » remet à 160 °C :
  // il faut le rallumer pour « Rôtir » (avant la relecture : boucle sans fin, étapes perdues, « Environ 11111 h »).
  const etapes = [
    etape(1, 8),
    etape(2, 25, { actif: 1, appareil: 'four', tempC: 200, apres: [1] }),
    etape(3, 10, { apres: [] }),
    etape(4, 10, { actif: 2, appareil: 'four', apres: [3] }),
    etape(5, 25, { actif: 1, appareil: 'four', tempC: 160, apres: [4] }),
  ];
  for (const variante of [etapes, etapes.map((e) => (e.n === 4 ? { ...e, tempC: 200 } : e)),
    etapes.map((e) => (e.n === 2 ? { ...e, tempC: 180 } : e.n === 5 ? { ...e, tempC: 200 } : e))]) {
    const taches = tachesDUnPlat(variante);
    const plan = planifier(taches);
    assert.deepEqual(defauts(taches, plan), []);
    assert.ok(!plan.signales.some((x) => x.raison === 'repli'));
    assert.ok(plan.finMin < 200, `durée raisonnable : ${plan.finMin}`);
    const ordre = ordreDUnPlat(variante);
    assert.deepEqual(ordre.ordre.map((o) => o.cle).sort(), ['1', '2', '2-fin', '3', '4', '5', '5-fin']);
  }
});

test('planifier : deux places gardées dans le four à des températures trop écartées ne s’attendent pas sans fin', () => {
  const taches = [
    ...tachesDUnPlat([etape(1, 30, { actif: 1, appareil: 'four', tempC: 200 }), etape(2, 15, { actif: 2, appareil: 'four', tempC: 180 })], { plat: 'a' }),
    ...tachesDUnPlat([etape(1, 40, { actif: 1, appareil: 'four' }), etape(2, 20, { actif: 2, appareil: 'four', tempC: 220 })], { plat: 'b', priorite: 1 }),
  ];
  const plan = planifier(taches);
  assert.ok(!plan.signales.some((x) => x.raison === 'repli'));
  assert.deepEqual(defauts(taches, plan), []);
  assert.ok(plan.finMin < 200);
});

test('planifier : « Sortir du four » suit la cuisson sans attendre (une longue étape attend, ou passe avant)', () => {
  // Pois chiches au four pendant le riz et les légumes : on sort le plat avant de commencer 20 min de poêle.
  const etapes = [
    etape(1, 15, { actif: 1, appareil: 'four', tempC: 200, apres: [] }),
    etape(2, 15, { actif: 3, appareil: 'plaque', apres: [] }),
    etape(3, 20, { actif: 20, appareil: 'plaque', apres: [2] }),
  ];
  const taches = tachesDUnPlat(etapes);
  const plan = planifier(taches);
  const a = parCle(plan);
  assert.equal(a.get('1-fin').debut, a.get('1').fin);
  assert.deepEqual(defauts(taches, plan), []);
});

test('planifier : le four allumé en avance n’attend pas à vide pendant une autre longue étape (gâteau et crème anglaise)', () => {
  const etapes = [
    etape(1, 15),
    etape(2, 25, { actif: 2, appareil: 'four', tempC: 180 }),
    etape(3, 30, { actif: 30, appareil: 'plaque', apres: [] }),
  ];
  const taches = tachesDUnPlat(etapes);
  const plan = planifier(taches);
  const { fins, aVide } = retards(taches, plan);
  assert.deepEqual(fins, [0], 'le gâteau sort à l’heure');
  // Allumé avant la pâte (la personne est occupée ensuite) : chaud un peu avant la fin de la pâte, enfourné aussitôt.
  assert.ok(aVide.every((x) => x < PRECHAUFFAGE_MIN), `four chaud à vide : ${aVide}`);
  const a = parCle(plan);
  assert.equal(a.get('2').debut, a.get('1').fin, 'enfourné dès la pâte prête, avant la crème');
  assert.deepEqual(defauts(taches, plan), []);
});

test('invariants sur plusieurs graines : toutes les étapes planifiées, sans repli ; fins implicites à l’heure', () => {
  for (const graine of [7, 21, 79, 2944, 20261013]) {
    const hasard = generateur(graine);
    for (let i = 0; i < 300; i += 1) {
      const plats = platsAuHasard(hasard);
      const taches = tachesDuTirage(plats);
      const plan = planifier(taches);
      const vues = new Set(plan.actions.map((x) => x.cle));
      assert.ok(taches.every((t) => vues.has(t.cle)), `graine ${graine}, tirage ${i} : étape perdue`);
      assert.ok(!plan.signales.some((x) => x.raison === 'repli'), `graine ${graine}, tirage ${i} : repli`);
      // Une fin implicite commence à la fin de son attente (au plus 2 min plus tard quand plusieurs plats sortent
      // en même temps, ou une recette seule : 1 min).
      const { fins } = retards(taches, plan);
      assert.ok(fins.every((x) => x >= 0 && x <= (plats.length > 1 ? 2 : 1)), `graine ${graine}, tirage ${i} : sortie en retard ${fins}`);
      for (const { etapes } of plats) {
        const seule = tachesDUnPlat(etapes);
        const r = retards(seule, planifier(seule));
        assert.ok(r.fins.every((x) => x >= 0 && x <= 1), `graine ${graine}, tirage ${i} : recette seule, sortie en retard ${r.fins}`);
      }
    }
  }
});

test('recettes réalistes à un four : le four chaud à vide 20 min ou plus reste rare, aucune sortie en retard', () => {
  const hasard = generateur(1234);
  let recettes = 0;
  let longues = 0;
  while (recettes < 3000) {
    const etapes = recetteAUnFour(hasard);
    if (!etapes) continue;
    recettes += 1;
    const taches = tachesDUnPlat(etapes);
    const plan = planifier(taches);
    assert.deepEqual(defauts(taches, plan), [], `recette ${recettes}`);
    const { fins, aVide } = retards(taches, plan);
    assert.ok(fins.every((x) => x === 0), `recette ${recettes} : sortie en retard`);
    if (aVide.some((x) => x >= 20)) longues += 1;
  }
  assert.ok(longues <= 3, `four chaud à vide 20 min ou plus : ${longues} recettes sur 3000`);
});

test('etapesDeLaVeille et tachesDUnPlat : la marinade passe la veille avec ce dont elle dépend ; l’étape qui l’attendait n’attend plus qu’elles', () => {
  const etapes = [
    etape(1, 10),
    etape(2, 720, { actif: 0, veille: true }),
    etape(3, 8, { apres: [] }),
    etape(4, 20, { actif: 10, appareil: 'plaque', apres: [2, 3] }),
  ];
  assert.deepEqual([...etapesDeLaVeille(etapes)].sort(), [1, 2]);
  assert.deepEqual(tachesDUnPlat(etapes).map((t) => [t.cle, t.apres]), [['3', []], ['4', ['3']]]);
  assert.deepEqual(ordreDUnPlat(etapes).ordre.map((o) => o.cle), ['3', '4']);
  // Une étape du jour du repas n'est jamais ramenée à la veille.
  assert.deepEqual([...etapesDeLaVeille([etape(1, 5, { auService: true }), etape(2, 600, { actif: 0, veille: true, apres: [1] })])], [2]);
});

// ——— Seconde relecture de T5-1 ———

const ordreTexte = (o) => o.ordre.map((x) => x.cle);

test('tachesDUnPlat et planifier : « Sortir le gratin » écrit par Claude garde le four et sort le plat à l’heure', () => {
  // Version 7 : l'étape « Sortir … » est écrite, sans appareil. Une longue préparation indépendante ne la retarde pas.
  const etapes = [etape(1, 10), etape(2, 30, { actif: 1, appareil: 'four', tempC: 200 }), etape(3, 1, { titre: 'Sortir le gratin' }),
    etape(4, 40, { actif: 40, apres: [] })];
  const taches = tachesDUnPlat(etapes);
  const sortie = taches.find((t) => t.cle === '3');
  assert.equal(sortie.sortie, true);
  assert.equal(sortie.appareil, 'four');
  assert.equal(sortie.tempC, 200);
  assert.equal(sortie.chaineAvec, '2');
  assert.equal(sortie.implicite, null, 'son texte reste celui de Claude');
  assert.ok(!taches.some((t) => t.implicite), 'pas de fin implicite en plus');
  const plan = planifier(taches);
  const a = parCle(plan);
  assert.equal(a.get('3').debut, a.get('2').fin, 'sorti à la fin de la cuisson');
  assert.deepEqual(defauts(taches, plan), []);
  // Tarte à 160 °C puis légumes à 220 °C : on ne règle pas le four à 220 °C avec la tarte dedans.
  const tarte = [etape(1, 5), etape(2, 25, { actif: 1, appareil: 'four', tempC: 160 }), etape(3, 2, { titre: 'Sortir la tarte' }),
    etape(4, 30, { actif: 2, appareil: 'plaque', apres: [] }), etape(5, 5, { apres: [4] }),
    etape(6, 20, { actif: 1, appareil: 'four', tempC: 220, apres: [5] }), etape(7, 3, { apres: [3, 6] })];
  const t2 = tachesDUnPlat(tarte);
  const p2 = planifier(t2);
  const b = parCle(p2);
  assert.equal(b.get('3').debut, b.get('2').fin);
  const regle = p2.actions.find((x) => x.prechauffe?.pour === '6');
  assert.ok(regle.debut >= b.get('3').fin, `four réglé à 220 °C après la sortie de la tarte (${regle.debut})`);
  assert.deepEqual(defauts(t2, p2), []);
  // Une étape longue ou un repos après le four n'est pas une sortie.
  assert.ok(!tachesDUnPlat([etape(1, 30, { actif: 1, appareil: 'four', tempC: 200 }), etape(2, 20)]).some((t) => t.sortie));
  assert.ok(!tachesDUnPlat([etape(1, 30, { actif: 1, appareil: 'four', tempC: 200 }), etape(2, 10, { actif: 0 })]).some((t) => t.sortie));
});

test('planifier : un rôti qui baisse à 170 °C n’est pas bloqué par un plat mis à côté à 210 °C', () => {
  const etapes = [etape(1, 5), etape(2, 15, { actif: 1, appareil: 'four', tempC: 220 }), etape(3, 40, { actif: 1, appareil: 'four', tempC: 170 }),
    etape(4, 10, { apres: [] }), etape(5, 45, { actif: 2, appareil: 'four', tempC: 210, apres: [4] }), etape(6, 5, { apres: [3, 5] })];
  const taches = tachesDUnPlat(etapes);
  const plan = planifier(taches);
  const a = parCle(plan);
  assert.equal(a.get('3').debut, a.get('2').fin, 'le rôti passe à 170 °C sans attendre');
  assert.ok(a.get('5').debut >= a.get('3').fin, 'les pommes de terre attendent la sortie du rôti');
  assert.deepEqual(defauts(taches, plan), []);
  // Même chose en batch : quiche 200 puis 180 °C, gratin à 210 °C.
  const batch = [
    ...tachesDUnPlat([etape(1, 10), etape(2, 15, { actif: 1, appareil: 'four', tempC: 200 }), etape(3, 25, { actif: 1, appareil: 'four', tempC: 180 })], { plat: 'quiche', priorite: 0 }),
    ...tachesDUnPlat([etape(1, 12), etape(2, 30, { actif: 1, appareil: 'four', tempC: 210 })], { plat: 'gratin', priorite: 1 }),
  ];
  const pb = planifier(batch);
  const b = parCle(pb);
  assert.equal(b.get('quiche/3').debut, b.get('quiche/2').fin);
  assert.deepEqual(defauts(batch, pb), []);
});

test('planifier : un four vide plus de 15 min refroidit : « Rallumez » pour la cuisson suivante', () => {
  const etapes = [etape(1, 5), etape(2, 15, { actif: 1, appareil: 'four', tempC: 180 }), etape(3, 1, { titre: 'Sortir le fond' }),
    etape(4, 60, { actif: 0 }), etape(5, 5), etape(6, 30, { actif: 1, appareil: 'four', tempC: 180 }), etape(7, 1, { titre: 'Sortir la tarte' })];
  const taches = tachesDUnPlat(etapes);
  const plan = planifier(taches);
  const prechauffages = plan.actions.filter((x) => x.prechauffe);
  assert.equal(prechauffages.length, 2, 'rallumé pour la tarte');
  assert.equal(prechauffages[1].prechauffe.etat, 'rallume');
  assert.ok(prechauffages[1].fin <= parCle(plan).get('6').debut);
  assert.deepEqual(defauts(taches, plan), []);
  const o = ordreDUnPlat(etapes);
  assert.deepEqual(o.prechauffages.map((p) => p.etat), ['allume', 'rallume']);
  // Une seconde cuisson à la même température 10 min après : le four est encore chaud, pas de préchauffage.
  const court = tachesDUnPlat([etape(1, 15, { actif: 1, appareil: 'four', tempC: 180 }), etape(2, 1, { titre: 'Sortir' }), etape(3, 10),
    etape(4, 20, { actif: 1, appareil: 'four', tempC: 180 }), etape(5, 1, { titre: 'Sortir' })]);
  assert.equal(planifier(court).actions.filter((x) => x.prechauffe).length, 1);
});

test('planifier : on ne lance pas « Faire revenir » si sa cuisson en remuant tomberait sur une sortie (risotto)', () => {
  const etapes = [etape(1, 10), etape(2, 25, { actif: 1, appareil: 'four', tempC: 200 }), etape(3, 5, { apres: [] }),
    etape(4, 5, { actif: 5, appareil: 'plaque' }), etape(5, 20, { actif: 20, appareil: 'plaque' })];
  const taches = tachesDUnPlat(etapes);
  const plan = planifier(taches);
  const a = parCle(plan);
  assert.equal(a.get('5').debut, a.get('4').fin, 'le riz revenu ne reste pas sur le feu');
  assert.equal(a.get('2-fin').debut, a.get('2').fin, 'les légumes sortent à l’heure');
  assert.deepEqual(defauts(taches, plan), []);
});

test('ordreDUnPlat : chaque préchauffage se lit en arrivant sur l’écran de son étape (recettes réalistes)', () => {
  const hasard = generateur(4242);
  let vus = 0;
  let recettes = 0;
  while (recettes < 1500) {
    const etapes = recetteAUnFour(hasard);
    if (!etapes) continue;
    recettes += 1;
    const { ordre, plan } = planDeLOrdre(etapes);
    assert.deepEqual(defauts(tachesDUnPlat(etapes), plan, capacites(null), { continu: false }), [], `recette ${recettes}`);
    const vues = arrivees(ordre.ordre);
    for (const p of ordre.prechauffages) {
      vus += 1;
      assert.ok(p.quandLibre || vues.get(p.avant) === p.debut, `recette ${recettes} : « Allumez » lu à ${vues.get(p.avant)}, allumé à ${p.debut}`);
      const servie = ordre.ordre.find((x) => x.cle === p.pour);
      assert.ok(p.debut + PRECHAUFFAGE_MIN <= servie.debut, `recette ${recettes} : four chaud à temps`);
    }
  }
  assert.ok(vus >= 1000);
});
