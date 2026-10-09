import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const collector = await readFile(new URL('./collector.mjs',import.meta.url),'utf8');
async function run(blockArticle=false) {
  const folder=await mkdtemp(join(tmpdir(),'cpd-fmcsa-test-'));
  await writeFile(join(folder,'collector.mjs'),collector);
  await writeFile(join(folder,'fmcsa-news.json'),'previous verified feed');
  const listing='<a href="/newsroom/news-archive">News Archive</a><div class="views-row"><time datetime="2026-10-05">October 5, 2026</time><a href="/newsroom/official-release">Official FMCSA safety release</a><p>Official summary.</p></div>';
  const article='<article><h1>Official FMCSA safety release</h1><p>'+('Verified official article text. '.repeat(12))+'</p></article>';
  await writeFile(join(folder,'run.mjs'),`globalThis.fetch=async url=>new Response(url.endsWith('/press-releases')?${JSON.stringify(listing)}:${JSON.stringify(article)},{status:!url.endsWith('/press-releases')&&${blockArticle}?403:200}); await import('./collector.mjs');`);
  const result=spawnSync(process.execPath,['run.mjs'],{cwd:folder,encoding:'utf8'});
  const contents=await readFile(join(folder,'fmcsa-news.json'),'utf8');
  await rm(folder,{recursive:true,force:true});
  return {result,contents};
}
test('collector excludes archive navigation and preserves full official article text',async()=>{
  const {result,contents}=await run();
  assert.equal(result.status,0,result.stderr);
  const snapshot=JSON.parse(contents);
  assert.equal(snapshot.items.length,1);
  assert.equal(snapshot.items[0].source,'FMCSA');
  assert.match(snapshot.items[0].url,/www\.fmcsa\.dot\.gov/);
  assert.ok(snapshot.items[0].sourceText.length>150);
  assert.ok(Number.isFinite(Date.parse(snapshot.checkedAt)));
});
test('blocked article preserves the last successful feed without a partial update',async()=>{
  const {result,contents}=await run(true);
  assert.notEqual(result.status,0);
  assert.equal(contents,'previous verified feed');
});

