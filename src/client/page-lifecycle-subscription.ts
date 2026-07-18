export function managePageLifecycleSubscription(
  subscribe: () => () => void,
  refresh: () => void,
  options: { refreshOnStart?: boolean } = {},
): () => void {
  let unsubscribe: (() => void) | null = null;
  let disposed = false;

  const activate = (): void => {
    if (disposed || unsubscribe) return;
    unsubscribe = subscribe();
  };
  const deactivate = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const removeLifecycleListeners = (): void => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    deactivate();
    if (event.persisted) return;
    disposed = true;
    removeLifecycleListeners();
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted || disposed) return;
    activate();
    refresh();
  };

  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  activate();
  if (options.refreshOnStart !== false) refresh();

  return () => {
    if (disposed) return;
    disposed = true;
    deactivate();
    removeLifecycleListeners();
  };
}
