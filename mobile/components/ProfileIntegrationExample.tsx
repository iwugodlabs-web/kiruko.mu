// @ts-nocheck
// Example integration for the profile.tsx component
// This shows how to modify the existing profile component to support multiple employers

import React from 'react';
import { Alert, SafeAreaView, ScrollView } from 'react-native';
import { Button, ButtonText } from '@gluestack-ui/themed';
import { router } from 'expo-router';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import MultipleEmployerForm from '@/components/MultipleEmployerForm';
import { createMultipleJobs } from '@/services/api';

// Updated schema for multiple employers
const multipleEmployerSchema = z.object({
  // Personal information (existing fields)
  gender: z.enum(['Male', 'Female', 'Other', '']).optional(),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  passportNumber: z.string().min(1, 'Passport number is required'),
  
  // Multiple employers array
  employers: z.array(z.object({
    employer: z.string().min(1, 'Company name is required'),
    employerBrn: z.string().min(1, 'Company BRN is required'),
    employerEmail: z.string().email('Invalid email'),
    employerPhone: z.string().min(1, 'Company phone is required'),
    employerAddress: z.string().min(1, 'Company address is required'),
    job: z.string().min(1, 'Job title is required'),
    isPrimary: z.boolean().default(false),
    
    // Job-specific fields (can be different for each employer)
    startDate: z.string().min(1, 'Start date is required'),
    startTime: z.string().min(1, 'Start time is required'),
    endTime: z.string().min(1, 'End time is required'),
    workDays: z.record(z.string(), z.string()).default({}),
    monthlySalary: z.string().min(1, 'Monthly salary is required'),
    
    // Employment conditions (can vary by employer)
    hasContract: z.enum(['true', 'false', '']).optional(),
    hasPermit: z.enum(['true', 'false', '']).optional(),
    permitType: z.enum(['occupational', 'work', 'none', '']).optional(),
    isWorkingOnTouristVisa: z.enum(['true', 'false', '']).optional(),
    salaryDeductions: z.enum(['true', 'false', '']).optional(),
    deductionReasons: z.record(z.enum(['Food', 'Lodging', 'Transport', 'Uniform']), z.boolean()).default({}),
    housingCovered: z.enum(['true', 'false', '']).optional(),
    isDormitory: z.enum(['true', 'false', '']).optional(),
    isDecentHousing: z.enum(['true', 'false', '']).optional(),
    passportHeld: z.enum(['true', 'false', '']).optional(),
    workMatchPromise: z.enum(['true', 'false', '']).optional(),
    doubtsAboutCompensation: z.enum(['true', 'false', '']).optional(),
  })).min(1, 'At least one employer is required')
  .refine(employers => employers.filter(emp => emp.isPrimary).length === 1, {
    message: 'Exactly one employer must be marked as primary',
  }),
});

export default function ProfileWithMultipleEmployers() {
  const methods = useForm({
    resolver: zodResolver(multipleEmployerSchema),
    defaultValues: {
      employers: [{
        employer: '',
        employerBrn: '',
        employerEmail: '',
        employerPhone: '',
        employerAddress: '',
        job: '',
        isPrimary: true, // First employer is primary by default
        startDate: '',
        startTime: '',
        endTime: '',
        workDays: {},
        monthlySalary: '',
        hasContract: '',
        hasPermit: '',
        permitType: '',
        isWorkingOnTouristVisa: '',
        salaryDeductions: '',
        deductionReasons: {},
        housingCovered: '',
        isDormitory: '',
        isDecentHousing: '',
        passportHeld: '',
        workMatchPromise: '',
        doubtsAboutCompensation: '',
      }]
    }
  });

  const onSubmit = async (data: any) => {
    try {
      // Transform data for API
      const jobsData = data.employers.map((employer: any) => ({
        // Personal data (same for all jobs)
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        passportNumber: data.passportNumber,
        
        // Employer-specific data
        employer: employer.employer,
        employerBrn: employer.employerBrn,
        employerEmail: employer.employerEmail,
        employerPhone: employer.employerPhone,
        employerAddress: employer.employerAddress,
        job: employer.job,
        isPrimary: employer.isPrimary,
        
        // Job conditions
        startDate: employer.startDate,
        startTime: employer.startTime,
        endTime: employer.endTime,
        workDays: employer.workDays,
        monthlySalary: employer.monthlySalary,
        hasContract: employer.hasContract,
        hasPermit: employer.hasPermit,
        permitType: employer.permitType,
        isWorkingOnTouristVisa: employer.isWorkingOnTouristVisa,
        salaryDeductions: employer.salaryDeductions,
        deductionReasons: employer.deductionReasons,
        housingCovered: employer.housingCovered,
        isDormitory: employer.isDormitory,
        isDecentHousing: employer.isDecentHousing,
        passportHeld: employer.passportHeld,
        workMatchPromise: employer.workMatchPromise,
        doubtsAboutCompensation: employer.doubtsAboutCompensation,
      }));

      console.log('Submitting multiple jobs:', jobsData);
      
      const result = await createMultipleJobs(jobsData);
      
      if (result.error) {
        Alert.alert('Error', result.error);
      } else {
        Alert.alert(
          'Success!', 
          `${result.successfulJobs} of ${result.totalJobs} jobs created successfully. Your employers will be notified for verification.`,
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigate to dashboard or next step
                router.push('/private_dashboard/home');
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error('Submission error:', error);
      Alert.alert('Error', 'Failed to submit job information. Please try again.');
    }
  };

  return (
    <FormProvider {...methods}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          
          {/* Personal Information Section (existing) */}
          {/* ... existing personal info fields ... */}
          
          {/* Multiple Employers Section */}
          <MultipleEmployerForm maxEmployers={3} />
          
          {/* Submit Button */}
          <Button onPress={methods.handleSubmit(onSubmit)} mt="$4">
            <ButtonText>Submit Employment Information</ButtonText>
          </Button>
          
        </ScrollView>
      </SafeAreaView>
    </FormProvider>
  );
}

// Key integration points:
// 1. Use FormProvider to wrap the entire form
// 2. Include MultipleEmployerForm component
// 3. Update schema to handle employers array
// 4. Transform data for API submission
// 5. Use createMultipleJobs API function
// 6. Handle success/error responses appropriately