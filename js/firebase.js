// Firebase : configuration, connexion Google, Firestore avec cache hors ligne (CLAUDE.md §3).
// SDK épinglé : changer la version ici, dans donnees.js et dans sw.js en même temps.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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
  apiKey: 'A_REMPLIR',
  authDomain: 'A_REMPLIR',
  projectId: 'A_REMPLIR',
  storageBucket: 'A_REMPLIR',
  messagingSenderId: 'A_REMPLIR',
  appId: 'A_REMPLIR',
};

export const configuree = !Object.values(firebaseConfig).includes('A_REMPLIR');

let auth = null;
let db = null;

if (configuree) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'fr';
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

export { db };

export function surChangementUtilisateur(rappel) {
  return onAuthStateChanged(auth, rappel);
}

/** Connexion Google : fenêtre de connexion, repli sur redirection si elle est bloquée. */
export async function connecter() {
  const fournisseur = new GoogleAuthProvider();
  fournisseur.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, fournisseur);
  } catch (erreur) {
    if (erreur?.code === 'auth/popup-blocked' || erreur?.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, fournisseur);
      return;
    }
    throw erreur;
  }
}

/** Résultat d'une connexion par redirection, au retour sur l'app (null s'il n'y en a pas). */
export function retourDeRedirection() {
  return getRedirectResult(auth);
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
