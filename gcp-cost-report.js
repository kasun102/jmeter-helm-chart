const puppeteer = require("puppeteer");
const XLSX = require("xlsx");
const fs = require("fs");
const nodemailer = require("nodemailer");

const EMAIL_FROM = process.env.REPORT_EMAIL_FROM || "finops-reports@sysco.com";
const EMAIL_TO = process.env.REPORT_EMAIL_TO || "finops-team@sysco.com";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.sysco.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

const GCP_BASE_URL =
  "https://console.cloud.google.com/billing/01545F-1659DA-0C0048/reports;projects=";

// ─── Safe screenshot (won't crash if page navigates away) ──────────────────
async function screenshot(page, label) {
  try {
    const file = `debug-${label}-${Date.now()}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`📸 Screenshot saved: ${file}`);
  } catch (e) {
    console.warn(`⚠️  Could not take screenshot '${label}': ${e.message}`);
  }
}

// ─── Wait for page to settle after a navigation/redirect ───────────────────
async function waitForNavigation(page, timeout = 15000) {
  try {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout });
  } catch {
    // Navigation may have already completed — that's fine
  }
}

// ─── Wait for ANY selector, return matched one or null ─────────────────────
async function waitForAny(page, selectors, timeout = 25000) {
  const result = await Promise.race(
    selectors.map((sel) =>
      page
        .waitForSelector(sel, { visible: true, timeout })
        .then(() => sel)
        .catch(() => null)
    )
  );
  return result;
}

// ─── Safe click ────────────────────────────────────────────────────────────
async function safeClick(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    await page.click(selector);
    return true;
  } catch {
    return false;
  }
}

// ─── Click submit: tries selectors then falls back to Enter ───────────────
async function clickSubmit(page, selectors = []) {
  for (const sel of selectors) {
    if (await safeClick(page, sel, 4000)) {
      console.log(`✅ Clicked submit: ${sel}`);
      return;
    }
  }
  console.warn("⚠️  No submit button found — pressing Enter");
  await page.keyboard.press("Enter");
}

// ─── Main login ────────────────────────────────────────────────────────────
async function performLogin(page) {
  console.log("🔐 Starting login...");

  await page.goto(
    "https://console.cloud.google.com/billing/projects?inv=1&invt=Abw5yQ",
    { waitUntil: "load", timeout: 60000 }
  );

  // ── Step 1: Google email ─────────────────────────────────────────────────
  await screenshot(page, "01-initial");

  const googleEmail = await waitForAny(page, ["#identifierId", 'input[type="email"]'], 15000);
  if (googleEmail) {
    console.log(`✅ Google email field: ${googleEmail}`);
    await page.type(googleEmail, "kasun.perera@sysco.com");
    await screenshot(page, "02-google-email-filled");

    await Promise.all([
      waitForNavigation(page, 20000),
      safeClick(page, "#identifierNext", 5000),
    ]);
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    console.warn("⚠️  Google email field not found — may already be redirected");
  }

  await screenshot(page, "03-after-google-next");

  // ── Step 2: Microsoft email (if shown) ───────────────────────────────────
  const msEmailField = await waitForAny(
    page,
    ["#i0116", 'input[name="loginfmt"]'],
    10000
  );

  if (msEmailField) {
    console.log(`✅ MS email field: ${msEmailField}`);
    await page.click(msEmailField, { clickCount: 3 });
    await page.type(msEmailField, "kasun.perera@sysco.com");
    await screenshot(page, "04-ms-email-filled");

    await Promise.all([
      waitForNavigation(page, 20000),
      clickSubmit(page, ["#idSIButton9", 'input[type="submit"]', 'button[type="submit"]']),
    ]);
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    console.log("ℹ️  MS email field not shown — skipping");
  }

  await screenshot(page, "05-after-ms-email");

  // ── Step 3: Detect next field (Okta username OR password) ────────────────
  const nextField = await waitForAny(
    page,
    [
      // Okta username selectors
      "#userInput",
      "#okta-signin-username",
      'input[name="username"]',
      'input[name="identifier"]',
      'input[placeholder*="username" i]',
      // MS/generic password (if Okta username step is skipped)
      "#i0118",
      'input[name="passwd"]',
      'input[type="password"]',
    ],
    30000
  );

  await screenshot(page, "06-detected-field");
  console.log(`✅ Detected field: ${nextField}`);

  // ── Step 3a: Okta username appeared ──────────────────────────────────────
  const isOktaUser =
    nextField &&
    !nextField.includes("password") &&
    !nextField.includes("passwd") &&
    !nextField.includes("i0118");

  if (isOktaUser) {
    console.log("✅ Okta username step");
    await page.type(nextField, "kper3360");
    await screenshot(page, "07-okta-username-filled");

    await Promise.all([
      waitForNavigation(page, 15000),
      clickSubmit(page, [
        "#userStoreFormSubmit",
        "#okta-signin-submit",
        'input[type="submit"]',
        'button[type="submit"]',
      ]),
    ]);
    await new Promise((r) => setTimeout(r, 3000));
    await screenshot(page, "08-after-okta-username");

    // Now expect password
    const pwAfterOkta = await waitForAny(
      page,
      ["#password", "#okta-signin-password", 'input[name="password"]', 'input[type="password"]'],
      20000
    );

    if (pwAfterOkta) {
      console.log(`✅ Password field after Okta: ${pwAfterOkta}`);
      console.log("⏳ Waiting 10 seconds before entering password...");
      await new Promise((r) => setTimeout(r, 10000));
      await page.type(pwAfterOkta, "Kf  @862953568");
      await screenshot(page, "09-password-filled");

      await Promise.all([
        waitForNavigation(page, 15000),
        clickSubmit(page, [
          "#signIn",
          "#okta-signin-submit",
          'input[type="submit"]',
          'button[type="submit"]',
        ]),
      ]);
      await new Promise((r) => setTimeout(r, 4000));
    } else {
      console.warn("⚠️  Password field not found after Okta username");
      await screenshot(page, "09-password-missing");
    }
  }

  // ── Step 3b: Password field appeared directly (no Okta username) ──────────
  if (!isOktaUser && nextField) {
    console.log("✅ Password field detected directly");
    console.log("⏳ Waiting 10 seconds before entering password...");
    await new Promise((r) => setTimeout(r, 10000));

    const pwFieldFresh = await waitForAny(
      page,
      [
        "#i0118",
        "#password",
        "#okta-signin-password",
        'input[name="passwd"]',
        'input[name="password"]',
        'input[type="password"]',
      ],
      15000
    );

    if (!pwFieldFresh) {
      console.warn("⚠️  Password field disappeared after wait — taking screenshot");
      await screenshot(page, "07-password-gone-after-wait");
    } else {
      console.log(`✅ Re-detected password field: ${pwFieldFresh}`);
      await page.type(pwFieldFresh, "Kg@862953568");
      await screenshot(page, "07-password-filled-direct");

      await Promise.all([
        waitForNavigation(page, 15000),
        clickSubmit(page, [
          "#idSIButton9",
          "#signIn",
          'input[type="submit"]',
          'button[type="submit"]',
        ]),
      ]);
      await new Promise((r) => setTimeout(r, 4000));
      await screenshot(page, "08-after-password-direct");
    }
  }

  if (!nextField) {
    console.warn("⚠️  No login field detected — may already be logged in or MFA required");
    await screenshot(page, "06-no-field-found");
  }

  // ── Step 4: Post-login prompts ────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 3000));

  const staySignedIn = await safeClick(page, "#idSIButton9", 8000);
  if (staySignedIn) {
    console.log("✅ Clicked 'Stay signed in'");
    await new Promise((r) => setTimeout(r, 2000));
  }

  const googleConsent = await safeClick(page, "button.VfPpkd-LgbsSe", 8000);
  if (googleConsent) {
    console.log("✅ Clicked Google consent button");
    await new Promise((r) => setTimeout(r, 2000));
  }

  try {
    await page.keyboard.press("Escape");
  } catch {
    // ignore if page navigated
  }
  await new Promise((r) => setTimeout(r, 1000));

  await screenshot(page, "10-login-complete");
  console.log("✅ Login flow completed");
}

// ─── Send email with CSV attachment ────────────────────────────────────────
async function sendReportEmail(csvFileName, current_date) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  const mailOptions = {
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: `GCP Cost Forecast Report - ${current_date}`,
    text: `Please find attached the GCP cost forecast report for ${current_date}.`,
    html: `<p>Please find attached the GCP cost forecast report for <strong>${current_date}</strong>.</p>`,
    attachments: [
      {
        filename: csvFileName,
        path: csvFileName,
        contentType: "text/csv",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
  console.log(`📧 Report emailed to ${EMAIL_TO}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await performLogin(page);

  const workbook = XLSX.readFile("input.xlsx");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const pages = [];

  for (let i = 0; i < rows.length; i++) {
    const provider = rows[i]["Provider"];
    let accountIdRaw = String(rows[i]["Account ID"]);
    const accountId = accountIdRaw.startsWith("*")
      ? accountIdRaw.slice(1)
      : accountIdRaw;

    if (provider !== "GCP") {
      console.log(`⏭️  Skipping row ${i + 1} — provider is '${provider}', not GCP`);
      continue;
    }

    const url = `${GCP_BASE_URL}${accountId};credits=NONE?inv=1&invt=Abywow&project=${accountId}`;
    try {
      const pg = await browser.newPage();
      await pg.goto(url, { waitUntil: "networkidle2", timeout: 40000 });
      await pg.waitForSelector("#_0rif_p6ntest-current-net-cost", { timeout: 30000 });
      await new Promise((res) => setTimeout(res, 2907));
      pages.push({ page: pg, rowIndex: i });
      console.log(`✅ Loaded GCP page for ${accountId}`);
    } catch (err) {
      console.error(`❌ Failed to open page for ${accountId}: ${err.message}`);
      rows[i]["Count"] = "Page Load Error";
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 15000));

  const currentDate = new Date();
  const current_date_file = new Date().toISOString().split("T")[0];
  const current_date = `${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
  const current_month_name = currentDate.toLocaleString("default", { month: "long" });
  const current_month = String(currentDate.getMonth() + 1).padStart(2, "0");
  const current_year = currentDate.getFullYear();
  const day_of_week = currentDate.toLocaleString("default", { weekday: "long" });
  const csvData = [];

  for (const { page: pgloop, rowIndex } of pages) {
    rows[rowIndex]["Date"] = current_date;

    try {
      await pgloop.waitForSelector("#_0rif_p6ntest-current-net-cost", { timeout: 10000 });
      const acost = await pgloop.$eval(
        "#_0rif_p6ntest-current-net-cost",
        (el) => el.textContent.trim()
      );
      rows[rowIndex]["Actual Cost"] = parseFloat(
        acost.replace("$", "").replace(/,/g, "")
      ).toFixed(2);
      console.log(`☁️  Row ${rowIndex + 1}: Actual Cost = ${acost.replace("$", "")}`);
    } catch (err) {
      console.warn(`⚠️  Actual Cost not found at row ${rowIndex + 1}: ${err.message}`);
      rows[rowIndex]["Actual Cost"] = "Not Found";
    }

    try {
      await pgloop.waitForSelector("#_0rif_p6ntest-forecasted-net-cost", { timeout: 10000 });
      const fcost = await pgloop.$eval(
        "#_0rif_p6ntest-forecasted-net-cost",
        (el) => el.textContent.trim()
      );
      rows[rowIndex]["Forecasted Cost"] = parseFloat(
        fcost.replace("$", "").replace(/,/g, "")
      ).toFixed(2);
      console.log(`☁️  Row ${rowIndex + 1}: Forecasted Cost = ${fcost.replace("$", "")}`);
    } catch (err) {
      console.warn(`⚠️  Forecasted Cost not found at row ${rowIndex + 1}: ${err.message}`);
      rows[rowIndex]["Forecasted Cost"] = "Not Found";
    }

    csvData.push({
      Provider: rows[rowIndex]["Provider"],
      "Account Name": rows[rowIndex]["Account Name"],
      "Account ID": rows[rowIndex]["Account ID"],
      Director: rows[rowIndex]["Director"],
      "Report Type": "weekly",
      "Month Name": current_month_name,
      "Report Date": current_date,
      "Month number": current_month,
      "Year number": current_year,
      "Day of Week": day_of_week,
      Actual: rows[rowIndex]["Actual Cost"],
      Forecast: rows[rowIndex]["Forecasted Cost"],
    });
  }

  const updatedSheet = XLSX.utils.json_to_sheet(rows);
  workbook.Sheets[workbook.SheetNames[0]] = updatedSheet;
  XLSX.writeFile(workbook, "input.xlsx");
  console.log("📊 Updated input.xlsx");

  const csvHeaders = [
    "Provider", "Account Name", "Account ID", "Director",
    "Report Type", "Month Name", "Report Date", "Month number",
    "Year number", "Day of Week", "Actual", "Forecast",
  ];
  const csvContent = [csvHeaders.join(",")];
  csvData.forEach((row) => {
    const values = csvHeaders.map((h) => row[h] ?? "");
    csvContent.push(values.join(","));
  });

  const csvFileName = `${current_date_file}.csv`;
  fs.writeFileSync(csvFileName, csvContent.join("\n"));
  console.log(`✅ CSV file saved as ${csvFileName}`);

  // Send report via email
  try {
    await sendReportEmail(csvFileName, current_date);
  } catch (err) {
    console.error("❌ Failed to send report email:", err.message);
  }

  await browser.close();
})();
