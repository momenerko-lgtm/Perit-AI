const apiKey = process.env.GROQ_API_KEY;
const filePath = process.argv[2];
const prompt = process.argv[3];

if (!apiKey) {
  console.error("Erreur : la variable d'environnement GROQ_API_KEY n'est pas définie.");
  console.error('PowerShell : $env:GROQ_API_KEY = "ta_cle_ici"');
  process.exit(1);
}

if (!filePath) {
  console.error('Usage : node groq-transcribe.mjs chemin/vers/audio.mp3');
  process.exit(1);
}

const fs = await import('node:fs');
const { processGroqResponse, DISFLUENCY_PRIMING_PROMPT } = await import('./transcript-rules.mjs');

if (!fs.existsSync(filePath)) {
  console.error(`Fichier introuvable : ${filePath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(filePath);
const fileName = filePath.split(/[\\/]/).pop();

const form = new FormData();
form.append('file', new Blob([fileBuffer]), fileName);
form.append('model', 'whisper-large-v3-turbo');
form.append('language', 'fr');
form.append('response_format', 'verbose_json');
form.append('prompt', prompt || DISFLUENCY_PRIMING_PROMPT);

const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
});

if (!response.ok) {
  console.error(`Erreur Groq (${response.status}) :`, await response.text());
  process.exit(1);
}

const data = await response.json();
console.log(processGroqResponse(data));
