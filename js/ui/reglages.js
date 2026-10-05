// Écran Réglages (gestionnaire). T0 : qui est gestionnaire.
import { el, enteteVue, etatVide } from './dom.js';

export function afficher({ reglages }) {
  return el('div', { class: 'vue' },
    enteteVue('Réglages'),
    el('section', { class: 'carte' },
      el('dl', { class: 'ligne-info' },
        el('dt', {}, 'Planification des repas'),
        el('dd', {}, reglages?.gestionnaire ?? ''),
      ),
    ),
    etatVide({
      emoji: '⚙️',
      teinte: 'olive',
      titre: 'D’autres réglages arrivent',
      texte: 'Les profils, les rayons du magasin et l’ajout de recettes trouveront leur place ici.',
    }),
  );
}
