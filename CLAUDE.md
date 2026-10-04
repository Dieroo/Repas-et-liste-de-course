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

## 2. Contexte d'usage

- 2 adultes, Android + Chrome, comptes Google. 3 profils : les 2 adultes et 1 jeune enfant (noté par ses parents).
- Deux rôles, déduits de l'adresse e-mail connectée : le **gestionnaire** (planification, recettes, réglages, demandes) et l'**utilisatrice des courses** (vue simplifiée).
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
| Auth | Firebase Auth, fournisseur Google (`signInWithPopup`, repli `signInWithRedirect`) | Comptes existants |
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
- Vue simplifiée pour l'utilisatrice des courses : ni import, ni réglages, ni « Demander à Claude ».

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
                          + dom.js (outils DOM), connexion.js (écrans avant l'app), profil.js (avatar, panneau du profil)
  coeur/                  logique pure : ni DOM ni Firebase
    roles.js              rôle de la personne connectée, écrans permis
    compatibilite.js      règles, variantes, substitutions
    liste.js
    proposition.js
    batch.js
    congelateur.js
    paquet.js             validation du format d'import
tests/                    node:test, fixtures génériques
firestore.rules           adresses en espaces réservés (<EMAIL_1>, <EMAIL_2>)
package.json              uniquement "type": "module" et le script de test
```

## 6. Modèle de données (Firestore, un seul foyer)

| Chemin | Contenu |
|---|---|
| `reglages/foyer` | `versionSchema: 1`, `gestionnaire` (e-mail), `debutSemaine`, `nbPlats {min, max}`, `dessertParSemaine` (0 ou 1), `frigoJoursDefaut` (3), `dureeBatchMaxMin`, `rayons[]` (ordre du parcours en magasin), `appareils[]`, `apero {actif, jour, nbSuggestions, incontournables[]}`, `drive {nom, urlRecherche}` (modèle contenant `{q}`), `notifications {ntfySujet}` |
| `profils/{id}` | `nom`, `email` (facultatif, sert à reconnaître la personne connectée), `ordre`, `repas {midis: [jours], soirs: [jours]}`, `coefPortion` (1 adulte, 0,5 enfant), `regles[]` (§7) |
| `plats/{id}` | fiche `paquet@1` (§8) + `notes {profilId: 0–5}` (0 = « jamais » : plus jamais proposé à ce profil), `derniereFois`, `vignette` (petite image ~10 Ko pour les listes et Découvrir, facultative), `majPar`, `majLe` |
| `photos/{platId}` | `image` (JPEG compressé dans le navigateur, 1024 px max, ~200 Ko max), `majPar`, `majLe` ; lu seulement à l'ouverture de la fiche, pour que la liste des plats reste légère |
| `produits/{id}` | `nom`, `rayon`, `uniteDefaut`, `marqueurs[]`, `habituel {actif, qte, unite}`, `rechercheDrive` (terme de recherche personnalisé, facultatif), `achats[]` (dates, V2) |
| `semaines/{dimancheISO}` | `statut` (`brouillon` → `validee` → `courses_faites` → `batch_fait`), `plats [{platId, portionsACuire, portionsACongeler}]`, `affectations {profilId: {"lun-soir": {platId, variante} ou {congelId}}}`, `apero {jour, platIds[]}`, `majPar`, `majLe` |
| `semaines/{dimancheISO}/lignes/{cle}` | `produitId`, `libelle`, `qte`, `unite`, `rayon`, `sources [{type: plat, apero, habituel ou manuel, ref, pour}]`, `special` (vrai si lié aux plats ou à l'apéro de la semaine), `coche`, `manuel` |
| `congelateur/{id}` | `platId`, `nom`, `portions`, `dateCongelation` |
| `demandes/{id}` | `type: "variante"`, `platId`, `profilId`, `besoin` (`sans_viande` ou `avec_proteine`), `creePar`, `creeLe`, `statut` (`ouverte` ou `traitee`) |

- Jours : `dim` `lun` `mar` `mer` `jeu` `ven` `sam` ; moments : `midi` `soir`.
- Identifiants : `plats` et `produits` = slug du nom (`carbonade-flamande`), stables. `demandes` : `platId__profilId` (une seule demande ouverte par plat et profil).
- **Une ligne de liste = un document** : deux personnes peuvent cocher en même temps sans conflit. `cle` = `produitId__unite` pour les lignes générées, aléatoire pour les manuelles.
- `appareils[]` par défaut : `plaque` ×4 · `four` ×1 (2 plats simultanés si même température) · `cookeo` ×1 · `airfryer` ×1 · `monsieur_cuisine` (inactif).

Règles Firestore (version réelle collée dans la console, jamais commitée avec les vraies adresses) :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
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
- Si `notifications.ntfySujet` est défini et que la demande vient d'un autre membre que le gestionnaire : `fetch('https://ntfy.sh/' + sujet, { method: 'POST', body: 'Recette à ajouter : <plat> — version <profil>' })`. Message minimal, rien d'autre. Échec silencieux (la demande reste visible dans l'app).
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
          "pour": "profil_b",
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
| `statutRecette` | `attente` (⏳ nom seul, sans ingrédients) · `brouillon` (📝 version classique à faire corriger) · `validee` (✅) |
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

`coeur/paquet.js` valide tout (types, bornes, vocabulaires) et renvoie des erreurs en français, ingrédient par ingrédient ; l'app affiche un aperçu avant d'enregistrer. Un plat `attente` est accepté sans ingrédients. Les photos (`photos/`, `vignette`) ne font pas partie de `paquet@1` : ni import ni export (taille).

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
1. Par plat retenu : facteur = (`portionsACuire` + `portionsACongeler`) / `portionsBase` ; chaque ingrédient × facteur.
2. Variantes (explicites ou automatiques) : `ajouter` ou `par` × portions du profil concerné (× `coefPortion`) ; `retirer` ignoré dans les quantités (léger surplus assumé). Ligne étiquetée « pour <profil> ».
3. Apéro de la semaine : ingrédients des fiches `apero` choisies + `apero.incontournables`.
4. Préparations `hebdo` et habituels actifs ajoutés.
5. Agrégation par produit et famille d'unités (g↔kg, ml↔cl↔l) ; `pc` arrondi au supérieur.
6. Recalcul à chaque changement : lignes générées réécrites, `coche` conservé par `cle`, lignes manuelles jamais touchées.
7. Deux affichages, mémorisés par personne :
   - **Drive** : « Spécial cette semaine » (`special`) puis « Habituels » ; chaque ligne a un bouton 🔍 qui ouvre `drive.urlRecherche` en remplaçant `{q}` par `encodeURIComponent(rechercheDrive || nom)`. Depuis la ligne, « Modifier la recherche » enregistre `rechercheDrive` sur le produit (ex. « pâtes courtes » → « penne ») : le bon terme sert toutes les semaines suivantes.
   - **Magasin** : par rayon (ordre des réglages), lignes cochées en bas, fonctionne hors ligne.
8. Un plat ⏳ sélectionné n'apporte aucune ligne : bandeau « ingrédients à ajouter à la main ».

**Proposition (`proposition.js`)**
1. Créneaux = repas de chaque profil sur la semaine, pondérés par `coefPortion`.
2. Créneaux au-delà de `frigoJours` après le batch → congélateur d'abord (portions les plus anciennes, plats compatibles) ; si le stock manque, augmenter `portionsACongeler` d'un plat congelable.
3. Créneaux restants → entre `nbPlats.min` et `nbPlats.max` plats (hors ⏳) couvrant chaque créneau par un plat ✅ ou ⚠️ pour son profil. Note 0 = jamais proposé à ce profil.
4. Score = moyenne des notes des profils concernés (non noté = 3) + bonus d'ancienneté (semaines depuis `derniereFois`, plafonné) − malus si servi la semaine précédente − malus ⚠️ (plus fort pour « variante à créer ») − malus des règles `preference` déclenchées + bruit faible (graine fixe en test).
5. Apéro : `apero.nbSuggestions` fiches `apero` compatibles avec tous les profils (ou adaptables), jamais les mêmes deux semaines de suite.
6. Glouton + amélioration locale (le problème est minuscule). Tout reste modifiable à la main : verrouiller, échanger, réaffecter, choisir une variante.

**Batch (`batch.js`)** — regrouper par appareil puis température ; four : 2 plats simultanés si écart ≤ 10 °C ; plaques : 4 en parallèle ; cookeo et airfryer : 1 à la fois. Les variantes (ex. part au saumon) apparaissent comme petites préparations à part. Durée estimée = file d'appareil la plus longue + temps actif ; alerte au-delà de `dureeBatchMaxMin`. « Batch terminé » → `portionsACongeler` ajoutées au congélateur.

**Congélateur (`congelateur.js`)** — ajout par le batch ou à la main ; retrait quand une semaine qui l'utilise passe `validee` ; alerte qualité au-delà de 90 jours.

## 10. Écrans

1. **Semaine** (accueil) : ce soir pour chacun, carte « prochaine action », grille jours × profils, apéro du week-end, « Proposer », badges ⏳ et Demandes (gestionnaire).
2. **Courses** : bascule Drive / Magasin, grandes cases à cocher, ajout rapide, origine visible (plat, apéro, habituel).
3. **Plats** : recherche, filtres (type, statut, compatibilité), ★ par profil, ajout par nom (→ ⏳).
4. **Découvrir** : §4.
5. **Fiche** : recette, badges et variantes par profil, cuisson, conservation ; « Modifier » ; « Demander à Claude » et « Coller la recette » (gestionnaire).
6. **Batch du dimanche**, **Congélateur**, **Demandes** (gestionnaire), **Réglages** (gestionnaire : profils et règles, appareils, rayons, habituels, apéro, drive, notifications, ajout de recettes, sauvegarde).

## 11. Tranches

| | Contenu | Fini quand |
|---|---|---|
| T0 Socle | PWA installable, connexion Google, refus propre si adresse non autorisée, rôles, tokens et navigation du §4, indicateur hors ligne | Installée sur les 2 téléphones ; l'app s'ouvre en mode avion ; l'utilisatrice des courses trouve l'écran beau |
| T1 Plats, import & Découvrir | Profils, bibliothèque, fiche, ajout par nom, notes 0–5, écran Découvrir, édition simple d'une fiche, photo de la fiche (prise ou choisie, compressée), import (collage ou fichier) et export, « Demander à Claude » | Catalogue de départ importé ; les deux adultes ont trié des plats dans Découvrir ; une note posée sur un téléphone apparaît en direct sur l'autre |
| T2 Compatibilité & variantes | Règles des profils, substitutions, `compatibilite.js` + tests, badges, demandes, notification ntfy | Un plat aux lardons passe en ⚠️ « version saumon » pour le profil concerné ; une variante manquante déclenche une demande et une notification |
| T3 Semaine, liste & apéro | Sélection manuelle, choix des variantes, apéro, `liste.js` + tests, modes Drive et Magasin, « Courses terminées » | Une vraie commande drive préparée avec l'app |
| T4 Congélateur & proposition | Stock, `congelateur.js` et `proposition.js` + tests, « Proposer » (repas et apéro) + ajustements | « Proposer » couvre tous les repas de chacun, fin de semaine par le congélateur |
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
3. Firestore Database : créer la base en mode production, région Europe ; onglet Règles : coller les règles du §6 avec les deux adresses réelles.
4. Authentication : activer le fournisseur Google ; Paramètres → Domaines autorisés → ajouter `<pseudo>.github.io`.
5. Facultatif (T2) : installer l'app ntfy sur le téléphone du gestionnaire, s'abonner à un sujet long et aléatoire, saisir ce sujet dans Réglages.

## 14. Statut

- [ ] T0 Socle
- [ ] T1 Plats, import & Découvrir
- [ ] T2 Compatibilité & variantes
- [ ] T3 Semaine, liste & apéro
- [ ] T4 Congélateur & proposition
- [ ] T5 Batch

Décisions :
- 2026-10-04 — Stack validée : PWA vanilla + Firestore + GitHub Pages. Recettes produites par un Projet Claude au format `paquet@1`.
- 2026-10-05 — Apéro hebdomadaire ; variantes automatiques par substitution et demandes de variante notifiées (ntfy) ; mode Drive sans API (lien de recherche) ; direction visuelle « cuisine familiale » ; écran Découvrir ; vue simplifiée pour l'utilisatrice des courses.
- 2026-10-05 — Gestionnaire désigné à la première ouverture : tant que `reglages/foyer` n'existe pas, « C'est moi qui planifie » le crée (transaction, jamais d'écrasement). Mise en ligne : pull request de la branche de travail vers `main`, fusionnée par le propriétaire.
- 2026-10-05 — Photo par recette avancée de V2 à T1 : image compressée dans `photos/{platId}` (Firestore ; Firebase Storage demanderait le forfait payant Blaze), vignette légère dans la fiche ; photos hors `paquet@1`.
