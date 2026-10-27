export type DispatchCandidate = Readonly<{
  courierId: string;
  distanceToPickupMeters: number;
  activeAssignments: number;
  rating: number;
  acceptanceRate: number;
  pendingOffers: number;
  vehicleCapacity: number;
  requiredCapacity: number;
  isOnline: boolean;
  isVerified: boolean;
}>;

export type DispatchWeights = Readonly<{
  distance: number;
  workload: number;
  rating: number;
  acceptance: number;
  pendingOffers: number;
}>;

export const DEFAULT_DISPATCH_WEIGHTS: DispatchWeights = Object.freeze({
  distance: 0.45,
  workload: 0.25,
  rating: 0.15,
  acceptance: 0.1,
  pendingOffers: 0.05
});

export type DispatchScore = Readonly<{
  courierId: string;
  eligible: boolean;
  score: number;
  reasons: readonly string[];
}>;

export function scoreDispatchCandidate(candidate: DispatchCandidate, weights: DispatchWeights = DEFAULT_DISPATCH_WEIGHTS): DispatchScore {
  const reasons: string[] = [];
  if (!candidate.isOnline) reasons.push("offline");
  if (!candidate.isVerified) reasons.push("unverified");
  if (candidate.vehicleCapacity < candidate.requiredCapacity) reasons.push("insufficient_capacity");
  if (candidate.distanceToPickupMeters < 0) reasons.push("invalid_distance");
  if (reasons.length > 0) return Object.freeze({ courierId: candidate.courierId, eligible: false, score: 0, reasons });
  const distanceScore = 1 / (1 + candidate.distanceToPickupMeters / 1000);
  const workloadScore = 1 / (1 + candidate.activeAssignments);
  const ratingScore = clamp(candidate.rating, 0, 5) / 5;
  const acceptanceScore = clamp(candidate.acceptanceRate, 0, 1);
  const pendingScore = 1 / (1 + Math.max(0, candidate.pendingOffers));
  const score =
    distanceScore * weights.distance +
    workloadScore * weights.workload +
    ratingScore * weights.rating +
    acceptanceScore * weights.acceptance +
    pendingScore * weights.pendingOffers;
  return Object.freeze({ courierId: candidate.courierId, eligible: true, score: Math.round(score * 10_000) / 10_000, reasons: [] });
}

export function rankDispatchCandidates(candidates: readonly DispatchCandidate[], weights: DispatchWeights = DEFAULT_DISPATCH_WEIGHTS): readonly DispatchScore[] {
  return candidates
    .map((candidate) => scoreDispatchCandidate(candidate, weights))
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.score - left.score || left.courierId.localeCompare(right.courierId));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
