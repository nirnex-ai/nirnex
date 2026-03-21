export function clusterWarnings(warnings: any[]) {
  return [{ cluster_severity: "moderate", weight: 1, root_dimension: "graph", warnings }];
}

export function computeEscalationFromClusters(clusters: any[]) {
  return { warning_accumulation_escalation: false, forced_lane_c: false, requires_acknowledgement: false };
}
