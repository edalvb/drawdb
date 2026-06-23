import { useCallback, useEffect, useRef, useState } from "react";

const SCOPES = "https://www.googleapis.com/auth/drive.file";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const GIS_SRC = "https://accounts.google.com/gsi/client";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", reject);
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });

/**
 * Google Drive integration using Google Identity Services (token flow) +
 * the Picker API. Scope is `drive.file`, so the app only ever sees files it
 * creates or that the user explicitly opens through the picker.
 */
export const useGoogleDrive = () => {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const tokenClientRef = useRef(null);
  const accessTokenRef = useRef(null);
  const expiresAtRef = useRef(0);
  const pendingRef = useRef(null);

  const isConfigured = Boolean(CLIENT_ID && API_KEY);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;

    const init = async () => {
      await Promise.all([loadScript(GAPI_SRC), loadScript(GIS_SRC)]);
      if (cancelled) return;

      await new Promise((resolve) => window.gapi.load("picker", resolve));
      if (cancelled) return;

      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response && response.access_token) {
            accessTokenRef.current = response.access_token;
            expiresAtRef.current =
              Date.now() + (Number(response.expires_in) || 3600) * 1000;
            setIsAuthenticated(true);
            const pending = pendingRef.current;
            pendingRef.current = null;
            if (pending) pending.resolve(response.access_token);
          } else {
            const pending = pendingRef.current;
            pendingRef.current = null;
            if (pending) pending.reject(new Error("Authorization failed"));
          }
        },
      });
      setIsReady(true);
    };

    init().catch((err) => console.error("Failed to init Google Drive", err));
    return () => {
      cancelled = true;
    };
  }, [isConfigured]);

  const hasValidToken = () =>
    Boolean(accessTokenRef.current) && Date.now() < expiresAtRef.current - 60_000;

  /** Resolves with a valid access token, prompting the user only when needed. */
  const ensureToken = useCallback(() => {
    if (hasValidToken()) return Promise.resolve(accessTokenRef.current);
    if (!tokenClientRef.current)
      return Promise.reject(new Error("Google Drive is not ready yet"));

    return new Promise((resolve, reject) => {
      pendingRef.current = { resolve, reject };
      // Skip the consent screen on refreshes once already granted.
      tokenClientRef.current.requestAccessToken({
        prompt: accessTokenRef.current ? "" : "consent",
      });
    });
  }, []);

  const login = useCallback(() => ensureToken(), [ensureToken]);

  /**
   * Creates or updates a file in Drive. Pass an existing `fileId` to overwrite
   * it in place instead of creating a duplicate. Returns the file id.
   */
  const saveFileToDrive = useCallback(
    async (content, fileName, fileId = null, mimeType = "application/json") => {
      const token = await ensureToken();
      const metadata = fileId ? { name: fileName } : { name: fileName, mimeType };

      const form = new FormData();
      form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      );
      form.append("file", new Blob([content], { type: mimeType }));

      const base = "https://www.googleapis.com/upload/drive/v3/files";
      const url = fileId
        ? `${base}/${fileId}?uploadType=multipart&fields=id,name`
        : `${base}?uploadType=multipart&fields=id,name`;

      const response = await fetch(url, {
        method: fileId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Drive upload failed: ${response.status}`);
      }
      return response.json();
    },
    [ensureToken],
  );

  /**
   * Opens the Drive picker and invokes `onPicked(content, name, fileId)` with
   * the text content of the chosen file.
   */
  const openPicker = useCallback(
    async (onPicked) => {
      const token = await ensureToken();

      const view = new window.google.picker.DocsView(
        window.google.picker.ViewId.DOCS,
      );
      view.setMimeTypes("application/json");
      view.setMode(window.google.picker.DocsViewMode.LIST);

      const builder = new window.google.picker.PickerBuilder()
        .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
        .setDeveloperKey(API_KEY)
        .setOAuthToken(token)
        .addView(view)
        .setCallback(async (data) => {
          if (data.action !== window.google.picker.Action.PICKED) return;
          const doc = data.docs[0];
          try {
            const res = await fetch(
              `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
            const text = await res.text();
            onPicked(text, doc.name, doc.id);
          } catch (err) {
            console.error("Error downloading file from Drive", err);
            onPicked(null, doc.name, doc.id, err);
          }
        });

      if (APP_ID) builder.setAppId(APP_ID);
      builder.build().setVisible(true);
    },
    [ensureToken],
  );

  return {
    isConfigured,
    isReady,
    isAuthenticated,
    login,
    saveFileToDrive,
    openPicker,
  };
};
