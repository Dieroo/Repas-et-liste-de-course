// Écran Réglages (gestionnaire) : rôle, profils du foyer.
import { el, enteteVue, etatVide, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { PORTIONS, NOM_PROFIL_MAX, trierProfils, preparerProfil, libellePortion } from '../coeur/profils.js';

function ouvrirFicheProfil(ctx, existant) {
  ouvrirFeuille(existant ? 'Modifier le profil' : 'Ajouter un profil', (fermer) => {
    let retraitAConfirmer = false;
    const erreurs = {};
    const message = (cle) => {
      erreurs[cle] = el('p', { class: 'message-erreur', role: 'alert', hidden: true });
      return erreurs[cle];
    };

    const nom = el('input', {
      class: 'champ', id: 'profil-nom', maxlength: NOM_PROFIL_MAX, autocomplete: 'off', autofocus: !existant,
      value: existant?.nom ?? '',
      oninput: () => { erreurs.nom.hidden = true; },
    });
    const email = el('input', {
      class: 'champ', id: 'profil-email', type: 'email', inputmode: 'email', autocomplete: 'off',
      value: existant?.email ?? '',
      oninput: () => { erreurs.email.hidden = true; },
    });
    const portions = PORTIONS.map((p) => el('label', { class: 'choix' },
      el('input', {
        type: 'radio', name: 'portion', value: String(p.valeur),
        checked: (existant?.coefPortion ?? 1) === p.valeur,
      }),
      el('span', {}, p.libelle),
    ));

    const boutonRetrait = existant
      ? el('button', {
        class: 'bouton bouton-texte bouton-danger',
        type: 'button',
        onclick: () => {
          if (!retraitAConfirmer) {
            retraitAConfirmer = true;
            boutonRetrait.textContent = `Confirmer\u00A0: retirer ${existant.nom}`;
            return;
          }
          ctx.actions.retirerProfil(existant.id);
          annoncer(`Profil «\u00A0${existant.nom}\u00A0» retiré.`);
          fermer();
        },
      }, 'Retirer ce profil')
      : null;

    return el('form', {
      class: 'formulaire',
      novalidate: true,
      onsubmit: (evenement) => {
        evenement.preventDefault();
        const choisi = portions.map((l) => l.querySelector('input')).find((i) => i.checked);
        const resultat = preparerProfil(
          { nom: nom.value, email: email.value, coefPortion: choisi ? Number(choisi.value) : null },
          { profils: ctx.profils, id: existant?.id ?? null },
        );
        for (const [cle, zone] of Object.entries(erreurs)) {
          zone.textContent = resultat.erreurs?.[cle] ?? '';
          zone.hidden = !resultat.erreurs?.[cle];
        }
        if (resultat.erreurs) return;
        ctx.actions.enregistrerProfil(resultat.profil);
        annoncer(existant ? 'Profil modifié.' : `Profil «\u00A0${resultat.profil.nom}\u00A0» ajouté.`);
        fermer();
      },
    },
    el('label', { class: 'etiquette-champ', for: 'profil-nom' }, 'Prénom'),
    nom,
    message('nom'),
    el('label', { class: 'etiquette-champ', for: 'profil-email' }, 'Adresse e-mail (facultatif)'),
    email,
    el('p', { class: 'aide' }, 'Pour reconnaître la personne quand elle se connecte. Laissez vide pour un enfant.'),
    message('email'),
    el('fieldset', { class: 'groupe-choix' },
      el('legend', { class: 'etiquette-champ' }, 'Portion'),
      el('div', { class: 'choix-ligne' }, portions),
    ),
    message('coefPortion'),
    el('div', { class: 'actions-feuille' },
      el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' }, 'Enregistrer'),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Annuler'),
      boutonRetrait,
    ));
  });
}

export function creer(ctx) {
  let courant = ctx;
  const gestionnaire = el('dd', {});
  const listeProfils = el('div', { class: 'section' });

  function remplir() {
    gestionnaire.textContent = courant.reglages?.gestionnaire ?? '';
    const profils = trierProfils(courant.profils);
    listeProfils.replaceChildren(
      el('div', { class: 'section-titre' }, el('h2', {}, 'Profils du foyer')),
      profils.length
        ? el('ul', { class: 'liste-profils' }, profils.map((profil) => el('li', {},
          el('button', { class: 'carte-plat', type: 'button', onclick: () => ouvrirFicheProfil(courant, profil) },
            el('span', { class: 'avatar', 'data-initiale': Array.from(profil.nom || '?')[0].toLocaleUpperCase('fr-FR'), 'aria-hidden': 'true' }),
            el('span', { class: 'carte-plat-texte' },
              el('span', { class: 'carte-plat-nom' }, profil.nom),
              el('span', { class: 'carte-plat-detail' },
                [libellePortion(profil.coefPortion), profil.email || 'sans adresse'].join(' · ')),
            ),
            el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
          ))))
        : el('p', { class: 'texte-doux' }, 'Ajoutez les membres du foyer\u00A0: les deux adultes et l’enfant.'),
      el('button', {
        class: 'bouton bouton-secondaire bouton-plein',
        type: 'button',
        onclick: () => ouvrirFicheProfil(courant, null),
      }, '＋ Ajouter un profil'),
    );
  }

  remplir();

  return {
    noeud: el('div', { class: 'vue' },
      enteteVue('Réglages'),
      el('section', { class: 'carte' },
        el('dl', { class: 'ligne-info' }, el('dt', {}, 'Recettes et réglages'), gestionnaire),
      ),
      listeProfils,
      etatVide({
        emoji: '⚙️',
        teinte: 'olive',
        titre: 'D’autres réglages arrivent',
        texte: 'Les rayons du magasin, l’ajout de recettes et la sauvegarde trouveront leur place ici.',
      }),
    ),
    maj(nouveau) {
      courant = nouveau;
      remplir();
    },
  };
}
