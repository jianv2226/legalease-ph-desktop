# LegalEase PH - Desktop App

Desktop version of LegalEase PH, built with Electron. Wraps the Next.js web app into a standalone desktop application.

## Quick Start (Development)

```bash
# 1. Install Electron dependencies
npm install

# 2. Build the web app into ./app
npm run build

# 3. Run the desktop app
npm start
```

## Create Installer

```bash
# Windows (.exe installer)
npm run dist:win

# macOS (.dmg)
npm run dist:mac

# Linux (.AppImage)
npm run dist:linux
```

The installer will be in the `dist/` folder.

## How It Works

1. The build script copies the Next.js web app from `../legalease-ph`
2. It runs `next build` to create a production build
3. Electron starts a local Next.js server on a random port
4. A splash screen shows while the server starts
5. The main window loads the app from `localhost`
6. All data stays on the user's machine (localStorage + IndexedDB)

## Requirements

- Node.js 18+
- The `legalease-ph` web app must be in the sibling directory (`../legalease-ph`)
