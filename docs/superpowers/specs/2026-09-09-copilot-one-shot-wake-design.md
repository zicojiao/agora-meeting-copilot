# Copilot One-Shot Wake Design

## Goal

Prevent GPT-Live-1 Copilot from joining ordinary human-to-human discussion. For the demo, every Copilot response must require a fresh, explicit spoken address in the current utterance.

## Evidence and Constraint

Production transcripts show Copilot answering human turns that did not address it. The current agent subscribes to all room audio, while standby is expressed only in the initial prompt. The GPT Live v3 provider in the installed Agora SDK ignores `turnDetection`, so VAD and eagerness tuning cannot enforce participation policy.

## Behavior

- Copilot listens while present but speaks only when the current completed utterance directly addresses `Copilot`.
- A previous address never authorizes later turns. Every response, follow-up, and board command requires a fresh address.
- Ordinary questions, pauses, agreements, and discussion between Zico and Hermes produce no response and no board tool call.
- After one assistant response, the room returns immediately to standby.
- `Thanks Copilot`, `stop Copilot`, and equivalent stop phrases return to standby without another substantive answer.
- The server recognizes the existing `Copilot` and `co-pilot` forms plus the observed transcription alias `Purvis`, which occurred when the spoken wake name was misrecognized in the failed demo.

## Defense in Depth

The initial model prompt starts with a highest-priority participation contract. It removes the conflicting `active teammate` wording, defines silence as the default, prohibits acknowledgements and tool calls without a fresh address, and includes explicit three-person meeting examples.

The server policy becomes one-shot: only a fresh wake match opens focus. A non-wake human turn sends an interrupt to the live session and closes any stale focus state. An assistant final turn always closes focus and returns the room to standby.

The existing all-participant audio subscription remains unchanged so Copilot retains live meeting context. This change does not attempt unsupported GPT Live v3 turn-detection configuration.

## Failure Handling

An interrupt failure is non-fatal and does not break transcript ingestion. The prompt remains the first guard, and the room still records the non-wake policy decision. No new credentials, resources, database migrations, or client permissions are required.

## Testing

- Prompt tests assert silent-by-default wording, fresh-address requirements, and removal of the conflicting active-teammate language.
- Policy tests assert that plain follow-ups no longer extend focus, wake variants work, and stop phrases close focus.
- Room-service tests assert that ordinary human turns interrupt and remain in standby, explicit wake turns open focus, and assistant completion immediately returns to standby.
- Existing Agora join/auth/payload tests remain green.
- Run orchestrator unit tests, frontend typecheck/lint/build, and the full Playwright suite before deployment.
- Deploy only the existing Railway `orchestrator` service, then verify health/readiness and confirm no stale preview agents remain.
