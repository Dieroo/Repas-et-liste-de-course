// Écran Semaine (accueil, les deux rôles) : salutation, puis la carte « prochaine action » (le seul bouton principal :
// « ＋ Choisir les plats », « Faire les courses › », « Préparer la semaine du … » ; une fois les courses faites (T3b),
// « Courses faites ✓ » sans bouton principal, sauf « Préparer la semaine du … » les deux derniers jours), puis « Les
// plats de la semaine »
// (une carte par plat : pour qui et combien, Mer / Végétale d'un toucher, conservation ; « En ce moment… » quand la
// semaine suivante est déjà montrée ; plats de la corbeille dits d'une ligne discrète). Pour le gestionnaire (hors
// aperçu « Repas et courses ») : la carte « 🧸🎂 <Enfant> a 5 ans ! » quand des précautions de l'enfant ont passé leur
// âge (T2c-3), la carte « 📬 2 demandes à traiter » (T2e) en tête, et la carte « Idées de plats » en bas.
// Rien n'est écrit à l'ouverture : chaque section se met à jour en place (`maj`), la liste de courses suit.
import { el, enteteVue, pastille, ecrireTexte, reconcilier } from './dom.js';
import { prenomDe } from './profil.js';
import { ouvrirFeuille } from './feuille.js';
import { copier } from './presse-papiers.js';
import { aujourdhuiDe } from './regime.js';
import { modeDeCuisson } from './pictos.js';
import { vignetteDuPlat } from './plats.js';
import { ouvrirChoixDesPlats, majChoixDesPlats, prendreChoixDemande } from './choisir-plats.js';
import {
  creerConservation, creerVersions, listeCourante, majPlatsDeLaSemaine, nomDuPlat, ouvrirPlatDeLaSemaine,
  platsDeLaSemaineDe,
} from './plat-semaine.js';
import {
  IDEES_ENVIE_MAX, IDEES_NOMBRES, IDEES_NOMBRE_DEFAUT, IDEES_PAR_MESSAGE, texteDemandeIdees,
} from '../coeur/claude.js';
import { carteAnniversaire } from '../coeur/age.js';
import {
  exceptionPlat, lireSemaine, peutPreparerLaSuivante, resumePlat, semaineEnCours, texteDates, texteJour,
} from '../coeur/semaine.js';
import { carteProchaineAction, grouperParRayon, ordreRayons } from '../coeur/liste.js';

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
    const n = aTraiter.length;
    noeud.hidden = n === 0;
    if (!n) return;
    const noms = [...new Set(aTraiter.map((element) => nomCourt(element?.plat)).filter(Boolean))];
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

// ——— Carte « prochaine action » ———

/**
 * Carte « prochaine action » (coeur/liste.js › carteProchaineAction) : « Que mange-t-on cette semaine ? » et
 * « ＋ Choisir les plats », « Courses : 32 articles » et « Faire les courses › », « Tout est dans le panier 🎉 » et
 * « Dites-le dans Courses quand c'est fini. », puis « Courses faites ✓ » et « Le samedi 10 octobre. Bon appétit ! »
 * (T3b : « Voir la liste › » secondaire, la semaine qu'on cuisine reste à l'écran)… ;
 * les deux derniers jours d'une semaine, « Cette semaine se termine vendredi 16 octobre. » et « Préparer la semaine du
 * 17 au 23 octobre », qui n'écrit rien et ouvre la feuille de choix sur la semaine suivante. Nœuds gardés d'un rendu à
 * l'autre (le focus reste sur le bouton touché). `choisir(bouton)` : ouvre la feuille « Ajouter à la semaine ».
 * → { noeud, maj(carte) }
 */
function creerCarteAction(choisir) {
  const visuel = el('div', { class: 'carte-action-visuel' });
  const titre = el('h2', { id: 'titre-prochaine-action' });
  const texte = el('p', {});
  const fin = el('p', { class: 'fin-semaine' });
  const boutons = el('div', { class: 'actions-carte' });
  const noeud = el('section', { class: 'carte carte-action', 'aria-labelledby': 'titre-prochaine-action' },
    el('div', { class: 'carte-ligne' }, visuel, el('div', { class: 'carte-texte' }, titre, texte, fin)),
    boutons);
  let emoji = '';

  function maj(carte) {
    const voulu = carte.cas === 'choisir' ? '🍲' : carte.cas === 'faites' ? '✅' : '🧺';
    if (voulu !== emoji) {
      emoji = voulu;
      visuel.replaceChildren(pastille(voulu, voulu === '🍲' ? '' : 'olive'));
    }
    ecrireTexte(titre, carte.titre);
    ecrireTexte(texte, carte.texte ?? '');
    texte.hidden = !carte.texte;
    ecrireTexte(fin, carte.fin ?? '');
    fin.hidden = !carte.fin;
    const classe = (b) => `bouton bouton-plein ${b.principal ? 'bouton-principal' : 'bouton-secondaire'}`;
    reconcilier(boutons, carte.boutons ?? [], {
      cle: (b) => b.action,
      creer: (b) => {
        const noeudBouton = b.action === 'courses'
          ? el('a', { class: classe(b), href: '#/courses' }, b.libelle)
          : el('button', { class: classe(b), type: 'button' }, b.libelle);
        if (b.action !== 'courses') noeudBouton.addEventListener('click', () => choisir(noeudBouton));
        return noeudBouton;
      },
      maj: (n, b) => {
        if (n.className !== classe(b)) n.className = classe(b);
        ecrireTexte(n, b.libelle);
      },
    });
    boutons.hidden = !boutons.children.length;
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
  const exception = exceptionPlat(element, { moi: ctx?.moi ?? null, role: ctx?.role ?? null }) ?? '';
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
 * la semaine en cours quand la suivante est déjà montrée. Reconstruite seulement quand elle change (le focus d'un lien
 * reste). → { noeud, maj(ctx) }
 */
function creerEnCeMoment() {
  const noeud = el('p', { class: 'en-ce-moment', hidden: true });
  let signature = '';
  function maj(ctx) {
    const enCours = ctx?.semaineEnCours !== undefined ? ctx.semaineEnCours
      : semaineEnCours(ctx?.semaines ?? [], aujourdhuiDe(ctx));
    const lue = lireSemaine(enCours);
    const plats = lue ? platsDeLaSemaineDe(ctx, enCours).filter((e) => e.etat === 'ok' || e.etat === 'sansRecette') : [];
    const nouvelle = lue && plats.length ? `${lue.fin}|${plats.map((e) => `${e.platId}:${nomDuPlat(e.plat)}`).join('|')}` : '';
    if (nouvelle === signature) return;
    signature = nouvelle;
    noeud.hidden = !nouvelle;
    if (!nouvelle) {
      noeud.replaceChildren();
      return;
    }
    const liens = plats.flatMap((e, i) => [
      i ? ', ' : null,
      el('a', { class: 'lien-en-ce-moment', href: `#/plat/${encodeURIComponent(e.platId)}` }, nomDuPlat(e.plat)),
    ]);
    noeud.replaceChildren(`En ce moment, jusqu’au ${texteJour(lue.fin)}\u00A0: `, ...liens.filter(Boolean), '.');
  }
  return { noeud, maj };
}

/**
 * Section « Les plats de la semaine » : titre, dates (« Du 10 au 16 octobre »), « En ce moment… », une carte par plat
 * (ordre d'ajout), les plats de la corbeille, puis « ＋ Choisir d'autres plats » (s'il y a déjà un plat et que la
 * semaine ne finit pas dans 2 jours : la carte propose alors « Préparer la semaine du … »).
 * → { noeud, maj(ctx) }
 */
function creerSectionPlats(choisir, ouvrir) {
  const dates = el('p', {});
  const enCeMoment = creerEnCeMoment();
  const listeCartes = el('div', { class: 'cartes-plats-semaine' });
  const horsSemaine = el('div', { class: 'plats-hors-semaine' });
  const boutonAutres = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button' },
    el('span', { 'aria-hidden': 'true' }, '＋'), 'Choisir d’autres plats');
  boutonAutres.addEventListener('click', () => choisir(boutonAutres));
  const noeud = el('section', { class: 'section section-plats-semaine', 'aria-labelledby': 'titre-plats-semaine', hidden: true },
    el('div', { class: 'section-titre' }, el('h2', { id: 'titre-plats-semaine' }, 'Les plats de la semaine'), dates),
    enCeMoment.noeud,
    listeCartes,
    horsSemaine,
    boutonAutres);

  function maj(ctx) {
    const pret = ctx.semainesChargees && ctx.platsCharges !== false && ctx.profilsCharges !== false;
    const lue = pret ? lireSemaine(ctx.semaine) : null;
    const elements = lue ? platsDeLaSemaineDe(ctx) : [];
    const montres = elements.filter((e) => e.etat === 'ok' || e.etat === 'sansRecette');
    const jetes = elements.filter((e) => e.etat === 'corbeille' && e.plat);
    ecrireTexte(dates, lue ? majuscule(texteDates(lue.debut, lue.fin)) : '');
    dates.hidden = !lue;
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
    boutonAutres.hidden = !montres.length || peutPreparerLaSuivante(lue, aujourdhuiDe(ctx));
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

/** Carte « prochaine action » du moment : rien tant que semaines, plats et profils ne sont pas lus. */
function carteDuMoment(ctx) {
  const pret = Boolean(ctx.semainesChargees) && ctx.platsCharges !== false && ctx.profilsCharges !== false;
  const liste = pret ? listeCourante(ctx) : null;
  return carteProchaineAction(ctx.semaine ?? null, {
    semainesChargees: pret,
    semaines: ctx.semaines ?? [],
    aujourdhui: aujourdhuiDe(ctx),
    plats: pret ? platsDeLaSemaineDe(ctx) : [],
    liste,
    groupes: liste ? grouperParRayon(liste, { rayons: ordreRayons(ctx.reglages) }) : null,
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

  /**
   * Feuille « Ajouter à la semaine » ; le focus revient au bouton qui l'a ouverte, ou, s'il a disparu (la carte est
   * passée de « ＋ Choisir les plats » à « Faire les courses › »), à l'action de la carte.
   */
  function choisir(depuis = null) {
    ouvrirChoixDesPlats(lireContexte, {
      onFermer: () => {
        const visible = (n) => Boolean(n?.isConnected && !n.hidden && !n.closest('[hidden]'));
        const cible = visible(depuis) ? depuis : carteAction.noeud.querySelector('.actions-carte a, .actions-carte button');
        if (visible(cible)) cible.focus();
      },
    });
  }

  /** Feuille du plat de la semaine ; le focus revient à sa carte, ou à sa voisine si le plat a été retiré. */
  function ouvrir(platId, depuis) {
    ouvrirPlatDeLaSemaine(lireContexte, platId, {
      onFermer: () => {
        if (depuis?.isConnected) depuis.focus();
        else sectionPlats.rendreFocus(platId);
      },
    });
  }

  const carteAction = creerCarteAction(choisir);
  const sectionPlats = creerSectionPlats(choisir, ouvrir);

  const noeud = el('div', { class: 'vue' },
    enteteVue(prenom ? `${salutation(maintenant)} ${prenom}` : salutation(maintenant), formatDate.format(maintenant)),
    anniversaire?.noeud ?? null,
    demandes?.noeud ?? null,
    carteAction.noeud,
    sectionPlats.noeud,
    ctx.role === 'gestionnaire' ? carteIdees() : null,
  );

  function majSemaine(c) {
    carteAction.maj(carteDuMoment(c));
    sectionPlats.maj(c);
  }
  majSemaine(ctx);
  majChoixDesPlats(ctx);
  majPlatsDeLaSemaine(ctx);
  // « Choisir les plats › » de Courses : la feuille s'ouvre une fois l'écran en place.
  if (prendreChoixDemande()) setTimeout(() => choisir(carteAction.noeud.querySelector('button')), 0);

  return {
    noeud,
    maj(nouveau) {
      contexteSemaine = nouveau;
      anniversaire?.maj(nouveau);
      demandes?.maj(nouveau);
      majSemaine(nouveau);
      majChoixDesPlats(nouveau);
      majPlatsDeLaSemaine(nouveau);
    },
  };
}
