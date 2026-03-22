/**
 * Build script: copies the Next.js web app into ./app and builds it for production.
 * Run this before `npm run dist` to package the desktop app.
 *
 * Usage: npm run build
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WEB_APP_DIR = path.resolve(__dirname, "../../legalease-ph");
const APP_DIR = path.resolve(__dirname, "../nextapp");

console.log("=== LegalEase PH Desktop Build ===\n");

// Step 1: Clean previous build
if (fs.existsSync(APP_DIR)) {
  console.log("Cleaning previous app build...");
  fs.rmSync(APP_DIR, { recursive: true, force: true });
}

// Step 2: Copy web app source
console.log("Copying web app from:", WEB_APP_DIR);
fs.mkdirSync(APP_DIR, { recursive: true });

const filesToCopy = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "eslint.config.mjs",
];

const dirsToCopy = ["src", "public"];

for (const file of filesToCopy) {
  const src = path.join(WEB_APP_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(APP_DIR, file));
    console.log("  Copied:", file);
  }
}

for (const dir of dirsToCopy) {
  const src = path.join(WEB_APP_DIR, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(APP_DIR, dir), { recursive: true });
    console.log("  Copied:", dir + "/");
  }
}

// Step 3: Install dependencies
console.log("\nInstalling dependencies...");
execSync("npm install --production=false", {
  cwd: APP_DIR,
  stdio: "inherit",
});

// Step 4: Build Next.js
console.log("\nBuilding Next.js for production...");
execSync("npx next build", {
  cwd: APP_DIR,
  stdio: "inherit",
});

// Step 5: Remove dev dependencies and source files to reduce size
console.log("\nCleaning up for distribution...");
execSync("npm prune --production", {
  cwd: APP_DIR,
  stdio: "inherit",
});

// Remove source files (built output is in .next/)
const toRemove = ["src", "eslint.config.mjs", "postcss.config.mjs"];
for (const item of toRemove) {
  const p = path.join(APP_DIR, item);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log("  Removed:", item);
  }
}

// Step 6: Rename dirs that electron-builder ignores/strips
// .next -> next-build (dot-directories ignored)
// node_modules -> _modules (node_modules always excluded)
const dotNext = path.join(APP_DIR, ".next");
const nextBuild = path.join(APP_DIR, "next-build");
if (fs.existsSync(dotNext)) {
  if (fs.existsSync(nextBuild)) fs.rmSync(nextBuild, { recursive: true });
  fs.renameSync(dotNext, nextBuild);
  console.log("  Renamed .next -> next-build");
}

const nodeModules = path.join(APP_DIR, "node_modules");
const modules = path.join(APP_DIR, "_modules");
if (fs.existsSync(nodeModules)) {
  if (fs.existsSync(modules)) fs.rmSync(modules, { recursive: true });
  fs.renameSync(nodeModules, modules);
  console.log("  Renamed node_modules -> _modules");
}

console.log("\n=== Build complete! ===");
console.log("Run 'npm run dist:win' to create the Windows installer.");
console.log("Run 'npm run dist:mac' to create the macOS installer.");
