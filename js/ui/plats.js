// Écran Plats. T0 : état vide.
import { el, enteteVue, etatVide } from './dom.js';

export function afficher() {
  return el('div', { class: 'vue' },
    enteteVue('Plats'),
    etatVide({
      emoji: '🥘',
      teinte: 'ocre',
      titre: 'Votre carnet de plats arrive',
      texte: 'Vous y retrouverez vos recettes, avec les préférences de chacun.',
    }),
  );
}
