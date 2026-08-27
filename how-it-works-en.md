# How the script works

## Purpose

The script automates the electronic invoices section of
`https://new.e-taxes.gov.az/eportal`. It opens a controlled browser, initiates an
Asan İmza sign-in when necessary, selects a taxpayer cabinet by VÖEN, navigates
to sent invoices, and saves two Excel reports:

- `Qaimələr üzrə` — invoices report;
- `Ödəyicilər üzrə` — payers report.

The script automates the portal's user interface with Playwright. It does not
call private portal APIs directly and does not attempt to bypass Asan İmza. The
owner of the registered phone confirms the verification code and enters PIN1 on
the phone.

## Project structure

- `src/index.mjs` — the main browser-automation workflow;
- `src/config.mjs` — `.env` loading, normalization, and validation;
- `.env.example` — an example of the user configuration;
- `test/config.test.mjs` — configuration-normalization tests;
- `test/automation.test.mjs` — browser tests for cabinet selection, tab
  selection, and download handling;
- `test/run.mjs` — the test entry point;
- `downloads/` — downloaded reports and diagnostic screenshots;
- `.browser-profile/` — the dedicated persistent Chromium profile.

The `downloads/`, `.browser-profile/`, `node_modules/`, local `.env`, and local
`.agents/` directories are excluded from Git.

## Overall workflow

Running `npm start` performs the following steps:

1. Load `.env`.
2. Validate and normalize the configuration.
3. Create the download and browser-profile directories when they do not exist.
4. Start Chromium with a persistent profile.
5. Attempt to open `/eportal/invoice` immediately.
6. If the portal redirects to the login page, start an Asan İmza sign-in.
7. After PIN1 confirmation, select the cabinet with the configured VÖEN.
8. Open the invoices section and the `Göndərilənlər` tab.
9. Request the two Excel reports one after another.
10. Save the files in `downloads/` and close the browser.

When `.browser-profile/` contains a valid session, the sign-in and phone
confirmation steps are skipped.

## Configuration loading

At the beginning of `main()`, the script calls `loadEnvFile()`. The function
reads `.env` line by line and supports:

- blank lines and comment lines that start with `#`;
- an optional `export` prefix;
- values enclosed in single or double quotes;
- inline comments after unquoted values.

Variables that already exist in the process environment take precedence. The
`.env` file does not overwrite them. This makes it possible to supply settings
from PowerShell, CI, or a secrets manager.

### Main variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `ASAN_PHONE` | Mobile number after `+994` | none |
| `ASAN_USER_ID` | Six-digit Asan İmza user ID | none |
| `TAXPAYER_TIN` | VÖEN of the required cabinet | manual cabinet selection |
| `DOWNLOAD_DIR` | Directory for downloaded files | `downloads` |
| `BROWSER_PROFILE_DIR` | Persistent browser-profile directory | `.browser-profile` |
| `BROWSER_CHANNEL` | Playwright browser channel | `chromium` |
| `AUTH_TIMEOUT_MS` | Time allowed for PIN1 and cabinet selection | `300000` ms |
| `DOWNLOAD_TIMEOUT_MS` | Time allowed for each report | `180000` ms |
| `SLOW_MO_MS` | Delay between browser actions | `0` ms |

### Value normalization

`ASAN_PHONE` is stripped of spaces, parentheses, hyphens, and all other
non-digit characters. If a 12-digit number starts with `994`, the country code
is removed. Exactly nine digits must remain after normalization.

`ASAN_USER_ID` is also stripped of non-digit characters. The result must
contain exactly six digits.

Spaces are removed from `TAXPAYER_TIN`. Letters, digits, and hyphens are allowed
in the remaining value. An empty value is valid and enables manual cabinet
selection.

`DOWNLOAD_DIR` and `BROWSER_PROFILE_DIR` are converted to absolute paths
relative to the working directory from which the command was started.

## Browser startup and session persistence

`launchContext()` calls `chromium.launchPersistentContext()`. Unlike a temporary
browser context, a persistent context stores cookies and local storage in
`.browser-profile/`. This allows the portal session to survive between script
runs.

The main browser options are:

- `headless: false` — the browser remains visible to the user;
- `acceptDownloads: true` — Playwright accepts downloads;
- `downloadsPath` — download artifacts use the configured output area;
- `locale: "az-AZ"` — the browser uses the Azerbaijani locale;
- viewport size — `1366 × 900`;
- `slowMo` — read from `SLOW_MO_MS`.

Chromium cannot use the same profile directory from two processes at once. Do
not run two `npm start` processes with the same `BROWSER_PROFILE_DIR`.

## Determining whether sign-in is required

`ensureAuthenticated()` first opens:

```text
https://new.e-taxes.gov.az/eportal/invoice
```

This both speeds up repeat runs and checks the session. If the portal does not
redirect to a URL containing `/login` and `#asan-sign-login-form` is not
visible, the session is considered active.

When authentication is required, the browser opens:

```text
https://new.e-taxes.gov.az/eportal/login/asan
```

The script waits up to 30 seconds for the form to become visible.

## Asan İmza sign-in

`fillAndSubmitAsan()` uses these elements:

| Purpose | Selector |
| --- | --- |
| Mobile number | `#phone` |
| User ID | `#userId` |
| Sign-in button | `#loginPageSignInButton` |

If no saved session is available and either `ASAN_PHONE` or `ASAN_USER_ID` is
missing, the script stops before submitting the form and prints a clear error.

After filling the fields, the script clicks `Daxil ol` and reports in the
terminal that the request was sent. The automation neither enters nor receives
PIN1. The user compares the verification code and confirms the request on the
phone.

`AUTH_TIMEOUT_MS` controls how long the script waits for this step. The default
is five minutes.

## Cabinet selection

After successful Asan İmza confirmation, the portal displays the available
taxpayer cabinets. `waitForCabinetChoice()` handles this stage.

When `TAXPAYER_TIN` is set, the script checks two conditions every 250 ms:

1. The invoice menu has already appeared, which means a cabinet is open.
2. Text containing the configured VÖEN has appeared, which means the cabinet
   list is ready.

VÖEN matching allows whitespace between characters. For example, the configured
value `1234567890` also matches the displayed text `123 456 7890`.

When the VÖEN is found, the script first looks for the nearest clickable parent:
an `a`, a `button`, or an element with `role="button"`. If none exists, it clicks
the text itself so the event can bubble to the cabinet card's handler.

A successfully opened cabinet is detected with either form of the invoice-menu
selector:

```text
[data-testid='menuInvoice'], #menuInvoice
```

When `TAXPAYER_TIN` is empty, the script asks the user to select a cabinet
manually and waits for the same invoice-menu element.

## Opening sent invoices

After authentication, `openInvoices()` ensures the browser is on
`/eportal/invoice`. The direct navigation means that clicking the sidebar item
`E-qaimə-fakturalar` is usually unnecessary.

The `Exceli endir` button is not available on every tab.
`ensureSentInvoicesSelected()` first checks whether this button is visible. If
it is not, the function clicks `Göndərilənlər` and waits for the export button.

This works both when the section initially opens on `Gələnlər` and when the
portal restores a tab selected during an earlier run.

## Requesting an Excel report

The code declares two export kinds:

```text
Qaimələr üzrə   → qaimeler-uzre
Ödəyicilər üzrə → odeyiciler-uzre
```

For each kind, `downloadExport()` performs the same workflow:

1. Wait for the visible `Exceli endir` button.
2. Click it and wait for the exact text of the required dropdown item.
3. Click `Qaimələr üzrə` or `Ödəyicilər üzrə`.
4. Wait for a visible dialog containing:

   ```text
   Excel faylı yükləmək istədiyinizə əminsinizmi?
   ```

5. Find the visible `Bəli` text and click it.
6. Wait for the browser's `download` event.
7. Save the file in the configured directory.

The `Bəli` control is searched across the whole page rather than only inside the
container that holds the confirmation message. On the live portal, the dialog
body and footer can be rendered as sibling containers.

The download-event listener is registered before clicking `Bəli`:

```text
wait for download + click Bəli run together
```

This prevents Playwright from missing a download that starts immediately. The
maximum report-generation time is controlled by `DOWNLOAD_TIMEOUT_MS`; the
default is three minutes for each report.

The operating system's Save As dialog is not used. Playwright accepts the
download and calls `download.saveAs()` with a prepared absolute path.

## Downloaded file names

The local name is generated independently of the name suggested by the server:

```text
YYYYMMDD-HHMMSS-<report-kind>.xlsx
```

Examples:

```text
20260827-152511-qaimeler-uzre.xlsx
20260827-152512-odeyiciler-uzre.xlsx
```

If the server suggests `.xls` or `.xlsx`, that extension is retained. Any other
or missing extension is replaced with `.xlsx`.

If the target name already exists, a numeric suffix is appended:

```text
20260827-152511-qaimeler-uzre-2.xlsx
```

After `saveAs()`, the script checks `download.failure()`. When Chromium reports
a download error, execution stops with the underlying reason.

## Sequential processing of both reports

The exports are processed sequentially, not in parallel. `Qaimələr üzrə` must
finish completely before the menu is opened again for `Ödəyicilər üzrə`.

This matters because the portal uses one modal and one dropdown state. Parallel
clicks could close the menu, replace the selected export kind, or associate a
download event with the wrong report.

## Shutdown and error handling

The main workflow runs inside `try/catch/finally`.

On success, the terminal prints the absolute paths of both files. The persistent
context then closes, while its cookies and local storage remain in the profile
directory for the next run.

When an error occurs, the script attempts to capture a full-page screenshot:

```text
downloads/error-YYYYMMDD-HHMMSS.png
```

It then prints the error and screenshot path and sets the process exit code to
`1`.

`SIGINT` and `SIGTERM` handlers close the context when the user presses `Ctrl+C`
or the operating system terminates the process.

## Data security

The repository must not contain:

- `.env`, which stores the mobile number, Asan İmza user ID, and VÖEN;
- `.browser-profile/`, which stores cookies and session state;
- `downloads/`, which stores reports and diagnostic screenshots.

All of these paths are listed in `.gitignore`. `.env.example` contains only
empty placeholders and is safe to store in Git.

PIN1 is absent from both the configuration and the source code. It is entered
only on the phone through the Asan İmza infrastructure.

Deleting `.browser-profile/` resets the saved browser session. The next run will
require a new sign-in and PIN1 confirmation.

## Testing

Run:

```powershell
npm test
```

The command starts configuration tests and a local headless Chromium test.

The configuration tests cover:

- local and international phone-number formats;
- rejection of an incomplete phone number;
- Asan İmza user-ID length;
- whitespace removal from VÖEN;
- conversion of relative directories to absolute paths.

The browser test creates a local HTML page without contacting the tax portal. It
reproduces:

- a cabinet card and the appearance of `menuInvoice` after selection;
- the absence of `Exceli endir` until `Göndərilənlər` is selected;
- the export-kind dropdown;
- a confirmation dialog whose footer is outside the message container;
- a real browser download event;
- persistence of the downloaded content in an `.xlsx` file.

The test directory is created in the operating system's temporary directory and
removed after the test.

## Limitations

- The script depends on the portal's visible text and DOM structure. Changes to
  labels or selectors may require an automation update.
- PIN1 intentionally cannot be fully automated; confirmation happens on the
  Asan İmza owner's phone.
- The portal controls session lifetime. A persistent profile does not guarantee
  permanent authentication.
- Reports reflect the state and filters active in `Göndərilənlər` at run time.
- Concurrent runs that share one browser profile are not supported.

## Troubleshooting common problems

### Chromium does not start

Install the compatible browser:

```powershell
npx playwright install chromium
```

and make sure `.env` contains:

```dotenv
BROWSER_CHANNEL=chromium
```

### The Asan İmza code does not arrive

Verify `ASAN_PHONE` and `ASAN_USER_ID`. The phone number may be entered with or
without `+994`; the script normalizes it before filling the form.

### The cabinet is not found

Verify `TAXPAYER_TIN` and increase `AUTH_TIMEOUT_MS` if the list loads slowly.
You can temporarily leave `TAXPAYER_TIN` empty and select the cabinet manually.

### `Exceli endir` does not appear

The script selects `Göndərilənlər` automatically. If the button is still
missing, the interface may have changed, the account may lack the required
permission, or the page may not have finished loading. Inspect the latest
`downloads/error-*.png` screenshot.

### Report generation takes too long

Increase `DOWNLOAD_TIMEOUT_MS`, for example:

```dotenv
DOWNLOAD_TIMEOUT_MS=300000
```

The timeout applies separately to each report.
