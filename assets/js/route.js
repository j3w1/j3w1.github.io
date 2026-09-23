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

/* One listener for every consumer of the route: the workspace switcher and the
   content reader subscribe here instead of each parsing the hash on its own.
   Handlers run in subscription order, on hashchange and popstate alike; the
   listener is installed on first use, so importing this module stays free of
   side effects (and loadable in node). */
const handlers = new Set();
let listening = false;

export const onRouteChange = (handler) => {
  handlers.add(handler);
  if (!listening) {
    listening = true;
    const dispatch = () => {
      const route = parseRoute(location.hash);
      for (const each of handlers) each(route);
    };
    addEventListener("hashchange", dispatch);
    addEventListener("popstate", dispatch);
  }
  return () => handlers.delete(handler);
};
