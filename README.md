# tg-agent-bot

An owner-only TypeScript Telegram bot. One user, one private chat. Connects to OpenAI, OpenRouter, or OpenCode Go for LLM responses, supports web search through provider-native tools with a Tavily fallback, and keeps a small SQLite-backed conversation history.

This is a personal agent — not a multi-user service. It will reject every update from anyone other than the configured owner, and it rejects every update from groups, supergroups, and channels.

## Prerequisites

- Node.js 20+
- npm 10+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot) — message it and it replies with your numeric ID)
- At least one provider API key (OpenAI, OpenRouter, or OpenCode Go)

## Setup

```sh
git clone <your-fork-or-clone-url> tg-agent-bot
cd tg-agent-bot
npm install
cp .env.example .env
```

Open `.env` and fill in the required values:

```sh
TELEGRAM_BOT_TOKEN=           # from @BotFather
BOT_OWNER_TELEGRAM_USER_ID=   # your numeric Telegram user id
DEFAULT_PROVIDER=openai       # openai | openrouter | opencode

# OpenAI (https://platform.openai.com/api-keys)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

# OpenRouter (https://openrouter.ai/keys) — only if DEFAULT_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=

# OpenCode Go (https://opencode.ai/zen) — only if DEFAULT_PROVIDER=opencode
OPENCODE_API_KEY=
OPENCODE_MODEL=kimi-k2.6

# Web search fallback (optional)
TAVILY_API_KEY=               # https://tavily.com — only used for OpenCode, or as fallback for any provider
SYSTEM_PROMPT=                # optional override; default tells the model it's a Telegram bot and to reply in plain text
DEFAULT_SYSTEM_PROMPT=        # only set this if you want a different built-in default; SYSTEM_PROMPT above takes precedence

# Runtime
MCP_CONFIG_PATH=./mcp.json     # stdio MCP server config; checked-in default uses the local dummy server
SQLITE_PATH=./data/bot.sqlite # persists conversation history; default works
DEFAULT_SEARCH_MODE=auto      # auto | on | off
BOT_MODE=longpoll             # longpoll | webhook (webhook requires WEBHOOK_SECRET_TOKEN)
PORT=8080                     # healthcheck server port; used in both longpoll and webhook modes
PUBLIC_WEBHOOK_URL=           # only in webhook mode, e.g. https://bot.example.com
WEBHOOK_SECRET_TOKEN=         # only in webhook mode; baked into the URL path so it's unguessable
LOG_LEVEL=info
```

If you set `OPENCODE_BASE_URL` to something other than the default `https://opencode.ai/zen/go/v1`, the bot will use that endpoint instead — useful for self-hosted Go-compatible proxies.

`PORT` is used in both `BOT_MODE=longpoll` (for the `/healthz` healthcheck server) and `BOT_MODE=webhook` (for the same server plus the Telegram webhook listener). `PUBLIC_WEBHOOK_URL` and `WEBHOOK_SECRET_TOKEN` are only consulted when `BOT_MODE=webhook`.

If `DEFAULT_PROVIDER=opencode`, the SDK key alone is enough — the bot points at `https://opencode.ai/zen/go/v1` by default and uses `OPENCODE_MODEL` to pick a Go-tier model.

## Run locally

```sh
npm run dev
```

Open a private chat with your bot in Telegram and send any message. The bot will reply (the first message may take a few seconds while it warms up the provider connection).

## Run the bot on the host, SQLite in a container

`docker-compose.yml` brings up a tiny `data` container that bind-mounts `./data` from the host, just to keep that directory under Docker's lifecycle. The bot itself runs on the host with `npm run dev`.

```sh
docker compose up -d data       # creates ./data/ and keeps it alive
npm run dev                     # bot on the host, reads ./data/bot.sqlite
```

Point `SQLITE_PATH` at `./data/bot.sqlite` in your `.env` (the default). On startup the bot will create the file if it doesn't exist.

To stop and remove the data container:

```sh
docker compose down
```

To wipe the history entirely:

```sh
docker compose down
rm -rf ./data
docker compose up -d data
```

A full containerized run (bot + SQLite in one image) is not the default; the `Dockerfile` is kept in the repo for that case if you ever want it, but the compose file deliberately doesn't use it. The recommended split is "data container + host bot" as shown above.

## Commands

The bot registers these in Telegram's autocomplete menu (private chat scope only):

| Command         | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `/start`        | Show bot status                                              |
| `/help`         | List available commands                                      |
| `/whoami`       | Show your Telegram user id                                   |
| `/provider`     | Show the active LLM provider                                 |
| `/model <name>` | Show or set the current model                                |
| `/search on|off`| Toggle web search for the next message (per-chat)            |
| `/status`       | Show runtime state, including MCP and history status         |
| `/reset`        | Clear conversation history for this chat                     |
| `/stop`         | Abort the in-flight response for this chat                   |

## Development

```sh
npm run dev         # run with tsx, auto-reload on changes
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run test:watch  # vitest watch mode
```

All three of `typecheck`, `lint`, and `test` must pass before a change is considered done. The pre-commit-equivalent is `npm run typecheck && npm run lint && npm test`.

## Configuration

The validated config shape lives in `src/config/config.ts`. If you add a new env var, add it there first — the Zod schema is the single source of truth for what's accepted. `redactConfig(cfg)` produces a safe-to-log summary of the same shape.

## MCP

`MCP_CONFIG_PATH` points at a stdio MCP config file. The bot initializes each server before launching Telegram; a server that cannot complete `initialize` or `tools/list` within 30 seconds is skipped so message handling stays responsive. MCP commands must be non-interactive. For `npx` servers, use `-y` or install the package ahead of time and point `command` at the local executable.

The checked-in `mcp.json` points at `scripts/dummy-mcp-server.mjs`, a local no-network test server with one tool named `dummy_echo`. Restart the bot and run `/status`; a working MCP path reports `MCP: 1 server, 1 tool` and `MCP dummy: dummy_echo`.

## Security

- `.env` is in `.gitignore`. Never commit it.
- The bot token and API keys are sensitive. If you see one in a chat transcript or a log, rotate it.
- In `BOT_MODE=webhook`, `WEBHOOK_SECRET_TOKEN` is required and is baked into the URL path so the endpoint is unguessable. Pass it to `telegraf.webhookCallback` as the `secretToken` option.
- The OpenCode Go adapter trusts the Go API's own auth (Bearer token). The bot does not invoke shell or filesystem tools on its side.

## How the security model works

- **One user, one private chat.** The auth layer in `src/auth/owner-only.ts` rejects every update from non-owner IDs and from any chat type other than `private`. Other users get a short "Not authorized." reply so you can self-diagnose a misconfigured `BOT_OWNER_TELEGRAM_USER_ID`.
- **SQLite-backed recent history.** The bot retains the last 20 messages per chat. `/reset` clears them. The SQLite file is on disk; `SQLITE_PATH` controls where.
- **No secrets in logs.** `loadConfig` and `main.ts` use pino and the redacted summary from `redactConfig`. The full config (which includes the bot token and API keys) is never logged.

## Project layout

```
src/
  auth/         owner-only authorization
  bot/          Telegraf wiring, command list, run loop
  config/       Zod-validated env config + redacted summary
  history/      SQLite-backed per-chat history (last 20 messages)
  logging/      pino setup
  mcp/          stdio MCP config loading and client transport
  providers/    OpenAI / OpenRouter / OpenCode Go adapters
  search/       Tavily client + provider-aware search routing
  utils/        message chunking (Telegram 4096 char limit)
scripts/        local helper scripts, including the dummy MCP server
test/
  unit/         config, auth, history, providers, search, MCP, chunking
  integration/  mocked Telegraf update tests
PLAN.md         scope, decisions, env vars, test plan
AGENTS.md       working agreement for AI agents
```

## License

MIT. See [LICENSE](./LICENSE).
