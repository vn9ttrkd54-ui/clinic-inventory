import { cp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { resolve } from 'node:path';
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!url || !/^https:\/\/[^/]+\.supabase\.co$/.test(url) || !key?.startsWith('sb_publishable_'))throw new Error('Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY before building.');
await rm('dist',{recursive:true,force:true});await mkdir('dist');await cp('public','dist',{recursive:true});
await writeFile('dist/runtime.js',`globalThis.CLINIC_CONFIG=${JSON.stringify({url,key})};\n`);
await build({entryPoints:['cloud/client.mjs'],bundle:true,minify:true,platform:'browser',format:'iife',target:['es2022'],outfile:'dist/cloud.js',legalComments:'eof'});
const html=await readFile('dist/index.html','utf8');
await writeFile('dist/index.html',html.replace('<script src="app.js" defer></script>','<script src="runtime.js" defer></script>\n  <script src="cloud.js" defer></script>\n  <script src="app.js" defer></script>'));
const config={
  $schema:'https://openapi.vercel.sh/vercel.json',
  buildCommand:'npm run build',outputDirectory:'dist',installCommand:'npm ci --ignore-scripts',
  rewrites:[{source:'/api/:path*',destination:'/api/index?route=:path*'}],
  functions:{'api/index.mjs':{maxDuration:15,includeFiles:'{inventory.mjs,security.mjs,cloud/service.mjs}'}},
  headers:[{source:'/(.*)',headers:[
    {key:'Cache-Control',value:'no-store'},
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
    {key:'Content-Security-Policy',value:`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${url}; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`}
  ]}]
};
await writeFile(resolve('vercel.json'),JSON.stringify(config,null,2)+'\n');
console.log('Cloud assets built. Only public connection settings are included in browser files.');
