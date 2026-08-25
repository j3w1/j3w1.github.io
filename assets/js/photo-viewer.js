export const isPhotoViewerBackdropClick = (event) => event?.target === event?.currentTarget;

export const closePhotoViewer = (dialog, returnFocus) => {
  if (!dialog?.open) return false;
  dialog.close();
  if (returnFocus?.isConnected && typeof returnFocus.focus === "function") {
    returnFocus.focus({ preventScroll: true });
  }
  return true;
};
