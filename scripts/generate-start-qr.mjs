import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = "https://www.timlostsomething.com/start";

const svg = await QRCode.toString(destination, {
  type: "svg",
  errorCorrectionLevel: "H",
  margin: 4,
  color: {
    dark: "#10291fff",
    light: "#f8f2e2ff"
  }
});

await writeFile(path.join(root, "assets", "start-qr.svg"), svg, "utf8");
process.stdout.write(`Generated permanent start QR for ${destination}.\n`);
