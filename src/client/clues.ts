import { campaignHunterSession } from "./account";

type JsonRecord = Record<string, unknown>;

interface PublicClue {
  id: string;
  sequence: number;
  label: string;
  sealed: boolean;
  title: string | null;
  riddle: string | null;
  decoderMode: "paid" | "free" | null;
  decoderAccess: "unlocked" | "purchase_required" | "waiting_verification" | null;
  decoder: string | null;
  narrowing: string | null;
}

interface ClueOrder {
  id: string;
  clueId: string;
  status: string;
  reference: string;
  version: number;
}

interface ClueOrderPayment {
  status: "instructions" | "waiting_verification" | "unlocked";
  amountCad: 5 | null;
  recipient: string | null;
  instructions: string | null;
  validationOnly: boolean;
}

export interface ClueOrderResponse {
  order: ClueOrder;
  payment: ClueOrderPayment;
}

export interface MyCluesProjection {
  clues: PublicClue[];
  orders: ClueOrder[];
  environment: string | null;
  paymentAddress: string | null;
}

const record = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) ? value : null;

export function normalizePublicClues(payload: unknown): PublicClue[] {
  const envelope = record(payload) && record(payload.data) ? payload.data : payload;
  const rows = Array.isArray(envelope) ? envelope : record(envelope) && Array.isArray(envelope.clues) ? envelope.clues : [];
  const clues: PublicClue[] = [];
  for (const row of rows) {
    if (!record(row)) continue;
    const sequence = number(row.sequence);
    const id = text(row.id);
    if (!id || sequence === null || sequence < 1 || sequence > 30) continue;
    const state = text(row.state);
    const sealed = state === "sealed" || row.sealed === true;
    const decoderRecord = record(row.decoder) ? row.decoder : {};
    const decoderMode = text(decoderRecord.mode ?? row.decoderMode);
    const decoderAccess = text(decoderRecord.access ?? row.decoderAccess);
    clues.push({
      id,
      sequence,
      label: text(row.label) ?? `Clue ${String(sequence).padStart(2, "0")} — ${sealed ? "Sealed" : "Released"}`,
      sealed,
      title: sealed ? null : text(row.title),
      riddle: sealed ? null : text(row.riddle),
      decoderMode: decoderMode === "paid" || decoderMode === "free" ? decoderMode : null,
      decoderAccess: decoderAccess === "unlocked" || decoderAccess === "purchase_required" || decoderAccess === "waiting_verification" ? decoderAccess : null,
      decoder: sealed ? null : text(decoderRecord.explanation ?? row.decoder),
      narrowing: sealed ? null : text(decoderRecord.narrowingSummary ?? decoderRecord.narrowing ?? row.narrowingSummary ?? row.narrowing),
    });
  }
  return clues.sort((left, right) => left.sequence - right.sequence);
}

export function normalizeClueOrderResponse(payload: unknown): ClueOrderResponse | null {
  const envelope = record(payload) && record(payload.data) ? payload.data : record(payload) ? payload : {};
  const orderRow = record(envelope.order) ? envelope.order : {};
  const paymentRow = record(envelope.payment) ? envelope.payment : {};
  const id = text(orderRow.id);
  const clueId = text(orderRow.clueId);
  const status = text(orderRow.status);
  const reference = text(orderRow.reference);
  const version = number(orderRow.version);
  const paymentStatus = text(paymentRow.status);
  const instructions = text(paymentRow.instructions);
  if (!id || !clueId || !status || !reference || version === null) return null;
  if (paymentStatus === "waiting_verification" || paymentStatus === "unlocked") {
    return {
      order: { id, clueId, status, reference, version },
      payment: { status: paymentStatus, amountCad: null, recipient: null, instructions: null, validationOnly: false },
    };
  }
  if (!instructions || paymentRow.amountCad !== 5) return null;
  const recipient = text(paymentRow.recipient);
  return {
    order: { id, clueId, status, reference, version },
    payment: { status: "instructions", amountCad: 5, recipient, instructions, validationOnly: recipient === null },
  };
}

export function normalizeMyClues(payload: unknown): MyCluesProjection {
  const envelope = record(payload) && record(payload.data) ? payload.data : record(payload) ? payload : {};
  const orders: ClueOrder[] = [];
  for (const row of Array.isArray(envelope.orders) ? envelope.orders : []) {
    if (!record(row)) continue;
    const id = text(row.id);
    const clueId = text(row.clueId);
    const reference = text(row.reference);
    const status = text(row.status);
    const version = number(row.version);
    if (id && clueId && reference && status && version !== null) orders.push({ id, clueId, reference, status, version });
  }
  return {
    clues: normalizePublicClues({ clues: Array.isArray(envelope.clues) ? envelope.clues : [] }),
    orders,
    environment: text(envelope.environment ?? envelope.deploymentEnvironment),
    paymentAddress: text(envelope.paymentAddress),
  };
}

export function orderPaymentPresentation(input: { environment: string | null; paymentAddress: string | null }): { payable: boolean; address: string; message: string } {
  if (input.environment !== "production") {
    return {
      payable: false,
      address: "Test payment only — do not send money",
      message: "Validation mode: this is a disposable test order. Do not send a real e-transfer.",
    };
  }
  return {
    payable: Boolean(input.paymentAddress),
    address: input.paymentAddress ?? "Payment address unavailable",
    message: "Send exactly $5 CAD and include your unique reference in the transfer message.",
  };
}

function button(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "clues-button";
  link.href = href;
  link.textContent = label;
  return link;
}

function renderClues(clues: PublicClue[], signedIn: boolean): void {
  const list = document.querySelector<HTMLOListElement>("[data-clue-list]");
  if (!list) return;
  list.replaceChildren();
  for (const clue of clues) {
    const item = document.createElement("li");
    item.className = `clue-card ${clue.sealed ? "clue-card--sealed" : "clue-card--released"}`;
    const clueNumber = document.createElement("p");
    clueNumber.className = "clue-card__number";
    clueNumber.textContent = `Clue ${String(clue.sequence).padStart(2, "0")}`;
    const heading = document.createElement("h3");
    heading.textContent = clue.sealed ? "Sealed" : clue.title ?? "Released clue";
    item.append(clueNumber, heading);
    if (!clue.sealed && clue.riddle) {
      const riddle = document.createElement("div");
      riddle.className = "clue-card__riddle";
      const label = document.createElement("strong");
      label.textContent = "Riddle";
      const copy = document.createElement("p");
      copy.textContent = clue.riddle;
      riddle.append(label, copy);
      item.append(riddle);
      const decoder = document.createElement("p");
      decoder.className = "clue-card__decoder";
      if (clue.decoderAccess === "unlocked" && clue.decoder) {
        decoder.textContent = `Decoder: ${clue.decoder}${clue.narrowing ? ` What this narrows down: ${clue.narrowing}` : ""}`;
      } else if (clue.decoderAccess === "waiting_verification") {
        decoder.textContent = "Decoder: Waiting for verification in My Hunt.";
      } else if (clue.decoderMode === "free") {
        decoder.textContent = "The free decoder is available in My Hunt.";
      } else {
        decoder.textContent = "Optional decoder: $5 CAD.";
      }
      item.append(decoder);
      const actions = document.createElement("div");
      actions.className = "clue-card__actions";
      actions.append(button(clue.decoderAccess === "unlocked" ? "Open My Decoder" : "Get the optional decoder", signedIn ? "/dashboard#my-clues" : `/dashboard?intent=signin&returnTo=${encodeURIComponent("/dashboard#my-clues")}`));
      item.append(actions);
    }
    list.append(item);
  }
}

async function initializeClues(): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-clue-state]");
  const retry = document.querySelector<HTMLButtonElement>("[data-clue-retry]");
  if (!state) return;
  const load = async (): Promise<void> => {
    retry && (retry.hidden = true);
    state.textContent = "Opening the clue file…";
    try {
      const session = await campaignHunterSession();
      const token = await session?.getToken().catch(() => null);
      const response = await fetch("/api/v1/clues", {
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("The clue file is temporarily unavailable.");
      const clues = normalizePublicClues(payload);
      renderClues(clues, Boolean(token));
      state.textContent = `${clues.filter((clue) => !clue.sealed).length} released · ${clues.filter((clue) => clue.sealed).length} sealed`;
    } catch (error) {
      state.textContent = error instanceof Error ? error.message : "The clue file is temporarily unavailable.";
      if (retry) retry.hidden = false;
    }
  };
  retry?.addEventListener("click", () => void load());
  await load();
}

function memberClueCard(clue: PublicClue, order: ClueOrder | undefined): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "clue-card clue-card--released";
  const numberLabel = document.createElement("p");
  numberLabel.className = "clue-card__number";
  numberLabel.textContent = `Clue ${String(clue.sequence).padStart(2, "0")}`;
  const heading = document.createElement("h3");
  heading.textContent = clue.title ?? "Released clue";
  const riddle = document.createElement("div");
  riddle.className = "clue-card__riddle";
  const riddleLabel = document.createElement("strong");
  riddleLabel.textContent = "Riddle";
  const riddleCopy = document.createElement("p");
  riddleCopy.textContent = clue.riddle ?? "This riddle is unavailable.";
  riddle.append(riddleLabel, riddleCopy);
  item.append(numberLabel, heading, riddle);
  if (clue.decoderAccess === "unlocked" && clue.decoder) {
    const decoded = document.createElement("div");
    decoded.className = "clue-card__riddle clue-card__riddle--decoded";
    const label = document.createElement("strong");
    label.textContent = "Decoder";
    const copy = document.createElement("p");
    copy.textContent = clue.decoder;
    decoded.append(label, copy);
    if (clue.narrowing) {
      const narrowing = document.createElement("p");
      narrowing.textContent = `What this narrows down: ${clue.narrowing}`;
      decoded.append(narrowing);
    }
    item.append(decoded);
  } else {
    const status = document.createElement("p");
    status.className = "clue-card__decoder";
    status.textContent = clue.decoderAccess === "waiting_verification" || order?.status === "waiting_verification"
      ? `Waiting for verification${order?.reference ? ` · ${order.reference}` : ""}`
      : clue.decoderMode === "free"
        ? "This decoder is free."
        : "Optional decoder · $5 CAD";
    item.append(status);
    if (clue.decoderAccess !== "waiting_verification" && order?.status !== "waiting_verification") {
      const action = document.createElement("button");
      action.className = "clues-button";
      action.type = "button";
      action.textContent = clue.decoderMode === "free" ? "Open free decoder" : "Get this decoder";
      action.dataset.clueOrderStart = clue.id;
      item.append(action);
    }
  }
  return item;
}

async function authenticatedJson(path: string, init: RequestInit = {}): Promise<{ response: Response; payload: unknown }> {
  const session = await campaignHunterSession();
  const token = await session?.getToken().catch(() => null);
  if (!token) throw new Error("Please sign in to use My Decoders.");
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  return { response, payload };
}

async function initializeMyClues(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-my-clues]");
  const list = root?.querySelector<HTMLOListElement>("[data-my-clue-list]");
  const state = root?.querySelector<HTMLElement>("[data-my-clues-state]");
  const retry = root?.querySelector<HTMLButtonElement>("[data-my-clues-retry]");
  const dialog = document.querySelector<HTMLDialogElement>("[data-clue-order-dialog]");
  if (!root || !list || !state || !dialog) return;
  let projection: MyCluesProjection | null = null;
  let activeOrder: ClueOrder | null = null;

  const load = async (): Promise<void> => {
    retry && (retry.hidden = true);
    state.textContent = "Loading your clues and decoder access…";
    try {
      const { response, payload } = await authenticatedJson("/api/v1/me/clues");
      if (!response.ok) throw new Error("Your decoder ledger could not be loaded.");
      projection = normalizeMyClues(payload);
      list.replaceChildren();
      for (const clue of projection.clues.filter((row) => !row.sealed)) {
        list.append(memberClueCard(clue, projection.orders.find((order) => order.clueId === clue.id)));
      }
      state.textContent = `${projection.clues.filter((clue) => !clue.sealed).length} released clue${projection.clues.filter((clue) => !clue.sealed).length === 1 ? "" : "s"} in your ledger.`;
    } catch (error) {
      state.textContent = error instanceof Error ? error.message : "Your decoder ledger could not be loaded.";
      if (retry) retry.hidden = false;
    }
  };

  list.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-clue-order-start]") : null;
    if (!target || !projection) return;
    target.disabled = true;
    state.textContent = "Preparing your unique decoder reference…";
    try {
      const { response, payload } = await authenticatedJson(`/api/v1/clues/${encodeURIComponent(target.dataset.clueOrderStart ?? "")}/orders`, { method: "POST", body: "{}" });
      if (!response.ok) throw new Error("Your decoder order could not be prepared.");
      const orderResponse = normalizeClueOrderResponse(payload);
      if (!orderResponse) throw new Error("Your decoder order could not be prepared.");
      activeOrder = orderResponse.order;
      if (orderResponse.payment.status === "waiting_verification") {
        state.textContent = "This decoder is already waiting for verification.";
        await load();
        return;
      }
      if (orderResponse.payment.status === "unlocked") {
        state.textContent = "This decoder is already unlocked.";
        await load();
        return;
      }
      const presentation = orderPaymentPresentation({
        environment: orderResponse.payment.validationOnly ? "validation" : "production",
        paymentAddress: orderResponse.payment.recipient,
      });
      const address = dialog.querySelector<HTMLElement>("[data-clue-payment-address]");
      const reference = dialog.querySelector<HTMLElement>("[data-clue-order-reference]");
      const environment = dialog.querySelector<HTMLElement>("[data-clue-order-environment]");
      if (address) address.textContent = presentation.address;
      if (reference) reference.textContent = activeOrder.reference;
      if (environment) environment.textContent = presentation.message;
      const claimButton = dialog.querySelector<HTMLButtonElement>("[data-clue-order-claim] button[type=submit]");
      if (claimButton) claimButton.disabled = !orderResponse.payment.validationOnly && !presentation.payable;
      dialog.showModal();
      state.textContent = "Your decoder reference is ready.";
    } catch (error) {
      state.textContent = error instanceof Error ? error.message : "Your decoder order could not be prepared.";
    } finally {
      target.disabled = false;
    }
  });

  dialog.querySelector<HTMLButtonElement>("[data-clue-order-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector<HTMLFormElement>("[data-clue-order-claim]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const result = form.querySelector<HTMLElement>("[data-clue-order-result]");
    const senderName = new FormData(form).get("senderName")?.toString().trim() ?? "";
    if (!activeOrder || senderName.length < 2 || senderName.length > 100) {
      if (result) result.textContent = "Enter the 2-100 character name used on the e-transfer.";
      return;
    }
    try {
      const { response } = await authenticatedJson(`/api/v1/me/clue-orders/${encodeURIComponent(activeOrder.id)}/claim`, { method: "POST", body: JSON.stringify({ senderName, expectedVersion: activeOrder.version }) });
      if (!response.ok) throw new Error("Your payment claim could not be saved.");
      if (result) result.textContent = "Waiting for verification. Your reference is saved in My Decoders.";
      await load();
    } catch (error) {
      if (result) result.textContent = error instanceof Error ? error.message : "Your payment claim could not be saved.";
    }
  });
  retry?.addEventListener("click", () => void load());
  await load();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void initializeClues(), { once: true });
  else void initializeClues();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void initializeMyClues(), { once: true });
  else void initializeMyClues();
}
