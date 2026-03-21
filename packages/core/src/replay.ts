export function replayTrace(id: string, targetDir: string, opts?: any) {
  return { original: { query: "" }, replayed: { inputs: { eco_forced_lane_minimum: "A" } }, delta: { flags: { added: [], removed: [] }, confidence: 0, penalties: { added: [], removed: [] }, tier: 0, result_count: 0 } };
}

export function replayAll(opts: any) {
  return { traces: [{ status: 'improved', delta: { confidence: 10 } }] };
}
