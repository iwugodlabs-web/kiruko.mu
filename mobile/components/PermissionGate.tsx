import { MaterialIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import { Palette } from '@/app/constants/theme';
import useAuth from '@/app/hooks/useAuth';
import { hasCompanyPermission } from '@/services/permissions';

/**
 * Company-side screen/section guard — the mobile mirror of the web's role
 * guides. Renders `children` only when the signed-in role holds (any of) the
 * required permission(s); otherwise shows a friendly "no access" state instead
 * of letting the screen fire permission-gated fetches that 403.
 *
 * Owners (user_type='company') and company admins pass implicitly — see
 * hasCompanyPermission.
 */
export default function PermissionGate({
  permission,
  children,
  fallback,
  label,
}: {
  permission: string | string[];
  children: ReactNode;
  /** Custom node to render instead of the default no-access card. */
  fallback?: ReactNode;
  /** Human name of the section, used in the default message (e.g. "time logs"). */
  label?: string;
}) {
  const { user } = useAuth();

  if (hasCompanyPermission(user, permission)) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return <NoAccess label={label} />;
}

export function NoAccess({ label }: { label?: string }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: Palette.goldTint,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <MaterialIcons name="lock-outline" size={34} color={Palette.gold} />
        </View>
        <Text
          style={{
            fontSize: 18,
            fontWeight: '700',
            color: Palette.indigo,
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          No access to {label ?? 'this section'}
        </Text>
        <Text
          style={{
            fontSize: 14,
            lineHeight: 20,
            color: Palette.gray500,
            textAlign: 'center',
          }}
        >
          Your role doesn&apos;t include this permission. Ask a company admin to
          grant it from Settings → Permissions on the web dashboard.
        </Text>
      </View>
    </SafeAreaView>
  );
}
