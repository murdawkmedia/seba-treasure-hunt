export function createSerializedSubmission<T>(
  submit: () => Promise<T>,
): () => Promise<T | null> {
  let inFlight = false;
  return async () => {
    if (inFlight) return null;
    inFlight = true;
    try {
      return await submit();
    } finally {
      inFlight = false;
    }
  };
}
