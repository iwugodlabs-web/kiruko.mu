import React, { useRef, useEffect } from 'react';
import { Keyboard } from 'react-native';
import { Input, InputField, InputIcon, InputSlot, Text, Box } from '@gluestack-ui/themed';
import { Controller, Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

interface CalculatorInputProps {
    control: Control<any>;
    name: string;
    icon?: any;
    placeholder?: string;
    keyboardType?: any;
    secure?: boolean;
    valueToggle?: () => void;
    readOnly?: boolean;
    isDisabled?: boolean;
    autoFocus?: boolean;
    blurOnSubmit?: boolean;
    returnKeyType?: any;
    showDismiss?: boolean;
}

// Inner Input Component (Stable Identity)
const GlobalInputInner = ({
    field,
    fieldState,
    icon,
    placeholder,
    name,
    keyboardType,
    secure,
    valueToggle,
    readOnly,
    isDisabled,
    autoFocus,
    blurOnSubmit,
    returnKeyType,
    showDismiss,
}: any) => {
    const { t } = useTranslation();
    const inputRef = useRef<any>(null);
    const { onChange, onBlur, value } = field;
    const focusedRef = useRef(false);

    // Detect numeric keyboard types early so helpers and effects can use it
    const numericKeyboards = ['numeric', 'number-pad', 'decimal-pad', 'phone-pad'];
    const isNumeric = numericKeyboards.includes(String(keyboardType));

    useEffect(() => {
        if (focusedRef.current) {
            try {
                requestAnimationFrame(() => {
                    try { inputRef.current?.focus && inputRef.current.focus(); } catch (e) { }
                });
            } catch (e) {
                try { inputRef.current?.focus && inputRef.current.focus(); } catch (e) { }
            }
        }
    }, [value]);

    return (
        <>
            <Input size="xl" variant="rounded" rounded="$xl" isDisabled={isDisabled} bg="$backgroundLight50" borderColor="$borderLight300" minHeight={56}>
                {icon && (
                    <InputSlot pl="$4">
                        {/* Render icon directly if it's a component or node */}
                        {React.isValidElement(icon) ? icon : <InputIcon as={() => icon} style={{ width: 18, height: 18 }} />}
                    </InputSlot>
                )}
                <InputField
                    ref={inputRef}
                    placeholder={placeholder}
                    autoCapitalize="none"
                    onChangeText={onChange}
                    onBlur={(e: any) => {
                        focusedRef.current = false;
                        onBlur(e);
                    }}
                    onFocus={() => { focusedRef.current = true; }}
                    onSubmitEditing={(e) => {
                        // Prevent keyboard dismissal for numeric inputs - keep focus
                        try {
                            if (isNumeric && inputRef.current) {
                                e.preventDefault?.();
                                inputRef.current.focus();
                            }
                        } catch (e) { }
                    }}
                    value={value as any}
                    keyboardType={keyboardType}
                    type={secure ? 'password' : 'text'}
                    readOnly={readOnly}
                    autoFocus={autoFocus}
                    blurOnSubmit={isNumeric ? false : blurOnSubmit}
                    returnKeyType={returnKeyType}
                />
                {valueToggle && (
                    <InputSlot pr="$4" onPress={valueToggle}>
                        <InputIcon as={() => valueToggle} style={{ width: 18, height: 18 }} />
                    </InputSlot>
                )}
                {showDismiss && (
                    <InputSlot pr="$4" onPress={() => {
                        try {
                            if (inputRef?.current && typeof inputRef.current.blur === 'function') {
                                inputRef.current.blur();
                            }
                        } catch (e) { }
                        try { Keyboard.dismiss(); } catch (e) { }
                    }}>
                        <Text color="$text600" fontSize={14}>{t('calculator.done')}</Text>
                    </InputSlot>
                )}
            </Input>
            {fieldState.error && (
                <Text color="$error500" mt="$1">
                    {fieldState.error.message as string}
                </Text>
            )}
        </>
    );
};

const CalculatorInput: React.FC<CalculatorInputProps> = ({
    control,
    name,
    icon,
    placeholder,
    keyboardType,
    secure,
    valueToggle,
    readOnly,
    isDisabled,
    autoFocus,
    blurOnSubmit,
    returnKeyType,
    showDismiss,
}) => {
    return (
        <Box w="100%" mt="$2">
            <Controller
                control={control}
                name={name}
                render={({ field, fieldState }) => (
                    <GlobalInputInner
                        field={field}
                        fieldState={fieldState}
                        icon={icon}
                        placeholder={placeholder}
                        name={name}
                        keyboardType={keyboardType}
                        secure={secure}
                        valueToggle={valueToggle}
                        readOnly={readOnly}
                        isDisabled={isDisabled}
                        autoFocus={autoFocus}
                        blurOnSubmit={blurOnSubmit}
                        returnKeyType={returnKeyType}
                        showDismiss={showDismiss}
                    />
                )}
            />
        </Box>
    );
};

export default CalculatorInput;
