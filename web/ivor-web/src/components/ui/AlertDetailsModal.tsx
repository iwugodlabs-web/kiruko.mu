import { X, Clock, AlertTriangle, ArrowRight, User, Calendar, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

export interface AlertItem {
    id?: number | string;
    user_id?: number | string;
    name?: string;
    title?: string;
    job_title?: string;
    start_time?: string;
    due_date?: string;
    duration_hours?: number;
    assignee?: string;
}

interface AlertDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'overtime' | 'overdueTasks' | 'docs' | 'attendance';
    items: AlertItem[];
}

export default function AlertDetailsModal({ isOpen, onClose, type, items }: AlertDetailsModalProps) {
    const router = useRouter();

    if (!isOpen) return null;

    const configs: Record<string, {
        title: string;
        description: string;
        icon: any;
        color: string;
        bgLight: string;
        iconBg: string;
        iconColor: string;
        btnColor: string;
        btnHover: string;
        path: string;
    }> = {
        overtime: {
            title: 'Active Overtime Alerts',
            description: 'Employees working beyond standard shift hours (9h+)',
            icon: AlertTriangle,
            color: 'red',
            bgLight: 'bg-red-50/50 dark:bg-red-950/40',
            iconBg: 'bg-red-100 dark:bg-red-950/40',
            iconColor: 'text-red-600 dark:text-red-400',
            btnColor: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
            btnHover: 'hover:bg-red-100 dark:hover:bg-red-900/40',
            path: '/dashboard/employees'
        },
        overdueTasks: {
            title: 'Overdue Task Nodes',
            description: 'Tasks that have passed their due date lifecycle',
            icon: Clock,
            color: 'orange',
            bgLight: 'bg-orange-50/50 dark:bg-orange-950/40',
            iconBg: 'bg-orange-100 dark:bg-orange-950/40',
            iconColor: 'text-orange-600 dark:text-orange-400',
            btnColor: 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400',
            btnHover: 'hover:bg-orange-100 dark:hover:bg-orange-900/40',
            path: '/dashboard/tasks'
        },
        docs: {
            title: 'Expiring Credentials',
            description: 'Registry nodes with documents nearing expiration boundary',
            icon: FileText,
            color: 'amber',
            bgLight: 'bg-amber-50/50 dark:bg-amber-950/40',
            iconBg: 'bg-amber-100 dark:bg-amber-950/40',
            iconColor: 'text-amber-600 dark:text-amber-400',
            btnColor: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
            btnHover: 'hover:bg-amber-100 dark:hover:bg-amber-900/40',
            path: '/dashboard/employees'
        },
        attendance: {
            title: 'Frequency Anomalies',
            description: 'Scheduled nodes failing to sync with the matrix heartbeat',
            icon: Clock,
            color: 'rose',
            bgLight: 'bg-rose-50/50 dark:bg-rose-950/40',
            iconBg: 'bg-rose-100 dark:bg-rose-950/40',
            iconColor: 'text-rose-600 dark:text-rose-400',
            btnColor: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400',
            btnHover: 'hover:bg-rose-100 dark:hover:bg-rose-900/40',
            path: '/dashboard/employees'
        }
    };

    const config = configs[type] || configs.overtime;
    const Icon = config.icon;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl transform transition-all animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between ${config.bgLight}`}>
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${config.iconBg} ${config.iconColor}`}>
                            <Icon className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{config.title}</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{config.description}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto flex-1 p-6">
                    {items.length === 0 ? (
                        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                            <p>No active anomalies found in this sector.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {items.map((item, idx) => (
                                <div
                                    key={idx}
                                    className="group flex items-center justify-between p-4 bg-gray-50/50 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800 border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${config.iconBg} ${config.iconColor}`}>
                                            {item.name ? item.name.charAt(0).toUpperCase() : (item.title ? item.title.charAt(0).toUpperCase() : '?')}
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-gray-900 dark:text-white line-clamp-1">
                                                {item.name || item.title}
                                            </h3>
                                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                                {type === 'overtime' ? (
                                                    <>
                                                        <span className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-xs">{item.job_title || 'Employee'}</span>
                                                        <span>• {item.duration_hours}h active</span>
                                                    </>
                                                ) : type === 'docs' ? (
                                                    <>
                                                        <FileText className="w-3 h-3" />
                                                        <span>Node: {item.id}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Calendar className="w-3 h-3" />
                                                        <span>Sync Point: {item.due_date || item.start_time ? new Date(item.due_date || item.start_time || '').toLocaleDateString() : 'Unknown'}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            onClose();
                                            router.push(config.path);
                                        }}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${config.btnColor} ${config.btnHover}`}
                                    >
                                        <span>Execute</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/60 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                        Close Registry
                    </button>
                </div>
            </div>
        </div>
    );
}
