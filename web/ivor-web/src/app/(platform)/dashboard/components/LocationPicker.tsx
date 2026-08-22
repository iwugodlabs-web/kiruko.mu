"use client";

import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Search, Loader2, X, Navigation } from 'lucide-react';

type LocationResult = {
    display_name: string;
    lat: string;
    lon: string;
    place_id: number;
};

type Props = {
    value: string;
    lat?: number;
    lng?: number;
    onChange: (location: string, lat: number, lng: number) => void;
    placeholder?: string;
};

export default function LocationPicker({ value, lat, lng, onChange, placeholder = "Search for an address..." }: Props) {
    const [input, setInput] = useState(value || '');
    const [results, setResults] = useState<LocationResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const [gettingLocation, setGettingLocation] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | null>(null);

    // Sync input with external value
    useEffect(() => {
        if (value !== input) {
            setInput(value || '');
        }
    }, [value]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const searchLocation = async (query: string) => {
        if (query.trim().length < 3) {
            setResults([]);
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8`,
                {
                    headers: {
                        'Accept-Language': 'en',
                    }
                }
            );
            const data = await response.json();
            setResults(data || []);
        } catch (error) {
            console.error('Location search error:', error);
            setResults([]);
        } finally {
            setLoading(false);
        }
    };

    // Debounced search
    useEffect(() => {
        if (timerRef.current) window.clearTimeout(timerRef.current);

        if (input.trim().length >= 3) {
            timerRef.current = window.setTimeout(() => searchLocation(input), 300) as unknown as number;
        } else {
            setResults([]);
        }

        return () => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, [input]);

    const selectLocation = (result: LocationResult) => {
        const shortName = result.display_name.split(',').slice(0, 3).join(',').trim();
        setInput(shortName);
        onChange(shortName, parseFloat(result.lat), parseFloat(result.lon));
        setIsOpen(false);
        setResults([]);
    };

    const useCurrentLocation = () => {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }

        setGettingLocation(true);
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;

                // Reverse geocode to get address
                try {
                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
                        { headers: { 'Accept-Language': 'en' } }
                    );
                    const data = await response.json();
                    const shortName = data.display_name?.split(',').slice(0, 3).join(',').trim() || 'Current Location';
                    setInput(shortName);
                    onChange(shortName, latitude, longitude);
                } catch {
                    setInput('Current Location');
                    onChange('Current Location', latitude, longitude);
                }
                setGettingLocation(false);
            },
            (error) => {
                console.error('Geolocation error:', error);
                alert('Failed to get your location. Please check permissions.');
                setGettingLocation(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    return (
        <div ref={containerRef} className="relative">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            setIsOpen(true);
                        }}
                        onFocus={() => setIsOpen(true)}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                setHighlight(h => Math.min(h + 1, results.length - 1));
                            } else if (e.key === 'ArrowUp') {
                                setHighlight(h => Math.max(h - 1, 0));
                            } else if (e.key === 'Enter' && highlight >= 0 && results[highlight]) {
                                e.preventDefault();
                                selectLocation(results[highlight]);
                            } else if (e.key === 'Escape') {
                                setIsOpen(false);
                            }
                        }}
                        placeholder={placeholder}
                        className="w-full pl-10 pr-10 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-gray-900 dark:focus:border-gray-100 transition-all"
                    />
                    {input && (
                        <button
                            onClick={() => {
                                setInput('');
                                onChange('', 0, 0);
                                setResults([]);
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    onClick={useCurrentLocation}
                    disabled={gettingLocation}
                    className="px-4 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors flex items-center gap-2 text-gray-700 dark:text-gray-200 whitespace-nowrap disabled:opacity-50"
                >
                    {gettingLocation ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : (
                        <Navigation size={18} />
                    )}
                    <span className="hidden sm:inline">My Location</span>
                </button>
            </div>

            {/* Coordinates display */}
            {lat && lng && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <MapPin size={12} />
                    {lat.toFixed(6)}, {lng.toFixed(6)}
                </div>
            )}

            {/* Results dropdown */}
            {isOpen && (input.length >= 3 || results.length > 0) && (
                <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg max-h-72 overflow-auto z-50">
                    {loading && (
                        <div className="flex items-center gap-3 p-4 text-gray-500 dark:text-gray-400">
                            <Loader2 size={18} className="animate-spin" />
                            Searching...
                        </div>
                    )}

                    {!loading && results.length === 0 && input.length >= 3 && (
                        <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                            <MapPin className="mx-auto mb-2 text-gray-300 dark:text-gray-600" size={24} />
                            <div className="text-sm">No locations found</div>
                            <div className="text-xs mt-1">Try a different search term</div>
                        </div>
                    )}

                    {!loading && results.length > 0 && (
                        <>
                            <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                                Search results ({results.length})
                            </div>
                            {results.map((result, idx) => {
                                const highlighted = highlight === idx;
                                const parts = result.display_name.split(',');
                                const mainPart = parts.slice(0, 2).join(',');
                                const subPart = parts.slice(2, 4).join(',');

                                return (
                                    <button
                                        key={result.place_id}
                                        type="button"
                                        onMouseEnter={() => setHighlight(idx)}
                                        onClick={() => selectLocation(result)}
                                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${highlighted ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
                                    >
                                        <MapPin size={18} className="text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{mainPart}</div>
                                            {subPart && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{subPart}</div>}
                                        </div>
                                    </button>
                                );
                            })}
                        </>
                    )}

                    {!loading && input.length < 3 && (
                        <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                            Type at least 3 characters to search
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
