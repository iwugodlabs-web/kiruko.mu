// import { useStyled, View } from '@gluestack-ui/themed';
// import { router } from 'expo-router';
// import React, { useRef, useState } from 'react';
// import { Dimensions, StyleSheet, TouchableOpacity } from 'react-native';
// import { FlatList } from 'react-native-gesture-handler';
// import Animated, {
//   runOnJS,
//   SharedValue,
//   useAnimatedScrollHandler,
//   useAnimatedStyle,
//   useSharedValue,
//   withTiming,
// } from 'react-native-reanimated';
// import LottieView from 'lottie-react-native';
// import useOnBoard from '@/app/hooks/useOnBoard';
// import { ArrowRightCircle } from 'lucide-react-native';
// import Slide from './Slide';

// const { width } = Dimensions.get('window');

// interface SquareProps {
//   index: number;
//   currentIndex: SharedValue<number>;
// }

// const Square = ({ index, currentIndex }: SquareProps) => {
//   const animatedStyle = useAnimatedStyle(() => {
//     const isSelected = currentIndex.value === index;
//     return {
//       width: withTiming(isSelected ? 15 : 8, { duration: 300 }),
//       height: 6,
//       marginHorizontal: 3,
//       backgroundColor: withTiming(
//         isSelected ? Palette.green : 'rgba(0,0,0,0.3)',
//         { duration: 300 }
//       ),
//       borderRadius: 3,
//     };
//   });

//   return <Animated.View style={animatedStyle} />;
// };

// const SmartAnimateCarousel = () => {
//   const { changeIsBoardingCompletes, setUserAccountRole } = useOnBoard();
//   const styled = useStyled();

//   const scrollX = useSharedValue(0);
//   const currentIndex = useSharedValue(0);
//   const flatListRef = useRef<FlatList>(null);
//   const [currentSlide, setCurrentSlide] = useState(0);
//   const [selectedRole, setSelectedRole] = useState<'company' | 'private' | null>(null);

//   const slides = [
//     {
//       animation: require('../../../assets/images/Hand animation.json'),
//       title: 'WELCOME TO KONT TO KAS!',
//       description: "LET'S SET UP YOUR PROFILE TO GET STARTED",
//       note: 'Swipe to continue ➡️',
//     },
//     {
//       animation: require('../../../assets/images/Loading 40 _ Paperplane.json'),
//       description: 'JUST A FEW STEPS TO PERSONALIZE YOUR EXPERIENCE',
//     //   description: '',
//       note: '',
//     },
//     {
//       image: require('../../../assets/images/on-board-logo-3.jpg'),
//       title: 'ARE YOU AN EMPLOYER OR AN EMPLOYEE',
//       description: '',
//       note: '',
//     },
//     {
//       image: '',
//       title: '',
//       description: '',
//       note: '',
//     },
//   ];

//   const scrollHandler = useAnimatedScrollHandler({
//     onScroll: (event) => {
//       scrollX.value = event.contentOffset.x;
//       const newIndex = Math.round(event.contentOffset.x / width);

//       if (newIndex !== currentIndex.value) {
//         currentIndex.value = newIndex;
//         runOnJS(setCurrentSlide)(newIndex);
//       }
//     },
//   });

//   const handleOnBoardComplete = () => {
//     setUserAccountRole(selectedRole as string);
//     changeIsBoardingCompletes(true);
//     router.navigate('/login');
//   };

//   return (
//     <View style={styles.container}>
//       <Animated.FlatList
//         ref={flatListRef}
//         data={slides}
//         horizontal
//         pagingEnabled
//         showsHorizontalScrollIndicator={false}
//         renderItem={({ item, index }) => (
//           <Slide
//             item={item}
//             index={index}
//             scrollX={scrollX}
//             currentIndex={currentIndex}
//             selectedRole={selectedRole}
//             onSelectRole={setSelectedRole}
//           />
//         )}
//         keyExtractor={(_, index) => index.toString()}
//         onScroll={scrollHandler}
//         scrollEventThrottle={16}
//       />

//       <View
//         style={styles.bottomBar}
//         backgroundColor={styled.config.tokens.colors.primary200}
//       >
//         <View style={styles.dotWrapper}>
//           {slides.map((_, index) => (
//             <Square key={index} index={index} currentIndex={currentIndex} />
//           ))}
//         </View>

//         {currentSlide === slides.length - 1 && (
//           <TouchableOpacity style={styles.doneButton} onPress={handleOnBoardComplete}>
//             <ArrowRightCircle size={36} color={Palette.green} />
//           </TouchableOpacity>
//         )}
//       </View>
//     </View>
//   );
// };

// export default SmartAnimateCarousel;

// Temporary placeholder to fix missing default export warning
import React from 'react';
import { Palette } from '@/app/constants/theme';
import { View } from 'react-native';

const SmartAnimateCarousel = () => {
  return <View />;
};

export default SmartAnimateCarousel;

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: Palette.white,
//   },
//   bottomBar: {
//     position: 'absolute',
//     bottom: 0,
//     left: 0,
//     right: 0,
//     width: '100%',
//     height: 103,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   slideLocator: {
//     fontSize: 12,
//     color: Palette.gray700,
//     marginBottom: 6,
//   },
//   dotWrapper: {
//     flexDirection: 'row',
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   doneButton: {
//     paddingHorizontal: 10,
//     position: 'absolute',
//     right: 0,
//   },
// });
