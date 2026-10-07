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
import { profilDeLEmail, profilsARelier, preparerReliure, preparerDeliure } from './coeur/profils.js';
import { avecNote, cheminNote, noteValide } from './coeur/notes.js';
import { creerSauvegarde, dateDeSauvegarde } from './coeur/sauvegarde.js';
import { evaluer } from './coeur/compatibilite.js';
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
import { telecharger } from './ui/fichier.js';
import { effacerBrouillons } from './ui/brouillon.js';

// Écrans de l'app. `onglet` : onglet surligné ; `sansOnglets` : barre d'onglets masquée (pas de sortie
// accidentelle pendant une saisie). Un module expose creer(ctx) → { noeud, maj?, detruire? } (mis à jour en direct)
// ou afficher(ctx) → nœud (reconstruit seulement si l'écran change).
const ECRANS = {
  semaine: { titre: 'Semaine', module: semaine, onglet: 'semaine' },
  courses: { titre: 'Courses', module: courses, onglet: 'courses' },
  plats: { titre: 'Plats', module: plats, onglet: 'plats' },
  plat: { titre: 'Plat', module: fiche, onglet: 'plats' },
  modifier: { titre: 'Modifier la recette', module: modifier, onglet: 'plats', sansOnglets: true },
  decouvrir: { titre: 'Découvrir', module: decouvrir, onglet: 'decouvrir' },
  reglages: { titre: 'Réglages', module: reglages, onglet: null },
  import: { titre: 'Ajouter des recettes', module: importRecettes, onglet: 'plats' },
  restaurer: { titre: 'Restaurer une sauvegarde', module: restaurer, onglet: null },
  regime: { titre: 'Ce que mange', module: regime, onglet: null, sansOnglets: true },
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
  profilsDepuisCache: false, // copie du téléphone, pas encore confirmée par le serveur
  plats: [],
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

/**
 * Contexte passé aux écrans, et aux feuilles ouvertes hors du rendu (panneau du profil, « Qui êtes-vous ? ») : il
 * est recalculé à chaque appel, pour des profils et des plats à jour.
 * `moi` : profil relié à l'adresse connectée, ou null ; en aperçu « Repas et courses », celui du gestionnaire.
 */
function contexteCourant() {
  const { utilisateur } = etat;
  const { role, roleReel, parametre } = routeCourante();
  return {
    utilisateur,
    role,
    roleReel,
    reglages: etat.donnees.reglages,
    profils: etat.profils,
    profilsCharges: etat.profilsCharges,
    moi: profilDeLEmail(etat.profils, utilisateur.email),
    plats: etat.plats,
    platsCharges: etat.platsCharges,
    demandes: etat.demandes,
    demandesChargees: etat.demandesChargees,
    parametre,
    routePrecedente,
    compat,
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
  /** Recettes préparées par coeur/paquet.js › preparerImport. Affichées tout de suite, envoyées dès que possible. */
  importer({ ecritures, demandesAClore }) {
    ecrire(donnees.importer({ ecritures, demandesAClore }, etat.utilisateur.email),
      'Les recettes n’ont pas pu être enregistrées. Réessayez.');
    const recus = new Map(ecritures.map(({ id, donnees: champs }) => [id, champs]));
    // Recette qui remplace des modifications faites à la main : leur marque disparaît aussi.
    const effacees = new Set(ecritures.filter((ecriture) => ecriture.effacerModification).map(({ id }) => id));
    etat.plats = [
      ...etat.plats.map((plat) => {
        if (!recus.has(plat.id)) return plat;
        const maj = { ...plat, ...recus.get(plat.id) };
        if (effacees.has(plat.id)) {
          delete maj.modifieeLe;
          delete maj.modifieePar;
        }
        return maj;
      }),
      ...ecritures.filter(({ id }) => !etat.plats.some((plat) => plat.id === id)).map(({ donnees: champs }) => champs),
    ];
    cloreDemandes(demandesAClore);
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
};

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
    }
  });
}

demarrer();
