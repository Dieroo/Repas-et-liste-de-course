// « Cuisiner pas à pas » (T5-1, plan §8.5, route `#/cuisiner/<id>`, les deux membres, sans onglets du bas ni en-tête de
// l'app) : « Avant de commencer » (durée, quantités pour la semaine ou la recette, hygiène, 🧸, parts à mettre de côté,
// la veille, « Sortir tout ce qu’il faut » avec ses cases), puis une étape par écran dans l'ordre calculé
// (coeur/cuisine.js › pasAPas, ordonnanceur de coeur/deroule.js), puis « C’est prêt 🎉 » (frigo, date limite,
// congélation, « Pour bien conserver », « Le jour du repas »).
// - Aucune écriture Firestore, aucun minuteur (D5 : le minuteur du four ou l'horloge du téléphone) ; l'étape, les
//   portions et les cases se gardent 12 h sur le téléphone (`localStorage`, par compte et par plat), la taille du texte
//   aussi ; tout marche hors ligne (rien ne part).
// - Lisible à un mètre : texte de 1,5 rem (« A+ » : 1,8 rem), barre du bas fixe de 72 px, « ‹ » étroit et l'action
//   principale sur les deux tiers, toujours au même endroit ; un second toucher dans les 600 ms est ignoré ; focus sur
//   le titre après chaque changement, « Étape 3 sur 9 » annoncé ; l'écran reste allumé (ui/ecran-allume.js).
// - Plat ⏳, de la corbeille ou introuvable à l'ouverture : retour à sa fiche. Une fois la cuisine commencée, un plat
//   changé ailleurs met l'écran à jour (quantités) ; s'il part (corbeille, supprimé), l'écran garde ce qu'il montrait.
import { el, vibrer } from './dom.js';
import { creerCarteEtape, avecPictogramme } from './etape.js';
import { garderAllume } from './ecran-allume.js';
import {
  AU_FRIGO_AVANT_MIN, TEXTES_CUISINE, cleReprise, cleTexteCuisine, elementPourCuisiner, lireReprise, pasAPas,
  texteFrigoAvant, valeurReprise,
} from '../coeur/cuisine.js';

// Un second toucher sur la barre, dans ce délai, est ignoré (plan §8.5).
const GARDE_TOUCHER_MS = 600;
// L'écran est rendu après ce temps sans toucher (plan §8.5).
const ALLUME_MINUTES = 30;

let compteur = 0;

/** Libellé dont la flèche finale (« › ») est montrée sans être lue. */
function libelleFleche(texte) {
  const valeur = String(texte ?? '');
  const trouve = valeur.match(/^(.*?)\s*›$/u);
  return trouve ? [trouve[1], el('span', { 'aria-hidden': 'true' }, '\u00A0›')] : [valeur];
}

/** Lecture sûre du stockage du téléphone (absent, plein ou bloqué : null). */
function lire(cle) {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrire(cle, valeur) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    // Stockage plein ou bloqué : la cuisine continue, seule la reprise sera perdue.
  }
}

/** Ligne d'une étape « La veille » ou « Le jour du repas » : titre, quantités, texte, signe. */
function etapeCompacte(etape) {
  return el('li', { class: 'etape-compacte' },
    el('p', { class: 'etape-compacte-titre' }, etape.titre),
    etape.quantites?.length ? el('p', { class: 'etape-compacte-quantites' }, etape.quantites.map((q) => q.texte).join(' · ')) : null,
    etape.texte ? el('p', {}, etape.texte) : null,
    etape.pret ? el('p', { class: 'etape-compacte-pret' }, avecPictogramme(TEXTES_CUISINE.pretQuand(etape.pret))) : null,
    ...(etape.conseils ?? []).map((c) => el('p', { class: 'etape-compacte-conseil' }, c)));
}

/**
 * Écran « Cuisiner pas à pas ». `ctx` : contexte de l'app (`parametre` : le plat ; `tousLesPlats`, `semaines`,
 * `semainesChargees`, `profils`, `moi`, `role`, `reglages`, `compat`, `aujourdhui`, `utilisateur`, `routePrecedente`).
 * → { noeud, maj(ctx), detruire() }
 */
export function creer(ctx) {
  compteur += 1;
  const base = `cuisiner-${compteur}`;
  const platId = ctx.parametre;
  let courant = ctx;
  const uid = ctx.utilisateur?.uid ?? '';
  const cleEtat = uid ? cleReprise(uid, platId) : null;
  const cleTaille = uid ? cleTexteCuisine(uid) : null;

  // État de l'écran, sur ce téléphone seulement.
  let page = 'chargement'; // 'chargement' | 'reprise' | 'avant' | 'etape' | 'fin' | 'sansEtapes'
  let cleEtape = null; // étape montrée (page 'etape')
  let titreEtape = null; // son titre : une clé (numéro) peut désigner une autre étape si l'autre téléphone en retire une
  let rangEtape = 1; // son rang, pour la retrouver si la recette change
  let etapeMontree = null; // dernière étape montrée, gardée si elle a disparu de la recette
  let portions = 'semaine';
  let cases = new Set();
  let reprise = null; // reprise lue à l'ouverture, en attente de « Reprendre »
  let finLe = null; // heure de « C’est prêt › » (Date), pour « Au frigo avant … » et le jour de cuisson
  let finReprise = false; // page de fin rouverte plus tard (reprise) : « Recommencer » y est proposé
  let modele = null; // dernier modèle « ok » montré
  let parti = false;
  let dernierGeste = -Infinity;
  let grand = lire(cleTaille ?? '') === 'grand';
  const memo = { cles: null, resultat: null };

  // ——— En-tête : « ✕ Quitter », où l'on en est, « A+ » ———
  const boutonQuitter = el('button', { class: 'bouton-cuisine-quitter', type: 'button', onclick: quitter },
    el('span', { 'aria-hidden': 'true' }, '✕\u00A0'), TEXTES_CUISINE.quitter.replace(/^✕\s*/u, ''));
  const ou = el('p', { class: 'cuisiner-ou', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const boutonTaille = el('button', {
    class: 'bouton-cuisine-taille', type: 'button', 'aria-label': TEXTES_CUISINE.plusGrandNom,
    'aria-pressed': String(grand), onclick: changerTaille,
  }, TEXTES_CUISINE.plusGrand);
  const entete = el('header', { class: 'cuisiner-entete' }, boutonQuitter, ou, boutonTaille);

  // ——— Pages ———
  const titreChargement = el('h1', { tabindex: '-1' });
  const pageChargement = el('section', { class: 'cuisiner-page' },
    titreChargement, el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…'));

  // « L’écran reste allumé. » seulement s'il l'est (sur « Avant de commencer » et la reprise).
  const ligneAllume = () => el('p', { class: 'cuisiner-allume', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '💡\u00A0'), TEXTES_CUISINE.ecranAllume);
  const ligneAllumeAvant = ligneAllume();
  const ligneAllumeReprise = ligneAllume();

  const titreReprise = el('h1', { tabindex: '-1' });
  const phraseReprise = el('p', { class: 'cuisiner-phrase' });
  const boutonRecommencer = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: recommencer },
    TEXTES_CUISINE.recommencer);
  const pageReprise = el('section', { class: 'cuisiner-page', hidden: true },
    titreReprise, phraseReprise, ligneAllumeReprise, boutonRecommencer);

  const titreAvant = el('h1', { tabindex: '-1' });
  const corpsAvant = el('div', { class: 'cuisiner-avant' });
  const pageAvant = el('section', { class: 'cuisiner-page', hidden: true }, titreAvant, corpsAvant);
  let vueAvant = null;

  const carte = creerCarteEtape({ surCase: toucherCase });
  const pageEtape = el('section', { class: 'cuisiner-page', hidden: true }, carte.noeud);

  const titreFin = el('h1', { tabindex: '-1' }, avecPictogrammeFinal(TEXTES_CUISINE.fin));
  const boutonRecommencerFin = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: recommencer },
    TEXTES_CUISINE.recommencer);
  const corpsFin = el('div', { class: 'cuisiner-fin' });
  const pageFin = el('section', { class: 'cuisiner-page', hidden: true }, titreFin, corpsFin);
  let vueFin = null;

  const titreSansEtapes = el('h1', { tabindex: '-1' });
  const pageSansEtapes = el('section', { class: 'cuisiner-page', hidden: true },
    titreSansEtapes, el('p', { class: 'cuisiner-phrase' }, TEXTES_CUISINE.sansEtapes));

  const pages = {
    chargement: { section: pageChargement, titre: titreChargement },
    reprise: { section: pageReprise, titre: titreReprise },
    avant: { section: pageAvant, titre: titreAvant },
    etape: { section: pageEtape, titre: carte.titre },
    fin: { section: pageFin, titre: titreFin },
    sansEtapes: { section: pageSansEtapes, titre: titreSansEtapes },
  };

  // ——— Barre du bas : « ‹ » étroit, l'action principale sur les deux tiers ———
  // (noeud est créé plus bas ; majSuite ne s'en sert qu'une fois l'écran posé.)
  const boutonPrecedent = el('button', {
    class: 'bouton bouton-secondaire bouton-cuisine-precedent', type: 'button', 'aria-label': TEXTES_CUISINE.precedenteNom,
    onclick: () => garde() && precedent(),
  }, el('span', { 'aria-hidden': 'true' }, TEXTES_CUISINE.precedente));
  const boutonSuivant = el('button', {
    class: 'bouton bouton-principal bouton-cuisine-suivant', type: 'button', onclick: () => garde() && suivant(),
  });
  // « ↓ La suite plus bas » au-dessus de la barre : sur une étape, tant que son signe « Prêt quand » (sinon son texte)
  // est caché sous la barre ; ailleurs, tant que la page dépasse l'écran (montré, pas lu : le lecteur d'écran lit
  // toute la page).
  const suite = el('p', { class: 'cuisiner-suite', 'aria-hidden': 'true', hidden: true }, TEXTES_CUISINE.suite);
  const barre = el('div', { class: 'barre-cuisiner' }, suite,
    el('div', { class: 'barre-cuisiner-contenu' }, boutonPrecedent, boutonSuivant));
  let attenteSuite = 0;
  function majSuite() {
    attenteSuite = 0;
    if (!noeud.isConnected) return;
    let montre = false;
    if (page === 'etape') {
      const signe = carte.noeud.querySelector('.etape-cuisine-pret:not([hidden])') ?? carte.noeud.querySelector('.etape-cuisine-texte');
      montre = Boolean(signe) && signe.getBoundingClientRect().bottom > barre.getBoundingClientRect().top + 1;
    } else if (page !== 'chargement') {
      montre = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) > 8;
    }
    if (suite.hidden === montre) suite.hidden = !montre;
  }
  const surDefilement = () => {
    if (!attenteSuite) attenteSuite = requestAnimationFrame(majSuite);
  };
  window.addEventListener('scroll', surDefilement, { passive: true });
  window.addEventListener('resize', surDefilement, { passive: true });

  const noeud = el('div', { class: 'vue cuisiner' }, entete,
    pageChargement, pageReprise, pageAvant, pageEtape, pageFin, pageSansEtapes, barre);
  noeud.classList.toggle('texte-grand', grand);

  const allume = garderAllume({
    minutes: ALLUME_MINUTES,
    surChange: (obtenu) => {
      ligneAllumeAvant.hidden = !obtenu;
      ligneAllumeReprise.hidden = !obtenu;
    },
  });

  // ——— Modèle ———

  function platCourant() {
    return (courant.tousLesPlats ?? courant.plats ?? []).find((p) => p?.id === platId) ?? null;
  }

  /** Modèle de coeur/cuisine.js › pasAPas pour l'état du moment (gardé tant que rien ne change) ; null au chargement. */
  function calculer(choix = portions) {
    if (!courant.semainesChargees) return null;
    const plat = platCourant();
    // Jour de cuisson : celui de « C’est prêt › » une fois la cuisine finie (fin rouverte le lendemain : même date
    // limite), sinon aujourd'hui.
    const jour = finLe ?? courant.aujourdhui;
    const cles = [plat, courant.semaines, courant.profils, courant.moi, courant.role, choix, courant.reglages, jour];
    if (memo.cles && cles.every((c, i) => c === memo.cles[i])) return memo.resultat;
    const options = {
      tousLesPlats: courant.tousLesPlats ?? [], profils: courant.profils ?? [], semaines: courant.semaines ?? [],
      aujourdhui: courant.aujourdhui, reglages: courant.reglages ?? null,
      ...(typeof courant.compat === 'function' ? { evaluer: courant.compat } : {}),
    };
    const element = plat ? elementPourCuisiner(platId, options) : null;
    const resultat = pasAPas(plat, {
      element, profils: courant.profils ?? [], moi: courant.moi ?? null, role: courant.role ?? null, portions: choix,
      reglages: courant.reglages ?? null, aujourdhui: jour,
      ...(typeof courant.compat === 'function' ? { evaluer: courant.compat } : {}),
    });
    memo.cles = cles;
    memo.resultat = resultat;
    return resultat;
  }

  const clesDesEtapes = (m) => (m?.etapes ?? []).map((e) => e.cle);

  /** Première ouverture du plat prêt : reprise, page de départ, ou retour à la fiche. */
  function demarrer(lu) {
    if (lu.etat === 'sansEtapes') {
      modele = lu;
      montrer('sansEtapes');
      return;
    }
    if (lu.etat !== 'ok') {
      // Plat ⏳, de la corbeille ou introuvable : sa fiche dit pourquoi.
      parti = true;
      location.replace(`#/plat/${encodeURIComponent(platId)}`);
      return;
    }
    const sauvee = cleEtat ? lireReprise(lire(cleEtat), { cles: clesDesEtapes(lu), etapes: lu.etapes }) : null;
    if (sauvee) {
      portions = sauvee.portions;
      cases = new Set(sauvee.cases);
    }
    if (sauvee?.etape === 'fin') finLe = new Date(sauvee.le);
    modele = calculer(portions);
    if (sauvee?.etape === 'fin') {
      // Cuisine finie, rouverte (retour Android, ou pour recopier la date limite) : la fin du jour de cuisson, avec
      // « Recommencer ».
      finReprise = true;
      montrer('fin');
    } else if (sauvee && sauvee.etape !== 'avant' && modele.etapes.some((e) => e.cle === sauvee.etape)) {
      reprise = sauvee;
      montrer('reprise');
    } else {
      montrer('avant');
    }
  }

  // ——— Gestes ———

  /** Vrai si le toucher compte (pas un second toucher dans les 600 ms). */
  function garde() {
    const maintenant = performance.now();
    if (maintenant - dernierGeste < GARDE_TOUCHER_MS) return false;
    dernierGeste = maintenant;
    allume.toucher();
    return true;
  }

  function sauver(etape) {
    if (!cleEtat) return;
    // La reprise de la fin garde l'heure de « C’est prêt › » (le jour de cuisson), pas celle d'une case touchée après.
    const maintenant = etape === 'fin' && finLe ? finLe.getTime() : Date.now();
    ecrire(cleEtat, JSON.stringify(valeurReprise({ etape, titre: etape === cleEtape ? titreEtape : null, portions, cases: [...cases], maintenant })));
  }

  /**
   * Étape montrée : par sa clé et son titre ; sinon par son titre (l'autre téléphone a retiré une étape avant elle) ;
   * sinon la dernière montrée, telle quelle (jamais une autre étape en silence).
   */
  function etapeVue() {
    const etapes = modele?.etapes ?? [];
    const memeTitre = (e) => titreEtape === null || e.titre === titreEtape;
    return etapes.find((e) => e.cle === cleEtape && memeTitre(e))
      ?? (titreEtape !== null ? etapes.find((e) => e.titre === titreEtape) : null)
      ?? etapeMontree
      ?? etapes[Math.min(Math.max(rangEtape, 1), etapes.length) - 1] ?? null;
  }

  /** Index de l'étape montrée dans le déroulé ; une étape disparue garde sa place (son rang). */
  function indexDe(actuelle) {
    const etapes = modele?.etapes ?? [];
    const index = actuelle ? etapes.indexOf(actuelle) : -1;
    return index !== -1 ? { index, disparue: false } : { index: Math.max(0, rangEtape - 1), disparue: true };
  }

  function allerALEtape(etape) {
    cleEtape = etape.cle;
    titreEtape = etape.titre ?? null;
    rangEtape = etape.rang;
    etapeMontree = etape;
    sauver(etape.cle);
    montrer('etape');
  }

  function suivant() {
    if (parti) return;
    if (page === 'reprise') {
      reprendre();
      return;
    }
    if (page === 'avant') {
      const premiere = modele?.etapes?.[0];
      if (premiere) allerALEtape(premiere);
      return;
    }
    if (page === 'etape') {
      const { index, disparue } = indexDe(etapeVue());
      // Étape disparue : celle qui a pris sa place vient ensuite.
      const suivante = modele.etapes[disparue ? index : index + 1];
      if (suivante) {
        allerALEtape(suivante);
      } else {
        finLe = new Date();
        sauver('fin');
        montrer('fin');
      }
      return;
    }
    if (page === 'fin' || page === 'sansEtapes') revenirALaRecette({ fini: page === 'fin' });
  }

  function precedent() {
    if (parti) return;
    if (page === 'fin') {
      const derniere = modele?.etapes?.[modele.etapes.length - 1];
      if (derniere) allerALEtape(derniere);
      return;
    }
    if (page !== 'etape') return;
    const { index } = indexDe(etapeVue());
    if (index > 0) {
      allerALEtape(modele.etapes[index - 1]);
    } else {
      sauver('avant');
      montrer('avant');
    }
  }

  function reprendre() {
    const sauvee = reprise;
    reprise = null;
    const etape = modele?.etapes?.find((e) => e.cle === sauvee?.etape);
    if (etape) allerALEtape(etape);
    else montrer('avant');
  }

  /** « Recommencer » : « Avant de commencer », cases vides, quantités de la semaine. */
  function recommencer() {
    if (!garde()) return;
    reprise = null;
    finLe = null;
    finReprise = false;
    vueFin = null;
    cases = new Set();
    portions = 'semaine';
    modele = calculer(portions);
    vueAvant = null;
    if (cleEtat) ecrire(cleEtat, null);
    montrer('avant');
  }

  function toucherCase(cle, cochee) {
    allume.toucher();
    if (cochee) {
      cases.add(cle);
      vibrer();
    } else {
      cases.delete(cle);
    }
    sauver(page === 'etape' ? cleEtape : page === 'fin' ? 'fin' : 'avant');
  }

  function changerPortions(valeur) {
    allume.toucher();
    if (valeur === portions) return;
    portions = valeur;
    const nouveau = calculer(portions);
    if (nouveau?.etat === 'ok') modele = nouveau;
    sauver('avant');
    dessiner();
  }

  function changerTaille() {
    grand = !grand;
    noeud.classList.toggle('texte-grand', grand);
    boutonTaille.setAttribute('aria-pressed', String(grand));
    if (cleTaille) ecrire(cleTaille, grand ? 'grand' : null);
  }

  /** Retour d'où l'on vient (fiche, Semaine), sinon à la fiche ; l'étape reste gardée sur le téléphone. */
  function quitter() {
    if (parti) return;
    parti = true;
    const venu = courant.routePrecedente;
    if (venu && venu !== 'cuisiner' && history.length > 1) history.back();
    else location.hash = `#/plat/${encodeURIComponent(platId)}`;
  }

  /** « Revenir à la recette » : la fiche du plat ; à la fin, la cuisine est finie (plus rien à reprendre). */
  function revenirALaRecette({ fini = false } = {}) {
    if (parti) return;
    parti = true;
    if (fini && cleEtat) ecrire(cleEtat, null);
    if (courant.routePrecedente === 'plat' && history.length > 1) history.back();
    else location.hash = `#/plat/${encodeURIComponent(platId)}`;
  }

  // ——— Dessin ———

  /** « C’est prêt 🎉 » : l'emoji final est montré sans être lu. */
  function avecPictogrammeFinal(texte) {
    const trouve = String(texte).match(/^(.*?)\s*(\p{Extended_Pictographic}\uFE0F?)$/u);
    return trouve ? [trouve[1], el('span', { 'aria-hidden': 'true' }, `\u00A0${trouve[2]}`)] : [String(texte)];
  }

  function dessinerAvant() {
    const m = modele;
    const signature = JSON.stringify([m.nom, m.duree, m.portions, m.avant]);
    if (signature === vueAvant) {
      // Mêmes contenus : seules les cases suivent (touchées ici ou remises par « Recommencer »).
      for (const input of corpsAvant.querySelectorAll('input[type="checkbox"][data-cle]')) {
        input.checked = cases.has(input.dataset.cle);
      }
      return;
    }
    vueAvant = signature;
    const focus = corpsAvant.contains(document.activeElement) ? document.activeElement.dataset?.cle ?? null : null;
    titreAvant.textContent = m.nom;
    const { avant } = m;
    const caseDe = ({ cle, texte }) => {
      const input = el('input', { type: 'checkbox', 'data-cle': cle });
      input.checked = cases.has(cle);
      input.addEventListener('change', () => toucherCase(cle, input.checked));
      return el('li', {}, el('label', { class: 'case-cuisine' }, input, el('span', {}, texte)));
    };
    const bascule = m.portions.bascule
      ? el('fieldset', { class: 'groupe-choix cuisiner-portions' },
        el('legend', { class: 'etiquette-champ' }, m.portions.legende),
        el('div', { class: 'choix-ligne' }, m.portions.options.map(({ valeur, libelle }) => {
          const input = el('input', { type: 'radio', name: `${base}-portions`, value: valeur, 'data-cle': `portions:${valeur}` });
          input.checked = m.portions.choisies === valeur;
          input.addEventListener('change', () => {
            if (input.checked) changerPortions(valeur);
          });
          return el('label', { class: 'choix' }, input, el('span', {}, libelle));
        })))
      : null;
    corpsAvant.replaceChildren(...[
      m.duree.texte ? el('p', { class: 'cuisiner-duree' }, el('span', { 'aria-hidden': 'true' }, '⏱\u00A0'), m.duree.texte) : null,
      ligneAllumeAvant,
      // Recette pas détaillée : les cuissons de la fiche, en puces (elles ne sont pas des étapes).
      avant.cuissons?.length
        ? el('div', { class: 'cuisiner-cuissons' }, el('p', {}, TEXTES_CUISINE.cuissons),
          el('p', { class: 'etape-cuisine-puces' }, avant.cuissons.map((c) => el('span', { class: 'puce-cuisine' }, c))))
        : null,
      bascule,
      el('div', { class: 'cuisiner-conseils' }, avant.hygiene.map((t) => el('p', {}, avecPictogramme(t)))),
      avant.enfant.length
        ? el('div', { class: 'cuisiner-rappels-avant' }, avant.enfant.map((ligne) => el('p', {}, avecPictogramme(ligne.texte))))
        : null,
      avant.parts.length
        ? el('div', { class: 'cuisiner-rappels-avant' }, avant.parts.map((t) => el('p', {}, avecPictogramme(t))))
        : null,
      avant.veille.length
        ? el('section', { class: 'cuisiner-bloc' },
          el('h2', {}, TEXTES_CUISINE.laVeille),
          el('ol', { class: 'liste-compacte' }, avant.veille.map(etapeCompacte)))
        : null,
      el('section', { class: 'cuisiner-bloc' },
        el('h2', {}, TEXTES_CUISINE.sortirToutCeQuIlFaut),
        avant.reunir.ingredients.length ? el('ul', { class: 'liste-cases' }, avant.reunir.ingredients.map(caseDe)) : null,
        avant.reunir.aussi ? el('p', { class: 'cuisiner-aussi' }, avant.reunir.aussi) : null,
        avant.reunir.ustensiles.length
          ? el('ul', { class: 'liste-cases' }, avant.reunir.ustensiles.map(({ cle, nom }) => caseDe({ cle, texte: nom })))
          : null),
    ].filter(Boolean));
    if (focus) corpsAvant.querySelector(`[data-cle="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }

  function dessinerFin() {
    const m = modele;
    // « Au frigo avant … » seulement tant que l'heure n'est pas passée (fin rouverte plus tard : rien).
    const frigo = finLe && finLe.getTime() + AU_FRIGO_AVANT_MIN * 60_000 > Date.now() ? texteFrigoAvant(finLe) : '';
    const signature = JSON.stringify([m.fin.portions, m.fin.partFragile, m.fin.congeler, m.fin.conseils, frigo, m.service, finReprise]);
    if (signature === vueFin) return;
    vueFin = signature;
    const { fin } = m;
    corpsFin.replaceChildren(...[
      fin.portions ? el('p', { class: 'cuisiner-phrase' }, fin.portions) : null,
      fin.partFragile ? el('p', { class: 'cuisiner-phrase' }, avecPictogramme(fin.partFragile)) : null,
      fin.congeler ? el('p', { class: 'cuisiner-phrase' }, fin.congeler) : null,
      frigo ? el('p', { class: 'cuisiner-frigo' }, avecPictogramme(frigo)) : null,
      el('section', { class: 'cuisiner-bloc' },
        el('h2', {}, TEXTES_CUISINE.pourBienConserver),
        el('ul', { class: 'liste-conseils' }, fin.conseils.map((c) => el('li', {}, c)))),
      m.service.length
        ? el('section', { class: 'cuisiner-bloc' },
          el('h2', {}, TEXTES_CUISINE.jourDuRepas),
          el('ol', { class: 'liste-compacte' }, m.service.map(etapeCompacte)))
        : null,
      finReprise ? boutonRecommencerFin : null,
    ].filter(Boolean));
  }

  /** Libellé et rôle des boutons de la barre selon la page. */
  function dessinerBarre() {
    let libelle = '';
    if (page === 'avant') libelle = TEXTES_CUISINE.commencer;
    else if (page === 'reprise') libelle = TEXTES_CUISINE.reprendre;
    else if (page === 'etape') {
      const actuelle = etapeVue();
      libelle = actuelle && actuelle === modele.etapes[modele.etapes.length - 1] ? TEXTES_CUISINE.derniere : TEXTES_CUISINE.suivante;
    } else if (page === 'fin' || page === 'sansEtapes') libelle = TEXTES_CUISINE.revenir;
    if (boutonSuivant.dataset.libelle !== libelle) {
      boutonSuivant.dataset.libelle = libelle;
      boutonSuivant.replaceChildren(...libelleFleche(libelle));
    }
    barre.hidden = page === 'chargement';
    // « ‹ » garde sa place (rien ne bouge sous le doigt), invisible là où il n'a pas de sens.
    boutonPrecedent.classList.toggle('sans-objet', !(page === 'etape' || page === 'fin'));
  }

  function dessiner() {
    const nom = modele?.nom ?? platCourant()?.nom ?? '';
    let lieu = '';
    if (page === 'avant' || page === 'reprise') lieu = TEXTES_CUISINE.avantDeCommencer;
    else if (page === 'etape') {
      const actuelle = etapeVue();
      lieu = actuelle ? TEXTES_CUISINE.etapeSur(actuelle.rang, modele.total) : '';
    } else if (page === 'fin' || page === 'sansEtapes') lieu = nom;
    if (ou.textContent !== lieu) ou.textContent = lieu;

    if (titreChargement.textContent !== nom) titreChargement.textContent = nom;
    if (page === 'reprise') {
      titreReprise.textContent = nom;
      const etape = modele.etapes.find((e) => e.cle === reprise?.etape);
      phraseReprise.textContent = TEXTES_CUISINE.reprise(etape?.rang ?? 1);
    }
    if (page === 'avant') dessinerAvant();
    if (page === 'etape') {
      const actuelle = etapeVue();
      if (actuelle) {
        cleEtape = actuelle.cle;
        titreEtape = actuelle.titre ?? null;
        rangEtape = actuelle.rang;
        etapeMontree = actuelle;
        carte.maj(actuelle, { cases });
      }
    }
    if (page === 'fin') dessinerFin();
    if (page === 'sansEtapes') titreSansEtapes.textContent = nom;
    dessinerBarre();
    surDefilement();
  }

  /** Montre une page ; le focus va à son titre, la page remonte en haut. */
  function montrer(nouvelle) {
    const changement = nouvelle !== page || nouvelle === 'etape';
    page = nouvelle;
    for (const [cle, { section }] of Object.entries(pages)) section.hidden = cle !== page;
    dessiner();
    if (!changement || !noeud.isConnected) return;
    window.scrollTo(0, 0);
    pages[page].titre.focus({ preventScroll: true });
  }

  function rafraichir() {
    if (parti) return;
    const lu = calculer();
    if (page === 'chargement') {
      dessiner();
      if (lu) demarrer(lu);
      return;
    }
    // Cuisine commencée : un plat parti (corbeille, supprimé) ou sans recette garde ce qui est montré.
    if (lu?.etat === 'ok' && page !== 'sansEtapes') modele = lu;
    if (lu?.etat === 'ok' && page === 'sansEtapes') {
      modele = lu;
      montrer('avant');
      return;
    }
    dessiner();
  }

  rafraichir();
  // Premier écran : son titre prend le focus une fois l'écran posé (l'app focalise d'abord la zone de l'écran).
  queueMicrotask(() => {
    if (noeud.isConnected && !parti) pages[page].titre.focus({ preventScroll: true });
  });

  return {
    noeud,
    maj(nouveau) {
      courant = nouveau;
      rafraichir();
    },
    detruire() {
      parti = true;
      allume.liberer();
      window.removeEventListener('scroll', surDefilement);
      window.removeEventListener('resize', surDefilement);
      if (attenteSuite) cancelAnimationFrame(attenteSuite);
    },
  };
}
