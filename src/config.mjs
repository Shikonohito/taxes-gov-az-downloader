import fs from "node:fs";
import path from "node:path";

export function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (target[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, "").trim();
    }

    target[key] = value;
  }
}

export function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D/gu, "");
  if (digits.startsWith("994") && digits.length === 12) {
    digits = digits.slice(3);
  }
  if (digits.length !== 9) {
    throw new Error("ASAN_PHONE must contain 9 digits after +994.");
  }
  return digits;
}

export function normalizeUserId(value) {
  const digits = String(value ?? "").replace(/\D/gu, "");
  if (digits.length !== 6) {
    throw new Error("ASAN_USER_ID must contain 6 digits.");
  }
  return digits;
}

export function normalizeTin(value) {
  const normalized = String(value ?? "").replace(/\s/gu, "");
  if (normalized && !/^[A-Za-z0-9-]+$/u.test(normalized)) {
    throw new Error("TAXPAYER_TIN contains unsupported characters.");
  }
  return normalized;
}

function integerAtLeast(value, fallback, minimum, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

export function getConfig(cwd = process.cwd(), env = process.env) {
  const resolveFromCwd = (value) => path.resolve(cwd, value);

  return {
    baseUrl: "https://new.e-taxes.gov.az/eportal",
    phone: env.ASAN_PHONE ? normalizePhone(env.ASAN_PHONE) : "",
    userId: env.ASAN_USER_ID ? normalizeUserId(env.ASAN_USER_ID) : "",
    taxpayerTin: normalizeTin(env.TAXPAYER_TIN),
    downloadDir: resolveFromCwd(env.DOWNLOAD_DIR || "downloads"),
    profileDir: resolveFromCwd(env.BROWSER_PROFILE_DIR || ".browser-profile"),
    browserChannel: env.BROWSER_CHANNEL || "chromium",
    authTimeoutMs: integerAtLeast(env.AUTH_TIMEOUT_MS, 300_000, 1, "AUTH_TIMEOUT_MS"),
    downloadTimeoutMs: integerAtLeast(
      env.DOWNLOAD_TIMEOUT_MS,
      180_000,
      1,
      "DOWNLOAD_TIMEOUT_MS",
    ),
    slowMoMs: integerAtLeast(env.SLOW_MO_MS, 0, 0, "SLOW_MO_MS"),
  };
}
