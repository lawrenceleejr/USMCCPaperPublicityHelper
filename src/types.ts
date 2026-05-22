export interface PaperRow {
  timestamp: string;
  email: string;
  paperTitle: string;
  plainTitle: string;
  authors: string;
  publicationDate: string;
  category: string;
  publicAbstract: string;
  paperLink: string;
  figuresOk: boolean;
  additionalComments: string;
}

export interface GenerateRequest {
  row: PaperRow;
  model: string;
  includeThread: boolean;
  useClaude: boolean;
}

export interface GeneratedContent {
  twitter: string;
  twitterThread: string[] | null;
  bluesky: string;
  linkedin: string;
  plainSummary: string;
}

export interface Preferences {
  model: string;
  includeThread: boolean;
  useClaude: boolean;
}

export type ApiKeyStatus = "set" | "not_set";

export interface ArxivFigure {
  filename: string;
  mimeType: string;
  dataBase64: string;
}
