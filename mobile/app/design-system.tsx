import { getUserProfiles } from "@/actions/accounts";
import useLanguage from "@/app/hooks/useLanguage";
import {
  BasilUserSolid,
  MynauiEye,
  MynauiLockPasswordSolid,
} from "@/components/custom/icons/design-system";
import { ArrowLeftIcon, Button, ButtonIcon, ButtonText, Heading, Input, InputField, InputIcon, InputSlot, Text, VStack, HStack } from "@gluestack-ui/themed";
import { useSQLiteContext } from "expo-sqlite";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { I18nManager, ScrollView, StyleSheet, View } from "react-native";

// Standardized Button Variants
export const StandardButton = {
  // Primary Action Button (Submit, Save, Confirm)
  Primary: ({ children, onPress, isDisabled = false, isLoading = false, icon, ...props }: any) => (
    <Button
      bg={isDisabled ? "$gray400" : "$primary500"}
      rounded="$xl"
      h="$12"
      w="$full"
      onPress={onPress}
      isDisabled={isDisabled || isLoading}
      opacity={isDisabled ? 0.6 : 1}
      sx={{
        ":active": {
          bg: isDisabled ? "$gray400" : "$primary600",
          transform: [{ scale: 0.98 }]
        }
      }}
      {...props}
    >
      <HStack alignItems="center" justifyContent="center" space="sm">
        {icon && icon}
        <ButtonText
          color="white"
          fontSize={16}
          fontWeight="600"
          textAlign="center"
        >
          {isLoading ? 'Loading...' : children}
        </ButtonText>
      </HStack>
    </Button>
  ),

  // Secondary Action Button (Cancel, Close, Back)
  Secondary: ({ children, onPress, isDisabled = false, icon, ...props }: any) => (
    <Button
      variant="outline"
      bg="white"
      rounded="$xl"
      h="$12"
      w="$full"
      onPress={onPress}
      isDisabled={isDisabled}
      borderColor="$borderLight200"
      sx={{
        ":active": {
          bg: "$backgroundLight100",
          borderColor: "$primary300"
        }
      }}
      {...props}
    >
      <HStack alignItems="center" justifyContent="center" space="sm">
        {icon && icon}
        <ButtonText
          color="$textDark600"
          fontSize={16}
          fontWeight="600"
          textAlign="center"
        >
          {children}
        </ButtonText>
      </HStack>
    </Button>
  ),

  // Small Action Button (Sort, Filter, Icon buttons)
  Small: ({ children, onPress, isActive = false, icon, ...props }: any) => (
    <Button
      size="xs"
      variant={isActive ? 'solid' : 'outline'}
      action="secondary"
      onPress={onPress}
      rounded="$lg"
      {...props}
    >
      <HStack alignItems="center" justifyContent="center" space="xs">
        {icon && icon}
        <ButtonText fontSize={12} fontWeight="500">
          {children}
        </ButtonText>
      </HStack>
    </Button>
  ),

  // Large Hero Button (Login, Sign Up main CTA)
  Large: ({ children, onPress, isDisabled = false, isLoading = false, icon, ...props }: any) => (
    <Button
      size="xl"
      onPress={onPress}
      isDisabled={isDisabled || isLoading}
      bg={isDisabled ? "$gray400" : "$primary500"}
      rounded="$xl"
      h="$16"
      w="$full"
      sx={{
        ":active": {
          bg: isDisabled ? "$gray400" : "$primary600",
          transform: [{ scale: 0.98 }]
        }
      }}
      {...props}
    >
      <HStack alignItems="center" space="lg" justifyContent="center">
        {icon && icon}
        <ButtonText
          fontSize={18}
          fontWeight="700"
          color="white"
          textAlign="center"
        >
          {isLoading ? 'Loading...' : children}
        </ButtonText>
      </HStack>
    </Button>
  ),

  // Link Button (Navigation, "Forgot Password", etc.)
  Link: ({ children, onPress, icon, ...props }: any) => (
    <Button
      variant="link"
      onPress={onPress}
      size="md"
      {...props}
    >
      <HStack alignItems="center" justifyContent="center" space="xs">
        {icon && icon}
        <ButtonText color="$primary600" fontWeight="600" fontSize={14}>
          {children}
        </ButtonText>
      </HStack>
    </Button>
  ),

  // Outline Button (Alternative actions)
  Outline: ({ children, onPress, isDisabled = false, icon, ...props }: any) => (
    <Button
      variant="outline"
      size="lg"
      onPress={onPress}
      isDisabled={isDisabled}
      borderColor="$primary300"
      bg="rgba(255,255,255,0.8)"
      rounded="$xl"
      h="$12"
      sx={{
        ":active": {
          bg: "$primary50",
          borderColor: "$primary500"
        }
      }}
      {...props}
    >
      <HStack alignItems="center" justifyContent="center" space="sm">
        {icon && icon}
        <ButtonText color="$primary600" fontWeight="600" fontSize={16}>
          {children}
        </ButtonText>
      </HStack>
    </Button>
  )
};

export default function Home() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();
  const db = useSQLiteContext();

  /* Dummy load function - We can remove this after testing */
  const userProfiles = async () => {
    const data = await getUserProfiles(db);
    console.log({
      data,
    });
  };
  useEffect(() => {
    // Ensure db is available before calling userProfiles
    if (db) userProfiles();
  }, [db]);
  const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
  return (
    <ScrollView>
      <View className="bg-white" style={styles.container}>
        {/* <Text style={styles.text}>{t("welcome")}</Text>
         <Text style={styles.text}>{t("greeting", { name: "John" })}</Text> */}

        {/* <Button title="English" onPress={() => changeLanguage("en")} />
         <Button title="Español" onPress={() => changeLanguage("es")} />
         <Button title="Français" onPress={() => changeLanguage("fr")} />
         <Button title="العربية" onPress={() => changeLanguage("ar")} /> */}

        {/* <Text>Current Language: {language}</Text> */}

        {sizes.map((size, index) => (
          <Heading size={size as any} key={index}>
            {size}
          </Heading>
        ))}

        {sizes.map((size, index) => (
          <Text size={size as any} key={index}>
            {size}
          </Text>
        ))}

        <Input size="xl" variant="rounded">
          <InputSlot className="pl-5">
            <InputIcon as={BasilUserSolid} className="fill-typography-black" />
          </InputSlot>

          <InputField placeholder="Username" />
        </Input>

        <Input size="xl" variant="rounded">
          <InputSlot className="pl-5">
            <InputIcon as={MynauiLockPasswordSolid} />
          </InputSlot>

          <InputField placeholder="Password" type="password" />

          <InputSlot className="pr-5">
            <InputIcon as={MynauiEye} />
          </InputSlot>
        </Input>

        <StandardButton.Primary>
          Login
        </StandardButton.Primary>

        <StandardButton.Secondary>
          Cancel
        </StandardButton.Secondary>

        <StandardButton.Large icon={<ButtonIcon className="mr-1" size="md" as={ArrowLeftIcon} />}>
          Sign In
        </StandardButton.Large>

        <StandardButton.Outline>
          Create Account
        </StandardButton.Outline>

        <StandardButton.Link>
          Forgot Password
        </StandardButton.Link>

        <HStack space="sm" mt="$4">
          <StandardButton.Small isActive={true}>
            Date
          </StandardButton.Small>
          <StandardButton.Small>
            Amount
          </StandardButton.Small>
        </HStack>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 30,
    gap: 10,
    direction: I18nManager.isRTL ? "rtl" : "ltr",
  },
  text: {
    fontSize: 20,
    marginBottom: 10,
    direction: I18nManager.isRTL ? "rtl" : "ltr",
  },
});
