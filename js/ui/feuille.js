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
 * Clavier Android : par défaut, il recouvre le bas de la page sans la redimensionner. Tant que la feuille est
 * ouverte, sa hauteur alimente `--clavier` sur le dialogue ; le CSS remonte la feuille d'autant et réduit sa hauteur
 * maximale. → fonction qui retire les écouteurs.
 */
function suivreClavier(dialogue) {
  const vue = window.visualViewport;
  if (!vue) return () => {};
  let image = 0;
  const mesurer = () => {
    const hauteur = Math.max(0, Math.round(window.innerHeight - vue.height - vue.offsetTop));
    dialogue.style.setProperty('--clavier', `${hauteur}px`);
    // Le champ en cours de saisie reste visible dans la feuille raccourcie.
    cancelAnimationFrame(image);
    image = requestAnimationFrame(() => {
      const actif = document.activeElement;
      if (hauteur > 0 && dialogue.contains(actif) && actif.matches('input, textarea, select')) {
        actif.scrollIntoView({ block: 'nearest' });
      }
    });
  };
  vue.addEventListener('resize', mesurer);
  vue.addEventListener('scroll', mesurer);
  mesurer();
  return () => {
    cancelAnimationFrame(image);
    vue.removeEventListener('resize', mesurer);
    vue.removeEventListener('scroll', mesurer);
  };
}

/**
 * Ouvre une feuille avec un titre ; `construire(fermer)` renvoie son contenu. La feuille disparaît du document à
 * sa fermeture, puis `onFermer()` est appelé (pour rendre le focus à la bonne ligne).
 * → { fermer, dialogue, definirTitre(texte) }
 */
export function ouvrirFeuille(titre, construire, { onFermer } = {}) {
  compteur += 1;
  const idTitre = `feuille-titre-${compteur}`;
  const dialogue = el('dialog', { class: 'feuille', 'aria-labelledby': idTitre });
  const fermer = () => {
    if (dialogue.open) dialogue.close();
  };
  const arreterClavier = suivreClavier(dialogue);
  dialogue.addEventListener('close', () => {
    arreterClavier();
    dialogue.remove();
    onFermer?.();
  });
  fermerAuToucherDuVoile(dialogue);
  const entete = el('h2', { id: idTitre, tabindex: '-1' }, titre);
  dialogue.append(
    el('div', { class: 'feuille-poignee', 'aria-hidden': 'true' }),
    el('div', { class: 'feuille-contenu' }, entete, construire(fermer)),
  );
  // Sans champ désigné, le focus va au titre : pas de clavier qui s'ouvre pour une simple consultation.
  if (!dialogue.querySelector('[autofocus]')) entete.setAttribute('autofocus', '');
  document.body.append(dialogue);
  dialogue.showModal();
  return {
    fermer,
    dialogue,
    definirTitre(texte) {
      entete.textContent = texte;
    },
  };
}
