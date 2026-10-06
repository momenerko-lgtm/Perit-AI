# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

No dependencies, build step, linter, or test suite — this is plain Node.js (core modules + global `fetch`/`FormData`) and static HTML/CSS/JS.

- Run the server: `npm start` or `node server.mjs` — serves on `PORT` env var (default `5173`), auto-opens the browser unless `RENDER` or `PORT` is set.
- Windows quick start: double-click `demarrer.bat` — on first run it prompts for a Groq API key and writes it to `.env`, then runs the server.
- CLI transcription (no server/browser needed): `node groq-transcribe.mjs <path/to/audio> [optional prompt]` — requires `GROQ_API_KEY` set in the environment directly (this script does not read `.env`).
- Required secret: `GROQ_API_KEY`. `server.mjs` reads it from a `.env` file next to it (simple hand-rolled parser, not the `dotenv` package) or from `process.env`; it exits immediately if missing.

## Architecture

This repo ("Mot Pour Mot" / "Perit AI Project") is a minimal transcription tool built around Groq's hosted Whisper API (`whisper-large-v3-turbo`, French), structured as a strict verbatim/word-for-word transcription workflow (no corrections, no reformulation).

- `server.mjs` — tiny `http` server with exactly two routes: `GET /` serves `landing.html`; `POST /api/transcribe` reads raw audio bytes from the request body (filename passed via the `X-Filename` header), forwards them as multipart form data to `https://api.groq.com/openai/v1/audio/transcriptions`, and returns `{ text }`. Anything else 404s — there is no generic static file serving, so no other HTML file in the repo is reachable through this server.
- `landing.html` — the actual served single-page app. Captures tab audio via `getDisplayMedia`, runs it through a Web Audio gain+compressor chain to boost quiet audio before recording with `MediaRecorder` (`audio/webm`), auto-stops at 24 MB to stay under upload limits, POSTs the blob to `/api/transcribe`, and renders the result into an editable textarea. It also has a marker-insertion toolbar and a one-click "normalize" transform (lowercase, digits → French words, currency/percent symbols → words, punctuation stripped) that implement the project's verbatim annotation convention described directly in its on-page cheatsheet.
- `groq-transcribe.mjs` — standalone CLI that does the same Groq transcription call directly against a local audio file, bypassing the server/browser entirely.
- `demarrer.bat` — Windows double-click launcher that provisions `.env` with `GROQ_API_KEY` on first run (prompts the user, persists it) and then starts `server.mjs`.
- `mot-pour-mot.html`, `derniere-relecture.html`, `mise-en-conformite.html`, `transcription-manuelle.html` — standalone companion pages for the manual verbatim-transcription workflow (compliance copy check, final proofreading pass, manual transcription steps). These are **not** wired into `server.mjs`'s routing and are not reachable via the running app; each is self-contained (its own `<style>`/`<script>`) and meant to be opened directly as its own artifact.

### Verbatim transcription convention

The transcription/normalization logic in this repo (and the standalone companion pages) implements a specific French verbatim annotation standard — see the cheatsheet in `landing.html` for the authoritative rules (fixed-form hesitation words vs. `[fp]`, `(())` for incomprehensible passages, `{{}}` for ambiguous mispronunciations, `-` for truncated words, lowercase-everything with no sentence punctuation, numbers/symbols spelled out, specific elision rules, spelled-out acronyms get a period per letter). When touching any transcription, normalization, or text-processing code, preserve this convention exactly rather than "cleaning up" the text — corrections and reformulations are explicitly against the intent of this project.
