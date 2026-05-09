import type { MainBoard, SubCategory } from "./types";

export const OVERALL_CATEGORY_ID = -1;
export const FANQIE_OVERALL_BOARD_ID = "fanqie-overall";

export const MALE_CATEGORIES_BASE: SubCategory[] = [
  { id: 1014, name: "都市高武" },
  { id: 8, name: "科幻末世" },
  { id: 258, name: "传统玄幻" },
  { id: 272, name: "历史脑洞" },
  { id: 539, name: "悬疑脑洞" },
  { id: 262, name: "都市脑洞" },
  { id: 257, name: "玄幻脑洞" },
  { id: 751, name: "悬疑灵异" },
  { id: 504, name: "抗战谍战" },
  { id: 746, name: "游戏体育" },
  { id: 1141, name: "西方玄幻" },
  { id: 1140, name: "东方仙侠" },
  { id: 261, name: "都市日常" },
  { id: 124, name: "都市修真" },
  { id: 273, name: "历史古代" },
  { id: 27, name: "战神赘婿" },
  { id: 263, name: "都市种田" },
  { id: 718, name: "动漫衍生" },
  { id: 1016, name: "男频衍生" },
];

export const FEMALE_CATEGORIES_BASE: SubCategory[] = [
  { id: 1139, name: "古风世情" },
  { id: 749, name: "青春甜宠" },
  { id: 745, name: "星光璀璨" },
  { id: 8, name: "科幻末世" },
  { id: 746, name: "游戏体育" },
  { id: 1015, name: "女频衍生" },
  { id: 248, name: "玄幻言情" },
  { id: 23, name: "种田" },
  { id: 79, name: "年代" },
  { id: 267, name: "现言脑洞" },
  { id: 246, name: "宫斗宅斗" },
  { id: 539, name: "悬疑脑洞" },
  { id: 253, name: "古言脑洞" },
  { id: 24, name: "快穿" },
  { id: 747, name: "女频悬疑" },
  { id: 750, name: "职场婚恋" },
  { id: 748, name: "豪门总裁" },
  { id: 1017, name: "民国言情" },
];

const OVERALL_CATEGORY: SubCategory = { id: OVERALL_CATEGORY_ID, name: "总榜" };
const MALE_CATEGORIES: SubCategory[] = [OVERALL_CATEGORY, ...MALE_CATEGORIES_BASE];
const FEMALE_CATEGORIES: SubCategory[] = [OVERALL_CATEGORY, ...FEMALE_CATEGORIES_BASE];

export const MAIN_BOARDS: MainBoard[] = [
  { id: "male-reading", name: "男频阅读榜", gender: 1, type: 2, subCategories: MALE_CATEGORIES },
  { id: "male-new", name: "男频新书榜", gender: 1, type: 1, subCategories: MALE_CATEGORIES },
  { id: "female-reading", name: "女频阅读榜", gender: 0, type: 2, subCategories: FEMALE_CATEGORIES },
  { id: "female-new", name: "女频新书榜", gender: 0, type: 1, subCategories: FEMALE_CATEGORIES },
];

export const LEADERBOARD_BOARD_OPTIONS = [
  { id: FANQIE_OVERALL_BOARD_ID, name: "今日番茄总榜" },
  ...MAIN_BOARDS.map((board) => ({ id: board.id, name: board.name })),
];
