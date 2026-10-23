"use strict";

const STORAGE_KEY = "nyxplay_library_v1";
const THEME_KEY = "nyxplay_theme_v1";
const CATEGORIES_KEY = "nyxplay_categories_v1";
const THEMES = ["dark", "light"];
const BUILTIN_CATEGORIES = ["Movies", "Series", "Cartoons", "Anime", "Other"];
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_DRIVE_SCAN_FOLDERS = 500;
const MAX_DRIVE_SCAN_VIDEOS = 3000;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
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
  themeButton: $("#themeButton"),
  themeButtonLabel: $("#themeButtonLabel"),
};

let categories = loadCategories();
let videos = loadLibrary();
let currentView = "library";
let currentCategory = "All";
let currentQueue = [];
let currentVideoId = null;
let pendingDeleteId = null;
let toastTimeout = null;
let folderScanResults = null;
let folderScanBusy = false;

/* =========================================================
   STORAGE AND DATA VALIDATION
   ========================================================= */

function normalizeFolderName(value) {
  if (typeof value !== "string") return null;

  const name = value.trim().replace(/\s+/g, " ");

  if (!name || name.length > 30) return null;
  if (/[<>/\\\u0000-\u001f]/.test(name)) return null;

  return name;
}

function loadCategories() {
  const result = [...BUILTIN_CATEGORIES];

  const addUnique = (value) => {
    const name = normalizeFolderName(value);

    if (
      name &&
      !result.some((item) => item.toLowerCase() === name.toLowerCase())
    ) {
      result.push(name);
    }
  };

  try {
    const stored = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || "[]");

    if (Array.isArray(stored)) stored.forEach(addUnique);
  } catch (error) {
    console.warn("Could not read custom folders:", error);
  }

  // Preserve custom categories already present in the existing library.
  try {
    const oldVideos = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (Array.isArray(oldVideos)) {
      oldVideos.forEach((video) => addUnique(video?.category));
    }
  } catch {
    // Corrupt library data is handled separately.
  }

  return result;
}

function saveCategories() {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));

    return true;
  } catch (error) {
    console.error("Could not save folders:", error);
    showToast("Could not save folders. Check browser storage.");
    return false;
  }
}

function loadLibrary() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (!Array.isArray(stored)) return [];

    return stored
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.fileId === "string" &&
          /^[a-zA-Z0-9_-]+$/.test(item.fileId) &&
          typeof item.title === "string" &&
          item.title.trim().length > 0 &&
          categories.includes(item.category),
      )
      .map((item) => ({
        id: item.id,
        fileId: item.fileId,
        resourceKey:
          typeof item.resourceKey === "string" ? item.resourceKey : null,
        title: item.title.trim(),
        category: item.category,
        favorite: Boolean(item.favorite),
        addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
        lastWatched: Number.isFinite(item.lastWatched)
          ? item.lastWatched
          : null,
      }));
  } catch (error) {
    console.error("Could not read the NYXPLAY library:", error);
    return [];
  }
}

function saveLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
    return true;
  } catch (error) {
    console.error("Could not save the NYXPLAY library:", error);
    showToast("Could not save the library. Check browser storage.");
    return false;
  }
}

function makeId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/* =========================================================
   GOOGLE DRIVE LINKS
   ========================================================= */

function extractDriveFileId(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());

    if (url.protocol !== "https:") return null;

    if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) {
      return null;
    }

    const filePath = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);

    const documentPath = url.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);

    const id = filePath?.[1] || documentPath?.[1] || url.searchParams.get("id");

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;

    return id;
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

    const match = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);

    return match?.[1] || null;
  } catch {
    return null;
  }
}

function driveViewUrl(fileId, resourceKey = null) {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,
  );

  if (resourceKey) {
    url.searchParams.set("resourcekey", resourceKey);
  }

  return url.toString();
}

function drivePreviewUrl(fileId, resourceKey = null) {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`,
  );

  if (resourceKey) {
    url.searchParams.set("resourcekey", resourceKey);
  }

  return url.toString();
}

function driveResourceKey(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());

    return (
      url.searchParams.get("resourcekey") ||
      url.searchParams.get("resourceKey") ||
      null
    );
  } catch {
    return null;
  }
}

/* =========================================================
   NOTIFICATIONS AND THEMES
   ========================================================= */

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2700);
}

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme, announce = false) {
  if (!THEMES.includes(theme)) theme = "dark";

  document.body.dataset.theme = theme;

  const isDark = theme === "dark";
  const nextModeLabel = isDark ? "Light mode" : "Dark mode";
  const icon = isDark ? "☀" : "☾";
  const iconElement = elements.themeButton?.querySelector(".theme-icon");

  if (elements.themeButtonLabel) {
    elements.themeButtonLabel.textContent = nextModeLabel;
  }

  if (iconElement) iconElement.textContent = icon;

  if (elements.themeButton) {
    elements.themeButton.title = `Switch to ${nextModeLabel.toLowerCase()}`;

    elements.themeButton.setAttribute(
      "aria-label",
      `Switch to ${nextModeLabel.toLowerCase()}`,
    );
  }

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  if (themeColorMeta) {
    themeColorMeta.content = isDark ? "#101116" : "#f5f6fb";
  }

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn("Theme preference could not be saved:", error);
  }

  if (announce) {
    showToast(`Switched to ${isDark ? "dark" : "light"} mode.`);
  }
}

function cycleTheme() {
  const current = document.body.dataset.theme || "dark";

  applyTheme(current === "dark" ? "light" : "dark", true);
}

/* =========================================================
   DIALOG HELPERS
   ========================================================= */

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function renderCategoryOptions(selectElement, selectedValue = "Other") {
  if (!selectElement) return;

  selectElement.replaceChildren();

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    selectElement.append(option);
  });

  selectElement.value = categories.includes(selectedValue)
    ? selectedValue
    : "Other";
}

function openAddDialog() {
  elements.formError.hidden = true;
  elements.formError.textContent = "";

  renderCategoryOptions(
    elements.videoCategory,
    elements.videoCategory.value || "Other",
  );

  if (!elements.addDialog.open) {
    elements.addDialog.showModal();
  }

  setTimeout(() => elements.videoTitle.focus(), 50);
}

/* =========================================================
   LIBRARY FILTERING AND SORTING
   ========================================================= */

function getVisibleVideos() {
  const query = elements.searchInput.value.trim().toLowerCase();

  let result = [...videos];

  if (currentView === "favorites") {
    result = result.filter((video) => video.favorite);
  } else if (currentView === "recent") {
    result = result.filter((video) => video.lastWatched);
  }

  if (currentCategory !== "All") {
    result = result.filter((video) => video.category === currentCategory);
  }

  if (query) {
    result = result.filter((video) =>
      `${video.title} ${video.category} Google Drive`
        .toLowerCase()
        .includes(query),
    );
  }

  const sortMode = elements.sortSelect?.value || "smart";

  const byAddedDesc = (a, b) => (b.addedAt || 0) - (a.addedAt || 0);

  const byWatchedDesc = (a, b) => (b.lastWatched || 0) - (a.lastWatched || 0);

  const byTitleAsc = (a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

  switch (sortMode) {
    case "title-asc":
      result.sort(byTitleAsc);
      break;

    case "title-desc":
      result.sort((a, b) => byTitleAsc(b, a));
      break;

    case "added-newest":
      result.sort(byAddedDesc);
      break;

    case "added-oldest":
      result.sort((a, b) => byAddedDesc(b, a));
      break;

    case "watched-newest":
      result.sort(byWatchedDesc);
      break;

    default:
      if (currentView === "recent") {
        result.sort(byWatchedDesc);
      } else {
        result.sort(byAddedDesc);
      }
  }

  return result;
}

/* =========================================================
   SIDEBAR AND CATEGORY FILTERS
   ========================================================= */

function folderColor(index) {
  const colors = [
    "#aaa4ff",
    "#ff9ccf",
    "#83c9e8",
    "#e9ba77",
    "#8ed9b9",
    "#b7a2ff",
    "#f3a080",
    "#83d4c0",
  ];

  return colors[index % colors.length];
}

function renderSidebarFolders() {
  elements.sidebarFolders.replaceChildren();

  categories.forEach((category, index) => {
    const button = document.createElement("button");
    button.type = "button";

    button.className = `folder-item${
      currentCategory === category ? " active" : ""
    }`;

    button.dataset.category = category;

    const dot = document.createElement("span");
    dot.className = "folder-dot";
    dot.style.background = folderColor(index);

    const label = document.createElement("span");
    label.textContent = category;

    const count = document.createElement("span");
    count.className = "folder-item-count";

    count.textContent = videos.filter(
      (video) => video.category === category,
    ).length;

    button.append(dot, label, count);
    elements.sidebarFolders.append(button);
  });
}

function renderCategoryFilters() {
  elements.categoryFilters.replaceChildren();

  ["All", ...categories].forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";

    button.className = `filter-button${
      currentCategory === category ? " active" : ""
    }`;

    button.dataset.category = category;
    button.textContent = category;

    elements.categoryFilters.append(button);
  });
}

/* =========================================================
   VIDEO CARDS
   ========================================================= */

function makeCardAction(label, text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);

  return button;
}

function createVideoCard(video) {
  const article = document.createElement("article");
  article.className = "video-card";

  const poster = document.createElement("button");
  poster.type = "button";
  poster.className = "poster";
  poster.setAttribute("aria-label", `Play ${video.title}`);

  poster.addEventListener("click", () => openPlayer(video.id));

  const posterCategory = document.createElement("span");
  posterCategory.className = "poster-category";
  posterCategory.textContent = video.category.toUpperCase();

  const posterIcon = document.createElement("span");
  posterIcon.className = "poster-icon";
  posterIcon.textContent = "▶";
  posterIcon.setAttribute("aria-hidden", "true");

  const posterLabel = document.createElement("span");
  posterLabel.className = "poster-label";
  posterLabel.textContent = "GOOGLE DRIVE";

  const play = document.createElement("span");
  play.className = "poster-play";
  play.textContent = "▶";
  play.setAttribute("aria-hidden", "true");

  poster.append(posterCategory, posterIcon, posterLabel, play);

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

  const favorite = makeCardAction(
    video.favorite ? "Remove from favorites" : "Add to favorites",
    video.favorite ? "♥" : "♡",
    `favorite-button${video.favorite ? " is-favorite" : ""}`,
    () => toggleFavorite(video.id),
  );

  favorite.setAttribute("aria-pressed", String(Boolean(video.favorite)));

  const edit = makeCardAction(
    "Edit video details",
    "✎",
    "small-action-button",
    () => openEditDialog(video.id),
  );

  const remove = makeCardAction(
    "Delete video from library",
    "×",
    "small-action-button delete-action",
    () => requestDeleteVideo(video.id),
  );

  actions.append(favorite, edit, remove);
  meta.append(text, actions);
  article.append(poster, meta);

  return article;
}

/* =========================================================
   MAIN RENDER
   ========================================================= */

function render() {
  const visibleVideos = getVisibleVideos();

  elements.videoGrid.replaceChildren();

  visibleVideos.forEach((video) => {
    elements.videoGrid.append(createVideoCard(video));
  });

  elements.videoCount.textContent = videos.length;

  elements.favoriteCount.textContent = videos.filter(
    (video) => video.favorite,
  ).length;

  elements.recentCount.textContent = videos.filter(
    (video) => video.lastWatched,
  ).length;

  elements.resultCount.textContent = `${visibleVideos.length} ${
    visibleVideos.length === 1 ? "ITEM" : "ITEMS"
  }`;

  elements.emptyState.hidden = visibleVideos.length > 0;
  elements.videoGrid.hidden = visibleVideos.length === 0;

  if (videos.length === 0) {
    elements.emptyTitle.textContent = "Your library starts here.";

    elements.emptyMessage.textContent =
      "Add a Google Drive video to create your personal collection.";
  } else if (visibleVideos.length === 0) {
    elements.emptyTitle.textContent = "Nothing to show here.";

    elements.emptyMessage.textContent =
      "Try another folder, clear your search, or add a video.";
  }

  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });

  const labels = {
    library: ["All videos", "Explore your library"],
    recent: ["Recently watched", "Pick up where you left off"],
    favorites: ["Favorites", "Your favorites"],
  };

  const [pageLabel, sectionTitle] = labels[currentView];

  elements.pageLabel.textContent =
    currentCategory === "All" ? pageLabel : currentCategory;

  elements.sectionTitle.textContent =
    currentCategory !== "All"
      ? currentCategory
      : currentView === "library"
        ? sectionTitle
        : currentView === "recent"
          ? "Continue watching"
          : "Your favorites";

  renderSidebarFolders();
  renderCategoryFilters();

  renderCategoryOptions(
    elements.videoCategory,
    elements.videoCategory.value || "Other",
  );

  renderCategoryOptions(
    elements.editVideoCategory,
    elements.editVideoCategory.value || "Other",
  );

  renderCategoryOptions(
    elements.folderImportCategory,
    elements.folderImportCategory.value || "Other",
  );

  updateFolderImportDestinationControl();
}

function setCategory(category) {
  if (category !== "All" && !categories.includes(category)) {
    return;
  }

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
   VIDEO PLAYER
   ========================================================= */

function openPlayer(id, keepQueue = false) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  if (!keepQueue) {
    currentQueue = getVisibleVideos().map((item) => item.id);

    if (!currentQueue.includes(id)) {
      currentQueue.unshift(id);
    }
  }

  currentVideoId = id;
  video.lastWatched = Date.now();
  saveLibrary();

  elements.playerTitle.textContent = video.title;

  elements.playerCategory.textContent = `Folder: ${video.category} · Google Drive`;

  elements.videoFrame.src = drivePreviewUrl(video.fileId, video.resourceKey);

  elements.openDriveButton.onclick = () => {
    window.open(
      driveViewUrl(video.fileId, video.resourceKey),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const currentIndex = currentQueue.indexOf(id);
  const hasNext = currentIndex >= 0 && currentIndex < currentQueue.length - 1;

  elements.nextVideoButton.disabled = !hasNext;

  elements.nextVideoButton.textContent = hasNext
    ? "Next video →"
    : "End of list";

  if (!elements.playerDialog.open) {
    elements.playerDialog.showModal();
  }

  render();
}

function playNext() {
  const currentIndex = currentQueue.indexOf(currentVideoId);

  if (currentIndex < 0 || currentIndex >= currentQueue.length - 1) {
    showToast("You've reached the end of this list.");
    return;
  }

  const nextId = currentQueue[currentIndex + 1];

  if (!videos.some((video) => video.id === nextId)) {
    showToast("The next video is no longer in your library.");
    return;
  }

  openPlayer(nextId, true);
}

function closePlayer() {
  elements.videoFrame.src = "about:blank";
  closeDialog(elements.playerDialog);
  currentVideoId = null;
}

/* =========================================================
   EDIT VIDEO
   ========================================================= */

function openEditDialog(id) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  elements.editFormError.hidden = true;
  elements.editFormError.textContent = "";

  elements.editVideoId.value = video.id;
  elements.editVideoTitle.value = video.title;
  elements.editDriveUrl.value = driveViewUrl(video.fileId, video.resourceKey);

  renderCategoryOptions(elements.editVideoCategory, video.category);

  if (!elements.editDialog.open) {
    elements.editDialog.showModal();
  }

  setTimeout(() => elements.editVideoTitle.focus(), 50);
}

function handleEditVideo(event) {
  event.preventDefault();

  const id = elements.editVideoId.value;
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  const title = elements.editVideoTitle.value.trim();
  const fileId = extractDriveFileId(elements.editDriveUrl.value);
  const category = elements.editVideoCategory.value;

  elements.editFormError.hidden = true;
  elements.editFormError.textContent = "";

  if (!title) {
    elements.editFormError.textContent = "Please enter a video title.";

    elements.editFormError.hidden = false;
    return;
  }

  if (!fileId) {
    elements.editFormError.textContent =
      "Enter a valid HTTPS Google Drive file link.";

    elements.editFormError.hidden = false;
    return;
  }

  if (!categories.includes(category)) {
    elements.editFormError.textContent = "Choose a valid folder.";

    elements.editFormError.hidden = false;
    return;
  }

  if (videos.some((item) => item.id !== id && item.fileId === fileId)) {
    elements.editFormError.textContent =
      "That Google Drive video is already in your library.";

    elements.editFormError.hidden = false;
    return;
  }

  const previous = { ...video };

  video.title = title;
  video.fileId = fileId;
  video.resourceKey = driveResourceKey(elements.editDriveUrl.value);
  video.category = category;

  if (!saveLibrary()) {
    Object.assign(video, previous);
    return;
  }

  closeDialog(elements.editDialog);
  render();

  if (currentVideoId === id && elements.playerDialog.open) {
    elements.playerTitle.textContent = video.title;

    elements.playerCategory.textContent = `Folder: ${video.category} · Google Drive`;

    elements.videoFrame.src = drivePreviewUrl(video.fileId, video.resourceKey);
  }

  showToast("Video details updated.");
}

/* =========================================================
   DELETE VIDEO
   ========================================================= */

function requestDeleteVideo(id) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  pendingDeleteId = id;

  elements.deleteMessage.textContent =
    `Remove “${video.title}” from your NYXPLAY library? ` +
    "The original file in Google Drive will not be deleted.";

  if (!elements.deleteDialog.open) {
    elements.deleteDialog.showModal();
  }
}

function confirmDeleteVideo() {
  const video = videos.find((item) => item.id === pendingDeleteId);

  if (!video) {
    closeDialog(elements.deleteDialog);
    return;
  }

  const oldVideos = videos;

  videos = videos.filter((item) => item.id !== pendingDeleteId);

  if (!saveLibrary()) {
    videos = oldVideos;
    return;
  }

  if (currentVideoId === pendingDeleteId) {
    closePlayer();
  }

  currentQueue = currentQueue.filter((id) => id !== pendingDeleteId);

  pendingDeleteId = null;

  closeDialog(elements.deleteDialog);
  render();

  showToast("Video removed from your library. Drive file unchanged.");
}

/* =========================================================
   CUSTOM FOLDER MANAGEMENT
   ========================================================= */

function openFolderDialog() {
  elements.folderFormError.hidden = true;
  elements.folderFormError.textContent = "";

  renderFolderManager();

  if (!elements.folderDialog.open) {
    elements.folderDialog.showModal();
  }

  setTimeout(() => elements.newFolderName.focus(), 50);
}

function renderFolderManager() {
  elements.folderManagerList.replaceChildren();

  elements.folderCountLabel.textContent = `${categories.length} FOLDERS`;

  categories.forEach((category, index) => {
    const row = document.createElement("div");
    row.className = "folder-manager-row";

    const nameWrap = document.createElement("div");
    nameWrap.className = "folder-manager-name";

    const dot = document.createElement("span");
    dot.className = "folder-dot";
    dot.style.background = folderColor(index);

    const name = document.createElement("span");
    name.className = "folder-manager-title";
    name.textContent = category;

    const count = document.createElement("span");
    count.className = "folder-manager-count";

    count.textContent = videos.filter(
      (video) => video.category === category,
    ).length;

    nameWrap.append(dot, name, count);
    row.append(nameWrap);

    if (BUILTIN_CATEGORIES.includes(category)) {
      const badge = document.createElement("span");
      badge.className = "built-in-badge";
      badge.textContent = "Built-in";
      row.append(badge);
    } else {
      const actions = document.createElement("div");
      actions.className = "folder-manager-actions";

      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.className = "secondary-button folder-action-button";
      renameButton.textContent = "Rename";
      renameButton.addEventListener("click", () => renameFolder(category));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className =
        "secondary-button folder-action-button delete-action";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => deleteFolder(category));

      actions.append(renameButton, deleteButton);
      row.append(actions);
    }

    elements.folderManagerList.append(row);
  });
}

function handleCreateFolder(event) {
  event.preventDefault();

  const name = normalizeFolderName(elements.newFolderName.value);

  elements.folderFormError.hidden = true;
  elements.folderFormError.textContent = "";

  if (!name) {
    elements.folderFormError.textContent =
      "Enter a name up to 30 characters. Avoid slash and angle-bracket characters.";

    elements.folderFormError.hidden = false;
    return;
  }

  if (categories.some((item) => item.toLowerCase() === name.toLowerCase())) {
    elements.folderFormError.textContent =
      "A folder with that name already exists.";

    elements.folderFormError.hidden = false;
    return;
  }

  categories.push(name);

  if (!saveCategories()) {
    categories = categories.filter((item) => item !== name);
    return;
  }

  elements.newFolderName.value = "";

  currentView = "library";
  currentCategory = name;

  render();
  renderFolderManager();

  showToast(`Folder “${name}” created.`);
}

function renameFolder(oldName) {
  if (BUILTIN_CATEGORIES.includes(oldName)) return;

  const raw = window.prompt(`Rename folder “${oldName}” to:`, oldName);

  if (raw === null) return;

  const newName = normalizeFolderName(raw);

  if (!newName) {
    showToast("Folder name is invalid. Use up to 30 characters.");
    return;
  }

  if (
    categories.some(
      (item) =>
        item.toLowerCase() === newName.toLowerCase() && item !== oldName,
    )
  ) {
    showToast("A folder with that name already exists.");
    return;
  }

  if (newName === oldName) return;

  const previousCategories = [...categories];
  const previousVideos = videos.map((video) => ({ ...video }));

  categories = categories.map((item) => (item === oldName ? newName : item));

  videos.forEach((video) => {
    if (video.category === oldName) {
      video.category = newName;
    }
  });

  if (!saveCategories() || !saveLibrary()) {
    categories = previousCategories;
    videos = previousVideos;

    saveCategories();
    saveLibrary();
    render();
    renderFolderManager();
    return;
  }

  if (currentCategory === oldName) {
    currentCategory = newName;
  }

  if (currentVideoId) {
    const current = videos.find((video) => video.id === currentVideoId);

    if (current) {
      elements.playerCategory.textContent = `Folder: ${current.category} · Google Drive`;
    }
  }

  render();
  renderFolderManager();

  showToast(`Folder renamed to “${newName}”.`);
}

function deleteFolder(category) {
  if (BUILTIN_CATEGORIES.includes(category)) return;

  const inFolder = videos.filter((video) => video.category === category).length;

  const message = inFolder
    ? `Delete folder “${category}”? ${inFolder} video(s) will move to Other. The Drive files will not be deleted.`
    : `Delete empty folder “${category}”?`;

  if (!window.confirm(message)) return;

  const oldCategories = [...categories];
  const oldVideos = videos.map((video) => ({ ...video }));

  categories = categories.filter((item) => item !== category);

  videos.forEach((video) => {
    if (video.category === category) {
      video.category = "Other";
    }
  });

  if (!saveCategories() || !saveLibrary()) {
    categories = oldCategories;
    videos = oldVideos;

    saveCategories();
    saveLibrary();
    render();
    renderFolderManager();
    return;
  }

  if (currentCategory === category) {
    currentCategory = "All";
  }

  if (currentVideoId) {
    const current = videos.find((video) => video.id === currentVideoId);

    if (current) {
      elements.playerCategory.textContent = `Folder: ${current.category} · Google Drive`;
    }
  }

  render();
  renderFolderManager();

  showToast(`Folder “${category}” deleted.`);
}

/* =========================================================
   JSON BACKUP AND RESTORE
   ========================================================= */

function exportLibrary() {
  const backup = {
    app: "NYXPLAY",
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
    videos,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `nyxplay-library-${date}.json`;

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast("Library backup exported.");
}

function validateImportedVideo(item, availableCategories) {
  if (!item || typeof item !== "object") return null;

  const title = typeof item.title === "string" ? item.title.trim() : "";

  const fileId = typeof item.fileId === "string" ? item.fileId.trim() : "";

  if (!title || title.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return null;
  }

  const category = availableCategories.includes(item.category)
    ? item.category
    : "Other";

  return {
    id: typeof item.id === "string" && item.id ? item.id : makeId(),
    fileId,
    resourceKey: typeof item.resourceKey === "string" ? item.resourceKey : null,
    title,
    category,
    favorite: Boolean(item.favorite),
    addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
    lastWatched: Number.isFinite(item.lastWatched) ? item.lastWatched : null,
  };
}

async function importLibraryFile(file) {
  if (!file) return;

  if (file.size > MAX_BACKUP_BYTES) {
    showToast("Backup is larger than 5 MB; choose a smaller JSON file.");
    return;
  }

  try {
    const data = JSON.parse(await file.text());

    if (!data || typeof data !== "object" || !Array.isArray(data.videos)) {
      throw new Error("The JSON file does not look like a NYXPLAY backup.");
    }

    const nextCategories = [...categories];

    const backupCategories = Array.isArray(data.categories)
      ? data.categories
      : [];

    for (const value of backupCategories) {
      const name = normalizeFolderName(value);

      if (
        name &&
        !nextCategories.some(
          (item) => item.toLowerCase() === name.toLowerCase(),
        )
      ) {
        nextCategories.push(name);
      }
    }

    const candidateVideos = data.videos
      .map((item) => validateImportedVideo(item, nextCategories))
      .filter(Boolean);

    const existingFileIds = new Set(videos.map((video) => video.fileId));

    const newVideos = candidateVideos.filter((video) => {
      if (existingFileIds.has(video.fileId)) return false;
      existingFileIds.add(video.fileId);
      return true;
    });

    const previousCategories = [...categories];
    const previousVideos = [...videos];

    categories = nextCategories;
    videos = [...newVideos, ...videos];

    if (!saveCategories() || !saveLibrary()) {
      categories = previousCategories;
      videos = previousVideos;

      saveCategories();
      saveLibrary();
      return;
    }

    currentView = "library";
    currentCategory = "All";
    elements.searchInput.value = "";

    render();

    showToast(`Backup imported: ${newVideos.length} new video(s) added.`);
  } catch (error) {
    console.error("Import failed:", error);

    showToast(error.message || "Could not import this backup file.");
  } finally {
    elements.importFileInput.value = "";
  }
}

/* =========================================================
   GOOGLE DRIVE FOLDER IMPORT
   ========================================================= */

function setFolderImportStatus(message, state = "info") {
  elements.folderImportStatus.textContent = message;
  elements.folderImportStatus.dataset.state = state;
}

function resetFolderImportScan() {
  folderScanResults = null;
  elements.folderImportPreview.hidden = true;
  elements.folderImportList.replaceChildren();
  elements.folderImportCount.textContent = "";
  elements.importScannedVideosButton.disabled = true;
  elements.importScannedVideosButton.textContent = "Import videos";
}

function updateFolderImportDestinationControl() {
  if (!elements.createMatchingFolder || !elements.folderImportCategory) {
    return;
  }

  elements.folderImportCategory.disabled =
    elements.createMatchingFolder.checked;
}

function openFolderImportDialog() {
  resetFolderImportScan();

  renderCategoryOptions(
    elements.folderImportCategory,
    elements.folderImportCategory.value || "Other",
  );

  updateFolderImportDestinationControl();

  setFolderImportStatus(
    "Paste the public folder link and your restricted API key, then scan.",
    "info",
  );

  if (!elements.folderImportDialog.open) {
    elements.folderImportDialog.showModal();
  }
}

function isLikelyVideoFile(file) {
  const mimeType = String(file.mimeType || "").toLowerCase();

  if (mimeType.startsWith("video/")) return true;

  return /\.(mp4|m4v|mkv|webm|mov|avi|mpeg|mpg|3gp|ogv|wmv|flv|ts|mts|m2ts)$/i.test(
    file.name || "",
  );
}

function cleanImportedTitle(fileName) {
  return (
    String(fileName || "Untitled video")
      .replace(/\.[^.]+$/, "")
      .trim() || "Untitled video"
  );
}

function sanitizeImportedFolderName(value) {
  let name = String(value || "Imported Drive Folder")
    .replace(/[<>/\\\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) name = "Imported Drive Folder";
  if (name.length > 30) name = name.slice(0, 30).trim();

  return name || "Imported Drive Folder";
}

async function driveApiRequest(url) {
  const response = await fetch(url, { method: "GET" });

  let payload;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    const apiMessage =
      payload?.error?.message || response.statusText || "Unknown API error";

    const lower = apiMessage.toLowerCase();

    if (
      response.status === 403 &&
      (lower.includes("referer") || lower.includes("referrer"))
    ) {
      throw new Error(
        "Google rejected the key's website restriction. Allow https://harrysan07.github.io/* in the key settings and retry on the live website.",
      );
    }

    if (
      response.status === 403 &&
      (lower.includes("api has not been used") ||
        lower.includes("disabled") ||
        lower.includes("service_disabled"))
    ) {
      throw new Error(
        "Google Drive API is not enabled for this Cloud project yet. Enable it under APIs & Services → Library, then retry.",
      );
    }

    if (
      response.status === 403 &&
      (lower.includes("quota") || lower.includes("rate limit"))
    ) {
      throw new Error(
        "Google Drive API quota or rate limit reached. Wait a little and try again.",
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Google could not find that folder. Check the URL and ensure the target folder itself is shared as Anyone with the link — Viewer.",
      );
    }

    if (response.status === 401 || lower.includes("api key not valid")) {
      throw new Error(
        "The API key was rejected. Check it, confirm Google Drive API is enabled, and verify the allowed website matches this GitHub Pages site.",
      );
    }

    if (response.status === 403) {
      throw new Error(
        `Google denied access to this folder. Confirm the target parent folder is shared as Anyone with the link — Viewer. Details: ${apiMessage}`,
      );
    }

    throw new Error(
      `Google Drive API error (${response.status}): ${apiMessage}`,
    );
  }

  return payload;
}

async function getPublicFolderInfo(folderId, apiKey) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`,
  );

  url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", "id,name,mimeType,resourceKey");
  url.searchParams.set("supportsAllDrives", "true");

  return driveApiRequest(url.toString());
}

async function listPublicFolderChildren(folderId, apiKey) {
  const allFiles = [];
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

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await driveApiRequest(url.toString());

    if (Array.isArray(data.files)) {
      allFiles.push(...data.files);
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allFiles;
}

async function scanPublicDriveFolder(rootFolderId, apiKey, includeSubfolders) {
  const rootInfo = await getPublicFolderInfo(rootFolderId, apiKey);

  if (rootInfo.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error(
      "This link does not point to a Google Drive folder. Use a link containing /folders/ and the folder ID.",
    );
  }

  const queue = [
    {
      id: rootFolderId,
      path: rootInfo.name || "",
    },
  ];

  const visited = new Set();
  const videosFound = [];

  let childFolderCount = 0;
  let skippedShortcuts = 0;
  let truncated = false;

  while (queue.length) {
    if (visited.size >= MAX_DRIVE_SCAN_FOLDERS) {
      truncated = true;
      break;
    }

    const current = queue.shift();

    if (visited.has(current.id)) continue;
    visited.add(current.id);

    setFolderImportStatus(
      `Scanning “${current.path || rootInfo.name}”… ${videosFound.length} video(s) found in ${visited.size} folder(s).`,
      "working",
    );

    const children = await listPublicFolderChildren(current.id, apiKey);

    for (const item of children) {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.name !== "string"
      ) {
        continue;
      }

      if (item.mimeType === "application/vnd.google-apps.folder") {
        childFolderCount += 1;

        if (includeSubfolders) {
          queue.push({
            id: item.id,
            path: current.path ? `${current.path} / ${item.name}` : item.name,
          });
        }

        continue;
      }

      // Shortcuts can point outside the selected folder.
      if (item.mimeType === "application/vnd.google-apps.shortcut") {
        skippedShortcuts += 1;
        continue;
      }

      if (isLikelyVideoFile(item)) {
        videosFound.push({
          fileId: item.id,
          resourceKey: item.resourceKey || null,
          name: item.name,
          mimeType: item.mimeType || "",
          folderPath: current.path || rootInfo.name || "",
        });

        if (videosFound.length >= MAX_DRIVE_SCAN_VIDEOS) {
          truncated = true;
          break;
        }
      }
    }

    if (truncated) break;
  }

  return {
    rootFolderId,
    rootFolderName: rootInfo.name || "Imported Drive Folder",
    rootResourceKey: rootInfo.resourceKey || null,
    videos: videosFound,
    scannedFolders: visited.size,
    childFolderCount,
    skippedShortcuts,
    truncated,
    includeSubfolders,
  };
}

function showFolderScanPreview(result) {
  elements.folderImportList.replaceChildren();

  const candidates = result.videos;

  const existingIds = new Set(videos.map((video) => video.fileId));

  const newCount = candidates.filter(
    (file) => !existingIds.has(file.fileId),
  ).length;

  const duplicateCount = candidates.length - newCount;

  elements.folderImportCount.textContent = `${candidates.length} VIDEOS`;

  const previewLimit = 100;

  candidates.slice(0, previewLimit).forEach((file) => {
    const item = document.createElement("li");
    item.textContent = file.name;

    item.title = file.folderPath
      ? `${file.folderPath} / ${file.name}`
      : file.name;

    elements.folderImportList.append(item);
  });

  if (candidates.length > previewLimit) {
    const more = document.createElement("li");

    more.className = "drive-import-more";
    more.textContent = `…and ${candidates.length - previewLimit} more video(s)`;

    elements.folderImportList.append(more);
  }

  elements.folderImportPreview.hidden = false;

  elements.importScannedVideosButton.disabled = newCount === 0;

  elements.importScannedVideosButton.textContent =
    newCount > 0
      ? `Import ${newCount} video${newCount === 1 ? "" : "s"}`
      : "Nothing new to import";

  let status = `${candidates.length} video(s) found · ${newCount} new · ${duplicateCount} already in library. Scanned ${result.scannedFolders} folder(s).`;

  if (result.truncated) {
    status += ` Safety limit reached (${MAX_DRIVE_SCAN_FOLDERS} folders or ${MAX_DRIVE_SCAN_VIDEOS} videos); some items may remain.`;
  }

  if (!result.includeSubfolders && result.childFolderCount > 0) {
    status += ` ${result.childFolderCount} subfolder(s) were not opened.`;
  }

  if (result.skippedShortcuts > 0) {
    status += ` ${result.skippedShortcuts} shortcut(s) skipped.`;
  }

  setFolderImportStatus(status, candidates.length ? "success" : "info");
}

async function handleScanDriveFolder() {
  if (folderScanBusy) return;

  const folderUrl = elements.driveFolderUrl.value.trim();
  const apiKey = elements.driveApiKey.value.trim();
  const folderId = extractDriveFolderId(folderUrl);

  resetFolderImportScan();

  if (!folderId) {
    setFolderImportStatus(
      "Enter a valid Google Drive folder URL containing /folders/ and its folder ID.",
      "error",
    );

    elements.driveFolderUrl.focus();
    return;
  }

  if (!apiKey) {
    setFolderImportStatus(
      "Paste your restricted Google Drive API key to scan this folder.",
      "error",
    );

    elements.driveApiKey.focus();
    return;
  }

  folderScanBusy = true;
  elements.scanDriveFolderButton.disabled = true;
  elements.scanDriveFolderButton.textContent = "Scanning…";

  setFolderImportStatus("Connecting to Google Drive…", "working");

  try {
    const result = await scanPublicDriveFolder(
      folderId,
      apiKey,
      elements.scanNestedFolders.checked,
    );

    folderScanResults = result;
    showFolderScanPreview(result);

    if (result.videos.length === 0) {
      setFolderImportStatus(
        "Folder access succeeded, but no recognizable video files were listed. Check that the target folder is shared as Anyone with the link — Viewer, or open the subfolder containing videos and scan it directly.",
        "info",
      );
    }
  } catch (error) {
    console.error("Drive folder scan failed:", error);

    folderScanResults = null;
    resetFolderImportScan();

    setFolderImportStatus(
      error.message || "Could not scan this Drive folder.",
      "error",
    );
  } finally {
    folderScanBusy = false;
    elements.scanDriveFolderButton.disabled = false;
    elements.scanDriveFolderButton.textContent = "Scan folder";
  }
}

function getFolderNameForImport(scan) {
  const safeName = sanitizeImportedFolderName(scan.rootFolderName);

  return (
    categories.find(
      (category) => category.toLowerCase() === safeName.toLowerCase(),
    ) || safeName
  );
}

function importScannedDriveVideos() {
  if (!folderScanResults) {
    showToast("Scan a Drive folder before importing.");
    return;
  }

  const previousCategories = [...categories];
  const previousVideos = videos;

  const autoCreateFolder = elements.createMatchingFolder.checked;

  let destination = autoCreateFolder
    ? getFolderNameForImport(folderScanResults)
    : elements.folderImportCategory.value;

  if (!destination) destination = "Other";

  if (
    !categories.some(
      (category) => category.toLowerCase() === destination.toLowerCase(),
    )
  ) {
    categories.push(destination);
  } else {
    destination = categories.find(
      (category) => category.toLowerCase() === destination.toLowerCase(),
    );
  }

  const knownIds = new Set(videos.map((video) => video.fileId));

  const candidates = folderScanResults.videos.filter(
    (file) => !knownIds.has(file.fileId),
  );

  if (candidates.length === 0) {
    showToast("All scanned videos are already in your library.");
    return;
  }

  const now = Date.now();

  const imported = candidates.map((file, index) => ({
    id: makeId(),
    fileId: file.fileId,
    resourceKey: file.resourceKey || null,
    title: cleanImportedTitle(file.name),
    category: destination,
    favorite: false,
    addedAt: now + index,
    lastWatched: null,
    sourceFolderId: folderScanResults.rootFolderId,
    sourceFolderName: folderScanResults.rootFolderName,
    sourceFolderPath: file.folderPath || "",
  }));

  videos = [...imported, ...videos];

  if (!saveCategories() || !saveLibrary()) {
    categories = previousCategories;
    videos = previousVideos;

    saveCategories();
    saveLibrary();
    return;
  }

  currentView = "library";
  currentCategory = destination;
  elements.searchInput.value = "";

  render();

  closeDialog(elements.folderImportDialog);
  elements.driveApiKey.value = "";

  showToast(`Imported ${imported.length} video(s) into “${destination}”.`);
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

function wireEvents() {
  elements.themeButton.addEventListener("click", cycleTheme);

  $("#addVideoButton").addEventListener("click", openAddDialog);

  $("#heroActionButton").addEventListener("click", openAddDialog);

  $("#emptyAddButton").addEventListener("click", openAddDialog);

  elements.addForm.addEventListener("submit", handleAddVideo);

  elements.editForm.addEventListener("submit", handleEditVideo);

  elements.manageFoldersButton.addEventListener("click", openFolderDialog);

  elements.createFolderForm.addEventListener("submit", handleCreateFolder);

  elements.exportLibraryButton.addEventListener("click", exportLibrary);

  elements.importLibraryButton.addEventListener("click", () =>
    elements.importFileInput.click(),
  );

  elements.importDriveFolderButton.addEventListener(
    "click",
    openFolderImportDialog,
  );

  elements.scanDriveFolderButton.addEventListener(
    "click",
    handleScanDriveFolder,
  );

  elements.importScannedVideosButton.addEventListener(
    "click",
    importScannedDriveVideos,
  );

  elements.cancelFolderImportButton.addEventListener("click", () =>
    closeDialog(elements.folderImportDialog),
  );

  elements.createMatchingFolder.addEventListener(
    "change",
    updateFolderImportDestinationControl,
  );

  elements.folderImportDialog.addEventListener("close", () => {
    // Never save the API key in local storage or library backups.
    elements.driveApiKey.value = "";
  });

  elements.importFileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importLibraryFile(file);
  });

  elements.sortSelect.addEventListener("change", render);

  elements.confirmDeleteButton.addEventListener("click", confirmDeleteVideo);

  elements.cancelDeleteButton.addEventListener("click", () => {
    pendingDeleteId = null;
    closeDialog(elements.deleteDialog);
  });

  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.closeDialog);

      if (dialog === elements.deleteDialog) {
        pendingDeleteId = null;
      }

      closeDialog(dialog);
    });
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      currentCategory = "All";

      render();

      document.body.classList.remove("sidebar-open");
    });
  });

  elements.sidebarFolders.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (button) {
      currentView = "library";
      setCategory(button.dataset.category);

      document.body.classList.remove("sidebar-open");
    }
  });

  elements.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (button) setCategory(button.dataset.category);
  });

  elements.searchInput.addEventListener("input", render);

  $("#closePlayerButton").addEventListener("click", closePlayer);

  elements.nextVideoButton.addEventListener("click", playNext);

  $("#mobileMenu").addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  [
    elements.addDialog,
    elements.editDialog,
    elements.deleteDialog,
    elements.folderDialog,
    elements.folderImportDialog,
    elements.playerDialog,
  ].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;

      if (dialog === elements.playerDialog) {
        closePlayer();
      } else {
        if (dialog === elements.deleteDialog) {
          pendingDeleteId = null;
        }

        closeDialog(dialog);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;

    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag);

    const anyDialogOpen = [
      elements.addDialog,
      elements.editDialog,
      elements.deleteDialog,
      elements.folderDialog,
      elements.folderImportDialog,
      elements.playerDialog,
    ].some((dialog) => dialog.open);

    if (event.key === "/" && !typing && !anyDialogOpen) {
      event.preventDefault();
      elements.searchInput.focus();
    }

    if (event.key === "Escape") {
      document.body.classList.remove("sidebar-open");
    }
  });
}

/* =========================================================
   ADD A SINGLE VIDEO
   ========================================================= */

function handleAddVideo(event) {
  event.preventDefault();

  const title = elements.videoTitle.value.trim();
  const rawUrl = elements.driveUrl.value.trim();
  const category = elements.videoCategory.value;
  const fileId = extractDriveFileId(rawUrl);

  elements.formError.hidden = true;
  elements.formError.textContent = "";

  if (!title) {
    elements.formError.textContent = "Please enter a video title.";

    elements.formError.hidden = false;
    return;
  }

  if (!fileId) {
    elements.formError.textContent =
      "Enter a valid HTTPS Google Drive file link.";

    elements.formError.hidden = false;
    return;
  }

  if (!categories.includes(category)) {
    elements.formError.textContent = "Please choose a valid folder.";

    elements.formError.hidden = false;
    return;
  }

  if (videos.some((video) => video.fileId === fileId)) {
    elements.formError.textContent =
      "That Google Drive video is already in your library.";

    elements.formError.hidden = false;
    return;
  }

  const video = {
    id: makeId(),
    fileId,
    resourceKey: driveResourceKey(rawUrl),
    title,
    category,
    favorite: false,
    addedAt: Date.now(),
    lastWatched: null,
  };

  videos.unshift(video);

  if (!saveLibrary()) {
    videos = videos.filter((item) => item.id !== video.id);
    return;
  }

  elements.addForm.reset();
  renderCategoryOptions(elements.videoCategory, "Other");

  closeDialog(elements.addDialog);

  currentView = "library";
  currentCategory = "All";
  elements.searchInput.value = "";

  render();

  showToast("Video added to your library.");
}

/* =========================================================
   START THE APPLICATION
   ========================================================= */

wireEvents();
applyTheme(getSavedTheme());
render();
