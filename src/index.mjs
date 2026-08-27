import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { getConfig, loadEnvFile } from "./config.mjs";

const ASAN_PATH = "/login/asan";
const INVOICE_PATH = "/invoice";
const LOGIN_FORM = "#asan-sign-login-form";
const INVOICE_MENU = "[data-testid='menuInvoice'], #menuInvoice";
const EXCEL_CONFIRMATION = "Excel faylı yükləmək istədiyinizə əminsinizmi?";

const EXPORTS = [
  { label: "Qaimələr üzrə", slug: "qaimeler-uzre" },
  { label: "Ödəyicilər üzrə", slug: "odeyiciler-uzre" },
];

function log(message) {
  console.log(`[taxes] ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function waitForVisible(locator, timeoutMs) {
  await locator.first().waitFor({ state: "attached", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await firstVisible(locator);
    if (visible) return visible;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The expected visible page element was not found.");
}

function tinPattern(tin) {
  return new RegExp(tin.split("").map(escapeRegExp).join("\\s*"), "u");
}

async function hasInvoiceMenu(page) {
  const menu = await firstVisible(page.locator(INVOICE_MENU)).catch(() => null);
  return Boolean(menu);
}

async function fillAndSubmitAsan(page, config) {
  if (!config.phone || !config.userId) {
    throw new Error(
      "No authenticated session is available. Set ASAN_PHONE and ASAN_USER_ID in .env.",
    );
  }

  await page.locator("#phone").fill(config.phone);
  await page.locator("#userId").fill(config.userId);
  await page.locator("#loginPageSignInButton").click();

  log("The Asan İmza request was sent.");
  log("Confirm the verification code and enter PIN1 on your phone.");
}

export async function waitForCabinetChoice(page, config) {
  if (!config.taxpayerTin) {
    log("TAXPAYER_TIN is not set. Select the required cabinet in the browser after PIN1.");
    await page.locator(INVOICE_MENU).first().waitFor({
      state: "attached",
      timeout: config.authTimeoutMs,
    });
    return;
  }

  const tinText = page.getByText(tinPattern(config.taxpayerTin), { exact: false });
  const deadline = Date.now() + config.authTimeoutMs;
  let visibleTin = null;

  // Polling from Node survives both SPA route changes and full navigations
  // after PIN1 confirmation.
  while (Date.now() < deadline) {
    if (await hasInvoiceMenu(page)) return;
    visibleTin = await firstVisible(tinText).catch(() => null);
    if (visibleTin) break;
    await page.waitForTimeout(250);
  }

  if (!visibleTin) {
    throw new Error(
      `The cabinet with VÖEN ${config.taxpayerTin} did not appear within the timeout.`,
    );
  }

  const clickableAncestor = visibleTin.locator(
    "xpath=ancestor-or-self::*[self::a or self::button or @role='button'][1]",
  );
  if ((await clickableAncestor.count()) > 0) {
    await clickableAncestor.first().click();
  } else {
    // Cabinet cards handle the click event bubbled from their child text.
    await visibleTin.click();
  }

  log(`Selected the cabinet with VÖEN ${config.taxpayerTin}.`);
  await page.locator(INVOICE_MENU).first().waitFor({
    state: "attached",
    timeout: config.authTimeoutMs,
  });
}

async function ensureAuthenticated(page, config) {
  await page.goto(`${config.baseUrl}${INVOICE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  if (!page.url().includes("/login") && !(await page.locator(LOGIN_FORM).isVisible())) {
    return;
  }

  await page.goto(`${config.baseUrl}${ASAN_PATH}`, { waitUntil: "domcontentloaded" });
  await page.locator(LOGIN_FORM).waitFor({ state: "visible", timeout: 30_000 });
  await fillAndSubmitAsan(page, config);
  await waitForCabinetChoice(page, config);
}

export async function ensureSentInvoicesSelected(page, timeoutMs = 30_000) {
  const excelButton = page.getByRole("button", { name: /^Exceli endir$/u });
  if (await firstVisible(excelButton)) return;

  const sentTab = await waitForVisible(
    page.getByText("Göndərilənlər", { exact: true }),
    timeoutMs,
  );
  await sentTab.click();
  await waitForVisible(excelButton, timeoutMs);
}

async function openInvoices(page, config) {
  if (!page.url().includes(INVOICE_PATH)) {
    await page.goto(`${config.baseUrl}${INVOICE_PATH}`, { waitUntil: "domcontentloaded" });
  }

  if (page.url().includes("/login")) {
    throw new Error("The session expired before the electronic invoices page opened.");
  }

  await ensureSentInvoicesSelected(page);
  log("Opened E-qaimə-fakturalar → Göndərilənlər.");
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function safeExtension(suggestedFilename) {
  const extension = path.extname(path.basename(suggestedFilename));
  return /^\.xlsx?$/iu.test(extension) ? extension.toLowerCase() : ".xlsx";
}

function uniqueDownloadPath(directory, slug, suggestedFilename) {
  const extension = safeExtension(suggestedFilename);
  const stem = `${timestamp()}-${slug}`;
  let candidate = path.join(directory, `${stem}${extension}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${stem}-${counter}${extension}`);
    counter += 1;
  }
  return candidate;
}

async function clickExportOption(page, label) {
  const excelButton = await waitForVisible(
    page.getByRole("button", { name: /^Exceli endir$/u }),
    15_000,
  );
  await excelButton.click();

  const option = await waitForVisible(page.getByText(label, { exact: true }), 15_000);
  await option.click();
}

export async function downloadExport(page, config, exportKind) {
  log(`Requesting the “${exportKind.label}” export...`);
  await clickExportOption(page, exportKind.label);

  const modal = page
    .locator(".ant-modal-content, [role='dialog']")
    .filter({ hasText: EXCEL_CONFIRMATION });
  const visibleModal = await waitForVisible(modal, 15_000);
  // On the live portal, the dialog footer is rendered next to modal-body,
  // rather than inside the container that holds the confirmation text.
  const confirmButton = await waitForVisible(
    page.getByText("Bəli", { exact: true }),
    15_000,
  );

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: config.downloadTimeoutMs }),
    confirmButton.click(),
  ]);

  const destination = uniqueDownloadPath(
    config.downloadDir,
    exportKind.slug,
    download.suggestedFilename(),
  );
  await download.saveAs(destination);

  const failure = await download.failure();
  if (failure) throw new Error(`The browser could not download the file: ${failure}`);

  log(`Saved ${destination}`);
  await visibleModal.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  return destination;
}

async function launchContext(config) {
  const options = {
    headless: false,
    acceptDownloads: true,
    downloadsPath: config.downloadDir,
    locale: "az-AZ",
    slowMo: config.slowMoMs,
    viewport: { width: 1366, height: 900 },
  };
  if (config.browserChannel) options.channel = config.browserChannel;

  try {
    return await chromium.launchPersistentContext(config.profileDir, options);
  } catch (error) {
    throw new Error(
      `Could not start the browser (${config.browserChannel}). ` +
        "Install Chromium with \"npx playwright install chromium\" " +
        "and set BROWSER_CHANNEL=chromium. " +
        `Original error: ${error.message}`,
    );
  }
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  const config = getConfig(cwd);
  fs.mkdirSync(config.downloadDir, { recursive: true });
  fs.mkdirSync(config.profileDir, { recursive: true });

  const context = await launchContext(config);
  let page = context.pages()[0] ?? (await context.newPage());
  const close = async () => context.close().catch(() => {});
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  try {
    await ensureAuthenticated(page, config);
    page = context.pages().find((candidate) => !candidate.isClosed()) ?? page;
    await openInvoices(page, config);

    const downloaded = [];
    for (const exportKind of EXPORTS) {
      downloaded.push(await downloadExport(page, config, exportKind));
    }

    log("Done. Both Excel files were downloaded:");
    for (const filePath of downloaded) console.log(`  ${filePath}`);
  } catch (error) {
    const screenshotPath = path.join(config.downloadDir, `error-${timestamp()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.error(`\nError: ${error.message}`);
    console.error(`Diagnostic screenshot (if one was created): ${screenshotPath}`);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entryPoint) {
  await main();
}
