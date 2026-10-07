// Écran Découvrir : un plat à la fois, noté d'un toucher (👎 Jamais, 👍 Pourquoi pas, ❤️ J’adore), pour soi ou à
// la place de l'enfant. Rien n'est écrit à l'ouverture : seulement au toucher d'un geste ou d'« Annuler ».
// Typographie : espace insécable avant « : » (\u00A0).
import { el, etatVide, pastille, annoncer } from './dom.js';
import { vignetteDuPlat } from './plats.js';
import { modeDeCuisson } from './pictos.js';
import { carteQuiEtesVous } from './relier.js';
import { garderPour } from './compat.js';
import { LIBELLES_TYPE, STATUTS, statutDe, typeDe, visuelDuPlat } from '../coeur/plats.js';
import {
  GESTES,
  profilsNotables,
  fileDecouverte,
  suivant,
  completerFile,
  grainePour,
  texteIngredients,
  nombreANoter,
  bilan,
  noteDe,
  noteValide,
  estNote,
  avecNote,
} from '../coeur/notes.js';

// Files de chaque profil, gardées au niveau du module pour le compte connecté : revenir sur l'onglet retrouve la
// même carte ; un autre compte repart de zéro. La pile « Annuler » et le profil choisi repartent à chaque ouverture.
const memoire = { uid: null, files: new Map() }; // profilId → { file: [platId], position }

// Verrou après un geste : sortie (200 ms) et entrée (180 ms) de la carte, plus le délai de double toucher
// d'Android (300 ms). Un double toucher involontaire ne note jamais une carte pas encore lue.
const VERROU_MS = 700;
const VERROU_REDUIT_MS = 400;
const DUREE_SORTIE_MS = 200;
const DUREE_ENTREE_MS = 180;

const CLASSES_GESTE = { 0: 'geste-jamais', 3: 'geste-pourquoi-pas', 5: 'geste-adore' };

const mouvementReduit = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Vibration légère (CLAUDE.md §4) ; ❤️ vibre deux fois. 40 ms : plus court, beaucoup de téléphones ne vibrent pas. */
function vibrer(note) {
  try {
    navigator.vibrate?.(note === 5 ? [40, 80, 40] : 40);
  } catch {
    // Vibration refusée ou absente : le geste compte quand même.
  }
}

/** « J’adore » → « j’adore » */
const minuscule = (texte) => texte.charAt(0).toLowerCase() + texte.slice(1);

function retirer(liste, element) {
  const i = liste.indexOf(element);
  if (i >= 0) liste.splice(i, 1);
}

/** Vrai s'il existe au moins un plat que Découvrir sait montrer : un nom, et pas une préparation. */
const aDesPlats = (plats) => (plats ?? []).some((plat) => String(plat?.nom ?? '').trim() && typeDe(plat) !== 'preparation');

/** Titre d'un état vide qui peut recevoir le focus (fin de file, changement d'état). */
function focalisable(section) {
  section.querySelector('h2')?.setAttribute('tabindex', '-1');
  return section;
}

export function creer(ctx) {
  let courant = ctx;
  let actif = true;
  const uid = ctx.utilisateur?.uid ?? null;
  if (memoire.uid !== uid) {
    memoire.uid = uid;
    memoire.files = new Map();
  }

  let profilChoisi = ctx.moi?.id ?? null; // chaque ouverture repart sur soi
  let moiAttendu = null; // profil relié par « C'est moi », en attendant qu'il arrive dans ctx.moi
  let pile = []; // gestes qu'« Annuler » peut défaire, du plus ancien au plus récent
  const visite = []; // gestes de la visite, pour l'écran de fin
  const jamaisExplique = new Set(); // profils à qui le premier « Jamais » de la visite a été expliqué
  let afficheId = null; // plat montré par la carte
  let enSortie = false; // la carte notée sort : son contenu ne change qu'à la fin de l'animation
  let animation = null;
  let animationAVenir = null; // classe d'animation de la prochaine carte posée
  let focusTitreAVenir = false;
  let minuteurVerrou = null;
  let cleEtat = null;
  let cleProfils = '';
  let radios = [];
  let relier = null;
  let cleVisuel = '';
  let boutonsFin = new Map(); // profilId → bouton « Noter pour … (n) » de l'écran de fin affiché

  // ——— Nœuds gardés d'un rendu à l'autre : la carte affichée n'est jamais reconstruite, le focus reste. ———

  const titreEcran = el('h1', { tabindex: '-1' }, 'Découvrir');
  const compteurVisible = el('span', { 'aria-hidden': 'true' });
  const compteurMasque = el('span', { class: 'visuellement-masque' });
  // Pas de role=status : le compteur se met à jour sans annonce.
  const compteur = el('p', { class: 'decouvrir-compteur', hidden: true }, compteurVisible, compteurMasque);
  const aide = el('p', { class: 'decouvrir-aide', hidden: true },
    'Sans réponse, un plat compte comme «\u00A0Pourquoi pas\u00A0».');
  const zoneRelier = el('div', { class: 'zone-relier', hidden: true });

  const choixProfils = el('div', { class: 'choix-profils' });
  const groupeProfils = el('fieldset', { class: 'groupe-choix je-note-pour', hidden: true },
    el('legend', { class: 'legende-je-note-pour' }, 'Je note pour'),
    choixProfils);

  const visuel = el('div', { class: 'decouverte-visuel' });
  const ruban = el('p', { class: 'ruban-profil', id: 'decouverte-ruban', hidden: true });
  const titre = el('h2', { class: 'decouverte-nom', id: 'decouverte-nom', tabindex: '-1' });
  const detail = el('p', { class: 'decouverte-detail' });
  const ingredients = el('p', { class: 'decouverte-ingredients' });
  // « 🌿 Votre version : Part au thon » : le plat se mange grâce à la version de la fiche pour ce profil.
  const texteVersion = el('span', {});
  const version = el('p', { class: 'decouverte-version compat-version', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '🌿\u00A0'), texteVersion);
  const carte = el('article', { class: 'carte-decouverte', 'aria-labelledby': titre.id },
    visuel, ruban, titre, detail, ingredients, version);
  // La scène coupe ce qui dépasse sur les côtés : la carte qui sort ne crée jamais de défilement horizontal.
  const scene = el('div', { class: 'scene-decouverte', hidden: true }, carte);
  const zoneEtat = el('div', { class: 'zone-etat', hidden: true });

  const boutonsGestes = GESTES.map((geste) => el('button', {
    class: `geste ${CLASSES_GESTE[geste.note] ?? ''}`,
    type: 'button',
    'aria-describedby': titre.id,
    onclick: () => toucher(geste),
  },
  el('span', { class: 'geste-emoji', 'aria-hidden': 'true' }, geste.emoji),
  el('span', { class: 'geste-libelle' }, geste.libelle)));
  const aideGestes = el('p', { class: 'aide-gestes' });
  const nomAnnule = el('span', { class: 'annuler-nom' });
  const gesteAnnule = el('span', {});
  const boutonAnnuler = el('button', {
    class: 'bouton bouton-texte bouton-annuler-geste',
    type: 'button',
    hidden: true,
    onclick: annuler,
  },
  el('span', { 'aria-hidden': 'true' }, '↶'),
  el('span', {}, 'Annuler\u00A0:'),
  nomAnnule,
  gesteAnnule);
  const barre = el('div', { class: 'barre-gestes', hidden: true },
    el('div', { class: 'barre-gestes-contenu' },
      el('div', { class: 'gestes-boutons' }, boutonsGestes),
      el('div', { class: 'sous-gestes' }, aideGestes, boutonAnnuler)));

  // Confirmations propres à l'écran (une par geste) ; le bandeau annoncer() reste aux échecs et aux surprises.
  const statut = el('p', { class: 'visuellement-masque', role: 'status' });

  const vue = el('div', { class: 'vue decouvrir' },
    el('header', { class: 'decouvrir-entete' }, titreEcran, compteur),
    zoneRelier,
    aide,
    groupeProfils,
    scene,
    zoneEtat,
    barre,
    statut);

  // La page réserve la hauteur réelle de la barre (texte agrandi compris) ; le bandeau d'annonce passe au-dessus.
  const observateur = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (barre.hidden || !barre.isConnected) return;
      document.body.style.setProperty('--hauteur-gestes', `${Math.ceil(barre.getBoundingClientRect().height)}px`);
    })
    : null;
  observateur?.observe(barre);

  // ——— Outils ———

  const trouver = (id) => (id == null ? undefined : courant.plats.find((plat) => plat.id === id));

  function moiEffectif() {
    if (courant.moi) return courant.moi;
    return moiAttendu ? courant.profils?.find((profil) => profil.id === moiAttendu) ?? null : null;
  }

  function profilActuel() {
    if (!courant.profils?.length || profilChoisi === null) return null;
    return profilsNotables(courant.profils, moiEffectif()).find(({ profil }) => profil.id === profilChoisi) ?? null;
  }

  function dire(texte) {
    // Même texte deux fois de suite : une espace de plus pour qu'il soit relu.
    statut.textContent = statut.textContent === texte ? `${texte}\u00A0` : texte;
  }

  function verrouiller() {
    clearTimeout(minuteurVerrou);
    barre.classList.add('en-pause');
    minuteurVerrou = setTimeout(() => {
      minuteurVerrou = null;
      barre.classList.remove('en-pause');
    }, mouvementReduit() ? VERROU_REDUIT_MS : VERROU_MS);
  }

  /** Anime la carte (classe CSS), puis `ensuite()`. Un minuteur de secours remplace un animationend manqué. */
  function animer(classe, duree, ensuite) {
    arreterAnimation();
    if (mouvementReduit()) {
      ensuite?.();
      return;
    }
    void carte.offsetWidth; // la même classe, reposée, rejoue son animation
    const fin = () => {
      if (animation?.fin !== fin) return;
      arreterAnimation();
      ensuite?.();
    };
    const surFin = (evenement) => {
      if (evenement.target === carte) fin();
    };
    carte.classList.add(classe);
    carte.addEventListener('animationend', surFin);
    animation = { classe, fin, surFin, minuteur: setTimeout(fin, duree + 150) };
  }

  function arreterAnimation() {
    if (!animation) return;
    clearTimeout(animation.minuteur);
    carte.removeEventListener('animationend', animation.surFin);
    carte.classList.remove(animation.classe);
    animation = null;
  }

  /** La carte notée part vers le bouton touché ; la suivante entre à la fin (échange immédiat en mouvement réduit). */
  function lancerSortie(sortie) {
    if (mouvementReduit()) {
      afficheId = null;
      return;
    }
    enSortie = true;
    animer(`sort-${sortie}`, DUREE_SORTIE_MS, () => {
      enSortie = false;
      afficheId = null;
      animationAVenir = 'entre';
      afficher();
    });
  }

  function arreterSortie() {
    if (!enSortie) return;
    enSortie = false;
    arreterAnimation();
    afficheId = null;
  }

  function oublierPile() {
    pile = [];
    arreterSortie();
  }

  /**
   * Note envoyée par l'app, qui l'affiche tout de suite (son rendu revient ici par maj). Si ce rendu n'est pas
   * encore arrivé, la copie de l'écran est mise à jour, pour que le compteur et la file suivent le toucher.
   */
  function ecrire(platId, profilId, note, surEchec) {
    courant.actions.noter(platId, profilId, note, { surEchec });
    const voulue = noteValide(note) ? note : null;
    const plat = trouver(platId);
    if (plat && noteDe(plat, profilId) !== voulue) {
      courant = { ...courant, plats: courant.plats.map((p) => (p.id === platId ? avecNote(p, profilId, voulue) : p)) };
    }
  }

  // ——— File du profil choisi ———

  /**
   * File du profil, calculée une fois puis complétée à chaque mise à jour : plats nouveaux ou dont la note a été
   * effacée ajoutés à la fin, plats notés ailleurs ou supprimés sautés. `noteAilleurs` : la carte affichée vient
   * d'être notée sur un autre appareil.
   */
  function preparerFile(profilId) {
    const graine = grainePour(profilId);
    // Profil qui a des règles : les plats qui attendent encore sa version restent hors de la file ; ils y entrent
    // quand leur version arrive.
    const garder = garderPour(courant, profilId);
    let entree = memoire.files.get(profilId);
    if (!entree) {
      entree = { file: fileDecouverte(courant.plats, profilId, { graine, garder }), position: 0 };
      entree.position = suivant(entree.file, 0, courant.plats, profilId, { garder });
      memoire.files.set(profilId, entree);
      return { entree, noteAilleurs: false };
    }
    const montre = entree.file[entree.position];
    entree.file = completerFile(entree.file, entree.position, courant.plats, profilId, { graine, garder });
    entree.position = suivant(entree.file, entree.position, courant.plats, profilId, { garder });
    const plat = trouver(montre);
    const noteAilleurs = !enSortie && montre !== undefined && montre === afficheId
      && entree.file[entree.position] !== montre && Boolean(plat) && estNote(plat, profilId);
    return { entree, noteAilleurs };
  }

  /** Profil choisi encore notable ; sinon retour au premier profil notable (soi d'abord). → { profil, estMoi } | null */
  function validerProfil(notables) {
    if (profilChoisi === null) profilChoisi = moiEffectif()?.id ?? null;
    if (profilChoisi === null) return null;
    const choisi = notables.find(({ profil }) => profil.id === profilChoisi);
    if (choisi) return choisi;
    const disparu = !courant.profils.some((profil) => profil.id === profilChoisi);
    profilChoisi = notables[0]?.profil.id ?? null;
    oublierPile();
    arreterAnimation();
    afficheId = null;
    if (disparu) annoncer('Ce profil n’existe plus.');
    return notables.find(({ profil }) => profil.id === profilChoisi) ?? null;
  }

  // ——— Carte ———

  /** Remplit la carte (même nœud) ; le visuel n'est remplacé que s'il change (pas de clignotement). */
  function poserCarte(plat, { profil, estMoi }) {
    const nouvelle = plat.id !== afficheId;
    afficheId = plat.id;
    const { emoji, teinte } = visuelDuPlat(plat);
    const cle = `${plat.vignette ?? ''}|${emoji}|${teinte}`;
    if (cle !== cleVisuel) {
      cleVisuel = cle;
      // Vignette de la fiche (10 Ko) ou pastille : jamais la photo, l'écran reste léger, hors ligne compris.
      visuel.replaceChildren(vignetteDuPlat(plat, true));
    }
    const nom = String(plat.nom ?? '');
    if (titre.textContent !== nom) titre.textContent = nom;
    const morceaux = [
      LIBELLES_TYPE[typeDe(plat)] ?? 'Plat',
      modeDeCuisson(plat),
      statutDe(plat) === 'attente' ? `${STATUTS.attente.emoji}\u00A0${STATUTS.attente.libelle}` : null,
    ].filter(Boolean);
    detail.replaceChildren(...morceaux.flatMap((morceau, i) => (i ? [' · ', morceau] : [morceau])));
    ingredients.textContent = texteIngredients(plat);
    ingredients.hidden = !ingredients.textContent;
    const variante = courant.compat?.(plat, profil)?.variante;
    const consigne = typeof variante?.consigne === 'string' ? variante.consigne.trim() : '';
    const texte = variante
      ? `${estMoi ? 'Votre version' : `Version pour ${profil.nom}`}${consigne ? `\u00A0: ${consigne}` : ''}`
      : '';
    if (texteVersion.textContent !== texte) texteVersion.textContent = texte;
    version.hidden = !texte;
    ruban.textContent = `Pour ${profil.nom}`;
    ruban.hidden = estMoi;
    // TalkBack : « J’adore, bouton, Gratin de pâtes au jambon, pour Enfant ».
    const decrit = estMoi ? titre.id : `${titre.id} ${ruban.id}`;
    for (const bouton of boutonsGestes) bouton.setAttribute('aria-describedby', decrit);
    const classe = animationAVenir;
    animationAVenir = null;
    if (nouvelle && classe) animer(classe, classe === 'entre' ? DUREE_ENTREE_MS : DUREE_SORTIE_MS);
  }

  // ——— Gestes ———

  function toucher(geste) {
    if (minuteurVerrou !== null || enSortie) return;
    const choisi = profilActuel();
    const entree = choisi ? memoire.files.get(choisi.profil.id) : null;
    const plat = trouver(afficheId);
    if (!entree || !plat || entree.file[entree.position] !== plat.id) return;
    verrouiller();
    const { profil, estMoi } = choisi;
    const trace = {
      uid,
      platId: plat.id,
      nom: String(plat.nom ?? ''),
      profilId: profil.id,
      nomProfil: profil.nom,
      estMoi,
      avant: noteDe(plat, profil.id),
      apres: geste.note,
      sortie: geste.sortie,
      libelle: geste.libelle,
      emoji: geste.emoji,
    };
    visite.push(trace);
    pile.push(trace);
    // L'index avance dès le toucher : sa propre note, à son arrivée, n'est pas prise pour « notée ailleurs ».
    entree.position += 1;
    vibrer(geste.note);
    lancerSortie(geste.sortie);
    ecrire(trace.platId, trace.profilId, geste.note, (code) => echecDuGeste(code, trace));
    const prochain = trouver(entree.file[suivant(entree.file, entree.position, courant.plats, profil.id, { garder: garderPour(courant, profil.id) })]);
    dire(texteDuGeste(trace, prochain));
    afficher();
  }

  /** Une seule annonce par geste : « Gratin : j’adore, pour Enfant. Suivant : Risotto. » */
  function texteDuGeste(trace, prochain) {
    let texte = `${trace.nom}\u00A0: ${minuscule(trace.libelle)}`;
    if (trace.apres === 0 && !jamaisExplique.has(trace.profilId)) {
      jamaisExplique.add(trace.profilId);
      texte += trace.estMoi
        ? '. Il ne vous sera plus proposé. Tout se change sur sa fiche.'
        : `. Il ne sera plus proposé à ${trace.nomProfil}. Tout se change sur sa fiche.`;
    } else {
      texte += trace.estMoi ? '.' : `, pour ${trace.nomProfil}.`;
    }
    if (prochain) texte += ` Suivant\u00A0: ${prochain.nom}.`;
    return texte;
  }

  function echecDuGeste(code, trace) {
    retirer(pile, trace);
    retirer(visite, trace);
    if (code === 'supprime') {
      annoncer(`«\u00A0${trace.nom}\u00A0» a été supprimé entre-temps.`);
    } else {
      // Le plat revient en fin de file, une seule fois (et pour ce compte seulement).
      const entree = memoire.uid === trace.uid ? memoire.files.get(trace.profilId) : null;
      if (entree && !entree.file.slice(entree.position).includes(trace.platId)) entree.file.push(trace.platId);
      annoncer(`Note non enregistrée\u00A0: «\u00A0${trace.nom}\u00A0» reviendra à la fin.`);
    }
    afficher();
  }

  /** Défait le dernier geste de la pile, seulement si sa note n'a pas changé ailleurs depuis. */
  function annuler() {
    // Même verrou que les gestes : un double toucher sur « Annuler » ne défait qu'un geste.
    if (minuteurVerrou !== null) return;
    const trace = pile.pop();
    if (!trace) return;
    const plat = trouver(trace.platId);
    if (!plat) {
      retirer(visite, trace);
      annoncer(`«\u00A0${trace.nom}\u00A0» a été supprimé entre-temps.`);
      afficher();
      return;
    }
    if (noteDe(plat, trace.profilId) !== trace.apres) {
      annoncer('Cette note a été changée sur un autre appareil\u00A0: rien n’est annulé.');
      afficher();
      return;
    }
    retirer(visite, trace);
    arreterSortie();
    arreterAnimation();
    // Le plat revient en tête de file, du côté d'où il était parti.
    const entree = memoire.files.get(trace.profilId);
    if (entree) entree.file.splice(entree.position, 0, trace.platId);
    verrouiller();
    afficheId = null;
    animationAVenir = `revient-${trace.sortie}`;
    focusTitreAVenir = true;
    ecrire(trace.platId, trace.profilId, trace.avant, (code) => annoncer(code === 'supprime'
      ? `«\u00A0${trace.nom}\u00A0» a été supprimé entre-temps.`
      : 'La note n’a pas pu être enregistrée. Réessayez.'));
    dire(`Note annulée\u00A0: ${trace.nom}.`);
    afficher();
  }

  // ——— Profils ———

  function choisirProfil(id) {
    if (id === profilChoisi) return;
    profilChoisi = id;
    oublierPile();
    arreterAnimation();
    afficheId = null;
    afficher();
    const choisi = profilActuel();
    if (choisi) dire(choisi.estMoi ? 'Vous notez maintenant pour vous.' : `Vous notez maintenant pour ${choisi.profil.nom}.`);
  }

  /** « Qui êtes-vous ? » : profil relié, Découvrir repart sur lui (l'annonce « Bienvenue » est faite par la carte). */
  function surRelie(profil) {
    if (!profil?.id) return;
    moiAttendu = courant.moi ? null : profil.id;
    if (profilChoisi !== profil.id) {
      profilChoisi = profil.id;
      oublierPile();
      arreterAnimation();
      afficheId = null;
    }
    afficher();
  }

  /** Puces « Je note pour » : reconstruites seulement si les profils changent ; nombres et choix mis à jour en place. */
  function majProfils(notables) {
    const cle = notables.map(({ profil, estMoi }) => `${profil.id}:${profil.nom}:${estMoi}`).join('|');
    if (cle !== cleProfils) {
      const focusIci = choixProfils.contains(document.activeElement);
      cleProfils = cle;
      radios = notables.map(({ profil }) => {
        const input = el('input', {
          type: 'radio',
          name: 'je-note-pour',
          value: profil.id,
          onchange: () => {
            if (input.checked) choisirProfil(profil.id);
          },
        });
        const compte = el('span', { class: 'choix-compte' });
        const masque = el('span', { class: 'visuellement-masque' });
        const etiquette = el('label', { class: 'choix choix-profil' },
          input,
          el('span', { class: 'choix-profil-texte', 'aria-hidden': 'true' },
            el('span', { class: 'choix-nom' }, profil.nom), compte),
          masque);
        return { id: profil.id, nom: profil.nom, input, compte, masque, etiquette };
      });
      choixProfils.replaceChildren(...radios.map((radio) => radio.etiquette));
      if (focusIci) radios.find((radio) => radio.id === profilChoisi)?.input.focus();
    }
    for (const radio of radios) {
      const reste = nombreANoter(courant.plats, radio.id, { garder: garderPour(courant, radio.id) });
      radio.input.checked = radio.id === profilChoisi;
      // Plats qui attendent leur version : pas encore notés, ils arriveront plus tard.
      const plusTard = !reste && enAttente(radio.id) > 0;
      radio.compte.textContent = reste ? `${reste}\u00A0à noter` : plusTard ? 'plus rien pour l’instant' : 'tout est noté';
      // TalkBack : « Adulte A, 12 plats à noter ».
      let combien = 'aucun plat';
      if (reste === 1) combien = '1\u00A0plat';
      else if (reste > 1) combien = `${reste}\u00A0plats`;
      radio.masque.textContent = `${radio.nom}, ${combien} à noter${plusTard ? ' pour l’instant' : ''}`;
    }
  }

  /** Plats pas encore notés par ce profil mais écartés de sa file : ils attendent sa version. */
  function enAttente(profilId) {
    const tous = nombreANoter(courant.plats, profilId);
    return Math.max(0, tous - nombreANoter(courant.plats, profilId, { garder: garderPour(courant, profilId) }));
  }

  /** « 2 plats attendent votre version : ils arriveront ici dès qu'elle existera. » ; '' s'il n'y en a pas. */
  function phraseAttente(attente, { profil, estMoi }) {
    if (!attente) return '';
    const version = estMoi ? 'votre version' : `la version de ${profil.nom}`;
    return attente > 1
      ? `${attente}\u00A0plats attendent ${version}\u00A0: ils arriveront ici dès qu’elle existera.`
      : `1\u00A0plat attend ${version}\u00A0: il arrivera ici dès qu’elle existera.`;
  }

  function majCompteur(reste) {
    compteur.hidden = !reste;
    if (!reste) return;
    compteurVisible.textContent = reste > 1 ? `${reste}\u00A0à noter` : 'Dernier plat à noter';
    compteurMasque.textContent = reste > 1 ? `${reste}\u00A0plats pas encore notés` : '1\u00A0plat pas encore noté';
  }

  /** Sous les gestes : l'aide avant le premier geste, puis « ↶ Annuler : <plat> (<geste>) ». */
  function majSousGestes({ profil, estMoi }) {
    const dernier = pile.at(-1);
    aideGestes.hidden = Boolean(dernier);
    boutonAnnuler.hidden = !dernier;
    if (dernier) {
      nomAnnule.textContent = dernier.nom;
      gesteAnnule.textContent = `(${dernier.libelle})`;
      boutonAnnuler.setAttribute('aria-label', `Annuler la note de ${dernier.nom} (${dernier.libelle})`);
      return;
    }
    aideGestes.textContent = estMoi
      ? '«\u00A0Jamais\u00A0»\u00A0: il ne vous sera plus proposé.'
      : `«\u00A0Jamais\u00A0»\u00A0: il ne sera plus proposé à ${profil.nom}.`;
  }

  // ——— États ———

  function etatSansProfil(gestionnaire) {
    return focalisable(etatVide({
      emoji: '👪',
      teinte: 'olive',
      titre: 'Les profils du foyer manquent',
      texte: gestionnaire
        ? 'Ajoutez-les dans Réglages\u00A0: les deux adultes et l’enfant.'
        : 'Ils s’ajoutent dans les réglages de l’app.',
    }, gestionnaire ? el('a', { class: 'bouton bouton-principal', href: '#/reglages' }, '⚙️ Ouvrir les réglages') : null));
  }

  function etatSansPlat(gestionnaire) {
    return focalisable(etatVide({
      emoji: '🥘',
      teinte: 'ocre',
      titre: 'Aucun plat pour l’instant',
      texte: gestionnaire
        ? 'Ajoutez vos recettes\u00A0: elles apparaîtront ici, une à une.'
        : 'Ajoutez un plat par son nom\u00A0: il apparaîtra ici.',
    }, gestionnaire
      ? el('a', { class: 'bouton bouton-principal', href: '#/import' }, '📋 Ajouter des recettes')
      : el('a', { class: 'bouton bouton-principal', href: '#/plats' }, 'Voir les plats')));
  }

  /** Plus rien à noter pour ce profil : « Tous les plats sont notés » dès l'ouverture, « Tout est trié 🎉 » après des gestes. */
  function etatDeFin(choisi, notables) {
    const { profil, estMoi } = choisi;
    const gestes = visite.filter((trace) => trace.profilId === profil.id);
    const attente = phraseAttente(enAttente(profil.id), choisi);
    const autres = notables
      .filter((notable) => notable.profil.id !== profil.id)
      .map((notable) => ({ ...notable, reste: nombreANoter(courant.plats, notable.profil.id, { garder: garderPour(courant, notable.profil.id) }) }))
      .filter((notable) => notable.reste > 0);
    // Les nombres restent hors de la clé : ils changent en place, sans reconstruire l'écran (le focus reste).
    const cleAutres = autres.map((a) => `${a.profil.id}:${a.profil.nom}:${a.estMoi}`).join(',');
    const texteAutre = (autre) => (autre.estMoi
      ? `Noter pour vous (${autre.reste})`
      : `Noter pour ${autre.profil.nom} (${autre.reste})`);
    const boutonsAutres = () => {
      boutonsFin = new Map();
      return autres.map((autre) => {
        const bouton = el('button', {
          class: 'bouton bouton-principal bouton-plein',
          type: 'button',
          'data-profil': autre.profil.id,
          onclick: () => choisirProfil(autre.profil.id),
        }, texteAutre(autre));
        boutonsFin.set(autre.profil.id, bouton);
        return bouton;
      });
    };
    const maj = () => {
      for (const autre of autres) {
        const bouton = boutonsFin.get(autre.profil.id);
        const texte = texteAutre(autre);
        if (bouton && bouton.textContent !== texte) bouton.textContent = texte;
      }
    };
    const voirPlats = () => el('a', { class: 'bouton bouton-secondaire bouton-plein', href: '#/plats' }, 'Voir les plats');

    if (!gestes.length) {
      return {
        cle: `tous|${profil.id}|${profil.nom}|${estMoi}|${attente}|${cleAutres}`,
        maj,
        construire: () => focalisable(etatVide(attente
          ? {
            emoji: '👍',
            teinte: 'olive',
            titre: estMoi ? 'Plus rien à noter pour l’instant' : `Plus rien à noter pour ${profil.nom} pour l’instant`,
            texte: `${attente} Vos notes se changent sur chaque fiche.`,
          }
          : {
            emoji: '👍',
            teinte: 'olive',
            titre: estMoi ? 'Tous les plats sont notés' : `Tous les plats sont notés pour ${profil.nom}`,
            texte: 'Les nouveaux plats apparaîtront ici dès leur ajout. Vos notes se changent sur chaque fiche.',
          }, ...boutonsAutres(), voirPlats())),
      };
    }

    return {
      cle: `fin|${profil.id}|${profil.nom}|${estMoi}|${gestes.map((g) => `${g.platId}:${g.apres}:${g.nom}`).join(',')}|${attente}|${cleAutres}`,
      maj,
      construire: () => {
        const { adore, pourquoiPas, jamais } = bilan(gestes.map((trace) => ({ note: trace.apres })));
        const parts = [[adore, '❤️', 'j’adore'], [pourquoiPas, '👍', 'pourquoi pas'], [jamais, '👎', 'jamais']]
          .filter(([nombre]) => nombre > 0);
        const n = gestes.length;
        const debut = `Vous avez noté ${n}\u00A0plat${n > 1 ? 's' : ''}${estMoi ? '' : ` pour ${profil.nom}`}\u00A0: `;
        return el('section', { class: 'carte etat-vide fin-decouverte' },
          pastille('❤️', '', true),
          el('h2', { tabindex: '-1' }, 'Tout est trié\u00A0', el('span', { 'aria-hidden': 'true' }, '🎉')),
          el('p', {},
            el('span', { 'aria-hidden': 'true' }, `${debut}${parts.map(([nombre, emoji]) => `${nombre}\u00A0${emoji}`).join(', ')}.`),
            el('span', { class: 'visuellement-masque' }, `${debut}${parts.map(([nombre, , mot]) => `${nombre} ${mot}`).join(', ')}.`)),
          attente ? el('p', { class: 'texte-doux' }, attente) : null,
          el('section', { class: 'visite' },
            el('h3', {}, 'Pendant cette visite'),
            el('ul', { class: 'liste-visite' }, gestes.map((trace) => el('li', {},
              el('span', { class: 'visite-geste', 'aria-hidden': 'true' }, trace.emoji),
              el('span', { class: 'visite-nom' },
                el('span', { class: 'visuellement-masque' }, `${trace.libelle}\u00A0: `), trace.nom),
              el('a', {
                class: 'lien-changer',
                href: `#/plat/${encodeURIComponent(trace.platId)}`,
                'aria-label': `${trace.nom}\u00A0: changer la note`,
              }, 'Changer', el('span', { 'aria-hidden': 'true' }, '\u00A0›')))))),
          ...boutonsAutres(),
          voirPlats());
      },
    };
  }

  /**
   * État affiché sous la carte ; reconstruit seulement s'il change, sinon mis à jour en place (`maj`). Reconstruit
   * avec le focus dedans : le focus revient à l'élément équivalent (même lien, ou bouton du même profil).
   */
  function poserEtat(etat) {
    zoneEtat.hidden = !etat;
    const cle = etat?.cle ?? null;
    if (cle === cleEtat) {
      etat?.maj?.();
      return;
    }
    cleEtat = cle;
    const focus = zoneEtat.contains(document.activeElement) ? document.activeElement : null;
    const href = focus?.getAttribute('href');
    const profilId = focus?.dataset.profil;
    boutonsFin = new Map();
    zoneEtat.replaceChildren(...(etat ? [etat.construire()] : []));
    if (!focus || zoneEtat.hidden) return;
    const equivalent = [...zoneEtat.querySelectorAll('a[href], button[data-profil]')].find((noeud) => (href
      ? noeud.getAttribute('href') === href
      : profilId !== undefined && noeud.dataset.profil === profilId));
    equivalent?.focus();
  }

  /** Où rendre le focus quand le bloc qui l'avait disparaît : la carte, sinon le titre de l'état affiché. */
  function cibleDuFocus(carteVisible) {
    if (carteVisible) return titre;
    const cible = [zoneEtat, zoneRelier]
      .filter((zone) => !zone.hidden)
      .map((zone) => zone.querySelector('h2'))
      .find(Boolean) ?? titreEcran;
    if (!cible.hasAttribute('tabindex')) cible.setAttribute('tabindex', '-1');
    return cible;
  }

  // ——— Rendu ———

  function afficher() {
    if (!actif) return;
    const focusAvant = vue.contains(document.activeElement) ? document.activeElement : null;
    let choisi = null;
    let notables = [];
    let etat = null; // { cle, construire }
    let carteVisible = false;
    let montrerRelier = false;

    if (!courant.platsCharges || !courant.profilsCharges) {
      etat = {
        cle: 'chargement',
        construire: () => el('p', { class: 'texte-doux', role: 'status' }, 'Chargement des plats…'),
      };
    } else if (!courant.profils?.length) {
      const gestionnaire = courant.role === 'gestionnaire';
      etat = { cle: `sans-profil|${gestionnaire}`, construire: () => etatSansProfil(gestionnaire) };
    } else {
      notables = profilsNotables(courant.profils, moiEffectif());
      choisi = validerProfil(notables);
      if (!choisi) {
        montrerRelier = true;
      } else if (!aDesPlats(courant.plats)) {
        const gestionnaire = courant.role === 'gestionnaire';
        etat = { cle: `sans-plat|${gestionnaire}`, construire: () => etatSansPlat(gestionnaire) };
      } else {
        const { entree, noteAilleurs } = preparerFile(choisi.profil.id);
        if (noteAilleurs) {
          annoncer('Déjà noté sur un autre appareil.');
          animationAVenir = 'entre';
        }
        // La carte affichée a été supprimée sur l'autre téléphone : le changement se voit et s'entend.
        if (!enSortie && afficheId !== null && !trouver(afficheId)) {
          animationAVenir = 'entre';
          dire('Ce plat a été retiré.');
        }
        const plat = trouver(entree.file[entree.position]);
        if (enSortie) {
          carteVisible = true; // la carte notée finit de sortir ; la suivante est posée ensuite
        } else if (plat) {
          carteVisible = true;
          // Carte remplacée sans geste (notée ou supprimée ailleurs) : un toucher arrivé juste après ne note pas
          // une carte pas encore lue.
          if (afficheId !== null && plat.id !== afficheId) verrouiller();
          poserCarte(plat, choisi);
        } else {
          afficheId = null;
          etat = etatDeFin(choisi, notables);
        }
      }
    }

    majCompteur(choisi ? nombreANoter(courant.plats, choisi.profil.id, { garder: garderPour(courant, choisi.profil.id) }) : 0);
    aide.hidden = !carteVisible;

    // « Qui êtes-vous ? » en tête d'écran tant que la personne n'est pas reconnue et ne note pas pour l'enfant.
    if (montrerRelier) {
      if (relier) {
        relier.maj(courant);
      } else {
        relier = carteQuiEtesVous(courant, { surNoterPour: choisirProfil, surRelie });
        zoneRelier.replaceChildren(relier.noeud);
      }
    } else if (relier && moiEffectif()) {
      relier = null;
      zoneRelier.replaceChildren();
    }
    zoneRelier.hidden = !montrerRelier;

    const plusieurs = Boolean(choisi) && notables.length > 1;
    if (plusieurs) majProfils(notables);
    groupeProfils.hidden = !plusieurs;

    scene.hidden = !carteVisible;
    barre.hidden = !carteVisible;
    if (carteVisible) majSousGestes(choisi);
    poserEtat(etat);

    // Focus : le titre de la carte revenue (« Annuler ») ; sinon, rendu à un bloc visible s'il était dans un bloc
    // masqué ou remplacé (barre disparue en fin de file, carte « Qui êtes-vous ? » refermée…).
    if (focusTitreAVenir) {
      focusTitreAVenir = false;
      if (carteVisible) {
        titre.focus();
        return;
      }
    }
    const actuel = document.activeElement;
    if (focusAvant && (!actuel || actuel === document.body || !vue.contains(actuel) || actuel.closest('[hidden]'))) {
      cibleDuFocus(carteVisible).focus();
    }
  }

  afficher();

  return {
    noeud: vue,
    maj(nouveau) {
      const ancienMoi = moiEffectif()?.id ?? null;
      courant = nouveau;
      if (courant.moi) moiAttendu = null;
      const nouveauMoi = moiEffectif()?.id ?? null;
      if (nouveauMoi !== ancienMoi) {
        // Relié (ici ou ailleurs) : Découvrir repart sur soi. Délié : retour à « Qui êtes-vous ? ».
        if (nouveauMoi || profilChoisi === ancienMoi) {
          profilChoisi = nouveauMoi;
          oublierPile();
          arreterAnimation();
          afficheId = null;
        }
      }
      afficher();
    },
    detruire() {
      actif = false;
      clearTimeout(minuteurVerrou);
      arreterAnimation();
      observateur?.disconnect();
      document.body.style.removeProperty('--hauteur-gestes');
    },
  };
}
