import { readFileSync } from "node:fs";
import { renderCampaignPage } from "../scripts/campaign-shell.mjs";

export const readRenderedCampaignPage = (filename) =>
  renderCampaignPage(
    readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"),
    filename,
  );
