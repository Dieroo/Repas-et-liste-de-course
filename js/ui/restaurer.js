// Écran « Restaurer une sauvegarde » (gestionnaire, CLAUDE.md §8). Ce qui est dans l'app reste ; ce qui manque
// revient ; seules les recettes cochées reprennent leur version sauvegardée. Tout part des données lues sur le
// serveur (celles de l'autre téléphone comprises), relues au toucher sur « Restaurer ». Le fichier n'est jamais affiché.
import { el, annoncer } from './dom.js';
import { choisirFichier, lireTexte } from './fichier.js';
import {
  FICHIER_MAX,
  lireSauvegarde,
  validerSauvegarde,
  preparerRestauration,
  empreinteRestauration,
  creerSauvegarde,
  nomFichierSauvegarde,
} from '../coeur/sauvegarde.js';

const MESSAGES_FICHIER = {
  vide: 'Ce fichier est vide.',
  trop_gros: 'Ce fichier est trop gros pour être une sauvegarde de l’app.',
  illisible: 'Ce fichier n’est pas une sauvegarde de l’app. Choisissez le fichier téléchargé depuis Réglages.',
  coupee: 'Ce fichier semble coupé ou abîmé. Utilisez une autre sauvegarde.',
  recettes: 'Ce fichier contient des recettes, pas une sauvegarde.',
  version: 'Cette sauvegarde vient d’une version de l’app que celle-ci ne connaît pas.',
};

const TITRES_FICHIER = {
  vide: 'Fichier vide',
  trop_gros: 'Fichier trop gros',
  illisible: 'Ce n’est pas une sauvegarde',
  coupee: 'Fichier abîmé',
  recettes: 'Ce n’est pas une sauvegarde',
  version: 'Sauvegarde inconnue',
};

const MESSAGE_RESEAU = 'La restauration demande du réseau, pour partir des données à jour de l’autre téléphone. Réessayez quand il revient.';
const MESSAGE_ECHEC = 'La restauration n’a pas abouti, souvent à cause du réseau. Recommencez quand il est stable\u00A0: ce qui est déjà fait ne sera pas refait.';
const MESSAGE_CHANGEMENTS = 'Des changements sont arrivés depuis l’aperçu\u00A0: vérifiez, puis touchez à nouveau «\u00A0Restaurer\u00A0».';

// À partir de ce nombre de recettes différentes, « Tout cocher » apparaît.
const TOUT_COCHER_DES = 4;

const pluriel = (n, singulier, plurielTexte) => `${n}\u00A0${n > 1 ? plurielTexte : singulier}`;

/** Date, horodatage Firestore (`toDate()` ou `{ seconds }`) ou texte ISO → Date, ou null. */
function versDate(valeur) {
  if (valeur == null) return null;
  let date = null;
  if (valeur instanceof Date) date = valeur;
  else if (typeof valeur.toDate === 'function') date = valeur.toDate();
  else if (typeof valeur.seconds === 'number') date = new Date(valeur.seconds * 1000);
  else if (typeof valeur === 'string' || typeof valeur === 'number') date = new Date(valeur);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const jourDuMois = (date) => (date.getDate() === 1 ? '1er' : String(date.getDate()));
const mois = (date) => date.toLocaleDateString('fr-FR', { month: 'long' });

/** « 6 octobre 2026 à 18 h 42 », au fuseau du téléphone. */
function dateEtHeure(date) {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${jourDuMois(date)}\u00A0${mois(date)} ${date.getFullYear()} à ${date.getHours()}\u00A0h\u00A0${minutes}`;
}

/** « 5 octobre » ; l'année s'ajoute si ce n'est pas l'année en cours. */
function jourCourt(date) {
  const annee = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${jourDuMois(date)}\u00A0${mois(date)}${annee}`;
}

const texteDe = (avertissement) => (typeof avertissement === 'string' ? avertissement : avertissement?.message ?? '');

const nombreEcritures = (preparation) => (preparation?.lots ?? []).reduce((total, lot) => total + lot.length, 0);

export function creer(ctx) {
  let courant = ctx;
  let detruit = false;
  // Étape affichée : attente (rien choisi), lecture (fichier ou serveur), erreur (fichier refusé), contenu (fautes
  // du fichier), reseau (serveur injoignable), apercu, aJour.
  let etat = { type: 'attente' };
  let validation = null; // sauvegarde lue et validée
  let serveur = null; // { plats, profils, demandes } lus sur le serveur pour l'aperçu
  let preparation = null; // aperçu en cours (avec les cases cochées)
  let empreinte = ''; // empreinte des écritures de l'aperçu affiché
  const coches = new Set(); // recettes à reprendre
  const vues = new Set(); // recettes déjà proposées (une case décochée par la personne le reste)
  let occupe = false; // un choix de fichier ou une restauration en cours
  let restauration = false; // étapes 2 à 4 du toucher sur « Restaurer »
  let messageAction = null; // { texte, alerte } affiché au-dessus du bouton « Restaurer »
  let focaliser = false;
  let signature = '';
  let version = 0; // change à chaque nouvel état : l'affichage n'est reconstruit que dans ce cas (ou au réseau)

  const retour = el('a', { class: 'retour', href: '#/reglages', onclick: revenir },
    el('span', { 'aria-hidden': 'true' }, '‹'), el('span', {}, 'Réglages'));

  const boutonChoisir = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    onclick: choisir,
  }, '📄 Choisir le fichier de sauvegarde');
  const messageHorsLigne = el('p', { class: 'message-reseau', role: 'status' }, MESSAGE_RESEAU);
  const resultat = el('div', { class: 'resultat-restaurer' });

  function revenir(evenement) {
    // Venu de Réglages : retour dans l'historique, pour que le geste retour d'Android reste naturel.
    if (courant.routePrecedente === 'reglages' && history.length > 1) {
      evenement.preventDefault();
      history.back();
    }
  }

  function changer(nouvelEtat, { focus = true } = {}) {
    etat = nouvelEtat;
    version += 1;
    focaliser = focus;
    dessiner();
  }

  async function choisir() {
    if (occupe || restauration) return;
    const fichier = await choisirFichier();
    if (!fichier || detruit || occupe || restauration) return;
    occupe = true;
    messageAction = null;
    changer({ type: 'lecture', texte: 'Lecture du fichier…' });
    try {
      const lu = await lireTexte(fichier, FICHIER_MAX);
      if (detruit) return;
      if (lu.erreur) {
        changer({ type: 'erreur', code: lu.erreur });
        return;
      }
      const sauvegarde = lireSauvegarde(lu.texte);
      if (sauvegarde.erreur) {
        changer({ type: 'erreur', code: sauvegarde.erreur });
        return;
      }
      const valide = validerSauvegarde(sauvegarde.sauvegarde);
      if (!valide.valide) {
        changer({ type: 'contenu', erreurs: valide.erreurs.map(texteDe) });
        return;
      }
      validation = valide;
      coches.clear();
      vues.clear();
      await chargerApercu();
    } catch {
      // Lecture imprévue : le fichier est refusé, rien n'est écrit.
      if (!detruit) changer({ type: 'erreur', code: 'illisible' });
    } finally {
      occupe = false;
    }
  }

  /** Lit le serveur, puis prépare l'aperçu. Échec de lecture : message réseau, avec « Réessayer ». */
  async function chargerApercu() {
    if (!validation) return;
    changer({ type: 'lecture', texte: 'Vérification des données à jour…' });
    let lus;
    try {
      lus = await courant.actions.lireDepuisServeur();
    } catch {
      if (!detruit) changer({ type: 'reseau' });
      return;
    }
    if (detruit) return;
    serveur = lus;
    preparation = preparer(lus);
    empreinte = empreinteRestauration(preparation);
    changer({ type: preparation.rien && !preparation.recettesDifferentes.length ? 'aJour' : 'apercu' });
  }

  /**
   * Prépare la restauration à partir des données du serveur, avec les cases cochées. Une recette nouvellement
   * proposée prend sa case par défaut (cochée seulement si la fiche de l'app est ⏳) ; une case que la personne a
   * réglée garde son état.
   */
  function preparer(lus) {
    const donneesApp = {
      plats: lus.plats ?? [],
      profils: lus.profils ?? [],
      demandes: lus.demandes ?? [],
      email: courant.utilisateur?.email ?? '',
    };
    const brouillon = preparerRestauration(validation, donneesApp, { recettesAReprendre: [...coches] });
    const proposees = new Set(brouillon.recettesDifferentes.map((r) => r.id));
    for (const id of [...coches]) if (!proposees.has(id)) coches.delete(id);
    let changees = false;
    for (const recette of brouillon.recettesDifferentes) {
      if (vues.has(recette.id)) continue;
      vues.add(recette.id);
      if (recette.cocheeParDefaut && !coches.has(recette.id)) {
        coches.add(recette.id);
        changees = true;
      }
    }
    return changees
      ? preparerRestauration(validation, donneesApp, { recettesAReprendre: [...coches] })
      : brouillon;
  }

  /** Case touchée : l'aperçu est recalculé sur les mêmes données du serveur. */
  function cocher(id, coche) {
    if (restauration || !serveur) return;
    if (coche) coches.add(id);
    else coches.delete(id);
    preparation = preparer(serveur);
    empreinte = empreinteRestauration(preparation);
    messageAction = null;
    changer({ type: 'apercu' }, { focus: false });
  }

  function toutCocher() {
    if (restauration || !serveur) return;
    const toutes = preparation.recettesDifferentes.every((r) => coches.has(r.id));
    for (const recette of preparation.recettesDifferentes) {
      if (toutes) coches.delete(recette.id);
      else coches.add(recette.id);
    }
    preparation = preparer(serveur);
    empreinte = empreinteRestauration(preparation);
    messageAction = null;
    changer({ type: 'apercu' }, { focus: false });
  }

  /**
   * Toucher sur « Restaurer » :
   * 1. recettes cochées : copie de précaution de leur version actuelle, téléchargée tout de suite, dans le toucher
   *    (sans attente préalable, sinon le navigateur peut la bloquer) ;
   * 2. nouvelle lecture du serveur, préparation avec les mêmes cases ;
   * 3. changement depuis l'aperçu : rien n'est écrit, le nouvel aperçu s'affiche ;
   * 4. sinon envoi, annonce, puis la liste des plats.
   */
  async function restaurer() {
    if (restauration || occupe || !preparation || !serveur || preparation.rien) return;
    if (!navigator.onLine) {
      dessiner();
      return;
    }
    if (coches.size) {
      try {
        const maintenant = new Date();
        const { texte } = creerSauvegarde({ plats: serveur.plats ?? [], profils: serveur.profils ?? [] }, { maintenant });
        courant.actions.telecharger(nomFichierSauvegarde(maintenant, { avantRestauration: true }), texte);
      } catch {
        // Sans copie de précaution, aucune recette n'est remplacée.
        messageAction = { texte: 'La copie de précaution n’a pas pu être faite\u00A0: rien n’a été restauré.', alerte: true };
        changer({ type: 'apercu' }, { focus: false });
        return;
      }
    }
    restauration = true;
    let termine = false;
    messageAction = null;
    changer({ type: 'apercu' }, { focus: false });
    try {
      let lus;
      try {
        lus = await courant.actions.lireDepuisServeur();
      } catch {
        if (detruit) return;
        messageAction = { texte: MESSAGE_RESEAU, alerte: true };
        return;
      }
      if (detruit) return;
      const nouvelle = preparer(lus);
      const nouvelleEmpreinte = empreinteRestauration(nouvelle);
      serveur = lus;
      preparation = nouvelle;
      if (nouvelleEmpreinte !== empreinte) {
        empreinte = nouvelleEmpreinte;
        messageAction = { texte: MESSAGE_CHANGEMENTS, alerte: true };
        return;
      }
      try {
        await courant.actions.restaurer(nouvelle);
      } catch {
        if (detruit) return;
        messageAction = { texte: MESSAGE_ECHEC, alerte: true };
        return;
      }
      if (detruit) return;
      termine = true;
      annoncer('Sauvegarde restaurée.');
      location.replace('#/plats');
    } finally {
      restauration = false;
      if (!detruit && !termine) {
        const aJour = preparation.rien && !preparation.recettesDifferentes.length;
        changer({ type: aJour ? 'aJour' : 'apercu' }, { focus: false });
        if (messageAction) resultat.querySelector('[data-message-action]')?.focus();
      }
    }
  }

  // ——— Affichage ———

  function dessiner() {
    const enLigne = navigator.onLine;
    const nouvelleSignature = `${version}|${enLigne}|${restauration}`;
    if (nouvelleSignature === signature) return;
    signature = nouvelleSignature;

    // Hors ligne : à la place du bouton, le message réseau ; le bouton revient avec le réseau.
    // (Aperçu ou échec de lecture affichés : leur carte porte déjà ce message, il n'est pas répété en haut.)
    boutonChoisir.hidden = !enLigne;
    messageHorsLigne.hidden = enLigne || etat.type === 'apercu' || etat.type === 'reseau';
    boutonChoisir.disabled = restauration;
    // Un aperçu affiché porte l'action principale : le choix d'un autre fichier passe au second plan.
    boutonChoisir.className = `bouton ${etat.type === 'apercu' ? 'bouton-secondaire' : 'bouton-principal'} bouton-plein`;

    const actif = resultat.contains(document.activeElement)
      ? document.activeElement.dataset.cle ?? null
      : null;
    resultat.replaceChildren(...rendu(enLigne));
    const titre = resultat.querySelector('[data-titre-resultat]');
    if (focaliser) {
      focaliser = false;
      titre?.focus();
    } else if (actif) {
      (resultat.querySelector(`[data-cle="${CSS.escape(actif)}"]`) ?? titre)?.focus({ preventScroll: true });
    }
  }

  function titreResultat(texte) {
    return el('h2', { tabindex: '-1', 'data-titre-resultat': '' }, texte);
  }

  function rendu(enLigne) {
    switch (etat.type) {
      case 'attente':
        return [];
      case 'lecture':
        return [el('p', { class: 'texte-doux', role: 'status' }, etat.texte)];
      case 'erreur':
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(TITRES_FICHIER[etat.code] ?? TITRES_FICHIER.illisible),
          el('p', { role: 'alert' }, MESSAGES_FICHIER[etat.code] ?? MESSAGES_FICHIER.illisible),
          etat.code === 'recettes'
            ? el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/import' }, 'Ajouter des recettes')
            : null,
        )];
      case 'contenu': {
        const n = etat.erreurs.length;
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(n > 1 ? `${n}\u00A0points empêchent la restauration` : '1\u00A0point empêche la restauration'),
          el('ul', { class: 'liste-erreurs', role: 'alert' }, etat.erreurs.map((message) => el('li', {}, `⚠️ ${message}`))),
        )];
      }
      case 'reseau':
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat('Pas de réseau'),
          el('p', { role: 'alert' }, MESSAGE_RESEAU),
          el('button', {
            class: 'bouton bouton-principal bouton-plein',
            type: 'button',
            'data-cle': 'reessayer',
            onclick: () => { if (!occupe) chargerApercu(); },
          }, 'Réessayer'),
        )];
      case 'aJour':
        return [el('section', { class: 'carte resultat-pret' },
          titreResultat('Tout est déjà à jour'),
          el('p', {}, 'L’app contient déjà tout ce qui est dans ce fichier.'),
        )];
      default:
        return [renduApercu(enLigne)];
    }
  }

  function renduApercu(enLigne) {
    const { resume = {}, recettesDifferentes = [] } = preparation;
    const date = versDate(resume.date) ?? versDate(validation?.date);

    // Ce qui revient
    const platsRemis = resume.platsRemis ?? [];
    const profilsRemis = resume.profilsRemis ?? [];
    const revient = [
      platsRemis.length
        ? `➕ ${pluriel(platsRemis.length, 'plat remis', 'plats remis')}\u00A0: ${platsRemis.join(', ')}`
        : null,
      resume.notesRemises
        ? `⭐ ${pluriel(resume.notesRemises, 'note remise', 'notes remises')}, sur des plats pas encore notés dans l’app`
        : null,
      profilsRemis.length
        ? `👤 ${pluriel(profilsRemis.length, 'profil remis', 'profils remis')}\u00A0: ${profilsRemis.join(', ')}`
        : null,
      resume.datesRemises
        ? `🗓️ ${pluriel(resume.datesRemises, 'date de dernier passage au menu remise', 'dates de dernier passage au menu remises')}`
        : null,
      // Règles revenues sur un profil présent qui n'en avait jamais eu (coeur/sauvegarde.js : liste des prénoms).
      ...(resume.reglesRemises ?? []).map((nom) => `🍽️ Ce que ${nom} mange revient.`),
    ].filter(Boolean);

    // Ce qui ne change pas
    const identiques = resume.identiques ?? 0;
    const ajoutes = resume.ajoutesDepuis ?? 0;
    const gardes = ['Les notes déjà posées', 'les profils actuels', 'les photos'];
    if (ajoutes === 1) gardes.push('le plat ajouté depuis');
    else if (ajoutes) gardes.push(`les ${ajoutes}\u00A0plats ajoutés depuis`);
    const derniers = gardes.pop();
    const neChangePas = [
      identiques ? `${pluriel(identiques, 'plat identique', 'plats identiques')}.` : null,
      `${gardes.join(', ')} et ${derniers} restent tels quels.`,
    ].filter(Boolean).join(' ');

    // Ceux de la validation du fichier sont déjà en tête de ceux de la restauration.
    const avertissements = (preparation.avertissements ?? []).map(texteDe).filter(Boolean);

    const toutes = recettesDifferentes.length > 0 && recettesDifferentes.every((r) => coches.has(r.id));

    let action;
    if (!enLigne) {
      action = el('p', { class: 'message-reseau', role: 'status' }, MESSAGE_RESEAU);
    } else if (preparation.rien || !nombreEcritures(preparation)) {
      action = el('p', { class: 'texte-doux', role: 'status' },
        'Rien ne manque. Cochez une recette pour reprendre sa version sauvegardée.');
    } else {
      action = el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        'data-cle': 'restaurer',
        'aria-busy': restauration ? 'true' : null,
        'aria-disabled': restauration ? 'true' : null,
        onclick: restaurer,
      }, restauration ? 'Restauration…' : 'Restaurer');
    }

    return el('section', { class: 'carte resultat-pret apercu-restauration' },
      titreResultat(date ? `Sauvegarde du ${dateEtHeure(date)}` : 'Sauvegarde'),

      revient.length
        ? el('div', { class: 'apercu-bloc' },
          el('h3', {}, 'Ce qui revient'),
          el('ul', { class: 'liste-revient' }, revient.map((ligne) => el('li', {}, ligne))))
        : null,

      recettesDifferentes.length
        ? el('div', { class: 'apercu-bloc' },
          el('h3', {}, 'Recettes différentes de la sauvegarde'),
          el('p', { class: 'texte-doux' }, 'Cochez celles qui doivent reprendre leur version sauvegardée.'),
          recettesDifferentes.length >= TOUT_COCHER_DES
            ? el('button', {
              class: 'bouton bouton-texte bouton-tout-cocher',
              type: 'button',
              'data-cle': 'tout-cocher',
              disabled: restauration,
              onclick: toutCocher,
            }, toutes ? 'Tout décocher' : 'Tout cocher')
            : null,
          el('ul', { class: 'cases-recettes' }, recettesDifferentes.map((recette) => {
            const modifiee = versDate(recette.modifieeLe);
            let detail;
            if (recette.appEnAttente) detail = '⏳ Recette à ajouter dans l’app\u00A0: la sauvegarde l’a';
            else if (modifiee) detail = `Modifiée à la main le ${jourCourt(modifiee)}`;
            else detail = 'Changée depuis la sauvegarde';
            const idCase = `recette-${recette.id}`;
            return el('li', {},
              el('label', { class: 'case-recette', for: idCase },
                el('input', {
                  type: 'checkbox',
                  id: idCase,
                  'data-cle': idCase,
                  checked: coches.has(recette.id),
                  disabled: restauration,
                  onchange: (evenement) => cocher(recette.id, evenement.target.checked),
                }),
                el('span', { class: 'case-recette-texte' },
                  el('span', { class: 'case-recette-nom' }, recette.nom),
                  el('span', { class: 'case-recette-detail' }, detail),
                ),
              ));
          })))
        : null,

      el('div', { class: 'apercu-bloc' },
        el('h3', {}, 'Ce qui ne change pas'),
        el('p', { class: 'texte-doux' }, neChangePas)),

      avertissements.length
        ? el('ul', { class: 'liste-avertissements' }, avertissements.map((m) => el('li', {}, `⚠️ ${m}`)))
        : null,

      coches.size
        ? el('p', { class: 'aide' },
          'Les recettes cochées sont remplacées. Leur version actuelle est d’abord téléchargée sur ce téléphone, par précaution.')
        : null,

      messageAction
        ? el('p', {
          class: messageAction.alerte ? 'message-erreur message-action' : 'aide',
          role: 'alert',
          tabindex: '-1',
          'data-message-action': '',
        }, messageAction.texte)
        : null,

      action,
    );
  }

  dessiner();

  return {
    noeud: el('div', { class: 'vue restaurer' },
      retour,
      el('header', { class: 'vue-entete' }, el('h1', {}, 'Restaurer une sauvegarde')),
      el('p', { class: 'texte-doux' },
        'Ce qui est dans l’app reste. Ce qui manque revient. Les recettes que vous cochez reprennent leur version sauvegardée.'),
      boutonChoisir,
      messageHorsLigne,
      resultat,
    ),
    maj(nouveau) {
      courant = nouveau;
      // Seul le réseau change l'affichage : l'aperçu part des données lues sur le serveur.
      dessiner();
    },
    detruire() {
      detruit = true;
    },
  };
}
