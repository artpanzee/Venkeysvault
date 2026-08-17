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
// build the homepage's "Currently in progress" section. "On Hold" is
// deliberately excluded: it means paused, not in progress.
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
    externalSource: "", externalId: "", externalTitle: "", epStatus: "",
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
  if (parts[0] === "updates") return { name: "updates" };
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
    if (route.name === "updates") return renderUpdates();
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

  const active = route.name === "updates" ? "active" : "";
  const actions = isAuthed()
    ? `<a href="#/add" class="btn btn-primary">+ Add entry</a>
       <a href="#/updates" class="link-muted ${active}">Updates</a>
       <button class="link-muted" id="exportCsvBtn">Export CSV</button>
       <button class="link-muted" id="signOutBtn">Sign out</button>`
    : `<a href="#/updates" class="link-muted ${active}">Updates</a>
       <a href="#/login" class="btn">Sign in</a>`;

  return `
    <header class="site-header">
      <div class="wrap header-top">
        <a href="#/" class="logo display"><img src="favicon.png" alt="" class="logo-icon" />Venkey&rsquo;s Vault</a>
        <div class="header-actions">${actions}</div>
      </div>
      <div class="wrap header-nav-row">
        <nav class="nav">${navLinks}</nav>
      </div>
    </header>`;
}

function wireHeader() {
  const btn = document.getElementById("signOutBtn");
  if (btn) btn.addEventListener("click", () => { clearAuth(); navigate("/"); });

  const exportBtn = document.getElementById("exportCsvBtn");
  if (exportBtn) exportBtn.addEventListener("click", downloadEntriesCsv);
}

// ---------- CSV export (signed-in only) ----------
const CSV_COLUMNS = [
  "category", "title", "status", "season", "episode", "chapter", "platform",
  "rating", "review", "imageUrl", "createdAt", "updatedAt",
];

function csvEscape(value) {
  const str = String(value ?? "");
  // Quote any field containing a comma, quote, or newline; double up inner quotes.
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function entriesToCsv(entries) {
  const header = CSV_COLUMNS.join(",");
  const rows = entries.map((e) => CSV_COLUMNS.map((col) => csvEscape(e[col])).join(","));
  return [header, ...rows].join("\n");
}

async function downloadEntriesCsv() {
  const exportBtn = document.getElementById("exportCsvBtn");
  const original = exportBtn?.textContent;
  if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = "Exporting…"; }
  try {
    const entries = await getEntries();
    const csv = entriesToCsv(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
    if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = original; }
  }
}

// ---------- New episode check (AniList for anime, TVmaze for TV shows) ----------
// Both public APIs, callable directly from the browser (CORS-friendly, no
// API key). On-demand only (button click), not automatic.
//
// Accuracy strategy: fuzzy title search is unreliable for uncommon or
// ambiguous titles, so instead of auto-trusting a "best guess," entries are
// checked by exact database ID once linked (entry.externalSource /
// externalId / externalTitle, persisted to the Sheet). Unlinked entries show
// a "Find match" picker (top candidates) instead of a possibly-wrong result.

const EXPECTED_SOURCE = { anime: "anilist", tvshows: "tvmaze" };

function isLinked(entry) {
  return !!entry.externalId && entry.externalSource === EXPECTED_SOURCE[entry.category];
}

// ----- Direct-by-ID lookups (used once an entry is linked) -----

async function fetchAniListById(id) {
  const query = `query ($id: Int) {
    Media(id: $id, type: ANIME) {
      title { romaji english }
      status
      episodes
      nextAiringEpisode { episode }
      relations {
        edges {
          relationType
          node { id type title { romaji english } }
        }
      }
    }
  }`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables: { id: Number(id) } }),
  });
  if (!res.ok) throw new Error("AniList request failed");
  const json = await res.json();
  const media = json?.data?.Media;
  if (!media) return null;
  let latestEpisode = 0;
  if (media.nextAiringEpisode) latestEpisode = media.nextAiringEpisode.episode - 1;
  else if (media.status === "FINISHED" && media.episodes) latestEpisode = media.episodes;

  const sequelEdge = (media.relations?.edges || []).find(
    (e) => e.relationType === "SEQUEL" && e.node.type === "ANIME",
  );
  const sequel = sequelEdge
    ? { id: sequelEdge.node.id, title: sequelEdge.node.title.english || sequelEdge.node.title.romaji }
    : null;

  return {
    title: media.title.english || media.title.romaji,
    status: media.status,
    totalEpisodes: media.episodes,
    latestEpisode,
    sequel,
  };
}

async function fetchTVMazeById(id) {
  const res = await fetch(`https://api.tvmaze.com/shows/${id}?embed=episodes`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("TVmaze request failed");
  const show = await res.json();
  const episodes = show?._embedded?.episodes || [];
  const today = new Date();
  const aired = episodes.filter((ep) => ep.airdate && new Date(ep.airdate) <= today);
  if (!aired.length) return { title: show.name, latestSeason: 0, latestEpisode: 0 };
  const latest = aired.reduce((a, b) => {
    if (a.season !== b.season) return a.season > b.season ? a : b;
    return a.number > b.number ? a : b;
  });
  return { title: show.name, latestSeason: latest.season, latestEpisode: latest.number };
}

// ----- Candidate search (used to link an entry) -----

async function searchAniListCandidates(title) {
  const query = `query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(search: $search, type: ANIME) {
        id
        title { romaji english }
        startDate { year }
        format
      }
    }
  }`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables: { search: title, perPage: 5 } }),
  });
  if (!res.ok) throw new Error("AniList search failed");
  const json = await res.json();
  const list = json?.data?.Page?.media || [];
  return list.map((m) => ({
    id: m.id,
    source: "anilist",
    title: m.title.english || m.title.romaji,
    year: m.startDate?.year || "—",
    meta: m.format || "",
  }));
}

async function searchTVMazeCandidates(title) {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`);
  if (!res.ok) throw new Error("TVmaze search failed");
  const json = await res.json();
  return json.slice(0, 5).map((r) => ({
    id: r.show.id,
    source: "tvmaze",
    title: r.show.name,
    year: r.show.premiered ? r.show.premiered.slice(0, 4) : "—",
    meta: r.show.type || "",
  }));
}

async function searchCandidates(entry) {
  if (entry.category === "anime") return searchAniListCandidates(entry.title);
  if (entry.category === "tvshows") return searchTVMazeCandidates(entry.title);
  return [];
}

// ----- Comparison result for a linked entry -----

async function checkLinkedEntry(entry) {
  try {
    if (entry.category === "anime") {
      const r = await fetchAniListById(entry.externalId);
      if (!r) return { status: "error", detail: "Linked anime not found on AniList anymore." };
      const logged = Number(entry.episode) || 0;
      if (r.latestEpisode > logged) {
        return { status: "new", detail: `Latest: Ep ${r.latestEpisode} · you're at Ep ${logged || "—"}` };
      }
      // Fully caught up on this season. If it's finished and AniList lists a
      // sequel, surface it so the person can link forward with one click
      // instead of searching again.
      const seasonDone = r.status === "FINISHED" && r.totalEpisodes && logged >= r.totalEpisodes;
      if (seasonDone && r.sequel) {
        return {
          status: "sequelFound",
          detail: `You've finished "${r.title}" (${r.totalEpisodes} eps). Next season found:`,
          sequel: r.sequel,
        };
      }
      if (seasonDone) {
        return { status: "upToDate", detail: `Finished "${r.title}" (${r.totalEpisodes} eps) — no next season found yet.` };
      }
      return { status: "upToDate", detail: `Caught up through Ep ${logged || 0}` };
    }
    if (entry.category === "tvshows") {
      const r = await fetchTVMazeById(entry.externalId);
      if (!r) return { status: "error", detail: "Linked show not found on TVmaze anymore." };
      const loggedSeason = Number(entry.season) || 0;
      const loggedEpisode = Number(entry.episode) || 0;
      const isNewer = r.latestSeason > loggedSeason || (r.latestSeason === loggedSeason && r.latestEpisode > loggedEpisode);
      if (isNewer) {
        return { status: "new", detail: `Latest: S${r.latestSeason}E${r.latestEpisode} · you're at S${loggedSeason}E${loggedEpisode}` };
      }
      return { status: "upToDate", detail: `Caught up through S${loggedSeason}E${loggedEpisode}` };
    }
    return { status: "error", detail: "Unsupported category." };
  } catch (err) {
    return { status: "error", detail: "Check failed — try again later." };
  }
}

// ----- Rendering + state for the check panel -----
// epCheckState: array of { entry, result, candidates, loadingCandidates }
let epCheckState = [];

function epBadge(status) {
  return {
    new: "🟢 New episode",
    upToDate: "⚪ Up to date",
    unlinked: "🔗 Not linked",
    sequelFound: "🎬 Season complete",
    error: "⚠️ Check failed",
  }[status];
}

function renderEpCheckResults() {
  const resultsEl = document.getElementById("episodeCheckResults");
  if (!resultsEl) return;

  resultsEl.innerHTML = `<div class="ep-check-list">${epCheckState
    .map((item, idx) => {
      const { entry, result, candidates, loadingCandidates } = item;

      if (candidates) {
        const list = candidates.length
          ? candidates
              .map(
                (c) => `
              <button class="ep-candidate" data-action="link" data-idx="${idx}" data-cid="${c.id}" data-source="${c.source}">
                ${escapeHtml(c.title)} <span class="ep-candidate-year">(${escapeHtml(String(c.year))}${c.meta ? " · " + escapeHtml(c.meta) : ""})</span>
              </button>`,
              )
              .join("")
          : `<p class="ep-check-detail">No results found. Try adjusting the entry's title.</p>`;
        return `
          <div class="ep-check-row ep-check-row-open">
            <a href="#/e/${entry.id}" class="ep-check-title">${escapeHtml(entry.title)}</a>
            <span class="ep-check-badge ep-unlinked">${epBadge("unlinked")}</span>
            <button class="ep-cancel" data-action="cancel-find" data-idx="${idx}">Cancel</button>
            <div class="ep-candidate-list">${list}</div>
          </div>`;
      }

      if (loadingCandidates) {
        return `
          <div class="ep-check-row">
            <a href="#/e/${entry.id}" class="ep-check-title">${escapeHtml(entry.title)}</a>
            <span class="ep-check-detail">Searching…</span>
          </div>`;
      }

      if (!isLinked(entry)) {
        const findBtn = isAuthed()
          ? `<button class="ep-find-btn" data-action="find" data-idx="${idx}">Find match</button>`
          : `<span class="ep-check-detail">Sign in to link this match</span>`;
        return `
          <div class="ep-check-row">
            <a href="#/e/${entry.id}" class="ep-check-title">${escapeHtml(entry.title)}</a>
            <span class="ep-check-badge ep-unlinked">${epBadge("unlinked")}</span>
            ${findBtn}
          </div>`;
      }

      if (!result) {
        return `
          <div class="ep-check-row">
            <a href="#/e/${entry.id}" class="ep-check-title">${escapeHtml(entry.title)}</a>
            <span class="ep-check-detail">Checking…</span>
          </div>`;
      }

      if (result.status === "sequelFound" && result.sequel) {
        const linkBtn = isAuthed()
          ? `<button class="ep-candidate" data-action="link-next" data-idx="${idx}">Link "${escapeHtml(result.sequel.title)}"</button>`
          : `<span class="ep-check-detail">Sign in to link the next season</span>`;
        return `
          <div class="ep-check-row ep-check-row-open">
            <a href="#/e/${entry.id}" class="ep-check-title">${escapeHtml(entry.title)}</a>
            <span class="ep-check-badge ep-sequelFound">${epBadge("sequelFound")}</span>
            <span class="ep-check-detail">${escapeHtml(result.detail)}</span>
            <div class="ep-candidate-list">${linkBtn}</div>
          </div>`;
      }

      const relink = isAuthed()
        ? `<button class="ep-cancel" data-action="find" data-idx="${idx}">Change match</button>`
        : "";
      return `
        <div class="ep-check-row">
          <a href="#/e/${entry.id}" class="ep-check-title">${escapeHtml(entry.title)}</a>
          <span class="ep-check-badge ep-${result.status}">${epBadge(result.status)}</span>
          <span class="ep-check-detail">${escapeHtml(result.detail)} · linked: ${escapeHtml(entry.externalTitle || "")}</span>
          ${relink}
        </div>`;
    })
    .join("")}</div>`;
}

async function handleEpCheckClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  const item = epCheckState[idx];
  if (!item) return;

  if (btn.dataset.action === "find") {
    item.candidates = null;
    item.loadingCandidates = true;
    renderEpCheckResults();
    try {
      item.candidates = await searchCandidates(item.entry);
    } catch (err) {
      item.candidates = [];
    }
    item.loadingCandidates = false;
    renderEpCheckResults();
    return;
  }

  if (btn.dataset.action === "cancel-find") {
    item.candidates = null;
    renderEpCheckResults();
    return;
  }

  if (btn.dataset.action === "link") {
    const cid = btn.dataset.cid;
    const source = btn.dataset.source;
    const candidate = item.candidates.find((c) => String(c.id) === cid && c.source === source);
    if (!candidate) return;
    btn.disabled = true;
    try {
      await apiUpdateEntry(
        item.entry.id,
        { externalSource: source, externalId: candidate.id, externalTitle: candidate.title },
        getAuthPassword(),
      );
      item.entry = { ...item.entry, externalSource: source, externalId: candidate.id, externalTitle: candidate.title };
      item.candidates = null;
      entriesCache = null; // sheet changed, refresh next full fetch
      renderEpCheckResults();
      item.result = await checkLinkedEntry(item.entry);
      await persistEpStatus(item.entry, item.result.status);
      renderEpCheckResults();
    } catch (err) {
      alert(`Could not link match: ${err.message}`);
    }
    return;
  }

  if (btn.dataset.action === "link-next") {
    const sequel = item.result?.sequel;
    if (!sequel) return;
    btn.disabled = true;
    const nextSeason = (Number(item.entry.season) || 0) + 1;
    try {
      await apiUpdateEntry(
        item.entry.id,
        {
          externalSource: "anilist",
          externalId: sequel.id,
          externalTitle: sequel.title,
          season: nextSeason,
          episode: 0,
        },
        getAuthPassword(),
      );
      item.entry = {
        ...item.entry,
        externalSource: "anilist",
        externalId: sequel.id,
        externalTitle: sequel.title,
        season: nextSeason,
        episode: 0,
      };
      entriesCache = null;
      renderEpCheckResults();
      item.result = await checkLinkedEntry(item.entry);
      await persistEpStatus(item.entry, item.result.status);
      renderEpCheckResults();
    } catch (err) {
      alert(`Could not link next season: ${err.message}`);
    }
  }
}

// Maps a live check result to the value cached on the entry (epStatus),
// which the card badge reads later without hitting any API. "error" is
// intentionally not cached — a transient network blip shouldn't wipe out a
// previously known "new episode" flag.
function cacheStatusFor(resultStatus) {
  if (resultStatus === "new") return "new";
  if (resultStatus === "sequelFound") return "seasonComplete";
  if (resultStatus === "upToDate") return "upToDate";
  return null;
}

async function persistEpStatus(entry, resultStatus) {
  if (!isAuthed()) return; // writing needs the owner password
  const cacheValue = cacheStatusFor(resultStatus);
  if (cacheValue === null) return;
  try {
    await apiUpdateEntry(entry.id, { epStatus: cacheValue }, getAuthPassword());
    entriesCache = null; // so the next full fetch picks up the fresh epStatus
  } catch (err) {
    console.error("Could not cache episode-check status:", err);
  }
}

async function runEpisodeCheck() {
  const btn = document.getElementById("episodeCheckBtn");
  const resultsEl = document.getElementById("episodeCheckResults");
  if (!btn || !resultsEl) return;

  let entries;
  try {
    entries = await getEntries();
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty error">${escapeHtml(err.message)}</div>`;
    return;
  }

  const targets = entries.filter(
    (e) => (e.category === "tvshows" || e.category === "anime") && (e.status === "Watching" || e.status === "On Hold"),
  );
  if (!targets.length) {
    resultsEl.innerHTML = `<div class="empty">No Watching or On Hold shows/anime to check.</div>`;
    return;
  }

  epCheckState = targets.map((entry) => ({ entry, result: null, candidates: null, loadingCandidates: false }));
  resultsEl.removeEventListener("click", handleEpCheckClick);
  resultsEl.addEventListener("click", handleEpCheckClick);
  renderEpCheckResults();

  btn.disabled = true;
  const originalText = btn.textContent;
  for (let i = 0; i < epCheckState.length; i++) {
    const item = epCheckState[i];
    if (isLinked(item.entry)) {
      btn.textContent = `Checking ${i + 1} of ${epCheckState.length}…`;
      item.result = await checkLinkedEntry(item.entry);
      await persistEpStatus(item.entry, item.result.status);
      renderEpCheckResults();
    }
  }
  btn.disabled = false;
  btn.textContent = originalText;
}

// ---------- Entry card ----------
function entryCardHtml(entry) {
  const progress = progressLabel(entry);
  const img = entry.imageUrl
    ? `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)}" loading="lazy" onerror="this.style.display='none'" />`
    : `<div class="no-image">No image</div>`;
  const epBadge =
    entry.epStatus === "new"
      ? `<span class="ep-card-badge ep-card-new" title="New episode available">●</span>`
      : entry.epStatus === "seasonComplete"
        ? `<span class="ep-card-badge ep-card-season" title="Next season available to link">●</span>`
        : "";
  return `
    <a href="#/e/${entry.id}">
      <div class="card-poster">
        ${img}
        ${epBadge}
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

function renderUpdates() {
  app.innerHTML = `
    ${headerHtml()}
    <section class="section">
      <div class="wrap">
        <div class="section-head">
          <h2 class="display">New episode check</h2>
        </div>
        <p class="ep-check-desc">Checks your Watching / On Hold TV shows and anime against AniList and TVmaze for episodes you haven't logged yet.</p>
        <button class="btn" id="episodeCheckBtn">Check for updates</button>
        <div id="episodeCheckResults"></div>
      </div>
    </section>
  `;
  wireHeader();
  document.getElementById("episodeCheckBtn").addEventListener("click", runEpisodeCheck);
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
        <a href="#/" class="logo display"><img src="favicon.png" alt="" class="logo-icon" />Venkey&rsquo;s Vault</a>
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
      // If progress actually moved forward, the cached "new episode"/"season
      // complete" badge is stale — clear it. Editing unrelated fields
      // (rating, review, etc.) leaves the cached status untouched.
      const progressChanged =
        String(payload.season) !== String(entry.season) || String(payload.episode) !== String(entry.episode);
      if (progressChanged) payload.epStatus = "";
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
