import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

interface SlideProps {
  backgroundColor: string;
  selectedRole?: 'company' | 'private' | '';
}

const Slide4: React.FC<SlideProps> = ({ backgroundColor, selectedRole }) => {
  // Determine welcome text based on selectedRole
  const roleText =
    selectedRole === 'company'
      ? 'EMPLOYER'
      : selectedRole === 'private'
      ? 'EMPLOYEE'
      : 'USER';

  return (
    <View style={[styles.slide, { backgroundColor }]}>
      <Text style={styles.text}>
        {`WELCOME TO THE ${roleText} INTERFACE. WE WILL HELP YOU TO REGISTER FOR OUR ONLINE SERVICE.`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  text: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 18,
    textAlign: 'center',
  },
});

export default Slide4;
