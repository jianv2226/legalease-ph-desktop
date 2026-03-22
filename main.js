const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const { autoUpdater } = require("electron-updater");

const PORT = 23847; // Random high port to avoid conflicts
let mainWindow = null;
let serverProcess = null;

function getAppPath() {
  // In production (packaged), the app is in resources/app
  // In development, it's in ./app
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "nextapp");
  }
  return path.join(__dirname, "nextapp");
}

function restorePackagedDirs(appPath) {
  // electron-builder can't copy dot-dirs or node_modules, so we rename them in the build script
  // and restore them on first launch
  const fs = require("fs");

  const nextBuild = path.join(appPath, "next-build");
  const dotNext = path.join(appPath, ".next");
  if (fs.existsSync(nextBuild) && !fs.existsSync(dotNext)) {
    fs.renameSync(nextBuild, dotNext);
    console.log("Restored next-build -> .next");
  }

  const modules = path.join(appPath, "_modules");
  const nodeModules = path.join(appPath, "node_modules");
  if (fs.existsSync(modules) && !fs.existsSync(nodeModules)) {
    fs.renameSync(modules, nodeModules);
    console.log("Restored _modules -> node_modules");
  }
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    const appPath = getAppPath();
    restorePackagedDirs(appPath);
    const nextBin = path.join(appPath, "node_modules", ".bin", "next");
    const nextCmd = process.platform === "win32" ? nextBin + ".cmd" : nextBin;

    serverProcess = spawn(nextCmd, ["start", "--port", String(PORT)], {
      cwd: appPath,
      env: { ...process.env, NODE_ENV: "production" },
      shell: process.platform === "win32",
      stdio: "pipe",
    });

    serverProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log("[Next.js]", msg);
      if (msg.includes("Ready") || msg.includes("started") || msg.includes(String(PORT))) {
        resolve();
      }
    });

    serverProcess.stderr.on("data", (data) => {
      console.error("[Next.js Error]", data.toString());
    });

    serverProcess.on("error", (err) => {
      console.error("Failed to start Next.js server:", err);
      reject(err);
    });

    serverProcess.on("close", (code) => {
      console.log("Next.js server exited with code:", code);
    });

    // Fallback: poll until the server responds
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds
    const poll = setInterval(() => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(poll);
        reject(new Error("Server did not start within 30 seconds"));
        return;
      }
      http
        .get(`http://localhost:${PORT}`, (res) => {
          if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 307) {
            clearInterval(poll);
            resolve();
          }
        })
        .on("error", () => {
          // Server not ready yet
        });
    }, 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "LegalEase PH",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle new window requests
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow blank windows (used for print preview) and data: URLs
    if (url === "about:blank" || url.startsWith("data:")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          title: "Print Preview - LegalEase PH",
          autoHideMenuBar: true,
        },
      };
    }
    // Open external links in system browser
    if (url.startsWith("http")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Create a splash/loading window
function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splash.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0; display: flex; align-items: center; justify-content: center;
          height: 100vh; background: #1e3a5f; color: white; font-family: 'Segoe UI', sans-serif;
          flex-direction: column; gap: 16px;
        }
        h1 { font-size: 28px; margin: 0; font-weight: 700; }
        .subtitle { font-size: 14px; opacity: 0.7; }
        .loader {
          width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2);
          border-top-color: #d4a843; border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <h1>LegalEase PH</h1>
      <p class="subtitle">Starting application...</p>
      <div class="loader"></div>
    </body>
    </html>
  `)}`
  );

  return splash;
}

app.whenReady().then(async () => {
  const splash = createSplashWindow();

  try {
    await startNextServer();
    createWindow();
    splash.close();
  } catch (err) {
    console.error("Failed to start:", err);
    splash.close();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ── Auto-updater (checks GitHub Releases) ──────────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", (info) => {
  console.log("Update available:", info.version);
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Available",
      message: "A new version of LegalEase PH (v" + info.version + ") is being downloaded. It will be installed when you close the app.",
      buttons: ["OK"],
    });
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("Update downloaded:", info.version);
  if (mainWindow) {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: "LegalEase PH v" + info.version + " has been downloaded. Restart now to install?",
        buttons: ["Restart Now", "Later"],
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  }
});

autoUpdater.on("error", (err) => {
  console.log("Auto-updater error:", err.message);
});

// Check for updates 5 seconds after app is ready
app.on("ready", () => {
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log("Update check failed:", err.message);
    });
  }, 5000);
});
