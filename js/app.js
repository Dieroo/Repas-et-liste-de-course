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
import {
  lireSemaine, semaineAPreparer, semaineEnCours, appliquerChamps, estDansLaSemaine, texteDates, aDesPlats,
  ecrituresAjout, ecrituresRetrait, ecrituresRemise, ecrituresStyle, ecrituresReglage, EFFACER, statutSemaine,
  validerDates, texteErreurDates, cheminSur, semaineVisee, ecrituresAjoutGroupe, ecrituresRetraitGroupe,
  ecrituresRemplacement, aDesReglagesEcrits,
} from './coeur/semaine.js';
import {
  proposerPlats, proposerDesserts, nombreAProposer, apercuProposition, nombreDeDessertsParDefaut,
  autreIdee as autreIdeeDe, peutChangerDIdee, annonceProposition, texteAutreIdee, TEXTES_PROPOSER,
} from './coeur/proposition.js';
import {
  listeDeCourses, ecrituresCoche, ecrituresCocheArticle, ecrituresRachat, preparerAjout, texteAjoutArticle,
  ERREURS_ARTICLE, phraseRestesAjoutes, ecrituresRecherche, preparerFinDesCourses, ecrituresDernieresFois,
  TEXTES_FIN_DES_COURSES, articleGardeDeLaLigne, ecrituresRouvrirListe,
  ecrituresRayon, ecrituresPlacard, ecrituresHabituel, ecrituresSansHabituel, ecrituresSansHebdo, ecrituresPrecision,
  ecrituresRayons, ERREURS_HABITUEL, ERREURS_PRECISION, TEXTES_T3D, texteRayon, textePlacard, ordreRayons,
  placardDuFoyer, cleRecents, lireRecents as lireRecentsStockes, ajouterAuxRecents,
} from './coeur/liste.js';
import { indexDesRecettes, ficheProduit } from './coeur/produits.js';
import { modeleDrive, ecrituresDrive, ERREURS_DRIVE, texteMotNote } from './coeur/drive.js';
// T5-0b « Étapes détaillées » : écriture d'un lot d'étapes (importerEtapes).
import { TEXTES_ETAPES } from './coeur/realisation.js';

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
  // Semaines (T3a) : documents `semaines/{id}` bruts ({ id, ...champs }), toutes, historique compris.
  semaines: [],
  semainesChargees: false,
  semainesDepuisCache: false,
  // Articles ajoutés à la main (T3a) : documents `articles/{id}` bruts, indépendants des semaines.
  articles: [],
  articlesCharges: false,
  articlesDepuisCache: false,
  // Produits du foyer (T3b) : documents `produits/{id}` bruts (différences voulues par le foyer : mot cherché au drive…).
  produits: [],
  produitsCharges: false,
  produitsDepuisCache: false,
  apercu: false, // gestionnaire : aperçu de la vue « Repas et courses »
  // « Proposer les plats de la semaine » (T4-0), en mémoire seulement (ni Firestore, ni stockage du téléphone),
  // oubliés à la fermeture de l'app :
  // `proposes` : `<semaineId>|<platId>` → raison du choix (coeur/proposition.js), pour la ligne « ✨ Proposé : … » de
  // la feuille du plat, sur ce téléphone seulement ; `refuses` : semaineId → Set des plats remplacés par « 🔄 Une autre
  // idée », pour qu'une autre idée ne les rende pas aussitôt (remplacée, jamais modifiée sur place : mémos par objet).
  proposes: new Map(),
  refuses: new Map(),
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

// ——— Semaine et liste de courses (T3a) ———

/**
 * Vrai quand tout ce que la semaine et la liste demandent est lu (semaines, articles, plats, profils ; copie du
 * téléphone comprise). Avant : « Chargement… », boutons inactifs, et les actions de la semaine rendent
 * { code: 'chargement' } sans rien écrire (jamais de semaine créée sans connaître les autres, plan T3 §3.2 règle 4).
 */
function semainesLues() {
  return etat.semainesChargees && etat.articlesCharges && etat.platsCharges && etat.profilsCharges;
}

// Semaine montrée (coeur/semaine.js › semaineAPreparer) et semaine en cours quand la suivante est déjà montrée
// (semaineEnCours), gardées tant que `etat.semaines` est le même tableau et que le jour n'a pas changé : les écrans
// reçoivent le même objet d'un rendu à l'autre.
let memoSemaines = { semaines: null, aujourdhui: null, semaine: null, enCours: null };

function semainesDuJour(aujourdhui = dateDuJour()) {
  if (memoSemaines.semaines !== etat.semaines || memoSemaines.aujourdhui !== aujourdhui) {
    memoSemaines = {
      semaines: etat.semaines,
      aujourdhui,
      semaine: semaineAPreparer(etat.semaines, aujourdhui),
      enCours: semaineEnCours(etat.semaines, aujourdhui),
    };
  }
  return memoSemaines;
}

/** Semaine montrée par Semaine et Courses (lue par lireSemaine), ou null. */
function semaineCourante(aujourdhui = dateDuJour()) {
  return semainesDuJour(aujourdhui).semaine;
}

// Produits du foyer par identifiant (T3b : `ctx.produitsFoyer`, `produitsFoyer` de coeur/liste.js), table figée, gardée
// tant que `etat.produits` est le même tableau.
let memoProduits = { produits: null, parId: Object.freeze({}) };

function produitsFoyerCourants() {
  if (memoProduits.produits !== etat.produits) {
    const parId = {};
    for (const produit of etat.produits) {
      if (produit && typeof produit.id === 'string' && produit.id) parId[produit.id] = produit;
    }
    memoProduits = { produits: etat.produits, parId: Object.freeze(parId) };
  }
  return memoProduits.parId;
}

// Noms et rayons des recettes par produit (coeur/produits.js › indexDesRecettes), gardés tant que `etat.plats` est le
// même tableau : la liste et la carte « 🏠 Placard » (T3d) le partagent.
let memoIndex = { plats: null, index: null };

function indexCourant() {
  if (memoIndex.plats !== etat.plats || !memoIndex.index) memoIndex = { plats: etat.plats, index: indexDesRecettes(etat.plats) };
  return memoIndex.index;
}

// Liste de courses (coeur/liste.js › listeDeCourses), calculée sur le téléphone, jamais écrite. Gardée tant que la
// semaine montrée, les plats, les profils, les articles, les produits du foyer (T3b), les réglages du foyer
// (`etat.donnees.reglages`, nouvel objet à chaque instantané : ordre des rayons, `frigoJoursDefaut`…) et le jour sont
// les mêmes objets.
let memoListe = { cles: null, liste: null };

function listeCourante(aujourdhui = dateDuJour()) {
  const semaine = semaineCourante(aujourdhui);
  const reglages = etat.donnees.reglages ?? null;
  const cles = [semaine, etat.plats, etat.profils, etat.articles, etat.produits, reglages, aujourdhui];
  if (!memoListe.cles || cles.some((cle, i) => cle !== memoListe.cles[i])) {
    memoListe = {
      cles,
      liste: listeDeCourses(semaine, {
        tousLesPlats: etat.plats,
        profils: etat.profils,
        produitsFoyer: produitsFoyerCourants(),
        articles: etat.articles,
        reglages,
        evaluer: compat,
        index: indexCourant(),
        maintenant: Date.now(),
      }),
    };
  }
  return memoListe.liste;
}

// Ordre des rayons du foyer (T3d, coeur/liste.js › ordreRayons : `reglages/foyer.rayons`, sinon l'ordre de départ), gardé
// tant que `etat.donnees.reglages` est le même objet : `ctx.rayons` reste le même tableau d'un rendu à l'autre.
let memoRayons = { reglages: undefined, rayons: null };

function rayonsCourants() {
  const reglages = etat.donnees.reglages ?? null;
  if (memoRayons.reglages !== reglages || !memoRayons.rayons) {
    memoRayons = { reglages, rayons: Object.freeze(ordreRayons(reglages)) };
  }
  return memoRayons.rayons;
}

// Carte « 🏠 Placard » de Réglages (T3d, coeur/liste.js › placardDuFoyer : produits que le foyer a mis de côté ou
// éteints), gardée tant que les produits du foyer et les plats sont les mêmes tableaux.
let memoPlacard = { produits: null, plats: null, placard: [] };

function placardCourant() {
  if (memoPlacard.produits !== etat.produits || memoPlacard.plats !== etat.plats) {
    memoPlacard = {
      produits: etat.produits,
      plats: etat.plats,
      placard: placardDuFoyer(produitsFoyerCourants(), { index: indexCourant() }),
    };
  }
  return memoPlacard.placard;
}

/** Semaine lue par son identifiant (`semaineId`), ou la semaine montrée sans identifiant ; null si elle est inconnue. */
function semaineParId(semaineId) {
  if (semaineId === undefined || semaineId === null) return semaineCourante();
  return lireSemaine(etat.semaines.find((semaine) => semaine?.id === semaineId) ?? null);
}

// ——— Proposer les plats de la semaine (T4-0) ———

/** Plats remplacés par « 🔄 Une autre idée » pendant cette visite, pour la semaine `semaineId` → [platId]. */
function refusesDe(semaineId) {
  return [...(etat.refuses.get(semaineId) ?? [])];
}

/**
 * Semaine visée réduite à { id, debut, fin } (coeur/semaine.js › semaineVisee, ou une semaine lue) : ses plats se
 * lisent toujours dans `etat.semaines`, jamais dans une copie figée à l'ouverture d'une feuille. null si illisible.
 */
function cibleProposition(cible) {
  if (!cible || typeof cible.id !== 'string' || typeof cible.debut !== 'string' || typeof cible.fin !== 'string') return null;
  return { id: cible.id, debut: cible.debut, fin: cible.fin };
}

/** Options communes de coeur/proposition.js pour une cible (plats de la corbeille compris : le cœur les écarte). */
function optionsProposition(cible) {
  return { cible, semaines: etat.semaines, profils: etat.profils, evaluer: compat, refuses: refusesDe(cible.id) };
}

// Aperçus (coeur/proposition.js › apercuProposition) par semaine visée, gardés tant que semaines, plats, profils et
// refusés sont les mêmes objets : la carte et la feuille ne recalculent rien d'un rendu à l'autre.
let memoApercus = { semaines: null, plats: null, profils: null, refuses: null, resultats: new Map() };

/**
 * Ce que la carte « prochaine action » et la feuille de choix montrent pour une semaine visée : { plats, …, cause,
 * profilCause, desserts } (coeur/proposition.js › apercuProposition) ; null tant que tout n'est pas lu.
 */
function apercuPour(cible) {
  const visee = cibleProposition(cible);
  if (!visee || !semainesLues()) return null;
  const m = memoApercus;
  if (m.semaines !== etat.semaines || m.plats !== etat.plats || m.profils !== etat.profils || m.refuses !== etat.refuses) {
    memoApercus = { semaines: etat.semaines, plats: etat.plats, profils: etat.profils, refuses: etat.refuses, resultats: new Map() };
  }
  const cle = `${visee.id}|${visee.debut}|${visee.fin}`;
  if (!memoApercus.resultats.has(cle)) {
    memoApercus.resultats.set(cle, apercuProposition(etat.plats, optionsProposition(visee)));
  }
  return memoApercus.resultats.get(cle);
}

/** Nombre de desserts prérempli dans « Combien de desserts ? » (coeur/proposition.js › nombreDeDessertsParDefaut). */
function dessertsParDefautPour(cible) {
  const visee = cibleProposition(cible);
  if (!visee || !semainesLues()) return 1;
  const options = optionsProposition(visee);
  return nombreDeDessertsParDefaut(etat.semaines, visee, { ...options, tousLesPlats: etat.plats });
}

/** Raison retenue sur ce téléphone pour un plat proposé dans une semaine (« ✨ Proposé : … »), sinon null. */
function raisonProposee(semaineId, platId) {
  return etat.proposes.get(`${semaineId}|${platId}`) ?? null;
}

/**
 * Remplaçant de « 🔄 Une autre idée » pour un plat d'une semaine (coeur/proposition.js › autreIdee), seulement si le
 * bouton a sa place (peutChangerDIdee : plat ou dessert avec sa recette, avant les courses faites) → { platId, groupe,
 * palier, raison } | null.
 */
function autreIdeePour(semaineId, platId) {
  if (!semainesLues()) return null;
  const semaine = semaineParId(semaineId);
  const plat = platsSepares().actifs.find((p) => p.id === platId);
  if (!semaine || !plat || !estDansLaSemaine(semaine.plats[platId]) || !peutChangerDIdee(semaine, plat)) return null;
  const visee = cibleProposition(semaine);
  return visee ? autreIdeeDe(etat.plats, platId, optionsProposition(visee)) : null;
}

/** Nom brut d'un plat (annonce de « 🔄 Une autre idée », qui met ses propres guillemets). */
function nomBrut(platId) {
  return String(etat.plats.find((plat) => plat?.id === platId)?.nom ?? '').replace(/\s+/g, ' ').trim() || 'Ce plat';
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
 * Semaine et liste (T3a) : `semaine`, la semaine montrée par Semaine et Courses (coeur/semaine.js › semaineAPreparer,
 * lue par lireSemaine ; null s'il n'y en a pas ; même objet tant que rien ne change) ; `semaines`, tous les documents
 * `semaines/{id}` bruts ({ id, ...champs }) ; `semainesChargees`, vrai quand semaines, articles, plats et profils sont
 * lus (avant : « Chargement… », boutons inactifs) ; `semainesDepuisCache`, semaines lues seulement dans la copie du
 * téléphone ; `semaineEnCours`, semaine qui contient aujourd'hui quand la suivante est déjà montrée (ligne « En ce
 * moment… »), sinon null ; `articles`, documents `articles/{id}` bruts (`articlesCharges`, `articlesDepuisCache`) ;
 * `liste`, liste de courses de la semaine montrée (coeur/liste.js › listeDeCourses, jamais écrite ; même objet tant que
 * rien ne change) ; `enLigne`, réseau du téléphone (navigator.onLine).
 * Au drive (T3b) : `produits`, documents `produits/{id}` bruts ; `produitsFoyer`, les mêmes par identifiant (table figée,
 * même objet tant qu'ils ne changent pas : `produitsFoyer` de coeur/liste.js › ecrituresRecherche) ; `produitsCharges`,
 * `produitsDepuisCache`. Le drive du foyer se lit dans `reglages` (coeur/liste.js › reglagesCourses) ; le mode Drive /
 * Magasin est retenu par l'écran Courses sur ce téléphone.
 * Placard, habituels et rayons (T3d) : `rayons`, l'ordre des 14 rayons du foyer (coeur/liste.js › ordreRayons :
 * `reglages/foyer.rayons`, sinon l'ordre de départ ; tableau figé, même objet tant que les réglages ne changent pas) ;
 * `placardFoyer`, la carte « 🏠 Placard » de Réglages (coeur/liste.js › placardDuFoyer : [{ produitId, nom, actif,
 * deDepart, texte }], produits que le foyer a mis de côté ou éteints, triés par nom ; même objet tant que produits et
 * plats ne changent pas). Habituels et préparations de chaque semaine se lisent dans `liste` (`liste.habituels`,
 * `liste.preparations`, sautés compris) ; les récents de « Ajouter à la liste » par actions.lireRecents.
 * Proposer les plats de la semaine (T4-0) : `proposition.apercu(cible)` (coeur/proposition.js › apercuProposition pour
 * une semaine visée : bouton « ✨ Proposer 4 plats », ligne sans proposition, bouton « 🍰 Proposer des desserts » ;
 * null tant que tout n'est pas lu ; gardé tant que rien ne change), `proposition.dessertsParDefaut(cible)` (nombre
 * prérempli de « Combien de desserts ? »), `proposition.raison(semaineId, platId)` (raison retenue sur ce téléphone,
 * ou null) et `proposition.autreIdee(semaineId, platId)` (remplaçant de « 🔄 Une autre idée », ou null).
 */
function contexteCourant() {
  const { utilisateur } = etat;
  const { role, roleReel, route, parametre } = routeCourante();
  const { actifs, corbeille } = platsSepares();
  const aTraiter = etat.demandesChargees && etat.platsCharges && etat.profilsCharges
    ? demandesATraiter(etat.demandes, { plats: actifs, profils: etat.profils, evaluer: compat })
    : [];
  const aujourdhui = dateDuJour();
  const { semaine, enCours } = semainesDuJour(aujourdhui);
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
    aujourdhui,
    precautions,
    profilsAvecAge: profilsAvecAgeCourants(),
    empreintePrecautions: donnees.empreintePrecautions,
    surveilles: surveillesCourants(),
    semaine,
    semaines: etat.semaines,
    semainesChargees: semainesLues(),
    semainesDepuisCache: etat.semainesDepuisCache,
    semaineEnCours: enCours,
    articles: etat.articles,
    articlesCharges: etat.articlesCharges,
    articlesDepuisCache: etat.articlesDepuisCache,
    liste: listeCourante(aujourdhui),
    enLigne: navigator.onLine,
    produits: etat.produits,
    produitsFoyer: produitsFoyerCourants(),
    produitsCharges: etat.produitsCharges,
    produitsDepuisCache: etat.produitsDepuisCache,
    rayons: rayonsCourants(),
    placardFoyer: placardCourant(),
    proposition: {
      apercu: apercuPour,
      dessertsParDefaut: dessertsParDefautPour,
      raison: raisonProposee,
      autreIdee: autreIdeePour,
    },
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
    // Étapes détaillées (T5-0b) : une transaction par plat, en ligne seulement.
    if (ecritures.some((ecriture) => ecriture.mode === 'etapes')) {
      if (!navigator.onLine) {
        return Promise.reject(Object.assign(new Error(TEXTES_ETAPES.horsLigne), { code: 'hors_ligne' }));
      }
      return importerEtapes(ecritures);
    }
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
   * Télécharge une sauvegarde (CLAUDE.md §8), construite depuis les données de ce téléphone : plats, profils et, depuis
   * T3b, réglages des produits (`produits/{id}`) et drive du foyer (`reglages/foyer.drive`, seul réglage sauvegardé).
   * Synchrone : à appeler dans le toucher (le navigateur bloque un téléchargement lancé après une attente). En ligne
   * seulement, et si plats, profils, produits et réglages viennent du serveur, la date est marquée dans
   * `reglages/foyer.derniereSauvegarde` et appliquée tout de suite sur ce téléphone ; sinon, le fichier est donné mais
   * ne compte pas comme dernière sauvegarde (`horsLigne`).
   * → { resume, aCorriger, horsLigne }, ou null tant que plats et profils ne sont pas chargés (rien n'est téléchargé).
   */
  sauvegarder() {
    if (!etat.platsCharges || !etat.profilsCharges) return null;
    const maintenant = new Date();
    const { nomFichier, texte, resume, aCorriger } = creerSauvegarde(
      { plats: etat.plats, profils: etat.profils, produits: etat.produits, reglages: etat.donnees.reglages ?? null },
      { maintenant },
    );
    telecharger(nomFichier, texte);
    // Copie du téléphone pas encore confirmée par le serveur (réseau absent ou médiocre ; produits pas encore lus, T3b) :
    // le fichier est donné, mais il ne compte pas comme dernière sauvegarde.
    const horsLigne = !navigator.onLine || etat.platsDepuisCache || etat.profilsDepuisCache
      || !etat.produitsCharges || etat.produitsDepuisCache || Boolean(etat.donnees.depuisCache);
    if (!horsLigne) {
      ecrire(donnees.marquerSauvegarde(maintenant), 'La date de la sauvegarde n’a pas pu être enregistrée.');
      if (etat.donnees.reglages) {
        etat.donnees = { ...etat.donnees, reglages: { ...etat.donnees.reglages, derniereSauvegarde: maintenant } };
      }
      rendre();
    }
    return { resume, aCorriger, horsLigne };
  },
  /**
   * Données lues sur le serveur (restauration) : { plats, profils, demandes, produits } (documents { id, ...champs }) et
   * { reglages } (le document `reglages/foyer`, ou null), à passer tels quels à coeur/sauvegarde.js ›
   * preparerRestauration. → promesse ; rejetée hors ligne.
   */
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

  // ——— Semaine et liste de courses (T3a, les deux membres, aperçu compris) ———
  // Chaque geste est écrit par un lot (hors ligne : part plus tard), appliqué tout de suite sur ce téléphone, puis
  // l'écran est redessiné. Rien n'est écrit à l'ouverture d'un écran ni d'une feuille.

  /**
   * « ＋ Ajouter à la semaine » (fiche) et une case de la feuille « Ajouter à la semaine » : le plat va dans la semaine
   * `cible` ({ id, debut, fin }, coeur/semaine.js › semaineVisee, figée par l'écran à l'ouverture de la feuille ou au
   * toucher ; sans elle, celle du moment), créée dans le même lot si elle n'existe pas encore, avec les articles des
   * `restes` gardés (coeur/liste.js › restes ; seulement tant que la cible n'a aucun plat). Un plat retiré revient avec
   * ses réglages. Annonce « « Gratin » ajouté à la semaine du 17 au 23 octobre. » (suivie, si des restes sont partis
   * avec lui, de « Les 7 articles pas pris de la semaine qui finit passent sur sa liste. ») avec « Annuler » (qui le
   * retire de cette même semaine, sans autre annonce ; vidée, une semaine qui commence plus tard emporte ses restes) ;
   * `silencieux: true` (feuille de choix, où la case et la phrase des restes suffisent) : aucune annonce.
   * → { code: 'ok', id (semaine), creee (vrai si ce geste a créé la semaine), restes (articles des restes écrits) } |
   *   { code } : chargement (semaines, articles, plats ou profils pas encore lus : rien n'est écrit), invalide (plat
   *   inconnu, dans la corbeille, apéro ou préparation de chaque semaine, cible illisible), deja (déjà dans cette
   *   semaine ; `id`), chevauche (T3c, `silencieux` seulement : la cible, encore sans plat, touche une semaine qui a
   *   des plats ; rien n'est écrit), echec (lot impossible à construire : annoncé), refuse.
   */
  ajouterALaSemaine(platId, { cible = null, restes = [], silencieux = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const plat = platsSepares().actifs.find((p) => p.id === platId);
    if (!plat) return { code: 'invalide' };
    const preparer = (visee) => ecrituresAjout(etat.semaines, platId, {
      cible: visee,
      semainesChargees: etat.semainesChargees,
      aujourdhui: dateDuJour(),
      auteur: etat.utilisateur.email,
      maintenant: Date.now(),
      restes,
      plat,
    });
    let ecritures = preparer(cible);
    // Cible devenue impossible (ses dates touchent une semaine qui a des plats, changée entre-temps sur l'autre
    // téléphone) : la fiche et Plats prennent la semaine visée du moment, que l'annonce dit ; la feuille de choix
    // (`silencieux`), qui affiche ses dates, recalcule elle-même la sienne.
    if (ecritures.code === 'chevauche' && cible && !silencieux) ecritures = preparer(null);
    if (ecritures.code) return ecritures;
    const nom = citerPlat(platId);
    if (!ecrireDansLaSemaine(ecritures, `${nom} n’a pas pu être ajouté à la semaine. Réessayez.`)) return { code: 'echec' };
    rendre();
    const semaine = semaineParId(ecritures.id);
    const nbRestes = ecritures.articles?.length ?? 0;
    if (!silencieux) {
      const dates = semaine ? ` ${texteDates(semaine.debut, semaine.fin)}` : '';
      const suite = nbRestes ? ` ${phraseRestesAjoutes(nbRestes)}` : '';
      annoncer(`${nom} ajouté à la semaine${dates}.${suite}`, {
        action: { libelle: 'Annuler', faire: () => retirerDe(ecritures.id, platId) },
      });
    }
    return { code: 'ok', id: ecritures.id, creee: Boolean(ecritures.creation), restes: nbRestes };
  },
  /**
   * « Retirer de la semaine » (feuille du plat ; second toucher d'une case de la feuille de choix) : `retire: true`,
   * l'entrée et ses réglages restent. `semaineId` : la semaine visée (sans lui, la semaine montrée). Vidée, une semaine
   * qui commence plus tard s'efface de l'écran et emporte ses articles des restes pas cochés (coeur/semaine.js ›
   * ecrituresRetrait). Annonce « « Gratin » retiré de la semaine. » avec « Annuler », qui le remet (nouvel `ajouteLe`,
   * réglages gardés, restes rendus) ; `silencieux: true` : aucune annonce.
   * → { code: 'ok', vide (la semaine n'a plus de plat) } | { code } : chargement, inutile (pas dans cette semaine),
   *   invalide, echec, refuse.
   */
  retirerDeLaSemaine(platId, { semaineId = null, silencieux = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineParId(semaineId);
    if (!semaine) return { code: 'invalide' };
    if (!estDansLaSemaine(semaine.plats[platId])) return { code: 'inutile' };
    const ecritures = ecrituresRetrait(semaine, platId, { articles: etat.articles, aujourdhui: dateDuJour() });
    if (ecritures.code) return ecritures;
    const nom = citerPlat(platId);
    const emportes = articlesParId(ecritures.supprimer);
    if (!ecrireDansLaSemaine(ecritures, `${nom} n’a pas pu être retiré de la semaine. Réessayez.`)) return { code: 'echec' };
    rendre();
    if (!silencieux) {
      annoncer(`${nom} retiré de la semaine.`, {
        action: { libelle: 'Annuler', faire: () => remettreDans(semaine.id, platId, emportes) },
      });
    }
    return { code: 'ok', vide: !aDesPlats(semaineParId(semaine.id)) };
  },
  /**
   * « ✨ Proposer 4 plats » (T4-0, les deux membres, aperçu compris ; carte « prochaine action » de Semaine, et premier
   * bouton de la feuille « Ajouter à la semaine » quand la semaine visée n'a aucun plat) : des plats du foyer qui ont
   * leur recette entrent d'un coup dans la semaine `cible` ({ id, debut, fin }, figée par la feuille ; sans elle,
   * semaineVisee au toucher), en UN lot (coeur/semaine.js › ecrituresAjoutGroupe : mêmes écritures qu'une case cochée,
   * création de la semaine et articles des `restes` avec le premier plat, seulement si la cible n'avait aucun plat).
   * `nombreAnnonce` : le nombre dit par le libellé du bouton, ramené à ce qui manque (coeur/proposition.js ›
   * nombreAProposer : des cases cochées entre-temps comptent) et à ce qui est disponible ; l'annonce dit le vrai
   * nombre. Annonce (coeur/proposition.js › annonceProposition) avec « Annuler » pendant 30 s (annulerProposition :
   * remet tout comme avant, puis `apresAnnulation()`). Les raisons des choix sont gardées sur ce téléphone (ligne
   * « ✨ Proposé : … » de la feuille du plat). `feuille: true` (feuille de choix) : un `chevauche` est rendu tel quel
   * (la feuille recalcule sa semaine visée et le dit) ; sinon, un essai de plus sur la semaine visée du moment, puis la
   * phrase d'erreur. `avant(premierPlatId)` : appelé une fois le lot prêt, juste avant de l'écrire (une feuille se ferme
   * là : l'annonce et son « Annuler » ne doivent pas naître derrière une feuille modale).
   * → { code: 'ok' | 'peu', id, ajoutes: [{ platId, ajouteLe }], deja, restes, choisis } | { code } : aucun (rien à
   *   proposer), complet (plats seulement : la semaine a déjà son nombre de plats), vide (déjà tous dans la semaine),
   *   chargement, chevauche, invalide, echec (annoncé), refuse.
   */
  proposerALaSemaine({
    cible = null, restes = [], nombreAnnonce = null, feuille = false, apresAnnulation = null, avant = null,
  } = {}) {
    return proposerDansLaSemaine('plat', { cible, restes, nombre: nombreAnnonce, feuille, apresAnnulation, avant });
  },
  /**
   * « 🍰 Proposer 2 desserts » (D6, feuille « Combien de desserts ? », ouverte depuis Semaine ou la feuille de choix) :
   * `nombre` desserts (1 à 4) entrent d'un coup dans la semaine `cible`, comme proposerALaSemaine (même lot, mêmes
   * restes, même « Annuler » 30 s, même `chevauche` : la feuille reste ouverte et recalcule sa semaine visée).
   * → mêmes retours que proposerALaSemaine.
   */
  proposerDessertsALaSemaine({
    cible = null, restes = [], nombre = 1, feuille = true, apresAnnulation = null, avant = null,
  } = {}) {
    return proposerDansLaSemaine('dessert', { cible, restes, nombre, feuille, apresAnnulation, avant });
  },
  /**
   * « Annuler » d'une proposition (✨ ou 🍰) : les plats ajoutés par le geste repartent (`retire: true`), seulement ceux
   * dont l'entrée garde l'`ajouteLe` écrit (coeur/semaine.js › ecrituresRetraitGroupe) ; vidée, une semaine qui commence
   * plus tard emporte ses restes pas cochés. Rien n'est écarté pour la suite. Plus rien à retirer : « Ces plats ont été
   * réglés sur l’autre téléphone. ». Puis `apresAnnulation()` (l'écran rend le focus).
   * → { code } : ok, inutile, invalide, chargement, echec, refuse.
   */
  annulerProposition(semaineId, ajoutes, { apresAnnulation = null } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineParId(semaineId);
    if (!semaine) return { code: 'invalide' };
    const ecritures = ecrituresRetraitGroupe(semaine, ajoutes, { articles: etat.articles, aujourdhui: dateDuJour() });
    if (ecritures.code === 'inutile') {
      annoncer(TEXTES_PROPOSER.erreurs.inutile);
      return ecritures;
    }
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'Les plats n’ont pas pu être retirés de la semaine. Réessayez.')) return { code: 'echec' };
    for (const { platId } of Array.isArray(ajoutes) ? ajoutes : []) etat.proposes.delete(`${semaine.id}|${platId}`);
    rendre();
    if (typeof apresAnnulation === 'function') apresAnnulation();
    return { code: 'ok' };
  },
  /**
   * « 🔄 Une autre idée » (feuille du plat de la semaine) : un autre plat du même type prend sa place, en un lot
   * (coeur/semaine.js › ecrituresRemplacement : même `ajouteLe`, l'ancien passe `retire: true` avec ses réglages).
   * L'ancien n'est plus proposé pendant cette visite (sauf après « Annuler »). Annonce « « Curry » à la place de « Gratin ». » (« Invités et
   * repas sont à régler de nouveau. » s'il avait des réglages) avec « Annuler » (l'ancien revient avec ses réglages, puis
   * `apresAnnulation(ancienId)`). `semaineId` : sans lui, la semaine montrée. `avant(nouveauId)` : appelé une fois le
   * lot prêt, juste avant de l'écrire (la feuille du plat se ferme là, avant l'annonce).
   * → { code: 'ok', nouveau } | { code } : aucune (plus d'autre idée : rien n'est écrit, rien n'est annoncé), faites,
   *   inutile, invalide, chargement, echec, refuse.
   */
  autreIdee(platId, { semaineId = null, apresAnnulation = null, avant = null } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineParId(semaineId);
    if (!semaine || !estDansLaSemaine(semaine.plats[platId])) return { code: 'invalide' };
    const idee = autreIdeePour(semaine.id, platId);
    if (!idee) return { code: 'aucune' };
    const ecritures = ecrituresRemplacement(semaine, platId, idee.platId);
    if (ecritures.code) return ecritures;
    const reglages = aDesReglagesEcrits(semaine.plats[platId]);
    if (typeof avant === 'function') avant(idee.platId);
    if (!ecrireDansLaSemaine(ecritures, 'Ce plat n’a pas pu être changé. Réessayez.')) return { code: 'echec' };
    const refuses = new Map(etat.refuses);
    refuses.set(semaine.id, new Set([...(refuses.get(semaine.id) ?? []), platId]));
    etat.refuses = refuses;
    etat.proposes.set(`${semaine.id}|${idee.platId}`, idee.raison);
    rendre();
    const ancienId = platId;
    const nouveauId = idee.platId;
    annoncer(texteAutreIdee({ nouveau: nomBrut(nouveauId), ancien: nomBrut(ancienId), reglages }), {
      action: {
        libelle: 'Annuler',
        faire: () => {
          const actuelle = semaineParId(semaine.id);
          const inverse = actuelle ? ecrituresRemplacement(actuelle, ancienId, nouveauId, { inverse: true }) : { code: 'invalide' };
          if (inverse.code === 'inutile') {
            annoncer(TEXTES_PROPOSER.erreurs.inutile);
            return;
          }
          if (inverse.code || !ecrireDansLaSemaine(inverse, 'Ce plat n’a pas pu être remis. Réessayez.')) return;
          etat.proposes.delete(`${semaine.id}|${nouveauId}`);
          // L'ancien plat, gardé exprès, redevient proposable (nouvelle Map : les aperçus mémorisés sont recalculés).
          const refusesApres = new Map(etat.refuses);
          const reste = new Set(refusesApres.get(semaine.id) ?? []);
          reste.delete(ancienId);
          if (reste.size) refusesApres.set(semaine.id, reste);
          else refusesApres.delete(semaine.id);
          etat.refuses = refusesApres;
          rendre();
          if (typeof apresAnnulation === 'function') apresAnnulation(ancienId);
        },
      },
    });
    return { code: 'ok', nouveau: nouveauId };
  },
  /**
   * Mer / Végétale pour un profil (carte du plat, feuille du plat) : `plats.<id>.styles.<profilId>` ; le style par
   * défaut (la mer si elle convient) efface le chemin. Aucune annonce : la carte change aussitôt. `semaineId` : sans
   * lui, la semaine montrée.
   * → { code } : ok, chargement, inutile (plat absent de la semaine), style (ce style ne convient pas), invalide, echec,
   *   refuse.
   */
  choisirStyle(platId, profilId, style, { semaineId = null } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineParId(semaineId);
    if (!semaine) return { code: 'invalide' };
    if (!estTable(semaine.plats[platId])) return { code: 'inutile' };
    const ecritures = ecrituresStyle(semaine, platId, profilId, style, {
      evaluer: compat, tousLesPlats: etat.plats, profils: etat.profils,
    });
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'Ce choix n’a pas pu être enregistré. Réessayez.')) return { code: 'echec' };
    rendre();
    return { code: 'ok' };
  },
  /**
   * Réglage d'un plat de la semaine (feuille du plat), préparé par coeur/semaine.js › ecrituresReglage, chaque champ
   * écrit seul par son chemin pointé (`update` en lot ; hors ligne : part plus tard ; aucune transaction) :
   * - `repas` (T3a) : entier de 1 à 14, écrit même s'il vaut le défaut ; null : revenir au défaut ;
   * - `mange: { profilId: bool | null }` (T3c, « Qui en mange ? ») : `plats.<id>.mange.<p>` ; une valeur égale au défaut
   *   du moment efface le chemin (une version arrivée plus tard fera entrer le profil toute seule) ;
   * - `invites: { adultes?, enfants? }` (T3c) : entiers de 0 à 20, chacun son chemin ; 0 ou null efface ; un invité
   *   n'écrit jamais `repas` (il ajoute des portions, sans retirer de repas) ;
   * - `styles: { profilId: 'mer' | 'vegetal' | null }` : comme choisirStyle ;
   * - `depart: true` (T3c, « Revenir aux réglages de départ ») : chaque réglage écrit du plat effacé, chemin par chemin ;
   *   des touchers qui le suivent (coeur/semaine.js › fusionnerReglages) s'écrivent par-dessus, dans le même lot.
   * Écrit tout de suite : l'écran regroupe lui-même les touchers (0,8 s, fusionnerReglages, affichage immédiat par
   * appliquerChamps) et les envoie à la fermeture de la feuille ou quand l'app passe en arrière-plan. Aucune annonce :
   * la phrase des portions change aussitôt. Jamais de demande ici (« 📬 Demander ma version » reste un geste :
   * actions.demander). `semaineId` : sans lui, la semaine montrée.
   * → { code } : ok, chargement, inutile (plat absent de la semaine ; `depart` seul sur un plat sans réglage écrit),
   *   style (ce style ne convient pas), invalide (réglage illisible, clé inconnue, profil inconnu), echec, refuse.
   */
  reglerPlat(platId, reglage, { semaineId = null } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineParId(semaineId);
    if (!semaine) return { code: 'invalide' };
    if (!estTable(semaine.plats[platId])) return { code: 'inutile' };
    const ecritures = ecrituresReglage(semaine, platId, reglage, {
      evaluer: compat, tousLesPlats: etat.plats, profils: etat.profils,
    });
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'Ce réglage n’a pas pu être enregistré. Réessayez.')) return { code: 'echec' };
    rendre();
    return { code: 'ok' };
  },
  /**
   * « Les dates de la semaine » (T3c, « Changer » à côté de « Du 10 au 16 octobre » ; les deux membres) : nouvelles
   * dates `debut` et `fin` ('AAAA-MM-JJ', `input type=date`) de la semaine `semaineId` (sans lui, la semaine montrée),
   * vérifiées sur le téléphone (coeur/semaine.js › validerDates, avec la date du jour : 14 jours au plus, fin pas encore
   * passée, aucun jour commun avec une autre semaine qui a des plats ; une semaine vidée, invisible, ne compte pas).
   * Écrites par `update` en lot (hors ligne : part plus tard ; aucune transaction), toujours ensemble dès que l'une
   * change (validerDates les rend ensemble) : deux téléphones qui changent l'un le début, l'autre la fin ne laissent
   * jamais une semaine illisible (fin avant le début, plus de 14 jours), qui disparaîtrait avec ses plats. Jamais l'identifiant (figé), le statut, les traces de « Courses terminées », les
   * articles `garde--` et `reste--`, ni `derniereFois` : une semaine aux courses faites garde ses dates modifiables,
   * rien d'autre ne change. Appliqué tout de suite, puis annonce `message` (« Dates enregistrées : du 11 au
   * 17 octobre. » ; « … : le 10 octobre. » pour un seul jour) juste après, une fois que la feuille, qui se ferme au
   * retour de l'action, ne rend plus la zone d'annonce inerte ; `silencieux: true` : aucune annonce (l'écran peut
   * annoncer `message` lui-même).
   * → { code: 'ok', id, debut, fin, message } | { code: 'inchange' } (mêmes dates : rien n'est écrit) |
   *   { code: erreur, erreur: 'vide' | 'ordre' | 'duree' | 'passee' | 'chevauche', message, avec? } (rien n'est écrit ;
   *   le résultat de validerDates, que texteErreurDates lit aussi ; `message` : « La fin doit venir après le début. »,
   *   « Deux semaines au plus. », « Ces dates touchent la semaine du 3 au 9 octobre : choisissez d’autres dates. »,
   *   « Choisissez les deux dates. », « La semaine doit finir aujourd’hui ou plus tard. » ; `avec` : { debut, fin } de
   *   la semaine touchée) |
   *   { code: 'chargement' | 'invalide' (aucune semaine, ou semaine inconnue) | 'echec' (lot impossible à construire :
   *   annoncé) | 'refuse' }.
   */
  changerDates({ debut = null, fin = null } = {}, { semaineId = null, silencieux = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineParId(semaineId);
    if (!semaine) return { code: 'invalide' };
    const resultat = validerDates({ debut, fin }, { semaines: etat.semaines, id: semaine.id, aujourdhui: dateDuJour() });
    if (resultat.erreur) {
      return {
        code: resultat.erreur,
        erreur: resultat.erreur,
        message: texteErreurDates(resultat),
        ...(resultat.avec ? { avec: { ...resultat.avec } } : {}),
      };
    }
    if (resultat.code) return { code: resultat.code };
    if (!ecrireDansLaSemaine(resultat, 'Les dates n’ont pas pu être enregistrées. Réessayez.')) {
      return { code: 'echec' };
    }
    rendre();
    const message = `Dates enregistrées\u00A0: ${texteDates(debut, fin)}.`;
    // Annoncée au tour suivant : la feuille des dates (modale), fermée au retour de l'action, laisse alors la zone
    // d'annonce lisible par le lecteur d'écran.
    if (!silencieux) setTimeout(() => annoncer(message), 0);
    return { code: 'ok', id: resultat.id, debut, fin, message };
  },
  /**
   * Cocher (`oui` vrai) ou décocher une ligne de la liste par sa clé (`ligne.cle` de ctx.liste) : une ligne calculée
   * écrit `coches.<cle>` de la semaine montrée (la quantité affichée au moment du toucher, coeur/liste.js ›
   * ecrituresCoche) ou l'efface ; un article à la main (`article:<id>`, ou son identifiant) écrit `articles/{id}.coche`
   * (un article supprimé entre-temps n'est jamais recréé : refus silencieux). Rien n'est écrit si la ligne est déjà dans
   * l'état voulu. Courses terminées (« Revoir la liste ») : l'article qui garde la ligne pour la prochaine fois
   * (coeur/liste.js › articleGardeDeLaLigne) est coché ou décoché avec elle, par sa propre écriture (un article supprimé
   * ailleurs n'empêche jamais la coche de la ligne). Aucune annonce : la progression de Courses le dit.
   * → { code } : ok, chargement, inutile (clé inconnue de la liste), invalide, echec, refuse.
   */
  cocher(cle, oui) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const voulu = Boolean(oui);
    const liste = listeCourante();
    const maintenant = Date.now();
    const echec = 'La liste n’a pas pu être mise à jour. Réessayez.';
    const article = liste.articles.find((a) => a.cle === cle || a.articleId === cle);
    if (article) {
      const resultat = cocherArticle(article, voulu, maintenant, echec);
      if (resultat.code === 'ok') rendre();
      return resultat;
    }
    const ligne = liste.lignes.find((l) => l.cle === cle);
    if (!ligne) return { code: 'inutile' };
    // Déjà prise en entier (cocher) ou rien de pris (décocher) : rien à écrire.
    if (voulu ? ligne.cochee : !ligne.cochee && !ligne.dejaPris) return { code: 'ok' };
    const semaine = semaineCourante();
    const ecritures = ecrituresCoche(semaine, ligne, voulu, { maintenant });
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, echec)) return { code: 'echec' };
    const garde = articleGardeDeLaLigne(semaine, ligne, liste);
    if (garde) cocherArticle(garde, voulu, maintenant, echec);
    rendre();
    return { code: 'ok' };
  },
  /**
   * « À racheter » d'un produit du placard (« Déjà à la maison ? », feuille ⋮) : `racheter.<cle>` de la semaine montrée
   * (vrai), ou effacé. Rien n'est écrit si c'est déjà l'état voulu. Aucune annonce.
   * → { code } : ok, chargement, invalide (aucune semaine, clé hors chemin sûr), echec, refuse.
   */
  racheter(cle, oui) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineCourante();
    if (!semaine) return { code: 'invalide' };
    const voulu = Boolean(oui);
    // Clés de repli de la ligne (coeur/liste.js) : un « À racheter » rangé sous l'une d'elles compte aussi, et s'efface avec.
    const liste = listeCourante();
    const replis = [...liste.lignes, ...liste.maison].find((l) => l.cle === cle)?.replis ?? [];
    const pose = (c) => typeof c === 'string' && Object.hasOwn(semaine.racheter, c) && semaine.racheter[c] === true;
    if ([cle, ...replis].some(pose) === voulu) return { code: 'ok' };
    const ecritures = ecrituresRachat(semaine, cle, voulu, { replis });
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'La liste n’a pas pu être mise à jour. Réessayez.')) return { code: 'echec' };
    rendre();
    return { code: 'ok' };
  },
  /**
   * « Ajouter à la liste » : nouvel article `articles/{id}` ({ libelle, creePar, creeLe }), indépendant des semaines.
   * N'annonce rien : la feuille montre `message` dans sa zone `aria-live` (« ✓ « Piles » ajouté. » ; même produit déjà
   * dans la liste, l'ajout restant fait : « ✓ « Lait » ajouté. Il y en a aussi 6 l pour vos plats. », T3d « … 6 l chaque
   * semaine. » pour une ligne « Comme chaque semaine » ; `aussi` non nul : la feuille offre alors « Retirer »,
   * c'est-à-dire retirerArticle(id, { silencieux: true })). T3d : le libellé rejoint les récents de ce compte sur ce
   * téléphone (puces « Récents », actions.lireRecents).
   * → { code: 'ok', id, message, aussi } | { code: 'vide' | 'long', message } (« Écrivez le nom d'un article. »,
   *   « 60 caractères au plus. ») | { code: 'echec', message } (lot impossible à construire) | { code: 'refuse' }.
   */
  ajouterArticle(libelle) {
    if (!etat.utilisateur) return { code: 'refuse', message: null };
    const prepare = preparerAjout(libelle, { liste: listeCourante() });
    if (prepare.erreur) return { code: prepare.erreur, message: ERREURS_ARTICLE[prepare.erreur] ?? null };
    const email = etat.utilisateur.email;
    const article = {
      libelle: prepare.donnees.libelle,
      ...(typeof email === 'string' && email ? { creePar: email } : {}),
      creeLe: Date.now(),
    };
    const echec = `«\u00A0${nomArticle(article)}\u00A0» n’a pas pu être ajouté à la liste. Réessayez.`;
    let resultat;
    try {
      resultat = donnees.ajouterArticle(article);
    } catch {
      return { code: 'echec', message: echec };
    }
    ecrire(resultat.envoi, echec);
    etat.articles = [...etat.articles, { ...article, id: resultat.id }];
    noterRecent(article.libelle);
    rendre();
    return { code: 'ok', id: resultat.id, message: texteAjoutArticle(article.libelle, prepare.aussi), aussi: prepare.aussi };
  },
  /**
   * « Retirer de la liste » d'un article à la main (`id` : son identifiant, ou la clé `article:<id>`) : document supprimé.
   * Annonce « « Piles » retiré de la liste. » avec « Annuler », qui remet le même document (même identifiant) ;
   * `silencieux: true` (« Retirer » de la feuille d'ajout, qui montre `message` elle-même) : aucune annonce.
   * → { code: 'ok', message } | { code: 'inutile' | 'echec' | 'refuse', message } (inutile : article inconnu).
   */
  retirerArticle(id, { silencieux = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse', message: null };
    const articleId = typeof id === 'string' && id.startsWith('article:') ? id.slice('article:'.length) : id;
    const article = etat.articles.find((a) => a?.id === articleId);
    if (!article) return { code: 'inutile', message: null };
    const nom = nomArticle(article);
    const echec = `«\u00A0${nom}\u00A0» n’a pas pu être retiré de la liste. Réessayez.`;
    let envoi;
    try {
      envoi = donnees.supprimerArticles([articleId]);
    } catch {
      annoncer(echec);
      return { code: 'echec', message: echec };
    }
    ecrire(envoi, echec);
    etat.articles = etat.articles.filter((a) => a !== article);
    rendre();
    const message = `«\u00A0${nom}\u00A0» retiré de la liste.`;
    if (!silencieux) annoncer(message, { action: { libelle: 'Annuler', faire: () => remettreArticle(article) } });
    return { code: 'ok', message };
  },

  // ——— Au drive et fin des courses (T3b, les deux membres, aperçu compris) ———
  // Comme en T3a : chaque geste part par un lot (hors ligne : plus tard ; aucune transaction, rien ne doit être refusé
  // en magasin), appliqué tout de suite sur ce téléphone, puis l'écran est redessiné. Rien n'est écrit à l'ouverture
  // d'un écran ni d'une feuille.

  /**
   * Drive du foyer (feuille « Votre drive », les deux membres, depuis Courses ou Réglages) : `drive`, un drive lu
   * ({ nom, urlRecherche } : « Enregistrer » avec le modèle de coeur/drive.js › modeleDrive, ou « Annuler » de « Ne plus
   * chercher au drive »), l'adresse collée elle-même (texte, lue par modeleDrive), ou null (« Ne plus chercher au
   * drive »). Écrit `reglages/foyer.drive` ({ nom, urlRecherche }, ou effacé) par `update` du seul champ (hors ligne :
   * plus tard ; jamais un `set` du document), appliqué tout de suite (`ctx.reglages`, 🔍 de Courses). N'annonce rien :
   * la feuille le fait (« Votre drive : drive.exemple.fr », annonce de l'arrêt avec « Annuler »).
   * → { code: 'ok', drive (null : plus de drive) } | { code: 'vide' | 'https' | 'absent' | 'longue', message }
   *   (adresse refusée, ERREURS_DRIVE : rien n'est écrit) | { code: 'invalide' | 'chargement' | 'echec' | 'refuse' }
   *   (echec : lot impossible à construire, annoncé). null sans drive réglé : { code: 'ok', drive: null }, rien d'écrit.
   */
  reglerDrive(drive) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!etat.donnees.reglages) return { code: 'chargement' };
    let voulu = drive;
    if (typeof drive === 'string') {
      const lu = modeleDrive(drive);
      if (lu.erreur) return { code: lu.erreur, message: ERREURS_DRIVE[lu.erreur] ?? null };
      voulu = { nom: lu.nom, urlRecherche: lu.modele };
    }
    if (voulu !== null && (!voulu || typeof voulu !== 'object')) return { code: 'invalide' };
    // Rien à effacer : aucun drive n'est écrit.
    if (voulu === null && !Object.hasOwn(etat.donnees.reglages, 'drive')) return { code: 'ok', drive: null };
    const ecritures = ecrituresDrive(voulu);
    if (ecritures.code) return ecritures;
    const echec = voulu === null
      ? 'Ce réglage n’a pas pu être enregistré. Réessayez.'
      : 'Le drive n’a pas pu être enregistré. Réessayez.';
    if (!ecrireLesReglages(ecritures.champs, echec)) return { code: 'echec' };
    rendre();
    return { code: 'ok', drive: voulu === null ? null : ecritures.champs.drive };
  },
  /**
   * « Au drive, je cherche » (feuille ⋮ d'une ligne ou d'un article, « Changer le mot cherché » au retour du drive ; les
   * deux membres) : `cle`, la clé de la ligne (`ligne.cle` de ctx.liste, placard compris ; `article:<id>` ou
   * l'identifiant d'un article) ; `saisie`, le mot tapé (coeur/liste.js › ecrituresRecherche). Un mot de 60 caractères
   * au plus est écrit sous le produit de la ligne (`produits/{id}.rechercheDrive`, `set` + `mergeFields` ; hors ligne :
   * plus tard) ; vide, ou le nom de la ligne : retour au nom (« Revenir à « pâtes courtes » »), le mot effacé sous chaque
   * clé de la ligne qui en porte un. Appliqué tout de suite : le 🔍 cherche aussitôt le nouveau mot. N'annonce rien : la
   * feuille, qui se ferme, annonce `message` (« C’est noté : « penne » servira les prochaines fois. » ; retour au nom :
   * avec le nom de la ligne) ; `annoncer: true` : l'action l'annonce elle-même.
   * → { code: 'ok', terme (le mot ; null : retour au nom), message } | { code: 'long', message } (« 60 caractères au
   *   plus. », rien n'est écrit) | { code: 'chargement' (semaines, articles, plats, profils ou produits pas encore lus) |
   *   'inutile' (clé inconnue de la liste) | 'invalide' | 'echec' | 'refuse' }.
   */
  changerRecherche(cle, saisie, { annoncer: annoncerMessage = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues() || !etat.produitsCharges) return { code: 'chargement' };
    const ligne = ligneDeLaListe(cle);
    if (!ligne) return { code: 'inutile' };
    const produitsFoyer = produitsFoyerCourants();
    const resultat = ecrituresRecherche(ligne, saisie, { produitsFoyer });
    if (resultat.erreur) return { code: resultat.erreur, message: ERREURS_ARTICLE[resultat.erreur] ?? null };
    if (resultat.code) return resultat;
    // Le même mot, déjà écrit sous ce produit : rien à réécrire.
    const deja = resultat.terme !== null && produitsFoyer[ligne.produitId]?.rechercheDrive === resultat.terme;
    const ecritures = deja ? [] : resultat.ecritures;
    if (ecritures.length) {
      const echec = 'Le mot cherché n’a pas pu être enregistré. Réessayez.';
      let envoi;
      try {
        envoi = donnees.ecrireProduits(ecritures);
      } catch {
        annoncer(echec);
        return { code: 'echec' };
      }
      ecrire(envoi, echec);
      appliquerProduits(ecritures);
      rendre();
    }
    const message = texteMotNote(resultat.terme ?? ligne.libelle);
    if (annoncerMessage) annoncer(message);
    return { code: 'ok', terme: resultat.terme, message };
  },
  /**
   * « Courses terminées » (Courses, les deux membres) sur la semaine montrée (coeur/liste.js › preparerFinDesCourses) :
   * un lot (statut `courses_faites`, `statutAvant`, `coursesFaitesLe`, `coursesFaitesPar`, `coursesFaitesA` ; tous les
   * articles cochés supprimés, cachés compris ; avec `garder`, chaque ligne restée à acheter devient un article
   * `garde--<semaine>--<produit>` avec la quantité qui manque, et les articles pas cochés restent ; sans `garder`
   * (« Terminer sans eux »), les articles pas cochés sont supprimés aussi), puis la date des plats cuisinés
   * (`derniereFois` = début de la semaine, jamais en arrière, un lot par plat, sans message). Hors ligne : part plus
   * tard. Appliqué tout de suite. Annonce « Courses terminées. Bon appétit ! » avec « Annuler », qui remet le statut, les
   * articles et les dates des plats comme avant (seulement si la liste n'a pas été rouverte entre-temps) ;
   * `silencieux: true` : aucune annonce. L'écran ouvre d'abord la feuille « Courses terminées ? » s'il reste quelque
   * chose à acheter (coeur/liste.js › restesFinDesCourses).
   * → { code: 'ok', gardes (articles créés pour la prochaine fois) } | { code: 'chargement' | 'invalide' (aucune semaine
   *   montrée) | 'deja' (courses déjà terminées) | 'echec' (lot impossible à construire : annoncé) | 'refuse' }.
   */
  terminerCourses({ garder = true, silencieux = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineCourante();
    if (!semaine) return { code: 'invalide' };
    const uid = etat.utilisateur.uid;
    const preparation = preparerFinDesCourses(semaine, {
      liste: listeCourante(),
      articles: etat.articles,
      tousLesPlats: etat.plats,
      profils: etat.profils,
      evaluer: compat,
      reglages: etat.donnees.reglages ?? null,
      garder: Boolean(garder),
      auteur: etat.utilisateur.email,
      aujourdhui: dateDuJour(),
      maintenant: Date.now(),
    });
    if (preparation.code) return preparation;
    if (!ecrireFinDesCourses(preparation.lot, 'La fin des courses n’a pas pu être enregistrée. Réessayez.')) {
      return { code: 'echec' };
    }
    ecrireDates(preparation.derniereFois);
    rendre();
    if (!silencieux) {
      annoncer(TEXTES_FIN_DES_COURSES.annonce, {
        action: { libelle: 'Annuler', faire: () => annulerFinDesCourses(preparation, uid) },
      });
    }
    return { code: 'ok', gardes: preparation.gardes };
  },
  /**
   * « Rouvrir la liste » (Courses, après « Courses terminées » ; les deux membres) : le statut d'avant revient (une
   * semaine `validee` redevient `validee`, jamais plus loin), et les articles gardés pour la prochaine fois par ces
   * courses repartent : pas encore cochés, leurs lignes reviennent à acheter ; cochés depuis (achetés), leurs lignes
   * reviennent cochées (coeur/liste.js › ecrituresRouvrirListe). La date des plats reste. Hors ligne : part plus tard.
   * Annonce « La liste est rouverte. ».
   * → { code: 'ok' } | { code: 'chargement' | 'invalide' | 'statut' (courses pas terminées) | 'echec' | 'refuse' }.
   */
  rouvrirListe() {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineCourante();
    if (!semaine) return { code: 'invalide' };
    const ecritures = ecrituresRouvrirListe(semaine, { articles: etat.articles, liste: listeCourante(), maintenant: Date.now() });
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'La liste n’a pas pu être rouverte. Réessayez.')) return { code: 'echec' };
    rendre();
    annoncer(TEXTES_FIN_DES_COURSES.rouverte);
    return { code: 'ok' };
  },

  // ——— Placard, habituels et rayons (T3d, les deux membres, aperçu compris) ———
  // Comme en T3a et T3b : chaque geste part par un lot (hors ligne : plus tard ; aucune transaction, rien ne doit être
  // refusé en magasin), appliqué tout de suite sur ce téléphone, puis l'écran est redessiné. Les réglages d'un produit
  // (`produits/{id}` : rayon, placard, habituel) s'écrivent par `set` + `mergeFields` du seul champ, sous le produit de la
  // ligne, et s'effacent sous chacune de ses clés de repli qui en porte un (comme une coche et le mot cherché) ; ils
  // servent les semaines suivantes. Rien n'est écrit à l'ouverture d'une feuille. Un échec est annoncé ; sinon aucune
  // annonce : l'action rend `message` quand un texte du plan existe, que la feuille annonce après s'être fermée ;
  // `annoncer: true` : l'action l'annonce elle-même.

  /**
   * « Rayon : Épicerie salée · Changer » (feuille ⋮ d'une ligne, d'un produit de « Déjà à la maison ? » ou d'un article ;
   * feuille des 14 rayons) : `cle` (`ligne.cle`, `article:<id>` ou l'identifiant d'un article) ; `rayon`, un des 14
   * (LIBELLES_RAYON). Le rayon de départ de la ligne (`ligne.rayonDeDepart`) efface le réglage du foyer ; un autre rayon
   * est écrit sous son produit (`produits/{id}.rayon`) ; le même rayon : rien n'est écrit. La ligne change de rayon
   * aussitôt, dans les deux modes.
   * → { code: 'ok', rayon, message } (« Rayon : Épicerie salée. Il servira les semaines suivantes. ») | { code:
   *   'chargement' (semaines, articles, plats, profils ou produits pas encore lus) | 'inutile' (clé inconnue de la
   *   liste) | 'invalide' (rayon inconnu) | 'echec' (lot impossible à construire : annoncé) | 'refuse' }.
   */
  changerRayon(cle, rayon, { annoncer: annoncerMessage = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues() || !etat.produitsCharges) return { code: 'chargement' };
    const ligne = ligneDeLaListe(cle);
    if (!ligne) return { code: 'inutile' };
    const resultat = ecrituresRayon(ligne, rayon, { produitsFoyer: produitsFoyerCourants() });
    if (resultat.code) return resultat;
    if (!ecrireLesProduits(resultat.ecritures, 'Le rayon n’a pas pu être enregistré. Réessayez.')) return { code: 'echec' };
    const message = `${texteRayon(resultat.rayon)}. ${TEXTES_T3D.suivantes}`;
    if (annoncerMessage) annoncer(message);
    return { code: 'ok', rayon: resultat.rayon, message };
  },
  /**
   * Interrupteur « Toujours dans mon placard » (feuille ⋮ d'une ligne, d'un produit de « Déjà à la maison ? » ou d'un
   * article ; carte « 🏠 Placard » de Réglages) : `cle`, la clé d'une ligne ou d'un article de la liste, sinon
   * l'identifiant d'un produit (`produitId` de ctx.placardFoyer, qui n'est pas forcément sur la liste) ; `oui` : allumé.
   * Revenir au départ (allumer un produit du placard de départ, éteindre un produit qui n'en est pas) efface le réglage
   * du foyer ; éteindre un produit du placard de départ écrit `produits/{id}.placard { actif: false }` (il revient sur la
   * liste) ; allumer un autre produit écrit `{ actif: true }` (toujours mis de côté ; un produit à seuil garde son seuil
   * de départ) ; rien qui change : rien n'est écrit. Décision du placard du 2026-10-11.
   * → { code: 'ok', actif, message } (allumé : « Toujours mis de côté. » ou « Mis de côté si la semaine en demande 30 g
   *   au plus. », coeur/liste.js › textePlacard ; éteint : null) | { code: 'chargement' | 'inutile' | 'invalide' |
   *   'echec' | 'refuse' }.
   */
  reglerPlacard(cle, oui, { annoncer: annoncerMessage = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!etat.produitsCharges) return { code: 'chargement' };
    const cible = cibleDuProduit(cle, { parIdentifiant: true });
    if (!cible) return { code: semainesLues() ? 'inutile' : 'chargement' };
    const resultat = ecrituresPlacard(cible, oui, { produitsFoyer: produitsFoyerCourants() });
    if (resultat.code) return resultat;
    if (!ecrireLesProduits(resultat.ecritures, 'Ce réglage n’a pas pu être enregistré. Réessayez.')) return { code: 'echec' };
    const placard = ficheProduit(cible.produitId, {
      produitsFoyer: produitsFoyerCourants(), index: indexCourant(), saisie: cible.libelle ?? '', replis: cible.replis ?? [],
    }).placard.valeur;
    const message = resultat.actif ? textePlacard(placard, { produitId: cible.produitId }) || TEXTES_T3D.toujours : null;
    if (annoncerMessage && message) annoncer(message);
    return { code: 'ok', actif: resultat.actif, message };
  },
  /**
   * Interrupteur « À acheter chaque semaine » et sa « Quantité (facultatif) » (feuille ⋮ d'une ligne ou d'un article) :
   * `cle`, la clé de la ligne ou de l'article, sinon l'identifiant de son produit (une ligne qui n'existait que par son
   * habituel part de la liste quand on l'éteint ou qu'on le saute ; la feuille restée ouverte le règle encore) ; `reglage` : { actif,
   * qte (nombre, ou texte tapé : « 0,5 » ; vide : sans quantité), unite (LIBELLES_UNITE, avec une quantité) }. Allumé :
   * `produits/{id}.habituel { actif: true, qte?, unite?, libelle }` (la ligne passe dans « Comme chaque semaine », ou sa
   * quantité s'ajoute à la ligne de la semaine ; jamais mise de côté) ; éteint : `{ actif: false }`, quantité et nom
   * gardés pour le rallumer ; rien qui change : rien n'est écrit. Allumé depuis un article ajouté à la main pas coché :
   * l'article est retiré dans le même lot (il devient l'habituel : jamais deux lignes pour le même produit), et le
   * résultat porte `converti: { article, cle }` (l'article tel qu'il était ; `cle`, celle de la ligne de l'habituel) ;
   * éteint avec `remettre` (cet article), il revient dans le même lot (même identifiant) et le résultat porte `remis` (sa
   * clé `article:<id>`).
   * → { code: 'ok', habituel (la valeur écrite ; null : rien de réglé), converti?, remis? } | { code: 'quantite' | 'grande' | 'unite',
   *   message } (ERREURS_HABITUEL : « Écrivez un nombre plus grand que 0. », « 999 au plus. », « Choisissez une
   *   unité. » ; rien n'est écrit) | { code: 'chargement' | 'inutile' | 'invalide' | 'echec' | 'refuse' }.
   */
  reglerHabituel(cle, { actif = true, qte = null, unite = null, remettre = null } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues() || !etat.produitsCharges) return { code: 'chargement' };
    // Une ligne qui n'existait que par son habituel part de la liste quand on l'éteint : la feuille, restée ouverte,
    // le rallume par l'identifiant de son produit (le nom gardé avec l'habituel éteint le nomme encore).
    const cible = cibleDuProduit(cle, { parIdentifiant: true });
    if (!cible) return { code: 'inutile' };
    const resultat = ecrituresHabituel(cible, { actif: Boolean(actif), qte, unite }, { produitsFoyer: produitsFoyerCourants() });
    if (resultat.erreur) return { code: resultat.erreur, message: ERREURS_HABITUEL[resultat.erreur] ?? null };
    if (resultat.code) return resultat;
    // Allumé depuis un article ajouté à la main pas coché (relecture de T3d) : l'article devient l'habituel, retiré dans
    // le même lot (jamais deux « Lait » sur la liste) ; la feuille garde l'article et le remet si on l'éteint aussitôt
    // (`remettre`, même lot).
    const article = cible.type === 'article' && !cible.cochee && Boolean(actif) && !cible.habituel
      ? etat.articles.find((a) => a?.id === cible.articleId) ?? null : null;
    const aRemettre = !actif && remettre && typeof remettre === 'object' && typeof remettre.id === 'string'
      && !etat.articles.some((a) => a?.id === remettre.id) ? remettre : null;
    const articles = { supprimer: article ? [article.id] : [], remettre: aRemettre ? [aRemettre] : [] };
    if (!ecrireLesProduits(resultat.ecritures, 'Ce réglage n’a pas pu être enregistré. Réessayez.', { articles })) {
      return { code: 'echec' };
    }
    return {
      code: 'ok',
      habituel: resultat.habituel,
      ...(article ? { converti: { article, cle: cible.produitId } } : {}),
      ...(aRemettre ? { remis: `article:${aRemettre.id}` } : {}),
    };
  },
  /**
   * « Pas cette semaine » d'un produit « À acheter chaque semaine » (feuille ⋮ ; les deux membres) : `cle`, l'identifiant
   * du produit (`liste.habituels[].produitId`, un habituel sauté n'ayant plus forcément de ligne) ou la clé de sa
   * ligne ; `oui` : sauté. Écrit `sansHabituel.<produitId>` de la semaine montrée (`update` d'un seul chemin), ou
   * l'efface ; la semaine suivante, il revient de lui-même. Déjà dans l'état voulu : rien n'est écrit.
   * → { code: 'ok' } | { code: 'chargement' | 'invalide' (aucune semaine montrée) | 'inutile' (pas un habituel actif) |
   *   'echec' | 'refuse' }.
   */
  sauterHabituel(cle, oui) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues() || !etat.produitsCharges) return { code: 'chargement' };
    const semaine = semaineCourante();
    if (!semaine) return { code: 'invalide' };
    const liste = listeCourante();
    const produitId = liste.habituels.some((h) => h.produitId === cle) ? cle : ligneDeLaListe(cle)?.produitId;
    const habituel = liste.habituels.find((h) => h.produitId === produitId);
    if (!habituel) return { code: 'inutile' };
    if (habituel.saute === Boolean(oui)) return { code: 'ok' };
    const ecritures = ecrituresSansHabituel(semaine, habituel.produitId, Boolean(oui), { cles: habituel.cles });
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'La liste n’a pas pu être mise à jour. Réessayez.')) return { code: 'echec' };
    rendre();
    return { code: 'ok' };
  },
  /**
   * « Pas cette semaine » d'une préparation de chaque semaine (Semaine, « Chaque semaine aussi : Yaourts maison » ;
   * les deux membres) : `platId` (`liste.preparations[].platId`) ; `oui` : sautée. Écrit `sansHebdo.<platId>` de la
   * semaine montrée (`update` d'un seul chemin), ou l'efface ; la semaine suivante, elle revient d'elle-même. Déjà dans
   * l'état voulu : rien n'est écrit.
   * → { code: 'ok' } | { code: 'chargement' | 'invalide' (aucune semaine montrée) | 'inutile' (pas une préparation de
   *   chaque semaine) | 'echec' | 'refuse' }.
   */
  sauterPreparation(platId, oui) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!semainesLues()) return { code: 'chargement' };
    const semaine = semaineCourante();
    if (!semaine) return { code: 'invalide' };
    const preparation = listeCourante().preparations.find((p) => p.platId === platId);
    if (!preparation) return { code: 'inutile' };
    if (preparation.saute === Boolean(oui)) return { code: 'ok' };
    const ecritures = ecrituresSansHebdo(semaine, platId, Boolean(oui));
    if (ecritures.code) return ecritures;
    if (!ecrireDansLaSemaine(ecritures, 'La semaine n’a pas pu être mise à jour. Réessayez.')) return { code: 'echec' };
    rendre();
    return { code: 'ok' };
  },
  /**
   * « Précision (facultatif) » d'un article ajouté à la main (feuille ⋮ ; les deux membres) : `cle` (`article:<id>` ou
   * son identifiant) ; `saisie` (40 caractères au plus ; vide : effacée). `update` du seul champ `precision` (un article
   * supprimé entre-temps n'est jamais recréé : refus silencieux). Aucune annonce : la ligne montre la précision aussitôt.
   * → { code: 'ok', precision (null : effacée) } | { code: 'inchange' } (rien n'est écrit) | { code: 'long', message }
   *   (ERREURS_PRECISION : « 40 caractères au plus. ») | { code: 'chargement' | 'inutile' | 'invalide' | 'echec' |
   *   'refuse' }.
   */
  changerPrecision(cle, saisie) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!etat.articlesCharges) return { code: 'chargement' };
    const article = listeCourante().articles.find((a) => a.cle === cle || a.articleId === cle);
    if (!article) return { code: 'inutile' };
    const resultat = ecrituresPrecision(article, saisie);
    if (resultat.erreur) return { code: resultat.erreur, message: ERREURS_PRECISION[resultat.erreur] ?? null };
    if (resultat.code) return resultat;
    const echec = `La précision de «\u00A0${article.nom}\u00A0» n’a pas pu être enregistrée. Réessayez.`;
    let envoi;
    try {
      envoi = donnees.modifierArticle(resultat.articleId, resultat.champs);
    } catch {
      annoncer(echec);
      return { code: 'echec' };
    }
    ecrire(envoi, echec);
    etat.articles = etat.articles.map((a) => (a?.id === resultat.articleId ? appliquerChamps(a, resultat.champs) : a));
    rendre();
    const precision = resultat.champs.precision;
    return { code: 'ok', precision: precision === EFFACER ? null : precision };
  },
  /**
   * « Enregistrer » de « Ordre des rayons » (Courses, mode Magasin ; carte de Réglages ; les deux membres) : `ordre`,
   * les rayons dans l'ordre voulu (« ↑ » et « ↓ » : coeur/liste.js › monterRayon, descendreRayon ; « Remettre l’ordre
   * de départ » : RAYONS_DE_DEPART). `update` du seul champ `reglages/foyer.rayons` (la liste entière des 14 : rare ;
   * jamais un `set` du document) ; l'ordre de départ l'efface ; le même ordre : rien n'est écrit. Appliqué tout de
   * suite (ctx.rayons, mode Magasin).
   * → { code: 'ok', rayons (l'ordre des 14), message } (« Ordre des rayons enregistré. ») | { code: 'inchange' } |
   *   { code: 'chargement' (réglages pas encore lus) | 'invalide' | 'echec' | 'refuse' }.
   */
  enregistrerOrdreRayons(ordre, { annoncer: annoncerMessage = false } = {}) {
    if (!etat.utilisateur) return { code: 'refuse' };
    if (!etat.donnees.reglages) return { code: 'chargement' };
    const ecritures = ecrituresRayons(ordre, { reglages: etat.donnees.reglages });
    if (ecritures.code) return ecritures;
    if (!ecrireLesReglages(ecritures.champs, 'L’ordre des rayons n’a pas pu être enregistré. Réessayez.')) {
      return { code: 'echec' };
    }
    rendre();
    const message = 'Ordre des rayons enregistré.';
    if (annoncerMessage) annoncer(message);
    return { code: 'ok', rayons: [...rayonsCourants()], message };
  },
  /**
   * Puces « Récents » de « Ajouter à la liste » : les RECENTS_MAX (8) derniers articles ajoutés sur ce téléphone par ce
   * compte (`localStorage`, clé coeur/liste.js › cleRecents), le plus récent d'abord, un par produit. Un toucher sur une
   * puce l'ajoute par actions.ajouterArticle. Stockage bloqué ou illisible : [] (rien ne casse).
   * → [libellé].
   */
  lireRecents() {
    const cle = cleRecents(etat.utilisateur?.uid);
    if (!cle) return [];
    try {
      return lireRecentsStockes(localStorage.getItem(cle));
    } catch {
      return [];
    }
  },
};

// ——— Semaine et liste de courses (T3a) ———

/** Table simple (ni tableau, ni null). */
function estTable(valeur) {
  return Boolean(valeur) && typeof valeur === 'object' && !Array.isArray(valeur);
}

/** Nom d'un plat pour les annonces, entre guillemets (corbeille comprise) ; « Ce plat » s'il est inconnu. */
function citerPlat(platId) {
  const nom = String(etat.plats.find((plat) => plat?.id === platId)?.nom ?? '').replace(/\s+/g, ' ').trim();
  return nom ? `«\u00A0${nom}\u00A0»` : 'Ce plat';
}

/** Nom d'un article pour les annonces : celui de la liste (majuscule initiale), sinon son libellé. */
function nomArticle(article) {
  const nom = listeCourante().articles.find((a) => a.articleId === article?.id)?.nom;
  if (typeof nom === 'string' && nom) return nom;
  const libelle = String(article?.libelle ?? '').replace(/\s+/g, ' ').trim();
  return libelle ? libelle.charAt(0).toUpperCase() + libelle.slice(1) : 'Cet article';
}

/**
 * Écritures d'une semaine ({ creation?, id, champs, articles? }, préparées par coeur/semaine.js ou coeur/liste.js ;
 * dates changées : { id, champs: { debut, fin } }, actions.changerDates) :
 * envoyées par un lot (donnees.js › ecrireSemaine ; hors ligne : plus tard ; un refus du serveur est annoncé avec
 * `echec`), puis appliquées tout de suite sur ce téléphone (appliquerChamps, pour l'affichage seulement : la copie de
 * Firestore les remplace dès son arrivée). Lot impossible à construire : `echec` annoncé, rien d'appliqué.
 * → vrai si le lot est parti.
 */
function ecrireDansLaSemaine(ecritures, echec) {
  let resultat;
  try {
    resultat = donnees.ecrireSemaine(ecritures);
  } catch {
    annoncer(echec);
    return false;
  }
  ecrire(resultat.envoi, echec);
  const { creation = null, id, champs = {}, articles = [], supprimer = [] } = ecritures;
  const existante = etat.semaines.find((semaine) => semaine?.id === id) ?? null;
  const base = creation ? { ...(existante ?? {}), ...creation.donnees, id } : existante;
  if (base) {
    const maj = { ...appliquerChamps(base, champs), id };
    etat.semaines = existante
      ? etat.semaines.map((semaine) => (semaine === existante ? maj : semaine))
      : [...etat.semaines, maj];
  }
  // Articles écrits (set fusionné : un article déjà là garde sa coche), puis articles emportés.
  const ecrits = new Map((Array.isArray(articles) ? articles : [])
    .map((article, i) => [resultat.articleIds[i], article])
    .filter(([articleId]) => typeof articleId === 'string' && articleId));
  const partis = new Set(Array.isArray(supprimer) ? supprimer : []);
  if (ecrits.size || partis.size) {
    const restants = etat.articles.filter((a) => !partis.has(a?.id))
      .map((a) => (ecrits.has(a?.id) ? { ...a, ...ecrits.get(a.id), id: a.id } : a));
    const neufs = [...ecrits].filter(([articleId]) => !restants.some((a) => a?.id === articleId))
      .map(([articleId, article]) => ({ ...article, id: articleId }));
    etat.articles = [...restants, ...neufs];
  }
  return true;
}

/** Articles de la liste par identifiant (ceux qu'un retrait emporte, pour « Annuler »). */
function articlesParId(ids) {
  const voulus = new Set(Array.isArray(ids) ? ids : []);
  return voulus.size ? etat.articles.filter((a) => voulus.has(a?.id)).map((a) => ({ ...a })) : [];
}

/**
 * « Annuler » de « « Gratin » ajouté à la semaine… » : le plat est retiré de cette même semaine, sans autre annonce ;
 * vidée, une semaine qui commence plus tard emporte les articles des restes venus avec lui (rien ne reste de l'ajout).
 */
function retirerDe(semaineId, platId) {
  if (!etat.utilisateur) return;
  const semaine = semaineParId(semaineId);
  if (!semaine || !estDansLaSemaine(semaine.plats[platId])) return;
  const ecritures = ecrituresRetrait(semaine, platId, { articles: etat.articles, aujourdhui: dateDuJour() });
  if (ecritures.code) return;
  if (ecrireDansLaSemaine(ecritures, `${citerPlat(platId)} n’a pas pu être retiré de la semaine. Réessayez.`)) rendre();
}

/**
 * « Annuler » de « « Gratin » retiré de la semaine. » : le plat revient dans cette semaine, réglages gardés, avec les
 * articles des restes que le retrait avait emportés (`remettre`, mêmes identifiants).
 */
function remettreDans(semaineId, platId, remettre = []) {
  if (!etat.utilisateur) return;
  const semaine = semaineParId(semaineId);
  if (!semaine || estDansLaSemaine(semaine.plats[platId])) return;
  const ecritures = ecrituresRemise(semaine, platId, { maintenant: Date.now(), remettre });
  if (ecritures.code) return;
  if (ecrireDansLaSemaine(ecritures, `${citerPlat(platId)} n’a pas pu être remis dans la semaine. Réessayez.`)) rendre();
}

// ——— Proposer les plats de la semaine (T4-0) ———

/** Durée de l'annonce d'une proposition et de son « Annuler » (D2). */
const DUREE_ANNONCE_PROPOSITION_MS = 30000;

/**
 * Proposition de plats (`type` 'plat', « ✨ ») ou de desserts ('dessert', « 🍰 ») pour une semaine visée, écrite en un
 * lot puis annoncée (actions.proposerALaSemaine, actions.proposerDessertsALaSemaine). `nombre` : plats voulus par le
 * bouton touché (plats : ramené à ce qui manque à la semaine).
 */
function proposerDansLaSemaine(type, {
  cible = null, restes = [], nombre = null, feuille = false, apresAnnulation = null, avant = null,
} = {}) {
  if (!etat.utilisateur) return { code: 'refuse' };
  if (!semainesLues()) return { code: 'chargement' };
  const aujourdhui = dateDuJour();
  const essayer = (choisie) => {
    const visee = cibleProposition(choisie ?? semaineVisee(etat.semaines, aujourdhui));
    if (!visee) return { code: 'invalide' };
    const options = optionsProposition(visee);
    let proposition;
    if (type === 'dessert') {
      const voulu = Number.isInteger(nombre) && nombre > 0 ? nombre : 1;
      proposition = proposerDesserts(etat.plats, { ...options, nombre: voulu });
    } else {
      const { aProposer } = nombreAProposer(etat.semaines, visee, { tousLesPlats: etat.plats, profils: etat.profils, evaluer: compat });
      // Semaine déjà remplie (cases cochées ou lot de l'autre téléphone arrivés depuis l'affichage).
      if (aProposer <= 0) return { code: 'complet' };
      // Visée : ce qui manque à la semaine (le code 'peu' et sa cause disent pourquoi il y en a moins) ; jamais plus
      // que le libellé du bouton.
      const plafond = Number.isInteger(nombre) && nombre > 0 ? Math.min(nombre, aProposer) : null;
      proposition = proposerPlats(etat.plats, { ...options, nombre: aProposer, plafond });
    }
    if (!proposition.ids.length) return { code: 'aucun' };
    const ecritures = ecrituresAjoutGroupe(etat.semaines, proposition.ids, {
      cible: visee,
      semainesChargees: etat.semainesChargees,
      aujourdhui,
      auteur: etat.utilisateur.email,
      maintenant: Date.now(),
      restes,
      tousLesPlats: platsSepares().actifs,
    });
    return { visee, proposition, ecritures };
  };
  let essai = essayer(cible);
  // Cible devenue impossible (dates changées sur l'autre téléphone) : la feuille recalcule elle-même la sienne et le
  // dit ; ailleurs, un essai de plus sur la semaine visée du moment.
  if (essai.ecritures?.code === 'chevauche' && cible && !feuille) essai = essayer(null);
  if (essai.code) return essai;
  const { visee, proposition, ecritures } = essai;
  if (ecritures.code === 'chevauche' && !feuille) annoncer(TEXTES_PROPOSER.erreurs.chevauche);
  if (ecritures.code) return ecritures;
  if (typeof avant === 'function') avant(ecritures.ajoutes[0]?.platId ?? null);
  if (!ecrireDansLaSemaine(ecritures, TEXTES_PROPOSER.erreurs.echec)) return { code: 'echec' };
  const ajoutes = ecritures.ajoutes;
  const entres = new Set(ajoutes.map((a) => a.platId));
  const choisis = proposition.choisis.filter((c) => entres.has(c.platId));
  for (const c of choisis) etat.proposes.set(`${ecritures.id}|${c.platId}`, c.raison);
  rendre();
  const nbRestes = ecritures.articles?.length ?? 0;
  const semaine = semaineParId(ecritures.id);
  const texte = annonceProposition({ ...proposition, choisis, ids: choisis.map((c) => c.platId) }, {
    cible: semaine ?? visee,
    aujourdhui,
    moi: profilDeLEmail(etat.profils, etat.utilisateur.email),
    profils: etat.profils,
    restes: nbRestes,
  });
  const semaineId = ecritures.id;
  annoncer(texte, {
    action: { libelle: 'Annuler', faire: () => actions.annulerProposition(semaineId, ajoutes, { apresAnnulation }) },
    duree: DUREE_ANNONCE_PROPOSITION_MS,
  });
  return {
    code: proposition.code === 'peu' ? 'peu' : 'ok',
    id: semaineId,
    ajoutes,
    deja: ecritures.deja,
    restes: nbRestes,
    choisis,
  };
}

// ——— Au drive et fin des courses (T3b) ———

/** Ligne ou article de la liste montrée par sa clé (`ligne.cle`, placard compris ; `article:<id>` ou `<id>`), ou null. */
function ligneDeLaListe(cle) {
  if (typeof cle !== 'string' || !cle) return null;
  const liste = listeCourante();
  return [...liste.lignes, ...liste.maison].find((l) => l.cle === cle)
    ?? liste.articles.find((a) => a.cle === cle || a.articleId === cle)
    ?? null;
}

/** Produits du foyer écrits ([{ id, champs }], EFFACER retire le champ) appliqués tout de suite sur ce téléphone. */
function appliquerProduits(ecritures) {
  let produits = etat.produits;
  for (const { id, champs } of ecritures) {
    const existant = produits.find((p) => p?.id === id);
    const maj = { ...appliquerChamps(existant ?? {}, champs), id };
    produits = existant ? produits.map((p) => (p === existant ? maj : p)) : [...produits, maj];
  }
  etat.produits = produits;
}

/**
 * Produit visé par un réglage de la feuille ⋮ (T3d) : la ligne ou l'article de la liste (`cle` : `ligne.cle`, placard
 * compris ; `article:<id>` ou `<id>`), sinon un habituel de la semaine par l'identifiant de son produit (sauté, il n'a
 * plus forcément de ligne : { produitId, libelle, replis }), sinon, avec `parIdentifiant` (carte « 🏠 Placard » de
 * Réglages ; feuille ⋮ restée ouverte sur une ligne partie de la liste), l'identifiant d'un produit (`^[a-z0-9-]+$` :
 * { produitId, libelle: '', replis: [] }). → l'objet lu par coeur/liste.js (ecrituresRayon, ecrituresPlacard,
 * ecrituresHabituel), ou null.
 */
function cibleDuProduit(cle, { parIdentifiant = false } = {}) {
  if (typeof cle !== 'string' || !cle) return null;
  if (semainesLues()) {
    const ligne = ligneDeLaListe(cle);
    if (ligne) return ligne;
    const habituel = listeCourante().habituels.find((h) => h.produitId === cle);
    if (habituel) {
      return {
        produitId: habituel.produitId,
        libelle: habituel.libelle,
        replis: habituel.cle !== habituel.produitId ? [habituel.cle] : [],
      };
    }
  }
  return parIdentifiant && cheminSur(cle) ? { produitId: cle, libelle: '', replis: [] } : null;
}

/**
 * Réglages de produits du foyer ([{ id, champs }], coeur/liste.js : mot cherché, rayon, placard, habituel) : envoyés par
 * un lot (donnees.js › ecrireProduits : `set` + `mergeFields` des seuls champs ; hors ligne : plus tard ; un refus du
 * serveur est annoncé avec `echec`), puis appliqués tout de suite sur ce téléphone et l'écran redessiné. `articles` :
 * { supprimer: [id], remettre: [article] } dans le même lot (« À acheter chaque semaine » d'un article à la main). Rien à
 * écrire : vrai, sans rien envoyer. Lot impossible à construire : `echec` annoncé, rien d'appliqué. → vrai si tout est
 * fait.
 */
function ecrireLesProduits(ecritures, echec, { articles = null } = {}) {
  const produits = Array.isArray(ecritures) ? ecritures : [];
  const supprimer = Array.isArray(articles?.supprimer) ? articles.supprimer : [];
  const remettre = Array.isArray(articles?.remettre) ? articles.remettre : [];
  if (!produits.length && !supprimer.length && !remettre.length) return true;
  let envoi;
  try {
    envoi = donnees.ecrireProduits(produits, { supprimerArticles: supprimer, remettreArticles: remettre });
  } catch {
    annoncer(echec);
    return false;
  }
  ecrire(envoi, echec);
  appliquerProduits(produits);
  if (supprimer.length || remettre.length) {
    const retires = new Set([...supprimer, ...remettre.map((a) => a.id)]);
    etat.articles = [...etat.articles.filter((a) => !retires.has(a?.id)), ...remettre];
  }
  rendre();
  return true;
}

/**
 * Retient `libelle` parmi les récents de « Ajouter à la liste » (T3d) pour ce compte sur ce téléphone (`localStorage`,
 * coeur/liste.js › cleRecents, ajouterAuxRecents : lui d'abord, RECENTS_MAX au plus). Stockage plein ou bloqué : rien
 * (les récents ne sont qu'une commodité).
 */
function noterRecent(libelle) {
  const cle = cleRecents(etat.utilisateur?.uid);
  if (!cle) return;
  try {
    localStorage.setItem(cle, JSON.stringify(ajouterAuxRecents(localStorage.getItem(cle), libelle)));
  } catch {
    // Stockage plein ou bloqué : les récents ne sont pas retenus cette fois.
  }
}

/**
 * Réglages des courses (`drive`, préparés par coeur/drive.js › ecrituresDrive ; T3d : `rayons`, coeur/liste.js ›
 * ecrituresRayons) : envoyés par un lot (donnees.js ›
 * ecrireReglages ; hors ligne : plus tard ; un refus du serveur est annoncé avec `echec`), puis appliqués tout de suite
 * sur ce téléphone. Lot impossible à construire : `echec` annoncé, rien d'appliqué. → vrai si le lot est parti.
 */
function ecrireLesReglages(champs, echec) {
  let envoi;
  try {
    envoi = donnees.ecrireReglages(champs);
  } catch {
    annoncer(echec);
    return false;
  }
  ecrire(envoi, echec);
  if (etat.donnees.reglages) {
    etat.donnees = { ...etat.donnees, reglages: appliquerChamps(etat.donnees.reglages, champs) };
  }
  return true;
}

/**
 * Lot de la fin des courses ({ id, champs, articles, supprimer }, coeur/liste.js › preparerFinDesCourses : `lot`, ou
 * `avant` pour « Annuler ») : envoyé (donnees.js › terminerCourses ; hors ligne : plus tard ; un refus du serveur est
 * annoncé avec `echec`), puis appliqué tout de suite sur ce téléphone : champs de la semaine, articles supprimés, puis
 * articles écrits tels quels (`set` sans fusion). Lot impossible à construire : `echec` annoncé, rien d'appliqué.
 * → vrai si le lot est parti.
 */
function ecrireFinDesCourses(lot, echec) {
  let envoi;
  try {
    envoi = donnees.terminerCourses({ lot });
  } catch {
    annoncer(echec);
    return false;
  }
  ecrire(envoi, echec);
  const { id, champs = {}, articles = [], supprimer = [] } = lot;
  const existante = etat.semaines.find((semaine) => semaine?.id === id) ?? null;
  if (existante && Object.keys(champs).length) {
    const maj = { ...appliquerChamps(existante, champs), id };
    etat.semaines = etat.semaines.map((semaine) => (semaine === existante ? maj : semaine));
  }
  const partis = new Set(supprimer);
  const ecrits = new Map(articles.map((article) => [article.id, article]));
  if (partis.size || ecrits.size) {
    etat.articles = [
      ...etat.articles.filter((a) => !partis.has(a?.id) && !ecrits.has(a?.id)),
      ...[...ecrits.values()].map((article) => ({ ...article })),
    ];
  }
  return true;
}

/**
 * Date des plats de la fin des courses (`derniereFois` de preparerFinDesCourses ; avec `annuler`, la valeur d'avant) :
 * un lot par plat, sans message (donnees.js › ecrireDernieresFois), appliquée tout de suite sur ce téléphone.
 */
function ecrireDates(derniereFois, { annuler = false } = {}) {
  const ecritures = ecrituresDernieresFois(derniereFois, { annuler });
  if (!ecritures.length) return;
  donnees.ecrireDernieresFois(ecritures).catch(() => {});
  const parId = new Map(ecritures.map(({ platId, champs }) => [platId, champs.derniereFois]));
  etat.plats = etat.plats.map((plat) => {
    if (!parId.has(plat?.id)) return plat;
    const valeur = parId.get(plat.id);
    const maj = { ...plat };
    if (valeur === EFFACER) delete maj.derniereFois;
    else maj.derniereFois = valeur;
    return maj;
  });
}

/**
 * « Annuler » de « Courses terminées. Bon appétit ! » : statut, articles et dates des plats remis comme avant
 * (`avant` de preparerFinDesCourses), pour le même compte et seulement si les courses de cette semaine sont toujours
 * terminées (une liste rouverte entre-temps, ici ou sur l'autre téléphone, n'est pas touchée). Sans autre annonce.
 */
function annulerFinDesCourses(preparation, uid) {
  if (etat.utilisateur?.uid !== uid) return;
  const semaine = semaineParId(preparation.avant.id);
  if (!semaine || statutSemaine(semaine) !== 'courses_faites') return;
  if (!ecrireFinDesCourses(preparation.avant, 'Les courses n’ont pas pu être rouvertes. Réessayez.')) return;
  ecrireDates(preparation.derniereFois, { annuler: true });
  rendre();
}

/**
 * Coche (`voulu`) d'un article de la liste (`liste.articles` : { articleId, cochee }) : `articles/{id}.coche`, appliquée
 * tout de suite sur ce téléphone (un article supprimé entre-temps n'est jamais recréé : refus silencieux). Rien n'est
 * écrit s'il est déjà dans l'état voulu. Ne redessine pas. → { code } : ok, invalide, echec.
 */
function cocherArticle(article, voulu, maintenant, echec) {
  if (Boolean(article.cochee) === voulu) return { code: 'ok' };
  const ecritures = ecrituresCocheArticle(article, voulu, { maintenant });
  if (ecritures.code) return ecritures;
  let envoi;
  try {
    envoi = donnees.modifierArticle(ecritures.articleId, ecritures.champs);
  } catch {
    annoncer(echec);
    return { code: 'echec' };
  }
  ecrire(envoi, echec);
  etat.articles = etat.articles.map((a) => (a.id === ecritures.articleId ? appliquerChamps(a, ecritures.champs) : a));
  return { code: 'ok' };
}

/** « Annuler » de « « Piles » retiré de la liste. » : le même document revient (même identifiant). */
function remettreArticle(article) {
  if (!etat.utilisateur || etat.articles.some((a) => a?.id === article.id)) return;
  const echec = `«\u00A0${nomArticle(article)}\u00A0» n’a pas pu être remis dans la liste. Réessayez.`;
  let envoi;
  try {
    envoi = donnees.remettreArticles([article]);
  } catch {
    annoncer(echec);
    return;
  }
  ecrire(envoi, echec);
  etat.articles = [...etat.articles, article];
  rendre();
}

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

/**
 * Vrai quand réglages, plats, profils et produits du foyer (T3b) viennent du serveur (et non de la seule copie du
 * téléphone).
 */
function copieConfirmee() {
  return etat.donnees.statut === 'ok' && !etat.donnees.depuisCache
    && etat.platsCharges && !etat.platsDepuisCache && etat.profilsCharges && !etat.profilsDepuisCache
    && etat.produitsCharges && !etat.produitsDepuisCache;
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
 * Étapes détaillées d'un lot DEMANDE-ETAPES (T5-0b, écritures `mode: 'etapes'`, en ligne seulement : vérifié par
 * l'appelant). Une transaction par plat (donnees.importer › ecrireEtapes) ; les fiches écrites s'affichent dès la fin
 * des transactions (coeur/import-local.js › appliquerImport), sans attendre la copie de Firestore, pour que « Encore
 * N recettes à détailler » soit juste tout de suite. Un plat changé, supprimé ou mis à la corbeille entre-temps n'est
 * pas écrit : « « Gratin » a changé entre-temps : ses étapes n’ont pas été écrites. Il restera à détailler. »
 * → promesse de { ecrites: [id], refuses: [{ id, nom }] } ; rejetée avec `code: 'echec'` (rien n'est affiché d'avance).
 */
function importerEtapes(ecritures) {
  const nomsAvant = new Map(etat.plats.map((plat) => [plat?.id, plat?.nom]));
  const nom = (id) => String(nomsAvant.get(id) ?? id);
  const { etapes } = donnees.importer({ ecritures, demandesAClore: [] }, etat.utilisateur.email);
  const uid = etat.utilisateur.uid;
  return etapes.then(({ ecrites, ...refus }) => {
    const refuses = Object.values(refus).flat().map((id) => ({ id, nom: nom(id) }));
    if (etat.utilisateur?.uid === uid) {
      const faites = new Set(ecrites);
      etat.plats = appliquerImport(etat.plats, ecritures.filter((ecriture) => faites.has(ecriture.id)));
      rendre();
      if (refuses.length) annoncer(refuses.map((plat) => TEXTES_ETAPES.refusEnvoi(plat.nom)).join(' '));
    }
    return { ecrites, refuses };
  }, (erreur) => {
    annoncer('Les étapes n’ont pas pu être enregistrées. Réessayez.');
    throw Object.assign(new Error('Les étapes n’ont pas pu être enregistrées.'), { code: 'echec', cause: erreur });
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
    semaines: [],
    semainesChargees: false,
    semainesDepuisCache: false,
    articles: [],
    articlesCharges: false,
    articlesDepuisCache: false,
    produits: [],
    produitsCharges: false,
    produitsDepuisCache: false,
    apercu: false,
  });
  memoSemaines = { semaines: null, aujourdhui: null, semaine: null, enCours: null };
  memoListe = { cles: null, liste: null };
  memoProduits = { produits: null, parId: Object.freeze({}) };
  memoIndex = { plats: null, index: null };
  memoRayons = { reglages: undefined, rayons: null };
  memoPlacard = { produits: null, plats: null, placard: [] };
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
        if (maj.semaines) etat.semainesChargees = true;
        if (maj.articles) etat.articlesCharges = true;
        if (maj.produits) etat.produitsCharges = true;
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
