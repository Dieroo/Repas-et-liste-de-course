// Feuille « Ajouter à la semaine » (T3a), ouverte depuis Semaine (« ＋ Choisir les plats », « ＋ Choisir d'autres
// plats », « Préparer la semaine du … ») : un toucher par plat, chaque case s'enregistre aussitôt, un second toucher
// retire le plat ; « Vos préférés » en tête, recherche sans accents, puces Plats · Desserts · Tout, « ＋ Nouveau plat »
// quand aucun plat ne porte le nom cherché.
// La semaine visée (coeur/semaine.js › semaineVisee) est figée à l'ouverture (dès que les semaines sont lues) et passée
// à chaque ajout : un plat va toujours à la semaine dont la feuille affiche les dates, même si l'autre téléphone en
// crée une pendant ce temps. Les deux derniers jours d'une semaine, c'est la suivante ; « Ajouter plutôt à la semaine
// qui finit le 16 » permet l'inverse. Articles pas pris de la semaine qui finit (restes) : gardés d'avance, ils partent
// avec le premier plat, dans le lot qui crée la semaine ; « Ne pas les garder » les laisse ; décocher le seul plat de
// la semaine suivante les reprend (l'app les retire avec lui) et la phrase revient. Une recherche cherche dans tous les
// types (la puce ne trie que la liste sans recherche) ; le nom d'un plat de la corbeille mène à sa fiche (« Remettre »).
// T4-0 : quand la semaine visée n'a aucun plat, « ✨ Proposer 4 plats » est le premier bouton (la feuille se ferme, les
// plats entrent d'un coup, « Annuler » 30 s) ; « 🍰 Proposer des desserts » (D6) ferme la feuille et ouvre « Combien de
// desserts ? » sur la même semaine visée. Présence et libellés figés à l'ouverture : la recherche ne bouge jamais.
import { el, ecrireTexte, reconcilier, vibrer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { modeDeCuisson } from './pictos.js';
import { ligneCompat } from './compat.js';
import { vignetteDuPlat } from './plats.js';
import { restesPour, nomDuPlat, platsDeLaSemaineDe } from './plat-semaine.js';
import { aSaRecette } from '../coeur/plats.js';
import {
  FILTRES_CHOIX, estDansLaSemaine, lireSemaine, platsAChoisir, semaineVisee, texteDates, texteJour,
} from '../coeur/semaine.js';
import { phraseRestes } from '../coeur/liste.js';
import {
  TEXTES_PROPOSER, libelleProposer, libelleProposerDesserts, sousTitreDesserts, texteSansProposition,
} from '../coeur/proposition.js';

// Une seule feuille à la fois ; l'écran Semaine la met à jour à chaque rendu (majChoixDesPlats).
let feuilleOuverte = null;
const TEXTE_DATES_CHANGEES = 'Les dates de la semaine ont changé\u00A0: touchez de nouveau le plat.';
// « Combien de desserts ? » ouverte (une seule à la fois), mise à jour avec la feuille de choix.
let dessertsOuverte = null;
let dessertsNumero = 0;
// « Choisir les plats › » de Courses : Semaine ouvre la feuille à son arrivée.
let ouvertureDemandee = false;

/** Courses demande la feuille : l'écran Semaine l'ouvrira en arrivant (prendreChoixDemande). */
export function demanderChoixALArrivee() {
  ouvertureDemandee = true;
}

/** Vrai une seule fois après demanderChoixALArrivee. */
export function prendreChoixDemande() {
  const demandee = ouvertureDemandee;
  ouvertureDemandee = false;
  return demandee;
}

/** Met à jour la feuille ouverte avec le contexte du moment. */
export function majChoixDesPlats(ctx) {
  feuilleOuverte?.maj(ctx);
  dessertsOuverte?.maj(ctx);
}

/** Bouton plein avec son emoji à part (`span aria-hidden`) : le nom accessible est le seul libellé. */
function boutonEmoji(classe, emoji, onclick) {
  const libelle = el('span', {});
  const bouton = el('button', { class: classe, type: 'button', onclick },
    el('span', { 'aria-hidden': 'true' }, emoji), libelle);
  return { bouton, libelle };
}

/** Semaine visée réduite à { id, debut, fin } (les plats se lisent toujours dans les semaines du moment). */
const reduireCible = (cible) => (cible ? { id: cible.id, debut: cible.debut, fin: cible.fin } : null);

/** « du 17 au 23 » (même mois), sinon « du 28 octobre au 3 novembre » (texteDates). */
function datesCourtes({ debut, fin }) {
  if (debut?.slice(0, 7) === fin?.slice(0, 7) && debut !== fin) {
    return `du ${texteJour(debut, { mois: false })} au ${texteJour(fin, { mois: false })}`;
  }
  return texteDates(debut, fin);
}

/** « Ils passeront sur la nouvelle liste. » devient « Ils ne passeront pas… » quand on ne les garde pas. */
function phraseDesRestes(liste, garder) {
  const phrase = phraseRestes(liste);
  if (garder) return phrase;
  return phrase.replace('Ils passeront sur', 'Ils ne passeront pas sur').replace('Il passera sur', 'Il ne passera pas sur');
}

/**
 * Ouvre la feuille « Ajouter à la semaine ». `lireCtx()` : le contexte du moment ; `onFermer` : après la fermeture
 * (rendre le focus au bouton qui l'a ouverte). Une feuille déjà ouverte est rendue telle quelle.
 * Actions : ajouterALaSemaine(platId, { cible, restes, silencieux: true }), retirerDeLaSemaine(platId, { semaineId,
 * silencieux: true }), ajouterPlat(nom) ; un code « chargement », « invalide », « refuse » ou « echec » remet la case
 * (« deja » et « inutile » : la case dit déjà vrai) ; « chevauche » (T3c : la semaine visée, encore sans plat, touche
 * désormais une semaine qui a des plats, dates changées sur l'autre téléphone) la remet aussi, recalcule la semaine
 * visée et dit « Les dates de la semaine ont changé : touchez de nouveau le plat. ».
 * T4-0 : « ✨ Proposer 4 plats » (actions.proposerALaSemaine, `feuille: true`) ferme la feuille juste avant d'écrire,
 * puis `onFermer({ viser })` reçoit le premier plat proposé ; « chevauche » : rien n'est écrit, la feuille reste
 * ouverte, recalcule sa semaine visée et dit « … touchez de nouveau « Proposer ». ». « 🍰 Proposer des desserts » ferme
 * la feuille, puis `onFermer({ desserts: { cible, restes, garderRestes } })` : l'écran ouvre « Combien de desserts ? »
 * (ouvrirDesserts) sur la même semaine visée et le même choix des restes. `apresAnnulation` : passé à l'action (focus
 * après « Annuler »).
 * → { maj(ctx), fermer }
 */
export function ouvrirChoixDesPlats(lireCtx, { onFermer, apresAnnulation = null } = {}) {
  if (feuilleOuverte) return feuilleOuverte;
  let courant = lireCtx();
  let cible = null; // semaine visée, figée dès que les semaines sont lues
  let surAutre = false; // « Ajouter plutôt à la semaine qui finit le 16 »
  let restes = []; // articles pas pris de la semaine qui finit, figés avec la cible
  let garderRestes = true;
  let restesUtilises = false; // partis avec le premier plat (la semaine est créée)
  let recherche = '';
  let filtre = FILTRES_CHOIX[0].id;
  let ouverte = true;
  let focusApres = null; // plat créé ici : sa case reçoit le focus dès qu'elle apparaît
  const ajoutes = new Set(); // plats ajoutés pendant cette ouverture (et pas retirés depuis)
  const enAttente = new Map(); // `<semaine>|<plat>` → coché ou non, en attendant que la semaine le montre
  // T4-0, figés avec la cible : « ✨ Proposer N plats » (semaine visée sans plat), la ligne qui le remplace, « 🍰 ».
  let proposerFige = null; // { plats, ligne, desserts }
  let suite = null; // transmis à onFermer : { viser } ou { desserts }

  // ——— Nœuds ———
  const sousTitre = el('p', { class: 'sous-titre-feuille' });
  const proposer = boutonEmoji('bouton bouton-principal bouton-plein bouton-proposer', TEXTES_PROPOSER.emoji, toucherProposer);
  proposer.bouton.hidden = true;
  const ligneSansProposition = el('p', { class: 'texte-doux ligne-sans-proposition', hidden: true });
  const statutProposer = el('p', { class: 'message-proposer', role: 'status', hidden: true });
  const desserts = boutonEmoji('bouton bouton-secondaire bouton-plein bouton-desserts', TEXTES_PROPOSER.desserts.emoji,
    toucherDesserts);
  ecrireTexte(desserts.libelle, TEXTES_PROPOSER.desserts.libelle);
  desserts.bouton.hidden = true;
  const texteRestes = el('p', {});
  const boutonRestes = el('button', {
    class: 'bouton bouton-texte bouton-restes',
    type: 'button',
    onclick: () => {
      garderRestes = !garderRestes;
      dessiner();
    },
  });
  const blocRestes = el('div', { class: 'bloc-restes', hidden: true }, texteRestes, boutonRestes);
  const boutonAutre = el('button', {
    class: 'bouton bouton-texte bouton-autre-semaine',
    type: 'button',
    hidden: true,
    onclick: () => {
      surAutre = !surAutre;
      dessiner();
      boutonAutre.focus();
    },
  });
  const champ = el('input', {
    class: 'champ champ-recherche',
    type: 'search',
    placeholder: 'Rechercher un plat',
    'aria-label': 'Rechercher un plat',
    autocomplete: 'off',
    enterkeyhint: 'search',
    oninput: () => {
      recherche = champ.value;
      erreur.hidden = true;
      dessiner();
    },
    onkeydown: (evenement) => {
      if (evenement.key === 'Enter') {
        evenement.preventDefault();
        champ.blur();
      }
    },
  });
  const puces = FILTRES_CHOIX.map((f) => el('button', {
    class: 'puce',
    type: 'button',
    'aria-pressed': String(f.id === filtre),
    onclick: () => {
      filtre = f.id;
      for (const [i, puce] of puces.entries()) puce.setAttribute('aria-pressed', String(FILTRES_CHOIX[i].id === filtre));
      dessiner();
    },
  }, f.libelle));
  const chargement = el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…');
  const titrePreferes = el('h3', { class: 'titre-choix' });
  const listePreferes = el('ul', { class: 'liste-choix' });
  const blocPreferes = el('section', { class: 'bloc-choix' }, titrePreferes, listePreferes);
  const listeTous = el('ul', { class: 'liste-choix' });
  const blocTous = el('section', { class: 'bloc-choix' }, el('h3', { class: 'titre-choix' }, 'Tous les plats'), listeTous);
  const rien = el('p', { class: 'texte-doux', hidden: true });
  // Nom d'un plat de la corbeille : il se remet depuis sa fiche (jamais « ＋ Nouveau plat », voué à l'échec).
  const texteCorbeille = el('span', {});
  const lienCorbeille = el('a', { class: 'lien-fiche', onclick: () => fermer() }, 'Voir le plat ›');
  const blocCorbeille = el('p', { class: 'texte-doux choix-corbeille', hidden: true }, texteCorbeille, ' ', lienCorbeille);
  const libelleNouveau = el('span', {});
  const boutonNouveau = el('button', {
    class: 'bouton bouton-secondaire bouton-plein bouton-nouveau-plat',
    type: 'button',
    hidden: true,
    onclick: creerNouveau,
  }, el('span', { 'aria-hidden': 'true' }, '＋'), libelleNouveau);
  const erreur = el('div', { class: 'message-erreur message-choix', role: 'alert', hidden: true });
  const listes = el('div', { class: 'listes-choix' }, blocPreferes, blocTous, rien, blocCorbeille, boutonNouveau, erreur);
  const boutonTermine = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: () => fermer() });

  const feuille = ouvrirFeuille('Ajouter à la semaine', () => el('div', { class: 'feuille-choix' },
    sousTitre,
    proposer.bouton,
    ligneSansProposition,
    statutProposer,
    desserts.bouton,
    blocRestes,
    boutonAutre,
    el('div', { class: 'choix-entete' },
      champ,
      el('div', { class: 'puces', role: 'group', 'aria-label': 'Afficher' }, puces)),
    chargement,
    listes,
    el('div', { class: 'feuille-pied' }, boutonTermine)), {
    onFermer: () => {
      ouverte = false;
      if (feuilleOuverte === handle) feuilleOuverte = null;
      onFermer?.(suite);
    },
  });

  // ——— Outils ———

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  const pret = () => Boolean(courant.semainesChargees && courant.platsCharges !== false);

  /** Semaine où vont les plats : la cible figée, ou la semaine qui finit (« Ajouter plutôt à… »). */
  function cibleActive() {
    if (!cible) return null;
    return surAutre && cible.autre ? { ...cible.autre, nouvelle: false, autre: null } : cible;
  }

  /** Fige la cible (et les restes) dès que les semaines sont lues. */
  function figerCible() {
    if (cible || !courant.semainesChargees) return;
    cible = semaineVisee(courant.semaines ?? [], courant.aujourdhui);
    restes = restesPour(courant, cible);
    figerProposition();
  }

  /**
   * « ✨ Proposer N plats » et « 🍰 Proposer des desserts », figés une fois (première cible lue) : ✨ seulement si la
   * semaine visée n'a aucun plat actif (sinon jamais, même vidée ensuite) ; avec moins de 2 plats proposables, la ligne
   * qui dit pourquoi (texteSansProposition) prend sa place ; 🍰 si au moins un dessert est proposable.
   */
  function figerProposition() {
    if (proposerFige || !cible || !pret() || courant.profilsCharges === false) return;
    const apercu = courant.proposition?.apercu?.(reduireCible(cible)) ?? null;
    if (!apercu) return;
    const document = (courant.semaines ?? []).find((s) => s?.id === cible.id) ?? null;
    const actifs = document
      ? platsDeLaSemaineDe(courant, document).filter((e) => e.etat === 'ok' || e.etat === 'sansRecette').length : 0;
    const sansPlat = actifs === 0;
    proposerFige = {
      plats: sansPlat ? apercu.plats : 0,
      ligne: sansPlat && !apercu.plats
        ? texteSansProposition(apercu.cause, { moi: courant.moi ?? null, profils: courant.profils ?? [], profilCause: apercu.profilCause })
        : null,
      desserts: apercu.desserts > 0,
    };
    proposer.bouton.hidden = !proposerFige.plats;
    if (proposerFige.plats) ecrireTexte(proposer.libelle, libelleProposer({ plats: proposerFige.plats }).libelle);
    ecrireTexte(ligneSansProposition, proposerFige.ligne ?? '');
    ligneSansProposition.hidden = !proposerFige.ligne;
    desserts.bouton.hidden = !proposerFige.desserts;
  }

  /** Message sous « ✨ » (role="status") ; null le cache. */
  function direProposer(texte) {
    ecrireTexte(statutProposer, texte ?? '');
    statutProposer.hidden = !texte;
  }

  const restesChoisis = () => (!surAutre && !restesUtilises && garderRestes ? restes : []);

  /**
   * « ✨ Proposer N plats » : la feuille se ferme juste avant l'écriture (le premier plat proposé reçoit le focus) ;
   * « chevauche » : rien n'est écrit, la feuille reste et recalcule sa semaine visée ; rien à proposer : « Plus d’autre
   * idée pour l’instant. ».
   */
  function toucherProposer() {
    const visee = cibleActive();
    if (!visee || !proposerFige?.plats) return;
    direProposer(null);
    const resultat = courant.actions?.proposerALaSemaine?.({
      cible: reduireCible(visee),
      restes: restesChoisis(),
      nombreAnnonce: proposerFige.plats,
      feuille: true,
      apresAnnulation,
      avant: (premier) => {
        suite = premier ? { viser: premier } : null;
        fermer();
      },
    });
    if (resultat?.code === 'ok' || resultat?.code === 'peu') {
      vibrer();
      return;
    }
    if (!ouverte) return;
    if (resultat?.code === 'chevauche') {
      recalculerCible(TEXTES_PROPOSER.erreurs.chevauche);
      dessiner();
    } else if (resultat?.code === 'complet') {
      // L'autre téléphone (ou des cases cochées) ont rempli la semaine depuis l'ouverture : les cases le montrent.
      direProposer(TEXTES_PROPOSER.complet);
    } else if (resultat?.code === 'aucun' || resultat?.code === 'vide') {
      direProposer(TEXTES_PROPOSER.autreIdee.aucune);
    }
  }

  /** « 🍰 Proposer des desserts » : la feuille se ferme, puis l'écran ouvre « Combien de desserts ? » (onFermer). */
  function toucherDesserts() {
    const visee = cibleActive();
    if (!visee) return;
    const apercu = courant.proposition?.apercu?.(reduireCible(visee)) ?? null;
    if (!apercu?.desserts) {
      direProposer(TEXTES_PROPOSER.autreIdee.aucune);
      return;
    }
    suite = { desserts: { cible: reduireCible(visee), restes: restesChoisis(), garderRestes: !surAutre && garderRestes } };
    fermer();
  }

  function semaineDeLaCible() {
    const visee = cibleActive();
    if (!visee) return null;
    return lireSemaine((courant.semaines ?? []).find((s) => s?.id === visee.id)) ?? null;
  }

  function coche(platId) {
    const visee = cibleActive();
    const cle = `${visee?.id}|${platId}`;
    if (enAttente.has(cle)) return enAttente.get(cle);
    return estDansLaSemaine(semaineDeLaCible()?.plats?.[platId]);
  }

  /** Attentes rejointes par la semaine reçue : la semaine fait foi à nouveau. */
  function oublierAttentes() {
    const visee = cibleActive();
    const semaine = semaineDeLaCible();
    for (const [cle, voulu] of [...enAttente]) {
      const [id, platId] = cle.split('|');
      if (id === visee?.id && estDansLaSemaine(semaine?.plats?.[platId]) === voulu) enAttente.delete(cle);
    }
  }

  const echoue = (code) => ['chargement', 'invalide', 'refuse', 'echec', 'chevauche'].includes(code);

  /**
   * La semaine visée, figée à l'ouverture, touche désormais une semaine qui a des plats (dates changées sur l'autre
   * téléphone) : rien n'a été écrit ; la semaine visée est recalculée (le sous-titre dit ses dates) et la feuille le dit.
   */
  function recalculerCible(texteProposer = null) {
    cible = null;
    surAutre = false;
    restesUtilises = false;
    figerCible();
    if (texteProposer) {
      direProposer(texteProposer);
      return;
    }
    erreur.replaceChildren(el('span', {}, TEXTE_DATES_CHANGEES));
    erreur.hidden = false;
  }

  function basculer(platId, input) {
    const visee = cibleActive();
    if (!visee) {
      input.checked = !input.checked;
      return;
    }
    vibrer();
    const cle = `${visee.id}|${platId}`;
    if (input.checked) {
      const avecRestes = !surAutre && !restesUtilises && garderRestes ? restes : [];
      const resultat = courant.actions?.ajouterALaSemaine?.(platId, { cible: visee, restes: avecRestes, silencieux: true });
      if (echoue(resultat?.code)) {
        input.checked = false;
        if (resultat?.code === 'chevauche') {
          recalculerCible();
          dessiner();
        }
        return;
      }
      if (visee.nouvelle || resultat?.creee) restesUtilises = true;
      ajoutes.add(platId);
      enAttente.set(cle, true);
      erreur.hidden = true;
    } else {
      const resultat = courant.actions?.retirerDeLaSemaine?.(platId, { semaineId: visee.id, silencieux: true });
      if (echoue(resultat?.code)) {
        input.checked = true;
        return;
      }
      // La semaine suivante est de nouveau vide : ses restes sont partis avec le plat, le premier plat les rapportera.
      if (resultat?.vide && visee.nouvelle) restesUtilises = false;
      ajoutes.delete(platId);
      enAttente.set(cle, false);
    }
    dessiner();
  }

  /** « ＋ Nouveau plat : « Tarte tatin » » : le plat est créé (⏳), puis ajouté à la semaine visée. */
  function creerNouveau() {
    const nom = platsAChoisir(courant.tousLesPlats ?? courant.plats ?? [], { recherche }).nouveau;
    if (!nom) return;
    const resultat = courant.actions?.ajouterPlat?.(nom);
    if (!resultat || resultat.erreur) {
      const lienId = resultat?.existant ?? resultat?.corbeille ?? null;
      erreur.replaceChildren(
        el('span', {}, resultat?.erreur ?? 'Le plat n’a pas pu être ajouté. Réessayez.'),
        lienId
          ? el('a', {
            class: 'bouton bouton-secondaire bouton-plein lien-erreur',
            href: `#/plat/${encodeURIComponent(lienId)}`,
            onclick: () => fermer(),
          }, 'Voir sa fiche ›')
          : null,
      );
      erreur.hidden = false;
      return;
    }
    const visee = cibleActive();
    if (visee) {
      const avecRestes = !surAutre && !restesUtilises && garderRestes ? restes : [];
      const ajout = courant.actions?.ajouterALaSemaine?.(resultat.id, { cible: visee, restes: avecRestes, silencieux: true });
      if (!echoue(ajout?.code)) {
        if (visee.nouvelle || ajout?.creee) restesUtilises = true;
        ajoutes.add(resultat.id);
        enAttente.set(`${visee.id}|${resultat.id}`, true);
      } else if (ajout?.code === 'chevauche') recalculerCible();
    }
    vibrer();
    focusApres = resultat.id;
    dessiner();
  }

  // ——— Lignes ———

  const lignes = new WeakMap(); // li → { input, nom, detail, visuel, compat, plat, profils }

  function creerLigne(plat) {
    const input = el('input', { class: 'case-choix', type: 'checkbox', 'data-plat': plat.id });
    input.addEventListener('change', () => basculer(plat.id, input));
    const visuel = el('span', { class: 'choix-plat-visuel' });
    const nom = el('span', { class: 'choix-plat-nom' });
    const sansRecette = el('span', { class: 'choix-sans-recette' }, ' · sans recette');
    const detail = el('span', { class: 'choix-plat-detail' });
    const compat = el('span', { class: 'choix-plat-compat' });
    const li = el('li', {},
      el('label', { class: 'ligne-choix' }, input, visuel,
        el('span', { class: 'choix-plat-texte' }, el('span', {}, nom, sansRecette), detail, compat)));
    lignes.set(li, { input, nom, sansRecette, detail, visuel, compat, plat: null, ctx: null });
    majLigne(li, plat);
    return li;
  }

  function majLigne(li, plat) {
    const ligne = lignes.get(li);
    ligne.input.checked = coche(plat.id);
    if (ligne.plat === plat && ligne.ctx === courant.compat && ligne.profils === courant.profils && ligne.role === courant.role) return;
    ligne.plat = plat;
    ligne.ctx = courant.compat;
    ligne.profils = courant.profils;
    ligne.role = courant.role;
    ecrireTexte(ligne.nom, nomDuPlat(plat));
    ligne.sansRecette.hidden = aSaRecette(plat);
    ligne.visuel.replaceChildren(vignetteDuPlat(plat));
    const mode = modeDeCuisson(plat);
    ligne.detail.replaceChildren(...(mode ? [mode] : []));
    ligne.detail.hidden = !mode;
    const compat = ligneCompat(plat, courant);
    ligne.compat.replaceChildren(...(compat ? [compat] : []));
    ligne.compat.hidden = !compat;
  }

  // ——— Dessin ———

  function dessiner() {
    figerCible();
    figerProposition();
    const visee = cibleActive();
    ecrireTexte(sousTitre, visee ? `Pour la semaine ${texteDates(visee.debut, visee.fin)}` : '');
    sousTitre.hidden = !visee;

    // Restes : seulement vers une semaine qui va naître, avant le premier plat.
    const montrerRestes = Boolean(visee?.nouvelle) && !surAutre && !restesUtilises && restes.length > 0;
    blocRestes.hidden = !montrerRestes;
    if (montrerRestes) {
      ecrireTexte(texteRestes, phraseDesRestes(restes, garderRestes));
      ecrireTexte(boutonRestes, garderRestes ? 'Ne pas les garder' : 'Les garder');
    }

    // « Ajouter plutôt à la semaine qui finit le 16 » / « Revenir à la semaine du 17 au 23 ».
    boutonAutre.hidden = !cible?.autre;
    if (cible?.autre) {
      ecrireTexte(boutonAutre, surAutre
        ? `Revenir à la semaine ${datesCourtes(cible)}`
        : `Ajouter plutôt à la semaine qui finit le ${texteJour(cible.autre.fin, { mois: false })}`);
    }

    const charge = pret() && Boolean(visee);
    chargement.hidden = charge;
    listes.hidden = !charge;
    if (charge) {
      oublierAttentes();
      // Tous les plats, corbeille comprise : un nom de la corbeille mène à sa fiche, jamais à « ＋ Nouveau plat ».
      const choix = platsAChoisir(courant.tousLesPlats ?? courant.plats ?? [], {
        moi: courant.moi ?? null, profils: courant.profils ?? [], recherche, filtre,
      });
      ecrireTexte(titrePreferes, choix.titrePreferes);
      reconcilier(listePreferes, choix.preferes, { cle: (p) => p.id, creer: creerLigne, maj: majLigne });
      blocPreferes.hidden = !choix.preferes.length;
      reconcilier(listeTous, choix.tous, { cle: (p) => p.id, creer: creerLigne, maj: majLigne });
      blocTous.hidden = !choix.tous.length;
      let texteRien = '';
      if (choix.aucun) texteRien = 'Aucun plat ne s’appelle ainsi.';
      else if (!choix.preferes.length && !choix.tous.length && !choix.corbeille) texteRien = 'Aucun plat ici pour l’instant.';
      ecrireTexte(rien, texteRien);
      rien.hidden = !texteRien;
      blocCorbeille.hidden = !choix.corbeille;
      if (choix.corbeille) {
        ecrireTexte(texteCorbeille, `«\u00A0${nomDuPlat(choix.corbeille)}\u00A0» est dans la corbeille\u00A0: remettez-le depuis sa fiche.`);
        const href = `#/plat/${encodeURIComponent(choix.corbeille.id)}`;
        if (lienCorbeille.getAttribute('href') !== href) lienCorbeille.setAttribute('href', href);
      }
      boutonNouveau.hidden = !choix.nouveau;
      if (choix.nouveau) ecrireTexte(libelleNouveau, `Nouveau plat\u00A0: «\u00A0${choix.nouveau}\u00A0»`);
      if (focusApres) {
        const case_ = listes.querySelector(`input[data-plat="${CSS.escape(focusApres)}"]`);
        if (case_) {
          focusApres = null;
          case_.focus();
        }
      }
    }

    const n = ajoutes.size;
    ecrireTexte(boutonTermine, n ? `Terminé · ${n}\u00A0${n > 1 ? 'plats ajoutés' : 'plat ajouté'}` : 'Terminé');
  }

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      dessiner();
    },
    fermer,
  };
  feuilleOuverte = handle;
  dessiner();
  return handle;
}

// ——— « Combien de desserts ? » (T4-0, D6) ———

/**
 * Feuille « Combien de desserts ? », ouverte par « 🍰 Proposer des desserts » (Semaine, sous « ＋ Choisir d'autres
 * plats », ou feuille « Ajouter à la semaine ») sur la semaine visée `cible` ({ id, debut, fin }) et avec les `restes`
 * choisis (partent seulement si la semaine n'a encore aucun plat, comme une case cochée). Sous-titre « Pour cette
 * semaine. » ou « Pour la semaine du 17 au 23 octobre. » ; boutons radio « 1 » à « 4 », limités aux desserts proposables
 * à l'ouverture, préremplis comme la dernière fois (coeur/proposition.js › nombreDeDessertsParDefaut ; rien n'est
 * stocké) ; « Ils s’ajoutent aux plats de la semaine. » ; « 🍰 Proposer 2 desserts » (libellé qui suit le choix) et
 * « Fermer ». Toucher : la feuille se ferme juste avant l'écriture (actions.proposerDessertsALaSemaine, un lot, annonce
 * avec « Annuler » 30 s), puis `onFermer({ viser })` reçoit le premier dessert ajouté ; « chevauche » (dates changées sur
 * l'autre téléphone) : rien n'est écrit, la feuille reste, recalcule sa semaine visée (sous-titre) et dit « Les dates
 * de la semaine ont changé : touchez de nouveau « Proposer ». ». Rien n'est écrit à l'ouverture.
 * → { maj(ctx), fermer }
 */
export function ouvrirDesserts(lireCtx, { cible, restes = [], garderRestes = true, onFermer, apresAnnulation = null } = {}) {
  if (dessertsOuverte) return dessertsOuverte;
  let courant = lireCtx();
  let visee = reduireCible(cible);
  let avecRestes = Array.isArray(restes) ? restes : [];
  let ouverte = true;
  let suite = null;
  const apercu = visee ? courant.proposition?.apercu?.(visee) ?? null : null;
  const disponibles = Math.max(1, Math.min(4, apercu?.desserts ?? 1));
  const depart = Math.min(disponibles, Math.max(1, courant.proposition?.dessertsParDefaut?.(visee) ?? 1));
  dessertsNumero += 1;
  const nom = `desserts-nombre-${dessertsNumero}`;

  const sousTitre = el('p', { class: 'sous-titre-feuille' });
  const radios = Array.from({ length: disponibles }, (_, i) => {
    const input = el('input', { type: 'radio', name: nom, value: String(i + 1), checked: i + 1 === depart });
    return { input, noeud: el('label', { class: 'choix' }, input, el('span', {}, String(i + 1))) };
  });
  const libelle = el('span', {});
  const boutonProposer = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' },
    el('span', { 'aria-hidden': 'true' }, TEXTES_PROPOSER.desserts.emoji), libelle);
  const statut = el('p', { class: 'message-proposer', role: 'status', hidden: true });

  const choisi = () => Number(radios.find((r) => r.input.checked)?.input.value) || depart;

  function dessiner() {
    ecrireTexte(sousTitre, visee ? sousTitreDesserts(visee, courant.aujourdhui) : '');
    sousTitre.hidden = !visee;
    ecrireTexte(libelle, libelleProposerDesserts(choisi()).libelle);
  }

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  function dire(texte) {
    ecrireTexte(statut, texte ?? '');
    statut.hidden = !texte;
  }

  function proposerDesserts(evenement) {
    evenement.preventDefault();
    if (!visee) return;
    dire(null);
    const resultat = courant.actions?.proposerDessertsALaSemaine?.({
      cible: visee,
      restes: avecRestes,
      nombre: choisi(),
      feuille: true,
      apresAnnulation,
      avant: (premier) => {
        suite = premier ? { viser: premier } : null;
        fermer();
      },
    });
    if (resultat?.code === 'ok' || resultat?.code === 'peu') {
      vibrer();
      return;
    }
    if (!ouverte) return;
    if (resultat?.code === 'chevauche') {
      // Semaine visée du moment (les dates de l'autre ont changé) : ses restes, si on les gardait.
      const nouvelle = courant.semainesChargees ? semaineVisee(courant.semaines ?? [], courant.aujourdhui) : null;
      visee = reduireCible(nouvelle);
      avecRestes = garderRestes && nouvelle ? restesPour(courant, nouvelle) : [];
      dessiner();
      dire(TEXTES_PROPOSER.erreurs.chevauche);
    } else if (resultat?.code === 'aucun' || resultat?.code === 'vide') {
      dire(TEXTES_PROPOSER.autreIdee.aucune);
    }
  }

  const feuille = ouvrirFeuille(TEXTES_PROPOSER.desserts.titre, () => el('form', {
    class: 'formulaire feuille-desserts',
    novalidate: true,
    onsubmit: proposerDesserts,
    onchange: () => {
      dire(null);
      dessiner();
    },
  },
  sousTitre,
  el('fieldset', { class: 'groupe-choix' },
    el('legend', { class: 'visuellement-masque' }, TEXTES_PROPOSER.desserts.titre),
    el('div', { class: `choix-ligne${disponibles === 4 ? ' choix-quatre' : disponibles === 3 ? ' choix-trois' : ''}` },
      radios.map((r) => r.noeud))),
  el('p', { class: 'aide' }, TEXTES_PROPOSER.desserts.aide),
  el('div', { class: 'actions-feuille' },
    boutonProposer,
    statut,
    el('button', { class: 'bouton bouton-texte', type: 'button', onclick: () => fermer() }, TEXTES_PROPOSER.desserts.fermer))), {
    onFermer: () => {
      ouverte = false;
      if (dessertsOuverte === handle) dessertsOuverte = null;
      onFermer?.(suite);
    },
  });

  const handle = {
    maj(ctx) {
      if (!ouverte) return;
      courant = ctx;
      dessiner();
    },
    fermer,
  };
  dessertsOuverte = handle;
  dessiner();
  return handle;
}
