// ============================================================
// Venkey's Vault — plain HTML/CSS/JS, no build step required.
// Backend: Google Sheet via Apps Script (see Code.gs)
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbxDTMvfxgoLixii99mfGJtcBkvr4O1mDQnn9ShRA7G7AvyYmtmRBCN2TBA9g2Ph5Gyc/exec";

// ---------- Category config ----------
const CATEGORIES = [
  { key: "movies", label: "Movies", statusOptions: ["Watched", "Plan to Watch"], fields: [] },
  { key: "tvshows", label: "TV Shows", statusOptions: ["Watching", "On Hold", "Completed", "Plan to Watch"], fields: ["season", "episode"] },
  { key: "anime", label: "Anime", statusOptions: ["Watching", "On Hold", "Completed", "Plan to Watch"], fields: ["season", "episode"] },
  { key: "books", label: "Books", statusOptions: ["Reading", "Completed", "Plan to Read"], fields: [] },
  { key: "manga", label: "Manga", statusOptions: ["Reading", "On Hold", "Completed", "Plan to Read"], fields: ["chapter"] },
  { key: "comics", label: "Comics", statusOptions: ["Reading", "On Hold", "Completed", "Plan to Read"], fields: ["chapter"] },
  { key: "games", label: "Games", statusOptions: ["Playing", "On Hold", "Completed", "Plan to Play"], fields: ["platform"] },
];
const PLATFORM_OPTIONS = ["PC", "Mobile"];

// Statuses that count as "actively going through it right now" — used to
// build the homepage's "Currently in progress" section.
const IN_PROGRESS_STATUSES = ["Watching", "Reading", "Playing"];
function isInProgress(entry) { return IN_PROGRESS_STATUSES.includes(entry.status); }

// Color-coding: green = in progress, amber = on hold, purple = plan to X,
// red = completed (Movies' "Watched" counts as completed too).
function statusColorClass(status) {
  if (IN_PROGRESS_STATUSES.includes(status)) return "status-progress";
  if (status === "On Hold") return "status-hold";
  if (status.startsWith("Plan to")) return "status-plan";
  return "status-completed"; // Completed, Watched
}

// Priority grouping for the category page's "All" tab: in progress, then on
// hold, then plan-to-x, then completed/watched. Lower number = shown first.
function statusPriority(status) {
  if (IN_PROGRESS_STATUSES.includes(status)) return 0;
  if (status === "On Hold") return 1;
  if (status.startsWith("Plan to")) return 2;
  return 3;
}

function getCategory(key) { return CATEGORIES.find((c) => c.key === key); }
function categoryLabel(key) { return getCategory(key)?.label ?? key; }

// Short progress string shown on cards, e.g. "S2 · E14", "Ch. 87", "PC"
function progressLabel(entry) {
  const parts = [];
  if (entry.category === "tvshows" || entry.category === "anime") {
    if (entry.season) parts.push(`S${entry.season}`);
    if (entry.episode) parts.push(`E${entry.episode}`);
  }
  if ((entry.category === "manga" || entry.category === "comics") && entry.chapter) parts.push(`Ch. ${entry.chapter}`);
  if (entry.category === "games" && entry.platform) parts.push(entry.platform);
  return parts.length ? parts.join(" · ") : "";
}

function emptyEntry(category) {
  const cat = getCategory(category);
  return {
    id: "", category, title: "", imageUrl: "", status: cat.statusOptions[0],
    season: "", episode: "", chapter: "", platform: "", rating: "", review: "",
  };
}

function starsHtml(rating) {
  const r = Number(rating) || 0;
  if (!r) return "";
  let out = '<span class="stars">';
  for (let i = 0; i < 5; i++) out += i < r ? "★" : "☆";
  return out + "</span>";
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------- Auth (dummy, password-only) ----------
const AUTH_KEY = "pcd_owner_password";
function getAuthPassword() { return sessionStorage.getItem(AUTH_KEY); }
function isAuthed() { return !!getAuthPassword(); }
function setAuthPassword(pw) { sessionStorage.setItem(AUTH_KEY, pw); }
function clearAuth() { sessionStorage.removeItem(AUTH_KEY); }

// ---------- API ----------
async function apiFetchEntries() {
  const res = await fetch(`${API_URL}?t=${Date.now()}`);
  if (!res.ok) throw new Error("Could not load entries.");
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Could not load entries.");
  return json.entries;
}

async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Request failed.");
  return json;
}

async function apiVerifyPassword(password) {
  const json = await apiPost({ action: "verify", password });
  return json.success;
}
async function apiAddEntry(entry, password) {
  const json = await apiPost({ action: "add", password, entry });
  return json.entry;
}
async function apiUpdateEntry(id, entry, password) {
  const json = await apiPost({ action: "update", password, id, entry });
  return json.entry;
}
async function apiDeleteEntry(id, password) {
  await apiPost({ action: "delete", password, id });
}

// Simple in-memory cache so navigating between pages doesn't re-fetch every time.
let entriesCache = null;
async function getEntries(forceRefresh = false) {
  if (entriesCache && !forceRefresh) return entriesCache;
  entriesCache = await apiFetchEntries();
  return entriesCache;
}

// ---------- Display preferences: theme + grid columns ----------
// Both are per-device (localStorage) and never touch the Sheet.
const THEME_KEY = "vault_theme";   // "light" | "dark" (absent = follow the system)
const COLS_KEY = "vault_columns";  // JSON: { mobile: n, desktop: n }
const THEME_COLORS = { dark: "#232629", light: "#f6f4ef" }; // browser-bar colour
const COLS_MIN = 2;
const COLS_MAX = { mobile: 6, desktop: 10 };
const COLS_DEFAULT = { mobile: 2, desktop: 5 };
const desktopQuery = window.matchMedia("(min-width: 700px)");
const lightQuery = window.matchMedia("(prefers-color-scheme: light)");

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode etc. */ } }

// -- Theme --
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return lightQuery.matches ? "light" : "dark";
}
function themeToggleLabel() {
  return currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
  const btn = document.getElementById("themeToggle");
  if (btn) { btn.setAttribute("aria-label", themeToggleLabel()); btn.title = themeToggleLabel(); }
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  storageSet(THEME_KEY, next);
  applyTheme(next);
}
// If the visitor never chose a theme, follow the OS when it changes.
lightQuery.addEventListener("change", (e) => {
  if (!storageGet(THEME_KEY)) applyTheme(e.matches ? "light" : "dark");
});

// -- Columns --
function deviceClass() { return desktopQuery.matches ? "desktop" : "mobile"; }
function clampCols(n, device) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return COLS_DEFAULT[device];
  return Math.min(COLS_MAX[device], Math.max(COLS_MIN, v));
}
function loadColsPrefs() {
  try { return JSON.parse(storageGet(COLS_KEY) || "{}") || {}; } catch { return {}; }
}
function getCols() {
  const device = deviceClass();
  const saved = loadColsPrefs()[device];
  return saved === undefined ? COLS_DEFAULT[device] : clampCols(saved, device);
}
function saveCols(n) {
  const prefs = loadColsPrefs();
  prefs[deviceClass()] = n;
  storageSet(COLS_KEY, JSON.stringify(prefs));
}
// Pushes the column count into CSS variables. The "Recently logged" strip
// runs at double density (capped), and gaps tighten as columns increase.
function applyCols(n) {
  const desktop = deviceClass() === "desktop";
  const mini = Math.min(n * 2, desktop ? 12 : 8);
  const gap = Math.max(8, Math.min(desktop ? 24 : 16, Math.round((desktop ? 120 : 60) / n)));
  const style = document.documentElement.style;
  style.setProperty("--cols", n);
  style.setProperty("--cols-mini", mini);
  style.setProperty("--gap", `${gap}px`);
  style.setProperty("--gap-mini", `${Math.max(6, Math.round(gap / 2))}px`);
}
function columnsControlHtml() {
  const device = deviceClass();
  const n = getCols();
  return `
    <div class="cols-control">
      <span>Columns</span>
      <input type="range" class="cols-slider" min="${COLS_MIN}" max="${COLS_MAX[device]}" step="1" value="${n}" aria-label="Cards per row" />
      <output class="cols-value">${n}</output>
    </div>`;
}
function setColsOutputs(n) {
  document.querySelectorAll(".cols-value").forEach((o) => { o.textContent = n; });
}
function wireColumnsControl() {
  document.querySelectorAll(".cols-slider").forEach((slider) => {
    slider.addEventListener("input", () => {
      const n = clampCols(slider.value, deviceClass());
      saveCols(n);
      applyCols(n);
      setColsOutputs(n);
    });
  });
}
// Rotating a phone / resizing across the breakpoint switches between the
// mobile and desktop preference (and slider range).
desktopQuery.addEventListener("change", () => {
  const n = getCols();
  document.querySelectorAll(".cols-slider").forEach((s) => { s.max = COLS_MAX[deviceClass()]; s.value = n; });
  setColsOutputs(n);
  applyCols(n);
});
applyCols(getCols());

// ---------- Router ----------
const app = document.getElementById("app");

function navigate(path) { window.location.hash = path; }

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "c" && parts[1]) return { name: "category", category: parts[1] };
  if (parts[0] === "e" && parts[1]) return { name: "detail", id: parts[1] };
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "add") return { name: "add" };
  if (parts[0] === "edit" && parts[1]) return { name: "edit", id: parts[1] };
  return { name: "notfound" };
}

async function router() {
  const route = parseHash();
  window.scrollTo(0, 0);
  try {
    if (route.name === "home") return renderHome();
    if (route.name === "category") return renderCategory(route.category);
    if (route.name === "detail") return renderDetail(route.id);
    if (route.name === "login") return renderLogin();
    if (route.name === "add") return renderAdd();
    if (route.name === "edit") return renderEdit(route.id);
    return renderNotFound();
  } catch (err) {
    app.innerHTML = `<div class="wrap"><div class="empty error">${escapeHtml(err.message)}</div></div>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);

// ---------- Shared header ----------
const ICON_SUN = '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const ICON_MOON = '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

function themeToggleHtml() {
  const label = escapeHtml(themeToggleLabel());
  return `<button type="button" class="icon-btn" id="themeToggle" aria-label="${label}" title="${label}">${ICON_SUN}${ICON_MOON}</button>`;
}

function headerHtml() {
  const route = parseHash();
  const authed = isAuthed();
  const navLinks = CATEGORIES.map((c) => {
    const active = route.name === "category" && route.category === c.key;
    return `<a href="#/c/${c.key}" class="${active ? "active" : ""}"${active ? ' aria-current="page"' : ""}>${c.label}</a>`;
  }).join("");

  const ownerActions = authed
    ? `<div class="owner-actions">
         <a href="#/add" class="btn btn-primary">+ Add entry</a>
         <div class="owner-links">
           <button type="button" class="link-muted" id="exportCsvBtn">Export CSV</button>
           <button type="button" class="link-muted" id="signOutBtn">Sign out</button>
         </div>
       </div>`
    : "";
  const guestAction = authed ? "" : `<a href="#/login" class="btn">Sign in</a>`;

  return `
    <header class="site-header">
      <div class="wrap header-grid ${authed ? "has-owner" : ""}">
        <a href="#/" class="logo display"><img src="favicon.png" alt="" class="logo-icon" /><span class="logo-text">Venkey&rsquo;s Vault</span></a>
        <div class="header-tools">${themeToggleHtml()}${guestAction}</div>
        ${ownerActions}
        <div class="header-nav-row"><nav class="nav" aria-label="Categories">${navLinks}</nav></div>
      </div>
    </header>`;
}

function wireHeader() {
  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", () => { clearAuth(); navigate("/"); });

  const exportBtn = document.getElementById("exportCsvBtn");
  if (exportBtn) exportBtn.addEventListener("click", downloadCsv);

  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  // The header is rebuilt on every page, so the category strip would snap
  // back to the start. Re-centre the active tab (e.g. "Games" on a phone).
  const navRow = document.querySelector(".header-nav-row");
  const activeLink = navRow && navRow.querySelector("a.active");
  if (activeLink) {
    navRow.scrollLeft = activeLink.offsetLeft - (navRow.clientWidth - activeLink.offsetWidth) / 2;
  }
}

// ---------- CSV export ----------
const CSV_COLUMNS = [
  "category", "title", "status", "season", "episode", "chapter", "platform",
  "rating", "review", "imageUrl", "createdAt", "updatedAt",
];

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function entriesToCsv(entries) {
  const header = CSV_COLUMNS.join(",");
  const rows = entries.map((e) => CSV_COLUMNS.map((col) => csvEscape(e[col])).join(","));
  return [header, ...rows].join("\n");
}

async function downloadCsv() {
  const exportBtn = document.getElementById("exportCsvBtn");
  if (exportBtn) exportBtn.disabled = true;
  try {
    const entries = await getEntries();
    const csv = entriesToCsv(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `venkeys-vault-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Could not export CSV: ${err.message}`);
  } finally {
    if (exportBtn) exportBtn.disabled = false;
  }
}

// ---------- Entry card ----------
function entryCardHtml(entry) {
  const progress = progressLabel(entry);
  const img = entry.imageUrl
    ? `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.style.display='none'" />`
    : `<div class="no-image">No image</div>`;
  return `
    <a href="#/e/${entry.id}" class="card">
      <div class="card-poster">
        ${img}
        <div class="status-tag ${statusColorClass(entry.status)}" title="${escapeHtml(entry.status)}"><span class="sr-only">${escapeHtml(entry.status)}</span></div>
      </div>
      <div class="card-title display">${escapeHtml(entry.title)}</div>
      <div class="card-meta">
        <span class="card-progress">${escapeHtml(progress)}</span>
        ${starsHtml(entry.rating)}
      </div>
    </a>`;
}

// ---------- Pages ----------
async function renderHome() {
  app.innerHTML = `
    ${headerHtml()}
    <section class="hero">
      <div class="wrap">
        <h1 class="display">Every entertainment<br /><em>is logged.</em></h1>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head">
          <h2 class="display">Currently in progress</h2>
          <span class="count" id="progressCount"></span>
          ${columnsControlHtml()}
        </div>
        <div id="progressTarget"><p class="loading-text">Loading…</p></div>
      </div>
    </section>
    <section class="section section-mini">
      <div class="wrap">
        <div class="section-head">
          <h2 class="display-mini">Recently logged</h2>
          <span class="count" id="entryCount"></span>
        </div>
        <div id="galleryTarget"><p class="loading-text">Loading…</p></div>
      </div>
    </section>
    <footer class="footer"><div class="wrap">Venkey&rsquo;s Vault · A personal journal</div></footer>
  `;
  wireHeader();
  wireColumnsControl();

  const progressTarget = document.getElementById("progressTarget");
  const galleryTarget = document.getElementById("galleryTarget");
  try {
    const entries = await getEntries();
    // Newest first: entries always get appended to the bottom of the Sheet,
    // so reversing the fetch order is more reliable than parsing timestamps
    // (which can misbehave if Sheets reformats a date-looking string).
    const reversed = [...entries].reverse();

    // Primary section: anything actively Watching/Reading/Playing right now.
    const inProgress = reversed.filter(isInProgress);
    document.getElementById("progressCount").textContent = `${inProgress.length} entries`;
    progressTarget.innerHTML = inProgress.length
      ? `<div class="grid">${inProgress.map(entryCardHtml).join("")}</div>`
      : `<div class="empty">Nothing in progress right now. Add an entry, or mark one as Watching/Reading/Playing.</div>`;

    // Secondary, smaller section: just the raw recent activity feed.
    const HOME_LIMIT = 12;
    const shown = reversed.slice(0, HOME_LIMIT);
    document.getElementById("entryCount").textContent =
      reversed.length > HOME_LIMIT ? `${shown.length} of ${reversed.length} entries` : `${reversed.length} entries`;
    galleryTarget.innerHTML = shown.length
      ? `<div class="grid grid-mini">${shown.map(entryCardHtml).join("")}</div>`
      : `<div class="empty">The ledger is empty. Sign in and add your first entry.</div>`;
  } catch (err) {
    const msg = `<div class="empty error">${escapeHtml(err.message)}</div>`;
    progressTarget.innerHTML = msg;
    galleryTarget.innerHTML = msg;
  }
}

async function renderCategory(categoryKey) {
  const cat = getCategory(categoryKey);
  if (!cat) {
    app.innerHTML = `${headerHtml()}<div class="wrap section"><p>Unknown category.</p></div>`;
    wireHeader();
    return;
  }

  app.innerHTML = `
    ${headerHtml()}
    <section class="section">
      <div class="wrap">
        <div class="section-head">
          <h1 class="display">${cat.label}</h1>
          ${columnsControlHtml()}
        </div>
        <div class="filters" id="filters"></div>
        <div id="galleryTarget"><p class="loading-text">Loading…</p></div>
      </div>
    </section>
  `;
  wireHeader();
  wireColumnsControl();

  const statuses = ["All", ...cat.statusOptions];
  let activeStatus = "All";
  const filtersEl = document.getElementById("filters");
  const target = document.getElementById("galleryTarget");

  let entries = [];
  try {
    // Newest first, same approach as the home page: reverse the fetch
    // order rather than parsing timestamps.
    entries = (await getEntries()).filter((e) => e.category === categoryKey).reverse();
  } catch (err) {
    target.innerHTML = `<div class="empty error">${escapeHtml(err.message)}</div>`;
    return;
  }

  function renderFilters() {
    filtersEl.innerHTML = statuses
      .map((s) => `<button class="filter-btn ${s === activeStatus ? "active" : ""}" data-status="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
      .join("");
    filtersEl.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeStatus = btn.dataset.status;
        renderFilters();
        renderList();
      });
    });
  }

  function renderList() {
    // "All" tab: group by priority (in progress > on hold > plan to x >
    // completed/watched). Array.sort is stable, so the existing
    // newest-first order is preserved within each group.
    const filtered = activeStatus === "All"
      ? [...entries].sort((a, b) => statusPriority(a.status) - statusPriority(b.status))
      : entries.filter((e) => e.status === activeStatus);
    target.innerHTML = filtered.length
      ? `<div class="grid">${filtered.map(entryCardHtml).join("")}</div>`
      : `<div class="empty">Nothing here yet.</div>`;
  }

  renderFilters();
  renderList();
}

async function renderDetail(id) {
  app.innerHTML = `${headerHtml()}<div class="wrap-detail"><p class="loading-text">Loading…</p></div>`;
  wireHeader();

  let entry;
  try {
    const entries = await getEntries();
    entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error("Entry not found.");
  } catch (err) {
    app.innerHTML = `${headerHtml()}<div class="wrap-detail"><div class="empty error">${escapeHtml(err.message)}</div></div>`;
    wireHeader();
    return;
  }

  const img = entry.imageUrl
    ? `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)}" />`
    : `<div class="no-image">No image</div>`;
  const progress = progressLabel(entry);

  app.innerHTML = `
    ${headerHtml()}
    <div class="wrap-detail">
      <div class="detail-grid">
        <div class="detail-poster"><div class="card-poster">${img}</div></div>
        <div>
          <p class="eyebrow">${escapeHtml(categoryLabel(entry.category))}</p>
          <h1 class="display">${escapeHtml(entry.title)}</h1>
          <div class="detail-tags">
            <span class="status-badge ${statusColorClass(entry.status)}">${escapeHtml(entry.status)}</span>
            ${progress ? `<span>${escapeHtml(progress)}</span>` : ""}
            ${starsHtml(entry.rating)}
          </div>
          ${entry.review ? `<p class="review-text">${escapeHtml(entry.review)}</p>` : ""}
          ${isAuthed() ? `<a href="#/edit/${entry.id}" class="btn" style="margin-top:32px;display:inline-block;">Edit entry</a>` : ""}
        </div>
      </div>
    </div>
  `;
  wireHeader();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <a href="#/" class="logo display"><img src="favicon.png" alt="" class="logo-icon" /><span class="logo-text">Venkey&rsquo;s Vault</span></a>
        <h1 class="display">Sign in</h1>
        <p class="sub">Enter the owner password to add or edit entries.</p>
        <form id="loginForm" style="margin-top:32px;">
          <div class="field">
            <label>Password</label>
            <input type="password" id="passwordInput" required autofocus />
          </div>
          <p class="error-text" id="loginError" style="display:none;"></p>
          <button type="submit" class="btn btn-primary" style="width:100%;" id="loginSubmit">Sign in</button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById("loginForm");
  const errorEl = document.getElementById("loginError");
  const submitBtn = document.getElementById("loginSubmit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    const password = document.getElementById("passwordInput").value;
    try {
      const ok = await apiVerifyPassword(password);
      if (!ok) {
        errorEl.textContent = "Incorrect password.";
        errorEl.style.display = "block";
        return;
      }
      setAuthPassword(password);
      navigate("/");
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
}

function requireAuthOr(redirectTo) {
  if (!isAuthed()) {
    navigate(redirectTo || "/login");
    return false;
  }
  return true;
}

// ---------- Entry form (shared by add + edit) ----------
function entryFormHtml(entry, { showDelete } = {}) {
  const cat = getCategory(entry.category);
  return `
    <form id="entryForm">
      <div class="field">
        <label>Category</label>
        <select id="f_category">
          ${CATEGORIES.map((c) => `<option value="${c.key}" ${c.key === entry.category ? "selected" : ""}>${c.label}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Title</label>
        <input id="f_title" required value="${escapeHtml(entry.title)}" placeholder="e.g. The Bear" />
      </div>
      <div class="field">
        <label>Image URL</label>
        <input id="f_imageUrl" value="${escapeHtml(entry.imageUrl)}" placeholder="Paste a Pinterest image link or any direct image URL" />
        <p class="hint">Right-click a Pinterest image → &ldquo;Copy image address&rdquo; for a direct link.</p>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="f_status">
          ${cat.statusOptions.map((s) => `<option value="${s}" ${s === entry.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div id="dynamicFields"></div>
      <div class="field">
        <label>Rating (0–5)</label>
        <input type="number" min="0" max="5" id="f_rating" value="${escapeHtml(entry.rating)}" />
      </div>
      <div class="field">
        <label>Review / notes</label>
        <textarea id="f_review" rows="4">${escapeHtml(entry.review)}</textarea>
      </div>
      <p class="error-text" id="formError" style="display:none;"></p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="formSubmit">Save entry</button>
        ${showDelete ? `<button type="button" class="btn btn-danger" id="formDelete">Delete</button>` : ""}
      </div>
    </form>
  `;
}

function dynamicFieldsHtml(categoryKey, entry) {
  const cat = getCategory(categoryKey);
  let html = "";
  if (cat.fields.includes("season")) {
    html += `
      <div class="field-row">
        <div class="field"><label>Season</label><input type="number" min="0" id="f_season" value="${escapeHtml(entry.season)}" /></div>
        <div class="field"><label>Episode</label><input type="number" min="0" id="f_episode" value="${escapeHtml(entry.episode)}" /></div>
      </div>`;
  }
  if (cat.fields.includes("chapter")) {
    html += `<div class="field"><label>Chapter</label><input type="number" min="0" id="f_chapter" value="${escapeHtml(entry.chapter)}" /></div>`;
  }
  if (cat.fields.includes("platform")) {
    html += `
      <div class="field"><label>Platform</label>
        <select id="f_platform">
          <option value="">Select platform</option>
          ${PLATFORM_OPTIONS.map((p) => `<option value="${p}" ${p === entry.platform ? "selected" : ""}>${p}</option>`).join("")}
        </select>
      </div>`;
  }
  return html;
}

function readFormEntry(baseEntry) {
  const category = document.getElementById("f_category").value;
  return {
    ...baseEntry,
    category,
    title: document.getElementById("f_title").value,
    imageUrl: document.getElementById("f_imageUrl").value,
    status: document.getElementById("f_status").value,
    season: document.getElementById("f_season")?.value ?? "",
    episode: document.getElementById("f_episode")?.value ?? "",
    chapter: document.getElementById("f_chapter")?.value ?? "",
    platform: document.getElementById("f_platform")?.value ?? "",
    rating: document.getElementById("f_rating").value,
    review: document.getElementById("f_review").value,
  };
}

function wireCategoryDependentFields(entryRef) {
  const dynTarget = document.getElementById("dynamicFields");
  const statusSelect = document.getElementById("f_status");
  const categorySelect = document.getElementById("f_category");

  function refreshDynamic() {
    dynTarget.innerHTML = dynamicFieldsHtml(categorySelect.value, entryRef);
  }
  function refreshStatuses() {
    const cat = getCategory(categorySelect.value);
    statusSelect.innerHTML = cat.statusOptions.map((s) => `<option value="${s}">${s}</option>`).join("");
  }

  categorySelect.addEventListener("change", () => {
    refreshStatuses();
    refreshDynamic();
  });

  refreshDynamic();
}

function renderAdd() {
  if (!requireAuthOr("/login")) return;
  const initialCategory = "movies";
  const entry = emptyEntry(initialCategory);

  app.innerHTML = `
    ${headerHtml()}
    <div class="wrap-narrow section">
      <h1 class="display">Add entry</h1>
      <div style="margin-top:32px;">${entryFormHtml(entry)}</div>
    </div>
  `;
  wireHeader();
  wireCategoryDependentFields(entry);

  const form = document.getElementById("entryForm");
  const errorEl = document.getElementById("formError");
  const submitBtn = document.getElementById("formSubmit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    try {
      const payload = readFormEntry(entry);
      const created = await apiAddEntry(payload, getAuthPassword());
      entriesCache = null; // force refresh next time gallery loads
      navigate(`/e/${created.id}`);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Save entry";
    }
  });
}

async function renderEdit(id) {
  if (!requireAuthOr("/login")) return;

  app.innerHTML = `${headerHtml()}<div class="wrap-narrow section"><p class="loading-text">Loading…</p></div>`;
  wireHeader();

  let entry;
  try {
    const entries = await getEntries();
    entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error("Entry not found.");
  } catch (err) {
    app.innerHTML = `${headerHtml()}<div class="wrap-narrow section"><div class="empty error">${escapeHtml(err.message)}</div></div>`;
    wireHeader();
    return;
  }

  app.innerHTML = `
    ${headerHtml()}
    <div class="wrap-narrow section">
      <h1 class="display">Edit entry</h1>
      <div style="margin-top:32px;">${entryFormHtml(entry, { showDelete: true })}</div>
    </div>
  `;
  wireHeader();
  wireCategoryDependentFields(entry);

  const form = document.getElementById("entryForm");
  const errorEl = document.getElementById("formError");
  const submitBtn = document.getElementById("formSubmit");
  const deleteBtn = document.getElementById("formDelete");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    try {
      const payload = readFormEntry(entry);
      await apiUpdateEntry(id, payload, getAuthPassword());
      entriesCache = null;
      navigate(`/e/${id}`);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Save entry";
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    submitBtn.disabled = true;
    deleteBtn.disabled = true;
    try {
      await apiDeleteEntry(id, getAuthPassword());
      entriesCache = null;
      navigate("/");
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
      submitBtn.disabled = false;
      deleteBtn.disabled = false;
    }
  });
}

function renderNotFound() {
  app.innerHTML = `${headerHtml()}<div class="wrap section"><p>Page not found.</p></div>`;
  wireHeader();
}
