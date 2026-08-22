import AsyncStorage from '@react-native-async-storage/async-storage';
import { Palette } from '@/app/constants/theme';
import { Building, User } from 'lucide-react-native';
import { MotiView } from 'moti';
import React, { useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import OnBoardContext from '../../context/OnBoardContext';

interface SlideProps {
  backgroundColor: string;
  onRoleSelected: (role: 'company' | 'private') => void;
  selectedRole: 'company' | 'private' | '';
}

const Slide3: React.FC<SlideProps> = ({ backgroundColor, onRoleSelected, selectedRole }) => {
  const [userRoleStatus, setUserRoleStatus] = useState<'company' | 'private' | ''>('');
  const onBoardContext = useContext(OnBoardContext);

  useEffect(() => {
    // Load cached role from context if available
    if (onBoardContext?.cacheUserRole && !userRoleStatus) {
      const cachedRole = onBoardContext.cacheUserRole as 'company' | 'private';
      setUserRoleStatus(cachedRole);
      onRoleSelected(cachedRole);
    }
    // If there's already a selectedRole (from outside), use it
    else if (!userRoleStatus && selectedRole) {
      setUserRoleStatus(selectedRole);
    }
  }, [selectedRole, userRoleStatus, onBoardContext?.cacheUserRole]);

  const handleSetUserRoleStatus = async (role: 'company' | 'private') => {
    setUserRoleStatus(role);
    onRoleSelected(role);
    
    try {
      // Use context if available, otherwise fallback to direct AsyncStorage
      if (onBoardContext?.setUserAccountRole) {
        await onBoardContext.setUserAccountRole(role);
      } else {
        await AsyncStorage.setItem('userType', role);
      }
      console.log('✅ Role selected and saved:', role);
    } catch (error) {
      console.error('Error saving role:', error);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <MotiView
        from={{ opacity: 0, translateY: -20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 600 }}
        style={styles.content}
      >
                <Text style={styles.title}>Choose Your Role</Text>
        <Text style={styles.subtitle}>
          Select your employment status to personalize your experience
        </Text>

        <View style={styles.optionsContainer}>
          {/* Employer Option */}
          <Pressable onPress={() => handleSetUserRoleStatus('company')} style={styles.option}>
            <View
              style={[
                styles.iconBox,
                userRoleStatus === 'company' && styles.iconBoxSelected,
              ]}
            >
              <Building
                size={32}
                color={userRoleStatus === 'company' ? Palette.teal : Palette.gray400}
              />
            </View>
            <Text
              style={[
                styles.optionText,
                userRoleStatus === 'company' && styles.optionTextSelected,
              ]}
            >
              Employer
            </Text>
            <Text style={styles.optionSubtext}>
              Manage team & track productivity
            </Text>
          </Pressable>

          {/* Employee Option */}
          <Pressable onPress={() => handleSetUserRoleStatus('private')} style={styles.option}>
            <View
              style={[
                styles.iconBox,
                userRoleStatus === 'private' && styles.iconBoxSelected,
              ]}
            >
              <User
                size={32}
                color={userRoleStatus === 'private' ? Palette.teal : Palette.gray400}
              />
            </View>
            <Text
              style={[
                styles.optionText,
                userRoleStatus === 'private' && styles.optionTextSelected,
              ]}
            >
              Employee
            </Text>
            <Text style={styles.optionSubtext}>
              Track time & manage schedule
            </Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Don't worry, you can change this later in settings
          </Text>
        </View>
      </MotiView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Palette.gray900,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 30,
  },
  subtitle: {
    fontSize: 16,
    color: Palette.gray500,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 10,
    lineHeight: 22,
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: 16,
    flex: 1,
    alignItems: 'center',
  },
  option: {
    alignItems: 'center',
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: Palette.gray200,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  iconBox: {
    backgroundColor: Palette.gray50,
    padding: 16,
    borderRadius: 50,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  iconBoxSelected: {
    borderColor: Palette.teal,
    backgroundColor: Palette.gray100,
  },
  optionText: {
    fontSize: 16,
    color: Palette.gray700,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  optionTextSelected: {
    color: Palette.teal,
    fontWeight: '800',
  },
  optionSubtext: {
    fontSize: 12,
    color: Palette.gray400,
    textAlign: 'center',
    lineHeight: 16,
  },
  footer: {
    marginTop: 20,
    paddingTop: 16,
  },
  footerText: {
    fontSize: 12,
    color: Palette.gray400,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export default Slide3;
