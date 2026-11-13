// Post-traitement de la transcription brute renvoyee par Groq/Whisper.
//
// Historique : un premier pipeline verbatim (markers [fp]/(())/{{}}, minuscules,
// ponctuation retiree) a ete remplace par un nettoyage via LLM (grammaire/
// ponctuation/orthographe corrigees). Ce nettoyage LLM s'est revele peu fiable :
// sur un exemple reel, il a supprime un "alors" repete, un "euh" et une
// repetition de clause malgre des instructions explicites de les garder - un
// LLM qui reecrit un texte a une tendance naturelle a "nettoyer" les
// disfluences meme quand on lui demande explicitement de ne pas le faire.
//
// Approche actuelle : retour a un pipeline deterministe (code, pas IA) qui ne
// peut PAS oublier un mot puisqu'il ne fait que des remplacements cibles sur
// le texte existant, jamais de reecriture globale. Difference avec l'ancien
// pipeline verbatim : on NE force plus les minuscules et on NE retire PLUS la
// ponctuation - la casse et la ponctuation naturelles de Whisper sont
// conservees telles quelles.

const FIXED_HESITATIONS = ['mhm', 'uh-huh', 'hmm', 'euh', 'euhm', 'mm-mm', 'nan-nan', 'oh', 'ouh'];

// Echantillon de style passe au parametre "prompt" de l'API Whisper pour
// inciter le modele a conserver les hesitations plutot que de lisser la
// transcription (reduit le risque d'OMISSION d'un "euh"/"hmm" reellement
// prononce, avant meme que notre code ne voie le texte).
export const DISFLUENCY_PRIMING_PROMPT = "Euh, alors, je dirais que, hmm, c'est-à-dire, mhm, voilà, enfin bref.";

// Variantes courantes que Whisper sort en texte libre -> forme fixe du client.
// Liste volontairement limitee a des sons non lexicaux sans ambiguite ; on
// prefere sous-detecter que de reecrire un vrai mot par erreur.
const HESITATION_VARIANTS = [
  { canonical: 'euhm', pattern: /\b(euhm+|euhhm+|eum+)\b/gi },
  { canonical: 'euh', pattern: /\b(euh+|eeuh+|euuh+|heu+)\b/gi },
  { canonical: 'hmm', pattern: /\b(hum+|hm+)\b/gi },
  { canonical: 'mhm', pattern: /\b(mhm+|mmh+)\b/gi },
  { canonical: 'uh-huh', pattern: /\b(uh[\s-]?huh)\b/gi },
  { canonical: 'mm-mm', pattern: /\b(mm[\s-]?mm)\b/gi },
  { canonical: 'nan-nan', pattern: /\b(nan[\s-]?nan)\b/gi },
  { canonical: 'oh', pattern: /\boh+\b/gi },
  { canonical: 'ouh', pattern: /\bouh+\b/gi },
];

// Sons de type hesitation clairement non lexicaux mais absents des 9 formes
// fixes -> [fp]. Liste conservatrice : "bah"/"ben"/"hein" sont de vrais mots
// du discours francais, on ne les touche pas pour eviter les faux positifs.
const UNKNOWN_HESITATION_TO_FP = /\b(pff+|tss+|hmpf+)\b/gi;

export function canonicalizeHesitations(text) {
  let result = text;
  for (const { canonical, pattern } of HESITATION_VARIANTS) {
    result = result.replace(pattern, canonical);
  }
  result = result.replace(UNKNOWN_HESITATION_TO_FP, '[fp]');
  // Si deux pauses pleines [fp] se suivent, on ne transcrit [fp] qu'une seule
  // fois (contrairement aux repetitions de mots reels, qui doivent elles
  // etre conservees).
  result = result.replace(/\[fp\](?:\s+\[fp\])+/gi, '[fp]');
  return result;
}

// Remplacement de caractere sans risque de perte de contenu : uniformise
// l'apostrophe courbe en apostrophe droite. On NE touche pas a la casse ni a
// la ponctuation de phrase - celles-ci restent telles que Whisper les a
// produites. Les chiffres, chiffres romains et % sont en revanche ecrits en
// lettres (voir spellOutNumbersAndSymbols plus bas), a la demande explicite
// de l'utilisateur.
export function straightenApostrophes(text) {
  return text.replace(/’/g, "'");
}

export function numberToFrenchWords(num) {
  num = parseInt(num, 10);
  if (isNaN(num)) return String(num);
  if (num === 0) return 'zéro';
  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tensWords = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

  function twoDigits(n) {
    if (n === 0) return '';
    if (n < 10) return units[n];
    if (n < 20) return teens[n - 10];
    if (n < 70) {
      const ten = Math.floor(n / 10), unit = n % 10;
      const base = tensWords[ten];
      if (unit === 0) return base;
      if (unit === 1) return base + '-et-un';
      return base + '-' + units[unit];
    }
    if (n < 80) {
      const rem = n - 60;
      if (rem === 11) return 'soixante-et-onze';
      return 'soixante-' + (rem < 10 ? units[rem] : teens[rem - 10]);
    }
    if (n < 90) {
      const rem = n - 80;
      if (rem === 0) return 'quatre-vingts';
      return 'quatre-vingt-' + units[rem];
    }
    const rem = n - 80;
    return 'quatre-vingt-' + teens[rem - 10];
  }

  function underThousand(n) {
    if (n < 100) return twoDigits(n);
    const h = Math.floor(n / 100), r = n % 100;
    if (r === 0) return h === 1 ? 'cent' : units[h] + '-cents';
    return (h === 1 ? 'cent' : units[h] + '-cent') + '-' + twoDigits(r);
  }

  let n = num, parts = [];
  const billions = Math.floor(n / 1e9); n %= 1e9;
  const millions = Math.floor(n / 1e6); n %= 1e6;
  const thousands = Math.floor(n / 1e3); n %= 1e3;
  const rest = n;
  if (billions) parts.push((billions === 1 ? 'un' : underThousand(billions)) + '-milliard' + (billions > 1 ? 's' : ''));
  if (millions) parts.push((millions === 1 ? 'un' : underThousand(millions)) + '-million' + (millions > 1 ? 's' : ''));
  if (thousands) parts.push(thousands === 1 ? 'mille' : underThousand(thousands) + '-mille');
  if (rest) parts.push(underThousand(rest));
  return parts.join('-').replace(/-/g, ' ');
}

// Chiffres romains (II, III, IV, XIV, XVI...) -> mots francais. Convention
// standard pour les noms de monarques/papes/chapitres : "I" -> "premier",
// tout le reste en nombre cardinal ("Louis XIV" -> "louis quatorze"). Limite
// assumee : pas de distinction premier/premiere selon le genre, et les
// jetons d'une seule lettre (I, V, X...) ne sont pas convertis pour eviter
// de confondre une initiale isolee avec un chiffre romain.
const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_STRICT = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function romanToInt(roman) {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = ROMAN_VALUES[roman[i]];
    const next = ROMAN_VALUES[roman[i + 1]];
    if (next > current) total -= current;
    else total += current;
  }
  return total;
}

function convertRomanNumerals(text) {
  return text.replace(/\b[IVXLCDM]{2,}\b/g, (token) => {
    if (!ROMAN_STRICT.test(token)) return token;
    const value = romanToInt(token);
    if (!value) return token;
    return value === 1 ? 'premier' : numberToFrenchWords(value);
  });
}

// Forme francaise "Ier"/"Ire"/"Ière" (ex. "François Ier", "Elizabeth Ière")
// -> "premier"/"première". Cas explicite car le "I" seul n'est jamais
// converti par convertRomanNumerals (trop ambigu sans ce suffixe).
function convertOrdinalFirst(text) {
  return text
    .replace(/\bI(?:ère|re)\b/g, 'première')
    .replace(/\bIer\b/g, 'premier');
}

// Ecrit en lettres les chiffres arabes, les chiffres romains et le symbole
// % - a la demande explicite de l'utilisateur. N'touche a aucun autre
// symbole (€, $, &...) qui n'a pas ete demande.
export function spellOutNumbersAndSymbols(text) {
  let result = text.replace(/\d+/g, (m) => numberToFrenchWords(m));
  result = convertOrdinalFirst(result);
  result = convertRomanNumerals(result);
  result = result.replace(/%/g, ' pour cent ');
  return result.replace(/[ \t]+/g, ' ').trim();
}

// Seuils heuristiques (a ajuster selon l'experience terrain) : un segment
// Whisper est considere "pas fiable" s'il est tres probablement du silence/
// bruit mal transcrit (no_speech_prob eleve) ou si le modele lui-meme avait
// peu confiance dans sa propre sortie (avg_logprob bas). Ces deux champs ne
// sont fournis que par response_format: 'verbose_json'.
const LOW_CONFIDENCE_NO_SPEECH_PROB = 0.5;
const LOW_CONFIDENCE_AVG_LOGPROB = -0.9;

function isLowConfidence(segment) {
  const { no_speech_prob, avg_logprob } = segment;
  if (typeof no_speech_prob === 'number' && no_speech_prob > LOW_CONFIDENCE_NO_SPEECH_PROB) return true;
  if (typeof avg_logprob === 'number' && avg_logprob < LOW_CONFIDENCE_AVG_LOGPROB) return true;
  return false;
}

// Generiques de sous-titrage que Whisper hallucine sur un passage de
// silence/bruit (residu de ses donnees d'entrainement) - jamais de la
// parole reelle. Contrairement a (()) qui suppose qu'il y avait quelque
// chose a entendre, on les supprime entierement. Le score de confiance ne
// suffit pas a les detecter : le modele peut etre "confiant" sur une
// hallucination connue.
const KNOWN_HALLUCINATIONS = [
  /sous-titrage\s+(?:société\s+)?radio-canada/i,
  /sous-titr(?:age|es?)\s+(?:réalisés?\s+)?par\s+la\s+communauté\s+d'amara\.org/i,
];

function isKnownHallucination(text) {
  return KNOWN_HALLUCINATIONS.some((pattern) => pattern.test(text));
}

// Construit le texte a partir des segments verbose_json, en entourant de
// (()) les segments jugs peu fiables - avec l'hypothese de Whisper a
// l'interieur, jamais vide tant qu'il y a du texte.
export function annotateLowConfidenceSegments(segments) {
  return segments
    .map((seg) => {
      const trimmed = (seg.text || '').trim();
      if (!trimmed || isKnownHallucination(trimmed)) return '';
      return isLowConfidence(seg) ? `((${trimmed}))` : trimmed;
    })
    .filter(Boolean)
    .join(' ');
}

// Point d'entree unique utilise par server.mjs et groq-transcribe.mjs :
// prend la reponse JSON brute de l'API Groq (verbose_json) et renvoie le
// texte final, avec la casse et la ponctuation naturelles de Whisper
// conservees intactes.
export function processGroqResponse(data) {
  let rawText = Array.isArray(data.segments) && data.segments.length > 0
    ? annotateLowConfidenceSegments(data.segments)
    : (data.text || '');
  // Filet de securite si jamais verbose_json n'est pas dispo (fallback texte
  // brut sans segments) : on retire quand meme les generiques hallucines.
  for (const pattern of KNOWN_HALLUCINATIONS) {
    rawText = rawText.replace(pattern, '').trim();
  }
  return spellOutNumbersAndSymbols(straightenApostrophes(canonicalizeHesitations(rawText)));
}

export { FIXED_HESITATIONS };
