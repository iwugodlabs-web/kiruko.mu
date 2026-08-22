import React from 'react';
import { StyleSheet, View, Text, Image } from 'react-native';
import LottieView from 'lottie-react-native';

interface SlideProps {
  backgroundColor: string;
}

const Slide1: React.FC<SlideProps> = ({ backgroundColor }) => {
  return (
    <View style={[styles.slide, { backgroundColor }]}>
      <LottieView
        source={require('./assets_onboarding/welcome.json')} // Adjust path relative to Slide1.tsx
        autoPlay
        loop
        style={styles.animation}
      />
      {/* <Text style={styles.title}>Welcome to Our App!</Text> */}
      <Text style={styles.text}>WELCOME TO KONT TO KAS! LET’S SET UP YOUR PROFILE TO GET
        STARTED</Text>
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
  animation: {
    width: 250,
    height: 250,
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  text: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 18,
    textAlign: 'center',
  },
});

export default Slide1;