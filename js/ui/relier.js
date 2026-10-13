// « Qui êtes-vous ? » : relie l'adresse de la personne connectée à son prénom (profil du foyer), pour que ses notes
// soient à son nom sur tous ses appareils. Carte posée dans un écran (Découvrir), ou dans une feuille du bas (fiche,
// panneau du profil). Jamais de choix automatique, même s'il n'y a qu'un prénom.
// Typographie : espace insécable avant « : » (\u00A0), espace fine insécable avant « ? » (\u202F).
import { el, annoncer } from './dom.js';
import { ouvrirFeuille } from './feuille.js';
import { profilsARelier } from '../coeur/profils.js';
import { normaliserEmail } from '../coeur/roles.js';
import { profilsNotables } from '../coeur/notes.js';
import { TEXTES_ACCUEIL, texteAdressePrise } from '../coeur/accueil.js';

const TITRE = 'Qui êtes-vous\u202F?';
const TITRE_SANS_PRENOM = 'Votre profil n’est pas encore relié';

const MESSAGES = {
  change: 'Ce profil vient de changer sur un autre appareil. Choisissez à nouveau.',
  inconnu: 'Ce profil n’existe plus. Choisissez à nouveau.',
  reseau: 'Cette étape demande du réseau. Réessayez quand il revient.',
  echec: 'L’enregistrement n’a pas abouti. Réessayez.',
};

/**
 * Message d'un résultat de relierProfil ou delierProfil qui n'a pas abouti ({ code, nom? }). `dansAccueil` : textes de
 * la présentation (T6-0), sans le mot « profil ».
 */
export function messageDeReliure({ code, nom } = {}, { dansAccueil = false } = {}) {
  if (dansAccueil) {
    if (code === 'adresse_prise') return texteAdressePrise(nom);
    if (code === 'change') return TEXTES_ACCUEIL.relierChange;
    if (code === 'inconnu') return TEXTES_ACCUEIL.relierInconnu;
  }
  if (code === 'adresse_prise') {
    return nom
      ? `Votre adresse est déjà reliée au profil «\u00A0${nom}\u00A0».`
      : 'Votre adresse est déjà reliée à un autre profil.';
  }
  // 'enfant' et 'gestionnaire' n'arrivent pas (ces profils ne sont pas proposés) : message générique.
  return MESSAGES[code] ?? MESSAGES.echec;
}

let compteur = 0;

/**
 * Construit la carte. `surSucces(profil, texte)` : profil relié (texte de bienvenue à annoncer).
 * `feuille` (version feuille) : { fermer, definirTitre(texte), titre() } ; la feuille porte alors le titre.
 * `dansAccueil` (présentation, T6-0) : l'écran porte le titre et la phrase (titre, intro et titre « sans prénom » de la
 * carte cachés, explication cachée tant que « Je ne suis pas dans la liste » n'est pas touché), pas de cadre de carte,
 * pas de zone de succès (le passage à l'écran suivant fait l'annonce), textes sans le mot « profil ».
 * → { noeud, maj(ctx), titre() }
 */
function construire(ctx, { surNoterPour, surSucces, feuille = null, dansAccueil = false }) {
  compteur += 1;
  const ids = {
    titre: `relier-titre-${compteur}`,
    explication: `relier-explication-${compteur}`,
    lien: `relier-lien-${compteur}`,
  };
  let courant = ctx;
  let choisi = null; // profil de la seconde étape (relié à une autre adresse), ou null
  let nomChoisi = '';
  let adresseVue = ''; // adresse du profil choisi telle que l'écran l'a montrée ('' : sans adresse)
  let deplie = false; // « Je ne suis pas dans la liste » ouvert
  let enCours = false; // un toucher attend la réponse : les suivants sont ignorés
  let boutonOccupe = null;
  let texteTitre = '';
  let lienPermis = false; // « Ouvrir les réglages » : gestionnaire, hors aperçu
  let entrees = new Map(); // profilId → { profil, autreAdresse } (prénoms proposés)
  const boutonsPrenoms = new Map(); // profilId → bouton « C'est moi : <Prénom> »
  const boutonsEnfants = new Map(); // profilId → bouton « Noter pour <Enfant> en attendant »

  // Nœuds gardés d'une mise à jour à l'autre : le focus (clavier, TalkBack) n'est pas perdu.
  const titre = el('h2', { id: ids.titre, tabindex: '-1', hidden: Boolean(feuille) || dansAccueil });
  const intro = el('p', {}, 'Choisissez votre prénom\u00A0: vos notes seront à votre nom, sur tous vos appareils.');
  const question = el('p', { tabindex: '-1' });
  const succes = el('p', { class: 'aide', role: 'status', hidden: true });
  const erreur = el('p', { class: 'message-erreur', role: 'alert', hidden: true });
  const boutonOui = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: confirmer });
  const boutonRetour = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retour }, 'Retour');
  const boutonHorsListe = el('button', {
    class: 'bouton bouton-texte',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': `${ids.explication} ${ids.lien}`,
    onclick: () => {
      deplie = !deplie;
      dessiner();
    },
  }, 'Je ne suis pas dans la liste');
  const explication = el('p', { id: ids.explication });
  const lienReglages = el('a', {
    id: ids.lien,
    class: 'bouton bouton-secondaire bouton-plein',
    href: '#/reglages',
    onclick: () => feuille?.fermer(),
  }, '⚙️ Ouvrir les réglages');
  const finPrenoms = el('span', { hidden: true }); // repère : les prénoms se placent juste avant
  const finEnfants = el('span', { hidden: true }); // repère : les enfants se placent juste avant

  let classeCarte = 'carte carte-relier';
  if (feuille) classeCarte = 'carte carte-relier dans-feuille';
  else if (dansAccueil) classeCarte = 'carte-relier dans-accueil';
  const noeud = el('section', {
    class: classeCarte,
    'aria-labelledby': feuille || dansAccueil ? null : ids.titre,
  },
  titre, intro, question, succes, erreur, finPrenoms,
  boutonOui, boutonRetour, boutonHorsListe, explication, lienReglages, finEnfants);

  function poserTitre(texte) {
    if (texte === texteTitre) return;
    texteTitre = texte;
    titre.textContent = texte;
    feuille?.definirTitre(texte);
  }

  function focaliserTitre() {
    // Présentation : le titre de la carte est caché, celui de l'écran (h1, juste au-dessus) prend le focus.
    const titreEcran = dansAccueil ? noeud.parentElement?.querySelector('h1') : null;
    (titreEcran ?? feuille?.titre() ?? titre).focus();
  }

  function afficherMessage(zone, texte) {
    for (const z of [succes, erreur]) {
      z.textContent = z === zone ? texte : '';
      z.hidden = z !== zone;
    }
  }

  /**
   * Place `voulus` (dans l'ordre) juste avant `repere`, sans déplacer les nœuds déjà dans le bon ordre ; ceux qui
   * ne sont plus voulus sont retirés. Le nœud qui avait le focus le retrouve.
   */
  function placer(boutons, voulus, repere) {
    for (const [id, bouton] of boutons) {
      if (!voulus.includes(bouton)) {
        bouton.remove();
        boutons.delete(id);
      }
    }
    // Déjà en place (le cas courant : rien n'a changé) : on ne touche à rien.
    let precedent = repere.previousElementSibling;
    let enPlace = true;
    for (let i = voulus.length - 1; i >= 0 && enPlace; i -= 1) {
      enPlace = precedent === voulus[i];
      precedent = precedent?.previousElementSibling ?? null;
    }
    if (enPlace) return;
    const actif = document.activeElement;
    repere.before(...voulus);
    if (voulus.includes(actif) && document.activeElement !== actif) actif.focus({ preventScroll: true });
  }

  function majPrenoms() {
    const liste = profilsARelier(courant.profils, { gestionnaire: courant.reglages?.gestionnaire });
    entrees = new Map(liste.map((entree) => [entree.profil.id, entree]));
    const voulus = liste.map(({ profil }) => {
      let bouton = boutonsPrenoms.get(profil.id);
      if (!bouton) {
        bouton = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: () => choisir(profil.id) });
        boutonsPrenoms.set(profil.id, bouton);
      }
      if (bouton !== boutonOccupe) bouton.textContent = `C’est moi\u00A0: ${profil.nom}`;
      return bouton;
    });
    placer(boutonsPrenoms, voulus, finPrenoms);
  }

  function majEnfants() {
    const enfants = surNoterPour ? profilsNotables(courant.profils, null).map(({ profil }) => profil) : [];
    const voulus = enfants.map((profil) => {
      let bouton = boutonsEnfants.get(profil.id);
      if (!bouton) {
        bouton = el('button', {
          class: 'bouton bouton-secondaire bouton-plein',
          type: 'button',
          onclick: () => {
            if (!enCours) surNoterPour(profil.id);
          },
        });
        boutonsEnfants.set(profil.id, bouton);
      }
      bouton.textContent = `Noter pour ${profil.nom} en attendant`;
      return bouton;
    });
    placer(boutonsEnfants, voulus, finEnfants);
  }

  function majExplication() {
    const gestionnaire = courant.roleReel === 'gestionnaire';
    explication.textContent = gestionnaire
      ? 'Ajoutez votre profil dans Réglages.'
      : 'Demandez qu’on vous ajoute dans les réglages de l’app.';
    // En aperçu « Repas et courses », Réglages ne s'ouvre pas : le texte suffit.
    lienPermis = gestionnaire && courant.role === 'gestionnaire';
  }

  /** Visibilité des blocs selon l'étape ; ne reconstruit rien. */
  function dessiner() {
    const sansPrenom = boutonsPrenoms.size === 0;
    const seconde = choisi !== null;
    // Présentation : sans prénom, la phrase de l'écran dit déjà l'explication.
    const montrerExplication = !seconde && ((sansPrenom && !dansAccueil) || deplie);
    // Présentation : titre caché (l'écran porte le sien), jamais le mot « profil », même dans le DOM.
    poserTitre(sansPrenom && !seconde && !dansAccueil ? TITRE_SANS_PRENOM : TITRE);
    intro.hidden = seconde || sansPrenom || dansAccueil;
    for (const bouton of boutonsPrenoms.values()) bouton.hidden = seconde;
    boutonHorsListe.hidden = seconde || sansPrenom;
    boutonHorsListe.setAttribute('aria-expanded', String(montrerExplication));
    explication.hidden = !montrerExplication;
    lienReglages.hidden = !montrerExplication || !lienPermis;
    for (const bouton of boutonsEnfants.values()) bouton.hidden = seconde;
    question.hidden = !seconde;
    boutonOui.hidden = !seconde;
    boutonRetour.hidden = !seconde;
    if (seconde) {
      question.textContent = `«\u00A0${nomChoisi}\u00A0» est relié à une autre adresse. Le relier à la vôtre\u202F?`;
      if (boutonOui !== boutonOccupe) boutonOui.textContent = 'Oui, c’est moi';
    }
  }

  function rafraichir() {
    majPrenoms();
    majEnfants();
    majExplication();
    // Le prénom de la seconde étape a disparu (supprimé, devenu le profil du gestionnaire…) ou son adresse a changé
    // ailleurs : retour au choix, la question posée ne vaut plus.
    const entreeChoisie = choisi === null ? null : entrees.get(choisi);
    if (entreeChoisie) nomChoisi = entreeChoisie.profil.nom;
    if (choisi !== null && !enCours
      && (!entreeChoisie || normaliserEmail(entreeChoisie.profil.email) !== adresseVue)) {
      const focusDansEtape = [question, boutonOui, boutonRetour].includes(document.activeElement);
      choisi = null;
      afficherMessage(erreur, messageDeReliure({ code: 'change' }, { dansAccueil }));
      dessiner();
      if (focusDansEtape) focaliserTitre();
      return;
    }
    dessiner();
  }

  function choisir(profilId) {
    if (enCours) return;
    const entree = entrees.get(profilId);
    if (!entree) return;
    afficherMessage(null, '');
    adresseVue = normaliserEmail(entree.profil.email);
    if (!entree.autreAdresse) {
      relier(profilId, boutonsPrenoms.get(profilId));
      return;
    }
    // Profil relié à une autre adresse (faute de frappe probable) : on demande confirmation, dans la même carte.
    choisi = profilId;
    nomChoisi = entree.profil.nom;
    dessiner();
    question.focus();
  }

  function confirmer() {
    if (enCours || choisi === null) return;
    relier(choisi, boutonOui);
  }

  function retour() {
    if (enCours) return;
    const precedent = choisi;
    choisi = null;
    afficherMessage(null, '');
    dessiner();
    const bouton = boutonsPrenoms.get(precedent);
    if (bouton?.isConnected && !bouton.hidden) bouton.focus();
    else focaliserTitre();
  }

  async function relier(profilId, bouton) {
    enCours = true;
    boutonOccupe = bouton;
    const profil = entrees.get(profilId)?.profil ?? { id: profilId, nom: '' };
    bouton.textContent = 'Un instant…';
    bouton.setAttribute('aria-busy', 'true');
    let resultat;
    try {
      // L'adresse montrée accompagne le choix : si elle a changé entre-temps, rien n'est écrit (« change »).
      resultat = await courant.actions.relierProfil(profilId, { attendu: adresseVue });
    } catch {
      resultat = { code: 'echec' };
    }
    enCours = false;
    boutonOccupe = null;
    bouton.removeAttribute('aria-busy');
    const focusSurBouton = document.activeElement === bouton;

    if (resultat?.code === 'ok') {
      const texte = `Bienvenue, ${profil.nom}\u00A0: vos notes seront à votre nom.`;
      choisi = null;
      rafraichir();
      if (!dansAccueil) afficherMessage(succes, texte);
      surSucces(profil, texte);
      return;
    }

    // Le profil a changé ou disparu, ou l'adresse est prise : retour au choix des prénoms.
    if (['change', 'inconnu', 'adresse_prise'].includes(resultat?.code)) choisi = null;
    rafraichir();
    afficherMessage(erreur, messageDeReliure(resultat, { dansAccueil }));
    // Le bouton touché garde le focus s'il est encore affiché ; sinon, le titre le prend.
    if (focusSurBouton && (!bouton.isConnected || bouton.hidden)) focaliserTitre();
  }

  rafraichir();

  return {
    noeud,
    titre: () => texteTitre,
    maj(nouveau) {
      courant = nouveau;
      rafraichir();
    },
  };
}

/**
 * Carte « Qui êtes-vous ? » à poser dans un écran (Découvrir, quand la personne connectée n'est pas reconnue).
 * `surNoterPour(profilId)` (facultatif) : bouton « Noter pour <Enfant> en attendant », un par enfant notable.
 * `surRelie(profil)` : appelé après « Bienvenue… » (le profil est déjà appliqué sur ce téléphone).
 * `dansAccueil` (présentation, T6-0) : carte sans titre ni cadre, sans « Noter pour… », sans annonce ni zone de succès
 * après « C'est moi » (l'écran suivant et son titre focalisé le disent), textes sans le mot « profil ».
 * → { noeud, maj(ctx) } ; maj met à jour les prénoms proposés sans perdre l'étape ni le focus.
 */
export function carteQuiEtesVous(ctx, { surNoterPour, surRelie, dansAccueil = false } = {}) {
  const carte = construire(ctx, {
    surNoterPour: dansAccueil ? null : surNoterPour,
    surSucces: (profil, texte) => {
      if (!dansAccueil) annoncer(texte);
      surRelie?.(profil);
    },
    dansAccueil,
  });
  return { noeud: carte.noeud, maj: carte.maj };
}

/**
 * Même carte dans une feuille du bas (fiche, panneau du profil). Se ferme seule une fois le profil relié, et avant
 * « Noter pour <Enfant> en attendant » ou « Ouvrir les réglages ». `surFermer()` : la feuille vient de se fermer.
 * → { fermer, maj(ctx) } ; l'app appelle maj à chaque rendu tant que la feuille est ouverte (prénoms et adresses à
 * jour, seconde étape abandonnée si l'adresse du profil choisi change ailleurs).
 */
export function ouvrirQuiEtesVous(ctx, { surNoterPour, surRelie, surFermer } = {}) {
  let ouverte = null;
  const feuille = {
    fermer: () => ouverte?.fermer(),
    definirTitre: (texte) => ouverte?.definirTitre(texte),
    titre: () => ouverte?.dialogue.querySelector('h2') ?? null,
  };
  const carte = construire(ctx, {
    surNoterPour: surNoterPour
      ? (profilId) => {
        feuille.fermer();
        surNoterPour(profilId);
      }
      : null,
    // La feuille se ferme d'abord : l'annonce, hors de la feuille, est alors visible et lue.
    surSucces: (profil, texte) => {
      feuille.fermer();
      annoncer(texte);
      surRelie?.(profil);
    },
    feuille,
  });
  ouverte = ouvrirFeuille(carte.titre(), () => carte.noeud, { onFermer: surFermer });
  return { fermer: feuille.fermer, maj: carte.maj };
}
