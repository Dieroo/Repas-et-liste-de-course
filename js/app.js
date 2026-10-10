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
import { roleDe, roleEffectif, parametreDe, resoudreRoute, gestionnaireADesigner, normaliserEmail } from './coeur/roles.js';
import { nouveauPlatParNom, demandeDeRecette } from './coeur/plats.js';
import { idDemande, demandeOuverte, demandeUtile, demandesATraiter, preparerDemande } from './coeur/demandes.js';
import {
  SIGNES_SUJET, sujetValide, nouveauSujet, texteNotification, adresseNotification, issueEnvoi,
} from './coeur/ntfy.js';
import { envoyerNtfy } from './notifications.js';
import { estDansCorbeille, separerCorbeille, demandesDesPlats } from './coeur/corbeille.js';
import { profilDeLEmail, profilsARelier, preparerReliure, preparerDeliure } from './coeur/profils.js';
import { avecNote, cheminNote, noteValide } from './coeur/notes.js';
import { creerSauvegarde, dateDeSauvegarde } from './coeur/sauvegarde.js';
import { evaluer, bilanCompatibilite } from './coeur/compatibilite.js';
import { precautionsAge, profilsAvecAge, bilanPrecautions } from './coeur/age.js';
import { marqueursSurveilles } from './coeur/regles.js';
import { appliquerImport, profilsDesVersions, versionsEcrites, annonceVersions } from './coeur/import-local.js';
import { VERSION_INSTRUCTIONS } from './coeur/claude.js';
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
import { ouvrirQuiEtesVous } from './ui/relier.js';
import { annoncer } from './ui/dom.js';
import * as semaine from './ui/semaine.js';
import * as courses from './ui/courses.js';
import * as plats from './ui/plats.js';
import * as fiche from './ui/fiche.js';
import * as modifier from './ui/modifier.js';
import * as decouvrir from './ui/decouvrir.js';
import * as reglages from './ui/reglages.js';
import * as importRecettes from './ui/import.js';
import * as restaurer from './ui/restaurer.js';
import * as regime from './ui/regime.js';
import * as ecranDemandes from './ui/demandes.js';
import { telecharger } from './ui/fichier.js';
import { effacerBrouillons } from './ui/brouillon.js';
import {
  lireEnvoyes, noterEnvoyes, effacerEnvoyes, lireInstructionsCopiees, noterInstructionsCopiees,
  lireRelectureEnCours, noterRelectureEnCours,
} from './ui/envoyes.js';
import { annonceRelecture, bilanRelecture, platsARelire } from './coeur/relecture.js';

// Écrans de l'app. `onglet` : onglet surligné ; `sansOnglets` : barre d'onglets masquée (pas de sortie
// accidentelle pendant une saisie). Un module expose creer(ctx) → { noeud, maj?, detruire? } (mis à jour en direct)
// ou afficher(ctx) → nœud (reconstruit seulement si l'écran change).
// `avecCorbeille` : `ctx.plats` garde aussi les plats de la corbeille. « Modifier » : un plat mis à la corbeille sur
// l'autre téléphone pendant la saisie n'y passe pas pour supprimé (la saisie et son brouillon restent, l'enregistrement
// marche) ; produits connus et noms déjà pris se lisent sur tous les plats.
const ECRANS = {
  semaine: { titre: 'Semaine', module: semaine, onglet: 'semaine' },
  courses: { titre: 'Courses', module: courses, onglet: 'courses' },
  plats: { titre: 'Plats', module: plats, onglet: 'plats' },
  plat: { titre: 'Plat', module: fiche, onglet: 'plats' },
  modifier: { titre: 'Modifier la recette', module: modifier, onglet: 'plats', sansOnglets: true, avecCorbeille: true },
  decouvrir: { titre: 'Découvrir', module: decouvrir, onglet: 'decouvrir' },
  reglages: { titre: 'Réglages', module: reglages, onglet: null },
  import: { titre: 'Ajouter des recettes', module: importRecettes, onglet: 'plats' },
  restaurer: { titre: 'Restaurer une sauvegarde', module: restaurer, onglet: null },
  regime: { titre: 'Ce que mange', module: regime, onglet: null, sansOnglets: true },
  demandes: { titre: 'Demandes', module: ecranDemandes, onglet: null },
};

const NOM_APP = 'Repas & Courses';

// Délai avant d'annoncer que les données sont injoignables alors que le téléphone a du réseau.
const DELAI_INJOIGNABLE_MS = 4000;

// « 📬 Demander » (T2e) : un second toucher sur la même demande, pendant ce délai, n'écrit rien (verrou en mémoire, en
// plus de la demande déjà ouverte dans l'état local).
const DELAI_VERROU_DEMANDE_MS = 2000;
// Notification différée (T2e) : après l'accusé du serveur, attente au plus de ce délai que la copie du téléphone soit
// confirmée par le serveur ; au-delà, l'envoi juge sur l'état du moment.
const DELAI_CONFIRMATION_MS = 10000;

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
  version: null, // { version, publiee } du service worker qui a servi l'app ; null : inconnue
  versionPrete: false, // une version plus récente est installée : elle s'applique à la prochaine ouverture
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
  profilsDepuisCache: false, // copie du téléphone, pas encore confirmée par le serveur
  plats: [], // tous les plats, corbeille comprise (separerCorbeille pour les écrans)
  platsCharges: false,
  platsDepuisCache: false,
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
function monter(cle, fabriquer, { dansApp = false, sansOnglets = false, titre = NOM_APP, ctx = null } = {}) {
  document.body.classList.toggle('dans-app', dansApp);
  document.body.classList.toggle('sans-onglets', dansApp && sansOnglets);
  marque.hidden = !dansApp;
  onglets.hidden = !dansApp || sansOnglets;
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

/** Feuille « Qui êtes-vous ? » ouverte (fiche, panneau du profil), mise à jour à chaque rendu ; null sinon. */
let feuilleQuiEtesVous = null;
/** Vrai si le dernier rendu a affiché l'app elle-même (et non la connexion, une erreur, la première ouverture…). */
let appRendue = false;

function rendre() {
  appRendue = false;
  rendreEcran();
  // Hors de l'app (déconnexion, erreur…), la feuille n'a plus lieu d'être ; dans l'app, prénoms et adresses à jour.
  if (!feuilleQuiEtesVous) return;
  if (appRendue) feuilleQuiEtesVous.maj(contexteCourant());
  else feuilleQuiEtesVous.fermer();
}

function rendreEcran() {
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

/** Rôle réel, rôle affiché (aperçu compris), écran demandé et son paramètre, d'après l'état et l'adresse. */
function routeCourante() {
  const roleReel = roleDe(etat.utilisateur.email, etat.donnees.reglages);
  const role = roleEffectif(roleReel, etat.apercu);
  let route = resoudreRoute(location.hash, role);
  let parametre = parametreDe(location.hash, route);
  // « Ce que <Prénom> mange » d'un profil inconnu (retiré entre-temps) : retour aux Réglages, une fois les profils lus.
  if (route === 'regime' && etat.profilsCharges && !etat.profils.some((profil) => profil.id === parametre)) {
    route = 'reglages';
    parametre = '';
  }
  return { roleReel, role, route, parametre };
}

// Compatibilité d'un plat pour un profil (coeur/compatibilite.js › evaluer), gardée tant que plats et profils sont
// les mêmes objets : un instantané nouveau (règle, recette, profil changés) recalcule tout, partout (§7).
let memoCompat = { plats: null, profils: null, resultats: new WeakMap() };

function compat(plat, profil) {
  if (!plat || typeof plat !== 'object' || !profil || typeof profil !== 'object') return evaluer(plat, profil);
  if (memoCompat.plats !== etat.plats || memoCompat.profils !== etat.profils) {
    memoCompat = { plats: etat.plats, profils: etat.profils, resultats: new WeakMap() };
  }
  let parProfil = memoCompat.resultats.get(plat);
  if (!parProfil) {
    parProfil = new WeakMap();
    memoCompat.resultats.set(plat, parProfil);
  }
  if (!parProfil.has(profil)) parProfil.set(profil, evaluer(plat, profil));
  return parProfil.get(profil);
}

// Précautions selon l'âge d'un plat pour un profil (coeur/age.js › precautionsAge), jugées sur le plat tel qu'il lui
// serait servi : la recette, ou la version que `compat` retient pour lui (régime d'un enfant, cas mixte). Gardées comme
// `compat`, tant que plats et profils sont les mêmes objets : une date, une règle ou une recette changées recalculent
// tout, partout.
let memoPrecautions = { plats: null, profils: null, resultats: new WeakMap() };

function precautions(plat, profil) {
  if (!plat || typeof plat !== 'object' || !profil || typeof profil !== 'object') return precautionsAge(plat, profil);
  if (memoPrecautions.plats !== etat.plats || memoPrecautions.profils !== etat.profils) {
    memoPrecautions = { plats: etat.plats, profils: etat.profils, resultats: new WeakMap() };
  }
  let parProfil = memoPrecautions.resultats.get(plat);
  if (!parProfil) {
    parProfil = new WeakMap();
    memoPrecautions.resultats.set(plat, parProfil);
  }
  if (!parProfil.has(profil)) {
    parProfil.set(profil, precautionsAge(plat, profil, { variante: compat(plat, profil)?.variante ?? null }));
  }
  return parProfil.get(profil);
}

// Profils qui ont au moins une précaution d'âge active (coeur/age.js › profilsAvecAge), gardés tant que `etat.profils`
// est le même tableau.
let memoProfilsAvecAge = { profils: null, resultat: [] };

function profilsAvecAgeCourants() {
  if (memoProfilsAvecAge.profils !== etat.profils) {
    memoProfilsAvecAge = { profils: etat.profils, resultat: profilsAvecAge(etat.profils) };
  }
  return memoProfilsAvecAge.resultat;
}

// Marqueurs que surveille une règle active d'un profil (coeur/regles.js › marqueursSurveilles) : cases « Repères » de
// « Modifier » et bandeau « à vérifier » de la fiche (T2c-2). Gardés tant que `etat.profils` est le même tableau.
let memoSurveilles = { profils: null, resultat: new Set() };

function surveillesCourants() {
  if (memoSurveilles.profils !== etat.profils) {
    memoSurveilles = { profils: etat.profils, resultat: marqueursSurveilles(etat.profils) };
  }
  return memoSurveilles.resultat;
}

/** Date du téléphone, au fuseau du téléphone : 'AAAA-MM-JJ' (âge de l'enfant, coeur/age.js). */
function dateDuJour(maintenant = new Date()) {
  const deux = (n) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
}

// Plats actifs et corbeille (coeur/corbeille.js › separerCorbeille), gardés tant que `etat.plats` est le même tableau :
// les écrans reçoivent les mêmes listes d'un rendu à l'autre (mémos par tableau, comme le catalogue des produits).
let memoCorbeille = { plats: null, actifs: [], corbeille: [] };

function platsSepares() {
  if (memoCorbeille.plats !== etat.plats) {
    const { actifs, corbeille } = separerCorbeille(etat.plats);
    memoCorbeille = { plats: etat.plats, actifs, corbeille };
  }
  return memoCorbeille;
}

// Instructions du projet Claude copiées pendant cette visite ({ uid, version }) : repli si le stockage du téléphone
// est plein ou bloqué, pour que le rappel ne revienne pas avant la prochaine ouverture.
let instructionsCopieesIci = null;

/**
 * Les instructions de cette version de l'app ont été copiées : sur n'importe quel appareil du gestionnaire
 * (`reglages/foyer.instructionsCopiees`, une version plus récente compte aussi), ou par ce compte sur ce téléphone
 * (repli tant que l'écriture n'est pas revenue du serveur). Rappel sinon.
 */
function instructionsAJour() {
  const uid = etat.utilisateur?.uid;
  if (!uid) return true;
  const partagee = etat.donnees.reglages?.instructionsCopiees;
  return (Number.isInteger(partagee) && partagee >= VERSION_INSTRUCTIONS)
    || lireInstructionsCopiees(uid) === VERSION_INSTRUCTIONS
    || (instructionsCopieesIci?.uid === uid && instructionsCopieesIci.version === VERSION_INSTRUCTIONS);
}

/**
 * Contexte passé aux écrans, et aux feuilles ouvertes hors du rendu (panneau du profil, « Qui êtes-vous ? ») : il
 * est recalculé à chaque appel, pour des profils et des plats à jour.
 * `moi` : profil relié à l'adresse connectée, ou null ; en aperçu « Repas et courses », celui du gestionnaire.
 * `plats` : les plats actifs seulement (un plat de la corbeille disparaît partout), sauf pour un écran `avecCorbeille`
 * (ECRANS) ; `platsCorbeille` : la corbeille, du plus récent au plus ancien ; `tousLesPlats` : les deux (ajout de
 * recettes, ajout par nom, « déjà dans l'app » des idées de plats, fiche ouverte par un lien).
 * `instructionsAJour` : faux tant que les instructions du projet Claude de cette version n'ont pas été copiées ici.
 * Précautions selon l'âge (T2c-1) : `aujourdhui`, date du téléphone 'AAAA-MM-JJ' (au fuseau du téléphone, recalculée
 * à chaque rendu) ; `precautions(plat, profil)`, précautions d'âge du plat tel qu'il serait servi au profil (mémo, comme
 * `compat`) ; `profilsAvecAge`, profils qui ont une précaution d'âge active (ordre des profils) ;
 * `empreintePrecautions(profil)`, empreinte de ses `regles` et de sa `naissance`, à relever à l'ouverture de « 🧸 Ce que
 * <Enfant> mange » et à passer à `actions.enregistrerPrecautions`.
 * Repères à la main (T2c-2) : `surveilles`, marqueurs que surveille une règle active d'un profil (Set, même objet tant
 * que les profils ne changent pas).
 * Demandes (T2e) : `aTraiter`, demandes encore utiles (coeur/demandes.js › demandesATraiter : la plus ancienne
 * d'abord), seule source de la carte 📬 de Semaine, du panneau du profil et de l'écran Demandes ; [] tant que demandes,
 * plats et profils ne sont pas tous chargés.
 */
function contexteCourant() {
  const { utilisateur } = etat;
  const { role, roleReel, route, parametre } = routeCourante();
  const { actifs, corbeille } = platsSepares();
  const aTraiter = etat.demandesChargees && etat.platsCharges && etat.profilsCharges
    ? demandesATraiter(etat.demandes, { plats: actifs, profils: etat.profils, evaluer: compat })
    : [];
  return {
    utilisateur,
    role,
    roleReel,
    reglages: etat.donnees.reglages,
    profils: etat.profils,
    profilsCharges: etat.profilsCharges,
    moi: profilDeLEmail(etat.profils, utilisateur.email),
    plats: ECRANS[route]?.avecCorbeille ? etat.plats : actifs,
    platsCorbeille: corbeille,
    tousLesPlats: etat.plats,
    platsCharges: etat.platsCharges,
    demandes: etat.demandes,
    demandesChargees: etat.demandesChargees,
    aTraiter,
    parametre,
    routePrecedente,
    instructionsAJour: instructionsAJour(),
    compat,
    aujourdhui: dateDuJour(),
    precautions,
    profilsAvecAge: profilsAvecAgeCourants(),
    empreintePrecautions: donnees.empreintePrecautions,
    surveilles: surveillesCourants(),
    actions,
  };
}

function rendreApp() {
  appRendue = true;
  const { utilisateur } = etat;
  if (roleDe(utilisateur.email, etat.donnees.reglages) !== 'gestionnaire') etat.apercu = false;
  const { role, roleReel, route, parametre } = routeCourante();
  const hashAttendu = parametre ? `#/${route}/${encodeURIComponent(parametre)}` : `#/${route}`;
  if (location.hash !== hashAttendu) history.replaceState(history.state, '', hashAttendu);

  if (route !== routeAffichee) {
    // Écran d'où l'on venait, gardé dans l'entrée d'historique : un retour arrière (après « Enregistrer », par
    // exemple) le retrouve, et le lien retour de la fiche n'ajoute pas d'entrée.
    const memorisee = history.state?.precedente;
    routePrecedente = typeof memorisee === 'string' ? memorisee : routeAffichee;
    if (typeof memorisee !== 'string') {
      history.replaceState({ ...(history.state ?? {}), precedente: routePrecedente }, '', location.hash);
    }
    routeAffichee = route;
  }

  const { titre, module, onglet: ongletActif, sansOnglets = false } = ECRANS[route];
  for (const onglet of onglets.querySelectorAll('[data-route]')) {
    if (onglet.dataset.route === ongletActif) onglet.setAttribute('aria-current', 'page');
    else onglet.removeAttribute('aria-current');
  }
  boutonProfil.dataset.initiale = initialeDe(utilisateur);
  bandeauApercu.hidden = !etat.apercu;

  // Après la mise à jour de routePrecedente, que le contexte reprend.
  const ctx = contexteCourant();

  // Semaine : la date et la salutation font partie de la clé, l'écran se met à jour si l'app reprend plus tard.
  const maintenant = new Date();
  const moment = route === 'semaine'
    ? `${maintenant.toDateString()}-${maintenant.getHours() >= 18 || maintenant.getHours() < 5}`
    : '';
  const cle = `${route}/${parametre}|${role}|${roleReel}|${utilisateur.uid}|${moment}`;
  // Fiche : « <nom du plat> · Repas & Courses » ; modification : « <nom du plat> · Modifier · Repas & Courses ».
  const nomPlat = route === 'plat' || route === 'modifier' ? etat.plats.find((p) => p.id === parametre)?.nom : undefined;
  let titrePage = titre;
  if (nomPlat) titrePage = route === 'modifier' ? `${nomPlat} · Modifier` : nomPlat;
  const nomProfil = route === 'regime' ? etat.profils.find((p) => p.id === parametre)?.nom : undefined;
  if (nomProfil) titrePage = `Ce que ${nomProfil} mange`;
  monter(cle, () => (module.creer ? module.creer(ctx) : module.afficher(ctx)), {
    dansApp: true,
    sansOnglets,
    titre: `${titrePage} · ${NOM_APP}`,
    ctx,
  });
}

// ——— Actions des écrans ———

/** Les écritures s'appliquent tout de suite sur le téléphone ; en cas d'échec au serveur, on le dit. */
function ecrire(promesse, messageEchec) {
  promesse.catch(() => annoncer(messageEchec));
}

// Instructions du projet Claude, lues une fois (actions.lireInstructionsClaude).
let instructionsClaude = null;

const actions = {
  /**
   * Ajoute un plat par son nom (⏳). Rôle effectif « Repas et courses » (aperçu compris, T2e) : la demande de recette
   * part dans le même lot, s'affiche tout de suite (la fiche, ouverte aussitôt, dit « 📬 Demandée… ») et le
   * gestionnaire est prévenu (prevenirDemande). → { id } ou { erreur } (coeur/plats.js › nouveauPlatParNom).
   */
  ajouterPlat(nom) {
    const resultat = nouveauPlatParNom(nom, etat.plats);
    if (resultat.erreur) return resultat;
    const demanderRecette = roleCourant() !== 'gestionnaire';
    const email = etat.utilisateur.email;
    const envoi = donnees.ajouterPlat(resultat.plat, email, { demanderRecette });
    ecrire(envoi, 'Le plat n’a pas pu être enregistré. Réessayez.');
    // Affiché tout de suite ; la copie de Firestore remplace cette version dès son arrivée.
    etat.plats = [...etat.plats, resultat.plat];
    if (demanderRecette) {
      const demande = demandeDeRecette(resultat.plat.id, email);
      insererDemande(demande);
      const jeton = Symbol(demande.id);
      jetonsDemandes.set(demande.id, jeton);
      prevenirDemande(demande.id, 'recette', resultat.plat, envoi, jeton);
    }
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
  /**
   * « Ce que <Prénom> mange » : la liste entière des règles du profil (coeur/regles.js › ecrireRegime). Appliquée tout
   * de suite sur ce téléphone, envoyée dès que possible (hors ligne : plus tard) ; l'envoi n'est jamais attendu. Un
   * refus (profil retiré entre-temps sur l'autre appareil) est annoncé. → undefined.
   */
  enregistrerRegles(profilId, regles) {
    const nom = etat.profils.find((profil) => profil.id === profilId)?.nom;
    const echec = nom
      ? `Ce que ${nom} mange n’a pas pu être enregistré. Réessayez.`
      : 'Ce réglage n’a pas pu être enregistré. Réessayez.';
    try {
      ecrire(donnees.enregistrerRegles(profilId, regles), echec);
    } catch {
      annoncer(echec);
      return;
    }
    etat.profils = etat.profils.map((profil) => (profil.id === profilId ? { ...profil, regles } : profil));
  },
  /**
   * « 🧸 Ce que <Enfant> mange » (gestionnaire) : règles du profil (liste entière : régime, précautions d'âge, règles
   * gardées) et date de naissance (`'AAAA-MM-JJ'`, ou null pour l'effacer), par une transaction qui relit le profil
   * (donnees.js › enregistrerPrecautions). `empreinteOuverture` : `ctx.empreintePrecautions(profil)` relevée à
   * l'ouverture de l'écran (ou à « Voir les nouveaux »).
   * En ligne seulement : hors ligne, rien n'est écrit ni mis en file, le brouillon reste sur l'écran. Réussi : appliqué
   * tout de suite sur ce téléphone, puis annonce « C’est noté. 3 plats repérés comme pas encore pour <Enfant>. » (ou
   * « C’est noté. »). Un échec imprévu (réseau coupé en route, profil retiré entre-temps) est aussi annoncé.
   * → promesse de { code, message } (jamais rejetée) : ok (message null), hors_ligne, conflit (réglages changés sur
   *   l'autre appareil depuis l'ouverture), absent (profil retiré), refuse (pas gestionnaire), echec ; `message` : texte
   *   à montrer sur l'écran, ou null (ok, refuse, ou personne connectée changée entre-temps).
   */
  async enregistrerPrecautions(profilId, { regles, naissance = null, empreinteOuverture } = {}) {
    const role = roleEffectif(roleDe(etat.utilisateur?.email, etat.donnees.reglages), etat.apercu);
    if (role !== 'gestionnaire') return { code: 'refuse', message: null };
    const horsLigne = { code: 'hors_ligne', message: 'Il faut être connecté pour enregistrer ses précautions.' };
    if (!navigator.onLine) return horsLigne;
    const nom = nomDuProfil(etat.profils.find((profil) => profil.id === profilId));
    const echec = `Ce que ${nom} mange n’a pas pu être enregistré. Réessayez.`;
    const uid = etat.utilisateur.uid;
    let resultat;
    try {
      resultat = await donnees.enregistrerPrecautions(profilId, { regles, naissance, empreinteOuverture });
    } catch {
      if (etat.utilisateur?.uid !== uid) return { code: 'echec', message: null };
      annoncer(echec);
      return { code: 'echec', message: echec };
    }
    const code = resultat?.code;
    if (etat.utilisateur?.uid !== uid) return { code: code ?? 'echec', message: null };
    switch (code) {
      case 'ok':
        break;
      case 'hors_ligne':
        return horsLigne;
      case 'conflit':
        return { code, message: 'Ces réglages ont changé sur l’autre appareil.' };
      case 'absent':
        annoncer('Ce profil n’existe plus.');
        return { code, message: 'Ce profil n’existe plus.' };
      default:
        annoncer(echec);
        return { code: 'echec', message: echec };
    }
    // Appliqué tout de suite ; la copie de Firestore suit. Pas de rendu ici : l'écran se ferme de lui-même.
    const date = naissance === '' ? null : naissance;
    etat.profils = etat.profils.map((profil) => {
      if (profil.id !== profilId) return profil;
      const maj = { ...profil, regles };
      if (date) maj.naissance = date;
      else delete maj.naissance;
      return maj;
    });
    const profil = etat.profils.find((p) => p.id === profilId);
    let reperes = 0;
    if (profil && etat.platsCharges) {
      // Plats actifs seulement : un plat de la corbeille n'est jamais servi.
      const { exclus } = bilanPrecautions(platsSepares().actifs, profil, { precautions }) ?? {};
      reperes = Array.isArray(exclus) ? exclus.length : Number(exclus) || 0;
    }
    if (reperes > 1) annoncer(`C’est noté. ${reperes}\u00A0plats repérés comme pas encore pour ${nom}.`);
    else if (reperes === 1) annoncer(`C’est noté. 1\u00A0plat repéré comme pas encore pour ${nom}.`);
    else annoncer('C’est noté.');
    return { code: 'ok', message: null };
  },
  /**
   * Recettes et versions préparées par coeur/paquet.js › preparerImport (CLAUDE.md §8, T2b). Affichées tout de suite
   * (coeur/import-local.js › appliquerImport : une version ne crée jamais de plat sur ce téléphone).
   * - Fiches complètes : envoyées dès que possible (hors ligne : plus tard), comme en T1b ; un échec est annoncé.
   * - Versions : demandent du réseau (une transaction par plat). Hors ligne, rien n'est écrit ni affiché : la promesse
   *   est rejetée avec `code: 'hors_ligne'` et le message à montrer. Une fois envoyées, l'annonce « 9 versions
   *   ajoutées. 14 plats attendent encore une version pour <Prénom>. » suit, avec le nom de chaque plat disparu
   *   entre-temps ; un échec est annoncé, et la promesse est rejetée avec `code: 'echec'`.
   * → promesse de { manquants: [nom] } (noms des plats disparus avant l'envoi de leur version) ; sans version,
   *   résolue tout de suite avec { manquants: [] }.
   * Demandes satisfaites (T2e : l'écran Demandes et la carte 📬 en dépendent) : closes tout de suite sur ce téléphone
   * pour les fiches complètes, comme donnees.importer ; celles des versions seulement après leurs transactions, sauf
   * pour un plat disparu entre-temps, et jamais si les versions échouent (la demande reste affichée). Versions
   * échouées : la fiche affichée d'avance revient à ce qu'elle était, si aucun instantané ne l'a remplacée.
   */
  importer({ ecritures, demandesAClore }) {
    const aVersions = ecritures.some((ecriture) => ecriture.mode === 'versions');
    const aRelectures = ecritures.some((ecriture) => ecriture.mode === 'precautions');
    if (aRelectures && !navigator.onLine) {
      return Promise.reject(Object.assign(new Error('Il faut être connecté pour enregistrer la relecture.'), { code: 'hors_ligne' }));
    }
    if (aVersions && !navigator.onLine) {
      return Promise.reject(Object.assign(new Error('Il faut être connecté pour ajouter des versions.'), { code: 'hors_ligne' }));
    }
    if (aRelectures) return importerRelecture(ecritures);
    // Noms lus avant l'envoi : un plat disparu entre-temps n'est plus dans la liste quand la réponse arrive.
    const nomsAvant = new Map(etat.plats.map((plat) => [plat.id, plat.nom]));
    const { envoi, versions } = donnees.importer({ ecritures, demandesAClore }, etat.utilisateur.email);
    ecrire(envoi, 'Les recettes n’ont pas pu être enregistrées. Réessayez.');
    const platsAvant = new Map(etat.plats.map((plat) => [plat?.id, plat]));
    etat.plats = appliquerImport(etat.plats, ecritures);
    // Même règle que donnees.importer : une demande dont le plat reçoit des versions attend leurs transactions.
    const idsVersions = new Set(ecritures.filter((ecriture) => ecriture.mode === 'versions').map(({ id }) => id));
    const platDe = (demande) => String(demande).split('__')[0];
    const aClore = Array.isArray(demandesAClore) ? demandesAClore : [];
    cloreDemandes(aClore.filter((demande) => !idsVersions.has(platDe(demande))));
    if (!aVersions) {
      versions.catch(() => {});
      return Promise.resolve({ manquants: [] });
    }
    const uid = etat.utilisateur.uid;
    // Fiches qui montrent d'avance les versions reçues (objets de appliquerImport, remplacés par le prochain instantané).
    const affichees = new Map(etat.plats.filter((plat) => idsVersions.has(plat?.id)).map((plat) => [plat.id, plat]));
    return versions.then(({ manquants }) => {
      const noms = manquants.map((id) => String(nomsAvant.get(id) ?? id));
      if (etat.utilisateur?.uid !== uid) return { manquants: noms };
      const absents = new Set(manquants);
      cloreDemandes(aClore.filter((demande) => idsVersions.has(platDe(demande)) && !absents.has(platDe(demande))));
      rendre();
      const parProfil = profilsDesVersions(ecritures).map((pour) => {
        const profil = etat.profils.find((p) => p.id === pour);
        // Plats actifs seulement : un plat de la corbeille n'attend pas de version.
        const bilan = profil ? bilanCompatibilite(platsSepares().actifs, profil, { evaluer: compat }) : null;
        return {
          nom: profil?.nom ?? '',
          ajoutees: versionsEcrites(ecritures, pour, manquants),
          restants: bilan?.aCreer ?? 0,
          // Plats dont une version convient, mais pas encore de chaque style attendu (« 3 plats à compléter… »).
          aCompleter: bilan?.aCompleter ?? 0,
        };
      });
      const texte = annonceVersions(parProfil, noms);
      if (texte) annoncer(texte);
      return { manquants: noms };
    }, (erreur) => {
      if (etat.utilisateur?.uid === uid) {
        // Une transaction ratée n'écrit rien : aucun instantané ne corrigerait la fiche affichée d'avance.
        etat.plats = etat.plats.map((plat) => (plat && affichees.get(plat.id) === plat && platsAvant.has(plat.id)
          ? platsAvant.get(plat.id)
          : plat));
        rendre();
      }
      annoncer('Les versions n’ont pas pu être enregistrées. Réessayez.');
      throw Object.assign(new Error('Les versions n’ont pas pu être enregistrées.'), { code: 'echec', cause: erreur });
    });
  },
  /**
   * Texte des instructions du projet Claude (`docs/projet-claude.md`, gardé par le service worker : lu tout de suite,
   * hors ligne compris). Lu une fois ; un échec n'est pas retenu, le toucher suivant relit.
   * → promesse du texte ; rejetée si le fichier n'a pas pu être lu.
   */
  lireInstructionsClaude() {
    if (!instructionsClaude) {
      instructionsClaude = fetch('./docs/projet-claude.md')
        .then((reponse) => {
          if (!reponse.ok) throw new Error(`Instructions illisibles (${reponse.status}).`);
          return reponse.text();
        })
        .then((texte) => {
          if (!texte.trim()) throw new Error('Instructions vides.');
          return texte;
        });
      instructionsClaude.catch(() => {
        instructionsClaude = null;
      });
    }
    return instructionsClaude;
  },
  /** Instructions du projet Claude copiées (Réglages) : le rappel disparaît de la carte et du panneau du profil. */
  noterInstructionsCopiees() {
    const uid = etat.utilisateur?.uid;
    if (!uid) return;
    noterInstructionsCopiees(uid, VERSION_INSTRUCTIONS);
    instructionsCopieesIci = { uid, version: VERSION_INSTRUCTIONS };
    // Partagée avec les autres appareils du gestionnaire ; un échec laisse le rappel ailleurs, sans gêner ici.
    if (etat.donnees.reglages && Number(etat.donnees.reglages.instructionsCopiees ?? 0) < VERSION_INSTRUCTIONS) {
      donnees.noterInstructionsCopiees(VERSION_INSTRUCTIONS).catch(() => {});
    }
    rendre();
  },
  /**
   * Recette modifiée à la main, préparée par coeur/edition.js › preparerModification. Affichée tout de suite
   * (l'écran revient à la fiche), envoyée dès que possible. `modifieeLe` reste null jusqu'à la confirmation.
   */
  modifierPlat(id, { champs, supprimer = [], demandesAClore = [] }) {
    const email = etat.utilisateur.email;
    ecrire(donnees.modifierPlat(id, { champs, supprimer }, demandesAClore, email),
      'La recette n’a pas pu être enregistrée. Réessayez.');
    etat.plats = etat.plats.map((plat) => {
      if (plat.id !== id) return plat;
      const maj = { ...plat, ...champs, modifieePar: email, modifieeLe: null };
      if (champs.conservation) maj.conservation = { ...(plat.conservation ?? {}), ...champs.conservation };
      for (const champ of supprimer) delete maj[champ];
      return maj;
    });
    cloreDemandes(demandesAClore);
  },
  /**
   * Note d'un profil (0 à 5, ou null pour l'effacer). Affichée tout de suite, hors ligne compris (les écrans en place
   * sont mis à jour pendant l'appel) ; l'envoi n'est jamais attendu. Deux notes de suite : Firestore garde l'ordre des
   * écritures d'un même téléphone, la dernière gagne. Refus du serveur : surEchec('supprime') si le plat n'existe
   * plus, surEchec('echec') sinon ; sans surEchec, une annonce.
   */
  noter(platId, profilId, note, { surEchec } = {}) {
    const echouer = (erreur) => {
      if (surEchec) surEchec(erreur?.code === 'not-found' ? 'supprime' : 'echec');
      else annoncer('La note n’a pas pu être enregistrée. Réessayez.');
    };
    // Chemin ou note refusés : rien n'est écrit ni affiché. Signalé après coup, comme un refus du serveur.
    if (!cheminNote(profilId) || (note !== null && !noteValide(note))) {
      Promise.reject(new Error('note refusée')).catch(echouer);
      return;
    }
    // Affichée avant l'envoi : un instantané reçu pendant l'envoi voit déjà le plat noté.
    etat.plats = etat.plats.map((plat) => (plat.id === platId ? avecNote(plat, profilId, note) : plat));
    try {
      donnees.noterPlat(platId, profilId, note).catch(echouer);
    } catch (erreur) {
      Promise.reject(erreur).catch(echouer);
    }
    rendre();
  },
  /**
   * Met des plats à la corbeille (les deux membres ; fiche, bandeau « Personne n'en veut »). Appliqué tout de suite sur
   * ce téléphone, hors ligne compris, envoyé dès que possible ; un échec est annoncé. Annonce « « X » est dans la
   * corbeille. » ou « N plats mis à la corbeille. », avec « Annuler », qui les remet. Les plats inconnus ou déjà dans
   * la corbeille sont ignorés. → undefined.
   */
  mettreALaCorbeille(platIds) {
    const vises = platsVises(platIds, (plat) => !estDansCorbeille(plat));
    if (!vises.length) return;
    const ids = vises.map((plat) => plat.id);
    const email = etat.utilisateur.email;
    const echec = vises.length === 1
      ? `«\u00A0${vises[0].nom}\u00A0» n’a pas pu être mis à la corbeille. Réessayez.`
      : 'Les plats n’ont pas pu être mis à la corbeille. Réessayez.';
    let envoi;
    try {
      envoi = donnees.mettreALaCorbeille(ids, email);
    } catch {
      annoncer(echec);
      return;
    }
    ecrire(envoi, echec);
    // Date du téléphone en attendant celle du serveur (la copie de Firestore la remplace dès son arrivée).
    const marque = { le: new Date(), par: email };
    const parId = new Set(ids);
    etat.plats = etat.plats.map((plat) => (parId.has(plat.id) ? { ...plat, corbeille: marque } : plat));
    rendre();
    annoncer(vises.length === 1
      ? `«\u00A0${vises[0].nom}\u00A0» est dans la corbeille.`
      : `${vises.length}\u00A0plats mis à la corbeille.`, {
      action: { libelle: 'Annuler', faire: () => actions.remettreDeLaCorbeille(ids) },
    });
  },
  /**
   * Sort des plats de la corbeille (« Remettre », les deux membres ; « Annuler » de la mise à la corbeille). Appliqué
   * tout de suite, envoyé dès que possible ; un échec est annoncé. Annonce « « X » est revenu dans vos plats. ». Les
   * plats inconnus ou hors de la corbeille sont ignorés.
   * → promesse de { echec } (jamais rejetée), résolue à la réponse du serveur : `echec` est le message d'échec (déjà
   *   annoncé ; la feuille « Corbeille » le montre aussi, le bandeau d'annonce étant caché sous elle), ou null. Hors
   *   ligne, elle attend le retour du réseau.
   */
  remettreDeLaCorbeille(platIds) {
    const vises = platsVises(platIds, (plat) => estDansCorbeille(plat));
    if (!vises.length) return Promise.resolve({ echec: null });
    const ids = vises.map((plat) => plat.id);
    const echec = vises.length === 1
      ? `«\u00A0${vises[0].nom}\u00A0» n’a pas pu être remis dans vos plats. Réessayez.`
      : 'Les plats n’ont pas pu être remis dans vos plats. Réessayez.';
    let envoi;
    try {
      envoi = donnees.remettreDeLaCorbeille(ids);
    } catch {
      annoncer(echec);
      return Promise.resolve({ echec });
    }
    ecrire(envoi, echec);
    const reponse = envoi.then(() => ({ echec: null }), () => ({ echec }));
    const parId = new Set(ids);
    etat.plats = etat.plats.map((plat) => {
      if (!parId.has(plat.id)) return plat;
      const { corbeille, ...reste } = plat;
      return reste;
    });
    rendre();
    annoncer(vises.length === 1
      ? `«\u00A0${vises[0].nom}\u00A0» est revenu dans vos plats.`
      : `${vises.length}\u00A0plats sont revenus dans vos plats.`);
    return reponse;
  },
  /**
   * « Vider la corbeille » (gestionnaire, hors aperçu « Repas et courses ») : supprime pour de bon les plats de la
   * corbeille et leurs photos, clôt leurs demandes ouvertes. Demande du réseau (transactions : rien ne part plus tard) ;
   * un plat remis entre-temps sur l'autre téléphone reste. N'annonce rien elle-même : la feuille « Corbeille », d'où
   * elle part, montre `message` (« Corbeille vidée. » une fois fermée, l'échec dans la feuille), car le bandeau
   * d'annonce, caché sous la feuille ouverte, ne serait ni vu ni lu.
   * → promesse de { code, message } (jamais rejetée) : ok (avec `supprimes` et `gardes`, nombres), vide, hors_ligne,
   *   refuse (pas gestionnaire), echec ; `message` : texte à montrer, ou null (vide, refuse, ou personne connectée
   *   changée entre-temps).
   */
  async viderCorbeille() {
    const role = roleEffectif(roleDe(etat.utilisateur?.email, etat.donnees.reglages), etat.apercu);
    if (role !== 'gestionnaire') return { code: 'refuse', message: null };
    if (!navigator.onLine) return { code: 'hors_ligne', message: 'Il faut du réseau pour vider la corbeille.' };
    const ids = platsSepares().corbeille.map((plat) => plat.id);
    if (!ids.length) return { code: 'vide', message: null };
    const uid = etat.utilisateur.uid;
    // Chaque demande avec son plat : celui qu'elle nomme, sinon celui de son identifiant (`<platId>__…`).
    const demandesAClore = demandesDesPlats(ids, etat.demandes)
      .map((id) => ({ id, platId: etat.demandes.find((demande) => demande.id === id)?.platId }));
    let bilan;
    try {
      bilan = await donnees.viderCorbeille(ids, demandesAClore);
    } catch {
      return { code: 'echec', message: etat.utilisateur?.uid === uid ? 'La corbeille n’a pas pu être vidée. Réessayez.' : null };
    }
    const { supprimes, gardes, demandesCloses } = bilan;
    let message = null;
    if (etat.utilisateur?.uid === uid) {
      // Retirés tout de suite ; la copie de Firestore suit.
      const partis = new Set(supprimes);
      etat.plats = etat.plats.filter((plat) => !partis.has(plat.id));
      cloreDemandes(demandesCloses);
      rendre();
      message = gardes.length
        ? `Corbeille vidée. ${gardes.length === 1 ? 'Un plat remis entre-temps reste' : `${gardes.length}\u00A0plats remis entre-temps restent`} dans vos plats.`
        : 'Corbeille vidée.';
    }
    return { code: 'ok', message, supprimes: supprimes.length, gardes: gardes.length };
  },
  /**
   * « C'est moi : <Prénom> » : relie le profil à l'adresse connectée. Demande du réseau.
   * `attendu` : adresse du profil que l'écran a montrée ('' : sans adresse) ; si elle n'est plus la sienne, rien n'est
   * écrit (« change ») : on ne remplace pas une adresse que la personne n'a pas vue.
   * → promesse de { code, nom? } : ok, change, adresse_prise (nom du profil qui porte déjà l'adresse), reseau, echec,
   * inconnu, enfant, gestionnaire.
   */
  async relierProfil(profilId, { attendu } = {}) {
    if (!navigator.onLine) return { code: 'reseau' };
    const { uid, email } = etat.utilisateur;
    const prepare = preparerReliure(etat.profils, profilId, email, {
      gestionnaire: etat.donnees.reglages?.gestionnaire,
      vu: attendu,
    });
    if (prepare.erreur) {
      return prepare.erreur === 'adresse_prise'
        ? { code: 'adresse_prise', nom: prepare.nom ?? profilDeLEmail(etat.profils, email)?.nom ?? '' }
        : { code: prepare.erreur };
    }
    return changerAdresse(uid, prepare.id, prepare.email,
      () => donnees.relierProfil(prepare, etat.profils.map((profil) => profil.id)));
  },
  /**
   * « Ce n'est pas moi » : retire l'adresse connectée de son profil. Demande du réseau.
   * → promesse de { code, nom? } : ok (nom du profil quitté), change, reseau, echec, non_relie, inconnu.
   */
  async delierProfil() {
    if (!navigator.onLine) return { code: 'reseau' };
    const { uid, email } = etat.utilisateur;
    const prepare = preparerDeliure(etat.profils, email);
    if (prepare.erreur) return { code: prepare.erreur };
    const nom = etat.profils.find((profil) => profil.id === prepare.id)?.nom ?? '';
    const resultat = await changerAdresse(uid, prepare.id, '', () => donnees.delierProfil(prepare));
    return resultat.code === 'ok' ? { ...resultat, nom } : resultat;
  },
  /**
   * Feuille « Qui êtes-vous ? » (fiche, panneau du profil), ouverte avec le contexte à jour ; l'app la met à jour à
   * chaque rendu tant qu'elle est ouverte. Options : celles de ui/relier.js › ouvrirQuiEtesVous.
   */
  ouvrirQuiEtesVous(options = {}) {
    feuilleQuiEtesVous?.fermer();
    const feuille = ouvrirQuiEtesVous(contexteCourant(), {
      ...options,
      surFermer: () => {
        if (feuilleQuiEtesVous === feuille) feuilleQuiEtesVous = null;
      },
    });
    feuilleQuiEtesVous = feuille;
  },
  /**
   * Télécharge une sauvegarde (CLAUDE.md §8), construite depuis les données de ce téléphone. Synchrone : à appeler
   * dans le toucher (le navigateur bloque un téléchargement lancé après une attente). En ligne seulement, la date est
   * marquée dans `reglages/foyer.derniereSauvegarde` et appliquée tout de suite sur ce téléphone ; hors ligne, le
   * fichier ne compte pas comme dernière sauvegarde.
   * → { resume, aCorriger, horsLigne }, ou null tant que plats et profils ne sont pas chargés (rien n'est téléchargé).
   */
  sauvegarder() {
    if (!etat.platsCharges || !etat.profilsCharges) return null;
    const maintenant = new Date();
    const { nomFichier, texte, resume, aCorriger } = creerSauvegarde(
      { plats: etat.plats, profils: etat.profils },
      { maintenant },
    );
    telecharger(nomFichier, texte);
    // Copie du téléphone pas encore confirmée par le serveur (réseau absent ou médiocre) : le fichier est donné,
    // mais il ne compte pas comme dernière sauvegarde.
    const horsLigne = !navigator.onLine || etat.platsDepuisCache || etat.profilsDepuisCache;
    if (!horsLigne) {
      ecrire(donnees.marquerSauvegarde(maintenant), 'La date de la sauvegarde n’a pas pu être enregistrée.');
      if (etat.donnees.reglages) {
        etat.donnees = { ...etat.donnees, reglages: { ...etat.donnees.reglages, derniereSauvegarde: maintenant } };
      }
      rendre();
    }
    return { resume, aCorriger, horsLigne };
  },
  /** Profils, plats et demandes lus sur le serveur (restauration). → promesse ; rejetée hors ligne. */
  lireDepuisServeur() {
    if (!navigator.onLine) return Promise.reject(new Error('Hors ligne.'));
    return donnees.lireDepuisServeur();
  },
  /**
   * Restaure une sauvegarde préparée par coeur/sauvegarde.js › preparerRestauration. Les écrans suivent les
   * instantanés de Firestore, qui arrivent aussitôt. → promesse de l'envoi ; rejetée hors ligne ou en cas d'échec
   * (l'écran le dit : relancer est sans risque).
   */
  restaurer(preparation) {
    if (!navigator.onLine) return Promise.reject(new Error('Hors ligne.'));
    return donnees.restaurer(preparation, etat.utilisateur.email);
  },
  /** Téléchargement d'un fichier (copie de précaution avant une restauration). Synchrone, dans le toucher. */
  telecharger,
  /**
   * Plats déjà copiés pour Claude par la personne connectée (30 jours, ce téléphone) : l'option `envoyes` de
   * coeur/compatibilite.js › platsSansVersion. → [platId] ([] si rien n'est gardé).
   */
  lireEnvoyes() {
    return lireEnvoyes(etat.utilisateur?.uid);
  },
  /** Retient les plats d'un lot copié pour Claude (ils passent en fin de liste). Échec silencieux. */
  noterEnvoyes(platIds) {
    noterEnvoyes(etat.utilisateur?.uid, platIds);
  },
  /** Dernier lot de relecture des repères copié sur ce téléphone (deux jours) : [platId] (T2d). */
  lireRelectureEnCours() {
    return lireRelectureEnCours(etat.utilisateur?.uid);
  },
  /** Retient le lot de relecture copié pour Claude. Échec silencieux. */
  noterRelectureEnCours(platIds) {
    noterRelectureEnCours(etat.utilisateur?.uid, platIds);
  },
  /**
   * « 📬 Demander ma version », « 📬 Demander une version pour <Prénom> » (`profilId`) ou « 📬 Demander la recette »
   * (sans `profilId`) : rôle effectif « Repas et courses » seulement (aperçu compris), préparée par coeur/demandes.js ›
   * preparerDemande. Synchrone : écrite (hors ligne : part plus tard), affichée tout de suite (`creeLe: null` jusqu'à
   * l'horodatage du serveur), gestionnaire prévenu (prevenirDemande), écran redessiné, puis annonce « C’est demandé. »
   * avec « Annuler » (8 s), qui retire la demande, redessine et appelle `apresAnnulation()` (l'écran y rend le focus au
   * bouton revenu).
   * → { code: 'ok', id } | { code } : refuse (gestionnaire hors aperçu), chargement (demandes, plats ou profils pas
   *   encore lus), inutile (plat ou profil inconnu, rien à demander), deja (déjà ouverte, ou touchée il y a moins de
   *   2 s), invalide, echec (lot impossible à construire : annoncé).
   */
  demander({ platId, profilId = null, apresAnnulation } = {}) {
    if (!etat.utilisateur || roleCourant() === 'gestionnaire') return { code: 'refuse' };
    if (!etat.demandesChargees || !etat.platsCharges || !etat.profilsCharges) return { code: 'chargement' };
    const plat = platsSepares().actifs.find((p) => p.id === platId);
    const profil = profilId === null || profilId === undefined ? null : etat.profils.find((p) => p.id === profilId);
    if (!plat || profil === undefined) return { code: 'inutile' };
    const id = idDemande(plat.id, profil?.id ?? null);
    if (id && Date.now() - (verrousDemandes.get(id) ?? -Infinity) < DELAI_VERROU_DEMANDE_MS) return { code: 'deja' };
    const preparation = preparerDemande({ plat, profil }, {
      demandes: etat.demandes,
      auteur: etat.utilisateur.email,
      evaluer: compat,
    });
    if (preparation.erreur) return { code: preparation.erreur };
    const echec = 'La demande n’a pas pu être enregistrée. Réessayez.';
    let envoi;
    try {
      envoi = donnees.creerDemande(preparation);
    } catch {
      annoncer(echec);
      return { code: 'echec' };
    }
    ecrire(envoi, echec);
    verrousDemandes.set(preparation.id, Date.now());
    insererDemande(preparation);
    const jeton = Symbol(preparation.id);
    jetonsDemandes.set(preparation.id, jeton);
    prevenirDemande(preparation.id, preparation.donnees.type, plat, envoi, jeton);
    rendre();
    annoncer('C’est demandé.', {
      action: { libelle: 'Annuler', faire: () => annulerDemande(preparation.id, apresAnnulation) },
    });
    return { code: 'ok', id: preparation.id };
  },
  /**
   * « Retirer la demande » (gestionnaire hors aperçu, écran Demandes) : statut `traitee` (hors ligne : part plus tard),
   * appliqué tout de suite, puis annonce « Demande retirée. » avec « Annuler », qui la remet (remettreDemande) puis
   * appelle `apresAnnulation()` si l'écran en donne un. L'écran gère le focus de la ligne qui disparaît.
   * → { code } : ok, refuse, inutile (pas ouverte sur ce téléphone), echec (lot impossible à construire : annoncé).
   */
  retirerDemande(id, { apresAnnulation } = {}) {
    if (!etat.utilisateur || roleCourant() !== 'gestionnaire') return { code: 'refuse' };
    if (!demandeOuverte(etat.demandes, id)) return { code: 'inutile' };
    const echec = 'La demande n’a pas pu être retirée. Réessayez.';
    let envoi;
    try {
      envoi = donnees.retirerDemande(id);
    } catch {
      annoncer(echec);
      return { code: 'echec' };
    }
    ecrire(envoi, echec);
    changerStatutDemande(id, 'traitee');
    rendre();
    annoncer('Demande retirée.', {
      action: {
        libelle: 'Annuler',
        faire: () => {
          if (actions.remettreDemande(id).code === 'ok' && typeof apresAnnulation === 'function') apresAnnulation();
        },
      },
    });
    return { code: 'ok' };
  },
  /**
   * « Annuler » un retrait (gestionnaire) : la demande redevient ouverte (`creeLe` et auteur gardés ; hors ligne : part
   * plus tard), appliqué tout de suite. → { code } : ok, refuse, inutile (pas traitée sur ce téléphone), echec.
   */
  remettreDemande(id) {
    if (!etat.utilisateur || roleCourant() !== 'gestionnaire') return { code: 'refuse' };
    const demande = etat.demandes.find((d) => d.id === id);
    if (!demande || demande.statut !== 'traitee') return { code: 'inutile' };
    const echec = 'La demande n’a pas pu être remise. Réessayez.';
    let envoi;
    try {
      envoi = donnees.remettreDemande(id);
    } catch {
      annoncer(echec);
      return { code: 'echec' };
    }
    ecrire(envoi, echec);
    changerStatutDemande(id, 'ouverte');
    rendre();
    return { code: 'ok' };
  },
  /**
   * « Activer les notifications » (gestionnaire, Réglages) : l'app crée le sujet (`repas-` + 24 signes au hasard,
   * coeur/ntfy.js › nouveauSujet) et l'écrit par transaction, seulement si aucun sujet n'existe (donnees.js ›
   * remplacerSujet). En ligne seulement ; annonces du plan (§6.8) faites ici, l'écran place le focus selon le code.
   * → promesse de { code } (jamais rejetée) : ok, existe (sujet créé entre-temps sur un autre appareil : montré, rien
   *   n'est écrasé), hors_ligne, deja (réglage déjà en cours d'envoi), echec, refuse.
   */
  async activerNotifications() {
    if (!etat.utilisateur || roleCourant() !== 'gestionnaire') return { code: 'refuse' };
    if (!navigator.onLine) {
      annoncer(MESSAGE_SUJET_HORS_LIGNE);
      return { code: 'hors_ligne' };
    }
    if (sujetEnCours) return { code: 'deja' };
    let sujet;
    try {
      sujet = nouveauSujet(crypto.getRandomValues(new Uint8Array(SIGNES_SUJET)));
    } catch {
      sujet = null;
    }
    if (!sujet) {
      annoncer(MESSAGE_SUJET_ECHEC);
      return { code: 'echec' };
    }
    const resultat = await changerSujet(null, sujet);
    if (resultat.code === 'ok') annoncer('Notifications activées. Abonnez-vous maintenant dans ntfy.');
    else if (resultat.code === 'existe') annoncer(MESSAGE_SUJET_EXISTE);
    return resultat;
  },
  /**
   * « Arrêter les notifications » (gestionnaire) : retire le sujet par transaction, seulement s'il est toujours celui
   * que la carte montrait. En ligne seulement. Réussi : annonce « Notifications arrêtées. » avec « Annuler » (8 s), qui
   * remet l'ancien sujet par transaction (seulement si aucun sujet n'a été créé entre-temps) ; si un sujet est alors
   * montré (remis, ou créé ailleurs), redessine puis appelle `apresAnnulation()` (focus sur « S’abonner dans ntfy › »).
   * → promesse de { code } (jamais rejetée) : ok, change (sujet changé sur un autre appareil : la carte montre
   *   l'actuel), hors_ligne, deja (aucun sujet, ou réglage déjà en cours d'envoi), echec, refuse.
   */
  async arreterNotifications({ apresAnnulation } = {}) {
    if (!etat.utilisateur || roleCourant() !== 'gestionnaire') return { code: 'refuse' };
    if (!navigator.onLine) {
      annoncer(MESSAGE_SUJET_HORS_LIGNE);
      return { code: 'hors_ligne' };
    }
    const ancien = sujetCourant();
    if (sujetEnCours || ancien === null) return { code: 'deja' };
    const resultat = await changerSujet(ancien, null);
    if (resultat.code === 'ok') {
      annoncer('Notifications arrêtées.', {
        action: { libelle: 'Annuler', faire: () => remettreSujet(ancien, apresAnnulation) },
      });
    } else if (resultat.code === 'existe') {
      annoncer('Ce réglage venait de changer sur un autre appareil\u00A0: la carte montre le sujet actuel.');
      return { code: 'change' };
    }
    return resultat;
  },
  /**
   * « Envoyer un essai » (gestionnaire, Réglages) : « Essai : les demandes arriveront ici. », lien vers Réglages.
   * L'écran affiche coeur/ntfy.js › texteEssai de l'issue et gère son propre minuteur d'affichage (15 s).
   * → promesse de l'issue (coeur/ntfy.js › issueEnvoi : ok, quota, panne, refus, reseau), jamais rejetée ;
   *   { code: 'invalide' } sans sujet valide, { code: 'refuse' } hors gestionnaire (texteEssai : '').
   */
  async essayerNotification() {
    if (!etat.utilisateur || roleCourant() !== 'gestionnaire') return { code: 'refuse' };
    const adresse = adresseNotification(sujetCourant(), { lien: lienApp('#/reglages') });
    if (!adresse) return { code: 'invalide' };
    try {
      return issueEnvoi(await envoyerNtfy(adresse, texteNotification({ type: 'essai' })));
    } catch {
      return { code: 'reseau' };
    }
  },
};

// ——— Demandes et notifications (T2e) ———

const MESSAGE_SUJET_HORS_LIGNE = 'Il faut du réseau pour changer ce réglage.';
const MESSAGE_SUJET_ECHEC = 'Le réglage des notifications n’a pas pu être enregistré. Réessayez.';
const MESSAGE_SUJET_EXISTE = 'Les notifications étaient déjà activées sur un autre appareil\u00A0: voici leur sujet.';

// Demandes touchées récemment sur ce téléphone : identifiant → heure du toucher (actions.demander).
const verrousDemandes = new Map();
/** Jeton du dernier geste par demande : un rappel de notification d'un geste annulé ou remplacé ne part jamais. */
const jetonsDemandes = new Map();
// Transaction du sujet ntfy en cours (double toucher sur « Activer », « Arrêter » ou « Annuler »).
let sujetEnCours = false;
// Notifications qui attendent la copie confirmée par le serveur (apresConfirmation) : { rappel, minuteur }.
let rappelsConfirmation = [];

/** Rôle affiché : rôle réel, ou « Repas et courses » en aperçu (coeur/roles.js › roleEffectif). */
function roleCourant() {
  return roleEffectif(roleDe(etat.utilisateur?.email, etat.donnees.reglages), etat.apercu);
}

/** Sujet ntfy de `reglages/foyer` tel que lu sur ce téléphone ; absent ou vide → null. */
function sujetCourant() {
  const sujet = etat.donnees.reglages?.notifications?.ntfySujet;
  return sujet === undefined || sujet === null || sujet === '' ? null : sujet;
}

/** Sujet appliqué tout de suite sur ce téléphone (null : retiré) ; la copie de Firestore suit. */
function appliquerSujet(sujet) {
  if (!etat.donnees.reglages) return;
  const notifications = { ...(etat.donnees.reglages.notifications ?? {}) };
  if (sujet === null) delete notifications.ntfySujet;
  else notifications.ntfySujet = sujet;
  etat.donnees = { ...etat.donnees, reglages: { ...etat.donnees.reglages, notifications } };
}

/**
 * Remplace le sujet par transaction (donnees.js › remplacerSujet), si celui du serveur vaut toujours `attendu`. Écrit :
 * appliqué tout de suite ; sinon, le sujet trouvé est montré. Redessine dans les deux cas. N'annonce que l'échec.
 * → promesse de { code } : ok, existe (non écrit : un autre sujet, ou aucun, était là), echec ; refuse si la personne
 *   connectée a changé entre-temps.
 */
async function changerSujet(attendu, nouveau) {
  const uid = etat.utilisateur.uid;
  sujetEnCours = true;
  let resultat;
  try {
    resultat = await donnees.remplacerSujet(attendu, nouveau);
  } catch {
    resultat = null;
  } finally {
    sujetEnCours = false;
  }
  if (etat.utilisateur?.uid !== uid) return { code: 'refuse' };
  if (!resultat) {
    annoncer(MESSAGE_SUJET_ECHEC);
    return { code: 'echec' };
  }
  appliquerSujet(resultat.ecrit ? nouveau : (resultat.actuel ?? null));
  rendre();
  return { code: resultat.ecrit ? 'ok' : 'existe' };
}

/**
 * « Annuler » de « Notifications arrêtées. » : remet l'ancien sujet par transaction, seulement si aucun sujet n'a été
 * créé entre-temps (sinon, celui-ci est montré : « déjà activées sur un autre appareil »). En ligne seulement. Quand un
 * sujet est de nouveau montré, `apresAnnulation()` (focus sur « S’abonner dans ntfy › »).
 */
async function remettreSujet(ancien, apresAnnulation) {
  if (!etat.utilisateur || roleCourant() !== 'gestionnaire' || sujetEnCours) return;
  if (!navigator.onLine) {
    annoncer(MESSAGE_SUJET_HORS_LIGNE);
    return;
  }
  const { code } = await changerSujet(null, ancien);
  if (code === 'existe') annoncer(MESSAGE_SUJET_EXISTE);
  if ((code === 'ok' || code === 'existe') && sujetCourant() !== null && typeof apresAnnulation === 'function') {
    apresAnnulation();
  }
}

/**
 * Demande créée sur ce téléphone ({ id, donnees }) : affichée tout de suite, `creeLe: null` jusqu'à l'horodatage du
 * serveur, à la place d'une demande traitée du même identifiant ; la copie de Firestore la remplace dès son arrivée.
 */
function insererDemande({ id, donnees: champs }) {
  etat.demandes = [...etat.demandes.filter((demande) => demande.id !== id), { ...champs, id, creeLe: null }];
}

/** Statut d'une demande changé tout de suite sur ce téléphone (`traiteeLe` effacé quand elle se rouvre). */
function changerStatutDemande(id, statut) {
  etat.demandes = etat.demandes.map((demande) => {
    if (demande.id !== id) return demande;
    const maj = { ...demande, statut };
    if (statut === 'ouverte') delete maj.traiteeLe;
    return maj;
  });
}

/**
 * « Annuler » de « C’est demandé. » (vue « Repas et courses », appelée seulement par l'annonce) : retire la demande
 * qu'elle vient de créer, encore ouverte et créée par la personne connectée ; redessine, puis `apresAnnulation()`. Une
 * notification déjà partie n'est pas rattrapée ; une notification en attente (hors ligne) ne partira jamais, même si
 * la demande est rouverte ensuite (jeton du geste retiré : `jetonsDemandes`).
 */
function annulerDemande(id, apresAnnulation) {
  if (!etat.utilisateur || roleCourant() === 'gestionnaire') return;
  const demande = demandeOuverte(etat.demandes, id);
  if (!demande || normaliserEmail(demande.creePar) !== normaliserEmail(etat.utilisateur.email)) return;
  const echec = 'La demande n’a pas pu être annulée. Réessayez.';
  let envoi;
  try {
    envoi = donnees.retirerDemande(id);
  } catch {
    annoncer(echec);
    return;
  }
  ecrire(envoi, echec);
  verrousDemandes.delete(id);
  jetonsDemandes.delete(id);
  changerStatutDemande(id, 'traitee');
  rendre();
  if (typeof apresAnnulation === 'function') apresAnnulation();
}

/** Adresse de l'app, calculée sur le téléphone (rien dans le dépôt), suivie de `ancre` ('#/plat/<id>', '#/reglages'). */
function lienApp(ancre) {
  return new URL('./', location.href).href + ancre;
}

/**
 * Prévient le gestionnaire d'une demande créée sur ce téléphone (`envoi` : promesse du lot qui l'écrit), au plus deux
 * envois, sans rien écrire dans Firestore (CLAUDE.md §7 ; plan T2e §5.3, §5.4). Chaque tentative relit tout au moment
 * où elle part : même geste (`jeton`, ni annulé ni remplacé), même compte connecté, sujet valide, demande encore ouverte et utile, nom du plat actuel.
 * - En ligne : envoi tout de suite, sans attendre l'accusé du serveur. Seulement si ce premier envoi n'a pas trouvé de
 *   réseau, une seconde et dernière tentative à l'accusé du serveur (un 429, un 4xx ou un 5xx ne sont pas retentés).
 * - Hors ligne : une seule tentative, à l'accusé du serveur.
 * Une tentative à l'accusé attend la copie confirmée par le serveur (apresConfirmation, 10 s au plus) : une version
 * arrivée, un plat mis à la corbeille ou un sujet arrêté pendant la coupure sont vus avant l'envoi. Écriture refusée :
 * aucune notification (l'échec est déjà annoncé). Rien n'est accroché à l'événement `online` ; app fermée avant
 * l'accusé : notification perdue (la demande, elle, part et s'affiche).
 */
function prevenirDemande(id, type, plat, envoi, jeton) {
  const uid = etat.utilisateur?.uid;
  const platId = plat?.id;
  if (!uid || typeof platId !== 'string') return;
  const tenter = () => {
    if (etat.utilisateur?.uid !== uid || jetonsDemandes.get(id) !== jeton) return Promise.resolve(null);
    const sujet = sujetCourant();
    if (!sujetValide(sujet)) return Promise.resolve(null);
    const { actifs } = platsSepares();
    const demande = demandeOuverte(etat.demandes, id);
    if (!demande || !demandeUtile(demande, { plats: actifs, profils: etat.profils, evaluer: compat })) {
      return Promise.resolve(null);
    }
    const nomPlat = actifs.find((p) => p.id === platId)?.nom ?? '';
    const adresse = adresseNotification(sujet, { lien: lienApp(`#/plat/${encodeURIComponent(platId)}`) });
    const texte = texteNotification({ type, nomPlat });
    if (!adresse || !texte) return Promise.resolve(null);
    return envoyerNtfy(adresse, texte);
  };
  const aLAccuse = () => {
    envoi.then(() => apresConfirmation(tenter), () => {});
  };
  if (!navigator.onLine) {
    aLAccuse();
    return;
  }
  tenter().then((reponse) => {
    if (reponse && issueEnvoi(reponse).code === 'reseau') aLAccuse();
  }, () => {});
}

/** Vrai quand réglages, plats et profils viennent du serveur (et non de la seule copie du téléphone). */
function copieConfirmee() {
  return etat.donnees.statut === 'ok' && !etat.donnees.depuisCache
    && etat.platsCharges && !etat.platsDepuisCache && etat.profilsCharges && !etat.profilsDepuisCache;
}

/**
 * Appelle `rappel` dès que la copie du téléphone est confirmée par le serveur : tout de suite si elle l'est, sinon au
 * premier instantané qui la confirme (verifierConfirmation), au plus tard après DELAI_CONFIRMATION_MS (il juge alors
 * sur l'état du moment). L'accusé d'une écriture prouve que le réseau marche ; les écoutes peuvent encore être en
 * retard sur le serveur.
 */
function apresConfirmation(rappel) {
  if (copieConfirmee()) {
    rappel();
    return;
  }
  const attente = { rappel, minuteur: null };
  attente.minuteur = setTimeout(() => lancerRappel(attente), DELAI_CONFIRMATION_MS);
  rappelsConfirmation.push(attente);
}

function lancerRappel(attente) {
  if (!rappelsConfirmation.includes(attente)) return;
  clearTimeout(attente.minuteur);
  rappelsConfirmation = rappelsConfirmation.filter((autre) => autre !== attente);
  attente.rappel();
}

/** À chaque instantané (réglages, collections) : les rappels en attente partent si la copie est confirmée. */
function verifierConfirmation() {
  if (!rappelsConfirmation.length || !copieConfirmee()) return;
  for (const attente of [...rappelsConfirmation]) lancerRappel(attente);
}

/** Déconnexion : plus aucune notification en attente, plus aucun verrou. */
function oublierRappels() {
  for (const { minuteur } of rappelsConfirmation) clearTimeout(minuteur);
  rappelsConfirmation = [];
  verrousDemandes.clear();
  jetonsDemandes.clear();
}

/**
 * Relecture des repères par Claude (T2d, écritures `mode: 'precautions'`, en ligne seulement : vérifié par l'appelant).
 * Une transaction par plat (donnees.importer) ; l'affichage local suit tout de suite (coeur/import-local.js ›
 * appliquerImport, seulement sur une fiche inchangée). Annonce « 10 recettes relues, 6 repères ajoutés, 1 enlevé.
 * 32 restent à relire. » (seules les recettes marquées relues sont comptées ; celles dont les repères sont écrits sans
 * la marque : « 1 reste à relire : « X ». »), puis une phrase par plat changé, disparu ou mis à la corbeille
 * entre-temps (coeur/relecture.js › bilanRelecture, annonceRelecture).
 * → promesse de { manquants: [nom], changes: [nom], corbeille: [nom] } ; rejetée avec `code: 'echec'`.
 */
function importerRelecture(ecritures) {
  const nomsAvant = new Map(etat.plats.map((plat) => [plat.id, plat.nom]));
  const nom = (id) => String(nomsAvant.get(id) ?? id);
  const { precautions } = donnees.importer({ ecritures, demandesAClore: [] }, etat.utilisateur.email);
  etat.plats = appliquerImport(etat.plats, ecritures);
  const uid = etat.utilisateur.uid;
  return precautions.then(({ manquants, corbeille, changes, ecrites }) => {
    const resultat = { manquants: manquants.map(nom), changes: changes.map(nom), corbeille: corbeille.map(nom) };
    if (etat.utilisateur?.uid !== uid) return resultat;
    const bilan = bilanRelecture(ecritures, ecrites);
    annoncer(annonceRelecture({
      relues: bilan.relues.length,
      ajoutes: bilan.ajoutes,
      enleves: bilan.enleves,
      aRelire: bilan.aRelire.map(nom),
      restants: platsARelire(platsSepares().actifs).length,
      incidents: [
        ...resultat.changes.map((x) => ({ nom: x, cause: 'change' })),
        ...resultat.manquants.map((x) => ({ nom: x, cause: 'supprime' })),
        ...resultat.corbeille.map((x) => ({ nom: x, cause: 'corbeille' })),
      ],
    }));
    return resultat;
  }, (erreur) => {
    annoncer('La relecture n’a pas pu être enregistrée. Réessayez.');
    throw Object.assign(new Error('La relecture n’a pas pu être enregistrée.'), { code: 'echec', cause: erreur });
  });
}

/**
 * Écrit l'adresse d'un profil par une transaction (`ecrire()` → promesse de { code, nom? }). Réussie : l'adresse est
 * appliquée tout de suite sur ce téléphone, pour que `moi` change sans attendre la copie de Firestore.
 * Toute erreur (réseau coupé en route, refus) → { code: 'echec' }.
 */
async function changerAdresse(uid, profilId, email, ecrire) {
  let resultat;
  try {
    resultat = await ecrire();
  } catch {
    return { code: 'echec' };
  }
  if (resultat?.code === 'ok' && etat.utilisateur?.uid === uid) {
    etat.profils = etat.profils.map((profil) => (profil.id === profilId ? { ...profil, email } : profil));
    rendre();
  }
  return resultat ?? { code: 'echec' };
}

/**
 * Plats de `etat.plats` visés par `platIds` (un identifiant ou une liste) et retenus par `garder`, dans l'ordre de la
 * liste des plats, sans doublon.
 */
function platsVises(platIds, garder) {
  const voulus = new Set((Array.isArray(platIds) ? platIds : [platIds]).filter((id) => typeof id === 'string' && id));
  return etat.plats.filter((plat) => voulus.has(plat.id) && garder(plat));
}

/** Prénom d'un profil pour les messages (espaces resserrés), ou « ce profil ». */
function nomDuProfil(profil) {
  return String(profil?.nom ?? '').replace(/\s+/g, ' ').trim() || 'ce profil';
}

/** Demandes satisfaites : closes tout de suite sur ce téléphone (l'envoi suit). */
function cloreDemandes(demandesAClore) {
  if (!demandesAClore?.length) return;
  etat.demandes = etat.demandes.map((demande) => (demandesAClore.includes(demande.id)
    ? { ...demande, statut: 'traitee' }
    : demande));
}

/** Panneau du profil, rempli avec le contexte à jour (la personne reconnue, les prénoms à relier). */
function ouvrirPanneauProfil() {
  if (!etat.utilisateur) return;
  const ctx = contexteCourant();
  ouvrirProfil(panneauProfil, {
    utilisateur: ctx.utilisateur,
    role: ctx.roleReel,
    apercu: etat.apercu,
    moi: ctx.moi,
    aRelier: profilsARelier(ctx.profils, { gestionnaire: ctx.reglages?.gestionnaire }),
    avecProfils: ctx.profils.length > 0,
    onReglages: () => { location.hash = '#/reglages'; },
    onAjouterRecettes: () => { location.hash = '#/import'; },
    onApercu: changerApercu,
    onDeconnecter: seDeconnecter,
    onQuiEtesVous: () => {
      if (panneauProfil.open) panneauProfil.close();
      actions.ouvrirQuiEtesVous();
    },
    onDelier: () => actions.delierProfil(),
    // Rappel de sauvegarde : gestionnaire, hors aperçu, une fois plats et profils chargés.
    sauvegarde: ctx.roleReel === 'gestionnaire' && !etat.apercu && etat.platsCharges && etat.profilsCharges
      ? { derniere: dateDeSauvegarde(ctx.reglages?.derniereSauvegarde) }
      : null,
    onSauvegarder: sauvegarderDepuisLePanneau,
    // Rappel de recopier les instructions du projet Claude quand elles ont changé (gestionnaire, hors aperçu).
    instructionsAJour: ctx.instructionsAJour,
    onInstructions: () => { location.hash = '#/reglages'; },
    // Demandes à traiter (T2e) : l'entrée « 📬 Demandes · N » n'apparaît que s'il y en a (gestionnaire, hors aperçu).
    demandes: ctx.aTraiter.length,
    onDemandes: () => {
      if (panneauProfil.open) panneauProfil.close();
      location.hash = '#/demandes';
    },
    version: etat.version,
    versionPrete: etat.versionPrete,
  });
}

/** « Télécharger une sauvegarde » du panneau du profil (déjà fermé) : téléchargement dans le toucher, puis annonce. */
function sauvegarderDepuisLePanneau() {
  const resultat = actions.sauvegarder();
  if (!resultat) {
    annoncer('Les plats sont encore en chargement. Réessayez dans un instant.');
    return;
  }
  annoncer(reglages.resumeSauvegarde(resultat));
}

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
  oublierRappels();
  Object.assign(etat, {
    donnees: { statut: 'chargement' },
    collectionsSuivies: false,
    profils: [],
    profilsCharges: false,
    profilsDepuisCache: false,
    plats: [],
    platsCharges: false,
    platsDepuisCache: false,
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
    return;
  }
  // Les modifications pas encore enregistrées ne restent pas sur le téléphone après la déconnexion.
  effacerBrouillons();
  effacerEnvoyes();
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
    verifierConfirmation();
    if (suivi.statut === 'ok' && !etat.collectionsSuivies) {
      etat.collectionsSuivies = true;
      donnees.suivreCollections((maj) => {
        Object.assign(etat, maj);
        if (maj.plats) etat.platsCharges = true;
        if (maj.profils) etat.profilsCharges = true;
        if (maj.demandes) etat.demandesChargees = true;
        verifierConfirmation();
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

// ——— Version de l'app ———

/** Version annoncée par un service worker (sw.js), ou null s'il ne répond pas. */
function demanderVersion(travailleur) {
  if (!travailleur) return Promise.resolve(null);
  return new Promise((resoudre) => {
    const canal = new MessageChannel();
    const delai = setTimeout(() => resoudre(null), 3000);
    canal.port1.onmessage = ({ data }) => {
      clearTimeout(delai);
      resoudre(data?.type === 'version' && typeof data.version === 'string' ? data : null);
    };
    travailleur.postMessage({ type: 'version' }, [canal.port2]);
  });
}

/**
 * Version qui a servi cette ouverture (celle du service worker en place au chargement), puis, si une plus récente
 * prend la main pendant la visite, « elle s'appliquera à la prochaine ouverture ».
 */
function suivreVersion() {
  const conteneur = navigator.serviceWorker;
  demanderVersion(conteneur.controller).then((version) => { etat.version = version; });
  conteneur.addEventListener('controllerchange', () => {
    demanderVersion(conteneur.controller).then((nouvelle) => {
      if (!nouvelle) return;
      if (!etat.version) etat.version = nouvelle;
      else if (nouvelle.version !== etat.version.version) etat.versionPrete = true;
    });
  });
}

// ——— Démarrage ———

function demarrer() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Sans service worker, l'app marche quand même en ligne.
    });
    suivreVersion();
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
  boutonProfil.addEventListener('click', ouvrirPanneauProfil);
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
      // L'écran en place (une modification en cours) est fermé avant l'effacement des brouillons.
      rendre();
      effacerBrouillons();
      effacerEnvoyes();
    }
  });
}

demarrer();
