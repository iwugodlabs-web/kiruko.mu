// Plan Phase 12.B — finally mount the welcome carousel. Pre-existing
// `ModernOnboarding` component (4 steps, role-selection at step 2) was
// dead code; this route makes it the entry point on first launch.
//
// Flow:
// - First app launch → mobile/app/index.tsx routes here.
// - User taps "Get Started" → ModernOnboarding flips `isBoardingComplete`
//   to true via OnBoardContext, then routes to /login.
// - Subsequent launches skip this route entirely (the flag is sticky).
//
// Note: this is the *welcome* carousel, distinct from profile-completion
// (which lives at /private_dashboard/profile and is the actual data
// collection step gated by the server-authoritative onboard_complete flag).
import ModernOnboarding from "../components/OnBoard/ModernOnboarding";

export default function OnboardingScreen() {
  return <ModernOnboarding />;
}
