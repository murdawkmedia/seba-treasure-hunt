import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeRoot = path.join(root, "assets", "route");
const temporaryRoot = path.join(root, ".route-image-sanitize");

async function collectJpegs(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await collectJpegs(absolute)));
    else if (/\.jpe?g$/i.test(entry.name)) results.push(absolute);
  }
  return results;
}

const images = await collectJpegs(routeRoot);
await rm(temporaryRoot, { recursive: true, force: true });

for (const source of images) {
  const relative = path.relative(routeRoot, source);
  const destination = path.join(temporaryRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });

  // rotate() applies the source orientation before Sharp deliberately drops all
  // metadata. The resulting public JPEG has pixels only: no EXIF, XMP, IPTC,
  // GPS coordinates, camera serials, or edit history.
  await sharp(source)
    .rotate()
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toFile(destination);
}

for (const source of images) {
  const relative = path.relative(routeRoot, source);
  await rename(path.join(temporaryRoot, relative), source);
}

await rm(temporaryRoot, { recursive: true, force: true });
process.stdout.write(`Sanitized ${images.length} public route JPEGs.\n`);
