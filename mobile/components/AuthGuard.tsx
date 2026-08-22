import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import useAuth from '@/app/hooks/useAuth';
import { qualifiesForModeChoice } from '@/services/entryMode';

/**
 * Route-group auth guard. Because Expo Router renders a group's `_layout`
 * before any of its child screens, calling this hook once inside a protected
 * layout gates EVERY page in that group — including entries via notification
 * taps, deep links, and restored navigation, none of which pass through the
 * root `app/index.tsx` routing logic.
 *
 * Mobile has no server-side edge (unlike the web middleware), so this client
 * guard is the enforcement point. It:
 *   1. Waits for AuthProvider to finish its server-side token validation
 *      (`isLoading`) so we never redirect during the initial resolve or flash
 *      protected content.
 *   2. Redirects unauthenticated users to /login.
 *   3. Optionally bounces a user whose `user_type` doesn't match the group
 *      (e.g. a company user deep-linked into the private dashboard) to their
 *      own dashboard. A dual-identity user — a role-holding employee (HR etc.)
 *      or an owner who is also an employee, per `qualifiesForModeChoice` — is
 *      admitted to EITHER group, since they can legitimately switch sides.
 *
 * Returns `{ ready }` — true only when auth is resolved AND the user is
 * allowed here. Callers should render a splash/null until `ready` so no
 * protected UI paints for a user who is about to be redirected away.
 */
export function useRequireAuth(expectedType?: 'private' | 'company') {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return; // auth still resolving — decide nothing yet

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if (
      expectedType &&
      user?.user_type &&
      user.user_type !== expectedType &&
      !qualifiesForModeChoice(user)
    ) {
      // Cross-type entry: send the user to their own dashboard instead of
      // rendering a screen meant for the other account type. A dual-identity
      // user (role-holding employee / owner-employee) is exempt — they may
      // enter either group, matching the "Switch" affordance that offered it.
      router.replace(
        user.user_type === 'company'
          ? '/company_dashboard/home'
          : '/private_dashboard/home',
      );
    }
  }, [isLoading, isAuthenticated, user, expectedType, router]);

  const typeOk =
    !expectedType ||
    !user?.user_type ||
    user.user_type === expectedType ||
    qualifiesForModeChoice(user);
  return { ready: !isLoading && isAuthenticated && typeOk };
}
