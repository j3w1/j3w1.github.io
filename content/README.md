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

Run `content:check` before committing. It validates schemas, media paths and
sizes, and confirms that `assets/data/content-index.json` matches the
authoritative Markdown.

## Publication rules

- Slugs use lowercase letters, numbers, and single hyphens, are at most 80 characters, and never change after first publication.
- Writing requires `title`, `slug`, `date`, `summary`, and a Markdown body; `tags` is optional.
- Books require `title`, `slug`, `author`, `year`, `status`, and Markdown notes. Status is `want-to-read`, `reading`, `finished`, or `abandoned`; rating, dates, and tags are optional.
- Photography requires `title`, `slug`, `date`, `caption`, and an ordered image list. Location, camera, and per-image captions are optional; every image requires an ID, derived full/thumbnail filename, and meaningful alt text.
- An entry may contain at most 12 photograph pairs. Full files are limited to 2 MiB, thumbnails to 256 KiB, and the entry to 28 MiB total. The validator reads each RIFF/WEBP signature rather than trusting its name.
- Markdown is limited to headings, paragraphs, lists, blockquotes, code blocks, text, emphasis, strong text, inline code, and safe links. Raw HTML is not rendered.
