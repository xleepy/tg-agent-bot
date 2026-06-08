# AGENTS.md — Working Agreement

This file is for any AI agent (and any human collaborator) working in this repo. Read it before changing code.

## TL;DR

- One owner, one private chat. The bot rejects every other context.
- v1 keeps a per-chat SQLite history of the last 20 messages so the LLM has short-term context. `/reset` clears it. There is no other persistence (no settings DB, no per-user config).
- When in doubt, **stop and ask the user**. Do not guess. Do not invent. Do not silently degrade.

## Project Overview

`tg-agent-bot` is an owner-only TypeScript Telegram bot. It runs against one of three LLM providers (OpenAI, OpenRouter, or OpenCode Go) and supports web search through provider-native tools with Tavily as a fallback. Per-chat conversation history is kept in SQLite (last 20 messages) so the LLM has short-term context; `/reset` clears a chat.

Source of truth for what we're building: see `PLAN.md`. When the plan and the code disagree, the plan wins — fix the code and update the plan in the same change.

## Authoritative References

- **`PLAN.md`** — scope, commands, env vars, test plan, assumptions. Read this before making design decisions.
- **`src/config/config.ts`** — the validated config shape. If you need a new env var, add it here first. `SYSTEM_PROMPT` is prepended to every LLM call as a system message — the way to set the assistant's persona for all three providers.
- **`src/auth/owner-only.ts`** — the authorization rules. Private chat + matching `BOT_OWNER_TELEGRAM_USER_ID` is the only path through.
- **`src/search/route.ts`** — search routing policy. Native first, Tavily fallback. Don't reinvent this.
- **`src/providers/opencode.ts`** — uses the `openai` SDK pointed at `OPENCODE_BASE_URL` (default `https://opencode.ai/zen/go/v1`, the OpenCode Go API) with `OPENCODE_API_KEY` as a bearer token. Same SDK as the `openai` provider, just a different `baseURL`.

## Hard Constraints

These are not preferences. Do not change them without an explicit conversation with the user:

1. **Single user.** The bot only responds to one Telegram user ID. No multi-user lists, ever.
2. **Private chat only.** Groups, supergroups, and channels are rejected.
3. **No persistence beyond chat history.** Per-chat conversation history (last 20 messages) is kept in SQLite at `SQLITE_PATH` so the LLM has short-term context. `/reset` clears a chat's history. There is no other persistence — no settings DB, no per-user config, no session store beyond history.
4. **No shell or filesystem access from the bot.** The OpenCode Go adapter does not invoke filesystem or shell tools on the bot side. Server-side permissions are the trust boundary there.
5. **No secrets in logs.** Never `console.log(config)` or `console.log(env)`. Use the pino logger and a redacted summary (`redactConfig`) for config visibility.
6. **Webhook security.** In `BOT_MODE=webhook`, the secret token is required and is baked into the URL path.

## Coding Conventions

- **TypeScript ESM, strict mode.** `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` on. Honor them.
- **No comments in code.** Match the surrounding style. If a comment seems necessary, it probably means a name is wrong.
- **One file per concept.** Adapters in `src/providers/`, search in `src/search/`, etc. Re-export from `index.ts`.
- **Logger is pino.** Get it from `createLogger(config)`. Never `console.log` in production paths.
- **Errors are values, not throws at the boundary.** Catch in the bot's text handler and reply with a generic error message. Log the real error with `logger.error({ err }, ...)`.

## When to Ask the User

Stop and ask the user when any of these are true. Do not guess through them.

- The change affects what `PLAN.md` calls out as scope, a constraint, or a decision.
- The change touches authorization, webhook mode, the search routing policy, the OpenCode tool story, or the secret-handling code.
- The change would add a new env var, a new provider, a new command, or a new persistence layer.
- You are choosing between two reasonable designs and the user hasn't already expressed a preference.
- You are unsure which of several conflicting requirements in `PLAN.md` takes precedence.
- You are about to add a workaround, fallback, or "we can fix this later" note. Those are usually a sign the real fix needs the user.
- The user asks for something that contradicts what we already agreed to. Confirm before doing it.
- You are tempted to silently "improve" something that wasn't asked for.

When asking, be specific: state the decision, the alternatives, and what you'd do if the user says "you pick". Default to **not** doing the change until the user replies.

## Workflow for Changes

1. Read `PLAN.md`. If your change is in scope, proceed. If it's not, ask.
2. Make the change.
3. Run `npm run typecheck`, `npm run lint`, and `npm test`. All three must pass before you consider the change done.
4. If the change affects plan scope, env vars, commands, or the test plan, update `PLAN.md` in the same change.
5. Do not commit unless the user explicitly asked for a commit. Never push.

## Test Conventions

- Unit tests in `test/unit/`, integration in `test/integration/`. The bot integration tests stub `Telegram.prototype.callApi` — do not make real network calls.
- New behavior gets a new test. The reviewer will ask "where's the test?" if you can't point to one.
- Use `pino({ level: "silent" })` for test loggers unless the test is asserting log output.

## Local Commands

- `npm run dev` — run with `tsx`, picks up `.env` automatically via `dotenv`.
- `npm run build` — compile to `dist/`.
- `npm test` — run the full test suite once.
- `npm run test:watch` — watch mode.
- `npm run typecheck` / `npm run lint` — verify before pushing a change.
- `docker compose up -d data` — start the SQLite data container. It bind-mounts `./data/` so the host bot (running via `npm run dev`) has a stable, Docker-managed location for `bot.sqlite`. The bot itself runs on the host.

## Security Reminders

- `.env` is in `.gitignore`. Keep it that way. Never commit it.
- Real tokens and API keys are sensitive. If you see one in a chat transcript or in a file, flag it to the user.
- The OpenAI API key in `.env` (if present) starts with `sk-proj-` and is project-scoped. Treat it like a password.
