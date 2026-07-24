import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { validateCatalogue, type Catalogue } from "./catalogue";

document.documentElement.dataset.theme =
  window.localStorage.getItem("yoto-catalogue-theme") === "light"
    ? "light"
    : "dark";

function CatalogueLoader() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/catalogue/catalogue.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Catalogue request failed (${response.status})`);
        return response.json() as Promise<Catalogue>;
      })
      .then((data) => setCatalogue(validateCatalogue(data)))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Catalogue unavailable")
      );
  }, []);

  if (error) {
    return (
      <main className="load-state">
        <h1>Catalogue unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!catalogue) {
    return (
      <main className="load-state" aria-busy="true">
        <span>Loading the shelves…</span>
      </main>
    );
  }
  return <App catalogue={catalogue} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CatalogueLoader />
  </StrictMode>
);
