/* The Vercel link lives at the repository root because the CLI is run from there while the project's
   Root Directory is set remotely. A service-local link is still a supported topology, so both
   locations are read; when both exist they must describe the same project rather than one silently
   winning. Root Directory is remote configuration that no link file records, so it is reported as
   expected and never as verified. Classification is pure so it can be tested without a link. */

export const CANONICAL_PROJECT_NAME = "j3w1ctl-auth";
export const EXPECTED_ROOT_DIRECTORY = "services/j3w1ctl-auth";

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/* candidates: ordered [{ location, raw }] where raw is the file text, or null when it is absent. */
export const classifyVercelLink = (candidates) => {
  const present = candidates.filter(({ raw }) => typeof raw === "string");
  if (!present.length) return { status: "SKIP", detail: "no Vercel link exists at either location; none was created" };

  const links = [];
  for (const { location, raw } of present) {
    let project;
    try {
      project = JSON.parse(raw);
    } catch {
      return { status: "FAIL", detail: `the Vercel link at ${location} is not valid JSON` };
    }
    if (!project || typeof project !== "object" || Array.isArray(project)) return { status: "FAIL", detail: `the Vercel link at ${location} is not an object` };
    const projectId = text(project.projectId);
    const orgId = text(project.orgId);
    if (!projectId || !orgId) return { status: "FAIL", detail: `linked project identifiers are incomplete at ${location}` };
    const projectName = text(project.projectName);
    if (projectName && projectName !== CANONICAL_PROJECT_NAME) return { status: "FAIL", detail: `${location} links the Vercel project ${projectName}, not ${CANONICAL_PROJECT_NAME}` };
    links.push({ location, projectId, orgId });
  }

  /* Identity is the project and organization pair; projectName is a label and is absent from older
     link files, so it is validated above rather than compared here. */
  const [first, ...rest] = links;
  const conflict = rest.find(({ projectId, orgId }) => projectId !== first.projectId || orgId !== first.orgId);
  if (conflict) return { status: "FAIL", detail: `the Vercel links at ${first.location} and ${conflict.location} describe different projects` };

  return {
    status: "PASS",
    detail: { locations: links.map(({ location }) => location), projectId: first.projectId, orgId: first.orgId, expectedRootDirectory: EXPECTED_ROOT_DIRECTORY },
  };
};
