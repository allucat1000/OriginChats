const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = {
      ...details.responseHeaders,
      "Access-Control-Allow-Origin": ["*"],
      "Access-Control-Allow-Headers": ["*"],
      "Access-Control-Allow-Methods": ["GET,POST,PUT,DELETE,OPTIONS"]
    };

    callback({ responseHeaders: headers });
  });
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

  ipcMain.on('window-control', (event, action) => {
    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'close': win.close(); break;
      case 'maximize':
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
    }
  });
  
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