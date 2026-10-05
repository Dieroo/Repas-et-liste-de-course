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
  gestionnaire: 'Planification des repas',
  courses: 'Courses',
};

/** Remplit et ouvre le panneau du profil. */
export function ouvrirProfil(dialogue, { utilisateur, role, onReglages, onDeconnecter }) {
  const fermer = () => dialogue.close();
  const nom = (utilisateur.displayName ?? '').trim() || utilisateur.email;

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
      role === 'gestionnaire'
        ? el('button', {
          class: 'bouton bouton-secondaire bouton-plein',
          type: 'button',
          onclick: () => { fermer(); onReglages(); },
        }, '⚙️ Réglages')
        : null,
      el('button', {
        class: 'bouton bouton-secondaire bouton-plein',
        type: 'button',
        onclick: () => { fermer(); onDeconnecter(); },
      }, 'Se déconnecter'),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Fermer'),
    ),
  );

  if (!dialogue.open) dialogue.showModal();
}

/** Ferme le panneau quand on touche le voile autour. À appeler une fois. */
export function fermerAuToucherDuVoile(dialogue) {
  dialogue.addEventListener('click', (evenement) => {
    if (evenement.target !== dialogue) return;
    const cadre = dialogue.getBoundingClientRect();
    const dedans = evenement.clientX >= cadre.left && evenement.clientX <= cadre.right
      && evenement.clientY >= cadre.top && evenement.clientY <= cadre.bottom;
    if (!dedans) dialogue.close();
  });
}
