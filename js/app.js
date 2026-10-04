// Démarrage : service worker, connexion, rôle, routeur par hash, indicateur hors ligne.
import {
  configuree,
  surChangementUtilisateur,
  connecter,
  deconnecter,
  retourDeRedirection,
  messageErreurConnexion,
} from './firebase.js';
import { suivreReglages, arreterReglages, devenirGestionnaire } from './donnees.js';
import { roleDe, resoudreRoute } from './coeur/roles.js';
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

const zone = document.getElementById('ecran');
const marque = document.querySelector('.marque');
const onglets = document.getElementById('onglets');
const boutonProfil = document.getElementById('bouton-profil');
const pastilleHorsLigne = document.getElementById('hors-ligne');
const panneauProfil = document.getElementById('panneau-profil');

const etat = {
  utilisateur: undefined, // undefined : pas encore connu ; null : déconnecté
  donnees: { statut: 'attente' },
  connexionEnCours: false,
  erreurConnexion: null,
  creationEnCours: false,
  erreurCreation: null,
};

let cleAffichee = '';

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
  cleAffichee = cle;
  document.title = titre;
  const vue = fabriquer();
  if (changementDEcran) vue.classList.add('entree');
  zone.replaceChildren(vue);
  if (changementDEcran && dansApp) {
    window.scrollTo(0, 0);
    zone.focus({ preventScroll: true });
  }
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
    case 'attente':
      if (navigator.onLine) monter('chargement', ecranChargement);
      else monter('reseau-necessaire', () => ecranConnexionNecessaire({ onDeconnecter: seDeconnecter }));
      return;
    case 'refuse':
      monter(`refus|${utilisateur.email}`, () => ecranRefus({ email: utilisateur.email, onChangerCompte: seDeconnecter }));
      return;
    case 'absent':
      monter(`premiere|${etat.creationEnCours}|${etat.erreurCreation}`, () => ecranPremiereOuverture({
        email: utilisateur.email,
        enCours: etat.creationEnCours,
        messageErreur: etat.erreurCreation,
        onDevenirGestionnaire: lancerCreation,
        onDeconnecter: seDeconnecter,
      }));
      return;
    case 'erreur':
      monter(`erreur|${donnees.code}`, () => ecranErreur({ code: donnees.code, onReessayer: suivreDonnees }));
      return;
    default:
      rendreApp();
  }
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

  const { titre, module } = ECRANS[route];
  const cle = `${route}|${role}|${utilisateur.uid}|${reglagesFoyer?.gestionnaire ?? ''}`;
  monter(cle, () => module.afficher({ utilisateur, role, reglages: reglagesFoyer }), {
    dansApp: true,
    titre: `${titre} · ${NOM_APP}`,
  });
}

// ——— Actions ———

async function lancerConnexion() {
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
  etat.donnees = { statut: 'attente' };
  try {
    await deconnecter();
  } catch {
    // Rien à faire : l'état de connexion reste celui annoncé par Firebase.
  }
}

async function lancerCreation() {
  if (!navigator.onLine) {
    etat.erreurCreation = 'Cette étape demande du réseau. Réessayez quand il revient.';
    rendre();
    return;
  }
  etat.creationEnCours = true;
  etat.erreurCreation = null;
  rendre();
  try {
    await devenirGestionnaire(etat.utilisateur.email);
  } catch {
    etat.erreurCreation = 'L’enregistrement n’a pas abouti. Réessayez.';
  } finally {
    etat.creationEnCours = false;
    rendre();
  }
}

function suivreDonnees() {
  etat.donnees = { statut: 'attente' };
  rendre();
  suivreReglages((donnees) => {
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

  window.addEventListener('online', majHorsLigne);
  window.addEventListener('offline', majHorsLigne);
  window.addEventListener('hashchange', rendre);
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

  retourDeRedirection().catch((erreur) => {
    etat.erreurConnexion = messageErreurConnexion(erreur);
    rendre();
  });

  surChangementUtilisateur((utilisateur) => {
    etat.utilisateur = utilisateur;
    etat.erreurCreation = null;
    if (utilisateur) {
      etat.erreurConnexion = null;
      suivreDonnees();
    } else {
      arreterReglages();
      etat.donnees = { statut: 'attente' };
      rendre();
    }
  });
}

demarrer();
