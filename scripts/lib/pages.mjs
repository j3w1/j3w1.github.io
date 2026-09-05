/* The content index, prerendered entry pages, sitemap and feed. The generator
   itself lives with the content compiler in the backend package (it is also
   what the Vercel function runs when a browser publish commits), so this is
   only the root-level registration. Node resolves markdown-it and yaml from
   that package; the root package stays dependency-free. */

import { checkGenerated, writeGenerated } from "../../services/j3w1ctl-auth/src/generate.js";

export const pagesGenerator = {
  name: "content index, pages, sitemap and feed",
  async run({ repoRoot, check }) {
    if (check) {
      const result = await checkGenerated(repoRoot);
      if (!result.ok) {
        throw new Error(`stale: ${[...result.stale, ...result.orphans.map((file) => `${file} (orphan)`)].join(", ")} — run npm run generate`);
      }
      return "current";
    }
    const { written, removed } = await writeGenerated(repoRoot);
    return `${written.length} written, ${removed.length} removed`;
  },
};
