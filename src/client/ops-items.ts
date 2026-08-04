import { prepareReportImages, ReportImagePreparationError } from "./report-image-preparation";

type ItemStatus = "draft" | "out_there" | "found" | "paused" | "archived";
type ItemOwner = "tim" | "casey";
type ItemCollection = "case" | "fresh_drops";
type ItemAudience = "public" | "hunter_only";

interface ItemUpload {
  id: string;
  status: string;
  size: number;
  altText: string;
  caption: string;
  position: number | null;
  audience: ItemAudience;
  sourceSha256: string;
}

interface OpsCaseItem {
  id: string;
  slug: string;
  owner: ItemOwner;
  category: string;
  title: string;
  description: string;
  finderKeeps: boolean;
  closeOnFind: boolean;
  status: ItemStatus;
  displayOrder: number;
  collection: ItemCollection;
  collectionOrder: number | null;
  audience: ItemAudience;
  showOnBoard: boolean;
  teaserOrder: 1 | 2 | null;
  reportable: boolean;
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

const apiErrorRecord = (payload: unknown): Record<string, unknown> | null => {
  if (!isRecord(payload)) return null;
  return isRecord(payload.error) ? payload.error : payload;
};

export const quickItemStatusAction = (status: ItemStatus): { target: "out_there" | "found"; label: string } | null => {
  if (status === "out_there") return { target: "found", label: "Mark found" };
  if (status === "found") return { target: "out_there", label: "Mark out there" };
  return null;
};

export const quickItemStatusConfirmation = (title: string, target: "out_there" | "found"): string =>
  `Mark ${title} as ${target === "found" ? "FOUND" : "OUT THERE"}? This audited status change does not publish an announcement.`;

export const requestQuickItemStatus = async (
  itemId: string,
  expectedVersion: number,
  status: "out_there" | "found",
  request: OpsRequest,
  reload: () => Promise<void>
): Promise<{ response: Response; payload: unknown }> => {
  const result = await request(`/api/v1/ops/items/${encodeURIComponent(itemId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion, status, confirmed: true })
  });
  if (result.response.ok || result.response.status === 409) await reload();
  return result;
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
    audience: value.audience === "hunter_only" ? "hunter_only" : "public",
    sourceSha256: /^[a-f0-9]{64}$/i.test(string(value.sourceSha256)) ? string(value.sourceSha256) : "",
  };
};

export const normalizeItem = (value: unknown): OpsCaseItem | null => {
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
    closeOnFind: value.closeOnFind === true,
    status: status as ItemStatus,
    displayOrder: integer(value.displayOrder),
    collection: value.collection === "fresh_drops" ? "fresh_drops" : "case",
    collectionOrder: typeof value.collectionOrder === "number" && Number.isInteger(value.collectionOrder)
      ? value.collectionOrder
      : null,
    audience: value.audience === "hunter_only" ? "hunter_only" : "public",
    showOnBoard: value.showOnBoard !== false,
    teaserOrder: value.teaserOrder === 1 || value.teaserOrder === 2 ? value.teaserOrder : null,
    reportable: value.reportable !== false,
    version: integer(value.version, 1),
    updatedAt: string(value.updatedAt),
    uploads: Array.isArray(value.uploads) ? value.uploads.map(normalizeUpload).filter((entry): entry is ItemUpload => entry !== null) : [],
    history: Array.isArray(value.history) ? value.history.filter(isRecord) : [],
  };
};

export const itemPlacementModel = (
  audience: ItemAudience,
  _showOnBoard: boolean,
  teaserOrder: 1 | 2 | null,
  occupied?: { id: string; title: string } | null
) => audience === "hunter_only"
  ? {
      showOnBoardEnabled: false,
      teaserEnabled: false,
      explanation: "Visible only to participation-unlocked hunters."
    }
  : {
      showOnBoardEnabled: true,
      teaserEnabled: true,
      explanation: occupied && teaserOrder !== null
        ? `Teaser slot ${teaserOrder} currently shows ${occupied.title}. Choose Replace to move it.`
        : "Public items may appear on the main board or in one homepage teaser slot."
    };

const statusOptions = (selected: ItemStatus): string => [
  ["draft", "Draft"],
  ["out_there", "Out there"],
  ["found", "Found"],
  ["paused", "Paused"],
  ["archived", "Archived"],
].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");

const collectionOptions = (selected: ItemCollection): string => [
  ["case", "Main case"],
  ["fresh_drops", "Fresh Drops"]
].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");

const audienceOptions = (selected: ItemAudience): string => [
  ["hunter_only", "Signed-in hunters only"],
  ["public", "Public"]
].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");

const teaserOptions = (selected: 1 | 2 | null): string => [
  ["", "Not in teaser"],
  ["1", "Slot 1"],
  ["2", "Slot 2"]
].map(([value, label]) => `<option value="${value}"${String(selected ?? "") === value ? " selected" : ""}>${label}</option>`).join("");

const uploadCard = (item: OpsCaseItem, upload: ItemUpload): string => {
  const ready = upload.status === "ready";
  const selected = upload.position !== null;
  return `<article data-item-upload="${escapeHtml(upload.id)}">
    ${ready ? `<img data-item-media-url="/api/v1/ops/items/${encodeURIComponent(item.id)}/media/${encodeURIComponent(upload.id)}" alt="" />` : `<p class="ops-item-media__pending">Image is ${escapeHtml(upload.status)}. Refresh after processing.</p>`}
    <label class="ops-confirm"><input type="checkbox" data-item-media-selected${selected ? " checked" : ""}${ready ? "" : " disabled"} /><span>Use this image on the item</span></label>
    <label>Image visibility<select data-item-media-audience${ready ? "" : " disabled"}>${audienceOptions(upload.audience)}</select></label>
    <label>Alt text<input data-item-media-alt maxlength="200" value="${escapeHtml(upload.altText)}" placeholder="Describe the image for someone who cannot see it"${selected ? " required" : ""} /></label>
    <label>Caption <span>(optional)</span><input data-item-media-caption maxlength="500" value="${escapeHtml(upload.caption)}" /></label>
    <button class="ops-button ops-button--danger" type="button" data-item-media-remove>Remove image</button>
  </article>`;
};

const itemCard = (item: OpsCaseItem): string => {
  const lastEvent = item.history[0];
  const lastAction = lastEvent ? `${string(lastEvent.action) || "Updated"} · ${string(lastEvent.occurredAt) || item.updatedAt}` : item.updatedAt;
  return `<article class="ops-item-card" data-item-id="${escapeHtml(item.id)}" data-item-version="${item.version}">
    <header class="ops-item-card__header"><div><p class="ops-kicker">${escapeHtml(item.owner === "tim" ? "Tim" : "Casey")} · version ${item.version}</p><h2>${escapeHtml(item.title)}</h2><div class="ops-item-badges"><span>${item.audience === "public" ? "Public" : "Hunter only"}</span>${item.showOnBoard ? "<span>Main board</span>" : ""}${item.teaserOrder ? `<span>Teaser ${item.teaserOrder}</span>` : ""}<span>${item.reportable ? "Reportable" : "Story only"}</span><span>${escapeHtml(item.status.replaceAll("_", " "))}</span></div></div><button class="ops-button ops-button--quiet" type="button" data-item-announcement>Create Latest News draft</button></header>
    <form data-item-edit-form novalidate>
      <div class="ops-item-form-grid">
        <label>Owner<select name="owner" required><option value="tim"${item.owner === "tim" ? " selected" : ""}>Tim</option><option value="casey"${item.owner === "casey" ? " selected" : ""}>Casey</option></select></label>
        <label>Status<select name="status" required>${statusOptions(item.status)}</select></label>
        <label>Collection<select name="collection" required>${collectionOptions(item.collection)}</select></label>
        <label>Collection order<input name="collectionOrder" type="number" min="0" max="999" value="${item.collectionOrder ?? ""}" /></label>
        <label>Who can see this item?<select name="audience" required>${audienceOptions(item.audience)}</select></label>
        <label>Homepage teaser slot<select name="teaserOrder">${teaserOptions(item.teaserOrder)}</select></label>
        <label>Item title<input name="title" maxlength="160" value="${escapeHtml(item.title)}" required /></label>
        <label>Slug<input name="slug" maxlength="80" value="${escapeHtml(item.slug)}" required /></label>
        <label>Category<input name="category" maxlength="80" value="${escapeHtml(item.category)}" required /></label>
        <label>Display order<input name="displayOrder" type="number" min="0" max="999" value="${item.displayOrder}" required /></label>
        <label class="ops-item-form-grid__wide">Short item description<textarea name="description" rows="3" maxlength="1000" required>${escapeHtml(item.description)}</textarea></label>
        <label class="ops-confirm"><input name="showOnBoard" type="checkbox"${item.showOnBoard ? " checked" : ""} /><span>Show on the main public evidence board</span></label>
        <label class="ops-confirm"><input name="reportable" type="checkbox"${item.reportable ? " checked" : ""} /><span>Hunters can report finding this item</span></label>
        <label class="ops-confirm ops-item-form-grid__wide"><input name="finderKeeps" type="checkbox"${item.finderKeeps ? " checked" : ""} /><span>The finder keeps this item.</span></label>
        <label class="ops-confirm ops-item-form-grid__wide"><input name="closeOnFind" type="checkbox"${item.closeOnFind ? " checked" : ""} /><span>Mark this finite item FOUND only when an operator publishes its reviewed find to What People Found.</span></label>
        <p class="ops-placement-explanation ops-item-form-grid__wide" data-item-placement-explanation></p>
      </div>
      <section aria-label="Item images"><h3>Images <small>(up to three)</small></h3><div class="ops-item-media">${item.uploads.length ? item.uploads.map((upload) => uploadCard(item, upload)).join("") : `<p class="ops-item-media__pending">No item images uploaded.</p>`}</div>
        <label>Choose images<input data-item-media-files type="file" accept="image/jpeg,image/png,image/webp" multiple /></label>
        <button class="ops-button ops-button--quiet" type="button" data-item-media-upload>Prepare &amp; upload images</button>
      </section>
      <section class="ops-item-previews" aria-label="Item visibility previews">
        <article data-item-public-preview><p class="ops-kicker">Public preview</p><h3></h3><p></p><small></small><ul></ul></article>
        <article data-item-hunter-preview><p class="ops-kicker">Signed-in hunter preview</p><h3></h3><p></p><small></small><ul></ul></article>
      </section>
      <div class="ops-teaser-conflict" data-item-teaser-conflict hidden></div>
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

const addQuickStatusControls = (root: HTMLElement, items: OpsCaseItem[]): void => {
  for (const item of items) {
    const action = quickItemStatusAction(item.status);
    if (!action) continue;
    const card = root.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(item.id)}"]`);
    const header = card?.querySelector<HTMLElement>(".ops-item-card__header");
    if (!header) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ops-button ops-button--status";
    button.dataset.itemQuickStatus = action.target;
    button.textContent = action.label;
    header.append(button);
  }
};

const resultFor = (root: Element, message: string, error = false): void => {
  const result = root.querySelector<HTMLElement>("[data-item-result]");
  if (!result) return;
  result.textContent = message;
  result.dataset.kind = error ? "error" : "success";
};

const resultForReloadedItem = (itemId: string, message: string, error = false): void => {
  const item = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`);
  if (!item) return;
  const result = item.querySelector<HTMLElement>("[data-item-result]");
  if (result) {
    resultFor(item, message, error);
    result.tabIndex = -1;
    result.focus();
    return;
  }
  const replacementAction = item.querySelector<HTMLElement>("[data-item-quick-status]");
  if (replacementAction) {
    replacementAction.focus();
    return;
  }
  const heading = item.querySelector<HTMLElement>("h2");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
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

const syncItemPresentation = (form: HTMLFormElement): void => {
  const audienceField = form.elements.namedItem("audience");
  const audience = audienceField instanceof HTMLSelectElement && audienceField.value === "public"
    ? "public"
    : "hunter_only";
  const showOnBoard = form.elements.namedItem("showOnBoard");
  const teaser = form.elements.namedItem("teaserOrder");
  if (showOnBoard instanceof HTMLInputElement) {
    if (audience === "hunter_only") showOnBoard.checked = false;
    showOnBoard.disabled = audience === "hunter_only";
  }
  if (teaser instanceof HTMLSelectElement) {
    if (audience === "hunter_only") teaser.value = "";
    teaser.disabled = audience === "hunter_only";
  }
  for (const mediaAudience of form.querySelectorAll<HTMLSelectElement>("[data-item-media-audience]")) {
    if (audience === "hunter_only") mediaAudience.value = "hunter_only";
    mediaAudience.disabled = audience === "hunter_only";
  }
  const explanation = form.querySelector<HTMLElement>("[data-item-placement-explanation]");
  if (explanation) {
    explanation.textContent = itemPlacementModel(
      audience,
      showOnBoard instanceof HTMLInputElement && showOnBoard.checked,
      teaser instanceof HTMLSelectElement && (teaser.value === "1" || teaser.value === "2")
        ? Number(teaser.value) as 1 | 2
        : null
    ).explanation;
  }

  const titleField = form.elements.namedItem("title");
  const descriptionField = form.elements.namedItem("description");
  const statusField = form.elements.namedItem("status");
  const title = titleField instanceof HTMLInputElement
    ? titleField.value.trim()
    : "";
  const description = descriptionField instanceof HTMLTextAreaElement
    ? descriptionField.value.trim()
    : "";
  const status = statusField instanceof HTMLSelectElement
    ? statusField.value.replaceAll("_", " ")
    : "draft";
  const selectedMedia = [...form.querySelectorAll<HTMLElement>("[data-item-upload]")].flatMap((card) => {
    if (card.querySelector<HTMLInputElement>("[data-item-media-selected]")?.checked !== true) return [];
    return [{
      alt: card.querySelector<HTMLInputElement>("[data-item-media-alt]")?.value.trim() || "Image needs alt text",
      audience: card.querySelector<HTMLSelectElement>("[data-item-media-audience]")?.value === "public"
        ? "public"
        : "hunter_only"
    }];
  });
  const updatePreview = (
    selector: string,
    isPublic: boolean,
    media: Array<{ alt: string; audience: string }>
  ) => {
    const preview = form.querySelector<HTMLElement>(selector);
    if (!preview) return;
    const heading = preview.querySelector("h3");
    const copy = preview.querySelector("p:not(.ops-kicker)");
    const summary = preview.querySelector("small");
    const list = preview.querySelector("ul");
    if (heading) heading.textContent = title || "Untitled item";
    if (copy) copy.textContent = description || "No description yet.";
    if (summary) summary.textContent = isPublic
      ? audience === "public" && status !== "draft" && status !== "archived" &&
          ((showOnBoard instanceof HTMLInputElement && showOnBoard.checked) ||
           (teaser instanceof HTMLSelectElement && teaser.value !== ""))
        ? `${status} · visible on selected public surfaces`
        : "Not public"
      : `${status} · visible to participation-unlocked hunters`;
    if (list) {
      list.replaceChildren(...media.map((entry) => {
        const node = document.createElement("li");
        node.textContent = entry.alt;
        return node;
      }));
    }
  };
  updatePreview("[data-item-public-preview]", true, selectedMedia.filter((media) => media.audience === "public"));
  updatePreview("[data-item-hunter-preview]", false, selectedMedia);
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
    addQuickStatusControls(root, items);
    root.querySelectorAll<HTMLFormElement>("[data-item-edit-form]").forEach(syncItemPresentation);
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

export const itemPayload = (form: HTMLFormElement, item?: Element): Record<string, unknown> => {
  const data = new FormData(form);
  const mediaSelections = item ? [...item.querySelectorAll<HTMLElement>("[data-item-upload]")].flatMap((card) => {
    const selected = card.querySelector<HTMLInputElement>("[data-item-media-selected]")?.checked === true;
    if (!selected) return [];
    return [{
      id: card.dataset.itemUpload ?? "",
      altText: card.querySelector<HTMLInputElement>("[data-item-media-alt]")?.value.trim() ?? "",
      caption: card.querySelector<HTMLInputElement>("[data-item-media-caption]")?.value.trim() || null,
      audience: card.querySelector<HTMLSelectElement>("[data-item-media-audience]")?.value === "public"
        ? "public"
        : "hunter_only",
    }];
  }) : [];
  const collectionOrder = string(data.get("collectionOrder"));
  const teaserOrder = string(data.get("teaserOrder"));
  return {
    slug: string(data.get("slug")),
    owner: string(data.get("owner")),
    category: string(data.get("category")),
    title: string(data.get("title")),
    description: string(data.get("description")),
    finderKeeps: data.get("finderKeeps") === "on",
    closeOnFind: data.get("closeOnFind") === "on",
    status: string(data.get("status")),
    displayOrder: Number(data.get("displayOrder")),
    collection: data.get("collection") === "fresh_drops" ? "fresh_drops" : "case",
    collectionOrder: collectionOrder ? Number(collectionOrder) : null,
    audience: data.get("audience") === "public" ? "public" : "hunter_only",
    showOnBoard: data.get("showOnBoard") === "on",
    teaserOrder: teaserOrder ? Number(teaserOrder) : null,
    reportable: data.get("reportable") === "on",
    ...(item ? { expectedVersion: Number((item as HTMLElement).dataset.itemVersion), mediaSelections } : {}),
  };
};

const showTeaserConflict = (
  item: HTMLElement,
  form: HTMLFormElement,
  pendingPayload: Record<string, unknown>,
  payload: unknown
): boolean => {
  if (!dependencies) return false;
  const error = apiErrorRecord(payload);
  const details = isRecord(error?.details) ? error.details : null;
  if (error?.code !== "teaser_slot_occupied" || !details) return false;
  const occupiedItemId = string(details.itemId);
  const occupiedTitle = string(details.title) || "the current item";
  const conflict = item.querySelector<HTMLElement>("[data-item-teaser-conflict]");
  if (!occupiedItemId || !conflict) return false;
  conflict.hidden = false;
  conflict.replaceChildren();
  const message = document.createElement("p");
  message.textContent = `${occupiedTitle} already uses this teaser slot. Nothing changed.`;
  const actions = document.createElement("div");
  actions.className = "ops-action-row";
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "ops-button ops-button--quiet";
  keep.textContent = "Keep current teaser";
  const replace = document.createElement("button");
  replace.type = "button";
  replace.className = "ops-button ops-button--primary";
  replace.textContent = "Replace it";
  actions.append(keep, replace);
  conflict.append(message, actions);
  keep.addEventListener("click", () => {
    conflict.hidden = true;
    const teaser = form.elements.namedItem("teaserOrder");
    if (teaser instanceof HTMLSelectElement) teaser.value = "";
    syncItemPresentation(form);
  }, { once: true });
  replace.addEventListener("click", async () => {
    if (!dependencies) return;
    keep.disabled = true;
    replace.disabled = true;
    resultFor(item, `Moving the teaser from ${occupiedTitle}…`);
    const occupiedItem = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(occupiedItemId)}"]`);
    const occupiedForm = occupiedItem?.querySelector<HTMLFormElement>("[data-item-edit-form]");
    if (!occupiedItem || !occupiedForm) {
      resultFor(item, "Refresh Items so both teaser records are visible, then try again.", true);
      keep.disabled = false;
      replace.disabled = false;
      return;
    }
    const clearPayload = { ...itemPayload(occupiedForm, occupiedItem), teaserOrder: null };
    const cleared = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(occupiedItemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clearPayload)
    });
    if (!cleared.response.ok) {
      resultFor(item, "The current teaser changed. Refresh Items and choose again.", true);
      keep.disabled = false;
      replace.disabled = false;
      return;
    }
    const saved = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(item.dataset.itemId ?? "")}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingPayload)
    });
    if (!saved.response.ok) {
      resultFor(item, "The replacement item changed. Refresh Items before trying again.", true);
      keep.disabled = false;
      replace.disabled = false;
      return;
    }
    await loadOpsItems();
  }, { once: true });
  return true;
};

const editItem = async (form: HTMLFormElement): Promise<void> => {
  if (!dependencies) return;
  const item = form.closest<HTMLElement>("[data-item-id]");
  if (!item) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  resultFor(item, "Saving…");
  try {
    const pendingPayload = itemPayload(form, item);
    const { response, payload } = await dependencies.request(`/api/v1/ops/items/${encodeURIComponent(item.dataset.itemId ?? "")}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingPayload),
    });
    if (!response.ok) {
      if (response.status === 409 && showTeaserConflict(item, form, pendingPayload, payload)) return;
      throw new Error(apiError(payload, response.status === 409 ? "This item changed. Refresh and try again." : "The item was not saved."));
    }
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

const changeQuickItemStatus = async (button: HTMLButtonElement): Promise<void> => {
  if (!dependencies || button.disabled) return;
  const item = button.closest<HTMLElement>("[data-item-id]");
  const target = button.dataset.itemQuickStatus;
  const status = target === "found" || target === "out_there" ? target : null;
  const version = Number(item?.dataset.itemVersion);
  const title = item?.querySelector("h2")?.textContent?.trim() ?? "this item";
  if (!item || !status || !Number.isInteger(version) || version < 0 ||
      !window.confirm(quickItemStatusConfirmation(title, status))) return;
  const itemId = item.dataset.itemId ?? "";
  button.disabled = true;
  resultFor(item, `Marking ${title} ${status === "found" ? "FOUND" : "OUT THERE"}…`);
  try {
    const { response, payload } = await requestQuickItemStatus(itemId, version, status, dependencies.request, loadOpsItems);
    if (response.status === 409) {
      resultForReloadedItem(itemId, "This item changed. The current item list was refreshed.", true);
      return;
    }
    if (!response.ok) throw new Error(apiError(payload, "The item status was not changed."));
    resultForReloadedItem(itemId, `Item marked ${status === "found" ? "FOUND" : "OUT THERE"}.`);
  } catch (error) {
    resultFor(item, error instanceof Error ? error.message : "The item status was not changed.", true);
  } finally {
    button.disabled = false;
  }
};

export function setupOpsItems(next: OpsItemsDependencies): void {
  dependencies = next;
  const createForm = document.querySelector<HTMLFormElement>("[data-item-create-form]");
  createForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createItem(event.currentTarget as HTMLFormElement);
  });
  createForm?.addEventListener("change", () => syncItemPresentation(createForm));
  const itemsRoot = document.querySelector<HTMLElement>("[data-ops-items]");
  itemsRoot?.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-item-edit-form]")) return;
    event.preventDefault();
    void editItem(form);
  });
  const syncEditedItem = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const form = target.closest<HTMLFormElement>("[data-item-edit-form]");
    if (form) syncItemPresentation(form);
  };
  itemsRoot?.addEventListener("input", syncEditedItem);
  itemsRoot?.addEventListener("change", syncEditedItem);
  itemsRoot?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const upload = target.closest<HTMLButtonElement>("[data-item-media-upload]");
    const remove = target.closest<HTMLButtonElement>("[data-item-media-remove]");
    const announcement = target.closest<HTMLButtonElement>("[data-item-announcement]");
    const quickStatus = target.closest<HTMLButtonElement>("[data-item-quick-status]");
    if (upload) void uploadImages(upload);
    else if (remove) void removeImage(remove);
    else if (announcement) void createAnnouncement(announcement);
    else if (quickStatus) void changeQuickItemStatus(quickStatus);
  });
  window.addEventListener("pagehide", revokeObjectUrls, { once: true });
}
