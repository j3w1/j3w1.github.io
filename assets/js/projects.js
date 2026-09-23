/* The projects application: the table's visibility filter and text filter, the
   row selection, and the detail window that follows it. The rows themselves
   are generated from content/site.json into index.html; this only wires them.

   installProjects runs once at startup. `onSelect` is how a click on a row's
   number hands focus to the detail window without this module knowing about
   the window manager. */

export const installProjects = ({ onSelect } = {}) => {
  let visibility = "all";

  const selectProject = (projectId) => {
    const row = document.querySelector(`[data-project-row="${projectId}"]`);
    const detail = document.querySelector(`[data-project-detail="${projectId}"]`);
    if (!row || !detail) return;

    document.querySelectorAll("[data-project-row]").forEach((candidate) => {
      candidate.classList.toggle("is-selected", candidate === row);
    });
    document.querySelectorAll(".project-selector").forEach((selector) => {
      selector.setAttribute(
        "aria-pressed",
        String(selector.dataset.project === projectId),
      );
    });
    document.querySelectorAll("[data-project-detail]").forEach((candidate) => {
      candidate.classList.toggle("is-selected", candidate === detail);
    });

    /* Both windows' statuslines report the selection. */
    const name = row.cells[1]?.textContent.trim() ?? projectId;
    document.querySelectorAll("[data-project-selection]").forEach((status) => { status.textContent = name; });
  };

  const applyFilters = () => {
    const query = document.querySelector("#project-filter")?.value.trim().toLowerCase() ?? "";
    const rows = [...document.querySelectorAll("[data-project-row]")];
    rows.forEach((row) => {
      const categoryMatches = visibility === "all" || row.dataset.visibility === visibility;
      const textMatches = !query || row.textContent.toLowerCase().includes(query);
      row.hidden = !(categoryMatches && textMatches);
    });
    const visible = rows.filter((row) => !row.hidden);
    const selectedRow = document.querySelector("[data-project-row].is-selected");
    if (!selectedRow || selectedRow.hidden) {
      if (visible[0]) selectProject(visible[0].dataset.projectRow);
      else {
        document.querySelectorAll("[data-project-row].is-selected, [data-project-detail].is-selected").forEach((node) => node.classList.remove("is-selected"));
        document.querySelectorAll(".project-selector").forEach((button) => button.setAttribute("aria-pressed", "false"));
      }
    }
    const empty = document.querySelector("#project-no-results");
    if (empty) empty.hidden = visible.length > 0;
  };

  document.querySelectorAll("[data-project-count]").forEach((target) => {
    const visibility = target.dataset.projectCount;
    const count = visibility === "all" ? document.querySelectorAll("[data-project-row]").length : document.querySelectorAll(`[data-project-row][data-visibility="${visibility}"]`).length;
    target.textContent = `(${count})`;
  });

  document.querySelectorAll("[data-project-visibility]").forEach((button) => {
    button.addEventListener("click", () => {
      visibility = button.dataset.visibility;
      document.querySelectorAll("[data-project-visibility]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      applyFilters();
    });
  });

  document.querySelectorAll(".project-selector").forEach((selector) => {
    selector.addEventListener("click", () => {
      selectProject(selector.dataset.project);
      onSelect?.();
    });
  });

  document.querySelectorAll("[data-project-row]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      selectProject(row.dataset.projectRow);
    });

    row.addEventListener("focusin", () => {
      selectProject(row.dataset.projectRow);
    });
  });

  document.querySelector("#project-filter")?.addEventListener("input", () => {
    applyFilters();
  });

  return { applyFilters };
};
