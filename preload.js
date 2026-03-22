// Preload script - runs before web content loads
// Keeps contextIsolation enabled for security
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isDesktop: true,
});
