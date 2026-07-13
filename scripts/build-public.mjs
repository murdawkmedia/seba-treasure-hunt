import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const staging = path.join(root, ".wrangler", `public-build-${process.pid}`);
const allowlist = [
  "_worker.js",
  "canonical-host-worker.mjs",
  "index.html",
  "route.html",
  "interview.html",
  "robots.txt",
  "sitemap.xml",
  "assets",
  "css",
  "js",
];
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".xml",
]);
const prohibitedPartner = String.fromCharCode(67, 70, 67, 87);
const prohibitedPattern = new RegExp(prohibitedPartner, "i");

const rejectSymbolicLinks = async (source) => {
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Symbolic link is not allowed: ${path.relative(root, source)}`,
    );
  }

  if (!stats.isDirectory()) return;

  for (const entry of await readdir(source)) {
    await rejectSymbolicLinks(path.join(source, entry));
  }
};

const walk = async (directory) => {
  const files = [];

  for (const entry of await readdir(directory)) {
    const entryPath = path.join(directory, entry);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Symbolic link is not allowed in output: ${path.relative(staging, entryPath)}`,
      );
    }

    if (stats.isDirectory()) {
      files.push(...(await walk(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
};

try {
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  for (const source of allowlist) {
    const sourcePath = path.join(root, source);
    await rejectSymbolicLinks(sourcePath);
    await cp(sourcePath, path.join(staging, source), { recursive: true });
  }

  for (const output of await walk(staging)) {
    const relativePath = path.relative(staging, output);
    if (prohibitedPattern.test(relativePath)) {
      throw new Error(
        `Prohibited partner material in output path: ${relativePath}`,
      );
    }

    if (textExtensions.has(path.extname(output).toLowerCase())) {
      const content = await readFile(output, "utf8");
      if (prohibitedPattern.test(content)) {
        throw new Error(
          `Prohibited partner material in output file: ${relativePath}`,
        );
      }
    }
  }

  await rm(dist, { recursive: true, force: true });
  await rename(staging, dist);
  console.log(`Built ${dist}`);
} catch (error) {
  await Promise.allSettled([
    rm(staging, { recursive: true, force: true }),
    rm(dist, { recursive: true, force: true }),
  ]);
  throw error;
}
