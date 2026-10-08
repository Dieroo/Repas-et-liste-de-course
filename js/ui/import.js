// Écran « Ajouter des recettes » (gestionnaire) : coller la réponse de Claude ou choisir un fichier, aperçu,
// enregistrement (CLAUDE.md §8). Le texte lu n'est jamais affiché : il contient des mots techniques (§4). Seul
// l'aperçu l'est. Un fichier suit exactement le chemin du collage ; seuls son plafond et ses messages changent.
import { el, annoncer } from './dom.js';
import { copier, lirePressePapiers, lectureBloquee } from './presse-papiers.js';
import { choisirFichier, lireTexte } from './fichier.js';
import {
  extrairePaquet, validerPaquet, preparerImport, filtrerPreparation, estSauvegarde, controlerInstructions,
} from '../coeur/paquet.js';
import { texteCorrectionPourClaude } from '../coeur/claude.js';
import { FICHIER_MAX } from '../coeur/sauvegarde.js';

// Claude refuse une demande écrite pour d'autres instructions que les siennes (docs/projet-claude.md §0) : mêmes
// messages pour un collage et pour un fichier.
const MESSAGES_ALIGNEMENT = {
  instructions: 'Claude signale que ses instructions ne sont plus à jour. Recopiez-les depuis Réglages › Projet Claude, puis renvoyez la demande dans une nouvelle conversation.',
  app: 'Claude signale que votre app n’est pas à jour. Fermez puis rouvrez l’app, puis recopiez la demande.',
};

const TITRES_ALIGNEMENT = {
  instructions: 'Instructions à mettre à jour',
  app: 'App à mettre à jour',
};

const MESSAGES_EXTRACTION = {
  vide: 'Rien à coller. Dans l’app Claude, copiez toute la réponse, puis revenez ici.',
  trop_long: 'Ce texte est trop long pour être une réponse de Claude.',
  demande: 'C’est votre demande, pas la réponse de Claude. Collez-la dans votre projet Claude, puis copiez sa réponse.',
  coupee: 'La recette semble coupée ou abîmée. Copiez toute la réponse de Claude, jusqu’à la fin.',
  aucune: 'Aucune recette trouvée dans ce texte. Copiez toute la réponse de Claude.',
  ...MESSAGES_ALIGNEMENT,
};

const TITRES_EXTRACTION = {
  vide: 'Rien à coller',
  trop_long: 'Texte trop long',
  demande: 'Ce n’est pas encore la réponse',
  coupee: 'Recette illisible',
  aucune: 'Aucune recette trouvée',
  ...TITRES_ALIGNEMENT,
};

// Messages d'un fichier choisi (les codes de lecture du fichier s'ajoutent à ceux de l'extraction).
const MESSAGES_FICHIER = {
  vide: 'Ce fichier est vide.',
  trop_long: 'Ce fichier est trop gros pour l’app.',
  illisible: 'Ce fichier n’a pas pu être lu.',
  demande: 'Ce fichier contient votre demande, pas la réponse de Claude.',
  coupee: 'Ce fichier semble coupé ou abîmé.',
  aucune: 'Aucune recette trouvée dans ce fichier.',
  ...MESSAGES_ALIGNEMENT,
};

const TITRES_FICHIER = {
  vide: 'Fichier vide',
  trop_long: 'Fichier trop gros',
  illisible: 'Fichier illisible',
  demande: 'Ce n’est pas encore la réponse',
  coupee: 'Fichier abîmé',
  aucune: 'Aucune recette trouvée',
  ...TITRES_ALIGNEMENT,
};

const LIBELLES_STATUT = {
  nouveau: 'Nouveau plat',
  complete: 'Complète la recette ⏳',
  remplace: 'Remplace la recette actuelle',
  inchange: 'Recette inchangée',
  versions: 'Recette gardée',
  identique: 'Déjà dans l’app',
  deja: 'Déjà dans vos plats',
};

/**
 * Éléments de l'aperçu qui n'écrivent rien : recette identique à la fiche, ou idée de Claude (DEMANDE-IDEES) pour un
 * plat qui a déjà sa recette (`deja` : son avertissement le dit, elle n'est pas reprise).
 */
const sansEcriture = (element) => element.statut === 'identique' || element.statut === 'deja';

// Fiche complète reçue, différente de la recette actuelle, avec des versions : ce que l'on en prend.
const CHOIX = [
  { valeur: 'version', libelle: 'Ne prendre que sa version', aide: 'La recette actuelle est gardée.' },
  { valeur: 'remplacer', libelle: 'Remplacer la recette', aide: 'La recette de Claude prend sa place.' },
];

const MESSAGE_HORS_LIGNE_VERSIONS = 'Il faut être connecté pour ajouter des versions.';

const MESSAGE_COPIE = 'Copié. Collez-le dans votre projet Claude, puis collez ici sa nouvelle réponse.';
// Aperçu prêt avec des versions à corriger : un nouveau collage remplacerait l'aperçu, et les autres versions du lot,
// jamais enregistrées, seraient perdues.
const MESSAGE_COPIE_ENREGISTRER = 'Copié. Touchez d’abord «\u00A0Enregistrer\u00A0»\u00A0: les autres versions seront gardées. Collez ensuite le texte dans votre projet Claude, et sa réponse dans «\u00A0Ajouter des recettes\u00A0».';

const pluriel = (n, singulier, plurielTexte) => `${n}\u00A0${n > 1 ? plurielTexte : singulier}`;

/**
 * Recette qui remplace une fiche modifiée à la main (« Modifier ») : `modifieeA` donne la date en secondes, ou
 * true tant que la modification n'est pas confirmée par le serveur. Date au fuseau du téléphone.
 */
function avertissementModification(modifieeA) {
  if (typeof modifieeA === 'number') {
    const date = new Date(modifieeA * 1000);
    if (!Number.isNaN(date.getTime())) {
      const jour = date.getDate();
      const mois = date.toLocaleDateString('fr-FR', { month: 'long' });
      return `Remplace les modifications faites à la main le ${jour === 1 ? '1er' : jour} ${mois}.`;
    }
  }
  return modifieeA ? 'Remplace des modifications faites à la main.' : null;
}

/**
 * Ce qu'un enregistrement écrit : `recettes` (fiches complètes) et `versions` (versions seules, une par profil et par
 * plat). `ecritures` : celles de la préparation (déjà filtrée des plats décochés).
 */
export function compterEcritures(ecritures) {
  let recettes = 0;
  let versions = 0;
  for (const ecriture of ecritures ?? []) {
    if (ecriture?.mode === 'versions') versions += Array.isArray(ecriture.variantes) ? ecriture.variantes.length : 0;
    else recettes += 1;
  }
  return { recettes, versions };
}

/**
 * Bouton d'enregistrement : « Enregistrer 9 versions », « Enregistrer les 3 recettes », « Enregistrer 2 recettes et
 * 5 versions », ou seulement des demandes restées ouvertes à clore.
 */
export function libelleEnregistrer({ recettes = 0, versions = 0 }, aClore = 0) {
  if (recettes && versions) {
    return `Enregistrer ${pluriel(recettes, 'recette', 'recettes')} et ${pluriel(versions, 'version', 'versions')}`;
  }
  if (versions) return versions > 1 ? `Enregistrer ${versions}\u00A0versions` : 'Enregistrer la version';
  if (recettes) return recettes > 1 ? `Enregistrer les ${recettes}\u00A0recettes` : 'Enregistrer la recette';
  return aClore > 1 ? 'Marquer les recettes comme ajoutées' : 'Marquer la recette comme ajoutée';
}

export function creer(ctx) {
  let courant = ctx;
  const cible = ctx.parametre || null;
  let texte = ''; // dernier texte collé ou lu dans un fichier
  let colle = false; // vrai dès qu'un collage ou un fichier choisi a eu lieu (même vide)
  let source = 'collage'; // origine du texte : 'collage' ou 'fichier'
  let erreurFichier = null; // lecture du fichier refusée : 'trop_gros' ou 'illisible'
  let lectureEnCours = false; // fichier en cours de lecture : un second fichier choisi entre-temps est ignoré
  let minuteurSaisie = null;
  let signature = ''; // évite de reconstruire (et de réannoncer) un aperçu identique
  let preparation = null; // écritures prêtes (plats décochés retirés), si l'aperçu est valide
  let decoches = new Set(); // plats décochés dans l'aperçu : rien ne s'écrit pour eux
  let choix = {}; // { platId: 'version' | 'remplacer' } choisi dans l'aperçu
  let messageEnvoi = ''; // refus d'enregistrer (hors ligne, versions)
  let copieFaite = false;
  let enregistre = false;
  let focaliserResultat = false;

  const sousTitre = el('p', { class: 'sous-titre' });
  const retour = el('a', { class: 'retour', onclick: revenir }, el('span', { 'aria-hidden': 'true' }, '‹'), el('span', { class: 'retour-texte' }));

  const boutonColler = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    onclick: collerDepuisPressePapiers,
  }, '📋 Coller la réponse de Claude');

  const boutonFichier = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    'aria-describedby': 'aide-fichier',
    onclick: choisirUnFichier,
  }, '📄 Choisir un fichier');
  const aideFichier = el('p', { class: 'aide', id: 'aide-fichier' },
    'Un fichier de recettes, par exemple le catalogue de départ.');

  const aideBlocage = el('p', { class: 'message-erreur', id: 'aide-blocage', hidden: true },
    'Le téléphone bloque la lecture du presse-papiers. Collez à la main\u00A0: touchez longuement la zone ci-dessous, puis «\u00A0Coller\u00A0». ',
    'Pour réactiver le bouton\u00A0: Chrome › Paramètres › Paramètres des sites › Presse-papiers.');

  const zoneTexte = el('textarea', {
    class: 'champ zone-collage',
    id: 'texte-colle',
    rows: '5',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    'aria-describedby': 'aide-blocage aide-collage',
    // Le texte peut arriver en plusieurs morceaux : on analyse une fois la saisie terminée.
    oninput: () => {
      clearTimeout(minuteurSaisie);
      minuteurSaisie = setTimeout(() => analyser(zoneTexte.value, { manuel: true }), 300);
    },
  });
  const collageManuel = el('details', { class: 'collage-manuel' },
    el('summary', {}, 'Coller à la main'),
    el('label', { class: 'etiquette-champ', for: 'texte-colle' }, 'Réponse de Claude'),
    el('p', { class: 'aide', id: 'aide-collage' }, 'Touchez longuement la zone, puis «\u00A0Coller\u00A0».'),
    zoneTexte,
  );

  const texteLigneCollee = el('span', {}, '✓ Réponse collée');
  const ligneCollee = el('div', { class: 'ligne-collee', hidden: true },
    texteLigneCollee,
    el('button', { class: 'bouton bouton-texte', type: 'button', onclick: effacer }, 'Effacer'),
  );

  const resultat = el('div', { class: 'resultat-import' });
  // Gardée d'un rendu à l'autre : seul son affichage suit le réseau.
  const noteHorsLigne = el('p', { class: 'aide' },
    'Hors ligne\u00A0: la recette est gardée sur ce téléphone et sera partagée au retour du réseau.');

  function platCible() {
    return cible ? courant.plats.find((plat) => plat.id === cible) ?? null : null;
  }

  function revenir(evenement) {
    // Venu de cet écran-là : retour dans l'historique, pour que le geste retour d'Android reste naturel.
    const attendu = cible ? 'plat' : 'plats';
    if (courant.routePrecedente === attendu && history.length > 1) {
      evenement.preventDefault();
      history.back();
    }
  }

  function majEntete() {
    const plat = platCible();
    sousTitre.textContent = plat
      ? `Recette de «\u00A0${plat.nom}\u00A0»`
      : 'Collez la réponse de votre projet Claude.';
    retour.href = plat ? `#/plat/${encodeURIComponent(plat.id)}` : '#/plats';
    retour.querySelector('.retour-texte').textContent = plat ? plat.nom : 'Plats';
  }

  async function collerDepuisPressePapiers() {
    clearTimeout(minuteurSaisie);
    const lu = await lirePressePapiers();
    if (lu.refus) {
      aideBlocage.hidden = false;
      collageManuel.open = true;
      zoneTexte.focus();
      return;
    }
    analyser(lu.texte, { manuel: false });
  }

  /** Fichier choisi : son texte suit le chemin du collage, avec le plafond d'un fichier. */
  async function choisirUnFichier() {
    clearTimeout(minuteurSaisie);
    // Le sélecteur n'est pas verrouillé : sans événement « cancel » (anciens Chrome), le bouton resterait bloqué.
    const fichier = await choisirFichier();
    if (!fichier || lectureEnCours) return;
    lectureEnCours = true;
    let lu;
    try {
      lu = await lireTexte(fichier, FICHIER_MAX);
    } finally {
      lectureEnCours = false;
    }
    source = 'fichier';
    erreurFichier = lu.erreur ?? null;
    texte = lu.texte ?? '';
    colle = true;
    zoneTexte.value = '';
    oublierChoix();
    copieFaite = false;
    enregistre = false;
    signature = '';
    focaliserResultat = true;
    dessiner();
  }

  /** Nouveau texte : cases et choix de l'aperçu précédent oubliés. */
  function oublierChoix() {
    decoches = new Set();
    choix = {};
    messageEnvoi = '';
  }

  function effacer() {
    clearTimeout(minuteurSaisie);
    oublierChoix();
    texte = '';
    colle = false;
    source = 'collage';
    erreurFichier = null;
    zoneTexte.value = '';
    signature = '';
    dessiner();
    boutonColler.focus();
  }

  function analyser(nouveau, { manuel }) {
    texte = nouveau ?? '';
    source = 'collage';
    erreurFichier = null;
    // Zone vidée à la main : rien à montrer. Presse-papiers vide : on le dit.
    colle = !manuel || Boolean(texte.trim());
    oublierChoix();
    copieFaite = false;
    enregistre = false;
    signature = '';
    focaliserResultat = !manuel || Boolean(extrairePaquet(texte).paquets);
    dessiner();
  }

  /** Calcule l'aperçu ; ne reconstruit l'affichage que s'il a changé. */
  function dessiner() {
    majEntete();
    noteHorsLigne.hidden = navigator.onLine;
    const etat = calculer();
    const nouvelleSignature = JSON.stringify([etat, copieFaite, [...decoches], choix, messageEnvoi, navigator.onLine]);
    if (nouvelleSignature === signature) return;
    signature = nouvelleSignature;
    preparation = etat.type === 'pret' ? filtrerPreparation(etat.preparation, decoches) : null;

    // Un texte collé, lisible ou non, disparaît de l'écran : il contient des mots techniques (§4).
    const traite = etat.type !== 'rien' && !(etat.type === 'illisible' && etat.code === 'vide');
    ligneCollee.hidden = !traite;
    texteLigneCollee.textContent = source === 'fichier' ? '✓ Fichier lu' : '✓ Réponse collée';
    if (traite) {
      zoneTexte.value = '';
      collageManuel.open = false;
    }
    // Une recette lue : l'explication du presse-papiers bloqué n'a plus lieu d'être.
    if (['pret', 'erreurs', 'chargement', 'sauvegarde'].includes(etat.type) || source === 'fichier') aideBlocage.hidden = true;

    // Le bouton qui avait le focus (copie, enregistrement) le retrouve après la reconstruction ; sinon le titre.
    const actif = resultat.contains(document.activeElement) ? document.activeElement.dataset.action ?? 'titre' : null;
    resultat.replaceChildren(...rendu(etat));
    const titre = resultat.querySelector('[data-titre-resultat]');
    if (focaliserResultat) {
      focaliserResultat = false;
      titre?.focus();
    } else if (actif) {
      (resultat.querySelector(`[data-action="${actif}"]`) ?? titre)?.focus({ preventScroll: true });
    }
  }

  function calculer() {
    if (!colle) return { type: 'rien' };
    if (erreurFichier) return { type: 'illisible', code: erreurFichier === 'trop_gros' ? 'trop_long' : 'illisible' };
    const extrait = extrairePaquet(texte, source === 'fichier' ? { max: FICHIER_MAX } : undefined);
    if (extrait.erreur) return { type: 'illisible', code: extrait.erreur };
    // Une sauvegarde passe par Réglages › Restaurer : ici, elle effacerait les marques « modifiée à la main » et
    // pourrait recréer en double un plat renommé depuis.
    if (estSauvegarde(extrait.paquets)) return { type: 'sauvegarde' };
    const validation = validerPaquet(extrait.paquets, { profils: courant.profilsCharges ? courant.profils : null });
    if (!validation.valide) return { type: 'erreurs', validation };
    // Sans les plats et les demandes, un plat déjà présent passerait pour nouveau : on attend leur chargement.
    // Sans les profils, une version ne peut pas être jugée.
    if (!courant.platsCharges || !courant.demandesChargees || !courant.profilsCharges) return { type: 'chargement' };
    const prepares = preparerImport(validation.plats.map((plat) => plat.donnees), {
      plats: courant.plats,
      demandes: courant.demandes,
      cible,
      profils: courant.profils,
      choix,
    });
    // Plats gardés sans leurs erreurs (ils n'en ont pas) : la correction pour Claude sait si le lot était de versions.
    if (prepares.erreurs.length) {
      return { type: 'erreurs', validation: { ...validation, plats: validation.plats.map((plat) => ({ ...plat, erreurs: [] })), erreurs: prepares.erreurs } };
    }
    // Réponse écrite avec d'autres instructions que celles de l'app : prévenu, sans bloquer (message seul).
    const instructions = controlerInstructions(extrait.paquets)?.message ?? null;
    return { type: 'pret', validation, preparation: prepares, instructions };
  }

  function titreResultat(texteTitre) {
    return el('h2', { tabindex: '-1', 'data-titre-resultat': '' }, texteTitre);
  }

  function boutonCopierCorrections(probleme, { secondaire = false, message = MESSAGE_COPIE } = {}) {
    return el('button', {
      class: `bouton ${secondaire ? 'bouton-secondaire' : 'bouton-principal'} bouton-plein`,
      type: 'button',
      'data-action': 'copier-corrections',
      onclick: async () => {
        const reussi = await copier(texteCorrectionPourClaude(probleme));
        if (reussi) {
          copieFaite = true;
          dessiner();
          annoncer(message);
        } else {
          annoncer('La copie n’a pas marché. Réessayez.');
        }
      },
    }, '📋 Copier les corrections pour Claude');
  }

  const messageCopie = (message = MESSAGE_COPIE) => el('p', { class: 'aide' }, message);

  function rendu(etat) {
    switch (etat.type) {
      case 'rien':
        return [];
      case 'illisible': {
        const corrigeable = etat.code === 'coupee';
        const titres = source === 'fichier' ? TITRES_FICHIER : TITRES_EXTRACTION;
        const messages = source === 'fichier' ? MESSAGES_FICHIER : MESSAGES_EXTRACTION;
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(titres[etat.code] ?? titres.aucune),
          el('p', { role: 'alert' }, messages[etat.code] ?? messages.aucune),
          etat.code === 'instructions'
            ? el('a', { class: 'bouton bouton-principal bouton-plein', href: '#/reglages', 'data-action': 'reglages' },
              'Ouvrir Réglages')
            : null,
          corrigeable ? boutonCopierCorrections({ erreur: etat.code }) : null,
          corrigeable && copieFaite ? messageCopie() : null,
        )];
      }
      case 'sauvegarde':
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat('C’est une sauvegarde'),
          el('p', { role: 'alert' },
            'C’est une sauvegarde\u00A0: pour la remettre, utilisez Réglages › Restaurer une sauvegarde.'),
          el('a', {
            class: 'bouton bouton-principal bouton-plein',
            href: '#/restaurer',
            'data-action': 'restaurer',
          }, 'Restaurer une sauvegarde'),
        )];
      case 'chargement':
        return [el('section', { class: 'carte' },
          titreResultat('Recette lue'),
          el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des plats…'),
          el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', disabled: true }, 'Enregistrer'),
        )];
      case 'erreurs': {
        const { validation } = etat;
        const messages = [
          ...validation.erreurs.map((e) => e.message),
          ...validation.plats.flatMap((plat) => plat.erreurs.map((e) => e.message)),
        ];
        return [el('section', { class: 'carte resultat-erreur' },
          titreResultat(messages.length > 1 ? `${messages.length} points à corriger` : '1 point à corriger'),
          el('ul', { class: 'liste-erreurs', role: 'alert' }, messages.map((message) => el('li', {}, `⚠️ ${message}`))),
          boutonCopierCorrections(validation),
          copieFaite ? messageCopie() : null,
        )];
      }
      default:
        return [renduPret(etat)];
    }
  }

  /** Case « l'enregistrer » d'un plat de l'aperçu (lot de plusieurs écritures). */
  function caseDuPlat(element) {
    const idCase = `garder-${element.id}`;
    return el('label', { class: 'case-apercu', for: idCase },
      el('input', {
        type: 'checkbox',
        id: idCase,
        'data-action': idCase,
        checked: !decoches.has(element.id),
        onchange: (evenement) => {
          if (evenement.target.checked) decoches.delete(element.id);
          else decoches.add(element.id);
          messageEnvoi = '';
          dessiner();
        },
      }),
      el('span', { class: 'visuellement-masque' }, `Enregistrer «\u00A0${element.nom}\u00A0»`));
  }

  /** « Ne prendre que sa version » / « Remplacer la recette » pour une fiche complète différente de l'actuelle. */
  function choixDuPlat(element) {
    const nom = `choix-${element.id}`;
    return el('fieldset', { class: 'groupe-choix choix-cartes choix-import' },
      el('legend', { class: 'etiquette-champ' }, 'Claude a aussi changé la recette'),
      CHOIX.map(({ valeur, libelle, aide }) => el('label', { class: 'choix-carte' },
        el('input', {
          type: 'radio',
          name: nom,
          value: valeur,
          'data-action': `${nom}-${valeur}`,
          checked: element.choix.retenu === valeur,
          onchange: () => {
            choix = { ...choix, [element.id]: valeur };
            messageEnvoi = '';
            dessiner();
          },
        }),
        el('span', { class: 'choix-carte-texte' },
          el('span', { class: 'choix-carte-libelle' }, libelle),
          el('span', { class: 'choix-carte-aide' }, aide)),
        el('span', { class: 'choix-carte-coche', 'aria-hidden': 'true' }, '✓'))));
  }

  /**
   * Plat validé d'où vient un élément de l'aperçu : par sa position dans le collage (`index`, posé par
   * preparerImport) ; à défaut, même rang s'il n'en manque aucun, puis même identifiant, puis même nom.
   */
  function validationDe(validation, elements, element, i) {
    if (Number.isInteger(element.index) && validation.plats[element.index]) return validation.plats[element.index];
    if (validation.plats.length === elements.length) return validation.plats[i];
    return validation.plats.find((plat) => plat.donnees?.id === element.id)
      ?? validation.plats.find((plat) => plat.donnees?.nom === element.nom) ?? null;
  }

  /** Ligne de détail d'un plat de l'aperçu. */
  function detailDuPlat(element) {
    if (element.statut === 'identique') return 'Identique à la fiche actuelle.';
    if (['versions', 'inchange', 'deja'].includes(element.statut)) return 'La recette actuelle est gardée.';
    if (!element.ingredients) return 'Sans recette pour l’instant (⏳)';
    return [pluriel(element.ingredients, 'ingrédient', 'ingrédients'), element.etapes ? pluriel(element.etapes, 'étape', 'étapes') : null]
      .filter(Boolean).join(' · ');
  }

  function renduPret({ validation, preparation: prepares, instructions }) {
    // Une idée déjà dans les plats n'est pas reprise : elle ne compte pas parmi les recettes prêtes.
    const deja = prepares.elements.filter((element) => element.statut === 'deja').length;
    const n = prepares.elements.length - deja;
    const ecrivables = prepares.elements.filter((element) => !sansEcriture(element));
    const filtree = preparation ?? prepares;
    const comptes = compterEcritures(filtree.ecritures);
    const aEcrire = comptes.recettes + comptes.versions;
    const aClore = aEcrire ? 0 : filtree.demandesAClore.length;
    // Cases seulement pour un lot : décocher le seul plat collé reviendrait à ne rien enregistrer.
    const avecCases = ecrivables.length > 1;
    const versionsSeules = ecrivables.length > 0 && ecrivables.every((element) => element.statut === 'versions');
    const avecVersions = filtree.ecritures.some((ecriture) => ecriture.mode === 'versions');
    const horsLigne = !navigator.onLine && avecVersions;
    // La version des instructions d'abord ; jamais dans le texte « Copier les corrections pour Claude ».
    const avertissementsGeneraux = [
      instructions,
      ...[...validation.avertissements, ...prepares.avertissements].map((a) => a.message),
    ].filter(Boolean);
    let titre;
    if (!ecrivables.length && deja) {
      if (n) titre = 'Ces recettes sont déjà dans l’app.';
      else titre = deja > 1 ? 'Ces idées sont déjà dans vos plats.' : 'Cette idée est déjà dans vos plats.';
    } else if (!ecrivables.length) titre = n > 1 ? 'Ces recettes sont déjà dans l’app, à l’identique.' : 'Cette recette est déjà dans l’app, à l’identique.';
    else if (versionsSeules) {
      const versions = ecrivables.reduce((total, element) => total + (element.versions?.length ?? 0), 0);
      titre = versions > 1 ? `${versions}\u00A0versions prêtes` : '1\u00A0version prête';
    } else titre = n > 1 ? `${n}\u00A0recettes prêtes` : '1 recette prête';
    const corrections = filtree.corrections ?? [];
    return el('section', { class: 'carte resultat-pret' },
      titreResultat(titre),
      avertissementsGeneraux.length
        ? el('ul', { class: 'liste-avertissements' }, avertissementsGeneraux.map((m) => el('li', {}, `⚠️ ${m}`)))
        : null,
      el('ul', { class: 'liste-apercu' }, prepares.elements.map((element, i) => {
        const identique = sansEcriture(element);
        const nonReprise = element.statut === 'deja';
        const garde = !decoches.has(element.id);
        // Idée non reprise : seul son avertissement compte (ceux de sa recette, jamais écrite, n'ont plus d'objet).
        const avertissements = [
          identique || element.statut === 'versions' ? null : avertissementModification(element.modifieeA),
          ...(nonReprise ? [] : (validationDe(validation, prepares.elements, element, i)?.avertissements ?? []).map((a) => a.message)),
          ...(element.avertissements ?? []),
        ].filter(Boolean);
        return el('li', { class: `apercu-plat${avecCases && !identique ? ' avec-case' : ''}${garde ? '' : ' decoche'}` },
          avecCases && !identique ? caseDuPlat(element) : null,
          el('div', { class: 'apercu-corps' },
            el('p', { class: 'apercu-nom' }, element.nom),
            el('p', { class: 'badges' }, el('span', { class: `badge badge-${element.statut}` }, LIBELLES_STATUT[element.statut] ?? '')),
            element.ancienNom && !nonReprise ? el('p', { class: 'texte-doux' }, `Renommé\u00A0: «\u00A0${element.ancienNom}\u00A0» → «\u00A0${element.nom}\u00A0»`) : null,
            !nonReprise && (element.versions ?? []).length
              ? el('ul', { class: 'apercu-versions' }, element.versions.map((version) => el('li', {
                class: version.convient ? 'compat-version' : 'compat-discret',
              }, version.libelle)))
              : null,
            el('p', { class: 'texte-doux' }, detailDuPlat(element)),
            element.choix && !nonReprise ? choixDuPlat(element) : null,
            avertissements.length
              ? el('ul', { class: 'liste-avertissements' }, avertissements.map((m) => el('li', {}, `⚠️ ${m}`)))
              : null,
            garde ? null : el('p', { class: 'texte-doux' }, 'Ne sera pas enregistré.'),
          ),
        );
      })),
      // Versions importées qui ne conviennent pas encore : la demande reste ouverte, Claude peut les corriger.
      // Rien encore d'enregistré : la consigne dit d'enregistrer avant de coller la réponse corrigée.
      corrections.length ? boutonCopierCorrections({ corrections }, { secondaire: true, message: aEcrire ? MESSAGE_COPIE_ENREGISTRER : MESSAGE_COPIE }) : null,
      corrections.length && copieFaite ? messageCopie(aEcrire ? MESSAGE_COPIE_ENREGISTRER : MESSAGE_COPIE) : null,
      messageEnvoi ? el('p', { class: 'message-erreur', role: 'alert' }, messageEnvoi) : null,
      // Toutes identiques : rien à enregistrer, sauf une demande de recette restée ouverte, à clore. Tout décoché :
      // le bouton reste, inactif.
      ecrivables.length || aClore
        ? el('button', {
          class: 'bouton bouton-principal bouton-plein',
          type: 'button',
          'data-action': 'enregistrer',
          disabled: (!aEcrire && !aClore) || horsLigne,
          onclick: enregistrer,
        }, aEcrire || aClore ? libelleEnregistrer(comptes, aClore) : 'Rien de coché')
        : null,
      horsLigne ? el('p', { class: 'aide' }, 'Hors ligne\u00A0: il faut être connecté pour ajouter des versions.') : null,
      !horsLigne && comptes.recettes ? noteHorsLigne : null,
    );
  }

  function enregistrer() {
    if (!preparation || enregistre || (!preparation.ecritures.length && !preparation.demandesAClore.length)) return;
    const { ecritures } = preparation;
    const comptes = compterEcritures(ecritures);
    // Versions : une transaction par plat, impossible hors ligne. Rien ne part, l'aperçu reste.
    if (comptes.versions && !navigator.onLine) {
      messageEnvoi = MESSAGE_HORS_LIGNE_VERSIONS;
      dessiner();
      annoncer(MESSAGE_HORS_LIGNE_VERSIONS);
      return;
    }
    enregistre = true;
    // L'annonce des versions (combien, combien restent) suit leur envoi (actions.importer) ; un échec est annoncé là.
    Promise.resolve(courant.actions.importer(preparation)).catch((erreur) => {
      if (erreur?.code === 'hors_ligne') annoncer(MESSAGE_HORS_LIGNE_VERSIONS);
    });
    if (!ecritures.length) annoncer('Recette marquée comme ajoutée.');
    else if (comptes.recettes) annoncer(comptes.recettes > 1 ? `${comptes.recettes} recettes enregistrées.` : 'Recette enregistrée.');
    // Retour à l'écran d'où l'on vient (fiche ciblée, liste) : un pas en arrière, sans doublon dans l'historique.
    // Sinon, cet écran est remplacé : le geste retour ne ramène pas à un aperçu déjà enregistré.
    const origine = cible ? `#/plat/${encodeURIComponent(cible)}` : '#/plats';
    // Rien écrit (seulement une demande close) : retour d'où l'on vient.
    const destination = !ecritures.length ? origine
      : ecritures.length === 1 ? `#/plat/${encodeURIComponent(ecritures[0].id)}` : '#/plats';
    if (destination === origine && courant.routePrecedente === (cible ? 'plat' : 'plats') && history.length > 1) history.back();
    else location.replace(destination);
  }

  // Lecture déjà bloquée par le téléphone : la zone de collage s'ouvre d'emblée, avec l'explication.
  lectureBloquee().then((bloquee) => {
    if (!bloquee) return;
    aideBlocage.hidden = false;
    collageManuel.open = true;
  });

  dessiner();

  return {
    noeud: el('div', { class: 'vue import' },
      retour,
      el('header', { class: 'vue-entete' }, el('h1', {}, 'Ajouter des recettes'), sousTitre),
      boutonColler,
      aideBlocage,
      collageManuel,
      boutonFichier,
      aideFichier,
      ligneCollee,
      resultat,
    ),
    maj(nouveau) {
      courant = nouveau;
      dessiner();
    },
    detruire() {
      clearTimeout(minuteurSaisie);
    },
  };
}
