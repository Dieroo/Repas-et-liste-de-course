// Présentation de première ouverture (T6-0, route `#/accueil` ; l'écran dit « présentation ») : « Bienvenue, <Prénom> »,
// ce que fait l'app en trois lignes, puis « C’est parti » vers Semaine, dont la carte « prochaine action » dit la suite.
// « Qui êtes-vous ? » vient avant, seulement si la personne n'est pas reconnue. Rien n'est écrit dans Firestore, sauf
// « C’est moi » (transaction existante, au toucher). Les écrans sont construits une fois puis montrés ou cachés ; la
// suite des écrans est décidée une fois, sur des prénoms lus sur le serveur (ou hors ligne), puis figée.
import { el, pastille } from './dom.js';
import { carteQuiEtesVous } from './relier.js';
import {
  TEXTES_ACCUEIL, etatBienvenue, ecransAccueil, titreBienvenue, titreRelier,
} from '../coeur/accueil.js';
import { profilsARelier } from '../coeur/profils.js';

// Attente du serveur quand les prénoms ne viennent que de la copie du téléphone (en ligne).
const ATTENTE_CONFIRMATION_MS = 3000;

let compteur = 0;

/** Bouton dont l'emoji est à part (`span aria-hidden`), jamais porteur de sens. */
function boutonEmoji(classe, emoji, libelle, attributs = {}) {
  return el('button', { class: `bouton bouton-plein ${classe}`, type: 'button', ...attributs },
    el('span', { 'aria-hidden': 'true' }, emoji), el('span', {}, libelle));
}

/** Écrit un texte seulement s'il change (le nœud lu par TalkBack n'est pas réécrit pour rien). */
function ecrire(noeud, texte) {
  if (noeud.textContent !== texte) noeud.textContent = texte;
}

/**
 * Écran de la présentation. `ctx` : contexte de l'app (`roleReel`, `moi`, `profils`, `profilsCharges`,
 * `profilsDepuisCache`, `enLigne`, `reglages`, `actions.quitterAccueil`, `actions.relierProfil`).
 * → { noeud, maj(ctx), detruire() }
 */
export function creer(ctx) {
  compteur += 1;
  const idAide = `accueil-aide-${compteur}`;
  let courant = ctx;
  let ecrans = null; // suite figée des écrans, null tant qu'elle n'est pas décidée
  let ecranCourant = 'chargement';
  let attenteFinie = false;
  let relierIci = false; // « C’est moi » touché ici : sa réponse mène à « bienvenue », pas à « C’est fait »
  let actionsEnveloppees = null;
  let actionsSource = null;
  const minuteur = setTimeout(() => {
    attenteFinie = true;
    rafraichir();
  }, ATTENTE_CONFIRMATION_MS);

  // ——— Chargement ———
  const titreChargement = el('h1', { tabindex: '-1' }, TEXTES_ACCUEIL.titreChargement);
  const ecranChargement = el('section', { class: 'accueil-ecran' }, titreChargement);

  // ——— « Qui êtes-vous ? » ———
  const titreRelie = el('h1', { tabindex: '-1' });
  const phraseRelier = el('p', { class: 'accueil-phrase' });
  const reconnue = el('p', { class: 'accueil-reconnue', role: 'status', hidden: true });
  const boutonSuite = el('button', { type: 'button', onclick: () => montrer('bienvenue') });
  // La carte reçoit un contexte dont `relierProfil` note le toucher fait ici.
  const carte = carteQuiEtesVous(contexteCarte(ctx), {
    dansAccueil: true,
    surRelie: () => {
      relierIci = false;
      montrer('bienvenue');
    },
  });
  const ecranRelier = el('section', { class: 'accueil-ecran', hidden: true },
    titreRelie, phraseRelier, carte.noeud, reconnue, boutonSuite);

  // ——— Bienvenue ———
  const titreAccueil = el('h1', { tabindex: '-1' });
  const lignes = el('ul', { class: 'accueil-liste' },
    TEXTES_ACCUEIL.lignes.map(({ emoji, nom, texte }) => el('li', {},
      pastille(emoji),
      el('div', { class: 'carte-texte' }, el('strong', {}, nom), el('p', {}, texte)))));
  const ligneApercu = el('p', { class: 'texte-doux', hidden: true }, TEXTES_ACCUEIL.apercu);
  const boutonDecouvrir = boutonEmoji('bouton-secondaire', TEXTES_ACCUEIL.decouvrirEmoji, TEXTES_ACCUEIL.decouvrir, {
    'aria-describedby': idAide,
    onclick: () => courant.actions.quitterAccueil({ route: 'decouvrir' }),
  });
  const ecranBienvenue = el('section', { class: 'accueil-ecran', hidden: true },
    pastille('🍲'),
    titreAccueil,
    el('p', { class: 'accueil-phrase' }, TEXTES_ACCUEIL.phraseBienvenue),
    lignes,
    ligneApercu,
    el('div', { class: 'accueil-decouvrir' },
      boutonDecouvrir,
      el('p', { class: 'aide', id: idAide }, TEXTES_ACCUEIL.aideDecouvrir)));

  // ——— Barre du bas : « C’est parti », loin de la carte du haut de Semaine ———
  const boutonParti = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    onclick: () => courant.actions.quitterAccueil({ route: 'semaine', signaler: true }),
  }, TEXTES_ACCUEIL.cestParti);
  const barre = el('div', { class: 'barre-enregistrer' }, el('div', { class: 'barre-enregistrer-contenu' }, boutonParti));

  const noeud = el('div', { class: 'vue accueil' }, ecranChargement, ecranRelier, ecranBienvenue, barre);

  const sections = { chargement: ecranChargement, relier: ecranRelier, bienvenue: ecranBienvenue };
  const titres = { chargement: titreChargement, relier: titreRelie, bienvenue: titreAccueil };

  /** Contexte de la carte : `relierProfil` enveloppé (même objet tant que les actions de l'app ne changent pas). */
  function contexteCarte(c) {
    if (c.actions !== actionsSource) {
      actionsSource = c.actions;
      actionsEnveloppees = {
        ...c.actions,
        relierProfil: async (...args) => {
          relierIci = true;
          let resultat;
          try {
            resultat = await actionsSource.relierProfil(...args);
          } catch (erreur) {
            relierIci = false;
            throw erreur;
          }
          // Réussi : `surRelie` mène à « bienvenue » ; sinon la carte dit pourquoi et l'écran reste.
          if (resultat?.code !== 'ok') relierIci = false;
          return resultat;
        },
      };
    }
    return { ...c, actions: actionsEnveloppees };
  }

  function etatCourant() {
    return etatBienvenue({
      roleReel: courant.roleReel,
      moi: courant.moi,
      profilsCharges: courant.profilsCharges,
      confirmes: !courant.profilsDepuisCache || !courant.enLigne || attenteFinie,
    });
  }

  /** Montre un écran ; le focus va à son titre, la page remonte en haut. */
  function montrer(nom, { focaliser = true } = {}) {
    if (nom === ecranCourant) return;
    ecranCourant = nom;
    for (const [cle, section] of Object.entries(sections)) {
      section.hidden = cle !== nom;
    }
    barre.hidden = nom === 'relier';
    if (!noeud.isConnected) return;
    if (focaliser) {
      window.scrollTo(0, 0);
      titres[nom].focus({ preventScroll: true });
    }
  }

  function majRelier() {
    const reglages = courant.reglages;
    const avecPrenom = profilsARelier(courant.profils ?? [], { gestionnaire: reglages?.gestionnaire }).length > 0;
    ecrire(titreRelie, titreRelier(courant.profils, { gestionnaire: reglages?.gestionnaire }));
    ecrire(phraseRelier, avecPrenom ? TEXTES_ACCUEIL.phraseRelier : TEXTES_ACCUEIL.phraseSansPrenom);
    // Reconnue ailleurs pendant cet écran (l'autre téléphone, une adresse saisie entre-temps) : la carte s'efface.
    const faite = Boolean(courant.moi) && !relierIci;
    const focusDansCarte = carte.noeud.contains(document.activeElement);
    carte.noeud.hidden = faite;
    if (faite) ecrire(reconnue, TEXTES_ACCUEIL.reconnue);
    reconnue.hidden = !faite;
    const principal = faite || !avecPrenom;
    const classe = `bouton ${principal ? 'bouton-principal bouton-plein' : 'bouton-texte'}`;
    if (boutonSuite.className !== classe) boutonSuite.className = classe;
    ecrire(boutonSuite, principal ? TEXTES_ACCUEIL.continuer : TEXTES_ACCUEIL.plusTard);
    if (faite && focusDansCarte && ecranCourant === 'relier') boutonSuite.focus();
  }

  function majBienvenue() {
    ecrire(titreAccueil, titreBienvenue(courant.moi));
    ligneApercu.hidden = etatCourant() !== 'apercu';
  }

  function rafraichir() {
    if (!ecrans) {
      const suite = ecransAccueil(etatCourant());
      if (suite) {
        ecrans = suite;
        // Le focus suit le nouvel écran, sauf s'il est sur « C’est parti », qui reste en place.
        const garder = document.activeElement === boutonParti && suite[0] === 'bienvenue';
        montrer(suite[0], { focaliser: !garder });
      }
    }
    carte.maj(contexteCarte(courant));
    majRelier();
    majBienvenue();
  }

  rafraichir();
  // Premier écran : son titre prend le focus une fois l'écran posé (l'app focalise d'abord la zone de l'écran).
  queueMicrotask(() => {
    if (noeud.isConnected) titres[ecranCourant].focus({ preventScroll: true });
  });

  return {
    noeud,
    maj(nouveau) {
      courant = nouveau;
      rafraichir();
    },
    detruire() {
      clearTimeout(minuteur);
    },
  };
}
