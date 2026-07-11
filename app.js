// ============================================================
// Venkey's Vault — plain HTML/CSS/JS, no build step required.
// Backend: Google Sheet via Apps Script (see Code.gs)
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbxDTMvfxgoLixii99mfGJtcBkvr4O1mDQnn9ShRA7G7AvyYmtmRBCN2TBA9g2Ph5Gyc/exec";

// ---------- Category config ----------
const CATEGORIES = [
  { key: "movies", label: "Movies", statusOptions: ["Watched", "Plan to Watch"], fields: [] },
  { key: "tvshows", label: "TV Shows", statusOptions: ["Watching", "Completed", "Plan to Watch"], fields: ["season", "episode"] },
  { key: "anime", label: "Anime", statusOptions: ["Watching", "Completed", "Plan to Watch"], fields: ["season", "episode"] },
  { key: "books", label: "Books", statusOptions: ["Reading", "Completed", "Plan to Read"], fields: [] },
  { key: "manga", label: "Manga", statusOptions: ["Reading", "Completed", "Plan to Read"], fields: ["chapter"] },
  { key: "games", label: "Games", statusOptions: ["Playing", "Completed", "Plan to Play"], fields: ["platform"] },
];
const PLATFORM_OPTIONS = ["PC", "Mobile"];

function getCategory(key) { return CATEGORIES.find((c) => c.key === key); }
function categoryLabel(key) { return getCategory(key)?.label ?? key; }

function progressLabel(entry) {
  const parts = [];
  if (entry.category === "tvshows" || entry.category === "anime") {
    if (entry.season) parts.push(`S${entry.season}`);
    if (entry.episode) parts.push(`E${entry.episode}`);
  }
  if (entry.category === "manga" && entry.chapter) parts.push(`Ch. ${entry.chapter}`);
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
function headerHtml() {
  const route = parseHash();
  const navLinks = CATEGORIES.map((c) => {
    const active = route.name === "category" && route.category === c.key;
    return `<a href="#/c/${c.key}" class="${active ? "active" : ""}">${c.label}</a>`;
  }).join("");

  const actions = isAuthed()
    ? `<a href="#/add" class="btn btn-primary">+ Add entry</a>
       <button class="link-muted" id="signOutBtn">Sign out</button>`
    : `<a href="#/login" class="btn">Sign in</a>`;

  return `
    <header class="site-header">
      <div class="wrap header-inner">
        <a href="#/" class="logo display">Venkey&rsquo;s Vault</a>
        <nav class="nav">${navLinks}</nav>
        <div class="header-actions">${actions}</div>
      </div>
    </header>`;
}

function wireHeader() {
  const btn = document.getElementById("signOutBtn");
  if (btn) btn.addEventListener("click", () => { clearAuth(); navigate("/"); });
}

// ---------- Entry card ----------
function entryCardHtml(entry) {
  const progress = progressLabel(entry);
  const img = entry.imageUrl
    ? `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.style.display='none'" />`
    : `<div class="no-image">No image</div>`;
  return `
    <a href="#/e/${entry.id}">
      <div class="card-poster">
        ${img}
        <div class="status-tag">${escapeHtml(entry.status)}</div>
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
        <p class="eyebrow">Venkey&rsquo;s Vault</p>
        <h1 class="display">Every film, show, book,<br /><em>and adventure logged.</em></h1>
        <p>A personal journal for movies, TV, anime, books, manga, and games. Tracked, rated, and remembered.</p>
        <div class="chips">
          ${CATEGORIES.map((c) => `<a class="chip" href="#/c/${c.key}">${c.label}</a>`).join("")}
        </div>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <div class="section-head">
          <h2 class="display">Recently logged</h2>
          <span class="count" id="entryCount"></span>
        </div>
        <div id="galleryTarget"><p class="loading-text">Loading…</p></div>
      </div>
    </section>
    <footer class="footer"><div class="wrap">Venkey&rsquo;s Vault · A personal journal</div></footer>
  `;
  wireHeader();

  const target = document.getElementById("galleryTarget");
  try {
    const entries = await getEntries();
    const sorted = [...entries].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
    );
    document.getElementById("entryCount").textContent = `${sorted.length} entries`;
    target.innerHTML = sorted.length
      ? `<div class="grid">${sorted.map(entryCardHtml).join("")}</div>`
      : `<div class="empty">The ledger is empty. Sign in and add your first entry.</div>`;
  } catch (err) {
    target.innerHTML = `<div class="empty error">${escapeHtml(err.message)}</div>`;
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
        <h1 class="display">${cat.label}</h1>
        <div class="filters" id="filters"></div>
        <div id="galleryTarget"><p class="loading-text">Loading…</p></div>
      </div>
    </section>
  `;
  wireHeader();

  const statuses = ["All", ...cat.statusOptions];
  let activeStatus = "All";
  const filtersEl = document.getElementById("filters");
  const target = document.getElementById("galleryTarget");

  let entries = [];
  try {
    entries = (await getEntries()).filter((e) => e.category === categoryKey);
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
    const filtered = activeStatus === "All" ? entries : entries.filter((e) => e.status === activeStatus);
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
            <span class="status-badge">${escapeHtml(entry.status)}</span>
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
        <a href="#/" class="logo display">Venkey&rsquo;s Vault</a>
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
