import React, { useState, useMemo, useRef } from 'react';
import { Palette } from '@/app/constants/theme';
import {
  Modal,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  View,
  Pressable as RNPressable,
  Platform,
  KeyboardAvoidingView,
  Text as RNText,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export interface PickerItem {
  value: string;
  label: string;
}

interface SearchablePickerProps {
  items: PickerItem[];
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  label?: string;
  isDisabled?: boolean;
  emptyMessage?: string;
  accentColor?: string;
}

const SearchablePicker: React.FC<SearchablePickerProps> = ({
  items,
  value,
  onSelect,
  placeholder = 'Select...',
  label,
  isDisabled = false,
  emptyMessage = 'No results found',
  accentColor = Palette.gray700,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput>(null);

  const selectedLabel = items.find(i => i.value === value)?.label || '';

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(i => i.label.toLowerCase().includes(q));
  }, [items, query]);

  const open = () => {
    if (isDisabled) return;
    setQuery('');
    setIsOpen(true);
    setTimeout(() => searchRef.current?.focus(), 350);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const handleSelect = (item: PickerItem) => {
    onSelect(item.value);
    close();
  };

  const renderHighlight = (text: string) => {
    if (!query.trim()) {
      return <RNText style={styles.itemText}>{text}</RNText>;
    }
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) {
      return <RNText style={styles.itemText}>{text}</RNText>;
    }
    return (
      <RNText style={styles.itemText}>
        {text.substring(0, idx)}
        <RNText style={[styles.itemTextHighlight, { color: accentColor }]}>
          {text.substring(idx, idx + query.length)}
        </RNText>
        {text.substring(idx + query.length)}
      </RNText>
    );
  };

  return (
    <>
      <TouchableOpacity
        onPress={open}
        activeOpacity={isDisabled ? 1 : 0.72}
        style={[
          styles.trigger,
          {
            borderColor: value ? accentColor : Palette.gray200,
            backgroundColor: isDisabled ? Palette.gray100 : 'white',
            opacity: isDisabled ? 0.55 : 1,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <MaterialIcons
            name={value ? 'check-circle' : 'radio-button-unchecked'}
            size={20}
            color={value ? accentColor : Palette.gray400}
            style={{ marginRight: 10 }}
          />
          <View style={{ flex: 1 }}>
            {label ? (
              <RNText style={[styles.triggerLabel, { color: value ? accentColor : Palette.gray500 }]}>
                {label}
              </RNText>
            ) : null}
            <RNText
              style={[styles.triggerValue, { color: selectedLabel ? Palette.ink : Palette.gray400 }]}
              numberOfLines={1}
            >
              {selectedLabel || placeholder}
            </RNText>
          </View>
          <MaterialIcons
            name="keyboard-arrow-down"
            size={22}
            color={value ? accentColor : Palette.gray500}
          />
        </View>
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={close}
        statusBarTranslucent
      >
        <RNPressable style={styles.backdrop} onPress={close} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kvWrapper}
        >
          <View style={styles.sheet}>
            {/* Handle bar */}
            <View style={styles.handle} />

            {/* Sheet header */}
            <View style={styles.sheetHeader}>
              <RNText style={styles.sheetTitle}>{label || placeholder}</RNText>
              <TouchableOpacity
                onPress={close}
                hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}
              >
                <View style={[styles.closeButton, { backgroundColor: Palette.gray100 }]}>
                  <MaterialIcons name="close" size={16} color={Palette.gray700} />
                </View>
              </TouchableOpacity>
            </View>

            {/* Search input */}
            <View style={styles.searchRow}>
              <MaterialIcons name="search" size={20} color={Palette.gray400} style={{ marginRight: 8 }} />
              <TextInput
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${label?.toLowerCase() || 'items'}…`}
                placeholderTextColor={Palette.gray400}
                style={styles.searchInput}
                clearButtonMode="while-editing"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {Platform.OS === 'android' && query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <MaterialIcons name="cancel" size={18} color={Palette.gray400} />
                </TouchableOpacity>
              )}
            </View>

            {/* Result count */}
            <RNText style={styles.resultCount}>
              {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
              {query ? ` for "${query}"` : ''}
            </RNText>

            {/* Items list */}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 48 }}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <TouchableOpacity
                    onPress={() => handleSelect(item)}
                    activeOpacity={0.7}
                    style={[
                      styles.listItem,
                      isSelected && { backgroundColor: `${accentColor}18` },
                    ]}
                  >
                    <View
                      style={[
                        styles.radioOuter,
                        isSelected && { borderColor: accentColor, backgroundColor: accentColor },
                      ]}
                    >
                      {isSelected && <View style={styles.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      {renderHighlight(item.label)}
                    </View>
                    {isSelected && (
                      <MaterialIcons name="check" size={18} color={accentColor} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyView}>
                  <MaterialIcons name="search-off" size={44} color={Palette.gray300} />
                  <RNText style={styles.emptyText}>{emptyMessage}</RNText>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 54,
  },
  triggerLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  triggerValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  kvWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '82%',
    paddingTop: 12,
    borderTopWidth: 1.5,
    borderTopColor: Palette.gray200,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Palette.gray300,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.gray100,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.ink,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 8,
    backgroundColor: Palette.gray100,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: Palette.gray200,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Palette.ink,
  },
  resultCount: {
    fontSize: 11,
    color: Palette.gray400,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.gray100,
    gap: 12,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Palette.gray300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  itemText: {
    fontSize: 15,
    color: Palette.ink,
  },
  itemTextHighlight: {
    fontWeight: '700',
  },
  emptyView: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 14,
    color: Palette.gray400,
    marginTop: 12,
    textAlign: 'center',
  },
});

export default SearchablePicker;
