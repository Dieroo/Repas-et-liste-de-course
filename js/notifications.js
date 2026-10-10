// Envoi d'une notification ntfy (CLAUDE.md §7, T2e) : une requête « simple » au sens de CORS (POST, corps texte, aucun
// en-tête posé par l'app, donc pas de pré-vérification). Les options du message (titre, étiquette, priorité, lien) sont
// dans l'adresse (coeur/ntfy.js › adresseNotification). Ne lève jamais ; jamais attendue par un écran, sauf l'essai de
// Réglages.

/**
 * POST du texte vers l'adresse. `keepalive` : la requête finit même si l'app est fermée juste après le toucher (rien
 * n'est mis en file d'attente) ; pas de minuteur d'abandon, qui couperait aussi une requête qui aurait pu aboutir.
 * Ni cookie, ni adresse de la page d'origine (`referrerPolicy`).
 * → promesse de { ok, statut } ou { erreur: 'reseau' }.
 */
export async function envoyerNtfy(adresse, texte) {
  try {
    const reponse = await fetch(adresse, {
      method: 'POST',
      body: texte,
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      // Chrome ajoute lui-même l'en-tête `priority` (RFC 9218), que ntfy.sh lit avant `?priority=4` et n'ignore que
      // sous les formes `u=N` et `u=N, i`. Jamais la valeur 'low' : Chrome enverrait alors `priority: i`, que ntfy.sh
      // refuse (400).
      priority: 'high',
    });
    return { ok: reponse.ok, statut: reponse.status };
  } catch {
    return { erreur: 'reseau' };
  }
}
