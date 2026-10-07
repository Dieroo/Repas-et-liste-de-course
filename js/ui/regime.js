// Écran « Ce que <Prénom> mange » (#/regime/<profilId>, gestionnaire) : trois choix (« Mange de tout », « Pas de
// viande », « Ni viande ni poisson ») et les précisions « Mange quand même ». Une phrase en direct dit combien de
// plats conviennent. Rien n'est écrit avant « Enregistrer », et rien du tout si le choix n'a pas changé. Les règles
// que l'écran ne sait pas représenter (venues d'une sauvegarde) restent telles quelles (coeur/regles.js).
import { el, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { REGIMES, PRECISIONS, lireRegime, ecrireRegime } from '../coeur/regles.js';
import { bilanCompatibilite } from '../coeur/compatibilite.js';

const ORDRE_REGIMES = ['tout', 'sans_viande', 'sans_viande_ni_poisson'];

const nomDe = (profil) => String(profil?.nom ?? '').replace(/\s+/g, ' ').trim() || 'ce profil';

/** Empreinte des règles enregistrées : absent et `[]` restent distincts. */
const empreinte = (regles) => JSON.stringify(regles === undefined ? null : regles);

/** Choix comparable : les précisions ne comptent pas pour « Mange de tout ». */
function cleDuChoix({ regime, precisions }) {
  return regime === 'tout' ? 'tout' : `${regime}|${[...precisions].sort().join(',')}`;
}

/** « 18 plats conviennent à X, 4 ont sa version, 23 en attendent une. » (accordé) */
function phraseBilan({ convient = 0, avecVersion = 0, aCreer = 0 }, nom) {
  const convientTexte = convient > 1 ? `${convient}\u00A0plats conviennent à ${nom}` : `${convient}\u00A0plat convient à ${nom}`;
  const versionTexte = avecVersion > 1 ? `${avecVersion} ont sa version` : `${avecVersion} a sa version`;
  const attenteTexte = aCreer > 1 ? `${aCreer} en attendent une` : `${aCreer} en attend une`;
  return `${convientTexte}, ${versionTexte}, ${attenteTexte}.`;
}

/**
 * Choix non enregistrés d'un écran quitté sans « Annuler » ni « Enregistrer » (lien de l'en-tête, aperçu…), par
 * compte et par profil : l'écran rouvert les reprend. Gardés le temps que l'app reste ouverte.
 */
const brouillons = new Map();

export function creer(ctx) {
  const id = ctx.parametre;
  let courant = ctx;
  let detruit = false;
  let termine = false; // enregistré ou quitté : plus de mise à jour
  let ouverture = null; // { empreinte, choix, autres } lus à l'ouverture (ou à « Voir les nouveaux »)
  let choix = null; // { regime, precisions: Set } en cours
  let conflit = false;
  let garde = false; // entrée d'historique ajoutée pour intercepter le retour d'Android
  let feuilleOuverte = null;
  let repris = false; // choix repris d'un brouillon
  const cleBrouillon = `${ctx.utilisateur?.uid ?? ''}|${id}`;
  const hashEcran = `#/regime/${encodeURIComponent(id)}`;

  const profilCourant = () => (courant.profils ?? []).find((profil) => profil.id === id);
  const aChange = () => Boolean(choix && ouverture) && cleDuChoix(choix) !== cleDuChoix(ouverture.choix);
  const vientDesReglages = () => courant.routePrecedente === 'reglages' && history.length > 1;

  // ——— Structure permanente : construite une fois, mise à jour en place (le focus reste) ———

  const titre = el('h1', {}, 'Ce que mange');
  const intro = el('p', { class: 'sous-titre' });
  const messageChargement = el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…');
  const messageAbsent = el('div', { class: 'carte etat-vide compact', hidden: true },
    el('p', {}, 'Ce profil n’existe plus.'),
    el('a', { class: 'bouton bouton-secondaire', href: '#/reglages' }, 'Voir les réglages'));
  const boutonVoirNouveaux = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: voirNouveaux }, 'Voir les nouveaux');
  const bandeauConflit = el('div', { class: 'bandeau bandeau-alerte bandeau-colonne', hidden: true },
    el('p', {}, el('span', { 'aria-hidden': 'true' }, '⚠️\u00A0'), 'Ces réglages ont changé sur l’autre appareil.'),
    boutonVoirNouveaux);
  const bandeauRepris = el('div', { class: 'bandeau', hidden: true },
    el('p', {}, 'Vos changements non enregistrés sont repris.'));
  const messages = el('div', { class: 'modifier-messages', role: 'status' }, bandeauRepris, bandeauConflit);

  const legende = el('legend', { class: 'visuellement-masque' });
  const cartes = ORDRE_REGIMES.map((cle) => {
    const { libelle, emoji, aide } = REGIMES[cle] ?? { libelle: cle, emoji: '' };
    const input = el('input', {
      type: 'radio',
      name: 'regime',
      value: cle,
      onchange: () => {
        if (!input.checked || !choix) return;
        choix.regime = cle;
        changement();
      },
    });
    return {
      cle,
      input,
      noeud: el('label', { class: 'choix-carte' },
        input,
        el('span', { class: 'choix-carte-emoji', 'aria-hidden': 'true' }, emoji),
        el('span', { class: 'choix-carte-texte' },
          el('span', { class: 'choix-carte-libelle' }, libelle),
          aide ? el('span', { class: 'choix-carte-aide' }, aide) : null),
        el('span', { class: 'choix-carte-coche', 'aria-hidden': 'true' }, '✓')),
    };
  });
  const groupeRegime = el('fieldset', { class: 'groupe-choix choix-cartes', role: 'radiogroup' },
    legende, cartes.map((carte) => carte.noeud));

  const cases = PRECISIONS.map((precision) => {
    const input = el('input', {
      type: 'checkbox',
      value: precision.id,
      onchange: () => {
        if (!choix) return;
        if (input.checked) choix.precisions.add(precision.id);
        else choix.precisions.delete(precision.id);
        changement();
      },
    });
    return {
      id: precision.id,
      input,
      noeud: el('label', { class: 'case-precision' }, input, el('span', {}, precision.libelle)),
    };
  });
  const groupePrecisions = el('section', { class: 'carte carte-edition', hidden: true },
    el('fieldset', { class: 'groupe-choix' },
      el('legend', { class: 'etiquette-champ' }, 'Mange quand même\u00A0:'),
      cases.map((c) => c.noeud)),
    el('p', { class: 'aide' }, 'Œufs, fromages et miel\u00A0: toujours permis.'));

  const phrase = el('p', { class: 'bilan-regime', role: 'status' });
  const phraseOrphelines = el('p', { class: 'aide', hidden: true });
  const phraseAutres = el('p', { class: 'aide', hidden: true });
  const blocBilan = el('section', { class: 'carte bilan-carte' }, phrase, phraseOrphelines, phraseAutres);

  const boutonAnnuler = el('button', { class: 'bouton bouton-texte bouton-annuler', type: 'button', onclick: quitter }, 'Annuler');
  const formulaire = el('div', { class: 'modifier-formulaire', hidden: true },
    groupeRegime, groupePrecisions, blocBilan, boutonAnnuler);

  const boutonEnregistrer = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    disabled: true,
    onclick: enregistrer,
  }, 'Enregistrer');
  const barre = el('div', { class: 'barre-enregistrer', hidden: true },
    el('div', { class: 'barre-enregistrer-contenu' }, boutonEnregistrer));

  const retour = el('a', {
    class: 'retour',
    href: '#/reglages',
    onclick: (evenement) => {
      evenement.preventDefault();
      quitter();
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), 'Réglages');

  // ——— État ———

  function initialiser(profil) {
    const lu = lireRegime(profil.regles);
    const regime = ORDRE_REGIMES.includes(lu.regime) ? lu.regime : 'tout';
    const precisions = new Set(lu.precisions ?? []);
    ouverture = { empreinte: empreinte(profil.regles), choix: { regime, precisions: new Set(precisions) }, autres: lu.autres ?? [] };
    choix = { regime, precisions };
    conflit = false;
    repris = false;
    for (const carte of cartes) carte.input.checked = carte.cle === regime;
    for (const c of cases) c.input.checked = precisions.has(c.id);
  }

  /** Reprend le choix laissé à la dernière visite ; l'ouverture d'alors sert à repérer un changement venu d'ailleurs. */
  function reprendre(brouillon) {
    ouverture = brouillon.ouverture;
    choix = { regime: brouillon.choix.regime, precisions: new Set(brouillon.choix.precisions) };
    conflit = false;
    repris = true;
    for (const carte of cartes) carte.input.checked = carte.cle === choix.regime;
    for (const c of cases) c.input.checked = choix.precisions.has(c.id);
  }

  /** Règles qu'écrirait « Enregistrer » maintenant. */
  const reglesEnCours = () => ecrireRegime({ regime: choix.regime, precisions: new Set(choix.precisions) }, ouverture.autres);

  function changement() {
    if (termine) return;
    if (aChange()) poserGarde();
    majFormulaire();
  }

  function majFormulaire() {
    const profil = profilCourant();
    if (!profil || !choix) return;
    const nom = nomDe(profil);
    groupePrecisions.hidden = choix.regime === 'tout';

    let texte = 'Chargement des plats…';
    let orphelines = 0;
    if (courant.platsCharges) {
      const bilan = bilanCompatibilite(courant.plats, { ...profil, regles: reglesEnCours() }, { profils: courant.profils }) ?? {};
      orphelines = bilan.orphelines ?? 0;
      texte = choix.regime === 'tout' && !(bilan.aCreer > 0)
        ? `Tous les plats conviennent à ${nom}.`
        : phraseBilan(bilan, nom);
    }
    if (phrase.textContent !== texte) phrase.textContent = texte;
    phraseOrphelines.textContent = orphelines > 1
      ? `${orphelines}\u00A0versions sont rangées sous un autre profil\u00A0: demandez-les de nouveau.`
      : '1\u00A0version est rangée sous un autre profil\u00A0: demandez-la de nouveau.';
    phraseOrphelines.hidden = !(orphelines > 0);
    const autres = ouverture.autres.length;
    phraseAutres.textContent = autres > 1
      ? `${autres}\u00A0autres règles venues d’une sauvegarde sont gardées.`
      : '1\u00A0autre règle venue d’une sauvegarde est gardée.';
    phraseAutres.hidden = !autres;

    bandeauRepris.hidden = !(repris && aChange());
    bandeauConflit.hidden = !conflit;
    boutonEnregistrer.disabled = conflit || !aChange();
  }

  /** Mise à jour en direct : jamais le choix en cours ; un changement venu d'ailleurs est repris s'il n'y en a pas. */
  function majEtat() {
    if (detruit || termine) return;
    const profil = profilCourant();
    const etat = !courant.profilsCharges ? 'chargement' : profil ? 'pret' : 'absent';
    messageChargement.hidden = etat !== 'chargement';
    messageAbsent.hidden = etat !== 'absent';
    formulaire.hidden = etat !== 'pret';
    barre.hidden = etat !== 'pret';
    if (etat === 'absent') feuilleOuverte?.fermer();
    if (etat !== 'pret') return;

    const nom = nomDe(profil);
    const texteTitre = `Ce que ${nom} mange`;
    if (titre.textContent !== texteTitre) titre.textContent = texteTitre;
    legende.textContent = texteTitre;
    intro.textContent = `L’app s’en sert pour repérer les plats à adapter et demander à Claude une version pour ${nom}.`;

    if (!ouverture) {
      const brouillon = brouillons.get(cleBrouillon);
      if (brouillon) reprendre(brouillon);
      else initialiser(profil);
    }
    if (empreinte(profil.regles) !== ouverture.empreinte) {
      if (aChange()) conflit = true;
      else initialiser(profil);
    }
    majFormulaire();
  }

  // ——— Enregistrer, quitter ———

  function enregistrer() {
    const profil = profilCourant();
    if (termine || !profil || !choix) return;
    if (empreinte(profil.regles) !== ouverture.empreinte) {
      conflit = true;
      majFormulaire();
      boutonVoirNouveaux.focus();
      return;
    }
    if (!aChange()) return;
    const regles = reglesEnCours();
    termine = true;
    courant.actions.enregistrerRegles(profil.id, regles);
    const bilan = courant.platsCharges ? bilanCompatibilite(courant.plats, { ...profil, regles }) ?? {} : {};
    const attente = bilan.aCreer ?? 0;
    const nom = nomDe(profil);
    annoncer(attente > 1
      ? `C’est noté. ${attente}\u00A0plats attendent une version pour ${nom}.`
      : attente === 1 ? `C’est noté. 1\u00A0plat attend une version pour ${nom}.` : 'C’est noté.');
    sortir();
  }

  function voirNouveaux() {
    const profil = profilCourant();
    if (!profil) return;
    initialiser(profil);
    majFormulaire();
    annoncer('Les nouveaux réglages sont affichés.');
    cartes.find((carte) => carte.input.checked)?.input.focus();
  }

  /** Retour aux Réglages, sans doublon dans l'historique (l'entrée de garde comprise). */
  function sortir() {
    termine = true;
    brouillons.delete(cleBrouillon);
    feuilleOuverte?.fermer();
    if (vientDesReglages()) history.go(garde ? -2 : -1);
    else location.replace('#/reglages');
    garde = false;
  }

  /** « Annuler », « ‹ Réglages » ou retour d'Android : avec des changements, on demande d'abord. */
  function quitter() {
    if (termine) return;
    if (!aChange()) {
      sortir();
      return;
    }
    demanderSortie();
  }

  function demanderSortie() {
    if (feuilleOuverte) return;
    let part = false;
    feuilleOuverte = ouvrirFeuille('Quitter sans enregistrer\u00A0?', (fermer) => el('div', { class: 'actions-feuille' },
      el('p', { class: 'texte-doux' }, 'Vos changements seront perdus.'),
      el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        onclick: () => {
          part = true;
          fermer();
        },
      }, 'Quitter'),
      el('button', { class: 'bouton bouton-texte', type: 'button', autofocus: true, onclick: fermer }, 'Rester')), {
      onFermer: () => {
        feuilleOuverte = null;
        if (detruit) return;
        if (part) sortir();
        else if (aChange()) poserGarde();
      },
    });
  }

  // ——— Retour d'Android ———
  // Dès le premier changement, une entrée d'historique identique est ajoutée : le retour la retire sans changer
  // d'adresse (l'app ne change pas d'écran), et l'écran demande « Quitter sans enregistrer ? ».

  function poserGarde() {
    if (garde || termine || detruit) return;
    history.pushState({ ...(history.state ?? {}), gardeRegime: true }, '', location.href);
    garde = true;
  }

  function surRetour() {
    if (detruit || termine || !garde || history.state?.gardeRegime) return;
    if (location.hash !== hashEcran) return; // autre écran : l'app s'en charge
    garde = false;
    if (aChange()) demanderSortie();
    else sortir();
  }
  window.addEventListener('popstate', surRetour);
  // Écran rouvert sur son entrée de garde (retour après une sortie par l'en-tête) : il la reprend à son compte.
  if (history.state?.gardeRegime && location.hash === hashEcran) garde = true;

  majEtat();

  return {
    noeud: el('div', { class: 'vue regime' },
      retour,
      el('header', { class: 'vue-entete' }, titre, intro),
      messageChargement,
      messageAbsent,
      messages,
      formulaire,
      barre),
    maj(nouveau) {
      courant = nouveau;
      majEtat();
    },
    detruire() {
      detruit = true;
      window.removeEventListener('popstate', surRetour);
      feuilleOuverte?.fermer();
      if (termine) return;
      if (aChange()) brouillons.set(cleBrouillon, { ouverture, choix: { regime: choix.regime, precisions: [...choix.precisions] } });
      else brouillons.delete(cleBrouillon);
      // Entrée de garde remplacée sur place par un autre écran (aperçu, profil retiré) : on la quitte, sans quoi
      // le retour d'Android repasserait une fois de trop par cet écran.
      if (garde && history.state?.gardeRegime && location.hash !== hashEcran) {
        const etatSansGarde = { ...history.state };
        delete etatSansGarde.gardeRegime;
        history.replaceState(etatSansGarde, '', location.href);
        history.back();
      }
    },
  };
}
