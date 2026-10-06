// Post-traitement du texte brut renvoye par Groq/Whisper pour appliquer le
// guideline client de transcription mot pour mot (voir CLAUDE.md).
//
// Limite connue et assumee : Whisper ne sait pas dire "je n'ai pas compris" —
// il produit toujours son meilleur mot plutot que de signaler une zone
// incertaine. Les heuristiques ci-dessous (confiance par segment) sont donc
// une AIDE a la relecture, pas une detection fiable. Le relecteur humain doit
// toujours valider (()) et {{}} (voir le bandeau "a finaliser a la main"
// dans landing.html).

const FIXED_HESITATIONS = ['mhm', 'uh-huh', 'hmm', 'euh', 'euhm', 'mm-mm', 'nan-nan', 'oh', 'ouh'];

// Echantillon de style passe au parametre "prompt" de l'API Groq pour
// inciter Whisper a conserver les hesitations plutot que de lisser la
// transcription (reduit le risque d'OMISSION d'un "euh"/"hmm" reellement
// prononce). Contrepartie connue : sur un passage silencieux/bruite,
// Whisper peut parfois "recopier" le style du prompt (risque d'HALLUCINATION
// accru sur ces zones) — en partie rattrape par annotateLowConfidenceSegments
// puisque ces recopiages ont generalement un score de confiance bas aussi.
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
  // Regle 3 du guideline : si deux pauses pleines [fp] se suivent, on ne
  // transcrit [fp] qu'une seule fois (contrairement aux repetitions de mots
  // reels, qui elles doivent etre conservees - Regle 2).
  result = result.replace(/\[fp\](?:\s+\[fp\])+/gi, '[fp]');
  return result;
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

// Minuscules + ponctuation + nombres/symboles, identique au bouton
// "normaliser" de landing.html. NB: on ne tente pas d'INSERER de nouveaux
// points apres des lettres epelees (ex. "d u b o i s" -> "d. u. b. o. i. s.")
// car le texte seul ne permet pas de distinguer cette suite d'un cas comme
// "y a" (il y a) ou "y" est un mot normal suivi d'un autre mot d'une lettre
// — le guideline interdit explicitement de mettre un point apres "y". On se
// contente donc de PRESERVER les points deja presents sur une lettre isolee.
export function normalizeVerbatim(text) {
  let result = text.toLowerCase();
  result = result.replace(/\d+/g, (m) => numberToFrenchWords(m));
  result = result.replace(/\$/g, ' dollars ').replace(/€/g, ' euros ').replace(/%/g, ' pour cent ').replace(/&/g, ' et ');
  result = result.replace(/’/g, "'");
  result = result.replace(/\b([a-zà-ÿ])\.(\s|$)/g, '§§$1§§$2');
  result = result.replace(/[,!?.]/g, '');
  result = result.replace(/§§([a-zà-ÿ])§§/g, '$1.');
  result = result.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  return result;
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

// Construit le texte a partir des segments verbose_json, en entourant de
// (()) les segments jugs peu fiables — avec l'hypothese de Whisper a
// l'interieur, comme demande par le guideline ("tente toujours une
// hypothese dedans avant de le laisser vide").
export function annotateLowConfidenceSegments(segments) {
  return segments
    .map((seg) => {
      const trimmed = (seg.text || '').trim();
      if (!trimmed) return '';
      return isLowConfidence(seg) ? `((${trimmed}))` : trimmed;
    })
    .filter(Boolean)
    .join(' ');
}

// Point d'entree unique utilise par server.mjs et groq-transcribe.mjs :
// prend la reponse JSON brute de l'API Groq (idealement en verbose_json) et
// renvoie le texte final annote + normalise.
export function processGroqResponse(data) {
  const rawText = Array.isArray(data.segments) && data.segments.length > 0
    ? annotateLowConfidenceSegments(data.segments)
    : (data.text || '');
  return normalizeVerbatim(canonicalizeHesitations(rawText));
}

export { FIXED_HESITATIONS };
