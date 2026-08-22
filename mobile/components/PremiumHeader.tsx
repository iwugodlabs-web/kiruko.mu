import React from 'react';
import { Palette } from '@/app/constants/theme';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Box, HStack, VStack, Heading, Text } from '@gluestack-ui/themed';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';

interface PremiumHeaderProps {
    title: string;
    subtitle?: string;
    showBack?: boolean;
    onBack?: () => void;
    rightElement?: React.ReactNode;
    zIndex?: number;
}

export const PremiumHeader: React.FC<PremiumHeaderProps> = ({
    title,
    subtitle,
    showBack = true,
    onBack,
    rightElement,
    zIndex = 100
}) => {
    const router = useRouter();

    return (
        <Box px="$6" py="$4" zIndex={zIndex}>
            <HStack justifyContent="space-between" alignItems="center">
                {showBack ? (
                    <TouchableOpacity
                        onPress={onBack || (() => router.back())}
                        style={styles.backButton}
                    >
                        <ArrowLeft size={24} color={Palette.gray800} />
                    </TouchableOpacity>
                ) : (
                    <Box w={44} />
                )}

                <VStack flex={1} alignItems="center">
                    <Heading
                        size="xl"
                        fontWeight="800"
                        color={Palette.gray800}
                        style={{ letterSpacing: -1, textAlign: 'center' }}
                        numberOfLines={1}
                    >
                        {title}
                    </Heading>
                    {subtitle ? (
                        <Text size="sm" color={Palette.gray500} numberOfLines={1} style={{ textAlign: 'center' }}>
                            {subtitle}
                        </Text>
                    ) : null}
                </VStack>

                {rightElement ? (
                    <Box minWidth={44} alignItems="flex-end">
                        {rightElement}
                    </Box>
                ) : (
                    <Box w={44} />
                )}
            </HStack>
        </Box>
    );
};

const styles = StyleSheet.create({
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 3,
    },
});
