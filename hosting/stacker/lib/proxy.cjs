const http = require('http')
const httpProxy = require('http-proxy')

class LocalProxy {
  constructor(store, preferredPort = 4180) {
    this.store = store
    this.port = preferredPort
    this.routes = new Map()
    this.serviceLinks = new Map()
    this.proxy = httpProxy.createProxyServer({ ws: true, xfwd: true, changeOrigin: false })
    this.proxy.on('error', (error, request, response) => {
      if (response?.writeHead) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(`Stacker could not reach this project.\n\n${error.message}`)
      }
    })
    this.server = null
  }

  targetFor(request) {
    const hostname = String(request.headers.host || '').split(':')[0].toLowerCase()
    const route = this.routes.get(hostname)
    if (!route) return null
    const servicePath = String(request.url || '').match(/^\/__frameui_services\/([^/]+)(\/.*)?$/)
    if (servicePath) {
      let serviceId
      try { serviceId = decodeURIComponent(servicePath[1]) } catch { return null }
      if (!this.serviceLinks.get(route.projectId)?.has(serviceId)) return null
      const service = [...this.routes.values()].find(item=>item.projectId===serviceId)
      if (!service) return null
      request.url = servicePath[2] || '/'
      return `http://127.0.0.1:${service.port}`
    }
    const apiRequest = request.url === '/api' || String(request.url || '').startsWith('/api/')
    return `http://127.0.0.1:${apiRequest && route.apiPort ? route.apiPort : route.port}`
  }

  async start() {
    if (this.server) return this.port
    this.server = http.createServer((request, response) => {
      const target = this.targetFor(request)
      if (!target) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('No running Stacker project matches this local domain.')
        return
      }
      this.proxy.web(request, response, { target })
    })
    this.server.on('upgrade', (request, socket, head) => {
      const target = this.targetFor(request)
      if (target) this.proxy.ws(request, socket, head, { target })
      else socket.destroy()
    })
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', resolve)
    })
    this.port = this.server.address().port
    return this.port
  }

  register(projectId, hostname, port, apiPort = null) {
    this.routes.set(hostname.toLowerCase(), { projectId, port, apiPort })
  }

  connectServices(projectId,serviceIds) { this.serviceLinks.set(projectId,new Set(serviceIds)) }

  unregister(projectId) {
    for (const [hostname, route] of this.routes) if (route.projectId === projectId) this.routes.delete(hostname)
  }

  stop() {
    if (this.server) this.server.close()
    this.server = null
    this.routes.clear(); this.serviceLinks.clear()
  }
}

module.exports = { LocalProxy }
