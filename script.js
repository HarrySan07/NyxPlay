"use strict";

const STORAGE_KEY = "nyxplay_library_v1";
const THEME_KEY = "nyxplay_theme_v1";
const THEMES = ["dark", "light"];
const CATEGORIES = ["Movies", "Series", "Cartoons", "Anime", "Other"];

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
  addDialog: $("#addDialog"),
  addForm: $("#addVideoForm"),
  videoTitle: $("#videoTitle"),
  driveUrl: $("#driveUrl"),
  videoCategory: $("#videoCategory"),
  formError: $("#formError"),
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

let videos = loadLibrary();
let currentView = "library";
let currentCategory = "All";
let currentQueue = [];
let currentVideoId = null;
let toastTimeout = null;

/* ---------------- LIBRARY STORAGE ---------------- */

function loadLibrary() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (!Array.isArray(stored)) return [];

    return stored.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.fileId === "string" &&
        typeof item.title === "string" &&
        CATEGORIES.includes(item.category),
    );
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

/* ---------------- GOOGLE DRIVE LINKS ---------------- */

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
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

/* ---------------- NOTIFICATIONS ---------------- */

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2700);
}

/* ---------------- DARK AND LIGHT THEMES ---------------- */

function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);

    return THEMES.includes(saved) ? saved : "dark";
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

  // Supports the current HTML and a future .theme-icon element.
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
    console.warn("Theme preference could not be saved.", error);
  }

  if (announce) {
    showToast(`Switched to ${isDark ? "dark" : "light"} mode.`);
  }
}

function cycleTheme() {
  const current = document.body.dataset.theme || "dark";

  const next = current === "dark" ? "light" : "dark";

  applyTheme(next, true);
}

/* ---------------- DIALOGS ---------------- */

function openAddDialog() {
  elements.formError.hidden = true;
  elements.formError.textContent = "";

  if (!elements.addDialog.open) {
    elements.addDialog.showModal();
  }

  setTimeout(() => {
    elements.videoTitle.focus();
  }, 50);
}

function closeDialog(dialog) {
  if (dialog?.open) {
    dialog.close();
  }
}

/* ---------------- FILTERING AND SEARCH ---------------- */

function getVisibleVideos() {
  const query = elements.searchInput.value.trim().toLowerCase();

  let result = [...videos];

  if (currentView === "favorites") {
    result = result.filter((video) => video.favorite);
  } else if (currentView === "recent") {
    result = result
      .filter((video) => video.lastWatched)
      .sort((a, b) => b.lastWatched - a.lastWatched);
  } else {
    result.sort((a, b) => b.addedAt - a.addedAt);
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

  return result;
}

/* ---------------- SIDEBAR FOLDERS ---------------- */

function renderSidebarFolders() {
  elements.sidebarFolders.replaceChildren();

  for (const category of CATEGORIES) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = `folder-item${currentCategory === category ? " active" : ""}`;
    button.dataset.category = category;

    const dot = document.createElement("span");
    dot.className = "folder-dot";

    const label = document.createElement("span");
    label.textContent = category;

    const count = document.createElement("span");

    count.style.cssText = "margin-left:auto;color:var(--muted);font-size:10px";

    count.textContent = videos.filter(
      (video) => video.category === category,
    ).length;

    button.append(dot, label, count);
    elements.sidebarFolders.append(button);
  }
}

/* ---------------- CATEGORY FILTERS ---------------- */

function renderCategoryFilters() {
  elements.categoryFilters.replaceChildren();

  for (const category of ["All", ...CATEGORIES]) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = `filter-button${currentCategory === category ? " active" : ""}`;

    button.dataset.category = category;
    button.textContent = category;

    elements.categoryFilters.append(button);
  }
}

/* ---------------- VIDEO CARDS ---------------- */

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

  const favorite = document.createElement("button");

  favorite.type = "button";
  favorite.className = `favorite-button${video.favorite ? " is-favorite" : ""}`;

  favorite.textContent = video.favorite ? "♥" : "♡";

  favorite.setAttribute(
    "aria-label",
    video.favorite ? "Remove from favorites" : "Add to favorites",
  );

  favorite.setAttribute("aria-pressed", String(Boolean(video.favorite)));

  favorite.addEventListener("click", () => {
    toggleFavorite(video.id);
  });

  meta.append(text, favorite);
  article.append(poster, meta);

  return article;
}

/* ---------------- RENDER THE LIBRARY ---------------- */

function render() {
  const visibleVideos = getVisibleVideos();

  elements.videoGrid.replaceChildren();

  for (const video of visibleVideos) {
    elements.videoGrid.append(createVideoCard(video));
  }

  elements.videoCount.textContent = videos.length;

  elements.favoriteCount.textContent = videos.filter(
    (video) => video.favorite,
  ).length;

  elements.recentCount.textContent = videos.filter(
    (video) => video.lastWatched,
  ).length;

  elements.resultCount.textContent = `${visibleVideos.length} ${visibleVideos.length === 1 ? "ITEM" : "ITEMS"}`;

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
}

/* ---------------- CATEGORY SELECTION ---------------- */

function setCategory(category) {
  if (category !== "All" && !CATEGORIES.includes(category)) {
    return;
  }

  currentCategory = category;
  render();
}

/* ---------------- FAVORITES ---------------- */

function toggleFavorite(id) {
  const video = videos.find((item) => item.id === id);

  if (!video) return;

  video.favorite = !video.favorite;

  saveLibrary();
  render();

  showToast(video.favorite ? "Added to favorites ♥" : "Removed from favorites");
}

/* ---------------- VIDEO PLAYER ---------------- */

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

/* ---------------- ADD A VIDEO ---------------- */

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

  if (!CATEGORIES.includes(category)) {
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
  elements.videoCategory.value = "Other";

  closeDialog(elements.addDialog);

  currentView = "library";
  currentCategory = "All";
  elements.searchInput.value = "";

  render();

  showToast("Video added to your library.");
}

/* ---------------- EVENT LISTENERS ---------------- */

function wireEvents() {
  elements.themeButton.addEventListener("click", cycleTheme);

  $("#addVideoButton").addEventListener("click", openAddDialog);

  $("#heroActionButton").addEventListener("click", openAddDialog);

  $("#emptyAddButton").addEventListener("click", openAddDialog);

  elements.addForm.addEventListener("submit", handleAddVideo);

  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      closeDialog(document.getElementById(button.dataset.closeDialog));
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

  [elements.addDialog, elements.playerDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        if (dialog === elements.playerDialog) {
          closePlayer();
        } else {
          closeDialog(dialog);
        }
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;

    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag);

    if (
      event.key === "/" &&
      !typing &&
      !elements.addDialog.open &&
      !elements.playerDialog.open
    ) {
      event.preventDefault();
      elements.searchInput.focus();
    }

    if (event.key === "Escape") {
      document.body.classList.remove("sidebar-open");
    }
  });
}

/* ---------------- START THE APP ---------------- */

wireEvents();
applyTheme(getSavedTheme());
render();
