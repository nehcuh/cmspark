import matter from "gray-matter"

/** Parse document metadata as data, never as gray-matter's JavaScript language. */
export default function passiveFrontmatter(input: string): matter.GrayMatterFile<string> {
  // Per-call options neither mutate global engines nor reuse gray-matter's
  // unscoped cache, which may contain a result parsed through another engine.
  // gray-matter resolves both `js` and `javascript` to this engine.
  return matter(input, {
    engines: {
      javascript: () => { throw new Error("Executable frontmatter language is not supported") },
    },
  })
}
