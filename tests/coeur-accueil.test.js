// T6-0 « Accueil » : présentation de première ouverture (coeur/accueil.js). Quand elle s'ouvre toute seule, marque
// « déjà vu » du téléphone, écrans figés selon la reliure, titres et textes. Fixtures génériques (aucune donnée du foyer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  VERSION_ACCUEIL, OUVERTURES_MAX, PREFIXE_ACCUEIL, cleAccueil, lireMarque, valeurVu, valeurOuverture, accueilAuto,
  etatBienvenue, ecransAccueil, titreBienvenue, titreRelier, TEXTES_ACCUEIL, texteAdressePrise,
} from '../js/coeur/accueil.js';

const GESTIONNAIRE = 'adulte-a@exemple.fr';
const ADULTE_A = { id: 'profil-a', nom: 'Adulte A', ordre: 1, coefPortion: 1, email: GESTIONNAIRE };
const ADULTE_B = { id: 'profil-b', nom: 'Adulte B', ordre: 2, coefPortion: 1 };
const ENFANT = { id: 'enfant', nom: 'Enfant', ordre: 3, coefPortion: 0.5 };
const FOYER = [ADULTE_A, ADULTE_B, ENFANT];

const NON_VUE = { vu: false, ouvertures: 0 };

// ——— Marque du téléphone ———

test('cleAccueil : préfixe de l’app et identifiant du compte ; sans identifiant, null', () => {
  assert.equal(cleAccueil('u1'), 'repas-courses:accueil-vu:u1');
  assert.ok(cleAccueil('u1').startsWith('repas-courses:'));
  assert.equal(PREFIXE_ACCUEIL, 'repas-courses:accueil-vu:');
  assert.equal(cleAccueil(''), null);
  assert.equal(cleAccueil(undefined), null);
  assert.equal(cleAccueil(null), null);
  assert.equal(cleAccueil(42), null);
});

test('lireMarque : absente ou vide → jamais vue', () => {
  assert.deepEqual(lireMarque(null), NON_VUE);
  assert.deepEqual(lireMarque(undefined), NON_VUE);
  assert.deepEqual(lireMarque(''), NON_VUE);
});

test('lireMarque : « 1 » → vue ; « 1:o1 », « 1:o2 » → ouverte une ou deux fois sans geste', () => {
  assert.deepEqual(lireMarque('1'), { vu: true, ouvertures: 0 });
  assert.deepEqual(lireMarque('1:o1'), { vu: false, ouvertures: 1 });
  assert.deepEqual(lireMarque('1:o2'), { vu: false, ouvertures: 2 });
});

test('lireMarque : valeur abîmée → jamais vue', () => {
  for (const brut of ['0', 'abc', '1:ox', '1:o0', '1:', ':o1', ' 1', '1 ', 'vrai', '{}', 1, true]) {
    assert.deepEqual(lireMarque(brut), NON_VUE, String(brut));
  }
});

test('lireMarque : version plus récente → vue ; plus ancienne → jamais vue', () => {
  assert.equal(VERSION_ACCUEIL, 1);
  assert.deepEqual(lireMarque('2'), { vu: true, ouvertures: 0 });
  assert.deepEqual(lireMarque('2:o1'), { vu: true, ouvertures: 0 });
  assert.deepEqual(lireMarque('0:o1'), NON_VUE);
});

test('valeurVu et valeurOuverture : « 1 », puis une ouverture de plus à chaque fois', () => {
  assert.equal(valeurVu(), '1');
  assert.equal(valeurOuverture(lireMarque(null)), '1:o1');
  assert.equal(valeurOuverture(lireMarque('1:o1')), '1:o2');
  assert.equal(valeurOuverture(null), '1:o1');
  // Aller-retour : ce qui est écrit se relit.
  assert.deepEqual(lireMarque(valeurOuverture(lireMarque('1:o1'))), { vu: false, ouvertures: 2 });
  assert.deepEqual(lireMarque(valeurVu()), { vu: true, ouvertures: 0 });
});

// ——— Ouverture automatique ———

test('accueilAuto : rôle « Repas et courses », jamais vue, ouverture ordinaire → elle s’ouvre', () => {
  for (const hash of ['', '#', '#/', '#/semaine', undefined, null]) {
    assert.equal(accueilAuto({ roleReel: 'courses', marque: NON_VUE, hash }), true, String(hash));
  }
});

test('accueilAuto : un lien vers un autre écran s’ouvre tel quel', () => {
  for (const hash of ['#/plat/gratin', '#/courses', '#/decouvrir', '#/accueil/x', '#/semaine/x', '#semaine']) {
    assert.equal(accueilAuto({ roleReel: 'courses', marque: NON_VUE, hash }), false, hash);
  }
});

test('accueilAuto : la page rechargée sur la présentation compte comme une ouverture, au plus deux fois', () => {
  // Android libère l'app en arrière-plan ; Chrome la rouvre sur « #/accueil » : l'ouverture est comptée (relecture).
  assert.equal(accueilAuto({ roleReel: 'courses', marque: NON_VUE, hash: '#/accueil' }), true);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: lireMarque('1:o1'), hash: '#/accueil' }), true);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: lireMarque('1:o2'), hash: '#/accueil' }), false);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: lireMarque('1'), hash: '#/accueil' }), false);
  assert.equal(accueilAuto({ roleReel: 'gestionnaire', marque: NON_VUE, hash: '#/accueil' }), false);
});

test('accueilAuto : jamais pour le gestionnaire, ni vue, ni marque illisible, ni après deux ouvertures', () => {
  assert.equal(accueilAuto({ roleReel: 'gestionnaire', marque: NON_VUE, hash: '' }), false);
  assert.equal(accueilAuto({ roleReel: null, marque: NON_VUE, hash: '' }), false);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: lireMarque('1'), hash: '' }), false);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: null, hash: '' }), false);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: undefined, hash: '' }), false);
  assert.equal(OUVERTURES_MAX, 2);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: lireMarque('1:o1'), hash: '' }), true);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: lireMarque('1:o2'), hash: '' }), false);
  assert.equal(accueilAuto({ roleReel: 'courses', marque: { vu: false, ouvertures: 5 }, hash: '' }), false);
  assert.equal(accueilAuto(), false);
});

// ——— Écrans figés selon la reliure ———

test('etatBienvenue : profils pas lus → chargement, aucun écran décidé', () => {
  const etat = etatBienvenue({ roleReel: 'courses', moi: null, profilsCharges: false, confirmes: true });
  assert.equal(etat, 'chargement');
  assert.equal(ecransAccueil(etat), null);
  assert.equal(etatBienvenue(), 'chargement');
});

test('etatBienvenue : copie du téléphone en ligne, attente pas finie → chargement ; hors ligne ou attente finie → décidé', () => {
  // `confirmes` = profils venus du serveur, ou hors ligne, ou attente finie (calculé par l'écran).
  assert.equal(etatBienvenue({ roleReel: 'courses', moi: null, profilsCharges: true, confirmes: false }), 'chargement');
  assert.equal(etatBienvenue({ roleReel: 'courses', moi: ADULTE_B, profilsCharges: true, confirmes: false }), 'chargement');
  assert.equal(etatBienvenue({ roleReel: 'courses', moi: null, profilsCharges: true, confirmes: true }), 'relier');
});

test('etatBienvenue : reconnue → un seul écran, pour les deux rôles', () => {
  for (const roleReel of ['courses', 'gestionnaire']) {
    const etat = etatBienvenue({ roleReel, moi: ADULTE_B, profilsCharges: true, confirmes: true });
    assert.equal(etat, 'reliee');
    assert.deepEqual(ecransAccueil(etat), ['bienvenue']);
  }
});

test('etatBienvenue : gestionnaire non reconnu → aperçu, un seul écran, jamais « C’est moi »', () => {
  const etat = etatBienvenue({ roleReel: 'gestionnaire', moi: null, profilsCharges: true, confirmes: true });
  assert.equal(etat, 'apercu');
  assert.deepEqual(ecransAccueil(etat), ['bienvenue']);
});

test('etatBienvenue : « Repas et courses » non reconnue → « Qui êtes-vous ? » puis « bienvenue »', () => {
  const etat = etatBienvenue({ roleReel: 'courses', moi: null, profilsCharges: true, confirmes: true });
  assert.equal(etat, 'relier');
  assert.deepEqual(ecransAccueil(etat), ['relier', 'bienvenue']);
  assert.equal(ecransAccueil('inconnu'), null);
});

test('écrans figés : reconnue pendant « relier », ou plus reconnue pendant « bienvenue », l’état change mais pas la suite', () => {
  // L'écran décide la suite une fois (ecransAccueil) puis ne relit que l'état, pour les titres.
  const suite = ecransAccueil(etatBienvenue({ roleReel: 'courses', moi: null, profilsCharges: true, confirmes: true }));
  assert.deepEqual(suite, ['relier', 'bienvenue']);
  assert.equal(etatBienvenue({ roleReel: 'courses', moi: ADULTE_B, profilsCharges: true, confirmes: true }), 'reliee');
  // « Ce n'est pas moi » depuis le panneau pendant « bienvenue » : titre neutre.
  assert.equal(titreBienvenue(null), 'Bienvenue dans Repas & Courses');
});

// ——— Titres ———

test('titreBienvenue : « Bienvenue, <Nom> », espaces resserrés ; sans nom, le titre neutre', () => {
  assert.equal(titreBienvenue(ADULTE_B), 'Bienvenue, Adulte B');
  assert.equal(titreBienvenue({ nom: '  Adulte \n  B ' }), 'Bienvenue, Adulte B');
  assert.equal(titreBienvenue(null), 'Bienvenue dans Repas & Courses');
  assert.equal(titreBienvenue({ nom: '   ' }), 'Bienvenue dans Repas & Courses');
  assert.equal(titreBienvenue({}), 'Bienvenue dans Repas & Courses');
});

test('titreRelier : un prénom à proposer → « Qui êtes-vous ? » ; aucun → « Votre prénom n’est pas encore dans l’app »', () => {
  assert.equal(titreRelier(FOYER, { gestionnaire: GESTIONNAIRE }), 'Qui êtes-vous\u202F?');
  // Gestionnaire non relié : son prénom est proposé aussi (comportement existant de « Qui êtes-vous ? »).
  const sansAdresse = [{ ...ADULTE_A, email: undefined }, ENFANT];
  assert.equal(titreRelier(sansAdresse, { gestionnaire: GESTIONNAIRE }), 'Qui êtes-vous\u202F?');
  // Seuls le gestionnaire (relié) et l'enfant : personne à proposer.
  assert.equal(titreRelier([ADULTE_A, ENFANT], { gestionnaire: GESTIONNAIRE }), 'Votre prénom n’est pas encore dans l’app');
  assert.equal(titreRelier([], {}), 'Votre prénom n’est pas encore dans l’app');
  assert.equal(titreRelier(undefined), 'Votre prénom n’est pas encore dans l’app');
});

test('texteAdressePrise : le prénom entre guillemets, sans le mot « profil »', () => {
  assert.equal(texteAdressePrise('Adulte A'), 'Votre adresse est déjà utilisée pour «\u00A0Adulte A\u00A0».');
  assert.equal(texteAdressePrise(' '), TEXTES_ACCUEIL.relierAdressePrise);
  assert.equal(texteAdressePrise(undefined), TEXTES_ACCUEIL.relierAdressePrise);
});

// ——— Textes ———

/** Toutes les chaînes de TEXTES_ACCUEIL (lignes comprises), plus les phrases composées. */
function tousLesTextes() {
  const textes = [];
  const parcourir = (valeur) => {
    if (typeof valeur === 'string') textes.push(valeur);
    else if (Array.isArray(valeur)) valeur.forEach(parcourir);
    else if (valeur && typeof valeur === 'object') Object.values(valeur).forEach(parcourir);
  };
  parcourir(TEXTES_ACCUEIL);
  textes.push(titreBienvenue(ADULTE_B), titreBienvenue(null), texteAdressePrise('Adulte B'));
  return textes;
}

test('TEXTES_ACCUEIL : figés, et les textes exacts de l’écran', () => {
  assert.ok(Object.isFrozen(TEXTES_ACCUEIL));
  assert.ok(Object.isFrozen(TEXTES_ACCUEIL.lignes));
  assert.equal(TEXTES_ACCUEIL.titreChargement, 'Un instant…');
  assert.equal(TEXTES_ACCUEIL.phraseBienvenue, 'Fini la liste de courses à écrire\u00A0: elle se fait toute seule.');
  assert.deepEqual(TEXTES_ACCUEIL.lignes.map((l) => l.nom), ['Semaine', 'Courses', 'Découvrir']);
  assert.equal(TEXTES_ACCUEIL.cestParti, 'C’est parti');
  assert.equal(TEXTES_ACCUEIL.decouvrir, 'Dire ce qui me plaît');
  assert.equal(TEXTES_ACCUEIL.aideDecouvrir, 'Arrêtez quand vous voulez\u00A0: chaque réponse compte.');
  assert.equal(TEXTES_ACCUEIL.reconnue, 'C’est fait\u00A0: l’app vous reconnaît.');
  assert.equal(TEXTES_ACCUEIL.apercu, 'Ici, la personne choisit son prénom.');
});

test('TEXTES_ACCUEIL : aucun mot technique, ni « profil », ni « accueil »', () => {
  const interdits = ['paquet', 'json', 'slug', 'profil', 'accueil', 'dictionnaire', 'catalogue', 'touchers'];
  for (const texte of tousLesTextes()) {
    const bas = texte.toLowerCase();
    for (const mot of interdits) assert.ok(!bas.includes(mot), `« ${mot} » dans « ${texte} »`);
    assert.ok(!/\bIA\b/.test(texte), `« IA » dans « ${texte} »`);
  }
});

test('TEXTES_ACCUEIL : typographie (espaces insécables devant « : », fines devant « ? » et « ! », apostrophe courbe)', () => {
  for (const texte of tousLesTextes()) {
    for (let i = 0; i < texte.length; i += 1) {
      const signe = texte[i];
      if (signe === ':') assert.equal(texte[i - 1], '\u00A0', `« : » dans « ${texte} »`);
      if (signe === '?' || signe === '!') assert.equal(texte[i - 1], '\u202F', `« ${signe} » dans « ${texte} »`);
    }
    assert.ok(!texte.includes('\''), `apostrophe droite dans « ${texte} »`);
    assert.ok(!/ [:?!]/.test(texte), `espace ordinaire devant un signe dans « ${texte} »`);
  }
});

test('TEXTES_ACCUEIL : phrases courtes (70 signes au plus, coupées aux points et aux deux-points)', () => {
  for (const texte of tousLesTextes()) {
    for (const morceau of texte.split(/(?<=[.?!…])\s+|\u00A0:\s+/)) {
      assert.ok(morceau.length <= 70, `${morceau.length} signes : « ${morceau} »`);
    }
  }
});

test('coeur/accueil.js : n’importe que profils.js, ni DOM, ni Firebase, ni stockage du téléphone', async () => {
  const source = await readFile(new URL('../js/coeur/accueil.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['./profils.js']);
  for (const mot of ['document', 'window', 'localStorage', 'firebase', 'navigator']) {
    assert.ok(!new RegExp(`\\b${mot}\\b`).test(source.replace(/^\s*\/\/.*$/gm, '')), mot);
  }
});

test('route « accueil » permise aux deux rôles, sans paramètre', async () => {
  const { routeAutorisee, resoudreRoute, parametreDe } = await import('../js/coeur/roles.js');
  assert.equal(routeAutorisee('accueil', 'courses'), true);
  assert.equal(routeAutorisee('accueil', 'gestionnaire'), true);
  assert.equal(routeAutorisee('accueil', null), false);
  assert.equal(resoudreRoute('#/accueil', 'courses'), 'accueil');
  assert.equal(parametreDe('#/accueil/x', 'accueil'), '');
});
