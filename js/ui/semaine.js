// Écran Semaine (accueil). T0 : salutation, jours de la semaine, carte d'accueil.
import { el, enteteVue, pastille } from './dom.js';
import { prenomDe } from './profil.js';

const NOMS_JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

const formatDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const formatJourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

function salutation(maintenant) {
  const heure = maintenant.getHours();
  return heure >= 18 || heure < 5 ? 'Bonsoir' : 'Bonjour';
}

/** Les 7 jours de la semaine en cours, du dimanche au samedi. */
function joursDeLaSemaine(maintenant) {
  const dimanche = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - maintenant.getDay());
  return NOMS_JOURS.map((nom, i) => {
    const date = new Date(dimanche.getFullYear(), dimanche.getMonth(), dimanche.getDate() + i);
    return { nom, date, ecart: i - maintenant.getDay() };
  });
}

export function afficher({ utilisateur }) {
  const maintenant = new Date();
  const prenom = prenomDe(utilisateur);
  const jours = joursDeLaSemaine(maintenant);
  const premier = jours[0].date;
  const dernier = jours[6].date;

  return el('div', { class: 'vue' },
    enteteVue(prenom ? `${salutation(maintenant)} ${prenom}` : salutation(maintenant), formatDate.format(maintenant)),

    el('section', { class: 'carte carte-ligne' },
      pastille('🍲'),
      el('div', { class: 'carte-texte' },
        el('h2', {}, 'Tout est prêt'),
        el('p', {}, 'Bientôt ici\u00A0: le repas de chacun ce soir, et la prochaine chose à faire — les courses le samedi, le batch le dimanche.'),
      ),
    ),

    el('section', { class: 'section', 'aria-labelledby': 'titre-cette-semaine' },
      el('div', { class: 'section-titre' },
        el('h2', { id: 'titre-cette-semaine' }, 'Cette semaine'),
        el('p', {}, formatJourMois.formatRange(premier, dernier)),
      ),
      el('ol', { class: 'jours' },
        jours.map(({ nom, date, ecart }) => el('li', {
          class: ['jour', ecart === 0 ? 'aujourdhui' : '', ecart < 0 ? 'passe' : ''].filter(Boolean).join(' '),
          'aria-current': ecart === 0 ? 'date' : null,
        },
        el('span', { class: 'visuellement-masque' }, formatDate.format(date)),
        el('span', { class: 'jour-nom', 'aria-hidden': 'true' }, nom),
        el('span', { class: 'jour-numero', 'aria-hidden': 'true' }, String(date.getDate())),
        )),
      ),
    ),
  );
}
