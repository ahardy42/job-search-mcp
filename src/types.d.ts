declare module "random-useragent" {
  export function getRandom(): string;
  export function getRandom(filter: (agent: unknown) => boolean): string;
}

declare module "pdf-parse" {
  interface PdfData {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  export default function pdfParse(buffer: Buffer): Promise<PdfData>;
}
