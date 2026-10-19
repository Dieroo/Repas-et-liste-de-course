// Écran Semaine (accueil, les deux rôles) : salutation, puis la carte « prochaine action » (le seul bouton principal :
// « ＋ Choisir les plats », « Faire les courses › », « Préparer la semaine du … » ; une fois les courses faites (T3b),
// « Courses faites ✓ » sans bouton principal, sauf « Préparer la semaine du … » les deux derniers jours), puis « Les
// plats de la semaine »
// (une carte par plat : pour qui et combien, Mer / Végétale d'un toucher, conservation ; « En ce moment… » quand la
// semaine suivante est déjà montrée ; plats de la corbeille dits d'une ligne discrète). Pour le gestionnaire (hors
// aperçu « Repas et courses ») : la carte « 🧸🎂 <Enfant> a 5 ans ! » quand des précautions de l'enfant ont passé leur
// âge (T2c-3), la carte « 📬 2 demandes à traiter » (T2e) en tête, et la carte « Idées de plats » en bas.
// Les dates de la semaine (« Du 10 au 16 octobre ») ont leur « Changer » (T3c) : feuille « Les dates de la semaine »,
// « Du » et « Au » natifs, deux semaines au plus, jamais à cheval sur une autre semaine.
// Sous les plats (T3d) : « Chaque semaine aussi : Yaourts maison » (préparations de chaque semaine, qui vont d'elles-mêmes
// dans la liste), avec un interrupteur « Pas cette semaine » par préparation (actions.sauterPreparation).
// T4-0 : semaine sans plat, « ✨ Proposer 4 plats » est le bouton principal de la carte (« ＋ Choisir les plats » passe
// secondaire) ; « 🍰 Proposer des desserts » sous « ＋ Choisir d'autres plats » (D6, feuille « Combien de desserts ? »).
// « 🔄 Changer des plats » entre les deux (2026-10-18, feuille « Changer des plats » : plats cochés, « Par quoi ? »).
// Rien n'est écrit à l'ouverture : chaque section se met à jour en place (`maj`), la liste de courses suit.
import { el, enteteVue, pastille, ecrireTexte, montrerAuDessusDeLAnnonce, reconcilier, vibrer } from './dom.js';
import { prenomDe } from './profil.js';
import { ouvrirFeuille } from './feuille.js';
import { copier } from './presse-papiers.js';
import { partageDUnTextePossible, partagerTexte } from './fichier.js';
import { aujourdhuiDe } from './regime.js';
import { modeDeCuisson } from './pictos.js';
import { vignetteDuPlat } from './plats.js';
import { ouvrirChoixDesPlats, ouvrirDesserts, majChoixDesPlats, prendreChoixDemande } from './choisir-plats.js';
import { ouvrirChangerDesPlats, majChangerDesPlats } from './changer-plats.js';
import {
  creerConservation, creerVersions, listeCourante, majPlatsDeLaSemaine, nomDuPlat, ouvrirPlatDeLaSemaine,
  platsDeLaSemaineDe,
} from './plat-semaine.js';
import {
  IDEES_ENVIE_MAX, IDEES_NOMBRES, IDEES_NOMBRE_DEFAUT, IDEES_PAR_MESSAGE, texteDemandeIdees,
} from '../coeur/claude.js';
import { carteAnniversaire } from '../coeur/age.js';
import {
  TEXTES_DATES, exceptionPlat, feuillePlat, lireSemaine, peutPreparerLaSuivante, resumePlat, semaineEnCours,
  semaineVisee, texteDates, texteErreurDates, texteJour, validerDates,
} from '../coeur/semaine.js';
import { TEXTES_PROPOSER, texteSansProposition } from '../coeur/proposition.js';
import { TEXTES_PLAN_BATCH, empreintePlanBatch, phraseDemandeBatch, texteDemandeBatch } from '../coeur/plan-batch.js';
import {
  TEXTES_T3D, carteProchaineAction, grouperParRayon, ordreRayons, texteChaqueSemaineAussi,
} from '../coeur/liste.js';

const formatDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

// Contexte du dernier écran Semaine monté, mis à jour en direct : les feuilles (« Idées de plats », « Ajouter à la
// semaine », plat de la semaine) lisent les plats, les profils et la semaine du moment, même si l'écran a été
// reconstruit pendant qu'elles étaient ouvertes.
let contexteSemaine = null;
const lireContexte = () => contexteSemaine;

// Nombre et envie de la dernière demande copiée pendant cette visite : la feuille rouverte (copie à refaire) les
// reprend. Rien n'est gardé sur le téléphone.
let derniereDemande = null;

function salutation(maintenant) {
  const heure = maintenant.getHours();
  return heure >= 18 || heure < 5 ? 'Bonsoir' : 'Bonjour';
}

const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);

/** Message après une copie réussie : Claude répond par messages de IDEES_PAR_MESSAGE recettes. */
function messageCopie(nombre) {
  if (nombre > IDEES_PAR_MESSAGE) {
    return `Copié. Collez-le dans une nouvelle conversation de votre projet Claude. Il répondra par ${IDEES_PAR_MESSAGE}\u00A0recettes à la fois\u00A0: collez chaque réponse dans «\u00A0Ajouter des recettes\u00A0», puis écrivez «\u00A0suite\u00A0» à Claude.`;
  }
  return 'Copié. Collez-le dans une nouvelle conversation de votre projet Claude, puis collez sa réponse dans «\u00A0Ajouter des recettes\u00A0».';
}

/**
 * Feuille « Idées de plats » : combien (5, 10, 15), une envie facultative, puis « Copier la demande »
 * (coeur/claude.js › texteDemandeIdees). Après la copie, « Ajouter des recettes › » devient l'action principale ;
 * changer le nombre ou l'envie demande une nouvelle copie.
 */
function ouvrirIdees() {
  ouvrirFeuille('Idées de plats', (fermer) => {
    const depart = derniereDemande ?? { nombre: IDEES_NOMBRE_DEFAUT, envie: '' };
    let copieFaite = false; // une copie a réussi pendant cette ouverture : le lien vers « Ajouter des recettes » reste
    let aJour = false; // la dernière copie correspond au nombre et à l'envie affichés

    const nombres = IDEES_NOMBRES.map((nombre) => el('label', { class: 'choix' },
      el('input', {
        type: 'radio',
        name: 'idees-nombre',
        value: String(nombre),
        checked: nombre === depart.nombre,
      }),
      el('span', {}, String(nombre)),
    ));
    const envie = el('input', {
      class: 'champ',
      id: 'idees-envie',
      name: 'envie',
      maxlength: IDEES_ENVIE_MAX,
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-describedby': 'idees-envie-aide',
      value: depart.envie,
    });
    const message = el('p', { class: 'aide message-idees', role: 'status', hidden: true });
    const boutonCopier = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' },
      el('span', { 'aria-hidden': 'true' }, '📋'), 'Copier la demande');
    const lienAjouter = el('a', {
      class: 'bouton bouton-secondaire bouton-plein',
      href: '#/import',
      hidden: true,
      onclick: fermer,
    }, 'Ajouter des recettes ›');

    /** Avant la copie, l'action principale est « Copier la demande » ; ensuite, « Ajouter des recettes ». */
    function majBoutons() {
      boutonCopier.className = `bouton bouton-plein ${aJour ? 'bouton-secondaire' : 'bouton-principal'}`;
      lienAjouter.className = `bouton bouton-plein ${aJour ? 'bouton-principal' : 'bouton-secondaire'}`;
      lienAjouter.hidden = !copieFaite;
      message.hidden = !message.textContent;
    }

    /** Nombre ou envie changés après une copie : la demande copiée ne leur correspond plus. */
    function changer() {
      if (!aJour && !message.textContent) return;
      aJour = false;
      message.textContent = '';
      majBoutons();
    }

    async function copierDemande(evenement) {
      evenement.preventDefault();
      const ctx = contexteSemaine;
      if (!ctx) return;
      // Sans les plats, « déjà dans l'app » serait vide : Claude pourrait proposer des plats déjà là.
      if (!ctx.platsCharges || !ctx.profilsCharges) {
        aJour = false;
        message.textContent = 'Les plats sont encore en chargement. Réessayez dans un instant.';
        majBoutons();
        return;
      }
      const choisi = nombres.map((choix) => choix.querySelector('input')).find((entree) => entree.checked);
      const nombre = Number(choisi?.value) || IDEES_NOMBRE_DEFAUT;
      // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
      const texte = texteDemandeIdees({
        nombre,
        envie: envie.value,
        // Tous les plats, corbeille comprise : Claude ne repropose pas un plat mis de côté (« déjà dans l'app »).
        plats: ctx.tousLesPlats ?? ctx.plats ?? [],
        profils: ctx.profils ?? [],
        appareils: ctx.reglages?.appareils ?? null,
      });
      const reussi = await copier(texte);
      if (reussi) {
        copieFaite = true;
        aJour = true;
        derniereDemande = { nombre, envie: envie.value };
        message.textContent = messageCopie(nombre);
      } else {
        aJour = false;
        message.textContent = 'La copie n’a pas marché. Réessayez.';
      }
      majBoutons();
    }

    return el('form', {
      class: 'formulaire feuille-idees',
      novalidate: true,
      onsubmit: copierDemande,
      oninput: changer,
      onchange: changer,
    },
    el('fieldset', { class: 'groupe-choix' },
      el('legend', { class: 'etiquette-champ' }, 'Combien\u00A0?'),
      el('div', { class: 'choix-ligne choix-trois' }, nombres),
    ),
    el('label', { class: 'etiquette-champ', for: 'idees-envie' }, 'Une envie\u00A0? (facultatif)'),
    envie,
    el('p', { class: 'aide', id: 'idees-envie-aide' }, 'Par exemple\u00A0: plats d’automne, cuisine du monde…'),
    el('div', { class: 'actions-feuille' },
      boutonCopier,
      message,
      lienAjouter,
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Fermer'),
    ));
  });
}

/** Carte « Idées de plats » (gestionnaire, hors aperçu « Repas et courses »). */
function carteIdees() {
  return el('section', { class: 'carte carte-idees', 'aria-labelledby': 'titre-idees' },
    el('div', { class: 'carte-ligne' },
      pastille('💡', 'ocre'),
      el('div', { class: 'carte-texte' },
        el('h2', { id: 'titre-idees' }, 'Idées de plats'),
        el('p', {}, 'Demandez à Claude des plats originaux, faciles à faire en batch.'),
      ),
    ),
    el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: ouvrirIdees },
      el('span', { 'aria-hidden': 'true' }, '💡'), 'Demander des idées'),
  );
}

/**
 * Carte « 🧸🎂 <Enfant> a 5 ans ! » (gestionnaire, hors aperçu « Repas et courses ») : des précautions d'un enfant ont
 * passé leur âge (coeur/age.js › carteAnniversaire : le premier enfant, dans l'ordre des profils, qui en a). Un résumé
 * seulement : les choix se font sur « 🧸 Ce que <Enfant> mange », et rien ne change sans un toucher. Ne lit aucun plat,
 * n'écrit rien, n'envoie aucune notification. Nœud gardé et mis à jour en place (`maj`) : la carte apparaît en direct
 * (date changée sur l'autre appareil) et disparaît dès qu'aucune précaution n'est à revoir.
 * → { noeud, maj }
 */
function creerCarteAnniversaire(ctx) {
  const titre = el('span', {});
  const lien = el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/reglages' }, 'Voir ses précautions ›');
  const noeud = el('section', { class: 'carte carte-anniversaire', 'aria-labelledby': 'titre-anniversaire', hidden: true },
    el('h2', { id: 'titre-anniversaire' }, el('span', { 'aria-hidden': 'true' }, '🧸🎂\u00A0'), titre),
    el('p', {}, 'Certaines précautions peuvent s’assouplir. Rien ne change sans vous.'),
    lien);

  function maj(c) {
    const carte = c?.role === 'gestionnaire' && c.profilsCharges
      ? carteAnniversaire(c.profils ?? [], aujourdhuiDe(c))
      : null;
    const profil = carte?.profil;
    const nom = String(profil?.nom ?? '').replace(/\s+/g, ' ').trim();
    const age = String(carte?.age ?? '').trim();
    const montrer = Boolean(profil && typeof profil.id === 'string' && profil.id && nom && age);
    noeud.hidden = !montrer;
    if (!montrer) return;
    const texte = `${nom} a ${age}\u00A0!`;
    if (titre.textContent !== texte) titre.textContent = texte;
    const href = `#/regime/${encodeURIComponent(profil.id)}`;
    if (lien.getAttribute('href') !== href) lien.setAttribute('href', href);
    const nomAccessible = `Voir les précautions de ${nom}`;
    if (lien.getAttribute('aria-label') !== nomAccessible) lien.setAttribute('aria-label', nomAccessible);
  }

  maj(ctx);
  return { noeud, maj };
}

/** Nom d'un plat pour un texte d'écran : espaces resserrés. */
const nomCourt = (plat) => String(plat?.nom ?? '').replace(/\s+/g, ' ').trim();

/** « A. », « A et B. », « A, B et C. », « A, B, C et 2 autres. » : au plus trois noms, puis le compte des autres. */
function nomsDesPlats(noms) {
  if (noms.length > 3) {
    const autres = noms.length - 3;
    return `${noms.slice(0, 3).join(', ')} et ${autres}\u00A0${autres > 1 ? 'autres' : 'autre'}.`;
  }
  return noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}.` : `${noms.join('')}.`;
}

/**
 * Carte « 📬 2 demandes à traiter » (T2e, gestionnaire hors aperçu « Repas et courses ») : les demandes encore utiles
 * (`ctx.aTraiter`, coeur/demandes.js › demandesATraiter), les noms de leurs plats et « Voir les demandes › ». Nœud
 * gardé et mis à jour en place (`maj`) : la carte apparaît en direct quand une demande arrive et disparaît dès qu'il
 * n'y a plus rien à traiter. Textes et lien réécrits seulement s'ils changent.
 * → { noeud, maj }
 */
function creerCarteDemandes(ctx) {
  const titre = el('h2', { id: 'titre-demandes' });
  const plats = el('p', {});
  const lien = el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/demandes' }, 'Voir les demandes ›');
  const noeud = el('section', { class: 'carte carte-demandes', 'aria-labelledby': 'titre-demandes', hidden: true },
    el('div', { class: 'carte-ligne' },
      pastille('📬', 'bleu'),
      el('div', { class: 'carte-texte' }, titre, plats)),
    lien);

  function maj(c) {
    const aTraiter = c?.role === 'gestionnaire' && Array.isArray(c.aTraiter) ? c.aTraiter : [];
    // Plan du batch demandé (2026-10-19) : une demande de plus, nommée « Plan du batch ».
    const batch = c?.role === 'gestionnaire' && c.demandeBatch ? 1 : 0;
    const n = aTraiter.length + batch;
    noeud.hidden = n === 0;
    if (!n) return;
    const noms = [
      ...(batch ? [TEXTES_PLAN_BATCH.sectionDemandes] : []),
      ...new Set(aTraiter.map((element) => nomCourt(element?.plat)).filter(Boolean)),
    ];
    const texteTitre = n > 1 ? `${n}\u00A0demandes à traiter` : '1\u00A0demande à traiter';
    if (titre.textContent !== texteTitre) titre.textContent = texteTitre;
    const textePlats = noms.length ? nomsDesPlats(noms) : '';
    if (plats.textContent !== textePlats) plats.textContent = textePlats;
    plats.hidden = !textePlats;
    const nomAccessible = n > 1 ? `Voir les ${n} demandes à traiter` : 'Voir la demande à traiter';
    if (lien.getAttribute('aria-label') !== nomAccessible) lien.setAttribute('aria-label', nomAccessible);
  }

  maj(ctx);
  return { noeud, maj };
}

// ——— Le batch de la semaine (2026-10-19) ———

/** Texte dont le pictogramme de tête (« 📬 ») est montré sans être lu. */
function avecEmojiDeTete(texte) {
  const valeur = String(texte ?? '');
  const trouve = valeur.match(/^(\p{Extended_Pictographic}\uFE0F?)\s*/u);
  return trouve ? [el('span', { 'aria-hidden': 'true' }, `${trouve[1]}\u00A0`), valeur.slice(trouve[0].length)] : [valeur];
}

/**
 * Carte « 👩‍🍳 Le batch de la semaine » (2026-10-19, coeur/plan-batch.js › etatCarteBatch, `ctx.batch`) : visible dès
 * que la semaine montrée a deux plats à cuisiner. Vue « Repas et courses » : « 📬 Demander le plan du batch » (puis
 * « 📬 Demandé aujourd’hui. … »), « 📬 Redemander le plan » quand les plats ont changé. Gestionnaire hors aperçu :
 * « 📤 Envoyer à Claude » (la demande en fichier joint, si le téléphone sait le partager), « 📋 Copier la demande »,
 * « Coller la réponse ». Plan prêt, pour les deux : « Le plan est prêt. Environ 2 h 30, dont 1 h de travail. » et
 * « Commencer le batch › ». Le bouton qui fait avancer est principal seulement quand la carte « prochaine action »
 * n'en a pas (`principal`). Nœuds gardés d'un rendu à l'autre (le focus reste sur le bouton touché).
 * → { noeud, maj(ctx, { principal }) }
 */
function creerCarteBatch(ctx) {
  let courant = ctx;
  let message = ''; // issue de la dernière copie ou du dernier envoi (cette visite)
  let copiee = false; // demande copiée ou envoyée pendant la visite : « Coller la réponse » devient l'étape suivante
  let empreinteCopiee = null; // plats de la demande copiée : s'ils changent, la copie ne vaut plus
  let principalPermis = false;
  const titre = el('h2', { id: 'titre-batch' }, TEXTES_PLAN_BATCH.titreCarteCourt);
  // Focalisable : après « Demander », le bouton disparaît et la phrase « 📬 Demandé… » prend le focus.
  const phrase = el('p', { tabindex: '-1', class: 'phrase-batch' });
  const note = el('p', { class: 'aide' });
  const ligneMessage = el('p', { class: 'aide', role: 'status' });
  const boutonDemander = el('button', { type: 'button', 'data-action': 'demander-batch', onclick: demander });
  const lienCommencer = el('a', { 'data-action': 'commencer-batch' }, TEXTES_PLAN_BATCH.commencer.replace(/\s*›$/u, ''),
    el('span', { 'aria-hidden': 'true' }, '\u00A0›'));
  const boutonEnvoyer = el('button', { type: 'button', 'data-action': 'envoyer-batch', onclick: envoyer },
    ...avecEmojiDeTete(TEXTES_PLAN_BATCH.envoyer));
  const boutonCopier = el('button', { type: 'button', 'data-action': 'copier-batch', onclick: copierDemande },
    ...avecEmojiDeTete(TEXTES_PLAN_BATCH.copier));
  const lienColler = el('a', { href: '#/import', 'data-action': 'coller-batch' }, TEXTES_PLAN_BATCH.coller);
  const actions = el('div', { class: 'actions-carte' }, lienCommencer, boutonDemander, boutonEnvoyer, boutonCopier, lienColler);
  const noeud = el('section', { class: 'carte carte-batch', 'aria-labelledby': 'titre-batch', hidden: true },
    el('div', { class: 'carte-ligne' },
      pastille('👩‍🍳', 'olive'),
      el('div', { class: 'carte-texte' }, titre, phrase)),
    note, actions, ligneMessage);

  const texteDeLaDemande = () => texteDemandeBatch(courant.batch?.elements ?? [], {
    semaine: courant.semaine ?? null, appareils: courant.reglages?.appareils ?? null,
  });

  function demander() {
    const resultat = courant.actions?.demanderPlanBatch?.({
      apresAnnulation: () => {
        if (!boutonDemander.hidden && boutonDemander.isConnected) boutonDemander.focus();
      },
    });
    if (resultat?.code === 'ok' && phrase.isConnected) phrase.focus({ preventScroll: true });
  }

  /** Copie ou envoi réussi : « Coller la réponse » devient l'étape suivante, pour ces plats-là. */
  function noterCopie() {
    copiee = true;
    empreinteCopiee = empreintePlanBatch(courant.batch?.elements ?? []);
  }

  async function copierDemande() {
    if (!courant.batch) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    const reussi = await copier(texteDeLaDemande());
    message = reussi ? TEXTES_PLAN_BATCH.copiee : TEXTES_PLAN_BATCH.copieRatee;
    if (reussi) noterCopie();
    maj(courant, { principal: principalPermis });
  }

  /** « 📤 Envoyer à Claude » : la demande copiée, puis partagée en fichier joint (menu « Partager » d'Android). */
  async function envoyer() {
    const batch = courant.batch;
    if (!batch) return;
    const texte = texteDeLaDemande();
    const reussie = await copier(texte);
    const { issue } = await partagerTexte({ nom: TEXTES_PLAN_BATCH.nomFichier(batch.semaineId), contenu: texte });
    if (issue === 'partage') message = TEXTES_PLAN_BATCH.envoyee;
    else if (issue === 'annule') message = TEXTES_PLAN_BATCH.envoiAnnule;
    else message = reussie ? TEXTES_PLAN_BATCH.copiee : TEXTES_PLAN_BATCH.envoiRate;
    if (issue === 'partage' || reussie) noterCopie();
    maj(courant, { principal: principalPermis });
  }

  /** Bouton montré ou caché, principal ou secondaire. */
  function regler(noeudBouton, montre, principal = false) {
    noeudBouton.hidden = !montre;
    const classe = `bouton bouton-plein ${principal ? 'bouton-principal' : 'bouton-secondaire'}`;
    if (noeudBouton.className !== classe) noeudBouton.className = classe;
  }

  function maj(c, { principal = false } = {}) {
    courant = c;
    principalPermis = principal;
    const carte = c?.batch?.carte;
    noeud.hidden = !carte?.visible;
    if (noeud.hidden) return;
    const gestionnaire = c.role === 'gestionnaire';
    const { etat } = carte;
    // Plats changés depuis la copie (l'autre téléphone) : la réponse de Claude serait refusée ; on le dit.
    if (copiee && empreinteCopiee !== empreintePlanBatch(c.batch.elements)) {
      copiee = false;
      empreinteCopiee = null;
      message = TEXTES_PLAN_BATCH.recopier;
    }
    const partageDispo = gestionnaire && etat !== 'pret' && partageDUnTextePossible();
    let textePhrase = '';
    let texteNote = '';
    if (etat === 'pret') {
      textePhrase = TEXTES_PLAN_BATCH.planPret(carte.duree);
      texteNote = carte.portionsChangees ? TEXTES_PLAN_BATCH.portionsChangees : '';
    } else if (etat === 'demande') {
      textePhrase = phraseDemandeBatch(carte.demande, {
        profils: c.profils ?? [], moi: c.utilisateur?.email ?? null, avecAuteur: gestionnaire, enLigne: navigator.onLine,
      });
      texteNote = gestionnaire ? TEXTES_PLAN_BATCH.invitationGestionnaire : '';
    } else if (etat === 'perime') {
      textePhrase = TEXTES_PLAN_BATCH.perime;
      texteNote = gestionnaire ? TEXTES_PLAN_BATCH.invitationGestionnaire : '';
    } else {
      textePhrase = TEXTES_PLAN_BATCH.invitation(carte.nombre);
      texteNote = gestionnaire ? TEXTES_PLAN_BATCH.invitationGestionnaire : '';
    }
    // Avant « 📤 Envoyer à Claude » : ouvrir d'abord la conversation dans le projet (le partage ne le propose pas).
    if (partageDispo && texteNote === TEXTES_PLAN_BATCH.invitationGestionnaire) texteNote = TEXTES_PLAN_BATCH.guidageEnvoi;
    const vuePhrase = JSON.stringify(textePhrase);
    if (phrase.dataset.vue !== vuePhrase) {
      phrase.dataset.vue = vuePhrase;
      phrase.replaceChildren(...avecEmojiDeTete(textePhrase));
    }
    ecrireTexte(note, texteNote);
    note.hidden = !texteNote;

    const pret = etat === 'pret';
    const demandeur = !gestionnaire && (etat === 'aDemander' || etat === 'perime');
    const pourClaude = gestionnaire && !pret;
    const partage = pourClaude && partageDispo;
    regler(lienCommencer, pret, principal);
    if (pret) {
      const lien = `#/batch/${encodeURIComponent(c.batch.semaineId)}`;
      if (lienCommencer.getAttribute('href') !== lien) lienCommencer.setAttribute('href', lien);
    }
    regler(boutonDemander, demandeur, principal);
    const libelle = etat === 'perime' ? TEXTES_PLAN_BATCH.redemander : TEXTES_PLAN_BATCH.demander;
    if (boutonDemander.dataset.libelle !== libelle) {
      boutonDemander.dataset.libelle = libelle;
      boutonDemander.replaceChildren(...avecEmojiDeTete(libelle));
    }
    regler(boutonEnvoyer, partage, principal && !copiee);
    regler(boutonCopier, pourClaude, principal && !copiee && !partage);
    regler(lienColler, pourClaude, principal && copiee);
    ecrireTexte(ligneMessage, pourClaude ? message : '');
    ligneMessage.hidden = !pourClaude || !message;
  }

  maj(ctx);
  return { noeud, maj };
}

// ——— Les dates de la semaine (T3c) ———

/** Réponse d'une action refusée : { erreur } ou un code autre que « ok ». */
const echoue = (resultat) => !resultat || Boolean(resultat.erreur)
  || (typeof resultat.code === 'string' && resultat.code !== 'ok');

/** Une action peut rendre une valeur ou une promesse : `suite` reçoit la valeur (une promesse rejetée : null). */
function quand(resultat, suite) {
  if (resultat && typeof resultat.then === 'function') resultat.then(suite, () => suite(null));
  else suite(resultat);
}

const ECHEC_DATES = 'Les dates n’ont pas pu être enregistrées. Réessayez.';
let numeroDates = 0;
// Feuille « Les dates de la semaine » ouverte : l'écran Semaine la met à jour à chaque rendu (majDatesDeLaSemaine).
let feuilleDates = null;

/** Met à jour la feuille des dates ouverte avec le contexte du moment. */
function majDatesDeLaSemaine(ctx) {
  feuilleDates?.maj(ctx);
}

/**
 * Feuille « Les dates de la semaine » (« Changer » à côté de « Du 10 au 16 octobre », les deux membres) : « Du » et
 * « Au » (`input type=date` natifs, préremplis), « Deux semaines au plus. », « Enregistrer ». Les erreurs
 * (coeur/semaine.js › validerDates, texteErreurDates : « La fin doit venir après le début. », « Deux semaines au
 * plus. », « Ces dates touchent la semaine du 3 au 9 octobre : choisissez d’autres dates. »…) s'affichent au toucher
 * sur « Enregistrer », jamais pendant la saisie. Mêmes dates : la feuille se ferme sans rien écrire. Une semaine aux
 * courses faites garde ses dates modifiables ; rien d'autre ne change (statut, articles gardés, `derniereFois`).
 * Dates changées ailleurs pendant que la feuille est ouverte (l'autre téléphone) : un champ que la personne n'a pas
 * changé prend la nouvelle date ; « Enregistrer » sans avoir rien changé de ce qu'elle voyait ferme la feuille sans
 * rien écrire (jamais l'ancienne date réécrite par-dessus celle de l'autre membre).
 * Action : changerDates({ debut, fin }, { semaineId }) → { code: 'ok' } | { erreur, avec? } | { code }.
 */
function ouvrirDatesDeLaSemaine(semaineId, { onFermer } = {}) {
  const trouver = (ctx) => lireSemaine((ctx?.semaines ?? []).find((s) => s?.id === semaineId) ?? null)
    ?? (lireSemaine(ctx?.semaine)?.id === semaineId ? lireSemaine(ctx.semaine) : null);
  const depart = trouver(contexteSemaine);
  if (!depart) return;
  numeroDates += 1;
  const base = `dates-${numeroDates}`;
  let ouverte = true;

  const erreur = el('p', { class: 'erreur-champ', id: `${base}-erreur`, role: 'alert', hidden: true });
  const decrit = `${base}-aide ${base}-erreur`;
  const effacerErreur = () => {
    if (erreur.hidden) return;
    erreur.hidden = true;
    erreur.textContent = '';
    du.removeAttribute('aria-invalid');
    au.removeAttribute('aria-invalid');
  };
  const du = el('input', {
    class: 'champ champ-date', type: 'date', id: `${base}-du`, name: 'debut', required: true, value: depart.debut,
    'aria-describedby': decrit, oninput: effacerErreur,
  });
  const au = el('input', {
    class: 'champ champ-date', type: 'date', id: `${base}-au`, name: 'fin', required: true, value: depart.fin,
    'aria-describedby': decrit, oninput: effacerErreur,
  });
  const boutonEnregistrer = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' },
    TEXTES_DATES.enregistrer);
  // Dates de la semaine que montre chaque champ tant que la personne ne l'a pas changé.
  const vues = { debut: depart.debut, fin: depart.fin };

  const feuille = ouvrirFeuille(TEXTES_DATES.titre, (fermer) => el('div', { class: 'feuille-dates' },
    el('form', {
      class: 'formulaire formulaire-dates',
      novalidate: true,
      onsubmit: (evenement) => {
        evenement.preventDefault();
        enregistrer();
      },
    },
    el('label', { class: 'etiquette-champ', for: `${base}-du` }, TEXTES_DATES.du),
    du,
    el('label', { class: 'etiquette-champ', for: `${base}-au` }, TEXTES_DATES.au),
    au,
    el('p', { class: 'aide', id: `${base}-aide` }, TEXTES_DATES.aide),
    erreur,
    el('div', { class: 'feuille-pied' }, boutonEnregistrer)),
    el('div', { class: 'actions-feuille' },
      el('button', { class: 'bouton bouton-texte bouton-plein', type: 'button', onclick: fermer }, 'Fermer'))), {
    onFermer: () => {
      ouverte = false;
      if (feuilleDates === poignee) feuilleDates = null;
      onFermer?.();
    },
  });
  const poignee = {
    /** Dates changées ailleurs : chaque champ que la personne n'a pas changé suit la semaine. */
    maj(ctx) {
      const semaine = ouverte ? trouver(ctx) : null;
      if (!semaine) return;
      for (const [champ, cle] of [[du, 'debut'], [au, 'fin']]) {
        if (champ.value !== vues[cle] || semaine[cle] === vues[cle]) continue;
        champ.value = semaine[cle];
        vues[cle] = semaine[cle];
        effacerErreur();
      }
    },
  };
  feuilleDates = poignee;

  function fermer() {
    if (ouverte) feuille.fermer();
  }

  /** Erreur d'une date : la phrase, les champs en cause marqués, le focus sur le premier. */
  function montrerErreur(resultat) {
    const texte = texteErreurDates(resultat) || ECHEC_DATES;
    erreur.textContent = texte;
    erreur.hidden = false;
    let enCause;
    if (resultat?.erreur === 'vide') enCause = [du, au].filter((champ) => !champ.value);
    else if (resultat?.erreur === 'chevauche') enCause = [du, au];
    else if (resultat?.erreur) enCause = [au];
    else enCause = [];
    for (const champ of [du, au]) {
      if (enCause.includes(champ)) champ.setAttribute('aria-invalid', 'true');
      else champ.removeAttribute('aria-invalid');
    }
    (enCause[0] ?? boutonEnregistrer).focus();
  }

  function enregistrer() {
    const ctx = contexteSemaine;
    if (!trouver(ctx)) {
      fermer();
      return;
    }
    const dates = { debut: du.value, fin: au.value };
    // Rien changé de ce que la personne voyait : rien à écrire, même si la semaine a changé ailleurs entre-temps.
    if (dates.debut === vues.debut && dates.fin === vues.fin) {
      fermer();
      return;
    }
    const verifie = validerDates(dates, { semaines: ctx?.semaines ?? [], id: semaineId, aujourdhui: aujourdhuiDe(ctx) });
    if (verifie.erreur) {
      montrerErreur(verifie);
      return;
    }
    if (verifie.code) {
      // Mêmes dates (rien à écrire) ou semaine illisible : rien à enregistrer.
      fermer();
      return;
    }
    quand(ctx?.actions?.changerDates?.(dates, { semaineId }), (resultat) => {
      if (!ouverte) return;
      if (!echoue(resultat) || resultat?.code === 'inchange') {
        fermer();
        return;
      }
      if (resultat?.code === 'invalide' || resultat?.code === 'refuse') {
        fermer();
        return;
      }
      montrerErreur(resultat?.erreur ? resultat : null);
    });
  }
}

// ——— Carte « prochaine action » ———

/**
 * Carte « prochaine action » (coeur/liste.js › carteProchaineAction) : « Que mange-t-on cette semaine ? » et
 * « ＋ Choisir les plats » (T4-0 : « ✨ Proposer 4 plats » principal et « ＋ Choisir les plats » secondaire quand des plats
 * sont proposables ; sinon, la ligne qui dit pourquoi sous le texte), « Courses : 32 articles » et « Faire les
 * courses › », « Tout est dans le panier 🎉 » et « Dites-le dans Courses quand c'est fini. », puis « Courses faites ✓ »
 * et « Le samedi 10 octobre. Bon appétit ! » (T3b : « Voir la liste › » secondaire, la semaine qu'on cuisine reste à
 * l'écran)… ; les deux derniers jours d'une semaine, « Cette semaine se termine vendredi 16 octobre. » et « Préparer la
 * semaine du 17 au 23 octobre », qui n'écrit rien et ouvre la feuille de choix sur la semaine suivante. Nœuds gardés
 * d'un rendu à l'autre (le focus reste sur le bouton touché ; la classe suit le passage de principal à secondaire).
 * L'emoji d'un bouton est à part (`span aria-hidden`). `choisir(bouton)` : ouvre la feuille « Ajouter à la semaine » ;
 * `proposer(bouton, nombre)` : « ✨ Proposer N plats ».
 * → { noeud, maj(carte) }
 */
function creerCarteAction(choisir, proposer) {
  const visuel = el('div', { class: 'carte-action-visuel' });
  const titre = el('h2', { id: 'titre-prochaine-action' });
  const texte = el('p', {});
  const ligne = el('p', { class: 'ligne-sans-proposition' });
  const fin = el('p', { class: 'fin-semaine' });
  const boutons = el('div', { class: 'actions-carte' });
  const noeud = el('section', { class: 'carte carte-action', 'aria-labelledby': 'titre-prochaine-action' },
    el('div', { class: 'carte-ligne' }, visuel, el('div', { class: 'carte-texte' }, titre, texte, ligne, fin)),
    boutons);
  let emoji = '';
  const parties = new WeakMap(); // bouton → { emoji, libelle, nombre }

  function maj(carte) {
    const voulu = carte.cas === 'choisir' ? '🍲' : carte.cas === 'faites' ? '✅' : '🧺';
    if (voulu !== emoji) {
      emoji = voulu;
      visuel.replaceChildren(pastille(voulu, voulu === '🍲' ? '' : 'olive'));
    }
    ecrireTexte(titre, carte.titre);
    ecrireTexte(texte, carte.texte ?? '');
    texte.hidden = !carte.texte;
    ecrireTexte(ligne, carte.ligne ?? '');
    ligne.hidden = !carte.ligne;
    ecrireTexte(fin, carte.fin ?? '');
    fin.hidden = !carte.fin;
    const classe = (b) => `bouton bouton-plein ${b.principal ? 'bouton-principal' : 'bouton-secondaire'}`;
    reconcilier(boutons, carte.boutons ?? [], {
      cle: (b) => b.action,
      creer: (b) => {
        const morceaux = { emoji: el('span', { 'aria-hidden': 'true' }), libelle: el('span', {}), nombre: null };
        const noeudBouton = b.action === 'courses'
          ? el('a', { class: classe(b), href: '#/courses', 'data-action': b.action }, morceaux.emoji, morceaux.libelle)
          : el('button', { class: classe(b), type: 'button', 'data-action': b.action }, morceaux.emoji, morceaux.libelle);
        parties.set(noeudBouton, morceaux);
        if (b.action === 'proposer') noeudBouton.addEventListener('click', () => proposer(noeudBouton, parties.get(noeudBouton).nombre));
        else if (b.action !== 'courses') noeudBouton.addEventListener('click', () => choisir(noeudBouton));
        majBouton(noeudBouton, b);
        return noeudBouton;
      },
      maj: (n, b) => {
        if (n.className !== classe(b)) n.className = classe(b);
        majBouton(n, b);
      },
    });
    boutons.hidden = !boutons.children.length;
  }

  function majBouton(noeudBouton, b) {
    const morceaux = parties.get(noeudBouton);
    ecrireTexte(morceaux.emoji, b.emoji ?? '');
    morceaux.emoji.hidden = !b.emoji;
    ecrireTexte(morceaux.libelle, b.libelle);
    morceaux.nombre = Number.isInteger(b.nombre) ? b.nombre : null;
  }

  return { noeud, maj };
}

// ——— Cartes des plats de la semaine ———

/**
 * Carte d'un plat de la semaine : une `section` dont le haut est un bouton (vignette, nom, mode de cuisson, « Tout le
 * monde · 2 repas · 5 portions », une ligne d'exception au plus) qui ouvre la feuille du plat ; dessous, le choix Mer /
 * Végétale (deux versions conviennent) ou la version unique, puis la conservation. Jamais de bouton dans un lien,
 * jamais de croix dans la vue « Repas et courses ». → nœud ; `maj` par majCartePlat.
 */
const cartes = new WeakMap(); // nœud → ses parties

/**
 * Ligne de la carte quand personne n'est écarté mais qu'un profil a été coché à la main malgré sa raison (T3c,
 * « Qui en mange ? ») : d'abord un enfant malgré ses précautions (« Enfant : 🧸 pas avant 1 an (miel). » ;
 * gestionnaire avec ❌), puis un profil sans version (« Pas encore de version pour Adulte B : sa part suit la
 * recette. ») : l'avertissement de la feuille reste visible sur la semaine. null sinon.
 */
function avertissementCoche(element, ctx) {
  if (element?.etat !== 'ok') return null;
  const modele = feuillePlat(element, { moi: ctx?.moi ?? null, role: ctx?.role ?? null });
  const coches = (modele?.qui ?? []).filter((q) => q.coche && !q.parDefaut && q.texte);
  return (coches.find((q) => q.raison === 'age') ?? coches.find((q) => q.raison === 'version'))?.texte ?? null;
}

function creerCartePlat(element, ouvrir) {
  const idNom = `plat-semaine-${element.platId}`;
  const visuel = el('span', { class: 'plat-semaine-visuel' });
  const nom = el('span', { class: 'carte-plat-nom', id: idNom });
  const mode = el('span', { class: 'carte-plat-detail' });
  const resume = el('span', { class: 'plat-semaine-resume' });
  const exception = el('span', { class: 'plat-semaine-exception' });
  const bouton = el('button', { class: 'plat-semaine-ouvrir', type: 'button' },
    visuel,
    el('span', { class: 'carte-plat-texte' }, nom, mode, resume, exception),
    el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'));
  bouton.addEventListener('click', () => ouvrir(element.platId, bouton));
  const versions = creerVersions((profilId, style) => contexteSemaine?.actions?.choisirStyle?.(element.platId, profilId, style));
  const conservation = creerConservation();
  const noeud = el('section', { class: 'carte-plat-semaine', 'aria-labelledby': idNom, 'data-plat': element.platId },
    bouton, versions.noeud, conservation.noeud);
  cartes.set(noeud, { visuel, nom, mode, resume, exception, versions, conservation, plat: null });
  majCartePlat(noeud, element);
  return noeud;
}

function majCartePlat(noeud, element) {
  const carte = cartes.get(noeud);
  const ctx = contexteSemaine;
  if (carte.plat !== element.plat) {
    carte.plat = element.plat;
    carte.visuel.replaceChildren(vignetteDuPlat(element.plat));
    const picto = modeDeCuisson(element.plat);
    carte.mode.replaceChildren(...(picto ? [picto] : []));
    carte.mode.hidden = !picto;
  }
  ecrireTexte(carte.nom, nomDuPlat(element.plat));
  const resume = resumePlat(element) ?? '';
  ecrireTexte(carte.resume, resume);
  carte.resume.hidden = !resume;
  const exception = exceptionPlat(element, { moi: ctx?.moi ?? null, role: ctx?.role ?? null })
    ?? avertissementCoche(element, ctx) ?? '';
  ecrireTexte(carte.exception, exception);
  carte.exception.hidden = !exception;
  carte.versions.maj(element.etat === 'ok' ? element : null, ctx);
  carte.conservation.maj(element.etat === 'ok' ? element : null, ctx);
}

/** Ligne discrète d'un plat de la corbeille : « « Gratin » est dans la corbeille : il ne compte plus dans la semaine. ». */
const textesCorbeille = new WeakMap(); // ligne → son texte

function ligneCorbeille(element) {
  const texte = el('span', {});
  const lien = el('a', { class: 'lien-fiche', href: `#/plat/${encodeURIComponent(element.platId)}` }, 'Voir le plat ›');
  const noeud = el('p', { class: 'plat-hors-semaine' }, texte, ' ', lien);
  textesCorbeille.set(noeud, texte);
  majLigneCorbeille(noeud, element);
  return noeud;
}

function majLigneCorbeille(noeud, element) {
  ecrireTexte(textesCorbeille.get(noeud), `«\u00A0${nomDuPlat(element.plat)}\u00A0» est dans la corbeille\u00A0: il ne compte plus dans la semaine.`);
}

/**
 * « En ce moment, jusqu'au 16 octobre : Carbonade, Gratin de pâtes. » (noms en liens vers leur fiche, texte seul) :
 * la semaine en cours quand la suivante est déjà montrée, avec « Changer » (T3c : feuille « Les dates de la semaine »
 * de la semaine en cours, pour la finir plus tôt quand la suivante doit commencer avant). Reconstruite seulement quand
 * elle change (le focus d'un lien ou de « Changer » reste). → { noeud, maj(ctx) }
 */
function creerEnCeMoment() {
  const texte = el('p', { class: 'en-ce-moment', id: 'texte-en-ce-moment' });
  let idEnCours = null;
  const boutonDates = el('button', {
    class: 'bouton bouton-texte bouton-changer-dates',
    type: 'button',
    'aria-label': 'Changer les dates de la semaine en cours',
    'aria-describedby': 'texte-en-ce-moment',
  }, TEXTES_DATES.changer);
  boutonDates.addEventListener('click', () => {
    if (!idEnCours) return;
    ouvrirDatesDeLaSemaine(idEnCours, {
      onFermer: () => {
        if (boutonDates.isConnected && !boutonDates.closest('[hidden]')) boutonDates.focus();
      },
    });
  });
  const noeud = el('div', { class: 'bloc-en-ce-moment', hidden: true }, texte, boutonDates);
  let signature = '';
  function maj(ctx) {
    const enCours = ctx?.semaineEnCours !== undefined ? ctx.semaineEnCours
      : semaineEnCours(ctx?.semaines ?? [], aujourdhuiDe(ctx));
    const lue = lireSemaine(enCours);
    const plats = lue ? platsDeLaSemaineDe(ctx, enCours).filter((e) => e.etat === 'ok' || e.etat === 'sansRecette') : [];
    const nouvelle = lue && plats.length
      ? `${lue.id}|${lue.fin}|${plats.map((e) => `${e.platId}:${nomDuPlat(e.plat)}`).join('|')}` : '';
    idEnCours = nouvelle ? lue.id : null;
    if (nouvelle === signature) return;
    signature = nouvelle;
    noeud.hidden = !nouvelle;
    if (!nouvelle) {
      texte.replaceChildren();
      return;
    }
    const liens = plats.flatMap((e, i) => [
      i ? ', ' : null,
      el('a', { class: 'lien-en-ce-moment', href: `#/plat/${encodeURIComponent(e.platId)}` }, nomDuPlat(e.plat)),
    ]);
    texte.replaceChildren(`En ce moment, jusqu’au ${texteJour(lue.fin)}\u00A0: `, ...liens.filter(Boolean), '.');
  }
  return { noeud, maj };
}

/**
 * « Chaque semaine aussi : Yaourts maison » (T3d) : les préparations de chaque semaine (coeur/liste.js ›
 * preparationsChaqueSemaine, par la liste de la semaine montrée), qui vont d'elles-mêmes dans la liste ; une ligne par
 * préparation, avec l'interrupteur « Pas cette semaine » (actions.sauterPreparation(platId, oui) : `sansHebdo.<platId>`
 * de la semaine montrée). Lignes gardées par leur clé : le focus reste sur l'interrupteur touché. → { noeud, maj(ctx) }
 */
function creerChaqueSemaine() {
  let courant = null;
  const phrase = el('p', { class: 'phrase-chaque-semaine' });
  const lignes = el('ul', { class: 'lignes-maison lignes-chaque-semaine' });
  const noeud = el('div', { class: 'carte carte-chaque-semaine', hidden: true }, phrase, lignes);
  const parties = new WeakMap();
  let numero = 0;
  let seule = false; // une seule préparation : sa ligne dit toute la phrase

  function sauter(platId, input) {
    const oui = input.checked;
    quand(courant?.actions?.sauterPreparation?.(platId, oui), (resultat) => {
      if (echoue(resultat)) input.checked = !oui;
    });
  }

  function creerLigne(preparation) {
    numero += 1;
    const id = `chaque-semaine-${numero}`;
    const platId = preparation.platId;
    const input = el('input', { class: 'interrupteur', type: 'checkbox', role: 'switch', 'aria-describedby': `${id}-detail` });
    input.addEventListener('change', () => sauter(platId, input));
    const nom = el('span', { class: 'maison-nom' });
    const detail = el('span', { class: 'maison-detail', id: `${id}-detail` });
    const li = el('li', {},
      el('label', { class: 'ligne-maison' },
        el('span', { class: 'maison-texte' }, nom, detail),
        el('span', { class: 'maison-bascule' },
          el('span', { class: 'maison-bascule-texte', 'aria-hidden': 'true' }, TEXTES_T3D.pasCetteSemaine),
          input)));
    parties.set(li, { input, nom, detail });
    majLigne(li, preparation);
    return li;
  }

  function majLigne(li, preparation) {
    const { input, nom, detail } = parties.get(li);
    // Une seule préparation : sa ligne porte la phrase elle-même (« Chaque semaine aussi : Yaourts maison »).
    ecrireTexte(nom, seule ? texteChaqueSemaineAussi([preparation]) : preparation.nom);
    // Sans recette, elle n'apporte rien à la liste : on le dit.
    const texte = preparation.sansRecette ? '⏳ Pas encore de recette.' : '';
    ecrireTexte(detail, texte);
    detail.hidden = !texte;
    if (input.checked !== preparation.saute) input.checked = preparation.saute;
    const libelle = `${TEXTES_T3D.pasCetteSemaine}\u00A0: ${preparation.nom}`;
    if (input.getAttribute('aria-label') !== libelle) input.setAttribute('aria-label', libelle);
  }

  function maj(ctx, montree) {
    courant = ctx;
    const preparations = montree ? (listeCourante(ctx)?.preparations ?? []) : [];
    seule = preparations.length === 1;
    // Plusieurs préparations : la phrase, puis une ligne par préparation (son nom et son interrupteur).
    ecrireTexte(phrase, seule ? '' : texteChaqueSemaineAussi(preparations));
    phrase.hidden = seule;
    reconcilier(lignes, preparations, { cle: (p) => p.platId, creer: creerLigne, maj: majLigne });
    noeud.hidden = !preparations.length;
  }

  return { noeud, maj };
}

/**
 * Section « Les plats de la semaine » : titre, dates (« Du 10 au 16 octobre ») et « Changer » (T3c : feuille « Les
 * dates de la semaine »), « En ce moment… », une carte par plat (ordre d'ajout), les plats de la corbeille, puis
 * « ＋ Choisir d'autres plats » (s'il y a déjà un plat et que la semaine ne finit pas dans 2 jours : la carte propose
 * alors « Préparer la semaine du … »).
 * → { noeud, maj(ctx) }
 */
function creerSectionPlats(choisir, ouvrir, desserts, changer) {
  const dates = el('p', { id: 'texte-dates-semaine' });
  const boutonDates = el('button', {
    class: 'bouton bouton-texte bouton-changer-dates',
    type: 'button',
    'aria-label': 'Changer les dates de la semaine',
    'aria-describedby': 'texte-dates-semaine',
  }, TEXTES_DATES.changer);
  boutonDates.addEventListener('click', () => {
    const id = lireSemaine(contexteSemaine?.semaine)?.id;
    if (!id) return;
    ouvrirDatesDeLaSemaine(id, {
      onFermer: () => {
        if (boutonDates.isConnected && !boutonDates.closest('[hidden]')) boutonDates.focus();
      },
    });
  });
  const blocDates = el('div', { class: 'dates-semaine', hidden: true }, dates, boutonDates);
  const enCeMoment = creerEnCeMoment();
  const listeCartes = el('div', { class: 'cartes-plats-semaine' });
  const horsSemaine = el('div', { class: 'plats-hors-semaine' });
  const chaqueSemaine = creerChaqueSemaine();
  const boutonAutres = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', 'data-action': 'autres' },
    el('span', { 'aria-hidden': 'true' }, '＋'), 'Choisir d’autres plats');
  boutonAutres.addEventListener('click', () => choisir(boutonAutres));
  // « 🍰 Proposer des desserts » (T4-0, D6) : sous « ＋ Choisir d'autres plats », même présence et même semaine visée,
  // seulement si un dessert est proposable ; jamais sur la carte « prochaine action ».
  const boutonDesserts = el('button', { class: 'bouton bouton-secondaire bouton-plein bouton-desserts', type: 'button', hidden: true, 'data-action': 'desserts' },
    el('span', { 'aria-hidden': 'true' }, TEXTES_PROPOSER.desserts.emoji), TEXTES_PROPOSER.desserts.libelle);
  boutonDesserts.addEventListener('click', () => desserts(boutonDesserts));
  // « 🔄 Changer des plats » (2026-10-18) : sous « ＋ Choisir d'autres plats », caché avec lui (les deux derniers jours,
  // les plats vont à la semaine suivante), tant que la semaine montrée a un plat qu'on peut changer (plat avec sa
  // recette, avant les courses faites) ; feuille « Changer des plats ».
  const boutonChanger = el('button', { class: 'bouton bouton-secondaire bouton-plein bouton-changer-plats', type: 'button', hidden: true, 'data-action': 'changer' },
    el('span', { 'aria-hidden': 'true' }, TEXTES_PROPOSER.changer.emoji), TEXTES_PROPOSER.changer.libelle);
  boutonChanger.addEventListener('click', () => changer(boutonChanger));
  const noeud = el('section', { class: 'section section-plats-semaine', 'aria-labelledby': 'titre-plats-semaine', hidden: true },
    el('div', { class: 'section-titre' }, el('h2', { id: 'titre-plats-semaine' }, 'Les plats de la semaine'), blocDates),
    enCeMoment.noeud,
    listeCartes,
    horsSemaine,
    chaqueSemaine.noeud,
    boutonAutres,
    boutonChanger,
    boutonDesserts);

  function maj(ctx) {
    const pret = ctx.semainesChargees && ctx.platsCharges !== false && ctx.profilsCharges !== false;
    const lue = pret ? lireSemaine(ctx.semaine) : null;
    const elements = lue ? platsDeLaSemaineDe(ctx) : [];
    const montres = elements.filter((e) => e.etat === 'ok' || e.etat === 'sansRecette');
    const jetes = elements.filter((e) => e.etat === 'corbeille' && e.plat);
    ecrireTexte(dates, lue ? majuscule(texteDates(lue.debut, lue.fin)) : '');
    blocDates.hidden = !lue;
    enCeMoment.maj(pret ? ctx : { ...ctx, semaineEnCours: null });
    // Carte qui a le focus (ou dont la feuille vient de le lui rendre) : si elle disparaît (« Retirer de la semaine »,
    // retrait sur l'autre téléphone), le focus passe à sa voisine, jamais à la page.
    const actif = document.activeElement;
    const carteActive = actif && listeCartes.contains(actif) ? actif.closest('.carte-plat-semaine') : null;
    const ordreAvant = [...listeCartes.children];
    reconcilier(listeCartes, montres, { cle: (e) => e.platId, creer: (e) => creerCartePlat(e, ouvrir), maj: majCartePlat });
    if (ordreAvant.some((n) => !n.isConnected)) ordrePrecedent = ordreAvant.map((n) => n.dataset.plat);
    reconcilier(horsSemaine, jetes, { cle: (e) => e.platId, creer: ligneCorbeille, maj: majLigneCorbeille });
    horsSemaine.hidden = !jetes.length;
    // Préparations de chaque semaine (T3d) : sous les plats, tant que la semaine montrée a des plats.
    chaqueSemaine.maj(ctx, Boolean(lue) && montres.length > 0);
    boutonAutres.hidden = !montres.length || peutPreparerLaSuivante(lue, aujourdhuiDe(ctx));
    boutonDesserts.hidden = boutonAutres.hidden || !(apercuVise(ctx)?.desserts > 0);
    boutonChanger.hidden = boutonAutres.hidden || !(ctx.proposition?.changeables?.(lue?.id)?.length > 0);
    noeud.hidden = !montres.length && !jetes.length && enCeMoment.noeud.hidden;
    if (carteActive && !carteActive.isConnected) focusApresRetrait(ordreAvant.indexOf(carteActive), ordreAvant);
  }

  /** Focus d'une carte partie : la carte suivante, sinon la précédente, sinon « ＋ Choisir d'autres plats », sinon l'action. */
  function focusApresRetrait(position, ordreAvant) {
    const voisine = ordreAvant.slice(position + 1).find((n) => n.isConnected)
      ?? ordreAvant.slice(0, Math.max(0, position)).reverse().find((n) => n.isConnected);
    const visible = (n) => Boolean(n?.isConnected && !n.hidden && !n.closest('[hidden]'));
    const cible = voisine?.querySelector('.plat-semaine-ouvrir')
      ?? (visible(boutonAutres) ? boutonAutres : document.querySelector('.carte-action .actions-carte a, .carte-action .actions-carte button'));
    if (visible(cible)) cible.focus();
  }

  // Ordre des cartes avant le dernier retrait : la feuille d'un plat retiré rend le focus à sa voisine.
  let ordrePrecedent = [];

  /** Rend le focus à la carte d'un plat (fermeture de sa feuille) ; partie, à sa voisine. */
  function rendreFocus(platId) {
    const cartes = [...listeCartes.children];
    const carte = cartes.find((n) => n.dataset.plat === platId);
    if (carte) {
      carte.querySelector('.plat-semaine-ouvrir')?.focus();
      return;
    }
    const position = ordrePrecedent.indexOf(platId);
    const parId = new Map(cartes.map((n) => [n.dataset.plat, n]));
    focusApresRetrait(position, ordrePrecedent.map((id) => parId.get(id) ?? { isConnected: false }));
  }

  return { noeud, maj, rendreFocus };
}

/** Semaine où iraient les plats choisis maintenant (coeur/semaine.js › semaineVisee), ou null avant la lecture. */
function semaineViseeDe(ctx) {
  if (!ctx?.semainesChargees) return null;
  return semaineVisee(ctx.semaines ?? [], aujourdhuiDe(ctx));
}

/** Aperçu de la proposition (T4-0) pour la semaine visée du moment : { plats, desserts, cause… } ou null. */
function apercuVise(ctx) {
  const visee = semaineViseeDe(ctx);
  return visee ? ctx.proposition?.apercu?.(visee) ?? null : null;
}

/**
 * Carte « prochaine action » du moment : rien tant que semaines, plats et profils ne sont pas lus. Semaine sans plat
 * (T4-0) : « ✨ Proposer N plats » si au moins 2 plats sont proposables, sinon la ligne qui dit pourquoi.
 */
function carteDuMoment(ctx) {
  const pret = Boolean(ctx.semainesChargees) && ctx.platsCharges !== false && ctx.profilsCharges !== false;
  const liste = pret ? listeCourante(ctx) : null;
  const plats = pret ? platsDeLaSemaineDe(ctx) : [];
  let proposition = null;
  let sansProposition = null;
  const vide = !lireSemaine(ctx.semaine) || !plats.some((e) => e.etat === 'ok' || e.etat === 'sansRecette');
  if (pret && vide) {
    const apercu = apercuVise(ctx);
    if (apercu?.plats) proposition = { plats: apercu.plats };
    else if (apercu) {
      sansProposition = texteSansProposition(apercu.cause, {
        moi: ctx.moi ?? null, profils: ctx.profils ?? [], profilCause: apercu.profilCause,
      });
    }
  }
  return carteProchaineAction(ctx.semaine ?? null, {
    semainesChargees: pret,
    semaines: ctx.semaines ?? [],
    aujourdhui: aujourdhuiDe(ctx),
    plats,
    liste,
    groupes: liste ? grouperParRayon(liste, { rayons: ordreRayons(ctx.reglages) }) : null,
    proposition,
    sansProposition,
  });
}

/**
 * Écran reconstruit seulement quand sa clé change (jour, salutation, rôle, aperçu) ; `maj(ctx)` met à jour en place la
 * carte « prochaine action », les plats de la semaine, les cartes « 🧸🎂 » et « 📬 », et les feuilles ouvertes.
 * `ctx.role` est le rôle affiché : « courses » en aperçu.
 */
export function creer(ctx) {
  contexteSemaine = ctx;
  const anniversaire = ctx.role === 'gestionnaire' ? creerCarteAnniversaire(ctx) : null;
  const demandes = ctx.role === 'gestionnaire' ? creerCarteDemandes(ctx) : null;
  const maintenant = new Date();
  const prenom = prenomDe(ctx.utilisateur);

  const visible = (n) => Boolean(n?.isConnected && !n.hidden && !n.closest('[hidden]'));

  /**
   * Après « Annuler » d'une proposition : le bouton de la carte revenue (« ✨ Proposer … », sinon « Préparer la semaine
   * du … », sinon son bouton principal) ; d'un « 🔄 Une autre idée » (`platId` : l'ancien plat), sa carte.
   */
  function apresAnnulation(platId = null) {
    if (platId) {
      sectionPlats.rendreFocus(platId);
      return;
    }
    const zone = carteAction.noeud;
    const cible = zone.querySelector('[data-action="proposer"]') ?? zone.querySelector('[data-action="preparer"]')
      ?? zone.querySelector('.bouton-principal') ?? zone.querySelector('.actions-carte a, .actions-carte button');
    if (visible(cible)) cible.focus();
  }

  /**
   * Après « Annuler » d'une proposition de desserts : « 🍰 Proposer des desserts » sous les plats, sinon « ＋ Choisir
   * d'autres plats », sinon comme ✨ (la semaine vidée revient à la carte « prochaine action »).
   */
  function apresAnnulationDesserts(platId = null) {
    if (platId) {
      apresAnnulation(platId);
      return;
    }
    const zone = sectionPlats.noeud;
    const cible = [zone.querySelector('[data-action="desserts"]'), zone.querySelector('[data-action="autres"]')].find(visible);
    if (cible) cible.focus();
    else apresAnnulation();
  }

  /**
   * Focus sur la carte d'un plat qui vient d'arriver (proposition, desserts, autre idée), une fois l'écran à jour ; la
   * page défile juste assez pour que la carte passe au-dessus de l'annonce qui en parle (police agrandie : sans cela,
   * la carte du premier plat proposé restait cachée sous le bandeau).
   */
  function viserCarte(platId) {
    if (!platId) return;
    sectionPlats.rendreFocus(platId);
    montrerAuDessusDeLAnnonce(document.activeElement?.closest?.('.carte-plat-semaine') ?? null);
  }

  /**
   * Feuille « Ajouter à la semaine » ; le focus revient au bouton qui l'a ouverte, ou, s'il a disparu (la carte est
   * passée de « ＋ Choisir les plats » à « Faire les courses › »), à l'action de la carte. Après « ✨ » : la carte du
   * premier plat proposé ; après « 🍰 » : la feuille « Combien de desserts ? », sur la même semaine visée.
   */
  function choisir(depuis = null) {
    ouvrirChoixDesPlats(lireContexte, {
      apresAnnulation,
      onFermer: (suite) => {
        if (suite?.desserts) {
          ouvrirCombienDeDesserts(suite.desserts, depuis);
          return;
        }
        if (suite?.viser) {
          viserCarte(suite.viser);
          return;
        }
        const cible = visible(depuis) ? depuis : carteAction.noeud.querySelector('.actions-carte a, .actions-carte button');
        if (visible(cible)) cible.focus();
      },
    });
  }

  /** « Combien de desserts ? » ; à la fermeture sans desserts, le focus revient au bouton qui l'a ouverte. */
  function ouvrirCombienDeDesserts({ cible, restes = [], garderRestes = true }, depuis = null) {
    if (!cible) return;
    ouvrirDesserts(lireContexte, {
      cible,
      restes,
      garderRestes,
      apresAnnulation: apresAnnulationDesserts,
      onFermer: (suite) => {
        if (suite?.viser) {
          viserCarte(suite.viser);
          return;
        }
        const cibleFocus = visible(depuis) ? depuis : carteAction.noeud.querySelector('.actions-carte a, .actions-carte button');
        if (visible(cibleFocus)) cibleFocus.focus();
      },
    });
  }

  /** « 🍰 Proposer des desserts » sous les plats : la semaine visée du moment (celle de « ＋ Choisir d'autres plats »). */
  function desserts(depuis) {
    const cible = semaineViseeDe(contexteSemaine);
    if (!cible) return;
    ouvrirCombienDeDesserts({ cible: { id: cible.id, debut: cible.debut, fin: cible.fin }, restes: [] }, depuis);
  }

  /**
   * « ✨ Proposer N plats » de la carte : les plats entrent d'un coup (actions.proposerALaSemaine, semaine visée au
   * toucher), vibration, focus sur la carte du premier plat proposé ; annonce avec « Annuler » 10 s.
   */
  function proposer(depuis, nombre) {
    const resultat = contexteSemaine?.actions?.proposerALaSemaine?.({ nombreAnnonce: nombre, apresAnnulation });
    if (resultat?.code !== 'ok' && resultat?.code !== 'peu') return;
    vibrer();
    viserCarte(resultat.ajoutes?.[0]?.platId ?? null);
  }

  /**
   * Feuille du plat de la semaine ; le focus revient à sa carte, ou à sa voisine si le plat a été retiré ; après
   * « 🔄 Une autre idée » (`viser`), à la carte du nouveau plat, à la même place.
   */
  function ouvrir(platId, depuis) {
    ouvrirPlatDeLaSemaine(lireContexte, platId, {
      apresAnnulation,
      onFermer: (suite) => {
        if (suite?.viser) viserCarte(suite.viser);
        else if (depuis?.isConnected) depuis.focus();
        else sectionPlats.rendreFocus(platId);
      },
    });
  }

  /**
   * « 🔄 Changer des plats » : feuille « Changer des plats » ; après le changement, focus sur la carte du premier plat
   * arrivé ; fermée sans rien changer, le focus revient au bouton, ou, s'il a disparu (courses faites sur l'autre
   * téléphone), à l'action de la carte « prochaine action ».
   */
  function changer(depuis) {
    ouvrirChangerDesPlats(lireContexte, {
      apresAnnulation,
      onFermer: (suite) => {
        if (suite?.viser) viserCarte(suite.viser);
        else if (visible(depuis)) depuis.focus();
        else apresAnnulation(null);
      },
    });
  }

  const carteAction = creerCarteAction(choisir, proposer);
  const sectionPlats = creerSectionPlats(choisir, ouvrir, desserts, changer);
  const carteBatch = creerCarteBatch(ctx);

  const noeud = el('div', { class: 'vue' },
    enteteVue(prenom ? `${salutation(maintenant)} ${prenom}` : salutation(maintenant), formatDate.format(maintenant)),
    anniversaire?.noeud ?? null,
    demandes?.noeud ?? null,
    carteAction.noeud,
    sectionPlats.noeud,
    carteBatch.noeud,
    ctx.role === 'gestionnaire' ? carteIdees() : null,
  );

  function majSemaine(c) {
    const carte = carteDuMoment(c);
    carteAction.maj(carte);
    sectionPlats.maj(c);
    // Un seul bouton principal à l'écran : celui du batch seulement quand la carte « prochaine action » n'en a pas
    // (courses faites) ; la carte du batch remonte alors juste sous elle, pour que l'action du moment soit en haut.
    const principal = !(carte.boutons ?? []).some((b) => b.principal);
    carteBatch.maj(c, { principal });
    const apres = principal ? carteAction.noeud : sectionPlats.noeud;
    if (apres.nextElementSibling !== carteBatch.noeud) {
      const focus = carteBatch.noeud.contains(document.activeElement) ? document.activeElement : null;
      apres.after(carteBatch.noeud);
      focus?.focus({ preventScroll: true });
    }
  }
  majSemaine(ctx);
  majChoixDesPlats(ctx);
  majPlatsDeLaSemaine(ctx);
  // « Choisir les plats › » de Courses : la feuille s'ouvre une fois l'écran en place.
  if (prendreChoixDemande()) {
    setTimeout(() => choisir(carteAction.noeud.querySelector('[data-action="choisir"]') ?? carteAction.noeud.querySelector('button')), 0);
  }

  return {
    noeud,
    maj(nouveau) {
      contexteSemaine = nouveau;
      anniversaire?.maj(nouveau);
      demandes?.maj(nouveau);
      majSemaine(nouveau);
      majChoixDesPlats(nouveau);
      majChangerDesPlats(nouveau);
      majPlatsDeLaSemaine(nouveau);
      majDatesDeLaSemaine(nouveau);
    },
  };
}
