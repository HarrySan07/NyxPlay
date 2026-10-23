
# ✦ NYXPLAY — Your Personal Media Library

**Your videos. Your folders. Your space.**

NYXPLAY is a lightweight, responsive personal media-library website built with HTML, CSS, and vanilla JavaScript. It brings your Google Drive video links together in one interface with a custom design, a video library, folder filters, favorites, and a built-in embedded player.

## ✨ Features

- **Dark and Light Mode** — Switch between two themes and remember your preference in the current browser.
- **Google Drive Playback** — Open supported Google Drive videos through an embedded player.
- **Personal Video Library** — Add videos using Google Drive file-sharing links.
- **Custom Folders** — Organize videos into Movies, Series, Cartoons, Anime, and Other.
- **Search** — Quickly find videos by title or category.
- **Favorites** — Mark videos you want to watch again.
- **Recently Watched** — View videos that you have opened.
- **Next Video** — Move to the next item in the currently displayed list.
- **Responsive Layout** — Use the interface on desktop and mobile screens.
- **Browser Storage** — Save the library, favorites, watch activity, and theme preference in local browser storage.
- **No Build Tools Required** — Built with standard HTML, CSS, and JavaScript.

## 🛠️ Technologies

- HTML5
- CSS3
- JavaScript
- Google Drive embedded player
- Browser Local Storage
- Git and GitHub Pages

## 📁 Project Structure

```text
NyxPlay/
├── index.html
├── style.css
├── script.js
└── README.md
```

## 🚀 Run Locally

### Option 1: Visual Studio Code

1. Open the `NyxPlay` folder in Visual Studio Code.
2. Make sure all three application files are present.
3. Install the Live Server extension if you don't already have it.
4. Open `index.html`.
5. Click **Go Live** in the VS Code status bar.
6. Open the local URL in your browser.

### Option 2: Open Directly

Open `index.html` in a modern web browser. A local server is recommended for development and testing.

## 🎬 Add a Google Drive Video

1. Open NYXPLAY.
2. Click **Add video**.
3. Enter a title.
4. Paste the Google Drive file-sharing link.
5. Choose a category.
6. Click **Save to library**.
7. Select the video card to open the embedded player.

### Google Drive Permissions

Playback depends on the video's sharing settings, account permissions, file format, and Google's embedded-player support.

For restricted videos, sign in with an authorized Google account when necessary. Do not make private files publicly accessible solely to make the player work.

## 🌗 Theme Switching

Use the theme button in the top navigation to switch between:

- **Dark Mode**
- **Light Mode**

The selected theme is remembered in the current browser when local storage is available.

## 🌐 Deploy to GitHub Pages

1. Create a GitHub repository for the project.
2. Push `index.html`, `style.css`, `script.js`, and `README.md` to the repository.
3. Open the repository's **Settings**.
4. Select **Pages**.
5. Under the build and deployment settings, choose **Deploy from a branch**.
6. Select your intended branch, usually `main`, and the `/ (root)` folder.
7. Save the settings.
8. Wait for GitHub Pages to publish the website, then open the published URL shown in the Pages settings.

GitHub Pages hosts the website files. It does not host the Google Drive videos themselves.

## 💾 Storage and Synchronization

NYXPLAY currently stores its library and preferences in the browser's Local Storage.

This means:

- The library is available in the browser where it was created.
- Another browser or device does not automatically receive the same library.
- Clearing the browser's site data may erase the locally saved library.
- Opening the site under a different local origin or port can result in a separate library.
- Publishing updated website files does not automatically synchronize browser data.

Cross-device synchronization would require a separate backend or database and an appropriate authentication system.

## 🔒 Privacy and Security

- Do not put passwords, Google OAuth tokens, or other secrets in the frontend source code.
- Keep private Google Drive files restricted to authorized accounts.
- Remember that a public GitHub Pages site can be visited by anyone who has its URL.
- A visitor's locally stored library is separate from another visitor's library.
- Only add and share videos you have the right to access and stream.

## ⚠️ Current Limitations

- No user accounts or backend authentication.
- No automatic synchronization across devices.
- No automatic import of an entire Google Drive folder.
- No exact playback-position synchronization.
- The embedded player relies on Google Drive and its permissions.
- Next Video advances through the current website list; it does not automatically detect episode order in Google Drive.
- Custom playback controls beyond those provided by the embedded player are not available yet.

## 🗺️ Future Improvements

Potential future features include:

- Google OAuth account connections.
- Importing supported Drive folders automatically.
- Cloud-synchronized libraries.
- Multiple storage providers.
- Custom collections and user-created folders.
- Improved episode navigation.
- Saved playback positions.
- Video thumbnails and metadata.
- More robust playback error handling.

## 📜 License

Choose and add a license before distributing or reusing this project. Until a license is added, do not assume that other people have permission to reuse the project's code.

---

**NYXPLAY**  
*Your media. Your space.*
