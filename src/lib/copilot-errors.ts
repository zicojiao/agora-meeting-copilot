const OWN_VOICE_TURN_REJECTION = "A participant can submit only their own voice turn";

export function shouldSilenceCopilotTurnSubmissionError(error: unknown) {
  return error instanceof Error && error.message === OWN_VOICE_TURN_REJECTION;
}
