import React, { useState } from 'react';
import { Palette } from '@/app/constants/theme';
import {
  Box,
  Button,
  ButtonText,
  FormControl,
  FormControlLabel,
  FormControlLabelText,
  HStack,
  Input,
  InputField,
  Text,
  VStack,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionTitleText,
  AccordionContent,
  AccordionIcon,
} from '@gluestack-ui/themed';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import { Alert, TouchableOpacity } from 'react-native';

interface EmployerFormData {
  employer: string;
  employerBrn: string;
  employerEmail: string;
  employerPhone: string;
  employerAddress: string;
  job: string;
  isPrimary: boolean;
}

interface MultipleEmployerFormProps {
  maxEmployers?: number;
}

export default function MultipleEmployerForm({ maxEmployers = 3 }: MultipleEmployerFormProps) {
  const { t } = useTranslation();
  const { control, watch } = useFormContext();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "employers"
  });

  const addEmployer = () => {
    if (fields.length >= maxEmployers) {
      Alert.alert(t('multipleEmployer.limitReachedTitle'), t('multipleEmployer.limitReachedBody', { count: maxEmployers }));
      return;
    }

    const newEmployer: EmployerFormData = {
      employer: '',
      employerBrn: '',
      employerEmail: '',
      employerPhone: '',
      employerAddress: '',
      job: '',
      isPrimary: fields.length === 0, // First employer is primary by default
    };

    append(newEmployer);
  };

  const removeEmployer = (index: number) => {
    if (fields.length <= 1) {
      Alert.alert(t('multipleEmployer.cannotRemoveTitle'), t('multipleEmployer.cannotRemoveBody'));
      return;
    }

    const employers = watch('employers');
    const employerToRemove = employers[index];

    // If removing primary employer, make the first remaining one primary
    if (employerToRemove?.isPrimary && fields.length > 1) {
      Alert.alert(
        t('multipleEmployer.primaryEmployerTitle'),
        t('multipleEmployer.primaryEmployerBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('multipleEmployer.remove'),
            style: 'destructive',
            onPress: () => {
              remove(index);
              // Set the first employer as primary after removal
              if (index === 0 && fields.length > 1) {
                // Will be handled by the form logic
              }
            }
          }
        ]
      );
    } else {
      remove(index);
    }
  };

  const setPrimaryEmployer = (index: number) => {
    const employers = watch('employers');
    employers.forEach((emp: any, i: number) => {
      emp.isPrimary = i === index;
    });
  };

  return (
    <VStack space="lg">
      {/* Header */}
      <HStack justifyContent="space-between" alignItems="center">
        <Text size="lg" fontWeight="bold">{t('multipleEmployer.employmentInfo')}</Text>
        <Button
          size="sm"
          variant="outline"
          onPress={addEmployer}
          isDisabled={fields.length >= maxEmployers}
        >
          <ButtonText>{t('multipleEmployer.addEmployer')}</ButtonText>
        </Button>
      </HStack>

      {/* Info Text */}
      <Box bg="$blue50" p="$3" borderRadius="$lg">
        <Text size="sm" color="$blue700">
          {t('multipleEmployer.infoText', { count: maxEmployers })}
        </Text>
      </Box>

      {/* Employers List */}
      <VStack space="md">
        {fields.map((field, index) => {
          const isPrimary = watch(`employers.${index}.isPrimary`);
          
          return (
            <Accordion key={field.id} variant="filled">
              <AccordionItem value={`employer-${index}`}>
                <AccordionHeader>
                  <AccordionTrigger>
                    <HStack justifyContent="space-between" alignItems="center" flex={1}>
                      <VStack>
                        <HStack space="sm" alignItems="center">
                          <AccordionTitleText>
                            {watch(`employers.${index}.employer`) || t('multipleEmployer.employerN', { number: index + 1 })}
                          </AccordionTitleText>
                          {isPrimary && (
                            <Box bg="$green500" px="$2" py="$1" borderRadius="$sm">
                              <Text size="xs" color="white" fontWeight="bold">{t('multipleEmployer.primary')}</Text>
                            </Box>
                          )}
                        </HStack>
                        <Text size="sm" color="$gray600">
                          {watch(`employers.${index}.job`) || t('multipleEmployer.jobTitleNotSet')}
                        </Text>
                      </VStack>
                      
                      <HStack space="sm" alignItems="center">
                        {!isPrimary && fields.length > 1 && (
                          <TouchableOpacity
                            onPress={() => setPrimaryEmployer(index)}
                            style={{ padding: 8 }}
                          >
                            <MaterialIcons name="star-border" size={20} color={Palette.gray500} />
                          </TouchableOpacity>
                        )}
                        
                        {fields.length > 1 && (
                          <TouchableOpacity
                            onPress={() => removeEmployer(index)}
                            style={{ padding: 8 }}
                          >
                            <MaterialIcons name="delete-outline" size={20} color={Palette.errorAlt} />
                          </TouchableOpacity>
                        )}
                        
                        <AccordionIcon />
                      </HStack>
                    </HStack>
                  </AccordionTrigger>
                </AccordionHeader>

                <AccordionContent>
                  <VStack space="md" p="$2">
                    {/* Company Information */}
                    <Text fontWeight="semibold" color="$gray700">{t('multipleEmployer.companyInfo')}</Text>
                    
                    <Controller
                      control={control}
                      name={`employers.${index}.employer`}
                      render={({ field: { onChange, value }, fieldState: { error } }) => (
                        <FormControl isInvalid={!!error}>
                          <FormControlLabel>
                            <FormControlLabelText>{t('multipleEmployer.companyName')}</FormControlLabelText>
                          </FormControlLabel>
                          <Input>
                            <InputField
                              value={value}
                              onChangeText={onChange}
                              placeholder={t('multipleEmployer.companyNamePlaceholder')}
                            />
                          </Input>
                        </FormControl>
                      )}
                    />

                    <Controller
                      control={control}
                      name={`employers.${index}.employerBrn`}
                      render={({ field: { onChange, value }, fieldState: { error } }) => (
                        <FormControl isInvalid={!!error}>
                          <FormControlLabel>
                            <FormControlLabelText>{t('multipleEmployer.companyBrn')}</FormControlLabelText>
                          </FormControlLabel>
                          <Input>
                            <InputField
                              value={value}
                              onChangeText={onChange}
                              placeholder={t('multipleEmployer.companyBrnPlaceholder')}
                            />
                          </Input>
                        </FormControl>
                      )}
                    />

                    <Controller
                      control={control}
                      name={`employers.${index}.job`}
                      render={({ field: { onChange, value }, fieldState: { error } }) => (
                        <FormControl isInvalid={!!error}>
                          <FormControlLabel>
                            <FormControlLabelText>{t('multipleEmployer.jobTitle')}</FormControlLabelText>
                          </FormControlLabel>
                          <Input>
                            <InputField
                              value={value}
                              onChangeText={onChange}
                              placeholder={t('multipleEmployer.jobTitlePlaceholder')}
                            />
                          </Input>
                        </FormControl>
                      )}
                    />

                    <Controller
                      control={control}
                      name={`employers.${index}.employerEmail`}
                      render={({ field: { onChange, value }, fieldState: { error } }) => (
                        <FormControl isInvalid={!!error}>
                          <FormControlLabel>
                            <FormControlLabelText>{t('multipleEmployer.companyEmail')}</FormControlLabelText>
                          </FormControlLabel>
                          <Input>
                            <InputField
                              value={value}
                              onChangeText={onChange}
                              placeholder={t('multipleEmployer.companyEmailPlaceholder')}
                              keyboardType="email-address"
                            />
                          </Input>
                        </FormControl>
                      )}
                    />

                    <Controller
                      control={control}
                      name={`employers.${index}.employerPhone`}
                      render={({ field: { onChange, value }, fieldState: { error } }) => (
                        <FormControl isInvalid={!!error}>
                          <FormControlLabel>
                            <FormControlLabelText>{t('multipleEmployer.companyPhone')}</FormControlLabelText>
                          </FormControlLabel>
                          <Input>
                            <InputField
                              value={value}
                              onChangeText={onChange}
                              placeholder={t('multipleEmployer.companyPhonePlaceholder')}
                              keyboardType="phone-pad"
                            />
                          </Input>
                        </FormControl>
                      )}
                    />

                    <Controller
                      control={control}
                      name={`employers.${index}.employerAddress`}
                      render={({ field: { onChange, value }, fieldState: { error } }) => (
                        <FormControl isInvalid={!!error}>
                          <FormControlLabel>
                            <FormControlLabelText>{t('multipleEmployer.companyAddress')}</FormControlLabelText>
                          </FormControlLabel>
                          <Input>
                            <InputField
                              value={value}
                              onChangeText={onChange}
                              placeholder={t('multipleEmployer.companyAddressPlaceholder')}
                              multiline
                              numberOfLines={2}
                            />
                          </Input>
                        </FormControl>
                      )}
                    />

                    {/* Primary Employer Toggle */}
                    <HStack justifyContent="space-between" alignItems="center" pt="$2">
                      <Text color="$gray700">{t('multipleEmployer.setAsPrimary')}</Text>
                      <Button
                        size="sm"
                        variant={isPrimary ? "solid" : "outline"}
                        onPress={() => setPrimaryEmployer(index)}
                        isDisabled={isPrimary}
                      >
                        <ButtonText>{isPrimary ? t('multipleEmployer.primaryBtn') : t('multipleEmployer.setPrimaryBtn')}</ButtonText>
                      </Button>
                    </HStack>
                  </VStack>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        })}
      </VStack>

      {/* Add First Employer Button (if none exist) */}
      {fields.length === 0 && (
        <Button onPress={addEmployer}>
          <ButtonText>{t('multipleEmployer.addFirstEmployer')}</ButtonText>
        </Button>
      )}
    </VStack>
  );
}