// Démarrage : service worker, connexion, rôle, routeur par hash, indicateur hors ligne.
import {
  configuree,
  surChangementUtilisateur,
  connecter,
  deconnecter,
  messageErreurConnexion,
} from './firebase.js';
import { suivreReglages, arreterReglages, devenirGestionnaire } from './donnees.js';
import { roleDe, resoudreRoute, gestionnaireADesigner } from './coeur/roles.js';
import {
  ecranChargement,
  ecranConnexion,
  ecranRefus,
  ecranPremiereOuverture,
  ecranConnexionNecessaire,
  ecranErreur,
  ecranNonConfigure,
} from './ui/connexion.js';
import { ouvrirProfil, fermerAuToucherDuVoile, initialeDe } from './ui/profil.js';
import * as semaine from './ui/semaine.js';
import * as courses from './ui/courses.js';
import * as plats from './ui/plats.js';
import * as decouvrir from './ui/decouvrir.js';
import * as reglages from './ui/reglages.js';

const ECRANS = {
  semaine: { titre: 'Semaine', module: semaine },
  courses: { titre: 'Courses', module: courses },
  plats: { titre: 'Plats', module: plats },
  decouvrir: { titre: 'Découvrir', module: decouvrir },
  reglages: { titre: 'Réglages', module: reglages },
};

const NOM_APP = 'Repas & Courses';

// Délai avant d'annoncer que les données sont injoignables alors que le téléphone a du réseau.
const DELAI_INJOIGNABLE_MS = 4000;

// Comptes déjà confirmés par le serveur sur ce téléphone. Le cache Firestore est commun à tous les comptes :
// pour un compte jamais confirmé, la copie locale n'est pas montrée (un compte non autorisé ne voit rien).
// Le stockage local est partagé avec les autres sites du même domaine github.io, d'où le préfixe.
const CLE_COMPTES_CONFIRMES = 'repas-courses:comptes-confirmes';

const zone = document.getElementById('ecran');
const marque = document.querySelector('.marque');
const onglets = document.getElementById('onglets');
const boutonProfil = document.getElementById('bouton-profil');
const pastilleHorsLigne = document.getElementById('hors-ligne');
const panneauProfil = document.getElementById('panneau-profil');

const etat = {
  utilisateur: undefined, // undefined : pas encore connu ; null : déconnecté
  donnees: { statut: 'chargement' },
  abonnementDepuis: 0,
  connexionEnCours: false,
  erreurConnexion: null,
  creationEnCours: false,
  erreurCreation: null,
};

let cleAffichee = '';
let minuteurInjoignable = null;

// ——— Comptes confirmés ———

function comptesConfirmes() {
  try {
    return JSON.parse(localStorage.getItem(CLE_COMPTES_CONFIRMES) ?? '[]');
  } catch {
    return [];
  }
}

function compteConfirme(uid) {
  return comptesConfirmes().includes(uid);
}

function confirmerCompte(uid) {
  try {
    const comptes = comptesConfirmes();
    if (!comptes.includes(uid)) localStorage.setItem(CLE_COMPTES_CONFIRMES, JSON.stringify([...comptes, uid]));
  } catch {
    // Sans stockage local, l'app demandera simplement du réseau à l'ouverture.
  }
}

// ——— Rendu ———

/** Remplace le contenu de l'écran, sauf si rien n'a changé (évite de rejouer l'animation). */
function monter(cle, fabriquer, { dansApp = false, titre = NOM_APP } = {}) {
  document.body.classList.toggle('dans-app', dansApp);
  marque.hidden = !dansApp;
  onglets.hidden = !dansApp;
  boutonProfil.hidden = !dansApp;
  if (!dansApp && panneauProfil.open) panneauProfil.close();
  if (cle === cleAffichee) return;

  const changementDEcran = cle.split('|')[0] !== cleAffichee.split('|')[0];
  const focusDansLEcran = zone.contains(document.activeElement);
  cleAffichee = cle;
  document.title = titre;
  const vue = fabriquer();
  if (changementDEcran) vue.classList.add('entree');
  zone.replaceChildren(vue);
  if (changementDEcran && dansApp) window.scrollTo(0, 0);
  if ((changementDEcran && dansApp) || focusDansLEcran) zone.focus({ preventScroll: true });
}

function rendre() {
  if (!configuree) {
    monter('non-configure', ecranNonConfigure);
    return;
  }

  const { utilisateur, donnees } = etat;

  if (utilisateur === undefined) {
    monter('chargement', ecranChargement);
    return;
  }

  if (utilisateur === null) {
    const horsLigne = !navigator.onLine;
    monter(`connexion|${etat.connexionEnCours}|${etat.erreurConnexion}|${horsLigne}`, () => ecranConnexion({
      enCours: etat.connexionEnCours,
      messageErreur: etat.erreurConnexion,
      horsLigne,
      onConnecter: lancerConnexion,
    }));
    return;
  }

  switch (donnees.statut) {
    case 'chargement':
      monter('chargement', ecranChargement);
      return;
    case 'injoignable':
      rendreInjoignable();
      return;
    case 'refuse':
      monter(`refus|${utilisateur.email}`, () => ecranRefus({ email: utilisateur.email, onChangerCompte: seDeconnecter }));
      return;
    case 'erreur':
      monter(`erreur|${donnees.code}`, () => ecranErreur({
        code: donnees.code,
        onReessayer: suivreDonnees,
        onDeconnecter: seDeconnecter,
      }));
      return;
    case 'absent':
      rendrePremiereOuverture();
      return;
    default:
      if (gestionnaireADesigner(donnees.reglages)) rendrePremiereOuverture();
      else rendreApp();
  }
}

/** Rien en cache et pas de réponse : « du réseau » si le téléphone n'en a pas, sinon attente puis erreur. */
function rendreInjoignable() {
  if (!navigator.onLine) {
    monter('reseau-necessaire', () => ecranConnexionNecessaire({ onDeconnecter: seDeconnecter }));
    return;
  }
  const reste = etat.abonnementDepuis + DELAI_INJOIGNABLE_MS - Date.now();
  if (reste > 0) {
    monter('chargement', ecranChargement);
    clearTimeout(minuteurInjoignable);
    minuteurInjoignable = setTimeout(rendre, reste);
    return;
  }
  monter('injoignable', () => ecranErreur({ onReessayer: suivreDonnees, onDeconnecter: seDeconnecter }));
}

function rendrePremiereOuverture() {
  monter(`premiere|${etat.creationEnCours}|${etat.erreurCreation}`, () => ecranPremiereOuverture({
    email: etat.utilisateur.email,
    enCours: etat.creationEnCours,
    messageErreur: etat.erreurCreation,
    onDevenirGestionnaire: lancerCreation,
    onDeconnecter: seDeconnecter,
  }));
}

function rendreApp() {
  const { utilisateur } = etat;
  const reglagesFoyer = etat.donnees.reglages;
  const role = roleDe(utilisateur.email, reglagesFoyer);
  const route = resoudreRoute(location.hash, role);
  if (location.hash !== `#/${route}`) history.replaceState(null, '', `#/${route}`);

  for (const onglet of onglets.querySelectorAll('[data-route]')) {
    if (onglet.dataset.route === route) onglet.setAttribute('aria-current', 'page');
    else onglet.removeAttribute('aria-current');
  }
  boutonProfil.dataset.initiale = initialeDe(utilisateur);

  // La date et la salutation font partie de la clé : l'écran se met à jour si l'app reprend plus tard.
  const maintenant = new Date();
  const moment = `${maintenant.toDateString()}-${maintenant.getHours() >= 18 || maintenant.getHours() < 5}`;
  const { titre, module } = ECRANS[route];
  const cle = `${route}|${role}|${utilisateur.uid}|${reglagesFoyer?.gestionnaire ?? ''}|${moment}`;
  monter(cle, () => module.afficher({ utilisateur, role, reglages: reglagesFoyer }), {
    dansApp: true,
    titre: `${titre} · ${NOM_APP}`,
  });
}

// ——— Actions ———

async function lancerConnexion() {
  if (etat.connexionEnCours) return;
  etat.connexionEnCours = true;
  etat.erreurConnexion = null;
  rendre();
  try {
    await connecter();
  } catch (erreur) {
    etat.erreurConnexion = messageErreurConnexion(erreur);
  } finally {
    etat.connexionEnCours = false;
    rendre();
  }
}

async function seDeconnecter() {
  arreterReglages();
  etat.donnees = { statut: 'chargement' };
  try {
    await deconnecter();
  } catch {
    // La déconnexion a échoué : on reprend là où on en était.
    if (etat.utilisateur) suivreDonnees();
  }
}

async function lancerCreation() {
  if (etat.creationEnCours) return;
  if (!navigator.onLine) {
    etat.erreurCreation = 'Cette étape demande du réseau. Réessayez quand il revient.';
    rendre();
    return;
  }
  const uid = etat.utilisateur.uid;
  etat.creationEnCours = true;
  etat.erreurCreation = null;
  rendre();
  try {
    await devenirGestionnaire(etat.utilisateur.email);
  } catch {
    if (etat.utilisateur?.uid === uid) etat.erreurCreation = 'L’enregistrement n’a pas abouti. Réessayez.';
  } finally {
    if (etat.utilisateur?.uid === uid) {
      etat.creationEnCours = false;
      rendre();
    }
  }
}

function suivreDonnees() {
  const uid = etat.utilisateur.uid;
  etat.donnees = { statut: 'chargement' };
  etat.abonnementDepuis = Date.now();
  rendre();
  suivreReglages((donnees) => {
    if (donnees.statut === 'ok') {
      if (!donnees.depuisCache) confirmerCompte(uid);
      else if (!compteConfirme(uid)) donnees = { statut: 'injoignable' };
    }
    etat.donnees = donnees;
    rendre();
  });
}

// ——— Hors ligne ———

function majHorsLigne() {
  pastilleHorsLigne.hidden = navigator.onLine;
  rendre();
}

// ——— Démarrage ———

function demarrer() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Sans service worker, l'app marche quand même en ligne.
    });
  }
  // Demande à Chrome de ne pas effacer les données de l'app quand le téléphone manque de place.
  navigator.storage?.persist?.().catch(() => {});

  window.addEventListener('online', majHorsLigne);
  window.addEventListener('offline', majHorsLigne);
  window.addEventListener('hashchange', rendre);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rendre();
  });
  pastilleHorsLigne.hidden = navigator.onLine;

  fermerAuToucherDuVoile(panneauProfil);
  boutonProfil.addEventListener('click', () => {
    const role = roleDe(etat.utilisateur?.email, etat.donnees.reglages);
    ouvrirProfil(panneauProfil, {
      utilisateur: etat.utilisateur,
      role,
      onReglages: () => { location.hash = '#/reglages'; },
      onDeconnecter: seDeconnecter,
    });
  });

  rendre();
  if (!configuree) return;

  surChangementUtilisateur((utilisateur) => {
    etat.utilisateur = utilisateur;
    etat.creationEnCours = false;
    etat.erreurCreation = null;
    if (utilisateur) {
      etat.erreurConnexion = null;
      suivreDonnees();
    } else {
      arreterReglages();
      etat.donnees = { statut: 'chargement' };
      rendre();
    }
  });
}

demarrer();
