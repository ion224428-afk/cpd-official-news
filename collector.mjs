export function markOfficialNewsSeen(previousIds, items) {
    return [...new Set([...previousIds, ...items.map(item => item.id)])].slice(-150);
}
export function unreadOfficialNewsCount(items, seenIds) {
    const seen = new Set(seenIds);
    return items.filter(item => !seen.has(item.id)).length;
}
const FMCSA_NEWS_URL = "https://www.fmcsa.dot.gov/newsroom/press-releases";
const AMAZON_RELAY_RSS_URL = "https://relay.amazon.com/blog.rss";
function decodeHtml(value) {
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, token) => {
        const key = token.toLowerCase();
        if (key === "amp")
            return "&";
        if (key === "lt")
            return "<";
        if (key === "gt")
            return ">";
        if (key === "quot")
            return '"';
        if (key === "apos")
            return "'";
        if (key === "nbsp")
            return " ";
        const point = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    });
}
function plainText(value) {
    return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function absoluteOfficialUrl(path, base, hosts) {
    try {
        const url = new URL(decodeHtml(path), base);
        return url.protocol === "https:" && hosts.includes(url.hostname) ? url.toString() : null;
    }
    catch {
        return null;
    }
}
function parsedDate(value) {
    const text = plainText(value);
    const dateOnly = text.match(/^((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})$/i);
    const date = new Date(dateOnly ? `${dateOnly[1]} 00:00 UTC` : text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function extractOfficialArticleText(html) {
    const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
        || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
        || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
        || html;
    return plainText(article.replace(/<(script|style|svg|nav|header|footer|aside|form|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)\b[^>]*>/gi, " ")).replace(/\s+/g, " ").trim().slice(0, 7000);
}
export function parseFmcsaNews(html) {
    const items = [], seen = new Set();
    const links = /<a\b[^>]*href\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(links)) {
        const href = match[2];
        if (!/^\/newsroom\/(?:press-releases\/)?[^/?#]+(?:[?#].*)?$/i.test(href) || /^\/newsroom\/(?:press-releases|rss|testimony|events|news)(?:[?#].*)?$/i.test(href))
            continue;
        const url = absoluteOfficialUrl(href, FMCSA_NEWS_URL, ["www.fmcsa.dot.gov"]);
        const title = plainText(match[3]);
        if (!url || title.length < 12 || /^(?:news archive|press releases|newsroom)$/i.test(title) || seen.has(url))
            continue;
        seen.add(url);
        const linkIndex = match.index || 0, rowTag = html.lastIndexOf("views-row", linkIndex), rowStart = rowTag >= 0 ? html.lastIndexOf("<div", rowTag) : Math.max(0, linkIndex - 500);
        const nextRowTag = html.indexOf("views-row", linkIndex + match[0].length), rowEnd = nextRowTag >= 0 ? html.lastIndexOf("<div", nextRowTag) : Math.min(html.length, linkIndex + match[0].length + 1800);
        const row = html.slice(Math.max(0, rowStart), rowEnd > linkIndex ? rowEnd : Math.min(html.length, linkIndex + match[0].length + 1800));
        const dateMatch = row.match(/datetime\s*=\s*(["'])(20\d{2}-\d{2}-\d{2})[^"']*\1/i) || row.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}/i);
        const publishedText = typeof dateMatch?.[2] === "string" ? dateMatch[2] : dateMatch?.[0] || "";
        let summary = plainText(row.slice(linkIndex - Math.max(0, rowStart) + match[0].length)).replace(/^\d{4}-\d{2}-\d{2}\s*/, "").replace(/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\s*/i, "").replace(/^FOR IMMEDIATE RELEASE\s*/i, "").trim();
        if (summary === title)
            summary = "";
        items.push({ id: `fmcsa:${url}`, source: "FMCSA", title, summary: summary.slice(0, 360), url, publishedAt: publishedText ? parsedDate(publishedText) : null });
        if (items.length >= 8)
            break;
    }
    return items;
}
export function parseAmazonRelayRss(xml) {
    const items = [];
    for (const match of xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)) {
        const block = match[1];
        const title = plainText(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
        const linkMatch = block.match(/<link\b[^>]*href\s*=\s*(["'])([^"']+)\1[^>]*\/?\s*>/i);
        const rawLink = linkMatch?.[2] || block.match(/<link\b[^>]*>([\s\S]*?)(?:<\/link>|(?=<\/?(?:description|pubdate|published|updated|guid)\b|<\/item>))/i)?.[1] || "";
        const url = absoluteOfficialUrl(rawLink.trim(), AMAZON_RELAY_RSS_URL, ["relay.amazon.com"]);
        if (!title || !url)
            continue;
        const date = block.match(/<(?:pubDate|published|updated|dc:date)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i)?.[1] || "";
        const description = block.match(/<(?:description|summary|content:encoded)\b[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded)>/i)?.[1] || "";
        items.push({ id: `relay:${url}`, source: "Amazon Relay", title, summary: plainText(description).slice(0, 360), url, publishedAt: parsedDate(date) });
        if (items.length >= 8)
            break;
    }
    return items;
}
async function fetchText(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(15000)});
  if (response.ok) {
    const text=await response.text();
    if (text.length>1500000) throw new Error('Official response exceeded limit');
    return text;
  }
  if (response.status!==403) throw new Error('Official source returned '+response.status);
  const {execFileSync}=await import('node:child_process');
  try {
    const text=execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','20',url],{encoding:'utf8',maxBuffer:1500000});
    if (text.length>1500000) throw new Error('Official response exceeded limit');
    console.log('Official source accessible with system HTTP client.');
    return text;
  } catch {}
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();
    const result=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    if (!result?.ok()) throw new Error('Official browser source returned '+result?.status());
    const text=await page.content();
    if (text.length>1500000) throw new Error('Official response exceeded limit');
    console.log('Official source accessible in browser.');
    return text;
  } finally {await browser.close();}
}
export async function getOfficialNews() {
    const [fmcsa, relay] = await Promise.allSettled([fetchText(FMCSA_NEWS_URL), fetchText(AMAZON_RELAY_RSS_URL)]);
    const items = [
        ...(fmcsa.status === "fulfilled" ? parseFmcsaNews(fmcsa.value) : []),
        ...(relay.status === "fulfilled" ? parseAmazonRelayRss(relay.value) : []),
    ].sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0)).slice(0, 8);
    const articleResults = await Promise.allSettled(items.map(item => fetchText(item.url)));
    for (let i = 0; i < items.length; i++) {
        const result = articleResults[i];
        if (result.status === "fulfilled")
            items[i].sourceText = extractOfficialArticleText(result.value);
    }
    const sourceErrors = [];
    if (fmcsa.status === "rejected" || (fmcsa.status === "fulfilled" && !items.some(item => item.source === "FMCSA")))
        sourceErrors.push("FMCSA");
    if (relay.status === "rejected" || (relay.status === "fulfilled" && !items.some(item => item.source === "Amazon Relay")))
        sourceErrors.push("Amazon Relay");
    return { items, sourceErrors, updatedAt: new Date().toISOString() };
}

const response = await fetchText(FMCSA_NEWS_URL);
const articles = parseFmcsaNews(response).filter(item => item.publishedAt).slice(0, 8);
if (!articles.length) throw new Error('No dated official FMCSA articles; previous feed preserved.');
for (const article of articles) {
  article.sourceText = extractOfficialArticleText(await fetchText(article.url));
  if (article.sourceText.length < 150) throw new Error('Incomplete article; previous feed preserved.');
}
const snapshot = {version:1,source:'FMCSA',checkedAt:new Date().toISOString(),items:articles};
const {writeFile,rename} = await import('node:fs/promises');
await writeFile('fmcsa-news.json.tmp', JSON.stringify(snapshot,null,2)+'\n');
await rename('fmcsa-news.json.tmp','fmcsa-news.json');
console.log('Verified official FMCSA articles:',articles.length);

