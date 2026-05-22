// 伪 JSON 解析器：用于兜底解析某些上游 / 中转 API 返回的非标准 JSON。
//
// 观察到的非标准特征（基于真实样本）：
//   1) 字段之间缺少逗号        — "id":"x"\n"choices":[…]
//   2) 键与冒号、值常常分多行   — "choices"\n:\n[…]
//   3) 数组使用索引语法         — [\n0\n:\n{…}\n1\n:\n{…}\n]
//   4) 嵌套字符串内的双引号未转义
//      — "arguments":"{"action":"replace","content":"...裸双引号"宗主"..."}"
//
// 算法：反向锚定（不再依赖"括号深度 / 引号配对"前向启发式）。
//   1) 先在区间内扫出所有"骨架锚点"：键名(或数组索引) + 冒号 的位置
//   2) 每个值的范围 = 当前锚点冒号位置之后 → 下一锚点的键开始位置之前
//   3) 对每个值，按值类型递归：
//      - 引号包裹 → 字符串（内部任意字符都属于内容，包括裸引号）
//      - { } / [ ] → 子对象/数组（在子区间内继续骨架扫描）
//      - 其它 → number / null / boolean / 标识符
//   4) 这样无论内容里有多少裸引号、换行、对白符号，都不影响骨架识别
//
// 该解析器**只在标准 JSON.parse 失败后**作为兜底使用，
// 解析失败时返回 null，不会抛异常。

// 注意：JS 的 string.length 是 UTF-16 code unit 计数，不是字节数。
// 64M code units ≈ 128 MiB 内存（每个 code unit 2 字节），与字节计概念不同，
// 这里只用于阻断"明显异常的输入"，所以采用字符计数即可。
const MAX_PSEUDO_JSON_INPUT_CHARS = 64 * 1024 * 1024;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// 在 [start, end) 区间扫描下一个"键锚点"。
// 锚点形式：
//   "<key>" <空白> :
//   或   <数字> <空白> :    （数组索引语法 [0: value, 1: value]）
//
// 字符串的查找用"贪婪查找下一个 ASCII 引号 + 冒号"模式。
// 关键 trick：要识别"对象键"，我们要求"该引号 + 之后内容 = "<chars>" : "形式，
// 且 <chars> 不含未转义的空白控制字符（避免把内容里的 "..." 误判为键）。
//
// 返回：{ keyStart, colonEnd, key } —— colonEnd 是冒号位置 + 1（值的起点）。
//        没找到则返回 null。
type KeyAnchor = {
  keyStart: number;   // 键开始位置（包含引号或数字首字符）
  colonEnd: number;   // 冒号之后位置（值的扫描起点）
  key: string | number; // 解析出的键名（字符串键 / 数字索引）
};

function isWhitespace(ch: string) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string) {
  return ch.length === 1 && ch >= "0" && ch <= "9";
}

// 给定起点，尝试匹配 "<key>" <空白> :  形式
// 返回成功匹配后冒号之后的位置 + 解析出的 key 字符串；失败返回 null
function tryMatchQuotedKey(input: string, start: number): { colonEnd: number; key: string } | null {
  if (input.charAt(start) !== '"') return null;
  // 找到匹配的结束引号：支持标准转义 \" ；遇到换行直接放弃（键不允许跨行）
  let j = start + 1;
  while (j < input.length) {
    const ch = input.charAt(j);
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === '"') break;
    if (ch === "\n" || ch === "\r") return null; // 键不会跨行
    j += 1;
  }
  if (j >= input.length) return null;
  const rawKey = input.slice(start + 1, j);
  // 键中的转义只可能是 \" \\ \/ \n 等；这里只关心最常见的 \" 与 \\
  const key = rawKey.replace(/\\(.)/g, (_match, group: string) => {
    if (group === "n") return "\n";
    if (group === "r") return "\r";
    if (group === "t") return "\t";
    return group;
  });
  // 跳过 j 之后的空白，匹配 :
  let k = j + 1;
  while (k < input.length && isWhitespace(input.charAt(k))) k += 1;
  if (k >= input.length || input.charAt(k) !== ":") return null;
  return { colonEnd: k + 1, key };
}

// 给定起点，尝试匹配 <数字> <空白> :  形式
function tryMatchNumericIndex(input: string, start: number): { colonEnd: number; key: number } | null {
  if (!isDigit(input.charAt(start))) return null;
  let j = start;
  while (j < input.length && isDigit(input.charAt(j))) j += 1;
  const numText = input.slice(start, j);
  let k = j;
  while (k < input.length && isWhitespace(input.charAt(k))) k += 1;
  if (k >= input.length || input.charAt(k) !== ":") return null;
  return { colonEnd: k + 1, key: Number(numText) };
}

// 从 from 开始，跳过空白（不含逗号），返回新位置
function skipWhitespace(input: string, from: number) {
  let i = from;
  while (i < input.length && isWhitespace(input.charAt(i))) i += 1;
  return i;
}

// 跳过空白与逗号
function skipWhitespaceAndCommas(input: string, from: number) {
  let i = from;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (isWhitespace(ch) || ch === ",") {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

// 在 [from, until) 内查找匹配的右大括号 } 或右方括号 ]。
//
// 关键策略：**不识别引号边界**，只数所有 { / } 或 [ / ] 的配平。
// 这是因为伪 JSON 中字符串内可能有大量裸双引号（中文对白用 ASCII " 包裹等），
// 任何"引号内/外"的判别都会被裸引号扰乱。简单计数依赖的前提是
// "字符串内的 { } 都成对出现" —— LLM 工具调用 arguments 是 JSON，
// 内部 { } 必然配对，此前提对真实样本几乎总成立。
//
// 同时跳过反斜杠转义（\{ \} 不计数），增加少量鲁棒性。
//
// 失败时返回 -1
function findMatchingBracket(input: string, openPos: number, until: number) {
  const open = input.charAt(openPos);
  const close = open === "{" ? "}" : "]";
  let depth = 1;
  let escaped = false;
  for (let i = openPos + 1; i < until; i += 1) {
    const ch = input.charAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// findMatchingBracket 的容错版本：在 [from, until) 内找子结构 { ... } 或 [ ... ] 的结束位置。
// 如果普通括号计数失败（说明字符串内含未配对的 { } 或 [ ]），降级策略：
//   - 反向扫描 [from, until) 内的最后一个 } 或 ]，把它视为终点
//   - 这个"最后括号"通常就是 LLM 输出的子结构的真实结束
//
// 注意：调用方（parseObjectBody / parseArrayBody）通过 collectAnchors 已经把 until 收紧到了
// "下一个顶层锚点的起点"，所以反向扫描不会越界吞掉同级后续字段。顶层 parsePseudoJson 的
// until = input.length，但顶层只有单一对象，也不存在"后续顶层字段"问题。
// 仍然失败时返回 -1
function findSubstructureEnd(input: string, openPos: number, until: number) {
  const exact = findMatchingBracket(input, openPos, until);
  if (exact >= 0) return exact;
  const open = input.charAt(openPos);
  const close = open === "{" ? "}" : "]";
  // 反向扫描找到 [openPos+1, until) 内最后一个 close
  for (let i = until - 1; i > openPos; i -= 1) {
    if (input.charAt(i) === close) return i;
  }
  return -1;
}

// 收集 [from, until) 区间内所有顶层骨架锚点（不进入子 { } / [ ]）
function collectAnchors(input: string, from: number, until: number): KeyAnchor[] {
  const anchors: KeyAnchor[] = [];
  let i = from;
  while (i < until) {
    const ch = input.charAt(i);

    // 跳过空白、逗号
    if (isWhitespace(ch) || ch === ",") {
      i += 1;
      continue;
    }

    // 进入子对象/数组：跳过整个子结构（不在子结构内部找锚点）
    if (ch === "{" || ch === "[") {
      const close = findSubstructureEnd(input, i, until);
      if (close < 0) {
        // 配对失败：以剩余区间结束，放弃后续锚点
        return anchors;
      }
      i = close + 1;
      continue;
    }

    // 引号：可能是键开始或字符串值开始
    if (ch === '"') {
      const matched = tryMatchQuotedKey(input, i);
      if (matched) {
        anchors.push({ keyStart: i, colonEnd: matched.colonEnd, key: matched.key });
        // 跳过冒号；但**不立刻跳过值内容** —— 值内容在 parseValueInRange 时再确定边界
        // 这里我们只需要把指针挪到冒号之后，再用 advanceOverValue 跳过值
        i = advanceOverValue(input, matched.colonEnd, until);
        continue;
      }
      // 不是键 — 跳过这个字符串
      i = advancePastString(input, i, until);
      continue;
    }

    // 数字：可能是索引锚点（数组 [0: val, 1: val]）
    if (isDigit(ch)) {
      const matched = tryMatchNumericIndex(input, i);
      if (matched) {
        anchors.push({ keyStart: i, colonEnd: matched.colonEnd, key: matched.key });
        i = advanceOverValue(input, matched.colonEnd, until);
        continue;
      }
      // 不是索引：跳过这个数字
      while (i < until && isDigit(input.charAt(i))) i += 1;
      continue;
    }

    // 其他字符（true/false/null/字面量等）
    i += 1;
  }
  return anchors;
}

// 跳过一个值（不解析），返回值结束后的位置
function advanceOverValue(input: string, from: number, until: number): number {
  let i = skipWhitespace(input, from);
  if (i >= until) return until;
  const ch = input.charAt(i);
  if (ch === '"') return advancePastString(input, i, until);
  if (ch === "{" || ch === "[") {
    const close = findSubstructureEnd(input, i, until);
    return close < 0 ? until : close + 1;
  }
  // 字面量 / 数字 / 标识符：扫到下一个空白 / 逗号 / 结构符
  while (i < until) {
    const c = input.charAt(i);
    if (isWhitespace(c) || c === "," || c === "}" || c === "]") break;
    i += 1;
  }
  return i;
}

// 跳过一个字符串（包括嵌套未转义引号的容错）
// 策略：
//   1) 维护内部 { / [ 括号深度 bracketDepth（不区分双引号内外，因为伪 JSON 不可信）
//   2) 扫到 " 时：
//      - 若 bracketDepth > 0 → 视为内容里的引号，继续
//      - 若 bracketDepth == 0 且后续 (可选空白) 是 : / , / } / ] / EOF / 下一个键开头 → 视为结束
//      - 否则视为内容里的引号
// 同时支持："首字符不是 { 或 [" 的普通字符串：bracketDepth 永远是 0，逻辑退化为
// "只看后续是否是结构符 / 新键"，等价于以前的简单启发式。
function advancePastString(input: string, from: number, until: number): number {
  if (input.charAt(from) !== '"') return from;
  let i = from + 1;
  let bracketDepth = 0;
  while (i < until) {
    const ch = input.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "{" || ch === "[") {
      bracketDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (bracketDepth > 0) {
        bracketDepth -= 1;
        i += 1;
        continue;
      }
      // 已经溢出 — 当作字符串结束的兜底（伪 JSON 不严格）
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (bracketDepth > 0) {
        // 内嵌结构内部的引号 — 内容字符
        i += 1;
        continue;
      }
      // 候选结束 — 看后面
      let j = i + 1;
      while (j < until && isWhitespace(input.charAt(j))) j += 1;
      if (j >= until) return i + 1;
      const next = input.charAt(j);
      if (next === "," || next === "}" || next === "]" || next === ":") return i + 1;
      // 是否是下一个键？
      if (next === '"' && tryMatchQuotedKey(input, j)) return i + 1;
      if (isDigit(next) && tryMatchNumericIndex(input, j)) return i + 1;
      // 都不是 — 当作内容里的引号，继续
      i += 1;
      continue;
    }
    i += 1;
  }
  return until;
}

// 在 [start, end) 区间解析一个对象的内容（不包含外层 { }）
// 通过 anchors 拿到每个键的值区域
function parseObjectBody(input: string, start: number, end: number): Json | undefined {
  const anchors = collectAnchors(input, start, end);
  if (anchors.length === 0) return {};
  // 校验：所有锚点 key 是 string（对象内不允许数字索引）
  for (const anchor of anchors) {
    if (typeof anchor.key !== "string") return undefined;
  }
  const result: { [key: string]: Json } = {};
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const valueStart = anchor.colonEnd;
    const valueEnd = i + 1 < anchors.length ? anchors[i + 1].keyStart : end;
    const value = parseValueInRange(input, valueStart, valueEnd);
    if (value === undefined) return undefined;
    result[anchor.key as string] = value;
  }
  return result;
}

// 在 [start, end) 区间解析一个数组的内容（不包含外层 [ ]）
// 数组有两种形式：
//   - 标准: value, value, value
//   - 索引: 0: value, 1: value
function parseArrayBody(input: string, start: number, end: number): Json | undefined {
  // 先看看是不是"索引化数组"：寻找第一个非空白字符是否是 数字+:
  let probe = skipWhitespaceAndCommas(input, start);
  const isIndexed = probe < end
    && isDigit(input.charAt(probe))
    && tryMatchNumericIndex(input, probe) !== null;

  if (isIndexed) {
    const anchors = collectAnchors(input, start, end);
    // 索引锚点要按 key 排序（一般已是 0,1,2...）
    const indexedAnchors = anchors
      .filter((anchor) => typeof anchor.key === "number")
      .sort((a, b) => (a.key as number) - (b.key as number));
    const result: Json[] = [];
    for (let i = 0; i < indexedAnchors.length; i += 1) {
      const anchor = indexedAnchors[i];
      const valueStart = anchor.colonEnd;
      const valueEnd = i + 1 < indexedAnchors.length ? indexedAnchors[i + 1].keyStart : end;
      const value = parseValueInRange(input, valueStart, valueEnd);
      if (value === undefined) return undefined;
      result.push(value);
    }
    return result;
  }

  // 标准数组：扫描每个值
  const result: Json[] = [];
  let i = skipWhitespaceAndCommas(input, start);
  while (i < end) {
    const valueEnd = advanceOverValue(input, i, end);
    if (valueEnd <= i) break;
    const value = parseValueInRange(input, i, valueEnd);
    if (value === undefined) return undefined;
    result.push(value);
    i = skipWhitespaceAndCommas(input, valueEnd);
  }
  return result;
}

// 在 [start, end) 内解析一个单一值
function parseValueInRange(input: string, start: number, end: number): Json | undefined {
  const s = skipWhitespace(input, start);
  // 计算真正的 value 截止位置：去掉尾部空白与逗号
  let e = end;
  while (e > s) {
    const ch = input.charAt(e - 1);
    if (isWhitespace(ch) || ch === ",") {
      e -= 1;
      continue;
    }
    break;
  }
  if (s >= e) return undefined;

  const head = input.charAt(s);

  if (head === '"') {
    // 字符串值：找真正的结束位置（用 advancePastString 启发式）
    const stringEnd = advancePastString(input, s, e);
    // stringEnd 是闭合引号 + 1 的位置
    const raw = input.slice(s + 1, stringEnd - 1);
    return decodeStringContent(raw);
  }

  if (head === "{") {
    const close = findSubstructureEnd(input, s, e);
    if (close < 0) return undefined;
    return parseObjectBody(input, s + 1, close);
  }

  if (head === "[") {
    const close = findSubstructureEnd(input, s, e);
    if (close < 0) return undefined;
    return parseArrayBody(input, s + 1, close);
  }

  // 字面量 / 数字
  const text = input.slice(s, e).trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  // 数字
  const num = Number(text);
  if (Number.isFinite(num) && /^-?\d/.test(text)) return num;
  // 未引号字符串（容错）：当成字面量字符串
  return text;
}

// 字符串内容解码：处理 \n \t \" \\ \uXXXX 等标准转义
function decodeStringContent(raw: string): string {
  let result = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch !== "\\") {
      result += ch;
      i += 1;
      continue;
    }
    if (i + 1 >= raw.length) {
      result += ch;
      i += 1;
      continue;
    }
    const next = raw.charAt(i + 1);
    switch (next) {
      case '"': result += '"'; i += 2; break;
      case "\\": result += "\\"; i += 2; break;
      case "/": result += "/"; i += 2; break;
      case "b": result += "\b"; i += 2; break;
      case "f": result += "\f"; i += 2; break;
      case "n": result += "\n"; i += 2; break;
      case "r": result += "\r"; i += 2; break;
      case "t": result += "\t"; i += 2; break;
      case "u": {
        const hex = raw.slice(i + 2, i + 6);
        const code = Number.parseInt(hex, 16);
        if (Number.isNaN(code) || hex.length < 4) {
          result += next;
          i += 2;
        } else {
          result += String.fromCharCode(code);
          i += 6;
        }
        break;
      }
      default:
        // 非法转义：保持原字符
        result += next;
        i += 2;
        break;
    }
  }
  return result;
}

export function parsePseudoJson(input: string): unknown {
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > MAX_PSEUDO_JSON_INPUT_CHARS) return null;
  const trimmedStart = skipWhitespace(input, 0);
  if (trimmedStart >= input.length) return null;
  const head = input.charAt(trimmedStart);
  if (head !== "{" && head !== "[") return null;

  try {
    const close = findSubstructureEnd(input, trimmedStart, input.length);
    if (close < 0) return null;
    if (head === "{") {
      const body = parseObjectBody(input, trimmedStart + 1, close);
      return body === undefined ? null : body;
    }
    const body = parseArrayBody(input, trimmedStart + 1, close);
    return body === undefined ? null : body;
  } catch {
    return null;
  }
}
