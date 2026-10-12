// Feuilles du drive (T3b, les deux membres, là où l'on s'en sert : Courses ; Réglages pour le gestionnaire) :
// - « Votre drive » : régler une fois l'adresse de recherche du site du drive, en collant l'adresse de la page des
//   résultats de « courgette » (coeur/drive.js › modeleDrive) ; « Essayer avec « beurre » › » ouvre la recherche dans
//   le navigateur ; drive réglé : « Votre drive : drive.exemple.fr », « Changer », « Ne plus chercher au drive » (annonce
//   avec « Annuler »).
// - « Au drive, je cherche » : le mot cherché au drive pour un produit de la liste (« penne » plutôt que « pâtes
//   courtes ») ; « Revenir à « pâtes courtes » » s'il en a un ; il servira les semaines suivantes.
// L'app ne lit jamais le site du drive : elle ouvre seulement des liens. Écritures : actions de l'app, seulement sur un
// geste (reglerDrive, changerRecherche) ; rien n'est écrit à l'ouverture d'une feuille.
import { el, ecrireTexte, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { lirePressePapiers } from './presse-papiers.js';
import { listeCourante } from './plat-semaine.js';
import {
  ERREURS_DRIVE, MOT_EXEMPLE, RECHERCHE_MAX, TEXTES_DRIVE, TEXTE_DRIVE_VALIDE, lienDrive, modeleDrive, texteMotNote,
  texteRevenirA, texteVotreDrive,
} from '../coeur/drive.js';
import { ERREURS_ARTICLE, reglagesCourses } from '../coeur/liste.js';

/** Annonce de « Ne plus chercher au drive » (avec « Annuler »). */
export const ANNONCE_DRIVE_ARRETE = 'Recherche au drive arrêtée.';
const ECHEC_DRIVE = 'Le drive n’a pas pu être enregistré. Réessayez.';
const ECHEC_MOT = 'Le mot n’a pas pu être enregistré. Réessayez.';
const BLOCAGE_PRESSE_PAPIERS = 'Le téléphone bloque la lecture du presse-papiers. Collez à la main\u00A0: touchez '
  + 'longuement le champ, puis «\u00A0Coller\u00A0».';

// Feuilles ouvertes : Courses et Réglages les mettent à jour à chaque rendu (majFeuillesDrive).
const feuillesOuvertes = new Set();

/** Met à jour les feuilles du drive ouvertes avec le contexte du moment. */
export function majFeuillesDrive(ctx) {
  for (const feuille of [...feuillesOuvertes]) feuille.maj(ctx);
}

/** Drive du foyer lu dans les réglages ({ nom, urlRecherche }), ou null s'il n'est pas réglé. */
export function driveDe(ctx) {
  return reglagesCourses(ctx?.reglages ?? null).drive;
}

/** Résultat d'une action refusée : { erreur } ou un code autre que « ok ». */
const echoue = (resultat) => !resultat || Boolean(resultat.erreur)
  || (typeof resultat.code === 'string' && resultat.code !== 'ok');

/** Une action peut rendre une valeur ou une promesse : `suite` reçoit la valeur (une promesse rejetée : null). */
function quand(resultat, suite) {
  if (resultat && typeof resultat.then === 'function') {
    resultat.then(suite, () => suite(null));
  } else {
    suite(resultat);
  }
}

let numero = 0;

/**
 * Feuille « Votre drive » (Courses : « Régler le drive », « Votre drive : … » ; Réglages : carte « 🚗 Drive »).
 * Drive réglé : « Votre drive : drive.exemple.fr », « Changer » (ouvre le formulaire), « Ne plus chercher au drive ».
 * Pas réglé, ou `modifier` : les deux étapes, le champ « Adresse de la page des résultats » et « 📋 Coller » ; adresse
 * valide : « ✓ C'est bon… », « Essayer avec « beurre » › » et « Enregistrer » (principal). Les erreurs (ERREURS_DRIVE)
 * s'affichent après un collage ou au toucher sur « Enregistrer », jamais pendant la frappe.
 * Actions : reglerDrive({ nom, urlRecherche }) (« Enregistrer » ; annonce « Votre drive : drive.exemple.fr ») et
 * reglerDrive(null) (« Ne plus chercher au drive » ; annonce avec « Annuler », qui remet l'ancien drive).
 * → { maj(ctx), fermer }
 */
export function ouvrirVotreDrive(lireCtx, { modifier = false, onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  let enModification = modifier || !driveDe(courant);
  let montrerErreurs = false;
  let valide = null; // { modele, nom } de l'adresse saisie, si elle est bonne
  numero += 1;
  const base = `drive-${numero}`;

  // ——— Drive réglé ———
  const nomRegle = el('p', { class: 'votre-drive-nom' });
  const boutonChanger = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    onclick: () => {
      enModification = true;
      dessiner();
      champ.focus();
    },
  }, TEXTES_DRIVE.changer);
  const blocRegle = el('div', { class: 'bloc-drive-regle' }, nomRegle, boutonChanger);

  // ——— Formulaire ———
  const erreur = el('p', { class: 'erreur-champ', id: `${base}-erreur`, role: 'alert', hidden: true });
  const blocage = el('p', { class: 'aide', id: `${base}-blocage`, hidden: true }, BLOCAGE_PRESSE_PAPIERS);
  const champ = el('input', {
    class: 'champ champ-adresse',
    id: `${base}-adresse`,
    type: 'url',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-describedby': `${base}-erreur ${base}-valide`,
    oninput: (evenement) => {
      // Un collage montre tout de suite ce qui ne va pas ; la frappe, seulement « ✓ C'est bon » quand c'est le cas.
      if (evenement.inputType === 'insertFromPaste' || evenement.inputType === 'insertReplacementText') montrerErreurs = true;
      verifier();
    },
  });
  const boutonColler = el('button', { class: 'bouton bouton-secondaire bouton-coller-drive', type: 'button', onclick: coller },
    TEXTES_DRIVE.coller);
  const texteValide = el('p', { class: 'drive-valide', id: `${base}-valide` });
  const lienEssai = el('a', {
    class: 'bouton bouton-secondaire bouton-plein lien-essai-drive',
    target: '_blank',
    rel: 'noopener noreferrer',
  }, TEXTES_DRIVE.essayer);
  const blocValide = el('div', { class: 'bloc-drive-valide', hidden: true }, texteValide, lienEssai);
  const boutonEnregistrer = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'submit' },
    TEXTES_DRIVE.enregistrer);
  const formulaire = el('form', {
    class: 'formulaire formulaire-drive',
    novalidate: true,
    onsubmit: (evenement) => {
      evenement.preventDefault();
      enregistrer();
    },
  },
  el('ol', { class: 'etapes-drive' },
    el('li', {}, el('p', {}, TEXTES_DRIVE.etape1)),
    el('li', {},
      el('p', {}, TEXTES_DRIVE.etape2),
      el('label', { class: 'etiquette-champ', for: `${base}-adresse` }, TEXTES_DRIVE.champ),
      el('div', { class: 'ligne-adresse-drive' }, champ, boutonColler),
      erreur,
      blocage)),
  blocValide,
  el('div', { class: 'feuille-pied' }, boutonEnregistrer));

  // ——— Bas de la feuille ———
  const boutonArreter = el('button', {
    class: 'bouton bouton-texte bouton-danger bouton-plein',
    type: 'button',
    onclick: arreter,
  }, TEXTES_DRIVE.arreter);
  const boutonFermer = el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: () => fermer() },
    'Fermer');

  const feuille = ouvrirFeuille(TEXTES_DRIVE.titre, () => el('div', { class: 'feuille-drive' },
    blocRegle,
    formulaire,
    el('div', { class: 'actions-feuille' }, boutonArreter, boutonFermer)), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      onFermer?.();
    },
  });

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  /** Lit l'adresse saisie : « ✓ C'est bon » et « Enregistrer » principal si elle est bonne ; l'erreur sinon. */
  function verifier() {
    const lu = modeleDrive(champ.value);
    valide = lu.modele ? lu : null;
    blocValide.hidden = !valide;
    if (valide) {
      ecrireTexte(texteValide, TEXTE_DRIVE_VALIDE);
      const lien = lienDrive(valide.modele, MOT_EXEMPLE);
      if (lien && lienEssai.getAttribute('href') !== lien) lienEssai.setAttribute('href', lien);
      lienEssai.hidden = !lien;
    }
    const message = !valide && montrerErreurs ? ERREURS_DRIVE[lu.erreur] ?? '' : '';
    ecrireTexte(erreur, message);
    erreur.hidden = !message;
    if (message) champ.setAttribute('aria-invalid', 'true');
    else champ.removeAttribute('aria-invalid');
    const classe = `bouton bouton-plein ${valide ? 'bouton-principal' : 'bouton-secondaire'}`;
    if (boutonEnregistrer.className !== classe) boutonEnregistrer.className = classe;
  }

  /** « 📋 Coller » : l'adresse du presse-papiers va dans le champ ; refusé : on explique comment coller à la main. */
  async function coller() {
    const lu = await lirePressePapiers();
    if (!ouverte) return;
    if (lu.refus) {
      blocage.hidden = false;
      champ.focus();
      return;
    }
    blocage.hidden = true;
    champ.value = String(lu.texte ?? '').trim();
    montrerErreurs = true;
    verifier();
    (valide ? boutonEnregistrer : champ).focus();
  }

  function enregistrer() {
    montrerErreurs = true;
    verifier();
    if (!valide) {
      champ.focus();
      return;
    }
    const drive = { nom: valide.nom, urlRecherche: valide.modele };
    quand(courant.actions?.reglerDrive?.(drive), (resultat) => {
      if (echoue(resultat)) {
        if (!ouverte) return;
        ecrireTexte(erreur, ECHEC_DRIVE);
        erreur.hidden = false;
        champ.focus();
        return;
      }
      fermer();
      annoncer(texteVotreDrive(drive.nom));
    });
  }

  /** « Ne plus chercher au drive » : le drive est retiré ; « Annuler » le remet. */
  function arreter() {
    const ancien = driveDe(courant);
    if (!ancien) return;
    quand(courant.actions?.reglerDrive?.(null), (resultat) => {
      if (echoue(resultat)) {
        annoncer(ECHEC_DRIVE);
        return;
      }
      fermer();
      annoncer(ANNONCE_DRIVE_ARRETE, {
        action: {
          libelle: 'Annuler',
          // Un drive réglé entre-temps (sur l'autre téléphone, ou de nouveau ici) n'est jamais remplacé par l'ancien.
          faire: () => {
            const ctx = lireCtx();
            if (!driveDe(ctx)) ctx?.actions?.reglerDrive?.(ancien);
          },
        },
      });
    });
  }

  function dessiner() {
    const drive = driveDe(courant);
    // Drive retiré ailleurs pendant que la feuille montrait son nom : le formulaire le remplace.
    if (!drive) enModification = true;
    blocRegle.hidden = enModification;
    formulaire.hidden = !enModification;
    if (drive) ecrireTexte(nomRegle, texteVotreDrive(drive.nom));
    boutonArreter.hidden = !drive;
    if (enModification) verifier();
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      const avant = enModification;
      dessiner();
      if (!avant && enModification && !feuille.dialogue.contains(document.activeElement)) champ.focus();
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessiner();
  // Formulaire : le champ prend le focus (le clavier s'ouvre) ; drive réglé : le titre, comme toute feuille à lire.
  if (enModification) requestAnimationFrame(() => {
    if (ouverte) champ.focus();
  });
  return handle;
}

/** Ligne, ligne du placard ou article de la liste montrée, par sa clé ; null s'il n'y est plus. */
function trouver(ctx, cle) {
  const liste = listeCourante(ctx);
  return [...(liste?.lignes ?? []), ...(liste?.maison ?? []), ...(liste?.articles ?? [])].find((l) => l?.cle === cle) ?? null;
}

const reduire = (texte) => String(texte ?? '').replace(/\s+/g, ' ').trim();

/**
 * Feuille « Au drive, je cherche » (⋮ d'un article, ou « Changer le mot cherché » au retour du drive) : le champ,
 * prérempli du mot cherché (le nom du produit tant que le foyer n'en a pas choisi), l'aide, « Enregistrer » ; si un mot
 * propre existe, « Revenir à « pâtes courtes » ». Se ferme si la ligne disparaît de la liste.
 * Action : changerRecherche(cle, mot) → { code: 'ok', terme } (terme null : retour au nom) | { code: 'long' } | { code }.
 * Annonce : « C'est noté : « penne » servira les prochaines fois. ». → { maj(ctx), fermer }
 */
export function ouvrirMotCherche(lireCtx, cle, { onFermer } = {}) {
  let courant = lireCtx();
  let ouverte = true;
  numero += 1;
  const base = `mot-drive-${numero}`;
  const depart = trouver(courant, cle);

  const erreur = el('p', { class: 'erreur-champ', id: `${base}-erreur`, role: 'alert', hidden: true });
  const etiquette = el('label', { class: 'visuellement-masque', for: `${base}-mot` });
  const champ = el('input', {
    class: 'champ',
    id: `${base}-mot`,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    autofocus: true,
    'aria-describedby': `${base}-erreur ${base}-aide`,
    oninput: () => {
      erreur.hidden = true;
      champ.removeAttribute('aria-invalid');
    },
  });
  champ.value = depart?.recherche ?? depart?.libelle ?? '';
  const boutonEnregistrer = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' },
    TEXTES_DRIVE.enregistrer);
  const boutonRevenir = el('button', {
    class: 'bouton bouton-texte bouton-plein',
    type: 'button',
    hidden: true,
    onclick: () => envoyer(''),
  });
  const formulaire = el('form', {
    class: 'formulaire formulaire-mot-drive',
    novalidate: true,
    onsubmit: (evenement) => {
      evenement.preventDefault();
      envoyer(champ.value);
    },
  },
  etiquette,
  champ,
  erreur,
  el('p', { class: 'aide', id: `${base}-aide` }, TEXTES_DRIVE.aideMot),
  el('div', { class: 'feuille-pied' }, boutonEnregistrer));

  const feuille = ouvrirFeuille(TEXTES_DRIVE.titreMot, () => el('div', { class: 'feuille-mot-drive' },
    formulaire,
    el('div', { class: 'actions-feuille' },
      boutonRevenir,
      el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: () => fermer() }, 'Fermer'))), {
    onFermer: () => {
      ouverte = false;
      feuillesOuvertes.delete(handle);
      onFermer?.();
    },
  });

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function montrerErreur(texte) {
    erreur.textContent = texte;
    erreur.hidden = false;
    champ.setAttribute('aria-invalid', 'true');
    champ.focus();
  }

  /** Enregistre le mot (vide : retour au nom du produit). */
  function envoyer(saisie) {
    const ligne = trouver(courant, cle);
    if (!ligne) {
      fermer();
      return;
    }
    if (reduire(saisie).length > RECHERCHE_MAX) {
      montrerErreur(ERREURS_ARTICLE.long);
      return;
    }
    quand(courant.actions?.changerRecherche?.(cle, saisie), (resultat) => {
      if (echoue(resultat)) {
        if (!ouverte) return;
        const code = resultat?.erreur ?? resultat?.code;
        montrerErreur(ERREURS_ARTICLE[code] ?? ECHEC_MOT);
        return;
      }
      const terme = typeof resultat?.terme === 'string' && resultat.terme ? resultat.terme : ligne.libelle;
      fermer();
      annoncer(texteMotNote(terme));
    });
  }

  function dessiner() {
    const ligne = trouver(courant, cle);
    if (!ligne) {
      fermer();
      return;
    }
    ecrireTexte(etiquette, `Mot cherché au drive pour «\u00A0${ligne.nom}\u00A0»`);
    const propre = Boolean(ligne.rechercheFoyer);
    boutonRevenir.hidden = !propre;
    if (propre) ecrireTexte(boutonRevenir, texteRevenirA(ligne.libelle));
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      dessiner();
    },
    fermer,
  };
  feuillesOuvertes.add(handle);
  dessiner();
  // Le mot proposé est sélectionné : on tape directement le nouveau.
  requestAnimationFrame(() => {
    if (ouverte && document.activeElement === champ) champ.select();
  });
  return handle;
}
