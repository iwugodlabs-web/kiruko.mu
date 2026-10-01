import React, { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Root error boundary.
 *
 * Without this, any render/lifecycle error unmounts the entire provider tree,
 * which (because the tree is wrapped in <Suspense fallback={<BrandSplash/>}>)
 * looks like the app reloading to the splash screen. That is exactly the
 * symptom seen when connectivity flips: a transient render error took the
 * whole app down. Catching it here keeps the app on screen and offers a retry
 * instead of a full reload.
 *
 * Uses plain react-native primitives on purpose — it renders OUTSIDE the
 * GlueStack/i18n/PostHog providers, so it must not depend on them.
 */
class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected error. You can try again — your data is safe.
          </Text>
          <Pressable style={styles.button} onPress={this.handleRetry}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#16203B',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#F2B705',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
});

export default AppErrorBoundary;
