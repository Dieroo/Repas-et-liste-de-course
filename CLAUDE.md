# Repas & Courses — contexte projet

> Lu par Claude Code à chaque session. Mettre à jour **§14 Statut** à la fin de chaque tranche.
> Méthode : une tranche verticale à la fois, testable sur téléphone ; attendre le retour du propriétaire avant la suivante.

## 1. Objectif

Web-app familiale installable (PWA), partagée en temps réel entre deux téléphones, qui :

1. propose les repas de la semaine et l'apéro du week-end selon les règles de chaque profil, les notes et la récurrence des plats ;
2. propose les variantes utiles (sans viande, avec viande ou poisson…) et signale celles dont la recette manque ;
3. génère et tient à jour la liste de courses, pensée pour la commande au drive comme pour le magasin (hors ligne) ;
4. prépare le batch cooking du dimanche et gère le stock du congélateur.

**Critère de réussite n°1 : la personne qui fait les courses l'adopte, alors qu'elle n'est pas convaincue par ce genre d'outil.** Simplicité, clarté et beauté passent avant le nombre de fonctionnalités. Chaque écran a une action principale évidente.

**Maîtres mots du propriétaire** (à appliquer à chaque écran) :
- une vraie application, belle ;
- très simple et intuitive ;
- tout est ajustable et modifiable ;
- une base de données qui s'enrichit à l'usage : chaque recette, ingrédient ou réglage saisi resservira ensuite (suggestions, valeurs préremplies) au lieu d'être redemandé.

## 2. Contexte d'usage

- 2 adultes, Android + Chrome, comptes Google. 3 profils : les 2 adultes et 1 jeune enfant (noté par ses parents).
- Deux rôles, déduits de l'adresse e-mail connectée (`reglages/foyer.gestionnaire`) :
  - le **gestionnaire** (« Recettes et réglages ») : ajoute les recettes (import, « Demander à Claude », « Coller la recette »), traite les demandes, règle l'app ; peut aussi tout ce que fait l'autre membre ;
  - l'**utilisatrice des courses** (« Repas et courses ») : planifie la semaine (choix des plats, « Proposer », variantes, apéro, validation), fait les courses, ajoute des plats par leur nom, prend ou choisit les photos des plats, note les plats, modifie les recettes (nom, type, ingrédients, quantités, unités, étapes, portions, cuisson principale, conservation, « Recette vérifiée »).
- Les deux peuvent organiser la semaine ; c'est surtout l'utilisatrice des courses qui le fait.
- La personne connectée est reconnue par l'adresse de son profil (`profils/{id}.email`). Sinon, « Qui êtes-vous ? » propose les prénoms des adultes (« C'est moi : <Prénom> », jamais de choix automatique) : seule écriture de profil permise aux deux rôles, limitée à sa propre adresse (transaction). « Ce n'est pas moi », dans le panneau du profil, défait ce choix. L'assistant d'accueil (T6) reprendra ce mécanisme.
- Courses le samedi, commandées au **drive** depuis l'application de l'enseigne (pas d'API disponible) ; parfois en magasin. Batch cooking le dimanche par défaut ; un autre jour possible (« Commencer le batch », §9).
- Apéro chaque week-end, avec des incontournables récurrents (boisson).
- Un plat tient ~3 jours au frigo (réglable par fiche) : la fin de semaine est couverte par le congélateur, alimenté par les surplus du batch.
- Un profil mange surtout à emporter (boîte réchauffée au travail).
- **Dépôt public : aucune donnée personnelle ici.** Prénoms, profils, règles, listes, adresses e-mail, sujet de notification et catalogue du foyer vivent uniquement dans Firestore ou la console Firebase. Fixtures de test génériques.

## 3. Stack (validée)

| Sujet | Choix | Raison |
|---|---|---|
| UI | HTML/CSS/JS vanilla, modules ES, **zéro build** | Rien à maintenir ; déployer = pousser sur `main` |
| Hébergement | GitHub Pages (`main`, racine) | Gratuit, HTTPS |
| Données | Cloud Firestore + `persistentLocalCache` (`persistentMultipleTabManager`) | Temps réel entre les deux téléphones, fonctionne hors ligne |
| Auth | Firebase Auth, fournisseur Google (`signInWithPopup` ; `initializeAuth` sans résolveur au démarrage) | Comptes existants ; la redirection ne fonctionne pas sur github.io (stockage tiers partitionné) |
| SDK | Firebase JS modulaire depuis le CDN officiel gstatic, version épinglée | Pas de bundler |
| PWA | `manifest.webmanifest` + `sw.js` (cache de l'enveloppe applicative, du SDK et des polices) | Icône sur l'écran d'accueil, ouverture hors ligne |
| Notification | ntfy (`https://ntfy.sh/<sujet>`), facultatif | Gratuit, sans serveur ; le gestionnaire installe l'app ntfy |
| Tests | `node --test` sur `js/coeur/` | Logique métier testée hors navigateur |

- Chemins **relatifs** partout : le site est servi sous `/<dépôt>/`.
- Navigation par hash (`#/semaine`, `#/courses`, …).
- Dépendances externes : SDK Firebase et une police Google Fonts. Rien d'autre.

## 4. Expérience et direction visuelle

**Navigation**
- Barre d'onglets en bas : **Semaine · Courses · Plats · Découvrir**. Batch, Congélateur, Demandes et Réglages s'ouvrent depuis Semaine ou l'icône de profil.
- Accueil « Semaine » : en tête, le repas de chacun ce soir, puis une carte « prochaine action » qui suit le calendrier (samedi : « Courses : 32 articles » ; dimanche : « Batch : 4 plats »).
- Vue de l'utilisatrice des courses : ni import, ni réglages, ni « Demander à Claude », ni Demandes. Elle planifie la semaine : Semaine et Plats doivent rester aussi simples que Courses.

**Ton**
- Phrases courtes et chaleureuses. Jamais affichés : « paquet », « slug », « JSON », « IA ». L'import s'appelle « Ajouter des recettes ».
- États vides utiles (« Aucun plat noté : découvrez-en 10 en une minute »).

**Direction « cuisine familiale »** (contrastes AA vérifiés)

| Token | Clair | Sombre |
|---|---|---|
| `--fond` | `#FBF7F1` | `#1C1917` |
| `--surface` | `#FFFFFF` | `#26221F` |
| `--texte` | `#2B2622` | `#F3EDE5` |
| `--accent` (terracotta) | `#B4492F`, texte blanc dessus | `#E07A5C`, texte `#1C1917` dessus |
| `--olive` | `#4F6E4A` | `#8FB089` |
| `--bordure` | `#E9E1D6` | `#3A332E` |

- Titres : « Fraunces » (Google Fonts, mise en cache par le service worker) ; texte : police système.
- Cartes arrondies (16 px), ombres douces, espacements généreux, cibles ≥ 48 px.
- Visuel des plats : grand emoji sur pastille teintée selon la catégorie (🍲 mijoté, 🐟 poisson, 🥧 gratin ou tarte, 🍝 pâtes, 🍰 dessert, 🥂 apéro). Une photo prise ou choisie sur le téléphone remplace l'emoji quand elle existe (§6 `photos`). **Aucune image récupérée sur le web.**
- Mode de cuisson principal : pictogramme au trait de l'appareil de l'étape de cuisson la plus longue (la première en cas d'égalité ; `cuissonPrincipale`), toujours suivi de son nom (« Four » ; « Cookeo · 45 min » sur la fiche). Rien si le plat n'a pas de cuisson. Partout où un plat apparaît : liste des plats et fiche (T1c), Découvrir (T1d), grille de la semaine (T3), plats proposés par « Proposer » (T4), Batch (T5). Dessins propres à l'app (`ui/pictos.js`), jamais de logo de marque.
- Animations brèves et utiles (case cochée, carte qui glisse) ; vibration légère quand on coche (`navigator.vibrate`).

**Écran Découvrir** (premier contact, ludique)
- Une carte à la fois : chaque plat que le profil choisi n'a pas encore noté (pictogramme de cuisson et premiers ingrédients sur la carte). File par profil : ordre par type (plat, dessert, apéro, accompagnement), plats ⏳ inclus en fin de chaque type, préparations exclues ; ordre mélangé, stable dans la journée ; un plat nouveau ou dont la note est effacée revient à la fin.
- Trois gestes, boutons dans une barre fixée au-dessus des onglets (pas de glisser) : 👎 « Jamais » (note 0) · 👍 « Pourquoi pas » (3) · ❤️ « J'adore » (5). La carte part vers le bouton touché, le téléphone vibre. Étoiles fines ensuite sur la fiche.
- « ↶ Annuler » à plusieurs niveaux, seulement si la note n'a pas changé ailleurs entre-temps.
- « Je note pour » : soi et l'enfant sans adresse (ruban « Pour <Enfant> » sur la carte) ; chaque ouverture repart sur soi.
- États vides : aucun profil, personne non reconnue, aucun plat, tout noté ; fin de file « Tout est trié 🎉 » avec le bilan et les plats notés pendant la visite.

## 5. Arborescence

```
index.html
manifest.webmanifest
sw.js                     liste de précache à tenir à jour (vérifiée par tests/hors-ligne.test.js) ; `PUBLIEE` (date de mise en ligne, à changer à chaque publication) et `VERSION`, affichées en bas du panneau du profil
.nojekyll                 GitHub Pages sert les fichiers tels quels
icons/
css/app.css               tokens du §4, composants
js/
  app.js                  démarrage, routeur par hash, vue selon le rôle
  firebase.js             config, auth, Firestore + cache hors ligne
  donnees.js              abonnements onSnapshot → état central ; écritures
  notifications.js        envoi ntfy
  ui/                     un module par écran (semaine, courses, plats, fiche, decouvrir, batch, congelateur, demandes, reglages, import)
                          + dom.js (outils DOM), connexion.js (écrans avant l'app), profil.js (avatar, panneau du profil),
                          feuille.js (feuilles du bas), photo.js (choix et compression), presse-papiers.js (copier, coller),
                          pictos.js (pictogrammes des appareils de cuisson), modifier.js (écran « Modifier la recette »),
                          brouillon.js (modification en cours gardée sur le téléphone), notes.js (section Notes de la fiche),
                          relier.js (« Qui êtes-vous ? »), fichier.js (choisir, lire, télécharger un fichier),
                          restaurer.js (écran « Restaurer une sauvegarde »), regime.js (« Ce que <Prénom> mange »),
                          compat.js (lignes 🌿 / ❌ d'un plat pour chaque profil qui a des règles),
                          envoyes.js (plats déjà envoyés à Claude, gardés sur le téléphone quelques jours ; version des
                          instructions du projet Claude copiée en dernier sur ce téléphone, gardée à la déconnexion) ;
                          semaine.js porte aussi la carte « Idées de plats » du gestionnaire (feuille qui copie DEMANDE-IDEES)
  coeur/                  logique pure : ni DOM ni Firebase
    roles.js              rôle de la personne connectée, écrans permis
    slug.js               identifiants et recherche sans accents
    plats.js              visuel, filtres, ajout par nom, affichage des quantités
    profils.js            validation et ordre des profils
    photo.js              dimensions et taille des photos
    vocabulaire.js        vocabulaires fermés de paquet@1, styles des versions (mer, végétale), sous-types de viande,
                          implications de marqueurs
    compatibilite.js      évaluation d'un plat pour un profil (règles, versions de la fiche et leur style), comptes,
                          plats à créer ou à compléter, mots douteux
    regles.js             régimes (« Mange de tout », « Pas de viande », « Ni viande ni poisson »), précisions, styles de
                          versions attendus, textes pour Claude
    liste.js
    proposition.js
    batch.js
    congelateur.js
    paquet.js             format d'import : extraction (dont les phrases de refus de Claude), validation, plat visé,
                          version des instructions d'une réponse (`controlerInstructions`), idée de Claude déjà dans les
                          plats (statut `deja`)
    edition.js            « Modifier » : libellés, natures, catalogue des produits connus, saisie d'un ingrédient, écritures
    notes.js              notes 0–5 (lecture, libellés, chemin d'écriture), file de Découvrir, résumé des notes
    claude.js             textes copiés pour Claude : DEMANDE-RECETTE (avec `versions:`), DEMANDE-VARIANTES, DEMANDE-IDEES,
                          CORRECTION, chacun avec la ligne `instructions: <n>` ; `VERSION_INSTRUCTIONS` et
                          `EMPREINTE_INSTRUCTIONS`
    import-local.js       effet local d'un import (fiches à jour avant la réponse du serveur), annonces des versions
    sauvegarde.js         fichier de sauvegarde (création, lecture, validation), restauration additive, revue à l'envoi
    corbeille.js          corbeille des plats : plats actifs et mis de côté (le plus récent d'abord), plats dont personne
                          ne veut, demandes à clore quand on vide, texte « Mis à la corbeille le … par … »
docs/projet-claude.md     instructions du Projet Claude (format, versions), copiées depuis Réglages ; précachée ;
                          seule source du format et des demandes, en version `VERSION_INSTRUCTIONS` (§12)
tests/                    node:test, fixtures génériques
.gitignore                repas-courses-*.json : une sauvegarde (adresses des profils) n'est jamais publiée
firestore.rules           adresses en espaces réservés (<EMAIL_1>, <EMAIL_2>)
package.json              uniquement "type": "module" et le script de test
```

## 6. Modèle de données (Firestore, un seul foyer)

| Chemin | Contenu |
|---|---|
| `reglages/foyer` | `versionSchema: 1`, `gestionnaire` (e-mail), `debutSemaine`, `nbPlats {min, max}`, `dessertParSemaine` (0 ou 1), `frigoJoursDefaut` (3), `dureeBatchMaxMin`, `rayons[]` (ordre du parcours en magasin), `appareils[]`, `apero {actif, jour, nbSuggestions, incontournables[]}`, `drive {nom, urlRecherche}` (modèle contenant `{q}`), `notifications {ntfySujet}`, `derniereSauvegarde` (date du téléphone, écrite seulement si plats et profils viennent du serveur), `instructionsCopiees` (dernière version des instructions du projet Claude copiée par le gestionnaire, sur n'importe lequel de ses appareils ; éteint le rappel 🔔 partout) |
| `profils/{id}` | `nom`, `email` (facultatif, sert à reconnaître la personne connectée ; posé par « C'est moi » et effacé par « Ce n'est pas moi », en transaction), `ordre`, `repas {midis: [jours], soirs: [jours]}`, `coefPortion` (1 adulte, 0,5 enfant), `regles[]` (§7 ; absent = jamais réglé, `[]` = « Mange de tout » choisi exprès ; la règle de l'écran « Ce que <Prénom> mange » porte `id: 'regime'`, les autres sont gardées telles quelles ; écrit par `update` de la liste entière) |
| `plats/{id}` | fiche `paquet@1` (§8 ; `variantes[]` : une version par profil et par style, avec `style` (`mer` · `vegetal`) et `frigoJours` facultatifs ; une version sans `style` reçoit un style déduit à la lecture, jamais écrit pour cela) + `notes {profilId: 0–5}` (0 = « jamais » : plus jamais proposé à ce profil ; écrite par le chemin `notes.<profilId>` en `update`, `deleteField` pour effacer, sans `majPar` ni `majLe`, jamais par l'import ni par « Modifier » ; absente = non notée, compte 3 pour le score (`noteRetenue`) mais reste distincte de 3 pour l'équilibre des propositions (`estNote`) ; aucune note n'est écrite par défaut ; les notes d'un profil retiré restent dans la fiche et dans la sauvegarde, ignorées ailleurs), `derniereFois`, `vignette` (petite image ~10 Ko pour les listes et Découvrir, facultative), `majPar`, `majLe`, `modifieeLe` et `modifieePar` (posés par « Modifier », effacés quand une recette de Claude remplace ou complète la fiche), `corbeille {le, par}` (plat mis à la corbeille : horodatage du serveur et adresse de la personne ; absente = plat actif ; posée par `update` sans `majPar` ni `majLe`, effacée par `deleteField` (« Remettre »), jamais écrite par l'import ni par « Modifier » ; un plat de la corbeille disparaît de tous les écrans sauf la corbeille et sa fiche, mais compte pour l'ajout par nom, l'ajout de recettes et « déjà dans l'app » ; « Vider la corbeille » supprime `plats/{id}` et `photos/{id}` et clôt ses demandes ouvertes, par transactions qui relisent chaque plat : un plat remis entre-temps reste). « Modifier » écrit par `update` les seuls champs touchés : portions et ingrédients toujours ensemble, `conservation` sous-champ par sous-champ |
| `photos/{platId}` | `image` (JPEG compressé dans le navigateur, 1024 px max, ~200 Ko max), `majPar`, `majLe` ; lu seulement à l'ouverture de la fiche, pour que la liste des plats reste légère |
| `produits/{id}` | `nom`, `rayon`, `uniteDefaut`, `marqueurs[]`, `habituel {actif, qte, unite}`, `rechercheDrive` (terme de recherche personnalisé, facultatif), `placard {actif, seuil, unite}` (§9 ; `seuil` vide = toujours proposé), `achats[]` (dates, V2) |
| `semaines/{dimancheISO}` | `statut` (`brouillon` → `validee` → `courses_faites` → `batch_fait`), `plats [{platId, adultes, enfants, repas, portionsACuire, portionsACongeler}]` (`portionsACuire` = (`adultes` + `enfants` × `coefPortion` enfant, soit 0,5) × `repas`), `affectations {profilId: {"lun-soir": {platId, variante} ou {congelId}}}`, `apero {jour, platIds[]}`, `majPar`, `majLe` |
| `semaines/{dimancheISO}/lignes/{cle}` | `produitId`, `libelle`, `qte`, `unite`, `rayon`, `sources [{type: plat, apero, habituel ou manuel, ref, pour}]`, `special` (vrai si lié aux plats ou à l'apéro de la semaine), `coche`, `manuel` |
| `congelateur/{id}` | `platId`, `nom`, `portions`, `dateCongelation` |
| `demandes/{id}` | `type` (`variante` ou `recette`), `platId`, `profilId` et `besoin` (`sans_viande` ou `avec_proteine`, variantes seulement), `creePar`, `creeLe`, `statut` (`ouverte` ou `traitee`), `traiteeLe` |

- Jours : `dim` `lun` `mar` `mer` `jeu` `ven` `sam` ; moments : `midi` `soir`.
- Identifiants : `plats` et `produits` = slug du nom (`carbonade-flamande`), stables. `demandes` : `platId__profilId` pour une variante (une seule demande ouverte par plat et profil), `platId__recette` pour une recette à ajouter.
- **Une ligne de liste = un document** : deux personnes peuvent cocher en même temps sans conflit. `cle` = `produitId__unite` pour les lignes générées, aléatoire pour les manuelles.
- `appareils[]` par défaut : `plaque` ×4 · `four` ×1 (2 plats simultanés si même température) · `cookeo` ×1 · `airfryer` ×1 · `monsieur_cuisine` (inactif).

Règles Firestore (version réelle collée dans la console, jamais commitée avec les vraies adresses) :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Adresses en minuscules : la comparaison tient compte de la casse.
    function membre() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email in ['<EMAIL_1>', '<EMAIL_2>'];
    }
    match /{document=**} {
      allow read, write: if membre();
    }
  }
}
```

## 7. Compatibilité et variantes (`coeur/compatibilite.js`)

`evaluer(plat, profil) → { niveau: 'ok' | 'adaptable' | 'exclu', variante: null | {source, retirer[], ajouter[], consigne}, raisons: [], consignes: [] }` — fonction pure.

| Type de règle | Paramètres | Déclenchée quand |
|---|---|---|
| `exclureProduits` | `produits[]` | un ingrédient est dans la liste |
| `exclureMarqueurs` | `marqueurs[]` | un ingrédient porte un de ces marqueurs |
| `formeViande` | `autorisees[]` (ex. `hachee`, `fine`) | une viande a une autre forme |
| `legumePrincipal` | — | un légume a `role: principal` |
| `proteineChaqueRepas` | — | le plat n'a ni viande ni poisson |
| `aEmporter` | — | le plat a `emporter: false` |
| `substitution` | `si {produits[], marqueurs[]}`, `par[]` (ingrédients avec `qtePortion`), `alternatives[]`, `consigne`, `sauf[]` (ids de plats) | sert à résoudre une exclusion, voir ci-dessous |

- Chaque règle porte une `severite` : `exclu` (❌) · `adaptable` (⚠️, avec `consigne`) · `preference` (n'agit que sur le score). `substitution` n'a pas de sévérité.
- Les noms de produits se comparent par slug (casse, accents et tirets ignorés). Les sous-types `boeuf`, `porc`, `volaille`, `agneau`, `charcuterie` impliquent `viande`.
- Niveau final = le pire des règles déclenchées. Toute modification de règle recalcule les badges partout.
- Les règles `preference` ne s'appliquent ni aux desserts ni à l'apéro.
- `exclureMarqueurs` accepte `saufMarqueurs[]` (ex. « pas de viande, mais la charcuterie oui »). Implications de marqueurs (`gelatine_porc` → `gelatine_animale`, sous-types → `viande`) appliquées à l'évaluation, jamais écrites. En T2, `evaluer` n'applique que `exclureMarqueurs` et `exclureProduits` ; les autres types sont gardés et arrivent avec l'écran qui les montre (substitution en T3, préférences en T4). `besoin` d'une version : `sans_viande` ou `adapter`.
- Affichage (`ui/compat.js`) : « 🌿 Version pour <Prénom> » ou « ❌ Version pour <Prénom> à créer / à revoir » (gestionnaire) ; dans la vue « Repas et courses », jamais de croix : « 🌿 Votre version » ou « Pas encore de version pour vous ». Découvrir ne montre pas à un profil les plats qu'il ne peut pas manger tant que leur version n'existe pas.
- **Plusieurs versions par profil, une par style** : `stylesAttendus(profil, plat?)` (`coeur/regles.js`) les déduit du régime : « Pas de viande » (mange du poisson) → `mer` et `vegetal` ; « Ni viande ni poisson » → `vegetal` ; autre régime ou règles → aucun (une seule version, sans style, comme avant). La version `mer` remplace une viande : un dessert ou un accompagnement (`TYPES_SANS_MER`), ou un plat dont la recette n'a aucune viande (exclu seulement par un bouillon, une gélatine ou une graisse), n'attend jamais de version `mer` ; un plat ⏳ garde les deux styles. `styleDe(variante)` (`coeur/compatibilite.js`) : `style` écrit, sinon déduit à la lecture (un ajout marqué `poisson` ou `fruits_de_mer`, marqueurs effectifs → `mer`, sinon `vegetal`), jamais écrit dans Firestore pour cela. « Végétale » = végétarienne : ni viande, ni poisson, ni fruits de mer ; œufs et fromage permis.
- `evaluer` juge chaque version seule (`versions [{variante, style, convient, restants}]`) : une qui convient rend le plat `adaptable` (`variante` = la `mer` si elle convient, sinon la première qui convient, avec `style` et `frigoJours`) ; aucune → `aRevoir` (restants et besoin de la première version d'un style attendu, sinon de la première) ; `manquants` = styles attendus pour ce plat sans version qui convient (`[]` si le plat se mange tel quel) ; `aCompleter` = une version convient mais il en manque une. Un plat à compléter compte dans `avecVersion` (et `bilanCompatibilite().aCompleter`), reste dans Découvrir, et passe après les plats à créer ou à revoir dans `platsSansVersion` (lot pour Claude) ; le filtre « ❌ Versions à créer » l'inclut, trié par nom. Une version d'un style que le profil n'attend pas (mer d'avant « Ni viande ni poisson », mer d'un dessert) : montrée à Claude, si elle est à revoir, comme la version actuelle d'un style qui manque ; sur la fiche, « Plus utilisée : … » (sans croix) quand une autre version convient ; la prochaine version reçue pour ce profil la remplace (`fusionnerVariantes`, `attendus`). Libellés : « 🌿 Versions pour <Prénom> : mer et végétale », « 🌿 Version mer pour <Prénom> · végétale à demander » (gestionnaire) ; « 🌿 Vos versions : mer et végétale », « 🌿 Votre version : mer » (vue « Repas et courses », jamais « à demander » ni croix). Une version d'avant les styles est nommée par son style déduit.

Exemples de règles (fixtures génériques) :

```json
[
  { "type": "exclureProduits", "produits": ["navet"], "severite": "exclu" },
  { "type": "exclureMarqueurs", "marqueurs": ["viande", "bouillon_viande", "gelatine_porc"], "severite": "exclu" },
  { "type": "formeViande", "autorisees": ["hachee", "fine"], "severite": "adaptable", "consigne": "Couper finement ou effilocher" },
  { "type": "legumePrincipal", "severite": "exclu" },
  { "type": "proteineChaqueRepas", "severite": "preference" },
  { "type": "aEmporter", "severite": "preference" },
  {
    "type": "substitution",
    "si": { "produits": ["lardons"], "marqueurs": ["charcuterie"] },
    "par": [{ "produit": "saumon fumé", "qtePortion": 2, "unite": "tranche", "rayon": "poissonnerie", "marqueurs": ["poisson"] }],
    "alternatives": [{ "produit": "pavé de saumon", "qtePortion": 1, "unite": "pc", "rayon": "poissonnerie", "marqueurs": ["poisson"] }],
    "consigne": "Part au saumon",
    "sauf": []
  }
]
```

**Résolution d'un plat ❌ pour un profil** (dans cet ordre) :
1. version explicite de la fiche pour ce profil (`variantes[].pour`) qui lui convient ; s'il y en a plusieurs, la `mer` d'abord (préférence du foyer ; choix Mer / Végétale au planning en T3) ;
2. règle `substitution` du profil, si elle couvre **tous** les ingrédients fautifs et que le plat n'est pas dans `sauf` : variante automatique, ses ingrédients `par` vont dans la liste pour les portions de ce profil ;
3. sinon **« variante à créer »** : le plat reste sélectionnable pour ce profil ; à l'affectation, une `demande` est créée.

Sens inverse : un plat sans viande ni poisson affecté à un profil qui a `proteineChaqueRepas` → l'app propose sa variante « avec viande ou poisson » si la fiche en a une, sinon crée une `demande` (`besoin: avec_proteine`).

**Demandes et notification**
- Badge « Demandes » sur l'accueil du gestionnaire, mis à jour en temps réel ; écran Demandes avec bouton « Demander à Claude » (texte §8).
- Plat ajouté par son nom (⏳) par l'utilisatrice des courses → `demande` `type: "recette"` ; elle passe `traitee` dès que la fiche reçoit ses ingrédients (import ou « Modifier »).
- Si `notifications.ntfySujet` est défini et que la demande vient d'un autre membre que le gestionnaire : `fetch('https://ntfy.sh/' + sujet, { method: 'POST', body })` avec `body` = `Recette à ajouter : <plat> — version <profil>` (variante) ou `Recette à ajouter : <plat>` (recette). Message minimal, rien d'autre. Échec silencieux (la demande reste visible dans l'app).
- Une demande passe `traitee` dès que la fiche reçoit la variante (import).

## 8. Format d'import `paquet@1`

Un seul format pour le catalogue de départ, l'import unitaire (recette produite par le Projet Claude) et la sauvegarde. Import par collage **ou par fichier `.json`**. Clé principale : `plats`. Une réponse du Projet Claude porte aussi, à la racine, `"instructions": <n>` (version de ses instructions, voir « Alignement avec le Projet Claude » plus bas ; jamais dans une sauvegarde). Clés facultatives, pour la configuration et la sauvegarde complète : `reglages` (objet fusionné dans `reglages/foyer`), `profils` (`id`, `nom`, `email`, `ordre`, `coefPortion`, `repas`, `regles`), `produits`, `congelateur`, `semaines`. Chaque document est créé ou fusionné par `id` (champs absents conservés) ; une mise à jour de plat conserve `notes` et `derniereFois`.

**Sauvegarde** (Réglages › « Télécharger une sauvegarde », gestionnaire ; rappel dans le panneau du profil sans sauvegarde ou au-delà de 30 jours) : fichier `repas-courses-sauvegarde-AAAA-MM-JJ.json` (`FICHIER_MAX` 5 Mo) avec `format`, `sauvegardeLe` (ISO, marque une sauvegarde), `profils` et `plats` triés par `id` (recette, versions avec `style` et `frigoJours`, défauts des ⏳, `notes`, `derniereFois`, `modifieeLe` en ISO, `modifieePar`, `corbeille` avec `le` en ISO et `par`). Jamais : `vignette`, photos, `majPar`, `majLe`, demandes, réglages. **Règle : chaque tranche qui ajoute des données ou des champs les ajoute à la sauvegarde et à la restauration** (garde-fous d'aller-retour dans les tests).

**Restauration** (`#/restaurer`, gestionnaire, en ligne seulement) : ce qui est dans l'app reste ; ce qui manque revient (plats, notes, profils, `derniereFois` plus récente, versions : toutes celles d'un profil qui n'en a aucune sur la fiche, et une version de chaque style attendu qui manque, `stylesAbsents`) ; une note présente n'est jamais remplacée, un profil présent jamais modifié ; un plat absent revient avec sa marque de corbeille (« (dans la corbeille) » dans le résumé), la marque d'un plat présent n'est jamais posée ni effacée (la restauration ne sort jamais un plat de la corbeille) ; les recettes différentes sont listées, reprises en bloc seulement si elles sont cochées (cochées d'avance sur un plat ⏳), après une copie de précaution téléchargée. Aperçu calculé sur les données lues sur le serveur, relues au toucher (empreinte comparée, recette actuelle comprise) ; envoi par transactions qui relisent chaque document et ne gardent que ce qui reste vrai (`appliquerConditions`) : hors ligne, rien ne part plus tard. « Ajouter des recettes » refuse une sauvegarde.

```json
{
  "format": "paquet@1",
  "plats": [
    {
      "id": "gratin-pates-jambon",
      "nom": "Gratin de pâtes au jambon",
      "type": "plat",
      "recurrence": "aucune",
      "statutRecette": "brouillon",
      "portionsBase": 4,
      "ingredients": [
        { "produit": "pâtes courtes", "qte": 400, "unite": "g", "rayon": "epicerie_salee", "marqueurs": ["feculent"] },
        { "produit": "jambon blanc", "qte": 4, "unite": "tranche", "rayon": "charcuterie", "marqueurs": ["viande", "porc", "charcuterie"], "forme": "fine" },
        { "produit": "crème fraîche épaisse", "qte": 20, "unite": "cl", "rayon": "cremerie", "marqueurs": ["laitier"] },
        { "produit": "gruyère râpé", "qte": 100, "unite": "g", "rayon": "fromages", "marqueurs": ["laitier"] },
        { "produit": "oignon jaune", "qte": 1, "unite": "pc", "rayon": "fruits_legumes", "marqueurs": ["legume"], "role": "incorpore" }
      ],
      "etapes": [
        "Cuire les pâtes al dente.",
        "Faire revenir l'oignon émincé, ajouter la crème et le jambon coupé fin.",
        "Mélanger avec les pâtes, couvrir de gruyère, gratiner."
      ],
      "cuisson": [
        { "appareil": "plaque", "dureeMin": 12 },
        { "appareil": "four", "tempC": 200, "dureeMin": 20 }
      ],
      "tempsActifMin": 15,
      "conservation": { "frigoJours": 3, "congelable": true },
      "emporter": true,
      "variantes": [
        {
          "pour": "profil-b",
          "retirer": ["jambon blanc"],
          "ajouter": [
            { "produit": "thon au naturel", "qtePortion": 50, "unite": "g", "rayon": "epicerie_salee", "marqueurs": ["poisson"] }
          ],
          "consigne": "Prélever sa part avant d'ajouter le jambon ; y mettre le thon."
        }
      ],
      "source": "Version classique"
    }
  ]
}
```

| Champ | Règle |
|---|---|
| `id` | slug `[a-z0-9-]+`, unique, stable |
| `nom` | nom affiché |
| `type` | `plat` · `dessert` · `accompagnement` · `preparation` (ex. yaourts maison) · `apero` |
| `recurrence` | `aucune` · `hebdo` (ajoutée chaque semaine, ses ingrédients vont dans la liste) |
| `statutRecette` | `attente` (⏳ nom seul, sans ingrédients) · `brouillon` (📝 version classique à faire corriger) · `validee` (✅ « Recette vérifiée ») |
| `portionsBase` | entier > 0, en portions adultes |
| `ingredients[]` | `produit` (minuscules, singulier, sans marque), `qte` > 0, `unite`, `rayon`, `marqueurs[]` ; `forme` obligatoire si `viande` ; `role` obligatoire si `legume` |
| `etapes[]` | phrases courtes |
| `cuisson[]` | `appareil`, `tempC` (four, airfryer), `mode` (texte libre, facultatif), `dureeMin` |
| `tempsActifMin` | minutes de travail effectif |
| `conservation` | `frigoJours`, `congelable` |
| `emporter` | `false` si le plat supporte mal la boîte réchauffée (défaut `true`) |
| `variantes[]` | `pour` (id de profil), `style` (`mer` · `vegetal`, facultatif : seulement pour un profil qui attend des styles), `retirer[]` (produits), `ajouter[]` (ingrédients avec `qtePortion` au lieu de `qte`), `consigne`, `frigoJours` (entier de 1 à 30 : jours au frigo de sa part après cuisson ; obligatoire pour `mer`). Au plus une version par (`pour`, `style`) ; une version sans `style` est la seule de son profil ; `mer` ajoute au moins un ingrédient `poisson` ou `fruits_de_mer`, `vegetal` aucun |
| `source` | « Recette de … », « Version classique » ou URL d'inspiration |

Vocabulaires fermés :

- `unite` : `g` `kg` `ml` `cl` `l` `pc` `cs` `cc` `pincee` `botte` `sachet` `boite` `tranche`
- `rayon` : `fruits_legumes` `boucherie` `charcuterie` `poissonnerie` `cremerie` `fromages` `epicerie_salee` `epicerie_sucree` `boulangerie` `surgeles` `boissons` `hygiene` `entretien` `divers`
- `marqueurs` : `viande` `boeuf` `porc` `volaille` `agneau` `charcuterie` `poisson` `fruits_de_mer` `bouillon_viande` `gelatine_porc` `gelatine_animale` `graisse_animale` `oeuf` `oeuf_cru` `laitier` `alcool_cru` `cafe` `legume` `feculent`
- `appareil` : `plaque` `four` `cookeo` `airfryer` `monsieur_cuisine`
- `forme` (viande) : `hachee` `fine` `morceaux` `effilochable`
- `role` (légume) : `principal` `incorpore`
- `style` (variante) : `mer` `vegetal` (tolérés : casse, accents, `vegetale`, `vegetarien`, `vegetarienne`)

`coeur/paquet.js` valide tout (types, bornes, vocabulaires) et renvoie des erreurs en français, ingrédient par ingrédient ; l'app affiche un aperçu avant d'enregistrer. Un plat `attente` est accepté sans ingrédients. Les photos (`photos/`, `vignette`) ne font pas partie de `paquet@1` : ni import ni export (taille). Un plat ajouté par son nom n'enregistre que `id` et `nom` (écriture fusionnée, pour ne jamais écraser une recette créée entre-temps sur l'autre téléphone) : les champs absents valent leur défaut (`type` plat, `statutRecette` attente, `recurrence` aucune) et l'export les complète. Doublons repérés par le nom (slug du nom), pas par l'identifiant ; un nom porté par un plat de la corbeille est refusé (« « X » est dans la corbeille. Remettez-le depuis la corbeille, en bas de cet écran. », bouton « Ouvrir la corbeille »), et l'identifiant d'un plat de la corbeille n'est jamais repris.

**Ajouter des recettes** (écran `#/import`, gestionnaire ; `#/import/<platId>` depuis « Coller la recette » d'une fiche ; collage ou « 📄 Choisir un fichier », même chemin) :
- Recette identique à la fiche : rien n'est réécrit (marque « modifiée à la main » gardée) ; une demande de recette restée ouverte se clôt par « Marquer la recette comme ajoutée ». `notes`, `derniereFois`, `modifieeLe`, `modifieePar` : connus mais ignorés (« Les notes ne sont pas reprises ici. »).
- Le gestionnaire colle la **réponse entière** de Claude : l'app y retrouve chaque objet `paquet@1` (prose, blocs de code, plusieurs blocs réunis). Elle distingue texte vide, demande recollée par erreur (`DEMANDE-…`), réponse coupée et absence de recette ; sans recette, elle reconnaît les deux phrases de refus du Projet Claude, en tête de ligne (casse, accents, citation, gras et ⚠️ ignorés ; une simple mention dans la prose ne compte pas) : « INSTRUCTIONS À METTRE À JOUR » (titre « Instructions à mettre à jour », bouton « Ouvrir Réglages ») et « APP À METTRE À JOUR » (« App à mettre à jour » : fermer puis rouvrir l'app). Une recette lue ou coupée l'emporte sur ces phrases.
- Tolérances : casse, accents et séparateurs des vocabulaires fermés (`Incorporé` → `incorpore`), nombres écrits en texte (`"0,5"`), `produit` mis en minuscules. Champs inconnus, `notes`, `derniereFois` et clés autres que `format`, `instructions` et `plats` ignorés avec un avertissement (repris dans la tranche qui les utilise : notes et sauvegarde en T1d, réglages et profils ensuite).
- Grille : `id` et `nom` toujours ; `portionsBase` et `ingredients` sauf plat sans recette ; avec des ingrédients, le statut devient au moins `brouillon` ; `tempC` conseillé pour four et airfryer.
- Plat visé : la cible (une seule recette collée), sinon le même `id` s'il s'agit du même plat (même nom, plat ⏳, demande ouverte, ou fiche modifiée à la main, donc peut-être renommée, sauf si un plat ⏳ ou une demande ouverte porte exactement le nom collé), sinon le même nom, sinon un nouveau plat (identifiant libre `-2` si un autre plat, déjà rempli, utilise le sien). Deux recettes visant le même plat : erreur.
- Écriture : seulement les champs présents (`mergeFields`), jamais `vignette` ni `notes`, jamais de table vide ni de valeur `undefined` ; demandes satisfaites closes dans un second lot (`update`, `statut: traitee`, `traiteeLe`).
- Fiche modifiée à la main (`modifieePar`) : l'aperçu annonce « Remplace les modifications faites à la main le … » ; la recette remplacée ou complétée efface `modifieeLe` et `modifieePar`.
- Version des instructions (`controlerInstructions`) : à l'aperçu, une réponse sans `instructions`, d'une version plus ancienne ou plus récente que `VERSION_INSTRUCTIONS` ajoute en tête des avertissements « …recopiez les instructions depuis Réglages › Projet Claude » (ou « fermez puis rouvrez l'app » si la réponse est plus récente que l'app). Non bloquant, absent du texte de correction, jamais pour une sauvegarde.
- Tout ou rien : la moindre erreur bloque l'enregistrement ; « Copier les corrections pour Claude » copie un texte avec les codes exacts. Les messages affichés n'emploient aucun mot technique (§4) ; le texte collé n'est jamais affiché.

```
CORRECTION paquet@1
instructions: <VERSION_INSTRUCTIONS>
id: <id du plat>
- <consigne avec les codes exacts>
(Rends la fiche complète corrigée, en un seul bloc.)
```

Textes copiés par les boutons « Demander à Claude » (gestionnaire uniquement) :

```
DEMANDE-RECETTE paquet@1
instructions: <VERSION_INSTRUCTIONS>
id: <id du plat>
nom: <nom du plat>
(Ajoute un lien, une photo ou la recette dictée.)
```

DEMANDE-RECETTE ajoute, si des profils ont des règles, un bloc `versions:` (une ligne `- pour: <id> — <ce qu'il mange>`, suivie de ` — styles: mer, vegetal` ou ` — styles: vegetal` pour un profil qui attend des styles) : Claude rend la fiche complète avec leurs variantes, une par style indiqué (avec `style`, et `frigoJours` pour `mer`).

```
DEMANDE-VARIANTES paquet@1
instructions: <VERSION_INSTRUCTIONS>
pour: <id du profil>
styles: mer, vegetal               (profil qui attend des styles ; sinon absent)
besoin: sans_viande | adapter      (si tous les plats ont le même besoin)
règles: <ce que mange le profil>
(Pour chaque plat, rends seulement { "id", "nom", "variantes" } …)
plats:
- id: <id>
  nom: <nom>
  portions: <n>
  ingrédients: <qte unité produit> ; … (✗ = ingrédient fautif)
  version actuelle: …                (si elle est à revoir ; « version actuelle (<style>): » avec des styles)
  à faire: mer, vegetal              (avec des styles : ceux à rendre, c'est-à-dire ceux qui manquent)
```

- Demande groupée par lots de `LOT_VERSIONS` (10) plats, depuis le bandeau « Versions pour <Prénom> » de Plats (gestionnaire, filtre « ❌ Versions à créer ») ; un second toucher recopie le même lot ; les plats déjà envoyés sont gardés quelques jours sur le téléphone (`ui/envoyes.js`) pour proposer le lot suivant.
- Une réponse « versions seules » (`id`, `nom`, `variantes`, sans ingrédients) n'écrit que les versions : transaction par plat, **fusion par (profil, style)** (`fusionnerVariantes`) : la version reçue remplace celle du même profil et du même style (une version sans style compte pour son style déduit), et celles de son profil d'un style qu'il n'attend pas pour ce plat (`attendus` de l'écriture, `stylesAttendusDesVersions`), sauf celles reçues avec elle ; les autres versions de ce profil restent, et celles qui n'avaient pas de style reçoivent leur style déduit, écrit ; une version reçue sans style remplace toutes celles de son profil, sauf si l'une d'elles est d'un autre style que la sienne (déduit) pour un profil qui attend des styles : refusée alors (« … ne dit pas si elle est mer ou végétale », code `variantes[pour=<p>] : \`style\` attendu`), pour ne jamais effacer une bonne version ; un statut recopié par habitude ne bloque pas le lot. Claude n'envoie ainsi que les versions à faire, et une bonne version n'est jamais réécrite par accident. Une fiche complète différente de la recette actuelle et porteuse de versions laisse choisir « version seule » ou « remplacer ». Une demande de variante n'est close que si, après fusion, au moins une version convient au profil. L'aperçu juge chaque version reçue seule (« 🐟 Version mer pour <Prénom> ajoutée », « 🌿 Version végétale pour <Prénom> remplacée ») ; la correction d'une version qui ne convient pas la désigne par `variantes[pour=<p>, style=<s>]`.
- Deux versions pour le même profil et le même style, ou une version sans style à côté d'une autre : erreur à l'ajout de recettes ; ailleurs (sauvegarde, fiche en base, « Modifier »), la première est gardée. Une version `mer` sans `frigoJours` ou sans poisson ajouté, une `vegetal` qui ajoute du poisson : erreur à l'ajout de recettes, avertissement ailleurs (la version reste ; la fusion écrit le style déduit d'une ancienne version sans lui inventer de jours au frigo). La correction d'une réponse « versions seules » redemande les seules versions, avec celles des autres plats du lot (rien n'est enregistré tant qu'une erreur reste).

Texte copié par « 💡 Idées de plats » (Semaine, gestionnaire) :

```
DEMANDE-IDEES paquet@1
instructions: <VERSION_INSTRUCTIONS>
nombre: 5 | 10 | 15                (15 par défaut)
envie: <texte libre, une ligne>    (facultative, 120 caractères au plus)
critères: plats originaux (pas les grands classiques), faciles à faire en batch : préparation simple, se gardent 3 jours au frigo, se réchauffent bien, se congèlent de préférence ; …
appareils: plaque, four, cookeo, airfryer    (appareils actifs des réglages ; sinon ceux-ci)
versions:                          (comme DEMANDE-RECETTE, si des profils ont des règles ; styles du profil)
- pour: <id> — <ce qu'il mange> — styles: mer, vegetal
aimés: <plats notés 5 par au moins un profil, hors corbeille, 20 au plus>      (si non vide)
évités: <plats notés 0 par au moins un profil, 20 au plus>     (si non vide)
déjà dans l'app: <tous les noms de plats, ⏳ et corbeille compris, triés, séparés par « ; »>
(Rends 5 fiches complètes par message, chacune avec un `id` nouveau (slug du nom), `"statutRecette": "brouillon"` et `"source": "Idée de Claude"` … attends « suite » pour les 5 suivantes. Un seul bloc par message.)
```

- Carte « 💡 Idées de plats » (Semaine, gestionnaire hors aperçu) : critères permanents, plats originaux et faciles à faire en batch ; nombre (5, 10, 15) et envie facultative choisis dans la feuille. Claude répond par messages de `IDEES_PAR_MESSAGE` (5) fiches complètes, `statutRecette` `brouillon`, `source` « Idée de Claude » (`SOURCE_IDEE`) ; chaque message se colle dans « Ajouter des recettes », puis on écrit « suite » à Claude. Seule demande où Claude crée l'`id` (slug du nom). Un message refusé (tout ou rien : la moindre erreur bloque ses 5 fiches, et le recoller bute sur la même erreur) : la correction redemande toutes ses fiches, les autres telles quelles (« Rien n'a été enregistré : rends aussi, telles quelles, les autres fiches du message (…) », « (Rends toutes les fiches du message, corrigées, en un seul bloc.) ») ; elle ne fait pas avancer la série.
- Plat de la corbeille (§6) : une recette ou une version qui le vise (règles habituelles du plat visé ; un plat actif du même nom passe avant) n'est pas reprise (statut `corbeille`, « Dans la corbeille » : « « X » est dans la corbeille : remettez-le pour lui ajouter cette recette. », bouton « Remettre » qui recalcule l'aperçu) : ni écriture, ni demande close, ni erreur, les autres s'enregistrent. « Remettre » n'est proposé que si le plat, remis, prendrait ce qui est reçu (`remettable`) : une idée de Claude pour un plat de la corbeille qui a sa recette, « cette idée n'est pas reprise » ; des versions pour un plat ⏳, ou une entrée sans recette ni version, « cette réponse n'apporte rien à ce plat ». « Coller la recette » d'une fiche, si Claude rend le nom d'un plat de la corbeille : la recette va à la fiche, qui garde son nom (« le nom de la fiche est gardé ») ; le nom d'un plat actif reste une erreur. `corbeille` dans une réponse est connue et ignorée.
- Garde-fou à l'ajout de recettes : une fiche complète dont `source` vaut exactement « Idée de Claude » et qui vise (par identifiant ou par nom, règles habituelles du plat visé, hors « Coller la recette » d'une fiche) un plat qui a déjà sa recette n'est pas reprise (statut `deja`, « Déjà dans vos plats » : « « X » est déjà dans vos plats : cette idée n'est pas reprise. ») : ni écriture, ni demande close, ni erreur, les autres idées du lot s'enregistrent ; une idée qui vise un plat ⏳ le complète normalement.

**Alignement avec le Projet Claude** : `docs/projet-claude.md` (fourni par l'app, copié depuis Réglages) est la seule source du format et des demandes ; il porte sa version (`VERSION_INSTRUCTIONS`, entier, `coeur/claude.js`) en en-tête et en section 0. Chaque texte copié (DEMANDE-RECETTE, DEMANDE-VARIANTES, DEMANDE-IDEES, CORRECTION) porte en deuxième ligne `instructions: <n>` ; le Projet Claude compare à sa version et, si elles diffèrent, ne rend aucune fiche mais l'une des deux phrases de refus ci-dessus. Chaque bloc qu'il rend porte `"instructions": <n>` après `"format"`. Il ne réécrit jamais le format : une évolution utile devient une « PROPOSITION pour Claude Code » (objet, pourquoi, changement, exemple). Un fichier de contexte du foyer peut compléter le projet, sans jamais contredire les instructions.

## 9. Algorithmes (`js/coeur/`, couverts par des tests)

**Liste (`liste.js`)**
1. Par plat retenu : facteur = (`portionsACuire` + `portionsACongeler`) / `portionsBase` ; chaque ingrédient × facteur. `portionsACuire` vient du nombre d'adultes, d'enfants et de repas choisis pour le plat, réglables depuis la liste des plats de la semaine ; la liste est recalculée en direct.
2. Variantes (explicites ou automatiques) : `ajouter` ou `par` × portions du profil concerné (× `coefPortion`) ; `retirer` ignoré dans les quantités (léger surplus assumé). Ligne étiquetée « pour <profil> ».
3. Apéro de la semaine : ingrédients des fiches `apero` choisies + `apero.incontournables`.
4. Préparations `hebdo` et habituels actifs ajoutés.
5. Agrégation par produit et famille d'unités (g↔kg, ml↔cl↔l) ; `pc` arrondi au supérieur.
6. Recalcul à chaque changement : lignes générées réécrites, `coche` conservé par `cle`, lignes manuelles jamais touchées.
7. Deux affichages, mémorisés par personne :
   - **Drive** : « Spécial cette semaine » (`special`) puis « Habituels » ; chaque ligne a un bouton 🔍 qui ouvre `drive.urlRecherche` en remplaçant `{q}` par `encodeURIComponent(rechercheDrive || nom)`. Depuis la ligne, « Modifier la recherche » enregistre `rechercheDrive` sur le produit (ex. « pâtes courtes » → « penne ») : le bon terme sert toutes les semaines suivantes.
   - **Magasin** : par rayon (ordre des réglages), lignes cochées en bas, fonctionne hors ligne.
8. Un plat ⏳ sélectionné n'apporte aucune ligne : bandeau « ingrédients à ajouter à la main ».
9. **Placard** : un produit marqué `placard` dont le total de la semaine est sous son seuil va dans « Déjà à la maison ? », interrupteur éteint (non acheté par défaut, un toucher l'ajoute) ; au-delà du seuil, ligne normale. Équivalences approximatives, pour comparer au seuil seulement : pincée ≈ 0,5 g ; c. à café ≈ 5 g ou 5 ml ; c. à soupe ≈ 15 g ou 15 ml. Liste de départ ci-dessous, modifiable dans Réglages et enrichie d'un toucher « Toujours dans mon placard » depuis la liste de courses.

   | Produit | Seuil de départ |
   |---|---|
   | Sel fin, poivre | toujours proposés (sans seuil) |
   | Huile d'olive, huile neutre | 6 c. à soupe |
   | Gros sel | 2 c. à soupe |
   | Épices et herbes sèches (paprika, cumin, curry, curcuma, cannelle, muscade, piment d'Espelette, 4 épices, gingembre moulu, herbes de Provence, thym, laurier, origan) | 2 c. à café |
   | Vinaigre (vin, balsamique, cidre), sauce soja | 4 c. à soupe |
   | Moutarde, concentré de tomate, maïzena, miel, chapelure | 2 c. à soupe |
   | Bouillon en cube, fond de veau, fumet | 2 cubes ou 2 c. à soupe |
   | Sucre blanc ou roux | 30 g |
   | Farine | 50 g |
   | Levure chimique, sucre vanillé | 1 sachet |
   | Extrait de vanille | 1 c. à café |
   | Ail | 2 gousses |
   | Beurre | 30 g |
   | Lait | 10 cl |

**Proposition (`proposition.js`)**
1. Créneaux = repas de chaque profil sur la semaine, pondérés par `coefPortion`.
2. Créneaux au-delà de `frigoJours` après le batch → congélateur d'abord (portions les plus anciennes, plats compatibles) ; si le stock manque, augmenter `portionsACongeler` d'un plat congelable.
3. Créneaux restants → entre `nbPlats.min` et `nbPlats.max` plats (hors ⏳) couvrant chaque créneau par un plat ✅ ou ⚠️ pour son profil. Note 0 = jamais proposé à ce profil.
4. Score = moyenne des notes des profils concernés (non noté = 3, comme « Pourquoi pas » : `noteRetenue` ; exclusion : `jamaisPropose` ; noté ou non : `estNote`, dans `coeur/notes.js`) + bonus d'ancienneté (semaines depuis `derniereFois`, plafonné) − malus si servi la semaine précédente − malus ⚠️ (plus fort pour « variante à créer ») − malus des règles `preference` déclenchées + bruit faible (graine fixe en test).
5. Apéro : `apero.nbSuggestions` fiches `apero` compatibles avec tous les profils (ou adaptables), jamais les mêmes deux semaines de suite.
6. Glouton + amélioration locale (le problème est minuscule). Tout reste modifiable à la main : verrouiller, échanger, réaffecter, choisir une variante.
7. Chaque plat proposé affiche le pictogramme de son mode de cuisson principal (§4).
8. « Proposer » s'ouvre sur une feuille, n'importe quel jour de la semaine (pas seulement le samedi) : **période choisie librement** (« du … au … », par défaut d'aujourd'hui à dans 6 jours), **nombre de plats** (prérempli par `nbPlats`), interrupteur **« Vacances »** pour l'enfant (ses midis à la maison s'ajoutent sur la période, au lieu de la cantine). Le résultat indique pour chaque plat les portions calculées : « 6 portions : 4 cette semaine, 2 à congeler ».
9. **Équilibre** : chaque proposition mêle plats nouveaux (jamais proposés), plats déjà proposés mais pas encore notés, et plats aimés ou adorés ; un plat noté « Jamais » par un profil ne lui est jamais proposé.
10. **Période** : la semaine affichée et proposée va d'aujourd'hui à aujourd'hui + 6 jours (glissante), modifiable dans « Proposer ».
11. **Rappel « À congeler »** : le jour où un plat cuisiné atteint sa durée au frigo (`conservation.frigoJours`, 3 par défaut, réglable par fiche), Semaine affiche une carte « À congeler aujourd'hui : carbonade, 2 portions ». Dans l'app seulement, sans notification.

**Batch (`batch.js`)** — « Commencer le batch » (n'importe quel jour) ouvre une feuille où les plats de la semaine sont cochés d'avance : un toucher « C'est parti » les retient, et fermer la feuille retient aussi tous les plats ; un message « Batch lancé : 4 plats · Modifier » permet de corriger. Aucun minuteur, rien ne bloque le reste de l'app. Le jour du batch lancé est la date de cuisson qui déclenche le rappel « À congeler ». Regrouper par appareil puis température ; four : 2 plats simultanés si écart ≤ 10 °C ; plaques : 4 en parallèle ; cookeo et airfryer : 1 à la fois. Les variantes (ex. part au saumon) apparaissent comme petites préparations à part. Durée estimée = file d'appareil la plus longue + temps actif ; alerte au-delà de `dureeBatchMaxMin`. « Batch terminé » → `portionsACongeler` ajoutées au congélateur.

**Congélateur (`congelateur.js`)** — ajout par le batch ou à la main ; retrait quand une semaine qui l'utilise passe `validee` ; alerte qualité au-delà de 90 jours.

## 10. Écrans

1. **Semaine** (accueil) : ce soir pour chacun, carte « prochaine action » (dont « À congeler aujourd'hui », §9), grille jours × profils (chaque plat avec le pictogramme de son mode de cuisson principal, §4), apéro du week-end, « Proposer » (les deux membres), « Imprimer » (menu de la semaine et apéro, puis liste de courses par rayon, sur une page pensée pour l'impression ; `window.print()` → « Enregistrer au format PDF » de Chrome, à envoyer), badges ⏳ et Demandes (gestionnaire) ; sous la semaine, carte « 💡 Idées de plats » (gestionnaire, hors aperçu « Repas et courses ») : feuille « Combien ? » 5 · 10 · 15 (15 coché), « Une envie ? (facultatif) », « 📋 Copier la demande » (DEMANDE-IDEES, §8), puis « Ajouter des recettes › ».
2. **Courses** : bascule Drive / Magasin, grandes cases à cocher, ajout rapide, origine visible (plat, apéro, habituel).
3. **Plats** : recherche, filtres (type, statut, « 🌿 Pour <Prénom> », « ❌ Versions à créer » pour le gestionnaire), ligne 🌿 / ❌ par profil qui a des règles, ligne de notes par profil (« Prénom ❤️ », « Prénom ★4 »), invitation « Aucun plat noté » tant que la personne n'a rien noté, pictogramme du mode de cuisson principal, ajout par nom (→ ⏳ et demande de recette), bandeau « Versions pour <Prénom> » (gestionnaire : copie d'un lot de 10 pour Claude, §8 ; plats à créer d'abord, puis plats à compléter : « 2 plats attendent une version pour <Prénom>. 3 autres sont à compléter (végétale). », « Compléter sa version » quand le lot n'a que des plats à compléter), bandeau « N plats dont personne ne veut » (tous les profils les ont notés « Jamais » ; filtre « Tous » ou par type, hors recherche ; « Les mettre à la corbeille », annonce avec « Annuler »), et en bas de la liste « 🗑️ Corbeille (N) » (si N > 0, les deux membres) : feuille « Corbeille » (le plus récent d'abord, « Mis à la corbeille le … par … », lien vers la fiche, « Remettre » ; « Vider la corbeille » pour le gestionnaire seul, hors aperçu « Repas et courses », en deux temps (« Supprimer définitivement N plats et leurs photos ? Ce n'est pas réversible. »), inactif hors ligne).
4. **Découvrir** : §4.
5. **Fiche** : photo (prise ou choisie, les deux membres), recette, badges (dont le mode de cuisson principal et sa durée), section « Notes » (soi et l'enfant : « Jamais » à part, 5 étoiles, « Effacer » ; l'autre adulte en lecture seule ; « Pas encore noté · compte comme Pourquoi pas »), versions par profil (une partie par version, mer d'abord : « 🐟 Version mer », « 🌿 Version végétale », consigne, ce qui est retiré et ajouté, « À manger dans les N jours après cuisson » ; pour le gestionnaire seul, « ❌ À revoir », « Plus utilisée : <Prénom> ne mange pas de poisson. » (version d'un style plus attendu, quand une autre convient ; en dernier) et « 🌿 Version végétale à demander », et « Demander à Claude » demande les versions qui manquent), cuisson, conservation ; « Modifier » ; « Demander à Claude » et « Coller la recette » (gestionnaire) ; tout en bas, « 🗑️ Mettre à la corbeille » (les deux membres, un toucher sans confirmation, retour à Plats, annonce « « X » est dans la corbeille. » avec « Annuler »), remplacé par la carte « Personne n'en veut » quand tous les profils l'ont noté « Jamais ». Un plat de la corbeille (fiche ouverte par un lien) se lit sans rien pouvoir y changer, sous la carte « Ce plat est dans la corbeille » et son bouton « Remettre ».
   - Fiche en lecture, un seul bouton « ✏️ Modifier la recette » (les deux membres ; « Écrire la recette moi-même » sur un plat ⏳) → écran `#/modifier/<id>` : nom, type, portions (« Ces quantités sont pour N portions »), ingrédients (ajouter, retirer, quantité, unité, nature), étapes (ajouter, déplacer, retirer), cuisson principale (« Cuit surtout au » + durée), jours au frigo, congélation, boîte à emporter, « Recette vérifiée ». Restent à Claude : variantes, temps de travail, source, récurrence, étapes de cuisson secondaires.
   - Une seule barre « Enregistrer » (onglets masqués). Seuls les champs touchés sont écrits ; un bandeau prévient si l'autre téléphone a changé l'un d'eux entre-temps. La modification en cours est gardée sur le téléphone (`localStorage`, par compte et par plat) jusqu'à l'enregistrement, l'annulation ou la déconnexion : la fiche propose alors « Reprendre ».
   - Ajout d'un ingrédient : suggestions dès les premières lettres, tirées de tous les ingrédients déjà connus, unité, rayon et nature préremplis ; pour un produit jamais vu, une question « Viande / Poisson / Légume / Autre » (viande « en morceaux », légume « fondu dans le plat » par défaut, modifiables dans « Plus de précisions »).
6. **Batch du dimanche**, **Congélateur**, **Demandes** (gestionnaire), **Réglages** (gestionnaire : profils et règles, appareils, rayons, habituels, apéro, drive, notifications, ajout de recettes, carte « Projet Claude » (« Version <n> des instructions », copier les instructions du projet ; tant que cette version n'a été copiée ni sur ce téléphone par ce compte ni sur un autre appareil (`reglages/foyer.instructionsCopiees`), bandeau « 🔔 Nouvelles instructions : copiez-les dans votre projet Claude » et copie en action principale ; même rappel dans le panneau du profil du gestionnaire, « 🔔 Nouvelles instructions pour votre projet Claude » + « Les recopier », vers Réglages), sauvegarde : « Télécharger une sauvegarde », « Restaurer une sauvegarde »).

## 11. Tranches

| | Contenu | Fini quand |
|---|---|---|
| T0 Socle | PWA installable, connexion Google, refus propre si adresse non autorisée, rôles, tokens et navigation du §4, indicateur hors ligne | Installée sur les 2 téléphones ; l'app s'ouvre en mode avion ; l'utilisatrice des courses trouve l'écran beau |
| T1 Plats, import & Découvrir | Profils, bibliothèque, fiche, pictogramme du mode de cuisson, ajout par nom (+ demande de recette), notes 0–5, écran Découvrir, modification d'une fiche par les deux membres, photo de la fiche (prise ou choisie, compressée, par les deux membres), import (collage ou fichier) et export, « Demander à Claude » | Catalogue de départ importé ; le gestionnaire a trié des plats dans Découvrir sur son téléphone (pour lui et à la place de l'enfant) ; une note posée sur le téléphone apparaît en direct sur un second appareil (ordinateur) |
| T2 Compatibilité & variantes | Règles des profils, substitutions, `compatibilite.js` + tests, badges, demandes, notification ntfy (variantes et recettes à ajouter) | Un plat aux lardons passe en ⚠️ « version saumon » pour le profil concerné ; une variante manquante déclenche une demande et une notification |
| T3 Semaine, liste & apéro | Sélection manuelle, pictogramme de cuisson sur la grille, personnes (adultes, enfants) et repas par plat, choix des variantes (Mer / Végétale d'un geste sur la carte du repas, mer par défaut ; liste de courses de la seule version choisie ; conservation de la part au poisson : minimum des `frigoJours`, avertissement non bloquant), apéro, `liste.js` + tests, placard, modes Drive et Magasin, « Courses terminées », « Imprimer » (menu + liste en PDF via le navigateur) | Une vraie commande drive préparée avec l'app |
| T4 Congélateur & proposition | Stock, `congelateur.js` et `proposition.js` + tests, « Proposer » (repas et apéro, avec le pictogramme de cuisson de chaque plat proposé) + ajustements | « Proposer » couvre tous les repas de chacun, fin de semaine par le congélateur |
| T5 Batch | `batch.js` + tests, « Commencer le batch » (jour choisi, plats cochés d'avance), vue par appareil, « Batch terminé » | Un vrai batch préparé avec l'écran batch |
| T6 Accueil | Assistant de première ouverture, chaleureux : prénom (relie la personne à son profil), ce qu'elle fait (courses, planification, batch) et, pour les courses et le batch, quels jours | L'utilisatrice des courses découvre l'app par cet assistant ; ses retours d'usage donnent ensuite des mises à jour |

V2 (après 4 à 6 samedis d'historique) : produits « probablement manquants » (rythme d'achat par produit), plan de cuisson minuté, statistiques.

## 12. Conventions

- Tout en français : interface, noms métier, commentaires, messages de commit.
- Contenu utilisateur inséré avec `textContent`, jamais `innerHTML`.
- HTML sémantique, cibles tactiles ≥ 48 px, contraste AA, mode sombre via `prefers-color-scheme`.
- `js/coeur/` sans DOM ni Firebase ; chaque fonction testée.
- Un abonnement `onSnapshot` par requête, créé une fois ; écritures uniquement sur action de l'utilisateur.
- États visibles : chargement, vide, hors ligne, accès refusé, import invalide.
- Petits commits ; mettre à jour §14 à chaque fin de tranche.
- Toute modification de `docs/projet-claude.md` augmente `VERSION_INSTRUCTIONS` (`js/coeur/claude.js`) et la version écrite dans le document (en-tête, section 0, exemples) ; un garde-fou d'empreinte (`EMPREINTE_INSTRUCTIONS`, `tests/coeur-alignement.test.js`) échoue sinon et donne la nouvelle valeur. Le propriétaire recopie ensuite les instructions dans le Projet Claude (Réglages › Projet Claude, rappel 🔔 dans l'app) ; le dire dans la pull request.
- À chaque push, donner au propriétaire le lien de la pull request et le code de version attendu (6 premiers caractères de `VERSION` dans `sw.js`, affichés en bas du panneau du profil).

## 13. Mise en place (actions du propriétaire, hors Claude Code)

1. GitHub : créer le dépôt public avec un README, puis Settings → Pages → *Deploy from a branch* → `main` / racine.
2. console.firebase.google.com : créer un projet (Analytics inutile) → ajouter une application Web → copier `firebaseConfig` (public par nature ; il va dans `js/firebase.js`).
3. Firestore Database : créer la base en mode production, région Europe ; onglet Règles : coller les règles du §6 avec les deux adresses réelles, en minuscules.
4. Authentication : activer le fournisseur Google ; Paramètres → Domaines autorisés → ajouter `<pseudo>.github.io`.
5. Facultatif (T2) : installer l'app ntfy sur le téléphone du gestionnaire, s'abonner à un sujet long et aléatoire, saisir ce sujet dans Réglages.

## 14. Statut

- [x] T0 Socle — validé le 2026-10-05 sur le téléphone du gestionnaire (connexion, rôles, installation, mode avion) ; installation et avis sur le téléphone de l'utilisatrice des courses reportés à la fin du projet (décision du propriétaire)
- [x] T1 Plats, import & Découvrir — en trois livraisons :
  - [x] T1a profils, bibliothèque, fiche, ajout par nom (+ demande de recette), photo (appareil ou galerie), aperçu de la vue « Repas et courses » — publié et essayé sur le téléphone du gestionnaire le 2026-10-05
  - [x] T1b « Ajouter des recettes » (coller la réponse de Claude, aperçu, enregistrement), « Demander à Claude » et « Coller la recette » sur la fiche — publié et essayé sur le téléphone du gestionnaire le 2026-10-05
  - [x] T1c-1 pictogramme du mode de cuisson principal (liste des plats, fiche) — fusionné le 2026-10-05, mis en ligne le 2026-10-06 (incident GitHub Actions) et essayé sur le téléphone du gestionnaire le 2026-10-06
  - [x] T1c-2 « Modifier » une recette (les deux membres) et « Recette vérifiée » — publié et essayé sur le téléphone du gestionnaire le 2026-10-06 (modification, reprise après fermeture de l'app)
  - [x] T1d en deux livraisons ; le critère « Fini quand » de T1 (§11) se vérifie à T1d-1, par le gestionnaire seul :
    - [x] T1d-1 notes 0–5, « Qui êtes-vous ? », Découvrir, notes sur la fiche et dans la liste — publié et essayé sur le téléphone du gestionnaire et sur l'ordinateur le 2026-10-06 (critère « Fini quand » de T1 vérifié : note posée sur le téléphone visible en direct sur l'ordinateur) ; vibration allongée à 40 ms (15 ms ne se sentait pas)
    - [x] T1d-2 sauvegarde et restauration par fichier, ajout de recettes par fichier — publié le 2026-10-07 ; essai court fait sur le téléphone du gestionnaire (sauvegarde téléchargée, restauration du même fichier « Tout est déjà à jour ») ; grand essai de restauration (plat supprimé, recette cochée) reporté à la demande du propriétaire
- [ ] T2 Compatibilité & variantes — en cinq livraisons (plan détaillé hors du dépôt, données du foyer dans Firestore seulement) :
  - [x] T2a « Ce que <Prénom> mange » (régime d'un profil, lignes 🌿 / ❌ dans la liste, la fiche et Découvrir, filtres, repères dans « Modifier », règles dans la sauvegarde) — publié et essayé sur le téléphone du gestionnaire le 2026-10-07
  - [x] T2b versions écrites par Claude, dix plats à la fois (demande groupée, import des seules versions, `docs/projet-claude.md`, carte « Projet Claude » dans Réglages) — publié le 2026-10-08 ; premier essai : la version reçue retirait la viande sans la remplacer → instructions renforcées (« une vraie alternative »), second essai concluant sur le téléphone du gestionnaire le 2026-10-08
  - [x] Alignement app ↔ projet Claude (version des instructions dans chaque demande et chaque réponse, phrases de refus reconnues, avertissement à l'aperçu, rappel 🔔 de recopier les instructions dans Réglages et le panneau du profil) — publié et essayé sur le téléphone du gestionnaire le 2026-10-08
  - [x] Deux versions par profil (mer et végétale : `style` et `frigoJours` d'une variante, styles attendus selon le régime, fusion par style, plats « à compléter », instructions du projet Claude en version 2) — publié et essayé sur le téléphone du gestionnaire le 2026-10-08
  - [x] T2b+ « 💡 Idées de plats » (carte sous la semaine, gestionnaire : Claude propose 5, 10 ou 15 plats originaux, simples à cuisiner en batch, avec leurs versions, 5 recettes par message collées dans « Ajouter des recettes » ; idée déjà dans les plats non reprise ; instructions du projet Claude en version 3) — publié et essayé sur le téléphone du gestionnaire le 2026-10-09
  - [ ] Corbeille : mettre un plat à la corbeille (les deux membres, depuis la fiche, annonce avec « Annuler »), corbeille en bas de Plats avec « Remettre » (les deux membres) et « Vider la corbeille » (gestionnaire), suggestion quand tous les profils ont dit « Jamais », marque gardée par la sauvegarde — pull request ouverte le 2026-10-09, essai sur téléphone à faire
  - [ ] T2c précautions de l'enfant selon son âge (date de naissance, barème générique français, ❌ / ! avec la cause, carte 🧸🎂 qui propose d'assouplir, règles désactivables)
  - [ ] T2d relecture des recettes existantes par Claude (repères de précaution)
  - [ ] T2e demandes et notification (« Demander ma version », écran Demandes, ntfy)
- [ ] T3 Semaine, liste & apéro
- [ ] T4 Congélateur & proposition
- [ ] T5 Batch
- [ ] T6 Accueil (assistant de première ouverture, juste avant la remise de l'app)

Décisions :
- 2026-10-04 — Stack validée : PWA vanilla + Firestore + GitHub Pages. Recettes produites par un Projet Claude au format `paquet@1`.
- 2026-10-05 — Apéro hebdomadaire ; variantes automatiques par substitution et demandes de variante notifiées (ntfy) ; mode Drive sans API (lien de recherche) ; direction visuelle « cuisine familiale » ; écran Découvrir ; vue simplifiée pour l'utilisatrice des courses.
- 2026-10-05 — Gestionnaire désigné à la première ouverture : tant que `reglages/foyer` n'existe pas, « C'est moi » le crée (transaction, jamais d'écrasement). Mise en ligne : pull request de la branche de travail vers `main`, fusionnée par le propriétaire.
- 2026-10-05 — Photo par recette avancée de V2 à T1 : image compressée dans `photos/{platId}` (Firestore ; Firebase Storage demanderait le forfait payant Blaze), vignette légère dans la fiche ; photos hors `paquet@1`.
- 2026-10-05 — Socle : connexion par fenêtre uniquement (`initializeAuth` sans résolveur au démarrage, pour ne pas ralentir l'ouverture sur téléphone) ; service worker en cache d'abord, mise à jour d'un bloc via `VERSION` = empreinte des fichiers (vérifiée par `npm test`) ; caches préfixés `repas-courses-` et réparés à l'ouverture, car le domaine github.io est partagé avec d'autres apps du compte ; un compte jamais confirmé par le serveur ne voit pas la copie locale.
- 2026-10-05 — Rôles réels du foyer : l'utilisatrice des courses planifie aussi la semaine, ajoute les plats par leur nom et les photos ; le gestionnaire ajoute les recettes (import, « Demander à Claude »), traite les demandes et règle l'app. Les deux peuvent organiser la semaine. Un plat ajouté par son nom crée une demande de recette, notifiée au gestionnaire (ntfy, T2). Libellés : « Recettes et réglages » et « Repas et courses ».
- 2026-10-05 — Filet de sécurité si l'app n'est pas adoptée : « Imprimer » sur Semaine (T3), menu + liste de courses en PDF via l'impression du navigateur, sans bibliothèque.
- 2026-10-05 — T0 clos. L'utilisatrice des courses ne testera l'app qu'une fois terminée (décision du propriétaire) : risque d'adoption découvert tard, assumé.
- 2026-10-05 — T1 redécoupé pour que chaque livraison se teste seule sur le téléphone du gestionnaire : T1b = ajout de recettes par collage ; T1c = notes, Découvrir, modification, sauvegarde et import de fichier. L'écran Demandes et les badges restent en T2, comme au §11 (le gestionnaire ne crée pas de demande lui-même). À trancher en T2 : en aperçu « Repas et courses », le gestionnaire crée une demande comme l'autre membre, pour pouvoir tester seul. Le critère « Fini quand » de T1 sera adapté en T1c.
- 2026-10-05 — Maîtres mots du propriétaire (§1). Recettes modifiables par les deux membres (T1c) : ingrédients, quantités, unités, étapes, portions ; suggestions tirées des ingrédients connus, question « Viande / Poisson / Légume / Autre » pour un produit jamais vu ; un nouvel ajout depuis Claude signale qu'il remplace des modifications faites à la main. Personnes (adultes, enfants) et repas par plat, réglables depuis la semaine, et placard avec seuils (T3, §9).
- 2026-10-05 — T1c redécoupé : « Modifier » d'abord (T1c), notes, Découvrir et sauvegarde ensuite (T1d). Un produit jamais vu ne demande que sa nature (« Viande / Poisson / Légume / Autre ») : une viande est « en morceaux » et un légume « fondu dans le plat » par défaut, modifiables ensuite.
- 2026-10-06 — « Modifier » : la modification en cours est gardée dans `localStorage` (Android vide `sessionStorage` quand l'app est fermée depuis les applis récentes) ; portions et ingrédients s'écrivent toujours ensemble (les quantités valent pour le nombre de portions affiché) ; `conservation` est écrite sous-champ par sous-champ (l'autre sous-champ, changé ailleurs, reste) ; la cuisson principale se règle sur l'étape la plus longue de la fiche, les autres étapes restent celles de Claude. Les bancs d'essai navigateur (Playwright, faux Firebase) vivent dans la session de travail, hors du dépôt ; ils sont rejoués à chaque livraison (T0, T1a, T1b, T1c-1, T1c-2, T1d-1, T1d-2).
- 2026-10-06 — Mise en ligne : pendant un incident GitHub Actions, une publication Pages relancée peut rester « en file » sans pouvoir être annulée ni supprimée, et bloquer les suivantes. Remède : demander une publication neuve de `main` avec `gh api -X POST repos/<propriétaire>/<dépôt>/pages/builds` (outil `gh` connecté au compte du propriétaire).
- 2026-10-06 — Décision maintenue : l'utilisatrice des courses découvre l'app une fois terminée ; ses retours d'usage donneront des mises à jour. Le critère « Fini quand » de T1 est vérifié par le gestionnaire seul (téléphone + ordinateur).
- 2026-10-06 — Demandes du propriétaire pour la planification (T3-T4, §9 Proposition 8-9) : « Proposer » utilisable n'importe quel jour, sur une période choisie (du … au …), avec le nombre de plats, portions calculées et part à congeler affichées pour chaque plat ; rappel « À congeler » dans l'app ; interrupteur « Vacances » de l'enfant dans « Proposer ». À trancher en T3 : le modèle `semaines/{dimancheISO}` devient une période glissante (d'aujourd'hui à + 6 jours par défaut, début et fin modifiables).
- 2026-10-06 — Autres demandes : « Commencer le batch » un autre jour que le dimanche, plats cochés d'avance, sans minuteur (proposé à la place d'une validation automatique après 30 s, jugée risquée : validation à l'insu de la personne, minuteur gênant pour les lecteurs d'écran) ; le jour du batch lancé déclenche le rappel « À congeler ». Un plat non noté compte comme « Pourquoi pas » ; la proposition garde un équilibre entre nouveautés, plats non notés et favoris. Semaine glissante d'aujourd'hui à + 6 jours. Assistant d'accueil (T6) construit juste avant la remise de l'app.
- 2026-10-05 — Pictogramme du mode de cuisson principal à côté de chaque plat, puis sur les plats de la semaine et les suggestions de « Proposer » (§4). Dessins au trait propres à l'app, validés par le propriétaire sur description, toujours accompagnés du nom de l'appareil ; livrés à part (T1c-1), avant « Modifier ».
- 2026-10-06 — T1d-1 : libellés des notes 0 à 5 « Jamais, Pas trop, Bof, Pourquoi pas, J'aime bien, J'adore » ; on note pour soi et pour l'enfant sans adresse, jamais pour l'autre adulte (lecture seule) ; « Qui êtes-vous ? » en attendant l'assistant de T6 ; un plat non noté est affiché « Pas encore noté · compte comme Pourquoi pas ». T1d découpé : notes et Découvrir d'abord (T1d-1), sauvegarde ensuite (T1d-2).
- 2026-10-06 — Découvrir garde les trois gestes Jamais · Pourquoi pas · J'adore (décision du propriétaire) : « Pourquoi pas » reste la réponse neutre, la nuance « J'aime bien » se règle sur la fiche.
- 2026-10-07 — T1d-2 : restauration additive (rien n'est retiré ni écrasé sans case cochée), en ligne seulement, par transactions revérifiées à l'envoi ; une sauvegarde faite sur une copie non confirmée par le serveur est donnée mais ne compte pas comme dernière sauvegarde.
- 2026-10-07 — T1 clos. Le grand essai de restauration de T1d-2 est reporté (décision du propriétaire) : la reprise d'une recette cochée n'a été essayée que sur le faux Firebase ; garder des fichiers de sauvegarde réduit ce risque.
- 2026-10-07 — T2 recentré sur le besoin réel : un adulte du foyer ne mange pas de viande (versions de ses plats écrites par Claude, plusieurs à la fois) ; l'enfant a des précautions selon son âge (barème générique français dans l'app, date de naissance et choix des parents dans Firestore, chaque règle désactivable, levée seulement proposée, jamais automatique). Tout ce qui concerne l'enfant porte un nounours 🧸. Escargots et grenouilles comptent comme viande, toute gélatine animale est exclue, le beurre reste permis. Dans la vue « Repas et courses », jamais de croix rouge. En aperçu « Repas et courses », le gestionnaire crée les demandes et reçoit la notification comme l'autre membre (T2e). L'app reste conçue pour un seul foyer ; une version commerciale sera réévaluée après quelques mois d'usage réel.
- 2026-10-07 — T2b : Claude propose les versions des profils qui ont des règles avec chaque recette demandée, et par lots de dix pour les plats existants. Ajouts du propriétaire : bouton « 15 idées de plats » juste après T2b ; corbeille (les deux membres suppriment, jamais automatique) avant T2c ; l'utilisatrice des courses demande elle-même sa version (T2e).
- 2026-10-08 — Versions sans viande : ce qui est retiré est remplacé par une alternative qui apporte goût et texture (tofu, seitan, tempeh, protéines de soja, légumineuses, champignons…), végétale de préférence ; technique dans la consigne (`docs/projet-claude.md` §4).
- 2026-10-08 — Sans version connue d'un plat, Claude en invente une : il compense ce qui est retiré avec tout ce que les règles du profil permettent, en gardant l'accord des saveurs, la texture, la mâche et une cuisson adaptée ; la consigne signale une version inventée, à goûter.
- 2026-10-08 — Bas du panneau du profil : « Version du <date> · <6 premiers caractères de VERSION> », annoncée par le service worker qui a servi l'ouverture ; « Une mise à jour est prête : fermez puis rouvrez l'app » si une version plus récente arrive pendant la visite. Chaque pull request donne le code attendu.
- 2026-10-08 — Alignement app ↔ projet Claude : une seule source pour le format et les demandes, `docs/projet-claude.md`, fourni par l'app et versionné (`VERSION_INSTRUCTIONS`, entier qui augmente à chaque modification). Un décalage se voit des deux côtés : chaque demande copiée porte la version attendue (Claude refuse par une phrase fixe si ce n'est pas la sienne), chaque réponse porte la sienne (l'app prévient à l'aperçu), et l'app rappelle de recopier les instructions quand elles changent (version copiée retenue sur le téléphone et dans `reglages/foyer`, pour qu'une copie faite sur l'ordinateur éteigne aussi le rappel du téléphone). Le projet Claude ne réécrit jamais le format, même sur demande : il rédige une « PROPOSITION pour Claude Code », et l'app et les instructions évoluent ensemble. Le contexte du foyer (matériel, habitudes, enseigne) vit dans un fichier séparé du projet Claude, subordonné aux instructions ; les règles des profils viennent toujours des demandes de l'app.
- 2026-10-08 — Deux versions par profil, mer et végétale : on garde `paquet@1`, une variante gagne deux champs facultatifs, `style` (`mer` · `vegetal`) et `frigoJours` (obligatoire pour `mer`) ; les instructions du projet Claude passent en version 2, qui aligne l'app et le projet. Aucune migration écrite : une version sans style reçoit un style déduit à la lecture (`styleDe`). « Végétale » = végétarienne (ni viande, ni poisson, ni fruits de mer ; œufs et fromage permis). Styles attendus déduits du régime : « Pas de viande » → mer et végétale ; « Ni viande ni poisson » → végétale seule ; autre régime → une seule version, sans style. Fusion par (profil, style), qui affine le plan présenté : une version reçue remplace celle du même profil et du même style, les autres restent (Claude n'envoie que les versions à faire, une bonne version n'est jamais réécrite par accident) ; une version reçue sans style remplace toutes celles de son profil, sauf si elle effacerait une version d'un autre style pour un profil qui attend des styles (refusée, Claude doit dire laquelle c'est) ; une version d'un style que le profil n'attend plus (mer après un passage à « Ni viande ni poisson ») est remplacée par la prochaine version reçue pour lui. La version mer remplace une viande : un dessert, un accompagnement ou un plat sans viande (exclu seulement par un bouillon, une gélatine ou une graisse) n'attend que la version végétale. La restauration rend une version de chaque style qui manque. Reporté à T3 : choix Mer / Végétale au planning, liste de courses de la seule version choisie, alerte de conservation de la part au poisson.
- 2026-10-08 — « 💡 Idées de plats » (T2b+) : le bouton est sur Semaine, sous la semaine, pour le gestionnaire seulement (ni pour l'utilisatrice des courses, ni en aperçu « Repas et courses »). Claude répond par messages de 5 recettes : chaque message se colle dans « Ajouter des recettes », puis on lui écrit « suite » pour les 5 suivantes. Critères toujours demandés : plats originaux (pas les grands classiques) et faciles à faire en batch (préparation simple, se gardent 3 jours au frigo, se réchauffent bien, se congèlent de préférence). La feuille garde le nombre (5, 10 ou 15 ; 15 par défaut) et une envie facultative en texte libre. La demande donne aussi les appareils, les versions attendues, les plats adorés et ceux dits « Jamais », et tous les noms déjà dans l'app ; une idée qui porte le nom d'un plat qui a déjà sa recette n'est pas reprise. Instructions du projet Claude en version 3 (seule demande où Claude crée l'identifiant d'un plat).
- 2026-10-09 — Corbeille : les deux membres mettent un plat à la corbeille d'un toucher, sans confirmation, jamais automatiquement (annonce avec « Annuler »). Un plat de la corbeille disparaît partout (Plats, Découvrir, lots de versions, filtres, bilans ; plus tard semaine et propositions), mais reste dans « déjà dans l'app » de DEMANDE-IDEES pour que Claude ne le repropose pas, et son nom ne se recrée pas : on le remet. La corbeille s'ouvre en bas de l'écran Plats plutôt que dans Réglages, pour que l'utilisatrice des courses puisse remettre un plat ; « Vider la corbeille » (suppression définitive des plats et de leurs photos, demandes ouvertes closes) est réservé au gestionnaire, en ligne, avec une confirmation en deux temps. Un plat noté « Jamais » par tous les profils est seulement suggéré pour la corbeille (carte sur la fiche, bandeau dans Plats). La sauvegarde garde la marque de corbeille ; la restauration ne sort jamais un plat de la corbeille. Instructions du projet Claude inchangées (version 3).
