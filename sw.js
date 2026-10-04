// Service worker : ouverture hors ligne (CLAUDE.md §3).
// - Fichiers de l'app : servis depuis le cache, puis mis à jour en arrière-plan (nouvelle version à l'ouverture suivante).
// - SDK Firebase (version épinglée) et police : cache d'abord.
// - Firestore et la connexion Google ne passent pas par ici.
// Changer VERSION à chaque mise en ligne qui modifie ce fichier ou ajoute un fichier à la liste.

const VERSION = 't0-1';
const VERSION_SDK = '12.19.0';

const CACHE_APP = `app-${VERSION}`;
const CACHE_EXTERNE = `externe-${VERSION_SDK}`;

const FICHIERS_APP = [
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/firebase.js',
  './js/donnees.js',
  './js/coeur/roles.js',
  './js/ui/dom.js',
  './js/ui/connexion.js',
  './js/ui/profil.js',
  './js/ui/semaine.js',
  './js/ui/courses.js',
  './js/ui/plats.js',
  './js/ui/decouvrir.js',
  './js/ui/reglages.js',
  './icons/icone.svg',
  './icons/icone-192.png',
  './icons/icone-512.png',
  './icons/icone-maskable-512.png',
];

const SDK = ['firebase-app', 'firebase-auth', 'firebase-firestore']
  .map((nom) => `https://www.gstatic.com/firebasejs/${VERSION_SDK}/${nom}.js`);

const URL_POLICE = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,600,100&display=swap';

const URL_INDEX = new URL('./index.html', self.location.href).href;
// Seules les ouvertures de l'accueil de l'app sont servies hors ligne (pas les autres pages du site).
const CHEMINS_ACCUEIL = [new URL('./', self.location.href).pathname, new URL(URL_INDEX).pathname];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await app.addAll(FICHIERS_APP.map((chemin) => new Request(chemin, { cache: 'reload' })));
    const externe = await caches.open(CACHE_EXTERNE);
    await externe.addAll(SDK);
    try {
      await mettreLaPoliceEnCache(externe);
    } catch {
      // La police est un plus : sans elle, l'app utilise la police de secours.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms
      .filter((nom) => nom !== CACHE_APP && nom !== CACHE_EXTERNE)
      .map((nom) => caches.delete(nom)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);

  if (url.origin === self.location.origin) {
    if (requete.mode !== 'navigate') {
      evenement.respondWith(servirPuisMettreAJour(evenement, CACHE_APP, requete));
    } else if (CHEMINS_ACCUEIL.includes(url.pathname)) {
      evenement.respondWith(servirPuisMettreAJour(evenement, CACHE_APP, URL_INDEX));
    }
    return;
  }

  if (url.href.startsWith('https://www.gstatic.com/firebasejs/') || url.origin === 'https://fonts.gstatic.com') {
    evenement.respondWith(cacheDAbord(evenement, CACHE_EXTERNE));
    return;
  }

  if (url.origin === 'https://fonts.googleapis.com') {
    evenement.respondWith(servirPuisMettreAJour(evenement, CACHE_EXTERNE, requete));
  }
});

/** Réponse du cache tout de suite, mise à jour du cache en arrière-plan ; réseau si rien en cache. */
async function servirPuisMettreAJour(evenement, nomCache, cle) {
  const cache = await caches.open(nomCache);
  const enCache = await cache.match(cle);
  const depuisReseau = fetch(evenement.request)
    .then(async (reponse) => {
      if (reponse.ok) await cache.put(cle, reponse.clone());
      return reponse;
    })
    .catch(() => null);

  if (enCache) {
    evenement.waitUntil(depuisReseau);
    return enCache;
  }
  return (await depuisReseau) ?? Response.error();
}

/** Fichiers qui ne changent jamais à une adresse donnée (SDK épinglé, fichiers de police). */
async function cacheDAbord(evenement, nomCache) {
  const cache = await caches.open(nomCache);
  const enCache = await cache.match(evenement.request);
  if (enCache) return enCache;
  const reponse = await fetch(evenement.request);
  if (reponse.ok) evenement.waitUntil(cache.put(evenement.request, reponse.clone()));
  return reponse;
}

/** Feuille de style de la police et ses fichiers, pour que les titres restent beaux hors ligne. */
async function mettreLaPoliceEnCache(cache) {
  const reponse = await fetch(URL_POLICE);
  if (!reponse.ok) return;
  const css = await reponse.clone().text();
  await cache.put(URL_POLICE, reponse);
  const fichiers = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
  await cache.addAll(fichiers);
}
