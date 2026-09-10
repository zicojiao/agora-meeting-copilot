# Local Transcript Clear

## Goal

Add a small `Clear` action to the live meeting Transcript panel. The action clears only the transcript entries shown in the current browser session. It must not mutate server data or affect another participant's view.

## Behavior

- The Transcript panel header shows a compact `Clear` button beside the existing captions control.
- The button is disabled when there are no visible finalized entries to clear.
- Activating it hides every transcript entry currently known to this browser.
- Transcript entries received after the clear action appear normally.
- The cleared state survives switching between meeting side panels because it is owned by `MeetingRoom`, not by the mounted `TranscriptPanel` instance.
- Reloading or reopening the page restores the full server-backed transcript.
- Clearing resets the currently selected transcript evidence row if that row is hidden.
- Captions, the live caption overlay, meeting notes, server persistence, final artifacts, and transcript downloads are unchanged.

## Component and Data Flow

`MeetingRoom` owns a set of locally hidden transcript entry keys. On clear, it adds the keys for every current unified transcript entry to that set and clears `selectedSegmentId`. It passes only entries whose keys are not hidden to `TranscriptPanel`.

An entry key combines its source and ID so meeting-transcription segments and Copilot turns cannot collide. Because only existing keys are captured, subsequent entries remain visible.

`TranscriptPanel` receives an `onClear` callback and renders the action in its existing header. No network request or orchestrator endpoint is added.

## Interface

The action uses the existing panel palette, type scale, spacing, button primitive, and visible focus treatment. It uses a restrained clear/trash icon with the label `Clear`; it is not styled as a destructive server action because refreshing restores the content.

## Error Handling

There is no remote operation to fail. Repeated activation is idempotent. If no entries are visible, the action remains disabled.

## Testing

- Verify that clicking `Clear` removes current transcript entries from the local panel.
- Verify that it does not disable captions or invoke a backend deletion request.
- Verify that a newly received transcript entry appears after clearing.
- Verify that switching side panels does not restore cleared entries.
- Verify that reloading restores server-backed entries.
- Run typecheck, focused unit/UI tests, and the existing build/smoke checks appropriate to the changed files.
