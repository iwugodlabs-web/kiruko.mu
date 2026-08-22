import { Alert, Box, Button, ButtonText, Heading, Text, VStack } from '@gluestack-ui/themed';
import { router } from 'expo-router';
import React, { Component, ReactNode } from 'react';
import i18n from '@/app/utils/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ProfileErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the error for debugging
    console.error('ProfileErrorBoundary caught an error:', error, errorInfo);
  }

  handleGoToProfile = () => {
    // Reset error state and navigate to profile
    this.setState({ hasError: false });
    router.push('/private_dashboard/profile');
  };

  handleRetry = () => {
    // Reset error state to retry
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      // Return custom fallback UI or default error message
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Box flex={1} justifyContent="center" alignItems="center" p="$4">
          <VStack space="md" alignItems="center" maxWidth="$80">
            <Alert action="error" variant="solid">
              <VStack space="xs">
                <Heading size="sm" color="$white">{i18n.t('profileErrorBoundary.title')}</Heading>
                <Text size="sm" color="$white">
                  {i18n.t('profileErrorBoundary.body')}
                </Text>
              </VStack>
            </Alert>

            <VStack space="sm" width="100%">
              <Button action="primary" onPress={this.handleGoToProfile}>
                <ButtonText>{i18n.t('profileErrorBoundary.completeBtn')}</ButtonText>
              </Button>

              <Button action="secondary" variant="outline" onPress={this.handleRetry}>
                <ButtonText>{i18n.t('profileErrorBoundary.retryBtn')}</ButtonText>
              </Button>
            </VStack>
          </VStack>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ProfileErrorBoundary;