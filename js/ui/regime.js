// Écran « Ce que <Prénom> mange » (#/regime/<profilId>, gestionnaire) : trois choix (« Mange de tout », « Pas de
// viande », « Ni viande ni poisson ») et les précisions « Mange quand même ». Une phrase en direct dit combien de
// plats conviennent. Rien n'est écrit avant « Enregistrer », et rien du tout si le choix n'a pas changé. Les règles
// que l'écran ne sait pas représenter (venues d'une sauvegarde) restent telles quelles (coeur/regles.js).
//
// Pour un enfant (portion d'enfant, date de naissance ou précautions d'âge), l'écran devient « 🧸 Ce que <Enfant>
// mange » et s'ouvre sur « 🧸 Selon son âge » (T2c, coeur/age.js) : date de naissance, une ligne par précaution avec
// son interrupteur, bilan des plats repérés. Règle d'or : plus prudent tout de suite, moins prudent seulement par un
// toucher. Le brouillon est toujours recalculé depuis les règles **enregistrées** (reglesSelonAge), jamais depuis le
// brouillon précédent ; une date effacée ne retire aucune précaution. Date et règles s'enregistrent ensemble, par une
// transaction en ligne (actions.enregistrerPrecautions) ; hors ligne, rien n'est écrit et le brouillon reste.
// Aucune écriture à l'ouverture de l'écran.
import { el, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { texteSeverite } from './compat.js';
import { REGIMES, PRECISIONS, lireRegime, ecrireRegime } from '../coeur/regles.js';
import { bilanCompatibilite } from '../coeur/compatibilite.js';
import { estEnfant } from '../coeur/profils.js';
import {
  ageEnMois, basculerPrecaution, bilanPrecautions, estRegleAge, lireAge, reglesSelonAge, texteAge, texteReste,
  validerNaissance,
} from '../coeur/age.js';

const ORDRE_REGIMES = ['tout', 'sans_viande', 'sans_viande_ni_poisson'];

const nomDe = (profil) => String(profil?.nom ?? '').replace(/\s+/g, ' ').trim() || 'ce profil';

const TEXTE_HORS_LIGNE = 'Il faut être connecté pour enregistrer ses précautions.';

// Erreurs de la date de naissance (coeur/age.js › validerNaissance ; « incomplete » : date à moitié saisie).
const ERREURS_DATE = {
  incomplete: 'Cette date n’est pas complète.',
  format: 'Cette date n’est pas complète.',
  futur: 'Cette date est dans le futur.',
  ancienne: 'Cette date semble trop ancienne pour un enfant.',
};

/** Vrai pour un profil qui a l'écran « 🧸 Ce que <Enfant> mange » : portion d'enfant, date de naissance ou règles d'âge. */
export function avecEcranAge(profil) {
  return estEnfant(profil)
    || (typeof profil?.naissance === 'string' && profil.naissance !== '')
    || (Array.isArray(profil?.regles) && profil.regles.some(estRegleAge));
}

/** Date du téléphone 'AAAA-MM-JJ', au fuseau du téléphone : `ctx.aujourdhui` (app.js), sinon calculée ici. */
export function aujourdhuiDe(ctx) {
  if (typeof ctx?.aujourdhui === 'string' && ctx.aujourdhui) return ctx.aujourdhui;
  const maintenant = new Date();
  const deux = (n) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
}

/** Texte stable d'une valeur (clés des tables triées) : deux états égaux donnent le même texte. */
function texteStable(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map((v) => (v === undefined ? 'null' : texteStable(v))).join(',')}]`;
  if (valeur && typeof valeur === 'object') {
    const cles = Object.keys(valeur).filter((cle) => valeur[cle] !== undefined).sort();
    return `{${cles.map((cle) => `${JSON.stringify(cle)}:${texteStable(valeur[cle])}`).join(',')}}`;
  }
  return JSON.stringify(valeur === undefined ? null : valeur);
}

/** Choix comparable : les précisions ne comptent pas pour « Mange de tout ». */
function cleDuChoix({ regime, precisions }) {
  return regime === 'tout' ? 'tout' : `${regime}|${[...precisions].sort().join(',')}`;
}

/** Règles d'âge d'une liste de règles. */
const reglesAge = (regles) => (Array.isArray(regles) ? regles : []).filter(estRegleAge);

/** État comparable de l'écran : choix du régime, date de naissance, règles d'âge. */
function cleEtat(choix, naissance, regles) {
  return texteStable({ choix: cleDuChoix(choix), naissance: naissance || '', age: reglesAge(regles) });
}

/** « 18 plats conviennent à X, 4 ont sa version, 23 en attendent une. » (accordé) */
function phraseBilan({ convient = 0, avecVersion = 0, aCreer = 0 }, nom) {
  const convientTexte = convient > 1 ? `${convient}\u00A0plats conviennent à ${nom}` : `${convient}\u00A0plat convient à ${nom}`;
  const versionTexte = avecVersion > 1 ? `${avecVersion} ont sa version` : `${avecVersion} a sa version`;
  const attenteTexte = aCreer > 1 ? `${aCreer} en attendent une` : `${aCreer} en attend une`;
  return `${convientTexte}, ${versionTexte}, ${attenteTexte}.`;
}

/**
 * « 3 plats repérés comme pas encore pour X. 2 demandent une précaution. » ; « Aucun plat repéré pour l’instant. »
 * (sans le 🧸, posé à part). `exclus` : plats avec une précaution « Pas avant… » ; `attention` : plats avec seulement
 * des précautions « Déconseillé… ».
 */
function phraseBilanAge({ exclus = 0, attention = 0 }, nom) {
  let texte = 'Aucun plat repéré pour l’instant.';
  if (exclus > 1) texte = `${exclus}\u00A0plats repérés comme pas encore pour ${nom}.`;
  else if (exclus === 1) texte = `1\u00A0plat repéré comme pas encore pour ${nom}.`;
  else if (attention > 1) return `${attention}\u00A0plats demandent une précaution pour ${nom}.`;
  else if (attention === 1) return `1\u00A0plat demande une précaution pour ${nom}.`;
  if (exclus > 0 && attention > 1) texte += ` ${attention}\u00A0demandent une précaution.`;
  else if (exclus > 0 && attention === 1) texte += ' 1\u00A0demande une précaution.';
  return texte;
}

/** Libellé d'une précaution d'un code inconnu de cette version de l'app (« graines germees » → « Graines germees »). */
function libelleInconnu(code) {
  const texte = String(code ?? '').replace(/_/g, ' ').trim();
  return texte ? texte.charAt(0).toLocaleUpperCase('fr-FR') + texte.slice(1) : 'Précaution';
}

/**
 * Deuxième ligne d'une précaution : « Pas avant 5 ans · encore 8 mois », « Déconseillé avant 15 ans · encore 11 ans »,
 * « Pas avant 3 ans · désactivée », « Pas avant 5 ans · âge atteint, à revoir bientôt » ; sans date : « Pas avant 5 ans ».
 */
function texteEtatPrecaution({ regle, etat, resteMois }) {
  const base = texteSeverite(regle?.severite, regle?.age?.jusquAMois);
  if (etat === 'desactivee') return `${base}\u00A0· désactivée`;
  if (etat === 'gardee') return `${base}\u00A0· gardée`;
  if (etat === 'passee') return `${base}\u00A0· âge atteint, à revoir bientôt`;
  if (Number.isFinite(resteMois) && resteMois > 0) return `${base}\u00A0· ${texteReste(resteMois)}`;
  return base;
}

/** Code d'une règle d'âge (`age.code`). */
const codeDe = (regle) => String(regle?.age?.code ?? '');

/**
 * Choix non enregistrés d'un écran quitté sans « Annuler » ni « Enregistrer » (lien de l'en-tête, aperçu…), par
 * compte et par profil : l'écran rouvert les reprend. Gardés le temps que l'app reste ouverte.
 */
const brouillons = new Map();

export function creer(ctx) {
  const id = ctx.parametre;
  let courant = ctx;
  let detruit = false;
  let termine = false; // enregistré ou quitté : plus de mise à jour
  let enCours = false; // précautions envoyées, réponse attendue (transaction en ligne)
  // Lu à l'ouverture (ou à « Voir les nouveaux ») : { empreinte, choix, autres, regles, naissance, avecAge,
  // cleEnregistree, cleInitiale, ajoutees, durcies }. `cleInitiale` : l'écran tel qu'il s'ouvre (précautions à ajouter
  // pour son âge comprises), pour savoir si la personne a changé quelque chose.
  let ouverture = null;
  let choix = null; // { regime, precisions: Set } en cours
  let naissance = ''; // date du champ, 'AAAA-MM-JJ' ('' : vide, ou à moitié saisie)
  let incomplete = false; // date à moitié saisie (validity.badInput)
  let erreurMontree = false; // l'erreur de date s'affiche après la sortie du champ ou « Enregistrer », puis en direct
  let bascules = new Map(); // code → actif : interrupteurs touchés dans le brouillon
  let messageEnvoi = ''; // hors ligne, échec : affiché au-dessus de « Enregistrer »
  let conflit = false;
  let garde = false; // entrée d'historique ajoutée pour intercepter le retour d'Android
  let feuilleOuverte = null;
  let repris = false; // choix repris d'un brouillon
  let lignes = new Map(); // code → ligne de précaution affichée
  let cleLignes = '';
  let cleTitre = '';
  const cleBrouillon = `${ctx.utilisateur?.uid ?? ''}|${id}`;
  const hashEcran = `#/regime/${encodeURIComponent(id)}`;

  const profilCourant = () => (courant.profils ?? []).find((profil) => profil.id === id);
  const aujourdhui = () => aujourdhuiDe(courant);
  const modeAge = () => Boolean(ouverture?.avecAge) || avecEcranAge(profilCourant());
  // Écran d'origine encore dans l'historique : Réglages, ou la fiche d'un plat (« Ses précautions › »).
  const vientDeLaFiche = () => courant.routePrecedente === 'plat' && history.length > 1;
  const vientDesReglages = () => courant.routePrecedente === 'reglages' && history.length > 1;

  /** Empreinte de ce que l'écran enregistre (`regles` et `naissance`), comparée pour repérer un changement venu d'ailleurs. */
  function empreinteDe(profil) {
    if (typeof courant.empreintePrecautions === 'function') return courant.empreintePrecautions(profil);
    return JSON.stringify({ regles: profil?.regles ?? null, naissance: profil?.naissance ?? null });
  }

  // ——— Structure permanente : construite une fois, mise à jour en place (le focus reste) ———

  const titre = el('h1', {}, 'Ce que mange');
  const intro = el('p', { class: 'sous-titre' });
  const messageChargement = el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…');
  const messageAbsent = el('div', { class: 'carte etat-vide compact', hidden: true },
    el('p', {}, 'Ce profil n’existe plus.'),
    el('a', { class: 'bouton bouton-secondaire', href: '#/reglages' }, 'Voir les réglages'));
  const boutonVoirNouveaux = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: voirNouveaux }, 'Voir les nouveaux');
  const bandeauConflit = el('div', { class: 'bandeau bandeau-alerte bandeau-colonne', hidden: true },
    el('p', {}, el('span', { 'aria-hidden': 'true' }, '⚠️\u00A0'), 'Ces réglages ont changé sur l’autre appareil.'),
    boutonVoirNouveaux);
  const bandeauRepris = el('div', { class: 'bandeau', hidden: true },
    el('p', {}, 'Vos changements non enregistrés sont repris.'));
  // « 2 précautions à ajouter ou à renforcer pour son âge : touchez Enregistrer. » (date enregistrée, règles en retard)
  const texteAAjouter = el('span', {});
  const bandeauAAjouter = el('div', { class: 'bandeau bandeau-alerte', hidden: true },
    el('p', {}, el('span', { 'aria-hidden': 'true' }, '🧸\u00A0'), texteAAjouter));
  const messages = el('div', { class: 'modifier-messages', role: 'status' }, bandeauRepris, bandeauConflit, bandeauAAjouter);

  // ——— Section « 🧸 Selon son âge » (enfant) ———

  const champDate = el('input', {
    class: 'champ champ-date',
    id: 'regime-naissance',
    type: 'date',
    autocomplete: 'off',
    'aria-describedby': 'regime-naissance-aide',
    oninput: () => {
      lireChamp();
      changement();
    },
    onchange: surSortieDate,
    onblur: surSortieDate,
  });
  const erreurDate = el('p', { class: 'erreur-champ', id: 'regime-naissance-erreur', role: 'alert', hidden: true });
  const aideDate = el('p', { class: 'aide', id: 'regime-naissance-aide' },
    'Reste dans l’app et dans vos sauvegardes. Jamais envoyée à Claude.');
  const texteSansDate = el('p', {},
    'Indiquez sa date de naissance\u00A0: l’app repérera les plats qui ne sont pas encore pour son âge.');
  const noeudAge = el('p', { class: 'age-texte' });
  const texteRecommandations = el('p', {},
    'D’après les recommandations françaises, avec quelques prudences de l’app. Éteignez celles qui ne vous concernent pas.');
  const texteMedical = el('p', { class: 'aide' },
    'Une aide, pas un avis médical\u00A0: en cas de doute, demandez à son médecin.');
  // Jusqu'à la relecture des recettes par Claude (T2d) : les recettes plus anciennes ne portent pas tous les repères.
  const texteReperes = el('p', { class: 'aide' },
    'Seuls les plats repérés sont signalés\u00A0: les recettes plus anciennes ne le sont pas encore toutes.');
  const listePrecautions = el('ul', { class: 'liste-precautions' });
  const texteBilanAge = el('span', {});
  const bilanAge = el('p', { class: 'bilan-age', role: 'status' },
    el('span', { 'aria-hidden': 'true' }, '🧸\u00A0'), texteBilanAge);
  const titreAge = el('h2', { id: 'regime-age-titre' }, el('span', { 'aria-hidden': 'true' }, '🧸\u00A0'), 'Selon son âge');
  const sectionAge = el('section', { class: 'carte carte-edition section-age-enfant', 'aria-labelledby': titreAge.id, hidden: true },
    titreAge,
    el('label', { class: 'etiquette-champ', for: champDate.id }, 'Date de naissance'),
    champDate,
    erreurDate,
    aideDate,
    texteSansDate,
    noeudAge,
    texteRecommandations,
    texteMedical,
    texteReperes,
    listePrecautions,
    bilanAge);

  // ——— Régime ———

  const legende = el('legend', { class: 'visuellement-masque' });
  const cartes = ORDRE_REGIMES.map((cle) => {
    const { libelle, emoji, aide } = REGIMES[cle] ?? { libelle: cle, emoji: '' };
    const input = el('input', {
      type: 'radio',
      name: 'regime',
      value: cle,
      onchange: () => {
        if (!input.checked || !choix) return;
        choix.regime = cle;
        changement();
      },
    });
    return {
      cle,
      input,
      noeud: el('label', { class: 'choix-carte' },
        input,
        el('span', { class: 'choix-carte-emoji', 'aria-hidden': 'true' }, emoji),
        el('span', { class: 'choix-carte-texte' },
          el('span', { class: 'choix-carte-libelle' }, libelle),
          aide ? el('span', { class: 'choix-carte-aide' }, aide) : null),
        el('span', { class: 'choix-carte-coche', 'aria-hidden': 'true' }, '✓')),
    };
  });
  const groupeRegime = el('fieldset', { class: 'groupe-choix choix-cartes', role: 'radiogroup' },
    legende, cartes.map((carte) => carte.noeud));

  const cases = PRECISIONS.map((precision) => {
    const input = el('input', {
      type: 'checkbox',
      value: precision.id,
      onchange: () => {
        if (!choix) return;
        if (input.checked) choix.precisions.add(precision.id);
        else choix.precisions.delete(precision.id);
        changement();
      },
    });
    return {
      id: precision.id,
      input,
      noeud: el('label', { class: 'case-precision' }, input, el('span', {}, precision.libelle)),
    };
  });
  const groupePrecisions = el('section', { class: 'carte carte-edition', hidden: true },
    el('fieldset', { class: 'groupe-choix' },
      el('legend', { class: 'etiquette-champ' }, 'Mange quand même\u00A0:'),
      cases.map((c) => c.noeud)),
    el('p', { class: 'aide' }, 'Œufs, fromages et miel\u00A0: toujours permis.'));

  const phrase = el('p', { class: 'bilan-regime', role: 'status' });
  const phraseOrphelines = el('p', { class: 'aide', hidden: true });
  const phraseAutres = el('p', { class: 'aide', hidden: true });
  const blocBilan = el('section', { class: 'carte bilan-carte' }, phrase, phraseOrphelines, phraseAutres);

  const boutonAnnuler = el('button', { class: 'bouton bouton-texte bouton-annuler', type: 'button', onclick: quitter }, 'Annuler');
  const formulaire = el('div', { class: 'modifier-formulaire', hidden: true },
    sectionAge, groupeRegime, groupePrecisions, blocBilan, boutonAnnuler);

  const boutonEnregistrer = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    disabled: true,
    onclick: enregistrer,
  }, 'Enregistrer');
  // « Il faut être connecté pour enregistrer ses précautions. », ou un échec : au-dessus du bouton, lu aussitôt.
  const messageBarre = el('p', { class: 'message-barre', role: 'alert', hidden: true });
  const barre = el('div', { class: 'barre-enregistrer', hidden: true },
    el('div', { class: 'barre-enregistrer-contenu' }, messageBarre, boutonEnregistrer));

  // « ‹ Réglages », ou « ‹ Retour » vers la fiche du plat d'où l'on vient.
  const texteRetour = el('span', { class: 'retour-texte' }, vientDeLaFiche() ? 'Retour' : 'Réglages');
  const retour = el('a', {
    class: 'retour',
    href: '#/reglages',
    onclick: (evenement) => {
      evenement.preventDefault();
      quitter();
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), texteRetour);

  // ——— État ———

  function initialiser(profil) {
    const lu = lireRegime(profil.regles);
    const regime = ORDRE_REGIMES.includes(lu.regime) ? lu.regime : 'tout';
    const precisions = new Set(lu.precisions ?? []);
    const regles = Array.isArray(profil.regles) ? profil.regles : [];
    const date = typeof profil.naissance === 'string' ? profil.naissance : '';
    const choixOuverture = { regime, precisions: new Set(precisions) };
    // Plus prudent tout de suite : ce que la date enregistrée demande de plus que les règles enregistrées.
    const selon = reglesSelonAge(date || null, aujourdhuiDe(courant), regles);
    ouverture = {
      empreinte: empreinteDe(profil),
      choix: choixOuverture,
      autres: lu.autres ?? [],
      regles,
      naissance: date,
      avecAge: avecEcranAge(profil),
      cleEnregistree: cleEtat(choixOuverture, date, regles),
      cleInitiale: cleEtat(choixOuverture, date, selon.regles),
      ajoutees: selon.ajoutees?.length ?? 0,
      durcies: selon.durcies?.length ?? 0,
    };
    choix = { regime, precisions };
    naissance = date;
    incomplete = false;
    erreurMontree = false;
    bascules = new Map();
    messageEnvoi = '';
    conflit = false;
    repris = false;
    remplirChamps();
  }

  /** Reprend le choix laissé à la dernière visite ; l'ouverture d'alors sert à repérer un changement venu d'ailleurs. */
  function reprendre(brouillon) {
    ouverture = brouillon.ouverture;
    choix = { regime: brouillon.choix.regime, precisions: new Set(brouillon.choix.precisions) };
    naissance = typeof brouillon.naissance === 'string' ? brouillon.naissance : ouverture.naissance;
    incomplete = false;
    erreurMontree = false;
    bascules = new Map(brouillon.bascules ?? []);
    messageEnvoi = '';
    conflit = false;
    repris = true;
    remplirChamps();
  }

  function remplirChamps() {
    for (const carte of cartes) carte.input.checked = carte.cle === choix.regime;
    for (const c of cases) c.input.checked = choix.precisions.has(c.id);
    if (champDate.value !== naissance) champDate.value = naissance;
  }

  /** Date lue dans le champ : un champ vidé et une date à moitié saisie rendent tous deux '' ; badInput les distingue. */
  function lireChamp() {
    naissance = champDate.value || '';
    incomplete = !champDate.value && Boolean(champDate.validity?.badInput);
  }

  /** Sortie du champ (ou date choisie dans le calendrier) : l'erreur éventuelle s'affiche. */
  function surSortieDate() {
    lireChamp();
    if (ouverture && dateBrouillon().erreur) erreurMontree = true;
    changement();
  }

  /**
   * Date du brouillon → { naissance: 'AAAA-MM-JJ' | null, erreur: null | 'incomplete' | 'format' | 'futur' |
   * 'ancienne' }. La date enregistrée n'est jamais refusée (un enfant devenu grand garde la sienne).
   */
  function dateBrouillon() {
    if (incomplete) return { naissance: null, erreur: 'incomplete' };
    if (!naissance) return { naissance: null, erreur: null };
    if (naissance === ouverture?.naissance) return { naissance, erreur: null };
    const lue = validerNaissance(naissance, aujourdhui());
    return lue.erreur ? { naissance: null, erreur: lue.erreur } : { naissance: lue.naissance, erreur: null };
  }

  /**
   * Règles du brouillon côté âge : les règles enregistrées, rendues plus prudentes pour la date du brouillon (jamais
   * moins ; sans date valide, rien n'est ajouté ni retiré), puis les interrupteurs touchés.
   */
  function reglesAgeBrouillon(date = dateBrouillon().naissance) {
    let regles = reglesSelonAge(date || null, aujourdhui(), ouverture.regles).regles;
    for (const [code, actif] of bascules) regles = basculerPrecaution(regles, code, actif);
    return regles;
  }

  /** Règles qu'écrirait « Enregistrer » maintenant (liste entière : régime, précautions d'âge, règles gardées). */
  function reglesEnCours() {
    if (!modeAge()) return ecrireRegime({ regime: choix.regime, precisions: new Set(choix.precisions) }, ouverture.autres);
    const lu = lireRegime(reglesAgeBrouillon());
    return ecrireRegime({ regime: choix.regime, precisions: new Set(choix.precisions), position: lu.position }, lu.autres);
  }

  /** État du brouillon, comparable à `ouverture.cleEnregistree` et `ouverture.cleInitiale`. */
  function cleBrouillonCourant() {
    const regles = modeAge() ? reglesAgeBrouillon() : ouverture.regles;
    return cleEtat(choix, incomplete ? '\u0000incomplete' : naissance, regles);
  }

  /** Quelque chose diffère de ce qui est enregistré (précautions à ajouter pour son âge comprises) : « Enregistrer ». */
  const aChange = () => Boolean(choix && ouverture) && cleBrouillonCourant() !== ouverture.cleEnregistree;
  /** La personne a changé quelque chose depuis l'ouverture : on demande avant de quitter, le brouillon est gardé. */
  const modifie = () => Boolean(choix && ouverture) && cleBrouillonCourant() !== ouverture.cleInitiale;

  function changement() {
    if (termine || !ouverture) return;
    messageEnvoi = '';
    if (modifie()) poserGarde();
    majFormulaire();
  }

  // ——— Affichage ———

  /** Une ligne de précaution : interrupteur dans un label qui couvre toute la ligne (48 px au moins). */
  function construireLigne(code) {
    const base = `regime-age-${code}`;
    const libelle = el('span', { class: 'precaution-libelle', id: `${base}-libelle` });
    const etat = el('span', { class: 'precaution-etat', id: `${base}-etat` });
    const aide = el('span', { class: 'precaution-aide', id: `${base}-aide` });
    const conseil = el('span', { class: 'precaution-aide precaution-conseil', id: `${base}-conseil` });
    const input = el('input', {
      class: 'interrupteur',
      type: 'checkbox',
      role: 'switch',
      'aria-labelledby': libelle.id,
      'data-code': code,
      onchange: () => {
        if (!ouverture) return;
        bascules.set(code, input.checked);
        changement();
      },
    });
    const noeud = el('li', {},
      el('label', { class: 'ligne-precaution' },
        el('span', { class: 'precaution-texte' }, libelle, etat, aide, conseil),
        input));
    return { code, noeud, input, libelle, etat, aide, conseil };
  }

  function majLigne(ligne, { regle, entree, etat, resteMois }) {
    const libelle = entree?.libelle ?? libelleInconnu(codeDe(regle));
    const aide = typeof entree?.aide === 'string' ? entree.aide : '';
    const conseil = regle.severite === 'adaptable' && typeof regle.consigne === 'string' ? regle.consigne.trim() : '';
    const texteEtat = texteEtatPrecaution({ regle, etat, resteMois });
    if (ligne.libelle.textContent !== libelle) ligne.libelle.textContent = libelle;
    if (ligne.etat.textContent !== texteEtat) ligne.etat.textContent = texteEtat;
    if (ligne.aide.textContent !== aide) ligne.aide.textContent = aide;
    if (ligne.conseil.textContent !== conseil) ligne.conseil.textContent = conseil;
    ligne.aide.hidden = !aide;
    ligne.conseil.hidden = !conseil;
    // Seuls les textes affichés décrivent l'interrupteur (TalkBack : « Miel, interrupteur, activé, Pas avant 1 an… »).
    ligne.input.setAttribute('aria-describedby',
      [ligne.etat.id, aide ? ligne.aide.id : null, conseil ? ligne.conseil.id : null].filter(Boolean).join(' '));
    ligne.input.checked = regle.actif !== false;
    ligne.noeud.classList.toggle('precaution-eteinte', regle.actif === false);
  }

  /** Lignes des précautions : reconstruites seulement si la liste des codes change (le focus reste sur l'interrupteur). */
  function majLignes(entrees) {
    const cle = entrees.map(({ regle }) => codeDe(regle)).join('|');
    if (cle !== cleLignes) {
      const focusCode = listePrecautions.contains(document.activeElement) ? document.activeElement.dataset.code : null;
      cleLignes = cle;
      const nouvelles = new Map();
      for (const { regle } of entrees) {
        const code = codeDe(regle);
        if (!nouvelles.has(code)) nouvelles.set(code, lignes.get(code) ?? construireLigne(code));
      }
      lignes = nouvelles;
      listePrecautions.replaceChildren(...[...lignes.values()].map((ligne) => ligne.noeud));
      if (focusCode) lignes.get(focusCode)?.input.focus();
    }
    for (const entree of entrees) {
      const ligne = lignes.get(codeDe(entree.regle));
      if (ligne) majLigne(ligne, entree);
    }
    listePrecautions.hidden = !entrees.length;
  }

  function majTitre(profil) {
    const nom = nomDe(profil);
    const enfant = modeAge();
    const cle = `${enfant}|${nom}`;
    if (cle === cleTitre) return;
    cleTitre = cle;
    titre.replaceChildren(...(enfant ? [el('span', { 'aria-hidden': 'true' }, '🧸\u00A0')] : []), `Ce que ${nom} mange`);
    legende.textContent = `Ce que ${nom} mange`;
    intro.textContent = enfant
      ? `L’app s’en sert pour repérer les plats qui ne sont pas encore pour ${nom}.`
      : `L’app s’en sert pour repérer les plats à adapter et demander à Claude une version pour ${nom}.`;
  }

  /** Section « 🧸 Selon son âge » : date, textes, lignes, bilan des plats repérés. */
  function majSectionAge(profil) {
    const enfant = modeAge();
    sectionAge.hidden = !enfant;
    if (!enfant) return;
    const nom = nomDe(profil);
    const jour = aujourdhui();
    if (champDate.max !== jour) champDate.max = jour;
    const { naissance: date, erreur } = dateBrouillon();

    const montrer = Boolean(erreur) && erreurMontree;
    const texteErreur = montrer ? ERREURS_DATE[erreur] ?? ERREURS_DATE.format : '';
    if (erreurDate.textContent !== texteErreur) erreurDate.textContent = texteErreur;
    erreurDate.hidden = !montrer;
    if (montrer) champDate.setAttribute('aria-invalid', 'true');
    else champDate.removeAttribute('aria-invalid');
    champDate.setAttribute('aria-describedby', montrer ? `${erreurDate.id} ${aideDate.id}` : aideDate.id);

    const regles = reglesAgeBrouillon(date);
    const entrees = lireAge(date ? { naissance: date, regles } : { regles }, jour);
    const mois = date ? ageEnMois(date, jour) : null;
    texteSansDate.hidden = Boolean(date) || montrer;
    const phraseAge = mois !== null ? `${nom} a ${texteAge(mois)}.` : '';
    if (noeudAge.textContent !== phraseAge) noeudAge.textContent = phraseAge;
    noeudAge.hidden = !phraseAge;
    const avecLignes = entrees.length > 0;
    texteRecommandations.hidden = !avecLignes;
    texteMedical.hidden = !(avecLignes || date);
    texteReperes.hidden = !avecLignes;
    majLignes(entrees);

    bilanAge.hidden = !avecLignes;
    if (!avecLignes) return;
    let texte = 'Chargement des plats…';
    if (courant.platsCharges) {
      // Plats actifs seulement (jamais la corbeille), tels qu'ils seraient servis selon le brouillon.
      const brouillon = { ...profil, regles: reglesEnCours() };
      if (date) brouillon.naissance = date;
      else delete brouillon.naissance;
      const precautions = typeof courant.precautions === 'function' ? { precautions: courant.precautions } : {};
      texte = phraseBilanAge(bilanPrecautions(courant.plats, brouillon, precautions) ?? {}, nom);
    }
    if (texteBilanAge.textContent !== texte) texteBilanAge.textContent = texte;
  }

  /** « 1 précaution à ajouter pour son âge : touchez Enregistrer. » : date enregistrée, précautions en retard sur elle. */
  function majBandeauAAjouter() {
    const nombre = (ouverture?.ajoutees ?? 0) + (ouverture?.durcies ?? 0);
    const montrer = modeAge() && nombre > 0 && !incomplete && naissance === ouverture.naissance && aChange();
    let texte = '';
    if (montrer && nombre > 1) texte = `${nombre}\u00A0précautions à ajouter ou à renforcer pour son âge\u00A0: touchez Enregistrer.`;
    else if (montrer && ouverture.durcies) texte = '1\u00A0précaution à renforcer pour son âge\u00A0: touchez Enregistrer.';
    else if (montrer) texte = '1\u00A0précaution à ajouter pour son âge\u00A0: touchez Enregistrer.';
    if (texteAAjouter.textContent !== texte) texteAAjouter.textContent = texte;
    bandeauAAjouter.hidden = !texte;
  }

  function majFormulaire() {
    const profil = profilCourant();
    if (!profil || !choix || !ouverture) return;
    const nom = nomDe(profil);
    const enfant = modeAge();
    groupePrecisions.hidden = choix.regime === 'tout';
    majTitre(profil);
    majSectionAge(profil);

    let texte = 'Chargement des plats…';
    let orphelines = 0;
    if (courant.platsCharges) {
      const bilan = bilanCompatibilite(courant.plats, { ...profil, regles: reglesEnCours() }, { profils: courant.profils }) ?? {};
      orphelines = bilan.orphelines ?? 0;
      texte = choix.regime === 'tout' && !(bilan.aCreer > 0)
        ? `Tous les plats conviennent à ${nom}.`
        : phraseBilan(bilan, nom);
    }
    if (phrase.textContent !== texte) phrase.textContent = texte;
    // Enfant : la phrase du régime n'a de sens que pour un régime (« Mange de tout » : la section de l'âge suffit).
    phrase.hidden = enfant && choix.regime === 'tout';
    phraseOrphelines.textContent = orphelines > 1
      ? `${orphelines}\u00A0versions sont rangées sous un autre profil\u00A0: demandez-les de nouveau.`
      : '1\u00A0version est rangée sous un autre profil\u00A0: demandez-la de nouveau.';
    phraseOrphelines.hidden = !(orphelines > 0);
    // Les précautions selon l'âge ont leur section : elles ne comptent pas parmi les règles gardées.
    const autres = ouverture.autres.filter((regle) => !estRegleAge(regle)).length;
    phraseAutres.textContent = autres > 1
      ? `${autres}\u00A0autres règles venues d’une sauvegarde sont gardées.`
      : '1\u00A0autre règle venue d’une sauvegarde est gardée.';
    phraseAutres.hidden = !autres;
    blocBilan.hidden = phrase.hidden && phraseOrphelines.hidden && phraseAutres.hidden;

    bandeauRepris.hidden = !(repris && modifie());
    bandeauConflit.hidden = !conflit;
    majBandeauAAjouter();
    if (messageBarre.textContent !== messageEnvoi) messageBarre.textContent = messageEnvoi;
    messageBarre.hidden = !messageEnvoi;
    boutonEnregistrer.disabled = conflit || enCours || !aChange();
    if (enCours) boutonEnregistrer.setAttribute('aria-busy', 'true');
    else boutonEnregistrer.removeAttribute('aria-busy');
  }

  /** Mise à jour en direct : jamais le choix en cours ; un changement venu d'ailleurs est repris s'il n'y en a pas. */
  function majEtat() {
    if (detruit || termine) return;
    const profil = profilCourant();
    const etat = !courant.profilsCharges ? 'chargement' : profil ? 'pret' : 'absent';
    messageChargement.hidden = etat !== 'chargement';
    messageAbsent.hidden = etat !== 'absent';
    formulaire.hidden = etat !== 'pret';
    barre.hidden = etat !== 'pret';
    if (etat === 'absent') feuilleOuverte?.fermer();
    if (etat !== 'pret') return;

    if (!ouverture) {
      const brouillon = brouillons.get(cleBrouillon);
      if (brouillon) reprendre(brouillon);
      else initialiser(profil);
    }
    // Pendant l'envoi, la copie locale reçoit notre propre écriture : ce n'est pas un changement venu d'ailleurs.
    if (!enCours && empreinteDe(profil) !== ouverture.empreinte) {
      if (modifie()) conflit = true;
      else initialiser(profil);
    }
    majFormulaire();
  }

  // ——— Enregistrer, quitter ———

  async function enregistrer() {
    const profil = profilCourant();
    if (termine || enCours || !profil || !choix || !ouverture) return;
    lireChamp();
    if (empreinteDe(profil) !== ouverture.empreinte) {
      conflit = true;
      majFormulaire();
      boutonVoirNouveaux.focus();
      return;
    }
    if (!aChange()) return;
    const nom = nomDe(profil);

    if (!modeAge()) {
      const regles = reglesEnCours();
      termine = true;
      courant.actions.enregistrerRegles(profil.id, regles);
      const bilan = courant.platsCharges ? bilanCompatibilite(courant.plats, { ...profil, regles }) ?? {} : {};
      const attente = bilan.aCreer ?? 0;
      annoncer(attente > 1
        ? `C’est noté. ${attente}\u00A0plats attendent une version pour ${nom}.`
        : attente === 1 ? `C’est noté. 1\u00A0plat attend une version pour ${nom}.` : 'C’est noté.');
      sortir();
      return;
    }

    // Enfant : date et règles ensemble, par une transaction en ligne. Rien n'est écrit si la date est fausse.
    const { naissance: date, erreur } = dateBrouillon();
    if (erreur) {
      erreurMontree = true;
      majFormulaire();
      champDate.focus();
      return;
    }
    const action = courant.actions?.enregistrerPrecautions;
    if (typeof action !== 'function' || !navigator.onLine) {
      messageEnvoi = typeof action === 'function' ? TEXTE_HORS_LIGNE : `Ce que ${nom} mange n’a pas pu être enregistré. Réessayez.`;
      majFormulaire();
      return;
    }
    const regles = reglesEnCours();
    enCours = true;
    messageEnvoi = '';
    majFormulaire();
    let resultat;
    try {
      resultat = await action(profil.id, { regles, naissance: date, empreinteOuverture: ouverture.empreinte });
    } catch {
      resultat = { code: 'echec', message: null };
    }
    enCours = false;
    // Réussi : l'app l'annonce (« C’est noté. 3 plats repérés comme pas encore pour <Enfant>. ») ; l'écran se ferme.
    if (resultat?.code === 'ok') {
      termine = true;
      brouillons.delete(cleBrouillon);
      if (!detruit) sortir();
      return;
    }
    if (detruit || termine) return;
    if (resultat?.code === 'conflit') {
      conflit = true;
      majFormulaire();
      boutonVoirNouveaux.focus();
      return;
    }
    if (resultat?.code !== 'refuse' && resultat?.code !== 'absent') {
      messageEnvoi = resultat?.message
        || (resultat?.code === 'hors_ligne' ? TEXTE_HORS_LIGNE : `Ce que ${nom} mange n’a pas pu être enregistré. Réessayez.`);
    }
    majEtat();
  }

  function voirNouveaux() {
    const profil = profilCourant();
    if (!profil) return;
    initialiser(profil);
    majFormulaire();
    annoncer('Les nouveaux réglages sont affichés.');
    if (modeAge()) champDate.focus();
    else cartes.find((carte) => carte.input.checked)?.input.focus();
  }

  /**
   * Retour à l'écran d'origine (Réglages, ou la fiche du plat d'où l'on vient), sans doublon dans l'historique
   * (l'entrée de garde comprise) ; ouvert autrement (lien direct) : Réglages, à la place de l'écran.
   */
  function sortir() {
    termine = true;
    brouillons.delete(cleBrouillon);
    feuilleOuverte?.fermer();
    if (vientDesReglages() || vientDeLaFiche()) history.go(garde ? -2 : -1);
    else location.replace('#/reglages');
    garde = false;
  }

  /** « Annuler », « ‹ Réglages » (« ‹ Retour »), ou retour d'Android : avec des changements, on demande d'abord. */
  function quitter() {
    if (termine) return;
    if (!modifie()) {
      sortir();
      return;
    }
    demanderSortie();
  }

  function demanderSortie() {
    if (feuilleOuverte) return;
    let part = false;
    feuilleOuverte = ouvrirFeuille('Quitter sans enregistrer\u00A0?', (fermer) => el('div', { class: 'actions-feuille' },
      el('p', { class: 'texte-doux' }, 'Vos changements seront perdus.'),
      el('button', {
        class: 'bouton bouton-principal bouton-plein',
        type: 'button',
        onclick: () => {
          part = true;
          fermer();
        },
      }, 'Quitter'),
      el('button', { class: 'bouton bouton-texte', type: 'button', autofocus: true, onclick: fermer }, 'Rester')), {
      onFermer: () => {
        feuilleOuverte = null;
        if (detruit) return;
        if (part) sortir();
        else if (modifie()) poserGarde();
      },
    });
  }

  // ——— Retour d'Android ———
  // Dès le premier changement, une entrée d'historique identique est ajoutée : le retour la retire sans changer
  // d'adresse (l'app ne change pas d'écran), et l'écran demande « Quitter sans enregistrer ? ».

  function poserGarde() {
    if (garde || termine || detruit) return;
    history.pushState({ ...(history.state ?? {}), gardeRegime: true }, '', location.href);
    garde = true;
  }

  function surRetour() {
    if (detruit || termine || !garde || history.state?.gardeRegime) return;
    if (location.hash !== hashEcran) return; // autre écran : l'app s'en charge
    garde = false;
    if (modifie()) demanderSortie();
    else sortir();
  }
  window.addEventListener('popstate', surRetour);
  // Écran rouvert sur son entrée de garde (retour après une sortie par l'en-tête) : il la reprend à son compte.
  if (history.state?.gardeRegime && location.hash === hashEcran) garde = true;

  majEtat();

  return {
    noeud: el('div', { class: 'vue regime' },
      retour,
      el('header', { class: 'vue-entete' }, titre, intro),
      messageChargement,
      messageAbsent,
      messages,
      formulaire,
      barre),
    maj(nouveau) {
      courant = nouveau;
      majEtat();
    },
    detruire() {
      detruit = true;
      window.removeEventListener('popstate', surRetour);
      feuilleOuverte?.fermer();
      if (termine) return;
      if (incomplete) {
        // Une date à moitié saisie ne peut pas être rendue au champ : le brouillon garde la date enregistrée, jamais
        // une date effacée (« Enregistrer » l'effacerait sinon à la reprise).
        naissance = ouverture?.naissance ?? '';
        incomplete = false;
      }
      if (modifie()) {
        brouillons.set(cleBrouillon, {
          ouverture,
          choix: { regime: choix.regime, precisions: [...choix.precisions] },
          naissance,
          bascules: [...bascules],
        });
      } else {
        brouillons.delete(cleBrouillon);
      }
      // Entrée de garde remplacée sur place par un autre écran (aperçu, profil retiré) : on la quitte, sans quoi
      // le retour d'Android repasserait une fois de trop par cet écran.
      if (garde && history.state?.gardeRegime && location.hash !== hashEcran) {
        const etatSansGarde = { ...history.state };
        delete etatSansGarde.gardeRegime;
        history.replaceState(etatSansGarde, '', location.href);
        history.back();
      }
    },
  };
}
