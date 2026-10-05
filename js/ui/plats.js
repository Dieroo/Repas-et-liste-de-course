// Écran Plats : recherche, filtres, liste, ajout d'un plat par son nom.
import { el, etatVide, pastille } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { FILTRES, LIBELLES_TYPE, STATUTS, NOM_MAX, filtrerPlats, visuelDuPlat, statutDe, typeDe } from '../coeur/plats.js';

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

function carteDuPlat(plat) {
  const statut = statutDe(plat) !== 'validee' ? STATUTS[statutDe(plat)] : null;
  const detail = [LIBELLES_TYPE[typeDe(plat)] ?? 'Plat', statut ? `${statut.emoji}\u00A0${statut.libelle}` : null]
    .filter(Boolean).join(' · ');
  return el('li', {},
    el('a', { class: 'carte-plat', href: `#/plat/${encodeURIComponent(plat.id)}`, 'data-cle': plat.id },
      vignetteDuPlat(plat),
      el('span', { class: 'carte-plat-texte' },
        el('span', { class: 'carte-plat-nom' }, plat.nom),
        el('span', { class: 'carte-plat-detail' }, detail),
      ),
      el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
    ),
  );
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

  const boutonsFiltre = FILTRES.map((f) => el('button', {
    class: 'puce',
    type: 'button',
    'aria-pressed': String(f.id === filtre),
    onclick: () => {
      filtre = f.id;
      for (const [i, bouton] of boutonsFiltre.entries()) bouton.setAttribute('aria-pressed', String(FILTRES[i].id === filtre));
      remplir();
    },
  }, f.libelle));

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
    for (const [i, bouton] of boutonsFiltre.entries()) bouton.setAttribute('aria-pressed', String(FILTRES[i].id === filtre));
    remplir();
    champRecherche.focus();
  }

  function remplir() {
    // Pas d'ajout avant le chargement : sans la liste, un doublon ne serait pas repéré.
    boutonAjouter.disabled = !courant.platsCharges;
    if (!courant.platsCharges) {
      compteur.textContent = '';
      zoneMessage.replaceChildren(el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des plats…'));
      liste.replaceChildren();
      return;
    }
    const tous = courant.plats;
    const resultat = filtrerPlats(tous, { recherche, filtre });
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
    liste.replaceChildren(...resultat.map(carteDuPlat));
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
      el('div', { class: 'puces', role: 'group', 'aria-label': 'Afficher' }, boutonsFiltre),
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
