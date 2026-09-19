# Ask Bazaar (Sarvam)

Ask Bazaar is the conversation on the right side of the Merchant Dialog. The
merchant asks about their own business by typing or speaking, in English or
an Indian language, and gets an answer grounded in their M2M and Relevance
intelligence. When an answer leads to the saved recommendation, the merchant
can approve it, and only then does n8n run it.

Sarvam supplies the language layer:

| Job | Sarvam API | Default model | Code |
| --- | --- | --- | --- |
| Chat | `POST /v1/chat/completions` | `sarvam-105b` | `lib/llm/sarvam.ts` |
| Voice input (STT) | `POST /speech-to-text` | `saaras:v3`, language auto-detected | `lib/speech/sarvam.ts` |
| Voice answer (TTS) | `POST /text-to-speech` | `bulbul:v3`, MP3 | `lib/speech/sarvam.ts` |

All three calls run on the server. The key is read in one place
(`lib/sarvam/client.ts`) and never reaches the browser.

## Architecture

```
Supabase
  ↓  Data Adapter (lib/paytm)
M2M engine            calculates every figure
  ↓
Relevance engine      decides what matters now
  ↓
Ask Bazaar            merchant-intelligence/chat.ts: fact table + bounded conversation
  ↓
Sarvam
  ├── Chat   Sarvam 105B words the answer (OpenRouter as fallback)
  ├── STT    voice → text, into the same pipeline
  └── TTS    answer → voice
  ↓
Validation            schema, known facts, every figure checked
  ↓
Recommendation        the deterministic proposal (merchant-intelligence/actions.ts)
  ↓
Merchant approval     explicit "Approve" in the dialog
  ↓
n8n                   runs the approved, structured action
  ↓
Outcome               measured by M2M, saved to Supabase
  ↓
Cognee                remembers situation → question → recommendation → action → outcome
```

## M2M and Sarvam

M2M and Relevance stay the source of truth. Sarvam explains their output.

- Every figure Sarvam may use is in the **fact table** (`merchant-intelligence/facts.ts`):
  about 70 labelled numbers, such as the merchant's sales change, similar shops'
  change, the Bazaar and city, time-of-day and weekday patterns, and remembered
  outcomes.
- Sarvam also receives the ranked signals, pattern types, opportunities, the
  proposed action (with its status) and data limitations. These are labels, not
  new numbers.
- Every reply is checked: any business figure that is not in the fact table
  gets one correction round. If it is still there, the sentences using it are
  removed, or the answer is rebuilt from the facts by rules. This applies to
  every language: digits in Indian scripts (for example `२९.५`) and percent
  words (`प्रतिशत`, `ಶೇಕಡಾ`, …) are normalised before the check.
- The server looks up cited evidence in the fact table. The value shown to
  the merchant never comes from the model.

Sarvam never calculates GMV, growth, AOV or cohort or Bazaar metrics, never
queries Supabase and never sees transactions.

## Chat flow

1. The dialog loads the merchant's intelligence once (`GET …/intelligence?view=basic`).
   The server caches it (`getCachedBasics`, 10 min).
2. The merchant asks. The client sends `{ message, history, conversationId }`.
   `history` is only the text of recent turns.
3. `POST /api/merchants/:merchantId/chat` reuses the cached intelligence and the cached
   memory recall (`getCachedHistory`, which waits at most 4 s). Nothing is recomputed
   per message.
4. `askBazaar` (`merchant-intelligence/chat.ts`) builds a compact system prompt
   (rules, signals, opportunities, the proposal, memory, and facts as
   `[id, label, value, unit]` rows) plus the last 8 turns. Earlier answers are
   shortened to 1,200 characters.
5. Sarvam 105B replies with JSON: `answer, language, intent, evidence, recommendation, suggestAction`.
6. The server validates the reply and returns `AskResult`:
   `answer`, `language`, `intent`, `evidence` (resolved facts), `recommendation`,
   `action`, `source` (`ai` | `ai_trimmed` | `summary`), `provider`, `model`, `trace`.

Starter questions come from the merchant's own Relevance output
(`starterQuestions` in `components/intelligence/present.ts`). Examples are
"Why are my sales down?", "What is happening with my evening sales?" and
"Why is my business moving differently from the Bazaar?". Only the questions are
prepared in advance. Every answer is generated when the question is asked.

## Voice flow

```
🎙 press → browser asks for microphone → recording (auto-stops at 30 s; Stop or Cancel)
  → POST /api/merchants/:id/chat/voice (multipart: audio, history, conversationId)
  → Sarvam STT (saaras:v3, language_code=unknown)
  → transcript → the same askBazaar pipeline as typed text
  → Sarvam TTS in the answer's language → base64 MP3
  → dialog shows the transcript and the answer, then plays the audio
```

Voice is only another input. There is no separate voice pipeline.

- Typed answers are never read aloud automatically. Each answer has a **Listen**
  button, which calls `POST …/chat/speech`.
- Voice answers play automatically. If the browser blocks autoplay, Listen still works.
- Failure messages:
  - Microphone denied: "Microphone access is blocked…"
  - No MediaRecorder: "Voice input isn't supported in this browser…"
  - STT failure: "Voice input couldn't be processed. You can type your question instead."
  - TTS failure: the text answer stays, with a short note.

## Language

The system does not ask the merchant to choose a language. Sarvam is told to
reply in the language and script of the merchant's latest message, including
Hinglish. If the merchant asks for a language ("Tell me in Hindi"), Sarvam
switches and stays in it. Numbers stay as digits copied from the facts.

The server decides the answer's `language` from the script of the answer
itself. It uses the model's claim only to choose between languages that share
a script (Hindi or Marathi, Bengali or Assamese). That language code is what TTS
receives. Sarvam can speak 11 languages: en, hi, bn, gu, kn, ml, mr, od, pa, ta
and te (`-IN`). For any other language, the answer is shown as text only.

## Privacy boundary

Sarvam receives:
- the merchant's own name, category and Bazaar;
- the fact table of aggregates, and signal, pattern and opportunity labels;
- the last few turns of this conversation.

Sarvam never receives:
- transactions, transaction IDs or payment identifiers;
- customer data;
- the merchant's own email or phone number;
- any other merchant's identity or figures. Groups are always "similar shops",
  "your market" or "the city".

This is tested in `merchant-intelligence/__tests__/ask.test.ts` ("merchant scope and privacy").

Merchant scope: the merchant comes only from the route path. The ID is checked
for format, and the merchant must exist in the Data Adapter. Nothing in the
request body can change which merchant's intelligence is read. The prototype
has **no merchant login**. When one exists, the signed-in merchant should replace
the path check in `app/api/_lib/ask.ts`.

## n8n approval boundary

- The action offered in the chat is always `basics.recommendation`, the saved
  proposal built by `proposeAction` from Relevance output. The model can only
  point to it (`suggestAction`, or a `RECOMMENDATION` intent). It cannot create,
  change or run it.
- **Take action** opens a confirmation (Cancel / Approve). Approve calls the
  existing `POST /api/merchants/:id/actions` with `{ actionId, approved: true }`.
  `executeApprovedAction` refuses anything except `approved === true`.
- n8n receives only the validated structured action and its fixed description.
  It never receives model text.
- A proposal that has already run (`actionStatus: executed`) is not offered
  again. Sarvam is told it is live, so it suggests a different angle.
- If n8n fails, the recommendation stays and the dialog says the start failed.

## Cognee memory boundary

- Before answering, the server recalls this merchant's memories once per
  merchant and period. The chat waits at most 4 s. A slow recall keeps running,
  and the next question uses its result. If recall fails, the answer is given
  without history.
- Recalled outcomes appear as `history.N.*` facts, so their numbers pass the same check.
- The system does **not** store every message. It stores one `conversation`
  memory per conversation, and only when the conversation reaches a
  recommendation. That memory holds the situation (signals and patterns), the
  question (with phone numbers and email addresses removed), the recommendation
  and the linked proposal. The write happens after the response.
- Approved actions and measured outcomes are remembered by the existing action
  flow (`action_outcome`, `measured_outcome`).

## Fallback behaviour

| Failure | What the merchant sees |
| --- | --- |
| Sarvam chat down or not configured | OpenRouter answers (`LLM_FALLBACK_PROVIDER`). If that also fails, they see: "Your business numbers are ready, but conversation is unavailable for a moment." followed by a summary built from the facts |
| Reply is broken JSON | One retry, then the summary built from the facts |
| Reply uses a figure not in the facts | One correction round, then the unsupported sentences are removed, then the summary |
| Cognee slow or down | Answer without history |
| STT down or not configured | "Voice input couldn't be processed. You can type your question instead." |
| TTS down or unsupported language | Text answer only, with a short note |
| n8n fails | Recommendation kept; the dialog says the action could not be started |

The Trace shows which path produced each answer (see below).

### Backup Sarvam key

`lib/sarvam/client.ts` sends every Sarvam call (chat, STT, TTS) with
`SARVAM_API_KEY` first. If Sarvam rejects that account, the same request is
retried once with `SARVAM_API_KEY_BACKUP`, and the merchant never sees it.
"Rejects the account" means 401, 402, 403 or 429, or an error that mentions
credits, quota or billing. After that the primary is skipped for 15 minutes,
so later calls do not pay for a failed attempt first. Then it is tried again,
in case it has been topped up.

A bad request (400 or 422), a Sarvam outage (5xx) or a network failure would
fail the same way with any key, so these are not retried with the backup. They
go to the next layer instead: OpenRouter for chat, and the text-only answer for
voice.

Each switch is logged: `[sarvam] primary key unavailable (402: …); trying backup key.`

Order: Sarvam primary → Sarvam backup → OpenRouter → answer from the facts.

## Intelligence Trace

After each answer, the dialog's **Trace** adds an **Ask Bazaar** stage with:
- the question, and whether it was typed or spoken;
- the answer language and intent;
- which provider and model wrote it, and how it was checked;
- the number of facts and conversation turns sent;
- memory use;
- the facts the answer cites, with their values from the fact table;
- the Relevance signals, patterns and opportunity behind the answer;
- the offered action, and that it needs approval.

It also states that no raw transactions and no other shop's identity were
sent. The existing Action stage then shows the approval, the n8n run and the
measured outcome.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SARVAM_API_KEY` | for Sarvam | — | Server-only. Chat, STT and TTS |
| `SARVAM_API_KEY_BACKUP` | no | — | Second Sarvam account, used when the primary runs out of credits (see below) |
| `LLM_PROVIDER` | no | `sarvam` | Primary LLM (`sarvam` or `openrouter`) |
| `LLM_FALLBACK_PROVIDER` | no | `openrouter` when primary is Sarvam | Fallback LLM; `none` to disable |
| `SARVAM_CHAT_MODEL` | no | `sarvam-105b` | Chat model |
| `SARVAM_STT_MODEL` | no | `saaras:v3` | Speech-to-text model |
| `SARVAM_TTS_MODEL` | no | `bulbul:v3` | Text-to-speech model |
| `SARVAM_TTS_SPEAKER` | no | `shubh` | Bulbul voice |
| `SARVAM_BASE_URL` | no | `https://api.sarvam.ai` | API base URL |

None of these has a `NEXT_PUBLIC_` prefix.

## Local development

```bash
cp .env.example .env.local        # if you have not already
# in .env.local:
SARVAM_API_KEY=sk_...
LLM_PROVIDER=sarvam               # or remove the line: sarvam is the default
OPENROUTER_API_KEY=...            # optional fallback

npm run dev
```

Open a Bazaar, open a shop (PBZKOR006, Tiffin Theory, in Koramangala is the
demo merchant), and use Ask Bazaar on the right. The badge in the panel header
shows who answered, for example "Sarvam · sarvam-105b". Voice needs a browser
with microphone access, on `localhost` or HTTPS.

Without `SARVAM_API_KEY`, chat uses OpenRouter if it is configured, otherwise
the summary built from the facts. Voice and Listen report that they are
unavailable. Nothing else changes.

Tests: `npm test`. Sarvam calls are mocked at `fetch`. See
`merchant-intelligence/__tests__/ask.test.ts`.
