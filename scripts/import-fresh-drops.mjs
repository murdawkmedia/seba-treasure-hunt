import { createHash } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshDropManifest } from "./fresh-drops-manifest.mjs";

const productionHosts = new Set([
  "timlostsomething.com",
  "www.timlostsomething.com",
  "seba-treasure-hunt.pages.dev",
]);
const stableId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const dataFrom = (value) => record(value)?.data;
const defaultSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const safeItem = (value) => {
  const item = record(value);
  if (!item || !stableId(item.id) || !stableId(item.slug) || !Number.isInteger(item.version)) return null;
  return item;
};

const normalizeItems = (payload) => {
  const data = dataFrom(payload);
  return Array.isArray(data) ? data.map(safeItem).filter(Boolean) : [];
};

const uploadHash = (upload) => {
  const hash = record(upload)?.sourceSha256;
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : null;
};

const selectedUploads = (item) => (Array.isArray(item.uploads) ? item.uploads : [])
  .filter((upload) => record(upload) && Number.isInteger(upload.position))
  .sort((left, right) => left.position - right.position);

const itemFields = (manifestItem, current) => ({
  slug: manifestItem.slug,
  owner: manifestItem.owner,
  category: manifestItem.category,
  title: manifestItem.title,
  description: manifestItem.description,
  finderKeeps: manifestItem.finderKeeps,
  closeOnFind: manifestItem.closeOnFind,
  status: manifestItem.status ?? (current?.status === "found" ? "found" : "out_there"),
  displayOrder: Number.isInteger(current?.displayOrder)
    ? current.displayOrder
    : 100 + manifestItem.collectionOrder,
  collection: "fresh_drops",
  collectionOrder: manifestItem.collectionOrder,
  audience: manifestItem.audience,
  showOnBoard: manifestItem.showOnBoard,
  teaserOrder: manifestItem.teaserOrder,
  reportable: manifestItem.reportable,
});

const sameValue = (left, right) => left === right;

const itemIsCurrent = (item, fields, selections, expectedHashes) => {
  if (!Object.entries(fields).every(([key, value]) => sameValue(item[key], value))) return false;
  const selected = selectedUploads(item);
  if (selected.length !== selections.length) return false;
  return selections.every((selection, index) => {
    const upload = selected[index];
    return uploadHash(upload) === expectedHashes[index] &&
      upload.id === selection.id &&
      upload.altText === selection.altText &&
      (upload.caption ?? null) === selection.caption &&
      upload.audience === selection.audience;
  });
};

const parseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const safeApiCode = (payload) => {
  const possible = record(record(payload)?.error)?.code ?? record(payload)?.code;
  return typeof possible === "string" && /^[a-z0-9_]{1,80}$/i.test(possible) ? possible : null;
};

export async function importFreshDrops(options) {
  const origin = typeof options?.origin === "string" ? options.origin.replace(/\/$/, "") : "";
  const sourceDirectory = typeof options?.sourceDirectory === "string" ? options.sourceDirectory : "";
  const token = typeof options?.token === "string" ? options.token.trim() : "";
  if (!origin || !sourceDirectory || !token) {
    throw new Error("Fresh Drops import requires origin, sourceDirectory, and a one-time Ops token.");
  }
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "https:" && parsedOrigin.hostname !== "localhost" && parsedOrigin.hostname !== "127.0.0.1") {
    throw new Error("Fresh Drops import requires HTTPS except for localhost testing.");
  }
  const production = productionHosts.has(parsedOrigin.hostname.toLowerCase());
  if (production && !(options.allowProduction === true && options.productionApproval === "APPROVED")) {
    throw new Error("Production import requires --allow-production and TIM_LOST_PRODUCTION_IMPORT=APPROVED.");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const readFile = options.readFile ?? readFileFromDisk;
  const sha256 = options.sha256 ?? defaultSha256;
  if (typeof fetchImpl !== "function") throw new Error("Fresh Drops import has no fetch implementation.");

  const request = async (pathname, { method = "GET", body = null, authenticated = true } = {}) => {
    const headers = new Headers({ Accept: "application/json" });
    if (authenticated) {
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Origin", origin);
    }
    if (body !== null && !(body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetchImpl(`${origin}${pathname}`, {
      method,
      headers,
      ...(body === null ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const payload = await parseJson(response);
    if (!response.ok) {
      const code = safeApiCode(payload);
      throw new Error(`${method} ${pathname} failed with HTTP ${response.status}${code ? ` (${code})` : ""}.`);
    }
    return payload;
  };

  const configPayload = await request("/api/v1/config", { authenticated: false });
  const environment = record(dataFrom(configPayload))?.deploymentEnvironment;
  const expectedEnvironment = production ? "production" : "validation";
  if (environment !== expectedEnvironment) {
    throw new Error(`Fresh Drops importer expected ${expectedEnvironment} but the runtime reported ${String(environment ?? "unknown")}.`);
  }

  const summary = { created: [], patched: [], uploaded: [], skipped: [], failed: [] };
  const listItems = async () => normalizeItems(await request("/api/v1/ops/items"));
  let items = await listItems();

  for (const manifestItem of freshDropManifest) {
    let item = items.find((candidate) => candidate.id === manifestItem.id) ??
      items.find((candidate) => candidate.slug === manifestItem.slug);
    if (!item) {
      const createdPayload = await request("/api/v1/ops/items", {
        method: "POST",
        body: { ...itemFields(manifestItem, null), status: "draft" },
      });
      item = safeItem(dataFrom(createdPayload));
      if (!item) throw new Error(`Fresh Drops create returned an incomplete item for ${manifestItem.id} (${manifestItem.slug}).`);
      summary.created.push({ manifestId: manifestItem.id, itemId: item.id, slug: item.slug });
      items = [...items, item];
    }

    const sourceRecords = [];
    for (const media of manifestItem.media) {
      const bytes = await readFile(path.join(sourceDirectory, media.source));
      const hash = String(await sha256(bytes)).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        throw new Error(`Fresh Drops hashing failed for ${manifestItem.id} (${manifestItem.slug}) source ${media.source}.`);
      }
      sourceRecords.push({ ...media, bytes, hash });
    }

    let uploads = Array.isArray(item.uploads) ? item.uploads : [];
    const missing = sourceRecords.filter((source) => !uploads.some((upload) => uploadHash(upload) === source.hash));
    for (const source of sourceRecords.filter((candidate) => !missing.includes(candidate))) {
      summary.skipped.push({ itemId: item.id, slug: item.slug, source: source.source, sha256: source.hash, reason: "hash_exists" });
    }
    if (missing.length > 0) {
      const form = new FormData();
      for (const source of missing) {
        form.append("images", new Blob([source.bytes], { type: "image/jpeg" }), source.source);
      }
      await request(`/api/v1/ops/items/${encodeURIComponent(item.id)}/media`, { method: "POST", body: form });
      for (const source of missing) {
        summary.uploaded.push({ itemId: item.id, slug: item.slug, source: source.source, sha256: source.hash });
      }
    }

    let readyItem = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      items = await listItems();
      const candidate = items.find((entry) => entry.id === item.id);
      const candidateUploads = Array.isArray(candidate?.uploads) ? candidate.uploads : [];
      const everyReady = sourceRecords.every((source) => candidateUploads.some((upload) =>
        uploadHash(upload) === source.hash && upload.status === "ready"));
      if (candidate && everyReady) {
        readyItem = candidate;
        break;
      }
      if (attempt < 59) await sleep(1_000);
    }
    if (!readyItem) {
      const latest = items.find((entry) => entry.id === item.id);
      const latestUploads = Array.isArray(latest?.uploads) ? latest.uploads : [];
      const failedSource = sourceRecords.find((source) => !latestUploads.some((upload) =>
        uploadHash(upload) === source.hash && upload.status === "ready")) ?? sourceRecords[0];
      const failure = { itemId: item.id, slug: item.slug, source: failedSource.source, reason: "media_timeout" };
      summary.failed.push(failure);
      throw new Error(`Fresh Drops media timeout for ${manifestItem.id} (${manifestItem.slug}) source ${failedSource.source}.`);
    }

    uploads = readyItem.uploads;
    const mediaSelections = sourceRecords.map((source) => {
      const upload = uploads.find((candidate) => uploadHash(candidate) === source.hash && candidate.status === "ready");
      if (!upload || !stableId(upload.id)) {
        throw new Error(`Fresh Drops media lookup failed for ${manifestItem.id} (${manifestItem.slug}) source ${source.source}.`);
      }
      return { id: upload.id, altText: source.alt, caption: source.caption, audience: source.audience };
    });
    const fields = itemFields(manifestItem, readyItem);
    if (itemIsCurrent(readyItem, fields, mediaSelections, sourceRecords.map((source) => source.hash))) {
      summary.skipped.push({ itemId: item.id, slug: item.slug, reason: "item_up_to_date" });
      continue;
    }
    const patchedPayload = await request(`/api/v1/ops/items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: { ...fields, expectedVersion: readyItem.version, mediaSelections },
    });
    const patched = safeItem(dataFrom(patchedPayload));
    if (!patched) throw new Error(`Fresh Drops patch returned an incomplete item for ${manifestItem.id} (${manifestItem.slug}).`);
    summary.patched.push({ manifestId: manifestItem.id, itemId: patched.id, slug: patched.slug, version: patched.version });
    items = items.map((candidate) => candidate.id === patched.id ? patched : candidate);
  }
  return summary;
}

function cliArguments(argv) {
  const result = { origin: "", sourceDirectory: "", allowProduction: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-production") result.allowProduction = true;
    else if (argument === "--origin") result.origin = argv[++index] ?? "";
    else if (argument === "--source") result.sourceDirectory = argv[++index] ?? "";
    else throw new Error(`Unknown Fresh Drops importer argument: ${argument}`);
  }
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const flags = cliArguments(process.argv.slice(2));
    const summary = await importFreshDrops({
      ...flags,
      token: process.env.FRESH_DROPS_OPS_TOKEN ?? "",
      productionApproval: process.env.TIM_LOST_PRODUCTION_IMPORT ?? "",
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Fresh Drops import failed."}\n`);
    process.exitCode = 1;
  }
}
