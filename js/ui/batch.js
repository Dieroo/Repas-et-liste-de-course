// Plan du batch (2026-10-19, route `#/batch/<semaine>`, les deux membres, sans onglets du bas ni en-tête de l'app) :
// le plan écrit par Claude pour les plats de la semaine (coeur/plan-batch.js › pasAPasBatch), suivi comme « Cuisiner
// pas à pas » : « Avant de commencer » (durée, plats et portions, plats de cuisson, hygiène, 🧸, parts à mettre de
// côté, la veille, « Sortir tout ce qu’il faut » plat par plat), une étape par écran (« Pour : Gratin, Salade »,
// quantités de la semaine réunies par produit), puis « Batch terminé 🎉 » (frigo, congélation, part la plus fragile de
// chaque plat, « Pour bien conserver »).
// - Aucune écriture Firestore, aucun minuteur (décision du propriétaire) ; l'étape et les cases se gardent 12 h sur le
//   téléphone (`localStorage`, par compte et par semaine), la taille du texte aussi (celle de « Cuisiner pas à pas ») ;
//   tout marche hors ligne.
// - Plan absent ou d'avant un changement des plats à l'ouverture : l'écran le dit et ramène à Semaine. Une fois le
//   batch commencé, un plat changé ailleurs met l'écran à jour (quantités) ; si le plan part, l'écran garde ce qu'il
//   montrait.
import { el, vibrer } from './dom.js';
import { creerCarteEtape, avecPictogramme, texteRappel } from './etape.js';
import { garderAllume } from './ecran-allume.js';
import { TEXTES_CUISINE, cleTexteCuisine, lireReprise, valeurReprise } from '../coeur/cuisine.js';
import { TEXTES_PLAN_BATCH, cleRepriseBatch, pasAPasBatch } from '../coeur/plan-batch.js';

// Un second toucher sur la barre, dans ce délai, est ignoré (comme « Cuisiner pas à pas »).
const GARDE_TOUCHER_MS = 600;
// L'écran est rendu après ce temps sans toucher.
const ALLUME_MINUTES = 30;

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
    // Stockage plein ou bloqué : le batch continue, seule la reprise sera perdue.
  }
}

/** Texte dont l'emoji final (« Batch terminé 🎉 ») est montré sans être lu. */
function avecPictogrammeFinal(texte) {
  const trouve = String(texte).match(/^(.*?)\s*(\p{Extended_Pictographic}️?)$/u);
  return trouve ? [trouve[1], el('span', { 'aria-hidden': 'true' }, `\u00A0${trouve[2]}`)] : [String(texte)];
}

/** Ligne d'une étape « La veille » : rappels (part et sa case, 🧸), titre, « Pour : … », quantités, texte, signe. */
function etapeCompacte(etape, caseDe) {
  const rappels = (etape.rappels ?? []).map((r) => el('div', { class: `etape-rappel etape-rappel-${r.genre}` },
    el('p', { class: 'etape-rappel-texte' }, texteRappel(r.texte, r.genre, r.appareil)),
    r.consigne ? el('p', { class: 'etape-rappel-consigne' }, r.consigne) : null,
    r.case ? el('ul', { class: 'liste-cases' }, caseDe({ cle: r.case.cle, texte: r.case.libelle })) : null));
  return el('li', { class: 'etape-compacte' },
    ...rappels,
    el('p', { class: 'etape-compacte-titre' }, etape.titre),
    etape.pour ? el('p', { class: 'etape-compacte-pour' }, etape.pour) : null,
    etape.quantites?.length ? el('p', { class: 'etape-compacte-quantites' }, etape.quantites.map((q) => q.texte).join(' · ')) : null,
    etape.texte ? el('p', {}, etape.texte) : null,
    etape.pret ? el('p', { class: 'etape-compacte-pret' }, avecPictogramme(TEXTES_CUISINE.pretQuand(etape.pret))) : null,
    ...(etape.conseils ?? []).map((c) => el('p', { class: 'etape-compacte-conseil' }, c)));
}

/** Blocs de la carte d'une étape, dans leur ordre : le dernier visible doit se voir au-dessus de la barre. */
const BLOCS_DE_LA_CARTE = ['texte', 'pret', 'puces', 'parts', 'conseils', 'pendant'].map((c) => `.etape-cuisine-${c}`).join(', ');

/**
 * Écran du batch. `ctx` : contexte de l'app (`parametre` : la semaine ; `actions.lireBatch`, `profils`, `moi`, `role`,
 * `reglages`, `compat`, `aujourdhui`, `utilisateur`, `routePrecedente`). → { noeud, maj(ctx), detruire() }
 */
export function creer(ctx) {
  const semaineId = ctx.parametre;
  let courant = ctx;
  const uid = ctx.utilisateur?.uid ?? '';
  const cleEtat = uid ? cleRepriseBatch(uid, semaineId) : null;
  const cleTaille = uid ? cleTexteCuisine(uid) : null;

  let page = 'chargement'; // 'chargement' | 'introuvable' | 'reprise' | 'avant' | 'etape' | 'fin'
  let cleEtape = null;
  let titreEtape = null;
  let rangEtape = 1;
  let etapeMontree = null;
  let cases = new Set();
  let reprise = null;
  let finLe = null; // heure de « Batch terminé › » : le jour de cuisson des dates limites
  let finReprise = false;
  let modele = null;
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
  const titreChargement = el('h1', { tabindex: '-1' }, TEXTES_PLAN_BATCH.titreCarte.replace(/^\S+\s*/u, ''));
  const pageChargement = el('section', { class: 'cuisiner-page' },
    titreChargement, el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…'));

  const titreIntrouvable = el('h1', { tabindex: '-1' }, TEXTES_PLAN_BATCH.titreCarte.replace(/^\S+\s*/u, ''));
  const phraseIntrouvable = el('p', { class: 'cuisiner-phrase' });
  const pageIntrouvable = el('section', { class: 'cuisiner-page', hidden: true }, titreIntrouvable, phraseIntrouvable);

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

  const titreFin = el('h1', { tabindex: '-1' }, avecPictogrammeFinal(TEXTES_PLAN_BATCH.fin));
  const boutonRecommencerFin = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: recommencer },
    TEXTES_CUISINE.recommencer);
  const corpsFin = el('div', { class: 'cuisiner-fin' });
  const pageFin = el('section', { class: 'cuisiner-page', hidden: true }, titreFin, corpsFin);
  let vueFin = null;

  const pages = {
    chargement: { section: pageChargement, titre: titreChargement },
    introuvable: { section: pageIntrouvable, titre: titreIntrouvable },
    reprise: { section: pageReprise, titre: titreReprise },
    avant: { section: pageAvant, titre: titreAvant },
    etape: { section: pageEtape, titre: carte.titre },
    fin: { section: pageFin, titre: titreFin },
  };

  // ——— Barre du bas ———
  const boutonPrecedent = el('button', {
    class: 'bouton bouton-secondaire bouton-cuisine-precedent', type: 'button', 'aria-label': TEXTES_CUISINE.precedenteNom,
    onclick: () => garde() && precedent(),
  }, el('span', { 'aria-hidden': 'true' }, TEXTES_CUISINE.precedente));
  const boutonSuivant = el('button', {
    class: 'bouton bouton-principal bouton-cuisine-suivant', type: 'button', onclick: () => garde() && suivant(),
  });
  const suite = el('p', { class: 'cuisiner-suite', 'aria-hidden': 'true', hidden: true }, TEXTES_CUISINE.suite);
  const barre = el('div', { class: 'barre-cuisiner' }, suite,
    el('div', { class: 'barre-cuisiner-contenu' }, boutonPrecedent, boutonSuivant));
  let attenteSuite = 0;
  function majSuite() {
    attenteSuite = 0;
    if (!noeud.isConnected) return;
    let montre = false;
    if (page === 'etape') {
      const blocs = [...carte.noeud.querySelectorAll(BLOCS_DE_LA_CARTE)].filter((bloc) => !bloc.hidden);
      const dernier = blocs.at(-1);
      montre = Boolean(dernier) && dernier.getBoundingClientRect().bottom > barre.getBoundingClientRect().top + 1;
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
  const observateur = typeof ResizeObserver === 'function' ? new ResizeObserver(surDefilement) : null;
  observateur?.observe(carte.noeud);
  observateur?.observe(corpsAvant);
  document.fonts?.ready?.then(surDefilement).catch(() => {});

  const noeud = el('div', { class: 'vue cuisiner batch' }, entete,
    pageChargement, pageIntrouvable, pageReprise, pageAvant, pageEtape, pageFin, barre);
  noeud.classList.toggle('texte-grand', grand);

  const allume = garderAllume({
    minutes: ALLUME_MINUTES,
    surChange: (obtenu) => {
      ligneAllumeAvant.hidden = !obtenu;
      ligneAllumeReprise.hidden = !obtenu;
    },
  });

  // ——— Modèle ———

  /**
   * Modèle de pasAPasBatch pour l'état du moment (gardé tant que rien ne change) → null au chargement,
   * { etat: 'perime' | 'introuvable' } sans plan à jour, sinon le modèle.
   */
  function calculer() {
    const lu = courant.actions?.lireBatch?.(semaineId) ?? { code: 'chargement' };
    if (lu.code === 'chargement') return null;
    if (lu.code !== 'ok') return { etat: 'introuvable' };
    const { batch } = lu;
    const jour = finLe ? jourDe(finLe) : courant.aujourdhui;
    const cles = [batch.doc, batch.elements, courant.profils, courant.moi, courant.role, courant.reglages, jour];
    if (memo.cles && cles.every((c, i) => c === memo.cles[i])) return memo.resultat;
    let resultat;
    if (batch.carte.etat === 'pret') {
      resultat = pasAPasBatch(batch.doc.plan, {
        elements: batch.elements, profils: courant.profils ?? [], moi: courant.moi ?? null, role: courant.role ?? null,
        reglages: courant.reglages ?? null, aujourdhui: jour,
        ...(typeof courant.compat === 'function' ? { evaluer: courant.compat } : {}),
      });
      resultat = { ...resultat, portionsChangees: batch.carte.portionsChangees };
    } else {
      resultat = { etat: batch.carte.etat === 'perime' ? 'perime' : 'introuvable' };
    }
    memo.cles = cles;
    memo.resultat = resultat;
    return resultat;
  }

  const clesDesEtapes = (m) => (m?.etapes ?? []).map((e) => e.cle);

  /** Première ouverture du plan prêt : reprise, « Avant de commencer », ou plan introuvable. */
  function demarrer(lu) {
    if (lu.etat !== 'ok') {
      phraseIntrouvable.textContent = lu.etat === 'perime' ? TEXTES_PLAN_BATCH.perimeEcran : TEXTES_PLAN_BATCH.introuvable;
      montrer('introuvable');
      return;
    }
    modele = lu;
    const sauvee = cleEtat ? lireReprise(lire(cleEtat), { cles: clesDesEtapes(lu), etapes: lu.etapes }) : null;
    if (sauvee) cases = new Set(sauvee.cases);
    if (sauvee?.etape === 'fin') {
      finLe = new Date(sauvee.le);
      const nouveau = calculer();
      if (nouveau?.etat === 'ok') modele = nouveau;
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

  function garde() {
    const maintenant = performance.now();
    if (maintenant - dernierGeste < GARDE_TOUCHER_MS) return false;
    dernierGeste = maintenant;
    allume.toucher();
    return true;
  }

  function sauver(etape) {
    if (!cleEtat) return;
    const maintenant = etape === 'fin' && finLe ? finLe.getTime() : Date.now();
    ecrire(cleEtat, JSON.stringify(valeurReprise({
      etape, titre: etape === cleEtape ? titreEtape : null, cases: [...cases], maintenant,
    })));
  }

  function etapeVue() {
    const etapes = modele?.etapes ?? [];
    const memeTitre = (e) => titreEtape === null || e.titre === titreEtape;
    return etapes.find((e) => e.cle === cleEtape && memeTitre(e))
      ?? (titreEtape !== null ? etapes.find((e) => e.titre === titreEtape) : null)
      ?? etapeMontree
      ?? etapes[Math.min(Math.max(rangEtape, 1), etapes.length) - 1] ?? null;
  }

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
      const suivante = modele.etapes[disparue ? index : index + 1];
      if (suivante) {
        allerALEtape(suivante);
      } else {
        if (!finLe) finLe = new Date();
        const nouveau = calculer();
        if (nouveau?.etat === 'ok') modele = nouveau;
        sauver('fin');
        montrer('fin');
      }
      return;
    }
    if (page === 'fin' || page === 'introuvable') revenirALaSemaine({ fini: page === 'fin' });
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

  /** « Recommencer » : « Avant de commencer », cases vides. */
  function recommencer() {
    if (!garde()) return;
    reprise = null;
    finLe = null;
    finReprise = false;
    vueFin = null;
    vueAvant = null;
    cases = new Set();
    const nouveau = calculer();
    if (nouveau?.etat === 'ok') modele = nouveau;
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

  function changerTaille() {
    grand = !grand;
    noeud.classList.toggle('texte-grand', grand);
    boutonTaille.setAttribute('aria-pressed', String(grand));
    if (cleTaille) ecrire(cleTaille, grand ? 'grand' : null);
    surDefilement();
  }

  /** Retour d'où l'on vient (Semaine), sinon à Semaine ; l'étape reste gardée sur le téléphone. */
  function quitter() {
    if (parti) return;
    parti = true;
    const venu = courant.routePrecedente;
    if (venu && venu !== 'batch' && history.length > 1) history.back();
    else location.hash = '#/semaine';
  }

  /** « Revenir à la semaine » ; à la fin, le batch est fini (plus rien à reprendre). */
  function revenirALaSemaine({ fini = false } = {}) {
    if (parti) return;
    parti = true;
    if (fini && cleEtat) ecrire(cleEtat, null);
    if (courant.routePrecedente === 'semaine' && history.length > 1) history.back();
    else location.hash = '#/semaine';
  }

  // ——— Dessin ———

  function dessinerAvant() {
    const m = modele;
    const signature = JSON.stringify([m.titrePage, m.duree, m.avant, m.portionsChangees]);
    if (signature === vueAvant) {
      for (const input of corpsAvant.querySelectorAll('input[type="checkbox"][data-cle]')) {
        input.checked = cases.has(input.dataset.cle);
      }
      return;
    }
    vueAvant = signature;
    const focus = corpsAvant.contains(document.activeElement) ? document.activeElement.dataset?.cle ?? null : null;
    titreAvant.textContent = m.titrePage;
    const { avant } = m;
    const caseDe = ({ cle, texte }) => {
      const input = el('input', { type: 'checkbox', 'data-cle': cle });
      input.checked = cases.has(cle);
      input.addEventListener('change', () => toucherCase(cle, input.checked));
      return el('li', {}, el('label', { class: 'case-cuisine' }, input, el('span', {}, texte)));
    };
    corpsAvant.replaceChildren(...[
      m.duree ? el('p', { class: 'cuisiner-duree' }, el('span', { 'aria-hidden': 'true' }, '⏱\u00A0'), m.duree) : null,
      ligneAllumeAvant,
      m.portionsChangees ? el('p', { class: 'cuisiner-phrase batch-portions' }, TEXTES_PLAN_BATCH.portionsChangees) : null,
      el('section', { class: 'cuisiner-bloc' },
        el('h2', {}, TEXTES_PLAN_BATCH.lesPlats),
        el('ul', { class: 'liste-conseils' }, avant.plats.map((t) => el('li', {}, t)))),
      avant.recipients.length
        ? el('section', { class: 'cuisiner-bloc' },
          el('h2', {}, TEXTES_PLAN_BATCH.recipients),
          el('ul', { class: 'liste-conseils' }, avant.recipients.map((t) => el('li', {}, t))))
        : null,
      el('div', { class: 'cuisiner-conseils' }, avant.hygiene.map((t) => el('p', {}, avecPictogramme(t)))),
      avant.enfant.length
        ? el('div', { class: 'cuisiner-rappels-avant' }, avant.enfant.map((ligne) => el('p', {}, avecPictogramme(ligne.texte))))
        : null,
      avant.parts.length
        ? el('div', { class: 'cuisiner-rappels-avant' }, avant.parts.map((t) => el('p', { class: 'ligne-part-avant' }, texteRappel(t, 'part'))))
        : null,
      avant.veille.length
        ? el('section', { class: 'cuisiner-bloc' },
          el('h2', {}, TEXTES_CUISINE.laVeille),
          el('ol', { class: 'liste-compacte' }, avant.veille.map((etape) => etapeCompacte(etape, caseDe))))
        : null,
      el('section', { class: 'cuisiner-bloc' },
        el('h2', {}, TEXTES_CUISINE.sortirToutCeQuIlFaut),
        ...avant.reunir.filter((p) => p.ingredients.length).map((p) => el('div', { class: 'batch-reunir' },
          el('h3', {}, p.nom),
          el('ul', { class: 'liste-cases' }, p.ingredients.map(caseDe)))),
        avant.aussi ? el('p', { class: 'cuisiner-aussi' }, avant.aussi) : null,
        avant.ustensiles.length
          ? el('ul', { class: 'liste-cases' }, avant.ustensiles.map(({ cle, nom }) => caseDe({ cle, texte: nom })))
          : null),
    ].filter(Boolean));
    if (focus) corpsAvant.querySelector(`[data-cle="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }

  function dessinerFin() {
    const { fin } = modele;
    const signature = JSON.stringify([fin, finReprise]);
    if (signature === vueFin) return;
    vueFin = signature;
    corpsFin.replaceChildren(...[
      ...fin.plats.map((p) => el('section', { class: 'cuisiner-bloc' },
        el('h2', {}, p.nom),
        p.portions ? el('p', { class: 'cuisiner-phrase' }, p.portions) : null,
        p.partFragile ? el('p', { class: 'cuisiner-phrase' }, avecPictogramme(p.partFragile)) : null,
        p.congeler ? el('p', { class: 'cuisiner-phrase' }, p.congeler) : null)),
      fin.conseils.length
        ? el('section', { class: 'cuisiner-bloc' },
          el('h2', {}, TEXTES_CUISINE.pourBienConserver),
          el('ul', { class: 'liste-conseils' }, fin.conseils.map((c) => el('li', {}, c))))
        : null,
      finReprise ? boutonRecommencerFin : null,
    ].filter(Boolean));
  }

  function dessinerBarre() {
    let libelle = '';
    if (page === 'avant') libelle = TEXTES_CUISINE.commencer;
    else if (page === 'reprise') libelle = TEXTES_CUISINE.reprendre;
    else if (page === 'etape') {
      const actuelle = etapeVue();
      libelle = actuelle && actuelle === modele.etapes[modele.etapes.length - 1] ? TEXTES_PLAN_BATCH.termine : TEXTES_CUISINE.suivante;
    } else if (page === 'fin' || page === 'introuvable') libelle = TEXTES_PLAN_BATCH.revenir;
    if (boutonSuivant.dataset.libelle !== libelle) {
      boutonSuivant.dataset.libelle = libelle;
      boutonSuivant.replaceChildren(...libelleFleche(libelle));
    }
    barre.hidden = page === 'chargement';
    boutonPrecedent.classList.toggle('sans-objet', !(page === 'etape' || page === 'fin'));
  }

  function dessiner() {
    let lieu = '';
    if (page === 'avant' || page === 'reprise') lieu = TEXTES_CUISINE.avantDeCommencer;
    else if (page === 'etape') {
      const actuelle = etapeVue();
      lieu = actuelle ? TEXTES_CUISINE.etapeSur(actuelle.rang, modele.total) : '';
    } else if (page === 'fin') lieu = modele?.titrePage ?? '';
    if (ou.textContent !== lieu) ou.textContent = lieu;

    if (page === 'reprise') {
      titreReprise.textContent = modele.titrePage;
      const etape = modele.etapes.find((e) => e.cle === reprise?.etape);
      phraseReprise.textContent = TEXTES_CUISINE.reprise(etape?.rang ?? 1);
    }
    if (page === 'avant') dessinerAvant();
    if (page === 'etape') {
      const actuelle = etapeVue();
      if (actuelle) {
        if (actuelle.cle !== cleEtape && (actuelle.rappels ?? []).some((r) => r.genre === 'four' || r.genre === 'part')) {
          try { navigator.vibrate?.([80, 60, 80]); } catch { /* vibration refusée : sans effet */ }
        }
        cleEtape = actuelle.cle;
        titreEtape = actuelle.titre ?? null;
        rangEtape = actuelle.rang;
        etapeMontree = actuelle;
        carte.maj(actuelle, { cases });
      }
    }
    if (page === 'fin') dessinerFin();
    dessinerBarre();
    surDefilement();
  }

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
    // Batch commencé : un plan parti ou devenu périmé garde ce qui est montré.
    if (lu?.etat === 'ok' && page !== 'introuvable') modele = lu;
    if (lu?.etat === 'ok' && page === 'introuvable') {
      demarrer(lu);
      return;
    }
    dessiner();
  }

  /** Jour 'AAAA-MM-JJ' d'une heure du téléphone. */
  function jourDe(date) {
    const deux = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
  }

  rafraichir();
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
      observateur?.disconnect();
      if (attenteSuite) cancelAnimationFrame(attenteSuite);
    },
  };
}
