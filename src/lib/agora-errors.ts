type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

export function isScreenShareCancellation(error: unknown) {
  const { code, message, name } = errorParts(error);
  const details = `${code} ${name} ${message}`;

  return name === "AbortError"
    || /permission denied by (?:the )?user|user (?:canceled|cancelled)/i.test(details)
    || (name === "NotAllowedError" && /denied|cancel/i.test(message))
    || (code === "PERMISSION_DENIED" && /NotAllowedError/i.test(details));
}

export function screenShareErrorMessage(error: unknown) {
  const { code, message, name } = errorParts(error);
  const details = `${code} ${name} ${message}`;

  if (/not.?supported/i.test(details)) return "Screen sharing is not supported in this browser.";
  if (/NotReadableError|not.?readable|screen.?record/i.test(details)) {
    return "Your screen could not be captured. Check system screen recording permissions and try again.";
  }
  return "Screen sharing could not start. Please try again.";
}

function errorParts(error: unknown) {
  const value = error && typeof error === "object" ? error as ErrorLike : {};
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : typeof error === "string" ? error : "",
    name: typeof value.name === "string" ? value.name : ""
  };
}
