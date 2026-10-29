export type Block = { id: string; html: string; text: string };
export type Chapter = { id: string; title: string; blocks: Block[] };
export type Book = {
  id: string;
  title: string;
  author: string;
  format: 'epub' | 'txt' | 'docx';
  chapters: Chapter[];
  warnings: string[];
};
export type Position = { chapterId: string; blockId: string; fraction: number };
export type Preferences = {
  theme: 'light' | 'dark' | 'sepia';
  fontSize: number;
  lineHeight: number;
  font: 'serif' | 'sans';
};
export const defaultPreferences: Preferences = {
  theme: 'light',
  fontSize: 20,
  lineHeight: 1.9,
  font: 'serif',
};
export const MAX_FILE_BYTES = 20_000_000;
export const MAX_LIBRARY_BYTES = 500_000_000;
export const MAX_BOOKS = 50;
export const MAX_CONVERTED_BYTES = 20_000_000;
export const MAX_CHAPTER_BLOCKS = 5_000;
export const MAX_BOOK_BLOCKS = 30_000;
