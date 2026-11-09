import {build} from '../processor/node_modules/esbuild/lib/main.js';
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url).pathname;
const browser=await build({entryPoints:[root+'processor/passkeys-browser.js'],bundle:true,platform:'browser',format:'esm',write:false,minify:true});
await fs.mkdir(root+'processor/generated',{recursive:true});await fs.writeFile(root+'processor/generated/passkeys.js','export default '+JSON.stringify(browser.outputFiles[0].text)+';\n');
await build({entryPoints:[root+'processor/staging.js'],bundle:true,platform:'neutral',mainFields:['module','main'],format:'esm',external:['cloudflare:workers','node:buffer','node:crypto'],outfile:root+'processor/dist/staging.js',minify:true});
console.log('Built Cloudflare staging worker and passkey browser module.');
