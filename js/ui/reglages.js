// Écran Réglages (gestionnaire) : rôle, profils du foyer, sauvegarde.
import { el, enteteVue, etatVide, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { copier } from './presse-papiers.js';
import { PORTIONS, NOM_PROFIL_MAX, trierProfils, preparerProfil, libellePortion } from '../coeur/profils.js';
import { dateDeSauvegarde, joursDepuis } from '../coeur/sauvegarde.js';
import { REGIMES, lireRegime } from '../coeur/regles.js';

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
    const portions = PORTIONS.map((p) => el('label', { class: 'choix' },
      el('input', {
        type: 'radio', name: 'portion', value: String(p.valeur),
        checked: (existant?.coefPortion ?? 1) === p.valeur,
      }),
      el('span', {}, p.libelle),
    ));

    // « Ce que <Prénom> mange » : écran à part (les changements de la feuille non enregistrés y sont abandonnés).
    const ligneRegime = existant
      ? el('button', {
        class: 'bouton bouton-secondaire bouton-plein ligne-regime',
        type: 'button',
        onclick: () => {
          fermer();
          location.hash = `#/regime/${encodeURIComponent(existant.id)}`;
        },
      }, `🍽️ Ce que ${nomAffiche} mange\u00A0: ${regimeDe(existant).libelle} ›`)
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
 * attente, et le repli de copie fonctionne. → { noeud, detruire }
 */
function creerCarteProjetClaude(ctx) {
  let instructions = null;
  let detruit = false;
  const etat = el('p', { class: 'aide', role: 'status' });
  const bouton = el('button', {
    class: 'bouton bouton-secondaire bouton-plein',
    type: 'button',
    disabled: true,
    onclick: async () => {
      if (!instructions) return;
      const reussi = await copier(instructions);
      etat.textContent = reussi
        ? 'Copié. Collez-le dans les instructions de votre projet Claude.'
        : 'La copie n’a pas marché. Réessayez.';
      etat.hidden = false;
    },
  }, el('span', { 'aria-hidden': 'true' }, '📋'), 'Copier les instructions du projet');
  const reessayer = el('button', { class: 'bouton bouton-texte', type: 'button', hidden: true, onclick: lire }, 'Réessayer');

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

  lire();
  return {
    noeud: el('section', { class: 'carte carte-projet-claude' },
      el('h2', {}, 'Projet Claude'),
      el('p', { class: 'texte-doux' },
        'Les instructions qui apprennent à votre projet Claude à écrire les recettes et les versions pour l’app.'),
      bouton,
      etat,
      reessayer,
      el('p', { class: 'aide' }, 'Le plus simple\u00A0: faites-le depuis l’ordinateur, où vous modifiez votre projet Claude.'),
      el('a', { class: 'lien-fiche', href: './docs/projet-claude.md', target: '_blank', rel: 'noopener' },
        'Ouvrir les instructions ›'),
    ),
    detruire() {
      detruit = true;
    },
  };
}

export function creer(ctx) {
  let courant = ctx;
  const carteProjetClaude = creerCarteProjetClaude(ctx);
  const gestionnaire = el('dd', {});
  const listeProfils = el('div', { class: 'section' });

  const lireCtx = () => courant;

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
    listeProfils.replaceChildren(
      el('div', { class: 'section-titre' }, el('h2', {}, 'Profils du foyer')),
      profils.length
        ? el('ul', { class: 'liste-profils' }, profils.map((profil) => el('li', {},
          el('button', { class: 'carte-plat', type: 'button', 'data-cle': profil.id, onclick: () => ouvrirFicheProfil(lireCtx, profil) },
            el('span', { class: 'avatar', 'data-initiale': Array.from(profil.nom || '?')[0].toLocaleUpperCase('fr-FR'), 'aria-hidden': 'true' }),
            el('span', { class: 'carte-plat-texte' },
              el('span', { class: 'carte-plat-nom' }, profil.nom),
              el('span', { class: 'carte-plat-detail' },
                [libellePortion(profil.coefPortion), profil.email || 'sans adresse', mentionRegime(profil)]
                  .filter(Boolean).join(' · ')),
            ),
            el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
          ))))
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
    },
    detruire() {
      carteProjetClaude.detruire();
    },
  };
}
