// Mode clair seul (2026-10-14, demande du propriétaire) : l'app ne suit jamais le thème sombre du téléphone ni de Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = fileURLToPath(new URL('../', import.meta.url));

function lire(chemin) {
  return readFile(path.join(racine, chemin), 'utf8');
}

test('mode clair seul : aucune règle de thème sombre dans les feuilles de style', async () => {
  const fichiers = (await readdir(path.join(racine, 'css'))).filter((nom) => nom.endsWith('.css'));
  assert.ok(fichiers.length > 0);
  for (const nom of fichiers) {
    const css = await lire(`css/${nom}`);
    assert.doesNotMatch(css, /prefers-color-scheme\s*:\s*dark/, `css/${nom} : règle de thème sombre`);
    for (const valeur of css.matchAll(/color-scheme\s*:\s*([^;}]+)/g)) {
      assert.equal(valeur[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), 'light', `css/${nom} : color-scheme « ${valeur[1].trim()} »`);
    }
  }
  const app = await lire('css/app.css');
  assert.match(app, /:root\s*\{[^}]*color-scheme:\s*light\s*;/, 'css/app.css : color-scheme: light attendu sur :root');
});

test('mode clair seul : index.html annonce le seul thème clair, une seule couleur de barre', async () => {
  const html = await lire('index.html');
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
  const couleurs = [...html.matchAll(/<meta name="theme-color" content="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(couleurs, ['#FBF7F1']);
  const manifeste = JSON.parse(await lire('manifest.webmanifest'));
  assert.equal(manifeste.theme_color, '#FBF7F1');
  assert.equal(manifeste.background_color, '#FBF7F1');
});

test('mode clair seul : aucun script ne lit le thème du téléphone', async () => {
  const entrees = await readdir(path.join(racine, 'js'), { recursive: true, withFileTypes: true });
  for (const entree of entrees.filter((e) => e.isFile() && e.name.endsWith('.js'))) {
    const relatif = path.relative(racine, path.join(entree.parentPath ?? entree.path, entree.name));
    const source = await readFile(path.join(racine, relatif), 'utf8');
    assert.doesNotMatch(source, /prefers-color-scheme/, `${relatif} : lit le thème du téléphone`);
  }
});
