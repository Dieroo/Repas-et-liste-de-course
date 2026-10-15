// Recette demandée en photos (2026-10-16) : identifiants, nom par défaut, nom libre, texte pour Claude, import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PHOTOS_DEMANDE_MAX, nombrePhotos, idPhotoDemande, idsPhotosDeLaDemande, demandeEnPhotos, nomLibre, nomParDefaut,
  champsDemandePhotos, nomFichierPhoto, nomFichierDemande,
} from '../js/coeur/photos-demande.js';
import { NOM_MAX, demandeDeRecette } from '../js/coeur/plats.js';
import { NOM_A_TROUVER, VERSION_INSTRUCTIONS, texteDemandeRecette } from '../js/coeur/claude.js';
import { validerPaquet, preparerImport, extrairePaquet } from '../js/coeur/paquet.js';
import { PHOTO_RECETTE, PHOTO, tailleStockee } from '../js/coeur/photo.js';
import { lireIdDemande } from '../js/coeur/demandes.js';

const AUTEUR = 'b@example.com';
const ing = (produit, qte, unite, marqueurs = [], extra = {}) => ({ produit, qte, unite, rayon: 'divers', marqueurs, ...extra });
const ATTENTE = { id: 'recette-en-photo-du-16-octobre', nom: 'Recette en photo du 16 octobre' };
const demandePhotos = (platId, extra = {}) => ({
  id: `${platId}__recette`, type: 'recette', platId, creePar: AUTEUR, statut: 'ouverte', photos: 2, nomATrouver: true, ...extra,
});
const recette = (extra = {}) => ({
  id: ATTENTE.id, nom: 'Bruschetta tomate et basilic', type: 'plat', portionsBase: 2, statutRecette: 'brouillon',
  ingredients: [ing('pain de campagne', 4, 'tranche'), ing('tomate', 2, 'pc', ['legume'], { role: 'principal' })],
  etapes: ['Griller le pain.', 'Garnir.'],
  ...extra,
});
const valides = (...plats) => {
  const resultat = validerPaquet([{ format: 'paquet@1', plats }]);
  assert.equal(resultat.valide, true, JSON.stringify(resultat.erreurs.concat(resultat.plats.flatMap((p) => p.erreurs))));
  return resultat.plats.map((p) => p.donnees);
};

// ——— Identifiants et nombre ———

test('nombrePhotos : entier de 1 à 3, sinon 0', () => {
  assert.equal(PHOTOS_DEMANDE_MAX, 3);
  for (const n of [1, 2, 3]) assert.equal(nombrePhotos({ photos: n }), n);
  for (const n of [0, 4, -1, 1.5, '2', null, undefined]) assert.equal(nombrePhotos({ photos: n }), 0, String(n));
  assert.equal(nombrePhotos(null), 0);
});

test('idPhotoDemande et idsPhotosDeLaDemande : <platId>__recette--<rang>, jamais pour une version', () => {
  assert.equal(idPhotoDemande('gratin', 1), 'gratin__recette--1');
  assert.equal(idPhotoDemande('gratin', 4), null);
  assert.equal(idPhotoDemande('gratin', 0), null);
  assert.equal(idPhotoDemande('Gratin', 1), null);
  assert.equal(idPhotoDemande('a/b', 1), null);
  assert.deepEqual(idsPhotosDeLaDemande('gratin__recette'), ['gratin__recette--1', 'gratin__recette--2', 'gratin__recette--3']);
  assert.deepEqual(idsPhotosDeLaDemande('gratin__profil-b'), []);
  assert.deepEqual(idsPhotosDeLaDemande(''), []);
  assert.deepEqual(idsPhotosDeLaDemande(undefined), []);
  // L'identifiant de la demande reste celui d'une demande de recette ordinaire.
  assert.deepEqual(lireIdDemande(demandeDeRecette('gratin', AUTEUR).id), { platId: 'gratin', profilId: null, type: 'recette' });
});

test('demandeEnPhotos : seulement la demande de recette ouverte qui porte des photos', () => {
  const ouverte = demandePhotos('gratin');
  assert.equal(demandeEnPhotos('gratin', [ouverte]), ouverte);
  assert.equal(demandeEnPhotos('gratin', [{ ...ouverte, statut: 'traitee' }]), null);
  assert.equal(demandeEnPhotos('gratin', [{ ...ouverte, photos: undefined }]), null);
  assert.equal(demandeEnPhotos('autre', [ouverte]), null);
  assert.equal(demandeEnPhotos('gratin', undefined), null);
});

test('champsDemandePhotos : photos et nomATrouver, rien sans photo', () => {
  assert.deepEqual(champsDemandePhotos({ photos: 2, nomATrouver: true }), { photos: 2, nomATrouver: true });
  assert.deepEqual(champsDemandePhotos({ photos: 3 }), { photos: 3 });
  assert.deepEqual(champsDemandePhotos({ photos: 5 }), { photos: 3 });
  assert.deepEqual(champsDemandePhotos({ photos: 0, nomATrouver: true }), {});
  assert.deepEqual(champsDemandePhotos(), {});
});

test('nomFichierPhoto : <platId>-photo-<rang>.jpg', () => {
  assert.equal(nomFichierPhoto('gratin', 2), 'gratin-photo-2.jpg');
  assert.equal(nomFichierPhoto('', 1), 'recette-photo-1.jpg');
});

test('nomFichierDemande : <platId>-demande.txt', () => {
  assert.equal(nomFichierDemande('gratin'), 'gratin-demande.txt');
  assert.equal(nomFichierDemande(''), 'recette-demande.txt');
  assert.equal(nomFichierDemande(null), 'recette-demande.txt');
});

// ——— Noms ———

test('nomParDefaut : « Recette en photo du 16 octobre », « 1er », puis (2) si le nom est pris', () => {
  assert.equal(nomParDefaut('2026-10-16'), 'Recette en photo du 16 octobre');
  assert.equal(nomParDefaut('2026-11-01'), 'Recette en photo du 1er novembre');
  assert.equal(nomParDefaut('2026-10-16', [ATTENTE]), 'Recette en photo du 16 octobre (2)');
  assert.equal(nomParDefaut('2026-10-16', [ATTENTE, { id: 'x', nom: 'Recette en photo du 16 octobre (2)' }]), 'Recette en photo du 16 octobre (3)');
  // Un plat de la corbeille garde son nom : on ne le recrée pas.
  assert.equal(nomParDefaut('2026-10-16', [{ ...ATTENTE, corbeille: { le: 1, par: AUTEUR } }]), 'Recette en photo du 16 octobre (2)');
  assert.equal(nomParDefaut('n’importe quoi'), 'Recette en photo');
});

test('nomLibre : le nom s’il est libre, sinon (2), (3)… ; jamais plus long que NOM_MAX', () => {
  assert.equal(nomLibre('Gratin', []), 'Gratin');
  assert.equal(nomLibre('  Gratin   dauphinois ', []), 'Gratin dauphinois');
  assert.equal(nomLibre('Gratin', [{ id: 'gratin', nom: 'gratin' }]), 'Gratin (2)');
  assert.equal(nomLibre('Gratin', [{ id: 'gratin', nom: 'Gratin' }, { id: 'gratin-2', nom: 'Gratin 2' }]), 'Gratin (3)');
  const long = 'A'.repeat(NOM_MAX);
  const libre = nomLibre(long, [{ id: 'a', nom: long }]);
  assert.ok(libre.length <= NOM_MAX && libre.endsWith(' (2)'), libre);
  assert.equal(nomLibre('', []), null);
  assert.equal(nomLibre('!!!', []), null);
});

// ——— Texte pour Claude ———

test('texteDemandeRecette : photos et nom à trouver ; id du plat gardé', () => {
  const texte = texteDemandeRecette(ATTENTE, { demande: demandePhotos(ATTENTE.id) });
  assert.equal(texte, [
    'DEMANDE-RECETTE paquet@1',
    `instructions: ${VERSION_INSTRUCTIONS}`,
    'id: recette-en-photo-du-16-octobre',
    `nom: ${NOM_A_TROUVER}`,
    'photos: 2',
    '(La recette est dans les 2 photos jointes à ce message : lis-la en entier.)',
  ].join('\n'));
  // Recollé par erreur dans « Ajouter des recettes », il reste reconnu comme une demande.
  assert.equal(extrairePaquet(texte).erreur, 'demande');
});

test('texteDemandeRecette : nom donné avec une photo ; sans photo, texte d’avant', () => {
  const plat = { id: 'tarte-de-mamie', nom: 'Tarte de Mamie' };
  const une = texteDemandeRecette(plat, { demande: { ...demandePhotos(plat.id), photos: 1, nomATrouver: undefined } });
  assert.match(une, /\nnom: Tarte de Mamie\nphotos: 1\n\(La recette est dans la photo jointe à ce message : lis-la en entier\.\)$/);
  const avant = texteDemandeRecette(plat);
  assert.equal(texteDemandeRecette(plat, { demande: { ...demandePhotos(plat.id), photos: 0 } }), avant);
  assert.equal(texteDemandeRecette(plat, { demande: null }), avant);
  assert.doesNotMatch(avant, /photos:/);
  assert.match(avant, /\(Ajoute un lien, une photo ou la recette dictée\.\)$/);
});

test('docs : l’exemple de recette en photos est le texte que l’app copie', async () => {
  const doc = await readFile(new URL('../docs/projet-claude.md', import.meta.url), 'utf8');
  const exemple = texteDemandeRecette(ATTENTE, { demande: demandePhotos(ATTENTE.id) });
  assert.ok(doc.includes(`\`\`\`\n${exemple}\n\`\`\``), 'exemple « Recette en photos » différent du texte copié');
  assert.ok(doc.includes('`nom: à trouver dans les photos`'));
});

// ——— Import ———

test('import sur la fiche : le nom lu par Claude remplace le nom d’attente ; la demande se clôt', () => {
  const r = preparerImport(valides(recette()), { plats: [ATTENTE], demandes: [demandePhotos(ATTENTE.id)], cible: ATTENTE.id });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.ecritures.length, 1);
  assert.equal(r.ecritures[0].id, ATTENTE.id);
  assert.equal(r.ecritures[0].donnees.nom, 'Bruschetta tomate et basilic');
  assert.equal(r.elements[0].ancienNom, ATTENTE.nom);
  assert.deepEqual(r.demandesAClore, [`${ATTENTE.id}__recette`]);
});

test('import sur la fiche : nom déjà pris par un autre plat → « Nom (2) », sans erreur', () => {
  const deja = { id: 'bruschetta-tomate-et-basilic', nom: 'Bruschetta tomate et basilic', portionsBase: 2, ingredients: [ing('pain', 1, 'pc')] };
  const r = preparerImport(valides(recette()), { plats: [ATTENTE, deja], demandes: [demandePhotos(ATTENTE.id)], cible: ATTENTE.id });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.ecritures[0].id, ATTENTE.id);
  assert.equal(r.ecritures[0].donnees.nom, 'Bruschetta tomate et basilic (2)');
  assert.ok(r.elements[0].avertissements.some((a) => a.includes('existe déjà') && a.includes('(2)')), r.elements[0].avertissements.join(' | '));
  // Un plat de la corbeille du même nom : même règle (le nom d'attente n'est pas gardé).
  const jete = { ...deja, corbeille: { le: 1, par: AUTEUR } };
  const r2 = preparerImport(valides(recette()), { plats: [ATTENTE, jete], demandes: [demandePhotos(ATTENTE.id)], cible: ATTENTE.id });
  assert.equal(r2.ecritures[0].donnees.nom, 'Bruschetta tomate et basilic (2)');
});

test('non-régression : sans photos, le nom d’un autre plat collé sur une fiche reste une erreur', () => {
  const deja = { id: 'bruschetta-tomate-et-basilic', nom: 'Bruschetta tomate et basilic', portionsBase: 2, ingredients: [ing('pain', 1, 'pc')] };
  const ouverte = { ...demandePhotos(ATTENTE.id), photos: undefined, nomATrouver: undefined };
  const r = preparerImport(valides(recette()), { plats: [ATTENTE, deja], demandes: [ouverte], cible: ATTENTE.id });
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.ecritures.length, 0);
});

test('import dans « Ajouter des recettes » : même identifiant que le plat ⏳ en photos → même règle de nom libre', () => {
  const deja = { id: 'bruschetta-tomate-et-basilic', nom: 'Bruschetta tomate et basilic', portionsBase: 2, ingredients: [ing('pain', 1, 'pc')] };
  const r = preparerImport(valides(recette()), { plats: [ATTENTE, deja], demandes: [demandePhotos(ATTENTE.id)] });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.ecritures[0].id, ATTENTE.id);
  assert.equal(r.ecritures[0].donnees.nom, 'Bruschetta tomate et basilic (2)');
});

// ——— Taille des photos ———

test('photo d’une recette : 1600 px, sous la limite d’un document Firestore (1 Mo), plus grande qu’une photo de fiche', () => {
  assert.equal(PHOTO_RECETTE.cote, 1600);
  assert.ok(PHOTO_RECETTE.cote > PHOTO.cote);
  assert.ok(PHOTO_RECETTE.octetsMax + 1000 < 1_048_576);
  assert.ok(tailleStockee(600_000) < PHOTO_RECETTE.octetsMax);
  assert.ok([...PHOTO_RECETTE.qualites].every((q, i, l) => q > 0 && q <= 1 && (i === 0 || q < l[i - 1])));
});

// ——— Relecture (2026-10-16) ———

test('estNomDAttente et estNomNumerote', async () => {
  const { estNomDAttente, estNomNumerote } = await import('../js/coeur/photos-demande.js');
  assert.equal(estNomDAttente('Recette en photo du 16 octobre'), true);
  assert.equal(estNomDAttente('Recette en photo du 16 octobre (2)'), true);
  assert.equal(estNomDAttente('Recette en photo'), true);
  assert.equal(estNomDAttente('Tarte de Mamie'), false);
  assert.equal(estNomNumerote('Gratin (2)', 'Gratin'), true);
  assert.equal(estNomNumerote('gratin (12)', 'Gratin'), true);
  assert.equal(estNomNumerote('Gratin', 'Gratin'), false);
  assert.equal(estNomNumerote('Gratin (1)', 'Gratin'), false);
  assert.equal(estNomNumerote('Gratin dauphinois (2)', 'Gratin'), false);
  assert.equal(estNomNumerote('Gratin (2)', ''), false);
});

test('texteDemandeRecette : fiche renommée à la main → son nom, plus « à trouver »', () => {
  const texte = texteDemandeRecette({ id: ATTENTE.id, nom: 'Tarte de Mamie' }, { demande: demandePhotos(ATTENTE.id) });
  assert.match(texte, /\nnom: Tarte de Mamie\nphotos: 2\n/);
});

test('import sur la fiche : une réponse pour un autre plat, collée par erreur, reste une erreur', () => {
  const deja = { id: 'gratin', nom: 'Gratin', portionsBase: 2, ingredients: [ing('pain', 1, 'pc')] };
  const autre = recette({ id: 'gratin', nom: 'Gratin' });
  const r = preparerImport(valides(autre), { plats: [ATTENTE, deja], demandes: [demandePhotos(ATTENTE.id)], cible: ATTENTE.id });
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.ecritures.length, 0);
});

test('recollée après l’enregistrement sous « Nom (2) » : même plat, nom gardé, l’autre plat intact', () => {
  const deja = { id: 'bruschetta-tomate-et-basilic', nom: 'Bruschetta tomate et basilic', portionsBase: 2, ingredients: [ing('pain', 1, 'pc')] };
  const enregistree = { ...recette(), nom: 'Bruschetta tomate et basilic (2)' };
  const close = { ...demandePhotos(ATTENTE.id), statut: 'traitee' };
  const changee = recette({ ingredients: [ing('pain de campagne', 6, 'tranche'), ing('tomate', 3, 'pc', ['legume'], { role: 'principal' })] });
  for (const cible of [null, ATTENTE.id]) {
    const r = preparerImport(valides(changee), { plats: [enregistree, deja], demandes: [close], cible });
    assert.deepEqual(r.erreurs, [], String(cible));
    assert.ok(r.ecritures.every((e) => e.id === ATTENTE.id), `${cible} : ${JSON.stringify(r.ecritures.map((e) => e.id))}`);
    assert.ok(r.ecritures.every((e) => e.donnees?.nom === undefined || e.donnees.nom === 'Bruschetta tomate et basilic (2)'), String(cible));
  }
});
