# Local development

## Requirements

Node.js 20+ (developed on 22) and npm.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

The app starts with an empty `.env.local`. Every integration is optional at
startup — nothing below the landing page needs credentials yet.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

Run `npm run typecheck` and `npm run lint` before pushing.

## Environment variables

See `.env.example` for the full list and which feature each one unlocks. Real
credentials go in `.env.local`, which is gitignored. Never commit a secret.

## Working in parallel

Two developers, split by **feature**, not by folder. Nobody owns `lib/` or
`app/`; both will touch both.

Branch names:

```
feature/m2m-first-scenario
feature/bazaar-city
feature/merchant-dashboard
feature/ask-bazaar
feature/simulation
feature/n8n-action
```

When one feature depends on another that does not exist yet:

1. agree the smallest contract — usually a TypeScript type and one function
   signature;
2. write it down (a type in the repo beats a message in chat);
3. stub the other side locally if needed;
4. keep going independently;
5. integrate when both sides are real.

Do not sit blocked waiting for the other half.

## Commits

Keep `main` runnable. Small, focused commits:

```
add merchant transaction model
add M2M comparison logic
add merchant simulation API
```

Not:

```
refactor everything + add feature + redesign UI
```

Do not rewrite work that belongs to the other developer's branch.

## Adding to the repository

Before creating a file, directory or abstraction, ask:

- Does the feature I am building right now need this?
- Is this boundary protecting the product from an external dependency?
- Am I adding it only because it might be useful someday?

Empty placeholder files and speculative schema are what this foundation is
deliberately avoiding. `components/`, `app/api/` and the first migration do not
exist yet for exactly that reason — create them when the first real component,
route or table arrives.

## Future integration points

Each is a real slot, none is wired up:

- **Sarvam** — `lib/llm/sarvam.ts` implementing `LlmProvider`, registered in
  `lib/llm/index.ts`. Needs confirmed access first.
- **Cognee** — a client in `lib/cognee/` once the API surface is confirmed
  against real credentials.
- **n8n** — a workflow trigger in `lib/n8n/`, called after merchant approval.
  If we later version-control exported workflow JSON, a root `n8n/workflows/`
  directory can be added then.
- **Database** — first migration in `supabase/migrations/`, queries in
  `lib/supabase/`.
- **Real Paytm data** — a new implementation behind `lib/paytm/`, only with
  authorized access. Nothing above that boundary should need to change.
