export interface FanqieRankBook {
  abstract?: string;
  author?: string;
  bookId?: string;
  bookName?: string;
  category?: string;
  creationStatus?: string;
  currentPos?: number;
  rankPosDiff?: number;
  read_count?: string;
  readCount?: string;
  thumbUri?: string;
  wordNumber?: string;
}

export interface LeaderboardBook {
  abstract?: string;
  author: string;
  bookId?: string;
  bookName: string;
  category?: string;
  categoryRank?: number;
  detailUrl?: string;
  rank: number;
  rankPosDiff?: number;
  readCount: number;
  status: "连载中" | "已完结";
  thumbUri?: string;
  wordCount: number;
}

export interface LeaderboardRequest {
  categoryId: number;
  forceRefresh?: boolean;
  gender: 0 | 1;
  limit?: number;
  offset?: number;
  type: 1 | 2;
}

export interface SubCategory {
  id: number;
  name: string;
}

export interface MainBoard {
  gender: 0 | 1;
  id: string;
  name: string;
  subCategories: SubCategory[];
  type: 1 | 2;
}
