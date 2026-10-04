// Écrans plein écran affichés avant l'app : chargement, connexion, refus, première ouverture…
import { el, logo, pastille } from './dom.js';

function pleinEcran(...enfants) {
  return el('section', { class: 'vue plein-ecran' }, ...enfants);
}

function texte(titre, ...phrases) {
  return el('div', { class: 'plein-ecran-texte' },
    el('h1', {}, titre),
    ...phrases.filter(Boolean).map((phrase) => (phrase instanceof Node ? phrase : el('p', {}, phrase))),
  );
}

function erreur(message) {
  return message ? el('p', { class: 'message-erreur', role: 'alert' }, message) : null;
}

export function ecranChargement() {
  return pleinEcran(
    el('div', { class: 'chargement', role: 'status' },
      el('span', { class: 'chargement-point', 'aria-hidden': 'true' }),
      el('span', {}, 'Un instant…'),
    ),
  );
}

export function ecranConnexion({ enCours, messageErreur, horsLigne, onConnecter }) {
  return pleinEcran(
    logo(),
    el('div', { class: 'plein-ecran-texte' },
      el('h1', { class: 'titre-app' }, 'Repas & Courses'),
      el('p', {}, 'Les repas de la semaine et la liste de courses, partagés à deux.'),
    ),
    el('div', { class: 'plein-ecran-actions' },
      el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        disabled: enCours || horsLigne,
        onclick: onConnecter,
      }, enCours ? 'Connexion…' : 'Se connecter avec Google'),
    ),
    horsLigne ? el('p', { class: 'texte-doux' }, 'La connexion demande du réseau.') : null,
    erreur(messageErreur),
  );
}

export function ecranRefus({ email, onChangerCompte }) {
  return pleinEcran(
    pastille('🔒', 'ocre', true),
    texte('Cette adresse n’a pas accès',
      el('p', {}, 'Compte utilisé : ', el('span', { class: 'email' }, email || 'adresse inconnue')),
      'Seuls les comptes du foyer peuvent ouvrir l’application.',
    ),
    el('div', { class: 'plein-ecran-actions' },
      el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: onChangerCompte },
        'Utiliser un autre compte'),
    ),
  );
}

export function ecranPremiereOuverture({ email, enCours, messageErreur, onDevenirGestionnaire, onDeconnecter }) {
  return pleinEcran(
    pastille('👋', '', true),
    texte('Bienvenue !',
      'Une seule question avant de commencer : qui planifie les repas ?',
      'Cette personne aura accès aux réglages et à l’ajout de recettes. L’autre aura une vue simplifiée, pensée pour les courses.',
      el('p', {}, 'Compte utilisé : ', el('span', { class: 'email' }, email)),
    ),
    el('div', { class: 'plein-ecran-actions' },
      el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        disabled: enCours,
        onclick: onDevenirGestionnaire,
      }, enCours ? 'Un instant…' : 'C’est moi qui planifie'),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: onDeconnecter },
        'Ce n’est pas moi : me déconnecter'),
    ),
    erreur(messageErreur),
  );
}

export function ecranConnexionNecessaire({ onDeconnecter }) {
  return pleinEcran(
    pastille('📶', 'bleu', true),
    texte('Du réseau, juste une fois',
      'Ouvrez l’application une première fois avec du réseau. Ensuite, elle fonctionnera aussi sans.',
    ),
    el('div', { class: 'plein-ecran-actions' },
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: onDeconnecter }, 'Se déconnecter'),
    ),
  );
}

export function ecranErreur({ code, onReessayer }) {
  return pleinEcran(
    pastille('😕', 'ocre', true),
    texte('Impossible de charger les données',
      'Vérifiez le réseau, puis réessayez.',
      code ? el('p', { class: 'texte-doux' }, `Code : ${code}`) : null,
    ),
    el('div', { class: 'plein-ecran-actions' },
      el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: onReessayer }, 'Réessayer'),
    ),
  );
}

export function ecranNonConfigure() {
  return pleinEcran(
    logo(),
    texte('Presque prêt',
      'L’application n’est pas encore reliée à sa base de données. La configuration Firebase reste à ajouter dans js/firebase.js.',
    ),
  );
}
