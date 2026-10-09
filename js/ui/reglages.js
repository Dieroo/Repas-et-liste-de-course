// Écran Réglages (gestionnaire) : rôle, profils du foyer, sauvegarde.
// Profil d'un enfant (T2c) : « 🧸 Ce que <Enfant> mange › » ouvre l'écran de ses précautions selon l'âge ; la ligne
// du profil donne son âge (« · 🧸 4 ans ») et, si sa date demande des précautions que ses règles n'ont pas encore
// (restauration, règle abîmée retirée, barème complété), « 🧸 N précautions à ajouter › ». Calcul seulement : rien
// n'est écrit avant « Enregistrer » sur l'écran de l'enfant.
import { el, enteteVue, etatVide, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { copier } from './presse-papiers.js';
import { avecEcranAge, aujourdhuiDe } from './regime.js';
import { PORTIONS, NOM_PROFIL_MAX, trierProfils, preparerProfil, libellePortion } from '../coeur/profils.js';
import { dateDeSauvegarde, joursDepuis } from '../coeur/sauvegarde.js';
import { REGIMES, lireRegime, marqueursSurveilles } from '../coeur/regles.js';
import { VERSION_INSTRUCTIONS, LOT_PRECAUTIONS, texteDemandePrecautions } from '../coeur/claude.js';
import { platsARelire, lotDePrecautions } from '../coeur/relecture.js';
import { MARQUEURS_PRECAUTION, estRelue } from '../coeur/vocabulaire.js';
import { ageEnMois, estRegleAge, reglesSelonAge, texteAge } from '../coeur/age.js';

// Au-delà, la carte « Sauvegarde » invite à en faire une (même seuil que le rappel du panneau du profil).
const JOURS_RAPPEL_SAUVEGARDE = 30;

/** « le 6 octobre » (« le 1er mai ») ; l'année s'ajoute si ce n'est pas l'année en cours. Fuseau du téléphone. */
function leJour(date) {
  const jour = date.getDate();
  const mois = date.toLocaleDateString('fr-FR', { month: 'long' });
  const annee = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `le ${jour === 1 ? '1er' : jour}\u00A0${mois}${annee}`;
}

/** État de la carte « Sauvegarde » : dernière date, absence, ou rappel au-delà de 30 jours. */
function texteEtatSauvegarde(valeur) {
  const derniere = dateDeSauvegarde(valeur);
  if (!derniere) return 'Pas encore de sauvegarde.';
  const jours = Math.floor(joursDepuis(derniere, new Date()));
  if (jours > JOURS_RAPPEL_SAUVEGARDE) {
    return `⚠️ Dernière sauvegarde il y a ${jours}\u00A0jours\u00A0: pensez à en faire une.`;
  }
  return `Dernière sauvegarde\u00A0: ${leJour(derniere)}.`;
}

/** Régime du profil lu dans ses règles (« Mange de tout » si rien n'est réglé). */
function regimeDe(profil) {
  return REGIMES[lireRegime(profil?.regles).regime] ?? REGIMES.tout;
}

/** Mention du régime sur la carte du profil : rien pour « Mange de tout » (un profil sans règle n'affiche rien). */
function mentionRegime(profil) {
  const { regime } = lireRegime(profil?.regles);
  if (regime === 'tout' || !REGIMES[regime]) return null;
  return `${REGIMES[regime].emoji} ${REGIMES[regime].libelle}`;
}

/** « 🧸 4 ans » : âge du profil, s'il a une date de naissance lisible ; null sinon. */
function mentionAge(profil, aujourdhui) {
  if (typeof profil?.naissance !== 'string' || !profil.naissance) return null;
  const mois = ageEnMois(profil.naissance, aujourdhui);
  // Insécables : « 🧸 3 ans » ne se coupe pas en fin de ligne.
  return mois === null ? null : `🧸\u00A0${texteAge(mois).replace(/ /g, '\u00A0')}`;
}

/**
 * Précautions que la date de naissance demande et que les règles enregistrées n'ont pas encore (à ajouter ou à
 * renforcer, coeur/age.js › reglesSelonAge) : 0 sans date. Calcul pur, aucune écriture.
 */
function precautionsAAjouter(profil, aujourdhui) {
  if (typeof profil?.naissance !== 'string' || !profil.naissance) return 0;
  const { ajoutees = [], durcies = [] } = reglesSelonAge(profil.naissance, aujourdhui, profil.regles ?? []) ?? {};
  return ajoutees.length + durcies.length;
}

/** Vrai si le profil a une date de naissance ou des précautions selon l'âge. */
function avecPrecautions(profil) {
  return (typeof profil?.naissance === 'string' && profil.naissance !== '')
    || (Array.isArray(profil?.regles) && profil.regles.some(estRegleAge));
}

/** `lireCtx()` donne l'état à jour au moment d'enregistrer (les profils ont pu changer entre-temps). */
function ouvrirFicheProfil(lireCtx, existant) {
  const nomAffiche = existant?.nom || 'ce profil';
  ouvrirFeuille(existant ? 'Modifier le profil' : 'Ajouter un profil', (fermer) => {
    let retraitAConfirmer = false;
    const erreurs = {};
    const message = (cle) => {
      erreurs[cle] = el('p', { class: 'message-erreur', role: 'alert', hidden: true });
      return erreurs[cle];
    };

    const nom = el('input', {
      class: 'champ', id: 'profil-nom', maxlength: NOM_PROFIL_MAX, autocomplete: 'off', autofocus: !existant,
      value: existant?.nom ?? '',
      oninput: () => { erreurs.nom.hidden = true; },
    });
    const email = el('input', {
      class: 'champ', id: 'profil-email', type: 'email', inputmode: 'email', autocomplete: 'off',
      value: existant?.email ?? '',
      oninput: () => { erreurs.email.hidden = true; },
    });
    // Passage de « Enfant » à « Adulte » d'un profil qui a une date ou des précautions selon l'âge : elles restent.
    const aidePassage = el('p', { class: 'aide', hidden: true });
    const zonePassage = el('div', { role: 'status' }, aidePassage);
    const majPassage = () => {
      const choisi = portions.map((l) => l.querySelector('input')).find((i) => i.checked);
      const montrer = Boolean(existant) && avecPrecautions(existant) && Number(choisi?.value) === 1;
      const texte = montrer
        ? `Ses précautions selon l’âge restent en place. Pour les retirer\u00A0: «\u00A0🧸 Ce que ${nomAffiche} mange\u00A0».`
        : '';
      if (aidePassage.textContent !== texte) aidePassage.textContent = texte;
      aidePassage.hidden = !texte;
    };
    const portions = PORTIONS.map((p) => el('label', { class: 'choix' },
      el('input', {
        type: 'radio', name: 'portion', value: String(p.valeur),
        checked: (existant?.coefPortion ?? 1) === p.valeur,
        onchange: majPassage,
      }),
      el('span', {}, p.libelle),
    ));
    majPassage();

    // « Ce que <Prénom> mange » : écran à part (les changements de la feuille non enregistrés y sont abandonnés).
    // Enfant (portion d'enfant, date de naissance ou précautions d'âge) : « 🧸 Ce que <Enfant> mange › ».
    const ligneRegime = existant
      ? el('button', {
        class: 'bouton bouton-secondaire bouton-plein ligne-regime',
        type: 'button',
        onclick: () => {
          fermer();
          location.hash = `#/regime/${encodeURIComponent(existant.id)}`;
        },
      }, avecEcranAge(existant)
        ? [el('span', { 'aria-hidden': 'true' }, '🧸'), `Ce que ${nomAffiche} mange ›`]
        : `🍽️ Ce que ${nomAffiche} mange\u00A0: ${regimeDe(existant).libelle} ›`)
      : null;

    const boutonRetrait = existant
      ? el('button', {
        class: 'bouton bouton-texte bouton-danger',
        type: 'button',
        onclick: () => {
          if (!retraitAConfirmer) {
            retraitAConfirmer = true;
            boutonRetrait.textContent = `Confirmer\u00A0: retirer ${nomAffiche}`;
            annoncer('Touchez à nouveau pour confirmer.');
            return;
          }
          lireCtx().actions.retirerProfil(existant.id);
          annoncer(`Profil «\u00A0${nomAffiche}\u00A0» retiré.`);
          fermer();
        },
      }, 'Retirer ce profil')
      : null;

    return el('form', {
      class: 'formulaire',
      novalidate: true,
      onsubmit: (evenement) => {
        evenement.preventDefault();
        const choisi = portions.map((l) => l.querySelector('input')).find((i) => i.checked);
        const ctx = lireCtx();
        const resultat = preparerProfil(
          { nom: nom.value, email: email.value, coefPortion: choisi ? Number(choisi.value) : null },
          // Adresse non touchée : pas réécrite (une liaison « C'est moi » faite entre-temps ailleurs reste).
          { profils: ctx.profils, id: existant?.id ?? null, emailOuverture: existant ? existant.email ?? '' : undefined },
        );
        for (const [cle, zone] of Object.entries(erreurs)) {
          zone.textContent = resultat.erreurs?.[cle] ?? '';
          zone.hidden = !resultat.erreurs?.[cle];
        }
        if (resultat.erreurs) return;
        ctx.actions.enregistrerProfil(resultat.profil);
        annoncer(existant ? 'Profil modifié.' : `Profil «\u00A0${resultat.profil.nom}\u00A0» ajouté.`);
        fermer();
      },
    },
    el('label', { class: 'etiquette-champ', for: 'profil-nom' }, 'Prénom'),
    nom,
    message('nom'),
    el('label', { class: 'etiquette-champ', for: 'profil-email' }, 'Adresse e-mail (facultatif)'),
    email,
    el('p', { class: 'aide' }, 'Pour reconnaître la personne quand elle se connecte. Laissez vide pour un enfant.'),
    message('email'),
    el('fieldset', { class: 'groupe-choix' },
      el('legend', { class: 'etiquette-champ' }, 'Portion'),
      el('div', { class: 'choix-ligne' }, portions),
    ),
    message('coefPortion'),
    zonePassage,
    ligneRegime,
    el('div', { class: 'actions-feuille' },
      el('button', { class: 'bouton bouton-principal bouton-plein', type: 'submit' }, 'Enregistrer'),
      el('button', { class: 'bouton bouton-texte', type: 'button', onclick: fermer }, 'Annuler'),
      boutonRetrait,
    ));
  });
}

/** Le fichier ne vient que de la copie du téléphone (pas de réseau, ou données pas encore confirmées). */
export function texteCopieLocale() {
  return `${navigator.onLine ? 'Données pas encore à jour' : 'Hors ligne'}\u00A0: ce fichier contient la copie de cet appareil. Il ne compte pas comme dernière sauvegarde.`;
}

/**
 * Message court lu après un téléchargement. Dans Réglages, le détail reste affiché sous le bouton ; depuis le panneau
 * du profil, rien d'autre n'est affiché : les plats à corriger sont nommés.
 */
export function resumeSauvegarde({ horsLigne, aCorriger = [] }, { dansReglages = false } = {}) {
  const phrases = ['Téléchargement lancé. Vérifiez qu’il est dans «\u00A0Téléchargements\u00A0».'];
  if (horsLigne) phrases.push(dansReglages ? 'Il ne compte pas comme dernière sauvegarde.' : texteCopieLocale());
  if (dansReglages) {
    if (aCorriger.length === 1) phrases.push('Une recette est à corriger\u00A0: détails sous le bouton.');
    else if (aCorriger.length > 1) phrases.push(`${aCorriger.length} recettes sont à corriger\u00A0: détails sous le bouton.`);
  } else if (aCorriger.length) {
    const noms = aCorriger.slice(0, 3).map(({ nom }) => `«\u00A0${nom}\u00A0»`);
    const reste = aCorriger.length - noms.length;
    const liste = reste > 0 ? `${noms.join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}` : noms.join(', ');
    phrases.push(aCorriger.length === 1
      ? `La recette de ${liste} est abîmée\u00A0: corrigez-la dans l’app.`
      : `Recettes abîmées, à corriger dans l’app\u00A0: ${liste}.`);
  }
  return phrases.join(' ');
}

/**
 * Carte « Projet Claude » : copie les instructions à coller dans le projet Claude (`docs/projet-claude.md`). Le texte
 * est lu à l'ouverture de Réglages (gardé par l'app, donc tout de suite là) : la copie part dans le toucher, sans
 * attente, et le repli de copie fonctionne. Tant que les instructions de cette version de l'app n'ont pas été copiées
 * sur ce téléphone (`ctx.instructionsAJour` faux), un bandeau le rappelle et la copie devient l'action principale.
 * → { noeud, maj, detruire }
 */
function creerCarteProjetClaude(ctx) {
  let courant = ctx;
  let instructions = null;
  let detruit = false;
  let aJour = null; // dernier état montré : bandeau et bouton ne changent que s'il change
  const etat = el('p', { class: 'aide', role: 'status' });
  // Région vivante toujours présente : le bandeau, s'il apparaît pendant la visite, est lu une fois.
  const bandeau = el('p', { class: 'bandeau bandeau-alerte', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '🔔'),
    el('span', {}, 'Nouvelles instructions\u00A0: copiez-les dans votre projet Claude.'));
  const rappel = el('div', { class: 'rappel-instructions', role: 'status' }, bandeau);
  const bouton = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    disabled: true,
    onclick: async () => {
      if (!instructions) return;
      const reussi = await copier(instructions);
      // Retenue sur ce téléphone : l'app se redessine, le bandeau disparaît et le bouton redevient secondaire.
      if (reussi) courant.actions?.noterInstructionsCopiees?.();
      if (detruit) return;
      etat.textContent = reussi
        ? 'Copié. Collez-le dans les instructions de votre projet Claude, à la place des anciennes.'
        : 'La copie n’a pas marché. Réessayez.';
      etat.hidden = false;
    },
  }, el('span', { 'aria-hidden': 'true' }, '📋'), 'Copier les instructions du projet');
  const reessayer = el('button', { class: 'bouton bouton-texte', type: 'button', hidden: true, onclick: lire }, 'Réessayer');

  /** Bandeau et bouton selon `instructionsAJour`, sans reconstruire la carte (le focus reste sur le bouton). */
  function suivre(nouveau) {
    courant = nouveau;
    const copiees = Boolean(nouveau.instructionsAJour);
    if (copiees === aJour) return;
    aJour = copiees;
    bandeau.hidden = copiees;
    bouton.classList.toggle('bouton-principal', !copiees);
    bouton.classList.toggle('bouton-secondaire', copiees);
  }

  function lire() {
    reessayer.hidden = true;
    etat.hidden = true;
    etat.textContent = '';
    bouton.disabled = true;
    const lecture = typeof ctx.actions?.lireInstructionsClaude === 'function'
      ? ctx.actions.lireInstructionsClaude()
      : Promise.reject(new Error('Lecture indisponible.'));
    lecture.then((texte) => {
      if (detruit) return;
      instructions = typeof texte === 'string' && texte.trim() ? texte : null;
      if (!instructions) throw new Error('Instructions vides.');
      bouton.disabled = false;
    }).catch(() => {
      if (detruit) return;
      etat.textContent = 'Les instructions n’ont pas pu être lues. Réessayez.';
      etat.hidden = false;
      reessayer.hidden = false;
    });
  }

  suivre(ctx);
  lire();
  return {
    noeud: el('section', { class: 'carte carte-projet-claude' },
      el('h2', {}, 'Projet Claude'),
      rappel,
      el('p', { class: 'texte-doux' },
        'Les instructions qui apprennent à votre projet Claude à écrire les recettes et les versions pour l’app.'),
      el('p', { class: 'aide' }, `Version ${VERSION_INSTRUCTIONS} des instructions.`),
      bouton,
      etat,
      reessayer,
      el('p', { class: 'aide' }, 'Le plus simple\u00A0: faites-le depuis l’ordinateur, où vous modifiez votre projet Claude.'),
      el('a', { class: 'lien-fiche', href: './docs/projet-claude.md', target: '_blank', rel: 'noopener' },
        'Ouvrir les instructions ›'),
    ),
    maj: suivre,
    detruire() {
      detruit = true;
    },
  };
}

/**
 * Libellé du bouton de copie d'un lot de relecture : « les 10 premières », « les 4 recettes », « la recette » tant
 * qu'aucune recette n'est relue ; ensuite « les 10 suivantes », « les 4 dernières », « la dernière ».
 */
export function libelleLotRelecture(restantes, dejaRelues) {
  if (restantes > LOT_PRECAUTIONS) {
    return `Demander à Claude les ${LOT_PRECAUTIONS}\u00A0${dejaRelues ? 'suivantes' : 'premières'}`;
  }
  if (restantes > 1) return `Demander à Claude les ${restantes}\u00A0${dejaRelues ? 'dernières' : 'recettes'}`;
  return dejaRelues ? 'Demander à Claude la dernière' : 'Demander à Claude la recette';
}

/**
 * Carte « 🧸 Relire les recettes » (T2d, gestionnaire hors aperçu, sous « Projet Claude ») : Claude relit les repères
 * de précaution des recettes pas encore relues, par lots de LOT_PRECAUTIONS. Visible seulement si une recette attend
 * et qu'une règle active d'un profil surveille l'un de ces repères. Tant que les instructions de cette version ne
 * sont pas copiées, elle le demande d'abord, sans bouton. La copie retient les identifiants du lot sur le téléphone
 * (`relectureEnCours`) ; un second toucher recopie le même lot. Nœuds gardés : le focus reste sur le bouton touché.
 * → { noeud, maj }
 */
function creerCarteRelecture(ctx) {
  let courant = ctx;
  let copie = false;
  let dernierLot = null; // { attente: signature des recettes à relire, ids: [platId] }
  const nombre = el('p', {});
  const consigne = el('p', { class: 'aide' }, 'Copiez d’abord les nouvelles instructions ci-dessus.');
  const boutonDemander = el('button', { class: 'bouton bouton-plein', type: 'button', 'data-action': 'relire', onclick: demander });
  const lienColler = el('a', { class: 'bouton bouton-plein', href: '#/import' }, 'Coller la réponse de Claude');
  const actions = el('div', { class: 'actions-recette' }, boutonDemander, lienColler);
  const message = el('p', { class: 'aide', role: 'status' });
  const noeud = el('section', { class: 'carte carte-relecture', hidden: true },
    el('h2', {}, el('span', { 'aria-hidden': 'true' }, '🧸'), ' Relire les recettes'),
    nombre,
    el('p', { class: 'texte-doux' },
      'Il y repère ce qui demande une précaution\u00A0: fromage au lait cru, viande rosée, fruits à coque, alcool non cuit… Seuls ces repères changent.'),
    consigne,
    actions,
    message);

  /** Recettes à relire, si la carte a lieu d'être ; [] sinon. */
  function aRelire(c) {
    if (c.role !== 'gestionnaire' || !c.platsCharges || !c.profilsCharges) return [];
    const surveilles = c.surveilles ?? marqueursSurveilles(c.profils ?? []);
    if (!MARQUEURS_PRECAUTION.some((marqueur) => surveilles.has(marqueur))) return [];
    return platsARelire(c.plats ?? []);
  }

  async function demander() {
    const attente = aRelire(courant);
    if (!attente.length || !courant.instructionsAJour) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    const signature = attente.map((plat) => plat.id).sort().join('\n');
    const parId = new Map(attente.map((plat) => [plat.id, plat]));
    const recopie = dernierLot?.attente === signature;
    const lot = recopie ? dernierLot.ids.map((id) => parId.get(id)).filter(Boolean) : lotDePrecautions(courant.plats ?? []);
    if (!lot.length) return;
    const reussi = await copier(texteDemandePrecautions(lot));
    if (reussi) {
      copie = true;
      dernierLot = { attente: signature, ids: lot.map((plat) => plat.id) };
      courant.actions?.noterRelectureEnCours?.(dernierLot.ids);
      message.textContent = recopie
        ? 'Recopié.'
        : 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la réponse de Claude\u00A0». Lisez aussi ses remarques sous le bloc\u00A0: un repère comme «\u00A0viande\u00A0» se corrige dans Modifier.';
    } else {
      message.textContent = 'La copie n’a pas marché. Réessayez.';
    }
    majBoutons();
  }

  function majBoutons() {
    boutonDemander.className = `bouton bouton-plein ${copie ? 'bouton-secondaire' : 'bouton-principal'}`;
    lienColler.className = `bouton bouton-plein ${copie ? 'bouton-principal' : 'bouton-secondaire'}`;
    message.hidden = !message.textContent;
  }

  function maj(nouveau) {
    courant = nouveau;
    const attente = aRelire(nouveau);
    noeud.hidden = !attente.length;
    if (!attente.length) return;
    const n = attente.length;
    nombre.textContent = n > 1
      ? `${n}\u00A0recettes n’ont pas encore été relues par Claude.`
      : '1\u00A0recette n’a pas encore été relue par Claude.';
    const pret = Boolean(nouveau.instructionsAJour);
    consigne.hidden = pret;
    actions.hidden = !pret;
    if (!pret) message.textContent = '';
    const dejaRelues = (nouveau.plats ?? []).some((plat) => estRelue(plat));
    boutonDemander.replaceChildren(el('span', { 'aria-hidden': 'true' }, '📋'), ` ${libelleLotRelecture(n, dejaRelues)}`);
    majBoutons();
  }

  maj(ctx);
  return { noeud, maj };
}

export function creer(ctx) {
  let courant = ctx;
  const carteProjetClaude = creerCarteProjetClaude(ctx);
  const carteRelecture = creerCarteRelecture(ctx);
  const gestionnaire = el('dd', {});
  const listeProfils = el('div', { class: 'section' });

  const lireCtx = () => courant;

  /** « 🧸 2 précautions à ajouter › » sous la ligne d'un enfant dont les règles sont en retard sur sa date ; null sinon. */
  function lienAAjouter(profil, aujourdhui) {
    const nombre = precautionsAAjouter(profil, aujourdhui);
    if (!nombre) return null;
    return el('a', {
      class: 'lien-precautions',
      href: `#/regime/${encodeURIComponent(profil.id)}`,
      'data-cle': `precautions-${profil.id}`,
    },
    el('span', { 'aria-hidden': 'true' }, '🧸'),
    el('span', {}, nombre > 1 ? `${nombre}\u00A0précautions à ajouter ›` : '1\u00A0précaution à ajouter ›'),
    el('span', { class: 'visuellement-masque' }, ` pour ${profil.nom}`));
  }

  // ——— Sauvegarde ———
  const etatSauvegarde = el('p', { class: 'sauvegarde-etat' });
  // Aide gardée d'un rendu à l'autre, jusqu'à la sortie de l'écran. Pas de zone annoncée ici : un seul message
  // court est lu (annoncer), l'aide détaillée se lit au balayage.
  const aideSauvegarde = el('div', { class: 'sauvegarde-aide' });
  const boutonSauvegarder = el('button', {
    class: 'bouton bouton-principal bouton-plein',
    type: 'button',
    // Synchrone : le téléchargement part dans le toucher, sans attente (sinon le navigateur peut le bloquer).
    onclick: () => {
      const resultat = courant.actions.sauvegarder();
      if (!resultat) {
        annoncer('Les plats sont encore en chargement. Réessayez dans un instant.');
        return;
      }
      // replaceChildren écrirait « null » pour un élément absent : seuls les éléments présents sont passés.
      aideSauvegarde.replaceChildren(...[
        el('p', { class: 'aide' },
          'Téléchargement lancé. Vérifiez qu’il est dans «\u00A0Téléchargements\u00A0», puis mettez-le à l’abri, dans Google Drive par exemple. Gardez-le pour vous\u00A0: il contient les adresses des profils.'),
        resultat.horsLigne ? el('p', { class: 'aide' }, texteCopieLocale()) : null,
        (resultat.aCorriger ?? []).length
          ? el('ul', { class: 'liste-a-corriger' }, resultat.aCorriger.map(({ id, nom }) => el('li', {},
            el('p', {}, `⚠️ La recette de «\u00A0${nom}\u00A0» est abîmée\u00A0: elle ne pourra pas être reprise depuis cette sauvegarde. Corrigez-la dans l’app.`),
            el('a', { class: 'lien-fiche', href: `#/plat/${encodeURIComponent(id)}` }, `Ouvrir «\u00A0${nom}\u00A0» ›`),
          )))
          : null,
      ].filter(Boolean));
      annoncer(resumeSauvegarde(resultat, { dansReglages: true }));
    },
  }, '⬇️ Télécharger une sauvegarde');
  const carteSauvegarde = el('section', { class: 'carte carte-sauvegarde' },
    el('h2', {}, 'Sauvegarde'),
    el('p', { class: 'texte-doux' }, 'Un fichier avec vos plats, leurs recettes, vos notes et les profils. Les photos n’y sont pas.'),
    etatSauvegarde,
    boutonSauvegarder,
    aideSauvegarde,
    el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/restaurer' }, 'Restaurer une sauvegarde ›'),
  );

  function remplirSauvegarde() {
    etatSauvegarde.textContent = texteEtatSauvegarde(courant.reglages?.derniereSauvegarde);
    // Avant le chargement, le fichier serait incomplet.
    boutonSauvegarder.disabled = !(courant.platsCharges && courant.profilsCharges);
  }

  function remplir() {
    remplirSauvegarde();
    gestionnaire.textContent = courant.reglages?.gestionnaire ?? '';
    const profils = trierProfils(courant.profils);
    const cleFocus = listeProfils.contains(document.activeElement) ? document.activeElement.dataset.cle : null;
    if (!courant.profilsCharges) {
      listeProfils.replaceChildren(
        el('div', { class: 'section-titre' }, el('h2', {}, 'Profils du foyer')),
        el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des profils…'),
      );
      return;
    }
    const aujourdhui = aujourdhuiDe(courant);
    listeProfils.replaceChildren(
      el('div', { class: 'section-titre' }, el('h2', {}, 'Profils du foyer')),
      profils.length
        ? el('ul', { class: 'liste-profils' }, profils.map((profil) => el('li', {},
          el('button', { class: 'carte-plat', type: 'button', 'data-cle': profil.id, onclick: () => ouvrirFicheProfil(lireCtx, profil) },
            el('span', { class: 'avatar', 'data-initiale': Array.from(profil.nom || '?')[0].toLocaleUpperCase('fr-FR'), 'aria-hidden': 'true' }),
            el('span', { class: 'carte-plat-texte' },
              el('span', { class: 'carte-plat-nom' }, profil.nom),
              el('span', { class: 'carte-plat-detail' },
                [libellePortion(profil.coefPortion), profil.email || 'sans adresse', mentionRegime(profil), mentionAge(profil, aujourdhui)]
                  .filter(Boolean).join(' · ')),
            ),
            el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
          ),
          lienAAjouter(profil, aujourdhui))))
        : el('p', { class: 'texte-doux' }, 'Ajoutez les membres du foyer\u00A0: les deux adultes et l’enfant.'),
      el('button', {
        class: 'bouton bouton-secondaire bouton-plein',
        type: 'button',
        'data-cle': 'ajouter',
        onclick: () => ouvrirFicheProfil(lireCtx, null),
      }, '＋ Ajouter un profil'),
    );
    // Le bouton qui avait le focus (rendu par la feuille à sa fermeture) le retrouve après la mise à jour.
    if (cleFocus) listeProfils.querySelector(`[data-cle="${CSS.escape(cleFocus)}"]`)?.focus();
  }

  remplir();

  return {
    noeud: el('div', { class: 'vue' },
      enteteVue('Réglages'),
      el('section', { class: 'carte' },
        el('dl', { class: 'ligne-info' }, el('dt', {}, 'Recettes et réglages'), gestionnaire),
      ),
      listeProfils,
      carteSauvegarde,
      carteProjetClaude.noeud,
      carteRelecture.noeud,
      etatVide({
        emoji: '⚙️',
        teinte: 'olive',
        titre: 'D’autres réglages arrivent',
        texte: 'Les rayons du magasin et les appareils trouveront leur place ici.',
      }),
    ),
    maj(nouveau) {
      courant = nouveau;
      remplir();
      carteProjetClaude.maj(nouveau);
      carteRelecture.maj(nouveau);
    },
    detruire() {
      carteProjetClaude.detruire();
    },
  };
}
