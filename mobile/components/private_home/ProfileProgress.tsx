import { MaterialIcons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import { Box, HStack, Text, VStack, Pressable, Progress, ProgressFilledTrack } from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import React from 'react';
import Animated, { FadeIn } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';

interface ProfileProgressProps {
  profileData: {
    gender?: string;
    date_of_birth?: string;
    pass_port_number?: string;
  } | null;
  jobData: {
    job_title?: string;
    employer_name?: string;
    work_start_time?: string;
    work_end_time?: string;
    work_days?: Record<string, string>;
  } | null;
}

const ProfileProgress: React.FC<ProfileProgressProps> = ({ profileData, jobData }) => {
  const router = useRouter();
  const { t } = useTranslation();

  const fields = [
    profileData?.gender,
    profileData?.date_of_birth,
    profileData?.pass_port_number,
    jobData?.job_title,
    jobData?.employer_name,
    jobData?.work_start_time,
    jobData?.work_end_time,
    jobData?.work_days && Object.keys(jobData.work_days).length > 0 ? 'yes' : undefined,
  ];

  const filled = fields.filter(Boolean).length;
  const total = fields.length;
  const percentage = Math.round((filled / total) * 100);

  if (percentage === 100) return null;

  return (
    <Animated.View entering={FadeIn.duration(500).delay(100)}>
      <Pressable onPress={() => router.push('/private_dashboard/profile' as any)}>
        <Box
          bg="white"
          p="$4"
          rounded="$2xl"
          borderWidth={1}
          borderColor="$borderLight100"
          shadowColor="$shadowColor"
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.06}
          shadowRadius={8}
          elevation={3}
        >
          <HStack alignItems="center" space="sm" mb="$3">
            <Box bg="rgba(236, 72, 153, 0.1)" p="$2" rounded="$full">
              <MaterialIcons name="person" size={20} color={Palette.violet} />
            </Box>
            <VStack flex={1}>
              <Text fontSize={14} fontWeight="800" color="$textDark900">{t('privateHomeCards.completeProfile')}</Text>
              <Text fontSize={11} color="$textLight500" fontWeight="600">{t('privateHomeCards.profilePercent', { percentage, remaining: total - filled })}</Text>
            </VStack>
            <MaterialIcons name="chevron-right" size={20} color={Palette.gray400} />
          </HStack>
          <Progress value={percentage} size="sm" bg="$backgroundLight100" rounded="$full">
            <ProgressFilledTrack bg={percentage > 60 ? Palette.green : percentage > 30 ? Palette.warning : Palette.errorAlt} rounded="$full" />
          </Progress>
        </Box>
      </Pressable>
    </Animated.View>
  );
};

export default ProfileProgress;
