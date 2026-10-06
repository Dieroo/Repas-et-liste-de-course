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
- Courses le samedi, commandées au **drive** depuis l'application de l'enseigne (pas d'API disponible) ; parfois en magasin. Batch cooking le dimanche.
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
- Une carte à la fois : chaque plat que la personne connectée n'a pas encore noté.
- Trois gestes : 👎 « Jamais » (note 0) · 👍 « Pourquoi pas » (3) · ❤️ « J'adore » (5). Étoiles fines ensuite sur la fiche.
- Sélecteur de profil pour noter à la place de l'enfant.

## 5. Arborescence

```
index.html
manifest.webmanifest
sw.js                     liste de précache à tenir à jour (vérifiée par tests/hors-ligne.test.js)
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
                          brouillon.js (modification en cours gardée sur le téléphone)
  coeur/                  logique pure : ni DOM ni Firebase
    roles.js              rôle de la personne connectée, écrans permis
    slug.js               identifiants et recherche sans accents
    plats.js              visuel, filtres, ajout par nom, affichage des quantités
    profils.js            validation et ordre des profils
    photo.js              dimensions et taille des photos
    compatibilite.js      règles, variantes, substitutions
    liste.js
    proposition.js
    batch.js
    congelateur.js
    paquet.js             format d'import : extraction, validation, plat visé, textes pour Claude
    edition.js            « Modifier » : libellés, natures, catalogue des produits connus, saisie d'un ingrédient, écritures
tests/                    node:test, fixtures génériques
firestore.rules           adresses en espaces réservés (<EMAIL_1>, <EMAIL_2>)
package.json              uniquement "type": "module" et le script de test
```

## 6. Modèle de données (Firestore, un seul foyer)

| Chemin | Contenu |
|---|---|
| `reglages/foyer` | `versionSchema: 1`, `gestionnaire` (e-mail), `debutSemaine`, `nbPlats {min, max}`, `dessertParSemaine` (0 ou 1), `frigoJoursDefaut` (3), `dureeBatchMaxMin`, `rayons[]` (ordre du parcours en magasin), `appareils[]`, `apero {actif, jour, nbSuggestions, incontournables[]}`, `drive {nom, urlRecherche}` (modèle contenant `{q}`), `notifications {ntfySujet}` |
| `profils/{id}` | `nom`, `email` (facultatif, sert à reconnaître la personne connectée), `ordre`, `repas {midis: [jours], soirs: [jours]}`, `coefPortion` (1 adulte, 0,5 enfant), `regles[]` (§7) |
| `plats/{id}` | fiche `paquet@1` (§8) + `notes {profilId: 0–5}` (0 = « jamais » : plus jamais proposé à ce profil), `derniereFois`, `vignette` (petite image ~10 Ko pour les listes et Découvrir, facultative), `majPar`, `majLe`, `modifieeLe` et `modifieePar` (posés par « Modifier », effacés quand une recette de Claude remplace ou complète la fiche). « Modifier » écrit par `update` les seuls champs touchés : portions et ingrédients toujours ensemble, `conservation` sous-champ par sous-champ |
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
1. variante explicite de la fiche pour ce profil (`variantes[].pour`) ;
2. règle `substitution` du profil, si elle couvre **tous** les ingrédients fautifs et que le plat n'est pas dans `sauf` : variante automatique, ses ingrédients `par` vont dans la liste pour les portions de ce profil ;
3. sinon **« variante à créer »** : le plat reste sélectionnable pour ce profil ; à l'affectation, une `demande` est créée.

Sens inverse : un plat sans viande ni poisson affecté à un profil qui a `proteineChaqueRepas` → l'app propose sa variante « avec viande ou poisson » si la fiche en a une, sinon crée une `demande` (`besoin: avec_proteine`).

**Demandes et notification**
- Badge « Demandes » sur l'accueil du gestionnaire, mis à jour en temps réel ; écran Demandes avec bouton « Demander à Claude » (texte §8).
- Plat ajouté par son nom (⏳) par l'utilisatrice des courses → `demande` `type: "recette"` ; elle passe `traitee` dès que la fiche reçoit ses ingrédients (import ou « Modifier »).
- Si `notifications.ntfySujet` est défini et que la demande vient d'un autre membre que le gestionnaire : `fetch('https://ntfy.sh/' + sujet, { method: 'POST', body })` avec `body` = `Recette à ajouter : <plat> — version <profil>` (variante) ou `Recette à ajouter : <plat>` (recette). Message minimal, rien d'autre. Échec silencieux (la demande reste visible dans l'app).
- Une demande passe `traitee` dès que la fiche reçoit la variante (import).

## 8. Format d'import `paquet@1`

Un seul format pour le catalogue de départ, l'import unitaire (recette produite par le Projet Claude) et la sauvegarde. Import par collage **ou par fichier `.json`**. Clé principale : `plats`. Clés facultatives, pour la configuration et la sauvegarde complète : `reglages` (objet fusionné dans `reglages/foyer`), `profils` (`id`, `nom`, `email`, `ordre`, `coefPortion`, `repas`, `regles`), `produits`, `congelateur`, `semaines`. Chaque document est créé ou fusionné par `id` (champs absents conservés) ; une mise à jour de plat conserve `notes` et `derniereFois`.

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
| `variantes[]` | `pour` (id de profil), `retirer[]` (produits), `ajouter[]` (ingrédients avec `qtePortion` au lieu de `qte`), `consigne` |
| `source` | « Recette de … », « Version classique » ou URL d'inspiration |

Vocabulaires fermés :

- `unite` : `g` `kg` `ml` `cl` `l` `pc` `cs` `cc` `pincee` `botte` `sachet` `boite` `tranche`
- `rayon` : `fruits_legumes` `boucherie` `charcuterie` `poissonnerie` `cremerie` `fromages` `epicerie_salee` `epicerie_sucree` `boulangerie` `surgeles` `boissons` `hygiene` `entretien` `divers`
- `marqueurs` : `viande` `boeuf` `porc` `volaille` `agneau` `charcuterie` `poisson` `fruits_de_mer` `bouillon_viande` `gelatine_porc` `oeuf` `oeuf_cru` `laitier` `alcool_cru` `cafe` `legume` `feculent`
- `appareil` : `plaque` `four` `cookeo` `airfryer` `monsieur_cuisine`
- `forme` (viande) : `hachee` `fine` `morceaux` `effilochable`
- `role` (légume) : `principal` `incorpore`

`coeur/paquet.js` valide tout (types, bornes, vocabulaires) et renvoie des erreurs en français, ingrédient par ingrédient ; l'app affiche un aperçu avant d'enregistrer. Un plat `attente` est accepté sans ingrédients. Les photos (`photos/`, `vignette`) ne font pas partie de `paquet@1` : ni import ni export (taille). Un plat ajouté par son nom n'enregistre que `id` et `nom` (écriture fusionnée, pour ne jamais écraser une recette créée entre-temps sur l'autre téléphone) : les champs absents valent leur défaut (`type` plat, `statutRecette` attente, `recurrence` aucune) et l'export les complète. Doublons repérés par le nom (slug du nom), pas par l'identifiant.

**Ajouter des recettes** (écran `#/import`, gestionnaire ; `#/import/<platId>` depuis « Coller la recette » d'une fiche) :
- Le gestionnaire colle la **réponse entière** de Claude : l'app y retrouve chaque objet `paquet@1` (prose, blocs de code, plusieurs blocs réunis). Elle distingue texte vide, demande recollée par erreur (`DEMANDE-…`), réponse coupée et absence de recette.
- Tolérances : casse, accents et séparateurs des vocabulaires fermés (`Incorporé` → `incorpore`), nombres écrits en texte (`"0,5"`), `produit` mis en minuscules. Champs inconnus, `notes`, `derniereFois` et clés autres que `plats` ignorés avec un avertissement (repris dans la tranche qui les utilise : notes et sauvegarde en T1d, réglages et profils ensuite).
- Grille : `id` et `nom` toujours ; `portionsBase` et `ingredients` sauf plat sans recette ; avec des ingrédients, le statut devient au moins `brouillon` ; `tempC` conseillé pour four et airfryer.
- Plat visé : la cible (une seule recette collée), sinon le même `id` s'il s'agit du même plat (même nom, plat ⏳, demande ouverte, ou fiche modifiée à la main, donc peut-être renommée, sauf si un plat ⏳ ou une demande ouverte porte exactement le nom collé), sinon le même nom, sinon un nouveau plat (identifiant libre `-2` si un autre plat, déjà rempli, utilise le sien). Deux recettes visant le même plat : erreur.
- Écriture : seulement les champs présents (`mergeFields`), jamais `vignette` ni `notes`, jamais de table vide ni de valeur `undefined` ; demandes satisfaites closes dans un second lot (`update`, `statut: traitee`, `traiteeLe`).
- Fiche modifiée à la main (`modifieePar`) : l'aperçu annonce « Remplace les modifications faites à la main le … » ; la recette remplacée ou complétée efface `modifieeLe` et `modifieePar`.
- Tout ou rien : la moindre erreur bloque l'enregistrement ; « Copier les corrections pour Claude » copie un texte avec les codes exacts. Les messages affichés n'emploient aucun mot technique (§4) ; le texte collé n'est jamais affiché.

```
CORRECTION paquet@1
id: <id du plat>
- <consigne avec les codes exacts>
(Rends la fiche complète corrigée, en un seul bloc.)
```

Textes copiés par les boutons « Demander à Claude » (gestionnaire uniquement) :

```
DEMANDE-RECETTE paquet@1
id: <id du plat>
nom: <nom du plat>
(Ajoute un lien, une photo ou la recette dictée.)
```

```
DEMANDE-VARIANTE paquet@1
id: <id du plat>
nom: <nom du plat>
pour: <id du profil>
besoin: sans_viande | avec_proteine
(Rends la fiche complète avec la nouvelle variante.)
```

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
4. Score = moyenne des notes des profils concernés (non noté = 3) + bonus d'ancienneté (semaines depuis `derniereFois`, plafonné) − malus si servi la semaine précédente − malus ⚠️ (plus fort pour « variante à créer ») − malus des règles `preference` déclenchées + bruit faible (graine fixe en test).
5. Apéro : `apero.nbSuggestions` fiches `apero` compatibles avec tous les profils (ou adaptables), jamais les mêmes deux semaines de suite.
6. Glouton + amélioration locale (le problème est minuscule). Tout reste modifiable à la main : verrouiller, échanger, réaffecter, choisir une variante.
7. Chaque plat proposé affiche le pictogramme de son mode de cuisson principal (§4).

**Batch (`batch.js`)** — regrouper par appareil puis température ; four : 2 plats simultanés si écart ≤ 10 °C ; plaques : 4 en parallèle ; cookeo et airfryer : 1 à la fois. Les variantes (ex. part au saumon) apparaissent comme petites préparations à part. Durée estimée = file d'appareil la plus longue + temps actif ; alerte au-delà de `dureeBatchMaxMin`. « Batch terminé » → `portionsACongeler` ajoutées au congélateur.

**Congélateur (`congelateur.js`)** — ajout par le batch ou à la main ; retrait quand une semaine qui l'utilise passe `validee` ; alerte qualité au-delà de 90 jours.

## 10. Écrans

1. **Semaine** (accueil) : ce soir pour chacun, carte « prochaine action », grille jours × profils (chaque plat avec le pictogramme de son mode de cuisson principal, §4), apéro du week-end, « Proposer » (les deux membres), « Imprimer » (menu de la semaine et apéro, puis liste de courses par rayon, sur une page pensée pour l'impression ; `window.print()` → « Enregistrer au format PDF » de Chrome, à envoyer), badges ⏳ et Demandes (gestionnaire).
2. **Courses** : bascule Drive / Magasin, grandes cases à cocher, ajout rapide, origine visible (plat, apéro, habituel).
3. **Plats** : recherche, filtres (type, statut, compatibilité), ★ par profil, pictogramme du mode de cuisson principal, ajout par nom (→ ⏳ et demande de recette).
4. **Découvrir** : §4.
5. **Fiche** : photo (prise ou choisie, les deux membres), recette, badges (dont le mode de cuisson principal et sa durée) et variantes par profil, cuisson, conservation ; « Modifier » ; « Demander à Claude » et « Coller la recette » (gestionnaire).
   - Fiche en lecture, un seul bouton « ✏️ Modifier la recette » (les deux membres ; « Écrire la recette moi-même » sur un plat ⏳) → écran `#/modifier/<id>` : nom, type, portions (« Ces quantités sont pour N portions »), ingrédients (ajouter, retirer, quantité, unité, nature), étapes (ajouter, déplacer, retirer), cuisson principale (« Cuit surtout au » + durée), jours au frigo, congélation, boîte à emporter, « Recette vérifiée ». Restent à Claude : variantes, temps de travail, source, récurrence, étapes de cuisson secondaires.
   - Une seule barre « Enregistrer » (onglets masqués). Seuls les champs touchés sont écrits ; un bandeau prévient si l'autre téléphone a changé l'un d'eux entre-temps. La modification en cours est gardée sur le téléphone (`localStorage`, par compte et par plat) jusqu'à l'enregistrement, l'annulation ou la déconnexion : la fiche propose alors « Reprendre ».
   - Ajout d'un ingrédient : suggestions dès les premières lettres, tirées de tous les ingrédients déjà connus, unité, rayon et nature préremplis ; pour un produit jamais vu, une question « Viande / Poisson / Légume / Autre » (viande « en morceaux », légume « fondu dans le plat » par défaut, modifiables dans « Plus de précisions »).
6. **Batch du dimanche**, **Congélateur**, **Demandes** (gestionnaire), **Réglages** (gestionnaire : profils et règles, appareils, rayons, habituels, apéro, drive, notifications, ajout de recettes, sauvegarde).

## 11. Tranches

| | Contenu | Fini quand |
|---|---|---|
| T0 Socle | PWA installable, connexion Google, refus propre si adresse non autorisée, rôles, tokens et navigation du §4, indicateur hors ligne | Installée sur les 2 téléphones ; l'app s'ouvre en mode avion ; l'utilisatrice des courses trouve l'écran beau |
| T1 Plats, import & Découvrir | Profils, bibliothèque, fiche, pictogramme du mode de cuisson, ajout par nom (+ demande de recette), notes 0–5, écran Découvrir, modification d'une fiche par les deux membres, photo de la fiche (prise ou choisie, compressée, par les deux membres), import (collage ou fichier) et export, « Demander à Claude » | Catalogue de départ importé ; les deux adultes ont trié des plats dans Découvrir ; une note posée sur un téléphone apparaît en direct sur l'autre |
| T2 Compatibilité & variantes | Règles des profils, substitutions, `compatibilite.js` + tests, badges, demandes, notification ntfy (variantes et recettes à ajouter) | Un plat aux lardons passe en ⚠️ « version saumon » pour le profil concerné ; une variante manquante déclenche une demande et une notification |
| T3 Semaine, liste & apéro | Sélection manuelle, pictogramme de cuisson sur la grille, personnes (adultes, enfants) et repas par plat, choix des variantes, apéro, `liste.js` + tests, placard, modes Drive et Magasin, « Courses terminées », « Imprimer » (menu + liste en PDF via le navigateur) | Une vraie commande drive préparée avec l'app |
| T4 Congélateur & proposition | Stock, `congelateur.js` et `proposition.js` + tests, « Proposer » (repas et apéro, avec le pictogramme de cuisson de chaque plat proposé) + ajustements | « Proposer » couvre tous les repas de chacun, fin de semaine par le congélateur |
| T5 Batch | `batch.js` + tests, vue par appareil, « Batch terminé » | Un vrai dimanche préparé avec l'écran batch |

V2 (après 4 à 6 samedis d'historique) : produits « probablement manquants » (rythme d'achat par produit), plan de cuisson minuté, statistiques.

## 12. Conventions

- Tout en français : interface, noms métier, commentaires, messages de commit.
- Contenu utilisateur inséré avec `textContent`, jamais `innerHTML`.
- HTML sémantique, cibles tactiles ≥ 48 px, contraste AA, mode sombre via `prefers-color-scheme`.
- `js/coeur/` sans DOM ni Firebase ; chaque fonction testée.
- Un abonnement `onSnapshot` par requête, créé une fois ; écritures uniquement sur action de l'utilisateur.
- États visibles : chargement, vide, hors ligne, accès refusé, import invalide.
- Petits commits ; mettre à jour §14 à chaque fin de tranche.

## 13. Mise en place (actions du propriétaire, hors Claude Code)

1. GitHub : créer le dépôt public avec un README, puis Settings → Pages → *Deploy from a branch* → `main` / racine.
2. console.firebase.google.com : créer un projet (Analytics inutile) → ajouter une application Web → copier `firebaseConfig` (public par nature ; il va dans `js/firebase.js`).
3. Firestore Database : créer la base en mode production, région Europe ; onglet Règles : coller les règles du §6 avec les deux adresses réelles, en minuscules.
4. Authentication : activer le fournisseur Google ; Paramètres → Domaines autorisés → ajouter `<pseudo>.github.io`.
5. Facultatif (T2) : installer l'app ntfy sur le téléphone du gestionnaire, s'abonner à un sujet long et aléatoire, saisir ce sujet dans Réglages.

## 14. Statut

- [x] T0 Socle — validé le 2026-10-05 sur le téléphone du gestionnaire (connexion, rôles, installation, mode avion) ; installation et avis sur le téléphone de l'utilisatrice des courses reportés à la fin du projet (décision du propriétaire)
- [ ] T1 Plats, import & Découvrir — en trois livraisons :
  - [x] T1a profils, bibliothèque, fiche, ajout par nom (+ demande de recette), photo (appareil ou galerie), aperçu de la vue « Repas et courses » — publié et essayé sur le téléphone du gestionnaire le 2026-10-05
  - [x] T1b « Ajouter des recettes » (coller la réponse de Claude, aperçu, enregistrement), « Demander à Claude » et « Coller la recette » sur la fiche — publié et essayé sur le téléphone du gestionnaire le 2026-10-05
  - [ ] T1c-1 pictogramme du mode de cuisson principal (liste des plats, fiche) — fusionné le 2026-10-05 ; mise en ligne retardée par un incident GitHub Actions, essai sur téléphone à faire
  - [ ] T1c-2 « Modifier » une recette (les deux membres) et « Recette vérifiée » — pull request ouverte le 2026-10-06, essai sur téléphone à faire
  - [ ] T1d notes 0–5, Découvrir, sauvegarde et restauration par fichier ; le critère « Fini quand » de T1 se vérifie ici
- [ ] T2 Compatibilité & variantes
- [ ] T3 Semaine, liste & apéro
- [ ] T4 Congélateur & proposition
- [ ] T5 Batch

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
- 2026-10-06 — « Modifier » : la modification en cours est gardée dans `localStorage` (Android vide `sessionStorage` quand l'app est fermée depuis les applis récentes) ; portions et ingrédients s'écrivent toujours ensemble (les quantités valent pour le nombre de portions affiché) ; `conservation` est écrite sous-champ par sous-champ (l'autre sous-champ, changé ailleurs, reste) ; la cuisson principale se règle sur l'étape la plus longue de la fiche, les autres étapes restent celles de Claude. Les bancs d'essai navigateur (Playwright, faux Firebase) vivent dans la session de travail, hors du dépôt ; ils sont rejoués à chaque livraison (T0, T1a, T1b, T1c-1, T1c-2).
- 2026-10-05 — Pictogramme du mode de cuisson principal à côté de chaque plat, puis sur les plats de la semaine et les suggestions de « Proposer » (§4). Dessins au trait propres à l'app, validés par le propriétaire sur description, toujours accompagnés du nom de l'appareil ; livrés à part (T1c-1), avant « Modifier ».
