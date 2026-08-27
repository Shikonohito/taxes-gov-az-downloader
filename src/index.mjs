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
  throw new Error("Не найден ожидаемый видимый элемент страницы.");
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
      "Сессия входа отсутствует. Заполните ASAN_PHONE и ASAN_USER_ID в файле .env.",
    );
  }

  await page.locator("#phone").fill(config.phone);
  await page.locator("#userId").fill(config.userId);
  await page.locator("#loginPageSignInButton").click();

  log("Запрос Asan İmza отправлен.");
  log("Подтвердите совпадение кода и введите PIN1 на телефоне.");
}

export async function waitForCabinetChoice(page, config) {
  if (!config.taxpayerTin) {
    log("TAXPAYER_TIN не задан — после PIN1 выберите нужный кабинет в браузере вручную.");
    await page.locator(INVOICE_MENU).first().waitFor({
      state: "attached",
      timeout: config.authTimeoutMs,
    });
    return;
  }

  const tinText = page.getByText(tinPattern(config.taxpayerTin), { exact: false });
  const deadline = Date.now() + config.authTimeoutMs;
  let visibleTin = null;

  // Опрос на стороне Node переживает как SPA-переход, так и полную навигацию
  // после подтверждения PIN1.
  while (Date.now() < deadline) {
    if (await hasInvoiceMenu(page)) return;
    visibleTin = await firstVisible(tinText).catch(() => null);
    if (visibleTin) break;
    await page.waitForTimeout(250);
  }

  if (!visibleTin) {
    throw new Error(
      `За отведённое время кабинет с VÖEN ${config.taxpayerTin} не появился.`,
    );
  }

  const clickableAncestor = visibleTin.locator(
    "xpath=ancestor-or-self::*[self::a or self::button or @role='button'][1]",
  );
  if ((await clickableAncestor.count()) > 0) {
    await clickableAncestor.first().click();
  } else {
    // Карточки кабинетов обрабатывают всплывающее событие от дочернего текста.
    await visibleTin.click();
  }

  log(`Выбран кабинет с VÖEN ${config.taxpayerTin}.`);
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
    throw new Error("Сессия завершилась до открытия раздела электронных счетов-фактур.");
  }

  await ensureSentInvoicesSelected(page);
  log("Раздел E-qaimə-fakturalar → Göndərilənlər открыт.");
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
  log(`Запрашиваю экспорт «${exportKind.label}»...`);
  await clickExportOption(page, exportKind.label);

  const modal = page
    .locator(".ant-modal-content, [role='dialog']")
    .filter({ hasText: EXCEL_CONFIRMATION });
  const visibleModal = await waitForVisible(modal, 15_000);
  // На реальном портале футер диалога рендерится рядом с modal-body, а не
  // внутри найденного контейнера с текстом подтверждения.
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
  if (failure) throw new Error(`Браузер не смог скачать файл: ${failure}`);

  log(`Сохранён ${destination}`);
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
      `Не удалось запустить браузер (${config.browserChannel}). ` +
        "Установите Chromium командой \"npx playwright install chromium\" " +
        "и укажите BROWSER_CHANNEL=chromium. " +
        `Исходная ошибка: ${error.message}`,
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

    log("Готово. Оба Excel-файла скачаны:");
    for (const filePath of downloaded) console.log(`  ${filePath}`);
  } catch (error) {
    const screenshotPath = path.join(config.downloadDir, `error-${timestamp()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.error(`\nОшибка: ${error.message}`);
    console.error(`Диагностический снимок (если удалось создать): ${screenshotPath}`);
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
