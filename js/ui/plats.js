// Écran Plats : recherche, filtres, liste, ajout d'un plat par son nom.
import { el, etatVide, pastille } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { modeDeCuisson } from './pictos.js';
import { LIBELLES_TYPE, STATUTS, NOM_MAX, filtresPour, filtreRetenu, filtrerPlats, visuelDuPlat, statutDe, typeDe } from '../coeur/plats.js';
import { profilsContraints } from '../coeur/compatibilite.js';
import { ligneCompat, garderPour, nomDe } from './compat.js';
import { estNote, nombreANoter, resumeNotes } from '../coeur/notes.js';

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

function ouvrirAjout(ctx) {
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
  const liste = el('ul', { class: 'liste-plats' });
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

  function remplir() {
    // Pas d'ajout avant le chargement : sans la liste, un doublon ne serait pas repéré.
    boutonAjouter.disabled = !courant.platsCharges;
    majFiltres();
    const moi = courant.moi;
    invitation.hidden = !(courant.platsCharges && moi && nombreANoter(courant.plats, moi.id, { garder: garderPour(courant, moi.id) }) > 0
      && !courant.plats.some((plat) => estNote(plat, moi.id)));
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
    onclick: () => ouvrirAjout(courant),
  }, el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter un plat');

  remplir();

  return {
    noeud: el('div', { class: 'vue' },
      el('header', { class: 'vue-entete' }, el('h1', {}, 'Plats'), compteur),
      champRecherche,
      // Action propre au gestionnaire : ajouter les recettes rendues par son projet Claude.
      ctx.role === 'gestionnaire'
        ? el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/import' }, '📋 Ajouter des recettes')
        : null,
      groupeFiltres,
      invitation,
      zoneMessage,
      liste,
      boutonAjouter,
    ),
    defilement,
    maj(nouveau) {
      courant = nouveau;
      remplir();
    },
    detruire() {
      defilement = window.scrollY;
    },
  };
}
