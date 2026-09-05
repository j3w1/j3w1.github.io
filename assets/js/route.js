/* Hash routes, normalised in one place.

   The desktop's routes are #<workspace> and #<collection>/<slug>. Links arrive
   in every shape people and tools produce — #/Writing/Slug/, #writing/slug.html,
   a trailing slash from the 404 rescue — and all of them should land on the
   same entry rather than on an empty reader. */

export const WORKSPACES = Object.freeze(["home", "writing", "projects", "photography", "books", "elsewhere", "about"]);

export const parseRoute = (hash) => {
  let value = String(hash ?? "");
  try {
    value = decodeURIComponent(value);
  } catch {
    /* a malformed escape is treated as literal text */
  }
  value = value.replace(/^#/, "").trim().toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.html?$/, "");
  const [workspace = "", slug = ""] = value.split("/");
  return {
    workspace: WORKSPACES.includes(workspace) ? workspace : null,
    slug: slug || null,
  };
};
