// Isolated HTTP CSP Report-Only experiment for the staged public site.
// Deliberately does not enforce restrictions or send reports to production.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const CSP_REPORT_ONLY=[
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "report-uri /__csp-report"
].join('; ');

const TYPES={
  '.html':'text/html; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.xml':'application/xml; charset=utf-8',
  '.txt':'text/plain; charset=utf-8',
  '.svg':'image/svg+xml',
  '.woff2':'font/woff2',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.gz':'application/gzip'
};

export function sanitizeCspReport(payload){
  const body=payload?.['csp-report']||payload?.body||payload;
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const directive=String(body['effective-directive']||body.effectiveDirective||
    body['violated-directive']||body.violatedDirective||'unknown')
    .toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,40)||'unknown';
  let blocked=String(body['blocked-uri']||body.blockedURL||body.blockedUri||'unknown');
  if(['inline','eval','wasm-eval','unknown','self'].includes(blocked))return {directive,blocked,route:'site'};
  try{
    const url=new URL(blocked);
    // Retain only the origin; report-uri may otherwise contain auth tokens,
    // usernames, query parameters or private document paths.
    blocked=['http:','https:'].includes(url.protocol)?
      (url.hostname==='127.0.0.1'?'self':url.origin):url.protocol.replace(':','');
  }catch{blocked='other';}
  return {directive,blocked:blocked.slice(0,180),route:'site'};
}

export function createCspPreviewServer({directory}){
  const root=resolve(directory),violations=new Map();
  const send=(res,status,body,contentType='text/plain; charset=utf-8')=>{
    res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store'});
    res.end(body);
  };
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/', 'http://127.0.0.1');
      const pathname=url.pathname;
      if(pathname==='/__csp-report'){
        if(req.method!=='POST'){send(res,405,'Method not allowed');return;}
        let bytes=0;const chunks=[];
        for await(const chunk of req){
          bytes+=chunk.length;
          if(bytes>16384){send(res,413,'Report too large');return;}
          chunks.push(chunk);
        }
        let report=null;
        try{report=sanitizeCspReport(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{}
        if(report){
          const key=JSON.stringify(report);
          violations.set(key,(violations.get(key)||0)+1);
        }
        res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;
      }
      if(pathname==='/__csp-summary'){
        if(req.method!=='GET'){send(res,405,'Method not allowed');return;}
        const aggregate=[...violations].map(([key,count])=>({...JSON.parse(key),count}));
        aggregate.sort((a,b)=>b.count-a.count||a.directive.localeCompare(b.directive));
        send(res,200,JSON.stringify({total:aggregate.reduce((n,x)=>n+x.count,0),aggregate},null,2)+'\n','application/json; charset=utf-8');return;
      }
      if(!['GET','HEAD'].includes(req.method)){send(res,405,'Method not allowed');return;}
      let path;
      try{path=decodeURIComponent(pathname);}catch{send(res,400,'Bad path');return;}
      if(path.includes('\\')||path.includes('\0')||path.split('/').includes('..')){
        send(res,400,'Bad path');return;
      }
      if(path.endsWith('/'))path+='index.html';
      const abs=resolve(root,'.'+path);
      if(!abs.startsWith(root+sep)){send(res,404,'Not found');return;}
      let stat;
      try{stat=await lstat(abs);}catch{send(res,404,'Not found');return;}
      if(!stat.isFile()||stat.isSymbolicLink()){send(res,404,'Not found');return;}
      const type=TYPES[extname(abs)]||
        (path.endsWith('/apple-app-site-association')?'application/json; charset=utf-8':'application/octet-stream');
      const headers={'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      if(type.startsWith('text/html'))headers['Content-Security-Policy-Report-Only']=CSP_REPORT_ONLY;
      res.writeHead(200,headers);
      if(req.method==='HEAD'){res.end();return;}
      createReadStream(abs).on('error',()=>res.destroy()).pipe(res);
    }catch(e){
      if(!res.headersSent)send(res,500,'Local preview error');
      else res.destroy();
    }
  });
  return server;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--dir')throw Error('Usage: node scripts/csp-report-only-preview-server.mjs --dir artifacts/csp-preview');
  const server=createCspPreviewServer({directory:args[1]});
  const port=Number(process.env.CSP_PREVIEW_PORT||4175);
  server.listen(port,'127.0.0.1',()=>console.log('CSP Report-Only preview listening on localhost:'+port));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(e=>{console.error(e);process.exitCode=1;});
}
