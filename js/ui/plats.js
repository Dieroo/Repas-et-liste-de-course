// Écran Plats : recherche, filtres, liste, ajout d'un plat par son nom ; bandeau « Personne n'en veut » et, en bas de
// la liste, la corbeille (« Remettre » pour les deux membres, « Vider la corbeille » pour le gestionnaire).
import { el, etatVide, pastille, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { modeDeCuisson } from './pictos.js';
import { copier } from './presse-papiers.js';
import {
  LIBELLES_TYPE, STATUTS, NOM_MAX, TYPES_A_ADAPTER, filtresPour, filtreRetenu, filtrerPlats, visuelDuPlat, statutDe, typeDe,
  aSaRecette,
} from '../coeur/plats.js';
import { profilsContraints, platsSansVersion } from '../coeur/compatibilite.js';
import { LOT_VERSIONS, texteDemandeVariantes } from '../coeur/claude.js';
import { ligneCompat, lignePrecautions, garderPour, nomDe, libellesStyles, rangerStyles } from './compat.js';
import { estNote, nombreANoter, resumeNotes } from '../coeur/notes.js';
import { platsSansPreneur, texteCorbeille } from '../coeur/corbeille.js';

// Gardés d'une visite à l'autre : revenir d'une fiche retrouve la même liste, au même endroit.
let recherche = '';
let filtre = 'tous';
let defilement = 0;

/** Vignette du plat, ou son emoji sur pastille teintée. */
export function vignetteDuPlat(plat, grande = false) {
  if (plat.vignette) {
    return el('img', {
      class: grande ? 'vignette grande' : 'vignette',
      src: plat.vignette,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
  }
  const { emoji, teinte } = visuelDuPlat(plat);
  return pastille(emoji, teinte, grande);
}

/**
 * Qui aime quoi : « Adulte A ❤️ Enfant 👎 Adulte B ★4 », un bloc insécable par profil, retour à la ligne entre deux
 * profils. Le texte lu dit aussi qui n'a pas encore noté. Rien si personne n'a noté.
 */
function ligneDeNotes(plat, profils) {
  const resume = resumeNotes(plat, profils);
  if (!resume) return null;
  return el('span', { class: 'carte-plat-notes' },
    resume.morceaux.map(({ texte }) => el('span', { class: 'note-profil', 'aria-hidden': 'true' }, texte)),
    el('span', { class: 'visuellement-masque' }, resume.accessible));
}

function carteDuPlat(plat, ctx) {
  const statut = statutDe(plat) !== 'validee' ? STATUTS[statutDe(plat)] : null;
  // « Plat · [pictogramme] Four · 📝 Recette à vérifier » : type, mode de cuisson principal, statut.
  const morceaux = [
    LIBELLES_TYPE[typeDe(plat)] ?? 'Plat',
    modeDeCuisson(plat),
    statut ? `${statut.emoji}\u00A0${statut.libelle}` : null,
  ].filter(Boolean);
  const detail = morceaux.flatMap((morceau, i) => (i ? [' · ', morceau] : [morceau]));
  return el('li', {},
    el('a', { class: 'carte-plat', href: `#/plat/${encodeURIComponent(plat.id)}`, 'data-cle': plat.id },
      vignetteDuPlat(plat),
      el('span', { class: 'carte-plat-texte' },
        el('span', { class: 'carte-plat-nom' }, plat.nom),
        el('span', { class: 'carte-plat-detail' }, detail),
        ligneDeNotes(plat, ctx.profils),
        ligneCompat(plat, ctx),
        // « 🧸 ❌ Pas avant 18 ans : alcool » : précautions selon l'âge, sous la ligne 🌿 / ❌ (les deux rôles).
        lignePrecautions(plat, ctx),
      ),
      el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
    ),
  );
}

/** Filtre « Pour <Prénom> » ou « Versions à créer » sans aucun plat. */
function etatVideCompat(choisi, moi) {
  if (choisi.profils) {
    const noms = choisi.profils.map(nomDe);
    const pour = noms.length === 1 ? noms[0] : noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : '';
    return el('div', { class: 'carte etat-vide compact' },
      el('p', {}, pour ? `Tous les plats ont une version pour ${pour}\u00A0` : 'Tous les plats ont leur version\u00A0',
        el('span', { 'aria-hidden': 'true' }, '🎉')));
  }
  return el('div', { class: 'carte etat-vide compact' },
    el('p', {}, moi && moi.id === choisi.profil.id ? 'Aucun plat pour vous ici.' : `Aucun plat pour ${nomDe(choisi.profil)} ici.`));
}

/**
 * Plats écartés des versions à créer ou à compléter parce que ce profil les a notés « Jamais » (même tri que
 * compatibilite.js › platsSansVersion, note mise à part).
 */
function nombreNotesJamais(plats, profil, evaluer) {
  if (typeof evaluer !== 'function' || typeof profil?.id !== 'string') return 0;
  return (plats ?? []).filter((plat) => TYPES_A_ADAPTER.includes(typeDe(plat))
    && aSaRecette(plat)
    && plat.notes && typeof plat.notes === 'object' && Object.hasOwn(plat.notes, profil.id) && plat.notes[profil.id] === 0
    && (() => {
      const resultat = evaluer(plat, profil);
      return Boolean(resultat?.aCreer || resultat?.aRevoir || resultat?.aCompleter);
    })()).length;
}

/**
 * Libellé du bouton de copie d'un lot : « les 10 premières », « les 3 versions », « sa version » ; « Compléter les 3
 * versions », « Compléter sa version » quand le lot ne contient que des plats à compléter (une version convient déjà).
 */
function libelleLot(nombre, aCompleterSeulement = false) {
  if (aCompleterSeulement) {
    if (nombre > LOT_VERSIONS) return `Compléter les ${LOT_VERSIONS} premières`;
    if (nombre > 1) return `Compléter les ${nombre}\u00A0versions`;
    return 'Compléter sa version';
  }
  if (nombre > LOT_VERSIONS) return `Demander à Claude les ${LOT_VERSIONS} premières`;
  if (nombre > 1) return `Demander à Claude les ${nombre}\u00A0versions`;
  return 'Demander à Claude sa version';
}

/**
 * Bandeau « Versions pour <Prénom> » (gestionnaire, filtre « ❌ Versions à créer ») : copie du lot des plats qui
 * attendent sa version (les mieux notés du foyer d'abord, ceux déjà envoyés à la fin), puis des plats à compléter
 * (une version convient, il en manque d'un style attendu), puis « Coller la réponse de Claude ». Nœuds gardés d'un
 * rendu à l'autre (le focus reste sur le bouton touché) ; `maj(ctx, profil)` les remet à jour. → { noeud, maj }
 */
function creerBandeauVersions(lireCtx) {
  let profil = null;
  let copie = false; // vrai après une copie réussie : « Coller la réponse » devient l'action principale
  // Dernier lot copié : recopié à l'identique tant que les plats en attente sont les mêmes (un second toucher, après
  // un collage raté dans Claude, ne doit pas copier un autre lot).
  let dernierLot = null; // { attente: signature des plats en attente, ids: [platId] }
  const titre = el('h2', {});
  const nombre = el('p', {});
  const boutonDemander = el('button', { class: 'bouton bouton-plein', type: 'button', 'data-action': 'demander', onclick: demander });
  const lienColler = el('a', { class: 'bouton bouton-plein', href: '#/import' }, 'Coller la réponse de Claude');
  const message = el('p', { class: 'aide', role: 'status' });
  const jamais = el('p', { class: 'texte-doux lot-jamais' });
  const noeud = el('div', { class: 'lot-versions-bloc' },
    el('section', { class: 'carte lot-versions' },
      el('div', { class: 'carte-ligne' },
        pastille('🌿', 'olive'),
        el('div', { class: 'carte-texte' }, titre, nombre,
          el('p', { class: 'texte-doux' }, 'Les plats les mieux notés du foyer d’abord.'))),
      message,
      el('div', { class: 'actions-recette' }, boutonDemander, lienColler)),
    jamais);

  /** Plats qui attendent une version de ce profil (à créer d'abord, puis à compléter), dans l'ordre où les demander. */
  function enAttente(ctx) {
    return platsSansVersion(ctx.plats, profil, {
      demandes: ctx.demandes ?? [],
      envoyes: ctx.actions?.lireEnvoyes?.() ?? [],
      profils: ctx.profils,
      evaluer: ctx.compat,
    });
  }

  async function demander() {
    const ctx = lireCtx();
    if (!profil) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    const attente = enAttente(ctx);
    const signature = attente.map(({ plat }) => plat.id).sort().join('\n');
    const parId = new Map(attente.map((element) => [element.plat.id, element]));
    const lot = dernierLot?.attente === signature
      ? dernierLot.ids.map((id) => parId.get(id)).filter(Boolean)
      : attente.slice(0, LOT_VERSIONS);
    if (!lot.length) return;
    const reussi = await copier(texteDemandeVariantes(lot, profil));
    if (reussi) {
      copie = true;
      dernierLot = { attente: signature, ids: lot.map(({ plat }) => plat.id) };
      ctx.actions?.noterEnvoyes?.(dernierLot.ids);
      message.textContent = 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la réponse de Claude\u00A0».';
    } else {
      message.textContent = 'La copie n’a pas marché. Réessayez.';
    }
    majBoutons();
  }

  function majBoutons() {
    boutonDemander.className = `bouton bouton-plein ${copie ? 'bouton-secondaire' : 'bouton-principal'}`;
    lienColler.className = `bouton bouton-plein ${copie ? 'bouton-principal' : 'bouton-secondaire'}`;
    message.hidden = !message.textContent;
  }

  function maj(ctx, nouveau) {
    if (profil?.id !== nouveau.id) {
      copie = false;
      dernierLot = null;
      message.textContent = '';
    }
    profil = nouveau;
    const nom = nomDe(profil);
    const elements = enAttente(ctx);
    const attente = elements.length;
    const aCompleter = elements.filter((element) => element.aCompleter);
    const aCreer = attente - aCompleter.length;
    // Styles qui manquent aux plats à compléter : « (végétale) », ou « (mer ou végétale) » s'ils diffèrent.
    const styles = libellesStyles(rangerStyles(aCompleter.flatMap((element) => element.manquants ?? [])), 'ou');
    const entre = styles ? ` (${styles})` : '';
    const ecartes = nombreNotesJamais(ctx.plats, profil, ctx.compat);
    titre.textContent = `Versions pour ${nom}`;
    const phrases = [];
    if (aCreer) {
      phrases.push(aCreer > 1
        ? `${aCreer}\u00A0plats attendent une version pour ${nom}.`
        : `1\u00A0plat attend une version pour ${nom}.`);
    }
    if (aCompleter.length > 1) {
      phrases.push(aCreer
        ? `${aCompleter.length}\u00A0autres sont à compléter${entre}.`
        : `${aCompleter.length}\u00A0plats sont à compléter pour ${nom}${entre}.`);
    } else if (aCompleter.length) {
      phrases.push(aCreer ? `1\u00A0autre est à compléter${entre}.` : `1\u00A0plat est à compléter pour ${nom}${entre}.`);
    }
    nombre.textContent = phrases.join(' ');
    // À créer d'abord : un lot sans plat à créer ne contient que des plats à compléter.
    boutonDemander.replaceChildren(el('span', { 'aria-hidden': 'true' }, '📋'), libelleLot(attente, aCreer === 0));
    jamais.textContent = ecartes > 1
      ? `${ecartes}\u00A0plats notés «\u00A0Jamais\u00A0» par ${nom} sont laissés de côté.`
      : `1\u00A0plat noté «\u00A0Jamais\u00A0» par ${nom} est laissé de côté.`;
    jamais.hidden = !ecartes;
    noeud.hidden = !attente;
    majBoutons();
  }

  return { noeud, maj };
}

/** « A, B et C », « A, B, C et 2 autres » : trois noms au plus. */
function nomsCourts(plats) {
  const noms = plats.map((plat) => String(plat.nom ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (noms.length > 3) return `${noms.slice(0, 3).join(', ')} et ${noms.length - 3}\u00A0autre${noms.length - 3 > 1 ? 's' : ''}`;
  return noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms.join('');
}

/**
 * Bandeau « Personne n'en veut » (les deux membres) : plats notés « Jamais » par tous les profils
 * (coeur/corbeille.js › platsSansPreneur). Un toucher les met à la corbeille ; l'annonce permet d'annuler. Nœuds
 * gardés d'un rendu à l'autre. → { noeud, maj(ctx, plats) }
 */
function creerBandeauSansPreneur(lireCtx, apresMiseALaCorbeille) {
  let ids = [];
  const titre = el('h2', {});
  const noms = el('p', {});
  const qui = el('p', {});
  const bouton = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    onclick: () => {
      if (!ids.length) return;
      lireCtx().actions.mettreALaCorbeille([...ids]);
      apresMiseALaCorbeille();
    },
  });
  const noeud = el('section', { class: 'carte carte-sans-preneur', hidden: true },
    el('div', { class: 'carte-ligne' },
      pastille('👎', 'ocre'),
      el('div', { class: 'carte-texte' }, titre, noms, qui)),
    bouton);

  function maj(ctx, plats) {
    ids = plats.map((plat) => plat.id);
    noeud.hidden = !ids.length;
    if (!ids.length) return;
    const seul = (ctx.profils ?? []).length === 1 ? nomDe(ctx.profils[0]) : null;
    titre.textContent = ids.length > 1 ? `${ids.length}\u00A0plats dont personne ne veut` : '1\u00A0plat dont personne ne veut';
    noms.textContent = nomsCourts(plats);
    qui.textContent = seul
      ? `${seul} ${ids.length > 1 ? 'les a notés' : 'l’a noté'} «\u00A0Jamais\u00A0».`
      : `Tout le monde ${ids.length > 1 ? 'les a notés' : 'l’a noté'} «\u00A0Jamais\u00A0».`;
    bouton.replaceChildren(el('span', { 'aria-hidden': 'true' }, '🗑️'),
      ids.length > 1 ? 'Les mettre à la corbeille' : 'Le mettre à la corbeille');
  }

  return { noeud, maj };
}

/**
 * Feuille « Corbeille » (les deux membres) : une ligne par plat (visuel, nom, « Mis à la corbeille le … »), lien vers
 * sa fiche et « Remettre ». Pour le gestionnaire, « Vider la corbeille » en bas : confirmation en deux temps, réseau
 * obligatoire (bouton inactif hors ligne). Mise à jour en direct par l'écran Plats (`maj`) ; se ferme d'elle-même
 * quand la corbeille est vide. `focusPlat` : plat dont le bouton « Remettre » reçoit le focus à l'ouverture.
 * Le bandeau d'annonce, caché sous la feuille ouverte (et hors de portée des lecteurs d'écran), ne sert pas ici : un
 * échec s'affiche dans la feuille, et « Corbeille vidée. » s'annonce une fois la feuille fermée.
 * → { maj(ctx), fermer }
 */
function ouvrirFeuilleCorbeille(lireCtx, { focusPlat = null, onFermer } = {}) {
  let confirmer = false; // « Vider la corbeille » touché une fois : la question attend sa réponse
  let enCours = false; // suppression envoyée, réponse attendue
  let ouverte = true;
  const liste = el('ul', { class: 'liste-corbeille' });
  // Échec de « Remettre » ou de « Vider la corbeille », dans la feuille ; effacé au toucher suivant.
  const messageEchec = el('p', { class: 'message-erreur message-corbeille', role: 'alert', hidden: true });
  const montrerEchec = (texte) => {
    messageEchec.textContent = texte ?? '';
    messageEchec.hidden = !texte;
  };
  const boutonVider = el('button', {
    class: 'bouton bouton-texte bouton-danger bouton-vider',
    type: 'button',
    onclick: () => {
      montrerEchec(null);
      confirmer = true;
      maj(lireCtx());
      // Toute la question à l'écran, « Oui, supprimer » et « Annuler » compris, même au bas d'une longue feuille.
      question.focus({ preventScroll: true });
      confirmation.scrollIntoView({ block: 'nearest' });
    },
  }, 'Vider la corbeille');
  const question = el('p', { class: 'question-vider', tabindex: '-1' });
  const boutonOui = el('button', {
    class: 'bouton bouton-principal bouton-plein bouton-supprimer',
    type: 'button',
    onclick: vider,
  }, 'Oui, supprimer');
  const boutonNon = el('button', {
    class: 'bouton bouton-texte',
    type: 'button',
    onclick: () => {
      montrerEchec(null);
      confirmer = false;
      maj(lireCtx());
      boutonVider.focus();
    },
  }, 'Annuler');
  const confirmation = el('div', { class: 'confirmation-vider' }, question, boutonOui, boutonNon);
  const horsLigne = el('p', { class: 'aide', id: 'corbeille-hors-ligne' }, 'Il faut du réseau pour vider la corbeille.');
  const zoneVider = el('div', { class: 'zone-vider' }, boutonVider, confirmation, horsLigne);

  const feuille = ouvrirFeuille('Corbeille', () => el('div', { class: 'feuille-corbeille' },
    el('p', { class: 'texte-doux' }, 'Ces plats n’apparaissent plus nulle part. Remettez-en un pour le retrouver.'),
    liste,
    messageEchec,
    zoneVider), {
    onFermer: () => {
      ouverte = false;
      onFermer?.();
    },
  });
  const titre = feuille.dialogue.querySelector('h2');

  async function vider() {
    if (enCours || !navigator.onLine) return;
    montrerEchec(null);
    enCours = true;
    maj(lireCtx());
    // L'action n'annonce rien : son message se montre ici (`message` : null si rien à dire).
    const { code, message } = await lireCtx().actions.viderCorbeille();
    enCours = false;
    // Corbeille vidée, ou feuille déjà fermée : la feuille se ferme d'abord, puis l'annonce, visible et lue.
    if (code === 'ok' || !ouverte) {
      if (ouverte) feuille.fermer();
      if (message) annoncer(message);
      return;
    }
    confirmer = false;
    // Hors ligne, l'explication est déjà sous le bouton (inactif) ; un échec s'affiche dans la feuille.
    if (code === 'echec') montrerEchec(message);
    maj(lireCtx());
    if (ouverte) (boutonVider.disabled || boutonVider.hidden ? titre : boutonVider).focus();
  }

  /** « Remettre » : un échec du serveur (refus) s'affiche dans la feuille, si elle est encore ouverte. */
  async function remettre(plat) {
    montrerEchec(null);
    const { echec } = (await lireCtx().actions.remettreDeLaCorbeille([plat.id])) ?? {};
    if (echec && ouverte) montrerEchec(echec);
  }

  function ligne(plat, ctx) {
    return el('li', { class: 'ligne-corbeille' },
      el('a', {
        class: 'corbeille-plat',
        href: `#/plat/${encodeURIComponent(plat.id)}`,
        'data-cle': `fiche:${plat.id}`,
        onclick: () => feuille.fermer(),
      },
      vignetteDuPlat(plat),
      el('span', { class: 'carte-plat-texte' },
        el('span', { class: 'carte-plat-nom' }, plat.nom),
        el('span', { class: 'carte-plat-detail' },
          texteCorbeille(plat, { profils: ctx.profils ?? [], moi: ctx.utilisateur?.email ?? ctx.moi })))),
      el('button', {
        class: 'bouton bouton-secondaire bouton-remettre',
        type: 'button',
        'data-cle': `remettre:${plat.id}`,
        'aria-label': `Remettre «\u00A0${plat.nom}\u00A0»`,
        onclick: () => remettre(plat),
      }, 'Remettre'));
  }

  function maj(ctx) {
    if (!ouverte) return;
    const plats = ctx.platsCorbeille ?? [];
    // Corbeille vide (vidée, ou tout remis ici ou sur l'autre téléphone) : la feuille n'a plus d'objet.
    if (!plats.length && !enCours) {
      feuille.fermer();
      return;
    }
    // Ligne touchée (« Remettre ») : le focus passe à la ligne suivante, ou au titre s'il n'en reste aucune.
    const actif = liste.contains(document.activeElement) ? document.activeElement : null;
    const cleFocus = actif?.dataset.cle ?? null;
    const indexFocus = actif ? [...liste.querySelectorAll('.bouton-remettre')].indexOf(actif) : -1;
    liste.replaceChildren(...plats.map((plat) => ligne(plat, ctx)));
    if (cleFocus) {
      const boutons = liste.querySelectorAll('.bouton-remettre');
      const meme = liste.querySelector(`[data-cle="${CSS.escape(cleFocus)}"]`);
      (meme ?? (indexFocus >= 0 ? boutons[Math.min(indexFocus, boutons.length - 1)] : null) ?? titre)?.focus();
    }

    // Vider : gestionnaire seulement (rôle affiché : pas en aperçu « Repas et courses »).
    const gestionnaire = ctx.role === 'gestionnaire';
    if (!gestionnaire) confirmer = false;
    zoneVider.hidden = !gestionnaire;
    const enLigne = navigator.onLine;
    boutonVider.hidden = confirmer;
    boutonVider.disabled = !enLigne;
    confirmation.hidden = !confirmer;
    const n = plats.length;
    question.textContent = n > 1
      ? `Supprimer définitivement ${n}\u00A0plats et leurs photos\u202F? Ce n’est pas réversible.`
      : 'Supprimer définitivement ce plat et sa photo\u202F? Ce n’est pas réversible.';
    boutonOui.disabled = !enLigne || enCours;
    boutonOui.textContent = enCours ? 'Suppression…' : 'Oui, supprimer';
    boutonOui.setAttribute('aria-busy', String(enCours));
    boutonNon.disabled = enCours;
    horsLigne.hidden = enLigne;
    // Le bouton inactif dit pourquoi, seulement hors ligne (une description cachée serait lue quand même).
    for (const bouton of [boutonVider, boutonOui]) {
      if (enLigne) bouton.removeAttribute('aria-describedby');
      else bouton.setAttribute('aria-describedby', 'corbeille-hors-ligne');
    }
  }

  maj(lireCtx());
  if (focusPlat) liste.querySelector(`[data-cle="${CSS.escape(`remettre:${focusPlat}`)}"]`)?.focus();
  return { maj, fermer: feuille.fermer };
}

/**
 * Feuille « Ajouter un plat ». `ouvrirCorbeille(platId)` : ouvre la corbeille sur ce plat, quand le nom est celui d'un
 * plat de la corbeille (on le remet au lieu de le recréer).
 */
function ouvrirAjout(ctx, { ouvrirCorbeille = null } = {}) {
  ouvrirFeuille('Ajouter un plat', (fermer) => {
    const erreur = el('p', { class: 'message-erreur', role: 'alert', hidden: true });
    const entree = el('input', {
      class: 'champ',
      id: 'nom-du-plat',
      name: 'nom',
      maxlength: NOM_MAX,
      autocomplete: 'off',
      enterkeyhint: 'done',
      autofocus: true,
      oninput: () => { erreur.hidden = true; },
    });
    return el('form', {
      class: 'formulaire',
      novalidate: true,
      onsubmit: (evenement) => {
        evenement.preventDefault();
        const resultat = ctx.actions.ajouterPlat(entree.value);
        if (resultat.erreur) {
          erreur.replaceChildren(
            el('span', {}, resultat.erreur),
            ...(resultat.existant
              ? [el('a', {
                class: 'bouton bouton-secondaire bouton-plein lien-erreur',
                href: `#/plat/${encodeURIComponent(resultat.existant)}`,
                onclick: fermer,
              }, 'Voir sa fiche')]
              : []),
            ...(resultat.corbeille && ouvrirCorbeille
              ? [el('button', {
                class: 'bouton bouton-secondaire bouton-plein lien-erreur',
                type: 'button',
                onclick: () => {
                  fermer();
                  ouvrirCorbeille(resultat.corbeille);
                },
              }, el('span', { 'aria-hidden': 'true' }, '🗑️'), 'Ouvrir la corbeille')]
              : []),
          );
          erreur.hidden = false;
          entree.focus();
          return;
        }
        fermer();
        location.hash = `#/plat/${encodeURIComponent(resultat.id)}`;
      },
    },
    el('label', { class: 'etiquette-champ', for: 'nom-du-plat' }, 'Nom du plat'),
    entree,
    el('p', { class: 'aide' }, ctx.roleReel === 'gestionnaire'
      ? 'Il apparaîtra avec ⏳ jusqu’à l’ajout de sa recette.'
      : 'Il apparaîtra avec ⏳\u00A0: la recette sera demandée.'),
    erreur,
    el('div', { class: 'actions-feuille' },
      el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' }, 'Ajouter'),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Annuler'),
    ));
  });
}

export function creer(ctx) {
  let courant = ctx;
  const compteur = el('p', { class: 'sous-titre', role: 'status' });
  const zoneMessage = el('div');
  // Bandeaux « Versions pour <Prénom> » du filtre « ❌ Versions à créer » : un par profil qui a des règles.
  const zoneLots = el('div', { class: 'zone-lots' });
  const bandeaux = new Map(); // profilId → bandeau gardé d'un rendu à l'autre
  const liste = el('ul', { class: 'liste-plats' });
  const titrePlats = el('h1', { tabindex: '-1' }, 'Plats');
  // « Personne n'en veut » : en haut de la liste (filtre « Tous » ou par type, hors recherche).
  const bandeauSansPreneur = creerBandeauSansPreneur(() => courant, () => titrePlats.focus());
  // Corbeille : en bas de la liste, seulement si elle n'est pas vide ; sa feuille suit les plats en direct.
  let feuilleCorbeille = null;
  const boutonCorbeille = el('button', {
    class: 'bouton bouton-texte acces-corbeille',
    type: 'button',
    hidden: true,
    onclick: () => ouvrirLaCorbeille(),
  });

  /** Ouvre la feuille « Corbeille » (`focusPlat` : plat dont « Remettre » reçoit le focus). */
  function ouvrirLaCorbeille(focusPlat = null) {
    if (feuilleCorbeille) return;
    feuilleCorbeille = ouvrirFeuilleCorbeille(() => courant, {
      focusPlat,
      onFermer: () => {
        feuilleCorbeille = null;
        // Le focus revient au bouton de la corbeille, ou au titre si elle est maintenant vide.
        if (!boutonCorbeille.isConnected) return;
        if (!boutonCorbeille.hidden) boutonCorbeille.focus();
        else titrePlats.focus();
      },
    });
  }
  // Invitation (§4) : seulement tant que la personne connectée n'a noté aucun plat.
  const invitation = el('section', { class: 'carte carte-invitation', hidden: true },
    el('h2', {}, 'Aucun plat noté'),
    el('p', {}, 'Découvrez-en 10 en une minute\u00A0: un geste par plat. Sans réponse, un plat compte comme «\u00A0Pourquoi pas\u00A0».'),
    el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/decouvrir' },
      el('span', { 'aria-hidden': 'true' }, '❤️'), 'Découvrir'));

  // Filtres : les cinq de toujours, puis « 🌿 Pour <Prénom> » par profil qui a des règles et, pour le gestionnaire,
  // « ❌ Versions à créer ». Reconstruits seulement quand leur liste change (le focus reste sur la puce touchée).
  const groupeFiltres = el('div', { class: 'puces', role: 'group', 'aria-label': 'Afficher' });
  let filtres = [];
  let cleFiltres = '';
  let boutonsFiltre = [];

  function filtresCourants() {
    return filtresPour(profilsContraints(courant.profils), { moi: courant.moi, role: courant.role });
  }

  function marquerFiltre() {
    const actif = filtreRetenu(filtres, filtre).id;
    for (const [i, bouton] of boutonsFiltre.entries()) bouton.setAttribute('aria-pressed', String(filtres[i].id === actif));
  }

  function majFiltres() {
    filtres = filtresCourants();
    const cle = filtres.map((f) => `${f.id}:${f.libelle}`).join('|');
    if (cle !== cleFiltres) {
      const focusId = groupeFiltres.contains(document.activeElement) ? document.activeElement.dataset.filtre : null;
      cleFiltres = cle;
      boutonsFiltre = filtres.map((f) => el('button', {
        class: 'puce',
        type: 'button',
        'data-filtre': f.id,
        onclick: () => {
          filtre = f.id;
          marquerFiltre();
          remplir();
        },
      }, f.libelle));
      groupeFiltres.replaceChildren(...boutonsFiltre);
      if (focusId) groupeFiltres.querySelector(`[data-filtre="${CSS.escape(focusId)}"]`)?.focus();
    }
    // Filtre mémorisé disparu (profil retiré, règles effacées, aperçu « Repas et courses ») : retour à « Tous ». Pas
    // avant la lecture des profils : un filtre « Pour <Prénom> » n'existe qu'une fois ses règles connues.
    if (courant.profilsCharges) filtre = filtreRetenu(filtres, filtre).id;
    marquerFiltre();
  }

  const champRecherche = el('input', {
    class: 'champ champ-recherche',
    type: 'search',
    placeholder: 'Rechercher un plat',
    'aria-label': 'Rechercher un plat',
    autocomplete: 'off',
    enterkeyhint: 'search',
    value: recherche,
    oninput: (evenement) => {
      recherche = evenement.target.value;
      remplir();
    },
    // Touche « Rechercher » du clavier : la liste est déjà filtrée, on referme le clavier.
    onkeydown: (evenement) => {
      if (evenement.key === 'Enter') champRecherche.blur();
    },
  });

  function toutAfficher() {
    recherche = '';
    filtre = 'tous';
    champRecherche.value = '';
    marquerFiltre();
    remplir();
    champRecherche.focus();
  }

  /** Bandeaux des lots, seulement sous le filtre « ❌ Versions à créer » (réservé au gestionnaire). */
  function remplirLots(choisi) {
    const profils = courant.platsCharges && courant.role === 'gestionnaire' && Array.isArray(choisi.profils) ? choisi.profils : [];
    for (const id of [...bandeaux.keys()]) if (!profils.some((p) => p.id === id)) bandeaux.delete(id);
    for (const profil of profils) {
      if (!bandeaux.has(profil.id)) bandeaux.set(profil.id, creerBandeauVersions(() => courant));
      bandeaux.get(profil.id).maj(courant, profil);
    }
    const noeuds = profils.map((p) => bandeaux.get(p.id).noeud);
    // Mêmes nœuds dans le même ordre : rien n'est déplacé (le focus reste).
    if (noeuds.length !== zoneLots.children.length || noeuds.some((n, i) => zoneLots.children[i] !== n)) zoneLots.replaceChildren(...noeuds);
    zoneLots.hidden = !noeuds.some((n) => !n.hidden);
  }

  /** Bouton « 🗑️ Corbeille (N) », bandeau « Personne n'en veut » et feuille de la corbeille, si elle est ouverte. */
  function remplirCorbeille(choisi) {
    const jetes = courant.platsCharges ? courant.platsCorbeille ?? [] : [];
    boutonCorbeille.hidden = !jetes.length;
    boutonCorbeille.replaceChildren(el('span', { 'aria-hidden': 'true' }, '🗑️'), `Corbeille (${jetes.length})`);
    const parType = ['tous', 'plat', 'dessert', 'apero'].includes(choisi.id) && !recherche.trim();
    const sansPreneur = courant.platsCharges && parType
      ? filtrerPlats(platsSansPreneur(courant.plats, courant.profils ?? []), { filtre: choisi })
      : [];
    bandeauSansPreneur.maj(courant, sansPreneur);
    feuilleCorbeille?.maj(courant);
  }

  function remplir() {
    // Pas d'ajout avant le chargement : sans la liste, un doublon ne serait pas repéré.
    boutonAjouter.disabled = !courant.platsCharges;
    majFiltres();
    remplirCorbeille(filtreRetenu(filtres, filtre));
    const moi = courant.moi;
    invitation.hidden = !(courant.platsCharges && moi && nombreANoter(courant.plats, moi.id, { garder: garderPour(courant, moi.id) }) > 0
      && !courant.plats.some((plat) => estNote(plat, moi.id)));
    remplirLots(filtreRetenu(filtres, filtre));
    if (!courant.platsCharges) {
      compteur.textContent = '';
      zoneMessage.replaceChildren(el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des plats…'));
      liste.replaceChildren();
      return;
    }
    const tous = courant.plats;
    const choisi = filtreRetenu(filtres, filtre);
    const resultat = filtrerPlats(tous, { recherche, filtre: choisi, evaluer: courant.compat });
    const pluriel = (n) => `${n}\u00A0plat${n > 1 ? 's' : ''}`;
    compteur.textContent = !tous.length ? ''
      : resultat.length === tous.length ? pluriel(tous.length)
        : `${pluriel(resultat.length)} sur ${tous.length}`;
    if (!tous.length) {
      zoneMessage.replaceChildren(etatVide({
        emoji: '🥘',
        teinte: 'ocre',
        titre: 'Aucun plat pour l’instant',
        texte: 'Ajoutez un plat par son nom\u00A0: la recette suivra.',
      }));
    } else if (!resultat.length && !recherche.trim() && (choisi.profil || choisi.profils)) {
      zoneMessage.replaceChildren(etatVideCompat(choisi, courant.moi));
    } else if (!resultat.length) {
      zoneMessage.replaceChildren(el('div', { class: 'carte etat-vide compact' },
        el('p', {}, 'Aucun plat ne correspond.'),
        el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: toutAfficher }, 'Tout afficher'),
      ));
    } else {
      zoneMessage.replaceChildren();
    }
    // Une carte qui avait le focus le retrouve après la mise à jour.
    const cleFocus = liste.contains(document.activeElement) ? document.activeElement.dataset.cle : null;
    liste.replaceChildren(...resultat.map((plat) => carteDuPlat(plat, courant)));
    if (cleFocus) liste.querySelector(`[data-cle="${CSS.escape(cleFocus)}"]`)?.focus();
  }

  const boutonAjouter = el('button', {
    class: 'bouton bouton-principal bouton-flottant',
    type: 'button',
    onclick: () => ouvrirAjout(courant, { ouvrirCorbeille: (platId) => ouvrirLaCorbeille(platId) }),
  }, el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter un plat');

  remplir();

  return {
    noeud: el('div', { class: 'vue' },
      el('header', { class: 'vue-entete' }, titrePlats, compteur),
      champRecherche,
      // Action propre au gestionnaire : ajouter les recettes rendues par son projet Claude.
      ctx.role === 'gestionnaire'
        ? el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/import' }, '📋 Ajouter des recettes')
        : null,
      groupeFiltres,
      zoneLots,
      invitation,
      bandeauSansPreneur.noeud,
      zoneMessage,
      liste,
      boutonCorbeille,
      boutonAjouter,
    ),
    defilement,
    maj(nouveau) {
      courant = nouveau;
      remplir();
    },
    detruire() {
      defilement = window.scrollY;
      feuilleCorbeille?.fermer();
    },
  };
}
