// Écran Courses (T3a, T3b) : la liste de la semaine montrée, calculée sur le téléphone (coeur/liste.js ›
// listeDeCourses), « 🏠 Déjà à la maison ? » replié en haut, « Dans le panier » replié en bas, et « ＋ Ajouter un
// article » dans une barre fixée au-dessus des onglets. Marche hors ligne ; ce qui est coché sur un téléphone se coche
// sur l'autre.
// Deux façons de faire les courses (T3b), retenues sur ce téléphone pour ce compte, Drive d'avance :
// - « 🚗 Drive » : « Pour cette semaine » (et « Comme chaque semaine » en T3d), sans en-têtes de rayon ; sur chaque ligne,
//   🔍 ouvre la recherche du produit sur le site du drive (un vrai lien, jamais une coche) ; au retour sur l'app moins de
//   15 minutes après, la ligne revient à l'écran, le focus sur sa case, avec « Pas le bon produit ? » et « Changer le
//   mot cherché » ; drive pas réglé : la carte « Régler le drive » ;
// - « 🛒 Magasin » : par rayon (en-têtes collants) ; l'écran reste allumé tant que Courses est visible, rendu après 10
//   minutes sans toucher et redemandé au toucher suivant (toute erreur ignorée).
// « Courses terminées » (T3b) : finit tout de suite s'il ne reste rien, sinon la feuille « Courses terminées ? » (garder
// les restes pour la prochaine fois, ou non) ; ensuite « Courses faites ✓ le samedi 10 octobre », « Pour les prochaines
// courses » (articles restants), « Revoir la liste » (replié) et « Rouvrir la liste ».
// Rien ne bouge sous le doigt : chaque ligne est gardée par sa clé (dom.js › reconcilier) ; une ligne cochée ici reste à
// sa place, barrée, et les lignes cochées rejoignent ensemble « Dans le panier » 1,5 s après le dernier toucher (un seul
// minuteur, relancé à chaque toucher, à chaque coche et pendant un défilement) ; « À racheter » garde sa ligne dans
// « Déjà à la maison ? » jusqu'à la prochaine ouverture de Courses ; une mise à jour (l'autre téléphone ajoute un plat,
// une ligne apparaît au-dessus) garde à sa place la ligne sous le doigt, sinon celle qui a le focus, sinon la première
// ligne visible (ancrage fait ici, l'ancrage du navigateur est coupé sur cet écran). Rien n'est écrit à l'ouverture ;
// une coche écrit seulement son chemin (actions.cocher), une ligne du placard « À racheter » le sien
// (actions.racheter) ; « Courses terminées » et « Rouvrir la liste » passent par actions.terminerCourses et
// actions.rouvrirListe, qui annoncent elles-mêmes.
import { el, etatVide, ecrireTexte, reconcilier, vibrer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { ouvrirAjoutArticle, ouvrirDetailsArticle, majFeuillesArticle } from './article.js';
import { driveDe, majFeuillesDrive, ouvrirMotCherche, ouvrirVotreDrive } from './drive.js';
import { demanderChoixALArrivee } from './choisir-plats.js';
import { listeCourante, platsDeLaSemaineDe } from './plat-semaine.js';
import { LIBELLES_RAYON } from '../coeur/edition.js';
import {
  TEXTES_FIN_DES_COURSES, bandeauxCourses, coursesFaites, grouperDrive, grouperParRayon, lignesAjouteesDepuis,
  ordreRayons, phraseRestesFin, restesFinDesCourses, texteAjoutesDepuis, texteCoursesFaites, texteDejaPris, texteOrigine,
} from '../coeur/liste.js';
import { lireSemaine, texteDates } from '../coeur/semaine.js';
import {
  ECRAN_ALLUME_MINUTES, TEXTES_DRIVE, cleModeCourses, ecranAEteindre, lienDrive, lireModeCourses, retourDuDrive,
  texteChercher, texteVotreDrive,
} from '../coeur/drive.js';

/** Les lignes cochées partent ensemble vers « Dans le panier » 1,5 s après le dernier toucher. */
const DELAI_DEPART_MS = 1500;
const MINUTE_MS = 60_000;

/** Geste refusé par l'app (rien n'est écrit) : la case revient à son état. */
const echoue = (resultat) => ['chargement', 'invalide', 'inutile', 'refuse', 'echec', 'deja', 'statut', 'hors_ligne']
  .includes(resultat?.code);

/** Une action peut rendre une valeur ou une promesse : `suite` reçoit la valeur (une promesse rejetée : { code: 'echec' }). */
function quand(resultat, suite) {
  if (resultat && typeof resultat.then === 'function') resultat.then(suite, () => suite({ code: 'echec' }));
  else suite(resultat);
}

/** « 🚗 Drive » : l'emoji n'est pas lu (le mot suffit), le texte affiché reste le même. */
function avecEmoji(texte) {
  const [emoji, ...reste] = texte.split(' ');
  return [el('span', { 'aria-hidden': 'true' }, emoji), ` ${reste.join(' ')}`];
}

/** « Choisir les plats › » : vers Semaine, qui ouvre la feuille « Ajouter à la semaine » en arrivant. */
const lienChoisir = (principal = true) => el('a', {
  class: `bouton bouton-plein ${principal ? 'bouton-principal' : 'bouton-secondaire'}`,
  href: '#/semaine',
  onclick: demanderChoixALArrivee,
}, 'Choisir les plats ›');

// ——— Mode de Courses, retenu sur ce téléphone pour ce compte (Drive d'avance) ———

// Choix fait pendant cette visite : il reste vrai si le stockage du téléphone est plein ou bloqué.
const modesIci = new Map();

function lireMode(uid) {
  const id = typeof uid === 'string' ? uid : '';
  if (modesIci.has(id)) return modesIci.get(id);
  const cle = cleModeCourses(id);
  if (!cle) return 'drive';
  try {
    return lireModeCourses(localStorage.getItem(cle));
  } catch {
    return 'drive';
  }
}

function ecrireMode(uid, mode) {
  const id = typeof uid === 'string' ? uid : '';
  modesIci.set(id, mode);
  const cle = cleModeCourses(id);
  if (!cle) return;
  try {
    localStorage.setItem(cle, mode);
  } catch {
    // Stockage bloqué : le choix tient jusqu'à la fermeture de l'app.
  }
}

// Dernier 🔍 touché ({ cle, le } : heure du téléphone) : au retour sur l'app, la ligne revient à l'écran. Gardé hors de
// l'écran, pour survivre à sa reconstruction.
let dernierDrive = null;

let numeroEcran = 0;

export function creer(ctx) {
  let courant = ctx;
  numeroEcran += 1;
  const base = `courses-${numeroEcran}`;
  const uid = ctx.utilisateur?.uid ?? '';
  let mode = lireMode(uid);
  let detruit = false;
  // Lignes touchées ici, gardées à leur place jusqu'au départ groupé : 'achat' (cochée, encore à acheter) ou 'panier'
  // (décochée, encore dans « Dans le panier »).
  const retenues = new Map();
  // Produits du placard rallumés (« À racheter ») pendant cette visite : ils restent dans « Déjà à la maison ? ».
  const gardesMaison = new Set();
  let minuteur = null;
  let toucherEnCours = false;
  let cleSousLeDoigt = null; // ligne touchée en dernier : la référence de l'ancrage
  let actuels = new Map(); // clé → ligne ou article de la liste du moment
  let etatAffiche = ''; // clé de l'état vide affiché (rien n'est reconstruit sans changement)
  const noeudsLignes = new Map(); // clé → <li>, partagé entre les listes (rayons, sections, panier, prochaines courses)
  const partiesLignes = new WeakMap(); // <li> → ses parties
  let cleRetour = null; // ligne revenue du drive : « Pas le bon produit ? » sous elle seulement
  let faitesAffichees = false; // l'écran montre « Courses faites ✓ … »
  let listeMontree = false; // une liste est à l'écran (l'écran allumé n'a de sens qu'avec elle)
  // Réglages du dernier dessin, lus par majLigne.
  let driveAffiche = null; // drive du foyer, en mode Drive seulement
  let enLigneAffiche = true;
  let feuilleFin = null; // feuille « Courses terminées ? » ouverte

  // ——— En-tête, bascule, aide, bandeaux ———
  const progression = el('p', { class: 'courses-progression' });
  const sousTitre = el('p', { class: 'sous-titre' });
  const radioDrive = el('input', { type: 'radio', name: `${base}-mode`, value: 'drive' });
  const radioMagasin = el('input', { type: 'radio', name: `${base}-mode`, value: 'magasin' });
  for (const radio of [radioDrive, radioMagasin]) {
    radio.addEventListener('change', () => {
      if (radio.checked) changerMode(radio.value);
    });
  }
  const bascule = el('fieldset', { class: 'groupe-choix bascule-courses', hidden: true },
    el('legend', { class: 'visuellement-masque' }, 'Où faites-vous les courses\u00A0?'),
    el('div', { class: 'choix-ligne' },
      el('label', { class: 'choix' }, radioDrive, ...avecEmoji(TEXTES_DRIVE.drive)),
      el('label', { class: 'choix' }, radioMagasin, ...avecEmoji(TEXTES_DRIVE.magasin))));
  const aide = el('p', { class: 'aide courses-aide', id: `${base}-aide` });
  const bandeauRecette = el('p', { class: 'bandeau bandeau-alerte', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '⏳'), el('span', {}));
  const bandeauxVerifier = el('div', { class: 'bandeaux-verifier' });
  const zoneEtat = el('div', { class: 'etat-courses', hidden: true });

  // ——— Drive pas réglé ———
  const boutonRegler = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button' }, TEXTES_DRIVE.regler);
  boutonRegler.addEventListener('click', () => ouvrirDrive(boutonRegler));
  const carteRegler = el('section', { class: 'carte carte-regler-drive', hidden: true },
    el('p', {}, TEXTES_DRIVE.aRegler),
    boutonRegler);

  // ——— Courses faites ———
  const titreFaites = el('h2', { tabindex: '-1' });
  const boutonRouvrir = el('button', { class: 'bouton bouton-texte bouton-rouvrir', type: 'button', onclick: rouvrir },
    TEXTES_FIN_DES_COURSES.rouvrir);
  const carteFaites = el('section', { class: 'carte carte-faites', hidden: true }, titreFaites, boutonRouvrir);
  const listeProchaines = el('ul', { class: 'lignes-courses lignes-prochaines' });
  const sectionProchaines = el('section', { class: 'section-courses prochaines-courses', hidden: true },
    el('h2', { class: 'titre-section-courses' }, TEXTES_FIN_DES_COURSES.prochaines),
    listeProchaines);
  const resumeRevoir = el('summary', { class: 'resume-courses' });
  const detailsRevoir = el('details', { class: 'details-courses details-revoir', hidden: true }, resumeRevoir);

  // ——— « Déjà à la maison ? » ———
  const resumeMaison = el('summary', { class: 'resume-courses' });
  const listeMaison = el('ul', { class: 'lignes-maison' });
  const zoneMaison = el('details', { class: 'details-courses details-maison', hidden: true },
    resumeMaison,
    el('p', { class: 'aide' }, 'D’habitude, vous en avez. Touchez ceux qu’il faut racheter.'),
    listeMaison);

  // ——— À acheter : par rayon (Magasin) ou en sections (Drive) ———
  const rayons = el('div', { class: 'rayons' });
  const listeSemaine = el('ul', { class: 'lignes-courses' });
  const sectionSemaine = el('section', { class: 'section-courses' },
    el('h2', { class: 'titre-section-courses' }, TEXTES_DRIVE.pourCetteSemaine), listeSemaine);
  const listeChaqueSemaine = el('ul', { class: 'lignes-courses' });
  const sectionChaqueSemaine = el('section', { class: 'section-courses', hidden: true },
    el('h2', { class: 'titre-section-courses' }, TEXTES_DRIVE.commeChaqueSemaine), listeChaqueSemaine);
  const sectionsDrive = el('div', { class: 'sections-drive', hidden: true }, sectionSemaine, sectionChaqueSemaine);
  const achats = el('div', { class: 'achats' }, rayons, sectionsDrive);

  // ——— Fin, panier ———
  const titreFini = el('h2', { tabindex: '-1' }, 'Tout est dans le panier 🎉');
  const boutonTerminerFini = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', hidden: true },
    TEXTES_FIN_DES_COURSES.bouton);
  boutonTerminerFini.addEventListener('click', () => terminer(boutonTerminerFini));
  const carteFini = el('section', { class: 'carte carte-fini', hidden: true }, titreFini, boutonTerminerFini);
  const resumePanier = el('summary', { class: 'resume-courses' });
  const listePanier = el('ul', { class: 'lignes-courses lignes-panier' });
  const zonePanier = el('details', { class: 'details-courses details-panier', hidden: true }, resumePanier, listePanier);
  // La liste elle-même : sous l'en-tête pendant les courses, dans « Revoir la liste » une fois les courses faites.
  const corps = el('div', { class: 'corps-courses' }, zoneMaison, achats, carteFini, zonePanier);

  const boutonTerminer = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', hidden: true },
    TEXTES_FIN_DES_COURSES.bouton);
  boutonTerminer.addEventListener('click', () => terminer(boutonTerminer));
  // Drive réglé : son nom, qui ouvre « Votre drive » (changer d'adresse, ne plus chercher au drive).
  const boutonVotreDrive = el('button', { class: 'bouton bouton-texte bouton-votre-drive', type: 'button' });
  boutonVotreDrive.addEventListener('click', () => ouvrirDrive(boutonVotreDrive));
  const statut = el('p', { class: 'visuellement-masque', role: 'status' });

  // ——— Barre « ＋ Ajouter un article » ———
  const boutonAjouter = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button' },
    el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter un article');
  boutonAjouter.addEventListener('click', () => {
    ouvrirAjoutArticle(() => courant, {
      onFermer: () => {
        if (boutonAjouter.isConnected) boutonAjouter.focus();
      },
    });
  });
  const barre = el('div', { class: 'barre-courses' }, el('div', { class: 'barre-courses-contenu' }, boutonAjouter));

  const vue = el('div', { class: 'vue courses' },
    el('header', { class: 'vue-entete courses-entete' },
      el('div', { class: 'courses-titre' }, el('h1', {}, 'Courses'), progression),
      sousTitre),
    bascule,
    aide,
    bandeauRecette,
    bandeauxVerifier,
    zoneEtat,
    carteRegler,
    carteFaites,
    sectionProchaines,
    detailsRevoir,
    corps,
    boutonTerminer,
    boutonVotreDrive,
    statut,
    barre);

  // La page réserve la hauteur réelle de la barre (texte agrandi compris), comme la barre des gestes de Découvrir.
  const observateur = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (!barre.isConnected) return;
      document.body.style.setProperty('--hauteur-barre-courses', `${Math.ceil(barre.getBoundingClientRect().height)}px`);
    })
    : null;
  observateur?.observe(barre);

  // ——— Départ groupé des lignes cochées ———

  function dire(texte) {
    // Même texte deux fois de suite : une espace de plus pour qu'il soit relu.
    statut.textContent = statut.textContent === texte ? `${texte}\u00A0` : texte;
  }

  function relancerDepart() {
    clearTimeout(minuteur);
    minuteur = retenues.size ? setTimeout(partir, DELAI_DEPART_MS) : null;
  }

  /** Les lignes retenues rejoignent leur place ; le focus d'une ligne partie passe à l'article suivant à acheter. */
  function partir() {
    minuteur = null;
    if (toucherEnCours) {
      relancerDepart();
      return;
    }
    const actif = document.activeElement;
    const ligneActive = actif?.closest?.('.ligne-article') ?? null;
    let suivante = null;
    let versFin = false;
    if (ligneActive && achats.contains(ligneActive)) {
      const cle = partiesLignes.get(ligneActive)?.cle;
      if (retenues.get(cle) === 'achat' && actuels.get(cle)?.cochee) {
        const resteAAcheter = (li) => !actuels.get(partiesLignes.get(li)?.cle)?.cochee;
        const ordre = [...achats.querySelectorAll('.ligne-article')];
        const i = ordre.indexOf(ligneActive);
        suivante = ordre.slice(i + 1).find(resteAAcheter) ?? ordre.slice(0, i).reverse().find(resteAAcheter) ?? null;
        versFin = !suivante;
      }
    }
    retenues.clear();
    // Trouvée et cochée : « Pas le bon produit ? » n'a plus lieu d'être.
    if (cleRetour && actuels.get(cleRetour)?.cochee) cleRetour = null;
    // Les lignes cochées partent : celles du dessous remontent (rien n'est sous le doigt, 1,5 s après le dernier toucher).
    dessiner({ ancrer: false });
    if (suivante?.isConnected) partiesLignes.get(suivante).input.focus({ preventScroll: true });
    else if (versFin && !carteFini.hidden) titreFini.focus({ preventScroll: true });
  }

  // Un toucher dans l'écran relance le minuteur ; rien ne part pendant un toucher ni pendant un défilement.
  const surToucher = (evenement) => {
    toucherEnCours = true;
    const li = evenement.target?.closest?.('.ligne-article');
    cleSousLeDoigt = li ? partiesLignes.get(li)?.cle ?? null : null;
    if (retenues.size) relancerDepart();
  };
  const finToucher = () => {
    toucherEnCours = false;
    if (retenues.size) relancerDepart();
  };
  const surDefilement = () => {
    if (retenues.size) relancerDepart();
  };
  vue.addEventListener('pointerdown', surToucher, { capture: true });
  window.addEventListener('pointerup', finToucher);
  window.addEventListener('pointercancel', finToucher);
  window.addEventListener('scroll', surDefilement, { passive: true });

  // ——— Écran allumé (mode Magasin) ———
  // Tant que Courses est visible en mode Magasin, avec une liste : rendu après 10 minutes sans toucher (un téléphone posé
  // sur la table ne vide pas sa batterie), redemandé au toucher suivant et au retour sur l'app ; rendu en passant en mode
  // Drive et en quittant l'écran. Toute erreur est ignorée (navigateur sans cette fonction, économie d'énergie…).
  let verrou = null; // verrou d'écran obtenu
  let demandeEnCours = false;
  let dernierToucher = Date.now();
  let minuteurEcran = null;
  let endormi = false; // rendu après 10 minutes sans toucher, jusqu'au toucher suivant

  const verrouVoulu = () => !detruit && mode === 'magasin' && listeMontree && !faitesAffichees && !endormi
    && document.visibilityState === 'visible';

  function rendreVerrou() {
    clearTimeout(minuteurEcran);
    minuteurEcran = null;
    const sentinelle = verrou;
    verrou = null;
    if (!sentinelle) return;
    try {
      Promise.resolve(sentinelle.release?.()).catch(() => {});
    } catch {
      // Déjà rendu : rien à faire.
    }
  }

  function programmerSommeil() {
    clearTimeout(minuteurEcran);
    const reste = ECRAN_ALLUME_MINUTES * MINUTE_MS - (Date.now() - dernierToucher);
    minuteurEcran = setTimeout(verifierSommeil, Math.max(1000, reste));
  }

  function verifierSommeil() {
    minuteurEcran = null;
    if (!verrouVoulu()) return;
    if (ecranAEteindre(dernierToucher, Date.now())) {
      endormi = true;
      rendreVerrou();
    } else {
      programmerSommeil();
    }
  }

  function majVerrou() {
    if (!verrouVoulu()) {
      rendreVerrou();
      return;
    }
    programmerSommeil();
    if (verrou || demandeEnCours || typeof navigator.wakeLock?.request !== 'function') return;
    demandeEnCours = true;
    let demande;
    try {
      demande = navigator.wakeLock.request('screen');
    } catch {
      demandeEnCours = false;
      return;
    }
    Promise.resolve(demande).then((sentinelle) => {
      demandeEnCours = false;
      if (!sentinelle) return;
      if (!verrouVoulu() || verrou) {
        // Plus voulu entre-temps (mode Drive, écran quitté, app cachée) : rendu aussitôt.
        try {
          Promise.resolve(sentinelle.release?.()).catch(() => {});
        } catch {
          // Déjà rendu.
        }
        return;
      }
      verrou = sentinelle;
      sentinelle.addEventListener?.('release', () => {
        if (verrou === sentinelle) verrou = null;
      });
    }, () => {
      demandeEnCours = false;
    });
  }

  // Tout toucher dans l'app (feuilles comprises) compte : l'écran reste allumé, ou se rallume.
  const surActivite = () => {
    if (detruit) return;
    dernierToucher = Date.now();
    endormi = false;
    if (mode === 'magasin') majVerrou();
  };
  document.addEventListener('pointerdown', surActivite, { capture: true });
  document.addEventListener('keydown', surActivite, { capture: true });

  // ——— Retour du drive ———

  /** La ligne revenue du drive : à l'écran, le focus sur sa case, « Pas le bon produit ? » dessous. Jamais cochée d'office. */
  function revenirALaLigne(cle) {
    if (detruit) return;
    const ligne = actuels.get(cle);
    const li = noeudsLignes.get(cle);
    if (!ligne || ligne.cochee || !li?.isConnected || mode !== 'drive' || !driveAffiche) return;
    const ancienne = cleRetour;
    cleRetour = cle;
    if (ancienne && ancienne !== cle) majCle(ancienne);
    const replie = li.closest('details');
    if (replie && !replie.open) replie.open = true;
    majLigne(li, ligne);
    li.scrollIntoView({ block: 'center' });
    partiesLignes.get(li)?.input.focus({ preventScroll: true });
  }

  const surVisibilite = () => {
    if (detruit) return;
    if (document.visibilityState !== 'visible') {
      rendreVerrou();
      return;
    }
    dernierToucher = Date.now();
    endormi = false;
    majVerrou();
    const retour = dernierDrive;
    if (!retour || !retourDuDrive(retour.le, Date.now())) return;
    dernierDrive = null;
    // Après le rendu que l'app relance au retour sur l'écran : la ligne est à jour.
    setTimeout(() => revenirALaLigne(retour.cle), 0);
  };
  document.addEventListener('visibilitychange', surVisibilite);

  // ——— Gestes ———

  function changerMode(nouveau) {
    if (nouveau === mode || (nouveau !== 'drive' && nouveau !== 'magasin')) return;
    mode = nouveau;
    ecrireMode(uid, mode);
    // Les lignes cochées partent tout de suite : toute la liste se range autrement.
    retenues.clear();
    clearTimeout(minuteur);
    minuteur = null;
    const ancienne = cleRetour;
    cleRetour = null;
    if (ancienne) majCle(ancienne);
    dessiner({ ancrer: false });
    majVerrou();
  }

  function cocher(cle, input) {
    const ligne = actuels.get(cle);
    if (!ligne) return;
    const oui = input.checked;
    const li = input.closest('.ligne-article');
    const avant = grouperParRayon(listeCourante(courant), { rayons: ordreRayons(courant.reglages) });
    // Reste où elle est jusqu'au départ groupé : à acheter (cochée, barrée) ou dans le panier (décochée). Les articles
    // « Pour les prochaines courses » ne bougent pas.
    const prochaine = Boolean(li && listeProchaines.contains(li));
    if (!prochaine) retenues.set(cle, li && achats.contains(li) ? 'achat' : 'panier');
    const resultat = courant.actions?.cocher?.(cle, oui);
    if (echoue(resultat)) {
      input.checked = !oui;
      retenues.delete(cle);
      relancerDepart();
      return;
    }
    vibrer();
    li?.classList.toggle('cochee', oui);
    // Revenue du drive et cochée : « Pas le bon produit ? » garde sa place jusqu'au départ groupé (rien ne bouge sous le
    // doigt), puis part avec la ligne (partir).
    const pris = Math.min(avant.total, Math.max(0, avant.pris + (ligne.cochee === oui ? 0 : oui ? 1 : -1)));
    dire(`${ligne.nom}\u00A0: ${oui ? 'dans le panier' : 'à acheter'}. ${pris} sur ${avant.total}.`);
    relancerDepart();
  }

  function racheter(cle, input) {
    if (input.checked) gardesMaison.add(cle);
    const resultat = courant.actions?.racheter?.(cle, input.checked);
    if (echoue(resultat)) input.checked = !input.checked;
  }

  function ouvrirDetails(cle, bouton) {
    ouvrirDetailsArticle(() => courant, cle, {
      onFermer: () => {
        const li = noeudsLignes.get(cle);
        const cible = bouton.isConnected ? bouton : li?.isConnected ? partiesLignes.get(li)?.details : null;
        // Article retiré (« Retirer de la liste ») : le focus passe à la ligne voisine, jamais à la page.
        if (cible) cible.focus();
        else focusVoisine(cle);
      },
    });
  }

  /** « Changer le mot cherché » (sous une ligne revenue du drive) : feuille « Au drive, je cherche ». */
  function changerMot(cle, bouton) {
    ouvrirMotCherche(() => courant, cle, {
      onFermer: () => {
        const li = noeudsLignes.get(cle);
        const parties = li?.isConnected ? partiesLignes.get(li) : null;
        const cible = bouton.isConnected && !bouton.closest('[hidden]') ? bouton : parties?.input;
        if (cible) cible.focus();
        else focusVoisine(cle);
      },
    });
  }

  /**
   * Feuille « Votre drive » ; le focus revient au bouton touché, sinon à « Régler le drive » (« Ne plus chercher au
   * drive » : la carte vient d'apparaître), sinon au premier 🔍, sinon à « Ajouter un article ».
   */
  function ouvrirDrive(depuis) {
    ouvrirVotreDrive(() => courant, {
      onFermer: () => {
        const visible = (n) => Boolean(n?.isConnected && !n.hidden && !n.closest('[hidden]'));
        const cible = [depuis, boutonRegler, achats.querySelector('.bouton-chercher:not([hidden])'), boutonVotreDrive,
          boutonAjouter].find(visible);
        cible?.focus();
      },
    });
  }

  /** « Courses terminées » : tout de suite s'il ne reste rien à acheter, sinon la feuille « Courses terminées ? ». */
  function terminer(depuis) {
    const restes = restesFinDesCourses(listeCourante(courant));
    if (!restes.length) {
      finir(true, () => focusApresFin(depuis));
      return;
    }
    ouvrirFinDesCourses(depuis);
  }

  /** Après « Courses terminées » : le titre « Courses faites ✓ … », sinon (refusé) le bouton touché. */
  function focusApresFin(depuis) {
    if (faitesAffichees && titreFaites.isConnected) titreFaites.focus();
    else if (depuis?.isConnected && !depuis.hidden) depuis.focus();
    else boutonAjouter.focus();
  }

  /** actions.terminerCourses : l'app écrit, redessine et annonce « Courses terminées. Bon appétit ! » avec « Annuler ». */
  function finir(garder, apres) {
    quand(courant.actions?.terminerCourses?.({ garder }), () => {
      if (!detruit) apres?.();
    });
  }

  /**
   * Feuille « Courses terminées ? » : « Il reste 3 articles : beurre, sel et piles. » ; « Les garder pour la prochaine
   * fois » (principal), « Terminer sans eux », « Continuer les courses ».
   */
  function ouvrirFinDesCourses(depuis) {
    let choisi = false;
    const phrase = el('p', { class: 'phrase-fin-courses' });
    const majPhrase = () => ecrireTexte(phrase, phraseRestesFin(restesFinDesCourses(listeCourante(courant))));
    majPhrase();
    const choisir = (garder) => {
      if (choisi) return;
      choisi = true;
      // La feuille se ferme d'abord : l'annonce « Courses terminées. Bon appétit ! » (et son « Annuler ») n'est pas
      // cachée sous une feuille encore ouverte ; le focus va ensuite au titre « Courses faites ✓ … » (onFermer).
      feuille.fermer();
      finir(garder);
    };
    const feuille = ouvrirFeuille(TEXTES_FIN_DES_COURSES.titre, () => el('div', { class: 'feuille-fin-courses' },
      phrase,
      el('div', { class: 'actions-feuille' },
        el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: () => choisir(true) },
          TEXTES_FIN_DES_COURSES.garder),
        el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: () => choisir(false) },
          TEXTES_FIN_DES_COURSES.sansEux),
        el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: () => feuille.fermer() },
          TEXTES_FIN_DES_COURSES.continuer))), {
      onFermer: () => {
        if (feuilleFin === suivi) feuilleFin = null;
        if (!detruit) focusApresFin(depuis);
      },
    });
    const suivi = {
      maj() {
        // Courses terminées sur l'autre téléphone : la question n'a plus lieu d'être.
        if (faitesAffichees) feuille.fermer();
        else majPhrase();
      },
    };
    feuilleFin = suivi;
  }

  /** « Rouvrir la liste » : actions.rouvrirListe (annonce « La liste est rouverte. ») ; le focus va à la liste. */
  function rouvrir() {
    quand(courant.actions?.rouvrirListe?.(), (resultat) => {
      if (detruit || echoue(resultat)) return;
      const visible = (n) => Boolean(n?.isConnected && !n.hidden && !n.closest('[hidden]') && n.getClientRects().length);
      const cible = [...achats.querySelectorAll('.case-article')].find(visible)
        ?? [boutonTerminer, boutonTerminerFini, boutonAjouter].find(visible);
      cible?.focus();
    });
  }

  // Ordre des lignes avant le dernier retrait : une ligne partie passe le focus à sa voisine.
  let ordrePrecedent = [];

  /** Focus de la ligne qui suit `cle` dans l'ordre d'avant, sinon de celle qui la précède, sinon « ＋ Ajouter un article ». */
  function focusVoisine(cle) {
    const position = ordrePrecedent.indexOf(cle);
    // Une ligne affichée (jamais dans un « Dans le panier » replié, où elle ne prendrait pas le focus).
    const presente = (c) => Boolean(noeudsLignes.get(c)?.isConnected && noeudsLignes.get(c).getClientRects().length);
    const voisine = ordrePrecedent.slice(position + 1).find(presente)
      ?? ordrePrecedent.slice(0, Math.max(0, position)).reverse().find(presente);
    const cible = voisine ? partiesLignes.get(noeudsLignes.get(voisine))?.input : boutonAjouter;
    cible?.focus({ preventScroll: Boolean(voisine) });
  }

  // ——— Lignes ———

  /** Seconde ligne : « 600 g · Gratin, Salade de pâtes », « Ajouté à la main », ou « Déjà pris : 600 g · encore 200 g ». */
  function detailDe(ligne) {
    if (ligne.dejaPris) return texteDejaPris(ligne);
    return [ligne.quantite, texteOrigine(ligne, { profils: courant.profils ?? [], moi: courant.moi ?? null })]
      .filter(Boolean).join(' · ');
  }

  let numeroLigne = 0;

  function creerLigne(element) {
    const cle = element.cle;
    numeroLigne += 1;
    const input = el('input', { class: 'case-article', type: 'checkbox' });
    input.addEventListener('change', () => cocher(cle, input));
    const nom = el('span', { class: 'article-nom' });
    const detail = el('span', { class: 'article-detail' });
    // 🔍 : un vrai lien vers la recherche du drive (nouvel onglet), hors de la cible de la coche.
    const chercher = el('a', {
      class: 'bouton-chercher',
      target: '_blank',
      rel: 'noopener noreferrer',
      hidden: true,
    }, el('span', { 'aria-hidden': 'true' }, '🔍'));
    chercher.addEventListener('click', (evenement) => {
      // Hors ligne : le lien reste atteignable (TalkBack garde le focus) mais n'ouvre rien.
      if (chercher.getAttribute('aria-disabled') === 'true') {
        evenement.preventDefault();
        return;
      }
      dernierDrive = { cle, le: Date.now() };
      const ancienne = cleRetour;
      cleRetour = null;
      if (ancienne) majCle(ancienne);
    });
    const details = el('button', { class: 'bouton-details', type: 'button' }, el('span', { 'aria-hidden': 'true' }, '⋮'));
    details.addEventListener('click', () => ouvrirDetails(cle, details));
    const boutonMot = el('button', { class: 'bouton bouton-texte bouton-mot-drive', type: 'button' }, TEXTES_DRIVE.changerLeMot);
    boutonMot.addEventListener('click', () => changerMot(cle, boutonMot));
    const retour = el('p', { class: 'retour-drive', id: `${base}-retour-${numeroLigne}`, hidden: true },
      el('span', {}, TEXTES_DRIVE.pasLeBonProduit), ' ', boutonMot);
    const li = el('li', { class: 'ligne-article' },
      el('label', { class: 'article-cible' }, input, el('span', { class: 'article-texte' }, nom, detail)),
      chercher,
      details,
      retour);
    partiesLignes.set(li, { cle, input, nom, detail, chercher, details, retour });
    majLigne(li, element);
    return li;
  }

  function majLigne(li, element) {
    const parties = partiesLignes.get(li);
    const ligne = actuels.get(element.cle) ?? element;
    if (parties.input.checked !== ligne.cochee) parties.input.checked = ligne.cochee;
    li.classList.toggle('cochee', ligne.cochee);
    ecrireTexte(parties.nom, ligne.nom);
    const detail = detailDe(ligne);
    ecrireTexte(parties.detail, detail);
    parties.detail.hidden = !detail;
    const nomDetails = `Détails\u00A0: ${ligne.nom}`;
    if (parties.details.getAttribute('aria-label') !== nomDetails) parties.details.setAttribute('aria-label', nomDetails);

    // 🔍 en mode Drive, drive réglé : lien vers la recherche du mot cherché.
    const lien = driveAffiche ? lienDrive(driveAffiche.urlRecherche, ligne.recherche ?? ligne.libelle) : null;
    parties.chercher.hidden = !lien;
    if (lien) {
      if (parties.chercher.getAttribute('href') !== lien) parties.chercher.setAttribute('href', lien);
      const nomChercher = texteChercher(ligne.recherche ?? ligne.libelle, driveAffiche.nom);
      if (parties.chercher.getAttribute('aria-label') !== nomChercher) parties.chercher.setAttribute('aria-label', nomChercher);
      if (enLigneAffiche) {
        parties.chercher.removeAttribute('aria-disabled');
        parties.chercher.removeAttribute('aria-describedby');
      } else {
        parties.chercher.setAttribute('aria-disabled', 'true');
        parties.chercher.setAttribute('aria-describedby', aide.id);
      }
    }
    // « Pas le bon produit ? » sous la ligne revenue du drive seulement, tant qu'elle n'est pas cochée ou qu'elle reste à
    // sa place (cochée, retenue jusqu'au départ groupé : la ligne d'en dessous ne bouge pas sous le doigt). La case la
    // décrit : un lecteur d'écran l'annonce avec elle au retour du drive.
    const aSaPlace = !ligne.cochee || retenues.get(element.cle) === 'achat';
    const montrerRetour = Boolean(lien) && element.cle === cleRetour && aSaPlace;
    parties.retour.hidden = !montrerRetour;
    if (montrerRetour) {
      if (parties.input.getAttribute('aria-describedby') !== parties.retour.id) {
        parties.input.setAttribute('aria-describedby', parties.retour.id);
      }
    } else if (parties.input.hasAttribute('aria-describedby')) {
      parties.input.removeAttribute('aria-describedby');
    }
  }

  /** Remet à jour la ligne d'une clé, si elle est à l'écran. */
  function majCle(cle) {
    const li = noeudsLignes.get(cle);
    const ligne = actuels.get(cle);
    if (li && ligne) majLigne(li, ligne);
  }

  const partiesMaison = new WeakMap();
  let numeroMaison = 0;

  function creerLigneMaison(ligne) {
    numeroMaison += 1;
    const id = `${base}-maison-${numeroMaison}`;
    const input = el('input', { class: 'interrupteur', type: 'checkbox', role: 'switch', 'aria-describedby': `${id}-detail ${id}-etat` });
    input.addEventListener('change', () => racheter(ligne.cle, input));
    const nom = el('span', { class: 'maison-nom' });
    const detail = el('span', { class: 'maison-detail', id: `${id}-detail` });
    const etat = el('span', { class: 'maison-etat', id: `${id}-etat` });
    const li = el('li', {},
      el('label', { class: 'ligne-maison' },
        el('span', { class: 'maison-texte' }, nom, detail, etat),
        el('span', { class: 'maison-bascule' },
          el('span', { class: 'maison-bascule-texte', 'aria-hidden': 'true' }, 'À racheter'),
          input)));
    partiesMaison.set(li, { input, nom, detail, etat });
    majLigneMaison(li, ligne);
    return li;
  }

  function majLigneMaison(li, ligne) {
    const { input, nom, detail, etat } = partiesMaison.get(li);
    ecrireTexte(nom, ligne.nom);
    const origine = texteOrigine(ligne, { profils: courant.profils ?? [], moi: courant.moi ?? null });
    ecrireTexte(detail, [ligne.quantite, origine].filter(Boolean).join(' · '));
    const surLaListe = ligne.rachetee ? `Sur la liste · ${LIBELLES_RAYON[ligne.rayon] ?? LIBELLES_RAYON.divers}` : '';
    ecrireTexte(etat, surLaListe);
    etat.hidden = !surLaListe;
    if (input.checked !== ligne.rachetee) input.checked = ligne.rachetee;
    const nomInterrupteur = `À racheter\u00A0: ${ligne.nom}`;
    if (input.getAttribute('aria-label') !== nomInterrupteur) input.setAttribute('aria-label', nomInterrupteur);
  }

  const partiesRayons = new WeakMap();

  /** Un rayon : en-tête collant « Fruits et légumes · 4 », puis ses lignes (lignes retenues comprises). */
  function creerRayon(groupe) {
    const titre = el('h2', { class: 'rayon-titre' });
    const liste = el('ul', { class: 'lignes-courses' });
    const noeud = el('section', { class: 'rayon' }, titre, liste);
    partiesRayons.set(noeud, { titre, liste });
    majRayon(noeud, groupe);
    return noeud;
  }

  function majRayon(noeud, groupe) {
    const { titre, liste } = partiesRayons.get(noeud);
    ecrireTexte(titre, `${groupe.libelle} · ${groupe.lignes.length}`);
    reconcilier(liste, groupe.lignes, optionsLignes);
  }

  const optionsLignes = { cle: (l) => l.cle, creer: creerLigne, maj: majLigne, noeuds: noeudsLignes };

  // ——— États ———

  /** État vide ou de chargement, reconstruit seulement quand il change. `cle` '' : aucun. */
  function montrerEtat(cle, fabriquer) {
    if (cle === etatAffiche) return;
    etatAffiche = cle;
    zoneEtat.replaceChildren(...(cle ? [fabriquer()] : []));
    zoneEtat.hidden = !cle;
  }

  /** La liste sous l'en-tête (courses en cours) ou dans « Revoir la liste » (courses faites) ; déplacée seulement si besoin. */
  function placerCorps(faites) {
    if (faites && corps.parentNode !== detailsRevoir) detailsRevoir.append(corps);
    else if (!faites && corps.parentNode !== vue) vue.insertBefore(corps, boutonTerminer);
  }

  // ——— Ancrage : la ligne de référence garde sa place à l'écran pendant une mise à jour ———

  /**
   * Lignes visibles avant une mise à jour, la référence d'abord : la ligne touchée en dernier (là où l'on regarde), puis
   * celle qui a le focus, puis les autres de haut en bas. → [{ cle, top }]
   */
  function positionsVisibles() {
    const vues = [];
    for (const [cle, li] of noeudsLignes) {
      if (!li.isConnected) continue;
      const r = li.getBoundingClientRect();
      if (r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) vues.push({ cle, top: r.top });
    }
    vues.sort((a, b) => a.top - b.top);
    const focus = document.activeElement?.closest?.('.ligne-article');
    const cleFocus = focus ? partiesLignes.get(focus)?.cle : null;
    const rang = (v) => (v.cle === cleSousLeDoigt ? 0 : v.cle === cleFocus ? 1 : 2);
    return vues.sort((a, b) => rang(a) - rang(b));
  }

  /** Remet la première ligne de référence encore affichée à sa place d'avant (défilement compensé). */
  function compenser(vues) {
    for (const { cle, top } of vues) {
      const li = noeudsLignes.get(cle);
      if (!li?.isConnected) continue;
      const r = li.getBoundingClientRect();
      if (!r.height) continue;
      const ecart = r.top - top;
      if (Math.abs(ecart) >= 1) window.scrollBy({ top: ecart, behavior: 'instant' });
      return;
    }
  }

  // ——— Dessin ———

  function cacherTout() {
    for (const zone of [bascule, carteRegler, carteFaites, sectionProchaines, detailsRevoir, bandeauRecette, bandeauxVerifier,
      zoneMaison, rayons, sectionsDrive, carteFini, zonePanier, boutonTerminer, boutonVotreDrive]) zone.hidden = true;
  }

  function dessiner({ ancrer = true } = {}) {
    const vues = ancrer && vue.isConnected ? positionsVisibles() : [];
    const c = courant;
    const enLigne = c.enLigne ?? navigator.onLine;
    const drive = driveDe(c);
    const charge = Boolean(c.semainesChargees) && c.platsCharges !== false && c.profilsCharges !== false
      && c.articlesCharges !== false;
    if (!charge) {
      // Jamais « Rien à acheter » avant la lecture.
      ecrireTexte(aide, enLigne
        ? 'Touchez un article pour le cocher. Ça marche aussi sans réseau.'
        : 'Hors ligne\u00A0: vos coches partiront au retour du réseau.');
      aide.hidden = false;
      montrerEtat('chargement', () => el('p', { class: 'texte-doux', role: 'status' }, 'Chargement de la liste…'));
      cacherTout();
      placerCorps(false);
      ecrireTexte(progression, '');
      ecrireTexte(sousTitre, '');
      listeMontree = false;
      faitesAffichees = false;
      majVerrou();
      return;
    }

    const liste = listeCourante(c);
    const rangs = ordreRayons(c.reglages);
    const lue = lireSemaine(c.semaine);
    const faites = Boolean(lue) && coursesFaites(lue);
    const elements = lue ? platsDeLaSemaineDe(c) : [];
    const avecPlats = elements.some((e) => e.etat === 'ok' || e.etat === 'sansRecette');
    const lignes = liste?.lignes ?? [];
    const articles = liste?.articles ?? [];
    const tous = [...lignes, ...articles];
    actuels = new Map(tous.map((e) => [e.cle, e]));
    for (const cle of [...retenues.keys()]) if (!actuels.has(cle)) retenues.delete(cle);
    if (cleRetour && !actuels.has(cleRetour)) cleRetour = null;
    const reel = grouperParRayon(liste, { rayons: rangs });
    const copieVide = Boolean(c.semainesDepuisCache) && !(c.semaines ?? []).length;
    const montree = !copieVide && tous.length > 0;
    const enDrive = mode === 'drive';
    faitesAffichees = faites;
    listeMontree = montree;
    driveAffiche = enDrive ? drive : null;
    enLigneAffiche = enLigne;

    ecrireTexte(sousTitre, lue ? `Semaine ${texteDates(lue.debut, lue.fin)}` : '');
    sousTitre.hidden = !lue;
    ecrireTexte(progression, reel.total && !faites ? `${reel.pris} sur ${reel.total} dans le panier` : '');
    progression.hidden = !reel.total || faites;

    // Bascule Drive / Magasin, aide.
    bascule.hidden = !montree || faites;
    if (radioDrive.checked !== enDrive) radioDrive.checked = enDrive;
    if (radioMagasin.checked !== !enDrive) radioMagasin.checked = !enDrive;
    let texteAide;
    if (enDrive && drive && montree) texteAide = enLigne ? TEXTES_DRIVE.aide : TEXTES_DRIVE.horsLigne;
    else {
      texteAide = enLigne
        ? 'Touchez un article pour le cocher. Ça marche aussi sans réseau.'
        : 'Hors ligne\u00A0: vos coches partiront au retour du réseau.';
    }
    ecrireTexte(aide, texteAide);
    aide.hidden = faites;
    carteRegler.hidden = !(montree && !faites && enDrive && !drive);
    // « Régler le drive » est l'action principale tant que rien n'est dans le panier en entier.
    const classeRegler = `bouton bouton-plein ${reel.vide || reel.pris < reel.total ? 'bouton-principal' : 'bouton-secondaire'}`;
    if (boutonRegler.className !== classeRegler) boutonRegler.className = classeRegler;
    // Courses faites : plus rien à chercher, le réglage du drive attend les prochaines courses (comme la bascule).
    boutonVotreDrive.hidden = !(montree && enDrive && drive) || faites;
    if (drive) ecrireTexte(boutonVotreDrive, `${texteVotreDrive(drive.nom)} ›`);

    // Bandeaux : plats sans recette, quantités qui n'ont pas pu être comptées.
    const bandeaux = bandeauxCourses(liste);
    ecrireTexte(bandeauRecette.lastChild, bandeaux.sansRecette ? ` ${bandeaux.sansRecette}` : '');
    bandeauRecette.hidden = !bandeaux.sansRecette || faites;
    reconcilier(bandeauxVerifier, faites ? [] : bandeaux.aVerifier, {
      cle: (texte) => texte,
      creer: (texte) => el('p', { class: 'bandeau bandeau-alerte' }, texte),
    });
    bandeauxVerifier.hidden = faites || !bandeaux.aVerifier.length;

    // États : copie vide hors ligne, pas encore de plats, rien à acheter.
    const dates = lue ? texteDates(lue.debut, lue.fin) : '';
    if (copieVide) {
      montrerEtat('copie-vide', () => etatVide({
        emoji: '🧺',
        teinte: 'olive',
        titre: 'La liste n’est pas encore sur ce téléphone.',
        texte: 'Ouvrez l’app une fois avec du réseau\u00A0: elle restera ensuite disponible en magasin.',
      }));
    } else if (faites) {
      montrerEtat('', null);
    } else if (!avecPlats && tous.length) {
      montrerEtat('sans-plats', () => el('section', { class: 'carte carte-sans-plats' },
        el('h2', {}, 'Pas encore de plats pour cette semaine'),
        lienChoisir(false)));
    } else if (!avecPlats) {
      montrerEtat(`vide|${dates}`, () => etatVide({
        emoji: '🧺',
        teinte: 'olive',
        titre: 'Rien à acheter pour l’instant',
        texte: `Choisissez les plats de la semaine${dates ? ` ${dates}` : ''}\u00A0: la liste se fera toute seule.`,
      }, lienChoisir()));
    } else if (reel.vide && !bandeaux.sansRecette) {
      montrerEtat('rien', () => etatVide({ emoji: '🧺', teinte: 'olive', titre: 'Rien à acheter pour l’instant' }));
    } else {
      montrerEtat('', null);
    }

    // Ligne qui a le focus avant la mise à jour (la liste peut changer de place : « Courses faites », « Rouvrir »).
    const actifAvant = document.activeElement;
    const ligneFocus = actifAvant?.closest?.('.ligne-article') ?? null;
    const partiesFocus = ligneFocus ? partiesLignes.get(ligneFocus) : null;
    const focusCle = partiesFocus?.cle ?? null;
    const focusPartie = !partiesFocus ? 'input'
      : actifAvant === partiesFocus.details ? 'details'
        : actifAvant === partiesFocus.chercher ? 'chercher'
          : partiesFocus.retour.contains(actifAvant) ? 'retour' : 'input';
    const clesAvant = [...vue.querySelectorAll('.ligne-article')].map((li) => partiesLignes.get(li)?.cle).filter(Boolean);

    // Courses faites : « Courses faites ✓ … », « Pour les prochaines courses », la liste dans « Revoir la liste ».
    carteFaites.hidden = !faites;
    if (faites) {
      ecrireTexte(titreFaites, texteCoursesFaites(lue));
      const ajoutes = texteAjoutesDepuis(lignesAjouteesDepuis(liste, lue));
      ecrireTexte(resumeRevoir, ajoutes ? `${TEXTES_FIN_DES_COURSES.revoir} · ${ajoutes}` : TEXTES_FIN_DES_COURSES.revoir);
    }
    placerCorps(faites);

    // « Déjà à la maison ? » : le placard, et les produits rallumés pendant cette visite (gardés jusqu'à la prochaine
    // ouverture de Courses).
    const maison = [
      ...(liste?.maison ?? []),
      ...lignes.filter((l) => l.rachetee && gardesMaison.has(l.cle)),
    ].sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }) || (a.cle < b.cle ? -1 : 1));
    reconcilier(listeMaison, maison, { cle: (l) => l.cle, creer: creerLigneMaison, maj: majLigneMaison });
    zoneMaison.hidden = !maison.length;
    // « Revoir la liste » : seulement s'il y a quelque chose à revoir (les lignes des plats ou le placard).
    detailsRevoir.hidden = !faites || (!lignes.length && !maison.length);
    ecrireTexte(resumeMaison, `🏠 Déjà à la maison\u00A0? · ${maison.length}`);

    // À acheter et panier, lignes retenues comprises (elles restent où elles sont jusqu'au départ groupé). Courses
    // faites : les articles vont dans « Pour les prochaines courses », la liste ne garde que les lignes des plats.
    const dansLaListe = faites ? lignes : tous;
    const resteEnAchat = (e) => retenues.get(e.cle) === 'achat' || (!e.cochee && retenues.get(e.cle) !== 'panier');
    const affichage = { lignes: dansLaListe.map((e) => ({ ...e, cochee: !resteEnAchat(e) })), articles: [] };
    reconcilier(listeProchaines, faites ? articles : [], optionsLignes);
    sectionProchaines.hidden = !faites || !articles.length;
    let nbAAcheter = 0;
    let panier;
    if (enDrive) {
      const groupes = grouperDrive(affichage, { rayons: rangs });
      reconcilier(rayons, [], { cle: (g) => g.rayon, creer: creerRayon, maj: majRayon });
      reconcilier(listeSemaine, groupes.pourCetteSemaine, optionsLignes);
      reconcilier(listeChaqueSemaine, groupes.commeChaqueSemaine, optionsLignes);
      sectionSemaine.hidden = !groupes.pourCetteSemaine.length;
      sectionChaqueSemaine.hidden = !groupes.commeChaqueSemaine.length;
      nbAAcheter = groupes.pourCetteSemaine.length + groupes.commeChaqueSemaine.length;
      panier = groupes.panier;
    } else {
      const groupes = grouperParRayon(affichage, { rayons: rangs });
      reconcilier(listeSemaine, [], optionsLignes);
      reconcilier(listeChaqueSemaine, [], optionsLignes);
      reconcilier(rayons, groupes.aAcheter, { cle: (g) => g.rayon, creer: creerRayon, maj: majRayon });
      nbAAcheter = groupes.aAcheter.reduce((n, g) => n + g.lignes.length, 0);
      panier = groupes.panier;
    }
    rayons.hidden = enDrive || !nbAAcheter;
    sectionsDrive.hidden = !enDrive || !nbAAcheter;
    reconcilier(listePanier, panier, optionsLignes);
    zonePanier.hidden = !panier.length;
    ecrireTexte(resumePanier, `Dans le panier · ${panier.length}`);
    if (clesAvant.some((cle) => !actuels.has(cle))) ordrePrecedent = clesAvant;
    for (const cle of [...noeudsLignes.keys()]) if (!actuels.has(cle)) noeudsLignes.delete(cle);
    // Une ligne passée d'une liste à l'autre (cochée sur l'autre téléphone) garde le focus ; une ligne partie (retirée
    // ici ou sur l'autre téléphone) le passe à sa voisine.
    if (focusCle && !(document.activeElement && document.activeElement !== document.body && vue.contains(document.activeElement))) {
      const li = noeudsLignes.get(focusCle);
      const parties = li?.isConnected ? partiesLignes.get(li) : null;
      if (parties) {
        const voulu = { details: parties.details, chercher: parties.chercher, retour: parties.retour.querySelector('button') }[focusPartie];
        const cible = voulu && !voulu.hidden && !voulu.closest('[hidden]') ? voulu : parties.input;
        cible.focus({ preventScroll: true });
      } else {
        focusVoisine(focusCle);
      }
      // Ligne repliée dans « Revoir la liste » (courses terminées sur l'autre téléphone) : le titre « Courses faites ✓ ».
      if (faites && !vue.contains(document.activeElement)) titreFaites.focus({ preventScroll: true });
    }

    // Tout pris : seulement si au moins une ligne ou un article existe, et plus rien d'affiché à acheter.
    carteFini.hidden = faites || reel.vide || nbAAcheter > 0;
    // « Courses terminées » : principal sous « Tout est dans le panier 🎉 », secondaire en bas de la liste sinon.
    const peutTerminer = Boolean(lue) && avecPlats && !faites;
    boutonTerminerFini.hidden = !peutTerminer || carteFini.hidden;
    boutonTerminer.hidden = !peutTerminer || !carteFini.hidden;
    if (vues.length) compenser(vues);
    majVerrou();
  }

  dessiner();
  majFeuillesArticle(ctx);
  majFeuillesDrive(ctx);

  return {
    noeud: vue,
    maj(nouveau) {
      courant = nouveau;
      dessiner();
      majFeuillesArticle(nouveau);
      majFeuillesDrive(nouveau);
      feuilleFin?.maj();
    },
    detruire() {
      detruit = true;
      clearTimeout(minuteur);
      rendreVerrou();
      observateur?.disconnect();
      window.removeEventListener('pointerup', finToucher);
      window.removeEventListener('pointercancel', finToucher);
      window.removeEventListener('scroll', surDefilement);
      document.removeEventListener('pointerdown', surActivite, { capture: true });
      document.removeEventListener('keydown', surActivite, { capture: true });
      document.removeEventListener('visibilitychange', surVisibilite);
    },
  };
}
