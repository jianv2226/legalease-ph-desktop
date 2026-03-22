const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");
const net = require("net");
const { autoUpdater } = require("electron-updater");

const PORT = 23847;
let mainWindow = null;
let serverProcess = null;

// ── Single instance lock (B4 fix) ──────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getAppPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "nextapp");
  }
  return path.join(__dirname, "nextapp");
}

// ── Restore renamed dirs (with try/catch for race conditions - B1 fix) ──
function restorePackagedDirs(appPath) {
  const fs = require("fs");

  try {
    const nextBuild = path.join(appPath, "next-build");
    const dotNext = path.join(appPath, ".next");
    if (fs.existsSync(nextBuild) && !fs.existsSync(dotNext)) {
      fs.renameSync(nextBuild, dotNext);
      console.log("Restored next-build -> .next");
    }
  } catch (err) {
    console.warn("Could not restore .next:", err.message);
  }

  try {
    const modules = path.join(appPath, "_modules");
    const nodeModules = path.join(appPath, "node_modules");
    if (fs.existsSync(modules) && !fs.existsSync(nodeModules)) {
      fs.renameSync(modules, nodeModules);
      console.log("Restored _modules -> node_modules");
    }
  } catch (err) {
    console.warn("Could not restore node_modules:", err.message);
  }
}

// ── Check if port is available (B3 fix) ─────────────────────────────
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

// ── Kill server process tree (cleanup fix for Windows) ──────────────
function killServerProcess() {
  if (!serverProcess) return;
  try {
    if (process.platform === "win32") {
      execSync("taskkill /pid " + serverProcess.pid + " /T /F", { stdio: "ignore" });
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch {
    // Process may already be dead
  }
  serverProcess = null;
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    const appPath = getAppPath();
    restorePackagedDirs(appPath);
    const nextBin = path.join(appPath, "node_modules", ".bin", "next");
    const nextCmd = process.platform === "win32" ? nextBin + ".cmd" : nextBin;

    // Bind to localhost only (security fix - prevents LAN exposure)
    serverProcess = spawn(nextCmd, ["start", "--port", String(PORT), "--hostname", "127.0.0.1"], {
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
      const errMsg = data.toString();
      console.error("[Next.js Error]", errMsg);
      // Detect port conflict (B3 fix)
      if (errMsg.includes("EADDRINUSE")) {
        reject(new Error("Port " + PORT + " is already in use. Please close other instances of LegalEase PH."));
      }
    });

    serverProcess.on("error", (err) => {
      console.error("Failed to start Next.js server:", err);
      reject(err);
    });

    // B2 fix: Handle server crash after startup
    serverProcess.on("close", (code) => {
      console.log("Next.js server exited with code:", code);
      if (code !== 0 && code !== null && mainWindow && !mainWindow.isDestroyed()) {
        dialog
          .showMessageBox(mainWindow, {
            type: "error",
            title: "Server Error",
            message: "The application server has stopped unexpectedly. The app needs to restart.",
            buttons: ["Restart", "Quit"],
          })
          .then((result) => {
            if (result.response === 0) {
              app.relaunch();
            }
            app.quit();
          });
      }
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
        .get("http://127.0.0.1:" + PORT, (res) => {
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

  mainWindow.loadURL("http://127.0.0.1:" + PORT);

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle new window requests (security hardened)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow blank windows for print preview (used by window.open("", "_blank"))
    if (url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          title: "Print Preview - LegalEase PH",
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    }
    // Block data: URLs in new windows (security fix - could contain arbitrary JS)
    // Print preview uses about:blank + document.write instead
    if (url.startsWith("data:")) {
      return { action: "deny" };
    }
    // Only open HTTPS URLs in system browser (security fix - no HTTP, allowlist optional)
    if (url.startsWith("https://")) {
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
    "data:text/html;charset=utf-8," + encodeURIComponent([
      "<!DOCTYPE html><html><head><style>",
      "body { margin:0; display:flex; align-items:center; justify-content:center; height:100vh; background:#1e3a5f; color:white; font-family:'Segoe UI',sans-serif; flex-direction:column; gap:16px; }",
      "h1 { font-size:28px; margin:0; font-weight:700; }",
      ".subtitle { font-size:14px; opacity:0.7; }",
      ".loader { width:40px; height:40px; border:3px solid rgba(255,255,255,0.2); border-top-color:#d4a843; border-radius:50%; animation:spin 1s linear infinite; }",
      "@keyframes spin { to { transform:rotate(360deg); } }",
      "</style></head><body>",
      "<h1>LegalEase PH</h1>",
      '<p class="subtitle">Starting application...</p>',
      '<div class="loader"></div>',
      "</body></html>",
    ].join(""))
  );

  return splash;
}

app.whenReady().then(async () => {
  const splash = createSplashWindow();

  // B3 fix: Check port availability before starting
  const portFree = await isPortAvailable(PORT);
  if (!portFree) {
    splash.close();
    dialog.showErrorBox(
      "LegalEase PH",
      "Port " + PORT + " is already in use. Another instance may be running.\n\nPlease close it and try again."
    );
    app.quit();
    return;
  }

  try {
    await startNextServer();
    createWindow();
    splash.close();
  } catch (err) {
    console.error("Failed to start:", err);
    splash.close();
    dialog.showErrorBox("LegalEase PH", "Failed to start: " + err.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killServerProcess();
  app.quit();
});

app.on("before-quit", () => {
  killServerProcess();
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
