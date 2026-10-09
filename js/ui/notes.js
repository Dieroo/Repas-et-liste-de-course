// Section « Notes » de la fiche : une ligne par profil. Soi et l'enfant sans adresse se notent ici (« Jamais » à
// part, cinq étoiles en dessous, « Effacer ») ; les autres profils sont en lecture seule. Construite une fois par
// profil, puis mise à jour en place : une note arrivée de l'autre appareil ne fait pas perdre le focus.
// Typographie : espace insécable avant « : » (\u00A0), espace fine insécable avant « ? » (\u202F).
import { el, annoncer } from './dom.js';
import { trierProfils } from '../coeur/profils.js';
import {
  LIBELLES_NOTE, NOTE_MAX, TEXTE_NON_NOTE, avecNote, deNom, noteDe, noteValide, profilsNotables,
} from '../coeur/notes.js';

const NS = 'http://www.w3.org/2000/svg';

/** « J’aime bien » → « j’aime bien » */
const minuscule = (texte) => texte.charAt(0).toLowerCase() + texte.slice(1);

/** « 1 étoile : pas trop », « 4 étoiles : j’aime bien » */
function nomEtoile(n) {
  return `${n}\u00A0étoile${n > 1 ? 's' : ''}\u00A0: ${minuscule(LIBELLES_NOTE[n])}`;
}

/** Étoile au trait (currentColor), construite nœud par nœud ; la feuille de style la remplit jusqu'à la note. */
function etoile() {
  const svg = document.createElementNS(NS, 'svg');
  for (const [nom, valeur] of Object.entries({ viewBox: '0 0 24 24', class: 'etoile-forme', 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(nom, valeur);
  }
  const forme = document.createElementNS(NS, 'path');
  forme.setAttribute('d', 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z');
  svg.append(forme);
  return svg;
}

/** État d'une ligne modifiable : « J’aime bien », « Jamais · ne vous sera plus proposé », « Pas encore noté… ». */
function texteEtat(note, { estMoi, nom }) {
  if (note === null) return TEXTE_NON_NOTE;
  if (note === 0) return estMoi ? 'Jamais · ne vous sera plus proposé' : `Jamais · ne sera plus proposé à ${nom}`;
  return LIBELLES_NOTE[note];
}

/**
 * Section « Notes » d'une fiche. Écrit par ctx.actions.noter (affichage immédiat, envoi jamais attendu).
 * → { noeud, maj(ctx) } ; noeud = section.fiche-section.notes-profils
 */
export function sectionNotes(ctx, platId) {
  let courant = ctx;
  let cle = null;
  let lignes = []; // { profilId, noeud, maj(note) }

  const titre = el('h2', { tabindex: '-1' }, 'Notes');
  // Personne non reconnue : seules les lignes de l'enfant sont modifiables ; « Qui êtes-vous ? » relie son prénom.
  const enteteRelier = el('div', { class: 'notes-relier', hidden: true },
    el('p', {}, 'Pour noter à votre nom\u00A0:'),
    el('button', {
      class: 'bouton bouton-secondaire',
      type: 'button',
      onclick: () => courant.actions.ouvrirQuiEtesVous({
        // La feuille est déjà refermée : le focus revient à la section, dont les lignes viennent de changer.
        surRelie: () => {
          if (titre.isConnected) titre.focus();
        },
      }),
    }, 'Qui êtes-vous\u202F?'));
  const liste = el('div', { class: 'notes-liste' });
  const statut = el('p', { class: 'visuellement-masque', role: 'status' });
  const noeud = el('section', { class: 'fiche-section notes-profils' }, titre, enteteRelier, liste, statut);

  const platCourant = () => courant.plats?.find((plat) => plat.id === platId);

  function dire(texte) {
    statut.textContent = statut.textContent === texte ? `${texte}\u00A0` : texte;
  }

  function surEchec(code) {
    annoncer(code === 'supprime' ? 'Ce plat a été supprimé entre-temps.' : 'La note n’a pas pu être enregistrée. Réessayez.');
  }

  /**
   * Note envoyée par l'app, qui l'affiche tout de suite (la fiche redessine cette section). Si ce rendu n'est pas
   * encore arrivé, la section se met à jour d'elle-même : l'état passe au libellé dès le toucher.
   */
  function ecrire(profilId, note) {
    courant.actions.noter(platId, profilId, note, { surEchec });
    const voulue = noteValide(note) ? note : null;
    const plat = platCourant();
    if (plat && noteDe(plat, profilId) !== voulue) {
      courant = { ...courant, plats: courant.plats.map((p) => (p.id === platId ? avecNote(p, profilId, voulue) : p)) };
      maj();
    }
  }

  function ligneModifiable(profil, estMoi) {
    const nom = String(profil.nom ?? '');
    const groupe = `note-${profil.id}`;
    // Six options d'un même groupe : aux flèches, on passe de « Jamais » à 5 étoiles ; chaque pas écrit.
    const options = Array.from({ length: NOTE_MAX + 1 }, (_, note) => {
      const input = el('input', {
        type: 'radio',
        name: groupe,
        value: String(note),
        'data-repere': `${profil.id}:${note}`,
        onchange: () => {
          if (!input.checked) return;
          ecrire(profil.id, note);
          dire(note === 0
            ? `${nom}\u00A0: jamais.`
            : `${nom}\u00A0: ${note}\u00A0étoile${note > 1 ? 's' : ''}, ${minuscule(LIBELLES_NOTE[note])}.`);
        },
      });
      return input;
    });
    const etoiles = el('div', { class: 'etoiles' }, options.slice(1).map((input, i) => el('label', { class: 'etoile' },
      input,
      etoile(),
      el('span', { class: 'visuellement-masque' }, nomEtoile(i + 1)))));
    const etat = el('p', { class: 'notes-etat', tabindex: '-1' });
    const effacer = el('button', {
      class: 'bouton bouton-texte',
      type: 'button',
      'data-repere': `${profil.id}:effacer`,
      'aria-label': `Effacer la note ${deNom(nom)}`,
      onclick: () => {
        // Le bouton disparaît avec la note : le focus passe d'abord à l'état, qui dira « Pas encore noté… » (la
        // fiche, redessinée pendant l'écriture, le lui rend).
        etat.focus();
        ecrire(profil.id, null);
        dire(`Note ${deNom(nom)} effacée\u00A0: elle compte comme Pourquoi pas.`);
      },
    }, 'Effacer');

    const ligne = el('div', { class: 'notes-profil' },
      el('fieldset', { class: 'notes-choix' },
        el('legend', { class: 'visuellement-masque' }, `Note ${deNom(nom)}`),
        el('div', { class: 'notes-haut' },
          // Soi : « Adulte A · vous » ; l'enfant, noté par ses parents : « 🧸 Pour <Enfant> » (T2c-1).
          el('p', { class: 'notes-nom', 'aria-hidden': 'true' },
            estMoi
              ? [nom, el('span', { class: 'notes-vous' }, ' · vous')]
              : [el('span', {}, '🧸\u00A0'), `Pour ${nom}`]),
          el('label', { class: 'option-jamais' },
            options[0],
            el('span', { 'aria-hidden': 'true' }, '👎'),
            el('span', {}, 'Jamais'))),
        etoiles),
      el('div', { class: 'notes-bas' }, etat, effacer));

    return {
      profilId: profil.id,
      noeud: ligne,
      maj(note) {
        for (const [valeur, input] of options.entries()) input.checked = valeur === note;
        etoiles.dataset.note = note === null ? '' : String(note);
        etat.textContent = texteEtat(note, { estMoi, nom });
        effacer.hidden = note === null;
      },
    };
  }

  /** « Adulte B · ★★★★☆ J’aime bien », « Adulte B · 👎 Jamais », « Adulte B · Pas encore noté… ». */
  function ligneLecture(profil) {
    const valeur = el('span', {});
    const ligne = el('p', { class: 'notes-profil notes-lecture' },
      el('span', { class: 'notes-nom' }, String(profil.nom ?? '')),
      el('span', { 'aria-hidden': 'true' }, ' · '),
      el('span', { class: 'visuellement-masque' }, '\u00A0: '),
      valeur);
    return {
      profilId: profil.id,
      noeud: ligne,
      maj(note) {
        if (note === null) {
          valeur.replaceChildren(TEXTE_NON_NOTE);
        } else if (note === 0) {
          valeur.replaceChildren(el('span', { 'aria-hidden': 'true' }, '👎\u00A0'), LIBELLES_NOTE[0]);
        } else {
          valeur.replaceChildren(
            el('span', { class: 'etoiles-texte', 'aria-hidden': 'true' }, `${'★'.repeat(note)}${'☆'.repeat(NOTE_MAX - note)}`),
            el('span', { class: 'visuellement-masque' }, `${note}\u00A0étoile${note > 1 ? 's' : ''}, `),
            `\u00A0${LIBELLES_NOTE[note]}`);
        }
      },
    };
  }

  function maj(nouveau) {
    if (nouveau) courant = nouveau;
    const profils = trierProfils(courant.profils ?? []);
    // Soi, puis l'enfant sans adresse (modifiables), puis les autres profils (lecture seule). Les notes d'un profil
    // supprimé ne sont pas affichées.
    const notables = profilsNotables(profils, courant.moi ?? null);
    const modifiables = new Set(notables.map(({ profil }) => profil.id));
    const lecture = profils.filter((profil) => !modifiables.has(profil.id));
    const nouvelleCle = [
      ...notables.map(({ profil, estMoi }) => `${profil.id}:${profil.nom}:${estMoi ? 'moi' : 'oui'}`),
      ...lecture.map((profil) => `${profil.id}:${profil.nom}:non`),
    ].join('|');

    if (nouvelleCle !== cle) {
      // Profils changés : lignes reconstruites ; l'élément qui avait le focus le retrouve s'il existe encore.
      const actif = document.activeElement;
      const repere = liste.contains(actif) ? actif.dataset?.repere : null;
      cle = nouvelleCle;
      lignes = [
        ...notables.map(({ profil, estMoi }) => ligneModifiable(profil, estMoi)),
        ...lecture.map(ligneLecture),
      ];
      liste.replaceChildren(...lignes.map((ligne) => ligne.noeud));
      if (repere) liste.querySelector(`[data-repere="${CSS.escape(repere)}"]`)?.focus();
    }

    enteteRelier.hidden = Boolean(courant.moi) || !profils.length;
    noeud.hidden = !profils.length;
    const plat = platCourant();
    for (const ligne of lignes) ligne.maj(noteDe(plat, ligne.profilId));
  }

  maj();

  return { noeud, maj };
}
