// Garde-fous de la notification ntfy (T2e, CLAUDE.md §7) : la requête reste « simple » (POST, corps texte, aucun
// en-tête posé par l'app, donc pas de pré-vérification CORS), en priorité haute pour Chrome (jamais 'low', que ntfy.sh
// refuserait), et la logique des demandes et de ntfy reste pure (ni DOM, ni réseau, ni Firebase, ni stockage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = fileURLToPath(new URL('../', import.meta.url));

function lire(chemin) {
  return readFile(path.join(racine, chemin), 'utf8');
}

/** Source sans ses commentaires (`//` en fin de ligne, `/* … *\/`) : les gardes ne lisent que le code. */
function sansCommentaires(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('js/notifications.js : un seul fetch, POST en priorité haute, sans en-tête ni cookie', async () => {
  const source = await lire('js/notifications.js');
  const code = sansCommentaires(source);
  assert.equal(code.match(/\bfetch\(/g)?.length, 1);
  assert.match(code, /method:\s*'POST'/);
  assert.match(code, /priority:\s*'high'/);
  assert.doesNotMatch(source, /priority:\s*'low'/);
  assert.doesNotMatch(source, /headers/i);
  assert.match(code, /keepalive:\s*true/);
  assert.match(code, /credentials:\s*'omit'/);
  assert.match(code, /referrerPolicy:\s*'no-referrer'/);
  // Ni Firebase, ni autre module : l'envoi ne connaît que l'adresse et le texte qu'on lui donne.
  assert.doesNotMatch(code, /\bimport\b/);
});

test('envoyerNtfy : options exactes du fetch, issue lue, jamais d’erreur levée', async (t) => {
  const { envoyerNtfy } = await import('../js/notifications.js');
  const avant = globalThis.fetch;
  t.after(() => { globalThis.fetch = avant; });
  const appels = [];
  globalThis.fetch = async (adresse, options) => {
    appels.push({ adresse, options });
    return { ok: true, status: 200 };
  };
  const adresse = 'https://ntfy.sh/repas-abcdefghijkmnpqrstuvwxyz?title=Repas%20%26%20Courses&tags=mailbox_with_mail&priority=4';
  const texte = 'Version à ajouter\u00A0: Gratin du dimanche';
  assert.deepEqual(await envoyerNtfy(adresse, texte), { ok: true, statut: 200 });
  assert.equal(appels.length, 1);
  assert.equal(appels[0].adresse, adresse);
  assert.deepEqual(appels[0].options, {
    method: 'POST',
    body: texte,
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    priority: 'high',
  });
  assert.equal(Object.hasOwn(appels[0].options, 'headers'), false);

  globalThis.fetch = async () => ({ ok: false, status: 429 });
  assert.deepEqual(await envoyerNtfy(adresse, texte), { ok: false, statut: 429 });
  globalThis.fetch = async () => ({ ok: false, status: 400 });
  assert.deepEqual(await envoyerNtfy(adresse, texte), { ok: false, statut: 400 });

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await envoyerNtfy(adresse, texte), { erreur: 'reseau' });
  globalThis.fetch = () => { throw new TypeError('Synchrone'); };
  assert.deepEqual(await envoyerNtfy(adresse, texte), { erreur: 'reseau' });
});

test('coeur/demandes.js et coeur/ntfy.js : ni DOM, ni réseau, ni Firebase, ni stockage', async () => {
  for (const fichier of ['js/coeur/demandes.js', 'js/coeur/ntfy.js']) {
    const code = sansCommentaires(await lire(fichier));
    assert.doesNotMatch(code, /\bdocument\./, fichier);
    assert.doesNotMatch(code, /\bwindow\./, fichier);
    assert.doesNotMatch(code, /\bfetch\b/, fichier);
    assert.doesNotMatch(code, /firebase|gstatic/i, fichier);
    assert.doesNotMatch(code, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, fichier);
    assert.doesNotMatch(code, /\bnavigator\./, fichier);
  }
});

test('l’adresse de ntfy.sh n’est construite que par coeur/ntfy.js', async () => {
  const entrees = await readdir(path.join(racine, 'js'), { recursive: true, withFileTypes: true });
  const fichiers = entrees
    .filter((entree) => entree.isFile() && entree.name.endsWith('.js'))
    .map((entree) => path.relative(racine, path.join(entree.parentPath ?? entree.path, entree.name)).split(path.sep).join('/'));
  assert.ok(fichiers.includes('js/coeur/ntfy.js'));
  for (const fichier of fichiers) {
    if (fichier === 'js/coeur/ntfy.js') continue;
    assert.doesNotMatch(await lire(fichier), /https:\/\/ntfy\.sh/, fichier);
  }
  // L'app n'envoie que par envoyerNtfy, avec l'adresse et le texte de coeur/ntfy.js.
  const app = sansCommentaires(await lire('js/app.js'));
  assert.match(app, /from '\.\/notifications\.js'/);
  for (const appel of app.matchAll(/\bfetch\(([^)]*)\)/g)) assert.match(appel[1], /^'\.\/docs\//, 'fetch inattendu dans app.js');
});

test('fichiers de l’envoi : espaces insécables écrites \\u00A0, jamais telles quelles', async () => {
  for (const fichier of ['js/notifications.js', 'js/app.js', 'js/donnees.js', 'tests/notifications-source.test.js']) {
    assert.doesNotMatch(await lire(fichier), /[\u00A0\u202F]/, fichier);
  }
});
