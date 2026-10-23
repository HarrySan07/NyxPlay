"use strict";

/* =========================================================
   NYXPLAY — Personal Media Library
   ========================================================= */

const STORAGE_KEY = "nyxplay_library_v1";
const CATEGORIES_KEY = "nyxplay_categories_v1";
const THEME_KEY = "nyxplay_theme_v1";
const BUILTIN_CATEGORIES = ["Movies", "Series", "Cartoons", "Anime", "Other"];
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_FOLDERS_TO_SCAN = 500;
const MAX_VIDEOS_TO_SCAN = 3000;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
  homeOverview: $("#homeOverview"),
  libraryWorkspace: $("#libraryWorkspace"),
  sidebarFolders: $("#sidebarFolders"),
  categoryFilters: $("#categoryFilters"),
  videoGrid: $("#videoGrid"),
  emptyState: $("#emptyState"),
  emptyTitle: $("#emptyTitle"),
  emptyMessage: $("#emptyMessage"),
  searchInput: $("#searchInput"),
  pageLabel: $("#pageLabel"),
  sectionTitle: $("#sectionTitle"),
  resultCount: $("#resultCount"),
  videoCount: $("#videoCount"),
  favoriteCount: $("#favoriteCount"),
  recentCount: $("#recentCount"),
  sortSelect: $("#sortSelect"),

  addVideoButton: $("#addVideoButton"),
  heroActionButton: $("#heroActionButton"),
  emptyAddButton: $("#emptyAddButton"),
  homeImportFolderButton: $("#homeImportFolderButton"),
  themeButton: $("#themeButton"),
  themeButtonLabel: $("#themeButtonLabel"),

  sourceDialog: $("#sourceDialog"),
  sourceForm: $("#sourceForm"),
  sourceUrl: $("#sourceUrl"),
  sourceStatus: $("#sourceStatus"),

  addDialog: $("#addDialog"),
  addForm: $("#addVideoForm"),
  videoTitle: $("#videoTitle"),
  driveUrl: $("#driveUrl"),
  videoCategory: $("#videoCategory"),
  formError: $("#formError"),

  editDialog: $("#editDialog"),
  editForm: $("#editVideoForm"),
  editVideoId: $("#editVideoId"),
  editVideoTitle: $("#editVideoTitle"),
  editDriveUrl: $("#editDriveUrl"),
  editVideoCategory: $("#editVideoCategory"),
  editFormError: $("#editFormError"),

  deleteDialog: $("#deleteDialog"),
  deleteMessage: $("#deleteMessage"),
  confirmDeleteButton: $("#confirmDeleteButton"),
  cancelDeleteButton: $("#cancelDeleteButton"),

  folderDialog: $("#folderDialog"),
  createFolderForm: $("#createFolderForm"),
  newFolderName: $("#newFolderName"),
  folderFormError: $("#folderFormError"),
  folderManagerList: $("#folderManagerList"),
  folderCountLabel: $("#folderCountLabel"),
  manageFoldersButton: $("#manageFoldersButton"),

  exportLibraryButton: $("#exportLibraryButton"),
  importLibraryButton: $("#importLibraryButton"),
  importFileInput: $("#importFileInput"),

  selectItemsButton: $("#selectItemsButton"),
  bulkSelectionToolbar: $("#bulkSelectionToolbar"),
  selectAllVisible: $("#selectAllVisible"),
  selectedCount: $("#selectedCount"),
  bulkMoveCategory: $("#bulkMoveCategory"),
  bulkMoveButton: $("#bulkMoveButton"),
  bulkDeleteButton: $("#bulkDeleteButton"),
  exitSelectionButton: $("#exitSelectionButton"),

  importDriveFolderButton: $("#importDriveFolderButton"),
  folderImportDialog: $("#folderImportDialog"),
  driveFolderUrl: $("#driveFolderUrl"),
  driveApiKey: $("#driveApiKey"),
  folderImportCategory: $("#folderImportCategory"),
  createMatchingFolder: $("#createMatchingFolder"),
  scanNestedFolders: $("#scanNestedFolders"),
  scanDriveFolderButton: $("#scanDriveFolderButton"),
  folderImportStatus: $("#folderImportStatus"),
  folderImportPreview: $("#folderImportPreview"),
  folderImportCount: $("#folderImportCount"),
  folderImportList: $("#folderImportList"),
  importScannedVideosButton: $("#importScannedVideosButton"),
  cancelFolderImportButton: $("#cancelFolderImportButton"),

  playerDialog: $("#playerDialog"),
  playerTitle: $("#playerTitle"),
  playerCategory: $("#playerCategory"),
  videoFrame: $("#videoFrame"),
  openDriveButton: $("#openDriveButton"),
  nextVideoButton: $("#nextVideoButton"),

  toast: $("#toast"),
};

let categories = loadCategories();
let videos = loadLibrary();
let currentView = "home";
let currentCategory = "All";
let currentQueue = [];
let currentVideoId = null;
let pendingDeleteIds = [];
let selectionMode = false;
let folderScanResults = null;
let folderScanBusy = false;
let toastTimer = null;

const selectedVideoIds = new Set();

/* =========================================================
   STORAGE
   ========================================================= */

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeFolderName(value) {
  if (typeof value !== "string") return null;

  const name = value.trim().replace(/\s+/g, " ");

  if (!name || name.length > 65) return null;
  if (/[<>\u0000-\u001f]/.test(name)) return null;

  return name;
}

function loadCategories() {
  const result = [...BUILTIN_CATEGORIES];

  function addUnique(value) {
    const name = normalizeFolderName(value);
    if (
      name &&
      !result.some((item) => item.toLowerCase() === name.toLowerCase())
    ) {
      result.push(name);
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || "[]");
    if (Array.isArray(saved)) saved.forEach(addUnique);
  } catch (error) {
    console.warn("Could not read saved folder names:", error);
  }

  // Preserve categories used by the existing library.
  try {
    const oldVideos = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(oldVideos)) {
      oldVideos.forEach((video) => addUnique(video?.category));
    }
  } catch {
    // Malformed library data will be ignored by loadLibrary().
  }

  return result;
}

function saveCategories() {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    return true;
  } catch (error) {
    console.error(error);
    showToast("Couldn't save folders. Check browser storage.");
    return false;
  }
}

function loadLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) return [];

    return saved
      .filter(
        (video) =>
          video &&
          typeof video.id === "string" &&
          typeof video.fileId === "string" &&
          /^[A-Za-z0-9_-]+$/.test(video.fileId) &&
          typeof video.title === "string" &&
          video.title.trim() &&
          typeof video.category === "string",
      )
      .map((video) => ({
        ...video,
        title: video.title.trim(),
        category: categories.includes(video.category)
          ? video.category
          : "Other",
        favorite: Boolean(video.favorite),
        addedAt: Number.isFinite(video.addedAt) ? video.addedAt : Date.now(),
        lastWatched: Number.isFinite(video.lastWatched)
          ? video.lastWatched
          : null,
        resourceKey:
          typeof video.resourceKey === "string" ? video.resourceKey : null,
      }));
  } catch (error) {
    console.error("Could not read library:", error);
    return [];
  }
}

function saveLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
    return true;
  } catch (error) {
    console.error(error);
    showToast("Couldn't save the library. Check browser storage.");
    return false;
  }
}

/* =========================================================
   THEME AND NOTIFICATIONS
   ========================================================= */

function showToast(message) {
  const toast = el.toast;
  toast.textContent = message;
  toast.classList.add("visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function applyTheme(theme, announce = false) {
  const selected = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = selected;

  const lightIsActive = selected === "light";
  const label = lightIsActive ? "Dark mode" : "Light mode";
  const icon = lightIsActive ? "☾" : "☀";

  const iconElement = el.themeButton.querySelector(".theme-icon");
  if (iconElement) iconElement.textContent = icon;
  el.themeButtonLabel.textContent = label;
  el.themeButton.setAttribute("aria-label", `Switch to ${label.toLowerCase()}`);

  const metaTheme = $('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = lightIsActive ? "#f5f6fb" : "#101116";

  try {
    localStorage.setItem(THEME_KEY, selected);
  } catch (error) {
    console.warn("Could not save theme preference:", error);
  }

  if (announce) showToast(`Switched to ${selected} mode.`);
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark", true);
}

/* =========================================================
   GOOGLE DRIVE URL DETECTION
   ========================================================= */

function extractDriveFileId(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());

    if (url.protocol !== "https:") return null;
    if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) {
      return null;
    }

    const fileMatch = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    const docMatch = url.pathname.match(/\/document\/d\/([A-Za-z0-9_-]+)/);

    const id = fileMatch?.[1] || docMatch?.[1] || url.searchParams.get("id");
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function extractDriveFolderId(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());

    if (url.protocol !== "https:" || url.hostname !== "drive.google.com") {
      return null;
    }

    return url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function getResourceKey(rawUrl) {
  try {
    return new URL(rawUrl).searchParams.get("resourcekey") || null;
  } catch {
    return null;
  }
}

function driveViewUrl(fileId, resourceKey = null) {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,
  );
  if (resourceKey) url.searchParams.set("resourcekey", resourceKey);
  return url.toString();
}

function drivePreviewUrl(fileId, resourceKey = null) {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`,
  );
  if (resourceKey) url.searchParams.set("resourcekey", resourceKey);
  return url.toString();
}

/* =========================================================
   SOURCE SELECTOR
   ========================================================= */

function openSourceDialog() {
  el.sourceStatus.textContent = "Paste a file or folder link to continue.";
  el.sourceStatus.dataset.state = "info";
  el.sourceUrl.value = "";

  if (!el.sourceDialog.open) el.sourceDialog.showModal();
  setTimeout(() => el.sourceUrl.focus(), 40);
}

function detectSource(event) {
  event.preventDefault();

  const rawUrl = el.sourceUrl.value.trim();

  if (extractDriveFolderId(rawUrl)) {
    el.driveFolderUrl.value = rawUrl;
    closeDialog(el.sourceDialog);
    openFolderImportDialog();
    return;
  }

  if (extractDriveFileId(rawUrl)) {
    el.driveUrl.value = rawUrl;
    el.videoTitle.value = "";
    renderCategoryOptions(el.videoCategory, "Other");

    closeDialog(el.sourceDialog);
    openAddDialog();
    showToast("Video link detected. Add a title and save it.");
    return;
  }

  el.sourceStatus.textContent =
    "This link isn't a supported Google Drive file or folder URL.";
  el.sourceStatus.dataset.state = "error";
}

/* =========================================================
   DIALOGS AND SELECT OPTIONS
   ========================================================= */

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function renderCategoryOptions(select, selected = "Other") {
  if (!select) return;

  select.replaceChildren();

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.append(option);
  });

  select.value = categories.includes(selected) ? selected : "Other";
}

function openAddDialog() {
  el.formError.hidden = true;
  el.formError.textContent = "";
  renderCategoryOptions(el.videoCategory, el.videoCategory.value || "Other");

  if (!el.addDialog.open) el.addDialog.showModal();
  setTimeout(() => el.videoTitle.focus(), 40);
}

/* =========================================================
   HOME, LIBRARY, SEARCH AND SORTING
   ========================================================= */

function getVisibleVideos() {
  if (currentView === "home") return [];

  let result = [...videos];
  const search = el.searchInput.value.trim().toLowerCase();

  if (currentView === "favorites") {
    result = result.filter((video) => video.favorite);
  } else if (currentView === "recent") {
    result = result.filter((video) => video.lastWatched);
  }

  if (currentCategory !== "All") {
    result = result.filter((video) => video.category === currentCategory);
  }

  if (search) {
    result = result.filter((video) =>
      `${video.title} ${video.category} ${video.sourceFolderPath || ""}`
        .toLowerCase()
        .includes(search),
    );
  }

  const mode = el.sortSelect.value || "smart";
  const titleCompare = (a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

  switch (mode) {
    case "title-asc":
      result.sort(titleCompare);
      break;
    case "title-desc":
      result.sort((a, b) => titleCompare(b, a));
      break;
    case "added-newest":
      result.sort((a, b) => b.addedAt - a.addedAt);
      break;
    case "added-oldest":
      result.sort((a, b) => a.addedAt - b.addedAt);
      break;
    case "watched-newest":
      result.sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0));
      break;
    default:
      if (currentView === "recent") {
        result.sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0));
      } else {
        result.sort((a, b) => b.addedAt - a.addedAt);
      }
  }

  return result;
}

function folderColor(index) {
  return ["#aaa4ff", "#ff9ccf", "#83c9e8", "#e9ba77", "#8ed9b9"][index % 5];
}

function renderSidebarFolders() {
  el.sidebarFolders.replaceChildren();

  categories.forEach((category, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `folder-item${currentView === "library" && currentCategory === category ? " active" : ""}`;
    button.dataset.category = category;

    const dot = document.createElement("span");
    dot.className = "folder-dot";
    dot.style.background = folderColor(index);

    const name = document.createElement("span");
    name.textContent = category;

    const count = document.createElement("span");
    count.className = "folder-item-count";
    count.textContent = String(
      videos.filter((video) => video.category === category).length,
    );

    button.append(dot, name, count);
    el.sidebarFolders.append(button);
  });
}

function renderCategoryFilters() {
  el.categoryFilters.replaceChildren();

  ["All", ...categories].forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-button${currentCategory === category ? " active" : ""}`;
    button.dataset.category = category;
    button.textContent = category;
    el.categoryFilters.append(button);
  });
}

/* =========================================================
   MULTI-SELECTION AND BULK ACTIONS
   ========================================================= */

function enterSelectionMode() {
  selectionMode = true;
  selectedVideoIds.clear();
  render();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedVideoIds.clear();
  render();
}

function toggleSelection(id) {
  if (selectedVideoIds.has(id)) selectedVideoIds.delete(id);
  else selectedVideoIds.add(id);
  render();
}

function selectAllVisible() {
  const visible = getVisibleVideos();
  const allSelected =
    visible.length > 0 &&
    visible.every((video) => selectedVideoIds.has(video.id));

  if (allSelected) {
    visible.forEach((video) => selectedVideoIds.delete(video.id));
  } else {
    visible.forEach((video) => selectedVideoIds.add(video.id));
  }

  render();
}

function updateSelectionToolbar(visible) {
  el.bulkSelectionToolbar.hidden = !selectionMode;
  el.selectItemsButton.textContent = selectionMode
    ? "✕ Cancel selection"
    : "☑ Select items";

  el.selectedCount.textContent = `${selectedVideoIds.size} selected`;

  renderCategoryOptions(
    el.bulkMoveCategory,
    el.bulkMoveCategory.value || "Other",
  );

  const selectedVisible = visible.filter((video) =>
    selectedVideoIds.has(video.id),
  ).length;

  el.selectAllVisible.checked =
    visible.length > 0 && selectedVisible === visible.length;

  el.selectAllVisible.indeterminate =
    selectedVisible > 0 && selectedVisible < visible.length;

  el.bulkMoveButton.disabled = selectedVideoIds.size === 0;
  el.bulkDeleteButton.disabled = selectedVideoIds.size === 0;
}

function moveSelectedVideos() {
  const ids = [...selectedVideoIds];
  const destination = el.bulkMoveCategory.value;

  if (!ids.length || !categories.includes(destination)) {
    showToast("Select videos and choose a destination folder.");
    return;
  }

  const previous = videos.map((video) => ({ ...video }));

  videos.forEach((video) => {
    if (selectedVideoIds.has(video.id)) {
      video.category = destination;
    }
  });

  if (!saveLibrary()) {
    videos = previous;
    return;
  }

  selectionMode = false;
  selectedVideoIds.clear();
  currentView = "library";
  currentCategory = destination;
  render();
  showToast(`Moved ${ids.length} video(s) to “${destination}”.`);
}

function requestBulkDelete() {
  pendingDeleteIds = [...selectedVideoIds];

  if (!pendingDeleteIds.length) return;

  el.deleteMessage.textContent =
    `Remove ${pendingDeleteIds.length} selected video(s) from NYXPLAY? ` +
    "The original files in Google Drive will not be deleted.";

  if (!el.deleteDialog.open) el.deleteDialog.showModal();
}

function confirmDelete() {
  const ids = new Set(pendingDeleteIds);

  if (!ids.size) {
    closeDialog(el.deleteDialog);
    return;
  }

  const previous = videos;
  videos = videos.filter((video) => !ids.has(video.id));

  if (!saveLibrary()) {
    videos = previous;
    return;
  }

  if (currentVideoId && ids.has(currentVideoId)) closePlayer();

  currentQueue = currentQueue.filter((id) => !ids.has(id));
  ids.forEach((id) => selectedVideoIds.delete(id));

  const count = ids.size;
  pendingDeleteIds = [];
  selectionMode = false;

  closeDialog(el.deleteDialog);
  render();

  showToast(
    count === 1
      ? "Video removed from NYXPLAY. The Drive file is unchanged."
      : `Removed ${count} videos from NYXPLAY. Drive files are unchanged.`,
  );
}

/* =========================================================
   VIDEO CARDS
   ========================================================= */

function actionButton(label, symbol, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

function createVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  const posterWrap = document.createElement("div");
  posterWrap.className = `poster-wrap${selectedVideoIds.has(video.id) ? " is-selected" : ""}`;

  const poster = document.createElement("button");
  poster.type = "button";
  poster.className = "poster";
  poster.setAttribute(
    "aria-label",
    selectionMode ? `Select ${video.title}` : `Play ${video.title}`,
  );

  poster.addEventListener("click", () => {
    if (selectionMode) toggleSelection(video.id);
    else openPlayer(video.id);
  });

  const category = document.createElement("span");
  category.className = "poster-category";
  category.textContent = video.category.toUpperCase();

  const play = document.createElement("span");
  play.className = "poster-icon";
  play.textContent = selectionMode
    ? selectedVideoIds.has(video.id)
      ? "✓"
      : "＋"
    : "▶";

  const label = document.createElement("span");
  label.className = "poster-label";
  label.textContent = video.sourceFolderPath || "GOOGLE DRIVE";

  const playHover = document.createElement("span");
  playHover.className = "poster-play";
  playHover.textContent = selectionMode
    ? selectedVideoIds.has(video.id)
      ? "✓"
      : "＋"
    : "▶";

  poster.append(category, play, label, playHover);
  posterWrap.append(poster);

  if (selectionMode) {
    const labelWrap = document.createElement("label");
    labelWrap.className = "select-card-control";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = selectedVideoIds.has(video.id);
    check.setAttribute("aria-label", `Select ${video.title}`);

    check.addEventListener("click", (event) => event.stopPropagation());
    check.addEventListener("change", () => toggleSelection(video.id));

    const labelText = document.createElement("span");
    labelText.textContent = "Select";

    labelWrap.append(check, labelText);
    posterWrap.append(labelWrap);
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";

  const text = document.createElement("div");
  text.className = "card-text";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = video.title;

  const subtitle = document.createElement("p");
  subtitle.className = "card-subtitle";
  subtitle.textContent = video.lastWatched
    ? `Watched ${new Date(video.lastWatched).toLocaleDateString()}`
    : `Added ${new Date(video.addedAt).toLocaleDateString()}`;

  text.append(title, subtitle);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const favorite = actionButton(
    video.favorite ? "Remove from favorites" : "Add to favorites",
    video.favorite ? "♥" : "♡",
    `favorite-button${video.favorite ? " is-favorite" : ""}`,
    () => toggleFavorite(video.id),
  );
  favorite.setAttribute("aria-pressed", String(Boolean(video.favorite)));

  const edit = actionButton(
    "Edit video details",
    "✎",
    "small-action-button",
    () => openEditDialog(video.id),
  );

  const remove = actionButton(
    "Delete video from library",
    "×",
    "small-action-button delete-action",
    () => requestDeleteOne(video.id),
  );

  actions.append(favorite, edit, remove);
  meta.append(text, actions);
  card.append(posterWrap, meta);

  return card;
}

/* =========================================================
   MAIN RENDER
   ========================================================= */

function render() {
  const isHome = currentView === "home";
  const visible = getVisibleVideos();

  el.homeOverview.hidden = !isHome;
  el.libraryWorkspace.hidden = isHome;

  el.videoGrid.replaceChildren();
  visible.forEach((video) => el.videoGrid.append(createVideoCard(video)));

  el.videoCount.textContent = videos.length;
  el.favoriteCount.textContent = videos.filter(
    (video) => video.favorite,
  ).length;
  el.recentCount.textContent = videos.filter(
    (video) => video.lastWatched,
  ).length;
  el.resultCount.textContent = `${visible.length} ${visible.length === 1 ? "ITEM" : "ITEMS"}`;

  el.emptyState.hidden = visible.length > 0;
  el.videoGrid.hidden = visible.length === 0;

  if (!videos.length) {
    el.emptyTitle.textContent = "Your library starts here.";
    el.emptyMessage.textContent =
      "Add a Google Drive video or import a shared Drive folder.";
  } else if (!visible.length) {
    el.emptyTitle.textContent = "Nothing to show here.";
    el.emptyMessage.textContent =
      "Try another folder, clear the search, or add a video.";
  }

  const labels = {
    home: ["Home", "Explore NYXPLAY"],
    library: ["Library", "Explore your library"],
    recent: ["Recently watched", "Continue watching"],
    favorites: ["Favorites", "Your favorites"],
  };

  const [pageLabel, sectionTitle] = labels[currentView] || labels.home;
  el.pageLabel.textContent =
    currentCategory === "All" ? pageLabel : currentCategory;

  if (el.sectionTitle) {
    el.sectionTitle.textContent =
      currentCategory !== "All" ? currentCategory : sectionTitle;
  }

  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });

  renderSidebarFolders();
  renderCategoryFilters();

  renderCategoryOptions(el.videoCategory, el.videoCategory.value || "Other");
  renderCategoryOptions(
    el.editVideoCategory,
    el.editVideoCategory.value || "Other",
  );
  renderCategoryOptions(
    el.folderImportCategory,
    el.folderImportCategory.value || "Other",
  );
  renderCategoryOptions(
    el.bulkMoveCategory,
    el.bulkMoveCategory.value || "Other",
  );

  updateFolderImportDestinationControl();
  updateSelectionToolbar(visible);
}

function goToView(view) {
  if (!["home", "library", "recent", "favorites"].includes(view)) return;

  currentView = view;
  currentCategory = "All";
  render();
  document.body.classList.remove("sidebar-open");
}

function setCategory(category) {
  if (category !== "All" && !categories.includes(category)) return;

  currentView = "library";
  currentCategory = category;
  render();
}

/* =========================================================
   FAVORITES
   ========================================================= */

function toggleFavorite(id) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  video.favorite = !video.favorite;
  saveLibrary();
  render();

  showToast(video.favorite ? "Added to favorites ♥" : "Removed from favorites");
}

/* =========================================================
   SINGLE VIDEO ADD / EDIT / DELETE
   ========================================================= */

function handleAddVideo(event) {
  event.preventDefault();

  const title = el.videoTitle.value.trim();
  const url = el.driveUrl.value.trim();
  const fileId = extractDriveFileId(url);
  const category = el.videoCategory.value;

  el.formError.hidden = true;
  el.formError.textContent = "";

  if (!title) {
    el.formError.textContent = "Enter a video title.";
    el.formError.hidden = false;
    return;
  }

  if (!fileId) {
    el.formError.textContent =
      "Paste a valid Google Drive file link, not a folder link.";
    el.formError.hidden = false;
    return;
  }

  if (!categories.includes(category)) {
    el.formError.textContent = "Choose a valid folder.";
    el.formError.hidden = false;
    return;
  }

  if (videos.some((video) => video.fileId === fileId)) {
    el.formError.textContent = "That video is already in the library.";
    el.formError.hidden = false;
    return;
  }

  videos.unshift({
    id: makeId(),
    fileId,
    resourceKey: getResourceKey(url),
    title,
    category,
    favorite: false,
    addedAt: Date.now(),
    lastWatched: null,
    sourceFolderId: null,
    sourceFolderName: null,
    sourceFolderPath: null,
  });

  if (!saveLibrary()) {
    videos.shift();
    return;
  }

  el.addForm.reset();
  closeDialog(el.addDialog);

  currentView = "library";
  currentCategory = "All";
  selectionMode = false;
  selectedVideoIds.clear();

  render();
  showToast("Video added to your library.");
}

function openEditDialog(id) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  el.editFormError.hidden = true;
  el.editFormError.textContent = "";

  el.editVideoId.value = video.id;
  el.editVideoTitle.value = video.title;
  el.editDriveUrl.value = driveViewUrl(video.fileId, video.resourceKey);

  renderCategoryOptions(el.editVideoCategory, video.category);

  if (!el.editDialog.open) el.editDialog.showModal();
  setTimeout(() => el.editVideoTitle.focus(), 40);
}

function handleEditVideo(event) {
  event.preventDefault();

  const id = el.editVideoId.value;
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  const title = el.editVideoTitle.value.trim();
  const url = el.editDriveUrl.value.trim();
  const fileId = extractDriveFileId(url);
  const category = el.editVideoCategory.value;

  el.editFormError.hidden = true;
  el.editFormError.textContent = "";

  if (!title || title.length > 120) {
    el.editFormError.textContent = "Enter a title up to 120 characters.";
    el.editFormError.hidden = false;
    return;
  }

  if (!fileId) {
    el.editFormError.textContent = "Enter a valid Google Drive file link.";
    el.editFormError.hidden = false;
    return;
  }

  if (!categories.includes(category)) {
    el.editFormError.textContent = "Choose a valid folder.";
    el.editFormError.hidden = false;
    return;
  }

  if (videos.some((item) => item.id !== id && item.fileId === fileId)) {
    el.editFormError.textContent = "That video is already in your library.";
    el.editFormError.hidden = false;
    return;
  }

  const old = { ...video };

  video.title = title;
  video.fileId = fileId;
  video.resourceKey = getResourceKey(url);
  video.category = category;

  if (!saveLibrary()) {
    Object.assign(video, old);
    return;
  }

  closeDialog(el.editDialog);
  render();

  if (currentVideoId === id && el.playerDialog.open) {
    el.playerTitle.textContent = video.title;
    el.playerCategory.textContent = `Folder: ${video.category} · Google Drive`;
    el.videoFrame.src = drivePreviewUrl(video.fileId, video.resourceKey);
  }

  showToast("Video details updated.");
}

function requestDeleteOne(id) {
  if (!videos.some((video) => video.id === id)) return;

  pendingDeleteIds = [id];
  el.deleteMessage.textContent =
    "Remove this video from NYXPLAY? The original Google Drive file will not be deleted.";

  if (!el.deleteDialog.open) el.deleteDialog.showModal();
}

/* =========================================================
   FOLDER MANAGEMENT
   ========================================================= */

function openFolderDialog() {
  el.folderFormError.hidden = true;
  el.folderFormError.textContent = "";

  renderFolderManager();

  if (!el.folderDialog.open) el.folderDialog.showModal();
}

function renderFolderManager() {
  el.folderManagerList.replaceChildren();
  el.folderCountLabel.textContent = `${categories.length} FOLDERS`;

  categories.forEach((category, index) => {
    const row = document.createElement("div");
    row.className = "folder-manager-row";

    const info = document.createElement("div");
    info.className = "folder-manager-name";

    const dot = document.createElement("span");
    dot.className = "folder-dot";
    dot.style.background = folderColor(index);

    const name = document.createElement("span");
    name.className = "folder-manager-title";
    name.textContent = category;

    const count = document.createElement("span");
    count.className = "folder-manager-count";
    count.textContent = String(
      videos.filter((video) => video.category === category).length,
    );

    info.append(dot, name, count);
    row.append(info);

    if (BUILTIN_CATEGORIES.includes(category)) {
      const badge = document.createElement("span");
      badge.className = "built-in-badge";
      badge.textContent = "Built-in";
      row.append(badge);
    } else {
      const actions = document.createElement("div");
      actions.className = "folder-manager-actions";

      const rename = actionButton(
        "Rename folder",
        "Rename",
        "secondary-button folder-action-button",
        () => renameFolder(category),
      );

      const remove = actionButton(
        "Delete folder",
        "Delete",
        "secondary-button folder-action-button delete-action",
        () => deleteFolder(category),
      );

      actions.append(rename, remove);
      row.append(actions);
    }

    el.folderManagerList.append(row);
  });
}

function createFolder(event) {
  event.preventDefault();

  const name = normalizeFolderName(el.newFolderName.value);

  el.folderFormError.hidden = true;
  el.folderFormError.textContent = "";

  if (!name) {
    el.folderFormError.textContent = "Enter a folder name up to 65 characters.";
    el.folderFormError.hidden = false;
    return;
  }

  if (categories.some((item) => item.toLowerCase() === name.toLowerCase())) {
    el.folderFormError.textContent = "That folder already exists.";
    el.folderFormError.hidden = false;
    return;
  }

  categories.push(name);

  if (!saveCategories()) {
    categories.pop();
    return;
  }

  el.newFolderName.value = "";
  currentView = "library";
  currentCategory = name;
  render();
  renderFolderManager();

  showToast(`Folder “${name}” created.`);
}

function renameFolder(oldName) {
  if (BUILTIN_CATEGORIES.includes(oldName)) return;

  const answer = prompt(`Rename “${oldName}” to:`, oldName);
  if (answer === null) return;

  const newName = normalizeFolderName(answer);
  if (!newName) {
    showToast("That folder name is invalid.");
    return;
  }

  if (
    categories.some(
      (item) =>
        item !== oldName && item.toLowerCase() === newName.toLowerCase(),
    )
  ) {
    showToast("A folder with that name already exists.");
    return;
  }

  const oldCategories = [...categories];
  const oldVideos = videos.map((video) => ({ ...video }));

  categories = categories.map((item) => (item === oldName ? newName : item));
  videos.forEach((video) => {
    if (video.category === oldName) video.category = newName;
  });

  if (!saveCategories() || !saveLibrary()) {
    categories = oldCategories;
    videos = oldVideos;
    saveCategories();
    saveLibrary();
    render();
    return;
  }

  if (currentCategory === oldName) currentCategory = newName;

  render();
  renderFolderManager();
  showToast("Folder renamed.");
}

function deleteFolder(category) {
  if (BUILTIN_CATEGORIES.includes(category)) return;

  const count = videos.filter((video) => video.category === category).length;
  const message = count
    ? `Delete “${category}”? ${count} video(s) will move to Other. Drive files are unchanged.`
    : `Delete empty folder “${category}”?`;

  if (!confirm(message)) return;

  const oldCategories = [...categories];
  const oldVideos = videos.map((video) => ({ ...video }));

  categories = categories.filter((item) => item !== category);
  videos.forEach((video) => {
    if (video.category === category) video.category = "Other";
  });

  if (!saveCategories() || !saveLibrary()) {
    categories = oldCategories;
    videos = oldVideos;
    saveCategories();
    saveLibrary();
    render();
    return;
  }

  if (currentCategory === category) currentCategory = "All";
  render();
  renderFolderManager();
  showToast("Folder deleted. Drive files are unchanged.");
}

/* =========================================================
   BACKUP AND RESTORE
   ========================================================= */

function exportLibrary() {
  const data = {
    app: "NYXPLAY",
    version: 2,
    exportedAt: new Date().toISOString(),
    categories,
    videos,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `nyxplay-library-${new Date().toISOString().slice(0, 10)}.json`;

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Library backup exported.");
}

async function importLibraryBackup(file) {
  if (!file) return;

  if (file.size > MAX_BACKUP_BYTES) {
    showToast("Backup is larger than 5 MB.");
    el.importFileInput.value = "";
    return;
  }

  try {
    const data = JSON.parse(await file.text());

    if (!data || !Array.isArray(data.videos)) {
      throw new Error("This is not a valid NYXPLAY library backup.");
    }

    const mergedCategories = [...categories];

    (Array.isArray(data.categories) ? data.categories : []).forEach((value) => {
      const name = normalizeFolderName(value);
      if (
        name &&
        !mergedCategories.some(
          (item) => item.toLowerCase() === name.toLowerCase(),
        )
      ) {
        mergedCategories.push(name);
      }
    });

    if (!mergedCategories.includes("Other")) mergedCategories.push("Other");

    const oldCategories = categories;
    const oldVideos = videos;
    const oldFileIds = new Set(videos.map((video) => video.fileId));

    categories = mergedCategories;

    const added = [];

    data.videos.forEach((item) => {
      if (
        !item ||
        typeof item.title !== "string" ||
        typeof item.fileId !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(item.fileId) ||
        oldFileIds.has(item.fileId)
      ) {
        return;
      }

      oldFileIds.add(item.fileId);

      const category = categories.includes(item.category)
        ? item.category
        : "Other";

      added.push({
        id: typeof item.id === "string" ? item.id : makeId(),
        fileId: item.fileId,
        resourceKey:
          typeof item.resourceKey === "string" ? item.resourceKey : null,
        title: item.title.trim().slice(0, 120) || "Untitled video",
        category,
        favorite: Boolean(item.favorite),
        addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
        lastWatched: Number.isFinite(item.lastWatched)
          ? item.lastWatched
          : null,
        sourceFolderId: item.sourceFolderId || null,
        sourceFolderName: item.sourceFolderName || null,
        sourceFolderPath: item.sourceFolderPath || null,
      });
    });

    videos = [...added, ...videos];

    if (!saveCategories() || !saveLibrary()) {
      categories = oldCategories;
      videos = oldVideos;
      saveCategories();
      saveLibrary();
      return;
    }

    currentView = "library";
    currentCategory = "All";
    render();

    showToast(`Backup imported: ${added.length} new video(s).`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not import this backup.");
  } finally {
    el.importFileInput.value = "";
  }
}

/* =========================================================
   GOOGLE DRIVE FOLDER IMPORTER
   ========================================================= */

function openFolderImportDialog() {
  resetFolderScan();

  renderCategoryOptions(
    el.folderImportCategory,
    el.folderImportCategory.value || "Other",
  );

  updateFolderImportDestinationControl();

  setFolderStatus("Paste the folder link and API key, then scan.", "info");

  if (!el.folderImportDialog.open) {
    el.folderImportDialog.showModal();
  }
}

function resetFolderScan() {
  folderScanResults = null;
  el.folderImportPreview.hidden = true;
  el.folderImportList.replaceChildren();
  el.folderImportCount.textContent = "";
  el.importScannedVideosButton.disabled = true;
  el.importScannedVideosButton.textContent = "Import videos";
}

function setFolderStatus(message, state = "info") {
  el.folderImportStatus.textContent = message;
  el.folderImportStatus.dataset.state = state;
}

function updateFolderImportDestinationControl() {
  el.folderImportCategory.disabled = el.createMatchingFolder.checked;
}

function isVideoFile(file) {
  const mime = String(file.mimeType || "").toLowerCase();
  if (mime.startsWith("video/")) return true;

  return /\.(mp4|m4v|mkv|webm|mov|avi|mpeg|mpg|3gp|ogv|wmv|flv|ts|mts|m2ts)$/i.test(
    file.name || "",
  );
}

function cleanImportedTitle(filename) {
  return (
    String(filename || "Untitled video")
      .replace(/\.[^.]+$/, "")
      .trim()
      .slice(0, 120) || "Untitled video"
  );
}

function sanitizeImportedFolderName(value) {
  let name = String(value || "Imported Drive Folder")
    .replace(/[<>/\\\u0000-\u001f]/g, " › ")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) name = "Imported Drive Folder";
  return name.slice(0, 65).trim() || "Imported Drive Folder";
}

async function driveApiRequest(url) {
  const response = await fetch(url);
  let data = null;

  try {
    data = await response.json();
  } catch {
    // Non-JSON error handled below.
  }

  if (!response.ok || data?.error) {
    const message = data?.error?.message || response.statusText;
    const lower = String(message).toLowerCase();

    if (response.status === 404) {
      throw new Error(
        "Folder not found. Check its URL and sharing permissions.",
      );
    }

    if (response.status === 401 || lower.includes("api key not valid")) {
      throw new Error(
        "Google rejected the API key. Check the key and API restrictions.",
      );
    }

    if (
      response.status === 403 &&
      (lower.includes("referrer") || lower.includes("referer"))
    ) {
      throw new Error(
        "The API key's website restriction rejected this origin.",
      );
    }

    if (
      response.status === 403 &&
      (lower.includes("quota") || lower.includes("rate limit"))
    ) {
      throw new Error("The Google Drive API quota or rate limit was reached.");
    }

    throw new Error(`Google Drive API error (${response.status}): ${message}`);
  }

  return data;
}

async function getFolderInfo(folderId, apiKey) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`,
  );

  url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", "id,name,mimeType,resourceKey");
  url.searchParams.set("supportsAllDrives", "true");

  return driveApiRequest(url);
}

async function listFolderChildren(folderId, apiKey) {
  const all = [];
  let pageToken = null;

  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");

    url.searchParams.set("key", apiKey);
    url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "name_natural");
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,resourceKey,shortcutDetails(targetId,targetMimeType))",
    );
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await driveApiRequest(url);
    if (Array.isArray(data.files)) all.push(...data.files);

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return all;
}

async function scanDriveFolder(rootId, apiKey, includeNested) {
  const root = await getFolderInfo(rootId, apiKey);

  if (root.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The supplied link does not point to a Drive folder.");
  }

  const queue = [{ id: rootId, path: root.name || "Drive Folder" }];
  const visited = new Set();
  const found = [];
  let truncated = false;
  let skippedShortcuts = 0;

  while (queue.length) {
    if (
      visited.size >= MAX_FOLDERS_TO_SCAN ||
      found.length >= MAX_VIDEOS_TO_SCAN
    ) {
      truncated = true;
      break;
    }

    const current = queue.shift();
    if (visited.has(current.id)) continue;

    visited.add(current.id);

    setFolderStatus(
      `Scanning ${current.path} — ${found.length} video(s) found.`,
      "working",
    );

    const children = await listFolderChildren(current.id, apiKey);

    for (const item of children) {
      if (!item?.id || !item?.name) continue;

      if (item.mimeType === "application/vnd.google-apps.folder") {
        if (includeNested) {
          queue.push({
            id: item.id,
            path: `${current.path} / ${item.name}`,
          });
        }
        continue;
      }

      // Shortcuts may point outside the chosen folder; skip them for now.
      if (item.mimeType === "application/vnd.google-apps.shortcut") {
        skippedShortcuts++;
        continue;
      }

      if (isVideoFile(item)) {
        found.push({
          fileId: item.id,
          resourceKey: item.resourceKey || null,
          name: item.name,
          mimeType: item.mimeType || "",
          folderPath: current.path,
        });

        if (found.length >= MAX_VIDEOS_TO_SCAN) {
          truncated = true;
          break;
        }
      }
    }
  }

  return {
    rootFolderId: rootId,
    rootFolderName: root.name || "Drive Folder",
    videos: found,
    scannedFolders: visited.size,
    truncated,
    skippedShortcuts,
    includeNested,
  };
}

async function handleScanDriveFolder() {
  if (folderScanBusy) return;

  resetFolderScan();

  const folderUrl = el.driveFolderUrl.value.trim();
  const folderId = extractDriveFolderId(folderUrl);
  const apiKey = el.driveApiKey.value.trim();

  if (!folderId) {
    setFolderStatus("Paste a valid Google Drive folder link.", "error");
    return;
  }

  if (!apiKey) {
    setFolderStatus("Paste your restricted API key for this scan.", "error");
    return;
  }

  folderScanBusy = true;
  el.scanDriveFolderButton.disabled = true;
  el.scanDriveFolderButton.textContent = "Scanning…";
  setFolderStatus("Connecting to Google Drive…", "working");

  try {
    folderScanResults = await scanDriveFolder(
      folderId,
      apiKey,
      el.scanNestedFolders.checked,
    );

    showFolderScanPreview(folderScanResults);
  } catch (error) {
    console.error(error);
    folderScanResults = null;
    resetFolderScan();
    setFolderStatus(error.message || "Could not scan this folder.", "error");
  } finally {
    folderScanBusy = false;
    el.scanDriveFolderButton.disabled = false;
    el.scanDriveFolderButton.textContent = "Scan folder";
  }
}

function showFolderScanPreview(result) {
  el.folderImportList.replaceChildren();

  const known = new Set(videos.map((video) => video.fileId));
  const newCount = result.videos.filter(
    (file) => !known.has(file.fileId),
  ).length;
  const duplicates = result.videos.length - newCount;

  el.folderImportCount.textContent = `${result.videos.length} VIDEOS`;

  result.videos.slice(0, 120).forEach((file) => {
    const li = document.createElement("li");
    li.textContent = `${file.folderPath} › ${file.name}`;
    li.title = `${file.folderPath} / ${file.name}`;
    el.folderImportList.append(li);
  });

  if (result.videos.length > 120) {
    const li = document.createElement("li");
    li.textContent = `…and ${result.videos.length - 120} more videos`;
    el.folderImportList.append(li);
  }

  el.folderImportPreview.hidden = false;
  el.importScannedVideosButton.disabled = newCount === 0;
  el.importScannedVideosButton.textContent = newCount
    ? `Import ${newCount} video(s)`
    : "Nothing new to import";

  let message =
    `${result.videos.length} video(s) found · ${newCount} new · ` +
    `${duplicates} duplicate(s) · ${result.scannedFolders} folder(s) scanned.`;

  if (result.skippedShortcuts) {
    message += ` ${result.skippedShortcuts} shortcut(s) were skipped.`;
  }
  if (result.truncated) {
    message += " Scan safety limit reached; some files may remain unscanned.";
  }
  if (!result.includeNested) {
    message += " Subfolders were not scanned.";
  }

  setFolderStatus(
    result.videos.length ? message : "No recognizable video files were listed.",
    result.videos.length ? "success" : "info",
  );
}

function importScannedDriveVideos() {
  if (!folderScanResults) {
    showToast("Scan a folder first.");
    return;
  }

  const oldCategories = [...categories];
  const oldVideos = videos;

  const preserveGroups = el.createMatchingFolder.checked;
  const selectedDestination = el.folderImportCategory.value || "Other";
  const rootName = folderScanResults.rootFolderName || "Drive Folder";

  const existingIds = new Set(videos.map((video) => video.fileId));
  const uniqueFiles = folderScanResults.videos.filter((file) => {
    if (existingIds.has(file.fileId)) return false;
    existingIds.add(file.fileId);
    return true;
  });

  if (!uniqueFiles.length) {
    showToast("All scanned videos are already in your library.");
    return;
  }

  function categoryForPath(file) {
    let path = String(file.folderPath || rootName).trim();

    if (path === rootName) {
      path = rootName;
    } else if (path.startsWith(`${rootName} / `)) {
      path = path.slice(rootName.length + 3);
    }

    const desired = sanitizeImportedFolderName(
      path
        .split(" / ")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" › "),
    );

    const existing = categories.find(
      (category) => category.toLowerCase() === desired.toLowerCase(),
    );

    if (existing) return existing;

    let name = desired;
    let suffix = 2;

    while (
      categories.some(
        (category) => category.toLowerCase() === name.toLowerCase(),
      )
    ) {
      const ending = ` (${suffix++})`;
      name = desired.slice(0, 65 - ending.length) + ending;
    }

    categories.push(name);
    return name;
  }

  if (!preserveGroups && !categories.includes(selectedDestination)) {
    showToast("Choose a valid destination folder.");
    return;
  }

  const now = Date.now();

  const imported = uniqueFiles.map((file, index) => ({
    id: makeId(),
    fileId: file.fileId,
    resourceKey: file.resourceKey || null,
    title: cleanImportedTitle(file.name),
    category: preserveGroups ? categoryForPath(file) : selectedDestination,
    favorite: false,
    addedAt: now + index,
    lastWatched: null,
    sourceFolderId: folderScanResults.rootFolderId,
    sourceFolderName: rootName,
    sourceFolderPath: file.folderPath || rootName,
  }));

  videos = [...imported, ...videos];

  if (!saveCategories() || !saveLibrary()) {
    categories = oldCategories;
    videos = oldVideos;
    saveCategories();
    saveLibrary();
    return;
  }

  currentView = "library";
  currentCategory = preserveGroups ? imported[0].category : selectedDestination;
  selectionMode = false;
  selectedVideoIds.clear();
  el.searchInput.value = "";

  render();
  closeDialog(el.folderImportDialog);
  el.driveApiKey.value = "";

  const groupCount = new Set(imported.map((video) => video.category)).size;
  showToast(
    `Imported ${imported.length} video(s) across ${groupCount} folder group(s).`,
  );
}

/* =========================================================
   PLAYER
   ========================================================= */

function openPlayer(id, keepQueue = false) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  if (!keepQueue) {
    currentQueue = getVisibleVideos().map((item) => item.id);
    if (!currentQueue.includes(id)) currentQueue.unshift(id);
  }

  currentVideoId = id;
  video.lastWatched = Date.now();
  saveLibrary();

  el.playerTitle.textContent = video.title;
  el.playerCategory.textContent = `Folder: ${video.category} · Google Drive`;
  el.videoFrame.src = drivePreviewUrl(video.fileId, video.resourceKey);

  el.openDriveButton.onclick = () => {
    window.open(
      driveViewUrl(video.fileId, video.resourceKey),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const index = currentQueue.indexOf(id);
  const hasNext = index >= 0 && index < currentQueue.length - 1;

  el.nextVideoButton.disabled = !hasNext;
  el.nextVideoButton.textContent = hasNext ? "Next video →" : "End of list";

  if (!el.playerDialog.open) el.playerDialog.showModal();
  render();
}

function playNext() {
  const index = currentQueue.indexOf(currentVideoId);
  if (index < 0 || index >= currentQueue.length - 1) {
    showToast("You've reached the end of this list.");
    return;
  }
  openPlayer(currentQueue[index + 1], true);
}

function closePlayer() {
  el.videoFrame.src = "about:blank";
  closeDialog(el.playerDialog);
  currentVideoId = null;
}

/* =========================================================
   GENERIC EVENT HELPERS
   ========================================================= */

function closeDialogFromButton(button) {
  const dialog = document.getElementById(button.dataset.closeDialog);
  if (dialog) {
    if (dialog === el.deleteDialog) pendingDeleteIds = [];
    closeDialog(dialog);
  }
}

function wireEvents() {
  el.themeButton.addEventListener("click", toggleTheme);

  el.addVideoButton.addEventListener("click", openSourceDialog);
  el.heroActionButton.addEventListener("click", openSourceDialog);
  el.emptyAddButton.addEventListener("click", openSourceDialog);
  el.sourceForm.addEventListener("submit", detectSource);

  el.homeImportFolderButton.addEventListener("click", openFolderImportDialog);
  el.importDriveFolderButton.addEventListener("click", openFolderImportDialog);

  el.addForm.addEventListener("submit", handleAddVideo);
  el.editForm.addEventListener("submit", handleEditVideo);

  el.manageFoldersButton.addEventListener("click", openFolderDialog);
  el.createFolderForm.addEventListener("submit", createFolder);

  el.exportLibraryButton.addEventListener("click", exportLibrary);
  el.importLibraryButton.addEventListener("click", () =>
    el.importFileInput.click(),
  );
  el.importFileInput.addEventListener("change", (event) => {
    if (event.target.files?.[0]) importLibraryBackup(event.target.files[0]);
  });

  el.selectItemsButton.addEventListener("click", () => {
    selectionMode ? exitSelectionMode() : enterSelectionMode();
  });
  el.selectAllVisible.addEventListener("change", selectAllVisible);
  el.bulkMoveButton.addEventListener("click", moveSelectedVideos);
  el.bulkDeleteButton.addEventListener("click", requestBulkDelete);
  el.exitSelectionButton.addEventListener("click", exitSelectionMode);

  el.scanDriveFolderButton.addEventListener("click", handleScanDriveFolder);
  el.importScannedVideosButton.addEventListener(
    "click",
    importScannedDriveVideos,
  );
  el.cancelFolderImportButton.addEventListener("click", () =>
    closeDialog(el.folderImportDialog),
  );
  el.createMatchingFolder.addEventListener("change", () => {
    updateFolderImportDestinationControl();
  });

  el.sortSelect.addEventListener("change", render);
  el.searchInput.addEventListener("input", () => {
    if (el.searchInput.value.trim() && currentView === "home") {
      currentView = "library";
      currentCategory = "All";
    }
    render();
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => goToView(button.dataset.view));
  });

  $$("[data-go-view]").forEach((button) => {
    button.addEventListener("click", () => goToView(button.dataset.goView));
  });

  $("#brandHome").addEventListener("click", (event) => {
    event.preventDefault();
    goToView("home");
  });

  el.sidebarFolders.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (button) setCategory(button.dataset.category);
  });

  el.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (button) setCategory(button.dataset.category);
  });

  el.confirmDeleteButton.addEventListener("click", confirmDelete);
  el.cancelDeleteButton.addEventListener("click", () => {
    pendingDeleteIds = [];
    closeDialog(el.deleteDialog);
  });

  $("#closePlayerButton").addEventListener("click", closePlayer);
  el.nextVideoButton.addEventListener("click", playNext);

  $("#mobileMenu").addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => closeDialogFromButton(button));
  });

  [
    el.sourceDialog,
    el.addDialog,
    el.editDialog,
    el.deleteDialog,
    el.folderDialog,
    el.folderImportDialog,
    el.playerDialog,
  ].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (dialog === el.playerDialog) closePlayer();
      else {
        if (dialog === el.deleteDialog) pendingDeleteIds = [];
        closeDialog(dialog);
      }
    });
  });

  el.folderImportDialog.addEventListener("close", () => {
    // Do not retain the key in the page after the dialog closes.
    el.driveApiKey.value = "";
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);

    const modalOpen = [
      el.sourceDialog,
      el.addDialog,
      el.editDialog,
      el.deleteDialog,
      el.folderDialog,
      el.folderImportDialog,
      el.playerDialog,
    ].some((dialog) => dialog.open);

    if (event.key === "/" && !typing && !modalOpen) {
      event.preventDefault();
      el.searchInput.focus();
    }

    if (event.key === "Escape") {
      document.body.classList.remove("sidebar-open");
    }
  });
}

/* =========================================================
   START
   ========================================================= */

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

wireEvents();
applyTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
render();
