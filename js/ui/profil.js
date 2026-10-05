// Avatar de l'en-tête et panneau du profil (feuille du bas).
import { el } from './dom.js';

/** Prénom affiché : premier mot du nom Google, '' s'il n'y en a pas. */
export function prenomDe(utilisateur) {
  return (utilisateur?.displayName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Initiale de l'avatar : prénom, sinon adresse, sinon « ? ». */
export function initialeDe(utilisateur) {
  const base = prenomDe(utilisateur) || utilisateur?.email || '?';
  return Array.from(base)[0].toLocaleUpperCase('fr-FR');
}

const LIBELLES_ROLE = {
  gestionnaire: 'Recettes et réglages',
  courses: 'Repas et courses',
};

/** Remplit et ouvre le panneau du profil. `role` est le rôle réel ; `apercu` : vue « Repas et courses » affichée. */
export function ouvrirProfil(dialogue, { utilisateur, role, apercu, onReglages, onAjouterRecettes, onApercu, onDeconnecter }) {
  const fermer = () => dialogue.close();
  const nom = (utilisateur.displayName ?? '').trim() || utilisateur.email;
  const bouton = (texte, action, classe = 'bouton-secondaire') => el('button', {
    class: `bouton ${classe} bouton-plein`,
    type: 'button',
    onclick: () => { fermer(); action(); },
  }, texte);

  dialogue.replaceChildren(
    el('div', { class: 'feuille-poignee', 'aria-hidden': 'true' }),
    el('div', { class: 'feuille-contenu' },
      el('div', { class: 'profil-entete' },
        el('span', { class: 'avatar', 'data-initiale': initialeDe(utilisateur), 'aria-hidden': 'true' }),
        el('div', { class: 'carte-texte' },
          el('h2', { id: 'profil-titre' }, nom),
          el('p', { class: 'texte-doux email-profil' }, utilisateur.email),
        ),
      ),
      el('p', { class: 'etiquette' }, LIBELLES_ROLE[role] ?? ''),
      role === 'gestionnaire' && !apercu ? bouton('📋 Ajouter des recettes', onAjouterRecettes) : null,
      role === 'gestionnaire' && !apercu ? bouton('⚙️ Réglages', onReglages) : null,
      role === 'gestionnaire'
        ? bouton(apercu ? 'Quitter l’aperçu' : `👀 Aperçu de la vue «\u00A0${LIBELLES_ROLE.courses}\u00A0»`, () => onApercu(!apercu))
        : null,
      bouton('Se déconnecter', onDeconnecter),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Fermer'),
    ),
  );

  if (!dialogue.open) dialogue.showModal();
}
