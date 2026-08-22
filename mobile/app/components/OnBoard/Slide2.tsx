import React from 'react';
import { StyleSheet, View, Text, Image } from 'react-native';
import LottieView from 'lottie-react-native';

interface SlideProps {
  backgroundColor: string;
}

const Slide2: React.FC<SlideProps> = ({ backgroundColor }) => {
  return (
    <View style={[styles.slide, { backgroundColor }]}>
      <LottieView
        source={require('./assets_onboarding/Loading 40 _ Paperplane.json')} // Adjust path relative to Slide2.tsx
        autoPlay
        loop
        style={styles.animation}
      />
      {/* <Text style={styles.title}>Personalized Experience</Text> */}
      <Text style={styles.text}>JUST A FEW STEPS TO PERSONALIZE YOUR EXPERIENCE</Text>
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

export default Slide2;