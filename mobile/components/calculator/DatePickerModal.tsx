import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Box, HStack, Heading, Button, ButtonText } from '@gluestack-ui/themed';
import { Platform, Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

interface DatePickerModalProps {
  showStartDatePicker: boolean;
  showEndDatePicker: boolean;
  setShowStartDatePicker: (show: boolean) => void;
  setShowEndDatePicker: (show: boolean) => void;
  watchedStartDate: Date | undefined;
  watchedEndDate: Date | undefined;
  form: any;
  DateTimePicker: any;
  primary: string;
  format: (date: Date, pattern: string) => string;
}

const DatePickerModal: React.FC<DatePickerModalProps> = ({
  showStartDatePicker,
  showEndDatePicker,
  setShowStartDatePicker,
  setShowEndDatePicker,
  watchedStartDate,
  watchedEndDate,
  form,
  DateTimePicker,
  primary,
  format
}) => {
  const { t } = useTranslation();
  const { setValue } = form;

  return (
    <>
      {/* Start Date Picker */}
      {Platform.OS === 'ios' && showStartDatePicker && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setShowStartDatePicker(false)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowStartDatePicker(false)} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <Box bg="$backgroundLight0" borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                {/* Header */}
                <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor="$borderLight200">
                  <Box w={60} />
                  <Heading size="sm" color="$textDark900">{t('calculator.startDate')}</Heading>
                  <Button variant="link" onPress={() => setShowStartDatePicker(false)}>
                    <ButtonText color={Palette.blue} fontSize={17} fontWeight="600">{t('calculator.done')}</ButtonText>
                  </Button>
                </HStack>
                {/* Picker */}
                <Box bg="white">
                  <DateTimePicker
                    value={watchedStartDate || new Date()}
                    mode="date"
                    display="spinner"
                    textColor={Palette.black}
                    onChange={(event: any, selectedDate?: Date) => {
                      if (selectedDate) {
                        setValue('startDate', selectedDate);
                      }
                    }}
                    maximumDate={watchedEndDate || new Date()}
                  />
                </Box>
              </Box>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === 'android' && showStartDatePicker && (
        <DateTimePicker
          value={watchedStartDate || new Date()}
          mode="date"
          display="default"
          onChange={(event: any, selectedDate?: Date) => {
            setShowStartDatePicker(false);
            if (selectedDate) {
              setValue('startDate', selectedDate);
            }
          }}
          maximumDate={watchedEndDate || new Date()}
        />
      )}

      {/* End Date Picker */}
      {Platform.OS === 'ios' && showEndDatePicker && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setShowEndDatePicker(false)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowEndDatePicker(false)} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <Box bg="$backgroundLight0" borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                {/* Header */}
                <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor="$borderLight200">
                  <Box w={60} />
                  <Heading size="sm" color="$textDark900">{t('calculator.endDate')}</Heading>
                  <Button variant="link" onPress={() => setShowEndDatePicker(false)}>
                    <ButtonText color={Palette.blue} fontSize={17} fontWeight="600">{t('calculator.done')}</ButtonText>
                  </Button>
                </HStack>
                {/* Picker */}
                <Box bg="white">
                  <DateTimePicker
                    value={watchedEndDate || new Date()}
                    mode="date"
                    display="spinner"
                    textColor={Palette.black}
                    onChange={(event: any, selectedDate?: Date) => {
                      if (selectedDate) {
                        setValue('endDate', selectedDate);
                      }
                    }}
                    minimumDate={watchedStartDate || undefined}
                    maximumDate={new Date()}
                  />
                </Box>
              </Box>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === 'android' && showEndDatePicker && (
        <DateTimePicker
          value={watchedEndDate || new Date()}
          mode="date"
          display="default"
          onChange={(event: any, selectedDate?: Date) => {
            setShowEndDatePicker(false);
            if (selectedDate) {
              setValue('endDate', selectedDate);
            }
          }}
          minimumDate={watchedStartDate || undefined}
          maximumDate={new Date()}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default DatePickerModal;