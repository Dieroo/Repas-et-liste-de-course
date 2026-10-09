// Service worker : ouverture hors ligne (CLAUDE.md §3).
// - Fichiers de l'app : cache d'abord. Une nouvelle version arrive d'un seul bloc : quand ce fichier change,
//   le navigateur remplit un nouveau cache complet, puis l'app l'utilise à l'ouverture suivante.
// - VERSION est l'empreinte des fichiers de FICHIERS_APP : `npm test` échoue et donne la bonne valeur
//   dès qu'un de ces fichiers change. Ajouter tout nouveau fichier de l'app à FICHIERS_APP.
// - SDK Firebase (version épinglée) et police : cache d'abord.
// - Firestore et la connexion Google ne passent pas par ici.
// - Le stockage est partagé avec les autres sites du même domaine github.io : tout porte le préfixe de l'app,
//   et le cache est réparé à chaque ouverture en ligne si un autre site l'a effacé.

const PREFIXE = 'repas-courses-';
const VERSION = '3d616f294e2a';
const VERSION_SDK = '12.19.0';
// Date de publication affichée dans le panneau du profil (« Version du … ») : à changer à chaque mise en ligne.
const PUBLIEE = '2026-10-08';

const CACHE_APP = `${PREFIXE}app-${VERSION}`;
const CACHE_EXTERNE = `${PREFIXE}externe-${VERSION_SDK}`;

const FICHIERS_APP = [
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/firebase.js',
  './js/donnees.js',
  './js/coeur/roles.js',
  './js/coeur/slug.js',
  './js/coeur/vocabulaire.js',
  './js/coeur/plats.js',
  './js/coeur/profils.js',
  './js/coeur/photo.js',
  './js/coeur/paquet.js',
  './js/coeur/edition.js',
  './js/coeur/notes.js',
  './js/coeur/sauvegarde.js',
  './js/coeur/compatibilite.js',
  './js/coeur/regles.js',
  './js/coeur/claude.js',
  './js/coeur/import-local.js',
  './js/ui/dom.js',
  './js/ui/feuille.js',
  './js/ui/fichier.js',
  './js/ui/brouillon.js',
  './js/ui/photo.js',
  './js/ui/presse-papiers.js',
  './js/ui/pictos.js',
  './js/ui/compat.js',
  './js/ui/connexion.js',
  './js/ui/relier.js',
  './js/ui/profil.js',
  './js/ui/semaine.js',
  './js/ui/courses.js',
  './js/ui/plats.js',
  './js/ui/notes.js',
  './js/ui/fiche.js',
  './js/ui/modifier.js',
  './js/ui/decouvrir.js',
  './js/ui/reglages.js',
  './js/ui/import.js',
  './js/ui/restaurer.js',
  './js/ui/regime.js',
  './js/ui/envoyes.js',
  './docs/projet-claude.md',
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

// L'app demande la version qui l'a servie, pour l'afficher dans le panneau du profil.
self.addEventListener('message', (evenement) => {
  if (evenement.data?.type !== 'version') return;
  const reponse = { type: 'version', version: VERSION, publiee: PUBLIEE };
  if (evenement.ports?.[0]) evenement.ports[0].postMessage(reponse);
  else evenement.source?.postMessage(reponse);
});

self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    await remplirCacheApp();
    await completerCacheExterne();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms
      .filter((nom) => nom.startsWith(PREFIXE) && nom !== CACHE_APP && nom !== CACHE_EXTERNE)
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
      evenement.respondWith(depuisCacheApp(requete, requete));
    } else if (CHEMINS_ACCUEIL.includes(url.pathname)) {
      evenement.respondWith(depuisCacheApp(requete, URL_INDEX));
      evenement.waitUntil(reparer());
    }
    return;
  }

  if (url.href.startsWith('https://www.gstatic.com/firebasejs/')
    || url.origin === 'https://fonts.gstatic.com'
    || url.origin === 'https://fonts.googleapis.com') {
    evenement.respondWith(cacheDAbord(evenement));
  }
});

/** Fichier de l'app : copie du cache, sinon réseau. */
async function depuisCacheApp(requete, cle) {
  const cache = await caches.open(CACHE_APP);
  return (await cache.match(cle)) ?? fetch(requete);
}

/** Fichiers qui ne changent pas à une adresse donnée (SDK épinglé, police). */
async function cacheDAbord(evenement) {
  const cache = await caches.open(CACHE_EXTERNE);
  const enCache = await cache.match(evenement.request);
  if (enCache) return enCache;
  const reponse = await fetch(evenement.request);
  if (reponse.ok) evenement.waitUntil(cache.put(evenement.request, reponse.clone()));
  return reponse;
}

/** Télécharge tous les fichiers de l'app d'un coup ; en cas d'échec, rien n'est gardé. */
async function remplirCacheApp() {
  const cache = await caches.open(CACHE_APP);
  try {
    await Promise.all(FICHIERS_APP.map(async (chemin) => {
      // « ?v= » contourne le cache du CDN de GitHub Pages : tous les fichiers viennent de la même mise en ligne.
      const reponse = await fetch(`${chemin}?v=${VERSION}`, { cache: 'reload' });
      if (!reponse.ok) throw new Error(`${chemin} : ${reponse.status}`);
      await cache.put(chemin, new Response(reponse.body, reponse));
    }));
  } catch (erreur) {
    await caches.delete(CACHE_APP);
    throw erreur;
  }
}

/** Ajoute ce qui manque : SDK, feuille de police et ses fichiers (la police est facultative). */
async function completerCacheExterne() {
  const cache = await caches.open(CACHE_EXTERNE);
  const manquants = [];
  for (const url of SDK) if (!(await cache.match(url))) manquants.push(url);
  await cache.addAll(manquants);
  try {
    let feuille = await cache.match(URL_POLICE);
    if (!feuille) {
      const reponse = await fetch(URL_POLICE);
      if (!reponse.ok) return;
      await cache.put(URL_POLICE, reponse.clone());
      feuille = reponse;
    }
    const css = await feuille.text();
    const fichiers = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
    for (const url of fichiers) if (!(await cache.match(url))) await cache.add(url);
  } catch {
    // Sans la police, les titres utilisent la police de secours.
  }
}

/** À chaque ouverture en ligne : remet ce qu'un autre site du domaine aurait effacé. */
async function reparer() {
  try {
    const cache = await caches.open(CACHE_APP);
    const presents = await Promise.all(FICHIERS_APP.map((chemin) => cache.match(chemin)));
    if (presents.some((reponse) => !reponse)) await remplirCacheApp();
    await completerCacheExterne();
  } catch {
    // Hors ligne : on réessaiera à la prochaine ouverture.
  }
}
