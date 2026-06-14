declare module "bibtex-parse-js" {
  interface BibtexEntry {
    citationKey?: string;
    entryType?: string;
    entryTags?: Record<string, string>;
  }

  interface BibtexParseApi {
    toJSON(input: string): BibtexEntry[];
  }

  const bibtexParse: BibtexParseApi;
  export default bibtexParse;
}
