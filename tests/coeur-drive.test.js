// T3b « Au drive » : coeur/drive.js (adresse collée → modèle de recherche, lien de recherche d'un produit, drive lu dans
// les réglages, écriture du drive, textes). Domaines et numéros de magasin fictifs seulement : jamais une enseigne ni
// un magasin réels dans le dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADRESSE_MAX, ECRAN_ALLUME_MINUTES, ERREURS_DRIVE, JETON_RECHERCHE, MODES_COURSES, MOT_ESSAI, MOT_EXEMPLE, RECHERCHE_MAX,
  RETOUR_DRIVE_MINUTES, TEXTES_DRIVE, TEXTE_DRIVE_VALIDE, cleModeCourses, ecranAEteindre, ecrituresDrive, lienDrive,
  lireDrive, lireModeCourses, modeleDrive, retourDuDrive, texteChercher, texteJeCherche, texteMotNote, texteRevenirA,
  texteVotreDrive,
} from '../js/coeur/drive.js';
import { EFFACER } from '../js/coeur/semaine.js';

const DRIVE = 'https://drive.exemple.fr/recherche?text=courgette';
const MODELE = 'https://drive.exemple.fr/recherche?text={q}';

// Aucun mot technique dans un texte affiché ; espaces insécables devant « : ! ? » et dans « ».
function textePropre(texte) {
  assert.equal(typeof texte, 'string');
  assert.doesNotMatch(texte, /undefined|null|NaN|\[object|\{q\}|json|slug/i, texte);
  assert.doesNotMatch(texte, / [:;!?»]|« /, `espace insécable attendue : ${texte}`);
}

test('constantes : « courgette », « beurre », {q}, 500 caractères, mot cherché de 60 caractères', () => {
  assert.equal(MOT_ESSAI, 'courgette');
  assert.equal(MOT_EXEMPLE, 'beurre');
  assert.equal(JETON_RECHERCHE, '{q}');
  assert.equal(ADRESSE_MAX, 500);
  assert.equal(RECHERCHE_MAX, 60);
});

test('modeleDrive : une occurrence → {q} ; nom = le domaine', () => {
  assert.deepEqual(modeleDrive(DRIVE), { modele: MODELE, nom: 'drive.exemple.fr' });
});

test('modeleDrive : formes d’adresse courantes (domaines et numéros fictifs)', () => {
  assert.deepEqual(modeleDrive('https://courses.exemple.fr/recherche?q=courgette'),
    { modele: 'https://courses.exemple.fr/recherche?q={q}', nom: 'courses.exemple.fr' });
  assert.deepEqual(
    modeleDrive('https://fd99-courses.exemple.fr/magasin-999999-999999-Exemple/recherche.aspx?TexteRecherche=courgette'),
    { modele: 'https://fd99-courses.exemple.fr/magasin-999999-999999-Exemple/recherche.aspx?TexteRecherche={q}', nom: 'fd99-courses.exemple.fr' },
  );
  assert.deepEqual(modeleDrive('https://drive.exemple.fr/recherche/courgette'),
    { modele: 'https://drive.exemple.fr/recherche/{q}', nom: 'drive.exemple.fr' });
  // Paramètres annexes gardés tels quels, ancre comprise.
  assert.equal(modeleDrive('https://drive.exemple.fr/r?q=courgette&tri=prix#liste').modele, 'https://drive.exemple.fr/r?q={q}&tri=prix#liste');
});

test('modeleDrive : plusieurs occurrences → toutes remplacées (chemin et paramètre)', () => {
  assert.equal(modeleDrive('https://drive.exemple.fr/recherche/courgette?q=courgette&vu=courgette').modele,
    'https://drive.exemple.fr/recherche/{q}?q={q}&vu={q}');
});

test('modeleDrive : casse ignorée, pluriel accepté, mot encodé entre guillemets, « www. » retiré du nom', () => {
  assert.equal(modeleDrive('https://drive.exemple.fr/r?q=Courgette').modele, 'https://drive.exemple.fr/r?q={q}');
  assert.equal(modeleDrive('https://drive.exemple.fr/r?q=COURGETTES').modele, 'https://drive.exemple.fr/r?q={q}');
  assert.equal(modeleDrive('https://drive.exemple.fr/r?q=%22courgette%22').modele, 'https://drive.exemple.fr/r?q=%22{q}%22');
  assert.equal(modeleDrive('https://www.drive.exemple.fr/r?q=courgette').nom, 'drive.exemple.fr');
  assert.equal(modeleDrive('https://DRIVE.Exemple.FR/r?q=courgette').nom, 'drive.exemple.fr');
});

test('modeleDrive : mot entier seulement, jamais dans le domaine', () => {
  assert.deepEqual(modeleDrive('https://drive.exemple.fr/r?q=courgettesbio'), { erreur: 'absent' });
  assert.deepEqual(modeleDrive('https://drive.exemple.fr/r?q=minicourgette'), { erreur: 'absent' });
  assert.deepEqual(modeleDrive('https://courgette.exemple.fr/r?q=poireau'), { erreur: 'absent' });
  assert.equal(modeleDrive('https://courgette.exemple.fr/r?q=courgette').modele, 'https://courgette.exemple.fr/r?q={q}');
});

test('modeleDrive : espaces autour retirés ; texte collé autour de l’adresse écarté', () => {
  assert.deepEqual(modeleDrive(`  ${DRIVE}\n`), { modele: MODELE, nom: 'drive.exemple.fr' });
  assert.deepEqual(modeleDrive(`Résultats pour courgette\n${DRIVE} (page 1)`), { modele: MODELE, nom: 'drive.exemple.fr' });
});

test('modeleDrive : vide ; http: ; javascript: ; data: ; adresse illisible → erreurs', () => {
  for (const vide of ['', '   ', null, undefined, 42]) assert.deepEqual(modeleDrive(vide), { erreur: 'vide' });
  assert.deepEqual(modeleDrive('http://drive.exemple.fr/r?q=courgette'), { erreur: 'https' });
  assert.deepEqual(modeleDrive('javascript:alert("courgette")'), { erreur: 'https' });
  // Seule l'adresse https:// d'un texte collé est lue : le reste n'entre jamais dans le modèle.
  assert.equal(modeleDrive('JAVASCRIPT:alert(1)//https://drive.exemple.fr/?q=courgette').modele, 'https://drive.exemple.fr/?q={q}');
  assert.deepEqual(modeleDrive('data:text/html,courgette'), { erreur: 'https' });
  assert.deepEqual(modeleDrive('drive.exemple.fr/r?q=courgette'), { erreur: 'https' });
  assert.deepEqual(modeleDrive('https://'), { erreur: 'https' });
  assert.deepEqual(modeleDrive('https://moi:secret@drive.exemple.fr/r?q=courgette'), { erreur: 'https' });
});

test('modeleDrive : mot d’essai absent → « absent » ; trop longue → « longue »', () => {
  assert.deepEqual(modeleDrive('https://drive.exemple.fr/r?q=poireau'), { erreur: 'absent' });
  assert.deepEqual(modeleDrive('https://drive.exemple.fr/'), { erreur: 'absent' });
  const longue = `https://drive.exemple.fr/r?q=courgette&x=${'a'.repeat(ADRESSE_MAX)}`;
  assert.deepEqual(modeleDrive(longue), { erreur: 'longue' });
  const juste = `https://drive.exemple.fr/r?q=courgette&x=`;
  assert.equal(modeleDrive(juste + 'a'.repeat(ADRESSE_MAX - juste.length)).modele.length, ADRESSE_MAX - 'courgette'.length + 3);
  assert.deepEqual(modeleDrive('x'.repeat(10 * ADRESSE_MAX)), { erreur: 'longue' });
});

test('ERREURS_DRIVE et TEXTE_DRIVE_VALIDE : textes exacts, sans mot technique', () => {
  assert.deepEqual(ERREURS_DRIVE, {
    vide: 'Collez l’adresse de la page des résultats.',
    https: 'Cette adresse doit commencer par https://.',
    absent: 'Le mot « courgette » n’est pas dans cette adresse. Cherchez-le sur le site, puis recopiez l’adresse.',
    longue: 'Cette adresse est trop longue : recopiez celle de la page des résultats.',
  });
  assert.equal(TEXTE_DRIVE_VALIDE, '✓ C’est bon : l’app cherchera chaque produit à la place de « courgette ».');
  for (const texte of [...Object.values(ERREURS_DRIVE), TEXTE_DRIVE_VALIDE]) textePropre(texte.replace('https://', 'adresse'));
});

test('lienDrive : terme encodé (accents, espaces)', () => {
  assert.equal(lienDrive(MODELE, 'crème fraîche'), 'https://drive.exemple.fr/recherche?text=cr%C3%A8me%20fra%C3%AEche');
  assert.equal(lienDrive(MODELE, 'pâtes'), 'https://drive.exemple.fr/recherche?text=p%C3%A2tes');
  assert.equal(lienDrive(MODELE, 'œufs'), 'https://drive.exemple.fr/recherche?text=%C5%93ufs');
  assert.equal(lienDrive(MODELE, '4 épices'), 'https://drive.exemple.fr/recherche?text=4%20%C3%A9pices');
  assert.equal(lienDrive(MODELE, '  pâtes   courtes '), 'https://drive.exemple.fr/recherche?text=p%C3%A2tes%20courtes');
});

test('lienDrive : « & », « / », « # », « ? » et « = » encodés : jamais un autre paramètre ni un autre chemin', () => {
  assert.equal(lienDrive(MODELE, 'sel & poivre'), 'https://drive.exemple.fr/recherche?text=sel%20%26%20poivre');
  assert.equal(lienDrive('https://drive.exemple.fr/recherche/{q}', 'farine t55/t65'), 'https://drive.exemple.fr/recherche/farine%20t55%2Ft65');
  assert.equal(lienDrive(MODELE, 'a#b?c=d'), 'https://drive.exemple.fr/recherche?text=a%23b%3Fc%3Dd');
});

test('lienDrive : toutes les places du modèle reçoivent le terme', () => {
  assert.equal(lienDrive('https://drive.exemple.fr/recherche/{q}?q={q}', 'beurre'), 'https://drive.exemple.fr/recherche/beurre?q=beurre');
});

test('lienDrive : jamais javascript:, http: ni data: ; modèle sans {q} ou terme vide → null', () => {
  for (const modele of ['javascript:alert({q})', 'http://drive.exemple.fr/r?q={q}', 'data:text/html,{q}',
    'https://drive.exemple.fr/r?q=courgette', 'https://drive.exemple.fr/r q={q}', '', null, 7, '{q}']) {
    assert.equal(lienDrive(modele, 'beurre'), null, String(modele));
  }
  assert.equal(lienDrive(MODELE, ''), null);
  assert.equal(lienDrive(MODELE, '   '), null);
  assert.equal(lienDrive(MODELE, undefined), null);
  // Un terme ne peut jamais changer de site ni de protocole.
  const lien = lienDrive('https://drive.exemple.fr/{q}', '//autre.exemple.org');
  assert.equal(new URL(lien).hostname, 'drive.exemple.fr');
});

test('aller-retour : l’adresse collée, recherchée avec « courgette », redonne l’adresse collée', () => {
  for (const adresse of [DRIVE, 'https://courses.exemple.fr/recherche?q=courgette',
    'https://fd99-courses.exemple.fr/magasin-999999-999999-Exemple/recherche.aspx?TexteRecherche=courgette']) {
    assert.equal(lienDrive(modeleDrive(adresse).modele, MOT_ESSAI), adresse);
  }
});

test('lireDrive : modèle valide → { nom, urlRecherche } ; nom absent → le domaine ; illisible → null', () => {
  assert.deepEqual(lireDrive({ nom: 'drive.exemple.fr', urlRecherche: MODELE }), { nom: 'drive.exemple.fr', urlRecherche: MODELE });
  assert.deepEqual(lireDrive({ urlRecherche: ` ${MODELE} ` }), { nom: 'drive.exemple.fr', urlRecherche: MODELE });
  assert.deepEqual(lireDrive({ nom: '  ', urlRecherche: MODELE }), { nom: 'drive.exemple.fr', urlRecherche: MODELE });
  for (const illisible of [null, undefined, 'https://drive.exemple.fr', [], {}, { urlRecherche: 'http://drive.exemple.fr/r?q={q}' },
    { urlRecherche: 'javascript:{q}' }, { urlRecherche: 'https://drive.exemple.fr/r?q=courgette' },
    { urlRecherche: `https://drive.exemple.fr/r?q={q}&x=${'a'.repeat(ADRESSE_MAX)}` }]) {
    assert.equal(lireDrive(illisible), null, JSON.stringify(illisible));
  }
});

test('ecrituresDrive : enregistrer, « Ne plus chercher au drive » (EFFACER), remettre l’ancien ; illisible refusé', () => {
  const { modele, nom } = modeleDrive(DRIVE);
  assert.deepEqual(ecrituresDrive({ nom, urlRecherche: modele }), { champs: { drive: { nom: 'drive.exemple.fr', urlRecherche: MODELE } } });
  assert.deepEqual(ecrituresDrive(null), { champs: { drive: EFFACER } });
  assert.deepEqual(ecrituresDrive({ urlRecherche: 'http://drive.exemple.fr/r?q={q}' }), { code: 'invalide' });
  assert.deepEqual(ecrituresDrive(undefined), { code: 'invalide' });
  // Seuls `nom` et `urlRecherche` partent : rien d'autre ne se glisse dans les réglages.
  assert.deepEqual(Object.keys(ecrituresDrive({ nom, urlRecherche: modele, gestionnaire: 'x@exemple.fr' }).champs.drive), ['nom', 'urlRecherche']);
});

test('textes : « Chercher « pâtes courtes » sur drive.exemple.fr », « Votre drive : … », « C’est noté : … »', () => {
  assert.equal(texteChercher('pâtes courtes', 'drive.exemple.fr'), 'Chercher « pâtes courtes » sur drive.exemple.fr');
  assert.equal(texteChercher(' penne ', ''), 'Chercher « penne » au drive');
  assert.equal(texteVotreDrive('drive.exemple.fr'), 'Votre drive : drive.exemple.fr');
  assert.equal(texteMotNote('penne'), 'C’est noté : « penne » servira les prochaines fois.');
  for (const texte of [texteChercher('pâtes courtes', 'drive.exemple.fr'), texteVotreDrive('drive.exemple.fr'), texteMotNote('penne')]) {
    textePropre(texte);
  }
});

test('aucune enseigne ni aucun magasin réels dans drive.js : domaines fictifs seulement', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../js/coeur/drive.js', import.meta.url), 'utf8');
  const domaines = [...source.matchAll(/[a-z0-9-]+\.(?:fr|com|net|org)\b/gi)].map((m) => m[0].toLowerCase());
  for (const domaine of domaines) assert.match(domaine, /exemple\.fr$/, domaine);
});

test('mode de Courses : Drive d’avance, Magasin seulement s’il a été choisi ; clé par compte', () => {
  assert.deepEqual(MODES_COURSES, ['drive', 'magasin']);
  assert.equal(lireModeCourses('magasin'), 'magasin');
  for (const valeur of ['drive', null, undefined, '', 'Magasin', 'autre']) assert.equal(lireModeCourses(valeur), 'drive', String(valeur));
  assert.equal(cleModeCourses('uid-123'), 'repas-courses:mode-courses:uid-123');
  assert.equal(cleModeCourses(''), '');
  assert.equal(cleModeCourses(null), '');
});

test('retour du drive (moins de 15 minutes après 🔍) et écran allumé en magasin (rendu après 10 minutes sans toucher)', () => {
  const M = 60_000;
  assert.deepEqual([RETOUR_DRIVE_MINUTES, ECRAN_ALLUME_MINUTES], [15, 10]);
  assert.equal(retourDuDrive(0, 0), true);
  assert.equal(retourDuDrive(0, 15 * M - 1), true);
  assert.equal(retourDuDrive(0, 15 * M), false);
  assert.equal(retourDuDrive(10, 5), false, 'horloge revenue en arrière');
  assert.equal(retourDuDrive(null, 5), false);
  assert.equal(ecranAEteindre(0, 10 * M - 1), false);
  assert.equal(ecranAEteindre(0, 10 * M), true);
  assert.equal(ecranAEteindre(undefined, 1), true);
});

test('TEXTES_DRIVE et textes de la feuille « Au drive, je cherche » : exacts, sans mot technique', () => {
  assert.deepEqual(TEXTES_DRIVE, {
    drive: '🚗 Drive',
    magasin: '🛒 Magasin',
    aide: 'Touchez 🔍 pour chercher le produit au drive, puis cochez-le.',
    horsLigne: 'Hors ligne : la recherche au drive attend le réseau. Vous pouvez cocher.',
    pourCetteSemaine: 'Pour cette semaine',
    commeChaqueSemaine: 'Comme chaque semaine',
    pasLeBonProduit: 'Pas le bon produit ?',
    changerLeMot: 'Changer le mot cherché',
    aRegler: 'Pour chercher chaque produit au drive d’un toucher, réglez votre drive une fois.',
    regler: 'Régler le drive',
    titre: 'Votre drive',
    etape1: 'Ouvrez le site de votre drive dans Chrome, choisissez votre magasin, puis cherchez « courgette ».',
    etape2: 'Copiez l’adresse de la page des résultats, en haut de Chrome, puis collez-la ici.',
    champ: 'Adresse de la page des résultats',
    coller: '📋 Coller',
    essayer: 'Essayer avec « beurre » ›',
    enregistrer: 'Enregistrer',
    changer: 'Changer',
    arreter: 'Ne plus chercher au drive',
    titreMot: 'Au drive, je cherche',
    aideMot: 'Le mot qui trouve le bon produit sur le site de votre drive : « penne » plutôt que « pâtes courtes ». Il servira les semaines suivantes.',
    serviraSuivantes: 'Il servira les semaines suivantes.',
  });
  assert.equal(texteRevenirA(' pâtes courtes '), 'Revenir à « pâtes courtes »');
  assert.equal(texteJeCherche('pâtes courtes'), 'Au drive, je cherche : « pâtes courtes »');
  for (const texte of [...Object.values(TEXTES_DRIVE), texteRevenirA('pâtes courtes'), texteJeCherche('penne')]) textePropre(texte);
});
