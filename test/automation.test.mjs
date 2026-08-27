import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import {
  downloadExport,
  ensureSentInvoicesSelected,
  waitForCabinetChoice,
} from "../src/index.mjs";

test("downloadExport confirms the modal and persists an xlsx file", async () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "taxes-download-test-"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.setContent(`
      <button id="cabinet">VÖEN: 123 456 7890</button>
      <nav data-testid="menuInvoice" hidden>E-qaimə-fakturalar</nav>
      <script>
        document.querySelector('#cabinet').onclick = () => {
          document.querySelector('[data-testid="menuInvoice"]').hidden = false;
        };
      </script>
    `);
    await waitForCabinetChoice(page, {
      taxpayerTin: "1234567890",
      authTimeoutMs: 2_000,
    });
    assert.equal(
      await page.locator("[data-testid='menuInvoice']").isVisible(),
      true,
    );

    await page.setContent(`
      <button id="sent">Göndərilənlər</button>
      <button id="excel-after-tab" hidden>Exceli endir</button>
      <script>
        document.querySelector('#sent').onclick = () => {
          document.querySelector('#excel-after-tab').hidden = false;
        };
      </script>
    `);
    await ensureSentInvoicesSelected(page, 2_000);
    assert.equal(await page.locator("#excel-after-tab").isVisible(), true);

    await page.setContent(`
      <button id="excel">Exceli endir</button>
      <div id="menu" hidden><button id="kind">Qaimələr üzrə</button></div>
      <div role="dialog" id="modal" hidden>
        <div class="ant-modal-content">
        <p>Excel faylı yükləmək istədiyinizə əminsinizmi?</p>
        </div>
      </div>
      <div id="modal-footer" hidden><button id="yes"><span>Bəli</span></button></div>
      <script>
        document.querySelector('#excel').onclick = () => {
          document.querySelector('#menu').hidden = false;
        };
        document.querySelector('#kind').onclick = () => {
          document.querySelector('#menu').hidden = true;
          document.querySelector('#modal').hidden = false;
          document.querySelector('#modal-footer').hidden = false;
        };
        document.querySelector('#yes').onclick = () => {
          document.querySelector('#modal').hidden = true;
          document.querySelector('#modal-footer').hidden = true;
          const blob = new Blob(['xlsx-test-payload'], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
          const anchor = document.createElement('a');
          anchor.href = URL.createObjectURL(blob);
          anchor.download = 'server-report.xlsx';
          anchor.click();
        };
      </script>
    `);

    const destination = await downloadExport(
      page,
      { downloadDir, downloadTimeoutMs: 10_000 },
      { label: "Qaimələr üzrə", slug: "qaimeler-uzre" },
    );

    assert.equal(path.extname(destination), ".xlsx");
    assert.equal(fs.readFileSync(destination, "utf8"), "xlsx-test-payload");
  } finally {
    await context.close();
    await browser.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
});
