# j3w1 public content

Files in `writing/`, `books/`, and `photography/` are public source material. A
file in one of those directories is published content; private drafts belong in
j3w1ctl's local browser storage, not in this public repository.

## Add content manually

From the repository root:

```powershell
npm --prefix services/j3w1ctl-auth ci
npm --prefix services/j3w1ctl-auth run content:new -- --repo-root ../.. --collection writing --slug my-entry
npm --prefix services/j3w1ctl-auth run content:validate -- --repo-root ../..
npm --prefix services/j3w1ctl-auth run content:rebuild -- --repo-root ../..
```

Use `books` or `photography` in place of `writing`. The `content:new` command
copies a documented template and refuses to overwrite an existing entry.

In j3w1ctl, select ordinary JPG, JPEG, PNG, or WebP photographs. The browser automatically removes the need for manual conversion by generating the optimized public pair below; original source files are not committed:

```text
assets/photography/<entry-slug>/<image-id>.webp
assets/photography/<entry-slug>/<image-id>-thumb.webp
```

The full WebP is the bounded public photograph used by the viewer. The thumbnail WebP is the smaller list/grid image. When maintaining content without j3w1ctl, both normalized files must already exist before rebuilding the index.

`content:rebuild` writes every generated file: `assets/data/content-index.json`, the prerendered
entry and collection pages (`writing/<slug>/index.html`, `writing/index.html`, …), `sitemap.xml`
and `feed.xml`. From the repository root, `npm run generate` does the same (plus fonts and the
module preload list) and `npm run check` verifies it all.

Run `content:check` (or `npm run check`) before committing. It validates schemas, media paths and
sizes, and confirms that every generated file matches the authoritative Markdown — a stale page,
a missing one, or a page whose entry was deleted all fail it. Never edit generated files by hand.

## Publication rules

- Slugs use lowercase letters, numbers, and single hyphens, are at most 80 characters, and never change after first publication.
- Writing requires `title`, `slug`, `date`, `summary`, and a Markdown body; `tags` is optional.
- Books require `title`, `slug`, `author`, `year`, `status`, and Markdown notes. Status is `want-to-read`, `reading`, `finished`, or `abandoned`; rating, dates, and tags are optional.
- Photography requires `title`, `slug`, `date`, `caption`, and an ordered image list. Location, camera, and per-image captions are optional; every image requires an ID, derived full/thumbnail filename, and meaningful alt text. Pixel dimensions (`width`/`height` for the full file, `thumbnailWidth`/`thumbnailHeight` for the thumbnail) are optional but strongly recommended: with them both the desktop grid and the entry's own page reserve each image's real box before it loads and serve the right file via `srcset`; j3w1ctl records them automatically.
- An entry may contain at most 12 photograph pairs. Full files are limited to 2 MiB, thumbnails to 256 KiB, and the entry to 28 MiB total. The validator reads each RIFF/WEBP signature rather than trusting its name.
- Markdown is limited to headings, paragraphs, lists, blockquotes, code blocks, text, emphasis, strong text, inline code, and safe links. Raw HTML is not rendered.

## Site identity and projects

`content/site.json` holds everything the desktop says about its owner: the name and role, the
descriptions used in the page head and JSON-LD, the home terminal's README and focus lines, the
projects table, the elsewhere links, and the about and interests buffers. `npm run generate` writes
them into the marked `@generated-site` regions of `index.html` (and the shared head, bar and footer
into `wiki/index.html` and `404.html`); never edit inside those markers by hand.

- Counts are derived: the project and link totals, the filter counts, `ls -l`'s total, the Vim line
  numbers and cursor. Add or remove an entry and every count follows.
- A project is `public` with an https `repository`, or `internal` with `repository: null`; `facts`
  are `[label, value]` pairs, and an https value renders as a link. `projects.selected` is the row
  selected on load.
- About paragraphs may contain `[label](href)` links to https or site-absolute URLs; every other
  string is plain text.
- The generator refuses unknown keys, duplicate ids, non-https URLs, and a `selected` that names no
  project, and `npm run check` fails when `site.webmanifest` or the page generator's constants in
  `services/j3w1ctl-auth/src/site-pages.js` disagree with the data.
- `npm run icons` re-renders the social card from the same data.
