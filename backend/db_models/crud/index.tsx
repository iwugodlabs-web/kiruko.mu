// import {
//     Button,
//     ButtonText,
//     Heading,
//     Input,
//     InputField,
//     InputIcon,
//     InputSlot,
//     SafeAreaView,
//     Text,
//     VStack,
// } from "@gluestack-ui/themed";
// import { zodResolver } from "@hookform/resolvers/zod";
// import { useRouter } from "expo-router";
// import { ArrowLeft, Mail } from "lucide-react-native";
// import { Controller, useForm } from "react-hook-form";
// import { Alert } from "react-native";
// import { z } from "zod";

// // Assuming this API function exists in your services/api.ts
// import { postRequestPasswordReset } from "@/services/api";

// const emailSchema = z.object({
//   email: z.string().email("Please enter a valid email address."),
// });

// type EmailFormData = z.infer<typeof emailSchema>;

// export default function ForgotPasswordScreen() {
//   const router = useRouter();
//   const {
//     control,
//     handleSubmit,
//     formState: { errors, isSubmitting },
//   } = useForm<EmailFormData>({
//     resolver: zodResolver(emailSchema),
//     mode: "onBlur",
//   });

//   const onSubmit = async (data: EmailFormData) => {
//     try {
//       const response = await postRequestPasswordReset(data.email);

//       // The API returns a success message regardless of whether the email exists
//       // to prevent user enumeration. We can proceed if there's no explicit error.
//       if (!("error" in response)) {
//         Alert.alert(
//           "Check Your Email",
//           "If an account with that email exists, an OTP has been sent."
//         );
//         router.push({
//           pathname: "/forgot-password/verify-otp",
//           params: { email: data.email },
//         });
//       } else {
//         Alert.alert("Error", response.error || "Failed to send OTP. Please try again.");
//       }
//     } catch (error) {
//       console.error("Forgot Password Error:", error);
//       Alert.alert("Error", "An unexpected error occurred.");
//     }
//   };

//   return (
//     <SafeAreaView flex={1} bg="$white">
//       <VStack p="$6" space="xl" flex={1} justifyContent="center">
//         {/* This button now safely navigates to the login screen, preventing crashes. */}
//         <Button variant="link" onPress={() => router.replace('/login')} position="absolute" top="$10" left="$6">
//             <ArrowLeft size={24} color="black" />
//             <ButtonText ml="$2">Back to Login</ButtonText>
//         </Button>

//         <VStack space="md">
//           <Heading size="2xl">Forgot Password?</Heading>
//           <Text size="md" color="$textDark500">
//             No worries! Enter your email and we'll send you a reset code.
//           </Text>
//         </VStack>

//         <VStack space="md">
//           <Controller
//             control={control}
//             name="email"
//             render={({ field: { onChange, onBlur, value } }) => (
//               <Input size="xl" variant="outline" rounded="$lg">
//                 <InputSlot pl="$3">
//                   <InputIcon as={Mail} />
//                 </InputSlot>
//                 <InputField
//                   placeholder="Enter your email"
//                   value={value}
//                   onChangeText={onChange}
//                   onBlur={onBlur}
//                   autoCapitalize="none"
//                   keyboardType="email-address"
//                 />
//               </Input>
//             )}
//           />
//           {errors.email && <Text color="$red700" size="sm">{errors.email.message}</Text>}
//         </VStack>

//         <Button size="xl" onPress={handleSubmit(onSubmit)} isDisabled={isSubmitting}>
//           <ButtonText>Send Reset Code</ButtonText>
//         </Button>
//       </VStack>
//     </SafeAreaView>
//   );
// }