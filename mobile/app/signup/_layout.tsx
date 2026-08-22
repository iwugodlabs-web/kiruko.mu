import { Stack } from "expo-router";

export default function SignupLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="signup"
        options={{
          headerShown: false,
          title: "Create Account",
        }}
      />
      <Stack.Screen
        name="signup_company"
        options={{
          headerShown: false,
          title: "Create Account",
        }}
      />
      <Stack.Screen
        name="verify-signup"
        options={{
          headerShown: false,
          title: "Verify Account",
        }}
      />

      <Stack.Screen
        name="signup_old"
        options={{
          headerShown: false,
          title: "Create Account",
        }}
      />
    </Stack>
  );
}
