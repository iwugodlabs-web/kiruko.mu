import { Ionicons } from '@expo/vector-icons';
import { Palette, Type, Weight } from '@/app/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MotiText, MotiView } from 'moti';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    Animated,
    Dimensions,
    Image,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import OnBoardContext from '../../context/OnBoardContext';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const ModernOnboarding: React.FC = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const onBoardContext = useContext(OnBoardContext);
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const progressAnimation = useRef(new Animated.Value(0)).current;
  const fadeAnimation = useRef(new Animated.Value(1)).current;

  if (!onBoardContext) {
    throw new Error('ModernOnboarding must be used within OnBoardProvider');
  }

  const { changeIsBoardingCompletes } = onBoardContext;

  const steps = [
    {
      title: t('onboarding.step1Title'),
      subtitle: t('onboarding.step1Subtitle'),
      icon: 'rocket-outline',
      color: Palette.gold,
      backgroundColor: Palette.goldTint,
    },
    {
      title: t('onboarding.step2Title'),
      subtitle: t('onboarding.step2Subtitle'),
      icon: 'time-outline',
      color: Palette.teal,
      backgroundColor: Palette.tealTint,
    },
    {
      title: t('onboarding.step3Title'),
      subtitle: t('onboarding.step3Subtitle'),
      icon: 'people-outline',
      color: Palette.blue,
      backgroundColor: Palette.blueTint,
    },
    {
      title: t('onboarding.step4Title'),
      subtitle: t('onboarding.step4Subtitle'),
      icon: 'checkmark-circle-outline',
      color: Palette.green,
      backgroundColor: Palette.greenTint,
    },
  ];

  useEffect(() => {
    Animated.timing(progressAnimation, {
      toValue: (currentStep + 1) / steps.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [currentStep]);

  const handleNext = async () => {
    if (currentStep === steps.length - 1) {
      // Mark onboarding as complete
      await changeIsBoardingCompletes(true);

      // Route to login. The employer-vs-employee choice lives there (the
      // "Personal" / "Company" sign-up buttons), so onboarding stays a pure
      // welcome carousel and doesn't force a role up front.
      Animated.timing(fadeAnimation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        router.replace('/login');
      });
    } else {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      scrollViewRef.current?.scrollTo({
        x: nextStep * screenWidth,
        animated: true,
      });
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      scrollViewRef.current?.scrollTo({
        x: prevStep * screenWidth,
        animated: true,
      });
    }
  };

  const handleSkip = () => {
    Alert.alert(
      t('onboarding.skipTitle'),
      t('onboarding.skipBody'),
      [
        { text: t('onboarding.continueSetup'), style: 'cancel' },
        {
          text: t('onboarding.skip'),
          style: 'destructive',
          onPress: async () => {
            await changeIsBoardingCompletes(true);
            router.replace('/login');
          }
        },
      ]
    );
  };

  const renderStep = (step: any, index: number) => {
    return (
      <View key={index} style={styles.stepContainer}>
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'timing', duration: 600, delay: 100 }}
          style={styles.content}
        >
          {/* Header Section */}
          <View style={styles.headerSectionDefault}>
            {/* Icon */}
            <MotiView
              from={{ translateY: -30, opacity: 0, scale: 0.5 }}
              animate={{ translateY: 0, opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 15, stiffness: 150, delay: 200 }}
            >
              {index === 0 ? (
                <View style={[styles.iconContainerDefault, styles.iconShadow, { backgroundColor: Palette.goldTint }]}>
                  <Image
                    source={require('@/assets/images/kiruko-mark.png')}
                    style={styles.brandMark}
                    resizeMode="contain"
                  />
                </View>
              ) : (
                <LinearGradient
                  colors={[step.color, step.backgroundColor]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.iconContainerDefault, styles.iconShadow]}
                >
                  <Ionicons name={step.icon as any} size={60} color={Palette.white} />
                </LinearGradient>
              )}
            </MotiView>

            {/* Title */}
            <MotiText
              from={{ opacity: 0, translateY: 20 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 500, delay: 400 }}
              style={styles.titleDefault}
            >
              {step.title}
            </MotiText>

            {/* Subtitle */}
            <MotiText
              from={{ opacity: 0, translateY: 20 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 500, delay: 600 }}
              style={styles.subtitleDefault}
            >
              {step.subtitle}
            </MotiText>
          </View>
        </MotiView>
      </View>
    );
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnimation }]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      {/* Header with Progress */}
      <View style={styles.header}>
        <View style={styles.progressContainer}>
          <View style={styles.progressBackground}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: steps[currentStep].color,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {t('onboarding.stepCount', { current: currentStep + 1, total: steps.length })}
          </Text>
        </View>

        {/* Skip Button */}
        {currentStep < steps.length - 1 && (
          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipButtonText}>{t('onboarding.skip')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Steps */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {steps.map((step, index) => renderStep(step, index))}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.navigationContainer}>
        {currentStep > 0 && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color={Palette.gray500} />
            <Text style={styles.backButtonText}>{t('onboarding.back')}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />

        <TouchableOpacity
          style={[
            styles.nextButton,
            { backgroundColor: steps[currentStep].color },
          ]}
          onPress={handleNext}
          activeOpacity={0.8}
        >
          <Text style={[styles.nextButtonText, steps[currentStep].color === Palette.gold && { color: Palette.ink }]}>
            {currentStep === steps.length - 1 ? t('onboarding.getStarted') : t('onboarding.continue')}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={steps[currentStep].color === Palette.gold ? Palette.ink : Palette.white} />
        </TouchableOpacity>
      </View>

      {/* Dots Indicator */}
      <View style={styles.dotsContainer}>
        {steps.map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              {
                backgroundColor: index === currentStep ? steps[currentStep].color : Palette.gray200,
                transform: [{ scale: index === currentStep ? 1.2 : 1 }],
              },
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.white,
  },
  header: {
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  progressBackground: {
    flex: 1,
    height: 3,
    backgroundColor: Palette.gray200,
    borderRadius: 2,
    marginRight: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: Type.small,
    color: Palette.gray500,
    fontWeight: Weight.semibold,
  },
  skipButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  skipButtonText: {
    fontSize: Type.body,
    color: Palette.gray500,
    fontWeight: Weight.medium,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  stepContainer: {
    width: screenWidth,
    flex: 1,
    backgroundColor: Palette.white,
  },
  iconShadow: {
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  contentStep3: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconContainerDefault: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  headerSection: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  headerSectionDefault: {
    alignItems: 'center',
  },
  brandMark: {
    width: 72,
    height: 72,
  },
  title: {
    fontSize: Type.h1,
    fontWeight: Weight.black,
    color: Palette.ink,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  titleDefault: {
    fontSize: Type.display,
    fontWeight: Weight.black,
    color: Palette.ink,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: Type.body,
    color: Palette.gray500,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  subtitleDefault: {
    fontSize: Type.title,
    color: Palette.gray500,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 48,
  },
  roleSelection: {
    width: '100%',
    gap: 12,
    flex: 1,
    justifyContent: 'center',
  },
  roleCard: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Palette.gray200,
    position: 'relative',
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  roleCardSelected: {
    borderWidth: 2,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  roleIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  roleText: {
    fontSize: Type.title,
    fontWeight: Weight.black,
    color: Palette.ink,
    marginBottom: 4,
  },
  roleSubtext: {
    fontSize: Type.small,
    color: Palette.gray500,
    textAlign: 'center',
    lineHeight: 16,
  },
  checkmark: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navigationContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    alignItems: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  backButtonText: {
    fontSize: Type.title,
    color: Palette.gray500,
    marginLeft: 4,
    fontWeight: Weight.medium,
  },
  spacer: {
    flex: 1,
  },
  nextButton: {
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  nextButtonDisabled: {
    opacity: 0.7,
  },
  nextButtonText: {
    color: Palette.white,
    fontSize: Type.title,
    fontWeight: Weight.bold,
    marginRight: 8,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 30,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default ModernOnboarding;
