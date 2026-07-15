import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const textOutputPattern = /\.(?:html|js|css|json|xml|txt|webmanifest)$/i;
const privateStaticOutputs = new Set([
  "_worker.js",
  "assets/app/ops.js",
  "ops.html",
]);

function relativeOutputPath(distRoot, file) {
  return path.relative(distRoot, file).split(path.sep).join("/");
}

async function collectTextOutputs(target, output = []) {
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat) return output;
  if (targetStat.isFile()) {
    if (textOutputPattern.test(target)) output.push(target);
    return output;
  }
  for (const entry of await readdir(target, { withFileTypes: true })) {
    await collectTextOutputs(path.join(target, entry.name), output);
  }
  return output;
}

async function scanOutputs({ distRoot, files, privateFixtureValues, classification }) {
  const privacyFindings = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const fixture of privateFixtureValues) {
      if (source.includes(fixture)) {
        privacyFindings.push({ classification, file: relativeOutputPath(distRoot, file), fixture });
      }
    }
  }
  return privacyFindings;
}

export async function scanBuiltOutputPrivacy({ distRoot, privateFixtureValues }) {
  const allOutputs = await collectTextOutputs(distRoot);
  const publicOutputs = allOutputs.filter((file) => !privateStaticOutputs.has(relativeOutputPath(distRoot, file)));
  const privateOutputs = allOutputs.filter((file) => privateStaticOutputs.has(relativeOutputPath(distRoot, file)));
  const publicFiles = publicOutputs.map((file) => relativeOutputPath(distRoot, file));
  const privateFiles = privateOutputs.map((file) => relativeOutputPath(distRoot, file));

  return {
    publicSurfaceOutputs: {
      filesScanned: publicFiles.length,
      files: publicFiles,
      privacyFindings: await scanOutputs({
        distRoot,
        files: publicOutputs,
        privateFixtureValues,
        classification: "served-public-static",
      }),
    },
    privateBundleOutputs: {
      filesScanned: privateFiles.length,
      files: privateFiles,
      privacyFindings: await scanOutputs({
        distRoot,
        files: privateOutputs,
        privateFixtureValues,
        classification: "server/Ops-private-bundle",
      }),
    },
  };
}
