// Avatar de l'en-tête et panneau du profil (feuille du bas).
import { el, annoncer } from './dom.js';
import { messageDeReliure } from './relier.js';

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

// « Ce n'est pas moi » : le second toucher doit venir dans ce délai (comme le retrait d'une photo).
const DELAI_CONFIRMATION_MS = 8000;

/**
 * Prénom relié à l'adresse connectée : « Vous êtes <Prénom> » et « Ce n'est pas moi » (deux touchers), ou
 * « Votre prénom n'est pas encore relié » et « Qui êtes-vous ? ». Sans aucun profil dans le foyer : rien.
 * `onDelier()` → promesse de { code } ; `fermer()` ferme le panneau.
 */
function blocReliure({ moi, aRelier, avecProfils, role, bouton, onQuiEtesVous, onDelier, fermer }) {
  if (!avecProfils) return [];
  if (!moi) {
    // Aucun prénom à proposer : l'explication tout de suite, plutôt qu'une feuille sans choix.
    const explication = role === 'gestionnaire'
      ? 'Ajoutez votre profil dans Réglages.'
      : 'Demandez qu’on vous ajoute dans les réglages de l’app.';
    return [
      el('p', {}, 'Votre prénom n’est pas encore relié'),
      aRelier?.length
        ? bouton('Qui êtes-vous\u202F?', onQuiEtesVous)
        : el('p', { class: 'texte-doux' }, explication),
    ];
  }

  const LIBELLE = 'Ce n’est pas moi';
  let aConfirmer = false;
  let enCours = false;
  let minuteur = null;
  const erreur = el('p', { class: 'message-erreur', role: 'alert', hidden: true });
  const boutonDelier = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: delier }, LIBELLE);

  async function delier() {
    if (enCours) return;
    clearTimeout(minuteur);
    erreur.hidden = true;
    if (!aConfirmer) {
      aConfirmer = true;
      boutonDelier.textContent = 'Toucher pour confirmer';
      minuteur = setTimeout(() => {
        aConfirmer = false;
        boutonDelier.textContent = LIBELLE;
      }, DELAI_CONFIRMATION_MS);
      return;
    }
    aConfirmer = false;
    enCours = true;
    boutonDelier.textContent = 'Un instant…';
    boutonDelier.setAttribute('aria-busy', 'true');
    let resultat;
    try {
      resultat = await onDelier();
    } catch {
      resultat = { code: 'echec' };
    }
    enCours = false;
    boutonDelier.removeAttribute('aria-busy');
    boutonDelier.textContent = LIBELLE;
    const code = resultat?.code;
    if (code === 'reseau' || code === 'echec' || !code) {
      // Le panneau reste ouvert pour réessayer ; le message y est lu (le reste de l'écran est inerte).
      erreur.textContent = messageDeReliure({ code: code ?? 'echec' });
      erreur.hidden = false;
      return;
    }
    // Réussi, ou le profil a changé entre-temps : le panneau se ferme (rouvert, il montre l'état à jour), puis
    // l'annonce, hors du panneau, est lue. S'il a été rouvert pendant l'attente, son nouveau contenu reste.
    if (boutonDelier.isConnected) fermer();
    annoncer(code === 'ok'
      ? `Votre adresse n’est plus reliée à «\u00A0${moi.nom}\u00A0».`
      : 'Ce profil vient de changer sur un autre appareil.');
  }

  return [
    el('p', {}, 'Vous êtes ', el('strong', {}, moi.nom)),
    boutonDelier,
    erreur,
  ];
}

/**
 * Remplit et ouvre le panneau du profil. `role` est le rôle réel ; `apercu` : vue « Repas et courses » affichée.
 * `moi` : profil relié à l'adresse connectée, ou null ; `aRelier` : prénoms que « Qui êtes-vous ? » proposerait
 * (coeur/profils.js › profilsARelier) ; `avecProfils` : le foyer a au moins un profil.
 */
export function ouvrirProfil(dialogue, {
  utilisateur, role, apercu, moi = null, aRelier = [], avecProfils = false,
  onReglages, onAjouterRecettes, onApercu, onDeconnecter, onQuiEtesVous, onDelier,
}) {
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
      blocReliure({ moi, aRelier, avecProfils, role, bouton, onQuiEtesVous, onDelier, fermer }),
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
