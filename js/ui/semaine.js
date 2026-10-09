// Écran Semaine (accueil) : salutation, jours de la semaine, carte d'accueil ; pour le gestionnaire (hors aperçu
// « Repas et courses »), la carte « Idées de plats » qui copie une demande pour le projet Claude.
import { el, enteteVue, pastille } from './dom.js';
import { prenomDe } from './profil.js';
import { ouvrirFeuille } from './feuille.js';
import { copier } from './presse-papiers.js';
import {
  IDEES_ENVIE_MAX, IDEES_NOMBRES, IDEES_NOMBRE_DEFAUT, IDEES_PAR_MESSAGE, texteDemandeIdees,
} from '../coeur/claude.js';

const NOMS_JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

const formatDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const formatJourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

// Contexte du dernier écran Semaine monté, mis à jour en direct : la feuille « Idées de plats » copie la demande avec
// les plats et les profils du moment, même si l'écran a été reconstruit pendant qu'elle était ouverte.
let contexteSemaine = null;

// Nombre et envie de la dernière demande copiée pendant cette visite : la feuille rouverte (copie à refaire) les
// reprend. Rien n'est gardé sur le téléphone.
let derniereDemande = null;

function salutation(maintenant) {
  const heure = maintenant.getHours();
  return heure >= 18 || heure < 5 ? 'Bonsoir' : 'Bonjour';
}

/** Les 7 jours de la semaine en cours, du dimanche au samedi. */
function joursDeLaSemaine(maintenant) {
  const dimanche = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - maintenant.getDay());
  return NOMS_JOURS.map((nom, i) => {
    const date = new Date(dimanche.getFullYear(), dimanche.getMonth(), dimanche.getDate() + i);
    return { nom, date, ecart: i - maintenant.getDay() };
  });
}

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
 * Écran reconstruit seulement quand sa clé change (jour, salutation, rôle, aperçu) ; `maj(ctx)` garde le contexte à
 * jour pour la feuille « Idées de plats ». `ctx.role` est le rôle affiché : « courses » en aperçu.
 */
export function creer(ctx) {
  contexteSemaine = ctx;
  const maintenant = new Date();
  const prenom = prenomDe(ctx.utilisateur);
  const jours = joursDeLaSemaine(maintenant);
  const premier = jours[0].date;
  const dernier = jours[6].date;

  const noeud = el('div', { class: 'vue' },
    enteteVue(prenom ? `${salutation(maintenant)} ${prenom}` : salutation(maintenant), formatDate.format(maintenant)),

    el('section', { class: 'carte carte-ligne' },
      pastille('🍲'),
      el('div', { class: 'carte-texte' },
        el('h2', {}, 'Tout est prêt'),
        el('p', {}, 'Bientôt ici\u00A0: le repas de chacun ce soir, et la prochaine chose à faire — les courses le samedi, le batch le dimanche.'),
      ),
    ),

    el('section', { class: 'section', 'aria-labelledby': 'titre-cette-semaine' },
      el('div', { class: 'section-titre' },
        el('h2', { id: 'titre-cette-semaine' }, 'Cette semaine'),
        el('p', {}, formatJourMois.formatRange(premier, dernier)),
      ),
      el('ol', { class: 'jours' },
        jours.map(({ nom, date, ecart }) => el('li', {
          class: ['jour', ecart === 0 ? 'aujourdhui' : '', ecart < 0 ? 'passe' : ''].filter(Boolean).join(' '),
          'aria-current': ecart === 0 ? 'date' : null,
        },
        el('span', { class: 'visuellement-masque' }, formatDate.format(date)),
        el('span', { class: 'jour-nom', 'aria-hidden': 'true' }, nom),
        el('span', { class: 'jour-numero', 'aria-hidden': 'true' }, String(date.getDate())),
        )),
      ),
    ),

    ctx.role === 'gestionnaire' ? carteIdees() : null,
  );

  return {
    noeud,
    maj(nouveau) {
      contexteSemaine = nouveau;
    },
  };
}
