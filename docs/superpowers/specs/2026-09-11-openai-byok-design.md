# OpenAI BYOK Design

## Goal

Stop the public Agora Meeting Copilot deployment from charging OpenAI usage to the repository owner. A host supplies an OpenAI API key when inviting the AI teammate. The product must describe storage accurately: the browser retains the key only for the current tab session, while the orchestrator receives and uses it transiently in memory.

## Chosen approach

Use an explicit `OPENAI_KEY_MODE`:

- `byok` is the default and the required mode for the public deployment. Inviting the AI teammate requires a user-provided key.
- `server` is an opt-in self-hosting mode that reads `OPENAI_API_KEY` from the orchestrator environment and preserves the existing private-deployment workflow.

This is preferable to putting a standard OpenAI key directly into browser requests to OpenAI, which would expose it to client code, or persisting encrypted keys in PostgreSQL, which creates unnecessary secret-management and retention obligations. OpenAI Realtime short-lived client credentials do not remove the need for the current server-side Agora/GPT Live gateway to receive usable provider authorization.

## Client experience

The existing host-only **Invite Copilot** confirmation becomes a BYOK dialog in `byok` mode:

- Password-style OpenAI API key field with show/hide control.
- Clear explanation that the key is saved in `sessionStorage` for the current browser tab, transmitted over HTTPS when starting the AI teammate, held temporarily in server memory, and never written to the database or application logs.
- Links to the OpenAI API key page and an explicit reminder that usage is billed to the key owner's OpenAI account.
- **Invite Copilot** remains disabled until a plausibly valid, trimmed key is present.
- A saved session key pre-fills the invite flow and can be replaced or cleared.
- Canceling does not transmit the key. Removing the AI teammate clears its server-side copy. Ending or leaving the meeting clears the browser copy for that room; closing the tab also clears it naturally.

The API key must never appear in a URL, toast, error message, analytics event, DOM text, meeting snapshot, RTM/SSE event, or API response.

## Server data flow

1. The authorized host sends `{ openAiApiKey }` in the HTTPS body of `POST /rooms/:roomId/agent/start`.
2. The route validates mode, authorization, length, and shape before passing the key to the room service.
3. A dedicated in-memory key store indexes secrets by room ID and applies the room TTL. It exposes only `set`, `require`, and `delete`; it has no serialization or logging path.
4. The Agora runtime creates its room-scoped proxy credential as before. When Agora connects to `/gpt-live/:roomId`, the gateway obtains the user's key from the in-memory store and uses it only in the upstream OpenAI Authorization header.
5. Meeting-notes OpenAI requests use the same room-scoped key. In `byok` mode, notes remain unavailable until the host has invited the AI teammate and supplied a key; ingestion and the rest of the meeting continue without failing.
6. Agent stop, meeting end, failed startup, and TTL expiry delete the server-side key. No database schema change is required.

The first implementation targets the existing single orchestrator instance. Horizontal scaling would require a dedicated ephemeral secret service with affinity; it must not fall back to PostgreSQL.

## Error handling

- Missing key in `byok` mode: `400` with a safe user-facing message.
- Rejected provider key: retain the existing sanitized credentials error and delete the server-side key.
- Missing in-memory key during a reconnect: close the gateway with a generic authorization failure and ask the host to invite again; never reveal whether a particular key existed.
- `server` mode without `OPENAI_API_KEY`: fail configuration validation at startup.

## Testing

- Unit-test mode validation, in-memory expiry/deletion, start/stop/failure cleanup, gateway key selection, and absence of secret material in responses/events/log inputs.
- API-test host authorization and request-body validation.
- Playwright-test the accessible dialog, session-only persistence, show/hide, clear, cancel, successful invite body, removal cleanup, and mobile layout.
- Run lint, production builds, orchestrator tests, Playwright, secret scans, and `npm audit` before rebasing and pushing.

## Non-goals

- Persisting API keys across tabs, browsers, or devices.
- Validating a key before the user starts the AI teammate.
- Storing keys in PostgreSQL or exposing them to other meeting participants.
- Building a multi-instance distributed secret vault in this release.
