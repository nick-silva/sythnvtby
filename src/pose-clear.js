/**
 * Clearing one pose's paint. Paint is stored per tile pattern, so a pattern the pose shares with
 * another pose (or another frame card of a background group) cannot lose its colour here without
 * losing it there too. This sorts the pose's painted patterns into its own and the shared ones, so
 * the pose can be cleared alone — its own patterns — or with everything it touches.
 */

/**
 * @param {Iterable<number>} painted the pose's painted patterns (unsigned hashes)
 * @param {Array<{ name: string, patterns: Iterable<number> }>} others the group's other poses or cards
 * @returns {{ own: number[], shared: number[], sharedWith: Array<{ name: string, count: number }> }}
 *   `sharedWith`: each other pose using some of them, and how many
 */
export function splitPosePatterns(painted, others) {
  const mine = [...new Set([...painted].map((h) => h >>> 0))];
  const used = new Set();
  const sharedWith = [];
  for (const other of others) {
    const theirs = new Set([...other.patterns].map((h) => h >>> 0));
    const count = mine.filter((h) => theirs.has(h)).length;
    if (!count) continue;
    sharedWith.push({ name: other.name, count });
    for (const h of mine) if (theirs.has(h)) used.add(h);
  }
  return { own: mine.filter((h) => !used.has(h)), shared: mine.filter((h) => used.has(h)), sharedWith };
}
