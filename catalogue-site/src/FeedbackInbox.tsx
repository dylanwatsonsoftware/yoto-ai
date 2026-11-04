import { useEffect, useState, type FormEvent } from "react";

type FeedbackItem = { message: string; submittedAt: string };
const ADMIN_TOKEN_KEY = "myo-feedback-admin-token";

function formatSubmittedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-AU", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

export default function FeedbackInbox() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "");
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "invalid" | "unavailable" | "error">("idle");

  async function loadFeedback(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!token || status === "loading") return;
    setStatus("loading");
    try {
      const response = await fetch("/api/feedback", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (response.status === 401) {
        window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setItems(null);
        setStatus("invalid");
        return;
      }
      if (response.status === 503) {
        setItems(null);
        setStatus("unavailable");
        return;
      }
      if (!response.ok) throw new Error("Feedback could not be loaded");
      const data = (await response.json()) as { items?: FeedbackItem[] };
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
      setItems(Array.isArray(data.items) ? data.items : []);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    if (token) void loadFeedback();
  }, []);

  return (
    <main className="feedback-inbox app-shell">
      <a className="feedback-inbox__back" href="/">← Back to catalogue</a>
      <header className="feedback-inbox__header">
        <span className="eyebrow">Private inbox</span>
        <h1>Community ideas</h1>
        <p>Suggestions sent through the catalogue. This page is private to people with the admin key.</p>
      </header>

      {items === null ? (
        <form className="feedback-inbox__access" onSubmit={loadFeedback}>
          <label htmlFor="feedback-admin-token">Admin key</label>
          <div className="feedback-inbox__access-row">
            <input
              id="feedback-admin-token"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Enter your private admin key"
              required
            />
            <button type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Checking…" : "Open inbox"}
            </button>
          </div>
          {status === "invalid" && <p role="alert">That key wasn’t accepted.</p>}
          {status === "unavailable" && (
            <p role="alert">The private inbox isn’t configured yet. Add FEEDBACK_ADMIN_TOKEN to the Vercel project environment variables.</p>
          )}
          {status === "error" && <p role="alert">Couldn’t load ideas just now. Please try again.</p>}
        </form>
      ) : (
        <section className="feedback-inbox__list" aria-live="polite">
          <div className="feedback-inbox__list-heading">
            <p>{items.length} {items.length === 1 ? "idea" : "ideas"}</p>
            <button type="button" onClick={() => void loadFeedback()} disabled={status === "loading"}>
              {status === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {status === "error" && <p role="alert">Couldn’t refresh ideas just now.</p>}
          {items.length === 0 ? (
            <p className="feedback-inbox__empty">No ideas have been submitted yet.</p>
          ) : (
            <ol>
              {items.map((item, index) => (
                <li key={`${item.submittedAt}-${index}`}>
                  <p>{item.message}</p>
                  <time dateTime={item.submittedAt}>{formatSubmittedAt(item.submittedAt)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}
