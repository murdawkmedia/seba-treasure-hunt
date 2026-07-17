import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const textOutputPattern = /\.(?:html|js|css|json|xml|txt|webmanifest)$/i;
const privateStaticOutputs = new Set(["_worker.js"]);
export const defaultPrivateFixtureValues = Object.freeze([
  "qa-private-hunter@example.test",
  "QA Private Adult",
  "QA Private Minor 01",
  "waiver-acceptance-qa-private-001",
  "receipt-job-qa-private-001",
  "resend-provider-qa-private-001",
  "qa-private-credential-sentinel",
  "53.123456,-114.654321",
  "qa-private-note-evidence",
  "qa-private-report-evidence",
  "qa-private-child-phone-780-555-0199",
  "hunter-subject-qa-private-minor-001",
  "media-unselected-qa-private-001",
  "private/report-minor-qa-001/original-private.jpg",
  "birth year 2014",
  '"birthYear":2014',
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

export async function scanBuiltOutputPrivacy({ distRoot, privateFixtureValues = defaultPrivateFixtureValues }) {
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
        classification: "server-only-bundle",
      }),
    },
  };
}

export async function runOutputPrivacyCli({
  distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist"),
  privateFixtureValues = defaultPrivateFixtureValues,
} = {}) {
  const result = await scanBuiltOutputPrivacy({ distRoot, privateFixtureValues });
  const findings = result.publicSurfaceOutputs.privacyFindings;
  if (result.publicSurfaceOutputs.filesScanned === 0) {
    console.log("Privacy scan failed: no served static output files were found.");
    return 1;
  }
  if (findings.length === 0) {
    console.log(`Privacy scan passed: ${result.publicSurfaceOutputs.filesScanned} served static files scanned.`);
    return 0;
  }
  console.log(`Privacy scan failed: ${findings.length} private fixture matches in served static output.`);
  const countsByFile = new Map();
  for (const finding of findings) countsByFile.set(finding.file, (countsByFile.get(finding.file) ?? 0) + 1);
  for (const [file, count] of countsByFile) console.log(`- ${JSON.stringify(file)}: ${count} finding${count === 1 ? "" : "s"}`);
  return 1;
}

const directEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (directEntry === import.meta.url) {
  const requestedRoot = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  runOutputPrivacyCli(requestedRoot ? { distRoot: requestedRoot } : undefined)
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch(() => {
      console.error("Privacy scan failed: output could not be inspected.");
      process.exitCode = 2;
    });
}
