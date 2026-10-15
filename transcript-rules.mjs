// Nettoyage de la transcription brute renvoyee par Groq/Whisper : grammaire,
// ponctuation et orthographe corrigees, tout en conservant exactement les
// hesitations (euh, hmm, mhm...) et les repetitions de mots reels, qui
// restent necessaires a l'utilisateur.
//
// Historique : ce fichier contenait auparavant un pipeline verbatim (marqueurs
// [fp]/(())/{{}}, hesitations canonisees, zero correction) implementant un
// guideline client de transcription mot pour mot. Ce mode a ete remplace par
// une demande explicite de l'utilisateur ; l'ancien code reste consultable
// dans l'historique git (commit 1855f0b) si le besoin verbatim revient.
//
// Pourquoi un second appel a un modele de langage et pas des regex : retirer
// un mot d'hesitation proprement (sans virgule orpheline, sans double espace,
// sans casser la structure de la phrase) exige de reconstruire une phrase
// grammaticalement coherente - exactement le meme probleme que la correction
// de grammaire elle-meme. Aucune regle de texte deterministe ne fait ca de
// facon fiable ; un LLM le fait en une passe.
//
// Risque assume : contrairement au pipeline verbatim (deterministe), un LLM
// peut lui-meme halluciner ou substituer un mot en reecrivant le texte. C'est
// un compromis accepte ici puisque l'objectif n'est plus des donnees
// d'entrainement fideles a l'audio, mais un texte lisible.

export const CLEANUP_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `Tu es un correcteur de transcription audio en français. On te donne la transcription brute d'un enregistrement. Réécris-la en respectant strictement ces règles :
- Corrige la grammaire, la conjugaison et l'orthographe.
- Ajoute une ponctuation de phrase correcte (virgules, points, points d'interrogation/exclamation) et les majuscules appropriées (début de phrase, noms propres).
- Conserve toutes les hésitations et signaux d'écoute oraux (euh, hmm, mhm, uh-huh, mm-mm, nan-nan, oh, ouh, euhm, etc.) exactement là où ils se produisent dans le texte source. Ne les supprime pas, ne les déplace pas, et n'en invente pas qui seraient absentes du texte source. Écris-les avec l'orthographe indiquée ici quand tu reconnais le son correspondant.
- Supprime uniquement les faux départs incomplets (un mot tronqué remplacé par sa version complète juste après).
- Ne supprime JAMAIS la répétition d'un mot réel (ex. « tu tu tu veux », « je je je crois », « on on on y va ») : transcris-la exactement telle qu'elle apparaît dans le texte source, avec le même nombre d'occurrences, même si la phrase semble redondante. N'invente pas non plus de répétition absente du texte source.
- Ne change jamais le sens du propos : ne résume pas, ne reformule pas le fond, n'ajoute aucune information absente du texte source. Garde tous les mots porteurs de sens.
- Réponds uniquement avec le texte corrigé, sans aucun commentaire ni introduction.`;

// Reecrit rawText (sortie brute de Whisper) en texte propre via un modele de
// langage heberge sur Groq (meme cle API que la transcription audio).
export async function cleanupTranscript(rawText, apiKey) {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return '';

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CLEANUP_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: trimmed },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur du modèle de nettoyage (${response.status}) : ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || trimmed;
}
