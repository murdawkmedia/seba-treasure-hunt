export type TurnstileResetReason = "submission_failed" | "submitted" | "expired" | "new_form";

export type TurnstileLifecycleEvent =
  | { kind: "rendered"; form: string }
  | { kind: "reset"; form: string; reason: TurnstileResetReason };

export function createTurnstileLifecycle() {
  const rendered = new Set<string>();
  const log: TurnstileLifecycleEvent[] = [];

  return {
    beginRender(form: string): boolean {
      if (rendered.has(form)) return false;
      rendered.add(form);
      log.push({ kind: "rendered", form });
      return true;
    },
    recordReset(form: string, reason: TurnstileResetReason): void {
      log.push({ kind: "reset", form, reason });
    },
    events(): TurnstileLifecycleEvent[] {
      return [...log];
    },
    counts(): { rendered: number; reset: number } {
      return {
        rendered: log.filter((event) => event.kind === "rendered").length,
        reset: log.filter((event) => event.kind === "reset").length
      };
    }
  };
}
