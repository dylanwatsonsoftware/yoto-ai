import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { shouldShowIncompleteNotice } from "./App";
import type { Catalogue } from "./catalogue";

const catalogue: Catalogue = {
  schemaVersion: 1,
  generatedAt: "2026-07-24T00:00:00Z",
  root: { id: "root", title: "MYO Idea Exchange" },
  scan: { complete: true },
  stats: { albums: 2, collections: 2, covers: 1 },
  collections: [
    {
      id: "science",
      title: "Science",
      path: "MYO/Science",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "science", name: "Science" }
      ],
      depth: 1,
      parentId: "root",
      childCollectionIds: [],
      albumIds: ["ada"],
      nestedAlbumIds: ["ada"]
    },
    {
      id: "stories",
      title: "Stories",
      path: "MYO/Stories",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "stories", name: "Stories" }
      ],
      depth: 1,
      parentId: "root",
      childCollectionIds: [],
      albumIds: ["bluey"],
      nestedAlbumIds: ["bluey"]
    }
  ],
  albums: [
    {
      id: "ada",
      title: "Ada Twist",
      kind: "expanded",
      archiveFormat: null,
      driveUrl: "https://drive.google.com/open?id=ada",
      path: "MYO/Science/Ada Twist",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "science", name: "Science" },
        { id: "ada", name: "Ada Twist" }
      ],
      depth: 2,
      parentId: "science",
      parentCollectionId: "science",
      nestedAlbumIds: [],
      size: null,
      modifiedTime: "2026-07-20T00:00:00Z",
      checksum: null,
      cover: {
        sourceId: "cover",
        sourceName: "cover.png",
        checksum: "sum",
        path: "covers/ada.webp",
        width: 320,
        height: 320
      },
      tracks: [
        { id: "track-1", position: 1, title: "Ada Twist, Scientist" },
        { id: "track-2", position: 2, title: "Iggy Peck, Architect" }
      ]
    },
    {
      id: "bluey",
      title: "Bluey Dance",
      kind: "archive",
      archiveFormat: "zip",
      driveUrl: "https://drive.google.com/open?id=bluey",
      path: "MYO/Stories/Bluey Dance.zip",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "stories", name: "Stories" },
        { id: "bluey", name: "Bluey Dance.zip" }
      ],
      depth: 2,
      parentId: "stories",
      parentCollectionId: "stories",
      nestedAlbumIds: [],
      size: 100,
      modifiedTime: "2026-07-22T00:00:00Z",
      checksum: "bluey",
      cover: null,
      tracks: []
    }
  ]
};

describe("catalogue app", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("searches and filters the read-only playlist catalogue", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);

    await user.type(
      screen.getByRole("searchbox", { name: /search catalogue/i }),
      "scientist"
    );
    expect(await screen.findByText("Ada Twist")).toBeInTheDocument();
    expect(screen.queryByText("Bluey Dance")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "dance");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /playlist type/i }),
      "archive"
    );
    expect(screen.queryByText("Ada Twist")).not.toBeInTheDocument();
    expect(await screen.findByText("Bluey Dance")).toBeInTheDocument();
    expect(screen.queryByText(/contents uninspected/i)).not.toBeInTheDocument();
    expect(window.location.search).toContain("kind=archive");
  });

  it("offers known collection shortcuts that run catalogue searches", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    const shortcuts = screen.getByRole("navigation", {
      name: "Known collections"
    });
    const names = [
      "Audiobooks",
      "BBC",
      "BrainBots",
      "Disney",
      "5 Minute",
      "Christmas",
      "Easter",
      "Halloween",
      "Marvel",
      "Hogwarts",
      "Yoto Originals",
      "Yoto Collection",
      "Yoto Classical",
      "Soundscape",
      "Tonies",
      "Music"
    ];

    expect(
      within(shortcuts)
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-pressed"))
    ).toHaveLength(names.length);
    for (const name of names) {
      expect(
        within(shortcuts).getByRole("button", { name })
      ).toBeInTheDocument();
    }

    await user.click(within(shortcuts).getByRole("button", { name: "Disney" }));
    expect(screen.getByRole("searchbox")).toHaveValue("Disney");
    expect(
      within(shortcuts).getByRole("button", { name: "Disney" })
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(window.location.search).toContain("q=Disney")
    );

    await user.click(
      within(shortcuts).getByRole("button", { name: "Disney" })
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(
      within(shortcuts).getByRole("button", { name: "Disney" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(window.location.search).not.toContain("q=");
  });

  it("keeps an explicit clear-search button visible whenever search has text", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    const search = screen.getByRole("searchbox");

    expect(
      screen.queryByRole("button", { name: "Clear search" })
    ).not.toBeInTheDocument();
    await user.type(search, "Ada");
    await user.tab();

    const clear = screen.getByRole("button", { name: "Clear search" });
    expect(clear).toBeVisible();
    await user.click(clear);

    expect(search).toHaveValue("");
    await waitFor(() =>
      expect(window.location.search).not.toContain("q=")
    );
  });

  it("enters a focused search mode while the search query has text", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    const search = screen.getByRole("searchbox");
    const shell = search.closest(".app-shell");

    expect(shell).not.toHaveClass("app-shell--searching");

    await user.type(search, "Ada");
    expect(shell).toHaveClass("app-shell--searching");

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(shell).not.toHaveClass("app-shell--searching");
  });

  it("does not animate focused search mode on larger screens", async () => {
    const user = userEvent.setup();
    const animate = vi.fn();
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false }))
    });
    render(<App catalogue={catalogue} />);

    await user.type(screen.getByRole("searchbox"), "Ada");
    expect(animate).not.toHaveBeenCalled();

    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("animates the search panel transform on the compositor", async () => {
    const user = userEvent.setup();
    const animate = vi.fn(() => ({}) as Animation);
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(max-width: 680px)"
      }))
    });
    render(<App catalogue={catalogue} />);
    expect(screen.getByRole("searchbox").closest(".app-shell")).toHaveClass(
      "app-shell--compositor-transitions"
    );

    await user.type(screen.getByRole("searchbox"), "Ada");
    expect(animate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(animate).toHaveBeenCalledTimes(2);

    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("browses top-level folders before showing their playlists", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);

    expect(screen.getByRole("heading", { name: "2 folders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder Science" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Ada Twist" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Playlist layout")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open folder Science" }));

    expect(screen.getByRole("navigation", { name: "Folder location" })).toHaveTextContent(
      "MYO Idea Exchange / Science"
    );
    expect(screen.getByRole("button", { name: "Open Ada Twist" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Up to MYO Idea Exchange" })
    );
    expect(screen.getByRole("heading", { name: "2 folders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder Science" })).toBeInTheDocument();
  });

  it("restores the parent folder scroll position when navigating up", async () => {
    const user = userEvent.setup();
    let scrollPosition = 540;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollPosition
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<App catalogue={catalogue} />);

    await user.click(screen.getByRole("button", { name: "Open folder Science" }));
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 0));

    scrollPosition = 125;
    await user.click(
      screen.getByRole("button", { name: "Up to MYO Idea Exchange" })
    );
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 540));

    scrollTo.mockRestore();
    Reflect.deleteProperty(window, "scrollY");
  });

  it("adds folder and playlist navigation to browser history", async () => {
    const user = userEvent.setup();
    const pushState = vi.spyOn(window.history, "pushState");
    render(<App catalogue={catalogue} />);

    await user.click(screen.getByRole("button", { name: "Open folder Science" }));
    expect(pushState).toHaveBeenLastCalledWith(
      null,
      "",
      "/?collection=science"
    );

    await user.click(screen.getByRole("button", { name: "Open Ada Twist" }));
    expect(pushState).toHaveBeenLastCalledWith(
      null,
      "",
      "/?collection=science&album=ada"
    );

    window.history.replaceState(null, "", "/?collection=science");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Ada Twist" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Open Ada Twist" })).toBeInTheDocument();
  });

  it("replaces folder browsing with the best matching playlists while searching", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);

    await user.type(screen.getByRole("searchbox"), "scientist");

    expect(
      await screen.findByRole("heading", { name: "1 search result" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Ada Twist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open folder/i })).not.toBeInTheDocument();
  });

  it("debounces search and progressively reveals large result sets", async () => {
    const user = userEvent.setup();
    const manyAlbums = Array.from({ length: 55 }, (_, index) => ({
      ...catalogue.albums[0],
      id: `shared-${index}`,
      title: `Shared playlist ${String(index + 1).padStart(2, "0")}`,
      path: `MYO/Science/Shared playlist ${index + 1}`,
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "science", name: "Science" },
        { id: `shared-${index}`, name: `Shared playlist ${index + 1}` }
      ]
    }));
    render(
      <App
        catalogue={{
          ...catalogue,
          stats: { ...catalogue.stats, albums: manyAlbums.length },
          albums: manyAlbums
        }}
      />
    );

    await user.type(screen.getByRole("searchbox"), "Shared");
    expect(window.location.search).not.toContain("q=Shared");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "55 search results" })
      ).toBeInTheDocument()
    );
    expect(
      screen.getAllByRole("button", { name: /open shared playlist/i })
    ).toHaveLength(50);

    await user.click(
      screen.getByRole("button", { name: "Load 5 more playlists" })
    );
    expect(
      screen.getAllByRole("button", { name: /open shared playlist/i })
    ).toHaveLength(55);
  });

  it("opens an accessible detail view with breadcrumbs and tracks", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    await user.click(screen.getByRole("button", { name: "Open folder Science" }));
    await user.click(screen.getByRole("button", { name: /open ada twist/i }));

    const dialog = screen.getByRole("dialog", { name: "Ada Twist" });
    expect(dialog.style.maxHeight).toContain("100dvh");
    expect(within(dialog).getByText("Science")).toBeInTheDocument();
    expect(within(dialog).getByText("Ada Twist, Scientist")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: /open in google drive/i })
    ).toHaveAttribute("href", "https://drive.google.com/open?id=ada");
    expect(window.location.search).toContain("album=ada");

    await user.click(within(dialog).getByRole("button", { name: /close details/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates from detail breadcrumbs and closes the playlist", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    await user.type(screen.getByRole("searchbox"), "Ada");
    await user.click(
      await screen.findByRole("button", { name: /open ada twist/i })
    );

    const dialog = screen.getByRole("dialog", { name: "Ada Twist" });
    expect(
      within(dialog).getByRole("button", { name: "Open folder MYO" })
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Open folder Science" })
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(window.location.search).toBe("?collection=science");
    expect(
      screen.getByRole("button", { name: "Open Ada Twist" })
    ).toBeInTheDocument();
  });

  it("shows a useful empty state", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    await user.type(screen.getByRole("searchbox"), "not in catalogue");
    expect(await screen.findByText(/no playlists match/i)).toBeInTheDocument();
  });

  it("describes an uncertified cached catalogue without calling it a starter", () => {
    render(
      <App
        catalogue={{
          ...catalogue,
          scan: { complete: false }
        }}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "The latest Drive scan could not confirm that the cached collection is complete."
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("starter snapshot");
  });

  it("only shows incomplete catalogue notices on local hosts", () => {
    expect(shouldShowIncompleteNotice(false, "localhost")).toBe(true);
    expect(shouldShowIncompleteNotice(false, "127.0.0.1")).toBe(true);
    expect(shouldShowIncompleteNotice(false, "::1")).toBe(true);
    expect(shouldShowIncompleteNotice(false, "yoto-myo.vercel.app")).toBe(false);
    expect(shouldShowIncompleteNotice(true, "localhost")).toBe(false);
  });

  it("uses playlist terminology throughout the user interface", () => {
    render(<App catalogue={catalogue} />);

    expect(screen.getByText("Playlists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All playlists" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Playlist type" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/\balbums?\b/i)).not.toBeInTheDocument();
  });

  it("switches to a persistent compact list view", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App catalogue={catalogue} />);

    await user.type(screen.getByRole("searchbox"), "Ada");
    expect(
      await screen.findByRole("button", { name: "List view" })
    ).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("region", { name: "Playlist results" })).toHaveClass(
      "album-grid--list"
    );
    expect(screen.getByRole("img", { name: "Ada Twist cover" })).toBeInTheDocument();
    expect(screen.queryByLabelText("No cover available")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("yoto-catalogue-layout")).toBe("list");

    firstRender.unmount();
    render(<App catalogue={catalogue} />);
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("keeps advanced filters tucked away until requested", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);

    const filters = screen.getByText("Filters").closest("details");
    expect(filters).not.toHaveAttribute("open");

    await user.click(screen.getByText("Filters"));
    expect(filters).toHaveAttribute("open");
    expect(
      screen.getByRole("region", { name: "Catalogue filters" })
    ).toHaveClass("discovery--filters-open");
    expect(
      screen.getByRole("region", { name: "Catalogue filters" })
    ).toHaveStyle({ position: "relative" });
    expect(
      screen.getByRole("combobox", { name: "Playlist type" })
    ).toBeVisible();
  });

  it("hides other-language content until it is explicitly included", async () => {
    const user = userEvent.setup();
    const languageCatalogue: Catalogue = {
      ...catalogue,
      stats: { ...catalogue.stats, albums: 3, collections: 3 },
      collections: [
        ...catalogue.collections,
        {
          id: "other-languages",
          title: "Other Language Content",
          path: "MYO/Other Language Content",
          pathSegments: [
            { id: "root", name: "MYO" },
            { id: "other-languages", name: "Other Language Content" }
          ],
          depth: 1,
          parentId: "root",
          childCollectionIds: [],
          albumIds: ["bonjour"],
          nestedAlbumIds: ["bonjour"]
        }
      ],
      albums: [
        ...catalogue.albums,
        {
          ...catalogue.albums[1],
          id: "bonjour",
          title: "Bonjour les amis",
          path: "MYO/Other Language Content/Bonjour les amis.zip",
          pathSegments: [
            { id: "root", name: "MYO" },
            { id: "other-languages", name: "Other Language Content" },
            { id: "bonjour", name: "Bonjour les amis.zip" }
          ],
          parentId: "other-languages",
          parentCollectionId: "other-languages"
        }
      ]
    };
    render(<App catalogue={languageCatalogue} />);

    expect(
      screen.queryByRole("button", { name: "Clear filters" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open folder Other Language Content" })
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "Bonjour");
    expect(await screen.findByText(/no playlists match/i)).toBeInTheDocument();
    expect(screen.queryByText("Bonjour les amis")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Include other languages" }));
    expect(await screen.findByText("Bonjour les amis")).toBeInTheDocument();
  });

  it("shows folder subtitles for playlists and nested playlists", async () => {
    const user = userEvent.setup();
    const nestedCatalogue: Catalogue = {
      ...catalogue,
      albums: catalogue.albums.map((album) =>
        album.id === "ada"
          ? { ...album, nestedAlbumIds: ["bluey"] }
          : album
      )
    };
    render(<App catalogue={nestedCatalogue} />);

    await user.type(screen.getByRole("searchbox"), "Ada");
    expect(await screen.findByText("Folder: Science")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /open ada twist/i }));
    const dialog = screen.getByRole("dialog", { name: "Ada Twist" });
    const nestedItem = within(dialog).getByText("Bluey Dance").closest("li");
    expect(nestedItem).not.toBeNull();
    expect(within(nestedItem!).getByText("Folder: Stories")).toBeInTheDocument();
  });

  it("favourites albums, persists them, and shows them in a dedicated view", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App catalogue={catalogue} />);

    await user.click(screen.getByRole("button", { name: "Open folder Science" }));
    await user.click(
      screen.getByRole("button", { name: /add ada twist to favourites/i })
    );
    expect(
      screen.getByRole("button", { name: /remove ada twist from favourites/i })
    ).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("yoto-catalogue-favourites")).toBe(
      '["ada"]'
    );

    await user.click(screen.getByRole("button", { name: /view 1 favourite/i }));
    expect(screen.getByText("Ada Twist")).toBeInTheDocument();
    expect(screen.queryByText("Bluey Dance")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 favourite" })).toBeInTheDocument();

    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(
      screen.getByRole("button", { name: "Copy AI skill prompt" })
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("$yoto-myo-idea-exchange-google-drive")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("$yoto-ai")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/dylanwatsonsoftware/yoto-ai")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Ada Twist — MYO/Science/Ada Twist")
    );
    expect(screen.getByRole("status")).toHaveTextContent("Prompt copied");

    firstRender.unmount();
    render(<App catalogue={catalogue} />);
    expect(
      screen.getByRole("button", { name: /view 1 favourite/i })
    ).toBeInTheDocument();
  });

  it("deep-links to favourites and keeps view changes in the URL", async () => {
    window.localStorage.setItem("yoto-catalogue-favourites", '["ada"]');
    window.history.replaceState(null, "", "/?view=favourites");
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);

    expect(
      screen.getByRole("button", { name: /view 1 favourite/i })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Ada Twist")).toBeInTheDocument();
    expect(screen.queryByText("Bluey Dance")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy AI skill prompt" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All playlists" }));
    expect(window.location.search).not.toContain("view=favourites");

    await user.click(
      screen.getByRole("button", { name: /view 1 favourite/i })
    );
    expect(window.location.search).toContain("view=favourites");
  });

  it("can favourite a nested album from its parent detail view", async () => {
    const user = userEvent.setup();
    const nestedCatalogue: Catalogue = {
      ...catalogue,
      albums: catalogue.albums.map((album) =>
        album.id === "ada"
          ? { ...album, nestedAlbumIds: ["bluey"] }
          : album
      )
    };
    render(<App catalogue={nestedCatalogue} />);

    await user.click(screen.getByRole("button", { name: "Open folder Science" }));
    await user.click(screen.getByRole("button", { name: /open ada twist/i }));
    const dialog = screen.getByRole("dialog", { name: "Ada Twist" });
    await user.click(
      within(dialog).getByRole("button", {
        name: /add bluey dance to favourites/i
      })
    );

    expect(window.localStorage.getItem("yoto-catalogue-favourites")).toBe(
      '["bluey"]'
    );
  });

  it("defaults to dark mode and restores a saved light preference", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App catalogue={catalogue} />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("yoto-catalogue-theme")).toBe("dark");
    expect(
      screen.getByRole("button", { name: /switch to light mode/i })
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /switch to light mode/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("yoto-catalogue-theme")).toBe("light");

    firstRender.unmount();
    render(<App catalogue={catalogue} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
