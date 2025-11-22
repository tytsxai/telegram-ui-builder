import { useState, useEffect } from 'react';
import { toast } from 'sonner';

export const useNetworkStatus = () => {
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const handleOnline = () => {
            setIsOffline(false);
            toast.success("网络已连接");
        };
        const handleOffline = () => {
            setIsOffline(true);
            toast.error("网络已断开，进入离线模式");
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOffline;
};
