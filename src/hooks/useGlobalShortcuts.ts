import { useEffect } from 'react';

interface UseGlobalShortcutsProps {
    onUndo: () => void;
    onRedo: () => void;
    onSave: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

export const useGlobalShortcuts = ({
    onUndo,
    onRedo,
    onSave,
    canUndo,
    canRedo,
}: UseGlobalShortcutsProps) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check for Cmd (Mac) or Ctrl (Windows/Linux)
            const isCmdOrCtrl = e.metaKey || e.ctrlKey;

            if (isCmdOrCtrl) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        if (e.shiftKey) {
                            if (canRedo) onRedo();
                        } else {
                            if (canUndo) onUndo();
                        }
                        break;
                    case 's':
                        e.preventDefault();
                        onSave();
                        break;
                    // Add more shortcuts here
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onUndo, onRedo, onSave, canUndo, canRedo]);
};
