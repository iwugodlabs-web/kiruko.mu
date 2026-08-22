import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Box, Spinner, Text, VStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import useAuth from '../hooks/useAuth';

interface DashboardWrapperProps {
  children: React.ReactNode;
}

const DashboardWrapper: React.FC<DashboardWrapperProps> = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  // Early return if still loading authentication
  if (authLoading) {
    return (
      <Box flex={1} bg="$gray50" justifyContent="center" alignItems="center">
        <VStack space="lg" alignItems="center">
          <Spinner size="large" color="$blue600" />
          <Text color="$blue600" fontSize={16} fontWeight="600">
            Authenticating...
          </Text>
        </VStack>
      </Box>
    );
  }

  // Early return if not authenticated
  if (!isAuthenticated || !user?.private_user_id) {
    return (
      <Box flex={1} bg="$gray50" justifyContent="center" alignItems="center">
        <VStack space="lg" alignItems="center" maxWidth="80%">
          <Box bg="$red50" p="$4" rounded="$full">
            <MaterialIcons name="error-outline" size={48} color={Palette.errorAlt} />
          </Box>
          <Text color="$red700" fontSize={18} fontWeight="700" textAlign="center">
            Authentication Required
          </Text>
          <Text color="$gray600" fontSize={14} textAlign="center">
            Please log in to view your dashboard
          </Text>
        </VStack>
      </Box>
    );
  }

  // Safe check for user data
  if (!user) {
    return (
      <Box flex={1} bg="$gray50" justifyContent="center" alignItems="center">
        <VStack space="lg" alignItems="center">
          <Box bg={Palette.goldTint} p="$4" rounded="$full">
            <MaterialIcons name="person-outline" size={48} color={Palette.gold} />
          </Box>
          <Text color={Palette.ink} fontSize={18} fontWeight="700" textAlign="center">
            User Data Not Available
          </Text>
          <Text color="$gray600" fontSize={14} textAlign="center">
            Please try again in a moment
          </Text>
        </VStack>
      </Box>
    );
  }

  // Wrap children in an error boundary
  try {
    return (
      <Box flex={1} bg="$gray50">
        {children}
      </Box>
    );
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    return (
      <Box flex={1} bg="$gray50" justifyContent="center" alignItems="center">
        <VStack space="lg" alignItems="center">
          <Box bg="$red50" p="$4" rounded="$full">
            <MaterialIcons name="error-outline" size={48} color={Palette.errorAlt} />
          </Box>
          <Text color="$red700" fontSize={18} fontWeight="700" textAlign="center">
            Something went wrong
          </Text>
          <Text color="$gray600" fontSize={14} textAlign="center">
            Please try again later
          </Text>
        </VStack>
      </Box>
    );
  }
};

export default DashboardWrapper;