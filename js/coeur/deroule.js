// Ordonnanceur (T5-1, plan §6.4) : un seul calcul pour une recette seule (« Cuisiner pas à pas », temps de l'Aperçu)
// et, plus tard, pour le batch (T5-2). Logique pure, en minutes : ni DOM, ni Firebase, aucun import.
// - Ressources : la personne (une seule, occupée pendant `actif`, au début de l'action) ; les feux, le four (`places`
//   plats à la fois si leurs températures s'écartent de `ecartC` au plus), le Cookeo, l'Airfryer, le Monsieur Cuisine.
// - Une étape commence quand toutes ses `apres` sont finies (attente comprise) et que ses ressources sont libres ; un
//   appareil gardé (`chaineAvec`) passe d'une étape à la suivante sans trou ; le four (et l'airfryer) se préchauffe en
//   avance, assez tôt pour que l'étape qui l'attend ne perde pas de temps.
// - Fin implicite (essai du 2026-10-12 avec le vrai Claude) : une étape d'attente au four, au Cookeo ou à l'airfryer
//   qu'aucune étape n'attend reçoit une étape « Sortir … » d'une minute (tachesDUnPlat), jamais une erreur.
// - Même entrée, même plan, quel que soit l'ordre des tâches reçues.

/** Préchauffage du four : 10 minutes, dont 1 de travail (« Allumez le four à 200 °C »). */
export const PRECHAUFFAGE_MIN = 10;
/** Préchauffage de l'airfryer : quelques minutes suffisent. */
export const PRECHAUFFAGE_AIRFRYER_MIN = 3;
/** Minutes de travail d'un préchauffage (tourner le bouton). */
export const PRECHAUFFAGE_TRAVAIL_MIN = 1;
/** Minutes au plus où un appareil allumé en avance reste chaud à vide, sauf si attendre retarderait davantage. */
export const A_VIDE_MAX = 15;
/** Température d'un four sans température donnée, quand il faut l'allumer. */
export const TEMPERATURE_DEFAUT = 180;
/** Appareils d'une étape d'attente qui reçoit une fin implicite (« Sortir du four »). */
export const APPAREILS_A_SORTIR = Object.freeze(['four', 'cookeo', 'airfryer']);
/** Durée (et travail) d'une fin implicite. */
export const FIN_IMPLICITE_MIN = 1;

/** Appareils du foyer tant que `reglages.appareils` n'est pas réglé (CLAUDE.md §6). */
export const APPAREILS_DEPART = Object.freeze([
  Object.freeze({ id: 'plaque', nombre: 4 }),
  Object.freeze({ id: 'four', nombre: 1, places: 2, ecartC: 10, prechauffeMin: PRECHAUFFAGE_MIN }),
  Object.freeze({ id: 'cookeo', nombre: 1 }),
  Object.freeze({ id: 'airfryer', nombre: 1, prechauffeMin: PRECHAUFFAGE_AIRFRYER_MIN }),
  Object.freeze({ id: 'monsieur_cuisine', nombre: 1, actif: false }),
]);

const estObjet = (valeur) => Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
const estNombre = (valeur) => typeof valeur === 'number' && Number.isFinite(valeur);
const parTexte = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const entierAuMoins = (valeur, min, defaut) => (Number.isInteger(valeur) && valeur >= min ? valeur : defaut);
const positif = (valeur, defaut) => (estNombre(valeur) && valeur >= 0 ? valeur : defaut);

/** Capacité propre d'un appareil (champs manquants : 1 appareil, 1 place, aucun écart, aucun préchauffage, actif). */
function capaciteLue(brut, base = null) {
  const id = base?.id ?? brut?.id;
  return {
    id,
    nombre: entierAuMoins(brut?.nombre, 1, base?.nombre ?? 1),
    places: entierAuMoins(brut?.places, 1, base?.places ?? 1),
    ecartC: positif(brut?.ecartC, base?.ecartC ?? 0),
    prechauffeMin: positif(brut?.prechauffeMin, base?.prechauffeMin ?? 0),
    actif: brut?.actif === false ? false : (brut?.actif === true ? true : (base?.actif ?? true)),
  };
}

const codeAppareil = (valeur) => (typeof valeur === 'string' ? valeur.trim().toLowerCase().replace(/[\s-]+/g, '_') : '');

/**
 * Capacités des appareils → { [id]: { id, nombre, places, ecartC, prechauffeMin, actif } } : APPAREILS_DEPART, puis
 * `reglages.appareils` s'il est lisible (codes, ou objets { id | appareil | code, nombre?, places?, ecartC?, actif? }) :
 * un appareil cité est actif sauf `actif: false`, ses champs lisibles remplacent ceux de départ.
 */
export function capacites(reglages) {
  const caps = {};
  for (const appareil of APPAREILS_DEPART) caps[appareil.id] = capaciteLue(appareil);
  const liste = reglages?.appareils;
  if (!Array.isArray(liste)) return caps;
  for (const brut of liste) {
    const objet = estObjet(brut);
    const id = codeAppareil(objet ? [brut.id, brut.appareil, brut.code].find((v) => typeof v === 'string') : brut);
    if (!id) continue;
    const base = caps[id] ?? capaciteLue({ id });
    caps[id] = capaciteLue({ ...(objet ? brut : {}), actif: objet && brut.actif === false ? false : true }, base);
  }
  return caps;
}

/** Capacités reçues : objet de capacites, liste façon APPAREILS_DEPART, ou rien (capacités de départ). */
function capacitesLues(caps) {
  if (Array.isArray(caps)) return capacites({ appareils: caps });
  if (estObjet(caps)) {
    const lues = {};
    for (const [id, cap] of Object.entries(caps)) if (estObjet(cap)) lues[id] = capaciteLue({ ...cap, id }, { id });
    return lues;
  }
  return capacites(null);
}

// ——— Tâches ———

/** Tâches propres, sans doublon de clé ; `apres` limitées aux clés connues ; cycles rompus (signalés). */
function tachesLues(taches, signales) {
  const parCle = new Map();
  for (const brute of Array.isArray(taches) ? taches : []) {
    if (!estObjet(brute) || typeof brute.cle !== 'string' || brute.cle === '' || parCle.has(brute.cle)) continue;
    const duree = estNombre(brute.duree) && brute.duree > 0 ? brute.duree : 0;
    const actif = estNombre(brute.actif) ? Math.min(duree, Math.max(0, brute.actif)) : duree;
    parCle.set(brute.cle, {
      cle: brute.cle,
      plat: typeof brute.plat === 'string' ? brute.plat : '',
      n: estNombre(brute.n) ? brute.n : 0,
      duree,
      actif,
      appareil: typeof brute.appareil === 'string' && brute.appareil ? brute.appareil : null,
      tempC: estNombre(brute.tempC) && brute.tempC > 0 ? brute.tempC : null,
      apres: Array.isArray(brute.apres) ? brute.apres.filter((c) => typeof c === 'string') : [],
      chaineAvec: typeof brute.chaineAvec === 'string' ? brute.chaineAvec : null,
      priorite: estNombre(brute.priorite) ? brute.priorite : 0,
      frigoAvant: estNombre(brute.frigoAvant) ? brute.frigoAvant : null,
      implicite: Boolean(brute.implicite),
    });
  }
  for (const tache of parCle.values()) {
    if (tache.chaineAvec && (!parCle.has(tache.chaineAvec) || tache.chaineAvec === tache.cle
      || parCle.get(tache.chaineAvec).appareil !== tache.appareil || !tache.appareil)) tache.chaineAvec = null;
    const apres = new Set(tache.apres.filter((c) => c !== tache.cle && parCle.has(c)));
    if (tache.chaineAvec) apres.add(tache.chaineAvec);
    tache.apres = [...apres].sort(parTexte);
  }
  // Ordre topologique (clés triées : indépendant de l'ordre reçu) ; un cycle est rompu à sa plus petite clé.
  const ordre = [];
  const places = new Set();
  const restantes = [...parCle.keys()].sort(parTexte);
  while (restantes.length) {
    const i = restantes.findIndex((cle) => parCle.get(cle).apres.every((a) => places.has(a)));
    const cle = restantes[i === -1 ? 0 : i];
    const tache = parCle.get(cle);
    if (i === -1) {
      tache.apres = tache.apres.filter((a) => places.has(a));
      if (tache.chaineAvec && !places.has(tache.chaineAvec)) tache.chaineAvec = null;
      signales.push({ raison: 'cycle', cle });
    }
    places.add(cle);
    ordre.push(tache);
    restantes.splice(restantes.indexOf(cle), 1);
  }
  // Chemin restant le plus long, jusqu'à la fin (priorité 3).
  const suivantes = new Map(ordre.map((t) => [t.cle, []]));
  for (const tache of ordre) for (const a of tache.apres) suivantes.get(a).push(tache);
  for (const tache of [...ordre].reverse()) {
    tache.reste = tache.duree + Math.max(0, ...suivantes.get(tache.cle).map((s) => s.reste));
  }
  for (const tache of ordre) {
    tache.suivantes = suivantes.get(tache.cle);
    tache.gardee = tache.suivantes.find((s) => s.chaineAvec === tache.cle) ?? null;
  }
  return { ordre, parCle };
}

/**
 * Plan des actions → { actions: [{ cle, debut, finActif, fin, appareil, tempC, prechauffe? }], finMin, travailMin,
 * signales: [{ appareil, raison: 'absent' | 'inactif' } | { cle, raison: 'cycle' } | { raison: 'repli' }] }.
 * `taches` : [{ cle, plat, n, duree, actif, appareil, tempC, apres: [cle], chaineAvec: cle|null, priorite?,
 * frigoAvant? }] ; `caps` : capacites(reglages) (ou rien : appareils de départ) ; `maintenant` : minute de départ ;
 * `fige` : Map cle → { debut, fin? } des actions faites ou lancées, à leurs heures réelles (aussi
 * 'prechauffe:<cle>'), qui gardent leurs heures ; le reste est planifié depuis `maintenant`.
 * Préchauffage : action { cle: 'prechauffe:<cle de l'étape servie>', appareil, tempC, prechauffe: { pour, tempC } },
 * PRECHAUFFAGE_TRAVAIL_MIN de travail. Actions triées par début, puis dans l'ordre où elles ont commencé.
 * Un appareil absent ou inactif compte pour un, et il est signalé.
 */
export function planifier(taches, caps, { maintenant = 0, fige = new Map() } = {}) {
  const signales = [];
  const capa = capacitesLues(caps);
  const { ordre, parCle } = tachesLues(taches, signales);
  const depart = estNombre(maintenant) ? maintenant : 0;
  const figees = fige instanceof Map ? fige : new Map(estObjet(fige) ? Object.entries(fige) : []);

  // Appareils : unités, places, température.
  const unites = new Map();
  const capaciteDe = (id) => {
    if (unites.has(id)) return unites.get(id);
    let cap = capa[id];
    if (!cap || cap.actif === false) {
      signales.push({ appareil: id, raison: cap ? 'inactif' : 'absent' });
      const deDepart = APPAREILS_DEPART.find((a) => a.id === id);
      cap = capaciteLue({ id, nombre: 1, places: 1, ecartC: cap?.ecartC ?? deDepart?.ecartC, prechauffeMin: cap?.prechauffeMin ?? deDepart?.prechauffeMin });
    }
    const entree = {
      cap,
      chauffe: cap.prechauffeMin > 0,
      liste: Array.from({ length: cap.nombre }, () => ({ occupants: [], reserves: [], chaud: null, chauffeFin: null, chauffeTemp: null, pour: null })),
    };
    unites.set(id, entree);
    return entree;
  };
  for (const tache of ordre) if (tache.appareil) capaciteDe(tache.appareil);

  const actions = new Map();
  let rangDepart = 0;
  let personneLibreA = depart;
  const restantes = new Set(ordre.map((t) => t.cle));
  const liberees = new Set();

  const compatible = (u, temp, ecart, sauf = null, avecReserves = true) => {
    const autres = [...u.occupants, ...(avecReserves ? u.reserves : [])].filter((o) => o.cle !== sauf);
    if (autres.length) return temp === null || autres.every((o) => o.temp === null || Math.abs(o.temp - temp) <= ecart);
    return true;
  };
  const tempEffective = (tache, u) => tache.tempC ?? u.chaud ?? u.occupants.find((o) => o.temp !== null)?.temp ?? null;
  /** Vrai si l'unité chauffe, ou est chaude, à une température qui convient à `temp` (null : toute température). */
  const sert = (u, cap, temp) => (u.chauffeFin !== null
    ? temp === null || Math.abs(u.chauffeTemp - temp) <= cap.ecartC
    : u.chaud !== null && (temp === null || Math.abs(u.chaud - temp) <= cap.ecartC));
  /** Vrai si l'unité est encore réservée à l'étape pour laquelle elle a été allumée (pas commencée, et elle lui sert). */
  const pourEnAttente = (u, cap) => u.pour !== null && restantes.has(u.pour) && sert(u, cap, parCle.get(u.pour).tempC);
  /** Vrai si un appareil a été allumé pour cette étape et chauffe (ou est chaud) pour elle : elle passe devant. */
  const chauffePour = (tache) => {
    if (!tache.appareil || !unites.get(tache.appareil).chauffe) return false;
    const { cap, liste } = unites.get(tache.appareil);
    return liste.some((u) => u.pour === tache.cle && sert(u, cap, tache.tempC));
  };

  /** Unité où la tâche peut commencer maintenant, ou null. */
  const placer = (tache, t) => {
    if (!tache.appareil) return { unite: null, temp: null };
    const { cap, chauffe, liste } = unites.get(tache.appareil);
    // Appareil gardé : la place réservée par l'étape d'avant.
    if (tache.chaineAvec) {
      const i = liste.findIndex((u) => u.reserves.some((r) => r.cle === tache.cle));
      if (i !== -1) {
        const u = liste[i];
        const temp = tache.tempC ?? u.reserves.find((r) => r.cle === tache.cle).temp;
        // Seuls les plats déjà dedans comptent : deux places gardées à des températures trop écartées s'attendraient
        // l'une l'autre sans fin.
        // Une fin implicite sort le plat : elle n'attend aucune température.
        if (!tache.implicite && !compatible(u, temp, cap.ecartC, tache.cle, false)) return null;
        return { unite: i, temp };
      }
    }
    for (let i = 0; i < liste.length; i += 1) {
      const u = liste[i];
      if (u.occupants.length + u.reserves.length >= cap.places) continue;
      if (!chauffe) return { unite: i, temp: tache.tempC };
      if (u.chauffeFin !== null && u.chauffeFin > t) continue;
      if (u.chaud === null) continue;
      const temp = tempEffective(tache, u);
      if (Math.abs(temp - u.chaud) > cap.ecartC || !compatible(u, temp, cap.ecartC)) continue;
      return { unite: i, temp };
    }
    return null;
  };

  const demarrer = (tache, t, place) => {
    const fin = t + tache.duree;
    const action = {
      cle: tache.cle, debut: t, finActif: t + tache.actif, fin, appareil: tache.appareil, tempC: place.temp ?? tache.tempC,
      unite: place.unite, rang: rangDepart,
    };
    rangDepart += 1;
    actions.set(tache.cle, action);
    restantes.delete(tache.cle);
    if (tache.actif > 0) personneLibreA = Math.max(personneLibreA, t + tache.actif);
    if (tache.appareil && place.unite !== null) {
      const u = unites.get(tache.appareil).liste[place.unite];
      u.reserves = u.reserves.filter((r) => r.cle !== tache.cle);
      u.occupants.push({ cle: tache.cle, temp: action.tempC });
      if (unites.get(tache.appareil).chauffe && action.tempC !== null && u.occupants.length === 1) u.chaud = action.tempC;
      if (u.pour === tache.cle) u.pour = null;
    }
  };

  /** Libère les places des actions finies à `t` ; réserve la place d'un appareil gardé. */
  const liberer = (t) => {
    const finies = [...actions.values()].filter((a) => !liberees.has(a.cle) && a.fin <= t)
      .sort((a, b) => a.fin - b.fin || a.rang - b.rang);
    for (const action of finies) {
      liberees.add(action.cle);
      if (action.prechauffe) {
        const u = unites.get(action.appareil).liste[action.unite];
        if (u.chauffeFin !== null && u.chauffeFin <= t) {
          u.chaud = u.chauffeTemp;
          u.chauffeFin = null;
        }
        continue;
      }
      if (!action.appareil || action.unite === null) continue;
      const u = unites.get(action.appareil).liste[action.unite];
      u.occupants = u.occupants.filter((o) => o.cle !== action.cle);
      const gardee = parCle.get(action.cle)?.gardee;
      if (gardee && restantes.has(gardee.cle)) u.reserves.push({ cle: gardee.cle, temp: action.tempC });
    }
  };

  const finie = (cle, t) => actions.has(cle) && actions.get(cle).fin <= t;
  const prete = (tache, t) => tache.apres.every((a) => finie(a, t));
  const reservee = (tache) => Boolean(tache.chaineAvec && tache.appareil
    && unites.get(tache.appareil).liste.some((u) => u.reserves.some((r) => r.cle === tache.cle)));
  // Étapes pas commencées dont dépend une étape pour laquelle un appareil chauffe : elles passent avant les autres.
  let pressees = new Set();
  const majPressees = () => {
    pressees = new Set();
    for (const { cap, liste } of unites.values()) {
      for (const u of liste) if (pourEnAttente(u, cap)) for (const a of ancetresAFaire(parCle.get(u.pour))) pressees.add(a.cle);
    }
  };
  const avant = (a, b) => {
    const fa = a.frigoAvant ?? Infinity;
    const fb = b.frigoAvant ?? Infinity;
    if (fa !== fb) return fa - fb;
    const ga = reservee(a) || chauffePour(a) ? 0 : (pressees.has(a.cle) ? 1 : 2);
    const gb = reservee(b) || chauffePour(b) ? 0 : (pressees.has(b.cle) ? 1 : 2);
    if (ga !== gb) return ga - gb;
    // Deux étapes qui n'attendent pas : sortir un plat d'abord, puis la plus courte (l'autre attend le moins longtemps).
    if (ga === 0 && a.implicite !== b.implicite) return a.implicite ? -1 : 1;
    if (ga === 0 && a.actif !== b.actif) return a.actif - b.actif;
    return b.reste - a.reste || a.priorite - b.priorite || parTexte(a.plat, b.plat) || a.n - b.n
      || parTexte(a.cle, b.cle);
  };

  // Actions figées.
  for (const tache of ordre) {
    const f = figees.get(tache.cle);
    if (!estObjet(f) || !estNombre(f.debut)) continue;
    const fin = estNombre(f.fin) && f.fin >= f.debut ? f.fin : f.debut + tache.duree;
    const action = {
      cle: tache.cle, debut: f.debut, finActif: Math.min(fin, f.debut + tache.actif), fin, appareil: tache.appareil,
      tempC: tache.tempC, unite: null, rang: rangDepart, fige: true,
    };
    rangDepart += 1;
    if (tache.appareil && fin > depart) {
      const { liste, chauffe } = unites.get(tache.appareil);
      const i = liste.findIndex((u) => u.occupants.length + u.reserves.length < unites.get(tache.appareil).cap.places);
      action.unite = i === -1 ? 0 : i;
      const u = liste[action.unite];
      u.occupants.push({ cle: tache.cle, temp: tache.tempC });
      if (chauffe) u.chaud = tache.tempC ?? u.chaud ?? TEMPERATURE_DEFAUT;
    }
    if (action.finActif > depart && tache.actif > 0) personneLibreA = Math.max(personneLibreA, action.finActif);
    actions.set(tache.cle, action);
    restantes.delete(tache.cle);
  }
  for (const [cle, f] of figees) {
    if (typeof cle !== 'string' || !cle.startsWith('prechauffe:') || !estObjet(f) || !estNombre(f.debut)) continue;
    const pour = parCle.get(cle.slice('prechauffe:'.length).replace(/#\d+$/, ''));
    if (!pour?.appareil || !unites.get(pour.appareil).chauffe) continue;
    const { cap, liste } = unites.get(pour.appareil);
    const temp = pour.tempC ?? TEMPERATURE_DEFAUT;
    const fin = estNombre(f.fin) && f.fin >= f.debut ? f.fin : f.debut + cap.prechauffeMin;
    const i = Math.max(0, liste.findIndex((u) => !u.occupants.length && !u.reserves.length));
    const u = liste[i];
    if (fin > depart) {
      u.chauffeFin = fin;
      u.chauffeTemp = temp;
      u.chaud = null;
    } else if (!u.occupants.length) {
      u.chaud = temp;
    }
    if (!actions.has(pour.cle)) u.pour = pour.cle;
    const finActif = Math.min(fin, f.debut + PRECHAUFFAGE_TRAVAIL_MIN);
    if (finActif > depart) personneLibreA = Math.max(personneLibreA, finActif);
    actions.set(cle, {
      cle, debut: f.debut, finActif, fin, appareil: pour.appareil, tempC: temp, unite: i, rang: rangDepart, fige: true,
      prechauffe: { pour: pour.cle, tempC: temp },
    });
    rangDepart += 1;
  }
  // Ce qui est fini avant `maintenant` : places libérées, appareils gardés réservés.
  liberer(depart);

  /**
   * Fin au plus tôt d'une tâche, sans compter les conflits (borne basse) ; mémoïsée pour un instant donné. Une tâche
   * pas commencée qui demande la personne ne commence pas avant `personne` (quand elle sera libre pour elle).
   */
  const finAuPlusTot = (t, personne = t) => {
    const memo = new Map();
    const calcul = (tache) => {
      if (memo.has(tache.cle)) return memo.get(tache.cle);
      const action = actions.get(tache.cle);
      const valeur = action ? Math.max(action.fin, t)
        : Math.max(t, tache.actif > 0 ? personne : t, ...tache.apres.map((a) => calcul(parCle.get(a)))) + tache.duree;
      memo.set(tache.cle, valeur);
      return valeur;
    };
    return calcul;
  };
  /** Ancêtres pas encore commencés d'une tâche. */
  const ancetresAFaire = (tache) => {
    const vus = new Set();
    const pile = [...tache.apres];
    while (pile.length) {
      const cle = pile.pop();
      if (vus.has(cle) || actions.has(cle)) continue;
      vus.add(cle);
      pile.push(...parCle.get(cle).apres);
    }
    return [...vus].map((cle) => parCle.get(cle));
  };

  /**
   * Vrai si lancer `x` à `t` ferait attendre une étape qui demande la personne et qui ne doit pas attendre : une étape
   * gardée (un plat laissé dans le four, le Cookeo ou la poêle), ou l'étape pour laquelle un appareil chauffe (four
   * chaud à vide), deviendrait prête pendant le travail de `x` ; ou bien `x` ne demande pas la personne et sa propre
   * étape gardée serait prête avant qu'elle soit libre. La personne fait alors autre chose de plus court, ou attend.
   */
  const retarderait = (x, t) => {
    if (x.actif > 0) {
      for (const tache of ordre) {
        if (!(tache.actif > 0) || !restantes.has(tache.cle) || tache.cle === x.cle) continue;
        let prete = null;
        if (tache.chaineAvec) {
          prete = actions.get(tache.chaineAvec)?.fin ?? null;
        } else if (chauffePour(tache) && tache.apres.every((a) => actions.has(a))) {
          // Prête quand ses `apres` sont finies et que l'appareil allumé pour elle est chaud.
          const chaud = Math.min(...unites.get(tache.appareil).liste.filter((u) => u.pour === tache.cle)
            .map((u) => u.chauffeFin ?? t));
          prete = Math.max(t, chaud, ...tache.apres.map((a) => actions.get(a).fin));
        }
        if (prete !== null && prete > t && prete < t + x.actif) return true;
      }
      return false;
    }
    if (x.gardee && x.gardee.actif > 0 && t + x.duree < personneLibreA) {
      bloquees.push(personneLibreA - x.duree);
      return true;
    }
    return false;
  };
  let bloquees = [];

  let reveils = [];
  /**
   * Préchauffage à lancer maintenant (la personne est libre), ou null. Pour chaque étape d'un appareil à chauffer qui
   * n'a encore ni appareil chaud ni préchauffage à sa température : prête à une heure estimée `r` (borne basse : chemin
   * de ses ancêtres, et travail de la personne qu'ils demandent) ; on allume si attendre la prochaine fois où la
   * personne sera libre (après `suivante`, l'action qu'elle commencerait) retarderait l'étape, et que l'appareil ne
   * resterait pas chaud à vide plus de A_VIDE_MAX minutes (sauf retard plus long encore) ; sinon un réveil à
   * r − préchauffage. L'étape servie passe ensuite devant les autres dès qu'elle est prête (chauffePour).
   */
  const prechauffageAFaire = (t, suivante) => {
    reveils = [];
    const libreApres = suivante ? t + suivante.actif : t;
    let choix = null;
    for (const tache of ordre) {
      if (!restantes.has(tache.cle) || !tache.appareil) continue;
      const { cap, chauffe, liste } = unites.get(tache.appareil);
      if (!chauffe || reservee(tache)) continue;
      if (tache.chaineAvec && restantes.has(tache.chaineAvec)) continue; // gardera l'appareil de l'étape d'avant
      const temp = tache.tempC;
      // Servie : une unité chauffe ou est chaude à sa température (une unité allumée pour elle, mais remise à une autre
      // température par une étape gardée, ne la sert plus).
      if (liste.some((u) => sert(u, cap, temp))) continue;
      const libre = liste.findIndex((u) => !u.occupants.length && !u.reserves.length
        && (u.chauffeFin === null || u.chauffeFin <= t) && (u.pour === tache.cle || !pourEnAttente(u, cap)));
      if (libre === -1) continue;
      const aFaire = ancetresAFaire(tache);
      if (aFaire.some((a) => a.appareil === tache.appareil)) continue; // le même appareil sert d'abord à une autre étape
      // Si la personne commence d'abord autre chose (`suivante`, qui n'est pas un ancêtre), ses ancêtres attendent.
      const travail = aFaire.reduce((somme, a) => somme + a.actif, 0);
      const personne = travail > 0 && suivante && !aFaire.includes(suivante) ? libreApres : t;
      const auPlusTot = finAuPlusTot(t, personne);
      let r = Math.max(t, ...tache.apres.map((a) => auPlusTot(parCle.get(a))), personne + travail);
      // Une étape gardée déjà lancée qui serait prête pendant son travail passe d'abord (retarderait).
      if (tache.actif > 0) {
        for (let encore = true; encore;) {
          encore = false;
          for (const g of ordre) {
            const fin = g.chaineAvec && g.actif > 0 && restantes.has(g.cle) ? actions.get(g.chaineAvec)?.fin : undefined;
            if (fin !== undefined && fin > r && fin < r + tache.actif) {
              r = fin + g.actif;
              encore = true;
            }
          }
        }
      }
      // Allumer maintenant si attendre la prochaine fois où la personne sera libre retarderait l'étape, sans laisser
      // l'appareil chaud à vide trop longtemps (sinon, plutôt quelques minutes de plus que le four allumé pour rien).
      const aVide = r - (t + cap.prechauffeMin);
      const retard = libreApres + cap.prechauffeMin - r;
      if (retard > 0 && (aVide <= A_VIDE_MAX || retard > aVide)) {
        if (!choix || r < choix.r || (r === choix.r && avant(tache, choix.tache) < 0)) choix = { tache, r, unite: libre };
      } else {
        reveils.push(r - cap.prechauffeMin);
      }
    }
    return choix;
  };

  const lancerPrechauffage = ({ tache, unite }, t) => {
    const { cap, liste } = unites.get(tache.appareil);
    const temp = tache.tempC ?? TEMPERATURE_DEFAUT;
    const u = liste[unite];
    const finActif = t + Math.min(PRECHAUFFAGE_TRAVAIL_MIN, cap.prechauffeMin);
    // Une clé par préchauffage : un appareil rallumé pour la même étape (remis à une autre température entre-temps)
    // reçoit « prechauffe:<cle>#2 », pour être libéré à son tour.
    let cle = `prechauffe:${tache.cle}`;
    for (let i = 2; actions.has(cle); i += 1) cle = `prechauffe:${tache.cle}#${i}`;
    u.chauffeFin = t + cap.prechauffeMin;
    u.chauffeTemp = temp;
    u.chaud = null;
    u.pour = tache.cle;
    personneLibreA = Math.max(personneLibreA, finActif);
    actions.set(cle, {
      cle, debut: t, finActif, fin: u.chauffeFin, appareil: tache.appareil, tempC: temp, unite, rang: rangDepart,
      prechauffe: { pour: tache.cle, tempC: temp },
    });
    rangDepart += 1;
  };

  let t = depart;
  let tours = 0;
  const TOURS_MAX = 20_000;
  while (restantes.size && tours < TOURS_MAX) {
    tours += 1;
    // Démarrer, dans l'ordre de priorité, tout ce qui peut l'être à `t`.
    for (;;) {
      liberer(t);
      majPressees();
      const pretes = ordre.filter((x) => restantes.has(x.cle) && prete(x, t)).sort(avant);
      const personneLibre = personneLibreA <= t;
      if (personneLibre) {
        const suivante = pretes.find((x) => x.actif > 0 && !retarderait(x, t) && placer(x, t) !== null) ?? null;
        const prechauffage = prechauffageAFaire(t, suivante);
        if (prechauffage) {
          lancerPrechauffage(prechauffage, t);
          continue;
        }
      }
      let lancee = false;
      for (const x of pretes) {
        if (x.actif > 0 && personneLibreA > t) continue;
        if (retarderait(x, t)) continue;
        const place = placer(x, t);
        if (place === null) continue;
        demarrer(x, t, place);
        lancee = true;
        break;
      }
      if (!lancee) break;
    }
    if (!restantes.size) break;
    // Prochain événement : une fin, la personne libre, un four chaud, un réveil de préchauffage.
    const evenements = [];
    for (const action of actions.values()) {
      if (action.fin > t) evenements.push(action.fin);
      if (action.finActif > t) evenements.push(action.finActif);
    }
    for (const r of reveils) if (r > t) evenements.push(r);
    for (const r of bloquees) if (r > t) evenements.push(r);
    bloquees = [];
    if (evenements.length) {
      t = Math.min(...evenements);
      continue;
    }
    // Rien ne bouge plus (ne devrait pas arriver) : allumer l'appareil d'une étape prête, sinon la lancer sans appareil.
    const pretes = ordre.filter((x) => restantes.has(x.cle) && prete(x, t)).sort(avant);
    const bloquee = pretes.find((x) => x.appareil && unites.get(x.appareil).chauffe);
    if (bloquee) {
      const { liste } = unites.get(bloquee.appareil);
      const libre = liste.findIndex((u) => !u.occupants.length && !u.reserves.length);
      if (libre !== -1 && personneLibreA <= t) {
        lancerPrechauffage({ tache: bloquee, unite: libre }, t);
        continue;
      }
    }
    const x = pretes[0] ?? ordre.find((y) => restantes.has(y.cle));
    demarrer(x, Math.max(t, personneLibreA), { unite: null, temp: x.tempC });
    t = Math.max(t, personneLibreA);
  }
  // Repli (ne devrait jamais servir) : ce qui reste est mis à la suite, dans l'ordre de la recette, sans appareil ;
  // jamais un plan tronqué. Signalé.
  if (restantes.size) {
    signales.push({ raison: 'repli' });
    for (const tache of ordre) {
      if (!restantes.has(tache.cle)) continue;
      const debut = Math.max(t, tache.actif > 0 ? personneLibreA : t, ...tache.apres.map((a) => actions.get(a)?.fin ?? t));
      demarrer(tache, debut, { unite: null, temp: tache.tempC });
    }
  }

  const liste = [...actions.values()].sort((a, b) => a.debut - b.debut || a.rang - b.rang).map((a) => ({
    cle: a.cle, debut: a.debut, finActif: a.finActif, fin: a.fin, appareil: a.appareil, tempC: a.tempC ?? null,
    ...(a.prechauffe ? { prechauffe: a.prechauffe } : {}),
  }));
  const finMin = liste.length ? Math.max(depart, ...liste.map((a) => a.fin)) : depart;
  const travailMin = liste.reduce((somme, a) => somme + (a.finActif - a.debut), 0);
  return { actions: liste, finMin, travailMin, signales };
}

// ——— Une recette seule ———

/**
 * Numéros des étapes « la veille » d'une recette (étapes lues) : celles marquées `veille` (hors « le jour du repas »)
 * et toutes celles dont elles dépendent (`apres`, directement ou non) : on prépare la marinade avant de la laisser
 * mariner. → Set de numéros.
 */
export function etapesDeLaVeille(etapes) {
  const lues = (Array.isArray(etapes) ? etapes : []).filter((e) => estObjet(e) && estNombre(e.n));
  const parN = new Map(lues.map((e) => [e.n, e]));
  const veille = new Set();
  const pile = lues.filter((e) => e.veille && !e.auService).map((e) => e.n);
  while (pile.length) {
    const n = pile.pop();
    if (veille.has(n)) continue;
    veille.add(n);
    const e = parN.get(n);
    const apres = Array.isArray(e.apres) ? e.apres : (n > 1 ? [n - 1] : []);
    for (const k of apres) if (estNombre(k) && k < n && parN.has(k) && !parN.get(k).auService) pile.push(k);
  }
  return veille;
}

/**
 * Tâches d'une recette (étapes lues, realisation.js › etapesLisibles) → tâches de planifier, sans les étapes « le jour
 * du repas » (`auService`) ni « la veille » (etapesDeLaVeille : `veille` et ce dont elles dépendent, supposées faites ;
 * on ne les attend pas) :
 * - clé : String(n) (avec `plat` : '<plat>/<n>') ; durée et travail de l'étape (sans durée : 0, `estime` du plan) ;
 * - appareil gardé (`chaineAvec`) : l'unique `apres` est l'étape précédente, sur le même appareil ;
 * - fin implicite : une étape d'attente (duree > actif) au four, au Cookeo ou à l'airfryer, qu'aucune étape n'attend,
 *   est suivie d'une tâche '<clé>-fin' (FIN_IMPLICITE_MIN de travail, même appareil, gardé : on ne laisse pas le plat
 *   dans le four) ; `implicite` : l'appareil, `pour` : la clé de l'étape d'attente.
 * Chaque tâche garde `n` (numéro de l'étape ; celui de son étape d'attente pour une fin implicite).
 */
export function tachesDUnPlat(etapes, { plat = '', priorite = 0 } = {}) {
  const lues = (Array.isArray(etapes) ? etapes : []).filter((e) => estObjet(e) && estNombre(e.n));
  const horsCalcul = new Set([...lues.filter((e) => e.auService).map((e) => e.n), ...etapesDeLaVeille(lues)]);
  const gardees = lues.filter((e) => !horsCalcul.has(e.n));
  const cleDe = (n) => (plat ? `${plat}/${n}` : String(n));
  const parN = new Map(gardees.map((e) => [e.n, e]));
  const apresDe = (e) => {
    const brutes = Array.isArray(e.apres) ? e.apres : (e.n > 1 ? [e.n - 1] : []);
    return [...new Set(brutes.filter((k) => estNombre(k) && k < e.n && parN.has(k)))].sort((a, b) => a - b);
  };
  const attendues = new Set();
  for (const e of gardees) for (const k of apresDe(e)) attendues.add(k);
  const taches = [];
  for (const e of gardees) {
    const duree = estNombre(e.duree) && e.duree > 0 ? e.duree : 0;
    const actif = estNombre(e.actif) ? Math.min(duree, Math.max(0, e.actif)) : duree;
    const apres = apresDe(e);
    const precedente = parN.get(e.n - 1);
    const chaine = apres.length === 1 && apres[0] === e.n - 1 && e.appareil && precedente?.appareil === e.appareil;
    taches.push({
      cle: cleDe(e.n), plat, n: e.n, duree, actif, appareil: e.appareil ?? null, tempC: estNombre(e.tempC) ? e.tempC : null,
      apres: apres.map(cleDe), chaineAvec: chaine ? cleDe(e.n - 1) : null, priorite, implicite: null, pour: null,
      estime: !(duree > 0) || Boolean(e.estime),
    });
    if (APPAREILS_A_SORTIR.includes(e.appareil) && duree > actif && !attendues.has(e.n)) {
      taches.push({
        cle: `${cleDe(e.n)}-fin`, plat, n: e.n, duree: FIN_IMPLICITE_MIN, actif: FIN_IMPLICITE_MIN, appareil: e.appareil,
        tempC: estNombre(e.tempC) ? e.tempC : null, apres: [cleDe(e.n)], chaineAvec: cleDe(e.n), priorite,
        implicite: e.appareil, pour: cleDe(e.n), estime: false,
      });
    }
  }
  return taches;
}

/**
 * Ordre d'une recette seule, pour une personne → { ordre: [{ cle, n, implicite, pour, debut, finActif, fin }],
 * prechauffages: [{ cle, appareil, tempC, pour, debut, avant }], finMin, travailMin, estime, signales }.
 * Étapes datées (toutes une durée) : ordre du plan (ce qui avance pendant une attente passe avant) ; `avant` : la clé
 * de l'étape en tête de laquelle dire « Allumez le four » : celle que la personne commence juste après l'avoir allumé,
 * sinon celle qu'elle a sous les yeux à ce moment (la dernière commencée : un peu tôt plutôt que trop tard), sinon la
 * première. Une étape sans
 * durée (repli sur les étapes courtes) : ordre de la recette, fins implicites à leur place, rien de daté, `finMin`
 * null, `estime` vrai.
 */
export function ordreDUnPlat(etapes, caps) {
  const taches = tachesDUnPlat(etapes);
  const estime = taches.some((t) => t.estime);
  if (estime || !taches.length) {
    return {
      ordre: taches.map((t) => ({ cle: t.cle, n: t.n, implicite: t.implicite, pour: t.pour, debut: null, finActif: null, fin: null })),
      prechauffages: [], finMin: taches.length ? null : 0, travailMin: null, estime, signales: [],
    };
  }
  const plan = planifier(taches, caps);
  const parCle = new Map(taches.map((t) => [t.cle, t]));
  const ordre = plan.actions.filter((a) => !a.prechauffe).map((a) => {
    const tache = parCle.get(a.cle);
    return { cle: a.cle, n: tache.n, implicite: tache.implicite, pour: tache.pour, debut: a.debut, finActif: a.finActif, fin: a.fin };
  });
  const prechauffages = plan.actions.filter((a) => a.prechauffe).map((a) => {
    // L'étape commencée juste après avoir allumé ; sinon celle qu'on a sous les yeux à ce moment (un peu tôt plutôt
    // que trop tard) ; sinon la première.
    const juste = ordre.find((o) => o.debut >= a.debut && o.debut <= a.finActif);
    const enCours = [...ordre].reverse().find((o) => o.debut <= a.debut);
    const suivante = juste ?? enCours ?? ordre[0];
    return {
      cle: a.cle, appareil: a.appareil, tempC: a.prechauffe.tempC, pour: a.prechauffe.pour, debut: a.debut,
      avant: suivante?.cle ?? a.prechauffe.pour,
    };
  });
  return { ordre, prechauffages, finMin: plan.finMin, travailMin: plan.travailMin, estime: false, signales: plan.signales };
}

/** Durée d'une recette seule (finMin de planifier sur ce seul plat ; sans « Sortir tout ce qu'il faut » ni rangement), ou null. */
export function dureeTotale(etapes, caps) {
  return ordreDUnPlat(etapes, caps).finMin;
}
