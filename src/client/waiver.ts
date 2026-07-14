document.querySelector<HTMLButtonElement>("[data-print-waiver]")
  ?.addEventListener("click", () => window.print());

export {};
