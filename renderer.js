const { app, BrowserWindow, ipcMain, shell, desktopCapturer, Tray, Menu } = require('electron');
const path = require('path');

let tray;
let quitting = false;

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1680,
    height: 949,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    nodeIntegration: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');

  tray = new Tray(path.join(__dirname, "icons/tray.png"));

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show", click: () => win.show() },
    { label: "Quit", click: () => app.quit() }
  ]);

  tray.setToolTip("OriginChats");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    win.isVisible() ? win.hide() : win.show();
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://');
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  ipcMain.on('window-control', (event, action) => {
    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'close': win.close(); break;
      case 'maximize':
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
    }
  });

  ipcMain.handle('get-screen-stream-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources;
  })
  
  ipcMain.handle("login", async () => {
    return new Promise((resolve, reject) => {
      const loginWin = new BrowserWindow({
        width: 800,
        height: 600,
        parent: win,
        modal: true,
        show: true,
        webPreferences: { nodeIntegration: false },
      });

      loginWin.loadURL("https://rotur.dev/auth?return_to=https://allucat1000.github.io/Prism/authSuccess");

      loginWin.webContents.on("will-redirect", (event, url) => {
        if (url.startsWith("https://allucat1000.github.io/Prism/authSuccess")) {
          const token = new URL(url).searchParams.get("token");
          resolve(token);
          loginWin.close();
        }
      });

      loginWin.on("closed", () => reject(new Error("Login closed")));
    });
  });
});