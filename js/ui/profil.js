// Avatar de l'en-tête et panneau du profil (feuille du bas).
import { el, annoncer } from './dom.js';
import { messageDeReliure } from './relier.js';
import { joursDepuis } from '../coeur/sauvegarde.js';

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

// Au-delà, le panneau du profil rappelle de faire une sauvegarde.
const JOURS_RAPPEL_SAUVEGARDE = 30;

/**
 * Rappel de sauvegarde (gestionnaire) : sans sauvegarde, ou si la dernière date de plus de 30 jours, une ligne et le
 * bouton « Télécharger une sauvegarde ». `sauvegarde` : { derniere: Date | null }, ou null (pas de rappel).
 */
function blocSauvegarde(sauvegarde, onSauvegarder, bouton) {
  if (!sauvegarde || !onSauvegarder) return [];
  const { derniere } = sauvegarde;
  let message = null;
  if (!derniere) {
    message = '⚠️ Pas encore de sauvegarde';
  } else {
    const jours = Math.floor(joursDepuis(derniere, new Date()));
    if (jours > JOURS_RAPPEL_SAUVEGARDE) message = `⚠️ Dernière sauvegarde il y a ${jours}\u00A0jours`;
  }
  if (!message) return [];
  return [
    el('p', {}, message),
    bouton('⬇️ Télécharger une sauvegarde', onSauvegarder, 'bouton-principal'),
  ];
}

/**
 * Rappel des instructions du projet Claude (gestionnaire) : quand celles de l'app n'ont pas encore été copiées sur ce
 * téléphone, une ligne et le bouton « Les recopier » (vers Réglages › Projet Claude).
 */
function blocInstructions(instructionsAJour, onInstructions, bouton) {
  if (instructionsAJour !== false || !onInstructions) return [];
  return [
    el('p', {}, '🔔 Nouvelles instructions pour votre projet Claude.'),
    bouton('Les recopier', onInstructions),
  ];
}

/** « 8 octobre 2026 » pour '2026-10-08' ; null si la date est illisible. */
function dateLongue(iso) {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!morceaux) return null;
  const date = new Date(Number(morceaux[1]), Number(morceaux[2]) - 1, Number(morceaux[3]));
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Bas du panneau : version de l'app qui tourne (« Version du 8 octobre 2026 · b33d02 »), pour savoir si une mise à
 * jour est appliquée ; et, si une plus récente est arrivée pendant la visite, comment l'appliquer.
 */
function lignesVersion(version, versionPrete) {
  const code = typeof version?.version === 'string' ? version.version.slice(0, 6) : '';
  const date = dateLongue(version?.publiee);
  const texte = code
    ? `Version ${date ? `du ${date} ` : ''}·\u00A0${code}`
    : 'Version\u00A0: pas encore installée sur ce téléphone.';
  return [
    el('p', { class: 'aide version-app' }, texte),
    versionPrete
      ? el('p', { class: 'aide version-app' }, 'Une mise à jour est prête\u00A0: fermez puis rouvrez l’app pour l’appliquer.')
      : null,
  ];
}

/**
 * Remplit et ouvre le panneau du profil. `role` est le rôle réel ; `apercu` : vue « Repas et courses » affichée.
 * `moi` : profil relié à l'adresse connectée, ou null ; `aRelier` : prénoms que « Qui êtes-vous ? » proposerait
 * (coeur/profils.js › profilsARelier) ; `avecProfils` : le foyer a au moins un profil.
 * `sauvegarde` : { derniere: Date | null } pour le rappel de sauvegarde (gestionnaire), null sinon ;
 * `onSauvegarder()` est appelé dans le toucher, panneau déjà fermé.
 * `instructionsAJour` : faux si les instructions du projet Claude ont changé depuis la dernière copie (rappel et
 * `onInstructions()`, panneau déjà fermé) ; vrai par défaut, sans rappel.
 */
export function ouvrirProfil(dialogue, {
  utilisateur, role, apercu, moi = null, aRelier = [], avecProfils = false,
  onReglages, onAjouterRecettes, onApercu, onDeconnecter, onQuiEtesVous, onDelier,
  sauvegarde = null, onSauvegarder, instructionsAJour = true, onInstructions, version = null, versionPrete = false,
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
      role === 'gestionnaire' && !apercu ? blocSauvegarde(sauvegarde, onSauvegarder, bouton) : null,
      role === 'gestionnaire' && !apercu ? blocInstructions(instructionsAJour, onInstructions, bouton) : null,
      role === 'gestionnaire' && !apercu ? bouton('📋 Ajouter des recettes', onAjouterRecettes) : null,
      role === 'gestionnaire' && !apercu ? bouton('⚙️ Réglages', onReglages) : null,
      role === 'gestionnaire'
        ? bouton(apercu ? 'Quitter l’aperçu' : `👀 Aperçu de la vue «\u00A0${LIBELLES_ROLE.courses}\u00A0»`, () => onApercu(!apercu))
        : null,
      bouton('Se déconnecter', onDeconnecter),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Fermer'),
      ...lignesVersion(version, versionPrete),
    ),
  );

  if (!dialogue.open) dialogue.showModal();
}
