// Tirages pour les tests de l'ordonnanceur (T5-1) : générateur à graine fixe (mulberry32) et recettes au hasard, de
// 1 à 6 plats. Hors de js/coeur/ : l'app n'en a pas besoin. Données génériques.

/** Générateur pseudo-aléatoire à graine fixe : renvoie une fonction qui donne un nombre dans [0, 1[. */
export function generateur(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const entre = (hasard, min, max) => min + Math.floor(hasard() * (max - min + 1));
const parmi = (hasard, valeurs) => valeurs[Math.floor(hasard() * valeurs.length)];

/**
 * Étapes lues au hasard pour une recette (forme de realisation.js › etapesLisibles) : 1 à 8 étapes, durées de 1 à
 * 90 min, travail au début, appareils variés (four à 160, 180, 200 ou 220 °C, parfois sans température), `apres` vers
 * des étapes plus petites, parfois une étape « le jour du repas » ou « la veille ».
 */
export function etapesAuHasard(hasard) {
  const nombre = entre(hasard, 1, 8);
  const etapes = [];
  for (let n = 1; n <= nombre; n += 1) {
    const appareil = parmi(hasard, [null, null, 'plaque', 'plaque', 'four', 'cookeo', 'airfryer']);
    const duree = appareil ? entre(hasard, 3, 90) : entre(hasard, 1, 20);
    const actif = appareil ? parmi(hasard, [0, 1, 2, Math.min(duree, entre(hasard, 1, 15)), duree]) : parmi(hasard, [duree, duree, 0]);
    let apres = null;
    const choix = hasard();
    if (n > 1 && choix < 0.35) {
      apres = [];
      for (let k = 1; k < n; k += 1) if (hasard() < 0.35) apres.push(k);
    }
    let tempC = null;
    if (appareil === 'four') tempC = parmi(hasard, [160, 180, 200, 220, null]);
    if (appareil === 'airfryer') tempC = parmi(hasard, [180, 200]);
    etapes.push({
      n, titre: `Étape ${n}`, texte: '', duree, actif, appareil, tempC, apres: apres ?? (n > 1 ? [n - 1] : []),
      auService: n === nombre && nombre > 2 && hasard() < 0.15, veille: n === 1 && hasard() < 0.05, estime: false,
      ingredients: [], aussi: [], ustensiles: [],
    });
  }
  return etapes;
}

/** Un tirage : 1 à 6 plats ('p1'…), chacun avec ses étapes au hasard. → [{ plat, etapes }] */
export function platsAuHasard(hasard) {
  const nombre = entre(hasard, 1, 6);
  return Array.from({ length: nombre }, (_, i) => ({ plat: `p${i + 1}`, etapes: etapesAuHasard(hasard) }));
}

/** Mélange (Fisher-Yates) avec le générateur donné ; la liste reçue n'est pas modifiée. */
export function melanger(liste, hasard) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(hasard() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Recette « réaliste » à un seul four (relecture de T5-1) : 3 à 6 étapes, préparations de 3 à 20 min, plaque de 5 à
 * 20 min, four à 180 °C de 15 à 45 min (1 ou 2 min de travail), une fois sur trois une étape indépendante. → étapes
 * lues, ou null si la recette tirée n'a pas exactement une étape au four.
 */
export function recetteAUnFour(hasard) {
  const nombre = entre(hasard, 3, 6);
  const etapes = [];
  for (let n = 1; n <= nombre; n += 1) {
    const appareil = parmi(hasard, [null, null, null, 'four', 'plaque', 'plaque']);
    const duree = appareil === 'four' ? parmi(hasard, [15, 20, 25, 30, 40, 45])
      : appareil === 'plaque' ? parmi(hasard, [5, 10, 15, 20]) : parmi(hasard, [3, 5, 8, 10, 15, 20]);
    const actif = appareil === 'four' ? parmi(hasard, [1, 2]) : appareil === 'plaque' ? parmi(hasard, [2, 3, duree]) : duree;
    const apres = n > 1 ? (hasard() < 0.3 ? [] : [n - 1]) : [];
    etapes.push({
      n, titre: `Étape ${n}`, texte: '', duree, actif, appareil, tempC: appareil === 'four' ? 180 : null, apres,
      auService: false, veille: false, estime: false, ingredients: [], aussi: [], ustensiles: [],
    });
  }
  return etapes.filter((e) => e.appareil === 'four').length === 1 ? etapes : null;
}
