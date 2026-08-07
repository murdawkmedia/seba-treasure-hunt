type ClueState = "draft" | "ready" | "released" | "retired";
type DecoderMode = "paid" | "free";
type OrderStatus = "created" | "waiting_verification" | "approved" | "rejected" | "cancelled";
type OpsRequest = (url: string, init?: RequestInit) => Promise<{ response: Response; payload: unknown }>;

export interface OpsClue {
  id: string;
  sequence: number;
  title: string;
  riddle: string;
  decoderExplanation: string;
  narrowingSummary: string;
  internalNapkinNote: string;
  internalScore: number;
  state: ClueState;
  decoderMode: DecoderMode;
  version: number;
}

export interface OpsClueOrder {
  id: string;
  clueId: string;
  clueSequence: number;
  clueTitle: string;
  reference: string;
  senderName: string;
  status: OrderStatus;
  decisionNote: string;
  version: number;
  updatedAt: string;
}

interface Dependencies {
  request: OpsRequest;
}

let dependencies: Dependencies | null = null;
let clues: OpsClue[] = [];
let orders: OpsClueOrder[] = [];
let orderNextCursor: string | null = null;
let waitingOrderCount = 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const integer = (value: unknown): number | null => Number.isInteger(value) ? Number(value) : null;
const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const apiError = (payload: unknown, fallback: string): string => {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return text(error.message) || fallback;
};

export const responseNextCursor = (payload: unknown): string | null => {
  if (!isRecord(payload) || !isRecord(payload.page)) return null;
  return text(payload.page.nextCursor) || null;
};

export const responseWaitingCount = (payload: unknown): number => {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const counts = isRecord(data.counts) ? data.counts : {};
  return integer(counts.waiting_verification) ?? 0;
};

export function normalizeOpsClues(payload: unknown): OpsClue[] {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : {};
  const rows = Array.isArray(data.clues) ? data.clues : Array.isArray(data) ? data : [];
  return rows.flatMap((row): OpsClue[] => {
    if (!isRecord(row)) return [];
    const id = text(row.id);
    const sequence = integer(row.sequence);
    const state = text(row.state);
    const decoderMode = text(row.decoderMode);
    const version = integer(row.version);
    if (!id || sequence === null || sequence < 1 || sequence > 30 || version === null || version < 1 ||
        !["draft", "ready", "released", "retired"].includes(state) || !["paid", "free"].includes(decoderMode)) return [];
    return [{
      id, sequence, title: text(row.title), riddle: text(row.riddle),
      decoderExplanation: text(row.decoderExplanation), narrowingSummary: text(row.narrowingSummary),
      internalNapkinNote: text(row.internalNapkinNote), internalScore: integer(row.internalScore) ?? 0,
      state: state as ClueState, decoderMode: decoderMode as DecoderMode, version,
    }];
  }).sort((left, right) => left.sequence - right.sequence);
}

export function normalizeOpsClueOrders(payload: unknown): OpsClueOrder[] {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : {};
  const rows = Array.isArray(data.orders) ? data.orders : Array.isArray(data) ? data : [];
  return rows.flatMap((row): OpsClueOrder[] => {
    if (!isRecord(row)) return [];
    const id = text(row.id);
    const clueId = text(row.clueId);
    const clueSequence = integer(row.clueSequence);
    const status = text(row.status);
    const version = integer(row.version);
    if (!id || !clueId || clueSequence === null || version === null ||
        !["created", "waiting_verification", "approved", "rejected", "cancelled"].includes(status)) return [];
    return [{
      id, clueId, clueSequence, clueTitle: text(row.clueTitle), reference: text(row.reference),
      senderName: text(row.senderName), status: status as OrderStatus, decisionNote: text(row.decisionNote),
      version, updatedAt: text(row.updatedAt),
    }];
  });
}

export function clueWorkflowGuidance(currentClues: readonly OpsClue[], currentOrders: readonly OpsClueOrder[], totalWaiting?: number) {
  if (!currentClues.length) return {
    state: "No clue records loaded",
    next: "Import the reviewed clue ledger before releasing anything.",
    kind: "empty" as const,
  };
  const waiting = totalWaiting ?? currentOrders.filter((order) => order.status === "waiting_verification").length;
  const next = currentClues.find((clue) => clue.state === "ready");
  if (waiting) return {
    state: `${waiting} payment${waiting === 1 ? "" : "s"} waiting for verification`,
    next: "Match each sender and reference, then choose Approve, Reject, or Cancel.",
    kind: "ready" as const,
  };
  if (next) return {
    state: `Clue ${String(next.sequence).padStart(2, "0")} is Ready`,
    next: `Review Clue ${String(next.sequence).padStart(2, "0")}, then use Release the next clue when marketing is ready.`,
    kind: "ready" as const,
  };
  return {
    state: `${currentClues.filter((clue) => clue.state === "released").length} clues released`,
    next: "Edit a Draft and mark it Ready only after its facts and safety language are approved.",
    kind: "ready" as const,
  };
}

const renderClue = (clue: OpsClue): string => `<article class="ops-card" data-ops-clue-id="${escapeHtml(clue.id)}" data-ops-clue-version="${clue.version}">
  <header><div><p class="ops-kicker">Clue ${String(clue.sequence).padStart(2, "0")} &middot; ${escapeHtml(clue.state)}</p><h3>${escapeHtml(clue.title || "Untitled private clue")}</h3></div><strong>${clue.decoderMode === "free" ? "Free decoder" : "$5 decoder"}</strong></header>
  <details><summary>Review and edit the private clue</summary>
    <form data-ops-clue-edit>
      <label>Title<input name="title" value="${escapeHtml(clue.title)}" required maxlength="160"></label>
      <label>Riddle<textarea name="riddle" required maxlength="8000">${escapeHtml(clue.riddle)}</textarea></label>
      <label>Decoder explanation<textarea name="decoderExplanation" required maxlength="8000">${escapeHtml(clue.decoderExplanation)}</textarea></label>
      <label>What this narrows down<textarea name="narrowingSummary" required maxlength="2000">${escapeHtml(clue.narrowingSummary)}</textarea></label>
      <label>Private napkin note<textarea name="internalNapkinNote" maxlength="8000">${escapeHtml(clue.internalNapkinNote)}</textarea></label>
      <label>Private score<input name="internalScore" type="number" step="1" value="${clue.internalScore}"></label>
      <label>Editorial state<select name="state"><option value="draft"${clue.state === "draft" ? " selected" : ""}>Draft</option><option value="ready"${clue.state === "ready" ? " selected" : ""}>Ready</option><option value="retired"${clue.state === "retired" ? " selected" : ""}>Retired</option>${clue.state === "released" ? '<option value="released" selected>Released (use Retract to change)</option>' : ""}</select></label>
      <label>Decoder access<select name="decoderMode"><option value="paid"${clue.decoderMode === "paid" ? " selected" : ""}>Paid &middot; $5 CAD</option><option value="free"${clue.decoderMode === "free" ? " selected" : ""}>Free</option></select></label>
      <div class="ops-action-row"><button class="ops-button" type="submit">Save private clue</button>${clue.state === "ready" ? '<button class="ops-button ops-button--primary" type="button" data-clue-release>Release the next clue</button>' : ""}${clue.state === "released" ? '<button class="ops-button ops-button--quiet" type="button" data-clue-notify>Notify opted-in hunters</button><button class="ops-button ops-button--danger" type="button" data-clue-retract>Retract to Ready</button>' : ""}</div>
      <p role="status" aria-live="polite" data-clue-result></p>
    </form>
  </details>
</article>`;

export const renderOrder = (order: OpsClueOrder): string => `<article class="ops-card" data-ops-clue-order-id="${escapeHtml(order.id)}" data-ops-clue-order-version="${order.version}">
  <header><div><p class="ops-kicker">Clue ${String(order.clueSequence).padStart(2, "0")} &middot; ${escapeHtml(order.status.replaceAll("_", " "))}</p><h3>${escapeHtml(order.reference)}</h3></div></header>
  <dl><div><dt>Sender name</dt><dd>${escapeHtml(order.senderName || "Not supplied yet")}</dd></div><div><dt>Clue</dt><dd>${escapeHtml(order.clueTitle)}</dd></div></dl>
  <label>Private decision note<textarea data-order-note maxlength="1000">${escapeHtml(order.decisionNote)}</textarea></label>
  <div class="ops-action-row">${order.status === "waiting_verification" ? '<button class="ops-button ops-button--primary" type="button" data-order-decision="approve">Approve and unlock</button><button class="ops-button ops-button--danger" type="button" data-order-decision="reject">Reject</button><button class="ops-button ops-button--quiet" type="button" data-order-decision="cancel">Cancel</button>' : order.status === "approved" ? '<button class="ops-button" type="button" data-order-notify>Check or retry decoder email</button>' : order.status === "rejected" || order.status === "cancelled" ? '<button class="ops-button" type="button" data-order-decision="reopen">Reopen</button>' : ""}</div>
  <p role="status" aria-live="polite" data-order-result></p>
</article>`;

const setState = (selector: string, message: string): void => {
  const node = document.querySelector<HTMLElement>(selector);
  if (node) node.textContent = message;
};

const updateGuide = (): void => {
  const model = clueWorkflowGuidance(clues, orders, waitingOrderCount);
  const guide = document.querySelector<HTMLElement>('[data-ops-guide="clues"]');
  if (!guide) return;
  guide.dataset.kind = model.kind;
  const state = guide.querySelector<HTMLElement>("[data-guide-state]");
  const next = guide.querySelector<HTMLElement>("[data-guide-next]");
  if (state) state.textContent = model.state;
  if (next) next.textContent = model.next;
};

export async function loadOpsClues(): Promise<void> {
  if (!dependencies) return;
  setState("[data-ops-clues-state]", "Loading the private clue ledger...");
  setState("[data-ops-clue-orders-state]", "Loading payment claims...");
  const [clueResult, orderResult] = await Promise.all([
    dependencies.request("/api/v1/ops/clues"),
    dependencies.request("/api/v1/ops/clue-orders?limit=50"),
  ]);
  if (!clueResult.response.ok) throw new Error(apiError(clueResult.payload, "The clue ledger could not be loaded."));
  if (!orderResult.response.ok) throw new Error(apiError(orderResult.payload, "Payment claims could not be loaded."));
  clues = normalizeOpsClues(clueResult.payload);
  orders = normalizeOpsClueOrders(orderResult.payload);
  orderNextCursor = responseNextCursor(orderResult.payload);
  waitingOrderCount = responseWaitingCount(orderResult.payload);
  const clueRoot = document.querySelector<HTMLElement>("[data-ops-clues]");
  const orderRoot = document.querySelector<HTMLElement>("[data-ops-clue-orders]");
  if (clueRoot) clueRoot.innerHTML = clues.length ? clues.map(renderClue).join("") : '<p class="ops-empty">No clue records loaded.</p>';
  const waitingFirst = [...orders].sort((a, b) => Number(b.status === "waiting_verification") - Number(a.status === "waiting_verification"));
  if (orderRoot) orderRoot.innerHTML = waitingFirst.length ? waitingFirst.map(renderOrder).join("") : '<p class="ops-empty">No payment claims yet.</p>';
  const more = document.querySelector<HTMLButtonElement>("[data-ops-clue-orders-more]");
  if (more) more.hidden = orderNextCursor === null;
  setState("[data-ops-clues-state]", `${clues.length} private clue records loaded. Nothing changed.`);
  setState("[data-ops-clue-orders-state]", `${waitingOrderCount} waiting for verification. ${orders.length} payment records loaded.`);
  const badge = document.querySelector<HTMLElement>("#nav-clue-order-count");
  if (badge) badge.textContent = String(waitingOrderCount);
  updateGuide();
}

async function loadMoreOpsClueOrders(button: HTMLButtonElement): Promise<void> {
  if (!dependencies || !orderNextCursor) return;
  button.disabled = true;
  setState("[data-ops-clue-orders-state]", "Loading more payment records...");
  try {
    const result = await dependencies.request(`/api/v1/ops/clue-orders?limit=50&cursor=${encodeURIComponent(orderNextCursor)}`);
    if (!result.response.ok) throw new Error(apiError(result.payload, "More payment records could not be loaded."));
    const incoming = normalizeOpsClueOrders(result.payload);
    const existingIds = new Set(orders.map((order) => order.id));
    orders.push(...incoming.filter((order) => !existingIds.has(order.id)));
    orderNextCursor = responseNextCursor(result.payload);
    waitingOrderCount = responseWaitingCount(result.payload);
    const root = document.querySelector<HTMLElement>("[data-ops-clue-orders]");
    if (root) root.innerHTML = [...orders].sort((a, b) => Number(b.status === "waiting_verification") - Number(a.status === "waiting_verification")).map(renderOrder).join("");
    button.hidden = orderNextCursor === null;
    setState("[data-ops-clue-orders-state]", `${waitingOrderCount} waiting for verification. ${orders.length} payment records loaded.`);
    updateGuide();
  } catch (error) {
    setState("[data-ops-clue-orders-state]", error instanceof Error ? error.message : "More payment records could not be loaded.");
  } finally {
    button.disabled = false;
  }
}

const mutation = async (url: string, body: Record<string, unknown>, result: HTMLElement | null): Promise<void> => {
  if (!dependencies) return;
  if (result) result.textContent = "Saving...";
  const response = await dependencies.request(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.response.ok) throw new Error(apiError(response.payload, "Nothing changed. Refresh and try again."));
  if (result) result.textContent = "Saved. Refreshing the current ledger...";
  await loadOpsClues();
};

export function setupOpsClues(next: Dependencies): void {
  dependencies = next;
  const clueRoot = document.querySelector<HTMLElement>("[data-ops-clues]");
  const orderRoot = document.querySelector<HTMLElement>("[data-ops-clue-orders]");
  document.querySelector<HTMLButtonElement>("[data-ops-clue-orders-more]")?.addEventListener("click", (event) => {
    void loadMoreOpsClueOrders(event.currentTarget as HTMLButtonElement);
  });
  clueRoot?.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-ops-clue-edit]")) return;
    event.preventDefault();
    const card = form.closest<HTMLElement>("[data-ops-clue-id]");
    if (!card || !dependencies) return;
    const data = new FormData(form);
    const result = form.querySelector<HTMLElement>("[data-clue-result]");
    const editorialState = text(data.get("state"));
    const response = await dependencies.request(`/api/v1/ops/clues/${encodeURIComponent(card.dataset.opsClueId ?? "")}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expectedVersion: Number(card.dataset.opsClueVersion), title: text(data.get("title")), riddle: text(data.get("riddle")),
        decoderExplanation: text(data.get("decoderExplanation")), narrowingSummary: text(data.get("narrowingSummary")),
        internalNapkinNote: text(data.get("internalNapkinNote")), internalScore: Number(data.get("internalScore")),
        ...(editorialState === "released" ? {} : { state: editorialState }), decoderMode: text(data.get("decoderMode")),
      }),
    });
    if (!response.response.ok) { if (result) result.textContent = apiError(response.payload, "Nothing changed. Refresh and try again."); return; }
    await loadOpsClues();
  });
  clueRoot?.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-clue-release],[data-clue-retract],[data-clue-notify]") : null;
    const card = button?.closest<HTMLElement>("[data-ops-clue-id]");
    if (!button || !card) return;
    const result = card.querySelector<HTMLElement>("[data-clue-result]");
    try {
      if (button.matches("[data-clue-release]") && window.confirm("Release this clue now? The riddle becomes visible immediately. The decoder does not become free automatically.")) {
        await mutation(`/api/v1/ops/clues/${encodeURIComponent(card.dataset.opsClueId ?? "")}/release`, { expectedVersion: Number(card.dataset.opsClueVersion) }, result);
      } else if (button.matches("[data-clue-retract]")) {
        const reason = window.prompt("Why is this clue being retracted? Hunters who already bought it keep their decoder access.")?.trim();
        if (reason) await mutation(`/api/v1/ops/clues/${encodeURIComponent(card.dataset.opsClueId ?? "")}/retract`, { expectedVersion: Number(card.dataset.opsClueVersion), reason }, result);
      } else if (button.matches("[data-clue-notify]") && window.confirm("Email this released clue to current hunt-email subscribers? This can be sent only once for this release.")) {
        await mutation(`/api/v1/ops/clues/${encodeURIComponent(card.dataset.opsClueId ?? "")}/notify`, { expectedVersion: Number(card.dataset.opsClueVersion), confirmNotify: true }, result);
      }
    } catch (error) { if (result) result.textContent = error instanceof Error ? error.message : "Nothing changed."; }
  });
  orderRoot?.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-order-decision],[data-order-notify]") : null;
    const card = button?.closest<HTMLElement>("[data-ops-clue-order-id]");
    if (!button || !card) return;
    const decision = button.dataset.orderDecision ?? "";
    const note = card.querySelector<HTMLTextAreaElement>("[data-order-note]")?.value.trim() ?? "";
    const result = card.querySelector<HTMLElement>("[data-order-result]");
    if (button.matches("[data-order-notify]")) {
      if (!window.confirm("Check the existing decoder email and retry it only if delivery is safely retryable?")) return;
      try {
        await mutation(`/api/v1/ops/clue-orders/${encodeURIComponent(card.dataset.opsClueOrderId ?? "")}/notify`, { expectedVersion: Number(card.dataset.opsClueOrderVersion), confirmNotify: true }, result);
      } catch (error) { if (result) result.textContent = error instanceof Error ? error.message : "The decoder email could not be retried."; }
      return;
    }
    if (decision === "reject" && !note) { if (result) result.textContent = "Enter a private reason before rejecting."; return; }
    if (!window.confirm(`${decision === "approve" ? "Approve this $5 payment and unlock the decoder" : `${decision[0]?.toUpperCase()}${decision.slice(1)} this payment record`}?`)) return;
    try {
      await mutation(`/api/v1/ops/clue-orders/${encodeURIComponent(card.dataset.opsClueOrderId ?? "")}/${encodeURIComponent(decision)}`, { expectedVersion: Number(card.dataset.opsClueOrderVersion), decisionNote: note || null }, result);
    } catch (error) { if (result) result.textContent = error instanceof Error ? error.message : "Nothing changed."; }
  });
}
