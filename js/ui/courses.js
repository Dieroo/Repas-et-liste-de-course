// Écran Courses (T3a) : la liste de la semaine montrée, calculée sur le téléphone (coeur/liste.js › listeDeCourses),
// rangée par rayon (en-têtes collants), « 🏠 Déjà à la maison ? » replié en haut, « Dans le panier » replié en bas, et
// « ＋ Ajouter un article » dans une barre fixée au-dessus des onglets. Marche hors ligne ; ce qui est coché sur un
// téléphone se coche sur l'autre.
// Rien ne bouge sous le doigt : chaque ligne est gardée par sa clé (dom.js › reconcilier) ; une ligne cochée ici reste à
// sa place, barrée, et les lignes cochées rejoignent ensemble « Dans le panier » 1,5 s après le dernier toucher (un seul
// minuteur, relancé à chaque toucher, à chaque coche et pendant un défilement) ; « À racheter » garde sa ligne dans
// « Déjà à la maison ? » jusqu'à la prochaine ouverture de Courses ; une mise à jour (l'autre téléphone ajoute un plat,
// une ligne apparaît au-dessus) garde à sa place la ligne sous le doigt, sinon celle qui a le focus, sinon la première
// ligne visible (ancrage fait ici, l'ancrage du navigateur est coupé sur cet écran). Rien n'est écrit à l'ouverture ;
// une coche écrit seulement son chemin (actions.cocher), une ligne du placard « À racheter » le sien
// (actions.racheter).
import { el, etatVide, ecrireTexte, reconcilier, vibrer } from './dom.js';
import { ouvrirAjoutArticle, ouvrirDetailsArticle, majFeuillesArticle } from './article.js';
import { demanderChoixALArrivee } from './choisir-plats.js';
import { listeCourante, platsDeLaSemaineDe } from './plat-semaine.js';
import { LIBELLES_RAYON } from '../coeur/edition.js';
import { bandeauxCourses, grouperParRayon, ordreRayons, texteDejaPris, texteOrigine } from '../coeur/liste.js';
import { lireSemaine, texteDates } from '../coeur/semaine.js';

/** Les lignes cochées partent ensemble vers « Dans le panier » 1,5 s après le dernier toucher. */
const DELAI_DEPART_MS = 1500;

/** Geste refusé par l'app (rien n'est écrit) : la case revient à son état. */
const echoue = (resultat) => ['chargement', 'invalide', 'inutile', 'refuse', 'echec'].includes(resultat?.code);

/** « Choisir les plats › » : vers Semaine, qui ouvre la feuille « Ajouter à la semaine » en arrivant. */
const lienChoisir = (principal = true) => el('a', {
  class: `bouton bouton-plein ${principal ? 'bouton-principal' : 'bouton-secondaire'}`,
  href: '#/semaine',
  onclick: demanderChoixALArrivee,
}, 'Choisir les plats ›');

export function creer(ctx) {
  let courant = ctx;
  // Lignes touchées ici, gardées à leur place jusqu'au départ groupé : 'achat' (cochée, encore dans son rayon) ou
  // 'panier' (décochée, encore dans « Dans le panier »).
  const retenues = new Map();
  // Produits du placard rallumés (« À racheter ») pendant cette visite : ils restent dans « Déjà à la maison ? ».
  const gardesMaison = new Set();
  let minuteur = null;
  let toucherEnCours = false;
  let cleSousLeDoigt = null; // ligne touchée en dernier : la référence de l'ancrage
  let actuels = new Map(); // clé → ligne ou article de la liste du moment
  let etatAffiche = ''; // clé de l'état vide affiché (rien n'est reconstruit sans changement)
  const noeudsLignes = new Map(); // clé → <li>, partagé entre les rayons et le panier
  const partiesLignes = new WeakMap(); // <li> → ses parties

  // ——— En-tête, aide, bandeaux ———
  const progression = el('p', { class: 'courses-progression' });
  const sousTitre = el('p', { class: 'sous-titre' });
  const aide = el('p', { class: 'aide courses-aide' });
  const bandeauRecette = el('p', { class: 'bandeau bandeau-alerte', hidden: true },
    el('span', { 'aria-hidden': 'true' }, '⏳'), el('span', {}));
  const bandeauxVerifier = el('div', { class: 'bandeaux-verifier' });
  const zoneEtat = el('div', { class: 'etat-courses', hidden: true });

  // ——— « Déjà à la maison ? » ———
  const resumeMaison = el('summary', { class: 'resume-courses' });
  const listeMaison = el('ul', { class: 'lignes-maison' });
  const zoneMaison = el('details', { class: 'details-courses details-maison', hidden: true },
    resumeMaison,
    el('p', { class: 'aide' }, 'D’habitude, vous en avez. Touchez ceux qu’il faut racheter.'),
    listeMaison);

  // ——— Rayons, fin, panier ———
  const rayons = el('div', { class: 'rayons' });
  const titreFini = el('h2', { tabindex: '-1' }, 'Tout est dans le panier 🎉');
  const carteFini = el('section', { class: 'carte carte-fini', hidden: true }, titreFini);
  const resumePanier = el('summary', { class: 'resume-courses' });
  const listePanier = el('ul', { class: 'lignes-courses lignes-panier' });
  const zonePanier = el('details', { class: 'details-courses details-panier', hidden: true }, resumePanier, listePanier);
  const statut = el('p', { class: 'visuellement-masque', role: 'status' });

  // ——— Barre « ＋ Ajouter un article » ———
  const boutonAjouter = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button' },
    el('span', { 'aria-hidden': 'true' }, '＋'), 'Ajouter un article');
  boutonAjouter.addEventListener('click', () => {
    ouvrirAjoutArticle(() => courant, {
      onFermer: () => {
        if (boutonAjouter.isConnected) boutonAjouter.focus();
      },
    });
  });
  const barre = el('div', { class: 'barre-courses' }, el('div', { class: 'barre-courses-contenu' }, boutonAjouter));

  const vue = el('div', { class: 'vue courses' },
    el('header', { class: 'vue-entete courses-entete' },
      el('div', { class: 'courses-titre' }, el('h1', {}, 'Courses'), progression),
      sousTitre),
    aide,
    bandeauRecette,
    bandeauxVerifier,
    zoneEtat,
    zoneMaison,
    rayons,
    carteFini,
    zonePanier,
    statut,
    barre);

  // La page réserve la hauteur réelle de la barre (texte agrandi compris), comme la barre des gestes de Découvrir.
  const observateur = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (!barre.isConnected) return;
      document.body.style.setProperty('--hauteur-barre-courses', `${Math.ceil(barre.getBoundingClientRect().height)}px`);
    })
    : null;
  observateur?.observe(barre);

  // ——— Départ groupé des lignes cochées ———

  function dire(texte) {
    // Même texte deux fois de suite : une espace de plus pour qu'il soit relu.
    statut.textContent = statut.textContent === texte ? `${texte}\u00A0` : texte;
  }

  function relancerDepart() {
    clearTimeout(minuteur);
    minuteur = retenues.size ? setTimeout(partir, DELAI_DEPART_MS) : null;
  }

  /** Les lignes retenues rejoignent leur place ; le focus d'une ligne partie passe à l'article suivant à acheter. */
  function partir() {
    minuteur = null;
    if (toucherEnCours) {
      relancerDepart();
      return;
    }
    const actif = document.activeElement;
    const ligneActive = actif?.closest?.('.ligne-article') ?? null;
    let suivante = null;
    let versFin = false;
    if (ligneActive && rayons.contains(ligneActive)) {
      const cle = partiesLignes.get(ligneActive)?.cle;
      if (retenues.get(cle) === 'achat' && actuels.get(cle)?.cochee) {
        const resteAAcheter = (li) => !actuels.get(partiesLignes.get(li)?.cle)?.cochee;
        const ordre = [...rayons.querySelectorAll('.ligne-article')];
        const i = ordre.indexOf(ligneActive);
        suivante = ordre.slice(i + 1).find(resteAAcheter) ?? ordre.slice(0, i).reverse().find(resteAAcheter) ?? null;
        versFin = !suivante;
      }
    }
    retenues.clear();
    // Les lignes cochées partent : celles du dessous remontent (rien n'est sous le doigt, 1,5 s après le dernier toucher).
    dessiner({ ancrer: false });
    if (suivante?.isConnected) partiesLignes.get(suivante).input.focus({ preventScroll: true });
    else if (versFin && !carteFini.hidden) titreFini.focus({ preventScroll: true });
  }

  // Un toucher dans l'écran relance le minuteur ; rien ne part pendant un toucher ni pendant un défilement.
  const surToucher = (evenement) => {
    toucherEnCours = true;
    const li = evenement.target?.closest?.('.ligne-article');
    cleSousLeDoigt = li ? partiesLignes.get(li)?.cle ?? null : null;
    if (retenues.size) relancerDepart();
  };
  const finToucher = () => {
    toucherEnCours = false;
    if (retenues.size) relancerDepart();
  };
  const surDefilement = () => {
    if (retenues.size) relancerDepart();
  };
  vue.addEventListener('pointerdown', surToucher, { capture: true });
  window.addEventListener('pointerup', finToucher);
  window.addEventListener('pointercancel', finToucher);
  window.addEventListener('scroll', surDefilement, { passive: true });

  // ——— Gestes ———

  function cocher(cle, input) {
    const ligne = actuels.get(cle);
    if (!ligne) return;
    const oui = input.checked;
    const li = input.closest('.ligne-article');
    const avant = grouperParRayon(listeCourante(courant), { rayons: ordreRayons(courant.reglages) });
    // Reste où elle est jusqu'au départ groupé : dans son rayon (cochée, barrée) ou dans le panier (décochée).
    retenues.set(cle, li && rayons.contains(li) ? 'achat' : 'panier');
    const resultat = courant.actions?.cocher?.(cle, oui);
    if (echoue(resultat)) {
      input.checked = !oui;
      retenues.delete(cle);
      relancerDepart();
      return;
    }
    vibrer();
    li?.classList.toggle('cochee', oui);
    const pris = Math.min(avant.total, Math.max(0, avant.pris + (ligne.cochee === oui ? 0 : oui ? 1 : -1)));
    dire(`${ligne.nom}\u00A0: ${oui ? 'dans le panier' : 'à acheter'}. ${pris} sur ${avant.total}.`);
    relancerDepart();
  }

  function racheter(cle, input) {
    if (input.checked) gardesMaison.add(cle);
    const resultat = courant.actions?.racheter?.(cle, input.checked);
    if (echoue(resultat)) input.checked = !input.checked;
  }

  function ouvrirDetails(cle, bouton) {
    ouvrirDetailsArticle(() => courant, cle, {
      onFermer: () => {
        const li = noeudsLignes.get(cle);
        const cible = bouton.isConnected ? bouton : li?.isConnected ? partiesLignes.get(li)?.details : null;
        // Article retiré (« Retirer de la liste ») : le focus passe à la ligne voisine, jamais à la page.
        if (cible) cible.focus();
        else focusVoisine(cle);
      },
    });
  }

  // Ordre des lignes avant le dernier retrait : une ligne partie passe le focus à sa voisine.
  let ordrePrecedent = [];

  /** Focus de la ligne qui suit `cle` dans l'ordre d'avant, sinon de celle qui la précède, sinon « ＋ Ajouter un article ». */
  function focusVoisine(cle) {
    const position = ordrePrecedent.indexOf(cle);
    // Une ligne affichée (jamais dans un « Dans le panier » replié, où elle ne prendrait pas le focus).
    const presente = (c) => Boolean(noeudsLignes.get(c)?.isConnected && noeudsLignes.get(c).getClientRects().length);
    const voisine = ordrePrecedent.slice(position + 1).find(presente)
      ?? ordrePrecedent.slice(0, Math.max(0, position)).reverse().find(presente);
    const cible = voisine ? partiesLignes.get(noeudsLignes.get(voisine))?.input : boutonAjouter;
    cible?.focus({ preventScroll: Boolean(voisine) });
  }

  // ——— Lignes ———

  /** Seconde ligne : « 600 g · Gratin, Salade de pâtes », « Ajouté à la main », ou « Déjà pris : 600 g · encore 200 g ». */
  function detailDe(ligne) {
    if (ligne.dejaPris) return texteDejaPris(ligne);
    return [ligne.quantite, texteOrigine(ligne, { profils: courant.profils ?? [], moi: courant.moi ?? null })]
      .filter(Boolean).join(' · ');
  }

  function creerLigne(element) {
    const cle = element.cle;
    const input = el('input', { class: 'case-article', type: 'checkbox' });
    input.addEventListener('change', () => cocher(cle, input));
    const nom = el('span', { class: 'article-nom' });
    const detail = el('span', { class: 'article-detail' });
    const details = el('button', { class: 'bouton-details', type: 'button' }, el('span', { 'aria-hidden': 'true' }, '⋮'));
    details.addEventListener('click', () => ouvrirDetails(cle, details));
    const li = el('li', { class: 'ligne-article' },
      el('label', { class: 'article-cible' }, input, el('span', { class: 'article-texte' }, nom, detail)),
      details);
    partiesLignes.set(li, { cle, input, nom, detail, details });
    majLigne(li, element);
    return li;
  }

  function majLigne(li, element) {
    const parties = partiesLignes.get(li);
    const ligne = actuels.get(element.cle) ?? element;
    if (parties.input.checked !== ligne.cochee) parties.input.checked = ligne.cochee;
    li.classList.toggle('cochee', ligne.cochee);
    ecrireTexte(parties.nom, ligne.nom);
    const detail = detailDe(ligne);
    ecrireTexte(parties.detail, detail);
    parties.detail.hidden = !detail;
    const nomDetails = `Détails\u00A0: ${ligne.nom}`;
    if (parties.details.getAttribute('aria-label') !== nomDetails) parties.details.setAttribute('aria-label', nomDetails);
  }

  const partiesMaison = new WeakMap();
  let numeroMaison = 0;

  function creerLigneMaison(ligne) {
    numeroMaison += 1;
    const id = `maison-${numeroMaison}`;
    const input = el('input', { class: 'interrupteur', type: 'checkbox', role: 'switch', 'aria-describedby': `${id}-detail ${id}-etat` });
    input.addEventListener('change', () => racheter(ligne.cle, input));
    const nom = el('span', { class: 'maison-nom' });
    const detail = el('span', { class: 'maison-detail', id: `${id}-detail` });
    const etat = el('span', { class: 'maison-etat', id: `${id}-etat` });
    const li = el('li', {},
      el('label', { class: 'ligne-maison' },
        el('span', { class: 'maison-texte' }, nom, detail, etat),
        el('span', { class: 'maison-bascule' },
          el('span', { class: 'maison-bascule-texte', 'aria-hidden': 'true' }, 'À racheter'),
          input)));
    partiesMaison.set(li, { input, nom, detail, etat });
    majLigneMaison(li, ligne);
    return li;
  }

  function majLigneMaison(li, ligne) {
    const { input, nom, detail, etat } = partiesMaison.get(li);
    ecrireTexte(nom, ligne.nom);
    const origine = texteOrigine(ligne, { profils: courant.profils ?? [], moi: courant.moi ?? null });
    ecrireTexte(detail, [ligne.quantite, origine].filter(Boolean).join(' · '));
    const surLaListe = ligne.rachetee ? `Sur la liste · ${LIBELLES_RAYON[ligne.rayon] ?? LIBELLES_RAYON.divers}` : '';
    ecrireTexte(etat, surLaListe);
    etat.hidden = !surLaListe;
    if (input.checked !== ligne.rachetee) input.checked = ligne.rachetee;
    const nomInterrupteur = `À racheter\u00A0: ${ligne.nom}`;
    if (input.getAttribute('aria-label') !== nomInterrupteur) input.setAttribute('aria-label', nomInterrupteur);
  }

  const partiesRayons = new WeakMap();

  /** Un rayon : en-tête collant « Fruits et légumes · 4 », puis ses lignes (lignes retenues comprises). */
  function creerRayon(groupe) {
    const titre = el('h2', { class: 'rayon-titre' });
    const liste = el('ul', { class: 'lignes-courses' });
    const noeud = el('section', { class: 'rayon' }, titre, liste);
    partiesRayons.set(noeud, { titre, liste });
    majRayon(noeud, groupe);
    return noeud;
  }

  function majRayon(noeud, groupe) {
    const { titre, liste } = partiesRayons.get(noeud);
    ecrireTexte(titre, `${groupe.libelle} · ${groupe.lignes.length}`);
    reconcilier(liste, groupe.lignes, { cle: (l) => l.cle, creer: creerLigne, maj: majLigne, noeuds: noeudsLignes });
  }

  // ——— États ———

  /** État vide ou de chargement, reconstruit seulement quand il change. `cle` '' : aucun. */
  function montrerEtat(cle, fabriquer) {
    if (cle === etatAffiche) return;
    etatAffiche = cle;
    zoneEtat.replaceChildren(...(cle ? [fabriquer()] : []));
    zoneEtat.hidden = !cle;
  }

  // ——— Ancrage : la ligne de référence garde sa place à l'écran pendant une mise à jour ———

  /**
   * Lignes visibles avant une mise à jour, la référence d'abord : la ligne touchée en dernier (là où l'on regarde), puis
   * celle qui a le focus, puis les autres de haut en bas. → [{ cle, top }]
   */
  function positionsVisibles() {
    const vues = [];
    for (const [cle, li] of noeudsLignes) {
      if (!li.isConnected) continue;
      const r = li.getBoundingClientRect();
      if (r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) vues.push({ cle, top: r.top });
    }
    vues.sort((a, b) => a.top - b.top);
    const focus = document.activeElement?.closest?.('.ligne-article');
    const cleFocus = focus ? partiesLignes.get(focus)?.cle : null;
    const rang = (v) => (v.cle === cleSousLeDoigt ? 0 : v.cle === cleFocus ? 1 : 2);
    return vues.sort((a, b) => rang(a) - rang(b));
  }

  /** Remet la première ligne de référence encore affichée à sa place d'avant (défilement compensé). */
  function compenser(vues) {
    for (const { cle, top } of vues) {
      const li = noeudsLignes.get(cle);
      if (!li?.isConnected) continue;
      const r = li.getBoundingClientRect();
      if (!r.height) continue;
      const ecart = r.top - top;
      if (Math.abs(ecart) >= 1) window.scrollBy({ top: ecart, behavior: 'instant' });
      return;
    }
  }

  // ——— Dessin ———

  function dessiner({ ancrer = true } = {}) {
    const vues = ancrer && vue.isConnected ? positionsVisibles() : [];
    const c = courant;
    const enLigne = c.enLigne ?? navigator.onLine;
    ecrireTexte(aide, enLigne
      ? 'Touchez un article pour le cocher. Ça marche aussi sans réseau.'
      : 'Hors ligne\u00A0: vos coches partiront au retour du réseau.');
    const charge = Boolean(c.semainesChargees) && c.platsCharges !== false && c.profilsCharges !== false
      && c.articlesCharges !== false;
    if (!charge) {
      // Jamais « Rien à acheter » avant la lecture.
      montrerEtat('chargement', () => el('p', { class: 'texte-doux', role: 'status' }, 'Chargement de la liste…'));
      for (const zone of [bandeauRecette, bandeauxVerifier, zoneMaison, rayons, carteFini, zonePanier]) zone.hidden = true;
      ecrireTexte(progression, '');
      ecrireTexte(sousTitre, '');
      return;
    }

    const liste = listeCourante(c);
    const rangs = ordreRayons(c.reglages);
    const lue = lireSemaine(c.semaine);
    const elements = lue ? platsDeLaSemaineDe(c) : [];
    const avecPlats = elements.some((e) => e.etat === 'ok' || e.etat === 'sansRecette');
    const tous = [...(liste?.lignes ?? []), ...(liste?.articles ?? [])];
    actuels = new Map(tous.map((e) => [e.cle, e]));
    for (const cle of [...retenues.keys()]) if (!actuels.has(cle)) retenues.delete(cle);
    const reel = grouperParRayon(liste, { rayons: rangs });

    ecrireTexte(sousTitre, lue ? `Semaine ${texteDates(lue.debut, lue.fin)}` : '');
    sousTitre.hidden = !lue;
    ecrireTexte(progression, reel.total ? `${reel.pris} sur ${reel.total} dans le panier` : '');
    progression.hidden = !reel.total;

    // Bandeaux : plats sans recette, quantités qui n'ont pas pu être comptées.
    const bandeaux = bandeauxCourses(liste);
    ecrireTexte(bandeauRecette.lastChild, bandeaux.sansRecette ? ` ${bandeaux.sansRecette}` : '');
    bandeauRecette.hidden = !bandeaux.sansRecette;
    reconcilier(bandeauxVerifier, bandeaux.aVerifier, {
      cle: (texte) => texte,
      creer: (texte) => el('p', { class: 'bandeau bandeau-alerte' }, texte),
    });
    bandeauxVerifier.hidden = !bandeaux.aVerifier.length;

    // États : copie vide hors ligne, pas encore de plats, rien à acheter.
    const copieVide = Boolean(c.semainesDepuisCache) && !(c.semaines ?? []).length;
    const dates = lue ? texteDates(lue.debut, lue.fin) : '';
    if (copieVide) {
      montrerEtat('copie-vide', () => etatVide({
        emoji: '🧺',
        teinte: 'olive',
        titre: 'La liste n’est pas encore sur ce téléphone.',
        texte: 'Ouvrez l’app une fois avec du réseau\u00A0: elle restera ensuite disponible en magasin.',
      }));
    } else if (!avecPlats && tous.length) {
      montrerEtat('sans-plats', () => el('section', { class: 'carte carte-sans-plats' },
        el('h2', {}, 'Pas encore de plats pour cette semaine'),
        lienChoisir(false)));
    } else if (!avecPlats) {
      montrerEtat(`vide|${dates}`, () => etatVide({
        emoji: '🧺',
        teinte: 'olive',
        titre: 'Rien à acheter pour l’instant',
        texte: `Choisissez les plats de la semaine${dates ? ` ${dates}` : ''}\u00A0: la liste se fera toute seule.`,
      }, lienChoisir()));
    } else if (reel.vide && !bandeaux.sansRecette) {
      montrerEtat('rien', () => etatVide({ emoji: '🧺', teinte: 'olive', titre: 'Rien à acheter pour l’instant' }));
    } else {
      montrerEtat('', null);
    }

    // « Déjà à la maison ? » : le placard, et les produits rallumés pendant cette visite (gardés jusqu'à la prochaine
    // ouverture de Courses).
    const maison = [
      ...(liste?.maison ?? []),
      ...(liste?.lignes ?? []).filter((l) => l.rachetee && gardesMaison.has(l.cle)),
    ].sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }) || (a.cle < b.cle ? -1 : 1));
    reconcilier(listeMaison, maison, { cle: (l) => l.cle, creer: creerLigneMaison, maj: majLigneMaison });
    zoneMaison.hidden = !maison.length;
    ecrireTexte(resumeMaison, `🏠 Déjà à la maison\u00A0? · ${maison.length}`);

    // Rayons et panier, lignes retenues comprises (elles restent où elles sont jusqu'au départ groupé).
    const actifAvant = document.activeElement;
    const ligneFocus = actifAvant?.closest?.('.ligne-article') ?? null;
    const focusCle = ligneFocus ? partiesLignes.get(ligneFocus)?.cle : null;
    const focusDetails = Boolean(ligneFocus && actifAvant === partiesLignes.get(ligneFocus)?.details);
    const clesAvant = [...vue.querySelectorAll('.ligne-article')].map((li) => partiesLignes.get(li)?.cle).filter(Boolean);
    const resteEnAchat = (e) => retenues.get(e.cle) === 'achat' || (!e.cochee && retenues.get(e.cle) !== 'panier');
    const affichage = grouperParRayon({ lignes: tous.map((e) => ({ ...e, cochee: !resteEnAchat(e) })), articles: [] }, { rayons: rangs });
    reconcilier(rayons, affichage.aAcheter, { cle: (g) => g.rayon, creer: creerRayon, maj: majRayon });
    rayons.hidden = !affichage.aAcheter.length;
    reconcilier(listePanier, affichage.panier, { cle: (l) => l.cle, creer: creerLigne, maj: majLigne, noeuds: noeudsLignes });
    zonePanier.hidden = !affichage.panier.length;
    ecrireTexte(resumePanier, `Dans le panier · ${affichage.panier.length}`);
    if (clesAvant.some((cle) => !actuels.has(cle))) ordrePrecedent = clesAvant;
    for (const cle of [...noeudsLignes.keys()]) if (!actuels.has(cle)) noeudsLignes.delete(cle);
    // Une ligne passée d'une liste à l'autre (cochée sur l'autre téléphone) garde le focus ; une ligne partie (retirée
    // ici ou sur l'autre téléphone) le passe à sa voisine.
    if (focusCle && !(document.activeElement && document.activeElement !== document.body && vue.contains(document.activeElement))) {
      const li = noeudsLignes.get(focusCle);
      const parties = li?.isConnected ? partiesLignes.get(li) : null;
      if (parties) (focusDetails ? parties.details : parties.input)?.focus({ preventScroll: true });
      else focusVoisine(focusCle);
    }

    // Tout pris : seulement si au moins une ligne ou un article existe, et plus rien d'affiché à acheter.
    carteFini.hidden = reel.vide || affichage.aAcheter.length > 0;
    if (vues.length) compenser(vues);
  }

  dessiner();
  majFeuillesArticle(ctx);

  return {
    noeud: vue,
    maj(nouveau) {
      courant = nouveau;
      dessiner();
      majFeuillesArticle(nouveau);
    },
    detruire() {
      clearTimeout(minuteur);
      observateur?.disconnect();
      window.removeEventListener('pointerup', finToucher);
      window.removeEventListener('pointercancel', finToucher);
      window.removeEventListener('scroll', surDefilement);
    },
  };
}
