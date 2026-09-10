# Agora Meeting Copilot

An Agora meeting room with two deliberately separate AI capabilities:

- **Automatic meeting record:** Agora Real-Time Speech to Text starts when the
  first browser joins RTC. Final speaker-attributed turns feed shared live notes,
  final notes, and downloadable Markdown artifacts.
- **Optional AI teammate:** Copilot joins as independent RTC UID `900001`,
  answers subscribed room audio through GPT Live Alpha, and can be removed like
  another participant. Its final voice turns join the same shared transcript;
  there is no separate text-chat or approval workflow.
- **Collaborative Kanban:** the meeting includes a compact board preview and a
  dedicated `/board?room=...` workspace. Participants can create, edit, assign,
  prioritize, tag, schedule, drag, filter, and search cards manually, while
  GPT Live Responses delegation exposes typed create, move, update, and tag
  functions. GPT Live selects the function, the orchestrator executes it, and
  the result returns to GPT Live before it confirms the action. PostgreSQL owns
  cards and activity history, optimistic versions prevent silent overwrites,
  and SSE keeps every participant synchronized. Voice deletion is intentionally
  unavailable; manual deletion is limited to the host or card creator.

The voice runtime uses the limited-access OpenAI GPT Live Alpha provider through
Agora's Conversational AI preview. A signed orchestrator WebSocket gateway keeps
the OpenAI credential server-side, injects Responses delegation, and completes
client-actionable function calls without putting the board mutation on the RTM
transcript path.

The repository is intentionally limited to runnable application code, deployment
configuration, and automated tests. Internal design notes and demo scripts are
maintained separately from the codebase.

## Stack

- Next.js App Router
- Agora RTC and RTM Web SDKs
- Agora Real-Time Speech to Text v7 with Protobuf data-stream captions
- Agora Conversational AI via `agora-agents`
- OpenAI GPT Live Alpha audio plus Responses API structured meeting notes
- GPT Live Responses delegation plus client-actionable Kanban functions
- Fastify orchestrator and PostgreSQL on Railway
- Signed host/guest capabilities and 24-hour text-only meeting artifacts

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

In another terminal:

```bash
cd services/orchestrator
npm install
cp .env.example .env
# Export the values from .env, then:
npm run dev
```

Provider credentials and token generation live only in the orchestrator. The
browser receives short-lived RTC/RTM credentials and a room-scoped capability.

Agora STT REST authentication additionally requires `AGORA_CUSTOMER_ID` and
`AGORA_CUSTOMER_SECRET`. These are Agora REST API credentials, not the App ID or
App Certificate. Keep them only in the Railway orchestrator environment.

## Meeting Data Flow

```text
Browser microphones -> Agora RTC room
                         |-> Agora STT UID 900003 -> Protobuf captions
                         |                            |-> browser partial captions
                         |                            `-> final turns -> Railway/Postgres
                         |                                             |-> Live Notes
                         |                                             `-> Final Notes + Markdown
                         `-> Copilot UID 900001 -> GPT Live Alpha voice participant
                                                    |-> final voice turns -> shared transcript
                                                    `-> Responses delegation -> board function call
                                                                               |-> shared Kanban service
                                                                               `-> result returned to GPT Live
Browser board workspace -> manual card operation --------------------------------^ -> PostgreSQL + room SSE
```

GPT Live Alpha is limited to approved, low-volume internal testing. The gateway
uses the alpha Live API contract and must be updated if that contract changes.
RTM remains enabled for UI/transcript events, but RTM user turns cannot mutate
the board.

Turning local captions off does not stop the room transcript. Only the host can
end the room for everyone. Ended meeting links remain unlisted and available for
24 hours, with `meeting-transcript.md`, `meeting-notes.md`, and a ZIP containing
exactly those two files.

Active rooms use the shareable URL `/?room=meet-...`. Ending a room moves every
participant to `/summary?room=meet-...`, which can be refreshed or shared to
reopen the transcript, notes, and downloads.

## Verify

```bash
npm run build
npm run test:e2e
cd services/orchestrator
npm test
npm run build
```
