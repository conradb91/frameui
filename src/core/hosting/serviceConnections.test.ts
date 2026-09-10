import {test,expect} from 'bun:test'
import http from 'node:http'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {serviceOverrides}=require('../../../hosting/stacker/lib/service-connections.cjs')
const {LocalProxy}=require('../../../hosting/stacker/lib/proxy.cjs')
test('service connections rewrite only unambiguous local API URLs',()=>{
  const services=[{id:'api',preferredPort:5000}]
  expect(serviceOverrides([{key:'VITE_API_URL',value:'http://localhost:5000/api/v1'},{key:'PAYMENT_API_URL',value:'https://payments.example.com/api'},{key:'DATABASE_URL',value:'http://localhost:5000/db'}],services,'http://web.localhost:4181')).toEqual({VITE_API_URL:'http://web.localhost:4181/__frameui_services/api/api/v1'})
  expect(serviceOverrides([{key:'API_URL',value:'http://localhost:5000'}],[...services,{id:'other',preferredPort:5000}],'http://web.localhost:4181')).toEqual({})
})
test('same-origin service routes follow active backend ports and reject unrelated projects',async()=>{
  const backend=http.createServer((req,res)=>res.end('backend '+req.url))
  await new Promise<void>(resolve=>backend.listen(0,'127.0.0.1',resolve))
  const proxy=new LocalProxy({},0)
  try {
    await proxy.start()
    proxy.register('web','web.localhost',1)
    proxy.register('api','api.localhost',(backend.address() as {port:number}).port)
    proxy.connectServices('web',['api'])
    const request=(route:string)=>new Promise<{status:number,body:string}>((resolve,reject)=>{
      http.get({host:'127.0.0.1',port:proxy.port,path:route,headers:{host:'web.localhost'}},response=>{
        let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode!,body}))
      }).on('error',reject)
    })
    expect(await request('/__frameui_services/api/api/budget?year=2026')).toEqual({status:200,body:'backend /api/budget?year=2026'})
    expect((await request('/__frameui_services/unrelated/private')).status).toBe(404)
    proxy.unregister('api')
    expect((await request('/__frameui_services/api/api/budget')).status).toBe(404)
  }finally{proxy.stop();await new Promise<void>(resolve=>backend.close(()=>resolve()))}
})
