import { useContext } from 'react';
import AuthContext from '../context/AuthContext';

const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  // Log current auth state for debugging
  console.log('useAuth - Current state:', {
    isAuthenticated: context.user?.isAuthenticated,
    isLoading: context.isLoading,
    hasUser: !!context.user,
    userId: context.user?.user_id,
    userType: context.user?.user_type,
    privateUserId: context.user?.user_type === 'company' ? null : context.user?.private_user_id
  });

  return {
    user: context.user,
    isAuthenticated: context.user?.isAuthenticated || false,
    isLoading: context.isLoading,
    login: context.login,
    logout: context.logout,
    changeUser: context.changeUser,
    checkAuth: context.checkAuth
  };
};

export default useAuth;