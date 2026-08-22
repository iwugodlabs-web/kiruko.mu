// @ts-nocheck
import React, { useState, useRef } from 'react';
import { Palette } from '@/app/constants/theme';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

// Import your individual slide components
import Slide1 from './Slide1';
import Slide2 from './Slide2';
import Slide3 from './Slide3';
import Slide4 from './Slide4';

// Simulate async DB save function - replace with your real API call
async function saveUserRoleToDB(role: 'company' | 'private') {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      // Simulate success, call reject() to simulate failure
      resolve();
    }, 1000);
  });
}

interface SlideComponentProps {
  backgroundColor?: string;
  selectedRole?: 'company' | 'private' | '';
  onRoleSelected?: (role: 'company' | 'private') => void;
}

const OnboardingSlider: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedRole, setSelectedRole] = useState<'company' | 'private' | ''>('');
  const [isSavingRole, setIsSavingRole] = useState(false);

  const handleRoleSelected = (role: 'company' | 'private') => {
    console.log('✅ Role selected:', role);
    setSelectedRole(role);
  };

  const slides: {
    key: string;
    Component: React.FC<SlideComponentProps>;
    backgroundColor: string;
  }[] = [
    { key: 'slide1', Component: Slide1, backgroundColor: Palette.gold },
    { key: 'slide2', Component: Slide2, backgroundColor: Palette.teal },
    { key: 'slide3', Component: Slide3, backgroundColor: 'white' },
    { key: 'slide4', Component: Slide4, backgroundColor: Palette.ink },
  ];

  const currentSlide = slides[currentPageIndex];

  const handleContinue = async () => {
    // On Slide3, ensure role selected and save it first
    if (currentSlide.key === 'slide3') {
      if (!selectedRole) {
        Alert.alert('Selection Required', 'Please select your role before continuing.');
        return;
      }
      try {
        setIsSavingRole(true);
        await saveUserRoleToDB(selectedRole);
        console.log('Role saved successfully:', selectedRole);
        // Optionally save in AsyncStorage here if needed
      } catch (error) {
        Alert.alert('Error', 'Failed to save role. Please try again.');
        setIsSavingRole(false);
        return;
      }
      setIsSavingRole(false);
    }

    if (currentPageIndex === slides.length - 1) {
      if (onDone) {
        onDone();
      } else {
        router.push('/login');
      }
    } else {
      flatListRef.current?.scrollToIndex({ index: currentPageIndex + 1 });
      setCurrentPageIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentPageIndex > 0 && !isSavingRole) {
      setCurrentPageIndex((prev) => prev - 1);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: currentSlide.backgroundColor }]}>
      <View style={styles.content}>
        {currentSlide.key === 'slide3' ? (
          <currentSlide.Component
            backgroundColor={currentSlide.backgroundColor}
            selectedRole={selectedRole}
            onRoleSelected={handleRoleSelected}
          />
        ) : currentSlide.key === 'slide4' ? (
          // Pass selectedRole to slide4 for role-specific welcome text
          <currentSlide.Component
            backgroundColor={currentSlide.backgroundColor}
            selectedRole={selectedRole}
          />
        ) : (
          <currentSlide.Component backgroundColor={currentSlide.backgroundColor} />
        )}
      </View>

      <View style={styles.buttonContainer}>
        {currentPageIndex > 0 && (
          <TouchableOpacity
            style={[styles.navigationButton, styles.backButton]}
            onPress={handleBack}
            activeOpacity={0.7}
            disabled={isSavingRole}
          >
            <Text style={[styles.navigationButtonText, { color: Palette.ink }]}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.navigationButton, styles.continueButton, isSavingRole && { opacity: 0.6 }]}
          onPress={handleContinue}
          activeOpacity={0.7}
          disabled={isSavingRole}
        >
          {isSavingRole ? (
            <ActivityIndicator color={Palette.white} />
          ) : (
            <Text style={styles.navigationButtonText}>
              {currentPageIndex === slides.length - 1 ? 'Get Started' : 'Continue'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 30,
  },
  content: {
    flex: 1,
    width: '100%',
  },
  buttonContainer: {
    width: '100%',
    paddingHorizontal: 20,
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navigationButton: {
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    marginHorizontal: 5,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  backButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  continueButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  navigationButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default OnboardingSlider;
