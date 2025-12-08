import React, { Suspense, lazy } from "react";
import ButtonEditDialog from "@/components/ButtonEditDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBuilderDialogs } from "./BuilderProvider";
import TemplateSelector from "@/components/TemplateSelector";
import OnboardingGuide from "@/components/OnboardingGuide";

const TemplateFlowDiagram = lazy(() => import("@/components/TemplateFlowDiagram"));
const CircularReferenceDialog = lazy(() => import("@/components/CircularReferenceDialog"));

export const BuilderDialogs = () => {
  const {
    buttonEditor,
    importDialog,
    renameDialog,
    flowDiagram,
    circularDialog,
    templateLibrary,
    onboarding,
  } = useBuilderDialogs();

  return (
    <>
      {buttonEditor.data && (
        <ButtonEditDialog
          open={buttonEditor.open}
          onOpenChange={(open) => {
            if (!open) {
              buttonEditor.onClose();
            }
          }}
          button={buttonEditor.data.button}
          onSave={buttonEditor.onSave}
          screens={buttonEditor.screens}
          onOpenScreen={buttonEditor.onOpenScreen}
          onCreateAndOpenScreen={buttonEditor.onCreateAndOpen}
        />
      )}

      <Dialog open={importDialog.open} onOpenChange={importDialog.setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>导入 Telegram JSON</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="import-json">粘贴 JSON 数据</Label>
              <Textarea
                id="import-json"
                value={importDialog.importJSON}
                onChange={(e) => importDialog.setImportJSON(e.target.value)}
                placeholder='{"text":"Hello","parse_mode":"HTML","reply_markup":{"inline_keyboard":[[{"text":"Button","callback_data":"action"}]]}}'
                rows={10}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                ref={importDialog.fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                disabled={importDialog.isImporting}
                onChange={importDialog.onFileSelect}
              />
              <Button
                variant="secondary"
                onClick={() => importDialog.fileInputRef.current?.click()}
                className="w-full sm:w-auto"
                disabled={importDialog.isImporting}
              >
                {importDialog.isImporting ? "处理中..." : "选择 JSON 文件"}
              </Button>
              <p className="text-xs text-muted-foreground sm:text-right">
                支持直接选择从本工具导出的 JSON 文件
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => importDialog.setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={importDialog.onImport}
              disabled={importDialog.isImporting || !importDialog.importJSON.trim()}
            >
              {importDialog.isImporting ? "导入中..." : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialog.open} onOpenChange={renameDialog.setOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>重命名模版</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename">新名称</Label>
              <Input
                id="rename"
                value={renameDialog.value}
                onChange={(e) => renameDialog.setValue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => renameDialog.setOpen(false)}>
              取消
            </Button>
            <Button onClick={renameDialog.onSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        <TemplateFlowDiagram
          screens={flowDiagram.screens}
          currentScreenId={flowDiagram.currentScreenId}
          open={flowDiagram.open}
          onOpenChange={flowDiagram.setOpen}
          userId={flowDiagram.userId}
          entryScreenId={flowDiagram.entryScreenId}
          pinnedIds={flowDiagram.pinnedIds}
          onLayoutSync={flowDiagram.onLayoutSync}
          onCreateLink={flowDiagram.onCreateLink}
          onScreenClick={flowDiagram.onScreenClick}
          onSetEntry={flowDiagram.onSetEntry}
          onDeleteScreen={flowDiagram.onDeleteScreen}
        />

        <CircularReferenceDialog
          open={circularDialog.open}
          onOpenChange={circularDialog.setOpen}
          circularPaths={circularDialog.circularPaths}
          screens={circularDialog.screens}
          currentScreenId={circularDialog.currentScreenId}
          onNavigateToScreen={circularDialog.onNavigateToScreen}
          onOpenFlowDiagram={circularDialog.onOpenFlowDiagram}
        />
      </Suspense>

      <TemplateSelector open={templateLibrary.open} onOpenChange={templateLibrary.setOpen} onApply={templateLibrary.onApply} />

      <OnboardingGuide
        visible={onboarding.visible}
        progress={onboarding.progress}
        onDismiss={onboarding.onDismiss}
        onOpenTemplate={onboarding.onOpenTemplate}
        onTogglePreview={onboarding.onTogglePreview}
        onShare={onboarding.onShare}
      />
    </>
  );
};
