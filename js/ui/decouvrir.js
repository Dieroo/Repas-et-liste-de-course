// Écran Découvrir. T0 : aperçu des trois gestes.
import { el, enteteVue, etatVide } from './dom.js';

const GESTES = [
  { emoji: '👎', libelle: 'Jamais' },
  { emoji: '👍', libelle: 'Pourquoi pas' },
  { emoji: '❤️', libelle: 'J’adore' },
];

export function afficher() {
  return el('div', { class: 'vue' },
    enteteVue('Découvrir'),
    etatVide(
      {
        emoji: '❤️',
        titre: 'Bientôt\u00A0: trier les plats d’un geste',
        texte: 'Un plat à la fois, une réponse\u00A0:',
      },
      el('ul', { class: 'gestes' },
        GESTES.map(({ emoji, libelle }) => el('li', { class: 'geste' },
          el('span', { class: 'geste-emoji', 'aria-hidden': 'true' }, emoji),
          el('span', {}, libelle),
        )),
      ),
    ),
  );
}
