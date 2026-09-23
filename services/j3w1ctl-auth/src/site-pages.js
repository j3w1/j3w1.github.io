/* The prerendered pages, sitemap and feed, generated from the content index.

   Every published entry lives in the desktop at a hash route — #writing/<slug>
   — which no crawler and no link preview can see. So each entry also gets a
   real page at /writing/<slug>/ with its content as HTML, full metadata, and a
   link back into the workstation. Those pages are the canonical URLs: a
   redirect to the hash route would collapse every entry into "/" for a
   crawler, which is the duplicate-content failure this exists to avoid.

   Everything here is a pure function of the index. No clock, no git, no
   filesystem: the same index must produce the same bytes whether the
   generator runs from the CLI or inside the Vercel function that commits a
   browser publish, or the two would drift. */

import { COLLECTIONS, SLUG_PATTERN, assertCollection } from "./content.js";
import { escapeAttribute, escapeText, renderAstHtml } from "./html-renderer.js";

/* The site's identity, mirrored from content/site.json: this package is
   deployed on its own and cannot read the repository, so the root generator
   checks that the two agree (`npm run check`). */
export const SITE_ORIGIN = "https://j3w1.github.io";
export const SITE_NAME = "j3w1";
export const AUTHOR = { name: "申杰", alternateName: "j3w1", url: `${SITE_ORIGIN}/`, github: "https://github.com/j3w1" };
export const DEFAULT_SOCIAL_IMAGE = `${SITE_ORIGIN}/assets/social/default.png`;
/* The theme's canvas, which the browser chrome is asked to match. */
export const THEME_COLOR = "#000000";
/* The shared stylesheet with its cache token: a literal, because
   scripts/bump-cache-token rewrites it with the rest of the shell. */
export const STYLESHEET = "/assets/css/site.css?v=20260923";
export const FEED_PATH = "feed.xml";
export const SITEMAP_PATH = "sitemap.xml";
export const GENERATED_PAGE_PATTERN = /^(writing|books|photography)\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?index\.html$/;

const COLLECTION_TITLES = { writing: "writing", books: "books", photography: "photography" };
const COLLECTION_BLURBS = {
  writing: "Essays and notes, published from the workstation.",
  books: "Reading notes: what was read, when, and what stayed.",
  photography: "Photographs, with the story behind each set.",
};

export const entryPagePath = (collection, slug) => {
  assertCollection(collection);
  if (!SLUG_PATTERN.test(slug)) throw new TypeError(`invalid slug ${slug}`);
  return `${collection}/${slug}/index.html`;
};

export const entryUrl = (collection, slug) => `${SITE_ORIGIN}/${collection}/${slug}/`;
export const collectionUrl = (collection) => `${SITE_ORIGIN}/${collection}/`;

const text = escapeText;
const attr = escapeAttribute;

/* JSON inside a <script> must not be able to close the element. */
const jsonLd = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const entryDate = (collection, entry) =>
  collection === "books" ? entry.finished ?? entry.started ?? null : entry.date ?? null;

const entryDescription = (collection, entry) => {
  if (collection === "writing") return entry.summary;
  if (collection === "photography") return entry.caption;
  return `${entry.author} · ${entry.year} · ${entry.status}`;
};

/* The line under an entry's title. The desktop reader (assets/js/public-content.js)
   draws the same line; test/browser/prerender.spec.js holds the two equal. */
const entryMetaLine = (collection, entry) => {
  if (collection === "writing") return [entry.date, ...(entry.tags ?? [])].filter(Boolean).join(" · ");
  if (collection === "photography") return [entry.date, entry.location, entry.camera].filter(Boolean).join(" · ");
  return [entry.author, entry.year, entry.status, entry.rating ? `${entry.rating}/5` : null].filter(Boolean).join(" · ");
};

const socialImage = (collection, entry) =>
  collection === "photography" && entry.images?.[0] ? `${SITE_ORIGIN}${entry.images[0].src}` : DEFAULT_SOCIAL_IMAGE;

const person = () => ({ "@type": "Person", name: AUTHOR.name, alternateName: AUTHOR.alternateName, url: AUTHOR.url, sameAs: [AUTHOR.github] });

const entryJsonLd = (collection, entry) => {
  const url = entryUrl(collection, entry.slug);
  const common = {
    "@context": "https://schema.org",
    headline: entry.title,
    url,
    mainEntityOfPage: url,
    author: person(),
    inLanguage: "en",
    image: socialImage(collection, entry),
  };
  if (collection === "writing") {
    return { "@type": "Article", ...common, datePublished: entry.date, description: entry.summary, ...(entry.tags?.length ? { keywords: entry.tags.join(", ") } : {}) };
  }
  if (collection === "books") {
    return {
      "@type": "Article",
      ...common,
      ...(entryDate(collection, entry) ? { datePublished: entryDate(collection, entry) } : {}),
      description: entryDescription(collection, entry),
      about: { "@type": "Book", name: entry.title, author: { "@type": "Person", name: entry.author }, datePublished: String(entry.year) },
      ...(entry.rating ? { reviewRating: { "@type": "Rating", ratingValue: entry.rating, bestRating: 5 } } : {}),
    };
  }
  return {
    "@type": "ImageGallery",
    ...common,
    datePublished: entry.date,
    description: entry.caption,
    ...(entry.location ? { contentLocation: { "@type": "Place", name: entry.location } } : {}),
    image: entry.images.map((image) => ({
      "@type": "ImageObject",
      contentUrl: `${SITE_ORIGIN}${image.src}`,
      thumbnail: `${SITE_ORIGIN}${image.thumbnailSrc}`,
      name: image.alt,
      ...(image.caption ? { caption: image.caption } : {}),
      ...(image.width && image.height ? { width: image.width, height: image.height } : {}),
    })),
  };
};

/* The head lines every page of the site shares, from index.html to the
   generated entry pages: the feed, the browser colour, the icons, the manifest
   and the stylesheet. The site generator writes this same block into the
   static pages. */
export const renderSharedHead = () => [
  `<link rel="alternate" type="application/atom+xml" title="${SITE_NAME}" href="/${FEED_PATH}">`,
  `<meta name="theme-color" content="${THEME_COLOR}">`,
  `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
  `<link rel="icon" href="/favicon.ico" sizes="32x32">`,
  `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
  `<link rel="manifest" href="/site.webmanifest">`,
  `<link rel="stylesheet" href="${STYLESHEET}">`,
].map((line) => `  ${line}`).join("\n");

const head = ({ title, description, canonical, ogType, image, published, noindex = false, ldJson }) => `<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${text(title)} — ${SITE_NAME}</title>
  <meta name="description" content="${attr(description)}">
${noindex ? '  <meta name="robots" content="noindex">\n' : ""}  <link rel="canonical" href="${attr(canonical)}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${attr(canonical)}">
  <meta property="og:image" content="${attr(image)}">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${attr(title)}">
  <meta name="twitter:description" content="${attr(description)}">
  <meta name="twitter:image" content="${attr(image)}">
${published ? `  <meta property="article:published_time" content="${attr(published)}">\n` : ""}${renderSharedHead()}
${ldJson ? `  <script type="application/ld+json">${jsonLd(ldJson)}</script>\n` : ""}</head>`;

/* The static pages' bar and footer, shared with the wiki and 404 through the
   site generator. */
export const renderPageBar = ({ crumbs, desktopHref }) => `  <header class="page-bar">
    <nav aria-label="Site navigation">
      <a href="/#home">← workstation</a>
${crumbs.map(({ href, label, here }) => `      <span aria-hidden="true">/</span> ${here ? `<span class="is-here" aria-current="page">${text(label)}</span>` : `<a href="${attr(href)}">${text(label)}</a>`}`).join("\n")}
    </nav>
    <span class="spacer"></span>
    <a class="desktop-link" data-desktop-link href="${attr(desktopHref)}">open in the workstation ↗</a>
  </header>`;

export const renderPageFoot = () => `  <footer class="page-foot page-wrap">
    <p><span lang="zh">${text(AUTHOR.name)}</span> / ${text(AUTHOR.alternateName)} · <a href="/${FEED_PATH}">feed</a> · <a href="${attr(AUTHOR.github)}" rel="me">GitHub</a> · <a href="/wiki/">wiki</a></p>
  </footer>`;

/* The page grid is at most three 280px columns inside an 880px column, and one
   full-width column on a phone. */
const PAGE_PHOTO_SIZES = "(max-width: 640px) calc(100vw - 32px), 280px";

const photographyBody = (entry) => {
  const figures = entry.images.map((image) => {
    const size = image.thumbnailWidth && image.thumbnailHeight ? ` width="${image.thumbnailWidth}" height="${image.thumbnailHeight}"` : "";
    const srcset = image.width && image.thumbnailWidth
      ? ` srcset="${attr(`${image.thumbnailSrc} ${image.thumbnailWidth}w, ${image.src} ${image.width}w`)}" sizes="${PAGE_PHOTO_SIZES}"`
      : "";
    const caption = image.caption ? `<figcaption>${text(image.caption)}</figcaption>` : "";
    return `        <figure class="photo-thumb"><a href="${attr(image.src)}"><img src="${attr(image.thumbnailSrc)}" alt="${attr(image.alt)}"${size}${srcset} loading="lazy" decoding="async"></a>${caption}</figure>`;
  });
  return `      <p class="photo-caption">${text(entry.caption)}</p>
      <div class="photo-grid">
${figures.join("\n")}
      </div>`;
};

export const renderEntryPage = (collection, entry) => {
  assertCollection(collection);
  const canonical = entryUrl(collection, entry.slug);
  const desktopHref = `/#${collection}/${entry.slug}`;
  const body = collection === "photography"
    ? photographyBody(entry)
    : `      <div class="rendered-content">${renderAstHtml(collection === "writing" ? entry.blocks : entry.notes, { origin: SITE_ORIGIN })}</div>`;
  return `${head({
    title: entry.title,
    description: entryDescription(collection, entry),
    canonical,
    ogType: "article",
    image: socialImage(collection, entry),
    published: entryDate(collection, entry),
    ldJson: entryJsonLd(collection, entry),
  })}
<body class="page">
  <a class="skip-link" href="#entry">Skip to the entry</a>
${renderPageBar({ crumbs: [{ href: collectionUrl(collection), label: COLLECTION_TITLES[collection] }, { label: entry.slug, here: true }], desktopHref })}
  <main class="page-wrap">
    <article id="entry">
      <header class="content-detail-header">
        <h1>${text(entry.title)}</h1>
        <p class="content-meta">${text(entryMetaLine(collection, entry))}</p>
${collection === "writing" ? `        <p class="content-summary">${text(entry.summary)}</p>\n` : ""}      </header>
${body}
    </article>
    <p class="callout page-desktop">This entry also lives on the desktop: <a data-desktop-link href="${attr(desktopHref)}">open ${text(entry.slug)} in the workstation</a>, a working i3 window manager in the browser.</p>
  </main>
${renderPageFoot()}
</body>
</html>
`;
};

export const renderCollectionPage = (collection, entries) => {
  assertCollection(collection);
  const canonical = collectionUrl(collection);
  const items = entries.map((entry) => `      <li>
        <a href="${attr(entryUrl(collection, entry.slug))}">${text(entry.title)}</a>
        <span class="content-meta">${text(entryMetaLine(collection, entry))}</span>
        <p>${text(entryDescription(collection, entry))}</p>
      </li>`);
  return `${head({
    title: COLLECTION_TITLES[collection],
    description: COLLECTION_BLURBS[collection],
    canonical,
    ogType: "website",
    image: DEFAULT_SOCIAL_IMAGE,
    noindex: entries.length === 0,
    ldJson: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${COLLECTION_TITLES[collection]} — ${SITE_NAME}`,
      url: canonical,
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
      author: person(),
    },
  })}
<body class="page">
  <a class="skip-link" href="#entries">Skip to the entries</a>
${renderPageBar({ crumbs: [{ label: COLLECTION_TITLES[collection], here: true }], desktopHref: `/#${collection}` })}
  <main class="page-wrap">
    <header class="content-detail-header">
      <h1>${text(COLLECTION_TITLES[collection])}</h1>
      <p class="content-meta">${text(COLLECTION_BLURBS[collection])}</p>
    </header>
    <ul id="entries" class="entry-list">
${items.length ? items.join("\n") : "      <li><p>Nothing published here yet.</p></li>"}
    </ul>
    <p class="callout page-desktop">The same entries open on the desktop: <a data-desktop-link href="/#${collection}">open ${text(collection)} in the workstation</a>.</p>
  </main>
${renderPageFoot()}
</body>
</html>
`;
};

const xmlText = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const renderSitemap = (index) => {
  const urls = [{ loc: `${SITE_ORIGIN}/` }, { loc: `${SITE_ORIGIN}/wiki/` }];
  for (const collection of COLLECTIONS) {
    const entries = index.collections[collection];
    if (!entries.length) continue;
    const dates = entries.map((entry) => entryDate(collection, entry)).filter(Boolean).sort();
    urls.push({ loc: collectionUrl(collection), lastmod: dates.at(-1) });
    for (const entry of entries) urls.push({ loc: entryUrl(collection, entry.slug), lastmod: entryDate(collection, entry) });
  }
  const body = urls.map(({ loc, lastmod }) =>
    `  <url>\n    <loc>${xmlText(loc)}</loc>\n${lastmod ? `    <lastmod>${xmlText(lastmod)}</lastmod>\n` : ""}  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
};

const FEED_LIMIT = 50;

export const renderFeed = (index) => {
  const items = [];
  for (const collection of COLLECTIONS) {
    for (const entry of index.collections[collection]) {
      const date = entryDate(collection, entry);
      if (!date) continue;
      items.push({ collection, entry, date });
    }
  }
  items.sort((left, right) => right.date.localeCompare(left.date) || left.entry.slug.localeCompare(right.entry.slug));
  const latest = items[0]?.date ?? "1970-01-01";
  const entries = items.slice(0, FEED_LIMIT).map(({ collection, entry, date }) => {
    const url = entryUrl(collection, entry.slug);
    const content = collection === "photography"
      ? `<p>${text(entry.caption)}</p>${entry.images.map((image) => `<figure><img src="${attr(`${SITE_ORIGIN}${image.thumbnailSrc}`)}" alt="${attr(image.alt)}">${image.caption ? `<figcaption>${text(image.caption)}</figcaption>` : ""}</figure>`).join("")}`
      : renderAstHtml(collection === "writing" ? entry.blocks : entry.notes, { origin: SITE_ORIGIN });
    return `  <entry>
    <title>${xmlText(entry.title)}</title>
    <id>${xmlText(url)}</id>
    <link rel="alternate" type="text/html" href="${xmlText(url)}"/>
    <published>${date}T00:00:00Z</published>
    <updated>${date}T00:00:00Z</updated>
    <category term="${xmlText(collection)}"/>
    <summary>${xmlText(entryDescription(collection, entry))}</summary>
    <content type="html">${xmlText(content)}</content>
  </entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${SITE_NAME}</title>
  <subtitle>Writing, reading notes and photographs from the workstation of ${xmlText(AUTHOR.name)} / ${AUTHOR.alternateName}.</subtitle>
  <id>${SITE_ORIGIN}/</id>
  <link rel="alternate" type="text/html" href="${SITE_ORIGIN}/"/>
  <link rel="self" type="application/atom+xml" href="${SITE_ORIGIN}/${FEED_PATH}"/>
  <updated>${latest}T00:00:00Z</updated>
  <author><name>${xmlText(AUTHOR.name)}</name><uri>${AUTHOR.url}</uri></author>
${entries.join("\n")}
</feed>
`;
};

/* Every generated file for an index, keyed by repository path, sorted. */
export const generateSitePages = (index) => {
  const files = new Map();
  for (const collection of COLLECTIONS) {
    const entries = index.collections[collection] ?? [];
    files.set(`${collection}/index.html`, renderCollectionPage(collection, entries));
    for (const entry of entries) files.set(entryPagePath(collection, entry.slug), renderEntryPage(collection, entry));
  }
  files.set(SITEMAP_PATH, renderSitemap(index));
  files.set(FEED_PATH, renderFeed(index));
  return new Map([...files].sort(([left], [right]) => left.localeCompare(right)));
};
