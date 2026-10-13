// Étapes détaillées d'une recette, `realisation` (CLAUDE.md §8, T5-0b) : validation et tolérances, lecture (avec repli
// sur les étapes courtes), plats encore à détailler, empreinte des étapes, parts à mettre de côté, édition réduite de
// « Modifier », textes des écrans. Logique pure : ni DOM ni Firebase.
// N'importe que slug.js, vocabulaire.js, plats.js, corbeille.js (feuille) et empreinte.js : paquet.js, claude.js,
// relecture.js et edition.js l'importent, jamais l'inverse.
import { cleProduit } from './slug.js';
import { VOCABULAIRES, code, estObjet, nombre, texte } from './vocabulaire.js';
import { APPAREILS, aSaRecette, cuissonLisible, quantiteLisible, statutDe, typeDe } from './plats.js';
import { estDansCorbeille } from './corbeille.js';
import { cuissonEnTexte, empreinteDeTexte } from './empreinte.js';

// ——— Bornes et vocabulaires ———

export const ETAPES_MAX = 30;
export const DUREE_MAX_MIN = 1440;
/** Attente (duree − actif) au-delà de laquelle une étape se lance la veille ou des heures avant, sans `veille` écrit. */
export const VEILLE_ATTENTE_MIN = 240;
export const FEUX = ['doux', 'moyen', 'vif'];
/** Recettes détaillées par message de Claude (essai du 2026-10-12 : moins de 4 Ko par recette). */
export const ETAPES_PAR_MESSAGE = 4;
export const TITRE_MAX = 60;
/** Texte d'une étape : 350 caractères conseillés à Claude, avertissement au-delà de 450, erreur au-delà de 1 000. */
export const TEXTE_CONSEILLE = 350;
export const TEXTE_LONG = 450;
export const TEXTE_MAX = 1000;
export const MODE_MAX = 30;
export const USTENSILES_MAX = 8;
export const USTENSILE_MAX = 40;
export const AUSSI_MAX = 6;
export const PRET_MAX = 120;
/** Écart de température toléré entre une étape au four ou à l'airfryer et la cuisson de la fiche. */
export const ECART_TEMPERATURE = 10;
/** Durée d'une étape ajoutée dans « Modifier » sans durée saisie. */
export const DUREE_PAR_DEFAUT = 5;

/** Ustensiles suggérés à Claude (docs/projet-claude.md, section 2 bis). */
export const USTENSILES_SUGGERES = [
  'grande casserole', 'casserole', 'faitout', 'cocotte', 'sauteuse', 'poêle', 'wok', 'plat à gratin', 'moule',
  'plaque de four', 'saladier', 'passoire', 'planche', 'couteau', 'couteau d\'office', 'éplucheur', 'râpe', 'fouet',
  'spatule en bois', 'louche', 'écumoire', 'mixeur plongeant', 'robot', 'balance', 'verre doseur',
];

const APPAREILS_A_TEMPERATURE = ['four', 'airfryer'];
const APPAREILS_A_MODE = ['cookeo', 'airfryer', 'monsieur_cuisine'];
// Feux tolérés : casse, accents, « feu moyen », « moyen-vif » → vif, « moyen-doux » → doux.
const FEUX_TOLERES = {
  doux: 'doux', tres_doux: 'doux', moyen_doux: 'doux', faible: 'doux', petit: 'doux',
  moyen: 'moyen', moyen_fort: 'vif', moyen_vif: 'vif', vif: 'vif', fort: 'vif', tres_vif: 'vif', tres_fort: 'vif',
};
// Ordre des types dans la liste des plats à détailler.
const ORDRE_TYPES = ['plat', 'dessert', 'accompagnement', 'preparation', 'apero'];
const comparerNoms = new Intl.Collator('fr', { sensitivity: 'base' }).compare;
const guillemets = (valeur) => `«\u00A0${valeur}\u00A0»`;
/** « 9 étapes », « 1 recette » : nombre suivi d'une espace insécable. */
const compte = (n, un, plusieurs) => `${n}\u00A0${n > 1 ? plusieurs : un}`;

function booleen(valeur) {
  if (typeof valeur === 'boolean') return valeur;
  const c = code(valeur);
  if (c === 'true' || c === 'oui') return true;
  if (c === 'false' || c === 'non') return false;
  return null;
}

/** Libellé d'un appareil en minuscules, pour une phrase (« four », « monsieur cuisine »). */
const nomAppareil = (appareil) => (APPAREILS[appareil] ?? String(appareil ?? '')).toLocaleLowerCase('fr-FR');

/** Valeur reçue recopiée dans un message (texte sur une ligne ; « ? » pour un objet ou une liste). */
function lisible(valeur) {
  if (typeof valeur === 'string') return texte(valeur);
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  return '?';
}

/** Texte coupé à `max` caractères (jamais un emoji coupé), espaces de fin retirés. */
const couper = (valeur, max) => [...valeur].slice(0, max).join('').trim();
const longueur = (valeur) => [...valeur].length;

// ——— Validation ———

/**
 * Valide une réalisation reçue (CLAUDE.md §8, plan §4.1). Erreurs réservées à la structure et, avec `cuisson`, à la
 * manière de cuire (un appareil de `cuisson[]` dans aucune étape hors `auService`, ou une étape au four ou à
 * l'airfryer hors `auService` à plus de 10 °C de toute température de `cuisson[]` pour cet appareil ; `ecart:
 * 'avertissement'` les change en avertissements : fiche en base, sauvegarde, « Modifier »). Tout le reste est toléré :
 * valeur retirée, coupée ou ramenée, avec un avertissement.
 * Options : `produits` (ingrédients de la fiche ; null : non vérifiés, noms seulement mis en minuscules),
 * `cuisson` (`cuisson[]` de la fiche ; null : non vérifiée), `prefixe` (début des codes pour Claude, « plats[0]
 * (gratin) »), `nom` ou `affiche` (nom du plat, sans guillemets, pour les messages).
 * → { realisation (normalisée, ou null s'il y a une erreur), erreurs, avertissements } ; chaque erreur ou
 *   avertissement : { message (affiché), raison (fin de phrase, sans majuscule ni point : « l’appareil four de sa
 *   cuisson n’apparaît dans aucune étape »), code (pour Claude, sans préfixe : « realisation[5].duree : entier de 1 à
 *   1440 attendu »), pourClaude (code préfixé) }.
 * Une réalisation normalisée revalidée avec les mêmes options redonne la même (idempotence).
 */
export function validerRealisation(brut, {
  produits = null, cuisson = null, prefixe = '', nom = '', affiche: nomAffiche = '', ecart = 'erreur',
} = {}) {
  const erreurs = [];
  const avertissements = [];
  const nomPlat = texte(nom) || texte(nomAffiche);
  const affiche = nomPlat ? guillemets(nomPlat) : 'Cette recette';
  const noter = (liste) => (raison, codeClaude) => liste.push({
    message: `${affiche}\u00A0: ${raison}.`,
    raison,
    code: codeClaude,
    pourClaude: prefixe ? `${prefixe} ${codeClaude}` : codeClaude,
  });
  const signaler = noter(erreurs);
  const prevenir = noter(avertissements);
  const ecarter = ecart === 'avertissement' ? prevenir : signaler;
  const fin = (realisation) => ({ realisation: erreurs.length ? null : realisation, erreurs, avertissements });

  if (!Array.isArray(brut) || !brut.length) {
    signaler('les étapes détaillées sont illisibles', `realisation : liste de 1 à ${ETAPES_MAX} étapes attendue`);
    return fin(null);
  }
  if (brut.length > ETAPES_MAX) {
    signaler(`trop d’étapes détaillées (${ETAPES_MAX} au plus)`, `realisation : ${ETAPES_MAX} étapes au plus`);
    return fin(null);
  }

  // Ingrédients de la fiche, par clé de produit (slug.js › cleProduit : pluriel toléré mot par mot).
  const fiche = Array.isArray(produits) ? produits.filter(estObjet) : null;
  const parCle = new Map();
  for (const ingredient of fiche ?? []) {
    const cle = cleProduit(ingredient.produit);
    if (!cle) continue;
    const deja = parCle.get(cle);
    if (deja) deja.fois += 1;
    else parCle.set(cle, { nom: texte(ingredient.produit), fois: 1 });
  }

  let partAvantVue = 0;
  const realisation = brut.map((etape, i) => {
    const n = i + 1;
    const la = `realisation[${i}]`;
    if (!estObjet(etape)) {
      signaler(`l’étape ${n} est illisible`, `${la} : objet attendu`);
      return null;
    }
    const sortie = {};
    let ok = true;

    const titre = texte(etape.titre);
    if (!titre) {
      ok = false;
      signaler(`l’étape ${n} n’a pas de titre`, `${la}.titre : texte obligatoire (${TITRE_MAX} caractères au plus)`);
    } else if (longueur(titre) > TITRE_MAX) {
      ok = false;
      signaler(`le titre de l’étape ${n} est trop long (${TITRE_MAX} caractères au plus)`, `${la}.titre : ${TITRE_MAX} caractères au plus`);
    } else {
      sortie.titre = titre;
    }

    const corps = texte(etape.texte);
    if (!corps) {
      ok = false;
      signaler(`l’étape ${n} n’a pas de texte`, `${la}.texte : texte obligatoire`);
    } else if (longueur(corps) > TEXTE_MAX) {
      ok = false;
      signaler(`le texte de l’étape ${n} est trop long (${TEXTE_MAX}\u00A0caractères au plus)`, `${la}.texte : ${TEXTE_MAX} caractères au plus (${TEXTE_CONSEILLE} conseillés)`);
    } else {
      sortie.texte = corps;
      if (longueur(corps) > TEXTE_LONG) prevenir(`le texte de l’étape ${n} est long à lire sur un téléphone`, `${la}.texte : ${TEXTE_CONSEILLE} caractères conseillés`);
    }

    const duree = nombre(etape.duree);
    if (!(Number.isInteger(duree) && duree >= 1 && duree <= DUREE_MAX_MIN)) {
      ok = false;
      signaler(`l’étape ${n} n’a pas de durée lisible`, `${la}.duree : entier de 1 à ${DUREE_MAX_MIN} attendu`);
    } else {
      sortie.duree = duree;
    }

    if (etape.actif != null) {
      const actif = nombre(etape.actif);
      if (!(Number.isFinite(actif) && actif >= 0)) {
        prevenir(`le temps de travail de l’étape ${n} est illisible\u00A0: il est ignoré`, `${la}.actif : entier de 0 à duree, ignoré`);
      } else if (sortie.duree !== undefined && Math.round(actif) > sortie.duree) {
        sortie.actif = sortie.duree;
        prevenir(`le temps de travail de l’étape ${n} dépasse sa durée\u00A0: il est ramené à la durée`, `${la}.actif : ramené à duree`);
      } else {
        sortie.actif = Math.round(actif);
      }
    }

    // Appareil : inconnu, retiré (le micro-ondes d'une étape « le jour du repas » sans rien dire).
    let appareil = null;
    if (etape.appareil != null && !(typeof etape.appareil === 'string' && !etape.appareil.trim())) {
      const valeur = code(etape.appareil);
      if (VOCABULAIRES.appareil.includes(valeur)) {
        appareil = valeur;
        sortie.appareil = valeur;
      } else if (!(/^micro_?ondes?$/.test(valeur) && booleen(etape.auService) === true)) {
        prevenir(`l’appareil de l’étape ${n} est inconnu\u00A0: il est ignoré`, `${la}.appareil « ${lisible(etape.appareil)} » inconnu, retiré`);
      }
    }

    if (appareil && APPAREILS_A_MODE.includes(appareil) && texte(etape.mode)) {
      const mode = texte(etape.mode);
      if (longueur(mode) > MODE_MAX) {
        sortie.mode = couper(mode, MODE_MAX);
        prevenir(`le programme de l’étape ${n} est coupé à ${MODE_MAX}\u00A0caractères`, `${la}.mode : ${MODE_MAX} caractères au plus`);
      } else {
        sortie.mode = mode;
      }
    }

    if (appareil && APPAREILS_A_TEMPERATURE.includes(appareil)) {
      if (etape.tempC == null) {
        prevenir(`la température de l’étape ${n} n’est pas précisée`, `${la}.tempC conseillé pour ${appareil}`);
      } else {
        const temperature = nombre(etape.tempC);
        if (temperature > 0) sortie.tempC = Math.round(temperature);
        else prevenir(`la température de l’étape ${n} est illisible\u00A0: elle est ignorée`, `${la}.tempC : nombre supérieur à 0, ignoré`);
      }
    }

    if (appareil === 'plaque' && etape.feu != null && !(typeof etape.feu === 'string' && !etape.feu.trim())) {
      const valeur = code(etape.feu).replace(/^(a_)?feu_/, '');
      const feu = FEUX_TOLERES[valeur];
      if (feu) sortie.feu = feu;
      else prevenir(`le feu de l’étape ${n} est inconnu\u00A0: il est ignoré`, `${la}.feu « ${lisible(etape.feu)} » : \`doux\`, \`moyen\` ou \`vif\``);
    }

    if (etape.ustensiles != null) {
      const bruts = typeof etape.ustensiles === 'string' ? [etape.ustensiles] : etape.ustensiles;
      if (!Array.isArray(bruts)) {
        prevenir(`les ustensiles de l’étape ${n} sont illisibles\u00A0: ils sont ignorés`, `${la}.ustensiles : liste de noms attendue`);
      } else {
        const noms = [];
        let coupe = false;
        for (const valeur of bruts) {
          const nomUstensile = texte(typeof valeur === 'string' ? valeur : '').toLocaleLowerCase('fr-FR');
          if (!nomUstensile) {
            if (valeur != null && valeur !== '') coupe = true;
            continue;
          }
          const garde = longueur(nomUstensile) > USTENSILE_MAX ? couper(nomUstensile, USTENSILE_MAX) : nomUstensile;
          if (garde !== nomUstensile) coupe = true;
          if (!noms.includes(garde)) noms.push(garde);
        }
        if (noms.length > USTENSILES_MAX) coupe = true;
        if (coupe) prevenir(`la liste des ustensiles de l’étape ${n} est raccourcie`, `${la}.ustensiles : ${USTENSILES_MAX} au plus, ${USTENSILE_MAX} caractères chacun`);
        if (noms.length) sortie.ustensiles = noms.slice(0, USTENSILES_MAX);
      }
    }

    if (etape.ingredients != null) {
      const bruts = typeof etape.ingredients === 'string' ? [etape.ingredients] : etape.ingredients;
      if (!Array.isArray(bruts)) {
        prevenir(`les ingrédients de l’étape ${n} sont illisibles\u00A0: ils sont ignorés`, `${la}.ingredients : liste attendue`);
      } else {
        const cites = [];
        bruts.forEach((element, j) => {
          const objet = estObjet(element);
          const nomCite = texte(objet ? element.produit : (typeof element === 'string' ? element : ''));
          if (!nomCite) {
            prevenir(`un ingrédient de l’étape ${n} est illisible\u00A0: il est ignoré`, `${la}.ingredients[${j}] : nom de produit attendu`);
            return;
          }
          let produit = nomCite.toLocaleLowerCase('fr-FR');
          if (fiche) {
            const trouve = parCle.get(cleProduit(nomCite));
            if (!trouve) {
              prevenir(`${guillemets(nomCite)} n’est pas dans ses ingrédients\u00A0: sa quantité ne s’affichera pas à l’étape ${n}`,
                `${la}.ingredients « ${nomCite} » : absent des ingredients, retiré`);
              return;
            }
            produit = trouve.nom;
          }
          let part = null;
          if (objet && element.part != null) {
            const valeur = nombre(element.part);
            if (valeur > 0 && valeur <= 1) part = valeur;
            else prevenir(`la part de ${guillemets(produit)} à l’étape ${n} est illisible\u00A0: elle est ignorée`, `${la}.ingredients[${j}].part : nombre de 0 (exclu) à 1, ignoré`);
          }
          if (cites.some((c) => cleProduit(typeof c === 'string' ? c : c.produit) === cleProduit(produit))) return;
          cites.push(part !== null ? { produit, part } : produit);
        });
        if (cites.length) sortie.ingredients = cites;
      }
    }

    if (etape.aussi != null) {
      const bruts = typeof etape.aussi === 'string' || estObjet(etape.aussi) ? [etape.aussi] : etape.aussi;
      if (!Array.isArray(bruts)) {
        prevenir(`« Et aussi » de l’étape ${n} est illisible\u00A0: il est ignoré`, `${la}.aussi : liste attendue`);
      } else {
        const aussi = [];
        bruts.forEach((element, j) => {
          const objet = estObjet(element);
          const produit = texte(objet ? element.produit : (typeof element === 'string' ? element : '')).toLocaleLowerCase('fr-FR');
          if (!produit) {
            prevenir(`un élément de « Et aussi » de l’étape ${n} est illisible\u00A0: il est ignoré`, `${la}.aussi[${j}] : nom de produit attendu`);
            return;
          }
          if (!objet || element.qte == null) {
            aussi.push(produit);
            return;
          }
          const qte = nombre(element.qte);
          const unite = element.unite == null || element.unite === '' ? null : code(element.unite);
          if (!(qte > 0) || (unite !== null && !VOCABULAIRES.unite.includes(unite))) {
            prevenir(`la mesure de ${guillemets(produit)} à l’étape ${n} est illisible\u00A0: elle est ignorée`, `${la}.aussi[${j}] : qte supérieure à 0 et unite connue attendues`);
            aussi.push(produit);
            return;
          }
          const mesure = { produit, qte };
          if (unite) mesure.unite = unite;
          if (booleen(element.fixe) === true) mesure.fixe = true;
          aussi.push(mesure);
        });
        if (aussi.length > AUSSI_MAX) prevenir(`« Et aussi » de l’étape ${n} est raccourci à ${AUSSI_MAX}`, `${la}.aussi : ${AUSSI_MAX} au plus`);
        if (aussi.length) sortie.aussi = aussi.slice(0, AUSSI_MAX);
      }
    }

    const pret = texte(etape.pret);
    if (pret) {
      if (longueur(pret) > PRET_MAX) {
        sortie.pret = couper(pret, PRET_MAX);
        prevenir(`le signe « prêt » de l’étape ${n} est raccourci`, `${la}.pret : ${PRET_MAX} caractères au plus`);
      } else {
        sortie.pret = pret;
      }
    }

    if (etape.apres != null) {
      const bruts = Array.isArray(etape.apres) ? etape.apres : [etape.apres];
      const apres = [];
      const retires = [];
      for (const valeur of bruts) {
        const k = nombre(valeur);
        if (Number.isInteger(k) && k >= 1 && k < n) {
          if (!apres.includes(k)) apres.push(k);
        } else {
          retires.push(lisible(valeur));
        }
      }
      if (retires.length) {
        prevenir(`l’étape ${n} attendait une étape qui ne vient pas avant elle\u00A0: elle suit la précédente`, `${la}.apres : ${retires.join(', ')} retiré (numéros d'étapes plus petits que ${n} attendus)`);
      }
      // Toutes les valeurs retirées : l'étape suit la précédente (champ absent) ; [] reçu : dès le début.
      if (apres.length || !retires.length) sortie.apres = apres.sort((a, b) => a - b);
    }

    if (booleen(etape.auService) === true) sortie.auService = true;
    if (booleen(etape.veille) === true) sortie.veille = true;
    if (booleen(etape.partAvant) === true) {
      partAvantVue += 1;
      if (partAvantVue === 1) sortie.partAvant = true;
      else prevenir(`les parts se mettent de côté une seule fois\u00A0: l’étape ${n} n’en est pas une`, `${la}.partAvant : une seule étape, ignoré`);
    }
    return ok ? sortie : null;
  });
  if (realisation.some((etape) => etape === null)) return fin(null);

  // Ingrédients de la fiche : cités par aucune étape, cités deux fois sans part, parts de plus de 1, produit en double.
  if (fiche) {
    const citations = new Map();
    realisation.forEach((etape, i) => {
      for (const cite of etape.ingredients ?? []) {
        const produit = typeof cite === 'string' ? cite : cite.produit;
        const cle = cleProduit(produit);
        if (!citations.has(cle)) citations.set(cle, []);
        citations.get(cle).push({ n: i + 1, part: typeof cite === 'string' ? null : cite.part });
      }
    });
    for (const [cle, { nom: produit, fois }] of parCle) {
      const vues = citations.get(cle) ?? [];
      if (!vues.length) {
        prevenir(`${guillemets(produit)} n’est cité par aucune étape\u00A0: sa quantité ne s’affichera à aucune étape`, `realisation : ingrédient « ${produit} » cité par aucune étape`);
        continue;
      }
      if (fois > 1) {
        prevenir(`${guillemets(produit)} est deux fois dans ses ingrédients\u00A0: ses quantités sont additionnées à l’étape qui le cite`, `ingredients : « ${produit} » deux fois, quantités additionnées`);
      }
      const sansPart = vues.filter((v) => v.part === null);
      if (vues.length > 1 && sansPart.length) {
        const numeros = vues.map((v) => v.n);
        prevenir(`${guillemets(produit)} est cité aux étapes ${numeros.slice(0, -1).join(', ')} et ${numeros.at(-1)} sans dire quelle part\u00A0: sa quantité s’affichera à chacune`,
          `realisation : « ${produit} » cité aux étapes ${numeros.join(', ')} sans part`);
      } else if (vues.reduce((somme, v) => somme + (v.part ?? 1), 0) > 1 + 1e-6) {
        prevenir(`les parts de ${guillemets(produit)} font plus que la quantité de la recette`, `realisation : parts de « ${produit} » : somme supérieure à 1`);
      }
    }
  }

  // Manière de cuire : appareils et températures de `cuisson[]` (hors étapes « le jour du repas »).
  const cuissons = Array.isArray(cuisson) ? cuisson.filter((c) => estObjet(c) && VOCABULAIRES.appareil.includes(c.appareil)) : null;
  if (cuissons && cuissons.length) {
    const recette = realisation.map((etape, i) => ({ etape, n: i + 1 })).filter(({ etape }) => !etape.auService);
    const vus = new Set();
    for (const { appareil } of cuissons) {
      if (vus.has(appareil)) continue;
      vus.add(appareil);
      const siennes = recette.filter(({ etape }) => etape.appareil === appareil);
      if (!siennes.length) {
        ecarter(`l’appareil ${nomAppareil(appareil)} de sa cuisson n’apparaît dans aucune étape`, `realisation : l'appareil ${appareil} de cuisson n'apparaît dans aucune étape`);
        continue;
      }
      // Durée : la plus longue étape de l'appareil, comparée à la plus longue cuisson de l'appareil.
      const plusLongueCuisson = Math.max(0, ...cuissons.filter((c) => c.appareil === appareil).map((c) => nombre(c.dureeMin)).filter((d) => d > 0));
      const plusLongueEtape = Math.max(...siennes.map(({ etape }) => etape.duree));
      if (plusLongueCuisson > 0 && Math.abs(plusLongueEtape - plusLongueCuisson) > plusLongueCuisson / 2) {
        prevenir(`ses étapes ${appareil === 'plaque' ? 'sur la plaque' : `au ${nomAppareil(appareil)}`} durent ${plusLongueEtape}\u00A0min, sa cuisson dit ${plusLongueCuisson}\u00A0min`,
          `realisation : ${appareil} : étape la plus longue ${plusLongueEtape} min, cuisson ${plusLongueCuisson} min`);
      }
    }
    for (const { etape, n } of recette) {
      if (!etape.appareil) continue;
      if (!vus.has(etape.appareil)) {
        prevenir(`l’étape ${n} utilise ${etape.appareil === 'plaque' ? 'la plaque' : `le ${nomAppareil(etape.appareil)}`}, dont sa cuisson ne dit rien`, `realisation[${n - 1}].appareil ${etape.appareil} : absent de cuisson`);
        continue;
      }
      if (!APPAREILS_A_TEMPERATURE.includes(etape.appareil) || etape.tempC == null) continue;
      const temperatures = cuissons.filter((c) => c.appareil === etape.appareil).map((c) => nombre(c.tempC)).filter((t) => t > 0);
      if (!temperatures.length) continue;
      if (temperatures.every((t) => Math.abs(t - etape.tempC) > ECART_TEMPERATURE)) {
        ecarter(`l’étape ${n} cuit ${etape.appareil === 'four' ? 'au four' : 'à l’airfryer'} à ${etape.tempC}\u00A0°C, sa cuisson dit ${temperatures.join(' ou ')}\u00A0°C`,
          `realisation[${n - 1}].tempC : ${etape.tempC} °C, la cuisson dit ${temperatures.join(' ou ')} °C pour ${etape.appareil} (${ECART_TEMPERATURE} °C d'écart au plus)`);
      }
    }
  }
  return fin(realisation);
}

/** Titres d'une réalisation, dans l'ordre : la liste `etapes` écrite avec elle (pour une app pas encore à jour). */
export function titresDe(realisation) {
  return (Array.isArray(realisation) ? realisation : []).map((etape) => texte(estObjet(etape) ? etape.titre : '')).filter(Boolean);
}

// Validation structurelle d'une réalisation en base, gardée par liste (les fiches lues ne changent pas en place).
const memoire = new WeakMap();
function realisationDe(plat) {
  const brute = plat?.realisation;
  if (!Array.isArray(brute)) return null;
  const cle = `${JSON.stringify(plat?.ingredients ?? null)}|${JSON.stringify(plat?.cuisson ?? null)}`;
  const deja = memoire.get(brute);
  if (deja && deja.cle === cle) return deja.resultat;
  const resultat = validerRealisation(brute, {
    produits: Array.isArray(plat?.ingredients) ? plat.ingredients : null,
    cuisson: Array.isArray(plat?.cuisson) ? plat.cuisson : null,
    nom: plat?.nom,
    ecart: 'avertissement',
  });
  memoire.set(brute, { cle, resultat });
  return resultat;
}

const memesListes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Vrai si la fiche a une réalisation valide (structure ; un écart de cuisson n'est qu'un avertissement) et des
 * `etapes` égales à ses titres. Faux : pas de réalisation, réalisation abîmée, ou étapes changées par une app d'avant
 * (l'app montre alors `etapes`, et la recette est de nouveau « à détailler »).
 */
export function realisationAJour(plat) {
  const lue = realisationDe(plat);
  if (!lue?.realisation) return false;
  const etapes = (Array.isArray(plat?.etapes) ? plat.etapes : []).map((e) => texte(typeof e === 'string' ? e : ''));
  return memesListes(titresDe(plat.realisation), etapes);
}

/**
 * État des étapes d'une fiche : 'detaillee' (réalisation à jour), 'perimee' (une réalisation existe, mais les étapes ont
 * été changées ailleurs ou elle est abîmée), 'courte' (étapes courtes seulement, recette remplie), 'sansRecette' (⏳).
 */
export function etatRealisation(plat) {
  if (statutDe(plat) === 'attente' || !aSaRecette(plat)) return 'sansRecette';
  if (realisationAJour(plat)) return 'detaillee';
  return plat?.realisation != null ? 'perimee' : 'courte';
}

// ——— Lecture ———

/** Quantité arrondie au centième (lecture), sans bruit de virgule flottante. */
const arrondi = (valeur) => Math.round(valeur * 100) / 100;
const majuscule = (valeur) => (valeur ? `${valeur.charAt(0).toLocaleUpperCase('fr-FR')}${valeur.slice(1)}` : valeur);

/** « Crème fraîche épaisse · 20 cl » ; « Sel fin » sans mesure. */
function texteMesure(produit, qte, unite) {
  const mesure = qte != null ? quantiteLisible(qte, unite ?? 'pc') : '';
  return mesure ? `${majuscule(produit)} · ${mesure}` : majuscule(produit);
}

/**
 * Étapes à lire sur la fiche (et plus tard dans « Cuisiner pas à pas »).
 * - Réalisation à jour : ses étapes normalisées, défauts appliqués : `actif` (la durée), `apres` (l'étape précédente,
 *   rien pour la première), `veille` (aussi toute attente de plus de VEILLE_ATTENTE_MIN minutes) ; quantités de
 *   chaque ingrédient cité, prises dans la fiche (produit en double : quantités additionnées s'ils ont la même unité ;
 *   × `part`), et des mesures « Et aussi » (sauf `fixe`), mises à l'échelle de `portions` (par défaut `portionsBase`).
 * - Sinon (repli) : une étape par phrase de `etapes` (sans durée), puis une par entrée de `cuisson[]` (« Four ·
 *   200 °C · 20 min », durée de la cuisson, 2 min de travail, `estime: true`).
 * → { etapes: EtapeLue[], detaillee, perimee, facteur }
 *   EtapeLue = { n, titre, texte, duree|null, actif|null, appareil|null, mode|null, tempC|null, feu|null,
 *     ustensiles[], ingredients: [{ produit, part, qte|null, unite|null, texte }], aussi: [{ produit, qte|null,
 *     unite|null, fixe, texte }], pret|null, apres[], auService, veille, partAvant, estime }
 */
export function etapesLisibles(plat, { portions = null } = {}) {
  const base = Number.isInteger(plat?.portionsBase) && plat.portionsBase > 0 ? plat.portionsBase : null;
  const facteur = base && Number.isFinite(portions) && portions > 0 ? portions / base : 1;
  const detaillee = realisationAJour(plat);
  if (detaillee) {
    const { realisation } = realisationDe(plat);
    const ingredients = (Array.isArray(plat.ingredients) ? plat.ingredients : []).filter(estObjet);
    const quantiteDe = (produit) => {
      const cle = cleProduit(produit);
      const memes = ingredients.filter((i) => cleProduit(i.produit) === cle && typeof i.qte === 'number');
      if (!memes.length) return { qte: null, unite: null };
      const unite = memes[0].unite ?? null;
      const qte = memes.filter((i) => (i.unite ?? null) === unite).reduce((somme, i) => somme + i.qte, 0);
      return { qte, unite };
    };
    const etapes = realisation.map((etape, i) => {
      const n = i + 1;
      const duree = etape.duree;
      const actif = etape.actif ?? duree;
      return {
        n,
        titre: etape.titre,
        texte: etape.texte,
        duree,
        actif,
        appareil: etape.appareil ?? null,
        mode: etape.mode ?? null,
        tempC: etape.tempC ?? null,
        feu: etape.feu ?? null,
        ustensiles: [...(etape.ustensiles ?? [])],
        ingredients: (etape.ingredients ?? []).map((cite) => {
          const produit = typeof cite === 'string' ? cite : cite.produit;
          const part = typeof cite === 'string' ? 1 : cite.part;
          const { qte, unite } = quantiteDe(produit);
          const mesure = qte === null ? null : arrondi(qte * part * facteur);
          return { produit, part, qte: mesure, unite: mesure === null ? null : unite, texte: texteMesure(produit, mesure, unite) };
        }),
        aussi: (etape.aussi ?? []).map((element) => {
          if (typeof element === 'string') return { produit: element, qte: null, unite: null, fixe: false, texte: majuscule(element) };
          const qte = arrondi(element.fixe ? element.qte : element.qte * facteur);
          return { produit: element.produit, qte, unite: element.unite ?? null, fixe: Boolean(element.fixe), texte: texteMesure(element.produit, qte, element.unite) };
        }),
        pret: etape.pret ?? null,
        apres: etape.apres ? [...etape.apres] : (n > 1 ? [n - 1] : []),
        auService: Boolean(etape.auService),
        veille: Boolean(etape.veille) || duree - actif > VEILLE_ATTENTE_MIN,
        partAvant: Boolean(etape.partAvant),
        estime: false,
      };
    });
    return { etapes, detaillee: true, perimee: false, facteur };
  }
  const vide = {
    duree: null, actif: null, appareil: null, mode: null, tempC: null, feu: null, ustensiles: [], ingredients: [], aussi: [],
    pret: null, auService: false, veille: false, partAvant: false,
  };
  const phrases = (Array.isArray(plat?.etapes) ? plat.etapes : []).map((e) => texte(typeof e === 'string' ? e : '')).filter(Boolean);
  const etapes = phrases.map((phrase) => ({ ...vide, titre: phrase, texte: '', estime: false }));
  for (const cuisson of Array.isArray(plat?.cuisson) ? plat.cuisson : []) {
    if (!estObjet(cuisson) || !VOCABULAIRES.appareil.includes(cuisson.appareil)) continue;
    const duree = nombre(cuisson.dureeMin) > 0 ? Math.round(nombre(cuisson.dureeMin)) : null;
    etapes.push({
      ...vide,
      titre: cuissonLisible(cuisson),
      texte: '',
      duree,
      actif: duree === null ? null : Math.min(2, duree),
      appareil: cuisson.appareil,
      mode: texte(cuisson.mode) || null,
      tempC: nombre(cuisson.tempC) > 0 ? nombre(cuisson.tempC) : null,
      estime: true,
    });
  }
  etapes.forEach((etape, i) => {
    etape.n = i + 1;
    etape.apres = i ? [i] : [];
  });
  return { etapes, detaillee: false, perimee: plat?.realisation != null, facteur };
}

/**
 * Minutes de travail de la recette : somme des `actif` d'une réalisation à jour (hors étapes « le jour du repas » et
 * « la veille »), sinon `tempsActifMin`, sinon null.
 */
export function travailRecette(plat) {
  const { etapes, detaillee } = etapesLisibles(plat);
  if (detaillee) return etapes.filter((e) => !e.auService && !e.veille).reduce((somme, e) => somme + e.actif, 0);
  const temps = nombre(plat?.tempsActifMin);
  return Number.isFinite(temps) && temps >= 0 ? temps : null;
}

/** Durée lisible : 45 → « 45 min » ; 65 → « 1 h 05 » ; 120 → « 2 h » ('' pour une valeur illisible). */
export function texteDuree(minutes) {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total < 0) return '';
  if (total < 60) return `${total}\u00A0min`;
  const heures = Math.floor(total / 60);
  const reste = total % 60;
  return reste ? `${heures}\u00A0h\u00A0${String(reste).padStart(2, '0')}` : `${heures}\u00A0h`;
}

// ——— Plats à détailler ———

/** Date du jour 'AAAA-MM-JJ' (locale) d'une Date, ou le texte tel quel. */
function jourDe(valeur) {
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valeur)) return valeur;
  const date = valeur instanceof Date ? valeur : new Date();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/** Vrai si le plat a sa recette et peut recevoir des étapes détaillées : actif, ingrédients, pas ⏳. */
function aDetaillerPossible(plat) {
  return estObjet(plat) && !estDansCorbeille(plat) && statutDe(plat) !== 'attente' && aSaRecette(plat);
}

/**
 * Plats de la demande d'étapes : plats actifs (hors corbeille) qui ont leurs ingrédients, sans réalisation à jour.
 * Ordre : plats des semaines pas encore finies qui ont des plats (la plus proche d'abord, puis par ordre d'ajout) ;
 * puis par type (plat, dessert, accompagnement, préparation, apéro) ; puis par nom. `semaines` : documents
 * `semaines/{id}` lus ({ debut, fin, plats: { [platId]: { ajouteLe, retire? } } }) ; `aujourdhui` : Date ou
 * 'AAAA-MM-JJ'.
 */
export function platsADetailler(plats, { semaines = [], aujourdhui = new Date() } = {}) {
  const retenus = (Array.isArray(plats) ? plats : []).filter((plat) => aDetaillerPossible(plat) && !realisationAJour(plat));
  const jour = jourDe(aujourdhui);
  const rangSemaine = new Map();
  const enCours = (Array.isArray(semaines) ? semaines : [])
    .filter((s) => estObjet(s) && typeof s.fin === 'string' && s.fin >= jour && estObjet(s.plats))
    .map((s) => ({
      debut: typeof s.debut === 'string' ? s.debut : '',
      entrees: Object.entries(s.plats)
        .filter(([, e]) => estObjet(e) && e.retire !== true && typeof e.ajouteLe === 'number')
        .sort((a, b) => a[1].ajouteLe - b[1].ajouteLe),
    }))
    .filter((s) => s.entrees.length)
    .sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));
  let rang = 0;
  for (const semaine of enCours) {
    for (const [id] of semaine.entrees) {
      if (!rangSemaine.has(id)) rangSemaine.set(id, rang);
      rang += 1;
    }
  }
  const rangType = (plat) => {
    const i = ORDRE_TYPES.indexOf(typeDe(plat));
    return i === -1 ? ORDRE_TYPES.length : i;
  };
  const rangDe = (plat) => (rangSemaine.has(plat.id) ? rangSemaine.get(plat.id) : Infinity);
  return [...retenus].sort((a, b) => {
    const ra = rangDe(a);
    const rb = rangDe(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return rangType(a) - rangType(b)
      || comparerNoms(String(a.nom ?? ''), String(b.nom ?? ''))
      || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  });
}

/** Nombre de plats de `aDetailler` qui sont dans une semaine pas encore finie (en tête de la liste). */
export function platsDeLaSemaineADetailler(plats, options = {}) {
  const aDetailler = platsADetailler(plats, options);
  const jour = jourDe(options.aujourdhui ?? new Date());
  const ids = new Set();
  for (const semaine of Array.isArray(options.semaines) ? options.semaines : []) {
    if (!estObjet(semaine) || typeof semaine.fin !== 'string' || semaine.fin < jour || !estObjet(semaine.plats)) continue;
    for (const [id, entree] of Object.entries(semaine.plats)) {
      if (estObjet(entree) && entree.retire !== true && typeof entree.ajouteLe === 'number') ids.add(id);
    }
  }
  return aDetailler.filter((plat) => ids.has(plat.id)).length;
}

// ——— Empreinte des étapes ———

/** Texte stable d'une valeur : clés triées à toute profondeur (l'ordre des clés lu dans Firestore peut changer). */
function stable(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map(stable).join(',')}]`;
  if (estObjet(valeur)) return `{${Object.keys(valeur).sort().map((cle) => `${JSON.stringify(cle)}:${stable(valeur[cle])}`).join(',')}}`;
  return JSON.stringify(valeur ?? null);
}

/**
 * Empreinte des étapes d'un plat (DEMANDE-ETAPES, que Claude recopie) : 6 caractères [0-9a-z], sur `portionsBase`, les
 * produits dans l'ordre avec leurs repères, les étapes (réalisation à jour, sinon `etapes`) et la cuisson (avec le
 * mode). Elle change avec les portions, un produit, un repère, une étape ou une cuisson ; jamais avec une quantité ni
 * le nom.
 */
export function empreinteEtapes(plat) {
  const lignes = [`portions: ${Number.isFinite(plat?.portionsBase) ? plat.portionsBase : ''}`];
  lignes.push(`ingrédients: ${(Array.isArray(plat?.ingredients) ? plat.ingredients : []).filter(estObjet)
    .map((i) => `${texte(i.produit)} [${(Array.isArray(i.marqueurs) ? i.marqueurs : []).filter((m) => typeof m === 'string').join(', ')}]`)
    .join(' ; ')}`);
  lignes.push(realisationAJour(plat)
    ? `réalisation: ${stable(realisationDe(plat).realisation)}`
    : `étapes: ${(Array.isArray(plat?.etapes) ? plat.etapes : []).map((e) => texte(typeof e === 'string' ? e : '')).filter(Boolean).join(' / ')}`);
  lignes.push(`cuisson: ${cuissonEnTexte(plat?.cuisson)}`);
  return empreinteDeTexte(lignes.join('\n'));
}

// ——— Parts à mettre de côté ———

/**
 * Parts des versions de la fiche, anonymes, pour la demande d'étapes : une ligne par version distincte, « sans
 * jambon blanc (avec thon au naturel) », « sans lardon fumé » ; ni `pour`, ni style, ni identifiant de profil.
 */
export function partsAMettreDeCote(plat) {
  const parts = [];
  for (const variante of Array.isArray(plat?.variantes) ? plat.variantes : []) {
    if (!estObjet(variante)) continue;
    const retires = (Array.isArray(variante.retirer) ? variante.retirer : []).map((p) => texte(typeof p === 'string' ? p : '')).filter(Boolean);
    const ajoutes = (Array.isArray(variante.ajouter) ? variante.ajouter : []).filter(estObjet).map((a) => texte(a.produit)).filter(Boolean);
    let ligne = '';
    if (retires.length) ligne = `sans ${retires.join(', ')}${ajoutes.length ? ` (avec ${ajoutes.join(', ')})` : ''}`;
    else if (ajoutes.length) ligne = `avec ${ajoutes.join(', ')}`;
    if (ligne && !parts.includes(ligne)) parts.push(ligne);
  }
  return parts;
}

// ——— Édition réduite (« Modifier », T5-0b) ———
// Les étapes sont désignées par leur numéro `n`, à partir de 1 (comme `apres` et EtapeLue.n). Chaque fonction rend
// une nouvelle liste ; la liste reçue n'est jamais modifiée.

const copie = (realisation) => (Array.isArray(realisation) ? realisation : []).map((etape) => (estObjet(etape) ? structuredClone(etape) : etape));

/** `apres` effectif d'une étape : écrit, sinon l'étape précédente (rien pour la première). */
const apresDe = (etape, n) => (Array.isArray(etape?.apres) ? etape.apres : (n > 1 ? [n - 1] : []));

/**
 * Étape `n` changée : titre, texte, durée, travail (seuls les champs donnés) ; le travail est ramené à la durée au
 * plus. Numéro hors bornes : simple copie.
 */
export function changerEtape(realisation, n, { titre, texte: corps, duree, actif } = {}) {
  const liste = copie(realisation);
  const etape = liste[n - 1];
  if (!estObjet(etape)) return liste;
  if (titre !== undefined) etape.titre = texte(titre);
  if (corps !== undefined) etape.texte = texte(corps);
  if (duree !== undefined) etape.duree = duree;
  if (actif !== undefined) {
    if (actif === null) delete etape.actif;
    else etape.actif = actif;
  }
  if (Number.isFinite(etape.actif) && Number.isFinite(etape.duree) && etape.actif > etape.duree) etape.actif = etape.duree;
  return liste;
}

/**
 * Étape `n` retirée : les étapes qui l'attendaient attendent ce qu'elle attendait ; les numéros suivants baissent
 * d'un ; une étape qui suivait la précédente sans `apres` écrit le garde absent tant que c'est encore vrai. La marque
 * `partAvant` d'une étape retirée passe à l'étape qui prend sa place (les parts se mettent toujours de côté avant).
 */
export function retirerEtapeRealisation(realisation, n) {
  const liste = copie(realisation);
  if (!(Number.isInteger(n) && n >= 1 && n <= liste.length)) return liste;
  const retiree = liste[n - 1];
  const heritage = apresDe(retiree, n);
  const resultat = [];
  liste.forEach((etape, i) => {
    const k = i + 1;
    if (k === n || !estObjet(etape)) {
      if (k !== n) resultat.push(etape);
      return;
    }
    const effectif = apresDe(etape, k);
    const nouveau = [...new Set(effectif.flatMap((v) => (v === n ? heritage : [v])).map((v) => (v > n ? v - 1 : v)))].sort((a, b) => a - b);
    const nouveauNumero = k > n ? k - 1 : k;
    const implicite = nouveauNumero > 1 ? [nouveauNumero - 1] : [];
    const avaitApres = Array.isArray(etape.apres);
    if (!avaitApres && memesListes(nouveau, implicite)) delete etape.apres;
    else etape.apres = nouveau;
    resultat.push(etape);
  });
  if (estObjet(retiree) && retiree.partAvant && estObjet(resultat[n - 1]) && !resultat.some((e) => e?.partAvant)) {
    resultat[n - 1].partAvant = true;
  }
  return resultat;
}

/** Étape ajoutée à la fin (elle suit la précédente) ; durée DUREE_PAR_DEFAUT minutes si elle n'est pas donnée. */
export function ajouterEtapeALaFin(realisation, { titre = '', texte: corps = '', duree = DUREE_PAR_DEFAUT } = {}) {
  const liste = copie(realisation);
  liste.push({ titre: texte(titre), texte: texte(corps), duree });
  return liste;
}

/**
 * « Cuit surtout au » changé dans « Modifier » : la plus longue étape de l'ancien appareil (hors « le jour du repas » ;
 * la première en cas d'égalité) prend le nouvel appareil, sa température (four, airfryer ; retirée sinon) et la durée
 * choisie ; son feu ne reste que sur la plaque, son programme que sur le même appareil. Rien ne change sans étape de
 * l'ancien appareil ni sans nouvel appareil.
 * → { realisation, suivie: numéro de l'étape changée, ou null }
 */
export function suivreCuissonPrincipale(realisation, { ancien, nouveau, tempC = null, dureeMin = null } = {}) {
  const liste = copie(realisation);
  if (!ancien || !nouveau || !VOCABULAIRES.appareil.includes(nouveau)) return { realisation: liste, suivie: null };
  let index = -1;
  liste.forEach((etape, i) => {
    if (!estObjet(etape) || etape.auService || etape.appareil !== ancien) return;
    if (index === -1 || (etape.duree ?? 0) > (liste[index].duree ?? 0)) index = i;
  });
  if (index === -1) return { realisation: liste, suivie: null };
  const etape = liste[index];
  if (etape.appareil !== nouveau) delete etape.mode;
  etape.appareil = nouveau;
  if (nouveau !== 'plaque') delete etape.feu;
  if (APPAREILS_A_TEMPERATURE.includes(nouveau) && Number.isFinite(tempC) && tempC > 0) etape.tempC = tempC;
  else if (!APPAREILS_A_TEMPERATURE.includes(nouveau)) delete etape.tempC;
  if (Number.isInteger(dureeMin) && dureeMin >= 1 && dureeMin <= DUREE_MAX_MIN) {
    etape.duree = dureeMin;
    if (Number.isFinite(etape.actif) && etape.actif > dureeMin) etape.actif = dureeMin;
  }
  return { realisation: liste, suivie: index + 1 };
}

// ——— Textes des écrans ———

const LIBELLES_FEU = { doux: 'feu doux', moyen: 'feu moyen', vif: 'feu vif' };

/** « ⏱ 10 min · dont 1 min de travail » ; « ⏱ 5 min » quand toute l'étape est du travail ; '' sans durée. */
export function ligneDuree(etape) {
  if (!Number.isFinite(etape?.duree)) return '';
  const actif = Number.isFinite(etape.actif) ? etape.actif : etape.duree;
  return actif < etape.duree
    ? `⏱ ${texteDuree(etape.duree)} · dont ${texteDuree(actif)} de travail`
    : `⏱ ${texteDuree(etape.duree)}`;
}

/** « Plaque · feu vif », « Four · 180 °C », « Cookeo · sous pression » ; '' sans appareil. */
export function ligneAppareil(etape) {
  if (!etape?.appareil) return '';
  const morceaux = [APPAREILS[etape.appareil] ?? etape.appareil];
  if (etape.feu && LIBELLES_FEU[etape.feu]) morceaux.push(LIBELLES_FEU[etape.feu]);
  if (Number.isFinite(etape.tempC)) morceaux.push(`${etape.tempC}\u00A0°C`);
  if (etape.mode) morceaux.push(etape.mode);
  return morceaux.join(' · ');
}

/** Textes fixes des écrans des étapes détaillées (plan §8.2 à §8.4, §8.9). */
export const TEXTES_ETAPES = {
  // Fiche (lecture).
  etAussi: 'Et aussi',
  pretQuand: (pret) => `✓ Prêt quand\u00A0: ${pret}`,
  jourDuRepas: 'Le jour du repas',
  ficheCourte: 'Ces étapes sont courtes. Claude peut les détailler pour cuisiner avec le téléphone.',
  demanderSesEtapes: '📋 Demander ses étapes détaillées',
  collerLaReponse: 'Coller la réponse de Claude',
  perimee: 'Les étapes ont été changées sur un autre appareil\u00A0: demandez de nouveau leur détail à Claude.',
  // Réglages, carte « 👩‍🍳 Étapes détaillées ».
  titreCarte: '👩‍🍳 Étapes détaillées',
  instructionsDAbord: 'Copiez d’abord les nouvelles instructions ci-dessus.',
  horsLigne: 'Il faut du réseau pour enregistrer des étapes.',
  annonceCopie: `Demande copiée. Collez-la dans une nouvelle conversation de votre projet Claude. Il répondra ${ETAPES_PAR_MESSAGE}\u00A0recettes à la fois\u00A0: collez chaque réponse ici, puis écrivez «\u00A0suite\u00A0».`,
  // Aperçu d'un lot d'étapes (« Ajouter des recettes »).
  voirLesEtapes: 'Voir les étapes',
  rienAEnregistrer: 'Rien à enregistrer',
  enregistrement: 'Enregistrement…',
  refusEnvoi: (nom) => `${guillemets(nom)} a changé entre-temps\u00A0: ses étapes n’ont pas été écrites. Il restera à détailler.`,
  // « Modifier la recette », éditeur réduit.
  ceQuOnFait: 'Ce qu’on fait',
  comment: 'Comment',
  plusDePrecisions: 'Plus de précisions',
  dureeEtape: 'Durée de l’étape (min)',
  dontTravail: 'Dont travail (min)',
  aideTravail: 'Le reste du temps, on peut faire autre chose\u00A0: l’app s’en sert pour le batch.',
  retirer: 'Retirer',
  ajouterUneEtape: '＋ Ajouter une étape',
  titreManquant: 'Écrivez ce qu’on fait à cette étape.',
  titreTropLong: `Le titre d’une étape fait ${TITRE_MAX}\u00A0caractères au plus.`,
  texteManquant: 'Écrivez comment faire cette étape.',
  texteTropLong: 'Le texte d’une étape fait 1\u00A0000\u00A0caractères au plus.',
  dureeInvalide: 'Indiquez la durée de l’étape, en minutes.',
  ordre: 'Pour changer l’ordre des étapes, demandez de nouveau leur détail à Claude.',
  relireEtape: (titre) => `Relisez l’étape ${guillemets(titre)}\u00A0: son texte parle peut-être encore de l’ancien appareil.`,
  mesuresPour: (portions) => `Les mesures ${guillemets('Et aussi')} des étapes (sel, eau) étaient pour ${compte(portions, 'portion', 'portions')}.`,
  plusDansLaRecette: (produit, n) => `${guillemets(produit)} n’est plus dans la recette\u00A0: sa quantité ne s’affichera plus à l’étape ${n}.`,
};

/** Nombre écrit en lettres jusqu'à dix (« les deux premières réponses »), en chiffres au-delà. */
const EN_LETTRES = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];

/**
 * Carte « 👩‍🍳 Étapes détaillées » de Réglages (gestionnaire hors aperçu ; plan §8.2). `plats`, `semaines`,
 * `aujourdhui` : comme platsADetailler ; `instructionsAJour` : les instructions en version actuelle ont été copiées ;
 * `enLigne`.
 * → { visible (faux : plus rien à détailler), restants, detaillees, total, phrases: [texte], copieActive, bouton,
 *     annonce, phraseSemaine (null sans plat de la semaine à détailler), coller, horsLigne (null en ligne) }
 */
export function carteEtapesDetaillees({ plats = [], semaines = [], aujourdhui = new Date(), instructionsAJour = true, enLigne = true } = {}) {
  const aDetailler = platsADetailler(plats, { semaines, aujourdhui });
  const remplis = (Array.isArray(plats) ? plats : []).filter(aDetaillerPossible);
  const detaillees = remplis.filter((plat) => realisationAJour(plat)).length;
  const restants = aDetailler.length;
  const deLaSemaine = platsDeLaSemaineADetailler(plats, { semaines, aujourdhui });
  let phraseSemaine = null;
  if (deLaSemaine) {
    const reponses = Math.ceil(deLaSemaine / ETAPES_PAR_MESSAGE);
    phraseSemaine = reponses === 1
      ? 'Les plats de la semaine passent en premier\u00A0: la première réponse suffit pour cette semaine.'
      : `Les plats de la semaine passent en premier\u00A0: les ${EN_LETTRES[reponses] ?? reponses} premières réponses suffisent pour cette semaine.`;
  }
  const phrases = [
    `${restants > 1 ? `${restants}\u00A0recettes ont` : `${restants}\u00A0recette a`} des étapes courtes. Claude peut ${restants > 1 ? 'les' : 'la'} détailler pour cuisiner avec le téléphone et organiser le batch.`,
    `${detaillees}\u00A0sur ${remplis.length} ${detaillees > 1 ? 'sont déjà détaillées' : 'est déjà détaillée'}.`,
  ];
  if (!instructionsAJour) phrases.push(TEXTES_ETAPES.instructionsDAbord);
  return {
    visible: restants > 0,
    restants,
    detaillees,
    total: remplis.length,
    phrases,
    copieActive: instructionsAJour,
    bouton: restants === 1 ? '📋 Demander à Claude la dernière recette' : `📋 Demander à Claude les ${restants}\u00A0recettes`,
    annonce: TEXTES_ETAPES.annonceCopie,
    phraseSemaine,
    coller: TEXTES_ETAPES.collerLaReponse,
    horsLigne: enLigne ? null : TEXTES_ETAPES.horsLigne,
  };
}

/** « 9 octobre » d'un horodatage Firestore ({ seconds }), d'une Date ou d'un nombre de secondes ; '' sinon. */
function jourEnMots(valeur) {
  let date = null;
  if (valeur instanceof Date) date = valeur;
  else if (typeof valeur === 'number' && Number.isFinite(valeur)) date = new Date(valeur * 1000);
  else if (estObjet(valeur) && typeof valeur.seconds === 'number') date = new Date(valeur.seconds * 1000);
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(date);
}

/**
 * Phrases de l'aperçu d'un lot d'étapes (« Ajouter des recettes », plan §8.3).
 * → { entete (« 3 recettes reçoivent leurs étapes détaillées. Le reste des recettes ne change pas. », null sans
 *     rien à écrire), bouton (« Enregistrer les étapes de 3 recettes » ou « Rien à enregistrer »), actif }
 */
export function enteteApercuEtapes(preparation) {
  const n = (Array.isArray(preparation?.ecritures) ? preparation.ecritures : []).filter((e) => e?.mode === 'etapes').length;
  return {
    entete: n ? `${n > 1 ? `${n}\u00A0recettes reçoivent` : '1\u00A0recette reçoit'} ${n > 1 ? 'leurs' : 'ses'} étapes détaillées. Le reste des recettes ne change pas.` : null,
    bouton: n ? `Enregistrer les étapes de ${compte(n, 'recette', 'recettes')}` : TEXTES_ETAPES.rienAEnregistrer,
    actif: n > 0 && !preparation?.refus,
  };
}

/**
 * Phrases d'un élément de l'aperçu d'un lot d'étapes (paquet.js › preparerImport, branche étapes) :
 * → { titre (« « Gratin de pâtes au jambon » : 9 étapes, dont 21 min de travail. », null pour une entrée pas
 *     reprise), etat: [texte], avertissements: [texte] }
 */
export function lignesApercuEtapes(element) {
  const nom = texte(element?.nom) || String(element?.id ?? '');
  const etat = [];
  let titre = null;
  switch (element?.statut) {
    case 'etapes': {
      const travail = Number.isFinite(element.travail) ? `, dont ${texteDuree(element.travail)} de travail` : '';
      titre = `${guillemets(nom)}\u00A0: ${compte(Number.isInteger(element.etapes) ? element.etapes : 0, 'étape', 'étapes')}${travail}.`;
      if (element.modifieeA) {
        const jour = jourEnMots(element.modifieeA);
        etat.push(`Cette recette a été modifiée à la main${jour ? ` le ${jour}` : ''}\u00A0: ses étapes seront remplacées, le reste ne change pas.`);
      } else if (element.remplace) {
        etat.push('Remplace les étapes détaillées actuelles.');
      }
      if (element.reperesARevoir) etat.push(`🧸 Claude signale que ces étapes changent un repère de ${guillemets(nom)}\u00A0: la recette sera à relire.`);
      break;
    }
    case 'identique': etat.push(`${guillemets(nom)} a déjà ces étapes\u00A0: rien à enregistrer.`); break;
    case 'dejaDetaille': etat.push(`${guillemets(nom)} est déjà détaillé\u00A0: rien à enregistrer.`); break;
    case 'change': etat.push(`${guillemets(nom)} a changé depuis la demande\u00A0: ses étapes ne sont pas reprises. Il restera à détailler.`); break;
    case 'refusee': etat.push(element.raison || `${guillemets(nom)} n’est pas repris. Il restera à détailler.`); break;
    case 'inconnu': etat.push(`${guillemets(nom)} n’est pas dans vos plats\u00A0: ses étapes ne sont pas reprises.`); break;
    case 'attente': etat.push(`${guillemets(nom)} n’a pas encore sa recette\u00A0: ses étapes ne sont pas reprises.`); break;
    case 'corbeille': etat.push(`${guillemets(nom)} est dans la corbeille\u00A0: ses étapes ne sont pas reprises.`); break;
    default: break;
  }
  return { titre, etat, avertissements: Array.isArray(element?.avertissements) ? element.avertissements : [] };
}

