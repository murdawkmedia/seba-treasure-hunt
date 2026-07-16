import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "assets", "favicon.svg"));

for (const [relativePath, size] of [
  ["assets/favicon-32x32.png", 32],
  ["assets/apple-touch-icon.png", 180],
  ["assets/favicon-192x192.png", 192],
  ["assets/favicon-512x512.png", 512],
]) {
  await sharp(source, { density: 512 })
    .resize(size, size)
    .png()
    .toFile(path.join(root, relativePath));
}

const icoSizes = [16, 32, 48];
const images = await Promise.all(
  icoSizes.map((size) =>
    sharp(source, { density: 512 }).resize(size, size).png().toBuffer(),
  ),
);
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = header.length;
for (let index = 0; index < images.length; index += 1) {
  const entry = 6 + index * 16;
  header[entry] = icoSizes[index];
  header[entry + 1] = icoSizes[index];
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}

await writeFile(path.join(root, "favicon.ico"), Buffer.concat([header, ...images]));
