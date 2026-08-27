import assert from "node:assert/strict";
import test from "node:test";
import { getConfig, normalizePhone, normalizeTin, normalizeUserId } from "../src/config.mjs";

test("normalizePhone accepts local and international Azerbaijan formats", () => {
  assert.equal(normalizePhone("50 123-45-67"), "501234567");
  assert.equal(normalizePhone("+994 50 123 45 67"), "501234567");
});

test("normalizePhone rejects an incomplete number", () => {
  assert.throws(() => normalizePhone("50123"), /9 цифр/u);
});

test("normalizeUserId requires six digits", () => {
  assert.equal(normalizeUserId("12 34 56"), "123456");
  assert.throws(() => normalizeUserId("12345"), /6 цифр/u);
});

test("normalizeTin removes spaces", () => {
  assert.equal(normalizeTin("12 345 678 90"), "1234567890");
});

test("getConfig resolves writable paths from cwd", () => {
  const config = getConfig("C:\\work", {
    DOWNLOAD_DIR: "out",
    BROWSER_PROFILE_DIR: "profile",
  });
  assert.match(config.downloadDir, /out$/u);
  assert.match(config.profileDir, /profile$/u);
});
