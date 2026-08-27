# taxes-gov-az-downloader

Automates the download of two Excel reports from the electronic invoices section
of `new.e-taxes.gov.az`:

- `Qaimələr üzrə` — invoices report;
- `Ödəyicilər üzrə` — payers report.

The script opens a Playwright-controlled Chromium browser, reuses a persistent
session when possible, signs in through Asan İmza when required, selects a
taxpayer cabinet by VÖEN, opens `Göndərilənlər`, and saves both reports to a
local directory.

PIN1 is never stored or entered by the script. When Asan İmza sends an
authentication request, the user must confirm the verification code and enter
PIN1 on the registered phone.

## Quick Start

### Requirements

Before running the script, make sure you have:

- Node.js 20 or later;
- internet access to `new.e-taxes.gov.az`;
- an active Asan İmza account;
- the mobile number and six-digit Asan İmza user ID;
- the VÖEN of the taxpayer cabinet to open;
- access to the registered phone for verification-code confirmation and PIN1;
- permission to download invoice reports from the selected cabinet.

### Install

```powershell
npm install
npx playwright install chromium
Copy-Item .env.example .env
```

### Configure

Open `.env` and provide your values:

```dotenv
ASAN_PHONE=501234567
ASAN_USER_ID=123456
TAXPAYER_TIN=1234567890
```

- `ASAN_PHONE` is the nine-digit number after `+994`;
- `ASAN_USER_ID` is the six-digit Asan İmza user ID;
- `TAXPAYER_TIN` is the VÖEN of the cabinet that should be opened.

The `.env` file contains sensitive information and is excluded from Git. Do not
share or commit it.

### Run

```powershell
npm start
```

On the first run, or after the portal session expires:

1. The script fills and submits the Asan İmza form.
2. Confirm the displayed verification code and enter PIN1 on your phone.
3. The script selects the configured taxpayer cabinet.
4. It opens `E-qaimə-fakturalar` → `Göndərilənlər`.
5. Both Excel files are saved in `downloads/`.

The browser session is kept in `.browser-profile/`. As long as the portal
session remains valid, later runs skip phone confirmation.

Do not run two script instances with the same browser profile at the same time.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `ASAN_PHONE` | Mobile number after `+994` | none |
| `ASAN_USER_ID` | Six-digit Asan İmza user ID | none |
| `TAXPAYER_TIN` | VÖEN of the required cabinet | manual selection |
| `DOWNLOAD_DIR` | Directory for downloaded files | `downloads` |
| `BROWSER_PROFILE_DIR` | Persistent browser-profile directory | `.browser-profile` |
| `BROWSER_CHANNEL` | Playwright browser channel | `chromium` |
| `AUTH_TIMEOUT_MS` | Time allowed for phone confirmation and cabinet selection | `300000` |
| `DOWNLOAD_TIMEOUT_MS` | Time allowed for each Excel export | `180000` |
| `SLOW_MO_MS` | Delay between browser actions | `0` |

If `TAXPAYER_TIN` is empty, select the cabinet manually after confirming PIN1.
The script continues when the cabinet menu appears.

Downloaded files use timestamped names such as:

```text
20260827-152511-qaimeler-uzre.xlsx
20260827-152512-odeyiciler-uzre.xlsx
```

## Testing

```powershell
npm test
```

The test suite validates configuration normalization and runs a local headless
Chromium scenario that covers cabinet selection, the `Göndərilənlər` tab,
confirmation-dialog handling, and persistence of an Excel download. It does not
contact the tax portal or use real credentials.

## Troubleshooting

If Chromium is missing, run:

```powershell
npx playwright install chromium
```

If the Asan İmza code does not arrive, verify `ASAN_PHONE` and `ASAN_USER_ID`.
The phone number may be supplied with or without `+994`; the script normalizes
it before filling the form.

If an operation fails, the script attempts to save a diagnostic screenshot as
`downloads/error-YYYYMMDD-HHMMSS.png`.

## Detailed Documentation

- [How it works — English](how-it-works-en.md)
- [How it works — Russian](how-it-works-ru.md)
