import { prepareReportImages, ReportImagePreparationError } from "./report-image-preparation";

type ItemStatus = "draft" | "out_there" | "found" | "paused" | "archived";
type ItemOwner = "tim" | "casey";

interface ItemUpload {
  id: string;
  status: string;
  size: number;
  altText: string;
  caption: string;
  position: number | null;
}

interface OpsCaseItem {
  id: string;
  slug: string;
  owner: ItemOwner;
  category: string;
  title: string;
  description: string;
  finderKeeps: boolean;
  status: ItemStatus;
  displayOrder: number;
  version: number;
  updatedAt: string;
  uploads: ItemUpload[];
  history: Array<Record<string, unknown>>;
}

type OpsRequest = (url: string, init?: RequestInit) => Promise<{ response: Response; payload: unknown }>;

interface OpsItemsDependencies {
  request: OpsRequest;
  fetchBinary: (url: string) => Promise<Response>;
  onAnnouncementDraft: (updateId: string) => void | Promise<void>;
}

let dependencies: OpsItemsDependencies | null = null;
let objectUrls: string[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const integer = (value: unknown, fallback = 0): number => Number.isInteger(value) ? Number(value) : fallback;
const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const apiError = (payload: unknown, fallback: string): string => {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return string(error.message) || fallback;
};

const normalizeUpload = (value: unknown): ItemUpload | null => {
  if (!isRecord(value)) return null;
  const id = string(value.id);
  if (!id) return null;
  return {
    id,
    status: string(value.status) || "pending",
    size: Number(value.size) || 0,
    altText: string(value.altText),
    caption: string(value.caption),
    position: typeof value.position === "number" && Number.isInteger(value.position) ? value.position : null,
  };
};

const normalizeItem = (value: unknown): OpsCaseItem | null => {
  if (!isRecord(value)) return null;
  const id = string(value.id);
  const slug = string(value.slug);
  const owner = value.owner;
  const status = value.status;
  if (!id || !slug || (owner !== "tim" && owner !== "casey") ||
      !["draft", "out_there", "found", "paused", "archived"].includes(String(status))) return null;
  return {
    id,
    slug,
    owner,
    category: string(value.category),
    title: string(value.title),
    description: string(value.description),
    finderKeeps: value.finderKeeps === true,
    status: status as ItemStatus,
    displayOrder: integer(value.displayOrder),
    version: integer(value.version, 1),
    updatedAt: string(value.updatedAt),
    uploads: Array.isArray(value.uploads) ? value.uploads.map(normalizeUpload).filter((entry): entry is ItemUpload => entry !== null) : [],
    history: Array.isArray(value.history) ? value.history.filter(isRecord) : [],
  };
};

const statusOptions = (selected: ItemStatus): string => [
  ["draft", "Draft"],
  ["out_there", "Out there"],
  ["found", "Found"],
  ["paused", "Paused"],
  ["archived", "Archived"],
].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");

const uploadCard = (item: OpsCaseItem, upload: ItemUpload): string => {
  const ready = upload.status === "ready";
  const selected = upload.position !== null;
  return `<article data-item-upload="${escapeHtml(upload.id)}">
    ${ready ? `<img data-item-media-url="/api/v1/ops/items/${encodeURIComponent(item.id)}/media/${encodeURIComponent(upload.id)}" alt="" />` : `<p class="ops-item-media__pending">Image is ${escapeHtml(upload.status)}. Refresh after processing.</p>`}
    <label class="ops-confirm"><input type="checkbox" data-item-media-selected${selected ? " checked" : ""}${ready ? "" : " disabled"} /><span>Show this image publicly</span></label>
    <label>Alt text<input data-item-media-alt maxlength="200" value="${escapeHtml(upload.altText)}" placeholder="Describe the image for someone who cannot see it"${selected ? " required" : ""} /></label>
    <label>Caption <span>(optional)</span><input data-item-media-caption maxlength="500" value="${escapeHtml(upload.caption)}" /></label>
    <button class="ops-button ops-button--danger" type="button" data-item-media-remove>Remove image</button>
  </article>`;
};

const itemCard = (item: OpsCaseItem): string => {
  const lastEvent = item.history[0];
  const lastAction = lastEvent ? `${string(lastEvent.action) || "Updated"} · ${string(lastEvent.occurredAt) || item.updatedAt}` : item.updatedAt;
  return `<article class="ops-item-card" data-item-id="${escapeHtml(item.id)}" data-item-version="${item.version}">
    <header class="ops-item-card__header"><div><p class="ops-kicker">${escapeHtml(item.owner === "tim" ? "Tim" : "Casey")} · version ${item.version}</p><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.status.replaceAll("_", " "))}</p></div><button class="ops-button ops-button--quiet" type="button" data-item-announcement>Create Latest News draft</button></header>
    <form data-item-edit-form novalidate>
      <div class="ops-item-form-grid">
        <label>Owner<select name="owner" required><option value="tim"${item.owner === "tim" ? " selected" : ""}>Tim</option><option value="casey"${item.owner === "casey" ? " selected" : ""}>Casey</option></select></label>
        <label>Status<select name="status" required>${statusOptions(item.status)}</select></label>
        <label>Public title<input name="title" maxlength="160" value="${escapeHtml(item.title)}" required /></label>
        <label>Slug<input name="slug" maxlength="80" value="${escapeHtml(item.slug)}" required /></label>
        <label>Category<input name="category" maxlength="80" value="${escapeHtml(item.category)}" required /></label>
        <label>Display order<input name="displayOrder" type="number" min="0" max="999" value="${item.displayOrder}" required /></label>
        <label class="ops-item-form-grid__wide">Short public description<textarea name="description" rows="3" maxlength="1000" required>${escapeHtml(item.description)}</textarea></label>
        <label class="ops-confirm ops-item-form-grid__wide"><input name="finderKeeps" type="checkbox"${item.finderKeeps ? " checked" : ""} /><span>The finder keeps this item.</span></label>
      </div>
      <section aria-label="Item images"><h3>Images <small>(up to three)</small></h3><div class="ops-item-media">${item.uploads.length ? item.uploads.map((upload) => uploadCard(item, upload)).join("") : `<p class="ops-item-media__pending">No item images uploaded.</p>`}</div>
        <label>Choose images<input data-item-media-files type="file" accept="image/jpeg,image/png,image/webp" multiple /></label>
        <button class="ops-button ops-button--quiet" type="button" data-item-media-upload>Prepare &amp; upload images</button>
      </section>
      <p class="ops-item-history">Last recorded event: ${escapeHtml(lastAction || "Unavailable")}</p>
      <div class="ops-action-row"><button class="ops-button ops-button--primary" type="submit">Save item changes</button><span class="ops-inline-result" data-item-result role="status" aria-live="polite"></span></div>
    </form>
  </article>`;
};

const setGuide = (state: string, next: string, kind: "loading" | "ready" | "empty" | "error"): void => {
  const root = document.querySelector<HTMLElement>('[data-ops-guide="items"]');
  if (!root) return;
  const stateNode = root.querySelector<HTMLElement>("[data-guide-state]");
  const nextNode = root.querySelector<HTMLElement>("[data-guide-next]");
  if (stateNode) stateNode.textContent = state;
  if (nextNode) nextNode.textContent = next;
  root.dataset.kind = kind;
  root.toggleAttribute("aria-busy", kind === "loading");
};

const resultFor = (root: Element, message: string, error = false): void => {
  const result = root.querySelector<HTMLElement>("[data-item-result]");
  if (!result) return;
  result.textContent = message;
  result.dataset.kind = error ? "error" : "success";
};

const revokeObjectUrls = (): void => {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
};

const hydratePrivateImages = async (): Promise<void> => {
  if (!dependencies) return;
  const images = [...document.querySelectorAll<HTMLImageElement>("[data-item-media-url]")];
  await Promise.all(images.map(async (image) => {
    const url = image.dataset.itemMediaUrl;
    if (!url) return;
    try {
      const response = await dependencies?.fetchBinary(url);
      if (!response?.ok) throw new Error();
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.push(objectUrl);
      image.src = objectUrl;
      const alt = image.closest("article")?.querySelector<HTMLInputElement>("[data-item-media-alt]")?.value.trim();
      image.alt = alt || "Private item image preview";
    } catch {
      image.replaceWith(Object.assign(document.createElement("p"), { textContent: "Private preview unavailable. Refresh and try again." }));
    }
  }));
};

export async function loadOpsItems(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-ops-items]");
  if (!root || !dependencies) return;
  setGuide("Loading item board", "Wait for the current versions before changing a public fact.", "loading");
  try {
    const { response, payload } = await dependencies.request("/api/v1/ops/items");
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.data)) {
      throw new Error(apiError(payload, "The item board could not be loaded."));
    }
    const items = payload.data.map(normalizeItem).filter((item): item is OpsCaseItem => item !== null);
    revokeObjectUrls();
    root.innerHTML = items.length ? items.map(itemCard).join("") : `<div class="ops-empty"><strong>No items yet</strong><span>Use Add a new item to create a private draft.</span></div>`;
    await hydratePrivateImages();
    setGuide(
      items.length ? `${items.length} item records loaded` : "No items yet",
      items.length ? "Choose one item, make the smallest necessary change, then save." : "Create a private Draft first.",
      items.length ? "ready" : "empty",
    );
  } catch (error) {
    root.innerHTML = `<div class="ops-empty"><strong>Item board unavailable</strong><span>${escapeHtml(error instanceof Error ? error.message : "Refresh and try again.")}</span></div>`;
    setGuide("Item board unavailable", "Choose Refresh Items. No public item was changed.", "error");
  }
}

const itemPayload = (form: HTMLFormElement, item?: Element): Record<string, unknown> => {
  const data = new FormData(form);
  const mediaSelections = item ? [...item.querySelectorAll<HTMLElement>("[data-item-upload]")].flatMap((card) => {
    const selected = card.querySelector<HTMLInputElement>("[data-item-media-selected]")?.checked === true;
    if (!selected) return [];
    return [{
      id: card.dataset.itemUpload ?? "",
      altText: card.querySelector<HTMLInputElement>("[data-item-media-alt]")?.value.trim() ?? "",
      caption: card.querySelector<HTMLInputElement>("[data-item-media-caption]")?.value.trim() || null,
    }];
  }) : [];
  return {
    slug: string(data.get("slug")),
    owner: string(data.get("owner")),
    category: string(data.get("category")),
    title: string(data.get("title")),
    description: string(data.get("description")),
    finderKeeps: data.get("finderKeeps") === "on",
    status: string(data.get("status")),
    displayOrder: Number(data.get("displayOrder")),
    ...(item ? { expectedVersion: Number((item as HTMLElement).dataset.itemVersion), mediaSelections } : {}),
  };
};

const editItem = async (form: HTMLFormElement): Promise<void> => {
  if (!dependencies) return;
  const item = form.closest<HTMLElement>("[data-item-id]");
  if (!item) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  resultFor(item, "Saving…");
  try {
    const { response, payload } = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(item.dataset.itemId ?? "")}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(itemPayload(form, item)),
    });
    if (!response.ok) throw new Error(apiError(payload, response.status === 409 ? "This item changed. Refresh and try again." : "The item was not saved."));
    await loadOpsItems();
  } catch (error) {
    resultFor(item, error instanceof Error ? error.message : "The item was not saved.", true);
  } finally {
    if (submit) submit.disabled = false;
  }
};

const createItem = async (form: HTMLFormElement): Promise<void> => {
  if (!dependencies) return;
  const result = form.querySelector<HTMLElement>("[data-item-create-result]");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  if (result) result.textContent = "Creating private item…";
  try {
    const { response, payload } = await dependencies.request("/api/v1/ops/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(itemPayload(form)),
    });
    if (!response.ok) throw new Error(apiError(payload, "The item was not created."));
    form.reset();
    if (result) result.textContent = "Private item created.";
    await loadOpsItems();
  } catch (error) {
    if (result) result.textContent = error instanceof Error ? error.message : "The item was not created.";
  } finally {
    if (submit) submit.disabled = false;
  }
};

const uploadImages = async (button: HTMLButtonElement): Promise<void> => {
  if (!dependencies) return;
  const item = button.closest<HTMLElement>("[data-item-id]");
  const input = item?.querySelector<HTMLInputElement>("[data-item-media-files]");
  if (!item || !input?.files?.length) {
    if (item) resultFor(item, "Choose one to three images first.", true);
    return;
  }
  button.disabled = true;
  resultFor(item, "Preparing images privately in this browser…");
  try {
    const prepared = await prepareReportImages([...input.files]);
    const body = new FormData();
    for (const image of prepared) body.append("images", image.upload, image.upload.name);
    const { response, payload } = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(item.dataset.itemId ?? "")}/media`, { method: "POST", body });
    if (!response.ok) throw new Error(apiError(payload, "The images were not uploaded."));
    await loadOpsItems();
  } catch (error) {
    const message = error instanceof ReportImagePreparationError ? error.message : error instanceof Error ? error.message : "The images were not uploaded.";
    resultFor(item, message, true);
  } finally {
    button.disabled = false;
  }
};

const removeImage = async (button: HTMLButtonElement): Promise<void> => {
  if (!dependencies) return;
  const item = button.closest<HTMLElement>("[data-item-id]");
  const media = button.closest<HTMLElement>("[data-item-upload]");
  if (!item || !media || !window.confirm("Remove this private item image? This is audited and cannot be undone from this screen.")) return;
  button.disabled = true;
  const { response, payload } = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(item.dataset.itemId ?? "")}/media/${encodeURIComponent(media.dataset.itemUpload ?? "")}`, { method: "DELETE" });
  if (!response.ok) {
    resultFor(item, apiError(payload, "The image was not removed."), true);
    button.disabled = false;
    return;
  }
  await loadOpsItems();
};

const createAnnouncement = async (button: HTMLButtonElement): Promise<void> => {
  if (!dependencies) return;
  const item = button.closest<HTMLElement>("[data-item-id]");
  if (!item) return;
  button.disabled = true;
  resultFor(item, "Creating a private Latest News draft…");
  try {
    const { response, payload } = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(item.dataset.itemId ?? "")}/announcement-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) throw new Error(apiError(payload, "The announcement draft was not created."));
    const updateId = string(payload.data.id);
    resultFor(item, "Private draft created. Nothing was published.");
    await dependencies.onAnnouncementDraft(updateId);
  } catch (error) {
    resultFor(item, error instanceof Error ? error.message : "The announcement draft was not created.", true);
  } finally {
    button.disabled = false;
  }
};

export function setupOpsItems(next: OpsItemsDependencies): void {
  dependencies = next;
  document.querySelector<HTMLFormElement>("[data-item-create-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createItem(event.currentTarget as HTMLFormElement);
  });
  document.querySelector<HTMLElement>("[data-ops-items]")?.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-item-edit-form]")) return;
    event.preventDefault();
    void editItem(form);
  });
  document.querySelector<HTMLElement>("[data-ops-items]")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const upload = target.closest<HTMLButtonElement>("[data-item-media-upload]");
    const remove = target.closest<HTMLButtonElement>("[data-item-media-remove]");
    const announcement = target.closest<HTMLButtonElement>("[data-item-announcement]");
    if (upload) void uploadImages(upload);
    else if (remove) void removeImage(remove);
    else if (announcement) void createAnnouncement(announcement);
  });
  window.addEventListener("pagehide", revokeObjectUrls, { once: true });
}
