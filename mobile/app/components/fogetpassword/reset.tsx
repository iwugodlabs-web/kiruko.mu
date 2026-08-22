// @ts-nocheck
// forgotpassword/reset.tsx
import React, { useState } from 'react';
import { Palette } from '@/app/constants/theme';
import { View, StyleSheet } from 'react-native';
import { Text, Input, InputField, Button, ButtonText } from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const router = useRouter();

  const handleReset = () => {
    if (password === confirm && password.length >= 8) {
      // Send new password to backend
      router.push('/components/login');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset Password</Text>

      <Input size="xl" variant="rounded" style={styles.input}>
        <InputField
          placeholder="New Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
      </Input>
      <Input size="xl" variant="rounded" style={styles.input}>
        <InputField
          placeholder="Confirm Password"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />
      </Input>

      <Button
        action="primary"
        variant="solid"
        size="xl"
        style={styles.button}
        onPress={handleReset}
      >
        <ButtonText>Save</ButtonText>
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
