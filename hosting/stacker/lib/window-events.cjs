function sendToWindow(window, channel, payload) {
  if (!window || window.isDestroyed()) return false
  const contents = window.webContents
  if (!contents || contents.isDestroyed()) return false
  contents.send(channel, payload)
  return true
}

module.exports = { sendToWindow }
