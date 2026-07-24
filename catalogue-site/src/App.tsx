import { useEffect, useMemo, useState } from "react";
import {
  buildCatalogueSearchIndex,
  defaultFilters,
  filterAlbums,
  readCatalogueQuery,
  writeCatalogueQuery,
  type Album,
  type Catalogue,
  type CatalogueQuery,
  type Collection
} from "./catalogue";
import "./styles.css";

const FAVOURITES_KEY = "yoto-catalogue-favourites";
const THEME_KEY = "yoto-catalogue-theme";
const LAYOUT_KEY = "yoto-catalogue-layout";
type Theme = "light" | "dark";
type Layout = "gallery" | "list";

function readFavourites(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVOURITES_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function formatBytes(value: number | null): string {
  if (value === null) return "Size unavailable";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric"
      }).format(date);
}

function albumType(album: Album): string {
  if (album.kind === "expanded") return "Playlist";
  return `${album.archiveFormat?.toUpperCase() ?? "Archive"}`;
}

function playlistFolder(album: Album, catalogue: Catalogue): string {
  return (
    album.pathSegments
      .slice(1, -1)
      .map((part) => part.name)
      .join(" / ") || catalogue.root.title
  );
}

function AlbumArtwork({ album, large = false }: { album: Album; large?: boolean }) {
  return (
    <div className={`artwork ${large ? "artwork--large" : ""}`}>
      {album.cover ? (
        <img
          src={`/catalogue/${album.cover.path}`}
          alt={`${album.title} cover`}
          width={album.cover.width}
          height={album.cover.height}
        />
      ) : (
        <div className="artwork__fallback" aria-label="No cover available">
          <span>{album.title.slice(0, 1).toLocaleUpperCase()}</span>
          <small>No cover</small>
        </div>
      )}
    </div>
  );
}

function DetailDialog({
  album,
  catalogue,
  favourites,
  onToggleFavourite,
  onClose
}: {
  album: Album;
  catalogue: Catalogue;
  favourites: Set<string>;
  onToggleFavourite(album: Album): void;
  onClose(): void;
}) {
  const nested = album.nestedAlbumIds
    .map((id) => catalogue.albums.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Album => Boolean(candidate));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-label={album.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="detail__close" type="button" onClick={onClose} aria-label="Close details">
          Close
        </button>
        <div className="detail__hero">
          <AlbumArtwork album={album} large />
          <div>
            <span className="eyebrow">{albumType(album)}</span>
            <h2>{album.title}</h2>
            <nav className="breadcrumbs" aria-label="Playlist location">
              {album.pathSegments.slice(0, -1).map((segment, index) => (
                <span key={segment.id}>
                  {index > 0 && <b aria-hidden="true">/</b>}
                  {segment.name}
                </span>
              ))}
            </nav>
            <div className="detail__facts">
              <span>{formatBytes(album.size)}</span>
              <span>Updated {formatDate(album.modifiedTime)}</span>
              <span>Depth {album.depth}</span>
            </div>
            <a
              className="drive-link"
              href={album.driveUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Drive
            </a>
            <FavouriteButton
              album={album}
              active={favourites.has(album.id)}
              onToggle={onToggleFavourite}
              className="detail__favourite"
            />
          </div>
        </div>
        <div className="detail__body">
          <section>
            <h3>Folder location</h3>
            <p className="path">{album.path}</p>
          </section>
          <section>
            <h3>
              Tracks{" "}
              <span className="count">
                {album.kind === "archive" ? "not inspected" : album.tracks.length}
              </span>
            </h3>
            {album.kind === "archive" ? (
              <p className="muted">
                Archive contents remain private to Drive and are not inspected by the catalogue.
              </p>
            ) : album.tracks.length ? (
              <ol className="track-list">
                {album.tracks.map((track) => (
                  <li key={track.id}>
                    <span>{String(track.position).padStart(2, "0")}</span>
                    {track.title}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No visible track metadata.</p>
            )}
          </section>
          {nested.length > 0 && (
            <section>
              <h3>Nested playlists <span className="count">{nested.length}</span></h3>
              <ul className="nested-list">
                {nested.map((candidate) => (
                  <li key={candidate.id}>
                    <div className="nested-list__identity">
                      <span>{candidate.title}</span>
                      <small>Folder: {playlistFolder(candidate, catalogue)}</small>
                    </div>
                    <FavouriteButton
                      album={candidate}
                      active={favourites.has(candidate.id)}
                      onToggle={onToggleFavourite}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function FavouriteButton({
  album,
  active,
  onToggle,
  className = ""
}: {
  album: Album;
  active: boolean;
  onToggle(album: Album): void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`favourite-button ${active ? "favourite-button--active" : ""} ${className}`}
      aria-label={`${active ? "Remove" : "Add"} ${album.title} ${active ? "from" : "to"} favourites`}
      aria-pressed={active}
      onClick={() => onToggle(album)}
    >
      <span aria-hidden="true">{active ? "♥" : "♡"}</span>
    </button>
  );
}

export default function App({ catalogue }: { catalogue: Catalogue }) {
  const [state, setState] = useState<CatalogueQuery>(() => ({
    ...defaultFilters,
    ...readCatalogueQuery(window.location.search)
  }));
  const [favourites, setFavourites] = useState<string[]>(readFavourites);
  const [showFavourites, setShowFavourites] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"
  );
  const [layout, setLayout] = useState<Layout>(() =>
    window.localStorage.getItem(LAYOUT_KEY) === "gallery" ? "gallery" : "list"
  );
  const favouriteIds = useMemo(() => new Set(favourites), [favourites]);
  const searchIndex = useMemo(
    () => buildCatalogueSearchIndex(catalogue),
    [catalogue]
  );
  const albums = useMemo(() => {
    const filtered = filterAlbums(catalogue, state, searchIndex);
    return showFavourites
      ? filtered.filter((album) => favouriteIds.has(album.id))
      : filtered;
  }, [catalogue, favouriteIds, searchIndex, showFavourites, state]);
  const browseMode = !state.query.trim() && !showFavourites;
  const currentFolder =
    state.collection === "all"
      ? undefined
      : catalogue.collections.find(
          (collection) => collection.id === state.collection
        );
  const currentFolderId = currentFolder?.id ?? catalogue.root.id;
  const childFolders = browseMode
    ? catalogue.collections
        .filter((collection) => collection.parentId === currentFolderId)
        .sort((left, right) =>
          left.title.localeCompare(right.title, undefined, {
            numeric: true,
            sensitivity: "base"
          })
        )
    : [];
  const visibleAlbums = browseMode
    ? albums.filter((album) => album.parentId === currentFolderId)
    : albums;
  const folderTrail: Array<Pick<Collection, "id" | "title">> = [
    { id: catalogue.root.id, title: catalogue.root.title },
    ...(currentFolder
      ? currentFolder.pathSegments.slice(1).map((segment) => ({
          id: segment.id,
          title: segment.name
        }))
      : [])
  ];
  const parentFolder = currentFolder
    ? catalogue.collections.find(
        (collection) => collection.id === currentFolder.parentId
      )
    : undefined;
  const parentFolderId = parentFolder?.id ?? "all";
  const parentFolderTitle = parentFolder?.title ?? catalogue.root.title;
  const selected = state.selected
    ? catalogue.albums.find((album) => album.id === state.selected)
    : undefined;

  useEffect(() => {
    const query = writeCatalogueQuery(state);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  }, [state]);

  useEffect(() => {
    const restoreFromHistory = () =>
      setState({
        ...defaultFilters,
        ...readCatalogueQuery(window.location.search)
      });
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
  }, [favourites]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  }, [layout]);

  const toggleFavourite = (album: Album) => {
    setFavourites((current) =>
      current.includes(album.id)
        ? current.filter((id) => id !== album.id)
        : [...current, album.id]
    );
  };

  const update = <K extends keyof CatalogueQuery>(
    key: K,
    value: CatalogueQuery[K]
  ) => setState((current) => ({ ...current, [key]: value, selected: undefined }));

  const navigate = (next: CatalogueQuery) => {
    const query = writeCatalogueQuery(next);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
    setState(next);
  };

  const navigateToFolder = (collection: string) =>
    navigate({ ...state, collection, selected: undefined });

  return (
    <div className="app-shell">
      <header className="hero">
        <button
          type="button"
          className="theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-pressed={theme === "dark"}
          onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <div>
          <span className="eyebrow">MYO Idea Exchange</span>
          <h1>Playlist catalogue</h1>
          <p>
            <span>Playlists</span> {catalogue.stats.albums}
            <b aria-hidden="true"> · </b>
            <span>Collections</span> {catalogue.stats.collections}
          </p>
        </div>
      </header>

      <main>
        {!catalogue.scan.complete && (
          <p className="notice" role="status">
            This catalogue is a starter snapshot. Run the Drive skill refresh
            to publish the complete collection.
          </p>
        )}
        <section className="discovery" aria-label="Catalogue filters">
          <label className="search">
            <span>Search catalogue</span>
            <input
              type="search"
              value={state.query}
              onChange={(event) => {
                const query = event.target.value;
                setState((current) => ({
                  ...current,
                  query,
                  collection: query.trim() ? "all" : current.collection,
                  selected: undefined
                }));
              }}
              placeholder="Title, folder, collection or track…"
            />
          </label>
          <div className="discovery__toolbar">
            <div className="view-switcher" aria-label="Catalogue view">
              <button
                type="button"
                className={!showFavourites ? "view-switcher__active" : ""}
                aria-pressed={!showFavourites}
                onClick={() => setShowFavourites(false)}
              >
                All playlists
              </button>
              <button
                type="button"
                className={showFavourites ? "view-switcher__active" : ""}
                aria-pressed={showFavourites}
                onClick={() => setShowFavourites(true)}
              >
                <span aria-hidden="true">♥</span>{" "}
                View {favourites.length} {favourites.length === 1 ? "favourite" : "favourites"}
              </button>
            </div>
            <details className="filter-drawer">
              <summary>Filters</summary>
              <div className="filters">
                <label>
                  <span>Playlist type</span>
                  <select value={state.kind} onChange={(event) => update("kind", event.target.value as CatalogueQuery["kind"])}>
                    <option value="all">All types</option>
                    <option value="archive">Archives</option>
                    <option value="expanded">Expanded folders</option>
                  </select>
                </label>
                <label>
                  <span>Collection</span>
                  <select value={state.collection} onChange={(event) => update("collection", event.target.value)}>
                    <option value="all">All collections</option>
                    {catalogue.collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cover</span>
                  <select value={state.cover} onChange={(event) => update("cover", event.target.value as CatalogueQuery["cover"])}>
                    <option value="all">Any cover</option>
                    <option value="available">Cover available</option>
                    <option value="missing">No cover</option>
                  </select>
                </label>
                <label>
                  <span>Nesting depth</span>
                  <select value={state.depth} onChange={(event) => update("depth", event.target.value as CatalogueQuery["depth"])}>
                    <option value="all">Any depth</option>
                    <option value="1">Level 1</option>
                    <option value="2">Level 2</option>
                    <option value="3+">Level 3+</option>
                  </select>
                </label>
                <label>
                  <span>Sort by</span>
                  <select value={state.sort} onChange={(event) => update("sort", event.target.value as CatalogueQuery["sort"])}>
                    <option value="title">Title</option>
                    <option value="path">Folder path</option>
                    <option value="modified">Recently updated</option>
                  </select>
                </label>
              </div>
            </details>
          </div>
        </section>

        {browseMode && (
          <nav className="folder-breadcrumbs" aria-label="Folder location">
            {currentFolder && (
              <button
                type="button"
                className="folder-up"
                aria-label={`Up to ${parentFolderTitle}`}
                onClick={() => navigateToFolder(parentFolderId)}
              >
                <span aria-hidden="true">↑</span>
                Up
              </button>
            )}
            <span className="folder-breadcrumbs__trail">
            {folderTrail.map((folder, index) => (
              <span key={folder.id}>
                {index > 0 && <b aria-hidden="true"> / </b>}
                <button
                  type="button"
                  onClick={() =>
                    navigateToFolder(
                      folder.id === catalogue.root.id ? "all" : folder.id
                    )
                  }
                >
                  {folder.title}
                </button>
              </span>
            ))}
            </span>
          </nav>
        )}

        <div className="results-heading">
          <h2>
            {showFavourites
              ? `${visibleAlbums.length} ${visibleAlbums.length === 1 ? "favourite" : "favourites"}`
              : state.query.trim()
                ? `${visibleAlbums.length} search ${visibleAlbums.length === 1 ? "result" : "results"}`
                : childFolders.length && !visibleAlbums.length
                  ? `${childFolders.length} ${childFolders.length === 1 ? "folder" : "folders"}`
                  : childFolders.length
                    ? `${childFolders.length + visibleAlbums.length} items`
                    : visibleAlbums.length === 1
                      ? "1 playlist"
                      : `${visibleAlbums.length} playlists`}
          </h2>
          <div className="results-actions">
            {visibleAlbums.length > 0 && (
              <div className="layout-switcher" aria-label="Playlist layout">
                <button
                  type="button"
                  aria-label="Gallery view"
                  aria-pressed={layout === "gallery"}
                  className={layout === "gallery" ? "layout-switcher__active" : ""}
                  onClick={() => setLayout("gallery")}
                >
                  <span aria-hidden="true">▦</span> Gallery
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={layout === "list"}
                  className={layout === "list" ? "layout-switcher__active" : ""}
                  onClick={() => setLayout("list")}
                >
                  <span aria-hidden="true">☷</span> List
                </button>
              </div>
            )}
            {(state.query || Object.entries(state).some(([key, value]) => key !== "sort" && key !== "selected" && value !== "all" && value !== "")) && (
              <button
                type="button"
                className="text-button"
                onClick={() => setState({ ...defaultFilters })}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {childFolders.length > 0 && (
          <section className="folder-grid" aria-label="Folders">
            {childFolders.map((folder) => (
              <button
                type="button"
                className="folder-card"
                key={folder.id}
                aria-label={`Open folder ${folder.title}`}
                onClick={() => navigateToFolder(folder.id)}
              >
                <span className="folder-card__icon" aria-hidden="true">◆</span>
                <span>
                  <strong>{folder.title}</strong>
                  <small>
                    {folder.nestedAlbumIds.length}{" "}
                    {folder.nestedAlbumIds.length === 1 ? "playlist" : "playlists"}
                  </small>
                </span>
                <span className="folder-card__arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        )}

        {visibleAlbums.length ? (
          <section
            className={`album-grid ${layout === "list" ? "album-grid--list" : ""}`}
            aria-label="Playlist results"
          >
            {visibleAlbums.map((album) => (
              <article className="album-card" key={album.id}>
                <FavouriteButton
                  album={album}
                  active={favouriteIds.has(album.id)}
                  onToggle={toggleFavourite}
                />
                <button
                  type="button"
                  className={`album-card__button ${
                    layout === "list" && album.cover
                      ? "album-card__button--has-artwork"
                      : ""
                  }`}
                  aria-label={`Open ${album.title}`}
                  onClick={() => navigate({ ...state, selected: album.id })}
                >
                  {(layout === "gallery" || album.cover) && (
                    <AlbumArtwork album={album} />
                  )}
                  <div className="album-card__content">
                    <div className="album-card__identity">
                      <span className="album-card__type">{albumType(album)}</span>
                      <h3>{album.title}</h3>
                    </div>
                    <p className="folder-subtitle">
                      Folder: {playlistFolder(album, catalogue)}
                    </p>
                    <div className="album-card__meta">
                      {album.kind === "expanded" && (
                        <span>{album.tracks.length} tracks</span>
                      )}
                      <span>{formatDate(album.modifiedTime)}</span>
                    </div>
                  </div>
                </button>
              </article>
            ))}
          </section>
        ) : !childFolders.length ? (
          <section className="empty-state">
            <span aria-hidden="true">{showFavourites ? "♡" : "0"}</span>
            <h2>
              {showFavourites
                ? "No favourites match these filters."
                : "No playlists match those filters."}
            </h2>
            <p>
              {showFavourites
                ? "Favourite a playlist, or broaden the selected filters."
                : "Try a broader search or clear the selected filters."}
            </p>
          </section>
        ) : null}
      </main>
      <footer>
        <span>Read-only Drive snapshot</span>
        <span>Updated {formatDate(catalogue.generatedAt)}</span>
      </footer>
      {selected && (
        <DetailDialog
          album={selected}
          catalogue={catalogue}
          favourites={favouriteIds}
          onToggleFavourite={toggleFavourite}
          onClose={() =>
            setState((current) => ({ ...current, selected: undefined }))
          }
        />
      )}
    </div>
  );
}
