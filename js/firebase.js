// Firebase : configuration, connexion Google, Firestore avec cache hors ligne (CLAUDE.md §3).
// SDK épinglé : changer la version ici, dans donnees.js et dans sw.js en même temps.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Configuration de l'application Web Firebase : publique par nature (CLAUDE.md §13).
const firebaseConfig = {
  apiKey: 'AIzaSyD99deB4XRQV1ubKAHB3IsxYNSQuhwW7WA',
  authDomain: 'repas-et-liste-de-course.firebaseapp.com',
  projectId: 'repas-et-liste-de-course',
  storageBucket: 'repas-et-liste-de-course.firebasestorage.app',
  messagingSenderId: '995727109049',
  appId: '1:995727109049:web:c4e0fa680415341554e468',
};

export const configuree = !Object.values(firebaseConfig).includes('A_REMPLIR');

let auth = null;
let db = null;

if (configuree) {
  const app = initializeApp(firebaseConfig);
  // Pas de getAuth() : sur téléphone, il attendrait le chargement des scripts de connexion Google
  // avant d'annoncer qui est connecté (très lent avec un réseau faible, en magasin).
  // Ces scripts ne sont chargés qu'au moment de se connecter (voir connecter()).
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  auth.languageCode = 'fr';
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

export { db };

export function surChangementUtilisateur(rappel) {
  return onAuthStateChanged(auth, rappel);
}

/**
 * Connexion Google dans une fenêtre. Pas de repli par redirection : sur github.io, Chrome isole le stockage
 * du domaine de connexion Firebase et la redirection revient sans résultat.
 */
export function connecter() {
  const fournisseur = new GoogleAuthProvider();
  fournisseur.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, fournisseur, browserPopupRedirectResolver);
}

export function deconnecter() {
  return signOut(auth);
}

/** Message à afficher pour une erreur de connexion ; null quand la personne a simplement fermé la fenêtre. */
export function messageErreurConnexion(erreur) {
  switch (erreur?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null;
    case 'auth/popup-blocked':
      return 'La fenêtre de connexion n’a pas pu s’ouvrir. Touchez de nouveau le bouton.';
    case 'auth/network-request-failed':
      return 'Pas de réseau pour le moment. Réessayez quand il revient.';
    case 'auth/unauthorized-domain':
      return 'Ce site n’est pas encore autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés).';
    case 'auth/operation-not-allowed':
      return 'La connexion Google n’est pas encore activée dans Firebase (Authentication → Méthode de connexion).';
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    case 'auth/web-storage-unsupported':
      return 'Ce navigateur bloque le stockage nécessaire à la connexion. Ouvrez l’app dans Chrome.';
    default:
      return 'La connexion n’a pas abouti. Réessayez.';
  }
}
