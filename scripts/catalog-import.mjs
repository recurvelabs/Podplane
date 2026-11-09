// Prepare the same metadata-only batch used by the authenticated import route.
// Apply its output with the D1 query API; this never downloads episode audio.
import fs from 'node:fs/promises';
import {catalogImportSQL,catalogImportParams} from '../processor/catalog.js';
const source=process.argv[2]||new URL('../processor/data/us-top-podcasts.json',import.meta.url);
const snapshot=JSON.parse(await fs.readFile(source,'utf8'));
if(snapshot.country!=='US'||snapshot.podcasts?.length!==200)throw Error('Expected the US top 200 snapshot');
const timestamp=Math.floor(Date.parse(snapshot.updated_at)/1000);
const entries=await Promise.all(snapshot.podcasts.map(item=>catalogImportParams(item,timestamp)));
console.log(JSON.stringify({batch:[{sql:'UPDATE podcasts SET chart_rank=NULL,chart_updated_at=NULL WHERE chart_rank IS NOT NULL'},...entries.map(params=>({sql:catalogImportSQL,params}))]}));
