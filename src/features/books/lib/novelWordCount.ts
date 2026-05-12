const NOVEL_WORD_TOKEN_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[A-Za-z]+(?:[’'-][A-Za-z]+)*|\d+(?:[.,]\d+)*/gu;

export function countNovelWords(content: string) {
  return Array.from(content.matchAll(NOVEL_WORD_TOKEN_PATTERN)).length;
}

export function formatNovelWordCount(count: number) {
  return `${new Intl.NumberFormat("zh-CN").format(count)} 字`;
}
