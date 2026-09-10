// Pure helpers shared by the game and regression tests.
"use strict";
function findWalkPath(start, goal, blocked, width, height, step = 10) {
  const queue = [{ x: start.x, y: start.y, parent: -1 }];
  const seen = new Set(["0,0"]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (goal(p.x, p.y)) {
      const path = [];
      for (let j = i; j > 0; j = queue[j].parent) path.unshift({ x: queue[j].x, y: queue[j].y });
      return path;
    }
    for (const [dx, dy] of [[step,0],[-step,0],[0,step],[0,-step]]) {
      const x = p.x + dx, y = p.y + dy;
      const key = `${Math.round((x-start.x)/step)},${Math.round((y-start.y)/step)}`;
      if (x < 0 || y < 0 || x > width || y > height || seen.has(key)) continue;
      seen.add(key);
      // Sample the swept segment, not only its endpoint.
      if ([0.25,0.5,0.75,1].some(t => blocked(p.x+dx*t, p.y+dy*t))) continue;
      queue.push({ x, y, parent: i });
    }
  }
  return null;
}
function procedureHit(log, id) {
  const matches = log.filter(entry => entry.modelId === id);
  return id === "cpoff" ? matches.at(-1) : matches[0];
}
if (typeof module !== "undefined") module.exports = { findWalkPath, procedureHit };
