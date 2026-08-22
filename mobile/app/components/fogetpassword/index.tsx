// @ts-nocheck
// forgotpassword/index.tsx
import React, { useState } from 'react';
import { Palette } from '@/app/constants/theme';
import { View, StyleSheet } from 'react-native';
import { Text, Input, InputField, Button, ButtonText } from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';

export default function ForgotPasswordIndex() {
  const [input, setInput] = useState('');
  const router = useRouter();

  const handleSubmit = () => {
    if (input.trim() !== '') {
      // Here, you'd send input to backend to generate OTP
      router.push('/forgotpassword/otp');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forgot Password</Text>

      <Input size="xl" variant="rounded" style={styles.input}>
        <InputField
          placeholder="Enter email or phone"
          value={input}
          onChangeText={setInput}
        />
      </Input>

      <Button
        action="primary"
        variant="solid"
        size="xl"
        style={styles.button}
        onPress={handleSubmit}
      >
        <ButtonText>Next</ButtonText>
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
