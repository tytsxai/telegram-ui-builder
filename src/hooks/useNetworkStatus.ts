import { useState, useEffect } from 'react';
import { toast } from 'sonner';

export const useNetworkStatus = () => {
    const isClient = typeof window !== "undefined" && typeof navigator !== "undefined";
    const [isOffline, setIsOffline] = useState(() => (isClient ? !navigator.onLine : false));

    useEffect(() => {
        const handleOnline = () => {
            setIsOffline(false);
            toast.success("网络已连接");
        };
        const handleOffline = () => {
            setIsOffline(true);
            toast.error("网络已断开，进入离线模式");
        };

        if (!isClient) return;
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [isClient]);

    return isOffline;
};
