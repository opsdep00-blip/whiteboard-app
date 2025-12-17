export type PreviewPayload = {
  id: string;
  title: string;
  labelId: string;
  labelName?: string;
  content: string;
  savedAt: string;
};

export const PREVIEW_STORAGE_KEY = "whiteboard-preview-note";

export const savePreviewPayload = (payload: PreviewPayload) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(payload));
};

export const loadPreviewPayload = (): PreviewPayload | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PreviewPayload;
  } catch (error) {
    console.error("Failed to parse preview payload", error);
    return null;
  }
};
