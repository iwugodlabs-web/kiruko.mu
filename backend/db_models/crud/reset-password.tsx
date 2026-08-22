import {
    Button,
    ButtonText,
    Heading,
    Input,
    InputField,
    InputIcon,
    InputSlot,
    SafeAreaView,
    Text,
    VStack,
} from "@gluestack-ui/themed";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Eye, EyeOff, Lock } from "lucide-react-native";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert } from "react-native";
import { z } from "zod";

// Assuming this API function exists in your services/api.ts
import { postResetPassword } from "@/services/api";

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type PasswordFormData = z.infer<typeof passwordSchema>;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { email, token } = useLocalSearchParams<{ email: string; token: string }>();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    mode: "onBlur",
  });

  const onSubmit = async (data: PasswordFormData) => {
    if (!email || !token) {
      Alert.alert("Error", "Session expired. Please start over.");
      router.replace("/login");
      return;
    }
    try {
      const response = await postResetPassword(token, data.password);

      if (response.status === "success") {
        Alert.alert(
          "Password Reset Successful",
          "You can now log in with your new password.",
          [{ text: "OK", onPress: () => router.replace("/login") }]
        );
      } else {
        Alert.alert("Error", ("error" in response && response.error) || "Failed to reset password. Please try again.");
      }
    } catch (error) {
      console.error("Reset Password Error:", error);
      Alert.alert("Error", "An unexpected error occurred.");
    }
  };

  return (
    <SafeAreaView flex={1} bg="$white">
      <VStack p="$6" space="xl" flex={1} justifyContent="center">
        <Button variant="link" onPress={() => router.back()} position="absolute" top="$10" left="$6">
            <ArrowLeft size={24} color="black" />
            <ButtonText ml="$2">Back</ButtonText>
        </Button>

        <VStack space="md">
          <Heading size="2xl">Create New Password</Heading>
          <Text size="md" color="$textDark500">
            Your new password must be different from previous ones.
          </Text>
        </VStack>

        <VStack space="md">
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input size="xl" variant="outline" rounded="$lg">
                <InputSlot pl="$3"><InputIcon as={Lock} /></InputSlot>
                <InputField placeholder="New Password" value={value} onChangeText={onChange} onBlur={onBlur} secureTextEntry={!showPassword} />
                <InputSlot pr="$3" onPress={() => setShowPassword(!showPassword)}><InputIcon as={showPassword ? Eye : EyeOff} /></InputSlot>
              </Input>
            )}
          />
          {errors.password && <Text color="$red700" size="sm">{errors.password.message}</Text>}
        </VStack>

        <VStack space="md">
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input size="xl" variant="outline" rounded="$lg">
                <InputSlot pl="$3"><InputIcon as={Lock} /></InputSlot>
                <InputField placeholder="Confirm New Password" value={value} onChangeText={onChange} onBlur={onBlur} secureTextEntry={!showConfirmPassword} />
                <InputSlot pr="$3" onPress={() => setShowConfirmPassword(!showConfirmPassword)}><InputIcon as={showConfirmPassword ? Eye : EyeOff} /></InputSlot>
              </Input>
            )}
          />
          {errors.confirmPassword && <Text color="$red700" size="sm">{errors.confirmPassword.message}</Text>}
        </VStack>

        <Button size="xl" onPress={handleSubmit(onSubmit)} isDisabled={isSubmitting}>
          <ButtonText>Reset Password</ButtonText>
        </Button>
      </VStack>
    </SafeAreaView>
  );
}