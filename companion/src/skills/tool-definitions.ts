export const SKILL_INSTALL_TOOL = {
  type: "function" as const,
  function: {
    name: "skill_install",
    description:
      "Install an external skill into the CMspark user skills library (~/.cmspark-agent/skills on Unix, %USERPROFILE%\\.cmspark-agent\\skills on Windows). Prefer this over shell copy. Source may be under the user home (e.g. ~/Projects/...), Downloads, OS temp, or ~/.cmspark-agent. After downloads_find/browser_download of a skill zip or folder, pass path or zip_path. Requires user L2 confirmation unless full-autonomy cruise is on. Never write skills into the git repo skills/ directory or ~/.claude/skills. content is size-capped (256KiB).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Local directory with SKILL.md, or a single .md skill file (user home / Downloads / tmp / data dir)",
        },
        zip_path: {
          type: "string",
          description:
            "Local .zip containing SKILL.md (folder skill; monorepo zips install the skills/<name>/ subtree). Source under home/Downloads/tmp/data. Compressed cap 100MiB; extract budgets higher for theme/font packs.",
        },
        content: {
          type: "string",
          description: "Raw markdown with YAML frontmatter (single skill file, max 256KiB); still requires L2",
        },
      },
      required: [] as string[],
    },
  },
}
