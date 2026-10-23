"use strict";

/* =========================================================
   NYXPLAY — PERSONAL MEDIA LIBRARY
   Features:
   - Dark / Light themes
   - Google Drive embedded playback
   - Search, folders, favorites and recently watched
   - Edit and delete videos
   - Create, rename and delete custom folders
   - Export and import JSON backups
   - Sort videos
   ========================================================= */

const STORAGE_KEY = "nyxplay_library_v1";
const THEME_KEY = "nyxplay_theme_v1";
const CATEGORIES_KEY = "nyxplay_categories_v1";

const THEMES = ["dark", "light"];
const BUILTIN_CATEGORIES = ["Movies", "Series", "Cartoons", "Anime", "Other"];

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

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

    if (Array.isArray(stored)) {
      stored.forEach(addUnique);
    }
  } catch (error) {
    console.warn("Could not read custom folders:", error);
  }

  // Preserve existing custom categories from the old library.
  try {
    const oldVideos = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (Array.isArray(oldVideos)) {
      oldVideos.forEach((video) => addUnique(video?.category));
    }
  } catch {
    // Invalid library data is handled separately.
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

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return null;
    }

    return id;
  } catch {
    return null;
  }
}

function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

function drivePreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(
    fileId,
  )}/preview`;
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
  if (!THEMES.includes(theme)) {
    theme = "dark";
  }

  document.body.dataset.theme = theme;

  const isDark = theme === "dark";
  const nextModeLabel = isDark ? "Light mode" : "Dark mode";
  const icon = isDark ? "☀" : "☾";

  const iconElement =
    elements.themeButton?.querySelector(".theme-icon") ||
    elements.themeButton?.querySelector("span:first-child");

  if (elements.themeButtonLabel) {
    elements.themeButtonLabel.textContent = nextModeLabel;
  }

  if (iconElement) {
    iconElement.textContent = icon;
  }

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
  if (dialog?.open) {
    dialog.close();
  }
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
   VIDEO CARDS AND CARD ACTIONS
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

  poster.addEventListener("click", () => {
    openPlayer(video.id);
  });

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
   EDIT VIDEO
   ========================================================= */

function openEditDialog(id) {
  const video = videos.find((item) => item.id === id);
  if (!video) return;

  elements.editFormError.hidden = true;
  elements.editFormError.textContent = "";

  elements.editVideoId.value = video.id;
  elements.editVideoTitle.value = video.title;
  elements.editDriveUrl.value = driveViewUrl(video.fileId);

  renderCategoryOptions(elements.editVideoCategory, video.category);

  if (!elements.editDialog.open) {
    elements.editDialog.showModal();
  }

  setTimeout(() => {
    elements.editVideoTitle.focus();
  }, 50);
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

    elements.videoFrame.src = drivePreviewUrl(video.fileId);
  }

  showToast("Video details updated.");
}

/* =========================================================
   DELETE VIDEO — ORIGINAL DRIVE FILE IS NOT DELETED
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

  setTimeout(() => {
    elements.newFolderName.focus();
  }, 50);
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

    count.textContent = String(
      videos.filter((video) => video.category === category).length,
    );

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

      renameButton.addEventListener("click", () => {
        renameFolder(category);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className =
        "secondary-button folder-action-button delete-action";
      deleteButton.textContent = "Delete";

      deleteButton.addEventListener("click", () => {
        deleteFolder(category);
      });

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
  if (!item || typeof item !== "object") {
    return null;
  }

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
      if (existingFileIds.has(video.fileId)) {
        return false;
      }

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

  elements.videoFrame.src = drivePreviewUrl(video.fileId);

  elements.openDriveButton.onclick = () => {
    window.open(driveViewUrl(video.fileId), "_blank", "noopener,noreferrer");
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

  elements.importFileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];

    if (file) {
      importLibraryFile(file);
    }
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

    if (button) {
      setCategory(button.dataset.category);
    }
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
   ADD VIDEO
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
    elements.formError.textContent = "That video is already in your library.";

    elements.formError.hidden = false;
    return;
  }

  const video = {
    id: makeId(),
    fileId,
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
