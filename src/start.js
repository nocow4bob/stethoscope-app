const { app, ipcMain, dialog, BrowserWindow, session, Tray, nativeImage } = require('electron')
const path = require('path')
const url = require('url')
const log = require('./lib/logger')
const initMenu = require('./Menu')
const initProtocols = require('./lib/protocolHandlers')
const env = process.env.NODE_ENV || 'production'
const pkg = require('../package.json')
const findIcon = require('./lib/findIcon')(env)
const startGraphQLServer = require('../server')
const { setup: setupPushReceiver } = require('electron-push-receiver');


let mainWindow
let tray
let appStartTime = Date.now()
let server
let updater
let launchIntoUpdater = false
let deeplinkingUrl
let isFirstLaunch = true

// icons that are displayed in the Menu bar
const statusImages = {
  PASS: nativeImage.createFromPath(findIcon('scope-icon-ok2@2x.png')),
  NUDGE: nativeImage.createFromPath(findIcon('scope-icon-nudge2@2x.png')),
  FAIL: nativeImage.createFromPath(findIcon('scope-icon-warn2@2x.png'))
}

// process command line arguments
const enableDebugger = process.argv.find(arg => arg.includes('enableDebugger'))

function createWindow () {
  log.info('starting stethoscope')

  if (isFirstLaunch) {
    const { AppUpdater } = require('electron-updater')
    const appUpdater = new AppUpdater()
    appUpdater.checkForUpdatesAndNotify()
    isFirstLaunch = false
  }

  // determine if app is already running
  const shouldQuit = app.makeSingleInstance((commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
    }

    if (process.platform === 'win32') {
      deeplinkingUrl = commandLine.slice(1)
    }

    if (String(deeplinkingUrl).indexOf('update') > -1) {
      updater.checkForUpdates(env, mainWindow, log).catch(err => {
        log.error(`error checking for update: ${err}`)
      })
    }

  })

  if (shouldQuit) {
    app.quit()
    return
  }

  const windowPrefs = {
    width: 480,
    height: 670,
    fullscreenable: false,
    maximizable: false,
    // uncomment the line before to keep window controls but hide title bar
    // titleBarStyle: 'hidden',
    webPreferences: {
      webSecurity: false,
      sandbox: false
    }
  }

  if (process.platform === 'win32') {
    deeplinkingUrl = process.argv.slice(1)
  }

  // only allow resize if debugging production build
  if (env === 'production' && !enableDebugger) {
    windowPrefs.resizable = false
  }

  mainWindow = new BrowserWindow(windowPrefs)
  setupPushReceiver(mainWindow.webContents);

  if (tray) tray.destroy()

  tray = new Tray(statusImages.PASS)
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    } else {
      mainWindow = new BrowserWindow(windowPrefs)
      initMenu(mainWindow, env, log)
      mainWindow.loadURL(
        process.env.ELECTRON_START_URL ||
        url.format({
          pathname: path.join(__dirname, '/../build/index.html'),
          protocol: 'file:',
          slashes: true
        })
      )
    }
  })

  if (enableDebugger) {
    mainWindow.webContents.openDevTools()
  }

  initMenu(mainWindow, env, log)

  mainWindow.loadURL(
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, '/../build/index.html'),
      protocol: 'file:',
      slashes: true
    })
  )

  // adjust window height when download begins and ends
  ipcMain.on('download:start', (event, arg) => {
    mainWindow.setSize(windowPrefs.width, 110, true)
  })

  ipcMain.on('scan:init', (event) => {
    app.setBadgeCount(0)
    mainWindow.setOverlayIcon(null, 'No policy violations')
  })

  ipcMain.on('scan:violation', (event, badgeURI, violationCount) => {
    if (process.platform === 'darwin') {
      app.setBadgeCount(violationCount)
    } else {
      const img = nativeImage.createFromDataURL(badgeURI)
      mainWindow.setOverlayIcon(img, `${violationCount} policy violations`)
    }
  })

  ipcMain.on('download:complete', (event, { resize }) => {
    if (resize) {
      mainWindow.setSize(windowPrefs.width, windowPrefs.height, true)
    }
  })

  ipcMain.on('app:loaded', () => {
    if (String(deeplinkingUrl).indexOf('update') > -1) {
      updater.checkForUpdates(env, mainWindow).then(err => {
        if (err) { log.error(err) }
        deeplinkingUrl = ''
      }).catch(err => {
        deeplinkingUrl = ''
        log.error(err)
      })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// wrap ready callback in 0-delay setTimeout to reduce serious jank
// issues on Windows
app.on('ready', () => setTimeout(() => {
  createWindow()
  initProtocols(mainWindow)

  updater = require('./updater')(env, mainWindow, log)

  // override internal request origin to give express CORS policy something to check
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details
    const base = 'stethoscope://main'
    Object.assign(requestHeaders, {
      Origin: base,
      Referrer: base
    })
    const args = { cancel: false, requestHeaders }
    callback(args)
  })

  if (launchIntoUpdater) {
    log.info(`Launching into updater: ${launchIntoUpdater}`)
    updater.checkForUpdates(env, mainWindow).catch(err => log.error(err))
  }

  const appHooksForServer = {
    setScanStatus (status = 'PASS') {
      tray.setImage(statusImages[status])
    },
    requestUpdate () {
      updater.checkForUpdates()
    }
  }

  // start GraphQL server
  server = startGraphQLServer(env, log, appHooksForServer)

  server.on('error', (err) => {
    if (err.message.includes('EADDRINUSE')) {
      dialog.showMessageBox({
        message: 'Stethoscope is already running'
      })
      app.quit()
    }
  })
}, 0))

app.on('before-quit', () => {
  let appCloseTime = Date.now()
  log.debug(`uptime: ${appCloseTime - appStartTime}`)
  if (server && server.listening) {
    server.close()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('open-url', function (event, url) {
  event.preventDefault()

  if (url.includes('update')) {
    launchIntoUpdater = true
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()

    if (launchIntoUpdater) {
      updater.checkForUpdates(env, mainWindow).catch(err => {
        log.error(err)
      })
    }
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

process.on('uncaughtException', (err) => {
  if (server && server.listening) {
    server.close()
  }
  console.error('exiting', err)
  process.exit(1)
})
