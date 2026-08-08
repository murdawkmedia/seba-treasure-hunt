import { campaignHunterSession } from "./account";

type JsonRecord = Record<string, unknown>;

interface PublicClue {
  id: string;
  sequence: number;
  label: string;
  sealed: boolean;
  title: string | null;
  riddle: string | null;
  decoderAccess: "public_sample" | "released_member" | "early_access" | "sign_in_required" | null;
  earlyAccess: "purchase_required" | "waiting_verification" | null;
  decoder: string | null;
  narrowing: string | null;
  digPermit: {
    access: "unavailable" | "sign_in_required" | "waiver_required" | "permitted";
    instruction: string | null;
    maxDepthMm: number | null;
    allowedTools: string[];
  } | null;
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
    const sealed = text(row.state) === "sealed" || row.sealed === true;
    const decoderRecord = record(row.decoder) ? row.decoder : {};
    const decoderAccess = text(decoderRecord.access ?? row.decoderAccess);
    const earlyAccessRecord = record(row.earlyAccess) ? row.earlyAccess : {};
    const earlyAccess = text(earlyAccessRecord.access);
    const digPermitRecord = record(row.digPermit) ? row.digPermit : null;
    const digAccess = digPermitRecord ? text(digPermitRecord.access) : null;
    clues.push({
      id,
      sequence,
      label: text(row.label) ?? `Clue ${String(sequence).padStart(2, "0")} — ${sealed ? "Sealed" : "Released"}`,
      sealed,
      title: sealed ? null : text(row.title),
      riddle: sealed ? null : text(row.riddle),
      decoderAccess: decoderAccess === "public_sample" || decoderAccess === "released_member" || decoderAccess === "early_access" || decoderAccess === "sign_in_required" ? decoderAccess : null,
      earlyAccess: earlyAccess === "purchase_required" || earlyAccess === "waiting_verification" ? earlyAccess : null,
      decoder: sealed ? null : text(decoderRecord.explanation ?? row.decoder),
      narrowing: sealed ? null : text(decoderRecord.narrowingSummary ?? decoderRecord.narrowing ?? row.narrowingSummary ?? row.narrowing),
      digPermit: digAccess === "unavailable" || digAccess === "sign_in_required" || digAccess === "waiver_required" || digAccess === "permitted" ? {
        access: digAccess,
        instruction: digAccess === "permitted" ? text(digPermitRecord?.instruction) : null,
        maxDepthMm: digAccess === "permitted" ? number(digPermitRecord?.maxDepthMm) : null,
        allowedTools: digAccess === "permitted" && Array.isArray(digPermitRecord?.allowedTools)
          ? digPermitRecord.allowedTools.filter((tool): tool is string => typeof tool === "string")
          : [],
      } : null,
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
    return { order: { id, clueId, status, reference, version }, payment: { status: paymentStatus, amountCad: null, recipient: null, instructions: null, validationOnly: false } };
  }
  if (!instructions || paymentRow.amountCad !== 5) return null;
  const recipient = text(paymentRow.recipient);
  return { order: { id, clueId, status, reference, version }, payment: { status: "instructions", amountCad: 5, recipient, instructions, validationOnly: recipient === null } };
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
  if (input.environment !== "production") return { payable: false, address: "Test payment only — do not send money", message: "Validation mode: this is a disposable test order. Do not send a real e-transfer." };
  return { payable: Boolean(input.paymentAddress), address: input.paymentAddress ?? "Payment address unavailable", message: "Send exactly $5 CAD and include your unique reference in the transfer message." };
}

function button(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "clues-button";
  link.href = href;
  link.textContent = label;
  return link;
}

function appendDigPermit(item: HTMLElement, clue: PublicClue): void {
  if (!clue.digPermit) return;
  const permit = document.createElement("aside");
  permit.className = "clue-card__permit";
  if (clue.digPermit.access === "unavailable") {
    permit.textContent = "Controlled digging is not currently available here. Follow the normal no-dig rule.";
  } else if (clue.digPermit.access === "permitted") {
    const depth = clue.digPermit.maxDepthMm ? ` Maximum depth: ${clue.digPermit.maxDepthMm} mm.` : "";
    const tools = clue.digPermit.allowedTools.length ? ` Allowed tools: ${clue.digPermit.allowedTools.join(", ")}.` : "";
    permit.textContent = `Controlled shallow digging is permitted only as stated here: ${clue.digPermit.instruction ?? "Follow the marked-area instruction."}${depth}${tools} Refill and smooth the area when finished.`;
  } else if (clue.digPermit.access === "waiver_required") {
    permit.append("This clue includes a controlled shallow-digging permit. Accept the current waiver before viewing its exact instruction. ", button("Review waiver", "/dashboard#profile"));
  } else {
    permit.append("This clue includes a controlled shallow-digging permit. ", button("Sign in to view it", `/dashboard?intent=signin&returnTo=${encodeURIComponent("/clues")}`));
  }
  item.append(permit);
}

function renderClues(clues: PublicClue[], signedIn: boolean): void {
  const list = document.querySelector<HTMLOListElement>("[data-clue-list]");
  if (!list) return;
  list.replaceChildren();
  for (const clue of clues) {
    const item = document.createElement("li");
    item.className = `clue-card ${clue.sealed ? "clue-card--sealed" : "clue-card--released"}`;
    const numberLabel = document.createElement("p");
    numberLabel.className = "clue-card__number";
    numberLabel.textContent = `Clue ${String(clue.sequence).padStart(2, "0")}`;
    const heading = document.createElement("h3");
    heading.textContent = clue.sealed ? "Sealed" : clue.title ?? "Released clue";
    item.append(numberLabel, heading);
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
      if (clue.decoderAccess !== "sign_in_required" && clue.decoder) decoder.textContent = `Decoder: ${clue.decoder}${clue.narrowing ? ` What this narrows down: ${clue.narrowing}` : ""}`;
      else decoder.textContent = "Decoder: sign in to read the plain-English explanation.";
      item.append(decoder);
      if (clue.decoderAccess === "sign_in_required") item.append(button("Sign in to read the decoder", `/dashboard?intent=signin&returnTo=${encodeURIComponent("/clues")}`));
      else if (signedIn) item.append(button("Open in My Hunt", "/dashboard#my-clues"));
      appendDigPermit(item, clue);
    } else if (clue.earlyAccess) {
      const early = document.createElement("p");
      early.className = "clue-card__decoder";
      early.textContent = clue.earlyAccess === "waiting_verification" ? "Your $5 early-access payment is waiting for verification." : "Signed-in hunters may buy early access to this next clue for $5 CAD before it is released.";
      item.append(early, button(clue.earlyAccess === "waiting_verification" ? "Check My Hunt" : "Buy the next clue early", "/dashboard#my-clues"));
    }
    list.append(item);
  }
}

async function initializeClues(): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-clue-state]");
  const retry = document.querySelector<HTMLButtonElement>("[data-clue-retry]");
  if (!state) return;
  const load = async (): Promise<void> => {
    if (retry) retry.hidden = true;
    state.textContent = "Opening the clue file…";
    try {
      const session = await campaignHunterSession();
      const token = await session?.getToken().catch(() => null);
      const response = await fetch("/api/v1/clues", { headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) });
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
  item.className = `clue-card ${clue.sealed ? "clue-card--sealed" : "clue-card--released"}`;
  const numberLabel = document.createElement("p");
  numberLabel.className = "clue-card__number";
  numberLabel.textContent = `Clue ${String(clue.sequence).padStart(2, "0")}`;
  const heading = document.createElement("h3");
  heading.textContent = clue.sealed ? "The next sealed clue" : clue.title ?? "Released clue";
  item.append(numberLabel, heading);
  if (clue.sealed) {
    const status = document.createElement("p");
    status.className = "clue-card__decoder";
    status.textContent = clue.earlyAccess === "waiting_verification" || order?.status === "waiting_verification" ? `Waiting for payment verification${order?.reference ? ` · ${order.reference}` : ""}` : "You can buy early access to this one upcoming clue for $5 CAD. Later clues remain sealed.";
    item.append(status);
    if (clue.earlyAccess === "purchase_required") {
      const action = document.createElement("button");
      action.className = "clues-button";
      action.type = "button";
      action.textContent = "Buy early access to the next clue";
      action.dataset.clueOrderStart = clue.id;
      item.append(action);
    }
    return item;
  }
  const riddle = document.createElement("div");
  riddle.className = "clue-card__riddle";
  const riddleLabel = document.createElement("strong");
  riddleLabel.textContent = "Riddle";
  const riddleCopy = document.createElement("p");
  riddleCopy.textContent = clue.riddle ?? "This riddle is unavailable.";
  riddle.append(riddleLabel, riddleCopy);
  item.append(riddle);
  if (clue.decoder && clue.decoderAccess !== "sign_in_required") {
    const decoded = document.createElement("div");
    decoded.className = "clue-card__riddle clue-card__riddle--decoded";
    const label = document.createElement("strong");
    label.textContent = clue.decoderAccess === "early_access" ? "Early-access decoder" : "Decoder";
    const copy = document.createElement("p");
    copy.textContent = clue.decoder;
    decoded.append(label, copy);
    if (clue.narrowing) {
      const narrowing = document.createElement("p");
      narrowing.textContent = `What this narrows down: ${clue.narrowing}`;
      decoded.append(narrowing);
    }
    item.append(decoded);
  }
  appendDigPermit(item, clue);
  return item;
}

async function authenticatedJson(path: string, init: RequestInit = {}): Promise<{ response: Response; payload: unknown }> {
  const session = await campaignHunterSession();
  const token = await session?.getToken().catch(() => null);
  if (!token) throw new Error("Please sign in to use My Clues.");
  const response = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}), Authorization: `Bearer ${token}` }, credentials: "same-origin", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(10_000) });
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
    if (retry) retry.hidden = true;
    state.textContent = "Loading your clues and early-access status…";
    try {
      const { response, payload } = await authenticatedJson("/api/v1/me/clues");
      if (!response.ok) throw new Error("Your clue ledger could not be loaded.");
      projection = normalizeMyClues(payload);
      list.replaceChildren();
      for (const clue of projection.clues.filter((row) => !row.sealed || row.earlyAccess !== null)) list.append(memberClueCard(clue, projection.orders.find((order) => order.clueId === clue.id)));
      const released = projection.clues.filter((clue) => !clue.sealed).length;
      state.textContent = `${released} released clue${released === 1 ? "" : "s"}. Only the next sealed clue can be bought early.`;
    } catch (error) {
      state.textContent = error instanceof Error ? error.message : "Your clue ledger could not be loaded.";
      if (retry) retry.hidden = false;
    }
  };
  list.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-clue-order-start]") : null;
    if (!target || !projection) return;
    target.disabled = true;
    state.textContent = "Preparing your unique early-access reference…";
    try {
      const { response, payload } = await authenticatedJson(`/api/v1/clues/${encodeURIComponent(target.dataset.clueOrderStart ?? "")}/orders`, { method: "POST", body: "{}" });
      if (!response.ok) throw new Error("Early access to the next clue could not be prepared.");
      const orderResponse = normalizeClueOrderResponse(payload);
      if (!orderResponse) throw new Error("Early access to the next clue could not be prepared.");
      activeOrder = orderResponse.order;
      if (orderResponse.payment.status === "waiting_verification" || orderResponse.payment.status === "unlocked") {
        state.textContent = orderResponse.payment.status === "waiting_verification" ? "This payment is already waiting for verification." : "This clue is already unlocked for you.";
        await load();
        return;
      }
      const presentation = orderPaymentPresentation({ environment: orderResponse.payment.validationOnly ? "validation" : "production", paymentAddress: orderResponse.payment.recipient });
      const address = dialog.querySelector<HTMLElement>("[data-clue-payment-address]");
      const reference = dialog.querySelector<HTMLElement>("[data-clue-order-reference]");
      const environment = dialog.querySelector<HTMLElement>("[data-clue-order-environment]");
      if (address) address.textContent = presentation.address;
      if (reference) reference.textContent = activeOrder.reference;
      if (environment) environment.textContent = presentation.message;
      const claimButton = dialog.querySelector<HTMLButtonElement>("[data-clue-order-claim] button[type=submit]");
      if (claimButton) claimButton.disabled = !orderResponse.payment.validationOnly && !presentation.payable;
      dialog.showModal();
      state.textContent = "Your early-access payment reference is ready.";
    } catch (error) {
      state.textContent = error instanceof Error ? error.message : "Early access to the next clue could not be prepared.";
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
      if (result) result.textContent = "Enter the 2–100 character name used on the e-transfer.";
      return;
    }
    try {
      const { response } = await authenticatedJson(`/api/v1/me/clue-orders/${encodeURIComponent(activeOrder.id)}/claim`, { method: "POST", body: JSON.stringify({ senderName, expectedVersion: activeOrder.version }) });
      if (!response.ok) throw new Error("Your payment claim could not be saved.");
      if (result) result.textContent = "Waiting for verification. Your reference is saved in My Hunt.";
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
