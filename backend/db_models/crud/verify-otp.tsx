import {
    Button,
    ButtonText,
    Heading,
    Input,
    InputField,
    SafeAreaView,
    Text,
    VStack,
} from "@gluestack-ui/themed";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Controller, useForm } from "react-hook-form";
import { Alert } from "react-native";
import { z } from "zod";

// Assuming this API function exists in your services/api.ts
import { postVerifyPasswordResetOTP } from "@/services/api";

const otpSchema = z.object({
  otp: z.string().length(6, "OTP must be 6 digits."),
});

type OtpFormData = z.infer<typeof otpSchema>;

export default function VerifyOTPScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OtpFormData>({
    resolver: zodResolver(otpSchema),
    mode: "onBlur",
  });

  const onSubmit = async (data: OtpFormData) => {
    if (!email) {
      Alert.alert("Error", "Email not found. Please go back and try again.");
      return;
    }
    try {
      const response = await postVerifyPasswordResetOTP(email, data.otp);

      if (response.status === "success" && response.token) {
        router.push({
          pathname: "/forgot-password/reset-password",
          params: { email, token: response.token },
        });
      } else {
        Alert.alert("Error", ("error" in response && response.error) || "Invalid OTP. Please try again.");
      }
    } catch (error) {
      console.error("Verify OTP Error:", error);
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
          <Heading size="2xl">Enter OTP</Heading>
          <Text size="md" color="$textDark500">
            We've sent a 6-digit code to <Text bold>{email}</Text>. Please enter it below.
          </Text>
        </VStack>

        <VStack space="md">
          <Controller
            control={control}
            name="otp"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input size="xl" variant="outline" rounded="$lg">
                <InputField
                  placeholder="123456"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  keyboardType="number-pad"
                  maxLength={6}
                  textAlign="center"
                  letterSpacing={10}
                />
              </Input>
            )}
          />
          {errors.otp && <Text color="$red700" size="sm">{errors.otp.message}</Text>}
        </VStack>

        <Button size="xl" onPress={handleSubmit(onSubmit)} isDisabled={isSubmitting}>
          <ButtonText>Verify Code</ButtonText>
        </Button>
      </VStack>
    </SafeAreaView>
  );
}