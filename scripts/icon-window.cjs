const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => { const win = new BrowserWindow({width:1024,height:1024,show:false,transparent:true}); win.loadURL('about:blank'); });
