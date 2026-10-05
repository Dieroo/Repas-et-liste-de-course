// Garde-fous de l'ouverture hors ligne : sw.js doit suivre les fichiers de l'app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = fileURLToPath(new URL('../', import.meta.url));

function lire(chemin, encodage = 'utf8') {
  return readFile(path.join(racine, chemin), encodage);
}

/** Fichiers d'un dossier, en chemins relatifs à la racine du dépôt, séparés par « / ». */
async function lister(dossier) {
  const entrees = await readdir(path.join(racine, dossier), { recursive: true, withFileTypes: true });
  return entrees
    .filter((entree) => entree.isFile())
    .map((entree) => path.relative(racine, path.join(entree.parentPath ?? entree.path, entree.name)).split(path.sep).join('/'));
}

function constante(sw, nom) {
  return sw.match(new RegExp(`const ${nom} = '([^']+)'`))?.[1];
}

function cheminsPrecache(sw) {
  const liste = sw.match(/const FICHIERS_APP = \[([\s\S]*?)\];/);
  assert.ok(liste, 'FICHIERS_APP introuvable dans sw.js');
  return [...liste[1].matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
}

test('chaque fichier de l’app est dans la liste de précache de sw.js', async () => {
  const precache = new Set(cheminsPrecache(await lire('sw.js')));
  const fichiers = [
    'index.html',
    'manifest.webmanifest',
    ...(await lister('css')),
    ...(await lister('js')),
    ...(await lister('icons')),
  ];
  for (const fichier of fichiers) {
    assert.ok(precache.has(fichier), `${fichier} manque dans FICHIERS_APP (sw.js)`);
  }
});

test('la liste de précache ne cite que des fichiers qui existent', async () => {
  for (const chemin of cheminsPrecache(await lire('sw.js'))) {
    await assert.doesNotReject(access(path.join(racine, chemin)), `${chemin} n’existe pas`);
  }
});

test('VERSION de sw.js est l’empreinte des fichiers de l’app (sinon les téléphones gardent l’ancienne version)', async () => {
  const sw = await lire('sw.js');
  const empreinte = createHash('sha256');
  for (const chemin of cheminsPrecache(sw)) {
    empreinte.update(`${chemin}\0`);
    empreinte.update(await lire(chemin, null));
    empreinte.update('\0');
  }
  const attendue = empreinte.digest('hex').slice(0, 12);
  assert.equal(constante(sw, 'VERSION'), attendue,
    `Les fichiers de l’app ont changé : dans sw.js, mettre const VERSION = '${attendue}';`);
});

test('les caches portent le préfixe de l’app et seuls les siens sont purgés', async () => {
  const sw = await lire('sw.js');
  assert.equal(constante(sw, 'PREFIXE'), 'repas-courses-');
  assert.match(sw, /const CACHE_APP = `\$\{PREFIXE\}/);
  assert.match(sw, /const CACHE_EXTERNE = `\$\{PREFIXE\}/);
  assert.match(sw, /nom\.startsWith\(PREFIXE\) && nom !== CACHE_APP && nom !== CACHE_EXTERNE/);
});

test('le SDK Firebase importé par le code est celui mis en cache', async () => {
  const sw = await lire('sw.js');
  const version = constante(sw, 'VERSION_SDK');
  assert.ok(version, 'VERSION_SDK introuvable dans sw.js');
  const noms = sw.match(/const SDK = \[([^\]]+)\]/)?.[1].match(/'([^']+)'/g).map((n) => n.slice(1, -1));

  const imports = new Set();
  for (const fichier of await lister('js')) {
    for (const m of (await lire(fichier)).matchAll(/https:\/\/www\.gstatic\.com\/firebasejs\/([^/]+)\/([a-z-]+)\.js/g)) {
      assert.equal(m[1], version, `${fichier} importe le SDK ${m[1]} au lieu de ${version}`);
      imports.add(m[2]);
    }
  }
  assert.ok(imports.size > 0);
  for (const nom of imports) assert.ok(noms.includes(nom), `${nom} manque dans SDK (sw.js)`);
});

test('la police de la page est celle mise en cache', async () => {
  const page = await lire('index.html');
  const sw = await lire('sw.js');
  const police = page.match(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/)?.[1];
  assert.ok(police, 'feuille de police introuvable dans index.html');
  assert.equal(constante(sw, 'URL_POLICE'), police.replace(/&amp;/g, '&'), 'URL_POLICE de sw.js différente de index.html');
});

test('le manifest est valide et ses icônes existent', async () => {
  const manifest = JSON.parse(await lire('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  // Sans « id », l'identifiant de l'app est start_url (/<dépôt>/) : propre à l'app sur un domaine github.io partagé.
  assert.equal(manifest.id, undefined);
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icone of manifest.icons) {
    await assert.doesNotReject(access(path.join(racine, icone.src)), `${icone.src} n’existe pas`);
  }
});

test('les règles Firestore du dépôt ne contiennent pas de vraie adresse', async () => {
  const regles = await lire('firestore.rules');
  assert.ok(regles.includes('<EMAIL_1>') && regles.includes('<EMAIL_2>'));
  assert.doesNotMatch(regles, /[\w.+-]+@[\w-]+\.[\w.]+/);
});
