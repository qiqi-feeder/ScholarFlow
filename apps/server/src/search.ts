import { sha256 } from "@scholarflow/research";

export interface SearchHit {
  title: string;
  doi?: string;
  url: string;
  authors: string[];
  year?: number;
  container?: string;
  license?: string;
  abstract?: string;
  score?: number;
  source: "crossref";
  retrievedAt: string;
  raw: unknown;
}

export interface SearchResponse {
  query: string;
  channel: "crossref";
  retrievedAt: string;
  responseHash: string;
  hits: SearchHit[];
  note?: string;
}

export type FetchLike = typeof fetch;

export class CrossrefSearch {
  constructor(
    private readonly options: { contactEmail?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
  ) {}

  private async request(url: string): Promise<{ text: string; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20000);
    timer.unref?.();
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": `ScholarFlow/0.1 (local research workspace${this.options.contactEmail ? `; mailto:${this.options.contactEmail}` : ""})`,
        },
      });
      if (!response.ok) throw new Error(`Crossref responded ${response.status}`);
      const text = await response.text();
      return { text, data: JSON.parse(text) };
    } finally {
      clearTimeout(timer);
    }
  }

  async search(query: string, rows = 8): Promise<SearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) throw new Error("search query is required");
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", trimmed);
    url.searchParams.set("rows", String(Math.min(20, Math.max(1, rows))));
    url.searchParams.set("select", "DOI,title,author,URL,issued,container-title,license,abstract,score");
    if (this.options.contactEmail) url.searchParams.set("mailto", this.options.contactEmail);
    const { text, data } = await this.request(url.toString());
    const message = (data as { message?: { items?: unknown[] } }).message;
    const items = Array.isArray(message?.items) ? message.items : [];
    const retrievedAt = new Date().toISOString();
    const hits: SearchHit[] = [];
    for (const item of items) {
      const value = item as Record<string, unknown>;
      const title = Array.isArray(value.title) ? String(value.title[0] ?? "") : "";
      if (!title) continue;
      const authors = Array.isArray(value.author)
        ? value.author
            .map((author) => {
              const entry = author as Record<string, unknown>;
              return [entry.given, entry.family].filter(Boolean).join(" ");
            })
            .filter(Boolean)
        : [];
      const issued = value.issued as { "date-parts"?: number[][] } | undefined;
      const license = Array.isArray(value.license)
        ? String((value.license[0] as { URL?: string })?.URL ?? "") || undefined
        : undefined;
      const doi = typeof value.DOI === "string" ? value.DOI : undefined;
      hits.push({
        title,
        doi,
        url: doi ? `https://doi.org/${doi}` : String(value.URL ?? ""),
        authors,
        year: issued?.["date-parts"]?.[0]?.[0],
        container: Array.isArray(value["container-title"]) ? String(value["container-title"][0] ?? "") : undefined,
        license,
        abstract: typeof value.abstract === "string" ? value.abstract.replace(/<[^>]+>/g, " ") : undefined,
        score: typeof value.score === "number" ? value.score : undefined,
        source: "crossref",
        retrievedAt,
        raw: item,
      });
    }
    return {
      query: trimmed,
      channel: "crossref",
      retrievedAt,
      responseHash: sha256(text),
      hits,
      note:
        hits.length === 0
          ? "No Crossref hit. Check the title/DOI or import a readable local file; do not treat a miss as a hit."
          : hits.length > 1
            ? "Multiple records returned. Confirm the exact paper by DOI and venue before use; names can be ambiguous."
            : undefined,
    };
  }

  async fetchDoi(doi: string): Promise<SearchHit> {
    const normalized = doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
    if (!/^10\.\d{4,9}\/\S+$/.test(normalized)) throw new Error(`invalid DOI: ${doi}`);
    const url = `https://api.crossref.org/works/${encodeURIComponent(normalized)}`;
    const { text, data } = await this.request(url);
    const value = ((data as { message?: Record<string, unknown> }).message ?? {}) as Record<string, unknown>;
    const title = Array.isArray(value.title) ? String(value.title[0] ?? normalized) : normalized;
    const authors = Array.isArray(value.author)
      ? value.author.map((author) => {
          const entry = author as Record<string, unknown>;
          return [entry.given, entry.family].filter(Boolean).join(" ");
        })
      : [];
    const issued = value.issued as { "date-parts"?: number[][] } | undefined;
    const license = Array.isArray(value.license)
      ? String((value.license[0] as { URL?: string })?.URL ?? "") || undefined
      : undefined;
    return {
      title,
      doi: normalized,
      url: `https://doi.org/${normalized}`,
      authors,
      year: issued?.["date-parts"]?.[0]?.[0],
      container: Array.isArray(value["container-title"]) ? String(value["container-title"][0] ?? "") : undefined,
      license,
      abstract: typeof value.abstract === "string" ? value.abstract.replace(/<[^>]+>/g, " ") : undefined,
      source: "crossref",
      retrievedAt: new Date().toISOString(),
      raw: { text, message: value },
    };
  }
}
