// Fiche d'un plat : photo, statut, ingrédients, étapes, cuisson, conservation ; en bas, « Mettre à la corbeille ».
// Un plat de la corbeille (fiche ouverte par un lien) se lit sans rien pouvoir y changer : seul « Remettre » agit.
// Demandes (T2e) : dans la vue « Repas et courses », « 📬 Demander ma version » (ou « … pour <Prénom> ») sous une
// version à créer ou à revoir, et « 📬 Demander la recette » sur un plat ⏳ ; une fois demandée, la phrase « 📬 Demandée
// aujourd’hui. … » prend la place du bouton. Le gestionnaire (hors aperçu) lit « 📬 Demandée par <Prénom> le … », et
// « Demander à Claude » vise d'abord la version demandée.
// Semaine (T3a) : sous les badges, « ＋ Ajouter à la semaine » (les deux membres ; bouton principal, sauf quand la fiche
// en a déjà un) ; une fois le plat dans la semaine visée, « ✓ Dans la semaine · Régler › » ouvre la feuille du plat.
import { el, pastille, annoncer } from './dom.js';
import { choisirImage, preparerPhoto } from './photo.js';
import { copier } from './presse-papiers.js';
import { modeDeCuisson } from './pictos.js';
import { lireBrouillon } from './brouillon.js';
import { sectionNotes } from './notes.js';
import {
  etatsCompat, estVous, nomDe, rangerStyles, profilsAgeDe, precautionsDe, texteSeverite, symboleGravite,
} from './compat.js';
import { marqueursDouteux } from '../coeur/compatibilite.js';
import { texteDemandeRecette, texteDemandeVariantes } from '../coeur/claude.js';
import { stylesAttendus, marqueursSurveilles } from '../coeur/regles.js';
import { EMOJIS_STYLE, LIBELLES_STYLE, STYLES } from '../coeur/vocabulaire.js';
import { LIBELLES_TYPE, STATUTS, statutDe, typeDe, quantiteLisible, cuissonLisible, visuelDuPlat } from '../coeur/plats.js';
import { estDansCorbeille, platsSansPreneur, texteCorbeille } from '../coeur/corbeille.js';
import { etatDemande, texteDemandee } from '../coeur/demandes.js';
import { estDansLaSemaine, lireSemaine, peutAllerDansLaSemaine, semaineVisee, texteDates } from '../coeur/semaine.js';
import { majPlatsDeLaSemaine, ouvrirPlatDeLaSemaine, phraseDemandee, restesPour } from './plat-semaine.js';
// T5-0b « Étapes détaillées » : lecture des étapes, carte « Ces étapes sont courtes » (gestionnaire).
import { texteDemandeEtapes } from '../coeur/claude.js';
import { TEXTES_ETAPES, etapesLisibles, etatRealisation, ligneAppareil, ligneDuree } from '../coeur/realisation.js';
import { ouvrirEnSerieEtapes } from './import.js';

// Photos en cours de préparation, au niveau du module : une fiche rouverte pendant la compression le sait.
const compressions = new Map(); // platId → jeton du dernier choix
const fichesOuvertes = new Set(); // fonctions de rafraîchissement des fiches affichées
let jetonSuivant = 0;
let dernierAppui = 0; // horodatage de la dernière ouverture du sélecteur

function rafraichirFiches() {
  for (const rafraichir of fichesOuvertes) rafraichir();
}

/** Prend ou choisit, compresse et enregistre une photo. Seul le dernier choix pour un plat est enregistré. */
async function changerPhoto(id, actions, appareil) {
  // Double appui : un seul sélecteur. Le verrou ne dépend pas de la fin du choix (« cancel » peut ne jamais arriver).
  if (Date.now() - dernierAppui < 1000) return;
  dernierAppui = Date.now();
  const fichier = await choisirImage({ appareil });
  if (!fichier) return;
  jetonSuivant += 1;
  const jeton = jetonSuivant;
  compressions.set(id, jeton);
  rafraichirFiches();
  try {
    const donnees = await preparerPhoto(fichier);
    if (compressions.get(id) !== jeton) return; // un choix plus récent l'emporte
    actions.enregistrerPhoto(id, donnees);
    annoncer('Photo enregistrée.');
  } catch {
    if (compressions.get(id) === jeton) annoncer('Cette image n’a pas pu être lue. Essayez une photo JPEG ou PNG.');
  } finally {
    if (compressions.get(id) === jeton) compressions.delete(id);
    rafraichirFiches();
  }
}

function accord(nombre, singulier, pluriel) {
  return `${nombre}\u00A0${nombre > 1 ? pluriel : singulier}`;
}

function section(titre, ...contenu) {
  return el('section', { class: 'fiche-section' }, el('h2', {}, titre), ...contenu);
}

/** « a », « a et b », « a, b et c » */
function enumerer(mots) {
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}` : mots.join('');
}

const nomsProduits = (ingredients) => [...new Set((ingredients ?? [])
  .map((ingredient) => String(ingredient?.produit ?? '').replace(/\s+/g, ' ').trim())
  .filter(Boolean))];

/** « À manger dans les 2 jours après cuisson » (part au poisson d'une version mer, surtout) ; null sans durée valide. */
function texteFrigo(jours) {
  if (!Number.isInteger(jours) || jours < 1) return null;
  return jours === 1 ? 'À manger dans le jour qui suit la cuisson' : `À manger dans les ${jours}\u00A0jours après cuisson`;
}

/**
 * Contenu d'une version : « Part au thon », « Sans : jambon blanc », « Avec : thon au naturel, 50 g par portion »,
 * « À manger dans les 2 jours après cuisson ».
 */
function detailVersion(variante) {
  const retirer = (Array.isArray(variante?.retirer) ? variante.retirer : []).map((p) => String(p ?? '').trim()).filter(Boolean);
  const ajouter = (Array.isArray(variante?.ajouter) ? variante.ajouter : [])
    .filter((a) => a && typeof a === 'object' && String(a.produit ?? '').trim())
    .map((a) => {
      const quantite = quantiteLisible(a.qtePortion, a.unite);
      return quantite ? `${String(a.produit).trim()}, ${quantite} par portion` : String(a.produit).trim();
    });
  const consigne = typeof variante?.consigne === 'string' ? variante.consigne.trim() : '';
  const frigo = texteFrigo(variante?.frigoJours);
  return [
    consigne ? el('p', { class: 'version-consigne' }, consigne) : null,
    retirer.length ? el('p', {}, el('strong', {}, 'Sans\u00A0:'), ` ${retirer.join(', ')}`) : null,
    ajouter.length ? el('p', {}, el('strong', {}, 'Avec\u00A0:'), ` ${ajouter.join('\u00A0; ')}`) : null,
    frigo ? el('p', { class: 'version-frigo' }, frigo) : null,
  ].filter(Boolean);
}

/** Style écrit d'une version (`mer`, `vegetal`) ; null sinon. */
const styleEcrit = (variante) => (STYLES.includes(variante?.style) ? variante.style : null);

// « pas de version mer pour un dessert » : types qui n'attendent pas de version mer (regles.js › TYPES_SANS_MER).
const POUR_UN = { dessert: 'un dessert', accompagnement: 'un accompagnement' };

/**
 * Une version dans la section d'un profil : titre « 🐟 Version mer », « 🌿 Version végétale » (ou « Version » pour un
 * profil sans style attendu), « ❌ À revoir » si elle ne convient pas (gestionnaire seul : l'autre membre ne voit que
 * les versions qui conviennent), puis son contenu. `version` : élément de evaluer(…).versions. `plusUtilisee` : texte
 * discret, sans croix, d'une version d'un style que le profil n'attend plus et qu'une autre version remplace déjà
 * (rien à redemander : la prochaine version reçue pour ce profil la retire).
 */
function partieVersion({ variante, style, convient, restants }, { avecStyles, gestionnaire, plusUtilisee = '' }) {
  const nomme = avecStyles || styleEcrit(variante) ? style : null;
  const emoji = nomme ? EMOJIS_STYLE[nomme] : convient ? '🌿' : '';
  const noms = (restants ?? []).filter(Boolean);
  let etat = null;
  if (!convient && gestionnaire) {
    etat = plusUtilisee
      ? el('p', { class: 'compat-texte compat-discret' }, plusUtilisee)
      : el('p', { class: 'compat-texte compat-exclu' }, el('span', { 'aria-hidden': 'true' }, '❌\u00A0'),
        noms.length ? `À revoir\u00A0: elle contient encore ${enumerer(noms)}.` : 'À revoir.');
  }
  return el('div', { class: 'version-style' },
    el('h3', {}, emoji ? el('span', { 'aria-hidden': 'true' }, `${emoji}\u00A0`) : null,
      nomme ? `Version ${LIBELLES_STYLE[nomme]}` : 'Version'),
    etat,
    ...detailVersion(variante));
}

/**
 * « Plus utilisée : <Prénom> ne mange pas de poisson. » ou « Plus utilisée : pas de version mer pour un dessert. »,
 * pour une version qui ne convient pas, d'un style que le profil n'attend pas pour ce plat (regles.js ›
 * stylesAttendus), quand une autre de ses versions convient ; '' sinon (elle reste « À revoir »).
 */
function textePlusUtilisee(version, profil, plat, { avecStyles, autreConvient }) {
  if (!avecStyles || version.convient || !autreConvient || stylesAttendus(profil, plat).includes(version.style)) return '';
  const pourUn = POUR_UN[typeDe(plat)];
  return stylesAttendus(profil).includes(version.style) && pourUn
    ? `Plus utilisée\u00A0: pas de version ${LIBELLES_STYLE[version.style] ?? version.style} pour ${pourUn}.`
    : `Plus utilisée\u00A0: ${nomDe(profil)} ne mange pas de poisson.`;
}

/** « 🌿 Version végétale à demander » (gestionnaire) : un style attendu sans aucune version sur la fiche. */
function ligneADemander(style) {
  return el('p', { class: 'version-a-demander' }, el('span', { 'aria-hidden': 'true' }, `${EMOJIS_STYLE[style]}\u00A0`),
    `Version ${LIBELLES_STYLE[style]} à demander`);
}

/**
 * Section « Version pour <Prénom> » d'un profil qui a des règles (« Votre version » pour soi, vue « Repas et
 * courses ») : la version qui convient ; sinon ce qui manque, avec ❌ pour le gestionnaire seulement.
 * Profil qui attend des styles (« Pas de viande » : mer et végétale), ou qui a plusieurs versions : une partie par
 * version (« 🐟 Version mer », « 🌿 Version végétale »), puis, pour le gestionnaire, les styles qui manquent encore
 * (« 🌿 Version végétale à demander »). L'autre membre ne voit que les versions qui conviennent.
 */
function sectionVersion({ profil, resultat, cas }, plat, { moi, role }, actions = null) {
  const nom = nomDe(profil);
  const vous = estVous(profil, { moi, role });
  const gestionnaire = role === 'gestionnaire';
  const avecStyles = stylesAttendus(profil).length > 0;
  const toutes = (Array.isArray(resultat.versions) ? resultat.versions : []).filter((v) => v && v.variante);
  const autreConvient = toutes.some((v) => v.convient);
  const plusUtilisee = (v) => textePlusUtilisee(v, profil, plat, { avecStyles, autreConvient });
  // Mer puis végétale, une version plus utilisée en dernier (tri stable : l'ordre de la fiche pour le reste).
  const rang = (v) => (avecStyles ? (plusUtilisee(v) ? STYLES.length : Math.max(0, STYLES.indexOf(v.style))) : 0);
  const versions = (gestionnaire ? toutes : toutes.filter((v) => v.convient)).sort((a, b) => rang(a) - rang(b));
  // Styles attendus sans aucune version sur la fiche (une version à revoir est déjà montrée) : gestionnaire seul.
  const aDemander = gestionnaire && avecStyles && cas !== 'version'
    ? rangerStyles(resultat.manquants).filter((style) => !toutes.some((v) => v.style === style))
    : [];
  const variante = (plat.variantes ?? []).find((v) => v && v.pour === profil.id);
  const parParties = (avecStyles || versions.length > 1) && (cas === 'version' || cas === 'aCompleter' || (cas === 'aRevoir' && gestionnaire));
  let titre;
  let contenu;
  let emojiTitre = false;
  if (parParties) {
    const convient = versions.some((v) => v.convient);
    const n = versions.length;
    // Tant qu'aucune version ne convient, le titre ne l'annonce pas (« Pour vous » plutôt que « Votre version »).
    if (!convient) titre = vous ? 'Pour vous' : `Pour ${nom}`;
    else if (vous) titre = n > 1 ? 'Vos versions' : 'Votre version';
    else titre = n > 1 ? `Versions pour ${nom}` : `Version pour ${nom}`;
    contenu = [
      ...versions.map((version) => partieVersion(version, { avecStyles, gestionnaire, plusUtilisee: plusUtilisee(version) })),
      ...aDemander.map(ligneADemander),
    ];
  } else if (cas === 'version' || cas === 'aCompleter') {
    // Profil sans style attendu, une seule version : comme avant les styles.
    titre = vous ? 'Votre version' : `Version pour ${nom}`;
    emojiTitre = true;
    contenu = detailVersion(resultat.variante ?? variante);
  } else if (cas === 'aRevoir' && gestionnaire) {
    titre = `Pour ${nom}`;
    const restants = (resultat.restants ?? []).filter(Boolean);
    contenu = [
      el('p', { class: 'compat-texte compat-exclu' }, el('span', { 'aria-hidden': 'true' }, '❌\u00A0'),
        restants.length
          ? `La version pour ${nom} contient encore\u00A0: ${enumerer(restants)}.`
          : `La version pour ${nom} est à revoir.`),
      ...detailVersion(variante),
    ];
  } else {
    titre = vous ? 'Pour vous' : `Pour ${nom}`;
    const noms = nomsProduits(cas === 'aRevoir' && resultat.restants?.length
      ? resultat.restants.map((produit) => ({ produit }))
      : resultat.fautifs);
    const entre = noms.length ? ` (${enumerer(noms)})` : '';
    contenu = [
      el('p', { class: `compat-texte ${gestionnaire ? 'compat-exclu' : 'compat-discret'}` },
        gestionnaire ? el('span', { 'aria-hidden': 'true' }, '❌\u00A0') : null,
        `Pas encore de version pour ${vous ? 'vous' : nom}${entre}.`),
      // À créer (gestionnaire) : les versions que « Demander à Claude » demandera.
      ...aDemander.map(ligneADemander),
    ];
  }
  return el('section', { class: 'fiche-section section-version' },
    el('h2', {}, emojiTitre ? el('span', { 'aria-hidden': 'true' }, '🌿\u00A0') : null, titre),
    ...contenu,
    actions);
}

/**
 * Section « 🧸 Pour <Enfant> » d'un profil qui a des précautions d'âge actives : une ligne par précaution que le plat
 * (tel qu'il lui serait servi) déclenche, avec les produits en cause et le conseil (« ! Déconseillé avant 15 ans :
 * viande crue (rôti de bœuf). Cuire à cœur, sans rose (surtout la viande hachée). »). ❌ et ! pour le gestionnaire
 * seul ; dans la vue « Repas et courses », la gravité passe par « Pas avant » et « Déconseillé ». Pour le gestionnaire,
 * un lien « Ses précautions › » vers « 🧸 Ce que <Enfant> mange ». Null sans précaution.
 */
function sectionAge(profil, precautions, { role }) {
  const liste = (Array.isArray(precautions) ? precautions : []).filter((p) => p && typeof p === 'object');
  if (!liste.length) return null;
  const nom = nomDe(profil);
  const gestionnaire = role === 'gestionnaire';
  const lignes = liste.map((precaution) => {
    const produits = (precaution.produits ?? []).filter(Boolean);
    const entre = produits.length ? ` (${produits.join(', ')})` : '';
    const consigne = typeof precaution.consigne === 'string' && precaution.consigne.trim() ? ` ${precaution.consigne.trim()}` : '';
    let classe = 'compat-texte compat-enfant';
    if (gestionnaire) classe = precaution.severite === 'exclu' ? 'compat-texte compat-exclu' : 'compat-texte compat-age-attention';
    return el('li', { class: classe },
      symboleGravite(precaution.severite, role),
      `${texteSeverite(precaution.severite, precaution.jusquAMois)}\u00A0: ${precaution.court ?? ''}${entre}.${consigne}`);
  });
  return el('section', { class: 'fiche-section section-age' },
    el('h2', {}, el('span', { 'aria-hidden': 'true' }, '🧸\u00A0'), `Pour ${nom}`),
    el('ul', { class: 'liste-precautions-plat' }, lignes),
    gestionnaire
      ? el('a', {
        class: 'lien-fiche',
        href: `#/regime/${encodeURIComponent(profil.id)}`,
        // Repère stable : la section est reconstruite à chaque rendu, le lien remplaçant reprend le focus.
        'data-repere': `precautions-${profil.id}`,
      }, 'Ses précautions ›')
      : null);
}

// Ce que le nom d'un ingrédient laisse penser, pour la ligne « à vérifier » (gestionnaire).
const SOUPCONS = {
  viande: 'de la viande',
  bouillon_viande: 'de la viande',
  gelatine_animale: 'de la gélatine animale',
  graisse_animale: 'de la graisse animale',
  fruit_coque: 'des fruits à coque entiers',
  cafeine: 'du café ou du thé',
  miel: 'du miel',
  poisson_predateur: 'de l’espadon, du requin ou du marlin',
  soja: 'du soja',
};

/**
 * « « noix » contient peut-être des fruits à coque entiers : vérifiez-le dans Modifier. » ; pour `cru`, « « jambon
 * cru » est peut-être cru : vérifiez-le dans Modifier. »
 */
function texteSoupcon(produit, attendu) {
  const soupcon = attendu === 'cru'
    ? 'est peut-être cru'
    : `contient peut-être ${SOUPCONS[attendu] ?? 'un ingrédient à vérifier'}`;
  return `«\u00A0${produit}\u00A0» ${soupcon}\u00A0: vérifiez-le dans Modifier.`;
}

/**
 * Bandeau « à vérifier » (gestionnaire) : ingrédients dont le nom annonce un repère qu'une règle active surveille et
 * qu'ils ne portent pas (coeur/compatibilite.js › marqueursDouteux, filtré par `surveilles`). Une ligne par soupçon,
 * sans doublon. Null sans soupçon.
 */
function carteDouteux(plat, surveilles) {
  const textes = [...new Set(marqueursDouteux(plat, { surveilles })
    .map(({ produit, attendu }) => texteSoupcon(produit, attendu)))];
  if (!textes.length) return null;
  return el('section', { class: 'bandeau bandeau-alerte bandeau-colonne compat-douteux' },
    textes.map((texte) => el('p', {}, el('span', { 'aria-hidden': 'true' }, '⚠️\u00A0'), texte)),
    el('a', { class: 'lien-fiche', href: `#/modifier/${encodeURIComponent(plat.id)}` }, 'Modifier ›'));
}

/** Vrai pour un profil à qui aucune version ne convient encore (à créer ou à revoir) : sa version peut se demander. */
const versionAFaire = (etat) => etat.cas === 'aCreer' || etat.cas === 'aRevoir';

/**
 * Profil dont une version manque, dans l'ordre des profils : à créer ou à revoir et demandé d'abord (`demandes` :
 * identifiants des profils dont la demande est ouverte et utile), puis à créer ou à revoir, sinon à compléter (une
 * version convient, il en manque d'un style attendu). → état de etatsCompat, ou null.
 */
function versionAttendue(etats, demandes = new Set()) {
  return etats.find((etat) => versionAFaire(etat) && demandes.has(etat.profil.id))
    ?? etats.find(versionAFaire)
    ?? etats.find((etat) => etat.cas === 'aCompleter')
    ?? null;
}

// Clé du bloc « 📬 Demander la recette » ; celle d'une version est `profil:<id>`. Phrase « 📬 Demandée… » :
// plat-semaine.js › phraseDemandee (partagée avec la feuille du plat de la semaine).
const CLE_RECETTE = 'recette';

/** Ligne « 📬 Demandée par Adulte B le 9 octobre. » (gestionnaire) : qui a demandé, et quand ; jamais une adresse. */
function ligneDemandee(demande, { profils, moi }) {
  return el('p', { class: 'demande-etat' }, el('span', { 'aria-hidden': 'true' }, '📬\u00A0'),
    texteDemandee(demande, { profils, moi, avecAuteur: true, horsLigne: !navigator.onLine }));
}

/**
 * Carte « Personne n'en veut » (les deux membres) : plat noté « Jamais » par tous les profils (coeur/corbeille.js ›
 * platsSansPreneur). La corbeille est seulement proposée : un toucher, et l'annonce permet d'annuler. Créée une fois
 * par fiche, son texte mis à jour à chaque rendu (`maj(profils)`) : son bouton garde le focus.
 * → { noeud, bouton, maj }
 */
function creerCarteSansPreneur(mettreALaCorbeille) {
  const texte = el('p', {});
  const bouton = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: mettreALaCorbeille },
    el('span', { 'aria-hidden': 'true' }, '🗑️'), 'Le mettre à la corbeille');
  const noeud = el('section', { class: 'carte carte-sans-preneur' },
    el('div', { class: 'carte-ligne' },
      pastille('👎', 'ocre'),
      el('div', { class: 'carte-texte' }, el('h2', {}, 'Personne n’en veut'), texte)),
    bouton);
  function maj(profils) {
    const seul = profils.length === 1 ? nomDe(profils[0]) : null;
    texte.textContent = `${seul ? `${seul} l’a noté` : 'Tout le monde l’a noté'} «\u00A0Jamais\u00A0». Le mettre à la corbeille\u202F?`;
  }
  return { noeud, bouton, maj };
}

/**
 * Une étape détaillée (T5-0b) : titre en gras, texte, « ⏱ 10 min · dont 1 min de travail », appareil et feu,
 * quantités de l'étape (pour les portions de la recette), « Et aussi », « ✓ Prêt quand : … ». Numérotée par son rang
 * dans la recette (`value`), même dans « Le jour du repas ».
 */
function etapeDetaillee(etape) {
  const duree = ligneDuree(etape).replace(/^⏱\s*/u, '');
  const appareil = ligneAppareil(etape);
  return el('li', { class: 'etape-detaillee', value: String(etape.n) },
    el('p', { class: 'etape-titre' }, etape.titre),
    etape.texte ? el('p', { class: 'etape-texte' }, etape.texte) : null,
    duree || appareil
      ? el('p', { class: 'etape-reperes' },
        duree ? el('span', {}, el('span', { 'aria-hidden': 'true' }, '⏱\u00A0'), duree) : null,
        appareil ? el('span', {}, appareil) : null)
      : null,
    etape.ingredients.length
      ? el('ul', { class: 'etape-ingredients' }, etape.ingredients.map((ingredient) => el('li', {}, ingredient.texte)))
      : null,
    etape.aussi.length
      ? el('p', { class: 'etape-aussi' },
        el('span', { class: 'etape-libelle' }, `${TEXTES_ETAPES.etAussi}\u00A0: `),
        etape.aussi.map((element) => element.texte).join(' · '))
      : null,
    etape.pret ? el('p', { class: 'etape-pret' }, TEXTES_ETAPES.pretQuand(etape.pret)) : null,
  );
}

/**
 * Partie « Étapes » de la fiche (T5-0b) : étapes détaillées à jour en liste numérotée, celles « Le jour du repas » à
 * part ; sinon les étapes courtes, comme avant. `carte` : la carte « Ces étapes sont courtes » du gestionnaire.
 */
function sectionEtapes(plat, carte) {
  const { etapes, detaillee } = etapesLisibles(plat);
  if (!detaillee) {
    const courtes = (plat.etapes ?? []).map((etape) => String(etape));
    if (!courtes.length && !carte) return null;
    return section('Étapes',
      courtes.length ? el('ol', { class: 'liste-etapes' }, courtes.map((etape) => el('li', {}, etape))) : null,
      carte);
  }
  const cuisine = etapes.filter((etape) => !etape.auService);
  const service = etapes.filter((etape) => etape.auService);
  return section('Étapes',
    cuisine.length ? el('ol', { class: 'liste-etapes liste-etapes-detaillees' }, cuisine.map(etapeDetaillee)) : null,
    service.length
      ? el('div', { class: 'etapes-service' },
        el('h3', {}, TEXTES_ETAPES.jourDuRepas),
        el('ol', { class: 'liste-etapes liste-etapes-detaillees' }, service.map(etapeDetaillee)))
      : null,
    carte);
}

function ligneInfo(terme, definition) {
  return definition ? el('div', { class: 'ligne-info' }, el('dt', {}, terme), el('dd', {}, definition)) : null;
}

export function creer(ctx) {
  const id = ctx.parametre;
  let courant = ctx;
  let photo; // undefined : en cours de lecture ; null : pas de photo ; { image } sinon
  let retraitAConfirmer = false;
  let minuteurRetrait = null;

  const figure = el('figure', { class: 'photo-plat' });
  const contenu = el('div', { class: 'fiche-contenu' });
  // Boutons gardés d'un rendu à l'autre : le focus (clavier, TalkBack) n'est pas perdu.
  const boutonAppareil = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions, true) });
  const boutonGalerie = el('button', { class: 'bouton bouton-secondaire', type: 'button', onclick: () => changerPhoto(id, courant.actions, false) }, '🖼️ Depuis la galerie');
  const boutonRetrait = el('button', { class: 'bouton bouton-texte', type: 'button', onclick: retirer });
  const actionsPhoto = el('div', { class: 'actions-photo' },
    el('div', { class: 'choix-photo' }, boutonAppareil, boutonGalerie),
    boutonRetrait);

  // Claude (gestionnaire) : un seul « Demander à Claude », dont le texte dépend du plat (demandeDuPlat), et « Coller la
  // réponse », qui ouvre l'ajout pour ce plat. Gardés d'un rendu à l'autre, comme les boutons de la photo.
  let demandeCopiee = false;
  const boutonDemander = el('button', { class: 'bouton bouton-plein', type: 'button', onclick: demanderAClaude }, '📋 Demander à Claude');
  const lienColler = el('a', { class: 'bouton bouton-plein', href: `#/import/${encodeURIComponent(id)}` }, 'Coller la réponse');
  const messageCopie = el('p', { class: 'aide', role: 'status' });
  const actionsRecette = el('div', { class: 'actions-recette' }, messageCopie, boutonDemander, lienColler);
  // Vrai quand « Demander à Claude » est dans la section « Nouvelle version » (bas de fiche, geste rare) : il y est
  // secondaire, pour que « ＋ Ajouter à la semaine » reste le bouton principal de la fiche.
  let actionsEnBas = false;

  // Étapes détaillées (T5-0b, gestionnaire hors aperçu) : carte « Ces étapes sont courtes. … » sous les étapes d'une
  // recette pas détaillée, gardée d'un rendu à l'autre. Avant la copie, ses deux boutons sont secondaires (la fiche a
  // déjà son bouton principal) ; ensuite, « Coller la réponse de Claude » devient l'action principale.
  let etapesCopiees = false;
  const texteEtapesCourtes = el('p', {});
  const boutonEtapes = el('button', {
    class: 'bouton bouton-secondaire bouton-plein', type: 'button', 'data-action': 'demander-etapes', onclick: demanderEtapes,
  }, el('span', { 'aria-hidden': 'true' }, '📋\u00A0'), TEXTES_ETAPES.demanderSesEtapes.replace(/^📋\s*/u, ''));
  const lienCollerEtapes = el('a', {
    class: 'bouton bouton-secondaire bouton-plein',
    href: '#/import',
    'data-action': 'coller-etapes',
    onclick: () => ouvrirEnSerieEtapes({ platId: id }),
  }, TEXTES_ETAPES.collerLaReponse);
  const messageEtapes = el('p', { class: 'aide', role: 'status', hidden: true });
  const carteEtapes = el('div', { class: 'carte-etapes-courtes' },
    texteEtapesCourtes, messageEtapes, boutonEtapes, lienCollerEtapes);

  // « ＋ Ajouter à la semaine » (T3a) : gardé d'un rendu à l'autre (le focus reste sur le bouton touché, qui devient
  // « ✓ Dans la semaine · Régler › »). Inactif tant que les semaines ne sont pas lues ; absent sur un plat de la
  // corbeille. La semaine visée (coeur/semaine.js › semaineVisee) est calculée au toucher ; si ce n'est pas celle qui
  // est montrée, une aide le dit (« Pour la semaine du 17 au 23 octobre. ») ; l'annonce de l'app donne les dates.
  const libelleSemaine = el('span', {});
  const iconeSemaine = el('span', { 'aria-hidden': 'true' });
  const boutonSemaine = el('button', { class: 'bouton bouton-plein', type: 'button', onclick: toucherSemaine },
    iconeSemaine, libelleSemaine);
  const aideSemaine = el('p', { class: 'aide aide-semaine', id: 'fiche-aide-semaine', hidden: true });
  const blocSemaine = el('div', { class: 'bloc-semaine' }, boutonSemaine, aideSemaine);
  // Ce qui décide si le bouton est principal : la fiche a-t-elle déjà un bouton principal ? (dernier rendu)
  let autrePrincipal = false;

  // « Modifier la recette » (les deux membres), ou « Reprendre » si une modification attend sur ce téléphone.
  const lienModifier = el('a', { class: 'bouton bouton-secondaire bouton-plein', href: `#/modifier/${encodeURIComponent(id)}` });
  const carteReprise = el('section', { class: 'carte carte-reprise' },
    el('div', { class: 'carte-ligne' },
      pastille('✏️', 'ocre'),
      el('div', { class: 'carte-texte' },
        el('h2', {}, 'Modifications pas encore enregistrées'),
        el('p', {}, 'Reprenez là où vous en étiez.'))),
    el('a', { class: 'bouton bouton-principal bouton-plein', href: `#/modifier/${encodeURIComponent(id)}` }, 'Reprendre'));

  // Notes de chaque profil : section gardée d'un rendu à l'autre, mise à jour en place (focus conservé).
  const notes = sectionNotes(ctx, id);

  // Corbeille : « Remettre » d'un plat de la corbeille, gardé d'un rendu à l'autre (focus conservé).
  const texteJete = el('p', {});
  const boutonRemettre = el('button', { class: 'bouton bouton-principal bouton-plein', type: 'button', onclick: remettre }, 'Remettre');
  const carteJete = el('section', { class: 'carte carte-corbeille' },
    el('div', { class: 'carte-ligne' },
      pastille('🗑️', 'ocre'),
      el('div', { class: 'carte-texte' },
        el('h2', {}, 'Ce plat est dans la corbeille'),
        texteJete,
        el('p', {}, 'Il n’apparaît plus dans vos plats. Remettez-le pour le retrouver.'))),
    boutonRemettre);
  let depart = false; // vrai dès que la fiche part vers la liste, après « Mettre à la corbeille »
  // « Mettre à la corbeille » (bouton discret) et carte « Personne n'en veut » : gardés d'un rendu à l'autre, comme
  // « Modifier », pour qu'une mise à jour venue de l'autre téléphone ne leur fasse pas perdre le focus.
  const boutonCorbeille = el('button', { class: 'bouton bouton-texte bouton-corbeille', type: 'button', onclick: mettreALaCorbeille },
    el('span', { 'aria-hidden': 'true' }, '🗑️'), 'Mettre à la corbeille');
  const carteSansPreneur = creerCarteSansPreneur(mettreALaCorbeille);

  // La corbeille comprise : un plat de la corbeille garde sa fiche, ouverte par un lien (sinon « n'existe plus »).
  const platCourant = () => (courant.tousLesPlats ?? courant.plats).find((plat) => plat.id === id);
  const aUnePhoto = (plat) => Boolean(plat?.vignette || photo?.image);

  // « 📬 Demander ma version » / « 📬 Demander la recette » (vue « Repas et courses ») : un bloc par profil (clé
  // `profil:<id>`) et un pour la recette (CLE_RECETTE), créé au premier besoin et gardé d'un rendu à l'autre (le focus
  // reste sur le bouton ou sur la phrase). Après le toucher, la phrase « 📬 Demandée… » prend la place du bouton et
  // reçoit le focus ; « Annuler » (annonce de l'app) remet le bouton et lui rend le focus.
  const blocsDemande = new Map(); // clé → { noeud, bouton, libelle, phrase, texte }

  function blocDemande(cle) {
    let bloc = blocsDemande.get(cle);
    if (bloc) return bloc;
    const libelle = el('span', {});
    const bouton = el('button', { class: 'bouton bouton-secondaire bouton-plein', type: 'button', onclick: () => demander(cle) },
      el('span', { 'aria-hidden': 'true' }, '📬'), libelle);
    const texte = el('span', {});
    const phrase = el('p', { class: 'demande-etat', tabindex: '-1' }, el('span', { 'aria-hidden': 'true' }, '📬\u00A0'), texte);
    bloc = { noeud: el('div', { class: 'bloc-demande' }, bouton, phrase), bouton, libelle, phrase, texte };
    blocsDemande.set(cle, bloc);
    return bloc;
  }

  /** Textes du bloc, réécrits seulement s'ils changent (le lecteur d'écran ne relit pas une phrase inchangée). */
  function ecrireBloc(bloc, { libelle = null, phrase = null }) {
    if (libelle !== null && bloc.libelle.textContent !== libelle) bloc.libelle.textContent = libelle;
    if (phrase !== null && bloc.texte.textContent !== phrase) bloc.texte.textContent = phrase;
    bloc.bouton.hidden = libelle === null;
    bloc.phrase.hidden = phrase === null;
  }

  /**
   * « 📬 Demander… » : l'app écrit la demande, l'affiche tout de suite et redessine la fiche (la phrase remplace le
   * bouton), puis annonce « C’est demandé. » avec « Annuler ». Rien n'est attendu.
   */
  function demander(cle) {
    const bloc = blocsDemande.get(cle);
    if (!bloc || typeof courant.actions?.demander !== 'function') return;
    courant.actions.demander({
      platId: id,
      profilId: cle === CLE_RECETTE ? null : cle.slice('profil:'.length),
      apresAnnulation: () => {
        if (bloc.bouton.isConnected && !bloc.bouton.hidden) bloc.bouton.focus();
      },
    });
    if (bloc.phrase.isConnected && !bloc.phrase.hidden) bloc.phrase.focus();
  }

  const optionsDemande = () => ({ demandes: courant.demandes ?? [], evaluer: courant.compat });

  /**
   * Demande de version de chaque profil à qui aucune version ne convient (coeur/demandes.js › etatDemande), une fois
   * les demandes chargées : Map profilId → null | { possible, id } | { ouverte }.
   */
  function situationsDemande(plat, etats) {
    if (!courant.demandesChargees || estDansCorbeille(plat)) return new Map();
    return new Map(etats.filter(versionAFaire)
      .map((etat) => [etat.profil.id, etatDemande(plat, etat.profil, optionsDemande())]));
  }

  /** Identifiants des profils dont la demande de version est ouverte et utile. */
  const profilsDemandeurs = (situations) => new Set([...situations]
    .filter(([, situation]) => situation?.ouverte)
    .map(([profilId]) => profilId));

  /**
   * Texte copié par « Demander à Claude » : plat ⏳ → la recette, avec les versions des profils qui ont des règles ;
   * plat dont une version manque pour un profil (versionAttendue : le profil qui l'a demandée d'abord) → ses versions
   * seules (celles « à faire » : à créer, à revoir ou à compléter) ; sinon → une nouvelle recette, comme en T1b (avec
   * les versions des profils qui ont des règles).
   */
  function demandeDuPlat(plat) {
    if (statutDe(plat) !== 'attente') {
      const etats = etatsCompat(plat, courant);
      const manque = versionAttendue(etats, profilsDemandeurs(situationsDemande(plat, etats)));
      if (manque) return texteDemandeVariantes([plat], manque.profil);
    }
    return texteDemandeRecette(plat, { profils: courant.profils ?? [] });
  }

  async function demanderAClaude() {
    const plat = platCourant();
    if (!plat) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    const reussi = await copier(demandeDuPlat(plat));
    demandeCopiee = demandeCopiee || reussi;
    messageCopie.textContent = reussi
      ? 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la réponse\u00A0».'
      : 'La copie n’a pas marché. Réessayez.';
    majActionsRecette();
  }

  /** « 📋 Demander ses étapes détaillées » (T5-0b) : DEMANDE-ETAPES pour ce seul plat. */
  async function demanderEtapes() {
    const plat = platCourant();
    if (!plat) return;
    // Texte calculé dans le toucher, avant toute attente : la copie de repli reste permise.
    const reussi = await copier(texteDemandeEtapes([plat], { appareils: courant.reglages?.appareils ?? null }));
    etapesCopiees = etapesCopiees || reussi;
    messageEtapes.textContent = reussi
      ? 'Copié. Collez-le dans votre projet Claude, puis revenez ici et touchez «\u00A0Coller la réponse de Claude\u00A0».'
      : 'La copie n’a pas marché. Réessayez.';
    messageEtapes.hidden = false;
    lienCollerEtapes.className = `bouton bouton-plein ${etapesCopiees ? 'bouton-principal' : 'bouton-secondaire'}`;
    majBlocSemaine();
  }

  /**
   * Avant la copie, l'action principale est « Demander à Claude » ; ensuite, « Coller la réponse ». Dans la section
   * « Nouvelle version » (bas de fiche), « Demander à Claude » reste secondaire.
   */
  function majActionsRecette() {
    const principal = demandeCopiee ? lienColler : actionsEnBas ? null : boutonDemander;
    boutonDemander.className = `bouton bouton-plein ${principal === boutonDemander ? 'bouton-principal' : 'bouton-secondaire'}`;
    lienColler.className = `bouton bouton-plein ${principal === lienColler ? 'bouton-principal' : 'bouton-secondaire'}`;
    messageCopie.hidden = !messageCopie.textContent;
    majBlocSemaine();
  }

  /**
   * La semaine visée et le plat : { visee, montree, dedans } ; null tant que les semaines ne sont pas lues. `dedans` :
   * le plat est déjà dans la semaine visée.
   */
  function etatSemaine() {
    if (!courant.semainesChargees) return null;
    const visee = semaineVisee(courant.semaines ?? [], courant.aujourdhui);
    if (!visee) return null;
    const semaineDeLaCible = lireSemaine((courant.semaines ?? []).find((s) => s?.id === visee.id));
    return {
      visee,
      montree: lireSemaine(courant.semaine),
      dedans: estDansLaSemaine(semaineDeLaCible?.plats?.[id]),
    };
  }

  /** « ＋ Ajouter à la semaine » : écrit dans la semaine visée (créée au besoin) ; « Régler › » ouvre la feuille du plat. */
  function toucherSemaine() {
    const etat = etatSemaine();
    const plat = platCourant();
    if (!etat || !plat || !peutAllerDansLaSemaine(plat)) return;
    if (etat.dedans) {
      if (etat.montree?.id !== etat.visee.id) {
        location.hash = '#/semaine';
        return;
      }
      ouvrirPlatDeLaSemaine(() => courant, id, {
        onFermer: () => {
          if (boutonSemaine.isConnected) boutonSemaine.focus();
        },
      });
      return;
    }
    courant.actions?.ajouterALaSemaine?.(id, { cible: etat.visee, restes: restesPour(courant, etat.visee) });
  }

  /** Texte, rôle et aide du bouton de la semaine, d'après l'état du moment ; réécrits seulement s'ils changent. */
  function majBlocSemaine() {
    const etat = etatSemaine();
    const dedans = Boolean(etat?.dedans);
    const icone = dedans ? '✓' : '＋';
    const libelle = dedans ? 'Dans la semaine · Régler ›' : 'Ajouter à la semaine';
    if (iconeSemaine.textContent !== icone) iconeSemaine.textContent = icone;
    if (libelleSemaine.textContent !== libelle) libelleSemaine.textContent = libelle;
    const principal = !dedans && !autrePrincipal && !(actionsEnBas && demandeCopiee) && !etapesCopiees;
    const classe = `bouton bouton-plein ${principal ? 'bouton-principal' : 'bouton-secondaire'}`;
    if (boutonSemaine.className !== classe) boutonSemaine.className = classe;
    boutonSemaine.disabled = !etat;
    const autre = etat && !dedans && etat.montree?.id !== etat.visee.id;
    const aide = autre ? `Pour la semaine ${texteDates(etat.visee.debut, etat.visee.fin)}.` : '';
    if (aideSemaine.textContent !== aide) aideSemaine.textContent = aide;
    aideSemaine.hidden = !aide;
    if (aide) boutonSemaine.setAttribute('aria-describedby', 'fiche-aide-semaine');
    else boutonSemaine.removeAttribute('aria-describedby');
  }

  /**
   * « Mettre à la corbeille » (les deux membres ; aussi depuis la carte « Personne n'en veut ») : retour à la liste des
   * plats, puis l'action, qui annonce « « X » est dans la corbeille » avec « Annuler ». Venu de la liste (l'entrée
   * d'historique le dit aussi : une fiche ouverte depuis une autre fiche n'y revient pas) : un pas en arrière ; sinon
   * la fiche est remplacée (le geste retour ne ramène pas à un plat jeté).
   */
  function mettreALaCorbeille() {
    const plat = platCourant();
    if (!plat || estDansCorbeille(plat) || depart) return;
    depart = true;
    if (courant.routePrecedente === 'plats' && history.state?.precedente === 'plats' && history.length > 1) history.back();
    else location.replace('#/plats');
    courant.actions.mettreALaCorbeille([id]);
  }

  /** « Remettre » : le plat revient dans les plats ; la fiche redevient complète, le focus passe à « Modifier ». */
  function remettre() {
    const plat = platCourant();
    if (!plat || !estDansCorbeille(plat)) return;
    courant.actions.remettreDeLaCorbeille([id]);
    const suivant = lienModifier.isConnected ? lienModifier : carteReprise.querySelector('a');
    if (suivant?.isConnected) suivant.focus();
  }

  const arreterPhoto = ctx.actions.suivrePhoto(id, (donnees) => {
    photo = donnees;
    dessinerPhoto();
    majBoutonsPhoto();
  });

  function dessinerPhoto() {
    const plat = platCourant();
    figure.hidden = !plat;
    if (!plat) {
      figure.replaceChildren();
      return;
    }
    const source = photo?.image ?? plat.vignette;
    figure.classList.toggle('sans-photo', !source);
    if (source) {
      const image = figure.querySelector('img') ?? el('img', {});
      image.src = source;
      image.alt = `Photo du plat\u00A0: ${plat.nom}`;
      image.classList.toggle('en-attente', !photo?.image);
      if (!image.isConnected) figure.replaceChildren(image);
    } else {
      const { emoji, teinte } = visuelDuPlat(plat);
      figure.replaceChildren(pastille(emoji, teinte, true));
    }
  }

  function majBoutonsPhoto() {
    const plat = platCourant();
    // Plat de la corbeille : photo visible, mais rien à y changer.
    actionsPhoto.hidden = !plat || estDansCorbeille(plat);
    if (actionsPhoto.hidden) return;
    const enCours = compressions.has(id);
    const avecPhoto = aUnePhoto(plat);
    boutonAppareil.disabled = enCours;
    boutonGalerie.disabled = enCours;
    boutonAppareil.textContent = enCours ? 'Photo en cours…' : '📷 Prendre une photo';
    boutonRetrait.hidden = !avecPhoto || enCours;
    boutonRetrait.textContent = retraitAConfirmer ? 'Toucher pour confirmer le retrait' : 'Retirer la photo';
  }

  function retirer() {
    clearTimeout(minuteurRetrait);
    if (!retraitAConfirmer) {
      retraitAConfirmer = true;
      annoncer('Touchez à nouveau pour retirer la photo.');
      minuteurRetrait = setTimeout(() => {
        retraitAConfirmer = false;
        majBoutonsPhoto();
      }, 8000);
      majBoutonsPhoto();
      return;
    }
    retraitAConfirmer = false;
    courant.actions.retirerPhoto(id);
    photo = null;
    annoncer('Photo retirée.');
    dessinerPhoto();
    majBoutonsPhoto();
    boutonAppareil.focus();
  }

  function dessiner() {
    const plat = platCourant();
    if (!plat) {
      contenu.replaceChildren(courant.platsCharges
        ? el('div', { class: 'carte etat-vide compact' },
          el('p', {}, 'Ce plat n’existe plus.'),
          el('a', { class: 'bouton bouton-secondaire', href: '#/plats' }, 'Voir les plats'))
        : el('p', { class: 'texte-doux', role: 'status' }, 'Chargement…'));
      return;
    }

    const statut = statutDe(plat);
    // Plat de la corbeille : recette en lecture seule, sous la carte « Remettre » (ni notes, ni Claude, ni Modifier).
    const jete = estDansCorbeille(plat);
    const gestionnaire = courant.role === 'gestionnaire' && !jete;
    const nomsProfils = new Map((courant.profils ?? []).map((p) => [p.id, p.nom]));
    // Versions par profil qui a des règles ; les autres versions (profil sans règle, ou inconnu) restent à part. Plat
    // de la corbeille : toutes ses versions dans la simple liste « Versions », sans rien à demander.
    const etats = jete ? [] : etatsCompat(plat, courant);
    const versionsMontrees = new Set(etats.filter((e) => e.cas !== 'aCreer').map((e) => e.profil.id));
    // Demandes (T2e), une fois chargées : celle de chaque version à créer ou à revoir, et celle de la recette (⏳).
    const situations = situationsDemande(plat, etats);
    const situationRecette = courant.demandesChargees && !jete && statut === 'attente'
      ? etatDemande(plat, null, optionsDemande())
      : null;
    // Première version qui manque (celle d'un profil qui l'a demandée d'abord) : le bouton unique « Demander à Claude »
    // la demande (demandeDuPlat).
    const versionManquante = gestionnaire && statut !== 'attente' ? versionAttendue(etats, profilsDemandeurs(situations)) : null;
    const horsLigne = !navigator.onLine;
    const auteurs = { profils: courant.profils ?? [], moi: courant.utilisateur?.email ?? courant.moi };

    /**
     * Sous une version à créer ou à revoir : vue « Repas et courses », le bouton « 📬 Demander ma version » ou la
     * phrase « 📬 Demandée… » (bloc gardé) ; gestionnaire, la ligne « 📬 Demandée par … » d'une demande ouverte.
     */
    const demandeDeVersion = (etat) => {
      const situation = situations.get(etat.profil.id);
      if (!situation) return null;
      if (gestionnaire) return situation.ouverte ? ligneDemandee(situation.ouverte, auteurs) : null;
      const bloc = blocDemande(`profil:${etat.profil.id}`);
      if (situation.ouverte) {
        ecrireBloc(bloc, { phrase: phraseDemandee(situation.ouverte, { pourVersion: true, horsLigne }) });
      } else {
        const vous = estVous(etat.profil, { moi: courant.moi, role: courant.role });
        ecrireBloc(bloc, { libelle: vous ? 'Demander ma version' : `Demander une version pour ${nomDe(etat.profil)}` });
      }
      return bloc.noeud;
    };

    /**
     * Carte ⏳ « Recette à ajouter » : le gestionnaire la demande à Claude (avec « 📬 Demandée par … » si elle a été
     * demandée) ; dans la vue « Repas et courses », « 📬 Demandée… » ou « 📬 Demander la recette ».
     */
    const carteRecetteAAjouter = () => {
      let textes;
      let bouton = null;
      if (gestionnaire) {
        textes = [
          el('p', {}, 'Demandez-la à votre projet Claude, puis collez sa réponse ici.'),
          situationRecette?.ouverte ? ligneDemandee(situationRecette.ouverte, auteurs) : null,
        ];
      } else if (situationRecette?.ouverte) {
        const bloc = blocDemande(CLE_RECETTE);
        ecrireBloc(bloc, { phrase: phraseDemandee(situationRecette.ouverte, { pourVersion: false, horsLigne }) });
        textes = [bloc.phrase];
      } else if (situationRecette?.possible) {
        const bloc = blocDemande(CLE_RECETTE);
        ecrireBloc(bloc, { libelle: 'Demander la recette' });
        textes = [el('p', {}, 'Vous pouvez la demander, ou l’écrire vous-même.')];
        bouton = bloc.bouton;
      } else {
        // Demandes encore en chargement, ou rien à demander.
        textes = [el('p', {}, 'Vous pouvez l’écrire vous-même.')];
      }
      return el('section', { class: 'carte' },
        el('div', { class: 'carte-ligne' },
          pastille('⏳', 'ocre'),
          el('div', { class: 'carte-texte' }, el('h2', {}, 'Recette à ajouter'), ...textes)),
        gestionnaire ? actionsRecette : bouton);
    };
    const ingredients = plat.ingredients ?? [];
    const cuissons = plat.cuisson ?? [];
    const variantes = (plat.variantes ?? []).filter((v) => !versionsMontrees.has(v?.pour));
    const frigo = plat.conservation?.frigoJours;
    const congelable = plat.conservation?.congelable;
    const conservation = [
      typeof frigo === 'number' ? `${accord(frigo, 'jour', 'jours')} au frigo` : null,
      congelable === true ? 'se congèle' : congelable === false ? 'ne se congèle pas' : null,
    ].filter(Boolean).join(' · ');

    // Mise à jour des notes d'abord : si ses lignes sont reconstruites, l'élément qui reprend le focus est le nouveau.
    if (!jete) notes.maj(courant);
    // Boutons gardés d'un rendu à l'autre : celui qui avait le focus le retrouve après la mise à jour.
    const blocs = [...blocsDemande.values()];
    const focusGarde = [actionsRecette, blocSemaine, lienModifier, carteReprise, notes.noeud, carteJete, boutonCorbeille, carteSansPreneur.noeud, carteEtapes,
      ...blocs.flatMap((bloc) => [bloc.bouton, bloc.phrase])]
      .some((n) => n.contains(document.activeElement))
      ? document.activeElement
      : null;
    texteJete.textContent = jete
      ? `${texteCorbeille(plat, { profils: courant.profils ?? [], moi: courant.utilisateur?.email ?? courant.moi })}.`
      : '';
    // Personne n'en veut (tous les profils l'ont noté « Jamais ») : la corbeille est suggérée, jamais automatique.
    const sansPreneur = !jete && platsSansPreneur([plat], courant.profils ?? []).length > 0;
    if (sansPreneur) carteSansPreneur.maj(courant.profils ?? []);
    // Lien « Modifier › » de l'ingrédient douteux : reconstruit à chaque rendu, son remplaçant reprend le focus.
    const focusDouteux = Boolean(document.activeElement?.closest?.('.compat-douteux'));
    // Lien « Ses précautions › » d'une section « 🧸 Pour <Enfant> » : de même, retrouvé par son repère.
    const repereFocus = contenu.contains(document.activeElement) ? document.activeElement.dataset?.repere ?? null : null;
    const brouillon = lireBrouillon(courant.utilisateur?.uid, id);
    // « Demander à Claude » en bas, dans « Nouvelle version » : secondaire. La fiche a déjà un bouton principal avec
    // « Reprendre », sous une version manquante ou sur un plat ⏳ (gestionnaire) : « ＋ Ajouter à la semaine » est
    // alors secondaire.
    actionsEnBas = gestionnaire && statut !== 'attente' && !versionManquante;
    autrePrincipal = Boolean(brouillon) || (gestionnaire && (statut === 'attente' || Boolean(versionManquante)));
    majActionsRecette();
    lienModifier.replaceChildren(
      el('span', { 'aria-hidden': 'true' }, '✏️'),
      statut === 'attente' ? 'Écrire la recette moi-même' : 'Modifier la recette',
    );
    // Étapes détaillées (T5-0b) : la carte du gestionnaire, pour une recette pas (ou plus) détaillée.
    const etatEtapes = etatRealisation(plat);
    const avecCarteEtapes = gestionnaire && (etatEtapes === 'courte' || etatEtapes === 'perimee');
    if (avecCarteEtapes) {
      const phrase = etatEtapes === 'perimee' ? TEXTES_ETAPES.perimee : TEXTES_ETAPES.ficheCourte;
      if (texteEtapesCourtes.textContent !== phrase) texteEtapesCourtes.textContent = phrase;
    }
    // replaceChildren écrirait « null » : les blocs absents sont retirés.
    contenu.replaceChildren(...[
      el('header', { class: 'vue-entete' },
        el('h1', {}, plat.nom),
        el('p', { class: 'badges' },
          el('span', { class: 'badge' }, LIBELLES_TYPE[typeDe(plat)] ?? 'Plat'),
          el('span', { class: `badge badge-${statut}` }, `${STATUTS[statut].emoji}\u00A0${STATUTS[statut].libelle}`),
          modeDeCuisson(plat, { duree: true, classe: 'badge badge-cuisson' }),
          typeof plat.portionsBase === 'number'
            ? el('span', { class: 'badge' }, accord(plat.portionsBase, 'portion', 'portions'))
            : null,
        ),
      ),

      // Ni sur un plat de la corbeille, ni sur un apéro (T3e) ou une préparation de chaque semaine (T3d).
      jete || !peutAllerDansLaSemaine(plat) ? null : blocSemaine,

      jete ? carteJete : brouillon ? carteReprise : lienModifier,

      // Version qui manque (gestionnaire) : « Demander à Claude » se place sous la première, et demande sa version.
      // Avant lui, la demande de la version (« 📬 Demander ma version », « 📬 Demandée… »).
      ...etats.map((etat) => sectionVersion(etat, plat, { moi: courant.moi, role: courant.role },
        [demandeDeVersion(etat), etat === versionManquante ? actionsRecette : null])),

      // « 🧸 Pour <Enfant> » : précautions selon l'âge, après les versions ; gardée sur un plat de la corbeille, à titre
      // d'information (le lien mène à l'écran de l'enfant, rien ne change sur le plat).
      ...profilsAgeDe(courant).map((profil) => sectionAge(profil, precautionsDe(plat, profil, courant), { role: courant.role })),

      // Ingrédient dont le nom annonce un repère qu'une règle surveille (« jambon cru » sans le repère cru) : gestionnaire.
      gestionnaire && statut !== 'attente' ? carteDouteux(plat, courant.surveilles ?? marqueursSurveilles(courant.profils)) : null,

      statut === 'attente' && !jete ? carteRecetteAAjouter() : null,

      // Absente tant qu'aucun profil n'existe ; aussi pour un plat ⏳ (le nom suffit pour donner un avis).
      (courant.profils ?? []).length && !jete ? notes.noeud : null,

      ingredients.length
        ? section('Ingrédients', el('ul', { class: 'liste-ingredients' }, ingredients.map((ingredient) => el('li', {},
          el('span', { class: 'quantite' }, quantiteLisible(ingredient.qte, ingredient.unite)),
          el('span', {}, ingredient.produit ?? ''),
        ))))
        : null,

      sectionEtapes(plat, avecCarteEtapes ? carteEtapes : null),

      cuissons.length
        ? section('Cuisson', el('ul', { class: 'liste-simple' }, cuissons.map((c) => el('li', {}, cuissonLisible(c)))))
        : null,

      variantes.length
        ? section(etats.length ? 'Autres versions' : 'Versions', el('ul', { class: 'liste-simple' }, variantes.map((v) => el('li', {}, el('span', {},
          el('strong', {}, nomsProfils.get(v.pour) ?? 'Autre profil'),
          styleEcrit(v) ? `, version ${LIBELLES_STYLE[styleEcrit(v)]}` : '',
          v.consigne ? `\u00A0: ${v.consigne}` : '',
        )))))
        : null,

      (conservation || typeof plat.tempsActifMin === 'number' || typeof plat.emporter === 'boolean' || plat.source)
        ? section('Bon à savoir', el('dl', { class: 'infos' },
          ligneInfo('Préparation', typeof plat.tempsActifMin === 'number' ? `${plat.tempsActifMin}\u00A0min de travail` : ''),
          ligneInfo('Conservation', conservation),
          ligneInfo('Boîte à emporter', plat.emporter === false ? 'Supporte mal la boîte' : plat.emporter === true ? 'Se réchauffe bien' : ''),
          ligneInfo('Source', plat.source ? String(plat.source) : ''),
        ))
        : null,

      gestionnaire && statut !== 'attente' && !versionManquante
        ? section('Nouvelle version', el('p', { class: 'texte-doux' },
          'Pour une recette entièrement refaite, demandez une nouvelle version à votre projet Claude. Elle remplacera vos modifications.'),
        actionsRecette)
        : null,

      // Tout en bas, pour les deux membres : la suggestion « Personne n'en veut », sinon un simple bouton discret.
      sansPreneur ? carteSansPreneur.noeud : null,
      !jete && !sansPreneur ? boutonCorbeille : null,
    ].filter(Boolean));
    // Un bloc de demande montre le bouton ou la phrase : si l'un a laissé sa place à l'autre (demande faite, annulée,
    // ou close ailleurs), le focus passe à l'autre.
    const visible = (noeud) => noeud.isConnected && !noeud.hidden;
    const blocFocus = focusGarde ? blocs.find((bloc) => bloc.bouton === focusGarde || bloc.phrase === focusGarde) : null;
    if (focusGarde && visible(focusGarde)) {
      if (document.activeElement !== focusGarde) focusGarde.focus({ preventScroll: true });
    } else if (blocFocus) {
      const autre = focusGarde === blocFocus.bouton ? blocFocus.phrase : blocFocus.bouton;
      if (visible(autre)) autre.focus({ preventScroll: true });
    } else if (focusGarde === boutonCorbeille || focusGarde === carteSansPreneur.bouton) {
      // La carte « Personne n'en veut » a remplacé le bouton discret (ou l'inverse) : le focus passe à l'autre.
      const autre = focusGarde === boutonCorbeille ? carteSansPreneur.bouton : boutonCorbeille;
      if (autre.isConnected) autre.focus({ preventScroll: true });
    } else if (focusDouteux) contenu.querySelector('.compat-douteux a')?.focus({ preventScroll: true });
    else if (repereFocus) contenu.querySelector(`[data-repere="${CSS.escape(repereFocus)}"]`)?.focus({ preventScroll: true });
  }

  function toutDessiner() {
    dessinerPhoto();
    majBoutonsPhoto();
    dessiner();
  }

  toutDessiner();
  fichesOuvertes.add(majBoutonsPhoto);

  // Venue de l'écran Demandes (gestionnaire) : le lien retour y ramène ; sinon, à la liste des plats.
  const origine = ctx.routePrecedente === 'demandes' && ctx.role === 'gestionnaire' ? 'demandes' : 'plats';
  const retour = el('a', {
    class: 'retour',
    href: `#/${origine}`,
    onclick: (evenement) => {
      // Venu de cet écran-là : on y revient dans l'historique, pour que le geste retour d'Android reste naturel.
      if (courant.routePrecedente === origine && history.length > 1) {
        evenement.preventDefault();
        history.back();
      }
    },
  }, el('span', { 'aria-hidden': 'true' }, '‹'), origine === 'demandes' ? 'Demandes' : 'Plats');

  return {
    noeud: el('div', { class: 'vue fiche' }, retour, figure, actionsPhoto, contenu),
    maj(nouveau) {
      courant = nouveau;
      // Plat mis à la corbeille : la fiche s'en va vers la liste, elle ne se redessine plus d'ici là.
      if (depart) return;
      toutDessiner();
      majPlatsDeLaSemaine(nouveau);
    },
    detruire() {
      arreterPhoto();
      clearTimeout(minuteurRetrait);
      fichesOuvertes.delete(majBoutonsPhoto);
    },
  };
}
