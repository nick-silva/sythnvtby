/**
 * Bind non-canvas painter UI events (file/frame/select controls and dialogs).
 * Keeps event registration readable; behavior stays in callbacks provided by painter.js.
 *
 * @param {{
 *   fileMenuOpen: HTMLElement|null,
 *   fileVbpack: HTMLInputElement|null,
 *   closePainterFileMenu: () => void,
 *   onOpenPack: () => void | Promise<void>,
 *   onSave: (saveAs: boolean) => void,
 *   fileMenuSave: HTMLElement|null,
 *   fileMenuSaveAs: HTMLElement|null,
 *   onPickFile: (file: File) => Promise<void>,
 *   frameSelect: HTMLSelectElement|null,
 *   onFrameSelectChange: (index: number) => void,
 *   eyeSelect: HTMLSelectElement|null,
 *   onEyeChange: () => void,
 *   layerSelect: HTMLSelectElement|null,
 *   onLayerChange: () => void,
 *   btnReload: HTMLElement|null,
 *   onReloadFrame: () => void,
 *   v2VariantSelect: HTMLSelectElement|null,
 *   onVariantChange: (value: string) => void,
 *   toggleShotOverlay: HTMLInputElement|null,
 *   onToggleScreenshotOverlay: (on: boolean) => void,
 *   shotOverlayAlpha: HTMLInputElement|null,
 *   onScreenshotOpacityInput: (value: number) => void,
 *   btnV2VariantAuto: HTMLElement|null,
 *   onVariantAuto: () => void,
 *   btnPaintV2Top: HTMLElement|null,
 *   onPaintV2Top: () => void,
 *   btnNewGroupFromSelection: HTMLElement|null,
 *   onNewGroupFromSelection: () => void,
 *   btnClearGroupFilter: HTMLElement|null,
 *   onClearGroupFilter: () => void,
 *   btnSelectUnassignedPoolTiles: HTMLElement|null,
 *   onSelectUnassignedPoolTiles: () => void,
 *   newGroupCancel: HTMLElement|null,
 *   newGroupDialog: HTMLDialogElement|null,
 *   newGroupSuggestKind: HTMLElement|null,
 *   onSuggestGroupKind: () => void,
 *   newGroupPoolVariant: HTMLSelectElement|null,
 *   onNewGroupPoolVariantChange: () => void,
 *   onNewGroupDialogClick: (target: HTMLElement|null, e: Event) => void,
 *   newGroupForm: HTMLFormElement|null,
 *   onNewGroupSubmit: (e: Event) => void,
 *   dupGroupCancel: HTMLElement|null,
 *   onDuplicateCancel: () => void,
 *   dupGroupConfirm: HTMLElement|null,
 *   onDuplicateConfirm: () => void,
 *   dupGroupPoolVariant: HTMLSelectElement|null,
 *   onDuplicatePoolVariantChange: () => void,
 *   duplicateGroupDialog: HTMLDialogElement|null,
 *   onDuplicateDialogClose: () => void,
 * }} deps
 */
export function bindPainterUiEvents(deps) {
  const {
    fileMenuOpen,
    fileVbpack,
    closePainterFileMenu,
    onOpenPack,
    onSave,
    fileMenuSave,
    fileMenuSaveAs,
    onPickFile,
    frameSelect,
    onFrameSelectChange,
    eyeSelect,
    onEyeChange,
    layerSelect,
    onLayerChange,
    btnReload,
    onReloadFrame,
    v2VariantSelect,
    onVariantChange,
    toggleShotOverlay,
    onToggleScreenshotOverlay,
    shotOverlayAlpha,
    onScreenshotOpacityInput,
    btnV2VariantAuto,
    onVariantAuto,
    btnPaintV2Top,
    onPaintV2Top,
    btnNewGroupFromSelection,
    onNewGroupFromSelection,
    btnClearGroupFilter,
    onClearGroupFilter,
    btnSelectUnassignedPoolTiles,
    onSelectUnassignedPoolTiles,
    newGroupCancel,
    newGroupDialog,
    newGroupSuggestKind,
    onSuggestGroupKind,
    newGroupPoolVariant,
    onNewGroupPoolVariantChange,
    onNewGroupDialogClick,
    newGroupForm,
    onNewGroupSubmit,
    dupGroupCancel,
    onDuplicateCancel,
    dupGroupConfirm,
    onDuplicateConfirm,
    dupGroupPoolVariant,
    onDuplicatePoolVariantChange,
    duplicateGroupDialog,
    onDuplicateDialogClose,
  } = deps;

  fileMenuOpen?.addEventListener('click', () => {
    closePainterFileMenu();
    void onOpenPack();
  });
  fileMenuSave?.addEventListener('click', () => onSave(false));
  fileMenuSaveAs?.addEventListener('click', () => onSave(true));
  fileVbpack?.addEventListener('change', async () => {
    const f = fileVbpack.files?.[0];
    if (!f) return;
    await onPickFile(f);
    fileVbpack.value = '';
  });
  frameSelect?.addEventListener('change', () => onFrameSelectChange(Number(frameSelect.value)));
  eyeSelect?.addEventListener('change', onEyeChange);
  layerSelect?.addEventListener('change', onLayerChange);
  btnReload?.addEventListener('click', onReloadFrame);
  v2VariantSelect?.addEventListener('change', () => onVariantChange(v2VariantSelect.value?.trim() || ''));
  toggleShotOverlay?.addEventListener('change', () => onToggleScreenshotOverlay(toggleShotOverlay.checked));
  shotOverlayAlpha?.addEventListener('input', () => onScreenshotOpacityInput(Number(shotOverlayAlpha.value)));
  btnV2VariantAuto?.addEventListener('click', onVariantAuto);
  btnPaintV2Top?.addEventListener('click', onPaintV2Top);
  btnNewGroupFromSelection?.addEventListener('click', onNewGroupFromSelection);
  btnClearGroupFilter?.addEventListener('click', onClearGroupFilter);
  btnSelectUnassignedPoolTiles?.addEventListener('click', onSelectUnassignedPoolTiles);

  newGroupCancel?.addEventListener('click', () => newGroupDialog?.close());
  newGroupSuggestKind?.addEventListener('click', onSuggestGroupKind);
  newGroupPoolVariant?.addEventListener('change', onNewGroupPoolVariantChange);
  newGroupDialog?.addEventListener('click', (e) => {
    onNewGroupDialogClick(/** @type {HTMLElement|null} */ (e.target), e);
  });
  newGroupForm?.addEventListener('submit', onNewGroupSubmit);

  dupGroupCancel?.addEventListener('click', onDuplicateCancel);
  dupGroupConfirm?.addEventListener('click', onDuplicateConfirm);
  dupGroupPoolVariant?.addEventListener('change', onDuplicatePoolVariantChange);
  duplicateGroupDialog?.addEventListener('close', onDuplicateDialogClose);
}
