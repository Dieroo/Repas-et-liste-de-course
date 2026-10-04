// Écran Courses. T0 : état vide.
import { el, enteteVue, etatVide } from './dom.js';

export function afficher() {
  return el('div', { class: 'vue' },
    enteteVue('Courses'),
    etatVide({
      emoji: '🧺',
      teinte: 'olive',
      titre: 'Rien à acheter pour l’instant',
      texte: 'La liste se remplira toute seule avec les repas de la semaine. Au drive comme en magasin, même sans réseau.',
    }),
  );
}
