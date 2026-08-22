// @ts-nocheck
// forgotpassword/otp.tsx
import React, { useState } from 'react';
import { Palette } from '@/app/constants/theme';
import { View, StyleSheet } from 'react-native';
import { Text, Input, InputField, Button, ButtonText } from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';

export default function OTPVerification() {
  const [otp, setOtp] = useState('');
  const router = useRouter();

  const handleVerify = () => {
    if (otp.trim().length === 6) {
      // Verify OTP via backend
      router.push('/forgotpassword/reset');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter OTP</Text>

      <Input size="xl" variant="rounded" style={styles.input}>
        <InputField
          placeholder="6-digit OTP"
          keyboardType="numeric"
          maxLength={6}
          value={otp}
          onChangeText={setOtp}
        />
      </Input>

      <Button
        action="primary"
        variant="solid"
        size="xl"
        style={styles.button}
        onPress={handleVerify}
      >
        <ButtonText>Verify</ButtonText>
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.blue,
    justifyContent: 'center',
    padding: 30,
  },
  title: {
    fontSize: 32,
    color: Palette.white,
    textAlign: 'center',
    marginBottom: 40,
    fontWeight: 'bold',
  },
  input: {
    marginBottom: 20,
  },
  button: {
    backgroundColor: Palette.blue,
  },
});
