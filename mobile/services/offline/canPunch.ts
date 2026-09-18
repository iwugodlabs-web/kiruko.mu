/**
 * Pure predicate for whether the clock-in/out buttons should be enabled.
 *
 * Extracted from clock-in.tsx (where it was duplicated inline on both buttons)
 * so the offline contract is testable: the ONLY server-derived input,
 * `jobId`, must be satisfiable from the offline cache — otherwise the buttons
 * stay disabled with no network and the offline punch queue can never run.
 * See jobIdCacheKey + the mount-time hydrate in clock-in.tsx.
 */
export interface PunchGateInputs {
  locationAuthorized: boolean | null;
  currentCoordinates: { latitude: number; longitude: number } | null;
  jobId: number | null;
  isLoading: boolean;
}

/** True when the user may tap clock-in/out. All inputs are locally
 * satisfiable offline: location from GPS, jobId from the per-user cache. */
export function canPunch({
  locationAuthorized,
  currentCoordinates,
  jobId,
  isLoading,
}: PunchGateInputs): boolean {
  return Boolean(locationAuthorized) && !!currentCoordinates && !!jobId && !isLoading;
}
