// Feuilles du bas (dialogues modaux) : panneau du profil, formulaires.
import { el } from './dom.js';

let compteur = 0;

/** Ferme un dialogue quand on touche le voile autour. À appeler une fois par dialogue. */
export function fermerAuToucherDuVoile(dialogue) {
  dialogue.addEventListener('click', (evenement) => {
    if (evenement.target !== dialogue) return;
    const cadre = dialogue.getBoundingClientRect();
    const dedans = evenement.clientX >= cadre.left && evenement.clientX <= cadre.right
      && evenement.clientY >= cadre.top && evenement.clientY <= cadre.bottom;
    if (!dedans) dialogue.close();
  });
}

/**
 * Ouvre une feuille avec un titre ; `construire(fermer)` renvoie son contenu.
 * La feuille disparaît du document à sa fermeture. → { fermer }
 */
export function ouvrirFeuille(titre, construire) {
  compteur += 1;
  const idTitre = `feuille-titre-${compteur}`;
  const dialogue = el('dialog', { class: 'feuille', 'aria-labelledby': idTitre });
  const fermer = () => dialogue.close();
  dialogue.addEventListener('close', () => dialogue.remove());
  fermerAuToucherDuVoile(dialogue);
  dialogue.append(
    el('div', { class: 'feuille-poignee', 'aria-hidden': 'true' }),
    el('div', { class: 'feuille-contenu' }, el('h2', { id: idTitre }, titre), construire(fermer)),
  );
  document.body.append(dialogue);
  dialogue.showModal();
  return { fermer };
}
