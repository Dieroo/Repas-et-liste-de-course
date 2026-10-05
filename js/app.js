// Démarrage : service worker, connexion, rôle, routeur par hash, indicateur hors ligne.
import {
  configuree,
  surChangementUtilisateur,
  connecter,
  deconnecter,
  messageErreurConnexion,
} from './firebase.js';
import * as donnees from './donnees.js';
import { suivreReglages, arreterReglages, devenirGestionnaire } from './donnees.js';
import { roleDe, roleEffectif, parametreDe, resoudreRoute, gestionnaireADesigner } from './coeur/roles.js';
import { nouveauPlatParNom } from './coeur/plats.js';
import {
  ecranChargement,
  ecranConnexion,
  ecranRefus,
  ecranPremiereOuverture,
  ecranConnexionNecessaire,
  ecranErreur,
  ecranNonConfigure,
} from './ui/connexion.js';
import { ouvrirProfil, initialeDe } from './ui/profil.js';
import { fermerAuToucherDuVoile } from './ui/feuille.js';
import { annoncer } from './ui/dom.js';
import * as semaine from './ui/semaine.js';
import * as courses from './ui/courses.js';
import * as plats from './ui/plats.js';
import * as fiche from './ui/fiche.js';
import * as decouvrir from './ui/decouvrir.js';
import * as reglages from './ui/reglages.js';
import * as importRecettes from './ui/import.js';

// Écrans de l'app. `onglet` : onglet surligné. Un module expose creer(ctx) → { noeud, maj?, detruire? }
// (mis à jour en direct) ou afficher(ctx) → nœud (reconstruit seulement si l'écran change).
const ECRANS = {
  semaine: { titre: 'Semaine', module: semaine, onglet: 'semaine' },
  courses: { titre: 'Courses', module: courses, onglet: 'courses' },
  plats: { titre: 'Plats', module: plats, onglet: 'plats' },
  plat: { titre: 'Plat', module: fiche, onglet: 'plats' },
  decouvrir: { titre: 'Découvrir', module: decouvrir, onglet: 'decouvrir' },
  reglages: { titre: 'Réglages', module: reglages, onglet: null },
  import: { titre: 'Ajouter des recettes', module: importRecettes, onglet: 'plats' },
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
const bandeauApercu = document.getElementById('bandeau-apercu');

const etat = {
  utilisateur: undefined, // undefined : pas encore connu ; null : déconnecté
  donnees: { statut: 'chargement' },
  abonnementDepuis: 0,
  connexionEnCours: false,
  erreurConnexion: null,
  creationEnCours: false,
  erreurCreation: null,
  collectionsSuivies: false,
  profils: [],
  profilsCharges: false,
  plats: [],
  platsCharges: false,
  demandes: [],
  demandesChargees: false,
  apercu: false, // gestionnaire : aperçu de la vue « Repas et courses »
};

let cleAffichee = '';
let vueCourante = null;
let minuteurInjoignable = null;
let routeAffichee = '';
let routePrecedente = '';

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

/**
 * Affiche un écran. Même clé : l'écran en place est seulement mis à jour (s'il sait le faire), sans rejouer
 * l'animation ni perdre la saisie. `fabriquer()` renvoie un nœud ou { noeud, maj?, detruire? }.
 */
function monter(cle, fabriquer, { dansApp = false, titre = NOM_APP, ctx = null } = {}) {
  document.body.classList.toggle('dans-app', dansApp);
  marque.hidden = !dansApp;
  onglets.hidden = !dansApp;
  boutonProfil.hidden = !dansApp;
  if (!dansApp) bandeauApercu.hidden = true;
  if (!dansApp && panneauProfil.open) panneauProfil.close();
  document.title = titre;
  if (cle === cleAffichee) {
    if (ctx) vueCourante?.maj?.(ctx);
    return;
  }

  const changementDEcran = cle.split('|')[0] !== cleAffichee.split('|')[0];
  const focusDansLEcran = zone.contains(document.activeElement);
  // L'ancien écran note ce qu'il veut retrouver (défilement…) avant que le nouveau soit construit.
  vueCourante?.detruire?.();
  const fabrique = fabriquer();
  vueCourante = fabrique instanceof Node ? { noeud: fabrique } : fabrique;
  cleAffichee = cle;
  if (changementDEcran) vueCourante.noeud.classList.add('entree');
  zone.replaceChildren(vueCourante.noeud);
  if (changementDEcran && dansApp) window.scrollTo(0, vueCourante.defilement ?? 0);
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
  const roleReel = roleDe(utilisateur.email, reglagesFoyer);
  if (roleReel !== 'gestionnaire') etat.apercu = false;
  const role = roleEffectif(roleReel, etat.apercu);
  const route = resoudreRoute(location.hash, role);
  const parametre = parametreDe(location.hash, route);
  const hashAttendu = parametre ? `#/${route}/${encodeURIComponent(parametre)}` : `#/${route}`;
  if (location.hash !== hashAttendu) history.replaceState(null, '', hashAttendu);

  if (route !== routeAffichee) {
    routePrecedente = routeAffichee;
    routeAffichee = route;
  }

  const { titre, module, onglet: ongletActif } = ECRANS[route];
  for (const onglet of onglets.querySelectorAll('[data-route]')) {
    if (onglet.dataset.route === ongletActif) onglet.setAttribute('aria-current', 'page');
    else onglet.removeAttribute('aria-current');
  }
  boutonProfil.dataset.initiale = initialeDe(utilisateur);
  bandeauApercu.hidden = !etat.apercu;

  const ctx = {
    utilisateur,
    role,
    roleReel,
    reglages: reglagesFoyer,
    profils: etat.profils,
    profilsCharges: etat.profilsCharges,
    plats: etat.plats,
    platsCharges: etat.platsCharges,
    demandes: etat.demandes,
    demandesChargees: etat.demandesChargees,
    parametre,
    routePrecedente,
    actions,
  };

  // Semaine : la date et la salutation font partie de la clé, l'écran se met à jour si l'app reprend plus tard.
  const maintenant = new Date();
  const moment = route === 'semaine'
    ? `${maintenant.toDateString()}-${maintenant.getHours() >= 18 || maintenant.getHours() < 5}`
    : '';
  const cle = `${route}/${parametre}|${role}|${roleReel}|${utilisateur.uid}|${moment}`;
  const titrePage = route === 'plat' ? etat.plats.find((p) => p.id === parametre)?.nom ?? titre : titre;
  monter(cle, () => (module.creer ? module.creer(ctx) : module.afficher(ctx)), {
    dansApp: true,
    titre: `${titrePage} · ${NOM_APP}`,
    ctx,
  });
}

// ——— Actions des écrans ———

/** Les écritures s'appliquent tout de suite sur le téléphone ; en cas d'échec au serveur, on le dit. */
function ecrire(promesse, messageEchec) {
  promesse.catch(() => annoncer(messageEchec));
}

const actions = {
  ajouterPlat(nom) {
    const resultat = nouveauPlatParNom(nom, etat.plats);
    if (resultat.erreur) return resultat;
    const demanderRecette = roleDe(etat.utilisateur.email, etat.donnees.reglages) !== 'gestionnaire';
    ecrire(donnees.ajouterPlat(resultat.plat, etat.utilisateur.email, { demanderRecette }),
      'Le plat n’a pas pu être enregistré. Réessayez.');
    // Affiché tout de suite ; la copie de Firestore remplace cette version dès son arrivée.
    etat.plats = [...etat.plats, resultat.plat];
    annoncer(demanderRecette
      ? `«\u00A0${resultat.plat.nom}\u00A0» ajouté. La recette est demandée.`
      : `«\u00A0${resultat.plat.nom}\u00A0» ajouté.`);
    return { id: resultat.plat.id };
  },
  suivrePhoto: donnees.suivrePhoto,
  enregistrerPhoto(platId, photo) {
    ecrire(donnees.enregistrerPhoto(platId, photo, etat.utilisateur.email),
      'La photo n’a pas pu être enregistrée. Réessayez.');
  },
  retirerPhoto(platId) {
    ecrire(donnees.retirerPhoto(platId, etat.utilisateur.email), 'La photo n’a pas pu être retirée. Réessayez.');
  },
  enregistrerProfil(profil) {
    ecrire(donnees.enregistrerProfil(profil), 'Le profil n’a pas pu être enregistré. Réessayez.');
  },
  retirerProfil(profilId) {
    ecrire(donnees.retirerProfil(profilId), 'Le profil n’a pas pu être retiré. Réessayez.');
  },
  /** Recettes préparées par coeur/paquet.js › preparerImport. Affichées tout de suite, envoyées dès que possible. */
  importer({ ecritures, demandesAClore }) {
    ecrire(donnees.importer({ ecritures, demandesAClore }, etat.utilisateur.email),
      'Les recettes n’ont pas pu être enregistrées. Réessayez.');
    const recus = new Map(ecritures.map(({ id, donnees: champs }) => [id, champs]));
    etat.plats = [
      ...etat.plats.map((plat) => (recus.has(plat.id) ? { ...plat, ...recus.get(plat.id) } : plat)),
      ...ecritures.filter(({ id }) => !etat.plats.some((plat) => plat.id === id)).map(({ donnees: champs }) => champs),
    ];
    etat.demandes = etat.demandes.map((demande) => (demandesAClore.includes(demande.id)
      ? { ...demande, statut: 'traitee' }
      : demande));
  },
};

function changerApercu(actif) {
  etat.apercu = actif;
  rendre();
  annoncer(actif ? 'Aperçu de la vue «\u00A0Repas et courses\u00A0».' : 'Retour à votre vue.');
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

function oublierDonnees() {
  arreterReglages();
  donnees.arreterCollections();
  Object.assign(etat, {
    donnees: { statut: 'chargement' },
    collectionsSuivies: false,
    profils: [],
    profilsCharges: false,
    plats: [],
    platsCharges: false,
    demandes: [],
    demandesChargees: false,
    apercu: false,
  });
}

async function seDeconnecter() {
  oublierDonnees();
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
  suivreReglages((recu) => {
    let suivi = recu;
    if (suivi.statut === 'ok') {
      if (!suivi.depuisCache) confirmerCompte(uid);
      else if (!compteConfirme(uid)) suivi = { statut: 'injoignable' };
    }
    etat.donnees = suivi;
    if (suivi.statut === 'ok' && !etat.collectionsSuivies) {
      etat.collectionsSuivies = true;
      donnees.suivreCollections((maj) => {
        Object.assign(etat, maj);
        if (maj.plats) etat.platsCharges = true;
        if (maj.profils) etat.profilsCharges = true;
        if (maj.demandes) etat.demandesChargees = true;
        rendre();
      }, (code) => {
        donnees.arreterCollections();
        etat.collectionsSuivies = false;
        etat.donnees = { statut: 'erreur', code };
        rendre();
      });
    } else if ((suivi.statut === 'refuse' || suivi.statut === 'erreur') && etat.collectionsSuivies) {
      donnees.arreterCollections();
      etat.collectionsSuivies = false;
    }
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
      apercu: etat.apercu,
      onReglages: () => { location.hash = '#/reglages'; },
      onAjouterRecettes: () => { location.hash = '#/import'; },
      onApercu: changerApercu,
      onDeconnecter: seDeconnecter,
    });
  });
  document.getElementById('quitter-apercu').addEventListener('click', () => changerApercu(false));

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
      oublierDonnees();
      rendre();
    }
  });
}

demarrer();
