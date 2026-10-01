import { Stack } from 'expo-router';

export default function ProfileSectionLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="workschedule" />
      <Stack.Screen name="pay" />
      <Stack.Screen name="identity" />
      <Stack.Screen name="compliance" />
    </Stack>
  );
}
