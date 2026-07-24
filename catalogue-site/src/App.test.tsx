import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
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
    expect(screen.getByText("Ada Twist")).toBeInTheDocument();
    expect(screen.queryByText("Bluey Dance")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "dance");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /playlist type/i }),
      "archive"
    );
    expect(screen.queryByText("Ada Twist")).not.toBeInTheDocument();
    expect(screen.getByText("Bluey Dance")).toBeInTheDocument();
    expect(window.location.search).toContain("kind=archive");
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
  });

  it("replaces folder browsing with the best matching playlists while searching", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);

    await user.type(screen.getByRole("searchbox"), "scientist");

    expect(screen.getByRole("heading", { name: "1 search result" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Ada Twist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open folder/i })).not.toBeInTheDocument();
  });

  it("opens an accessible detail view with breadcrumbs and tracks", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    await user.click(screen.getByRole("button", { name: "Open folder Science" }));
    await user.click(screen.getByRole("button", { name: /open ada twist/i }));

    const dialog = screen.getByRole("dialog", { name: "Ada Twist" });
    expect(within(dialog).getByText("Science")).toBeInTheDocument();
    expect(within(dialog).getByText("Ada Twist, Scientist")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: /open in google drive/i })
    ).toHaveAttribute("href", "https://drive.google.com/open?id=ada");
    expect(window.location.search).toContain("album=ada");

    await user.click(within(dialog).getByRole("button", { name: /close details/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a useful empty state", async () => {
    const user = userEvent.setup();
    render(<App catalogue={catalogue} />);
    await user.type(screen.getByRole("searchbox"), "not in catalogue");
    expect(screen.getByText(/no playlists match/i)).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
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
    expect(screen.getByText("Folder: Science")).toBeInTheDocument();
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

    firstRender.unmount();
    render(<App catalogue={catalogue} />);
    expect(
      screen.getByRole("button", { name: /view 1 favourite/i })
    ).toBeInTheDocument();
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
