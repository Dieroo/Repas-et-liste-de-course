// Écran Plats : recherche, filtres, liste, ajout d'un plat par son nom.
import { el, etatVide, pastille } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { FILTRES, LIBELLES_TYPE, STATUTS, NOM_MAX, filtrerPlats, visuelDuPlat } from '../coeur/plats.js';

// Gardés d'une visite à l'autre : revenir d'une fiche retrouve la même liste.
let recherche = '';
let filtre = 'tous';

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
  const statut = plat.statutRecette !== 'validee' ? STATUTS[plat.statutRecette] : null;
  const detail = [LIBELLES_TYPE[plat.type] ?? 'Plat', statut ? `${statut.emoji}\u00A0${statut.libelle}` : null]
    .filter(Boolean).join(' · ');
  return el('li', {},
    el('a', { class: 'carte-plat', href: `#/plat/${encodeURIComponent(plat.id)}` },
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
            resultat.erreur,
            ...(resultat.existant
              ? [' ', el('a', { href: `#/plat/${encodeURIComponent(resultat.existant)}`, onclick: fermer }, 'Voir sa fiche')]
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
  const compteur = el('p', { class: 'sous-titre' });
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
  });

  function toutAfficher() {
    recherche = '';
    filtre = 'tous';
    champRecherche.value = '';
    for (const [i, bouton] of boutonsFiltre.entries()) bouton.setAttribute('aria-pressed', String(FILTRES[i].id === filtre));
    remplir();
  }

  function remplir() {
    if (!courant.platsCharges) {
      compteur.textContent = '';
      zoneMessage.replaceChildren(el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des plats…'));
      liste.replaceChildren();
      return;
    }
    const tous = courant.plats;
    compteur.textContent = tous.length ? `${tous.length} plat${tous.length > 1 ? 's' : ''}` : '';
    const resultat = filtrerPlats(tous, { recherche, filtre });
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
    liste.replaceChildren(...resultat.map(carteDuPlat));
  }

  remplir();

  return {
    noeud: el('div', { class: 'vue' },
      el('header', { class: 'vue-entete' }, el('h1', {}, 'Plats'), compteur),
      champRecherche,
      el('div', { class: 'puces', role: 'group', 'aria-label': 'Afficher' }, boutonsFiltre),
      zoneMessage,
      liste,
      el('button', {
        class: 'bouton bouton-principal bouton-flottant',
        type: 'button',
        onclick: () => ouvrirAjout(courant),
      }, el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter un plat'),
    ),
    maj(nouveau) {
      courant = nouveau;
      remplir();
    },
  };
}
