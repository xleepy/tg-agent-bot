# Owner-Only TypeScript Telegram Agent

## Summary

Build a greenfield TypeScript Telegram bot that only responds to one Telegram user, the bot owner. It supports OpenAI, OpenRouter, OpenCode Go, web search through provider-native tools with Tavily fallback, optional stdio MCP tools, and SQLite-backed per-chat conversation history.

## Key Changes

- Add `BOT_OWNER_TELEGRAM_USER_ID` as a required environment variable.
- The bot only operates in private chats and only with the owner. Group, supergroup, and channel updates are rejected with a "not authorized" reply.
- Remove multi-user authorization lists from v1. No `AUTHORIZED_TELEGRAM_USER_IDS` or shared-user access.

## Agent Features

- Scaffold a TypeScript ESM app with Telegraf, Zod config validation, structured logging, provider adapters, and tests.
- Commands: `/start`, `/help`, `/whoami`, `/provider`, `/model`, `/search`, `/status`, `/reset` (clears this chat's conversation history), `/stop` (aborts the in-flight response for this chat).
- Providers:
  - `openai`: OpenAI Responses API using `OPENAI_API_KEY`. Error at startup if `DEFAULT_PROVIDER=openai` and the key is missing.
  - `openrouter`: OpenRouter chat completions using `OPENROUTER_API_KEY`.
  - `opencode`: OpenCode Go, an OpenAI-compatible inference API. `OPENCODE_BASE_URL` defaults to `https://opencode.ai/zen/go/v1`. Auth is bearer-token via `OPENCODE_API_KEY` (subscribe at https://opencode.ai/zen). Model is `OPENCODE_MODEL` (default `kimi-k2.6`; see https://opencode.ai/docs/go/ for the full list). Uses the `openai` SDK with a custom `baseURL`.
- Web search:
  - Use OpenAI hosted web search for OpenAI.
  - Use OpenRouter web search server tool for OpenRouter.
  - Use Tavily fallback for OpenCode or unsupported native-search paths.
  - `/search` is a per-message toggle: when sent as a command it overrides `DEFAULT_SEARCH_MODE` for the next request only and is not persisted.

## Public Config

- Required: `TELEGRAM_BOT_TOKEN`, `BOT_OWNER_TELEGRAM_USER_ID`.
- Provider config: `DEFAULT_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENCODE_BASE_URL`, `OPENCODE_API_KEY`, `OPENCODE_MODEL`.
- Search/runtime: `TAVILY_API_KEY`, `SYSTEM_PROMPT` (optional override; prepended to every LLM call as a system message — sets the assistant's persona/context. If unset, `DEFAULT_SYSTEM_PROMPT` is used. The built-in default tells the model it's a Telegram bot and to reply in plain text), `DEFAULT_SYSTEM_PROMPT` (optional override for the built-in default itself), `MCP_CONFIG_PATH` (default `./mcp.json`; describes stdio MCP servers to spawn and expose as LLM tools. Format: `{"mcpServers": {"name": {"command": "...", "args": [...], "env": {...}}}}`), `SQLITE_PATH` (default `./data/bot.sqlite`; inside the Docker image it defaults to `/data/bot.sqlite` on a named volume), `DEFAULT_SEARCH_MODE=auto|on|off`, `BOT_MODE=longpoll|webhook`, `PORT`, `PUBLIC_WEBHOOK_URL`, `WEBHOOK_SECRET_TOKEN` (required when `BOT_MODE=webhook`; passed to `telegraf.webhookCallback` and used as the unguessable URL path component), `LOG_LEVEL`.

## Test Plan

- Unit test owner-only authorization for private chats and reject all other chat types (group, supergroup, channel).
- Test config validation fails when `BOT_OWNER_TELEGRAM_USER_ID` is missing or invalid; explicitly cover: empty, whitespace, non-numeric, negative, zero, float, leading `+`, and values > 10^10.
- Test the OpenCode Go adapter: default model + provider name.
- Test provider selection, model switching, search routing, Tavily fallback, and Telegram message chunking.
- Test MCP config loading, stdio initialization, tool listing, and startup timeout behavior.
- Add mocked Telegraf update tests for `/whoami`, `/provider`, `/model`, `/search`, and unauthorized ignored updates.
- Optional live provider tests gated by `RUN_LIVE_PROVIDER_TESTS=1`.

## Assumptions

- "Bot owner" means one Telegram numeric user ID configured through `BOT_OWNER_TELEGRAM_USER_ID`.
- Unauthorized users receive no agent output: the bot replies with a short "not authorized" message in any non-owner or non-private context so the owner can self-diagnose a misconfigured `BOT_OWNER_TELEGRAM_USER_ID`.
- The workspace is empty, so this is a greenfield implementation.
